# RITSEI Product Vision

> **Run your business. Design how it runs.**

RITSEI is an open-source enterprise business platform for running company
operations and designing the processes behind them.

RITSEI is not merely a collection of ERP applications and not merely a
workflow builder. It combines enterprise applications, visual process design,
workflow orchestration, plugins, integrations, explicit business rules,
event-driven automation, and extensible domain capabilities in one system.

## Brand meaning

RITSEI is a coined name inspired by two ideas:

- **律 — ritsu:** rule, discipline, governing principle, and order;
- **整 — sei:** arrangement, proper structure, and structured order.

The name is not claimed to be a standard Japanese word or a literal compound.
The safe brand story is:

> **RITSEI is a coined name inspired by the concepts of governing principles
> and structured order.**

The product meaning is:

> **Order governed by correctness.**

## Fundamental philosophy

> **Business complexity is unavoidable. Accidental complexity is not.**

Real organizations have finance, accounting, procurement, manufacturing,
inventory, sales, fulfillment, approvals, authorization, compliance,
workforce, integrations, and automation. RITSEI does not pretend that this
complexity can be removed. It makes the complexity explicit, structured,
verifiable, and controllable.

Order is not an accidental property of the system. It is designed into state,
ownership, transitions, rules, authorization, and process behavior.

## Product pillars

### Business applications

RITSEI provides a batteries-included enterprise foundation:

- Finance and Accounting;
- Sales and CRM;
- Procurement;
- Inventory and fulfillment;
- Manufacturing;
- Projects and operations; and
- additional domain capabilities as the platform grows.

Users should not have to build an ERP from zero. They should be able to start
with complete business capabilities and compose them safely.

### Process Studio

RITSEI Process Studio is a signature product experience. It lets business
teams design approvals, conditions, human tasks, timers, waits, events,
integrations, subprocesses, compensation, and automation visually.

A visual node represents a real governed primitive such as a business command,
condition, approval, human task, timer, event, integration, subprocess,
compensation, or automation. A process is therefore more than a flowchart:

```text
Sales Order
     │
     ▼
Credit Check
     │
     ├── Failed ──► Manual Review
     │
     ▼
Manager Approval
     │
     ▼
Reserve Inventory
     │
     ▼
Fulfillment
     │
     ▼
Invoice
```

Business users can express rules such as “every purchase above Rp500 million
requires CFO approval” through governed process design. Developers can add
custom conditions, capabilities, actions, and integrations when code is the
right tool.

The runtime executes the same typed contracts that the designer represents.
Audit history can explain why a process took a particular branch.

### Platform and plugins

RITSEI follows a stable-core, extensible-edges model. Core packages expose
contracts; plugins extend capabilities without rewriting the core domain model.
Possible extensions include:

- domain capabilities;
- workflow actions;
- event handlers;
- connectors and integrations;
- reporting;
- permissions;
- user interfaces; and
- industry-specific functionality.

Apps, Process Studio, and plugins compose into one business process rather than
remaining isolated applications that happen to share a database.

## Correctness as a differentiator

Extensibility without governance creates chaos. RITSEI therefore treats
correctness as a product feature:

> **Customization may extend behavior, but it must not invalidate business
> truth.**

A plugin may add an accounting approval process, but it may not create an
unbalanced journal. It may add a fulfillment workflow, but it may not violate
stock invariants. It may add a capability, but it may not bypass authorization
boundaries.

Process Studio provides flexibility. Plugin architecture provides
extensibility. Domain invariants provide correctness. RITSEI requires all three
to work together.

## Engineering DNA

RITSEI is built around:

- explicit state;
- explicit invariants;
- deterministic transitions;
- server-side authority;
- clear ownership;
- auditability;
- composability;
- open standards;
- extensibility; and
- durable processes.

Business rules should be explicit. State should be understandable. Ownership
should be clear. Transitions should be explainable. Extensions should compose.
Customization should not sacrifice correctness.

## Open-source promise

Open source is part of the product model, not just a license badge. RITSEI aims
to provide:

- inspectability;
- extensibility;
- self-hostability;
- community plugins;
- transparent contracts;
- open integration standards; and
- less vendor lock-in.

Organizations should be able to understand, extend, and own the system their
business depends on.

## Positioning

RITSEI does not compete by promising more modules than established ERP
platforms. Its distinction is control over how those capabilities work
together:

> **We give you the applications—and let you design how they work together.**

The product model is:

```text
Choose capabilities
        ↓
Design processes
        ↓
Extend when necessary
        ↓
Run the business
```

RITSEI combines integrated enterprise capabilities, visual process design,
explicit business rules, and a composable platform. It does not try to make
enterprise complexity disappear. It makes that complexity understandable and
controllable.

## Product family

The product name is **RITSEI**, not “RITSEI ERP”. ERP is the category
descriptor. The product family can grow around capabilities such as:

```text
RITSEI
│
├── Finance
├── Sales
├── Procurement
├── Inventory
├── Manufacturing
├── CRM
├── Commerce
├── Projects
├── Process Studio
├── Automation
├── Connect
└── Platform
```

These are capability boundaries, not a requirement for separate commercial
SKUs.

## Final promise

> **RITSEI is an open-source enterprise platform where businesses do not just
> configure software—they design how their operations run.**

**Run your business. Design how it runs.**

**Order, by Design.**
