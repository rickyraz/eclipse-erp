import { AuthorizationDenied } from "../../authorization/mod.ts"
import { defineActionCatalogEntry } from "../../catalog/mod.ts"
import { DatabaseFailure } from "../../kernel/mod.ts"
import { EventIdempotencyConflict } from "../../messaging/mod.ts"
import { SalesCapabilities } from "./capabilities.ts"
import {
  ConfirmOrderInput,
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "./service.ts"
import { SalesOrderConfirmedEvent } from "./events.ts"

export { SalesOrderConfirmedEvent, SalesOrderConfirmedEventPayload } from "./events.ts"

export const SalesConfirmOrderAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "sales.order.confirm",
  version: 1,
  owningDomain: "sales",
  title: "Confirm sales order",
  description: "Confirm a draft sales order using its owner-derived line total.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: ConfirmOrderInput,
  outputSchema: SalesOrder,
  errorSchemas: [
    EventIdempotencyConflict,
    SalesOrderConfirmationIdempotencyConflict,
    SalesOrderInvalidState,
    SalesOrderNotFound,
    AuthorizationDenied,
    DatabaseFailure,
  ],
  requiredCapability: SalesCapabilities.orderConfirm,
  scope: ["tenant"],
  idempotency: "required",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 3 },
  preconditions: ["authorized", "idempotency_key_stable", "sales_order_draft"],
  effects: ["sales_order_confirmed"],
  compensation: { kind: "none", recovery: "manual" },
})

export const SalesTypedActionCatalog = [SalesConfirmOrderAction] as const
export const SalesTypedEventCatalog = [SalesOrderConfirmedEvent] as const
