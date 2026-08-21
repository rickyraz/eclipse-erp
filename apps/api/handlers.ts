import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder"

import { AuthService } from "../../packages/auth/mod.ts"
import {
  AuthorizationCapabilities,
  AuthorizationService,
} from "../../packages/authorization/mod.ts"
import { IdentityCapabilities, UserAccountService } from "../../packages/identity/mod.ts"
import { DatabaseFailure } from "../../packages/kernel/mod.ts"
import { PartyService } from "../../packages/party/mod.ts"
import { SalesService } from "../../packages/sales/mod.ts"
import { InventoryService } from "../../packages/inventory/mod.ts"
import { AccountingService, FinancialOperationService } from "../../packages/accounting/mod.ts"
import { ProcessService } from "../../packages/process/mod.ts"
import {
  ApiConflict,
  ApiForbidden,
  ApiNotFound,
  ApiServiceUnavailable,
  ApiUnauthorized,
  BearerAuth,
  CurrentPrincipal,
  RitseiApi,
} from "./api.ts"

type ApiErrorKind =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "service_unavailable"

// Closed-world transport policy for routes compiled into RitseiApi. Plugin, connector,
// and Process Studio failures are normalized by their own versioned contribution boundary.
const coreApiErrorPolicy = {
  AccountAlreadyExists: "conflict",
  AccountNotFound: "not_found",
  AccountingConfigurationAlreadyExists: "conflict",
  AccountingLegalEntityNotFound: "not_found",
  AccountingPeriodNotFound: "not_found",
  AccountingPeriodNotOpen: "conflict",
  AccountingPeriodOverlap: "conflict",
  AuthorizationDenied: "forbidden",
  BranchAlreadyExists: "conflict",
  CapabilityAlreadyGranted: "conflict",
  CustomerAlreadyExists: "conflict",
  CustomerNotFound: "not_found",
  DatabaseFailure: "service_unavailable",
  EventIdempotencyConflict: "conflict",
  ExternalIdentifierAlreadyAssigned: "conflict",
  FinancialCurrencyMismatch: "conflict",
  FinancialEngineActivated: "conflict",
  FinancialEngineCutoverBlocked: "conflict",
  FinancialLedgerNotActivated: "conflict",
  FinancialLedgerNotConfigured: "service_unavailable",
  FinancialOperationConflict: "conflict",
  FinancialOperationInjectedFailure: "conflict",
  FinancialOperationNotFound: "not_found",
  FinancialOperationReconciliationConflict: "conflict",
  FinancialOperationsPending: "conflict",
  FinancialProjectionRebuildBlocked: "conflict",
  FinancialReconciliationCheckpointConflict: "conflict",
  FinancialReconciliationCheckpointEvidenceInvalid: "conflict",
  FinancialRevenueAmountMismatch: "conflict",
  FinancialReversalAlreadyExists: "conflict",
  FinancialReversalSourceNotFound: "not_found",
  FinancialReversalSourceNotPosted: "conflict",
  FinancialReversalSourceNotReady: "conflict",
  FinancialReversalSourceRequired: "conflict",
  FinancialSalesNotConfigured: "service_unavailable",
  FinancialVerificationArtifactInvalid: "conflict",
  FinancialVerificationArtifactNotFound: "not_found",
  FinancialVerificationKeyGenerationFailure: "conflict",
  FinancialVerificationKeyNotFound: "not_found",
  FinancialVerificationSigningFailure: "conflict",
  FinancialVerificationVerificationFailure: "conflict",
  InvalidJournalLine: "conflict",
  InvalidRevenuePostingProfile: "conflict",
  InventoryReferenceNotFound: "not_found",
  InventoryUnitOfMeasureMismatch: "conflict",
  ItemAlreadyExists: "conflict",
  JournalIdempotencyConflict: "conflict",
  JournalReferenceAlreadyExists: "conflict",
  LegalEntityAlreadyExists: "conflict",
  LegalEntityNotFound: "not_found",
  OrderConfirmationCorrupt: "conflict",
  OrderConfirmationNotFound: "not_found",
  OrganizationRequired: "conflict",
  PartyNotFound: "not_found",
  PartyRelationshipAlreadyExists: "conflict",
  PartyRelationshipRoleNotAssigned: "conflict",
  PartyRepresentationAlreadyExists: "conflict",
  PartyRepresentationNotFound: "not_found",
  PartyRepresentationUserAccountNotFound: "not_found",
  PartyRoleAlreadyAssigned: "conflict",
  QuotationNotFound: "not_found",
  RevenueJournalNotFound: "not_found",
  RevenuePostingProfileAlreadyExists: "conflict",
  RevenuePostingProfileNotFound: "not_found",
  SalesOrderConfirmationIdempotencyConflict: "conflict",
  SalesOrderInvalidState: "conflict",
  SalesOrderNotFound: "not_found",
  SchemaError: "invalid_request",
  StockCorrectionIdempotencyConflict: "conflict",
  StockReservationIdempotencyConflict: "conflict",
  StockReservationInvalidState: "conflict",
  StockReservationLegalEntityMismatch: "conflict",
  StockReservationNotFound: "not_found",
  StockTransferDifferentLegalEntity: "conflict",
  StockTransferDuplicateItem: "conflict",
  StockTransferInvalidState: "conflict",
  StockTransferItemNotFound: "not_found",
  StockTransferNotFound: "not_found",
  StockTransferSameWarehouse: "conflict",
  StockTransferWarehouseNotFound: "not_found",
  StockUnavailable: "conflict",
  TenantMembershipAlreadyExists: "conflict",
  TenantMembershipNotActive: "conflict",
  TenantMembershipNotFound: "not_found",
  TenantMembershipUserAccountNotFound: "not_found",
  TigerBeetleConfigurationFailure: "conflict",
  UnbalancedJournal: "conflict",
  UserAccountAlreadyExists: "conflict",
  UserAccountNotFound: "not_found",
  WarehouseAlreadyExists: "conflict",
  WarehouseBranchNotFound: "not_found",
  WarehouseLegalEntityNotFound: "not_found",
  WorkflowAlreadyCompleted: "conflict",
  WorkflowAlreadyInProgress: "conflict",
  WorkflowIdempotencyConflict: "conflict",
  WorkflowManualRecoveryRequired: "conflict",
  WorkflowOutcomeUnknown: "service_unavailable",
  WorkflowResultCorrupt: "conflict",
  WorkflowRunNotFound: "not_found",
} as const satisfies Record<string, ApiErrorKind>

