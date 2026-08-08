import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { memberships, tenantMemberships } from "../../../db/schema/authorization.ts"
import { Principal } from "../../auth/mod.ts"
import {
  Database,
  DatabaseFailure,
  type DatabaseService,
  isDatabaseConstraint,
} from "../../kernel/mod.ts"
import { Capability as CapabilitySchema } from "./capabilities.ts"

export const Capability = CapabilitySchema
export type Capability = Schema.Schema.Type<typeof Capability>

export const TenantMembershipStatus = Schema.Literals(["active", "suspended"])
export type TenantMembershipStatus = Schema.Schema.Type<typeof TenantMembershipStatus>

export const TenantMembership = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
  status: TenantMembershipStatus,
})

export type TenantMembership = Schema.Schema.Type<typeof TenantMembership>

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

export const AddTenantMembershipInput = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
})

export const TenantMembershipInput = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
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

export class TenantMembershipAlreadyExists
  extends Schema.TaggedErrorClass<TenantMembershipAlreadyExists>()(
    "TenantMembershipAlreadyExists",
    {
      userAccountId: Schema.String,
      tenantId: Schema.String,
    },
  ) {}

export class TenantMembershipNotFound
  extends Schema.TaggedErrorClass<TenantMembershipNotFound>()("TenantMembershipNotFound", {
    userAccountId: Schema.String,
    tenantId: Schema.String,
  }) {}

export class TenantMembershipNotActive
  extends Schema.TaggedErrorClass<TenantMembershipNotActive>()("TenantMembershipNotActive", {
    userAccountId: Schema.String,
    tenantId: Schema.String,
  }) {}

export class TenantMembershipUserAccountNotFound
  extends Schema.TaggedErrorClass<TenantMembershipUserAccountNotFound>()(
    "TenantMembershipUserAccountNotFound",
    {
      userAccountId: Schema.String,
    },
  ) {}

export interface AuthorizationService {
  readonly authorize: (
    input: unknown,
  ) => Effect.Effect<
    Schema.Schema.Type<typeof AuthorizationDecision>,
    AuthorizationDenied | DatabaseFailure | Schema.SchemaError
  >
  readonly addMember: (
    input: unknown,
  ) => Effect.Effect<
    TenantMembership,
    | TenantMembershipAlreadyExists
    | TenantMembershipUserAccountNotFound
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly getMember: (
    input: unknown,
  ) => Effect.Effect<
    TenantMembership,
    TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly listMembers: (
    tenantId: string,
  ) => Effect.Effect<readonly TenantMembership[], DatabaseFailure>
  readonly suspendMember: (
    input: unknown,
  ) => Effect.Effect<
    TenantMembership,
    TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly activateMember: (
    input: unknown,
  ) => Effect.Effect<
    TenantMembership,
    TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly removeMember: (
    input: unknown,
  ) => Effect.Effect<void, TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError>
  readonly grant: (
    input: unknown,
  ) => Effect.Effect<
    void,
    | CapabilityAlreadyGranted
    | TenantMembershipNotFound
    | TenantMembershipNotActive
    | DatabaseFailure
    | Schema.SchemaError
  >
}

export const AuthorizationService = Context.Service<AuthorizationService>(
  "EclipseERP/AuthorizationService",
)

const membershipKey = (userAccountId: string, tenantId: string) => `${userAccountId}:${tenantId}`

const toTenantMembership = (row: {
  readonly userAccountId: string
  readonly tenantId: string
  readonly status: string
}): TenantMembership => ({
  userAccountId: row.userAccountId,
  tenantId: row.tenantId,
  status: row.status as TenantMembershipStatus,
})

