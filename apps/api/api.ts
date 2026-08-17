import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import * as HttpApi from "effect/unstable/httpapi/HttpApi"
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint"
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup"
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware"
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema"
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity"
import * as OpenApi from "effect/unstable/httpapi/OpenApi"

import { Principal } from "../../packages/auth/mod.ts"
import { Capability } from "../../packages/authorization/mod.ts"
import { UserAccount } from "../../packages/identity/mod.ts"
import {
  ExternalIdentifier,
  Party,
  PartyKind,
  PartyRelationship,
  PartyRelationshipKind,
  PartyRole,
} from "../../packages/party/mod.ts"
import { Customer, Quotation, SalesOrder, SalesOrderLine } from "../../packages/sales/mod.ts"
import {
  OrderCancellationPayload,
  OrderCancellationResult,
  OrderConfirmationPayload,
  OrderConfirmationResult,
  OrderFulfillmentPayload,
  OrderFulfillmentResult,
  WorkflowRun,
} from "../../packages/process/mod.ts"
import {
  Item,
  StockBalance,
  StockReservation,
  StockTransfer,
  StockTransferLine,
  Warehouse,
} from "../../packages/inventory/mod.ts"
import {
  Account,
  AccountingConfiguration,
  FinancialOperation,
  JournalEntry,
  JournalLine,
} from "../../packages/accounting/mod.ts"
import { TenantMembership } from "../../packages/authorization/mod.ts"

export class CurrentPrincipal extends Context.Service<CurrentPrincipal, Principal>()(
  "EclipseERP/Http/CurrentPrincipal",
) {}

export class ApiUnauthorized extends Schema.TaggedErrorClass<ApiUnauthorized>()("ApiUnauthorized", {
  code: Schema.Literal("unauthorized"),
}, { httpApiStatus: 401 }) {}
export class ApiForbidden extends Schema.TaggedErrorClass<ApiForbidden>()("ApiForbidden", {
  code: Schema.Literal("forbidden"),
}, { httpApiStatus: 403 }) {}
export class ApiNotFound extends Schema.TaggedErrorClass<ApiNotFound>()("ApiNotFound", {
  code: Schema.String,
}, { httpApiStatus: 404 }) {}
export class ApiConflict extends Schema.TaggedErrorClass<ApiConflict>()("ApiConflict", {
  code: Schema.String,
}, { httpApiStatus: 409 }) {}
export class ApiServiceUnavailable
  extends Schema.TaggedErrorClass<ApiServiceUnavailable>()("ApiServiceUnavailable", {
    code: Schema.Literal("service_unavailable"),
  }, { httpApiStatus: 503 }) {}

export class BearerAuth extends HttpApiMiddleware.Service<BearerAuth, {
  provides: CurrentPrincipal
}>()("EclipseERP/Http/BearerAuth", {
  error: [ApiUnauthorized, ApiServiceUnavailable],
  security: { bearer: HttpApiSecurity.bearer },
}) {}

const errors = [ApiUnauthorized, ApiForbidden, ApiNotFound, ApiConflict, ApiServiceUnavailable]
const tenantHeaders = { "x-tenant-id": Schema.String }
const CreatedUserAccount = UserAccount.pipe(HttpApiSchema.status(201))
const CreatedParty = Party.pipe(HttpApiSchema.status(201))
const CreatedExternalIdentifier = ExternalIdentifier.pipe(HttpApiSchema.status(201))
const CreatedPartyRelationship = PartyRelationship.pipe(HttpApiSchema.status(201))
const CreatedCustomer = Customer.pipe(HttpApiSchema.status(201))
const CreatedQuotation = Quotation.pipe(HttpApiSchema.status(201))
const CreatedOrder = SalesOrder.pipe(HttpApiSchema.status(201))
const CreatedWarehouse = Warehouse.pipe(HttpApiSchema.status(201))
const CreatedItem = Item.pipe(HttpApiSchema.status(201))
const CreatedReservation = StockReservation.pipe(HttpApiSchema.status(201))
const CreatedTransfer = StockTransfer.pipe(HttpApiSchema.status(201))
const CreatedAccountingConfiguration = AccountingConfiguration.pipe(HttpApiSchema.status(201))
const CreatedAccount = Account.pipe(HttpApiSchema.status(201))
const CreatedJournal = JournalEntry.pipe(HttpApiSchema.status(201))
const CreatedFinancialOperation = FinancialOperation.pipe(HttpApiSchema.status(201))
const CreatedTenantMembership = TenantMembership.pipe(HttpApiSchema.status(201))
const CreatedOrderConfirmation = OrderConfirmationResult.pipe(HttpApiSchema.status(201))
const CreatedOrderCancellation = OrderCancellationResult.pipe(HttpApiSchema.status(201))
const CreatedOrderFulfillment = OrderFulfillmentResult.pipe(HttpApiSchema.status(201))

