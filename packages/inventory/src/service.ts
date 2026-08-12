import { and, eq, gte, inArray, sql } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  items,
  movements,
  reservations,
  stockBalances,
  stockTransferLines,
  stockTransfers,
  warehouses,
} from "../../../db/schema/inventory.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { InventoryCapabilities } from "./capabilities.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"
import { EventIdempotencyConflict, MessagingService } from "../../messaging/mod.ts"

const Quantity = Schema.String.check(Schema.isPattern(/^[1-9]\d*$/))
const SignedQuantity = Schema.String.check(Schema.isPattern(/^-?[1-9]\d*$/))
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const UnitOfMeasure = Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_-]*$/))
const UnitOfMeasureInput = NonEmptyString
const DefaultUnitOfMeasure = UnitOfMeasureInput.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed("EA")),
)

export const Warehouse = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  legalEntityId: Schema.String,
  primaryBranchId: Schema.NullOr(Schema.String),
  name: Schema.String,
})
export const Item = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  sku: Schema.String,
  name: Schema.String,
  unitOfMeasure: UnitOfMeasure,
})
export const StockBalance = Schema.Struct({
  tenantId: Schema.String,
  warehouseId: Schema.String,
  itemId: Schema.String,
  onHand: Schema.String,
  reserved: Schema.String,
  unitOfMeasure: UnitOfMeasure,
})
export const StockCorrection = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  warehouseId: Schema.String,
  itemId: Schema.String,
  adjustment: SignedQuantity,
  unitOfMeasure: UnitOfMeasure,
  reason: NonEmptyString,
  idempotencyKey: NonEmptyString,
})
export const StockReservationStatus = Schema.Literals(["active", "released", "fulfilled"])
export const StockReservation = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  warehouseId: Schema.String,
  itemId: Schema.String,
  quantity: Quantity,
  idempotencyKey: Schema.NullOr(Schema.String),
  status: StockReservationStatus,
})
export const StockTransferStatus = Schema.Literals(["draft", "confirmed", "completed"])
export const StockTransferLine = Schema.Struct({
  itemId: Schema.String,
  quantity: Quantity,
})
export const StockTransfer = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  legalEntityId: Schema.String,
  sourceWarehouseId: Schema.String,
  destinationWarehouseId: Schema.String,
  status: StockTransferStatus,
  confirmedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  lines: Schema.Array(StockTransferLine),
})

export type Warehouse = Schema.Schema.Type<typeof Warehouse>
export type Item = Schema.Schema.Type<typeof Item>
export type StockBalance = Schema.Schema.Type<typeof StockBalance>
export type StockCorrection = Schema.Schema.Type<typeof StockCorrection>
export type StockReservation = Schema.Schema.Type<typeof StockReservation>
export type StockTransferStatus = Schema.Schema.Type<typeof StockTransferStatus>
export type StockTransferLine = Schema.Schema.Type<typeof StockTransferLine>
export type StockTransfer = Schema.Schema.Type<typeof StockTransfer>

const ScopedInput = { principal: Principal, tenantId: Schema.String }
export const CreateWarehouseInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  primaryBranchId: Schema.optionalKey(Schema.String),
  name: Schema.String,
})
export const CreateItemInput = Schema.Struct({
  ...ScopedInput,
  sku: Schema.String,
  name: Schema.String,
  unitOfMeasure: DefaultUnitOfMeasure,
})
export const ReceiveStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Schema.String,
  itemId: Schema.String,
  quantity: Quantity,
})
export const AdjustStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Schema.String,
  itemId: Schema.String,
  adjustment: SignedQuantity,
  unitOfMeasure: UnitOfMeasureInput,
  reason: NonEmptyString,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.optionalKey(Schema.NullOr(NonEmptyString)),
  idempotencyKey: NonEmptyString,
})
export const ReserveStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Schema.String,
  itemId: Schema.String,
  quantity: Quantity,
  idempotencyKey: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
})
export const ReleaseReservationInput = Schema.Struct({
  ...ScopedInput,
  reservationId: Schema.String,
})
export const FulfillReservationInput = ReleaseReservationInput
export const CreateStockTransferInput = Schema.Struct({
  ...ScopedInput,
  sourceWarehouseId: Schema.String,
  destinationWarehouseId: Schema.String,
  lines: Schema.Array(StockTransferLine).check(Schema.isMinLength(1)),
})
export const ConfirmStockTransferInput = Schema.Struct({
  ...ScopedInput,
  transferId: Schema.String,
})
export const CompleteStockTransferInput = ConfirmStockTransferInput

export class InventoryReferenceNotFound
  extends Schema.TaggedErrorClass<InventoryReferenceNotFound>()("InventoryReferenceNotFound", {
    tenantId: Schema.String,
    warehouseId: Schema.String,
    itemId: Schema.String,
  }) {}
export class WarehouseAlreadyExists
  extends Schema.TaggedErrorClass<WarehouseAlreadyExists>()("WarehouseAlreadyExists", {
    tenantId: Schema.String,
    name: Schema.String,
  }) {}
export class WarehouseLegalEntityNotFound
  extends Schema.TaggedErrorClass<WarehouseLegalEntityNotFound>()("WarehouseLegalEntityNotFound", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
  }) {}
export class WarehouseBranchNotFound
  extends Schema.TaggedErrorClass<WarehouseBranchNotFound>()("WarehouseBranchNotFound", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
    branchId: Schema.String,
  }) {}
export class ItemAlreadyExists
  extends Schema.TaggedErrorClass<ItemAlreadyExists>()("ItemAlreadyExists", {
    tenantId: Schema.String,
    sku: Schema.String,
  }) {}
export class StockUnavailable
  extends Schema.TaggedErrorClass<StockUnavailable>()("StockUnavailable", {
    tenantId: Schema.String,
    warehouseId: Schema.String,
    itemId: Schema.String,
    requested: Schema.String,
  }) {}
export class InventoryUnitOfMeasureMismatch
  extends Schema.TaggedErrorClass<InventoryUnitOfMeasureMismatch>()(
    "InventoryUnitOfMeasureMismatch",
    {
      tenantId: Schema.String,
      itemId: Schema.String,
      expected: UnitOfMeasure,
      actual: UnitOfMeasure,
    },
  ) {}
export class StockCorrectionIdempotencyConflict
  extends Schema.TaggedErrorClass<StockCorrectionIdempotencyConflict>()(
    "StockCorrectionIdempotencyConflict",
    {
      tenantId: Schema.String,
      idempotencyKey: Schema.String,
    },
  ) {}
export class StockReservationIdempotencyConflict
  extends Schema.TaggedErrorClass<StockReservationIdempotencyConflict>()(
    "StockReservationIdempotencyConflict",
    {
      tenantId: Schema.String,
      idempotencyKey: Schema.String,
    },
  ) {}
export class StockReservationNotFound
  extends Schema.TaggedErrorClass<StockReservationNotFound>()("StockReservationNotFound", {
    tenantId: Schema.String,
    reservationId: Schema.String,
  }) {}
export class StockReservationInvalidState
  extends Schema.TaggedErrorClass<StockReservationInvalidState>()(
    "StockReservationInvalidState",
    {
      tenantId: Schema.String,
      reservationId: Schema.String,
      operation: Schema.Literals(["release", "fulfill"]),
      status: StockReservationStatus,
    },
  ) {}
