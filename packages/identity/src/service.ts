import { eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { identities } from "../../../db/schema/identity.ts"
import { DatabaseFailure, type DatabaseService, isDatabaseConstraint } from "../../kernel/mod.ts"

export const CreateIdentityInput = Schema.Struct({
  email: Schema.String,
})

export const UpdateIdentityInput = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
})

export const Identity = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
})

export type Identity = Schema.Schema.Type<typeof Identity>

export class IdentityAlreadyExists
  extends Schema.TaggedErrorClass<IdentityAlreadyExists>()("IdentityAlreadyExists", {
    email: Schema.String,
  }) {}

export class IdentityNotFound
  extends Schema.TaggedErrorClass<IdentityNotFound>()("IdentityNotFound", {
    id: Schema.String,
  }) {}

type IdentityWriteFailure =
  | IdentityAlreadyExists
  | IdentityNotFound
  | DatabaseFailure
  | Schema.SchemaError

export interface IdentityService {
  readonly create: (
    input: unknown,
  ) => Effect.Effect<Identity, IdentityAlreadyExists | DatabaseFailure | Schema.SchemaError>
  readonly getById: (
    id: string,
  ) => Effect.Effect<Identity, IdentityNotFound | DatabaseFailure>
  readonly list: () => Effect.Effect<readonly Identity[], DatabaseFailure>
  readonly update: (input: unknown) => Effect.Effect<Identity, IdentityWriteFailure>
  readonly remove: (id: string) => Effect.Effect<void, IdentityNotFound | DatabaseFailure>
}

export const IdentityService = Context.Service<IdentityService>("EclipseERP/IdentityService")

const normalizeEmail = (email: string) => email.trim().toLowerCase()
const isDuplicateEmail = (error: unknown) => isDatabaseConstraint(error, "identities_email_key")

const selectIdentity = {
  id: identities.id,
  email: identities.email,
}

export const makeIdentityService = (database: DatabaseService): IdentityService => ({
  create: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateIdentityInput)(input)
      const email = normalizeEmail(decoded.email)
      const rows = yield* database.query(
        (db) =>
          db.insert(identities)
            .values({ email })
            .returning(selectIdentity),
        "identity.create",
      ).pipe(
        Effect.mapError((error) =>
          isDuplicateEmail(error) ? new IdentityAlreadyExists({ email }) : error
        ),
      )
      return rows[0]!
    }),
  getById: (id) =>
    Effect.gen(function* () {
      const rows = yield* database.query(
        (db) => db.select(selectIdentity).from(identities).where(eq(identities.id, id)),
        "identity.get",
      )
      const identity = rows[0]
      if (identity === undefined) return yield* Effect.fail(new IdentityNotFound({ id }))
      return identity
    }),
  list: () =>
    database.query(
      (db) =>
        db.select(selectIdentity).from(identities).orderBy(identities.createdAt, identities.id),
      "identity.list",
    ),
  update: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(UpdateIdentityInput)(input)
      const email = normalizeEmail(decoded.email)
      const rows = yield* database.query(
        (db) =>
          db.update(identities)
            .set({ email, updatedAt: new Date() })
            .where(eq(identities.id, decoded.id))
            .returning(selectIdentity),
        "identity.update",
      ).pipe(
        Effect.mapError((error) =>
          isDuplicateEmail(error) ? new IdentityAlreadyExists({ email }) : error
        ),
      )
      const identity = rows[0]
      if (identity === undefined) {
        return yield* Effect.fail(new IdentityNotFound({ id: decoded.id }))
      }
      return identity
    }),
  remove: (id) =>
    Effect.gen(function* () {
      const rows = yield* database.query(
        (db) => db.delete(identities).where(eq(identities.id, id)).returning({ id: identities.id }),
        "identity.remove",
      )
      if (rows[0] === undefined) return yield* Effect.fail(new IdentityNotFound({ id }))
    }),
})

export const makeIdentityTestLayer = () => {
  const stored = new Map<string, Identity>()
  const emails = new Set<string>()
  let nextId = 1

  const service: IdentityService = {
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateIdentityInput)(input)
        const email = normalizeEmail(decoded.email)
        if (emails.has(email)) return yield* Effect.fail(new IdentityAlreadyExists({ email }))
        const identity = { id: String(nextId++), email }
        emails.add(email)
        stored.set(identity.id, identity)
        return identity
      }),
    getById: (id) => {
      const identity = stored.get(id)
      return identity === undefined
        ? Effect.fail(new IdentityNotFound({ id }))
        : Effect.succeed(identity)
    },
    list: () => Effect.succeed([...stored.values()]),
    update: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(UpdateIdentityInput)(input)
        const current = stored.get(decoded.id)
        if (current === undefined) {
          return yield* Effect.fail(new IdentityNotFound({ id: decoded.id }))
        }
        const email = normalizeEmail(decoded.email)
        if (email !== current.email && emails.has(email)) {
          return yield* Effect.fail(new IdentityAlreadyExists({ email }))
        }
        emails.delete(current.email)
        emails.add(email)
        const identity = { id: current.id, email }
        stored.set(identity.id, identity)
        return identity
      }),
    remove: (id) => {
      const identity = stored.get(id)
      if (identity === undefined) return Effect.fail(new IdentityNotFound({ id }))
      stored.delete(id)
      emails.delete(identity.email)
      return Effect.void
    },
  }

  return Layer.succeed(IdentityService, service)
}
