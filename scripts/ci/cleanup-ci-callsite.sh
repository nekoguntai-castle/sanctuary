#!/usr/bin/env bash
# Thin CI facade for the canonical manifest/receipt cleanup coordinator.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
source "$SCRIPT_DIR/provider-context.sh"
MODE="${1:-}"
[ -n "$MODE" ] || { echo 'usage: cleanup-ci-callsite.sh prepare|finish|recover|run|auto-run [options] [-- command]' >&2; exit 2; }
shift

lane= runtime= artifact_dir= state= status= engine=docker checkout_root="$PROJECT_ROOT"
authority_mode=coordinator_managed
legacy_fixture_creation_witness=false
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
  case "$1" in
    --lane) lane="${2:-}"; shift 2 ;;
    --runtime) runtime="${2:-}"; shift 2 ;;
    --artifact-dir) artifact_dir="${2:-}"; shift 2 ;;
    --state) state="${2:-}"; shift 2 ;;
    --subject-exit-status) status="${2:-}"; shift 2 ;;
    --engine) engine="${2:-}"; shift 2 ;;
    --checkout-root) checkout_root="${2:-}"; shift 2 ;;
    --authority-mode) authority_mode="${2:-}"; shift 2 ;;
    --legacy-fixture-creation-witness) legacy_fixture_creation_witness=true; shift ;;
    *) echo "unknown cleanup callsite option: $1" >&2; exit 2 ;;
  esac
done

if ! [[ "$lane" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  echo '--lane must be a non-empty path-safe identifier of at most 64 characters' >&2
  exit 2
fi

if [ "$MODE" = auto-run ]; then
  [ "${1:-}" = -- ] && [ "$#" -gt 1 ] || { echo 'auto-run requires -- COMMAND [ARG...]' >&2; exit 2; }
  provider="$(ci_authority_provider)"
  if [ "$provider" = github ] || [ "$provider" = forgejo ]; then
    temp_root="$(ci_authority_temp_dir)"
    run_id="$(ci_authority_run_id)"
    run_attempt="$(ci_authority_run_attempt)"
    [ -n "$temp_root" ] && [ -n "$run_id" ] && [ -n "$run_attempt" ] || {
      echo 'provider auto-run requires provider temp, run ID, and run attempt context' >&2
      exit 2
    }
    scope="${run_id}-${run_attempt}/$lane"
    runtime="${runtime:-$temp_root/sanctuary-cleanup/$scope}"
    artifact_dir="${artifact_dir:-$temp_root/sanctuary-cleanup-artifacts/$scope}"
    MODE=run
  else
    [ "$provider" = local ] || {
      echo 'auto-run refuses an unsupported CI provider context' >&2
      exit 2
    }
    local_root="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-cleanup-local.XXXXXX")"
    chmod 700 "$local_root"
    SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1
    SANCTUARY_LOCAL_CLEANUP_RUN_ID="local-$$-$(date +%s)"
    SANCTUARY_CI_TEMP_DIR_OVERRIDE="$local_root"
    runtime="$local_root/runtime"
    artifact_dir="$local_root/artifacts"
    export SANCTUARY_LOCAL_CLEANUP_AUTHORITY SANCTUARY_LOCAL_CLEANUP_RUN_ID \
      SANCTUARY_CI_TEMP_DIR_OVERRIDE
    MODE=run
  fi
fi

[ -n "$lane" ] && [ -n "$runtime" ] && [ -n "$artifact_dir" ] || {
  echo '--lane, --runtime, and --artifact-dir are required' >&2
  exit 2
}
mkdir -p -m 700 "$runtime" "$artifact_dir"
request_path="$runtime/$MODE-request.json"
request_args=(
  --mode "$MODE" --output "$request_path" --checkout-root "$checkout_root"
  --runtime "$runtime" --lane "$lane" --artifact-dir "$artifact_dir" --engine "$engine"
  --authority-mode "$authority_mode"
)
if [ "$legacy_fixture_creation_witness" = true ]; then
  request_args+=(--legacy-fixture-creation-witness true)
fi
if [ "$MODE" = finish ] || [ "$MODE" = recover ]; then
  request_args+=(--state "$state" --status "$status")
fi
node "$PROJECT_ROOT/scripts/ownership/write-ci-cleanup-request.mjs" "${request_args[@]}" >/dev/null

if [ "$MODE" = run ]; then
  [ "${1:-}" = -- ] && [ "$#" -gt 1 ] || { echo 'run requires -- COMMAND [ARG...]' >&2; exit 2; }
  shift
  exec node "$PROJECT_ROOT/scripts/ownership/ci-cleanup-coordinator.mjs" run "$request_path" -- "$@"
fi
[ "$#" -eq 0 ] || { echo "$MODE does not accept a subject command" >&2; exit 2; }
exec node "$PROJECT_ROOT/scripts/ownership/ci-cleanup-coordinator.mjs" "$MODE" "$request_path"
