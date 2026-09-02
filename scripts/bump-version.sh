#!/usr/bin/env bash
# Transactional version bump and release-evidence validator.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
REGISTERED_STAGING="$SCRIPT_DIR/ci/create-registered-staging.sh"
CLEANUP_COORDINATOR="$SCRIPT_DIR/ci/cleanup-ci-callsite.sh"

if [[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]]; then
  exec "$CLEANUP_COORDINATOR" auto-run --lane bump-version --engine host \
    --checkout-root "$ROOT_DIR" -- bash "$0" "$@"
fi
cd "$ROOT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PACKAGE_FILES=(package.json server/package.json gateway/package.json llm-egress-proxy/package.json)
DECLARED_OUTPUTS=(
  "${PACKAGE_FILES[@]}"
  package-lock.json
  llm-egress-proxy/package-lock.json
  docs/reference/generated/hardware-wallet-compatibility.json
  docs/reference/generated/hardware-wallet-compatibility.md
)
HARDWARE_JSON=docs/reference/generated/hardware-wallet-compatibility.json
HARDWARE_MARKDOWN=docs/reference/generated/hardware-wallet-compatibility.md
NPM_BIN="${SANCTUARY_BUMP_NPM_BIN:-npm}"
REPORT_BIN="${SANCTUARY_BUMP_REPORT_BIN:-}"
TRANSACTION_DIR=""
ROLLBACK=false

fail() { echo -e "${RED}Version evidence check failed:${NC} $*" >&2; return 1; }

cleanup_transaction() {
  : # Registered temporary artifacts are removed only by the cleanup coordinator.
}

finish_transaction() {
  local status=${1:-$?}
  trap - EXIT INT TERM
  if [[ "$ROLLBACK" == true ]]; then
    local output
    for output in "${DECLARED_OUTPUTS[@]}"; do
      cp -p "$TRANSACTION_DIR/$output" "$output" || status=1
    done
    echo -e "${YELLOW}Version bump failed; restored every declared output.${NC}" >&2
  fi
  exit "$status"
}

require_declared_outputs() {
  local output
  for output in "${DECLARED_OUTPUTS[@]}"; do
    [[ -f "$output" ]] || fail "required release output is missing: $output"
  done
  command -v "$NPM_BIN" >/dev/null || fail "npm command is unavailable: $NPM_BIN"
  if [[ -n "$REPORT_BIN" ]]; then
    command -v "$REPORT_BIN" >/dev/null || fail "report command is unavailable: $REPORT_BIN"
  else
    command -v npx >/dev/null || fail "npx is required to generate release evidence"
    [[ -f scripts/ci/hardware-compatibility-report.ts ]] || fail "hardware report generator is missing"
  fi
}

json_value() {
  node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let current = value;
    for (const key of process.argv[2].split(".")) current = current?.[key];
    if (typeof current !== "string") process.exit(1);
    process.stdout.write(current);
  ' "$1" "$2"
}

get_version() { json_value "$1" version; }

run_hardware_report() {
  local json_path=$1 markdown_path=$2 generated_at revision
  generated_at="$(json_value "$HARDWARE_JSON" generatedAt)" || fail "$HARDWARE_JSON needs string generatedAt"
  revision="$(node -e '
    const value = require("./docs/reference/generated/hardware-wallet-compatibility.json").revision;
    if (value !== null && typeof value !== "string") process.exit(1);
    if (typeof value === "string") process.stdout.write(value);
  ')" || fail "$HARDWARE_JSON has invalid revision"
  local args=(--as-of "$generated_at" --json "$json_path" --markdown "$markdown_path")
  [[ -z "$revision" ]] || args+=(--revision "$revision")
  if [[ -n "$REPORT_BIN" ]]; then
    "$REPORT_BIN" "${args[@]}"
  else
    npx tsx scripts/ci/hardware-compatibility-report.ts "${args[@]}"
  fi
}