export class StockTransferNotFound
  extends Schema.TaggedErrorClass<StockTransferNotFound>()("StockTransferNotFound", {
    tenantId: Schema.String,
    transferId: Schema.String,
  }) {}
export class StockTransferInvalidState
  extends Schema.TaggedErrorClass<StockTransferInvalidState>()("StockTransferInvalidState", {
    tenantId: Schema.String,
    transferId: Schema.String,
    operation: Schema.Literals(["confirm", "complete"]),
    status: StockTransferStatus,
  }) {}
export class StockTransferSameWarehouse
  extends Schema.TaggedErrorClass<StockTransferSameWarehouse>()("StockTransferSameWarehouse", {
    tenantId: Schema.String,
    warehouseId: Schema.String,
  }) {}
export class StockTransferDifferentLegalEntity
  extends Schema.TaggedErrorClass<StockTransferDifferentLegalEntity>()(
    "StockTransferDifferentLegalEntity",
    {
      tenantId: Schema.String,
      sourceWarehouseId: Schema.String,
      destinationWarehouseId: Schema.String,
    },
  ) {}
export class StockTransferDuplicateItem
  extends Schema.TaggedErrorClass<StockTransferDuplicateItem>()("StockTransferDuplicateItem", {
    tenantId: Schema.String,
    itemId: Schema.String,
  }) {}
export class StockTransferWarehouseNotFound
  extends Schema.TaggedErrorClass<StockTransferWarehouseNotFound>()(
    "StockTransferWarehouseNotFound",
    { tenantId: Schema.String, warehouseId: Schema.String },
  ) {}
export class StockTransferItemNotFound
  extends Schema.TaggedErrorClass<StockTransferItemNotFound>()("StockTransferItemNotFound", {
    tenantId: Schema.String,
    itemId: Schema.String,
  }) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface InventoryService {
  readonly createWarehouse: (
    input: unknown,
  ) => Effect.Effect<
    Warehouse,
    WarehouseAlreadyExists | WarehouseBranchNotFound | WarehouseLegalEntityNotFound | CommonFailure
  >
  readonly createItem: (input: unknown) => Effect.Effect<Item, ItemAlreadyExists | CommonFailure>
  readonly receiveStock: (
    input: unknown,
  ) => Effect.Effect<StockBalance, InventoryReferenceNotFound | CommonFailure>
  readonly adjustStock: (
    input: unknown,
  ) => Effect.Effect<
    StockCorrection,
    | InventoryReferenceNotFound
    | InventoryUnitOfMeasureMismatch
    | StockCorrectionIdempotencyConflict
    | StockUnavailable
    | EventIdempotencyConflict
    | CommonFailure
  >
  readonly reserveStock: (
    input: unknown,
  ) => Effect.Effect<
    StockReservation,
    StockReservationIdempotencyConflict | StockUnavailable | CommonFailure
  >
  readonly releaseReservation: (
    input: unknown,
  ) => Effect.Effect<
    StockReservation,
    StockReservationInvalidState | StockReservationNotFound | CommonFailure
  >
  readonly fulfillReservation: (
    input: unknown,
  ) => Effect.Effect<
    StockReservation,
    StockReservationInvalidState | StockReservationNotFound | CommonFailure
  >
  readonly createTransfer: (
    input: unknown,
  ) => Effect.Effect<
    StockTransfer,
    | StockTransferDifferentLegalEntity
    | StockTransferDuplicateItem
    | StockTransferItemNotFound
    | StockTransferSameWarehouse
    | StockTransferWarehouseNotFound
    | CommonFailure
  >
  readonly confirmTransfer: (
    input: unknown,
  ) => Effect.Effect<
    StockTransfer,
    | StockUnavailable
    | StockTransferNotFound
    | CommonFailure
  >
  readonly completeTransfer: (
    input: unknown,
  ) => Effect.Effect<
    StockTransfer,
    | StockTransferInvalidState
    | StockTransferNotFound
    | CommonFailure
  >
}

export const InventoryService = Context.Service<InventoryService>("EclipseERP/InventoryService")

const referenceFailure = (tenantId: string, warehouseId: string, itemId: string) =>
  new InventoryReferenceNotFound({ tenantId, warehouseId, itemId })

const correctionSelection = {
  id: movements.id,
  tenantId: movements.tenantId,
  kind: movements.kind,
  warehouseId: movements.warehouseId,
  itemId: movements.itemId,
  adjustment: movements.quantity,
  unitOfMeasure: movements.unitOfMeasure,
  reason: movements.reason,
  idempotencyKey: movements.idempotencyKey,
}

const toStockCorrection = (row: {
  readonly id: string
  readonly tenantId: string
  readonly kind: "receipt" | "issue" | "reservation" | "release"
  readonly warehouseId: string
  readonly itemId: string
  readonly adjustment: string
  readonly unitOfMeasure: string | null
  readonly reason: string | null
  readonly idempotencyKey: string | null
}): StockCorrection => ({
  id: row.id,
  tenantId: row.tenantId,
  warehouseId: row.warehouseId,
  itemId: row.itemId,
  adjustment: row.adjustment,
  unitOfMeasure: row.unitOfMeasure!,
  reason: row.reason!,
  idempotencyKey: row.idempotencyKey!,
})

const reservationSelection = {
  id: reservations.id,
  tenantId: reservations.tenantId,
  warehouseId: reservations.warehouseId,
  itemId: reservations.itemId,
  quantity: reservations.quantity,
  idempotencyKey: reservations.idempotencyKey,
  status: reservations.status,
}

const transferSelection = {
  id: stockTransfers.id,
  tenantId: stockTransfers.tenantId,
  legalEntityId: stockTransfers.legalEntityId,
  sourceWarehouseId: stockTransfers.sourceWarehouseId,
  destinationWarehouseId: stockTransfers.destinationWarehouseId,
  status: stockTransfers.status,
  confirmedAt: stockTransfers.confirmedAt,
  completedAt: stockTransfers.completedAt,
}

const transferLineSelection = {
  itemId: stockTransferLines.itemId,
  quantity: stockTransferLines.quantity,
}

const toStockTransfer = (
  row: {
    readonly id: string
    readonly tenantId: string
    readonly legalEntityId: string
    readonly sourceWarehouseId: string
    readonly destinationWarehouseId: string
    readonly status: StockTransferStatus
    readonly confirmedAt: Date | null
    readonly completedAt: Date | null
  },
  lines: readonly StockTransferLine[],
): StockTransfer => ({
  id: row.id,
  tenantId: row.tenantId,
  legalEntityId: row.legalEntityId,
  sourceWarehouseId: row.sourceWarehouseId,
  destinationWarehouseId: row.destinationWarehouseId,
  status: row.status,
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  completedAt: row.completedAt?.toISOString() ?? null,
  lines,
})

const mapTransferCreateError = (
  error: DatabaseFailure,
  input: Schema.Schema.Type<typeof CreateStockTransferInput>,
) =>
  isDatabaseConstraint(error, "stock_transfers_distinct_warehouses_check", "23514")
    ? new StockTransferSameWarehouse({
      tenantId: input.tenantId,
      warehouseId: input.sourceWarehouseId,
    })
    : error

