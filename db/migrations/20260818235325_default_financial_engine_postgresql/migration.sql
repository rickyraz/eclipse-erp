-- owner: accounting
-- reviewed: 2026-08-18
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: make newly-created financial operations follow the selected PostgreSQL default authority

ALTER TABLE "accounting"."financial_operations" ALTER COLUMN "engine" SET DEFAULT 'postgresql'::"accounting"."financial_engine";