const Health = HttpApiGroup.make("Health").add(
  HttpApiEndpoint.get("health", "/health", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
  }),
)

const UserAccounts = HttpApiGroup.make("UserAccounts").add(
  HttpApiEndpoint.post("create", "/user-accounts", {
    headers: tenantHeaders,
    payload: Schema.Struct({ email: Schema.String }),
    success: CreatedUserAccount,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("list", "/user-accounts", {
    headers: tenantHeaders,
    success: Schema.Array(UserAccount),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("get", "/user-accounts/:id", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    success: UserAccount,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.patch("update", "/user-accounts/:id", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    payload: Schema.Struct({ email: Schema.String }),
    success: UserAccount,
    error: errors,
  }).middleware(BearerAuth),
)

const Parties = HttpApiGroup.make("Parties").add(
  HttpApiEndpoint.post("create", "/parties", {
    headers: tenantHeaders,
    payload: Schema.Struct({ kind: PartyKind, name: Schema.String }),
    success: CreatedParty,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("assignRole", "/parties/:id/roles", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    payload: Schema.Struct({ role: PartyRole }),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("attachIdentifier", "/parties/:id/identifiers", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    payload: Schema.Struct({
      provider: Schema.String,
      scheme: Schema.String,
      scope: Schema.String,
      legalEntityId: Schema.optionalKey(Schema.String),
      value: Schema.String,
    }),
    success: CreatedExternalIdentifier,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createRelationship", "/parties/:id/relationships", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Schema.String,
      kind: PartyRelationshipKind,
    }),
    success: CreatedPartyRelationship,
    error: errors,
  }).middleware(BearerAuth),
)

const Authorization = HttpApiGroup.make("Authorization").add(
  HttpApiEndpoint.post("addMember", "/tenant-memberships", {
    headers: tenantHeaders,
    payload: Schema.Struct({ userAccountId: Schema.String }),
    success: CreatedTenantMembership,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listMembers", "/tenant-memberships", {
    headers: tenantHeaders,
    success: Schema.Array(TenantMembership),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("suspendMember", "/tenant-memberships/:userAccountId/suspend", {
    params: { userAccountId: Schema.String },
    headers: tenantHeaders,
    success: TenantMembership,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("activateMember", "/tenant-memberships/:userAccountId/activate", {
    params: { userAccountId: Schema.String },
    headers: tenantHeaders,
    success: TenantMembership,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.delete("removeMember", "/tenant-memberships/:userAccountId", {
    params: { userAccountId: Schema.String },
    headers: tenantHeaders,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("grant", "/capabilities", {
    headers: tenantHeaders,
    payload: Schema.Struct({ userAccountId: Schema.String, capability: Capability }),
    error: errors,
  }).middleware(BearerAuth),
)

const Sales = HttpApiGroup.make("Sales").add(
  HttpApiEndpoint.post("createCustomer", "/sales/customers", {
    headers: tenantHeaders,
    payload: Schema.Struct({ name: Schema.String, email: Schema.String }),
    success: CreatedCustomer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createQuotation", "/sales/quotations", {
    headers: tenantHeaders,
    payload: Schema.Struct({ customerId: Schema.String, total: Schema.String }),
    success: CreatedQuotation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createOrder", "/sales/orders", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      customerId: Schema.String,
      quotationId: Schema.optionalKey(Schema.String),
      lines: Schema.Array(SalesOrderLine).check(Schema.isMinLength(1)),
    }),
    success: CreatedOrder,
    error: errors,
  }).middleware(BearerAuth),
)

const Inventory = HttpApiGroup.make("Inventory").add(
  HttpApiEndpoint.post("createWarehouse", "/inventory/warehouses", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Schema.String,
      primaryBranchId: Schema.optionalKey(Schema.String),
      name: Schema.String,
    }),
    success: CreatedWarehouse,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createItem", "/inventory/items", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      sku: Schema.String,
      name: Schema.String,
      unitOfMeasure: Schema.optionalKey(Schema.String),
    }),
    success: CreatedItem,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("receiveStock", "/inventory/receipts", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      warehouseId: Schema.String,
      itemId: Schema.String,
      quantity: Schema.String,
    }),
    success: StockBalance,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("reserveStock", "/inventory/reservations", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      warehouseId: Schema.String,
      itemId: Schema.String,
      quantity: Schema.String,
    }),
    success: CreatedReservation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createTransfer", "/inventory/transfers", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      sourceWarehouseId: Schema.String,
      destinationWarehouseId: Schema.String,
      lines: Schema.Array(StockTransferLine).check(Schema.isMinLength(1)),
    }),
    success: CreatedTransfer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("confirmTransfer", "/inventory/transfers/:id/confirm", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    success: StockTransfer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("completeTransfer", "/inventory/transfers/:id/complete", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    success: StockTransfer,
    error: errors,
  }).middleware(BearerAuth),
)

const Process = HttpApiGroup.make("Process").add(
  HttpApiEndpoint.post("confirmOrder", "/process/order-confirmations", {
    headers: tenantHeaders,
    payload: OrderConfirmationPayload,
    success: CreatedOrderConfirmation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("cancelOrder", "/process/order-cancellations", {
    headers: tenantHeaders,
    payload: OrderCancellationPayload,
    success: CreatedOrderCancellation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("fulfillOrder", "/process/order-fulfillments", {
    headers: tenantHeaders,
    payload: OrderFulfillmentPayload,
    success: CreatedOrderFulfillment,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("recoverOrder", "/process/order-confirmations/recover", {
    headers: tenantHeaders,
    payload: OrderConfirmationPayload,
    success: OrderConfirmationResult,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("manualRecovery", "/process/order-confirmations/manual-recovery", {
    headers: tenantHeaders,
    payload: Schema.Struct({ idempotencyKey: Schema.String, reason: Schema.String }),
    success: WorkflowRun,
    error: errors,
  }).middleware(BearerAuth),
)

const Accounting = HttpApiGroup.make("Accounting").add(
  HttpApiEndpoint.post("configureLegalEntity", "/accounting/legal-entities/:id/configuration", {
    params: { id: Schema.String },
    headers: tenantHeaders,
    payload: Schema.Struct({
      baseCurrency: Schema.String,
      precision: Schema.Literal(2),
      fiscalYearStartMonth: Schema.Int,
      postingEnabled: Schema.Boolean,
      financialEngine: Schema.optionalKey(Schema.Literals(["postgresql", "tigerbeetle"])),
    }),
    success: CreatedAccountingConfiguration,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createAccount", "/accounting/accounts", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      code: Schema.String,
      name: Schema.String,
      type: Account.fields.type,
    }),
    success: CreatedAccount,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("postJournal", "/accounting/journals", {
    headers: tenantHeaders,
    payload: Schema.Struct({ reference: Schema.String, lines: Schema.Array(JournalLine) }),
    success: CreatedJournal,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createFinancialJournalIntent", "/accounting/financial-operations", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Schema.String,
      operationId: Schema.String,
      reference: Schema.String,
      currency: Schema.String,
      mappingVersion: Schema.Int,
      lines: Schema.Array(JournalLine),
      correlationId: Schema.String,
    }),
    success: CreatedFinancialOperation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createFinancialRevenueIntent", "/accounting/financial-operations/revenue", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Schema.String,
      orderId: Schema.String,
      commandId: Schema.String,
      correlationId: Schema.String,
      currency: Schema.String,
      mappingVersion: Schema.Int,
      amount: Schema.optionalKey(Schema.String),
    }),
    success: CreatedFinancialOperation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post(
    "createFinancialReversalIntent",
    "/accounting/financial-operations/reversals",
    {
      headers: tenantHeaders,
      payload: Schema.Struct({
        legalEntityId: Schema.String,
        sourceJournalId: Schema.String,
        operationId: Schema.String,
        reference: Schema.String,
        currency: Schema.String,
        mappingVersion: Schema.Int,
        correlationId: Schema.String,
      }),
      success: CreatedFinancialOperation,
      error: errors,
    },
  ).middleware(BearerAuth),
)

export const EclipseApi = HttpApi.make("EclipseERP")
  .add(Health, UserAccounts, Parties, Authorization, Sales, Inventory, Accounting, Process)
  .annotate(OpenApi.Title, "EclipseERP API")
  .annotate(OpenApi.Version, "0.1.0")
  .annotate(OpenApi.Description, "Typed modular-monolith ERP API")
