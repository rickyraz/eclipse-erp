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

export const salesSchema = pgSchema("sales")
export const quotationStatus = salesSchema.enum(
  "quotation_status",
  ["draft", "sent", "accepted", "rejected", "expired"],
)
export const orderStatus = salesSchema.enum(
  "order_status",
  ["draft", "confirmed", "cancelled"],
)

export const customers = salesSchema.table("customers", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("customers_tenant_id_id_key").on(table.tenantId, table.id),
  unique("customers_tenant_email_key").on(table.tenantId, table.email),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "customers_tenant_id_fkey",
  }).onDelete("cascade"),
])

export const quotations = salesSchema.table("quotations", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  status: quotationStatus("status").notNull().default("draft"),
  total: money("total"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("quotations_tenant_id_id_key").on(table.tenantId, table.id),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "quotations_tenant_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.customerId],
    foreignColumns: [customers.tenantId, customers.id],
    name: "quotations_tenant_customer_fkey",
  }),
  check("quotations_total_check", sql`${table.total} >= 0`),
])

export const orders = salesSchema.table("orders", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  quotationId: uuid("quotation_id"),
  status: orderStatus("status").notNull().default("draft"),
  confirmationIdempotencyKey: text("confirmation_idempotency_key"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  total: money("total"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("orders_tenant_id_id_key").on(table.tenantId, table.id),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "orders_tenant_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.customerId],
    foreignColumns: [customers.tenantId, customers.id],
    name: "orders_tenant_customer_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.quotationId],
    foreignColumns: [quotations.tenantId, quotations.id],
    name: "orders_tenant_quotation_fkey",
  }),
  unique("orders_tenant_confirmation_idempotency_key").on(
    table.tenantId,
    table.confirmationIdempotencyKey,
  ),
  check("orders_total_check", sql`${table.total} >= 0`),
  check(
    "orders_confirmation_state_check",
    sql`(${table.status} = 'draft' and ${table.confirmedAt} is null) or
      (${table.status} = 'confirmed' and ${table.confirmedAt} is not null) or
      (${table.status} = 'cancelled')`,
  ),
  check(
    "orders_confirmation_metadata_check",
    sql`(${table.status} = 'draft' and ${table.confirmationIdempotencyKey} is null) or
      (${table.status} in ('confirmed', 'cancelled') and
        ${table.confirmationIdempotencyKey} is not null and
        ${table.confirmationIdempotencyKey} ~ '[^[:space:]]' and
        ${table.confirmedAt} is not null)`,
  ),
])

export const orderLines = salesSchema.table("order_lines", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  orderId: uuid("order_id").notNull(),
  itemId: uuid("item_id").notNull(),
  quantity: bigint("quantity", { mode: "string" }).notNull(),
  unitPrice: money("unit_price").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("order_lines_tenant_order_idx").on(table.tenantId, table.orderId),
  foreignKey({
    columns: [table.tenantId, table.orderId],
    foreignColumns: [orders.tenantId, orders.id],
    name: "order_lines_tenant_order_fkey",
  }).onDelete("cascade"),
  check("order_lines_quantity_check", sql`${table.quantity} > 0`),
  check("order_lines_unit_price_check", sql`${table.unitPrice} >= 0`),
])
