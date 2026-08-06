# Scope and User Account Context

This context defines the scope, user-account, and party vocabulary used while stabilizing the P0 ERP foundation.

## Language

**Tenant**: The top-level customer or enterprise boundary for data isolation and authorization; it
is not a legal entity.

**UserAccount**: An application account used for authentication and execution context.

**Party**: A business person or organization that participates in business relationships.

**Organization**: A Party whose kind is `organization`, regardless of whether it is a legally
registered entity.

**Legal entity**: A first-class legal/accounting scope owned by `party`, linked one-to-one to an
Organization, and existing inside a tenant.

**Branch**: An operational and reporting subdivision owned by `party` under a Legal Entity, not a
separate legal entity or party.

**Warehouse**: An inventory-owned physical or virtual place scoped to a Legal Entity, with an
optional non-authoritative Branch association.

**Base currency**: The default accounting currency owned by a Legal Entity.

**Timezone**: A tenant default for display and execution fallback, with optional local overrides on
Branch or Warehouse.

## Relationships

- A **Tenant** may contain multiple **Legal entities**.
- A **Legal entity** must reference an existing tenant-scoped Organization.
- An Organization maps to at most one **Legal Entity** in P0.
- Organization groups and hierarchy use explicit typed relationship work when required; a generic
  Party-to-Party hierarchy is not implemented in P0.
- A **Legal entity** may contain zero or more **Branches**.
- `auth` owns the **Tenant** boundary; `party` owns **Organization**, **Legal Entity**, **Branch**,
  roles, and scoped business relationships; `inventory` owns **Warehouse** and stock.
- A **Legal entity** owns or scopes its **Warehouses**.
- A **Warehouse** may have an optional primary **Branch** association; this is not exclusive
  ownership.
- Many-to-many Warehouse–Branch assignment is deferred until a concrete workflow requires it.
- A **Legal entity** has one **Base currency** through its accounting configuration.
- `accounting` owns Base currency, precision, fiscal period, and posting configuration; `party` owns
  only Legal Entity identity.
- A **Tenant** owns a default **Timezone** through `auth`.
- The first implementation uses separate owner-local commands rather than one cross-domain
  provisioning command.
- Legal Entity, Branch, Warehouse, and accounting configuration commands require tenant-scoped
  administrative capabilities.
- A **Branch** may override the tenant timezone through `party`.
- A **Branch** may store an opaque local tax registration and dedicated journal code; tax rules and
  journal ownership remain outside the branch primitive.
- A **Warehouse** may override the tenant timezone through `inventory`.
- Timestamps are stored as UTC; timezone is used for display, scheduling, and business-date
  interpretation.
- A **UserAccount** may access multiple **Tenants** through separate tenant-scoped authorization
  memberships.
- A **UserAccount** may have explicit tenant-scoped **PartyRepresentation** relationships with
  multiple Parties.
- **PartyRepresentation** has an opaque non-blank kind and an active flag; it never grants
  authorization.
- A **Party** may hold tenant-wide business roles such as customer, supplier, employee, or partner.
- A scoped **PartyRelationship** connects a Party to a Legal Entity when company-specific business
  terms or eligibility are required.
- The `party` domain owns generic PartyRelationship identity, kind, and active state.
- Sales, procurement, billing, and other domains own their relationship-specific terms and
  invariants.
- A PartyRepresentation does not grant authorization by itself; capabilities remain authoritative.

## Flagged ambiguities

- PartyRepresentation validity periods and delegation rules remain unresolved.
- PartyRelationship validity, terms, and detailed legal-entity configuration remain unresolved.
- Group relationship kinds and hierarchy rules remain unresolved.
