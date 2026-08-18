# Process Studio Readiness Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Owns:** prerequisites, dependency gates, and release readiness for the
> Process Studio roadmap.
>
> **Detailed semantics belong to:** [`../architecture/process-studio.md`](../architecture/process-studio.md).

> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - ERP primitive decisions: [`./erp-primitives.md`](./erp-primitives.md)
> - Domain maturity: [`./domain-maturity.md`](./domain-maturity.md)
> - Process Studio architecture: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - External integration surface: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Process Studio ADR: [`../decisions/0018-adopt-typed-process-studio.md`](../decisions/0018-adopt-typed-process-studio.md)
> - Capability release and runtime governance:
>   [`../decisions/0020-adopt-capability-release-and-runtime-governance.md`](../decisions/0020-adopt-capability-release-and-runtime-governance.md)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Messaging: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)

## Rule

The visual designer is not the beginning of Process Studio. The order is:

```text
primitive decisions
        ↓
mature domain contracts
        ↓
Typed Action/Event Catalogs
        ↓
headless Process IR runtime
        ↓
recovery, compensation, monitoring
        ↓
visual designer
        ↓
governed 1.0
```

Do not expand the runtime while the lower layers are still speculative.

## Pre-0.8 Gate

Before Process Studio 0.8 work starts, resolve:

```text
[ ] scope, organization, party, product, UOM, location, document, quantity, money,
    period, audit, and correlation primitives are DECIDED or explicitly out of scope
[ ] procurement and billing ownership is clear for any purchase or payment process
[ ] at least two existing domains can expose stable public commands
[ ] event ownership and delivery semantics are explicit
[ ] compensation/manual recovery metadata has an owning-domain contract
[ ] catalog versioning and compatibility rules have an ADR or canonical rule
[ ] workflow authorization is separate from domain action authorization
[ ] durable engine compatibility gates remain enforced
[ ] external action/event profile is defined separately from domain actions/events
[ ] connector authentication, idempotency, delivery, and compensation rules are explicit
[ ] capability release states and compatibility ranges are defined
[ ] process promotion separates release from deployment across environments
[ ] execution principal, delegation, SoD, and business observability are explicit
```

If any item is material `UNKNOWN`, remain in the primitive/domain roadmap. External
integration details are governed by
[`../architecture/integration-architecture.md`](../architecture/integration-architecture.md).

Current evidence closes the bounded internal primitive and action-provider prerequisites:
`inventory.stock.adjust` v1, `sales.order.confirm` v1, and `accounting.revenue.post` v1 are PUBLIC
Level 3 action slices with owner-published events. Accounting derives the revenue amount from a
d 0.8 caSales-owned confirmed-order fact. This permits boundetalog work, but PgQue, external
connectors, Process IR, event waits, and the broad workflow runtime remain gated.

## 0.8 — Capability Metadata

Source of truth for the semantic contents is
[`../architecture/process-studio.md`](../architecture/process-studio.md). The
readiness work is:

```text
domain capability metadata
Typed Domain Action/Event Catalog
Typed External Action/Event Catalog boundary
capability stability and release contract
idempotency contracts
correlation and causation contracts
compensation metadata
bounded precondition/effect vocabulary
one typed source of truth for catalog/API/SDK/process metadata
```

Exit gate:

- two domains publish catalog entries;
- entries are versioned and tenant-aware;
- entries are verified against public contracts;
- compensation distinguishes explicit command from manual recovery;
- unregistered actions/events cannot execute in a process.

## 0.85 — Minimal Headless Runtime

Only after the 0.8 catalog gate:

```text
RITSEI Process IR
process definitions and instances
domain command execution
pure decisions
timers
wait for typed events
human tasks
explicit execution context
persisted step state
business and technical correlation
```

Exit gate:

- restart and crash recovery work at every checkpoint;
- duplicate commands/events do not duplicate domain effects;
- instances pin exact definition and catalog versions;
- task, timer, event-wait, and compensation state is observable.

## 0.9 — Operational Maturity

```text
capability deprecation and retirement
process definition release/deployment promotion
bounded retry
recovery
cancellation
execution context and SoD policy
audit and business correlation
compensation execution
monitoring APIs
operator controls
```

Exit gate:

- operators can distinguish business failure, technical retry, unknown external outcome,
  compensation, and manual recovery;
- compensation is independently authorized and idempotent;
- no runtime path bypasses a domain public contract;
- load, crash recovery, migration, and upgrade tests pass;
- `pg_durable` gates are satisfied before it becomes authoritative.

## 0.95 — Visual Designer

Only after the headless runtime is stable:

```text
catalog-driven palette
drag-and-drop editor
keyboard and structured editor
typed mappings
static validation
pure decision tables
simulation
version comparison
```

Exit gate:

- visual and structured editing produce identical deterministic Process IR;
- invalid action ordering, mappings, scope, retry, and compensation are rejected;
- no process semantics execute in the browser;
- accessibility tests cover keyboard alternatives to drag-and-drop.

## 1.0 — Governed Process Studio

The user experience may remain simple (`Draft -> Test -> Publish`), but the
backend preserves DEV/TEST/PROD promotion, release immutability, deployment
bindings, capability compatibility, approval authority, and audit history.

```text
review and approval
immutable release and deployment
retirement
Task Inbox
Process Monitor
recovery and compensation controls
basic process documentation
basic duration/bottleneck reporting
BPMN import/export through Process IR
```

Exit gate:

- definition governance and action execution authorization are separate;
- running instances remain pinned to their released and deployed versions;
- operators can recover committed non-reversible effects safely;
- tenant, audit, accessibility, and redaction requirements pass;
- BPMN interoperability rejects unsupported executable semantics.

## Hard Stops

Do not proceed to the next phase when:

- the phase depends on a primitive marked `UNKNOWN`;
- the next phase would create a new package without an invariant owner;
- catalog metadata would be hand-maintained separately from domain contracts;
- compensation is inferred rather than explicitly declared;
- a workflow transaction would span durable checkpoints;
- a visual feature would conceal missing runtime semantics;
- `pg_durable` is used before its compatibility and production gates pass.

## Validation Portfolio

Use the smallest proof that matches the phase:

| Phase | Required proof |
|---|---|
| Pre-0.8 | ADR/canonical decisions, ownership checks, contract vocabulary |
| 0.8 | catalog schema, version, scope, authorization, compatibility tests |
| 0.85 | Process IR determinism, restart, duplicate command/event, timer/task tests |
| 0.9 | crash recovery, retry exhaustion, cancellation, compensation, audit, load tests |
| 0.95 | static validation, simulation, keyboard/accessibility, IR equivalence tests |
| 1.0 | governance, version pinning, operator recovery, redaction, interoperability tests |

A feature-specific invariant still needs its own domain proof. Process Studio
tests cannot replace inventory, accounting, procurement, or sales invariant tests.
