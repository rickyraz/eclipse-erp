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
import { createdAt, id, money, updatedAt, uuidv7 } from "./common.ts"

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
export const financialCutoverStatus = accountingSchema.enum(
  "financial_cutover_status",
  [
    "postgresql",
    "preparing_tigerbeetle",
    "verification_pending",
    "approved",
    "activating",
    "tigerbeetle",
  ],
)
export const financialVerificationKind = accountingSchema.enum(
  "financial_verification_kind",
  [
    "opening_balance",
    "historical_boundary",
    "backup_restore",
    "failure_matrix",
    "projection_rebuild",
    "cutover_rehearsal",
    "observability",
  ],
)
export const financialVerificationCompleteness = accountingSchema.enum(
  "financial_verification_completeness",
  ["bounded", "full", "fenced"],
)
export const financialVerificationStatus = accountingSchema.enum(
  "financial_verification_status",
  ["verified", "rejected"],
)
export const financialReconciliationCheckpointStatus = accountingSchema.enum(
  "financial_reconciliation_checkpoint_status",
  ["verified", "blocked"],
)
export const financialOrphanTransferStatus = accountingSchema.enum(
  "financial_orphan_transfer_status",
  ["open", "resolved", "quarantined"],
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

export const financialVerificationArtifacts = accountingSchema.table(
  "financial_verification_artifacts",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    kind: financialVerificationKind("kind").notNull(),
    status: financialVerificationStatus("status").notNull(),
    completeness: financialVerificationCompleteness("completeness").notNull(),
    scope: text("scope").notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    mappingVersion: smallint("mapping_version").notNull(),
    currency: text("currency").notNull(),
    sourceWatermark: text("source_watermark").notNull(),
    targetWatermark: text("target_watermark").notNull(),
    sourceSnapshotRef: text("source_snapshot_ref").notNull(),
    targetSnapshotRef: text("target_snapshot_ref").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    signatureAlgorithm: text("signature_algorithm").notNull(),
    signingKeyId: text("signing_key_id").notNull(),
    signature: text("signature").notNull(),
    operationSetHash: text("operation_set_hash").notNull(),
    accountBalanceHash: text("account_balance_hash").notNull(),
    transferSetHash: text("transfer_set_hash").notNull(),
    projectionHash: text("projection_hash"),
    sourceDebitMinor: text("source_debit_minor").notNull(),
    sourceCreditMinor: text("source_credit_minor").notNull(),
    targetDebitMinor: text("target_debit_minor").notNull(),
    targetCreditMinor: text("target_credit_minor").notNull(),
    accountCount: integer("account_count").notNull(),
    operationCount: integer("operation_count").notNull(),
    transferCount: integer("transfer_count").notNull(),
    mismatchCount: integer("mismatch_count").notNull(),
    producerPrincipalId: text("producer_principal_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("financial_verification_artifacts_tenant_id_id_key").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "financial_verification_artifacts_tenant_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "financial_verification_artifacts_legal_entity_fkey",
    }),
    check("financial_verification_artifacts_scope_check", sql`${table.scope} ~ '[^[:space:]]'`),
    check("financial_verification_artifacts_schema_version_check", sql`${table.schemaVersion} > 0`),
    check(
      "financial_verification_artifacts_mapping_version_check",
      sql`${table.mappingVersion} > 0`,
    ),
    check("financial_verification_artifacts_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "financial_verification_artifacts_source_watermark_check",
      sql`${table.sourceWatermark} ~ '[^[:space:]]'`,
    ),
    check(
      "financial_verification_artifacts_target_watermark_check",
      sql`${table.targetWatermark} ~ '[^[:space:]]'`,
    ),
    check(
      "financial_verification_artifacts_source_snapshot_check",
      sql`${table.sourceSnapshotRef} ~ '[^[:space:]]'`,
    ),
    check(
      "financial_verification_artifacts_target_snapshot_check",
      sql`${table.targetSnapshotRef} ~ '[^[:space:]]'`,
    ),
    check(
      "financial_verification_artifacts_hash_check",
      sql`${table.artifactHash} ~ '^[0-9a-f]{64}$' and ${table.signatureAlgorithm} = 'Ed25519' and ${table.signingKeyId} ~ '[^[:space:]]' and ${table.signature} ~ '^[A-Za-z0-9_-]+$' and ${table.operationSetHash} ~ '^[0-9a-f]{64}$' and ${table.accountBalanceHash} ~ '^[0-9a-f]{64}$' and ${table.transferSetHash} ~ '^[0-9a-f]{64}$' and (${table.projectionHash} is null or ${table.projectionHash} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "financial_verification_artifacts_amount_check",
      sql`${table.sourceDebitMinor} ~ '^(0|[1-9][0-9]*)$' and ${table.sourceCreditMinor} ~ '^(0|[1-9][0-9]*)$' and ${table.targetDebitMinor} ~ '^(0|[1-9][0-9]*)$' and ${table.targetCreditMinor} ~ '^(0|[1-9][0-9]*)$'`,
    ),
    check(
      "financial_verification_artifacts_count_check",
      sql`${table.accountCount} >= 0 and ${table.operationCount} >= 0 and ${table.transferCount} >= 0 and ${table.mismatchCount} >= 0`,
    ),
    check(
      "financial_verification_artifacts_time_check",
      sql`${table.completedAt} >= ${table.startedAt}`,
    ),
    index("financial_verification_artifacts_scope_index").on(
      table.tenantId,
      table.legalEntityId,
      table.kind,
      table.createdAt,
    ),
  ],
)

export const financialCutoverControls = accountingSchema.table(
  "financial_cutover_controls",
  {
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    status: financialCutoverStatus("status").notNull().default("postgresql"),
    sourceEngine: financialEngine("source_engine").notNull().default("postgresql"),
    targetEngine: financialEngine("target_engine").notNull().default("tigerbeetle"),
    cutoverWatermark: text("cutover_watermark"),
    verificationHash: text("verification_hash"),
    openingBalanceVerified: boolean("opening_balance_verified").notNull().default(false),
    historicalBoundaryVerified: boolean("historical_boundary_verified").notNull().default(false),
    reconciliationHealthy: boolean("reconciliation_healthy").notNull().default(false),
    backupRecoveryVerified: boolean("backup_recovery_verified").notNull().default(false),
    evidenceArtifactId: uuid("evidence_artifact_id"),
    unresolvedAcceptedOperations: integer("unresolved_accepted_operations").notNull().default(0),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    activatedBy: text("activated_by"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.legalEntityId] }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [
        legalEntityAccountingConfigurations.tenantId,
        legalEntityAccountingConfigurations.legalEntityId,
      ],
      name: "financial_cutover_controls_configuration_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.evidenceArtifactId],
      foreignColumns: [financialVerificationArtifacts.tenantId, financialVerificationArtifacts.id],
      name: "financial_cutover_controls_evidence_artifact_fkey",
    }),
    check(
      "financial_cutover_controls_source_engine_check",
      sql`${table.sourceEngine} = 'postgresql'`,
    ),
    check(
      "financial_cutover_controls_target_engine_check",
      sql`${table.targetEngine} = 'tigerbeetle'`,
    ),
    check(
      "financial_cutover_controls_unresolved_check",
      sql`${table.unresolvedAcceptedOperations} >= 0`,
    ),
    check(
      "financial_cutover_controls_approval_check",
      sql`(${table.status} not in ('approved', 'activating', 'tigerbeetle') or
        (${table.openingBalanceVerified} and ${table.historicalBoundaryVerified} and
         ${table.reconciliationHealthy} and ${table.backupRecoveryVerified} and
         ${table.unresolvedAcceptedOperations} = 0 and
         ${table.cutoverWatermark} is not null and ${table.verificationHash} is not null and
         ${table.evidenceArtifactId} is not null and
         ${table.approvedBy} is not null and ${table.approvedAt} is not null))`,
    ),
    check(
      "financial_cutover_controls_activation_check",
      sql`(${table.status} <> 'tigerbeetle' or
        (${table.activatedBy} is not null and ${table.activatedAt} is not null))`,
    ),
    index("financial_cutover_controls_status_index").on(table.status),
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
  reconciledEventId: uuidv7("reconciled_event_id").default(sql`uuidv7()`).notNull(),
  operationType: financialOperationType("operation_type").notNull(),
  journalId: uuid("journal_id").notNull(),
  sourceJournalId: uuid("source_journal_id"),
  reference: text("reference").notNull(),
  currency: text("currency").notNull(),
  mappingVersion: integer("mapping_version").notNull(),
  engine: financialEngine("engine").notNull().default("postgresql"),
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
  unique("financial_operations_tenant_reconciled_event_key").on(
    table.tenantId,
    table.reconciledEventId,
  ),
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

export const financialReconciliationCheckpoints = accountingSchema.table(
  "financial_reconciliation_checkpoints",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    engine: financialEngine("engine").notNull(),
    status: financialReconciliationCheckpointStatus("status").notNull(),
    recoveryWatermark: text("recovery_watermark").notNull(),
    sourceWatermark: text("source_watermark").notNull(),
    targetWatermark: text("target_watermark").notNull(),
    sourceSnapshotRef: text("source_snapshot_ref").notNull(),
    targetSnapshotRef: text("target_snapshot_ref").notNull(),
    operationSetHash: text("operation_set_hash").notNull(),
    accountBalanceHash: text("account_balance_hash").notNull(),
    transferSetHash: text("transfer_set_hash").notNull(),
    projectionHash: text("projection_hash"),
    evidenceArtifactId: uuid("evidence_artifact_id"),
    mismatchCount: integer("mismatch_count").notNull().default(0),
    orphanCount: integer("orphan_count").notNull().default(0),
    checkedBy: text("checked_by").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("financial_reconciliation_checkpoints_tenant_id_id_key").on(table.tenantId, table.id),
    unique("financial_reconciliation_checkpoints_scope_watermark_key").on(
      table.tenantId,
      table.legalEntityId,
      table.engine,
      table.recoveryWatermark,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "financial_reconciliation_checkpoints_tenant_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "financial_reconciliation_checkpoints_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.evidenceArtifactId],
      foreignColumns: [financialVerificationArtifacts.tenantId, financialVerificationArtifacts.id],
      name: "financial_reconciliation_checkpoints_evidence_fkey",
    }),
    check(
      "financial_reconciliation_checkpoints_watermark_check",
      sql`${table.recoveryWatermark} ~ '[^[:space:]]' and ${table.sourceWatermark} ~ '[^[:space:]]' and ${table.targetWatermark} ~ '[^[:space:]]'`,
    ),
    check(
      "financial_reconciliation_checkpoints_snapshot_check",
      sql`${table.sourceSnapshotRef} ~ '[^[:space:]]' and ${table.targetSnapshotRef} ~ '[^[:space:]]'`,
    ),
    check(
      "financial_reconciliation_checkpoints_hash_check",
      sql`${table.operationSetHash} ~ '^[0-9a-f]{64}$' and ${table.accountBalanceHash} ~ '^[0-9a-f]{64}$' and ${table.transferSetHash} ~ '^[0-9a-f]{64}$' and (${table.projectionHash} is null or ${table.projectionHash} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "financial_reconciliation_checkpoints_count_check",
      sql`${table.mismatchCount} >= 0 and ${table.orphanCount} >= 0`,
    ),
    index("financial_reconciliation_checkpoints_scope_index").on(
      table.tenantId,
      table.legalEntityId,
      table.engine,
      table.checkedAt,
    ),
  ],
)

