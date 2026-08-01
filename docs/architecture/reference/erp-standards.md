# ERP Standards and Internal Design

> **Status:** Reference
>
> **Related documents**
>
> - Product vision: [`../../product/vision.md`](../../product/vision.md)
> - Orthogonal areas: [`./orthogonal-erp-areas.md`](./orthogonal-erp-areas.md)

ERP primitives are standardized mainly at the semantic and interoperability
level, not at the internal table, package, API, or transaction-boundary level.

## What Standards Commonly Define

- business meaning;
- invariants;
- external identifiers;
- code lists;
- document formats;
- integration messages;
- terminology;
- reporting rules.

## What Usually Remains Internal

- table names;
- package structure;
- aggregate boundaries;
- transaction boundaries;
- REST versus other protocols;
- synchronous versus asynchronous calls;
- PostgreSQL schema layout.

## Standard Categories

### Concepts and Invariants

Accounting frameworks define concepts such as assets, liabilities, equity,
income, expense, recognition, measurement, and presentation. They do not dictate
a specific database schema.

### Identifiers and Code Lists

Examples include currency codes, units of measure, trade-item identifiers, legal
entity identifiers, and location identifiers. Keep external identifiers
separate from internal primary keys.

### Documents and Messages

UBL, ISO 20022, and similar standards define exchange contracts. An external
invoice message is not automatically the internal Invoice aggregate.

### Process and Integration Boundaries

BPMN and ISA-95 help describe process and enterprise-to-manufacturing boundaries
without prescribing the internal module model.

### Reporting

XBRL and regulatory taxonomies define reporting projections, not the source
ledger model.

## Rule

Use standards to align meaning and interoperability. Do not outsource internal
architecture to a standard.
