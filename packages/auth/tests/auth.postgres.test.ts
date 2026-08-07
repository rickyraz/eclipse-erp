import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { InvalidSessionToken, makeAuthService, SessionUserAccountDisabled } from "../mod.ts"
import { makeUserAccountService, UserAccountService } from "../../identity/mod.ts"
import { Database, makePostgresDatabase, runMigrations, WebCryptoLive } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "invalidates existing sessions when a PostgreSQL user account is disabled",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccounts = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const user = yield* userAccounts.create({ email: "session@example.test" })
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccounts),
        )

        const issued = yield* auth.issueSession({ userAccountId: user.id, ttlSeconds: 60 })
        assert.strictEqual((yield* auth.authenticate(issued.token)).userAccountId, user.id)

        yield* userAccounts.disable(user.id)
        assert.instanceOf(yield* Effect.flip(auth.authenticate(issued.token)), InvalidSessionToken)
        assert.instanceOf(
          yield* Effect.flip(auth.issueSession({ userAccountId: user.id, ttlSeconds: 60 })),
          SessionUserAccountDisabled,
        )

        yield* userAccounts.enable(user.id)
        const replacement = yield* auth.issueSession({ userAccountId: user.id, ttlSeconds: 60 })
        assert.strictEqual((yield* auth.authenticate(replacement.token)).userAccountId, user.id)
        assert.instanceOf(yield* Effect.flip(auth.authenticate(issued.token)), InvalidSessionToken)
      }))),
)
