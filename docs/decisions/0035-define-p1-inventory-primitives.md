# ADR-0035: Define the P1 Inventory Primitive Baseline

- Status: Accepted
- Date: 2026-08-12
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP primitive roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Semantic ownership: [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)
> - Order lifecycle: [`./0033-extend-order-lifecycle-and-gate-pgque.md`](./0033-extend-order-lifecycle-and-gate-pgque.md)

## Context

Inventory already owns items, Warehouses, balances, reservations, movements, and stock transfers,
but the repository has not selected the reusable P1 meaning of product/service identity, units,
quantity, location, negative stock, or correction. Leaving those choices implicit would freeze an
early vertical slice into Process Studio and procurement contracts without an explicit decision.

The first supported economic flow uses discrete stock items. No requested capability currently
requires unit conversion, fractional stock, bins, lot/serial traceability, or valuation layers.

## Decision

- Inventory owns the stock-managed Item contract. Services and other non-stock offerings remain
  outside Inventory until a domain with a distinct invariant requires them.
- Every Item has one immutable stock unit-of-measure code. The initial code is an uppercase,
  owner-validated symbol such as `EA`; it is carried by public Item and stock DTOs. Unit conversion
  is not supported in this baseline.
- Stock quantities are positive whole-number strings in commands and non-negative whole-number
  strings in balances. Fractional quantities require a later superseding decision and migration.
- A Warehouse is the lowest authoritative stock location in the baseline and belongs to one Legal
  Entity. Branch association remains optional metadata. Bins and routing locations are out of scope.
- Negative on-hand stock is forbidden. Reserved stock cannot be negative or exceed on-hand stock.
  Reservation and transfer mutations remain concurrency-safe PostgreSQL transactions.
- Inventory movements are append-oriented. Corrections use an explicit authorized adjustment
  command with a signed non-zero quantity, reason, and tenant-scoped idempotency key; existing
  movement rows are never edited or deleted to hide a correction. A negative correction cannot
  reduce on-hand below reserved stock.
- Lot/serial traceability and inventory valuation are explicitly out of scope for this baseline.
  Accounting owns monetary journals; Inventory does not infer valuation postings.

## Alternatives Considered

- **Adopt a full UOM conversion graph now:** rejected because no current capability requires it and
  conversion precision and rounding would become premature public policy.
- **Allow decimal quantities immediately:** rejected because the existing storage and workflows are
  integer-based and no fractional-stock requirement exists.
- **Treat bins as mandatory locations:** rejected because Warehouses already satisfy the current
  ownership and transfer invariants.
- **Permit negative stock with later reconciliation:** rejected because it weakens reservation and
  availability guarantees.
- **Edit historical movements during correction:** rejected because it destroys the audit trail.

## Consequences

### Positive

- Quantity-bearing contracts have one authoritative unit.
- Existing reservation and transfer semantics remain valid and bounded.
- Corrections preserve history and can be retried safely.
- Deferred UOM conversion, traceability, and valuation cannot leak into current contracts by accident.

### Negative

- Items requiring fractional quantities or conversion cannot use the initial stock contract.
- Changing an Item's stock unit requires a later migration command rather than an in-place edit.
- Warehouse-level stock cannot distinguish bins or staging locations.

### Risks

- A later decimal-quantity decision will require schema and public-contract versioning.
- External catalogs may use incompatible unit codes; adapters must map them before invoking Inventory.

## Validation

- Contract tests prove Item and stock DTOs carry the unit-of-measure code.
- PostgreSQL tests prove concurrent reservations and negative corrections cannot violate availability.
- Correction tests prove duplicate idempotency keys do not duplicate movement or balance changes.
- Boundary checks prove Inventory remains the sole owner of stock tables and mutations.
