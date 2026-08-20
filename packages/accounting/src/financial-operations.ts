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
  financialCutoverControls,
  financialOperations,
  financialOperationTransfers,
  financialOrphanTransfers,
  financialReconciliationCheckpoints,
  financialVerificationArtifacts,
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
  FINANCIAL_LEDGER_MAX_MINOR,
  FinancialMajorAmount,
  isDatabaseConstraint,
  requireExactMajorToMinor,
} from "../../kernel/mod.ts"
import { EventEnvelope, EventIdempotencyConflict, MessagingService } from "../../messaging/mod.ts"
import { SalesOrderInvalidState, SalesOrderNotFound, SalesService } from "../../sales/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import {
  type FinancialAccountConstraint,
  type FinancialExecutionOutcome,
  FinancialLedgerAuthority,
  FinancialLedgerPort,
} from "./financial-ledger.ts"
import {
  buildFinancialVerificationEvidence,
  type FinancialFactSnapshot,
} from "./financial-readiness.ts"
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
const PositiveInt = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }),
)
const NonNegativeInt = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 0x7fffffff }),
)
const InstantString = EventEnvelope.fields.occurredAt
const Money = FinancialMajorAmount
const operationTypeMatchesSourceJournal = (operation: {
  readonly operationType: string
  readonly sourceJournalId: string | null
}) =>
  operation.operationType === "journal_reverse"
    ? operation.sourceJournalId !== null
    : operation.sourceJournalId === null
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

const financialOperationStatusMatchesMetadata = (operation: {
  readonly status: FinancialOperationStatus
  readonly engineAcceptedAt: string | null
  readonly rejectionReason: string | null
  readonly recoveryReason: string | null
  readonly reconciledAt: string | null
}) => {
  const hasNoTerminalMetadata = operation.engineAcceptedAt === null &&
    operation.rejectionReason === null &&
    operation.recoveryReason === null &&
    operation.reconciledAt === null
  switch (operation.status) {
    case "intent":
    case "submitted":
    case "unknown":
      return hasNoTerminalMetadata
    case "accepted":
      return operation.engineAcceptedAt !== null &&
        operation.rejectionReason === null &&
        operation.recoveryReason === null &&
        operation.reconciledAt === null
    case "rejected":
      return operation.engineAcceptedAt === null &&
        operation.rejectionReason !== null &&
        operation.recoveryReason === null &&
        operation.reconciledAt === null
    case "manual_recovery":
      return operation.recoveryReason !== null && operation.reconciledAt === null
    case "reconciled":
      return operation.engineAcceptedAt !== null &&
        operation.rejectionReason === null &&
        operation.recoveryReason === null &&
        operation.reconciledAt !== null
  }
}

export const FinancialOperationFailpointName = Schema.Literals([
  "before_intent_commit",
  "after_intent_commit",
  "before_provider_submission",
  "after_provider_acceptance",
  "before_receipt_commit",
  "after_receipt_commit",
  "before_projection_commit",
  "before_outbox_append",
  "after_finalization",
])
export type FinancialOperationFailpointName = Schema.Schema.Type<
  typeof FinancialOperationFailpointName
>

export class FinancialOperationInjectedFailure
  extends Schema.TaggedErrorClass<FinancialOperationInjectedFailure>()(
    "FinancialOperationInjectedFailure",
    { point: FinancialOperationFailpointName },
  ) {}

export interface FinancialOperationFailpointService {
  readonly hit: (
    point: FinancialOperationFailpointName,
  ) => Effect.Effect<void, FinancialOperationInjectedFailure>
}
export const FinancialOperationFailpointService = Context.Service<
  FinancialOperationFailpointService
>(
  "RITSEI/Accounting/FinancialOperationFailpoint",
)

export const makeFinancialOperationFailpointLayer = (
  points: Iterable<FinancialOperationFailpointName>,
) => {
  const remaining = new Set(points)
  return Layer.succeed(FinancialOperationFailpointService, {
    hit: (point: FinancialOperationFailpointName) =>
      remaining.delete(point)
        ? Effect.fail(new FinancialOperationInjectedFailure({ point }))
        : Effect.void,
  })
}

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
  attempts: NonNegativeInt,
  scheduledAt: InstantString,
  submittedAt: Schema.NullOr(InstantString),
  engineAcceptedAt: Schema.NullOr(NonEmptyString),
  rejectionReason: Schema.NullOr(NonEmptyString),
  recoveryReason: Schema.NullOr(NonEmptyString),
  observedEngine: Schema.NullOr(Schema.Literals(["postgresql", "tigerbeetle"])),
  lastError: Schema.NullOr(NonEmptyString),
  reconciledAt: Schema.NullOr(InstantString),
}).check(Schema.makeFilter(
  operationTypeMatchesSourceJournal,
  { expected: "financial operation type matches source journal" },
)).check(Schema.makeFilter(
  financialOperationStatusMatchesMetadata,
  { expected: "financial operation status matches terminal metadata" },
))
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
}).check(Schema.makeFilter(
  operationTypeMatchesSourceJournal,
  { expected: "financial operation type matches source journal" },
))

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

export const RebuildFinancialProjectionInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
})

export const FinancialProjectionRebuildResult = Schema.Struct({
  tenantId: Uuid,
  legalEntityId: Uuid,
  checkedOperations: Schema.Int,
  rebuiltOperations: Schema.Int,
  quarantinedOperations: Schema.Int,
})

export const ReconcileFinancialCheckpointInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
  recoveryWatermark: NonEmptyString,
  sourceWatermark: NonEmptyString,
  targetWatermark: NonEmptyString,
  sourceSnapshotRef: NonEmptyString,
  targetSnapshotRef: NonEmptyString,
  evidenceArtifactId: Schema.NullOr(Uuid),
})

export const FinancialReconciliationCheckpoint = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  engine: FinancialLedgerAuthority,
  status: Schema.Literals(["verified", "blocked"]),
  recoveryWatermark: NonEmptyString,
  sourceWatermark: NonEmptyString,
  targetWatermark: NonEmptyString,
  sourceSnapshotRef: NonEmptyString,
  targetSnapshotRef: NonEmptyString,
  operationSetHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  accountBalanceHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  transferSetHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  projectionHash: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))),
  evidenceArtifactId: Schema.NullOr(Uuid),
  mismatchCount: NonNegativeInt,
  orphanCount: NonNegativeInt,
  checkedBy: NonEmptyString,
  checkedAt: InstantString,
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
export type RebuildFinancialProjectionInput = Schema.Schema.Type<
  typeof RebuildFinancialProjectionInput
>
export type FinancialProjectionRebuildResult = Schema.Schema.Type<
  typeof FinancialProjectionRebuildResult
