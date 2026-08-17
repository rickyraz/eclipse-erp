import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type {
  Account as TigerBeetleAccount,
  Client as TigerBeetleClient,
  ClientInitArgs,
  CreateAccountResult as TigerBeetleCreateAccountResult,
  CreateTransferResult as TigerBeetleCreateTransferResult,
  Transfer as TigerBeetleTransfer,
} from "tigerbeetle-node"

type TigerBeetleRuntime = Pick<
  typeof import("tigerbeetle-node"),
  "AccountFlags" | "CreateAccountStatus" | "CreateTransferStatus" | "TransferFlags" | "createClient"
>

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }))
const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))
const MinorAmount = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)$/))
const FinancialAccountConstraint = Schema.Literals([
  "none",
  "debits_must_not_exceed_credits",
  "credits_must_not_exceed_debits",
])

const CreateExecutionAccountInput = Schema.Struct({
  tenantId: NonEmptyString,
  legalEntityId: NonEmptyString,
  accountId: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInteger,
  balanceConstraint: Schema.optionalKey(FinancialAccountConstraint),
})

const FinancialJournalLine = Schema.Struct({
  accountId: NonEmptyString,
  debitMinor: MinorAmount,
  creditMinor: MinorAmount,
})

const PostFinancialJournalInput = Schema.Struct({
  tenantId: NonEmptyString,
  legalEntityId: NonEmptyString,
  operationId: NonEmptyString,
  journalId: NonEmptyString,
  reference: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInteger,
  lines: Schema.Array(FinancialJournalLine),
})

const GetFinancialBalanceInput = Schema.Struct({
  tenantId: NonEmptyString,
  legalEntityId: NonEmptyString,
  accountId: NonEmptyString,
  currency: CurrencyCode,
  mappingVersion: PositiveInteger,
})

type CreateExecutionAccountInput = Schema.Schema.Type<typeof CreateExecutionAccountInput>
type PostFinancialJournalInput = Schema.Schema.Type<typeof PostFinancialJournalInput>
type GetFinancialBalanceInput = Schema.Schema.Type<typeof GetFinancialBalanceInput>
type FinancialJournalLine = Schema.Schema.Type<typeof FinancialJournalLine>
type FinancialAccountConstraint = Schema.Schema.Type<typeof FinancialAccountConstraint>

type ExecutionAccountOutcome =
  | {
    readonly _tag: "accepted"
    readonly accountId: string
    readonly mappingVersion: number
    readonly acceptedAt: string
  }
  | {
    readonly _tag: "rejected"
    readonly accountId: string
    readonly reason: "invalid_account" | "invalid_amount" | "unbalanced" | "constraint_violation"
  }
  | {
    readonly _tag: "unknown"
    readonly accountId: string
    readonly reason: "unavailable" | "response_lost"
  }
  | {
    readonly _tag: "manual_recovery"
    readonly accountId: string
    readonly reason: "mapping_mismatch" | "conflicting_replay" | "reconciliation_required"
  }

type FinancialExecutionOutcome =
  | {
    readonly _tag: "accepted"
    readonly operationId: string
    readonly mappingVersion: number
    readonly acceptedAt: string
    readonly transferCount: number
    readonly transferIds: readonly string[]
  }
  | {
    readonly _tag: "rejected"
    readonly operationId: string
    readonly reason: "invalid_account" | "invalid_amount" | "unbalanced" | "constraint_violation"
  }
  | {
    readonly _tag: "unknown"
    readonly operationId: string
    readonly reason: "unavailable" | "response_lost" | "not_found"
  }
  | {
    readonly _tag: "manual_recovery"
    readonly operationId: string
    readonly reason: "mapping_mismatch" | "conflicting_replay" | "reconciliation_required"
  }

