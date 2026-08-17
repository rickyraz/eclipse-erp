# ADR-0011: Financial Ledger Execution Engine

- Status: Superseded
- Date: 2026-08-01
- Supersedes: None
- Superseded by: ADR-0040

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Product vision: [`../product/vision.md`](../product/vision.md)
> - Orthogonal design reference: [`../architecture/reference/orthogonal-erp-design.md`](../architecture/reference/orthogonal-erp-design.md)
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Transactional-truth ADR: [`./0003-postgresql-is-transactional-truth.md`](./0003-postgresql-is-transactional-truth.md)

## Context

EclipseERP needs a financial ledger capable of preserving accounting
correctness, immutable movements, auditability, and reliable balance invariants.
The storage or execution engine for that ledger is an infrastructure decision,
not an orthogonal domain primitive.

TigerBeetle is designed as a specialized financial OLTP database. Its official
architecture describes it as a data-plane/hot-path component that works
alongside a general-purpose database such as PostgreSQL, which remains suitable
for control-plane data and metadata:

- [TigerBeetle in Your System Architecture](https://docs.tigerbeetle.com/coding/system-architecture/)
- [TigerBeetle Data Modeling](https://docs.tigerbeetle.com/coding/data-modeling/)
- [TigerBeetle Transfer Reference](https://docs.tigerbeetle.com/reference/transfer/)

This creates two separate decisions:

```text
Ledger domain semantics
vs
Financial ledger storage and execution engine
```

The domain must not become coupled to a particular engine merely because the
engine is specialized.

## Decision

EclipseERP will initially use PostgreSQL as the authoritative financial ledger
store and transaction boundary, consistent with ADR-0003.

TigerBeetle is **not adopted initially**. It remains an evaluated alternative
for a future financial hot path when measured workload or correctness
requirements justify the operational cost of a second data system.

The ledger domain must remain expressible through an engine-independent port:

```text
Ledger semantics
    |
    v
LedgerPort
    |
    +--> PostgreSQL ledger adapter
    |
    +--> TigerBeetle ledger adapter (future, not adopted)
```

`LedgerPort` is a domain/application contract. PostgreSQL and TigerBeetle
clients, record layouts, integer codes, connection details, retries, and
reconciliation logic belong to adapters and infrastructure packages.

## Domain Boundary

The ledger domain owns concepts such as:

- accounts and account semantics;
- journal and posting semantics;
- reversals and corrections;
- accounting basis;
- posting policy;
- fiscal periods and dimensions;
- financial statements and reporting mappings.

A specialized ledger engine may own or enforce a narrower execution model such
as:

- account balances;
- debit and credit transfers;
- pending transfers;
- immutable financial movements;
- balance limits;
- strict ordering and double-entry invariants.

Those engine primitives do not automatically constitute the complete ERP
accounting domain. Metadata, policy, reporting, fiscal periods, and business
relationships remain EclipseERP-owned concepts.

## Evaluation Options

### PostgreSQL only

Use when:

- current ledger volume and contention are manageable;
- cross-domain transaction convenience is important;
- operational simplicity matters more than specialized hot-path throughput;
- the team does not yet have production evidence for a second database.

This is the initial choice.

### PostgreSQL plus TigerBeetle

Consider only when measurements demonstrate a need for a specialized financial
OLTP data plane, such as sustained transfer contention or ledger throughput
that materially limits the PostgreSQL design.

In that model:

```text
PostgreSQL control plane       TigerBeetle financial data plane
------------------------       -------------------------------
parties                        accounts
products                       transfers
invoices                       posted balances
contracts                      pending transfers
accounting metadata            balance constraints
policy and authorization       financial execution invariants
reporting mappings
```

The application must own authorization, metadata mapping, idempotency,
reconciliation, observability, and recovery semantics around the specialized
engine. TigerBeetle must never be exposed directly to untrusted callers.

## Adoption Gate

Do not adopt TigerBeetle until all of the following exist:

- measured ledger throughput or contention evidence;
- a reviewed `LedgerPort` contract;
- an idempotent submission and retry model;
- a PostgreSQL-to-engine reconciliation model;
- an outage and recovery procedure;
- audit and reporting semantics for both stores;
- an approved follow-up ADR that supersedes this initial decision where needed.

No dual-write is permitted before those guarantees and the follow-up decision
are in place.

## Consequences

- The current system remains simpler: PostgreSQL is the only authoritative
  financial store.
- Domain modules do not import TigerBeetle or PostgreSQL-specific ledger types.
- A future TigerBeetle evaluation can target the ledger hot path without forcing
  Sales, Inventory, Party, or Settlement modules to change their semantics.
- A second data system would add operational complexity, reconciliation work,
  failure modes, and deployment requirements; it is therefore not a default
  scalability feature.

## Validation

Before any TigerBeetle adoption, add tests for:

- transfer idempotency;
- duplicate submission;
- pending-transfer lifecycle;
- linked multi-transfer atomicity;
- reconciliation against PostgreSQL metadata;
- retry and outage recovery;
- auditability and report reproducibility.
