import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { FINANCIAL_LEDGER_MAX_MINOR } from "../../kernel/mod.ts"
import { EventEnvelope } from "../../messaging/mod.ts"

export const FinancialFailurePoint = Schema.Literals([
  "A_before_intent_commit",
  "B_after_intent_before_submission",
  "C_submission_outcome_unknown",
  "D_response_lost_after_acceptance",
  "E_process_dies_after_acceptance_before_receipt",
  "F_accepted_before_journal_projection",
  "G_projected_before_outbox",
  "H_partial_finalization",
  "I_worker_lease_held",
  "J_worker_restart",
  "K_duplicate_workers",
  "L_tigerbeetle_unavailable",
  "M_postgresql_unavailable",
])
export type FinancialFailurePoint = Schema.Schema.Type<typeof FinancialFailurePoint>

export type FinancialFailureMatrixRow = Readonly<{
  readonly point: FinancialFailurePoint
  readonly expectedPostgresState: string
  readonly expectedTigerBeetleState: string
  readonly safeRetryAction: string
  readonly reconciliationAction: string
  readonly terminalCondition: string
}>

export type FinancialFailureExecutionRow = Readonly<{
  readonly point: FinancialFailurePoint
  readonly mode: "accounting_failpoint" | "provider_fault" | "worker_failpoint" | "database_fault"
  readonly hook: string
  readonly recovery: string
}>

export const financialFailureExecutionMatrix: readonly FinancialFailureExecutionRow[] = [
  {
    point: "A_before_intent_commit",
    mode: "accounting_failpoint",
    hook: "before_intent_commit",
    recovery: "same intent",
  },
  {
    point: "B_after_intent_before_submission",
    mode: "accounting_failpoint",
    hook: "after_intent_commit",
    recovery: "same job",
  },
  {
    point: "C_submission_outcome_unknown",
    mode: "provider_fault",
    hook: "failBeforeSubmissionFor",
    recovery: "same IDs",
  },
  {
    point: "D_response_lost_after_acceptance",
    mode: "provider_fault",
    hook: "loseResponseFor",
    recovery: "reconcile same IDs",
  },
  {
    point: "E_process_dies_after_acceptance_before_receipt",
    mode: "accounting_failpoint",
    hook: "after_provider_acceptance",
    recovery: "reconcile same operation",
  },
  {
    point: "F_accepted_before_journal_projection",
    mode: "accounting_failpoint",
    hook: "before_projection_commit",
    recovery: "finalize only",
  },
  {
    point: "G_projected_before_outbox",
    mode: "accounting_failpoint",
    hook: "before_outbox_append",
    recovery: "same event identity",
  },
  {
    point: "H_partial_finalization",
    mode: "accounting_failpoint",
    hook: "before_receipt_commit",
    recovery: "finalize only",
  },
  {
    point: "I_worker_lease_held",
    mode: "worker_failpoint",
    hook: "after_lease_before_accounting",
    recovery: "lease expiry and reclaim",
  },
  {
    point: "J_worker_restart",
    mode: "worker_failpoint",
    hook: "after_accounting_before_job_completion",
    recovery: "new worker and lease token",
  },
  {
    point: "K_duplicate_workers",
    mode: "worker_failpoint",
    hook: "before_job_completion",
    recovery: "stale lease rejected",
  },
  {
    point: "L_tigerbeetle_unavailable",
    mode: "provider_fault",
    hook: "unavailableFor",
    recovery: "bounded retry",
  },
  {
    point: "M_postgresql_unavailable",
    mode: "database_fault",
    hook: "financial_operation.receipt",
    recovery: "retry last committed state",
  },
] as const

/**
 * The application-side protocol is intentionally more conservative than a
 * transport retry: unknown never means rejected, and accepted facts are only
 * completed by reconciliation/finalization.
 */
