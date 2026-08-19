import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { parseRuntimeConfiguration } from "./runtime-config.ts"

const environment = (values: Record<string, string>) => ({
  get: (name: string) => values[name],
})

describe("runtime configuration", () => {
  it.effect("defaults to entry plus PostgreSQL without TigerBeetle settings", () =>
    Effect.gen(function* () {
      const configuration = yield* parseRuntimeConfiguration(environment({}))
      assert.strictEqual(configuration.deploymentProfile, "entry")
      assert.strictEqual(configuration.financialAuthority, "postgresql")
      assert.strictEqual(configuration.tigerBeetle, undefined)
    }))

  it.effect("does not read TigerBeetle settings for a PostgreSQL authority", () =>
    Effect.gen(function* () {
      const configuration = yield* parseRuntimeConfiguration(environment({
        RITSEI_DEPLOYMENT_PROFILE: "standard",
        RITSEI_FINANCIAL_AUTHORITY: "postgresql",
        TIGERBEETLE_CLUSTER_ID: "not-a-cluster",
      }))
      assert.strictEqual(configuration.deploymentProfile, "standard")
      assert.strictEqual(configuration.financialAuthority, "postgresql")
      assert.strictEqual(configuration.tigerBeetle, undefined)
    }))

  it.effect("requires complete TigerBeetle settings only when selected", () =>
    Effect.gen(function* () {
      const failure = yield* parseRuntimeConfiguration(environment({
        RITSEI_FINANCIAL_AUTHORITY: "tigerbeetle",
      })).pipe(Effect.flip)
      assert.strictEqual(failure._tag, "RuntimeConfigurationFailure")
      assert.strictEqual(failure.reason, "missing_tigerbeetle_configuration")
    }))

  it.effect("decodes and normalizes a TigerBeetle configuration", () =>
    Effect.gen(function* () {
      const configuration = yield* parseRuntimeConfiguration(environment({
        RITSEI_DEPLOYMENT_PROFILE: "scale",
        RITSEI_FINANCIAL_AUTHORITY: "tigerbeetle",
        TIGERBEETLE_CLUSTER_ID: "42",
        TIGERBEETLE_REPLICA_ADDRESSES: "127.0.0.1:3000, 127.0.0.1:3001",
        TIGERBEETLE_LEDGER: "1",
        TIGERBEETLE_CODE: "2",
        TIGERBEETLE_CURRENCY: "usd",
      }))
      assert.strictEqual(configuration.deploymentProfile, "scale")
      assert.strictEqual(configuration.financialAuthority, "tigerbeetle")
      assert.deepStrictEqual(configuration.tigerBeetle, {
        clusterId: 42n,
        replicaAddresses: ["127.0.0.1:3000", "127.0.0.1:3001"],
        ledger: 1,
        code: 2,
        currency: "USD",
      })
    }))
})
