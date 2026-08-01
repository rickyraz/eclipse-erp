# Hierarchy and Graph Selection

> **Status:** Canonical guidance
>
> **Related documents**
>
> - `ltree` notes: [`./reference/ltree-notes.md`](./reference/ltree-notes.md)
> - SQL/PGQ use cases: [`./reference/sql-pgq-use-cases.md`](./reference/sql-pgq-use-cases.md)
> - Selection ADR: [`../decisions/0005-use-ltree-and-sql-pgq-selectively.md`](../decisions/0005-use-ltree-and-sql-pgq-selectively.md)

## Decision Matrix

```text
Relational tables
-> authoritative state and constraints

ltree
-> strict hierarchy and ancestor/descendant traversal

SQL/PGQ
-> multi-edge network traversal

Application graph registry
-> package dependencies, event topology, and blast-radius analysis
```

## Use `ltree` For

- chart of accounts;
- organizational units;
- warehouse and location hierarchy;
- product categories;
- cost centers;
- geographic regions;
- document folders.

Use stable machine labels in paths. Keep human-readable names separate.

## Use SQL/PGQ For

- multi-level BOM with shared components;
- supply-chain traceability;
- related-party and fraud paths;
- document lineage;
- complex relationship graphs.

A property graph is a read-oriented view over relational tables. It does not
replace the transactional model.

## Hot-Path Rule

Do not perform complex graph traversal on every request. Use traversal for
analysis or projection construction, then serve hot paths from indexed
effective-state models where appropriate.
