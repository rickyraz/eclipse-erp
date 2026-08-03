---
name: add-api-endpoint
description: "Use when exposing or changing EclipseERP HTTP behavior in apps/api, including an endpoint schema, handler, authentication middleware, error mapping, OpenAPI contract, or service layer wiring."
---

# Purpose

Add an Effect-native HTTP endpoint that delegates to a public domain contract and derives decoding, errors, routing, and OpenAPI from one contract.

# Use This Skill When

- adding a route under `apps/api/`;
- exposing a domain command or query over HTTP;
- changing payload, params, headers, response, security, or transport errors;
- adding a service to API composition.

# Do Not Use This Skill When

- the domain operation does not yet exist; use `expose-public-contract` first;
- adding frontend routing;
- adding Hono, Express, Fastify, NestJS, `node:http`, or direct `Deno.serve` code.

# Required Context

Inspect [`apps/api/api.ts`](../../../apps/api/api.ts), [`apps/api/handlers.ts`](../../../apps/api/handlers.ts), [`apps/api/mod.ts`](../../../apps/api/mod.ts), the OpenAPI test, and the target package’s `mod.ts` contract.

# Architecture Rules

- Use Effect v4 `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, and `HttpRouter`.
- The canonical Deno adapter owns native serving and runtime execution.
- Decode transport input with Effect Schema and call public domain services only.
- Authentication and authorization are separate; protected behavior is enforced by the backend.
- Map domain failures to stable transport errors without exposing database details or stack traces.
- Handlers remain thin and do not own business invariants or query construction.

# Workflow

## 1. Inspect

Confirm the public operation, tagged failures, required capability, tenant/principal context, and existing API error mapping.

## 2. Decide

Define method, path, params, headers, payload, success status/schema, security middleware, and explicit transport-error mapping. Reuse existing error classes unless the caller needs a distinct recovery action.

## 3. Implement

1. Add the endpoint to the appropriate `HttpApiGroup` in `api.ts`.
2. Add a thin handler in `handlers.ts` that obtains context and calls the public service.
3. Wire a new service layer in `mod.ts` only if the API composition does not already provide it.
4. Extend the OpenAPI/route test.
5. Compose with `add-authorization-capability` when introducing a protected business action.

## 4. Validate

Verify generated OpenAPI, typed handler compatibility, security middleware, and boundary rules.

# Deterministic Tools

```sh
deno task test -- apps/api/mod.test.ts tests/architecture/http.test.ts
deno task boundary:test
deno task boundary:lint
deno task check
```

Consult the vendored Effect v4 source before changing HttpApi or Layer code.

# Required Checks

- endpoint and handler names match;
- protected routes use bearer middleware and server-side capability checks;
- request/response schemas are transport-safe public contracts;
- domain errors map to appropriate HTTP status and recovery semantics;
- no backend implementation leaks to the frontend or API response;
- OpenAPI test includes the new route.

# Failure Conditions

Stop when the domain contract is missing, authorization semantics are undefined, an endpoint would expose raw persistence types, or the change requires a new HTTP framework/runtime decision.

# Completion Criteria

The endpoint is derived from Effect HttpApi, delegates to a public domain service, enforces security, appears in OpenAPI, and passes HTTP, boundary, and type checks.

# Related Skills

- [`expose-public-contract`](../expose-public-contract/SKILL.md)
- [`add-authorization-capability`](../add-authorization-capability/SKILL.md)
- [`implement-transactional-workflow`](../implement-transactional-workflow/SKILL.md)

# References

- [ADR-0012: Effect-native HTTP](../../../docs/decisions/0012-use-drizzle-schema-flow-and-effect-http.md)
- [ADR-0017: Deno adapter](../../../docs/decisions/0017-use-effect-platform-deno.md)
- [HTTP architecture test](../../../tests/architecture/http.test.ts)
- [API contract](../../../apps/api/api.ts)
- [API handlers](../../../apps/api/handlers.ts)
