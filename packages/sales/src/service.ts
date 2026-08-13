import { and, eq } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { customers, orderLines, orders, quotations } from "../../../db/schema/sales.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { SalesCapabilities } from "./capabilities.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"
import { EventIdempotencyConflict, MessagingService } from "../../messaging/mod.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Money = Schema.String.check(Schema.isPattern(/^\d{1,12}(\.\d{1,2})?$/))
const Quantity = Schema.String.check(Schema.isPattern(/^[1-9]\d*$/))

export const Customer = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

export const Quotation = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  customerId: Schema.String,
  status: Schema.Literals(["draft", "sent", "accepted", "rejected", "expired"]),
  total: Money,
})

export const SalesOrderLine = Schema.Struct({
  itemId: Schema.String,
  quantity: Quantity,
  unitPrice: Money,
})

export const SalesOrder = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  customerId: Schema.String,
  quotationId: Schema.NullOr(Schema.String),
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  confirmedAt: Schema.NullOr(Schema.String),
  total: Money,
  lines: Schema.Array(SalesOrderLine),
})

export type Customer = Schema.Schema.Type<typeof Customer>
export type Quotation = Schema.Schema.Type<typeof Quotation>
export type SalesOrderLine = Schema.Schema.Type<typeof SalesOrderLine>
export type SalesOrder = Schema.Schema.Type<typeof SalesOrder>

const ScopedInput = { principal: Principal, tenantId: Schema.String }

export const CreateCustomerInput = Schema.Struct({
  ...ScopedInput,
  name: Schema.String,
  email: Schema.String,
})

export const CreateQuotationInput = Schema.Struct({
  ...ScopedInput,
  customerId: Schema.String,
  total: Money,
})

export const CreateOrderInput = Schema.Struct({
  ...ScopedInput,
  customerId: Schema.String,
  quotationId: Schema.optionalKey(Schema.String),
  lines: Schema.Array(SalesOrderLine).check(Schema.isMinLength(1)),
})

export const ConfirmOrderInput = Schema.Struct({
  ...ScopedInput,
  orderId: Schema.String,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  idempotencyKey: NonEmptyString,
})

export const CancelOrderInput = Schema.Struct({
  ...ScopedInput,
  orderId: Schema.String,
})

export class CustomerAlreadyExists
  extends Schema.TaggedErrorClass<CustomerAlreadyExists>()("CustomerAlreadyExists", {
    tenantId: Schema.String,
    email: Schema.String,
  }) {}

export class CustomerNotFound
  extends Schema.TaggedErrorClass<CustomerNotFound>()("CustomerNotFound", {
    tenantId: Schema.String,
    customerId: Schema.String,
  }) {}

export class QuotationNotFound
  extends Schema.TaggedErrorClass<QuotationNotFound>()("QuotationNotFound", {
    tenantId: Schema.String,
    quotationId: Schema.String,
  }) {}
export class SalesOrderNotFound
  extends Schema.TaggedErrorClass<SalesOrderNotFound>()("SalesOrderNotFound", {
    tenantId: Schema.String,
    orderId: Schema.String,
  }) {}
export class SalesOrderInvalidState
  extends Schema.TaggedErrorClass<SalesOrderInvalidState>()("SalesOrderInvalidState", {
    tenantId: Schema.String,
    orderId: Schema.String,
    status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  }) {}
export class SalesOrderConfirmationIdempotencyConflict
  extends Schema.TaggedErrorClass<SalesOrderConfirmationIdempotencyConflict>()(
    "SalesOrderConfirmationIdempotencyConflict",
    {
      tenantId: Schema.String,
      orderId: Schema.String,
      idempotencyKey: Schema.String,
    },
  ) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface SalesService {
  readonly createCustomer: (
    input: unknown,
  ) => Effect.Effect<Customer, CustomerAlreadyExists | CommonFailure>
  readonly createQuotation: (
    input: unknown,
  ) => Effect.Effect<Quotation, CustomerNotFound | CommonFailure>
  readonly createOrder: (
    input: unknown,
  ) => Effect.Effect<SalesOrder, CustomerNotFound | QuotationNotFound | CommonFailure>
  readonly confirmOrder: (
    input: unknown,
  ) => Effect.Effect<
    SalesOrder,
    | EventIdempotencyConflict
    | SalesOrderConfirmationIdempotencyConflict
    | SalesOrderInvalidState
    | SalesOrderNotFound
    | CommonFailure
  >
  readonly cancelOrder: (
    input: unknown,
  ) => Effect.Effect<SalesOrder, SalesOrderInvalidState | SalesOrderNotFound | CommonFailure>
}

