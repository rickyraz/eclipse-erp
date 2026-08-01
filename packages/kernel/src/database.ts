import { type SQL, sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

export interface PostgresTransaction {
  readonly unsafe: <Row extends Record<string, unknown>>(
    query: string,
    parameters?: readonly unknown[],
  ) => Promise<readonly Row[]>
}

export interface PostgresClient {
  readonly begin: <A>(
    callback: (transaction: PostgresTransaction) => Promise<A>,
  ) => Promise<A>
}

export class DatabaseFailure extends Schema.TaggedErrorClass<DatabaseFailure>()("DatabaseFailure", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

export class UnsupportedPostgresVersion
  extends Schema.TaggedErrorClass<UnsupportedPostgresVersion>()("UnsupportedPostgresVersion", {
    serverVersionNum: Schema.String,
  }) {
  override get message() {
    return `PostgreSQL 19 or newer is required; server_version_num is ${this.serverVersionNum}.`
  }
}

export interface DatabaseService {
  readonly transaction: <A>(
    operation: (transaction: PostgresTransaction) => Promise<A>,
  ) => Effect.Effect<A, DatabaseFailure | UnsupportedPostgresVersion>
  readonly execute: <Row extends Record<string, unknown>>(
    query: SQL<unknown>,
  ) => Effect.Effect<readonly Row[], DatabaseFailure | UnsupportedPostgresVersion>
  readonly validateVersion: Effect.Effect<void, DatabaseFailure | UnsupportedPostgresVersion>
}

const dialect = new PgDialect()

export const Database = Context.Service<DatabaseService>("EclipseERP/Database")

export const makePostgresDatabase = (client: PostgresClient): DatabaseService => {
  let validated = false
  let validationPromise: Promise<void> | undefined

  const validateVersion: DatabaseService["validateVersion"] = Effect.tryPromise({
    try: async () => {
      if (validated) return
      validationPromise ??= client.begin(async (connection) => {
        const rows = await connection.unsafe<{ server_version_num: string }>(
          "show server_version_num",
        )
        const serverVersionNum = rows[0]?.server_version_num ?? "unknown"
        const version = Number.parseInt(serverVersionNum, 10)
        if (!Number.isInteger(version) || version < 190000) {
          throw new UnsupportedPostgresVersion({ serverVersionNum })
        }
      })
      await validationPromise
      validated = true
    },
    catch: (cause) =>
      cause instanceof UnsupportedPostgresVersion
        ? cause
        : new DatabaseFailure({ operation: "version-check", cause }),
  })

  const transaction: DatabaseService["transaction"] = (operation) =>
    Effect.gen(function* () {
      yield* validateVersion
      return yield* Effect.tryPromise({
        try: () => client.begin(operation),
        catch: (cause) => new DatabaseFailure({ operation: "transaction", cause }),
      })
    })

  return {
    transaction,
    validateVersion,
    execute: (query) =>
      transaction((connection) => {
        const built = dialect.sqlToQuery(query)
        return connection.unsafe(built.sql, built.params)
      }),
  }
}

export const PostgresDatabaseLive = (client: PostgresClient) =>
  Layer.succeed(Database, makePostgresDatabase(client))

export const drizzleSql = sql
