import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { IdentityCapabilities } from "../../identity/mod.ts"
import {
  AuthorizationDenied,
  AuthorizationService,
  CapabilityAlreadyGranted,
  makeAuthorizationTestLayer,
  TenantMembershipAlreadyExists,
  TenantMembershipNotFound,
} from "../mod.ts"

const principal = { userAccountId: "admin", sessionId: "session" }
const initialGrant = {
  userAccountId: principal.userAccountId,
  tenantId: "tenant-a",
  capability: IdentityCapabilities.userAccountRead,
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
        capability: IdentityCapabilities.userAccountRead,
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
        capability: IdentityCapabilities.userAccountRead,
      }))
      assert.instanceOf(error, AuthorizationDenied)
    })))

  it.effect("rejects duplicate grants", () =>
    withAuthorization(Effect.gen(function* () {
      const service = yield* AuthorizationService
      const error = yield* Effect.flip(service.grant(initialGrant))
      assert.instanceOf(error, CapabilityAlreadyGranted)
    })))

  it.effect("suspends tenant access without deleting the global account", () =>
    withAuthorization(Effect.gen(function* () {
      const service = yield* AuthorizationService
      yield* service.suspendMember({
        userAccountId: principal.userAccountId,
        tenantId: "tenant-a",
      })
      assert.instanceOf(
        yield* Effect.flip(service.authorize({
          principal,
          tenantId: "tenant-a",
          capability: IdentityCapabilities.userAccountRead,
        })),
        AuthorizationDenied,
      )
      yield* service.activateMember({
        userAccountId: principal.userAccountId,
        tenantId: "tenant-a",
      })
      assert.strictEqual(
        (yield* service.authorize({
          principal,
          tenantId: "tenant-a",
          capability: IdentityCapabilities.userAccountRead,
        })).allowed,
        true,
      )
    })))

  it.effect("manages membership lifecycle and rejects missing members", () =>
    Effect.provide(
      Effect.gen(function* () {
        const service = yield* AuthorizationService
        const added = yield* service.addMember({
          userAccountId: "new-user",
          tenantId: "tenant-a",
        })
        assert.strictEqual(added.status, "active")
        assert.instanceOf(
          yield* Effect.flip(service.addMember({
            userAccountId: "new-user",
            tenantId: "tenant-a",
          })),
          TenantMembershipAlreadyExists,
        )
        yield* service.removeMember({ userAccountId: "new-user", tenantId: "tenant-a" })
        assert.instanceOf(
          yield* Effect.flip(
            service.getMember({ userAccountId: "new-user", tenantId: "tenant-a" }),
          ),
          TenantMembershipNotFound,
        )
      }),
      makeAuthorizationTestLayer(),
    ))
})
