import { AuthorizationDenied } from "../../authorization/mod.ts"
import { defineActionCatalogEntry } from "../../catalog/mod.ts"
import { DatabaseFailure } from "../../kernel/mod.ts"
import { EventIdempotencyConflict } from "../../messaging/mod.ts"
import { SalesOrderInvalidState, SalesOrderNotFound } from "../../sales/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import {
  AccountingPeriodNotOpen,
  JournalEntry,
  JournalIdempotencyConflict,
  PostRevenueForOrderInput,
  RevenuePostingProfileNotFound,
} from "./service.ts"
import { AccountingRevenuePostedEvent } from "./events.ts"

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
  idempotency: "required",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 3 },
  preconditions: [
    "authorized",
    "idempotency_key_stable",
    "revenue_profile_configured",
    "accounting_period_open",
  ],
  effects: ["revenue_journal_posted"],
  compensation: { kind: "none", recovery: "manual" },
})

export { AccountingRevenuePostedEvent, RevenuePostedEventPayload } from "./events.ts"

export const AccountingTypedActionCatalog = [AccountingRevenuePostAction] as const
export const AccountingTypedEventCatalog = [AccountingRevenuePostedEvent] as const
