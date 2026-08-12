import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  AccountingPostRevenueAction,
  AccountingRevenuePostedEvent,
  AccountingTypedActionCatalog,
  AccountingTypedEventCatalog,
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

const actions: ReadonlyArray<DomainActionCatalogEntry> = [
  ...InventoryTypedActionCatalog,
  ...AccountingTypedActionCatalog,
]
const events: ReadonlyArray<DomainEventCatalogEntry> = [
  ...InventoryTypedEventCatalog,
  ...AccountingTypedEventCatalog,
]

const assertCompatibleVersion = (entry: DomainActionCatalogEntry | DomainEventCatalogEntry) => {
  assert.ok(entry.version > 0)
  assert.ok(entry.compatibilityRange.minimumVersion > 0)
  assert.ok(entry.compatibilityRange.minimumVersion <= entry.version)
  assert.ok(entry.compatibilityRange.maximumVersion >= entry.version)
}

describe("catalog compatibility", () => {
  it.effect("keeps identities, capability metadata, and schemas compatible", () =>
    Effect.gen(function* () {
      const identities = [...actions, ...events].map((entry) => `${entry.id}@${entry.version}`)
      assert.strictEqual(new Set(identities).size, identities.length)

      for (const entry of [...actions, ...events]) assertCompatibleVersion(entry)

      for (const action of actions) {
        assert.ok(isKnownCapability(action.requiredCapability))
        const capability = getCapabilityDefinition(action.requiredCapability)
        assert.ok(capability)
        assert.strictEqual(action.owningDomain, capability.owner)
        assert.strictEqual(action.version, capability.version)
        assert.strictEqual(action.stability, capability.stability)
        assert.deepStrictEqual(action.scope, capability.scope)
      }

      assert.strictEqual(InventoryAdjustStockAction.inputSchema, AdjustStockInput)
      assert.strictEqual(InventoryAdjustStockAction.outputSchema, StockCorrection)
      assert.strictEqual(AccountingPostRevenueAction.inputSchema, PostRevenueForOrderInput)
      assert.strictEqual(AccountingPostRevenueAction.outputSchema, JournalEntry)
      assert.strictEqual(InventoryStockCorrectedEvent.payloadSchema, StockCorrectedEventPayload)
      assert.strictEqual(AccountingRevenuePostedEvent.payloadSchema, RevenuePostedEventPayload)

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

      yield* Schema.decodeUnknownEffect(AccountingPostRevenueAction.inputSchema)({
        principal,
        tenantId: "tenant-1",
        legalEntityId: "legal-entity-1",
        orderId: "order-1",
        amount: "10.00",
      })
      yield* Schema.decodeUnknownEffect(AccountingPostRevenueAction.outputSchema)({
        id: "journal-1",
        tenantId: "tenant-1",
        reference: "sales-order:order-1:revenue",
        status: "posted",
        postedAt: "2026-08-12T00:00:00.000Z",
        lines: [
          { accountId: "receivable-1", debit: "10.00", credit: "0" },
          { accountId: "revenue-1", debit: "0", credit: "10.00" },
        ],
      })
      yield* Schema.decodeUnknownEffect(AccountingPostRevenueAction.errorSchemas[0]!)({
        _tag: "AccountingPeriodNotOpen",
        tenantId: "tenant-1",
        legalEntityId: "legal-entity-1",
      })

      yield* Schema.decodeUnknownEffect(InventoryStockCorrectedEvent.payloadSchema)({
        correctionId: "correction-1",
        warehouseId: "warehouse-1",
        itemId: "item-1",
      })
      yield* Schema.decodeUnknownEffect(AccountingRevenuePostedEvent.payloadSchema)({
        journalId: "journal-1",
        legalEntityId: "legal-entity-1",
        orderId: "order-1",
      })
    }))
})
