-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: make TigerBeetle activation durable, scoped, auditable, and gate-protected

CREATE TYPE "accounting"."financial_cutover_status" AS ENUM(
  'postgresql',
  'preparing_tigerbeetle',
  'verification_pending',
  'approved',
  'activating',
  'tigerbeetle'
);--> statement-breakpoint

CREATE TABLE "accounting"."financial_cutover_controls" (
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "status" "accounting"."financial_cutover_status" DEFAULT 'postgresql'::"accounting"."financial_cutover_status" NOT NULL,
  "source_engine" "accounting"."financial_engine" DEFAULT 'postgresql'::"accounting"."financial_engine" NOT NULL,
  "target_engine" "accounting"."financial_engine" DEFAULT 'tigerbeetle'::"accounting"."financial_engine" NOT NULL,
  "cutover_watermark" text,
  "verification_hash" text,
  "opening_balance_verified" boolean DEFAULT false NOT NULL,
  "historical_boundary_verified" boolean DEFAULT false NOT NULL,
  "reconciliation_healthy" boolean DEFAULT false NOT NULL,
  "backup_recovery_verified" boolean DEFAULT false NOT NULL,
  "unresolved_accepted_operations" integer DEFAULT 0 NOT NULL,
  "approved_by" text,
  "approved_at" timestamp with time zone,
  "activated_by" text,
  "activated_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "financial_cutover_controls_pkey" PRIMARY KEY("tenant_id","legal_entity_id"),
  CONSTRAINT "financial_cutover_controls_source_engine_check" CHECK ("source_engine" = 'postgresql'),
  CONSTRAINT "financial_cutover_controls_target_engine_check" CHECK ("target_engine" = 'tigerbeetle'),
  CONSTRAINT "financial_cutover_controls_unresolved_check" CHECK ("unresolved_accepted_operations" >= 0),
  CONSTRAINT "financial_cutover_controls_approval_check" CHECK (
    ("status" not in ('approved', 'activating', 'tigerbeetle') or
      ("opening_balance_verified" and "historical_boundary_verified" and
       "reconciliation_healthy" and "backup_recovery_verified" and
       "unresolved_accepted_operations" = 0 and
       "cutover_watermark" is not null and "verification_hash" is not null and
       "approved_by" is not null and "approved_at" is not null))
  ),
  CONSTRAINT "financial_cutover_controls_activation_check" CHECK (
    ("status" <> 'tigerbeetle' or ("activated_by" is not null and "activated_at" is not null))
  )
);--> statement-breakpoint

CREATE INDEX "financial_cutover_controls_status_index"
  ON "accounting"."financial_cutover_controls" ("status");--> statement-breakpoint

ALTER TABLE "accounting"."financial_cutover_controls"
  ADD CONSTRAINT "financial_cutover_controls_configuration_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id")
  REFERENCES "accounting"."legal_entity_accounting_configurations" ("tenant_id", "legal_entity_id")
  ON DELETE CASCADE;--> statement-breakpoint

INSERT INTO "accounting"."financial_cutover_controls" (
  "tenant_id", "legal_entity_id", "status", "source_engine", "target_engine"
)
SELECT
  "tenant_id",
  "legal_entity_id",
  CASE WHEN "financial_engine" = 'tigerbeetle' THEN 'verification_pending'::"accounting"."financial_cutover_status"
       ELSE 'postgresql'::"accounting"."financial_cutover_status" END,
  'postgresql'::"accounting"."financial_engine",
  'tigerbeetle'::"accounting"."financial_engine"
FROM "accounting"."legal_entity_accounting_configurations";--> statement-breakpoint

CREATE OR REPLACE FUNCTION accounting.ensure_financial_cutover_control()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  INSERT INTO accounting.financial_cutover_controls (tenant_id, legal_entity_id)
  VALUES (NEW.tenant_id, NEW.legal_entity_id)
  ON CONFLICT (tenant_id, legal_entity_id) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER legal_entity_accounting_cutover_control
AFTER INSERT ON accounting.legal_entity_accounting_configurations
FOR EACH ROW EXECUTE FUNCTION accounting.ensure_financial_cutover_control();--> statement-breakpoint

