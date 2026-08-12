#!/bin/bash
set -euo pipefail

passed=0
total=10

gate() { if "$@"; then passed=$((passed + 1)); fi; }
has() { grep -Rqs --exclude-dir=vendor --exclude-dir=node_modules -- "$1" ${2:-.}; }
not_has() { ! has "$1" "$2"; }

# 1: ADR-0033 is reflected by coordinator and canonical architecture.
gate bash -c '! grep -q "journalLines" packages/process/src/service.ts && grep -q "postRevenueForOrder" packages/process/src/service.ts && ! grep -q "0032-order-confirmation" docs/architecture/architecture-spec-v4.md'
# 2: P0 is explicitly READY with deployment prerequisites retained.
gate bash -c 'grep -q "P0.*READY" docs/roadmap/erp-primitives.md && grep -q "operator-supplied\|operator supplied" docs/roadmap/erp-primitives.md'
# 3: accepted P1 baseline ADR exists.
gate bash -c 'ls docs/decisions/*p1* >/dev/null 2>&1 && grep -l "Status: Accepted" docs/decisions/*p1* >/dev/null'
# 4: P1 contracts carry a UOM and a correction proof exists.
gate bash -c 'grep -q "unitOfMeasure" packages/inventory/src/service.ts && grep -Rqs "correction" packages/inventory/tests'
# 5: accepted P2 baseline ADR exists.
gate bash -c 'ls docs/decisions/*p2* >/dev/null 2>&1 && grep -l "Status: Accepted" docs/decisions/*p2* >/dev/null'
# 6: generic financial facts are Legal-Entity scoped and period tested.
gate bash -c 'grep -q "legalEntityId" packages/accounting/src/service.ts && grep -Rqs "closed period\|period.*concurr" packages/accounting/tests'
# 7: accepted P3 audit/event boundary ADR exists.
gate bash -c 'ls docs/decisions/*p3* >/dev/null 2>&1 && grep -l "Status: Accepted" docs/decisions/*p3* >/dev/null'
# 8: typed action/event catalogs have compatibility proof for two domains.
gate bash -c 'grep -Rqs "TypedActionCatalog\|ActionCatalogEntry" packages tests && grep -Rqs "TypedEventCatalog\|EventCatalogEntry" packages tests && grep -Rqs "catalog.*compatib" tests packages/*/tests'
# 9: selected committed facts have audit/correlation plus atomic/idempotent proof.
gate bash -c 'grep -Rqs "actorPrincipalId" packages/*/src db/schema && grep -Rqs "correlationId" packages/*/src db/schema && grep -Rqs "atomic\|idempotent consumer\|duplicate event" packages/*/tests tests'
# 10: roadmap has no material UNKNOWN state for P0-P3 baseline.
gate bash -c '! grep -A20 "### P[0-3]" docs/roadmap/erp-primitives.md | grep -q "UNKNOWN"'

printf 'METRIC accepted_gates=%s\n' "$passed"
printf 'METRIC remaining_gates=%s\n' "$((total - passed))"
