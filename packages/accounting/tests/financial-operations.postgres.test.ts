import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  AccountingCapabilities,
  AccountingFinancialOperationReconciledEvent,
  FinancialLedgerPort,
  type FinancialOperationFailpointNameType,
  FinancialOperationInjectedFailure,
  FinancialOperationsPending,
  FinancialReversalAlreadyExists,
  makeAccountingService,
  makeFinancialLedgerTestLayer,
  makeFinancialOperationFailpointLayer,
  makeFinancialOperationService,
} from "../mod.ts"
import { makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  Database,
  DatabaseFailure,
  type DatabaseService,
  DurableJobEnqueuer,
  makePostgresDatabase,
  runMigrations,
} from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import { makeProcessJobEnqueuer } from "../../process/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import { LARGE_FINANCIAL_MAJOR } from "../../../tests/support/financial-ledger-conformance.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

const failDatabaseOnceAt = (database: DatabaseService, operationName: string): DatabaseService => {
  let failed = false
  const shouldFail = (name: string | undefined) => !failed && name === operationName
  const failure = (name: string | undefined) => {
    failed = true
    return Effect.fail(new DatabaseFailure({ operation: name ?? operationName, cause: "injected" }))
  }
  return {
    query: (operation, name) => shouldFail(name) ? failure(name) : database.query(operation, name),
    transaction: (operation, name) =>
      shouldFail(name) ? failure(name) : database.transaction(operation, name),
    withTransaction: (operation, name) =>
      shouldFail(name) ? failure(name) : database.withTransaction(operation, name),
  } as DatabaseService
}

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
                 fiscal_year_start_month, posting_enabled, financial_engine)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true, 'tigerbeetle')
            `
          )
          yield* Effect.promise(() =>
            client`
              update accounting.financial_cutover_controls
              set status = 'preparing_tigerbeetle'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          const [evidenceArtifact] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.financial_verification_artifacts (
                tenant_id, legal_entity_id, kind, status, completeness, scope,
                schema_version, mapping_version, currency, source_watermark, target_watermark,
                source_snapshot_ref, target_snapshot_ref, artifact_hash, signature_algorithm,
                signing_key_id, signature, operation_set_hash, account_balance_hash,
                transfer_set_hash, source_debit_minor, source_credit_minor, target_debit_minor,
                target_credit_minor, account_count, operation_count, transfer_count,
                mismatch_count, producer_principal_id, started_at, completed_at
              ) values (
                ${tenant!.id}, ${
              legalEntity!.id
            }, 'cutover_rehearsal', 'verified', 'bounded', 'test',
                1, 1, 'USD', 'test-watermark', 'test-watermark', 'test-source', 'test-target',
                repeat('0', 64), 'Ed25519', 'test-key', 'test-signature', repeat('0', 64),
                repeat('1', 64), repeat('2', 64), '0', '0', '0', '0', 0, 0, 0, 0,
                'test-operator', now(), now()
              ) returning id
            `
          )
          yield* Effect.promise(() =>
            client`
              update accounting.financial_cutover_controls
              set status = 'approved', cutover_watermark = 'test-watermark',
                verification_hash = 'test-hash', opening_balance_verified = true,
                historical_boundary_verified = true, reconciliation_healthy = true,
                backup_recovery_verified = true, evidence_artifact_id = ${evidenceArtifact!.id},
                approved_by = 'test-operator', approved_at = now()
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          yield* Effect.promise(() =>
            client`
              update accounting.financial_cutover_controls
              set status = 'activating'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          yield* Effect.promise(() =>
            client`
              update accounting.legal_entity_accounting_configurations
              set financial_engine = 'tigerbeetle'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          yield* Effect.promise(() =>
            client`
              update accounting.financial_cutover_controls
              set status = 'tigerbeetle', activated_by = 'test-operator', activated_at = now()
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
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
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialProjectionRebuild,
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialReconciliationCheckpoint,
          }])
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const jobs = yield* makeProcessJobEnqueuer.pipe(
            Effect.provideService(Database, database),
          )
          const ledger = yield* Effect.provide(
            Effect.service(FinancialLedgerPort),
            makeFinancialLedgerTestLayer(),
          )
          const sales = {
            getConfirmedOrderTotal: () => Effect.succeed(LARGE_FINANCIAL_MAJOR),
          } as unknown as SalesService
          const service = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              Layer.succeed(FinancialLedgerPort, ledger),
            ),
          )

          const revenueMismatch = yield* Effect.flip(service.createRevenueIntent({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            orderId: crypto.randomUUID(),
            commandId: `revenue-mismatch-${crypto.randomUUID()}`,
            correlationId: `revenue-mismatch-correlation-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
            amount: "6.50",
          }))
          assert.strictEqual(revenueMismatch._tag, "FinancialRevenueAmountMismatch")

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
          const [reconciledEvent] = yield* Effect.promise(() =>
            client<{
              operation_id: string
              journal_id: string
              mapping_version: number
              reconciled_event_id: string
              event_id: string
              aggregate_id: string
              payload: unknown
              command_id: string
              correlation_id: string
              causation_id: string
              idempotency_key: string
            }[]>`
              select f.operation_id, f.journal_id, f.mapping_version,
                f.reconciled_event_id, e.id as event_id, e.aggregate_id, e.payload,
                e.command_id, e.correlation_id, e.causation_id, e.idempotency_key
              from messaging.event_outbox e
              join accounting.financial_operations f
                on f.tenant_id = e.tenant_id and f.reconciled_event_id = e.id
              where e.tenant_id = ${tenant!.id} and f.id = ${revenue.id}
            `
          )
          assert.isDefined(reconciledEvent)
          const eventPayload = yield* Schema.decodeUnknownEffect(
            AccountingFinancialOperationReconciledEvent.payloadSchema,
          )(reconciledEvent!.payload)
          assert.strictEqual(eventPayload.operationId, reconciledEvent!.operation_id)
          assert.strictEqual(eventPayload.journalId, reconciledEvent!.journal_id)
          assert.strictEqual(eventPayload.mappingVersion, reconciledEvent!.mapping_version)
          assert.strictEqual(reconciledEvent!.event_id, reconciledEvent!.reconciled_event_id)
          assert.notStrictEqual(reconciledEvent!.event_id, revenue.id)
          assert.strictEqual(reconciledEvent!.aggregate_id, revenue.id)
          assert.notStrictEqual(reconciledEvent!.event_id, reconciledEvent!.aggregate_id)
          assert.notStrictEqual(reconciledEvent?.command_id, reconciledEvent?.correlation_id)
          assert.notStrictEqual(reconciledEvent?.command_id, reconciledEvent?.causation_id)
          assert.notStrictEqual(reconciledEvent?.command_id, reconciledEvent?.idempotency_key)
          assert.notStrictEqual(reconciledEvent?.correlation_id, reconciledEvent?.causation_id)
          assert.notStrictEqual(reconciledEvent?.correlation_id, reconciledEvent?.idempotency_key)
          assert.notStrictEqual(reconciledEvent?.causation_id, reconciledEvent?.idempotency_key)

          yield* Effect.promise(() =>
            client`
              delete from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.id}
            `
          )
          const reconciledEventId = reconciledEvent!.event_id
          yield* Effect.promise(() =>
            client`
              delete from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `
          )
          const rebuiltProjection = yield* service.rebuildFinancialProjections({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.isAtLeast(rebuiltProjection.checkedOperations, 1)
          assert.isAtLeast(rebuiltProjection.rebuiltOperations, 1)
          const rebuiltRevenueTransfers = yield* Effect.promise(() =>
            client<{ status: string; engine_transfer_id: string | null }[]>`
              select status, engine_transfer_id
              from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.id}
            `
          )
          assert.strictEqual(rebuiltRevenueTransfers.length, 1)
          assert.strictEqual(rebuiltRevenueTransfers[0]!.status, "accepted")
          assert.isNotNull(rebuiltRevenueTransfers[0]!.engine_transfer_id)
          const [rebuiltReconciledEvent] = yield* Effect.promise(() =>
            client<{ id: string; aggregate_id: string }[]>`
              select id, aggregate_id
              from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `
          )
          assert.isDefined(rebuiltReconciledEvent)
          assert.strictEqual(rebuiltReconciledEvent!.id, reconciledEventId)
          assert.strictEqual(rebuiltReconciledEvent!.aggregate_id, revenue.id)

          yield* Effect.promise(() =>
            client`
              update messaging.event_outbox
              set payload = jsonb_set(payload, '{mappingVersion}', '2'::jsonb)
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `
          )
          const quarantinedProjection = yield* service.rebuildFinancialProjections({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.strictEqual(quarantinedProjection.rebuiltOperations, 0)
          assert.strictEqual(quarantinedProjection.quarantinedOperations, 1)
          const [quarantinedOperation] = yield* Effect.promise(() =>
            client<
              { status: string; recovery_reason: string | null; reconciled_at: Date | null }[]
            >`
              select status, recovery_reason, reconciled_at
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${revenue.id}
            `
          )
          assert.strictEqual(quarantinedOperation!.status, "manual_recovery")
          assert.strictEqual(quarantinedOperation!.recovery_reason, "mapping_mismatch")
          assert.isNull(quarantinedOperation!.reconciled_at)
          const [corruptReconciledEvent] = yield* Effect.promise(() =>
            client<{ id: string; payload: unknown }[]>`
              select id, payload
              from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `
          )
          assert.strictEqual(corruptReconciledEvent!.id, reconciledEventId)
          const corruptPayload = yield* Schema.decodeUnknownEffect(
            AccountingFinancialOperationReconciledEvent.payloadSchema,
          )(corruptReconciledEvent!.payload)
          assert.strictEqual(corruptPayload.mappingVersion, 2)

          const corruptMappingVersionOperationId = `mapping-version-${crypto.randomUUID()}`
          const mappingMismatchIntent = yield* service.createJournalIntent({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            operationId: corruptMappingVersionOperationId,
            reference: `mapping-version-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
            lines: [
              { accountId: debitAccount!.id, debit: "12.50", credit: "0" },
              { accountId: creditAccount!.id, debit: "0", credit: "12.50" },
            ],
            correlationId: `mapping-version-correlation-${crypto.randomUUID()}`,
          })
          const mappingMismatchPosted = yield* service.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: mappingMismatchIntent.operationId,
          })
          assert.strictEqual(mappingMismatchPosted.status, "reconciled")
          const mappingMismatchLedger = {
            ...ledger,
            reconcileJournal: (input: unknown) =>
              ledger.reconcileJournal(input).pipe(
                Effect.map((outcome) =>
                  outcome._tag === "accepted" &&
                    outcome.operationId === corruptMappingVersionOperationId
                    ? { ...outcome, mappingVersion: outcome.mappingVersion + 1 }
                    : outcome
                ),
              ),
          }
          const mappingMismatchService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              Layer.succeed(FinancialLedgerPort, mappingMismatchLedger),
            ),
          )
          const mappingMismatchProjection = yield* mappingMismatchService
            .rebuildFinancialProjections({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
            })
          assert.isAtLeast(mappingMismatchProjection.rebuiltOperations, 0)
          assert.strictEqual(mappingMismatchProjection.quarantinedOperations, 1)
          const [mappingMismatchOperation] = yield* Effect.promise(() =>
            client<{ status: string; recovery_reason: string | null }[]>`
              select status, recovery_reason
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and operation_id = ${corruptMappingVersionOperationId}
            `
          )
          assert.strictEqual(mappingMismatchOperation!.status, "manual_recovery")
          assert.strictEqual(mappingMismatchOperation!.recovery_reason, "mapping_mismatch")
          const [mappingMismatchEvents] = yield* Effect.promise(() =>
            client<{ events: number }[]>`
              select count(*)::integer as events
              from messaging.event_outbox
              where tenant_id = ${tenant!.id}
                and event_type = ${AccountingFinancialOperationReconciledEvent.id}
                and payload ->> 'operationId' = ${corruptMappingVersionOperationId}
            `
          )
          assert.strictEqual(mappingMismatchEvents!.events, 1)

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
              Layer.succeed(FinancialLedgerPort, ledger),
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
          const concurrentInput = {
            ...input,
            operationId: `concurrent-${crypto.randomUUID()}`,
            reference: `concurrent-${crypto.randomUUID()}`,
          }
          const concurrentIntents = yield* Effect.all([
            service.createJournalIntent(concurrentInput),
            service.createJournalIntent(concurrentInput),
          ], { concurrency: "unbounded" })
          assert.strictEqual(concurrentIntents[0]!.id, concurrentIntents[1]!.id)
          const concurrentPosted = yield* service.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: concurrentInput.operationId,
          })
          assert.strictEqual(concurrentPosted.status, "reconciled")

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
          const projectedTransfers = yield* Effect.promise(() =>
            client<{ position: number; engine_transfer_id: string | null; status: string }[]>`
              select position, engine_transfer_id, status
              from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id}
                and operation_id = ${posted.id}
              order by position
            `
          )
          assert.strictEqual(projectedTransfers.length, 1)
          assert.isNotNull(projectedTransfers[0]!.engine_transfer_id)
          assert.strictEqual(projectedTransfers[0]!.status, "accepted")

          const immutableOperation = yield* postgresFailure(() =>
            client`
              update accounting.financial_operations
              set mapping_version = 2
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `
          )
          assert.strictEqual(
            (immutableOperation as { constraint_name?: string }).constraint_name,
            "financial_operations_immutable_fields_check",
          )
          const immutableReconciledEventId = yield* postgresFailure(() =>
            client`
              update accounting.financial_operations
              set reconciled_event_id = ${crypto.randomUUID()}
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `
          )
          assert.strictEqual(
            (immutableReconciledEventId as { constraint_name?: string }).constraint_name,
            "financial_operations_immutable_fields_check",
          )
          const [postedEventIdentity] = yield* Effect.promise(() =>
            client<{ reconciled_event_id: string }[]>`
              select reconciled_event_id
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `
          )
          const [duplicateJournal] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference, status)
              values (${tenant!.id}, ${`duplicate-event-${crypto.randomUUID()}`}, 'draft')
              returning id
            `
          )
          const duplicateReconciledEvent = yield* postgresFailure(() =>
            client`
              insert into accounting.financial_operations (
                tenant_id, legal_entity_id, period_id, operation_id, operation_type,
                journal_id, source_journal_id, reference, currency, mapping_version,
                engine, engine_verified, request_fingerprint, actor_principal_id,
                actor_session_id, status, attempts, scheduled_at, submitted_at,
                engine_accepted_at, rejection_reason, recovery_reason, observed_engine,
                last_error, reconciled_at, reconciled_event_id
              )
              select tenant_id, legal_entity_id, period_id, ${`duplicate-${crypto.randomUUID()}`},
                operation_type, ${duplicateJournal!.id}, source_journal_id,
                ${`duplicate-reference-${crypto.randomUUID()}`}, currency, mapping_version,
                engine, engine_verified, request_fingerprint, actor_principal_id,
                actor_session_id, status, attempts, scheduled_at, submitted_at,
                engine_accepted_at, rejection_reason, recovery_reason, observed_engine,
                last_error, reconciled_at, ${postedEventIdentity!.reconciled_event_id}
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `
          )
          assert.strictEqual(
            (duplicateReconciledEvent as { constraint_name?: string }).constraint_name,
            "financial_operations_tenant_reconciled_event_key",
          )
          const immutableTransfer = yield* postgresFailure(() =>
            client`
              update accounting.financial_operation_transfers
              set engine_transfer_id = 'different'
              where tenant_id = ${tenant!.id} and operation_id = ${posted.id}
            `
          )
          assert.strictEqual(
            (immutableTransfer as { constraint_name?: string }).constraint_name,
            "financial_operation_transfers_immutable_fields_check",
          )

          const corruptOperationId = `corrupt-${crypto.randomUUID()}`
          const corruptService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              makeFinancialLedgerTestLayer({ corruptTransferIdsFor: corruptOperationId }),
            ),
          )
          yield* corruptService.createJournalIntent({
            ...input,
            operationId: corruptOperationId,
            reference: `corrupt-${crypto.randomUUID()}`,
          })
          const corruptResult = yield* corruptService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: corruptOperationId,
          })
          assert.strictEqual(corruptResult.status, "manual_recovery")

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
            client<{
              status: string
              journal_status: string
              transfer_status: string
            }[]>`
              select operation.status, journal.status as journal_status,
                transfer.status as transfer_status
              from accounting.financial_operations operation
              join accounting.journal_entries journal
                on journal.tenant_id = operation.tenant_id and journal.id = operation.journal_id
              join accounting.financial_operation_transfers transfer
                on transfer.tenant_id = operation.tenant_id and transfer.operation_id = operation.id
              where operation.tenant_id = ${tenant!.id} and operation.operation_id =
                ${failedInput.operationId}
            `
          )
          assert.deepStrictEqual(failedOperation, {
            status: "accepted",
            journal_status: "draft",
            transfer_status: "unresolved",
          })
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
          const reconciledAgain = yield* lostService.reconcileFinancialOperation({
            tenantId: tenant!.id,
            operationId: lostInput.operationId,
          })
          assert.strictEqual(reconciledAgain.status, "reconciled")

          const checkpoint = yield* service.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: `checkpoint-${crypto.randomUUID()}`,
            sourceWatermark: "postgres:test-watermark",
            targetWatermark: "tigerbeetle:test-watermark",
            sourceSnapshotRef: "postgres:test-snapshot",
            targetSnapshotRef: "tigerbeetle:test-snapshot",
            evidenceArtifactId: null,
          })
          assert.include(["verified", "blocked"], checkpoint.status)
          const checkpointReplay = yield* service.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: checkpoint.recoveryWatermark,
            sourceWatermark: "postgres:test-watermark",
            targetWatermark: "tigerbeetle:test-watermark",
            sourceSnapshotRef: "postgres:test-snapshot",
            targetSnapshotRef: "tigerbeetle:test-snapshot",
            evidenceArtifactId: null,
          })
          assert.deepStrictEqual(checkpointReplay, checkpoint)
          const checkpointMutation = yield* postgresFailure(() =>
            client`
              update accounting.financial_reconciliation_checkpoints
              set status = 'verified'
              where tenant_id = ${tenant!.id} and id = ${checkpoint.id}
            `
          )
          assert.strictEqual(
            (checkpointMutation as { constraint_name?: string }).constraint_name,
            "financial_reconciliation_checkpoints_immutable",
          )

          const makeMatrixService = (
            databaseLayer: Layer.Layer<DatabaseService> = Layer.succeed(Database, database),
            ledgerLayer = makeFinancialLedgerTestLayer(),
            failpoint = undefined as FinancialOperationFailpointNameType | undefined,
          ) =>
            Effect.provide(
              makeFinancialOperationService,
              Layer.mergeAll(
                databaseLayer,
                authorization,
                Layer.succeed(MessagingService, messaging),
                Layer.succeed(DurableJobEnqueuer, jobs),
                Layer.succeed(SalesService, sales),
                ledgerLayer,
                makeFinancialOperationFailpointLayer(failpoint === undefined ? [] : [failpoint]),
              ),
            )
          const failureCases = [
            ["A_before_intent_commit", "before_intent_commit"],
            ["B_after_intent_before_submission", "after_intent_commit"],
            ["E_process_dies_after_acceptance_before_receipt", "after_provider_acceptance"],
            ["F_accepted_before_journal_projection", "before_projection_commit"],
            ["G_projected_before_outbox", "before_outbox_append"],
            ["H_partial_finalization", "before_receipt_commit"],
            ["H_after_receipt_commit", "after_receipt_commit"],
            ["H_after_finalization", "after_finalization"],
            ["B_before_provider_submission", "before_provider_submission"],
          ] as const
          for (const [point, failpoint] of failureCases) {
            const matrixInput = {
              ...input,
              operationId: `matrix-${point}-${crypto.randomUUID()}`,
              reference: `matrix-${point}-${crypto.randomUUID()}`,
            }
            const matrixService = yield* makeMatrixService(undefined, undefined, failpoint)
            if (
              point === "A_before_intent_commit" || point === "B_after_intent_before_submission"
            ) {
              const failed = yield* Effect.flip(matrixService.createJournalIntent(matrixInput))
              assert.instanceOf(failed, FinancialOperationInjectedFailure)
              assert.strictEqual(failed.point, failpoint)
              const intentAfterRestart = yield* matrixService.createJournalIntent(matrixInput)
              assert.strictEqual(intentAfterRestart.status, "intent")
            } else {
              const intentBeforeFailure = yield* matrixService.createJournalIntent(matrixInput)
              assert.strictEqual(intentBeforeFailure.status, "intent")
              const failed = yield* Effect.flip(matrixService.submitFinancialOperation({
                tenantId: tenant!.id,
                operationId: intentBeforeFailure.operationId,
              }))
              assert.instanceOf(failed, FinancialOperationInjectedFailure)
              assert.strictEqual(failed.point, failpoint)
            }
            const recovered = yield* matrixService.submitFinancialOperation({
              tenantId: tenant!.id,
              operationId: matrixInput.operationId,
            })
            assert.strictEqual(recovered.status, "reconciled")
          }

          const providerCases = [
            ["C_submission_outcome_unknown", "failBeforeSubmissionFor"],
            ["D_response_lost_after_acceptance", "loseResponseFor"],
            ["L_tigerbeetle_unavailable", "unavailableFor"],
          ] as const
          for (const [point, option] of providerCases) {
            const operationId = `matrix-${point}-${crypto.randomUUID()}`
            const providerLedger = makeFinancialLedgerTestLayer({ [option]: operationId })
            const providerService = yield* makeMatrixService(undefined, providerLedger)
            const providerInput = {
              ...input,
              operationId,
              reference: `matrix-${point}-${crypto.randomUUID()}`,
            }
            yield* providerService.createJournalIntent(providerInput)
            const unknownProviderOutcome = yield* providerService.submitFinancialOperation({
              tenantId: tenant!.id,
              operationId,
            })
            assert.strictEqual(unknownProviderOutcome.status, "unknown")
            const providerRecovery = yield* providerService.reconcileFinancialOperation({
              tenantId: tenant!.id,
              operationId,
            })
            assert.strictEqual(
              providerRecovery.status,
              point === "L_tigerbeetle_unavailable" ? "unknown" : "reconciled",
            )
          }

          const postgresUnavailableOperation = `matrix-M-${crypto.randomUUID()}`
          const postgresUnavailableService = yield* makeMatrixService(
            Layer.succeed(
              Database,
              failDatabaseOnceAt(database, "accounting.financial_operation.receipt"),
            ),
          )
          yield* postgresUnavailableService.createJournalIntent({
            ...input,
            operationId: postgresUnavailableOperation,
            reference: `matrix-M-${crypto.randomUUID()}`,
          })
          const postgresFailureResult = yield* Effect.flip(
            postgresUnavailableService.submitFinancialOperation({
              tenantId: tenant!.id,
              operationId: postgresUnavailableOperation,
            }),
          )
          assert.instanceOf(postgresFailureResult, DatabaseFailure)
          const postgresRecovered = yield* postgresUnavailableService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: postgresUnavailableOperation,
          })
          assert.strictEqual(postgresRecovered.status, "reconciled")

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
          const duplicateReversal = yield* Effect.flip(service.createReversalIntent({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            sourceJournalId: posted.journalId,
            operationId: `duplicate-reversal-${crypto.randomUUID()}`,
            reference: `duplicate-reversal-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
            correlationId: `duplicate-reversal-correlation-${crypto.randomUUID()}`,
          }))
          assert.instanceOf(duplicateReversal, FinancialReversalAlreadyExists)
        }),
    ),
)
