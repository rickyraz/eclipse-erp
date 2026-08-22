import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  InventoryCapabilities,
  InventoryService,
  makeInventoryTestLayer,
} from "../../inventory/mod.ts"
import { makeMessagingTestLayer } from "../../messaging/mod.ts"
import { makePartyTestLayer, PartyCapabilities, PartyService } from "../../party/mod.ts"
import {
  makeProcurementTestLayer,
  ProcurementCapabilities,
  ProcurementService,
  PurchaseOrder,
  PurchaseOrderConfirmationIdempotencyConflict,
  PurchaseOrderHasReceipts,
  PurchaseOrderInvalidState,
  PurchaseOrderLineSnapshot,
  PurchaseOrderNotFound,
  PurchaseReceiptQuantityExceeded,
  SupplierAccountAlreadyExists,
  SupplierAccountNotFound,
  SupplierRelationshipNotEligible,
} from "../mod.ts"

const principal = { userAccountId: "procurement-admin", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const otherTenantId = "00000000-0000-4000-8000-000000000002"
const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.partyRoleAssign,
  PartyCapabilities.partyRelationshipCreate,
  PartyCapabilities.partyRelationshipRead,
  ProcurementCapabilities.supplierAccountCreate,
  ProcurementCapabilities.purchaseOrderCreate,
  ProcurementCapabilities.purchaseOrderConfirm,
  ProcurementCapabilities.purchaseOrderRead,
  ProcurementCapabilities.purchaseOrderCancel,
  ProcurementCapabilities.purchaseReceiptReceive,
  InventoryCapabilities.warehouseCreate,
  InventoryCapabilities.itemCreate,
  InventoryCapabilities.stockReceive,
] as const

const withProcurement = <A, E>(
  program: Effect.Effect<A, E, PartyService | ProcurementService | InventoryService>,
  granted: ReadonlyArray<(typeof capabilities)[number]> = capabilities,
) => {
  const authorization = makeAuthorizationTestLayer(
    [tenantId, otherTenantId].flatMap((tenantId) =>
      granted.map((capability) => ({
        userAccountId: principal.userAccountId,
        tenantId,
        capability,
      }))
    ),
  )
  const party = makePartyTestLayer().pipe(Layer.provide(authorization))
  const procurement = makeProcurementTestLayer().pipe(
    Layer.provide(Layer.merge(authorization, party)),
  )
  const inventory = makeInventoryTestLayer().pipe(
    Layer.provide(Layer.merge(authorization, makeMessagingTestLayer())),
  )
  return Effect.provide(program, Layer.mergeAll(party, procurement, inventory))
}

const createRelationship = (kind: "supplier" | "customer") =>
  Effect.gen(function* () {
    const party = yield* PartyService
    const owner = yield* party.create({
      principal,
      tenantId,
      kind: "organization",
      name: "Buying Legal Entity",
    })
    const legalEntity = yield* party.createLegalEntity({
      principal,
      tenantId,
      organizationId: owner.id,
    })
    const counterparty = yield* party.create({
      principal,
      tenantId,
      kind: "organization",
      name: `${kind} counterparty`,
    })
    yield* party.assignRole({
      principal,
      tenantId,
      partyId: counterparty.id,
      role: kind,
    })
    return yield* party.createRelationship({
      principal,
      tenantId,
      partyId: counterparty.id,
      legalEntityId: legalEntity.id,
      kind,
    })
  })

const createSupplierAccount = Effect.gen(function* () {
  const procurement = yield* ProcurementService
  const relationship = yield* createRelationship("supplier")
  return yield* procurement.createSupplierAccount({
    principal,
    tenantId,
    supplierRelationshipId: relationship.id,
  })
})

const createPurchaseOrder = Effect.gen(function* () {
  const procurement = yield* ProcurementService
  const supplierAccount = yield* createSupplierAccount
  return yield* procurement.createPurchaseOrder({
    principal,
    tenantId,
    supplierAccountId: supplierAccount.id,
    lines: [{
      itemId: "00000000-0000-4000-8000-000000000010",
      quantity: "2",
      unitPrice: "12.50",
    }],
  })
})

