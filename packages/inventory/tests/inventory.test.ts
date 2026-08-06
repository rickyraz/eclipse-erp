import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../authorization/mod.ts"
import {
  InventoryService,
  makeInventoryTestLayer,
  StockTransferDifferentLegalEntity,
  StockTransferInvalidState,
  StockUnavailable,
} from "../mod.ts"

const principal = { userAccountId: "keeper", sessionId: "session" }
const tenantId = "tenant-a"
const legalEntityId = "legal-entity-a"
const capabilities = [
  "inventory.warehouse.create",
  "inventory.item.create",
  "inventory.stock.receive",
  "inventory.stock.reserve",
  "inventory.stock.transfer.create",
  "inventory.stock.transfer.confirm",
  "inventory.stock.transfer.complete",
] as const
const withInventory = <A, E>(
  program: Effect.Effect<A, E, InventoryService>,
  grantedCapabilities: readonly string[] = capabilities,
) =>
  Effect.provide(
    program,
    makeInventoryTestLayer().pipe(
      Layer.provide(
        makeAuthorizationTestLayer(
        grantedCapabilities.map((capability) => ({
          userAccountId: principal.userAccountId,
          tenantId,
          capability: capability as (typeof capabilities)[number],
        })),
        ),
      ),
    ),
  )

describe("inventory contract", () => {
  it.effect("receives and atomically reserves available stock", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      const warehouse = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId,
        name: "Main",
      })
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
      const warehouse = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId,
        name: "Main",
      })
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

  it.effect("moves multiple items only across the confirmed and completed states", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      const source = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId,
        name: "Source",
      })
      const destination = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId,
        name: "Destination",
      })
      const widget = yield* inventory.createItem({
        principal,
        tenantId,
        sku: "widget",
        name: "Widget",
      })
      const cable = yield* inventory.createItem({
        principal,
        tenantId,
        sku: "cable",
        name: "Cable",
      })
      yield* inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: source.id,
        itemId: widget.id,
        quantity: "10",
      })
      yield* inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: source.id,
        itemId: cable.id,
        quantity: "8",
      })

      const transfer = yield* inventory.createTransfer({
        principal,
        tenantId,
        sourceWarehouseId: source.id,
        destinationWarehouseId: destination.id,
        lines: [
          { itemId: widget.id, quantity: "4" },
          { itemId: cable.id, quantity: "3" },
        ],
      })
      assert.strictEqual(transfer.status, "draft")
      assert.strictEqual(transfer.confirmedAt, null)
      assert.strictEqual(transfer.completedAt, null)

      assert.instanceOf(
        yield* Effect.flip(inventory.completeTransfer({
          principal,
          tenantId,
          transferId: transfer.id,
        })),
        StockTransferInvalidState,
      )

      // Reserving the remaining source availability proves creation did not deduct stock.
      yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: source.id,
        itemId: widget.id,
        quantity: "6",
      })
      yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: source.id,
        itemId: cable.id,
        quantity: "5",
      })

      const confirmed = yield* inventory.confirmTransfer({
        principal,
        tenantId,
        transferId: transfer.id,
      })
      assert.strictEqual(confirmed.status, "confirmed")
      assert.ok(confirmed.confirmedAt)
      assert.strictEqual(confirmed.completedAt, null)
      assert.instanceOf(
        yield* Effect.flip(inventory.reserveStock({
          principal,
          tenantId,
          warehouseId: source.id,
          itemId: widget.id,
          quantity: "1",
        })),
        StockUnavailable,
      )

      const completed = yield* inventory.completeTransfer({
        principal,
        tenantId,
        transferId: transfer.id,
      })
      assert.strictEqual(completed.status, "completed")
      assert.ok(completed.confirmedAt)
      assert.ok(completed.completedAt)

      yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: destination.id,
        itemId: widget.id,
        quantity: "4",
      })
      yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: destination.id,
        itemId: cable.id,
        quantity: "3",
      })
    })))

  it.effect("rejects transfers across legal entities", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      const source = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        name: "Source",
      })
      const destination = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId: "legal-entity-b",
        name: "Destination",
      })

      const error = yield* Effect.flip(inventory.createTransfer({
        principal,
        tenantId,
        sourceWarehouseId: source.id,
        destinationWarehouseId: destination.id,
        lines: [{ itemId: "item-1", quantity: "1" }],
      }))

      assert.instanceOf(error, StockTransferDifferentLegalEntity)
    })))

  it.effect("requires a capability to confirm a transfer", () =>
    withInventory(
      Effect.gen(function* () {
        const inventory = yield* InventoryService
        const source = yield* inventory.createWarehouse({
          principal,
          tenantId,
          legalEntityId,
          name: "Source",
        })
        const destination = yield* inventory.createWarehouse({
          principal,
          tenantId,
          legalEntityId,
          name: "Destination",
        })
        const item = yield* inventory.createItem({
          principal,
          tenantId,
          sku: "sku-1",
          name: "Widget",
        })
        const transfer = yield* inventory.createTransfer({
          principal,
          tenantId,
          sourceWarehouseId: source.id,
          destinationWarehouseId: destination.id,
          lines: [{ itemId: item.id, quantity: "1" }],
        })
        const error = yield* Effect.flip(inventory.confirmTransfer({
          principal,
          tenantId,
          transferId: transfer.id,
        }))
        assert.instanceOf(error, AuthorizationDenied)
      }),
      capabilities.filter((capability) => capability !== "inventory.stock.transfer.confirm"),
    ))

  it.effect("requires a separate capability to complete a transfer", () =>
    withInventory(
      Effect.gen(function* () {
        const inventory = yield* InventoryService
        const source = yield* inventory.createWarehouse({
          principal,
          tenantId,
          legalEntityId,
          name: "Source",
        })
        const destination = yield* inventory.createWarehouse({
          principal,
          tenantId,
          legalEntityId,
          name: "Destination",
        })
        const item = yield* inventory.createItem({
          principal,
          tenantId,
          sku: "sku-1",
          name: "Widget",
        })
        yield* inventory.receiveStock({
          principal,
          tenantId,
          warehouseId: source.id,
          itemId: item.id,
          quantity: "1",
        })
        const transfer = yield* inventory.createTransfer({
          principal,
          tenantId,
          sourceWarehouseId: source.id,
          destinationWarehouseId: destination.id,
          lines: [{ itemId: item.id, quantity: "1" }],
        })
        yield* inventory.confirmTransfer({ principal, tenantId, transferId: transfer.id })
        const error = yield* Effect.flip(inventory.completeTransfer({
          principal,
          tenantId,
          transferId: transfer.id,
        }))
        assert.instanceOf(error, AuthorizationDenied)
      }),
      capabilities.filter((capability) => capability !== "inventory.stock.transfer.complete"),
    ))
})
