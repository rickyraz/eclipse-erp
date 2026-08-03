# EclipseERP Architecture

EclipseERP is an orthogonal modular monolith built around explicit
domain ownership, PostgreSQL-enforced integrity, Effect-based application
services, and independently deployable frontend infrastructure.

## Canonical Specification

The authoritative architecture specification is:

[`docs/architecture/architecture-spec-v4.md`](./docs/architecture/architecture-spec-v4.md)

## Core Architecture

- Runtime: Deno
- Language: TypeScript strict
- Application model: Effect
- Database: PostgreSQL 19+
- Query layer: Drizzle ORM + postgres.js
- Frontend: Vite + SolidJS 2.0
- Contracts: Effect Schema
- Native compute: optional Zig through `Deno.dlopen`

## Dependency Ownership

```text
             ┌─────────────────────┐
             │    package.json     │
             │                     │
             │ npm dependencies    │
             │ JSR dependencies    │
             │ dev dependencies    │
             └──────────┬──────────┘
                        │
                        ▼
                  deno install
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
         node_modules         deno.lock


             ┌─────────────────────┐
             │      deno.json      │
             │                     │
             │ runtime             │
             │ permissions         │
             │ compiler            │
             │ fmt / lint          │
             │ tasks               │
             └─────────────────────┘