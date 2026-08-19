-- owner: accounting
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: keep reconciliation event occurrence identities unique within a tenant

ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_tenant_reconciled_event_key" UNIQUE("tenant_id","reconciled_event_id");