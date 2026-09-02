#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/ci/provider-context.sh
. "$ROOT/scripts/ci/provider-context.sh"
REGISTERED_STAGING="$ROOT/scripts/ci/create-registered-staging.sh"
CLEANUP_COORDINATOR="$ROOT/scripts/ci/cleanup-ci-callsite.sh"
if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec "$CLEANUP_COORDINATOR" auto-run --lane jscpd --engine host \
    --checkout-root "$ROOT" -- bash "$0" "$@"
fi
cd "$ROOT"

output_dir="${QUALITY_JSCPD_OUTPUT_DIR:-reports/jscpd}"
report_file="$output_dir/jscpd-report.json"
config_file="$ROOT/config/tooling/jscpd.json"

# Keep the npm cache off the shared workspace whenever a runner-temp dir exists.
ci_temp="$(ci_temp_dir)"
if [ -n "$ci_temp" ] && [ "$ci_temp" != "/tmp" ]; then
  if [ -z "${npm_config_cache:-}" ]; then
    npm_config_cache="$($REGISTERED_STAGING jscpd-npm-cache)"
    export npm_config_cache
  fi
fi

export npm_config_audit="${npm_config_audit:-false}"
export npm_config_fund="${npm_config_fund:-false}"

case "$output_dir" in
  ''|/*|.|..|../*|*/..|*/../*)
    printf 'QUALITY_JSCPD_OUTPUT_DIR must be a safe repository-relative path\n' >&2
    exit 1
    ;;
esac
[ ! -e "$output_dir" ] || {
  printf 'Refusing stale jscpd output directory: %s\n' "$output_dir" >&2
  exit 1
}
mkdir -p "$output_dir"

npx --yes jscpd@4 --silent --config "$config_file" --gitignore --reporters json,markdown --output "$output_dir" .

node - "$report_file" <<'NODE'
const fs = require('node:fs');

const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const total = report.statistics.total;

console.log(
  `jscpd: ${total.percentage}% duplicated lines ` +
    `(${total.duplicatedLines}/${total.lines}), ` +
    `${total.clones} clones across ${total.sources} files`,
);
NODE
