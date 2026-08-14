import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  DomainEventEnvelope,
  OrderCancellationPayload,
  OrderConfirmationPayload,
  OrderFulfillmentPayload,
  OrderFulfillmentResult,
  ProcessJob,
  WorkflowManualRecoveryRequired,
  WorkflowRun,
  WorkflowRunNotFound,
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
      jobId: "018f3f77-0c5a-7cc0-8b62-6a163d214126",
      tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214124",
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
    const invalidAttempts = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        attempts: -1,
      }),
    )
    const invalidSchedule = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        scheduledAt: "2026-08-09",
      }),
    )
    const invalidIdentity = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        tenantId: "not-a-uuid",
      }),
    )
    assert.strictEqual(invalidAttempts._tag, "SchemaError")
    assert.strictEqual(invalidSchedule._tag, "SchemaError")
    assert.strictEqual(invalidIdentity._tag, "SchemaError")
  }))

it.effect("validates workflow run identities and recovery metadata", () =>
  Effect.gen(function* () {
    const run = {
      id: "018f3f77-0c5a-7cc0-8b62-6a163d214127",
      tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214124",
      workflowType: "sales.order.confirmation",
      idempotencyKey: "confirmation-1",
      aggregateId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
      status: "running",
      recoveryReason: null,
      completedAt: null,
    }
    yield* Schema.decodeUnknownEffect(WorkflowRun)(run)

    const invalidIdentity = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRun)({ ...run, aggregateId: "not-a-uuid" }),
    )
    assert.strictEqual(invalidIdentity._tag, "SchemaError")
  }))

it.effect("validates lifecycle result identities", () =>
  Effect.gen(function* () {
    const invalidWorkflowRunId = yield* Effect.flip(
      Schema.decodeUnknownEffect(OrderFulfillmentResult.fields.workflowRunId)("not-a-uuid"),
    )
    const invalidEventId = yield* Effect.flip(
      Schema.decodeUnknownEffect(OrderFulfillmentResult.fields.eventId)("not-a-uuid"),
    )
    const invalidJobId = yield* Effect.flip(
      Schema.decodeUnknownEffect(OrderFulfillmentResult.fields.jobId)("not-a-uuid"),
    )

    assert.strictEqual(invalidWorkflowRunId._tag, "SchemaError")
    assert.strictEqual(invalidEventId._tag, "SchemaError")
    assert.strictEqual(invalidJobId._tag, "SchemaError")
  }))

it.effect("validates workflow error identities and recovery reasons", () =>
  Effect.gen(function* () {
    const invalidIdentity = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRunNotFound)({
        _tag: "WorkflowRunNotFound",
        tenantId: "not-a-uuid",
        idempotencyKey: "confirmation-1",
      }),
    )
    const invalidReason = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowManualRecoveryRequired)({
        _tag: "WorkflowManualRecoveryRequired",
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214124",
        idempotencyKey: "confirmation-1",
        reason: "",
      }),
    )

    assert.strictEqual(invalidIdentity._tag, "SchemaError")
    assert.strictEqual(invalidReason._tag, "SchemaError")
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
