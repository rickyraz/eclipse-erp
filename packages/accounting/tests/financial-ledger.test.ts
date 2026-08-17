import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { FinancialLedgerPort, makeFinancialLedgerTestLayer } from "../mod.ts"

const tenantId = "tenant-a"
const legalEntityId = "legal-entity-a"
const account = (accountId: string) => ({
  tenantId,
  legalEntityId,
  accountId,
  currency: "USD",
  mappingVersion: 1,
})
const journal = (operationId = "operation-1") => ({
  tenantId,
  legalEntityId,
  operationId,
  journalId: "journal-1",
  reference: "SALE-1",
  currency: "USD",
  mappingVersion: 1,
  lines: [
    { accountId: "cash", debitMinor: "12500", creditMinor: "0" },
    { accountId: "revenue", debitMinor: "0", creditMinor: "12500" },
  ],
})

const withLedger = <A, E>(program: Effect.Effect<A, E, FinancialLedgerPort>, options = {}) =>
  Effect.provide(program, makeFinancialLedgerTestLayer(options))

describe("financial ledger contract", () => {
  it.effect("accepts balanced journals and replays the same operation", () =>
    withLedger(Effect.gen(function* () {
      const ledger = yield* FinancialLedgerPort
      yield* ledger.createExecutionAccount(account("cash"))
      yield* ledger.createExecutionAccount(account("revenue"))

      const first = yield* ledger.postJournal(journal())
      const replay = yield* ledger.postJournal(journal())
      const conflict = yield* ledger.postJournal({
        ...journal(),
        lines: [
          { accountId: "cash", debitMinor: "12400", creditMinor: "0" },
          { accountId: "revenue", debitMinor: "0", creditMinor: "12400" },
        ],
      })

      assert.strictEqual(first._tag, "accepted")
      if (first._tag !== "accepted") return
      assert.strictEqual(first.transferCount, 1)
      assert.deepStrictEqual(replay, first)
      assert.deepStrictEqual(conflict, {
        _tag: "manual_recovery",
        operationId: "operation-1",
        reason: "conflicting_replay",
      })
    })))

  it.effect("resolves a lost response with the same operation identity", () =>
    withLedger(
      Effect.gen(function* () {
        const ledger = yield* FinancialLedgerPort
        yield* ledger.createExecutionAccount(account("cash"))
        yield* ledger.createExecutionAccount(account("revenue"))

        const first = yield* ledger.postJournal(journal("lost-operation"))
        const resolved = yield* ledger.postJournal(journal("lost-operation"))

        assert.deepStrictEqual(first, {
          _tag: "unknown",
          operationId: "lost-operation",
          reason: "response_lost",
        })
        assert.strictEqual(resolved._tag, "accepted")
      }),
      { loseResponseFor: "lost-operation" },
    ))

  it.effect("rejects invalid journals and missing execution accounts", () =>
    withLedger(Effect.gen(function* () {
      const ledger = yield* FinancialLedgerPort
      const unbalanced = yield* ledger.postJournal({
        ...journal("unbalanced"),
        lines: [
          { accountId: "cash", debitMinor: "12500", creditMinor: "0" },
          { accountId: "revenue", debitMinor: "0", creditMinor: "12000" },
        ],
      })
      assert.deepStrictEqual(unbalanced, {
        _tag: "rejected",
        operationId: "unbalanced",
        reason: "unbalanced",
      })

      const missingAccount = yield* ledger.postJournal(journal("missing-account"))
      assert.deepStrictEqual(missingAccount, {
        _tag: "rejected",
        operationId: "missing-account",
        reason: "invalid_account",
      })

      const invalidInput = yield* Effect.flip(ledger.postJournal({
        ...journal("invalid-input"),
        lines: [{ accountId: "cash", debitMinor: "-1", creditMinor: "0" }],
      }))
      assert.strictEqual(invalidInput._tag, "SchemaError")
    })))

  it.effect("keeps balance reads provider-neutral", () =>
    withLedger(Effect.gen(function* () {
      const ledger = yield* FinancialLedgerPort
      yield* ledger.createExecutionAccount(account("cash"))
      const balance = yield* ledger.getBalance({
        ...account("cash"),
      })
      assert.deepStrictEqual(balance, {
        _tag: "available",
        accountId: "cash",
        mappingVersion: 1,
        debitsPendingMinor: "0",
        debitsPostedMinor: "0",
        creditsPendingMinor: "0",
        creditsPostedMinor: "0",
      })
    })))
})
