import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  AuthService,
  InvalidSessionToken,
  makeAuthTestLayer,
  SessionIdentityNotFound,
  TenantAlreadyExists,
} from "../mod.ts"

const withAuth = <A, E>(program: Effect.Effect<A, E, AuthService>) =>
  Effect.provide(program, makeAuthTestLayer(new Set(["identity-1"])))

describe("auth contract", () => {
  it.effect("creates tenants and rejects duplicate slugs", () =>
    withAuth(Effect.gen(function* () {
      const auth = yield* AuthService
      const tenant = yield* auth.createTenant({ slug: " ACME ", timezone: " Asia/Jakarta " })
      assert.strictEqual(tenant.slug, "acme")
      assert.strictEqual(tenant.timezone, "Asia/Jakarta")
      const defaultTenant = yield* auth.createTenant({ slug: "default-timezone" })
      assert.strictEqual(defaultTenant.timezone, "UTC")
      assert.instanceOf(
        yield* Effect.flip(auth.createTenant({ slug: "acme" })),
        TenantAlreadyExists,
      )
    })))

  it.effect("issues, authenticates, and revokes opaque sessions", () =>
    withAuth(Effect.gen(function* () {
      const auth = yield* AuthService
      const issued = yield* auth.issueSession({ identityId: "identity-1", ttlSeconds: 60 })
      assert.strictEqual((yield* auth.authenticate(issued.token)).identityId, "identity-1")
      yield* auth.revoke(issued.session.id)
      assert.instanceOf(yield* Effect.flip(auth.authenticate(issued.token)), InvalidSessionToken)
    })))

  it.effect("rejects sessions for unknown identities", () =>
    withAuth(Effect.gen(function* () {
      const auth = yield* AuthService
      assert.instanceOf(
        yield* Effect.flip(auth.issueSession({ identityId: "missing", ttlSeconds: 60 })),
        SessionIdentityNotFound,
      )
    })))
})
