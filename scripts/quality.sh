#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

QUALITY_TOOLS_DIR="${QUALITY_TOOLS_DIR:-$ROOT/.tmp/quality-tools}"
LIZARD_VERSION="${LIZARD_VERSION:-1.21.2}"
GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"
LIZARD_REQUIREMENTS_FILE="$ROOT/scripts/quality/lizard-requirements.txt"
LIZARD_VENV="$QUALITY_TOOLS_DIR/lizard-$LIZARD_VERSION"
GITLEAKS_DIR="$QUALITY_TOOLS_DIR/gitleaks-$GITLEAKS_VERSION"
LIZARD_WARNING_BASELINE="${LIZARD_WARNING_BASELINE:-0}"
GITLEAKS_LOG_OPTS="${GITLEAKS_LOG_OPTS:--1}"
QUALITY_COVERAGE_SCRIPT="${QUALITY_COVERAGE_SCRIPT:-test:coverage}"
QUALITY_TYPECHECK_SCRIPT="${QUALITY_TYPECHECK_SCRIPT:-typecheck}"
QUALITY_BOOTSTRAP_TOOLS="${QUALITY_BOOTSTRAP_TOOLS:-1}"
GITLEAKS_BIN_RESOLVED=""
LIZARD_BIN_RESOLVED=""

truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_step() {
  local name="$1"
  local skip_var="$2"
  shift 2
  local skip_value="${!skip_var-0}"

  if truthy "$skip_value"; then
    printf '==> %s (skipped via %s)\n' "$name" "$skip_var"
    return 0
  fi

  printf '==> %s\n' "$name"
  "$@"
}

resolve_executable() {
  local candidate="$1"

  if [[ -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  if command -v "$candidate" >/dev/null 2>&1; then
    command -v "$candidate"
    return 0
  fi

  return 127
}

gitleaks_asset_platform() {
  local os
  local arch

  case "$(uname -s)" in
    Linux)
      os="linux"
      ;;
    Darwin)
      os="darwin"
      ;;
    *)
      printf 'Unsupported gitleaks bootstrap OS: %s\n' "$(uname -s)" >&2
      return 127
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)
      arch="x64"
      ;;
    arm64|aarch64)
      arch="arm64"
      ;;
    *)
      printf 'Unsupported gitleaks bootstrap architecture: %s\n' "$(uname -m)" >&2
      return 127
      ;;
  esac

  printf '%s_%s\n' "$os" "$arch"
}

install_gitleaks() {
  local platform
  local archive
  local url

  platform="$(gitleaks_asset_platform)"
  archive="$GITLEAKS_DIR/gitleaks.tar.gz"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${platform}.tar.gz"

  mkdir -p "$GITLEAKS_DIR"
  curl -fsSL -o "$archive" "$url"
  tar -xzf "$archive" -C "$GITLEAKS_DIR" gitleaks
  chmod +x "$GITLEAKS_DIR/gitleaks"
}

ensure_gitleaks_bin() {
  if [[ -n "${GITLEAKS_BIN:-}" ]]; then
    if GITLEAKS_BIN_RESOLVED="$(resolve_executable "$GITLEAKS_BIN")"; then
      return 0
    fi

    printf 'Configured GITLEAKS_BIN is not executable: %s\n' "$GITLEAKS_BIN" >&2
    return 127
  fi

  GITLEAKS_BIN_RESOLVED="$GITLEAKS_DIR/gitleaks"
  if [[ -x "$GITLEAKS_BIN_RESOLVED" ]]; then
    return 0
  fi

  if truthy "$QUALITY_BOOTSTRAP_TOOLS"; then
    install_gitleaks
    return 0
  fi

  if GITLEAKS_BIN_RESOLVED="$(resolve_executable gitleaks)"; then
    return 0
  fi

  if [[ -x /tmp/gitleaks ]]; then
    GITLEAKS_BIN_RESOLVED="/tmp/gitleaks"
    return 0
  fi

  printf 'Missing required quality tool: gitleaks\n' >&2
  printf 'Run with QUALITY_BOOTSTRAP_TOOLS=1, install gitleaks, or set GITLEAKS_BIN to an executable path.\n' >&2
  return 127
}

