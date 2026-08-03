import { and, eq, gte, inArray, sql } from "drizzle-orm"
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
import { AuthorizationDenied, type AuthorizationServiceShape } from "../../authorization/mod.ts"
import { DatabaseFailure, type DatabaseService, isDatabaseConstraint } from "../../kernel/mod.ts"

const Quantity = Schema.String.check(Schema.isPattern(/^[1-9]\d*$/))

export const Warehouse = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.String,
})
export const Item = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  sku: Schema.String,
  name: Schema.String,
})
export const StockBalance = Schema.Struct({
  tenantId: Schema.String,
  warehouseId: Schema.String,
  itemId: Schema.String,
  onHand: Schema.String,
  reserved: Schema.String,
})
export const StockReservation = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  warehouseId: Schema.String,
  itemId: Schema.String,
  quantity: Quantity,
  status: Schema.Literal("active"),
})
export const StockTransferStatus = Schema.Literals(["draft", "confirmed", "completed"])
export const StockTransferLine = Schema.Struct({
  itemId: Schema.String,
  quantity: Quantity,
})
export const StockTransfer = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
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
export type StockReservation = Schema.Schema.Type<typeof StockReservation>
export type StockTransferStatus = Schema.Schema.Type<typeof StockTransferStatus>
export type StockTransferLine = Schema.Schema.Type<typeof StockTransferLine>
export type StockTransfer = Schema.Schema.Type<typeof StockTransfer>

const ScopedInput = { principal: Principal, tenantId: Schema.String }
export const CreateWarehouseInput = Schema.Struct({ ...ScopedInput, name: Schema.String })
export const CreateItemInput = Schema.Struct({
  ...ScopedInput,
  sku: Schema.String,
  name: Schema.String,
})
export const ReceiveStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Schema.String,
  itemId: Schema.String,
  quantity: Quantity,
})
export const ReserveStockInput = ReceiveStockInput
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
  ) => Effect.Effect<Warehouse, WarehouseAlreadyExists | CommonFailure>
  readonly createItem: (input: unknown) => Effect.Effect<Item, ItemAlreadyExists | CommonFailure>
  readonly receiveStock: (
    input: unknown,
  ) => Effect.Effect<StockBalance, InventoryReferenceNotFound | CommonFailure>
  readonly reserveStock: (
    input: unknown,
  ) => Effect.Effect<StockReservation, StockUnavailable | CommonFailure>
  readonly createTransfer: (
    input: unknown,
  ) => Effect.Effect<
    StockTransfer,
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

