# Avoiding Accidental Duplication in Process and Messaging

> **Status:** Reference
>
> This document explains the boundary between Process-owned work and Messaging-owned event delivery.
> It does not create or supersede an architectural decision. Binding rules remain in the related
> ADRs and canonical architecture documents below.
>
> **Related documents**
>
> - Messaging and event delivery: [`../pgque-messaging.md`](../pgque-messaging.md)
> - Durable execution: [`../durable-execution.md`](../durable-execution.md)
> - Separate events, jobs, and workflows:
>   [`../../decisions/0004-separate-events-jobs-and-workflows.md`](../../decisions/0004-separate-events-jobs-and-workflows.md)
> - Order lifecycle and PgQue activation gate:
>   [`../../decisions/0033-extend-order-lifecycle-and-gate-pgque.md`](../../decisions/0033-extend-order-lifecycle-and-gate-pgque.md)
> - Messaging ownership:
>   [`../../decisions/0038-move-internal-event-delivery-to-messaging.md`](../../decisions/0038-move-internal-event-delivery-to-messaging.md)
> - Stateful runtime: [`../runtime-architecture.md`](../runtime-architecture.md)
> - Experimental `celld` adapter:
>   [`../../decisions/0026-evaluate-celld-runtime-adapter.md`](../../decisions/0026-evaluate-celld-runtime-adapter.md)
> - Engineering lineage: [`./engineering-lineage.md`](./engineering-lineage.md)

## Purpose

`process.jobs` and PgQue can both contain durable, retryable work without being accidental
duplicates. They answer different questions and have different owners:

```text
workflow_runs
    What is the state of the business process?

process.jobs
    What internal work must one Process worker execute?

messaging.event_outbox
    Which committed fact is ready for durable publication?

PgQue
    How is that committed fact fanned out to consumers?
```

The presence of more than one durable row is not, by itself, duplication. Duplication occurs when
two components claim the same semantic responsibility, become competing sources of truth, or
independently execute the same business command.

## Ownership model

Ownership means **semantic authority**, not merely the process that happens to execute code. Keep
three questions separate:

1. **Who defines the meaning and invariant?**
2. **Which durable state is the source of truth?**
3. **Which worker or adapter is allowed to execute or deliver it?**

The current ownership split is:

| Artifact or concern                           | Semantic owner                                          | Durable/source-of-truth owner                    | Executor or adapter                         | Must not own                               |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| Order state and order facts                   | Sales                                                   | Sales PostgreSQL tables                          | Sales service                               | Process, PgQue, `celld`                    |
| Stock, reservations, and movements            | Inventory                                               | Inventory PostgreSQL tables                      | Inventory service                           | Process, PgQue, `celld`                    |
| Journals and revenue policy                   | Accounting                                              | Accounting PostgreSQL tables                     | Accounting service                          | Process, PgQue, `celld`                    |
| Workflow progression and result               | Process                                                 | `process.workflow_runs`                          | Process service / approved workflow runtime | PgQue, `celld` SQLite                      |
| Internal leased work                          | Process                                                 | `process.jobs`                                   | Process worker                              | PgQue as a second executor                 |
| Job channels, retry policy, and execution DAG | Process                                                 | Process job definitions and relational edges     | Process scheduler/worker                    | Callers, event consumers, `celld`          |
| Event meaning and payload contract            | Publishing domain; Process for Process-namespaced facts | Owning domain contract plus committed outbox row | Messaging append path                       | Messaging infrastructure, PgQue            |
| Event envelope, outbox, and receipts          | Messaging                                               | `messaging.event_outbox` and receipt tables      | Messaging service / future PgQue adapter    | Domain business meaning                    |
| Event fan-out and acknowledgement             | Messaging/infrastructure delivery                       | Delivery state and consumer receipt              | PgQue when activated                        | ERP business truth or workflow completion  |
| Active entity ownership and serialization     | Stateful Entity Runtime contract                        | PostgreSQL remains canonical for business facts  | Runtime adapter, experimentally `celld`     | Domain authorization or business authority |
| Deployment and resource isolation             | Operations/workload layer                               | WorkloadCell configuration and admission state   | Deployment/runtime platform                 | Entity ownership or tenant authorization   |

