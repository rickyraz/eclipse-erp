-- owner: accounting
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: widen exact ERP money columns above the 500-trillion target while preserving a four-digit database headroom boundary
-- affected-owners: sales

ALTER TABLE "accounting"."journal_lines" ALTER COLUMN "debit" SET DATA TYPE numeric(24,2) USING "debit"::numeric(24,2);--> statement-breakpoint
ALTER TABLE "accounting"."journal_lines" ALTER COLUMN "credit" SET DATA TYPE numeric(24,2) USING "credit"::numeric(24,2);--> statement-breakpoint
ALTER TABLE "sales"."order_lines" ALTER COLUMN "unit_price" SET DATA TYPE numeric(24,2) USING "unit_price"::numeric(24,2);--> statement-breakpoint
ALTER TABLE "sales"."orders" ALTER COLUMN "total" SET DATA TYPE numeric(24,2) USING "total"::numeric(24,2);--> statement-breakpoint
ALTER TABLE "sales"."quotations" ALTER COLUMN "total" SET DATA TYPE numeric(24,2) USING "total"::numeric(24,2);