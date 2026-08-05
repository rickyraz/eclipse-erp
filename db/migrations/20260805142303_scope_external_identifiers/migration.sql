-- owners: party
-- reviewed: 2026-08-05
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "party"."party_identifiers" DROP CONSTRAINT "party_identifiers_tenant_scheme_scope_value_key";--> statement-breakpoint
ALTER TABLE "party"."party_identifiers" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "party"."party_identifiers" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "party_identifiers_tenant_provider_scope_value_uq" ON "party"."party_identifiers" ("tenant_id","provider","scheme","scope","value") WHERE "legal_entity_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "party_identifiers_tenant_provider_entity_scope_value_uq" ON "party"."party_identifiers" ("tenant_id","provider","legal_entity_id","scheme","scope","value") WHERE "legal_entity_id" is not null;--> statement-breakpoint
ALTER TABLE "party"."party_identifiers" ADD CONSTRAINT "party_identifiers_tenant_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id") ON DELETE CASCADE;
