# Hard-Isolation Patterns for RITSEI

> **Status:** Reference
>
> **Owns:** Comparative background for cell architecture, shuffle sharding, overload control,
> concurrency partitioning, bounded queues, and their possible application to ERP workloads.
>
> **Must not own:** Binding RITSEI workload-isolation, routing, admission, projection, or
> deployment rules.
>
> **Related documents**
>
> - Workload isolation: [`../workload-isolation.md`](../workload-isolation.md)
> - Canonical architecture: [`../architecture-spec-v4.md`](../architecture-spec-v4.md)
> - Search architecture: [`../search-architecture.md`](../search-architecture.md)
> - State and consistency: [`../state-and-consistency.md`](../state-and-consistency.md)
> - Non-interference ADR:
>   [`../../decisions/0034-adopt-non-interference-overload-isolation.md`](../../decisions/0034-adopt-non-interference-overload-isolation.md)

## Purpose

This document compares four external reliability patterns and translates their useful parts into
RITSEI terminology:

- AWS cell and bulkhead architecture;
- AWS shuffle sharding and recursive shuffle sharding;
- Google SRE overload control and load shedding;
- Netflix adaptive concurrency and traffic partitioning.

The sources describe large distributed services, not ERP domain semantics. RITSEI adopts only
the parts that preserve its modular monolith, PostgreSQL canonical truth, typed owner-controlled
contracts, rebuildable projections, and explicit authorization model.

Sources were reviewed on 2026-08-10.

## Starting Failure Model

The motivating ERP failure is not only high request count. It is correlated resource reachability:

```text
one dashboard user
-> many tabs or retry loop
-> every general API worker
-> shared database pool
-> expensive OLTP aggregation
-> PostgreSQL primary saturation
-> posting and approval commands starve
```

The stronger target is:

```text
projection dashboard traffic
-X-> command executor reserve
-X-> command connection reserve
-X-> PostgreSQL-primary credential
```

This is a non-interference claim for one failure class, not a promise of universal uptime.

## AWS Cell and Bulkhead Architecture

AWS Well-Architected describes cells as independent workload instances that handle subsets of
requests. It warns against unbounded cells, shared state or components, complex router business
logic, and excessive cross-cell interaction. The router is the exceptional shared layer and should
remain simple and testable.

Primary references:

