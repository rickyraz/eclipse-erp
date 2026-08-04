# ADR-0021: Define the P0 Scope and Identity Model

- Status: Accepted
- Date: 2026-08-04
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - ERP primitive roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
> - Semantic ownership: [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)
> - Internal and external identifiers: [`./0014-separate-internal-and-external-identifiers.md`](./0014-separate-internal-and-external-identifiers.md)

## Context

The P0 ERP primitive roadmap needs explicit boundaries for tenant, organization,
legal entity, branch, warehouse, party roles, currency, and timezone. Treating
these concepts as one company identifier would make authorization, accounting,
operations, and cross-domain contracts ambiguous.

The repository already has `auth.tenants`, tenant-scoped identities and
capabilities, a `party` domain for people and organizations, tenant-scoped
inventory warehouses, and accounting-owned journals. The model must extend
those owners without creating a generic `scope` package or a second ownership
system.

## Decision

### Scope hierarchy

```text
Tenant
└── Legal Entity
    ├── Branch (optional)
    └── Warehouse (inventory-owned; primary Branch association optional)
```

- **Tenant** is the top-level customer or enterprise boundary for data isolation
  and authorization. It is not a legal entity and may contain multiple legal
  entities.
- **Identity** is an authentication principal. One identity may access multiple
  tenants through separate tenant-scoped capability memberships.
- **Organization Party** is a person/business participant record of kind
  `organization`; it is distinct from a login identity and from tenant scope.
- **Legal Entity** is a first-class legal/accounting scope owned by `party` and
  linked one-to-one to an Organization Party in P0. Organization groups and
  hierarchy use explicit PartyRelationship links rather than making one generic
  Party the owner of multiple Legal Entities.
- **Branch** is an optional operational and reporting subdivision owned by
  `party`. A Legal Entity may have zero or more branches.
- **Warehouse** remains owned by `inventory`, is scoped to a Legal Entity, and
  may have one optional primary Branch association. Branch association is not
  exclusive ownership; shared warehouse assignment is deferred until a concrete
  workflow requires it.

### Configuration ownership

- `auth` owns the Tenant default timezone.
- `party` owns Branch timezone overrides.
- `inventory` owns Warehouse timezone overrides.
- `accounting` owns Legal Entity base currency, precision, fiscal period, and
  posting configuration. `party` owns only Legal Entity identity.
- Timestamps are stored as UTC. Timezone values are used for display,
  scheduling, and business-date interpretation.

### Party roles and relationships

- `PartyRole` is a tenant-wide base classification such as customer, supplier,
  employee, or partner.
- A generic `PartyRelationship` connects a Party to a Legal Entity when
  company-specific eligibility or business terms are required.
- `party` owns the generic relationship identity, kind, and active state.
  Procurement, sales, billing, and other domains own relationship-specific
  terms and invariants.
- Identity–Party representation is explicit and tenant-scoped, with only a
  minimal relationship kind and active state in P0. It does not grant
  authorization by itself; validity periods and delegation are later concerns.

### Command and bootstrap boundaries

The first implementation uses owner-local commands rather than a universal
cross-domain provisioning command:

```text
auth.createTenant
party.createLegalEntity
party.createBranch
inventory.createWarehouse
accounting.configureLegalEntity
```

Tenant creation is a bootstrap/application operation in P0, not a public
self-service command. Legal Entity, Branch, Warehouse, and accounting
configuration commands require tenant-scoped administrative capabilities.
A Legal Entity must reference an existing tenant-scoped Organization Party.
A Branch is optional and does not need a synthetic default such as `Head Office`.

## Alternatives Considered

### Collapse Tenant and Legal Entity

Rejected because one enterprise tenant may contain several legal/accounting
entities, each with separate currency, periods, ledgers, and authorization
scope.

### Make one Organization Party own many Legal Entities by default

Rejected for P0 because it confuses generic party identity with legal/accounting
identity. Group structures use explicit relationships; each Legal Entity has
one authoritative Organization Party identity.

### Make Identity the Party role owner

Rejected because login principals and business parties have different
lifecycles and cardinalities. A Party can have multiple identities or no login,
and an identity can represent multiple parties.

### Create a generic `scope`, `organization`, or `place` package

Rejected because existing owners are sufficient: `auth` owns Tenant, `party`
owns organization/legal/branch relationships, `inventory` owns Warehouse, and
`accounting` owns financial configuration.

### Use one atomic enterprise provisioning command

Deferred because it would become a cross-domain orchestration boundary before
owner-local contracts and transaction semantics are mature. A coordinator may
be added later only for a concrete onboarding requirement.

## Consequences

### Positive

- Tenant isolation, legal accountability, operational reporting, and inventory
  placement remain distinct.
- SAP-like company-code scoping and Odoo-like company/branch navigation can be
  represented without copying either product's data model.
- Domain ownership remains aligned with existing package and schema owners.
- Cross-domain business terms do not become duplicate Party master data.

### Negative

- Composite scopes and relationships require more explicit identifiers and
  constraints.
- Group hierarchy and company-specific Party terms require additional
  relationship contracts later.
- Accounting and inventory must migrate from tenant-only scope when their
  legal-entity behavior is implemented.

### Risks

- A PartyRelationship projection could be mistaken for authorization; backend
  capability checks remain authoritative.
- A warehouse may eventually need many-to-many Branch assignments.
- External legal identifiers, validity periods, delegation, tax, and
  jurisdiction-specific behavior remain outside this P0 slice.

## Validation

- Public contract tests prove tenant timezone defaults and tenant-specific
  overrides.
- Public Party tests prove organization-only Legal Entity creation, one-to-one
  Party/Legal Entity identity, optional Branch creation, and duplicate Branch
  rejection.
- PostgreSQL tests prove composite tenant/entity foreign keys and unique
  constraints.
- Boundary and ownership checks prove migrations and package imports remain
  owned by `auth` and `party`.
- Later inventory and accounting migrations must prove that warehouse and
  financial facts cannot cross Legal Entity scope.
