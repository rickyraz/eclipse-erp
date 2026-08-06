import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  makeUserAccountTestLayer,
  UserAccountAlreadyExists,
  UserAccountNotFound,
  UserAccountService,
} from "../mod.ts"

const withUserAccount = <A, E>(program: Effect.Effect<A, E, UserAccountService>) =>
  Effect.provide(program, makeUserAccountTestLayer())

describe("user account contract", () => {
  it.effect("creates a normalized user account", () =>
    withUserAccount(
      Effect.gen(function* () {
        const userAccount = yield* UserAccountService.use((service) =>
          service.create({ email: "  USER@Example.COM " })
        )

        assert.strictEqual(userAccount.email, "user@example.com")
        assert.strictEqual(userAccount.id, "1")
      }),
    ))

  it.effect("rejects duplicate email", () =>
    withUserAccount(
      Effect.gen(function* () {
        const create = UserAccountService.use((service) =>
          service.create({ email: "duplicate@example.com" })
        )
        yield* create
        const error = yield* Effect.flip(create)

        assert.instanceOf(error, UserAccountAlreadyExists)
        assert.strictEqual(error.email, "duplicate@example.com")
      }),
    ))

  it.effect("lists, updates, and removes user accounts", () =>
    withUserAccount(
      Effect.gen(function* () {
        const service = yield* UserAccountService
        const created = yield* service.create({ email: "before@example.com" })
        assert.strictEqual((yield* service.getById(created.id)).id, created.id)
        assert.strictEqual((yield* service.list()).length, 1)
        assert.strictEqual(
          (yield* service.update({ id: created.id, email: "after@example.com" })).email,
          "after@example.com",
        )
        yield* service.remove(created.id)
        assert.instanceOf(yield* Effect.flip(service.getById(created.id)), UserAccountNotFound)
      }),
    ))

  it.effect("rejects invalid input", () =>
    withUserAccount(
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          UserAccountService.use((service) => service.create({ email: 42 })),
        )

        assert.instanceOf(error, Error)
        assert.match(error.message, /email/)
      }),
    ))
})
