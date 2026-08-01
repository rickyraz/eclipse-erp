import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { AccountingService, makeAccountingTestLayer, UnbalancedJournal } from "../mod.ts"

const principal = { identityId: "accountant", sessionId: "session" }
const tenantId = "tenant-a"
const authorizationLayer = makeAuthorizationTestLayer([
  { identityId: principal.identityId, tenantId, capability: "accounting.account.create" },
  { identityId: principal.identityId, tenantId, capability: "accounting.journal.post" },
])

const withAccounting = <A, E>(program: Effect.Effect<A, E, AccountingService>) =>
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    return yield* Effect.provide(program, makeAccountingTestLayer(authorization))
  }).pipe(Effect.provide(authorizationLayer))

describe("accounting contract", () => {
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
