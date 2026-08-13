import { and, eq, or } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { consumerReceipts, eventOutbox } from "../../../db/schema/messaging.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Uuid = Schema.String.check(Schema.isUUID())
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const InstantString = Schema.String.check(
  Schema.makeFilter((value) => !Number.isNaN(new Date(value).getTime()), {
    expected: "an ISO-compatible timestamp",
  }),
)

export const AppendEventInput = Schema.Struct({
  eventId: Uuid,
  eventType: NonEmptyString,
  eventVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  tenantId: Uuid,
  aggregateType: NonEmptyString,
  aggregateId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString),
  idempotencyKey: NonEmptyString,
  actorPrincipalId: NonEmptyString,
  occurredAt: InstantString,
  payload: Schema.Json,
})

export const EventEnvelope = Schema.Struct({
  ...AppendEventInput.fields,
  publishedAt: Schema.NullOr(InstantString),
  attempts: NonNegativeInt,
})

export const ConsumeOnceInput = Schema.Struct({
  tenantId: Uuid,
  consumerId: NonEmptyString,
  eventId: Uuid,
})

export const ConsumerReceipt = Schema.Struct({
  ...ConsumeOnceInput.fields,
  completedAt: InstantString,
})

export type AppendEventInput = Schema.Schema.Type<typeof AppendEventInput>
export type EventEnvelope = Schema.Schema.Type<typeof EventEnvelope>
export type ConsumeOnceInput = Schema.Schema.Type<typeof ConsumeOnceInput>
export type ConsumerReceipt = Schema.Schema.Type<typeof ConsumerReceipt>

export type ConsumeOnceResult<A> =
  | { readonly duplicate: false; readonly value: A; readonly receipt: ConsumerReceipt }
  | { readonly duplicate: true; readonly receipt: ConsumerReceipt }

export class EventIdempotencyConflict
  extends Schema.TaggedErrorClass<EventIdempotencyConflict>()("EventIdempotencyConflict", {
    tenantId: Schema.String,
    eventId: Schema.String,
    eventType: Schema.String,
    eventVersion: Schema.Int,
    idempotencyKey: Schema.String,
  }) {}

export interface MessagingService {
  readonly append: (
    input: unknown,
  ) => Effect.Effect<
    EventEnvelope,
    EventIdempotencyConflict | DatabaseFailure | Schema.SchemaError
  >
  /** The effect must be PostgreSQL-local so it and the completed receipt share one transaction. */
  readonly consumeOnce: <A, E, R>(
    input: unknown,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<ConsumeOnceResult<A>, E | DatabaseFailure | Schema.SchemaError, R>
}

export const MessagingService = Context.Service<MessagingService>("EclipseERP/MessagingService")

const selectEvent = {
  eventId: eventOutbox.id,
  eventType: eventOutbox.eventType,
  eventVersion: eventOutbox.eventVersion,
  tenantId: eventOutbox.tenantId,
  aggregateType: eventOutbox.aggregateType,
  aggregateId: eventOutbox.aggregateId,
  commandId: eventOutbox.commandId,
  correlationId: eventOutbox.correlationId,
  causationId: eventOutbox.causationId,
  idempotencyKey: eventOutbox.idempotencyKey,
  actorPrincipalId: eventOutbox.actorPrincipalId,
  occurredAt: eventOutbox.occurredAt,
  payload: eventOutbox.payload,
  publishedAt: eventOutbox.publishedAt,
  attempts: eventOutbox.attempts,
}

const selectReceipt = {
  tenantId: consumerReceipts.tenantId,
  consumerId: consumerReceipts.consumerId,
  eventId: consumerReceipts.eventId,
  completedAt: consumerReceipts.completedAt,
}

type EventRow = Omit<EventEnvelope, "occurredAt" | "publishedAt" | "payload"> & {
  readonly occurredAt: Date
  readonly publishedAt: Date | null
  readonly payload: unknown
}
type ReceiptRow = Omit<ConsumerReceipt, "completedAt"> & { readonly completedAt: Date }

const toEvent = (row: EventRow): EventEnvelope => ({
  ...row,
  payload: row.payload as Schema.Json,
  occurredAt: row.occurredAt.toISOString(),
  publishedAt: row.publishedAt?.toISOString() ?? null,
})

const toReceipt = (row: ReceiptRow): ConsumerReceipt => ({
  ...row,
  completedAt: row.completedAt.toISOString(),
})

const envelopeMatches = (input: AppendEventInput, event: EventEnvelope) =>
  input.eventId === event.eventId &&
  input.eventType === event.eventType &&
  input.eventVersion === event.eventVersion &&
  input.tenantId === event.tenantId &&
  input.aggregateType === event.aggregateType &&
  input.aggregateId === event.aggregateId &&
  input.commandId === event.commandId &&
  input.correlationId === event.correlationId &&
  input.causationId === event.causationId &&
  input.idempotencyKey === event.idempotencyKey &&
  input.actorPrincipalId === event.actorPrincipalId &&
  new Date(input.occurredAt).getTime() === new Date(event.occurredAt).getTime() &&
  Equal.equals(input.payload, event.payload)

const conflict = (input: AppendEventInput) =>
  new EventIdempotencyConflict({
    tenantId: input.tenantId,
    eventId: input.eventId,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    idempotencyKey: input.idempotencyKey,
  })

export const makeMessagingService = Effect.gen(function* () {
  const database = yield* Database

  const findReceipt = (input: ConsumeOnceInput) =>
    database.query(
      (db) =>
        db.select(selectReceipt).from(consumerReceipts).where(and(
          eq(consumerReceipts.tenantId, input.tenantId),
          eq(consumerReceipts.consumerId, input.consumerId),
          eq(consumerReceipts.eventId, input.eventId),
        )),
      "messaging.receipt.get",
    ).pipe(Effect.map((rows) => rows[0] === undefined ? undefined : toReceipt(rows[0])))

  const service: MessagingService = {
    append: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AppendEventInput)(input)
        const occurredAt = new Date(decoded.occurredAt)

        return yield* database.withTransaction(
          Effect.gen(function* () {
            const inserted = yield* database.query(
              (db) =>
                db.insert(eventOutbox).values({
                  id: decoded.eventId,
                  eventType: decoded.eventType,
                  eventVersion: decoded.eventVersion,
                  tenantId: decoded.tenantId,
                  aggregateType: decoded.aggregateType,
                  aggregateId: decoded.aggregateId,
                  commandId: decoded.commandId,
                  correlationId: decoded.correlationId,
                  causationId: decoded.causationId,
                  idempotencyKey: decoded.idempotencyKey,
                  actorPrincipalId: decoded.actorPrincipalId,
                  occurredAt,
                  payload: decoded.payload,
                }).onConflictDoNothing().returning(selectEvent),
              "messaging.event.append",
            )
            if (inserted[0] !== undefined) return toEvent(inserted[0])

            const existing = yield* database.query(
              (db) =>
                db.select(selectEvent).from(eventOutbox).where(or(
                  and(
                    eq(eventOutbox.tenantId, decoded.tenantId),
                    eq(eventOutbox.id, decoded.eventId),
                  ),
                  and(
                    eq(eventOutbox.tenantId, decoded.tenantId),
                    eq(eventOutbox.eventType, decoded.eventType),
                    eq(eventOutbox.eventVersion, decoded.eventVersion),
                    eq(eventOutbox.idempotencyKey, decoded.idempotencyKey),
                  ),
                )),
              "messaging.event.get-existing",
            )
            if (existing.length !== 1) return yield* Effect.fail(conflict(decoded))
            const event = toEvent(existing[0]!)
            return envelopeMatches(decoded, event) ? event : yield* Effect.fail(conflict(decoded))
          }),
          "messaging.event.append-transaction",
        )
      }),
    consumeOnce: (input, effect) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConsumeOnceInput)(input)
        const result = yield* database.withTransaction(
          Effect.gen(function* () {
            const existing = yield* findReceipt(decoded)
            if (existing !== undefined) return { duplicate: true as const, receipt: existing }

            const value = yield* effect
            const rows = yield* database.query(
              (db) => db.insert(consumerReceipts).values(decoded).returning(selectReceipt),
              "messaging.receipt.complete",
            )
            return { duplicate: false as const, value, receipt: toReceipt(rows[0]!) }
          }),
          "messaging.consume-once",
        ).pipe(Effect.result)

        if (Result.isSuccess(result)) return result.success
        if (isDatabaseConstraint(result.failure, "consumer_receipts_pkey")) {
          const receipt = yield* findReceipt(decoded)
          if (receipt !== undefined) return { duplicate: true as const, receipt }
        }
        return yield* Effect.fail(result.failure)
      }),
  }

  return service
})

