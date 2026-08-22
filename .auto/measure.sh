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

existing_churn="$({
  git diff --numstat 3d3bd44 -- \
    AGENTS.md \
    ARCHITECTURE.md \
    docs/README.md \
    docs/documentation-boundaries.md \
    docs/architecture/architecture-spec-v4.md \
    docs/architecture/authorization.md \
    docs/architecture/overview.md \
    docs/architecture/pgque-messaging.md \
    docs/architecture/postgresql-19-architecture.md \
    docs/architecture/reference/hard-isolation-patterns.md \
    docs/architecture/search-architecture.md \
    docs/architecture/state-and-consistency.md \
    docs/architecture/workload-isolation.md \
    docs/decisions/README.md \
    docs/deployment/README.md
} | awk '{ churn += $1 + $2 } END { print churn + 0 }')"
check test "$existing_churn" -le 250
check grep -q 'activated financial authority follows ADR-0040' docs/architecture/workload-isolation.md
check bash -c "grep -q 'activated financial profile follows ADR-0040' docs/architecture/reference/accidental-duplication.md && grep -q 'ADR-0040 governs the activated financial authority' docs/architecture/reference/engineering-lineage.md && grep -q 'activated financial authority follows' docs/architecture/reference/erp-runtime-comparison.md"
check grep -q '^### Conservative multi-source freshness' docs/architecture/analytics-architecture.md
check grep -q '^### Correction visibility and deterministic replay' docs/architecture/analytics-architecture.md
check grep -q '^### Total dimension membership' docs/architecture/analytics-architecture.md
check grep -q '^### Empty inputs and absent groups' docs/architecture/analytics-architecture.md
check grep -q '^### Total arithmetic semantics' docs/architecture/analytics-architecture.md
check grep -q '^### Versioned temporal boundaries' docs/architecture/analytics-architecture.md
check grep -q '^### Deterministic ordering and pagination' docs/architecture/analytics-architecture.md
check grep -q '^## Self-Observation Boundary' docs/architecture/analytics-architecture.md
check grep -q '^### Fresh authorization across observation, review, and action' docs/architecture/analytics-architecture.md
check grep -q '^### Immutable evidence binding' docs/architecture/analytics-architecture.md

printf 'METRIC analytic_architecture_gates=%s\n' "$score"
printf 'METRIC remaining_gates=%s\n' "$((25 - score))"
