# Domain Maturity Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Owns:** readiness sequencing for RITSEI packages that may publish process-facing commands
> and events.
>
> **Detailed domain rules belong to:** each package’s public contract, schema, tests, and canonical
> subsystem architecture.

> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - ERP primitive decisions: [`./erp-primitives.md`](./erp-primitives.md)
> - Financial ledger execution: [`./financial-ledger-execution.md`](./financial-ledger-execution.md)
> - Architecture enforcement:
>   [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Process Studio architecture:
>   [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - External integration surface:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Plugin architecture:
>   [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)

## Readiness Rule

A package is a Process Studio capability provider only when a requested action has a stable public
contract and executable invariant proof. A package directory or table is not evidence of domain
maturity.

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

| Package         | Current role                                                      |                                                                                          Readiness | Roadmap action                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kernel`        | database, transaction, migration, infrastructure failures         |                                                                                       `FOUNDATION` | stabilize transaction context, capability-level failures, probes, and recovery tests                                                                                                   |
| `catalog`       | contract-only action/event declaration protocol                   |                                                                                       `FOUNDATION` | remain a dependency leaf; future Process Studio owns aggregation and release state                                                                                                     |
| `messaging`     | event envelope, transactional outbox, completed consumer receipts |                                                                                       `FOUNDATION` | add PgQue adapter only after its activation gates; never own domain event meaning                                                                                                      |
| `auth`          | authentication principals and sessions                            |                                                                                       `FOUNDATION` | preserve separation from authorization and expose only public identity contracts                                                                                                       |
| `authorization` | scoped capability decisions                                       |                                                                                       `FOUNDATION` | add capabilities only with protected business actions and denial tests                                                                                                                 |
| `identity`      | identity domain                                                   |                                                                                          `PARTIAL` | clarify identity lifecycle and external identity boundaries                                                                                                                            |
| `party`         | party and party relationships                                     |                                                                                          `PARTIAL` | mature customer/supplier/employee roles and relationship contracts                                                                                                                     |
| `inventory`     | items, warehouses, balances, movements, reservations, transfers   |                                          `PARTIAL`; `inventory.stock.adjust` v1 is a Level 3 slice | Keep broader actions private until they have catalog metadata and owner-published events; traceability and valuation remain out of scope                                               |
| `accounting`    | accounts, periods, revenue posting, and reversal                  | `PARTIAL`; `accounting.revenue.post` and `accounting.revenue.posted` v1 are bounded Level 3 slices | Keep generic journals, AP/AR, payment, tax, and settlement out of scope; migrate the bounded slice only after the financial-ledger activation gates pass |
| `sales`         | customers, quotations, sales orders                               |                                             `PARTIAL`; `sales.order.confirm` v1 is a Level 3 slice | Sales owns draft/confirmed/cancelled order state and publishes confirmation; Process coordinates fulfillment through Inventory; invoicing, returns, and credit policy remain undecided |
| `procurement`   | supplier accounts and immutable confirmed purchase orders          | `PARTIAL`; create/read are Level 1 and confirmation has transactional/idempotency proof but remains below Level 2 until correction | decide cancellation/correction next, then receipt ownership; sourcing, return, and invoice match remain gated                                      |
| `billing`       | package scaffold                                                  |                                                                                        `NOT READY` | decide invoice, payment, receivable, settlement, and accounting integration ownership                                                                                                  |
| `integrations`  | external adapter and connector boundary                           |                                                                                    `BOUNDARY ONLY` | implement versioned standards, OpenAPI/CloudEvents adapters, OAuth scopes, delivery reliability, and external action/event normalization; do not become an internal domain owner       |
| `process`       | bounded order-lifecycle application coordinator                   |                                                                                          `PARTIAL` | keep orchestration behind public domain contracts; do not treat it as Process Studio or a new domain owner                                                                             |
| `workflow`      | no implemented Process Studio runtime package                     |                                                                                          `PLANNED` | create only after Process Studio primitive and runtime gates are approved                                                                                                              |

## Maturity Levels

### Level 0 — Scaffold

A package exists or owns a schema, but it must not be registered as a Process Studio action
provider.

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
- capability stability and release state;
- versioned Typed Event Catalog entries;
- precondition/effect metadata with a bounded vocabulary;
- process-visible failures;
- correlation and causation behavior;
- compensation metadata;
- catalog compatibility tests against public contracts.

Only Level 3 capabilities may appear as production Process Studio actions/events. A package may
remain `PARTIAL` while one narrow capability satisfies Level 3; maturity is not inherited by sibling
commands.

A plugin follows the same maturity levels, with additional requirements from its trust level: owned
schema and migration isolation for trusted extensions, contributor-contract compatibility for
catalog entries, and no core-invariant access for declarative or sandboxed extensions. Plugin
installation alone never makes a capability Process Studio-ready.

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

- purchase-to-pay path has supplier, purchase, receipt, return, invoice, and settlement ownership;
- order-to-cash path has customer, order, fulfillment, invoice, payment, and credit-policy
  ownership;
- inventory movement and accounting correction semantics are explicit;
- period and close controls exist before workflow actions depend on them.

Do not implement every subfeature in one phase. Each command must pass the primitive readiness test
and have a narrow public contract.

Procurement now owns `SupplierAccount`, atomic draft creation, tenant-scoped reads, and idempotent
internal `PurchaseOrder` confirmation under ADR-0044 and ADR-0045. Confirmed line and total snapshots
are immutable but have no supplier-acceptance, stock, invoice, accounting, event, or Process Studio
effect. Cancellation/correction remains the next gate before receipt semantics.

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

They remain `OPTIONAL` until a concrete product capability requires them. A package is created only
when it owns an invariant that cannot remain in an existing domain.

## Current Level 3 Evidence

The bounded internal catalog currently has three Level 3 action slices and an additional Accounting
event contributor:

```text
inventory.stock.adjust v1
  -> PUBLIC action + inventory.stock.corrected v1
  -> owner-controlled atomic publication
  -> idempotent correction and rollback proofs

sales.order.confirm v1
  -> PUBLIC action + sales.order.confirmed v1
  -> Sales-owned line total and atomic publication
  -> authorization, idempotency, invalid-state, and rollback proofs

accounting.revenue.posted v1
  -> PUBLIC event from the owner-controlled revenue transaction
  -> accounting.revenue.post v1 is PUBLIC and uses the confirmed Sales order total as the server-derived amount
```

This satisfies the bounded Level 3 action-provider gate for Sales, Inventory, and Accounting for
bounded catalog work. It does not make all Inventory, Sales, or Accounting commands process-safe,
activate PgQue, implement external connectors, or authorize the broad workflow runtime.

## Domain Gate Before Workflow Runtime

Do not start a broad workflow runtime until:

```text
[x] at least two domains reach Level 3
[ ] procurement is no longer an empty provider if purchase workflows are in scope
[ ] billing/accounting ownership is clear for financial workflows
[x] all catalog actions have stable failures and authorization
[x] events have typed schemas and correlation fields
[x] compensation/manual recovery is explicit for committed effects
[x] catalog version compatibility is tested
[x] no provider leaks tables, repositories, or infrastructure errors
```

## Deliberate Non-Goals

This roadmap does not promise that every SAP or Odoo functional area becomes a package. It
prioritizes coherent domain ownership and end-to-end ERP correctness over menu completeness.
