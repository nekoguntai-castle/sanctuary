#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

output_dir="${QUALITY_JSCPD_OUTPUT_DIR:-reports/jscpd}"
report_file="$output_dir/jscpd-report.json"

if [ -n "${RUNNER_TEMP:-}" ]; then
  mkdir -p "$RUNNER_TEMP"
  export npm_config_cache="${npm_config_cache:-$RUNNER_TEMP/sanctuary-jscpd-npm-cache-${GITHUB_RUN_ID:-local}}"
fi

export npm_config_audit="${npm_config_audit:-false}"
export npm_config_fund="${npm_config_fund:-false}"

rm -rf "$output_dir"
mkdir -p "$output_dir"

npx --yes jscpd@4 --silent --reporters json,markdown --output "$output_dir" .

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
