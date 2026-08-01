import * as Effect from "effect/Effect"

import {
  DatabaseFailure,
  drizzleSql,
  makePostgresDatabase,
  UnsupportedPostgresVersion,
  validatePostgresVersion,
} from "../mod.ts"

Deno.test("database service delegates the transaction boundary", async () => {
  let began = false
  let committed = false

  const database = makePostgresDatabase({
    begin: async (operation) => {
      began = true
      const result = await operation({
        unsafe: <Row extends Record<string, unknown>>(query: string) =>
          Promise.resolve(
            (query === "show server_version_num"
              ? [{ server_version_num: "190000" }]
              : [{ value: 42 }]) as unknown as readonly Row[],
          ),
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
          if (renderedQuery !== "show server_version_num") {
            query = renderedQuery
            parameters = renderedParameters ?? []
          }
          return Promise.resolve(
            (renderedQuery === "show server_version_num"
              ? [{ server_version_num: "190000" }]
              : []) as unknown as readonly Row[],
          )
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
    if (!(error instanceof DatabaseFailure) || error.operation !== "version-check") throw error
  }
})

Deno.test("database service rejects PostgreSQL versions below 19", async () => {
  const client = {
    begin: <A>(
      operation: (transaction: {
        unsafe: <Row extends Record<string, unknown>>() => Promise<readonly Row[]>
      }) => Promise<A>,
    ) =>
      operation({
        unsafe: <Row extends Record<string, unknown>>() =>
          Promise.resolve([{ server_version_num: "180000" }] as unknown as readonly Row[]),
      }),
  }
  const database = makePostgresDatabase(client)

  try {
    await Effect.runPromise(validatePostgresVersion(client))
    throw new Error("expected PostgreSQL version rejection")
  } catch (error) {
    if (!(error instanceof UnsupportedPostgresVersion)) throw error
  }

  try {
    await Effect.runPromise(database.transaction(() => Promise.resolve()))
    throw new Error("expected database transaction rejection")
  } catch (error) {
    if (
      !(error instanceof DatabaseFailure) ||
      error.operation !== "version-check" ||
      !(error.cause instanceof UnsupportedPostgresVersion)
    ) throw error
  }
})
