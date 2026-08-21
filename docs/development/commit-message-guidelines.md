# Commit-message standard

> **Status:** Canonical
>
> **Owns:** Commit message format, subject/body rules, commit types, and
> breaking-change notation.
>
> **Related documents**
>
> - Agent rules: [`../../AGENTS.md`](../../AGENTS.md)
> - Contributor workflow: [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)
> - Documentation workflow: [`./documentation-workflow.md`](./documentation-workflow.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## Policy

RITSEI uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
with the concise, imperative, focused-history practices documented by
[Git](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project)
and [GitHub](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-open-source).
“Silicon Valley standard” is not a formal authority; this is RITSEI’s explicit
repository standard.

## Format

```text
<type>(<optional-scope>)!: <imperative summary>

[optional body]

[optional footer(s)]
```

### Types

Use one of these types:

| Type | Use for |
| --- | --- |
| `feat` | A new capability |
| `fix` | A bug or incorrect behavior |
| `docs` | Documentation-only changes |
| `refactor` | Internal restructuring without behavior change |
| `perf` | Performance improvements |
| `test` | Test changes |
| `build` | Build system or dependency changes |
| `ci` | Continuous-integration changes |
| `chore` | Maintenance that does not fit another type |
| `style` | Formatting or non-semantic style changes |
| `revert` | Reverting an earlier commit |

## Rules

- Keep each commit to one logical change; do not mix unrelated refactors or
  formatting.
- Write the summary in lowercase, imperative present tense, without a period:
  `docs: define the commit message standard`.
- Keep the summary concise: target 50 characters and do not exceed 72 characters
  unless the scope is necessary for clarity.
- If a body is needed, separate it with one blank line, wrap lines at 72
  characters, and explain the motivation, important constraints, or migration
  impact.
- Use a scope only when it adds useful package or subsystem context, such as
  `accounting`, `inventory`, `kernel`, or `docs`.
- Mark an incompatible change with `!` after the type or scope and explain it in
  a `BREAKING CHANGE:` footer.
- Do not rewrite shared or already-published history without explicit approval.

## Examples

```text
feat(inventory): add idempotent stock correction

fix(accounting): reject blank operation identities

docs: clarify transaction rollback evidence

refactor(kernel)!: replace the database client port

BREAKING CHANGE: callers must provide the new transaction capability.
```

## Research basis

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Pro Git: Contributing to a Project](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project)
- [GitHub: Contributing to open source](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-open-source)
- [GitHub: Using Git on GitHub Docs](https://docs.github.com/en/contributing/collaborating-on-github-docs/using-git-on-github-docs)
