# ADR-0034: Adopt Non-Interference as the Overload-Isolation Target

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Workload isolation:
>   [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - PostgreSQL architecture:
>   [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Capability naming:
>   [`./0031-capability-naming-and-business-verb-conventions.md`](./0031-capability-naming-and-business-verb-conventions.md)
> - Comparative reference:
>   [`../architecture/reference/hard-isolation-patterns.md`](../architecture/reference/hard-isolation-patterns.md)

## Context

Ordinary horizontal scaling does not prevent one harmful caller from reaching every executor. A
multitab dashboard, browser retry loop, poison query, expensive report, or unbounded background
consumer can spread contention through shared workers and database pools until canonical ERP
commands cannot obtain the resources required to commit.

Per-route requests-per-second limits are not a sufficient safety boundary:

- equal request counts can have radically different CPU, memory, I/O, lock, and database cost;
- admission after a database connection is acquired protects too late;
- one shared pool still allows degradable work to starve transactional work;
- long interactive queues amplify latency, timeouts, and retries;
- adaptive concurrency cannot create capacity that was never physically reserved.

EclipseERP needs a stronger, scoped objective:

> A degradable workload has no architectural path to the resource reserve required by a protected
> canonical workload.

This is a testable non-interference claim for a named failure class, not a promise that EclipseERP
can never experience an outage.

## Decision

EclipseERP adopts **Non-Interference** as the target principle for overload isolation.

For source workload `S`, protected workload `P`, and the resources named by the deployment claim:

```text
R(S) intersection R_reserved(P) = empty
```

The first protected failure class is projection-safe dashboard, search, and reporting traffic
starving canonical transactional commands.

### Workload semantics stay separate from business authority

Public operations receive workload metadata independently from their HTTP method and capability ID.
The top-level workload planes are:

```text
command
query
async
```

The query plane distinguishes bounded authoritative reads from projection-safe reads. Only the
projection-safe path qualifies for the strongest no-primary-credential guarantee.

A business command remains command-plane work whether it was initiated by HTTP, a job, a committed
event, or a durable workflow. Async orchestration hands the work through the existing job or
workflow durability semantics to a command-capable worker composition root. That worker re-enters
command admission, authorization, idempotency, and the owner-controlled transaction path without
loopback HTTP; an async credential must not become an alternate domain-mutation authority.

Business verbs remain governed by ADR-0031. Capability IDs describe owner-controlled effects, not
cells, pools, priority, cost, criticality, or deployment topology. Workload class, criticality,
consistency, cost estimate, deadline, and admission remain metadata.

### Protected command reserve

A deployment claiming query-to-command non-interference must reserve the command resources named by
its claim. Projection-query and async work cannot acquire the protected command ingress, execution,
connection, or admission reserve.

Projection-safe query executors must not possess a PostgreSQL-primary credential and must not fall
back to the command pool or primary when their projection path fails. Async infrastructure may use a
separate, narrowly privileged primary-backed budget for outbox, PgQue, job, projection, or workflow
lifecycle state, but it cannot consume the command reserve or mutate domain facts outside the
command path.

Separate pools on one PostgreSQL instance provide budgeting, not complete CPU, I/O, WAL, lock,
storage, or failover isolation. Every published claim must name its shared dependencies and excluded
failure modes.

### Bounded admission and ceilings

Admission uses bounded resource permits rather than request rate alone.

An anonymous edge/router permit bounds identity-verification work. After authentication, a
principal-scoped pre-authorization permit bounds unauthorized pressure. The protected execution
permit is acquired only after scoped authorization succeeds and before an executor slot, database
connection, projection connection, or other guarded resource is acquired. Authorization I/O has its
own bounded capacity.

A permit remains occupied until all guarded resources are released. Deadline or lease expiry must
cancel or fence the guarded work before capacity is reused.

Each protected resource has a tested hard ceiling. Adaptive concurrency may lower the current safe
ceiling but never exceed the hard limit:

```text
adaptive_limit <= hard_limit
```

A non-zero command reserve remains independent of query and async consumption.

### Bounded waiting and degradation

Interactive queues, wait deadlines, and in-flight work are finite. Overload is rejected or degraded
before a large backlog forms. Projection routes may return declared stale, reduced, `429`, or `503`
behavior; they do not silently execute the same work on the primary.

Durable queues remain appropriate only for explicitly accepted jobs, events, and workflows with
idempotency, retry, recovery, and operator-visible lifecycle.

### WorkloadCells and shuffle sharding

`WorkloadCell` is the deployment term for a bounded resource- and fault-containment unit. It is
distinct from a Tenant, domain module, Stateful Entity Runtime entity, and `celld` runtime cell.

A thin topology-only router may place tenant-scoped traffic into WorkloadCells and may recursively
shuffle-shard selected resources by tenant, tenant-scoped principal, and workload plane. Clients do
not choose WorkloadCells or executors, and placement remains absent from public DTOs, capability
IDs, events, entity addresses, URLs, and Process IR.

Shuffle sharding is conditional. It is introduced only after measurements show that ordinary
WorkloadCell placement and hierarchical admission leave an unacceptable caller blast radius.

### Existing architectural authority remains intact

This decision does not convert domain modules into microservices or weaken accepted transaction
boundaries.

- EclipseERP remains one modular-monolith application family.
- PostgreSQL remains canonical for business facts.
- Current cross-domain invariants that require one PostgreSQL transaction must remain colocated on a
  transactionally compatible database placement.
- Splitting an accepted atomic invariant across database placements requires a superseding
  consistency decision; operators cannot silently replace it with eventual delivery or compensation.
- WorkloadCell placement does not change semantic ownership, authorization, public identity, or
  Stateful Entity Runtime addressing.
- PgQue, jobs, and workflows keep their distinct durability and delivery semantics.

Database sharding, mandatory PgBouncer, a mandatory external query store, multi-region writes, or a
centralized distributed lease service each require separate evidence and, where materially
irreversible, a separate ADR.

### Deployment claims

Minimal colocated deployments remain supported, but logical classes and separate semaphores alone do
not justify a physical non-interference claim.

A deployment may claim hard query-to-command non-interference only when it publishes and verifies:

- source and protected workloads;
- exact reserved resources;
- shared dependencies and excluded failures;
- hard and adaptive ceilings;
- credential and network boundaries;
- projection authorization and revocation behavior;
- overload-test acceptance criteria and results.

Detailed current-state rules are owned by
[`../architecture/workload-isolation.md`](../architecture/workload-isolation.md).

## Alternatives Considered

### Keep horizontal scaling plus request-rate limits

Rejected as the target. It reduces some load but still allows harmful traffic to spread across all
shared executors and pools, while request count remains a poor proxy for resource cost.

### Require one fully independent WorkloadCell per tenant immediately

Rejected. It adds placement, migration, and operating cost before measured need and turns a large
tenant into the next indivisible noisy neighbor. Tenant-group and dedicated WorkloadCells remain
scaled deployment options.

### Require full CQRS with separate command and query databases

Rejected as a universal semantic model. Commands require authoritative reads, many operational
queries remain appropriate on PostgreSQL, and projections add freshness and reconciliation costs.
Physical projection separation is required only for routes and deployments claiming that specific
hard guarantee.

### Use adaptive concurrency as the sole safety boundary

Rejected. Adaptive control is useful below a physical ceiling but cannot create a protected reserve
or remove shared credentials and pools.

### Absorb overload in large queues

Rejected for interactive ERP traffic. Large queues preserve obsolete requests, increase tail
latency, and amplify retries. Heavy reports and exports should become durable asynchronous work.

## Consequences

### Positive

- Dashboard-to-command starvation becomes a precise, executable failure claim.
- Critical commands can retain capacity while projection traffic saturates.
- Workload control aligns with business verbs without polluting capability identity.
- Overload is rejected before scarce execution and database resources are consumed.
- WorkloadCells and shuffle shards can narrow tenant and principal blast radius without changing
  domain contracts.

### Negative

- Strong guarantees require separate resource budgets, credentials, projections, and operational
  tests.
- Projection-backed dashboards introduce freshness, authorization, replay, and reconciliation work.
- Reserved command capacity may remain idle while query traffic is rejected.
- Minimal deployments cannot claim the same isolation as physically separated deployments.

### Risks

- Logical limits could be mislabeled as hard isolation.
- Shared router, identity, network, database, storage, or deployment dependencies could invalidate
  an overbroad claim.
- Stale authorization projections could disclose sensitive data.
- Poor placement keys could increase cross-WorkloadCell work or leak topology into domain models.
- Retry behavior without deadlines, jitter, and idempotency could recreate the storm.

## Validation

Before production claims hard query-to-command non-interference, prove the validation contract in
[`../architecture/workload-isolation.md`](../architecture/workload-isolation.md), including:

- owner-reviewed workload, criticality, consistency, cost, deadline, and admission metadata;
- authorized execution admission before guarded resource acquisition;
- projection-query inability to obtain command services, command pools, or primary credentials;
- async-triggered business commands re-entering the command path;
- hard ceilings bounding adaptive limits;
- bounded queues, cancellation, and permit release;
- tenant- and principal-scoped overload containment;
- projection freshness, authorization, replay, rebuild, and no-primary-fallback behavior;
- preserved accepted PostgreSQL transaction boundaries;
- command success rate and p95/p99 latency within the deployment's reviewed objective during
  adversarial query and async load.

## Related Documents

- [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
- [`../architecture/reference/hard-isolation-patterns.md`](../architecture/reference/hard-isolation-patterns.md)
- [`../architecture/search-architecture.md`](../architecture/search-architecture.md)
- [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
- [`../deployment/README.md`](../deployment/README.md)
