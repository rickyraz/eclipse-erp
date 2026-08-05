import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { branches, legalEntities } from "./party.ts"
import { createdAt, id, updatedAt } from "./common.ts"

export const inventorySchema = pgSchema("inventory")
export const reservationStatus = inventorySchema.enum(
  "reservation_status",
  ["active", "released", "fulfilled"],
)
export const movementKind = inventorySchema.enum(
  "movement_kind",
  ["receipt", "issue", "reservation", "release"],
)
export const transferStatus = inventorySchema.enum(
  "transfer_status",
  ["draft", "confirmed", "completed"],
)

export const warehouses = inventorySchema.table("warehouses", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  primaryBranchId: uuid("primary_branch_id"),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("warehouses_tenant_id_id_key").on(table.tenantId, table.id),
  unique("warehouses_tenant_legal_entity_id_key").on(
    table.tenantId,
    table.legalEntityId,
    table.id,
  ),
  unique("warehouses_tenant_name_key").on(table.tenantId, table.name),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "warehouses_tenant_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId],
    foreignColumns: [legalEntities.tenantId, legalEntities.id],
    name: "warehouses_tenant_legal_entity_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId, table.primaryBranchId],
    foreignColumns: [branches.tenantId, branches.legalEntityId, branches.id],
    name: "warehouses_tenant_legal_entity_branch_fkey",
  }),
])

export const items = inventorySchema.table("items", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("items_tenant_id_id_key").on(table.tenantId, table.id),
  unique("items_tenant_sku_key").on(table.tenantId, table.sku),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "items_tenant_id_fkey",
  }).onDelete("cascade"),
])

export const stockBalances = inventorySchema.table("stock_balances", {
  tenantId: uuid("tenant_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  itemId: uuid("item_id").notNull(),
  onHand: bigint("on_hand", { mode: "string" }).notNull().default("0"),
  reserved: bigint("reserved", { mode: "string" }).notNull().default("0"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.warehouseId, table.itemId] }),
  foreignKey({
    columns: [table.tenantId, table.warehouseId],
    foreignColumns: [warehouses.tenantId, warehouses.id],
    name: "stock_balances_warehouse_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.itemId],
    foreignColumns: [items.tenantId, items.id],
    name: "stock_balances_item_fkey",
  }),
  check("stock_balances_on_hand_check", sql`${table.onHand} >= 0`),
  check(
    "stock_balances_reserved_check",
    sql`${table.reserved} >= 0 and ${table.reserved} <= ${table.onHand}`,
  ),
])

export const stockTransfers = inventorySchema.table("stock_transfers", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  sourceWarehouseId: uuid("source_warehouse_id").notNull(),
  destinationWarehouseId: uuid("destination_warehouse_id").notNull(),
  status: transferStatus("status").notNull().default("draft"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("stock_transfers_tenant_id_id_key").on(table.tenantId, table.id),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId, table.sourceWarehouseId],
    foreignColumns: [warehouses.tenantId, warehouses.legalEntityId, warehouses.id],
    name: "stock_transfers_source_warehouse_scope_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId, table.destinationWarehouseId],
    foreignColumns: [warehouses.tenantId, warehouses.legalEntityId, warehouses.id],
    name: "stock_transfers_destination_warehouse_scope_fkey",
  }),
  check(
    "stock_transfers_distinct_warehouses_check",
    sql`${table.sourceWarehouseId} <> ${table.destinationWarehouseId}`,
  ),
  check(
    "stock_transfers_state_dates_check",
    sql`(${table.status} = 'draft' and ${table.confirmedAt} is null and ${table.completedAt} is null) or
      (${table.status} = 'confirmed' and ${table.confirmedAt} is not null and ${table.completedAt} is null) or
      (${table.status} = 'completed' and ${table.confirmedAt} is not null and ${table.completedAt} is not null)`,
  ),
])

export const stockTransferLines = inventorySchema.table("stock_transfer_lines", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  transferId: uuid("transfer_id").notNull(),
  itemId: uuid("item_id").notNull(),
  quantity: bigint("quantity", { mode: "string" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("stock_transfer_lines_tenant_transfer_item_key").on(
    table.tenantId,
    table.transferId,
    table.itemId,
  ),
  foreignKey({
    columns: [table.tenantId, table.transferId],
    foreignColumns: [stockTransfers.tenantId, stockTransfers.id],
    name: "stock_transfer_lines_transfer_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.itemId],
    foreignColumns: [items.tenantId, items.id],
    name: "stock_transfer_lines_item_fkey",
  }),
  check("stock_transfer_lines_quantity_check", sql`${table.quantity} > 0`),
])

export const reservations = inventorySchema.table("reservations", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  itemId: uuid("item_id").notNull(),
  quantity: bigint("quantity", { mode: "string" }).notNull(),
  status: reservationStatus("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    columns: [table.tenantId, table.warehouseId, table.itemId],
    foreignColumns: [stockBalances.tenantId, stockBalances.warehouseId, stockBalances.itemId],
    name: "reservations_balance_fkey",
  }),
  check("reservations_quantity_check", sql`${table.quantity} > 0`),
])

export const movements = inventorySchema.table("movements", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  itemId: uuid("item_id").notNull(),
  quantity: bigint("quantity", { mode: "string" }).notNull(),
  kind: movementKind("kind").notNull(),
  referenceId: uuid("reference_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    columns: [table.tenantId, table.warehouseId],
    foreignColumns: [warehouses.tenantId, warehouses.id],
    name: "movements_warehouse_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.itemId],
    foreignColumns: [items.tenantId, items.id],
    name: "movements_item_fkey",
  }),
  check("movements_quantity_check", sql`${table.quantity} <> 0`),
])
