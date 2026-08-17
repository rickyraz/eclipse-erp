-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: enforce source-journal semantics for revenue and journal operation types

ALTER TABLE "accounting"."financial_operations" DROP CONSTRAINT "financial_operations_operation_type_check", ADD CONSTRAINT "financial_operations_operation_type_check" CHECK (("operation_type" in ('journal_post', 'revenue_post') and
      "source_journal_id" is null) or
      ("operation_type" = 'journal_reverse' and "source_journal_id" is not null));