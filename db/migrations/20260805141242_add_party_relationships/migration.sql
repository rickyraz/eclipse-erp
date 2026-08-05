-- owners: party
-- reviewed: 2026-08-05
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TABLE "party"."party_relationships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"kind" "party"."party_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_relationships_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "party_relationships_tenant_party_legal_entity_kind_key" UNIQUE("tenant_id","party_id","legal_entity_id","kind")
);
--> statement-breakpoint
ALTER TABLE "party"."party_relationships" ADD CONSTRAINT "party_relationships_tenant_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."party_relationships" ADD CONSTRAINT "party_relationships_tenant_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."party_relationships" ADD CONSTRAINT "party_relationships_tenant_party_role_fkey" FOREIGN KEY ("tenant_id","party_id","kind") REFERENCES "party"."party_roles"("tenant_id","party_id","role") ON DELETE CASCADE;
