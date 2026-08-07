#!/usr/bin/env bash
# Regression: concurrent lanes on one Docker daemon must not alias each other's
# images.
#
# The `:local` image tags carried no ref, so every lane on a runner shared them.
# `pull_policy: build` skips the build whenever the tag already exists, so a lane
# installing an OLD ref could boot the image a concurrent lane had just built
# from the NEW one. install-test.yml and release-candidate.yml both fire on an
# RC tag by design, which made the race structural.
#
# v0.8.60-rc1 hit it: the upgrade lane's source install (v0.8.59) picked up a
# 0.8.60 image and assert_installed_image_matches_checkout failed the lane with
# "Image sanctuary-backend:local reports version 0.8.60 but the checkout is
# 0.8.59". See #719.
#
# Operator installs and the offline bundle must keep using `:local` unchanged.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE="$REPO_ROOT/docker-compose.yml"

PASS=0
FAIL=0
FAILURES=()

ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

# ----- 1. no compose service pins an unparameterised :local tag --------------
hardcoded="$(grep -cE '^\s*image: sanctuary-[a-z-]+:local\s*$' "$COMPOSE" || true)"
if [ "${hardcoded:-0}" -eq 0 ]; then
  ok 'no compose service hardcodes a :local image tag'
else
  bad "${hardcoded} compose service(s) still hardcode :local — concurrent lanes would alias them"
fi

parameterised="$(grep -cE 'image: sanctuary-[a-z-]+:\$\{SANCTUARY_IMAGE_TAG:-local\}' "$COMPOSE" || true)"
if [ "${parameterised:-0}" -ge 7 ]; then
  ok "all ${parameterised} sanctuary image references are parameterised"
else
  bad "expected every sanctuary image to be parameterised, found ${parameterised}"
fi

# ----- 2. the default preserves operator behaviour ---------------------------
# Unset variable must resolve to exactly the historical :local tag, or every
# existing install, uninstall.sh and the offline bundle break.
resolved="$(SANCTUARY_IMAGE_TAG='' bash -c 'echo "sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local}"')"
if [ "$resolved" = "sanctuary-backend:local" ]; then
  ok 'empty SANCTUARY_IMAGE_TAG resolves to the historical :local tag'
else
  bad "empty SANCTUARY_IMAGE_TAG resolved to '$resolved', not sanctuary-backend:local"
fi
resolved_unset="$(unset SANCTUARY_IMAGE_TAG; bash -c 'echo "sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local}"')"
if [ "$resolved_unset" = "sanctuary-backend:local" ]; then
  ok 'unset SANCTUARY_IMAGE_TAG resolves to the historical :local tag'
else
  bad "unset SANCTUARY_IMAGE_TAG resolved to '$resolved_unset'"
fi

# ----- 3. the install path agrees with compose -------------------------------
# start.sh decides whether a build is needed and setup.sh validates offline
# images; if either keeps looking at :local while compose builds a lane tag, the
# lane silently reuses or rejects the wrong image.
for file in start.sh scripts/setup.sh; do
  stale="$(grep -cE 'sanctuary-[a-z-]+:local' "$REPO_ROOT/$file" || true)"
  if [ "${stale:-0}" -eq 0 ]; then
    ok "$file has no unparameterised :local reference"
  else
    bad "$file still references :local in ${stale} place(s) — it would disagree with compose"
  fi
done

# ----- 4. the helper derives a distinct, valid tag per lane ------------------
# shellcheck source=/dev/null
source "$REPO_ROOT/tests/install/utils/helpers.sh" >/dev/null 2>&1 || true

if ! declare -f export_lane_image_tag >/dev/null; then
  bad 'export_lane_image_tag is not defined in helpers.sh'
else
  ok 'export_lane_image_tag is defined'

  a="$(COMPOSE_PROJECT_NAME=sanctuary-ci-upgrade-9095-latest-stable-baseline \
       bash -c 'source "$1"; export_lane_image_tag; printf "%s" "${SANCTUARY_IMAGE_TAG:-}"' _ \
       "$REPO_ROOT/tests/install/utils/helpers.sh")"
  b="$(COMPOSE_PROJECT_NAME=sanctuary-rc-health-9110 \
       bash -c 'source "$1"; export_lane_image_tag; printf "%s" "${SANCTUARY_IMAGE_TAG:-}"' _ \
       "$REPO_ROOT/tests/install/utils/helpers.sh")"

  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" != "$b" ]; then
    ok "two lanes derive distinct image tags ($a vs $b)"
  else
    bad "lanes did not derive distinct tags: '$a' vs '$b'"
  fi

  # Docker tag grammar: [A-Za-z0-9_][A-Za-z0-9._-]{0,127}
  for tag in "$a" "$b"; do
    if printf '%s' "$tag" | grep -qE '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$'; then
      ok "derived tag '$tag' is a valid docker tag"
    else
      bad "derived tag '$tag' is not a valid docker tag"
    fi
  done

  # A project name starting with a separator, or carrying characters a tag
  # forbids, must still yield something docker accepts rather than a compose
  # error that names neither the tag nor the lane.
  weird="$(COMPOSE_PROJECT_NAME='-weird/project name' \
           bash -c 'source "$1"; export_lane_image_tag; printf "%s" "${SANCTUARY_IMAGE_TAG:-}"' _ \
           "$REPO_ROOT/tests/install/utils/helpers.sh")"
  if printf '%s' "$weird" | grep -qE '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$'; then
    ok "an awkward project name is sanitised to a valid tag ('$weird')"
  else
    bad "awkward project name produced an invalid tag: '$weird'"
  fi

  # No project name means no lane isolation to apply: leave the variable alone
  # so operator installs keep the :local default.
  none="$(COMPOSE_PROJECT_NAME='' \
          bash -c 'source "$1"; export_lane_image_tag; printf "%s" "${SANCTUARY_IMAGE_TAG:-unset}"' _ \
          "$REPO_ROOT/tests/install/utils/helpers.sh")"
  if [ "$none" = "unset" ]; then
    ok 'no COMPOSE_PROJECT_NAME leaves SANCTUARY_IMAGE_TAG unset (operator default preserved)'
  else
    bad "expected SANCTUARY_IMAGE_TAG to stay unset without a project name, got '$none'"
  fi
fi

# ----- 5. every e2e lane actually calls the helper ---------------------------
for lane in install-script fresh-install upgrade-install; do
  file="$REPO_ROOT/tests/install/e2e/${lane}.test.sh"
  [ -f "$file" ] || continue
  if grep -q '^export_lane_image_tag' "$file"; then
    ok "${lane}.test.sh derives a lane image tag"
  else
    bad "${lane}.test.sh never calls export_lane_image_tag — that lane stays aliasable"
  fi
done

echo
echo "passed: $PASS  failed: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
