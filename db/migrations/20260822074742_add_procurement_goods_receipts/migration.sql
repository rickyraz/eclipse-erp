-- owner: procurement
-- reviewed: 2026-08-22
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: add idempotent Goods Receipt evidence and owner-controlled Inventory movement provenance

CREATE TABLE "procurement"."purchase_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_of_measure" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_receipt_lines_tenant_receipt_line_key" UNIQUE("tenant_id","receipt_id","purchase_order_line_id"),
	CONSTRAINT "purchase_receipt_lines_quantity_check" CHECK ("quantity" > 0),
	CONSTRAINT "purchase_receipt_lines_unit_of_measure_check" CHECK ("unit_of_measure" <> '' and "unit_of_measure" = upper(trim("unit_of_measure")))
);
--> statement-breakpoint
CREATE TABLE "procurement"."purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_receipts_tenant_idempotency_key" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "purchase_receipts_idempotency_key_check" CHECK ("idempotency_key" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "procurement"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_order_id_key" UNIQUE("tenant_id","purchase_order_id","id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_tenant_order_line_idx" ON "procurement"."purchase_receipt_lines" ("tenant_id","purchase_order_id","purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "purchase_receipts_tenant_order_idx" ON "procurement"."purchase_receipts" ("tenant_id","purchase_order_id");--> statement-breakpoint
ALTER TABLE "procurement"."purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_tenant_receipt_fkey" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "procurement"."purchase_receipts"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_tenant_order_line_fkey" FOREIGN KEY ("tenant_id","purchase_order_id","purchase_order_line_id") REFERENCES "procurement"."purchase_order_lines"("tenant_id","purchase_order_id","id");--> statement-breakpoint
ALTER TABLE "procurement"."purchase_receipts" ADD CONSTRAINT "purchase_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_receipts" ADD CONSTRAINT "purchase_receipts_tenant_purchase_order_fkey" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "procurement"."purchase_orders"("tenant_id","id");