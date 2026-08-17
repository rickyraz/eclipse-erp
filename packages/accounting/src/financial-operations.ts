import { and, eq, gte, inArray, lte } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  accountingPeriods,
  accounts,
  financialOperations,
  financialOperationTransfers,
  journalEntries,
  journalLines,
  legalEntityAccountingConfigurations,
  revenuePostingProfiles,
} from "../../../db/schema/accounting.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { Principal } from "../../auth/mod.ts"
import {
  Database,
  DatabaseFailure,
  DurableJobEnqueuer,
  isDatabaseConstraint,
} from "../../kernel/mod.ts"
import { EventIdempotencyConflict, MessagingService } from "../../messaging/mod.ts"
import { SalesOrderInvalidState, SalesOrderNotFound, SalesService } from "../../sales/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import { type FinancialExecutionOutcome, FinancialLedgerPort } from "./financial-ledger.ts"
import { AccountingFinancialOperationReconciledEvent } from "./events.ts"
import {
  AccountingPeriodNotOpen,
  AccountNotFound,
  InvalidJournalLine,
  JournalIdempotencyConflict,
  JournalReferenceAlreadyExists,
  RevenuePostingProfileNotFound,
  UnbalancedJournal,
} from "./service.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Uuid = Schema.String.check(Schema.isUUID())
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const Money = Schema.String.check(Schema.isPattern(/^\d{1,12}(\.\d{1,2})?$/))
const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))

export const FinancialOperationStatus = Schema.Literals([
  "intent",
  "submitted",
  "accepted",
  "rejected",
  "unknown",
  "manual_recovery",
  "reconciled",
])
export type FinancialOperationStatus = Schema.Schema.Type<typeof FinancialOperationStatus>

export const FinancialOperation = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  periodId: Uuid,
  operationId: NonEmptyString,
  operationType: Schema.Literals(["journal_post", "journal_reverse", "revenue_post"]),
  engine: Schema.Literals(["postgresql", "tigerbeetle"]),
  engineVerified: Schema.Boolean,
  journalId: Uuid,
  sourceJournalId: Schema.NullOr(Uuid),
  reference: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInt,
  status: FinancialOperationStatus,
  attempts: Schema.Int,
  scheduledAt: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
  engineAcceptedAt: Schema.NullOr(NonEmptyString),
  rejectionReason: Schema.NullOr(NonEmptyString),
  recoveryReason: Schema.NullOr(NonEmptyString),
  observedEngine: Schema.NullOr(Schema.Literals(["postgresql", "tigerbeetle"])),
  lastError: Schema.NullOr(NonEmptyString),
  reconciledAt: Schema.NullOr(Schema.String),
})
export type FinancialOperation = Schema.Schema.Type<typeof FinancialOperation>

export const FinancialOperationJournalLine = Schema.Struct({
  accountId: Uuid,
  debit: Money,
  credit: Money,
})

export const CreateFinancialJournalIntentInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
  operationId: NonEmptyString,
  reference: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInt,
  operationType: Schema.Literals(["journal_post", "journal_reverse"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("journal_post" as const)),
  ),
  sourceJournalId: Schema.NullOr(Uuid).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  lines: Schema.Array(FinancialOperationJournalLine),
  correlationId: NonEmptyString,
})

export const CreateFinancialRevenueIntentInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
  orderId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  currency: CurrencyCode,
  mappingVersion: PositiveInt,
  amount: Schema.optionalKey(Money),
})

export const CreateFinancialReversalIntentInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
  sourceJournalId: Uuid,
  operationId: NonEmptyString,
  reference: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInt,
  correlationId: NonEmptyString,
})

export const FinancialOperationCommandInput = Schema.Struct({
  tenantId: Uuid,
  operationId: NonEmptyString,
})

export const FinancialOperationJobPayload = Schema.Struct({
  tenantId: Uuid,
  operationId: NonEmptyString,
})

export type CreateFinancialJournalIntentInput = Schema.Schema.Type<
  typeof CreateFinancialJournalIntentInput
>
export type CreateFinancialRevenueIntentInput = Schema.Schema.Type<
  typeof CreateFinancialRevenueIntentInput
>
export type CreateFinancialReversalIntentInput = Schema.Schema.Type<
  typeof CreateFinancialReversalIntentInput
>
export type FinancialOperationCommandInput = Schema.Schema.Type<
  typeof FinancialOperationCommandInput
>
export type FinancialOperationJobPayload = Schema.Schema.Type<typeof FinancialOperationJobPayload>

export class FinancialOperationNotFound
  extends Schema.TaggedErrorClass<FinancialOperationNotFound>()("FinancialOperationNotFound", {
    tenantId: Uuid,
    operationId: NonEmptyString,
  }) {}

export class FinancialOperationConflict
  extends Schema.TaggedErrorClass<FinancialOperationConflict>()("FinancialOperationConflict", {
    tenantId: Uuid,
    operationId: NonEmptyString,
  }) {}

export class FinancialLedgerNotConfigured
  extends Schema.TaggedErrorClass<FinancialLedgerNotConfigured>()(
    "FinancialLedgerNotConfigured",
    {},
  ) {}

export class FinancialLedgerNotActivated
  extends Schema.TaggedErrorClass<FinancialLedgerNotActivated>()(
    "FinancialLedgerNotActivated",
    { tenantId: Uuid, legalEntityId: Uuid },
  ) {}

export class FinancialSalesNotConfigured
  extends Schema.TaggedErrorClass<FinancialSalesNotConfigured>()(
    "FinancialSalesNotConfigured",
    {},
  ) {}

export class FinancialRevenueAmountMismatch
  extends Schema.TaggedErrorClass<FinancialRevenueAmountMismatch>()(
    "FinancialRevenueAmountMismatch",
    { tenantId: Uuid, orderId: Uuid },
  ) {}

export class FinancialOperationReconciliationConflict
  extends Schema.TaggedErrorClass<FinancialOperationReconciliationConflict>()(
    "FinancialOperationReconciliationConflict",
    { operationId: NonEmptyString },
  ) {}

export class FinancialReversalSourceRequired
  extends Schema.TaggedErrorClass<FinancialReversalSourceRequired>()(
    "FinancialReversalSourceRequired",
    {},
  ) {}