CREATE OR REPLACE FUNCTION accounting.enforce_financial_cutover_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'postgresql' AND NEW.status = 'preparing_tigerbeetle') OR
    (OLD.status = 'preparing_tigerbeetle' AND NEW.status IN ('verification_pending', 'approved')) OR
    (OLD.status = 'verification_pending' AND NEW.status = 'approved') OR
    (OLD.status = 'approved' AND NEW.status = 'activating') OR
    (OLD.status = 'activating' AND NEW.status = 'tigerbeetle')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'financial_cutover_controls_state_transition_check',
      MESSAGE = 'invalid financial cutover transition';
  END IF;
  IF NEW.status = 'tigerbeetle' THEN
    IF NEW.activated_by IS NULL OR NEW.activated_at IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'financial_cutover_controls_activation_check',
        MESSAGE = 'TigerBeetle cutover requires an activation record';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM accounting.legal_entity_accounting_configurations configuration
      WHERE configuration.tenant_id = NEW.tenant_id
        AND configuration.legal_entity_id = NEW.legal_entity_id
        AND configuration.financial_engine = 'tigerbeetle'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'financial_cutover_controls_engine_route_check',
        MESSAGE = 'TigerBeetle cutover control requires the TigerBeetle route';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER financial_cutover_controls_transition
BEFORE UPDATE ON accounting.financial_cutover_controls
FOR EACH ROW EXECUTE FUNCTION accounting.enforce_financial_cutover_transition();--> statement-breakpoint

CREATE OR REPLACE FUNCTION accounting.prevent_uncontrolled_financial_engine_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF OLD.financial_engine = 'postgresql' AND NEW.financial_engine = 'tigerbeetle' THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounting.financial_cutover_controls control
      WHERE control.tenant_id = NEW.tenant_id
        AND control.legal_entity_id = NEW.legal_entity_id
        AND control.status = 'activating'
        AND control.source_engine = 'postgresql'
        AND control.target_engine = 'tigerbeetle'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'legal_entity_accounting_engine_activation_gate_check',
        MESSAGE = 'TigerBeetle activation requires an approved activating cutover control';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER legal_entity_accounting_engine_activation_gate
BEFORE UPDATE OF financial_engine ON accounting.legal_entity_accounting_configurations
FOR EACH ROW EXECUTE FUNCTION accounting.prevent_uncontrolled_financial_engine_activation();

-- owner: accounting
-- reviewed: 2026-08-17
-- rationale: allow a reconciled projection to be quarantined without mutating its accepted engine fact

CREATE OR REPLACE FUNCTION accounting.enforce_financial_operation_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
      OLD.legal_entity_id IS DISTINCT FROM NEW.legal_entity_id OR
      OLD.period_id IS DISTINCT FROM NEW.period_id OR
      OLD.operation_id IS DISTINCT FROM NEW.operation_id OR
      OLD.operation_type IS DISTINCT FROM NEW.operation_type OR
      OLD.engine IS DISTINCT FROM NEW.engine OR
      OLD.engine_verified IS DISTINCT FROM NEW.engine_verified OR
      OLD.journal_id IS DISTINCT FROM NEW.journal_id OR
      OLD.source_journal_id IS DISTINCT FROM NEW.source_journal_id OR
      OLD.reference IS DISTINCT FROM NEW.reference OR
      OLD.currency IS DISTINCT FROM NEW.currency OR
      OLD.mapping_version IS DISTINCT FROM NEW.mapping_version OR
      OLD.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint OR
      OLD.actor_principal_id IS DISTINCT FROM NEW.actor_principal_id OR
      OLD.actor_session_id IS DISTINCT FROM NEW.actor_session_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'financial_operations_immutable_fields_check',
        MESSAGE = 'financial operation intent fields are immutable';
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
      (OLD.status = 'intent' AND NEW.status IN ('submitted', 'manual_recovery')) OR
      (OLD.status = 'submitted' AND NEW.status IN ('accepted', 'reconciled', 'rejected', 'unknown', 'manual_recovery')) OR
      (OLD.status = 'unknown' AND NEW.status IN ('submitted', 'manual_recovery')) OR
      (OLD.status = 'accepted' AND NEW.status IN ('reconciled', 'manual_recovery')) OR
      (OLD.status = 'reconciled' AND NEW.status = 'manual_recovery')
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
