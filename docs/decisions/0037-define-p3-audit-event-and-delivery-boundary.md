# ADR-0037: Define the P3 Audit, Event, and Delivery Boundary

- Status: Accepted
- Date: 2026-08-12
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP primitive roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
> - Events, jobs, and workflows: [`./0004-separate-events-jobs-and-workflows.md`](./0004-separate-events-jobs-and-workflows.md)
> - Typed Process Studio: [`./0018-adopt-typed-process-studio.md`](./0018-adopt-typed-process-studio.md)
> - Capability governance: [`./0020-adopt-capability-release-and-runtime-governance.md`](./0020-adopt-capability-release-and-runtime-governance.md)
> - Contract schemas: [`./0024-adopt-effect-schema-as-canonical-contract-schema.md`](./0024-adopt-effect-schema-as-canonical-contract-schema.md)
> - Order lifecycle and PgQue gate: [`./0033-extend-order-lifecycle-and-gate-pgque.md`](./0033-extend-order-lifecycle-and-gate-pgque.md)
> - Messaging architecture: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Integration architecture: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)

## Context

The bounded order coordinator already stores workflow state, versioned event envelopes, and leased
post-commit jobs in PostgreSQL. These records carry Tenant, actor, aggregate, correlation, and
causation metadata, but the repository has not yet fixed the ownership relationship among durable
business facts, audit evidence, catalog events, delivery intent, consumers, and external adapters.

PgQue is selected for future fan-out but remains gated by ADR-0033. The external connector runtime is
also planned rather than implemented. P3 therefore needs a truthful baseline that proves typed
internal events and duplicate-safe consumption without claiming unavailable broker or connector
behavior.

## Decision

### Audit authority

- The owning domain's immutable or corrected business facts remain the authoritative business audit
  record. A central audit table does not replace Sales orders, Inventory movements, Accounting
  journals, authorization grants, or their owner-local history.
- A command or coordination audit envelope records who invoked which selected command, for which
  Tenant and aggregate, with correlation, causation, time, and resulting event identity. It is
  evidence and an observability/indexing source, not authority for reconstructing current business
  state.
- The bounded `process` coordinator owns audit and delivery envelopes for the cross-domain lifecycle
  it coordinates. Future domain-local publication must use an approved transaction-aware messaging
  port; domains must not import or mutate `process` tables directly.
- Audit projections are rebuildable and may be centralized later. They must retain source owner,
  event ID, schema version, and correlation rather than inventing a second business truth.

### Typed catalogs

- A small neutral, contract-only catalog package owns the versioned `DomainAction` and `DomainEvent`
  declaration shapes and declaration validation rules. It is a leaf: it imports no domain, Process,
  integration, or persistence package and owns no assembled registry, release state, execution,
  authorization, or business semantics.
- Each domain owns and exports its declarations beside the public Effect Schema contracts they
  describe. Future Process Studio owns aggregation, compatibility validation, release state, and
  discovery through public package entry points; it does not hand-maintain a second registry of
  domain semantics. Released catalog persistence stores identity, version, compatibility, and
  checksum, never Effect Schema runtime objects or ASTs.
- Action declarations contain input/output/failure schemas, required capability and scope,
  idempotency, transaction semantics, retry/timeout policy, and explicit compensation or
  manual-recovery metadata. Event declarations separately contain payload schema, owner, aggregate
  and Tenant scope, correlation/filterable fields, occurrence semantics, delivery expectation, and
  sensitivity classification.
- Authorization capability metadata remains canonical in the current capability declaration until
  it is derived from domain action declarations. Transitional equality tests must reject owner,
  capability, version, stability, or scope drift between the two declarations.
- Only actions with executable owner contracts and events with owner-controlled publication paths
  plus compatibility tests may be `PUBLIC`.

### Event publication and consumption

- A domain-namespaced event is constructed and authorized by that owning domain's command path.
  Once the transaction-aware messaging port exists, owner services append events through it inside
  their local or shared transaction; a coordinator may carry or persist the returned envelope
  unchanged but cannot impersonate the event owner. Until then, the bounded coordinator may emit
  only a Process-owned fact such as `process.order_confirmation.completed`.
- Event identity is the pair `(event_type, event_version)`; the version is not duplicated as a `.v1`
  suffix. Envelopes preserve stable event ID, Tenant, aggregate, actor, distinct command ID,
  correlation, immediate causation, idempotency key, and occurrence time.
