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
  StockReservationInvalidState,
} from "../../inventory/mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { EventEnvelope, makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { makePartyService, PartyCapabilities } from "../../party/mod.ts"
import {
  makeProcessService,
  OrderCancellationCompletedEventPayload,
  OrderCancellationPayload,
  OrderCancellationResult,
  OrderConfirmationCorrupt,
  OrderConfirmationNotFound,
  OrderFulfillmentCompletedEventPayload,
  OrderFulfillmentPayload,
  OrderFulfillmentResult,
  ProcessJob,
  ProcessLifecycleJobPriority,
  ProcessOrderCancellationCompletedEvent,
  ProcessOrderFulfillmentCompletedEvent,
  ProcessPostCommitJobPayload,
  ProcessPostCommitJobTypes,
  ProcessWorkflowTypes,
  WorkflowIdempotencyConflict,
  WorkflowResultCorrupt,
  WorkflowRun,
} from "../mod.ts"
import { makeSalesService, SalesCapabilities, SalesService } from "../../sales/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const principal = { userAccountId: "order-lifecycle", sessionId: "session" }

const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  SalesCapabilities.customerCreate,
  SalesCapabilities.orderCreate,
  SalesCapabilities.orderConfirm,
  SalesCapabilities.orderCancel,
  InventoryCapabilities.warehouseCreate,
  InventoryCapabilities.itemCreate,
  InventoryCapabilities.stockReceive,
  InventoryCapabilities.stockReserve,
  InventoryCapabilities.stockRelease,
  InventoryCapabilities.stockFulfill,
  AccountingCapabilities.legalEntityConfigure,
  AccountingCapabilities.accountCreate,
  AccountingCapabilities.revenueConfigure,
  AccountingCapabilities.periodOpen,
  AccountingCapabilities.revenuePost,
  AccountingCapabilities.revenueReverse,
] as const

const readCounts = (client: Sql, tenantId: string) =>
  client<{
    workflow_runs: string
    events: string
    jobs: string
    journals: string
  }[]>`
    select
      (select count(*)::text from process.workflow_runs where tenant_id = ${tenantId}) as workflow_runs,
      (select count(*)::text from messaging.event_outbox where tenant_id = ${tenantId}) as events,
      (select count(*)::text from process.jobs where tenant_id = ${tenantId}) as jobs,
      (select count(*)::text from accounting.journal_entries where tenant_id = ${tenantId}) as journals
  `

const makeFixture = (client: Sql, tenantId: string, label: string) =>
  Effect.gen(function* () {
    const database = makePostgresDatabase(client)
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
      tenantId,
      kind: "organization",
      name: `${label} Organization`,
    })
    const legalEntity = yield* party.createLegalEntity({
      principal,
      tenantId,
      organizationId: organization.id,
    })
    const warehouse = yield* inventory.createWarehouse({
      principal,
      tenantId,
      legalEntityId: legalEntity.id,
      name: `${label} Warehouse`,
    })
    const widget = yield* inventory.createItem({
      principal,
      tenantId,
      sku: `${label}-WIDGET`,
      name: `${label} Widget`,
    })
    const cable = yield* inventory.createItem({
      principal,
      tenantId,
      sku: `${label}-CABLE`,
      name: `${label} Cable`,
    })
    yield* Effect.forEach([widget, cable], (item) =>
      inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "10",
      }))
    const receivable = yield* accounting.createAccount({
      principal,
      tenantId,
      code: "1000",
      name: `${label} Receivable`,
      type: "asset",
    })
    const revenue = yield* accounting.createAccount({
      principal,
      tenantId,
      code: "4000",
      name: `${label} Revenue`,
      type: "revenue",
    })
    yield* accounting.configureLegalEntity({
      principal,
      tenantId,
      legalEntityId: legalEntity.id,
      baseCurrency: "USD",
      precision: 2,
      fiscalYearStartMonth: 1,
      postingEnabled: true,
    })
    yield* accounting.configureRevenuePosting({
      principal,
      tenantId,
      legalEntityId: legalEntity.id,
      receivableAccountId: receivable.id,
      revenueAccountId: revenue.id,
    })
    yield* accounting.openPeriod({
      principal,
      tenantId,
      legalEntityId: legalEntity.id,
      startsOn: "1900-01-01",
      endsOn: "2099-12-31",
    })
    const customer = yield* sales.createCustomer({
      principal,
      tenantId,
      name: `${label} Customer`,
      email: `${label.toLowerCase()}@example.test`,
    })
    const order = yield* sales.createOrder({
      principal,
      tenantId,
      customerId: customer.id,
      lines: [
        { itemId: widget.id, quantity: "2", unitPrice: "50.00" },
        { itemId: cable.id, quantity: "1", unitPrice: "25.00" },
      ],
    })

    return { process, order, warehouse, legalEntity, widget, cable }
  })

