import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder"
import * as HttpApiScalar from "effect/unstable/httpapi/HttpApiScalar"
import { createServer } from "node:http"
import postgres, { type Sql } from "postgres"

import { AuthService, makeAuthService } from "../../packages/auth/mod.ts"
import { AuthorizationService, makeAuthorizationService } from "../../packages/authorization/mod.ts"
import { IdentityService, makeIdentityService } from "../../packages/identity/mod.ts"
import {
  Database,
  type PostgresClient,
  PostgresDatabaseLive,
  validatePostgresVersion,
} from "../../packages/kernel/mod.ts"
import { makePartyService, PartyService } from "../../packages/party/mod.ts"
import { makeSalesService, SalesService } from "../../packages/sales/mod.ts"
import { InventoryService, makeInventoryService } from "../../packages/inventory/mod.ts"
import { AccountingService, makeAccountingService } from "../../packages/accounting/mod.ts"
import { EclipseApi } from "./api.ts"
import { ApiHandlers, BearerAuthLive } from "./handlers.ts"

const serviceLayers = (client: Sql) => {
  const database = PostgresDatabaseLive(client)

  const identity = Layer.effect(
    IdentityService,
    Database.use((service) => Effect.succeed(makeIdentityService(service))),
  ).pipe(Layer.provide(database))

  const auth = Layer.effect(
    AuthService,
    Database.use((service) => Effect.succeed(makeAuthService(service))),
  ).pipe(Layer.provide(database))

  const authorization = Layer.effect(
    AuthorizationService,
    Database.use((service) => Effect.succeed(makeAuthorizationService(service))),
  ).pipe(Layer.provide(database))

  const businessRequirements = Layer.merge(database, authorization)

  const party = Layer.effect(
    PartyService,
    Effect.gen(function* () {
      return makePartyService(yield* Database, yield* AuthorizationService)
    }),
  ).pipe(Layer.provide(businessRequirements))

  const sales = Layer.effect(
    SalesService,
    Effect.gen(function* () {
      return makeSalesService(yield* Database, yield* AuthorizationService)
    }),
  ).pipe(Layer.provide(businessRequirements))

  const inventory = Layer.effect(
    InventoryService,
    Effect.gen(function* () {
      return makeInventoryService(yield* Database, yield* AuthorizationService)
    }),
  ).pipe(Layer.provide(businessRequirements))

  const accounting = Layer.effect(
    AccountingService,
    Effect.gen(function* () {
      return makeAccountingService(yield* Database, yield* AuthorizationService)
    }),
  ).pipe(Layer.provide(businessRequirements))

  return Layer.mergeAll(identity, auth, authorization, party, sales, inventory, accounting)
}

export const makeApiLayer = (client: Sql, port = 8000) => {
  const services = serviceLayers(client)
  const authMiddleware = BearerAuthLive.pipe(Layer.provide(services))
  const handlers = ApiHandlers.pipe(
    Layer.provide(authMiddleware),
    Layer.provide(services),
  )

  return HttpApiBuilder.layer(EclipseApi).pipe(
    Layer.provide(handlers),
    Layer.provide(HttpApiScalar.layer(EclipseApi)),
    HttpRouter.serve,
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(services),
  )
}

export const startApi = (url: string, port = 8000) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))
      yield* validatePostgresVersion(client as unknown as PostgresClient)
      yield* Layer.launch(makeApiLayer(client, port))
    }),
  )

if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL")
  if (url === undefined || url.trim() === "") {
    console.error("DATABASE_URL is required")
    Deno.exit(1)
  }
  const port = Number.parseInt(Deno.env.get("PORT") ?? "8000", 10)
  startApi(url, port).pipe(NodeRuntime.runMain)
}
