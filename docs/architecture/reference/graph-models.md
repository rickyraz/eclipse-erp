# Graph Models in EclipseERP

> **Status:** Reference
>
> **Related documents**
>
> - Graph selection: [`../hierarchy-and-graph-selection.md`](../hierarchy-and-graph-selection.md)
> - SQL/PGQ use cases: [`./sql-pgq-use-cases.md`](./sql-pgq-use-cases.md)
> - Orthogonal areas: [`./orthogonal-erp-areas.md`](./orthogonal-erp-areas.md)

EclipseERP can be understood as several typed directed graphs rather than one
universal graph.

## Graph Types

### Module Dependency Graph

Shows which module consumes another module's contract. This graph should
generally remain acyclic.

### Runtime Event Graph

Shows which areas publish and consume event types. Runtime flow does not require
the publisher to import consumer implementations.

### Business Relationship Graph

Represents relationships such as commitment-to-fulfillment,
obligation-to-settlement, and party-to-role.

### Workflow Graph

Represents allowed state transitions:

$$
G_{\text{workflow}} = (S, T)
$$

where $S$ is the state set and $T$ is the allowed transition relation.

### Policy Dependency Graph

Shows which facts a policy needs to produce a decision.

## Bidirectional Traversal

For a vertex $v$:

$$
\operatorname{Out}(v) = \{u \mid (v,u) \in E\}
$$

$$
\operatorname{In}(v) = \{u \mid (u,v) \in E\}
$$

Both views help estimate change blast radius.

## Application Representation

Use typed node and edge identifiers with indexed outgoing and incoming
collections. Low-level adjacency arrays are unnecessary until profiling proves
they are needed.
