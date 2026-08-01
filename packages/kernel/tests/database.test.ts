import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { identities } from "../../../db/schema/identity.ts"
import {
  DatabaseFailure,
  isDatabaseConstraint,
  makePostgresDatabase,
  UnsupportedPostgresVersion,
  validatePostgresVersion,
} from "../mod.ts"

const makeClient = (version = "190000") => {
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = []
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: <Row extends Record<string, unknown>>(
      query: string,
      parameters: readonly unknown[] = [],
    ) => {
      queries.push({ sql: query, parameters })
      const rows = query === "show server_version_num"
        ? [{ server_version_num: version }]
        : [{ id: "018f0000-0000-7000-8000-000000000000", email: "typed@example.com" }]
      const result = Promise.resolve(rows as unknown as readonly Row[])
      return Object.assign(result, {
        values: () => Promise.resolve(rows.map((row) => Object.values(row))),
      })
    },
    begin: <A>(operation: (transaction: unknown) => Promise<A>) => operation(client),
  }
  return { client: client as unknown as Sql, queries }
}

describe("database service", () => {
  it.effect("executes typed Drizzle queries", () =>
    Effect.gen(function* () {
      const { client, queries } = makeClient()
      const database = makePostgresDatabase(client)

      const rows = yield* database.query((db) =>
        db.select({ id: identities.id, email: identities.email }).from(identities)
      )

      assert.strictEqual(rows[0]?.email, "typed@example.com")
      assert.match(queries.at(-1)?.sql ?? "", /from "identity"\."identities"/i)
    }))

  it.effect("unwraps Drizzle failures when mapping constraints", () =>
    Effect.sync(() => {
      const driverError = { code: "23505", constraint_name: "identities_email_key" }
      const failure = new DatabaseFailure({
        operation: "identity.create",
        cause: new Error("query failed", { cause: driverError }),
      })

      assert.strictEqual(isDatabaseConstraint(failure, "identities_email_key"), true)
    }))

  it.effect("rejects PostgreSQL versions below 19", () =>
    Effect.gen(function* () {
      const { client } = makeClient("180000")
      const error = yield* Effect.flip(
        validatePostgresVersion(client as unknown as import("../mod.ts").PostgresClient),
      )

      assert.instanceOf(error, UnsupportedPostgresVersion)
    }))
})
