-- owner: inventory
-- reviewed: 2026-08-03
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TYPE "inventory"."transfer_status" AS ENUM('draft', 'confirmed', 'completed');--> statement-breakpoint
CREATE TABLE "inventory"."stock_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfer_lines_tenant_transfer_item_key" UNIQUE("tenant_id","transfer_id","item_id"),
	CONSTRAINT "stock_transfer_lines_quantity_check" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"source_warehouse_id" uuid NOT NULL,
	"destination_warehouse_id" uuid NOT NULL,
	"status" "inventory"."transfer_status" DEFAULT 'draft'::"inventory"."transfer_status" NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_transfers_distinct_warehouses_check" CHECK ("source_warehouse_id" <> "destination_warehouse_id"),
	CONSTRAINT "stock_transfers_state_dates_check" CHECK (("status" = 'draft' and "confirmed_at" is null and "completed_at" is null) or
      ("status" = 'confirmed' and "confirmed_at" is not null and "completed_at" is null) or
      ("status" = 'completed' and "confirmed_at" is not null and "completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_fkey" FOREIGN KEY ("tenant_id","transfer_id") REFERENCES "inventory"."stock_transfers"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_fkey" FOREIGN KEY ("tenant_id","item_id") REFERENCES "inventory"."items"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfers" ADD CONSTRAINT "stock_transfers_source_warehouse_fkey" FOREIGN KEY ("tenant_id","source_warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfers" ADD CONSTRAINT "stock_transfers_destination_warehouse_fkey" FOREIGN KEY ("tenant_id","destination_warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","id");