#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/build-runtime-image.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/build-runtime-image-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

pass=0
fail=0

ok() { printf 'PASS: %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; fail=$((fail + 1)); }

mkdir -p "$TEST_ROOT/bin"
cat > "$TEST_ROOT/bin/docker" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_CALLS"
SH
chmod +x "$TEST_ROOT/bin/docker"
cat > "$TEST_ROOT/bin/node" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$NODE_CALLS"
SH
chmod +x "$TEST_ROOT/bin/node"

export PATH="$TEST_ROOT/bin:$PATH"
export DOCKER_CALLS="$TEST_ROOT/docker.calls"
export NODE_CALLS="$TEST_ROOT/node.calls"
export GITHUB_SHA="$(printf 'a%.0s' $(seq 1 40))"
export SANCTUARY_IMAGE_CACHE=false

(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend:test)

if grep -Fq -- '--load --tag sanctuary-ci/backend:test' "$DOCKER_CALLS" \
  && grep -Fq -- "SANCTUARY_SOURCE_COMMIT=$GITHUB_SHA" "$DOCKER_CALLS" \
  && grep -Eq -- 'SANCTUARY_IMAGE_LOCK_SHA256=[0-9a-f]{64}' "$DOCKER_CALLS"; then
  ok 'runtime image build is loadable and binds source/image-lock evidence'
else
  bad 'runtime image build omitted load or evidence arguments'
fi

if grep -Fq -- 'write-runtime-image-evidence.mjs --role backend --image sanctuary-ci/backend:test' "$NODE_CALLS"; then
  ok 'runtime evidence generation is mandatory after the build'
else
  bad 'runtime evidence generator was not invoked'
fi

if (export GITHUB_SHA=short; cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend:test) >/dev/null 2>&1; then
  bad 'short source commit was accepted'
else
  ok 'short source commit fails closed before building'
fi

printf '\nTotal: %s Passed: %s Failed: %s\n' "$((pass + fail))" "$pass" "$fail"
[ "$fail" -eq 0 ]
