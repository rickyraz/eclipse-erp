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
}) {}

export interface DatabaseService {
  readonly transaction: <A>(
    operation: (transaction: PostgresTransaction) => Promise<A>,
  ) => Effect.Effect<A, DatabaseFailure>
}

export const Database = Context.Service<DatabaseService>("EclipseERP/Database")

export const makePostgresDatabase = (client: PostgresClient): DatabaseService => ({
  transaction: (operation) =>
    Effect.tryPromise({
      try: () => client.begin(operation),
      catch: () => new DatabaseFailure({ operation: "transaction" }),
    }),
})

export const PostgresDatabaseLive = (client: PostgresClient) =>
  Layer.succeed(Database, makePostgresDatabase(client))
