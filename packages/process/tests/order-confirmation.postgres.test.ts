import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
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
import { makePartyService, PartyCapabilities } from "../../party/mod.ts"
import { makeProcessService, ProcessCapabilities, WorkflowManualRecoveryRequired } from "../mod.ts"
import { makeSalesService, SalesCapabilities, SalesService } from "../../sales/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
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
  AccountingCapabilities.accountCreate,
  AccountingCapabilities.journalPost,
  ProcessCapabilities.orderConfirmationRecover,
  ProcessCapabilities.orderConfirmationManualRecovery,
] as const

const readCounts = (client: Sql, tenantId: string) =>
  client<{ workflow_runs: string; events: string; jobs: string }[]>`
    select
      (select count(*)::text from process.workflow_runs where tenant_id = ${tenantId}) as workflow_runs,
      (select count(*)::text from process.event_outbox where tenant_id = ${tenantId}) as events,
      (select count(*)::text from process.jobs where tenant_id = ${tenantId}) as jobs
  `

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
          const sales = yield* Effect.provide(makeSalesService, requirements)
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const accounting = yield* Effect.provide(makeAccountingService, requirements)
          const process = yield* Effect.provide(
            makeProcessService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(SalesService, sales),
              Layer.succeed(InventoryService, inventory),
              Layer.succeed(AccountingService, accounting),
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
          const item = yield* inventory.createItem({
            principal,
            tenantId: tenant!.id,
            sku: "ORDER-WIDGET",
            name: "Order Widget",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant!.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "10",
          })
          const cash = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "1000",
            name: "Cash",
            type: "asset",
          })
          const revenue = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "4000",
            name: "Revenue",
            type: "revenue",
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
            total: "100.00",
          })
          const input = {
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "4",
            idempotencyKey: "order-confirmation-1",
            journalLines: [
              { accountId: cash.id, debit: "100.00", credit: "0" },
              { accountId: revenue.id, debit: "0", credit: "100.00" },
            ],
          }

          const result = yield* process.confirmOrder(input)
          const repeated = yield* process.confirmOrder(input)
          const counts = (yield* Effect.promise(() => readCounts(client, tenant!.id)))[0]!
          assert.strictEqual(result.workflowRunId, repeated.workflowRunId)
          assert.strictEqual(result.reservation.id, repeated.reservation.id)
          assert.strictEqual(result.journal.id, repeated.journal.id)
          assert.strictEqual(result.order.status, "confirmed")
          assert.strictEqual(counts.workflow_runs, "1")
          assert.strictEqual(counts.events, "1")
          assert.strictEqual(counts.jobs, "1")

          const [balance] = yield* Effect.promise(() =>
            client<{ on_hand: string; reserved: string }[]>`
              select on_hand::text, reserved::text
              from inventory.stock_balances
              where tenant_id = ${tenant!.id}
                and warehouse_id = ${warehouse.id}
                and item_id = ${item.id}
            `
          )
          assert.deepStrictEqual(balance, { on_hand: "10", reserved: "4" })
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
          const sales = yield* Effect.provide(makeSalesService, requirements)
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const accounting = yield* Effect.provide(makeAccountingService, requirements)
          const process = yield* Effect.provide(
            makeProcessService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(SalesService, sales),
              Layer.succeed(InventoryService, inventory),
              Layer.succeed(AccountingService, accounting),
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
          const cash = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "1001",
            name: "Rollback Cash",
            type: "asset",
          })
          const revenue = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "4001",
            name: "Rollback Revenue",
            type: "revenue",
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
            total: "100.00",
          })
          const error = yield* Effect.flip(process.confirmOrder({
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "2",
            idempotencyKey: "rollback-confirmation-1",
            journalLines: [
              { accountId: cash.id, debit: "100.00", credit: "0" },
              { accountId: revenue.id, debit: "0", credit: "100.00" },
            ],
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
          const sales = yield* Effect.provide(makeSalesService, requirements)
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const accounting = yield* Effect.provide(makeAccountingService, requirements)
          const process = yield* Effect.provide(
            makeProcessService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(SalesService, sales),
              Layer.succeed(InventoryService, inventory),
              Layer.succeed(AccountingService, accounting),
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
          const cash = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "1002",
            name: "Concurrency Cash",
            type: "asset",
          })
          const revenue = yield* accounting.createAccount({
            principal,
            tenantId: tenant!.id,
            code: "4002",
            name: "Concurrency Revenue",
            type: "revenue",
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
            total: "50.00",
          })
          const input = {
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "2",
            idempotencyKey: "concurrent-confirmation-1",
            journalLines: [
              { accountId: cash.id, debit: "50.00", credit: "0" },
              { accountId: revenue.id, debit: "0", credit: "50.00" },
            ],
          }
          const results = yield* Effect.all(
            [process.confirmOrder(input), process.confirmOrder(input)],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(results[0].workflowRunId, results[1].workflowRunId)

          yield* Effect.promise(() =>
            client`
              insert into process.workflow_runs
                (tenant_id, workflow_type, idempotency_key, aggregate_id, status, payload, recovery_reason)
              values
                (${tenant!.id}, 'sales.order.confirmation', 'manual-confirmation-1', ${order.id},
                 'running', ${
              JSON.stringify({
                orderId: order.id,
                warehouseId: warehouse.id,
                itemId: item.id,
                quantity: "2",
                idempotencyKey: "manual-confirmation-1",
                journalLines: input.journalLines,
              })
            }::jsonb, 'operator review required')
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
            itemId: item.id,
            quantity: "2",
            idempotencyKey: "manual-confirmation-1",
            journalLines: input.journalLines,
          }))
          assert.instanceOf(recovery, WorkflowManualRecoveryRequired)
        }).pipe(Effect.provide(authorizationLayer))
      })),
)
