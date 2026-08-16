import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

import {
  AccountingCapabilities,
  AccountingService,
  makeAccountingService,
} from "../../accounting/mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  InventoryCapabilities,
  InventoryService,
  makeInventoryService,
} from "../../inventory/mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { EventEnvelope, makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { makePartyService, PartyCapabilities } from "../../party/mod.ts"
import {
  makeProcessService,
  OrderConfirmationCompletedEventPayload,
  OrderConfirmationPayload,
  OrderConfirmationResult,
  ProcessCapabilities,
  ProcessJob,
  ProcessLifecycleJobPriority,
  ProcessOrderConfirmationCompletedEvent,
  ProcessPostCommitJobPayload,
  ProcessPostCommitJobTypes,
  ProcessWorkflowTypes,
  WorkflowManualRecoveryRequired,
  WorkflowResultCorrupt,
  WorkflowRun,
} from "../mod.ts"
import { makeSalesService, SalesCapabilities, SalesService } from "../../sales/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)
const principal = { userAccountId: "order-confirmation", sessionId: "session" }

const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  SalesCapabilities.customerCreate,
  SalesCapabilities.orderCreate,
  SalesCapabilities.orderConfirm,
  InventoryCapabilities.warehouseCreate,
  InventoryCapabilities.itemCreate,
  InventoryCapabilities.stockReceive,
  InventoryCapabilities.stockReserve,
  AccountingCapabilities.legalEntityConfigure,
  AccountingCapabilities.accountCreate,
  AccountingCapabilities.revenueConfigure,
  AccountingCapabilities.periodOpen,
  AccountingCapabilities.revenuePost,
  ProcessCapabilities.orderConfirmationRecover,
  ProcessCapabilities.orderConfirmationManualRecovery,
] as const

const readCounts = (client: Sql, tenantId: string) =>
  client<{ workflow_runs: string; events: string; jobs: string }[]>`
    select
      (select count(*)::text from process.workflow_runs where tenant_id = ${tenantId}) as workflow_runs,
      (select count(*)::text from messaging.event_outbox where tenant_id = ${tenantId}) as events,
      (select count(*)::text from process.jobs where tenant_id = ${tenantId}) as jobs
  `

