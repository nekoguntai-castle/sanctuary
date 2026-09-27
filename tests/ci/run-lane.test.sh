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

assert_related_workspace() {
  local tmp="$1" stub_dir="$2" lane_name="$3" workspace="$4"
  local prefix="$workspace/" expected_cwd="$ROOT_DIR/$workspace"
  local expected_args=(vitest related --run --passWithNoTests)
  case "$workspace" in
    .) prefix=''; expected_cwd="$ROOT_DIR"; expected_args+=(--config config/tooling/vitest.config.ts) ;;
    server) expected_args+=(--exclude 'tests/integration/**' --exclude '**/*.integration.test.*') ;;
  esac
  write_plan "$tmp/related.json" "$lane_name" true "${prefix}src/space name.ts" "${prefix}src/$workspace/nested.ts" "${prefix}-leading.ts"
  STUB_OUT="$tmp/related.args" STUB_CWD="$tmp/related.cwd" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" "$lane_name" --plan "$tmp/related.json" >/dev/null 2>&1
  assert_eq "$lane_name cwd" "$expected_cwd" "$(cat "$tmp/related.cwd")"
  expected_args+=('src/space name.ts' "src/$workspace/nested.ts" './-leading.ts')
  assert_eq "$lane_name exact related argv" "$(printf '%s\n' "${expected_args[@]}")" "$(cat "$tmp/related.args")"
  local status=0
  STUB_EXIT=23 STUB_OUT="$tmp/related.args" STUB_CWD="$tmp/related.cwd" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" "$lane_name" --plan "$tmp/related.json" >/dev/null 2>&1 || status=$?
  assert_eq "$lane_name Vitest failure status" 23 "$status"
}

assert_mutation_dispatch() {
  local tmp="$1" stub_dir="$2"
  write_plan "$tmp/mutation.json" critical_mutation true
  STUB_OUT="$tmp/mutation.args" STUB_CWD="$tmp/mutation.cwd" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" critical_mutation --plan "$tmp/mutation.json" >/dev/null 2>&1
  assert_eq 'mutation cwd' "$ROOT_DIR/server" "$(cat "$tmp/mutation.cwd")"
  assert_eq 'mutation exact argv' "$(printf '%s\n' run test:mutation:critical:gate)" "$(cat "$tmp/mutation.args")"
  node -e 'const p = require(process.argv[1]); if (!p.scripts[process.argv[2]]) process.exit(1)' \
    "$ROOT_DIR/server/package.json" test:mutation:critical:gate || fail 'mutation script missing from package'
  local status=0
  STUB_EXIT=37 STUB_OUT="$tmp/mutation.args" STUB_CWD="$tmp/mutation.cwd" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" critical_mutation --plan "$tmp/mutation.json" >/dev/null 2>&1 || status=$?
  assert_eq 'mutation failing gate status' 37 "$status"
}

assert_workspace_modes() {
  local tmp="$1" stub_dir="$2" lane_name="$3"
  write_plan "$tmp/modes.json" "$lane_name" true
  STUB_OUT="$tmp/modes.args" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" "$lane_name" --plan "$tmp/modes.json" >/dev/null 2>&1
  assert_eq "$lane_name empty mode" run "$(sed -n '2p' "$tmp/modes.args")"
  node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1])); p.coverage_required=true; p.lanes[process.argv[2]].files=["workspace/src/file.ts"]; fs.writeFileSync(process.argv[1],JSON.stringify(p));' \
    "$tmp/modes.json" "$lane_name"
  STUB_OUT="$tmp/modes.args" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" "$lane_name" --plan "$tmp/modes.json" >/dev/null 2>&1
  assert_eq "$lane_name coverage mode" run "$(sed -n '2p' "$tmp/modes.args")"
  grep -Fxq -- --coverage "$tmp/modes.args" || fail "$lane_name missing coverage flag"
}

