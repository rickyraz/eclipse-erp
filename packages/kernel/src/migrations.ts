import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator"
import { drizzle } from "drizzle-orm/postgres-js"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

import {
  DatabaseFailure,
  type PostgresClient,
  type PostgresTransaction,
  UnsupportedPostgresVersion,
  validatePostgresVersion,
} from "./database.ts"

export class MigrationFailure
  extends Schema.TaggedErrorClass<MigrationFailure>()("MigrationFailure", {
    filename: Schema.String,
    cause: Schema.Unknown,
  }) {}

const asPostgresClient = (client: Sql): PostgresClient => ({
  begin: <A>(callback: (transaction: PostgresTransaction) => Promise<A>) =>
    client.begin((transaction) => {
      const adapted: PostgresTransaction = {
        unsafe: <Row extends Record<string, unknown>>(
          query: string,
          parameters?: readonly unknown[],
        ) =>
          transaction.unsafe(query, parameters as never[] | undefined) as unknown as Promise<
            readonly Row[]
          >,
      }
      return callback(adapted)
    }) as unknown as Promise<A>,
})

export const runMigrations = (
  client: Sql,
  directory = "db/migrations",
): Effect.Effect<void, DatabaseFailure | MigrationFailure> =>
  Effect.gen(function* () {
    yield* validatePostgresVersion(asPostgresClient(client)).pipe(
      Effect.mapError((cause) =>
        cause instanceof DatabaseFailure
          ? cause
          : new DatabaseFailure({ operation: "version-check", cause })
      ),
    )

    yield* Effect.tryPromise({
      try: async () => {
        const database = drizzle({ client })
        const result = await drizzleMigrate(database, {
          migrationsFolder: directory,
          migrationsSchema: "system",
          migrationsTable: "schema_migrations",
        })
        if (result !== undefined) {
          throw new MigrationFailure({ filename: directory, cause: result })
        }
      },
      catch: (cause) =>
        cause instanceof MigrationFailure
          ? cause
          : new DatabaseFailure({ operation: "migration", cause }),
    })
  })

export type MigrationError = DatabaseFailure | MigrationFailure | UnsupportedPostgresVersion
