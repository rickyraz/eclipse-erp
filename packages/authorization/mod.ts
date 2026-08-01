export {
  AuthorizationDecision,
  AuthorizationDenied,
  AuthorizationInput,
  AuthorizationService,
  Capability,
  CapabilityAlreadyGranted,
  GrantCapabilityInput,
  makeAuthorizationService,
  makeAuthorizationTestLayer,
} from "./src/service.ts"
export type {
  AuthorizationService as AuthorizationServiceShape,
  Capability as CapabilityType,
} from "./src/service.ts"
