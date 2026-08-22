# ADR-0046: Adopt an Owner-Local Business Surface with Generated Structural Ergonomics

- Status: Accepted
- Date: 2026-08-22
- Amends: ADR-0015, ADR-0036
- Compatible with: ADR-0040, ADR-0044, ADR-0045
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Architecture enforcement:
>   [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - ERP primitive roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
> - Orthogonal ERP design:
>   [`../architecture/reference/orthogonal-erp-design.md`](../architecture/reference/orthogonal-erp-design.md)
> - Plugin architecture:
>   [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
> - Semantic invariant ownership:
>   [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)
> - P2 document and financial baseline:
>   [`./0036-define-p2-document-and-financial-baseline.md`](./0036-define-p2-document-and-financial-baseline.md)

## Context

RITSEI's primitive vocabulary is useful for reasoning about invariants, but it is not always the
best entry point for developers or ERP specialists. A developer should be able to work with a
concrete `SalesOrder`, `PurchaseOrder`, `Product`, or other owner-local business object without
first learning a universal framework of `Commitment`, `Fulfillment`, or `Obligation` objects.

The opposite failure is also unacceptable: making business documents freely mutable, allowing an ORM
to become the business authority, or letting generic document relations and hooks hide ownership,
authorization, transaction, and correction rules.

RITSEI therefore needs a concrete business surface without replacing semantic ownership. Structural
boilerplate should become cheaper through tooling, while meaningful transitions and consequential
facts remain explicit and owner-controlled.

## Decision

RITSEI adopts an **owner-local business surface with generated structural ergonomics**.

### Business surface

Business documents and records are concrete domain-facing concepts. Examples include:

```text
Product
Party
SalesOrder
PurchaseOrder
Delivery
GoodsReceipt
Invoice
Payment
ManufacturingOrder
```

The list is a vocabulary and target surface, not a declaration that every family is implemented or
that every name has a decided owner. A business object is first-class when it has an owner,
identity, lifecycle, public contract, authorization, invariant, and correction semantics. It does
not require a universal base class, shared mutable `documents` table, or dedicated package solely
because the name is familiar.

Current and future document families remain owner-local. The owner of a document does not acquire
the invariants of another domain merely because the document references that domain.

### Explicit business actions

Ordinary structural changes may use owner-reviewed CRUD-like helpers. Changes with business meaning
must use explicit, typed, authorized actions:

```text
Product.updateDescription       -> ordinary structural mutation
SalesOrder.confirm              -> business transition
PurchaseOrder.cancel            -> business transition
GoodsReceipt.receive            -> business transition
Invoice.post                    -> future owner-controlled transition
```

A lifecycle field must not become a back door for an ordinary update. Direct status mutation,
implicit transition hooks, and unreviewed ORM subscribers are not valid replacements for the owning
command path.

### Owner-controlled consequences

Business documents produce consequences through explicit owner contracts, not hidden persistence
hooks:

```text
Delivery or GoodsReceipt -> Inventory-owned movement contract
Invoice or Payment       -> separately decided Accounting/Billing contract
Accounting policy        -> FinancialLedgerPort
```

`Movement`, `Posting`, `Settlement`, `Policy`, `Process`, and business facts remain semantic
capabilities with explicit owners. They are not automatically universal kernel entities:

- Inventory owns physical stock movement and balance invariants.
- Accounting owns posting meaning, reversal, fiscal policy, and authorization.
- `FinancialLedgerPort` hides the selected financial execution engine.
- Settlement remains gated until obligation, payment, allocation, correction, and currency policy
  have an owner and public contract.

`Commitment` and `Fulfillment` remain useful semantic concepts. When a relationship has quantity,
rules, history, or lifecycle, the owning domain may represent it with an explicit relation entity;
it must not be reduced to an anonymous join merely to preserve a primitive list.

### Generated structural ergonomics

Tooling may generate or scaffold boring structural artifacts:

```text
Effect Schema / DTOs
basic queries and filters
form metadata
ordinary CRUD helpers
API documentation inputs
test skeletons
domain documentation stubs
```

Generated artifacts must remain subordinate to owner-reviewed public contracts. Tooling must not
silently generate or own:

```text
authorization policy
business transitions
cross-domain transactions
invariant mutation
financial or inventory consequences
fact/event authority
provider or persistence ownership
```

No universal runtime `Record`, `Document`, `Action`, or `Fact` framework is introduced by this ADR.
Those terms may describe a developer-facing classification, but they are not universal base types,
shared repositories, or authority tables. Persistence remains private, and Drizzle remains a query
and schema tool rather than the domain model.

### Extension boundary

Extensions use public or explicitly published contributor contracts. A plugin or generated artifact
may add structural metadata, a projection, an action contribution, or an event contribution only
within its declared trust and capability scope. It must not import private implementations, mutate a
core domain's tables, redefine a core invariant, or patch a protected transition.

## Alternatives Considered

### Keep primitive-first as the only developer surface

Rejected because it makes ordinary ERP work unnecessarily dependent on abstract semantic vocabulary.
Primitive concepts remain underneath, but concrete business objects are the supported surface.

### Create a universal ERP kernel or ORM domain model

Rejected because it would centralize unrelated ownership, encourage generic mutation, couple public
contracts to persistence, and create a god abstraction around documents, actions, or relations.

### Make all business documents freely CRUD-mutable

Rejected because status changes, posting, receiving, reservation, cancellation, and correction have
business meaning, authorization, concurrency, and audit requirements.

### Generate complete domain behavior from metadata

Rejected because generated structure cannot safely infer invariant ownership, financial policy,
transaction semantics, compensation, or manual recovery.

## Consequences

### Positive

- ERP users and developers work with familiar concrete business vocabulary.
- Structural master-data work can become low-ceremony without weakening domain boundaries.
- Business transitions remain searchable, authorized, idempotent, auditable, and testable.
- Consequence ownership remains visible in Inventory, Accounting, Billing, and other domains.
- External representations remain adapters rather than internal domain models.
- The existing owner-local document and semantic-owner decisions remain intact.

### Negative

- Generated tooling needs explicit ownership metadata and review rules.
- The same business surface may require several owner contracts for evidence, movement, posting, or
  settlement.
- Developers must learn when a mutation is ordinary and when it is a business action.
- Some generated artifacts will remain deliberately incomplete until their owner contract exists.

### Risks

- A convenience helper could expose lifecycle fields or bypass authorization.
- A generic document relation could become a hidden cross-domain authority.
- Generated public contracts could drift from handwritten domain behavior.
- A single maturity level could be mistaken for semantic ownership or authorization.
- Teams could activate Invoice, Payment, or Settlement semantics before their decisions are
  complete.

## Validation

The initial proof uses existing bounded slices rather than introducing a universal framework:

1. Inventory `Item` provides a structural master-data slice with owner-local persistence and typed
   create/query behavior.
2. Sales `SalesOrder` and `sales.order.confirm` provide a concrete document plus an explicit,
   authorized, idempotent business action and owner-published event.
3. Boundary checks must continue to reject private cross-domain imports and public persistence
   leaks.
4. Contract tests must prove that lifecycle transitions cannot be replaced by ordinary updates and
   that generated structural helpers do not own consequences.
5. Any future generator must be evaluated by implementation time, handwritten boundary surface,
   contract-test coverage, and number of exceptions required by the owner.

The decision is successful only if concrete business objects become easier to use without adding a
shared mutable document model, bypassing an owner contract, or weakening the existing transaction,
authorization, correction, and extension boundaries.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
- [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
- [`../architecture/reference/orthogonal-erp-areas.md`](../architecture/reference/orthogonal-erp-areas.md)
- [`../architecture/reference/erp-standards.md`](../architecture/reference/erp-standards.md)
