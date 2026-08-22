-- owner: procurement
-- reviewed: 2026-08-22
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: add the first Procurement-owned SupplierAccount boundary over Party supplier relationships

CREATE SCHEMA "procurement";
--> statement-breakpoint
CREATE TABLE "procurement"."supplier_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"supplier_relationship_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_accounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_accounts_tenant_supplier_relationship_key" UNIQUE("tenant_id","supplier_relationship_id")
);
--> statement-breakpoint
ALTER TABLE "procurement"."supplier_accounts" ADD CONSTRAINT "supplier_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "procurement"."supplier_accounts" ADD CONSTRAINT "supplier_accounts_tenant_supplier_relationship_fkey" FOREIGN KEY ("tenant_id","supplier_relationship_id") REFERENCES "party"."party_relationships"("tenant_id","id");