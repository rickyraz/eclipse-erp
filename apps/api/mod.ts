import "../../tooling/load-env.ts"
import * as DenoHttpServer from "@effect/platform-deno/DenoHttpServer"
import * as DenoRuntime from "@effect/platform-deno/DenoRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder"
import * as HttpApiScalar from "effect/unstable/httpapi/HttpApiScalar"
import postgres, { type Sql } from "postgres"

import { AuthService, makeAuthService } from "../../packages/auth/mod.ts"
import { AuthorizationService, makeAuthorizationService } from "../../packages/authorization/mod.ts"
import { makeUserAccountService, UserAccountService } from "../../packages/identity/mod.ts"
import {
  type PostgresClient,
  PostgresDatabaseLive,
  validatePostgresVersion,
  WebCryptoLive,
} from "../../packages/kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../packages/messaging/mod.ts"
import { makePartyService, PartyService } from "../../packages/party/mod.ts"
import { makeSalesService, SalesService } from "../../packages/sales/mod.ts"
import { InventoryService, makeInventoryService } from "../../packages/inventory/mod.ts"
import { AccountingService, makeAccountingService } from "../../packages/accounting/mod.ts"
import { makeProcessService, ProcessService } from "../../packages/process/mod.ts"
import { EclipseApi } from "./api.ts"
import { ApiHandlers, BearerAuthLive } from "./handlers.ts"

const serviceLayers = (client: Sql) => {
  const database = PostgresDatabaseLive(client)

  const userAccount = Layer.effect(UserAccountService, makeUserAccountService).pipe(
    Layer.provide(database),
  )

  const auth = Layer.effect(AuthService, makeAuthService).pipe(
    Layer.provide(Layer.mergeAll(database, WebCryptoLive, userAccount)),
  )

  const authorization = Layer.effect(AuthorizationService, makeAuthorizationService).pipe(
    Layer.provide(database),
  )

  const businessRequirements = Layer.merge(database, authorization)

  const party = Layer.effect(PartyService, makePartyService).pipe(
    Layer.provide(businessRequirements),
  )

  const sales = Layer.effect(SalesService, makeSalesService).pipe(
    Layer.provide(businessRequirements),
  )

  const inventory = Layer.effect(InventoryService, makeInventoryService).pipe(
    Layer.provide(businessRequirements),
  )

  const accounting = Layer.effect(AccountingService, makeAccountingService).pipe(
    Layer.provide(businessRequirements),
  )

  const messaging = Layer.effect(MessagingService, makeMessagingService).pipe(
    Layer.provide(database),
  )

  const process = Layer.effect(ProcessService, makeProcessService).pipe(
    Layer.provide(Layer.mergeAll(businessRequirements, sales, inventory, accounting, messaging)),
  )

  return Layer.mergeAll(
    userAccount,
    auth,
    authorization,
    party,
    sales,
    inventory,
    accounting,
    messaging,
    process,
  )
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
    Layer.provide(DenoHttpServer.layer({ port })),
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
  startApi(url, port).pipe(DenoRuntime.runMain)
}