export const financialFailureMatrix: readonly FinancialFailureMatrixRow[] = [
  {
    point: "A_before_intent_commit",
    expectedPostgresState: "no financial operation",
    expectedTigerBeetleState: "no submission",
    safeRetryAction: "retry the authorized intent with the same operation identity",
    reconciliationAction: "none",
    terminalCondition: "none",
  },
  {
    point: "B_after_intent_before_submission",
    expectedPostgresState: "intent + pending submit job",
    expectedTigerBeetleState: "no known transfer",
    safeRetryAction: "lease the same job and submit the same transfer IDs",
    reconciliationAction: "none unless submission outcome becomes unknown",
    terminalCondition: "routing or authorization drift moves the intent to manual recovery",
  },
  {
    point: "C_submission_outcome_unknown",
    expectedPostgresState: "submitted or unknown",
    expectedTigerBeetleState: "unknown",
    safeRetryAction: "lookup the same IDs; never allocate replacement IDs",
    reconciliationAction: "lookup exact transfer identities and metadata",
    terminalCondition: "verified mismatch or unresolved bounded retry requires manual recovery",
  },
  {
    point: "D_response_lost_after_acceptance",
    expectedPostgresState: "unknown",
    expectedTigerBeetleState: "accepted",
    safeRetryAction: "reconcile with the same IDs, then finalize",
    reconciliationAction: "lookup all expected transfers and metadata",
    terminalCondition: "missing/conflicting facts require manual recovery",
  },
  {
    point: "E_process_dies_after_acceptance_before_receipt",
    expectedPostgresState: "submitted or unknown; no posted projection",
    expectedTigerBeetleState: "accepted",
    safeRetryAction: "resume the durable job using the same operation and transfer IDs",
    reconciliationAction: "lookup, persist accepted receipt, then finalize",
    terminalCondition: "manual recovery only after bounded reconciliation failure",
  },
  {
    point: "F_accepted_before_journal_projection",
    expectedPostgresState: "accepted + draft journal + unresolved transfer projections",
    expectedTigerBeetleState: "accepted",
    safeRetryAction: "retry finalization; do not submit again",
    reconciliationAction: "reapply the accepted projection transaction",
    terminalCondition: "projection invariant mismatch requires quarantine",
  },
  {
    point: "G_projected_before_outbox",
    expectedPostgresState: "accepted projection without durable event, transaction retryable",
    expectedTigerBeetleState: "accepted",
    safeRetryAction: "retry the same outbox/event idempotency key",
    reconciliationAction: "verify projection and append the existing event identity",
    terminalCondition: "event identity conflict requires manual recovery",
  },
  {
    point: "H_partial_finalization",
    expectedPostgresState: "transaction rollback or accepted retry state",
    expectedTigerBeetleState: "accepted",
    safeRetryAction: "retry finalization only",
    reconciliationAction: "rebuild the operation projection from exact engine facts",
    terminalCondition: "irreconcilable projection mismatch requires manual recovery",
  },
  {
    point: "I_worker_lease_held",
    expectedPostgresState: "job leased; operation remains durable",
    expectedTigerBeetleState: "unchanged or unknown",
    safeRetryAction: "wait for lease expiry/fencing, then retry same job identity",
    reconciliationAction: "operation status determines submit versus lookup",
    terminalCondition: "expired lease with no valid owner is retryable, not a new operation",
  },
  {
    point: "J_worker_restart",
    expectedPostgresState: "durable operation/job state",
    expectedTigerBeetleState: "unchanged or accepted",
    safeRetryAction: "new worker claims the fenced job",
    reconciliationAction: "submit/lookup according to durable operation state",
    terminalCondition: "invalid lease token is rejected by Process",
  },
  {
    point: "K_duplicate_workers",
    expectedPostgresState: "one fenced lease and one operation identity",
    expectedTigerBeetleState: "at most one accepted transfer set",
    safeRetryAction: "only the current lease holder may complete/fail the job",
    reconciliationAction: "same IDs make duplicate engine submission idempotent",
    terminalCondition: "conflicting replay or lease fencing failure requires review",
  },
  {
    point: "L_tigerbeetle_unavailable",
    expectedPostgresState: "submitted/unknown with bounded retry",
    expectedTigerBeetleState: "unknown",
    safeRetryAction: "bounded retry/lookup with the same IDs; never PostgreSQL fallback",
    reconciliationAction: "resume after availability returns",
    terminalCondition: "retry budget exhausted becomes manual recovery",
  },
  {
    point: "M_postgresql_unavailable",
    expectedPostgresState: "last committed durable state",
    expectedTigerBeetleState: "unchanged; no cross-store rollback",
    safeRetryAction: "retry the PostgreSQL operation or job with the same identity",
    reconciliationAction: "compare accepted engine facts after PostgreSQL recovery",
    terminalCondition: "restore divergence fences posting until watermark verification",
  },
] as const

export type OpeningBalance = Readonly<{
  readonly legalEntityId: string
  readonly accountId: string
  readonly currency: string
  readonly mappingVersion: number
  readonly debitsMinor: string
  readonly creditsMinor: string
}>

