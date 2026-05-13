# Workflow audit — 2026-05-12

Files reviewed (10): `architecture.yml`, `create-release.yml`, `docker-build.yml`,
`install-test.yml`, `quality.yml`, `release-candidate.yml`, `release.yml`,
`release-offline-bundle.yml`, `test.yml`, `verify-vectors.yml`.

Notes: GitHub-only jobs in `release.yml` / `create-release.yml` / `release-offline-bundle.yml`
are gated by `github.server_url == 'https://github.com'` — expected dead code on Forgejo
(memory `feedback_github_mirror_decommissioned`). Not flagged.

---

### [HIGH] release.yml:283 — Workflow_call passes attacker-controllable `sha` as ref
**Category:** security
**What:** `release.yml` triggers `release-candidate.yml` via `workflow_call` with
`ref: ${{ needs.wait-for-install-tests.outputs.sha }}`. `sha` comes from the
`resolve-sha` step which, on `workflow_dispatch`, accepts user-supplied `INPUT_VERSION`
and looks the tag up via `gh api`. Although the version is regex-validated and SHA is
later regex-validated as 40-hex, the called workflow checks out that ref and then builds
and pushes Docker images to GHCR — meaning an operator who can dispatch can pin the
release to any commit in the repo.
**Why it matters:** Insider supply-chain exposure: a tag could be created at a benign
commit, then `workflow_dispatch` with `version` pointing at a different already-pushed
tag whose underlying commit was force-updated would let a malicious actor publish
images from the wrong tree.
**Repro / trigger:** Manual `workflow_dispatch` with a `version` whose annotated-tag
target was rewritten between RC validation and release.
**Fix shape:** Require the resolved SHA to match the tag object stored at validation
time, not at release time; or block `workflow_dispatch` for the release path entirely
and rely only on `push` events.
**Confidence:** medium

### [HIGH] install-test.yml:1119 — `cleanup-docker-resources.sh --runner-leftovers` still runs
**Category:** ci-invariant
**What:** Memory `feedback_ci_clobbers_prod_volumes` (dated earlier) records that this
host's `install-test.yml` cleanup wiped dev's `sanctuary_postgres_data` /
`sanctuary_redis_data`. The current script (`scripts/ci/cleanup-docker-resources.sh`)
now has a `protected_projects=(sanctuary beacon ...)` allowlist and the runner-leftovers
path only touches `FORGEJO-ACTIONS-TASK-*` containers and `WORKFLOW-*` empty networks
— so the literal regression appears fixed. However, the `docker-resource-cleanup` job
still runs on every non-PR run (push to main / scheduled / tag) and depends on the
allowlist staying correct. The `sanctuary` literal hard-coded in the script is the only
thing between CI and dev volumes; if anyone renames the dev `COMPOSE_PROJECT_NAME` or
adds another stack the allowlist doesn't know about, it gets clobbered.
**Why it matters:** Single-source guard with no test asserting it. Allowlist drift =
silent prod-data loss on the self-hosted runner.
**Repro / trigger:** Rename dev compose project, run any scheduled `install-test.yml`.
**Fix shape:** Add a regression test (Bats / shellcheck-style) that asserts the
allowlist contains every protected project name listed in `docker-compose.yml`
COMPOSE_PROJECT_NAME on this host; or restrict the cleanup job to a dedicated runner
label that production volumes don't share.
**Confidence:** medium

### [HIGH] install-test.yml:215, 385, 414, 580, 721, 866, 1018, 1078 — `concurrency.group` keyed on `github.ref`
**Category:** ci-invariant
**What:** Eight E2E jobs share `group: sanctuary-runner-e2e-${{ github.ref }}` with
`cancel-in-progress: false`. The intent is to serialize E2E jobs against the runner's
dind so they don't race. But `github.ref` differs across PR/tag/branch refs, so a tag
push and a scheduled main push can hold the lock simultaneously. Per memory
`feedback_forgejo_runner_concurrency.md`, Forgejo's act_runner already ignores
matrix max-parallel and job-level concurrency; serialization here relies on the host's
runner capacity, not the group key.
**Why it matters:** Apparent serialization is a fiction on Forgejo. Two concurrent
E2E jobs both call `docker compose up -d --build` and `cleanup-docker-resources.sh
--project` against the same dind, with different `COMPOSE_PROJECT_NAME`s but a shared
build cache and shared network namespace.
**Repro / trigger:** Tag push during a scheduled run; or two PRs landing in merge_group.
**Fix shape:** Either drop the lie (delete the `concurrency:` block; document that
serialization is enforced by `runner.capacity=1` on the self-hosted runner), or move to
a single-bash-loop job per the memory's recommended pattern.
**Confidence:** high