it.effect.skipIf(databaseUrl === undefined)(
  "rejects contradictory workflow state metadata in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const aggregateId = crypto.randomUUID()

        const unknownWorkflowType = yield* postgresFailure(() =>
          client`
            insert into process.workflow_runs
              (tenant_id, workflow_type, idempotency_key, aggregate_id, status, payload)
            values
              (${tenant!.id}, 'sales.order.unknown', 'invalid-workflow-type',
               ${aggregateId}, 'running', '{}'::jsonb)
          `
        )
        const emptyWorkflowIdempotency = yield* postgresFailure(() =>
          client`
            insert into process.workflow_runs
              (tenant_id, workflow_type, idempotency_key, aggregate_id, status, payload)
            values
              (${tenant!.id}, 'sales.order.confirmation', '   ', ${aggregateId}, 'running',
               '{}'::jsonb)
          `
        )
        const unknownJobType = yield* postgresFailure(() =>
          client`
            insert into process.jobs
              (tenant_id, job_type, idempotency_key, payload, correlation_id)
            values
              (${tenant!.id}, 'process.unknown.post_commit', 'invalid-job-type', '{}'::jsonb,
               'invalid-job-type')
          `
        )
        const emptyJobIdempotency = yield* postgresFailure(() =>
          client`
            insert into process.jobs
              (tenant_id, job_type, idempotency_key, payload, correlation_id)
            values
              (${tenant!.id}, 'process.order_confirmation.post_commit', '   ', '{}'::jsonb,
               'correlation')
          `
        )
        const emptyJobCorrelation = yield* postgresFailure(() =>
          client`
            insert into process.jobs
              (tenant_id, job_type, idempotency_key, payload, correlation_id)
            values
              (${tenant!.id}, 'process.order_confirmation.post_commit',
               'empty-job-correlation', '{}'::jsonb, '   ')
          `
        )
        const invalidJobLease = yield* postgresFailure(() =>
          client`
            insert into process.jobs
              (tenant_id, job_type, idempotency_key, status, lease_until, payload, correlation_id)
            values
              (${tenant!.id}, 'process.order_confirmation.post_commit', 'invalid-job-lease',
               'pending', now(), '{}'::jsonb, 'correlation')
          `
        )
        const invalidJobCompletion = yield* postgresFailure(() =>
          client`
            insert into process.jobs
              (tenant_id, job_type, idempotency_key, status, completed_at, payload, correlation_id)
            values
              (${tenant!.id}, 'process.order_confirmation.post_commit', 'invalid-job-completion',
               'pending', now(), '{}'::jsonb, 'correlation')
          `
        )
        const runningRecovery = yield* postgresFailure(() =>
          client`
            insert into process.workflow_runs
              (tenant_id, workflow_type, idempotency_key, aggregate_id, status, payload,
               recovery_reason)
            values
              (${tenant!.id}, 'sales.order.confirmation', 'invalid-running-recovery',
               ${aggregateId}, 'running', '{}'::jsonb, 'unexpected')
          `
        )
        const succeededRecovery = yield* postgresFailure(() =>
          client`
            insert into process.workflow_runs
              (tenant_id, workflow_type, idempotency_key, aggregate_id, status, payload,
               result, recovery_reason, completed_at)
            values
              (${tenant!.id}, 'sales.order.confirmation', 'invalid-succeeded-recovery',
               ${aggregateId}, 'succeeded', '{}'::jsonb, '{}'::jsonb, 'unexpected', now())
          `
        )
        const completedRecovery = yield* postgresFailure(() =>
          client`
            insert into process.workflow_runs
              (tenant_id, workflow_type, idempotency_key, aggregate_id, status, payload,
               recovery_reason, completed_at)
            values
              (${tenant!.id}, 'sales.order.confirmation', 'invalid-completed-recovery',
               ${aggregateId}, 'manual_recovery', '{}'::jsonb,
               'operator review required', now())
          `
        )

        assert.strictEqual((unknownWorkflowType as { code?: string }).code, "23514")
        assert.strictEqual(
          (unknownWorkflowType as { constraint_name?: string }).constraint_name,
          "workflow_runs_type_check",
        )
        assert.strictEqual((emptyWorkflowIdempotency as { code?: string }).code, "23514")
        assert.strictEqual(
          (emptyWorkflowIdempotency as { constraint_name?: string }).constraint_name,
          "workflow_runs_idempotency_key_check",
        )
        assert.strictEqual((unknownJobType as { code?: string }).code, "23514")
        assert.strictEqual(
          (unknownJobType as { constraint_name?: string }).constraint_name,
          "process_jobs_type_check",
        )
        assert.strictEqual((emptyJobIdempotency as { code?: string }).code, "23514")
        assert.strictEqual(
          (emptyJobIdempotency as { constraint_name?: string }).constraint_name,
          "process_jobs_idempotency_key_check",
        )
        assert.strictEqual((emptyJobCorrelation as { code?: string }).code, "23514")
        assert.strictEqual(
          (emptyJobCorrelation as { constraint_name?: string }).constraint_name,
          "process_jobs_correlation_id_check",
        )
        assert.strictEqual((invalidJobLease as { code?: string }).code, "23514")
        assert.strictEqual(
          (invalidJobLease as { constraint_name?: string }).constraint_name,
          "process_jobs_lease_state_check",
        )
        assert.strictEqual((invalidJobCompletion as { code?: string }).code, "23514")
        assert.strictEqual(
          (invalidJobCompletion as { constraint_name?: string }).constraint_name,
          "process_jobs_state_check",
        )
        for (const failure of [runningRecovery, succeededRecovery, completedRecovery]) {
          assert.strictEqual((failure as { code?: string }).code, "23514")
          assert.strictEqual(
            (failure as { constraint_name?: string }).constraint_name,
            "workflow_runs_state_check",
          )
        }
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "commits order confirmation, event, job, and idempotent retries atomically",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability,
          })),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.merge(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const sales = yield* Effect.provide(
            makeSalesService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const inventory = yield* Effect.provide(
            makeInventoryService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const accounting = yield* Effect.provide(
            makeAccountingService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const process = yield* Effect.provide(
            makeProcessService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(SalesService, sales),
              Layer.succeed(InventoryService, inventory),
              Layer.succeed(AccountingService, accounting),
              Layer.succeed(MessagingService, messaging),
            ),
          )

          const organization = yield* party.create({
            principal,
            tenantId: tenant!.id,
            kind: "organization",
            name: "Order Confirmation Organization",
          })
          const legalEntity = yield* party.createLegalEntity({
            principal,
            tenantId: tenant!.id,
            organizationId: organization.id,
          })
          const warehouse = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            name: "Main Warehouse",
          })
          const widget = yield* inventory.createItem({
            principal,
            tenantId: tenant!.id,
            sku: "ORDER-WIDGET",
            name: "Order Widget",
          })
          const cable = yield* inventory.createItem({
            principal,
            tenantId: tenant!.id,
            sku: "ORDER-CABLE",
            name: "Order Cable",
          })
          yield* Effect.forEach([widget, cable], (item) =>
            inventory.receiveStock({
              principal,
              tenantId: tenant!.id,
              warehouseId: warehouse.id,
              itemId: item.id,
              quantity: "10",
            }))
          const receivable = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "1000",
            name: "Accounts Receivable",
            type: "asset",
          })
          const revenue = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "4000",
            name: "Revenue",
            type: "revenue",
          })
          yield* accounting.configureLegalEntity({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            baseCurrency: "USD",
            precision: 2,
            fiscalYearStartMonth: 1,
            postingEnabled: true,
          })
          yield* accounting.configureRevenuePosting({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            receivableAccountId: receivable.id,
            revenueAccountId: revenue.id,
          })
          yield* accounting.openPeriod({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            startsOn: "1900-01-01",
            endsOn: "2099-12-31",
          })
          const customer = yield* sales.createCustomer({
            principal,
            tenantId: tenant!.id,
            name: "Order Customer",
            email: "order-confirmation@example.test",
          })
          const order = yield* sales.createOrder({
            principal,
            tenantId: tenant!.id,
            customerId: customer.id,
            lines: [
              { itemId: widget.id, quantity: "2", unitPrice: "50.00" },
              { itemId: cable.id, quantity: "1", unitPrice: "25.00" },
            ],
          })
          const input = {
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            warehouseId: warehouse.id,
            legalEntityId: legalEntity.id,
            commandId: "command-order-confirmation-1",
            correlationId: "correlation-order-confirmation-1",
            causationId: "causation-order-confirmation-1",
            idempotencyKey: "order-confirmation-1",
          }

          const result = yield* process.confirmOrder(input)
          const repeated = yield* process.confirmOrder(input)
          const [storedWorkflow] = yield* Effect.promise(() =>
            client<Record<string, unknown>[]>`
              select
                id, tenant_id as "tenantId", workflow_type as "workflowType",
                idempotency_key as "idempotencyKey", aggregate_id as "aggregateId", status,
                payload, result,
                recovery_reason as "recoveryReason", to_json(completed_at) as "completedAt"
              from process.workflow_runs
              where id = ${result.workflowRunId}
            `
          )
          const decodedWorkflow = yield* Schema.decodeUnknownEffect(WorkflowRun)(storedWorkflow)
          assert.strictEqual(decodedWorkflow.id, result.workflowRunId)
          assert.strictEqual(decodedWorkflow.workflowType, ProcessWorkflowTypes.confirmation)
          assert.deepStrictEqual(
            yield* Schema.decodeUnknownEffect(OrderConfirmationPayload)(storedWorkflow?.payload),
            {
              orderId: input.orderId,
              warehouseId: input.warehouseId,
              legalEntityId: input.legalEntityId,
              commandId: input.commandId,
              correlationId: input.correlationId,
              causationId: input.causationId,
              idempotencyKey: input.idempotencyKey,
            },
          )
          assert.deepStrictEqual(
            yield* Schema.decodeUnknownEffect(OrderConfirmationResult)(storedWorkflow?.result),
            result,
          )
          const counts = (yield* Effect.promise(() => readCounts(client, tenant!.id)))[0]!
          assert.strictEqual(result.workflowRunId, repeated.workflowRunId)
          assert.deepStrictEqual(
            result.reservations.map(({ id }) => id),
            repeated.reservations.map(({ id }) => id),
          )
          assert.strictEqual(result.reservations.length, 2)
          assert.strictEqual(result.journal.id, repeated.journal.id)
          assert.strictEqual(result.order.status, "confirmed")
          assert.strictEqual(result.order.total, "125.00")
          assert.strictEqual(result.journal.lines[0]?.debit, "125.00")
          assert.strictEqual(counts.workflow_runs, "1")
          assert.strictEqual(counts.events, "3")
          assert.strictEqual(counts.jobs, "1")
          const [event] = yield* Effect.promise(() =>
            client<{
              command_id: string
              correlation_id: string
              causation_id: string | null
              idempotency_key: string
              payload: unknown
            }[]>`
              select command_id, correlation_id, causation_id, idempotency_key, payload
              from messaging.event_outbox
              where id = ${result.eventId}
            `
          )
          const eventPayload = yield* Schema.decodeUnknownEffect(
            OrderConfirmationCompletedEventPayload,
          )(event?.payload)
          const [storedEvent] = yield* Effect.promise(() =>
            client<Record<string, unknown>[]>`
              select
                id as "eventId", event_type as "eventType", event_version as "eventVersion",
                tenant_id as "tenantId", aggregate_type as "aggregateType",
                aggregate_id as "aggregateId", command_id as "commandId",
                correlation_id as "correlationId", causation_id as "causationId",
                idempotency_key as "idempotencyKey", actor_principal_id as "actorPrincipalId",
                to_json(occurred_at) as "occurredAt", payload,
                to_json(published_at) as "publishedAt", attempts
              from messaging.event_outbox
              where id = ${result.eventId}
            `
          )
          const decodedEvent = yield* Schema.decodeUnknownEffect(EventEnvelope)(storedEvent)
          assert.strictEqual(decodedEvent.eventType, ProcessOrderConfirmationCompletedEvent.id)
          assert.strictEqual(
            decodedEvent.eventVersion,
            ProcessOrderConfirmationCompletedEvent.version,
          )
          assert.deepStrictEqual(
            {
              eventId: decodedEvent.eventId,
              tenantId: decodedEvent.tenantId,
              aggregateType: decodedEvent.aggregateType,
              aggregateId: decodedEvent.aggregateId,
              commandId: decodedEvent.commandId,
              correlationId: decodedEvent.correlationId,
              causationId: decodedEvent.causationId,
              idempotencyKey: decodedEvent.idempotencyKey,
              actorPrincipalId: decodedEvent.actorPrincipalId,
              publishedAt: decodedEvent.publishedAt,
              attempts: decodedEvent.attempts,
            },
            {
              eventId: result.eventId,
              tenantId: input.tenantId,
              aggregateType: ProcessOrderConfirmationCompletedEvent.aggregateType,
              aggregateId: input.orderId,
              commandId: input.commandId,
              correlationId: input.correlationId,
              causationId: input.causationId,
              idempotencyKey: input.idempotencyKey,
              actorPrincipalId: input.principal.userAccountId,
              publishedAt: null,
              attempts: 0,
            },
          )
          assert.deepStrictEqual(
            eventPayload.reservationIds,
            result.reservations.map(({ id }) => id),
          )
          assert.strictEqual(eventPayload.journalId, result.journal.id)
          assert.deepStrictEqual(
            [
              event?.command_id,
              event?.correlation_id,
              event?.causation_id,
              event?.idempotency_key,
            ],
            [
              input.commandId,
              input.correlationId,
              input.causationId,
              input.idempotencyKey,
            ],
          )
          assert.strictEqual(
            new Set([
              event?.command_id,
              event?.correlation_id,
              event?.causation_id,
              event?.idempotency_key,
            ]).size,
            4,
          )
          const [job] = yield* Effect.promise(() =>
            client<{
              correlation_id: string
              idempotency_key: string
              payload: {
                eventId: string
                workflowRunId: string
                commandId: string
                correlationId: string
                causationId: string | null
                idempotencyKey: string
              }
            }[]>`
              select correlation_id, idempotency_key, payload
              from process.jobs
              where id = ${result.jobId}
            `
          )
          yield* Schema.decodeUnknownEffect(ProcessPostCommitJobPayload)(job?.payload)
          const [storedJob] = yield* Effect.promise(() =>
            client<Record<string, unknown>[]>`
              select
                id as "jobId", tenant_id as "tenantId", job_type as "jobType",
                idempotency_key as "idempotencyKey", priority, status,
                to_json(scheduled_at) as "scheduledAt", to_json(lease_until) as "leaseUntil",
                attempts, payload, correlation_id as "correlationId"
              from process.jobs
              where id = ${result.jobId}
            `
          )
          const decodedJob = yield* Schema.decodeUnknownEffect(ProcessJob)(storedJob)
          assert.deepStrictEqual(
            {
              jobId: decodedJob.jobId,
              tenantId: decodedJob.tenantId,
              jobType: decodedJob.jobType,
              idempotencyKey: decodedJob.idempotencyKey,
              priority: decodedJob.priority,
              status: decodedJob.status,
              leaseUntil: decodedJob.leaseUntil,
              attempts: decodedJob.attempts,
              correlationId: decodedJob.correlationId,
            },
            {
              jobId: result.jobId,
              tenantId: input.tenantId,
              jobType: ProcessPostCommitJobTypes.confirmation,
              idempotencyKey: input.idempotencyKey,
              priority: ProcessLifecycleJobPriority,
              status: "pending",
              leaseUntil: null,
              attempts: 0,
              correlationId: input.correlationId,
            },
          )
          assert.deepStrictEqual(job, {
            correlation_id: input.correlationId,
            idempotency_key: input.idempotencyKey,
            payload: {
              eventId: result.eventId,
              workflowRunId: result.workflowRunId,
              commandId: input.commandId,
              correlationId: input.correlationId,
              causationId: input.causationId,
              idempotencyKey: input.idempotencyKey,
            },
          })

          const balances = yield* Effect.promise(() =>
            client<{ item_id: string; on_hand: string; reserved: string }[]>`
              select item_id, on_hand::text, reserved::text
              from inventory.stock_balances
              where tenant_id = ${tenant!.id}
                and warehouse_id = ${warehouse.id}
              order by item_id
            `
          )
          assert.deepStrictEqual(
            balances,
            [
              { item_id: widget.id, on_hand: "10", reserved: "2" },
              { item_id: cable.id, on_hand: "10", reserved: "1" },
            ].toSorted((a, b) => a.item_id.localeCompare(b.item_id)),
          )
          const detachedOrderResult = {
            ...result,
            order: { ...result.order, id: crypto.randomUUID() },
          }
          yield* Effect.promise(() =>
            client`
              update process.workflow_runs
              set result = ${JSON.stringify(detachedOrderResult)}::jsonb
              where id = ${result.workflowRunId}
            `
          )
          assert.instanceOf(yield* Effect.flip(process.confirmOrder(input)), WorkflowResultCorrupt)
          const crossLinkedResult = { ...result, workflowRunId: crypto.randomUUID() }
          yield* Effect.promise(() =>
            client`
              update process.workflow_runs
              set result = ${JSON.stringify(crossLinkedResult)}::jsonb
              where id = ${result.workflowRunId}
            `
          )
          assert.instanceOf(yield* Effect.flip(process.confirmOrder(input)), WorkflowResultCorrupt)
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rolls back order, reservation, journal, event, and job on stock failure",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability,
          })),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.merge(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const sales = yield* Effect.provide(
            makeSalesService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const inventory = yield* Effect.provide(
            makeInventoryService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const accounting = yield* Effect.provide(
            makeAccountingService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const process = yield* Effect.provide(
            makeProcessService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(SalesService, sales),
              Layer.succeed(InventoryService, inventory),
              Layer.succeed(AccountingService, accounting),
              Layer.succeed(MessagingService, messaging),
            ),
          )
          const organization = yield* party.create({
            principal,
            tenantId: tenant!.id,
            kind: "organization",
            name: "Rollback Organization",
          })
          const legalEntity = yield* party.createLegalEntity({
            principal,
            tenantId: tenant!.id,
            organizationId: organization.id,
          })
          const warehouse = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            name: "Rollback Warehouse",
          })
          const item = yield* inventory.createItem({
            principal,
            tenantId: tenant!.id,
            sku: "ROLLBACK-WIDGET",
            name: "Rollback Widget",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant!.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "1",
          })
          const customer = yield* sales.createCustomer({
            principal,
            tenantId: tenant!.id,
            name: "Rollback Customer",
            email: "rollback@example.test",
          })
          const order = yield* sales.createOrder({
            principal,
            tenantId: tenant!.id,
            customerId: customer.id,
            lines: [{ itemId: item.id, quantity: "2", unitPrice: "100.00" }],
          })
          const error = yield* Effect.flip(process.confirmOrder({
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            warehouseId: warehouse.id,
            legalEntityId: legalEntity.id,
            commandId: "command-rollback-confirmation-1",
            correlationId: "correlation-rollback-confirmation-1",
            idempotencyKey: "rollback-confirmation-1",
          }))
          assert.strictEqual(error._tag, "StockUnavailable")
          const [storedOrder] = yield* Effect.promise(() =>
            client<{ status: string }[]>`
              select status from sales.orders where id = ${order.id}
            `
          )
          assert.strictEqual(storedOrder?.status, "draft")
          const counts = (yield* Effect.promise(() => readCounts(client, tenant!.id)))[0]!
          assert.deepStrictEqual(counts, { workflow_runs: "0", events: "0", jobs: "0" })
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "supports concurrent retries and explicit manual recovery state",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability,
          })),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.merge(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const sales = yield* Effect.provide(
            makeSalesService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const inventory = yield* Effect.provide(
            makeInventoryService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const accounting = yield* Effect.provide(
            makeAccountingService,
            Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
          )
          const process = yield* Effect.provide(
            makeProcessService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(SalesService, sales),
              Layer.succeed(InventoryService, inventory),
              Layer.succeed(AccountingService, accounting),
              Layer.succeed(MessagingService, messaging),
            ),
          )
          const organization = yield* party.create({
            principal,
            tenantId: tenant!.id,
            kind: "organization",
            name: "Concurrency Organization",
          })
          const legalEntity = yield* party.createLegalEntity({
            principal,
            tenantId: tenant!.id,
            organizationId: organization.id,
          })
          const warehouse = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            name: "Concurrency Warehouse",
          })
          const item = yield* inventory.createItem({
            principal,
            tenantId: tenant!.id,
            sku: "CONCURRENCY-WIDGET",
            name: "Concurrency Widget",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant!.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "5",
          })
          const receivable = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "1002",
            name: "Concurrency Receivable",
            type: "asset",
          })
          const revenue = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "4002",
            name: "Concurrency Revenue",
            type: "revenue",
          })
          yield* accounting.configureLegalEntity({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            baseCurrency: "USD",
            precision: 2,
            fiscalYearStartMonth: 1,
            postingEnabled: true,
          })
          yield* accounting.configureRevenuePosting({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            receivableAccountId: receivable.id,
            revenueAccountId: revenue.id,
          })
          yield* accounting.openPeriod({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity.id,
            startsOn: "1900-01-01",
            endsOn: "2099-12-31",
          })
          const customer = yield* sales.createCustomer({
            principal,
            tenantId: tenant!.id,
            name: "Concurrency Customer",
            email: "concurrency@example.test",
          })
          const order = yield* sales.createOrder({
            principal,
            tenantId: tenant!.id,
            customerId: customer.id,
            lines: [{ itemId: item.id, quantity: "1", unitPrice: "50.00" }],
          })
          const input = {
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            warehouseId: warehouse.id,
            legalEntityId: legalEntity.id,
            commandId: "command-concurrent-confirmation-1",
            correlationId: "correlation-concurrent-confirmation-1",
            causationId: null,
            idempotencyKey: "concurrent-confirmation-1",
          }
          const results = yield* Effect.all(
            [process.confirmOrder(input), process.confirmOrder(input)],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(results[0].workflowRunId, results[1].workflowRunId)

          yield* Effect.promise(() =>
            client`
              insert into process.workflow_runs
                (tenant_id, workflow_type, idempotency_key, aggregate_id, status, payload)
              values
                (${tenant!.id}, 'sales.order.confirmation', 'manual-confirmation-1', ${order.id},
                 'running', ${
              JSON.stringify({
                orderId: order.id,
                warehouseId: warehouse.id,
                legalEntityId: legalEntity.id,
                commandId: "command-manual-confirmation-1",
                correlationId: "correlation-manual-confirmation-1",
                causationId: null,
                idempotencyKey: "manual-confirmation-1",
              })
            }::jsonb)
            `
          )
          const manual = yield* process.markManualRecovery({
            principal,
            tenantId: tenant!.id,
            idempotencyKey: "manual-confirmation-1",
            reason: "operator review required",
          })
          assert.strictEqual(manual.status, "manual_recovery")
          const recovery = yield* Effect.flip(process.recoverOrder({
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            warehouseId: warehouse.id,
            legalEntityId: legalEntity.id,
            commandId: "command-manual-confirmation-1",
            correlationId: "correlation-manual-confirmation-1",
            causationId: null,
            idempotencyKey: "manual-confirmation-1",
          }))
          assert.instanceOf(recovery, WorkflowManualRecoveryRequired)
        }).pipe(Effect.provide(authorizationLayer))
      })),
)