export type OpeningBalanceMismatch = Readonly<{
  readonly key: string
  readonly kind:
    | "missing_source"
    | "missing_target"
    | "field_mismatch"
    | "invalid_amount"
    | "duplicate"
  readonly source?: OpeningBalance
  readonly target?: OpeningBalance
  readonly fields?: readonly string[]
}>

const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const MinorAmount = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/))
const PositiveMinorAmount = Schema.String.check(
  Schema.makeFilter(
    (value) => /^[1-9][0-9]*$/.test(value) && BigInt(value) <= FINANCIAL_LEDGER_MAX_MINOR,
    { expected: "a positive unsigned 128-bit minor amount" },
  ),
)
const Count = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 0x7fffffff }),
)
const PositiveInt = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }),
)
const PositiveSmallInt = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 0x7fff }),
)
const InstantString = EventEnvelope.fields.occurredAt

export const FinancialVerificationEvidence = Schema.Struct({
  tenantId: Schema.String.check(Schema.isUUID()),
  legalEntityId: Schema.String.check(Schema.isUUID()),
  kind: Schema.Literals([
    "opening_balance",
    "historical_boundary",
    "backup_restore",
    "failure_matrix",
    "projection_rebuild",
    "cutover_rehearsal",
    "observability",
  ]),
  completeness: Schema.Literals(["bounded", "full", "fenced"]),
  scope: Schema.String.check(Schema.isPattern(/\S/)),
  schemaVersion: PositiveSmallInt,
  mappingVersion: PositiveSmallInt,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  sourceWatermark: Schema.String.check(Schema.isPattern(/\S/)),
  targetWatermark: Schema.String.check(Schema.isPattern(/\S/)),
  sourceSnapshotRef: Schema.String.check(Schema.isPattern(/\S/)),
  targetSnapshotRef: Schema.String.check(Schema.isPattern(/\S/)),
  operationSetHash: Hash,
  accountBalanceHash: Hash,
  transferSetHash: Hash,
  projectionHash: Schema.NullOr(Hash),
  sourceDebitMinor: MinorAmount,
  sourceCreditMinor: MinorAmount,
  targetDebitMinor: MinorAmount,
  targetCreditMinor: MinorAmount,
  accountCount: Count,
  operationCount: Count,
  transferCount: Count,
  mismatchCount: Count,
  startedAt: InstantString,
  completedAt: InstantString,
}).check(Schema.makeFilter(
  (evidence) => Date.parse(evidence.completedAt) >= Date.parse(evidence.startedAt),
  { expected: "completedAt at or after startedAt" },
))
export type FinancialVerificationEvidence = Schema.Schema.Type<typeof FinancialVerificationEvidence>

const evidenceKeys = [
  "tenantId",
  "legalEntityId",
  "kind",
  "completeness",
  "scope",
  "schemaVersion",
  "mappingVersion",
  "currency",
  "sourceWatermark",
  "targetWatermark",
  "sourceSnapshotRef",
  "targetSnapshotRef",
  "operationSetHash",
  "accountBalanceHash",
  "transferSetHash",
  "projectionHash",
  "sourceDebitMinor",
  "sourceCreditMinor",
  "targetDebitMinor",
  "targetCreditMinor",
  "accountCount",
  "operationCount",
  "transferCount",
  "mismatchCount",
  "startedAt",
  "completedAt",
] as const

/** Fixed-key ordering makes the artifact hash stable across property insertion order. */
export const canonicalizeFinancialVerificationEvidence = (
  evidence: FinancialVerificationEvidence,
) => JSON.stringify(evidenceKeys.map((key) => [key, evidence[key]]))

export const hashFinancialVerificationEvidence = (
  evidence: FinancialVerificationEvidence,
) =>
  Effect.promise(async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalizeFinancialVerificationEvidence(evidence)),
      ),
    )
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })

export type OpeningBalanceVerification = Readonly<{
  readonly ok: boolean
  readonly sourceCount: number
  readonly targetCount: number
  readonly sourceDebitMinor: string
  readonly targetDebitMinor: string
  readonly sourceCreditMinor: string
  readonly targetCreditMinor: string
  readonly mismatches: readonly OpeningBalanceMismatch[]
}>

const amountPattern = /^(0|[1-9]\d*)$/
const openingKey = (entry: OpeningBalance) =>
  `${entry.legalEntityId}:${entry.accountId}:${entry.currency.toUpperCase()}:${entry.mappingVersion}`

