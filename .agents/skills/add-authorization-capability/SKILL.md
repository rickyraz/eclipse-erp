---
name: add-authorization-capability
description: "Use when adding a permission or protected business action, changing authorization scope or policy, or when a request says who may approve, post, reserve, assign, reverse, or otherwise perform a sensitive operation."
---

# Purpose

Introduce a deny-by-default business capability and enforce it consistently in domain/API behavior and tests.

# Use This Skill When

- adding a literal to the authorization capability registry;
- protecting a new command or query;
- changing tenant, resource, warehouse, branch, or other scope semantics;
- implementing approval, posting, reversal, adjustment, or role-assignment authority.

# Do Not Use This Skill When

- only hiding or disabling a frontend control;
- authentication/session behavior is the actual change;
- arbitrary tenant SQL or scripts are proposed as policy.

# Required Context

Inspect [`packages/authorization/src/service.ts`](../../../packages/authorization/src/service.ts), the target domain service, API middleware/handler, authorization tests, and the canonical capability model.

# Architecture Rules

- Permissions represent business actions, not broad CRUD.
- Authorization denies by default and is tenant/scope aware.
- Authentication does not imply authorization.
- Frontend visibility is UX only; the backend must enforce every protected operation.
- PostgreSQL RLS is defense in depth, not the sole policy engine.
- High-risk decisions require allow, deny, scope-mismatch, and Separation-of-Duties review; do not invent unsupported policy machinery.

# Workflow

## 1. Inspect

Locate the authoritative command/query and every entry path. Determine current principal and tenant context, risk level, existing related capabilities, and whether scope exceeds the repository’s current membership model.

## 2. Decide

Choose a narrow capability name in `<domain>.<resource>.<action>` form. Define scope, denial behavior, explanation needs, SoD implications, and audit expectations.

## 3. Implement

1. Add the capability to the Effect Schema literal registry.
2. Enforce it in the owning backend service or handler before mutation/read.
3. Update test layers and fixtures.
4. Add explicit allow, default-deny, and scope-mismatch tests.
5. Update API schemas only when the capability is assignable through the public API.

The audit package and production RLS policy path are not implemented yet. For high-risk actions, report that gap rather than fabricating an audit store or claiming RLS coverage.

## 4. Validate

Run authorization, affected domain/API, contract, and boundary tests.

# Deterministic Tools

```sh
deno task test -- packages/authorization/tests/authorization.test.ts
deno task test:contract
deno task boundary:lint
deno task check
```

Effect Schema keeps capability values closed at compile/runtime boundaries; tests prove default deny and scope behavior.

# Required Checks

- capability name expresses one business action;
- every backend entry path enforces it;
- allow, deny, and scope mismatch are tested;
- test layers do not silently bypass authorization;
- assignment APIs cannot grant unknown capabilities;
- audit/RLS gaps are explicitly reported for high-risk operations.

# Failure Conditions

Stop when the action owner is unclear, scope cannot be represented safely by the current model, the change relies only on frontend checks, or static/dynamic SoD rules are required but undefined.

# Completion Criteria

The capability is closed-schema, narrowly named, enforced server-side at every entry path, and covered by positive and negative authorization tests.

# Related Skills

- [`add-api-endpoint`](../add-api-endpoint/SKILL.md)
- [`expose-public-contract`](../expose-public-contract/SKILL.md)
- [`implement-transactional-workflow`](../implement-transactional-workflow/SKILL.md)

# References

- [Authorization architecture](../../../docs/architecture/authorization.md)
- [ADR-0006: capability authorization](../../../docs/decisions/0006-use-capability-based-authorization.md)
- [Authorization service](../../../packages/authorization/src/service.ts)
- [Authorization tests](../../../packages/authorization/tests/authorization.test.ts)
- [Testing strategy](../../../docs/development/testing.md)
