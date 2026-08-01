import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsTransaction,
} from "drizzle-orm/postgres-js"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

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

export type DrizzleDatabase = PostgresJsDatabase<EmptyRelations>
export type DrizzleTransaction = PostgresJsTransaction<AnyRelations>

export class DatabaseFailure extends Schema.TaggedErrorClass<DatabaseFailure>()("DatabaseFailure", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

const unwrapCause = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "cause" in cause && cause.cause !== undefined
    ? unwrapCause(cause.cause)
    : cause

export const isDatabaseConstraint = (
  error: unknown,
  constraint: string,
  code = "23505",
) => {
  if (!(error instanceof DatabaseFailure)) return false
  const cause = unwrapCause(error.cause)
  return typeof cause === "object" && cause !== null &&
    "code" in cause && cause.code === code &&
    (("constraint" in cause && cause.constraint === constraint) ||
      ("constraint_name" in cause && cause.constraint_name === constraint))
}

export class UnsupportedPostgresVersion
  extends Schema.TaggedErrorClass<UnsupportedPostgresVersion>()("UnsupportedPostgresVersion", {
    serverVersionNum: Schema.String,
  }) {
  override get message() {
    return `PostgreSQL 19 or newer is required; server_version_num is ${this.serverVersionNum}.`
  }
}

export interface DatabaseService {
  readonly query: <A>(
    operation: (database: DrizzleDatabase) => Promise<A>,
    operationName?: string,
  ) => Effect.Effect<A, DatabaseFailure>
  readonly transaction: <A>(
    operation: (transaction: DrizzleTransaction) => Promise<A>,
    operationName?: string,
  ) => Effect.Effect<A, DatabaseFailure>
}

export const Database = Context.Service<DatabaseService>("EclipseERP/Database")

const makeVersionValidation = (
  client: PostgresClient,
): Effect.Effect<void, DatabaseFailure | UnsupportedPostgresVersion> => {
  let validated = false
  let validationPromise: Promise<void> | undefined

  return Effect.tryPromise({
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
}

export const validatePostgresVersion = (client: PostgresClient) => makeVersionValidation(client)

export const makePostgresDatabase = (client: Sql): DatabaseService => {
  const validateVersion = makeVersionValidation(client as unknown as PostgresClient)
  const database = drizzle({ client })

  const validate = validateVersion.pipe(
    Effect.mapError((cause) =>
      cause instanceof DatabaseFailure
        ? cause
        : new DatabaseFailure({ operation: "version-check", cause })
    ),
  )

  return {
    query: (operation, operationName = "query") =>
      Effect.andThen(
        validate,
        Effect.tryPromise({
          try: () => operation(database),
          catch: (cause) => new DatabaseFailure({ operation: operationName, cause }),
        }),
      ),
    transaction: (operation, operationName = "transaction") =>
      Effect.andThen(
        validate,
        Effect.tryPromise({
          try: () => database.transaction(operation),
          catch: (cause) => new DatabaseFailure({ operation: operationName, cause }),
        }),
      ),
  }
}

export const PostgresDatabaseLive = (client: Sql) =>
  Layer.succeed(Database, makePostgresDatabase(client))
