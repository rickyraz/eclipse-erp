# ADR-0042: Set an exact financial amount boundary above the 500-trillion target

- Status: Accepted
- Date: 2026-08-19
- Owners: Accounting and Sales
- Related: [ADR-0040](./0040-adopt-tigerbeetle-financial-ledger.md), [financial ledger architecture](../architecture/financial-ledger.md)

## Context

The existing `Money` contract accepted at most twelve integer digits and the PostgreSQL
`money()` helper stored `NUMERIC(14,2)`. Both boundaries rejected:

```text
500,000,000,000,000.00
```

The financial ledger contract already represents minor amounts as decimal strings and the
PostgreSQL and TigerBeetle adapters perform integer arithmetic. The defect was at the
major-unit boundary and in duplicated decimal parsing, not in JavaScript floating-point
arithmetic.

The repository has no authoritative currency metadata registry. Accounting configuration
currently fixes decimal precision at two. Therefore this ADR does not invent currency
semantics: the ERP boundary remains two-decimal, while the exact conversion utility accepts
an explicitly supplied exponent for isolated adapter and conformance tests.

## Decision

1. Store ERP major-unit money columns as PostgreSQL `NUMERIC(24,2)`.
2. Accept at most 18 integer digits and two fractional digits in the public/domain
   `FinancialMajorAmount` schema.
3. Keep `500,000,000,000,000.00` as a required regression amount. The supported domain
   maximum is `999,999,999,999,999,999.99`; the database has four additional integer-digit
   positions above that boundary.
4. Keep ledger minor amounts exact and string-serialized. The conversion boundary uses
   `bigint` and rejects fractional precision loss and values above `2^128 - 1`.
5. Keep `NUMERIC(39,0)` for persisted PostgreSQL ledger minor amounts; it must not be
   narrowed to PostgreSQL `BIGINT` because the TigerBeetle-compatible range is U128.
6. Share the amount schema and conversion utility from the kernel primitive boundary.
   Accounting, Sales, events, and API-facing schemas must not maintain separate amount
   regexes.
7. Do not add a currency registry or claim production support for exponent 0 or 3 until
   an authoritative currency metadata decision exists. Test the generic exact utility with
   exponents 0, 2, and 3 only when the caller supplies the exponent.

## Alternatives considered

| Option | Result |
| --- | --- |
| `NUMERIC(17,2)` | Too little headroom; only 15 integer digits. |
| `NUMERIC(18,2)` | Represents the target but leaves a small operational boundary. |
| `NUMERIC(20,2)` | Gives 18 integer digits but leaves no database headroom above the public boundary. |
| `NUMERIC(24,2)` | Selected: exact, reversible widening with four database digits above the 18-digit public contract. |

## Consequences

- The widening migration is lossless for existing two-decimal values.
- PostgreSQL and TigerBeetle remain alternative authorities behind `FinancialLedgerPort`; this
  decision does not authorize dual writes or change cutover gates.
- Quantity multiplication in Sales remains `bigint` arithmetic and now validates the derived
  order total against the public amount boundary before persistence.
- Exponent-aware conversion is a primitive, not evidence that the current accounting profile
  supports currencies with different exponents.
- Real PostgreSQL evidence is required for the large amount. Real TigerBeetle evidence remains
  conditional on an integration run with `TIGERBEETLE_INTEGRATION=1`; skipped integration is not
  a pass claim.
