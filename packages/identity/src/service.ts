import { eq } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { userAccounts } from "../../../db/schema/identity.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

export const CreateUserAccountInput = Schema.Struct({
  email: Schema.String,
})

export const UpdateUserAccountInput = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
})

export const UserAccount = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
})

export type UserAccount = Schema.Schema.Type<typeof UserAccount>

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
  readonly list: () => Effect.Effect<readonly UserAccount[], DatabaseFailure>
  readonly update: (input: unknown) => Effect.Effect<UserAccount, UserAccountWriteFailure>
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
}

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
          (db) =>
            db.insert(userAccounts)
              .values({ email })
              .returning(selectUserAccount),
          "user-account.create",
        ).pipe(
          Effect.mapError((error) =>
            isDuplicateEmail(error) ? new UserAccountAlreadyExists({ email }) : error
          ),
        )
        return rows[0]!
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
        return userAccount
      }),
    list: () =>
      database.query(
        (db) =>
          db.select(selectUserAccount).from(userAccounts).orderBy(
            userAccounts.createdAt,
            userAccounts.id,
          ),
        "user-account.list",
      ),
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
        return userAccount
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
  const emails = new Set<string>()
  let nextId = 1

  const service: UserAccountService = {
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateUserAccountInput)(input)
        const email = normalizeEmail(decoded.email)
        if (emails.has(email)) {
          return yield* Effect.fail(new UserAccountAlreadyExists({ email }))
        }
        const userAccount = { id: String(nextId++), email }
        emails.add(email)
        stored.set(userAccount.id, userAccount)
        return userAccount
      }),
    getById: (id) => {
      const userAccount = stored.get(id)
      return userAccount === undefined
        ? Effect.fail(new UserAccountNotFound({ id }))
        : Effect.succeed(userAccount)
    },
    list: () => Effect.succeed([...stored.values()]),
    update: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(UpdateUserAccountInput)(input)
        const current = stored.get(decoded.id)
        if (current === undefined) {
          return yield* Effect.fail(new UserAccountNotFound({ id: decoded.id }))
        }
        const email = normalizeEmail(decoded.email)
        if (email !== current.email && emails.has(email)) {
          return yield* Effect.fail(new UserAccountAlreadyExists({ email }))
        }
        emails.delete(current.email)
        emails.add(email)
        const userAccount = { id: current.id, email }
        stored.set(userAccount.id, userAccount)
        return userAccount
      }),
    remove: (id) => {
      const userAccount = stored.get(id)
      if (userAccount === undefined) return Effect.fail(new UserAccountNotFound({ id }))
      stored.delete(id)
      emails.delete(userAccount.email)
      return Effect.void
    },
  }

  return Layer.succeed(UserAccountService, service)
}
