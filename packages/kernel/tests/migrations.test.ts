import { assert, it } from "@effect/vitest"
import { readMigrationFiles } from "drizzle-orm/migrator"
import * as Effect from "effect/Effect"

it.effect("uses the pinned Drizzle migration graph", () =>
  Effect.gen(function* () {
    const migrations = readMigrationFiles({ migrationsFolder: "db/migrations" })
    assert.deepStrictEqual(
      migrations.map((migration) => migration.name),
      ["20260801133932_hardened_foundation", "20260801133933_accounting_invariants"],
    )
    assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.hash)))

    const first = yield* Effect.promise(() =>
      Deno.readTextFile("db/migrations/20260801133932_hardened_foundation/snapshot.json")
    )
    const second = yield* Effect.promise(() =>
      Deno.readTextFile("db/migrations/20260801133933_accounting_invariants/snapshot.json")
    )
    const accountingSql = yield* Effect.promise(() =>
      Deno.readTextFile("db/migrations/20260801133933_accounting_invariants/migration.sql")
    )
    const firstSnapshot = JSON.parse(first) as { id: string; prevIds: readonly string[] }
    const secondSnapshot = JSON.parse(second) as { id: string; prevIds: readonly string[] }

    assert.deepStrictEqual(firstSnapshot.prevIds, ["00000000-0000-0000-0000-000000000000"])
    assert.deepStrictEqual(secondSnapshot.prevIds, [firstSnapshot.id])
    assert.include(accountingSql, "journal_entries_balanced_trigger")
    assert.include(accountingSql, "journal_lines_immutable_trigger")
  }))
