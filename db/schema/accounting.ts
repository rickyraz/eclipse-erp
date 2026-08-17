import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
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
export const financialEngine = accountingSchema.enum(
  "financial_engine",
  ["postgresql", "tigerbeetle"],
)
export const financialOperationType = accountingSchema.enum(
  "financial_operation_type",
  ["journal_post", "journal_reverse", "revenue_post"],
)
export const financialOperationStatus = accountingSchema.enum(
  "financial_operation_status",
  ["intent", "submitted", "accepted", "rejected", "unknown", "manual_recovery", "reconciled"],
)
export const financialTransferStatus = accountingSchema.enum(
  "financial_transfer_status",
  ["unresolved", "accepted", "rejected", "manual_recovery"],
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
    financialEngine: financialEngine("financial_engine").notNull().default("postgresql"),
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
    "journal_entries_reference_check",
    sql`${table.reference} ~ '[^[:space:]]'`,
  ),
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

export const financialOperations = accountingSchema.table("financial_operations", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  periodId: uuid("period_id").notNull(),
  operationId: text("operation_id").notNull(),
  operationType: financialOperationType("operation_type").notNull(),
  journalId: uuid("journal_id").notNull(),
  sourceJournalId: uuid("source_journal_id"),
  reference: text("reference").notNull(),
  currency: text("currency").notNull(),
  mappingVersion: integer("mapping_version").notNull(),
  engine: financialEngine("engine").notNull().default("tigerbeetle"),
  engineVerified: boolean("engine_verified").notNull().default(false),
  requestFingerprint: text("request_fingerprint").notNull(),
  actorPrincipalId: text("actor_principal_id").notNull(),
  actorSessionId: text("actor_session_id").notNull(),
  status: financialOperationStatus("status").notNull().default("intent"),
  attempts: integer("attempts").notNull().default(0),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  engineAcceptedAt: text("engine_accepted_at"),
  rejectionReason: text("rejection_reason"),
  recoveryReason: text("recovery_reason"),
  observedEngine: financialEngine("observed_engine"),
  lastError: text("last_error"),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("financial_operations_tenant_id_id_key").on(table.tenantId, table.id),
  unique("financial_operations_tenant_operation_key").on(table.tenantId, table.operationId),
  unique("financial_operations_tenant_journal_key").on(table.tenantId, table.journalId),
  unique("financial_operations_tenant_source_journal_key").on(
    table.tenantId,
    table.sourceJournalId,
  ),
  index("financial_operations_submission_index").on(table.status, table.scheduledAt),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "financial_operations_tenant_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tenantId, table.legalEntityId],
    foreignColumns: [legalEntities.tenantId, legalEntities.id],
    name: "financial_operations_legal_entity_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.periodId],
    foreignColumns: [accountingPeriods.tenantId, accountingPeriods.id],
    name: "financial_operations_period_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.journalId],
    foreignColumns: [journalEntries.tenantId, journalEntries.id],
    name: "financial_operations_journal_fkey",
  }),
  foreignKey({
    columns: [table.tenantId, table.sourceJournalId],
    foreignColumns: [journalEntries.tenantId, journalEntries.id],
    name: "financial_operations_source_journal_fkey",
  }),
  check(
    "financial_operations_operation_type_check",
    sql`(${table.operationType} in ('journal_post', 'revenue_post') and
      ${table.sourceJournalId} is null) or
      (${table.operationType} = 'journal_reverse' and ${table.sourceJournalId} is not null)`,
  ),
  check("financial_operations_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("financial_operations_mapping_version_check", sql`${table.mappingVersion} > 0`),
  check("financial_operations_attempts_check", sql`${table.attempts} >= 0`),
  check("financial_operations_reference_check", sql`${table.reference} ~ '[^[:space:]]'`),
  check(
    "financial_operations_state_check",
    sql`(
      (${table.status} in ('intent', 'submitted', 'unknown') and
        ${table.engineAcceptedAt} is null and ${table.rejectionReason} is null and
        ${table.recoveryReason} is null and ${table.reconciledAt} is null)
      or (${table.status} = 'accepted' and ${table.engineAcceptedAt} is not null and
        ${table.rejectionReason} is null and ${table.recoveryReason} is null and
        ${table.reconciledAt} is null)
      or (${table.status} = 'rejected' and ${table.engineAcceptedAt} is null and
        ${table.rejectionReason} is not null and ${table.recoveryReason} is null and
        ${table.reconciledAt} is null)
      or (${table.status} = 'manual_recovery' and ${table.recoveryReason} is not null and
        ${table.reconciledAt} is null)
      or (${table.status} = 'reconciled' and ${table.engineAcceptedAt} is not null and
        ${table.rejectionReason} is null and ${table.recoveryReason} is null and
        ${table.reconciledAt} is not null)
    )`,
  ),
])

export const financialOperationTransfers = accountingSchema.table(
  "financial_operation_transfers",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    position: integer("position").notNull(),
    debitAccountId: uuid("debit_account_id").notNull(),
    creditAccountId: uuid("credit_account_id").notNull(),
    amountMinor: numeric("amount_minor", { precision: 39, scale: 0 }).notNull(),
    engineTransferId: text("engine_transfer_id"),
    status: financialTransferStatus("status").notNull().default("unresolved"),
    observedTimestamp: text("observed_timestamp"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("financial_operation_transfers_operation_position_key").on(
      table.tenantId,
      table.operationId,
      table.position,
    ),
    index("financial_operation_transfers_operation_index").on(table.tenantId, table.operationId),
    foreignKey({
      columns: [table.tenantId, table.operationId],
      foreignColumns: [financialOperations.tenantId, financialOperations.id],
      name: "financial_operation_transfers_operation_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.debitAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "financial_operation_transfers_debit_account_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.creditAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "financial_operation_transfers_credit_account_fkey",
    }),
    check("financial_operation_transfers_position_check", sql`${table.position} >= 0`),
    check("financial_operation_transfers_amount_check", sql`${table.amountMinor} > 0`),
    check(
      "financial_operation_transfers_accounts_different_check",
      sql`${table.debitAccountId} <> ${table.creditAccountId}`,
    ),
  ],
)
