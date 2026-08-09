-- owners: process, sales, inventory
-- reviewed: 2026-08-09
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE SCHEMA "process";
--> statement-breakpoint
CREATE TYPE "process"."process_job_status" AS ENUM('pending', 'leased', 'completed', 'failed', 'manual_recovery');--> statement-breakpoint
CREATE TYPE "process"."workflow_run_status" AS ENUM('running', 'succeeded', 'manual_recovery');--> statement-breakpoint
CREATE TABLE "process"."event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"actor_principal_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "process"."process_job_status" DEFAULT 'pending'::"process"."process_job_status" NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"last_error" text,
	"correlation_id" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_jobs_tenant_type_key" UNIQUE("tenant_id","job_type","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "process"."workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"workflow_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"status" "process"."workflow_run_status" DEFAULT 'running'::"process"."workflow_run_status" NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"recovery_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_tenant_type_key" UNIQUE("tenant_id","workflow_type","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD COLUMN "confirmation_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory"."reservations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_tenant_confirmation_idempotency_key" UNIQUE("tenant_id","confirmation_idempotency_key");--> statement-breakpoint
ALTER TABLE "inventory"."reservations" ADD CONSTRAINT "reservations_tenant_idempotency_key" UNIQUE("tenant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "process"."event_outbox" ADD CONSTRAINT "event_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "process"."jobs" ADD CONSTRAINT "process_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "process"."workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_confirmation_state_check" CHECK (("status" = 'draft' and "confirmed_at" is null) or
      ("status" = 'confirmed' and "confirmed_at" is not null) or
      ("status" = 'cancelled'));