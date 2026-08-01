# Database Roles and Privileges

> **Status:** Canonical
>
> **Owns:** PostgreSQL runtime roles, privilege boundaries, grant strategy, and
> role-level enforcement of schema ownership.
>
> **Related documents**
>
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
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
- owner and break-glass privileges are not available to normal processes.

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
- no normal process uses superuser or schema-owner credentials;
- grants match the schema ownership registry;
- privilege tests run in CI or deployment validation;
- break-glass access is controlled and audited.
