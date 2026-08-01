-- owners: accounting, auth, authorization, identity, inventory, sales
-- reviewed: 2026-08-01
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE SCHEMA "accounting";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "authorization";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE SCHEMA "sales";
--> statement-breakpoint
CREATE TYPE "accounting"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "accounting"."journal_status" AS ENUM('draft', 'posted', 'reversed');--> statement-breakpoint
CREATE TYPE "inventory"."movement_kind" AS ENUM('receipt', 'issue', 'reservation', 'release');--> statement-breakpoint
CREATE TYPE "sales"."order_status" AS ENUM('draft', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "sales"."quotation_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "inventory"."reservation_status" AS ENUM('active', 'released', 'fulfilled');--> statement-breakpoint
CREATE TABLE "accounting"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "accounting"."account_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "accounts_tenant_code_key" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "sales"."customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_tenant_email_key" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
CREATE TABLE "identity"."identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"email" text NOT NULL CONSTRAINT "identities_email_key" UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory"."items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "items_tenant_sku_key" UNIQUE("tenant_id","sku")
);
--> statement-breakpoint
CREATE TABLE "accounting"."journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "accounting"."journal_status" DEFAULT 'draft'::"accounting"."journal_status" NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "journal_entries_reference_key" UNIQUE("tenant_id","reference"),
	CONSTRAINT "journal_entries_posted_at_check" CHECK (("status" = 'draft' and "posted_at" is null) or
      ("status" in ('posted', 'reversed') and "posted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "accounting"."journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(14,2) DEFAULT '0' NOT NULL,
	"credit" numeric(14,2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_amount_check" CHECK (("debit" > 0 and "credit" = 0) or
      ("credit" > 0 and "debit" = 0))
);
--> statement-breakpoint
CREATE TABLE "authorization"."memberships" (
	"identity_id" uuid,
	"tenant_id" uuid,
	"capability" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_pkey" PRIMARY KEY("identity_id","tenant_id","capability")
);
--> statement-breakpoint
CREATE TABLE "inventory"."movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"kind" "inventory"."movement_kind" NOT NULL,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movements_quantity_check" CHECK ("quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"quotation_id" uuid,
	"status" "sales"."order_status" DEFAULT 'draft'::"sales"."order_status" NOT NULL,
	"total" numeric(14,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_total_check" CHECK ("total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."quotations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "sales"."quotation_status" DEFAULT 'draft'::"sales"."quotation_status" NOT NULL,
	"total" numeric(14,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "quotations_total_check" CHECK ("total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"status" "inventory"."reservation_status" DEFAULT 'active'::"inventory"."reservation_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_quantity_check" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"identity_id" uuid NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "sessions_token_hash_key" UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_balances" (
	"tenant_id" uuid,
	"warehouse_id" uuid,
	"item_id" uuid,
	"on_hand" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_pkey" PRIMARY KEY("tenant_id","warehouse_id","item_id"),
	CONSTRAINT "stock_balances_on_hand_check" CHECK ("on_hand" >= 0),
	CONSTRAINT "stock_balances_reserved_check" CHECK ("reserved" >= 0 and "reserved" <= "on_hand")
);
--> statement-breakpoint
CREATE TABLE "auth"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"slug" text NOT NULL CONSTRAINT "tenants_slug_key" UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory"."warehouses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "warehouses_tenant_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "accounting"."accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounting"."journal_lines" ADD CONSTRAINT "journal_lines_entry_fkey" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "accounting"."journal_entries"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."journal_lines" ADD CONSTRAINT "journal_lines_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "accounting"."accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "authorization"."memberships" ADD CONSTRAINT "memberships_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identity"."identities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "authorization"."memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD CONSTRAINT "movements_warehouse_fkey" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD CONSTRAINT "movements_item_fkey" FOREIGN KEY ("tenant_id","item_id") REFERENCES "inventory"."items"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_tenant_customer_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "sales"."customers"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_tenant_quotation_fkey" FOREIGN KEY ("tenant_id","quotation_id") REFERENCES "sales"."quotations"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD CONSTRAINT "quotations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD CONSTRAINT "quotations_tenant_customer_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "sales"."customers"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."reservations" ADD CONSTRAINT "reservations_balance_fkey" FOREIGN KEY ("tenant_id","warehouse_id","item_id") REFERENCES "inventory"."stock_balances"("tenant_id","warehouse_id","item_id");--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identity"."identities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inventory"."stock_balances" ADD CONSTRAINT "stock_balances_warehouse_fkey" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."stock_balances" ADD CONSTRAINT "stock_balances_item_fkey" FOREIGN KEY ("tenant_id","item_id") REFERENCES "inventory"."items"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;