import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  buildFinancialVerificationEvidence,
  compareFinancialFactSnapshots,
  financialFailureExecutionMatrix,
  financialFailureMatrix,
  FinancialVerificationEvidence,
  hashFinancialFactSnapshot,
  verifyOpeningBalances,
} from "../mod.ts"

describe("financial readiness proofs", () => {
  it("defines a deterministic action for every crash-matrix point", () => {
    assert.strictEqual(financialFailureMatrix.length, 13)
    assert.deepStrictEqual(
      financialFailureMatrix.map((row) => row.point),
      [
        "A_before_intent_commit",
        "B_after_intent_before_submission",
        "C_submission_outcome_unknown",
        "D_response_lost_after_acceptance",
        "E_process_dies_after_acceptance_before_receipt",
        "F_accepted_before_journal_projection",
        "G_projected_before_outbox",
        "H_partial_finalization",
        "I_worker_lease_held",
        "J_worker_restart",
        "K_duplicate_workers",
        "L_tigerbeetle_unavailable",
        "M_postgresql_unavailable",
      ],
    )
    assert.strictEqual(financialFailureExecutionMatrix.length, 13)
    assert.strictEqual(
      new Set(financialFailureExecutionMatrix.map((row) => row.point)).size,
      13,
    )
    for (const row of financialFailureExecutionMatrix) {
      assert.isNotEmpty(row.hook)
      assert.isNotEmpty(row.recovery)
    }
    for (const row of financialFailureMatrix) {
      assert.isNotEmpty(row.expectedPostgresState)
      assert.isNotEmpty(row.expectedTigerBeetleState)
      assert.isNotEmpty(row.safeRetryAction)
      assert.isNotEmpty(row.reconciliationAction)
      assert.isNotEmpty(row.terminalCondition)
    }
  })

  it.effect("rejects verification versions outside PostgreSQL smallint range", () =>
    Effect.gen(function* () {
      const mappingVersionFailure = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialVerificationEvidence.fields.mappingVersion)(32768),
      )
      assert.strictEqual(mappingVersionFailure._tag, "SchemaError")
      const schemaVersionFailure = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialVerificationEvidence.fields.schemaVersion)(32768),
      )
      assert.strictEqual(schemaVersionFailure._tag, "SchemaError")
    }))

  it.effect("rejects verification counts above PostgreSQL integer range", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialVerificationEvidence.fields.accountCount)(
          2_147_483_648,
        ),
      )
      assert.strictEqual(failure._tag, "SchemaError")
    }))

  it.effect("rebuilds the same cross-store facts to the same hash", () =>
    Effect.gen(function* () {
      const source = {
        operations: [{
          operationId: "op-1",
          status: "reconciled" as const,
          currency: "USD",
          mappingVersion: 1,
        }],
        transfers: [{
          operationId: "op-1",
          position: 0,
          transferId: "transfer-1",
          debitAccountId: "cash",
          creditAccountId: "revenue",
          amountMinor: "100",
          currency: "USD",
          mappingVersion: 1,
        }],
        balances: [{
          accountId: "cash",
          currency: "USD",
          mappingVersion: 1,
          debitsPostedMinor: "100",
          creditsPostedMinor: "0",
        }],
        projections: [{
          operationId: "op-1",
          journalStatus: "posted" as const,
          transferIds: ["transfer-1"],
        }],
      }
      const target = {
        operations: [...source.operations],
        transfers: [...source.transfers],
        balances: [...source.balances],
        projections: [...source.projections],
      }
      const comparison = compareFinancialFactSnapshots(source, target)
      assert.isTrue(comparison.ok)
      assert.deepStrictEqual(comparison.mismatches, [])
      const sourceHash = yield* hashFinancialFactSnapshot(source)
      const targetHash = yield* hashFinancialFactSnapshot(target)
      assert.strictEqual(sourceHash, targetHash)
      const evidence = yield* buildFinancialVerificationEvidence({
        tenantId: "00000000-0000-4000-8000-000000000001",
        legalEntityId: "00000000-0000-4000-8000-000000000002",
        kind: "cutover_rehearsal",
        completeness: "bounded",
        scope: "test",
        mappingVersion: 1,
        currency: "USD",
        sourceWatermark: "source-1",
        targetWatermark: "target-1",
        sourceSnapshotRef: "source-snapshot",
        targetSnapshotRef: "target-snapshot",
        source,
        target,
        startedAt: "2026-08-18T00:00:00.000Z",
        completedAt: "2026-08-18T00:01:00.000Z",
      })
      assert.strictEqual(evidence.mismatchCount, 0)
      assert.strictEqual(evidence.sourceDebitMinor, "100")
      const mismatch = compareFinancialFactSnapshots(source, {
        ...target,
        transfers: [{ ...target.transfers[0]!, transferId: "unexpected-transfer" }],
      })
      assert.isFalse(mismatch.ok)
      assert.strictEqual(mismatch.mismatches[0]!.kind, "transfer_mismatch")
    }))

  it("requires exact account-level opening-balance equality", () => {
    const source = [
      {
        legalEntityId: "entity-a",
        accountId: "cash",
        currency: "USD",
        mappingVersion: 1,
        debitsMinor: "12500",
        creditsMinor: "0",
      },
      {
        legalEntityId: "entity-a",
        accountId: "revenue",
        currency: "USD",
        mappingVersion: 1,
        debitsMinor: "0",
        creditsMinor: "12500",
      },
    ]
    const equal = verifyOpeningBalances(source, source.map((entry) => ({ ...entry })))
    assert.isTrue(equal.ok)
    assert.deepStrictEqual(equal.mismatches, [])
    assert.strictEqual(equal.sourceDebitMinor, "12500")
    assert.strictEqual(equal.targetCreditMinor, "12500")

    const mismatch = verifyOpeningBalances(source, [
      { ...source[0]!, debitsMinor: "12499" },
      source[1]!,
    ])
    assert.isFalse(mismatch.ok)
    assert.strictEqual(mismatch.mismatches[0]!.kind, "field_mismatch")

    const duplicate = verifyOpeningBalances(source, [...source, source[0]!])
    assert.isFalse(duplicate.ok)
    assert.strictEqual(duplicate.mismatches[0]!.kind, "duplicate")
  })
})
