-- owner: messaging
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep durable event occurrence and tenant identities stable for idempotent replay and receipts

CREATE OR REPLACE FUNCTION messaging.enforce_event_outbox_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, messaging
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
    OLD.id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'event_outbox_immutable_identity_check',
      MESSAGE = 'event outbox tenant and occurrence identities are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_outbox_identity_immutable
BEFORE UPDATE OF tenant_id, id ON messaging.event_outbox
FOR EACH ROW EXECUTE FUNCTION messaging.enforce_event_outbox_identity();
