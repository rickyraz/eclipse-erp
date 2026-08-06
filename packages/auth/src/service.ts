import { and, eq, gt, isNull } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { sessions, tenants } from "../../../db/schema/auth.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

const PositiveSeconds = Schema.Int.check(Schema.isGreaterThan(0))
const NonBlankString = Schema.String.check(Schema.isPattern(/\S/))

export const CreateTenantInput = Schema.Struct({
  slug: Schema.String,
  timezone: Schema.optionalKey(NonBlankString),
})
export const IssueSessionInput = Schema.Struct({
  identityId: Schema.String,
  ttlSeconds: PositiveSeconds,
})

export const Tenant = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  timezone: Schema.String,
})

export const Session = Schema.Struct({
  id: Schema.String,
  identityId: Schema.String,
  expiresAt: Schema.String,
})

export const Principal = Schema.Struct({
  identityId: Schema.String,
  sessionId: Schema.String,
})

export type Tenant = Schema.Schema.Type<typeof Tenant>
export type Session = Schema.Schema.Type<typeof Session>
export type Principal = Schema.Schema.Type<typeof Principal>

export class TenantAlreadyExists
  extends Schema.TaggedErrorClass<TenantAlreadyExists>()("TenantAlreadyExists", {
    slug: Schema.String,
  }) {}

export class SessionIdentityNotFound
  extends Schema.TaggedErrorClass<SessionIdentityNotFound>()("SessionIdentityNotFound", {
    identityId: Schema.String,
  }) {}

export class InvalidSessionToken
  extends Schema.TaggedErrorClass<InvalidSessionToken>()("InvalidSessionToken", {}) {}

export interface IssuedSession {
  readonly token: string
  readonly session: Session
}

export interface AuthService {
  readonly createTenant: (
    input: unknown,
  ) => Effect.Effect<Tenant, TenantAlreadyExists | DatabaseFailure | Schema.SchemaError>
  readonly issueSession: (
    input: unknown,
  ) => Effect.Effect<IssuedSession, SessionIdentityNotFound | DatabaseFailure | Schema.SchemaError>
  readonly authenticate: (
    token: string,
  ) => Effect.Effect<Principal, InvalidSessionToken | DatabaseFailure>
  readonly revoke: (
    sessionId: string,
  ) => Effect.Effect<void, InvalidSessionToken | DatabaseFailure>
}

export const AuthService = Context.Service<AuthService>("EclipseERP/AuthService")

const encodeToken = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")

const makeToken = (crypto: Crypto.Crypto) =>
  crypto.randomBytes(32).pipe(
    Effect.map(encodeToken),
    Effect.mapError((cause) => new DatabaseFailure({ operation: "session-token-generate", cause })),
  )

const hashToken = (crypto: Crypto.Crypto, token: string) =>
  crypto.digest("SHA-256", new TextEncoder().encode(token)).pipe(
    Effect.map((digest) =>
      Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
    ),
    Effect.mapError((cause) => new DatabaseFailure({ operation: "session-token-hash", cause })),
  )

const isMissingIdentity = (error: unknown) =>
  isDatabaseConstraint(error, "sessions_identity_id_fkey", "23503")

