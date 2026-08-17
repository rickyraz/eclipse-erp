import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  ConfirmOrderConfirmationInput,
  DomainEventEnvelope,
  OrderCancellationCompletedEventPayload,
  OrderCancellationPayload,
  OrderConfirmationCompletedEventPayload,
  OrderConfirmationPayload,
  OrderFulfillmentCompletedEventPayload,
  OrderFulfillmentPayload,
  OrderFulfillmentResult,
  ProcessJob,
  ProcessPostCommitJobPayload,
  ProcessPostCommitJobType,
  ProcessWorkflowType,
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
    const leasedJob = yield* Schema.decodeUnknownEffect(ProcessJob)({
      ...job,
      status: "leased",
      leaseUntil: "2026-08-09T00:05:00.000Z",
      leaseOwner: "worker-1",
      leaseToken: "018f3f77-0c5a-7cc0-8b62-6a163d214127",
    })
    const invalidLeaseState = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        leaseUntil: "2026-08-09T00:05:00.000Z",
      }),
    )
    const invalidLeaseOwner = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        status: "leased",
        leaseUntil: "2026-08-09T00:05:00.000Z",
        leaseToken: "018f3f77-0c5a-7cc0-8b62-6a163d214127",
      }),
    )
    assert.strictEqual(invalidLeaseOwner._tag, "SchemaError")
    const invalidAttempts = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        attempts: -1,
      }),
    )
    const overflowingAttempts = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        attempts: 2_147_483_648,
      }),
    )
    const overflowingPriority = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        priority: 2_147_483_648,
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
    const invalidJobType = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessPostCommitJobType)("process.unknown.post_commit"),
    )
    const invalidPayload = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessJob)({
        ...job,
        payload: () => undefined,
      }),
    )
    assert.strictEqual(leasedJob.status, "leased")
    assert.strictEqual(invalidLeaseState._tag, "SchemaError")
    assert.strictEqual(invalidAttempts._tag, "SchemaError")
    assert.strictEqual(overflowingAttempts._tag, "SchemaError")
    assert.strictEqual(overflowingPriority._tag, "SchemaError")
    assert.strictEqual(invalidSchedule._tag, "SchemaError")
    assert.strictEqual(invalidIdentity._tag, "SchemaError")
    assert.strictEqual(invalidJobType._tag, "SchemaError")
    assert.strictEqual(invalidPayload._tag, "SchemaError")
  }))

it.effect("validates Process post-commit job payloads", () =>
  Effect.gen(function* () {
    const payload = {
      eventId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
      workflowRunId: "018f3f77-0c5a-7cc0-8b62-6a163d214127",
      commandId: "command-1",
      correlationId: "correlation-1",
      causationId: null,
      idempotencyKey: "confirmation-1",
    }
    yield* Schema.decodeUnknownEffect(ProcessPostCommitJobPayload)(payload)

    const invalidEvent = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessPostCommitJobPayload)({
        ...payload,
        eventId: "not-a-uuid",
      }),
    )
    assert.strictEqual(invalidEvent._tag, "SchemaError")
  }))

it.effect("validates order fulfillment completed event payloads", () =>
  Effect.gen(function* () {
    const payload = {
      workflowRunId: "018f3f77-0c5a-7cc0-8b62-6a163d214127",
      confirmationWorkflowRunId: "018f3f77-0c5a-7cc0-8b62-6a163d214132",
      orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
      reservationIds: ["018f3f77-0c5a-7cc0-8b62-6a163d214130"],
    }
    yield* Schema.decodeUnknownEffect(OrderFulfillmentCompletedEventPayload)(payload)

    const invalidWorkflow = yield* Effect.flip(
      Schema.decodeUnknownEffect(OrderFulfillmentCompletedEventPayload)({
        ...payload,
        workflowRunId: "not-a-uuid",
      }),
    )
    assert.strictEqual(invalidWorkflow._tag, "SchemaError")
  }))

