#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RETRY_SCRIPT="$ROOT_DIR/scripts/ci/retry-playwright-infrastructure-failure.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

main() {
  local temp_dir
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT

  cat >"$temp_dir/segfault-once.sh" <<'EOF_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
count_file="$1"
count="$(cat "$count_file" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" >"$count_file"
if [ "$count" -eq 1 ]; then
  exit 139
fi
echo "passed after native crash"
EOF_SCRIPT
  chmod +x "$temp_dir/segfault-once.sh"

  SANCTUARY_PLAYWRIGHT_INFRA_ATTEMPTS=2 \
    SANCTUARY_PLAYWRIGHT_INFRA_LOG_DIR="$temp_dir/logs" \
    bash "$RETRY_SCRIPT" "segfault once" "$temp_dir/segfault-once.sh" "$temp_dir/segfault-count"
  [ "$(cat "$temp_dir/segfault-count")" = "2" ] || fail 'expected exit-139 case to retry once'

  cat >"$temp_dir/segfault-text-once.sh" <<'EOF_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
count_file="$1"
count="$(cat "$count_file" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" >"$count_file"
if [ "$count" -eq 1 ]; then
  echo "Segmentation fault (core dumped)" >&2
  exit 1
fi
echo "passed after native crash text"
EOF_SCRIPT
  chmod +x "$temp_dir/segfault-text-once.sh"

  SANCTUARY_PLAYWRIGHT_INFRA_ATTEMPTS=2 \
    SANCTUARY_PLAYWRIGHT_INFRA_LOG_DIR="$temp_dir/logs" \
    bash "$RETRY_SCRIPT" "segfault text once" "$temp_dir/segfault-text-once.sh" "$temp_dir/segfault-text-count"
  [ "$(cat "$temp_dir/segfault-text-count")" = "2" ] || fail 'expected segfault text case to retry once'

  cat >"$temp_dir/assertion-failure.sh" <<'EOF_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
count_file="$1"
count="$(cat "$count_file" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" >"$count_file"
echo "Error: expect(locator).toBeVisible() failed" >&2
exit 1
EOF_SCRIPT
  chmod +x "$temp_dir/assertion-failure.sh"

  if SANCTUARY_PLAYWRIGHT_INFRA_ATTEMPTS=3 \
    SANCTUARY_PLAYWRIGHT_INFRA_LOG_DIR="$temp_dir/logs" \
    bash "$RETRY_SCRIPT" "assertion failure" "$temp_dir/assertion-failure.sh" "$temp_dir/assertion-count"; then
    fail 'expected assertion failure to fail'
  fi
  [ "$(cat "$temp_dir/assertion-count")" = "1" ] || fail 'expected assertion failure not to retry'

  echo 'Playwright infrastructure retry regression checks passed'
}

main "$@"
