import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"

export const LARGE_FINANCIAL_MAJOR = "500000000000000.00"
export const LARGE_FINANCIAL_MINOR = "50000000000000000"

type Authority = "postgresql" | "tigerbeetle"
type JournalLine = {
  readonly accountId: string
  readonly debitMinor: string
  readonly creditMinor: string
}
export type ConformanceJournal = {
  readonly tenantId: string
  readonly legalEntityId: string
  readonly operationId: string
  readonly journalId: string
  readonly reference: string
  readonly currency: string
  readonly mappingVersion: number
  readonly lines: readonly JournalLine[]
}

type Ledger = {
  readonly authority: Authority
  readonly createExecutionAccount: (
    input: unknown,
  ) => Effect.Effect<{ readonly _tag: string }, unknown>
  readonly postJournal: (input: unknown) => Effect.Effect<unknown, unknown>
  readonly reconcileJournal: (input: unknown) => Effect.Effect<{ readonly _tag: string }, unknown>
  readonly getBalance: (input: unknown) => Effect.Effect<unknown, unknown>
}

/** Shared assertions used by the test, PostgreSQL, and real TigerBeetle adapters. */
export const assertFinancialLedgerConformance = (
  ledger: Ledger,
  input: ConformanceJournal,
  expectedAuthority: Authority,
) =>
  Effect.gen(function* () {
    assert.strictEqual(ledger.authority, expectedAuthority)
    assert.strictEqual(input.lines.length, 2)

    const debitLine = input.lines.find((line) => BigInt(line.debitMinor) > 0n)
    const creditLine = input.lines.find((line) => BigInt(line.creditMinor) > 0n)
    assert.isDefined(debitLine)
    assert.isDefined(creditLine)
    if (debitLine === undefined || creditLine === undefined) return
    assert.strictEqual(debitLine.debitMinor, LARGE_FINANCIAL_MINOR)
    assert.strictEqual(creditLine.creditMinor, LARGE_FINANCIAL_MINOR)

    assert.strictEqual(
      (yield* ledger.createExecutionAccount({
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        accountId: debitLine.accountId,
        currency: input.currency,
        mappingVersion: input.mappingVersion,
        balanceConstraint: "credits_must_not_exceed_debits",
      }))._tag,
      "accepted",
    )
    assert.strictEqual(
      (yield* ledger.createExecutionAccount({
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        accountId: creditLine.accountId,
        currency: input.currency,
        mappingVersion: input.mappingVersion,
        balanceConstraint: "debits_must_not_exceed_credits",
      }))._tag,
      "accepted",
    )

    const first = yield* ledger.postJournal(input)
    assert.strictEqual((first as { readonly _tag?: string })._tag, "accepted")
    if ((first as { readonly _tag?: string })._tag !== "accepted") return
    const accepted = first as {
      readonly _tag: "accepted"
      readonly transferCount: number
      readonly transferIds: readonly string[]
    }
    assert.strictEqual(accepted.transferCount, 1)
    assert.strictEqual(accepted.transferIds.length, 1)
    assert.deepStrictEqual(yield* ledger.postJournal(input), first)
    assert.strictEqual((yield* ledger.reconcileJournal(input))._tag, "accepted")

    assert.deepStrictEqual(
      yield* ledger.getBalance({
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        accountId: debitLine.accountId,
        currency: input.currency,
        mappingVersion: input.mappingVersion,
      }),
      {
        _tag: "available",
        accountId: debitLine.accountId,
        mappingVersion: input.mappingVersion,
        debitsPendingMinor: "0",
        debitsPostedMinor: debitLine.debitMinor,
        creditsPendingMinor: "0",
        creditsPostedMinor: "0",
      },
    )
    assert.deepStrictEqual(
      yield* ledger.getBalance({
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        accountId: creditLine.accountId,
        currency: input.currency,
        mappingVersion: input.mappingVersion,
      }),
      {
        _tag: "available",
        accountId: creditLine.accountId,
        mappingVersion: input.mappingVersion,
        debitsPendingMinor: "0",
        debitsPostedMinor: "0",
        creditsPendingMinor: "0",
        creditsPostedMinor: creditLine.creditMinor,
      },
    )

    const overflow = yield* ledger.postJournal({
      ...input,
      operationId: `${input.operationId}:overflow`,
      journalId: `${input.journalId}:overflow`,
      lines: [
        { accountId: debitLine.accountId, debitMinor: (1n << 128n).toString(), creditMinor: "0" },
        { accountId: creditLine.accountId, debitMinor: "0", creditMinor: (1n << 128n).toString() },
      ],
    })
    assert.deepStrictEqual(overflow, {
      _tag: "rejected",
      operationId: `${input.operationId}:overflow`,
      reason: "invalid_amount",
    })

    const u128Max = ((1n << 128n) - 1n).toString()
    const aggregateOverflow = yield* ledger.postJournal({
      ...input,
      operationId: `${input.operationId}:aggregate-overflow`,
      journalId: `${input.journalId}:aggregate-overflow`,
      lines: [
        { accountId: debitLine.accountId, debitMinor: u128Max, creditMinor: "0" },
        { accountId: `${debitLine.accountId}:2`, debitMinor: u128Max, creditMinor: "0" },
        { accountId: creditLine.accountId, debitMinor: "0", creditMinor: u128Max },
        { accountId: `${creditLine.accountId}:2`, debitMinor: "0", creditMinor: u128Max },
      ],
    })
    assert.deepStrictEqual(aggregateOverflow, {
      _tag: "rejected",
      operationId: `${input.operationId}:aggregate-overflow`,
      reason: "invalid_amount",
    })
  })
