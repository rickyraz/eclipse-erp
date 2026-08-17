import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }))
const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))
const MinorAmount = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)$/))

export const FinancialAccountConstraint = Schema.Literals([
  "none",
  "debits_must_not_exceed_credits",
  "credits_must_not_exceed_debits",
])

export const CreateExecutionAccountInput = Schema.Struct({
  tenantId: NonEmptyString,
  legalEntityId: NonEmptyString,
  accountId: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInteger,
  balanceConstraint: Schema.optionalKey(FinancialAccountConstraint),
})

export const FinancialJournalLine = Schema.Struct({
  accountId: NonEmptyString,
  debitMinor: MinorAmount,
  creditMinor: MinorAmount,
})

export const PostFinancialJournalInput = Schema.Struct({
  tenantId: NonEmptyString,
  legalEntityId: NonEmptyString,
  operationId: NonEmptyString,
  journalId: NonEmptyString,
  reference: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInteger,
  lines: Schema.Array(FinancialJournalLine),
})

export const GetFinancialBalanceInput = Schema.Struct({
  tenantId: NonEmptyString,
  legalEntityId: NonEmptyString,
  accountId: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInteger,
})

export const FinancialRejectionReason = Schema.Literals([
  "invalid_account",
  "invalid_amount",
  "unbalanced",
  "constraint_violation",
])

export const FinancialManualRecoveryReason = Schema.Literals([
  "mapping_mismatch",
  "conflicting_replay",
  "reconciliation_required",
  "engine_routing_changed",
])

export const ExecutionAccountOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("accepted"),
    accountId: NonEmptyString,
    mappingVersion: PositiveInteger,
    acceptedAt: NonEmptyString,
  }),
  Schema.Struct({
    _tag: Schema.Literal("rejected"),
    accountId: NonEmptyString,
    reason: FinancialRejectionReason,
  }),
  Schema.Struct({
    _tag: Schema.Literal("unknown"),
    accountId: NonEmptyString,
    reason: Schema.Literals(["unavailable", "response_lost"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("manual_recovery"),
    accountId: NonEmptyString,
    reason: FinancialManualRecoveryReason,
  }),
])

export const FinancialExecutionOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("accepted"),
    operationId: NonEmptyString,
    mappingVersion: PositiveInteger,
    acceptedAt: NonEmptyString,
    transferCount: PositiveInteger,
    transferIds: Schema.Array(NonEmptyString).check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    _tag: Schema.Literal("rejected"),
    operationId: NonEmptyString,
    reason: FinancialRejectionReason,
  }),
  Schema.Struct({
    _tag: Schema.Literal("unknown"),
    operationId: NonEmptyString,
    reason: Schema.Literals(["unavailable", "response_lost", "not_found"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("manual_recovery"),
    operationId: NonEmptyString,
    reason: FinancialManualRecoveryReason,
  }),
])

export const FinancialBalanceOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("available"),
    accountId: NonEmptyString,
    mappingVersion: PositiveInteger,
    debitsPendingMinor: MinorAmount,
    debitsPostedMinor: MinorAmount,
    creditsPendingMinor: MinorAmount,
    creditsPostedMinor: MinorAmount,
  }),
  Schema.Struct({
    _tag: Schema.Literal("not_found"),
    accountId: NonEmptyString,
  }),
  Schema.Struct({
    _tag: Schema.Literal("unknown"),
    accountId: NonEmptyString,
    reason: Schema.Literals(["unavailable", "response_lost"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("manual_recovery"),
    accountId: NonEmptyString,
    reason: FinancialManualRecoveryReason,
  }),
])

export type FinancialAccountConstraint = Schema.Schema.Type<typeof FinancialAccountConstraint>
export type CreateExecutionAccountInput = Schema.Schema.Type<typeof CreateExecutionAccountInput>
export type FinancialJournalLine = Schema.Schema.Type<typeof FinancialJournalLine>
export type PostFinancialJournalInput = Schema.Schema.Type<typeof PostFinancialJournalInput>
export type GetFinancialBalanceInput = Schema.Schema.Type<typeof GetFinancialBalanceInput>
export type ExecutionAccountOutcome = Schema.Schema.Type<typeof ExecutionAccountOutcome>
export type FinancialExecutionOutcome = Schema.Schema.Type<typeof FinancialExecutionOutcome>
export type FinancialBalanceOutcome = Schema.Schema.Type<typeof FinancialBalanceOutcome>

