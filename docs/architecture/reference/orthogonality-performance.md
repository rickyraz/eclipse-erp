# Orthogonality and Performance

> **Status:** Reference
>
> **Related documents**
>
> - Orthogonal design: [`./orthogonal-erp-design.md`](./orthogonal-erp-design.md)
> - Canonical modular-monolith decision: [`../../decisions/0001-use-modular-monolith.md`](../../decisions/0001-use-modular-monolith.md)

Orthogonality does not automatically make a system faster. Its primary
performance value comes from clearer ownership and reduced unnecessary work.

## Round Trips

A modular monolith can keep orthogonal boundaries while using local calls and
one database transaction. Turning every boundary into a microservice usually
adds network round trips and serialization.

## Computation

Clear ownership helps avoid repeated calculation. One movement fact can feed
stock, valuation, accounting, and analytics projections instead of each module
reconstructing the same fact independently.

## Projection Rule

A projection is derived state:

$$
\text{Projection} = f(\text{Source of Truth})
$$

Create a projection only when measured read requirements justify its maintenance
cost.

## Likely Benefits

- fewer unnecessary internal round trips;
- less duplicate validation and calculation;
- more focused queries;
- safer caching;
- clearer optimization ownership.

## Costs

- event propagation;
- idempotency;
- projection lag;
- reconciliation;
- additional storage.

Orthogonality is primarily a way to reduce accidental work, not a guarantee of
lower CPU time.
