-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: enforce Accounting period and journal state transitions at the database boundary

CREATE OR REPLACE FUNCTION accounting.enforce_period_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF NEW.status::text <> 'open' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'accounting_period_state_transition_check',
      MESSAGE = 'accounting periods must start open';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.enforce_period_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF OLD.status::text = 'open'
    AND NEW.status::text NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'accounting_period_state_transition_check',
      MESSAGE = 'invalid accounting period state transition';
  ELSIF OLD.status::text = 'closed'
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'accounting_period_state_transition_check',
      MESSAGE = 'invalid accounting period state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.enforce_journal_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF NEW.status::text <> 'draft' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'accounting_journal_state_transition_check',
      MESSAGE = 'journal entries must start in draft state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.enforce_journal_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF OLD.status::text = 'draft'
    AND NEW.status::text NOT IN ('draft', 'posted', 'reversed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'accounting_journal_state_transition_check',
      MESSAGE = 'invalid journal entry state transition';
  ELSIF OLD.status::text IN ('posted', 'reversed')
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'accounting_journal_state_transition_check',
      MESSAGE = 'invalid journal entry state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounting_period_initial_state_trigger
BEFORE INSERT ON accounting.accounting_periods
FOR EACH ROW EXECUTE FUNCTION accounting.enforce_period_initial_state();

CREATE TRIGGER accounting_period_state_transition_trigger
BEFORE UPDATE OF status ON accounting.accounting_periods
FOR EACH ROW EXECUTE FUNCTION accounting.enforce_period_state_transition();

CREATE TRIGGER accounting_journal_initial_state_trigger
BEFORE INSERT ON accounting.journal_entries
FOR EACH ROW EXECUTE FUNCTION accounting.enforce_journal_initial_state();

CREATE TRIGGER accounting_journal_state_transition_trigger
BEFORE UPDATE OF status ON accounting.journal_entries
FOR EACH ROW EXECUTE FUNCTION accounting.enforce_journal_state_transition();
