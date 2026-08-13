#!/bin/bash
set -euo pipefail

passed=0
total=8
gate() { if "$@"; then passed=$((passed + 1)); fi; }

gate bash -c 'test -f packages/messaging/mod.ts && test -f db/schema/messaging.ts && grep -q "withTransaction" packages/messaging/src/service.ts && grep -q "messaging = \"packages/messaging\"" db/ownership.toml'
gate bash -c '! grep -q "eventOutbox" packages/process/src/service.ts && grep -q "process.order_confirmation.completed" packages/process/src/service.ts && grep -q "commandId" packages/process/src/service.ts && grep -q "correlationId" packages/process/src/service.ts && grep -q "idempotencyKey" packages/process/src/service.ts'
gate bash -c 'grep -q "stability: \"PUBLIC\"" packages/inventory/src/catalog.ts && grep -q "messaging.append" packages/inventory/src/service.ts && grep -Rqs "stock corrected.*atomic\|atomic.*stock corrected" packages/inventory/tests'
gate bash -c 'grep -q "stability: \"PUBLIC\"" packages/accounting/src/catalog.ts && grep -q "messaging.append" packages/accounting/src/service.ts && grep -Rqs "revenue posted.*atomic\|atomic.*revenue posted" packages/accounting/tests'
gate bash -c 'grep -q "sales.order.confirmed" packages/sales/src/catalog.ts && grep -q "stability: \"PUBLIC\"" packages/sales/src/catalog.ts && grep -q "messaging.append" packages/sales/src/service.ts && grep -Rqs "confirmation.*atomic\|atomic.*confirmation" packages/sales/tests && grep -q "two domains reach Level 3" docs/roadmap/domain-maturity.md'
gate bash -c 'grep -q "consumerReceipts" db/schema/messaging.ts && grep -Rqs "duplicate event\|consumer receipt" packages/messaging/tests && grep -Rqs "rolls back.*receipt\|receipt.*rolls back" packages/messaging/tests'
gate bash -c 'grep -q "cancelOrder" packages/process/src/service.ts && grep -q "fulfillOrder" packages/process/src/service.ts && grep -Rqs "cancellation.*atomic\|atomic.*cancellation" packages/process/tests && grep -Rqs "fulfillment" packages/process/tests'
gate bash -c 'grep -q "P3 baseline status:.*READY" docs/roadmap/erp-primitives.md && grep -q "Level 3" docs/roadmap/domain-maturity.md && grep -q "Superseded by:.*0038" docs/decisions/0033-extend-order-lifecycle-and-gate-pgque.md && grep -q "Process coordinates fulfillment" docs/roadmap/domain-maturity.md && grep -q "selected future fan-out" docs/decisions/0018-adopt-typed-process-studio.md && ./.auto/checks.sh >/dev/null'

printf "METRIC p3_ready_gates=%s\n" "$passed"
printf "METRIC remaining_gates=%s\n" "$((total - passed))"
