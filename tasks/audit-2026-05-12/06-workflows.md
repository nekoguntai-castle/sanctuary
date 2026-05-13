# Phase C — workflows (merged)

**Source:** raw/06-workflows-claude.md + raw/06-workflows-codex.md
**Date:** 2026-05-12

## Summary

| Severity | Claude | Codex | Merged | Dual-flagged |
|---|---|---|---|---|
| Critical | 0 | 5 | 5 | 0 |
| High | 3 | 3 | 5 | 2 |
| Medium | 6 | 3 | 7 | 2 |
| Low | 6 | 0 | 5 | 1 |

**Accepted:** 22 · **Rejected:** 0 · **Deferred:** 0

## Findings (accepted)

### [CRITICAL] .github/workflows/test.yml:371, 663 — PR changed-file output interpolated into shell commands
**Category:** security
**Status:** Accept
**Cross-pass:** Codex only
**What:** The quick backend job appends `${{ needs.detect-changes.outputs.backend_files }}` directly to a shell command at line 371, and the quick gateway job repeats the pattern with `${{ needs.detect-changes.outputs.gateway_files }}` at line 663. Those outputs are derived from pull-request filenames (produced by `classify-test-changes.sh`) and are not shell-escaped before the runner parses the command.
**Why it matters:** A crafted filename can inject shell syntax into PR CI, allowing arbitrary command execution on the runner with access to whatever CI secrets/env are in scope for that step. Possible exfiltration of CI environment data.
**Repro / trigger:** Open a pull request that adds a backend or gateway file with shell metacharacters in its path (e.g., a semicolon-delimited command in a legal Git filename) and trigger the corresponding quick job.
**Fix shape:** Pass changed paths through an environment variable or artifact as newline-delimited data, read them into a Bash array, and invoke Vitest with `"${files[@]}"` instead of interpolating workflow outputs into `run`.
**Confidence:** high

### [CRITICAL] .github/workflows/test.yml:958 — Merge-group required check is an unconditional no-op
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** `PR Required Checks` runs on `merge_group`, but the merge-group step at lines 958-963 only echoes that `Full Test Summary` is authoritative and then reports success. It does not inspect the full-lane jobs before satisfying the required-check context — it emits a synthetic success without running tests.
**Why it matters:** If branch protection or merge-queue rules require `PR Required Checks` but omit the real full-lane gate, a merge candidate can receive a green required context without test enforcement — a possible branch-protection bypass.
**Repro / trigger:** Configure branch protection to require `PR Required Checks` for merge-group events, but not `Full Test Summary`; a merge_group run will satisfy that context through the no-op step.
**Fix shape:** Remove the merge-group no-op context, or make it depend on and validate the same full-lane results as `Full Test Summary`.
**Confidence:** high

### [CRITICAL] .github/workflows/test.yml:1595, 1655, 2131, 2389, 2782 — Full-scan changes skip coverage and E2E gates
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** Frontend coverage shards require only `frontend_changed` at lines 1595-1599 and 1655-1659, browser/render E2E require only their narrow booleans at lines 2131-2134 and 2389-2395, and the summary's `full_scan` block at lines 2782-2789 does not mark browser or render E2E required. A full-scan workflow/config change can therefore leave coverage or E2E jobs skipped while the summary accepts the skip.
**Why it matters:** The broadest change class can pass without the broadest validation, so workflow/test-infrastructure changes may weaken or break coverage and browser gates without being caught by the required full summary.
**Repro / trigger:** Open a PR that changes `.github/workflows/test.yml` or another full-scan trigger without touching frontend/browser/render paths; the full lane can skip frontend coverage and E2E lanes while `Full Test Summary` treats them as not required.
**Fix shape:** Include `full_scan` and test-suite-wide changes in coverage/E2E job predicates and in the summary's required booleans, or define a separate strict workflow-change gate that requires every full subsystem.
**Confidence:** high

