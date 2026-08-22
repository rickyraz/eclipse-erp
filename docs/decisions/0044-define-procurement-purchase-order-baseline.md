# ADR-0044: Define the Procurement Purchase Order Baseline

- Status: Accepted
- Date: 2026-08-22
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - P2 document baseline:
>   [`./0036-define-p2-document-and-financial-baseline.md`](./0036-define-p2-document-and-financial-baseline.md)
> - P1 inventory baseline:
>   [`./0035-define-p1-inventory-primitives.md`](./0035-define-p1-inventory-primitives.md)
> - ERP primitive roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
> - Domain maturity roadmap: [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md)

## Context

Procurement now owns `SupplierAccount` identity over a Party-owned supplier relationship. The next
roadmap step is purchase document semantics, but ADR-0036 deliberately leaves new document families
out of scope until their owner, identity, lifecycle, correction, and version behavior are decided.

Implementing receipt, approval, supplier acceptance, invoice matching, payables, or accounting now
would invent unresolved purchase-to-pay policy. Leaving even draft purchase documents undefined would
instead encourage caller-owned totals, cross-domain table access, or a generic shared document model.

## Decision

### Ownership and identity

Procurement owns the `PurchaseOrder` header, line snapshots, draft status, and derived total. A
Purchase Order uses an opaque UUID and belongs to one Tenant and one tenant-scoped `SupplierAccount`.
The Supplier Account remains the typed link to Party-owned supplier and Legal Entity scope.

Purchase Order lines contain an opaque item UUID, a positive whole-number quantity, and an exact
non-negative amount within the fixed two-decimal storage scale. This baseline does not require an
Inventory foreign key or claim stock availability, reservation, valuation, or unit conversion.

### Initial lifecycle

The only selected transition is:

```text
absent -> draft
```

Creation requires `procurement.purchase_order.create`, a tenant-local Supplier Account, and at least
one valid line. The owner derives the total with integer minor-unit arithmetic and persists the header
and all lines in one PostgreSQL transaction.

`draft` has no committed stock, payable, accounting, supplier, or external effect. The initial status
vocabulary contains only `draft`; a later ADR must decide confirmation or approval, amendment and
versioning, cancellation and correction, supplier communication, and terminal states before adding
those transitions.

### Retry and correction

Draft creation has no idempotency key in this baseline. Repeating the command creates another draft,
matching the existing owner-local Sales draft-creation behavior. Callers must not treat an unknown
response as proof that no draft was created.

A draft has no correction command because no committed economic fact exists. Before any transition
freezes lines or creates external consequences, Procurement must define idempotency, concurrency,
immutability, correction or cancellation, and manual-recovery behavior.

### Scope boundary

This decision does not add:

- requisitions, sourcing, quotations, tenders, or approvals;
- receipt, return, warehouse, reservation, or stock movement behavior;
- supplier invoices, tax, three-way matching, payables, payment, settlement, or Accounting effects;
- events, jobs, Process Studio catalog entries, API routes, UI, numbering, provider references, or
  external delivery.

## Alternatives Considered

### Reuse the Sales order aggregate

Rejected. Sales and Procurement own different parties, policies, effects, and correction lifecycles.
They may share primitive shapes without sharing mutable authority.

### Create a generic document package

Rejected by ADR-0036. A universal document owner would centralize unrelated lifecycle invariants and
become a competing source of truth.

### Add confirmation and receipt immediately

Rejected. Those transitions require explicit stock, supplier, correction, idempotency, and event
semantics that the roadmap still gates.

### Require Inventory item validation for a draft

Rejected for this baseline. The line is an owner-local draft snapshot with no inventory effect, and
the existing Sales draft contract also keeps item identity opaque. Validation may be added before a
committed transition if that transition requires current Inventory authority.

## Consequences

### Positive

- Procurement gains one bounded purchase document without inventing purchase-to-pay policy.
- Supplier scope and tenant isolation are database-enforced.
- Header and line creation is atomic and the total is never caller-supplied.
- Later lifecycle work has an explicit decision gate.

### Negative

- Duplicate create retries can produce multiple drafts.
- Drafts cannot yet be confirmed, amended, canceled, sent, received, returned, or matched.
- Item identity is not validated against current Inventory state.
- The draft total is not an authoritative payable, posting, tax, or settlement amount.

### Risks

- A later lifecycle may require display numbering, currency versioning, delivery terms, or line
  amendment history.
- Treating draft totals as committed commercial facts would exceed this decision.
- Adding receipt behavior before stock and correction contracts are decided could duplicate Inventory
  authority.

## Validation

- Contract tests prove non-empty validated lines, exact derived totals, authorization denial, and
  tenant-scoped Supplier Account failures.
- PostgreSQL tests prove composite tenant foreign keys, line constraints, and atomic rollback after an
  intermediate line-write failure.
- Migration, capability, dependency, and boundary checks prove Procurement remains the sole owner and
  exposes no persistence types.
- Public exports and the roadmap keep confirmation, receipt, invoice matching, Accounting effects,
  events, and Process Studio publication unavailable; no catalog entry is introduced.
