-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: bind each durable financial operation to the fiscal period whose policy admitted it

ALTER TABLE "accounting"."financial_operations" ADD COLUMN "period_id" uuid;
--> statement-breakpoint
UPDATE "accounting"."financial_operations" operation
SET "period_id" = period.id
FROM "accounting"."accounting_periods" period
WHERE operation."period_id" IS NULL
  AND period.tenant_id = operation.tenant_id
  AND period.legal_entity_id = operation.legal_entity_id
  AND period.starts_on <= operation.scheduled_at::date
  AND period.ends_on >= operation.scheduled_at::date;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "accounting"."financial_operations"
    WHERE "period_id" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'financial_operations_period_backfill_check',
      MESSAGE = 'financial operations require an owning fiscal period before activation';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ALTER COLUMN "period_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounting"."financial_operations" ADD CONSTRAINT "financial_operations_period_fkey" FOREIGN KEY ("tenant_id","period_id") REFERENCES "accounting"."accounting_periods"("tenant_id","id");