import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { memberships } from "../../../db/schema/authorization.ts"
import { Principal } from "../../auth/mod.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

export const Capability = Schema.Literals([
  "auth.capability.grant",
  "user_account.read",
  "user_account.write",
  "party.create",
  "party.legal_entity.create",
  "party.branch.create",
  "party.role.assign",
  "party.relationship.create",
  "party.identifier.attach",
  "party.representation.write",
  "sales.customer.create",
  "sales.quotation.create",
  "sales.order.create",
  "inventory.warehouse.create",
  "inventory.item.create",
  "inventory.stock.receive",
  "inventory.stock.reserve",
  "inventory.stock.transfer.create",
  "inventory.stock.transfer.confirm",
  "inventory.stock.transfer.complete",
  "accounting.legal_entity.configure",
  "accounting.account.create",
  "accounting.journal.post",
])

export type Capability = Schema.Schema.Type<typeof Capability>

export const AuthorizationInput = Schema.Struct({
  principal: Principal,
  tenantId: Schema.String,
  capability: Capability,
})

export const GrantCapabilityInput = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
  capability: Capability,
})

export const AuthorizationDecision = Schema.Struct({
  allowed: Schema.Literal(true),
  tenantId: Schema.String,
  capability: Capability,
  grant: Schema.Literal("membership"),
})

export class AuthorizationDenied
  extends Schema.TaggedErrorClass<AuthorizationDenied>()("AuthorizationDenied", {
    tenantId: Schema.String,
    capability: Capability,
  }) {}

export class CapabilityAlreadyGranted
  extends Schema.TaggedErrorClass<CapabilityAlreadyGranted>()("CapabilityAlreadyGranted", {
    userAccountId: Schema.String,
    tenantId: Schema.String,
    capability: Capability,
  }) {}

export interface AuthorizationService {
  readonly authorize: (
    input: unknown,
  ) => Effect.Effect<
    Schema.Schema.Type<typeof AuthorizationDecision>,
    AuthorizationDenied | DatabaseFailure | Schema.SchemaError
  >
  readonly grant: (
    input: unknown,
  ) => Effect.Effect<void, CapabilityAlreadyGranted | DatabaseFailure | Schema.SchemaError>
}

export const AuthorizationService = Context.Service<AuthorizationService>(
  "EclipseERP/AuthorizationService",
)

export const makeAuthorizationService = Effect.gen(function* () {
  const database = yield* Database
  return {
    authorize: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AuthorizationInput)(input)
        const rows = yield* database.query(
          (db) =>
            db.select({ userAccountId: memberships.userAccountId })
              .from(memberships)
              .where(
                and(
                  eq(memberships.userAccountId, decoded.principal.userAccountId),
                  eq(memberships.tenantId, decoded.tenantId),
                  eq(memberships.capability, decoded.capability),
                ),
              ),
          "authorization.check",
        )
        if (rows[0] === undefined) {
          return yield* Effect.fail(
            new AuthorizationDenied({
              tenantId: decoded.tenantId,
              capability: decoded.capability,
            }),
          )
        }
        return {
          allowed: true as const,
          tenantId: decoded.tenantId,
          capability: decoded.capability,
          grant: "membership" as const,
        }
      }),
    grant: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(GrantCapabilityInput)(input)
        yield* database.query(
          (db) => db.insert(memberships).values(decoded),
          "authorization.grant",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "memberships_pkey")
              ? new CapabilityAlreadyGranted(decoded)
              : error
          ),
        )
      }),
  } satisfies AuthorizationService
})

export const makeAuthorizationTestLayer = (
  initialGrants: ReadonlyArray<Schema.Schema.Type<typeof GrantCapabilityInput>> = [],
) => {
  const grants = new Set(
    initialGrants.map((grant) => `${grant.userAccountId}:${grant.tenantId}:${grant.capability}`),
  )
  const service: AuthorizationService = {
    authorize: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AuthorizationInput)(input)
        const key = `${decoded.principal.userAccountId}:${decoded.tenantId}:${decoded.capability}`
        if (!grants.has(key)) {
          return yield* Effect.fail(
            new AuthorizationDenied({
              tenantId: decoded.tenantId,
              capability: decoded.capability,
            }),
          )
        }
        return {
          allowed: true as const,
          tenantId: decoded.tenantId,
          capability: decoded.capability,
          grant: "membership" as const,
        }
      }),
    grant: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(GrantCapabilityInput)(input)
        const key = `${decoded.userAccountId}:${decoded.tenantId}:${decoded.capability}`
        if (grants.has(key)) return yield* Effect.fail(new CapabilityAlreadyGranted(decoded))
        grants.add(key)
      }),
  }
  return Layer.succeed(AuthorizationService, service)
}