export const MessagingLive = Layer.effect(MessagingService, makeMessagingService)

export const makeMessagingTestLayer = () => {
  const eventsById = new Map<string, EventEnvelope>()
  const eventIdsByDedupe = new Map<string, string>()
  const receipts = new Map<string, ConsumerReceipt>()
  let clock = 0

  const eventKey = (tenantId: string, eventId: string) => `${tenantId}:${eventId}`
  const dedupeKey = (input: AppendEventInput) =>
    `${input.tenantId}:${input.eventType}:${input.eventVersion}:${input.idempotencyKey}`
  const receiptKey = (input: ConsumeOnceInput) =>
    `${input.tenantId}:${input.consumerId}:${input.eventId}`

  const service: MessagingService = {
    append: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AppendEventInput)(input)
        const byId = eventsById.get(eventKey(decoded.tenantId, decoded.eventId))
        const dedupedId = eventIdsByDedupe.get(dedupeKey(decoded))
        const byDedupe = dedupedId === undefined
          ? undefined
          : eventsById.get(eventKey(decoded.tenantId, dedupedId))
        const existing = byId ?? byDedupe
        if (
          existing !== undefined && byId === byDedupe && envelopeMatches(decoded, existing)
        ) return existing
        if (existing !== undefined) return yield* Effect.fail(conflict(decoded))

        const event: EventEnvelope = { ...decoded, publishedAt: null, attempts: 0 }
        eventsById.set(eventKey(decoded.tenantId, decoded.eventId), event)
        eventIdsByDedupe.set(dedupeKey(decoded), decoded.eventId)
        return event
      }),
    consumeOnce: (input, effect) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConsumeOnceInput)(input)
        const key = receiptKey(decoded)
        const existing = receipts.get(key)
        if (existing !== undefined) return { duplicate: true as const, receipt: existing }

        const eventSnapshot = new Map(eventsById)
        const dedupeSnapshot = new Map(eventIdsByDedupe)
        const result = yield* Effect.result(effect)
        if (Result.isFailure(result)) {
          eventsById.clear()
          eventIdsByDedupe.clear()
          for (const [snapshotKey, value] of eventSnapshot) eventsById.set(snapshotKey, value)
          for (const [snapshotKey, value] of dedupeSnapshot) {
            eventIdsByDedupe.set(snapshotKey, value)
          }
          return yield* Effect.fail(result.failure)
        }

        const receipt: ConsumerReceipt = {
          ...decoded,
          completedAt: new Date(clock++).toISOString(),
        }
        receipts.set(key, receipt)
        return { duplicate: false as const, value: result.success, receipt }
      }),
  }

  return Layer.succeed(MessagingService, service)
}
