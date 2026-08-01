-- owner: accounting
-- reviewed: 2026-08-01
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom

create or replace function accounting.assert_balanced_journal(target_entry_id uuid)
returns void
language plpgsql
as $$
declare
  line_count bigint;
  total_debit numeric(14, 2);
  total_credit numeric(14, 2);
begin
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into line_count, total_debit, total_credit
    from accounting.journal_lines
    where entry_id = target_entry_id;

  if line_count < 2 or total_debit <> total_credit then
    raise exception 'journal entry must contain at least two balanced lines'
      using errcode = '23514', constraint = 'journal_entries_balanced_check';
  end if;
end;
$$;

--> statement-breakpoint

create or replace function accounting.check_posted_journal_entry()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('posted', 'reversed') then
    perform accounting.assert_balanced_journal(new.id);
  end if;
  return new;
end;
$$;

--> statement-breakpoint

create constraint trigger journal_entries_balanced_trigger
  after insert or update of status on accounting.journal_entries
  deferrable initially deferred
  for each row execute function accounting.check_posted_journal_entry();

--> statement-breakpoint

create or replace function accounting.protect_posted_journal()
returns trigger
language plpgsql
as $$
declare
  entry_status accounting.journal_status;
begin
  select status into entry_status
  from accounting.journal_entries
  where id = coalesce(old.entry_id, new.entry_id);

  if entry_status in ('posted', 'reversed') then
    raise exception 'posted journal lines are immutable'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

--> statement-breakpoint

create trigger journal_lines_immutable_trigger
  before insert or update or delete on accounting.journal_lines
  for each row execute function accounting.protect_posted_journal();

--> statement-breakpoint

create or replace function accounting.protect_posted_entry()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('posted', 'reversed') then
    raise exception 'posted journal entries are immutable'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

--> statement-breakpoint

create trigger journal_entries_immutable_trigger
  before update or delete on accounting.journal_entries
  for each row execute function accounting.protect_posted_entry();
