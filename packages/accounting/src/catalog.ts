import * as Schema from "effect/Schema"

import { AuthorizationDenied } from "../../authorization/mod.ts"
import { defineActionCatalogEntry, defineEventCatalogEntry } from "../../catalog/mod.ts"
import { DatabaseFailure } from "../../kernel/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import {
  AccountingPeriodNotOpen,
  JournalEntry,
  JournalIdempotencyConflict,
  PostRevenueForOrderInput,
  RevenuePostingProfileNotFound,
} from "./service.ts"

export const RevenuePostedEventPayload = Schema.Struct({
  journalId: Schema.String,
  legalEntityId: Schema.String,
  orderId: Schema.String,
})

export const AccountingPostRevenueAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "accounting.revenue.post",
  version: 1,
  owningDomain: "accounting",
  title: "Post revenue",
  description: "Post the configured revenue journal for an order.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: PostRevenueForOrderInput,
  outputSchema: JournalEntry,
  errorSchemas: [
    AccountingPeriodNotOpen,
    JournalIdempotencyConflict,
    RevenuePostingProfileNotFound,
    AuthorizationDenied,
    DatabaseFailure,
  ],
  requiredCapability: AccountingCapabilities.revenuePost,
  scope: ["tenant"],
  idempotency: "inherent",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 3 },
  compensation: { kind: "none", recovery: "manual" },
})

export const AccountingRevenuePostedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "accounting.revenue.posted",
  version: 1,
  owningDomain: "accounting",
  title: "Revenue posted",
  description: "Revenue was posted by its owning Accounting transaction.",
  stability: "EXPERIMENTAL",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: RevenuePostedEventPayload,
  scope: ["tenant"],
  aggregateType: "journal_entry",
  correlationFields: ["orderId"],
  filterableFields: ["journalId", "legalEntityId", "orderId"],
  occurredAtSemantics: "owner_commit_time",
})

export const AccountingTypedActionCatalog = [AccountingPostRevenueAction] as const
export const AccountingTypedEventCatalog = [AccountingRevenuePostedEvent] as const
