import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  purchaseOrderLines,
  purchaseOrders,
  supplierAccounts,
} from "../../../db/schema/procurement.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import {
  Database,
  DatabaseFailure,
  FinancialMajorAmount,
  isDatabaseConstraint,
  requireExactMajorToMinor,
} from "../../kernel/mod.ts"
import { PartyService } from "../../party/mod.ts"
import { ProcurementCapabilities } from "./capabilities.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Quantity = Schema.String.check(
  Schema.makeFilter(
    (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
    { expected: "a positive PostgreSQL bigint quantity" },
  ),
)

export const SupplierAccount = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  supplierRelationshipId: Uuid,
  partyId: Uuid,
  legalEntityId: Uuid,
})

export const PurchaseOrderLine = Schema.Struct({
  itemId: Uuid,
  quantity: Quantity,
  unitPrice: FinancialMajorAmount,
})

export const PurchaseOrder = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  supplierAccountId: Uuid,
  status: Schema.Literal("draft"),
  total: FinancialMajorAmount,
  lines: Schema.Array(PurchaseOrderLine),
})

export type SupplierAccount = Schema.Schema.Type<typeof SupplierAccount>
export type PurchaseOrderLine = Schema.Schema.Type<typeof PurchaseOrderLine>
export type PurchaseOrder = Schema.Schema.Type<typeof PurchaseOrder>

export const CreateSupplierAccountInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  supplierRelationshipId: Uuid,
})

export const CreatePurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  supplierAccountId: Uuid,
  lines: Schema.Array(PurchaseOrderLine).check(Schema.isMinLength(1)),
})

export class SupplierAccountAlreadyExists
  extends Schema.TaggedErrorClass<SupplierAccountAlreadyExists>()(
    "SupplierAccountAlreadyExists",
    {
      tenantId: Uuid,
      supplierRelationshipId: Uuid,
    },
  ) {}

export class SupplierRelationshipNotEligible
  extends Schema.TaggedErrorClass<SupplierRelationshipNotEligible>()(
    "SupplierRelationshipNotEligible",
    {
      tenantId: Uuid,
      supplierRelationshipId: Uuid,
    },
  ) {}

export class SupplierAccountNotFound extends Schema.TaggedErrorClass<SupplierAccountNotFound>()(
  "SupplierAccountNotFound",
  {
    tenantId: Uuid,
    supplierAccountId: Uuid,
  },
) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface ProcurementService {
  readonly createSupplierAccount: (
    input: unknown,
  ) => Effect.Effect<
    SupplierAccount,
    SupplierAccountAlreadyExists | SupplierRelationshipNotEligible | CommonFailure
  >
  readonly createPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<PurchaseOrder, SupplierAccountNotFound | CommonFailure>
}

export const ProcurementService = Context.Service<ProcurementService>("RITSEI/ProcurementService")

type CreateSupplierAccount = Schema.Schema.Type<typeof CreateSupplierAccountInput>

const loadSupplierRelationship = (party: PartyService, input: CreateSupplierAccount) =>
  party.getRelationship({
    principal: input.principal,
    tenantId: input.tenantId,
    relationshipId: input.supplierRelationshipId,
  }).pipe(
    Effect.catchTag(
      "PartyRelationshipNotFound",
      () =>
        Effect.fail(
          new SupplierRelationshipNotEligible({
            tenantId: input.tenantId,
            supplierRelationshipId: input.supplierRelationshipId,
          }),
        ),
    ),
    Effect.flatMap((relationship) =>
      relationship.kind === "supplier" && relationship.active
        ? Effect.succeed(relationship)
        : Effect.fail(
          new SupplierRelationshipNotEligible({
            tenantId: input.tenantId,
            supplierRelationshipId: input.supplierRelationshipId,
          }),
        )
    ),
  )

const supplierAccountSelection = {
  id: supplierAccounts.id,
  tenantId: supplierAccounts.tenantId,
  supplierRelationshipId: supplierAccounts.supplierRelationshipId,
}

const purchaseOrderSelection = {
  id: purchaseOrders.id,
  tenantId: purchaseOrders.tenantId,
  supplierAccountId: purchaseOrders.supplierAccountId,
  status: purchaseOrders.status,
  total: purchaseOrders.total,
}

const purchaseOrderLineSelection = {
  itemId: purchaseOrderLines.itemId,
  quantity: purchaseOrderLines.quantity,
  unitPrice: purchaseOrderLines.unitPrice,
}

