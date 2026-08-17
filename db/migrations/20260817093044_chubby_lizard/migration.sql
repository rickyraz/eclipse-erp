-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: retain the observed routing engine when fencing configuration drift

ALTER TABLE "accounting"."financial_operations" ADD COLUMN "observed_engine" "accounting"."financial_engine";