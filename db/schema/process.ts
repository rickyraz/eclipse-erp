import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"

export const processSchema = pgSchema("process")
export const workflowRunStatus = processSchema.enum(
  "workflow_run_status",
  ["running", "succeeded", "manual_recovery"],
)
export const processJobStatus = processSchema.enum(
  "process_job_status",
  ["pending", "leased", "completed", "failed", "manual_recovery"],
)

export const workflowRuns = processSchema.table("workflow_runs", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  workflowType: text("workflow_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  status: workflowRunStatus("status").notNull().default("running"),
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  recoveryReason: text("recovery_reason"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("workflow_runs_tenant_type_key").on(
    table.tenantId,
    table.workflowType,
    table.idempotencyKey,
  ),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "workflow_runs_tenant_id_fkey",
  }).onDelete("cascade"),
  check(
    "workflow_runs_type_check",
    sql`${table.workflowType} in ('sales.order.confirmation', 'sales.order.cancellation', 'sales.order.fulfillment')`,
  ),
  check(
    "workflow_runs_idempotency_key_check",
    sql`${table.idempotencyKey} ~ '[^[:space:]]'`,
  ),
  check(
    "workflow_runs_state_check",
    sql`(${table.status} = 'running' and ${table.result} is null and ${table.recoveryReason} is null and ${table.completedAt} is null) or
      (${table.status} = 'succeeded' and ${table.result} is not null and ${table.recoveryReason} is null and ${table.completedAt} is not null) or
      (${table.status} = 'manual_recovery' and ${table.result} is null and ${table.recoveryReason} is not null and ${table.completedAt} is null)`,
  ),
])

export const processJobs = processSchema.table("jobs", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  jobType: text("job_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  priority: integer("priority").notNull().default(0),
  status: processJobStatus("status").notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseOwner: text("lease_owner"),
  leaseToken: uuid("lease_token"),
  attempts: integer("attempts").notNull().default(0),
  payload: jsonb("payload").notNull(),
  lastError: text("last_error"),
  correlationId: text("correlation_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("process_jobs_tenant_type_key").on(
    table.tenantId,
    table.jobType,
    table.idempotencyKey,
  ),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "process_jobs_tenant_id_fkey",
  }).onDelete("cascade"),
  check(
    "process_jobs_type_check",
    sql`${table.jobType} in ('process.order_confirmation.post_commit', 'process.order_cancellation.post_commit', 'process.order_fulfillment.post_commit')`,
  ),
  check(
    "process_jobs_idempotency_key_check",
    sql`${table.idempotencyKey} ~ '[^[:space:]]'`,
  ),
  check(
    "process_jobs_correlation_id_check",
    sql`${table.correlationId} ~ '[^[:space:]]'`,
  ),
  check("process_jobs_attempts_check", sql`${table.attempts} >= 0`),
  check(
    "process_jobs_lease_state_check",
    sql`(${table.status} = 'leased' and ${table.leaseUntil} is not null and
        ${table.leaseOwner} is not null and ${table.leaseOwner} ~ '[^[:space:]]' and
        ${table.leaseToken} is not null) or
      (${table.status} <> 'leased' and ${table.leaseUntil} is null and
        ${table.leaseOwner} is null and ${table.leaseToken} is null)`,
  ),
  check(
    "process_jobs_state_check",
    sql`(${table.status} = 'pending' and ${table.leaseUntil} is null and ${table.completedAt} is null) or
      (${table.status} = 'leased' and ${table.leaseUntil} is not null and ${table.completedAt} is null) or
      (${table.status} = 'completed' and ${table.leaseUntil} is null and ${table.completedAt} is not null) or
      (${table.status} in ('failed', 'manual_recovery') and ${table.leaseUntil} is null and ${table.completedAt} is null)`,
  ),
])
