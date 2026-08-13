import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  ConsumerReceipt,
  EventEnvelope,
  EventIdempotencyConflict,
  makeMessagingTestLayer,
  MessagingService,
} from "../mod.ts"

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
  eventType: "sales.order.confirmed",
  eventVersion: 1,
  tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214124",
  aggregateType: "sales.order",
  aggregateId: "018f3f77-0c5a-7cc0-8b62-6a163d214125",
  commandId: "confirm-order-command",
  correlationId: "order-confirmation",
  causationId: null,
  idempotencyKey: "confirm-order-1",
  actorPrincipalId: "user-1",
  occurredAt: "2026-08-12T12:00:00.000Z",
  payload: { orderId: "018f3f77-0c5a-7cc0-8b62-6a163d214125" },
  ...overrides,
})

it.effect("rejects malformed envelope and receipt timestamps", () =>
  Effect.gen(function* () {
    const invalidEnvelope = yield* Effect.flip(
      Schema.decodeUnknownEffect(EventEnvelope)({
        ...event(),
        publishedAt: "not-a-timestamp",
        attempts: 0,
      }),
    )
    const invalidAttempts = yield* Effect.flip(
      Schema.decodeUnknownEffect(EventEnvelope)({
        ...event(),
        publishedAt: null,
        attempts: -1,
      }),
    )
    const invalidReceipt = yield* Effect.flip(
      Schema.decodeUnknownEffect(ConsumerReceipt)({
        tenantId: event().tenantId,
        consumerId: "accounting.project-order",
        eventId: event().eventId,
        completedAt: "not-a-timestamp",
      }),
    )

    assert.strictEqual(invalidEnvelope._tag, "SchemaError")
    assert.strictEqual(invalidAttempts._tag, "SchemaError")
    assert.strictEqual(invalidReceipt._tag, "SchemaError")
  }))

it.effect("rejects malformed idempotency-conflict identities", () =>
  Effect.gen(function* () {
    const invalid = yield* Effect.flip(
      Schema.decodeUnknownEffect(EventIdempotencyConflict)({
        _tag: "EventIdempotencyConflict",
        tenantId: "not-a-uuid",
        eventId: event().eventId,
        eventType: event().eventType,
        eventVersion: 0,
        idempotencyKey: event().idempotencyKey,
      }),
    )
    assert.strictEqual(invalid._tag, "SchemaError")
  }))

it.effect("appends idempotently and rejects a mismatched envelope", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    const first = yield* messaging.append(event())
    const duplicate = yield* messaging.append(event())

    assert.deepStrictEqual(duplicate, first)
    const failure = yield* Effect.flip(messaging.append(event({ payload: { orderId: "other" } })))
    assert.instanceOf(failure, EventIdempotencyConflict)
  }).pipe(Effect.provide(makeMessagingTestLayer())))

it.effect("suppresses a duplicate event consumer effect with one consumer receipt", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    const input = {
      tenantId: event().tenantId,
      consumerId: "accounting.project-order",
      eventId: event().eventId,
    }
    let executions = 0
    const first = yield* messaging.consumeOnce(
      input,
      Effect.sync(() => ++executions),
    )
    const duplicate = yield* messaging.consumeOnce(
      input,
      Effect.sync(() => ++executions),
    )

    assert.strictEqual(first.duplicate, false)
    assert.strictEqual(duplicate.duplicate, true)
    assert.strictEqual(executions, 1)
  }).pipe(Effect.provide(makeMessagingTestLayer())))

it.effect("rolls back the consumer receipt when the consumer effect fails", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    const input = {
      tenantId: event().tenantId,
      consumerId: "inventory.project-order",
      eventId: event().eventId,
    }
    const failed = yield* Effect.result(
      messaging.consumeOnce(input, Effect.fail("projection failed")),
    )
    assert.isTrue(Result.isFailure(failed))

    const retried = yield* messaging.consumeOnce(input, Effect.succeed("completed"))
    assert.strictEqual(retried.duplicate, false)
    if (!retried.duplicate) assert.strictEqual(retried.value, "completed")
  }).pipe(Effect.provide(makeMessagingTestLayer())))
