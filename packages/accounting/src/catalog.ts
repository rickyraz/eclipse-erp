import { AuthorizationDenied } from "../../authorization/mod.ts"
import { defineActionCatalogEntry } from "../../catalog/mod.ts"
import { DatabaseFailure } from "../../kernel/mod.ts"
import { EventIdempotencyConflict } from "../../messaging/mod.ts"
import { SalesOrderInvalidState, SalesOrderNotFound } from "../../sales/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import {
  CreateFinancialJournalIntentInput,
  FinancialOperation,
  FinancialOperationConflict,
  FinancialReversalSourceNotFound,
  FinancialReversalSourceNotPosted,
  FinancialReversalSourceRequired,
} from "./financial-operations.ts"
import {
  AccountingPeriodNotOpen,
  AccountNotFound,
  InvalidJournalLine,
  JournalEntry,
  JournalIdempotencyConflict,
  JournalReferenceAlreadyExists,
  PostRevenueForOrderInput,
  RevenuePostingProfileNotFound,
  UnbalancedJournal,
} from "./service.ts"
import {
  AccountingFinancialOperationReconciledEvent,
  AccountingRevenuePostedEvent,
} from "./events.ts"

export const AccountingFinancialOperationPostAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "accounting.journal.post",
  version: 1,
  owningDomain: "accounting",
  title: "Create a financial operation intent",
  description: "Record a PostgreSQL intent for later TigerBeetle submission and reconciliation.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: CreateFinancialJournalIntentInput,
  outputSchema: FinancialOperation,
  errorSchemas: [
    AccountingPeriodNotOpen,
    AccountNotFound,
    AuthorizationDenied,
    DatabaseFailure,
    FinancialOperationConflict,
    FinancialReversalSourceNotFound,
    FinancialReversalSourceNotPosted,
    FinancialReversalSourceRequired,
    JournalIdempotencyConflict,
    JournalReferenceAlreadyExists,
    InvalidJournalLine,
    UnbalancedJournal,
  ],
  requiredCapability: AccountingCapabilities.journalPost,
  scope: ["tenant"],
  idempotency: "inherent",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 3 },
  preconditions: ["authorized", "accounting_period_open", "accounts_exist"],
  effects: ["financial_intent_recorded"],
  compensation: { kind: "none", recovery: "manual" },
})

export const AccountingRevenuePostAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "accounting.revenue.post",
  version: 1,
  owningDomain: "accounting",
  title: "Post revenue for sales order",
  description: "Post revenue using the confirmed Sales order total as the server-derived amount.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: PostRevenueForOrderInput,
  outputSchema: JournalEntry,
  errorSchemas: [
    AccountingPeriodNotOpen,
    EventIdempotencyConflict,
    JournalIdempotencyConflict,
    RevenuePostingProfileNotFound,
    SalesOrderInvalidState,
    SalesOrderNotFound,
    AuthorizationDenied,
    DatabaseFailure,
  ],
  requiredCapability: AccountingCapabilities.revenuePost,
  scope: ["tenant"],
  idempotency: "inherent",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 3 },
  preconditions: [
    "authorized",
    "sales_order_confirmed",
    "revenue_profile_configured",
    "accounting_period_open",
  ],
  effects: ["revenue_journal_posted"],
  compensation: { kind: "none", recovery: "manual" },
})

export {
  AccountingFinancialOperationReconciledEvent,
  AccountingRevenuePostedEvent,
  RevenuePostedEventPayload,
} from "./events.ts"

export const AccountingTypedActionCatalog = [
  AccountingFinancialOperationPostAction,
  AccountingRevenuePostAction,
] as const
export const AccountingTypedEventCatalog = [
  AccountingFinancialOperationReconciledEvent,
  AccountingRevenuePostedEvent,
] as const
