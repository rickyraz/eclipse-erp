# Search Architecture

> **Status:** Canonical
>
> **Owns:** Search authority, domain and cross-domain search boundaries, lexical and semantic
> retrieval posture, projection consistency, provider evolution, workload isolation, and search
> production gates.
>
> **Related documents**
>
> - Canonical architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - Messaging: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - External integrations: [`./integration-architecture.md`](./integration-architecture.md)
> - Deployment notes: [`../deployment/README.md`](../deployment/README.md)
> - Search ADR:
>   [`../decisions/0027-adopt-postgresql-first-replaceable-search.md`](../decisions/0027-adopt-postgresql-first-replaceable-search.md)

## Position

EclipseERP uses PostgreSQL-first search and preserves a measured path to replicas or external search
projections. Search improves discovery; it does not acquire business authority.

```text
canonical domain facts
        |
        +--> exact and structured owner-local queries
        |
        +--> lexical indexes over owned text
        |
        `--> committed events --> rebuildable cross-domain or semantic projection
```

The default implementation uses the smallest search mechanism that satisfies the workload. A search
cluster, vector pipeline, or ranked-search extension is not installed merely because it may be
useful later.

## Search Classes

### Exact and structured search

Use ordinary PostgreSQL indexes and typed predicates for:

- invoice, order, shipment, payment, journal, account, and document identifiers;
- SKU, barcode, tax identifier, external identifier, and reference code;
- tenant, legal entity, branch, warehouse, status, lifecycle, date, amount, and currency filters;
- uniqueness, existence, balance, stock, fiscal, or authorization-sensitive checks.

Exact and structured queries remain the default for operational ERP screens. Ranked search never
replaces an authoritative predicate.

### Lexical search

Use PostgreSQL full-text search or an approved BM25 implementation for natural-language fields such
as:

- product and service descriptions;
- party names and descriptive metadata;
- document titles and searchable body text;
- support tickets, notes, and knowledge articles.

Lexical search must preserve tenant scope, use bounded top-k queries, and expose a stable typed
result rather than provider scores or index identifiers as business meaning.

### Semantic search

Vector similarity is optional and justified only when users need conceptual retrieval that lexical
search cannot provide acceptably. Typical candidates include knowledge articles, support similarity,
product discovery, and document assistance.

Do not embed values merely because they are stored in ERP. Amounts, statuses, identifiers, balances,
stock quantities, permissions, and accounting facts remain structured data.

### Hybrid search

Hybrid search combines bounded lexical and vector candidate sets and fuses their rankings.
Reciprocal Rank Fusion is the initial acceptable technique because it combines ranks without
assuming lexical and vector scores share one scale.

The fusion algorithm is query behavior, not business policy. It may change without changing domain
facts, commands, or invariant ownership.

## Ownership Boundaries

### Domain-local search

An owning domain may implement search against its own tables and projections. It exposes the
behavior through a typed public query when another package or API requires it.

The implementation may use provider-specific indexes privately, but public DTOs and errors do not
expose Drizzle, PostgreSQL, extension, or external-engine types.

### Cross-domain search

A global search capability must not import another domain's tables, repositories, or implementation
modules.

```text
Owning domains
  -> committed public facts/events
  -> PgQue consumers
  -> tenant-scoped search projection
  -> global search query
  -> candidate references
  -> current owning-domain query before sensitive use