### [CRITICAL] .github/workflows/install-test.yml:236, 397, 871, 1023, 1083 — PR install E2E lanes report success without running E2E
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** On pull requests, `fresh-install-test` only prints the note at lines 236-239 while the checkout and E2E steps are gated behind `github.event_name != 'pull_request'`; `install-script-test` then exits success for pull requests at lines 397-399. The upgrade jobs are also excluded from pull requests at lines 871, 1023, and 1083.
**Why it matters:** Installer, Compose, Docker, or upgrade-harness changes can receive a green Install Tests signal without the Docker-backed install or upgrade behavior being exercised.
**Repro / trigger:** Open a pull request changing `install.sh` or `docker-compose.yml`; unit tests can pass, the PR E2E jobs succeed by note/no-op, and `Install Test Summary` has no PR hard gate equivalent to the release gate.
**Fix shape:** Either run trusted PR install E2E lanes with `push`/secrets disabled, or make the PR summary fail/neutral when install-critical lanes are required but intentionally skipped.
**Confidence:** high

### [CRITICAL] .github/workflows/release-candidate.yml:130 — Manual ref checkout runs arbitrary code with workflow secrets
**Category:** security
**Status:** Accept
**Cross-pass:** Codex only
**What:** `workflow_dispatch` accepts a free-text branch, tag, or SHA as `ref`, and the jobs check out `${{ github.event.inputs.ref || inputs.ref || 'main' }}` at line 130 and again in later E2E jobs. The workflow also exposes `SANCTUARY_CI_LOG_SINK_TOKEN` at workflow scope on line 86, so scripts from the selected ref execute with that secret-bearing environment.
**Why it matters:** Anyone able to dispatch the workflow can point validation at attacker-controlled repository code and run it on the CI runner with available workflow secrets and runner network access — arbitrary code execution with release secrets.
**Repro / trigger:** Create or select a branch that changes an install test script to print or send environment variables, then manually dispatch Release Candidate Validation with that branch in the `ref` input.
**Fix shape:** Restrict manual validation to protected tags or already-resolved immutable SHAs from a trusted release workflow, and avoid workflow-level secrets in jobs that execute code from an operator-supplied ref.
**Confidence:** high

### [HIGH] .github/workflows/install-test.yml:215, 385, 414, 580, 721, 866, 1018, 1078 — E2E `concurrency.group` keyed on `github.ref` is theatrical
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Eight E2E jobs share `group: sanctuary-runner-e2e-${{ github.ref }}` with `cancel-in-progress: false`. The intent is to serialize E2E jobs against the runner's dind so they don't race. But `github.ref` differs across PR/tag/branch/schedule refs, so different refs do not share the lock — a tag push and a scheduled main push can hold the lock simultaneously. Per memory `feedback_forgejo_runner_concurrency.md`, Forgejo's act_runner already ignores matrix max-parallel and job-level concurrency; serialization here relies on the host's `runner.capacity=1`, not the group key.
**Why it matters:** Apparent serialization is a fiction on Forgejo. Two concurrent E2E jobs both call `docker compose up -d --build` and `cleanup-docker-resources.sh --project` against the same dind, with different `COMPOSE_PROJECT_NAME`s but a shared build cache and shared network namespace.
**Repro / trigger:** Tag push during a scheduled run; two PRs landing in merge_group; or a scheduled/manual install run during a stable tag install run.
**Fix shape:** Either drop the lie (delete the `concurrency:` block; document that serialization is enforced by `runner.capacity=1` on the self-hosted runner), or use a single global E2E concurrency key for all Docker-backed install lanes — or collapse the lanes into one sequential job per the memory's recommended pattern.
**Confidence:** high

