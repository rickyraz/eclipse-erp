# Authorization Architecture

> **Status:** Canonical
>
> **Related documents**
>
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Authorization ADR: [`../decisions/0006-use-capability-based-authorization.md`](../decisions/0006-use-capability-based-authorization.md)
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

## Model

EclipseERP combines:

```text
RBAC
+ scoped grants
+ constrained ABAC
+ relationship context
+ static and dynamic Separation of Duties
```

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
inventory.stock.transfer.create
inventory.stock.transfer.confirm
inventory.stock.transfer.complete
auth.role.assign
```

Avoid broad permissions such as `invoice.update`.

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
