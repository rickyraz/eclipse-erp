#!/bin/bash
set -euo pipefail
rtk deno fmt --check apps packages tooling tests db deno.json sgconfig.yml vitest.config.ts >/dev/null
rtk deno lint apps packages tooling tests vitest.config.ts >/dev/null
rtk deno task check >/dev/null
rtk deno task skills:check >/dev/null
rtk deno task boundary:test >/dev/null
rtk deno task boundary:lint >/dev/null
rtk deno task test:contract >/dev/null
