import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makeMessagingTestLayer } from "../../messaging/mod.ts"
import {
  CustomerAlreadyExists,
  makeSalesTestLayer,
  SalesOrderConfirmationIdempotencyConflict,
  SalesService,
} from "../mod.ts"

const principal = { userAccountId: "seller", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const confirmationMetadata = {
  commandId: "sales-confirm-command",
  correlationId: "sales-confirm-correlation",
  causationId: null,
} as const
const capabilities = [
  "sales.customer.create",
  "sales.quotation.create",
  "sales.order.create",
  "sales.order.confirm",
  "sales.order.cancel",
] as const

const authorizationLayer = makeAuthorizationTestLayer(
  [tenantId, "00000000-0000-4000-8000-000000000002"].flatMap((tenantId) =>
    capabilities.map((capability) => ({
      userAccountId: principal.userAccountId,
      tenantId,
      capability,
    }))
  ),
)

const withSales = <A, E>(program: Effect.Effect<A, E, SalesService>) =>
  Effect.provide(
    program,
    makeSalesTestLayer().pipe(
      Layer.provide(Layer.merge(authorizationLayer, makeMessagingTestLayer())),
    ),
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
        lines: [{ itemId: "item-1", quantity: "10", unitPrice: "125.00" }],
      })

      assert.strictEqual(customer.email, "sales@acme.test")
      assert.strictEqual(quotation.status, "draft")
      assert.strictEqual(order.quotationId, quotation.id)

      const confirmed = yield* sales.confirmOrder({
        principal,
        tenantId,
        orderId: order.id,
        ...confirmationMetadata,
        idempotencyKey: "confirm-1",
      })
      const repeated = yield* sales.confirmOrder({
        principal,
        tenantId,
        orderId: order.id,
        ...confirmationMetadata,
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
        lines: [{ itemId: "item-1", quantity: "1", unitPrice: "10.00" }],
      })
      yield* sales.confirmOrder({
        principal,
        tenantId,
        orderId: order.id,
        ...confirmationMetadata,
        idempotencyKey: "confirm-a",
      })
      assert.instanceOf(
        yield* Effect.flip(sales.confirmOrder({
          principal,
          tenantId,
          orderId: order.id,
          ...confirmationMetadata,
          idempotencyKey: "confirm-b",
        })),
        SalesOrderConfirmationIdempotencyConflict,
      )
    })))

  it.effect("denies sales capability in an ungranted tenant", () =>
    withSales(Effect.gen(function* () {
      const sales = yield* SalesService
      assert.instanceOf(
        yield* Effect.flip(sales.createCustomer({
          principal,
          tenantId: "00000000-0000-4000-8000-000000000003",
          name: "Untrusted Tenant Customer",
          email: "untrusted@example.test",
        })),
        AuthorizationDenied,
      )
    })))

  it.effect("denies sales cancellation in an ungranted tenant", () =>
    withSales(Effect.gen(function* () {
      const sales = yield* SalesService
      assert.instanceOf(
        yield* Effect.flip(sales.cancelOrder({
          principal,
          tenantId: "00000000-0000-4000-8000-000000000003",
          orderId: "00000000-0000-4000-8000-000000000099",
        })),
        AuthorizationDenied,
      )
    })))

  it.effect("denies sales confirmation in an ungranted tenant", () =>
    withSales(Effect.gen(function* () {
      const sales = yield* SalesService
      assert.instanceOf(
        yield* Effect.flip(sales.confirmOrder({
          principal,
          tenantId: "00000000-0000-4000-8000-000000000003",
          orderId: "00000000-0000-4000-8000-000000000099",
          ...confirmationMetadata,
          idempotencyKey: "ungranted-confirmation",
        })),
        AuthorizationDenied,
      )
    })))

  it.effect("enforces tenant email uniqueness", () =>
    withSales(Effect.gen(function* () {
      const sales = yield* SalesService
      const command = { principal, tenantId, name: "ACME", email: "same@acme.test" }
      const customer = yield* sales.createCustomer(command)
      assert.instanceOf(yield* Effect.flip(sales.createCustomer(command)), CustomerAlreadyExists)
      const otherCustomer = yield* sales.createCustomer({
        ...command,
        tenantId: "00000000-0000-4000-8000-000000000002",
      })
      assert.notStrictEqual(otherCustomer.id, customer.id)
      assert.strictEqual(otherCustomer.email, customer.email)
    })))
})
