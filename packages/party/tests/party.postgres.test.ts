import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import postgres from "postgres"

import { makeAuthService } from "../../auth/mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makePostgresDatabase } from "../../kernel/mod.ts"
import { ExternalIdentifierAlreadyAssigned, makePartyService } from "../mod.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "enforces scoped external identifier uniqueness in PostgreSQL",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() => postgres(databaseUrl!)),
      (client) => {
        const database = makePostgresDatabase(client)
        const auth = makeAuthService(database)
        const principal = { identityId: "party-integration", sessionId: "session" }
        const slug = `party-${crypto.randomUUID()}`

        return Effect.gen(function* () {
          const tenant = yield* auth.createTenant({ slug })
          yield* Effect.gen(function* () {
            const authorization = yield* AuthorizationService
            const party = makePartyService(database, authorization)
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
                  identityId: principal.identityId,
                  tenantId: tenant.id,
                  capability: "party.create",
                },
                {
                  identityId: principal.identityId,
                  tenantId: tenant.id,
                  capability: "party.identifier.attach",
                },
              ]),
            ),
          )
        }).pipe(
          Effect.ensuring(
            Effect.promise(() => client`delete from auth.tenants where slug = ${slug}`),
          ),
        )
      },
      (client) => Effect.promise(() => client.end()),
    ),
)
