import { and, eq, sql } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceiptLines,
  purchaseReceipts,
  supplierAccounts,
} from "../../../db/schema/procurement.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { InventoryService } from "../../inventory/mod.ts"
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
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const IsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const InstantString = Schema.String.check(
  Schema.isPattern(IsoTimestamp),
  Schema.makeFilter((value) => !Number.isNaN(new Date(value).getTime()), {
    expected: "an ISO 8601 timestamp with a timezone",
  }),
)
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

export const PurchaseOrderLineSnapshot = Schema.Struct({
  id: Uuid,
  itemId: Uuid,
  quantity: Quantity,
  unitPrice: FinancialMajorAmount,
})

export const PurchaseOrder = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  supplierAccountId: Uuid,
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  confirmedAt: Schema.NullOr(InstantString),
  total: FinancialMajorAmount,
  lines: Schema.Array(PurchaseOrderLineSnapshot),
}).check(Schema.makeFilter(
  (order) =>
    (order.status === "draft" && order.confirmedAt === null) ||
    (order.status !== "draft" && order.confirmedAt !== null),
  { expected: "purchase order confirmation metadata consistent with status" },
))

export type SupplierAccount = Schema.Schema.Type<typeof SupplierAccount>
export type PurchaseOrderLine = Schema.Schema.Type<typeof PurchaseOrderLine>
export type PurchaseOrderLineSnapshot = Schema.Schema.Type<typeof PurchaseOrderLineSnapshot>
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

export const ConfirmPurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
  idempotencyKey: NonEmptyString,
})

export const GetPurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
})

export const CancelPurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
})

export const PurchaseReceiptLineInput = Schema.Struct({
  purchaseOrderLineId: Uuid,
  quantity: Quantity,
})

export const ReceivePurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
  warehouseId: Uuid,
  idempotencyKey: NonEmptyString,
  lines: Schema.Array(PurchaseReceiptLineInput).check(Schema.isMinLength(1)),
})

export const GoodsReceiptLine = Schema.Struct({
  id: Uuid,
  purchaseOrderLineId: Uuid,
  itemId: Uuid,
  quantity: Quantity,
  unitOfMeasure: NonEmptyString,
})

export const GoodsReceipt = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
  warehouseId: Uuid,
  idempotencyKey: NonEmptyString,
  receivedAt: InstantString,
  lines: Schema.Array(GoodsReceiptLine),
})

export type PurchaseReceiptLineInput = Schema.Schema.Type<typeof PurchaseReceiptLineInput>
export type ReceivePurchaseOrder = Schema.Schema.Type<typeof ReceivePurchaseOrderInput>
export type GoodsReceiptLine = Schema.Schema.Type<typeof GoodsReceiptLine>
export type GoodsReceipt = Schema.Schema.Type<typeof GoodsReceipt>

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

export class PurchaseOrderNotFound extends Schema.TaggedErrorClass<PurchaseOrderNotFound>()(
  "PurchaseOrderNotFound",
  {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
  },
) {}

export class PurchaseOrderConfirmationIdempotencyConflict
  extends Schema.TaggedErrorClass<PurchaseOrderConfirmationIdempotencyConflict>()(
    "PurchaseOrderConfirmationIdempotencyConflict",
    {
      tenantId: Uuid,
      purchaseOrderId: Uuid,
      idempotencyKey: NonEmptyString,
    },
  ) {}

export class PurchaseOrderInvalidState
  extends Schema.TaggedErrorClass<PurchaseOrderInvalidState>()("PurchaseOrderInvalidState", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
    status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  }) {}

export class PurchaseOrderHasReceipts
  extends Schema.TaggedErrorClass<PurchaseOrderHasReceipts>()("PurchaseOrderHasReceipts", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
  }) {}

export class PurchaseReceiptIdempotencyConflict
  extends Schema.TaggedErrorClass<PurchaseReceiptIdempotencyConflict>()(
    "PurchaseReceiptIdempotencyConflict",
    {
      tenantId: Uuid,
      purchaseOrderId: Uuid,
      idempotencyKey: NonEmptyString,
    },
  ) {}