### [HIGH] .github/workflows/release-candidate.yml:262, 413 — Release-candidate health/auth suites are non-blocking
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `container-health-test` and `auth-flow-test` are both marked `continue-on-error: true` at lines 262 and 413. The final `validation-summary` check at line 671 fails only when unit or fresh-install tests fail (lines 676-680), and converts health/auth failures into warnings at lines 682-690. Two of four advertised "release candidate validation" suites are permanently non-blocking.
**Why it matters:** A release candidate can be approved while container-health or login/auth flow validation is regressing — exactly the retrigger discipline issue from CLAUDE.md where a permanent failure mode in the gate becomes background noise.
**Repro / trigger:** Break `auth-flow.test.sh` or container health while leaving unit and fresh-install tests green; `Validation Summary` exits success with warnings.
**Fix shape:** Make health/auth blocking for RC approval and stabilize the suites, or split them into clearly optional diagnostic jobs that are not represented as release validation (and rename so the summary doesn't claim coverage it doesn't enforce).
**Confidence:** high

### [HIGH] .github/workflows/docker-build.yml:141 — PR image builds are skipped
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** The workflow triggers on pull requests that touch Docker/image inputs, but both image build jobs require `github.event_name != 'pull_request'` and the summary job also skips pull requests. A PR therefore gets only the classifier job, not a `docker build` with `push: false`.
**Why it matters:** Dockerfile or image-context regressions can merge without the workflow named for image builds ever building the changed image.
**Repro / trigger:** Open a pull request that changes `Dockerfile`, `server/Dockerfile`, `docker-compose.yml`, or `docker/**`; `detect-image-scope` runs, while `build-frontend`, `build-backend`, and `summary` are skipped.
**Fix shape:** Run the image build jobs on pull requests with registry login/push disabled, and make a required aggregate fail when an image-relevant PR skips the actual build.
**Confidence:** high

### [HIGH] .github/workflows/release.yml:283 — Workflow_call passes attacker-controllable `sha` as ref to release-candidate
**Category:** security
**Status:** Accept
**Cross-pass:** Claude only
**What:** `release.yml` triggers `release-candidate.yml` via `workflow_call` with `ref: ${{ needs.wait-for-install-tests.outputs.sha }}`. `sha` comes from the `resolve-sha` step which, on `workflow_dispatch`, accepts user-supplied `INPUT_VERSION` and looks the tag up via `gh api`. Although the version is regex-validated and SHA is later regex-validated as 40-hex, the called workflow checks out that ref and then builds and pushes Docker images to GHCR — meaning an operator who can dispatch can pin the release to any commit in the repo. (Note: this is a distinct attack surface from the release-candidate.yml:130 critical above — that one accepts arbitrary ref text via workflow_dispatch directly; this one resolves a tag-validated SHA but with a TOCTOU window.)
**Why it matters:** Insider supply-chain exposure: a tag could be created at a benign commit, then `workflow_dispatch` with `version` pointing at a different already-pushed tag whose underlying commit was force-updated would let a malicious actor publish images from the wrong tree.
**Repro / trigger:** Manual `workflow_dispatch` with a `version` whose annotated-tag target was rewritten between RC validation and release.
**Fix shape:** Require the resolved SHA to match the tag object stored at validation time, not at release time; or block `workflow_dispatch` for the release path entirely and rely only on `push` events.
**Confidence:** medium

