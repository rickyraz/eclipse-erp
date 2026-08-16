import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

import { makeAuthService } from "../../auth/mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makePartyService, PartyCapabilities, PartyService } from "../../party/mod.ts"
import { makeUserAccountService, UserAccountService } from "../../identity/mod.ts"
import {
  InventoryCapabilities,
  InventoryStockCorrectedEvent,
  makeInventoryService,
  StockCorrectionIdempotencyConflict,
  StockReservationIdempotencyConflict,
  StockTransferDifferentLegalEntity,
  StockUnavailable,
  WarehouseBranchNotFound,
} from "../mod.ts"
import {
  Database,
  DatabaseFailure,
  makePostgresDatabase,
  runMigrations,
  WebCryptoLive,
} from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const principal = { userAccountId: "inventory-transfer-integration", sessionId: "session" }
const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  InventoryCapabilities.warehouseCreate,
  InventoryCapabilities.itemCreate,
  InventoryCapabilities.stockReceive,
  InventoryCapabilities.stockAdjust,
  InventoryCapabilities.stockReserve,
  InventoryCapabilities.stockTransferCreate,
  InventoryCapabilities.stockTransferConfirm,
  InventoryCapabilities.stockTransferComplete,
] as const

type BalanceRow = {
  readonly warehouse_id: string
  readonly item_id: string
  readonly on_hand: string
  readonly reserved: string
}

const readBalances = (client: Sql, tenantId: string) =>
  client<BalanceRow[]>`
    select warehouse_id, item_id, on_hand::text, reserved::text
    from inventory.stock_balances
    where tenant_id = ${tenantId}
    order by warehouse_id, item_id
  `

const createLegalEntityScope = (tenantId: string, name: string) =>
  Effect.gen(function* () {
    const party = yield* PartyService
    const organization = yield* party.create({
      principal,
      tenantId,
      kind: "organization",
      name: `${name} Organization`,
    })
    const legalEntity = yield* party.createLegalEntity({
      principal,
      tenantId,
      organizationId: organization.id,
    })
    const branch = yield* party.createBranch({
      principal,
      tenantId,
      legalEntityId: legalEntity.id,
      name: `${name} Branch`,
      timezone: "Asia/Jakarta",
    })
    return { legalEntity, branch }
  })

