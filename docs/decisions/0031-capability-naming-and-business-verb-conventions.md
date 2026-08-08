# ADR-0031: Capability Naming and Business Verb Conventions

- Status: Accepted
- Date: 2026-08-08
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Capability authorization:
>   [`./0006-use-capability-based-authorization.md`](./0006-use-capability-based-authorization.md)
> - Capability release and runtime governance:
>   [`./0020-adopt-capability-release-and-runtime-governance.md`](./0020-adopt-capability-release-and-runtime-governance.md)
> - Capability-oriented plugin contribution:
>   [`./0023-adopt-capability-oriented-plugin-contribution.md`](./0023-adopt-capability-oriented-plugin-contribution.md)
> - Public vocabulary:
>   [`./0029-rename-user-and-party-public-vocabulary.md`](./0029-rename-user-and-party-public-vocabulary.md)
> - Authorization architecture:
>   [`../architecture/authorization.md`](../architecture/authorization.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - ERP primitives roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)

## Context

ADR-0006 establishes deny-by-default, scoped capability authorization and requires permissions to
represent business actions rather than generic CRUD alone. ADR-0020 adds release, compatibility,
scope, idempotency, transaction, retry, compensation, and observability metadata for process-visible
capabilities. ADR-0023 makes capabilities part of the public contributor boundary for plugins.
ADR-0029 establishes the public vocabulary for `UserAccount`, `PartyRepresentation`, `Organization`,
and related domain concepts.

Those decisions do not yet define one stable identifier grammar or a controlled business-verb
vocabulary. The current implementation contains a mixture of module-level names, resource-qualified
names, broad verbs, and nested segments:

```text
party.create
party.representation.write
user_account.write
inventory.stock.transfer.confirm
auth.capability.grant
```

Without a naming convention, capability IDs become difficult to review, scope, version, migrate,
expose through Process Studio, and audit. Broad names such as `write` and `manage` also hide
materially different business actions and weaken least privilege and Separation of Duties analysis.

## Decision

### Capability identity and ownership

A capability ID is a stable public authorization identifier. It is used by:

- domain authorization checks and grants;
- `requiredCapability` metadata in Typed Action Catalog entries;
- approved plugin manifests and contributor contracts;
- Process Studio action definitions;
- API and contract test fixtures.

A capability ID is not an HTTP route, SQL query label, role name, display label, trace name, or
database table identifier. Existing technical operation labels such as `authorization.member.get`
may remain separate implementation and observability labels; they are not capability IDs unless
explicitly declared as such by the owning domain.

The first segment is the owning domain/package from the ownership model, not the actor, tenant,
deployment location, or UI module. The owning domain is the sole authority for the capability's
invariant, command path, authorization meaning, and public contract.

### Canonical identifier grammar

New capability IDs use one of these forms:

```text
<owner-module>.<verb>
<owner-module>.<resource>.<verb>
```

Rules:

- all segments use lowercase `snake_case`;
- the final segment is always a business verb;
- the two-segment form is allowed only for the owner's declared primary aggregate;
- the three-segment form is required for a named subresource or secondary aggregate;
- no capability uses four or more dot-separated segments;
- compound resources use one `snake_case` segment, such as `stock_transfer`;
- IDs do not contain tenant, branch, actor, role, provider, or environment names;
- capability version, stability, compatibility, and scope remain metadata as required by ADR-0020,
  not part of the ID.

Examples:

```text
party.create
party.organization.create
party.legal_entity.configure
party.party_representation.attach
identity.user_account.read
authorization.capability.grant
authorization.tenant_membership.suspend
inventory.stock.reserve
inventory.stock_transfer.confirm
accounting.journal.post
```

The owner prefix follows package ownership. The resource uses the public vocabulary established by
ADR-0029. Therefore `identity.user_account.*` is the canonical namespace for UserAccount actions,
while `party.party_representation.*` is the canonical namespace for PartyRepresentation actions.

### Business-verb conventions

The verb must describe the business effect, not the transport or implementation mechanism.

Allowed baseline verbs include:

```text
create       read          update
activate     suspend       disable        enable
submit       approve       reject         confirm
post         reverse       cancel         close          reopen
reserve      release       receive        transfer       complete
assign       attach        detach         configure      remove
```

The list is extensible when a domain demonstrates a distinct business meaning and declares the verb
in its owner contract. A new verb must not be introduced only to mirror an HTTP method, ORM
operation, table mutation, or UI label.

Use these rules:

- `read` covers authorized queries and listings unless the domain proves that separate query
  sensitivities require separate business capabilities;
