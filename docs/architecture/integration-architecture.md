# External Integration Surface Architecture

> **Status:** Canonical target architecture
>
> **Owns:** external action/event contracts, connector boundaries, transport
> profiles, protocol normalization, integration authentication, delivery
> reliability, and Process Studio integration awareness.
>
> **Implementation status:** Planned. The profile is a compatibility target; it
> does not imply that every adapter or protocol is implemented today.
>
> **Related documents**
>
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - Plugin trust: [`./plugin-architecture.md`](./plugin-architecture.md)
> - Messaging: [`./pgque-messaging.md`](./pgque-messaging.md)
> - External standards ADR: [`../decisions/0013-version-external-standard-adapters.md`](../decisions/0013-version-external-standard-adapters.md)
> - Integration profile ADR: [`../decisions/0019-adopt-integration-surface-profile.md`](../decisions/0019-adopt-integration-surface-profile.md)
> - Roadmap: [`../roadmap/README.md`](../roadmap/README.md)

## Purpose

EclipseERP is integration-aware without turning Process Studio into a generic
integration canvas or exposing transport internals to business users.

External developers receive familiar, machine-readable HTTP and event contracts.
EclipseERP normalizes those contracts through a connector layer before Process
Studio can compose them.

```text
External Developer / Third Party
              |
              v
+---------------------------------------+
| Integration Surface                   |
|                                       |
| Actions  HTTPS + JSON + OpenAPI 3.2  |
| Events   CloudEvents 1.0.x over HTTPS |
|          AsyncAPI 3.1 catalog         |
| Auth     OAuth 2.0 + RFC 9700 BCP     |
| Errors   RFC 9457 Problem Details     |
+-------------------+-------------------+
                    |
                    v
              Connector Layer
                    |
                    v
+---------------------------------------+
| Process Studio                        |
|                                       |
| Domain capability                     |
| External connector action             |
| Domain event                          |
| External event                        |
+---------------------------------------+
```

The connector layer is the protocol boundary. The domain package remains the
semantic boundary.

## Golden Profile

The default external integration profile is:

```text
Commands/actions:
  HTTPS
  JSON
  OpenAPI 3.2.0

Events:
  HTTPS webhook or HTTPS event ingestion
  CloudEvents 1.0.x envelope
  AsyncAPI 3.1.0 machine-readable event contract

Authentication:
  OAuth 2.0
  RFC 9700 security best current practice

HTTP errors:
  RFC 9457 Problem Details
```

