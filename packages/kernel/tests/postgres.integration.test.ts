import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import postgres from "postgres"

import { makePostgresDatabase, type PostgresClient } from "../mod.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "postgres transaction commits a real query",
  () =>
    Effect.gen(function* () {
      const sql = yield* Effect.acquireRelease(
        Effect.sync(() => postgres(databaseUrl!)),
        (sql) => Effect.promise(() => sql.end()),
      )
      const database = makePostgresDatabase(sql as unknown as PostgresClient)
      const value = yield* database.transaction(async (transaction) => {
        const rows = await transaction.unsafe<{ value: number }>("select 42 as value")
        return rows[0]?.value
      })

      assert.strictEqual(value, 42)
    }),
)
