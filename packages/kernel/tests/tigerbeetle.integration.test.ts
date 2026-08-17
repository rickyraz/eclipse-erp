import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { makeTigerBeetleFinancialLedger, type TigerBeetleFinancialLedgerConfig } from "../mod.ts"

const enabled = Deno.env.get("TIGERBEETLE_INTEGRATION") === "1"
const addresses = (Deno.env.get("TIGERBEETLE_REPLICA_ADDRESSES") ?? "127.0.0.1:3000")
  .split(",")
  .map((address) => address.trim())
  .filter((address) => address.length > 0)

const config: TigerBeetleFinancialLedgerConfig = {
  clusterId: BigInt(Deno.env.get("TIGERBEETLE_CLUSTER_ID") ?? "0"),
  replicaAddresses: addresses,
  ledger: Number.parseInt(Deno.env.get("TIGERBEETLE_LEDGER") ?? "1", 10),
  code: Number.parseInt(Deno.env.get("TIGERBEETLE_CODE") ?? "1", 10),
  currency: (Deno.env.get("TIGERBEETLE_CURRENCY") ?? "USD").toUpperCase(),
}

it.effect.skipIf(!enabled)(
  "posts an accepted journal to a local TigerBeetle cluster",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ledger = yield* makeTigerBeetleFinancialLedger(config)
        const suffix = crypto.randomUUID()
        const debitAccount = `integration-debit-${suffix}`
        const creditAccount = `integration-credit-${suffix}`
        const operationId = `integration-operation-${suffix}`

        assert.strictEqual(
          (yield* ledger.createExecutionAccount({
            tenantId: "00000000-0000-0000-0000-000000000001",
            legalEntityId: "00000000-0000-0000-0000-000000000002",
            accountId: debitAccount,
            currency: config.currency,
            mappingVersion: 1,
          }))._tag,
          "accepted",
        )
        assert.strictEqual(
          (yield* ledger.createExecutionAccount({
            tenantId: "00000000-0000-0000-0000-000000000001",
            legalEntityId: "00000000-0000-0000-0000-000000000002",
            accountId: creditAccount,
            currency: config.currency,
            mappingVersion: 1,
          }))._tag,
          "accepted",
        )
        const outcome = yield* ledger.postJournal({
          tenantId: "00000000-0000-0000-0000-000000000001",
          legalEntityId: "00000000-0000-0000-0000-000000000002",
          operationId,
          journalId: `integration-journal-${suffix}`,
          reference: `integration-${suffix}`,
          currency: config.currency,
          mappingVersion: 1,
          lines: [
            { accountId: debitAccount, debitMinor: "125", creditMinor: "0" },
            { accountId: creditAccount, debitMinor: "0", creditMinor: "125" },
          ],
        })
        assert.strictEqual(outcome._tag, "accepted")
        if (outcome._tag === "accepted") assert.strictEqual(outcome.transferCount, 1)
      }),
    ),
)
