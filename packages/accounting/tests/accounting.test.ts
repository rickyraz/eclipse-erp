import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  AccountingConfigurationAlreadyExists,
  AccountingPeriodNotOpen,
  AccountingService,
  JournalIdempotencyConflict,
  makeAccountingTestLayer,
  UnbalancedJournal,
} from "../mod.ts"

const principal = { userAccountId: "accountant", sessionId: "session" }
const tenantId = "tenant-a"
const capabilities = [
  "accounting.legal_entity.configure",
  "accounting.account.create",
  "accounting.journal.post",
  "accounting.revenue.configure",
  "accounting.period.open",
  "accounting.period.close",
  "accounting.revenue.post",
  "accounting.revenue.reverse",
] as const

const withAccounting = <A, E>(
  program: Effect.Effect<A, E, AccountingService>,
  grantedCapabilities: readonly string[] = capabilities,
) =>
  Effect.provide(
    program,
    makeAccountingTestLayer().pipe(
      Layer.provide(
        makeAuthorizationTestLayer(
          grantedCapabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId,
            capability: capability as (typeof capabilities)[number],
          })),
        ),
      ),
    ),
  )

const prepareRevenuePosting = Effect.gen(function* () {
  const accounting = yield* AccountingService
  yield* accounting.configureLegalEntity({
    principal,
    tenantId,
    legalEntityId: "legal-entity-a",
    baseCurrency: "USD",
    precision: 2,
    fiscalYearStartMonth: 1,
    postingEnabled: true,
  })
  const receivable = yield* accounting.createAccount({
    principal,
    tenantId,
    code: "1100",
    name: "Receivable",
    type: "asset",
  })
  const revenue = yield* accounting.createAccount({
    principal,
    tenantId,
    code: "4000",
    name: "Revenue",
    type: "revenue",
  })
  yield* accounting.configureRevenuePosting({
    principal,
    tenantId,
    legalEntityId: "legal-entity-a",
    receivableAccountId: receivable.id,
    revenueAccountId: revenue.id,
  })
  const period = yield* accounting.openPeriod({
    principal,
    tenantId,
    legalEntityId: "legal-entity-a",
    startsOn: "1900-01-01",
    endsOn: "2100-12-31",
  })
  return { accounting, period }
})

describe("accounting contract", () => {
  it.effect("configures a legal entity once", () =>
    withAccounting(Effect.gen(function* () {
      const accounting = yield* AccountingService
      const configuration = yield* accounting.configureLegalEntity({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        baseCurrency: "usd",
        precision: 2,
        fiscalYearStartMonth: 1,
        postingEnabled: true,
      })
      assert.strictEqual(configuration.baseCurrency, "USD")
      assert.strictEqual(configuration.precision, 2)
      assert.strictEqual(configuration.fiscalYearStartMonth, 1)
      assert.strictEqual(configuration.postingEnabled, true)

      assert.strictEqual(
        (yield* Effect.flip(accounting.configureLegalEntity({
          principal,
          tenantId,
          legalEntityId: "legal-entity-b",
          baseCurrency: "USD",
          precision: 3,
          fiscalYearStartMonth: 1,
          postingEnabled: true,
        })))._tag,
        "SchemaError",
      )

      const error = yield* Effect.flip(accounting.configureLegalEntity({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        baseCurrency: "USD",
        precision: 2,
        fiscalYearStartMonth: 1,
        postingEnabled: true,
      }))
      assert.instanceOf(error, AccountingConfigurationAlreadyExists)
    })))

  it.effect("requires the legal entity configuration capability", () =>
    withAccounting(
      Effect.gen(function* () {
        const accounting = yield* AccountingService
        const error = yield* Effect.flip(accounting.configureLegalEntity({
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          baseCurrency: "USD",
          precision: 2,
          fiscalYearStartMonth: 1,
          postingEnabled: true,
        }))
        assert.instanceOf(error, AuthorizationDenied)
      }),
      capabilities.filter((capability) => capability !== "accounting.legal_entity.configure"),
    ))

  it.effect("posts a balanced journal", () =>
    withAccounting(Effect.gen(function* () {
      const accounting = yield* AccountingService
      const cash = yield* accounting.createAccount({
        principal,
        tenantId,
        code: "1000",
        name: "Cash",
        type: "asset",
      })
      const revenue = yield* accounting.createAccount({
        principal,
        tenantId,
        code: "4000",
        name: "Revenue",
        type: "revenue",
      })
      const journal = yield* accounting.postJournal({
        principal,
        tenantId,
        reference: "SALE-1",
        lines: [
          { accountId: cash.id, debit: "125.00", credit: "0" },
          { accountId: revenue.id, debit: "0", credit: "125.00" },
        ],
      })

      assert.strictEqual(journal.status, "posted")
      assert.strictEqual(journal.lines.length, 2)
      const repeated = yield* accounting.postJournal({
        principal,
        tenantId,
        reference: "SALE-1",
        lines: [
          { accountId: cash.id, debit: "125.00", credit: "0" },
          { accountId: revenue.id, debit: "0", credit: "125.00" },
        ],
      })
      assert.strictEqual(repeated.id, journal.id)
      assert.instanceOf(
        yield* Effect.flip(accounting.postJournal({
          principal,
          tenantId,
          reference: "SALE-1",
          lines: [
            { accountId: cash.id, debit: "124.00", credit: "0" },
            { accountId: revenue.id, debit: "0", credit: "124.00" },
          ],
        })),
        JournalIdempotencyConflict,
      )
    })))

  it.effect("posts revenue in an open period", () =>
    withAccounting(Effect.gen(function* () {
      const { accounting } = yield* prepareRevenuePosting
      const journal = yield* accounting.postRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: "order-open",
        amount: "125.00",
      })
      assert.strictEqual(journal.status, "posted")
      assert.deepStrictEqual(journal.lines.map(({ debit, credit }) => ({ debit, credit })), [
        { debit: "125.00", credit: "0" },
        { debit: "0", credit: "125.00" },
      ])
    })))

  it.effect("rejects revenue posting after the period closes", () =>
    withAccounting(Effect.gen(function* () {
      const { accounting, period } = yield* prepareRevenuePosting
      yield* accounting.closePeriod({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        periodId: period.id,
      })
      assert.instanceOf(
        yield* Effect.flip(accounting.postRevenueForOrder({
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          orderId: "order-closed",
          amount: "125.00",
        })),
        AccountingPeriodNotOpen,
      )
    })))

  it.effect("reverses posted revenue idempotently", () =>
    withAccounting(Effect.gen(function* () {
      const { accounting } = yield* prepareRevenuePosting
      const posted = yield* accounting.postRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: "order-reverse",
        amount: "125.00",
      })
      const reversal = yield* accounting.reverseRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: "order-reverse",
      })
      const repeated = yield* accounting.reverseRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: "order-reverse",
      })
      assert.strictEqual(reversal.reversesEntryId, posted.id)
      assert.strictEqual(repeated.id, reversal.id)
    })))

  it.effect("rejects an unbalanced journal", () =>
    withAccounting(Effect.gen(function* () {
      const accounting = yield* AccountingService
      const cash = yield* accounting.createAccount({
        principal,
        tenantId,
        code: "1000",
        name: "Cash",
        type: "asset",
      })
      const error = yield* Effect.flip(accounting.postJournal({
        principal,
        tenantId,
        reference: "BAD-1",
        lines: [
          { accountId: cash.id, debit: "10.00", credit: "0" },
          { accountId: cash.id, debit: "0", credit: "9.00" },
        ],
      }))
      assert.instanceOf(error, UnbalancedJournal)
    })))
})
