import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../catalog/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PositiveInt = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }),
)

export const RevenuePostedEventPayload = Schema.Struct({
  journalId: Uuid,
  legalEntityId: Uuid,
  orderId: Uuid,
})

export const AccountingFinancialOperationReconciledEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "accounting.financial_operation.reconciled",
  version: 1,
  owningDomain: "accounting",
  title: "Financial operation reconciled",
  description: "A TigerBeetle-accepted operation has a committed Accounting projection.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: Schema.Struct({
    operationId: NonEmptyString,
    journalId: Uuid,
    mappingVersion: PositiveInt,
  }),
  scope: ["tenant"],
  aggregateType: "financial_operation",
  correlationFields: ["operationId", "journalId"],
  filterableFields: ["operationId", "journalId"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
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
