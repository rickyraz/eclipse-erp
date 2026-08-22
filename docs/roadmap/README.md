# RITSEI Roadmap

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
> - External integration surface: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Process Studio ADR: [`../decisions/0018-adopt-typed-process-studio.md`](../decisions/0018-adopt-typed-process-studio.md)

## Purpose

RITSEI must decide and stabilize its ERP primitives before Process Studio
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
  kernel, auth, authorization, identity, party, catalog, messaging, integrations

Business domains:
  inventory, accounting, sales

Scaffolds or partial domains:
  procurement (SupplierAccount + draft PurchaseOrder Level 1), billing

Application coordinator only:
  process (bounded order lifecycle; not Process Studio)

Not yet implemented as a runtime package:
  workflow / Process Studio
```

The P0-P3 bounded primitive baseline is ready for the selected internal slices. Inventory
`stock.adjust` v1 and Sales `order.confirm` v1 are Level 3 action slices with owner-published events.
Accounting publishes the PUBLIC `revenue.posted` v1 event and the PUBLIC `revenue.post` v1 action;
its amount is derived and verified from a Sales-owned confirmed-order fact rather than supplied as
an accounting fact by the caller. Accounting’s separate financial-operation intent slice follows
ADR-0040’s non-activated TigerBeetle execution boundary. Procurement now has Level 1
`SupplierAccount` and atomic draft `PurchaseOrder` creation contracts under ADR-0044, but Procurement
and Billing must not be advertised as Process Studio providers until their selected actions reach the
required maturity. PgQue, external connectors, and the broad workflow runtime remain gated.

## Roadmap Tracks

| Track | Purpose | Canonical subroadmap |
|---|---|---|
| ERP primitives | Resolve scope, master data, document, quantity, money, control, and integration semantics | [`erp-primitives.md`](./erp-primitives.md) |
| Financial ledger execution | Migrate the bounded Accounting profile to the required TigerBeetle execution boundary | [`financial-ledger-execution.md`](./financial-ledger-execution.md) |
| Domain maturity | Turn existing packages into stable action/event providers and identify missing domains | [`domain-maturity.md`](./domain-maturity.md) |
| Process Studio readiness | Gate catalogs, runtime, recovery, and designer work | [`process-studio.md`](./process-studio.md) |
| External integration surface | Gate connector protocols, auth, delivery, and external action/event normalization | [`integration-surface.md`](./integration-surface.md) |

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
`UNKNOWN` decisions. Financial actions must also pass the authority and recovery gates in
[`financial-ledger-execution.md`](./financial-ledger-execution.md) before depending on TigerBeetle.

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

### Integration Surface Gate

Before external actions or events become Process Studio capabilities:

- `DomainAction`/`DomainEvent` and `ExternalAction`/`ExternalEvent` are separate;
- OpenAPI operations are allowlisted and versioned;
- CloudEvents are authenticated, schema-validated, and deduplicated;
- AsyncAPI remains a message contract/catalog, not a required broker;
- OAuth scopes remain separate from domain capabilities;
- external side effects declare idempotency, retry, provider status, and
  compensation/manual recovery;
- connector protocols do not leak into Process IR or domain contracts.

The canonical profile is owned by
[`../architecture/integration-architecture.md`](../architecture/integration-architecture.md).

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
[ ] capability stability/release states and compatibility ranges are explicit
[ ] process release is separate from environment deployment
[ ] execution principal, delegation, SoD, and business observability are explicit
[ ] committed effects declare compensation or manual recovery
[ ] catalog versions and Process IR versions are deterministic
[ ] runtime recovery, idempotency, and unknown-outcome handling are proven
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
