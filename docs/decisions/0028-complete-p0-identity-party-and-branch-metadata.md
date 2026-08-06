# ADR-0028: Complete P0 Identity-Party and Branch Metadata Boundaries

- Status: Accepted
- Date: 2026-08-06
- Supersedes: none
- Related: [ADR-0021](./0021-define-p0-scope-and-identity-model.md)

## Context

The P0 scope model requires explicit Identity–Party representation, branch-local
metadata, and a safe path for legacy data that predates legal-entity and
provider-scoped identifiers. The existing contracts had capability memberships,
branches, warehouses, and identifiers, but not the representation relationship
or the requested branch metadata. The historical P0 scope migrations add
non-null columns and therefore cannot safely invent values for existing rows.

## Decision

1. `party` owns `identity_party_representations` with tenant, identity, party,
   opaque non-blank `kind`, and `active` state.
2. Creating or changing a representation requires the tenant-scoped
   `party.identity.represent` capability. A representation is not an
   authorization grant.
3. `party.branches` stores optional opaque `local_tax_registration` and
   `dedicated_journal_code` metadata. Tax rules remain outside `party`; journal
   facts and ownership remain in `accounting`.
4. Legacy scope and identifier values are supplied through an explicit JSON
   mapping and applied transactionally by:

   ```text
   deno task migrate:p0-backfill -- <mapping.json>
   ```

   The mapping contains `warehouseScopes`, `stockTransferScopes`, and
   `identifierScopes` arrays. Each row supplies the tenant and record ID plus
   the reviewed legal-entity/provider values. The command requires exact
   coverage of existing warehouses, stock transfers,
   and identifiers, validates database constraints, and fails closed on missing,
   unknown, or duplicate mappings. It never infers a legal entity or provider.
5. Existing migration files remain immutable. A database that has not yet
   crossed the historical non-null P0 migrations must use a reviewed deployment
   procedure to stage the mapping before replaying those migrations; the normal
   migrator must not be bypassed by silently rewriting migration history.

## Consequences

- Identity representation is explicit and queryable without coupling it to
  authorization.
- Branches can carry local registration and journal-routing metadata without
  becoming tax or accounting owners.
- Backfills are auditable and deterministic, but deployment still needs an
  operator-supplied mapping for legacy rows.
- Tax validation, journal master data, delegation, validity periods, and
  cross-domain atomic provisioning remain outside this P0 slice.
