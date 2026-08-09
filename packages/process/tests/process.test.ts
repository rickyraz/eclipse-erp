import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { DomainEventEnvelope, ProcessJob } from "../mod.ts"

it.effect("defines versioned post-commit event and leased job contracts", () =>
  Effect.gen(function* () {
    const event = yield* Schema.decodeUnknownEffect(DomainEventEnvelope)({
      eventId: "event-1",
      eventType: "sales.order.confirmed",
      eventVersion: 1,
      tenantId: "tenant-1",
      aggregateType: "sales_order",
      aggregateId: "order-1",
      correlationId: "confirmation-1",
      causationId: null,
      actorPrincipalId: "user-1",
      occurredAt: "2026-08-09T00:00:00.000Z",
      payload: { orderId: "order-1" },
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
    assert.strictEqual(job.status, "pending")
  }))
