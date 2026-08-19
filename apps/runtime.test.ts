import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { makeFinancialLedgerLayer } from "./runtime.ts"
import { FinancialLedgerPort } from "../packages/accounting/mod.ts"
import { Database, type DatabaseService } from "../packages/kernel/mod.ts"

const unusedDatabase = Layer.succeed(Database, {
  query: () => Effect.die("database should not be queried while composing the ledger"),
  transaction: () => Effect.die("database should not be queried while composing the ledger"),
  withTransaction: () => Effect.die("database should not be queried while composing the ledger"),
} as DatabaseService)

it.effect("composes the PostgreSQL authority without TigerBeetle configuration", () =>
  Effect.gen(function* () {
    const ledger = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* FinancialLedgerPort
      }),
      makeFinancialLedgerLayer(unusedDatabase, {
        deploymentProfile: "entry",
        financialAuthority: "postgresql",
      }),
    )
    assert.strictEqual(ledger.authority, "postgresql")
  }))
