# External Integration Surface Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Owns:** sequencing and readiness gates for the connector and external
> action/event surface.
>
> **Detailed semantics belong to:** [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md).

> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Domain maturity: [`./domain-maturity.md`](./domain-maturity.md)
> - Integration architecture: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Plugin architecture: [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
> - Integration profile ADR: [`../decisions/0019-adopt-integration-surface-profile.md`](../decisions/0019-adopt-integration-surface-profile.md)

## Rule

External integration must be a typed, versioned, observable boundary. It must
not become a shortcut around domain ownership or a reason to expose transport
internals to Process Studio.

```text
external protocol
        ↓
connector adapter
        ↓
ExternalAction / ExternalEvent
        ↓
public domain contract or Process Studio
```

## 0.8 — Contract Profile

Establish the golden profile:

```text
HTTPS + JSON + OpenAPI 3.2.0
CloudEvents 1.0.x over HTTPS/Webhook
AsyncAPI 3.1.0 event catalog
OAuth 2.0 + RFC 9700 security practices
RFC 9457 Problem Details
```

Exit criteria:

- `DomainAction`/`ExternalAction` and `DomainEvent`/`ExternalEvent` are distinct;
- connector IDs, versions, schemas, scopes, and tenant boundaries are typed;
- OpenAPI operations are allowlisted before import;
- CloudEvents envelope and external payload are separately validated;
- provider credentials never enter Process IR or domain contracts.

## 0.85 — Connector Runtime

Implement the minimum headless connector path:

```text
OpenAPI action invocation
HTTPS webhook ingestion
CloudEvents validation
OAuth scope enforcement
idempotency and deduplication
timeout and bounded retry
delivery log
```

Exit criteria:

- duplicate provider requests/events are safe;
- provider timeout and unknown outcome are observable;
- external errors normalize to stable integration failures;
- connector calls do not extend PostgreSQL transactions across the network;
- compensation or manual recovery is explicit for every side-effecting action.

## 0.9 — Reliability and Compatibility

Add operational maturity:

```text
dead-letter handling
replay protection
rate and payload limits
redaction and retention
provider status tracking
contract compatibility checks
connector health and lag metrics
```

Advanced adapters may be added behind the same normalized boundary:

```text
gRPC
Kafka
AMQP
NATS
SQS / Pub/Sub / EventBridge
SOAP
OData
```

Exit criteria:

- advanced protocols are invisible to Process IR;
- each adapter has an owner, version, compatibility range, and test suite;
- provider-specific retries and acknowledgments do not leak into domain code;
- connector plugin trust and secret handling pass review.

## 0.95 — Process Studio Integration

Expose approved connector capabilities to Process Studio:

```text
Integrations
└── Midtrans
    ├── CreatePayment
    └── RefundPayment

External Events
└── Midtrans.PaymentSettled
```

Exit criteria:

- external actions/events are catalog-driven and versioned;
- transport details are absent from the canvas;
- OAuth scopes and domain capabilities remain separate;
- static validation understands schemas, scope, idempotency, timeout, retry, and
  compensation metadata;
- connector operations can be simulated without real provider side effects.

## 1.0 — Governed Integration Surface

Deliver:

```text
connector registration and review
OpenAPI import governance
webhook registration and verification
external action/event publication
connector versioning and retirement
operator delivery/retry controls
provider-specific runbooks
integration audit and redaction
```

Exit criteria:

- no unreviewed connector operation is executable;
- connector lifecycle is independent from domain lifecycle;
- published process versions remain compatible with connector versions;
- external effects support safe retry, compensation, or manual recovery;
- public documentation can be generated from the approved contracts.

## Hard Stops

Do not expose an external connector to Process Studio when:

- the provider operation has no idempotency or unknown-outcome strategy;
- OAuth scope is being used as a substitute for domain authorization;
- the operation requires arbitrary script, SQL, or unrestricted HTTP;
- its error/timeout/retry semantics are undocumented;
- credentials or raw provider payloads would enter Process IR;
- no owner exists for the connector adapter;
- compensation/manual recovery is undefined for a committed side effect.