export type CoreApiFailure = {
  readonly _tag: keyof typeof coreApiErrorPolicy
}

export const toCoreApiError = (error: CoreApiFailure) => {
  const tag = error._tag
  switch (coreApiErrorPolicy[tag]) {
    case "forbidden":
      return new ApiForbidden({ code: "forbidden" })
    case "not_found":
      return new ApiNotFound({ code: tag })
    case "invalid_request":
      return new ApiConflict({ code: "invalid_request" })
    case "service_unavailable":
      return new ApiServiceUnavailable({ code: "service_unavailable" })
    case "conflict":
      return new ApiConflict({ code: tag })
  }
}

const coreApiEffect = <A, E extends CoreApiFailure, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(toCoreApiError))

export const BearerAuthLive = Layer.effect(
  BearerAuth,
  Effect.gen(function* () {
    const auth = yield* AuthService
    return {
      bearer: (effect, options) =>
        Effect.provideServiceEffect(
          effect,
          CurrentPrincipal,
          auth.authenticate(Redacted.value(options.credential)).pipe(
            Effect.mapError((error) =>
              error instanceof DatabaseFailure
                ? new ApiServiceUnavailable({ code: "service_unavailable" })
                : new ApiUnauthorized({ code: "unauthorized" })
            ),
          ),
        ),
    }
  }),
)

export const HealthHandlers = HttpApiBuilder.group(
  RitseiApi,
  "Health",
  (handlers) => handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
)

