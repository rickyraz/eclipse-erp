# ADR-0016: Isolate Jurisdiction Localization from Primitive Cores

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Plugin architecture:
>   [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
> - ERP standards reference:
>   [`../architecture/reference/erp-standards.md`](../architecture/reference/erp-standards.md)

## Context

ERP capabilities must support jurisdiction-specific tax policies, identifiers, evidence, reporting,
and authority integrations. Embedding every country's rules in shared primitives would make those
primitives unstable, contradictory, and difficult to reuse.

Localization also has varying trust and deployment requirements. Some localizations are maintained
and released with RITSEI, while others may be installed separately by an operator.

## Decision

Shared primitive cores remain jurisdiction-neutral. They define semantic capabilities such as tax
obligation, taxable base, rate, withholding, and tax evidence without embedding one jurisdiction's
codes, filing formats, authority endpoints, or policy details.

Jurisdiction-specific rules are implemented in explicit localization boundaries. A localization may
be either:

- a core module compiled and released with RITSEI; or
- a trusted server plugin installed by an operator.

Both forms use public domain contracts or explicit contributor contracts. A localization must not
mutate another module's tables directly, redefine another domain's invariant, or add
jurisdiction-specific fields and behavior to a shared primitive merely for convenience.

Localization contracts must identify their jurisdiction and version. External authority formats and
protocols additionally follow the versioned-adapter requirements of ADR-0013.

## Alternatives Considered

### Put all jurisdiction rules in one global tax module

Rejected because rules, evidence, identifiers, and filing requirements vary independently and can
conflict across jurisdictions.

### Require every localization to be a plugin

Rejected because officially maintained localizations may need core release, migration, and support
guarantees.

### Allow localization code to patch core tables and behavior

Rejected because hidden mutation breaks schema ownership, upgrade compatibility, and invariant
ownership.

## Consequences

### Positive

- Shared primitives remain reusable across jurisdictions.
- Localization ownership, versioning, and trust are explicit.
- Official and operator-installed localizations use the same boundary discipline.
- Authority integrations remain replaceable and versioned.

### Negative

- Primitive contracts need deliberate extension or contributor points.
- Cross-jurisdiction operations require explicit coordination rather than global conditionals.

### Risks

- Contributor contracts can become overly broad if designed around one localization.
- A localization may incorrectly duplicate a core invariant instead of contributing policy or
  evidence.

## Validation

- Review localization dependencies and owned schemas.
- Test that jurisdiction packages use public or contributor contracts only.
- Add boundary enforcement before the first localization implementation.
- Add compatibility tests for each supported jurisdiction and localization version.
