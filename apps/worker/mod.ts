import "../../tooling/load-env.ts"
import * as DenoRuntime from "@effect/platform-deno/DenoRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import postgres from "postgres"

import { FinancialLedgerPort } from "../../packages/accounting/mod.ts"
import {
  makeTigerBeetleFinancialLedger,
  TigerBeetleConfigurationFailure,
} from "../../packages/kernel/mod.ts"
import { serviceLayers } from "../api/mod.ts"
import { FinancialWorkerInput, runFinancialOperationOnce } from "./runner.ts"

export { FinancialWorkerInput, FinancialWorkerRun, runFinancialOperationOnce } from "./runner.ts"

const tigerBeetleConfig = Effect.try({
  try: () => ({
    clusterId: BigInt(Deno.env.get("TIGERBEETLE_CLUSTER_ID") ?? "0"),
    replicaAddresses: (Deno.env.get("TIGERBEETLE_REPLICA_ADDRESSES") ?? "127.0.0.1:3000")
      .split(",")
      .map((address) => address.trim())
      .filter((address) => address.length > 0),
    ledger: Number.parseInt(Deno.env.get("TIGERBEETLE_LEDGER") ?? "1", 10),
    code: Number.parseInt(Deno.env.get("TIGERBEETLE_CODE") ?? "1", 10),
    currency: (Deno.env.get("TIGERBEETLE_CURRENCY") ?? "USD").toUpperCase(),
  }),
  catch: () => new TigerBeetleConfigurationFailure({ reason: "invalid_configuration" }),
})

export const startWorker = (url: string, input: FinancialWorkerInput, intervalMs = 1_000) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))
      const config = yield* tigerBeetleConfig
      const ledger = Layer.effect(FinancialLedgerPort, makeTigerBeetleFinancialLedger(config))
      const services = serviceLayers(client, ledger)
      yield* Effect.forever(
        runFinancialOperationOnce(input).pipe(
          Effect.provide(services),
          Effect.andThen(Effect.sleep(intervalMs)),
        ),
      )
    }),
  )

if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL")
  const tenantId = Deno.env.get("WORKER_TENANT_ID")
  if (url === undefined || tenantId === undefined) {
    console.error("DATABASE_URL and WORKER_TENANT_ID are required")
    Deno.exit(1)
  }
  const workerId = Deno.env.get("WORKER_ID") ?? `accounting-worker-${crypto.randomUUID()}`
  startWorker(url, { tenantId, workerId }).pipe(DenoRuntime.runMain)
}
