# ERP Primitive Decision Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Owns:** readiness and decision sequencing for reusable ERP primitives.
>
> **Detailed rules belong to:** the owning domain architecture, schema, ADR, or
> public contract. This document records what must be decided before those
> primitives can safely support Process Studio actions.

> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Authorization architecture: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Process Studio architecture: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Orthogonal ERP areas: [`../architecture/reference/orthogonal-erp-areas.md`](../architecture/reference/orthogonal-erp-areas.md)
> - Plugin architecture: [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
> - Semantic owner ADR: [`../decisions/0015-one-semantic-owner-per-invariant.md`](../decisions/0015-one-semantic-owner-per-invariant.md)

## Rule

An ERP primitive is ready for Process Studio composition only when its semantic
meaning is stable across domain contracts, persistence, authorization, events,
and correction behavior.

A primitive does not automatically require its own package. Package boundaries
follow invariant ownership and public capability, not a roadmap checklist. The
orthogonal areas are a semantic map; they do not become packages by enumeration.

## Decision States

```text
KNOWN
  repository already establishes the semantic rule

PARTIAL
  a useful implementation exists but the cross-domain contract is incomplete

UNKNOWN
  a material business decision cannot be recovered from the repository

DECIDED
  an ADR or canonical domain document has selected the rule

READY
  the selected rule has public contracts, executable proof, and operational behavior
```

`UNKNOWN` is not permission to guess. It is a gate that blocks dependent runtime
work until resolved.

## Plugin Boundary

Plugins are an extension mechanism for approved primitive capabilities, not a
second ownership system.

- `CORE` and `TRUSTED_SERVER` extensions may own a new primitive only when they
  declare an owned schema, public contract, capabilities, migrations, tests, and
  compatibility policy.
- A trusted plugin may register Typed Action and Event Catalog entries through an
  approved contributor contract.
- `DECLARATIVE` extensions may configure existing primitives, policies, forms,
  reports, notifications, and safe automations; they cannot define new core
  invariants or arbitrary commands.
- `SANDBOXED` extensions cannot receive direct database, native, or core
  invariant access.
- No plugin may redefine or directly mutate a core domain's invariant.

A plugin primitive is not Process Studio-ready until it satisfies the same
Level 3 provider gate in [`domain-maturity.md`](./domain-maturity.md).

## Primitive Backlog

| Primitive family | Current repository evidence | Current state | Decision before Process Studio |
|---|---|---|---|
| Scope and organization | P0 contracts, composite keys, Legal Entity configuration, Branch and Warehouse scope | `READY` (bounded baseline) | Add new scope only through its semantic owner and a superseding decision when required |
| Party and relationships | PartyRole, PartyRelationship, PartyRepresentation, and scoped external identifiers | `READY` (P0 baseline) | Employee-specific policy remains out of scope until requested |
| Product/service and UOM | Inventory Item has immutable stock UOM and typed whole-number stock contracts | `READY` (P1 baseline) | Unit conversion, fractional stock, services, and classification require a later decision |
| Location and resource | Warehouse is the lowest authoritative stock location and is Legal Entity scoped | `READY` (P1 baseline) | Bins, staging locations, routing, and manufacturing resources remain out of scope |
| Document and lifecycle | Owner-local orders, reservations, transfers, journals, cancellation, fulfillment, and reversal | `READY` (bounded P2 baseline) | New document families need owner-specific identity, lifecycle, correction, and version decisions |
| Quantity and movement | Non-negative balances, concurrent reservations/transfers, UOM validation, append-oriented corrections | `READY` (P1 baseline) | Lot/serial, valuation, and fractional quantity remain out of scope |
| Money and obligation | Fixed two-decimal Legal Entity base-currency revenue posting and reversal | `READY` (bounded P2 baseline) | Tax, invoices, AP/AR, payments, FX, and settlement remain explicitly out of scope |
| Fiscal period and close | Non-overlapping open/closed periods serialize with revenue posting | `READY` (bounded P2 baseline) | Reopen, adjusting periods, arbitrary posting dates, and advanced close remain out of scope |
| Policy and authorization | Capability catalog and deny-by-default checks cover current actions | `READY` for current actions | Add approval, override, and SoD policy only with new high-risk actions |
| Audit and correlation | Messaging envelopes preserve actor, Tenant, command, correlation, causation, idempotency, and time | `READY` (bounded P3 baseline) | Deployment retention duration and external-provider audit remain gated operational decisions |
| Typed actions and events | Inventory publishes a PUBLIC v1 action/event pair; Accounting publishes its owner-controlled PUBLIC revenue event | `READY` for the bounded P3 baseline | Accounting revenue action release remains gated on owner-verifiable amount provenance; future Process Studio owns aggregation/release |
| Compensation and recovery | Order cancellation releases reservations and reverses revenue; fulfillment and manual recovery are explicit | `READY` (bounded lifecycle) | Returns, credits, and external compensation require later owner decisions |

## Decision Order

### P0 — Scope and User Accounts

**P0 baseline status: `READY`.** All P0-01 through P0-10 tasks have public contracts and executable proof. Deployment of historical databases remains conditional on the explicit operator-supplied identifier and Legal Entity mappings described below; readiness does not authorize inferred backfills.

The initial scope and user-account decisions are recorded in
[`../decisions/0021-define-p0-scope-and-identity-model.md`](../decisions/0021-define-p0-scope-and-identity-model.md).
Public user-account and Party vocabulary follows
[`../decisions/0029-rename-user-and-party-public-vocabulary.md`](../decisions/0029-rename-user-and-party-public-vocabulary.md).
The first implementation slice covers tenant timezone, Organization,
Legal Entity, optional Branch, Warehouse and accounting Legal Entity scope,
PartyRepresentation, scoped external identifiers, and the bootstrap
vertical slice. Advanced localization, journal policy, and legacy deployment
upgrades remain bounded follow-up work.

Resolve before adding cross-domain business flows:

```text
tenant
legal entity/company
branch
warehouse/location
party/customer/supplier
internal vs external identifiers
currency and timezone scope
```

Exit criteria:

- ownership is assigned for each scope fact;
- composite references cannot cross tenant or organization boundaries;
- public contracts use stable internal identifiers;
- external identifiers are attached through the owning domain;
- an ADR exists for any difficult-to-reverse identity or organization choice.

### P0 Implementation Task Board

Complete these tasks in order. Each task requires implementation evidence and
focused contract, database, authorization, or integration tests; a completed
schema or migration alone is not sufficient.

| ID | Task | Required proof |
|---|---|---|
| `P0-01` | Freeze vocabulary and ownership for Tenant, UserAccount, Party, Organization, Legal Entity, Branch, Warehouse, currency, and timezone. | Ownership matrix, public terminology, and no unresolved P0 naming collision. |
| `P0-02` | Harden tenant and legal-entity isolation. | Composite foreign keys, unique constraints, and negative tests reject cross-tenant and cross-legal-entity references. |
| `P0-03` | Complete UserAccount membership and capability context. | One UserAccount can access multiple Tenants through separate memberships; PartyRepresentation never grants authorization by itself. |
| `P0-04` | Implement Organization and Legal Entity lifecycle. | Owner-local commands, one-to-one Organization/Legal Entity constraint, tenant-scoped administration, and tagged failure tests. |
| `P0-05` | Implement Branch scope and local metadata. | Branch is optional and operational/reporting scoped; timezone overrides, local tax registration, and dedicated journals are possible without creating an independent ledger, fiscal period, or base currency. |
| `P0-06` | Bind Warehouse and stock ownership to Legal Entity. | A Warehouse has one authoritative Legal Entity owner, an optional primary Branch association, and stock cannot cross Legal Entity scope without an explicit transfer. |
| `P0-07` | Complete Legal Entity accounting configuration. | Accounting owns base currency, precision, fiscal period, and posting configuration; Branch cannot override those authorities. |
| `P0-08` | Complete PartyRole and PartyRelationship contracts. | One tenant-scoped Party may be customer and supplier; Legal Entity relationships carry eligibility and terms without becoming authorization grants. |
| `P0-09` | Stabilize identifiers and public contracts. | Internal IDs remain stable and opaque; external IDs are scoped to provider/tenant/Legal Entity; Effect Schema commands, outputs, and failures have contract tests. |
| `P0-10` | Prove the bootstrap vertical slice and failure boundaries. | Tenant → Party → Legal Entity → Branch → accounting configuration → Warehouse succeeds; duplicate, unauthorized, cross-tenant, cross-entity, and conflicting external-ID cases fail with typed errors. |

P0 is `READY` only when all ten tasks have executable proof. The bootstrap
coordinator may compose owner-local commands but must not become a new domain
owner or universal persistence model.

Current implementation evidence: P0-01, P0-02, P0-03, P0-04, P0-06, P0-07,
P0-08, and P0-10 have owner-local contracts, constraints, and tests. P0-03
now has explicit UserAccount lifecycle, tenant membership persistence,
membership-aware capability checks, PartyRepresentation persistence, and
capability checks. ADR-0031 is implemented for the current modules with a
canonical catalog, owner declarations, validator, capability grant migration,
and compatibility tests. P0-05
stores branch-local tax-registration and dedicated-journal metadata without
moving tax or journal ownership into `party`. P0-09 has an explicit mapping
backfill command. Legacy databases still require an operator-supplied mapping
before the historical non-null scope migrations can be replayed; the command
fails closed rather than inferring ownership.

The `P0-06` migration does not infer Legal Entity ownership for existing
warehouse or transfer rows. Deployments with existing inventory data need an
explicit, reviewed backfill in the deployment migration; this migration fails
closed rather than inventing ownership.

The initial `P0-07` configuration is one accounting-owned row per tenant and
Legal Entity with a three-letter base-currency code, decimal precision,
fiscal-year start month, and posting-enabled flag. Fiscal close/reopen and
jurisdiction-specific currency rules remain out of scope.

The initial `P0-08` relationship is tenant-scoped to one Party and one Legal
Entity, reuses a PartyRole kind, requires that role to be assigned first, and
starts active. It is a business eligibility relationship, not an authorization
grant.

The `P0-09` identifier migration requires an explicit provider backfill for
existing identifier rows; it does not invent a provider or Legal Entity scope.
Tenant-wide identifiers use a separate uniqueness path from Legal Entity-scoped
identifiers.

The `P0-10` bootstrap proof lives in the application composition layer. It is a
trusted, non-self-service sequence that grants the bootstrap principal the
minimum tenant capabilities and then invokes owner-local Party, Accounting, and
Inventory commands. It does not write domain tables directly or expose a
bootstrap HTTP endpoint. The current public services do not carry a reusable
cross-domain transaction context, so this proof covers sequencing and typed
failure boundaries; atomic rollback across domains remains a separate
transaction-contract requirement.

### P1 — Product, Quantity, and Location

The baseline is decided by
[`../decisions/0035-define-p1-inventory-primitives.md`](../decisions/0035-define-p1-inventory-primitives.md): Inventory owns discrete stock Items with one immutable stock UOM, whole-number quantities, Warehouse-level location, no negative stock, and append-oriented corrections. Unit conversion, fractional stock, bins, lot/serial traceability, and valuation remain explicitly out of scope until required.

Resolve before adding procurement, manufacturing, or advanced inventory actions:

```text
product vs service
SKU and classification
unit of measure and conversion
warehouse and location hierarchy
reservation and availability
lot/serial traceability
negative stock and correction policy
```

Exit criteria:

- quantity inputs and outputs have typed units;
- inventory movement facts are append-oriented or compensated;
- reservation and availability are concurrency-safe;
- location and ownership constraints are database-enforced where applicable.

### P2 — Documents and Financial Semantics

The baseline is decided by
[`../decisions/0036-define-p2-document-and-financial-baseline.md`](../decisions/0036-define-p2-document-and-financial-baseline.md): documents remain owner-local; committed economic facts are corrected by new commands and reversals; the current executable posting flow is single-Legal-Entity, base-currency, fixed two-decimal money; and tax, invoices, AP/AR, payments, settlement, reopen, and adjusting periods remain explicitly out of scope until their owners and lifecycles are decided.

Resolve before cataloging purchase, sales, billing, payment, or close actions:

```text
document identity and references
header/line semantics
currency and monetary precision
tax ownership
payable and receivable ownership
invoice/payment/settlement lifecycle
fiscal period and close
```

Exit criteria:

- document transitions have preconditions, effects, authorization, and retry behavior;
- accounting facts cannot be rewritten to hide correction;
- financial actions declare reversal or manual recovery;
- period rules are enforced transactionally.

### P3 — Audit, Events, and Integration

**P3 baseline status: `READY` for the bounded PostgreSQL-internal baseline.** Inventory stock correction and Accounting revenue posting publish owner-controlled PUBLIC v1 events atomically; Process publishes only its own confirmation, cancellation, and fulfillment lifecycle facts; completed consumer receipts make PostgreSQL-local delivery duplicate-safe. PgQue activation, external connectors, Process event waits, and deployment-specific retention remain gated and are not implied by this status.

The baseline is decided by
[`../decisions/0037-define-p3-audit-event-and-delivery-boundary.md`](../decisions/0037-define-p3-audit-event-and-delivery-boundary.md) and
[`../decisions/0038-move-internal-event-delivery-to-messaging.md`](../decisions/0038-move-internal-event-delivery-to-messaging.md): owner-domain facts remain business audit authority; Messaging owns shared envelope/outbox/receipt infrastructure; catalog declarations remain domain-owned through a neutral typed contributor contract; delivery is at-least-once with durable consumer receipts; payloads are minimized and redacted; and PgQue plus external connectors remain behind their existing activation gates.

Resolve before durable process execution:

```text
audit event ownership
correlation and causation
Typed Event Catalog
external adapter identity and version
outbox and delivery semantics
redaction and retention
```

Exit criteria:

- committed facts publish typed versioned events atomically where required;
- consumers and process waits are idempotent;
- audit records preserve actor, tenant, command, state, and correlation;
- external standards remain behind versioned integration adapters.

## What Must Not Be Added Yet

Do not add these merely because they are common in other ERP products:

```text
lot/serial tracking
multiple currencies
tax localization
valuation layers
manufacturing
HR/payroll
asset management
advanced approvals
AI/RPA
full BPMN/DMN semantics
```

They become roadmap work only when the primitive decision is relevant to a
requested capability and its evidence, ownership, contract, and proof strategy
are defined.

## Primitive Readiness Test

A primitive is `READY` only if all answers are explicit:

```text
Who owns the invariant?
What are the public inputs and outputs?
What tenant/organization scope applies?
What constraints protect the final state?
What commands change it?
What events expose committed facts?
What authorization is required?
What happens under retry and concurrency?
How is a committed effect corrected?
What is the smallest executable proof?
```
