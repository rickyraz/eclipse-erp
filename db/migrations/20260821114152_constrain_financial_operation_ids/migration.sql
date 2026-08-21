-- owner: accounting
-- reviewed: 2026-08-21
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: keep persisted financial operation identities nonblank for idempotent submission and reconciliation

ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_operation_id_check" CHECK ("operation_id" ~ '[^[:space:]]');