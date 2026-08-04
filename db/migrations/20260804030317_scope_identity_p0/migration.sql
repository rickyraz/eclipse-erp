-- owners: auth, party
-- reviewed: 2026-08-04
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TABLE "party"."branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "branches_tenant_legal_entity_name_key" UNIQUE("tenant_id","legal_entity_id","name")
);
--> statement-breakpoint
CREATE TABLE "party"."legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"organization_party_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entities_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "legal_entities_tenant_organization_party_key" UNIQUE("tenant_id","organization_party_id")
);
--> statement-breakpoint
ALTER TABLE "auth"."tenants" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "party"."branches" ADD CONSTRAINT "branches_tenant_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "party"."legal_entities" ADD CONSTRAINT "legal_entities_tenant_organization_party_fkey" FOREIGN KEY ("tenant_id","organization_party_id") REFERENCES "party"."parties"("tenant_id","id");