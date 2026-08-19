import "../../tooling/load-env.ts"
import * as DenoHttpServer from "@effect/platform-deno/DenoHttpServer"
import * as DenoRuntime from "@effect/platform-deno/DenoRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder"
import * as HttpApiScalar from "effect/unstable/httpapi/HttpApiScalar"
import postgres, { type Sql } from "postgres"

import { type PostgresClient, validatePostgresVersion } from "../../packages/kernel/mod.ts"
import { RitseiApi } from "./api.ts"
import { ApiHandlers, BearerAuthLive } from "./handlers.ts"
import { serviceLayers } from "../runtime.ts"
import { readRuntimeConfiguration, type RitseiRuntimeConfiguration } from "../runtime-config.ts"

export { serviceLayers } from "../runtime.ts"

export const makeApiLayer = (
  client: Sql,
  configuration: RitseiRuntimeConfiguration,
  port = 8000,
) => {
  const services = serviceLayers(client, configuration)
  const authMiddleware = BearerAuthLive.pipe(Layer.provide(services))
  const handlers = ApiHandlers.pipe(
    Layer.provide(authMiddleware),
    Layer.provide(services),
  )

  return HttpApiBuilder.layer(RitseiApi).pipe(
    Layer.provide(handlers),
    Layer.provide(HttpApiScalar.layer(RitseiApi)),
    HttpRouter.serve,
    Layer.provide(DenoHttpServer.layer({ port })),
    Layer.provide(services),
  )
}

export const startApi = (url: string, port = 8000) =>
  Effect.scoped(
    Effect.gen(function* () {
      const configuration = yield* readRuntimeConfiguration()
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))
      yield* validatePostgresVersion(client as unknown as PostgresClient)
      yield* Layer.launch(makeApiLayer(client, configuration, port))
    }),
  )

if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL")
  if (url === undefined || url.trim() === "") {
    console.error("DATABASE_URL is required")
    Deno.exit(1)
  }
  const port = Number.parseInt(Deno.env.get("PORT") ?? "8000", 10)
  startApi(url, port).pipe(DenoRuntime.runMain)
}