ensure_lizard_bin() {
  if [[ -n "${LIZARD_BIN:-}" ]]; then
    LIZARD_BIN_RESOLVED="$LIZARD_BIN"
    return 0
  fi

  LIZARD_BIN_RESOLVED="$LIZARD_VENV/bin/lizard"

  if [[ -x "$LIZARD_BIN_RESOLVED" ]]; then
    return 0
  fi

  if ! truthy "$QUALITY_BOOTSTRAP_TOOLS"; then
    printf 'Missing pinned lizard executable: %s\n' "$LIZARD_BIN_RESOLVED" >&2
    printf 'Run with QUALITY_BOOTSTRAP_TOOLS=1 or install %s manually.\n' "$LIZARD_REQUIREMENTS_FILE" >&2
    return 127
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    printf 'Missing required quality tool: python3\n' >&2
    return 127
  fi

  python3 -m venv "$LIZARD_VENV"
  "$LIZARD_VENV/bin/python" -m pip install --disable-pip-version-check --upgrade pip
  "$LIZARD_VENV/bin/python" -m pip install --disable-pip-version-check --requirement "$LIZARD_REQUIREMENTS_FILE"
}

run_gitleaks() {
  ensure_gitleaks_bin

  "$GITLEAKS_BIN_RESOLVED" version
  "$GITLEAKS_BIN_RESOLVED" detect --source . --no-git --redact --config .gitleaks.toml
  "$GITLEAKS_BIN_RESOLVED" git . --config .gitleaks.toml --redact --no-banner --log-opts "$GITLEAKS_LOG_OPTS"
  GITLEAKS_BIN="$GITLEAKS_BIN_RESOLVED" bash scripts/gitleaks-tracked-tree.sh
}

run_lizard() {
  ensure_lizard_bin

  "$LIZARD_BIN_RESOLVED" --version
  "$LIZARD_BIN_RESOLVED" \
    -w \
    -i "$LIZARD_WARNING_BASELINE" \
    -l javascript \
    -l typescript \
    -C 15 \
    -T nloc=200 \
    -x './node_modules/*' \
    -x './*/node_modules/*' \
    -x './dist/*' \
    -x './*/dist/*' \
    -x './build/*' \
    -x './coverage/*' \
    -x './*/coverage/*' \
    -x './server/src/generated/*' \
    -x './server/tests/fixtures/*' \
    -x './scripts/verify-addresses/output/*' \
    -x './*.min.js' \
    -x './reports/*' \
    -x './playwright-report/*' \
    -x './test-results/*' \
    -x './.tmp/*' \
    -x './.tmp-gh/*' \
    .
}

run_npm_audit() {
  npm audit --audit-level=high
  npm --prefix server audit --audit-level=high
  npm --prefix gateway audit --audit-level=high
}

run_jscpd() {
  local output_dir="${QUALITY_JSCPD_OUTPUT_DIR:-reports/jscpd}"
  local report_file="$output_dir/jscpd-report.json"

  npx --yes jscpd@4 --silent --reporters json,markdown --output "$output_dir" .
  node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const total = report.statistics.total;
    console.log(`jscpd: ${total.percentage}% duplicated lines (${total.duplicatedLines}/${total.lines}), ${total.clones} clones across ${total.sources} files`);
  ' "$report_file"
}

run_large_file_check() {
  node scripts/quality/check-large-files.mjs
}

run_step "lint" QUALITY_SKIP_LINT npm run lint
run_step "typecheck" QUALITY_SKIP_TYPECHECK npm run "$QUALITY_TYPECHECK_SCRIPT"
run_step "browser auth contract" QUALITY_SKIP_AUTH_CONTRACT npm run check:browser-auth-contract
run_step "architecture boundaries" QUALITY_SKIP_ARCH_BOUNDARIES npm run check:architecture-boundaries
run_step "OpenAPI route coverage" QUALITY_SKIP_OPENAPI_ROUTE_COVERAGE npm run check:openapi-route-coverage
run_step "coverage tests" QUALITY_SKIP_COVERAGE npm run "$QUALITY_COVERAGE_SCRIPT"
run_step "npm audit" QUALITY_SKIP_AUDIT run_npm_audit
run_step "gitleaks" QUALITY_SKIP_GITLEAKS run_gitleaks
run_step "lizard complexity" QUALITY_SKIP_LIZARD run_lizard
run_step "jscpd duplication" QUALITY_SKIP_JSCPD run_jscpd
run_step "large-file classification" QUALITY_SKIP_LARGE_FILES run_large_file_check

printf 'Quality gate passed.\n'
