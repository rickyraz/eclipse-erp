# Analytic Plane Architecture

> **Status:** Canonical
>
> **Owns:** Analytic-plane authority, Business Fact Contracts, semantic metric and dimensional
> contracts, ingestion and rebuild boundaries, freshness and query behavior, analytical
> non-interference, provider progression, and provider activation gates.
>
> **Related documents**
>
> - Canonical architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Workload isolation: [`./workload-isolation.md`](./workload-isolation.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - Messaging: [`./pgque-messaging.md`](./pgque-messaging.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Financial ledger: [`./financial-ledger.md`](./financial-ledger.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - Deployment notes: [`../deployment/README.md`](../deployment/README.md)
> - Analytic Plane ADR:
>   [`../decisions/0043-adopt-rebuildable-analytic-plane.md`](../decisions/0043-adopt-rebuildable-analytic-plane.md)
> - Comparative reference:
>   [`./reference/analytical-isolation-and-semantic-projection-patterns.md`](./reference/analytical-isolation-and-semantic-projection-patterns.md)

## Position

RITSEI treats analytical state as a derived, governed, rebuildable view of owner-controlled business
facts.

```text
business authority
-> owning domain and approved financial authority

analytic meaning
-> versioned fact and metric contracts

analytic execution
-> replaceable projection providers
```

The Analytic Plane is a logical subsystem, not a fourth workload class. Interactive analytic reads
execute as bounded `query` work. Ingestion, projection build, rebuild, backfill, compaction, report
materialization, and export execute as bounded `async` work.

RITSEI owns the semantics. PostgreSQL, ClickHouse, Pinot, Iceberg, DuckDB, managed warehouses, and
other engines may own execution or storage only after their activation gates pass.

## Current Scope

This architecture selects contracts and boundaries. It does not yet select:

- a concrete metric DSL or compiler;
- a `packages/analytics` module or PostgreSQL schema;
- a semantic query HTTP API;
- an external OLAP, warehouse, table-format, or embedded-engine dependency;
- a universal `LIVE` or `NEAR_REALTIME` duration;
- PgQue activation;
- read-your-writes outside the separately gated PostgreSQL replica path.

The smallest first implementation remains one measured dashboard backed by an owner-approved
PostgreSQL projection.

## Vocabulary

### Business Fact Contract

A versioned public declaration by the owning domain that makes one committed business fact suitable
for derived analytical use. The source domain retains authority over meaning, publication,
correction, and compatibility.

A Business Fact Contract is not an OLAP table, event broker schema, universal ERP record, or license
for another package to read the owner's private tables.

### Semantic Metric Contract

A versioned derived definition that names a metric, its source facts, valid dimensions, aggregation,
exact arithmetic, authorization, freshness, and typed result. It does not own or mutate source
facts.

### Projection instance

A provider-specific materialization of one or more fact or metric versions. It is rebuildable and
may be deleted without changing accepted business facts.

### Semantic query intent

A bounded, typed request for metric versions, dimensions, filters, time range and grain, ordering,
result limit, consistency class, and maximum staleness. It is not arbitrary SQL.

### Freshness evidence

Evidence that describes how current a result is. User-visible responses may expose `dataAsOf`,
requested maximum staleness, and stale/degraded status. Internal event positions, WAL positions,
provider snapshots, and routing topology remain private.

## Authority and Ownership

| Concern                                                      | Owner                                   |
| ------------------------------------------------------------ | --------------------------------------- |
| Business invariant and source fact meaning                   | Source domain                           |
| Fact publication, correction, and compatibility              | Source domain                           |
| Accepted financial transfers, balances, and history          | Current `FinancialLedgerPort` authority |
| Financial reporting fact and provenance                      | Accounting under `financial-ledger.md`  |
| Metric formula, grain, dimensions, and semantic version      | Declared metric owner                   |
| Projection schema, checkpoint, rebuild, and provider adapter | Analytic Plane implementation           |
| Query admission and workload containment                     | Workload isolation fabric               |
| Current authorization and tenant scope                       | Owning domain / Authorization           |
| Provider topology and credentials                            | Infrastructure composition root         |

Rules:

- analytics never writes source-domain tables;
- a projection row never authorizes a command;
- a dashboard value never establishes current stock, balance, fiscal, approval, or payment state;
- cross-domain facts enter through public schemas, committed events, or owner-controlled rebuild
  exports;
- Messaging owns delivery mechanics, not fact meaning;
- provider metadata never enters domain DTOs, events, capability IDs, entity addresses, or Process
  IR.

## System Shape

```text
Owning domain command
        |
        v
approved authority commits the fact
        |
        +--> transactional Messaging outbox
        |
        `--> owner-approved rebuild snapshot/export
                       |
                       v
             Analytic Projection Fabric
             idempotency + versions + lineage
                       |
          +------------+-------------+
          |                          |
          v                          v
  PostgreSQL projection       optional external provider
          |                          |
          +------------+-------------+
                       |
                       v
              Semantic Query Gateway
      metric + dimensions + time + freshness + scope
                       |
                       v
             Dashboard / BI / API / AI
```

The query gateway does not grant authority. Sensitive actions and current business decisions return
through the owning public domain contract.

## Business Fact Contracts

Each fact version declares enough information to interpret, secure, rebuild, and correct it.

| Required field                                    | Purpose                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Stable fact type and version                      | Exact public contract identity                             |
| Owning domain and semantic owner                  | Review and compatibility responsibility                    |
| Grain                                             | What one fact row or event represents                      |
| Tenant and business scope                         | Isolation and authorization context                        |
| Stable source identity                            | Deduplication, lineage, and correction linkage             |
| Source version or event position                  | Replay and drift detection                                 |
| Occurred, effective, and committed time semantics | Correct business-time and system-time interpretation       |
| Measures and exact representation                 | Decimal, integer, unit, quantity, and currency safety      |
| Dimension keys and validity semantics             | Valid grouping and historical joins                        |
| Correction model                                  | Reversal, supersession, cancellation, or deletion behavior |
| Sensitivity and retention                         | Privacy, legal, and lifecycle controls                     |
| Complete rebuild source                           | Retained events or snapshot plus replay                    |

A fact contract should publish only what approved analytical use requires. Data minimization remains
mandatory.

### Complete rebuild source

One of these paths must be explicit:

```text
retained ordered facts/events
-> complete rebuild
```

or:

```text
owner-approved snapshot/export at position N
+ facts/events after N
-> complete rebuild
```

A projection must not claim rebuildability from an event stream whose retention, redaction, or
payload shape omits required history.

### Time semantics

Do not collapse these into one ambiguous timestamp:

- occurrence time: when the source event happened;
- effective time: when the business fact applies;
- commit time: when the authority accepted it;
- projection time: when the analytic store applied it.

Period, timezone, daylight-saving, cutoff, and late-arrival rules belong in the fact or metric
contract, not in dashboard-local SQL.

### Versioned temporal boundaries

Every time-grained fact or metric references a versioned policy declaring its timezone identifier
and ruleset, calendar version, local cutoff, daylight-saving gap and fold resolution, timestamp
precision, and normalization. After normalization, period membership uses half-open intervals
`[start, end)`: `start <= effectiveTime < end`. A business-facing inclusive end date compiles to the
next exclusive boundary rather than changing interval semantics.

## Semantic Metrics and Dimensions

Each metric version declares:

```text
stable metric identity and owner
source fact type/version set
grain and output grain
valid dimensions and filters
time dimension and calendar policy
aggregation class and formula
join paths and cardinality
exact arithmetic, unit, and currency policy
null and missing-data behavior
authorization and sensitivity
freshness and retention
provider-independent output schema
```

### Empty inputs and absent groups

Each metric version declares whether no qualifying facts produce no row or one typed aggregate row.
For grouped results, absent groups are omitted unless the contract declares a finite group universe
and requires emitted rows. Each emitted measure separately declares zero or null behavior. Providers
must not synthesize rows or values beyond that contract, and conformance compares raw typed results
before client-side filling or normalization.

### Aggregation correctness

Metrics distinguish:

- additive measures, such as quantities safely summed across declared dimensions;
- semi-additive measures, such as snapshots that may aggregate across some dimensions but not time;
- non-additive measures, such as distinct counts and percentiles;
- derived measures, such as ratios whose components must be aggregated before division.

A dashboard must not infer aggregation from a column type.

### Total arithmetic semantics

Each derived expression declares operand, intermediate, and output precision and scale; null and
all-null behavior; zero-divisor and overflow outcomes; rounding mode and exact rounding points; and
whether non-finite inputs or results are rejected. Execution produces only the declared typed value,
null, or stable semantic error, without implicit coercion, truncation, or provider-specific failure.

### Join correctness

Every relationship declares expected cardinality and historical validity. A many-to-many
relationship requires an explicit bridge and allocation rule. A metric compiler or validator must
reject joins that can silently multiply the source grain.

Slowly changing dimensions declare whether a query uses the value valid at fact effective time or
the latest current value. The choice is part of the metric version.

### Total dimension membership

Every metric version declares one outcome for null, missing, orphaned, and late-arriving dimension
membership at its completeness frontier. A provider must not implicitly discard or duplicate a
source-grain fact because membership cannot be resolved. The fact uses the contract's declared
unresolved member or is excluded explicitly by the reviewed metric contract. Later resolution
follows that metric's declared restatement or as-known-at-frontier correction semantics.

### Versioning

A semantic change creates a new compatible or breaking version. Provider-only physical tuning does
not change the semantic version. Historical reports remain pinned to the versions required for
reproducibility.

Metric definitions are reviewed artifacts. The exact source language remains undecided until a
concrete implementation requires it.

## Ingestion, Replay, and Correction

The current ingestion path uses the transaction-aware Messaging outbox. PgQue remains the selected
future fan-out adapter only after ADR-0033's gates pass.

Consumers must:

- apply tenant scope before persistence;
- deduplicate stable source identity and version;
- commit PostgreSQL-local projection effects with completed consumer receipts when applicable;
- tolerate duplicate and bounded reordered delivery;
- expose lag and poison facts;
- preserve source, schema, metric, and projection versions;
- make backfill and live ingestion converge on the same result;
- quarantine incompatible or unexplained data rather than inventing a correction.

A correction is a new owner-controlled fact, reversal, supersession, or deletion instruction. An
analytic projection never edits canonical history to make a report look right.

### Correction visibility and deterministic replay

Each metric and rebuild contract declares whether historical results are restated with corrections
known at the execution frontier or reproduced as knowable at a declared source-completeness
frontier. Deterministic comparisons fix the tenant and query scope, fact and semantic versions, and
that same frontier. A correction completed after the frontier may change a restated-current result
but must not rewrite an as-known-at-frontier result.

Provider-specific incremental views require explicit correction behavior. If a provider reacts only
to new inserts, source mutations or partition replacement do not automatically repair the target;
rebuild, replacement, or compensating facts must be part of the projection design.

## Freshness and Consistency

Every analytic route declares the weakest safe consistency class from
[`state-and-consistency.md`](./state-and-consistency.md):

```text
eventual or bounded-stale
read-your-writes
authoritative-current
transactional
```

The normal Analytic Plane contract is eventual or bounded-stale. A request also declares an explicit
maximum staleness or accepts the route default.

### Conservative multi-source freshness

For a metric with several required sources, each source contributes completeness evidence for the
requested tenant, scope, and time semantics. The metric-wide `dataAsOf` must not advance beyond the
oldest required source completeness frontier. It is never derived from query time, projection write
time, or the newest successful ingestion alone. Late facts or an incomplete required source hold the
frontier back until replay or correction restores completeness. Source positions remain private.

A provider is eligible only when all are true:

```text
semantic version matches
requested dimensions and filters are supported
requested time range is complete
current authorization behavior is safe
observed dataAsOf satisfies maximum staleness
query and resource bounds can be enforced
```

The router must not select a faster but incomplete provider. The same semantic version must produce
the same typed result across eligible providers within the declared numerical and ordering contract.

Freshness does not prove current authorization, current canonical state, or read-your-writes. A
caller that requires those properties uses the separately classified owner-controlled route.

## Semantic Query Contract

A public query accepts only reviewed fields such as:

- metric identity and semantic version;
- group-by dimensions from the metric's allowlist;
- typed filters from the metric's allowlist;
- bounded time range and time grain;
- bounded order and result limit;
- consistency class and maximum staleness;
- tenant and authorization context derived from the trusted request context.

### Deterministic ordering and pagination

Every limited or paginated result uses a provider-independent total order with explicit text
comparison, null placement, and a stable unique final tie-breaker. The limit applies only after that
order is established. A continuation binds the complete ordering tuple, tenant and query scope,
semantic version, and one fixed projection/completeness frontier; internal positions remain opaque.
If that frontier cannot be continued, execution returns a stable semantic error rather than resuming
against changed projection state. Offset pagination is allowed only against the same fixed frontier.

The query compiler enforces maximum dimensions, joins, time range, scanned data, result rows, result
bytes, execution time, memory, and concurrency. Large reports and exports become durable async jobs.

Consumers ask for business semantics, not provider topology:

```text
metric = net_revenue
version = 3
group_by = branch
period = this_month
maximum_staleness = 5 minutes
```

Public responses may include semantic version, `dataAsOf`, and stale/degraded status. They must not
include internal table names, cluster names, event cursors, snapshots, files, partitions, or query
plans.

## No Primary Fallback

For projection-safe routes claiming hard isolation:

```text
projection available and eligible
-> execute within query-plane limits

projection delayed but declared stale result is allowed
-> serve the bounded stale result with dataAsOf

no eligible projection
-> typed AnalyticsUnavailable / 429 / 503

never
-> rerun the analytical query on PostgreSQL primary or command resources
```

The query process must not receive a command credential, command service binding, command pool, or
primary network path. Configuration and code must have no hidden fallback branch.

A bounded authoritative query may intentionally use a primary-backed owner path. It is a different
route, has a separate budget, and cannot claim this invariant.

## Authorization, Tenant Isolation, and Privacy

- Tenant scope is mandatory in fact contracts, projection keys, files, tables, caches, and queries.
- Projection membership, a metric definition, or ResourceLease never grants visibility.
- Sensitive results use a bounded owner-controlled authorization check or an owner-approved
  fail-closed authorization projection with explicit revocation and freshness behavior.
- If current visibility cannot be proven within the isolated path, the route fails closed or becomes
  an explicitly authoritative query.
- Deletion, erasure, legal hold, residency, retention, and field minimization propagate through
  every activated projection and export.
- Arbitrary tenant SQL, formulas, UDFs, provider credentials, or file locations are forbidden.

## Workload Isolation Inside Analytics

Analytics uses the canonical workload classes:

```text
query
-> interactive metric query
-> bounded drill-down
-> artifact retrieval

async
-> ingestion
-> projection build and rebuild
-> backfill and compaction
-> scheduled report and bulk export
```

A business command initiated by an analytic alert still re-enters the command path, authorization,
idempotency, and owner-controlled transaction boundary.

When measured need justifies it, the query and async resources may be partitioned further:

```text
interactive analytics
scheduled reporting
historical/ad-hoc analysis
export and ML extraction
```

Those are internal budgets, not new top-level workload classes. Expensive historical or ad-hoc work
must not starve interactive dashboards, and neither may consume the command reserve.

## Self-Observation Boundary

The Analytic Plane may act as a sensor for a future self-observing capability. Its output remains a
derived, freshness-qualified observation carrying source and semantic versions, lineage, and
`dataAsOf`; it is not a finding, policy decision, authorization grant, or business command.

A future evaluator may combine analytic observations with process, graph, search, policy, or other
owner-approved context. Any root-cause hypothesis, finding, or recommendation remains derived and
non-authoritative. It must not write domain tables, edit process definitions or policy, invoke a
private repository, or treat confidence as proof of current business state.

### Immutable evidence binding

Every finding or recommendation binds each citation to the exact typed observation content, tenant
and query scope, fact and semantic versions, `dataAsOf`, fixed completeness frontier, and a stable
integrity digest over its canonical representation. Advancing, rebuilding, correcting, or
re-evaluating source state creates new evidence and must not alter the cited evidence. A live,
changed, missing, or unverifiable citation fails explicitly instead of being silently substituted or
recomputed. Current authorization still governs whether preserved evidence may be disclosed.

### Recommendation actionability lifecycle

Before review or action, the exact finding or recommendation version must still be currently
actionable. Newer applicable evidence, a source correction, policy change, explicit supersession, or
withdrawal makes it non-actionable without altering its immutable historical record or citations.
Review exposes that state and action fails closed; execution must not silently substitute a newer
recommendation.

### Idempotent review and action binding

Approval and execution identity binds the exact recommendation version, typed action identity and
version, and canonical validated input. A retry or lost-response recovery may replay only that
identical intent and returns or reconciles the original outcome without another effect. Reusing the
same review, logical-step, or idempotency identity with a changed recommendation, action version, or
input fails closed; duplicate review cannot replace the previously bound intent.

### Unknown action outcomes and owner reconciliation

A dispatch timeout, lost response, or worker failure does not prove whether the owning command
committed. The action attempt remains `unknown`, bound to the exact recommendation, action version,
validated input, and idempotency identity. Unknown is neither success nor failure and is not
permission to issue a new command identity, compensate, or infer current business state.

Only the owning domain's public status or reconciliation contract may resolve the attempt as accepted,
rejected, or requiring manual recovery. Until then, the recommendation is not marked executed and a
superseding or retried recommendation cannot silently authorize a possibly duplicate effect. If new
evidence makes the recommendation non-actionable while its attempt is unknown, new action remains
blocked while the unresolved historical attempt is preserved. Manual recovery may fence and reconcile
the attempt but must not invent its business outcome.

### Outcome-bound compensation

Supersession, withdrawal, changed evidence, or an execution timeout does not itself authorize
compensation. A compensating action is a new owning-domain business command and is eligible only after
the original owner confirms an accepted effect and its public contract declares that exact outcome
compensable. The compensation binds the original recommendation and action attempt, accepted result
or committed fact identity, action version, and its own canonical input and idempotency identity.

An unknown or rejected attempt cannot be compensated as though it committed. Compensation re-enters
current authorization, separation-of-duties, admission, invariant, audit, and owner-controlled
transaction boundaries, and any unknown compensation outcome uses the same owner-reconciliation rule.
Its success creates new correcting history; it never rewrites the recommendation, cited evidence, or
original business outcome.

A proposed action re-enters the owning domain's typed public command with current identity,
authorization, command admission, idempotency, invariant validation, transaction, and audit. If
canonical state or authorization changed after observation, the command rejects or the evaluator
recomputes; it never bypasses the owner. Human or policy review is the default. Closing any automatic
action loop requires a separate accepted ADR with allowlisted bounded actions and safety evidence.

### Fresh authorization across observation, review, and action

Observation creation, recommendation review, and proposed action preserve the originating human or
service principal, reviewer, execution principal, and any delegation, correlation, and causation
provenance. Each stage independently revalidates current tenant-scoped visibility of its evidence and
applicable separation of duties. Revocation after observation creation fails closed at review; a
`ProcessPrincipal` cannot inherit or obscure the rights and actors used by either decision.

### Approval is not an execution lease

Review or approval records a decision at a point in time; it does not reserve future authorization,
evidence visibility, policy, actionability, or domain state. A queued or delayed action revalidates the
exact recommendation version, immutable evidence access, execution principal and delegation, current
policy and separation of duties, action contract version, and non-actionable lifecycle state
immediately before dispatch to the owning command.

Any failed revalidation blocks dispatch without erasing the historical approval or silently seeking a
replacement reviewer. A retry after delay performs the checks again. Review time, dispatch time, and
the versions evaluated at each boundary remain distinguishable in audit evidence.

### Concurrent dispatch and fencing

Any future action coordinator durably binds one dispatch attempt to the exact recommendation version,
action version, validated input, and owner-visible idempotency identity before invoking the command.
Concurrent workers may race for that attempt, but a process-local mutex or queue delivery is not proof
of exclusivity. Recovery uses a monotonic claim generation or equivalent fence so a stale worker cannot
dispatch or finalize after a replacement takes ownership.

The claim is coordination, not authorization, business authority, or proof of command completion. The
winner still performs immediate pre-dispatch revalidation, and every permitted retry presents the same
bound identity to the owning command. The owning domain's idempotency and reconciliation contracts
remain the final defense against duplicate effects and unknown outcomes.

### Cancellation does not retract an owning command

Cancellation is a currently authorized control decision, not evidence that a business effect did not
occur. Before dispatch, it atomically fences the exact attempt so no worker may invoke it. After
dispatch may have begun, cancellation blocks new local dispatch and records the request, but the
attempt remains dispatched or `unknown` until the owning domain confirms its outcome.

A cancellation race must not label an accepted or unknown command canceled, reuse a new identity, or
erase its audit history. If reconciliation confirms an accepted effect that now needs reversal, only
an explicit outcome-bound compensation command may correct it. Cancellation therefore preserves the
distinction between stopping future work and changing already committed business state.

### Action authority does not grant result disclosure

Permission to review or execute a recommendation does not imply permission to read every field in the
owning command's result or resulting domain facts. The owning public contract applies current
field-level disclosure, tenant scope, and redaction independently from action authorization. A future
coordinator retains only the minimum allowlisted receipt, owner reference, and outcome state required
for reconciliation and audit; it does not copy raw response payloads, errors, or sensitive facts into
the recommendation record, logs, or analytic evidence.

Later result access is reauthorized through the owner rather than inherited from the reviewer or
execution principal. If a result must become analytic evidence, it enters through an owner-approved
Business Fact Contract or a newly authorized observation with its own immutable citation. Outcome
status may remain visible without disclosing protected result content.

This architecture does not activate a knowledge graph, vector store, process-mining engine, LLM,
evaluator, finding/recommendation contract, or autonomous action runtime. Self-observation work, if
later approved, remains bounded `query` and `async` work and cannot consume the command reserve.

## Provider Progression

### Stage 1: PostgreSQL projection

Use an owner-approved, bounded PostgreSQL projection for the first measured analytic route. In a
minimal deployment it may be colocated and cannot claim physical non-interference.

### Stage 2: physically isolated projection store

Use a separate process, credentials, pools, and PostgreSQL projection database or approved replica
when the route requires a hard query-to-command claim and PostgreSQL remains sufficient.

### Stage 3: interactive OLAP provider

Evaluate ClickHouse, Pinot, a managed warehouse, or another OLAP engine only when representative
concurrency, latency, cardinality, retention, or isolation measurements exceed the approved
PostgreSQL design.

### Stage 4: historical open-table storage

Evaluate object storage with Iceberg or another open table format only when long retention,
interchange, independent compute, snapshot history, or multi-engine access is a real requirement.

DuckDB or another embedded engine is an execution option for bounded workers, exports, development,
or isolated historical queries. It is not automatically the storage tier after Iceberg and must not
run inside command processes without explicit CPU, memory, disk, extension, cancellation, and tenant
bounds.

Application query contracts remain stable across provider changes, but equivalence is proven by
conformance tests rather than assumed.

## Provider Activation Gates

A provider advances only after all applicable gates pass:

### Need

- one representative workload has a measured limitation;
- target latency, concurrency, freshness, retention, and cost are explicit;
- simpler PostgreSQL indexing, preaggregation, partitioning, or bounded projection changes are
  insufficient.

### Correctness

- golden datasets match the canonical metric contract;
- exact decimals, units, currencies, timezones, DST, nulls, late data, corrections, and join
  cardinality pass;
- backfill and live ingestion converge;
- projection delete and complete rebuild reproduce deterministic hashes.

### Security and isolation

- tenant and authorization tests fail closed;
- query and builder roles have no command credential or private-domain write path;
- memory, CPU, concurrency, queue, scanned-data, result, and timeout limits are enforced;
- adversarial analytics saturation preserves the reviewed command reserve.

### Operations

- backup, restore, upgrade, rollback, compaction, schema evolution, replay, and provider exit pass;
- lag, freshness, failures, cost, and capacity are observable;
- license, extension, object-store, catalog, and managed-service constraints are reviewed;
- a runbook names shared dependencies and excluded failure modes.

A mandatory external provider or strategic runtime dependency requires its own ADR.

## Financial Analytics

Financial analytics may consume only Accounting-approved facts and projections carrying the required
source identities, mapping versions, and reconciliation status. It must preserve the authority split
in [`financial-ledger.md`](./financial-ledger.md).

Forbidden:

- deriving an authoritative balance from an analytic table;
- treating a missing projection as proof that no financial transfer exists;
- reporting an unreconciled projection as current financial authority;
- writing a correction directly into an analytic store;
- giving an analytic worker direct provider authority that the financial architecture forbids.

## Deployment Profiles

| Deployment profile | Analytic capability                                                               |
| ------------------ | --------------------------------------------------------------------------------- |
| `entry`            | Bounded PostgreSQL reporting projection; no physical-isolation claim              |
| `standard`         | Separate query/async budgets and credentials; provider still optional             |
| `scale`            | Measured external OLAP or isolated projection store after gates                   |
| `enterprise`       | Independently scaled interactive and historical resources, still provider-neutral |

Deployment profile does not select a provider, grant authority, or waive readiness gates.

## Observability

Record, subject to redaction:

- fact, metric, semantic, and projection versions;
- tenant-scoped projection lag and `dataAsOf`;
- source completeness and rebuild position;
- query latency, scanned data, rows, bytes, memory, timeout, cancellation, and rejection;
- provider selection reason and ineligibility reason without exposing topology publicly;
- ingestion duplicates, reordering, late facts, corrections, quarantine, and replay;
- authorization denial, stale authorization, and deletion backlog;
- unresolved recommendation-action age and owner-confirmed reconciliation outcome;
- result-disclosure denials and allowlisted owner references without raw command payloads;
- per-budget saturation and command-reserve evidence;
- rebuild, conformance, backup, restore, upgrade, and exit results.

## Validation Contract

| Invariant                         | Required executable proof                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Analytics owns no canonical facts | Boundary scan rejects private tables, repositories, provider SDK authority, and write-back            |
| Projection is rebuildable         | Delete it, rebuild from the declared source at the same completeness frontier, and compare deterministic hashes |
| Replay is safe                    | Duplicate and reorder facts within the supported contract; final results remain identical             |
| Correction visibility is explicit | Rebuild twice at one frontier, then add a later correction; as-known results stay fixed while declared restated results change |
| Dimension membership is total     | Null, missing, orphaned, and late membership cases preserve the contract-declared included population before and after resolution |
| Empty result cardinality is stable | Empty-input and absent-group fixtures produce identical raw rows, group identities, and zero/null values before client normalization |
| Arithmetic is total               | Zero divisors, null operands, precision limits, tie rounding, intermediate rounding, overflow, and non-finite cases yield identical typed values, nulls, or semantic errors |
| Temporal membership is deterministic | Cutoff endpoints, timestamp precision, DST gaps/folds, and calendar-policy versions yield identical normalized instants, periods, aggregates, and hashes |
| Semantics are portable            | Every activated provider passes one golden typed dataset                                              |
| Pagination is stable              | Ties, nulls, text comparison, and a page split enumerate each fixed-frontier row exactly once; mismatched frontiers fail explicitly |
| Recommendations are non-authoritative | Change state or revoke access after observation; no direct mutation occurs and any proposed action re-enters the current owning command |
| Evidence citations are immutable  | Advance, correct, and rebuild after citation; original typed evidence and digest remain identical, while missing or changed evidence fails explicitly |
| Recommendation lifecycle fails closed | Add newer evidence, correction, policy change, supersession, or withdrawal; review/action rejects while historical evidence remains preserved |
| Review/action intent is idempotent | Retry identical bound intent after a lost response without another effect; key reuse with changed recommendation, action version, or input rejects |
| Unknown action outcome is reconciled | Lose responses before and after owner commit; no new identity, compensation, successor effect, or executed state appears until the owning contract confirms the outcome |
| Compensation is outcome-bound       | Attempt compensation for unknown and rejected actions, then for one owner-confirmed compensable effect; only the confirmed effect creates one separately authorized, idempotent correcting command |
| Approval grants no execution lease   | Approve, then change evidence access, policy, delegation, action version, or actionability before delayed dispatch; every stale case blocks before the owning command |
| Concurrent dispatch is fenced        | Race two workers, expire one claim, and resume it after replacement; all permitted calls retain one bound identity and the stale worker cannot dispatch or finalize |
| Cancellation preserves owner outcome | Cancel before dispatch, during dispatch, and after a lost response; only the undispatched attempt is stopped, while possible effects remain unresolved until owner reconciliation |
| Result disclosure is owner-controlled | Let a principal execute but deny protected result reads; recommendation state, audit, logs, and observations expose only the allowlisted receipt while owner-authorized readers receive redacted typed output |
| Review authorization stays current | Revoke evidence access or delegation after observation; review fails closed and a `ProcessPrincipal` cannot bypass action denial or SoD |
| Freshness is honest               | Inject asymmetric source lag, late facts, and incompleteness; `dataAsOf` never exceeds the oldest required source completeness frontier |
| Authorization fails closed        | Revoke access while a projection lags; no sensitive result is disclosed                               |
| Tenants are isolated              | Cross-tenant keys, filters, files, partitions, and caches cannot return data                          |
| Primary fallback is absent        | Remove the projection while primary is healthy; the route returns only declared degradation/error     |
| Commands retain capacity          | Saturate analytic queries/builders and keep command success and latency within the reviewed objective |
| Execution is bounded              | Timeout and cancellation release memory, slots, connections, files, and permits                       |
| Financial authority is preserved  | Reports reproduce Accounting-approved facts without becoming balance authority                        |
| Provider exit works               | Rebuild on the baseline provider and remove the candidate without changing public contracts           |

## Completion Criteria

The bounded architecture is implemented only when:

- one source domain publishes an owner-reviewed Business Fact Contract;
- one semantic metric is versioned and validated;
- one projection has a complete rebuild and correction path;
- one bounded query exposes explicit freshness and authorization behavior;
- projection failure proves no primary fallback;
- adversarial load proves the declared command reserve;
- provider-specific topology remains private;
- no external provider is called production-ready without its activation evidence.
