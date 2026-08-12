import { and, eq } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { eventOutbox, processJobs, workflowRuns } from "../../../db/schema/process.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import {
  AccountingPeriodNotOpen,
  AccountingService,
  JournalEntry,
  JournalIdempotencyConflict,
  RevenuePostingProfileNotFound,
} from "../../accounting/mod.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"
import {
  InventoryService,
  StockReservation,
  StockReservationIdempotencyConflict,
  StockUnavailable,
} from "../../inventory/mod.ts"
import {
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
  SalesService,
} from "../../sales/mod.ts"
import { ProcessCapabilities } from "./capabilities.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const workflowType = "sales.order.confirmation"
const eventType = "process.order_confirmation.completed"
const jobType = "process.order_confirmation.post_commit"

export const OrderConfirmationPayload = Schema.Struct({
  orderId: Schema.String,
  warehouseId: Schema.String,
  legalEntityId: Schema.String,
  idempotencyKey: NonEmptyString,
})

const ScopedInput = {
  principal: Principal,
  tenantId: Schema.String,
}

export const ConfirmOrderConfirmationInput = Schema.Struct({
  ...ScopedInput,
  ...OrderConfirmationPayload.fields,
})
export const RecoverOrderConfirmationInput = ConfirmOrderConfirmationInput
export const ManualRecoveryInput = Schema.Struct({
  ...ScopedInput,
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
})

export const DomainEventEnvelope = Schema.Struct({
  eventId: Schema.String,
  eventType: Schema.String,
  eventVersion: Schema.Int,
  tenantId: Schema.String,
  aggregateType: Schema.String,
  aggregateId: Schema.String,
  correlationId: Schema.String,
  causationId: Schema.NullOr(Schema.String),
  actorPrincipalId: Schema.String,
  occurredAt: Schema.String,
  payload: Schema.Unknown,
})

export const ProcessJobStatus = Schema.Literals([
  "pending",
  "leased",
  "completed",
  "failed",
  "manual_recovery",
])
export const ProcessJob = Schema.Struct({
  jobId: Schema.String,
  tenantId: Schema.String,
  jobType: Schema.String,
  idempotencyKey: Schema.String,
  priority: Schema.Int,
  status: ProcessJobStatus,
  scheduledAt: Schema.String,
  leaseUntil: Schema.NullOr(Schema.String),
  attempts: Schema.Int,
  payload: Schema.Unknown,
  correlationId: Schema.String,
})

export const WorkflowRun = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  workflowType: Schema.Literal(workflowType),
  idempotencyKey: Schema.String,
  aggregateId: Schema.String,
  status: Schema.Literals(["running", "succeeded", "manual_recovery"]),
  recoveryReason: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
})

export const OrderConfirmationResult = Schema.Struct({
  workflowRunId: Schema.String,
  order: SalesOrder,
  reservations: Schema.Array(StockReservation),
  journal: JournalEntry,
  eventId: Schema.String,
  jobId: Schema.String,
})

export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRun>
export type OrderConfirmationResult = Schema.Schema.Type<typeof OrderConfirmationResult>

export class WorkflowRunNotFound
  extends Schema.TaggedErrorClass<WorkflowRunNotFound>()("WorkflowRunNotFound", {
    tenantId: Schema.String,
    idempotencyKey: Schema.String,
  }) {}
export class WorkflowIdempotencyConflict
  extends Schema.TaggedErrorClass<WorkflowIdempotencyConflict>()("WorkflowIdempotencyConflict", {
    tenantId: Schema.String,
    idempotencyKey: Schema.String,
  }) {}
export class WorkflowAlreadyInProgress
  extends Schema.TaggedErrorClass<WorkflowAlreadyInProgress>()("WorkflowAlreadyInProgress", {
    tenantId: Schema.String,
    idempotencyKey: Schema.String,
  }) {}