### [HIGH] .github/workflows/install-test.yml:1119 — `cleanup-docker-resources.sh --runner-leftovers` allowlist drift risk
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Memory `feedback_ci_clobbers_prod_volumes` records that this host's `install-test.yml` cleanup previously wiped dev's `sanctuary_postgres_data` / `sanctuary_redis_data`. The current `scripts/ci/cleanup-docker-resources.sh` now has `protected_projects=(sanctuary beacon building-monkeys tax-planner swarm-intelligence)` and the runner-leftovers path only touches `FORGEJO-ACTIONS-TASK-*` containers and `WORKFLOW-*` empty networks — so the literal regression is fixed. However, the `docker-resource-cleanup` job still runs on every non-PR run (push to main / scheduled / tag) and the `sanctuary` literal in the script is the only thing between CI and dev volumes; the cleanup behavior is delegated to the checked-out repository script rather than being constrained in workflow YAML to the run's own project name. Allowlist drift = silent prod-data loss on the self-hosted runner.
**Why it matters:** Single-source guard with no test asserting it. If anyone renames the dev `COMPOSE_PROJECT_NAME` or adds another stack the allowlist doesn't know about, it gets clobbered. A cleanup bug or allowlist drift can affect shared self-hosted runner Docker state after otherwise unrelated scheduled, tag, or manual install runs.
**Repro / trigger:** Rename dev compose project, run any scheduled `install-test.yml`; or run Install Tests on a non-PR event after changing cleanup helper logic, or on a runner that also hosts non-CI Docker projects.
**Fix shape:** Add a regression test (Bats / shellcheck-style) that asserts the allowlist contains every protected project name listed in `docker-compose.yml` `COMPOSE_PROJECT_NAME` on this host; or restrict the cleanup job to a dedicated runner label that production volumes don't share; or keep cleanup scoped to run-specific `COMPOSE_PROJECT_NAME` values and move broad sweeps to runner maintenance outside repository code.
**Confidence:** medium

### [MEDIUM] .github/workflows/install-test.yml:280, 297 — `KEEP_CONTAINERS` env from `inputs.keep_containers` interpolated into `bash -c`
**Category:** security
**Status:** Accept
**Cross-pass:** Claude only
**What:** `KEEP_CONTAINERS: ${{ github.event.inputs.keep_containers }}` is passed via env, then expanded inside a heredoc-less `bash -c "..."` shell using `${KEEP_CONTAINERS:-false}`. GitHub's `inputs.keep_containers` is `type: boolean` so the value is constrained to `true`/`false` — safe today. But the surrounding `bash -c "..."` is built with double quotes and uses `\"$SANCTUARY_INSTALL_WORKSPACE\"` substitution, so the pattern is fragile against future input-type changes.
**Why it matters:** Smell, not active vuln — but the same pattern repeats in 6+ places across install-test.yml and is the exact shape that the apostrophe-in-comment bug (mentioned in architecture.yml:65-68 comments) burned.
**Repro / trigger:** Change input type from boolean to string; injection becomes live.
**Fix shape:** Replace `bash -c "..."` with quoted-delimiter heredocs (`bash <<'INNER'`) matching architecture.yml's lesson-learned pattern.
**Confidence:** medium

