#!/usr/bin/env bash
# Regression: release notes must be measured from the previous STABLE tag.
#
# `git describe --tags --abbrev=0 "<tag>^"` returns the nearest preceding tag,
# which for a stable release is its own RC. v0.8.60 published a one-line body
# for a 42-commit release, on both forges and in the signed, immutable
# release-notes.md asset (#720).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESOLVER="$REPO_ROOT/scripts/release/previous-release-tag.sh"

PASS=0
FAIL=0
FAILURES=()

ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

assert_eq() {
  local expected="$1" actual="$2" what="$3"
  if [ "$expected" = "$actual" ]; then
    ok "$what"
  else
    bad "$what — expected '$expected', got '$actual'"
  fi
}

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
REPO="$TEST_ROOT/repo"

commit_tagged() {
  local message="$1" tag="${2:-}"
  printf '%s\n' "$message" >> "$REPO/history.txt"
  git -C "$REPO" add history.txt
  git -C "$REPO" commit -qm "$message"
  [ -z "$tag" ] || git -C "$REPO" tag "$tag"
}

mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.name "Release Test"
git -C "$REPO" config user.email "release-test@example.invalid"

# A history shaped like a real release cycle: a stable tag, then RCs leading to
# the next stable. Both RC spellings appear because this repo has used both.
commit_tagged "first release"      v1.0.0
commit_tagged "work after 1.0.0"
commit_tagged "candidate one"      v1.1.0-rc1
commit_tagged "candidate two"      v1.1.0-rc.2
commit_tagged "final touch"        v1.1.0

# ----- 1. the bug ------------------------------------------------------------
# Nearest-tag resolution returns v1.1.0-rc.2 here, which is the defect.
assert_eq "v1.0.0" "$("$RESOLVER" v1.1.0 "$REPO")" \
  'stable tag measures from the previous stable tag, not its own RC'

nearest="$(git -C "$REPO" describe --tags --abbrev=0 'v1.1.0^' 2>/dev/null || true)"
if [ "$nearest" = "v1.1.0-rc.2" ]; then
  ok 'fixture reproduces the nearest-tag behaviour the resolver must avoid'
else
  bad "fixture no longer reproduces the bug — nearest tag was '$nearest'"
fi

# ----- 2. prereleases keep nearest-tag behaviour -----------------------------
assert_eq "v1.1.0-rc1" "$("$RESOLVER" v1.1.0-rc.2 "$REPO")" \
  'prerelease measures from the nearest tag (RC-to-RC range)'
assert_eq "v1.0.0" "$("$RESOLVER" v1.1.0-rc1 "$REPO")" \
  'first RC of a cycle measures from the previous stable tag'

# ----- 3. the first release has nothing to measure from ----------------------
assert_eq "" "$("$RESOLVER" v1.0.0 "$REPO")" \
  'first stable tag resolves to empty rather than failing'

# ----- 4. both RC spellings are skipped --------------------------------------
# A pattern that excluded only "-rc[0-9]" would return v2.0.0-rc.1 here.
commit_tagged "next cycle candidate" v2.0.0-rc.1
commit_tagged "next cycle final"     v2.0.0
assert_eq "v1.1.0" "$("$RESOLVER" v2.0.0 "$REPO")" \
  'dotted RC spelling (-rc.N) is skipped for a stable tag'

# ----- 5. non-release tags never become the baseline -------------------------
commit_tagged "unrelated marker" build-2026-08-07
commit_tagged "third release"    v2.1.0
assert_eq "v2.0.0" "$("$RESOLVER" v2.1.0 "$REPO")" \
  'non-version tags are not used as the notes baseline'

echo
echo "passed: $PASS  failed: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
