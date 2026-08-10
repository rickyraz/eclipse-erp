# ERP Runtime Coordination Comparison

> **Status:** Reference
>
> **Owns:** Comparative background for ERP state ownership and coordination.
>
> **Must not own:** Binding EclipseERP runtime or consistency rules.
>
> **Related documents**
>
> - Stateful runtime: [`../runtime-architecture.md`](../runtime-architecture.md)
> - Workload isolation: [`../workload-isolation.md`](../workload-isolation.md)
> - State and consistency: [`../state-and-consistency.md`](../state-and-consistency.md)
> - Stateful runtime ADR:
>   [`../../decisions/0025-introduce-stateful-entity-runtime.md`](../../decisions/0025-introduce-stateful-entity-runtime.md)
> - `celld` evaluation:
>   [`../../decisions/0026-evaluate-celld-runtime-adapter.md`](../../decisions/0026-evaluate-celld-runtime-adapter.md)

## Purpose

This document compares three broad coordination styles:

- Odoo's shared ORM model graph;
- SAP's application-level enqueue locks and queued RFC mechanisms;
- EclipseERP's target separation of domain ownership, active entity ownership, canonical PostgreSQL
  state, and durable asynchronous work.

The comparison is approximate. Odoo and SAP are mature systems with broader capabilities and
different histories. The purpose is to clarify EclipseERP's chosen boundaries, not to rank the
products.

## Odoo: Shared ORM Model Graph

Odoo's documented ORM provides PostgreSQL-backed persistent models, relational fields (`Many2one`,
`One2many`, and `Many2many`), computed fields, constraints, caching, and several inheritance and
extension mechanisms. Modules can extend models in place by adding or overriding fields,
constraints, and methods.

Primary reference:

- [Odoo ORM API](https://www.odoo.com/documentation/19.0/developer/reference/backend/orm.html)

Conceptually:

```text
module extension
      |
      v
shared ORM model graph
      |
      +-- relational traversal
      +-- computed dependencies
      +-- inherited fields and methods
      +-- cross-module extensions
      |
      v
PostgreSQL
```

### Strengths

- Rapid module extension around a shared business model.
- Rich relational querying and record navigation.
- Familiar persistence model for CRUD-heavy business applications.
- Computed fields and inheritance can reduce local implementation effort.

### Risks from the EclipseERP perspective

The same flexibility can make mutation authority and dependency closure harder to identify as
extensions accumulate. A relation or inherited method makes a record reachable; it does not by
itself establish which capability owns the business invariant.

EclipseERP therefore does not use a shared ORM graph as its public business contract. Drizzle
remains persistence infrastructure, and domain behavior is exposed through typed owner-controlled
services. Cross-domain table writes and private implementation imports are forbidden.

This is not a claim that relational fields or inheritance are inherently wrong. EclipseERP also uses
relational data. The difference is that persistence reachability does not grant mutation authority.

## SAP: Enqueue and qRFC

SAP documents an application-level lock concept implemented by the Standalone Enqueue Server.
Enqueue locks can span several database logical units of work, while database locks exist for the
shorter database LUW that performs the actual update. The enqueue lock table is maintained outside
the database lock table.

SAP also documents queued RFC as a serialization layer over transactional RFC. Inbound or outbound
queues establish application-defined processing order for logical units of work.

Primary references:

- [SAP Lock Concept](https://help.sap.com/docs/ABAP_PLATFORM_NEW/6568469cf5a1460a8d85c58b83d21ec2/47df116e6abf296fe10000000a42189b)
- [Relationship Between Enqueue Locks and Database Locks](https://help.sap.com/docs/ABAP_PLATFORM_NEW/6568469cf5a1460a8d85c58b83d21ec2/47d9967bf6e74ac5e10000000a42189d.html)
- [qRFC Communication Model](https://help.sap.com/docs/ABAP_PLATFORM_NEW/753088fc00704d0a80e7fbd6803c8adb/489be66e1f84062ee10000000a42189d.html)

Conceptually:

```text
business transaction
      |
      v
Enqueue Server
      |
application-level logical lock
      |
      v
database transaction

and separately:

accepted remote work
      |
      v
qRFC queue
      |
ordered processing
```

### Architectural lesson

Application-level business coordination and database transaction locking are related but distinct.
Ordered asynchronous work is also a separate concern. This precedent supports EclipseERP's decision
not to force PostgreSQL to be the only coordination abstraction.

### Difference from a stateful entity runtime

SAP enqueue primarily represents logical lock ownership. A stateful entity runtime combines a richer
set of concerns:

```text
identity
+ active owner
+ state
+ behavior
+ serialization
+ lifecycle
+ recovery
```

The analogy is conceptual, not an API or implementation mapping. EclipseERP does not attempt to
reproduce SAP Enqueue or qRFC.

## EclipseERP: Explicit Stateful Ownership

EclipseERP's target model is:

```text
Public Domain Contract
      |
      v
Stateful Entity Runtime
      |
      +-- deterministic identity
      +-- one logical active owner
      +-- serialized entity commands
      +-- active or projected state
      +-- activation and recovery
      |
      +---------------------+
      |                     |
      v                     v
PostgreSQL              PgQue / Jobs / Workflow
canonical truth         delivery and durable work
```

The model separates four authorities:

| Concern                               | EclipseERP owner                             |
| ------------------------------------- | -------------------------------------------- |
| Business invariant and command        | Owning domain capability                     |
| Active identity-local serialization   | Stateful Entity Runtime, when enabled        |
| Canonical committed fact              | PostgreSQL-backed domain transaction         |
| Eventual delivery or process progress | PgQue, job table, or durable workflow engine |

### Distinguishing properties

- The database schema is not the public business object graph.
- A queue partition is not automatically the aggregate owner.
- Runtime ownership does not become business authorization.
- Runtime-local durability does not become canonical authority.
- Plugins call typed public contracts instead of mutating core tables.
- A selected aggregate may have a runtime identity matching its consistency boundary.
- Most entities remain ordinary PostgreSQL-backed domain state.

## Approximate Comparison

| Dimension                        | Odoo shared ORM graph                               | SAP enqueue/qRFC                          | EclipseERP target                            |
| -------------------------------- | --------------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Primary extension boundary       | Model and view extension                            | ABAP application/runtime mechanisms       | Typed public domain contracts                |
| Persistence model                | PostgreSQL-backed ORM models                        | HANA or supported database                | PostgreSQL-owned domain schemas              |
| Application coordination         | ORM methods, transactions, model conventions        | Enqueue logical locks                     | Optional stateful entity owner               |
| Ordered async work               | Job/integration mechanisms outside this comparison  | qRFC/bgRFC family                         | PgQue, job table, durable workflow           |
| Runtime state owner              | Usually reconstructed through application/ORM state | Logical lock owner, not rich object state | Named entity with active state and behavior  |
| Cross-domain mutation discipline | Model extension and relation access                 | Application-specific                      | Owner contract only; no foreign table writes |
| Canonical authority              | Database-backed ORM state                           | Database business records                 | PostgreSQL business facts                    |
| Stateful-runtime vendor          | Not applicable                                      | SAP runtime                               | Replaceable adapter; `celld` proposed        |

## Avoiding a Distributed ORM Graph

A stateful runtime can recreate the same ambiguity it is intended to solve if entities synchronously
traverse arbitrary remote references:

```text
A -> B -> C -> D -> E
```

EclipseERP therefore treats an entity reference as an execution address, not a remote
object-navigation capability.

Preferred interaction:

```text
coarse-grained domain command
explicit process coordinator
committed domain event
bounded projection
```

Avoid:

```text
remote property traversal
implicit cascading mutation
unbounded synchronous entity chains
runtime ownership inferred from relation reachability
```

## `celld` Is Not a WorkloadCell

`celld` uses _cell_ for a stateful execution object. A WorkloadCell uses the term for a deployment
fault and resource boundary. They are orthogonal:

| Question                | WorkloadCell                                             | `celld` cell                                                      |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| What is bounded?        | Tenant-group workload resources and failure blast radius | One named object's stateful execution                             |
| Routing key             | Tenant and principal workload placement                  | Entity/object address                                             |
| Main protection         | Query/async starvation and noisy-neighbor spread         | Concurrent transitions for one coordination atom                  |
| State                   | May host pools and projection infrastructure             | Private SQLite state replicated to its bucket                     |
| Authority in EclipseERP | Never domain authority                                   | Runtime state only unless a later ADR changes canonical ownership |

A command can first enter a WorkloadCell command plane and then route to a `celld` object for
entity-local serialization. This does not make `celld` a substitute for resource leases, command
reserves, or projection isolation.

## `celld` in the Comparison

`celld` is relevant because its documented Durable Object surface includes one writer per cell,
names as addresses, private SQLite state, RPC methods, alarms, and hibernatable WebSockets. Its
fleet uses an S3-compatible bucket for durable cell state and ownership coordination; upstream
treats the bucket as the durable source of truth for its SQLite state.

That storage authority is `celld` runtime semantics. EclipseERP's separate decision is that
PostgreSQL remains canonical for business facts, so an enabled adapter must classify and reconcile
its runtime fields under [`state-and-consistency.md`](../state-and-consistency.md).

Primary references:

- [`celld` repository](https://github.com/denoland/celld)
- [`celld` Cloudflare compatibility](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md)
- [Cloudflare Durable Objects glossary](https://developers.cloudflare.com/durable-objects/reference/glossary/)
- [Cloudflare SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

The implementation remains experimental for EclipseERP. The comparison explains why the model is
attractive; ADR-0026 owns maturity, security, operations, and exit gates.

## Conclusion

The useful lessons are narrow:

- Odoo demonstrates the power and coupling potential of a shared extensible ORM graph.
- SAP demonstrates that application-level logical coordination and ordered asynchronous work need
  not be identical to database locking.
- EclipseERP combines explicit domain ownership with an optional richer active entity owner while
  preserving PostgreSQL as canonical truth and separate durable-work primitives.

The target is not remotely accessible object-oriented programming. It is explicit, replaceable,
identity-local state ownership.
