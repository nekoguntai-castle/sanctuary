#!/usr/bin/env bash
#
# A compose healthcheck written as ["CMD","sh","-c",<script>] does not survive
# the compose -> Podman compat API path when <script> contains shell syntax such
# as a conditional: the script reaches sh truncated and every probe fails with
#
#   [: line 0: syntax error: unexpected end of file (expecting "then")
#
# which marks the container permanently unhealthy. That failed the gateway on
# install-test run 8667 after the runners moved from Docker-in-Docker to
# rootless Podman. The CMD-SHELL form round-trips intact on both engines.
#
# Bare CMD arrays are fine — most healthchecks here are a single wget with no
# shell syntax, and those are unaffected. This asserts only the narrow rule:
# if a healthcheck embeds shell control syntax, it must use CMD-SHELL.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE="$PROJECT_ROOT/docker-compose.yml"

PASS=0
FAILURES=()

check() {
  local description="$1"
  shift
  if "$@"; then
    PASS=$((PASS + 1))
    printf 'PASS: %s\n' "$description"
  else
    FAILURES+=("$description")
    printf 'FAIL: %s\n' "$description" >&2
  fi
}

[ -f "$COMPOSE" ] || { printf 'FAIL: %s not found\n' "$COMPOSE" >&2; exit 1; }

# Any line carrying shell control syntax inside a healthcheck must not be part
# of a CMD + sh -c array. Detect by finding shell-conditional lines and walking
# back a few lines to see which form introduced them.
no_cmd_sh_c_with_shell_syntax() {
  local offenders
  offenders="$(
    awk '
      /"CMD"/            { cmd_line = NR; sh_c = 0 }
      /"sh"/             { if (NR - cmd_line <= 2) sh_c = 1 }
      /if \[|&&|\|\||;[[:space:]]*then/ {
        if (sh_c && NR - cmd_line <= 6) print NR": "$0
      }
    ' "$COMPOSE"
  )"
  if [ -n "$offenders" ]; then
    printf 'healthchecks using CMD + sh -c with shell syntax:\n%s\n' "$offenders" >&2
    return 1
  fi
  return 0
}

# The gateway is the concrete case that regressed; assert its form directly so
# a future edit cannot quietly revert it.
gateway_healthcheck_uses_cmd_shell() {
  awk '/^  gateway:/{f=1} f && /healthcheck:/{h=1} h && /CMD-SHELL/{found=1} h && /^  [a-z-]+:$/ && !/gateway/{exit} END{exit(found?0:1)}' "$COMPOSE"
}

check "no healthcheck embeds shell syntax in a CMD + sh -c array" \
  no_cmd_sh_c_with_shell_syntax
check "gateway healthcheck uses CMD-SHELL" \
  gateway_healthcheck_uses_cmd_shell

printf '\n====================\n'
printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "${#FAILURES[@]}"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf 'Failing checks:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
