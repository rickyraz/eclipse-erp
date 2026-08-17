-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: close posted-line reparenting and protect deferred journal balance checks

CREATE OR REPLACE FUNCTION accounting.assert_balanced_journal(target_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
DECLARE
  line_count bigint;
  total_debit numeric;
  total_credit numeric;
BEGIN
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
  INTO line_count, total_debit, total_credit
  FROM accounting.journal_lines
  WHERE entry_id = target_entry_id;

  IF line_count < 2 OR total_debit <> total_credit THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'journal_entries_balanced_check',
      MESSAGE = 'journal entry must contain at least two balanced lines';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.check_posted_journal_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF NEW.status::text IN ('posted', 'reversed') THEN
    PERFORM accounting.assert_balanced_journal(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.protect_posted_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
DECLARE
  entry_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status::text
    INTO entry_status
    FROM accounting.journal_entries
    WHERE id = OLD.entry_id;

    IF entry_status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        CONSTRAINT = 'accounting_posted_journal_lines_immutable',
        MESSAGE = 'posted journal lines are immutable';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT status::text
    INTO entry_status
    FROM accounting.journal_entries
    WHERE id = NEW.entry_id;

    IF entry_status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        CONSTRAINT = 'accounting_posted_journal_lines_immutable',
        MESSAGE = 'posted journal lines are immutable';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION accounting.protect_posted_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, accounting
AS $$
BEGIN
  IF OLD.status::text IN ('posted', 'reversed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'accounting_posted_journal_immutable',
      MESSAGE = 'posted journal entries are immutable';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
