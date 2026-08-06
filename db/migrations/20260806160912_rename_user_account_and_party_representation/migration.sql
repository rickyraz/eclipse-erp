-- owners: auth, authorization, identity, party
-- reviewed: 2026-08-06
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "party"."identity_party_representations" RENAME TO "party_representations";--> statement-breakpoint
ALTER TABLE "identity"."identities" RENAME TO "user_accounts";--> statement-breakpoint
ALTER TABLE "authorization"."memberships" RENAME COLUMN "identity_id" TO "user_account_id";--> statement-breakpoint
ALTER TABLE "party"."party_representations" RENAME COLUMN "identity_id" TO "user_account_id";--> statement-breakpoint
ALTER TABLE "auth"."sessions" RENAME COLUMN "identity_id" TO "user_account_id";--> statement-breakpoint
ALTER TABLE "authorization"."memberships" RENAME CONSTRAINT "memberships_identity_id_fkey" TO "memberships_user_account_id_fkey";--> statement-breakpoint
ALTER TABLE "party"."party_representations" RENAME CONSTRAINT "identity_party_representations_tenant_fkey" TO "party_representations_tenant_fkey";--> statement-breakpoint
ALTER TABLE "party"."party_representations" RENAME CONSTRAINT "identity_party_representations_identity_fkey" TO "party_representations_user_account_fkey";--> statement-breakpoint
ALTER TABLE "party"."party_representations" RENAME CONSTRAINT "identity_party_representations_party_fkey" TO "party_representations_party_fkey";--> statement-breakpoint
ALTER TABLE "auth"."sessions" RENAME CONSTRAINT "sessions_identity_id_fkey" TO "sessions_user_account_id_fkey";--> statement-breakpoint
ALTER TABLE "party"."party_representations" RENAME CONSTRAINT "identity_party_representations_tenant_id_id_key" TO "party_representations_tenant_id_id_key";--> statement-breakpoint
ALTER TABLE "party"."party_representations" RENAME CONSTRAINT "identity_party_representations_tenant_identity_party_kind_key" TO "party_representations_tenant_user_account_party_kind_key";--> statement-breakpoint
ALTER TABLE "identity"."user_accounts" RENAME CONSTRAINT "identities_email_key" TO "user_accounts_email_key";--> statement-breakpoint
-- Preserve existing authorization grants while renaming capability literals.
DELETE FROM "authorization"."memberships" AS old
USING "authorization"."memberships" AS current
WHERE old."user_account_id" = current."user_account_id"
  AND old."tenant_id" = current."tenant_id"
  AND old."capability" = 'identity.read'
  AND current."capability" = 'user_account.read';--> statement-breakpoint
UPDATE "authorization"."memberships"
SET "capability" = 'user_account.read'
WHERE "capability" = 'identity.read';--> statement-breakpoint
DELETE FROM "authorization"."memberships" AS old
USING "authorization"."memberships" AS current
WHERE old."user_account_id" = current."user_account_id"
  AND old."tenant_id" = current."tenant_id"
  AND old."capability" = 'identity.write'
  AND current."capability" = 'user_account.write';--> statement-breakpoint
UPDATE "authorization"."memberships"
SET "capability" = 'user_account.write'
WHERE "capability" = 'identity.write';--> statement-breakpoint
DELETE FROM "authorization"."memberships" AS old
USING "authorization"."memberships" AS current
WHERE old."user_account_id" = current."user_account_id"
  AND old."tenant_id" = current."tenant_id"
  AND old."capability" = 'party.identity.represent'
  AND current."capability" = 'party.representation.write';--> statement-breakpoint
UPDATE "authorization"."memberships"
SET "capability" = 'party.representation.write'
WHERE "capability" = 'party.identity.represent';