export const SalesService = Context.Service<SalesService>("EclipseERP/SalesService")

const customerSelection = {
  id: customers.id,
  tenantId: customers.tenantId,
  name: customers.name,
  email: customers.email,
}

const quotationSelection = {
  id: quotations.id,
  tenantId: quotations.tenantId,
  customerId: quotations.customerId,
  status: quotations.status,
  total: quotations.total,
}

const orderSelection = {
  id: orders.id,
  tenantId: orders.tenantId,
  customerId: orders.customerId,
  quotationId: orders.quotationId,
  status: orders.status,
  confirmedAt: orders.confirmedAt,
  total: orders.total,
}

const orderLineSelection = {
  itemId: orderLines.itemId,
  quantity: orderLines.quantity,
  unitPrice: orderLines.unitPrice,
}

const toSalesOrder = (row: {
  readonly id: string
  readonly tenantId: string
  readonly customerId: string
  readonly quotationId: string | null
  readonly status: "draft" | "confirmed" | "cancelled"
  readonly confirmedAt: Date | null
  readonly total: string
}, lines: ReadonlyArray<SalesOrderLine>): SalesOrder => ({
  id: row.id,
  tenantId: row.tenantId,
  customerId: row.customerId,
  quotationId: row.quotationId,
  status: row.status,
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  total: row.total,
  lines,
})

