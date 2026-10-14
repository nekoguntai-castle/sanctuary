#!/usr/bin/env bash
# Host-script portability contracts: the entry points and ownership libraries
# need bash >= 4.4 and must fail fast with an actionable
# message on macOS system bash 3.2, and env persistence must not depend on GNU
# `sed -i`. No Docker daemon is used.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }

# The canonical guard is whatever start.sh carries; every other file must match it.
GUARD="$(grep -m1 BASH_VERSINFO start.sh)"
[[ -n "$GUARD" ]] || fail 'start.sh has no BASH_VERSINFO guard'

# Line number of the first line that exactly equals the guard, or empty.
guard_line() { grep -nxF -- "$GUARD" "$1" | head -n 1 | cut -d: -f1 || true; }

# Line number of the first executable (non-blank, non-comment) line after the shebang.
first_statement_line() { awk 'NR > 1 && $0 !~ /^[[:space:]]*(#|$)/ { print NR; exit }' "$1"; }

# Line number of the first source/. statement.
first_source_line() { grep -nE '^[[:space:]]*(source|\.)[[:space:]]' "$1" | head -n 1 | cut -d: -f1 || true; }

entry_shebang_and_guard_contract() {
    local file line source_line
    for file in start.sh scripts/setup.sh install.sh; do
        [[ "$(head -n 1 "$file")" == '#!/usr/bin/env bash' ]] || fail "$file shebang is not #!/usr/bin/env bash"
        line="$(guard_line "$file")"
        [[ -n "$line" ]] || fail "$file is missing the bash 4.4 guard"
        source_line="$(first_source_line "$file")"
        [[ -z "$source_line" || "$line" -lt "$source_line" ]] || fail "$file guard comes after its first source line"
        [[ "$line" == "$(first_statement_line "$file")" ]] || fail "$file guard is not the first executable statement"
    done
}

identical_guard_contract() {
    local file
    for file in start.sh install.sh scripts/setup.sh scripts/ownership/producer-hooks.sh scripts/ownership/deployment-lifecycle.sh; do
        [[ "$(grep -m1 BASH_VERSINFO "$file")" == "$GUARD" ]] || fail "$file guard differs from start.sh"
    done
}

library_guard_contract() {
    local file
    for file in scripts/ownership/producer-hooks.sh scripts/ownership/deployment-lifecycle.sh; do
        [[ "$(head -n 1 "$file")" == '#!/usr/bin/env bash' ]] || fail "$file shebang is not #!/usr/bin/env bash"
        [[ "$(guard_line "$file")" == "$(first_statement_line "$file")" && -n "$(guard_line "$file")" ]] \
            || fail "$file guard is not the first executable statement"
    done
}

dependent_shebang_contract() {
    local file
    for file in uninstall.sh scripts/reconcile-postgres-password.sh scripts/ops/run-grafana-password-migration.sh; do
        [[ "$(head -n 1 "$file")" == '#!/usr/bin/env bash' ]] || fail "$file shebang is not #!/usr/bin/env bash"
    done
}

install_runs_setup_with_current_bash_contract() {
    grep -qF '"${BASH:-bash}" "$INSTALL_DIR/scripts/setup.sh"' install.sh \
        || fail 'install.sh must run setup.sh through "${BASH:-bash}"'
}

