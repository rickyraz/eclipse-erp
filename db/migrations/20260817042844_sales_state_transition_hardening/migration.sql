-- owner: sales
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: enforce the bounded Sales order state machine at the database boundary

CREATE OR REPLACE FUNCTION sales.reject_terminal_order_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sales
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status::text IS DISTINCT FROM NEW.status::text
    AND NOT (
      (OLD.status::text = 'draft' AND NEW.status::text = 'confirmed') OR
      (OLD.status::text = 'confirmed' AND NEW.status::text = 'cancelled')
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_order_state_transition_check',
      MESSAGE = 'invalid sales order state transition';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status::text IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_terminal_order_immutable',
      MESSAGE = 'terminal sales orders are immutable';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status::text = 'cancelled' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'sales_terminal_order_immutable',
        MESSAGE = 'terminal sales orders are immutable';
    END IF;

    IF OLD.status::text = 'confirmed' THEN
      IF NEW.status::text <> 'cancelled' OR
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
        NEW.quotation_id IS DISTINCT FROM OLD.quotation_id OR
        NEW.confirmation_idempotency_key IS DISTINCT FROM OLD.confirmation_idempotency_key OR
        NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
        NEW.total IS DISTINCT FROM OLD.total OR
        NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'sales_terminal_order_immutable',
          MESSAGE = 'confirmed sales orders only support cancellation';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION sales.enforce_order_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sales
AS $$
BEGIN
  IF NEW.status::text <> 'draft' THEN
    -- Let the existing metadata check report malformed confirmed rows first.
    IF NEW.status::text = 'confirmed'
      AND (NEW.confirmation_idempotency_key IS NULL OR NEW.confirmed_at IS NULL) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_order_state_transition_check',
      MESSAGE = 'sales orders must start in draft state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_order_initial_state_trigger
BEFORE INSERT ON sales.orders
FOR EACH ROW EXECUTE FUNCTION sales.enforce_order_initial_state();
