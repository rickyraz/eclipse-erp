import * as Schema from "effect/Schema"

import { AuthorizationDenied } from "../../authorization/mod.ts"
import { defineActionCatalogEntry, defineEventCatalogEntry } from "../../catalog/mod.ts"
import { DatabaseFailure } from "../../kernel/mod.ts"
import { EventIdempotencyConflict } from "../../messaging/mod.ts"
import { InventoryCapabilities } from "./capabilities.ts"
import {
  AdjustStockInput,
  InventoryReferenceNotFound,
  InventoryUnitOfMeasureMismatch,
  StockCorrection,
  StockCorrectionIdempotencyConflict,
  StockUnavailable,
} from "./service.ts"

export const StockCorrectedEventPayload = Schema.Struct({
  correctionId: Schema.String,
  warehouseId: Schema.String,
  itemId: Schema.String,
})

export const InventoryAdjustStockAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "inventory.stock.adjust",
  version: 1,
  owningDomain: "inventory",
  title: "Adjust stock",
  description: "Apply an idempotent stock correction.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: AdjustStockInput,
  outputSchema: StockCorrection,
  errorSchemas: [
    InventoryReferenceNotFound,
    InventoryUnitOfMeasureMismatch,
    StockCorrectionIdempotencyConflict,
    StockUnavailable,
    EventIdempotencyConflict,
    AuthorizationDenied,
    DatabaseFailure,
  ],
  requiredCapability: InventoryCapabilities.stockAdjust,
  scope: ["tenant"],
  idempotency: "required",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 3 },
  preconditions: [
    "authorized",
    "idempotency_key_stable",
    "stock_reference_exists",
    "stock_unit_matches",
    "stock_remains_available",
  ],
  effects: ["stock_balance_adjusted", "stock_correction_recorded"],
  compensation: { kind: "none", recovery: "manual" },
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

export const InventoryTypedActionCatalog = [InventoryAdjustStockAction] as const
export const InventoryTypedEventCatalog = [InventoryStockCorrectedEvent] as const
