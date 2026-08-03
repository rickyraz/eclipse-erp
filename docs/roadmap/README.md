# EclipseERP Roadmap

> **Status:** Canonical roadmap index
>
> **Owns:** sequencing, dependency gates, readiness, decision backlog, and
> milestone exit criteria.
>
> **Must not own:** detailed domain invariants, runtime semantics, or historical
> decision rationale. Those belong to the relevant architecture document or ADR.
>
> **Related documents**
>
> - Documentation governance: [`../documentation-boundaries.md`](../documentation-boundaries.md)
> - Product vision: [`../product/vision.md`](../product/vision.md)
> - Architecture overview: [`../architecture/overview.md`](../architecture/overview.md)
> - Process Studio architecture: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Process Studio ADR: [`../decisions/0018-adopt-typed-process-studio.md`](../decisions/0018-adopt-typed-process-studio.md)

## Purpose

EclipseERP must decide and stabilize its ERP primitives before Process Studio
becomes a large durable runtime. The roadmap is therefore dependency-first, not
feature-count-first.

```text
primitive decisions
        ↓
domain contracts and invariants
        ↓
typed actions and events
        ↓
headless process runtime
        ↓
recovery, compensation, and monitoring
        ↓
visual designer and governed 1.0
```

A roadmap item is not complete because a table or screen exists. It is complete
when its owner, public contract, invariant proof, authorization, failure model,
and operational behavior are clear enough to become a safe Process Studio
capability.

## Current Posture

The repository currently has these package families:

```text
Foundation:
  kernel, auth, authorization, identity, party, integrations

Business domains:
  inventory, accounting, sales

Scaffolds or partial domains:
  procurement, billing

Not yet implemented as a runtime package:
  workflow / Process Studio
```

The current inventory, accounting, and sales capabilities are useful vertical
slices, not a complete ERP primitive set. `procurement` and `billing` must not be
advertised as Process Studio action providers until their public contracts and
invariant tests exist.

## Roadmap Tracks

| Track | Purpose | Canonical subroadmap |
|---|---|---|
| ERP primitives | Resolve scope, master data, document, quantity, money, control, and integration semantics | [`erp-primitives.md`](./erp-primitives.md) |
| Domain maturity | Turn existing packages into stable action/event providers and identify missing domains | [`domain-maturity.md`](./domain-maturity.md) |
| Process Studio readiness | Gate catalogs, runtime, recovery, and designer work | [`process-studio.md`](./process-studio.md) |

## Dependency Stages

### Foundation Gate — before Process Studio 0.8

Decide and document the primitives that affect cross-domain contracts:

```text
scope and organization
party roles and relationships
product/service and unit of measure
location and resource identity
document identity, references, and lifecycle
quantity and movement semantics
money, currency, tax, obligation, and settlement scope
fiscal period and control semantics
audit, correlation, and causation
```

No large workflow runtime should be started while these remain material
`UNKNOWN` decisions.

### Domain Contract Gate — before catalog registration

A domain capability must have:

- one semantic owner;
- a public Effect contract;
- Effect Schema input/output and stable tagged failures;
- authorization and tenant scope;
- transaction, idempotency, and concurrency semantics where relevant;
- database constraints and invariant tests;
- typed event behavior when a committed fact is process-visible;
- compensation or explicit manual-recovery semantics for committed effects.

### Catalog Gate — Process Studio 0.8

At least two mature domains publish versioned Typed Action and Event Catalog
entries. Catalog metadata must be derived from or tested against public contracts,
not copied into an unverified UI registry.

### Headless Runtime Gate — Process Studio 0.85

A small Process IR runtime must survive restart, duplicate delivery, lost command
responses, timers, event waits, human tasks, and version pinning before a visual
designer is prioritized.

### Operational Gate — Process Studio 0.9

Recovery, retry, cancellation, audit correlation, monitoring, and compensation
must be observable and operator-safe. `pg_durable` remains subject to its
compatibility and production gates.

### Designer Gate — Process Studio 0.95

Only after the headless runtime and static validator are stable:

```text
drag-and-drop editor
keyboard/structured editor
catalog-driven palette
typed mappings
simulation
version comparison
```

### Governed Release Gate — Process Studio 1.0

Publishing, approvals, immutable versions, task inbox, process monitor,
compensation controls, basic analysis, and BPMN interoperability may ship only
when all prior gates pass.

## Global Exit Criteria

Before Process Studio becomes a broad runtime, verify:

```text
[ ] no material primitive decision is UNKNOWN
[ ] each mutable fact has one semantic owner
[ ] tenant, organization, and legal scope are explicit
[ ] product, service, UOM, location, document, quantity, and money semantics are stable
[ ] procurement and billing are either implemented or explicitly out of scope
[ ] public domain contracts expose process-safe actions/events
[ ] committed effects declare compensation or manual recovery
[ ] catalog versions and Process IR versions are deterministic
[ ] runtime recovery and idempotency are proven
[ ] authorization and audit are enforced outside the browser
[ ] visual design is a projection over validated runtime semantics
```

## Change Control

A roadmap change that changes ownership, transaction semantics, trust, durability,
public contracts, or the Process Studio execution model requires an ADR. A
milestone may be reordered only when its dependency and exit criteria are
updated here and in the affected subroadmap.

Do not create a new package solely because it appears on a product roadmap. Add a
package only when it owns a distinct invariant or public capability.