export const makeInventoryService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const messaging = yield* MessagingService
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())
  return {
    createWarehouse: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateWarehouseInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.warehouseCreate,
        })
        const name = decoded.name.trim()
        const primaryBranchId = decoded.primaryBranchId ?? null
        const rows = yield* database.query(
          (db) =>
            db.insert(warehouses).values({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              primaryBranchId,
              name,
            }).returning({
              id: warehouses.id,
              tenantId: warehouses.tenantId,
              legalEntityId: warehouses.legalEntityId,
              primaryBranchId: warehouses.primaryBranchId,
              name: warehouses.name,
            }),
          "inventory.warehouse.create",
        ).pipe(
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "warehouses_tenant_name_key")) {
              return new WarehouseAlreadyExists({ tenantId: decoded.tenantId, name })
            }
            if (isDatabaseConstraint(error, "warehouses_tenant_legal_entity_fkey", "23503")) {
              return new WarehouseLegalEntityNotFound({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
              })
            }
            if (
              primaryBranchId !== null &&
              isDatabaseConstraint(error, "warehouses_tenant_legal_entity_branch_fkey", "23503")
            ) {
              return new WarehouseBranchNotFound({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
                branchId: primaryBranchId,
              })
            }
            return error
          }),
        )
        return rows[0]!
      }),
    createItem: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateItemInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.itemCreate,
        })
        const sku = decoded.sku.trim().toUpperCase()
        const unitOfMeasure = decoded.unitOfMeasure.trim().toUpperCase()
        const rows = yield* database.query(
          (db) =>
            db.insert(items).values({
              tenantId: decoded.tenantId,
              sku,
              name: decoded.name.trim(),
              unitOfMeasure,
            }).returning({
              id: items.id,
              tenantId: items.tenantId,
              sku: items.sku,
              name: items.name,
              unitOfMeasure: items.unitOfMeasure,
            }),
          "inventory.item.create",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "items_tenant_sku_key")
              ? new ItemAlreadyExists({ tenantId: decoded.tenantId, sku })
              : error
          ),
        )
        return rows[0]!
      }),
    receiveStock: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ReceiveStockInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockReceive,
        })
        const balance = yield* database.transaction(
          async (tx) => {
            const [item] = await tx.select({ unitOfMeasure: items.unitOfMeasure })
              .from(items)
              .where(and(eq(items.tenantId, decoded.tenantId), eq(items.id, decoded.itemId)))
            if (item === undefined) return undefined
            const rows = await tx.insert(stockBalances)
              .values({
                tenantId: decoded.tenantId,
                warehouseId: decoded.warehouseId,
                itemId: decoded.itemId,
                onHand: decoded.quantity,
              })
              .onConflictDoUpdate({
                target: [stockBalances.tenantId, stockBalances.warehouseId, stockBalances.itemId],
                set: {
                  onHand: sql`${stockBalances.onHand} + ${decoded.quantity}`,
                  updatedAt: now(),
                },
              })
              .returning({
                tenantId: stockBalances.tenantId,
                warehouseId: stockBalances.warehouseId,
                itemId: stockBalances.itemId,
                onHand: stockBalances.onHand,
                reserved: stockBalances.reserved,
              })
            await tx.insert(movements).values({
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: decoded.itemId,
              quantity: decoded.quantity,
              kind: "receipt",
            })
            return { ...rows[0]!, unitOfMeasure: item.unitOfMeasure }
          },
          "inventory.stock.receive",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "stock_balances_warehouse_fkey", "23503") ||
              isDatabaseConstraint(error, "stock_balances_item_fkey", "23503")
              ? referenceFailure(decoded.tenantId, decoded.warehouseId, decoded.itemId)
              : error
          ),
        )
        if (balance === undefined) {
          return yield* Effect.fail(
            referenceFailure(decoded.tenantId, decoded.warehouseId, decoded.itemId),
          )
        }
        return balance
      }),
    adjustStock: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AdjustStockInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockAdjust,
        })
        const unitOfMeasure = decoded.unitOfMeasure.trim().toUpperCase()
        const reason = decoded.reason.trim()
        const commandId = decoded.commandId.trim()
        const correlationId = decoded.correlationId.trim()
        const causationId = decoded.causationId?.trim() ?? null
        const idempotencyKey = decoded.idempotencyKey.trim()
        const result = yield* database.withTransaction(
          Effect.gen(function* () {
            const mutation = yield* database.transaction(
              async (tx) => {
                const [existing] = await tx.select(correctionSelection)
                  .from(movements)
                  .where(
                    and(
                      eq(movements.tenantId, decoded.tenantId),
                      eq(movements.idempotencyKey, idempotencyKey),
                    ),
                  )
                  .for("update")
                if (existing !== undefined) {
                  if (
                    existing.warehouseId !== decoded.warehouseId ||
                    existing.itemId !== decoded.itemId ||
                    existing.adjustment !== decoded.adjustment ||
                    existing.unitOfMeasure !== unitOfMeasure ||
                    existing.reason !== reason
                  ) return { _tag: "idempotency-conflict" as const }
                  return { _tag: "existing" as const, correction: toStockCorrection(existing) }
                }

                const [item] = await tx.select({ unitOfMeasure: items.unitOfMeasure })
                  .from(items)
                  .where(and(eq(items.tenantId, decoded.tenantId), eq(items.id, decoded.itemId)))
                  .for("update")
                const [warehouse] = await tx.select({ id: warehouses.id })
                  .from(warehouses)
                  .where(
                    and(
                      eq(warehouses.tenantId, decoded.tenantId),
                      eq(warehouses.id, decoded.warehouseId),
                    ),
                  )
                if (item === undefined || warehouse === undefined) {
                  return { _tag: "not-found" as const }
                }
                if (item.unitOfMeasure !== unitOfMeasure) {
                  return {
                    _tag: "uom-mismatch" as const,
                    expected: item.unitOfMeasure,
                    actual: unitOfMeasure,
                  }
                }

                const adjustment = BigInt(decoded.adjustment)
                const occurredAt = now()
                if (adjustment < 0n) {
                  const [balance] = await tx.select({
                    onHand: stockBalances.onHand,
                    reserved: stockBalances.reserved,
                  }).from(stockBalances).where(
                    and(
                      eq(stockBalances.tenantId, decoded.tenantId),
                      eq(stockBalances.warehouseId, decoded.warehouseId),
                      eq(stockBalances.itemId, decoded.itemId),
                    ),
                  ).for("update")
                  if (
                    balance === undefined ||
                    BigInt(balance.onHand) + adjustment < BigInt(balance.reserved)
                  ) return { _tag: "unavailable" as const }
                  await tx.update(stockBalances).set({
                    onHand: sql`${stockBalances.onHand} + ${decoded.adjustment}`,
                    updatedAt: occurredAt,
                  }).where(
                    and(
                      eq(stockBalances.tenantId, decoded.tenantId),
                      eq(stockBalances.warehouseId, decoded.warehouseId),
                      eq(stockBalances.itemId, decoded.itemId),
                    ),
                  )
                } else {
                  await tx.insert(stockBalances).values({
                    tenantId: decoded.tenantId,
                    warehouseId: decoded.warehouseId,
                    itemId: decoded.itemId,
                    onHand: decoded.adjustment,
                  }).onConflictDoUpdate({
                    target: [
                      stockBalances.tenantId,
                      stockBalances.warehouseId,
                      stockBalances.itemId,
                    ],
                    set: {
                      onHand: sql`${stockBalances.onHand} + ${decoded.adjustment}`,
                      updatedAt: occurredAt,
                    },
                  })
                }
                const [correction] = await tx.insert(movements).values({
                  tenantId: decoded.tenantId,
                  warehouseId: decoded.warehouseId,
                  itemId: decoded.itemId,
                  quantity: decoded.adjustment,
                  kind: adjustment < 0n ? "issue" : "receipt",
                  unitOfMeasure,
                  reason,
                  idempotencyKey,
                }).returning(correctionSelection)
                return {
                  _tag: "created" as const,
                  correction: toStockCorrection(correction!),
                  occurredAt,
                }
              },
              "inventory.stock.adjust",
            )

            if (mutation._tag === "created") {
              yield* messaging.append({
                eventId: mutation.correction.id,
                eventType: "inventory.stock.corrected",
                eventVersion: 1,
                tenantId: decoded.tenantId,
                aggregateType: "stock_correction",
                aggregateId: mutation.correction.id,
                commandId,
                correlationId,
                causationId,
                idempotencyKey,
                actorPrincipalId: decoded.principal.userAccountId,
                occurredAt: mutation.occurredAt.toISOString(),
                payload: {
                  correctionId: mutation.correction.id,
                  warehouseId: mutation.correction.warehouseId,
                  itemId: mutation.correction.itemId,
                },
              })
            }
            return mutation
          }),
          "inventory.stock.adjust.atomic",
        ).pipe(
          Effect.catch((error) => {
            if (!isDatabaseConstraint(error, "movements_tenant_idempotency_key")) {
              return Effect.fail(error)
            }
            return database.query(
              (db) =>
                db.select(correctionSelection).from(movements).where(
                  and(
                    eq(movements.tenantId, decoded.tenantId),
                    eq(movements.idempotencyKey, idempotencyKey),
                  ),
                ),
              "inventory.stock.adjust.idempotency",
            ).pipe(
              Effect.map((rows) => {
                const existing = rows[0]
                return existing !== undefined &&
                    existing.warehouseId === decoded.warehouseId &&
                    existing.itemId === decoded.itemId &&
                    existing.adjustment === decoded.adjustment &&
                    existing.unitOfMeasure === unitOfMeasure &&
                    existing.reason === reason
                  ? { _tag: "existing" as const, correction: toStockCorrection(existing) }
                  : { _tag: "idempotency-conflict" as const }
              }),
            )
          }),
        )
        if (result._tag === "idempotency-conflict") {
          return yield* Effect.fail(
            new StockCorrectionIdempotencyConflict({ tenantId: decoded.tenantId, idempotencyKey }),
          )
        }
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            referenceFailure(decoded.tenantId, decoded.warehouseId, decoded.itemId),
          )
        }
        if (result._tag === "uom-mismatch") {
          return yield* Effect.fail(
            new InventoryUnitOfMeasureMismatch({
              tenantId: decoded.tenantId,
              itemId: decoded.itemId,
              expected: result.expected,
              actual: result.actual,
            }),
          )
        }
        if (result._tag === "unavailable") {
          return yield* Effect.fail(
            new StockUnavailable({
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: decoded.itemId,
              requested: decoded.adjustment,
            }),
          )
        }
        return result.correction
      }),
    reserveStock: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ReserveStockInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockReserve,
        })
        const reservation = yield* database.transaction(
          async (tx) => {
            if (decoded.idempotencyKey !== undefined) {
              const existingRows = await tx.select({
                id: reservations.id,
                tenantId: reservations.tenantId,
                warehouseId: reservations.warehouseId,
                itemId: reservations.itemId,
                quantity: reservations.quantity,
                idempotencyKey: reservations.idempotencyKey,
                status: reservations.status,
              })
                .from(reservations)
                .where(
                  and(
                    eq(reservations.tenantId, decoded.tenantId),
                    eq(reservations.idempotencyKey, decoded.idempotencyKey),
                  ),
                )
                .for("update")
              const existing = existingRows[0]
              if (existing !== undefined) {
                if (
                  existing.warehouseId !== decoded.warehouseId ||
                  existing.itemId !== decoded.itemId ||
                  existing.quantity !== decoded.quantity
                ) {
                  return { _tag: "idempotency-conflict" as const }
                }
                return { _tag: "existing" as const, reservation: existing }
              }
            }

            const updated = await tx.update(stockBalances)
              .set({
                reserved: sql`${stockBalances.reserved} + ${decoded.quantity}`,
                updatedAt: now(),
              })
              .where(
                and(
                  eq(stockBalances.tenantId, decoded.tenantId),
                  eq(stockBalances.warehouseId, decoded.warehouseId),
                  eq(stockBalances.itemId, decoded.itemId),
                  gte(sql`${stockBalances.onHand} - ${stockBalances.reserved}`, decoded.quantity),
                ),
              )
              .returning({ itemId: stockBalances.itemId })
            if (updated[0] === undefined) return { _tag: "unavailable" as const }

            const rows = await tx.insert(reservations).values({
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: decoded.itemId,
              quantity: decoded.quantity,
              idempotencyKey: decoded.idempotencyKey ?? null,
            }).returning({
              id: reservations.id,
              tenantId: reservations.tenantId,
              warehouseId: reservations.warehouseId,
              itemId: reservations.itemId,
              quantity: reservations.quantity,
              idempotencyKey: reservations.idempotencyKey,
              status: reservations.status,
            })
            const row = rows[0]!
            await tx.insert(movements).values({
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: decoded.itemId,
              quantity: decoded.quantity,
              kind: "reservation",
              referenceId: row.id,
            })
            return { _tag: "created" as const, reservation: row }
          },
          "inventory.stock.reserve",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "reservations_tenant_idempotency_key") &&
              decoded.idempotencyKey !== undefined
              ? new StockReservationIdempotencyConflict({
                tenantId: decoded.tenantId,
                idempotencyKey: decoded.idempotencyKey,
              })
              : error
          ),
        )
        if (reservation._tag === "idempotency-conflict") {
          return yield* Effect.fail(
            new StockReservationIdempotencyConflict({
              tenantId: decoded.tenantId,
              idempotencyKey: decoded.idempotencyKey!,
            }),
          )
        }
        if (reservation._tag === "existing" || reservation._tag === "created") {
          return reservation.reservation
        }
        return yield* Effect.fail(
          new StockUnavailable({
            tenantId: decoded.tenantId,
            warehouseId: decoded.warehouseId,
            itemId: decoded.itemId,
            requested: decoded.quantity,
          }),
        )
      }),
    releaseReservation: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ReleaseReservationInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockRelease,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [reservation] = await tx.select(reservationSelection)
              .from(reservations)
              .where(
                and(
                  eq(reservations.tenantId, decoded.tenantId),
                  eq(reservations.id, decoded.reservationId),
                ),
              )
              .for("update")
            if (reservation === undefined) return { _tag: "not-found" as const }
            if (reservation.status === "released") {
              return { _tag: "existing" as const, reservation }
            }
            if (reservation.status !== "active") {
              return { _tag: "invalid-state" as const, status: reservation.status }
            }

            const timestamp = now()
            await tx.update(stockBalances)
              .set({
                reserved: sql`${stockBalances.reserved} - ${reservation.quantity}`,
                updatedAt: timestamp,
              })
              .where(
                and(
                  eq(stockBalances.tenantId, decoded.tenantId),
                  eq(stockBalances.warehouseId, reservation.warehouseId),
                  eq(stockBalances.itemId, reservation.itemId),
                ),
              )
            const [released] = await tx.update(reservations)
              .set({ status: "released", updatedAt: timestamp })
              .where(eq(reservations.id, reservation.id))
              .returning(reservationSelection)
            await tx.insert(movements).values({
              tenantId: decoded.tenantId,
              warehouseId: reservation.warehouseId,
              itemId: reservation.itemId,
              quantity: String(-BigInt(reservation.quantity)),
              kind: "release",
              referenceId: reservation.id,
            })
            return { _tag: "released" as const, reservation: released! }
          },
          "inventory.stock.release",
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new StockReservationNotFound({
              tenantId: decoded.tenantId,
              reservationId: decoded.reservationId,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new StockReservationInvalidState({
              tenantId: decoded.tenantId,
              reservationId: decoded.reservationId,
              operation: "release",
              status: result.status,
            }),
          )
        }
        return result.reservation
      }),
    fulfillReservation: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(FulfillReservationInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockFulfill,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [reservation] = await tx.select(reservationSelection)
              .from(reservations)
              .where(
                and(
                  eq(reservations.tenantId, decoded.tenantId),
                  eq(reservations.id, decoded.reservationId),
                ),
              )
              .for("update")
            if (reservation === undefined) return { _tag: "not-found" as const }
            if (reservation.status === "fulfilled") {
              return { _tag: "existing" as const, reservation }
            }
            if (reservation.status !== "active") {
              return { _tag: "invalid-state" as const, status: reservation.status }
            }

            const timestamp = now()
            await tx.update(stockBalances)
              .set({
                onHand: sql`${stockBalances.onHand} - ${reservation.quantity}`,
                reserved: sql`${stockBalances.reserved} - ${reservation.quantity}`,
                updatedAt: timestamp,
              })
              .where(
                and(
                  eq(stockBalances.tenantId, decoded.tenantId),
                  eq(stockBalances.warehouseId, reservation.warehouseId),
                  eq(stockBalances.itemId, reservation.itemId),
                ),
              )
            const [fulfilled] = await tx.update(reservations)
              .set({ status: "fulfilled", updatedAt: timestamp })
              .where(eq(reservations.id, reservation.id))
              .returning(reservationSelection)
            await tx.insert(movements).values({
              tenantId: decoded.tenantId,
              warehouseId: reservation.warehouseId,
              itemId: reservation.itemId,
              quantity: String(-BigInt(reservation.quantity)),
              kind: "issue",
              referenceId: reservation.id,
            })
            return { _tag: "fulfilled" as const, reservation: fulfilled! }
          },
          "inventory.stock.fulfill",
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new StockReservationNotFound({
              tenantId: decoded.tenantId,
              reservationId: decoded.reservationId,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new StockReservationInvalidState({
              tenantId: decoded.tenantId,
              reservationId: decoded.reservationId,
              operation: "fulfill",
              status: result.status,
            }),
          )
        }
        return result.reservation
      }),
    createTransfer: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateStockTransferInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockTransferCreate,
        })
        if (decoded.sourceWarehouseId === decoded.destinationWarehouseId) {
          return yield* Effect.fail(
            new StockTransferSameWarehouse({
              tenantId: decoded.tenantId,
              warehouseId: decoded.sourceWarehouseId,
            }),
          )
        }
        const itemIds = new Set<string>()
        for (const line of decoded.lines) {
          if (itemIds.has(line.itemId)) {
            return yield* Effect.fail(
              new StockTransferDuplicateItem({ tenantId: decoded.tenantId, itemId: line.itemId }),
            )
          }
          itemIds.add(line.itemId)
        }

        const result = yield* database.transaction(
          async (tx) => {
            const warehouseRows = await tx.select({
              id: warehouses.id,
              legalEntityId: warehouses.legalEntityId,
            })
              .from(warehouses)
              .where(
                and(
                  eq(warehouses.tenantId, decoded.tenantId),
                  inArray(warehouses.id, [
                    decoded.sourceWarehouseId,
                    decoded.destinationWarehouseId,
                  ]),
                ),
              )
              .for("update")
            const warehousesById = new Map(warehouseRows.map((row) => [row.id, row]))
            const sourceWarehouse = warehousesById.get(decoded.sourceWarehouseId)
            const destinationWarehouse = warehousesById.get(decoded.destinationWarehouseId)
            const missingWarehouseId = sourceWarehouse === undefined
              ? decoded.sourceWarehouseId
              : destinationWarehouse === undefined
              ? decoded.destinationWarehouseId
              : undefined
            if (missingWarehouseId !== undefined) {
              return { _tag: "warehouse-not-found" as const, warehouseId: missingWarehouseId }
            }
            if (sourceWarehouse!.legalEntityId !== destinationWarehouse!.legalEntityId) {
              return {
                _tag: "different-legal-entity" as const,
                sourceWarehouseId: decoded.sourceWarehouseId,
                destinationWarehouseId: decoded.destinationWarehouseId,
              }
            }

            const itemRows = await tx.select({ id: items.id })
              .from(items)
              .where(
                and(
                  eq(items.tenantId, decoded.tenantId),
                  inArray(items.id, [...itemIds]),
                ),
              )
              .for("update")
            const existingItemIds = new Set(itemRows.map((row) => row.id))
            const missingItemId = decoded.lines.find((line) => !existingItemIds.has(line.itemId))
              ?.itemId
            if (missingItemId !== undefined) {
              return { _tag: "item-not-found" as const, itemId: missingItemId }
            }

            const [row] = await tx.insert(stockTransfers).values({
              tenantId: decoded.tenantId,
              legalEntityId: sourceWarehouse!.legalEntityId,
              sourceWarehouseId: decoded.sourceWarehouseId,
              destinationWarehouseId: decoded.destinationWarehouseId,
            }).returning(transferSelection)
            await tx.insert(stockTransferLines).values(
              decoded.lines.map((line) => ({
                tenantId: decoded.tenantId,
                transferId: row!.id,
                itemId: line.itemId,
                quantity: line.quantity,
              })),
            )
            return {
              _tag: "created" as const,
              transfer: toStockTransfer(row!, decoded.lines),
            }
          },
          "inventory.stock.transfer.create",
        ).pipe(Effect.mapError((error) => mapTransferCreateError(error, decoded)))

        if (result._tag === "warehouse-not-found") {
          return yield* Effect.fail(
            new StockTransferWarehouseNotFound({
              tenantId: decoded.tenantId,
              warehouseId: result.warehouseId,
            }),
          )
        }
        if (result._tag === "different-legal-entity") {
          return yield* Effect.fail(
            new StockTransferDifferentLegalEntity({
              tenantId: decoded.tenantId,
              sourceWarehouseId: result.sourceWarehouseId,
              destinationWarehouseId: result.destinationWarehouseId,
            }),
          )
        }
        if (result._tag === "item-not-found") {
          return yield* Effect.fail(
            new StockTransferItemNotFound({ tenantId: decoded.tenantId, itemId: result.itemId }),
          )
        }
        return result.transfer
      }),
    confirmTransfer: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConfirmStockTransferInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockTransferConfirm,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select(transferSelection)
              .from(stockTransfers)
              .where(
                and(
                  eq(stockTransfers.tenantId, decoded.tenantId),
                  eq(stockTransfers.id, decoded.transferId),
                ),
              )
              .for("update")
            if (row === undefined) return { _tag: "not-found" as const }

            const lines = await tx.select(transferLineSelection)
              .from(stockTransferLines)
              .where(
                and(
                  eq(stockTransferLines.tenantId, decoded.tenantId),
                  eq(stockTransferLines.transferId, decoded.transferId),
                ),
              )
              .orderBy(stockTransferLines.itemId)
            const current = toStockTransfer(row, lines)
            if (row.status !== "draft") return { _tag: "existing" as const, transfer: current }

            const balances = lines.length === 0 ? [] : await tx.select({
              itemId: stockBalances.itemId,
              onHand: stockBalances.onHand,
              reserved: stockBalances.reserved,
            })
              .from(stockBalances)
              .where(
                and(
                  eq(stockBalances.tenantId, decoded.tenantId),
                  eq(stockBalances.warehouseId, row.sourceWarehouseId),
                  inArray(stockBalances.itemId, lines.map((line) => line.itemId)),
                ),
              )
              .orderBy(stockBalances.itemId)
              .for("update")
            const balancesByItem = new Map(balances.map((balance) => [balance.itemId, balance]))
            for (const line of lines) {
              const balance = balancesByItem.get(line.itemId)
              if (
                balance === undefined ||
                BigInt(balance.onHand) - BigInt(balance.reserved) < BigInt(line.quantity)
              ) {
                return {
                  _tag: "unavailable" as const,
                  warehouseId: row.sourceWarehouseId,
                  itemId: line.itemId,
                  requested: line.quantity,
                }
              }
            }

            const timestamp = now()
            for (const line of lines) {
              await tx.update(stockBalances)
                .set({
                  onHand: sql`${stockBalances.onHand} - ${line.quantity}`,
                  updatedAt: timestamp,
                })
                .where(
                  and(
                    eq(stockBalances.tenantId, decoded.tenantId),
                    eq(stockBalances.warehouseId, row.sourceWarehouseId),
                    eq(stockBalances.itemId, line.itemId),
                  ),
                )
            }
            if (lines.length > 0) {
              await tx.insert(movements).values(
                lines.map((line) => ({
                  tenantId: decoded.tenantId,
                  warehouseId: row.sourceWarehouseId,
                  itemId: line.itemId,
                  quantity: String(-BigInt(line.quantity)),
                  kind: "issue" as const,
                  referenceId: row.id,
                })),
              )
            }
            const [confirmed] = await tx.update(stockTransfers)
              .set({ status: "confirmed", confirmedAt: timestamp, updatedAt: timestamp })
              .where(
                and(
                  eq(stockTransfers.tenantId, decoded.tenantId),
                  eq(stockTransfers.id, decoded.transferId),
                  eq(stockTransfers.status, "draft"),
                ),
              )
              .returning(transferSelection)
            return { _tag: "confirmed" as const, transfer: toStockTransfer(confirmed!, lines) }
          },
          "inventory.stock.transfer.confirm",
        )

        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new StockTransferNotFound({
              tenantId: decoded.tenantId,
              transferId: decoded.transferId,
            }),
          )
        }
        if (result._tag === "unavailable") {
          return yield* Effect.fail(
            new StockUnavailable({
              tenantId: decoded.tenantId,
              warehouseId: result.warehouseId,
              itemId: result.itemId,
              requested: result.requested,
            }),
          )
        }
        return result.transfer
      }),
    completeTransfer: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CompleteStockTransferInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: InventoryCapabilities.stockTransferComplete,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select(transferSelection)
              .from(stockTransfers)
              .where(
                and(
                  eq(stockTransfers.tenantId, decoded.tenantId),
                  eq(stockTransfers.id, decoded.transferId),
                ),
              )
              .for("update")
            if (row === undefined) return { _tag: "not-found" as const }

            const lines = await tx.select(transferLineSelection)
              .from(stockTransferLines)
              .where(
                and(
                  eq(stockTransferLines.tenantId, decoded.tenantId),
                  eq(stockTransferLines.transferId, decoded.transferId),
                ),
              )
              .orderBy(stockTransferLines.itemId)
            const current = toStockTransfer(row, lines)
            if (row.status === "completed") return { _tag: "existing" as const, transfer: current }
            if (row.status !== "confirmed") {
              return { _tag: "invalid-state" as const, status: row.status }
            }

            const timestamp = now()
            for (const line of lines) {
              await tx.insert(stockBalances).values({
                tenantId: decoded.tenantId,
                warehouseId: row.destinationWarehouseId,
                itemId: line.itemId,
                onHand: line.quantity,
              }).onConflictDoUpdate({
                target: [stockBalances.tenantId, stockBalances.warehouseId, stockBalances.itemId],
                set: {
                  onHand: sql`${stockBalances.onHand} + ${line.quantity}`,
                  updatedAt: timestamp,
                },
              })
            }
            if (lines.length > 0) {
              await tx.insert(movements).values(
                lines.map((line) => ({
                  tenantId: decoded.tenantId,
                  warehouseId: row.destinationWarehouseId,
                  itemId: line.itemId,
                  quantity: line.quantity,
                  kind: "receipt" as const,
                  referenceId: row.id,
                })),
              )
            }
            const [completed] = await tx.update(stockTransfers)
              .set({ status: "completed", completedAt: timestamp, updatedAt: timestamp })
              .where(
                and(
                  eq(stockTransfers.tenantId, decoded.tenantId),
                  eq(stockTransfers.id, decoded.transferId),
                  eq(stockTransfers.status, "confirmed"),
                ),
              )
              .returning(transferSelection)
            return { _tag: "completed" as const, transfer: toStockTransfer(completed!, lines) }
          },
          "inventory.stock.transfer.complete",
        )

        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new StockTransferNotFound({
              tenantId: decoded.tenantId,
              transferId: decoded.transferId,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new StockTransferInvalidState({
              tenantId: decoded.tenantId,
              transferId: decoded.transferId,
              operation: "complete",
              status: result.status,
            }),
          )
        }
        return result.transfer
      }),
  } satisfies InventoryService
})

