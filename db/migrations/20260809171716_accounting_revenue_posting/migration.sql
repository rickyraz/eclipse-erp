-- owner: accounting
-- reviewed: 2026-08-09
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TYPE "accounting"."accounting_period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "accounting"."accounting_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "accounting"."accounting_period_status" DEFAULT 'open'::"accounting"."accounting_period_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_periods_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "accounting_periods_dates_check" CHECK ("starts_on" <= "ends_on")
);
--> statement-breakpoint
CREATE TABLE "accounting"."revenue_posting_profiles" (
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"receivable_account_id" uuid NOT NULL,
	"revenue_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_posting_profiles_pkey" PRIMARY KEY("tenant_id","legal_entity_id"),
	CONSTRAINT "revenue_posting_profiles_accounts_different_check" CHECK ("receivable_account_id" <> "revenue_account_id")
);
--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "reverses_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting"."accounting_periods" ADD CONSTRAINT "accounting_periods_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."accounting_periods" ADD CONSTRAINT "accounting_periods_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_fkey" FOREIGN KEY ("tenant_id","reverses_entry_id") REFERENCES "accounting"."journal_entries"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."revenue_posting_profiles" ADD CONSTRAINT "revenue_posting_profiles_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."revenue_posting_profiles" ADD CONSTRAINT "revenue_posting_profiles_receivable_account_fkey" FOREIGN KEY ("tenant_id","receivable_account_id") REFERENCES "accounting"."accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."revenue_posting_profiles" ADD CONSTRAINT "revenue_posting_profiles_revenue_account_fkey" FOREIGN KEY ("tenant_id","revenue_account_id") REFERENCES "accounting"."accounts"("tenant_id","id");