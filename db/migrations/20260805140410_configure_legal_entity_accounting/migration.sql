-- owners: accounting, auth, party
-- reviewed: 2026-08-05
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TABLE "accounting"."legal_entity_accounting_configurations" (
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"base_currency" text NOT NULL,
	"decimal_precision" smallint NOT NULL,
	"fiscal_year_start_month" smallint NOT NULL,
	"posting_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entity_accounting_configurations_pkey" PRIMARY KEY("tenant_id","legal_entity_id"),
	CONSTRAINT "legal_entity_accounting_configurations_currency_check" CHECK ("base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "legal_entity_accounting_configurations_precision_check" CHECK ("decimal_precision" between 0 and 18),
	CONSTRAINT "legal_entity_accounting_configurations_fiscal_month_check" CHECK ("fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "accounting"."legal_entity_accounting_configurations" ADD CONSTRAINT "legal_entity_accounting_configurations_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."legal_entity_accounting_configurations" ADD CONSTRAINT "legal_entity_accounting_configurations_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");
