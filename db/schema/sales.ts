import { sql } from "drizzle-orm"
import { check, foreignKey, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core"

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
  total: money("total"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
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
  check("orders_total_check", sql`${table.total} >= 0`),
])
