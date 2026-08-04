import { sql } from "drizzle-orm"
import { check, foreignKey, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"

import { identities } from "./identity.ts"
import { createdAt, id, updatedAt } from "./common.ts"

export const authSchema = pgSchema("auth")

export const tenants = authSchema.table("tenants", {
  id: id(),
  slug: text("slug").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [unique("tenants_slug_key").on(table.slug)])

export const sessions = authSchema.table("sessions", {
  id: id(),
  identityId: uuid("identity_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("sessions_token_hash_key").on(table.tokenHash),
  foreignKey({
    columns: [table.identityId],
    foreignColumns: [identities.id],
    name: "sessions_identity_id_fkey",
  }).onDelete("cascade"),
  check("sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
])
