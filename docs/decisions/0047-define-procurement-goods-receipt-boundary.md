# ADR-0047: Define the Procurement Goods Receipt Boundary

- Status: Accepted
- Date: 2026-08-22
- Amends: ADR-0044, ADR-0045
- Compatible with: ADR-0015, ADR-0036, ADR-0040, ADR-0046
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Procurement architecture: [`../architecture/procurement.md`](../architecture/procurement.md)
> - P1 inventory primitives: [`./0035-define-p1-inventory-primitives.md`](./0035-define-p1-inventory-primitives.md)
> - P2 document and financial baseline: [`./0036-define-p2-document-and-financial-baseline.md`](./0036-define-p2-document-and-financial-baseline.md)
> - Semantic invariant ownership: [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)
> - Owner-local business surface: [`./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md`](./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md)

## Context

Procurement has an owner-local, confirmed Purchase Order with immutable line identity. Goods Receipt
is the next meaningful business surface, but it crosses two invariant owners:

```text
Procurement -> receipt evidence and cumulative receipt allocation
Inventory   -> physical stock movement, warehouse scope, and stock balance
```

Using the existing generic Inventory receipt command without provenance, Purchase Order line
validation, idempotency, or legal-entity scope would allow stock to be received without durable
procurement evidence and would make retries difficult to reason about. Adding receipt behavior also
changes the meaning of Purchase Order cancellation: a confirmed order with received goods cannot be
silently cancelled while leaving physical stock and receipt evidence behind.

This ADR resolves the entire bounded receipt boundary in one decision instead of creating separate
ADRs for each field or transition.

## Decision

### Ownership

Procurement owns:

- `GoodsReceipt` identity and immutable header/line evidence;
- the link from a receipt to one confirmed Purchase Order;
- receipt idempotency and cumulative allocation against Purchase Order lines;
- receipt eligibility and the rule that a Purchase Order with receipt evidence cannot be cancelled;
- receipt-facing domain failures and correction gating.

Inventory owns:

- current Item identity and unit of measure;
- Warehouse and Legal Entity scope;
- physical stock movement and stock balances;
- the receipt movement provenance reference supplied by Procurement.

Neither domain writes the other's tables. Procurement invokes the public Inventory service inside the
same PostgreSQL transaction through the existing ambient transaction boundary.

### Business surface and command

The bounded public operation is:

```text
procurement.purchase_receipt.receive
```

It accepts:

```text
Tenant
PurchaseOrderId
WarehouseId
IdempotencyKey
[{ PurchaseOrderLineId, Quantity }]
```

The operation creates one immutable `GoodsReceipt` evidence record. The `itemId` is derived from the
confirmed Purchase Order line rather than accepted from the caller. A draft PO may retain an opaque
item identity, but a receipt requires that identity to resolve to a tenant-local Inventory Item at the
Inventory boundary.

The receipt uses one Warehouse for all lines. The Warehouse must belong to the Supplier Account's
Legal Entity. Inventory validates this scope inside the same transaction.

### Eligibility and quantities

- Only `confirmed` Purchase Orders may be received.
- `draft` and `cancelled` Purchase Orders reject receipt commands.
- Partial receipts are allowed.
- Multiple receipts are allowed for the same Purchase Order line.
- Cumulative received quantity may not exceed the confirmed line quantity.
- Over-receipt is rejected; no tolerance, substitution, or automatic amendment is introduced.
- Receipt quantities are positive whole-number quantities in the Inventory Item's immutable stock UOM.
- Duplicate line IDs within one receipt are rejected.
- Every referenced line must belong to the selected tenant-local Purchase Order.

The receipt line stores the resolved Item identity and Inventory-reported UOM as evidence. It does not
make Procurement the owner of current Item metadata or UOM conversion.

### Idempotency and concurrency

The idempotency key is unique within the Tenant. Repeating the same Purchase Order, Warehouse,
line set, quantities, and key returns the original `GoodsReceipt`. Reusing the key with different
inputs returns a typed conflict.