- [AWS Well-Architected: Use bulkhead architectures to limit scope of impact](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_use_bulkhead.html)
- [AWS: Reducing the Scope of Impact with Cell-Based Architecture](https://docs.aws.amazon.com/pdfs/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.pdf)

### Useful lesson

A fault boundary is credible only when the components named by the claim are independent. Merely
running several copies behind one load balancer does not create a cell if they share every executor,
credential, pool, and state dependency.

A router should do placement, not business work:

```text
partition key
-> bounded deterministic routing
-> one cell
```

### RITSEI adaptation

RITSEI uses `WorkloadCell` to avoid confusion with a Stateful Entity Runtime entity or a `celld`
runtime cell.

The initial natural partition key is `tenantId`, because tenant scope is present in authorization
and business contracts. A tenant-scoped `userAccountId` or service principal may narrow the executor
set inside a plane. Legal Entity, Branch, or Warehouse is not automatically a cell boundary because
ERP commands may need cross-scope transactions.

The modular monolith remains one application family. WorkloadCells are deployment copies and
resource partitions, not independently owned domain services.

## AWS Shuffle Sharding

AWS explains that ordinary horizontal load balancing spreads harmful requests across every healthy
instance. Ordinary sharding narrows impact to one fixed shard, while shuffle sharding assigns each
customer or resource a small, partially overlapping subset of workers. The number of possible
virtual shards grows combinatorially.

AWS also notes that shuffle sharding can apply to queues, rate limiters, locks, and other contended
resources. Its Builders' Library describes recursive shuffle sharding as applying isolation at
multiple layers, including a customer's customer.

Primary references:

- [AWS Architecture Blog: Shuffle Sharding—Massive and Magical Fault Isolation](https://aws.amazon.com/blogs/architecture/shuffle-sharding-massive-and-magical-fault-isolation/)
- [Amazon Builders' Library: Workload isolation using shuffle-sharding](https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/)

### Useful lesson

Normal balancing optimizes average utilization but gives one harmful caller a path to the entire
fleet:

```text
user A
-> E1 E2 E3 E4 E5 E6
```

Shuffle sharding restricts reachability:

```text
user A -> {E2, E7, E11}
user B -> {E1, E5, E9}
user C -> {E3, E7, E12}
```

One caller may damage its assigned subset, but cannot directly exercise every executor.

### RITSEI adaptation

The useful recursive order is not a universal domain hierarchy. It is an infrastructure routing
sequence:

```text
deployment or region
-> tenant-group WorkloadCell
-> workload plane
-> tenant-scoped principal shuffle shard
-> bounded executor subset
```

This respects RITSEI's identity model: one `UserAccount` may participate in several tenants, so
`tenantId + userAccountId` is the relevant admission key.

Shuffle-shard membership remains private. It must not enter capability IDs, entity addresses, event
schemas, URLs, Process IR, or database primary keys.

### What RITSEI does not copy

- DNS-based customer routing is an AWS implementation example, not an RITSEI requirement.
- Retry across every shard member is not automatically safe for commands; command IDs and
  idempotency remain mandatory.
- A shuffle shard does not grant authorization or create canonical ownership.
- Partial worker overlap does not isolate a shared PostgreSQL primary by itself.

## Google SRE Overload Control

Google SRE recommends graceful degradation where cheaper cached or local results are acceptable and
notes that request rate is often a poor capacity metric because requests can consume very different
resources. It describes per-customer resource limits, accepting only work the backend can process,
and shedding excess load.

The cascading-failures guidance recommends small queues for steady interactive traffic and describes
queueless serving patterns that reject or fail over when execution slots are full. It also describes
returning `503` when in-flight work exceeds a configured limit.

Primary references:

- [Google SRE Book: Handling Overload](https://sre.google/sre-book/handling-overload/)
- [Google SRE Book: Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/)

### Useful lesson: resource cost, not request count

These requests may each count as one HTTP request but have radically different cost:

```text
read one dashboard projection row

versus

generate a seven-year consolidated report
for several legal entities with currency conversion
```

RITSEI therefore treats static request cost as versioned operational metadata and calibrates it
against measured CPU, memory, connection hold time, database I/O, WAL, locks, and projection-store
cost.

### Useful lesson: cheap degraded reads

During overload, a bounded projection lookup or stale result can be safer than querying canonical
storage. This maps naturally to ERP dashboards:

```text
canonical command commits
-> event/outbox
-> projection builder
-> dashboard projection
-> bounded query
```

The projection remains non-authoritative. Freshness and authorization remain explicit.

### Useful lesson: reject before backlog grows

For interactive work:

```text
slot available -> execute
no slot        -> reject or degrade
```

is usually safer than:

```text
request
-> queue behind thousands of obsolete browser requests
-> timeout
-> retry
-> larger queue
```

Durable queues remain appropriate for explicitly accepted jobs and workflows with retries,
idempotency, and operator-visible lifecycle.

## Netflix Adaptive Concurrency and Partitioning

Netflix's `concurrency-limits` project models service overload through in-flight concurrency and
latency rather than fixed requests per second. Its enforcement examples support immediate rejection
at the current limit and percentage partitions that reserve capacity for traffic classes such as
live versus batch or writes versus other work.

Primary reference:

- [Netflix `concurrency-limits`](https://github.com/Netflix/concurrency-limits)

### Useful lesson

Adaptive concurrency detects a safe current operating point as latency and dependency behavior
change. Traffic partitions can prevent low-criticality work from consuming every slot.

Conceptually:

```text
hard physical ceiling = 100
reviewed normal ceiling = 70
adaptive ceiling during slowdown = 35
```

with:

```text
adaptive ceiling <= hard physical ceiling
```

### RITSEI adaptation

Adaptive control is subordinate to a physical command reserve. It may lower query, async, or command
admission when latency rises, but it may not raise total concurrency above the tested hard ceiling
or lend protected command resources to dashboard traffic.

Traffic classification comes from trusted route and contract metadata, not a client-provided header.
The tenant, principal, capability, and route are derived from authenticated RITSEI context.

### What RITSEI does not copy

- The Java library is a reference, not a selected dependency.
- A latency algorithm does not replace hard container/process limits or database pool maxima.
- Percentage partitioning over one shared pool is workload governance, not proof of disjoint CPU,
  memory, I/O, or credentials.
- An adaptive limiter does not replace authorization, idempotency, expected-version checks, or
  database constraints.

## Combined Reference Model

The patterns complement rather than replace one another:

| Pattern                    | Primary contribution                                  | RITSEI use                                                         |
| -------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Cell/bulkhead architecture | Bounded fault domains and thin routing                | Tenant-group WorkloadCells with explicit shared dependencies           |
| Shuffle sharding           | Limits one caller to a subset of contended resources  | Tenant-scoped user or service-principal executor subsets               |
| Google overload control    | Resource-aware admission, degradation, early shedding | Weighted ResourceLeases, projection reads, bounded queues, `429`/`503` |
| Netflix concurrency limits | Adaptive in-flight limits and traffic partitions      | Adaptive ceiling below a physical hard ceiling and command reserve     |

Combined target:

```text
thin router
-> bounded WorkloadCell
-> tenant-aware recursive placement
-> command/query/async resource planes
-> hard ResourceLease before scarce resources
-> adaptive ceiling below hard ceiling
-> projection-backed dashboard reads
-> fail fast instead of long interactive queues
```

## RITSEI-Specific Corrections

A direct copy of hyperscale service patterns would violate current RITSEI decisions. The
adaptation therefore preserves these constraints.

### PostgreSQL remains canonical

No cell, lease, executor, projection, cache, or adaptive limiter may acknowledge a canonical
business transition without PostgreSQL commit.

### Domain ownership remains semantic

Workload placement does not split one domain into microservices or let a cell own a business
invariant. Other domains still call the owner's typed public contract.

### Business verbs stay topology-neutral

Capability identifiers describe business effects:

```text
accounting.journal.post
inventory.stock.reserve
inventory.stock_transfer.confirm
```

They do not describe execution mechanics:

```text
accounting.journal.post.cell_a
inventory.stock.reserve.high_priority
```

Workload class and estimated cost remain metadata.

### Commands may read

Physical command/query separation does not mean commands are write-only. Posting, approving,
reserving, and confirming need authoritative reads for authorization, expected versions, balances,
stock, fiscal state, and other invariants.

### Not every read belongs on a projection

Read-after-write, authorization-sensitive, and invariant-sensitive reads may require an
authoritative path. Only bounded projection-safe reads qualify for the strongest dashboard
non-interference claim.

### No hidden fallback

A projection route that silently executes its query on the primary during projection failure
recreates the failure path the isolation design is meant to remove. It must return declared stale,
reduced, `429`, or `503` behavior instead.

### Stateful runtime remains separate

A `StatefulEntity` serializes commands for one approved aggregate. A `WorkloadCell` contains
infrastructure resources for a workload subset. A `celld` cell is a named stateful execution object
with private SQLite state and one active owner. They must not be conflated.

`celld`'s bucket is durable authority for its own SQLite state; that is not automatically canonical
business authority in RITSEI. Under ADR-0003, PostgreSQL remains canonical for business facts.
Therefore `celld` supports entity-level coordination and recovery, while WorkloadCells, workload
planes, and ResourceLeases protect command resources from degradable workload traffic.

## Example ERP Flow

```text
                         DASHBOARD TABS
                               |
                 tenant + user + route metadata
                               |
                               v
                    query shuffle shard
                      {Q3, Q7, Q9}
                               |
                     user query hard limit
                               |
                 +-------------+-------------+
                 |                           |
            permits available             exhausted
                 |                           |
                 v                           v
        bounded projection lookup      429 / 503 / stale
                 |
                 v
          projection store saturated


                         POST INVOICE
                               |
                               v
                         command plane
                               |
                        command-only permit
                               |
                     reserved command executor
                               |
                    reserved primary connection
                               |
                               v
                     PostgreSQL canonical commit
```

The dashboard path may fail while the posting path retains its named reserve.

## Limits of the Claim

Even a correct implementation cannot eliminate every outage. Remaining common failure classes
include:

- PostgreSQL primary or storage failure;
- correlated schema or data bugs;
- region, network, DNS, identity provider, power, or kernel failure;
- a bad release deployed to every cell simultaneously;
- operator error or leaked credentials;
- command-plane overload from expensive or poison commands;
- shared control-plane exhaustion not covered by the reserve;
- projection authorization defects.

The architecture is valuable because it can make one important statement testable:

> Under the declared resource-isolation model, projection-safe dashboard traffic from one
> tenant-scoped user cannot consume the executor slots, database connections, or primary-database
> credentials reserved for canonical commands.

The canonical wording, deployment profiles, and proof requirements are owned by
[`../workload-isolation.md`](../workload-isolation.md).
