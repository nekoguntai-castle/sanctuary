#!/usr/bin/env bash
#
# API-bound helpers for publish-release.sh. This file is sourced by the trusted
# operator command and intentionally has no top-level side effects.

api_request() {
  local method="$1"
  local url="$2"
  local token="$3"
  local output_file="$4"
  shift 4
  local headers=(-H "Accept: application/json")
  local http_code

  if ! http_code="$(printf 'header = \"Authorization: token %s\"\\n' "$token" \
    | curl --config - -sS -o "$output_file" -w '%{http_code}' --max-time 30 \
      -X "$method" "${headers[@]}" "$@" "$url")"; then
    echo "000"
    return 1
  fi
  echo "$http_code"
}

expect_json_sha() {
  local label="$1"
  local expected="$2"
  local response_file="$3"
  local actual
  actual="$(jq -r '.sha // empty' "$response_file")"
  [[ "$actual" == "$expected" ]] || fail "$label resolves to ${actual:-nothing}, expected $expected"
}

verify_forgejo_tag() {
  local response="$TEMP_DIR/forgejo-tag.json"
  local url="${FORGEJO_URL%/}/api/v1/repos/${FORGEJO_OWNER}/${FORGEJO_REPO}/git/commits/${TAG}"
  local code
  code="$(api_request GET "$url" "$FORGEJO_TOKEN" "$response")" \
    || fail "Forgejo tag lookup transport failure"
  [[ "$code" == "200" ]] || fail "Forgejo tag lookup returned HTTP $code"
  expect_json_sha "Forgejo tag $TAG" "$RELEASE_COMMIT" "$response"
}

verify_forgejo_release_gate() {
  local response="$TEMP_DIR/forgejo-runs.json"
  local base="${FORGEJO_URL%/}/api/v1/repos/${FORGEJO_OWNER}/${FORGEJO_REPO}"
  local code
  code="$(api_request GET "$base/actions/runs?event=push&head_sha=${RELEASE_COMMIT}&limit=50" \
    "$FORGEJO_TOKEN" "$response")" || fail "Forgejo Actions lookup transport failure"
  [[ "$code" == "200" ]] || fail "Forgejo Actions lookup returned HTTP $code"

  local run_id
  while IFS= read -r run_id; do
    [[ -n "$run_id" ]] || continue
    if forgejo_run_is_green_tag_gate "$base" "$run_id"; then
      echo "Forgejo release gate is green for $TAG (run $run_id)"
      return
    fi
  done < <(jq -r '.workflow_runs[]? | select(.workflow_id == "install-test.yml" and .event == "push" and .status == "success") | .id' "$response")
  # Name what was actually found. The bare "no run matches" gave no way to tell a wrong event
  # from a wrong ref from a wrong commit, which is what made this an hour of guesswork.
  local all_runs="$TEMP_DIR/forgejo-runs-unfiltered.json"
  if [[ "$(api_request GET "$base/actions/runs?head_sha=${RELEASE_COMMIT}&limit=50" \
    "$FORGEJO_TOKEN" "$all_runs")" == "200" ]]; then
    jq -r '.workflow_runs[]? | select(.workflow_id == "install-test.yml")
      | "  observed: id=\(.id) event=\(.event) status=\(.status) ref=\(.prettyref)"' \
      "$all_runs" >&2 || true
  fi
  fail "no successful install-test.yml push run matches tag $TAG (or $TAG-rc<N>) at $RELEASE_COMMIT"
}

forgejo_run_is_green_tag_gate() {
  local base="$1"
  local run_id="$2"
  local response="$TEMP_DIR/forgejo-run-${run_id}.json"
  local code
  code="$(api_request GET "$base/actions/runs/$run_id" "$FORGEJO_TOKEN" "$response")" || return 1
  [[ "$code" == "200" ]] || return 1
  # The stable tag and its release candidates are validated by the SAME workflow, at the same
  # commit, with the same scope: install-test.yml fires on every refs/tags/v* and
  # classify-install-scope.sh gives them all `release-critical`. Accepting <tag>-rc<N> therefore
  # adds no new trust -- it recognises validation that already happened on identical bytes -- and
  # removes a duplicate ~2h matrix that v0.8.64 lost to infrastructure three times (issue #837).
  #
  # Everything else stays pinned. commit_sha must still equal the release commit, so an RC that
  # was cut from different bytes cannot vouch for this tag. `event == "push"` is deliberately NOT
  # relaxed: workflow_dispatch carries a `test_suite` input that can narrow the run to `unit`, and
  # the run JSON does not expose inputs, so a dispatch run cannot be proven to have covered the
  # release-critical lanes.
  jq -e \
    --arg tag "$TAG" \
    --arg sha "$RELEASE_COMMIT" \
    '.workflow_id == "install-test.yml"
      and .event == "push"
      and .status == "success"
      and (.prettyref == $tag
        or ((.prettyref | startswith($tag + "-rc"))
          and ((.prettyref | ltrimstr($tag + "-rc")) | test("^[0-9]+$"))))
      and .commit_sha == $sha' \
    "$response" >/dev/null
}

