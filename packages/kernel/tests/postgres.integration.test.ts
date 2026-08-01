import postgres from "npm:postgres@3.4.7"

import * as Effect from "effect/Effect.ts"

import { makePostgresDatabase, type PostgresClient } from "../mod.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

Deno.test({
  name: "postgres transaction commits a real query",
  ignore: databaseUrl === undefined,
  permissions: { env: true, net: true },
  fn: async () => {
    const sql = postgres(databaseUrl!)
    try {
      const database = makePostgresDatabase(sql as unknown as PostgresClient)
      const value = await Effect.runPromise(
        database.transaction(async (transaction) => {
          const rows = await transaction.unsafe<{ value: number }>("select 42 as value")
          return rows[0]?.value
        }),
      )
      if (value !== 42) throw new Error("PostgreSQL transaction returned the wrong value")
    } finally {
      await sql.end()
    }
  },
})
