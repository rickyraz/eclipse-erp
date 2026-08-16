import { and, eq, or } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { processJobs, workflowRuns } from "../../../db/schema/process.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import {
  AccountingPeriodNotOpen,
  AccountingService,
  JournalEntry,
  JournalIdempotencyConflict,
  RevenueJournalNotFound,
  RevenuePostingProfileNotFound,
} from "../../accounting/mod.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"
import { EventEnvelope, EventIdempotencyConflict, MessagingService } from "../../messaging/mod.ts"
import {
  InventoryService,
  StockReservation,
  StockReservationIdempotencyConflict,
  StockReservationInvalidState,
  StockReservationNotFound,
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
import {
  OrderCancellationCompletedEventPayload,
  OrderConfirmationCompletedEventPayload,
  OrderFulfillmentCompletedEventPayload,
  ProcessOrderCancellationCompletedEvent,
  ProcessOrderConfirmationCompletedEvent,
  ProcessOrderFulfillmentCompletedEvent,
} from "./catalog.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PostgresInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(-2_147_483_648),
  Schema.isLessThanOrEqualTo(2_147_483_647),
)
const NonNegativeInt = PostgresInt.check(Schema.isGreaterThanOrEqualTo(0))
const Uuid = EventEnvelope.fields.eventId
const InstantString = EventEnvelope.fields.occurredAt
export const ProcessWorkflowTypes = {
  confirmation: "sales.order.confirmation",
  cancellation: "sales.order.cancellation",
  fulfillment: "sales.order.fulfillment",
} as const
export const ProcessWorkflowType = Schema.Literals([
  ProcessWorkflowTypes.confirmation,
  ProcessWorkflowTypes.cancellation,
  ProcessWorkflowTypes.fulfillment,
])
const workflowType = ProcessWorkflowTypes.confirmation
const cancellationWorkflowType = ProcessWorkflowTypes.cancellation
const fulfillmentWorkflowType = ProcessWorkflowTypes.fulfillment

export const ProcessLifecycleJobPriority = 100
export const ProcessPostCommitJobTypes = {
  confirmation: "process.order_confirmation.post_commit",
  cancellation: "process.order_cancellation.post_commit",
  fulfillment: "process.order_fulfillment.post_commit",
} as const
export const ProcessPostCommitJobType = Schema.Literals([
  ProcessPostCommitJobTypes.confirmation,
  ProcessPostCommitJobTypes.cancellation,
  ProcessPostCommitJobTypes.fulfillment,
])

export const OrderConfirmationPayload = Schema.Struct({
  orderId: Uuid,
  warehouseId: Uuid,
  legalEntityId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  idempotencyKey: NonEmptyString,
})

const ScopedInput = {
  principal: Principal,
  tenantId: Uuid,
}

export const ConfirmOrderConfirmationInput = Schema.Struct({
  ...ScopedInput,
  ...OrderConfirmationPayload.fields,
})
export const RecoverOrderConfirmationInput = ConfirmOrderConfirmationInput

const OrderLifecyclePayloadFields = {
  orderId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  idempotencyKey: NonEmptyString,
}

export const OrderCancellationPayload = Schema.Struct(OrderLifecyclePayloadFields)
export const CancelOrderInput = Schema.Struct({
  ...ScopedInput,
  ...OrderCancellationPayload.fields,
})
export const OrderFulfillmentPayload = Schema.Struct(OrderLifecyclePayloadFields)
export const FulfillOrderInput = Schema.Struct({
  ...ScopedInput,
  ...OrderFulfillmentPayload.fields,
})
export const ManualRecoveryInput = Schema.Struct({
  ...ScopedInput,
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
})

export const DomainEventEnvelope = EventEnvelope
export const ProcessPostCommitJobPayload = Schema.Struct({
  eventId: Uuid,
  workflowRunId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString),
  idempotencyKey: NonEmptyString,
})

export const ProcessJobStatus = Schema.Literals([
  "pending",
  "leased",
  "completed",
  "failed",
  "manual_recovery",
])
export const ProcessJob = Schema.Struct({
  jobId: Uuid,
  tenantId: Uuid,
  jobType: ProcessPostCommitJobType,
  idempotencyKey: NonEmptyString,
  priority: PostgresInt,
  status: ProcessJobStatus,
  scheduledAt: InstantString,
  leaseUntil: Schema.NullOr(InstantString),
  attempts: NonNegativeInt,
  payload: Schema.Json,
  correlationId: NonEmptyString,
})

