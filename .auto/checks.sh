#!/bin/bash
set -euo pipefail
rtk deno task check >/dev/null
rtk deno task boundary:test >/dev/null
rtk deno task boundary:lint >/dev/null
rtk deno task test:contract >/dev/null