const deriveTotal = (lines: ReadonlyArray<SalesOrderLine>): string => {
  const cents = lines.reduce((total, line) => {
    const [whole, fraction = ""] = line.unitPrice.split(".")
    return total + BigInt(line.quantity) * (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0")))
  }, 0n)
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

export const makeSalesService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const messaging = yield* MessagingService
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())
  return {
    createCustomer: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateCustomerInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: SalesCapabilities.customerCreate,
        })
        const email = decoded.email.trim().toLowerCase()
        const rows = yield* database.query(
          (db) =>
            db.insert(customers)
              .values({ tenantId: decoded.tenantId, name: decoded.name.trim(), email })
              .returning(customerSelection),
          "sales.customer.create",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "customers_tenant_email_key")
              ? new CustomerAlreadyExists({ tenantId: decoded.tenantId, email })
              : error
          ),
        )
        return rows[0]!
      }),
    createQuotation: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateQuotationInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: SalesCapabilities.quotationCreate,
        })
        const rows = yield* database.query(
          (db) =>
            db.insert(quotations)
              .values({
                tenantId: decoded.tenantId,
                customerId: decoded.customerId,
                total: decoded.total,
              })
              .returning(quotationSelection),
          "sales.quotation.create",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "quotations_tenant_customer_fkey", "23503")
              ? new CustomerNotFound({ tenantId: decoded.tenantId, customerId: decoded.customerId })
              : error
          ),
        )
        return rows[0]!
      }),
    createOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: SalesCapabilities.orderCreate,
        })
        return yield* database.transaction(
          async (tx) => {
            const [order] = await tx.insert(orders)
              .values({
                tenantId: decoded.tenantId,
                customerId: decoded.customerId,
                quotationId: decoded.quotationId,
                total: deriveTotal(decoded.lines),
              })
              .returning(orderSelection)
            const lines = await tx.insert(orderLines)
              .values(decoded.lines.map((line) => ({
                tenantId: decoded.tenantId,
                orderId: order!.id,
                itemId: line.itemId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              })))
              .returning(orderLineSelection)
            return toSalesOrder(order!, lines)
          },
          "sales.order.create",
        ).pipe(
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "orders_tenant_customer_fkey", "23503")) {
              return new CustomerNotFound({
                tenantId: decoded.tenantId,
                customerId: decoded.customerId,
              })
            }
            if (
              decoded.quotationId !== undefined &&
              isDatabaseConstraint(error, "orders_tenant_quotation_fkey", "23503")
            ) {
              return new QuotationNotFound({
                tenantId: decoded.tenantId,
                quotationId: decoded.quotationId,
              })
            }
            return error
          }),
        )
      }),
    confirmOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConfirmOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: SalesCapabilities.orderConfirm,
        })
        const result = yield* database.withTransaction(
          Effect.gen(function* () {
            const mutation = yield* database.transaction(
              async (tx) => {
                const [row] = await tx.select({
                  ...orderSelection,
                  confirmationIdempotencyKey: orders.confirmationIdempotencyKey,
                })
                  .from(orders)
                  .where(
                    and(
                      eq(orders.tenantId, decoded.tenantId),
                      eq(orders.id, decoded.orderId),
                    ),
                  )
                  .for("update")
                if (row === undefined) return { _tag: "not-found" as const }
                const lines = await tx.select(orderLineSelection)
                  .from(orderLines)
                  .where(
                    and(eq(orderLines.tenantId, decoded.tenantId), eq(orderLines.orderId, row.id)),
                  )
                const current = toSalesOrder(row, lines)
                if (row.status === "confirmed") {
                  return row.confirmationIdempotencyKey === decoded.idempotencyKey
                    ? { _tag: "existing" as const, order: current }
                    : { _tag: "idempotency-conflict" as const }
                }
                if (row.status !== "draft") {
                  return { _tag: "invalid-state" as const, status: row.status }
                }
                const confirmedAt = now()
                const [confirmed] = await tx.update(orders)
                  .set({
                    status: "confirmed",
                    confirmationIdempotencyKey: decoded.idempotencyKey,
                    confirmedAt,
                    updatedAt: confirmedAt,
                  })
                  .where(
                    and(
                      eq(orders.tenantId, decoded.tenantId),
                      eq(orders.id, decoded.orderId),
                      eq(orders.status, "draft"),
                    ),
                  )
                  .returning(orderSelection)
                return { _tag: "confirmed" as const, order: toSalesOrder(confirmed!, lines) }
              },
              "sales.order.confirm",
            )
            if (mutation._tag === "confirmed") {
              yield* messaging.append({
                eventId: crypto.randomUUID(),
                eventType: "sales.order.confirmed",
                eventVersion: 1,
                tenantId: decoded.tenantId,
                aggregateType: "sales_order",
                aggregateId: mutation.order.id,
                commandId: decoded.commandId,
                correlationId: decoded.correlationId,
                causationId: decoded.causationId,
                idempotencyKey: decoded.idempotencyKey,
                actorPrincipalId: decoded.principal.userAccountId,
                occurredAt: mutation.order.confirmedAt!,
                payload: { orderId: mutation.order.id, total: mutation.order.total },
              })
            }
            return mutation
          }),
          "sales.order.confirm.atomic",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "orders_tenant_confirmation_idempotency_key")
              ? new SalesOrderConfirmationIdempotencyConflict({
                tenantId: decoded.tenantId,
                orderId: decoded.orderId,
                idempotencyKey: decoded.idempotencyKey,
              })
              : error
          ),
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
          )
        }
        if (result._tag === "idempotency-conflict") {
          return yield* Effect.fail(
            new SalesOrderConfirmationIdempotencyConflict({
              tenantId: decoded.tenantId,
              orderId: decoded.orderId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new SalesOrderInvalidState({
              tenantId: decoded.tenantId,
              orderId: decoded.orderId,
              status: result.status,
            }),
          )
        }
        return result.order
      }),
    cancelOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CancelOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: SalesCapabilities.orderCancel,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select(orderSelection)
              .from(orders)
              .where(and(eq(orders.tenantId, decoded.tenantId), eq(orders.id, decoded.orderId)))
              .for("update")
            if (row === undefined) return { _tag: "not-found" as const }
            const lines = await tx.select(orderLineSelection)
              .from(orderLines)
              .where(and(eq(orderLines.tenantId, decoded.tenantId), eq(orderLines.orderId, row.id)))
            if (row.status === "cancelled") {
              return { _tag: "existing" as const, order: toSalesOrder(row, lines) }
            }
            if (row.status !== "confirmed") {
              return { _tag: "invalid-state" as const, status: row.status }
            }
            const [cancelled] = await tx.update(orders)
              .set({ status: "cancelled", updatedAt: now() })
              .where(and(
                eq(orders.tenantId, decoded.tenantId),
                eq(orders.id, decoded.orderId),
                eq(orders.status, "confirmed"),
              ))
              .returning(orderSelection)
            return { _tag: "cancelled" as const, order: toSalesOrder(cancelled!, lines) }
          },
          "sales.order.cancel",
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new SalesOrderInvalidState({
              tenantId: decoded.tenantId,
              orderId: decoded.orderId,
              status: result.status,
            }),
          )
        }
        return result.order
      }),
  } satisfies SalesService
})

