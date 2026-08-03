#!/usr/bin/env bash
# Asserts that plan-test-run.sh produces the same plan under GitHub Actions,
# Forgejo Actions, and bare-local emulated environments — proving the
# provider-context adapter actually delivers portability and not just lip
# service to it.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLANNER="$ROOT_DIR/scripts/ci/plan-test-run.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

create_repo() {
  local repo="$1"
  git init -q "$repo"
  git -C "$repo" config user.email t@t
  git -C "$repo" config user.name t
  printf '{"name":"fixture"}\n' > "$repo/package.json"
  git -C "$repo" add package.json
  git -C "$repo" commit -qm base
}

# Strip the `provider` field — that's intentionally provider-specific and
# the only legitimate difference between runs.
strip_provider() {
  PAYLOAD="$1" node -e '
    const p = JSON.parse(process.env.PAYLOAD);
    delete p.provider;
    process.stdout.write(JSON.stringify(p));
  '
}

probe() {
  printf 'PROBE %s\n' "$*" >&2
}

main() {
  probe "main start"
  probe "bash=$BASH_VERSION"
  probe "node=$(node --version 2>&1)"
  probe "ROOT_DIR=$ROOT_DIR"
  probe "PLANNER=$PLANNER"
  [ -x "$PLANNER" ] || probe "WARN planner not executable"

  local tmp repo
  tmp="$(mktemp -d)"
  trap 'rm -rf "'"$tmp"'"' EXIT
  repo="$tmp/repo"
  probe "tmp=$tmp"
  create_repo "$repo"
  probe "fixture repo created"

  # Add a frontend + backend file so the planner has something interesting
  # to classify.
  mkdir -p "$repo/src/components" "$repo/server/src/services"
  printf 'export const X = 1\n' > "$repo/src/components/X.tsx"
  printf 'export const helper = true\n' > "$repo/server/src/services/helper.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'mixed change'
  local base head
  base="$(git -C "$repo" rev-parse HEAD~1)"
  head="$(git -C "$repo" rev-parse HEAD)"
  probe "base=$base head=$head"

  # Common output sinks so the three runs don't pollute each other.
  local out_gh out_fj out_local
  out_gh="$(mktemp)"
  out_fj="$(mktemp)"
  out_local="$(mktemp)"
  probe "sinks: gh=$out_gh fj=$out_fj local=$out_local"

  # All three probes start from the same scrubbed env so a globally-set
  # FORGEJO_SERVER_URL or GITHUB_SERVER_URL on the runner host doesn't leak
  # into a probe that's supposed to represent a different provider. Use
  # `env -i` to wipe the ambient env, then explicitly add only what each
  # provider scenario should expose.
  local clean_env=(env -i HOME="${HOME:-}" PATH="${PATH:-}")

  probe "running github-sim probe"
  (
    cd "$repo"
    "${clean_env[@]}" \
      GITHUB_ACTIONS=true \
      EVENT_NAME=pull_request \
      PR_BASE_SHA="$base" \
      PR_HEAD_SHA="$head" \
      GITHUB_WORKSPACE="$repo" \
      GITHUB_RUN_ID=1234 \
      RUNNER_TEMP="$tmp/runner-temp-gh" \
      bash "$PLANNER"
  ) > "$out_gh" 2>&1
  probe "github-sim done; gh_size=$(wc -c < "$out_gh") gh_first=$(head -c 80 "$out_gh")"

  probe "running forgejo-sim probe"
  (
    cd "$repo"
    "${clean_env[@]}" \
      FORGEJO_ACTIONS=true \
      EVENT_NAME=pull_request \
      PR_BASE_SHA="$base" \
      PR_HEAD_SHA="$head" \
      GITHUB_WORKSPACE="$repo" \
      GITHUB_RUN_ID=1234 \
      RUNNER_TEMP="$tmp/runner-temp-fj" \
      bash "$PLANNER"
  ) > "$out_fj" 2>&1
  probe "forgejo-sim done; fj_size=$(wc -c < "$out_fj") fj_first=$(head -c 80 "$out_fj")"

  probe "running local probe"
  (
    cd "$repo"
    "${clean_env[@]}" \
      EVENT_NAME=pull_request \
      PR_BASE_SHA="$base" \
      PR_HEAD_SHA="$head" \
      bash "$PLANNER"
  ) > "$out_local" 2>&1
  probe "local done; local_size=$(wc -c < "$out_local") local_first=$(head -c 80 "$out_local")"

  # ---- The provider field SHOULD differ between runs -----------------
  probe "extracting provider fields"
  local prov_gh prov_fj prov_local
  prov_gh="$(PAYLOAD="$(cat "$out_gh")" node -e 'process.stdout.write(JSON.parse(process.env.PAYLOAD).provider)')"
  prov_fj="$(PAYLOAD="$(cat "$out_fj")" node -e 'process.stdout.write(JSON.parse(process.env.PAYLOAD).provider)')"
  prov_local="$(PAYLOAD="$(cat "$out_local")" node -e 'process.stdout.write(JSON.parse(process.env.PAYLOAD).provider)')"
  probe "providers: gh=$prov_gh fj=$prov_fj local=$prov_local"
  [ "$prov_gh" = "github" ]    || fail "github provider sniff failed: got $prov_gh"
  [ "$prov_fj" = "forgejo" ]   || fail "forgejo provider sniff failed: got $prov_fj"
  [ "$prov_local" = "local" ]  || fail "local provider sniff failed: got $prov_local"

  # ---- The lane decisions, file lists, tier, coverage should NOT differ
  probe "comparing normalized plans"
  local norm_gh norm_fj norm_local
  norm_gh="$(strip_provider "$(cat "$out_gh")")"
  norm_fj="$(strip_provider "$(cat "$out_fj")")"
  norm_local="$(strip_provider "$(cat "$out_local")")"
  [ "$norm_gh" = "$norm_fj" ]    || fail "github vs forgejo plan diverged"
  [ "$norm_gh" = "$norm_local" ] || fail "github vs local plan diverged"

  # ---- And the lane state should be what we expect for this fixture --
  PAYLOAD="$norm_gh" node -e '
    const p = JSON.parse(process.env.PAYLOAD);
    if (p.tier !== "quick") { console.error("expected tier=quick on PR, got", p.tier); process.exit(1); }
    if (p.coverage_required !== false) { console.error("expected coverage_required=false on PR"); process.exit(1); }
    if (!p.lanes.frontend_unit.run) { console.error("expected frontend_unit.run=true"); process.exit(1); }
    if (!p.lanes.backend_unit.run)  { console.error("expected backend_unit.run=true"); process.exit(1); }
    if (p.lanes.gateway_unit.run)   { console.error("expected gateway_unit.run=false"); process.exit(1); }
    if (!p.lanes.frontend_unit.files.includes("src/components/X.tsx")) {
      console.error("expected src/components/X.tsx in frontend_unit files");
      process.exit(1);
    }
    if (!p.lanes.backend_unit.files.includes("server/src/services/helper.ts")) {
      console.error("expected server/src/services/helper.ts in backend_unit files");
      process.exit(1);
    }
  '

  # ---- Bonus: provider-context's emit channels should also route correctly
  # for each provider when the matching env file is set.
  #
  # The Forgejo runner exports GITHUB_ENV globally to its own command-file
  # path. The adapter's ci_env_file() prefers GITHUB_ENV over FORGEJO_ENV,
  # so without scrubbing the ambient env the FORGEJO probe would write
  # `BAR=2` into the runner's command file (which it interprets as a
  # `::set-env::` directive) and our probe-supplied FORGEJO_ENV file would
  # stay empty. Use `env -i` to wipe the ambient env first.
  local gh_env_file fj_env_file
  gh_env_file="$(mktemp)"
  fj_env_file="$(mktemp)"
  probe "running github-env emit probe"
  (
    "${clean_env[@]}" \
      GITHUB_ACTIONS=true GITHUB_ENV="$gh_env_file" \
      bash -c '
        . "'"$ROOT_DIR/scripts/ci/provider-context.sh"'"
        ci_emit_env "FOO=1"
      '
  )
  [ "$(cat "$gh_env_file")" = "FOO=1" ] || fail "GITHUB_ENV channel did not receive emit"
  probe "github-env emit OK"

  probe "running forgejo-env emit probe"
  (
    "${clean_env[@]}" \
      FORGEJO_ACTIONS=true FORGEJO_ENV="$fj_env_file" \
      bash -c '
        . "'"$ROOT_DIR/scripts/ci/provider-context.sh"'"
        ci_emit_env "BAR=2"
      '
  )
  [ "$(cat "$fj_env_file")" = "BAR=2" ] || fail "FORGEJO_ENV channel did not receive emit"
  probe "forgejo-env emit OK"

  rm -f "$out_gh" "$out_fj" "$out_local" "$gh_env_file" "$fj_env_file"

  echo "portability regression checks passed (github = forgejo = local)"
}

main "$@"
