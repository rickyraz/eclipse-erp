# Autoresearch: Validate the RITSEI Analytic Plane

## Objective

Stress-test and document a provider-independent RITSEI Analytic Plane that preserves domain authority,
rebuildability, explicit freshness, tenant-safe authorization, and ADR-0034 non-interference without
activating speculative OLAP infrastructure.

## Metrics

- **Primary:** `analytic_architecture_gates` (unitless, higher is better).
- **Secondary:** `remaining_gates`.

## How to Run

`./.auto/measure.sh`; repository correctness checks run automatically from `.auto/checks.sh`.

## Files in Scope

- `docs/architecture/`
- `docs/architecture/reference/`
- `docs/decisions/`
- `docs/deployment/README.md`
- `docs/README.md`
- `docs/documentation-boundaries.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `.auto/`

## Off Limits

- Adding an analytics package, schema, API, DSL, dependency, credential, or deployment.
- Activating ClickHouse, Pinot, Iceberg, DuckDB, PgQue, a warehouse, or a broker.
- Making analytics a fourth top-level workload class.
- Letting a derived metric or projection become business or financial authority.
- Claiming read-your-writes or hard isolation without executable evidence.

## Acceptance Gates

1. An accepted ADR selects the bounded, rebuildable analytic subsystem.
2. A canonical analytics architecture owns facts, metrics, freshness, query, and provider gates.
3. A reference study verifies the proposal against primary external sources.
4. Documentation indexes and ownership boundaries name the new source of truth.
5. The system-wide architecture includes a concise Analytic Plane contract.
6. The architecture overview includes the analytic projection path.
7. Workload isolation states analytics uses existing query and async classes.
8. Deployment guidance links analytics to existing profiles without selecting a vendor.
9. The canonical document states the no-primary-fallback invariant.
10. The canonical document defines provider activation gates.
11. Rebuild sources support snapshot plus replay when events alone are insufficient.
12. Validation covers parity, replay, corrections, authorization, tenancy, freshness, and non-interference.
13. Existing architecture files retain a surgical diff instead of repository-wide Markdown reformatting.
14. Workload-isolation references preserve the ADR-0040 financial-authority exception.
15. Runtime comparison references no longer restate the superseded PostgreSQL-only authority model.
16. Multi-source freshness cannot advance beyond the oldest required source completeness frontier.
17. Correction visibility is explicit, and deterministic rebuild proof fixes semantic versions and the source-completeness frontier.
18. Dimension membership has a total, testable outcome with no implicit source-grain row loss.
19. Empty inputs and absent groups have provider-independent row-cardinality and zero/null semantics.
20. Derived expressions have total precision, rounding, null, zero-divisor, overflow, and non-finite semantics.
21. Time-grained metrics use versioned, half-open temporal boundaries with deterministic timezone, precision, and DST resolution.
22. Limited and paginated results use a total order and continuation bound to one fixed completeness frontier.
23. Analytic observations and recommendations remain non-authoritative; every proposed action re-enters the current owning command boundary.
24. Observation, review, and action preserve actor/delegation provenance and independently revalidate current evidence access and separation of duties.
25. Findings bind immutable, verifiable evidence content to fixed semantic and completeness frontiers.
26. Superseded, corrected, policy-invalidated, or withdrawn recommendations become non-actionable without rewriting history.
27. Review and action idempotency binds the exact recommendation version, action version, and canonical validated input.
28. Unknown recommendation-action outcomes remain unresolved until the owning domain confirms the exact attempt; retries, compensation, and successor effects cannot infer failure or create a new identity.
29. Compensation is a separately authorized, idempotent owning-domain command bound to an owner-confirmed compensable effect; unknown, rejected, superseded, or withdrawn recommendations cannot imply compensation.