export const financialOrphanTransfers = accountingSchema.table(
  "financial_orphan_transfers",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    checkpointId: uuid("checkpoint_id").notNull(),
    operationId: uuid("operation_id"),
    transferId: text("transfer_id").notNull(),
    mappingVersion: integer("mapping_version").notNull(),
    status: financialOrphanTransferStatus("status").notNull().default("open"),
    reason: text("reason").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("financial_orphan_transfers_checkpoint_transfer_key").on(
      table.tenantId,
      table.checkpointId,
      table.transferId,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "financial_orphan_transfers_tenant_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "financial_orphan_transfers_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.checkpointId],
      foreignColumns: [
        financialReconciliationCheckpoints.tenantId,
        financialReconciliationCheckpoints.id,
      ],
      name: "financial_orphan_transfers_checkpoint_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.operationId],
      foreignColumns: [financialOperations.tenantId, financialOperations.id],
      name: "financial_orphan_transfers_operation_fkey",
    }),
    check(
      "financial_orphan_transfers_transfer_id_check",
      sql`${table.transferId} ~ '[^[:space:]]'`,
    ),
    check("financial_orphan_transfers_mapping_check", sql`${table.mappingVersion} > 0`),
    check(
      "financial_orphan_transfers_resolution_check",
      sql`(${table.status} = 'resolved') = (${table.resolvedAt} is not null)`,
    ),
    index("financial_orphan_transfers_scope_index").on(
      table.tenantId,
      table.legalEntityId,
      table.status,
      table.detectedAt,
    ),
  ],
)

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
      "financial_operation_transfers_amount_u128_check",
      sql`${table.amountMinor} <= 340282366920938463463374607431768211455`,
    ),
    check(
      "financial_operation_transfers_accounts_different_check",
      sql`${table.debitAccountId} <> ${table.creditAccountId}`,
    ),
  ],
)
