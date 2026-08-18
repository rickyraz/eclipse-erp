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

export {
  FinancialWorkerInput,
  FinancialWorkerRun,
  makeWorkerFailpointLayer,
  runFinancialOperationOnce,
  WorkerFailpointName,
  WorkerFailpointService,
  WorkerInjectedFailure,
} from "./runner.ts"

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

const strictDecimalEnv = (name: string) => {
  const value = requiredEnv(name)
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a decimal integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is out of range`)
  return parsed
}

const tigerBeetleConfig = Effect.try({
  try: () => ({
    clusterId: BigInt(requiredEnv("TIGERBEETLE_CLUSTER_ID")),
    replicaAddresses: requiredEnv("TIGERBEETLE_REPLICA_ADDRESSES")
      .split(",")
      .map((address) => address.trim())
      .filter((address) => address.length > 0),
    ledger: strictDecimalEnv("TIGERBEETLE_LEDGER"),
    code: strictDecimalEnv("TIGERBEETLE_CODE"),
    currency: requiredEnv("TIGERBEETLE_CURRENCY").toUpperCase(),
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
  const workerId = Deno.env.get("WORKER_ID")?.trim()
  if (workerId === undefined || workerId.length === 0) {
    console.error("WORKER_ID is required")
    Deno.exit(1)
  }
  startWorker(url, { tenantId, workerId }).pipe(DenoRuntime.runMain)
}
