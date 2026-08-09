import * as Schema from "effect/Schema"

export const CapabilityIds = [
  "authorization.capability.grant",
  "authorization.tenant_membership.add",
  "authorization.tenant_membership.read",
  "authorization.tenant_membership.suspend",
  "authorization.tenant_membership.activate",
  "authorization.tenant_membership.remove",
  "identity.user_account.create",
  "identity.user_account.read",
  "identity.user_account.update",
  "party.create",
  "party.legal_entity.create",
  "party.branch.create",
  "party.party_role.assign",
  "party.party_relationship.create",
  "party.party_identifier.attach",
  "party.party_representation.create",
  "party.party_representation.activate",
  "party.party_representation.deactivate",
  "sales.customer.create",
  "sales.quotation.create",
  "sales.order.create",
  "sales.order.confirm",
  "process.order_confirmation.recover",
  "process.order_confirmation.manual_recovery",
  "inventory.warehouse.create",
  "inventory.item.create",
  "inventory.stock.receive",
  "inventory.stock.reserve",
  "inventory.stock_transfer.create",
  "inventory.stock_transfer.confirm",
  "inventory.stock_transfer.complete",
  "accounting.legal_entity.configure",
  "accounting.account.create",
  "accounting.journal.post",
] as const

export const Capability = Schema.Literals(CapabilityIds)
export type Capability = Schema.Schema.Type<typeof Capability>

export const LegacyCapabilityIds = [
  "auth.capability.grant",
  "user_account.read",
  "user_account.write",
  "user_account.membership.manage",
  "party.role.assign",
  "party.relationship.create",
  "party.identifier.attach",
  "party.representation.write",
  "inventory.stock.transfer.create",
  "inventory.stock.transfer.confirm",
  "inventory.stock.transfer.complete",
] as const

const forbiddenVerbs = new Set([
  "manage",
  "write",
  "admin",
  "full_access",
  "execute",
])
const capabilityIdShape = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/

export const isCapabilityIdShape = (value: string): boolean => {
  if (!capabilityIdShape.test(value)) return false
  const verb = value.slice(value.lastIndexOf(".") + 1)
  return !forbiddenVerbs.has(verb)
}

export const CapabilityId = Schema.String.check(
  Schema.makeFilter((value) => isCapabilityIdShape(value), {
    expected: "a canonical capability identifier",
  }),
)

const CapabilitySegment = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/))

export const CapabilityOwner = Schema.Literals([
  "authorization",
  "identity",
  "party",
  "sales",
  "inventory",
  "accounting",
  "process",
])
export type CapabilityOwner = Schema.Schema.Type<typeof CapabilityOwner>

export const CapabilityScope = Schema.Literals([
  "tenant",
  "legal_entity",
  "branch",
  "warehouse",
  "department",
  "project",
  "record",
  "hierarchy",
])
export type CapabilityScope = Schema.Schema.Type<typeof CapabilityScope>

export const CapabilityStability = Schema.Literals([
  "PRIVATE",
  "EXPERIMENTAL",
  "PUBLIC",
  "DEPRECATED",
  "RETIRED",
])
export type CapabilityStability = Schema.Schema.Type<typeof CapabilityStability>

export const CapabilityDefinition = Schema.Struct({
  id: CapabilityId,
  owner: CapabilitySegment,
  resource: CapabilitySegment,
  verb: CapabilitySegment,
  version: Schema.Int,
  stability: CapabilityStability,
  scope: Schema.Array(CapabilityScope),
})
export type CapabilityDefinition = Schema.Schema.Type<typeof CapabilityDefinition>
export const CapabilityCatalog = Schema.Array(CapabilityDefinition)

const definition = (
  id: Capability,
  owner: CapabilityOwner,
  resource: string,
  verb: string,
): CapabilityDefinition => ({
  id,
  owner,
  resource,
  verb,
  version: 1,
  stability: "PUBLIC",
  scope: ["tenant"],
})

export const CapabilityDefinitions: ReadonlyArray<CapabilityDefinition> = [
  definition("authorization.capability.grant", "authorization", "capability", "grant"),
  definition("authorization.tenant_membership.add", "authorization", "tenant_membership", "add"),
  definition(
    "authorization.tenant_membership.read",
    "authorization",
    "tenant_membership",
    "read",
  ),
  definition(
    "authorization.tenant_membership.suspend",
    "authorization",
    "tenant_membership",
    "suspend",
  ),
  definition(
    "authorization.tenant_membership.activate",
    "authorization",
    "tenant_membership",
    "activate",
  ),
  definition(
    "authorization.tenant_membership.remove",
    "authorization",
    "tenant_membership",
    "remove",
  ),
  definition("identity.user_account.create", "identity", "user_account", "create"),
  definition("identity.user_account.read", "identity", "user_account", "read"),
  definition("identity.user_account.update", "identity", "user_account", "update"),
  definition("party.create", "party", "party", "create"),
  definition("party.legal_entity.create", "party", "legal_entity", "create"),
  definition("party.branch.create", "party", "branch", "create"),
  definition("party.party_role.assign", "party", "party_role", "assign"),
  definition("party.party_relationship.create", "party", "party_relationship", "create"),
  definition("party.party_identifier.attach", "party", "party_identifier", "attach"),
  definition(
    "party.party_representation.create",
    "party",
    "party_representation",
    "create",
  ),
  definition(
    "party.party_representation.activate",
    "party",
    "party_representation",
    "activate",
  ),
  definition(
    "party.party_representation.deactivate",
    "party",
    "party_representation",
    "deactivate",
  ),
  definition("sales.customer.create", "sales", "customer", "create"),
  definition("sales.quotation.create", "sales", "quotation", "create"),
  definition("sales.order.create", "sales", "order", "create"),
  definition("sales.order.confirm", "sales", "order", "confirm"),
  definition(
    "process.order_confirmation.recover",
    "process",
    "order_confirmation",
    "recover",
  ),
  definition(
    "process.order_confirmation.manual_recovery",
    "process",
    "order_confirmation",
    "manual_recovery",
  ),
  definition("inventory.warehouse.create", "inventory", "warehouse", "create"),
  definition("inventory.item.create", "inventory", "item", "create"),
  definition("inventory.stock.receive", "inventory", "stock", "receive"),
  definition("inventory.stock.reserve", "inventory", "stock", "reserve"),
  definition("inventory.stock_transfer.create", "inventory", "stock_transfer", "create"),
  definition("inventory.stock_transfer.confirm", "inventory", "stock_transfer", "confirm"),
  definition("inventory.stock_transfer.complete", "inventory", "stock_transfer", "complete"),
  definition("accounting.legal_entity.configure", "accounting", "legal_entity", "configure"),
  definition("accounting.account.create", "accounting", "account", "create"),
  definition("accounting.journal.post", "accounting", "journal", "post"),
]

const capabilityIdSet = new Set<string>(CapabilityIds)

export const isKnownCapability = (value: string): value is Capability => capabilityIdSet.has(value)

export const getCapabilityDefinition = (value: Capability) =>
  CapabilityDefinitions.find((definition) => definition.id === value)

export const AuthorizationCapabilities = {
  capabilityGrant: "authorization.capability.grant",
  tenantMembershipAdd: "authorization.tenant_membership.add",
  tenantMembershipRead: "authorization.tenant_membership.read",
  tenantMembershipSuspend: "authorization.tenant_membership.suspend",
  tenantMembershipActivate: "authorization.tenant_membership.activate",
  tenantMembershipRemove: "authorization.tenant_membership.remove",
} as const