### [MEDIUM] install-test.yml:280, 297 — `KEEP_CONTAINERS` env from `inputs.keep_containers` interpolated into `bash -c`
**Category:** security
**What:** `KEEP_CONTAINERS: ${{ github.event.inputs.keep_containers }}` is passed via
env, then expanded inside a heredoc-less `bash -c "..."` shell using `${KEEP_CONTAINERS:-false}`.
GitHub's `inputs.keep_containers` is `type: boolean` so the value is constrained to
`true`/`false` — safe today. But the surrounding `bash -c "..."` is built with double
quotes and uses `\"$SANCTUARY_INSTALL_WORKSPACE\"` substitution, so the pattern is
fragile against future input-type changes.
**Why it matters:** Smell, not active vuln — but the same pattern repeats in 6+ places
across install-test.yml and is the exact shape that the apostrophe-in-comment bug
(mentioned in architecture.yml:65-68 comments) burned.
**Repro / trigger:** Change input type from boolean to string; injection becomes live.
**Fix shape:** Replace `bash -c "..."` with quoted-delimiter heredocs (`bash <<'INNER'`)
matching architecture.yml's lesson-learned pattern.
**Confidence:** medium

### [MEDIUM] release-offline-bundle.yml:131-181 — Raw `curl | jq` on attacker-influenced JSON
**Category:** logic
**What:** The release-asset upload sequence does `REL=$(curl ...) ; REL_ID=$(echo $REL | jq -r '.id // empty')`
without checking the HTTP status. If GitHub/Forgejo returns an HTML error page or a
rate-limit JSON, `REL_ID` becomes empty and the next `if [ -z ]` branch creates a new
release — potentially clobbering a legitimate existing release object on retry.
Asset deletion (`for aid in $EXISTING; do curl -X DELETE ...`) also continues silently
on auth failures.
**Why it matters:** A flaky API response can create duplicate Release objects or
delete assets without an error code.
**Repro / trigger:** GitHub API 5xx during a release tag push.
**Fix shape:** Use `curl -fsS -w "%{http_code}"` and abort on non-2xx; assert the
parsed `.id` is a numeric string before branching.
**Confidence:** medium

### [MEDIUM] install-test.yml:1500-1514 — Forgejo workflow_dispatch payload built with shell variable interpolation
**Category:** security
**What:** The Umbrel dispatch body is built via `jq -n --arg ver "$VERSION" --arg fe
"$FRONTEND_DIGEST" --arg be "$BACKEND_DIGEST" ...`. `VERSION` comes from
`${TAG#v}` where `TAG=${{ github.ref_name }}` and is regex-validated upstream as
`v[0-9]+\.[0-9]+\.[0-9]+(-...)?`. Digests are regex-validated as `sha256:<64hex>`.
Today this is safe. But the digests come from a downloaded artifact and are only
validated against shape, not provenance: if `publish-images` succeeds and someone
modifies the artifact between jobs (Forgejo doesn't sign artifacts), the dispatched
digest could be replaced.
**Why it matters:** Cross-repo digest pinning relies on artifact integrity. The
sanctuary-umbrel receiver trusts whatever digest it gets and updates compose files.
**Repro / trigger:** Compromised dind on the self-hosted runner during the gap
between `publish-images` and `notify-umbrel`.
**Fix shape:** Recompute digests with `docker buildx imagetools inspect` against
the registry inside the notify job, instead of reading them from an artifact.
**Confidence:** low

### [MEDIUM] release.yml — `verify-prerelease` accepts any release event with `prerelease=true`
**Category:** ci-invariant
**What:** `verify-prerelease` ensures the published release IS a pre-release (and
auto-converts it if not). Combined with `wait-for-install-tests` + `release-candidate`,
this is the gate to converting pre-release → full release at line 588. If
`wait-for-install-tests` polls a non-deterministic Install Tests run and somehow accepts
a `success` from a different SHA (the pre-2026-05 bug mentioned at lines 222-225), the
auto-conversion at line 589 runs unconditionally. The fix added at 234-243 pins to
the run with `head_branch == TAG_REF`, which is good — but the head_branch field on
Forgejo isn't always `<num>/merge` versus literal tag name (memory
`feedback_github_ref_name_gotcha.md`).
**Why it matters:** Release promotion gate; bypass = unvalidated release.
**Repro / trigger:** Forgejo emitting `head_branch` differently than GitHub for the
same tag push event.
**Fix shape:** Add explicit assert `head_sha == RESOLVED_SHA` before treating the run
as proof; failing closed if Forgejo populates `head_branch` unexpectedly.
**Confidence:** medium

