#!/usr/bin/env bash
# Non-regression for issue #1038 (run 14994): the Trezor proof exported an empty
# TREZOR_EMULATOR_BRIDGE_HOST because the forwarder endpoint extraction never
# validated the host. The resolver must read the endpoints file once, fail
# closed with a named diagnostic on a missing/implausible host or port, and
# emit all four fields on the happy path.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$PROJECT_ROOT"

readonly resolver=scripts/ci/resolve-trezor-forwarder-endpoints.sh
readonly proof=scripts/ci/run-trezor-emulator-proof.sh
bash -n "$resolver"
bash -n "$proof"
[ -x "$resolver" ]

work_root=$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-trezor-endpoints-test.XXXXXX")
chmod 700 "$work_root"
forwarder_pid=0
cleanup_test() {
  local status=$?
  if [ "$forwarder_pid" -ne 0 ] && kill -0 "$forwarder_pid" 2>/dev/null; then
    kill -TERM "$forwarder_pid" 2>/dev/null || true
    wait "$forwarder_pid" 2>/dev/null || true
  fi
  rm -rf -- "$work_root"
  return "$status"
}
trap cleanup_test EXIT

fail() {
  echo "$*" >&2
  exit 1
}

expect_rejection() {
  local label="$1" file="$2" expected_fragment="$3" output='' status=0
  output="$("$resolver" "$file" 2>&1)" || status=$?
  if [ "$status" -ne 1 ]; then
    fail "$label: expected exit 1, received exit $status with output: $output"
  fi
  if [[ "$output" != *"$expected_fragment"* ]]; then
    fail "$label: diagnostic did not name the failure; received: $output"
  fi
}

# Case B (bug repro): a host-stripped copy of an otherwise valid forwarder
# document, the exact shape that let published_host go empty in run 14994.
printf '{"controllerPort":40001,"bridgePort":40002,"controlPort":40003}\n' \
  > "$work_root/host-stripped.json"
expect_rejection 'host-stripped endpoints' "$work_root/host-stripped.json" \
  'Unable to resolve Trezor proof host'

printf '{"host":"","controllerPort":40001,"bridgePort":40002,"controlPort":40003}\n' \
  > "$work_root/host-empty.json"
expect_rejection 'empty host' "$work_root/host-empty.json" \
  'Unable to resolve Trezor proof host'

printf '{"host":"0.0.0.0","controllerPort":40001,"bridgePort":40002,"controlPort":40003}\n' \
  > "$work_root/host-wildcard.json"
expect_rejection 'non-loopback host' "$work_root/host-wildcard.json" \
  "forwarder reported '0.0.0.0'"

printf '{"host":"127.0.0.1","controllerPort":40001,"controlPort":40003}\n' \
  > "$work_root/bridge-missing.json"
expect_rejection 'missing bridge port' "$work_root/bridge-missing.json" \
  'Unable to resolve Trezor proof bridge port'

printf '{"host":"127.0.0.1","controllerPort":0,"bridgePort":40002,"controlPort":40003}\n' \
  > "$work_root/controller-zero.json"
expect_rejection 'zero controller port' "$work_root/controller-zero.json" \
  'Unable to resolve Trezor proof controller port'

printf '{"host":"127.0.0.1","controllerPort":40001,"bridgePort":40002,"controlPort":70000}\n' \
  > "$work_root/control-oversized.json"
expect_rejection 'oversized control port' "$work_root/control-oversized.json" \
  'Unable to resolve Trezor proof control port'

: > "$work_root/empty.json"
expect_rejection 'empty file' "$work_root/empty.json" 'missing or empty'
expect_rejection 'absent file' "$work_root/does-not-exist.json" 'missing or empty'

printf 'not json\n' > "$work_root/garbage.json"
expect_rejection 'unparseable file' "$work_root/garbage.json" 'not a JSON object'

status=0
"$resolver" >/dev/null 2>&1 || status=$?
[ "$status" -eq 2 ] || fail "missing argument should exit 2, received $status"

# Synthetic happy path: the resolver must emit exactly host<TAB>ports.
printf '{"host":"127.0.0.1","controllerPort":40001,"bridgePort":40002,"controlPort":40003}\n' \
  > "$work_root/valid.json"
resolved="$("$resolver" "$work_root/valid.json")"
[ "$resolved" = $'127.0.0.1\t40001\t40002\t40003' ] \
  || fail "unexpected resolver output: $resolved"

# Case A (happy path against the real forwarder): the resolver accepts what
# docker-exec-tcp-forwarder.mjs actually writes. A stub docker on PATH keeps
# the forwarder from touching a real daemon; it only execs docker on connect.
stub_bin="$work_root/bin"
mkdir "$stub_bin"
cat > "$stub_bin/docker" <<'EOF'
#!/usr/bin/env bash
sleep 1
EOF
chmod +x "$stub_bin/docker"
control_token="$(printf 'a%.0s' $(seq 1 64))"
forwarder_output="$work_root/forwarder.json"
PATH="$stub_bin:$PATH" node scripts/ci/docker-exec-tcp-forwarder.mjs \
  --container sanctuary-trezor-proof-endpoints-test \
  --controller-port 9001 --bridge-port 21326 \
  --control-token "$control_token" \
  > "$forwarder_output" 2> "$work_root/forwarder.log" &
forwarder_pid=$!
for _ in $(seq 1 100); do
  if [ -s "$forwarder_output" ]; then
    break
  fi
  sleep 0.1
done
[ -s "$forwarder_output" ] || fail "real forwarder never published endpoints: $(cat "$work_root/forwarder.log")"
live_resolved="$("$resolver" "$forwarder_output")"
IFS=$'\t' read -r live_host live_controller live_bridge live_control <<< "$live_resolved"
[ "$live_host" = '127.0.0.1' ] || fail "live host mismatch: $live_host"
for port in "$live_controller" "$live_bridge" "$live_control"; do
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] \
    || fail "live port implausible: $live_resolved"
done
curl --fail --silent --show-error --request POST \
  --header "Authorization: Bearer $control_token" \
  "http://127.0.0.1:$live_control/shutdown" >/dev/null
wait "$forwarder_pid"
forwarder_pid=0

# The proof script must consume the resolver (single read, validated) rather
# than re-open the forwarder file per field, and must not let a failing vitest
# run skip forwarder teardown under set -e.
grep -Fq 'resolve-trezor-forwarder-endpoints.sh" "$forwarder_endpoints"' "$proof" \
  || fail 'proof script does not use the endpoint resolver'
# The CI image ships jq 1.6, where `jq -e` exits 0 on an empty file, so a
# readiness probe built on it passes before the forwarder has written anything.
# The readiness loop must therefore go through the resolver, never `jq -e`.
if grep -Eq "jq -e .*forwarder_endpoints|^\s+\.host == \"127\.0\.0\.1\"" "$proof"; then
  fail 'proof script still probes forwarder readiness with jq -e'
fi
if grep -Eq "jq -r '\.(host|controllerPort|bridgePort|controlPort)' \"\\\$forwarder_endpoints\"" "$proof"; then
  fail 'proof script still re-opens the forwarder endpoints file per field'
fi
grep -Fq '|| vitest_status=$?' "$proof" \
  || fail 'proof script does not guard the vitest invocation'
grep -Fq 'Unable to resolve Trezor proof host' "$proof" \
  || fail 'proof script does not validate published_host on the publish path'

echo 'trezor forwarder endpoint resolver checks passed'
