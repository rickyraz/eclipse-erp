# ADR-0018: Adopt a Typed, Domain-Aware Process Studio

- Status: Accepted
- Date: 2026-08-03
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical Process Studio architecture:
>   [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Durable execution:
>   [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Messaging: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Current internal delivery ownership:
>   [`./0038-move-internal-event-delivery-to-messaging.md`](./0038-move-internal-event-delivery-to-messaging.md)
> - Plugin trust: [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)

## Context

RITSEI needs to support business-process composition by business users without allowing process
definitions to bypass domain ownership, authorization, tenant isolation, transactional invariants,
audit, or durable execution rules.

A visual workflow editor alone does not solve this problem. If the editor is built before action
semantics, event contracts, versioning, idempotency, compensation, and recovery are defined, it
becomes an attractive UI over an unsafe runtime.

ERP processes also contain committed effects that cannot be rolled back after a workflow checkpoint.
Posted journals require reversals; issued or received goods require compensating movements; sent
payments require explicit recovery operations. A workflow engine must model these as business
compensation rather than pretending that a later SQL rollback can erase committed history.

The repository already defines:

- one semantic owner per invariant;
- public typed domain contracts;
- capability-based authorization;
- PostgreSQL transactions for synchronous invariants;
- the Messaging-owned transactional outbox and consumer receipts for current committed-event delivery;
- PgQue as the selected future fan-out adapter after its activation gates pass;
- job tables for leased work;
- a gated durable workflow engine;
- declarative tenant extensions;
- a SolidJS SPA frontend.

The process architecture must compose these paved roads rather than introduce a parallel business
framework.

## Decision

RITSEI will build a typed, domain-aware Process Studio in catalog-first and runtime-first stages
before delivering the visual designer.

### Typed Action Catalog

Every process-invokable domain command is registered as a versioned Typed Action Catalog entry owned
by its domain. Entries declare public input/output schemas, stable failures, required capability and
scope, idempotency, transaction semantics, retry/timeout policy, bounded preconditions/effects, and
compensation metadata.

The designer discovers actions from the catalog. It does not hard-code domain commands or access
private implementations.

### Typed Event Catalog

Process triggers and waits select versioned Typed Event Catalog entries with payload schemas,
ownership, tenant scope, correlation fields, and safe filterable fields. Free-form event names are
not executable process contracts.

The current internal path is the Messaging-owned transactional outbox and consumer receipts. PgQue
remains the selected future fan-out adapter after its activation gates pass; the catalog supplies
typed process metadata without owning delivery.

### Compensation

Compensation is part of the initial runtime model. A committed non-reversible action declares either
an explicit compensating domain command or no automatic compensation. Compensation commands are
independently authorized, idempotent, transactional, observable, and auditable.

The existence of a compensation command does not automatically activate it. A published process
definition must declare its compensation policy. Operations with no compensation enter explicit
manual recovery when later failure requires intervention.

### RITSEI Process IR

RITSEI Process IR is the authoritative executable representation. It is small, typed,
deterministic, versioned, and limited initially to Start, Domain Command, Human Task, Decision, Wait
for Event, Timer, Parallel Branch, and End.

BPMN and DMN are interoperability targets. BPMN XML is not runtime truth. Import and export
translate through validated Process IR boundaries.

### Pure Decisions

Decision nodes are deterministic functions from typed inputs to typed outputs. They cannot query
hidden mutable state, execute commands, perform network I/O, publish events, or implicitly read
time. Mutable facts must be acquired through an explicit preceding action.

### Static Validation

A process definition is compiled and validated before publication. Validation covers graph
structure, catalog versions, mappings, schemas, capabilities, tenant scope, precondition/effect
ordering, idempotency, waits, timers, parallel effects, compensation coverage, and pure decisions.

Static validation is conservative and does not replace runtime domain validation.

### Governance and Versioning

Definitions progress through draft, validated, approved, published, and retired states. Published
versions are immutable. Running instances stay pinned to the exact definition and catalog versions
with which they started. Instance migration is explicit and requires compatibility proof.

### Domain and Runtime Boundaries

The workflow runtime invokes public domain contracts. It never writes domain tables directly and
never holds one PostgreSQL transaction across durable checkpoints. Domain commands preserve local
atomic invariants; process-level recovery uses idempotency, explicit state, events, and
compensation.

Durable engine selection and compatibility gates remain governed by ADR-0004 and the
durable-execution architecture.

### Delivery Order

The implementation order is:

```text
0.8
-> domain capability metadata
-> Typed Action Catalog
-> Typed Event Catalog
-> idempotency, correlation, and compensation contracts

0.85
-> headless Process IR runtime
-> definitions and instances
-> commands, timers, event waits, human tasks, pure decisions

0.9
-> versioning, recovery, retry, cancellation, compensation, audit, monitoring

0.95
-> accessible visual designer, typed mappings, static validation, simulation

1.0
-> governance, publishing, inbox, operational controls, documentation,
   basic analysis, and BPMN interoperability boundary
```

## Alternatives Considered

### Full BPMN Engine as Runtime Truth

Rejected for 1.0. Full BPMN execution semantics are larger than the required ERP runtime and would
make external notation determine internal durability, authorization, and compensation behavior. BPMN
remains an import/export format through Process IR.

### Visual Designer First

Rejected. A visual-first approach would hard-code actions before contracts and hide unresolved
runtime semantics behind a polished interface. Catalogs and the headless runtime must mature first.

### Hard-Coded Workflow Actions

Rejected. Hard-coded palettes require Process Studio releases for every new domain capability and
allow UI metadata to drift from domain contracts.

### Arbitrary Tenant Scripts, SQL, or HTTP Nodes

Rejected. They bypass semantic ownership, authorization, tenant isolation, typed failures, and
deterministic validation. Declarative tenant extensions may compose approved actions but cannot
introduce unrestricted execution.

### Workflow Super-Domain

Rejected. A central module that owns or mutates every participating domain's facts would violate
one-owner-per-invariant and create an unbounded dependency center. The workflow layer owns
coordination state only.

### Automatic Compensation Inferred by the Runtime

Rejected. Reversal meaning is domain-specific. The owning domain publishes a candidate compensation
command, and the process definition explicitly selects its policy.

## Consequences

### Positive

- Business users can compose workflows without bypassing domain safety.
- New approved domain capabilities become discoverable through catalogs.
- Static validation can detect schema, ordering, scope, and compensation defects before publication.
- Pure decisions enable deterministic simulation and reproducible execution.
- Published definitions and running instances remain stable across upgrades.
- Committed ERP effects use explicit reversal or compensation rather than data deletion.
- The visual designer becomes a replaceable projection over a sound runtime.
- BPMN and DMN interoperability remain possible without dictating internal execution semantics.

### Negative

- Domains must maintain process-facing metadata in addition to their public contracts.
- Preconditions and effects require a carefully bounded semantic vocabulary.
- Catalog and Process IR compatibility become long-lived versioning obligations.
- Compensation and instance migration increase runtime and operational complexity.
- The visual designer is intentionally delayed until headless semantics mature.

### Risks

- Catalog metadata may drift from runtime behavior unless tested against public contracts.
- Overstated preconditions/effects could make static validation unsound.
- Under-specified compensation could leave workflows requiring manual recovery.
- A generic Process IR could grow into an unbounded programming language.
- Business users may assume process publication grants action authorization.
- BPMN import may imply unsupported semantics unless translators reject or explicitly downgrade
  unsupported elements.

Mitigations are owned by the canonical Process Studio architecture: bounded node and expression
vocabularies, owner-controlled catalogs, deterministic tests, explicit versioning, deny-by-default
authorization, immutable publication, and manual recovery for effects without safe compensation.

## Validation

The decision is validated when:

- Action and Event Catalog entries are versioned and generated or verified from public domain
  contracts;
- architecture tests prevent workflow code from importing private domain implementations or tables;
- Process IR has deterministic serialization and compatibility tests;
- static-validation tests cover schemas, capabilities, ordering, tenant scope, idempotency, event
  filters, parallel effects, and compensation;
- decision tests prove purity and determinism;
- runtime tests cover duplicate commands/events, lost responses, crash recovery, timers, tasks,
  retries, cancellation, and compensation;
- published versions remain immutable and instances stay version-pinned;
- authorization tests separate definition governance from action execution;
- accessible visual and structured editing produce the same Process IR;
- BPMN interoperability tests translate through Process IR and reject unsupported executable
  semantics.

## Related Documents

- [`../architecture/process-studio.md`](../architecture/process-studio.md)
- [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
- [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
- [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
- [`../development/testing.md`](../development/testing.md)
