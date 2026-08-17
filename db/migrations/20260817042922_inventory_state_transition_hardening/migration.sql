-- owner: inventory
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: enforce reservation and stock-transfer lifecycle transitions at the database boundary

CREATE OR REPLACE FUNCTION inventory.enforce_reservation_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventory
AS $$
BEGIN
  IF NEW.status::text <> 'active' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_reservation_state_transition_check',
      MESSAGE = 'reservations must start in active state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.enforce_reservation_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventory
AS $$
BEGIN
  IF OLD.status::text = 'active'
    AND NEW.status::text NOT IN ('active', 'released', 'fulfilled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_reservation_state_transition_check',
      MESSAGE = 'invalid reservation state transition';
  ELSIF OLD.status::text IN ('released', 'fulfilled')
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_reservation_state_transition_check',
      MESSAGE = 'invalid reservation state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.enforce_stock_transfer_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventory
AS $$
BEGIN
  IF NEW.status::text <> 'draft' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_stock_transfer_state_transition_check',
      MESSAGE = 'stock transfers must start in draft state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.enforce_stock_transfer_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventory
AS $$
BEGIN
  IF OLD.status::text = 'draft'
    AND NEW.status::text NOT IN ('draft', 'confirmed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_stock_transfer_state_transition_check',
      MESSAGE = 'invalid stock transfer state transition';
  ELSIF OLD.status::text = 'confirmed'
    AND NEW.status::text NOT IN ('confirmed', 'completed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_stock_transfer_state_transition_check',
      MESSAGE = 'invalid stock transfer state transition';
  ELSIF OLD.status::text = 'completed'
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_stock_transfer_state_transition_check',
      MESSAGE = 'invalid stock transfer state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_reservation_initial_state_trigger
BEFORE INSERT ON inventory.reservations
FOR EACH ROW EXECUTE FUNCTION inventory.enforce_reservation_initial_state();

CREATE TRIGGER inventory_reservation_state_transition_trigger
BEFORE UPDATE OF status ON inventory.reservations
FOR EACH ROW EXECUTE FUNCTION inventory.enforce_reservation_state_transition();

CREATE TRIGGER inventory_stock_transfer_initial_state_trigger
BEFORE INSERT ON inventory.stock_transfers
FOR EACH ROW EXECUTE FUNCTION inventory.enforce_stock_transfer_initial_state();

CREATE TRIGGER inventory_stock_transfer_state_transition_trigger
BEFORE UPDATE OF status ON inventory.stock_transfers
FOR EACH ROW EXECUTE FUNCTION inventory.enforce_stock_transfer_state_transition();
