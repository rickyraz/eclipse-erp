-- owner: accounting
-- reviewed: 2026-08-16
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_reversal_state_check" CHECK (("status" in ('draft', 'posted') and "reverses_entry_id" is null) or
      ("status" = 'reversed' and "reverses_entry_id" is not null));