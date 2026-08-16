-- owner: accounting
-- reviewed: 2026-08-16
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_reference_check" CHECK ("reference" ~ '[^[:space:]]');