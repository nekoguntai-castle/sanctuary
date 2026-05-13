## .github/workflows/docker-build.yml

### [HIGH] .github/workflows/docker-build.yml:141 — PR image builds are skipped
**Category:** ci-invariant
**What:** The workflow triggers on pull requests that touch Docker/image inputs, but both image build jobs require `github.event_name != 'pull_request'` and the summary job also skips pull requests. A PR therefore gets only the classifier job, not a `docker build` with `push: false`.
**Why it matters:** Dockerfile or image-context regressions can merge without the workflow named for image builds ever building the changed image.
**Repro / trigger:** Open a pull request that changes `Dockerfile`, `server/Dockerfile`, `docker-compose.yml`, or `docker/**`; `detect-image-scope` runs, while `build-frontend`, `build-backend`, and `summary` are skipped.
**Fix shape:** Run the image build jobs on pull requests with registry login/push disabled, and make a required aggregate fail when an image-relevant PR skips the actual build.
**Confidence:** high

## .github/workflows/install-test.yml

### [CRITICAL] .github/workflows/install-test.yml:236 — PR install E2E lanes report success without running E2E
**Category:** ci-invariant
**What:** On pull requests, `fresh-install-test` only prints the note at lines 236-239 while the checkout and E2E steps are gated behind `github.event_name != 'pull_request'`; `install-script-test` then exits success for pull requests at lines 397-399. The upgrade jobs are also excluded from pull requests at lines 871, 1023, and 1083.
**Why it matters:** Installer, Compose, Docker, or upgrade-harness changes can receive a green Install Tests signal without the Docker-backed install or upgrade behavior being exercised.
**Repro / trigger:** Open a pull request changing `install.sh` or `docker-compose.yml`; unit tests can pass, the PR E2E jobs succeed by note/no-op, and `Install Test Summary` has no PR hard gate equivalent to the release gate.
**Fix shape:** Either run trusted PR install E2E lanes with `push`/secrets disabled, or make the PR summary fail/neutral when install-critical lanes are required but intentionally skipped.
**Confidence:** high

### [HIGH] .github/workflows/install-test.yml:215 — E2E concurrency lock is scoped by ref
**Category:** resource
**What:** Docker-backed install jobs use `group: sanctuary-runner-e2e-${{ github.ref }}` at line 215 and repeat the same ref-scoped group at lines 385, 414, 580, 721, 866, 1018, and 1078. Different branch, tag, schedule, or manual refs therefore do not share the intended runner-wide E2E lock.
**Why it matters:** Concurrent install/upgrade jobs can race on the same self-hosted Docker daemon, build cache, networks, and cleanup paths while appearing serialized in YAML.
**Repro / trigger:** Start a scheduled/manual install run while a stable tag install run is active; the refs differ, so the workflow-level concurrency groups do not block each other.
**Fix shape:** Use a single global E2E concurrency key for all Docker-backed install lanes, or collapse the lanes into one sequential job and rely on a dedicated runner capacity contract.
**Confidence:** high

### [MEDIUM] .github/workflows/install-test.yml:1119 — Runner-leftover cleanup is a broad post-run action
**Category:** resource
**What:** Every non-PR install run reaches `docker-resource-cleanup` and executes `bash scripts/ci/cleanup-docker-resources.sh --runner-leftovers`. The cleanup behavior is delegated to the checked-out repository script rather than being constrained in workflow YAML to the run's own project name.
**Why it matters:** A cleanup bug or allowlist drift can affect shared self-hosted runner Docker state after otherwise unrelated scheduled, tag, or manual install runs.
**Repro / trigger:** Run Install Tests on a non-PR event after changing cleanup helper logic, or on a runner that also hosts non-CI Docker projects.
**Fix shape:** Keep cleanup scoped to run-specific `COMPOSE_PROJECT_NAME` values, move broad sweeps to runner maintenance outside repository code, or execute broad cleanup only on a dedicated disposable runner.
**Confidence:** medium

## .github/workflows/release-candidate.yml

### [CRITICAL] .github/workflows/release-candidate.yml:130 — Manual ref checkout runs arbitrary code with workflow secrets
**Category:** security
**What:** `workflow_dispatch` accepts a branch, tag, or SHA as `ref`, and the jobs check out `${{ github.event.inputs.ref || inputs.ref || 'main' }}` at line 130 and again in later E2E jobs. The workflow also exposes `SANCTUARY_CI_LOG_SINK_TOKEN` at workflow scope on line 86, so scripts from the selected ref execute with that secret-bearing environment.
**Why it matters:** Anyone able to dispatch the workflow can point validation at attacker-controlled repository code and run it on the CI runner with available workflow secrets and runner network access.
**Repro / trigger:** Create or select a branch that changes an install test script to print or send environment variables, then manually dispatch Release Candidate Validation with that branch in the `ref` input.
**Fix shape:** Restrict manual validation to protected tags or already-resolved immutable SHAs from a trusted release workflow, and avoid workflow-level secrets in jobs that execute code from an operator-supplied ref.
**Confidence:** high

### [HIGH] .github/workflows/release-candidate.yml:262 — Release candidate health/auth suites are non-blocking
**Category:** ci-invariant
**What:** `container-health-test` and `auth-flow-test` are both marked `continue-on-error: true` at lines 262 and 413. The final validation check fails only when unit or fresh-install tests fail at lines 676-680, and converts health/auth failures into warnings at lines 682-690.
**Why it matters:** A release candidate can be approved even when container health or login/auth flow validation is failing.
**Repro / trigger:** Break `auth-flow.test.sh` or container health while leaving unit and fresh-install tests green; `Validation Summary` exits success with warnings.
**Fix shape:** Make health/auth blocking for release-candidate approval, or split them into clearly optional diagnostic jobs that are not represented as release validation.
**Confidence:** high

