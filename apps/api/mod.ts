import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import postgres from "postgres"

import {
  Database,
  DatabaseFailure,
  makePostgresDatabase,
  type PostgresClient,
  PostgresDatabaseLive,
  validatePostgresVersion,
} from "../../packages/kernel/mod.ts"
import {
  IdentityAlreadyExists,
  IdentityService,
  makeIdentityService,
} from "../../packages/identity/mod.ts"

class InvalidJsonBody extends Schema.TaggedErrorClass<InvalidJsonBody>()("InvalidJsonBody", {}) {}

type ApiLayer = Layer.Layer<IdentityService>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })

const errorResponse = (error: unknown) => {
  if (error instanceof InvalidJsonBody) return json({ error: "invalid_json" }, 400)
  if (error instanceof IdentityAlreadyExists) {
    return json({ error: "identity_already_exists", email: error.email }, 409)
  }
  if (error instanceof Schema.SchemaError) return json({ error: "invalid_request" }, 400)
  if (error instanceof DatabaseFailure) return json({ error: "database_unavailable" }, 503)
  return json({ error: "internal_server_error" }, 500)
}

const requestEffect = (request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok" })
    if (request.method === "GET" && url.pathname === "/ready") return json({ status: "ready" })

    if (request.method === "POST" && url.pathname === "/identities") {
      const body = yield* Effect.tryPromise({
        try: () => request.json(),
        catch: () => new InvalidJsonBody({}),
      })
      const identity = yield* (yield* IdentityService).create(body)
      return json(identity, 201)
    }

    return json({ error: "not_found" }, 404)
  })

export const makeApiHandler = (layer: ApiLayer) => (request: Request) =>
  Effect.runPromise(requestEffect(request).pipe(Effect.provide(layer))).catch(errorResponse)

export const makeApiDatabase = (url: string) =>
  makePostgresDatabase(postgres(url) as unknown as PostgresClient)

export const startApi = (url: string, port = 8000) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))

      yield* validatePostgresVersion(client as unknown as PostgresClient)

      const databaseLayer = PostgresDatabaseLive(client as unknown as PostgresClient)
      const identityLayer = Layer.effect(
        IdentityService,
        Effect.map(Database, makeIdentityService),
      ).pipe(Layer.provide(databaseLayer))
      const server = Deno.serve({ port }, makeApiHandler(identityLayer))
      yield* Effect.promise(() => server.finished)
    }),
  )

if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL")
  if (url === undefined || url.trim() === "") {
    console.error("DATABASE_URL is required")
    Deno.exit(1)
  }

  await Effect.runPromise(startApi(url, Number.parseInt(Deno.env.get("PORT") ?? "8000", 10)))
}