A worker is an **executor**, not the owner of the facts it changes. A `celld` cell is an **adapter
runtime**, not the owner of the business aggregate. PgQue is a **delivery mechanism**, not the owner
of the event's meaning. The public domain service remains the authorized command boundary.

### Example: order confirmation

A single confirmation may cross several owners without transferring authority:

```text
Sales       owns order state and confirmation policy
Inventory   owns reservation and stock state
Accounting  owns revenue journal and posting policy
Process     owns workflow coordination, result, and post-commit work
Messaging   owns event envelope, append, and receipt mechanics
PgQue       delivers committed events after activation
celld       may serialize an approved active entity, if later enabled
PostgreSQL  commits canonical business facts and constraints
```

The Process coordinator may invoke the public Sales, Inventory, and Accounting contracts in one
transaction. It must not write their tables directly. A Process lifecycle event is Process-owned
when Process defines its event contract; a Sales domain event remains Sales-owned even if Process
caused the command.

### Source-of-truth rule

For every durable field, choose one authoritative owner:

```text
business fact       -> owning domain PostgreSQL tables
workflow result     -> process.workflow_runs
internal work       -> process.jobs
execution ordering  -> Process-owned relational dependency edges
publication intent  -> messaging.event_outbox
consumer completion -> Messaging-owned consumer receipt
active runtime view -> selected runtime adapter, rebuildable/reconcilable
transport delivery  -> PgQue delivery state when activated
```

A derived view, cache, graph query, lease, receipt, or runtime snapshot may describe the source of
truth, but must not silently replace it. If two components need to update the same semantic state,
the ownership model is incomplete and must be resolved before implementation.

## Where `celld` fits

`celld` is not a fifth queue, event bus, or workflow engine. The **Stateful Entity Runtime** itself
is a first-class, vendor-neutral EclipseERP execution capability, but its use is optional per entity
category and the default remains direct PostgreSQL execution. `celld` is only a candidate adapter
for that capability: one named active entity, one logical owner, entity-local serialization,
activation, alarms, and recovery.

The safe conceptual path is:

```text
process.jobs
    durable internal work
          |
          v
Process worker
          |
          v
public domain command
          |
          v
optional Stateful Entity Runtime
          |
          v
celld adapter
    active entity state
```

The unsafe path is to let a `celld` cell become another source of truth for workflow progress, job
state, or business facts:

```text
workflow_runs + process.jobs + celld workflow state
```

That creates competing orchestration state. `celld` state must remain rebuildable, runtime-durable,
or ephemeral according to the approved state classification; PostgreSQL remains canonical for
EclipseERP business facts. The `celld` adapter is proposed and experimental, not a production
dependency.

If an entity category declares runtime execution as required, every command crossing that category's
serialized invariant must use the `StatefulEntityRuntime` contract. A local/direct adapter may
replace `celld` only when it preserves the same ownership, fencing, serialization, recovery, and
reconciliation semantics; direct database fallback must not silently bypass them. The canonical
category rule is defined in [`../runtime-architecture.md`](../runtime-architecture.md).

The boundaries are therefore:

| Concern                      | Owner                                       | What `celld` may do                                                         |
| ---------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Business process progression | `workflow_runs` / approved workflow runtime | Coordinate active execution only through the public contract                |
| Internal leased work         | `process.jobs`                              | Run a command for an active entity                                          |
| Committed facts and delivery | Messaging / PgQue                           | Consume or publish facts; never use cell state as authority                 |
| Active entity ownership      | Stateful Entity Runtime                     | Provide serialization, activation, fencing, and recovery through an adapter |
| Deployment isolation         | `WorkloadCell`                              | Host a runtime workload; it is not a `celld` cell or business owner         |

A `celld` cell may run inside a WorkloadCell, but those are separate concepts. A cell address is
routing input, not authorization, tenant scope, or business ownership.