const prepare = (client: Sql, label: string) =>
  Effect.gen(function* () {
    yield* runMigrations(client)
    const [tenant] = yield* Effect.promise(() =>
      client<{ id: string }[]>`
        insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
      `
    )
    const tenantId = tenant!.id
    const authorizationLayer = makeAuthorizationTestLayer(
      capabilities.map((capability) => ({
        userAccountId: principal.userAccountId,
        tenantId,
        capability,
      })),
    )
    const fixture = yield* makeFixture(client, tenantId, label).pipe(
      Effect.provide(authorizationLayer),
    )
    return { tenantId, ...fixture }
  })

it.effect.skipIf(databaseUrl === undefined)(
  "cancellation atomic success, replay, conflict, and linked reversal",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        const { tenantId, process, order, warehouse, legalEntity, widget, cable } = yield* prepare(
          client,
          "CANCEL",
        )
        const confirmation = yield* process.confirmOrder({
          principal,
          tenantId,
          orderId: order.id,
          warehouseId: warehouse.id,
          legalEntityId: legalEntity.id,
          commandId: "command-confirm-cancel-1",
          correlationId: "correlation-confirm-cancel-1",
          causationId: "causation-confirm-cancel-1",
          idempotencyKey: "confirm-cancel-1",
        })
        const input = {
          principal,
          tenantId,
          orderId: order.id,
          commandId: "command-cancel-1",
          correlationId: "correlation-cancel-1",
          causationId: "causation-cancel-1",
          idempotencyKey: "cancel-1",
        }
        const corruptConfirmationResult = {
          ...confirmation,
          reservations: confirmation.reservations.map((reservation, index) =>
            index === 0 ? { ...reservation, status: "fulfilled" as const } : reservation
          ),
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(corruptConfirmationResult)}::jsonb
            where id = ${confirmation.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          OrderConfirmationCorrupt,
        )
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(confirmation)}::jsonb
            where id = ${confirmation.workflowRunId}
          `
        )
        const corruptConfirmationEventPayload = {
          workflowRunId: confirmation.workflowRunId,
          orderId: order.id,
          reservationIds: confirmation.reservations.map(({ id }) => id),
          journalId: crypto.randomUUID(),
        }
        yield* Effect.promise(() =>
          client`
            update messaging.event_outbox
            set payload = ${JSON.stringify(corruptConfirmationEventPayload)}::jsonb
            where id = ${confirmation.eventId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          OrderConfirmationCorrupt,
        )
        yield* Effect.promise(() =>
          client`
            update messaging.event_outbox
            set payload = ${
            JSON.stringify({
              workflowRunId: confirmation.workflowRunId,
              orderId: order.id,
              reservationIds: confirmation.reservations.map(({ id }) => id),
              journalId: confirmation.journal.id,
            })
          }::jsonb
            where id = ${confirmation.eventId}
          `
        )
        const corruptConfirmationJobResult = { ...confirmation, jobId: crypto.randomUUID() }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(corruptConfirmationJobResult)}::jsonb
            where id = ${confirmation.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          OrderConfirmationCorrupt,
        )
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(confirmation)}::jsonb
            where id = ${confirmation.workflowRunId}
          `
        )
        const detachedConfirmationJournalResult = {
          ...confirmation,
          journal: { ...confirmation.journal, tenantId: crypto.randomUUID() },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(detachedConfirmationJournalResult)}::jsonb
            where id = ${confirmation.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          OrderConfirmationCorrupt,
        )
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(confirmation)}::jsonb
            where id = ${confirmation.workflowRunId}
          `
        )

        const result = yield* process.cancelOrder(input)
        const repeated = yield* process.cancelOrder(input)
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
        assert.strictEqual(decodedWorkflow.workflowType, ProcessWorkflowTypes.cancellation)
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(OrderCancellationPayload)(storedWorkflow?.payload),
          {
            orderId: input.orderId,
            commandId: input.commandId,
            correlationId: input.correlationId,
            causationId: input.causationId,
            idempotencyKey: input.idempotencyKey,
          },
        )
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(OrderCancellationResult)(storedWorkflow?.result),
          result,
        )
        assert.strictEqual(repeated.workflowRunId, result.workflowRunId)
        assert.strictEqual(repeated.eventId, result.eventId)
        assert.strictEqual(repeated.jobId, result.jobId)
        assert.strictEqual(repeated.reversalJournal.id, result.reversalJournal.id)
        assert.deepStrictEqual(
          repeated.releasedReservations.map(({ id }) => id),
          result.releasedReservations.map(({ id }) => id),
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder({ ...input, commandId: "changed-command" })),
          WorkflowIdempotencyConflict,
        )
        assert.strictEqual(result.order.status, "cancelled")
        assert.strictEqual(result.releasedReservations.length, confirmation.reservations.length)
        assert.strictEqual(
          result.releasedReservations.every(({ status }) => status === "released"),
          true,
        )
        assert.strictEqual(result.reversalJournal.status, "reversed")
        assert.strictEqual(result.reversalJournal.reversesEntryId, confirmation.journal.id)

        const balances = yield* Effect.promise(() =>
          client<{ item_id: string; on_hand: string; reserved: string }[]>`
            select item_id, on_hand::text, reserved::text
            from inventory.stock_balances
            where tenant_id = ${tenantId} and warehouse_id = ${warehouse.id}
            order by item_id
          `
        )
        assert.deepStrictEqual(
          balances,
          [
            { item_id: widget.id, on_hand: "10", reserved: "0" },
            { item_id: cable.id, on_hand: "10", reserved: "0" },
          ].toSorted((a, b) => a.item_id.localeCompare(b.item_id)),
        )
        const reservations = yield* Effect.promise(() =>
          client<{ id: string; status: string }[]>`
            select id, status
            from inventory.reservations
            where tenant_id = ${tenantId}
            order by id
          `
        )
        assert.deepStrictEqual(
          reservations,
          confirmation.reservations.map(({ id }) => ({ id, status: "released" })).toSorted((a, b) =>
            a.id.localeCompare(b.id)
          ),
        )
        const [reversal] = yield* Effect.promise(() =>
          client<{ id: string; reverses_entry_id: string | null; status: string }[]>`
            select id, reverses_entry_id, status
            from accounting.journal_entries
            where id = ${result.reversalJournal.id}
          `
        )
        assert.deepStrictEqual(reversal, {
          id: result.reversalJournal.id,
          reverses_entry_id: confirmation.journal.id,
          status: "reversed",
        })
        const [event] = yield* Effect.promise(() =>
          client<{
            event_type: string
            command_id: string
            correlation_id: string
            causation_id: string | null
            idempotency_key: string
            payload: unknown
          }[]>`
            select event_type, command_id, correlation_id, causation_id, idempotency_key, payload
            from messaging.event_outbox
            where id = ${result.eventId}
          `
        )
        yield* Schema.decodeUnknownEffect(OrderCancellationCompletedEventPayload)(event?.payload)
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
        assert.strictEqual(decodedEvent.eventType, ProcessOrderCancellationCompletedEvent.id)
        assert.strictEqual(
          decodedEvent.eventVersion,
          ProcessOrderCancellationCompletedEvent.version,
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
            aggregateType: ProcessOrderCancellationCompletedEvent.aggregateType,
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
        assert.deepStrictEqual(event, {
          event_type: "process.order_cancellation.completed",
          command_id: input.commandId,
          correlation_id: input.correlationId,
          causation_id: input.causationId,
          idempotency_key: input.idempotencyKey,
          payload: {
            workflowRunId: result.workflowRunId,
            confirmationWorkflowRunId: confirmation.workflowRunId,
            orderId: order.id,
            reservationIds: result.releasedReservations.map(({ id }) => id),
            reversalJournalId: result.reversalJournal.id,
          },
        })
        const [job] = yield* Effect.promise(() =>
          client<{
            job_type: string
            correlation_id: string
            idempotency_key: string
            payload: unknown
          }[]>`
            select job_type, correlation_id, idempotency_key, payload
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
            jobType: ProcessPostCommitJobTypes.cancellation,
            idempotencyKey: input.idempotencyKey,
            priority: ProcessLifecycleJobPriority,
            status: "pending",
            leaseUntil: null,
            attempts: 0,
            correlationId: input.correlationId,
          },
        )
        assert.deepStrictEqual(job, {
          job_type: "process.order_cancellation.post_commit",
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
        assert.deepStrictEqual((yield* Effect.promise(() => readCounts(client, tenantId)))[0], {
          workflow_runs: "2",
          events: "4",
          jobs: "2",
          journals: "2",
        })

        const mismatchedCancelledOrderFactsResult = {
          ...result,
          order: {
            ...result.order,
            lines: result.order.lines.map((line, index) =>
              index === 0 ? { ...line, unitPrice: "1.00" } : line
            ),
          },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedCancelledOrderFactsResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedCancelledOrderStateResult = {
          ...result,
          order: { ...result.order, status: "confirmed" as const },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedCancelledOrderStateResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
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
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const detachedReservationResult = {
          ...result,
          releasedReservations: result.releasedReservations.map((reservation, index) =>
            index === 0 ? { ...reservation, tenantId: crypto.randomUUID() } : reservation
          ),
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(detachedReservationResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedReservationResult = {
          ...result,
          releasedReservations: result.releasedReservations.map((reservation, index) =>
            index === 0 ? { ...reservation, id: crypto.randomUUID() } : reservation
          ),
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedReservationResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedReservationDetailsResult = {
          ...result,
          releasedReservations: result.releasedReservations.map((reservation, index) =>
            index === 0 ? { ...reservation, quantity: "999" } : reservation
          ),
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedReservationDetailsResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const selfReversalJournalResult = {
          ...result,
          reversalJournal: { ...result.reversalJournal, id: confirmation.journal.id },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(selfReversalJournalResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedReversalJournalStateResult = {
          ...result,
          reversalJournal: { ...result.reversalJournal, status: "posted" as const },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedReversalJournalStateResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedReversalJournalLinesResult = {
          ...result,
          reversalJournal: {
            ...result.reversalJournal,
            lines: result.reversalJournal.lines.map((line, index) =>
              index === 0 ? { ...line, accountId: crypto.randomUUID() } : line
            ),
          },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedReversalJournalLinesResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const crossLinkedCancellationJobResult = { ...result, jobId: crypto.randomUUID() }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(crossLinkedCancellationJobResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedCancellationEventPayload = {
          workflowRunId: result.workflowRunId,
          confirmationWorkflowRunId: confirmation.workflowRunId,
          orderId: order.id,
          reservationIds: result.releasedReservations.map(({ id }) => id),
          reversalJournalId: crypto.randomUUID(),
        }
        yield* Effect.promise(() =>
          client`
            update messaging.event_outbox
            set payload = ${JSON.stringify(mismatchedCancellationEventPayload)}::jsonb
            where id = ${result.eventId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const crossLinkedCancellationEventResult = { ...result, eventId: crypto.randomUUID() }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(crossLinkedCancellationEventResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const detachedJournalResult = {
          ...result,
          reversalJournal: { ...result.reversalJournal, tenantId: crypto.randomUUID() },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(detachedJournalResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedJournalResult = {
          ...result,
          reversalJournal: {
            ...result.reversalJournal,
            reversesEntryId: crypto.randomUUID(),
          },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedJournalResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = jsonb_set(result, '{workflowRunId}', to_jsonb(${crypto.randomUUID()}::text))
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(input)),
          WorkflowResultCorrupt,
        )
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "fulfillment success, replay, conflict, and atomic cancellation rejection",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        const { tenantId, process, order, warehouse, legalEntity, widget, cable } = yield* prepare(
          client,
          "FULFILL",
        )
        const confirmation = yield* process.confirmOrder({
          principal,
          tenantId,
          orderId: order.id,
          warehouseId: warehouse.id,
          legalEntityId: legalEntity.id,
          commandId: "command-confirm-fulfill-1",
          correlationId: "correlation-confirm-fulfill-1",
          causationId: "causation-confirm-fulfill-1",
          idempotencyKey: "confirm-fulfill-1",
        })
        const input = {
          principal,
          tenantId,
          orderId: order.id,
          commandId: "command-fulfill-1",
          correlationId: "correlation-fulfill-1",
          causationId: "causation-fulfill-1",
          idempotencyKey: "fulfill-1",
        }

        const result = yield* process.fulfillOrder(input)
        const repeated = yield* process.fulfillOrder(input)
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
        assert.strictEqual(decodedWorkflow.workflowType, ProcessWorkflowTypes.fulfillment)
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(OrderFulfillmentPayload)(storedWorkflow?.payload),
          {
            orderId: input.orderId,
            commandId: input.commandId,
            correlationId: input.correlationId,
            causationId: input.causationId,
            idempotencyKey: input.idempotencyKey,
          },
        )
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(OrderFulfillmentResult)(storedWorkflow?.result),
          result,
        )
        assert.strictEqual(repeated.workflowRunId, result.workflowRunId)
        assert.strictEqual(repeated.eventId, result.eventId)
        assert.strictEqual(repeated.jobId, result.jobId)
        assert.deepStrictEqual(
          repeated.fulfilledReservations.map(({ id }) => id),
          result.fulfilledReservations.map(({ id }) => id),
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder({ ...input, commandId: "changed-command" })),
          WorkflowIdempotencyConflict,
        )
        assert.strictEqual(result.order.status, "confirmed")
        const [event] = yield* Effect.promise(() =>
          client<{ payload: unknown }[]>`
            select payload from messaging.event_outbox where id = ${result.eventId}
          `
        )
        const eventPayload = yield* Schema.decodeUnknownEffect(
          OrderFulfillmentCompletedEventPayload,
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
        assert.strictEqual(decodedEvent.eventType, ProcessOrderFulfillmentCompletedEvent.id)
        assert.strictEqual(decodedEvent.eventVersion, ProcessOrderFulfillmentCompletedEvent.version)
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
            aggregateType: ProcessOrderFulfillmentCompletedEvent.aggregateType,
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
        assert.deepStrictEqual(eventPayload, {
          workflowRunId: result.workflowRunId,
          confirmationWorkflowRunId: confirmation.workflowRunId,
          orderId: order.id,
          reservationIds: result.fulfilledReservations.map(({ id }) => id),
        })
        const [job] = yield* Effect.promise(() =>
          client<{ payload: unknown }[]>`
            select payload from process.jobs where id = ${result.jobId}
          `
        )
        const jobPayload = yield* Schema.decodeUnknownEffect(ProcessPostCommitJobPayload)(
          job?.payload,
        )
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
            jobType: ProcessPostCommitJobTypes.fulfillment,
            idempotencyKey: input.idempotencyKey,
            priority: ProcessLifecycleJobPriority,
            status: "pending",
            leaseUntil: null,
            attempts: 0,
            correlationId: input.correlationId,
          },
        )
        assert.deepStrictEqual(jobPayload, {
          eventId: result.eventId,
          workflowRunId: result.workflowRunId,
          commandId: input.commandId,
          correlationId: input.correlationId,
          causationId: input.causationId,
          idempotencyKey: input.idempotencyKey,
        })
        assert.strictEqual(result.fulfilledReservations.length, confirmation.reservations.length)
        assert.strictEqual(
          result.fulfilledReservations.every(({ status }) => status === "fulfilled"),
          true,
        )
        const balances = yield* Effect.promise(() =>
          client<{ item_id: string; on_hand: string; reserved: string }[]>`
            select item_id, on_hand::text, reserved::text
            from inventory.stock_balances
            where tenant_id = ${tenantId} and warehouse_id = ${warehouse.id}
            order by item_id
          `
        )
        assert.deepStrictEqual(
          balances,
          [
            { item_id: widget.id, on_hand: "8", reserved: "0" },
            { item_id: cable.id, on_hand: "9", reserved: "0" },
          ].toSorted((a, b) => a.item_id.localeCompare(b.item_id)),
        )
        const reservations = yield* Effect.promise(() =>
          client<{ id: string; status: string }[]>`
            select id, status
            from inventory.reservations
            where tenant_id = ${tenantId}
            order by id
          `
        )
        assert.deepStrictEqual(
          reservations,
          confirmation.reservations.map(({ id }) => ({ id, status: "fulfilled" })).toSorted((
            a,
            b,
          ) => a.id.localeCompare(b.id)),
        )
        const beforeCancellation = (yield* Effect.promise(() => readCounts(client, tenantId)))[0]!
        assert.deepStrictEqual(beforeCancellation, {
          workflow_runs: "2",
          events: "4",
          jobs: "2",
          journals: "1",
        })
        const cancellationError = yield* Effect.flip(process.cancelOrder({
          principal,
          tenantId,
          orderId: order.id,
          commandId: "command-cancel-fulfilled-1",
          correlationId: "correlation-cancel-fulfilled-1",
          causationId: "causation-cancel-fulfilled-1",
          idempotencyKey: "cancel-fulfilled-1",
        }))
        assert.instanceOf(cancellationError, StockReservationInvalidState)
        const [storedOrder] = yield* Effect.promise(() =>
          client<{ status: string }[]>`select status from sales.orders where id = ${order.id}`
        )
        assert.strictEqual(storedOrder?.status, "confirmed")
        assert.deepStrictEqual(
          (yield* Effect.promise(() => readCounts(client, tenantId)))[0],
          beforeCancellation,
        )
        const [cancelArtifacts] = yield* Effect.promise(() =>
          client<{ workflows: string; events: string; jobs: string; reversals: string }[]>`
            select
              (select count(*)::text from process.workflow_runs
                where tenant_id = ${tenantId} and workflow_type = 'sales.order.cancellation') as workflows,
              (select count(*)::text from messaging.event_outbox
                where tenant_id = ${tenantId} and event_type = 'process.order_cancellation.completed') as events,
              (select count(*)::text from process.jobs
                where tenant_id = ${tenantId} and job_type = 'process.order_cancellation.post_commit') as jobs,
              (select count(*)::text from accounting.journal_entries
                where tenant_id = ${tenantId} and reverses_entry_id is not null) as reversals
          `
        )
        assert.deepStrictEqual(cancelArtifacts, {
          workflows: "0",
          events: "0",
          jobs: "0",
          reversals: "0",
        })
        const mismatchedFulfilledOrderFactsResult = {
          ...result,
          order: {
            ...result.order,
            customerId: crypto.randomUUID(),
          },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedFulfilledOrderFactsResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedFulfilledOrderStateResult = {
          ...result,
          order: { ...result.order, status: "cancelled" as const },
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedFulfilledOrderStateResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedFulfilledReservationDetailsResult = {
          ...result,
          fulfilledReservations: result.fulfilledReservations.map((reservation, index) =>
            index === 0 ? { ...reservation, quantity: "999" } : reservation
          ),
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedFulfilledReservationDetailsResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
        const crossLinkedFulfillmentJobResult = { ...result, jobId: crypto.randomUUID() }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(crossLinkedFulfillmentJobResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedFulfillmentEventPayload = {
          workflowRunId: result.workflowRunId,
          confirmationWorkflowRunId: confirmation.workflowRunId,
          orderId: crypto.randomUUID(),
          reservationIds: result.fulfilledReservations.map(({ id }) => id),
        }
        yield* Effect.promise(() =>
          client`
            update messaging.event_outbox
            set payload = ${JSON.stringify(mismatchedFulfillmentEventPayload)}::jsonb
            where id = ${result.eventId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
        const crossLinkedFulfillmentEventResult = { ...result, eventId: crypto.randomUUID() }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(crossLinkedFulfillmentEventResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
        const detachedFulfilledReservationResult = {
          ...result,
          fulfilledReservations: result.fulfilledReservations.map((reservation, index) =>
            index === 0 ? { ...reservation, tenantId: crypto.randomUUID() } : reservation
          ),
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(detachedFulfilledReservationResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
        const mismatchedFulfilledReservationResult = {
          ...result,
          fulfilledReservations: result.fulfilledReservations.map((reservation, index) =>
            index === 0 ? { ...reservation, id: crypto.randomUUID() } : reservation
          ),
        }
        yield* Effect.promise(() =>
          client`
            update process.workflow_runs
            set result = ${JSON.stringify(mismatchedFulfilledReservationResult)}::jsonb
            where id = ${result.workflowRunId}
          `
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder(input)),
          WorkflowResultCorrupt,
        )
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "cancellation atomic rollback when revenue reversal fails",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        const { tenantId, process, order, warehouse, legalEntity } = yield* prepare(
          client,
          "REVERSE-FAIL",
        )
        const confirmation = yield* process.confirmOrder({
          principal,
          tenantId,
          orderId: order.id,
          warehouseId: warehouse.id,
          legalEntityId: legalEntity.id,
          commandId: "command-confirm-reverse-fail-1",
          correlationId: "correlation-confirm-reverse-fail-1",
          idempotencyKey: "confirm-reverse-fail-1",
        })
        yield* Effect.promise(() =>
          client`
            update accounting.accounting_periods
            set status = 'closed'
            where tenant_id = ${tenantId} and legal_entity_id = ${legalEntity.id}
          `
        )
        const before = (yield* Effect.promise(() => readCounts(client, tenantId)))[0]!

        const error = yield* Effect.flip(process.cancelOrder({
          principal,
          tenantId,
          orderId: order.id,
          commandId: "command-cancel-reverse-fail-1",
          correlationId: "correlation-cancel-reverse-fail-1",
          idempotencyKey: "cancel-reverse-fail-1",
        }))
        assert.strictEqual(error._tag, "AccountingPeriodNotOpen")
        const [storedOrder] = yield* Effect.promise(() =>
          client<{ status: string }[]>`select status from sales.orders where id = ${order.id}`
        )
        assert.strictEqual(storedOrder?.status, "confirmed")
        const reservations = yield* Effect.promise(() =>
          client<{ id: string; status: string }[]>`
            select id, status from inventory.reservations
            where tenant_id = ${tenantId}
            order by id
          `
        )
        assert.deepStrictEqual(
          reservations,
          confirmation.reservations.map(({ id }) => ({ id, status: "active" })).toSorted((a, b) =>
            a.id.localeCompare(b.id)
          ),
        )
        assert.deepStrictEqual(
          (yield* Effect.promise(() => readCounts(client, tenantId)))[0],
          before,
        )
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "cancel and fulfillment require a succeeded confirmation without changing counts",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        const { tenantId, process, order } = yield* prepare(client, "MISSING")
        const before = (yield* Effect.promise(() => readCounts(client, tenantId)))[0]!
        const lifecycleInput = {
          principal,
          tenantId,
          orderId: order.id,
          commandId: "command-missing-confirmation-1",
          correlationId: "correlation-missing-confirmation-1",
          causationId: null,
          idempotencyKey: "missing-confirmation-1",
        }
        assert.instanceOf(
          yield* Effect.flip(process.cancelOrder(lifecycleInput)),
          OrderConfirmationNotFound,
        )
        assert.deepStrictEqual(
          (yield* Effect.promise(() => readCounts(client, tenantId)))[0],
          before,
        )
        assert.instanceOf(
          yield* Effect.flip(process.fulfillOrder({
            ...lifecycleInput,
            commandId: "command-missing-confirmation-2",
            idempotencyKey: "missing-confirmation-2",
          })),
          OrderConfirmationNotFound,
        )
        assert.deepStrictEqual(
          (yield* Effect.promise(() => readCounts(client, tenantId)))[0],
          before,
        )
      })),
)
