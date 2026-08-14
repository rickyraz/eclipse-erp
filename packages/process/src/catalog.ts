import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../catalog/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const OrderConfirmationCompletedEventPayload = Schema.Struct({
  workflowRunId: Uuid,
  orderId: Uuid,
  reservationIds: Schema.Array(Uuid),
  journalId: Uuid,
})

export const OrderCancellationCompletedEventPayload = Schema.Struct({
  workflowRunId: Uuid,
  confirmationWorkflowRunId: Uuid,
  orderId: Uuid,
  reservationIds: Schema.Array(Uuid),
  reversalJournalId: Uuid,
})

export const OrderFulfillmentCompletedEventPayload = Schema.Struct({
  workflowRunId: Uuid,
  confirmationWorkflowRunId: Uuid,
  orderId: Uuid,
  reservationIds: Schema.Array(Uuid),
})

export const ProcessOrderConfirmationCompletedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "process.order_confirmation.completed",
  version: 1,
  owningDomain: "process",
  title: "Order confirmation completed",
  description: "The Process coordinator completed order confirmation atomically.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: OrderConfirmationCompletedEventPayload,
  scope: ["tenant"],
  aggregateType: "sales_order",
  correlationFields: ["orderId", "workflowRunId"],
  filterableFields: ["orderId", "workflowRunId", "journalId"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})

export const ProcessOrderCancellationCompletedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "process.order_cancellation.completed",
  version: 1,
  owningDomain: "process",
  title: "Order cancellation completed",
  description: "The Process coordinator completed order cancellation atomically.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: OrderCancellationCompletedEventPayload,
  scope: ["tenant"],
  aggregateType: "sales_order",
  correlationFields: ["orderId", "workflowRunId", "confirmationWorkflowRunId"],
  filterableFields: [
    "orderId",
    "workflowRunId",
    "confirmationWorkflowRunId",
    "reversalJournalId",
  ],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})

export const ProcessOrderFulfillmentCompletedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "process.order_fulfillment.completed",
  version: 1,
  owningDomain: "process",
  title: "Order fulfillment completed",
  description: "The Process coordinator completed order fulfillment atomically.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: OrderFulfillmentCompletedEventPayload,
  scope: ["tenant"],
  aggregateType: "sales_order",
  correlationFields: ["orderId", "workflowRunId", "confirmationWorkflowRunId"],
  filterableFields: ["orderId", "workflowRunId", "confirmationWorkflowRunId"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})

export const ProcessTypedEventCatalog = [
  ProcessOrderConfirmationCompletedEvent,
  ProcessOrderCancellationCompletedEvent,
  ProcessOrderFulfillmentCompletedEvent,
] as const
