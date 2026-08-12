-- owner: inventory
-- reviewed: 2026-08-12
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "inventory"."items" ADD COLUMN "unit_of_measure" text DEFAULT 'EA' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD COLUMN "unit_of_measure" text;--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD CONSTRAINT "movements_tenant_idempotency_key" UNIQUE("tenant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_unit_of_measure_check" CHECK ("unit_of_measure" <> '' and "unit_of_measure" = upper(trim("unit_of_measure")));--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD CONSTRAINT "movements_correction_metadata_check" CHECK (("idempotency_key" is null and "unit_of_measure" is null and "reason" is null) or
      ("idempotency_key" is not null and "unit_of_measure" is not null and "reason" is not null and "reason" <> '' and "kind" in ('receipt', 'issue')));