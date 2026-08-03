# Process Studio Architecture

> **Status:** Canonical target architecture
>
> **Owns:** Process design-time semantics, typed action and event catalogs, Eclipse Process IR,
> static process validation, definition governance, compensation metadata, and the staged Process
> Studio roadmap.
>
> **Implementation status:** Planned. The roadmap begins only after the prerequisite domain
> contracts and runtime gates are implemented and verified.
>
> **Related documents**
>
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Messaging and event delivery: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Plugin trust: [`./plugin-architecture.md`](./plugin-architecture.md)
> - Frontend architecture: [`./frontend.md`](./frontend.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Process Studio decision:
>   [`../decisions/0018-adopt-typed-process-studio.md`](../decisions/0018-adopt-typed-process-studio.md)

## Purpose

EclipseERP will provide a governed, typed, domain-aware Process Studio for modeling, publishing,
executing, monitoring, and improving business processes. Business users compose approved ERP
capabilities; they do not write arbitrary SQL, scripts, or mutations against domain state.

The target is not a generic low-code platform or a clone of another process product. The
distinguishing property is that the designer and runtime understand EclipseERP's public domain
contracts, capabilities, tenant scopes, typed failures, state transitions, events, and compensation
semantics.

```text
Developer describes a capability
            |
            v
Codex Skills implement and validate domain contracts
            |
            v
Typed Action Catalog + Typed Event Catalog
            |
            v
Business users compose approved capabilities
            |
            v
Static validation -> governance -> durable execution
```

Codex Skills and Process Studio operate at different layers:

```text
Development time
-> build new safe capabilities

Runtime design time
-> compose existing safe capabilities
```

Process Studio never replaces domain ownership or turns a process definition into a super-domain.

## Architectural Position

```text
                     Process Studio
                          |
              +-----------+-----------+
              |                       |
        Process Designer        Process Monitor
              |                       |
              v                       v
       Process Definition       Runtime Observability
              |
              v
         Static Validator
              |
        +-----+-----+
        |           |
 Action Catalog   Event Catalog
        |           |
        +-----+-----+
              |
              v
          PUBLISHED
              |
              v
        Workflow Runtime
              |
    +---------+-----------+
    |         |           |
    v         v           v
 Commands   Human Task   Event Wait / Timer
    |
    v
Public Domain Contract
    |
    v
Owning Domain
    |-- invariant
    |-- transaction
    |-- authorization
    `-- audit
```

The Process Studio owns coordination state only. Domain packages remain the authoritative owners of
inventory, accounting, sales, procurement, party, billing, authorization, and other business facts.

## Separation of Concerns

### Design Time

Design time owns:

- process definitions and diagrams;
- input and output mappings;
- action and event selection;
- pure decisions;
- human-task assignment policy;
- timers, waits, retries, timeouts, and compensation policy;
- static validation;
- review, approval, publication, and version history;
- documentation and simulation.

### Runtime

Runtime owns:

- process instances pinned to published definition versions;
- deterministic step progression;
- durable timers and event subscriptions;
- human-task state;
- retries, timeouts, cancellation, failure, and recovery;
- compensation progress;
- correlation, causation, actor, and audit metadata;
- operational monitoring.

Runtime engine selection remains owned by [`durable-execution.md`](./durable-execution.md). Process
Studio defines the semantics the selected engine must preserve.

### Domain Execution

Domain execution owns:

- business preconditions and invariants;
- authorization enforcement;
- tenant and organization boundaries;
- database transactions and constraints;
- durable business facts;
- typed business failures;
- domain audit and event publication.

A process step invokes a public domain command. It must not import private repositories or mutate
another module's tables.

## Typed Action Catalog

The Typed Action Catalog is a core product capability, not an implementation detail. It is the
authoritative registry of ERP commands that process definitions may invoke.

The designer reads the catalog dynamically. It must not hard-code a permanent list such as
`Reserve Stock`, `Post Journal`, or `Approve Invoice`. When a domain publishes a new approved
action, the Process Studio can discover it without a parallel UI release, subject to compatibility
and authorization rules.

A catalog entry has this conceptual contract:

```text
DomainAction
  id
  version
  owningDomain
  title
  description

  inputSchema
  outputSchema
  possibleFailures

  requiredCapability
  tenantAndOrganizationScope

  idempotency
  transactionSemantics
  timeoutPolicy
  retryPolicy

  preconditions
  effects

  reversible
  compensation
```

### Identity and Versioning

- `id` is stable and namespaced by the semantic owner.
- `version` changes when the process-visible contract changes incompatibly.
- Published process definitions bind to an exact compatible action version.
- A domain may deprecate an action version, but it must not silently change the meaning of running
  process instances.
- Action catalog metadata is not the domain implementation and must not expose Drizzle tables,
  repositories, or infrastructure errors.

### Schemas and Failures

Inputs, outputs, mappings, and public failures use Effect Schema-compatible public contracts. The
static validator rejects incompatible edges and mappings before publication.

Possible failures describe stable process-visible outcomes. Raw PostgreSQL, driver, stack-trace, or
repository failures never become catalog contracts.

### Authorization and Scope

Every protected action declares its required business capability and relevant scope dimensions. The
declaration supports design-time validation and UX; the owning domain must still authorize every
runtime invocation.

A process definition cannot grant a capability to its author, publisher, participant, or runtime
principal. Definition governance and action execution are separate authorization decisions.

### Idempotency and Transaction Semantics

Each action declares enough metadata for safe orchestration:

```text
idempotency
  required | inherent | unsupported

transactionSemantics
  local_atomic
  coordination_only
  durable_external_effect
```

The catalog does not permit the workflow runtime to stretch a PostgreSQL transaction across human
tasks, timers, external calls, or process checkpoints. Local synchronous invariants remain
owner-local transactions.

### Preconditions and Effects

Actions may expose a bounded, typed semantic summary for static validation:

```text
ConfirmWarehouseTransfer

requires:
  transfer.status = DRAFT
  source.available >= transfer.quantities

effects:
  transfer.status = CONFIRMED
  source.onHand -= transfer.quantities
```

These declarations support process compilation, simulation, and explanation. They do not replace
runtime validation in the owning domain and must never claim more precision than the domain contract
can guarantee.

Preconditions and effects use a restricted declarative vocabulary. They cannot execute SQL, HTTP
requests, arbitrary code, or hidden reads.

## Compensation

Compensation is a first-class runtime and catalog concept from the first engine design, even if the
initial visual designer does not expose compensation as a user-draggable node.

A committed ERP operation often cannot be rolled back by reverting a database transaction later:

```text
Post Journal
Ship Goods
Receive Goods
Issue Inventory
Send Payment
```

After such an operation commits, recovery requires another explicit business operation:

```text
Post Journal
    |
    v
later process failure
    |
    v
Post Reversal Journal
```

Deleting or rewriting the original business fact is forbidden when the owning domain requires
reversal or compensating entries.

An action declares one of:

```text
reversible: false
compensation:
  command: accounting.journal.reverse
```

or:

```text
reversible: false
compensation: none
```

A compensation command:

- is another versioned Typed Action Catalog entry;
- belongs to the domain that owns the affected invariant;
- has its own input schema, capability, failures, idempotency, transaction, and audit behavior;
- records a new business fact instead of erasing committed history;
- preserves correlation and causation to the original action execution.

Catalog metadata declares whether a compensating command exists. The process definition must still
declare whether and when it may run automatically. The runtime must not guess that every available
reversal should execute on every failure.

When `compensation: none`, the process compiler and operator UI must expose that the committed
effect is not automatically reversible. A later failure may move the instance to an explicit
manual-recovery state rather than pretending that a rollback is possible.

Compensation execution must be:

- durable;
- idempotent;
- observable;
- separately authorized;
- ordered according to the published compensation plan;
- resumable after failure;
- auditable independently from the forward action.

## Typed Event Catalog

The Typed Event Catalog is symmetrical with the Typed Action Catalog. `Wait for
Event` and event
triggers select catalog entries; they never accept an unvalidated free-form event name.

Example identities:

```text
inventory.stock_transfer.confirmed.v1
sales.invoice.finalized.v1
accounting.journal.posted.v1
procurement.goods_received.v1
```

A catalog entry has this conceptual contract:

```text
DomainEvent
  id
  version
  owningDomain
  title
  description

  payloadSchema
  tenantScope
  aggregateType
  correlationFields
  filterableFields
  occurredAtSemantics
```

Event envelopes and durable delivery remain owned by [`pgque-messaging.md`](./pgque-messaging.md).
The catalog supplies typed discovery and process-compatible metadata.

The designer may express:

```text
Wait for:
  Inventory.StockTransferConfirmed.v1

Filter:
  transferId = ${process.transferId}
```

Static validation must prove that:

- the selected event version exists;
- the filter references declared filterable fields;
- mapped process data and event fields are type-compatible;
- tenant scope is preserved;
- correlation is sufficiently specific for the intended wait;
- the process handles timeout or cancellation when an event may never arrive.

Event delivery remains at-least-once unless the owning messaging contract says otherwise. Resume
operations and event consumers must therefore be idempotent.

## Eclipse Process IR

Eclipse Process IR is the internal source of truth for process definitions. It is deliberately
smaller than BPMN, typed, versioned, deterministic, and aligned with EclipseERP runtime semantics.

Initial node kinds are limited to:

```text
Start
Domain Command
Human Task
Decision
Wait for Event
Timer
Parallel Branch
End
```

Additional node kinds require demonstrated business need and an architecture review. Arbitrary
script, SQL, unrestricted HTTP, RPA, and autonomous-agent nodes are not part of the 1.0 core.

The initial runtime must not use BPMN XML as authoritative executable state:

```text
BPMN import
    |
    v
validated translator
    |
    v
Eclipse Process IR
```

and later:

```text
Eclipse Process IR
    |
    v
BPMN exporter
```

BPMN and DMN are interoperability targets. Their full execution semantics do not automatically
become EclipseERP runtime semantics.

The IR must support:

- stable node and edge identifiers;
- explicit process input and output schemas;
- typed data mappings;
- exact action and event versions;
- transition conditions;
- task assignment policy;
- retry, timeout, timer, and cancellation policy;
- compensation plan;
- source diagram layout as non-semantic presentation data;
- deterministic serialization and checksums;
- forward-compatible format versioning.

## Pure Decisions

Decision nodes are pure, deterministic transformations:

```text
inputs
  |
  v
Decision
  |
  v
result
```

A decision may evaluate typed values and produce a typed result. It must not:

- query PostgreSQL or hidden mutable state;
- invoke a domain command;
- update business state;
- send HTTP requests;
- publish events;
- read the current clock implicitly;
- use nondeterministic AI output as a binding result.

Required external or mutable facts must be obtained explicitly by an earlier typed action and passed
into the decision input. Time-sensitive decisions receive an explicit timestamp input.

Pure decisions enable reproducible simulation, deterministic retries, versioned decision tables, and
explainable branch selection. Decision tables may become DMN-compatible progressively, but the 1.0
runtime uses the bounded Eclipse decision model.

## Static Process Validation

The Process Studio behaves as a business-aware compiler, not only a diagram editor. Publication is
forbidden until static validation succeeds.

The validator checks at least:

- graph structure, reachability, and valid start/end topology;
- known Process IR version and supported node kinds;
- exact action and event catalog references;
- input, output, variable, filter, and mapping compatibility;
- required capabilities and publisher authority;
- tenant and organization scope compatibility;
- transition ordering against declared preconditions and effects;
- retry and idempotency compatibility;
- waits and timers with required timeout/cancellation behavior;
- parallel branches for conflicting declared effects;
- compensation coverage for committed non-reversible actions;
- deprecated or incompatible catalog versions;
- decisions remain pure;
- forbidden arbitrary code, SQL, network, and cross-domain mutation.

Examples:

```text
[Complete Transfer]
        |
        v
[Confirm Transfer]

Invalid ordering:
Complete requires a CONFIRMED transfer, but no preceding effect establishes it.
```

```text
[Post Journal]
      |
      v
[Close Period]
      |
      v
[Post Journal]

Potentially invalid process:
The final action may execute after its accounting period is closed.
```

Static validation is conservative. It may reject only what catalog metadata and process data prove
invalid. It must not invent domain rules. Runtime domain validation remains authoritative because
process inputs, concurrent state, and external facts can change after publication.

Warnings and errors are distinct:

```text
error
-> process cannot be published safely

warning
-> process is valid but has an operational risk requiring review
```

## Process Definition Governance

Definitions use an explicit lifecycle:

```text
DRAFT
  |
  v
VALIDATED
  |
  v
APPROVED
  |
  v
PUBLISHED
  |
  v
RETIRED
```

- Drafts are editable and cannot start production instances.
- Validation records the exact Process IR and catalog versions checked.
- Approval is a governed action separate from editing.
- Publication creates an immutable definition version and checksum.
- Retirement prevents new instances but does not erase history or terminate running instances
  automatically.
- Changes after publication create a new version.
- Running instances stay pinned to the definition and catalog versions with which they started.
- Instance migration is never implicit. A migration policy and compatibility proof are required
  before moving an active instance.

Governance records:

- tenant and organization scope;
- process owner;
- author, reviewer, approver, and publisher;
- version comment and change summary;
- validation result;
- referenced action, event, and decision versions;
- publication and retirement timestamps;
- definition checksum.

Editing, approving, publishing, retiring, starting, cancelling, retrying, and compensating processes
require distinct capabilities where risk warrants it.

## Runtime Semantics

A runtime instance contains at least:

```text
instance_id
process_definition_id
process_definition_version
tenant_id
organization_scope
status
input
output
current_progress
correlation_id
causation_id
started_by
started_at
completed_at
```

Each step execution records:

```text
step_execution_id
node_id
attempt
status
idempotency_key
input
output_or_failure
started_at
completed_at
correlation_and_causation
compensation_status
```

### Durability

Process checkpoints, timers, subscriptions, tasks, retries, and compensation must survive process
restarts. Effect fibers are not durable. The runtime uses the approved primitive from
[`durable-execution.md`](./durable-execution.md), with the compatibility job layer retained until
`pg_durable` passes its production gates.

### Command Invocation

The runtime invokes a Typed Action Catalog entry through its owning public domain contract.
Authorization occurs at execution time using an explicit principal or approved service identity and
tenant/organization scope.

The runtime does not hold one database transaction across multiple durable steps. Each domain
command owns its local atomic transaction. Cross-step consistency uses explicit state, idempotency,
events, and compensation.

### Retry and Idempotency

A retry reuses the stable logical step identity and idempotency key. The runtime must distinguish:

```text
command never committed
command committed and response was lost
command failed with a typed business error
command failed with a retryable technical error
```

Business failures do not become infinite technical retries. Retry policies are bounded and visible.

### Human Tasks

Human tasks are durable process state with:

- typed input and completion output;
- candidate capability, role, group, or explicit assignee policy;
- tenant and organization scope;
- claim, release, delegate, complete, reject, expire, and cancel semantics as required by the task
  contract;
- due date, escalation, and timeout policy when configured;
- task-level authorization and audit;
- optimistic or conditional completion preventing duplicate outcomes.

A task inbox is a projection over authoritative task state, not the source of truth.

### Event Waits and Timers

Event waits bind to exact Typed Event Catalog versions and typed correlation filters. Registration
must be durable before the process can safely suspend. Delivery and resume are idempotent.

Timers use explicit timestamps, time zones, and policies. The runtime must not assume one tenant,
one legal entity, or one time zone.

### Cancellation and Failure

Process definitions declare cancellation boundaries and the treatment of already committed actions.
Cancellation never implies database rollback across past checkpoints.

A failed instance exposes:

- failed node and attempt;
- typed business or stable technical failure;
- completed committed actions;
- pending or failed compensation;
- retry eligibility;
- required operator action;
- audit correlation.

## Process Designer

The Process Designer is a SolidJS feature in `apps/web/` and follows [`frontend.md`](./frontend.md).
It edits Process IR through public API contracts and does not own runtime or domain policy.

The designer provides:

- drag-and-drop node composition;
- catalog-driven action and event palettes;
- typed mapping editors;
- pure decision tables and conditions;
- human-task assignment configuration;
- timers, retries, timeouts, and compensation policy;
- immediate static errors and warnings;
- lifecycle review and publication controls;
- accessible keyboard alternatives to pointer-based drag-and-drop;
- process documentation and version comparison;
- simulation using explicit test inputs.

The UI must remain usable without precision pointer input. Every drag-and-drop action requires an
accessible keyboard and structured-form alternative.

## Process Monitor and Inbox

The Process Monitor provides operational visibility into:

- definition and version;
- instance status and elapsed time;
- active, completed, failed, waiting, and compensating steps;
- human tasks, timers, event waits, and retries;
- typed failures and operator-safe recovery actions;
- correlation and causation trail;
- cancellation and compensation progress.

The monitor must not expose credentials, raw SQL, stack traces, or private event payloads beyond the
viewer's capability and scope.

The Inbox provides assigned and candidate tasks, due dates, process context, and typed completion
forms. Backend authorization remains authoritative even when the UI hides unavailable actions.

## Simulation and Analysis

Simulation executes Process IR against explicit fixtures and pure decisions. It must not mutate
production domain state or send external effects.

Version 1 simulation focuses on:

- path reachability;
- branch outcomes from supplied inputs;
- schema and mapping validation;
- declared precondition/effect propagation;
- timeout and compensation-path inspection;
- expected human-task and event-wait points.

Basic version 1 analysis may report:

- instance count and status;
- step duration;
- wait duration;
- retry and failure frequency;
- bottleneck candidates;
- compensation frequency.

Advanced process mining, cost simulation, conformance analytics, predictive recommendations, and
AI-assisted optimization are post-1.0 concerns unless a separate accepted decision promotes them.

## Extension and Trust Model

Core domains and trusted server plugins may register action and event catalog entries through
versioned contributor contracts. Declarative tenant extensions may compose approved entries and
configure bounded decisions, forms, routing, notifications, and webhooks within their granted
capabilities.

Declarative extensions cannot register arbitrary executable code, elevate trust, mutate core tables,
redefine core invariants, or bypass catalog validation. Sandboxed executable extensions remain a
later-phase feature governed by [`plugin-architecture.md`](./plugin-architecture.md).

## Security Boundaries

Deny by default.

A process author or tenant administrator cannot:

- create arbitrary SQL or script actions;
- call private domain implementations;
- grant capabilities through a process definition;
- change action or event metadata owned by another domain;
- remove required authorization checks;
- forge tenant, organization, correlation, or actor metadata;
- mark a non-idempotent action idempotent;
- fabricate compensation for a domain that exposes none;
- publish a definition with static validation errors;
- activate a new architectural primitive through tenant configuration.

Definitions, instances, tasks, events, and monitoring queries are tenant-aware. RLS may provide
defense in depth but is not the sole authorization mechanism.

## Testing and Validation

Detailed test ownership remains in [`testing.md`](../development/testing.md). Process Studio
implementation must prove the applicable contracts, including:

- catalog identity, versioning, schemas, and contributor authorization;
- Process IR deterministic serialization and compatibility;
- static validation errors and warnings;
- pure decision determinism;
- immutable published versions and instance version pinning;
- command idempotency and lost-response recovery;
- event wait registration and duplicate delivery;
- timer recovery;
- human-task duplicate completion and authorization;
- crash recovery from every durable checkpoint;
- compensation ordering, retry, authorization, and audit;
- cancellation after committed non-reversible actions;
- tenant and organization isolation;
- monitor redaction and operator permissions;
- accessible designer and inbox interaction.

## Delivery Roadmap

The visual designer arrives after catalog and runtime semantics are proven. Version labels describe
architectural milestones, not permission to ship unvalidated behavior.

### 0.8 — Capability Metadata

```text
Domain capability metadata
Typed Action Catalog
Typed Event Catalog
Idempotency contracts
Correlation and causation contracts
Compensation metadata
Bounded precondition/effect vocabulary
```

Exit criteria:

- at least two domains publish versioned actions and events;
- catalog contracts expose no implementation or persistence types;
- action invocation and event filtering are tenant-aware;
- compensation metadata distinguishes explicit command from none;
- contract and architecture tests prevent unregistered execution.

### 0.85 — Minimal Headless Runtime

```text
Eclipse Process IR
Process definitions
Process instances
Domain command execution
Timer
Wait for Event
Human tasks
Pure decisions
```

Exit criteria:

- a headless process survives restart at every checkpoint;
- duplicate command and event delivery do not duplicate business effects;
- instances are pinned to exact definition and catalog versions;
- committed actions and compensation state remain observable.

### 0.9 — Operational Maturity

```text
Definition versioning
Recovery
Bounded retry
Audit correlation
Cancellation
Compensation execution
Monitoring APIs
Operational controls
```

Exit criteria:

- load, crash-recovery, migration, and upgrade tests pass;
- operators can distinguish retryable, business, compensation, and manual recovery states;
- no workflow engine bypasses domain contracts or transaction ownership.

### 0.95 — Visual Designer

```text
Drag-and-drop editor
Keyboard/structured editor alternative
Catalog-driven palettes
Typed mappings
Static validation
Decision tables
Simulation
Version comparison
```

Exit criteria:

- every visual model serializes deterministically to Process IR;
- the UI cannot publish invalid or unauthorized definitions;
- designer accessibility and critical interaction tests pass.

### 1.0 — Governed Process Studio

```text
Review and approval
Publishing and retirement
Simulation
Task Inbox
Process Monitor
Recovery and compensation controls
Basic process documentation
Basic duration and bottleneck reporting
BPMN import/export compatibility boundary
```

Exit criteria:

- definition governance and action execution capabilities are independently enforced;
- published versions are immutable and active instances are stable across new publications;
- runtime, inbox, monitor, and designer satisfy tenant, audit, accessibility, recovery, and
  authorization requirements;
- BPMN interoperability translates through Process IR rather than becoming runtime truth.

### Post-1.0

Potential later capabilities include:

```text
broader BPMN interoperability
DMN interoperability
advanced process mining
cost and resource simulation
conformance analytics
cross-system connector marketplace
sandboxed executable extensions
AI-assisted modeling
agentic workflows
RPA
```

Each requires evidence, bounded trust, and its own accepted architecture decision when it changes
the core runtime or security model.

## Non-Goals for 1.0

- full BPMN execution semantics;
- BPMN XML as authoritative runtime state;
- arbitrary tenant code, SQL, or unrestricted HTTP actions;
- replacing domain services with workflow definitions;
- one transaction spanning durable checkpoints;
- automatic compensation without an explicit published policy;
- rewriting immutable accounting or inventory facts;
- general-purpose RPA;
- autonomous nondeterministic agents controlling core invariants;
- advanced process mining or a generic integration marketplace.

## Completion Criteria

The target architecture is correctly implemented when:

- Action and Event Catalogs are versioned, typed, discoverable, and owner-controlled;
- Process IR is deterministic and is the only executable definition source of truth;
- decisions are pure;
- static validation rejects provably unsafe definitions;
- published versions are immutable and instances remain version-pinned;
- all commands execute through authorized public domain contracts;
- committed effects use explicit compensation or manual recovery rather than fictional rollback;
- timers, waits, tasks, retries, cancellation, and compensation are durable and observable;
- tenant and organization boundaries are enforced throughout;
- the visual designer remains a late, replaceable projection over sound runtime semantics;
- BPMN and DMN remain interoperability formats until explicitly expanded by a later decision.
