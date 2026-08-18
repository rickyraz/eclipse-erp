# ADR-0036: Define the P2 Document and Financial Baseline

- Status: Accepted
- Date: 2026-08-12
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP primitive roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
> - Order lifecycle: [`./0033-extend-order-lifecycle-and-gate-pgque.md`](./0033-extend-order-lifecycle-and-gate-pgque.md)
> - Ledger engine boundary: [`./0040-adopt-tigerbeetle-financial-ledger.md`](./0040-adopt-tigerbeetle-financial-ledger.md)
> - Financial ledger architecture: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> - Jurisdiction localization: [`./0016-isolate-jurisdiction-localization.md`](./0016-isolate-jurisdiction-localization.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)

## Context

Sales orders, quotations, journals, reservations, and transfers already have owner-local identities
and lifecycles. Accounting also owns Legal Entity configuration, revenue-posting profiles, open/closed
periods, revenue journals, and reversals. The repository still needs a bounded P2 rule for document
references, money, obligations, tax, settlement, and fiscal controls before any financial action is
published to Process Studio.

No implemented invoice, payable, payment, settlement, or tax domain contract is mature enough to
make those concepts executable. Guessing their ownership now would conflict with the roadmap rule
that an unresolved business decision remains a gate.

## Decision

### Engine profile boundary

This ADR decides the bounded P2 business semantics, not an independent storage authority. The
current PostgreSQL implementation and its tests remain the transitional profile until the
TigerBeetle execution gates pass. After cutover, the same Accounting semantics use the authority and
cross-store protocol in ADR-0040; this ADR does not authorize payment, settlement, FX, or broader
financial scope.

### Documents and correction

- Documents remain owner-local aggregates. RITSEI does not add a shared mutable `documents`
  table or a generic document domain.
- Public document identifiers are opaque internal IDs. Cross-document links use typed owner-local
  references to the source document ID and contract version; display numbers and provider references
  remain separate external identifiers.
- Header and line facts that determine a committed economic result become immutable at the owning
  transition. The current Sales order freezes its line snapshots when confirmed.
- Corrections are new owner-authorized commands and facts: cancellation, release, reversal, return,
  or credit as applicable. Committed rows are not rewritten to conceal history.
- The bounded order lifecycle in ADR-0033 remains the only decided cross-domain financial document
  flow. Other document families remain private or out of scope until separately decided.

### Money and currency

- Each decided posting is scoped to one Tenant and one Legal Entity and uses that Legal Entity's base
  currency.
- The initial executable money representation is a non-negative decimal string with exactly the
  repository's fixed two-decimal storage scale. Legal Entity decimal precision is therefore `2` for
  the initial posting engine; other configured precision values are not Process Studio-ready and
  must be rejected by the owner before posting.
- Arithmetic derives minor units using integers. Floating-point arithmetic is forbidden for stored
  money and posting equality.
- Rounding, foreign exchange, and multi-currency settlement require a later superseding decision.

### Obligations, tax, and settlement

- Accounting owns ledger accounts, fiscal periods, postings, and reversals; it does not become the
  owner of commercial invoice or payment lifecycle state.
- Billing is the intended owner of customer invoices, receivables, payments, allocation, and
  settlement when those contracts are implemented. Procurement plus a future decided payable
  boundary own supplier invoice matching and payables; Accounting consumes only approved posting
  facts through public contracts.
- Tax calculation, jurisdiction rules, withholding, and tax documents remain outside the primitive
  core under ADR-0016. No current amount is advertised as tax-calculated.
- AP, AR subledgers, invoices, payments, credits, and settlement remain explicitly out of scope for
  the P2 baseline and cannot be registered as Process Studio actions.

### Fiscal posting and close

- Revenue posting and reversal require an enabled Legal Entity accounting configuration and one open
  period containing the owner-selected posting date. The initial bounded flow uses the current UTC
  date.
- Opening periods rejects overlap. Closing an open period is serialized with posting through the
  Accounting transaction boundary and is idempotent. Reopening and adjusting periods are not
  supported by this baseline.
- A closed-period failure is a business failure. Unknown database outcomes remain technical failures
  or explicit manual recovery at the coordinating application boundary.

## Alternatives Considered

- **Create a universal document package:** rejected because it would centralize unrelated lifecycle
  invariants and duplicate owner contracts.
- **Treat Accounting as invoice/payment owner:** rejected because ledger truth and commercial
  obligation lifecycle are distinct invariants.
- **Honor arbitrary configured decimal precision immediately:** rejected because current persisted
  money has a fixed two-decimal scale.
- **Implement tax, AP/AR, and settlement scaffolds now:** rejected because no requested business
  policy resolves their ownership and lifecycle.
- **Reopen closed periods:** rejected for the initial control model; corrections post as new facts in
  an eligible open period.

## Consequences

### Positive

- Existing order and revenue flows have explicit document, money, correction, and period semantics.
- The repository avoids a generic document super-domain and avoids inventing invoice or tax policy.
- Fixed-scale money and integer minor-unit arithmetic match current storage.
- Financial Process Studio publication remains gated to proven owner contracts.

### Negative

- Multi-currency, non-two-decimal currencies, invoices, payments, and settlement are unavailable.
- Generic tenant-scoped journals are not sufficient evidence for a Legal Entity Process Studio action.
- Posting dates are limited to the current UTC date in the bounded revenue flow.

### Risks

- A future currency model will require contract and persistence versioning.
- Billing and procurement ownership must be decided before order-to-cash or purchase-to-pay is called
  complete.
- Close authorization and audit may require separation-of-duties rules before catalog publication.

## Validation

- Contract and PostgreSQL tests prove open-period revenue posting, closed-period rejection,
  idempotent reversal, and immutable posted journal lines.
- Configuration tests reject unsupported posting precision.
- Process tests prove the order total, not caller-provided journal lines, drives revenue posting and
  unknown outcomes can enter explicit manual recovery.
- Roadmap and catalog checks keep invoices, payments, settlement, tax, and period actions unpublished
  until their owning contracts exist.
