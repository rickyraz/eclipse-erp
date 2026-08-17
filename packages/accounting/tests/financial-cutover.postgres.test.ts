import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  AccountingCapabilities,
  FinancialEngineCutoverBlocked,
  makeAccountingService,
  makeFinancialLedgerTestLayer,
} from "../mod.ts"
import { makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const sales = {} as SalesService

it.effect.skipIf(databaseUrl === undefined)(
  "enforces the controlled cutover state machine",
  () =>
    withTemporaryDatabase(
      databaseUrl!,
      (client) =>
        Effect.gen(function* () {
          yield* runMigrations(client)
          const database = makePostgresDatabase(client)
          const [tenant] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
          )
          const [organization] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.parties (tenant_id, kind, name)
            values (${tenant!.id}, 'organization', 'Cutover Organization') returning id
          `
          )
          const [legalEntity] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.legal_entities (tenant_id, organization_party_id)
            values (${tenant!.id}, ${organization!.id}) returning id
          `
          )
          yield* Effect.promise(() =>
            client`
            insert into accounting.legal_entity_accounting_configurations
              (tenant_id, legal_entity_id, base_currency, decimal_precision,
               fiscal_year_start_month, posting_enabled)
            values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
          `
          )
          yield* Effect.promise(() =>
            client`
            insert into accounting.accounts (tenant_id, code, name, type)
            values
              (${tenant!.id}, '1000', 'Cash', 'asset'),
              (${tenant!.id}, '4000', 'Revenue', 'revenue')
          `
          )
          const principal = {
            userAccountId: crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
          }
          const authorization = makeAuthorizationTestLayer([{
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialEngineActivate,
          }])
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const service = yield* Effect.provide(
            makeAccountingService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(SalesService, sales),
              makeFinancialLedgerTestLayer(),
            ),
          )

          const prepared = yield* service.prepareTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.strictEqual(prepared.status, "preparing_tigerbeetle")

          const blocked = yield* Effect.flip(service.approveTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            cutoverWatermark: "cutover-1",
            verificationHash: "hash-1",
            openingBalanceVerified: true,
            historicalBoundaryVerified: true,
            reconciliationHealthy: true,
            backupRecoveryVerified: false,
          }))
          assert.instanceOf(blocked, FinancialEngineCutoverBlocked)
          assert.strictEqual(blocked.reason, "verification_mismatch")

          const approved = yield* service.approveTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            cutoverWatermark: "cutover-1",
            verificationHash: "hash-1",
            openingBalanceVerified: true,
            historicalBoundaryVerified: true,
            reconciliationHealthy: true,
            backupRecoveryVerified: true,
          })
          assert.strictEqual(approved.status, "approved")
          assert.strictEqual(approved.approvedBy, principal.userAccountId)

          const activated = yield* service.activateTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.strictEqual(activated.status, "tigerbeetle")
          assert.strictEqual(activated.activatedBy, principal.userAccountId)

          const idempotent = yield* service.activateTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.deepStrictEqual(idempotent, activated)

          const [configuration] = yield* Effect.promise(() =>
            client<{ financial_engine: string }[]>`
            select financial_engine
            from accounting.legal_entity_accounting_configurations
            where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
          `
          )
          assert.strictEqual(configuration!.financial_engine, "tigerbeetle")

          const [otherOrganization] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.parties (tenant_id, kind, name)
            values (${tenant!.id}, 'organization', 'Second Cutover Organization') returning id
          `
          )
          const [otherEntity] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.legal_entities (tenant_id, organization_party_id)
            values (${tenant!.id}, ${otherOrganization!.id}) returning id
          `
          )
          yield* Effect.promise(() =>
            client`
            insert into accounting.legal_entity_accounting_configurations
              (tenant_id, legal_entity_id, base_currency, decimal_precision,
               fiscal_year_start_month, posting_enabled)
            values (${tenant!.id}, ${otherEntity!.id}, 'USD', 2, 1, true)
          `
          )
          const bypass = yield* Effect.flip(Effect.tryPromise({
            try: () =>
              client`
            update accounting.legal_entity_accounting_configurations
            set financial_engine = 'tigerbeetle'
            where tenant_id = ${tenant!.id} and legal_entity_id = ${otherEntity!.id}
          `,
            catch: (cause) => cause,
          }))
          assert.strictEqual(
            (bypass as { constraint_name?: string }).constraint_name,
            "legal_entity_accounting_engine_activation_gate_check",
          )
        }),
    ),
)
