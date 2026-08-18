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
  evidence: string[]
  reason: string
}

type Manifest = {
  schemaVersion: number
  reviewedAt: string
  baselineCommit: string
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

const finalPassClasses = new Set<EvidenceClass>(["staging-real", "production-real"])
let failed = 0

for (const id of requiredIds) {
  const gate = gatesById.get(id)!
  const passes = gate.observed === "PASS" && finalPassClasses.has(gate.evidenceClass)
  if (!passes) failed += 1
  console.log(
    `${passes ? "PASS" : "FAIL"} ${gate.id} ` +
      `[observed=${gate.observed}, evidence=${gate.evidenceClass}] ${gate.title}`,
  )
  if (!passes) console.log(`  ${gate.reason}`)
}

if (failed > 0) {
  failClosed(`${failed} final production-readiness gate(s) lack production-equivalent evidence.`)
}

console.log("GO — TigerBeetle is approved for controlled production activation.")
