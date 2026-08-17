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
import { DatabaseFailure } from "../../kernel/mod.ts"

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
        occurredAt: "2026-08-12",
        publishedAt: "not-a-timestamp",
        attempts: 0,
      }),
    )
    const overflowingVersion = yield* Effect.flip(
      Schema.decodeUnknownEffect(EventEnvelope)({
        ...event(),
        eventVersion: 2_147_483_648,
        publishedAt: null,
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
    const overflowingAttempts = yield* Effect.flip(
      Schema.decodeUnknownEffect(EventEnvelope)({
        ...event(),
        publishedAt: null,
        attempts: 2_147_483_648,
      }),
    )
    const invalidReceipt = yield* Effect.flip(
      Schema.decodeUnknownEffect(ConsumerReceipt)({
        tenantId: event().tenantId,
        consumerId: "accounting.project-order",
        eventId: event().eventId,
        eventType: event().eventType,
        eventVersion: event().eventVersion,
        idempotencyKey: event().idempotencyKey,
        completedAt: "not-a-timestamp",
      }),
    )

    assert.strictEqual(invalidEnvelope._tag, "SchemaError")
    assert.strictEqual(overflowingVersion._tag, "SchemaError")
    assert.strictEqual(invalidAttempts._tag, "SchemaError")
    assert.strictEqual(overflowingAttempts._tag, "SchemaError")
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

it.effect("loads events through a tenant-scoped public query", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    const source = yield* messaging.append(event())

    assert.deepStrictEqual(
      yield* messaging.getEvent({ tenantId: source.tenantId, eventId: source.eventId }),
      source,
    )
    assert.isUndefined(
      yield* messaging.getEvent({
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214126",
        eventId: source.eventId,
      }),
    )
    assert.isUndefined(
      yield* messaging.getEvent({
        tenantId: source.tenantId,
        eventId: "018f3f77-0c5a-7cc0-8b62-6a163d214126",
      }),
    )
    const invalidGetEvent = yield* Effect.flip(
      messaging.getEvent({ tenantId: "not-a-uuid", eventId: source.eventId }),
    )
    assert.strictEqual(invalidGetEvent._tag, "SchemaError")
  }).pipe(Effect.provide(makeMessagingTestLayer())))

it.effect("suppresses a duplicate event consumer effect with one consumer receipt", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    yield* messaging.append(event())
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

it.effect("suppresses concurrent duplicate consumer effects in the test layer", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    yield* messaging.append(event())
    const input = {
      tenantId: event().tenantId,
      consumerId: "accounting.concurrent-project-order",
      eventId: event().eventId,
    }
    let executions = 0
    const results = yield* Effect.all([
      messaging.consumeOnce(
        input,
        Effect.andThen(Effect.yieldNow, Effect.sync(() => ++executions)),
      ),
      messaging.consumeOnce(
        input,
        Effect.andThen(Effect.yieldNow, Effect.sync(() => ++executions)),
      ),
    ], { concurrency: "unbounded" })

    assert.strictEqual(results.filter((result) => result.duplicate).length, 1)
    assert.strictEqual(results.filter((result) => !result.duplicate).length, 1)
    assert.strictEqual(executions, 1)
  }).pipe(Effect.provide(makeMessagingTestLayer())))

it.effect("rolls back the consumer receipt when the consumer effect fails", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    yield* messaging.append(event())
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

it.effect("requires a tenant-matching source event and rolls back the consumer effect", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    const source = event()
    const foreignTenantId = "018f3f77-0c5a-7cc0-8b62-6a163d214126"
    const derivedEventId = "018f3f77-0c5a-7cc0-8b62-6a163d214127"
    yield* messaging.append(source)

    const input = {
      tenantId: foreignTenantId,
      consumerId: "accounting.project-order",
      eventId: source.eventId,
    }
    let executions = 0
    const consume = messaging.consumeOnce(
      input,
      Effect.gen(function* () {
        executions++
        return yield* messaging.append(event({
          eventId: derivedEventId,
          tenantId: foreignTenantId,
          eventType: "accounting.order.projected",
          idempotencyKey: "project-order-1",
          payload: { attempt: executions },
        }))
      }),
    )

    const failure = yield* Effect.flip(consume)
    assert.instanceOf(failure, DatabaseFailure)

    yield* messaging.append(event({ tenantId: foreignTenantId }))
    const retried = yield* consume
    assert.strictEqual(retried.duplicate, false)
    assert.strictEqual(executions, 1)
  }).pipe(Effect.provide(makeMessagingTestLayer())))