- `create`, `read`, and `update` are acceptable for ordinary resource data;
- lifecycle transitions use their explicit verbs, such as `activate`, `suspend`, `disable`, or
  `close`;
- irreversible or controlled actions use explicit verbs, such as `approve`, `post`, `reverse`,
  `reserve`, or `confirm`;
- `remove`, `cancel`, `reverse`, `deactivate`, and `revoke` must reflect distinct domain semantics;
  they are not interchangeable aliases for physical deletion;
- `delete` is not a default business capability. Committed business facts must use a correction,
  reversal, cancellation, or explicit removal policy;
- `get` and `list` are implementation/query operation labels, not default capability verbs.

The following broad verbs are forbidden for new capabilities:

```text
manage
write
admin
full_access
execute
```

Existing broad capabilities are transitional legacy identifiers. They must not be copied into new
modules, plugins, or process definitions and must be split into the smallest meaningful public
actions during migration.

### Capability granularity and scope

One capability should authorize one coherent business action. A capability must not bundle unrelated
create, update, lifecycle, approval, or administrative operations merely because the same user
commonly performs them.

Tenant, Legal Entity, Branch, Warehouse, department, project, record ownership, and hierarchy
restrictions remain separate scope metadata. Scope must not be encoded into the capability ID.
Authorization still evaluates the principal, tenant membership, capability grant, scope, and domain
policy at runtime.

High-risk capabilities must declare the additional metadata required by ADR-0020, including approval
or Separation of Duties policy, idempotency, transaction semantics, retry and timeout behavior,
compensation or manual recovery, and audit/correlation requirements.

### Public vocabulary and module boundaries

Capability names use the target public vocabulary from ADR-0029 and never reintroduce the renamed
public terms:

```text
UserAccount                 not Identity
PartyRepresentation         not IdentityPartyRepresentation
Organization                not OrganizationParty
```

A capability owner may expose a public capability or an approved contributor contract. Another
domain or plugin may consume that capability, but may not claim ownership, mutate the owner's
tables, or bypass the owner's authorization path.

`PartyRepresentation`, `PartyRole`, and relationship classifications do not become authorization
capabilities by themselves. A capability must represent the business action being authorized.

### Release and compatibility

Capability IDs are stable contract identifiers. Renaming or splitting one is a compatibility change
and follows the governance in ADR-0020 and the vocabulary migration rules in ADR-0029:

1. inventory internal and external consumers before changing an ID;
2. record the old-to-new mapping and whether the old grant is equivalent;
3. migrate persisted grants without inventing ownership or scope;
4. update public contracts, catalog metadata, plugins, tests, and documentation;
5. use a time-bounded deprecated alias only when an external compatibility requirement is
   demonstrated;
6. remove the alias after the documented compatibility window.

A broad capability must not be automatically translated into several narrower capabilities unless
the owner explicitly accepts the security consequence. For example, `user_account.write` cannot
silently become both `create` and `update` for every existing grant without an owner-approved
migration decision.

### One source of truth

The owning public contract is the semantic source of truth for a capability. Authorization
enforcement, API/OpenAPI metadata, plugin manifests, Process Studio catalogs, tracing metadata, test
fixtures, and documentation are derived or verified from that contract as described by ADR-0020.

The current centralized `Capability` schema is a transitional aggregation surface for authorization
and API decoding. The implementation plan below will move capability declarations toward owner-owned
contracts without introducing a second hand-maintained registry.

## Initial migration map

This map is the starting point for implementation. It is not permission to rewrite persisted grants
without the inventory and compatibility checks above.

| Current identifier                      | Canonical direction                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `auth.capability.grant`                 | `authorization.capability.grant`                                                                                            |
| `user_account.read`                     | `identity.user_account.read`                                                                                                |
| `user_account.write`                    | Split into `identity.user_account.create` and `identity.user_account.update` where the call site requires it                |
| `user_account.membership.manage`        | Split into `authorization.tenant_membership.add`, `read`, `suspend`, `activate`, and `remove` as required by each operation |
| `party.create`                          | Retain as the primary `party` aggregate capability                                                                          |
| `party.legal_entity.create`             | Retain                                                                                                                      |
| `party.branch.create`                   | Retain                                                                                                                      |
| `party.role.assign`                     | `party.party_role.assign`                                                                                                   |
| `party.relationship.create`             | `party.party_relationship.create`                                                                                           |
| `party.identifier.attach`               | `party.party_identifier.attach`                                                                                             |
| `party.representation.write`            | Split into explicit `party.party_representation.create`, `activate`, or other owner-defined actions                         |
| `inventory.stock.transfer.*`            | `inventory.stock_transfer.*`                                                                                                |
| Other three-segment domain capabilities | Retain when the owner, resource, and verb already satisfy this ADR                                                          |

