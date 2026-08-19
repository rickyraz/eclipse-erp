import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { FinancialLedgerAuthority } from "../packages/accounting/mod.ts"
import type { TigerBeetleFinancialLedgerConfig } from "../packages/kernel/mod.ts"

export const DeploymentProfile = Schema.Literals([
  "entry",
  "standard",
  "scale",
  "enterprise",
])
export type DeploymentProfile = Schema.Schema.Type<typeof DeploymentProfile>

export const FinancialAuthority = FinancialLedgerAuthority
export type FinancialAuthority = Schema.Schema.Type<typeof FinancialAuthority>

export type RitseiRuntimeConfiguration = Readonly<
  & {
    readonly deploymentProfile: DeploymentProfile
  }
  & (
    | {
      readonly financialAuthority: "postgresql"
      readonly tigerBeetle?: never
    }
    | {
      readonly financialAuthority: "tigerbeetle"
      readonly tigerBeetle: TigerBeetleFinancialLedgerConfig
    }
  )
>

export class RuntimeConfigurationFailure
  extends Schema.TaggedErrorClass<RuntimeConfigurationFailure>()(
    "RuntimeConfigurationFailure",
    {
      reason: Schema.Literals([
        "invalid_configuration",
        "missing_tigerbeetle_configuration",
        "invalid_tigerbeetle_configuration",
      ]),
    },
  ) {}

export interface RuntimeEnvironment {
  readonly get: (name: string) => string | undefined
}

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const RawRuntimeConfiguration = Schema.Struct({
  deploymentProfile: DeploymentProfile,
  financialAuthority: FinancialAuthority,
  tigerBeetle: Schema.optionalKey(Schema.Struct({
    clusterId: NonEmptyString,
    replicaAddresses: Schema.Array(NonEmptyString).check(Schema.isMinLength(1)),
    ledger: NonEmptyString,
    code: NonEmptyString,
    currency: NonEmptyString,
  })),
})

type RawRuntimeConfiguration = Schema.Schema.Type<typeof RawRuntimeConfiguration>

const invalid = (reason: RuntimeConfigurationFailure["reason"]) =>
  new RuntimeConfigurationFailure({ reason })

const parseSafeInteger = (value: string) => {
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

const parseTigerBeetleConfiguration = (
  raw: RawRuntimeConfiguration["tigerBeetle"],
): Effect.Effect<TigerBeetleFinancialLedgerConfig, RuntimeConfigurationFailure> => {
  if (raw === undefined) return Effect.fail(invalid("missing_tigerbeetle_configuration"))
  if (!/^\d+$/.test(raw.clusterId)) return Effect.fail(invalid("invalid_tigerbeetle_configuration"))
  const clusterId = BigInt(raw.clusterId)
  const ledger = parseSafeInteger(raw.ledger)
  const code = parseSafeInteger(raw.code)
  const currency = raw.currency.toUpperCase()
  if (
    clusterId < 0n || clusterId > (1n << 128n) - 1n || ledger === undefined || ledger < 1 ||
    ledger > 0xffff_ffff || code === undefined || code < 1 || code > 0xffff_ffff ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return Effect.fail(invalid("invalid_tigerbeetle_configuration"))
  }
  return Effect.succeed({
    clusterId,
    replicaAddresses: raw.replicaAddresses,
    ledger,
    code,
    currency,
  })
}

export const parseRuntimeConfiguration = (environment: RuntimeEnvironment) =>
  Effect.gen(function* () {
    const financialAuthority = environment.get("RITSEI_FINANCIAL_AUTHORITY") ?? "postgresql"
    const deploymentProfile = environment.get("RITSEI_DEPLOYMENT_PROFILE") ?? "entry"
    const tigerBeetleValues = financialAuthority === "tigerbeetle"
      ? {
        clusterId: environment.get("TIGERBEETLE_CLUSTER_ID"),
        replicaAddresses: environment.get("TIGERBEETLE_REPLICA_ADDRESSES")
          ?.split(",").map((address) => address.trim()).filter((address) => address.length > 0),
        ledger: environment.get("TIGERBEETLE_LEDGER"),
        code: environment.get("TIGERBEETLE_CODE"),
        currency: environment.get("TIGERBEETLE_CURRENCY"),
      }
      : undefined
    const raw = {
      deploymentProfile,
      financialAuthority,
      ...(tigerBeetleValues !== undefined &&
          tigerBeetleValues.clusterId !== undefined &&
          tigerBeetleValues.replicaAddresses !== undefined &&
          tigerBeetleValues.ledger !== undefined &&
          tigerBeetleValues.code !== undefined &&
          tigerBeetleValues.currency !== undefined
        ? { tigerBeetle: tigerBeetleValues }
        : {}),
    }
    const decoded = yield* Schema.decodeUnknownEffect(RawRuntimeConfiguration)(raw).pipe(
      Effect.mapError(() => invalid("invalid_configuration")),
    )
    if (decoded.financialAuthority === "postgresql") {
      return {
        deploymentProfile: decoded.deploymentProfile,
        financialAuthority: "postgresql" as const,
      } satisfies RitseiRuntimeConfiguration
    }
    const tigerBeetle = yield* parseTigerBeetleConfiguration(decoded.tigerBeetle)
    return {
      deploymentProfile: decoded.deploymentProfile,
      financialAuthority: "tigerbeetle" as const,
      tigerBeetle,
    } satisfies RitseiRuntimeConfiguration
  })

export const readRuntimeConfiguration = (
  environment: RuntimeEnvironment = Deno.env,
) => parseRuntimeConfiguration(environment)