export class FinancialReversalSourceNotFound
  extends Schema.TaggedErrorClass<FinancialReversalSourceNotFound>()(
    "FinancialReversalSourceNotFound",
    { tenantId: Uuid, sourceJournalId: Uuid },
  ) {}

export class FinancialReversalSourceNotPosted
  extends Schema.TaggedErrorClass<FinancialReversalSourceNotPosted>()(
    "FinancialReversalSourceNotPosted",
    { tenantId: Uuid, sourceJournalId: Uuid },
  ) {}

export class FinancialReversalSourceNotReady
  extends Schema.TaggedErrorClass<FinancialReversalSourceNotReady>()(
    "FinancialReversalSourceNotReady",
    { tenantId: Uuid, sourceJournalId: Uuid },
  ) {}

export class FinancialReversalAlreadyExists
  extends Schema.TaggedErrorClass<FinancialReversalAlreadyExists>()(
    "FinancialReversalAlreadyExists",
    { tenantId: Uuid, sourceJournalId: Uuid },
  ) {}

export class FinancialCurrencyMismatch extends Schema.TaggedErrorClass<FinancialCurrencyMismatch>()(
  "FinancialCurrencyMismatch",
  { tenantId: Uuid, legalEntityId: Uuid },
) {}

export interface FinancialOperationService {
  readonly createJournalIntent: (
    input: unknown,
  ) => Effect.Effect<
    FinancialOperation,
    | AuthorizationDenied
    | AccountingPeriodNotOpen
    | AccountNotFound
    | FinancialOperationConflict
    | FinancialLedgerNotActivated
    | FinancialReversalSourceRequired
    | FinancialReversalSourceNotFound
    | FinancialReversalSourceNotPosted
    | FinancialReversalSourceNotReady
    | FinancialReversalAlreadyExists
    | FinancialCurrencyMismatch
    | InvalidJournalLine
    | JournalIdempotencyConflict
    | JournalReferenceAlreadyExists
    | UnbalancedJournal
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly createRevenueIntent: (
    input: unknown,
  ) => Effect.Effect<
    FinancialOperation,
    | AuthorizationDenied
    | AccountingPeriodNotOpen
    | AccountNotFound
    | FinancialOperationConflict
    | FinancialLedgerNotActivated
    | FinancialReversalSourceRequired
    | FinancialReversalSourceNotFound
    | FinancialReversalSourceNotPosted
    | FinancialReversalSourceNotReady
    | FinancialReversalAlreadyExists
    | FinancialCurrencyMismatch
    | FinancialSalesNotConfigured
    | FinancialRevenueAmountMismatch
    | InvalidJournalLine
    | JournalIdempotencyConflict
    | JournalReferenceAlreadyExists
    | RevenuePostingProfileNotFound
    | SalesOrderInvalidState
    | SalesOrderNotFound
    | UnbalancedJournal
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly createReversalIntent: (
    input: unknown,
  ) => Effect.Effect<
    FinancialOperation,
    | AuthorizationDenied
    | AccountingPeriodNotOpen
    | AccountNotFound
    | FinancialOperationConflict
    | FinancialLedgerNotActivated
    | FinancialReversalSourceRequired
    | FinancialReversalSourceNotFound
    | FinancialReversalSourceNotPosted
    | FinancialReversalSourceNotReady
    | FinancialReversalAlreadyExists
    | FinancialCurrencyMismatch
    | InvalidJournalLine
    | JournalIdempotencyConflict
    | JournalReferenceAlreadyExists
    | UnbalancedJournal
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly submitFinancialOperation: (
    input: unknown,
  ) => Effect.Effect<
    FinancialOperation,
    | AuthorizationDenied
    | EventIdempotencyConflict
    | FinancialLedgerNotConfigured
    | FinancialLedgerNotActivated
    | FinancialOperationNotFound
    | FinancialOperationReconciliationConflict
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly reconcileFinancialOperation: (
    input: unknown,
  ) => Effect.Effect<
    FinancialOperation,
    | AuthorizationDenied
    | EventIdempotencyConflict
    | FinancialLedgerNotConfigured
    | FinancialLedgerNotActivated
    | FinancialOperationNotFound
    | FinancialOperationReconciliationConflict
    | DatabaseFailure
    | Schema.SchemaError
  >
}

export const FinancialOperationService = Context.Service<FinancialOperationService>(
  "EclipseERP/Accounting/FinancialOperationService",
)

const operationSelection = {
  id: financialOperations.id,
  tenantId: financialOperations.tenantId,
  legalEntityId: financialOperations.legalEntityId,
  periodId: financialOperations.periodId,
  operationId: financialOperations.operationId,
  operationType: financialOperations.operationType,
  engine: financialOperations.engine,
  engineVerified: financialOperations.engineVerified,
  journalId: financialOperations.journalId,
  sourceJournalId: financialOperations.sourceJournalId,
  reference: financialOperations.reference,
  currency: financialOperations.currency,
  mappingVersion: financialOperations.mappingVersion,
  requestFingerprint: financialOperations.requestFingerprint,
  actorPrincipalId: financialOperations.actorPrincipalId,
  actorSessionId: financialOperations.actorSessionId,
  status: financialOperations.status,
  attempts: financialOperations.attempts,
  scheduledAt: financialOperations.scheduledAt,
  submittedAt: financialOperations.submittedAt,
  engineAcceptedAt: financialOperations.engineAcceptedAt,
  rejectionReason: financialOperations.rejectionReason,
  recoveryReason: financialOperations.recoveryReason,
  observedEngine: financialOperations.observedEngine,
  lastError: financialOperations.lastError,
  reconciledAt: financialOperations.reconciledAt,
}

