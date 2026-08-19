-- owner: accounting
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: persist a stable event occurrence identity for financial-operation reconciliation and projection rebuild replay

ALTER TABLE "accounting"."financial_operations" ADD COLUMN "reconciled_event_id" uuid DEFAULT uuidv7() NOT NULL;