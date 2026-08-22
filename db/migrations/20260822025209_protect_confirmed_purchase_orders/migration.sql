-- owner: procurement
-- reviewed: 2026-08-22
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: enforce the ADR-0045 PurchaseOrder transition, immutability, and total invariants

CREATE OR REPLACE FUNCTION procurement.protect_purchase_order_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, procurement
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status::text IS DISTINCT FROM NEW.status::text
    AND NOT (OLD.status::text = 'draft' AND NEW.status::text = 'confirmed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_state_transition_check',
      MESSAGE = 'invalid purchase order state transition';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status::text = 'confirmed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_confirmed_immutable',
      MESSAGE = 'confirmed purchase orders are immutable';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status::text = 'confirmed' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'purchase_order_confirmed_immutable',
        MESSAGE = 'confirmed purchase orders are immutable';
    END IF;

    IF OLD.status::text = 'draft' AND NEW.status::text = 'confirmed' AND (
      NEW.id IS DISTINCT FROM OLD.id OR
      NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
      NEW.supplier_account_id IS DISTINCT FROM OLD.supplier_account_id OR
      NEW.total IS DISTINCT FROM OLD.total OR
      NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'purchase_order_confirmed_immutable',
        MESSAGE = 'purchase order facts cannot change during confirmation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION procurement.enforce_purchase_order_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, procurement
AS $$
BEGIN
  IF NEW.status::text <> 'draft' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_state_transition_check',
      MESSAGE = 'purchase orders must start in draft state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.protect_confirmed_purchase_order_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, procurement
AS $$
DECLARE
  order_status text;
BEGIN
  SELECT status::text
  INTO order_status
  FROM procurement.purchase_orders
  WHERE tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
    AND id = CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END
  FOR UPDATE;

  IF order_status = 'confirmed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_confirmed_lines_immutable',
      MESSAGE = 'confirmed purchase order lines are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
  ) THEN
    SELECT status::text
    INTO order_status
    FROM procurement.purchase_orders
    WHERE tenant_id = OLD.tenant_id AND id = OLD.purchase_order_id
    FOR UPDATE;

    IF order_status = 'confirmed' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'purchase_order_confirmed_lines_immutable',
        MESSAGE = 'confirmed purchase order lines are immutable';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION procurement.assert_confirmed_purchase_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, procurement
AS $$
DECLARE
  affected_tenant_id uuid;
  affected_order_id uuid;
  order_status text;
  stored_total numeric;
  line_count bigint;
  derived_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'purchase_orders' THEN
    affected_tenant_id := NEW.tenant_id;
    affected_order_id := NEW.id;
    order_status := NEW.status::text;
    stored_total := NEW.total;
  ELSE
    affected_tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
    affected_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;
    SELECT status::text, total
    INTO order_status, stored_total
    FROM procurement.purchase_orders
    WHERE tenant_id = affected_tenant_id AND id = affected_order_id;
  END IF;

  IF order_status IS NULL OR order_status <> 'confirmed' THEN
    RETURN NULL;
  END IF;

  SELECT count(*), coalesce(sum(quantity::numeric * unit_price), 0)
  INTO line_count, derived_total
  FROM procurement.purchase_order_lines
  WHERE tenant_id = affected_tenant_id AND purchase_order_id = affected_order_id;

  IF line_count < 1 OR stored_total IS NULL OR stored_total <> derived_total THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_confirmed_total_consistent',
      MESSAGE = 'confirmed purchase order total must match its lines';
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER purchase_order_initial_state_trigger
BEFORE INSERT ON procurement.purchase_orders
FOR EACH ROW EXECUTE FUNCTION procurement.enforce_purchase_order_initial_state();

CREATE TRIGGER purchase_order_mutation_trigger
BEFORE UPDATE OR DELETE ON procurement.purchase_orders
FOR EACH ROW EXECUTE FUNCTION procurement.protect_purchase_order_mutation();

CREATE TRIGGER purchase_order_line_mutation_trigger
BEFORE INSERT OR UPDATE OR DELETE ON procurement.purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION procurement.protect_confirmed_purchase_order_line();

CREATE CONSTRAINT TRIGGER purchase_order_total_trigger
AFTER INSERT OR UPDATE ON procurement.purchase_orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION procurement.assert_confirmed_purchase_order_total();

CREATE CONSTRAINT TRIGGER purchase_order_line_total_trigger
AFTER INSERT OR UPDATE OR DELETE ON procurement.purchase_order_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION procurement.assert_confirmed_purchase_order_total();
