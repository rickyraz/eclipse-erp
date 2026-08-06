import { foreignKey, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, updatedAt } from "./common.ts"
import { userAccounts } from "./identity.ts"

export const authorizationSchema = pgSchema("authorization")

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
])
