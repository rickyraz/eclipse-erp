import { PgClient } from "@effect/sql-pg/PgClient"
import { makeWithDefaults } from "drizzle-orm/effect-postgres"
import * as Effect from "effect/Effect"

Deno.test("Effect and Drizzle resolve through the npm package topology", () => {
  if (typeof PgClient !== "function" || typeof makeWithDefaults !== "function") {
    throw new Error("Effect + Drizzle npm imports are not available")
  }

  if (!Effect.succeed(makeWithDefaults())) throw new Error("Effect runtime is unavailable")
})