const toOperation = (
  row: typeof operationSelection extends never ? never : {
    readonly id: string
    readonly tenantId: string
    readonly legalEntityId: string
    readonly periodId: string
    readonly operationId: string
    readonly operationType: "journal_post" | "journal_reverse" | "revenue_post"
    readonly engine: "postgresql" | "tigerbeetle"
    readonly engineVerified: boolean
    readonly journalId: string
    readonly sourceJournalId: string | null
    readonly reference: string
    readonly currency: string
    readonly mappingVersion: number
    readonly requestFingerprint: string
    readonly actorPrincipalId: string
    readonly actorSessionId: string
    readonly status: FinancialOperationStatus
    readonly attempts: number
    readonly scheduledAt: Date
    readonly submittedAt: Date | null
    readonly engineAcceptedAt: string | null
    readonly rejectionReason: string | null
    readonly recoveryReason: string | null
    readonly observedEngine: "postgresql" | "tigerbeetle" | null
    readonly lastError: string | null
    readonly reconciledAt: Date | null
  },
): FinancialOperation => ({
  id: row.id,
  tenantId: row.tenantId,
  legalEntityId: row.legalEntityId,
  periodId: row.periodId,
  operationId: row.operationId,
  operationType: row.operationType,
  engine: row.engine,
  engineVerified: row.engineVerified,
  journalId: row.journalId,
  sourceJournalId: row.sourceJournalId,
  reference: row.reference,
  currency: row.currency,
  mappingVersion: row.mappingVersion,
  status: row.status,
  attempts: row.attempts,
  scheduledAt: row.scheduledAt.toISOString(),
  submittedAt: row.submittedAt?.toISOString() ?? null,
  engineAcceptedAt: row.engineAcceptedAt,
  rejectionReason: row.rejectionReason,
  recoveryReason: row.recoveryReason,
  observedEngine: row.observedEngine,
  lastError: row.lastError,
  reconciledAt: row.reconciledAt?.toISOString() ?? null,
})

const toMinor = (value: string): string => {
  const [whole, fraction = ""] = value.split(".")
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))).toString()
}

type FinancialIntentFingerprintInput =
  & Omit<
    CreateFinancialJournalIntentInput,
    "operationType"
  >
  & { operationType: "journal_post" | "journal_reverse" | "revenue_post" }

const fingerprint = (input: FinancialIntentFingerprintInput): string =>
  JSON.stringify({
    legalEntityId: input.legalEntityId,
    operationId: input.operationId,
    operationType: input.operationType,
    sourceJournalId: input.sourceJournalId,
    reference: input.reference.trim(),
    currency: input.currency,
    mappingVersion: input.mappingVersion,
    lines: input.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
    })),
  })

const validateLines = (
  lines: readonly CreateFinancialJournalIntentInput["lines"][number][],
): Effect.Effect<void, InvalidJournalLine | UnbalancedJournal> =>
  Effect.gen(function* () {
    if (lines.length === 0) {
      return yield* Effect.fail(new UnbalancedJournal({ debit: "0", credit: "0" }))
    }
    let debit = 0n
    let credit = 0n
    for (const line of lines) {
      const debitMinor = BigInt(toMinor(line.debit))
      const creditMinor = BigInt(toMinor(line.credit))
      if ((debitMinor > 0n) === (creditMinor > 0n)) {
        return yield* Effect.fail(new InvalidJournalLine({ index: lines.indexOf(line) }))
      }
      debit += debitMinor
      credit += creditMinor
    }
    if (debit !== credit) {
      return yield* Effect.fail(
        new UnbalancedJournal({
          debit: debit.toString(),
          credit: credit.toString(),
        }),
      )
    }
  })

const pairTransfers = (
  lines: readonly CreateFinancialJournalIntentInput["lines"][number][],
): Array<{
  position: number
  debitAccountId: string
  creditAccountId: string
  amountMinor: string
}> => {
  const debits = lines.flatMap((line) =>
    BigInt(toMinor(line.debit)) > 0n
      ? [{ accountId: line.accountId, amount: BigInt(toMinor(line.debit)) }]
      : []
  )
  const credits = lines.flatMap((line) =>
    BigInt(toMinor(line.credit)) > 0n
      ? [{ accountId: line.accountId, amount: BigInt(toMinor(line.credit)) }]
      : []
  )
  const result: Array<{
    position: number
    debitAccountId: string
    creditAccountId: string
    amountMinor: string
  }> = []
  let debitIndex = 0
  let creditIndex = 0
  let debitRemaining = debits[0]?.amount ?? 0n
  let creditRemaining = credits[0]?.amount ?? 0n
  while (debitIndex < debits.length && creditIndex < credits.length) {
    const amount = debitRemaining < creditRemaining ? debitRemaining : creditRemaining
    result.push({
      position: result.length,
      debitAccountId: debits[debitIndex]!.accountId,
      creditAccountId: credits[creditIndex]!.accountId,
      amountMinor: amount.toString(),
    })
    debitRemaining -= amount
    creditRemaining -= amount
    if (debitRemaining === 0n) {
      debitIndex += 1
      debitRemaining = debits[debitIndex]?.amount ?? 0n
    }
    if (creditRemaining === 0n) {
      creditIndex += 1
      creditRemaining = credits[creditIndex]?.amount ?? 0n
    }
  }
  return result
}

const submitJobType = "accounting.financial_operation.submit"
const reconcileJobType = "accounting.financial_operation.reconcile"
const currentTime = () => new Date(Date.now())

