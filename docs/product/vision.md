# Product Vision

> **Related documents**
>
> - Project overview: [`../../README.md`](../../README.md)
> - Architecture overview: [`../architecture/overview.md`](../architecture/overview.md)
- Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Orthogonal design reference: [`../architecture/reference/orthogonal-erp-design.md`](../architecture/reference/orthogonal-erp-design.md)

EclipseERP aims to preserve the strengths of traditional ERP systems:

- transactional integrity;
- accounting correctness;
- auditability;
- extensibility;
- multi-tenant security;

without adopting a global mutable model graph, hidden ORM behavior, anonymous
business relationships, or distributed complexity before it is justified.

## Design Goal

Business change should be:

- local;
- predictable;
- testable;
- owned by an explicit module;
- free from hidden side effects.

## Initial Non-Goals

- not an Odoo fork;
- not a collection of microservices;
- not a fully event-sourced ERP;
- not a graph database;
- not a plugin marketplace from day one;
- not a native Zig application.