const amount = (value: string) => amountPattern.test(value) ? BigInt(value) : undefined

const sum = (entries: readonly OpeningBalance[], field: "debitsMinor" | "creditsMinor") =>
  entries.reduce((total, entry) => total + (amount(entry[field]) ?? 0n), 0n)

/** Exact account-level comparison; no tolerance is applied to integer ledger amounts. */
export const FinancialOperationFact = Schema.Struct({
  operationId: Schema.String.check(Schema.isPattern(/\S/)),
  status: Schema.Literals([
    "intent",
    "submitted",
    "accepted",
    "unknown",
    "manual_recovery",
    "reconciled",
  ]),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  mappingVersion: PositiveInt,
})
export type FinancialOperationFact = Schema.Schema.Type<typeof FinancialOperationFact>

export const FinancialTransferFact = Schema.Struct({
  operationId: Schema.String.check(Schema.isPattern(/\S/)),
  position: Count,
  status: Schema.Literals(["unresolved", "accepted", "rejected", "manual_recovery"]),
  transferId: Schema.String.check(Schema.isPattern(/\S/)),
  debitAccountId: Schema.String.check(Schema.isPattern(/\S/)),
  creditAccountId: Schema.String.check(Schema.isPattern(/\S/)),
  amountMinor: PositiveMinorAmount,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  mappingVersion: PositiveInt,
}).check(Schema.makeFilter(
  (transfer) => transfer.debitAccountId !== transfer.creditAccountId,
  { expected: "financial transfer accounts must be distinct" },
))
export type FinancialTransferFact = Schema.Schema.Type<typeof FinancialTransferFact>

export const FinancialBalanceFact = Schema.Struct({
  accountId: Schema.String.check(Schema.isPattern(/\S/)),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  mappingVersion: PositiveInt,
  debitsPostedMinor: MinorAmount,
  creditsPostedMinor: MinorAmount,
})
export type FinancialBalanceFact = Schema.Schema.Type<typeof FinancialBalanceFact>

export const FinancialProjectionFact = Schema.Struct({
  operationId: Schema.String.check(Schema.isPattern(/\S/)),
  journalStatus: Schema.Literals(["draft", "posted", "reversed"]),
  transferIds: Schema.Array(Schema.String.check(Schema.isPattern(/\S/))),
})
export type FinancialProjectionFact = Schema.Schema.Type<typeof FinancialProjectionFact>

export const FinancialFactSnapshot = Schema.Struct({
  operations: Schema.Array(FinancialOperationFact),
  transfers: Schema.Array(FinancialTransferFact),
  balances: Schema.Array(FinancialBalanceFact),
  projections: Schema.Array(FinancialProjectionFact),
})
export type FinancialFactSnapshot = Schema.Schema.Type<typeof FinancialFactSnapshot>

export type FinancialFactMismatch = Readonly<{
  kind:
    | "missing_operation"
    | "unexpected_operation"
    | "operation_mismatch"
    | "missing_transfer"
    | "unexpected_transfer"
    | "transfer_mismatch"
    | "balance_mismatch"
    | "projection_mismatch"
  key: string
  detail: string
}>

const factKey = (...parts: readonly (string | number)[]) => parts.join(":")
const sortedJson = (value: unknown) => JSON.stringify(value)

