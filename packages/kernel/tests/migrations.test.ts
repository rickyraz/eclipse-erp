import { assert, it } from "@effect/vitest"
import { readMigrationFiles } from "drizzle-orm/migrator"
import * as Effect from "effect/Effect"

it.effect("uses Drizzle's reviewed migration layout", () =>
  Effect.sync(() => {
    const migrations = readMigrationFiles({ migrationsFolder: "db/migrations" })

    assert.strictEqual(migrations.length, 1)
    assert.strictEqual(migrations[0]?.name, "20260801000000_identity")
    assert.strictEqual(migrations[0]?.sql.length, 2)
    assert.match(migrations[0]?.hash ?? "", /^[a-f0-9]{64}$/)
  }))
