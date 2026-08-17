import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  AccountingFinancialOperationPostAction,
  AccountingRevenuePostAction,
  AccountingRevenuePostedEvent,
  AccountingTypedActionCatalog,
  AccountingTypedEventCatalog,
  CreateFinancialJournalIntentInput,
  FinancialOperation,
  JournalEntry,
  PostRevenueForOrderInput,
  RevenuePostedEventPayload,
} from "../../accounting/mod.ts"
import { getCapabilityDefinition, isKnownCapability } from "../../authorization/mod.ts"
import { type DomainActionCatalogEntry, type DomainEventCatalogEntry } from "../mod.ts"
import {
  AdjustStockInput,
  InventoryAdjustStockAction,
  InventoryStockCorrectedEvent,
  InventoryTypedActionCatalog,
  InventoryTypedEventCatalog,
  StockCorrectedEventPayload,
  StockCorrection,
} from "../../inventory/mod.ts"
import {
  OrderCancellationCompletedEventPayload,
  OrderConfirmationCompletedEventPayload,
  OrderFulfillmentCompletedEventPayload,
  ProcessOrderCancellationCompletedEvent,
  ProcessOrderConfirmationCompletedEvent,
  ProcessOrderFulfillmentCompletedEvent,
  ProcessTypedEventCatalog,
} from "../../process/mod.ts"
import {
  ConfirmOrderInput,
  SalesConfirmOrderAction,
  SalesOrder,
  SalesOrderConfirmedEvent,
  SalesOrderConfirmedEventPayload,
  SalesTypedActionCatalog,
  SalesTypedEventCatalog,
} from "../../sales/mod.ts"

const actions: ReadonlyArray<DomainActionCatalogEntry> = [
  ...InventoryTypedActionCatalog,
  ...AccountingTypedActionCatalog,
  ...SalesTypedActionCatalog,
]
const events: ReadonlyArray<DomainEventCatalogEntry> = [
  ...InventoryTypedEventCatalog,
  ...AccountingTypedEventCatalog,
  ...SalesTypedEventCatalog,
  ...ProcessTypedEventCatalog,
]

const assertCompatibleVersion = (entry: DomainActionCatalogEntry | DomainEventCatalogEntry) => {
  assert.ok(Number.isInteger(entry.version))
  assert.ok(Number.isInteger(entry.compatibilityRange.minimumVersion))
  assert.ok(Number.isInteger(entry.compatibilityRange.maximumVersion))
  assert.ok(entry.version > 0)
  assert.ok(entry.compatibilityRange.minimumVersion > 0)
  assert.ok(entry.compatibilityRange.minimumVersion <= entry.version)
  assert.ok(entry.compatibilityRange.maximumVersion >= entry.version)
  assert.ok(entry.compatibilityRange.maximumVersion <= 2_147_483_647)
}

const assertPayloadFields = (
  event: DomainEventCatalogEntry,
  payloadFields: Readonly<Record<string, unknown>>,
) => {
  for (const field of event.filterableFields) {
    assert.ok(field in payloadFields)
  }
}