export class WorkflowManualRecoveryRequired
  extends Schema.TaggedErrorClass<WorkflowManualRecoveryRequired>()(
    "WorkflowManualRecoveryRequired",
    {
      tenantId: Schema.String,
      idempotencyKey: Schema.String,
      reason: Schema.String,
    },
  ) {}
export class WorkflowResultCorrupt
  extends Schema.TaggedErrorClass<WorkflowResultCorrupt>()("WorkflowResultCorrupt", {
    tenantId: Schema.String,
    idempotencyKey: Schema.String,
  }) {}
export class WorkflowOutcomeUnknown
  extends Schema.TaggedErrorClass<WorkflowOutcomeUnknown>()("WorkflowOutcomeUnknown", {
    tenantId: Schema.String,
    idempotencyKey: Schema.String,
  }) {}
export class WorkflowAlreadyCompleted
  extends Schema.TaggedErrorClass<WorkflowAlreadyCompleted>()("WorkflowAlreadyCompleted", {
    tenantId: Schema.String,
    idempotencyKey: Schema.String,
  }) {}

class WorkflowRunAlreadyExists extends Error {}

type OrderConfirmationFailure =
  | AccountingPeriodNotOpen
  | AuthorizationDenied
  | DatabaseFailure
  | JournalIdempotencyConflict
  | RevenuePostingProfileNotFound
  | SalesOrderConfirmationIdempotencyConflict
  | SalesOrderInvalidState
  | SalesOrderNotFound
  | Schema.SchemaError
  | StockReservationIdempotencyConflict
  | StockUnavailable
  | WorkflowAlreadyCompleted
  | WorkflowAlreadyInProgress
  | WorkflowIdempotencyConflict
  | WorkflowManualRecoveryRequired
  | WorkflowOutcomeUnknown
  | WorkflowResultCorrupt
  | WorkflowRunNotFound

export interface ProcessService {
  readonly confirmOrder: (
    input: unknown,
  ) => Effect.Effect<OrderConfirmationResult, OrderConfirmationFailure>
  readonly recoverOrder: (
    input: unknown,
  ) => Effect.Effect<OrderConfirmationResult, OrderConfirmationFailure>
  readonly markManualRecovery: (
    input: unknown,
  ) => Effect.Effect<
    WorkflowRun,
    | AuthorizationDenied
    | DatabaseFailure
    | Schema.SchemaError
    | WorkflowAlreadyCompleted
    | WorkflowRunNotFound
  >
}

export const ProcessService = Context.Service<ProcessService>("EclipseERP/ProcessService")

const workflowRunSelection = {
  id: workflowRuns.id,
  tenantId: workflowRuns.tenantId,
  workflowType: workflowRuns.workflowType,
  idempotencyKey: workflowRuns.idempotencyKey,
  aggregateId: workflowRuns.aggregateId,
  status: workflowRuns.status,
  payload: workflowRuns.payload,
  result: workflowRuns.result,
  recoveryReason: workflowRuns.recoveryReason,
  completedAt: workflowRuns.completedAt,
}

type WorkflowRunRow = {
  readonly id: string
  readonly tenantId: string
  readonly workflowType: string
  readonly idempotencyKey: string
  readonly aggregateId: string
  readonly status: WorkflowRun["status"]
  readonly payload: unknown
  readonly result: unknown
  readonly recoveryReason: string | null
  readonly completedAt: Date | null
}

const toWorkflowRun = (row: WorkflowRunRow): WorkflowRun => ({
  id: row.id,
  tenantId: row.tenantId,
  workflowType,
  idempotencyKey: row.idempotencyKey,
  aggregateId: row.aggregateId,
  status: row.status,
  recoveryReason: row.recoveryReason,
  completedAt: row.completedAt?.toISOString() ?? null,
})

const businessPayload = (input: Schema.Schema.Type<typeof ConfirmOrderConfirmationInput>) => ({
  orderId: input.orderId,
  warehouseId: input.warehouseId,
  legalEntityId: input.legalEntityId,
  idempotencyKey: input.idempotencyKey,
})

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

