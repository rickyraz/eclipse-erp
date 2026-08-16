import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../catalog/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const RevenuePostedEventPayload = Schema.Struct({
  journalId: Uuid,
  legalEntityId: Uuid,
  orderId: Uuid,
})

export const AccountingRevenuePostedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "accounting.revenue.posted",
  version: 1,
  owningDomain: "accounting",
  title: "Revenue posted",
  description: "Revenue was posted by its owning Accounting transaction.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: RevenuePostedEventPayload,
  scope: ["tenant"],
  aggregateType: "journal_entry",
  correlationFields: ["orderId"],
  filterableFields: ["journalId", "legalEntityId", "orderId"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})
