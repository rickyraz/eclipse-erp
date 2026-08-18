# ADR-0020: Adopt Capability Release and Process Runtime Governance

- Status: Accepted
- Date: 2026-08-03
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Process Studio architecture: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Process Studio roadmap: [`../roadmap/process-studio.md`](../roadmap/process-studio.md)
> - Authorization architecture: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)

## Context

RITSEI already has the critical semantic foundation:

```text
orthogonal semantics
        ↓
package ownership
        ↓
public typed commands/events
        ↓
Process Studio
```

The next risk is not another domain layer. It is allowing an attractive Process
Studio to become unsafe or unupgradeable because capability release, process
promotion, execution authority, recovery, and observability remain implicit.

A capability may be useful internally without being stable enough for a published
process. A process definition may be valid without being deployed to production.
A workflow may be authorized to invoke a command without being allowed to bypass
the command owner's policy. A network timeout may occur after an external side
effect committed. Technical traces alone may not tell an operator which business
object is blocked.

## Decision

RITSEI adopts explicit capability release and process runtime governance
around the existing orthogonal architecture.

### Capability Release Contract

Every process-visible capability has a release lifecycle:

```text
PRIVATE
  ↓
EXPERIMENTAL
  ↓
PUBLIC
  ↓
DEPRECATED
  ↓
RETIRED
```

The minimum process-facing metadata is:

```text
id
version
kind: Domain | Plugin | External
owner
stability
inputSchema
outputSchema
possibleFailures
requiredCapability
scope
idempotency
transactionSemantics
retryPolicy
timeoutPolicy
compensation
compatibilityRange
```

Only `PUBLIC` capabilities with compatible versions may be used by released
production process definitions. `PRIVATE` and `EXPERIMENTAL` capabilities may be
used by local tests or explicitly non-production environments, but cannot enter a
production process version. `DEPRECATED` capabilities remain executable only for
compatible pinned instances until their retirement policy is reached. `RETIRED`
capabilities cannot start new instances.

The release contract applies equally to `DomainAction`, `PluginAction`,
`ExternalAction`, `DomainEvent`, `PluginEvent`, and `ExternalEvent`. Provenance
must remain explicit; all capabilities must not collapse into one generic
untyped action.

### One Typed Source of Truth

A capability declaration is authored once from the owning public contract or an
approved contributor contract. Tooling should derive or verify:

```text
catalog metadata
API/OpenAPI description
SDK types
Process Studio palette entry
authorization metadata
tracing/correlation metadata
test harness and fixtures
documentation
```

Hand-maintained duplicate manifests are not a release mechanism. Generated
artifacts remain derived and reviewable; domain implementation remains the
semantic source of truth.

### Process Definition Promotion

A process definition has an environment-aware lifecycle:

```text
DRAFT
  ↓
VALIDATED
  ↓
APPROVED
  ↓
RELEASED
  ↓
DEPLOYED
  ↓
RETIRED
```

- `DRAFT` is editable and cannot start production instances.
- `VALIDATED` records schema, catalog, policy, dependency, cycle, secret, and
  static-process checks.
- `APPROVED` records governed review and authorization.
- `RELEASED` is an immutable versioned artifact.
- `DEPLOYED` binds a released artifact to an environment such as TEST or PROD.
- `RETIRED` prevents new instances while preserving history and active-instance
  behavior.

A released version is never hot-mutated. New edits produce a new version. A
running instance is pinned to its process definition version and exact compatible
capability versions. Moving an active instance requires an explicit migration
policy and compatibility proof.

Environment promotion is:

```text
DEV → TEST → PROD
```

The UI may present this as `Draft → Test → Publish`, but the backend preserves the
separate release, deployment, approval, and environment states.

### Execution Context and Authority

Every process invocation carries an explicit execution context:

```text
ProcessInstanceId
TenantId
OrganizationScope
Initiator
CurrentActor
ExecutionPrincipal
DelegatedAuthority
BusinessObjectId(s)
CommandId / EventId
CorrelationId
CausationId
TraceId
```

Principal kinds are distinct:

```text
HumanPrincipal
ServicePrincipal
ProcessPrincipal
DelegatedPrincipal
```

A `ProcessPrincipal` represents runtime execution; it is not an automatic grant
of every capability. The owning domain authorizes each action using the explicit
principal, scope, delegation, and policy context. A workflow cannot grant a
capability merely by containing a node that names it.

Segregation of Duties is evaluated as policy in addition to domain invariants:

```text
Domain invariant:
  journal balances

Organization policy:
  creator != approver
  amount > threshold requires designated approver
```

