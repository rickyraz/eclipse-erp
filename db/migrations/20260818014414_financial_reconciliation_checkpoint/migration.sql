-- owner: accounting
-- reviewed: 2026-08-18
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: persist append-only cross-store checkpoints and orphan-transfer quarantine

CREATE TYPE "accounting"."financial_orphan_transfer_status" AS ENUM('open', 'resolved', 'quarantined');--> statement-breakpoint
CREATE TYPE "accounting"."financial_reconciliation_checkpoint_status" AS ENUM('verified', 'blocked');--> statement-breakpoint
CREATE TABLE "accounting"."financial_orphan_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"operation_id" uuid,
	"transfer_id" text NOT NULL,
	"mapping_version" integer NOT NULL,
	"status" "accounting"."financial_orphan_transfer_status" DEFAULT 'open'::"accounting"."financial_orphan_transfer_status" NOT NULL,
	"reason" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_orphan_transfers_checkpoint_transfer_key" UNIQUE("tenant_id","checkpoint_id","transfer_id"),
	CONSTRAINT "financial_orphan_transfers_transfer_id_check" CHECK ("transfer_id" ~ '[^[:space:]]'),
	CONSTRAINT "financial_orphan_transfers_mapping_check" CHECK ("mapping_version" > 0),
	CONSTRAINT "financial_orphan_transfers_resolution_check" CHECK (("status" = 'resolved') = ("resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "accounting"."financial_reconciliation_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"engine" "accounting"."financial_engine" NOT NULL,
	"status" "accounting"."financial_reconciliation_checkpoint_status" NOT NULL,
	"recovery_watermark" text NOT NULL,
	"source_watermark" text NOT NULL,
	"target_watermark" text NOT NULL,
	"source_snapshot_ref" text NOT NULL,
	"target_snapshot_ref" text NOT NULL,
	"operation_set_hash" text NOT NULL,
	"account_balance_hash" text NOT NULL,
	"transfer_set_hash" text NOT NULL,
	"projection_hash" text,
	"evidence_artifact_id" uuid,
	"mismatch_count" integer DEFAULT 0 NOT NULL,
	"orphan_count" integer DEFAULT 0 NOT NULL,
	"checked_by" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_reconciliation_checkpoints_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "financial_reconciliation_checkpoints_scope_watermark_key" UNIQUE("tenant_id","legal_entity_id","engine","recovery_watermark"),
	CONSTRAINT "financial_reconciliation_checkpoints_watermark_check" CHECK ("recovery_watermark" ~ '[^[:space:]]' and "source_watermark" ~ '[^[:space:]]' and "target_watermark" ~ '[^[:space:]]'),
	CONSTRAINT "financial_reconciliation_checkpoints_snapshot_check" CHECK ("source_snapshot_ref" ~ '[^[:space:]]' and "target_snapshot_ref" ~ '[^[:space:]]'),
	CONSTRAINT "financial_reconciliation_checkpoints_hash_check" CHECK ("operation_set_hash" ~ '^[0-9a-f]{64}$' and "account_balance_hash" ~ '^[0-9a-f]{64}$' and "transfer_set_hash" ~ '^[0-9a-f]{64}$' and ("projection_hash" is null or "projection_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "financial_reconciliation_checkpoints_count_check" CHECK ("mismatch_count" >= 0 and "orphan_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "financial_orphan_transfers_scope_index" ON "accounting"."financial_orphan_transfers" ("tenant_id","legal_entity_id","status","detected_at");--> statement-breakpoint
CREATE INDEX "financial_reconciliation_checkpoints_scope_index" ON "accounting"."financial_reconciliation_checkpoints" ("tenant_id","legal_entity_id","engine","checked_at");--> statement-breakpoint
ALTER TABLE "accounting"."financial_orphan_transfers" ADD CONSTRAINT "financial_orphan_transfers_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."financial_orphan_transfers" ADD CONSTRAINT "financial_orphan_transfers_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_orphan_transfers" ADD CONSTRAINT "financial_orphan_transfers_checkpoint_fkey" FOREIGN KEY ("tenant_id","checkpoint_id") REFERENCES "accounting"."financial_reconciliation_checkpoints"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."financial_orphan_transfers" ADD CONSTRAINT "financial_orphan_transfers_operation_fkey" FOREIGN KEY ("tenant_id","operation_id") REFERENCES "accounting"."financial_operations"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_reconciliation_checkpoints" ADD CONSTRAINT "financial_reconciliation_checkpoints_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."financial_reconciliation_checkpoints" ADD CONSTRAINT "financial_reconciliation_checkpoints_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_reconciliation_checkpoints" ADD CONSTRAINT "financial_reconciliation_checkpoints_evidence_fkey" FOREIGN KEY ("tenant_id","evidence_artifact_id") REFERENCES "accounting"."financial_verification_artifacts"("tenant_id","id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounting.prevent_financial_reconciliation_checkpoint_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR (TG_OP = 'DELETE' AND pg_trigger_depth() = 1) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'financial_reconciliation_checkpoints_immutable',
      MESSAGE = 'financial reconciliation checkpoints are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER financial_reconciliation_checkpoints_immutable
BEFORE UPDATE OR DELETE ON accounting.financial_reconciliation_checkpoints
FOR EACH ROW EXECUTE FUNCTION accounting.prevent_financial_reconciliation_checkpoint_mutation();