import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"

import { AccountingCapabilities, AccountingPeriodNotOpen, makeAccountingService } from "../mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces legal entity accounting configuration scope in PostgreSQL",
  () =>
    withTemporaryDatabase(
      databaseUrl!,
      (client) =>
        Effect.gen(function* () {
          yield* runMigrations(client)

          const [tenant] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
            `
          )
          const [organization] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into party.parties (tenant_id, kind, name)
              values (${tenant!.id}, 'organization', 'Accounting Organization') returning id
            `
          )
          const [legalEntity] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${tenant!.id}, ${organization!.id}) returning id
            `
          )

          const [configuration] = yield* Effect.promise(() =>
            client<{
              tenant_id: string
              legal_entity_id: string
              base_currency: string
              decimal_precision: number
              fiscal_year_start_month: number
              posting_enabled: boolean
            }[]>`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
              returning tenant_id, legal_entity_id, base_currency, decimal_precision,
                fiscal_year_start_month, posting_enabled
            `
          )
          assert.strictEqual(configuration!.tenant_id, tenant!.id)
          assert.strictEqual(configuration!.legal_entity_id, legalEntity!.id)
          assert.strictEqual(configuration!.base_currency, "USD")
          assert.strictEqual(configuration!.decimal_precision, 2)
          assert.strictEqual(configuration!.fiscal_year_start_month, 1)
          assert.strictEqual(configuration!.posting_enabled, true)

          const unsupportedPrecision = yield* postgresFailure(() =>
            client`
              update accounting.legal_entity_accounting_configurations
              set decimal_precision = 3
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          assert.strictEqual((unsupportedPrecision as { code?: string }).code, "23514")
          assert.strictEqual(
            (unsupportedPrecision as { constraint_name?: string }).constraint_name,
            "legal_entity_accounting_configurations_precision_check",
          )

          const duplicate = yield* postgresFailure(() =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
            `
          )
          assert.strictEqual((duplicate as { code?: string }).code, "23505")
          assert.strictEqual(
            (duplicate as { constraint_name?: string }).constraint_name,
            "legal_entity_accounting_configurations_pkey",
          )

          const [otherTenant] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
            `
          )
          const crossTenant = yield* postgresFailure(() =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${otherTenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
            `
          )
          assert.strictEqual((crossTenant as { code?: string }).code, "23503")
          assert.strictEqual(
            (crossTenant as { constraint_name?: string }).constraint_name,
            "legal_entity_accounting_configurations_legal_entity_fkey",
          )
        }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "serializes period close with revenue posting and rejects later closed period posting",
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
              values (${tenant!.id}, 'organization', 'Accounting Service Organization') returning id
            `
          )
          const [legalEntity] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${tenant!.id}, ${organization!.id}) returning id
            `
          )
          const accounts = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'RECEIVABLE', 'Receivable', 'asset'),
                (${tenant!.id}, 'REVENUE', 'Revenue', 'revenue')
              returning id
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
              insert into accounting.revenue_posting_profiles
                (tenant_id, legal_entity_id, receivable_account_id, revenue_account_id)
              values (${tenant!.id}, ${legalEntity!.id}, ${accounts[0]!.id}, ${accounts[1]!.id})
            `
          )
          const [period] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on)
              values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31')
              returning id
            `
          )
          const principal = { userAccountId: "accounting-service", sessionId: "session" }
          const authorizationLayer = makeAuthorizationTestLayer(
            [AccountingCapabilities.periodClose, AccountingCapabilities.revenuePost].map(
              (capability) => ({
                userAccountId: principal.userAccountId,
                tenantId: tenant!.id,
                capability,
              }),
            ),
          )

          yield* Effect.gen(function* () {
            const authorization = yield* AuthorizationService
            const accounting = yield* Effect.provide(
              makeAccountingService,
              Layer.merge(
                Layer.succeed(Database, database),
                Layer.succeed(AuthorizationService, authorization),
              ),
            )
            const [closeResult, postResult] = yield* Effect.all([
              accounting.closePeriod({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                periodId: period!.id,
              }).pipe(Effect.result),
              accounting.postRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: "concurrent-order",
                amount: "10.00",
              }).pipe(Effect.result),
            ], { concurrency: "unbounded" })

            assert.isTrue(Result.isSuccess(closeResult))
            if (Result.isFailure(postResult)) {
              assert.instanceOf(postResult.failure, AccountingPeriodNotOpen)
            } else {
              assert.strictEqual(postResult.success.status, "posted")
            }
            assert.instanceOf(
              yield* Effect.flip(accounting.postRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: "after-close",
                amount: "10.00",
              })),
              AccountingPeriodNotOpen,
            )
          }).pipe(Effect.provide(authorizationLayer))
        }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces balanced and immutable posted journals in PostgreSQL",
  () =>
    withTemporaryDatabase(
      databaseUrl!,
      (client) =>
        Effect.gen(function* () {
          yield* runMigrations(client)

          const [tenant] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
            `
          )
          const accounts = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'CASH', 'Cash', 'asset'),
                (${tenant!.id}, 'REVENUE', 'Revenue', 'revenue')
              returning id
            `
          )

          const unbalanced = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              const [entry] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'UNBALANCED') returning id
              `
              await transaction`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values (${tenant!.id}, ${entry!.id}, ${accounts[0]!.id}, 10, 0)
              `
              await transaction`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where id = ${entry!.id}
              `
            })
          )
          assert.strictEqual((unbalanced as { code?: string }).code, "23514")
          assert.strictEqual(
            (unbalanced as { constraint_name?: string }).constraint_name,
            "journal_entries_balanced_check",
          )

          const [posted] = yield* Effect.promise(() =>
            client.begin(async (transaction) => {
              const [entry] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'POSTED') returning id
              `
              await transaction`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${entry!.id}, ${accounts[0]!.id}, 10, 0),
                  (${tenant!.id}, ${entry!.id}, ${accounts[1]!.id}, 0, 10)
              `
              await transaction`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where id = ${entry!.id}
              `
              return [entry]
            })
          )
          const immutable = yield* postgresFailure(() =>
            client`
              update accounting.journal_lines
              set debit = 20
              where entry_id = ${posted!.id} and debit > 0
            `
          )
          assert.strictEqual((immutable as { code?: string }).code, "55000")
        }),
    ),
)
