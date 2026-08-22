# Orthogonal ERP Design

> **Status:** Reference
>
> **Related documents**
>
> - Product vision: [`../../product/vision.md`](../../product/vision.md)
> - Orthogonal areas: [`./orthogonal-erp-areas.md`](./orthogonal-erp-areas.md)
> - Canonical architecture: [`../architecture-spec-v4.md`](../architecture-spec-v4.md)

ERP complexity is not caused merely by many-to-many relations, PostgreSQL,
monoliths, or a large module count. It grows when:

- ownership is unclear;
- meaningful business relationships are anonymous join tables;
- one module mutates another module's state;
- workflow, policy, ledger, and documents are mixed;
- side effects are hidden in ORM hooks and subscribers;
- technical packaging is mistaken for business independence.

## Boring-Solution Gate

Start with:

```text
PostgreSQL
+ modular monolith
+ explicit schema ownership
+ constraints
+ explicit relationship entities
+ application services
+ transactional event publication
```

Do not start with microservices, a graph database, full event sourcing,
Kubernetes, or a large broker unless a concrete requirement justifies them.

Concrete business documents are an ergonomics layer over this boring architecture. They may be
first-class owner-local aggregates such as `SalesOrder` or `PurchaseOrder`, but they do not replace
semantic ownership or justify a universal `Document` model. Ordinary structural changes can use
simple helpers; business transitions remain explicit commands; consequential facts remain owned by
their invariant owner.

## Relationship Entity Rule

A join table is sufficient for simple membership. When a relationship has
attributes, rules, history, or a lifecycle, promote it to a first-class entity.

## Orthogonal Module Test

A healthy module defines:

1. one responsibility;
2. data it owns;
3. invariants it protects;
4. contracts it exposes;
5. effects it emits;
6. changes it can make without modifying unrelated modules.

The goal is not maximum abstraction. The goal is local, predictable, safe
change.