export const WorkflowRun = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  workflowType: ProcessWorkflowType,
  idempotencyKey: NonEmptyString,
  aggregateId: Uuid,
  status: Schema.Literals(["running", "succeeded", "manual_recovery"]),
  recoveryReason: Schema.NullOr(NonEmptyString),
  completedAt: Schema.NullOr(InstantString),
}).check(Schema.makeFilter(
  (run) =>
    run.status === "running"
      ? run.completedAt === null && run.recoveryReason === null
      : run.status === "succeeded"
      ? run.completedAt !== null && run.recoveryReason === null
      : run.completedAt === null && run.recoveryReason !== null,
  { expected: "workflow status metadata consistent with its durable state" },
))

export const OrderConfirmationResult = Schema.Struct({
  workflowRunId: Uuid,
  order: SalesOrder,
  reservations: Schema.Array(StockReservation),
  journal: JournalEntry,
  eventId: Uuid,
  jobId: Uuid,
})
export const OrderCancellationResult = Schema.Struct({
  workflowRunId: Uuid,
  order: SalesOrder,
  releasedReservations: Schema.Array(StockReservation),
  reversalJournal: JournalEntry,
  eventId: Uuid,
  jobId: Uuid,
})
export const OrderFulfillmentResult = Schema.Struct({
  workflowRunId: Uuid,
  order: SalesOrder,
  fulfilledReservations: Schema.Array(StockReservation),
  eventId: Uuid,
  jobId: Uuid,
})

export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRun>
export type OrderConfirmationResult = Schema.Schema.Type<typeof OrderConfirmationResult>
export type OrderCancellationResult = Schema.Schema.Type<typeof OrderCancellationResult>
export type OrderFulfillmentResult = Schema.Schema.Type<typeof OrderFulfillmentResult>

export class OrderConfirmationNotFound
  extends Schema.TaggedErrorClass<OrderConfirmationNotFound>()("OrderConfirmationNotFound", {
    tenantId: Uuid,
    orderId: Uuid,
  }) {}
export class OrderConfirmationCorrupt
  extends Schema.TaggedErrorClass<OrderConfirmationCorrupt>()("OrderConfirmationCorrupt", {
    tenantId: Uuid,
    orderId: Uuid,
  }) {}
export class WorkflowRunNotFound
  extends Schema.TaggedErrorClass<WorkflowRunNotFound>()("WorkflowRunNotFound", {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  }) {}
export class WorkflowIdempotencyConflict
  extends Schema.TaggedErrorClass<WorkflowIdempotencyConflict>()("WorkflowIdempotencyConflict", {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  }) {}
export class WorkflowAlreadyInProgress
  extends Schema.TaggedErrorClass<WorkflowAlreadyInProgress>()("WorkflowAlreadyInProgress", {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  }) {}
export class WorkflowManualRecoveryRequired
  extends Schema.TaggedErrorClass<WorkflowManualRecoveryRequired>()(
    "WorkflowManualRecoveryRequired",
    {
      tenantId: Uuid,
      idempotencyKey: NonEmptyString,
      reason: NonEmptyString,
    },
  ) {}
export class WorkflowResultCorrupt
  extends Schema.TaggedErrorClass<WorkflowResultCorrupt>()("WorkflowResultCorrupt", {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  }) {}
export class WorkflowOutcomeUnknown
  extends Schema.TaggedErrorClass<WorkflowOutcomeUnknown>()("WorkflowOutcomeUnknown", {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  }) {}
export class WorkflowAlreadyCompleted
  extends Schema.TaggedErrorClass<WorkflowAlreadyCompleted>()("WorkflowAlreadyCompleted", {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  }) {}

class WorkflowRunAlreadyExists extends Error {}

type OrderConfirmationFailure =
  | AccountingPeriodNotOpen
  | AuthorizationDenied
  | DatabaseFailure
  | EventIdempotencyConflict
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

