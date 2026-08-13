import * as Schema from "effect/Schema"

import { AuthorizationDenied } from "../../authorization/mod.ts"
import { defineActionCatalogEntry, defineEventCatalogEntry } from "../../catalog/mod.ts"
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

export const SalesOrderConfirmedEventPayload = Schema.Struct({
  orderId: Schema.String,
  total: SalesOrder.fields.total,
})

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

export const SalesOrderConfirmedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "sales.order.confirmed",
  version: 1,
  owningDomain: "sales",
  title: "Sales order confirmed",
  description: "A sales order was confirmed with its Sales-owned total.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: SalesOrderConfirmedEventPayload,
  scope: ["tenant"],
  aggregateType: "sales_order",
  correlationFields: ["orderId"],
  filterableFields: ["orderId"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})

export const SalesTypedActionCatalog = [SalesConfirmOrderAction] as const
export const SalesTypedEventCatalog = [SalesOrderConfirmedEvent] as const
