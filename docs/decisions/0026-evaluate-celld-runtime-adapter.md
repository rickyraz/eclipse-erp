# ADR-0026: Evaluate `celld` as the Distributed Stateful Entity Runtime Adapter

- Status: Proposed
- Date: 2026-08-06
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Stateful Entity Runtime decision:
>   [`./0025-introduce-stateful-entity-runtime.md`](./0025-introduce-stateful-entity-runtime.md)
> - Runtime architecture:
>   [`../architecture/runtime-architecture.md`](../architecture/runtime-architecture.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Workload isolation:
>   [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - Runtime comparison:
>   [`../architecture/reference/erp-runtime-comparison.md`](../architecture/reference/erp-runtime-comparison.md)

## Context

ADR-0025 accepts explicit state ownership as an RITSEI primitive without selecting a mandatory
implementation.

[`celld`](https://github.com/denoland/celld) is an open-source, self-hosted distributed Durable
Objects runtime. Its documented model aligns with the desired primitive: name-addressed objects, one
owner per cell, private SQLite state, JavaScript RPC, alarms, hibernation, and restoration from an
S3-compatible fleet bucket. Object-storage compare-and-swap selects one owner; the bucket stores the
cell databases, deployments, ownership records, leases, and peer authentication material. `celld`
treats that bucket as the durable source of truth for its cell database state.

The fit is promising but not sufficient for production adoption. As of August 10, 2026, upstream
says its runtime and compatibility surface are still evolving; a fleet runs one application
deployment; and peer HTTP requires a trusted private network or encrypted overlay because it does
not terminate TLS. RITSEI must continue to treat bucket access and credentials as
fleet-administrator access.

Current upstream references:

- [`celld` README](https://github.com/denoland/celld)
- [Cloudflare compatibility](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md)
- [Limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md)
- [Security](https://github.com/denoland/celld/blob/main/docs/security.md)

## Terminology Boundary

`celld` and workload isolation use the word `cell` for different abstractions:

```text
celld cell
-> one named stateful Durable Object
-> one active owner and one private SQLite database
-> entity-level coordination, serialization, activation, and recovery

WorkloadCell
-> one bounded deployment resource and fault-containment unit
-> tenant-group placement, workload planes, credentials, pools, and admission budgets
-> overload and noisy-neighbor containment
```

A `celld` cell may execute inside a WorkloadCell command plane, but neither one replaces the other.
A `celld` cell does not prove that projection traffic cannot consume reserved command capacity. A
WorkloadCell does not establish one active owner for a business entity.

`celld`'s bucket durability is a runtime property, not a transfer of RITSEI business authority.
PostgreSQL remains canonical for non-ledger business facts and control-plane state; financial
transfer, balance, and transfer-history authority follows
[ADR-0040](./0040-adopt-tigerbeetle-financial-ledger.md) when that profile is activated. A selected
runtime field must therefore follow the canonical, rebuildable, runtime-durable, or ephemeral
classification in [`state-and-consistency.md`](../architecture/state-and-consistency.md). A later
ADR would be required to make a `celld` SQLite fact canonical for RITSEI.

## Proposal

Evaluate `celld` as the first distributed adapter behind RITSEI-owned Stateful Entity Runtime
contracts.

This ADR does **not**:

- make `celld` a production dependency;
- authorize canonical business facts to live only in cell storage;
- expose Durable Object APIs to domain packages;
- replace PostgreSQL, PgQue, the job table, or the durable workflow engine;
- treat a cell address as a tenant-security boundary;
- activate a critical inventory, accounting, or workflow workload.

The initial implementation, if approved as roadmap work, is limited to a local contract
implementation and an experimental `celld` adapter exercised by a rebuildable, non-critical
workload.

## Why `celld`

The candidate is unusually close to the accepted runtime semantics:

| RITSEI requirement        | Documented `celld` capability                               |
| ----------------------------- | ----------------------------------------------------------- |
| Deterministic entity identity | Names as cell addresses                                     |
| One logical active writer     | One owning node and ownership epoch per cell                |
| Entity-local state            | Private SQLite database per cell                            |
| Addressed behavior            | Durable Object stubs and JavaScript RPC                     |
| Object-local scheduling       | Alarms                                                      |
| Idle-state efficiency         | Cell hibernation                                            |
| Node replacement              | Replication to and restoration from an S3-compatible bucket |
| Self-hosted operation         | Operator-owned nodes, network, and bucket                   |

This is an implementation fit, not a transfer of architectural ownership. RITSEI contracts
remain authoritative.

## Experimental Boundary

The first adapter must live below an RITSEI infrastructure boundary. Domain packages must not
import:

```text
celld APIs
cloudflare:workers
DurableObject
DurableObjectStub
Wrangler configuration types
cell SQLite implementation types
fleet bucket or ownership protocol types
```

No `celld` identifier, deployment topology, node address, ownership epoch, or bucket key may appear
in public domain DTOs, events, Process IR, or persistence schemas except in infrastructure
observability records.

The initial fleet is one trusted RITSEI application deployment. RITSEI tenancy remains
enforced by authentication, authorization, tenant-aware public contracts, PostgreSQL composite scope
constraints, and application ingress.

## Maturity Gates

`celld` remains experimental until every gate passes.

### 1. Contract and compatibility

- Implement the minimal RITSEI runtime contract without vendor leakage.
- Pin and test a specific `celld` release and compatibility date.
- Prove supported RPC, SQLite, alarm, activation, and hibernation behavior.
- Fail startup or deployment on unsupported required capabilities.

### 2. Consistency and recovery

- Prove stale-owner fencing.
- Test owner loss before PostgreSQL commit, after commit, and before response.
- Test duplicate commands, lost responses, stale projections, and replay.
- Rebuild or reconcile every experimental entity from PostgreSQL.
- Verify that cell state cannot overwrite a newer PostgreSQL version.

### 3. Security

- Complete threat modeling for ingress, peers, bucket authority, deployment artifacts, RPC payloads,
  tenant addresses, and diagnostics.
- Keep peer traffic on a trusted private network or encrypted overlay.
- Terminate and authenticate public traffic outside the peer listener.
- Scope bucket credentials to one fleet and treat them as administrator access.
- Do not claim hostile multi-tenant isolation from `celld`.

### 4. Operations

- Document installation, upgrade, rollback, backup, bucket recovery, node replacement, and incident
  response.
- Provide health, ownership, activation, resident-cell, pressure, recovery, command-latency, and
  reconciliation telemetry.
- Prove deployment rollback and runtime-state schema migration.
- Define capacity limits and pressure-shedding behavior.

### 5. Performance

For one approved benchmark workload, demonstrate a material improvement in at least one of:

- PostgreSQL reads per business command;
- row-lock or advisory-lock wait time;
- optimistic retry rate;
- PostgreSQL connection or CPU pressure;
- p95/p99 latency for a hot aggregate;
- repeated projection reconstruction cost.

The benchmark must also report activation latency, runtime command latency, ownership movement,
bucket operations, and total operating cost. A benchmark that only moves work from PostgreSQL to
another bottleneck does not pass.

### 6. Production readiness

- The upstream security and limitations posture is reviewed again at the exact version proposed for
  production.
- Failure-injection and soak tests pass under expected peak concurrency.
- At least one non-critical rebuildable workload operates successfully before a critical aggregate
  is proposed.
- Production activation receives a new Accepted ADR or superseding decision.

## Initial Candidate Workloads

Allowed first candidates:

- a rebuildable hot projection;
- a synthetic inventory-position benchmark;
- a non-authoritative operational monitor;
- an experimental object-local timer with PostgreSQL recovery.

Forbidden first candidates:

- posted accounting ledger state;
- legal or fiscal authority;
- canonical inventory movement history;
- payment authority;
- production Process Studio workflow truth;
- any state that cannot be rebuilt or reconciled.

## Exit Strategy

RITSEI must be able to stop using `celld` without losing canonical business state.

The adapter must preserve these exit properties:

- PostgreSQL remains sufficient to rebuild every enabled cell category.
- Stable entity addresses are RITSEI-defined, not `celld`-defined.
- Runtime snapshots have an explicit portable schema or are disposable.
- Domain commands can route through a local/direct-PostgreSQL adapter.
- Adapter selection is composition-root configuration, not domain policy.
- No public contract or durable event requires a `celld` type.
- Each category can be disabled independently.
- A drain procedure stops new routing, waits for in-flight commands, verifies PostgreSQL versions,
  and releases or discards runtime state.

Exit triggers include:

- failed security or recovery gates;
- unacceptable upstream churn or abandonment;
- inability to upgrade or roll back safely;
- no measurable workload benefit;
- operating cost or complexity exceeding the benefit;
- a better adapter satisfying the same RITSEI contracts.

## Alternatives Considered

### Activate `celld` immediately for inventory

Rejected. Inventory is a promising benchmark, but current alpha maturity and the cross-store
consistency boundary require experimental proof first.

### Use Cloudflare Durable Objects directly

Not selected as the initial self-hosted adapter because RITSEI requires a self-hosted deployment
path. The RITSEI abstraction must nevertheless avoid preventing a future Cloudflare adapter.

### Build a distributed runtime in RITSEI

Rejected. Ownership, routing, replication, fencing, activation, and hibernation are not ERP
differentiators and would create a large infrastructure project.

### Use PostgreSQL only

Remains the production fallback. Rejection of `celld` would not invalidate ADR-0025; another adapter
or continued direct PostgreSQL coordination may serve each workload.

## Consequences

### Positive

- Evaluation starts from a runtime closely aligned with explicit state ownership.
- Self-hosted operation remains possible.
- Vendor risk is contained behind a stable contract and exit path.
- Maturity is decided by executable gates rather than enthusiasm.

### Negative

- The adapter and test harness add infrastructure work before business benefit is proven.
- Object storage and private-network operation become part of the experiment.
- Compatibility must be reassessed for every pinned release.

### Risks

- Alpha behavior or compatibility may change.
- Bucket compromise grants fleet-level authority.
- Plain peer HTTP is unsafe outside a trusted or encrypted network.
- A one-application fleet may complicate deployment topology.
- The experiment could encourage premature cell modeling.

## Validation

This proposal advances only through the maturity gates above. Until a later ADR accepts production
use, documentation and code must label the adapter `experimental`, keep it disabled by default, and
exclude it from production readiness claims.
