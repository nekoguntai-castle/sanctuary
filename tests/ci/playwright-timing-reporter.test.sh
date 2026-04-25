#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

node "$ROOT_DIR/tests/ci/playwright-timing-reporter.test.mjs"