github_api_request() {
  local method="$1"
  local url="$2"
  local output_file="$3"
  shift 3
  local http_code
  if ! http_code="$(printf 'header = \"Authorization: Bearer %s\"\\n' "$GITHUB_RELEASE_TOKEN" \
    | curl --config - -sS -o "$output_file" -w '%{http_code}' --max-time 30 \
      -X "$method" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$@" "$url")"; then
      echo "000"
      return 1
  fi
  echo "$http_code"
}

verify_github_actions_disabled() {
  local response="$TEMP_DIR/github-actions-permissions.json"
  local url="${GITHUB_API_URL%/}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/permissions"
  local code
  code="$(github_api_request GET "$url" "$response")" \
    || fail "GitHub Actions permission lookup transport failure"
  [[ "$code" == "200" ]] || fail "GitHub Actions permission lookup returned HTTP $code"
  jq -e '.enabled == false' "$response" >/dev/null \
    || fail "GitHub Actions must be disabled before publishing a tag"
}

github_tag_commit() {
  local base="$1"
  local response_file="$2"
  local object_type object_sha code depth=0
  object_type="$(jq -r '.object.type // empty' "$response_file")"
  object_sha="$(jq -r '.object.sha // empty' "$response_file")"

  while [[ "$object_type" == "tag" && "$depth" -lt 5 ]]; do
    code="$(github_api_request GET "$base/git/tags/$object_sha" "$response_file")" \
      || fail "GitHub annotated tag lookup transport failure"
    [[ "$code" == "200" ]] || fail "GitHub annotated tag lookup returned HTTP $code"
    object_type="$(jq -r '.object.type // empty' "$response_file")"
    object_sha="$(jq -r '.object.sha // empty' "$response_file")"
    depth=$((depth + 1))
  done
  [[ "$object_type" == "commit" && "$object_sha" =~ ^[0-9a-f]{40}$ ]] \
    || fail "GitHub tag does not peel to a commit"
  echo "$object_sha"
}

verify_github_tag_response() {
  local base="$1"
  local response_file="$2"
  local actual
  actual="$(github_tag_commit "$base" "$response_file")"
  [[ "$actual" == "$RELEASE_COMMIT" ]] \
    || fail "GitHub tag $TAG resolves to $actual, expected $RELEASE_COMMIT"
}

verify_github_tag() {
  local base="${GITHUB_API_URL%/}/repos/${GITHUB_OWNER}/${GITHUB_REPO}"
  local response="$TEMP_DIR/github-tag.json"
  local encoded_tag code
  encoded_tag="$(jq -rn --arg value "$TAG" '$value | @uri')"
  code="$(github_api_request GET "$base/git/ref/tags/$encoded_tag" "$response")" \
    || fail "GitHub tag lookup transport failure"
  [[ "$code" == "200" ]] || fail "GitHub tag lookup returned HTTP $code"
  verify_github_tag_response "$base" "$response"
}

ensure_github_tag() {
  local base="${GITHUB_API_URL%/}/repos/${GITHUB_OWNER}/${GITHUB_REPO}"
  local response="$TEMP_DIR/github-tag.json"
  local encoded_tag
  encoded_tag="$(jq -rn --arg value "$TAG" '$value | @uri')"
  local code
  code="$(github_api_request GET "$base/git/ref/tags/$encoded_tag" "$response")" \
    || fail "GitHub tag lookup transport failure"
  if [[ "$code" == "200" ]]; then
    verify_github_tag_response "$base" "$response"
    return
  fi
  [[ "$code" == "404" ]] || fail "GitHub tag lookup returned HTTP $code"

  code="$(github_api_request GET "$base/commits/$RELEASE_COMMIT" "$response")" \
    || fail "GitHub commit lookup transport failure"
  [[ "$code" == "200" ]] || fail "release commit is not yet present on GitHub (HTTP $code)"
  expect_json_sha "GitHub commit" "$RELEASE_COMMIT" "$response"

  local payload
  payload="$(jq -cn --arg ref "refs/tags/$TAG" --arg sha "$RELEASE_COMMIT" \
    '{ref: $ref, sha: $sha}')"
  code="$(github_api_request POST "$base/git/refs" "$response" \
    -H "Content-Type: application/json" -d "$payload")" \
    || fail "GitHub tag creation transport failure"
  if [[ "$code" != "201" && "$code" != "422" ]]; then
    fail "GitHub tag creation returned HTTP $code"
  fi

  code="$(github_api_request GET "$base/git/ref/tags/$encoded_tag" "$response")" \
    || fail "GitHub tag verification transport failure"
  [[ "$code" == "200" ]] || fail "GitHub tag verification returned HTTP $code"
  verify_github_tag_response "$base" "$response"
}
