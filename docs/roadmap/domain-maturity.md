# Domain Maturity Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Owns:** readiness sequencing for EclipseERP packages that may publish
> process-facing commands and events.
>
> **Detailed domain rules belong to:** each package’s public contract, schema,
> tests, and canonical subsystem architecture.

> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - ERP primitive decisions: [`./erp-primitives.md`](./erp-primitives.md)
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Process Studio architecture: [`../architecture/process-studio.md`](../architecture/process-studio.md)

## Readiness Rule

A package is a Process Studio capability provider only when a requested action
has a stable public contract and executable invariant proof. A package directory
or table is not evidence of domain maturity.

Each provider must expose, as applicable:

```text
public command/query contract
Effect Schema input/output
stable tagged failures
capability and tenant scope
transaction and concurrency semantics
idempotency and retry behavior
compensation or manual recovery
versioned event contract
contract and database tests
```

## Current Package Posture

| Package | Current role | Readiness | Roadmap action |
|---|---|---:|---|
| `kernel` | database, transaction, migration, infrastructure failures | `FOUNDATION` | stabilize transaction context, capability-level failures, probes, and recovery tests |
| `auth` | authentication principals and sessions | `FOUNDATION` | preserve separation from authorization and expose only public identity contracts |
| `authorization` | scoped capability decisions | `FOUNDATION` | add capabilities only with protected business actions and denial tests |
| `identity` | identity domain | `PARTIAL` | clarify identity lifecycle and external identity boundaries |
| `party` | party and party relationships | `PARTIAL` | mature customer/supplier/employee roles and relationship contracts |
| `inventory` | items, warehouses, balances, movements, reservations, transfers | `PARTIAL` | decide UOM, traceability, valuation, correction, and publish typed actions/events |
| `accounting` | accounts and journal posting | `PARTIAL` | add period, close, AP/AR, payment, tax, and reversal semantics only when decided |
| `sales` | customers, quotations, sales orders | `PARTIAL` | decide fulfillment, invoicing, credit policy, and customer-facing events |
| `procurement` | registered schema owner, package scaffold | `NOT READY` | implement supplier, sourcing, purchase, receipt, return, and invoice-match contracts |
| `billing` | package scaffold | `NOT READY` | decide invoice, payment, receivable, settlement, and accounting integration ownership |
| `integrations` | external adapter boundary | `BOUNDARY ONLY` | version standards and external identities; do not become an internal domain owner |
| `workflow` | no implemented package | `PLANNED` | create only after Process Studio primitive and runtime gates are approved |

## Maturity Levels

### Level 0 — Scaffold

A package exists or owns a schema, but it must not be registered as a Process
Studio action provider.

Required next step:

```text
owner -> public contract -> schema/invariants -> tests -> authorization
```

### Level 1 — Domain Contract

The package has:

- public commands and queries through `mod.ts`;
- Effect Schema DTOs;
- tagged business failures;
- tenant-aware ownership;
- authorization tests;
- schema and migration checks;
- package boundary compliance.

### Level 2 — Transactional Capability

The package additionally proves:

- local atomic transaction boundaries;
- database constraints;
- concurrency behavior;
- retry and idempotency behavior;
- rollback after intermediate failure;
- correction/reversal or explicit manual recovery.

### Level 3 — Process Provider

The package additionally publishes:

- versioned Typed Action Catalog entries;
- versioned Typed Event Catalog entries;
- precondition/effect metadata with a bounded vocabulary;
- process-visible failures;
- correlation and causation behavior;
- compensation metadata;
- catalog compatibility tests against public contracts.

Only Level 3 packages may appear as production Process Studio actions/events.

## Delivery Sequence

### D0 — Stabilize Existing Foundations

```text
kernel
identity
auth
authorization
party
```

Goals:

- explicit tenant and organization vocabulary;
- stable principals and scoped capabilities;
- party roles and external identifiers;
- transaction and error mapping conventions;
- audit/correlation ownership decision.

### D1 — Complete the Economic Core

```text
inventory
accounting
sales
procurement
billing
```

Goals:

- purchase-to-pay path has supplier, purchase, receipt, return, invoice, and
  settlement ownership;
- order-to-cash path has customer, order, fulfillment, invoice, payment, and
  credit-policy ownership;
- inventory movement and accounting correction semantics are explicit;
- period and close controls exist before workflow actions depend on them.

Do not implement every subfeature in one phase. Each command must pass the
primitive readiness test and have a narrow public contract.

### D2 — Publish Catalog Providers

Select a small cross-domain set, for example:

```text
inventory.stock.reserve
inventory.stock.transfer.confirm
inventory.stock.transfer.complete
accounting.journal.post
sales.order.confirm
procurement.purchase.receive
```

For every selected action:

- register a versioned catalog entry;
- register its output and failure schema;
- declare capability and tenant scope;
- declare idempotency and transaction semantics;
- declare compensation or manual recovery;
- publish a typed event when a committed fact is process-visible;
- prove catalog metadata matches the public contract.

### D3 — Add Missing Operational Domains Only by Evidence

Potential domains:

```text
manufacturing
quality
asset management
maintenance
projects
field service
HR/payroll
```

They remain `OPTIONAL` until a concrete product capability requires them. A
package is created only when it owns an invariant that cannot remain in an
existing domain.

## Domain Gate Before Workflow Runtime

Do not start a broad workflow runtime until:

```text
[ ] at least two domains reach Level 3
[ ] procurement is no longer an empty provider if purchase workflows are in scope
[ ] billing/accounting ownership is clear for financial workflows
[ ] all catalog actions have stable failures and authorization
[ ] events have typed schemas and correlation fields
[ ] compensation/manual recovery is explicit for committed effects
[ ] catalog version compatibility is tested
[ ] no provider leaks tables, repositories, or infrastructure errors
```

## Deliberate Non-Goals

This roadmap does not promise that every SAP or Odoo functional area becomes a
package. It prioritizes coherent domain ownership and end-to-end ERP correctness
over menu completeness.
