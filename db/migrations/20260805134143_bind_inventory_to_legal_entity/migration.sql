-- owners: inventory, party
-- reviewed: 2026-08-05
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "inventory"."stock_transfers" RENAME CONSTRAINT "stock_transfers_source_warehouse_fkey" TO "stock_transfers_source_warehouse_scope_fkey";--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfers" RENAME CONSTRAINT "stock_transfers_destination_warehouse_fkey" TO "stock_transfers_destination_warehouse_scope_fkey";--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfers" ADD COLUMN "legal_entity_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."warehouses" ADD COLUMN "legal_entity_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."warehouses" ADD COLUMN "primary_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "party"."branches" ADD CONSTRAINT "branches_tenant_legal_entity_id_key" UNIQUE("tenant_id","legal_entity_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."warehouses" ADD CONSTRAINT "warehouses_tenant_legal_entity_id_key" UNIQUE("tenant_id","legal_entity_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."warehouses" ADD CONSTRAINT "warehouses_tenant_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."warehouses" ADD CONSTRAINT "warehouses_tenant_legal_entity_branch_fkey" FOREIGN KEY ("tenant_id","legal_entity_id","primary_branch_id") REFERENCES "party"."branches"("tenant_id","legal_entity_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfers" DROP CONSTRAINT "stock_transfers_source_warehouse_scope_fkey", ADD CONSTRAINT "stock_transfers_source_warehouse_scope_fkey" FOREIGN KEY ("tenant_id","legal_entity_id","source_warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","legal_entity_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfers" DROP CONSTRAINT "stock_transfers_destination_warehouse_scope_fkey", ADD CONSTRAINT "stock_transfers_destination_warehouse_scope_fkey" FOREIGN KEY ("tenant_id","legal_entity_id","destination_warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","legal_entity_id","id");
