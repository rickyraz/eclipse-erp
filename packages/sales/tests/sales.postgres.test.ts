import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  CustomerNotFound,
  makeSalesService,
  SalesCapabilities,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderConfirmedEvent,
} from "../mod.ts"
import { Database, DatabaseFailure, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const principal = { userAccountId: "sales-postgres", sessionId: "session" }
const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)
const capabilities = [
  SalesCapabilities.customerCreate,
  SalesCapabilities.orderCreate,
  SalesCapabilities.orderConfirm,
] as const

it.effect.skipIf(databaseUrl === undefined)(
  "order confirmation atomic publication preserves replay and rollback",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability,
          })),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.succeed(MessagingService, messaging),
          )
          const sales = yield* Effect.provide(makeSalesService, requirements)
          const customer = yield* sales.createCustomer({
            principal,
            tenantId: tenant!.id,
            name: "Sales Customer",
            email: "sales-postgres@example.test",
          })
          const order = yield* sales.createOrder({
            principal,
            tenantId: tenant!.id,
            customerId: customer.id,
            lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "100.00" }],
          })
          const input = {
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            commandId: "sales-confirm-command",
            correlationId: "sales-confirm-correlation",
            causationId: null,
            idempotencyKey: "sales-confirm-1",
          }
          const confirmed = yield* sales.confirmOrder(input)
          const repeated = yield* sales.confirmOrder(input)

          assert.strictEqual(confirmed.status, "confirmed")
          assert.strictEqual(confirmed.id, repeated.id)
          const rows = yield* Effect.promise(() =>
            client<{ status: string; confirmation_idempotency_key: string }[]>`
              select status, confirmation_idempotency_key
              from sales.orders
              where tenant_id = ${tenant!.id} and id = ${order.id}
            `
          )
          assert.strictEqual(rows[0]?.status, "confirmed")
          assert.strictEqual(rows[0]?.confirmation_idempotency_key, "sales-confirm-1")
          const events = yield* Effect.promise(() =>
            client<{
              id: string
              event_type: string
              event_version: number
              aggregate_type: string
              command_id: string
              correlation_id: string
              causation_id: string | null
              idempotency_key: string
              payload: unknown
            }[]>`
              select id, event_type, event_version, aggregate_type, command_id, correlation_id,
                causation_id, idempotency_key, payload
              from messaging.event_outbox
              where tenant_id = ${tenant!.id} and event_type = ${SalesOrderConfirmedEvent.id}
            `
          )
          assert.strictEqual(events.length, 1)
          yield* Schema.decodeUnknownEffect(SalesOrderConfirmedEvent.payloadSchema)(
            events[0]?.payload,
          )
          assert.notStrictEqual(events[0]?.id, order.id)
          assert.deepStrictEqual(events[0], {
            id: events[0]!.id,
            event_type: SalesOrderConfirmedEvent.id,
            event_version: SalesOrderConfirmedEvent.version,
            aggregate_type: SalesOrderConfirmedEvent.aggregateType,
            command_id: input.commandId,
            correlation_id: input.correlationId,
            causation_id: input.causationId,
            idempotency_key: input.idempotencyKey,
            payload: { orderId: order.id, total: "100.00" },
          })

          const rollbackOrder = yield* sales.createOrder({
            principal,
            tenantId: tenant!.id,
            customerId: customer.id,
            lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "25.00" }],
          })
          const failingSales = yield* Effect.provide(
            makeSalesService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(MessagingService, {
                ...messaging,
                append: () =>
                  Effect.fail(
                    new DatabaseFailure({ operation: "messaging.test.append", cause: null }),
                  ),
              }),
            ),
          )
          assert.instanceOf(
            yield* Effect.flip(failingSales.confirmOrder({
              ...input,
              orderId: rollbackOrder.id,
              commandId: "sales-confirm-rollback-command",
              correlationId: "sales-confirm-rollback-correlation",
              idempotencyKey: "sales-confirm-rollback",
            })),
            DatabaseFailure,
          )
          const rollbackRows = yield* Effect.promise(() =>
            client<{
              status: string
              confirmed_at: Date | null
              confirmation_idempotency_key: string | null
              events: number
            }[]>`
              select o.status, o.confirmed_at, o.confirmation_idempotency_key,
                (select count(*)::integer from messaging.event_outbox e
                  where e.tenant_id = o.tenant_id
                    and e.aggregate_type = 'sales_order'
                    and e.aggregate_id = o.id
                    and e.event_type = 'sales.order.confirmed') as events
              from sales.orders o
              where o.tenant_id = ${tenant!.id} and o.id = ${rollbackOrder.id}
            `
          )
          assert.strictEqual(rollbackRows[0]?.status, "draft")
          assert.isNull(rollbackRows[0]?.confirmed_at)
          assert.isNull(rollbackRows[0]?.confirmation_idempotency_key)
          assert.strictEqual(rollbackRows[0]?.events, 0)

          const retried = yield* sales.confirmOrder({
            ...input,
            orderId: rollbackOrder.id,
            commandId: "sales-confirm-retry-command",
            correlationId: "sales-confirm-retry-correlation",
            idempotencyKey: "sales-confirm-rollback",
          })
          assert.strictEqual(retried.status, "confirmed")
          const retryEvents = yield* Effect.promise(() =>
            client<{ count: number }[]>`
              select count(*)::integer as count
              from messaging.event_outbox
              where tenant_id = ${tenant!.id}
                and aggregate_type = 'sales_order'
                and aggregate_id = ${rollbackOrder.id}
                and event_type = 'sales.order.confirmed'
            `
          )
          assert.strictEqual(retryEvents[0]?.count, 1)

          assert.instanceOf(
            yield* Effect.flip(sales.confirmOrder({
              principal,
              tenantId: tenant!.id,
              orderId: order.id,
              commandId: "sales-confirm-conflict-command",
              correlationId: "sales-confirm-conflict-correlation",
              causationId: null,
              idempotencyKey: "sales-confirm-2",
            })),
            SalesOrderConfirmationIdempotencyConflict,
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rejects orphaned order confirmation metadata in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
        )
        const [customer] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into sales.customers (tenant_id, name, email)
            values (${tenant!.id}, 'Metadata Customer', ${crypto.randomUUID()} || '@example.test')
            returning id
          `
        )
        const draftKey = yield* postgresFailure(() =>
          client`
            insert into sales.orders
              (tenant_id, customer_id, status, confirmation_idempotency_key, total)
            values (${tenant!.id}, ${customer!.id}, 'draft', 'orphaned-key', 10)
          `
        )
        const confirmedKey = yield* postgresFailure(() =>
          client`
            insert into sales.orders
              (tenant_id, customer_id, status, confirmed_at, total)
            values (${tenant!.id}, ${customer!.id}, 'confirmed', now(), 10)
          `
        )
        for (const failure of [draftKey, confirmedKey]) {
          assert.strictEqual((failure as { code?: string }).code, "23514")
          assert.strictEqual(
            (failure as { constraint_name?: string }).constraint_name,
            "orders_confirmation_metadata_check",
          )
        }
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rejects a cross-tenant customer reference through the PostgreSQL constraint",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenantA, tenantB] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug)
            values (${crypto.randomUUID()}), (${crypto.randomUUID()})
            returning id
          `
        )
        const authorizationLayer = makeAuthorizationTestLayer(
          [tenantA!.id, tenantB!.id].flatMap((tenantId) =>
            capabilities.map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId,
              capability,
            }))
          ),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const sales = yield* Effect.provide(
            makeSalesService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(MessagingService, messaging),
            ),
          )
          const customer = yield* sales.createCustomer({
            principal,
            tenantId: tenantA!.id,
            name: "Tenant A Customer",
            email: "tenant-a@example.test",
          })
          assert.instanceOf(
            yield* Effect.flip(sales.createOrder({
              principal,
              tenantId: tenantB!.id,
              customerId: customer.id,
              lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "10.00" }],
            })),
            CustomerNotFound,
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)
