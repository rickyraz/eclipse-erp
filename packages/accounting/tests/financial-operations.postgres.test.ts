import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  AccountingCapabilities,
  FinancialOperationsPending,
  makeAccountingService,
  makeFinancialLedgerTestLayer,
  makeFinancialOperationService,
} from "../mod.ts"
import { makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  Database,
  DatabaseFailure,
  DurableJobEnqueuer,
  makePostgresDatabase,
  runMigrations,
} from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import { makeProcessJobEnqueuer } from "../../process/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "persists a financial intent, submits it once, and projects the receipt",
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
              values (${
              tenant!.id
            }, 'organization', 'Financial Operation Organization') returning id
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
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on, status)
              values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31', 'open')
            `
          )
          const [debitAccount] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values (${tenant!.id}, '1000', 'Cash', 'asset') returning id
            `
          )
          const [creditAccount] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values (${tenant!.id}, '4000', 'Revenue', 'revenue') returning id
            `
          )

          yield* Effect.promise(() =>
            client`
              insert into accounting.revenue_posting_profiles
                (tenant_id, legal_entity_id, receivable_account_id, revenue_account_id)
              values (${tenant!.id}, ${legalEntity!.id}, ${debitAccount!.id}, ${creditAccount!.id})
            `
          )
          const principal = {
            userAccountId: crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
          }
          const authorization = makeAuthorizationTestLayer([{
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.journalPost,
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.revenuePost,
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.periodClose,
          }])
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const jobs = yield* makeProcessJobEnqueuer.pipe(
            Effect.provideService(Database, database),
          )
          const ledger = makeFinancialLedgerTestLayer()
          const sales = {
            getConfirmedOrderTotal: () => Effect.succeed("7.50"),
          } as unknown as SalesService
          const service = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              ledger,
            ),
          )

          const revenue = yield* service.createRevenueIntent({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            orderId: crypto.randomUUID(),
            commandId: `revenue-${crypto.randomUUID()}`,
            correlationId: `revenue-correlation-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
          })
          assert.strictEqual(revenue.status, "intent")
          const postedRevenue = yield* service.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: revenue.operationId,
          })
          assert.strictEqual(postedRevenue.status, "reconciled")

          const revenuePrincipal = {
            userAccountId: crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
          }
          const revenueOnlyService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              makeAuthorizationTestLayer([{
                userAccountId: revenuePrincipal.userAccountId,
                tenantId: tenant!.id,
                capability: AccountingCapabilities.revenuePost,
              }]),
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              makeFinancialLedgerTestLayer(),
            ),
          )
          const revenueOnlyIntent = yield* revenueOnlyService.createRevenueIntent({
            principal: revenuePrincipal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            orderId: crypto.randomUUID(),
            commandId: `revenue-only-${crypto.randomUUID()}`,
            correlationId: `revenue-only-correlation-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
          })
          const revenueOnlyPosted = yield* revenueOnlyService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: revenueOnlyIntent.operationId,
          })
          assert.strictEqual(revenueOnlyPosted.status, "reconciled")

          const lostLedger = makeFinancialLedgerTestLayer({ loseResponseFor: "lost-operation" })
          const lostService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              lostLedger,
            ),
          )

          const input = {
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            operationId: `operation-${crypto.randomUUID()}`,
            reference: `financial-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
            lines: [
              { accountId: debitAccount!.id, debit: "12.50", credit: "0" },
              { accountId: creditAccount!.id, debit: "0", credit: "12.50" },
            ],
            correlationId: `correlation-${crypto.randomUUID()}`,
          }
          const intent = yield* service.createJournalIntent(input)
          assert.strictEqual(intent.status, "intent")

          const [queued] = yield* Effect.promise(() =>
            client<{ job_type: string; idempotency_key: string }[]>`
              select job_type, idempotency_key from process.jobs
              where tenant_id = ${tenant!.id} and idempotency_key = ${input.operationId}
            `
          )
          assert.strictEqual(queued!.job_type, "accounting.financial_operation.submit")
          assert.strictEqual(queued!.idempotency_key, input.operationId)

          const posted = yield* service.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: input.operationId,
          })
          assert.strictEqual(posted.status, "reconciled")

          let failReceipt = true
          const failingMessaging = {
            ...messaging,
            append: (event: unknown) =>
              failReceipt
                ? Effect.fail(
                  new DatabaseFailure({
                    operation: "financial-operation.test.receipt",
                    cause: null,
                  }),
                )
                : messaging.append(event),
          } as typeof messaging
          const failingService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, failingMessaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              makeFinancialLedgerTestLayer(),
            ),
          )
          const failedInput = {
            ...input,
            operationId: "postgres-receipt-failure",
            reference: `receipt-failure-${crypto.randomUUID()}`,
          }
          yield* failingService.createJournalIntent(failedInput)
          const receiptFailure = yield* Effect.flip(failingService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: failedInput.operationId,
          }))
          assert.instanceOf(receiptFailure, DatabaseFailure)
          const [failedOperation] = yield* Effect.promise(() =>
            client<{ status: string }[]>`
              select status from accounting.financial_operations
              where tenant_id = ${tenant!.id} and operation_id = ${failedInput.operationId}
            `
          )
          assert.strictEqual(failedOperation!.status, "submitted")
          const accounting = yield* Effect.provide(
            makeAccountingService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(SalesService, sales),
            ),
          )
          const closeFailure = yield* Effect.flip(accounting.closePeriod({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            periodId: intent.periodId,
          }))
          assert.instanceOf(closeFailure, FinancialOperationsPending)
          failReceipt = false
          const recovered = yield* failingService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: failedInput.operationId,
          })
          assert.strictEqual(recovered.status, "reconciled")

          const lostInput = {
            ...input,
            operationId: "lost-operation",
            reference: `lost-${crypto.randomUUID()}`,
          }
          yield* lostService.createJournalIntent(lostInput)
          const unknown = yield* lostService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: lostInput.operationId,
          })
          assert.strictEqual(unknown.status, "unknown")
          const [reconcileJob] = yield* Effect.promise(() =>
            client<{ job_type: string }[]>`
              select job_type from process.jobs
              where tenant_id = ${tenant!.id}
                and idempotency_key = ${`${lostInput.operationId}:reconcile`}
            `
          )
          assert.strictEqual(reconcileJob!.job_type, "accounting.financial_operation.reconcile")
          const reconciled = yield* lostService.reconcileFinancialOperation({
            tenantId: tenant!.id,
            operationId: lostInput.operationId,
          })
          assert.strictEqual(reconciled.status, "reconciled")

          const replay = yield* service.createJournalIntent(input)
          assert.strictEqual(replay.id, intent.id)
          const [{ count }] = yield* Effect.promise(() =>
            client<{ count: string }[]>`
              select count(*)::text as count from process.jobs
              where tenant_id = ${tenant!.id} and idempotency_key = ${input.operationId}
            `
          )
          assert.strictEqual(count, "1")

          const [projection] = yield* Effect.promise(() =>
            client<{ status: string }[]>`
              select status from accounting.journal_entries where id = ${posted.journalId}
            `
          )
          assert.strictEqual(projection!.status, "posted")

          const reversalIntent = yield* service.createReversalIntent({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            sourceJournalId: posted.journalId,
            operationId: `reversal-${crypto.randomUUID()}`,
            reference: `reversal-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
            correlationId: `reversal-correlation-${crypto.randomUUID()}`,
          })
          assert.strictEqual(reversalIntent.operationType, "journal_reverse")
          const reversed = yield* service.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: reversalIntent.operationId,
          })
          assert.strictEqual(reversed.status, "reconciled")
          const [reversalProjection] = yield* Effect.promise(() =>
            client<{ status: string; reverses_entry_id: string | null }[]>`
              select status, reverses_entry_id
              from accounting.journal_entries where id = ${reversed.journalId}
            `
          )
          assert.deepStrictEqual(reversalProjection, {
            status: "reversed",
            reverses_entry_id: posted.journalId,
          })
        }),
    ),
)