export interface FinancialLedgerPort {
  readonly createExecutionAccount: (
    input: unknown,
  ) => Effect.Effect<ExecutionAccountOutcome, Schema.SchemaError>
  readonly postJournal: (
    input: unknown,
  ) => Effect.Effect<FinancialExecutionOutcome, Schema.SchemaError>
  readonly reconcileJournal: (
    input: unknown,
  ) => Effect.Effect<FinancialExecutionOutcome, Schema.SchemaError>
  readonly expectedTransferIds: (
    input: unknown,
  ) => Effect.Effect<readonly string[], Schema.SchemaError>
  readonly getBalance: (
    input: unknown,
  ) => Effect.Effect<FinancialBalanceOutcome, Schema.SchemaError>
}

export const FinancialLedgerPort = Context.Service<FinancialLedgerPort>(
  "EclipseERP/FinancialLedgerPort",
)

type TestAdapterOptions = Readonly<{
  readonly loseResponseFor?: string
  readonly failBeforeSubmissionFor?: string
  readonly unavailableFor?: string
  readonly corruptTransferIdsFor?: string
}>

const U128_MAX = (1n << 128n) - 1n

const accountKey = (input: CreateExecutionAccountInput | GetFinancialBalanceInput) =>
  `${input.tenantId}:${input.legalEntityId}:${input.accountId}:${input.currency.toUpperCase()}:${input.mappingVersion}`

const operationKey = (input: PostFinancialJournalInput) =>
  `${input.tenantId}:${input.legalEntityId}:${input.operationId}`

const expectedTestTransferIds = (input: PostFinancialJournalInput) => {
  const debits = input.lines.filter((line) => BigInt(line.debitMinor) > 0n).map((line) =>
    BigInt(line.debitMinor)
  )
  const credits = input.lines.filter((line) => BigInt(line.creditMinor) > 0n).map((line) =>
    BigInt(line.creditMinor)
  )
  let debitIndex = 0
  let creditIndex = 0
  let transferCount = 0
  while (debitIndex < debits.length && creditIndex < credits.length) {
    const amount = debits[debitIndex]! < credits[creditIndex]!
      ? debits[debitIndex]!
      : credits[creditIndex]!
    debits[debitIndex] = debits[debitIndex]! - amount
    credits[creditIndex] = credits[creditIndex]! - amount
    if (debits[debitIndex] === 0n) debitIndex += 1
    if (credits[creditIndex] === 0n) creditIndex += 1
    transferCount += 1
  }
  return Array.from(
    { length: transferCount },
    (_, index) => `transfer:${operationKey(input)}:${index}`,
  )
}

const normalizeLines = (lines: readonly FinancialJournalLine[]) =>
  lines.map((line) => `${line.accountId}:${line.debitMinor}:${line.creditMinor}`)

const parseMinor = (value: string) => BigInt(value)

const sameAccountInput = (
  left: CreateExecutionAccountInput,
  right: CreateExecutionAccountInput,
) =>
  left.tenantId === right.tenantId && left.legalEntityId === right.legalEntityId &&
  left.accountId === right.accountId &&
  left.currency.toUpperCase() === right.currency.toUpperCase() &&
  left.mappingVersion === right.mappingVersion &&
  (left.balanceConstraint ?? "none") === (right.balanceConstraint ?? "none")

const violatesConstraint = (
  account: CreateExecutionAccountInput,
  balance: { debitsPostedMinor: bigint; creditsPostedMinor: bigint },
) => {
  switch (account.balanceConstraint ?? "none") {
    case "debits_must_not_exceed_credits":
      return balance.debitsPostedMinor > balance.creditsPostedMinor
    case "credits_must_not_exceed_debits":
      return balance.creditsPostedMinor > balance.debitsPostedMinor
    case "none":
      return false
  }
}

