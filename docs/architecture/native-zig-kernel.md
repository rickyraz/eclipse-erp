# Native Zig Calculation Kernel

> **Status:** Optional architecture
>
> **Related documents**
>
> - Active FFI boundary: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Zig ADR: [`../decisions/0008-gate-zig-behind-benchmarks.md`](../decisions/0008-gate-zig-behind-benchmarks.md)
> - PostgreSQL ownership: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)

## Position

If EclipseERP adopts Zig, it should be used for bounded deterministic compute,
not for the HTTP API, ORM, or transaction manager.

## Strong Candidates

- fixed-point monetary arithmetic;
- double-entry validation;
- deterministic allocation;
- high-volume reconciliation;
- streaming import validation;
- document transformation.

## Boundary

```text
Effect application
  |
Deno FFI adapter
  |
Zig calculation kernel
  |
pure input -> pure output
```

The kernel does not commit transactions and does not own authoritative state.

## Required Contract

The FFI boundary must define:

- ABI version;
- stable serialized input and output;
- memory allocation and release;
- maximum input size;
- deterministic behavior;
- error codes;
- timeout and cancellation behavior;
- TypeScript fallback;
- benchmark threshold.

## Money Representation

Use fixed-point values rather than floating point. A value should carry at least:

```text
minor_units
scale
currency
```

Allocation algorithms must preserve:

```text
sum(input) = sum(output) + explicit_residual
```

## Activation Gate

Enable native execution only when benchmarks show a meaningful improvement on a
representative workload and correctness matches the TypeScript baseline.
