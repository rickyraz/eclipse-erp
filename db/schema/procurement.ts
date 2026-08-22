import { sql } from "drizzle-orm"
import { bigint, check, foreignKey, index, pgSchema, unique, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, money, updatedAt } from "./common.ts"
import { partyRelationships } from "./party.ts"

export const procurementSchema = pgSchema("procurement")
export const purchaseOrderStatus = procurementSchema.enum("purchase_order_status", ["draft"])

export const supplierAccounts = procurementSchema.table("supplier_accounts", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  supplierRelationshipId: uuid("supplier_relationship_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("supplier_accounts_tenant_id_id_key").on(table.tenantId, table.id),
  unique("supplier_accounts_tenant_supplier_relationship_key").on(
    table.tenantId,
    table.supplierRelationshipId,
  ),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "supplier_accounts_tenant_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.supplierRelationshipId],
    foreignColumns: [partyRelationships.tenantId, partyRelationships.id],
    name: "supplier_accounts_tenant_supplier_relationship_fkey",
  }),
])

export const purchaseOrders = procurementSchema.table("purchase_orders", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  supplierAccountId: uuid("supplier_account_id").notNull(),
  status: purchaseOrderStatus("status").notNull().default("draft"),
  total: money("total"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("purchase_orders_tenant_id_id_key").on(table.tenantId, table.id),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "purchase_orders_tenant_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.supplierAccountId],
    foreignColumns: [supplierAccounts.tenantId, supplierAccounts.id],
    name: "purchase_orders_tenant_supplier_account_fkey",
  }),
  check("purchase_orders_total_check", sql`${table.total} >= 0`),
])

export const purchaseOrderLines = procurementSchema.table("purchase_order_lines", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  itemId: uuid("item_id").notNull(),
  quantity: bigint("quantity", { mode: "string" }).notNull(),
  unitPrice: money("unit_price"),
  createdAt: createdAt(),
}, (table) => [
  index("purchase_order_lines_tenant_order_idx").on(table.tenantId, table.purchaseOrderId),
  foreignKey({
    columns: [table.tenantId, table.purchaseOrderId],
    foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    name: "purchase_order_lines_tenant_order_fkey",
  }).onDelete("cascade"),
  check("purchase_order_lines_quantity_check", sql`${table.quantity} > 0`),
  check("purchase_order_lines_unit_price_check", sql`${table.unitPrice} >= 0`),
])
