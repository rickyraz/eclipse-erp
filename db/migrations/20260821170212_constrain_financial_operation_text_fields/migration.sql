-- owner: accounting
-- reviewed: 2026-08-21
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: keep nullable public financial-operation metadata nonblank when present

ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_engine_accepted_at_check" CHECK ("engine_accepted_at" is null or "engine_accepted_at" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_rejection_reason_check" CHECK ("rejection_reason" is null or "rejection_reason" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_recovery_reason_check" CHECK ("recovery_reason" is null or "recovery_reason" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_last_error_check" CHECK ("last_error" is null or "last_error" ~ '[^[:space:]]');