Process Studio coordinates policy-approved tasks; it does not silently weaken
authorization or create an approval exception.

### Durable Runtime Semantics

A durable step persists its business execution state, not only a graph cursor:

```text
CommandRequested
CommandStarted
CommandSucceeded
CommandFailed
RetryScheduled
CompensationStarted
CompensationSucceeded
ManualRecoveryRequired
```

The runtime distinguishes:

```text
never committed
committed but response lost
business failure
retryable technical failure
unknown external outcome
compensation failure
```

Retries reuse a stable logical step identity and idempotency key. An unknown
external outcome is not automatically retried as if the provider did nothing;
it enters provider-status reconciliation or manual recovery according to the
connector contract.

Compensation remains an explicit domain business command. SQL rollback cannot
erase a committed journal, shipment, inventory issue, payment, or external effect.

### Business Observability

Every process and step exposes both technical and business trace context:

```text
technical trace:
  TraceId

business trace:
  ProcessInstanceId
  BusinessObjectId
  CommandId
  EventId
  CorrelationId
  CausationId
```

Operators must be able to see:

```text
Order-to-Cash #OTC-92831

✓ Sales order confirmed
✓ Credit approved
✓ Inventory reserved
✗ Shipment creation

Reason: connector unavailable
Retry: 3/5
Next attempt: explicit timestamp/policy
Business object: SO-2026-18381
```

Technical stack traces remain internal diagnostics. Operator views expose typed
business failures, safe provider summaries, step state, retry eligibility,
compensation progress, and required action according to authorization scope.

## Alternatives Considered

### Mutable Workflow Configuration

Rejected. Editing a workflow in place would change the meaning of running
instances and make audit, recovery, and upgrade behavior ambiguous.

### Generic Unreleased Action Type

Rejected. A single `Action` type would allow private, experimental, domain,
plugin, and external semantics to be confused. Provenance and stability are
part of the process contract.

### Process Runtime as Authorization Authority

Rejected. Process execution must invoke domain authorization; process definitions
cannot grant themselves business permissions.

### Technical Tracing Only

Rejected. ERP operators need business-object, process, command, event, retry,
and compensation context in addition to technical traces.

### Visual Designer Before Runtime Governance

Rejected. A pleasant canvas over mutable definitions and undefined recovery
semantics would create production risk. Release contracts and headless runtime
semantics come first.

## Consequences

### Positive

- Public capabilities can evolve without silently breaking process definitions.
- Process promotion becomes safe across DEV, TEST, and PROD.
- Running instances remain upgrade-stable and auditable.
- Workflow execution cannot bypass domain authorization or SoD policy.
- Unknown provider outcomes and committed effects receive explicit recovery paths.
- Operators see business progress rather than only HTTP and stack-trace data.
- One typed capability declaration can generate the developer and Process Studio
  experience without weakening internal contracts.

### Negative

- Capability release and compatibility metadata become long-lived maintenance.
- Process promotion requires governance and environment state.
- Execution context and observability add persisted runtime data.
- SoD and delegated authority make authorization decisions more explicit.
- Runtime recovery tests become more substantial than simple happy-path tests.

### Risks

- Teams may mark capabilities `PUBLIC` before their contracts are stable.
- Generated metadata may drift if source-of-truth ownership is unclear.
- A `ProcessPrincipal` may be treated as a superuser unless runtime authorization
  is enforced at every domain command.
- Operators may retry unknown external outcomes and duplicate provider effects.
- Environment promotion may become bureaucratic if the UX hides useful defaults.

Mitigations are owned by the Process Studio architecture, authorization policy,
connector profile, package boundary checks, release validation, and invariant
proof tests.

## Validation

The decision is validated when:

- capability release lifecycle and compatibility checks prevent private or
  deprecated actions from entering new production definitions;
- Process Studio versions are immutable and deployed through explicit environment
  promotion;
- active instances remain pinned to released definition and capability versions;
- execution context is preserved through commands, events, tasks, retries, and
  compensation;
- SoD and delegated-authority tests cover high-risk process actions;
- durable runtime tests distinguish lost responses, unknown outcomes, retryable
  failures, business failures, and compensation failures;
- business and technical observability correlate the same execution;
- generated catalogs/API/SDK/process metadata are verified against public
  contracts;
- operators can recover a committed effect without deleting or rewriting its
  authoritative fact.

## Related Documents

- [`../architecture/process-studio.md`](../architecture/process-studio.md)
- [`../architecture/authorization.md`](../architecture/authorization.md)
- [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
- [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
- [`../development/testing.md`](../development/testing.md)
