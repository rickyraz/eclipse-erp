-- owners: party
-- reviewed: 2026-08-06
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TABLE "party"."identity_party_representations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_party_representations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "identity_party_representations_tenant_identity_party_kind_key" UNIQUE("tenant_id","identity_id","party_id","kind")
);
--> statement-breakpoint
ALTER TABLE "party"."branches" ADD COLUMN "local_tax_registration" text;--> statement-breakpoint
ALTER TABLE "party"."branches" ADD COLUMN "dedicated_journal_code" text;--> statement-breakpoint
ALTER TABLE "party"."identity_party_representations" ADD CONSTRAINT "identity_party_representations_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."identity_party_representations" ADD CONSTRAINT "identity_party_representations_identity_fkey" FOREIGN KEY ("identity_id") REFERENCES "identity"."identities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."identity_party_representations" ADD CONSTRAINT "identity_party_representations_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id") ON DELETE CASCADE;