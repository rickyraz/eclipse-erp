-- owner: accounting
-- reviewed: 2026-08-18
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: persist immutable, hash-bound, signed recovery and cutover evidence

CREATE TYPE "accounting"."financial_verification_completeness" AS ENUM('bounded', 'full', 'fenced');--> statement-breakpoint
CREATE TYPE "accounting"."financial_verification_kind" AS ENUM('opening_balance', 'historical_boundary', 'backup_restore', 'failure_matrix', 'projection_rebuild', 'cutover_rehearsal', 'observability');--> statement-breakpoint
CREATE TYPE "accounting"."financial_verification_status" AS ENUM('verified', 'rejected');--> statement-breakpoint
CREATE TABLE "accounting"."financial_verification_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"kind" "accounting"."financial_verification_kind" NOT NULL,
	"status" "accounting"."financial_verification_status" NOT NULL,
	"completeness" "accounting"."financial_verification_completeness" NOT NULL,
	"scope" text NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"mapping_version" smallint NOT NULL,
	"currency" text NOT NULL,
	"source_watermark" text NOT NULL,
	"target_watermark" text NOT NULL,
	"source_snapshot_ref" text NOT NULL,
	"target_snapshot_ref" text NOT NULL,
	"artifact_hash" text NOT NULL,
	"signature_algorithm" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"signature" text NOT NULL,
	"operation_set_hash" text NOT NULL,
	"account_balance_hash" text NOT NULL,
	"transfer_set_hash" text NOT NULL,
	"projection_hash" text,
	"source_debit_minor" text NOT NULL,
	"source_credit_minor" text NOT NULL,
	"target_debit_minor" text NOT NULL,
	"target_credit_minor" text NOT NULL,
	"account_count" integer NOT NULL,
	"operation_count" integer NOT NULL,
	"transfer_count" integer NOT NULL,
	"mismatch_count" integer NOT NULL,
	"producer_principal_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_verification_artifacts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "financial_verification_artifacts_scope_check" CHECK ("scope" ~ '[^[:space:]]'),
	CONSTRAINT "financial_verification_artifacts_schema_version_check" CHECK ("schema_version" > 0),
	CONSTRAINT "financial_verification_artifacts_mapping_version_check" CHECK ("mapping_version" > 0),
	CONSTRAINT "financial_verification_artifacts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "financial_verification_artifacts_source_watermark_check" CHECK ("source_watermark" ~ '[^[:space:]]'),
	CONSTRAINT "financial_verification_artifacts_target_watermark_check" CHECK ("target_watermark" ~ '[^[:space:]]'),
	CONSTRAINT "financial_verification_artifacts_source_snapshot_check" CHECK ("source_snapshot_ref" ~ '[^[:space:]]'),
	CONSTRAINT "financial_verification_artifacts_target_snapshot_check" CHECK ("target_snapshot_ref" ~ '[^[:space:]]'),
	CONSTRAINT "financial_verification_artifacts_hash_check" CHECK ("artifact_hash" ~ '^[0-9a-f]{64}$' and "signature_algorithm" = 'Ed25519' and "signing_key_id" ~ '[^[:space:]]' and "signature" ~ '^[A-Za-z0-9_-]+$' and "operation_set_hash" ~ '^[0-9a-f]{64}$' and "account_balance_hash" ~ '^[0-9a-f]{64}$' and "transfer_set_hash" ~ '^[0-9a-f]{64}$' and ("projection_hash" is null or "projection_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "financial_verification_artifacts_amount_check" CHECK ("source_debit_minor" ~ '^(0|[1-9][0-9]*)$' and "source_credit_minor" ~ '^(0|[1-9][0-9]*)$' and "target_debit_minor" ~ '^(0|[1-9][0-9]*)$' and "target_credit_minor" ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "financial_verification_artifacts_count_check" CHECK ("account_count" >= 0 and "operation_count" >= 0 and "transfer_count" >= 0 and "mismatch_count" >= 0),
	CONSTRAINT "financial_verification_artifacts_time_check" CHECK ("completed_at" >= "started_at")
);
--> statement-breakpoint
ALTER TABLE "accounting"."financial_cutover_controls" ADD COLUMN "evidence_artifact_id" uuid;--> statement-breakpoint
CREATE INDEX "financial_verification_artifacts_scope_index" ON "accounting"."financial_verification_artifacts" ("tenant_id","legal_entity_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "accounting"."financial_cutover_controls" ADD CONSTRAINT "financial_cutover_controls_evidence_artifact_fkey" FOREIGN KEY ("tenant_id","evidence_artifact_id") REFERENCES "accounting"."financial_verification_artifacts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_verification_artifacts" ADD CONSTRAINT "financial_verification_artifacts_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."financial_verification_artifacts" ADD CONSTRAINT "financial_verification_artifacts_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_cutover_controls" DROP CONSTRAINT "financial_cutover_controls_approval_check", ADD CONSTRAINT "financial_cutover_controls_approval_check" CHECK (("status" not in ('approved', 'activating', 'tigerbeetle') or
        ("opening_balance_verified" and "historical_boundary_verified" and
         "reconciliation_healthy" and "backup_recovery_verified" and
         "unresolved_accepted_operations" = 0 and
         "cutover_watermark" is not null and "verification_hash" is not null and
         "evidence_artifact_id" is not null and
         "approved_by" is not null and "approved_at" is not null)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounting.prevent_financial_verification_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'financial_verification_artifacts_immutable',
      MESSAGE = 'financial verification artifacts are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'financial_verification_artifacts_immutable',
      MESSAGE = 'financial verification artifacts are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER financial_verification_artifacts_immutable
BEFORE UPDATE OR DELETE ON accounting.financial_verification_artifacts
FOR EACH ROW EXECUTE FUNCTION accounting.prevent_financial_verification_artifact_mutation();