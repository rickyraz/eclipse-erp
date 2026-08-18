# Workload Isolation and Non-Interference Architecture

> **Status:** Canonical
>
> **Owns:** Workload-plane classification, overload non-interference, WorkloadCell routing,
> shuffle-shard containment, resource admission, hard and adaptive ceilings, projection-query
> isolation, and proof requirements for isolation claims.
>
> **Related documents**
>
> - Canonical architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - Stateful runtime: [`./runtime-architecture.md`](./runtime-architecture.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Messaging: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Deployment notes: [`../deployment/README.md`](../deployment/README.md)
> - Non-interference ADR:
>   [`../decisions/0034-adopt-non-interference-overload-isolation.md`](../decisions/0034-adopt-non-interference-overload-isolation.md)
> - Comparative reference:
>   [`./reference/hard-isolation-patterns.md`](./reference/hard-isolation-patterns.md)

## Position

RITSEI treats overload isolation as a non-interference problem, not only a throughput or
recovery problem.

The target for projection-safe dashboard, search, and reporting traffic is:

> Query traffic has no architectural capability to consume the resource reserve required by
> canonical commands.

For a source workload `S`, protected workload `P`, and reviewed resource sets:

```text
R(S) intersection R_reserved(P) = empty
```

This guarantee is scoped. It applies only to named workloads, named resources, and a deployment that
proves the separation. It is not a universal claim that RITSEI cannot experience an outage.

The architecture preserves the existing authority model:

```text
Owning domain capability
-> business meaning and authorization

PostgreSQL
-> canonical business truth and commit

Workload isolation fabric
-> routing, admission, resource containment, and overload behavior

Projection store
-> rebuildable query state

PgQue / jobs / workflow
-> committed delivery and durable asynchronous progress
```

## Vocabulary

### Workload class

A workload class describes execution-resource behavior. It is metadata, not a capability ID, domain,
role, or HTTP method.

The initial classes are:

```text
command
query
async
```

A deployment may subdivide them internally. Query work may be authoritative or projection-backed;
async work may be indexing, projection building, export, integration, or workflow orchestration.
These remain subcategories of `command`, `query`, and `async`, not competing top-level classes.
Public contracts must not expose process, pool, node, WorkloadCell, or provider topology.

### Criticality

Criticality states what may happen during overload:

```text
protected
-> preserve a reviewed reserve and reject competing work first

degradable
-> return stale, partial, cached, or reduced results when the contract permits

discardable
-> reject, cancel, coalesce, or defer without changing canonical facts
```

Criticality is not authorization priority. A protected request without a valid capability is still
denied.

### ResourceLease

A `ResourceLease` is a bounded infrastructure permit to occupy specified resources. It may represent
one concurrency slot or weighted resource units. The permit remains occupied until every guarded
resource is released. A deadline or lease expiry must cancel or fence the guarded work before
capacity is reused; expiry alone must not double-admit work.

It is not:

- a business capability;
- a database lock;
- a Stateful Entity Runtime ownership lease;
- a job lease;
- an idempotency record;
- a fairness guarantee;
- durable acceptance of work.

These concepts keep their existing owners and semantics.

### WorkloadCell

A `WorkloadCell` is a bounded deployment unit used for resource and fault containment. It may
contain command, query, and async planes with separately enforced budgets.

A WorkloadCell is not:

- a domain module;
- a Tenant or Legal Entity authority;
- a PostgreSQL schema owner;
- a Stateful Entity Runtime entity;
- a `celld` runtime cell;
- an authorization boundary by itself.

A `celld` cell is one named stateful Durable Object with an active owner and private SQLite state;
its bucket durability belongs to that runtime's own state model. A WorkloadCell instead contains
workload resources and fault boundaries. Neither concept transfers RITSEI business authority
from PostgreSQL.

The full term `WorkloadCell` must be used in architecture documents when ambiguity is possible.

### Shuffle shard

A shuffle shard is a deterministic, limited subset of executors or other contended resources
assigned to one routing scope. Different scopes may overlap partially, but one scope cannot route to
the entire fleet.

Shuffle sharding is permitted for executors, query workers, async consumers, admission buckets, and
other resources where partial overlap reduces blast radius. It does not change canonical data
ownership.

## System Shape

```text
                                 Browser
                                    |
                     signed authenticated request
                                    |
                                    v
                    +-------------------------------+
                    | Thin Workload Router          |
                    | route metadata + placement    |
                    | no business mutation          |
                    | no PostgreSQL transaction     |
                    | no primary credential         |
                    +---------------+---------------+
                                    |
                    tenant-scoped deterministic key
                                    |
                  +-----------------+-----------------+
                  |                                   |
                  v                                   v
           WorkloadCell A                      WorkloadCell B
           bounded resources                   bounded resources
                  |
                  v
      tenant-scoped principal shuffle shard
                  |
  +---------------+----------------------+----------------------+
  |                           |                      |
  v                           v                      v
Command plane              Query plane           Async plane
canonical transitions      bounded projections   events/jobs/workflows
  |                           |                      |
command lease              query lease            async lease
  |                           |                      |
command executors          query executors        async workers
  |                           |                      |
command-only pool          query-only pool        async-only pool
  |                           |                      |
PostgreSQL primary         projection store       PgQue/outbox/jobs
  |                                                  |
  +---------------- committed facts -----------------+
                          |
                          v
                  projection builders
                          |
                          v
                  projection store
```

The principal-shard and plane split repeats independently inside each WorkloadCell. This diagram is
the hard-isolation target. A minimal deployment may colocate roles, but colocation cannot be
presented as proof that physical resources are disjoint.

## Isolation Claims

Every non-interference claim must define five things:

```text
source workload
protected workload
reserved resources
shared dependencies
excluded failure modes
```

Example:

```text
Source:
  projection-backed accounting dashboard requests from one tenant-scoped user

Protected:
  canonical accounting posting commands

Reserved:
  command ingress slots
  command executor CPU and memory
  command concurrency permits
  command PostgreSQL connections
  command database role and primary network path

Shared but bounded:
  external load balancer
  thin router deployment
  identity verification keys

Excluded:
  PostgreSQL primary outage
  regional network failure
  bad deployment sent to every WorkloadCell
  command-plane request storm
  operator removal of the reserve
```

A deployment must not use those labels, including the phrase **impossible by construction**, without
this scope and executable evidence.

### Initial invariant

For projection-safe dashboard traffic:

```text
R_dashboard intersection R_command_reserved = empty
```

Per tenant-scoped user:

```text
query_concurrency(user, tenant) <= user_query_hard_limit
```

For command capacity:

```text
command_reserved > 0
```

and `command_reserved` is independent of query capacity consumed.

For adaptive admission:

```text
adaptive_limit <= hard_limit
```

## Workload Classification and Business Verbs

Capability IDs continue to use the owner/resource/business-verb grammar from ADR-0031:

```text
accounting.journal.post
accounting.invoice.approve
inventory.stock.reserve
inventory.stock_transfer.confirm
identity.user_account.read
```

Do not add topology or overload mechanics to capability IDs:

```text
accounting.workload_cell_a.journal.post  forbidden
accounting.journal.post.high         forbidden
inventory.stock.reserve.command      forbidden
report.read.query_pool_2             forbidden
```

The owning public contract declares or derives workload metadata such as:

```text
workload class
criticality
consistency requirement
estimated cost revision
maximum execution time or deadline
admission scope
projection freshness when applicable
```

No exact TypeScript metadata interface is mandated until the first implementation needs it.

### Default classification guidance

| Business behavior                                                                                | Default workload interpretation                                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `post`, `reverse`, `approve`, `confirm`, `reserve`, `release`, `receive`, `transfer`, `complete` | Canonical command; owner-required reads remain inside the command path             |
| ordinary `create`, `update`, lifecycle verbs                                                     | Command unless the operation only creates a durable async request                  |
| `read` of current invariant-sensitive state                                                      | Authoritative read; not automatically projection-safe                              |
| `read` of dashboard, search, summary, or historical projection                                   | Query when bounded freshness and authorization rules are declared                  |
| bulk export or expensive consolidated report                                                     | Small command to register work, followed by async execution and artifact retrieval |

The verb does not determine resource cost by itself. `read` can be cheap or expensive; `post` can
also vary by document size. The owner must classify the actual contract.

Technical labels such as `route`, `admit`, `acquire`, `releasePermit`, `shed`, and `coalesce` belong
to infrastructure implementation rather than the business capability examples in this document.
ADR-0031 remains the sole owner of allowed and forbidden business-verb conventions.

## Thin Router Contract

The router performs constant or tightly bounded work:

1. validate or consume a trusted signed principal context;
2. resolve static route metadata;
3. derive a tenant-aware placement key;
4. select the WorkloadCell and workload plane;
5. enforce an ingress permit or route to the plane admission point;
6. forward the request with correlation and deadline metadata.

The router must not:

- evaluate business invariants;
- grant a capability;
- call domain repositories;
- start a PostgreSQL transaction;
- hold a PostgreSQL-primary credential;
- run a report or projection query;
- accept a client-provided WorkloadCell, shard, executor, or pool identifier;
- fall back from query to command resources.

Placement changes use an internal version or epoch. Public entity IDs, capability IDs, event
schemas, Process IR, and URLs remain stable across WorkloadCell movement.

The router is shared infrastructure and therefore needs its own hard in-flight bounds and protected
command ingress reserve. If query traffic can exhaust all router or authentication capacity, the
deployment cannot claim end-to-end query-to-command non-interference.

## Recursive Placement and Shuffle Sharding

The default routing dimensions are deliberately small:

```text
tenantId
+ principal kind
+ tenant-scoped admission principal key
+ workload class
```

Admission keys cover every authorized principal kind:

```text
HumanPrincipal
-> tenantId + userAccountId

ServicePrincipal
-> tenantId + stable service-principal identity

ProcessPrincipal
-> tenantId + stable process-principal identity

DelegatedPrincipal
-> charge the effective principal and the underlying human, service, or process principal
```

A `UserAccount` is global but admission and routing are tenant-scoped because one account may belong
to several tenants. Delegation must not create a fresh budget that bypasses the delegating or
underlying principal's containment.

A possible recursive mapping is:

```text
region or deployment
-> tenant-group WorkloadCell
-> workload plane
-> tenant-scoped principal shuffle shard
-> bounded executor subset
```

Rules:

- mapping must be deterministic for a declared placement epoch;
- one user or tenant must not route to every executor in the plane;
- shard size and maximum overlap must be tested;
- retries remain inside the assigned shard unless an explicit evacuation policy changes the epoch;
- evacuation must not create two writable canonical authorities;
- staggered deployment and bounded WorkloadCell size are required for WorkloadCell-level
  fault-containment claims;
- cross-WorkloadCell calls remain exceptional and explicit;
- routing topology stays out of public contracts and domain addresses.

Legal Entity, Branch, Warehouse, fiscal period, or business object may be added as a routing
dimension only after the owning domain proves it is the natural workload grain. The scope hierarchy
must not be turned into infrastructure sharding by convention.

## Resource Admission

### Admission order

The normal path is:

```text
acquire an anonymous verification permit at the edge or router
-> verify authenticated identity cheaply
-> acquire a tenant/principal pre-authorization ingress permit
-> resolve route and workload metadata
-> decode a bounded request envelope
-> perform scoped authorization through a bounded plane-appropriate path
-> acquire the protected execution ResourceLease
-> acquire the plane-specific database or projection connection
-> execute
-> release guarded resources and permits on success, failure, cancellation, or timeout
```

The anonymous verification permit bounds invalid or unauthenticated pressure before identity work.
The tenant/principal pre-authorization permit bounds authenticated but unauthorized pressure and is
not part of the protected command execution reserve. An unauthorized caller must not occupy a
command execution permit. Authorization I/O has its own hard bounds; query authorization must not
consume command authorization capacity.

A rejected permit performs no canonical mutation and must not acquire the protected connection it
was intended to guard. An execution permit remains held until all guarded work stops and every
guarded resource is released.

### Hierarchical budgets

A permit may be constrained simultaneously by:

```text
WorkloadCell hard ceiling
workload-plane reserve
adaptive safe ceiling
tenant budget
principal budget
route or operation budget
weighted cost
```

Admission succeeds only when every required budget has capacity.

The first implementation should prefer local or WorkloadCell-scoped semaphores and static weighted
cost classes. A distributed global lease authority is not required and must not be introduced until
a measured coordination need justifies its availability and consistency cost.

### Cost calibration

Request count is not the capacity model. Initial estimated cost may use owner-reviewed integer
units, but production calibration measures the actual limiting resources, such as:

- CPU time;
- memory and allocation pressure;
- PostgreSQL connection hold time;
- database CPU, I/O, WAL, lock, and statement duration;
- projection-store CPU and I/O;
- external-provider concurrency;
- artifact size and transfer cost.

Cost revisions are operational metadata. They do not version the business capability.

## Hard and Adaptive Ceilings

Each executor and connection budget has a physical hard limit established by load tests and safe
operating margin.

Adaptive control may reduce current admission when latency or saturation rises:

```text
physical hard limit = 100
reviewed normal ceiling = 70
adaptive ceiling during database slowdown = 35
actual admitted work <= 35
```

Adaptive control must not:

- exceed the physical hard limit;
- consume the protected command reserve for query or async work;
- hide an unbounded queue behind a lower execution limit;
- treat rejected or timed-out canonical commands as safe to replay without idempotency;
- replace database constraints, expected-version checks, or Stateful Entity Runtime fencing.

## Command Plane

The command plane owns execution resources for canonical transitions.

It may:

- execute public owner-controlled business commands;
- perform authoritative reads required for authorization and invariant evaluation;
- open typed PostgreSQL transactions through the kernel;
- write canonical idempotency outcomes and transactional events/outbox records;
- use the optional Stateful Entity Runtime before the PostgreSQL transaction for approved
  categories.

It must:

- preserve a non-zero reviewed reserve;
- acquire a command permit before a command database connection;
- use command-specific credentials and pools in an isolated deployment;
- keep queue depth and wait time bounded;
- reject before overload becomes database connection starvation;
- preserve command IDs, deadlines, cancellation, correlation, and causation.

It must not route heavy report computation through command executors merely because an endpoint uses
an HTTP write method. The command may register an async job and return its durable identity.

## Query Plane

The query plane serves bounded reads. It contains three consistency paths:

```text
authoritative query
-> bounded primary-backed owner query
-> outside the projection no-primary guarantee

replica read-your-writes query
-> wait for an opaque required consistency position on an approved standby
-> sees at least the caller's required commit, not necessarily the primary's latest state

projection query
-> bounded rebuildable read model
-> eligible for the hard query-to-command claim
```

The replica read-your-writes path is deferred under ADR-0039. It may claim no-primary-credential
isolation only after its route-scoped activation gates prove replica-only credentials, bounded wait,
placement and timeline validation, current authorization, and no primary fallback.

An authoritative query uses an explicit query budget and must not consume the command reserve. A
hard-isolated projection route may access:

- query gateway capacity;
- query executor capacity;
- a query-only connection pool;
- a rebuildable projection store;
- query-specific authorization infrastructure with its own bounded budget.

It must not access:

- command executors;
- command admission permits;
- command database pools;
- command database roles;
- a PostgreSQL-primary credential;
- a fallback that executes the dashboard query on the primary.

Projection routes must declare:

```text
source facts or events
projection version
freshness objective
maximum tolerated staleness
bounded query shape
rebuild and replay procedure
authorization and revocation behavior
degraded and unavailable response
```

Sensitive projection results require current owner-controlled authorization. The isolated path must
satisfy that rule through either:

- a bounded owner-controlled authorization-check contract with its own read-only capacity and no
  access to the command reserve; or
- a fail-closed owner-approved authorization projection with an explicit revocation, scope, SoD, and
  freshness contract.

If current authorization or canonical state cannot be evaluated safely within those resources,
classify the route as an authoritative query and give it an explicit bounded primary budget. It
cannot claim the projection-query non-interference invariant.

Dashboards must use bounded projection lookups rather than arbitrary OLTP aggregation. A projection
store may be PostgreSQL, a replica, or another approved store, but it remains non-authoritative. A
replica qualifies as isolated only when its lag, WAL retention, failure, and resource behavior
cannot consume the protected primary reserve named in the claim.

## Async Plane

The async plane owns committed-event consumers, projection builders, jobs, exports, integration
delivery, and durable workflow orchestration.

A canonical business command remains command-plane work even when a job, event consumer, or workflow
initiates it. Async orchestration uses the existing job or workflow durability semantics to hand the
command to a command-capable worker composition root. That worker acquires command admission and
invokes the owning typed public domain contract locally; it does not use loopback HTTP.
Authorization, idempotency, owner-controlled services, and PostgreSQL transaction rules still apply.
An async lifecycle credential must not become an alternate domain-mutation path.

It must:

- use finite concurrency and queue/backlog limits;
- use separate worker and database budgets from command reserve;
- preserve PgQue, job, and workflow semantics rather than wrapping them in one generic lease;
- remain idempotent under duplicate delivery and retry;
- propagate deadlines where work has an expiry;
- expose backlog age, attempts, poison work, and recovery state;
- shed, pause, or defer lower-criticality work before it starves commands.

Durable acceptance belongs to PgQue, the job table, or the workflow engine. Acquiring a
ResourceLease alone does not mean async work has been accepted durably.

## Queue and Shedding Contract

Interactive queues are intentionally short.

Every queue or waiting room declares:

```text
maximum depth
maximum wait
cancellation behavior
deadline propagation
overload response
retry policy
```

Default behavior:

- no permit: fail fast;
- expired deadline: cancel and release capacity;
- projection overload: return `429`, `503`, stale data, or a reduced response as declared;
- large report: create an async job instead of waiting interactively;
- command overload: reject before opening a transaction, preserving safe idempotent retry semantics.

Do not hold thousands of browser requests behind a small executor pool. Durable queues are reserved
for work the system has explicitly accepted and can observe, retry, and recover.

## Projection Build and Freshness

Canonical mutation flow remains:

```text
public command
-> PostgreSQL transaction
-> canonical mutation + idempotency + outbox/event
-> commit
-> PgQue/outbox/job delivery
-> idempotent projection builder
-> projection store
-> bounded query
```

Rules:

- the projection never acknowledges the canonical command;
- duplicate or reordered delivery must not duplicate business effects;
- rebuild from canonical sources must reproduce the query contract;
- projection lag is observable by tenant, projection, and source position;
- overload may pause or shed projection work without changing canonical facts;
- query clients see declared staleness or unavailability, not silent primary fallback;
- sensitive results remain subject to current authorization requirements.

Detailed authority, version, replay, and reconciliation semantics remain owned by
[`state-and-consistency.md`](./state-and-consistency.md) and
[`search-architecture.md`](./search-architecture.md).

## Database and Credential Boundaries

A deployment that claims hard query-to-command isolation uses distinct identities and pools:

```text
command process
-> command credential
-> command pool
-> PostgreSQL primary

query process
-> query credential
-> query pool
-> projection store

optional query authorization service
-> query-authorization credential
-> separate read-only authorization pool
-> approved primary authorization path

async process
-> async lifecycle credential
-> async pool
-> outbox / PgQue / jobs / projection and workflow lifecycle state

async-initiated business command
-> existing job or workflow durable handoff
-> command-capable worker composition root
-> command admission and command credential
-> owner-controlled PostgreSQL transaction
```

The query process must not receive the command secret in its environment, image, mounted secret set,
or runtime bindings. Network policy should deny query-plane access to the primary when the
deployment platform supports it.

Pool maxima must fit reviewed database limits. The command connection reserve may use PostgreSQL 19
`reserved_connections`, but only together with command-only privilege, bounded command admission,
and reviewed pool ceilings as specified in
[`../operations/database-roles.md`](../operations/database-roles.md). Separate pools or reserved
server slots on the same PostgreSQL instance provide connection budgeting, not complete CPU, I/O,
lock, WAL, or storage isolation. Claims must name exactly which resources are protected.

WorkloadCell and database placement must preserve every accepted cross-domain invariant that
requires one PostgreSQL transaction. Moving participating owners to incompatible database placements
requires a superseding consistency decision; deployment configuration must not silently replace
atomic work with events or compensation.

## Authorization and Tenant Isolation

Workload placement never grants access.

- The router validates routing inputs but does not make the business authorization decision.
- WorkloadCell, shuffle-shard, executor, or projection membership is not authorization evidence.
- ResourceLease acquisition does not imply capability grant.
- Query projections must preserve tenant scope and fail closed on missing or invalid authorization
  context.
- A stale visibility projection must not disclose sensitive data after revocation.
- Sensitive isolated queries invoke an owner-controlled authorization-check contract or use an
  owner-approved fail-closed authorization projection with explicit scope, SoD, freshness, and
  revocation behavior.
- PostgreSQL RLS remains defense in depth for primary paths.

The authorized scope and admission scope may use similar dimensions, but they are evaluated for
different purposes and must not be conflated.

## Deployment Profiles

### Minimal

Logical workload classes may share one API process and one PostgreSQL deployment. Use bounded local
concurrency, connection budgets, statement timeouts, and query limits.

This profile preserves correctness but does not claim physical non-interference.

### Workload-isolated

Command, query, and async roles use separate processes or enforced resource groups, credentials,
pools, and stores. Projection-safe query workers have no primary credential and no primary fallback.
Command ingress and execution retain a protected reserve.

This profile may claim query-to-command non-interference for the resources proven disjoint.

### WorkloadCell-isolated

Tenant groups are placed into bounded WorkloadCells. WorkloadCells use versioned routing, staggered
deployment, bounded size, and minimal cross-WorkloadCell interaction. Recursive shuffle sharding may
further limit a tenant-scoped user's executor subset.

A WorkloadCell may claim broader fault isolation only when the named state, compute, network, and
storage resources are actually independent. Shared PostgreSQL or control-plane dependencies must
remain explicit.

### Dedicated regulated deployment

A tenant or jurisdiction may receive dedicated runtime, credentials, storage, observability, and
PostgreSQL placement when regulatory or contractual requirements justify it. This is a deployment
profile, not a new domain ownership model.

## Failure Behavior

The initial protected scenario is:

```text
many dashboard tabs
+ browser retry loop
+ expensive projection filters
+ one tenant-scoped user
```

Expected behavior:

```text
query user budget saturates
-> assigned query shuffle shard saturates
-> query permits are denied
-> bounded stale / 429 / 503 response
-> query executor and projection store may degrade
-> command reserve remains available
-> query traffic does not starve the named command resources
-> command completion remains subject to primary health and other declared exclusions
```

The guarantee does not automatically cover:

- PostgreSQL primary outage;
- command-plane poison requests or command storms;
- shared identity provider or key service outage;
- edge, router, DNS, network, region, storage, or power failure outside the proof;
- a bad release deployed to every WorkloadCell simultaneously;
- operator misconfiguration that removes or shares the reserve;
- correlated schema or data defects affecting both planes.

## Observability

Required dimensions, subject to redaction policy:

```text
workload_class
criticality
workload_cell_id or hashed placement identity
shuffle_shard_epoch
route or operation identifier
tenant_id where permitted
hashed principal admission key
estimated cost revision
hard limit
adaptive limit
permits used and denied
queue depth and wait
connection pool used and reserved
projection version and lag
command id and correlation id where applicable
```

Required outcomes include:

- permit acquisition latency and denial rate;
- saturation by WorkloadCell, plane, tenant, principal, and route;
- hard versus adaptive limit movement;
- command reserve remaining during query and async saturation;
- pool wait, statement duration, cancellation, timeout, and lock wait;
- projection backlog, freshness, rebuild, and failure;
- `429` and `503` volume with retry behavior;
- WorkloadCell placement, evacuation, overlap, and correlated failure;
- command success rate and p95/p99 latency during adversarial load.

Do not put raw tenant data, request payloads, or unbounded user identifiers in metrics.

## Enforcement

Static and contract checks should verify:

- every public route resolves to owner-reviewed workload metadata;
- capability IDs contain business ownership and verbs, not topology or priority;
- query composition roots cannot resolve command database services;
- query packages and deployments do not receive command credentials;
- projection routes have no code or configuration fallback to the primary;
- hard limits exist for every adaptive limiter;
- queue depths and wait deadlines are finite;
- topology remains absent from public DTOs, events, entity addresses, and Process IR.

Deployment validation should verify:

- resource requests/limits or equivalent hard enforcement;
- separate secret and network bindings;
- pool maxima and reserved command capacity;
- bounded router and authentication admission;
- staggered WorkloadCell deployment where WorkloadCell isolation is claimed;
- overload tests against the declared failure model.

## Adoption Gates

Adopt the fabric in stages; do not start with a universal distributed control plane.

### Gate 1: classify and measure

- declare workload, criticality, consistency, deadline, and cost metadata;
- bound current in-flight work, queues, statements, results, and report dimensions;
- measure per-route CPU, memory, connection hold time, database cost, and retries.

### Gate 2: preserve command reserve

- establish hard per-plane concurrency and connection budgets;
- reserve command ingress, executor, and database capacity;
- reject query and async work before command starvation;
- add adversarial multitab and retry-storm tests.

### Gate 3: isolate projection queries physically

- move selected dashboards and reports to rebuildable projections;
- separate query process, credential, pool, and store;
- remove primary fallback;
- prove freshness, authorization, replay, rebuild, and query-to-command non-interference.

### Gate 4: introduce WorkloadCells

- define bounded WorkloadCell size and placement epoch;
- route tenant groups without public topology leakage;
- stagger deployments and test evacuation;
- document every shared dependency.

### Gate 5: add recursive shuffle sharding

- demonstrate unacceptable blast radius within a plane;
- select stable tenant-aware principal keys;
- choose shard size and maximum overlap from load and failure tests;
- prove one principal cannot route to the entire executor fleet.

Database sharding, multi-region canonical writes, or a centralized distributed lease authority
remain separate later decisions.

## Completion Criteria

The architecture target is operationally proven when:

- protected and degradable workloads are classified at their public contracts;
- query and async saturation cannot consume the reviewed command reserve;
- projection-safe dashboard workers cannot access PostgreSQL-primary credentials or fallback paths;
- hard ceilings bound every adaptive limiter;
- bounded admission rejects before protected connection acquisition;
- WorkloadCell and shuffle-shard routing remain topology-private and tenant-aware;
- authorization, PostgreSQL truth, idempotency, and domain ownership remain unchanged;
- executable overload tests support every published non-interference claim;
- shared dependencies and remaining outage classes are documented explicitly.
