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
