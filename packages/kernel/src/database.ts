import { type SQL, sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import * as Context from "effect/Context.ts"
import * as Effect from "effect/Effect.ts"
import * as Layer from "effect/Layer.ts"
import * as Schema from "effect/Schema.ts"

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

export interface DatabaseService {
  readonly transaction: <A>(
    operation: (transaction: PostgresTransaction) => Promise<A>,
  ) => Effect.Effect<A, DatabaseFailure>
  readonly execute: <Row extends Record<string, unknown>>(
    query: SQL<unknown>,
  ) => Effect.Effect<readonly Row[], DatabaseFailure>
}

const dialect = new PgDialect()

export const Database = Context.Service<DatabaseService>("EclipseERP/Database")

export const makePostgresDatabase = (client: PostgresClient): DatabaseService => {
  const transaction: DatabaseService["transaction"] = (operation) =>
    Effect.tryPromise({
      try: () => client.begin(operation),
      catch: (cause) => new DatabaseFailure({ operation: "transaction", cause }),
    })

  return {
    transaction,
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
