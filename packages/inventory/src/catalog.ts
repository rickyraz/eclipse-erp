import { AuthorizationDenied } from "../../authorization/mod.ts"
import { defineActionCatalogEntry } from "../../catalog/mod.ts"
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
import { InventoryStockCorrectedEvent } from "./events.ts"

export { InventoryStockCorrectedEvent, StockCorrectedEventPayload } from "./events.ts"

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

export const InventoryTypedActionCatalog = [InventoryAdjustStockAction] as const
export const InventoryTypedEventCatalog = [InventoryStockCorrectedEvent] as const
