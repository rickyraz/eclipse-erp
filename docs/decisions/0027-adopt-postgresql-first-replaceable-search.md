# ADR-0027: Adopt PostgreSQL-First, Replaceable Search

- Status: Accepted
- Date: 2026-08-06
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical search architecture:
>   [`../architecture/search-architecture.md`](../architecture/search-architecture.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - PostgreSQL architecture:
>   [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Messaging: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Deployment notes: [`../deployment/README.md`](../deployment/README.md)

## Context

ERP search combines several different workloads:

- exact identifiers such as invoice numbers, SKUs, account codes, and tax identifiers;
- structured filtering by tenant, legal entity, status, date, warehouse, and lifecycle;
- ranked lexical retrieval over descriptions, documents, products, and support records;
- optional semantic retrieval where users describe a concept without using the stored vocabulary;
- global discovery across facts owned by several domains.

Starting with an external search cluster would add another execution environment, duplicated data,
projection delivery, reconciliation, credentials, backups, upgrades, and failure modes before
EclipseERP has measured a need for independent search scaling.

PostgreSQL-native ranked and vector search may reduce that complexity while preserving relational
filters and tenant-aware access. The implementation choices are not yet equally mature for the
project's PostgreSQL 19 floor. As of 2026-08-06, `pg_textsearch` documents PostgreSQL 17 and 18
support and requires `shared_preload_libraries`; PostgreSQL 19 compatibility is not established for
EclipseERP. Vector extensions and embedding pipelines require their own compatibility, privacy,
recovery, and workload evidence.

Current upstream references:

- [Tiger Data hybrid-search article](https://www.tigerdata.com/blog/hybrid-search-postgres-you-probably-should)
- [`pg_textsearch` repository](https://github.com/timescale/pg_textsearch)
- [`pgvector` repository](https://github.com/pgvector/pgvector)
- [`pgvectorscale` repository](https://github.com/timescale/pgvectorscale)

## Decision

EclipseERP adopts a **PostgreSQL-first, replaceable search architecture**.

The default progression is:

```text
exact and structured PostgreSQL queries
-> built-in PostgreSQL text search where sufficient
-> PostgreSQL-native BM25 after compatibility and workload gates
-> PostgreSQL-native hybrid lexical and vector search after semantic-quality gates
-> external search projection only after measured isolation or scale requirements
```

Search is a query capability and a rebuildable optimization. It is never:

- the owner of a business invariant;
- authorization evidence;
- the canonical balance, stock position, journal, document lifecycle, or idempotency record;
- a mutation path into another domain;
- permission for an agent, workflow, or plugin to act.

### Domain-local search

A domain may search its owned data through its own typed query contract. It may use exact indexes,
structured SQL, PostgreSQL full-text search, or an approved ranked-search implementation without
exposing database or provider types publicly.

### Cross-domain search

A global or cross-domain search capability must not import private tables or repositories from
participating domains. It consumes published facts through public contracts or committed events and
maintains a tenant-scoped, rebuildable search projection.

The projection may be eventually consistent. Search results identify candidates; callers fetch the
current public DTO or invoke the owning domain before exposing sensitive details or performing a
business action.

### Lexical and semantic freshness

Lexical indexes over canonical domain-owned text may become visible with normal PostgreSQL
transaction visibility. Cross-domain projections and externally generated embeddings are
asynchronous and must expose or tolerate their freshness boundary.

Embedding generation must not extend a PostgreSQL transaction across a model-provider network call.
It runs as idempotent background work, records model and projection versions, and remains
rebuildable. A missing, stale, or hallucinated embedding cannot reject, authorize, or commit a
business transition.

### Provider boundary

Domain contracts must not expose:

```text
pg_textsearch operators or index names
pgvector or pgvectorscale types
Elasticsearch or OpenSearch request types
embedding provider identifiers or credentials
PostgreSQL shard, replica, pool, or search-node topology
```

Provider-specific query construction, extension checks, routing, and error translation stay inside
the owning implementation or infrastructure adapter. Do not add a generic provider abstraction
before a real second implementation or test seam requires one; the typed business query contract is
the stable boundary.

### PostgreSQL extension gate

No ranked or vector extension becomes a required dependency until it proves:

- PostgreSQL 19 compatibility at an exact pinned release;
- installation on supported self-hosted and intended managed deployment profiles;
- migration, startup probe, upgrade, rollback, backup, restore, and replication behavior;
- acceptable VACUUM, write amplification, index growth, and rebuild behavior;
- no conflict with required PostgreSQL extensions or preload configuration;
- safe tenant filtering and authorization behavior;
- bounded impact on OLTP latency, connections, CPU, I/O, and buffer cache;
- an exit path to built-in PostgreSQL search or another provider.

Unsupported extension DDL and index definitions use reviewed Drizzle custom migrations. Application
code continues to use repository-approved typed query construction; extension-specific raw SQL does
not enter domain packages.

### Workload isolation

Search may use a separately budgeted connection path, database role, statement timeout, concurrency
limit, or stale-tolerant read replica. These remain kernel and deployment concerns.

Multiple pools must share an explicit total connection budget. Search traffic must fail or degrade
without starving invariant-sensitive transactions. Read replicas may serve only queries whose
staleness contract permits replication lag.

### External search escalation

Elasticsearch, OpenSearch, or another external engine may be introduced only when measurements show
that PostgreSQL cannot provide acceptable search quality, isolation, throughput, index size, or
operational cost.

An external engine remains a rebuildable projection fed from committed facts. It does not replace
PostgreSQL authority, domain authorization, or owner-local commands.

## Alternatives Considered

### Adopt Elasticsearch or OpenSearch immediately

Rejected. It buys resource isolation and independent search scaling, but adds data duplication,
projection lag, another security and operations surface, and more failure modes before those
benefits are measured.

### Require `pg_textsearch` immediately

Rejected. Its model is promising, but the current documented PostgreSQL version range does not meet
the EclipseERP PostgreSQL 19 floor. Requiring `shared_preload_libraries` would also exclude
deployment profiles that cannot install it.

### Use vector search for every ERP record

Rejected. Exact identifiers, amounts, statuses, dates, and most operational filters are better
served by structured indexes. Embeddings add cost, privacy exposure, model drift, and eventual
freshness. They are justified only for demonstrated semantic-retrieval use cases.

### Let a global search service join all domain tables directly

Rejected. Physical access to one PostgreSQL cluster does not transfer semantic ownership or permit
private cross-domain imports.

### Standardize a generic search-provider interface now

Rejected. One speculative interface would add abstraction without a second implementation. Public
query contracts stay provider-neutral, and an adapter seam is introduced only when implementation
pressure proves it necessary.

## Consequences

### Positive

- Small deployments retain a one-database search path.
- Exact, relational, tenant, and ranked search can share PostgreSQL query semantics.
- Search technology can evolve without changing business commands or DTO authority.
- External search remains available when measured isolation or scale demands it.
- Agentic and semantic features cannot weaken ERP invariants.

### Negative

- Search initially competes with OLTP for PostgreSQL resources.
- Cross-domain projections and embeddings remain eventually consistent.
- PostgreSQL extension compatibility narrows available deployment profiles.
- Search quality, multilingual behavior, and workload isolation require dedicated testing.

### Risks

- Search queries could exhaust connections, CPU, I/O, or buffer cache.
- A stale projection could disclose data after authorization changes.
- Embedding providers could receive sensitive data without adequate policy.
- Provider-specific SQL could leak into domain packages.
- A PostgreSQL-first posture could be retained beyond its measured scaling limit.

## Validation

Before enabling PostgreSQL-native BM25, vector, hybrid, or external search in production, validate:

- representative ERP relevance datasets, including exact identifiers and multilingual text;
- tenant isolation and authorization revocation with zero unauthorized result disclosure;
- p50, p95, and p99 query latency under concurrent OLTP load;
- transaction latency, lock waits, connection pressure, CPU, I/O, and buffer-cache impact;
- projection and embedding freshness, backlog, replay, rebuild, and deletion behavior;
- crash recovery, backup/restore, replica promotion, extension upgrade, and rollback;
- provider disablement without loss of canonical business state;
- an explicit threshold for moving search to a replica or external projection.

A new ADR is required before making a specific non-core search product mandatory or before treating
an external search system as anything other than a rebuildable projection.
