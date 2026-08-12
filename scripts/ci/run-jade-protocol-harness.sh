#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

readonly manifest='config/jade-protocol-harness.json'
readonly runtime_image="$(jq -er '.runtime.image' "$manifest")"
readonly run_identity="$(ci_run_id)-${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-0}-$$"
readonly evidence_root="$(ci_workspace)/.tmp/ci-evidence/jade-protocol/${run_identity}"
mkdir -p "$evidence_root"
readonly ci_environment_file="$(ci_env_file)"
if [ "$ci_environment_file" != '/dev/stdout' ]; then
  ci_emit_env "JADE_PROTOCOL_PROOF_DIR=$evidence_root"
fi

jq -e -f scripts/ci/validate-jade-protocol-manifest.jq "$manifest" >/dev/null

if ! docker image inspect "$runtime_image" >/dev/null 2>&1; then
  timeout --foreground --kill-after=10s 180s docker pull "$runtime_image" >/dev/null
fi
docker image inspect "$runtime_image" > "$evidence_root/runtime-image.json"

readonly container_name="sanctuary-jade-protocol-${run_identity}"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker create --name "$container_name" --interactive \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --tmpfs /workspace:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
  --tmpfs /evidence:rw,noexec,nosuid,nodev,size=1m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 128 \
  --memory 256m \
  --cpus 1 \
  --user "$(id -u):$(id -g)" \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --workdir /workspace \
  "$runtime_image" \
  sh -eu -c '
    tar -xf - -C /workspace
    python tests/ci/jade-vendor-protocol-harness.test.py >&2
    python scripts/ci/jade-vendor-protocol-harness.py "$@" >&2
    tar -cf - -C /evidence summary.json
  ' sh "$manifest" /evidence/summary.json

# The job container's workspace path is not necessarily a valid bind source on
# the sibling Docker daemon. Stream the three required inputs through stdin and
# the proof back through stdout so the harness is portable across socket-backed
# runners without granting the proof container a writable source mount.
tar -cf - \
  "$manifest" \
  scripts/ci/jade-vendor-protocol-harness.py \
  tests/ci/jade-vendor-protocol-harness.test.py \
  | timeout --foreground --kill-after=30s 180s \
      docker start --attach --interactive "$container_name" \
      > "$evidence_root/proof-output.tar"
tar -xf "$evidence_root/proof-output.tar" -C "$evidence_root"
rm "$evidence_root/proof-output.tar"
cleanup
trap - EXIT INT TERM

jq -e '
  .status == "passed"
  and .vendorRelease == "1.0.40"
  and (.cases | sort) == ([
    "auth-http-continuation",
    "binary-psbt-extended-data",
    "rpc-error-propagation"
  ] | sort)
' "$evidence_root/summary.json" >/dev/null
sha256sum \
  "$manifest" \
  scripts/ci/jade-vendor-protocol-harness.py \
  scripts/ci/run-jade-protocol-harness.sh \
  scripts/ci/validate-jade-protocol-manifest.jq \
  tests/ci/jade-vendor-protocol-harness.test.py \
  docs/adr/0003-jade-plus-authentication-boundary.md \
  > "$evidence_root/proof-sources.sha256"