const transferSelection = {
  id: stockTransfers.id,
  tenantId: stockTransfers.tenantId,
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

export const makeInventoryService = (
  database: DatabaseService,
  authorization: AuthorizationServiceShape,
): InventoryService => ({
  createWarehouse: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateWarehouseInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: "inventory.warehouse.create",
      })
      const name = decoded.name.trim()
      const rows = yield* database.query(
        (db) =>
          db.insert(warehouses).values({ tenantId: decoded.tenantId, name }).returning({
            id: warehouses.id,
            tenantId: warehouses.tenantId,
            name: warehouses.name,
          }),
        "inventory.warehouse.create",
      ).pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "warehouses_tenant_name_key")
            ? new WarehouseAlreadyExists({ tenantId: decoded.tenantId, name })
            : error
        ),
      )
      return rows[0]!
    }),
  createItem: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateItemInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: "inventory.item.create",
      })
      const sku = decoded.sku.trim().toUpperCase()
      const rows = yield* database.query(
        (db) =>
          db.insert(items).values({ tenantId: decoded.tenantId, sku, name: decoded.name.trim() })
            .returning({
              id: items.id,
              tenantId: items.tenantId,
              sku: items.sku,
              name: items.name,
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
        capability: "inventory.stock.receive",
      })
      const balance = yield* database.transaction(
        async (tx) => {
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
                updatedAt: new Date(),
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
          return rows[0]!
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
      return balance
    }),
  reserveStock: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ReserveStockInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: "inventory.stock.reserve",
      })
      const reservation = yield* database.transaction(
        async (tx) => {
          const updated = await tx.update(stockBalances)
            .set({
              reserved: sql`${stockBalances.reserved} + ${decoded.quantity}`,
              updatedAt: new Date(),
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
          if (updated[0] === undefined) return undefined

          const rows = await tx.insert(reservations).values({
            tenantId: decoded.tenantId,
            warehouseId: decoded.warehouseId,
            itemId: decoded.itemId,
            quantity: decoded.quantity,
          }).returning({
            id: reservations.id,
            tenantId: reservations.tenantId,
            warehouseId: reservations.warehouseId,
            itemId: reservations.itemId,
            quantity: reservations.quantity,
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
          return { ...row, status: "active" as const }
        },
        "inventory.stock.reserve",
      )
      if (reservation === undefined) {
        return yield* Effect.fail(
          new StockUnavailable({
            tenantId: decoded.tenantId,
            warehouseId: decoded.warehouseId,
            itemId: decoded.itemId,
            requested: decoded.quantity,
          }),
        )
      }
      return reservation
    }),
  createTransfer: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateStockTransferInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: "inventory.stock.transfer.create",
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
          const warehouseRows = await tx.select({ id: warehouses.id })
            .from(warehouses)
            .where(
              and(
                eq(warehouses.tenantId, decoded.tenantId),
                inArray(warehouses.id, [decoded.sourceWarehouseId, decoded.destinationWarehouseId]),
              ),
            )
            .for("update")
          const warehouseIds = new Set(warehouseRows.map((row) => row.id))
          const missingWarehouseId = [decoded.sourceWarehouseId, decoded.destinationWarehouseId]
            .find((warehouseId) => !warehouseIds.has(warehouseId))
          if (missingWarehouseId !== undefined) {
            return { _tag: "warehouse-not-found" as const, warehouseId: missingWarehouseId }
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
        capability: "inventory.stock.transfer.confirm",
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

          const now = new Date()
          for (const line of lines) {
            await tx.update(stockBalances)
              .set({
                onHand: sql`${stockBalances.onHand} - ${line.quantity}`,
                updatedAt: now,
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
            .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
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
          new StockTransferNotFound({ tenantId: decoded.tenantId, transferId: decoded.transferId }),
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
        capability: "inventory.stock.transfer.complete",
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

          const now = new Date()
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
                updatedAt: now,
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
            .set({ status: "completed", completedAt: now, updatedAt: now })
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
          new StockTransferNotFound({ tenantId: decoded.tenantId, transferId: decoded.transferId }),
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
})

export const makeInventoryTestLayer = (authorization: AuthorizationServiceShape) => {
  const storedWarehouses = new Map<string, Warehouse>()
  const storedItems = new Map<string, Item>()
  const balances = new Map<string, { onHand: bigint; reserved: bigint }>()
  const storedTransfers = new Map<string, StockTransfer>()
  const authorize = (principal: unknown, tenantId: string, capability: string) =>
    authorization.authorize({ principal, tenantId, capability })
  const service: InventoryService = {
    createWarehouse: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateWarehouseInput)(input)
        yield* authorize(decoded.principal, decoded.tenantId, "inventory.warehouse.create")
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
        const value = { id: crypto.randomUUID(), tenantId: decoded.tenantId, name }
        storedWarehouses.set(value.id, value)
        return value
      }),
    createItem: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateItemInput)(input)
        yield* authorize(decoded.principal, decoded.tenantId, "inventory.item.create")
        const sku = decoded.sku.trim().toUpperCase()
        if (
          [...storedItems.values()].some((value) =>
            value.tenantId === decoded.tenantId && value.sku === sku
          )
        ) {
          return yield* Effect.fail(new ItemAlreadyExists({ tenantId: decoded.tenantId, sku }))
        }
        const value = {
          id: crypto.randomUUID(),
          tenantId: decoded.tenantId,
          sku,
          name: decoded.name.trim(),
        }
        storedItems.set(value.id, value)
        return value
      }),
    receiveStock: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ReceiveStockInput)(input)
        yield* authorize(decoded.principal, decoded.tenantId, "inventory.stock.receive")
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
        }
      }),
    reserveStock: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ReserveStockInput)(input)
        yield* authorize(decoded.principal, decoded.tenantId, "inventory.stock.reserve")
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
        return {
          id: crypto.randomUUID(),
          tenantId: decoded.tenantId,
          warehouseId: decoded.warehouseId,
          itemId: decoded.itemId,
          quantity: decoded.quantity,
          status: "active" as const,
        }
      }),
    createTransfer: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateStockTransferInput)(input)
        yield* authorize(
          decoded.principal,
          decoded.tenantId,
          "inventory.stock.transfer.create",
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
              new StockTransferDuplicateItem({ tenantId: decoded.tenantId, itemId: line.itemId }),
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
          id: crypto.randomUUID(),
          tenantId: decoded.tenantId,
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
          "inventory.stock.transfer.confirm",
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
          confirmedAt: new Date().toISOString(),
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
          "inventory.stock.transfer.complete",
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
          completedAt: new Date().toISOString(),
        }
        storedTransfers.set(completed.id, completed)
        return completed
      }),
  }
  return Layer.succeed(InventoryService, service)
}
