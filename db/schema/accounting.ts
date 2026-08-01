import { sql } from "drizzle-orm"
import { check, foreignKey, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, money, updatedAt } from "./common.ts"

export const accountingSchema = pgSchema("accounting")
export const accountType = accountingSchema.enum(
  "account_type",
  ["asset", "liability", "equity", "revenue", "expense"],
)
export const journalStatus = accountingSchema.enum(
  "journal_status",
  ["draft", "posted", "reversed"],
)

export const accounts = accountingSchema.table("accounts", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: accountType("type").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("accounts_tenant_id_id_key").on(table.tenantId, table.id),
  unique("accounts_tenant_code_key").on(table.tenantId, table.code),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "accounts_tenant_id_fkey",
  }).onDelete("cascade"),
])

export const journalEntries = accountingSchema.table("journal_entries", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  reference: text("reference").notNull(),
  status: journalStatus("status").notNull().default("draft"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("journal_entries_tenant_id_id_key").on(table.tenantId, table.id),
  unique("journal_entries_reference_key").on(table.tenantId, table.reference),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "journal_entries_tenant_id_fkey",
  }).onDelete("cascade"),
  check(
    "journal_entries_posted_at_check",
    sql`(${table.status} = 'draft' and ${table.postedAt} is null) or
      (${table.status} in ('posted', 'reversed') and ${table.postedAt} is not null)`,
  ),
])

export const journalLines = accountingSchema.table("journal_lines", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  accountId: uuid("account_id").notNull(),
  debit: money("debit").default("0"),
  credit: money("credit").default("0"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    columns: [table.tenantId, table.entryId],
    foreignColumns: [journalEntries.tenantId, journalEntries.id],
    name: "journal_lines_entry_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.accountId],
    foreignColumns: [accounts.tenantId, accounts.id],
    name: "journal_lines_account_fkey",
  }),
  check(
    "journal_lines_amount_check",
    sql`(${table.debit} > 0 and ${table.credit} = 0) or
      (${table.credit} > 0 and ${table.debit} = 0)`,
  ),
])
