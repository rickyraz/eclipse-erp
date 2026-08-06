import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { withTemporaryDatabase } from "../../tests/support/postgres-database.ts"
import { runMigrations } from "../../packages/kernel/mod.ts"
import { applyP0Backfill } from "./p0-backfill.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "applies explicit P0 scope and identifier mappings transactionally",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const tenantId = "00000000-0000-4000-8000-000000000001"
        const firstLegalEntityId = "00000000-0000-4000-8000-000000000002"
        const secondLegalEntityId = "00000000-0000-4000-8000-000000000003"
        const partyId = "00000000-0000-4000-8000-000000000004"
        const secondPartyId = "00000000-0000-4000-8000-000000000005"
        const warehouseId = "00000000-0000-4000-8000-000000000006"
        const identifierId = "00000000-0000-4000-8000-000000000007"

        yield* Effect.promise(() =>
          client.unsafe(`
            insert into auth.tenants (id, slug) values ('${tenantId}', 'p0-backfill')
          `)
        )
        yield* Effect.promise(() =>
          client.unsafe(`
            insert into party.parties (id, tenant_id, kind, name)
            values
              ('${partyId}', '${tenantId}', 'organization', 'P0 Backfill'),
              ('${secondPartyId}', '${tenantId}', 'organization', 'P0 Backfill 2')
          `)
        )
        yield* Effect.promise(() =>
          client.unsafe(`
            insert into party.legal_entities (id, tenant_id, organization_party_id)
            values
              ('${firstLegalEntityId}', '${tenantId}', '${partyId}'),
              ('${secondLegalEntityId}', '${tenantId}', '${secondPartyId}')
          `)
        )
        yield* Effect.promise(() =>
          client.unsafe(`
            insert into inventory.warehouses (id, tenant_id, legal_entity_id, name)
            values ('${warehouseId}', '${tenantId}', '${firstLegalEntityId}', 'P0 Backfill Warehouse')
          `)
        )
        yield* Effect.promise(() =>
          client.unsafe(`
            insert into party.party_identifiers
              (id, tenant_id, party_id, provider, scheme, scope, value)
            values
              ('${identifierId}', '${tenantId}', '${partyId}', 'LEGACY', 'CODE', 'global', 'P0-1')
          `)
        )

        yield* applyP0Backfill(client, {
          warehouseScopes: [{
            tenantId,
            warehouseId,
            legalEntityId: secondLegalEntityId,
            primaryBranchId: null,
          }],
          stockTransferScopes: [],
          identifierScopes: [{
            tenantId,
            identifierId,
            provider: "registry",
            legalEntityId: secondLegalEntityId,
          }],
        })

        const [warehouse] = yield* Effect.promise(() =>
          client<{ legal_entity_id: string }[]>`
            select legal_entity_id from inventory.warehouses where id = ${warehouseId}
          `
        )
        const [identifier] = yield* Effect.promise(() =>
          client<{ provider: string; legal_entity_id: string }[]>`
            select provider, legal_entity_id
            from party.party_identifiers
            where id = ${identifierId}
          `
        )
        assert.strictEqual(warehouse?.legal_entity_id, secondLegalEntityId)
        assert.strictEqual(identifier?.provider, "REGISTRY")
        assert.strictEqual(identifier?.legal_entity_id, secondLegalEntityId)
      })),
)