# BASH_VERSINFO is readonly, so run the guard against a stand-in array.
guard_behavior_contract() {
    local snippet output status
    snippet="${GUARD//BASH_VERSINFO/FAKE_VERSINFO}"

    status=0
    output="$(bash -c "FAKE_VERSINFO=(3 2 57 1 release x); BASH_VERSION=3.2.57; $snippet" 2>&1)" || status=$?
    [[ "$status" == 1 ]] || fail "bash 3.2 guard exit status was $status"
    [[ "$output" == *'requires bash 4.4'* ]] || fail "bash 3.2 guard message was: $output"

    status=0
    bash -c "FAKE_VERSINFO=(4 3 48 1 release x); BASH_VERSION=4.3.48; $snippet" >/dev/null 2>&1 || status=$?
    [[ "$status" == 1 ]] || fail "bash 4.3 must be rejected (status $status)"

    status=0
    bash -c "FAKE_VERSINFO=(4 4 0 1 release x); BASH_VERSION=4.4.0; $snippet" >/dev/null 2>&1 || status=$?
    [[ "$status" == 0 ]] || fail "bash 4.4 must be accepted (status $status)"

    status=0
    bash -c "FAKE_VERSINFO=(5 2 15 1 release x); BASH_VERSION=5.2.15; $snippet" >/dev/null 2>&1 || status=$?
    [[ "$status" == 0 ]] || fail "bash 5.2 must be accepted (status $status)"
}

no_gnu_sed_in_place_contract() {
    local hits
    hits="$(grep -nE 'sed -i( |$)' start.sh install.sh uninstall.sh scripts/*.sh scripts/ownership/*.sh scripts/ops/*.sh || true)"
    [[ -z "$hits" ]] || fail "GNU-only sed -i is back: $hits"
}

persist_runtime_env_value_contract() {
    local fixture value expected
    fixture="$(mktemp -d "$ROOT/.tmp/host-portability.XXXXXX")"
    for value in 'a|b&c' 'a\b' 'plain'; do
        ENV_FILE="$fixture/runtime.env"
        printf 'BEFORE=1\nKEY=old\nKEY_OTHER=keep\nAFTER=2\n' > "$ENV_FILE"
        eval "$(awk '/^persist_runtime_env_value\(\) *\{/ { printing=1 } printing { print } printing && /^}$/ { exit }' start.sh)"
        persist_runtime_env_value KEY "$value"
        expected="$(printf 'BEFORE=1\nKEY=%s\nKEY_OTHER=keep\nAFTER=2\n' "$value")"
        [[ "$(cat "$ENV_FILE")" == "$expected" ]] || fail "value '$value' not written byte-identically: $(cat "$ENV_FILE")"
        [[ "$(grep -c '^KEY=' "$ENV_FILE")" == 1 ]] || fail "KEY appears more than once for '$value'"
        [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || fail 'env file mode is not 600 after persist'
    done
}

persist_runtime_env_value_failed_copy_contract() {
    local fixture before status=0
    fixture="$(mktemp -d "$ROOT/.tmp/host-portability.XXXXXX")"
    ENV_FILE="$fixture/runtime.env"
    printf 'BEFORE=1\nKEY=old\nAFTER=2\n' > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    before="$(cat "$ENV_FILE")"
    eval "$(awk '/^persist_runtime_env_value\(\) *\{/ { printing=1 } printing { print } printing && /^}$/ { exit }' start.sh)"
    cat() {
        local arg
        for arg in "$@"; do
            case "$arg" in
                *.tmp.*) command cat "$arg" | head -n 1; return 1 ;;
            esac
        done
        command cat "$@"
    }
    persist_runtime_env_value KEY new || status=$?
    unset -f cat
    [[ "$status" != 0 ]] || fail 'persist_runtime_env_value ignored a failed copy'
    [[ "$(cat "$ENV_FILE")" == "$before" ]] || fail "failed copy truncated the env file: $(cat "$ENV_FILE")"
    [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || fail 'env file mode is not 600 after failed copy'
    [[ -z "$(ls -A "$fixture" | grep -E '\.(tmp|bak)\.' || true)" ]] || fail 'temp/backup file left after failed copy'
}

mkdir -p "$ROOT/.tmp"
failures=0
for contract in entry_shebang_and_guard_contract identical_guard_contract library_guard_contract dependent_shebang_contract \
    install_runs_setup_with_current_bash_contract guard_behavior_contract no_gnu_sed_in_place_contract \
    persist_runtime_env_value_contract persist_runtime_env_value_failed_copy_contract; do
    if ( "$contract" ); then echo "PASS: $contract"; else failures=$((failures + 1)); fi
done
[[ "$failures" == 0 ]]
