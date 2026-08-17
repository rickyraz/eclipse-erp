-- owner: process
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: fence process job leases against stale workers

ALTER TABLE "process"."jobs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "process"."jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint

-- Existing leased rows cannot be completed by pre-fencing workers; let the
-- normal expiry/reclaim path issue a new lease with a real fencing token.
UPDATE "process"."jobs"
SET "lease_owner" = 'legacy-migration', "lease_token" = uuidv7()
WHERE "status" = 'leased';--> statement-breakpoint

ALTER TABLE "process"."jobs" DROP CONSTRAINT "process_jobs_lease_state_check", ADD CONSTRAINT "process_jobs_lease_state_check" CHECK (("status" = 'leased' and "lease_until" is not null and
        "lease_owner" is not null and "lease_owner" ~ '[^[:space:]]' and
        "lease_token" is not null) or
      ("status" <> 'leased' and "lease_until" is null and
        "lease_owner" is null and "lease_token" is null));