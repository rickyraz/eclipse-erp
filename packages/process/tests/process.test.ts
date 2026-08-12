import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  DomainEventEnvelope,
  OrderCancellationPayload,
  OrderConfirmationPayload,
  OrderFulfillmentPayload,
  ProcessJob,
} from "../mod.ts"

it.effect("defines versioned post-commit event and leased job contracts", () =>
  Effect.gen(function* () {
    const event = yield* Schema.decodeUnknownEffect(DomainEventEnvelope)({
      eventId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
      eventType: "process.order_confirmation.completed",
      eventVersion: 1,
      tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214124",
      aggregateType: "sales_order",
      aggregateId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
      commandId: "command-1",
      correlationId: "correlation-1",
      causationId: "causation-1",
      idempotencyKey: "confirmation-1",
      actorPrincipalId: "user-1",
      occurredAt: "2026-08-09T00:00:00.000Z",
      payload: {
        orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
        reservationIds: ["reservation-1", "reservation-2"],
        journalId: "journal-1",
      },
      publishedAt: null,
      attempts: 0,
    })
    const job = yield* Schema.decodeUnknownEffect(ProcessJob)({
      jobId: "job-1",
      tenantId: "tenant-1",
      jobType: "process.order_confirmation.post_commit",
      idempotencyKey: "confirmation-1",
      priority: 100,
      status: "pending",
      scheduledAt: "2026-08-09T00:00:00.000Z",
      leaseUntil: null,
      attempts: 0,
      payload: { eventId: event.eventId },
      correlationId: event.correlationId,
    })

    assert.strictEqual(event.eventVersion, 1)
    assert.strictEqual(
      new Set([
        event.commandId,
        event.correlationId,
        event.causationId,
        event.idempotencyKey,
      ]).size,
      4,
    )
    assert.strictEqual(job.status, "pending")
  }))

it.effect("defines cancellation and fulfillment command payloads", () =>
  Effect.gen(function* () {
    const input = {
      orderId: "order-1",
      commandId: "command-1",
      correlationId: "correlation-1",
      idempotencyKey: "lifecycle-1",
    }
    const cancellation = yield* Schema.decodeUnknownEffect(OrderCancellationPayload)(input)
    const fulfillment = yield* Schema.decodeUnknownEffect(OrderFulfillmentPayload)(input)

    assert.deepStrictEqual(cancellation, { ...input, causationId: null })
    assert.deepStrictEqual(fulfillment, cancellation)
  }))

it.effect("defines the server-derived order confirmation payload", () =>
  Effect.gen(function* () {
    const payload = yield* Schema.decodeUnknownEffect(OrderConfirmationPayload)({
      orderId: "order-1",
      warehouseId: "warehouse-1",
      legalEntityId: "legal-entity-1",
      commandId: "command-1",
      correlationId: "correlation-1",
      idempotencyKey: "confirmation-1",
    })

    assert.deepStrictEqual(payload, {
      orderId: "order-1",
      warehouseId: "warehouse-1",
      legalEntityId: "legal-entity-1",
      commandId: "command-1",
      correlationId: "correlation-1",
      causationId: null,
      idempotencyKey: "confirmation-1",
    })
  }))
