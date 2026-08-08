-- owners: authorization
-- reviewed: 2026-08-08
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom

-- Preserve existing grants while moving them to canonical capability identifiers.
WITH capability_mapping(old_capability, new_capability) AS (
  VALUES
    ('auth.capability.grant', 'authorization.capability.grant'),
    ('user_account.read', 'identity.user_account.read'),
    ('party.role.assign', 'party.party_role.assign'),
    ('party.relationship.create', 'party.party_relationship.create'),
    ('party.identifier.attach', 'party.party_identifier.attach'),
    ('inventory.stock.transfer.create', 'inventory.stock_transfer.create'),
    ('inventory.stock.transfer.confirm', 'inventory.stock_transfer.confirm'),
    ('inventory.stock.transfer.complete', 'inventory.stock_transfer.complete')
)
INSERT INTO "authorization"."memberships" (
  "user_account_id",
  "tenant_id",
  "capability",
  "created_at",
  "updated_at"
)
SELECT memberships."user_account_id", memberships."tenant_id", mapping.new_capability,
  memberships."created_at", memberships."updated_at"
FROM "authorization"."memberships" AS memberships
JOIN capability_mapping AS mapping
  ON memberships."capability" = mapping.old_capability
ON CONFLICT ("user_account_id", "tenant_id", "capability") DO NOTHING;
--> statement-breakpoint
DELETE FROM "authorization"."memberships"
WHERE "capability" IN (
  'auth.capability.grant',
  'user_account.read',
  'party.role.assign',
  'party.relationship.create',
  'party.identifier.attach',
  'inventory.stock.transfer.create',
  'inventory.stock.transfer.confirm',
  'inventory.stock.transfer.complete'
);
--> statement-breakpoint

-- Preserve the effective create/update authority of the legacy broad user-account grant.
WITH replacements(new_capability) AS (
  VALUES
    ('identity.user_account.create'),
    ('identity.user_account.update')
)
INSERT INTO "authorization"."memberships" (
  "user_account_id",
  "tenant_id",
  "capability",
  "created_at",
  "updated_at"
)
SELECT memberships."user_account_id", memberships."tenant_id", replacements.new_capability,
  memberships."created_at", memberships."updated_at"
FROM "authorization"."memberships" AS memberships
CROSS JOIN replacements
WHERE memberships."capability" = 'user_account.write'
ON CONFLICT ("user_account_id", "tenant_id", "capability") DO NOTHING;
--> statement-breakpoint
DELETE FROM "authorization"."memberships"
WHERE "capability" = 'user_account.write';
--> statement-breakpoint

-- Preserve the effective tenant-membership administration authority of the legacy broad grant.
WITH replacements(new_capability) AS (
  VALUES
    ('authorization.tenant_membership.add'),
    ('authorization.tenant_membership.read'),
    ('authorization.tenant_membership.suspend'),
    ('authorization.tenant_membership.activate'),
    ('authorization.tenant_membership.remove')
)
INSERT INTO "authorization"."memberships" (
  "user_account_id",
  "tenant_id",
  "capability",
  "created_at",
  "updated_at"
)
SELECT memberships."user_account_id", memberships."tenant_id", replacements.new_capability,
  memberships."created_at", memberships."updated_at"
FROM "authorization"."memberships" AS memberships
CROSS JOIN replacements
WHERE memberships."capability" = 'user_account.membership.manage'
ON CONFLICT ("user_account_id", "tenant_id", "capability") DO NOTHING;
--> statement-breakpoint
DELETE FROM "authorization"."memberships"
WHERE "capability" = 'user_account.membership.manage';
--> statement-breakpoint

-- Preserve create and both lifecycle transitions of PartyRepresentation.write.
WITH replacements(new_capability) AS (
  VALUES
    ('party.party_representation.create'),
    ('party.party_representation.activate'),
    ('party.party_representation.deactivate')
)
INSERT INTO "authorization"."memberships" (
  "user_account_id",
  "tenant_id",
  "capability",
  "created_at",
  "updated_at"
)
SELECT memberships."user_account_id", memberships."tenant_id", replacements.new_capability,
  memberships."created_at", memberships."updated_at"
FROM "authorization"."memberships" AS memberships
CROSS JOIN replacements
WHERE memberships."capability" = 'party.representation.write'
ON CONFLICT ("user_account_id", "tenant_id", "capability") DO NOTHING;
--> statement-breakpoint
DELETE FROM "authorization"."memberships"
WHERE "capability" = 'party.representation.write';
