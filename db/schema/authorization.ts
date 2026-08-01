import { foreignKey, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, updatedAt } from "./common.ts"
import { identities } from "./identity.ts"

export const authorizationSchema = pgSchema("authorization")

export const memberships = authorizationSchema.table("memberships", {
  identityId: uuid("identity_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  capability: text("capability").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.identityId, table.tenantId, table.capability] }),
  foreignKey({
    columns: [table.identityId],
    foreignColumns: [identities.id],
    name: "memberships_identity_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "memberships_tenant_id_fkey",
  }).onDelete("cascade"),
])
