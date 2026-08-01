# SQL/PGQ Use Cases

> **Status:** Reference
>
> **Related documents**
>
> - Canonical selection guidance: [`../hierarchy-and-graph-selection.md`](../hierarchy-and-graph-selection.md)
> - `ltree` notes: [`./ltree-notes.md`](./ltree-notes.md)
> - PostgreSQL architecture: [`../postgresql-19-architecture.md`](../postgresql-19-architecture.md)

SQL/PGQ is valuable for relationship-heavy ERP questions, but it does not turn
PostgreSQL into a graph storage engine. Property graphs are read-oriented views
over relational tables.

## Strong Use Cases

### Authorization Analysis

Find role inheritance and permission paths. Serve normal request paths from an
optimized effective-permission model rather than traversing every time.

### Multi-Level Bill of Materials

Find all transitive components, detect cycles, identify affected finished goods,
and inspect component paths.

### Supply-Chain Traceability

Traverse raw-material batches through production and finished goods.

### Related-Party and Fraud Analysis

Inspect ownership, control, transactions, and indirect relationships.

### Document Lineage

Trace source documents, transformations, corrections, and derived reports.

## Weak Use Cases

Do not use SQL/PGQ to replace ordinary relational queries for:

- invoice posting;
- journal-entry integrity;
- stock movement writes;
- payment allocation;
- simple parent-child trees.

Use relational constraints for write correctness and graph queries for selected
read questions.
