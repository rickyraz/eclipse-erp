-- owner: accounting
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: allow accepted financial transfers to be fenced during projection mismatch quarantine

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
      (OLD.status = 'accepted' AND NEW.status = 'manual_recovery') OR
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
$$;
