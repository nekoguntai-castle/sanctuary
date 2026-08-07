#!/usr/bin/env bash
# Resolve the tag a release's notes should be measured from.
#
# `git describe --tags --abbrev=0 "<tag>^"` returns the NEAREST preceding tag.
# For a stable release that is almost always its own release candidate, so the
# notes covered one or two commits instead of the whole release. v0.8.60 shipped
# a single-line body ("prev tag: v0.8.60-rc1") for a release of 42 commits, on
# both forges and inside the signed `release-notes.md` asset, which is immutable
# once published. See #720.
#
# Stable tags therefore measure from the previous STABLE tag; prereleases keep
# nearest-tag behaviour, where an RC-to-RC range is what you want.
#
# Prerelease shapes are matched POSITIVELY (`vX.Y.Z` exactly) rather than by
# excluding suffixes: this repo has used both `-rc1` and `-rc.1`, so any
# exclusion pattern is a maintenance trap. Same reasoning as
# is_stable_release_tag() in tests/install/utils/upgrade-source-refs.sh.
#
# Usage: previous-release-tag.sh <tag> [repo_root]
# Prints the resolved tag, or nothing when no earlier tag qualifies (first
# release). Exit status is 0 in both cases; empty output is a valid answer.

set -euo pipefail

TAG="${1:?usage: previous-release-tag.sh <tag> [repo_root]}"
REPO_ROOT="${2:-.}"

is_stable_release_tag() {
    [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

if is_stable_release_tag "$TAG"; then
    # --exclude '*-*' drops every prerelease shape at once, since a stable tag
    # is the only vX.Y.Z form without a hyphen.
    git -C "$REPO_ROOT" describe --tags --abbrev=0 \
        --match 'v[0-9]*.[0-9]*.[0-9]*' --exclude '*-*' \
        "${TAG}^" 2>/dev/null || true
else
    git -C "$REPO_ROOT" describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || true
fi
