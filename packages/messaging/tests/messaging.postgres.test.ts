import { assert, it } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { EventIdempotencyConflict, makeMessagingService } from "../mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

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
  "appends an event idempotently and rejects a mismatched envelope in PostgreSQL",
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
        const first = yield* messaging.append(input)
        const duplicate = yield* messaging.append(input)

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
