# ADR-0015: Assign One Semantic Owner per Invariant

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - ERP standards reference:
>   [`../architecture/reference/erp-standards.md`](../architecture/reference/erp-standards.md)

## Context

ERP processes cross several business capabilities. Without explicit semantic ownership, sales,
billing, accounting, payments, inventory, and reporting can each calculate or mutate competing
versions of the same fact. This creates drift, hidden coupling, and unclear failure ownership.

A modular monolith and shared PostgreSQL transaction do not remove this risk. Transactional
proximity must not become permission for one domain to mutate another domain's facts directly.

## Decision

Every business invariant has exactly one owning domain capability.

The owner defines the authoritative command path, validation, mutation rules, public contract,
domain errors, and persistence constraints for that invariant. Other domains must use the owner's
public typed service contract.

Other domains may maintain projections or caches for their own query needs, but those
representations are derived and must not become competing mutation authorities or independently
redefine the invariant.

Cross-domain operations that require atomic consistency use the existing typed transaction context.
Sharing a transaction does not transfer semantic ownership or permit direct mutation of another
domain's tables.

Candidate ownership includes:

```text
Movement    -> movement quantity and direction
Fulfillment -> allocation against commitment
Settlement  -> allocation against obligation
Valuation   -> economic-value calculation
Ledger      -> debit-credit balance
```

The final ownership registry for a capability must be recorded in its canonical domain architecture
before implementation. A financial execution engine may enforce transfer-level constraints and be
authoritative for accepted engine facts, but it does not become the semantic owner of Accounting
policy, authorization, posting meaning, or correction commands; those remain with the owning domain
under [`0040-adopt-tigerbeetle-financial-ledger.md`](./0040-adopt-tigerbeetle-financial-ledger.md).

## Alternatives Considered

### Let each application calculate the facts it needs

Rejected because duplicated calculations drift and make corrections, audit, and authorization
unreliable.

### Let the database schema imply ownership

Rejected because table location does not define business meaning, command authority, or public
contracts.

### Use one central ERP domain to own all invariants

Rejected because it recreates a global mutable model and removes orthogonal module boundaries.

## Consequences

### Positive

- Every invariant has one authoritative mutation path.
- Domain failures and constraints have a clear owner.
- Projections remain replaceable and auditable.
- Cross-domain coordination does not weaken module boundaries.

### Negative

- Composite processes must coordinate several typed services.
- Ownership disputes must be resolved before implementing ambiguous capabilities.

### Risks

- A domain can become too broad if ownership is assigned by traditional application name rather than
  semantic capability.
- A projection can accidentally become authoritative if callers bypass the owning contract.

## Validation

- Maintain and enforce the schema ownership registry.
- Add boundary tests preventing direct cross-domain table mutation.
- Add public contract tests for invariant-sensitive commands.
- Test that derived projections can be rebuilt from authoritative facts where rebuilding is
  required.
