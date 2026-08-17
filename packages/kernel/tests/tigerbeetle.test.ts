import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
  type Account,
  type Client,
  CreateAccountStatus,
  CreateTransferStatus,
  type Transfer,
  TransferFlags,
} from "tigerbeetle-node"

import {
  makeTigerBeetleFinancialLedger,
  TigerBeetleConfigurationFailure,
  type TigerBeetleFinancialLedgerConfig,
} from "../mod.ts"

const config: TigerBeetleFinancialLedgerConfig = {
  clusterId: 0n,
  replicaAddresses: [3000],
  ledger: 1,
  code: 1,
  currency: "USD",
}

const accountInput = (accountId: string, mappingVersion = 1) => ({
  tenantId: "tenant-a",
  legalEntityId: "legal-entity-a",
  accountId,
  currency: "USD",
  mappingVersion,
})

const journalInput = (operationId = "operation-1", amount = "12500", mappingVersion = 1) => ({
  tenantId: "tenant-a",
  legalEntityId: "legal-entity-a",
  operationId,
  journalId: "journal-1",
  reference: "SALE-1",
  currency: "USD",
  mappingVersion,
  lines: [
    { accountId: "cash", debitMinor: amount, creditMinor: "0" },
    { accountId: "revenue", debitMinor: "0", creditMinor: amount },
  ],
})

type FakeState = {
  readonly accounts: Map<bigint, Account>
  readonly transfers: Map<bigint, Transfer>
  readonly createdTransfers: Transfer[]
  nextTimestamp: bigint
  failNextTransferResponse: boolean
  destroyed: boolean
}

const sameAccount = (left: Account, right: Account) =>
  left.id === right.id &&
  left.user_data_32 === right.user_data_32 &&
  left.ledger === right.ledger &&
  left.code === right.code &&
  left.flags === right.flags

const sameTransfer = (left: Transfer, right: Transfer) =>
  left.id === right.id &&
  left.debit_account_id === right.debit_account_id &&
  left.credit_account_id === right.credit_account_id &&
  left.amount === right.amount &&
  left.pending_id === right.pending_id &&
  left.user_data_32 === right.user_data_32 &&
  left.timeout === right.timeout &&
  left.ledger === right.ledger &&
  left.code === right.code &&
  left.flags === right.flags

const promise = <A>(value: A) => Promise.resolve(value)

