#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$repo_root/scripts/ci/check-workflows-test-only.sh"
docker_workflow="$repo_root/.github/workflows/docker-build.yml"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

bash "$checker" "$repo_root/.github/workflows" >/dev/null

[ "$(grep -c '^[[:space:]]*push: false$' "$docker_workflow" || true)" -eq 0 ] ||
  fail "Docker validation must not retain retired build-push action settings"
[ "$(grep -c '^[[:space:]]*run: scripts/ci/build-runtime-image.sh' "$docker_workflow")" -eq 5 ] ||
  fail "Docker validation must locally build, smoke, and attest all five shipped images"
if grep -Eq 'github\.server_url|packages:[[:space:]]+write|docker/login-action' "$docker_workflow"; then
  fail "Docker validation still contains a provider gate or registry authority"
fi
for workflow in install-test.yml release-candidate.yml verify-vectors.yml; do
  if grep -q 'runs-on: ubuntu-latest' "$repo_root/.github/workflows/$workflow"; then
    fail "$workflow must use the Docker-capable ubuntu-22.04 runner label"
  fi
done

mkdir -p "$test_dir/clean" "$test_dir/bad"
cat > "$test_dir/clean/test.yml" <<'YAML'
name: Test only
on:
  push:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - run: docker build .
      - uses: ./.github/actions/upload-artifact
YAML
bash "$checker" "$test_dir/clean" >/dev/null ||
  fail "read-only workflow fixture should pass"

cat > "$test_dir/bad/mutations.yml" <<'YAML'
name: Mutating workflow
on:
  workflow_dispatch:
permissions:
  packages: write
jobs:
  mutate:
    runs-on: ubuntu-22.04
    steps:
      - uses: docker/login-action@deadbeef
      - uses: docker/build-push-action@deadbeef
        with:
          push: true
      - run: docker push example.invalid/image:latest
      - run: gh release create v1
      - run: curl -X POST https://forge.invalid/api/v1/repos/o/r/actions/workflows/w.yml/dispatches
        env:
          UMBREL_DISPATCH_TOKEN: ${{ secrets.UMBREL_DISPATCH_TOKEN }}
      - uses: actions/deploy-pages@deadbeef
YAML

if bash "$checker" "$test_dir/bad" >"$test_dir/output" 2>&1; then
  fail "mutating workflow fixture should fail"
fi

for expected in \
  "write permission" \
  "registry login" \
  "image publication" \
  "distribution credential" \
  "release mutation" \
  "Pages deployment" \
  "downstream dispatch" \
  "outbound API mutation" \
  "non-diagnostic secret"; do
  grep -F "$expected" "$test_dir/output" >/dev/null ||
    fail "missing policy finding: $expected"
done

mkdir -p "$test_dir/write-all/.github/workflows"
cat > "$test_dir/write-all/.github/workflows/test.yml" <<'YAML'
name: Write all bypass
permissions: write-all
YAML
if bash "$checker" "$test_dir/write-all/.github/workflows" >/dev/null 2>&1; then
  fail "permissions: write-all must fail"
fi

mkdir -p "$test_dir/inline/.github/workflows"
cat > "$test_dir/inline/.github/workflows/test.yml" <<'YAML'
name: Inline permissions bypass
permissions: {contents: "write"}
YAML
if bash "$checker" "$test_dir/inline/.github/workflows" >/dev/null 2>&1; then
  fail "inline write permissions must fail"
fi

mkdir -p "$test_dir/composite/.github/workflows" "$test_dir/composite/.github/actions/publish"
cat > "$test_dir/composite/.github/workflows/test.yml" <<'YAML'
name: Composite bypass
jobs:
  test:
    steps:
      - uses: ./.github/actions/publish
YAML
cat > "$test_dir/composite/.github/actions/publish/action.yml" <<'YAML'
name: Hidden publisher
runs:
  using: composite
  steps:
    - run: docker push example.invalid/image:latest
      shell: bash
YAML
if bash "$checker" "$test_dir/composite/.github/workflows" >/dev/null 2>&1; then
  fail "mutation hidden in a local composite action must fail"
fi

echo "workflow test-only policy checks passed"
