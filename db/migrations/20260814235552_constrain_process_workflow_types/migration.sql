-- owner: process
-- reviewed: 2026-08-14
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "process"."workflow_runs" ADD CONSTRAINT "workflow_runs_type_check" CHECK ("workflow_type" in ('sales.order.confirmation', 'sales.order.cancellation', 'sales.order.fulfillment'));