export const UserAccountHandlers = HttpApiBuilder.group(
  RitseiApi,
  "UserAccounts",
  (handlers) =>
    handlers
      .handle("create", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: IdentityCapabilities.userAccountCreate,
          })
          const userAccount = yield* UserAccountService.use((service) => service.create(payload))
          yield* authorization.addMember({
            userAccountId: userAccount.id,
            tenantId: headers["x-tenant-id"],
          })
          return userAccount
        })))
      .handle("list", ({ headers }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: IdentityCapabilities.userAccountRead,
          })
          const members = yield* authorization.listMembers(headers["x-tenant-id"])
          return yield* UserAccountService.use((service) =>
            service.getByIds(members.map((member) => member.userAccountId))
          )
        })))
      .handle("get", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: IdentityCapabilities.userAccountRead,
          })
          yield* authorization.getMember({
            userAccountId: params.id,
            tenantId: headers["x-tenant-id"],
          })
          return yield* UserAccountService.use((service) => service.getById(params.id))
        })))
      .handle("update", ({ headers, params, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: IdentityCapabilities.userAccountUpdate,
          })
          yield* authorization.getMember({
            userAccountId: params.id,
            tenantId: headers["x-tenant-id"],
          })
          return yield* UserAccountService.use((service) =>
            service.update({ id: params.id, email: payload.email })
          )
        }))),
)

export const PartyHandlers = HttpApiBuilder.group(
  RitseiApi,
  "Parties",
  (handlers) =>
    handlers
      .handle("create", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* PartyService.use((service) =>
            service.create({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("assignRole", ({ headers, params, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          yield* PartyService.use((service) =>
            service.assignRole({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
              role: payload.role,
            })
          )
        })))
      .handle("attachIdentifier", ({ headers, params, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* PartyService.use((service) =>
            service.attachIdentifier({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
              ...payload,
            })
          )
        })))
      .handle("createRelationship", ({ headers, params, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* PartyService.use((service) =>
            service.createRelationship({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
              ...payload,
            })
          )
        }))),
)

export const AuthorizationHandlers = HttpApiBuilder.group(
  RitseiApi,
  "Authorization",
  (handlers) =>
    handlers
      .handle("addMember", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: AuthorizationCapabilities.tenantMembershipAdd,
          })
          return yield* authorization.addMember({
            userAccountId: payload.userAccountId,
            tenantId: headers["x-tenant-id"],
          })
        })))
      .handle("listMembers", ({ headers }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: AuthorizationCapabilities.tenantMembershipRead,
          })
          return yield* authorization.listMembers(headers["x-tenant-id"])
        })))
      .handle("suspendMember", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: AuthorizationCapabilities.tenantMembershipSuspend,
          })
          return yield* authorization.suspendMember({
            userAccountId: params.userAccountId,
            tenantId: headers["x-tenant-id"],
          })
        })))
      .handle("activateMember", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: AuthorizationCapabilities.tenantMembershipActivate,
          })
          return yield* authorization.activateMember({
            userAccountId: params.userAccountId,
            tenantId: headers["x-tenant-id"],
          })
        })))
      .handle("removeMember", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: AuthorizationCapabilities.tenantMembershipRemove,
          })
          yield* authorization.removeMember({
            userAccountId: params.userAccountId,
            tenantId: headers["x-tenant-id"],
          })
        })))
      .handle("grant", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: AuthorizationCapabilities.capabilityGrant,
          })
          yield* authorization.grant({
            userAccountId: payload.userAccountId,
            tenantId: headers["x-tenant-id"],
            capability: payload.capability,
          })
        }))),
)

export const SalesHandlers = HttpApiBuilder.group(RitseiApi, "Sales", (handlers) =>
  handlers
    .handle("createCustomer", ({ headers, payload }) =>
      coreApiEffect(Effect.gen(function* () {
        const principal = yield* CurrentPrincipal
        return yield* SalesService.use((service) =>
          service.createCustomer({
            principal,
            tenantId: headers["x-tenant-id"],
            ...payload,
          })
        )
      })))
    .handle("createQuotation", ({ headers, payload }) =>
      coreApiEffect(Effect.gen(function* () {
        const principal = yield* CurrentPrincipal
        return yield* SalesService.use((service) =>
          service.createQuotation({
            principal,
            tenantId: headers["x-tenant-id"],
            ...payload,
          })
        )
      })))
    .handle("createOrder", ({ headers, payload }) =>
      coreApiEffect(Effect.gen(function* () {
        const principal = yield* CurrentPrincipal
        return yield* SalesService.use((service) =>
          service.createOrder({
            principal,
            tenantId: headers["x-tenant-id"],
            ...payload,
          })
        )
      }))))