it.effect("validates order cancellation completed event payloads", () =>
  Effect.gen(function* () {
    const payload = {
      workflowRunId: "018f3f77-0c5a-7cc0-8b62-6a163d214127",
      confirmationWorkflowRunId: "018f3f77-0c5a-7cc0-8b62-6a163d214132",
      orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
      reservationIds: ["018f3f77-0c5a-7cc0-8b62-6a163d214130"],
      reversalJournalId: "018f3f77-0c5a-7cc0-8b62-6a163d214133",
    }
    yield* Schema.decodeUnknownEffect(OrderCancellationCompletedEventPayload)(payload)

    const invalidJournal = yield* Effect.flip(
      Schema.decodeUnknownEffect(OrderCancellationCompletedEventPayload)({
        ...payload,
        reversalJournalId: "not-a-uuid",
      }),
    )
    assert.strictEqual(invalidJournal._tag, "SchemaError")
  }))

it.effect("validates order confirmation completed event payloads", () =>
  Effect.gen(function* () {
    const payload = {
      workflowRunId: "018f3f77-0c5a-7cc0-8b62-6a163d214127",
      orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
      reservationIds: ["018f3f77-0c5a-7cc0-8b62-6a163d214130"],
      journalId: "018f3f77-0c5a-7cc0-8b62-6a163d214131",
    }
    yield* Schema.decodeUnknownEffect(OrderConfirmationCompletedEventPayload)(payload)

    const invalidReservation = yield* Effect.flip(
      Schema.decodeUnknownEffect(OrderConfirmationCompletedEventPayload)({
        ...payload,
        reservationIds: ["not-a-uuid"],
      }),
    )
    assert.strictEqual(invalidReservation._tag, "SchemaError")
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

    const invalidWorkflowType = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessWorkflowType)("sales.order.unknown"),
    )
    const invalidIdentity = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRun)({ ...run, aggregateId: "not-a-uuid" }),
    )
    const invalidSucceededState = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRun)({ ...run, status: "succeeded" }),
    )
    const invalidRecoveryState = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRun)({ ...run, status: "manual_recovery" }),
    )
    const invalidRunningRecovery = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRun)({ ...run, recoveryReason: "unexpected" }),
    )
    const invalidSucceededRecovery = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRun)({
        ...run,
        status: "succeeded",
        recoveryReason: "unexpected",
        completedAt: "2026-08-14T00:00:00.000Z",
      }),
    )
    const invalidCompletedRecovery = yield* Effect.flip(
      Schema.decodeUnknownEffect(WorkflowRun)({
        ...run,
        status: "manual_recovery",
        recoveryReason: "operator review required",
        completedAt: "2026-08-14T00:00:00.000Z",
      }),
    )
    assert.strictEqual(invalidWorkflowType._tag, "SchemaError")
    assert.strictEqual(invalidIdentity._tag, "SchemaError")
    assert.strictEqual(invalidSucceededState._tag, "SchemaError")
    assert.strictEqual(invalidRecoveryState._tag, "SchemaError")
    assert.strictEqual(invalidRunningRecovery._tag, "SchemaError")
    assert.strictEqual(invalidSucceededRecovery._tag, "SchemaError")
    assert.strictEqual(invalidCompletedRecovery._tag, "SchemaError")
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

it.effect("validates scoped workflow tenant identities", () =>
  Effect.gen(function* () {
    const invalidTenant = yield* Effect.flip(
      Schema.decodeUnknownEffect(ConfirmOrderConfirmationInput.fields.tenantId)("not-a-uuid"),
    )
    assert.strictEqual(invalidTenant._tag, "SchemaError")
  }))

it.effect("defines cancellation and fulfillment command payloads", () =>
  Effect.gen(function* () {
    const input = {
      orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
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
      orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
      warehouseId: "018f3f77-0c5a-7cc0-8b62-6a163d214128",
      legalEntityId: "018f3f77-0c5a-7cc0-8b62-6a163d214129",
      commandId: "command-1",
      correlationId: "correlation-1",
      idempotencyKey: "confirmation-1",
    })

    assert.deepStrictEqual(payload, {
      orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
      warehouseId: "018f3f77-0c5a-7cc0-8b62-6a163d214128",
      legalEntityId: "018f3f77-0c5a-7cc0-8b62-6a163d214129",
      commandId: "command-1",
      correlationId: "correlation-1",
      causationId: null,
      idempotencyKey: "confirmation-1",
    })

    const invalidIdentity = yield* Effect.flip(
      Schema.decodeUnknownEffect(OrderConfirmationPayload)({
        ...payload,
        warehouseId: "not-a-uuid",
      }),
    )
    assert.strictEqual(invalidIdentity._tag, "SchemaError")
  }))