- Delivery is at-least-once. For a PostgreSQL-local consumer, its business effect and completed
  receipt commit in the same transaction. A duplicate returns only a completed receipt and does not
  repeat the effect. A claimed/processing receipt requires lease expiry and recovery semantics; it
  is not completion. External effects additionally require provider idempotency and
  accepted/committed/unknown/reconciled state because a local receipt cannot provide exactly-once
  delivery.
- Consumer receipts belong to the consuming module or messaging infrastructure. They retain event
  identity, consumer identity, completion state, and timestamps, not copied event payloads, for at
  least the replay/redelivery horizon.
- Receipts do not replace cursor advancement after durable completion, bounded retry,
  poison-event/dead-letter handling, or lag/failure metrics.
- Outbox insertion proves durable delivery intent only. `published_at` means durable acceptance by
  the named internal publication adapter, eventually PgQue; it does not mean every consumer or an
  external provider completed its effect.
- PgQue activation remains blocked until ADR-0033's installer, PostgreSQL 19, ticker, grant, upgrade,
  and adapter gates pass.

### Retention and redaction

- Canonical business facts follow their owning domain's retention and correction rules and are not
  deleted through event-retention cleanup.
- Event envelopes retain identifiers, versions, timestamps, actor/correlation metadata, and
  minimized redacted payloads for an operator-configured period. Consumer receipts retain only the
  identifiers and completion metadata required for deduplication. No default purge job is introduced
  until deployment policy selects a duration, replay horizon, and legal requirements.
- Secrets, credentials, authentication tokens, raw provider payloads, stack traces, and unnecessary
  personal data are forbidden in catalog metadata and event payloads. Payload schemas must be the
  minimum required by consumers.
- Redaction creates a governed derived representation or tombstone; it does not silently rewrite the
  owning business fact.

### External adapters

- `DomainAction`/`DomainEvent` remain distinct from `ExternalAction`/`ExternalEvent`.
- OpenAPI, CloudEvents, AsyncAPI, OAuth, provider retries, unknown outcomes, credentials, and
  transport failures remain in `packages/integrations` or approved connector plugins.
- No external connector is declared implemented by this P3 baseline. Connector publication remains
  gated by the integration-surface roadmap.

## Alternatives Considered

- **Central audit database as business truth:** rejected because it duplicates domain ownership and
  cannot replace the source facts and correction rules.
- **Let Process Studio author event semantics:** rejected because event meaning belongs to the domain
  that owns the committed fact.
- **Publish after commit without an outbox:** rejected because a crash can lose delivery intent.
- **Assume exactly-once delivery:** rejected; durable idempotent consumption is required instead.
- **Activate PgQue now:** rejected because ADR-0033's operational gates are incomplete.
- **Store full command/provider payloads for audit:** rejected because it increases secret and
  personal-data exposure without improving authority.

## Consequences

### Positive

- Audit evidence, business authority, catalog metadata, and delivery state have distinct owners.
- Two or more domains can publish process-safe metadata without a central duplicate manifest.
- Selected events are atomic with the bounded business transaction and duplicate delivery is safe.
- The repository remains truthful about PgQue and connector implementation status.

### Negative

- Domain-local transactions cannot publish through the shared outbox until a transaction-aware
  messaging port is introduced without package cycles.
- Retention duration remains a deployment decision and no automatic purge runs yet.
- At-least-once delivery requires every consumer to keep durable receipts or equivalent idempotency.

### Risks

- A coordinator could overstate ownership when emitting an event; compatibility tests must verify the
  event schema and owner entry against the public result that produced it.
- Event payloads can accumulate sensitive data; schema review and redaction tests are required before
  adding fields.
- Catalog versions can grow without retirement policy; Process Studio governance must enforce the
  existing release lifecycle.

## Validation

- Catalog tests import domain entries only through public package entry points, decode representative
  inputs/outputs/events with the referenced Effect Schemas, and reject duplicate or incompatible IDs.
- PostgreSQL tests prove order mutation and event envelopes commit or roll back together.
- Consumer receipt tests prove duplicate event delivery returns one durable receipt.
- Contract tests verify actor, Tenant, aggregate, correlation, causation, event version, and redacted
  payload shape for selected events.
- Boundary checks reject domain imports of `process` persistence and keep external protocol types out
  of domain/catalog contracts.
