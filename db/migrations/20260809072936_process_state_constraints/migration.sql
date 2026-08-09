-- owner: process
-- reviewed: 2026-08-09
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "process"."event_outbox" ADD CONSTRAINT "event_outbox_event_version_check" CHECK ("event_version" > 0);--> statement-breakpoint
ALTER TABLE "process"."event_outbox" ADD CONSTRAINT "event_outbox_attempts_check" CHECK ("attempts" >= 0);--> statement-breakpoint
ALTER TABLE "process"."jobs" ADD CONSTRAINT "process_jobs_attempts_check" CHECK ("attempts" >= 0);--> statement-breakpoint
ALTER TABLE "process"."workflow_runs" ADD CONSTRAINT "workflow_runs_state_check" CHECK (("status" = 'running' and "result" is null and "completed_at" is null) or
      ("status" = 'succeeded' and "result" is not null and "completed_at" is not null) or
      ("status" = 'manual_recovery' and "recovery_reason" is not null));