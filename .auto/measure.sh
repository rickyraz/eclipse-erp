#!/bin/bash
set -euo pipefail

passed=0
total=7
gate() { if "$@"; then passed=$((passed + 1)); fi; }

gate bash -c 'test -f packages/messaging/mod.ts && test -f db/schema/messaging.ts && grep -q "withTransaction" packages/messaging/src/service.ts && grep -q "messaging = \"packages/messaging\"" db/ownership.toml'
gate bash -c '! grep -q "eventOutbox" packages/process/src/service.ts && grep -q "process.order_confirmation.completed" packages/process/src/service.ts && grep -q "commandId" packages/process/src/service.ts && grep -q "correlationId" packages/process/src/service.ts && grep -q "idempotencyKey" packages/process/src/service.ts'
gate bash -c 'grep -q "stability: \"PUBLIC\"" packages/inventory/src/catalog.ts && grep -q "messaging.append" packages/inventory/src/service.ts && grep -Rqs "stock corrected.*atomic\|atomic.*stock corrected" packages/inventory/tests'
gate bash -c 'grep -q "stability: \"PUBLIC\"" packages/accounting/src/catalog.ts && grep -q "messaging.append" packages/accounting/src/service.ts && grep -Rqs "revenue posted.*atomic\|atomic.*revenue posted" packages/accounting/tests'
gate bash -c 'grep -q "consumerReceipts" db/schema/messaging.ts && grep -Rqs "duplicate event\|consumer receipt" packages/messaging/tests && grep -Rqs "rolls back.*receipt\|receipt.*rolls back" packages/messaging/tests'
gate bash -c 'grep -q "cancelOrder" packages/process/src/service.ts && grep -q "fulfillOrder" packages/process/src/service.ts && grep -Rqs "cancellation.*atomic\|atomic.*cancellation" packages/process/tests && grep -Rqs "fulfillment" packages/process/tests'
gate bash -c 'grep -q "P3 baseline status:.*READY" docs/roadmap/erp-primitives.md && grep -q "Level 3" docs/roadmap/domain-maturity.md && ./.auto/checks.sh >/dev/null'

printf "METRIC p3_ready_gates=%s\n" "$passed"
printf "METRIC remaining_gates=%s\n" "$((total - passed))"