The receipt transaction locks the Purchase Order before checking status and cumulative receipt
quantities. Purchase Order cancellation locks the same row and rejects cancellation when any receipt
evidence exists. This serializes receipt eligibility with cancellation without introducing a new
state such as `partially_received`.

Receipt evidence and all Inventory movements commit or roll back together. A lost response is retried
with the same idempotency key; no new receipt identity is generated for the same logical command.

### Corrections and scope

This decision does not implement receipt reversal, Purchase Return, supplier invoice matching,
payables, tax, payment, settlement, or financial posting. A Purchase Order with receipt evidence
cannot be cancelled until a later correction contract defines how the receipt and physical movement
are reversed or returned.

Receipt publication, Process Studio catalog registration, HTTP exposure, and external UBL/Peppol
representation remain separate maturity gates. The initial implementation exposes the typed domain
contract and tests only.

### Inventory contract extension

Inventory's existing `receiveStock` contract accepts optional:

- `legalEntityId` for warehouse scope validation;
- `referenceId` for movement provenance.

Generic callers that omit these values retain the existing behavior. Procurement supplies both values
for a Goods Receipt. Inventory remains responsible for movement and balance correctness.

## Alternatives Considered

### Use the generic Inventory receipt command without Procurement evidence

Rejected because stock could be received without a durable Purchase Order receipt, and retries could
not be reconciled to a business document.

### Add a shared cross-domain Receipt or Document package

Rejected because Procurement owns receipt evidence while Inventory owns movement. A shared package
would become a second authority model.

### Add an Inventory foreign key to every Purchase Order draft line

Rejected for the bounded slice. Draft Purchase Orders retain their existing opaque item identity and
no current-stock claim. Inventory resolution is required only when a committed receipt creates a
physical effect.

### Allow over-receipt or automatic Purchase Order amendment

Rejected because no tolerance, supplier discrepancy, amendment, valuation, or approval policy exists.
The conservative baseline rejects over-receipt.

### Make receipt asynchronous through an event or job

Rejected for the initial synchronous invariant. Receipt evidence and stock movement must be committed
together before success. Future fan-out events may follow the committed fact.

## Consequences

### Positive

- Goods Receipt becomes a concrete business surface without moving Inventory ownership into
  Procurement.
- Receipt retries are deterministic and cannot duplicate a committed receipt through the public
  command path.
- PO cancellation and receipt concurrency have one lock order and an explicit correction boundary.
- Inventory movements retain Procurement receipt provenance.
- No invoice, payment, settlement, external document, or workflow semantics are invented.

### Negative

- A Purchase Order cannot be cancelled after the first receipt until a return/reversal contract exists.
- Receipt currently uses one Warehouse per command.
- Over-receipt and unit conversion are not supported.
- The domain contract is not yet a Process Studio or HTTP provider.

### Risks

- A future supplier-item mapping may require a versioned mapping contract rather than reusing opaque
  Purchase Order item IDs.
- Receipt reversal must coordinate Procurement evidence and Inventory movement without dual authority.
- Generic Inventory receipt callers remain non-idempotent when they omit a provenance reference; only
  the Goods Receipt command promises receipt-level idempotency.

## Validation

The implementation must prove:

- confirmed-only eligibility and cancelled/draft rejection;
- tenant and Legal Entity scope;
- missing Inventory Item or Warehouse failure without partial mutation;
- partial and repeated receipt success;
- over-receipt and duplicate-line rejection;
- same-key replay and different-input conflict;
- cancellation rejection after receipt evidence;
- rollback of Procurement evidence when Inventory movement fails;
- Inventory movement provenance references the Goods Receipt;
- public exports, capability checks, migrations, dependency checks, and typed failures remain stable.

The bounded action remains below Process Studio provider maturity until its event, catalog, API,
correction, and operational delivery contracts are separately proven.
