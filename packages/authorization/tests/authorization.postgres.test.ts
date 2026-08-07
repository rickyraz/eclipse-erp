import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { makeAuthService } from "../../auth/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationService,
  TenantMembershipAlreadyExists,
  TenantMembershipUserAccountNotFound,
} from "../mod.ts"
import { makeUserAccountService, UserAccountService } from "../../identity/mod.ts"
import { Database, makePostgresDatabase, runMigrations, WebCryptoLive } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "enforces tenant membership lifecycle and capability scope in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccounts = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const user = yield* userAccounts.create({ email: "membership@example.test" })
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccounts),
        )
        const tenant = yield* auth.createTenant({ slug: `membership-${crypto.randomUUID()}` })
        const authorization = yield* makeAuthorizationService.pipe(
          Effect.provideService(Database, database),
        )
        const capability = "user_account.read" as const
        const principal = { userAccountId: user.id, sessionId: "membership-session" }

        yield* authorization.addMember({ userAccountId: user.id, tenantId: tenant.id })
        assert.instanceOf(
          yield* Effect.flip(authorization.addMember({
            userAccountId: user.id,
            tenantId: tenant.id,
          })),
          TenantMembershipAlreadyExists,
        )
        yield* authorization.grant({
          userAccountId: user.id,
          tenantId: tenant.id,
          capability,
        })
        assert.strictEqual(
          (yield* authorization.authorize({
            principal,
            tenantId: tenant.id,
            capability,
          })).allowed,
          true,
        )

        yield* authorization.suspendMember({ userAccountId: user.id, tenantId: tenant.id })
        assert.instanceOf(
          yield* Effect.flip(authorization.authorize({
            principal,
            tenantId: tenant.id,
            capability,
          })),
          AuthorizationDenied,
        )
        yield* authorization.activateMember({ userAccountId: user.id, tenantId: tenant.id })
        yield* authorization.removeMember({ userAccountId: user.id, tenantId: tenant.id })
        const remainingGrants = yield* Effect.promise(() =>
          client<{ capability: string }[]>`
          select capability
          from "authorization"."memberships"
          where user_account_id = ${user.id} and tenant_id = ${tenant.id}
        `
        )
        assert.deepStrictEqual(remainingGrants.map(({ capability: _ }) => _), [])
        assert.instanceOf(
          yield* Effect.flip(authorization.authorize({
            principal,
            tenantId: tenant.id,
            capability,
          })),
          AuthorizationDenied,
        )
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "maps missing membership user accounts in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccounts = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccounts),
        )
        const tenant = yield* auth.createTenant({ slug: `missing-member-${crypto.randomUUID()}` })
        const authorization = yield* makeAuthorizationService.pipe(
          Effect.provideService(Database, database),
        )
        const missingUser = "00000000-0000-0000-0000-000000000000"
        assert.instanceOf(
          yield* Effect.flip(authorization.addMember({
            userAccountId: missingUser,
            tenantId: tenant.id,
          })),
          TenantMembershipUserAccountNotFound,
        )
      })),
)
