import { assert, it } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"

import { EventIdempotencyConflict, makeMessagingService } from "../mod.ts"
import { Database, DatabaseFailure, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

const event = (tenantId: string, overrides: Record<string, unknown> = {}) => ({
  eventId: crypto.randomUUID(),
  eventType: "sales.order.confirmed",
  eventVersion: 1,
  tenantId,
  aggregateType: "sales.order",
  aggregateId: crypto.randomUUID(),
  commandId: crypto.randomUUID(),
  correlationId: crypto.randomUUID(),
  causationId: null,
  idempotencyKey: crypto.randomUUID(),
  actorPrincipalId: "user-1",
  occurredAt: "2026-08-12T12:00:00.000Z",
  payload: { state: "confirmed" },
  ...overrides,
})

it.effect.skipIf(databaseUrl === undefined)(
  "rejects blank persisted messaging identities",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const eventId = crypto.randomUUID()
        yield* Effect.promise(() =>
          client`
            insert into messaging.event_outbox
              (tenant_id, id, event_type, event_version, aggregate_type, aggregate_id,
               command_id, correlation_id, causation_id, idempotency_key, actor_principal_id,
               payload)
            values
              (${tenant!.id}, ${eventId}, 'sales.order.confirmed', 1, 'sales.order',
               ${crypto.randomUUID()}, 'command', 'correlation', 'causation', 'idempotency',
               'actor', '{}'::jsonb)
          `
        )
        yield* Effect.promise(() =>
          client`
            insert into messaging.consumer_receipts
              (tenant_id, consumer_id, event_id, event_type, event_version, idempotency_key)
            values
              (${tenant!.id}, 'consumer', ${eventId}, 'sales.order.confirmed', 1, 'idempotency')
          `
        )

        const failures = [
          [
            yield* postgresFailure(() =>
              client`update messaging.event_outbox set event_type = '   ' where tenant_id = ${
                tenant!.id
              } and id = ${eventId}`
            ),
            "event_outbox_event_type_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.event_outbox set aggregate_type = '   ' where tenant_id = ${
                tenant!.id
              } and id = ${eventId}`
            ),
            "event_outbox_aggregate_type_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.event_outbox set command_id = '   ' where tenant_id = ${
                tenant!.id
              } and id = ${eventId}`
            ),
            "event_outbox_command_id_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.event_outbox set correlation_id = '   ' where tenant_id = ${
                tenant!.id
              } and id = ${eventId}`
            ),
            "event_outbox_correlation_id_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.event_outbox set causation_id = '   ' where tenant_id = ${
                tenant!.id
              } and id = ${eventId}`
            ),
            "event_outbox_causation_id_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.event_outbox set idempotency_key = '   ' where tenant_id = ${
                tenant!.id
              } and id = ${eventId}`
            ),
            "event_outbox_idempotency_key_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.event_outbox set actor_principal_id = '   ' where tenant_id = ${
                tenant!.id
              } and id = ${eventId}`
            ),
            "event_outbox_actor_principal_id_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.consumer_receipts set consumer_id = '   ' where tenant_id = ${
                tenant!.id
              } and event_id = ${eventId}`
            ),
            "consumer_receipts_consumer_id_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.consumer_receipts set event_type = '   ' where tenant_id = ${
                tenant!.id
              } and event_id = ${eventId}`
            ),
            "consumer_receipts_event_type_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.consumer_receipts set event_version = 0 where tenant_id = ${
                tenant!.id
              } and event_id = ${eventId}`
            ),
            "consumer_receipts_event_version_check",
          ],
          [
            yield* postgresFailure(() =>
              client`update messaging.consumer_receipts set idempotency_key = '   ' where tenant_id = ${
                tenant!.id
              } and event_id = ${eventId}`
            ),
            "consumer_receipts_idempotency_key_check",
          ],
        ] as const

        for (const [failure, constraint] of failures) {
          assert.strictEqual((failure as { code?: string }).code, "23514")
          assert.strictEqual(
            (failure as { constraint_name?: string }).constraint_name,
            constraint,
          )
        }
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "joins an ambient transaction and rolls back a successful append",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const database = makePostgresDatabase(client)
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const input = event(tenant!.id)

        const failure = yield* Effect.flip(database.withTransaction(
          Effect.andThen(messaging.append(input), Effect.fail("outer transaction failed")),
          "messaging.test.outer-transaction",
        ))
        assert.strictEqual(failure, "outer transaction failed")

        const rows = yield* Effect.promise(() =>
          client<{ count: number }[]>`
            select count(*)::integer as count
            from messaging.event_outbox
            where tenant_id = ${tenant!.id} and id = ${input.eventId}
          `
        )
        assert.deepStrictEqual(rows, [{ count: 0 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rejects invalid event envelopes before opening a PostgreSQL transaction",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )

        const failure = yield* Effect.flip(messaging.append(event(tenant!.id, {
          eventVersion: 0,
        })))
        assert.strictEqual(failure._tag, "SchemaError")

        const rows = yield* Effect.promise(() =>
          client<{ count: number }[]>`
            select count(*)::integer as count from messaging.event_outbox
          `
        )
        assert.deepStrictEqual(rows, [{ count: 0 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "concurrently appends one event and rejects a mismatched envelope in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const input = event(tenant!.id)
        const [first, duplicate] = yield* Effect.all([
          messaging.append(input),
          messaging.append(input),
        ], { concurrency: "unbounded" })

        assert.deepStrictEqual(duplicate, first)
        const conflict = yield* Effect.flip(
          messaging.append({ ...input, payload: { state: "different" } }),
        )
        assert.instanceOf(conflict, EventIdempotencyConflict)
        const rows = yield* Effect.promise(() =>
          client<{ count: number }[]>`
            select count(*)::integer as count from messaging.event_outbox
          `
        )
        assert.strictEqual(rows[0]!.count, 1)
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "scopes event idempotency by event type and version",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const idempotencyKey = crypto.randomUUID()
        const envelopes = yield* Effect.all([
          messaging.append(event(tenant!.id, { eventVersion: 1, idempotencyKey })),
          messaging.append(event(tenant!.id, { eventVersion: 2, idempotencyKey })),
        ], { concurrency: "unbounded" })
        assert.deepStrictEqual(envelopes.map((envelope) => envelope.eventVersion).sort(), [1, 2])

        const rows = yield* Effect.promise(() =>
          client<{ event_version: number }[]>`
            select event_version
            from messaging.event_outbox
            where tenant_id = ${tenant!.id}
              and event_type = 'sales.order.confirmed'
              and idempotency_key = ${idempotencyKey}
            order by event_version
          `
        )
        assert.deepStrictEqual([...rows], [{ event_version: 1 }, { event_version: 2 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "scopes event idempotency by event type",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const idempotencyKey = crypto.randomUUID()
        const envelopes = yield* Effect.all([
          messaging.append(event(tenant!.id, { idempotencyKey })),
          messaging.append(event(tenant!.id, {
            eventType: "inventory.stock.corrected",
            idempotencyKey,
          })),
        ], { concurrency: "unbounded" })
        assert.deepStrictEqual(
          envelopes.map((envelope) => envelope.eventType).sort(),
          ["inventory.stock.corrected", "sales.order.confirmed"],
        )

        const rows = yield* Effect.promise(() =>
          client<{ event_type: string }[]>`
            select event_type
            from messaging.event_outbox
            where tenant_id = ${tenant!.id}
              and event_version = 1
              and idempotency_key = ${idempotencyKey}
            order by event_type
          `
        )
        assert.deepStrictEqual([...rows], [
          { event_type: "inventory.stock.corrected" },
          { event_type: "sales.order.confirmed" },
        ])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "keeps event and idempotency identities tenant-scoped",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const tenants = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug)
            values (${crypto.randomUUID()}), (${crypto.randomUUID()})
            returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const eventId = crypto.randomUUID()
        const aggregateId = crypto.randomUUID()
        const idempotencyKey = crypto.randomUUID()
        const shared = { eventId, aggregateId, idempotencyKey }

        const envelopes = yield* Effect.all([
          messaging.append(event(tenants[0]!.id, shared)),
          messaging.append(event(tenants[1]!.id, shared)),
        ], { concurrency: "unbounded" })
        assert.strictEqual(envelopes[0].eventId, envelopes[1].eventId)
        assert.notStrictEqual(envelopes[0].tenantId, envelopes[1].tenantId)

        const rows = yield* Effect.promise(() =>
          client<{ count: number }[]>`
            select count(*)::integer as count
            from messaging.event_outbox
            where id = ${eventId} and idempotency_key = ${idempotencyKey}
          `
        )
        assert.deepStrictEqual(rows, [{ count: 2 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "scopes consumer receipts by tenant",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const tenants = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug)
            values (${crypto.randomUUID()}), (${crypto.randomUUID()})
            returning id
          `
        )
        const database = makePostgresDatabase(client)
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const eventId = crypto.randomUUID()
        const shared = event(tenants[0]!.id, {
          eventId,
          idempotencyKey: "shared-consumer-tenant-key",
        })
        yield* messaging.append(shared)
        yield* messaging.append({
          ...shared,
          tenantId: tenants[1]!.id,
          payload: { state: "other" },
        })
        const firstEvent = yield* messaging.getEvent({
          tenantId: tenants[0]!.id,
          eventId,
        })
        const otherEvent = yield* messaging.getEvent({
          tenantId: tenants[1]!.id,
          eventId,
        })
        assert.strictEqual(firstEvent?.tenantId, tenants[0]!.id)
        assert.strictEqual(otherEvent?.tenantId, tenants[1]!.id)
        assert.deepStrictEqual(otherEvent?.payload, { state: "other" })
        const missingEvent = yield* messaging.getEvent({
          tenantId: tenants[0]!.id,
          eventId: crypto.randomUUID(),
        })
        assert.isUndefined(missingEvent)
        const consumerId = "accounting.shared-tenant-consumer"
        const mutation = (tenantId: string) =>
          database.query(
            (db) =>
              db.execute(sql`
                update messaging.event_outbox
                set attempts = attempts + 1
                where tenant_id = ${tenantId} and id = ${eventId}
              `),
            "messaging.test.tenant-receipt-mutation",
          )
        const first = yield* messaging.consumeOnce({
          tenantId: tenants[0]!.id,
          consumerId,
          eventId,
        }, mutation(tenants[0]!.id))
        const other = yield* messaging.consumeOnce({
          tenantId: tenants[1]!.id,
          consumerId,
          eventId,
        }, mutation(tenants[1]!.id))
        const firstDuplicate = yield* messaging.consumeOnce({
          tenantId: tenants[0]!.id,
          consumerId,
          eventId,
        }, mutation(tenants[0]!.id))
        const otherDuplicate = yield* messaging.consumeOnce({
          tenantId: tenants[1]!.id,
          consumerId,
          eventId,
        }, mutation(tenants[1]!.id))
        assert.isFalse(first.duplicate)
        assert.isFalse(other.duplicate)
        assert.isTrue(firstDuplicate.duplicate)
        assert.isTrue(otherDuplicate.duplicate)
        const rows = yield* Effect.promise(() =>
          client<{ tenant_id: string; attempts: number; receipts: number }[]>`
            select e.tenant_id, e.attempts,
              (select count(*)::integer from messaging.consumer_receipts r
                where r.tenant_id = e.tenant_id
                  and r.consumer_id = ${consumerId}
                  and r.event_id = e.id) as receipts
            from messaging.event_outbox e
            where e.id = ${eventId}
            order by e.tenant_id
          `
        )
        assert.deepStrictEqual(rows.map(({ attempts, receipts }) => ({ attempts, receipts })), [
          { attempts: 1, receipts: 1 },
          { attempts: 1, receipts: 1 },
        ])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rejects cross-tenant receipts and rolls back their local mutation",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const tenants = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug)
            values (${crypto.randomUUID()}), (${crypto.randomUUID()})
            returning id
          `
        )
        const database = makePostgresDatabase(client)
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const source = yield* messaging.append(event(tenants[0]!.id))
        const mutation = database.query(
          (db) =>
            db.execute(sql`
              update messaging.event_outbox
              set attempts = attempts + 1
              where tenant_id = ${tenants[0]!.id} and id = ${source.eventId}
            `),
          "messaging.test.cross-tenant-mutation",
        )

        const failure = yield* Effect.flip(messaging.consumeOnce({
          tenantId: tenants[1]!.id,
          consumerId: "accounting.cross-tenant",
          eventId: source.eventId,
        }, mutation))
        assert.instanceOf(failure, DatabaseFailure)

        const rows = yield* Effect.promise(() =>
          client<{ attempts: number; receipts: number }[]>`
            select e.attempts,
              (select count(*)::integer from messaging.consumer_receipts r
                where r.consumer_id = 'accounting.cross-tenant'
                  and r.event_id = e.id) as receipts
            from messaging.event_outbox e
            where e.tenant_id = ${tenants[0]!.id} and e.id = ${source.eventId}
          `
        )
        assert.deepStrictEqual(rows, [{ attempts: 0, receipts: 0 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "concurrent mismatched envelopes produce one event and one typed conflict",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const idempotencyKey = crypto.randomUUID()
        const first = event(tenant!.id, { idempotencyKey, payload: { source: "first" } })
        const second = event(tenant!.id, { idempotencyKey, payload: { source: "second" } })

        const outcomes = yield* Effect.all([
          Effect.result(messaging.append(first)),
          Effect.result(messaging.append(second)),
        ], { concurrency: "unbounded" })
        const successes = outcomes.filter(Result.isSuccess)
        const failures = outcomes.filter(Result.isFailure)
        assert.strictEqual(successes.length, 1)
        assert.strictEqual(failures.length, 1)
        assert.instanceOf(failures[0]!.failure, EventIdempotencyConflict)

        const rows = yield* Effect.promise(() =>
          client<{ count: number }[]>`
            select count(*)::integer as count
            from messaging.event_outbox
            where tenant_id = ${tenant!.id} and idempotency_key = ${idempotencyKey}
          `
        )
        assert.deepStrictEqual(rows, [{ count: 1 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "concurrent event ID collision produces one event and one typed conflict",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const eventId = crypto.randomUUID()
        const first = event(tenant!.id, { eventId })
        const second = event(tenant!.id, {
          eventId,
          eventType: "inventory.stock.corrected",
        })

        const outcomes = yield* Effect.all([
          Effect.result(messaging.append(first)),
          Effect.result(messaging.append(second)),
        ], { concurrency: "unbounded" })
        const successes = outcomes.filter(Result.isSuccess)
        const failures = outcomes.filter(Result.isFailure)
        assert.strictEqual(successes.length, 1)
        assert.strictEqual(failures.length, 1)
        assert.instanceOf(failures[0]!.failure, EventIdempotencyConflict)

        const rows = yield* Effect.promise(() =>
          client<{ count: number }[]>`
            select count(*)::integer as count
            from messaging.event_outbox
            where tenant_id = ${tenant!.id} and id = ${eventId}
          `
        )
        assert.deepStrictEqual(rows, [{ count: 1 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "suppresses duplicates and lets failed consumers retry after receipt rollback",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const source = yield* messaging.append(event(tenant!.id))
        const input = {
          tenantId: tenant!.id,
          consumerId: "accounting.project-order",
          eventId: source.eventId,
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

        const failedInput = { ...input, consumerId: "inventory.project-order" }
        const rolledBackEvent = event(tenant!.id, {
          eventType: "inventory.order.projected",
          idempotencyKey: "failed-derived-event",
        })
        yield* Effect.flip(
          messaging.consumeOnce(
            failedInput,
            Effect.andThen(messaging.append(rolledBackEvent), Effect.fail("projection failed")),
          ),
        )
        const rolledBack = yield* Effect.promise(() =>
          client<{ events: number; receipts: number }[]>`
            select
              (select count(*)::integer from messaging.event_outbox
                where id = ${rolledBackEvent.eventId}) as events,
              (select count(*)::integer from messaging.consumer_receipts
                where tenant_id = ${tenant!.id}
                  and consumer_id = ${failedInput.consumerId}
                  and event_id = ${source.eventId}) as receipts
          `
        )
        assert.deepStrictEqual(rolledBack, [{ events: 0, receipts: 0 }])

        const retried = yield* messaging.consumeOnce(
          failedInput,
          messaging.append(rolledBackEvent),
        )
        assert.strictEqual(retried.duplicate, false)
        const recovered = yield* Effect.promise(() =>
          client<{ events: number; receipts: number }[]>`
            select
              (select count(*)::integer from messaging.event_outbox
                where id = ${rolledBackEvent.eventId}) as events,
              (select count(*)::integer from messaging.consumer_receipts
                where tenant_id = ${tenant!.id}
                  and consumer_id = ${failedInput.consumerId}
                  and event_id = ${source.eventId}) as receipts
          `
        )
        assert.deepStrictEqual(recovered, [{ events: 1, receipts: 1 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rejects receipt replay when source event identity changes",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const source = yield* messaging.append(event(tenant!.id))
        const input = {
          tenantId: tenant!.id,
          consumerId: "accounting.project-order",
          eventId: source.eventId,
        }
        yield* messaging.consumeOnce(input, Effect.succeed("completed"))
        yield* Effect.promise(() =>
          client`
            update messaging.event_outbox
            set event_type = 'tampered.event',
                event_version = 99,
                idempotency_key = 'tampered-key'
            where tenant_id = ${tenant!.id} and id = ${source.eventId}
          `
        )
        let executions = 0
        const failure = yield* Effect.flip(
          messaging.consumeOnce(input, Effect.sync(() => ++executions)),
        )
        assert.instanceOf(failure, DatabaseFailure)
        assert.strictEqual(executions, 0)
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rejects a missing source before running the consumer effect",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const input = {
          tenantId: tenant!.id,
          consumerId: "accounting.missing-source",
          eventId: crypto.randomUUID(),
        }
        let executions = 0
        const failure = yield* Effect.flip(
          messaging.consumeOnce(input, Effect.sync(() => ++executions)),
        )
        assert.instanceOf(failure, DatabaseFailure)
        assert.strictEqual(executions, 0)
        const rows = yield* Effect.promise(() =>
          client<{ receipts: number }[]>`
            select count(*)::integer as receipts
            from messaging.consumer_receipts
            where tenant_id = ${tenant!.id}
              and consumer_id = ${input.consumerId}
              and event_id = ${input.eventId}
          `
        )
        assert.deepStrictEqual(rows, [{ receipts: 0 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "lets distinct consumers independently complete the same event",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const database = makePostgresDatabase(client)
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const source = yield* messaging.append(event(tenant!.id))
        const mutation = database.query(
          (db) =>
            db.execute(sql`
              update messaging.event_outbox
              set attempts = attempts + 1
              where tenant_id = ${tenant!.id} and id = ${source.eventId}
            `),
          "messaging.test.distinct-consumer-mutation",
        )

        const results = yield* Effect.all([
          messaging.consumeOnce({
            tenantId: tenant!.id,
            consumerId: "accounting.consumer-a",
            eventId: source.eventId,
          }, mutation),
          messaging.consumeOnce({
            tenantId: tenant!.id,
            consumerId: "inventory.consumer-b",
            eventId: source.eventId,
          }, mutation),
        ], { concurrency: "unbounded" })
        assert.isFalse(results[0].duplicate)
        assert.isFalse(results[1].duplicate)

        const rows = yield* Effect.promise(() =>
          client<{ attempts: number; receipts: number }[]>`
            select e.attempts,
              (select count(*)::integer from messaging.consumer_receipts r
                where r.tenant_id = e.tenant_id and r.event_id = e.id) as receipts
            from messaging.event_outbox e
            where e.tenant_id = ${tenant!.id} and e.id = ${source.eventId}
          `
        )
        assert.deepStrictEqual(rows, [{ attempts: 2, receipts: 2 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rolls back the losing concurrent consumer's non-idempotent local mutation",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const database = makePostgresDatabase(client)
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const source = yield* messaging.append(event(tenant!.id))
        const input = {
          tenantId: tenant!.id,
          consumerId: "accounting.increment-attempts",
          eventId: source.eventId,
        }
        const mutation = database.query(
          (db) =>
            db.execute(sql`
              update messaging.event_outbox
              set attempts = attempts + 1
              where tenant_id = ${tenant!.id} and id = ${source.eventId}
            `),
          "messaging.test.increment-attempts",
        )

        const results = yield* Effect.all([
          messaging.consumeOnce(input, mutation),
          messaging.consumeOnce(input, mutation),
        ], { concurrency: "unbounded" })
        assert.strictEqual(results.filter((result) => !result.duplicate).length, 1)
        assert.strictEqual(results.filter((result) => result.duplicate).length, 1)

        const rows = yield* Effect.promise(() =>
          client<{ attempts: number; receipts: number }[]>`
            select e.attempts,
              (select count(*)::integer from messaging.consumer_receipts r
                where r.tenant_id = e.tenant_id
                  and r.consumer_id = ${input.consumerId}
                  and r.event_id = e.id) as receipts
            from messaging.event_outbox e
            where e.tenant_id = ${tenant!.id} and e.id = ${source.eventId}
          `
        )
        assert.deepStrictEqual(rows, [{ attempts: 1, receipts: 1 }])
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "commits one derived event and receipt across concurrent duplicate consumers",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, makePostgresDatabase(client)),
        )
        const source = yield* messaging.append(event(tenant!.id))
        const derived = event(tenant!.id, {
          eventType: "accounting.order.projected",
          causationId: source.eventId,
          idempotencyKey: "derived-event",
        })
        const input = {
          tenantId: tenant!.id,
          consumerId: "accounting.project-order",
          eventId: source.eventId,
        }

        const results = yield* Effect.all([
          messaging.consumeOnce(input, messaging.append(derived)),
          messaging.consumeOnce(input, messaging.append(derived)),
        ], { concurrency: "unbounded" })
        assert.strictEqual(results.filter((result) => !result.duplicate).length, 1)
        assert.strictEqual(results.filter((result) => result.duplicate).length, 1)

        const rows = yield* Effect.promise(() =>
          client<{ events: number; receipts: number }[]>`
            select
              (select count(*)::integer from messaging.event_outbox
                where id = ${derived.eventId}) as events,
              (select count(*)::integer from messaging.consumer_receipts
                where tenant_id = ${tenant!.id}
                  and consumer_id = ${input.consumerId}
                  and event_id = ${source.eventId}) as receipts
          `
        )
        assert.deepStrictEqual(rows, [{ events: 1, receipts: 1 }])
      })),
)