The [OpenAPI 3.2.0 specification](https://spec.openapis.org/oas/v3.2.0.html)
describes language-agnostic HTTP interfaces. The [AsyncAPI 3.1.0
specification](https://www.asyncapi.com/docs/reference/specification/v3.1.0)
describes message-driven APIs and remains protocol-agnostic. [CloudEvents
1.0](https://cloudevents.io/) supplies a standardized event envelope, not the
business meaning of the event. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)
is the OAuth 2.0 security best-practice baseline, while [RFC
9457](https://www.rfc-editor.org/rfc/rfc9457.html) defines Problem Details for
HTTP APIs.

The repository may support an older compatible toolchain during implementation,
but a compatibility exception must be explicit and must not silently redefine
this profile.

## Semantic Namespaces

External capabilities must not be represented as if they were domain facts.

```text
DomainAction
  Inventory.ReserveStock
  Accounting.PostJournal
  Sales.ConfirmOrder

ExternalAction
  Midtrans.CreatePayment
  DHL.CreateShipment
  Salesforce.CreateLead

DomainEvent
  inventory.stock_transfer.confirmed.v1
  accounting.journal.posted.v1

ExternalEvent
  com.midtrans.payment.settled
  com.dhl.shipment.delivered
```

The distinction is semantic, not merely visual. A connector action may cause a
domain command, but it does not become the owner of the domain invariant.

```text
ExternalAction
    |
    v
Connector adapter
    |
    v
Public domain contract
    |
    v
Owning domain invariant
```

An external event is normalized into a typed integration event before a domain or
Process Studio consumes it. External payload types must not leak into domain
public APIs or persistence models.

## External Actions

An external action is an allowlisted operation imported from an external HTTP
API or registered through a trusted connector contract.

Example source description:

```yaml
openapi: 3.2.0
paths:
  /payments:
    post:
      operationId: createPayment
  /payments/{id}/refund:
    post:
      operationId: refundPayment
```

The connector import flow is:

```text
Import OpenAPI description
        |
        v
Validate document, server, schemas, security, and operations
        |
        v
Allowlist safe operations
        |
        v
Map operation to ExternalAction contract
        |
        v
Declare scopes, idempotency, timeout, retry, and recovery
        |
        v
Publish connector action for Process Studio
```

The import process must reject or quarantine:

- internal/debug/admin operations not explicitly allowlisted;
- operations with missing authentication or scope mapping;
- schemas that cannot be decoded safely;
- unbounded file, payload, timeout, or retry behavior;
- operations that claim domain ownership;
- operations with no duplicate-request strategy when side effects are possible;
- operations whose response/error contract cannot be mapped to stable public
  integration failures.

External actions declare:

```text
connector_id
operation_id
version
input_schema
output_schema
failure_schema
required_scope
idempotency_strategy
timeout_policy
retry_policy
compensation_or_manual_recovery
```

An external action may be `non-reversible` even when the remote API exposes a
refund or cancellation endpoint. The connector must declare the explicit
compensation command and its authorization; Process Studio never guesses one.

## External Events

External systems may deliver events to EclipseERP over HTTPS. The preferred
wire envelope is CloudEvents 1.0.x.

```json
{
  "specversion": "1.0",
  "type": "com.midtrans.payment.settled",
  "source": "https://partner.example",
  "id": "evt_019af92",
  "time": "2026-08-03T08:31:00Z",
  "subject": "payment/pay_123",
  "datacontenttype": "application/json",
  "data": {
    "paymentId": "pay_123",
    "amount": 1500000
  }
}
```

CloudEvents is an envelope. The event catalog owns the business interpretation:

```text
ExternalEvent
  id
  version
  connector_id
  source
  payload_schema
  tenant_scope
  correlation_fields
  filterable_fields
  deduplication_key
  occurred_at_semantics
```

The ingestion path is:

```text
HTTPS request
    |
    v
authenticate and verify signature
    |
    v
validate CloudEvents envelope
    |
    v
validate connector event schema
    |
    v
deduplicate by connector/source/event identity
    |
    v
normalize to ExternalEvent
    |
    v
publish durable internal event / resume process wait
```

External event delivery must provide:

- signature or equivalent authenticity verification;
- bounded body and header limits;
- replay protection where the provider supports it;
- idempotent deduplication;
- retry-safe acknowledgment behavior;
- delivery log and correlation metadata;
- poison-event and dead-letter handling;
- redaction and retention policy.

## AsyncAPI Role

AsyncAPI is a machine-readable catalog and contract for message-driven
integrations. It is not a transport and does not force EclipseERP to expose a
broker.

```text
CloudEvents
  = event envelope

HTTPS/Webhook
  = default delivery transport

AsyncAPI
  = event API description and catalog
```

An AsyncAPI document may describe HTTPS, Kafka, AMQP, WebSockets, or another
supported protocol through bindings. Process Studio sees the normalized
`ExternalEvent`; it does not see Kafka partitions, consumer groups, offsets,
AMQP exchanges, or provider-specific acknowledgment mechanics.

## Transport Adapters

HTTPS + JSON is the universal public path. Additional protocols are connector
runtime adapters:

```text
OpenAPI / HTTPS
SOAP / WSDL
OData
gRPC
Kafka
AMQP
NATS
SQS / Pub/Sub / EventBridge
```

Their normalized output is still:

```text
ExternalAction
ExternalEvent
```

No transport-specific concept may become a Process IR primitive or leak into a
business domain contract.

### Protocol Selection

- **HTTPS + JSON:** default public integration surface;
- **OpenAPI:** action and HTTP interface description;
- **CloudEvents:** event envelope;
- **AsyncAPI:** message API/catalog description;
- **gRPC:** trusted, controlled, high-throughput, or streaming adapter;
- **Kafka/AMQP/NATS/cloud brokers:** connector transport, never Process Studio
  semantics;
- **SOAP/OData:** compatibility adapters for existing enterprise systems.

GraphQL is not the default external action contract. BPMN is not an integration
protocol. Neither replaces the typed connector boundary.

## Authentication and Authorization

Machine-to-machine connectors use OAuth 2.0 Client Credentials with explicit
scopes, for example:

```text
inventory:read
payment:create
payment:refund
shipment:create
```

User-authorized applications use OAuth 2.0 Authorization Code with PKCE where
interactive delegation is required.

Connector authorization is separate from domain authorization:

```text
OAuth scope
  -> may this connector call the integration endpoint?

Domain capability
  -> may this tenant/principal perform the business action?
```

The connector must not convert an OAuth scope into a domain capability. The
owning domain still performs runtime authorization.

Tokens, client secrets, webhook secrets, and provider credentials must remain in
secret storage. They never appear in Process IR, catalog payloads, logs, public
DTOs, or audit bodies.

## Error Contract

External HTTP failures normalize to stable integration failures using RFC 9457
Problem Details at the transport boundary:

```json
{
  "type": "https://eclipse.example/problems/external-payment-declined",
  "title": "External payment declined",
  "status": 409,
  "detail": "The payment provider rejected the payment.",
  "instance": "/operations/op_01J..."
}
```

The connector preserves provider diagnostics internally but exposes only a
stable, redacted error contract to Process Studio and domain callers.

Business failures from the owning domain remain domain failures. The connector
must not translate every failure into a generic external error.

## Reliability and Compensation

External calls are not part of a PostgreSQL transaction. Connector actions must
declare:

```text
idempotency key
request timeout
retryable status classes
backoff and retry limit
provider response correlation
operation status
compensation or manual recovery
```

A committed external effect is handled like any other irreversible ERP effect:

```text
Create Payment
    |
    v
provider committed
    |
    v
later workflow failure
    |
    v
Refund Payment
or manual recovery
```

The connector never reports success merely because a request was sent. It must
represent accepted, committed, unknown, failed, and compensated states according
to the provider contract.

## Connector Lifecycle

A connector definition must declare:

```text
stable connector id
connector version
provider and environment
protocol adapter
base URL / server identity
credential reference
supported actions and events
scopes
rate and payload limits
retry and timeout policy
webhook verification policy
compatibility range
```

Connectors may be implemented by:

- core integration adapters;
- trusted server plugins with declared capabilities;
- declarative connector configuration using approved adapters.

Arbitrary tenant code is not a connector implementation.

## Process Studio Boundary

Process Studio may display:

```text
Business Capabilities
  Inventory.ReserveStock
  Accounting.PostJournal

Integrations
  Midtrans.CreatePayment
  DHL.CreateShipment

Events
  Inventory.StockTransferConfirmed
  Midtrans.PaymentSettled
```

It must not display or require:

```text
Kafka topic partition
consumer group
protobuf package
SOAP envelope details
raw OAuth token
provider database identifier
```

The canvas composes typed actions and events. Connector runtime owns protocol
translation, credentials, delivery, provider retries, and transport failures.
Domain packages own business meaning and invariants.

## Security and Trust

- deny connector access by default;
- allowlist operations and events;
- scope connectors to tenant, organization, provider environment, and action;
- redact provider secrets and payloads;
- limit request size, response size, duration, rate, and concurrency;
- isolate provider retries from domain transactions;
- prevent connector adapters from mutating core tables;
- require review for trusted plugins that register connectors;
- keep declarative connectors within approved adapter capabilities;
- keep sandboxed connectors behind the later plugin trust gates.

## Non-Goals

- Kafka, gRPC, AMQP, or GraphQL as the universal external interface;
- a proprietary EclipseERP SDK as a prerequisite for integration;
- exposing connector protocol details as Process Studio nodes;
- treating external schemas as internal domain models;
- allowing external systems to define EclipseERP invariants;
- automatic compensation inferred from provider operation names;
- arbitrary scripts, SQL, or unrestricted HTTP actions;
- replacing domain actions with generic integration actions.

## Validation

The integration surface is ready for production use when:

- OpenAPI imports produce allowlisted, versioned ExternalAction contracts;
- CloudEvents ingestion verifies authenticity, schema, tenant scope, and
  deduplication;
- AsyncAPI documents describe message contracts without becoming transport truth;
- OAuth scopes and domain capabilities remain separate;
- RFC 9457 failures are redacted and mapped to stable integration errors;
- duplicate requests, provider timeouts, unknown outcomes, retries, and
  compensation/manual recovery are tested;
- connector adapters do not leak provider types or protocols into domains;
- Process Studio can compose external actions/events without seeing transport
  internals;
- tenant, secret, audit, and observability controls pass review.
