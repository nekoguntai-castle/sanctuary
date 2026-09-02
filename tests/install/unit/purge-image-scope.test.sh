#!/usr/bin/env bash
# Regression: legacy image purging must remain mutation-free. Exact image
# retirement belongs to the signed cleanup coordinator.
#
# `docker image rm -f` untags on Docker but, on rootless Podman -- what the
# runners have run since #668 -- stops and DELETES every container using the
# image, in every project. Verified directly on Podman 5.4.2:
#
#   podman image rm -f solo-probe:local
#     StopSignal SIGTERM failed to stop container ... resorting to SIGKILL
#     Deleted: bf0226b4953f...
#
# So purging `sanctuary-*:local`, which every lane shared before #728, destroys
# a concurrent lane's live stack. That is what removed backend and migrate from
# run 9110 while postgres survived (#739).
#
# A lane-scoped tag is still mutable and is not an immutable cleanup authority.
# These tests pin that the compatibility helper never reaches Docker.
#
# docker is stubbed, so nothing is removed and no daemon is needed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PASS=0
FAIL=0
FAILURES=()
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

# Run purge_shared_local_images with a stub docker, returning "<rc>|<argv>".
run_purge() {
    local tag_env="$1"
    local dir; dir="$(mktemp -d)"
    mkdir -p "$dir/bin"
    cat > "$dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/argv.log"
exit 0
STUB
    chmod +x "$dir/bin/docker"

    local rc=0
    (
        export STUB_DIR="$dir" PATH="$dir/bin:$PATH"
        # shellcheck source=/dev/null
        source "$PROJECT_ROOT/tests/install/utils/helpers.sh" >/dev/null 2>&1
        if [ "$tag_env" = "<unset>" ]; then
            unset SANCTUARY_IMAGE_TAG
        else
            export SANCTUARY_IMAGE_TAG="$tag_env"
        fi
        purge_shared_local_images >/dev/null 2>&1
    ) || rc=$?
    local argv=''
    [ -f "$dir/argv.log" ] && argv="$(tr '\n' ';' < "$dir/argv.log")"
    printf '%s|%s' "$rc" "$argv"
    rm -rf "$dir"
}

# ----- 1. an unset tag is preserved -----------------------------------------
result="$(run_purge '<unset>')"
rc="${result%%|*}"; argv="${result#*|}"
if [ "$rc" -eq 0 ]; then
    ok 'an unset SANCTUARY_IMAGE_TAG is preserved'
else
    bad "unset tag compatibility helper failed (rc=$rc)"
fi
if [ -z "$argv" ]; then
    ok 'nothing is removed when the tag is unset'
else
    bad "docker was invoked despite an unset tag: ${argv:0:120}"
fi

# ----- 2. an explicit :local is preserved too -------------------------------
result="$(run_purge 'local')"
rc="${result%%|*}"; argv="${result#*|}"
if [ "$rc" -eq 0 ] && [ -z "$argv" ]; then
    ok 'an explicit local tag is preserved and removes nothing'
else
    bad "tag=local compatibility helper mutated or failed (rc=$rc argv=${argv:0:100})"
fi

# ----- 3. a lane-scoped tag is also preserved -------------------------------
result="$(run_purge 'sanctuary-ci-upgrade-9999-latest-stable-baseline')"
rc="${result%%|*}"; argv="${result#*|}"
if [ "$rc" -eq 0 ]; then
    ok 'a lane-scoped tag is preserved'
else
    bad "lane-scoped compatibility helper failed (rc=$rc)"
fi
if [ -z "$argv" ]; then
    ok 'the compatibility helper never invokes Docker'
else
    bad "lane tag reached Docker without immutable signed authority: ${argv:0:140}"
fi
if printf '%s' "$argv" | grep -qE 'sanctuary-[a-z-]+:local(\s|$|;)'; then
    bad "the purge also targeted :local — the shared tag must never be touched"
else
    ok 'the purge never targets :local'
fi

# ----- 4. the dangerous default is gone from the source ---------------------
# A grep, deliberately: the failure mode was a defaulting expression, and it
# would be reintroduced as one.
# Scoped to the purge function body. A bare file-wide grep is wrong:
# assert_installed_image_matches_checkout legitimately *reads*
# ${SANCTUARY_IMAGE_TAG:-local} to name the image an install would use, and
# reading the operator default is fine. Only purging it is unsafe.
purge_body="$(awk '/^purge_shared_local_images\(\) \{/{f=1} f{print} f&&/^\}/{exit}' \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh")"
if [ -z "$purge_body" ]; then
    bad 'could not extract purge_shared_local_images from helpers.sh — the guard has drifted'
elif printf '%s' "$purge_body" | grep -q 'SANCTUARY_IMAGE_TAG:-local'; then
    bad 'the purge still defaults its tag to local'
else
    ok 'the purge does not default its tag to local'
fi

# ----- 5. docker-compose.yml keeps the operator default ---------------------
# The fix must not break real installs: `:local` is correct there, and only
# purging it is unsafe.
if grep -q 'image: sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local}' "$PROJECT_ROOT/docker-compose.yml"; then
    ok 'docker-compose.yml still falls back to :local for operator installs'
else
    bad 'docker-compose.yml no longer carries the :local operator default'
fi

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
    echo
    echo "Failures:" >&2
    for f in "${FAILURES[@]}"; do echo "  - $f" >&2; done
    exit 1
fi
