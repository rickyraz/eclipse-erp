import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { InventoryService, makeInventoryTestLayer, StockUnavailable } from "../mod.ts"

const principal = { identityId: "keeper", sessionId: "session" }
const tenantId = "tenant-a"
const capabilities = [
  "inventory.warehouse.create",
  "inventory.item.create",
  "inventory.stock.receive",
  "inventory.stock.reserve",
] as const
const authorizationLayer = makeAuthorizationTestLayer(
  capabilities.map((capability) => ({ identityId: principal.identityId, tenantId, capability })),
)

const withInventory = <A, E>(program: Effect.Effect<A, E, InventoryService>) =>
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    return yield* Effect.provide(program, makeInventoryTestLayer(authorization))
  }).pipe(Effect.provide(authorizationLayer))

describe("inventory contract", () => {
  it.effect("receives and atomically reserves available stock", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      const warehouse = yield* inventory.createWarehouse({ principal, tenantId, name: "Main" })
      const item = yield* inventory.createItem({
        principal,
        tenantId,
        sku: "sku-1",
        name: "Widget",
      })
      const balance = yield* inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "10",
      })
      const reservation = yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "4",
      })

      assert.strictEqual(balance.onHand, "10")
      assert.strictEqual(reservation.quantity, "4")
    })))

  it.effect("rejects reservations above available stock", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      const warehouse = yield* inventory.createWarehouse({ principal, tenantId, name: "Main" })
      const item = yield* inventory.createItem({
        principal,
        tenantId,
        sku: "sku-1",
        name: "Widget",
      })
      const error = yield* Effect.flip(inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "1",
      }))
      assert.instanceOf(error, StockUnavailable)
    })))
})