export const makeFinancialOperationService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const ledgerOption = yield* Effect.serviceOption(FinancialLedgerPort)
  const salesOption = yield* Effect.serviceOption(SalesService)
  const jobs = yield* DurableJobEnqueuer
  const messaging = yield* MessagingService

  const loadOperation = (tenantId: string, operationId: string, lock = false) =>
    database.query(
      (db) => {
        const query = db.select(operationSelection).from(financialOperations).where(
          and(
            eq(financialOperations.tenantId, tenantId),
            eq(financialOperations.operationId, operationId),
          ),
        )
        return lock ? query.for("update") : query
      },
      "accounting.financial_operation.get",
    )

  const loadOperationOrFail = (tenantId: string, operationId: string, lock = false) =>
    Effect.gen(function* () {
      const [row] = yield* loadOperation(tenantId, operationId, lock)
      if (row === undefined) {
        return yield* Effect.fail(new FinancialOperationNotFound({ tenantId, operationId }))
      }
      return row
    })

  const finalizeAccepted = (operationId: string, tenantId: string) =>
    database.withTransaction(
      Effect.gen(function* () {
        const now = currentTime()
        const current = yield* loadOperationOrFail(tenantId, operationId, true)
        if (current.status !== "accepted") return current
        const [updated] = yield* database.query(
          (db) =>
            db.update(financialOperations).set({
              status: "reconciled",
              reconciledAt: now,
              rejectionReason: null,
              recoveryReason: null,
              lastError: null,
              updatedAt: now,
            }).where(
              and(
                eq(financialOperations.tenantId, tenantId),
                eq(financialOperations.id, current.id),
              ),
            ).returning(operationSelection),
          "accounting.financial_operation.finalize.status",
        )
        yield* database.query(
          (db) =>
            db.update(journalEntries).set({
              status: current.operationType === "journal_reverse" ? "reversed" : "posted",
              reversesEntryId: current.operationType === "journal_reverse"
                ? current.sourceJournalId
                : null,
              postedAt: now,
              updatedAt: now,
            }).where(
              and(
                eq(journalEntries.tenantId, tenantId),
                eq(journalEntries.id, current.journalId),
              ),
            ),
          "accounting.financial_operation.finalize.journal",
        )
        yield* database.query(
          (db) =>
            db.update(financialOperationTransfers).set({
              status: "accepted",
              observedTimestamp: current.engineAcceptedAt,
              updatedAt: now,
            }).where(
              and(
                eq(financialOperationTransfers.tenantId, tenantId),
                eq(financialOperationTransfers.operationId, current.id),
              ),
            ),
          "accounting.financial_operation.finalize.transfers",
        )
        yield* messaging.append({
          tenantId,
          eventId: current.id,
          eventType: AccountingFinancialOperationReconciledEvent.id,
          eventVersion: AccountingFinancialOperationReconciledEvent.version,
          aggregateType: AccountingFinancialOperationReconciledEvent.aggregateType,
          aggregateId: current.id,
          commandId: operationId,
          correlationId: operationId,
          causationId: operationId,
          idempotencyKey: operationId,
          actorPrincipalId: current.actorPrincipalId,
          occurredAt: now.toISOString(),
          payload: {
            operationId,
            journalId: current.journalId,
            mappingVersion: current.mappingVersion,
          },
        })
        return updated!
      }),
      "accounting.financial_operation.finalize",
    )

  const writeReceipt = (
    operationId: string,
    tenantId: string,
    outcome: FinancialExecutionOutcome,
    observedEngine: "postgresql" | "tigerbeetle" | null = null,
  ) =>
    Effect.gen(function* () {
      const now = currentTime()
      const receipt = yield* database.withTransaction(
        Effect.gen(function* () {
          const current = yield* loadOperationOrFail(tenantId, operationId, true)
          if (current.status === "reconciled") return current
          if (current.status === "accepted" && outcome._tag !== "accepted") {
            return yield* Effect.fail(
              new FinancialOperationReconciliationConflict({ operationId }),
            )
          }

          if (outcome._tag === "accepted") {
            const expectedTransfers = yield* database.query(
              (db) =>
                db.select({
                  position: financialOperationTransfers.position,
                  engineTransferId: financialOperationTransfers.engineTransferId,
                }).from(financialOperationTransfers).where(
                  and(
                    eq(financialOperationTransfers.tenantId, tenantId),
                    eq(financialOperationTransfers.operationId, current.id),
                  ),
                ),
              "accounting.financial_operation.receipt.transfers",
            )
            expectedTransfers.sort((left, right) => left.position - right.position)
            const transferIds = outcome.transferIds
            const transferIdsUnique = new Set(transferIds).size === transferIds.length
            const mappingMatches = outcome.mappingVersion === current.mappingVersion &&
              outcome.transferCount === expectedTransfers.length &&
              transferIds.length === expectedTransfers.length &&
              transferIdsUnique &&
              expectedTransfers.every((transfer) =>
                transferIds[transfer.position] !== undefined &&
                (transfer.engineTransferId === null ||
                  transfer.engineTransferId === transferIds[transfer.position])
              )
            if (!mappingMatches) {
              const [updated] = yield* database.query(
                (db) =>
                  db.update(financialOperations).set({
                    status: "manual_recovery",
                    engineAcceptedAt: outcome.acceptedAt,
                    rejectionReason: null,
                    recoveryReason: "mapping_mismatch",
                    observedEngine: null,
                    lastError: "transfer_projection_mismatch",
                    reconciledAt: null,
                    updatedAt: now,
                  }).where(
                    and(
                      eq(financialOperations.tenantId, tenantId),
                      eq(financialOperations.id, current.id),
                    ),
                  ).returning(operationSelection),
                "accounting.financial_operation.receipt.mapping_mismatch",
              )
              yield* database.query(
                (db) =>
                  db.update(financialOperationTransfers).set({
                    status: "manual_recovery",
                    updatedAt: now,
                  }).where(
                    and(
                      eq(financialOperationTransfers.tenantId, tenantId),
                      eq(financialOperationTransfers.operationId, current.id),
                    ),
                  ),
                "accounting.financial_operation.projection.mapping_mismatch",
              )
              return updated!
            }
            const [updated] = yield* database.query(
              (db) =>
                db.update(financialOperations).set({
                  status: "accepted",
                  engineAcceptedAt: outcome.acceptedAt,
                  reconciledAt: null,
                  rejectionReason: null,
                  recoveryReason: null,
                  observedEngine: null,
                  lastError: null,
                  updatedAt: now,
                }).where(
                  and(
                    eq(financialOperations.tenantId, tenantId),
                    eq(financialOperations.id, current.id),
                  ),
                ).returning(operationSelection),
              "accounting.financial_operation.receipt.accepted",
            )
            for (const transfer of expectedTransfers) {
              yield* database.query(
                (db) =>
                  db.update(financialOperationTransfers).set({
                    engineTransferId: outcome.transferIds[transfer.position],
                    updatedAt: now,
                  }).where(
                    and(
                      eq(financialOperationTransfers.tenantId, tenantId),
                      eq(financialOperationTransfers.operationId, current.id),
                      eq(financialOperationTransfers.position, transfer.position),
                    ),
                  ),
                "accounting.financial_operation.projection.transfer_identity",
              )
            }
            return updated!
          }

          const status = outcome._tag === "rejected"
            ? "rejected" as const
            : outcome._tag === "manual_recovery"
            ? "manual_recovery" as const
            : "unknown" as const
          const [updated] = yield* database.query(
            (db) =>
              db.update(financialOperations).set({
                status,
                engineAcceptedAt: null,
                rejectionReason: outcome._tag === "rejected" ? outcome.reason : null,
                recoveryReason: outcome._tag === "manual_recovery" ? outcome.reason : null,
                observedEngine: outcome._tag === "manual_recovery" ? observedEngine : null,
                lastError: outcome._tag === "unknown" ? outcome.reason : null,
                scheduledAt: outcome._tag === "unknown" ? new Date(now.getTime() + 5_000) : now,
                updatedAt: now,
              }).where(
                and(
                  eq(financialOperations.tenantId, tenantId),
                  eq(financialOperations.id, current.id),
                ),
              ).returning(operationSelection),
            "accounting.financial_operation.receipt.nonaccepted",
          )
          yield* database.query(
            (db) =>
              db.update(financialOperationTransfers).set({
                status: status === "unknown" ? "unresolved" : status,
                updatedAt: now,
              }).where(
                and(
                  eq(financialOperationTransfers.tenantId, tenantId),
                  eq(financialOperationTransfers.operationId, current.id),
                ),
              ),
            "accounting.financial_operation.projection.nonaccepted",
          )
          if (status === "unknown") {
            yield* jobs.enqueue({
              tenantId,
              jobType: reconcileJobType,
              idempotencyKey: `${operationId}:reconcile`,
              priority: 90,
              payload: { tenantId, operationId },
              correlationId: operationId,
            })
          }
          return updated!
        }),
        "accounting.financial_operation.receipt",
      )
      if (outcome._tag === "accepted" && receipt.status === "accepted") {
        return yield* finalizeAccepted(operationId, tenantId)
      }
      return receipt
    })

  const submit = (input: unknown, jobType: string) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(FinancialOperationCommandInput)(input)
      const operation = yield* loadOperationOrFail(decoded.tenantId, decoded.operationId)
      const reconcileRequested = jobType === reconcileJobType
      if (
        operation.status === "reconciled" || operation.status === "rejected" ||
        operation.status === "manual_recovery"
      ) return toOperation(operation)
      if (Option.isNone(ledgerOption)) {
        return yield* Effect.fail(new FinancialLedgerNotConfigured({}))
      }

      const authorizationResult = yield* authorization.authorize({
        principal: {
          userAccountId: operation.actorPrincipalId,
          sessionId: operation.actorSessionId,
        },
        tenantId: decoded.tenantId,
        capability: operation.operationType === "revenue_post"
          ? AccountingCapabilities.revenuePost
          : AccountingCapabilities.journalPost,
      }).pipe(Effect.result)
      if (Result.isFailure(authorizationResult)) {
        if (authorizationResult.failure instanceof AuthorizationDenied) {
          return toOperation(
            yield* writeReceipt(decoded.operationId, decoded.tenantId, {
              _tag: "manual_recovery",
              operationId: decoded.operationId,
              reason: "reconciliation_required",
            }),
          )
        }
        return yield* Effect.fail(authorizationResult.failure)
      }

      const state = yield* database.withTransaction(
        Effect.gen(function* () {
          const current = yield* loadOperationOrFail(decoded.tenantId, decoded.operationId, true)
          if (
            current.status === "reconciled" || current.status === "rejected" ||
            current.status === "manual_recovery"
          ) {
            return {
              operation: current,
              lines: [] as never[],
              blocked: false as const,
              routingChanged: false as const,
              reconcile: false as const,
            }
          }
          const loadLines = () =>
            database.query(
              (db) =>
                db.select({
                  accountId: journalLines.accountId,
                  debit: journalLines.debit,
                  credit: journalLines.credit,
                }).from(journalLines).where(
                  and(
                    eq(journalLines.tenantId, decoded.tenantId),
                    eq(journalLines.entryId, current.journalId),
                  ),
                ),
              "accounting.financial_operation.lines",
            )
          if (!current.engineVerified || current.engine !== "tigerbeetle") {
            return {
              operation: current,
              lines: [] as never[],
              blocked: false as const,
              routingChanged: true as const,
              observedEngine: null,
              reconcile: false as const,
            }
          }
          if (
            reconcileRequested || current.status === "submitted" || current.status === "unknown" ||
            current.status === "accepted"
          ) {
            const operation = current.status === "unknown" ||
                (reconcileRequested && current.status === "intent")
              ? (yield* database.query(
                (db) =>
                  db.update(financialOperations).set({
                    status: "submitted",
                    attempts: current.attempts + 1,
                    submittedAt: current.submittedAt ?? currentTime(),
                    lastError: null,
                    updatedAt: currentTime(),
                  }).where(
                    and(
                      eq(financialOperations.tenantId, decoded.tenantId),
                      eq(financialOperations.id, current.id),
                    ),
                  ).returning(operationSelection),
                "accounting.financial_operation.reconciliation.submitted",
              ))[0]!
              : current
            return {
              operation,
              lines: yield* loadLines(),
              blocked: false as const,
              routingChanged: false as const,
              reconcile: true as const,
            }
          }
          const [configuration] = yield* database.query(
            (db) =>
              db.select({
                postingEnabled: legalEntityAccountingConfigurations.postingEnabled,
                financialEngine: legalEntityAccountingConfigurations.financialEngine,
              }).from(legalEntityAccountingConfigurations).where(and(
                eq(legalEntityAccountingConfigurations.tenantId, decoded.tenantId),
                eq(
                  legalEntityAccountingConfigurations.legalEntityId,
                  current.legalEntityId,
                ),
              )).for("update"),
            "accounting.financial_operation.submit.configuration",
          )
          const [period] = yield* database.query(
            (db) =>
              db.select({ status: accountingPeriods.status }).from(accountingPeriods).where(and(
                eq(accountingPeriods.tenantId, decoded.tenantId),
                eq(accountingPeriods.id, current.periodId),
              )).for("update"),
            "accounting.financial_operation.submit.period",
          )
          if (
            !current.engineVerified || current.engine !== "tigerbeetle" ||
            configuration?.financialEngine !== current.engine
          ) {
            return {
              operation: current,
              lines: [] as never[],
              blocked: false as const,
              routingChanged: true as const,
              observedEngine: configuration?.financialEngine ?? null,
              reconcile: false as const,
            }
          }
          if (configuration.postingEnabled !== true || period?.status !== "open") {
            return {
              operation: current,
              lines: [] as never[],
              blocked: true as const,
              routingChanged: false as const,
              reconcile: false as const,
            }
          }
          const now = currentTime()
          const [updated] = yield* database.query(
            (db) =>
              db.update(financialOperations).set({
                status: "submitted",
                attempts: current.attempts + 1,
                submittedAt: current.submittedAt ?? now,
                lastError: null,
                updatedAt: now,
              }).where(
                and(
                  eq(financialOperations.tenantId, decoded.tenantId),
                  eq(financialOperations.id, current.id),
                ),
              ).returning(operationSelection),
            "accounting.financial_operation.submitted",
          )
          return {
            operation: updated!,
            lines: yield* loadLines(),
            blocked: false as const,
            routingChanged: false as const,
            reconcile: false as const,
          }
        }),
        "accounting.financial_operation.submit",
      )

      if (state.routingChanged) {
        return toOperation(
          yield* writeReceipt(decoded.operationId, decoded.tenantId, {
            _tag: "manual_recovery",
            operationId: decoded.operationId,
            reason: "engine_routing_changed",
          }, "observedEngine" in state ? state.observedEngine : null),
        )
      }
      if (state.blocked) {
        const now = currentTime()
        const [deferred] = yield* database.query(
          (db) =>
            db.update(financialOperations).set({
              scheduledAt: new Date(now.getTime() + 5_000),
              lastError: "posting_blocked",
              updatedAt: now,
            }).where(
              and(
                eq(financialOperations.tenantId, decoded.tenantId),
                eq(financialOperations.id, state.operation.id),
              ),
            ).returning(operationSelection),
          "accounting.financial_operation.submit.blocked",
        )
        return toOperation(deferred!)
      }
      if (state.lines.length === 0) return toOperation(state.operation)
      const ledger = ledgerOption.value
      const accountIds = [...new Set(state.lines.map((line) => line.accountId))]
      for (const accountId of accountIds) {
        const accountOutcome = yield* ledger.createExecutionAccount({
          tenantId: decoded.tenantId,
          legalEntityId: state.operation.legalEntityId,
          accountId,
          currency: state.operation.currency,
          mappingVersion: state.operation.mappingVersion,
        })
        if (accountOutcome._tag !== "accepted") {
          const operationOutcome: FinancialExecutionOutcome = accountOutcome._tag === "rejected"
            ? {
              _tag: "rejected",
              operationId: state.operation.operationId,
              reason: accountOutcome.reason,
            }
            : accountOutcome._tag === "unknown"
            ? {
              _tag: "unknown",
              operationId: state.operation.operationId,
              reason: accountOutcome.reason,
            }
            : {
              _tag: "manual_recovery",
              operationId: state.operation.operationId,
              reason: accountOutcome.reason,
            }
          return toOperation(
            yield* writeReceipt(decoded.operationId, decoded.tenantId, operationOutcome),
          )
        }
      }

      const journalInput = {
        tenantId: decoded.tenantId,
        legalEntityId: state.operation.legalEntityId,
        operationId: state.operation.operationId,
        journalId: state.operation.journalId,
        reference: state.operation.reference,
        currency: state.operation.currency,
        mappingVersion: state.operation.mappingVersion,
        lines: state.lines.map((line) => ({
          accountId: line.accountId,
          debitMinor: toMinor(line.debit),
          creditMinor: toMinor(line.credit),
        })),
      }
      let outcome = yield* (state.reconcile
        ? ledger.reconcileJournal(journalInput)
        : ledger.postJournal(journalInput))
      if (state.reconcile && outcome._tag === "unknown" && outcome.reason === "not_found") {
        outcome = yield* ledger.postJournal(journalInput)
      }
      if (outcome._tag === "accepted") {
        const expectedTransferIds = yield* ledger.expectedTransferIds(journalInput)
        if (
          outcome.transferCount !== expectedTransferIds.length ||
          outcome.transferIds.length !== expectedTransferIds.length ||
          outcome.transferIds.some((id, index) => id !== expectedTransferIds[index])
        ) {
          outcome = {
            _tag: "manual_recovery",
            operationId: outcome.operationId,
            reason: "mapping_mismatch",
          }
        }
      }
      return toOperation(yield* writeReceipt(decoded.operationId, decoded.tenantId, outcome))
    })

  const createJournalIntent = (
    input: unknown,
    capability:
      | typeof AccountingCapabilities.journalPost
      | typeof AccountingCapabilities.revenuePost = AccountingCapabilities.journalPost,
    operationTypeOverride?: "journal_post" | "journal_reverse" | "revenue_post",
  ) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateFinancialJournalIntentInput)(input)
      const operationType = operationTypeOverride ?? decoded.operationType
      if (operationType !== "journal_reverse") {
        yield* validateLines(decoded.lines)
        const selfTransfer = pairTransfers(decoded.lines).find((transfer) =>
          transfer.debitAccountId === transfer.creditAccountId
        )
        if (selfTransfer !== undefined) {
          return yield* Effect.fail(new InvalidJournalLine({ index: selfTransfer.position }))
        }
      }
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability,
      })
      const requestFingerprint = fingerprint({ ...decoded, operationType })
      const sourceJournalIdForConflict = decoded.sourceJournalId
      const now = currentTime()
      const operation = yield* database.withTransaction(
        Effect.gen(function* () {
          const [existing] = yield* database.query(
            (db) =>
              db.select(operationSelection).from(financialOperations).where(
                and(
                  eq(financialOperations.tenantId, decoded.tenantId),
                  eq(financialOperations.operationId, decoded.operationId),
                ),
              ).for("update"),
            "accounting.financial_operation.intent.lookup",
          )
          if (existing !== undefined) {
            if (existing.requestFingerprint !== requestFingerprint) {
              return yield* Effect.fail(
                new FinancialOperationConflict({
                  tenantId: decoded.tenantId,
                  operationId: decoded.operationId,
                }),
              )
            }
            return existing
          }

          const today = now.toISOString().slice(0, 10)
          const [configuration] = yield* database.query(
            (db) =>
              db.select({
                postingEnabled: legalEntityAccountingConfigurations.postingEnabled,
                financialEngine: legalEntityAccountingConfigurations.financialEngine,
                baseCurrency: legalEntityAccountingConfigurations.baseCurrency,
              }).from(legalEntityAccountingConfigurations)
                .where(
                  and(
                    eq(legalEntityAccountingConfigurations.tenantId, decoded.tenantId),
                    eq(
                      legalEntityAccountingConfigurations.legalEntityId,
                      decoded.legalEntityId,
                    ),
                  ),
                ).for("update"),
            "accounting.financial_operation.intent.configuration",
          )
          const [period] = yield* database.query(
            (db) =>
              db.select({ id: accountingPeriods.id }).from(accountingPeriods).where(
                and(
                  eq(accountingPeriods.tenantId, decoded.tenantId),
                  eq(accountingPeriods.legalEntityId, decoded.legalEntityId),
                  eq(accountingPeriods.status, "open"),
                  lte(accountingPeriods.startsOn, today),
                  gte(accountingPeriods.endsOn, today),
                ),
              ).for("update"),
            "accounting.financial_operation.intent.period",
          )
          if (configuration?.financialEngine !== "tigerbeetle") {
            return yield* Effect.fail(
              new FinancialLedgerNotActivated({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
              }),
            )
          }
          if (configuration.baseCurrency !== decoded.currency) {
            return yield* Effect.fail(
              new FinancialCurrencyMismatch({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
              }),
            )
          }
          if (operationType === "revenue_post") {
            const [profile] = yield* database.query(
              (db) =>
                db.select({
                  receivableAccountId: revenuePostingProfiles.receivableAccountId,
                  revenueAccountId: revenuePostingProfiles.revenueAccountId,
                }).from(revenuePostingProfiles).where(and(
                  eq(revenuePostingProfiles.tenantId, decoded.tenantId),
                  eq(revenuePostingProfiles.legalEntityId, decoded.legalEntityId),
                )).for("update"),
              "accounting.financial_operation.intent.revenue_profile",
            )
            const profileMatches = profile !== undefined && decoded.lines.length === 2 &&
              decoded.lines[0]!.accountId === profile.receivableAccountId &&
              decoded.lines[1]!.accountId === profile.revenueAccountId
            if (!profileMatches) {
              return yield* Effect.fail(
                new FinancialOperationConflict({
                  tenantId: decoded.tenantId,
                  operationId: decoded.operationId,
                }),
              )
            }
          }
          if (configuration.postingEnabled !== true || period === undefined) {
            return yield* Effect.fail(
              new AccountingPeriodNotOpen({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
              }),
            )
          }
          if (operationType === "journal_reverse" && decoded.sourceJournalId === null) {
            return yield* Effect.fail(new FinancialReversalSourceRequired({}))
          }
          if (operationType === "journal_post" && decoded.sourceJournalId !== null) {
            return yield* Effect.fail(
              new FinancialOperationConflict({
                tenantId: decoded.tenantId,
                operationId: decoded.operationId,
              }),
            )
          }
          let intentLines = decoded.lines
          if (decoded.sourceJournalId !== null) {
            const sourceJournalId = decoded.sourceJournalId
            const [source] = yield* database.query(
              (db) =>
                db.select({ status: journalEntries.status }).from(journalEntries).where(
                  and(
                    eq(journalEntries.tenantId, decoded.tenantId),
                    eq(journalEntries.id, sourceJournalId),
                  ),
                ).for("update"),
              "accounting.financial_operation.intent.source_journal",
            )
            if (source === undefined) {
              return yield* Effect.fail(
                new FinancialReversalSourceNotFound({
                  tenantId: decoded.tenantId,
                  sourceJournalId: decoded.sourceJournalId,
                }),
              )
            }
            if (source.status !== "posted") {
              return yield* Effect.fail(
                new FinancialReversalSourceNotPosted({
                  tenantId: decoded.tenantId,
                  sourceJournalId: decoded.sourceJournalId,
                }),
              )
            }
            const [sourceOperation] = yield* database.query(
              (db) =>
                db.select({
                  legalEntityId: financialOperations.legalEntityId,
                  currency: financialOperations.currency,
                  engine: financialOperations.engine,
                  engineVerified: financialOperations.engineVerified,
                  status: financialOperations.status,
                }).from(financialOperations).where(and(
                  eq(financialOperations.tenantId, decoded.tenantId),
                  eq(financialOperations.journalId, sourceJournalId),
                )).for("update"),
              "accounting.financial_operation.intent.source_operation",
            )
            if (
              sourceOperation === undefined ||
              sourceOperation.legalEntityId !== decoded.legalEntityId ||
              sourceOperation.currency !== decoded.currency ||
              !sourceOperation.engineVerified ||
              sourceOperation.engine !== "tigerbeetle" ||
              sourceOperation.status !== "reconciled"
            ) {
              return yield* Effect.fail(
                new FinancialReversalSourceNotReady({
                  tenantId: decoded.tenantId,
                  sourceJournalId: decoded.sourceJournalId,
                }),
              )
            }
            const sourceLines = yield* database.query(
              (db) =>
                db.select({
                  accountId: journalLines.accountId,
                  debit: journalLines.debit,
                  credit: journalLines.credit,
                }).from(journalLines).where(and(
                  eq(journalLines.tenantId, decoded.tenantId),
                  eq(journalLines.entryId, sourceJournalId),
                )),
              "accounting.financial_operation.intent.source_lines",
            )
            intentLines = sourceLines.map((line) => ({
              accountId: line.accountId,
              debit: String(line.credit ?? "0"),
              credit: String(line.debit ?? "0"),
            }))
            yield* validateLines(intentLines)
            const selfTransfer = pairTransfers(intentLines).find((transfer) =>
              transfer.debitAccountId === transfer.creditAccountId
            )
            if (selfTransfer !== undefined) {
              return yield* Effect.fail(new InvalidJournalLine({ index: selfTransfer.position }))
            }
          }
          const accountIds = [...new Set(intentLines.map((line) => line.accountId))]
          const existingAccounts = yield* database.query(
            (db) =>
              db.select({ id: accounts.id }).from(accounts).where(
                and(
                  eq(accounts.tenantId, decoded.tenantId),
                  inArray(accounts.id, accountIds),
                ),
              ).for("update"),
            "accounting.financial_operation.intent.accounts",
          )
          if (existingAccounts.length !== accountIds.length) {
            return yield* Effect.fail(new AccountNotFound({ tenantId: decoded.tenantId }))
          }

          const [journal] = yield* database.query(
            (db) =>
              db.insert(journalEntries).values({
                tenantId: decoded.tenantId,
                reference: decoded.reference.trim(),
                status: "draft",
                postedAt: null,
                reversesEntryId: null,
              }).returning({ id: journalEntries.id }),
            "accounting.financial_operation.intent.journal",
          )
          const journalId = journal!.id
          yield* database.query(
            (db) =>
              db.insert(journalLines).values(
                intentLines.map((line) => ({
                  tenantId: decoded.tenantId,
                  entryId: journalId,
                  accountId: line.accountId,
                  debit: line.debit,
                  credit: line.credit,
                })),
              ),
            "accounting.financial_operation.intent.lines",
          )
          const [inserted] = yield* database.query(
            (db) =>
              db.insert(financialOperations).values({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
                periodId: period.id,
                operationId: decoded.operationId,
                operationType,
                engine: "tigerbeetle",
                engineVerified: true,
                journalId,
                sourceJournalId: decoded.sourceJournalId,
                reference: decoded.reference.trim(),
                currency: decoded.currency,
                mappingVersion: decoded.mappingVersion,
                requestFingerprint,
                actorPrincipalId: decoded.principal.userAccountId,
                actorSessionId: decoded.principal.sessionId,
                status: "intent",
                attempts: 0,
                scheduledAt: now,
              }).returning(operationSelection),
            "accounting.financial_operation.intent.operation",
          )
          yield* database.query(
            (db) =>
              db.insert(financialOperationTransfers).values(
                pairTransfers(intentLines).map((transfer) => ({
                  tenantId: decoded.tenantId,
                  operationId: inserted!.id,
                  position: transfer.position,
                  debitAccountId: transfer.debitAccountId,
                  creditAccountId: transfer.creditAccountId,
                  amountMinor: transfer.amountMinor,
                })),
              ),
            "accounting.financial_operation.intent.transfers",
          )
          yield* jobs.enqueue({
            tenantId: decoded.tenantId,
            jobType: submitJobType,
            idempotencyKey: decoded.operationId,
            priority: 100,
            payload: {
              tenantId: decoded.tenantId,
              operationId: decoded.operationId,
            },
            correlationId: decoded.correlationId,
          })
          return inserted!
        }),
        "accounting.financial_operation.intent",
      ).pipe(
        Effect.catchIf(
          (error) =>
            error instanceof DatabaseFailure &&
            isDatabaseConstraint(error, "journal_entries_reference_key"),
          () =>
            Effect.gen(function* () {
              const [concurrent] = yield* loadOperation(decoded.tenantId, decoded.operationId)
              if (
                concurrent !== undefined && concurrent.requestFingerprint === requestFingerprint
              ) {
                return concurrent
              }
              return yield* Effect.fail(
                new JournalReferenceAlreadyExists({
                  tenantId: decoded.tenantId,
                  reference: decoded.reference.trim(),
                }),
              )
            }),
        ),
        Effect.catchIf(
          (error) =>
            error instanceof DatabaseFailure &&
            isDatabaseConstraint(error, "financial_operations_tenant_operation_key"),
          () =>
            Effect.gen(function* () {
              const [concurrent] = yield* loadOperation(decoded.tenantId, decoded.operationId)
              if (
                concurrent !== undefined && concurrent.requestFingerprint === requestFingerprint
              ) {
                return concurrent
              }
              return yield* Effect.fail(
                new FinancialOperationConflict({
                  tenantId: decoded.tenantId,
                  operationId: decoded.operationId,
                }),
              )
            }),
        ),
        Effect.catchIf(
          (error) =>
            error instanceof DatabaseFailure &&
            sourceJournalIdForConflict !== null &&
            isDatabaseConstraint(error, "financial_operations_tenant_source_journal_key"),
          () =>
            Effect.fail(
              new FinancialReversalAlreadyExists({
                tenantId: decoded.tenantId,
                sourceJournalId: sourceJournalIdForConflict!,
              }),
            ),
        ),
      )
      return toOperation(operation)
    })

  const createRevenueIntent = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateFinancialRevenueIntentInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: AccountingCapabilities.revenuePost,
      })
      if (Option.isNone(salesOption)) {
        return yield* Effect.fail(new FinancialSalesNotConfigured({}))
      }
      const confirmedAmount = yield* salesOption.value.getConfirmedOrderTotal({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        orderId: decoded.orderId,
      })
      if (decoded.amount !== undefined && toMinor(decoded.amount) !== toMinor(confirmedAmount)) {
        return yield* Effect.fail(
          new FinancialRevenueAmountMismatch({
            tenantId: decoded.tenantId,
            orderId: decoded.orderId,
          }),
        )
      }
      const amount = confirmedAmount
      const [profile] = yield* database.query(
        (db) =>
          db.select({
            receivableAccountId: revenuePostingProfiles.receivableAccountId,
            revenueAccountId: revenuePostingProfiles.revenueAccountId,
          }).from(revenuePostingProfiles).where(and(
            eq(revenuePostingProfiles.tenantId, decoded.tenantId),
            eq(revenuePostingProfiles.legalEntityId, decoded.legalEntityId),
          )),
        "accounting.financial_operation.revenue.profile",
      )
      if (profile === undefined) {
        return yield* Effect.fail(
          new RevenuePostingProfileNotFound({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
          }),
        )
      }
      return yield* createJournalIntent(
        {
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          legalEntityId: decoded.legalEntityId,
          operationId: decoded.commandId,
          reference: `revenue:${decoded.legalEntityId}:${decoded.orderId}`,
          currency: decoded.currency,
          mappingVersion: decoded.mappingVersion,
          lines: [
            { accountId: profile.receivableAccountId, debit: amount, credit: "0" },
            { accountId: profile.revenueAccountId, debit: "0", credit: amount },
          ],
          correlationId: decoded.correlationId,
        },
        AccountingCapabilities.revenuePost,
        "revenue_post",
      )
    })

  const createReversalIntent = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateFinancialReversalIntentInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: AccountingCapabilities.journalPost,
      })
      return yield* createJournalIntent({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        operationId: decoded.operationId,
        reference: decoded.reference,
        currency: decoded.currency,
        mappingVersion: decoded.mappingVersion,
        operationType: "journal_reverse",
        sourceJournalId: decoded.sourceJournalId,
        lines: [],
        correlationId: decoded.correlationId,
      })
    })

  return {
    createJournalIntent,
    createRevenueIntent,
    createReversalIntent,
    submitFinancialOperation: (input) => submit(input, submitJobType),
    reconcileFinancialOperation: (input) => submit(input, reconcileJobType),
  } satisfies FinancialOperationService
})

export const FinancialOperationServiceLive = Layer.effect(
  FinancialOperationService,
  makeFinancialOperationService,
)
