import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder"

import { AuthService, InvalidSessionToken } from "../../packages/auth/mod.ts"
import {
  AuthorizationCapabilities,
  AuthorizationDenied,
  AuthorizationService,
} from "../../packages/authorization/mod.ts"
import { IdentityCapabilities, UserAccountService } from "../../packages/identity/mod.ts"
import { DatabaseFailure } from "../../packages/kernel/mod.ts"
import { PartyService } from "../../packages/party/mod.ts"
import { SalesService } from "../../packages/sales/mod.ts"
import { InventoryService } from "../../packages/inventory/mod.ts"
import {
  AccountingService,
  FinancialLedgerNotConfigured,
  FinancialOperationService,
  FinancialSalesNotConfigured,
} from "../../packages/accounting/mod.ts"
import { ProcessService, WorkflowOutcomeUnknown } from "../../packages/process/mod.ts"
import {
  ApiConflict,
  ApiForbidden,
  ApiNotFound,
  ApiServiceUnavailable,
  ApiUnauthorized,
  BearerAuth,
  CurrentPrincipal,
  EclipseApi,
} from "./api.ts"

const tagOf = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "Unknown"

const toApiError = (error: unknown) => {
  if (
    error instanceof DatabaseFailure ||
    error instanceof WorkflowOutcomeUnknown ||
    error instanceof FinancialLedgerNotConfigured ||
    error instanceof FinancialSalesNotConfigured
  ) {
    return new ApiServiceUnavailable({ code: "service_unavailable" })
  }
  if (error instanceof InvalidSessionToken) {
    return new ApiUnauthorized({ code: "unauthorized" })
  }
  if (error instanceof AuthorizationDenied) {
    return new ApiForbidden({ code: "forbidden" })
  }

  const tag = tagOf(error)
  if (tag.endsWith("NotFound") || tag === "InventoryReferenceNotFound") {
    return new ApiNotFound({ code: tag })
  }
  return new ApiConflict({ code: tag === "SchemaError" ? "invalid_request" : tag })
}

const apiEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(toApiError))

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
  EclipseApi,
  "Health",
  (handlers) => handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
)

export const UserAccountHandlers = HttpApiBuilder.group(
  EclipseApi,
  "UserAccounts",
  (handlers) =>
    handlers
      .handle("create", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
  EclipseApi,
  "Parties",
  (handlers) =>
    handlers
      .handle("create", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* PartyService.use((service) =>
            service.create({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("assignRole", ({ headers, params, payload }) =>
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
  EclipseApi,
  "Authorization",
  (handlers) =>
    handlers
      .handle("addMember", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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

export const SalesHandlers = HttpApiBuilder.group(EclipseApi, "Sales", (handlers) =>
  handlers
    .handle("createCustomer", ({ headers, payload }) =>
      apiEffect(Effect.gen(function* () {
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
      apiEffect(Effect.gen(function* () {
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
      apiEffect(Effect.gen(function* () {
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
  EclipseApi,
  "Inventory",
  (handlers) =>
    handlers
      .handle("createWarehouse", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
  EclipseApi,
  "Process",
  (handlers) =>
    handlers
      .handle("confirmOrder", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.confirmOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("cancelOrder", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.cancelOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("fulfillOrder", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.fulfillOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("recoverOrder", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.recoverOrder({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        })))
      .handle("manualRecovery", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* ProcessService.use((service) =>
            service.markManualRecovery({ principal, tenantId: headers["x-tenant-id"], ...payload })
          )
        }))),
)

export const AccountingHandlers = HttpApiBuilder.group(
  EclipseApi,
  "Accounting",
  (handlers) =>
    handlers
      .handle("prepareTigerBeetleCutover", ({ headers, params }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* AccountingService.use((service) =>
            service.prepareTigerBeetleCutover({
              principal,
              tenantId: headers["x-tenant-id"],
              legalEntityId: params.id,
            })
          )
        })))
      .handle("approveTigerBeetleCutover", ({ headers, params, payload }) =>
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          return yield* FinancialOperationService.use((service) =>
            service.rebuildFinancialProjections({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            })
          )
        })))
      .handle("createFinancialJournalIntent", ({ headers, payload }) =>
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
        apiEffect(Effect.gen(function* () {
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
