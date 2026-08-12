# Autoresearch: Complete EclipseERP P0-P3 primitive roadmap

## Objective
Complete the canonical ERP primitive sequence in `docs/roadmap/erp-primitives.md` from P0 through P3 without contradicting accepted ADRs or duplicating canonical documentation. Resolve material UNKNOWN decisions with ADRs, implement the smallest executable contracts and invariant proofs, and keep Process Studio behind its existing gates.

## Metrics
- **Primary**: `accepted_gates` (unitless, higher is better) — objective implementation/documentation gates satisfied by `.auto/measure.sh`.
- **Secondary**: `remaining_gates` — acceptance gates still open.

## How to Run
`./.auto/measure.sh` outputs structured metrics. `.auto/checks.sh` runs repository correctness checks after a passing measurement.

## Files in Scope
- `docs/decisions/`, `docs/architecture/`, `docs/roadmap/`: decisions, canonical semantics, readiness evidence.
- `packages/{inventory,accounting,sales,process,integrations,party,kernel}/`: owner-local public contracts and implementations.
- `db/schema/`, `db/migrations/`, `db/ownership.toml`: owned persistence and constraints.
- `tests/`, package tests, capability catalog tooling: executable proof.
- `.auto/`: experiment state only.

## Off Limits
- `vendor/` and `node_modules/` (reference-only).
- Production deployment, secrets, destructive migration execution.
- Visual Process Studio/runtime expansion beyond primitive/catalog prerequisites.
- Speculative localization, manufacturing, payroll, valuation, lot/serial, multiple-currency, or tax rules not required by the selected baseline.

## Constraints
- Accepted superseding ADRs win; do not rewrite accepted ADR history.
- Read `docs/documentation-boundaries.md` before documentation edits.
- Effect v4 changes must consult the vendored `vendor/effect-smol` source.
- Drizzle changes must use repository schema/migration workflow; no raw SQL in domains.
- No cross-domain private imports or direct table writes.
- Preserve tenant/legal-entity isolation, authorization, typed failures, idempotency, concurrency, audit, and correction semantics.
- Use `@effect/vitest`; no `Deno.test`, direct `vitest`, or runtime runners in tests.
- Do not improve the metric by weakening gates, deleting tests, or merely relabeling roadmap state without executable evidence.

## Acceptance Gates
1. Reconcile canonical docs and the process coordinator with accepted ADR-0033.
2. Explicitly close P0 with existing executable evidence and deployment prerequisites.
3. Decide P1 baseline (product/service, UOM, quantity, location, negative stock, corrections, valuation/traceability scope).
4. Implement P1 typed units and correction/concurrency proof.
5. Decide P2 document/obligation ownership and money/fiscal baseline.
6. Implement P2 legal-entity financial scope, period/posting rules, reversal/manual recovery proof.
7. Decide P3 audit/event/outbox/retention boundary.
8. Implement typed versioned action/event catalog entries for at least two domains with compatibility tests.
9. Implement P3 audit/correlation and atomic publication/idempotent-consumer proof for selected facts.
10. Reconcile roadmap/domain maturity status and pass required repository validation.

## What's Been Tried
- Initial repository assessment found P0 substantially implemented, P1-P3 partial, stale roadmap statements about periods/process, and `packages/process` still using the superseded caller-supplied order-confirmation payload despite ADR-0033.
- Start by reconciling ADR-0033 and documentation drift, then close each dependency gate in order.
