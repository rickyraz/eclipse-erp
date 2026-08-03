# ADR-0019: Adopt a Typed External Integration Surface Profile

- Status: Accepted
- Date: 2026-08-03
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - External integration architecture:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - External standards adapters: [`./0013-version-external-standard-adapters.md`](./0013-version-external-standard-adapters.md)
> - Plugin trust: [`./0007-adopt-tiered-plugin-trust.md`](./0007-adopt-tiered-plugin-trust.md)

## Context

EclipseERP should be integration-aware without turning Process Studio into a
generic low-code or broker-management product. External developers need a
familiar public interface, while EclipseERP must preserve domain ownership,
typed contracts, tenant isolation, authorization, idempotency, audit, and
compensation.

Transport protocols must therefore remain connector concerns. Business meaning
must remain in domain packages and public Process Studio catalogs.

## Decision

EclipseERP adopts this default external integration profile:

```text
Actions:
  HTTPS + JSON
  OpenAPI 3.2.0

Events:
  CloudEvents 1.0.x over HTTPS/Webhook
  AsyncAPI 3.1.0 as machine-readable message contract

Authentication:
  OAuth 2.0
  RFC 9700 security best current practice

Errors:
  RFC 9457 Problem Details
```

### Domain and External Namespaces

The system keeps these contracts distinct:

```text
DomainAction
ExternalAction
DomainEvent
ExternalEvent
```

An external connector action may invoke a public domain command, but it does not
own the domain invariant. An external event is authenticated, validated,
deduplicated, and normalized before it is consumed by a domain or Process
Studio.

### Connector Layer

The connector layer owns:

- OpenAPI import and operation allowlisting;
- HTTP, webhook, and provider protocol translation;
- credentials and OAuth scopes;
- CloudEvents envelope validation;
- AsyncAPI catalog/binding interpretation;
- provider retries, rate limits, timeouts, and delivery logs;
- external error normalization;
- provider idempotency and unknown-outcome handling;
- compensation or manual-recovery declaration.

The Process Studio sees typed `ExternalAction` and `ExternalEvent` contracts. It
does not see Kafka partitions, consumer groups, protobuf packages, SOAP envelopes,
raw tokens, or provider database identifiers.

### Advanced Protocols

gRPC, Kafka, AMQP, NATS, SQS, Pub/Sub, EventBridge, SOAP, and OData may be
implemented as connector adapters for controlled or legacy environments. They
are not the universal public Process Studio interface.

GraphQL is not the default external action contract. BPMN is not an integration
protocol; it remains an interoperability format for Process IR.

### Authorization

OAuth scope authorizes a connector to call an external integration surface.
Domain capabilities authorize the tenant or principal to perform an EclipseERP
business action. One must never be silently converted into the other.

Machine-to-machine connectors use OAuth 2.0 Client Credentials with explicit
scopes. User-authorized applications use Authorization Code with PKCE where
interactive delegation is required.

### Reliability and Compensation

External calls never extend a PostgreSQL transaction across the network. Every
side-effecting external action declares idempotency, timeout, retry, provider
operation status, and compensation or manual recovery.

A provider refund, reversal, or cancellation is a new business operation. The
connector and owning domain must expose it explicitly; the runtime never infers
compensation from an operation name.

## Alternatives Considered

### Kafka or Another Broker as the Public Interface

Rejected as the default. Brokers remain useful behind advanced connector
adapters, but requiring topics, partitions, consumer groups, offsets, or broker
credentials would make ordinary external integration unnecessarily complex.

### gRPC as the Universal Interface

Rejected as the default. gRPC remains appropriate for controlled internal or
high-throughput integrations, but public developer interoperability starts with
HTTPS and JSON.

### GraphQL as the Universal Action Surface

Rejected. GraphQL is not the canonical command contract for domain actions and
would not by itself provide the required action idempotency, compensation,
workflow, or ownership semantics.

### BPMN as the Integration Protocol

Rejected. BPMN is a process interoperability format, not a transport or
provider contract. Eclipse Process IR remains runtime truth.

### Generic Action Namespace

Rejected. Treating `Inventory.ReserveStock` and `Midtrans.CreatePayment` as one
unqualified action kind would blur domain ownership, connector failures,
authorization, and compensation.

### Proprietary EclipseERP SDK

Rejected as a prerequisite. SDKs may be generated later from OpenAPI and
catalogs, but external developers must be able to integrate with standard HTTP,
JSON, OAuth, and event contracts directly.

## Consequences

### Positive

- External developers get a familiar HTTP/JSON integration path.
- Process Studio remains domain-aware and only slightly integration-aware.
- Domain actions and external connector operations cannot silently become the
  same semantic type.
- AsyncAPI and CloudEvents provide machine-readable event discovery without
  forcing one broker.
- Existing enterprise protocols can be supported behind adapters.
- Provider retries, secrets, and transport failures remain outside domain
  invariants.
- OpenAPI import can generate connector actions without requiring proprietary
  SDKs.

### Negative

- The connector layer must map multiple external representations and error
  models.
- External operation state and unknown outcomes require explicit handling.
- Supporting OpenAPI, CloudEvents, AsyncAPI, OAuth, and RFC 9457 introduces
  compatibility and versioning work.
- External action compensation is harder than local transaction rollback.

### Risks

- An imported OpenAPI document may expose unsafe or irrelevant operations.
- A provider event may be authentic but semantically incompatible with a domain.
- OAuth scopes may be mistaken for business capabilities.
- Connector retries may duplicate provider effects without idempotency keys.
- Connector metadata may drift from provider behavior.
- `packages/integrations` may become a dumping ground without adapter ownership
  and version boundaries.

Mitigations are owned by the canonical integration architecture: operation
allowlists, typed schemas, explicit namespaces, provider idempotency, signature
verification, bounded retries, stable errors, connector versioning, and domain
contract validation.

## Validation

The decision is validated when:

- an OpenAPI description can produce an allowlisted, versioned ExternalAction;
- a CloudEvent webhook can be authenticated, validated, deduplicated, and
  normalized to an ExternalEvent;
- AsyncAPI describes event contracts without becoming transport runtime truth;
- OAuth scope checks and domain capability checks remain separate;
- external errors map to stable RFC 9457-compatible integration failures;
- provider timeout, retry, unknown outcome, duplicate delivery, and compensation
  tests pass;
- no connector imports private domain modules or mutates core tables;
- Process Studio can compose external contracts without exposing transport
  internals;
- secrets, tenant scope, audit, redaction, rate limits, and observability are
  enforced.

## Related Documents

- [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
- [`../architecture/process-studio.md`](../architecture/process-studio.md)
- [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
- [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
- [`../roadmap/README.md`](../roadmap/README.md)
