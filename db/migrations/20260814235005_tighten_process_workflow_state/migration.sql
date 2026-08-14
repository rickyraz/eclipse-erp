-- owner: process
-- reviewed: 2026-08-14
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "process"."workflow_runs" DROP CONSTRAINT "workflow_runs_state_check", ADD CONSTRAINT "workflow_runs_state_check" CHECK (("status" = 'running' and "result" is null and "recovery_reason" is null and "completed_at" is null) or
      ("status" = 'succeeded' and "result" is not null and "recovery_reason" is null and "completed_at" is not null) or
      ("status" = 'manual_recovery' and "result" is null and "recovery_reason" is not null and "completed_at" is null));