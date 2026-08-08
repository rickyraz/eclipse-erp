import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  BranchAlreadyExists,
  ExternalIdentifierAlreadyAssigned,
  PartyRepresentationAlreadyExists,
  PartyRepresentationUserAccountNotFound,
  PartyRepresentationNotFound,
  LegalEntityAlreadyExists,
  LegalEntityNotFound,
  makePartyTestLayer,
  OrganizationRequired,
  PartyRelationshipAlreadyExists,
  PartyRelationshipRoleNotAssigned,
  PartyRoleAlreadyAssigned,
  PartyService,
  PartyCapabilities,
} from "../mod.ts"

const principal = { userAccountId: "party-admin", sessionId: "session" }
const tenantId = "tenant-a"
const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  PartyCapabilities.partyRoleAssign,
  PartyCapabilities.partyRelationshipCreate,
  PartyCapabilities.partyIdentifierAttach,
  PartyCapabilities.partyRepresentationCreate,
  PartyCapabilities.partyRepresentationActivate,
  PartyCapabilities.partyRepresentationDeactivate,
] as const

const authorizationLayer = makeAuthorizationTestLayer(
  capabilities.map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability })),
)

const withParty = <A, E>(program: Effect.Effect<A, E, PartyService>) =>
  Effect.provide(
    program,
    makePartyTestLayer().pipe(Layer.provide(authorizationLayer)),
  )

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
        provider: "gs1",
        scheme: "gln",
        scope: "global",
        value: "1234567890123",
      })
      const legalEntity = yield* service.createLegalEntity({
        principal,
        tenantId,
        organizationId: party.id,
      })
      const branch = yield* service.createBranch({
        principal,
        tenantId,
        legalEntityId: legalEntity.id,
        name: " Jakarta ",
        timezone: " Asia/Jakarta ",
        localTaxRegistration: " TAX-JKT-001 ",
        dedicatedJournalCode: "JKT-OPS",
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
      assert.strictEqual(legalEntity.organizationId, party.id)
      assert.strictEqual(branch.name, "Jakarta")
      assert.strictEqual(branch.timezone, "Asia/Jakarta")
      assert.strictEqual(branch.localTaxRegistration, "TAX-JKT-001")
      assert.strictEqual(branch.dedicatedJournalCode, "JKT-OPS")
      assert.strictEqual(relationship.kind, "customer")
      assert.strictEqual(relationship.active, true)
    })))

  it.effect("creates and deactivates an identity-party representation", () => {
    const authorization = makeAuthorizationTestLayer([
      { userAccountId: principal.userAccountId, tenantId, capability: PartyCapabilities.partyCreate },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRepresentationCreate,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRepresentationActivate,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRepresentationDeactivate,
      },
    ])
    return Effect.provide(
      Effect.gen(function* () {
        const service = yield* PartyService
        const party = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Represented Organization",
        })
        const input = {
          principal,
          tenantId,
          userAccountId: "user-account-1",
          partyId: party.id,
          kind: "representative",
        }
        const representation = yield* service.createPartyRepresentation(input)
        assert.strictEqual(representation.active, true)
        assert.strictEqual(representation.kind, "representative")
        assert.instanceOf(
          yield* Effect.flip(service.createPartyRepresentation(input)),
          PartyRepresentationAlreadyExists,
        )
        const deactivated = yield* service.setPartyRepresentationActive({
          principal,
          tenantId,
          representationId: representation.id,
          active: false,
        })
        assert.strictEqual(deactivated.active, false)
        assert.instanceOf(
          yield* Effect.flip(service.setPartyRepresentationActive({
            principal,
            tenantId,
            representationId: "missing",
            active: true,
          })),
          PartyRepresentationNotFound,
        )
        assert.instanceOf(
          yield* Effect.flip(service.createPartyRepresentation({
            ...input,
            userAccountId: "missing",
          })),
          PartyRepresentationUserAccountNotFound,
        )
      }),
      makePartyTestLayer(new Set(["user-account-1"])).pipe(Layer.provide(authorization))
    )
  })

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
        provider: "gleif",
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
        organizationId: first.id,
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
          organizationId: first.id,
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

  it.effect("scopes external identifiers by provider and legal entity", () =>
    withParty(Effect.gen(function* () {
      const service = yield* PartyService
      const first = yield* service.create({
        principal,
        tenantId,
        kind: "organization",
        name: "First Identifier Owner",
      })
      const second = yield* service.create({
        principal,
        tenantId,
        kind: "organization",
        name: "Second Identifier Owner",
      })
      const firstLegalEntity = yield* service.createLegalEntity({
        principal,
        tenantId,
        organizationId: first.id,
      })
      const secondLegalEntity = yield* service.createLegalEntity({
        principal,
        tenantId,
        organizationId: second.id,
      })
      const identifier = {
        principal,
        tenantId,
        provider: "registry",
        scheme: "account",
        scope: "local",
        value: "42",
      }
      const firstIdentifier = yield* service.attachIdentifier({
        ...identifier,
        partyId: first.id,
        legalEntityId: firstLegalEntity.id,
      })
      const secondIdentifier = yield* service.attachIdentifier({
        ...identifier,
        partyId: second.id,
        legalEntityId: secondLegalEntity.id,
      })

      assert.strictEqual(firstIdentifier.provider, "REGISTRY")
      assert.strictEqual(firstIdentifier.legalEntityId, firstLegalEntity.id)
      assert.strictEqual(secondIdentifier.legalEntityId, secondLegalEntity.id)
      assert.instanceOf(
        yield* Effect.flip(service.attachIdentifier({
          ...identifier,
          partyId: first.id,
          legalEntityId: "missing",
        })),
        LegalEntityNotFound,
      )
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
        organizationId: party.id,
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
          organizationId: person.id,
        })),
        OrganizationRequired,
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

  it.effect("denies legal entity creation without its capability", () => {
    const authorization = makeAuthorizationTestLayer([
      { userAccountId: principal.userAccountId, tenantId, capability: PartyCapabilities.partyCreate },
    ])
    return Effect.provide(
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
            organizationId: party.id,
          })),
          AuthorizationDenied,
        )
      }),
      makePartyTestLayer().pipe(Layer.provide(authorization)),
    )
  })

  it.effect("denies relationship creation without its capability", () => {
    const authorization = makeAuthorizationTestLayer([
      { userAccountId: principal.userAccountId, tenantId, capability: PartyCapabilities.partyCreate },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRoleAssign,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.legalEntityCreate,
      },
    ])
    return Effect.provide(
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
          organizationId: party.id,
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
      makePartyTestLayer().pipe(Layer.provide(authorization)),
    )
  })
})
