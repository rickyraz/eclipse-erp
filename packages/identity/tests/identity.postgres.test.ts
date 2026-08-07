import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { makeUserAccountService, UserAccountAlreadyExists, UserAccountNotFound } from "../mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

const makeDatabaseService = (client: Parameters<typeof makePostgresDatabase>[0]) =>
  makeUserAccountService.pipe(
    Effect.provideService(Database, makePostgresDatabase(client)),
  )

it.effect.skipIf(databaseUrl === undefined)(
  "persists, normalizes, lists, updates, and removes user accounts in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        const created = yield* service.create({ email: "  USER@Example.COM " })

        assert.strictEqual(created.email, "user@example.com")
        assert.strictEqual(created.status, "active")
        const persisted = yield* Effect.promise(() =>
          client<{ email: string }[]>`
            select email
            from identity.user_accounts
            where id = ${created.id}
          `
        )
        assert.deepStrictEqual(persisted, [{ email: "user@example.com" }])

        assert.strictEqual((yield* service.getById(created.id)).id, created.id)
        assert.deepStrictEqual(yield* service.getByIds([created.id]), [created])
        assert.strictEqual((yield* service.list()).length, 1)
        assert.strictEqual(
          (yield* service.update({ id: created.id, email: "after@example.com" })).email,
          "after@example.com",
        )

        yield* service.remove(created.id)
        assert.deepStrictEqual(yield* service.list(), [])
        assert.instanceOf(yield* Effect.flip(service.getById(created.id)), UserAccountNotFound)
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "maps the PostgreSQL unique constraint and validates input",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        yield* service.create({ email: "duplicate@example.com" })

        const duplicate = yield* Effect.flip(
          service.create({ email: " DUPLICATE@example.com " }),
        )
        assert.instanceOf(duplicate, UserAccountAlreadyExists)
        assert.strictEqual(duplicate.email, "duplicate@example.com")

        const updateTarget = yield* service.create({ email: "update@example.com" })
        const updateDuplicate = yield* Effect.flip(
          service.update({ id: updateTarget.id, email: " DUPLICATE@example.com " }),
        )
        assert.instanceOf(updateDuplicate, UserAccountAlreadyExists)
        assert.strictEqual(updateDuplicate.email, "duplicate@example.com")

        const invalid = yield* Effect.flip(service.create({ email: 42 }))
        assert.instanceOf(invalid, Error)
        assert.match(invalid.message, /email/)
        const blank = yield* Effect.flip(service.create({ email: "   " }))
        assert.instanceOf(blank, Error)
        assert.match(blank.message, /email/)
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "persists account disablement and session invalidation state in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        const created = yield* service.create({ email: "status@example.test" })
        assert.strictEqual(
          (yield* service.getAuthenticationState(created.id)).sessionInvalidatedAt,
          null,
        )
        const disabled = yield* service.disable(created.id)
        assert.strictEqual(disabled.status, "disabled")
        const disabledState = yield* service.getAuthenticationState(created.id)
        assert.strictEqual(disabledState.status, "disabled")
        assert.ok(disabledState.sessionInvalidatedAt !== null)
        assert.strictEqual((yield* service.enable(created.id)).status, "active")
        assert.strictEqual(
          (yield* service.getAuthenticationState(created.id)).status,
          "active",
        )
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "returns UserAccountNotFound for missing PostgreSQL records",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        const missingId = "00000000-0000-0000-0000-000000000000"

        assert.deepStrictEqual(yield* service.getByIds([]), [])
        assert.deepStrictEqual(yield* service.getByIds([missingId]), [])
        assert.instanceOf(yield* Effect.flip(service.getById(missingId)), UserAccountNotFound)
        assert.instanceOf(
          yield* Effect.flip(service.update({ id: missingId, email: "missing@example.com" })),
          UserAccountNotFound,
        )
        assert.instanceOf(
          yield* Effect.flip(service.getAuthenticationState(missingId)),
          UserAccountNotFound,
        )
        assert.instanceOf(yield* Effect.flip(service.disable(missingId)), UserAccountNotFound)
        assert.instanceOf(yield* Effect.flip(service.enable(missingId)), UserAccountNotFound)
        assert.instanceOf(yield* Effect.flip(service.remove(missingId)), UserAccountNotFound)
      })),
)
