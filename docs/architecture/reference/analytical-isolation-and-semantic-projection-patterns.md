# Analytical Isolation and Semantic Projection Patterns for RITSEI

> **Status:** Reference
>
> **Owns:** Comparative background for operational analytics, metric platforms, real-time OLAP,
> workload isolation, historical table formats, embedded analytical execution, and their possible
> application to RITSEI.
>
> **Must not own:** Binding RITSEI analytic authority, contracts, workload classes, provider
> selection, deployment topology, or production gates.
>
> **Related documents**
>
> - Analytics architecture: [`../analytics-architecture.md`](../analytics-architecture.md)
> - Canonical architecture: [`../architecture-spec-v4.md`](../architecture-spec-v4.md)
> - Workload isolation: [`../workload-isolation.md`](../workload-isolation.md)
> - State and consistency: [`../state-and-consistency.md`](../state-and-consistency.md)
> - Hard-isolation reference: [`./hard-isolation-patterns.md`](./hard-isolation-patterns.md)
> - Analytic Plane ADR:
>   [`../../decisions/0043-adopt-rebuildable-analytic-plane.md`](../../decisions/0043-adopt-rebuildable-analytic-plane.md)

## Purpose and Method

This document tests the proposed RITSEI Analytic Plane against primary documentation and engineering
accounts from Odoo, SAP, Airbnb, Uber, LinkedIn, Google Cloud, Meta, ClickHouse, Apache Iceberg, and
DuckDB.

The test separates three questions:

1. Is the pattern used successfully elsewhere?
2. What limitation or qualification does the source expose?
3. What may RITSEI adopt without transferring business authority to an analytics product?

The sources were reviewed on **2026-08-22**. Product behavior may change; the canonical RITSEI rules
remain in [`../analytics-architecture.md`](../analytics-architecture.md).

## Result

The central proposal is sound with four corrections:

- analytics is a logical subsystem over existing `query` and `async` workload classes, not a fourth
  class;
- domains own Business Fact Contracts, while analytics owns derived metrics and projections;
- a provider router must consider semantic version, completeness, authorization, and consistency in
  addition to freshness;
- PostgreSQL, ClickHouse or Pinot, Iceberg, and DuckDB are optional tools with separate activation
  reasons, not a mandatory product ladder.

The strongest externally supported composition is:

```text
domain-owned facts
-> governed metric definitions
-> provider-independent query intent
-> dedicated analytical execution
-> explicit freshness and failure behavior
```

The most RITSEI-specific invariant remains:

> A hard-isolated analytical route has no credential, pool, executor, or fallback path to the
> command reserve.

## Operational ERP Baselines

### Odoo dashboards: operational data stays close to the application database

Odoo 19 documentation describes dashboards as showing real-time data from the Odoo database. The
spreadsheet data source connects directly to underlying Odoo data and refreshes when the dashboard
or spreadsheet is opened or refreshed.

Primary references:

