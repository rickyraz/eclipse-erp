#!/bin/bash
set -euo pipefail

score=0
check() {
  if "$@"; then
    score=$((score + 1))
  fi
}

check test -f docs/decisions/0043-adopt-rebuildable-analytic-plane.md
check test -f docs/architecture/analytics-architecture.md
check test -f docs/architecture/reference/analytical-isolation-and-semantic-projection-patterns.md
check grep -q '0043' docs/decisions/README.md
check grep -q 'analytics-architecture.md' docs/README.md
check grep -q 'Analytic-plane authority' docs/documentation-boundaries.md
check grep -q '^## Analytic Plane Contract' docs/architecture/architecture-spec-v4.md
check grep -q '^## Analytics' docs/architecture/overview.md
check grep -q 'analytics-architecture.md' docs/architecture/workload-isolation.md
check grep -q 'analytics-architecture.md' docs/deployment/README.md
check grep -q '^## No Primary Fallback' docs/architecture/analytics-architecture.md
check grep -q '^## Provider Activation Gates' docs/architecture/analytics-architecture.md

printf 'METRIC analytic_architecture_gates=%s\n' "$score"
printf 'METRIC remaining_gates=%s\n' "$((12 - score))"
