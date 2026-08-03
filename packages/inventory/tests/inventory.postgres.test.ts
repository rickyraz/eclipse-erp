import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { makeAuthService } from "../../auth/mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makeInventoryService, StockUnavailable } from "../mod.ts"
import { makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const principal = { identityId: "inventory-transfer-integration", sessionId: "session" }
const capabilities = [
  "inventory.warehouse.create",
  "inventory.item.create",
  "inventory.stock.receive",
  "inventory.stock.transfer.create",
  "inventory.stock.transfer.confirm",
  "inventory.stock.transfer.complete",
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

it.effect.skipIf(databaseUrl === undefined)(
  "moves transfer lines only at confirmation and completion",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const auth = makeAuthService(database)
        const tenant = yield* auth.createTenant({ slug: `transfer-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            identityId: principal.identityId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const inventory = makeInventoryService(database, authorization)
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
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
        const auth = makeAuthService(database)
        const tenant = yield* auth.createTenant({ slug: `transfer-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            identityId: principal.identityId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const inventory = makeInventoryService(database, authorization)
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
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
