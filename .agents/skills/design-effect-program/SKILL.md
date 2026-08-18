---
name: design-effect-program
description: "Use when designing, explaining, reviewing, or changing an RITSEI Effect program's success flow, typed failures, service requirements, boundary decoding, resource scope, or production/test call graph."
---

# Purpose

Turn an RITSEI operation into a readable Effect v4 program whose success path, failures,
requirements, trust boundaries, and test substitutions match the real call graph.

# Use This Skill When

- adding or changing an `Effect<A, E, R>` workflow;
- deciding between `Effect` and `Stream`;
- reviewing tangled `Effect.gen`, error mapping, retry, fallback, or layer composition;
- explaining production and test execution flows;
- introducing boundary decoding or scoped resources.

# Do Not Use This Skill When

- the change contains no Effect code or design;
- the task is only an Effect v4 API rename; use the installed `effect-v4-conventions` skill;
- a static dependency or public-export violation is the only issue; use the repository call-graph
  and boundary checks.

# Required Context

Read the complete operation, every caller, the public service contract, tagged failures, layers,
tests, and relevant boundary code. Find the nearest existing implementation first. Before writing
Effect code, consult the installed `effect-v4-conventions` skill and the vendored Effect v4 source
under [`../../../vendor/effect-smol`](../../../vendor/effect-smol).

# Architecture Rules

- Treat `A` as the successful data flow, `E` as expected typed failures, and `R` as required
  services.
- Name domain records, branded identifiers, state variants, and tagged errors before composing the
  workflow.
- Make the success path readable as the operation's call graph. Do not add an abstraction merely to
  make a diagram symmetrical.
- Decode untrusted external input with Effect Schema at each public trust boundary. After successful
  decoding, downstream code within that boundary relies on the decoded type.
- Translate failures at the layer that owns and can act on them. Domain callers must not receive
  Drizzle, PostgreSQL, driver, or transport failures.
- Retry only transient, idempotent work. Use fallback only when the contract defines a valid
  alternative. Keep anticipated validation, authorization, conflict, not-found, and known constraint
  failures in `E`; reserve defects for programmer bugs and genuinely impossible states.
- Keep common error translation, timeout, retry, tracing, and similar policy outside the linear
  success path when that improves readability. Handle a branch locally when sibling operations
  require different failure semantics.
- Resolve every service dependency through `R` with Context/Layer when constructing the service;
  plain constructor parameters that bypass `R` are not a substitute. Individual methods may close
  over resolved dependencies and omit them from their own `R`. Do not hide dependencies in globals
  or construct infrastructure inside a domain.
- Acquire resources with scoped Effect constructors and structural finalizers.
- Production and tests should exercise the same public operation. Tests replace `R` through layers;
  they do not fork a second business workflow.
- Choose `Effect` for one result and `Stream` for multiple values over time. Do not add caching or
  deduplication without an actual validity window or measured need.

# Workflow

## 1. Name the Shapes

List only the values that cross nodes: inputs, outputs, identifiers, variants, and actionable
errors. Reuse repository schemas and errors.

## 2. Draw the Success Graph

Write the shortest call graph that produces `A`:

```text
input
  → decode
  → authorize
  → owning service operation
  → result
```

Mark whether each node is one-shot (`Effect`) or multi-value (`Stream`).

## 3. Annotate Failures and Requirements

For each node, record:

```text
node | expected E | retry/fallback/propagate | required R
```

Map implementation failures before they cross their owning boundary. Preserve distinct public
failures only when callers can respond differently.

## 4. Mark Boundaries and Scope

Identify every public trust boundary where `unknown` enters and every place resources are acquired.
Decode at each boundary, then avoid repeated decoding within that boundary. Tie resource release to
scope.

## 5. Implement the Graph

Use the `Effect.gen` body for the linear success flow. Apply shared failure translation and
operational policy with composition around that flow. Keep branch-specific recovery next to the
branch when an outer handler cannot distinguish the required semantics.

## 6. Prove with Layers

Run the same public operation with production and test layers. If a test must replace the workflow
rather than its requirements, inspect for hidden dependencies or an oversized service.

## 7. Explain Consistently

When the user asks for a call graph or execution trace, use plain text, indented `→` arrows, and
separate production/test blocks when their layers differ:

```text
Production:
HTTP handler
  → DomainService
    → DatabaseService

Tests:
contract test
  → DomainService
    → in-memory test layer
```

This explanatory trace complements, but does not replace, `deno task callgraph:check`.

# Deterministic Tools

```sh
deno task callgraph:check
deno task boundary:lint
deno task check
```

Run the smallest focused `@effect/vitest` test that proves the changed success and failure flow.

# Required Checks

- the success path matches the real call order;
- each expected failure has one owner and one deliberate strategy;
- no infrastructure failure leaks through a domain or HTTP contract;
- every service dependency is resolved through `R` when its consuming service is constructed;
- untrusted input is decoded at every applicable public trust boundary;
- resource cleanup is scoped;
- production and tests use the same public workflow;
- Effect v4 APIs were verified against the vendored source.

# Failure Conditions

Stop when the call graph crosses a private package boundary, a failure has no clear owner, retry
safety is unknown, a resource cannot be released structurally, or production and test behavior
require different business logic.

# Completion Criteria

The operation reads in execution order, exposes only actionable typed failures, declares its
services, validates each public trust boundary, scopes resources, and remains testable by replacing
layers rather than rewriting the workflow.

# Related Skills

- [`develop-enterprise-feature`](../develop-enterprise-feature/SKILL.md)
- [`expose-public-contract`](../expose-public-contract/SKILL.md)
- [`add-api-endpoint`](../add-api-endpoint/SKILL.md)
- [`implement-transactional-workflow`](../implement-transactional-workflow/SKILL.md)

# References

- [Effect v4 vendored source](../../../vendor/effect-smol/packages/effect/src/Effect.ts)
- [Architecture enforcement and static call graph](../../../docs/architecture/architecture-enforcement.md)
- [Failure ownership rules](../../../AGENTS.md#failure-ownership-and-translation)
- [Design Thinking source gist](https://gist.github.com/r17x/90eb2f7be93932b5693753aedb09c01a)
