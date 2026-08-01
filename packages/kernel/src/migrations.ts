import { drizzle } from "drizzle-orm/postgres-js"
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator"
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator"
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

type AppliedMigration = {
  readonly hash: string
  readonly created_at: string
  readonly name: string | null
}

const migrationNamePattern = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*$/

class MigrationCatalogError extends Error {}

export const validateMigrationCatalog = (
  migrations: readonly MigrationMeta[],
  applied: readonly AppliedMigration[] = [],
): void => {
  if (migrations.length === 0) throw new MigrationCatalogError("no migrations discovered")

  const names = new Set<string>()
  const versions = new Set<string>()
  let previousName = ""
  let previousMillis = -Infinity

  for (const migration of migrations) {
    const match = migrationNamePattern.exec(migration.name)
    if (match === null) throw new MigrationCatalogError(`invalid migration name: ${migration.name}`)
    const version = match[1]!
    const timestamp = new Date(migration.folderMillis)
    const normalizedVersion = [
      timestamp.getUTCFullYear().toString().padStart(4, "0"),
      String(timestamp.getUTCMonth() + 1).padStart(2, "0"),
      String(timestamp.getUTCDate()).padStart(2, "0"),
      String(timestamp.getUTCHours()).padStart(2, "0"),
      String(timestamp.getUTCMinutes()).padStart(2, "0"),
      String(timestamp.getUTCSeconds()).padStart(2, "0"),
    ].join("")
    if (normalizedVersion !== version) {
      throw new MigrationCatalogError(`invalid migration timestamp: ${version}`)
    }
    if (names.has(migration.name)) {
      throw new MigrationCatalogError(`duplicate migration name: ${migration.name}`)
    }
    if (versions.has(version)) {
      throw new MigrationCatalogError(`duplicate migration version: ${version}`)
    }
    if (migration.name <= previousName || migration.folderMillis <= previousMillis) {
      throw new MigrationCatalogError(`migrations are not strictly ordered at ${migration.name}`)
    }
    if (!/^[a-f0-9]{64}$/.test(migration.hash)) {
      throw new MigrationCatalogError(`invalid migration checksum: ${migration.name}`)
    }
    names.add(migration.name)
    versions.add(version)
    previousName = migration.name
    previousMillis = migration.folderMillis
  }

  const byName = new Map(
    migrations.map((migration, index) => [migration.name, { migration, index }]),
  )
  const appliedNames = new Set<string>()
  let previousIndex = -1

  for (const migration of applied) {
    if (migration.name === null) continue
    if (appliedNames.has(migration.name)) {
      throw new MigrationCatalogError(`duplicate applied migration: ${migration.name}`)
    }
    const local = byName.get(migration.name)
    if (local === undefined) {
      throw new MigrationCatalogError(`applied migration is missing locally: ${migration.name}`)
    }
    if (local.migration.hash !== migration.hash) {
      throw new MigrationCatalogError(`applied migration checksum changed: ${migration.name}`)
    }
    if (local.migration.folderMillis !== Number(migration.created_at)) {
      throw new MigrationCatalogError(`applied migration version changed: ${migration.name}`)
    }
    if (local.index <= previousIndex) {
      throw new MigrationCatalogError(`applied migrations are reordered at ${migration.name}`)
    }
    appliedNames.add(migration.name)
    previousIndex = local.index
  }

  if (!applied.some((migration) => migration.name === null)) {
    for (const migration of migrations.slice(0, previousIndex + 1)) {
      if (!appliedNames.has(migration.name)) {
        throw new MigrationCatalogError(
          `migration inserted before applied history: ${migration.name}`,
        )
      }
    }
  }
}

const readAppliedMigrations = async (client: Sql): Promise<readonly AppliedMigration[]> => {
  const [tracker] = await client<{ tracker: string | null }[]>`
    select to_regclass('system.schema_migrations')::text as tracker
  `
  if (tracker?.tracker === null || tracker === undefined) return []
  return await client<AppliedMigration[]>`
    select hash, created_at::text, name
    from system.schema_migrations
    order by id
  `
}

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
        const migrations = readMigrationFiles({ migrationsFolder: directory })
        validateMigrationCatalog(migrations, await readAppliedMigrations(client))

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
          : cause instanceof MigrationCatalogError
          ? new MigrationFailure({ filename: directory, cause })
          : new DatabaseFailure({ operation: "migration", cause }),
    })
  })

export type MigrationError = DatabaseFailure | MigrationFailure | UnsupportedPostgresVersion
