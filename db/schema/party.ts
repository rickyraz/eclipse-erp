import { boolean, foreignKey, pgSchema, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core"

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

export const legalEntities = partySchema.table("legal_entities", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  organizationPartyId: uuid("organization_party_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("legal_entities_tenant_id_id_key").on(table.tenantId, table.id),
  unique("legal_entities_tenant_organization_party_key").on(
    table.tenantId,
    table.organizationPartyId,
  ),
  foreignKey({
    columns: [table.tenantId, table.organizationPartyId],
    foreignColumns: [parties.tenantId, parties.id],
    name: "legal_entities_tenant_organization_party_fkey",
  }),
])

export const branches = partySchema.table("branches", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("branches_tenant_id_id_key").on(table.tenantId, table.id),
  unique("branches_tenant_legal_entity_name_key").on(
    table.tenantId,
    table.legalEntityId,
    table.name,
  ),
  unique("branches_tenant_legal_entity_id_key").on(
    table.tenantId,
    table.legalEntityId,
    table.id,
  ),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId],
    foreignColumns: [legalEntities.tenantId, legalEntities.id],
    name: "branches_tenant_legal_entity_fkey",
  }),
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

export const partyRelationships = partySchema.table("party_relationships", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  partyId: uuid("party_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  kind: partyRole("kind").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("party_relationships_tenant_id_id_key").on(table.tenantId, table.id),
  unique("party_relationships_tenant_party_legal_entity_kind_key").on(
    table.tenantId,
    table.partyId,
    table.legalEntityId,
    table.kind,
  ),
  foreignKey({
    columns: [table.tenantId, table.partyId],
    foreignColumns: [parties.tenantId, parties.id],
    name: "party_relationships_tenant_party_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId],
    foreignColumns: [legalEntities.tenantId, legalEntities.id],
    name: "party_relationships_tenant_legal_entity_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.partyId, table.kind],
    foreignColumns: [partyRoles.tenantId, partyRoles.partyId, partyRoles.role],
    name: "party_relationships_tenant_party_role_fkey",
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
