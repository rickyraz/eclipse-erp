import { assert, it } from "@effect/vitest"
import { PgClient } from "@effect/sql-pg/PgClient"
import { makeWithDefaults } from "drizzle-orm/effect-postgres"
import * as Effect from "effect/Effect"
import * as HttpApi from "effect/unstable/httpapi/HttpApi"

it("resolves Effect and Drizzle through the npm package topology", () => {
  assert.strictEqual(typeof PgClient, "function")
  assert.strictEqual(typeof makeWithDefaults, "function")
  assert.strictEqual(Effect.isEffect(makeWithDefaults()), true)
  assert.strictEqual(typeof HttpApi.make, "function")
})
