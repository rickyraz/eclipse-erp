import * as Schema from "effect/Schema"

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
