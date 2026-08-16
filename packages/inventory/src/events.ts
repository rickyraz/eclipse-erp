import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../catalog/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const StockCorrectedEventPayload = Schema.Struct({
  correctionId: Uuid,
  warehouseId: Uuid,
  itemId: Uuid,
})

export const InventoryStockCorrectedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "inventory.stock.corrected",
  version: 1,
  owningDomain: "inventory",
  title: "Stock corrected",
  description: "Stock was corrected by its owning Inventory transaction.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: StockCorrectedEventPayload,
  scope: ["tenant"],
  aggregateType: "stock_correction",
  correlationFields: ["correctionId"],
  filterableFields: ["correctionId", "warehouseId", "itemId"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})
