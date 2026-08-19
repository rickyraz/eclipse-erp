-- owner: messaging
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep event type, version, and idempotency identity stable alongside the outbox occurrence identity

CREATE OR REPLACE FUNCTION messaging.enforce_event_outbox_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, messaging
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
    OLD.id IS DISTINCT FROM NEW.id OR
    OLD.event_type IS DISTINCT FROM NEW.event_type OR
    OLD.event_version IS DISTINCT FROM NEW.event_version OR
    OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'event_outbox_immutable_identity_check',
      MESSAGE = 'event outbox delivery identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER event_outbox_identity_immutable ON messaging.event_outbox;

CREATE TRIGGER event_outbox_identity_immutable
BEFORE UPDATE OF tenant_id, id, event_type, event_version, idempotency_key
ON messaging.event_outbox
FOR EACH ROW EXECUTE FUNCTION messaging.enforce_event_outbox_identity();