assert_normalizer_failure() {
  local tmp="$1" stub_dir="$2"
  mkdir -p "$tmp/failing-runner"
  cp "$RUN_LANE" "$ROOT_DIR/scripts/ci/provider-context.sh" "$tmp/failing-runner/"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 29' > "$tmp/failing-runner/related-test-args.sh"
  write_plan "$tmp/failure.json" backend_unit true server/src/example.ts
  local status=0
  STUB_OUT="$tmp/forbidden.args" PATH="$stub_dir:$PATH" \
    bash "$tmp/failing-runner/run-lane.sh" backend_unit --plan "$tmp/failure.json" >/dev/null 2>&1 || status=$?
  assert_eq 'normalizer failure status' 29 "$status"
  [ ! -e "$tmp/forbidden.args" ] || fail 'normalizer failure dispatched Vitest'
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
if [ -n "${STUB_CWD:-}" ]; then pwd > "$STUB_CWD"; fi
exit "${STUB_EXIT:-0}"
EOF
  chmod +x "$stub_dir/npx"
  cp "$stub_dir/npx" "$stub_dir/npm"

  write_plan "$tmp/plan-c.json" frontend_unit true src/components/Foo.tsx src/components/Bar.tsx

  STUB_OUT="$tmp/npx.args" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" frontend_unit --plan "$tmp/plan-c.json" >/dev/null 2>&1
  local args
  args="$(cat "$tmp/npx.args")"
  case "$args" in
    *vitest*related*--run*--passWithNoTests*src/components/Foo.tsx*src/components/Bar.tsx*)
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
    "frontend_unit": { "run": true, "files": ["src/components/X.tsx"] }
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

  # ---- tier=quick full-suite excludes *.slow.test.* ---------------------
  cat > "$tmp/plan-f.json" <<'EOF'
{
  "tier": "quick",
  "coverage_required": false,
  "full_scan": true,
  "provider": "local",
  "event": "pull_request",
  "base_sha": "a",
  "head_sha": "b",
  "lanes": {
    "frontend_unit": { "run": true, "files": [] }
  }
}
EOF
  STUB_OUT="$tmp/npx.args4" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" frontend_unit --plan "$tmp/plan-f.json" >/dev/null 2>&1
  args="$(cat "$tmp/npx.args4")"
  case "$args" in
    *vitest*run*--exclude*\*\*/\*.slow.test.\**) ;;
    *) fail "quick tier full-suite should exclude **/*.slow.test.*:\n$args" ;;
  esac

  # ---- tier=full does NOT add the slow exclude --------------------------
  cat > "$tmp/plan-g.json" <<'EOF'
{
  "tier": "full",
  "coverage_required": false,
  "full_scan": true,
  "provider": "local",
  "event": "push",
  "base_sha": "a",
  "head_sha": "b",
  "lanes": {
    "frontend_unit": { "run": true, "files": [] }
  }
}
EOF
  STUB_OUT="$tmp/npx.args5" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" frontend_unit --plan "$tmp/plan-g.json" >/dev/null 2>&1
  args="$(cat "$tmp/npx.args5")"
  case "$args" in
    *--exclude*\*\*/\*.slow.test.\**)
      fail "full tier should not add slow-test exclude:\n$args" ;;
  esac

  # ---- backend_unit lane excludes integration tests by both patterns ----
  cat > "$tmp/plan-h.json" <<'EOF'
{
  "tier": "quick",
  "coverage_required": false,
  "full_scan": false,
  "provider": "local",
  "event": "pull_request",
  "base_sha": "a",
  "head_sha": "b",
  "lanes": {
    "backend_unit": { "run": true, "files": [] }
  }
}
EOF
  STUB_OUT="$tmp/npx.args6" PATH="$stub_dir:$PATH" \
    bash "$RUN_LANE" backend_unit --plan "$tmp/plan-h.json" >/dev/null 2>&1
  args="$(cat "$tmp/npx.args6")"
  case "$args" in
    *--exclude*tests/integration/\*\**) ;;
    *) fail "backend_unit should exclude tests/integration/**:\n$args" ;;
  esac
  case "$args" in
    *--exclude*\*\*/\*.integration.test.\**) ;;
    *) fail "backend_unit should exclude **/*.integration.test.*:\n$args" ;;
  esac

  local failures=0
  (assert_related_workspace "$tmp" "$stub_dir" frontend_unit .) || failures=$((failures + 1))
  (assert_related_workspace "$tmp" "$stub_dir" backend_unit server) || failures=$((failures + 1))
  (assert_related_workspace "$tmp" "$stub_dir" gateway_unit gateway) || failures=$((failures + 1))
  (assert_mutation_dispatch "$tmp" "$stub_dir") || failures=$((failures + 1))
  (assert_workspace_modes "$tmp" "$stub_dir" backend_unit) || failures=$((failures + 1))
  (assert_workspace_modes "$tmp" "$stub_dir" gateway_unit) || failures=$((failures + 1))
  (assert_normalizer_failure "$tmp" "$stub_dir") || failures=$((failures + 1))
  assert_eq 'new lane contract failures' 0 "$failures"
  echo "run-lane regression checks passed"
}

main "$@"