export const makeInventoryTestLayer = () =>
  Layer.effect(
    InventoryService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const messaging = yield* MessagingService
      const clock = yield* Clock.Clock
      const now = () => new Date(clock.currentTimeMillisUnsafe())
      const storedWarehouses = new Map<string, Warehouse>()
      const storedItems = new Map<string, Item>()
      const balances = new Map<string, { onHand: bigint; reserved: bigint }>()
      const storedTransfers = new Map<string, StockTransfer>()
      const storedReservations = new Map<string, StockReservation>()
      const reservationIdsByIdempotencyKey = new Map<string, string>()
      const correctionsByIdempotencyKey = new Map<string, StockCorrection>()
      let sequence = 1
      const nextId = () => `inventory-test-${sequence++}`
      const authorize = (principal: unknown, tenantId: string, capability: string) =>
        authorization.authorize({ principal, tenantId, capability })
      const service: InventoryService = {
        createWarehouse: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateWarehouseInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.warehouseCreate,
            )
            const name = decoded.name.trim()
            if (
              [...storedWarehouses.values()].some((value) =>
                value.tenantId === decoded.tenantId && value.name === name
              )
            ) {
              return yield* Effect.fail(
                new WarehouseAlreadyExists({ tenantId: decoded.tenantId, name }),
              )
            }
            const value = {
              id: nextId(),
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              primaryBranchId: decoded.primaryBranchId ?? null,
              name,
            }
            storedWarehouses.set(value.id, value)
            return value
          }),
        createItem: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateItemInput)(input)
            yield* authorize(decoded.principal, decoded.tenantId, InventoryCapabilities.itemCreate)
            const sku = decoded.sku.trim().toUpperCase()
            const unitOfMeasure = decoded.unitOfMeasure.trim().toUpperCase()
            if (
              [...storedItems.values()].some((value) =>
                value.tenantId === decoded.tenantId && value.sku === sku
              )
            ) {
              return yield* Effect.fail(new ItemAlreadyExists({ tenantId: decoded.tenantId, sku }))
            }
            const value = {
              id: nextId(),
              tenantId: decoded.tenantId,
              sku,
              name: decoded.name.trim(),
              unitOfMeasure,
            }
            storedItems.set(value.id, value)
            return value
          }),
        receiveStock: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ReceiveStockInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.stockReceive,
            )
            if (
              storedWarehouses.get(decoded.warehouseId)?.tenantId !== decoded.tenantId ||
              storedItems.get(decoded.itemId)?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(
                referenceFailure(decoded.tenantId, decoded.warehouseId, decoded.itemId),
              )
            }
            const key = `${decoded.tenantId}:${decoded.warehouseId}:${decoded.itemId}`
            const balance = balances.get(key) ?? { onHand: 0n, reserved: 0n }
            balance.onHand += BigInt(decoded.quantity)
            balances.set(key, balance)
            return {
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: decoded.itemId,
              onHand: String(balance.onHand),
              reserved: String(balance.reserved),
              unitOfMeasure: storedItems.get(decoded.itemId)!.unitOfMeasure,
            }
          }),
        adjustStock: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(AdjustStockInput)(input)
            yield* authorize(decoded.principal, decoded.tenantId, InventoryCapabilities.stockAdjust)
            const unitOfMeasure = decoded.unitOfMeasure.trim().toUpperCase()
            const reason = decoded.reason.trim()
            const commandId = decoded.commandId.trim()
            const correlationId = decoded.correlationId.trim()
            const causationId = decoded.causationId?.trim() ?? null
            const idempotencyKey = decoded.idempotencyKey.trim()
            const key = `${decoded.tenantId}:${idempotencyKey}`
            const existing = correctionsByIdempotencyKey.get(key)
            if (existing !== undefined) {
              if (
                existing.warehouseId !== decoded.warehouseId ||
                existing.itemId !== decoded.itemId ||
                existing.adjustment !== decoded.adjustment ||
                existing.unitOfMeasure !== unitOfMeasure ||
                existing.reason !== reason
              ) {
                return yield* Effect.fail(
                  new StockCorrectionIdempotencyConflict({
                    tenantId: decoded.tenantId,
                    idempotencyKey,
                  }),
                )
              }
              return existing
            }
            const item = storedItems.get(decoded.itemId)
            if (
              storedWarehouses.get(decoded.warehouseId)?.tenantId !== decoded.tenantId ||
              item?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(
                referenceFailure(decoded.tenantId, decoded.warehouseId, decoded.itemId),
              )
            }
            if (item.unitOfMeasure !== unitOfMeasure) {
              return yield* Effect.fail(
                new InventoryUnitOfMeasureMismatch({
                  tenantId: decoded.tenantId,
                  itemId: decoded.itemId,
                  expected: item.unitOfMeasure,
                  actual: unitOfMeasure,
                }),
              )
            }
            const balanceKey = `${decoded.tenantId}:${decoded.warehouseId}:${decoded.itemId}`
            const balance = balances.get(balanceKey) ?? { onHand: 0n, reserved: 0n }
            const adjustment = BigInt(decoded.adjustment)
            if (balance.onHand + adjustment < balance.reserved) {
              return yield* Effect.fail(
                new StockUnavailable({
                  tenantId: decoded.tenantId,
                  warehouseId: decoded.warehouseId,
                  itemId: decoded.itemId,
                  requested: decoded.adjustment,
                }),
              )
            }
            const correction: StockCorrection = {
              id: crypto.randomUUID(),
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: decoded.itemId,
              adjustment: decoded.adjustment,
              unitOfMeasure,
              reason,
              idempotencyKey,
            }
            yield* messaging.append({
              eventId: correction.id,
              eventType: "inventory.stock.corrected",
              eventVersion: 1,
              tenantId: decoded.tenantId,
              aggregateType: "stock_correction",
              aggregateId: correction.id,
              commandId,
              correlationId,
              causationId,
              idempotencyKey,
              actorPrincipalId: decoded.principal.userAccountId,
              occurredAt: now().toISOString(),
              payload: {
                correctionId: correction.id,
                warehouseId: correction.warehouseId,
                itemId: correction.itemId,
              },
            })
            balance.onHand += adjustment
            balances.set(balanceKey, balance)
            correctionsByIdempotencyKey.set(key, correction)
            return correction
          }),
        reserveStock: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ReserveStockInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.stockReserve,
            )
            const idempotencyKey = decoded.idempotencyKey === undefined
              ? undefined
              : `${decoded.tenantId}:${decoded.idempotencyKey}`
            const existing = idempotencyKey === undefined
              ? undefined
              : storedReservations.get(reservationIdsByIdempotencyKey.get(idempotencyKey) ?? "")
            if (existing !== undefined) {
              if (
                existing.warehouseId !== decoded.warehouseId ||
                existing.itemId !== decoded.itemId ||
                existing.quantity !== decoded.quantity
              ) {
                return yield* Effect.fail(
                  new StockReservationIdempotencyConflict({
                    tenantId: decoded.tenantId,
                    idempotencyKey: decoded.idempotencyKey!,
                  }),
                )
              }
              return existing
            }
            const key = `${decoded.tenantId}:${decoded.warehouseId}:${decoded.itemId}`
            const balance = balances.get(key)
            const quantity = BigInt(decoded.quantity)
            if (balance === undefined || balance.onHand - balance.reserved < quantity) {
              return yield* Effect.fail(
                new StockUnavailable({
                  tenantId: decoded.tenantId,
                  warehouseId: decoded.warehouseId,
                  itemId: decoded.itemId,
                  requested: decoded.quantity,
                }),
              )
            }
            balance.reserved += quantity
            const reservation: StockReservation = {
              id: nextId(),
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: decoded.itemId,
              quantity: decoded.quantity,
              idempotencyKey: decoded.idempotencyKey ?? null,
              status: "active",
            }
            storedReservations.set(reservation.id, reservation)
            if (idempotencyKey !== undefined) {
              reservationIdsByIdempotencyKey.set(idempotencyKey, reservation.id)
            }
            return reservation
          }),
        releaseReservation: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ReleaseReservationInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.stockRelease,
            )
            const reservation = storedReservations.get(decoded.reservationId)
            if (reservation === undefined || reservation.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new StockReservationNotFound({
                  tenantId: decoded.tenantId,
                  reservationId: decoded.reservationId,
                }),
              )
            }
            if (reservation.status === "released") return reservation
            if (reservation.status !== "active") {
              return yield* Effect.fail(
                new StockReservationInvalidState({
                  tenantId: decoded.tenantId,
                  reservationId: decoded.reservationId,
                  operation: "release",
                  status: reservation.status,
                }),
              )
            }
            const balance = balances.get(
              `${decoded.tenantId}:${reservation.warehouseId}:${reservation.itemId}`,
            )!
            balance.reserved -= BigInt(reservation.quantity)
            const released = { ...reservation, status: "released" as const }
            storedReservations.set(released.id, released)
            return released
          }),
        fulfillReservation: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(FulfillReservationInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.stockFulfill,
            )
            const reservation = storedReservations.get(decoded.reservationId)
            if (reservation === undefined || reservation.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new StockReservationNotFound({
                  tenantId: decoded.tenantId,
                  reservationId: decoded.reservationId,
                }),
              )
            }
            if (reservation.status === "fulfilled") return reservation
            if (reservation.status !== "active") {
              return yield* Effect.fail(
                new StockReservationInvalidState({
                  tenantId: decoded.tenantId,
                  reservationId: decoded.reservationId,
                  operation: "fulfill",
                  status: reservation.status,
                }),
              )
            }
            const balance = balances.get(
              `${decoded.tenantId}:${reservation.warehouseId}:${reservation.itemId}`,
            )!
            const quantity = BigInt(reservation.quantity)
            balance.onHand -= quantity
            balance.reserved -= quantity
            const fulfilled = { ...reservation, status: "fulfilled" as const }
            storedReservations.set(fulfilled.id, fulfilled)
            return fulfilled
          }),
        createTransfer: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateStockTransferInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.stockTransferCreate,
            )
            if (decoded.sourceWarehouseId === decoded.destinationWarehouseId) {
              return yield* Effect.fail(
                new StockTransferSameWarehouse({
                  tenantId: decoded.tenantId,
                  warehouseId: decoded.sourceWarehouseId,
                }),
              )
            }
            const itemIds = new Set<string>()
            for (const line of decoded.lines) {
              if (itemIds.has(line.itemId)) {
                return yield* Effect.fail(
                  new StockTransferDuplicateItem({
                    tenantId: decoded.tenantId,
                    itemId: line.itemId,
                  }),
                )
              }
              itemIds.add(line.itemId)
            }
            if (
              storedWarehouses.get(decoded.sourceWarehouseId)?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(
                new StockTransferWarehouseNotFound({
                  tenantId: decoded.tenantId,
                  warehouseId: decoded.sourceWarehouseId,
                }),
              )
            }
            if (
              storedWarehouses.get(decoded.destinationWarehouseId)?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(
                new StockTransferWarehouseNotFound({
                  tenantId: decoded.tenantId,
                  warehouseId: decoded.destinationWarehouseId,
                }),
              )
            }
            const sourceWarehouse = storedWarehouses.get(decoded.sourceWarehouseId)!
            const destinationWarehouse = storedWarehouses.get(decoded.destinationWarehouseId)!
            if (destinationWarehouse.legalEntityId !== sourceWarehouse.legalEntityId) {
              return yield* Effect.fail(
                new StockTransferDifferentLegalEntity({
                  tenantId: decoded.tenantId,
                  sourceWarehouseId: decoded.sourceWarehouseId,
                  destinationWarehouseId: decoded.destinationWarehouseId,
                }),
              )
            }
            const missingItem = decoded.lines.find((line) =>
              storedItems.get(line.itemId)?.tenantId !== decoded.tenantId
            )
            if (missingItem !== undefined) {
              return yield* Effect.fail(
                new StockTransferItemNotFound({
                  tenantId: decoded.tenantId,
                  itemId: missingItem.itemId,
                }),
              )
            }
            const transfer: StockTransfer = {
              id: nextId(),
              tenantId: decoded.tenantId,
              legalEntityId: sourceWarehouse.legalEntityId,
              sourceWarehouseId: decoded.sourceWarehouseId,
              destinationWarehouseId: decoded.destinationWarehouseId,
              status: "draft",
              confirmedAt: null,
              completedAt: null,
              lines: decoded.lines,
            }
            storedTransfers.set(transfer.id, transfer)
            return transfer
          }),
        confirmTransfer: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ConfirmStockTransferInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.stockTransferConfirm,
            )
            const transfer = storedTransfers.get(decoded.transferId)
            if (transfer === undefined || transfer.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new StockTransferNotFound({
                  tenantId: decoded.tenantId,
                  transferId: decoded.transferId,
                }),
              )
            }
            if (transfer.status !== "draft") return transfer
            for (const line of transfer.lines) {
              const balance = balances.get(
                `${decoded.tenantId}:${transfer.sourceWarehouseId}:${line.itemId}`,
              )
              if (
                balance === undefined ||
                balance.onHand - balance.reserved < BigInt(line.quantity)
              ) {
                return yield* Effect.fail(
                  new StockUnavailable({
                    tenantId: decoded.tenantId,
                    warehouseId: transfer.sourceWarehouseId,
                    itemId: line.itemId,
                    requested: line.quantity,
                  }),
                )
              }
            }
            for (const line of transfer.lines) {
              const balance = balances.get(
                `${decoded.tenantId}:${transfer.sourceWarehouseId}:${line.itemId}`,
              )!
              balance.onHand -= BigInt(line.quantity)
            }
            const confirmed: StockTransfer = {
              ...transfer,
              status: "confirmed",
              confirmedAt: now().toISOString(),
            }
            storedTransfers.set(confirmed.id, confirmed)
            return confirmed
          }),
        completeTransfer: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CompleteStockTransferInput)(input)
            yield* authorize(
              decoded.principal,
              decoded.tenantId,
              InventoryCapabilities.stockTransferComplete,
            )
            const transfer = storedTransfers.get(decoded.transferId)
            if (transfer === undefined || transfer.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new StockTransferNotFound({
                  tenantId: decoded.tenantId,
                  transferId: decoded.transferId,
                }),
              )
            }
            if (transfer.status === "completed") return transfer
            if (transfer.status !== "confirmed") {
              return yield* Effect.fail(
                new StockTransferInvalidState({
                  tenantId: decoded.tenantId,
                  transferId: decoded.transferId,
                  operation: "complete",
                  status: transfer.status,
                }),
              )
            }
            for (const line of transfer.lines) {
              const key = `${decoded.tenantId}:${transfer.destinationWarehouseId}:${line.itemId}`
              const balance = balances.get(key) ?? { onHand: 0n, reserved: 0n }
              balance.onHand += BigInt(line.quantity)
              balances.set(key, balance)
            }
            const completed: StockTransfer = {
              ...transfer,
              status: "completed",
              completedAt: now().toISOString(),
            }
            storedTransfers.set(completed.id, completed)
            return completed
          }),
      }
      return service
    }),
  )
