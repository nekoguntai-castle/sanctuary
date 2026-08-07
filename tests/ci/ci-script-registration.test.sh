#!/usr/bin/env bash
#
# Completeness guard for the hand-maintained CI shell inventories.
#
# quality.yml enumerates CI shell scripts and tests by name in three lists:
#
#   1. a `bash -n` syntax sweep over scripts/ci
#   2. a `bash -n` syntax sweep over tests/ci
#   3. an execution list that actually runs tests/ci
#
# Nothing previously asserted those lists were complete, so a new script or
# test was silently unchecked until someone remembered to add it by hand.
# Six tests and eight scripts had accumulated that way (sanctuary#611),
# including the regression tests for cleanup-docker-resources.sh and
# retry-vitest-infrastructure-failure.sh — both load-bearing on required
# checks, both never executed in CI.
#
# This guard closes the loop: adding a file without registering it fails
# here. Anything deliberately excluded goes in an allowlist below **with a
# reason**, so the intent is recorded rather than inferred from absence.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

WORKFLOW="${SANCTUARY_QUALITY_WORKFLOW:-.github/workflows/quality.yml}"

FAILURES=0

fail() {
    printf '  FAIL: %s\n' "$1" >&2
    FAILURES=$((FAILURES + 1))
}

pass() {
    printf '  ok: %s\n' "$1"
}

# --- Allowlists -------------------------------------------------------------
#
# Every entry needs a reason. An allowlist without a rationale is the same
# unrecorded intent this guard exists to eliminate.

# Scripts intentionally absent from the `bash -n` sweep.
ALLOWED_UNSWEPT_SCRIPTS=(
    # vendored third-party build helper; upstream-owned, not ours to gate
    "scripts/ci/vendor/forgejo-artifact-v4/build.sh"
)

# Tests intentionally absent from the execution list.
ALLOWED_UNRUN_TESTS=()

# --- Helpers ----------------------------------------------------------------

in_list() {
    local needle="$1"
    shift
    local item
    for item in "$@"; do
        [ "$item" = "$needle" ] && return 0
    done
    return 1
}

if [ ! -f "$WORKFLOW" ]; then
    echo "FATAL: workflow not found: $WORKFLOW" >&2
    exit 1
fi

# Extract the three inventories. `bash -n <path>` for the two syntax sweeps;
# a bare `bash <path>` at line start for the execution list. Anchoring the
# execution match to line start keeps `bash -n` lines from counting as runs.
SWEPT_SCRIPTS="$(grep -oE 'bash -n scripts/ci/[^[:space:]]+\.sh' "$WORKFLOW" | sed 's/^bash -n //' | sort -u)"
SWEPT_TESTS="$(grep -oE 'bash -n tests/ci/[^[:space:]]+\.test\.sh' "$WORKFLOW" | sed 's/^bash -n //' | sort -u)"
RUN_TESTS="$(grep -oE '^[[:space:]]*bash tests/ci/[^[:space:]]+\.test\.sh' "$WORKFLOW" | sed 's/^[[:space:]]*bash //' | sort -u)"

echo "CI script registration guard"
echo "  workflow: $WORKFLOW"
echo "  swept scripts=$(echo "$SWEPT_SCRIPTS" | grep -c . || true)" \
     "swept tests=$(echo "$SWEPT_TESTS" | grep -c . || true)" \
     "run tests=$(echo "$RUN_TESTS" | grep -c . || true)"
echo

# --- 1. Every scripts/ci shell file is syntax-checked ------------------------

echo "1. scripts/ci/**/*.sh appear in the bash -n sweep"
while IFS= read -r script; do
    if echo "$SWEPT_SCRIPTS" | grep -Fxq -- "$script"; then
        continue
    fi
    if in_list "$script" "${ALLOWED_UNSWEPT_SCRIPTS[@]+"${ALLOWED_UNSWEPT_SCRIPTS[@]}"}"; then
        pass "$script (allowlisted)"
        continue
    fi
    fail "$script is never syntax-checked — add it to the bash -n sweep in $WORKFLOW"
done < <(find scripts/ci -name '*.sh' -type f | sort)
echo

# --- 2. Every tests/ci test is executed --------------------------------------

echo "2. tests/ci/*.test.sh appear in the execution list"
while IFS= read -r test_file; do
    if echo "$RUN_TESTS" | grep -Fxq -- "$test_file"; then
        continue
    fi
    if in_list "$test_file" "${ALLOWED_UNRUN_TESTS[@]+"${ALLOWED_UNRUN_TESTS[@]}"}"; then
        pass "$test_file (allowlisted)"
        continue
    fi
    fail "$test_file is never executed — add it to the execution list in $WORKFLOW"
done < <(find tests/ci -maxdepth 1 -name '*.test.sh' -type f | sort)
echo

# --- 3. Every tests/ci test is syntax-checked --------------------------------

echo "3. tests/ci/*.test.sh appear in the bash -n sweep"
while IFS= read -r test_file; do
    if echo "$SWEPT_TESTS" | grep -Fxq -- "$test_file"; then
        continue
    fi
    fail "$test_file is never syntax-checked — add it to the bash -n test sweep in $WORKFLOW"
done < <(find tests/ci -maxdepth 1 -name '*.test.sh' -type f | sort)
echo

# --- 4. No stale entries -----------------------------------------------------
#
# The inverse failure: a list naming a file that no longer exists. `bash -n`
# on a missing path fails loudly, so this is mostly a rename tripwire — but
# it also catches an execution entry silently dropped by a bad merge.

echo "4. no inventory entry names a missing file"
for listed in $SWEPT_SCRIPTS $SWEPT_TESTS $RUN_TESTS; do
    [ -f "$listed" ] || fail "$WORKFLOW references $listed, which does not exist"
done
echo

# --- 5. Allowlist entries must still exist -----------------------------------
#
# A stale allowlist silently grants an exemption to nothing, and hides that
# the reason no longer applies.

echo "5. allowlist entries are live"
for allowed in "${ALLOWED_UNSWEPT_SCRIPTS[@]+"${ALLOWED_UNSWEPT_SCRIPTS[@]}"}" \
               "${ALLOWED_UNRUN_TESTS[@]+"${ALLOWED_UNRUN_TESTS[@]}"}"; do
    [ -f "$allowed" ] || fail "allowlist names $allowed, which does not exist — drop the entry"
done
echo

if [ "$FAILURES" -gt 0 ]; then
    printf 'CI script registration guard: %d failure(s)\n' "$FAILURES" >&2
    exit 1
fi

echo "CI script registration guard passed"
