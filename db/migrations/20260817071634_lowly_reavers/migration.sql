-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: persist Accounting financial intent, receipt, projection, and retry state for the TigerBeetle cross-store protocol

CREATE TYPE "accounting"."financial_operation_status" AS ENUM('intent', 'submitted', 'accepted', 'rejected', 'unknown', 'manual_recovery', 'reconciled');--> statement-breakpoint
CREATE TYPE "accounting"."financial_operation_type" AS ENUM('journal_post', 'journal_reverse');--> statement-breakpoint
CREATE TYPE "accounting"."financial_transfer_status" AS ENUM('unresolved', 'accepted', 'rejected', 'manual_recovery');--> statement-breakpoint
CREATE TABLE "accounting"."financial_operation_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"debit_account_id" uuid NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"amount_minor" numeric(39,0) NOT NULL,
	"engine_transfer_id" text,
	"status" "accounting"."financial_transfer_status" DEFAULT 'unresolved'::"accounting"."financial_transfer_status" NOT NULL,
	"observed_timestamp" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_operation_transfers_operation_position_key" UNIQUE("tenant_id","operation_id","position"),
	CONSTRAINT "financial_operation_transfers_position_check" CHECK ("position" >= 0),
	CONSTRAINT "financial_operation_transfers_amount_check" CHECK ("amount_minor" > 0),
	CONSTRAINT "financial_operation_transfers_accounts_different_check" CHECK ("debit_account_id" <> "credit_account_id")
);
--> statement-breakpoint
CREATE TABLE "accounting"."financial_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"operation_type" "accounting"."financial_operation_type" NOT NULL,
	"journal_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"currency" text NOT NULL,
	"mapping_version" integer NOT NULL,
	"request_fingerprint" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"status" "accounting"."financial_operation_status" DEFAULT 'intent'::"accounting"."financial_operation_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"engine_accepted_at" text,
	"rejection_reason" text,
	"recovery_reason" text,
	"last_error" text,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_operations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "financial_operations_tenant_operation_key" UNIQUE("tenant_id","operation_id"),
	CONSTRAINT "financial_operations_tenant_journal_key" UNIQUE("tenant_id","journal_id"),
	CONSTRAINT "financial_operations_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "financial_operations_mapping_version_check" CHECK ("mapping_version" > 0),
	CONSTRAINT "financial_operations_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "financial_operations_reference_check" CHECK ("reference" ~ '[^[:space:]]'),
	CONSTRAINT "financial_operations_state_check" CHECK ((
      ("status" in ('intent', 'submitted', 'unknown') and
        "engine_accepted_at" is null and "rejection_reason" is null and
        "recovery_reason" is null and "reconciled_at" is null)
      or ("status" = 'accepted' and "engine_accepted_at" is not null and
        "rejection_reason" is null and "recovery_reason" is null and
        "reconciled_at" is null)
      or ("status" = 'rejected' and "engine_accepted_at" is null and
        "rejection_reason" is not null and "recovery_reason" is null and
        "reconciled_at" is null)
      or ("status" = 'manual_recovery' and "recovery_reason" is not null and
        "reconciled_at" is null)
      or ("status" = 'reconciled' and "engine_accepted_at" is not null and
        "rejection_reason" is null and "recovery_reason" is null and
        "reconciled_at" is not null)
    ))
);
--> statement-breakpoint
CREATE INDEX "financial_operation_transfers_operation_index" ON "accounting"."financial_operation_transfers" ("tenant_id","operation_id");--> statement-breakpoint
CREATE INDEX "financial_operations_submission_index" ON "accounting"."financial_operations" ("status","scheduled_at");--> statement-breakpoint
ALTER TABLE "accounting"."financial_operation_transfers" ADD CONSTRAINT "financial_operation_transfers_operation_fkey" FOREIGN KEY ("tenant_id","operation_id") REFERENCES "accounting"."financial_operations"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."financial_operation_transfers" ADD CONSTRAINT "financial_operation_transfers_debit_account_fkey" FOREIGN KEY ("tenant_id","debit_account_id") REFERENCES "accounting"."accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_operation_transfers" ADD CONSTRAINT "financial_operation_transfers_credit_account_fkey" FOREIGN KEY ("tenant_id","credit_account_id") REFERENCES "accounting"."accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_journal_fkey" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "accounting"."journal_entries"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "process"."jobs" DROP CONSTRAINT "process_jobs_type_check", ADD CONSTRAINT "process_jobs_type_check" CHECK ("job_type" in ('process.order_confirmation.post_commit', 'process.order_cancellation.post_commit', 'process.order_fulfillment.post_commit', 'accounting.financial_operation.submit', 'accounting.financial_operation.reconcile'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounting.enforce_financial_operation_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (
      (OLD.status = 'intent' AND NEW.status = 'submitted') OR
      (OLD.status = 'submitted' AND NEW.status IN ('reconciled', 'rejected', 'unknown', 'manual_recovery')) OR
      (OLD.status = 'unknown' AND NEW.status IN ('submitted', 'manual_recovery')) OR
      (OLD.status = 'accepted' AND NEW.status = 'reconciled')
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'financial_operations_state_transition_check',
        MESSAGE = 'invalid financial operation state transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financial_operations_state_transition
BEFORE UPDATE ON accounting.financial_operations
FOR EACH ROW EXECUTE FUNCTION accounting.enforce_financial_operation_transition();