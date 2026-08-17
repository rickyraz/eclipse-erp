-- owner: sales
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: protect terminal order facts and validate derived totals at commit

CREATE OR REPLACE FUNCTION sales.reject_terminal_order_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sales
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION sales.reject_terminal_order_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sales
AS $$
DECLARE
  order_status text;
BEGIN
  SELECT status::text
  INTO order_status
  FROM sales.orders
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  IF order_status IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_terminal_order_lines_immutable',
      MESSAGE = 'terminal sales order lines are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id THEN
    SELECT status::text
    INTO order_status
    FROM sales.orders
    WHERE id = OLD.order_id;

    IF order_status IN ('confirmed', 'cancelled') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'sales_terminal_order_lines_immutable',
        MESSAGE = 'terminal sales order lines are immutable';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION sales.assert_terminal_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sales
AS $$
DECLARE
  affected_order_id uuid;
  order_status text;
  stored_total numeric;
  line_count bigint;
  derived_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    affected_order_id := NEW.id;
    order_status := NEW.status::text;
    stored_total := NEW.total;
  ELSE
    affected_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
    SELECT status::text, total
    INTO order_status, stored_total
    FROM sales.orders
    WHERE id = affected_order_id;
  END IF;

  IF order_status IS NULL OR order_status NOT IN ('confirmed', 'cancelled') THEN
    RETURN NULL;
  END IF;

  SELECT count(*), coalesce(sum(quantity::numeric * unit_price), 0)
  INTO line_count, derived_total
  FROM sales.order_lines AS lines
  WHERE lines.order_id = affected_order_id;

  IF line_count < 1 OR stored_total IS NULL OR stored_total <> derived_total THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_terminal_order_total_consistent',
      MESSAGE = 'terminal sales order total must match its lines';
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER sales_terminal_order_mutation_trigger
BEFORE UPDATE OR DELETE ON sales.orders
FOR EACH ROW EXECUTE FUNCTION sales.reject_terminal_order_mutation();

CREATE TRIGGER sales_terminal_order_line_mutation_trigger
BEFORE INSERT OR UPDATE OR DELETE ON sales.order_lines
FOR EACH ROW EXECUTE FUNCTION sales.reject_terminal_order_line_mutation();

CREATE CONSTRAINT TRIGGER sales_terminal_order_total_trigger
AFTER INSERT OR UPDATE ON sales.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sales.assert_terminal_order_total();

CREATE CONSTRAINT TRIGGER sales_terminal_order_line_total_trigger
AFTER INSERT OR UPDATE OR DELETE ON sales.order_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sales.assert_terminal_order_total();
