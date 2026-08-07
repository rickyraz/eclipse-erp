-- owners: identity, authorization
-- reviewed: 2026-08-07
-- generated-by: drizzle-kit 1.0.0-rc.4

CREATE TABLE "authorization"."tenant_memberships" (
	"user_account_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY("user_account_id","tenant_id"),
	CONSTRAINT "tenant_memberships_status_check" CHECK ("status" in ('active', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "identity"."user_accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "identity"."user_accounts" ADD COLUMN "disabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "identity"."user_accounts" ADD COLUMN "session_invalidated_at" timestamp with time zone;
--> statement-breakpoint
INSERT INTO "authorization"."tenant_memberships" ("user_account_id", "tenant_id")
SELECT DISTINCT "user_account_id", "tenant_id"
FROM "authorization"."memberships";
--> statement-breakpoint
ALTER TABLE "authorization"."memberships"
  ADD CONSTRAINT "memberships_tenant_membership_fkey"
  FOREIGN KEY ("user_account_id", "tenant_id")
  REFERENCES "authorization"."tenant_memberships"("user_account_id", "tenant_id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "authorization"."tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_user_account_id_fkey"
  FOREIGN KEY ("user_account_id") REFERENCES "identity"."user_accounts"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "authorization"."tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "identity"."user_accounts"
  ADD CONSTRAINT "user_accounts_status_check"
  CHECK ("status" in ('active', 'disabled'));
