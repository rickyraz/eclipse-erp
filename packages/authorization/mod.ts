export {
  AuthorizationCapabilities,
  CapabilityCatalog,
  CapabilityDefinition,
  CapabilityDefinitions,
  CapabilityId,
  CapabilityIds,
  CapabilityOwner,
  CapabilityScope,
  CapabilityStability,
  getCapabilityDefinition,
  isCapabilityIdShape,
  isKnownCapability,
  LegacyCapabilityIds,
} from "./src/capabilities.ts"
export type { CapabilityDefinition as CapabilityDefinitionType } from "./src/capabilities.ts"

export {
  AddTenantMembershipInput,
  AuthorizationDecision,
  AuthorizationDenied,
  AuthorizationInput,
  AuthorizationService,
  Capability,
  CapabilityAlreadyGranted,
  GrantCapabilityInput,
  makeAuthorizationService,
  makeAuthorizationTestLayer,
  TenantMembership,
  TenantMembershipAlreadyExists,
  TenantMembershipInput,
  TenantMembershipNotActive,
  TenantMembershipNotFound,
  TenantMembershipStatus,
  TenantMembershipUserAccountNotFound,
} from "./src/service.ts"
export type {
  AuthorizationService as AuthorizationServiceShape,
  Capability as CapabilityType,
  TenantMembership as TenantMembershipType,
  TenantMembershipStatus as TenantMembershipStatusType,
} from "./src/service.ts"
