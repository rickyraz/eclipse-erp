# ADR-0045: Define Procurement Purchase Order Confirmation

- Status: Accepted
- Date: 2026-08-22
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Draft Purchase Order baseline:
>   [`./0044-define-procurement-purchase-order-baseline.md`](./0044-define-procurement-purchase-order-baseline.md)
> - P2 document baseline:
>   [`./0036-define-p2-document-and-financial-baseline.md`](./0036-define-p2-document-and-financial-baseline.md)
> - Domain maturity roadmap: [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md)

## Context

ADR-0044 introduced atomic draft Purchase Orders but deliberately left commitment, correction, and
external effects undecided. Procurement needs one stable internal transition before receipt or other
purchase-to-pay work can reference a committed document snapshot.

Treating confirmation as supplier acceptance, stock authorization, payable creation, or external
transmission would combine several owners and protocols that remain gated. Leaving retry and
immutability undefined would allow duplicate or mutable commitments.

## Decision

### Internal confirmation meaning

Procurement owns the transition:

```text
draft -> confirmed
```

`confirmed` means an authorized internal Procurement commitment to the exact Supplier Account, line
snapshots, and derived total. It does not mean that the supplier accepted or received the order, and
it creates no Inventory, receipt, invoice, payable, Accounting, payment, external-delivery, event, or
Process Studio effect.

The public read contract returns both draft and confirmed orders. Read and confirmation use separate
tenant-scoped capabilities:

```text
procurement.purchase_order.read
procurement.purchase_order.confirm
```

### Idempotency and concurrency

Confirmation requires a nonblank idempotency identity unique within the Tenant. The exact same order
and identity returns the original confirmed result. Reusing the identity for another order, or using
a different identity after the order was confirmed, fails with a typed idempotency conflict.

The owning transaction locks the Purchase Order before evaluating its state. Concurrent retries with
the same identity converge on one confirmation and one timestamp. A lost response is retried with the
same identity or inspected through the read contract; it is not permission to create another
confirmation identity.

### Confirmed snapshot integrity

Confirmation records `confirmedAt` and freezes the Supplier Account, lines, quantities, unit prices,
derived total, order identity, and confirmation metadata. PostgreSQL enforces:

- every order starts in `draft`;
- only `draft -> confirmed` is valid;
- status and confirmation metadata agree;
- confirmed headers and lines are immutable;
- a confirmed order has at least one line and its stored total exactly equals the line-derived total.

Draft rows remain non-authoritative and may be replaced by a future explicit amendment contract.
There is no draft update command in this slice.

### Correction boundary

This decision does not add cancellation, amendment, release, supplier acceptance, or reversal.
Confirmation has no external or financial effect, but a cancellation/correction contract must be
decided before receipt, external publication, Process Studio registration, or any downstream action
can treat a confirmed Purchase Order as actionable.

## Alternatives Considered

### Confirm and reserve stock atomically

Rejected. Purchase commitment and Inventory reservation are different owner contracts, and the
cross-domain transaction path required for that invariant is not paved here.

### Publish a confirmed event immediately

Rejected. The action remains below Process-provider maturity until correction, event meaning,
correlation, and downstream consumption are decided.

### Accept repeated confirmation with any key

Rejected. It would make a lost response indistinguishable from a new intent and weaken duplicate
protection.

### Keep confirmed orders editable

Rejected. Downstream receipt or matching cannot safely reference a commitment whose lines or total
can change without a new version or correcting command.

## Consequences

### Positive

- Procurement gains one stable, tenant-safe committed document snapshot.
- Retry and concurrent confirmation behavior is deterministic.
- Database triggers protect immutability and derived-total consistency.
- Receipt design can reference a stable owner-controlled order without gaining stock authority.

### Negative

- Confirmed orders cannot yet be canceled or amended.
- No supplier communication or acceptance state exists.
- Confirmation remains private to the Procurement contract and emits no event.
- The capability is not Process Studio-ready.

### Risks

- Callers may mislabel internal confirmation as supplier acceptance.
- Receipt work started before cancellation and correction are decided could strand unusable orders.
- A future amendment model may require document versions rather than editing the confirmed row.

## Validation

- Contract tests prove read authorization, same-key replay, different-key and cross-order conflicts,
  tenant isolation, and canonical confirmation timestamps.
- PostgreSQL tests prove row-lock concurrency, metadata constraints, legal state transitions,
  confirmed header and line immutability, and exact confirmed totals.
- Migration, capability, boundary, and dependency checks keep persistence private and prevent new
  Inventory, Accounting, Messaging, Process, API, or integration dependencies.
- Roadmap documentation keeps cancellation, receipt, return, invoice matching, events, and Process
  Studio publication gated.
