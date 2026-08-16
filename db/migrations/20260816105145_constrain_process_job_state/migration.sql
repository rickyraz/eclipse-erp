-- owner: process
-- reviewed: 2026-08-16
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "process"."jobs" ADD CONSTRAINT "process_jobs_state_check" CHECK (("status" = 'pending' and "lease_until" is null and "completed_at" is null) or
      ("status" = 'leased' and "lease_until" is not null and "completed_at" is null) or
      ("status" = 'completed' and "lease_until" is null and "completed_at" is not null) or
      ("status" in ('failed', 'manual_recovery') and "lease_until" is null and "completed_at" is null));