type FinancialBalanceOutcome =
  | {
    readonly _tag: "available"
    readonly accountId: string
    readonly mappingVersion: number
    readonly debitsPendingMinor: string
    readonly debitsPostedMinor: string
    readonly creditsPendingMinor: string
    readonly creditsPostedMinor: string
  }
  | { readonly _tag: "not_found"; readonly accountId: string }
  | {
    readonly _tag: "unknown"
    readonly accountId: string
    readonly reason: "unavailable" | "response_lost"
  }
  | {
    readonly _tag: "manual_recovery"
    readonly accountId: string
    readonly reason: "mapping_mismatch" | "conflicting_replay" | "reconciliation_required"
  }

export interface TigerBeetleFinancialLedgerConfig {
  readonly clusterId: bigint
  readonly replicaAddresses: readonly (string | number)[]
  readonly ledger: number
  readonly code: number
  readonly currency: string
}

export class TigerBeetleConfigurationFailure
  extends Schema.TaggedErrorClass<TigerBeetleConfigurationFailure>()(
    "TigerBeetleConfigurationFailure",
    {
      reason: Schema.Literals(["invalid_configuration", "client_initialization_failed"]),
    },
  ) {}

export interface TigerBeetleFinancialLedger {
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

export type TigerBeetleClientFactory = (args: ClientInitArgs) => TigerBeetleClient

const U128_MAX = (1n << 128n) - 1n

const makeConfigurationFailure = (
  reason: "invalid_configuration" | "client_initialization_failed",
) => new TigerBeetleConfigurationFailure({ reason })

const isValidConfig = (config: TigerBeetleFinancialLedgerConfig) =>
  config.clusterId >= 0n && config.clusterId <= U128_MAX && config.replicaAddresses.length > 0 &&
  Number.isInteger(config.ledger) && config.ledger > 0 && config.ledger <= 0xffff_ffff &&
  Number.isInteger(config.code) && config.code > 0 && config.code <= 0xffff_ffff &&
  /^[A-Z]{3}$/.test(config.currency)

const digestId = (parts: readonly string[]) =>
  Effect.promise(async () => {
    const data = new TextEncoder().encode(
      JSON.stringify(["eclipse-erp/tigerbeetle", "v1", ...parts]),
    )
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
    let value = 0n
    for (const byte of digest.slice(0, 16)) value = (value << 8n) | BigInt(byte)
    return value === 0n || value === U128_MAX ? 1n : value
  })

const accountId = (input: CreateExecutionAccountInput | GetFinancialBalanceInput) =>
  digestId([
    "account",
    input.mappingVersion.toString(),
    input.tenantId,
    input.legalEntityId,
    input.accountId,
    input.currency.toUpperCase(),
  ])

const transferId = (input: PostFinancialJournalInput, index: number) =>
  digestId([
    "transfer",
    input.mappingVersion.toString(),
    input.tenantId,
    input.legalEntityId,
    input.operationId,
    index.toString(),
  ])

const balanceConstraintFlags = (
  constraint: FinancialAccountConstraint | undefined,
  runtime: TigerBeetleRuntime,
) => {
  switch (constraint ?? "none") {
    case "debits_must_not_exceed_credits":
      return runtime.AccountFlags.debits_must_not_exceed_credits
    case "credits_must_not_exceed_debits":
      return runtime.AccountFlags.credits_must_not_exceed_debits
    case "none":
      return runtime.AccountFlags.none
  }
}

const acceptedTimestamp = (timestamp: bigint) => timestamp.toString()

const accountOutcome = (
  input: CreateExecutionAccountInput,
  result: TigerBeetleCreateAccountResult,
  runtime: TigerBeetleRuntime,
): ExecutionAccountOutcome => {
  if (
    result.status === runtime.CreateAccountStatus.created ||
    result.status === runtime.CreateAccountStatus.exists
  ) {
    return {
      _tag: "accepted",
      accountId: input.accountId,
      mappingVersion: input.mappingVersion,
      acceptedAt: acceptedTimestamp(result.timestamp),
    }
  }
  if (
    result.status === runtime.CreateAccountStatus.exists_with_different_flags ||
    result.status === runtime.CreateAccountStatus.exists_with_different_user_data_128 ||
    result.status === runtime.CreateAccountStatus.exists_with_different_user_data_64 ||
    result.status === runtime.CreateAccountStatus.exists_with_different_user_data_32 ||
    result.status === runtime.CreateAccountStatus.exists_with_different_ledger ||
    result.status === runtime.CreateAccountStatus.exists_with_different_code
  ) {
    return { _tag: "manual_recovery", accountId: input.accountId, reason: "mapping_mismatch" }
  }
  return { _tag: "rejected", accountId: input.accountId, reason: "constraint_violation" }
}

const rejectionReason = (
  status: TigerBeetleCreateTransferResult["status"],
  runtime: TigerBeetleRuntime,
) => {
  switch (status) {
    case runtime.CreateTransferStatus.debit_account_not_found:
    case runtime.CreateTransferStatus.credit_account_not_found:
    case runtime.CreateTransferStatus.debit_account_already_closed:
    case runtime.CreateTransferStatus.credit_account_already_closed:
      return "invalid_account" as const
    case runtime.CreateTransferStatus.accounts_must_be_different:
    case runtime.CreateTransferStatus.debit_account_id_must_not_be_zero:
    case runtime.CreateTransferStatus.credit_account_id_must_not_be_zero:
    case runtime.CreateTransferStatus.id_must_not_be_zero:
    case runtime.CreateTransferStatus.id_must_not_be_int_max:
    case runtime.CreateTransferStatus.overflows_debits_pending:
    case runtime.CreateTransferStatus.overflows_credits_pending:
    case runtime.CreateTransferStatus.overflows_debits_posted:
    case runtime.CreateTransferStatus.overflows_credits_posted:
    case runtime.CreateTransferStatus.overflows_debits:
    case runtime.CreateTransferStatus.overflows_credits:
    case runtime.CreateTransferStatus.exceeds_credits:
    case runtime.CreateTransferStatus.exceeds_debits:
    case runtime.CreateTransferStatus.id_already_failed:
      return "constraint_violation" as const
    default:
      return "constraint_violation" as const
  }
}

const isConflictingReplay = (
  status: TigerBeetleCreateTransferResult["status"],
  runtime: TigerBeetleRuntime,
) =>
  [
    runtime.CreateTransferStatus.exists_with_different_flags,
    runtime.CreateTransferStatus.exists_with_different_pending_id,
    runtime.CreateTransferStatus.exists_with_different_timeout,
    runtime.CreateTransferStatus.exists_with_different_debit_account_id,
    runtime.CreateTransferStatus.exists_with_different_credit_account_id,
    runtime.CreateTransferStatus.exists_with_different_amount,
    runtime.CreateTransferStatus.exists_with_different_user_data_128,
    runtime.CreateTransferStatus.exists_with_different_user_data_64,
    runtime.CreateTransferStatus.exists_with_different_user_data_32,
    runtime.CreateTransferStatus.exists_with_different_ledger,
    runtime.CreateTransferStatus.exists_with_different_code,
  ].includes(status)

const journalValidation = (
  input: PostFinancialJournalInput,
): FinancialExecutionOutcome | undefined => {
  if (input.lines.length < 2) {
    return { _tag: "rejected", operationId: input.operationId, reason: "unbalanced" }
  }
  let debit = 0n
  let credit = 0n
  for (const line of input.lines) {
    const lineDebit = BigInt(line.debitMinor)
    const lineCredit = BigInt(line.creditMinor)
    if (lineDebit > U128_MAX || lineCredit > U128_MAX) {
      return { _tag: "rejected", operationId: input.operationId, reason: "invalid_amount" }
    }
    if ((lineDebit > 0n) === (lineCredit > 0n)) {
      return { _tag: "rejected", operationId: input.operationId, reason: "invalid_amount" }
    }
    debit += lineDebit
    credit += lineCredit
  }
  return debit === credit
    ? undefined
    : { _tag: "rejected", operationId: input.operationId, reason: "unbalanced" }
}

type TransferPair = {
  readonly debitAccountId: string
  readonly creditAccountId: string
  readonly amount: bigint
}

const pairLines = (lines: readonly FinancialJournalLine[]): readonly TransferPair[] => {
  const debits = lines
    .filter((line) => BigInt(line.debitMinor) > 0n)
    .map((line) => ({ accountId: line.accountId, remaining: BigInt(line.debitMinor) }))
  const credits = lines
    .filter((line) => BigInt(line.creditMinor) > 0n)
    .map((line) => ({ accountId: line.accountId, remaining: BigInt(line.creditMinor) }))
  const pairs: TransferPair[] = []
  let debitIndex = 0
  let creditIndex = 0
  while (debitIndex < debits.length && creditIndex < credits.length) {
    const debit = debits[debitIndex]!
    const credit = credits[creditIndex]!
    const amount = debit.remaining < credit.remaining ? debit.remaining : credit.remaining
    pairs.push({
      debitAccountId: debit.accountId,
      creditAccountId: credit.accountId,
      amount,
    })
    debit.remaining -= amount
    credit.remaining -= amount
    if (debit.remaining === 0n) debitIndex += 1
    if (credit.remaining === 0n) creditIndex += 1
  }
  return pairs
}

const maxTimestamp = (results: readonly { timestamp: bigint }[]) =>
  results.reduce((max, result) => result.timestamp > max ? result.timestamp : max, 0n)

const makeAdapter = (
  client: TigerBeetleClient,
  config: TigerBeetleFinancialLedgerConfig,
  runtime: TigerBeetleRuntime,
): TigerBeetleFinancialLedger => ({
  createExecutionAccount: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateExecutionAccountInput)(input)
      if (decoded.currency.toUpperCase() !== config.currency.toUpperCase()) {
        return {
          _tag: "manual_recovery" as const,
          accountId: decoded.accountId,
          reason: "mapping_mismatch" as const,
        }
      }
      const id = yield* accountId(decoded)
      const account: TigerBeetleAccount = {
        id,
        debits_pending: 0n,
        debits_posted: 0n,
        credits_pending: 0n,
        credits_posted: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: decoded.mappingVersion,
        reserved: 0,
        ledger: config.ledger,
        code: config.code,
        flags: runtime.AccountFlags.history |
          balanceConstraintFlags(decoded.balanceConstraint, runtime),
        timestamp: 0n,
      }
      const results = yield* Effect.tryPromise({
        try: () => client.createAccounts([account]),
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
      const result = results?.[0]
      if (result === undefined) {
        return {
          _tag: "unknown" as const,
          accountId: decoded.accountId,
          reason: "response_lost" as const,
        }
      }
      if (result.status === runtime.CreateAccountStatus.exists) {
        const existingAccounts = yield* Effect.tryPromise({
          try: () => client.lookupAccounts([id]),
          catch: (cause) => cause,
        }).pipe(Effect.catch(() => Effect.succeed(null)))
        const existing = existingAccounts?.find((candidate) => candidate.id === id)
        const expectedFlags = account.flags
        if (
          existing === undefined ||
          existing.ledger !== account.ledger ||
          existing.code !== account.code ||
          existing.user_data_128 !== account.user_data_128 ||
          existing.user_data_64 !== account.user_data_64 ||
          existing.user_data_32 !== account.user_data_32 ||
          existing.reserved !== account.reserved ||
          existing.flags !== expectedFlags
        ) {
          return {
            _tag: "manual_recovery" as const,
            accountId: decoded.accountId,
            reason: "mapping_mismatch" as const,
          }
        }
      }
      return accountOutcome(decoded, result, runtime)
    }),
  expectedTransferIds: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
      const pairs = pairLines(decoded.lines)
      return yield* Effect.all(pairs.map((_, index) => transferId(decoded, index))).pipe(
        Effect.map((ids) => ids.map((id) => id.toString())),
      )
    }),
  postJournal: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
      if (decoded.currency.toUpperCase() !== config.currency.toUpperCase()) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "mapping_mismatch" as const,
        }
      }
      const validation = journalValidation(decoded)
      if (validation !== undefined) return validation
      const pairs = pairLines(decoded.lines)
      if (
        pairs.length === 0 || pairs.some((pair) => pair.debitAccountId === pair.creditAccountId)
      ) {
        return {
          _tag: "rejected" as const,
          operationId: decoded.operationId,
          reason: "constraint_violation" as const,
        }
      }
      const transfers: TigerBeetleTransfer[] = []
      for (const [index, pair] of pairs.entries()) {
        const [debitId, creditId, id] = yield* Effect.all([
          accountId({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            accountId: pair.debitAccountId,
            currency: decoded.currency,
            mappingVersion: decoded.mappingVersion,
          }),
          accountId({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            accountId: pair.creditAccountId,
            currency: decoded.currency,
            mappingVersion: decoded.mappingVersion,
          }),
          transferId(decoded, index),
        ])
        transfers.push({
          id,
          debit_account_id: debitId,
          credit_account_id: creditId,
          amount: pair.amount,
          pending_id: 0n,
          user_data_128: 0n,
          user_data_64: 0n,
          user_data_32: decoded.mappingVersion,
          timeout: 0,
          ledger: config.ledger,
          code: config.code,
          flags: index < pairs.length - 1
            ? runtime.TransferFlags.linked
            : runtime.TransferFlags.none,
          timestamp: 0n,
        })
      }
      const results = yield* Effect.tryPromise({
        try: () => client.createTransfers(transfers),
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
      if (results === null || results.length !== transfers.length) {
        return {
          _tag: "unknown" as const,
          operationId: decoded.operationId,
          reason: "response_lost" as const,
        }
      }
      const conflict = results.find((result) => isConflictingReplay(result.status, runtime))
      if (conflict !== undefined) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "conflicting_replay" as const,
        }
      }
      const rejection = results.find((result) =>
        result.status !== runtime.CreateTransferStatus.created &&
        result.status !== runtime.CreateTransferStatus.exists
      )
      if (rejection !== undefined) {
        return {
          _tag: "rejected" as const,
          operationId: decoded.operationId,
          reason: rejectionReason(rejection.status, runtime),
        }
      }
      return {
        _tag: "accepted" as const,
        operationId: decoded.operationId,
        mappingVersion: decoded.mappingVersion,
        acceptedAt: acceptedTimestamp(maxTimestamp(results)),
        transferCount: transfers.length,
        transferIds: transfers.map((transfer) => transfer.id.toString()),
      }
    }),
  reconcileJournal: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
      if (decoded.currency.toUpperCase() !== config.currency.toUpperCase()) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "mapping_mismatch" as const,
        }
      }
      const validation = journalValidation(decoded)
      if (validation !== undefined) return validation
      const pairs = pairLines(decoded.lines)
      if (
        pairs.length === 0 || pairs.some((pair) => pair.debitAccountId === pair.creditAccountId)
      ) {
        return {
          _tag: "rejected" as const,
          operationId: decoded.operationId,
          reason: "constraint_violation" as const,
        }
      }
      const expected = yield* Effect.all(
        pairs.map((pair, index) =>
          Effect.all([
            accountId({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              accountId: pair.debitAccountId,
              currency: decoded.currency,
              mappingVersion: decoded.mappingVersion,
            }),
            accountId({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              accountId: pair.creditAccountId,
              currency: decoded.currency,
              mappingVersion: decoded.mappingVersion,
            }),
            transferId(decoded, index),
          ]).pipe(Effect.map(([debitId, creditId, id]) => ({
            debitId,
            creditId,
            id,
            amount: pair.amount,
          })))
        ),
      )
      const transfers = yield* Effect.tryPromise({
        try: () => client.lookupTransfers(expected.map((transfer) => transfer.id)),
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
      if (transfers === null) {
        return {
          _tag: "unknown" as const,
          operationId: decoded.operationId,
          reason: "unavailable" as const,
        }
      }
      if (transfers.length === 0) {
        return {
          _tag: "unknown" as const,
          operationId: decoded.operationId,
          reason: "not_found" as const,
        }
      }
      if (transfers.length !== expected.length) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "mapping_mismatch" as const,
        }
      }
      const byId = new Map(transfers.map((transfer) => [transfer.id.toString(), transfer]))
      const mismatch = expected.some((expectedTransfer, index) => {
        const actual = byId.get(expectedTransfer.id.toString())
        if (actual === undefined) return true
        const expectedFlags = index < expected.length - 1
          ? runtime.TransferFlags.linked
          : runtime.TransferFlags.none
        return actual.debit_account_id !== expectedTransfer.debitId ||
          actual.credit_account_id !== expectedTransfer.creditId ||
          actual.amount !== expectedTransfer.amount ||
          actual.pending_id !== 0n ||
          actual.user_data_128 !== 0n ||
          actual.user_data_64 !== 0n ||
          actual.timeout !== 0 ||
          actual.ledger !== config.ledger ||
          actual.code !== config.code ||
          actual.user_data_32 !== decoded.mappingVersion ||
          actual.flags !== expectedFlags
      })
      if (mismatch) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "mapping_mismatch" as const,
        }
      }
      return {
        _tag: "accepted" as const,
        operationId: decoded.operationId,
        mappingVersion: decoded.mappingVersion,
        acceptedAt: acceptedTimestamp(maxTimestamp(transfers)),
        transferCount: expected.length,
        transferIds: expected.map((transfer) => transfer.id.toString()),
      }
    }),
  getBalance: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(GetFinancialBalanceInput)(input)
      if (decoded.currency.toUpperCase() !== config.currency.toUpperCase()) {
        return {
          _tag: "manual_recovery" as const,
          accountId: decoded.accountId,
          reason: "mapping_mismatch" as const,
        }
      }
      const id = yield* accountId(decoded)
      const accounts = yield* Effect.tryPromise({
        try: () => client.lookupAccounts([id]),
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
      if (accounts === null) {
        return {
          _tag: "unknown" as const,
          accountId: decoded.accountId,
          reason: "unavailable" as const,
        }
      }
      const account = accounts.find((candidate) => candidate.id === id)
      if (account === undefined) {
        return { _tag: "not_found" as const, accountId: decoded.accountId }
      }
      const requiredHistoryFlag = runtime.AccountFlags.history
      if (
        account.ledger !== config.ledger || account.code !== config.code ||
        account.user_data_128 !== 0n || account.user_data_64 !== 0n ||
        account.user_data_32 !== decoded.mappingVersion || account.reserved !== 0 ||
        (account.flags & requiredHistoryFlag) !== requiredHistoryFlag
      ) {
        return {
          _tag: "manual_recovery" as const,
          accountId: decoded.accountId,
          reason: "mapping_mismatch" as const,
        }
      }
      return {
        _tag: "available" as const,
        accountId: decoded.accountId,
        mappingVersion: decoded.mappingVersion,
        debitsPendingMinor: account.debits_pending.toString(),
        debitsPostedMinor: account.debits_posted.toString(),
        creditsPendingMinor: account.credits_pending.toString(),
        creditsPostedMinor: account.credits_posted.toString(),
      }
    }),
})

export const makeTigerBeetleFinancialLedger = (
  config: TigerBeetleFinancialLedgerConfig,
  clientFactory?: TigerBeetleClientFactory,
) => {
  if (!isValidConfig(config)) {
    return Effect.fail(makeConfigurationFailure("invalid_configuration"))
  }
  return Effect.gen(function* () {
    const runtime = yield* Effect.tryPromise({
      try: () => import("tigerbeetle-node"),
      catch: () => makeConfigurationFailure("client_initialization_failed"),
    })
    const client = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          (clientFactory ?? runtime.createClient)({
            cluster_id: config.clusterId,
            replica_addresses: [...config.replicaAddresses],
          }),
        catch: () => makeConfigurationFailure("client_initialization_failed"),
      }),
      (client) => Effect.sync(() => client.destroy()),
    )
    return makeAdapter(client, config, runtime)
  })
}