const payloadMatches = (stored: unknown, current: unknown) =>
  JSON.stringify(canonicalize(stored)) === JSON.stringify(canonicalize(current))

export const makeProcessService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const sales = yield* SalesService
  const inventory = yield* InventoryService
  const accounting = yield* AccountingService
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())

  const resolveExisting = (
    row: WorkflowRunRow,
    input: Schema.Schema.Type<typeof ConfirmOrderConfirmationInput>,
    payload: unknown,
  ): Effect.Effect<OrderConfirmationResult, OrderConfirmationFailure> =>
    Effect.gen(function* () {
      if (!payloadMatches(row.payload, payload)) {
        return yield* Effect.fail(
          new WorkflowIdempotencyConflict({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      if (row.status === "manual_recovery") {
        return yield* Effect.fail(
          new WorkflowManualRecoveryRequired({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
            reason: row.recoveryReason ?? "manual recovery is required",
          }),
        )
      }
      if (row.status !== "succeeded" || row.result === null) {
        return yield* Effect.fail(
          new WorkflowAlreadyInProgress({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      const result = yield* Schema.decodeUnknownEffect(OrderConfirmationResult)(row.result).pipe(
        Effect.mapError(() =>
          new WorkflowResultCorrupt({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          })
        ),
      )
      return result
    })

  const loadExistingAfterConflict = (
    input: Schema.Schema.Type<typeof ConfirmOrderConfirmationInput>,
    payload: unknown,
  ) =>
    Effect.gen(function* () {
      const rows = yield* database.query(
        (db) =>
          db.select(workflowRunSelection)
            .from(workflowRuns)
            .where(
              and(
                eq(workflowRuns.tenantId, input.tenantId),
                eq(workflowRuns.workflowType, workflowType),
                eq(workflowRuns.idempotencyKey, input.idempotencyKey),
              ),
            ),
        "process.workflow.run.lookup",
      )
      const row = rows[0]
      if (row === undefined) {
        return yield* Effect.fail(
          new WorkflowAlreadyInProgress({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      return yield* resolveExisting(row, input, payload)
    })

  const execute = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ConfirmOrderConfirmationInput)(input)
      const payload = businessPayload(decoded)
      const result = yield* database.withTransaction(
        Effect.gen(function* () {
          const existing = yield* database.query(
            (db) =>
              db.select(workflowRunSelection)
                .from(workflowRuns)
                .where(
                  and(
                    eq(workflowRuns.tenantId, decoded.tenantId),
                    eq(workflowRuns.workflowType, workflowType),
                    eq(workflowRuns.idempotencyKey, decoded.idempotencyKey),
                  ),
                ),
            "process.workflow.run.lookup",
          )
          if (existing[0] !== undefined) {
            return yield* resolveExisting(existing[0], decoded, payload)
          }

          const run = yield* database.query(
            (db) =>
              db.insert(workflowRuns).values({
                tenantId: decoded.tenantId,
                workflowType,
                idempotencyKey: decoded.idempotencyKey,
                aggregateId: decoded.orderId,
                payload,
              }).returning({ id: workflowRuns.id }),
            "process.workflow.run.start",
          ).pipe(
            Effect.mapError((error) =>
              isDatabaseConstraint(error, "workflow_runs_tenant_type_key")
                ? new WorkflowRunAlreadyExists()
                : error
            ),
          )

          const order = yield* sales.confirmOrder({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            orderId: decoded.orderId,
            idempotencyKey: decoded.idempotencyKey,
          })
          const reservations = yield* Effect.forEach(
            order.lines,
            (line, index) =>
              inventory.reserveStock({
                principal: decoded.principal,
                tenantId: decoded.tenantId,
                warehouseId: decoded.warehouseId,
                itemId: line.itemId,
                quantity: line.quantity,
                idempotencyKey: `${decoded.idempotencyKey}:line:${index}`,
              }),
          )
          const journal = yield* accounting.postRevenueForOrder({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            orderId: order.id,
            amount: order.total,
          })

          const event = (yield* database.query(
            (db) =>
              db.insert(eventOutbox).values({
                eventType,
                eventVersion: 1,
                tenantId: decoded.tenantId,
                aggregateType: "sales_order",
                aggregateId: order.id,
                correlationId: decoded.idempotencyKey,
                actorPrincipalId: decoded.principal.userAccountId,
                payload: {
                  workflowRunId: run[0]!.id,
                  orderId: order.id,
                  reservationIds: reservations.map((reservation) => reservation.id),
                  journalId: journal.id,
                },
              }).returning({ id: eventOutbox.id }),
            "process.event.append",
          ))[0]!

          const job = (yield* database.query(
            (db) =>
              db.insert(processJobs).values({
                tenantId: decoded.tenantId,
                jobType,
                idempotencyKey: decoded.idempotencyKey,
                priority: 100,
                payload: { eventId: event.id, workflowRunId: run[0]!.id },
                correlationId: decoded.idempotencyKey,
              }).returning({ id: processJobs.id }),
            "process.job.enqueue",
          ))[0]!

          const result: OrderConfirmationResult = {
            workflowRunId: run[0]!.id,
            order,
            reservations,
            journal,
            eventId: event.id,
            jobId: job.id,
          }
          yield* database.query(
            (db) =>
              db.update(workflowRuns)
                .set({
                  status: "succeeded",
                  result,
                  completedAt: now(),
                  updatedAt: now(),
                })
                .where(eq(workflowRuns.id, run[0]!.id)),
            "process.workflow.run.complete",
          )
          return result
        }),
        "process.sales.order.confirmation",
      ).pipe(Effect.result)

      if (Result.isFailure(result)) {
        if (result.failure instanceof WorkflowRunAlreadyExists) {
          return yield* loadExistingAfterConflict(decoded, payload)
        }
        if (result.failure instanceof DatabaseFailure) {
          return yield* Effect.fail(
            new WorkflowOutcomeUnknown({
              tenantId: decoded.tenantId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        return yield* Effect.fail(result.failure)
      }
      return result.success
    })

  const markManualRecovery = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ManualRecoveryInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: ProcessCapabilities.orderConfirmationManualRecovery,
      })
      const result = yield* database.transaction(
        async (tx) => {
          const rows = await tx.select(workflowRunSelection)
            .from(workflowRuns)
            .where(
              and(
                eq(workflowRuns.tenantId, decoded.tenantId),
                eq(workflowRuns.workflowType, workflowType),
                eq(workflowRuns.idempotencyKey, decoded.idempotencyKey),
              ),
            )
            .for("update")
          const row = rows[0]
          if (row === undefined) return { _tag: "not-found" as const }
          if (row.status === "succeeded") return { _tag: "completed" as const }
          const [updated] = await tx.update(workflowRuns)
            .set({ status: "manual_recovery", recoveryReason: decoded.reason, updatedAt: now() })
            .where(eq(workflowRuns.id, row.id))
            .returning(workflowRunSelection)
          return { _tag: "updated" as const, run: toWorkflowRun(updated!) }
        },
        "process.workflow.run.manual-recovery",
      )
      if (result._tag === "not-found") {
        return yield* Effect.fail(
          new WorkflowRunNotFound({
            tenantId: decoded.tenantId,
            idempotencyKey: decoded.idempotencyKey,
          }),
        )
      }
      if (result._tag === "completed") {
        return yield* Effect.fail(
          new WorkflowAlreadyCompleted({
            tenantId: decoded.tenantId,
            idempotencyKey: decoded.idempotencyKey,
          }),
        )
      }
      return result.run
    })

  return {
    confirmOrder: execute,
    recoverOrder: (input: unknown) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(RecoverOrderConfirmationInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcessCapabilities.orderConfirmationRecover,
        })
        return yield* execute(decoded)
      }),
    markManualRecovery,
  } satisfies ProcessService
})