it.effect.skipIf(databaseUrl === undefined)(
  "stock corrected atomic publication stays idempotent and rolls back messaging failures",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const tenant = yield* auth.createTenant({ slug: `adjust-${crypto.randomUUID()}` })
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.succeed(MessagingService, messaging),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const scope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Adjustment"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const warehouse = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Adjustment Warehouse",
          })
          const item = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "ADJUSTMENT",
            name: "Adjustment Item",
            unitOfMeasure: "box",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "10",
          })
          const reservationInput = {
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "1",
            idempotencyKey: "reservation-1",
          }
          const duplicateReservations = yield* Effect.all(
            [inventory.reserveStock(reservationInput), inventory.reserveStock(reservationInput)],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(duplicateReservations[0].id, duplicateReservations[1].id)
          assert.instanceOf(
            yield* Effect.flip(inventory.reserveStock({
              ...reservationInput,
              quantity: "2",
            })),
            StockReservationIdempotencyConflict,
          )
          yield* inventory.reserveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "3",
          })
          const [beforeCorrection] = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(beforeCorrection, {
            warehouse_id: warehouse.id,
            item_id: item.id,
            on_hand: "10",
            reserved: "4",
          })
          const correctionInput = {
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            adjustment: "-3",
            unitOfMeasure: "BOX",
            reason: "Count correction",
            commandId: "correction-command-1",
            correlationId: "correction-correlation-1",
            causationId: null,
            idempotencyKey: "correction-1",
          }
          const duplicates = yield* Effect.all(
            [inventory.adjustStock(correctionInput), inventory.adjustStock(correctionInput)],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(duplicates[0].id, duplicates[1].id)
          assert.instanceOf(
            yield* Effect.flip(inventory.adjustStock({
              ...correctionInput,
              adjustment: "1",
            })),
            StockCorrectionIdempotencyConflict,
          )
          const competing = yield* Effect.all([
            Effect.result(inventory.adjustStock({
              ...correctionInput,
              adjustment: "-2",
              idempotencyKey: "correction-2",
            })),
            Effect.result(inventory.adjustStock({
              ...correctionInput,
              adjustment: "-2",
              idempotencyKey: "correction-3",
            })),
          ], { concurrency: "unbounded" })
          assert.strictEqual(competing.filter((result) => result._tag === "Success").length, 1)
          assert.strictEqual(competing.filter((result) => result._tag === "Failure").length, 1)
          const [balance] = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(balance, {
            warehouse_id: warehouse.id,
            item_id: item.id,
            on_hand: "5",
            reserved: "4",
          })
          const [movementCount] = yield* Effect.promise(() =>
            client<{ count: string }[]>`
              select count(*)::text as count
              from inventory.movements
              where tenant_id = ${tenant.id} and idempotency_key = 'correction-1'
            `
          )
          assert.strictEqual(movementCount?.count, "1")

          const [event] = yield* Effect.promise(() =>
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
              where tenant_id = ${tenant.id} and idempotency_key = 'correction-1'
            `
          )
          yield* Schema.decodeUnknownEffect(InventoryStockCorrectedEvent.payloadSchema)(
            event?.payload,
          )
          assert.notStrictEqual(event?.id, duplicates[0].id)
          assert.deepStrictEqual(event, {
            id: event!.id,
            event_type: InventoryStockCorrectedEvent.id,
            event_version: InventoryStockCorrectedEvent.version,
            aggregate_type: InventoryStockCorrectedEvent.aggregateType,
            aggregate_id: duplicates[0].id,
            command_id: correctionInput.commandId,
            correlation_id: correctionInput.correlationId,
            causation_id: null,
            idempotency_key: correctionInput.idempotencyKey,
            actor_principal_id: principal.userAccountId,
            occurred_at: event!.occurred_at,
            payload: {
              correctionId: duplicates[0].id,
              warehouseId: warehouse.id,
              itemId: item.id,
            },
          })
          assert.ok(Number.isFinite(new Date(event!.occurred_at).getTime()))

          const failingInventory = yield* Effect.provide(
            makeInventoryService,
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
            yield* Effect.flip(failingInventory.adjustStock({
              ...correctionInput,
              adjustment: "2",
              commandId: "correction-rollback-command",
              correlationId: "correction-rollback-correlation",
              idempotencyKey: "correction-rollback",
            })),
            DatabaseFailure,
          )
          const [rolledBackBalance] = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.strictEqual(rolledBackBalance?.on_hand, "5")
          const [rolledBackCounts] = yield* Effect.promise(() =>
            client<{ movements: string; events: string }[]>`
              select
                (select count(*)::text from inventory.movements
                  where tenant_id = ${tenant.id} and idempotency_key = 'correction-rollback') as movements,
                (select count(*)::text from messaging.event_outbox
                  where tenant_id = ${tenant.id} and idempotency_key = 'correction-rollback') as events
            `
          )
          assert.deepStrictEqual(rolledBackCounts, { movements: "0", events: "0" })
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "moves transfer lines only at confirmation and completion",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const tenant = yield* auth.createTenant({ slug: `transfer-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.effect(MessagingService, makeMessagingService).pipe(
              Layer.provide(Layer.succeed(Database, database)),
            ),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const scope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Transfer"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            primaryBranchId: scope.branch.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Destination",
          })
          const widget = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "WIDGET",
            name: "Widget",
          })
          const cable = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "CABLE",
            name: "Cable",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: widget.id,
            quantity: "10",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: cable.id,
            quantity: "8",
          })

          const transfer = yield* inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [
              { itemId: widget.id, quantity: "4" },
              { itemId: cable.id, quantity: "3" },
            ],
          })
          const beforeConfirm = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            beforeConfirm.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "8" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "10" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )

          yield* inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          yield* inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          const afterConfirm = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            afterConfirm.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "5" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "6" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )

          yield* inventory.completeTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          yield* inventory.completeTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          const afterComplete = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            afterComplete.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })).toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
            [
              { warehouse_id: destination.id, item_id: cable.id, on_hand: "3" },
              { warehouse_id: destination.id, item_id: widget.id, on_hand: "4" },
              { warehouse_id: source.id, item_id: cable.id, on_hand: "5" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "6" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rolls back every source deduction when one transfer line is unavailable",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const tenant = yield* auth.createTenant({ slug: `transfer-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.effect(MessagingService, makeMessagingService).pipe(
              Layer.provide(Layer.succeed(Database, database)),
            ),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const scope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Rollback"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            primaryBranchId: scope.branch.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Destination",
          })
          const widget = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "WIDGET",
            name: "Widget",
          })
          const cable = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "CABLE",
            name: "Cable",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: widget.id,
            quantity: "10",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: cable.id,
            quantity: "1",
          })
          const transfer = yield* inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [
              { itemId: widget.id, quantity: "2" },
              { itemId: cable.id, quantity: "2" },
            ],
          })

          const error = yield* Effect.flip(inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          }))
          assert.instanceOf(error, StockUnavailable)
          const balances = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            balances.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })).toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "1" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "10" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces warehouse legal entity and branch scope",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const tenant = yield* auth.createTenant({ slug: `warehouse-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.effect(MessagingService, makeMessagingService).pipe(
              Layer.provide(Layer.succeed(Database, database)),
            ),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const sourceScope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Source"),
            PartyService,
            party,
          )
          const destinationScope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Destination"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)

          const invalidWarehouse = yield* Effect.flip(inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: sourceScope.legalEntity.id,
            primaryBranchId: destinationScope.branch.id,
            name: "Invalid Branch Scope",
          }))
          assert.instanceOf(invalidWarehouse, WarehouseBranchNotFound)

          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: sourceScope.legalEntity.id,
            primaryBranchId: sourceScope.branch.id,
            name: "Source Warehouse",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: destinationScope.legalEntity.id,
            primaryBranchId: destinationScope.branch.id,
            name: "Destination Warehouse",
          })
          const error = yield* Effect.flip(inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [{ itemId: "item-not-needed", quantity: "1" }],
          }))
          assert.instanceOf(error, StockTransferDifferentLegalEntity)
        }).pipe(Effect.provide(authorizationLayer))
      })),
)