### [MEDIUM] .github/workflows/install-test.yml:1500-1514 — Forgejo workflow_dispatch payload uses unverified artifact digests
**Category:** security
**Status:** Accept
**Cross-pass:** Claude only
**What:** The Umbrel dispatch body is built via `jq -n --arg ver "$VERSION" --arg fe "$FRONTEND_DIGEST" --arg be "$BACKEND_DIGEST" ...`. `VERSION` comes from `${TAG#v}` where `TAG=${{ github.ref_name }}` and is regex-validated upstream as `v[0-9]+\.[0-9]+\.[0-9]+(-...)?`. Digests are regex-validated as `sha256:<64hex>`. Today this is safe. But the digests come from a downloaded artifact and are only validated against shape, not provenance: if `publish-images` succeeds and someone modifies the artifact between jobs (Forgejo doesn't sign artifacts), the dispatched digest could be replaced.
**Why it matters:** Cross-repo digest pinning relies on artifact integrity. The sanctuary-umbrel receiver trusts whatever digest it gets and updates compose files.
**Repro / trigger:** Compromised dind on the self-hosted runner during the gap between `publish-images` and `notify-umbrel`.
**Fix shape:** Recompute digests with `docker buildx imagetools inspect` against the registry inside the notify job, instead of reading them from an artifact.
**Confidence:** low

### [MEDIUM] .github/workflows/release.yml — `verify-prerelease` relies on Forgejo `head_branch` semantics
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Claude only
**What:** `verify-prerelease` ensures the published release IS a pre-release (and auto-converts it if not). Combined with `wait-for-install-tests` + `release-candidate`, this is the gate to converting pre-release → full release at line 588. If `wait-for-install-tests` polls a non-deterministic Install Tests run and somehow accepts a `success` from a different SHA (the pre-2026-05 bug mentioned at lines 222-225), the auto-conversion at line 589 runs unconditionally. The fix added at 234-243 pins to the run with `head_branch == TAG_REF`, which is good — but the `head_branch` field on Forgejo isn't always `<num>/merge` versus literal tag name (memory `feedback_github_ref_name_gotcha.md`).
**Why it matters:** Release promotion gate; bypass = unvalidated release.
**Repro / trigger:** Forgejo emitting `head_branch` differently than GitHub for the same tag push event.
**Fix shape:** Add explicit assert `head_sha == RESOLVED_SHA` before treating the run as proof; fail closed if Forgejo populates `head_branch` unexpectedly.
**Confidence:** medium

### [MEDIUM] .github/workflows/release-offline-bundle.yml:131-181 — Release lookup and asset cleanup ignore API status
**Category:** correctness
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** The bundle upload step reads the release with `curl -sS` at line 133, parses `.id`, and creates a release when the parsed id is empty. Asset deletion later uses `curl ... || true` at lines 161-163, so API/auth failures can be silently treated as absent releases or successful cleanup. If GitHub/Forgejo returns an HTML error page or a rate-limit JSON, `REL_ID` becomes empty and the next `if [ -z ]` branch creates a new release — potentially clobbering a legitimate existing release object on retry.
**Why it matters:** A transient or non-JSON API response can drive duplicate release creation or leave stale assets while the workflow continues down the upload path.
**Repro / trigger:** Run the bundle workflow when the release lookup endpoint returns a 5xx, rate-limit body, HTML error, or auth failure.
**Fix shape:** Use `curl -fsS -w "%{http_code}"` with explicit status-code handling, require a numeric release id before branching, and fail closed on asset-list/delete failures.
**Confidence:** medium

### [MEDIUM] .github/workflows/verify-vectors.yml:269-281, 290 — Regtest Bitcoin RPC is published with static credentials
**Category:** security
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** The manual PSBT regeneration job starts `bitcoin/bitcoin:27.0` with `-p 18443:18443`, static `sanctuary:sanctuary-verify` RPC credentials, `-rpcallowip=0.0.0.0/0`, and `-rpcbind=0.0.0.0` at lines 269-277. The follow-up curl uses the same committed credentials at line 290. On a self-hosted runner this exposes a regtest Bitcoin RPC to anything that can reach the runner's network during the job window.
**Why it matters:** Regtest, so no real funds, but the open RPC is a foothold and the credentials are committed. During the manual job window, any actor that can reach the runner's published Docker port can talk to the regtest RPC service using credentials stored in the workflow.
**Repro / trigger:** Manually dispatch Verify Bitcoin Vectors with `regenerate_psbt=true`; reach the runner's LAN for ~60 min.
**Fix shape:** Drop `-rpcallowip=0.0.0.0/0`; avoid publishing the RPC port to the host; bind RPC to loopback or an isolated Docker network; generate run-scoped credentials.
**Confidence:** high

### [LOW] .github/workflows/architecture.yml:40, 250 — `runs-on: ubuntu-20.04` is EOL
**Category:** resource
**Status:** Accept
**Cross-pass:** Claude only
**What:** ubuntu-20.04 GitHub-hosted runner reached EOL April 2025; GitHub removed the image. Will fail at scheduling on `github.server_url == 'https://github.com'` paths. Forgejo runners may map this label to whatever they have. Architecture deploy is GitHub-only and currently broken (separate from memory `feedback_github_mirror_decommissioned` since this is the EOL image, not the mirror being decommissioned).
**Why it matters:** Dead workflow paths; CI signal noise.
**Repro / trigger:** Run on GitHub Actions.
**Fix shape:** Bump to `ubuntu-24.04` or `ubuntu-latest`.
**Confidence:** high

### [LOW] .github/workflows/release.yml:481-485 — `gh api dispatches` payload uses unvalidated shell expansion
**Category:** logic
**Status:** Accept
**Cross-pass:** Claude only
**What:** `gh api -X POST .../dispatches -f event_type=image-published -f "client_payload[version]=$VERSION" ...` — `$VERSION` and digest values are pulled from earlier outputs without shape validation in this scope (validation happens in install-test.yml's path, not this one). `gh api -f` treats `=` literally so injection into the JSON body is bounded, but unusual chars in version (e.g., trailing newline) would break the dispatch silently.
**Why it matters:** Smell; correctness on edge inputs.
**Repro / trigger:** Stray whitespace in upstream-resolved `$VERSION`.
**Fix shape:** Echo `$VERSION` through the same regex sieve before posting.
**Confidence:** low

### [LOW] Multiple workflows — `inputs.*` references mixed with `github.event.inputs.*`
**Category:** correctness
**Status:** Accept
**Cross-pass:** Claude only
**What:** `release.yml:284`, `release-candidate.yml:79, 98-101, 130, 164`, `install-test.yml:280, 297` mix `${{ inputs.foo }}` (workflow_call context) with `${{ github.event.inputs.foo }}` (workflow_dispatch context). On `push` events both are empty strings and the `||` chains paper over it, but the patterns differ across files and are easy to get wrong.
**Why it matters:** Latent bug surface when adding new input-driven branches.
**Repro / trigger:** Add a new input-driven branch and pick the wrong namespace.
**Fix shape:** Normalize on `${{ inputs.foo || github.event.inputs.foo || 'default' }}` in one place per workflow.
**Confidence:** low

### [LOW] .github/workflows/release-candidate.yml:250 — `docker system prune -f` in `Cleanup` step
**Category:** ci-invariant
**Status:** Accept
**Cross-pass:** Claude only
**What:** Fresh-install job's cleanup runs `docker system prune -f` on the self-hosted runner. This nukes any unreferenced dev images on the host outside any project label. Combines with the protected-projects allowlist memory concern.
**Why it matters:** Pollutes host docker state used by the dev stack.
**Repro / trigger:** Any RC tag push.
**Fix shape:** Replace with `cleanup-docker-resources.sh --project "$COMPOSE_PROJECT_NAME"` matching install-test.yml's pattern.
**Confidence:** high

### [LOW] .github/workflows/install-test.yml:215, 1142-1150, 1398, 1462 — `github.ref_name` baked into env / artifact names
**Category:** correctness
**Status:** Accept
**Cross-pass:** Claude only
**What:** Several jobs use `${{ github.ref_name }}` for artifact names (`image-digests-${{ github.ref_name }}` line 1398, 1462) and step env. On PR runs `github.ref_name` is `<num>/merge` (memory `feedback_github_ref_name_gotcha.md`), producing artifact names like `image-digests-123/merge` which contain `/` — Forgejo upload-artifact may sanitize or fail. The jobs are gated to tag pushes via the `if:` chain at 1335-1340, so today this is unreachable on PRs. Still a fragile pattern.
**Repro / trigger:** Remove the tag-only gate; PR run fails on artifact name.
**Fix shape:** Use `${{ github.ref_type == 'tag' && github.ref_name || github.sha }}` in artifact names or scope `github.ref_name` use to tag-only steps.
**Confidence:** medium

## Considered & rejected

_None — no findings disproved by current YAML; the GitHub-mirror-decommissioned jobs were correctly excluded from both raw passes._

## Deferred

_None — memory entries `feedback_ci_clobbers_prod_volumes` and `feedback_forgejo_runner_concurrency` document the limitations but no fix is tracked; both findings remain ACCEPTED per instructions._
