import { assert, it } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import postgres from "postgres"

import { makePostgresDatabase } from "../mod.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "postgres transaction commits a typed query",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => postgres(databaseUrl!)),
        (connection) => Effect.promise(() => connection.end()),
      )
      const database = makePostgresDatabase(client)
      const value = yield* database.transaction(async (transaction) => {
        const rows = await transaction.execute<{ value: number }>(sql`select 42 as value`)
        return rows[0]?.value
      })

      assert.strictEqual(value, 42)
    }),
)
