-- owner: accounting
-- reviewed: 2026-08-09
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "accounting"."accounting_periods"
  ADD CONSTRAINT "accounting_periods_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "legal_entity_id" WITH =,
    daterange("starts_on", "ends_on", '[]') WITH &&
  );
