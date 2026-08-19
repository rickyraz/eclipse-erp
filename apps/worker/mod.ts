import "../../tooling/load-env.ts"
import * as DenoRuntime from "@effect/platform-deno/DenoRuntime"
import * as Effect from "effect/Effect"
import postgres from "postgres"

import { serviceLayers } from "../runtime.ts"
import { readRuntimeConfiguration, type RitseiRuntimeConfiguration } from "../runtime-config.ts"
import { type FinancialWorkerInput, runFinancialOperationOnce } from "./runner.ts"

export {
  FinancialWorkerInput,
  FinancialWorkerRun,
  makeWorkerFailpointLayer,
  runFinancialOperationOnce,
  WorkerFailpointName,
  WorkerFailpointService,
  WorkerInjectedFailure,
} from "./runner.ts"

export const startWorker = (
  url: string,
  input: FinancialWorkerInput,
  configuration: RitseiRuntimeConfiguration,
  intervalMs = 1_000,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))
      const services = serviceLayers(client, configuration)
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
  Effect.gen(function* () {
    const configuration = yield* readRuntimeConfiguration()
    yield* startWorker(url, { tenantId, workerId }, configuration)
  }).pipe(DenoRuntime.runMain)
}
