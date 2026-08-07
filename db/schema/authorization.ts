import { sql } from "drizzle-orm"
import { check, foreignKey, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, updatedAt } from "./common.ts"
import { userAccounts } from "./identity.ts"

export const authorizationSchema = pgSchema("authorization")

export const tenantMemberships = authorizationSchema.table("tenant_memberships", {
  userAccountId: uuid("user_account_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.userAccountId, table.tenantId] }),
  check("tenant_memberships_status_check", sql`${table.status} in ('active', 'suspended')`),
  foreignKey({
    columns: [table.userAccountId],
    foreignColumns: [userAccounts.id],
    name: "tenant_memberships_user_account_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "tenant_memberships_tenant_id_fkey",
  }).onDelete("cascade"),
])

export const memberships = authorizationSchema.table("memberships", {
  userAccountId: uuid("user_account_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  capability: text("capability").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.userAccountId, table.tenantId, table.capability] }),
  foreignKey({
    columns: [table.userAccountId],
    foreignColumns: [userAccounts.id],
    name: "memberships_user_account_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "memberships_tenant_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.userAccountId, table.tenantId],
    foreignColumns: [tenantMemberships.userAccountId, tenantMemberships.tenantId],
    name: "memberships_tenant_membership_fkey",
  }).onDelete("cascade"),
])
