# ERP Standards and Orthogonal Primitives

> **Status:** Reference
>
> **Owns:** Conceptual guidance for applying external standards to ERP semantics, identifiers,
> integration contracts, processes, and reporting projections.
>
> **Does not own:** Binding module boundaries, persistence schemas, transaction rules, or adapter
> implementation requirements.
>
> **Related documents**
>
> - Product vision: [`../../product/vision.md`](../../product/vision.md)
> - Canonical architecture: [`../architecture-spec-v4.md`](../architecture-spec-v4.md)
> - Orthogonal design: [`./orthogonal-erp-design.md`](./orthogonal-erp-design.md)
> - Orthogonal areas: [`./orthogonal-erp-areas.md`](./orthogonal-erp-areas.md)
> - Documentation boundaries:
>   [`../../documentation-boundaries.md`](../../documentation-boundaries.md)

ERP primitives are standardized mainly at the semantic and interoperability level, not at the
internal table, package, API, or transaction-boundary level.

> Use standards to align meaning. Do not outsource internal system design to a standard.

## Standardization Categories

### Concepts and Invariants

Standards can define business concepts and rules that must remain true. The IFRS Conceptual
Framework, for example, defines assets, liabilities, equity, income, expenses, recognition,
derecognition, measurement, presentation, and disclosure. It does not prescribe tables named
`asset`, `liability`, or `journal_entry`.

```text
external standard -> shared accounting semantics
RITSEI        -> domain model, posting policy, and storage design
```

### Identifiers and Code Lists

Standards can provide stable vocabularies for cross-system identification:

- ISO 4217 for currency codes and minor-unit relationships;
- UNECE Recommendation 20 for units of measure used in international trade;
- GS1 GTIN for products and services;
- GS1 GLN for parties and locations;
- GS1 SSCC for logistic units;
- LEI for legal entities.

External identifiers must remain distinct from internal identity:

```text
resource_id = internal UUID
GTIN        = external trade-item identifier
supplierSku = identifier assigned by a supplier
internalSku = identifier assigned by RITSEI or its tenant
```

An external identifier can be unavailable, reassigned under its governing rules, scoped to a
particular ecosystem, or versioned independently. It should not become the universal primary key of
an internal primitive.

### Documents and Messages

OASIS UBL defines common business documents such as `Order`, `Invoice`, `DespatchAdvice`,
`ReceiptAdvice`, and `CreditNote`. ISO 20022 provides a Data Dictionary, Business Process Catalogue,
message definitions, and syntax schemas for financial communication.

These are exchange contracts, not internal aggregates:

```text
UBL Invoice                != internal Invoice aggregate
ISO 20022 payment message  != internal Payment or Settlement entity
```

Map them at an integration boundary:

```text
internal semantic model -> versioned adapter -> external document or message
```

### Processes and Integration Boundaries

BPMN provides a standard notation for business processes. ISA-95/IEC 62264 provides terminology,
activity and information models, and exchange boundaries between enterprise and
manufacturing-control functions.

These standards improve communication and interoperability. They do not by themselves determine
RITSEI package ownership or bounded contexts.

### Reporting and Regulatory Output

XBRL standardizes electronic business reporting through taxonomies, concepts, dimensions, facts, and
instance reports. A taxonomy is a projection target, not the source ledger model or internal chart
of accounts.

```text
ledger facts -> reporting projection -> XBRL adapter -> instance report
```

## Application to Candidate Primitive Areas

The areas below refine the candidate areas in
[`orthogonal-erp-areas.md`](./orthogonal-erp-areas.md). They are analysis, not binding module
specifications.

### Party and Identity

Candidate primitives include party, party role, identifier, address, contact, relationship, and
legal entity. A party can have several roles, such as customer, supplier, partner, or employee.

LEI and GLN can be attached as external identifiers where applicable. Party identity must not absorb
balances, stock quantities, payroll, or sales totals; those remain facts or projections owned
elsewhere.

### Resource, Product, and Offering

Keep these meanings distinct:

```text
Resource   -> something owned, used, consumed, allocated, or controlled
Product    -> classification of something traded
Offering   -> commercial terms under which a product or service is offered
```

