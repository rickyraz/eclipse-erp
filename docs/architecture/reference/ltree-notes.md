# `ltree` Notes

> **Status:** Reference
>
> **Related documents**
>
> - Canonical selection guidance: [`../hierarchy-and-graph-selection.md`](../hierarchy-and-graph-selection.md)
> - SQL/PGQ use cases: [`./sql-pgq-use-cases.md`](./sql-pgq-use-cases.md)

Use `ltree` for hierarchies that are truly tree-shaped and frequently queried by
ancestor or descendant.

## Suitable Hierarchies

- chart of accounts;
- organization units;
- warehouse locations;
- product categories;
- cost-center trees;
- geographic sales regions;
- document folders.

## Path Rule

Do not use mutable business names as path identity. Prefer stable machine labels:

```text
a01.a010.a01001
```

Store the human-readable name separately.

## Typical Queries

Descendants:

```sql
WHERE hierarchy_path <@ $1::ltree
```

Ancestors:

```sql
WHERE hierarchy_path @> $1::ltree
ORDER BY nlevel(hierarchy_path)
```

## Integrity

Keep an explicit `parent_id` foreign key when it helps enforce ownership and
validate path changes. Path updates must be transactional and protected against
cycles and concurrent moves.

Use a GiST index for ancestor and descendant search after validating the
workload.
