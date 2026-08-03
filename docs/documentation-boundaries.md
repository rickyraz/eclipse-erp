# Documentation Boundaries

> **Status:** Canonical documentation policy
>
> **Owns:** Document purpose, source-of-truth boundaries, duplication rules, and
> cross-document reference conventions.
>
> **Related documents**
>
> - Documentation index: [`./README.md`](./README.md)
> - Agent rules: [`../AGENTS.md`](../AGENTS.md)
> - Documentation workflow: [`./development/documentation-workflow.md`](./development/documentation-workflow.md)
> - ADR index: [`./decisions/README.md`](./decisions/README.md)

## Purpose

Each architectural fact must have one canonical owning document. Other files may
summarize it for navigation or explain why it was chosen, but they must not
create a second independent definition.

## Ownership Matrix

| Document type | Owns | Must not own |
|---|---|---|
| Root `README.md` | Project entry point and active-stack summary | Detailed architecture rules |
| `AGENTS.md` | Executable instructions for coding agents | Product rationale or full specifications |
| `docs/README.md` | Curated documentation navigation | Architecture content |
| `architecture/overview.md` | Short current-system map | Detailed subsystem policy |
| `architecture-spec-v4.md` | System-wide runtime and boundary decisions | Full subsystem detail |
| Subsystem architecture file | Detailed rules for exactly one subsystem | Historical decision rationale |
| ADR | Context, alternatives, decision, and consequences | Complete current-state specification |
| Reference document | Analysis and conceptual background | Binding implementation rules |
| Development workflow | How documentation and implementation are maintained | Domain architecture |

## Canonical Topic Owners

| Topic | Canonical owner |
|---|---|
| Runtime and global module shape | [`./architecture/architecture-spec-v4.md`](./architecture/architecture-spec-v4.md) |
| Frontend SPA, SolidJS 2.0, routing, and TanStack UI infrastructure | [`./architecture/frontend.md`](./architecture/frontend.md) |
| PostgreSQL ownership and integrity | [`./architecture/postgresql-19-architecture.md`](./architecture/postgresql-19-architecture.md) |
| Authorization | [`./architecture/authorization.md`](./architecture/authorization.md) |
| Events and messaging | [`./architecture/pgque-messaging.md`](./architecture/pgque-messaging.md) |
| Jobs and durable workflow engine selection | [`./architecture/durable-execution.md`](./architecture/durable-execution.md) |
| Process Studio, catalogs, Process IR, definition governance, and static validation | [`./architecture/process-studio.md`](./architecture/process-studio.md) |
| Plugin trust and extension model | [`./architecture/plugin-architecture.md`](./architecture/plugin-architecture.md) |
| Hierarchy and graph selection | [`./architecture/hierarchy-and-graph-selection.md`](./architecture/hierarchy-and-graph-selection.md) |
| Native Zig boundary | [`./architecture/native-zig-kernel.md`](./architecture/native-zig-kernel.md) |
| Architecture enforcement | [`./architecture/architecture-enforcement.md`](./architecture/architecture-enforcement.md) |
| Testing strategy | [`./development/testing.md`](./development/testing.md) |
| Database roles and privileges | [`./operations/database-roles.md`](./operations/database-roles.md) |

## Duplication Rules

Allowed duplication:

- a one-line stack summary in the root README;
- a short architecture summary in `overview.md`;
- the selected option inside an ADR;
- a cross-reference note.

Forbidden duplication:

- two files independently defining the same invariant;
- repeated SQL schemas that can diverge;
- multiple competing module-boundary rules;
- copying a subsystem specification into `AGENTS.md`;
- treating a reference document as an active decision without an ADR.

## Cross-Reference Convention

When one document depends on another, add a note near the top:

```md
> **Related documents**
>
> - Frontend architecture: [`./architecture/frontend.md`](./architecture/frontend.md)
```

Use a relative path from the current file. The visible link text should include
the path or an unambiguous document title.

## Updating a Decision

When a decision changes:

1. create a new ADR;
2. mark the earlier ADR as superseded;
3. update the canonical subsystem document;
4. update only summaries that mention the old selection;
5. do not copy the new detailed rule into every referring document.
