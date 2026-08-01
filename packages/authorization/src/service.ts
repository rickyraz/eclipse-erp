import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { memberships } from "../../../db/schema/authorization.ts"
import { Principal } from "../../auth/mod.ts"
import { DatabaseFailure, type DatabaseService, isDatabaseConstraint } from "../../kernel/mod.ts"

export const Capability = Schema.Literals([
  "auth.capability.grant",
  "identity.read",
  "identity.write",
  "sales.customer.create",
  "sales.quotation.create",
  "sales.order.create",
  "inventory.warehouse.create",
  "inventory.item.create",
  "inventory.stock.receive",
  "inventory.stock.reserve",
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
  identityId: Schema.String,
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
    identityId: Schema.String,
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

export const makeAuthorizationService = (database: DatabaseService): AuthorizationService => ({
  authorize: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(AuthorizationInput)(input)
      const rows = yield* database.query(
        (db) =>
          db.select({ identityId: memberships.identityId })
            .from(memberships)
            .where(
              and(
                eq(memberships.identityId, decoded.principal.identityId),
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
})

export const makeAuthorizationTestLayer = (
  initialGrants: ReadonlyArray<Schema.Schema.Type<typeof GrantCapabilityInput>> = [],
) => {
  const grants = new Set(
    initialGrants.map((grant) => `${grant.identityId}:${grant.tenantId}:${grant.capability}`),
  )
  const service: AuthorizationService = {
    authorize: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AuthorizationInput)(input)
        const key = `${decoded.principal.identityId}:${decoded.tenantId}:${decoded.capability}`
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
        const key = `${decoded.identityId}:${decoded.tenantId}:${decoded.capability}`
        if (grants.has(key)) return yield* Effect.fail(new CapabilityAlreadyGranted(decoded))
        grants.add(key)
      }),
  }
  return Layer.succeed(AuthorizationService, service)
}
