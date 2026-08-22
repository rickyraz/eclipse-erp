import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { DatabaseFailure } from "../../kernel/mod.ts"
import {
  type EventEnvelope,
  makeMessagingTestLayer,
  MessagingService,
} from "../../messaging/mod.ts"
import {
  InventoryCapabilities,
  InventoryService,
  InventoryUnitOfMeasureMismatch,
  InventoryWarehouseLegalEntityMismatch,
  makeInventoryTestLayer,
  StockCorrectionIdempotencyConflict,
  StockReservationIdempotencyConflict,
  StockReservationInvalidState,
  StockReservationLegalEntityMismatch,
  StockTransferDifferentLegalEntity,
  StockTransferInvalidState,
  StockUnavailable,
} from "../mod.ts"

const principal = { userAccountId: "keeper", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const legalEntityId = "00000000-0000-4000-8000-000000000010"
const correctionMetadata = {
  commandId: "inventory-command-1",
  correlationId: "inventory-correlation-1",
  causationId: null,
} as const
const capabilities = [
  InventoryCapabilities.warehouseCreate,
  InventoryCapabilities.itemCreate,
  InventoryCapabilities.stockReceive,
  InventoryCapabilities.stockAdjust,
  InventoryCapabilities.stockReserve,
  InventoryCapabilities.stockRelease,
  InventoryCapabilities.stockFulfill,
  InventoryCapabilities.stockTransferCreate,
  InventoryCapabilities.stockTransferConfirm,
  InventoryCapabilities.stockTransferComplete,
] as const
const withInventory = <A, E>(
  program: Effect.Effect<A, E, InventoryService>,
  grantedCapabilities: readonly string[] = capabilities,
  messaging = makeMessagingTestLayer(),
) =>
  Effect.provide(
    program,
    makeInventoryTestLayer().pipe(
      Layer.provide(Layer.merge(
        makeAuthorizationTestLayer(
          grantedCapabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId,
            capability: capability as (typeof capabilities)[number],
          })),
        ),
        messaging,
      )),
    ),
  )

const makeRecordingMessagingLayer = (events: EventEnvelope[]) =>
  Layer.effect(
    MessagingService,
    Effect.map(MessagingService, (messaging) => ({
      ...messaging,
      append: (input: unknown) =>
        messaging.append(input).pipe(
          Effect.tap((event) => Effect.sync(() => events.push(event))),
        ),
    })),
  ).pipe(Layer.provide(makeMessagingTestLayer()))

const makeFailOnceMessagingLayer = () => {
  let fail = true
  return Layer.effect(
    MessagingService,
    Effect.map(MessagingService, (messaging) => ({
      ...messaging,
      append: (input: unknown) => {
        if (fail) {
          fail = false
          return Effect.fail(
            new DatabaseFailure({ operation: "messaging.test.append", cause: null }),
          )
        }
        return messaging.append(input)
      },
    })),
  ).pipe(Layer.provide(makeMessagingTestLayer()))
}