export const InventoryHandlers = HttpApiBuilder.group(
  RitseiApi,
  "Inventory",
  (handlers) =>
    handlers
      .handle("createWarehouse", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* InventoryService.use((service) =>
            service.createWarehouse({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("createItem", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* InventoryService.use((service) =>
            service.createItem({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("receiveStock", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* InventoryService.use((service) =>
            service.receiveStock({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("reserveStock", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* InventoryService.use((service) =>
            service.reserveStock({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("createTransfer", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* InventoryService.use((service) =>
            service.createTransfer({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("confirmTransfer", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* InventoryService.use((service) =>
            service.confirmTransfer({
              principal,
              tenantId: headers["x-tenant-id"],
              transferId: params.id,
            })
          )
        })))
      .handle("completeTransfer", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* InventoryService.use((service) =>
            service.completeTransfer({
              principal,
              tenantId: headers["x-tenant-id"],
              transferId: params.id,
            })
          )
        }))),
)

export const ProcessHandlers = HttpApiBuilder.group(
  RitseiApi,
  "Process",
  (handlers) =>
    handlers
      .handle("confirmOrder", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.confirmOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("cancelOrder", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.cancelOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("fulfillOrder", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.fulfillOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("recoverOrder", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.recoverOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("manualRecovery", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.markManualRecovery({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        }))),
)

export const AccountingHandlers = HttpApiBuilder.group(
  RitseiApi,
  "Accounting",
  (handlers) =>
    handlers
      .handle("prepareTigerBeetleCutover", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.prepareTigerBeetleCutover({
              principal,
              tenantId: headers["x-tenant-id"],
              legalEntityId: params.id,
            })
          )
        })))
      .handle("recordFinancialVerificationArtifact", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.recordFinancialVerificationArtifact({
              principal,
              tenantId: headers["x-tenant-id"],
              evidence: payload,
            })
          )
        })))
      .handle("approveTigerBeetleCutover", ({ headers, params, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.approveTigerBeetleCutover({
              principal,
              tenantId: headers["x-tenant-id"],
              legalEntityId: params.id,
              ...payload,
            })
          )
        })))
      .handle("activateTigerBeetleCutover", ({ headers, params }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.activateTigerBeetleCutover({
              principal,
              tenantId: headers["x-tenant-id"],
              legalEntityId: params.id,
            })
          )
        })))
      .handle("configureLegalEntity", ({ headers, params, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.configureLegalEntity({
              principal,
              tenantId: headers["x-tenant-id"],
              legalEntityId: params.id,
              ...payload,
            })
          )
        })))
      .handle("createAccount", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.createAccount({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("postJournal", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.postJournal({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("rebuildFinancialProjections", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* FinancialOperationService.use((service) =>
            service.rebuildFinancialProjections({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("reconcileFinancialCheckpoint", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* FinancialOperationService.use((service) =>
            service.reconcileFinancialCheckpoint({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("createFinancialJournalIntent", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* FinancialOperationService.use((service) =>
            service.createJournalIntent({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("createFinancialRevenueIntent", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* FinancialOperationService.use((service) =>
            service.createRevenueIntent({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("createFinancialReversalIntent", ({ headers, payload }) =>
        coreApiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* FinancialOperationService.use((service) =>
            service.createReversalIntent({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        }))),
)

export const ApiHandlers = Layer.mergeAll(
  HealthHandlers,
  UserAccountHandlers,
  PartyHandlers,
  AuthorizationHandlers,
  SalesHandlers,
  InventoryHandlers,
  AccountingHandlers,
  ProcessHandlers,
)
