import * as Context from "effect/Context.ts"
import * as Effect from "effect/Effect.ts"
import * as Layer from "effect/Layer.ts"
import * as Schema from "effect/Schema.ts"

import {
  DatabaseFailure,
  type DatabaseService,
  type PostgresTransaction,
} from "../../kernel/mod.ts"

export const CreateIdentityInput = Schema.Struct({
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

export interface IdentityService {
  readonly create: (
    input: unknown,
  ) => Effect.Effect<Identity, IdentityAlreadyExists | DatabaseFailure | Schema.SchemaError>
}

export const IdentityService = Context.Service<IdentityService>("EclipseERP/IdentityService")

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const insertIdentity = async (
  transaction: PostgresTransaction,
  input: { readonly email: string },
): Promise<Identity | IdentityAlreadyExists> => {
  try {
    const rows = await transaction.unsafe<Identity>(
      "insert into identity.identities (id, email) values ($1, $2) returning id, email",
      [crypto.randomUUID(), input.email],
    )
    const identity = rows[0]
    if (!identity) throw new Error("identity insert returned no row")
    return identity
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "constraint" in cause &&
      cause.constraint === "identities_email_key"
    ) {
      return new IdentityAlreadyExists({ email: input.email })
    }
    throw cause
  }
}

export const makeIdentityService = (database: DatabaseService): IdentityService => ({
  create: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateIdentityInput)(input)
      const normalized = { email: normalizeEmail(decoded.email) }
      const result = yield* database.transaction((transaction) =>
        insertIdentity(transaction, normalized)
      )
      if (result instanceof IdentityAlreadyExists) return yield* Effect.fail(result)
      return result
    }),
})

export const makeIdentityTestLayer = () => {
  const emails = new Set<string>()
  let nextId = 1

  const service: IdentityService = {
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateIdentityInput)(input)
        const email = normalizeEmail(decoded.email)
        if (emails.has(email)) return yield* Effect.fail(new IdentityAlreadyExists({ email }))
        emails.add(email)
        return { id: String(nextId++), email }
      }),
  }

  return Layer.succeed(IdentityService, service)
}
