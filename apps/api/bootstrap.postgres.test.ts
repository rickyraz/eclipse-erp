import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthService, makeAuthService, TenantAlreadyExists } from "../../packages/auth/mod.ts"
import {
  AuthorizationService,
  makeAuthorizationService,
} from "../../packages/authorization/mod.ts"
import { AccountingService, makeAccountingService } from "../../packages/accounting/mod.ts"
import { makeIdentityService } from "../../packages/identity/mod.ts"
import { InventoryService, makeInventoryService } from "../../packages/inventory/mod.ts"
import { PartyService, makePartyService } from "../../packages/party/mod.ts"
import {
  Database,
  makePostgresDatabase,
  runMigrations,
  WebCryptoLive,
} from "../../packages/kernel/mod.ts"
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
        const databaseLayer = Layer.succeed(Database, database)
        const identity = yield* Effect.provide(makeIdentityService, databaseLayer)
        const identityRecord = yield* identity.create({
          email: `bootstrap-${crypto.randomUUID()}@example.test`,
        })
        const principal = { identityId: identityRecord.id, sessionId: "bootstrap-session" }
        const authorization = yield* Effect.provide(makeAuthorizationService, databaseLayer)
        const authorizationLayer = Layer.succeed(AuthorizationService, authorization)
        const businessRequirements = Layer.merge(databaseLayer, authorizationLayer)
        const auth = yield* Effect.provide(
          makeAuthService,
          Layer.merge(databaseLayer, WebCryptoLive),
        )
        const party = yield* Effect.provide(makePartyService, businessRequirements)
        const accounting = yield* Effect.provide(makeAccountingService, businessRequirements)
        const inventory = yield* Effect.provide(makeInventoryService, businessRequirements)
        const services = Layer.mergeAll(
          Layer.succeed(AuthService, auth),
          authorizationLayer,
          Layer.succeed(PartyService, party),
          Layer.succeed(AccountingService, accounting),
          Layer.succeed(InventoryService, inventory),
        )
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

        const result = yield* Effect.provide(bootstrapTenant(input), services)

        assert.strictEqual(result.tenant.slug, input.slug)
        assert.strictEqual(result.organizationParty.kind, "organization")
        assert.strictEqual(result.legalEntity.organizationPartyId, result.organizationParty.id)
        assert.strictEqual(result.branch.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.accountingConfiguration.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.warehouse.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.warehouse.primaryBranchId, result.branch.id)
        assert.instanceOf(
          yield* Effect.flip(Effect.provide(bootstrapTenant(input), services)),
          TenantAlreadyExists,
        )
      })),
)
