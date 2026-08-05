import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  AuthorizationDenied,
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../authorization/mod.ts"
import {
  BranchAlreadyExists,
  ExternalIdentifierAlreadyAssigned,
  LegalEntityAlreadyExists,
  LegalEntityNotFound,
  makePartyTestLayer,
  OrganizationPartyRequired,
  PartyRelationshipAlreadyExists,
  PartyRelationshipRoleNotAssigned,
  PartyRoleAlreadyAssigned,
  PartyService,
} from "../mod.ts"

const principal = { identityId: "party-admin", sessionId: "session" }
const tenantId = "tenant-a"
const capabilities = [
  "party.create",
  "party.legal_entity.create",
  "party.branch.create",
  "party.role.assign",
  "party.relationship.create",
  "party.identifier.attach",
] as const

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
      const legalEntity = yield* service.createLegalEntity({
        principal,
        tenantId,
        organizationPartyId: party.id,
      })
      const branch = yield* service.createBranch({
        principal,
        tenantId,
        legalEntityId: legalEntity.id,
        name: " Jakarta ",
        timezone: " Asia/Jakarta ",
      })
      const relationship = yield* service.createRelationship({
        principal,
        tenantId,
        partyId: party.id,
        legalEntityId: legalEntity.id,
        kind: "customer",
      })

      assert.strictEqual(party.name, "ACME Indonesia")
      assert.strictEqual(identifier.scheme, "GLN")
      assert.strictEqual(identifier.partyId, party.id)
      assert.strictEqual(legalEntity.organizationPartyId, party.id)
      assert.strictEqual(branch.name, "Jakarta")
      assert.strictEqual(branch.timezone, "Asia/Jakarta")
      assert.strictEqual(relationship.kind, "customer")
      assert.strictEqual(relationship.active, true)
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

      const legalEntity = yield* service.createLegalEntity({
        principal,
        tenantId,
        organizationPartyId: first.id,
      })
      const relationship = {
        principal,
        tenantId,
        partyId: first.id,
        legalEntityId: legalEntity.id,
        kind: "supplier" as const,
      }
      yield* service.createRelationship(relationship)
      assert.instanceOf(
        yield* Effect.flip(service.createRelationship(relationship)),
        PartyRelationshipAlreadyExists,
      )
      assert.instanceOf(
        yield* Effect.flip(service.createLegalEntity({
          principal,
          tenantId,
          organizationPartyId: first.id,
        })),
        LegalEntityAlreadyExists,
      )
      const branch = {
        principal,
        tenantId,
        legalEntityId: legalEntity.id,
        name: "Jakarta",
      }
      yield* service.createBranch(branch)
      assert.instanceOf(yield* Effect.flip(service.createBranch(branch)), BranchAlreadyExists)
    })))

  it.effect("requires an assigned role for a legal entity relationship", () =>
    withParty(Effect.gen(function* () {
      const service = yield* PartyService
      const party = yield* service.create({
        principal,
        tenantId,
        kind: "organization",
        name: "Unclassified Supplier",
      })
      const legalEntity = yield* service.createLegalEntity({
        principal,
        tenantId,
        organizationPartyId: party.id,
      })
      const error = yield* Effect.flip(service.createRelationship({
        principal,
        tenantId,
        partyId: party.id,
        legalEntityId: legalEntity.id,
        kind: "supplier",
      }))
      assert.instanceOf(error, PartyRelationshipRoleNotAssigned)
    })))

  it.effect("requires an organization party and an existing legal entity", () =>
    withParty(Effect.gen(function* () {
      const service = yield* PartyService
      const person = yield* service.create({
        principal,
        tenantId,
        kind: "person",
        name: "Sari",
      })
      assert.instanceOf(
        yield* Effect.flip(service.createLegalEntity({
          principal,
          tenantId,
          organizationPartyId: person.id,
        })),
        OrganizationPartyRequired,
      )
      assert.instanceOf(
        yield* Effect.flip(service.createBranch({
          principal,
          tenantId,
          legalEntityId: "missing",
          name: "Jakarta",
        })),
        LegalEntityNotFound,
      )
    })))

  it.effect("denies legal entity creation without its capability", () =>
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      return yield* Effect.provide(
        Effect.gen(function* () {
          const service = yield* PartyService
          const party = yield* service.create({
            principal,
            tenantId,
            kind: "organization",
            name: "No Legal Entity Capability",
          })
          assert.instanceOf(
            yield* Effect.flip(service.createLegalEntity({
              principal,
              tenantId,
              organizationPartyId: party.id,
            })),
            AuthorizationDenied,
          )
        }),
        makePartyTestLayer(authorization),
      )
    }).pipe(
      Effect.provide(
        makeAuthorizationTestLayer([
          { identityId: principal.identityId, tenantId, capability: "party.create" },
        ]),
      ),
    ))

  it.effect("denies relationship creation without its capability", () =>
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      return yield* Effect.provide(
        Effect.gen(function* () {
          const service = yield* PartyService
          const party = yield* service.create({
            principal,
            tenantId,
            kind: "organization",
            name: "No Relationship Capability",
          })
          yield* service.assignRole({
            principal,
            tenantId,
            partyId: party.id,
            role: "supplier",
          })
          const legalEntity = yield* service.createLegalEntity({
            principal,
            tenantId,
            organizationPartyId: party.id,
          })
          assert.instanceOf(
            yield* Effect.flip(service.createRelationship({
              principal,
              tenantId,
              partyId: party.id,
              legalEntityId: legalEntity.id,
              kind: "supplier",
            })),
            AuthorizationDenied,
          )
        }),
        makePartyTestLayer(authorization),
      )
    }).pipe(
      Effect.provide(
        makeAuthorizationTestLayer([
          { identityId: principal.identityId, tenantId, capability: "party.create" },
          { identityId: principal.identityId, tenantId, capability: "party.role.assign" },
          { identityId: principal.identityId, tenantId, capability: "party.legal_entity.create" },
        ]),
      ),
    ))
})
