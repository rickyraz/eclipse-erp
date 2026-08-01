import * as Effect from "effect/Effect.ts"

import { DatabaseFailure, drizzleSql, makePostgresDatabase } from "../mod.ts"

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

Deno.test("database service renders Drizzle SQL before execution", async () => {
  let query = ""
  let parameters: readonly unknown[] = []

  const database = makePostgresDatabase({
    begin: (operation) =>
      operation({
        unsafe: <Row extends Record<string, unknown>>(
          renderedQuery: string,
          renderedParameters?: readonly unknown[],
        ) => {
          query = renderedQuery
          parameters = renderedParameters ?? []
          return Promise.resolve([] as readonly Row[])
        },
      }),
  })

  await Effect.runPromise(database.execute(drizzleSql`select ${42}`))

  if (query !== "select $1" || parameters[0] !== 42) {
    throw new Error("Drizzle SQL was not rendered for PostgreSQL")
  }
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
