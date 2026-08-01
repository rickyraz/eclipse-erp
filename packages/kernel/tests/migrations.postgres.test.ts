import { assert, it } from "@effect/vitest"
import { readMigrationFiles } from "drizzle-orm/migrator"
import * as Effect from "effect/Effect"

import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import { runMigrations } from "../mod.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "applies the complete migration catalog to a clean database",
  () =>
    withTemporaryDatabase(
      databaseUrl!,
      (client) =>
        Effect.gen(function* () {
          yield* runMigrations(client)
          yield* runMigrations(client)

          const applied = yield* Effect.promise(() =>
            client<{ name: string; hash: string }[]>`
            select name, hash
            from system.schema_migrations
            order by id
          `
          )
          const local = readMigrationFiles({ migrationsFolder: "db/migrations" })
          const partyTable = yield* Effect.promise(() =>
            client<{ table_name: string }[]>`
            select table_name
            from information_schema.tables
            where table_schema = 'party' and table_name = 'party_identifiers'
          `
          )

          assert.deepStrictEqual(
            applied.map(({ name, hash }) => ({ name, hash })),
            local.map(({ name, hash }) => ({ name, hash })),
          )
          assert.strictEqual(partyTable[0]?.table_name, "party_identifiers")
        }),
    ),
)
