-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: route legal-entity accounting and durable financial operations through an explicit financial engine

CREATE TYPE "accounting"."financial_engine" AS ENUM('postgresql', 'tigerbeetle');--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD COLUMN "engine" "accounting"."financial_engine" DEFAULT 'tigerbeetle'::"accounting"."financial_engine" NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting"."legal_entity_accounting_configurations" ADD COLUMN "financial_engine" "accounting"."financial_engine" DEFAULT 'postgresql'::"accounting"."financial_engine" NOT NULL;--> statement-breakpoint
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
      (OLD.status = 'accepted' AND NEW.status IN ('reconciled', 'manual_recovery'))
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'financial_operations_state_transition_check',
        MESSAGE = 'invalid financial operation state transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounting.enforce_financial_transfer_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
      OLD.operation_id IS DISTINCT FROM NEW.operation_id OR
      OLD.position IS DISTINCT FROM NEW.position OR
      OLD.debit_account_id IS DISTINCT FROM NEW.debit_account_id OR
      OLD.credit_account_id IS DISTINCT FROM NEW.credit_account_id OR
      OLD.amount_minor IS DISTINCT FROM NEW.amount_minor OR
      (OLD.engine_transfer_id IS NOT NULL AND
        OLD.engine_transfer_id IS DISTINCT FROM NEW.engine_transfer_id) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'financial_operation_transfers_immutable_fields_check',
        MESSAGE = 'financial operation transfer identity is immutable';
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
      (OLD.status = 'unresolved' AND NEW.status IN ('accepted', 'rejected', 'manual_recovery')) OR
      OLD.status = NEW.status
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'financial_operation_transfers_state_transition_check',
        MESSAGE = 'invalid financial operation transfer state transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER financial_operation_transfers_transition
BEFORE UPDATE ON accounting.financial_operation_transfers
FOR EACH ROW EXECUTE FUNCTION accounting.enforce_financial_transfer_transition();--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounting.prevent_financial_engine_downgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF OLD.financial_engine = 'tigerbeetle' AND NEW.financial_engine <> OLD.financial_engine THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'legal_entity_accounting_engine_downgrade_check',
      MESSAGE = 'a TigerBeetle legal entity cannot be routed back to PostgreSQL';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER legal_entity_accounting_engine_downgrade
BEFORE UPDATE OF financial_engine ON accounting.legal_entity_accounting_configurations
FOR EACH ROW EXECUTE FUNCTION accounting.prevent_financial_engine_downgrade();