const validateJournal = (
  input: PostFinancialJournalInput,
): FinancialExecutionOutcome | undefined => {
  if (input.lines.length < 2) {
    return { _tag: "rejected", operationId: input.operationId, reason: "unbalanced" }
  }

  let debit = 0n
  let credit = 0n
  for (const line of input.lines) {
    const lineDebit = parseMinor(line.debitMinor)
    const lineCredit = parseMinor(line.creditMinor)
    if (
      lineDebit > U128_MAX || lineCredit > U128_MAX ||
      (lineDebit > 0n) === (lineCredit > 0n)
    ) {
      return { _tag: "rejected", operationId: input.operationId, reason: "invalid_amount" }
    }
    debit += lineDebit
    credit += lineCredit
    if (debit > U128_MAX || credit > U128_MAX) {
      return { _tag: "rejected", operationId: input.operationId, reason: "invalid_amount" }
    }
  }
  return debit === credit
    ? undefined
    : { _tag: "rejected", operationId: input.operationId, reason: "unbalanced" }
}

export const makeFinancialLedgerTestLayer = (options: TestAdapterOptions = {}) =>
  Layer.effect(
    FinancialLedgerPort,
    Effect.sync(() => {
      const accounts = new Map<string, CreateExecutionAccountInput>()
      const balances = new Map<string, {
        debitsPostedMinor: bigint
        creditsPostedMinor: bigint
      }>()
      const operations = new Map<
        string,
        { fingerprint: string; outcome: FinancialExecutionOutcome }
      >()
      const lost = new Set<string>()
      return {
        createExecutionAccount: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateExecutionAccountInput)(input)
            const key = accountKey(decoded)
            const existing = accounts.get(key)
            if (existing !== undefined) {
              return sameAccountInput(existing, decoded)
                ? {
                  _tag: "accepted" as const,
                  accountId: decoded.accountId,
                  mappingVersion: decoded.mappingVersion,
                  acceptedAt: "0",
                }
                : {
                  _tag: "manual_recovery" as const,
                  accountId: decoded.accountId,
                  reason: "mapping_mismatch" as const,
                }
            }
            accounts.set(key, decoded)
            balances.set(key, { debitsPostedMinor: 0n, creditsPostedMinor: 0n })
            return {
              _tag: "accepted" as const,
              accountId: decoded.accountId,
              mappingVersion: decoded.mappingVersion,
              acceptedAt: "0",
            }
          }),
        expectedTransferIds: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
            return expectedTestTransferIds(decoded)
          }),
        postJournal: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
            if (options.unavailableFor === decoded.operationId) {
              return {
                _tag: "unknown" as const,
                operationId: decoded.operationId,
                reason: "unavailable" as const,
              }
            }
            if (options.failBeforeSubmissionFor === decoded.operationId) {
              return {
                _tag: "unknown" as const,
                operationId: decoded.operationId,
                reason: "response_lost" as const,
              }
            }
            const validation = validateJournal(decoded)
            if (validation !== undefined) return validation
            const accountInputs = [...accounts.values()].filter((account) =>
              account.tenantId === decoded.tenantId &&
              account.legalEntityId === decoded.legalEntityId &&
              account.currency.toUpperCase() === decoded.currency.toUpperCase() &&
              account.mappingVersion === decoded.mappingVersion
            )
            const accountIds = new Set(
              [...accounts.values()]
                .filter((account) =>
                  account.tenantId === decoded.tenantId &&
                  account.legalEntityId === decoded.legalEntityId &&
                  account.currency.toUpperCase() === decoded.currency.toUpperCase() &&
                  account.mappingVersion === decoded.mappingVersion
                )
                .map((account) => account.accountId),
            )
            if (decoded.lines.some((line) => !accountIds.has(line.accountId))) {
              return {
                _tag: "rejected" as const,
                operationId: decoded.operationId,
                reason: "invalid_account" as const,
              }
            }
            const key = operationKey(decoded)
            const fingerprint = JSON.stringify({
              journalId: decoded.journalId,
              reference: decoded.reference,
              currency: decoded.currency.toUpperCase(),
              mappingVersion: decoded.mappingVersion,
              lines: normalizeLines(decoded.lines),
            })
            const existing = operations.get(key)
            if (existing !== undefined) {
              if (existing.fingerprint !== fingerprint) {
                return {
                  _tag: "manual_recovery" as const,
                  operationId: decoded.operationId,
                  reason: "conflicting_replay" as const,
                }
              }
              return existing.outcome
            }
            const pairs = expectedTestTransferIds(decoded)
            const lineBalances = new Map<string, {
              debitsPostedMinor: bigint
              creditsPostedMinor: bigint
            }>()
            for (const line of decoded.lines) {
              const balanceKey = accountKey({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
                accountId: line.accountId,
                currency: decoded.currency,
                mappingVersion: decoded.mappingVersion,
              })
              const current = balances.get(balanceKey)
              const account = accountInputs.find((candidate) =>
                candidate.accountId === line.accountId
              )
              if (current === undefined || account === undefined) continue
              const next = {
                debitsPostedMinor: current.debitsPostedMinor + BigInt(line.debitMinor),
                creditsPostedMinor: current.creditsPostedMinor + BigInt(line.creditMinor),
              }
              if (
                next.debitsPostedMinor > U128_MAX || next.creditsPostedMinor > U128_MAX ||
                violatesConstraint(account, next)
              ) {
                return {
                  _tag: "rejected" as const,
                  operationId: decoded.operationId,
                  reason: "constraint_violation" as const,
                }
              }
              lineBalances.set(balanceKey, next)
            }
            if (
              pairs.length === 0 || decoded.lines.some((line) => {
                const debit = BigInt(line.debitMinor)
                return debit > 0n &&
                  decoded.lines.some((candidate) =>
                    candidate.accountId === line.accountId && BigInt(candidate.creditMinor) > 0n
                  )
              })
            ) {
              return {
                _tag: "rejected" as const,
                operationId: decoded.operationId,
                reason: "constraint_violation" as const,
              }
            }
            for (const [balanceKey, next] of lineBalances) balances.set(balanceKey, next)
            const transferIds = pairs
            const returnedTransferIds = options.corruptTransferIdsFor === decoded.operationId
              ? transferIds.map((id, index) => index === 0 ? `${id}:corrupt` : id)
              : transferIds
            const outcome: FinancialExecutionOutcome = {
              _tag: "accepted",
              operationId: decoded.operationId,
              mappingVersion: decoded.mappingVersion,
              acceptedAt: "0",
              transferCount: returnedTransferIds.length,
              transferIds: returnedTransferIds,
            }
            operations.set(key, { fingerprint, outcome })
            if (options.loseResponseFor === decoded.operationId && !lost.has(key)) {
              lost.add(key)
              return {
                _tag: "unknown" as const,
                operationId: decoded.operationId,
                reason: "response_lost" as const,
              }
            }
            return outcome
          }),
        reconcileJournal: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
            if (options.unavailableFor === decoded.operationId) {
              return {
                _tag: "unknown" as const,
                operationId: decoded.operationId,
                reason: "unavailable" as const,
              }
            }
            const existing = operations.get(operationKey(decoded))
            if (existing === undefined) {
              return {
                _tag: "unknown" as const,
                operationId: decoded.operationId,
                reason: "not_found" as const,
              }
            }
            const fingerprint = JSON.stringify({
              journalId: decoded.journalId,
              reference: decoded.reference,
              currency: decoded.currency.toUpperCase(),
              mappingVersion: decoded.mappingVersion,
              lines: normalizeLines(decoded.lines),
            })
            return existing.fingerprint === fingerprint ? existing.outcome : {
              _tag: "manual_recovery" as const,
              operationId: decoded.operationId,
              reason: "conflicting_replay" as const,
            }
          }),
        getBalance: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(GetFinancialBalanceInput)(input)
            const exists = [...accounts.values()].some((account) =>
              accountKey(account) === accountKey(decoded)
            )
            const balance = balances.get(accountKey(decoded))
            return exists && balance !== undefined
              ? {
                _tag: "available" as const,
                accountId: decoded.accountId,
                mappingVersion: decoded.mappingVersion,
                debitsPendingMinor: "0",
                debitsPostedMinor: balance.debitsPostedMinor.toString(),
                creditsPendingMinor: "0",
                creditsPostedMinor: balance.creditsPostedMinor.toString(),
              }
              : { _tag: "not_found" as const, accountId: decoded.accountId }
          }),
      } satisfies FinancialLedgerPort
    }),
  )
