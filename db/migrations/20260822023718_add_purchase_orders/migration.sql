-- owner: procurement
-- reviewed: 2026-08-22
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: add the bounded draft PurchaseOrder header and line transaction from ADR-0044

CREATE TYPE "procurement"."purchase_order_status" AS ENUM('draft');--> statement-breakpoint
CREATE TABLE "procurement"."purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price" numeric(24,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_quantity_check" CHECK ("quantity" > 0),
	CONSTRAINT "purchase_order_lines_unit_price_check" CHECK ("unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "procurement"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"supplier_account_id" uuid NOT NULL,
	"status" "procurement"."purchase_order_status" DEFAULT 'draft'::"procurement"."purchase_order_status" NOT NULL,
	"total" numeric(24,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_orders_total_check" CHECK ("total" >= 0)
);
--> statement-breakpoint
CREATE INDEX "purchase_order_lines_tenant_order_idx" ON "procurement"."purchase_order_lines" ("tenant_id","purchase_order_id");--> statement-breakpoint
ALTER TABLE "procurement"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_order_fkey" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "procurement"."purchase_orders"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_supplier_account_fkey" FOREIGN KEY ("tenant_id","supplier_account_id") REFERENCES "procurement"."supplier_accounts"("tenant_id","id");