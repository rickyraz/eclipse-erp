import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { DatabaseFailure, type DatabaseService, drizzleSql } from "../../kernel/mod.ts"

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

const isDuplicateEmail = (error: unknown) => {
  if (!(error instanceof DatabaseFailure)) return false
  const cause = error.cause
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505" &&
    "constraint" in cause && cause.constraint === "identities_email_key"
}

export const makeIdentityService = (database: DatabaseService): IdentityService => ({
  create: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateIdentityInput)(input)
      const email = normalizeEmail(decoded.email)
      const rows = yield* database.execute<Identity>(
        drizzleSql`insert into identity.identities (id, email)
            values (${crypto.randomUUID()}, ${email})
            returning id, email`,
      ).pipe(
        Effect.catch((error) =>
          isDuplicateEmail(error) ? Effect.succeed<readonly Identity[]>([]) : Effect.fail(error)
        ),
      )
      const identity = rows[0]
      if (identity === undefined) return yield* Effect.fail(new IdentityAlreadyExists({ email }))
      return identity
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
