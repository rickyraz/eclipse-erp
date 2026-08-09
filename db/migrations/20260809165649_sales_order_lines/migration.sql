-- owner: sales
-- reviewed: 2026-08-09
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TABLE "sales"."order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price" numeric(14,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_quantity_check" CHECK ("quantity" > 0),
	CONSTRAINT "order_lines_unit_price_check" CHECK ("unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE INDEX "order_lines_tenant_order_idx" ON "sales"."order_lines" ("tenant_id","order_id");--> statement-breakpoint
ALTER TABLE "sales"."order_lines" ADD CONSTRAINT "order_lines_tenant_order_fkey" FOREIGN KEY ("tenant_id","order_id") REFERENCES "sales"."orders"("tenant_id","id") ON DELETE CASCADE;