const readMember = (database: DatabaseService, input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(TenantMembershipInput)(input)
    const rows = yield* database.query(
      (db) =>
        db.select({
          userAccountId: tenantMemberships.userAccountId,
          tenantId: tenantMemberships.tenantId,
          status: tenantMemberships.status,
        })
          .from(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.userAccountId, decoded.userAccountId),
              eq(tenantMemberships.tenantId, decoded.tenantId),
            ),
          ),
      "authorization.member.get",
    )
    const member = rows[0]
    if (member === undefined) {
      return yield* Effect.fail(new TenantMembershipNotFound(decoded))
    }
    return toTenantMembership(member)
  })

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
              .innerJoin(
                tenantMemberships,
                and(
                  eq(tenantMemberships.userAccountId, memberships.userAccountId),
                  eq(tenantMemberships.tenantId, memberships.tenantId),
                  eq(tenantMemberships.status, "active"),
                ),
              )
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
    addMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AddTenantMembershipInput)(input)
        const rows = yield* database.query(
          (db) =>
            db.insert(tenantMemberships).values(decoded).returning({
              userAccountId: tenantMemberships.userAccountId,
              tenantId: tenantMemberships.tenantId,
              status: tenantMemberships.status,
            }),
          "authorization.member.add",
        ).pipe(
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "tenant_memberships_user_account_id_fkey", "23503")) {
              return new TenantMembershipUserAccountNotFound({
                userAccountId: decoded.userAccountId,
              })
            }
            if (isDatabaseConstraint(error, "tenant_memberships_pkey")) {
              return new TenantMembershipAlreadyExists(decoded)
            }
            return error
          }),
        )
        return toTenantMembership(rows[0]!)
      }),
    getMember: (input) => readMember(database, input),
    listMembers: (tenantId) =>
      database.query(
        (db) =>
          db.select({
            userAccountId: tenantMemberships.userAccountId,
            tenantId: tenantMemberships.tenantId,
            status: tenantMemberships.status,
          })
            .from(tenantMemberships)
            .where(eq(tenantMemberships.tenantId, tenantId))
            .orderBy(tenantMemberships.userAccountId),
        "authorization.member.list",
      ).pipe(Effect.map((rows) => rows.map(toTenantMembership))),
    suspendMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TenantMembershipInput)(input)
        const rows = yield* database.query(
          (db) =>
            db.update(tenantMemberships)
              .set({ status: "suspended" })
              .where(
                and(
                  eq(tenantMemberships.userAccountId, decoded.userAccountId),
                  eq(tenantMemberships.tenantId, decoded.tenantId),
                ),
              )
              .returning({
                userAccountId: tenantMemberships.userAccountId,
                tenantId: tenantMemberships.tenantId,
                status: tenantMemberships.status,
              }),
          "authorization.member.suspend",
        )
        const member = rows[0]
        if (member === undefined) {
          return yield* Effect.fail(new TenantMembershipNotFound(decoded))
        }
        return toTenantMembership(member)
      }),
    activateMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TenantMembershipInput)(input)
        const rows = yield* database.query(
          (db) =>
            db.update(tenantMemberships)
              .set({ status: "active" })
              .where(
                and(
                  eq(tenantMemberships.userAccountId, decoded.userAccountId),
                  eq(tenantMemberships.tenantId, decoded.tenantId),
                ),
              )
              .returning({
                userAccountId: tenantMemberships.userAccountId,
                tenantId: tenantMemberships.tenantId,
                status: tenantMemberships.status,
              }),
          "authorization.member.activate",
        )
        const member = rows[0]
        if (member === undefined) {
          return yield* Effect.fail(new TenantMembershipNotFound(decoded))
        }
        return toTenantMembership(member)
      }),
    removeMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TenantMembershipInput)(input)
        const rows = yield* database.query(
          (db) =>
            db.delete(tenantMemberships)
              .where(
                and(
                  eq(tenantMemberships.userAccountId, decoded.userAccountId),
                  eq(tenantMemberships.tenantId, decoded.tenantId),
                ),
              )
              .returning({ userAccountId: tenantMemberships.userAccountId }),
          "authorization.member.remove",
        )
        if (rows[0] === undefined) {
          return yield* Effect.fail(new TenantMembershipNotFound(decoded))
        }
      }),
    grant: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(GrantCapabilityInput)(input)
        const member = yield* readMember(database, decoded)
        if (member.status !== "active") {
          return yield* Effect.fail(
            new TenantMembershipNotActive({
              userAccountId: decoded.userAccountId,
              tenantId: decoded.tenantId,
            }),
          )
        }
        yield* database.query(
          (db) => db.insert(memberships).values(decoded),
          "authorization.grant",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "memberships_pkey")
              ? new CapabilityAlreadyGranted(decoded)
              : isDatabaseConstraint(error, "memberships_tenant_membership_fkey", "23503")
              ? new TenantMembershipNotFound({
                userAccountId: decoded.userAccountId,
                tenantId: decoded.tenantId,
              })
              : error
          ),
        )
      }),
  } satisfies AuthorizationService
})

