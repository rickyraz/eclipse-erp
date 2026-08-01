import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  IdentityAlreadyExists,
  IdentityNotFound,
  IdentityService,
  makeIdentityTestLayer,
} from "../mod.ts"

const withIdentity = <A, E>(program: Effect.Effect<A, E, IdentityService>) =>
  Effect.provide(program, makeIdentityTestLayer())

describe("identity contract", () => {
  it.effect("creates a normalized identity", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* IdentityService.use((service) =>
          service.create({ email: "  USER@Example.COM " })
        )

        assert.strictEqual(identity.email, "user@example.com")
        assert.strictEqual(identity.id, "1")
      }),
    ))

  it.effect("rejects duplicate email", () =>
    withIdentity(
      Effect.gen(function* () {
        const create = IdentityService.use((service) =>
          service.create({ email: "duplicate@example.com" })
        )
        yield* create
        const error = yield* Effect.flip(create)

        assert.instanceOf(error, IdentityAlreadyExists)
        assert.strictEqual(error.email, "duplicate@example.com")
      }),
    ))

  it.effect("lists, updates, and removes identities", () =>
    withIdentity(
      Effect.gen(function* () {
        const service = yield* IdentityService
        const created = yield* service.create({ email: "before@example.com" })
        assert.strictEqual((yield* service.getById(created.id)).id, created.id)
        assert.strictEqual((yield* service.list()).length, 1)
        assert.strictEqual(
          (yield* service.update({ id: created.id, email: "after@example.com" })).email,
          "after@example.com",
        )
        yield* service.remove(created.id)
        assert.instanceOf(yield* Effect.flip(service.getById(created.id)), IdentityNotFound)
      }),
    ))

  it.effect("rejects invalid input", () =>
    withIdentity(
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          IdentityService.use((service) => service.create({ email: 42 })),
        )

        assert.instanceOf(error, Error)
        assert.match(error.message, /email/)
      }),
    ))
})
