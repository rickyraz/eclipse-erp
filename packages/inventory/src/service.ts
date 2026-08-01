import { and, eq, gte, sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  items,
  movements,
  reservations,
  stockBalances,
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

export type Warehouse = Schema.Schema.Type<typeof Warehouse>
export type Item = Schema.Schema.Type<typeof Item>
export type StockBalance = Schema.Schema.Type<typeof StockBalance>
export type StockReservation = Schema.Schema.Type<typeof StockReservation>

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
}

export const InventoryService = Context.Service<InventoryService>("EclipseERP/InventoryService")

const referenceFailure = (tenantId: string, warehouseId: string, itemId: string) =>
  new InventoryReferenceNotFound({ tenantId, warehouseId, itemId })

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
})

export const makeInventoryTestLayer = (authorization: AuthorizationServiceShape) => {
  const storedWarehouses = new Map<string, Warehouse>()
  const storedItems = new Map<string, Item>()
  const balances = new Map<string, { onHand: bigint; reserved: bigint }>()
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
  }
  return Layer.succeed(InventoryService, service)
}
