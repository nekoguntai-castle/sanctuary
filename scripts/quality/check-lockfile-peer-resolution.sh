#!/usr/bin/env bash
# Non-regression check for peer-dependency resolution drift in our package-lock.json files.
#
# Background: in v0.8.47, `npm install --package-lock-only` (run by bump-version.sh) silently
# dropped nested copies of @scure/base@2.2.0 et al. that satisfied @bitcoinerlab/descriptors-core's
# peer-optional deps. `npm ci` still succeeded so existing CI gates passed, but the resolution
# state silently regressed. This script catches that class of regression by re-running npm's
# resolver against the committed lockfile and failing if any "Conflicting peer dependency",
# "ERESOLVE overriding peer", "EBADPEER", or "Could not resolve dependency" warning appears.
#
# Each package directory is checked independently. Optional peers that were unsatisfied in the
# previous lockfile and continue to be unsatisfied are still flagged, by design — opt-in
# suppression is the deliberate policy escape hatch (add the warning text to the allowlist below
# with a justification once we genuinely accept a peer-optional drop).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIRS=(. server gateway llm-egress-proxy)
PATTERNS='Conflicting peer dependency|EBADPEER|invalid peer|ERESOLVE overriding peer|Could not resolve dependency'

# Allowlisted warnings (one regex per line, comments lines starting with # are ignored). Add a
# # justification: comment immediately above each entry. Empty file = no allowances.
ALLOW_FILE="$REPO_ROOT/scripts/quality/lockfile-peer-resolution-allowlist.txt"

failures=0
for dir in "${DIRS[@]}"; do
    pkg_dir="$REPO_ROOT/$dir"
    if [ ! -f "$pkg_dir/package-lock.json" ]; then
        continue
    fi
    status=0
    out=$(cd "$pkg_dir" && npm install --package-lock-only --no-audit --no-fund --dry-run 2>&1) || status=$?
    matches=$(echo "$out" | grep -iE "$PATTERNS" || true)
    recognised="$matches"
    if [ -n "$matches" ] && [ -f "$ALLOW_FILE" ]; then
        # filter allowlisted lines
        matches=$(echo "$matches" | grep -vEf <(grep -vE '^\s*(#|$)' "$ALLOW_FILE") || true)
    fi
    if [ -n "$matches" ]; then
        echo "::error::Peer-resolution drift in $dir/package-lock.json:" >&2
        echo "$matches" | sed 's/^/  /' >&2
        echo "" >&2
        failures=$((failures + 1))
    elif [ "$status" -ne 0 ] && [ -z "$recognised" ]; then
        # npm exits non-zero on the peer warnings the allowlist accepts, so only a
        # failure with no recognised peer output (registry 5xx, timeout, crash)
        # means the resolver never produced a verdict. Fail closed.
        echo "::error::npm resolver failed for $dir/package-lock.json (exit $status); peer resolution NOT verified" >&2
        echo "$out" | tail -n 20 | sed 's/^/  /' >&2
        failures=$((failures + 1))
    else
        echo "$dir/package-lock.json: peer resolution clean"
    fi
done

if [ "$failures" -gt 0 ]; then
    echo "::error::$failures lockfile(s) have peer-resolution drift or could not be verified. Regenerate with 'rm package-lock.json && npm install' to restore the resolutions, or allowlist the warning in scripts/quality/lockfile-peer-resolution-allowlist.txt with a justification." >&2
    exit 1
fi
