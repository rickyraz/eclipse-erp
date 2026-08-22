# State and Consistency Architecture

> **Status:** Canonical
>
> **Owns:** Canonical-versus-runtime state classification, versioning, idempotency, PostgreSQL
> commit rules, outbox publication, reconciliation, and cross-store failure handling.
>
> **Related documents**
>
> - Stateful runtime: [`./runtime-architecture.md`](./runtime-architecture.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - Analytics architecture: [`./analytics-architecture.md`](./analytics-architecture.md)
> - Workload isolation: [`./workload-isolation.md`](./workload-isolation.md)
> - Messaging and outbox: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Historical PostgreSQL truth ADR:
>   [`../decisions/0003-postgresql-is-transactional-truth.md`](../decisions/0003-postgresql-is-transactional-truth.md)
> - Stateful runtime ADR:
>   [`../decisions/0025-introduce-stateful-entity-runtime.md`](../decisions/0025-introduce-stateful-entity-runtime.md)
> - Financial ledger architecture: [`./financial-ledger.md`](./financial-ledger.md)
> - Financial ledger ADR:
>   [`../decisions/0040-adopt-tigerbeetle-financial-ledger.md`](../decisions/0040-adopt-tigerbeetle-financial-ledger.md)
> - Replica read-your-writes ADR:
>   [`../decisions/0039-select-postgresql-wait-for-for-replica-read-your-writes.md`](../decisions/0039-select-postgresql-wait-for-for-replica-read-your-writes.md)

## Rule

Durability, authority, and ownership are separate properties.

```text
Durable
-> survives process or node failure

Authoritative
-> decides the accepted business fact

Actively owned
-> has one current runtime serialization authority
```

A stateful runtime may durably store active state without becoming the canonical business authority.
PostgreSQL remains canonical unless a later ADR explicitly changes ownership. ADR-0040 changes the
financial-ledger scope: TigerBeetle is authoritative for accepted transfers, balances, and transfer
history in an activated profile; PostgreSQL remains authoritative for the surrounding control plane.

## State Classes

Every runtime field or snapshot belongs to one class.

### Canonical

PostgreSQL determines the business fact. Examples include inventory movements, legal entities,
invoices, payments, authorization grants, audit records, fiscal policy, and financial operation
metadata. In an activated TigerBeetle ledger profile, accepted transfers, balances, and transfer
history are canonical in TigerBeetle; PostgreSQL journal rows are projections and mappings.

Rules:

- success is not acknowledged before PostgreSQL commit;
- database constraints remain active;
- correction uses domain commands, reversal, or compensation;
- runtime state cannot overwrite a newer canonical version.

### Rebuildable

The runtime value is derived from authoritative facts and may be discarded. Examples include a hot
inventory-position projection, current workflow read model, cross-domain search document, embedding
projection, or analytical fact/metric projection. Financial projections use the separate authority
anchor defined by the financial-ledger architecture.

Rules:

- define the source facts and rebuild query or event sequence;
- record the last applied canonical version or event position;
- tolerate duplicate replay;
- expose rebuild duration and failures.

### Runtime-durable

The value is durable operational state used for execution continuity, while important business
transitions are also represented canonically. Examples may include an object-local timer intent,
active connection metadata, or bounded coordination checkpoint.

Rules:

- document why rebuild alone is insufficient;
- define the canonical anchor and reconciliation behavior;
- version the runtime schema;
- provide upgrade, rollback, and adapter-exit behavior.

### Ephemeral

The value is safe to lose, such as an in-memory memo, resident connection cache, bounded search-result
cache, or transient calculation.

Rules:

- do not use it to acknowledge a business transition;
- recreate it without mutation of canonical facts;
- do not call it durable in contracts or operations documentation.

## Read Consistency Classes

Every query route declares the weakest consistency class that safely satisfies its behavior:

```text
eventual or bounded-stale
-> an approved replica or projection may lag within the declared contract

read-your-writes
-> after the caller's accepted command, the next query observes at least that commit

authoritative-current
-> current owner-controlled state is required through the approved authoritative path

transactional
-> the read participates in command invariant evaluation or the canonical transaction
```

Replica read-your-writes guarantees only:

```text
replica_position >= required_position
```

It does not prove that the replica equals the primary's newest state or includes commits after the
required position.

ADR-0039 selects PostgreSQL 19 `WAIT FOR` as the deferred mechanism for route-scoped replica
read-your-writes. Application and transport infrastructure may carry an opaque `ConsistencyToken`,
but raw PostgreSQL WAL positions, timelines, cluster identifiers, and routing topology must not
enter domain DTOs, capability IDs, domain events, entity addresses, or Process IR. The token grants
no authorization, ownership, durability, or workload priority.

Production activation remains gated on PostgreSQL 19 GA, a concrete route requirement, bounded wait
and failure semantics, placement and timeline validation, current authorization, no-primary-
fallback enforcement, and executable load and failover proof. Before activation, required
read-after-write behavior stays on the authoritative path.

## Command Identity

Every command that may be retried or whose response may be lost has a stable `commandId` or
idempotency key assigned at the trust boundary.

The idempotency scope must include enough identity to prevent collision:

```text
tenantId
+ owning capability
+ entity address or aggregate ID
+ commandId
```

The owning domain stores the canonical idempotency outcome when repeating the command could
duplicate stock, money, document, authorization, or external side effects. A bounded runtime cache
may accelerate duplicate responses but must not be the only protection for a critical command.

A repeated command returns the prior compatible result or a stable conflict. It must not execute the
canonical mutation twice.

## Aggregate Version

Invariant-sensitive canonical aggregates use a monotonic version, domain sequence, or equivalent
expected-state predicate where stale ownership could otherwise commit an invalid transition. The
following `runtimeVersion` rules apply to PostgreSQL-owned aggregates and projections.

Healthy state:

```text
runtimeVersion == canonicalVersion
```

Catch-up state:

```text
runtimeVersion < canonicalVersion
```

Invalid state:

```text
runtimeVersion > canonicalVersion
```

A runtime version ahead of PostgreSQL must not be accepted as business truth for a PostgreSQL-owned
aggregate. It indicates an uncommitted projection transition, corrupted state, incompatible restore,
or protocol defect and requires rollback, rebuild, or manual recovery.

For a TigerBeetle-backed financial projection, the canonical comparison is the financial
reconciliation anchor defined by [`financial-ledger.md`](./financial-ledger.md). A PostgreSQL
projection checkpoint is not financial authority; ahead/behind detection compares the projection's
verified operation set, mapping version, and scan/checkpoint boundary with the TigerBeetle anchor.

Versions and anchors are scoped to one aggregate, ledger, or projection stream. They are not a global
transaction clock.

## Canonical Command Protocol

The default protocol for a canonical PostgreSQL mutation is:

```text
1. authenticate and decode command
2. authorize capability and tenant scope
3. route to entity owner when runtime ownership is enabled
4. load or reconcile canonical version N
5. check command idempotency
6. evaluate transition from version N
7. begin PostgreSQL transaction
8. persist domain mutation with expected version N
9. persist idempotency result
10. append domain event or outbox record in the same transaction
11. commit PostgreSQL as version N + 1
12. advance or invalidate runtime projection
13. return typed result
```

Steps 8–10 are atomic. A canonical success response requires step 11. A TigerBeetle-backed
financial mutation uses the separate protocol in [`financial-ledger.md`](./financial-ledger.md):
PostgreSQL persists intent, TigerBeetle accepts or rejects the deterministic operation, and
PostgreSQL records the outcome and rebuildable projection. The two stores are not one ACID
transaction.

The runtime may validate against active state before opening the transaction, but PostgreSQL must
reject a stale expected version or violated constraint. One active owner reduces expected conflicts;
it does not remove the final guard.

## Transactional Events and Outbox

A committed domain fact and its internal event are published in the same PostgreSQL transaction
according to [`pgque-messaging.md`](./pgque-messaging.md).

When delivery leaves PostgreSQL or has an independent provider lifecycle, write a transactional
outbox record with the canonical mutation. The delivery worker owns retry and provider status.

Forbidden:

```text
commit cell state
+
independently commit PostgreSQL
+
independently publish external message
```

without idempotency, durable status, and reconciliation. That is an unsafe multi-system write.

## Runtime Projection Update

After PostgreSQL commit, the owner may:

- apply the committed result to its projection;
- consume the committed domain event;
- reload the canonical aggregate;
- mark itself stale and rebuild before the next command.

The response may be lost after commit. Retrying with the same command ID must recover the committed
result rather than repeat the mutation.

If the runtime projection update fails after commit, canonical state remains valid. The entity
becomes stale and must reconcile before evaluating another invariant-sensitive command.

## Reconciliation

Reconciliation compares runtime state with a canonical anchor such as:

- aggregate version;
- domain sequence;
- committed event cursor;
- checkpoint version plus subsequent events;
- deterministic canonical query result.

The entity category declares one strategy:

```text
reload
-> replace runtime projection from one canonical query

replay
-> apply committed events after the last known version

rebuild
-> recompute from canonical facts and an optional checkpoint

fail closed
-> reject commands and require operator recovery
```

Reconciliation must be idempotent. It must never issue a business mutation merely to make runtime
state look current.

Background reconciliation may detect drift, but an invariant-sensitive command must not proceed from
known-stale state while waiting for background repair.

## Failure Matrix

The following matrix applies to PostgreSQL-owned canonical mutations. TigerBeetle-backed financial
operations use the separate failure and publication matrix in
[`financial-ledger.md`](./financial-ledger.md); a PostgreSQL receipt failure after TigerBeetle
acceptance means no caller-visible success, not that the accepted TigerBeetle fact disappeared.

| Failure point                                           | Canonical result                        | Required behavior                                                     |
| ------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| Owner dies before PostgreSQL transaction                | No mutation                             | New owner restores/rebuilds; retry same command ID                    |
| Owner dies during PostgreSQL transaction before commit  | Transaction rolls back                  | Retry safely; no event or idempotency success exists                  |
| PostgreSQL commit fails                                 | No canonical success                    | Runtime must not advance authoritative version                        |
| PostgreSQL commits; owner dies before projection update | Canonical version advanced              | New owner reads idempotency result and catches up                     |
| PostgreSQL commits; response is lost                    | Canonical version advanced              | Duplicate command returns prior result                                |
| Runtime snapshot is behind PostgreSQL                   | Canonical state newer                   | Replay, reload, or rebuild before next sensitive command              |
| Runtime snapshot appears ahead of PostgreSQL            | Runtime state invalid                   | Fence, discard/rebuild, alert, and fail closed if unexplained         |
| Stale owner receives a command                          | Ownership invalid                       | Fence before canonical write; expected-version guard remains          |
| Ownership moves during queued commands                  | One owner transition                    | Old owner stops admission; commands retry or route to new owner       |
| Runtime store unavailable                               | Canonical database may remain available | Use approved fallback or fail closed by category; do not invent state |
| PostgreSQL unavailable                                  | Canonical mutation unavailable          | Reject or retry; runtime-local success is forbidden                   |
| Resource admission denied before protected work         | No mutation                             | Return typed overload failure; do not acquire the guarded connection  |
| Projection query path unavailable or over capacity      | Canonical facts unchanged               | Return declared stale/error behavior; no hidden primary fallback      |
| Outbox delivery fails after commit                      | Canonical fact remains committed        | Retry from durable outbox; expose lag and provider state              |
| Duplicate event delivery                                | Canonical fact unchanged                | Consumer deduplicates or applies idempotently                         |
| Runtime schema upgrade fails                            | Canonical facts remain valid            | Roll back adapter deployment or rebuild compatible state              |
| Reconciliation cannot determine truth                   | Canonical state protected               | Quarantine entity and require explicit manual recovery                |

## Timers and Alarms

An entity-local alarm represents timer intent, not guaranteed completion of the business action.

For important timers:

- persist the timer's business identity and due time canonically or as approved runtime-durable
  state with a canonical anchor;
- make the alarm handler idempotent;
- re-check current domain state and authorization context where required;
- record the resulting command through the normal canonical protocol;
- recover missed or duplicate alarm delivery.

Alarms do not replace the job table or durable workflow engine. External delivery, operator retry,
dead-letter behavior, and multi-step progress retain their existing owners.

## Multi-Entity Operations

A local entity transaction is never presented as atomic across other entity addresses or domains.

Use:

- an explicit PostgreSQL transaction when all synchronous owners support the repository transaction
  context and no external financial authority is involved;
- the financial-ledger protocol for TigerBeetle-backed transfers;
- a durable process with idempotent steps and compensation;
- a committed event for fan-out;
- manual recovery for unknown outcomes with no safe compensation.

Do not hold an entity's serialization lock across an unbounded external call or durable workflow
wait.

## Accounting and Legally Significant State

Accounting policy, fiscal periods, authorization, journal meaning, and audit metadata remain owned
by Accounting and PostgreSQL. For an activated TigerBeetle profile, accepted transfers, balances,
and immutable transfer history are canonical in TigerBeetle; PostgreSQL journal and reporting rows
are projections with deterministic provenance. Runtime coordination may manage submission,
reconciliation sessions, approvals, or hot read models, but it cannot become a second financial
authority.

The same conservative rule applies to payments, tax submissions, legal documents, and other facts
whose authority or audit history cannot be inferred from a runtime owner. A future financial
capability must explicitly choose its authority and cross-store protocol before activation.

## Schema Evolution

Each runtime-durable or rebuildable snapshot declares:

```text
entityType
addressVersion
snapshotSchemaVersion
canonicalVersion
createdAt
adapterVersion
```

Upgrade rules:

- prefer rebuilding over complex permanent runtime migrations;
- never overwrite the only compatible snapshot before successful validation;
- support deployment rollback or explicit forward-only migration;
- test mixed-version ownership during rolling deployment;
- reject an unknown snapshot schema loudly;
- keep canonical PostgreSQL migrations independent of adapter-local schemas.

## Verification Requirements

A production-enabled category requires executable proof for:

- duplicate command and lost-response handling;
- expected-version conflict;
- owner loss before and after PostgreSQL commit;
- stale-owner fencing;
- projection rebuild and replay, including owner-approved snapshot plus replay when events alone are incomplete;
- runtime-ahead detection;
- outbox retry and duplicate delivery;
- schema upgrade and rollback;
- runtime disablement and adapter exit;
- tenant and authorization boundaries;
- reconciliation alerts and manual recovery.