- [Odoo 19 Dashboards](https://www.odoo.com/documentation/19.0/applications/productivity/dashboards.html)
- [Odoo 19: Insert and link to Odoo data](https://www.odoo.com/documentation/19.0/applications/productivity/spreadsheet/insert.html)

Useful lesson:

- direct operational drill-down is convenient and current;
- the public documentation does not establish a separate analytical failure or resource boundary.

RITSEI adaptation:

- keep bounded owner-local operational queries available;
- do not make direct application-database aggregation the default for projection-safe dashboards;
- use a declared authoritative route when current source records are genuinely required.

### SAP S/4HANA and Datasphere: current operational analytics plus rich analytical semantics

SAP S/4HANA documentation states that embedded analytics operates on current data and that its tools
consume CDS views in the Virtual Data Model. SAP Datasphere separately models facts, dimensions,
texts, hierarchies, measures, associations, and analytic models. Its replication and transformation
flows support initial and delta movement and object-store targets.

Primary references:

- [SAP S/4HANA Analytics](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/6b356c79dea443c4bbeeaf0865e04207/dd28bf545e91ee05e10000000a4450e5.html)
- [SAP S/4HANA Embedded Analytics](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/6b356c79dea443c4bbeeaf0865e04207/c53deb5765c7be12e10000000a4450e5.html)
- [SAP Datasphere: Modeling Data in the Data Builder](https://help.sap.com/docs/SAP_DATASPHERE/c8a54ee704e94e15926551293243fd1d/5c1e3d4a49554fcd8fcf199d664d1109.html)
- [SAP Datasphere: Use Replication Flows and Transformation Flows](https://help.sap.com/docs/SAP_DATASPHERE/c8a54ee704e94e15926551293243fd1d/34ae0a2ea6e94483b19f632a2843d56d.html)
- [SAP Datasphere: Configure Replication Flow Run Settings](https://help.sap.com/docs/SAP_DATASPHERE/c8a54ee704e94e15926551293243fd1d/3f5ba0c5ae3944c1b7279bb989a2a5b5.html)

Useful lesson:

- fact, dimension, hierarchy, measure, and analytic-model semantics are mature and useful;
- current operational analytics and replicated analytical modeling are distinct needs.

RITSEI adaptation:

- adopt explicit grain, measures, dimensions, hierarchy, associations, and valid aggregation;
- keep those definitions close to source-domain contracts and version control;
- avoid coupling semantic identity to SAP, HANA, ClickHouse, or another provider.

## Metric and Semantic Platforms

### Airbnb Minerva: define metrics once and abstract where and how

Airbnb describes Minerva as a metric platform that accepts fact and dimension inputs, centralizes
metric definitions, versions dataset definitions, supports validation and backfill, and exposes a
unified API. The Minerva API lets consumers request metrics and dimensional cuts without knowing
which physical dataset to query or how each metric is aggregated.

Primary references:

- [How Airbnb achieved metric consistency at scale](https://medium.com/airbnb-engineering/how-airbnb-achieved-metric-consistency-at-scale-f23cc53dea70)
- [How Airbnb standardized metric computation at scale](https://medium.com/airbnb-engineering/airbnb-metric-computation-with-minerva-part-2-9afe6695b486)
- [How Airbnb enables consistent data consumption at scale](https://medium.com/airbnb-engineering/how-airbnb-enables-consistent-data-consumption-at-scale-1c0b6a8b9206)

Useful lesson:

```text
metric + dimensions
-> metadata and completeness planning
-> provider query
-> consistent consumer result
```

Minerva also exposes important complexity that a simple metric DSL can hide:

- additive and non-additive metrics need different execution;
- not every metric-dimension combination is valid;
- data completeness and time coverage affect source selection;
- semantic changes require backfill and version management.

RITSEI adaptation:

- make grain, cardinality, aggregation class, completeness, and time coverage first-class;
- require a provider-independent typed query contract;
- do not promise provider interchangeability without golden-data conformance.

### Uber uMetric: one business logic, multiple physical sources

Uber describes uMetric as a unified metric platform covering definition, discovery, planning,
computation, quality, consumption, and access control. Its definition model separates a unified view
of source data from metric logic and runtime dimensions/filters. The article explicitly discusses
the same logical metric existing in different storage systems for different freshness and latency
needs.

Primary reference:

- [Uber: The Journey Towards Metric Standardization](https://www.uber.com/us/en/blog/umetric/)

Useful lesson:

- metric identity should not multiply by storage provider;
- source freshness, completeness, duplication, quality, and access control are part of metric trust;
- domain experts still govern high-impact metric definitions.

RITSEI adaptation:

- one metric version may have several physical projection instances;
- the router must verify semantic and quality eligibility, not only choose the fastest engine;
- source-domain owners remain mandatory reviewers for business-critical facts.

### LinkedIn Unified Metrics Platform: shared specification and lifecycle

LinkedIn describes UMP as a specification and toolset for creating consistent metrics that can feed
experimentation, reporting, and ad-hoc analysis. It was created to replace fragmented calculations
of the same metric.

Primary references:

- [LinkedIn Unified Metrics Platform](https://engineering.linkedin.com/teams/data/analytics-platform-apps/analytics-platforms/ump)
- [From the Economic Graph to Economic Insights](https://www.linkedin.com/blog/engineering/economic-graph/from-the-economic-graph-to-economic-insights-building-the-infra)

Useful lesson:

- a metric contract and shared workflow can serve multiple consumers and execution engines;
- quality assertions are part of publishing a trusted metric.

RITSEI adaptation:

- dashboards, reports, APIs, experimentation, and AI may consume the same reviewed metric contract;
- the semantic contract remains distinct from the provider used to compute or serve it.

## OLTP and Real-Time OLAP Isolation

### Uber Orders Near You: explicit OLTP/OLAP separation

Uber's Orders Near You architecture moved analytical geospatial serving to Apache Pinot. Uber calls
the separation of operational OLTP from online OLAP the most important architectural insight and
connects it to isolation, reliability, query performance, and fresh data.

Primary reference:

- [Uber: Orders Near You and User-Facing Analytics on Real-Time Geospatial Data](https://www.uber.com/us/en/blog/orders-near-you/)

Useful lesson:

```text
operational store
-> modification events
-> analytical store
-> user-facing analytics
```

RITSEI adaptation:

- source facts commit through their approved authority first;
- analytical load reaches a dedicated projection path;
- projection failure does not redirect the workload back to the command primary.

### LinkedIn Pinot: a dedicated low-latency analytical representation

LinkedIn describes Pinot as its de-facto near-real-time analytics service for site-facing products
and internal dashboards. Pinot supports batch sources and real-time streams and was built for
high-throughput, low-latency analytical queries.

Primary references:

- [LinkedIn: Pinot Joins Apache Incubator](https://www.linkedin.com/blog/engineering/open-source/pinot-joins-apache-incubator)
- [LinkedIn: Introducing Apache Pinot 0.3.0](https://www.linkedin.com/blog/engineering/open-source/apache-pinot-030-update)
- [LinkedIn: Privacy Preserving Single Post Analytics](https://www.linkedin.com/blog/engineering/trust-and-safety/privacy-preserving-single-post-analytics)

Useful lesson:

- analytical representation may combine stream and batch data;
- user-facing analytics needs provider-specific capacity and privacy design;
- the OLAP store remains downstream of source events and computation.

RITSEI adaptation:

- ClickHouse, Pinot, or another engine is a replaceable projection provider;
- privacy, tenant scope, correction, and full rebuild cannot be delegated to the engine by default.

### Isolation remains necessary inside the analytical plane

Uber's Pinot platform uses tenant resource grouping for isolation and later reports that many
offline analytics use cases request dedicated resources to avoid noisy neighbors.

Primary references:

- [Uber: Operating Apache Pinot at Uber Scale](https://www.uber.com/us/en/blog/operating-apache-pinot/)
- [Uber: Pinot for Low-Latency Offline Table Analytics](https://www.uber.com/en-CH/blog/pinot-for-low-latency/)

RITSEI adaptation:

```text
Analytic Plane
  +--> interactive dashboards
  +--> scheduled reporting
  +--> historical/ad-hoc queries
  `--> export and ML extraction
```

Those categories may receive separate budgets after measured need. They remain `query` or `async`
subcategories and never borrow command capacity.

## Resource and Compute Isolation

### BigQuery: storage/compute separation and reservations

Google documents BigQuery as separating storage and compute. BigQuery reservations allocate slot
pools to workloads, teams, or departments; the documentation gives production and test reservations
as an example so test jobs do not compete with production jobs.

Primary references:

- [Google Cloud: Separation of storage and compute in BigQuery](https://cloud.google.com/blog/products/bigquery/separation-of-storage-and-compute-in-bigquery)
- [BigQuery overview](https://docs.cloud.google.com/bigquery/docs/introduction)
- [BigQuery: Understand reservations](https://docs.cloud.google.com/bigquery/docs/reservations-workload-management)

Useful lesson:

- independent scaling and explicit capacity pools reduce resource coupling;
- shared infrastructure still needs workload assignment and capacity policy.

RITSEI adaptation:

- analytical storage and execution may scale independently;
- interactive and batch analytical work may receive separate bounded resource budgets;
- provider reservations supplement, but do not replace, RITSEI ingress, tenant, authorization, and
  command-reserve boundaries.

## Operational-to-Analytical Ingestion and Migration Proof

### Meta: incremental ingestion plus shadow validation

On **May 12, 2026**, Meta described incrementally ingesting MySQL social-graph data into its data
warehouse for analytics, reporting, ML, and downstream products. Its migration used shadow and
reverse-shadow phases, row-count and checksum comparison, latency checks, and resource-regression
checks before completing the cutover.

Primary reference:

- [Meta: Migrating Data Ingestion Systems at Meta Scale](https://engineering.fb.com/2026/05/12/data-infrastructure/migrating-data-ingestion-systems-at-meta-scale/)

Useful lesson:

- a new projection or ingestion path should be compared against a known path before cutover;
- correctness, landing latency, and resource use are separate acceptance criteria;
- rollback needs to stop bad derived data from propagating.

RITSEI adaptation:

- provider activation uses shadow projections and deterministic comparison;
- mismatched partitions or fact ranges are quarantined;
- a provider does not become eligible merely because ingestion is running.

### Meta Scuba: dedicated real-time analytical serving

Meta's Systems at Scale recap describes Scuba as a platform for real-time ingestion, processing,
storage, and querying of structured logs, with data available for query in under a minute and a
fan-out architecture for low-latency results.

Primary reference:

- [Meta: Systems at Scale 2019 recap](https://engineering.fb.com/2019/10/15/core-infra/systems-scale-2019/)

RITSEI adaptation:

- real-time analytical serving is a distinct workload with explicit ingest-to-query latency;
- the source supports the need for a dedicated plane, not a universal choice of Scuba-like topology.

## Candidate Provider Properties

### ClickHouse: useful acceleration, not the semantic owner

ClickHouse documents continuous ingestion, high-concurrency analytical serving, and incremental
materialized views that process newly inserted blocks. Its own guidance also warns that incremental
views do not automatically observe source mutations, partition drops, or merges.

Primary references:

- [ClickHouse: Real-time analytics](https://clickhouse.com/use-cases/real-time-analytics)
- [ClickHouse: Explore GitHub with incremental materialized views](https://clickhouse.com/demos/explore-github-with-clickhouse-powered-real-time-analytics)
- [ClickHouse: Common getting-started issues](https://clickhouse.com/blog/common-getting-started-issues-with-clickhouse)

Useful lesson:

- insert-time aggregation can accelerate repeated dashboard queries;
- corrections, backfills, and target rebuilds require explicit design;
- engine behavior cannot define ERP cancellation, reversal, or financial semantics.

RITSEI conclusion:

> RITSEI owns fact and metric semantics; ClickHouse may own one projection's execution.

### Apache Iceberg: historical snapshots and multi-engine tables

Apache Iceberg documents atomic snapshot commits, serializable isolation, consistent snapshot reads,
version history, rollback, late-data operations, and regular snapshot maintenance.

Primary references:

- [Apache Iceberg: Reliability](https://iceberg.apache.org/docs/latest/reliability/)
- [Apache Iceberg: Maintenance](https://iceberg.apache.org/docs/latest/maintenance/)
- [Apache Iceberg specification](https://iceberg.apache.org/spec/)

Useful lesson:

- an open table format can support historical snapshots and multiple engines;
- snapshot retention, compaction, orphan cleanup, catalogs, and object-store operations add an
  operational system of their own.

RITSEI adaptation:

- Iceberg is justified by retention, interchange, snapshot, or multi-engine requirements;
- it is not required simply because ClickHouse is present;
- an Iceberg table remains a derived projection unless a later authority decision says otherwise.

### DuckDB: bounded execution over Parquet and Iceberg

DuckDB documents direct Parquet queries with projection and filter pushdown. Its Iceberg extension
can read tables from object storage and, with a catalog, supports writes subject to documented
limitations and extension lifecycle.

Primary references:

- [DuckDB: Reading and Writing Parquet Files](https://duckdb.org/docs/stable/data/parquet/overview)
- [DuckDB: Iceberg Extension](https://duckdb.org/docs/stable/core_extensions/iceberg/overview)
- [DuckDB: Writing to Iceberg](https://duckdb.org/docs/current/core_extensions/iceberg/writing_to_iceberg)

Useful lesson:

- an embedded engine can execute bounded file or table queries without a separate serving cluster;
- embedded execution still consumes host CPU, memory, disk, network, and extension privileges.

RITSEI adaptation:

- use DuckDB for bounded workers, exports, development, or isolated historical execution when it is
  the smallest sufficient tool;
- do not embed it in a command process and call the workload isolated merely because it lacks a
  PostgreSQL credential.

## Stress-Test Matrix

| Proposed idea                                         | Verdict                   | Required correction                                                            |
| ----------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| Business facts and metric semantics belong to RITSEI  | Accept                    | Domains own facts; analytics owns derived metric contracts                     |
| Dashboard asks for metrics instead of tables          | Accept                    | Typed allowlisted query intent, not arbitrary SQL                              |
| Storage is an implementation detail                   | Accept as target          | Cross-engine equivalence must be tested, not assumed                           |
| Route by freshness                                    | Accept with qualification | Also require semantic version, completeness, authorization, and consistency    |
| `LIVE < 1s`, `NEAR_REALTIME < 30s` globally           | Reject as universal rule  | Use explicit route-specific maximum staleness and `dataAsOf`                   |
| Event stream is always the rebuild source             | Reject                    | Allow owner snapshot/export plus subsequent replay                             |
| ClickHouse failure falls back to PostgreSQL primary   | Reject                    | Serve declared stale data or typed unavailability only                         |
| Read replica is the OLAP architecture                 | Reject as general model   | It may be a bounded projection provider, but does not change the data model    |
| ClickHouse is the default medium tier                 | Defer                     | Require measured concurrency, latency, cardinality, or isolation need          |
| Iceberg is the default cold tier                      | Defer                     | Require retention, open-table, snapshot, or multi-engine need                  |
| DuckDB follows Iceberg automatically                  | Reject                    | DuckDB is an execution option with separate resource gates                     |
| Same metric works from small to enterprise            | Accept as contract goal   | Prove provider conformance and preserve versioned semantics                    |
| Non-interference should be recursive inside analytics | Accept after measurement  | Partition interactive, report, historical, and export budgets only when needed |

## Combined RITSEI Reference Model

```text
                     SOURCE DOMAIN AUTHORITY
                              |
                    versioned business facts
                              |
               +--------------+--------------+
               |                             |
               v                             v
       rebuild snapshot/export       committed event/outbox
               |                             |
               +--------------+--------------+
                              |
                              v
                    PROJECTION FABRIC
          identity + versions + lineage + correction
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
     PostgreSQL projection             optional provider
                                               |
                                  +------------+-----------+
                                  |                        |
                                  v                        v
                           interactive OLAP       historical tables
                              |
                              v
                    SEMANTIC QUERY GATEWAY
      metric + dimensions + time + scope + maximum staleness
                              |
                              v
                  Dashboard / BI / API / AI

       query and async resources -X-> protected command reserve
```

## Non-Decisions

This comparison does not select:

- ClickHouse over Pinot or another OLAP engine;
- Iceberg over another table format;
- DuckDB as a production service;
- Kafka or another external broker;
- a metric DSL, compiler, package, API, or UI;
- a universal latency tier;
- a complete financial warehouse;
- an events-only rebuild strategy.

Those choices require concrete workload and readiness evidence.

## Conclusion

No individual component is novel: fact models, metric platforms, OLAP engines, object-store tables,
workload reservations, and incremental ingestion all have strong industrial precedent.

The useful RITSEI composition is narrower:

```text
domain-owned business facts
+ versioned semantic metrics
+ rebuildable provider-independent projections
+ explicit freshness
+ hard no-primary-fallback
+ executable non-interference proof
```

That composition keeps analytical richness without allowing a dashboard, warehouse, or OLAP product
to become the ERP's hidden domain model or a failure path back into canonical commands.