`celld` must not leak into domain packages, public DTOs, events, Process IR, or persistence schemas.
Domain commands, authorization, transaction boundaries, and reconciliation remain EclipseERP-owned.

## Four different state machines

### 1. Workflow state

`process.workflow_runs` records the semantic Process outcome:

```text
running
   |
   +--> succeeded
   |
   +--> manual_recovery
```

It answers whether the bounded workflow has completed, requires recovery, or is still in progress.
Its payload, result, aggregate identity, and idempotency key belong to Process coordination.

### 2. Internal work state

`process.jobs` records work owned by the Process boundary:

```text
pending
   |
   v
leased
  | \
  |  +--> failed
  |  +--> manual_recovery
  v
completed
```

Its scheduling, priority, lease, retry, and recovery fields describe execution of one internal task.
Examples include:

```text
process.order_confirmation.post_commit
process.order_cancellation.post_commit
process.order_fulfillment.post_commit
```

These are imperative instructions: **do this internal work**.

### Execution composition

Channels, retry policies, and dependency edges are compositions of the durable-work primitive. They
must remain below Process execution ownership rather than becoming another orchestration layer.

#### Channels

A channel partitions worker capacity for a controlled set of job types:

```text
job type
   |
   v
job definition
   |
   +--> channel
   +--> priority
   +--> lease duration
   +--> retry policy
```

Channel assignment should be controlled by the job definition or `jobType`, not supplied as an
arbitrary caller value. Otherwise a caller could place ordinary work into a reserved critical
channel and bypass workload isolation.

#### Retry policy

`attempts`, `lastError`, and `scheduledAt` are execution state. A retry policy should be defined by
job type and should classify failures before retrying:

```text
failure
  |
  +--> classified transient  -> reschedule within policy
  +--> classified permanent  -> terminal/recovery state
  +--> retry budget exhausted -> manual recovery or another explicit terminal state
```

Retrying every failure is not safe. Business idempotency remains at the command boundary; a worker
retry or an event delivery retry must not become a second business authority.

#### Execution dependencies

A future `process.job_dependencies` relation may express execution ordering:

```text
Prepare
  |
  +--> BuildPDF --+
  |               +--> Archive
  +--> BuildCSV --+
```

A dependent job is runnable only after its prerequisites complete. Cycles must be rejected, and a
failed prerequisite must not silently permit the dependent job to run.

These edges are **execution dependencies**, not business-process transitions. The following is an
execution dependency when the output is technically required:

```text
GenerateDocument -> UploadDocument
```

The following is a business workflow and belongs to the Process/domain lifecycle boundary:

```text
ConfirmOrder -> ReserveInventory -> CreateInvoice -> FulfillOrder
```

`chain()` and `group()` should therefore, if introduced later, compile to ordinary job rows and
edges. They must not become a second workflow DSL or a second checkpoint authority. The current
canonical storage remains relational; no dependency-graph feature is implied by this reference
document.

#### Relational truth and optional graph queries

If PostgreSQL property-graph queries are used for job dependencies, the tables and foreign keys
remain canonical:

```text
process.jobs + process.job_dependencies
             |
             +--> relational scheduler queries
             +--> optional graph query/view for inspection
```

A property graph is a query representation, not a second graph database or a replacement for the
scheduler's transactional hot path. Runnable-job acquisition should remain a bounded relational
query with the required locks and tenant/channel scope. Graph queries are better suited to operator
inspection, impact analysis, diagnostics, and visualization; arbitrary traversal should continue to
use the supported relational mechanism until the deployed PostgreSQL version provides and passes the
required graph capability gates.

A job dependency may dispatch work that invokes an optional Stateful Entity Runtime, but the two
relations remain independent:

```text
execution edge:  job A -> job B
entity ownership: job B -> EntityAddress -> runtime/celld
```

The edge orders work. The runtime serializes commands for one entity. Neither relation should be
stored as the other's state.

### 3. Transactional event intent

`messaging.event_outbox` records a committed publication intent created inside the same PostgreSQL
transaction as the owning domain mutation:

```text
business mutation + event append
              |
              +--> commit: durable event intent
              +--> rollback: neither is committed
```

