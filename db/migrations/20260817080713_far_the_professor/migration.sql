-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: bind correcting financial operations to their posted source journal

ALTER TABLE "accounting"."financial_operations" ADD COLUMN "source_journal_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_tenant_source_journal_key" UNIQUE("tenant_id","source_journal_id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_source_journal_fkey" FOREIGN KEY ("tenant_id","source_journal_id") REFERENCES "accounting"."journal_entries"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_operation_type_check" CHECK (("operation_type" = 'journal_post' and "source_journal_id" is null) or
      ("operation_type" = 'journal_reverse' and "source_journal_id" is not null));