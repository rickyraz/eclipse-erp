-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: serialize posted-line mutations with parent journal state changes

CREATE OR REPLACE FUNCTION accounting.protect_posted_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
DECLARE
  old_status text;
  new_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status::text
    INTO new_status
    FROM accounting.journal_entries
    WHERE id = NEW.entry_id
    FOR UPDATE;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT status::text
    INTO old_status
    FROM accounting.journal_entries
    WHERE id = OLD.entry_id
    FOR UPDATE;
  ELSIF OLD.entry_id = NEW.entry_id THEN
    SELECT status::text
    INTO old_status
    FROM accounting.journal_entries
    WHERE id = OLD.entry_id
    FOR UPDATE;
    new_status := old_status;
  ELSIF OLD.entry_id < NEW.entry_id THEN
    SELECT status::text
    INTO old_status
    FROM accounting.journal_entries
    WHERE id = OLD.entry_id
    FOR UPDATE;
    SELECT status::text
    INTO new_status
    FROM accounting.journal_entries
    WHERE id = NEW.entry_id
    FOR UPDATE;
  ELSE
    SELECT status::text
    INTO new_status
    FROM accounting.journal_entries
    WHERE id = NEW.entry_id
    FOR UPDATE;
    SELECT status::text
    INTO old_status
    FROM accounting.journal_entries
    WHERE id = OLD.entry_id
    FOR UPDATE;
  END IF;

  IF old_status IN ('posted', 'reversed') OR new_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'accounting_posted_journal_lines_immutable',
      MESSAGE = 'posted journal lines are immutable';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
