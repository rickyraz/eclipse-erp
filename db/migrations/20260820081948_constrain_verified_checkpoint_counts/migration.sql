-- owner: accounting
-- reviewed: 2026-08-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: keep verified reconciliation checkpoints free of mismatch or orphan counts

ALTER TABLE "accounting"."financial_reconciliation_checkpoints" ADD CONSTRAINT "financial_reconciliation_checkpoints_verified_counts_check" CHECK ("status" <> 'verified' or
        ("mismatch_count" = 0 and "orphan_count" = 0));