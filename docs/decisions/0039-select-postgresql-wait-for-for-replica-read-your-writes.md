# ADR-0039: Select PostgreSQL `WAIT FOR` for Replica Read-Your-Writes

- Status: Accepted
- Date: 2026-08-14
- Supersedes: None
- Superseded by: None
- Implementation: Deferred
- Production activation: Gated on PostgreSQL 19 GA and route-scoped validation

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - PostgreSQL control-plane architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Financial ledger authority: [`./0040-adopt-tigerbeetle-financial-ledger.md`](./0040-adopt-tigerbeetle-financial-ledger.md)
> - Non-interference: [`./0034-adopt-non-interference-overload-isolation.md`](./0034-adopt-non-interference-overload-isolation.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - PostgreSQL architecture:
>   [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Workload isolation:
>   [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - PostgreSQL 19 `WAIT FOR`:
>   [PostgreSQL documentation](https://www.postgresql.org/docs/19/sql-wait-for.html)

## Context

RITSEI keeps canonical writes and invariant-sensitive reads on PostgreSQL while allowing bounded
query workloads to use replicas or rebuildable projections. Some future routes will need a stronger
contract than eventual or bounded-stale reads without returning every post-command read to the
primary.

The required guarantee is causal and route-scoped:

```text
commit command C
-> obtain consistency position T
-> query an approved replica
-> wait until replica position >= T
-> execute the bounded read
```

This is read-your-writes consistency. It does not prove that the replica equals the primary's newest
state or includes commits after `T`.

PostgreSQL 19 introduces `WAIT FOR`, including `standby_replay`, which can wait until a target WAL
position has been applied on a standby. Selecting it affects consistency classification, transport
metadata, query routing, timeout behavior, promotion handling, observability, and the no-primary-
fallback rule. Those boundaries should be decided before individual routes invent incompatible
mechanisms.

PostgreSQL 19 is still pre-GA at the time of this decision. Selection of the mechanism therefore
does not activate it for production.

## Decision

RITSEI selects PostgreSQL 19 `WAIT FOR` as the planned infrastructure mechanism for
replica-backed read-your-writes consistency.

The decision is accepted, but implementation and production activation are deferred. Activation is
route-scoped rather than a universal requirement for every read.

### Consistency taxonomy

Routes declare one of these semantics:

```text
eventual or bounded-stale
-> replica or projection may lag within the declared contract

read-your-writes
-> after a caller's accepted command, a subsequent query observes at least that commit

authoritative-current
-> current owner-controlled state is required; use the approved authoritative path

transactional
-> the read participates in the command transaction or invariant evaluation
```

`WAIT FOR` can satisfy the selected read-your-writes contract when every activation gate passes. It
does not satisfy `authoritative-current` or `transactional` semantics.

The guarantee is:

```text
replica_position >= required_position
```

It is not:

```text
replica_state == primary_state_now
```

### Opaque consistency context

Application and transport boundaries may carry an opaque `ConsistencyToken`. Domain packages,
business DTOs, capability IDs, domain events, entity addresses, and Process IR must not expose raw
PostgreSQL WAL or LSN types.

The PostgreSQL adapter may encode implementation details such as:

```text
token version
+ PostgreSQL placement or cluster identity
+ timeline identity
+ WAL position
+ optional expiry or routing constraints
```

The token grants no authorization, ownership, durability, or workload priority. It is validated by
the query infrastructure before use. Clients must not construct or modify its contents.

### Route-scoped activation gates

A route may activate replica-backed read-your-writes only after all of these pass:

- PostgreSQL 19 GA is the deployed production floor;
- a concrete route declares a real replica-backed read-your-writes requirement;
- command completion can capture the required post-commit consistency position;
- application or transport infrastructure propagates an opaque consistency token without leaking
  PostgreSQL types into domain contracts;
- the replica adapter executes `WAIT FOR` as a top-level operation before opening the read snapshot;
- timeout, cancellation, malformed-token, expired-token, recovery-conflict, promotion, and timeline
  mismatch behavior are typed and fail closed;
- the route declares maximum wait and its degraded or unavailable response;
- hard-isolated query workers have only replica credentials and no primary fallback;
- current authorization and tenant scope can be evaluated through the route's approved bounded
  resources;
- load, lag, restart, promotion, failover, timeline, and recovery-conflict tests pass;
- observability reports wait duration, result status, replica lag, token rejection, timeout,
  promotion, and route outcome without logging raw sensitive token contents.

Before activation, required read-after-write behavior remains on the existing authoritative path.
Ordinary stale-tolerant replica and projection routes do not need a consistency token.

### Failure and fallback rules

`WAIT FOR` success means the selected standby reached the required position for the expected
placement and timeline. Timeout or uncertainty does not permit a hard-isolated query route to use a
primary credential or command pool.

The route returns its declared typed outcome, such as retryable unavailable, timeout, stale response
when contractually safe, or a client-directed retry. A route requiring `authoritative-current` is
classified and admitted as an authoritative query instead of disguising primary fallback as
read-your-writes recovery.

Promotion and timeline changes invalidate assumptions based only on a numeric WAL position. The
adapter validates the token's placement and timeline context and rejects or re-resolves uncertain
positions according to the route contract.

## Alternatives Considered

### Delay all architectural selection until the first route

Rejected. It invites incompatible consistency tokens and route semantics to emerge independently.
The activation remains deferred, but the architectural slot and vocabulary are selected now.

### Expose raw PostgreSQL LSN values in public business contracts

Rejected. WAL positions and timelines are infrastructure details and would couple domains and
external clients to PostgreSQL topology.

### Route every read-after-write query to the primary

Retained as the default before activation and for authoritative-current reads, but rejected as the
only long-term mechanism. It prevents selected bounded query workloads from using isolated replicas.

### Use synchronous replication as the application read-your-writes contract

Rejected as the route-level mechanism. Replication durability and query visibility are different
concerns, and synchronous replication alone does not define query routing, token propagation,
authorization, timeout, or no-fallback behavior.

### Poll replica replay functions in application code

Rejected as the selected PostgreSQL 19 mechanism. `WAIT FOR` provides the database-owned wait
operation, timeout, and status semantics, while RITSEI still owns token validation and route
policy.

## Consequences

### Positive

- Read consistency vocabulary is fixed before routes proliferate.
- Replica-backed read-your-writes has a selected PostgreSQL-native mechanism.
- Domain contracts remain independent of WAL, LSN, timeline, and topology details.
- Route activation remains measurable and reversible.
- No-primary-fallback and workload non-interference remain intact.

### Negative

- Command and query composition roots need consistency-context plumbing before activation.
- Failover and timeline validation are more complex than waiting on a numeric LSN.
- Routes may return timeout or unavailable even while the primary is healthy.
- PostgreSQL 19 GA, driver behavior, pooler behavior, and replica topology become activation
  dependencies.

### Risks

- Treating read-your-writes as globally current could expose stale decisions.
- Leaking raw LSN values could turn PostgreSQL topology into a public compatibility contract.
- Accepting tokens from the wrong placement or timeline could report false success.
- Hidden primary fallback could invalidate non-interference claims.
- Unbounded waits could exhaust query resources and amplify retry storms.
- Using the mechanism for authorization-sensitive results without a current bounded authorization
  path could disclose revoked data.

## Validation

Before the first route activates this decision, executable tests must prove:

- token integrity, versioning, tenant binding where applicable, placement binding, and timeline
  validation;
- visibility of the caller's committed write after successful `WAIT FOR`;
- absence of a claim that later unrelated primary commits are visible;
- bounded timeout and cancellation with complete resource release;
- malformed, expired, replayed across incompatible placement, and wrong-timeline token rejection;
- standby restart, lag, promotion, upstream timeline switch, and recovery-conflict handling;
- no query credential, code path, configuration, or retry fallback reaches the primary;
- current authorization and tenant scope remain enforced;
- command latency and reserve remain within the reviewed objective during replica lag and query
  saturation;
- disabling the route-level feature returns the route to its previously approved consistency path.

## Related Documents

- [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
- [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
- [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
- [`../deployment/README.md`](../deployment/README.md)
