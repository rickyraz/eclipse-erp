import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  index,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, money, updatedAt } from "./common.ts"
import { partyRelationships } from "./party.ts"

export const procurementSchema = pgSchema("procurement")
export const purchaseOrderStatus = procurementSchema.enum("purchase_order_status", [
  "draft",
  "confirmed",
  "cancelled",
])

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
  confirmationIdempotencyKey: text("confirmation_idempotency_key"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
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
  unique("purchase_orders_tenant_confirmation_idempotency_key").on(
    table.tenantId,
    table.confirmationIdempotencyKey,
  ),
  check("purchase_orders_total_check", sql`${table.total} >= 0`),
  check(
    "purchase_orders_confirmation_metadata_check",
    sql`(${table.status} = 'draft' and
        ${table.confirmationIdempotencyKey} is null and ${table.confirmedAt} is null) or
      (${table.status} in ('confirmed', 'cancelled') and
        ${table.confirmationIdempotencyKey} is not null and
        ${table.confirmationIdempotencyKey} ~ '[^[:space:]]' and
        ${table.confirmedAt} is not null)`,
  ),
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
  unique("purchase_order_lines_tenant_order_id_key").on(
    table.tenantId,
    table.purchaseOrderId,
    table.id,
  ),
  foreignKey({
    columns: [table.tenantId, table.purchaseOrderId],
    foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    name: "purchase_order_lines_tenant_order_fkey",
  }).onDelete("cascade"),
  check("purchase_order_lines_quantity_check", sql`${table.quantity} > 0`),
  check("purchase_order_lines_unit_price_check", sql`${table.unitPrice} >= 0`),
])

export const purchaseReceipts = procurementSchema.table("purchase_receipts", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("purchase_receipts_tenant_id_id_key").on(table.tenantId, table.id),
  unique("purchase_receipts_tenant_idempotency_key").on(table.tenantId, table.idempotencyKey),
  index("purchase_receipts_tenant_order_idx").on(table.tenantId, table.purchaseOrderId),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "purchase_receipts_tenant_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.purchaseOrderId],
    foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    name: "purchase_receipts_tenant_purchase_order_fkey",
  }),
  check(
    "purchase_receipts_idempotency_key_check",
    sql`${table.idempotencyKey} ~ '[^[:space:]]'`,
  ),
])

export const purchaseReceiptLines = procurementSchema.table("purchase_receipt_lines", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  receiptId: uuid("receipt_id").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull(),
  itemId: uuid("item_id").notNull(),
  quantity: bigint("quantity", { mode: "string" }).notNull(),
  unitOfMeasure: text("unit_of_measure").notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique("purchase_receipt_lines_tenant_id_id_key").on(table.tenantId, table.id),
  unique("purchase_receipt_lines_tenant_receipt_line_key").on(
    table.tenantId,
    table.receiptId,
    table.purchaseOrderLineId,
  ),
  index("purchase_receipt_lines_tenant_order_line_idx").on(
    table.tenantId,
    table.purchaseOrderId,
    table.purchaseOrderLineId,
  ),
  foreignKey({
    columns: [table.tenantId, table.receiptId],
    foreignColumns: [purchaseReceipts.tenantId, purchaseReceipts.id],
    name: "purchase_receipt_lines_tenant_receipt_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.purchaseOrderId, table.purchaseOrderLineId],
    foreignColumns: [
      purchaseOrderLines.tenantId,
      purchaseOrderLines.purchaseOrderId,
      purchaseOrderLines.id,
    ],
    name: "purchase_receipt_lines_tenant_order_line_fkey",
  }),
  check("purchase_receipt_lines_quantity_check", sql`${table.quantity} > 0`),
  check(
    "purchase_receipt_lines_unit_of_measure_check",
    sql`${table.unitOfMeasure} <> '' and ${table.unitOfMeasure} = upper(trim(${table.unitOfMeasure}))`,
  ),
])