describe("procurement contract", () => {
  it.effect("creates one supplier account for an active supplier relationship", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const relationship = yield* createRelationship("supplier")
      const input = {
        principal,
        tenantId,
        supplierRelationshipId: relationship.id,
      }
      const account = yield* procurement.createSupplierAccount(input)

      assert.strictEqual(account.tenantId, tenantId)
      assert.strictEqual(account.supplierRelationshipId, relationship.id)
      assert.strictEqual(account.partyId, relationship.partyId)
      assert.strictEqual(account.legalEntityId, relationship.legalEntityId)
      assert.instanceOf(
        yield* Effect.flip(procurement.createSupplierAccount(input)),
        SupplierAccountAlreadyExists,
      )
    })))

  it.effect("rejects missing or non-supplier relationships", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const customerRelationship = yield* createRelationship("customer")

      assert.instanceOf(
        yield* Effect.flip(procurement.createSupplierAccount({
          principal,
          tenantId,
          supplierRelationshipId: customerRelationship.id,
        })),
        SupplierRelationshipNotEligible,
      )
      assert.instanceOf(
        yield* Effect.flip(procurement.createSupplierAccount({
          principal,
          tenantId,
          supplierRelationshipId: "00000000-0000-4000-8000-000000000099",
        })),
        SupplierRelationshipNotEligible,
      )
    })))

  it.effect("creates a draft purchase order with an exact derived total", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const supplierAccount = yield* createSupplierAccount
      const lines = [
        {
          itemId: "00000000-0000-4000-8000-000000000010",
          quantity: "3",
          unitPrice: "12.34",
        },
        {
          itemId: "00000000-0000-4000-8000-000000000011",
          quantity: "2",
          unitPrice: "0.01",
        },
      ]
      const order = yield* procurement.createPurchaseOrder({
        principal,
        tenantId,
        supplierAccountId: supplierAccount.id,
        lines,
      })

      assert.strictEqual(order.status, "draft")
      assert.strictEqual(order.total, "37.04")
      for (const line of order.lines) {
        yield* Schema.decodeUnknownEffect(PurchaseOrderLineSnapshot)(line)
      }
      assert.deepStrictEqual(
        order.lines.map(({ id: _id, ...line }) => line),
        lines,
      )
    })))

  it.effect("reads draft and confirmed purchase orders", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const draft = yield* createPurchaseOrder
      const readDraft = yield* procurement.getPurchaseOrder({
        principal,
        tenantId,
        purchaseOrderId: draft.id,
      })
      assert.strictEqual(readDraft.status, "draft")
      assert.isNull(readDraft.confirmedAt)
      assert.strictEqual(
        (yield* Effect.flip(
          Schema.decodeUnknownEffect(PurchaseOrder)({
            ...readDraft,
            status: "confirmed",
          }),
        ))._tag,
        "SchemaError",
      )

      const confirmed = yield* procurement.confirmPurchaseOrder({
        principal,
        tenantId,
        purchaseOrderId: draft.id,
        idempotencyKey: "confirm-purchase-order",
      })
      const readConfirmed = yield* procurement.getPurchaseOrder({
        principal,
        tenantId,
        purchaseOrderId: draft.id,
      })
      assert.strictEqual(confirmed.status, "confirmed")
      assert.isNotNull(confirmed.confirmedAt)
      assert.deepStrictEqual(readConfirmed, confirmed)
    })))

  it.effect("replays the same confirmation key and rejects a different key", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const order = yield* createPurchaseOrder
      const input = {
        principal,
        tenantId,
        purchaseOrderId: order.id,
        idempotencyKey: "confirm-same-key",
      }
      const confirmed = yield* procurement.confirmPurchaseOrder(input)
      const replayed = yield* procurement.confirmPurchaseOrder(input)
      assert.deepStrictEqual(replayed, confirmed)
      assert.isFalse("confirmationIdempotencyKey" in confirmed)
      assert.instanceOf(
        yield* Effect.flip(procurement.confirmPurchaseOrder({
          ...input,
          idempotencyKey: "confirm-different-key",
        })),
        PurchaseOrderConfirmationIdempotencyConflict,
      )
      const otherOrder = yield* createPurchaseOrder
      assert.instanceOf(
        yield* Effect.flip(procurement.confirmPurchaseOrder({
          ...input,
          purchaseOrderId: otherOrder.id,
        })),
        PurchaseOrderConfirmationIdempotencyConflict,
      )
      assert.strictEqual(
        (yield* Effect.flip(procurement.confirmPurchaseOrder({
          ...input,
          idempotencyKey: "   ",
        })))._tag,
        "SchemaError",
      )
    })))

  it.effect("cancels a confirmed purchase order idempotently and preserves its snapshot", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const draft = yield* createPurchaseOrder
      assert.instanceOf(
        yield* Effect.flip(procurement.cancelPurchaseOrder({
          principal,
          tenantId,
          purchaseOrderId: draft.id,
        })),
        PurchaseOrderInvalidState,
      )

      const confirmationInput = {
        principal,
        tenantId,
        purchaseOrderId: draft.id,
        idempotencyKey: "confirm-before-cancellation",
      }
      const confirmed = yield* procurement.confirmPurchaseOrder(confirmationInput)
      const cancelled = yield* procurement.cancelPurchaseOrder({
        principal,
        tenantId,
        purchaseOrderId: draft.id,
      })
      const replayed = yield* procurement.cancelPurchaseOrder({
        principal,
        tenantId,
        purchaseOrderId: draft.id,
      })
      assert.strictEqual(cancelled.status, "cancelled")
      assert.strictEqual(cancelled.confirmedAt, confirmed.confirmedAt)
      assert.strictEqual(cancelled.supplierAccountId, confirmed.supplierAccountId)
      assert.strictEqual(cancelled.total, confirmed.total)
      assert.deepStrictEqual(cancelled.lines, confirmed.lines)
      assert.deepStrictEqual(
        cancelled.lines.map((line) => line.id),
        confirmed.lines.map((line) => line.id),
      )
      assert.deepStrictEqual(replayed, cancelled)
      assert.deepStrictEqual(
        yield* procurement.getPurchaseOrder({
          principal,
          tenantId,
          purchaseOrderId: draft.id,
        }),
        cancelled,
      )
      assert.instanceOf(
        yield* Effect.flip(procurement.confirmPurchaseOrder(confirmationInput)),
        PurchaseOrderInvalidState,
      )
      assert.strictEqual(
        (yield* Effect.flip(
          Schema.decodeUnknownEffect(PurchaseOrder)({
            ...cancelled,
            confirmedAt: null,
          }),
        ))._tag,
        "SchemaError",
      )
    })))

  it.effect("maps missing and cross-tenant purchase orders to not found", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const order = yield* createPurchaseOrder
      for (
        const input of [
          { tenantId, purchaseOrderId: "00000000-0000-4000-8000-000000000099" },
          { tenantId: otherTenantId, purchaseOrderId: order.id },
        ]
      ) {
        assert.instanceOf(
          yield* Effect.flip(procurement.getPurchaseOrder({ principal, ...input })),
          PurchaseOrderNotFound,
        )
        assert.instanceOf(
          yield* Effect.flip(procurement.confirmPurchaseOrder({
            principal,
            ...input,
            idempotencyKey: "missing-confirmation",
          })),
          PurchaseOrderNotFound,
        )
        assert.instanceOf(
          yield* Effect.flip(procurement.cancelPurchaseOrder({ principal, ...input })),
          PurchaseOrderNotFound,
        )
      }
    })))

  it.effect("denies purchase order confirmation and reads without their capabilities", () =>
    withProcurement(
      Effect.gen(function* () {
        const procurement = yield* ProcurementService
        const order = yield* createPurchaseOrder
        assert.instanceOf(
          yield* Effect.flip(procurement.confirmPurchaseOrder({
            principal,
            tenantId,
            purchaseOrderId: order.id,
            idempotencyKey: "denied-confirmation",
          })),
          AuthorizationDenied,
        )
      }),
      capabilities.filter((capability) =>
        capability !== ProcurementCapabilities.purchaseOrderConfirm
      ),
    ).pipe(
      Effect.andThen(
        withProcurement(
          Effect.gen(function* () {
            const procurement = yield* ProcurementService
            const order = yield* createPurchaseOrder
            assert.instanceOf(
              yield* Effect.flip(procurement.getPurchaseOrder({
                principal,
                tenantId,
                purchaseOrderId: order.id,
              })),
              AuthorizationDenied,
            )
          }),
          capabilities.filter((capability) =>
            capability !== ProcurementCapabilities.purchaseOrderRead
          ),
        ),
      ),
    ))

  it.effect("denies purchase order cancellation without its capability", () =>
    withProcurement(
      Effect.gen(function* () {
        const procurement = yield* ProcurementService
        const order = yield* createPurchaseOrder
        yield* procurement.confirmPurchaseOrder({
          principal,
          tenantId,
          purchaseOrderId: order.id,
          idempotencyKey: "confirm-before-denied-cancellation",
        })
        assert.instanceOf(
          yield* Effect.flip(procurement.cancelPurchaseOrder({
            principal,
            tenantId,
            purchaseOrderId: order.id,
          })),
          AuthorizationDenied,
        )
      }),
      capabilities.filter((capability) =>
        capability !== ProcurementCapabilities.purchaseOrderCancel
      ),
    ))

  it.effect("maps a missing supplier account", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      assert.instanceOf(
        yield* Effect.flip(procurement.createPurchaseOrder({
          principal,
          tenantId,
          supplierAccountId: "00000000-0000-4000-8000-000000000099",
          lines: [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "1",
            unitPrice: "1.00",
          }],
        })),
        SupplierAccountNotFound,
      )
    })))

  it.effect("validates purchase order lines and derived totals", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const supplierAccount = yield* createSupplierAccount
      const create = (lines: ReadonlyArray<unknown>) =>
        procurement.createPurchaseOrder({
          principal,
          tenantId,
          supplierAccountId: supplierAccount.id,
          lines,
        })

      for (
        const lines of [
          [],
          [{ itemId: "not-a-uuid", quantity: "1", unitPrice: "1.00" }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "0",
            unitPrice: "1.00",
          }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "1",
            unitPrice: "-1.00",
          }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "9223372036854775808",
            unitPrice: "0.00",
          }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "9223372036854775807",
            unitPrice: "999999999999999999.99",
          }],
        ]
      ) {
        assert.instanceOf(yield* Effect.flip(create(lines)), Schema.SchemaError)
      }

      const callerLineId = "00000000-0000-4000-8000-000000000099"
      const order = yield* create([{
        id: callerLineId,
        itemId: "00000000-0000-4000-8000-000000000010",
        quantity: "1",
        unitPrice: "1.00",
      }])
      assert.notStrictEqual(order.lines[0]?.id, callerLineId)
    })))

  it.effect("denies purchase order creation by default", () =>
    withProcurement(
      Effect.gen(function* () {
        const procurement = yield* ProcurementService
        const supplierAccount = yield* createSupplierAccount
        assert.instanceOf(
          yield* Effect.flip(procurement.createPurchaseOrder({
            principal,
            tenantId,
            supplierAccountId: supplierAccount.id,
            lines: [{
              itemId: "00000000-0000-4000-8000-000000000010",
              quantity: "1",
              unitPrice: "1.00",
            }],
          })),
          AuthorizationDenied,
        )
      }),
      capabilities.filter((capability) =>
        capability !== ProcurementCapabilities.purchaseOrderCreate
      ),
    ))

  it.effect("requires both procurement creation and Party relationship-read authority", () =>
    withProcurement(
      Effect.gen(function* () {
        const procurement = yield* ProcurementService
        const relationship = yield* createRelationship("supplier")
        assert.instanceOf(
          yield* Effect.flip(procurement.createSupplierAccount({
            principal,
            tenantId,
            supplierRelationshipId: relationship.id,
          })),
          AuthorizationDenied,
        )
      }),
      capabilities.filter((capability) =>
        capability !== ProcurementCapabilities.supplierAccountCreate
      ),
    ).pipe(
      Effect.andThen(
        withProcurement(
          Effect.gen(function* () {
            const procurement = yield* ProcurementService
            const relationship = yield* createRelationship("supplier")
            assert.instanceOf(
              yield* Effect.flip(procurement.createSupplierAccount({
                principal,
                tenantId,
                supplierRelationshipId: relationship.id,
              })),
              AuthorizationDenied,
            )
          }),
          capabilities.filter((capability) =>
            capability !== PartyCapabilities.partyRelationshipRead
          ),
        ),
      ),
    ))

  it.effect("receives a confirmed purchase order idempotently and blocks over-receipt cancellation", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const inventory = yield* InventoryService
      const supplierAccount = yield* createSupplierAccount
      const warehouse = yield* inventory.createWarehouse({
        principal,
        tenantId,
        legalEntityId: supplierAccount.legalEntityId,
        name: "Receiving Warehouse",
      })
      const item = yield* inventory.createItem({
        principal,
        tenantId,
        sku: "receipt-item",
        name: "Receipt Item",
      })
      const order = yield* procurement.createPurchaseOrder({
        principal,
        tenantId,
        supplierAccountId: supplierAccount.id,
        lines: [{ itemId: item.id, quantity: "3", unitPrice: "1.00" }],
      })
      const confirmed = yield* procurement.confirmPurchaseOrder({
        principal,
        tenantId,
        purchaseOrderId: order.id,
        idempotencyKey: "receipt-confirmation",
      })
      const lineId = confirmed.lines[0]!.id
      const firstInput = {
        principal,
        tenantId,
        purchaseOrderId: confirmed.id,
        warehouseId: warehouse.id,
        idempotencyKey: "receipt-1",
        lines: [{ purchaseOrderLineId: lineId, quantity: "1" }],
      }
      const first = yield* procurement.receivePurchaseOrder(firstInput)
      const replay = yield* procurement.receivePurchaseOrder(firstInput)
      assert.strictEqual(replay.id, first.id)
      assert.strictEqual(replay.lines[0]?.quantity, "1")

      const second = yield* procurement.receivePurchaseOrder({
        ...firstInput,
        idempotencyKey: "receipt-2",
        lines: [{ purchaseOrderLineId: lineId, quantity: "2" }],
      })
      assert.strictEqual(second.lines[0]?.quantity, "2")
      assert.instanceOf(
        yield* Effect.flip(procurement.receivePurchaseOrder({
          ...firstInput,
          idempotencyKey: "receipt-3",
        })),
        PurchaseReceiptQuantityExceeded,
      )
      assert.instanceOf(
        yield* Effect.flip(procurement.cancelPurchaseOrder({
          principal,
          tenantId,
          purchaseOrderId: confirmed.id,
        })),
        PurchaseOrderHasReceipts,
      )
    })))
})