const makeFakeClient = (state: FakeState): Client => ({
  createAccounts: (batch) =>
    promise(batch.map((account) => {
      const existing = state.accounts.get(account.id)
      if (existing !== undefined) {
        return sameAccount(existing, account)
          ? { status: CreateAccountStatus.exists, timestamp: existing.timestamp }
          : {
            status: CreateAccountStatus.exists_with_different_user_data_32,
            timestamp: existing.timestamp,
          }
      }
      const timestamp = state.nextTimestamp++
      state.accounts.set(account.id, { ...account, timestamp })
      return { status: CreateAccountStatus.created, timestamp }
    })),
  createTransfers: (batch) => {
    const invalidIndex = batch.findIndex((transfer) => {
      if (!state.accounts.has(transfer.debit_account_id)) return true
      if (!state.accounts.has(transfer.credit_account_id)) return true
      return transfer.debit_account_id === transfer.credit_account_id
    })
    if (invalidIndex >= 0) {
      return promise(batch.map((transfer, index) => {
        if (index > invalidIndex) {
          return {
            status: CreateTransferStatus.linked_event_failed,
            timestamp: state.nextTimestamp,
          }
        }
        if (!state.accounts.has(transfer.debit_account_id)) {
          return {
            status: CreateTransferStatus.debit_account_not_found,
            timestamp: state.nextTimestamp,
          }
        }
        if (!state.accounts.has(transfer.credit_account_id)) {
          return {
            status: CreateTransferStatus.credit_account_not_found,
            timestamp: state.nextTimestamp,
          }
        }
        return {
          status: CreateTransferStatus.accounts_must_be_different,
          timestamp: state.nextTimestamp,
        }
      }))
    }

    const results = batch.map((transfer) => {
      const existing = state.transfers.get(transfer.id)
      if (existing !== undefined) {
        return sameTransfer(existing, transfer)
          ? { status: CreateTransferStatus.exists, timestamp: existing.timestamp }
          : {
            status: CreateTransferStatus.exists_with_different_amount,
            timestamp: existing.timestamp,
          }
      }
      const timestamp = state.nextTimestamp++
      state.createdTransfers.push({ ...transfer, timestamp })
      state.transfers.set(transfer.id, { ...transfer, timestamp })
      const debit = state.accounts.get(transfer.debit_account_id)!
      const credit = state.accounts.get(transfer.credit_account_id)!
      state.accounts.set(debit.id, {
        ...debit,
        debits_posted: debit.debits_posted + transfer.amount,
      })
      state.accounts.set(credit.id, {
        ...credit,
        credits_posted: credit.credits_posted + transfer.amount,
      })
      return { status: CreateTransferStatus.created, timestamp }
    })
    if (state.failNextTransferResponse) {
      state.failNextTransferResponse = false
      return Promise.reject(new Error("response lost after acceptance"))
    }
    return promise(results)
  },
  lookupAccounts: (ids) =>
    promise(ids.flatMap((id) => {
      const account = state.accounts.get(id)
      return account === undefined ? [] : [account]
    })),
  lookupTransfers: (ids) =>
    promise(ids.flatMap((id) => {
      const transfer = state.transfers.get(id)
      return transfer === undefined ? [] : [transfer]
    })),
  getAccountTransfers: () => promise([]),
  getAccountBalances: () => promise([]),
  queryAccounts: () => promise([]),
  queryTransfers: () => promise([]),
  destroy: () => {
    state.destroyed = true
  },
})

const makeState = (): FakeState => ({
  accounts: new Map(),
  transfers: new Map(),
  createdTransfers: [],
  nextTimestamp: 1n,
  failNextTransferResponse: false,
  destroyed: false,
})