The event is a past-tense fact, not a work instruction:

```text
sales.order.confirmed
sales.order.cancelled
sales.order.fulfilled
```

Messaging owns the envelope and append mechanics. The publishing domain or Process owns the event
meaning and declaration.

### 4. Fan-out delivery

PgQue is the selected future fan-out adapter for committed events:

```text
event_outbox
     |
     v
   PgQue
   /   \
consumer A  consumer B
```

PgQue delivery, visibility, retry, and acknowledgement concern distribution to consumers. They do
not become the source of truth for the ERP business state or for the Process workflow result.

PgQue remains gated until the installer, PostgreSQL 19 operational procedure, ticker, grants,
upgrade, and adapter requirements are satisfied. Its activation does not, by itself, remove
`process.jobs`.

## Imperative work versus declarative fact

A useful boundary test is the grammatical form of the record:

```text
process.jobs
    "Run order-confirmation post-commit work."

messaging.event_outbox / PgQue
    "The order was confirmed."
```

A Process job may legitimately produce a committed event as one step of its owned work. The two
records are not duplicates when:

1. the job remains the source of truth for the internal task execution;
2. the event remains the source of truth for the committed fact's publication intent; and
3. consumers use the event contract rather than the job row as their input.

## Accidental duplication patterns

### Sending Process jobs through PgQue as if they were events

```text
process.order_confirmation.post_commit -> PgQue -> worker
```

This makes PgQue a second Process executor and blurs whether the job table or PgQue owns lease,
retry, acknowledgement, and recovery state. It also exposes an imperative internal task as a fan-out
event without a domain event contract.

### Running two independent executors for one command

```text
process.jobs retry  ----+
                        +--> confirm/cancel/fulfill command
PgQue retry -----------+
```

At-least-once delivery can then create duplicate business attempts with two uncoordinated retry
policies. Business idempotency must remain at the domain command boundary; transport acknowledgement
is not business completion.

### Treating `process.jobs` as a general event bus

A job has one owned worker and an imperative task lifecycle. It should not be used as the fan-out
source for unrelated consumers such as analytics, search, notifications, or extracted services.
Those consumers should receive the versioned, tenant-scoped event contract through Messaging and the
configured fan-out adapter.

### Treating PgQue acknowledgement as workflow completion

A consumer acknowledgement proves only that that consumer accepted its message according to its
delivery contract. It does not prove that the Process workflow succeeded, that the ERP transaction
committed, or that every consumer completed. Workflow completion belongs to `workflow_runs`; local
consumer completion belongs to consumer receipts.

## Boundary invariant

The intended ownership split is:

```text
workflow_runs
    Process business/process history and checkpoints

process.jobs
    Process-owned internal leased work

messaging.event_outbox
    Transaction-aware committed event intent

PgQue
    Future post-commit event fan-out
```

Do not introduce a second source of truth for any one of these responsibilities. In particular:

- do not make PgQue the Process workflow executor;
- do not make `process.jobs` a general event transport;
- do not use event delivery state as business authorization or invariant state;
- do not assume a queue acknowledgement provides exactly-once external effects.

## Change gate

Replacing `process.jobs` with PgQue, or assigning PgQue responsibility for Process workflow
execution, is an architectural change rather than a local refactor. It would change ownership, retry
semantics, transaction boundaries, and operational recovery. Such a change requires a new accepted
ADR and updates to the canonical durable-execution and messaging documents; this reference file must
not be used to imply that decision.

## Practical review checklist

Before adding a queue, job, or event path, ask:

1. Is this an imperative task or a committed fact?
2. Who owns its meaning and schema?
3. Is there one source of truth for its business outcome?
4. Who owns scheduling, leasing, retry, and recovery?
5. Can a retry invoke a business command twice, and where is idempotency enforced?
6. Is the record intended for one worker or many consumers?
7. Does the proposed path change an accepted ownership or transaction decision?

If the answers point to different responsibilities, two durable mechanisms may be correct. If they
point to the same responsibility, stop and resolve the ownership conflict before adding the second
mechanism.
