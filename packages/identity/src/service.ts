import { eq, inArray } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { userAccounts } from "../../../db/schema/identity.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

export const UserAccountStatus = Schema.Literals(["active", "disabled"])
export type UserAccountStatus = Schema.Schema.Type<typeof UserAccountStatus>

export const CreateUserAccountInput = Schema.Struct({
  email: Schema.String.check(Schema.isPattern(/\S/)),
})

export const UpdateUserAccountInput = Schema.Struct({
  id: Schema.String,
  email: Schema.String.check(Schema.isPattern(/\S/)),
})

export const UserAccount = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  status: UserAccountStatus,
})

export const UserAccountAuthenticationState = Schema.Struct({
  id: Schema.String,
  status: UserAccountStatus,
  sessionInvalidatedAt: Schema.NullOr(Schema.String),
})

export type UserAccount = Schema.Schema.Type<typeof UserAccount>
export type UserAccountAuthenticationState = Schema.Schema.Type<
  typeof UserAccountAuthenticationState
>

export class UserAccountAlreadyExists
  extends Schema.TaggedErrorClass<UserAccountAlreadyExists>()("UserAccountAlreadyExists", {
    email: Schema.String,
  }) {}

export class UserAccountNotFound
  extends Schema.TaggedErrorClass<UserAccountNotFound>()("UserAccountNotFound", {
    id: Schema.String,
  }) {}

type UserAccountWriteFailure =
  | UserAccountAlreadyExists
  | UserAccountNotFound
  | DatabaseFailure
  | Schema.SchemaError

export interface UserAccountService {
  readonly create: (
    input: unknown,
  ) => Effect.Effect<UserAccount, UserAccountAlreadyExists | DatabaseFailure | Schema.SchemaError>
  readonly getById: (
    id: string,
  ) => Effect.Effect<UserAccount, UserAccountNotFound | DatabaseFailure>
  readonly getByIds: (
    ids: readonly string[],
  ) => Effect.Effect<readonly UserAccount[], DatabaseFailure>
  readonly getAuthenticationState: (
    id: string,
  ) => Effect.Effect<UserAccountAuthenticationState, UserAccountNotFound | DatabaseFailure>
  readonly list: () => Effect.Effect<readonly UserAccount[], DatabaseFailure>
  readonly update: (input: unknown) => Effect.Effect<UserAccount, UserAccountWriteFailure>
  readonly disable: (
    id: string,
  ) => Effect.Effect<UserAccount, UserAccountNotFound | DatabaseFailure>
  readonly enable: (id: string) => Effect.Effect<UserAccount, UserAccountNotFound | DatabaseFailure>
  readonly remove: (id: string) => Effect.Effect<void, UserAccountNotFound | DatabaseFailure>
}

export const UserAccountService = Context.Service<UserAccountService>(
  "EclipseERP/UserAccountService",
)

const normalizeEmail = (email: string) => email.trim().toLowerCase()
const isDuplicateEmail = (error: unknown) => isDatabaseConstraint(error, "user_accounts_email_key")

const selectUserAccount = {
  id: userAccounts.id,
  email: userAccounts.email,
  status: userAccounts.status,
}

const selectAuthenticationState = {
  id: userAccounts.id,
  status: userAccounts.status,
  sessionInvalidatedAt: userAccounts.sessionInvalidatedAt,
}

const toUserAccount = (row: {
  readonly id: string
  readonly email: string
  readonly status: string
}): UserAccount => ({
  id: row.id,
  email: row.email,
  status: row.status as UserAccountStatus,
})

const toAuthenticationState = (row: {
  readonly id: string
  readonly status: string
  readonly sessionInvalidatedAt: Date | null
}): UserAccountAuthenticationState => ({
  id: row.id,
  status: row.status as UserAccountStatus,
  sessionInvalidatedAt: row.sessionInvalidatedAt === null
    ? null
    : row.sessionInvalidatedAt.toISOString(),
})