>
export type ReconcileFinancialCheckpointInput = Schema.Schema.Type<
  typeof ReconcileFinancialCheckpointInput
>
export type FinancialReconciliationCheckpoint = Schema.Schema.Type<
  typeof FinancialReconciliationCheckpoint
>

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

export class FinancialProjectionRebuildBlocked
  extends Schema.TaggedErrorClass<FinancialProjectionRebuildBlocked>()(
    "FinancialProjectionRebuildBlocked",
    {
      tenantId: Uuid,
      legalEntityId: Uuid,
      operationId: NonEmptyString,
      reason: Schema.Literals(["unavailable", "not_found", "mapping_mismatch"]),
    },
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

export class FinancialReconciliationCheckpointEvidenceInvalid
  extends Schema.TaggedErrorClass<FinancialReconciliationCheckpointEvidenceInvalid>()(
    "FinancialReconciliationCheckpointEvidenceInvalid",
    {
      tenantId: Uuid,
      legalEntityId: Uuid,
      reason: Schema.Literals([
        "not_found",
        "scope_mismatch",
        "provenance_mismatch",
        "mapping_version_mismatch",
        "hash_mismatch",
        "rejected",
      ]),
    },
  ) {}

export class FinancialReconciliationCheckpointConflict
  extends Schema.TaggedErrorClass<FinancialReconciliationCheckpointConflict>()(
    "FinancialReconciliationCheckpointConflict",
    {
      tenantId: Uuid,
      legalEntityId: Uuid,
      recoveryWatermark: NonEmptyString,
    },
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
    | FinancialOperationInjectedFailure
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
    | FinancialOperationInjectedFailure
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
    | FinancialOperationInjectedFailure
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
    | FinancialOperationInjectedFailure
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
    | FinancialOperationInjectedFailure
  >
  readonly reconcileFinancialCheckpoint: (
    input: unknown,
  ) => Effect.Effect<
    FinancialReconciliationCheckpoint,
    | AuthorizationDenied
    | FinancialLedgerNotConfigured
    | FinancialReconciliationCheckpointEvidenceInvalid
    | FinancialReconciliationCheckpointConflict
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly rebuildFinancialProjections: (
    input: unknown,
  ) => Effect.Effect<
    FinancialProjectionRebuildResult,
    | AuthorizationDenied
    | EventIdempotencyConflict
    | FinancialLedgerNotConfigured
    | FinancialOperationNotFound
    | FinancialProjectionRebuildBlocked
    | DatabaseFailure
    | Schema.SchemaError
    | FinancialOperationInjectedFailure
  >
}

export const FinancialOperationService = Context.Service<FinancialOperationService>(
  "RITSEI/Accounting/FinancialOperationService",
)

const operationSelection = {
  id: financialOperations.id,
  tenantId: financialOperations.tenantId,
  legalEntityId: financialOperations.legalEntityId,
  periodId: financialOperations.periodId,
  operationId: financialOperations.operationId,
  reconciledEventId: financialOperations.reconciledEventId,
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
    readonly reconciledEventId: string
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

const toCheckpoint = (row: {
  readonly id: string
  readonly tenantId: string
  readonly legalEntityId: string
  readonly engine: string
  readonly status: "verified" | "blocked"
  readonly recoveryWatermark: string
  readonly sourceWatermark: string
  readonly targetWatermark: string
  readonly sourceSnapshotRef: string
  readonly targetSnapshotRef: string
  readonly operationSetHash: string
  readonly accountBalanceHash: string
  readonly transferSetHash: string
  readonly projectionHash: string | null
  readonly evidenceArtifactId: string | null
  readonly mismatchCount: number
  readonly orphanCount: number
  readonly checkedBy: string
  readonly checkedAt: Date
}): FinancialReconciliationCheckpoint => ({
  id: row.id,
  tenantId: row.tenantId,
  legalEntityId: row.legalEntityId,
  engine: row.engine === "postgresql" ? "postgresql" : "tigerbeetle",
  status: row.status,
  recoveryWatermark: row.recoveryWatermark,
  sourceWatermark: row.sourceWatermark,
  targetWatermark: row.targetWatermark,
  sourceSnapshotRef: row.sourceSnapshotRef,
  targetSnapshotRef: row.targetSnapshotRef,
  operationSetHash: row.operationSetHash,
  accountBalanceHash: row.accountBalanceHash,
  transferSetHash: row.transferSetHash,
  projectionHash: row.projectionHash,
  evidenceArtifactId: row.evidenceArtifactId,
  mismatchCount: row.mismatchCount,
  orphanCount: row.orphanCount,
  checkedBy: row.checkedBy,
  checkedAt: row.checkedAt.toISOString(),
})

const toMinor = (value: string): string => requireExactMajorToMinor(value, 2).toString()

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
      if (debit > FINANCIAL_LEDGER_MAX_MINOR || credit > FINANCIAL_LEDGER_MAX_MINOR) {
        return yield* Effect.fail(new InvalidJournalLine({ index: lines.indexOf(line) }))
      }
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

const pairMinorTransfers = (
  lines: readonly {
    readonly accountId: string
    readonly debitMinor: string
    readonly creditMinor: string
  }[],
) => {
  const debits = lines.flatMap((line) =>
    BigInt(line.debitMinor) > 0n
      ? [{ accountId: line.accountId, amount: BigInt(line.debitMinor) }]
      : []
  )
  const credits = lines.flatMap((line) =>
    BigInt(line.creditMinor) > 0n
      ? [{ accountId: line.accountId, amount: BigInt(line.creditMinor) }]
      : []
  )
  const pairs: Array<{
    readonly position: number
    readonly debitAccountId: string
    readonly creditAccountId: string
    readonly amountMinor: string
  }> = []
  let debitIndex = 0
  let creditIndex = 0
  let debitRemaining = debits[0]?.amount ?? 0n
  let creditRemaining = credits[0]?.amount ?? 0n
  while (debitIndex < debits.length && creditIndex < credits.length) {
    const amount = debitRemaining < creditRemaining ? debitRemaining : creditRemaining
    pairs.push({
      position: pairs.length,
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
  return pairs
}

const submitJobType = "accounting.financial_operation.submit"
const reconcileJobType = "accounting.financial_operation.reconcile"
const currentTime = () => new Date(Date.now())
const financialOperationEventMetadata = (operationId: string) => ({
  commandId: `accounting.financial_operation.reconcile:${operationId}`,
  correlationId: `accounting.financial_operation:${operationId}`,
  causationId: `accounting.financial_operation.submit:${operationId}`,
  idempotencyKey: `accounting.financial_operation.reconciled:${operationId}`,
})

const balanceConstraintForAccountType = (
  type: "asset" | "liability" | "equity" | "revenue" | "expense",
): FinancialAccountConstraint =>
  type === "asset" || type === "expense"
    ? "credits_must_not_exceed_debits"
    : "debits_must_not_exceed_credits"

export const makeFinancialOperationService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const ledgerOption = yield* Effect.serviceOption(FinancialLedgerPort)
  const salesOption = yield* Effect.serviceOption(SalesService)
  const jobs = yield* DurableJobEnqueuer
  const messaging = yield* MessagingService
  const failpointOption = yield* Effect.serviceOption(FinancialOperationFailpointService)
  const hit = (point: FinancialOperationFailpointName) =>
    Option.isSome(failpointOption) ? failpointOption.value.hit(point) : Effect.void

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
        yield* hit("before_projection_commit")
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
        yield* hit("before_outbox_append")
        yield* messaging.append({
          tenantId,
          eventId: current.reconciledEventId,
          eventType: AccountingFinancialOperationReconciledEvent.id,
          eventVersion: AccountingFinancialOperationReconciledEvent.version,
          aggregateType: AccountingFinancialOperationReconciledEvent.aggregateType,
          aggregateId: current.id,
          ...financialOperationEventMetadata(operationId),
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
    ).pipe(Effect.tap(() => hit("after_finalization")))

  const writeReceipt = (
    operationId: string,
    tenantId: string,
    outcome: FinancialExecutionOutcome,
    observedEngine: "postgresql" | "tigerbeetle" | null = null,
  ) =>
    Effect.gen(function* () {
      const now = currentTime()
      yield* hit("before_receipt_commit")
      const receipt = yield* database.withTransaction(
        Effect.gen(function* () {
          const current = yield* loadOperationOrFail(tenantId, operationId, true)
          if (outcome.operationId !== current.operationId) {
            const [updated] = yield* database.query(
              (db) =>
                db.update(financialOperations).set({
                  status: "manual_recovery",
                  rejectionReason: null,
                  recoveryReason: "mapping_mismatch",
                  lastError: "operation_identity_mismatch",
                  reconciledAt: null,
                  updatedAt: now,
                }).where(and(
                  eq(financialOperations.tenantId, tenantId),
                  eq(financialOperations.id, current.id),
                )).returning(operationSelection),
              "accounting.financial_operation.receipt.operation_identity_mismatch",
            )
            yield* database.query(
              (db) =>
                db.update(financialOperationTransfers).set({
                  status: "manual_recovery",
                  updatedAt: now,
                }).where(and(
                  eq(financialOperationTransfers.tenantId, tenantId),
                  eq(financialOperationTransfers.operationId, current.id),
                )),
              "accounting.financial_operation.projection.operation_identity_mismatch",
            )
            return updated!
          }
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
                    observedEngine,
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
                  observedEngine,
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
                observedEngine,
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
      yield* hit("after_receipt_commit")
      if (outcome._tag === "accepted" && receipt.status === "accepted") {
        return yield* finalizeAccepted(operationId, tenantId)
      }
      return receipt
    })

  const rebuildAcceptedProjection = (
    tenantId: string,
    operationId: string,
    outcome: Extract<FinancialExecutionOutcome, { readonly _tag: "accepted" }>,
  ) =>
    database.withTransaction(
      Effect.gen(function* () {
        const now = currentTime()
        const current = yield* loadOperationOrFail(tenantId, operationId, true)
        if (current.status !== "accepted" && current.status !== "reconciled") return current
        const [updated] = yield* database.query(
          (db) =>
            db.update(financialOperations).set({
              status: "reconciled",
              engineAcceptedAt: outcome.acceptedAt,
              reconciledAt: current.reconciledAt ?? now,
              rejectionReason: null,
              recoveryReason: null,
              observedEngine: current.engine,
              lastError: null,
              updatedAt: now,
            }).where(and(
              eq(financialOperations.tenantId, tenantId),
              eq(financialOperations.id, current.id),
            )).returning(operationSelection),
          "accounting.financial_projection_rebuild.operation",
        )
        const desiredJournalStatus = current.operationType === "journal_reverse"
          ? "reversed"
          : "posted"
        const desiredReversesEntryId = current.operationType === "journal_reverse"
          ? current.sourceJournalId
          : null
        const [journal] = yield* database.query(
          (db) =>
            db.select({
              status: journalEntries.status,
              reversesEntryId: journalEntries.reversesEntryId,
              postedAt: journalEntries.postedAt,
            }).from(journalEntries).where(and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.id, current.journalId),
            )),
          "accounting.financial_projection_rebuild.journal.get",
        )
        if (
          journal !== undefined &&
          (journal.status !== desiredJournalStatus ||
            journal.reversesEntryId !== desiredReversesEntryId || journal.postedAt === null)
        ) {
          yield* database.query(
            (db) =>
              db.update(journalEntries).set({
                status: desiredJournalStatus,
                reversesEntryId: desiredReversesEntryId,
                postedAt: current.reconciledAt ?? now,
                updatedAt: now,
              }).where(and(
                eq(journalEntries.tenantId, tenantId),
                eq(journalEntries.id, current.journalId),
              )),
            "accounting.financial_projection_rebuild.journal",
          )
        }
        const transfers = yield* database.query(
          (db) =>
            db.select({ position: financialOperationTransfers.position }).from(
              financialOperationTransfers,
            ).where(and(
              eq(financialOperationTransfers.tenantId, tenantId),
              eq(financialOperationTransfers.operationId, current.id),
            )),
          "accounting.financial_projection_rebuild.transfers",
        )
        for (const transfer of transfers) {
          const transferId = outcome.transferIds[transfer.position]
          if (transferId === undefined) continue
          yield* database.query(
            (db) =>
              db.update(financialOperationTransfers).set({
                engineTransferId: transferId,
                status: "accepted",
                observedTimestamp: outcome.acceptedAt,
                updatedAt: now,
              }).where(and(
                eq(financialOperationTransfers.tenantId, tenantId),
                eq(financialOperationTransfers.operationId, current.id),
                eq(financialOperationTransfers.position, transfer.position),
              )),
            "accounting.financial_projection_rebuild.transfer",
          )
        }
        yield* messaging.append({
          tenantId,
          eventId: current.reconciledEventId,
          eventType: AccountingFinancialOperationReconciledEvent.id,
          eventVersion: AccountingFinancialOperationReconciledEvent.version,
          aggregateType: AccountingFinancialOperationReconciledEvent.aggregateType,
          aggregateId: current.id,
          ...financialOperationEventMetadata(operationId),
          actorPrincipalId: current.actorPrincipalId,
          occurredAt: (current.reconciledAt ?? now).toISOString(),
          payload: {
            operationId,
            journalId: current.journalId,
            mappingVersion: current.mappingVersion,
          },
        })
        return updated!
      }),
      "accounting.financial_projection_rebuild.finalize",
    )

  const quarantineProjection = (tenantId: string, operationId: string) =>
    database.withTransaction(
      Effect.gen(function* () {
        const now = currentTime()
        const current = yield* loadOperationOrFail(tenantId, operationId, true)
        if (current.status === "manual_recovery") return current
        const [updated] = yield* database.query(
          (db) =>
            db.update(financialOperations).set({
              status: "manual_recovery",
              recoveryReason: "mapping_mismatch",
              rejectionReason: null,
              lastError: "financial_projection_rebuild_mismatch",
              reconciledAt: null,
              updatedAt: now,
            }).where(and(
              eq(financialOperations.tenantId, tenantId),
              eq(financialOperations.id, current.id),
            )).returning(operationSelection),
          "accounting.financial_projection_rebuild.quarantine.operation",
        )
        yield* database.query(
          (db) =>
            db.update(financialOperationTransfers).set({
              status: "manual_recovery",
              updatedAt: now,
            }).where(and(
              eq(financialOperationTransfers.tenantId, tenantId),
              eq(financialOperationTransfers.operationId, current.id),
            )),
          "accounting.financial_projection_rebuild.quarantine.transfers",
        )
        return updated!
      }),
      "accounting.financial_projection_rebuild.quarantine",
    )

  const reconcileFinancialCheckpoint = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ReconcileFinancialCheckpointInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: AccountingCapabilities.financialReconciliationCheckpoint,
      })
      if (Option.isNone(ledgerOption)) {
        return yield* Effect.fail(new FinancialLedgerNotConfigured({}))
      }
      const authority = ledgerOption.value.authority
      let evidenceArtifactMappingVersion: number | undefined
      let evidenceArtifactFactHashes: {
        readonly operationSetHash: string
        readonly accountBalanceHash: string
        readonly transferSetHash: string
        readonly projectionHash: string | null
      } | undefined
      const [configuration] = yield* database.query(
        (db) =>
          db.select({ baseCurrency: legalEntityAccountingConfigurations.baseCurrency })
            .from(legalEntityAccountingConfigurations).where(and(
              eq(legalEntityAccountingConfigurations.tenantId, decoded.tenantId),
              eq(legalEntityAccountingConfigurations.legalEntityId, decoded.legalEntityId),
            )),
        "accounting.financial_reconciliation_checkpoint.configuration",
      )
      if (configuration === undefined) {
        return yield* Effect.fail(
          new FinancialReconciliationCheckpointEvidenceInvalid({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            reason: "scope_mismatch",
          }),
        )
      }
      if (decoded.evidenceArtifactId !== null) {
        const [artifact] = yield* database.query(
          (db) =>
            db.select({
              legalEntityId: financialVerificationArtifacts.legalEntityId,
              status: financialVerificationArtifacts.status,
              mappingVersion: financialVerificationArtifacts.mappingVersion,
              currency: financialVerificationArtifacts.currency,
              sourceWatermark: financialVerificationArtifacts.sourceWatermark,
              targetWatermark: financialVerificationArtifacts.targetWatermark,
              sourceSnapshotRef: financialVerificationArtifacts.sourceSnapshotRef,
              targetSnapshotRef: financialVerificationArtifacts.targetSnapshotRef,
              operationSetHash: financialVerificationArtifacts.operationSetHash,
              accountBalanceHash: financialVerificationArtifacts.accountBalanceHash,
              transferSetHash: financialVerificationArtifacts.transferSetHash,
              projectionHash: financialVerificationArtifacts.projectionHash,
            }).from(financialVerificationArtifacts).where(and(
              eq(financialVerificationArtifacts.tenantId, decoded.tenantId),
              eq(financialVerificationArtifacts.id, decoded.evidenceArtifactId!),
            )),
          "accounting.financial_reconciliation_checkpoint.evidence",
        )
        if (artifact === undefined) {
          return yield* Effect.fail(
            new FinancialReconciliationCheckpointEvidenceInvalid({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              reason: "not_found",
            }),
          )
        }
        if (artifact.legalEntityId !== decoded.legalEntityId) {
          return yield* Effect.fail(
            new FinancialReconciliationCheckpointEvidenceInvalid({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              reason: "scope_mismatch",
            }),
          )
        }
        if (artifact.status !== "verified") {
          return yield* Effect.fail(
            new FinancialReconciliationCheckpointEvidenceInvalid({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              reason: "rejected",
            }),
          )
        }
        if (artifact.currency !== configuration.baseCurrency) {
          return yield* Effect.fail(
            new FinancialReconciliationCheckpointEvidenceInvalid({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              reason: "scope_mismatch",
            }),
          )
        }
        evidenceArtifactMappingVersion = artifact.mappingVersion
        evidenceArtifactFactHashes = {
          operationSetHash: artifact.operationSetHash,
          accountBalanceHash: artifact.accountBalanceHash,
          transferSetHash: artifact.transferSetHash,
          projectionHash: artifact.projectionHash,
        }
        const provenanceMatches = artifact.sourceWatermark === decoded.sourceWatermark &&
          artifact.targetWatermark === decoded.targetWatermark &&
          artifact.sourceSnapshotRef === decoded.sourceSnapshotRef &&
          artifact.targetSnapshotRef === decoded.targetSnapshotRef
        if (!provenanceMatches) {
          return yield* Effect.fail(
            new FinancialReconciliationCheckpointEvidenceInvalid({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              reason: "provenance_mismatch",
            }),
          )
        }
      }
      const loadExistingCheckpoint = () =>
        database.query(
          (db) =>
            db.select().from(financialReconciliationCheckpoints).where(and(
              eq(financialReconciliationCheckpoints.tenantId, decoded.tenantId),
              eq(financialReconciliationCheckpoints.legalEntityId, decoded.legalEntityId),
              eq(financialReconciliationCheckpoints.engine, authority),
              eq(
                financialReconciliationCheckpoints.recoveryWatermark,
                decoded.recoveryWatermark,
              ),
            )),
          "accounting.financial_reconciliation_checkpoint.idempotency",
        )
      const matchesCheckpointRequest = (row: {
        readonly sourceWatermark: string
        readonly targetWatermark: string
        readonly sourceSnapshotRef: string
        readonly targetSnapshotRef: string
        readonly evidenceArtifactId: string | null
      }) =>
        row.sourceWatermark === decoded.sourceWatermark &&
        row.targetWatermark === decoded.targetWatermark &&
        row.sourceSnapshotRef === decoded.sourceSnapshotRef &&
        row.targetSnapshotRef === decoded.targetSnapshotRef &&
        row.evidenceArtifactId === decoded.evidenceArtifactId
      const existing = yield* loadExistingCheckpoint()
      if (existing[0] !== undefined) {
        if (!matchesCheckpointRequest(existing[0])) {
          return yield* Effect.fail(
            new FinancialReconciliationCheckpointConflict({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              recoveryWatermark: decoded.recoveryWatermark,
            }),
          )
        }
        return toCheckpoint(existing[0])
      }

      const operations = yield* database.query(
        (db) =>
          db.select({
            ...operationSelection,
            journalStatus: journalEntries.status,
          }).from(financialOperations).innerJoin(
            journalEntries,
            and(
              eq(journalEntries.tenantId, financialOperations.tenantId),
              eq(journalEntries.id, financialOperations.journalId),
            ),
          ).where(and(
            eq(financialOperations.tenantId, decoded.tenantId),
            eq(financialOperations.legalEntityId, decoded.legalEntityId),
            eq(financialOperations.engine, authority),
            eq(financialOperations.engineVerified, true),
            inArray(financialOperations.status, [
              "intent",
              "submitted",
              "accepted",
              "unknown",
              "manual_recovery",
              "reconciled",
            ]),
          )).orderBy(financialOperations.createdAt),
        "accounting.financial_reconciliation_checkpoint.operations",
      )
      const mappingVersions = new Set(operations.map((operation) => operation.mappingVersion))
      const [checkpointMappingVersion] = mappingVersions
      if (
        mappingVersions.size > 1 ||
        (checkpointMappingVersion !== undefined &&
          evidenceArtifactMappingVersion !== undefined &&
          checkpointMappingVersion !== evidenceArtifactMappingVersion)
      ) {
        return yield* Effect.fail(
          new FinancialReconciliationCheckpointEvidenceInvalid({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            reason: "mapping_version_mismatch",
          }),
        )
      }
      const sourceOperations: Array<FinancialFactSnapshot["operations"][number]> = []
      const targetOperations: Array<FinancialFactSnapshot["operations"][number]> = []
      const sourceBalanceTotals = new Map<string, {
        readonly accountId: string
        readonly currency: string
        readonly mappingVersion: number
        debitsPostedMinor: bigint
        creditsPostedMinor: bigint
      }>()
      const sourceTransfers: Array<FinancialFactSnapshot["transfers"][number]> = []
      const targetTransfers: Array<FinancialFactSnapshot["transfers"][number]> = []
      const sourceProjections: Array<FinancialFactSnapshot["projections"][number]> = []
      const targetProjections: Array<FinancialFactSnapshot["projections"][number]> = []
      const orphanTransfers: Array<{
        readonly operationId: string
        readonly transferId: string
        readonly mappingVersion: number
      }> = []

      for (const operation of operations) {
        if (operation.currency !== configuration.baseCurrency) {
          return yield* Effect.fail(
            new FinancialReconciliationCheckpointEvidenceInvalid({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              reason: "scope_mismatch",
            }),
          )
        }
        sourceOperations.push({
          operationId: operation.operationId,
          status: operation.status === "intent"
            ? "intent"
            : operation.status === "submitted"
            ? "submitted"
            : operation.status === "accepted"
            ? "accepted"
            : operation.status === "unknown"
            ? "unknown"
            : operation.status === "manual_recovery"
            ? "manual_recovery"
            : "reconciled",
          currency: operation.currency,
          mappingVersion: operation.mappingVersion,
        })
        const lines = yield* database.query(
          (db) =>
            db.select({
              accountId: journalLines.accountId,
              debit: journalLines.debit,
              credit: journalLines.credit,
            }).from(journalLines).where(and(
              eq(journalLines.tenantId, decoded.tenantId),
              eq(journalLines.entryId, operation.journalId),
            )),
          "accounting.financial_reconciliation_checkpoint.lines",
        )
        const journalInput = {
          tenantId: decoded.tenantId,
          legalEntityId: operation.legalEntityId,
          operationId: operation.operationId,
          journalId: operation.journalId,
          reference: operation.reference,
          currency: operation.currency,
          mappingVersion: operation.mappingVersion,
          lines: lines.map((line) => ({
            accountId: line.accountId,
            debitMinor: toMinor(line.debit),
            creditMinor: toMinor(line.credit),
          })),
        }
        for (const line of journalInput.lines) {
          const key = `${line.accountId}:${operation.currency}:${operation.mappingVersion}`
          const current = sourceBalanceTotals.get(key) ?? {
            accountId: line.accountId,
            currency: operation.currency,
            mappingVersion: operation.mappingVersion,
            debitsPostedMinor: 0n,
            creditsPostedMinor: 0n,
          }
          current.debitsPostedMinor += BigInt(line.debitMinor)
          current.creditsPostedMinor += BigInt(line.creditMinor)
          sourceBalanceTotals.set(key, current)
        }
        const expectedTransferIds = yield* ledgerOption.value.expectedTransferIds(journalInput)
        const outcome = yield* ledgerOption.value.reconcileJournal(journalInput)
        const projected = yield* database.query(
          (db) =>
            db.select({
              position: financialOperationTransfers.position,
              debitAccountId: financialOperationTransfers.debitAccountId,
              creditAccountId: financialOperationTransfers.creditAccountId,
              amountMinor: financialOperationTransfers.amountMinor,
              engineTransferId: financialOperationTransfers.engineTransferId,
              status: financialOperationTransfers.status,
            }).from(financialOperationTransfers).where(and(
              eq(financialOperationTransfers.tenantId, decoded.tenantId),
              eq(financialOperationTransfers.operationId, operation.id),
            )),
          "accounting.financial_reconciliation_checkpoint.transfers",
        )
        projected.sort((left, right) => left.position - right.position)
        for (const transfer of projected) {
          sourceTransfers.push({
            operationId: operation.operationId,
            position: transfer.position,
            status: transfer.status,
            transferId: transfer.engineTransferId ?? expectedTransferIds[transfer.position] ??
              `missing:${transfer.position}`,
            debitAccountId: transfer.debitAccountId,
            creditAccountId: transfer.creditAccountId,
            amountMinor: String(transfer.amountMinor),
            currency: operation.currency,
            mappingVersion: operation.mappingVersion,
          })
        }
        const expectedJournalStatus = operation.operationType === "journal_reverse"
          ? "reversed"
          : "posted"
        sourceProjections.push({
          operationId: operation.operationId,
          journalStatus: operation.journalStatus,
          transferIds: projected.map((transfer) =>
            transfer.engineTransferId ?? expectedTransferIds[transfer.position] ??
              `missing:${transfer.position}`
          ),
        })
        if (outcome._tag === "accepted") {
          targetOperations.push({
            operationId: outcome.operationId,
            status: operation.status === "accepted" ? "accepted" : "reconciled",
            currency: operation.currency,
            mappingVersion: outcome.mappingVersion,
          })
          const expectedPairs = pairMinorTransfers(journalInput.lines)
          targetProjections.push({
            operationId: outcome.operationId,
            journalStatus: expectedJournalStatus,
            transferIds: outcome.transferIds,
          })
          for (const expectedPair of expectedPairs) {
            const transferId = outcome.transferIds[expectedPair.position]
            targetTransfers.push({
              operationId: outcome.operationId,
              position: expectedPair.position,
              status: "accepted",
              transferId: transferId ?? `missing:${expectedPair.position}`,
              debitAccountId: expectedPair.debitAccountId,
              creditAccountId: expectedPair.creditAccountId,
              amountMinor: expectedPair.amountMinor,
              currency: operation.currency,
              mappingVersion: outcome.mappingVersion,
            })
            if (transferId !== undefined && !expectedTransferIds.includes(transferId)) {
              orphanTransfers.push({
                operationId: operation.id,
                transferId,
                mappingVersion: operation.mappingVersion,
              })
            }
          }
          if (
            outcome.transferCount !== expectedTransferIds.length ||
            outcome.transferIds.length !== expectedTransferIds.length ||
            outcome.transferIds.some((id, index) => id !== expectedTransferIds[index])
          ) {
            for (const transferId of outcome.transferIds) {
              if (!expectedTransferIds.includes(transferId)) {
                orphanTransfers.push({
                  operationId: operation.id,
                  transferId,
                  mappingVersion: operation.mappingVersion,
                })
              }
            }
          }
        }
      }
      const sourceBalances: Array<FinancialFactSnapshot["balances"][number]> = []
      const targetBalances: Array<FinancialFactSnapshot["balances"][number]> = []
      for (const balance of sourceBalanceTotals.values()) {
        const sourceBalance = {
          accountId: balance.accountId,
          currency: balance.currency,
          mappingVersion: balance.mappingVersion,
          debitsPostedMinor: balance.debitsPostedMinor.toString(),
          creditsPostedMinor: balance.creditsPostedMinor.toString(),
        }
        sourceBalances.push(sourceBalance)
        const outcome = yield* ledgerOption.value.getBalance({
          tenantId: decoded.tenantId,
          legalEntityId: decoded.legalEntityId,
          accountId: balance.accountId,
          currency: balance.currency,
          mappingVersion: balance.mappingVersion,
        })
        if (outcome._tag === "available") {
          targetBalances.push({
            accountId: outcome.accountId,
            currency: balance.currency,
            mappingVersion: outcome.mappingVersion,
            debitsPostedMinor: outcome.debitsPostedMinor,
            creditsPostedMinor: outcome.creditsPostedMinor,
          })
        }
      }
      const source: FinancialFactSnapshot = {
        operations: sourceOperations,
        transfers: sourceTransfers,
        balances: sourceBalances,
        projections: sourceProjections,
      }
      const target: FinancialFactSnapshot = {
        operations: targetOperations,
        transfers: targetTransfers,
        balances: targetBalances,
        projections: targetProjections,
      }
      const uniqueOrphans = [...new Map(
        orphanTransfers.map((orphan) => [
          `${orphan.operationId}:${orphan.transferId}`,
          orphan,
        ]),
      ).values()]
      const evidence = yield* buildFinancialVerificationEvidence({
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        kind: "observability",
        completeness: "bounded",
        scope: `tenant:${decoded.tenantId}/legal-entity:${decoded.legalEntityId}`,
        mappingVersion: operations[0]?.mappingVersion ?? 1,
        currency: operations[0]?.currency ?? configuration.baseCurrency,
        sourceWatermark: decoded.sourceWatermark,
        targetWatermark: decoded.targetWatermark,
        sourceSnapshotRef: decoded.sourceSnapshotRef,
        targetSnapshotRef: decoded.targetSnapshotRef,
        source,
        target,
        startedAt: currentTime().toISOString(),
        completedAt: currentTime().toISOString(),
      }).pipe(
        Effect.catch(() =>
          Effect.fail(
            new DatabaseFailure({
              operation: "accounting.financial_reconciliation_checkpoint.hash",
              cause: "hash_failed",
            }),
          )
        ),
      )
      if (
        evidenceArtifactFactHashes !== undefined &&
        (evidenceArtifactFactHashes.operationSetHash !== evidence.operationSetHash ||
          evidenceArtifactFactHashes.accountBalanceHash !== evidence.accountBalanceHash ||
          evidenceArtifactFactHashes.transferSetHash !== evidence.transferSetHash ||
          evidenceArtifactFactHashes.projectionHash !== evidence.projectionHash)
      ) {
        return yield* Effect.fail(
          new FinancialReconciliationCheckpointEvidenceInvalid({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            reason: "hash_mismatch",
          }),
        )
      }
      const status = evidence.mismatchCount === 0 && uniqueOrphans.length === 0
        ? "verified"
        : "blocked"
      const checkedAt = currentTime()
      return yield* database.withTransaction(
        Effect.gen(function* () {
          const [checkpoint] = yield* database.query(
            (db) =>
              db.insert(financialReconciliationCheckpoints).values({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
                engine: authority,
                status,
                recoveryWatermark: decoded.recoveryWatermark,
                sourceWatermark: decoded.sourceWatermark,
                targetWatermark: decoded.targetWatermark,
                sourceSnapshotRef: decoded.sourceSnapshotRef,
                targetSnapshotRef: decoded.targetSnapshotRef,
                operationSetHash: evidence.operationSetHash,
                accountBalanceHash: evidence.accountBalanceHash,
                transferSetHash: evidence.transferSetHash,
                projectionHash: evidence.projectionHash,
                evidenceArtifactId: decoded.evidenceArtifactId,
                mismatchCount: evidence.mismatchCount,
                orphanCount: uniqueOrphans.length,
                checkedBy: decoded.principal.userAccountId,
                checkedAt,
              }).returning(),
            "accounting.financial_reconciliation_checkpoint.insert",
          )
          if (uniqueOrphans.length > 0) {
            yield* database.query(
              (db) =>
                db.insert(financialOrphanTransfers).values(uniqueOrphans.map((orphan) => ({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                  checkpointId: checkpoint!.id,
                  operationId: orphan.operationId,
                  transferId: orphan.transferId,
                  mappingVersion: orphan.mappingVersion,
                  status: "open" as const,
                  reason: "unexpected_provider_transfer",
                  detectedAt: checkedAt,
                }))),
              "accounting.financial_reconciliation_checkpoint.orphans",
            )
          }
          return toCheckpoint(checkpoint!)
        }),
        "accounting.financial_reconciliation_checkpoint.transaction",
      ).pipe(
        Effect.catchIf(
          (error) =>
            error instanceof DatabaseFailure &&
            isDatabaseConstraint(
              error,
              "financial_reconciliation_checkpoints_scope_watermark_key",
            ),
          () =>
            Effect.gen(function* () {
              const [winner] = yield* loadExistingCheckpoint()
              if (winner === undefined) {
                return yield* Effect.fail(
                  new DatabaseFailure({
                    operation: "accounting.financial_reconciliation_checkpoint.idempotency",
                    cause: "checkpoint winner disappeared",
                  }),
                )
              }
              if (!matchesCheckpointRequest(winner)) {
                return yield* Effect.fail(
                  new FinancialReconciliationCheckpointConflict({
                    tenantId: decoded.tenantId,
                    legalEntityId: decoded.legalEntityId,
                    recoveryWatermark: decoded.recoveryWatermark,
                  }),
                )
              }
              return toCheckpoint(winner)
            }),
        ),
      )
    })

  const rebuildFinancialProjections = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(RebuildFinancialProjectionInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: AccountingCapabilities.financialProjectionRebuild,
      })
      if (Option.isNone(ledgerOption)) {
        return yield* Effect.fail(new FinancialLedgerNotConfigured({}))
      }
      const authority = ledgerOption.value.authority
      const operations = yield* database.query(
        (db) =>
          db.select(operationSelection).from(financialOperations).where(and(
            eq(financialOperations.tenantId, decoded.tenantId),
            eq(financialOperations.legalEntityId, decoded.legalEntityId),
            eq(financialOperations.engine, authority),
            eq(financialOperations.engineVerified, true),
            inArray(financialOperations.status, ["accepted", "reconciled"]),
          )).orderBy(financialOperations.createdAt),
        "accounting.financial_projection_rebuild.operations",
      )
      let rebuiltOperations = 0
      let quarantinedOperations = 0
      for (const operation of operations) {
        const lines = yield* database.query(
          (db) =>
            db.select({
              accountId: journalLines.accountId,
              debit: journalLines.debit,
              credit: journalLines.credit,
            }).from(journalLines).where(and(
              eq(journalLines.tenantId, decoded.tenantId),
              eq(journalLines.entryId, operation.journalId),
            )),
          "accounting.financial_projection_rebuild.lines",
        )
        const journalInput = {
          tenantId: decoded.tenantId,
          legalEntityId: operation.legalEntityId,
          operationId: operation.operationId,
          journalId: operation.journalId,
          reference: operation.reference,
          currency: operation.currency,
          mappingVersion: operation.mappingVersion,
          lines: lines.map((line) => ({
            accountId: line.accountId,
            debitMinor: toMinor(line.debit),
            creditMinor: toMinor(line.credit),
          })),
        }
        const outcome = yield* ledgerOption.value.reconcileJournal(journalInput)
        if (outcome._tag === "accepted") {
          const expected = yield* ledgerOption.value.expectedTransferIds(journalInput)
          const expectedPairs = pairMinorTransfers(journalInput.lines)
          const identitiesMatch = outcome.operationId === operation.operationId &&
            outcome.mappingVersion === operation.mappingVersion &&
            outcome.transferCount === expected.length &&
            outcome.transferIds.length === expected.length &&
            outcome.transferIds.every((id, index) => id === expected[index]) &&
            expectedPairs.length === expected.length
          if (!identitiesMatch) {
            yield* quarantineProjection(decoded.tenantId, operation.operationId)
            quarantinedOperations += 1
            continue
          }
          const projected = yield* database.query(
            (db) =>
              db.select({
                position: financialOperationTransfers.position,
                debitAccountId: financialOperationTransfers.debitAccountId,
                creditAccountId: financialOperationTransfers.creditAccountId,
                amountMinor: financialOperationTransfers.amountMinor,
                engineTransferId: financialOperationTransfers.engineTransferId,
              }).from(financialOperationTransfers).where(and(
                eq(financialOperationTransfers.tenantId, decoded.tenantId),
                eq(financialOperationTransfers.operationId, operation.id),
              )),
            "accounting.financial_projection_rebuild.transfer_identity",
          )
          const projectedByPosition = new Map(
            projected.map((transfer) => [transfer.position, transfer]),
          )
          let projectionMismatch = false
          const missingTransfers: typeof expectedPairs = []
          for (const expectedPair of expectedPairs) {
            const existing = projectedByPosition.get(expectedPair.position)
            if (existing === undefined) {
              missingTransfers.push(expectedPair)
              continue
            }
            if (
              existing.debitAccountId !== expectedPair.debitAccountId ||
              existing.creditAccountId !== expectedPair.creditAccountId ||
              String(existing.amountMinor) !== expectedPair.amountMinor ||
              (existing.engineTransferId !== null &&
                existing.engineTransferId !== outcome.transferIds[expectedPair.position])
            ) projectionMismatch = true
          }
          const hasUnexpectedPosition = projected.some((transfer) =>
            !expectedPairs.some((expectedPair) => expectedPair.position === transfer.position)
          )
          if (
            projected.length > expectedPairs.length || hasUnexpectedPosition || projectionMismatch
          ) {
            yield* quarantineProjection(decoded.tenantId, operation.operationId)
            quarantinedOperations += 1
            continue
          }
          const rebuilt = yield* database.withTransaction(
            Effect.gen(function* () {
              for (const expectedPair of missingTransfers) {
                yield* database.query(
                  (db) =>
                    db.insert(financialOperationTransfers).values({
                      tenantId: decoded.tenantId,
                      operationId: operation.id,
                      position: expectedPair.position,
                      debitAccountId: expectedPair.debitAccountId,
                      creditAccountId: expectedPair.creditAccountId,
                      amountMinor: expectedPair.amountMinor,
                      engineTransferId: outcome.transferIds[expectedPair.position],
                      status: "unresolved",
                    }),
                  "accounting.financial_projection_rebuild.transfer_insert",
                )
              }
              return yield* rebuildAcceptedProjection(
                decoded.tenantId,
                operation.operationId,
                outcome,
              )
            }),
            "accounting.financial_projection_rebuild.operation",
          ).pipe(Effect.result)
          if (Result.isFailure(rebuilt)) {
            if (rebuilt.failure instanceof EventIdempotencyConflict) {
              yield* quarantineProjection(decoded.tenantId, operation.operationId)
              quarantinedOperations += 1
              continue
            }
            return yield* Effect.fail(rebuilt.failure)
          }
          rebuiltOperations += 1
          continue
        }
        if (outcome._tag === "manual_recovery" || outcome._tag === "rejected") {
          yield* quarantineProjection(decoded.tenantId, operation.operationId)
          quarantinedOperations += 1
          continue
        }
        return yield* Effect.fail(
          new FinancialProjectionRebuildBlocked({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            operationId: operation.operationId,
            reason: outcome.reason === "not_found" ? "not_found" : "unavailable",
          }),
        )
      }
      return {
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        checkedOperations: operations.length,
        rebuiltOperations,
        quarantinedOperations,
      }
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
          if (!current.engineVerified || current.engine !== ledgerOption.value.authority) {
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
            !current.engineVerified || current.engine !== ledgerOption.value.authority ||
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
      const accountRows = yield* database.query(
        (db) =>
          db.select({ id: accounts.id, type: accounts.type }).from(accounts).where(and(
            eq(accounts.tenantId, decoded.tenantId),
            inArray(accounts.id, accountIds),
          )),
        "accounting.financial_operation.submit.accounts",
      )
      const accountTypes = new Map(accountRows.map((account) => [account.id, account.type]))
      for (const accountId of accountIds) {
        const accountType = accountTypes.get(accountId)
        if (accountType === undefined) {
          return toOperation(
            yield* writeReceipt(decoded.operationId, decoded.tenantId, {
              _tag: "manual_recovery",
              operationId: decoded.operationId,
              reason: "mapping_mismatch",
            }, ledger.authority),
          )
        }
        const accountOutcome = yield* ledger.createExecutionAccount({
          tenantId: decoded.tenantId,
          legalEntityId: state.operation.legalEntityId,
          accountId,
          currency: state.operation.currency,
          mappingVersion: state.operation.mappingVersion,
          balanceConstraint: balanceConstraintForAccountType(accountType),
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
            yield* writeReceipt(
              decoded.operationId,
              decoded.tenantId,
              operationOutcome,
              ledger.authority,
            ),
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
      const expectedTransferIds = yield* ledger.expectedTransferIds(journalInput)
      const transferIdentitiesPersisted = yield* database.withTransaction(
        Effect.gen(function* () {
          const current = yield* loadOperationOrFail(decoded.tenantId, decoded.operationId, true)
          const rows = yield* database.query(
            (db) =>
              db.select({
                position: financialOperationTransfers.position,
                engineTransferId: financialOperationTransfers.engineTransferId,
              }).from(financialOperationTransfers).where(and(
                eq(financialOperationTransfers.tenantId, decoded.tenantId),
                eq(financialOperationTransfers.operationId, current.id),
              )),
            "accounting.financial_operation.submit.transfer_identities",
          )
          rows.sort((left, right) => left.position - right.position)
          if (rows.length !== expectedTransferIds.length) return false
          if (
            rows.some((row, index) =>
              row.engineTransferId !== null && row.engineTransferId !== expectedTransferIds[index]
            )
          ) return false
          for (const row of rows) {
            const transferId = expectedTransferIds[row.position]
            if (transferId === undefined || row.engineTransferId !== null) continue
            yield* database.query(
              (db) =>
                db.update(financialOperationTransfers).set({
                  engineTransferId: transferId,
                  updatedAt: currentTime(),
                }).where(and(
                  eq(financialOperationTransfers.tenantId, decoded.tenantId),
                  eq(financialOperationTransfers.operationId, current.id),
                  eq(financialOperationTransfers.position, row.position),
                )),
              "accounting.financial_operation.submit.transfer_identity",
            )
          }
          return true
        }),
        "accounting.financial_operation.submit.transfer_identities_transaction",
      )
      if (!transferIdentitiesPersisted) {
        return toOperation(
          yield* writeReceipt(decoded.operationId, decoded.tenantId, {
            _tag: "manual_recovery",
            operationId: decoded.operationId,
            reason: "mapping_mismatch",
          }, ledger.authority),
        )
      }
      yield* hit("before_provider_submission")
      let outcome = yield* (state.reconcile
        ? ledger.reconcileJournal(journalInput)
        : ledger.postJournal(journalInput))
      if (outcome._tag === "accepted") yield* hit("after_provider_acceptance")
      if (state.reconcile && outcome._tag === "unknown" && outcome.reason === "not_found") {
        outcome = yield* ledger.postJournal(journalInput)
      }
      if (outcome._tag === "accepted") {
        if (
          outcome.transferCount !== expectedTransferIds.length ||
          outcome.transferIds.length !== expectedTransferIds.length ||
          outcome.transferIds.some((id, index) =>
            id !== expectedTransferIds[index]
          )
        ) {
          outcome = {
            _tag: "manual_recovery",
            operationId: outcome.operationId,
            reason: "mapping_mismatch",
          }
        }
      }
      return toOperation(
        yield* writeReceipt(
          decoded.operationId,
          decoded.tenantId,
          outcome,
          ledger.authority,
        ),
      )
    })

  const createJournalIntent = (
    input: unknown,
    capability:
      | typeof AccountingCapabilities.journalPost
      | typeof AccountingCapabilities.revenuePost = AccountingCapabilities.journalPost,
    operationTypeOverride?: "journal_post" | "journal_reverse" | "revenue_post",
  ) =>
    Effect.gen(function* () {
      const selectedAuthority = Option.isSome(ledgerOption)
        ? ledgerOption.value.authority
        : undefined
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
      yield* hit("before_intent_commit")
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
          const [cutover] = yield* database.query(
            (db) =>
              db.select({ status: financialCutoverControls.status })
                .from(financialCutoverControls).where(and(
                  eq(financialCutoverControls.tenantId, decoded.tenantId),
                  eq(financialCutoverControls.legalEntityId, decoded.legalEntityId),
                )).for("update"),
            "accounting.financial_operation.intent.cutover",
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
          if (
            configuration === undefined ||
            (selectedAuthority !== undefined &&
              configuration.financialEngine !== selectedAuthority) ||
            cutover?.status !== configuration.financialEngine
          ) {
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
              sourceOperation.engine !== configuration.financialEngine ||
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
                engine: configuration.financialEngine,
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
      yield* hit("after_intent_commit")
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
    reconcileFinancialCheckpoint,
    rebuildFinancialProjections,
  } satisfies FinancialOperationService
})

export const FinancialOperationServiceLive = Layer.effect(
  FinancialOperationService,
  makeFinancialOperationService,
)
