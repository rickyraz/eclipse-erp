import { assert, describe, it } from "@effect/vitest"
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator"
import * as Effect from "effect/Effect"
import { createHash } from "node:crypto"

import { validateMigrationCatalog } from "../src/migrations.ts"

const migrationsDirectory = "db/migrations"
const migrationNamePattern = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/
const checksumPattern = /^[a-f0-9]{64}$/
const rootSnapshotId = "00000000-0000-0000-0000-000000000000"
const retireProcessEventOutboxMigration =
  "db/migrations/20260812175716_retire_process_event_outbox/migration.sql"

type SnapshotMetadata = {
  readonly id: string
  readonly prevIds: readonly string[]
}

const migrationDirectories = async () => {
  const directories: string[] = []
  for await (const entry of Deno.readDir(migrationsDirectory)) {
    if (entry.isDirectory) directories.push(entry.name)
  }
  return directories.sort()
}

const readSnapshot = async (name: string): Promise<SnapshotMetadata> =>
  JSON.parse(
    await Deno.readTextFile(`${migrationsDirectory}/${name}/snapshot.json`),
  ) as SnapshotMetadata

const duplicateVersion = (migration: MigrationMeta): MigrationMeta => ({
  ...migration,
  name: `${migration.name.slice(0, 14)}_duplicate`,
})

describe("migration discovery", () => {
  it.effect("discovers a non-empty, ordered, uniquely versioned catalog", () =>
    Effect.sync(() => {
      const migrations = readMigrationFiles({ migrationsFolder: migrationsDirectory })

      assert.isAbove(migrations.length, 0)
      assert.doesNotThrow(() => validateMigrationCatalog(migrations))
      assert.deepStrictEqual(
        migrations.map((migration) => migration.name),
        migrations.map((migration) => migration.name).toSorted(),
      )
      for (const migration of migrations) {
        assert.match(migration.name, migrationNamePattern)
      }
    }))

  it.effect("rejects duplicate migration versions", () =>
    Effect.sync(() => {
      const migrations = readMigrationFiles({ migrationsFolder: migrationsDirectory })
      const first = migrations[0]!

      assert.throws(
        () => validateMigrationCatalog([first, duplicateVersion(first)]),
        /duplicate migration version/,
      )
    }))

  it.effect("requires migration SQL and parseable snapshot metadata", () =>
    Effect.gen(function* () {
      const directories = yield* Effect.promise(migrationDirectories)
      assert.isAbove(directories.length, 0)

      for (const directory of directories) {
        const migration = yield* Effect.promise(() =>
          Deno.stat(`${migrationsDirectory}/${directory}/migration.sql`)
        )
        const snapshot = yield* Effect.promise(() =>
          Deno.stat(`${migrationsDirectory}/${directory}/snapshot.json`)
        )
        const metadata = yield* Effect.promise(() => readSnapshot(directory))

        assert.isTrue(migration.isFile)
        assert.isTrue(snapshot.isFile)
        assert.match(metadata.id, /^[a-f0-9-]{36}$/)
        assert.isArray(metadata.prevIds)
      }
    }))
})

describe("migration integrity", () => {
  it.effect("fails closed before retiring the legacy process event outbox", () =>
    Effect.gen(function* () {
      const sql = yield* Effect.promise(() => Deno.readTextFile(retireProcessEventOutboxMigration))

      assert.match(
        sql,
        /LOCK TABLE "process"\."event_outbox" IN ACCESS EXCLUSIVE MODE/,
      )
      assert.match(sql, /IF EXISTS \(SELECT 1 FROM "process"\."event_outbox"\)/)
      assert.match(
        sql,
        /RAISE EXCEPTION\s+'process\.event_outbox contains legacy rows; operator migration\/review is required before retirement'/,
      )
      assert.match(sql, /DROP TABLE "process"\."event_outbox"/)
    }))

  it.effect("matches every loader checksum to migration.sql", () =>
    Effect.gen(function* () {
      const migrations = readMigrationFiles({ migrationsFolder: migrationsDirectory })

      for (const migration of migrations) {
        const sql = yield* Effect.promise(() =>
          Deno.readTextFile(`${migrationsDirectory}/${migration.name}/migration.sql`)
        )
        const expected = createHash("sha256").update(sql).digest("hex")

        assert.match(migration.hash, checksumPattern)
        assert.strictEqual(migration.hash, expected)
      }
    }))

  it.effect("forms one ordered snapshot ancestry chain", () =>
    Effect.gen(function* () {
      const directories = yield* Effect.promise(migrationDirectories)
      let previousId = rootSnapshotId
      const snapshotIds = new Set<string>()

      for (const directory of directories) {
        const snapshot = yield* Effect.promise(() => readSnapshot(directory))
        assert.isFalse(snapshotIds.has(snapshot.id), `duplicate snapshot id: ${snapshot.id}`)
        assert.deepStrictEqual(snapshot.prevIds, [previousId])
        snapshotIds.add(snapshot.id)
        previousId = snapshot.id
      }
    }))

  it.effect("rejects changed, missing, duplicated, or reordered applied migrations", () =>
    Effect.sync(() => {
      const migrations = readMigrationFiles({ migrationsFolder: migrationsDirectory })
      const applied = migrations.map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
        name: migration.name,
      }))

      assert.doesNotThrow(() => validateMigrationCatalog(migrations, applied))
      assert.throws(
        () => validateMigrationCatalog(migrations, [{ ...applied[0]!, hash: "0".repeat(64) }]),
        /checksum changed/,
      )
      assert.throws(
        () => validateMigrationCatalog(migrations, [{ ...applied[0]!, created_at: "0" }]),
        /version changed/,
      )
      assert.throws(
        () => validateMigrationCatalog(migrations.slice(1), [applied[0]!]),
        /missing locally/,
      )
      assert.throws(
        () => validateMigrationCatalog(migrations, [applied[0]!, applied[0]!]),
        /duplicate applied migration/,
      )
      if (applied.length > 1) {
        assert.throws(
          () => validateMigrationCatalog(migrations, [applied[1]!, applied[0]!]),
          /reordered/,
        )
        assert.throws(
          () => validateMigrationCatalog(migrations, [applied[1]!]),
          /inserted before applied history/,
        )
      }
    }))
})
