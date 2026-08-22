# ADR-0043: Adopt a Rebuildable Analytic Plane

- Status: Accepted
- Date: 2026-08-22
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Analytics architecture:
>   [`../architecture/analytics-architecture.md`](../architecture/analytics-architecture.md)
> - Workload isolation:
>   [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Comparative reference:
>   [`../architecture/reference/analytical-isolation-and-semantic-projection-patterns.md`](../architecture/reference/analytical-isolation-and-semantic-projection-patterns.md)

## Context

RITSEI already classifies dashboard and reporting state as rebuildable projection state and forbids
hard-isolated projection routes from falling back to PostgreSQL primary. It does not yet define one
owner for analytical facts, metrics, dimensional semantics, freshness, provider routing, correction,
lineage, or cross-engine conformance.

Without that owner, dashboards can duplicate business formulas, query private domain tables, turn a
projection into accidental authority, or introduce an OLAP product whose schema becomes the ERP's
semantic model. A mandatory warehouse stack would also conflict with RITSEI's PostgreSQL-first,
evidence-gated deployment posture.

## Decision

RITSEI adopts a logical, rebuildable **Analytic Plane**.

The Analytic Plane is a subsystem over the existing workload classes:

```text
query
-> bounded semantic and projection reads

async
-> ingestion, projection build, rebuild, compaction, export, and backfill
```

It is not a fourth top-level workload class and does not change ADR-0034.

### Authority

- Source domains own business meaning, publication, correction, compatibility, and authorization.
- A domain may publish a versioned **Business Fact Contract** through a public schema, committed
  event, or owner-controlled rebuild export.
- The Analytic Plane owns derived metric definitions, dimensional query semantics, projection
  lifecycle, lineage, freshness evaluation, and provider-independent query planning.
- A fact contract, metric, cube, aggregate, dashboard, or projection never becomes a mutation,
  authorization, stock, balance, journal, or financial authority.
- Financial analytics consume Accounting-approved facts and preserve financial projection and
  reconciliation status. They do not independently calculate an authoritative balance.

### Rebuildability and correction

Every analytic projection declares a complete rebuild source:

```text
retained committed facts/events

or

owner-approved snapshot/export
+ subsequent committed facts/events
```

Events alone must not be claimed as sufficient when payload minimization, redaction, retention, or
historical gaps prevent a complete rebuild. Consumers remain idempotent under duplicate delivery and
define late-arrival, reversal, supersession, deletion, and replay behavior. Each metric declares
whether corrected history is currently restated or reproduced as known at a source-completeness
frontier; deterministic rebuilds fix the same semantic versions and frontier.

### Semantic contracts

Metric definitions are versioned code or equivalent reviewed artifacts. They declare at least:

- semantic owner and stable versioned identity;
- source fact versions and grain;
- dimensions, join cardinality, time semantics, and valid filters;
- additive, semi-additive, non-additive, or derived aggregation behavior;
- exact arithmetic, unit, and currency rules where applicable;
- authorization, sensitivity, retention, and freshness requirements;
- provider-independent result schema.

This ADR selects those semantics, not a concrete DSL, compiler, package, schema, or public API.

### Freshness and query routing

A semantic query declares the weakest safe consistency class and maximum tolerated staleness. A
provider is eligible only when it implements the requested semantic version, covers the requested
time range, satisfies current authorization behavior, and meets the freshness contract.

`LIVE`, `NEAR_REALTIME`, or similar labels may be product-level aliases, but RITSEI does not assign
one universal duration to them. The binding contract uses explicit duration and `dataAsOf` evidence.
For a multi-source metric, `dataAsOf` is the conservative frontier supported by every required
source, not projection or ingestion wall-clock time. Analytic freshness does not imply
read-your-writes or authoritative-current state.

### No primary fallback

A route claiming hard projection isolation:

- runs with query-plane credentials and bounded resources;
- has no PostgreSQL-primary credential or command service binding;
- returns declared stale, reduced, `429`, `503`, or typed unavailable behavior when no eligible
  projection can satisfy the contract;
- never recompiles the same analytical request against command-plane tables or pools.

An intentionally primary-backed authoritative query is a separate route classification and cannot
claim the projection non-interference guarantee.

### Provider posture

PostgreSQL reporting projections are the baseline. An isolated PostgreSQL projection store,
ClickHouse, Pinot, Iceberg, DuckDB, a managed warehouse, or another engine may be introduced only
after a measured requirement and the provider gates in the canonical analytics architecture pass.

Provider selection and topology remain in infrastructure adapters and composition roots. Public
contracts do not expose cluster, table, partition, snapshot, file, catalog, shard, replica, or
provider identifiers.

This decision does not activate PgQue, ClickHouse, Pinot, Iceberg, DuckDB, a warehouse, a broker, a
new package, or a new PostgreSQL schema.

## Alternatives Considered

### Keep dashboard and report SQL inside each feature

Rejected as the general model. It duplicates metric semantics, encourages private-table coupling,
and makes consistency, lineage, correction, and provider migration difficult. Bounded owner-local
operational queries remain valid where no analytic projection is justified.

### Require full CQRS and an external OLAP store for every deployment

Rejected. Small deployments can use PostgreSQL projections, and ADR-0034 explicitly rejects a
mandatory external query store. External engines require measured need and operational proof.

### Make one central enterprise model own every business fact

Rejected. It would create a competing semantic authority and violate ADR-0015. Domains own facts;
analytics owns derived metric and projection semantics.

### Standardize PostgreSQL, ClickHouse, Iceberg, and DuckDB as one fixed progression

Rejected. These products solve different problems. An interactive OLAP database, an open table
format, and an embedded execution engine are not mandatory stages of one component.

### Rebuild every projection from events only

Rejected. Current event contracts may be intentionally minimal or have bounded retention. A complete
owner-approved snapshot plus replay path is allowed and sometimes required.

## Consequences

### Positive

- Business metrics gain one reviewed definition instead of dashboard-local formulas.
- Analytical storage remains replaceable and non-authoritative.
- Freshness and failure behavior become visible contracts.
- Existing query-to-command non-interference gains analytic-specific proof requirements.
- Small deployments keep a PostgreSQL-only path while larger deployments can scale independently.

### Negative

- Fact and metric versioning, lineage, replay, correction, and conformance add governance work.
- Projection-backed results may be stale or unavailable by design.
- Cross-engine parity and rebuild tests are required before a second provider can be trusted.
- Current authorization may require a separate bounded check path or fail-closed projection.

### Risks

- A generic fact abstraction could become a hidden universal domain model.
- Join multiplicity, time zones, units, currency, late facts, and reversals could cause metric
  drift.
- Dynamic routing could return different answers for the same semantic version.
- Embedded analytics could still consume protected CPU or memory without touching PostgreSQL.
- Stale authorization projections could disclose revoked data.
- Provider-specific schemas could leak into public contracts and make exit impractical.

## Validation

Before an analytic route or provider is production-ready, prove:

- package and schema boundaries prevent direct private-domain reads and write-back;
- projection deletion followed by rebuild at the same source-completeness frontier reproduces
  deterministic result hashes;
- duplicate, reordered, late, reversed, superseded, and deleted facts produce defined results,
  including a correction arriving after a fixed historical frontier;
- every activated provider passes the same golden semantic dataset, including exact decimal, time
  zone, null, cardinality, and aggregation cases;
- freshness routing never selects an ineligible provider or falls back to the primary;
- authorization revocation and tenant-isolation tests fail closed;
- analytics saturation does not consume the named command reserve;
- time, memory, result size, concurrency, cancellation, and export limits release resources;
- provider backup, restore, upgrade, rollback, rebuild, and exit procedures pass;
- financial reports preserve Accounting provenance and never establish independent authority.

Detailed current rules are owned by
[`../architecture/analytics-architecture.md`](../architecture/analytics-architecture.md).