export const compareFinancialFactSnapshots = (
  source: FinancialFactSnapshot,
  target: FinancialFactSnapshot,
): Readonly<{ ok: boolean; mismatches: readonly FinancialFactMismatch[] }> => {
  const mismatches: FinancialFactMismatch[] = []
  const sourceOperations = new Map(source.operations.map((fact) => [fact.operationId, fact]))
  const targetOperations = new Map(target.operations.map((fact) => [fact.operationId, fact]))
  for (const [operationId, sourceFact] of sourceOperations) {
    const targetFact = targetOperations.get(operationId)
    if (targetFact === undefined) {
      mismatches.push({ kind: "missing_operation", key: operationId, detail: "target" })
    } else if (sortedJson(sourceFact) !== sortedJson(targetFact)) {
      mismatches.push({ kind: "operation_mismatch", key: operationId, detail: "metadata" })
    }
  }
  for (const operationId of targetOperations.keys()) {
    if (!sourceOperations.has(operationId)) {
      mismatches.push({ kind: "unexpected_operation", key: operationId, detail: "target" })
    }
  }

  const sourceTransfers = new Map(
    source.transfers.map((fact) => [factKey(fact.operationId, fact.position), fact]),
  )
  const targetTransfers = new Map(
    target.transfers.map((fact) => [factKey(fact.operationId, fact.position), fact]),
  )
  for (const [key, sourceFact] of sourceTransfers) {
    const targetFact = targetTransfers.get(key)
    if (targetFact === undefined) {
      mismatches.push({ kind: "missing_transfer", key, detail: "target" })
    } else if (sortedJson(sourceFact) !== sortedJson(targetFact)) {
      mismatches.push({ kind: "transfer_mismatch", key, detail: "identity_or_amount" })
    }
  }
  for (const key of targetTransfers.keys()) {
    if (!sourceTransfers.has(key)) {
      mismatches.push({ kind: "unexpected_transfer", key, detail: "target" })
    }
  }

  const sourceBalances = new Map(
    source.balances.map((
      fact,
    ) => [factKey(fact.accountId, fact.currency, fact.mappingVersion), fact]),
  )
  const targetBalances = new Map(
    target.balances.map((
      fact,
    ) => [factKey(fact.accountId, fact.currency, fact.mappingVersion), fact]),
  )
  for (const [key, sourceFact] of sourceBalances) {
    const targetFact = targetBalances.get(key)
    if (targetFact === undefined || sortedJson(sourceFact) !== sortedJson(targetFact)) {
      mismatches.push({
        kind: "balance_mismatch",
        key,
        detail: targetFact === undefined ? "missing" : "amount",
      })
    }
  }
  for (const key of targetBalances.keys()) {
    if (!sourceBalances.has(key)) {
      mismatches.push({ kind: "balance_mismatch", key, detail: "unexpected" })
    }
  }

  const sourceProjections = new Map(source.projections.map((fact) => [fact.operationId, fact]))
  const targetProjections = new Map(target.projections.map((fact) => [fact.operationId, fact]))
  for (const [key, sourceFact] of sourceProjections) {
    const targetFact = targetProjections.get(key)
    if (targetFact === undefined || sortedJson(sourceFact) !== sortedJson(targetFact)) {
      mismatches.push({
        kind: "projection_mismatch",
        key,
        detail: targetFact === undefined ? "missing" : "state",
      })
    }
  }
  for (const key of targetProjections.keys()) {
    if (!sourceProjections.has(key)) {
      mismatches.push({ kind: "projection_mismatch", key, detail: "unexpected" })
    }
  }
  return { ok: mismatches.length === 0, mismatches }
}

const hashJson = (value: unknown) =>
  Effect.promise(async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
    )
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })

export const hashFinancialFactSnapshot = (snapshot: FinancialFactSnapshot) =>
  hashJson({
    operations: [...snapshot.operations].toSorted((a, b) =>
      a.operationId.localeCompare(b.operationId)
    ),
    transfers: [...snapshot.transfers].toSorted((a, b) =>
      factKey(a.operationId, a.position).localeCompare(factKey(b.operationId, b.position))
    ),
    balances: [...snapshot.balances].toSorted((a, b) =>
      factKey(a.accountId, a.currency, a.mappingVersion).localeCompare(
        factKey(b.accountId, b.currency, b.mappingVersion),
      )
    ),
    projections: [...snapshot.projections].toSorted((a, b) =>
      a.operationId.localeCompare(b.operationId)
    ),
  })

export type FinancialVerificationEvidenceSource = Readonly<{
  tenantId: string
  legalEntityId: string
  kind: FinancialVerificationEvidence["kind"]
  completeness: FinancialVerificationEvidence["completeness"]
  scope: string
  mappingVersion: number
  currency: string
  sourceWatermark: string
  targetWatermark: string
  sourceSnapshotRef: string
  targetSnapshotRef: string
  source: FinancialFactSnapshot
  target: FinancialFactSnapshot
  startedAt: string
  completedAt: string
}>

const sumBalance = (
  balances: readonly FinancialBalanceFact[],
  field: "debitsPostedMinor" | "creditsPostedMinor",
) => balances.reduce((sum, balance) => sum + BigInt(balance[field]), 0n).toString()