validate_version_identities() {
  node - "$HARDWARE_JSON" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const root = read('package.json');
const server = read('server/package.json');
const gateway = read('gateway/package.json');
const proxy = read('llm-egress-proxy/package.json');
const rootLock = read('package-lock.json');
const proxyLock = read('llm-egress-proxy/package-lock.json');
const report = read(process.argv[2]);
const expected = root.version;
const checks = [
  ['server/package.json', server.version],
  ['gateway/package.json', gateway.version],
  ['llm-egress-proxy/package.json', proxy.version],
  ['package-lock.json version', rootLock.version],
  ['package-lock.json packages[""]', rootLock.packages?.['']?.version],
  ['package-lock.json packages.server', rootLock.packages?.server?.version],
  ['package-lock.json packages.gateway', rootLock.packages?.gateway?.version],
  ['llm-egress-proxy/package-lock.json version', proxyLock.version],
  ['llm-egress-proxy/package-lock.json packages[""]', proxyLock.packages?.['']?.version],
  ['generated JSON source.applicationVersion', report.source?.applicationVersion],
];
const errors = checks.filter(([, actual]) => actual !== expected)
  .map(([label, actual]) => `${label}: ${String(actual)} (expected ${expected})`);
const digest = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
if (report.source?.packageLockSha256 !== digest) {
  errors.push(`generated JSON source.packageLockSha256: ${String(report.source?.packageLockSha256)} (expected ${digest})`);
}
if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exit(1); }
NODE
}

check_release_evidence() {
  require_declared_outputs
  validate_version_identities || fail "manifest, lockfile, or generated JSON identity mismatch"
  local parity_dir
  parity_dir="$($REGISTERED_STAGING version-check)"
  if ! run_hardware_report "$parity_dir/report.json" "$parity_dir/report.md" \
    || ! cmp -s "$HARDWARE_JSON" "$parity_dir/report.json" \
    || ! cmp -s "$HARDWARE_MARKDOWN" "$parity_dir/report.md"; then
    fail "generated hardware JSON/Markdown are not the canonical matching pair"
  fi
  echo -e "${GREEN}All release version evidence is in sync: $(get_version package.json)${NC}"
}

calc_version() {
  local current=$1 bump=$2 major minor patch
  IFS='.' read -r major minor patch <<< "$current"
  case "$bump" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *) echo "$bump" ;;
  esac
}

begin_transaction() {
  TRANSACTION_DIR="$($REGISTERED_STAGING version-bump)"
  local output
  for output in "${DECLARED_OUTPUTS[@]}"; do
    mkdir -p "$TRANSACTION_DIR/$(dirname "$output")"
    cp -p "$output" "$TRANSACTION_DIR/$output"
  done
  ROLLBACK=true
  trap 'finish_transaction $?' EXIT
  trap 'finish_transaction 130' INT
  trap 'finish_transaction 143' TERM
}

usage() { echo "Usage: $0 <version|patch|minor|major|--check>" >&2; }

[[ $# -eq 1 ]] || { usage; exit 2; }
if [[ "$1" == --check ]]; then check_release_evidence; exit 0; fi

require_declared_outputs
CURRENT="$(get_version package.json)" || fail "package.json has no valid version"
NEW_VERSION="$(calc_version "$CURRENT" "$1")"
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { fail "invalid version '$NEW_VERSION'; expected X.Y.Z"; exit 2; }

echo -e "${YELLOW}Bumping version: $CURRENT -> $NEW_VERSION${NC}"
begin_transaction
"$NPM_BIN" version --no-git-tag-version --allow-same-version "$NEW_VERSION" >/dev/null
(cd server && "$NPM_BIN" version --no-git-tag-version --allow-same-version "$NEW_VERSION" >/dev/null)
(cd gateway && "$NPM_BIN" version --no-git-tag-version --allow-same-version "$NEW_VERSION" >/dev/null)
(cd llm-egress-proxy && "$NPM_BIN" version --no-git-tag-version --allow-same-version "$NEW_VERSION" >/dev/null)
run_hardware_report "$HARDWARE_JSON" "$HARDWARE_MARKDOWN"
check_release_evidence
ROLLBACK=false
echo -e "${GREEN}Version and all declared release evidence updated to $NEW_VERSION.${NC}"
echo "Follow the authoritative release policy: docs/reference/release-distribution.md"
