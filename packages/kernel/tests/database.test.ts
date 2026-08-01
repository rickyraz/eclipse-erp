import * as Effect from "effect/Effect.ts"

import { DatabaseFailure, makePostgresDatabase } from "../mod.ts"

Deno.test("database service delegates the transaction boundary", async () => {
  let began = false
  let committed = false

  const database = makePostgresDatabase({
    begin: async (operation) => {
      began = true
      const result = await operation({
        unsafe: <Row extends Record<string, unknown>>() =>
          Promise.resolve([{ value: 42 } as unknown as Row]),
      })
      committed = true
      return result
    },
  })

  const result = await Effect.runPromise(
    database.transaction(async (transaction) => {
      const rows = await transaction.unsafe<{ value: number }>("select 42")
      return rows[0]?.value
    }),
  )

  if (result !== 42 || !began || !committed) throw new Error("transaction did not commit")
})

Deno.test("database service maps driver failures to a stable error", async () => {
  const database = makePostgresDatabase({
    begin: () => Promise.reject(new Error("raw driver details must not escape")),
  })

  try {
    await Effect.runPromise(database.transaction(() => Promise.resolve(1)))
    throw new Error("expected transaction failure")
  } catch (error) {
    if (!(error instanceof DatabaseFailure) || error.operation !== "transaction") throw error
  }
})