### [MEDIUM] release-candidate.yml:412 — `auth-flow-test` runs `if: always() && needs.fresh-install-test.result == 'success'` with `continue-on-error: true`
**Category:** ci-invariant
**What:** `container-health-test` and `auth-flow-test` are marked
`continue-on-error: true`. The `validation-summary` job at line 671 then validates
only `unit-tests` and `fresh-install-test` to gate release approval. Container health
and auth-flow failures become silent warnings on every RC.
**Why it matters:** Two of four advertised "release candidate validation" suites are
permanently non-blocking. This is the exact retrigger discipline issue from
CLAUDE.md — a permanent failure mode in the gate workflow that becomes background noise.
**Repro / trigger:** Any RC tag push where container-health or auth-flow regresses.
**Fix shape:** Either remove `continue-on-error` and stabilize the suites, or rename
them so the workflow's `Validation Summary` doesn't claim release-candidate validation.
**Confidence:** high

### [LOW] architecture.yml:40, 250 — `runs-on: ubuntu-20.04` is EOL
**Category:** resource
**What:** ubuntu-20.04 GitHub-hosted runner reached EOL April 2025; GitHub removed
the image. Will fail at scheduling on `github.server_url == 'https://github.com'` paths.
Forgejo runners may map this label to whatever they have. Architecture deploy is
GitHub-only and currently broken.
**Why it matters:** Dead workflow paths; CI signal noise.
**Repro / trigger:** Run on GitHub Actions.
**Fix shape:** Bump to `ubuntu-24.04` or `ubuntu-latest`.
**Confidence:** high

### [LOW] verify-vectors.yml:269-281 — Hard-coded RPC password in `docker run`
**Category:** security
**What:** `bitcoin-core` regtest container started with `-rpcuser=sanctuary
-rpcpassword=sanctuary-verify` and `-rpcallowip=0.0.0.0/0 -rpcbind=0.0.0.0`. Port
18443 is published to host. On a self-hosted runner this exposes a regtest Bitcoin
RPC to anything that can reach the runner's network during the job window.
**Why it matters:** Regtest, so no real funds, but the open RPC is a foothold and
the credentials are committed.
**Repro / trigger:** Manual `workflow_dispatch` with `regenerate_psbt=true`; reach
the runner's LAN for ~60 min.
**Fix shape:** Drop `-rpcallowip=0.0.0.0/0`; bind to loopback only; use docker network
isolation, not host-published ports.
**Confidence:** medium

### [LOW] release.yml:481-485 — `gh api dispatches` payload uses unquoted shell expansion
**Category:** logic
**What:** `gh api -X POST .../dispatches -f event_type=image-published -f
"client_payload[version]=$VERSION" ...` — `$VERSION` and digest values are pulled from
earlier outputs without shape validation in this scope (validation happens in
install-test.yml's path, not this one). `gh api -f` treats `=` literally so injection
into the JSON body is bounded, but unusual chars in version (e.g., trailing newline)
would break the dispatch silently.
**Why it matters:** Smell; correctness on edge inputs.
**Fix shape:** Echo `$VERSION` through the same regex sieve before posting.
**Confidence:** low

### [LOW] Multiple workflows — `inputs.*` references mixed with `github.event.inputs.*`
**Category:** correctness
**What:** `release.yml:284`, `release-candidate.yml:79, 98-101, 130, 164`,
`install-test.yml:280, 297` mix `${{ inputs.foo }}` (workflow_call context) with
`${{ github.event.inputs.foo }}` (workflow_dispatch context). On `push` events both
are empty strings and the `||` chains paper over it, but the patterns differ across
files and are easy to get wrong.
**Why it matters:** Latent bug surface when adding new input-driven branches.
**Fix shape:** Normalize on `${{ inputs.foo || github.event.inputs.foo || 'default' }}`
in one place per workflow.
**Confidence:** low

### [LOW] release-candidate.yml:250 — `docker system prune -f` in `Cleanup` step
**Category:** ci-invariant
**What:** Fresh-install job's cleanup runs `docker system prune -f` on the
self-hosted runner. This nukes any unreferenced dev images on the host outside any
project label. Combines with the protected-projects allowlist memory concern.
**Why it matters:** Pollutes host docker state used by the dev stack.
**Fix shape:** Replace with `cleanup-docker-resources.sh --project "$COMPOSE_PROJECT_NAME"`
matching install-test.yml's pattern.
**Confidence:** high

### [LOW] install-test.yml:215, install-test.yml:1142-1150 — `github.ref_name` baked into env / artifact names
**Category:** correctness
**What:** Several jobs use `${{ github.ref_name }}` for artifact names
(`image-digests-${{ github.ref_name }}` line 1398, 1462) and step env. On PR runs
`github.ref_name` is `<num>/merge` (memory `feedback_github_ref_name_gotcha.md`),
producing artifact names like `image-digests-123/merge` which contain `/` — Forgejo
upload-artifact may sanitize or fail. The jobs are gated to tag pushes via the `if:`
chain at 1335-1340, so today this is unreachable on PRs. Still a fragile pattern.
**Fix shape:** Use `${{ github.ref_type == 'tag' && github.ref_name || github.sha }}`
in artifact names or scope `github.ref_name` use to tag-only steps.
**Confidence:** medium
