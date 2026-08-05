import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder"

import { AuthService, InvalidSessionToken } from "../../packages/auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../packages/authorization/mod.ts"
import { IdentityService } from "../../packages/identity/mod.ts"
import { DatabaseFailure } from "../../packages/kernel/mod.ts"
import { PartyService } from "../../packages/party/mod.ts"
import { SalesService } from "../../packages/sales/mod.ts"
import { InventoryService } from "../../packages/inventory/mod.ts"
import { AccountingService } from "../../packages/accounting/mod.ts"
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
  if (error instanceof DatabaseFailure) {
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
            Effect.mapError(() => new ApiUnauthorized({ code: "unauthorized" })),
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

export const IdentityHandlers = HttpApiBuilder.group(
  EclipseApi,
  "Identities",
  (handlers) =>
    handlers
      .handle(
        "create",
        ({ payload }) => apiEffect(IdentityService.use((service) => service.create(payload))),
      )
      .handle("list", ({ headers }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: "identity.read",
          })
          return yield* IdentityService.use((service) => service.list())
        })))
      .handle("get", ({ headers, params }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: "identity.read",
          })
          return yield* IdentityService.use((service) => service.getById(params.id))
        })))
      .handle("update", ({ headers, params, payload }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: "identity.write",
          })
          return yield* IdentityService.use((service) =>
            service.update({ id: params.id, email: payload.email })
          )
        })))
      .handle("remove", ({ headers, params }) =>
        apiEffect(Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const authorization = yield* AuthorizationService
          yield* authorization.authorize({
            principal,
            tenantId: headers["x-tenant-id"],
            capability: "identity.write",
          })
          yield* IdentityService.use((service) => service.remove(params.id))
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
    handlers.handle("grant", ({ headers, payload }) =>
      apiEffect(Effect.gen(function* () {
        const principal = yield* CurrentPrincipal
        const authorization = yield* AuthorizationService
        yield* authorization.authorize({
          principal,
          tenantId: headers["x-tenant-id"],
          capability: "auth.capability.grant",
        })
        yield* authorization.grant({
          identityId: payload.identityId,
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

export const AccountingHandlers = HttpApiBuilder.group(
  EclipseApi,
  "Accounting",
  (handlers) =>
    handlers
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
        }))),
)

export const ApiHandlers = Layer.mergeAll(
  HealthHandlers,
  IdentityHandlers,
  PartyHandlers,
  AuthorizationHandlers,
  SalesHandlers,
  InventoryHandlers,
  AccountingHandlers,
)
