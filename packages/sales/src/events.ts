import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../catalog/mod.ts"
import { FinancialMajorAmount } from "../../kernel/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Money = FinancialMajorAmount

export const SalesOrderConfirmedEventPayload = Schema.Struct({
  orderId: Uuid,
  total: Money,
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
