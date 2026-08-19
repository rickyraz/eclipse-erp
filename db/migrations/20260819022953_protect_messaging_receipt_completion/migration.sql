-- owner: messaging
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep the durable consumer completion timestamp stable for duplicate replay

CREATE OR REPLACE FUNCTION messaging.enforce_consumer_receipt_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, messaging
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
    OLD.consumer_id IS DISTINCT FROM NEW.consumer_id OR
    OLD.event_id IS DISTINCT FROM NEW.event_id OR
    OLD.event_type IS DISTINCT FROM NEW.event_type OR
    OLD.event_version IS DISTINCT FROM NEW.event_version OR
    OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR
    OLD.completed_at IS DISTINCT FROM NEW.completed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'consumer_receipts_immutable_identity_check',
      MESSAGE = 'consumer receipt identity and completion are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER consumer_receipts_identity_immutable ON messaging.consumer_receipts;

CREATE TRIGGER consumer_receipts_identity_immutable
BEFORE UPDATE OF tenant_id, consumer_id, event_id, event_type, event_version, idempotency_key,
  completed_at ON messaging.consumer_receipts
FOR EACH ROW EXECUTE FUNCTION messaging.enforce_consumer_receipt_identity();
