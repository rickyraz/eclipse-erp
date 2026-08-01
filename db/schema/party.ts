import { foreignKey, pgSchema, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"

export const partySchema = pgSchema("party")
export const partyKind = partySchema.enum("party_kind", ["person", "organization"])
export const partyRole = partySchema.enum("party_role", [
  "customer",
  "supplier",
  "employee",
  "partner",
])

export const parties = partySchema.table("parties", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  kind: partyKind("kind").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("parties_tenant_id_id_key").on(table.tenantId, table.id),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "parties_tenant_id_fkey",
  }).onDelete("cascade"),
])

export const partyRoles = partySchema.table("party_roles", {
  tenantId: uuid("tenant_id").notNull(),
  partyId: uuid("party_id").notNull(),
  role: partyRole("role").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.partyId, table.role] }),
  foreignKey({
    columns: [table.tenantId, table.partyId],
    foreignColumns: [parties.tenantId, parties.id],
    name: "party_roles_tenant_party_fkey",
  }).onDelete("cascade"),
])

export const partyIdentifiers = partySchema.table("party_identifiers", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  partyId: uuid("party_id").notNull(),
  scheme: text("scheme").notNull(),
  scope: text("scope").notNull(),
  value: text("value").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("party_identifiers_tenant_scheme_scope_value_key").on(
    table.tenantId,
    table.scheme,
    table.scope,
    table.value,
  ),
  foreignKey({
    columns: [table.tenantId, table.partyId],
    foreignColumns: [parties.tenantId, parties.id],
    name: "party_identifiers_tenant_party_fkey",
  }).onDelete("cascade"),
])
