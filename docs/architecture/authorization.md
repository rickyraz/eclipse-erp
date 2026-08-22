# Authorization Architecture

> **Status:** Canonical
>
> **Related documents**
>
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - Analytics architecture: [`./analytics-architecture.md`](./analytics-architecture.md)
> - Workload isolation: [`./workload-isolation.md`](./workload-isolation.md)
> - Authorization ADR: [`../decisions/0006-use-capability-based-authorization.md`](../decisions/0006-use-capability-based-authorization.md)
> - User-account lifecycle and tenant membership: [`../decisions/0030-user-account-lifecycle-and-tenant-membership.md`](../decisions/0030-user-account-lifecycle-and-tenant-membership.md)
> - Capability naming: [`../decisions/0031-capability-naming-and-business-verb-conventions.md`](../decisions/0031-capability-naming-and-business-verb-conventions.md)
> - Plugin trust model: [`./plugin-architecture.md`](./plugin-architecture.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - Process governance ADR: [`../decisions/0020-adopt-capability-release-and-runtime-governance.md`](../decisions/0020-adopt-capability-release-and-runtime-governance.md)

## Goals

The authorization system must be:

- multi-tenant safe;
- deny by default;
- based on business actions;
- explicitly scoped;
- compatible with Separation of Duties;
- auditable and explainable;
- fast on normal request paths;
- independent of Redis as a source of truth.

Authentication integrations may include OIDC, SAML, SCIM, LDAP, Active
Directory, MFA, and passkeys. Authentication does not replace authorization.

Search rank, analytic metrics, projection membership, cached results, embeddings, and external
provider ACLs do not grant RITSEI capabilities. Search returns candidates; current visibility and every business action are
revalidated by the owning domain. Detailed search behavior is owned by
[`search-architecture.md`](./search-architecture.md).

## Model

RITSEI combines:

```text
RBAC
+ explicit tenant membership
+ scoped grants
+ constrained ABAC
+ relationship context
+ static and dynamic Separation of Duties
```

Tenant membership is separate from capability grants. A membership may be
`active` or `suspended`; only an active membership can authorize a capability.
Removing a membership removes its tenant-scoped grants but does not delete the
global UserAccount.

Roles bundle permissions but do not directly make the final decision.

## Permission Shape

Permissions represent business capabilities:

```text
accounting.invoice.read
accounting.invoice.submit
accounting.invoice.approve
accounting.invoice.post
accounting.invoice.reverse
inventory.stock.reserve
inventory.stock.adjust
inventory.stock_transfer.create
inventory.stock_transfer.confirm
inventory.stock_transfer.complete
authorization.role.assign
```

Use explicit lifecycle or controlled verbs where the business effect differs. Ordinary `create`,
`read`, or `update` remains acceptable when it accurately names one coherent owner-controlled action.
Broad `manage`, `write`, `admin`, `full_access`, and `execute` capabilities are forbidden by ADR-0031.

## Scope

A grant may be limited to:

- tenant;
- legal entity;
- branch;
- warehouse;
- department;
- cost center;
- project;
- owned records;
- a specific resource;
- a hierarchy subtree.

## Policy Safety

Tenant administrators must not provide arbitrary SQL, JavaScript, or other
unrestricted code. Dynamic conditions use a typed, validated policy model.

## Admission Is Not Authorization

Workload class, criticality, WorkloadCell placement, shuffle-shard membership, and ResourceLease
acquisition do not grant a business capability. They control where and whether work may begin after
trusted routing metadata is resolved.

A caller must still pass tenant membership, scoped capability, domain policy, and Separation of
Duties checks. A query projection or isolated executor must fail closed when authorization context is
missing, stale beyond its contract, or invalid. Sensitive isolated queries invoke a bounded
owner-controlled authorization-check contract with no access to the command reserve or use an
owner-approved fail-closed authorization projection with explicit scope, relationship, SoD,
revocation, and freshness behavior. If current owner state cannot be evaluated through that path,
the query is authoritative and does not claim hard projection isolation. WorkloadCell or lease membership must
never be accepted as proof of tenant visibility or mutation authority.

Capability IDs retain business ownership and verbs. They must not encode `command`, `query`,
`priority`, pool, cell, region, or executor names.

## Enforcement Layers

```text
Application authorization
-> business action and policy

PostgreSQL constraints
-> structural integrity

PostgreSQL RLS
-> tenant isolation and defense in depth
```

## Process Execution Authority and Separation of Duties

A workflow runtime does not become an authorization superuser. Every process
command is authorized by the owning domain using explicit execution context:

```text
ProcessInstanceId
TenantId
OrganizationScope
Initiator
CurrentActor
ExecutionPrincipal
DelegatedAuthority
BusinessObjectId(s)
CorrelationId
CausationId
```

Principal kinds remain distinct:

```text
HumanPrincipal
ServicePrincipal
ProcessPrincipal
DelegatedPrincipal
```

A `ProcessPrincipal` identifies durable runtime execution; it does not grant
capabilities by itself. A process definition cannot grant, widen, or substitute
a business capability.

Separation of Duties is a policy layer in addition to domain invariants:

```text
Domain invariant:
  journal must balance

Organization policy:
  creator != approver
  amount > threshold requires designated approver
```

High-risk workflows must preserve actor, initiator, delegation, capability,
scope, and approval history. Approval completion must be conditional or
otherwise protected against duplicate or unauthorized completion.

## Audit

Every high-risk decision should record:

- principal;
- action;
- resource;
- scope;
- policy or grant that allowed or denied access;
- correlation identifier;
- timestamp.

## Performance

Graph traversal may help build effective permissions, but the hot request path
should use an optimized effective-grant projection or equivalent indexed model.
