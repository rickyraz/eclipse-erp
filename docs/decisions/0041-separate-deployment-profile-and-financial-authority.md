# ADR-0041: Separate Deployment Profile from Financial Authority

- Status: Accepted
- Date: 2026-08-18
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - TigerBeetle ledger decision:
>   [`./0040-adopt-tigerbeetle-financial-ledger.md`](./0040-adopt-tigerbeetle-financial-ledger.md)
> - Financial ledger architecture:
>   [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> - Deployment notes: [`../deployment/README.md`](../deployment/README.md)
> - Entry Compose profile: [`../../deploy/entry/compose.yaml`](../../deploy/entry/compose.yaml)

## Context

Deployment topology and financial execution authority answer different questions. An entry
self-hosted installation must be able to run without TigerBeetle, while larger installations may
need a TigerBeetle financial data plane. Encoding the authority in a deployment tier would make a
small topology imply a financial engine, and changing an environment variable could be mistaken for
a financial cutover.

ADR-0040 still defines TigerBeetle as the required target execution engine. The repository also
needs an executable PostgreSQL path while TigerBeetle production-readiness evidence remains
incomplete and the normal composition root stays fail-closed.

## Decision

RITSEI models two independent runtime selectors:

- `deployment_profile`: `entry | standard | scale | enterprise` describes operational topology and
  maturity expectations.
- `financial_authority`: `postgresql | tigerbeetle` selects the implementation of the
  provider-neutral `FinancialLedgerPort`.

The API and worker use one shared composition module. PostgreSQL creates the ledger adapter directly
from the kernel `Database` service. TigerBeetle creates the adapter only when selected and only
after its complete configuration decodes. PostgreSQL startup does not read or require
`TIGERBEETLE_*` settings.

A financial operation is accepted only when the selected adapter authority, the legal-entity
financial-engine configuration, and the legal-entity reconciliation/cutover state agree. The
selector is not a cutover mechanism, and PostgreSQL and TigerBeetle are never silently dual-written.
The entry PostgreSQL path is therefore an executable transitional/default path, not a superseding
change to ADR-0040.

## Consequences

- `entry + postgresql` can be run with the API and worker and needs only PostgreSQL configuration.
- The PostgreSQL adapter must preserve the `FinancialLedgerPort` contract, tenant scope,
  idempotency, balance constraints, transaction atomicity, and reconciliation semantics.
- TigerBeetle readiness gates remain operational and fail-closed; no repository-proof is promoted to
  staging or production evidence by this separation.
- Standard, scale, and enterprise deployment artifacts may evolve independently of the authority
  selector. Their HA, quorum, recovery, custody, isolation, and DR gaps remain explicit.
- A future decision may change the long-term authority policy, but that requires new evidence and an
  ADR rather than changing the default through deployment configuration alone.
