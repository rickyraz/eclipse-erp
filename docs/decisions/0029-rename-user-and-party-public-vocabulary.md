# ADR-0029: Rename User and Party Public Vocabulary

- Status: Accepted
- Date: 2026-08-06
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - P0 scope and identity model: [`./0021-define-p0-scope-and-identity-model.md`](./0021-define-p0-scope-and-identity-model.md)
> - P0 identity-party boundaries: [`./0028-complete-p0-identity-party-and-branch-metadata.md`](./0028-complete-p0-identity-party-and-branch-metadata.md)
> - Internal and external identifiers: [`./0014-separate-internal-and-external-identifiers.md`](./0014-separate-internal-and-external-identifiers.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## Context

The current `Party` foundation is semantically correct, but several public names
are implementation-shaped or too generic for domain APIs and user-facing
software:

- `Identity` currently means an application login account, but can be confused
  with a person, legal identity, external identity, or authorization subject.
- `IdentityPartyRepresentation` describes a useful business relationship but
  exposes the implementation's original owner in a long public name.
- `PartyRole` is useful as a broad classification, but customer, supplier, and
  employee behavior will eventually require domain-owned contracts and facts.
- `OrganizationParty` and `Tenant` are correct kernel terms but need clearer
  public and UI vocabulary.

A broad rename affects public TypeScript contracts, Effect services, tagged
errors, principals, database identifiers, migrations, tests, OpenAPI names,
documentation, and future frontend labels. It must preserve semantic ownership
and must not collapse Tenant, Legal Entity, Branch, Party, or Warehouse into a
single organization concept.

This is a vocabulary and contract decision. It does not by itself introduce
customer accounting, supplier onboarding, employment, delegation, validity
periods, or generic Party-to-Party hierarchy.

## Decision

This decision establishes the target vocabulary and staged migration plan.
The implementation follows the dependency-ordered phases below.

### Preserve the semantic kernel

Keep these terms as canonical domain and persistence concepts:

```text
Party
Person
Organization
LegalEntity
Branch
Warehouse
Tenant
```

`Tenant` remains the backend isolation and authorization boundary. The UI may
call it `Workspace`, but backend contracts continue to use `Tenant` unless a
separate architecture decision changes the scope model.

`LegalEntity`, `Branch`, and `Warehouse` remain separate concepts with their
existing owners and invariants.

### Rename public user and representation vocabulary

The target public names are:

| Current name | Target name |
|---|---|
| `Identity` | `UserAccount` |
| `IdentityService` | `UserAccountService` |
| `CreateIdentityInput` | `CreateUserAccountInput` |
| `UpdateIdentityInput` | `UpdateUserAccountInput` |
| `identityId` in public contracts | `userAccountId` |
| `IdentityPartyRepresentation` | `PartyRepresentation` |
| `IdentityPartyRepresentationKind` | `PartyRepresentationKind` |
| `createIdentityPartyRepresentation` | `createPartyRepresentation` |
| `setIdentityPartyRepresentationActive` | `setPartyRepresentationActive` |
| `OrganizationParty` at public surface | `Organization` |
| `organizationPartyId` in public contracts | `organizationId` |
| `OrganizationPartyRequired` | `OrganizationRequired` |

The database owner may remain `identity` during the first contract migration;
package ownership and a possible `identity` to `iam` package rename are a
separate dependency-graph decision. `iam.UserAccount` is an acceptable public
namespace only if it does not merge authentication, authorization, and tenant
ownership into a new generic package.

The database target, if approved after inventory, is:

```text
identity.identities                       → identity.user_accounts
identity_id in public/persistence paths   → user_account_id
party.identity_party_representations     → party.party_representations
```

Applied migrations remain immutable. All database renames use a new reviewed
migration generated with the pinned Drizzle Kit version.

### Keep roles separate from domain accounts

`PartyRole` remains a lightweight tenant-scoped classification and eligibility
primitive during this migration. It must not become the sole source of truth for
domain-specific invariants.

Future domain-owned contracts are introduced only with the relevant capability:

```text
sales.CustomerAccount
procurement.SupplierAccount
hr.Employment
```

`partner` is not promoted into a core invariant unless a concrete business
meaning and owner are documented.

`PartyRelationship` remains limited and typed. The current implementation is a
Party-to-Legal-Entity relationship with business eligibility semantics; a
fully generic Party-to-Party hierarchy is not yet implemented.

`PartyRepresentation` identifies whom a user account represents. It never grants
a capability or authorization by itself.

## Migration plan

### Phase 0 — Freeze and inventory

1. Accept this ADR before changing public names.
2. Inventory every affected symbol, import, database column, constraint,
   migration, API schema, test fixture, documentation reference, and UI label.
3. Record external consumers and decide whether API versioning or a compatibility
   window is required.
4. Freeze new uses of the old public names.

Deliverable: an approved rename map and dependency/call-graph report.

### Phase 1 — Rename public TypeScript contracts

1. Rename user-account DTOs, service names, tagged errors, test layers, and
   service methods.
2. Rename `Principal.identityId` to `Principal.userAccountId` in public contracts.
3. Rename Party representation DTOs, errors, service methods, capabilities, and
   tests.
4. Expose `Organization` at the public surface while retaining the existing
   Party discriminator and persistence ownership.
5. Update all internal callers in one dependency-ordered change.
6. Keep short-lived deprecated aliases only where external consumers require
   compatibility; no new code may use an alias.

### Phase 2 — Rename persistence identifiers

1. Update Drizzle schema ownership and generated snapshots.
2. Generate a new migration for table, column, index, foreign-key, and
   constraint-name changes.
3. Preserve rows and opaque IDs; do not recreate business facts.
4. Backfill persisted capability literals from the old names to the new names;
   remove only duplicate old grants when the equivalent new grant already exists.
5. Validate the migration against both an empty database and a database seeded
   with the current P0 data.
5. Keep the existing explicit legacy backfill procedure separate from the name
   migration; naming must not invent ownership or provider values.

### Phase 3 — Rename HTTP and integration contracts

1. Rename request/response fields and OpenAPI names to the new vocabulary.
2. Version or deprecate external endpoints according to the compatibility decision
   from Phase 0.
3. Keep error tags and Problem Details names stable only when compatibility is
   required; otherwise use the new `UserAccount` and `PartyRepresentation`
   names consistently.
4. Verify no backend implementation or database type leaks through the public
   API.

### Phase 4 — Update documentation and UI language

1. Update the architecture overview and scope/identity sections.
2. Update ADR cross-references without rewriting accepted history.
3. Use `Organization`, `Customer`, `Supplier`, `Employee`, `Company`, and
   `Workspace` in user-facing labels.
4. Keep `Party`, `LegalEntity`, and `Tenant` in technical documentation where
   they are the precise semantic terms.
5. Add a bounded-context glossary so each domain's public vocabulary is explicit.

### Phase 5 — Remove compatibility names

1. Confirm that all repository callers use the target names.
2. Remove deprecated aliases and old public exports.
3. Add boundary scans preventing new uses of the old names.
4. Remove compatibility API paths only after the documented compatibility window.
5. Record the completed migration and final source-of-truth links.

## Implementation status

Phases 0 through 4 are implemented, and Phase 5 required no compatibility cleanup
because no old-name aliases were introduced. Public contracts now use `UserAccount`,
`Organization`, and `PartyRepresentation`; HTTP routes use `/user-accounts`; authorization uses
`user_account.*` and `party.representation.write`; and the persistence rename is
implemented by
[`20260806160912_rename_user_account_and_party_representation/migration.sql`](../../db/migrations/20260806160912_rename_user_account_and_party_representation/migration.sql).
The `packages/identity` owner remains intentionally unchanged; a package rename
to `iam` is deferred as specified above. Existing authorization grants are
migrated to the new capability literals without changing their effective
permissions.

## Alternatives Considered

### Keep every current name

Rejected for public contracts because `Identity` and
`IdentityPartyRepresentation` are too ambiguous and implementation-shaped.

### Rename `Party` to `Contact` or `BusinessPartner`

Rejected. `Party` is the correct semantic kernel term and supports people,
organizations, customers, suppliers, payees, and other roles without forcing a
single business context into the master record.

### Replace `PartyRole` immediately with all domain accounts

Rejected as premature. Customer, supplier, and employment invariants should be
introduced with their owning domain capabilities, not as empty scaffolding in
the Party package.

### Rename the whole `identity` package to `iam` in the same change

Deferred. `auth`, `identity`, and `authorization` currently have separate
ownership. A package rename can be evaluated after the public vocabulary change
with an explicit dependency-graph and ownership review.

### Add aliases permanently

Rejected. Aliases are a short compatibility bridge, not a second vocabulary or
permanent public contract.

## Consequences

### Positive

- Domain APIs describe user accounts and business representations directly.
- The Party semantic kernel remains reusable and standards-friendly.
- Customer, supplier, and employee invariants stay with their owning domains.
- UI language becomes understandable without exposing kernel terminology.
- Database and API migration order becomes explicit and reviewable.

### Negative

- The rename touches many packages, tests, migrations, and documentation files.
- A temporary compatibility layer may duplicate exports during one release.
- Developers must distinguish kernel terms from bounded-context terms.

### Risks

- External consumers may depend on old names or serialized error tags.
- A package-level `identity` to `iam` rename could accidentally merge ownership
  boundaries.
- Renaming database identifiers can affect operational SQL, reporting, and
  integration tooling outside the repository.
- Treating `PartyRole` as a complete customer/supplier model would recreate the
  generic abstraction this decision is intended to limit.

## Validation

The rename is complete only when:

- all public contracts use the target names;
- old names exist only in a documented compatibility layer, migration history,
  or historical ADR text;
- `UserAccount` behavior and session/authentication semantics are unchanged;
- Party representation still never grants authorization;
- tenant, legal-entity, branch, warehouse, and accounting isolation tests pass;
- migration tests pass on empty and current-schema databases;
- contract, boundary, call-graph, type-check, lint, and integration tests pass;
- documentation and UI labels use the correct bounded-context vocabulary;
- no `CustomerAccount`, `SupplierAccount`, or `Employment` invariant is placed
  in the generic Party package without an owning-domain decision.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
- [`./0021-define-p0-scope-and-identity-model.md`](./0021-define-p0-scope-and-identity-model.md)
- [`./0028-complete-p0-identity-party-and-branch-metadata.md`](./0028-complete-p0-identity-party-and-branch-metadata.md)