type OrderLifecycleFailure =
  | AccountingPeriodNotOpen
  | AuthorizationDenied
  | DatabaseFailure
  | EventIdempotencyConflict
  | OrderConfirmationCorrupt
  | OrderConfirmationNotFound
  | RevenueJournalNotFound
  | RevenuePostingProfileNotFound
  | SalesOrderInvalidState
  | SalesOrderNotFound
  | Schema.SchemaError
  | StockReservationInvalidState
  | StockReservationNotFound
  | WorkflowAlreadyInProgress
  | WorkflowIdempotencyConflict
  | WorkflowOutcomeUnknown
  | WorkflowResultCorrupt

export interface ProcessService {
  readonly confirmOrder: (
    input: unknown,
  ) => Effect.Effect<OrderConfirmationResult, OrderConfirmationFailure>
  readonly cancelOrder: (
    input: unknown,
  ) => Effect.Effect<OrderCancellationResult, OrderLifecycleFailure>
  readonly fulfillOrder: (
    input: unknown,
  ) => Effect.Effect<OrderFulfillmentResult, OrderLifecycleFailure>
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
  commandId: input.commandId,
  correlationId: input.correlationId,
  causationId: input.causationId,
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

const lifecyclePayload = (
  input:
    | Schema.Schema.Type<typeof CancelOrderInput>
    | Schema.Schema.Type<typeof FulfillOrderInput>,
) => ({
  orderId: input.orderId,
  commandId: input.commandId,
  correlationId: input.correlationId,
  causationId: input.causationId,
  idempotencyKey: input.idempotencyKey,
})

export const makeProcessService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const sales = yield* SalesService
  const inventory = yield* InventoryService
  const accounting = yield* AccountingService
  const messaging = yield* MessagingService
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
      if (result.workflowRunId !== row.id) {
        return yield* Effect.fail(
          new WorkflowResultCorrupt({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      if (
        row.tenantId !== input.tenantId || row.aggregateId !== input.orderId ||
        result.order.id !== input.orderId || result.order.tenantId !== input.tenantId ||
        result.reservations.some((reservation) => reservation.tenantId !== input.tenantId) ||
        result.journal.tenantId !== input.tenantId
      ) {
        return yield* Effect.fail(
          new WorkflowResultCorrupt({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
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

  const loadConfirmation = (tenantId: string, orderId: string) =>
    Effect.gen(function* () {
      const rows = yield* database.query(
        (db) =>
          db.select(workflowRunSelection)
            .from(workflowRuns)
            .where(
              and(
                eq(workflowRuns.tenantId, tenantId),
                eq(workflowRuns.workflowType, workflowType),
                eq(workflowRuns.aggregateId, orderId),
                eq(workflowRuns.status, "succeeded"),
              ),
            )
            .for("update"),
        "process.order-confirmation.lock",
      )
      if (rows.length === 0) {
        return yield* Effect.fail(new OrderConfirmationNotFound({ tenantId, orderId }))
      }
      if (rows.length !== 1) {
        return yield* Effect.fail(new OrderConfirmationCorrupt({ tenantId, orderId }))
      }
      const row = rows[0]!
      const payload = yield* Schema.decodeUnknownEffect(OrderConfirmationPayload)(row.payload).pipe(
        Effect.mapError(() => new OrderConfirmationCorrupt({ tenantId, orderId })),
      )
      const result = yield* Schema.decodeUnknownEffect(OrderConfirmationResult)(row.result).pipe(
        Effect.mapError(() => new OrderConfirmationCorrupt({ tenantId, orderId })),
      )
      if (
        row.tenantId !== tenantId || row.aggregateId !== orderId || payload.orderId !== orderId ||
        result.workflowRunId !== row.id || result.order.id !== orderId ||
        result.order.tenantId !== tenantId ||
        result.reservations.some((reservation) => reservation.tenantId !== tenantId) ||
        result.journal.tenantId !== tenantId
      ) {
        return yield* Effect.fail(new OrderConfirmationCorrupt({ tenantId, orderId }))
      }
      return { payload, result }
    })

  const resolveLifecycleExisting = <A extends { readonly workflowRunId: string }>(
    rows: ReadonlyArray<WorkflowRunRow>,
    input: Schema.Schema.Type<typeof CancelOrderInput>,
    payload: unknown,
    decodeResult: (value: unknown) => Effect.Effect<A, Schema.SchemaError>,
  ): Effect.Effect<
    A | undefined,
    WorkflowAlreadyInProgress | WorkflowIdempotencyConflict | WorkflowResultCorrupt
  > =>
    Effect.gen(function* () {
      if (rows.length === 0) return undefined
      const exact = rows.filter((row) =>
        row.aggregateId === input.orderId && row.idempotencyKey === input.idempotencyKey
      )
      if (rows.length !== 1 || exact.length !== 1 || !payloadMatches(exact[0]!.payload, payload)) {
        return yield* Effect.fail(
          new WorkflowIdempotencyConflict({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      const row = exact[0]!
      if (row.status === "running") {
        return yield* Effect.fail(
          new WorkflowAlreadyInProgress({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      if (row.status !== "succeeded" || row.result === null) {
        return yield* Effect.fail(
          new WorkflowResultCorrupt({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      const result = yield* decodeResult(row.result).pipe(
        Effect.mapError(() =>
          new WorkflowResultCorrupt({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          })
        ),
      )
      if (result.workflowRunId !== row.id) {
        return yield* Effect.fail(
          new WorkflowResultCorrupt({
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      }
      return result
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
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
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
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
          })
          const eventPayload = yield* Schema.decodeUnknownEffect(
            OrderConfirmationCompletedEventPayload,
          )({
            workflowRunId: run[0]!.id,
            orderId: order.id,
            reservationIds: reservations.map((reservation) => reservation.id),
            journalId: journal.id,
          })

          const event = yield* messaging.append({
            eventId: crypto.randomUUID(),
            eventType: ProcessOrderConfirmationCompletedEvent.id,
            eventVersion: ProcessOrderConfirmationCompletedEvent.version,
            tenantId: decoded.tenantId,
            aggregateType: ProcessOrderConfirmationCompletedEvent.aggregateType,
            aggregateId: order.id,
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
            idempotencyKey: decoded.idempotencyKey,
            actorPrincipalId: decoded.principal.userAccountId,
            occurredAt: now().toISOString(),
            payload: eventPayload,
          })

          const jobPayload = yield* Schema.decodeUnknownEffect(ProcessPostCommitJobPayload)({
            eventId: event.eventId,
            workflowRunId: run[0]!.id,
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
            idempotencyKey: decoded.idempotencyKey,
          })
          const job = (yield* database.query(
            (db) =>
              db.insert(processJobs).values({
                tenantId: decoded.tenantId,
                jobType: ProcessPostCommitJobTypes.confirmation,
                idempotencyKey: decoded.idempotencyKey,
                priority: ProcessLifecycleJobPriority,
                payload: jobPayload,
                correlationId: decoded.correlationId,
              }).returning({ id: processJobs.id }),
            "process.job.enqueue",
          ))[0]!

          const result: OrderConfirmationResult = {
            workflowRunId: run[0]!.id,
            order,
            reservations,
            journal,
            eventId: event.eventId,
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

  const cancelOrder = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CancelOrderInput)(input)
      const payload = lifecyclePayload(decoded)
      const outcome = yield* database.withTransaction(
        Effect.gen(function* () {
          const confirmation = yield* loadConfirmation(decoded.tenantId, decoded.orderId)
          const existingRows = yield* database.query(
            (db) =>
              db.select(workflowRunSelection).from(workflowRuns).where(and(
                eq(workflowRuns.tenantId, decoded.tenantId),
                eq(workflowRuns.workflowType, cancellationWorkflowType),
                or(
                  eq(workflowRuns.aggregateId, decoded.orderId),
                  eq(workflowRuns.idempotencyKey, decoded.idempotencyKey),
                ),
              )),
            "process.order-cancellation.lookup",
          )
          const existing = yield* resolveLifecycleExisting(
            existingRows,
            decoded,
            payload,
            Schema.decodeUnknownEffect(OrderCancellationResult),
          )
          if (existing !== undefined) return existing

          const [run] = yield* database.query(
            (db) =>
              db.insert(workflowRuns).values({
                tenantId: decoded.tenantId,
                workflowType: cancellationWorkflowType,
                idempotencyKey: decoded.idempotencyKey,
                aggregateId: decoded.orderId,
                payload,
              }).returning({ id: workflowRuns.id }),
            "process.order-cancellation.start",
          ).pipe(
            Effect.mapError((error) =>
              isDatabaseConstraint(error, "workflow_runs_tenant_type_key")
                ? new WorkflowIdempotencyConflict({
                  tenantId: decoded.tenantId,
                  idempotencyKey: decoded.idempotencyKey,
                })
                : error
            ),
          )

          const order = yield* sales.cancelOrder({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            orderId: decoded.orderId,
          })
          const releasedReservations = yield* Effect.forEach(
            confirmation.result.reservations.toSorted((a, b) => a.id.localeCompare(b.id)),
            (reservation) =>
              inventory.releaseReservation({
                principal: decoded.principal,
                tenantId: decoded.tenantId,
                reservationId: reservation.id,
              }),
          )
          const reversalJournal = yield* accounting.reverseRevenueForOrder({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            legalEntityId: confirmation.payload.legalEntityId,
            orderId: decoded.orderId,
          })
          const eventPayload = yield* Schema.decodeUnknownEffect(
            OrderCancellationCompletedEventPayload,
          )({
            workflowRunId: run!.id,
            confirmationWorkflowRunId: confirmation.result.workflowRunId,
            orderId: decoded.orderId,
            reservationIds: releasedReservations.map(({ id }) => id),
            reversalJournalId: reversalJournal.id,
          })
          const event = yield* messaging.append({
            eventId: crypto.randomUUID(),
            eventType: ProcessOrderCancellationCompletedEvent.id,
            eventVersion: ProcessOrderCancellationCompletedEvent.version,
            tenantId: decoded.tenantId,
            aggregateType: ProcessOrderCancellationCompletedEvent.aggregateType,
            aggregateId: decoded.orderId,
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
            idempotencyKey: decoded.idempotencyKey,
            actorPrincipalId: decoded.principal.userAccountId,
            occurredAt: now().toISOString(),
            payload: eventPayload,
          })
          const jobPayload = yield* Schema.decodeUnknownEffect(ProcessPostCommitJobPayload)({
            eventId: event.eventId,
            workflowRunId: run!.id,
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
            idempotencyKey: decoded.idempotencyKey,
          })
          const [job] = yield* database.query(
            (db) =>
              db.insert(processJobs).values({
                tenantId: decoded.tenantId,
                jobType: ProcessPostCommitJobTypes.cancellation,
                idempotencyKey: decoded.idempotencyKey,
                priority: ProcessLifecycleJobPriority,
                payload: jobPayload,
                correlationId: decoded.correlationId,
              }).returning({ id: processJobs.id }),
            "process.order-cancellation.job.enqueue",
          )
          const result: OrderCancellationResult = {
            workflowRunId: run!.id,
            order,
            releasedReservations,
            reversalJournal,
            eventId: event.eventId,
            jobId: job!.id,
          }
          yield* database.query(
            (db) =>
              db.update(workflowRuns).set({
                status: "succeeded",
                result,
                completedAt: now(),
                updatedAt: now(),
              }).where(eq(workflowRuns.id, run!.id)),
            "process.order-cancellation.complete",
          )
          return result
        }),
        "process.sales.order.cancellation",
      ).pipe(Effect.result)

      if (Result.isFailure(outcome)) {
        if (outcome.failure instanceof DatabaseFailure) {
          return yield* Effect.fail(
            new WorkflowOutcomeUnknown({
              tenantId: decoded.tenantId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        return yield* Effect.fail(outcome.failure)
      }
      return outcome.success
    })

  const fulfillOrder = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(FulfillOrderInput)(input)
      const payload = lifecyclePayload(decoded)
      const outcome = yield* database.withTransaction(
        Effect.gen(function* () {
          const confirmation = yield* loadConfirmation(decoded.tenantId, decoded.orderId)
          const existingRows = yield* database.query(
            (db) =>
              db.select(workflowRunSelection).from(workflowRuns).where(and(
                eq(workflowRuns.tenantId, decoded.tenantId),
                eq(workflowRuns.workflowType, fulfillmentWorkflowType),
                or(
                  eq(workflowRuns.aggregateId, decoded.orderId),
                  eq(workflowRuns.idempotencyKey, decoded.idempotencyKey),
                ),
              )),
            "process.order-fulfillment.lookup",
          )
          const existing = yield* resolveLifecycleExisting(
            existingRows,
            decoded,
            payload,
            Schema.decodeUnknownEffect(OrderFulfillmentResult),
          )
          if (existing !== undefined) return existing

          const [run] = yield* database.query(
            (db) =>
              db.insert(workflowRuns).values({
                tenantId: decoded.tenantId,
                workflowType: fulfillmentWorkflowType,
                idempotencyKey: decoded.idempotencyKey,
                aggregateId: decoded.orderId,
                payload,
              }).returning({ id: workflowRuns.id }),
            "process.order-fulfillment.start",
          ).pipe(
            Effect.mapError((error) =>
              isDatabaseConstraint(error, "workflow_runs_tenant_type_key")
                ? new WorkflowIdempotencyConflict({
                  tenantId: decoded.tenantId,
                  idempotencyKey: decoded.idempotencyKey,
                })
                : error
            ),
          )

          const fulfilledReservations = yield* Effect.forEach(
            confirmation.result.reservations.toSorted((a, b) => a.id.localeCompare(b.id)),
            (reservation) =>
              inventory.fulfillReservation({
                principal: decoded.principal,
                tenantId: decoded.tenantId,
                reservationId: reservation.id,
              }),
          )
          const eventPayload = yield* Schema.decodeUnknownEffect(
            OrderFulfillmentCompletedEventPayload,
          )({
            workflowRunId: run!.id,
            confirmationWorkflowRunId: confirmation.result.workflowRunId,
            orderId: decoded.orderId,
            reservationIds: fulfilledReservations.map(({ id }) => id),
          })
          const event = yield* messaging.append({
            eventId: crypto.randomUUID(),
            eventType: ProcessOrderFulfillmentCompletedEvent.id,
            eventVersion: ProcessOrderFulfillmentCompletedEvent.version,
            tenantId: decoded.tenantId,
            aggregateType: ProcessOrderFulfillmentCompletedEvent.aggregateType,
            aggregateId: decoded.orderId,
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
            idempotencyKey: decoded.idempotencyKey,
            actorPrincipalId: decoded.principal.userAccountId,
            occurredAt: now().toISOString(),
            payload: eventPayload,
          })
          const jobPayload = yield* Schema.decodeUnknownEffect(ProcessPostCommitJobPayload)({
            eventId: event.eventId,
            workflowRunId: run!.id,
            commandId: decoded.commandId,
            correlationId: decoded.correlationId,
            causationId: decoded.causationId,
            idempotencyKey: decoded.idempotencyKey,
          })
          const [job] = yield* database.query(
            (db) =>
              db.insert(processJobs).values({
                tenantId: decoded.tenantId,
                jobType: ProcessPostCommitJobTypes.fulfillment,
                idempotencyKey: decoded.idempotencyKey,
                priority: ProcessLifecycleJobPriority,
                payload: jobPayload,
                correlationId: decoded.correlationId,
              }).returning({ id: processJobs.id }),
            "process.order-fulfillment.job.enqueue",
          )
          const result: OrderFulfillmentResult = {
            workflowRunId: run!.id,
            order: confirmation.result.order,
            fulfilledReservations,
            eventId: event.eventId,
            jobId: job!.id,
          }
          yield* database.query(
            (db) =>
              db.update(workflowRuns).set({
                status: "succeeded",
                result,
                completedAt: now(),
                updatedAt: now(),
              }).where(eq(workflowRuns.id, run!.id)),
            "process.order-fulfillment.complete",
          )
          return result
        }),
        "process.sales.order.fulfillment",
      ).pipe(Effect.result)

      if (Result.isFailure(outcome)) {
        if (outcome.failure instanceof DatabaseFailure) {
          return yield* Effect.fail(
            new WorkflowOutcomeUnknown({
              tenantId: decoded.tenantId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        return yield* Effect.fail(outcome.failure)
      }
      return outcome.success
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
    cancelOrder,
    fulfillOrder,
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
