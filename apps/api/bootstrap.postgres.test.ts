import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { makeAuthService, TenantAlreadyExists } from "../../packages/auth/mod.ts"
import { makeAuthorizationService } from "../../packages/authorization/mod.ts"
import { makeAccountingService } from "../../packages/accounting/mod.ts"
import { makeIdentityService } from "../../packages/identity/mod.ts"
import { makeInventoryService } from "../../packages/inventory/mod.ts"
import { makePartyService } from "../../packages/party/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../packages/kernel/mod.ts"
import { withTemporaryDatabase } from "../../tests/support/postgres-database.ts"
import { bootstrapTenant } from "./bootstrap.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "bootstraps the tenant scope vertical slice against PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const identity = makeIdentityService(database)
        const identityRecord = yield* identity.create({
          email: `bootstrap-${crypto.randomUUID()}@example.test`,
        })
        const principal = { identityId: identityRecord.id, sessionId: "bootstrap-session" }
        const authorization = makeAuthorizationService(database)
        const services = {
          auth: makeAuthService(database),
          authorization,
          party: makePartyService(database, authorization),
          accounting: makeAccountingService(database, authorization),
          inventory: makeInventoryService(database, authorization),
        }
        const input = {
          principal,
          slug: `bootstrap-${crypto.randomUUID()}`,
          timezone: "UTC",
          organizationName: "Bootstrap Organization",
          branchName: "Main Branch",
          branchTimezone: "UTC",
          warehouseName: "Main Warehouse",
          baseCurrency: "USD",
          precision: 2,
          fiscalYearStartMonth: 1,
          postingEnabled: true,
        }

        const result = yield* bootstrapTenant(services, input)

        assert.strictEqual(result.tenant.slug, input.slug)
        assert.strictEqual(result.organizationParty.kind, "organization")
        assert.strictEqual(result.legalEntity.organizationPartyId, result.organizationParty.id)
        assert.strictEqual(result.branch.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.accountingConfiguration.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.warehouse.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.warehouse.primaryBranchId, result.branch.id)
        assert.instanceOf(
          yield* Effect.flip(bootstrapTenant(services, input)),
          TenantAlreadyExists,
        )
      })),
)
