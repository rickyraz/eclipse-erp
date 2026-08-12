-- owner: messaging
-- reviewed: 2026-08-12
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE TABLE "messaging"."consumer_receipts" (
	"tenant_id" uuid,
	"consumer_id" text,
	"event_id" uuid,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumer_receipts_pkey" PRIMARY KEY("tenant_id","consumer_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "messaging"."event_outbox" (
	"id" uuid DEFAULT uuidv7(),
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"tenant_id" uuid,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"idempotency_key" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_outbox_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "event_outbox_dedupe_key" UNIQUE("tenant_id","event_type","event_version","idempotency_key"),
	CONSTRAINT "event_outbox_event_version_check" CHECK ("event_version" > 0),
	CONSTRAINT "event_outbox_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "messaging"."consumer_receipts" ADD CONSTRAINT "consumer_receipts_event_fkey" FOREIGN KEY ("tenant_id","event_id") REFERENCES "messaging"."event_outbox"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "messaging"."event_outbox" ADD CONSTRAINT "event_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;