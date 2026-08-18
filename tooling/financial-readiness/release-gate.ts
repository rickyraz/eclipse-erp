type EvidenceClass =
  | "repo-proof"
  | "local-real"
  | "staging-real"
  | "production-real"
  | "mock-only"
  | "missing"

type Gate = {
  id: string
  title: string
  observed: "PASS" | "FAIL"
  evidenceClass: EvidenceClass
  acceptedEvidenceClasses: EvidenceClass[]
  evidence: string[]
  reason: string
  failureCategory: "none" | "code" | "environment" | "evidence" | "governance"
  requiredEvidence: string
  remediation: string
}

type Manifest = {
  schemaVersion: number
  reviewedAt: string
  baselineCommit: string
  summary: {
    passed: number
    failed: number
    total: number
  }
  gates: Gate[]
}

const requiredIds = [
  "controlled_activation",
  "process_kill_no_double_posting",
  "worker_adapter_restart",
  "tigerbeetle_outage_fail_closed",
  "replica_quorum_failure",
  "postgresql_not_financial_authority",
  "independent_backup_restore",
  "recovery_watermark",
  "global_reconciliation",
  "projection_rebuild",
  "artifact_integrity",
  "production_signing_custody",
  "key_rotation_recovery",
  "operator_alerts",
  "bounded_cohort",
  "no_unresolved_p0",
] as const

const manifestPath = Deno.args[0] ?? "docs/operations/financial-readiness-evidence-2026-08-18.json"

const failClosed = (message: string): never => {
  console.error(message)
  console.error("NO-GO — PostgreSQL remains the default financial engine.")
  Deno.exit(1)
}

const manifest = await (async (): Promise<Manifest> => {
  try {
    return JSON.parse(await Deno.readTextFile(manifestPath)) as Manifest
  } catch (error) {
    return failClosed(`Unable to read evidence manifest ${manifestPath}: ${String(error)}`)
  }
})()

if (manifest.schemaVersion !== 1 || manifest.baselineCommit !== "056828250526") {
  failClosed("Evidence manifest schema or baseline commit is invalid.")
}

const gatesById = new Map(manifest.gates.map((gate) => [gate.id, gate]))
const missingIds = requiredIds.filter((id) => !gatesById.has(id))
const duplicateIds = manifest.gates
  .map((gate) => gate.id)
  .filter((id, index, ids) => ids.indexOf(id) !== index)

if (
  missingIds.length > 0 || duplicateIds.length > 0 || manifest.gates.length !== requiredIds.length
) {
  failClosed(
    `Evidence manifest must contain exactly 16 unique gates; missing=${
      missingIds.join(",") || "none"
    }, ` +
      `duplicates=${duplicateIds.join(",") || "none"}.`,
  )
}

let failed = 0

for (const id of requiredIds) {
  const gate = gatesById.get(id)!
  if (gate.acceptedEvidenceClasses.length === 0) {
    failClosed(`Gate ${gate.id} has no accepted evidence classes.`)
  }
  const passes = gate.observed === "PASS" &&
    gate.acceptedEvidenceClasses.includes(gate.evidenceClass)
  if (!passes) failed += 1
  console.log(
    `${passes ? "PASS" : "FAIL"} ${gate.id} ` +
      `[observed=${gate.observed}, evidence=${gate.evidenceClass}, accepted=${
        gate.acceptedEvidenceClasses.join("|")
      }] ${gate.title}`,
  )
  console.log(`  ${gate.reason}`)
  if (!passes) {
    console.log(`  required: ${gate.requiredEvidence}`)
    console.log(`  remediation: ${gate.remediation}`)
  }
}

const passed = requiredIds.length - failed
if (
  manifest.summary.passed !== passed || manifest.summary.failed !== failed ||
  manifest.summary.total !== requiredIds.length
) {
  failClosed(
    `Manifest summary is stale; expected passed=${passed}, failed=${failed}, total=${requiredIds.length}.`,
  )
}

console.log(`SUMMARY ${passed} PASS / ${failed} FAIL / ${requiredIds.length} TOTAL`)

if (failed > 0) {
  failClosed(`${failed} final production-readiness gate(s) remain unresolved.`)
}

console.log("GO — TigerBeetle is approved for controlled production activation.")
