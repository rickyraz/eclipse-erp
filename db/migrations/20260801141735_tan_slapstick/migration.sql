-- owner: party
-- reviewed: 2026-08-01
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE SCHEMA "party";
--> statement-breakpoint
CREATE TYPE "party"."party_kind" AS ENUM('person', 'organization');--> statement-breakpoint
CREATE TYPE "party"."party_role" AS ENUM('customer', 'supplier', 'employee', 'partner');--> statement-breakpoint
CREATE TABLE "party"."parties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"kind" "party"."party_kind" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "party"."party_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"scheme" text NOT NULL,
	"scope" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_identifiers_tenant_scheme_scope_value_key" UNIQUE("tenant_id","scheme","scope","value")
);
--> statement-breakpoint
CREATE TABLE "party"."party_roles" (
	"tenant_id" uuid,
	"party_id" uuid,
	"role" "party"."party_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_roles_pkey" PRIMARY KEY("tenant_id","party_id","role")
);
--> statement-breakpoint
ALTER TABLE "party"."parties" ADD CONSTRAINT "parties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."party_identifiers" ADD CONSTRAINT "party_identifiers_tenant_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."party_roles" ADD CONSTRAINT "party_roles_tenant_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id") ON DELETE CASCADE;