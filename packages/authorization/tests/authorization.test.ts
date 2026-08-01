import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  AuthorizationDenied,
  AuthorizationService,
  CapabilityAlreadyGranted,
  makeAuthorizationTestLayer,
} from "../mod.ts"

const principal = { identityId: "admin", sessionId: "session" }
const initialGrant = {
  identityId: principal.identityId,
  tenantId: "tenant-a",
  capability: "identity.read" as const,
}

const withAuthorization = <A, E>(program: Effect.Effect<A, E, AuthorizationService>) =>
  Effect.provide(program, makeAuthorizationTestLayer([initialGrant]))

describe("authorization contract", () => {
  it.effect("allows an explicit tenant-scoped capability", () =>
    withAuthorization(Effect.gen(function* () {
      const service = yield* AuthorizationService
      const decision = yield* service.authorize({
        principal,
        tenantId: "tenant-a",
        capability: "identity.read",
      })
      assert.strictEqual(decision.allowed, true)
      assert.strictEqual(decision.grant, "membership")
    })))

  it.effect("denies by default and on scope mismatch", () =>
    withAuthorization(Effect.gen(function* () {
      const service = yield* AuthorizationService
      const error = yield* Effect.flip(service.authorize({
        principal,
        tenantId: "tenant-b",
        capability: "identity.read",
      }))
      assert.instanceOf(error, AuthorizationDenied)
    })))

  it.effect("rejects duplicate grants", () =>
    withAuthorization(Effect.gen(function* () {
      const service = yield* AuthorizationService
      const error = yield* Effect.flip(service.grant(initialGrant))
      assert.instanceOf(error, CapabilityAlreadyGranted)
    })))
})
