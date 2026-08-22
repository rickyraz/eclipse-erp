# Decision Map

> **Status:** Reference navigation
>
> **Owns:** Decision lineage and a concise map of current architectural rules.
>
> **Does not own:** Binding architecture, domain contracts, persistence rules, or implementation
> behavior. Those remain owned by the linked ADRs and canonical architecture documents.
>
> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)

ADRs preserve the decisions and trade-offs that were accepted at a point in time. This map explains
how related decisions fit together without rewriting their historical text.

## Current decision lineage

```text
ADR-0015  One semantic owner per invariant
    |
    +--> ADR-0036  Owner-local documents and bounded financial baseline
              |
              +--> ADR-0044  Procurement Purchase Order baseline
              |
              +--> ADR-0045  Procurement Purchase Order confirmation

ADR-0046  Owner-local business surface + generated structural ergonomics
    |
    +--> concrete business objects remain owner-local
    +--> ordinary structural changes may use reviewed CRUD-like helpers
    +--> meaningful transitions use explicit actions
    +--> consequential facts remain with their semantic owner
    +--> generated tooling is not business authority
              |
              +--> ADR-0047  Procurement Goods Receipt boundary
```

ADR-0046 amends the current architectural interpretation of ADR-0015 and ADR-0036. ADR-0047
amends the receipt and cancellation boundary of ADR-0044 and ADR-0045. Neither ADR replaces the
historical decisions, and ADR-0047 does not change the financial authority recorded by ADR-0040.

## Relationship matrix

| Decision | Relation to ADR-0046 | Current role |
|---|---|---|
| [ADR-0015](./0015-one-semantic-owner-per-invariant.md) | Amended interpretation | One owner remains authoritative for each invariant |
| [ADR-0036](./0036-define-p2-document-and-financial-baseline.md) | Amended interpretation | Documents remain owner-local; unresolved financial families remain gated |
| [ADR-0040](./0040-adopt-tigerbeetle-financial-ledger.md) | Compatible | Accounting semantics use `FinancialLedgerPort`; ledger execution remains separate |
| [ADR-0044](./0044-define-procurement-purchase-order-baseline.md) | Compatible | Procurement owns Purchase Order identity and lifecycle |
| [ADR-0045](./0045-define-procurement-purchase-order-confirmation.md) | Compatible | Purchase Order confirmation remains an explicit owner action |
| [ADR-0046](./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md) | Current amendment | Concrete surface, explicit actions, owner facts, and structural tooling boundary |
| [ADR-0047](./0047-define-procurement-goods-receipt-boundary.md) | Current amendment | Procurement evidence plus Inventory movement in one bounded receipt transaction |

## Current canonical rules

The current architecture is summarized here for navigation; the canonical rule remains in
[`architecture-spec-v4.md`](../architecture/architecture-spec-v4.md) and the owning ADRs.

- Business objects and documents are owner-local.
- Ordinary structural changes may be CRUD-like only within owner-approved fields and policy.
- Meaningful business transitions use explicit, typed, authorized actions.
- Cross-domain consequences use public contracts and approved transaction protocols.
- Movement, posting, settlement, and other facts remain owned by their semantic capabilities.
- Generated schemas, DTOs, queries, forms, CRUD helpers, and test skeletons are tooling, not business authority.
- Persistence models, ORM hooks, provider types, and private repositories do not become public domain contracts.
- External standards remain behind versioned adapters.
- Goods Receipt evidence belongs to Procurement; physical receipt movement belongs to Inventory.

## Historical integrity

Do not rewrite an accepted ADR to make it describe the current state. When the direction changes,
create a new ADR, state whether it amends or supersedes earlier decisions, update the canonical
architecture, and update this map. Historical ADR text remains the record of the earlier decision.
