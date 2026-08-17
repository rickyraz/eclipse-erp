-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: allow authorization revocation to quarantine an unsubmitted financial intent

CREATE OR REPLACE FUNCTION accounting.enforce_financial_operation_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (
      (OLD.status = 'intent' AND NEW.status IN ('submitted', 'manual_recovery')) OR
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
