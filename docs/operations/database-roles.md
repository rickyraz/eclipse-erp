# Database Roles and Privileges

> **Status:** Canonical
>
> **Owns:** PostgreSQL runtime roles, privilege boundaries, grant strategy, and
> role-level enforcement of schema ownership.
>
> **Related documents**
>
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Workload isolation: [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - Authorization architecture: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)

## Purpose

Application-level module boundaries must be reinforced by PostgreSQL privileges.
No normal runtime process should connect as a superuser or schema owner.

## Role Classes

Recommended login and group roles:

```text
eclipse_migrator
eclipse_api
eclipse_worker
eclipse_event_relay
eclipse_reporting
eclipse_observer
eclipse_break_glass
```

A hard-isolated deployment additionally uses distinct login identities such as:

```text
eclipse_command
eclipse_projection_query
eclipse_query_authorizer
eclipse_async_worker
```

These names describe deployment responsibility, not business capability ownership. A minimal
colocated profile may retain `eclipse_api` and `eclipse_worker`, but it cannot claim the same physical
resource separation.

Additional non-login ownership roles may exist per schema:

```text
eclipse_owner_identity
eclipse_owner_auth
eclipse_owner_sales
eclipse_owner_inventory
eclipse_owner_accounting
eclipse_owner_billing
eclipse_owner_workflow
eclipse_owner_integration
eclipse_owner_audit
```

## Hard-Isolation Role Boundaries

`eclipse_command` connects to the PostgreSQL primary through the command pool and may execute the
approved domain transactions required by public commands. It is used by command-capable API and
worker composition roots and receives the command resource reserve.

`eclipse_projection_query` connects only to the approved projection store or isolated read path. It
must not:

- possess a PostgreSQL-primary credential;
- inherit `eclipse_api` or schema-owner privileges;
- open command transactions;
- use a configuration fallback to the command pool or primary.

`eclipse_query_authorizer` is optional when sensitive projection reads require current
owner-controlled authorization. It uses a separate, bounded, read-only primary pool and may invoke
only approved owner-controlled authorization-check contracts or functions, including the current
scope, relationship, and SoD checks those owners require. If the required owner state is unavailable
through that bounded path, the request is authoritative rather than hard-isolated. The role must not
use the command pool, mutate grants, or read arbitrary domain payloads. Saturation fails the query
path closed.

`eclipse_async_worker` uses an async-specific pool and only the privileges required by registered
PgQue consumers, job lifecycle, projection builders, workflow orchestration, and integration
delivery. It must not receive broad mutation rights to core domain schemas. When async orchestration
initiates a canonical business command, it uses the existing job or workflow durability semantics to
hand work to a command-capable worker using the `eclipse_command` path. Domain services are invoked
locally rather than through loopback HTTP. Its maximum connections must not consume the command
reserve.

Separate login roles on one PostgreSQL instance provide privilege and connection isolation, not
complete CPU, I/O, WAL, lock, or storage isolation. Deployment claims must name the resources that
are physically independent.

### PostgreSQL Connection-Admission Reserve

A PostgreSQL 19 deployment may use `reserved_connections` as the server-level mechanism for the
reviewed command connection reserve. Grant the predefined `pg_use_reserved_connections` role only
to `eclipse_command`; query, reporting, and async lifecycle roles must not inherit it.

```sql
GRANT pg_use_reserved_connections TO eclipse_command;
```

Budget available ordinary slots as:

```text
ordinary_slots =
  max_connections
  - reserved_connections
  - superuser_reserved_connections
```

Pool maxima, administrative headroom, and other runtime connections must fit the reviewed budget.
The command role may use ordinary slots during normal operation; the server reserve controls which
roles may establish a new connection after ordinary slots are exhausted. It is therefore a
connection-admission reserve, not a dedicated command pool or a CPU, memory, I/O, WAL, lock, or
storage guarantee. `superuser_reserved_connections` remains an emergency administrative reserve and
must not be consumed by application roles.

A workload-isolated deployment must prove that ordinary slots can be saturated while a command role
can still establish a bounded connection, and that query and async roles cannot use the server
reserve. Application admission and pool ceilings remain required because the database reserve does
not bound work after a connection is acquired.

Secrets for these roles must be delivered only to their intended composition roots. Query images,
containers, or processes must not receive the command secret even when the application packages are
shared.

## Migrator Role

`eclipse_migrator` may:

- execute reviewed migrations;
- create or alter approved schemas;
- create tables, constraints, indexes, functions, views, policies, and grants;
- assume controlled schema-owner roles during deployment.