export const makeAuthorizationTestLayer = (
  initialGrants: ReadonlyArray<Schema.Schema.Type<typeof GrantCapabilityInput>> = [],
) => {
  const membershipsStore = new Map<string, TenantMembership>()
  const grants = new Set<string>()

  for (const grant of initialGrants) {
    const key = membershipKey(grant.userAccountId, grant.tenantId)
    membershipsStore.set(key, {
      userAccountId: grant.userAccountId,
      tenantId: grant.tenantId,
      status: "active",
    })
    grants.add(`${key}:${grant.capability}`)
  }

  const member = (input: Schema.Schema.Type<typeof TenantMembershipInput>) => {
    const found = membershipsStore.get(membershipKey(input.userAccountId, input.tenantId))
    return found === undefined
      ? Effect.fail(new TenantMembershipNotFound(input))
      : Effect.succeed(found)
  }

  const service: AuthorizationService = {
    authorize: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AuthorizationInput)(input)
        const current = membershipsStore.get(
          membershipKey(decoded.principal.userAccountId, decoded.tenantId),
        )
        const key = `${
          membershipKey(decoded.principal.userAccountId, decoded.tenantId)
        }:${decoded.capability}`
        if (current?.status !== "active" || !grants.has(key)) {
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
    addMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AddTenantMembershipInput)(input)
        const key = membershipKey(decoded.userAccountId, decoded.tenantId)
        if (membershipsStore.has(key)) {
          return yield* Effect.fail(new TenantMembershipAlreadyExists(decoded))
        }
        const created = { ...decoded, status: "active" as const }
        membershipsStore.set(key, created)
        return created
      }),
    getMember: (input) =>
      Schema.decodeUnknownEffect(TenantMembershipInput)(input).pipe(Effect.flatMap(member)),
    listMembers: (tenantId) =>
      Effect.succeed(
        [...membershipsStore.values()].filter((member) => member.tenantId === tenantId),
      ),
    suspendMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TenantMembershipInput)(input)
        const current = yield* member(decoded)
        const updated = { ...current, status: "suspended" as const }
        membershipsStore.set(membershipKey(decoded.userAccountId, decoded.tenantId), updated)
        return updated
      }),
    activateMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TenantMembershipInput)(input)
        const current = yield* member(decoded)
        const updated = { ...current, status: "active" as const }
        membershipsStore.set(membershipKey(decoded.userAccountId, decoded.tenantId), updated)
        return updated
      }),
    removeMember: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TenantMembershipInput)(input)
        const key = membershipKey(decoded.userAccountId, decoded.tenantId)
        if (!membershipsStore.delete(key)) {
          return yield* Effect.fail(new TenantMembershipNotFound(decoded))
        }
        for (const grant of [...grants]) {
          if (grant.startsWith(`${key}:`)) grants.delete(grant)
        }
      }),
    grant: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(GrantCapabilityInput)(input)
        const current = yield* member(decoded)
        if (current.status !== "active") {
          return yield* Effect.fail(
            new TenantMembershipNotActive({
              userAccountId: decoded.userAccountId,
              tenantId: decoded.tenantId,
            }),
          )
        }
        const key = `${
          membershipKey(decoded.userAccountId, decoded.tenantId)
        }:${decoded.capability}`
        if (grants.has(key)) return yield* Effect.fail(new CapabilityAlreadyGranted(decoded))
        grants.add(key)
      }),
  }
  return Layer.succeed(AuthorizationService, service)
}