export const buildFinancialVerificationEvidence = (
  input: FinancialVerificationEvidenceSource,
) =>
  Effect.gen(function* () {
    const comparison = compareFinancialFactSnapshots(input.source, input.target)
    const [operationSetHash, accountBalanceHash, transferSetHash, projectionHash] = yield* Effect
      .all([
        hashJson(input.source.operations),
        hashJson(input.source.balances),
        hashJson(input.source.transfers),
        hashJson(input.source.projections),
      ])
    return {
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      kind: input.kind,
      completeness: input.completeness,
      scope: input.scope,
      schemaVersion: 1,
      mappingVersion: input.mappingVersion,
      currency: input.currency.toUpperCase(),
      sourceWatermark: input.sourceWatermark,
      targetWatermark: input.targetWatermark,
      sourceSnapshotRef: input.sourceSnapshotRef,
      targetSnapshotRef: input.targetSnapshotRef,
      operationSetHash,
      accountBalanceHash,
      transferSetHash,
      projectionHash,
      sourceDebitMinor: sumBalance(input.source.balances, "debitsPostedMinor"),
      sourceCreditMinor: sumBalance(input.source.balances, "creditsPostedMinor"),
      targetDebitMinor: sumBalance(input.target.balances, "debitsPostedMinor"),
      targetCreditMinor: sumBalance(input.target.balances, "creditsPostedMinor"),
      accountCount: input.source.balances.length,
      operationCount: input.source.operations.length,
      transferCount: input.source.transfers.length,
      mismatchCount: comparison.mismatches.length,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    } satisfies FinancialVerificationEvidence
  })

export const verifyOpeningBalances = (
  source: readonly OpeningBalance[],
  target: readonly OpeningBalance[],
): OpeningBalanceVerification => {
  const sourceByKey = new Map(source.map((entry) => [openingKey(entry), entry]))
  const targetByKey = new Map(target.map((entry) => [openingKey(entry), entry]))
  const sourceCounts = new Map<string, number>()
  const targetCounts = new Map<string, number>()
  for (const entry of source) {
    sourceCounts.set(openingKey(entry), (sourceCounts.get(openingKey(entry)) ?? 0) + 1)
  }
  for (const entry of target) {
    targetCounts.set(openingKey(entry), (targetCounts.get(openingKey(entry)) ?? 0) + 1)
  }
  const mismatches: OpeningBalanceMismatch[] = []
  const keys = new Set([...sourceByKey.keys(), ...targetByKey.keys()])

  for (const key of [...keys].sort()) {
    const sourceEntry = sourceByKey.get(key)
    const targetEntry = targetByKey.get(key)
    if ((sourceCounts.get(key) ?? 0) > 1 || (targetCounts.get(key) ?? 0) > 1) {
      mismatches.push({ key, kind: "duplicate", source: sourceEntry, target: targetEntry })
      continue
    }
    if (sourceEntry === undefined) {
      mismatches.push({ key, kind: "missing_source", target: targetEntry })
      continue
    }
    if (targetEntry === undefined) {
      mismatches.push({ key, kind: "missing_target", source: sourceEntry })
      continue
    }
    const fields = (Object.keys(sourceEntry) as (keyof OpeningBalance)[]).filter((field) => {
      if (field === "currency") {
        return sourceEntry[field].toUpperCase() !== targetEntry[field].toUpperCase()
      }
      return sourceEntry[field] !== targetEntry[field]
    })
    if (
      amount(sourceEntry.debitsMinor) === undefined ||
      amount(sourceEntry.creditsMinor) === undefined ||
      amount(targetEntry.debitsMinor) === undefined ||
      amount(targetEntry.creditsMinor) === undefined
    ) {
      mismatches.push({ key, kind: "invalid_amount", source: sourceEntry, target: targetEntry })
    } else if (fields.length > 0) {
      mismatches.push({
        key,
        kind: "field_mismatch",
        source: sourceEntry,
        target: targetEntry,
        fields,
      })
    }
  }

  const sourceDebitMinor = sum(source, "debitsMinor").toString()
  const targetDebitMinor = sum(target, "debitsMinor").toString()
  const sourceCreditMinor = sum(source, "creditsMinor").toString()
  const targetCreditMinor = sum(target, "creditsMinor").toString()
  return {
    ok: mismatches.length === 0 && sourceDebitMinor === targetDebitMinor &&
      sourceCreditMinor === targetCreditMinor,
    sourceCount: source.length,
    targetCount: target.length,
    sourceDebitMinor,
    targetDebitMinor,
    sourceCreditMinor,
    targetCreditMinor,
    mismatches,
  }
}
