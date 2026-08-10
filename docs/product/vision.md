# Product Vision

> **Related documents**
>
> - Project overview: [`../../README.md`](../../README.md)
> - Architecture overview: [`../architecture/overview.md`](../architecture/overview.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Workload isolation: [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - Process Studio architecture: [`../architecture/process-studio.md`](../architecture/process-studio.md)
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
- free from hidden side effects;
- protected from degradable workloads consuming the resource reserve required by canonical commands.

## Process Composition Vision

EclipseERP will let developers build safe, typed domain capabilities and let
business users compose those capabilities into governed workflows. The Process
Studio is intended to be domain-aware rather than a generic diagram editor: it
uses versioned Action and Event Catalogs, deterministic Process IR, pure
decisions, static business validation, durable execution, explicit
compensation, task inboxes, monitoring, and immutable release/deployment.

The visual designer follows catalog and headless-runtime maturity; it does not
precede them. The canonical target and staged 0.8–1.0 roadmap are owned by
[`process-studio.md`](../architecture/process-studio.md).

## Non-Interference Vision

EclipseERP should fail by workload boundary rather than by accidental resource sharing. In a
deployment that claims hard overload isolation, projection-safe dashboard, search, or reporting
traffic must have no path to the executor slots, database connections, or primary credentials
reserved for canonical commands.

This is a scoped, testable guarantee rather than a universal uptime claim. Minimal colocated
deployments remain supported but cannot claim physical non-interference without the separation and
proof defined by [`workload-isolation.md`](../architecture/workload-isolation.md).

## Initial Non-Goals

- not an Odoo fork;
- not a collection of microservices;
- not a fully event-sourced ERP;
- not a graph database;
- not a plugin marketplace from day one;
- not a native Zig application.
