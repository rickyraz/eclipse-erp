# Orthogonal ERP Areas

> **Status:** Reference
>
> **Related documents**
>
> - Orthogonal design: [`./orthogonal-erp-design.md`](./orthogonal-erp-design.md)
> - Graph models: [`./graph-models.md`](./graph-models.md)
> - Process Studio architecture: [`../process-studio.md`](../process-studio.md)
> - P0 scope and identity model: [`../../decisions/0021-define-p0-scope-and-identity-model.md`](../../decisions/0021-define-p0-scope-and-identity-model.md)
- Canonical architecture: [`../architecture-spec-v4.md`](../architecture-spec-v4.md)

Traditional ERP modules are useful for navigation but are not always the best
architecture boundaries. A more orthogonal decomposition uses primitive
business capabilities.

## Business Surface Mapping

Concrete business documents are the developer and ERP-consultant surface over these semantic areas.
They remain owner-local aggregates rather than a competing universal document model.

```text
SalesOrder / PurchaseOrder -> owner-local order lifecycle
Delivery / GoodsReceipt    -> fulfillment evidence plus owner-controlled movement contracts
Invoice / Payment          -> future obligation, billing, and settlement contracts
```

The names above do not decide ownership by themselves. `Commitment` and `Fulfillment` remain useful
semantic concepts; a domain promotes a relationship to an explicit entity when it carries quantity,
rules, history, or lifecycle. A concrete document may coordinate several semantic capabilities while
no document package becomes the authority for another domain's invariant.

## Candidate Areas

### Party

Identity, organization, legal identity, contacts, addresses, relationships, and
roles such as customer, supplier, or employee.

### Resource

Physical goods, services, money, capacity, labor, equipment, digital
entitlements, and rights.

### Place

Warehouses, bins, offices, customer sites, production lines, virtual locations,
and in-transit locations.

### Classification

Categories, tags, attributes, variants, units of measure, dimensions, cost
centers, and project dimensions.

### Offering

Commercial products, services, subscriptions, bundles, rentals, and pricing
conditions.

### Agreement and Commitment

Contracts, orders, obligations, promises, and terms.

### Movement and Fulfillment

The factual movement of goods, services, capacity, or rights and the fulfillment
of commitments.

### Valuation

Pricing, costing, currency conversion, allocation, and recognition policy.

### Settlement

Payments, allocations, credit, write-off, and reconciliation.

### Ledger

Immutable accounting facts, journal entries, balances, and reporting
projections.

### Policy and Local Workflow

Typed decision rules and domain-local allowed state transitions. This area
belongs to the owning domain and is not automatically the Process Studio.

For example, a Sales domain may own:

```text
SalesOrder: Draft -> Confirmed -> Fulfilled -> Cancelled
```

The Process Studio is a separate coordination layer for cross-domain
orchestration. It composes public commands and events but does not own the
lifecycle, invariants, or tables of Procurement, Inventory, Accounting, or any
other domain. See [`../process-studio.md`](../process-studio.md).

### Evidence

Documents, attachments, approvals, signatures, and audit records.

Traditional applications such as Sales, Procurement, Inventory, and
Manufacturing can be composed from these areas.
