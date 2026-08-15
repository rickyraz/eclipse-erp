-- owner: messaging
-- reviewed: 2026-08-14
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "messaging"."consumer_receipts" ADD CONSTRAINT "consumer_receipts_consumer_id_check" CHECK ("consumer_id" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_event_type_check" CHECK ("event_type" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_aggregate_type_check" CHECK ("aggregate_type" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_command_id_check" CHECK ("command_id" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_correlation_id_check" CHECK ("correlation_id" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_causation_id_check" CHECK ("causation_id" is null or "causation_id" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_idempotency_key_check" CHECK ("idempotency_key" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_actor_principal_id_check" CHECK ("actor_principal_id" ~ '[^[:space:]]');