The migration must distinguish capability grants from internal database query labels and must not
rename technical labels merely because they contain dots.

## Implementation plan

### Phase 0 — Inventory and freeze

1. Extract every capability literal, schema member, grant row, API input, bootstrap grant, plugin
   declaration, and Process Studio reference.
2. Classify each occurrence as a capability ID, a technical operation label, or a
   display/documentation label.
3. Identify external consumers and compatibility obligations.
4. Freeze new use of `manage`, `write`, `admin`, `full_access`, and `execute` in capability IDs.

### Phase 1 — Add validation and owner metadata

1. Add a reusable capability-ID schema/validator for the two allowed grammars.
2. Add checks for lowercase snake_case, segment count, reserved verbs, and owner prefixes.
3. Define owner metadata for each existing capability.
4. Keep authorization deny-by-default when a capability is unknown or malformed.
5. Add contract tests and a repository boundary check so new noncanonical IDs fail validation before
   merge.

### Phase 2 — Declare capabilities at their owners

1. Have each owning domain expose its capability declarations through its public contract or
   approved contributor contract.
2. Keep `packages/authorization` responsible for grant storage and runtime evaluation, not for
   silently inventing another domain's action semantics.
3. Assemble or verify the application capability catalog from owner declarations.
4. Derive API/OpenAPI, plugin, Process Studio, and test metadata from that source; do not create a
   second manually maintained manifest.

### Phase 3 — Migrate current modules

1. Rename identifiers that only lack the owner prefix or use outdated public vocabulary.
2. Split `write` and `manage` at the command boundary rather than granting every derived action
   automatically.
3. Update bootstrap capabilities and all service authorization checks.
4. Migrate persisted capability grants with reviewed SQL/Drizzle migrations and explicit handling
   for ambiguous broad grants.
5. Update unit, PostgreSQL, API, OpenAPI, boundary, and contract tests.

### Phase 4 — Integrate plugins and Process Studio

1. Validate requested plugin capabilities against owner declarations and release metadata.
2. Require `requiredCapability` to reference a canonical, version-compatible ID.
3. Reject process definitions that reference private, unknown, deprecated, or incompatible
   capabilities for their target environment.
4. Preserve owner, tenant scope, execution principal, idempotency, and recovery metadata during
   catalog generation.

### Phase 5 — Compatibility cleanup

1. Provide deprecated aliases only for documented external consumers.
2. Emit migration diagnostics for remaining legacy IDs.
3. Remove aliases after the compatibility window.
4. Mark the canonical catalog and migration complete in the roadmap.

## Alternatives considered

### Keep capability names informal

Rejected. Informal names make least privilege, cross-domain ownership, plugin contribution, catalog
compatibility, and audit review inconsistent.

### Use HTTP verbs or CRUD only

Rejected. HTTP methods describe transport, not business meaning. CRUD alone cannot express approval,
posting, reversal, reservation, correction, or Separation of Duties.

### Use one broad capability per module

Rejected. Broad module capabilities violate least privilege and make business risk impossible to
review precisely.

### Put scope and version into the ID

Rejected. Scope, stability, compatibility, and version have independent lifecycles and are already
governed as metadata by ADR-0020.

### Let plugins define arbitrary capability IDs

Rejected. Plugins contribute through versioned contracts and requested authority; they do not become
owners of core invariants by naming a capability.

## Consequences

### Positive

- Capability IDs become predictable and reviewable.
- Business verbs expose risk and lifecycle semantics explicitly.
- Public vocabulary remains aligned with ADR-0029.
- Plugin and Process Studio references can be validated before runtime.
- Broad grants can be migrated deliberately instead of silently widening access.

### Negative

- Existing capability literals require a migration and test updates.
- Domain owners must publish and maintain capability metadata.
- Some operations currently sharing `write` or `manage` require separate policy decisions and
  grants.
- A canonical catalog adds validation and compatibility work before Process Studio can safely
  consume every domain action.

## Validation and exit criteria

This ADR is implemented when:

- every production capability ID passes the canonical grammar and owner check;
- no new capability uses a forbidden broad verb;
- every capability has an owner, public contract, scope, and release metadata;
- persisted grants contain canonical IDs or documented compatibility aliases;
- API, plugin, and Process Studio contracts reject unknown or noncanonical IDs;
- tests cover migration, deny-by-default behavior, scope, membership, and capability compatibility;
- the roadmap records the naming catalog as implemented rather than merely decided.

## Related Documents

- [`../architecture/authorization.md`](../architecture/authorization.md)
- [`../architecture/process-studio.md`](../architecture/process-studio.md)
- [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
- [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
