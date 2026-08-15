-- owner: process
-- reviewed: 2026-08-14
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "process"."jobs" ADD CONSTRAINT "process_jobs_type_check" CHECK ("job_type" in ('process.order_confirmation.post_commit', 'process.order_cancellation.post_commit', 'process.order_fulfillment.post_commit'));