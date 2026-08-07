import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { makeAuthService } from "../../auth/mod.ts"
import { makeUserAccountService, UserAccountService } from "../../identity/mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { Database, makePostgresDatabase, runMigrations, WebCryptoLive } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import {
  BranchAlreadyExists,
  ExternalIdentifierAlreadyAssigned,
  LegalEntityAlreadyExists,
  makePartyService,
  OrganizationRequired,
  PartyRelationshipAlreadyExists,
  PartyRelationshipRoleNotAssigned,
  PartyRepresentationAlreadyExists,
  PartyRepresentationNotFound,
} from "../mod.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "enforces scoped external identifier uniqueness in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const principal = { userAccountId: "party-integration", sessionId: "session" }
        const tenant = yield* auth.createTenant({ slug: `party-${crypto.randomUUID()}` })
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const party = yield* makePartyService.pipe(
            Effect.provideService(Database, database),
            Effect.provideService(AuthorizationService, authorization),
          )
          const first = yield* party.create({
            principal,
            tenantId: tenant.id,
            kind: "organization",
            name: "First",
          })
          const second = yield* party.create({
            principal,
            tenantId: tenant.id,
            kind: "organization",
            name: "Second",
          })
          const identifier = {
            principal,
            tenantId: tenant.id,
            partyId: first.id,
            provider: "GS1",
            scheme: "GLN",
            scope: "global",
            value: "1234567890123",
          }
          yield* party.attachIdentifier(identifier)
          assert.instanceOf(
            yield* Effect.flip(party.attachIdentifier({ ...identifier, partyId: second.id })),
            ExternalIdentifierAlreadyAssigned,
          )
        }).pipe(
          Effect.provide(
            makeAuthorizationTestLayer([
              {
                userAccountId: principal.userAccountId,
                tenantId: tenant.id,
                capability: "party.create",
              },
              {
                userAccountId: principal.userAccountId,
                tenantId: tenant.id,
                capability: "party.identifier.attach",
              },
            ]),
          ),
        )
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces legal entity ownership and branch uniqueness in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const principal = { userAccountId: "scope-integration", sessionId: "session" }
        const tenant = yield* auth.createTenant({
          slug: `scope-${crypto.randomUUID()}`,
          timezone: "UTC",
        })
        const authorizationLayer = makeAuthorizationTestLayer([
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.create",
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.legal_entity.create",
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.branch.create",
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.role.assign",
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.relationship.create",
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.identifier.attach",
          },
        ])

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const party = yield* makePartyService.pipe(
            Effect.provideService(Database, database),
            Effect.provideService(AuthorizationService, authorization),
          )
          const organization = yield* party.create({
            principal,
            tenantId: tenant.id,
            kind: "organization",
            name: "Scope Organization",
          })
          const person = yield* party.create({
            principal,
            tenantId: tenant.id,
            kind: "person",
            name: "Scope Person",
          })
          const secondOrganization = yield* party.create({
            principal,
            tenantId: tenant.id,
            kind: "organization",
            name: "Second Scope Organization",
          })
          const legalEntity = yield* party.createLegalEntity({
            principal,
            tenantId: tenant.id,
            organizationId: organization.id,
          })
          const secondLegalEntity = yield* party.createLegalEntity({
            principal,
            tenantId: tenant.id,
            organizationId: secondOrganization.id,
          })
          const scopedIdentifier = {
            principal,
            tenantId: tenant.id,
            provider: "GLEIF",
            scheme: "LEI",
            scope: "registry",
            value: "5493001KJTIIGC8Y1R12",
          }
          const firstIdentifier = yield* party.attachIdentifier({
            ...scopedIdentifier,
            partyId: organization.id,
            legalEntityId: legalEntity.id,
          })
          const secondIdentifier = yield* party.attachIdentifier({
            ...scopedIdentifier,
            partyId: secondOrganization.id,
            legalEntityId: secondLegalEntity.id,
          })
          assert.strictEqual(firstIdentifier.legalEntityId, legalEntity.id)
          assert.strictEqual(secondIdentifier.legalEntityId, secondLegalEntity.id)
          assert.instanceOf(
            yield* Effect.flip(party.attachIdentifier({
              ...scopedIdentifier,
              partyId: organization.id,
              legalEntityId: legalEntity.id,
            })),
            ExternalIdentifierAlreadyAssigned,
          )
          assert.instanceOf(
            yield* Effect.flip(party.createRelationship({
              principal,
              tenantId: tenant.id,
              partyId: person.id,
              legalEntityId: legalEntity.id,
              kind: "supplier",
            })),
            PartyRelationshipRoleNotAssigned,
          )
          yield* party.assignRole({
            principal,
            tenantId: tenant.id,
            partyId: organization.id,
            role: "customer",
          })
          const relationship = yield* party.createRelationship({
            principal,
            tenantId: tenant.id,
            partyId: organization.id,
            legalEntityId: legalEntity.id,
            kind: "customer",
          })
          assert.strictEqual(relationship.active, true)
          assert.instanceOf(
            yield* Effect.flip(party.createRelationship({
              principal,
              tenantId: tenant.id,
              partyId: organization.id,
              legalEntityId: legalEntity.id,
              kind: "customer",
            })),
            PartyRelationshipAlreadyExists,
          )
          assert.instanceOf(
            yield* Effect.flip(party.createLegalEntity({
              principal,
              tenantId: tenant.id,
              organizationId: organization.id,
            })),
            LegalEntityAlreadyExists,
          )
          assert.instanceOf(
            yield* Effect.flip(party.createLegalEntity({
              principal,
              tenantId: tenant.id,
              organizationId: person.id,
            })),
            OrganizationRequired,
          )
          const branch = yield* party.createBranch({
            principal,
            tenantId: tenant.id,
            legalEntityId: legalEntity.id,
            name: "Jakarta",
            timezone: "Asia/Jakarta",
            localTaxRegistration: "TAX-JKT-001",
            dedicatedJournalCode: "JKT-OPS",
          })
          assert.strictEqual(branch.timezone, "Asia/Jakarta")
          assert.strictEqual(branch.localTaxRegistration, "TAX-JKT-001")
          assert.strictEqual(branch.dedicatedJournalCode, "JKT-OPS")
          assert.instanceOf(
            yield* Effect.flip(party.createBranch({
              principal,
              tenantId: tenant.id,
              legalEntityId: legalEntity.id,
              name: "Jakarta",
            })),
            BranchAlreadyExists,
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces identity-party representation scope in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const principal = { userAccountId: "representation-admin", sessionId: "session" }
        const tenant = yield* auth.createTenant({ slug: `representation-${crypto.randomUUID()}` })
        const userAccount = yield* userAccountService.create({
          email: `representation-${crypto.randomUUID()}@example.test`,
        })
        const authorizationLayer = makeAuthorizationTestLayer([
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.create",
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability: "party.representation.write",
          },
        ])

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const party = yield* makePartyService.pipe(
            Effect.provideService(Database, database),
            Effect.provideService(AuthorizationService, authorization),
          )
          const representedParty = yield* party.create({
            principal,
            tenantId: tenant.id,
            kind: "organization",
            name: "Represented Organization",
          })
          const input = {
            principal,
            tenantId: tenant.id,
            userAccountId: userAccount.id,
            partyId: representedParty.id,
            kind: "representative",
          }
          const representation = yield* party.createPartyRepresentation(input)
          assert.strictEqual(representation.active, true)
          assert.instanceOf(
            yield* Effect.flip(party.createPartyRepresentation(input)),
            PartyRepresentationAlreadyExists,
          )
          const inactive = yield* party.setPartyRepresentationActive({
            principal,
            tenantId: tenant.id,
            representationId: representation.id,
            active: false,
          })
          assert.strictEqual(inactive.active, false)
          assert.instanceOf(
            yield* Effect.flip(party.setPartyRepresentationActive({
              principal,
              tenantId: tenant.id,
              representationId: "00000000-0000-0000-0000-000000000000",
              active: true,
            })),
            PartyRepresentationNotFound,
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)
