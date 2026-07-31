#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

mkdir -p "$test_dir/bin"
cat > "$test_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${!#}"
printf '%s\n' "$url" >> "${MEASURE_WALLCLOCK_URL_LOG:?}"
case "$url" in
  */actions/runs*)
    cat <<'JSON'
{"workflow_runs":[{"id":1,"index_in_repo":1,"workflow_id":"test.yml","event":"push","commit_sha":"abc","status":"success","started":"2026-01-01T00:00:00Z","stopped":"2026-01-01T00:00:01Z","duration":1000000000}]}
JSON
    ;;
  */actions/tasks*)
    printf '%s\n' '{"workflow_runs":[]}'
    ;;
  *)
    printf 'unexpected URL: %s\n' "$url" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$test_dir/bin/curl"

run_case() {
  local configured_url="$1"
  local url_log="$test_dir/urls.log"
  : > "$url_log"

  PATH="$test_dir/bin:$PATH" \
    MEASURE_WALLCLOCK_URL_LOG="$url_log" \
    SANCTUARY_FORGE_TOKEN="test-token" \
    SANCTUARY_FORGE_API_URL="$configured_url" \
    SANCTUARY_FORGE_OWNER="owner" \
    SANCTUARY_FORGE_REPO="repo" \
    "$root_dir/scripts/ci/measure-wallclock.sh" --workflow test.yml --limit 1 \
    > "$test_dir/output.csv"

  grep -Fxq "https://forge.example/api/v1/repos/owner/repo/actions/runs?limit=1" "$url_log"
  grep -Fxq "https://forge.example/api/v1/repos/owner/repo/actions/tasks?limit=500" "$url_log"
  grep -Fq "1,1,test.yml,push,abc,success" "$test_dir/output.csv"
}

run_case "https://forge.example"
run_case "https://forge.example/api/v1/"

if PATH="$test_dir/bin:$PATH" \
  SANCTUARY_FORGE_TOKEN="test-token" \
  SANCTUARY_FORGE_API_URL="https://forge.example" \
  SANCTUARY_FORGE_OWNER="owner" \
  SANCTUARY_FORGE_REPO="repo" \
  "$root_dir/scripts/ci/measure-wallclock.sh" --workflow test.yml --limit invalid \
  >/dev/null 2>&1; then
  echo "measure-wallclock accepted an invalid limit" >&2
  exit 1
fi

echo "measure-wallclock regression checks passed"
