import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { uuidv7 } from "./common.ts"

export const messagingSchema = pgSchema("messaging")

export const eventOutbox = messagingSchema.table("event_outbox", {
  id: uuidv7("id").default(sql`uuidv7()`).notNull(),
  eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  commandId: text("command_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  causationId: text("causation_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  actorPrincipalId: text("actor_principal_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb("payload").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
}, (table) => [
  primaryKey({
    name: "event_outbox_pkey",
    columns: [table.tenantId, table.id],
  }),
  unique("event_outbox_dedupe_key").on(
    table.tenantId,
    table.eventType,
    table.eventVersion,
    table.idempotencyKey,
  ),
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
    name: "event_outbox_tenant_id_fkey",
  }).onDelete("cascade"),
  check("event_outbox_event_type_check", sql`${table.eventType} ~ '[^[:space:]]'`),
  check("event_outbox_aggregate_type_check", sql`${table.aggregateType} ~ '[^[:space:]]'`),
  check("event_outbox_command_id_check", sql`${table.commandId} ~ '[^[:space:]]'`),
  check("event_outbox_correlation_id_check", sql`${table.correlationId} ~ '[^[:space:]]'`),
  check(
    "event_outbox_causation_id_check",
    sql`${table.causationId} is null or ${table.causationId} ~ '[^[:space:]]'`,
  ),
  check("event_outbox_idempotency_key_check", sql`${table.idempotencyKey} ~ '[^[:space:]]'`),
  check(
    "event_outbox_actor_principal_id_check",
    sql`${table.actorPrincipalId} ~ '[^[:space:]]'`,
  ),
  check("event_outbox_event_version_check", sql`${table.eventVersion} > 0`),
  check("event_outbox_attempts_check", sql`${table.attempts} >= 0`),
])

export const consumerReceipts = messagingSchema.table("consumer_receipts", {
  tenantId: uuid("tenant_id").notNull(),
  consumerId: text("consumer_id").notNull(),
  eventId: uuid("event_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({
    name: "consumer_receipts_pkey",
    columns: [table.tenantId, table.consumerId, table.eventId],
  }),
  foreignKey({
    columns: [table.tenantId, table.eventId],
    foreignColumns: [eventOutbox.tenantId, eventOutbox.id],
    name: "consumer_receipts_event_fkey",
  }),
  check("consumer_receipts_consumer_id_check", sql`${table.consumerId} ~ '[^[:space:]]'`),
])
