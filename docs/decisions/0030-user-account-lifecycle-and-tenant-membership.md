# ADR-0030: Separate User-Account Lifecycle from Tenant Membership

- Status: Accepted
- Date: 2026-08-07
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - P0 scope and identity model:
>   [`./0021-define-p0-scope-and-identity-model.md`](./0021-define-p0-scope-and-identity-model.md)
> - Public vocabulary:
>   [`./0029-rename-user-and-party-public-vocabulary.md`](./0029-rename-user-and-party-public-vocabulary.md)
> - Authorization architecture:
>   [`../architecture/authorization.md`](../architecture/authorization.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)

## Context

A `UserAccount` is global because one account may access multiple tenants. The initial
implementation stored only an email, treated capability rows as an implicit tenant membership,
exposed global account CRUD behind tenant headers, and allowed unauthenticated account creation.
That shape could permit tenant scope confusion and could not represent disabled accounts or
suspended tenant access safely.

Authentication sessions, tenant access, capabilities, and Party representation also have different
owners and lifecycles. Combining them in `identity` would recreate the ambiguity rejected by
ADR-0021 and ADR-0029.

## Decision

### UserAccount lifecycle

`identity` owns the global account lifecycle:

```text
active -> disabled
active <- disabled
```

A disabled account cannot issue or authenticate sessions. Disabling records a session invalidation
timestamp; enabling does not make sessions issued before the invalidation timestamp valid again.
Physical removal remains a trusted cleanup operation, not a tenant-facing account-management action.

The account public contract exposes `active` or `disabled` status. Session records remain owned by
`auth`; authentication consumes the identity public contract rather than importing identity
persistence tables.

### Tenant membership

`authorization` owns a separate tenant membership record:

```text
active <-> suspended
```

A membership identifies that a `UserAccount` may participate in a tenant. A capability grant is
valid only for an active membership. Removing a membership cascades its tenant-scoped capability
grants; it does not delete the global UserAccount.

A user account may have memberships in many tenants. Suspending one membership does not disable the
global account or affect access to other tenants.

### Provisioning and HTTP scope

User-account creation is authenticated tenant administration, not public self-service. The API
creates the global account and establishes its initial membership in the caller's tenant. Tenant
account queries first resolve tenant memberships and then read UserAccount records through the
identity public contract.

Tenant-facing removal removes the tenant membership. Global account disable and enable remain
trusted identity/authentication operations until a separate system-level operator capability is
defined; they are not exposed as ordinary tenant CRUD.

### Cross-domain boundary

- `identity` owns account identity and global lifecycle.
- `auth` owns sessions and authentication.
- `authorization` owns tenant membership and capability grants.
- `party` owns Party representation.

Cross-domain callers use public package contracts. No domain imports another domain's tables or
repositories.

## Alternatives Considered

### Put tenant_id on user_accounts

Rejected. A global account can access multiple tenants, and duplicating the account row per tenant
would confuse authentication identity with membership.

### Treat capability rows as membership

Rejected. It cannot represent suspended access without deleting grants and makes membership
lifecycle implicit and difficult to audit.

### Let tenant administrators delete global accounts

Rejected. Deletion has cross-tenant effects and cascades sessions and grants. Tenant administrators
remove membership; global deletion remains trusted.

### Add public self-service signup

Rejected for P0. The repository has no verified-email, invitation, abuse prevention, or
identity-provider contract to make public signup safe.

## Consequences

### Positive

- Global identity and tenant access have independent lifecycles.
- Disabled accounts invalidate old sessions even after re-enabling.
- Tenant APIs cannot list or mutate accounts outside their membership scope.
- Capability authorization remains deny-by-default and membership-aware.
- Party representation and authorization remain separate.

### Negative

- Provisioning is a multi-domain sequence until a reusable cross-domain transaction context exists.
- Account administration needs both identity and authorization contracts.
- Global account disable requires a future system-level operator boundary for a complete HTTP
  surface.

### Risks

- The initial provisioning sequence can leave an unassigned global account if membership creation
  fails; the account remains valid but inaccessible through tenant-scoped APIs and can be cleaned up
  by trusted operations.
- Session invalidation depends on comparing persisted session creation time with the identity
  invalidation timestamp.
- Audit storage and PostgreSQL RLS remain follow-up architecture work.

## Validation

- Identity contract and PostgreSQL tests cover status transitions and email validation.
- Authentication tests prove disabled accounts cannot issue or authenticate sessions and old
  sessions remain invalid after re-enabling.
- Authorization tests prove active membership is required, suspension denies capabilities, and
  removal removes tenant access without deleting the account.
- PostgreSQL migration tests prove membership backfill, foreign keys, and cascading capability
  removal.
- API/OpenAPI tests prove authenticated provisioning and tenant-membership routes.

## Related Documents

- [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
- [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
