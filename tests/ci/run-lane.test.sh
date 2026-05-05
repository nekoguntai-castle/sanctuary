#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_LANE="$ROOT_DIR/scripts/ci/run-lane.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

write_plan() {
  local path="$1" lane="$2" run="$3"
  shift 3
  local files_json='[]'
  if [ "$#" -gt 0 ]; then
    files_json='['
    local first=true
    for f in "$@"; do
      if [ "$first" = true ]; then
        first=false
      else
        files_json+=','
      fi
      files_json+="\"$f\""
    done
    files_json+=']'
  fi
  cat > "$path" <<EOF
{
  "tier": "quick",
  "coverage_required": false,
  "full_scan": false,
  "provider": "local",
  "event": "pull_request",
  "base_sha": "abc",
  "head_sha": "def",
  "lanes": {
    "$lane": { "run": $run, "files": $files_json }
  }
}
EOF
}

main() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "'"$tmp"'"' EXIT

  # ---- run=false should exit 0 silently (without invoking npx) -------------
  write_plan "$tmp/plan-a.json" frontend_unit false
  local out
  out="$(bash "$RUN_LANE" frontend_unit --plan "$tmp/plan-a.json" 2>&1)"
  case "$out" in
    *'is not selected'*) ;;
    *) fail "expected 'not selected' notice, got: $out" ;;
  esac

  # ---- unknown lane fails -----------------------------------------------
  write_plan "$tmp/plan-b.json" frontend_unit false
  if bash "$RUN_LANE" wat --plan "$tmp/plan-b.json" >/dev/null 2>&1; then
    fail "expected unknown lane to error"
  fi

  # ---- missing plan file fails -----------------------------------------
  if bash "$RUN_LANE" frontend_unit --plan "$tmp/does-not-exist.json" >/dev/null 2>&1; then
    fail "expected missing plan to error"
  fi

  # ---- run=true with mocked npx confirms file-list dispatch ------------
  # Build a fake $PATH-shadowed npx so we can capture the args without
  # actually running vitest.
  local stub_dir="$tmp/stub-bin"
  mkdir -p "$stub_dir"
  cat > "$stub_dir/npx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_OUT"
EOF
  chmod +x "$stub_dir/npx"

  write_plan "$tmp/plan-c.json" frontend_unit true components/Foo.tsx components/Bar.tsx

  STUB_OUT="$tmp/npx.args" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" frontend_unit --plan "$tmp/plan-c.json" >/dev/null 2>&1
  local args
  args="$(cat "$tmp/npx.args")"
  case "$args" in
    *vitest*related*--run*--passWithNoTests*components/Foo.tsx*components/Bar.tsx*)
      ;;
    *)
      fail "unexpected npx args for change-scoped frontend run:\n$args"
      ;;
  esac

  # ---- run=true with empty files runs full lane ------------------------
  write_plan "$tmp/plan-d.json" frontend_unit true
  STUB_OUT="$tmp/npx.args2" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" frontend_unit --plan "$tmp/plan-d.json" >/dev/null 2>&1
  args="$(cat "$tmp/npx.args2")"
  case "$args" in
    *vitest*run*) ;;
    *) fail "expected 'vitest run' for empty-files lane:\n$args" ;;
  esac
  # Should NOT include 'related' since no files
  case "$args" in
    *related*)
      fail "expected no 'vitest related' for empty files:\n$args"
      ;;
  esac

  # ---- coverage_required=true forces single-worker thread pool ---------
  cat > "$tmp/plan-e.json" <<'EOF'
{
  "tier": "full",
  "coverage_required": true,
  "full_scan": false,
  "provider": "local",
  "event": "push",
  "base_sha": "a",
  "head_sha": "b",
  "lanes": {
    "frontend_unit": { "run": true, "files": ["components/X.tsx"] }
  }
}
EOF
  STUB_OUT="$tmp/npx.args3" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" frontend_unit --plan "$tmp/plan-e.json" >/dev/null 2>&1
  args="$(cat "$tmp/npx.args3")"
  case "$args" in
    *--coverage*--pool*threads*--maxWorkers=1*--no-file-parallelism*)
      ;;
    *)
      fail "expected coverage thread-pool flags:\n$args"
      ;;
  esac
  # When coverage_required=true the lane runs the full suite, not related.
  case "$args" in
    *vitest*run*) ;;
    *) fail "coverage path should call 'vitest run':\n$args" ;;
  esac

  echo "run-lane regression checks passed"
}

main "$@"
