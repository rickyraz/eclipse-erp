# Documentation Workflow

> **Related documents**
>
> - Documentation index: [`../README.md`](../README.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)
> - Agent rules: [`../../AGENTS.md`](../../AGENTS.md)
- Documentation ownership: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## Before Implementation

1. Identify the affected source of truth.
2. Review related ADRs.
3. Record unresolved assumptions.
4. Do not turn an exploration document into an active decision implicitly.

## During Implementation

Update contracts, invariants, ownership, failure models, and operational
requirements while the implementation context is still available.

## After Implementation

- Update the architecture overview when system shape changes.
- Update the relevant domain specification when a contract changes.
- Create an ADR when a significant decision is introduced.
- Mark earlier ADRs as superseded instead of deleting history.
- Keep links in `docs/README.md` and all related-document notes valid.

## ADR Gate

Create an ADR when a decision:

- is difficult to reverse;
- affects multiple domains;
- changes the source of truth;
- changes transaction or consistency semantics;
- introduces a strategic dependency;
- changes authorization or a trust boundary;
- changes the extension model;
- is likely to be questioned again.
