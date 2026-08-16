import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  AccountingCapabilities,
  AccountingPeriodNotOpen,
  AccountingRevenuePostedEvent,
  JournalIdempotencyConflict,
  makeAccountingService,
} from "../mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { Database, DatabaseFailure, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
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
  "revenue posted atomic publication preserves metadata, replay, and rollback",
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
              values (${tenant!.id}, 'organization', 'Atomic Revenue Organization') returning id
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
                (${tenant!.id}, 'ATOMIC-RECEIVABLE', 'Receivable', 'asset'),
                (${tenant!.id}, 'ATOMIC-REVENUE', 'Revenue', 'revenue')
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
          yield* Effect.promise(() =>
            client`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on)
              values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31')
            `
          )
          const principal = { userAccountId: "accounting-atomic", sessionId: "session" }
          const authorizationLayer = makeAuthorizationTestLayer([
            {
              userAccountId: principal.userAccountId,
              tenantId: tenant!.id,
              capability: AccountingCapabilities.revenuePost,
            },
            {
              userAccountId: principal.userAccountId,
              tenantId: tenant!.id,
              capability: AccountingCapabilities.revenueReverse,
            },
          ])

          yield* Effect.gen(function* () {
            const authorization = yield* AuthorizationService
            const messaging = yield* makeMessagingService.pipe(
              Effect.provideService(Database, database),
            )
            const requirements = Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(MessagingService, messaging),
            )
            const accounting = yield* Effect.provide(makeAccountingService, requirements)
            const input = {
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              orderId: crypto.randomUUID(),
              amount: "10.00",
              commandId: "revenue-command-atomic",
              correlationId: "revenue-correlation-atomic",
              causationId: "order-confirmed-atomic",
            }
            const [journal, concurrent] = yield* Effect.all(
              [accounting.postRevenueForOrder(input), accounting.postRevenueForOrder(input)],
              { concurrency: "unbounded" },
            )
            assert.strictEqual(concurrent.id, journal.id)
            const replay = yield* accounting.postRevenueForOrder({
              ...input,
              commandId: "revenue-command-retry",
              correlationId: "revenue-correlation-retry",
            })
            assert.strictEqual(replay.id, journal.id)
            const [reversal, concurrentReversal] = yield* Effect.all(
              [
                accounting.reverseRevenueForOrder({
                  principal,
                  tenantId: tenant!.id,
                  legalEntityId: legalEntity!.id,
                  orderId: input.orderId,
                }),
                accounting.reverseRevenueForOrder({
                  principal,
                  tenantId: tenant!.id,
                  legalEntityId: legalEntity!.id,
                  orderId: input.orderId,
                }),
              ],
              { concurrency: "unbounded" },
            )
            assert.strictEqual(concurrentReversal.id, reversal.id)
            assert.strictEqual(reversal.status, "reversed")
            const draftReversalOrderId = crypto.randomUUID()
            yield* Effect.promise(() =>
              client`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue-reversal:${
                legalEntity!.id
              }:${draftReversalOrderId}`})
              `
            )
            assert.instanceOf(
              yield* Effect.flip(accounting.reverseRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: draftReversalOrderId,
              })),
              JournalIdempotencyConflict,
            )
            const draftOrderId = crypto.randomUUID()
            yield* Effect.promise(() =>
              client`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue:${legalEntity!.id}:${draftOrderId}`})
              `
            )
            assert.instanceOf(
              yield* Effect.flip(accounting.postRevenueForOrder({
                ...input,
                orderId: draftOrderId,
                commandId: "revenue-draft-command",
                correlationId: "revenue-draft-correlation",
              })),
              JournalIdempotencyConflict,
            )

            const events = yield* Effect.promise(() =>
              client<{
                id: string
                event_type: string
                event_version: number
                aggregate_type: string
                aggregate_id: string
                command_id: string
                correlation_id: string
                causation_id: string | null
                idempotency_key: string
                actor_principal_id: string
                occurred_at: string
                payload: unknown
              }[]>`
                select id, event_type, event_version, aggregate_type, aggregate_id,
                  command_id, correlation_id, causation_id, idempotency_key,
                  actor_principal_id, occurred_at, payload
                from messaging.event_outbox
                where tenant_id = ${tenant!.id}
                  and event_type = ${AccountingRevenuePostedEvent.id}
              `
            )
            assert.strictEqual(events.length, 1)
            yield* Schema.decodeUnknownEffect(AccountingRevenuePostedEvent.payloadSchema)(
              events[0]?.payload,
            )
            assert.notStrictEqual(events[0]?.id, journal.id)
            assert.deepStrictEqual(events[0], {
              id: events[0]!.id,
              event_type: AccountingRevenuePostedEvent.id,
              event_version: AccountingRevenuePostedEvent.version,
              aggregate_type: AccountingRevenuePostedEvent.aggregateType,
              aggregate_id: journal.id,
              command_id: input.commandId,
              correlation_id: input.correlationId,
              causation_id: input.causationId,
              idempotency_key: input.orderId,
              actor_principal_id: principal.userAccountId,
              occurred_at: events[0]!.occurred_at,
              payload: {
                journalId: journal.id,
                legalEntityId: legalEntity!.id,
                orderId: input.orderId,
              },
            })
            assert.strictEqual(
              new Set([
                events[0]!.command_id,
                events[0]!.correlation_id,
                events[0]!.causation_id,
                events[0]!.idempotency_key,
              ]).size,
              4,
            )

            const failingAccounting = yield* Effect.provide(
              makeAccountingService,
              Layer.mergeAll(
                Layer.succeed(Database, database),
                Layer.succeed(AuthorizationService, authorization),
                Layer.succeed(MessagingService, {
                  ...messaging,
                  append: () =>
                    Effect.fail(
                      new DatabaseFailure({ operation: "messaging.test.append", cause: null }),
                    ),
                }),
              ),
            )
            assert.instanceOf(
              yield* Effect.flip(failingAccounting.postRevenueForOrder({
                ...input,
                orderId: crypto.randomUUID(),
                commandId: "revenue-command-rollback",
                correlationId: "revenue-correlation-rollback",
              })),
              DatabaseFailure,
            )
            const [rolledBack] = yield* Effect.promise(() =>
              client<{ journals: string; lines: string; events: string }[]>`
                select
                  (select count(*)::text from accounting.journal_entries
                    where tenant_id = ${tenant!.id}
                      and reference = ${`revenue:${
                legalEntity!.id
              }:revenue-order-rollback`}) as journals,
                  (select count(*)::text from accounting.journal_lines l
                    join accounting.journal_entries j on j.id = l.entry_id
                    where j.tenant_id = ${tenant!.id}
                      and j.reference = ${`revenue:${
                legalEntity!.id
              }:revenue-order-rollback`}) as lines,
                  (select count(*)::text from messaging.event_outbox
                    where tenant_id = ${tenant!.id}
                      and idempotency_key = 'revenue-order-rollback') as events
              `
            )
            assert.deepStrictEqual(rolledBack, { journals: "0", lines: "0", events: "0" })
          }).pipe(Effect.provide(authorizationLayer))
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
            const messaging = yield* makeMessagingService.pipe(
              Effect.provideService(Database, database),
            )
            const accounting = yield* Effect.provide(
              makeAccountingService,
              Layer.mergeAll(
                Layer.succeed(Database, database),
                Layer.succeed(AuthorizationService, authorization),
                Layer.succeed(MessagingService, messaging),
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
                orderId: crypto.randomUUID(),
                amount: "10.00",
                commandId: "concurrent-command",
                correlationId: "concurrent-correlation",
                causationId: null,
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
                orderId: crypto.randomUUID(),
                amount: "10.00",
                commandId: "after-close-command",
                correlationId: "after-close-correlation",
                causationId: null,
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
          const blankReference = yield* postgresFailure(() =>
            client`
              insert into accounting.journal_entries (tenant_id, reference)
              values (${tenant!.id}, '   ')
            `
          )
          assert.strictEqual((blankReference as { code?: string }).code, "23514")
          assert.strictEqual(
            (blankReference as { constraint_name?: string }).constraint_name,
            "journal_entries_reference_check",
          )
          const [source] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference)
              values (${tenant!.id}, 'REVERSAL-SOURCE') returning id
            `
          )
          const invalidReversalState = yield* postgresFailure(() =>
            client`
              insert into accounting.journal_entries
                (tenant_id, reference, reverses_entry_id)
              values (${tenant!.id}, 'INVALID-REVERSAL-STATE', ${source!.id})
            `
          )
          assert.strictEqual((invalidReversalState as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidReversalState as { constraint_name?: string }).constraint_name,
            "journal_entries_reversal_state_check",
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