describe("inventory contract", () => {
  it.effect("denies inventory capability in an ungranted tenant", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      assert.instanceOf(
        yield* Effect.flip(inventory.createWarehouse({
          principal,
          tenantId: "00000000-0000-4000-8000-000000000003",
          legalEntityId,
          name: "Untrusted Warehouse",
        })),
        AuthorizationDenied,
      )
    })))

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
      assert.instanceOf(
        yield* Effect.flip(inventory.reserveStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          legalEntityId: "legal-entity-b",
          itemId: item.id,
          quantity: "1",
        })),
        StockReservationLegalEntityMismatch,
      )
      const reservation = yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "4",
        idempotencyKey: "reservation-1",
      })
      const repeated = yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "4",
        idempotencyKey: "reservation-1",
      })

      assert.strictEqual(item.unitOfMeasure, "EA")
      assert.strictEqual(balance.onHand, "10")
      assert.strictEqual(balance.unitOfMeasure, "EA")
      assert.strictEqual(reservation.quantity, "4")
      assert.strictEqual(reservation.idempotencyKey, "reservation-1")
      assert.strictEqual(reservation.id, repeated.id)
    })))

  it.effect("validates receive warehouse legal entity when supplied", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      const warehouse = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId,
        name: "Scoped Receipt",
      })
      const item = yield* inventory.createItem({
        principal,
        tenantId,
        sku: "scoped-receipt",
        name: "Scoped Receipt Item",
      })

      assert.instanceOf(
        yield* Effect.flip(inventory.receiveStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          quantity: "1",
          legalEntityId: "00000000-0000-4000-8000-000000000099",
        })),
        InventoryWarehouseLegalEntityMismatch,
      )
      const balance = yield* inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "2",
        legalEntityId,
        referenceId: crypto.randomUUID(),
      })
      assert.strictEqual(balance.onHand, "2")
    })))

  it.effect("applies normalized UOM corrections once and preserves reserved stock", () =>
    withInventory(Effect.gen(function* () {
      const inventory = yield* InventoryService
      const warehouse = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId,
        name: "Adjustments",
      })
      const item = yield* inventory.createItem({
        principal,
        tenantId,
        sku: "adjustment-item",
        name: "Adjustment Item",
        unitOfMeasure: "box",
      })
      assert.strictEqual(item.unitOfMeasure, "BOX")
      yield* inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "10",
      })
      yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "4",
      })
      const correction = yield* inventory.adjustStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        adjustment: "-6",
        unitOfMeasure: "box",
        reason: "  Count correction  ",
        ...correctionMetadata,
        idempotencyKey: " correction-1 ",
      })
      const repeated = yield* inventory.adjustStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        adjustment: "-6",
        unitOfMeasure: "BOX",
        reason: "Count correction",
        ...correctionMetadata,
        idempotencyKey: "correction-1",
      })
      assert.strictEqual(correction.id, repeated.id)
      assert.strictEqual(correction.unitOfMeasure, "BOX")
      assert.strictEqual(correction.reason, "Count correction")
      assert.instanceOf(
        yield* Effect.flip(inventory.adjustStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          adjustment: "-1",
          unitOfMeasure: "BOX",
          reason: "Below reservation",
          ...correctionMetadata,
          idempotencyKey: "correction-2",
        })),
        StockUnavailable,
      )
      assert.instanceOf(
        yield* Effect.flip(inventory.adjustStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          adjustment: "1",
          unitOfMeasure: "EA",
          reason: "Wrong unit",
          ...correctionMetadata,
          idempotencyKey: "correction-3",
        })),
        InventoryUnitOfMeasureMismatch,
      )
      assert.instanceOf(
        yield* Effect.flip(inventory.adjustStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          adjustment: "1",
          unitOfMeasure: "BOX",
          reason: "Changed payload",
          ...correctionMetadata,
          idempotencyKey: "correction-1",
        })),
        StockCorrectionIdempotencyConflict,
      )
    })))

  it.effect("stock corrected atomic publication preserves metadata and one event on retry", () => {
    const events: EventEnvelope[] = []
    return withInventory(
      Effect.gen(function* () {
        const inventory = yield* InventoryService
        const warehouse = yield* inventory.createWarehouse({
          principal,
          tenantId,
          legalEntityId,
          name: "Atomic Event",
        })
        const item = yield* inventory.createItem({
          principal,
          tenantId,
          sku: "atomic-event",
          name: "Atomic Event Item",
        })
        const input = {
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          adjustment: "5",
          unitOfMeasure: "EA",
          reason: "Cycle count",
          commandId: "stock-correction-command",
          correlationId: "stock-correction-correlation",
          causationId: "stock-count-requested",
          idempotencyKey: "stock-correction-idempotency",
        }
        const correction = yield* inventory.adjustStock(input)
        const retry = yield* inventory.adjustStock({
          ...input,
          commandId: "stock-correction-retry-command",
          correlationId: "stock-correction-retry-correlation",
        })

        assert.strictEqual(retry.id, correction.id)
        assert.strictEqual(events.length, 1)
        assert.notStrictEqual(events[0]?.eventId, correction.id)
        assert.deepStrictEqual(events[0], {
          eventId: events[0]!.eventId,
          eventType: "inventory.stock.corrected",
          eventVersion: 1,
          tenantId,
          aggregateType: "stock_correction",
          aggregateId: correction.id,
          commandId: input.commandId,
          correlationId: input.correlationId,
          causationId: input.causationId,
          idempotencyKey: input.idempotencyKey,
          actorPrincipalId: principal.userAccountId,
          occurredAt: events[0]!.occurredAt,
          payload: {
            correctionId: correction.id,
            warehouseId: warehouse.id,
            itemId: item.id,
          },
          publishedAt: null,
          attempts: 0,
        })
        assert.ok(Number.isFinite(new Date(events[0]!.occurredAt).getTime()))
      }),
      capabilities,
      makeRecordingMessagingLayer(events),
    )
  })

  it.effect("stock corrected atomic publication rolls back when messaging append fails", () =>
    withInventory(
      Effect.gen(function* () {
        const inventory = yield* InventoryService
        const warehouse = yield* inventory.createWarehouse({
          principal,
          tenantId,
          legalEntityId,
          name: "Atomic Rollback",
        })
        const item = yield* inventory.createItem({
          principal,
          tenantId,
          sku: "atomic-rollback",
          name: "Atomic Rollback Item",
        })
        const input = {
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          adjustment: "5",
          unitOfMeasure: "EA",
          reason: "Cycle count",
          ...correctionMetadata,
          idempotencyKey: "stock-correction-rollback",
        }

        assert.instanceOf(yield* Effect.flip(inventory.adjustStock(input)), DatabaseFailure)
        yield* inventory.adjustStock(input)
        yield* inventory.reserveStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          quantity: "5",
        })
        assert.instanceOf(
          yield* Effect.flip(inventory.reserveStock({
            principal,
            tenantId,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "1",
          })),
          StockUnavailable,
        )
      }),
      capabilities,
      makeFailOnceMessagingLayer(),
    ))

  it.effect("requires the stock adjustment capability", () =>
    withInventory(
      Effect.gen(function* () {
        const inventory = yield* InventoryService
        assert.instanceOf(
          yield* Effect.flip(inventory.adjustStock({
            principal,
            tenantId,
            warehouseId: "warehouse",
            itemId: "item",
            adjustment: "1",
            unitOfMeasure: "EA",
            reason: "Correction",
            ...correctionMetadata,
            idempotencyKey: "correction-denied",
          })),
          AuthorizationDenied,
        )
      }),
      capabilities.filter((capability) => capability !== InventoryCapabilities.stockAdjust),
    ))

  it.effect("releases and fulfills active reservations exactly once", () =>
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
        sku: "sku-terminal",
        name: "Widget",
      })
      yield* inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "10",
      })
      const released = yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "4",
      })
      assert.strictEqual(
        (yield* inventory.releaseReservation({
          principal,
          tenantId,
          reservationId: released.id,
        })).status,
        "released",
      )
      assert.strictEqual(
        (yield* inventory.releaseReservation({
          principal,
          tenantId,
          reservationId: released.id,
        })).id,
        released.id,
      )
      assert.instanceOf(
        yield* Effect.flip(inventory.fulfillReservation({
          principal,
          tenantId,
          reservationId: released.id,
        })),
        StockReservationInvalidState,
      )
      const allAvailable = yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "10",
      })
      yield* inventory.releaseReservation({
        principal,
        tenantId,
        reservationId: allAvailable.id,
      })

      const fulfilled = yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "4",
      })
      assert.strictEqual(
        (yield* inventory.fulfillReservation({
          principal,
          tenantId,
          reservationId: fulfilled.id,
        })).status,
        "fulfilled",
      )
      assert.strictEqual(
        (yield* inventory.fulfillReservation({
          principal,
          tenantId,
          reservationId: fulfilled.id,
        })).id,
        fulfilled.id,
      )
      assert.instanceOf(
        yield* Effect.flip(inventory.releaseReservation({
          principal,
          tenantId,
          reservationId: fulfilled.id,
        })),
        StockReservationInvalidState,
      )
      assert.instanceOf(
        yield* Effect.flip(inventory.reserveStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          quantity: "7",
        })),
        StockUnavailable,
      )
    })))

  it.effect("rejects an idempotency key reused for different stock", () =>
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
        sku: "sku-key",
        name: "Widget",
      })
      yield* inventory.receiveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "10",
      })
      yield* inventory.reserveStock({
        principal,
        tenantId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: "4",
        idempotencyKey: "reservation-conflict",
      })
      assert.instanceOf(
        yield* Effect.flip(inventory.reserveStock({
          principal,
          tenantId,
          warehouseId: warehouse.id,
          itemId: item.id,
          quantity: "5",
          idempotencyKey: "reservation-conflict",
        })),
        StockReservationIdempotencyConflict,
      )
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
      capabilities.filter((capability) =>
        capability !== InventoryCapabilities.stockTransferConfirm
      ),
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
      capabilities.filter((capability) =>
        capability !== InventoryCapabilities.stockTransferComplete
      ),
    ))
})
