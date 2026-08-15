-- owner: process
-- reviewed: 2026-08-14
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "process"."jobs" ADD CONSTRAINT "process_jobs_idempotency_key_check" CHECK ("idempotency_key" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "process"."jobs" ADD CONSTRAINT "process_jobs_correlation_id_check" CHECK ("correlation_id" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "process"."workflow_runs" ADD CONSTRAINT "workflow_runs_idempotency_key_check" CHECK ("idempotency_key" ~ '[^[:space:]]');