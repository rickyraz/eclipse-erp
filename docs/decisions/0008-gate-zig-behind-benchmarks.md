# ADR-0008: Gate Zig Behind Benchmarks

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

Financial calculation, import, and reconciliation may benefit from deterministic
native execution, but FFI increases safety, deployment, debugging, and
compatibility risk.

## Decision

Keep Zig optional behind an Effect adapter using `Deno.dlopen`. Use it only for
bounded calculation or reconciliation kernels after benchmark evidence.

## Consequences

A TypeScript implementation remains the correctness baseline and fallback.
Native ABI, memory ownership, failure mapping, and benchmark thresholds must be
documented.

## Validation

Run differential correctness tests and representative performance benchmarks.