A GTIN can identify a trade item but does not replace internal resource identity. Price is not a
permanent product attribute because it can depend on currency, customer segment, quantity, contract,
jurisdiction, effective period, tax treatment, and promotion.

### Quantity, Unit of Measure, and Money

Represent quantities and money as structured values:

```text
Quantity { value: 10, unit: "KGM" }
Money    { amount: 150000, currency: "IDR" }
```

Quantities can be added only when their units match or a valid conversion context exists. Monetary
amounts with different currencies require an explicit exchange-rate context.

Units of measure are shared across inventory, sales, procurement, manufacturing, logistics,
services, and assets. They should not be treated as inventory-only vocabulary.

### Place and Location

Distinguish legal addresses, physical places, stock locations, customer sites, in-transit locations,
and virtual locations. A GLN can identify a party or location in the GS1 ecosystem, but it does not
collapse these internal meanings into one address record.

A shared place primitive avoids separate and incompatible location models in party, inventory,
shipping, assets, and manufacturing.

### Agreement and Commitment

Candidate primitives include agreement, party to agreement, term, right, obligation, commitment, and
validity period.

An order document can communicate commitments, but the document, agreement, commitment, and
fulfillment are not the same thing. One order can contain several commitments, and one commitment
can be fulfilled through several facts.

### Movement and Inventory

A movement records what moved, how much, from where, to where, when, and why. Inventory is a
projection over relevant movement facts:

```text
balance(resource, location, time)
  = incoming movements - outgoing movements
```

GS1 EPCIS can represent external supply-chain visibility events. It should be supported through an
adapter rather than used as the internal inventory ledger. Movement semantics should not own selling
price, cost of goods sold, tax, ledger-account selection, or approval workflow.

### Fulfillment

Commitment and fulfillment commonly have a many-to-many allocation relationship:

```text
remaining quantity = committed quantity - allocated fulfilled quantity
```

UBL explicitly permits despatch lines that do not correspond one-to-one with order lines. An
explicit fulfillment allocation therefore models the semantics more accurately than a single foreign
key from a delivery line to an order line.

### Obligation and Settlement

Keep these concepts separate:

```text
Invoice     -> evidence that may create an obligation
Payment     -> instruction, execution, or observed movement of funds
Settlement  -> allocation of value against an obligation
Reconcile   -> matching internal facts with external evidence
```

ISO 20022 messages can carry payment initiation, remittance, and cash-management information. They
do not make payment instruction, payment execution, bank transaction, settlement, and reconciliation
one internal entity.

### Valuation and Ledger

A possible flow is:

```text
business event
  -> valuation or posting policy
  -> journal entry
  -> reporting projection
  -> XBRL export
```

The ledger owns balanced financial facts. External accounting and reporting standards supply
semantic and output requirements, while the internal engine and storage boundary remain RITSEI
decisions.

### Manufacturing

ISA-95 is useful for clarifying the exchange boundary between enterprise planning and manufacturing
operations:

```text
ERP/business planning   -> request, availability, costing, planning
manufacturing operations -> execution, equipment state, consumption, output,
                            quality result
```

Orthogonality requires explicit ownership of each fact; ERP and manufacturing operations must not
independently claim authority over the same fact.

### Workflow and Policy

Keep workflow, policy, and domain facts distinct:

```text
Workflow -> who acts, in what sequence, and before which deadline
Policy   -> whether an operation is permitted
Domain   -> what business fact actually occurred
```

A BPMN diagram can describe a process, but it is not automatically executable policy or the domain
source of truth. A workflow status of `APPROVED` does not prove that inventory was reserved or a
ledger entry was posted.

## Design Guidance

### Standards Do Not Define Module Boundaries

A UBL `Invoice` combines information needed for exchange. It does not imply that one internal
invoice module should own party, tax, payment, settlement, ledger, inventory, and workflow behavior.

Traditional applications such as Sales, Procurement, Inventory, and Manufacturing are composite
processes over smaller semantic capabilities.

### Standards Do Not Define Persistence Schemas

Do not copy an external XML or message schema into tables one-to-one. That usually creates deeply
nested structures, large numbers of nullable columns, technical naming, and direct coupling to a
standard version.

Prefer:

```text
internal model -> adapter or mapper -> versioned external representation
```