const deriveTotal = (lines: ReadonlyArray<PurchaseOrderLine>): string => {
  const minor = lines.reduce(
    (total, line) => total + BigInt(line.quantity) * requireExactMajorToMinor(line.unitPrice, 2),
    0n,
  )
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`
}

export const makeProcurementService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const party = yield* PartyService

  return {
    createSupplierAccount: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateSupplierAccountInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.supplierAccountCreate,
        })
        const relationship = yield* loadSupplierRelationship(party, decoded)
        const rows = yield* database.query(
          (db) =>
            db.insert(supplierAccounts)
              .values({
                tenantId: decoded.tenantId,
                supplierRelationshipId: decoded.supplierRelationshipId,
              })
              .returning(supplierAccountSelection),
          "procurement.supplier_account.create",
        ).pipe(
          Effect.mapError((error) => {
            if (
              isDatabaseConstraint(error, "supplier_accounts_tenant_supplier_relationship_key")
            ) {
              return new SupplierAccountAlreadyExists({
                tenantId: decoded.tenantId,
                supplierRelationshipId: decoded.supplierRelationshipId,
              })
            }
            if (
              isDatabaseConstraint(
                error,
                "supplier_accounts_tenant_supplier_relationship_fkey",
                "23503",
              )
            ) {
              return new SupplierRelationshipNotEligible({
                tenantId: decoded.tenantId,
                supplierRelationshipId: decoded.supplierRelationshipId,
              })
            }
            return error
          }),
        )
        const account = rows[0]!
        return {
          ...account,
          partyId: relationship.partyId,
          legalEntityId: relationship.legalEntityId,
        }
      }),
    createPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreatePurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderCreate,
        })
        const total = deriveTotal(decoded.lines)
        yield* Schema.decodeUnknownEffect(FinancialMajorAmount)(total)
        return yield* database.transaction(
          async (tx) => {
            const [order] = await tx.insert(purchaseOrders)
              .values({
                tenantId: decoded.tenantId,
                supplierAccountId: decoded.supplierAccountId,
                total,
              })
              .returning(purchaseOrderSelection)
            const lines = await tx.insert(purchaseOrderLines)
              .values(decoded.lines.map((line) => ({
                tenantId: decoded.tenantId,
                purchaseOrderId: order!.id,
                itemId: line.itemId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              })))
              .returning(purchaseOrderLineSelection)
            return { ...order!, lines }
          },
          "procurement.purchase_order.create",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(
                error,
                "purchase_orders_tenant_supplier_account_fkey",
                "23503",
              )
              ? new SupplierAccountNotFound({
                tenantId: decoded.tenantId,
                supplierAccountId: decoded.supplierAccountId,
              })
              : error
          ),
        )
      }),
  } satisfies ProcurementService
})

export const makeProcurementTestLayer = () =>
  Layer.effect(
    ProcurementService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const party = yield* PartyService
      const storedSupplierAccounts = new Map<string, SupplierAccount>()
      const storedPurchaseOrders = new Map<string, PurchaseOrder>()

      return {
        createSupplierAccount: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateSupplierAccountInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.supplierAccountCreate,
            })
            const relationship = yield* loadSupplierRelationship(party, decoded)
            if (
              [...storedSupplierAccounts.values()].some((account) =>
                account.tenantId === decoded.tenantId &&
                account.supplierRelationshipId === decoded.supplierRelationshipId
              )
            ) {
              return yield* Effect.fail(
                new SupplierAccountAlreadyExists({
                  tenantId: decoded.tenantId,
                  supplierRelationshipId: decoded.supplierRelationshipId,
                }),
              )
            }
            const account: SupplierAccount = {
              id: crypto.randomUUID(),
              tenantId: decoded.tenantId,
              supplierRelationshipId: decoded.supplierRelationshipId,
              partyId: relationship.partyId,
              legalEntityId: relationship.legalEntityId,
            }
            storedSupplierAccounts.set(account.id, account)
            return account
          }),
        createPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreatePurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderCreate,
            })
            const total = deriveTotal(decoded.lines)
            yield* Schema.decodeUnknownEffect(FinancialMajorAmount)(total)
            if (
              storedSupplierAccounts.get(decoded.supplierAccountId)?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(
                new SupplierAccountNotFound({
                  tenantId: decoded.tenantId,
                  supplierAccountId: decoded.supplierAccountId,
                }),
              )
            }
            const order: PurchaseOrder = {
              id: crypto.randomUUID(),
              tenantId: decoded.tenantId,
              supplierAccountId: decoded.supplierAccountId,
              status: "draft",
              total,
              lines: decoded.lines,
            }
            storedPurchaseOrders.set(order.id, order)
            return order
          }),
      } satisfies ProcurementService
    }),
  )
