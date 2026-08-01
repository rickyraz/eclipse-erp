import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  ExternalIdentifierAlreadyAssigned,
  makePartyTestLayer,
  PartyRoleAlreadyAssigned,
  PartyService,
} from "../mod.ts"

const principal = { identityId: "party-admin", sessionId: "session" }
const tenantId = "tenant-a"
const capabilities = ["party.create", "party.role.assign", "party.identifier.attach"] as const

const authorizationLayer = makeAuthorizationTestLayer(
  capabilities.map((capability) => ({ identityId: principal.identityId, tenantId, capability })),
)

const withParty = <A, E>(program: Effect.Effect<A, E, PartyService>) =>
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    return yield* Effect.provide(program, makePartyTestLayer(authorization))
  }).pipe(Effect.provide(authorizationLayer))

describe("party contract", () => {
  it.effect("creates a party with roles and a scoped external identifier", () =>
    withParty(Effect.gen(function* () {
      const service = yield* PartyService
      const party = yield* service.create({
        principal,
        tenantId,
        kind: "organization",
        name: " ACME Indonesia ",
      })
      yield* service.assignRole({ principal, tenantId, partyId: party.id, role: "customer" })
      const identifier = yield* service.attachIdentifier({
        principal,
        tenantId,
        partyId: party.id,
        scheme: "gln",
        scope: "global",
        value: "1234567890123",
      })

      assert.strictEqual(party.name, "ACME Indonesia")
      assert.strictEqual(identifier.scheme, "GLN")
      assert.strictEqual(identifier.partyId, party.id)
    })))

  it.effect("rejects duplicate roles and identifiers in their declared scope", () =>
    withParty(Effect.gen(function* () {
      const service = yield* PartyService
      const first = yield* service.create({
        principal,
        tenantId,
        kind: "organization",
        name: "First",
      })
      const second = yield* service.create({
        principal,
        tenantId,
        kind: "organization",
        name: "Second",
      })
      const role = { principal, tenantId, partyId: first.id, role: "supplier" as const }
      yield* service.assignRole(role)
      assert.instanceOf(yield* Effect.flip(service.assignRole(role)), PartyRoleAlreadyAssigned)

      const identifier = {
        principal,
        tenantId,
        partyId: first.id,
        scheme: "LEI",
        scope: "global",
        value: "5493001KJTIIGC8Y1R12",
      }
      yield* service.attachIdentifier(identifier)
      assert.instanceOf(
        yield* Effect.flip(service.attachIdentifier({ ...identifier, partyId: second.id })),
        ExternalIdentifierAlreadyAssigned,
      )
    })))
})
