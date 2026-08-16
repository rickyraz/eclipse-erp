-- owner: process
-- reviewed: 2026-08-16
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "process"."jobs" ADD CONSTRAINT "process_jobs_lease_state_check" CHECK (("status" = 'leased' and "lease_until" is not null) or
      ("status" <> 'leased' and "lease_until" is null));