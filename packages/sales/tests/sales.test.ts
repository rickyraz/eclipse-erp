import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  CustomerAlreadyExists,
  makeSalesTestLayer,
  SalesOrderConfirmationIdempotencyConflict,
  SalesService,
} from "../mod.ts"

const principal = { userAccountId: "seller", sessionId: "session" }
const tenantId = "tenant-a"
const capabilities = [
  "sales.customer.create",
  "sales.quotation.create",
  "sales.order.create",
  "sales.order.confirm",
] as const

const authorizationLayer = makeAuthorizationTestLayer(
  capabilities.map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability })),
)

const withSales = <A, E>(program: Effect.Effect<A, E, SalesService>) =>
  Effect.provide(
    program,
    makeSalesTestLayer().pipe(Layer.provide(authorizationLayer)),
  )

describe("sales contract", () => {
  it.effect("creates customer, quotation, and order", () =>
    withSales(Effect.gen(function* () {
      const sales = yield* SalesService
      const customer = yield* sales.createCustomer({
        principal,
        tenantId,
        name: "ACME",
        email: " SALES@ACME.TEST ",
      })
      const quotation = yield* sales.createQuotation({
        principal,
        tenantId,
        customerId: customer.id,
        total: "1250.00",
      })
      const order = yield* sales.createOrder({
        principal,
        tenantId,
        customerId: customer.id,
        quotationId: quotation.id,
        total: quotation.total,
      })

      assert.strictEqual(customer.email, "sales@acme.test")
      assert.strictEqual(quotation.status, "draft")
      assert.strictEqual(order.quotationId, quotation.id)

      const confirmed = yield* sales.confirmOrder({
        principal,
        tenantId,
        orderId: order.id,
        idempotencyKey: "confirm-1",
      })
      const repeated = yield* sales.confirmOrder({
        principal,
        tenantId,
        orderId: order.id,
        idempotencyKey: "confirm-1",
      })
      assert.strictEqual(confirmed.status, "confirmed")
      assert.strictEqual(confirmed.id, repeated.id)
      assert.isNotNull(confirmed.confirmedAt)
    })))

  it.effect("rejects a different confirmation key after confirmation", () =>
    withSales(Effect.gen(function* () {
      const sales = yield* SalesService
      const customer = yield* sales.createCustomer({
        principal,
        tenantId,
        name: "ACME",
        email: "confirm-key@acme.test",
      })
      const order = yield* sales.createOrder({
        principal,
        tenantId,
        customerId: customer.id,
        total: "10.00",
      })
      yield* sales.confirmOrder({
        principal,
        tenantId,
        orderId: order.id,
        idempotencyKey: "confirm-a",
      })
      assert.instanceOf(
        yield* Effect.flip(sales.confirmOrder({
          principal,
          tenantId,
          orderId: order.id,
          idempotencyKey: "confirm-b",
        })),
        SalesOrderConfirmationIdempotencyConflict,
      )
    })))

  it.effect("enforces tenant email uniqueness", () =>
    withSales(Effect.gen(function* () {
      const sales = yield* SalesService
      const command = { principal, tenantId, name: "ACME", email: "same@acme.test" }
      yield* sales.createCustomer(command)
      assert.instanceOf(yield* Effect.flip(sales.createCustomer(command)), CustomerAlreadyExists)
    })))
})
