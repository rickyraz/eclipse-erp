# Procurement Architecture

> **Status:** Canonical
>
> **Owns:** Procurement domain authority, Supplier Account identity, Purchase Order contracts and
> lifecycle, owner-local correction semantics, transaction and idempotency rules, and the gates for
> receipt, return, invoice matching, events, and Process Studio publication.
>
> **Related documents**
>
> - Canonical architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Integration architecture: [`./integration-architecture.md`](./integration-architecture.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - P2 document baseline:
>   [`../decisions/0036-define-p2-document-and-financial-baseline.md`](../decisions/0036-define-p2-document-and-financial-baseline.md)
> - Initial Purchase Order decision:
>   [`../decisions/0044-define-procurement-purchase-order-baseline.md`](../decisions/0044-define-procurement-purchase-order-baseline.md)
> - Confirmation decision:
>   [`../decisions/0045-define-procurement-purchase-order-confirmation.md`](../decisions/0045-define-procurement-purchase-order-confirmation.md)
> - Goods Receipt decision:
>   [`../decisions/0047-define-procurement-goods-receipt-boundary.md`](../decisions/0047-define-procurement-goods-receipt-boundary.md)
> - Domain maturity roadmap: [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md)

## Position

Procurement owns purchase intent and its internal business documents. It does not acquire authority
merely because a Purchase Order contains references used by another domain.

The implemented bounded scope is:

```text
Party supplier relationship
        |
        v
Procurement SupplierAccount
        |
        v
PurchaseOrder: draft -> confirmed -> cancelled
```

This lifecycle is internal. Confirmation is not supplier acceptance or delivery. Cancellation is not
supplier acknowledgement, stock release, receipt reversal, invoice voiding, or financial reversal.

The current scope deliberately excludes sourcing, requisitions, approvals, blanket agreements,
price catalogs, tax, multi-currency, supplier communication, return, invoice matching, payables,
settlement, events, API exposure, and Process Studio publication. Goods Receipt is implemented only
as the bounded synchronous receipt boundary described below.

## Authority Matrix

| Fact or responsibility | Authority | Current rule |
| --- | --- | --- |
| Party identity, supplier role, Legal Entity, supplier relationship | Party | Procurement consumes the public Party relationship contract |
| Tenant-local usable supplier identity | Procurement `SupplierAccount` | References one active Party supplier relationship |
| Purchase Order identity, status, lines, and derived total | Procurement | PostgreSQL-backed owner state |
| Purchase Order authorization and lifecycle policy | Procurement + Authorization | Separate create, read, confirm, and cancel capabilities |
| Item identity on current Purchase Order lines | Opaque external identity | No Inventory foreign key or availability claim exists |
| Physical stock, warehouse balance, reservation, and movement | Inventory | Purchase Order state never changes stock |
| Receipt business evidence | Procurement | Immutable Goods Receipt evidence with cumulative line allocation |
| Supplier invoice and matching authority | Undecided | Remains gated |
| Payable, journal, balance, and settlement authority | Accounting/financial owner | Procurement creates no financial fact |
| External supplier transmission and acknowledgement | Integrations plus Procurement contract | Not implemented |
| Goods Receipt physical movement | Inventory | Procurement invokes public Inventory receipt contract; no cross-table write |
| Process-visible action/event metadata | Owning domain catalog | Procurement publishes none today |

No package may mutate Procurement tables except Procurement. Procurement must not mutate Party,
Inventory, Billing, Accounting, Messaging, Process, or integration tables directly.

## Aggregate Model

### SupplierAccount

`SupplierAccount` is the Procurement-owned, tenant-local identity for a supplier relationship.

Required properties:

- opaque UUID identity;
- Tenant identity;
- one Party-owned supplier relationship;
- resolved Party and Legal Entity facts returned through the Party public contract;
- at most one Supplier Account for the same Tenant and supplier relationship.

A missing, foreign-Tenant, inactive, or non-supplier relationship is not eligible. Party remains the
authority for relationship kind and activity.

### PurchaseOrder

A Purchase Order contains:

- opaque UUID identity;
- Tenant identity;
- one tenant-local Supplier Account;
- status: `draft`, `confirmed`, or `cancelled`;
- zero confirmation metadata while draft;
- one immutable confirmation identity and `confirmedAt` after confirmation;
- at least one line;
- stable server-owned opaque UUID identity for each line;
- line snapshots containing opaque item UUID, positive PostgreSQL-bigint quantity, and exact
  non-negative two-decimal unit price;
- an exact owner-derived two-decimal total.

The public snapshot exposes stable line identity because future receipt evidence must reference an
immutable order line. Create input never accepts or controls that identity. Confirmation idempotency
metadata, private update timestamps, database constraint names, and driver failures remain private.

The current model has no line position, unit-of-measure registry, currency, tax, discount, requested
delivery date, warehouse, receipt quantity, supplier document number, amendment version, or
replacement link. Those fields must not be inferred from generic ERP expectations.

## Purchase Order Lifecycle

```text
absent -> draft -> confirmed -> cancelled
```

All other transitions are invalid.

| Transition or query | Preconditions | Effect | Capability | Retry behavior | Public business failure |
| --- | --- | --- | --- | --- | --- |
| `absent -> draft` | Supplier Account exists in the Tenant; at least one valid line | Atomically persist header and lines; derive total | `procurement.purchase_order.create` | No idempotency identity; a retry may create another draft | `SupplierAccountNotFound` |
| read | Order exists in the Tenant | Return draft, confirmed, or cancelled snapshot | `procurement.purchase_order.read` | Safe repeat | `PurchaseOrderNotFound` |
| `draft -> confirmed` | Current state is draft | Record confirmation identity and timestamp; freeze header and lines | `procurement.purchase_order.confirm` | Same key and order returns the original result; another key or order conflicts | `PurchaseOrderConfirmationIdempotencyConflict`, `PurchaseOrderInvalidState`, `PurchaseOrderNotFound` |
| `confirmed -> cancelled` | Current state is confirmed | Change only terminal status and private update timestamp | `procurement.purchase_order.cancel` | Natural idempotency: cancelled returns the existing result | `PurchaseOrderInvalidState`, `PurchaseOrderNotFound` |

A draft has no committed effect and therefore is not cancelled. A mistaken confirmed order is
corrected by cancelling it and creating a new draft. Reopening or editing a confirmed/cancelled row
is forbidden because it would hide the prior commitment.

## Contract Invariants

### Status and metadata

```text
draft     => confirmation key is absent and confirmedAt is absent
confirmed => confirmation key is nonblank and confirmedAt is present
cancelled => original confirmation key is nonblank and confirmedAt is preserved
```

The public DTO mirrors the visible part of this invariant: drafts have `confirmedAt = null`, while
confirmed and cancelled orders have a valid timestamp.

### Exact quantity and money

- Quantity is a positive decimal integer string within PostgreSQL signed `BIGINT`.
- Unit price and total use the canonical exact financial major-amount boundary.
- Application arithmetic converts unit prices to integer minor units and uses `bigint`.
- Total is derived as `sum(quantity * unit price)`; callers never supply it.
- Floating-point arithmetic and implicit rounding are forbidden.

### Snapshot integrity

After confirmation, these facts cannot change:

- order and Tenant identity;
- Supplier Account;
- confirmation identity and timestamp;
- line membership and line values;
- total and creation timestamp.

Cancellation preserves the same facts. Cancelled headers and lines are terminal and immutable.

### Tenant integrity

- All reads and writes include Tenant scope.
- Composite foreign keys prevent cross-Tenant Supplier Account and Purchase Order references.
- A foreign-Tenant order is reported as `PurchaseOrderNotFound`; existence is not disclosed.

## Transactions, Concurrency, and Idempotency

### Draft creation

Header and all lines commit in one `Database.transaction`. Any line or constraint failure rolls back
the header. The database foreign key is the final Supplier Account existence and Tenant-scope guard.

### Confirmation

Confirmation locks the header with `SELECT ... FOR UPDATE`, evaluates current state and idempotency,
and updates the row in one transaction. The Tenant-scoped unique confirmation identity prevents one
logical confirmation from naming multiple orders.

Line mutations lock the parent order in their trigger. This serializes confirmation with concurrent
line writes:

- if the line mutation locks first, confirmation observes its committed result;
- if confirmation locks first, the later line mutation observes a confirmed state and fails.

A lost confirmation response is resolved by retrying the same key or reading the order. A retry must
not invent a new key.

### Cancellation

Cancellation locks the header, checks the state, and performs `confirmed -> cancelled` in one
transaction. Concurrent cancellations serialize and converge on the same terminal result. No
cancellation idempotency key is stored because the current command has one terminal result and no
downstream side effect.

A future cancellation with external or cross-domain effects must revisit this rule before activation.

## PostgreSQL Enforcement

The Drizzle schema owns typed tables and supported constraints. Reviewed custom migrations own the
state and immutability triggers.

PostgreSQL enforces at least:

- every order starts as draft;
- only `draft -> confirmed -> cancelled` transitions are legal;
- status and confirmation metadata agree;
- confirmation identity is unique within a Tenant;
- confirmed and cancelled headers cannot be deleted or edited;
- confirmed and cancelled lines cannot be inserted, updated, moved, or deleted;
- confirmed and cancelled orders have at least one line;
- stored total exactly equals the line-derived total;
- line quantity is positive and unit price is non-negative;
- Supplier Account and order references remain tenant-local.

Known relational failures map to stable Procurement errors. Unknown database failures remain the
kernel-owned `DatabaseFailure`; raw SQL, SQLSTATE, driver objects, and constraint details never enter
the public DTO contract.

## Authorization

Procurement uses narrow business capabilities:

```text
procurement.supplier_account.create
procurement.purchase_order.create
procurement.purchase_order.read
procurement.purchase_order.confirm
procurement.purchase_order.cancel
```

Authorization occurs before protected reads or writes. Authentication does not grant Procurement
authority. The service denies by default and tests allow, deny, and Tenant-scope mismatch behavior.

The repository does not yet have a general production audit store or complete RLS policy path.
Confirmation and cancellation therefore must not be represented as providing complete actor audit
evidence beyond the current authorization decision and stored business state.

## Publication and Integration Boundary

The current Procurement package publishes no Typed Action Catalog entry and no domain event.
Purchase Order creation, confirmation, and cancellation do not write a Messaging outbox record.

Do not add an event merely because a state changes. Publication requires:

- a named committed business fact;
- versioned payload and compatibility policy;
- correlation, causation, actor, and idempotency semantics;
- correction meaning;
- an approved consumer or Process Studio use case;
- atomic owner transaction plus Messaging contract invocation.

External supplier delivery additionally requires the integration architecture's timeout, retry,
unknown-outcome, provider-status, credential, and compensation rules.

## Goods Receipt Boundary

Goods Receipt is active as a bounded Level 2 Procurement capability through
`procurement.purchase_receipt.receive`. Procurement owns immutable receipt evidence and cumulative
allocation; Inventory owns physical movement and stock balance. Neither domain writes the other's
tables.

The selected contract is:

1. Only confirmed Purchase Orders are eligible. Draft and cancelled orders reject receipt work.
2. Purchase Order line identity is server-owned. The line's item identity must resolve to a tenant-local
   Inventory Item when the receipt creates physical stock.
3. One receipt uses one tenant-local Warehouse aligned with the Purchase Order Supplier Account's
   Legal Entity. Inventory validates the warehouse scope inside the shared PostgreSQL transaction.
4. Partial and repeated receipts are allowed. Cumulative quantity may not exceed the confirmed line
   quantity; over-receipt and duplicate line IDs are rejected.
5. Receipt quantities are positive whole-number quantities in the Inventory Item's immutable stock UOM.
6. The Tenant-scoped idempotency key returns the original receipt for the same input and rejects
   conflicting reuse.
7. Receipt locks the Purchase Order before checking status and cumulative quantities. Cancellation
   locks the same row and is rejected after any receipt evidence exists until a later return/reversal
   contract exists.
8. Procurement creates receipt evidence and invokes Inventory's public `receiveStock` contract in
   one PostgreSQL transaction. Inventory records the receipt ID as movement provenance.
9. A lost response is retried with the same idempotency key. No external unknown-outcome protocol is
   introduced because the bounded operation is PostgreSQL-local.
10. Receipt reversal, Purchase Return, invoice matching, events, API exposure, external documents,
    and Process Studio publication remain separate gates.

The implementation and rationale are defined by
[`ADR-0047`](../decisions/0047-define-procurement-goods-receipt-boundary.md). An Effect fiber, request
lifetime, or eventual event is not the durability mechanism for the synchronous stock invariant.

## Invoice Matching and Payables Gate

Three-way matching, supplier invoice ownership, payable creation, tax, currency, payment, and
settlement are not selected. They require explicit Procurement, Billing, Accounting, and financial
ledger boundaries. A Purchase Order total is not by itself a payable or journal fact.

## Maturity

The bounded Supplier Account, Purchase Order, and Goods Receipt lifecycle remains Level 2:

- public Effect Schema contracts and typed failures;
- tenant-aware authorization;
- atomic draft, confirmation, cancellation, and receipt persistence;
- database constraints and immutability triggers;
- confirmation and receipt idempotency with row-lock concurrency;
- receipt quantity allocation and Inventory movement provenance;
- rollback and PostgreSQL invariant tests;
- explicit owner-local correction and return gates.

Procurement is not Level 3 because it publishes no stable action/event catalog, process-visible
failure contract, correlation metadata, event, or compensation metadata.

## Implementation Map

| Concern | Owner path |
| --- | --- |
| Public service, DTOs, errors, and test layer | `packages/procurement/src/service.ts` |
| Public package exports | `packages/procurement/mod.ts` |
| Capability constants | `packages/procurement/src/capabilities.ts` |
| Closed authorization catalog | `packages/authorization/src/capabilities.ts` |
| Drizzle schema | `db/schema/procurement.ts` |
| Migration history | `db/migrations/` |
| Contract tests | `packages/procurement/tests/procurement.test.ts` |
| PostgreSQL invariant tests | `packages/procurement/tests/procurement.postgres.test.ts` |

Persistence tables, repositories, Drizzle query types, confirmation keys, and migration helpers are
private and must not be re-exported.

## Evolution and Decision Records

This document is the canonical current-state Procurement specification. Routine owner-local contract
work updates this file directly together with code, schema, and tests.

Create a new ADR only when Procurement work makes a difficult-to-reverse decision such as:

- moving authority between domains;
- selecting a cross-domain atomicity or consistency protocol;
- activating an external provider or strategic dependency;
- changing financial or stock authority;
- publishing a compatibility-sensitive action or event contract;
- introducing document versioning that supersedes the current immutable-snapshot model.

Do not create one ADR per command, field, status, or migration when the change follows this existing
architecture. Historical ADRs explain why the baseline was selected; this specification owns the
complete current behavior.