describe("catalog compatibility", () => {
  it.effect("keeps identities, capability metadata, and schemas compatible", () =>
    Effect.gen(function* () {
      const identities = [...actions, ...events].map((entry) => `${entry.id}@${entry.version}`)
      assert.strictEqual(new Set(identities).size, identities.length)

      for (const entry of [...actions, ...events]) {
        assertCompatibleVersion(entry)
        assert.ok(/\S/.test(entry.id))
        assert.ok(/\S/.test(entry.owningDomain))
        assert.ok(/\S/.test(entry.title))
        assert.ok(/\S/.test(entry.description))
        assert.ok(entry.scope.length > 0)
        assert.strictEqual(new Set(entry.scope).size, entry.scope.length)
      }

      for (const action of actions) {
        assert.ok(Number.isInteger(action.timeoutPolicy.timeoutMs))
        assert.ok(action.timeoutPolicy.timeoutMs > 0)
        assert.ok(Number.isInteger(action.retryPolicy.maxAttempts))
        assert.ok(action.retryPolicy.maxAttempts > 0)
        assert.ok(action.preconditions.length > 0)
        assert.strictEqual(new Set(action.preconditions).size, action.preconditions.length)
        assert.ok(action.effects.length > 0)
        assert.strictEqual(new Set(action.effects).size, action.effects.length)
        assert.ok(action.errorSchemas.length > 0)
        assert.strictEqual(new Set(action.errorSchemas).size, action.errorSchemas.length)
        assert.ok(action.preconditions.includes("authorized"))
        if (action.idempotency === "required") {
          assert.ok(action.preconditions.includes("idempotency_key_stable"))
        }
        assert.ok(isKnownCapability(action.requiredCapability))
        const capability = getCapabilityDefinition(action.requiredCapability)
        assert.ok(capability)
        assert.strictEqual(action.id, action.requiredCapability)
        assert.strictEqual(action.owningDomain, capability.owner)
        assert.strictEqual(action.version, capability.version)
        assert.strictEqual(action.stability, capability.stability)
        assert.deepStrictEqual(action.scope, capability.scope)
      }

      for (const event of events) {
        assert.ok(event.id.startsWith(`${event.owningDomain}.`))
        assert.ok(/\S/.test(event.aggregateType))
        assert.ok(event.correlationFields.length > 0)
        assert.strictEqual(new Set(event.correlationFields).size, event.correlationFields.length)
        assert.strictEqual(new Set(event.filterableFields).size, event.filterableFields.length)
        for (const field of event.correlationFields) {
          assert.ok(event.filterableFields.includes(field))
        }
        assert.strictEqual(event.deliveryExpectation, "at_least_once")
        assert.strictEqual(event.sensitivity, "business_internal_minimized")
      }

      assert.strictEqual(InventoryAdjustStockAction.inputSchema, AdjustStockInput)
      assert.strictEqual(InventoryAdjustStockAction.outputSchema, StockCorrection)
      assert.strictEqual(AccountingTypedActionCatalog.length, 2)
      assert.strictEqual(
        AccountingFinancialOperationPostAction.inputSchema,
        CreateFinancialJournalIntentInput,
      )
      assert.strictEqual(AccountingFinancialOperationPostAction.outputSchema, FinancialOperation)
      assert.strictEqual(AccountingRevenuePostAction.inputSchema, PostRevenueForOrderInput)
      assert.strictEqual(AccountingRevenuePostAction.outputSchema, JournalEntry)
      assert.strictEqual(AccountingRevenuePostAction.idempotency, "inherent")
      assert.isFalse(
        (AccountingRevenuePostAction.preconditions as readonly string[]).includes(
          "idempotency_key_stable",
        ),
      )
      assert.strictEqual(SalesConfirmOrderAction.inputSchema, ConfirmOrderInput)
      assert.strictEqual(SalesConfirmOrderAction.outputSchema, SalesOrder)
      assert.strictEqual(InventoryStockCorrectedEvent.payloadSchema, StockCorrectedEventPayload)
      assert.strictEqual(AccountingRevenuePostedEvent.payloadSchema, RevenuePostedEventPayload)
      assert.strictEqual(SalesOrderConfirmedEvent.payloadSchema, SalesOrderConfirmedEventPayload)
      assert.strictEqual(
        ProcessOrderConfirmationCompletedEvent.payloadSchema,
        OrderConfirmationCompletedEventPayload,
      )
      assert.strictEqual(
        ProcessOrderCancellationCompletedEvent.payloadSchema,
        OrderCancellationCompletedEventPayload,
      )
      assert.strictEqual(
        ProcessOrderFulfillmentCompletedEvent.payloadSchema,
        OrderFulfillmentCompletedEventPayload,
      )
      assertPayloadFields(InventoryStockCorrectedEvent, StockCorrectedEventPayload.fields)
      assertPayloadFields(AccountingRevenuePostedEvent, RevenuePostedEventPayload.fields)
      assertPayloadFields(SalesOrderConfirmedEvent, SalesOrderConfirmedEventPayload.fields)
      assertPayloadFields(
        ProcessOrderConfirmationCompletedEvent,
        ProcessOrderConfirmationCompletedEvent.payloadSchema.fields,
      )
      assertPayloadFields(
        ProcessOrderCancellationCompletedEvent,
        ProcessOrderCancellationCompletedEvent.payloadSchema.fields,
      )
      assertPayloadFields(
        ProcessOrderFulfillmentCompletedEvent,
        ProcessOrderFulfillmentCompletedEvent.payloadSchema.fields,
      )
      assert.strictEqual(AccountingRevenuePostedEvent.stability, "PUBLIC")

      const principal = { userAccountId: "user-1", sessionId: "session-1" }

      yield* Schema.decodeUnknownEffect(InventoryAdjustStockAction.inputSchema)({
        principal,
        tenantId: "tenant-1",
        warehouseId: "warehouse-1",
        itemId: "item-1",
        adjustment: "-2",
        unitOfMeasure: "EA",
        reason: "cycle count",
        commandId: "command-1",
        correlationId: "correlation-1",
        causationId: null,
        idempotencyKey: "correction-1",
      })
      yield* Schema.decodeUnknownEffect(InventoryAdjustStockAction.outputSchema)({
        id: "correction-1",
        tenantId: "tenant-1",
        warehouseId: "warehouse-1",
        itemId: "item-1",
        adjustment: "-2",
        unitOfMeasure: "EA",
        reason: "cycle count",
        idempotencyKey: "correction-1",
      })
      yield* Schema.decodeUnknownEffect(InventoryAdjustStockAction.errorSchemas[2]!)({
        _tag: "StockCorrectionIdempotencyConflict",
        tenantId: "tenant-1",
        idempotencyKey: "correction-1",
      })

      yield* Schema.decodeUnknownEffect(SalesConfirmOrderAction.inputSchema)({
        principal,
        tenantId: "tenant-1",
        orderId: "order-1",
        commandId: "command-1",
        correlationId: "correlation-1",
        causationId: null,
        idempotencyKey: "confirmation-1",
      })
      yield* Schema.decodeUnknownEffect(SalesConfirmOrderAction.outputSchema)({
        id: "order-1",
        tenantId: "tenant-1",
        customerId: "customer-1",
        quotationId: null,
        status: "confirmed",
        confirmedAt: "2026-08-12T00:00:00.000Z",
        total: "10.00",
        lines: [{ itemId: "item-1", quantity: "1", unitPrice: "10.00" }],
      })

      yield* Schema.decodeUnknownEffect(InventoryStockCorrectedEvent.payloadSchema)({
        correctionId: "00000000-0000-4000-8000-000000000001",
        warehouseId: "00000000-0000-4000-8000-000000000002",
        itemId: "00000000-0000-4000-8000-000000000003",
      })
      yield* Schema.decodeUnknownEffect(AccountingRevenuePostedEvent.payloadSchema)({
        journalId: "00000000-0000-4000-8000-000000000004",
        legalEntityId: "00000000-0000-4000-8000-000000000005",
        orderId: "00000000-0000-4000-8000-000000000006",
      })
      yield* Schema.decodeUnknownEffect(SalesOrderConfirmedEvent.payloadSchema)({
        orderId: "00000000-0000-4000-8000-000000000006",
        total: "10.00",
      })
    }))
})
