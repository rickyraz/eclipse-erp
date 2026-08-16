import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  foreignKey,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { legalEntities } from "./party.ts"
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
export const accountingPeriodStatus = accountingSchema.enum(
  "accounting_period_status",
  ["open", "closed"],
)

export const legalEntityAccountingConfigurations = accountingSchema.table(
  "legal_entity_accounting_configurations",
  {
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    baseCurrency: text("base_currency").notNull(),
    precision: smallint("decimal_precision").notNull(),
    fiscalYearStartMonth: smallint("fiscal_year_start_month").notNull(),
    postingEnabled: boolean("posting_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.legalEntityId] }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "legal_entity_accounting_configurations_tenant_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "legal_entity_accounting_configurations_legal_entity_fkey",
    }),
    check(
      "legal_entity_accounting_configurations_currency_check",
      sql`${table.baseCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "legal_entity_accounting_configurations_precision_check",
      sql`${table.precision} = 2`,
    ),
    check(
      "legal_entity_accounting_configurations_fiscal_month_check",
      sql`${table.fiscalYearStartMonth} between 1 and 12`,
    ),
  ],
)

export const accountingPeriods = accountingSchema.table("accounting_periods", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: accountingPeriodStatus("status").notNull().default("open"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("accounting_periods_tenant_id_id_key").on(table.tenantId, table.id),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "accounting_periods_tenant_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId],
    foreignColumns: [legalEntities.tenantId, legalEntities.id],
    name: "accounting_periods_legal_entity_fkey",
  }),
  check("accounting_periods_dates_check", sql`${table.startsOn} <= ${table.endsOn}`),
])

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

export const revenuePostingProfiles = accountingSchema.table("revenue_posting_profiles", {
  tenantId: uuid("tenant_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  receivableAccountId: uuid("receivable_account_id").notNull(),
  revenueAccountId: uuid("revenue_account_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.legalEntityId] }),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId],
    foreignColumns: [legalEntities.tenantId, legalEntities.id],
    name: "revenue_posting_profiles_legal_entity_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.receivableAccountId],
    foreignColumns: [accounts.tenantId, accounts.id],
    name: "revenue_posting_profiles_receivable_account_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.revenueAccountId],
    foreignColumns: [accounts.tenantId, accounts.id],
    name: "revenue_posting_profiles_revenue_account_fkey",
  }),
  check(
    "revenue_posting_profiles_accounts_different_check",
    sql`${table.receivableAccountId} <> ${table.revenueAccountId}`,
  ),
])

export const journalEntries = accountingSchema.table("journal_entries", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  reference: text("reference").notNull(),
  reversesEntryId: uuid("reverses_entry_id"),
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
  foreignKey({
    columns: [table.tenantId, table.reversesEntryId],
    foreignColumns: [table.tenantId, table.id],
    name: "journal_entries_reverses_entry_fkey",
  }),
  check(
    "journal_entries_posted_at_check",
    sql`(${table.status} = 'draft' and ${table.postedAt} is null) or
      (${table.status} in ('posted', 'reversed') and ${table.postedAt} is not null)`,
  ),
  check(
    "journal_entries_reversal_state_check",
    sql`(${table.status} in ('draft', 'posted') and ${table.reversesEntryId} is null) or
      (${table.status} = 'reversed' and ${table.reversesEntryId} is not null)`,
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