describe("TigerBeetle financial adapter", () => {
  it.effect("creates linked transfers, replays by deterministic IDs, and cleans up", () => {
    const state = makeState()
    return Effect.scoped(Effect.gen(function* () {
      const ledger = yield* makeTigerBeetleFinancialLedger(config, () => makeFakeClient(state))
      assert.strictEqual(
        (yield* ledger.createExecutionAccount(accountInput("cash")))._tag,
        "accepted",
      )
      assert.strictEqual(
        (yield* ledger.createExecutionAccount(accountInput("revenue")))._tag,
        "accepted",
      )

      const first = yield* ledger.postJournal(journalInput())
      const replay = yield* ledger.postJournal(journalInput())
      assert.strictEqual(first._tag, "accepted")
      assert.deepStrictEqual(replay, first)
      assert.strictEqual(state.createdTransfers.length, 1)
      assert.strictEqual(state.createdTransfers[0]!.flags, 0)
      assert.strictEqual(state.transfers.size, 1)

      const balance = yield* ledger.getBalance({
        ...accountInput("cash"),
      })
      assert.strictEqual(balance._tag, "available")
      if (balance._tag !== "available") return
      assert.strictEqual(balance.debitsPostedMinor, "12500")
    }))
  })

  it.effect("links multiple transfers into one journal operation", () => {
    const state = makeState()
    return Effect.scoped(Effect.gen(function* () {
      const ledger = yield* makeTigerBeetleFinancialLedger(config, () => makeFakeClient(state))
      for (const accountId of ["cash", "cash-2", "revenue", "revenue-2"]) {
        yield* ledger.createExecutionAccount(accountInput(accountId))
      }
      const outcome = yield* ledger.postJournal({
        ...journalInput("linked-operation"),
        lines: [
          { accountId: "cash", debitMinor: "10000", creditMinor: "0" },
          { accountId: "cash-2", debitMinor: "2500", creditMinor: "0" },
          { accountId: "revenue", debitMinor: "0", creditMinor: "10000" },
          { accountId: "revenue-2", debitMinor: "0", creditMinor: "2500" },
        ],
      })
      assert.strictEqual(outcome._tag, "accepted")
      assert.strictEqual(state.createdTransfers.length, 2)
      assert.strictEqual(state.createdTransfers[0]!.flags, TransferFlags.linked)
      assert.strictEqual(state.createdTransfers[1]!.flags, TransferFlags.none)
    }))
  })

  it.effect("uses a new transfer identity for a new mapping version", () => {
    const state = makeState()
    return Effect.scoped(Effect.gen(function* () {
      const ledger = yield* makeTigerBeetleFinancialLedger(config, () => makeFakeClient(state))
      yield* ledger.createExecutionAccount(accountInput("cash"))
      yield* ledger.createExecutionAccount(accountInput("revenue"))
      yield* ledger.createExecutionAccount(accountInput("cash", 2))
      yield* ledger.createExecutionAccount(accountInput("revenue", 2))
      const first = yield* ledger.postJournal(journalInput("operation-1", "12500", 1))
      const second = yield* ledger.postJournal(journalInput("operation-2", "12500", 2))
      assert.strictEqual(first._tag, "accepted")
      assert.strictEqual(second._tag, "accepted")
      assert.strictEqual(state.createdTransfers.length, 2)
      assert.notStrictEqual(state.createdTransfers[0]!.id, state.createdTransfers[1]!.id)
    }))
  })

  it.effect("turns a lost response into an unknown outcome, then resolves it", () => {
    const state = makeState()
    state.failNextTransferResponse = true
    return Effect.scoped(Effect.gen(function* () {
      const ledger = yield* makeTigerBeetleFinancialLedger(config, () => makeFakeClient(state))
      yield* ledger.createExecutionAccount(accountInput("cash"))
      yield* ledger.createExecutionAccount(accountInput("revenue"))

      const unknown = yield* ledger.postJournal(journalInput("lost-operation"))
      const resolved = yield* ledger.postJournal(journalInput("lost-operation"))
      assert.deepStrictEqual(unknown, {
        _tag: "unknown",
        operationId: "lost-operation",
        reason: "response_lost",
      })
      assert.strictEqual(resolved._tag, "accepted")
    }))
  })

  it.effect("maps provider rejection and conflicting replay without fallback", () => {
    const state = makeState()
    return Effect.scoped(Effect.gen(function* () {
      const ledger = yield* makeTigerBeetleFinancialLedger(config, () => makeFakeClient(state))
      const rejected = yield* ledger.postJournal(journalInput("missing-account"))
      assert.deepStrictEqual(rejected, {
        _tag: "rejected",
        operationId: "missing-account",
        reason: "invalid_account",
      })

      yield* ledger.createExecutionAccount(accountInput("cash"))
      yield* ledger.createExecutionAccount(accountInput("revenue"))
      yield* ledger.postJournal(journalInput("conflict"))
      const conflict = yield* ledger.postJournal(journalInput("conflict", "12400"))
      assert.deepStrictEqual(conflict, {
        _tag: "manual_recovery",
        operationId: "conflict",
        reason: "conflicting_replay",
      })
    }))
  })

  it.effect("initializes the pinned native client without activating posting", () =>
    Effect.scoped(Effect.gen(function* () {
      const ledger = yield* makeTigerBeetleFinancialLedger(config)
      assert.isDefined(ledger)
    })))

  it.effect("fails invalid configuration before creating a client", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(makeTigerBeetleFinancialLedger({
        ...config,
        replicaAddresses: [],
      }))
      assert.instanceOf(failure, TigerBeetleConfigurationFailure)
    }))

  it.effect("destroys the client when the scope closes", () => {
    const state = makeState()
    return Effect.scoped(Effect.gen(function* () {
      yield* makeTigerBeetleFinancialLedger(config, () => makeFakeClient(state))
    })).pipe(Effect.tap(() => Effect.sync(() => assert.isTrue(state.destroyed))))
  })
})