### Adopt Semantics Before Representation

The most reusable parts of a standard are usually terminology, concept definitions, identifier
rules, cardinality, constraints, process meaning, and code lists. XML, JSON, CSV, API, and messaging
syntax are representations.

### Keep One Semantic Owner per Invariant

Examples of candidate ownership:

```text
Movement   -> movement quantity and direction
Fulfillment -> allocation against commitment
Settlement -> allocation against obligation
Ledger     -> debit-credit balance
Valuation  -> economic-value calculation
```

Other areas should consume a contract or projection instead of independently recalculating the same
business fact.

Binding ownership still belongs in a canonical architecture document or an accepted ADR, not in this
reference.

### Distinguish Primitives from Composite Processes

```text
Primitive capabilities:
Party | Resource | Commitment | Movement | Fulfillment
Obligation | Settlement | Valuation | Ledger | Policy | Evidence

Composite process example:
Order-to-Cash
  = Party + Offering + Commitment + Fulfillment
  + Obligation + Settlement + Ledger
```

Avoid universal abstractions such as `UniversalEntity`, `Record`, `Node`, or `Action`. A primitive
should retain strong business semantics and explicit invariants.

### Put External Standards at Boundaries

```text
Domain capabilities
├── Party
├── Movement
├── Settlement
└── Ledger

Integration adapters
├── UBL
├── ISO 20022
├── EPCIS
├── XBRL
└── jurisdiction-specific reporting
```

External contracts can change version, contain many optional fields, and serve cross-organization
needs that differ from the internal model.

### Make Standard Versions Explicit

Store the applicable standard, version, message or document type, and profile:

```text
standard = UBL
version  = 2.4
profile  = procurement
```

```text
standard       = ISO20022
message        = pain.001
messageVersion = 001.13
```

ISO 20022 publishes multiple message-definition versions and retains earlier versions in its
archive. A generic value such as `ISO20022_PAYMENT` is insufficient for a durable integration
contract.

### Keep Localization Outside the Primitive Core

A tax core can define tax obligation, taxable base, rate, withholding, and tax evidence.
Jurisdiction-specific rules, codes, document formats, filing requirements, and authority
integrations belong in localization boundaries.

## Canonical Outcomes

The architectural discussion derived from this reference is now binding through:

- [ADR-0013](../../decisions/0013-version-external-standard-adapters.md) for versioned
  external-standard adapters;
- [ADR-0014](../../decisions/0014-separate-internal-and-external-identifiers.md) for separating
  internal identity from external identifiers;
- [ADR-0015](../../decisions/0015-one-semantic-owner-per-invariant.md) for one semantic owner per
  invariant;
- [ADR-0016](../../decisions/0016-isolate-jurisdiction-localization.md) for localization isolation;
- the canonical composite-process contract in
  [`architecture-spec-v4.md`](../architecture-spec-v4.md).

This reference remains conceptual background and does not independently own those rules.

## References

- [IFRS Conceptual Framework for Financial Reporting](https://www.ifrs.org/issued-standards/list-of-standards/conceptual-framework/)
- [ISO 4217 currency codes](https://www.iso.org/iso-4217-currency-codes.html)
- [UNECE code-list recommendations, including Recommendation 20](https://unece.org/code-list-recommendations)
- [GS1 identification keys](https://www.gs1.org/standards/id-keys)
- [GS1 standards](https://www.gs1.org/standards)
- [GLEIF Legal Entity Identifier](https://www.gleif.org/en/organizational-identity/lei-vlei/the-legal-entity-identifier-lei)
- [OASIS Universal Business Language 2.4](https://docs.oasis-open.org/ubl/UBL-2.4.html)
- [ISO 20022 Data Dictionary](https://www.iso20022.org/understanding-data-dictionary)
- [ISO 20022 Business Process Catalogue](https://www.iso20022.org/understanding-iso-20022-business-process-catalogue)
- [ISO 20022 message definitions](https://www.iso20022.org/iso-20022-message-definitions)
- [OMG BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/)
- [ISA-95 enterprise-control system integration](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard)
- [XBRL taxonomies, concepts, dimensions, instances, and facts](https://specifications.xbrl.org/spec-group-index-group-dimensions.html)