It must not be used by API, worker, relay, or reporting processes.

## API Role

`eclipse_api` may:

- connect to the application database;
- use approved schemas and public functions;
- read and write domain data required by synchronous requests;
- set validated tenant and principal context;
- execute approved transaction-aware operations.

It must not:

- execute DDL;
- bypass RLS;
- assume schema-owner roles;
- use superuser privileges;
- access operational secrets stored outside its responsibility.

## Worker Role

`eclipse_worker` may:

- execute approved background jobs;
- access domain operations required by those jobs;
- consume relevant PgQue streams;
- update job lifecycle state;
- start or resume approved durable workflows.

Its privileges should be narrower than the union of all application schemas.
Grant only what registered worker capabilities require.

## Event Relay Role

`eclipse_event_relay` may:

- read approved PgQue streams;
- access integration outbox state;
- update delivery attempts and cursors;
- write integration-delivery audit information.

It should not have broad mutation access to core accounting, inventory, sales,
or authorization tables.

## Reporting Role

`eclipse_reporting` is read-only and may access:

- approved reporting views;
- safe projections;
- explicitly granted reference data.

It must not read raw sensitive columns unless the reporting requirement and data
classification explicitly allow it.

## Observer Role

`eclipse_observer` may read operational metadata required for monitoring, such
as approved statistics, health views, and migration state.

It must not read business payloads by default.

## Break-Glass Role

`eclipse_break_glass` is reserved for exceptional administration.

Requirements:

- no routine application use;
- strong authentication;
- time-bounded access;
- explicit approval;
- complete audit logging;
- post-use review;
- credential rotation or revocation after use.

## Ownership Model

Objects should be owned by non-login owner roles, not by runtime login roles.

Example:

```sql
CREATE ROLE eclipse_owner_inventory NOLOGIN;
CREATE ROLE eclipse_api LOGIN;
CREATE ROLE eclipse_worker LOGIN;
```

The migrator may assume an owner role under controlled deployment procedures.
Runtime roles receive only required grants.

## Default Privileges

Set default privileges so newly created objects do not accidentally become
publicly accessible.

Review at least:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE eclipse FROM PUBLIC;
```

Grant `USAGE`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and function execution
explicitly according to responsibility.

## Schema Ownership Enforcement

The role model should reflect the same ownership registry used by architecture
tooling.

```text
schema owner
-> owns DDL objects

runtime role
-> receives narrow DML or function privileges

non-owner domain
-> reaches behavior through an approved contract
```

Direct cross-domain table access should be denied where practical. When a shared
transaction requires cross-domain behavior, expose an approved database
function or application service rather than granting arbitrary table access.

## RLS Context

Application roles must set tenant and principal context through a validated,
transaction-local mechanism.

Requirements:

- context cannot leak across pooled connections;
- every transaction resets or sets context explicitly;
- missing context fails closed;
- privileged maintenance paths are separate and audited.

## Search Path

Use an explicit, restricted `search_path`. Security-sensitive functions should
set a safe search path and use schema-qualified references.

Do not depend on mutable global search-path assumptions.

## Secrets

Database credentials must be:

- unique per runtime role;
- stored in a secret manager or equivalent protected mechanism;
- rotated independently;
- absent from source control and logs;
- scoped to the intended environment.

## Testing

Privilege tests must prove that:

- runtime roles cannot execute DDL;
- reporting cannot mutate state;
- relay cannot mutate core domain tables;
- tenant context is required;
- RLS isolates tenants;
- unauthorized cross-schema writes fail;
- owner and break-glass privileges are not available to normal processes;
- projection-query credentials cannot connect to or inherit privileges on the primary;
- query-authorizer credentials are read-only, narrowly granted, separately pooled, and fail closed;
- async lifecycle credentials cannot mutate core domain facts outside the command path;
- async and query pool maxima cannot consume the reviewed command connection reserve;
- only the command login inherits `pg_use_reserved_connections`;
- ordinary-slot saturation still permits a bounded command connection while query and async
  connection attempts fail;
- `superuser_reserved_connections` remains unavailable to all application roles;
- pooled tenant and principal context cannot leak across workload roles.

## Operational Review

Review role grants:

- before production launch;
- after adding a module;
- after adding a plugin capability;
- after a security incident;
- during periodic access reviews.

## Completion Criteria

The role model is complete when:

- every process has a dedicated role;
- isolated command, projection-query, and async composition roots receive only their own secrets;
- no normal process uses superuser or schema-owner credentials;
- grants match the schema ownership registry;
- privilege tests run in CI or deployment validation;
- break-glass access is controlled and audited.
