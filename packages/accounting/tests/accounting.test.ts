import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  AuthorizationDenied,
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../authorization/mod.ts"
import {
  AccountingConfigurationAlreadyExists,
  AccountingService,
  makeAccountingTestLayer,
  UnbalancedJournal,
} from "../mod.ts"

const principal = { identityId: "accountant", sessionId: "session" }
const tenantId = "tenant-a"
const capabilities = [
  "accounting.legal_entity.configure",
  "accounting.account.create",
  "accounting.journal.post",
] as const

const withAccounting = <A, E>(
  program: Effect.Effect<A, E, AccountingService>,
  grantedCapabilities: readonly string[] = capabilities,
) =>
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    return yield* Effect.provide(program, makeAccountingTestLayer(authorization))
  }).pipe(
    Effect.provide(
      makeAuthorizationTestLayer(
        grantedCapabilities.map((capability) => ({
          identityId: principal.identityId,
          tenantId,
          capability: capability as (typeof capabilities)[number],
        })),
      ),
    ),
  )

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
