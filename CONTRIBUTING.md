# Contributing

> **Related documents**
>
> - Agent and repository rules: [`./AGENTS.md`](./AGENTS.md)
> - Documentation index: [`./docs/README.md`](./docs/README.md)
> - ADR index: [`./docs/decisions/README.md`](./docs/decisions/README.md)

## Workflow

1. Read `AGENTS.md`.
2. Read the architecture document relevant to the change.
3. Check related ADRs.
4. Keep the change narrowly scoped.
5. Add or update tests.
6. Run all available validation.
7. Update documentation when behavior or architecture changes.

## Pull Request Checklist

- [ ] The scope is clear and contains no unrelated refactor.
- [ ] Module ownership is preserved.
- [ ] Business failures remain typed and exhaustive.
- [ ] Transactions and invariants were reviewed.
- [ ] Authorization and tenant isolation were reviewed.
- [ ] Tests cover behavior, edge cases, and failure paths.
- [ ] Documentation was updated or marked unnecessary.
- [ ] An ADR was added when architecture changed.
- [ ] No secrets or sensitive data were introduced.