## .github/workflows/release-offline-bundle.yml

### [MEDIUM] .github/workflows/release-offline-bundle.yml:133 — Release lookup and asset cleanup ignore API status
**Category:** correctness
**What:** The bundle upload step reads the release with `curl -sS` at line 133, parses `.id`, and creates a release when the parsed id is empty. Asset deletion later uses `curl ... || true` at lines 161-163, so API/auth failures can be silently treated as absent releases or successful cleanup.
**Why it matters:** A transient or non-JSON API response can drive duplicate release creation or leave stale assets while the workflow continues down the upload path.
**Repro / trigger:** Run the bundle workflow when the release lookup endpoint returns a 5xx, rate-limit body, HTML error, or auth failure.
**Fix shape:** Use `curl -fsS` with explicit status-code handling, require a numeric release id before branching, and fail closed on asset-list/delete failures.
**Confidence:** medium

## .github/workflows/test.yml

### [CRITICAL] .github/workflows/test.yml:371 — PR changed-file output is interpolated into shell commands
**Category:** security
**What:** The quick backend job appends `${{ needs.detect-changes.outputs.backend_files }}` directly to a shell command at line 371, and the quick gateway job repeats the pattern with `${{ needs.detect-changes.outputs.gateway_files }}` at line 663. Those outputs are derived from pull-request filenames and are not shell-escaped before the runner parses the command.
**Why it matters:** A crafted filename can inject shell syntax into PR CI, allowing arbitrary command execution on the runner and potential exfiltration of CI environment data.
**Repro / trigger:** Open a pull request that adds a backend or gateway file with shell metacharacters in its path, such as a semicolon-delimited command in a legal Git filename, and trigger the corresponding quick job.
**Fix shape:** Pass changed paths through an environment variable or artifact as newline-delimited data, read them into a Bash array, and invoke Vitest with `"${files[@]}"` instead of interpolating workflow outputs into `run`.
**Confidence:** high

### [CRITICAL] .github/workflows/test.yml:958 — Merge-group required check is an unconditional no-op
**Category:** ci-invariant
**What:** `PR Required Checks` runs on `merge_group`, but the merge-group step at lines 958-963 only echoes that `Full Test Summary` is authoritative and then reports success. It does not inspect the full-lane jobs before satisfying the required-check context.
**Why it matters:** If branch protection or merge-queue rules require `PR Required Checks` but omit the real full-lane gate, a merge candidate can receive a green required context without test enforcement.
**Repro / trigger:** Configure branch protection to require `PR Required Checks` for merge-group events, but not `Full Test Summary`; a merge_group run will satisfy that context through the no-op step.
**Fix shape:** Remove the merge-group no-op context, or make it depend on and validate the same full-lane results as `Full Test Summary`.
**Confidence:** high

### [CRITICAL] .github/workflows/test.yml:1595 — Full-scan changes skip coverage and E2E gates
**Category:** ci-invariant
**What:** Frontend coverage shards require only `frontend_changed` at lines 1595-1599 and 1655-1659, browser/render E2E require only their narrow booleans at lines 2131-2134 and 2389-2395, and the summary's `full_scan` block at lines 2782-2789 does not mark browser or render E2E required. A full-scan workflow/config change can therefore leave coverage or E2E jobs skipped while the summary accepts the skip.
**Why it matters:** The broadest change class can pass without the broadest validation, so workflow/test-infrastructure changes may weaken or break coverage and browser gates without being caught by the required full summary.
**Repro / trigger:** Open a PR that changes `.github/workflows/test.yml` or another full-scan trigger without touching frontend/browser/render paths; the full lane can skip frontend coverage and E2E lanes while `Full Test Summary` treats them as not required.
**Fix shape:** Include `full_scan` and test-suite-wide changes in coverage/E2E job predicates and in the summary's required booleans, or define a separate strict workflow-change gate that requires every full subsystem.
**Confidence:** high

## .github/workflows/verify-vectors.yml

### [MEDIUM] .github/workflows/verify-vectors.yml:269 — Regtest Bitcoin RPC is published with static credentials
**Category:** security
**What:** The manual PSBT regeneration job starts `bitcoin/bitcoin:27.0` with `-p 18443:18443`, static `sanctuary:sanctuary-verify` RPC credentials, `-rpcallowip=0.0.0.0/0`, and `-rpcbind=0.0.0.0` at lines 269-277. The follow-up curl uses the same committed credentials at line 290.
**Why it matters:** During the manual job window, any actor that can reach the runner's published Docker port can talk to the regtest RPC service using credentials stored in the workflow.
**Repro / trigger:** Manually dispatch Verify Bitcoin Vectors with `regenerate_psbt=true` and connect to the runner host's published port 18443 while the job is active.
**Fix shape:** Avoid publishing the RPC port to the host, bind RPC to an isolated Docker network or loopback-only endpoint, and generate run-scoped credentials.
**Confidence:** high

## Summary
- Critical: 5
- High: 3
- Medium: 3
- Low: 0
- Files reviewed: architecture.yml, create-release.yml, docker-build.yml, install-test.yml, quality.yml, release-candidate.yml, release-offline-bundle.yml, release.yml, test.yml, verify-vectors.yml
- Top 3 by impact: test.yml PR changed-file output shell injection in backend/gateway quick jobs; release-candidate.yml manual ref checkout running arbitrary code with secret-bearing env; test.yml merge-group no-op that can fake a required green status if the real full-lane gate is not required.
