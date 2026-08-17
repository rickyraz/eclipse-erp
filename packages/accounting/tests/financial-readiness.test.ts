import { assert, describe, it } from "@effect/vitest"

import { financialFailureMatrix, verifyOpeningBalances } from "../mod.ts"

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
    for (const row of financialFailureMatrix) {
      assert.isNotEmpty(row.expectedPostgresState)
      assert.isNotEmpty(row.expectedTigerBeetleState)
      assert.isNotEmpty(row.safeRetryAction)
      assert.isNotEmpty(row.reconciliationAction)
      assert.isNotEmpty(row.terminalCondition)
    }
  })

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
