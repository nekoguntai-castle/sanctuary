#!/usr/bin/env bash
set -euo pipefail

# actionlint checks workflow run blocks concurrently. The Forgejo Podman runner's
# pinned Ubuntu image can deadlock when several ShellCheck processes consume
# actionlint-owned stdin pipes at once, so serialize only this integration point.
flock_bin="${SANCTUARY_ACTIONLINT_FLOCK_BIN:-/usr/bin/flock}"
shellcheck_bin="${SANCTUARY_ACTIONLINT_SHELLCHECK_BIN:-/usr/bin/shellcheck}"
lock_file="${SANCTUARY_ACTIONLINT_SHELLCHECK_LOCK:-${TMPDIR:-/tmp}/sanctuary-actionlint-shellcheck.lock}"

if [[ ! -x "$flock_bin" ]]; then
  printf 'actionlint-shellcheck: flock executable not found: %s\n' "$flock_bin" >&2
  exit 127
fi
if [[ ! -x "$shellcheck_bin" ]]; then
  printf 'actionlint-shellcheck: shellcheck executable not found: %s\n' "$shellcheck_bin" >&2
  exit 127
fi

exec "$flock_bin" "$lock_file" "$shellcheck_bin" "$@"
