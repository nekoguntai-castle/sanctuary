#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/ci/provider-context.sh
. "$ROOT/scripts/ci/provider-context.sh"
cd "$ROOT"

output_dir="${QUALITY_JSCPD_OUTPUT_DIR:-reports/jscpd}"
report_file="$output_dir/jscpd-report.json"
config_file="$ROOT/.jscpd.json"

# Keep the npm cache off the shared workspace whenever a runner-temp dir exists.
ci_temp="$(ci_temp_dir)"
if [ -n "$ci_temp" ] && [ "$ci_temp" != "/tmp" ]; then
  mkdir -p "$ci_temp"
  export npm_config_cache="${npm_config_cache:-$ci_temp/sanctuary-jscpd-npm-cache-$(ci_run_id)}"
fi

export npm_config_audit="${npm_config_audit:-false}"
export npm_config_fund="${npm_config_fund:-false}"

rm -rf "$output_dir"
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