export class PurchaseReceiptLineDuplicate
  extends Schema.TaggedErrorClass<PurchaseReceiptLineDuplicate>()("PurchaseReceiptLineDuplicate", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
    purchaseOrderLineId: Uuid,
  }) {}

export class PurchaseReceiptLineNotFound
  extends Schema.TaggedErrorClass<PurchaseReceiptLineNotFound>()("PurchaseReceiptLineNotFound", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
    purchaseOrderLineId: Uuid,
  }) {}

export class PurchaseReceiptQuantityExceeded
  extends Schema.TaggedErrorClass<PurchaseReceiptQuantityExceeded>()(
    "PurchaseReceiptQuantityExceeded",
    {
      tenantId: Uuid,
      purchaseOrderId: Uuid,
      purchaseOrderLineId: Uuid,
      ordered: Quantity,
      received: Schema.String,
      requested: Quantity,
    },
  ) {}

export class PurchaseReceiptInventoryReferenceNotFound
  extends Schema.TaggedErrorClass<PurchaseReceiptInventoryReferenceNotFound>()(
    "PurchaseReceiptInventoryReferenceNotFound",
    {
      tenantId: Uuid,
      warehouseId: Uuid,
      itemId: Uuid,
    },
  ) {}

export class PurchaseReceiptWarehouseLegalEntityMismatch
  extends Schema.TaggedErrorClass<PurchaseReceiptWarehouseLegalEntityMismatch>()(
    "PurchaseReceiptWarehouseLegalEntityMismatch",
    {
      tenantId: Uuid,
      warehouseId: Uuid,
      legalEntityId: Uuid,
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
  readonly getPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<PurchaseOrder, PurchaseOrderNotFound | CommonFailure>
  readonly confirmPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<
    PurchaseOrder,
    | PurchaseOrderConfirmationIdempotencyConflict
    | PurchaseOrderInvalidState
    | PurchaseOrderNotFound
    | CommonFailure
  >
  readonly cancelPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<
    PurchaseOrder,
    PurchaseOrderHasReceipts | PurchaseOrderInvalidState | PurchaseOrderNotFound | CommonFailure
  >
  readonly receivePurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<
    GoodsReceipt,
    | PurchaseOrderInvalidState
    | PurchaseOrderNotFound
    | PurchaseReceiptIdempotencyConflict
    | PurchaseReceiptLineDuplicate
    | PurchaseReceiptLineNotFound
    | PurchaseReceiptQuantityExceeded
    | PurchaseReceiptInventoryReferenceNotFound
    | PurchaseReceiptWarehouseLegalEntityMismatch
    | SupplierAccountNotFound
    | SupplierRelationshipNotEligible
    | CommonFailure,
    InventoryService
  >
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
  confirmedAt: purchaseOrders.confirmedAt,
  total: purchaseOrders.total,
}

const purchaseOrderLineSelection = {
  id: purchaseOrderLines.id,
  itemId: purchaseOrderLines.itemId,
  quantity: purchaseOrderLines.quantity,
  unitPrice: purchaseOrderLines.unitPrice,
}

const purchaseReceiptSelection = {
  id: purchaseReceipts.id,
  tenantId: purchaseReceipts.tenantId,
  purchaseOrderId: purchaseReceipts.purchaseOrderId,
  warehouseId: purchaseReceipts.warehouseId,
  idempotencyKey: purchaseReceipts.idempotencyKey,
  receivedAt: purchaseReceipts.receivedAt,
}

const purchaseReceiptLineSelection = {
  id: purchaseReceiptLines.id,
  purchaseOrderLineId: purchaseReceiptLines.purchaseOrderLineId,
  itemId: purchaseReceiptLines.itemId,
  quantity: purchaseReceiptLines.quantity,
  unitOfMeasure: purchaseReceiptLines.unitOfMeasure,
}

const toGoodsReceipt = (
  row: {
    readonly id: string
    readonly tenantId: string
    readonly purchaseOrderId: string
    readonly warehouseId: string
    readonly idempotencyKey: string
    readonly receivedAt: Date
  },
  lines: ReadonlyArray<GoodsReceiptLine>,
): GoodsReceipt => ({
  id: row.id,
  tenantId: row.tenantId,
  purchaseOrderId: row.purchaseOrderId,
  warehouseId: row.warehouseId,
  idempotencyKey: row.idempotencyKey,
  receivedAt: row.receivedAt.toISOString(),
  lines,
})

const toGoodsReceiptLine = (row: {
  readonly id: string
  readonly purchaseOrderLineId: string
  readonly itemId: string
  readonly quantity: string
  readonly unitOfMeasure: string
}): GoodsReceiptLine => ({
  id: row.id,
  purchaseOrderLineId: row.purchaseOrderLineId,
  itemId: row.itemId,
  quantity: row.quantity,
  unitOfMeasure: row.unitOfMeasure,
})

const canonicalReceiptLines = (lines: ReadonlyArray<PurchaseReceiptLineInput>) =>
  [...lines].sort((left, right) =>
    left.purchaseOrderLineId.localeCompare(right.purchaseOrderLineId)
  )

const sameReceiptLines = (
  left: ReadonlyArray<PurchaseReceiptLineInput>,
  right: ReadonlyArray<GoodsReceiptLine>,
) => {
  const orderedLeft = canonicalReceiptLines(left)
  const orderedRight = [...right].sort((a, b) =>
    a.purchaseOrderLineId.localeCompare(b.purchaseOrderLineId)
  )
  return orderedLeft.length === orderedRight.length && orderedLeft.every((line, index) => {
    const existing = orderedRight[index]!
    return line.purchaseOrderLineId === existing.purchaseOrderLineId &&
      line.quantity === existing.quantity
  })
}

const toPurchaseOrder = (row: {
  readonly id: string
  readonly tenantId: string
  readonly supplierAccountId: string
  readonly status: "draft" | "confirmed" | "cancelled"
  readonly confirmedAt: Date | null
  readonly total: string
}, lines: ReadonlyArray<PurchaseOrderLineSnapshot>): PurchaseOrder => ({
  id: row.id,
  tenantId: row.tenantId,
  supplierAccountId: row.supplierAccountId,
  status: row.status,
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  total: row.total,
  lines,
})

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
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())

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
            return toPurchaseOrder(order!, lines)
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
    getPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(GetPurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderRead,
        })
        const order = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select(purchaseOrderSelection)
              .from(purchaseOrders)
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
              ))
            if (row === undefined) return undefined
            const lines = await tx.select(purchaseOrderLineSelection)
              .from(purchaseOrderLines)
              .where(and(
                eq(purchaseOrderLines.tenantId, decoded.tenantId),
                eq(purchaseOrderLines.purchaseOrderId, row.id),
              ))
            return toPurchaseOrder(row, lines)
          },
          "procurement.purchase_order.get",
        )
        if (order === undefined) {
          return yield* Effect.fail(
            new PurchaseOrderNotFound({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
            }),
          )
        }
        return order
      }),
    confirmPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConfirmPurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderConfirm,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select({
              ...purchaseOrderSelection,
              confirmationIdempotencyKey: purchaseOrders.confirmationIdempotencyKey,
            })
              .from(purchaseOrders)
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
              ))
              .for("update")
            if (row === undefined) return { _tag: "not-found" as const }
            const lines = await tx.select(purchaseOrderLineSelection)
              .from(purchaseOrderLines)
              .where(and(
                eq(purchaseOrderLines.tenantId, decoded.tenantId),
                eq(purchaseOrderLines.purchaseOrderId, row.id),
              ))
            const current = toPurchaseOrder(row, lines)
            if (row.status === "confirmed") {
              return row.confirmationIdempotencyKey === decoded.idempotencyKey
                ? { _tag: "existing" as const, order: current }
                : { _tag: "idempotency-conflict" as const }
            }
            if (row.status !== "draft") {
              return { _tag: "invalid-state" as const, status: row.status }
            }
            const confirmedAt = now()
            const [confirmed] = await tx.update(purchaseOrders)
              .set({
                status: "confirmed",
                confirmationIdempotencyKey: decoded.idempotencyKey,
                confirmedAt,
                updatedAt: confirmedAt,
              })
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
                eq(purchaseOrders.status, "draft"),
              ))
              .returning(purchaseOrderSelection)
            return { _tag: "confirmed" as const, order: toPurchaseOrder(confirmed!, lines) }
          },
          "procurement.purchase_order.confirm",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(
                error,
                "purchase_orders_tenant_confirmation_idempotency_key",
              )
              ? new PurchaseOrderConfirmationIdempotencyConflict({
                tenantId: decoded.tenantId,
                purchaseOrderId: decoded.purchaseOrderId,
                idempotencyKey: decoded.idempotencyKey,
              })
              : error
          ),
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new PurchaseOrderNotFound({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
            }),
          )
        }
        if (result._tag === "idempotency-conflict") {
          return yield* Effect.fail(
            new PurchaseOrderConfirmationIdempotencyConflict({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new PurchaseOrderInvalidState({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              status: result.status,
            }),
          )
        }
        return result.order
      }),
    cancelPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CancelPurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderCancel,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select(purchaseOrderSelection)
              .from(purchaseOrders)
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
              ))
              .for("update")
            if (row === undefined) return { _tag: "not-found" as const }
            const lines = await tx.select(purchaseOrderLineSelection)
              .from(purchaseOrderLines)
              .where(and(
                eq(purchaseOrderLines.tenantId, decoded.tenantId),
                eq(purchaseOrderLines.purchaseOrderId, row.id),
              ))
            const current = toPurchaseOrder(row, lines)
            if (row.status === "cancelled") {
              return { _tag: "existing" as const, order: current }
            }
            if (row.status !== "confirmed") {
              return { _tag: "invalid-state" as const, status: row.status }
            }
            const [receipt] = await tx.select({ id: purchaseReceipts.id })
              .from(purchaseReceipts)
              .where(and(
                eq(purchaseReceipts.tenantId, decoded.tenantId),
                eq(purchaseReceipts.purchaseOrderId, decoded.purchaseOrderId),
              ))
              .limit(1)
            if (receipt !== undefined) return { _tag: "has-receipts" as const }
            const [cancelled] = await tx.update(purchaseOrders)
              .set({ status: "cancelled", updatedAt: now() })
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
                eq(purchaseOrders.status, "confirmed"),
              ))
              .returning(purchaseOrderSelection)
            return { _tag: "cancelled" as const, order: toPurchaseOrder(cancelled!, lines) }
          },
          "procurement.purchase_order.cancel",
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new PurchaseOrderNotFound({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new PurchaseOrderInvalidState({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              status: result.status,
            }),
          )
        }
        if (result._tag === "has-receipts") {
          return yield* Effect.fail(
            new PurchaseOrderHasReceipts({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
            }),
          )
        }
        return result.order
      }),
    receivePurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ReceivePurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseReceiptReceive,
        })
        const lines = canonicalReceiptLines(decoded.lines)
        const duplicateLine = lines.find((line, index) =>
          index > 0 && lines[index - 1]!.purchaseOrderLineId === line.purchaseOrderLineId
        )
        if (duplicateLine !== undefined) {
          return yield* Effect.fail(
            new PurchaseReceiptLineDuplicate({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              purchaseOrderLineId: duplicateLine.purchaseOrderLineId,
            }),
          )
        }
        const inventory = yield* InventoryService
        const loadExistingReceipt = () =>
          Effect.gen(function* () {
            const existingRows = yield* database.query(
              (db) =>
                db.select(purchaseReceiptSelection)
                  .from(purchaseReceipts)
                  .where(and(
                    eq(purchaseReceipts.tenantId, decoded.tenantId),
                    eq(purchaseReceipts.idempotencyKey, decoded.idempotencyKey),
                  ))
                  .for("update"),
              "procurement.purchase_receipt.idempotency",
            )
            const existing = existingRows[0]
            if (existing === undefined) return undefined
            const existingLines = yield* database.query(
              (db) =>
                db.select(purchaseReceiptLineSelection)
                  .from(purchaseReceiptLines)
                  .where(and(
                    eq(purchaseReceiptLines.tenantId, decoded.tenantId),
                    eq(purchaseReceiptLines.receiptId, existing.id),
                  )),
              "procurement.purchase_receipt.idempotency.lines",
            )
            return toGoodsReceipt(existing, existingLines.map(toGoodsReceiptLine))
          })
        const acceptExistingReceipt = (receipt: GoodsReceipt) =>
          receipt.purchaseOrderId === decoded.purchaseOrderId &&
            receipt.warehouseId === decoded.warehouseId &&
            sameReceiptLines(lines, receipt.lines)
            ? Effect.succeed(receipt)
            : Effect.fail(
              new PurchaseReceiptIdempotencyConflict({
                tenantId: decoded.tenantId,
                purchaseOrderId: decoded.purchaseOrderId,
                idempotencyKey: decoded.idempotencyKey,
              }),
            )
        return yield* database.withTransaction(
          Effect.gen(function* () {
            const existing = yield* loadExistingReceipt()
            if (existing !== undefined) return yield* acceptExistingReceipt(existing)

            const orderRows = yield* database.query(
              (db) =>
                db.select(purchaseOrderSelection)
                  .from(purchaseOrders)
                  .where(and(
                    eq(purchaseOrders.tenantId, decoded.tenantId),
                    eq(purchaseOrders.id, decoded.purchaseOrderId),
                  ))
                  .for("update"),
              "procurement.purchase_receipt.purchase_order",
            )
            const order = orderRows[0]
            if (order === undefined) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            if (order.status !== "confirmed") {
              return yield* Effect.fail(
                new PurchaseOrderInvalidState({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  status: order.status,
                }),
              )
            }
            const concurrentExisting = yield* loadExistingReceipt()
            if (concurrentExisting !== undefined) {
              return yield* acceptExistingReceipt(concurrentExisting)
            }

            const [supplierAccount] = yield* database.query(
              (db) =>
                db.select({ supplierRelationshipId: supplierAccounts.supplierRelationshipId })
                  .from(supplierAccounts)
                  .where(and(
                    eq(supplierAccounts.tenantId, decoded.tenantId),
                    eq(supplierAccounts.id, order.supplierAccountId),
                  )),
              "procurement.purchase_receipt.supplier_account",
            )
            if (supplierAccount === undefined) {
              return yield* Effect.fail(
                new SupplierAccountNotFound({
                  tenantId: decoded.tenantId,
                  supplierAccountId: order.supplierAccountId,
                }),
              )
            }
            const supplierRelationship = yield* loadSupplierRelationship(party, {
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              supplierRelationshipId: supplierAccount.supplierRelationshipId,
            })
            const legalEntityId = supplierRelationship.legalEntityId

            const orderLines = yield* database.query(
              (db) =>
                db.select(purchaseOrderLineSelection)
                  .from(purchaseOrderLines)
                  .where(and(
                    eq(purchaseOrderLines.tenantId, decoded.tenantId),
                    eq(purchaseOrderLines.purchaseOrderId, decoded.purchaseOrderId),
                  )),
              "procurement.purchase_receipt.purchase_order_lines",
            )
            const linesById = new Map(orderLines.map((line) => [line.id, line]))
            const receivedRows = yield* database.query(
              (db) =>
                db.select({
                  purchaseOrderLineId: purchaseReceiptLines.purchaseOrderLineId,
                  quantity: sql<string>`coalesce(sum(${purchaseReceiptLines.quantity}), 0)::text`,
                })
                  .from(purchaseReceiptLines)
                  .where(and(
                    eq(purchaseReceiptLines.tenantId, decoded.tenantId),
                    eq(purchaseReceiptLines.purchaseOrderId, decoded.purchaseOrderId),
                  ))
                  .groupBy(purchaseReceiptLines.purchaseOrderLineId),
              "procurement.purchase_receipt.received_quantities",
            )
            const receivedByLine = new Map(
              receivedRows.map((row) => [row.purchaseOrderLineId, row.quantity]),
            )
            for (const line of lines) {
              const orderLine = linesById.get(line.purchaseOrderLineId)
              if (orderLine === undefined) {
                return yield* Effect.fail(
                  new PurchaseReceiptLineNotFound({
                    tenantId: decoded.tenantId,
                    purchaseOrderId: decoded.purchaseOrderId,
                    purchaseOrderLineId: line.purchaseOrderLineId,
                  }),
                )
              }
              const received = receivedByLine.get(line.purchaseOrderLineId) ?? "0"
              if (BigInt(received) + BigInt(line.quantity) > BigInt(orderLine.quantity)) {
                return yield* Effect.fail(
                  new PurchaseReceiptQuantityExceeded({
                    tenantId: decoded.tenantId,
                    purchaseOrderId: decoded.purchaseOrderId,
                    purchaseOrderLineId: line.purchaseOrderLineId,
                    ordered: orderLine.quantity,
                    received,
                    requested: line.quantity,
                  }),
                )
              }
            }

            const [receipt] = yield* database.query(
              (db) =>
                db.insert(purchaseReceipts).values({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  warehouseId: decoded.warehouseId,
                  idempotencyKey: decoded.idempotencyKey,
                }).returning(purchaseReceiptSelection),
              "procurement.purchase_receipt.create",
            )
            const receivedLines: GoodsReceiptLine[] = []
            for (const line of lines) {
              const orderLine = linesById.get(line.purchaseOrderLineId)!
              const balance = yield* inventory.receiveStock({
                principal: decoded.principal,
                tenantId: decoded.tenantId,
                warehouseId: decoded.warehouseId,
                itemId: orderLine.itemId,
                quantity: line.quantity,
                legalEntityId,
                referenceId: receipt!.id,
              }).pipe(
                Effect.catchTag("InventoryReferenceNotFound", () =>
                  Effect.fail(
                    new PurchaseReceiptInventoryReferenceNotFound({
                      tenantId: decoded.tenantId,
                      warehouseId: decoded.warehouseId,
                      itemId: orderLine.itemId,
                    }),
                  )),
                Effect.catchTag("InventoryWarehouseLegalEntityMismatch", () =>
                  Effect.fail(
                    new PurchaseReceiptWarehouseLegalEntityMismatch({
                      tenantId: decoded.tenantId,
                      warehouseId: decoded.warehouseId,
                      legalEntityId,
                    }),
                  )),
              )
              receivedLines.push({
                id: crypto.randomUUID(),
                purchaseOrderLineId: line.purchaseOrderLineId,
                itemId: orderLine.itemId,
                quantity: line.quantity,
                unitOfMeasure: balance.unitOfMeasure,
              })
            }
            yield* database.query(
              (db) =>
                db.insert(purchaseReceiptLines).values(receivedLines.map((line) => ({
                  id: line.id,
                  tenantId: decoded.tenantId,
                  receiptId: receipt!.id,
                  purchaseOrderId: decoded.purchaseOrderId,
                  purchaseOrderLineId: line.purchaseOrderLineId,
                  itemId: line.itemId,
                  quantity: line.quantity,
                  unitOfMeasure: line.unitOfMeasure,
                }))),
              "procurement.purchase_receipt.lines",
            )
            return toGoodsReceipt(receipt!, receivedLines)
          }),
          "procurement.purchase_receipt.receive",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "purchase_receipts_tenant_idempotency_key")
              ? new PurchaseReceiptIdempotencyConflict({
                tenantId: decoded.tenantId,
                purchaseOrderId: decoded.purchaseOrderId,
                idempotencyKey: decoded.idempotencyKey,
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
      const clock = yield* Clock.Clock
      const now = () => new Date(clock.currentTimeMillisUnsafe())
      const storedSupplierAccounts = new Map<string, SupplierAccount>()
      const storedPurchaseOrders = new Map<string, PurchaseOrder>()
      const confirmationKeys = new Map<string, string>()
      const confirmationOrderIdsByKey = new Map<string, string>()
      const storedReceipts = new Map<string, GoodsReceipt>()
      const receivedQuantities = new Map<string, bigint>()

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
              confirmedAt: null,
              total,
              lines: decoded.lines.map((line) => ({ id: crypto.randomUUID(), ...line })),
            }
            storedPurchaseOrders.set(order.id, order)
            return order
          }),
        getPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(GetPurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderRead,
            })
            const order = storedPurchaseOrders.get(decoded.purchaseOrderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            return order
          }),
        confirmPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ConfirmPurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderConfirm,
            })
            const order = storedPurchaseOrders.get(decoded.purchaseOrderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            if (order.status === "confirmed") {
              if (confirmationKeys.get(order.id) !== decoded.idempotencyKey) {
                return yield* Effect.fail(
                  new PurchaseOrderConfirmationIdempotencyConflict({
                    tenantId: decoded.tenantId,
                    purchaseOrderId: decoded.purchaseOrderId,
                    idempotencyKey: decoded.idempotencyKey,
                  }),
                )
              }
              return order
            }
            if (order.status !== "draft") {
              return yield* Effect.fail(
                new PurchaseOrderInvalidState({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  status: order.status,
                }),
              )
            }
            const confirmationKey = `${decoded.tenantId}:${decoded.idempotencyKey}`
            const existingOrderId = confirmationOrderIdsByKey.get(confirmationKey)
            if (existingOrderId !== undefined && existingOrderId !== order.id) {
              return yield* Effect.fail(
                new PurchaseOrderConfirmationIdempotencyConflict({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  idempotencyKey: decoded.idempotencyKey,
                }),
              )
            }
            const confirmed: PurchaseOrder = {
              ...order,
              status: "confirmed",
              confirmedAt: now().toISOString(),
            }
            storedPurchaseOrders.set(order.id, confirmed)
            confirmationKeys.set(order.id, decoded.idempotencyKey)
            confirmationOrderIdsByKey.set(confirmationKey, order.id)
            return confirmed
          }),
        cancelPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CancelPurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderCancel,
            })
            const order = storedPurchaseOrders.get(decoded.purchaseOrderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            if (order.status === "cancelled") return order
            if (order.status !== "confirmed") {
              return yield* Effect.fail(
                new PurchaseOrderInvalidState({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  status: order.status,
                }),
              )
            }
            if (
              [...storedReceipts.values()].some((receipt) =>
                receipt.tenantId === decoded.tenantId && receipt.purchaseOrderId === order.id
              )
            ) {
              return yield* Effect.fail(
                new PurchaseOrderHasReceipts({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            const cancelled: PurchaseOrder = { ...order, status: "cancelled" }
            storedPurchaseOrders.set(order.id, cancelled)
            return cancelled
          }),
        receivePurchaseOrder: (input) =>
          Effect.gen(function* () {
            const inventory = yield* InventoryService
            const decoded = yield* Schema.decodeUnknownEffect(ReceivePurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseReceiptReceive,
            })
            const lines = canonicalReceiptLines(decoded.lines)
            const duplicateLine = lines.find((line, index) =>
              index > 0 && lines[index - 1]!.purchaseOrderLineId === line.purchaseOrderLineId
            )
            if (duplicateLine !== undefined) {
              return yield* Effect.fail(
                new PurchaseReceiptLineDuplicate({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  purchaseOrderLineId: duplicateLine.purchaseOrderLineId,
                }),
              )
            }
            const receiptKey = `${decoded.tenantId}:${decoded.idempotencyKey}`
            const existing = storedReceipts.get(receiptKey)
            if (existing !== undefined) {
              if (
                existing.purchaseOrderId !== decoded.purchaseOrderId ||
                existing.warehouseId !== decoded.warehouseId ||
                !sameReceiptLines(lines, existing.lines)
              ) {
                return yield* Effect.fail(
                  new PurchaseReceiptIdempotencyConflict({
                    tenantId: decoded.tenantId,
                    purchaseOrderId: decoded.purchaseOrderId,
                    idempotencyKey: decoded.idempotencyKey,
                  }),
                )
              }
              return existing
            }
            const order = storedPurchaseOrders.get(decoded.purchaseOrderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            if (order.status !== "confirmed") {
              return yield* Effect.fail(
                new PurchaseOrderInvalidState({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  status: order.status,
                }),
              )
            }
            const supplierAccount = storedSupplierAccounts.get(order.supplierAccountId)
            if (supplierAccount === undefined) {
              return yield* Effect.fail(
                new SupplierAccountNotFound({
                  tenantId: decoded.tenantId,
                  supplierAccountId: order.supplierAccountId,
                }),
              )
            }
            const linesById = new Map(order.lines.map((line) => [line.id, line]))
            const nextQuantities = new Map(receivedQuantities)
            const receiptId = crypto.randomUUID()
            const receivedLines: GoodsReceiptLine[] = []
            for (const line of lines) {
              const orderLine = linesById.get(line.purchaseOrderLineId)
              if (orderLine === undefined) {
                return yield* Effect.fail(
                  new PurchaseReceiptLineNotFound({
                    tenantId: decoded.tenantId,
                    purchaseOrderId: decoded.purchaseOrderId,
                    purchaseOrderLineId: line.purchaseOrderLineId,
                  }),
                )
              }
              const receivedKey = `${decoded.purchaseOrderId}:${line.purchaseOrderLineId}`
              const received = nextQuantities.get(receivedKey) ?? 0n
              if (received + BigInt(line.quantity) > BigInt(orderLine.quantity)) {
                return yield* Effect.fail(
                  new PurchaseReceiptQuantityExceeded({
                    tenantId: decoded.tenantId,
                    purchaseOrderId: decoded.purchaseOrderId,
                    purchaseOrderLineId: line.purchaseOrderLineId,
                    ordered: orderLine.quantity,
                    received: String(received),
                    requested: line.quantity,
                  }),
                )
              }
              const balance = yield* inventory.receiveStock({
                principal: decoded.principal,
                tenantId: decoded.tenantId,
                warehouseId: decoded.warehouseId,
                itemId: orderLine.itemId,
                quantity: line.quantity,
                legalEntityId: supplierAccount.legalEntityId,
                referenceId: receiptId,
              }).pipe(
                Effect.catchTag("InventoryReferenceNotFound", () =>
                  Effect.fail(
                    new PurchaseReceiptInventoryReferenceNotFound({
                      tenantId: decoded.tenantId,
                      warehouseId: decoded.warehouseId,
                      itemId: orderLine.itemId,
                    }),
                  )),
                Effect.catchTag("InventoryWarehouseLegalEntityMismatch", () =>
                  Effect.fail(
                    new PurchaseReceiptWarehouseLegalEntityMismatch({
                      tenantId: decoded.tenantId,
                      warehouseId: decoded.warehouseId,
                      legalEntityId: supplierAccount.legalEntityId,
                    }),
                  )),
              )
              nextQuantities.set(receivedKey, received + BigInt(line.quantity))
              receivedLines.push({
                id: crypto.randomUUID(),
                purchaseOrderLineId: line.purchaseOrderLineId,
                itemId: orderLine.itemId,
                quantity: line.quantity,
                unitOfMeasure: balance.unitOfMeasure,
              })
            }
            for (const [key, quantity] of nextQuantities) receivedQuantities.set(key, quantity)
            const receipt: GoodsReceipt = {
              id: receiptId,
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              warehouseId: decoded.warehouseId,
              idempotencyKey: decoded.idempotencyKey,
              receivedAt: now().toISOString(),
              lines: receivedLines,
            }
            storedReceipts.set(receiptKey, receipt)
            return receipt
          }),
      } satisfies ProcurementService
    }),
  )
