import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  DatabaseFailure,
  drizzleSql,
  makePostgresDatabase,
  UnsupportedPostgresVersion,
  validatePostgresVersion,
} from "../mod.ts"

describe("database service", () => {
  it.effect("delegates the transaction boundary", () =>
    Effect.gen(function* () {
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

      const result = yield* database.transaction(async (transaction) => {
        const rows = await transaction.unsafe<{ value: number }>("select 42")
        return rows[0]?.value
      })

      assert.strictEqual(result, 42)
      assert.strictEqual(began, true)
      assert.strictEqual(committed, true)
    }))

  it.effect("renders Drizzle SQL before execution", () =>
    Effect.gen(function* () {
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

      yield* database.execute(drizzleSql`select ${42}`)

      assert.strictEqual(query, "select $1")
      assert.strictEqual(parameters[0], 42)
    }))

  it.effect("maps driver failures to a stable error", () =>
    Effect.gen(function* () {
      const database = makePostgresDatabase({
        begin: () => Promise.reject(new Error("raw driver details must not escape")),
      })

      const error = yield* Effect.flip(database.transaction(() => Promise.resolve(1)))

      assert.instanceOf(error, DatabaseFailure)
      assert.strictEqual(error.operation, "version-check")
    }))

  it.effect("rejects PostgreSQL versions below 19", () =>
    Effect.gen(function* () {
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

      const versionError = yield* Effect.flip(validatePostgresVersion(client))
      assert.instanceOf(versionError, UnsupportedPostgresVersion)

      const databaseError = yield* Effect.flip(
        database.transaction(() => Promise.resolve()),
      )
      assert.instanceOf(databaseError, DatabaseFailure)
      assert.strictEqual(databaseError.operation, "version-check")
      assert.instanceOf(databaseError.cause, UnsupportedPostgresVersion)
    }))
})