export const makeAuthService = Effect.gen(function* () {
  const database = yield* Database
  const crypto = yield* Crypto.Crypto
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())
  return {
  createTenant: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateTenantInput)(input)
      const slug = decoded.slug.trim().toLowerCase()
      const timezone = decoded.timezone?.trim() ?? "UTC"
      const rows = yield* database.query(
        (db) =>
          db.insert(tenants)
            .values({ slug, timezone })
            .returning({ id: tenants.id, slug: tenants.slug, timezone: tenants.timezone }),
        "tenant.create",
      ).pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "tenants_slug_key")
            ? new TenantAlreadyExists({ slug })
            : error
        ),
      )
      return rows[0]!
    }),
  issueSession: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(IssueSessionInput)(input)
      const token = yield* makeToken(crypto)
      const tokenHash = yield* hashToken(crypto, token)
      const expiresAt = new Date(clock.currentTimeMillisUnsafe() + decoded.ttlSeconds * 1000)
      const rows = yield* database.query(
        (db) =>
          db.insert(sessions)
            .values({
              identityId: decoded.identityId,
              tokenHash,
              expiresAt,
            })
            .returning({
              id: sessions.id,
              identityId: sessions.identityId,
              expiresAt: sessions.expiresAt,
            }),
        "session.issue",
      ).pipe(
        Effect.mapError((error) =>
          isMissingIdentity(error)
            ? new SessionIdentityNotFound({ identityId: decoded.identityId })
            : error
        ),
      )
      const row = rows[0]!
      return {
        token,
        session: {
          id: row.id,
          identityId: row.identityId,
          expiresAt: row.expiresAt.toISOString(),
        },
      }
    }),
  authenticate: (token) =>
    Effect.gen(function* () {
      const tokenHash = yield* hashToken(crypto, token)
      const rows = yield* database.query(
        (db) =>
          db.select({ id: sessions.id, identityId: sessions.identityId })
            .from(sessions)
            .where(
              and(
                eq(sessions.tokenHash, tokenHash),
                isNull(sessions.revokedAt),
                gt(sessions.expiresAt, now()),
              ),
            ),
        "session.authenticate",
      )
      const row = rows[0]
      if (row === undefined) return yield* Effect.fail(new InvalidSessionToken({}))
      return { identityId: row.identityId, sessionId: row.id }
    }),
  revoke: (sessionId) =>
    Effect.gen(function* () {
      const rows = yield* database.query(
        (db) =>
          db.update(sessions)
            .set({ revokedAt: now(), updatedAt: now() })
            .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
            .returning({ id: sessions.id }),
        "session.revoke",
      )
      if (rows[0] === undefined) return yield* Effect.fail(new InvalidSessionToken({}))
    }),
  } satisfies AuthService
})

export const makeAuthTestLayer = (validIdentityIds?: ReadonlySet<string>) =>
  Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const storedTenants = new Map<string, Tenant>()
      const storedSessions = new Map<
        string,
        { identityId: string; sessionId: string; expiresAt: number }
      >()
      let nextTenantId = 1
      let nextSessionId = 1
      const service: AuthService = {
        createTenant: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateTenantInput)(input)
            const slug = decoded.slug.trim().toLowerCase()
            const timezone = decoded.timezone?.trim() ?? "UTC"
            if ([...storedTenants.values()].some((tenant) => tenant.slug === slug)) {
              return yield* Effect.fail(new TenantAlreadyExists({ slug }))
            }
            const tenant = { id: `tenant-${nextTenantId++}`, slug, timezone }
            storedTenants.set(tenant.id, tenant)
            return tenant
          }),
        issueSession: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(IssueSessionInput)(input)
            if (validIdentityIds !== undefined && !validIdentityIds.has(decoded.identityId)) {
              return yield* Effect.fail(
                new SessionIdentityNotFound({ identityId: decoded.identityId }),
              )
            }
            const sequence = nextSessionId++
            const token = `test-token-${sequence}`
            const sessionId = `session-${sequence}`
            const expiresAt = clock.currentTimeMillisUnsafe() + decoded.ttlSeconds * 1000
            storedSessions.set(token, { identityId: decoded.identityId, sessionId, expiresAt })
            return {
              token,
              session: {
                id: sessionId,
                identityId: decoded.identityId,
                expiresAt: new Date(expiresAt).toISOString(),
              },
            }
          }),
        authenticate: (token) => {
          const session = storedSessions.get(token)
          return session === undefined || session.expiresAt <= clock.currentTimeMillisUnsafe()
            ? Effect.fail(new InvalidSessionToken({}))
            : Effect.succeed({ identityId: session.identityId, sessionId: session.sessionId })
        },
        revoke: (sessionId) => {
          for (const [token, session] of storedSessions) {
            if (session.sessionId === sessionId) {
              storedSessions.delete(token)
              return Effect.void
            }
          }
          return Effect.fail(new InvalidSessionToken({}))
        },
      }
      return service
    }),
  )