export const makeUserAccountService = Effect.gen(function* () {
  const database = yield* Database
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())
  return {
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateUserAccountInput)(input)
        const email = normalizeEmail(decoded.email)
        const rows = yield* database.query(
          (db) => db.insert(userAccounts).values({ email }).returning(selectUserAccount),
          "user-account.create",
        ).pipe(
          Effect.mapError((error) =>
            isDuplicateEmail(error) ? new UserAccountAlreadyExists({ email }) : error
          ),
        )
        return toUserAccount(rows[0]!)
      }),
    getById: (id) =>
      Effect.gen(function* () {
        const rows = yield* database.query(
          (db) => db.select(selectUserAccount).from(userAccounts).where(eq(userAccounts.id, id)),
          "user-account.get",
        )
        const userAccount = rows[0]
        if (userAccount === undefined) {
          return yield* Effect.fail(new UserAccountNotFound({ id }))
        }
        return toUserAccount(userAccount)
      }),
    getByIds: (ids) =>
      ids.length === 0 ? Effect.succeed([]) : database.query(
        (db) =>
          db.select(selectUserAccount).from(userAccounts).where(inArray(userAccounts.id, ids))
            .orderBy(userAccounts.createdAt, userAccounts.id),
        "user-account.get-many",
      ).pipe(Effect.map((rows) => rows.map(toUserAccount))),
    getAuthenticationState: (id) =>
      Effect.gen(function* () {
        const rows = yield* database.query(
          (db) =>
            db.select(selectAuthenticationState).from(userAccounts).where(eq(userAccounts.id, id)),
          "user-account.authentication-state",
        )
        const state = rows[0]
        if (state === undefined) {
          return yield* Effect.fail(new UserAccountNotFound({ id }))
        }
        return toAuthenticationState(state)
      }),
    list: () =>
      database.query(
        (db) =>
          db.select(selectUserAccount).from(userAccounts).orderBy(
            userAccounts.createdAt,
            userAccounts.id,
          ),
        "user-account.list",
      ).pipe(Effect.map((rows) => rows.map(toUserAccount))),
    update: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(UpdateUserAccountInput)(input)
        const email = normalizeEmail(decoded.email)
        const rows = yield* database.query(
          (db) =>
            db.update(userAccounts)
              .set({ email, updatedAt: now() })
              .where(eq(userAccounts.id, decoded.id))
              .returning(selectUserAccount),
          "user-account.update",
        ).pipe(
          Effect.mapError((error) =>
            isDuplicateEmail(error) ? new UserAccountAlreadyExists({ email }) : error
          ),
        )
        const userAccount = rows[0]
        if (userAccount === undefined) {
          return yield* Effect.fail(new UserAccountNotFound({ id: decoded.id }))
        }
        return toUserAccount(userAccount)
      }),
    disable: (id) =>
      Effect.gen(function* () {
        const timestamp = now()
        const rows = yield* database.query(
          (db) =>
            db.update(userAccounts)
              .set({
                status: "disabled",
                disabledAt: timestamp,
                sessionInvalidatedAt: timestamp,
                updatedAt: timestamp,
              })
              .where(eq(userAccounts.id, id))
              .returning(selectUserAccount),
          "user-account.disable",
        )
        const userAccount = rows[0]
        if (userAccount === undefined) {
          return yield* Effect.fail(new UserAccountNotFound({ id }))
        }
        return toUserAccount(userAccount)
      }),
    enable: (id) =>
      Effect.gen(function* () {
        const rows = yield* database.query(
          (db) =>
            db.update(userAccounts)
              .set({ status: "active", disabledAt: null, updatedAt: now() })
              .where(eq(userAccounts.id, id))
              .returning(selectUserAccount),
          "user-account.enable",
        )
        const userAccount = rows[0]
        if (userAccount === undefined) {
          return yield* Effect.fail(new UserAccountNotFound({ id }))
        }
        return toUserAccount(userAccount)
      }),
    remove: (id) =>
      Effect.gen(function* () {
        const rows = yield* database.query(
          (db) =>
            db.delete(userAccounts).where(eq(userAccounts.id, id)).returning({
              id: userAccounts.id,
            }),
          "user-account.remove",
        )
        if (rows[0] === undefined) {
          return yield* Effect.fail(new UserAccountNotFound({ id }))
        }
      }),
  } satisfies UserAccountService
})

export const makeUserAccountTestLayer = () => {
  const stored = new Map<string, UserAccount>()
  const sessionInvalidatedAt = new Map<string, string | null>()
  const emails = new Set<string>()
  let nextId = 1

  const find = (id: string): Effect.Effect<UserAccount, UserAccountNotFound> => {
    const userAccount = stored.get(id)
    return userAccount === undefined
      ? Effect.fail(new UserAccountNotFound({ id }))
      : Effect.succeed(userAccount)
  }

  const service: UserAccountService = {
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateUserAccountInput)(input)
        const email = normalizeEmail(decoded.email)
        if (emails.has(email)) {
          return yield* Effect.fail(new UserAccountAlreadyExists({ email }))
        }
        const userAccount = { id: String(nextId++), email, status: "active" as const }
        emails.add(email)
        stored.set(userAccount.id, userAccount)
        sessionInvalidatedAt.set(userAccount.id, null)
        return userAccount
      }),
    getById: find,
    getByIds: (ids) =>
      Effect.succeed(ids.flatMap((id) => {
        const userAccount = stored.get(id)
        return userAccount === undefined ? [] : [userAccount]
      })),
    getAuthenticationState: (id) =>
      find(id).pipe(
        Effect.map((userAccount) => ({
          id: userAccount.id,
          status: userAccount.status,
          sessionInvalidatedAt: sessionInvalidatedAt.get(id) ?? null,
        })),
      ),
    list: () => Effect.succeed([...stored.values()]),
    update: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(UpdateUserAccountInput)(input)
        const current = yield* find(decoded.id)
        const email = normalizeEmail(decoded.email)
        if (email !== current.email && emails.has(email)) {
          return yield* Effect.fail(new UserAccountAlreadyExists({ email }))
        }
        emails.delete(current.email)
        emails.add(email)
        const userAccount = { ...current, email }
        stored.set(userAccount.id, userAccount)
        return userAccount
      }),
    disable: (id) =>
      Effect.gen(function* () {
        const current = yield* find(id)
        stored.set(id, { ...current, status: "disabled" })
        sessionInvalidatedAt.set(id, new Date().toISOString())
        return { ...current, status: "disabled" as const }
      }),
    enable: (id) =>
      find(id).pipe(
        Effect.map((current) => {
          const userAccount = { ...current, status: "active" as const }
          stored.set(id, userAccount)
          return userAccount
        }),
      ),
    remove: (id) =>
      Effect.gen(function* () {
        const userAccount = yield* find(id)
        stored.delete(id)
        sessionInvalidatedAt.delete(id)
        emails.delete(userAccount.email)
      }),
  }

  return Layer.succeed(UserAccountService, service)
}
