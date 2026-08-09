import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  CustomerNotFound,
  makeSalesService,
  SalesCapabilities,
  SalesOrderConfirmationIdempotencyConflict,
} from "../mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const principal = { userAccountId: "sales-postgres", sessionId: "session" }
const capabilities = [
  SalesCapabilities.customerCreate,
  SalesCapabilities.orderCreate,
  SalesCapabilities.orderConfirm,
] as const

it.effect.skipIf(databaseUrl === undefined)(
  "persists order confirmation and returns the committed result for retries",
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
          const sales = yield* Effect.provide(
            makeSalesService,
            Layer.merge(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
            ),
          )
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
          const confirmed = yield* sales.confirmOrder({
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            idempotencyKey: "sales-confirm-1",
          })
          const repeated = yield* sales.confirmOrder({
            principal,
            tenantId: tenant!.id,
            orderId: order.id,
            idempotencyKey: "sales-confirm-1",
          })

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

          assert.instanceOf(
            yield* Effect.flip(sales.confirmOrder({
              principal,
              tenantId: tenant!.id,
              orderId: order.id,
              idempotencyKey: "sales-confirm-2",
            })),
            SalesOrderConfirmationIdempotencyConflict,
          )
        }).pipe(Effect.provide(authorizationLayer))
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
          const sales = yield* Effect.provide(
            makeSalesService,
            Layer.merge(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
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
