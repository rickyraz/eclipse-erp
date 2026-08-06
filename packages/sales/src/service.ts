import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { customers, orders, quotations } from "../../../db/schema/sales.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

const Money = Schema.String.check(Schema.isPattern(/^\d{1,12}(\.\d{1,2})?$/))

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

export const SalesOrder = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  customerId: Schema.String,
  quotationId: Schema.NullOr(Schema.String),
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  total: Money,
})

export type Customer = Schema.Schema.Type<typeof Customer>
export type Quotation = Schema.Schema.Type<typeof Quotation>
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
  total: Money,
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
  total: orders.total,
}

export const makeSalesService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  return {
  createCustomer: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateCustomerInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: "sales.customer.create",
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
        capability: "sales.quotation.create",
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
        capability: "sales.order.create",
      })
      const rows = yield* database.query(
        (db) =>
          db.insert(orders)
            .values({
              tenantId: decoded.tenantId,
              customerId: decoded.customerId,
              quotationId: decoded.quotationId,
              total: decoded.total,
            })
            .returning(orderSelection),
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
      return rows[0]!
    }),
  } satisfies SalesService
})

export const makeSalesTestLayer = () =>
  Layer.effect(
    SalesService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const storedCustomers = new Map<string, Customer>()
      const storedQuotations = new Map<string, Quotation>()
      let sequence = 1
      const nextId = () => `sales-test-${sequence++}`
      const service: SalesService = {
    createCustomer: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateCustomerInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: "sales.customer.create",
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
          capability: "sales.quotation.create",
        })
        if (storedCustomers.get(decoded.customerId)?.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new CustomerNotFound({ tenantId: decoded.tenantId, customerId: decoded.customerId }),
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
          capability: "sales.order.create",
        })
        if (storedCustomers.get(decoded.customerId)?.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new CustomerNotFound({ tenantId: decoded.tenantId, customerId: decoded.customerId }),
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
        return {
          id: nextId(),
          tenantId: decoded.tenantId,
          customerId: decoded.customerId,
          quotationId: decoded.quotationId ?? null,
          status: "draft" as const,
          total: decoded.total,
        }
      }),
      }
      return service
    }),
  )
