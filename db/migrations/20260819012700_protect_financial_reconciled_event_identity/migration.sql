-- owner: accounting
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep the persisted reconciliation event occurrence identity immutable across projection rebuilds

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
      OLD.actor_session_id IS DISTINCT FROM NEW.actor_session_id OR
      OLD.reconciled_event_id IS DISTINCT FROM NEW.reconciled_event_id THEN
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