```

The projection owns only normalized searchable copies and provenance. It does not own the source
business facts.

A search document records enough information for replay and reconciliation:

```text
tenant scope
source domain and entity type
stable internal source identifier
public contract or event version
search document version
canonical source version or event position
locale or text configuration
projection timestamp
optional embedding model and chunking version
searchable content and permitted filters
```

## Authority and Authorization

Search results are untrusted candidate references.

- Search presence does not prove the source record still exists.
- Search rank does not authorize visibility or action.
- Search filters do not replace domain authorization.
- Search results do not establish current stock, balance, payment, journal, approval, or fiscal
  state.
- Plugins, workflows, and agents must invoke the owning public domain contract after discovery.

A domain-local query enforces current authorization directly. A cross-domain projection enforces
coarse tenant and visibility scope, then revalidates current access through the owning domain before
returning sensitive details or executing a command.

Authorization revocation and source deletion must produce projection updates. Delayed updates must
not create an unauthorized disclosure path; fail closed or return only a non-sensitive reference
until current authorization succeeds.

PostgreSQL RLS remains defense in depth. Search-specific RLS does not transfer authorization
ownership from domains.

## State and Freshness

Search data is classified as follows:

| Search state                                | Class                                      | Freshness                                  |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| PostgreSQL exact index over canonical table | Canonical access path, not a separate fact | Normal transaction visibility              |
| Lexical index over canonical owned text     | Rebuildable physical index                 | Normal transaction visibility after commit |
| Cross-domain search document                | Rebuildable projection                     | Eventual                                   |
| Embedding and vector index                  | Rebuildable projection                     | Eventual                                   |
| Search-result cache                         | Ephemeral or rebuildable                   | Explicitly bounded                         |

Embedding generation never runs as a required external call inside an invariant-sensitive
transaction. The canonical mutation commits first, then an idempotent job or committed event drives
embedding work.

Each embedding records its source version, model identifier, model revision where available,
dimensions, normalization, chunking policy, and creation time. A model change creates a new
projection version; it does not silently reinterpret existing embeddings.

A search result may expose projection freshness for diagnostics or user experience, but internal
event positions, provider topology, and credentials remain private.

## PostgreSQL-First Provider Progression

### Stage 1: built-in PostgreSQL

Start with:

- B-tree and other ordinary relational indexes;
- bounded prefix or trigram search when justified;
- built-in PostgreSQL text search;
- domain-owned structured filters;
- PostgreSQL reporting or search projections.

This stage requires no dedicated search service deployment.

### Stage 2: PostgreSQL-native BM25

`pg_textsearch` is an experimental candidate, not a required dependency. It may be evaluated only
after an exact release supports PostgreSQL 19 and passes the extension gates below.

The candidate must remain optional because it requires PostgreSQL extension installation and
`shared_preload_libraries`, which may not be available in every deployment profile.

### Stage 3: PostgreSQL-native vector or hybrid search

Use `pgvector`, `pgvectorscale`, or another approved provider only after PostgreSQL 19
compatibility, search-quality improvement, privacy review, and operational benefit are demonstrated.

Embedding generation runs through an EclipseERP-owned job and integration boundary. The database may
store embeddings, but domain writes do not depend on an embedding provider being available.

### Stage 4: replica or external search plane

Move stale-tolerant search to a PostgreSQL replica when it provides sufficient isolation. Move to
Elasticsearch, OpenSearch, or another external engine only when measured workload requires
independent search scaling, richer search features, or stronger resource isolation.

External search remains a rebuildable projection of committed PostgreSQL facts.

## PostgreSQL Extension Gates

Before enabling a search extension in production, prove:

### Compatibility

- exact extension release supports PostgreSQL 19;
- startup rejects an unsupported extension or required capability;
- required preload and configuration settings are documented;
- intended self-hosted and managed PostgreSQL profiles can install it;
- extension dependencies and licenses are reviewed.

### Schema and lifecycle

- extension and index DDL start from reviewed Drizzle custom migrations;
- every migration contains the required ownership, generator, review, and snapshot artifacts;
- index creation, rebuild, reindex, upgrade, rollback, backup, restore, and replica promotion pass;
- dropping or disabling the provider does not lose canonical facts.

### Workload safety

- top-k result limits are mandatory;
- query input length, filters, candidate counts, and timeouts are bounded;
- index build and maintenance do not starve OLTP;
- VACUUM, WAL, replica lag, write amplification, buffer-cache pressure, and disk growth are
  measured;
- extension locks, wait events, and failure modes are observable.

### Correctness and security

- tenant filters cannot be omitted accidentally;
- authorization revocation and deletion tests fail closed;
- provider scores do not become business rules;
- unsupported phrase, boolean, faceting, language, or tokenization behavior has an explicit
  fallback;
- malformed or adversarial queries cannot bypass decoding or exhaust unbounded resources.

## Workload Isolation

Search shares PostgreSQL resources until measurements justify another topology. Kernel and
deployment configuration may create logical workload classes such as:

```text
transaction
interactive read
search
background indexing
migration
```

Each class has an explicit connection budget. Search additionally uses:

- bounded concurrency;
- statement timeout;
- bounded top-k and candidate counts;
- query cancellation;
- slow-query and index-usage telemetry;
- optional stale-tolerant replica routing.

Separate pools do not create extra connection capacity automatically. Their limits must fit within
one reviewed PostgreSQL connection budget and preserve capacity for invariant-sensitive
transactions.

A replica search path documents maximum tolerated lag and routes read-after-write or authorization-
sensitive requests to an appropriate primary or owning service.

## Sharding and Topology

Search contracts never contain shard, replica, node, region, index, or provider topology.

- Domain-local search routes through the same kernel ownership and database-routing rules as other
  domain queries.
- Cross-shard global search uses a rebuildable projection or explicit fan-out strategy owned by the
  search implementation.
- Rebalancing a tenant or source record does not change its public identifier.
- `celld` entity routing is independent from search and PostgreSQL shard routing.
- Cache, search, analytics, and stateful-runtime layers may scale independently without receiving
  business authority.

## Privacy and External Models

Text and embeddings may contain personal, financial, commercial, legal, or jurisdiction-sensitive
data.

Before sending source content to an external embedding or reranking provider:

- classify permitted fields and tenants;
- define redaction and data-minimization policy;
- verify residency, retention, training-use, deletion, and subprocessors;
- keep credentials and provider failures inside the integration boundary;
- record model and provider provenance without exposing secrets;
- provide a local, disabled, or lexical-only fallback.

Agents may consume search results as context, but retrieved text and model output remain untrusted.
Every proposed business action still passes schema validation, authorization, domain policy,
idempotency, transaction, and database constraints.

## Cache Interaction

A cache may store bounded search results or normalized query plans, but it is never the only store
for an authorization decision, idempotency outcome, or source record.

Cache keys include tenant scope, query-contract version, normalized filters, locale, provider or
projection version, and authorization-relevant scope where safe. Authorization changes must not rely
only on cache expiration.

Search cache failure degrades performance or availability; it does not change canonical facts.

## Observability

Production search exposes:

- query count, latency, timeout, cancellation, and error rate by workload class;
- PostgreSQL connections, CPU, I/O, buffer-cache pressure, WAL, and replica lag;
- index size, build time, maintenance time, and scan usage;
- projection and embedding backlog, freshness, replay, and rebuild state;
- result quality against a reviewed relevance set;
- authorization denial and stale-candidate counts;
- provider cost and external-call failure rate where applicable.

Do not log raw sensitive queries, result bodies, embeddings, or provider credentials without an
approved data-handling policy.

## Production Adoption Gates

A new search stage advances only when the preceding stage has a measured limitation and the proposed
stage demonstrates:

- better task success or relevance on representative ERP queries;
- acceptable p50, p95, and p99 latency under concurrent OLTP load;
- bounded connection, CPU, I/O, memory, WAL, and storage impact;
- safe tenant and authorization behavior;
- tested rebuild, replay, backup, restore, upgrade, rollback, and provider exit;
- a deployment profile and operating runbook;
- no change to canonical ownership or invariant enforcement.

A specific external engine or mandatory PostgreSQL extension requires a new ADR.
