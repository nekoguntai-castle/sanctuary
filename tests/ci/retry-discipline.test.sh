#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_text() {
  local file="$1"
  local text="$2"
  grep -Fq -- "$text" "$file" || fail "$file is missing: $text"
}

reject_text() {
  local file="$1"
  local text="$2"
  if grep -Fq -- "$text" "$file"; then
    fail "$file retains forbidden blanket retry: $text"
  fi
}

for document in "$ROOT_DIR/.github/CONTRIBUTING.md"; do
  relative_document="${document#"$ROOT_DIR/"}"
  git -C "$ROOT_DIR" ls-files --error-unmatch "$relative_document" >/dev/null 2>&1 \
    || fail "$relative_document must be tracked before CI can enforce its retry contract"
  require_text "$document" 'exact 40-character commit SHA'
  require_text "$document" 'Failure signature'
  require_text "$document" 'New hypothesis'
  require_text "$document" 'Cheap discriminator'
done

strategy="$ROOT_DIR/docs/reference/ci-cd-strategy.md"
require_text "$strategy" 'Expensive failure and rerun control'
require_text "$strategy" 'no retry or rerun route'
require_text "$strategy" 'reruns all'
require_text "$strategy" 'failed job'
require_text "$strategy" 'no single-emulator'
require_text "$strategy" 'workflow-dispatch input'
require_text "$strategy" 'UI/API reruns remain procedural'

workflow="$ROOT_DIR/.github/workflows/test.yml"
require_text "$workflow" 'retry-vitest-infrastructure-failure.sh "quick frontend isolated checks"'
require_text "$workflow" 'retry-vitest-infrastructure-failure.sh "quick backend integration smoke"'
reject_text "$workflow" 'retry-command.sh "quick frontend isolated checks"'
reject_text "$workflow" 'retry-command.sh "quick backend integration smoke"'

quality="$ROOT_DIR/.github/workflows/quality.yml"
require_text "$quality" 'bash -n tests/ci/retry-discipline.test.sh'
require_text "$quality" 'bash tests/ci/retry-discipline.test.sh'

echo 'Retry discipline contract is valid'