export const makeSalesTestLayer = () =>
  Layer.effect(
    SalesService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const messaging = yield* MessagingService
      const storedCustomers = new Map<string, Customer>()
      const storedQuotations = new Map<string, Quotation>()
      const storedOrders = new Map<string, SalesOrder>()
      const confirmationKeys = new Map<string, string>()
      const nextId = () => crypto.randomUUID()
      const service: SalesService = {
        createCustomer: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateCustomerInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: SalesCapabilities.customerCreate,
            })
            const email = decoded.email.trim().toLowerCase()
            if (
              [...storedCustomers.values()].some((customer) =>
                customer.tenantId === decoded.tenantId && customer.email === email
              )
            ) {
              return yield* Effect.fail(
                new CustomerAlreadyExists({ tenantId: decoded.tenantId, email }),
              )
            }
            const customer = {
              id: nextId(),
              tenantId: decoded.tenantId,
              name: decoded.name.trim(),
              email,
            }
            storedCustomers.set(customer.id, customer)
            return customer
          }),
        createQuotation: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateQuotationInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: SalesCapabilities.quotationCreate,
            })
            if (storedCustomers.get(decoded.customerId)?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new CustomerNotFound({
                  tenantId: decoded.tenantId,
                  customerId: decoded.customerId,
                }),
              )
            }
            const quotation: Quotation = {
              id: nextId(),
              tenantId: decoded.tenantId,
              customerId: decoded.customerId,
              status: "draft",
              total: decoded.total,
            }
            storedQuotations.set(quotation.id, quotation)
            return quotation
          }),
        createOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: SalesCapabilities.orderCreate,
            })
            if (storedCustomers.get(decoded.customerId)?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new CustomerNotFound({
                  tenantId: decoded.tenantId,
                  customerId: decoded.customerId,
                }),
              )
            }
            if (
              decoded.quotationId !== undefined &&
              storedQuotations.get(decoded.quotationId)?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(
                new QuotationNotFound({
                  tenantId: decoded.tenantId,
                  quotationId: decoded.quotationId,
                }),
              )
            }
            const order: SalesOrder = {
              id: nextId(),
              tenantId: decoded.tenantId,
              customerId: decoded.customerId,
              quotationId: decoded.quotationId ?? null,
              status: "draft",
              confirmedAt: null,
              total: deriveTotal(decoded.lines),
              lines: decoded.lines,
            }
            storedOrders.set(order.id, order)
            return order
          }),
        confirmOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ConfirmOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: SalesCapabilities.orderConfirm,
            })
            const order = storedOrders.get(decoded.orderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
              )
            }
            if (order.status === "confirmed") {
              if (confirmationKeys.get(order.id) !== decoded.idempotencyKey) {
                return yield* Effect.fail(
                  new SalesOrderConfirmationIdempotencyConflict({
                    tenantId: decoded.tenantId,
                    orderId: decoded.orderId,
                    idempotencyKey: decoded.idempotencyKey,
                  }),
                )
              }
              return order
            }
            if (order.status !== "draft") {
              return yield* Effect.fail(
                new SalesOrderInvalidState({
                  tenantId: decoded.tenantId,
                  orderId: decoded.orderId,
                  status: order.status,
                }),
              )
            }
            const confirmed: SalesOrder = {
              ...order,
              status: "confirmed",
              confirmedAt: new Date().toISOString(),
            }
            yield* messaging.append({
              eventId: crypto.randomUUID(),
              eventType: "sales.order.confirmed",
              eventVersion: 1,
              tenantId: decoded.tenantId,
              aggregateType: "sales_order",
              aggregateId: confirmed.id,
              commandId: decoded.commandId,
              correlationId: decoded.correlationId,
              causationId: decoded.causationId,
              idempotencyKey: decoded.idempotencyKey,
              actorPrincipalId: decoded.principal.userAccountId,
              occurredAt: confirmed.confirmedAt!,
              payload: { orderId: confirmed.id, total: confirmed.total },
            })
            storedOrders.set(order.id, confirmed)
            confirmationKeys.set(order.id, decoded.idempotencyKey)
            return confirmed
          }),
        cancelOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CancelOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: SalesCapabilities.orderCancel,
            })
            const order = storedOrders.get(decoded.orderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
              )
            }
            if (order.status === "cancelled") return order
            if (order.status !== "confirmed") {
              return yield* Effect.fail(
                new SalesOrderInvalidState({
                  tenantId: decoded.tenantId,
                  orderId: decoded.orderId,
                  status: order.status,
                }),
              )
            }
            const cancelled: SalesOrder = { ...order, status: "cancelled" }
            storedOrders.set(order.id, cancelled)
            return cancelled
          }),
      }
      return service
    }),
  )
