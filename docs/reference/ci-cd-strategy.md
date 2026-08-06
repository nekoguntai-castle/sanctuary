# Sanctuary CI strategy

Date: 2026-07-30 (Pacific/Honolulu)
Status: Active Forgejo-authoritative, test-only CI baseline

This document explains which checks should run at each point in development. The goal is not to run fewer tests; it is to run each test at the cheapest point where it gives useful signal.

## Development Model

Normal development happens on short-lived branches in the local Forgejo
repository and enters `main` through Forgejo pull requests. Direct human pushes
to `main` are reserved for documented emergencies only. GitHub is a passive
public mirror: GitHub Actions is disabled and GitHub pull requests are not an
authoritative development path.

`main` is protected with:

- Pull requests required before merge.
- Required status checks enabled.
- Linear history required.
- Force pushes and branch deletion disabled.
- Stable aggregate status checks produced by Forgejo Actions.

Because this repository currently has a single human collaborator, the branch protection baseline requires a PR but does not require an external approving review. If additional maintainers are added, raise `required_approving_review_count` to `1` and enable stale-review dismissal.

## Pull request merge status

Forgejo pull requests are the active merge model for protected `main`. A PR may
merge only after the exact required contexts `PR Required Checks`,
`Full Test Summary`, and `Code Quality Required Checks` succeed. The repository
may retain compatibility handling for `merge_group` event payloads, but GitHub
merge queue is not an operational or authoritative path.

## Required Checks

Use stable aggregate jobs as branch-protection targets. Do not require path-conditional leaf jobs directly, because docs-only or unrelated PRs can leave those checks absent.

Required for PRs:

- `PR Required Checks`
- `Full Test Summary`, expected to appear as skipped/success on pull requests
- `Code Quality Required Checks`

Required for `main` confidence:

- `Full Test Summary`
- `Code Quality Required Checks`

`PR Required Checks` and `Full Test Summary` live in the same `Test Suite`
workflow. On Forgejo pull requests, the quick-lane aggregate is meaningful and
the full-lane aggregate is skipped. Pushes to `main` run the path-aware full
confidence lane.

Do not globally require `Validate Docker Images`, `Install Test Summary`, or
`Verify Bitcoin Vectors`. Those workflows are intentionally path-gated or
release-gated. They should run when their trigger paths match, including changes
to their own workflow files, but requiring them globally would block unrelated
PRs where the workflow never starts.

## PR validation checklist

- Confirm `PR Required Checks` runs on the pull request and fails only when a quick-lane child fails.
- Confirm `Code Quality Required Checks` runs on the pull request and reflects lint, gitleaks, lizard, and jscpd.
- Confirm `Full Test Summary` is present on the pull request as skipped/success, so branch protection does not wait on the full lane.
- Confirm docs-only or workflow-only PRs do not wait on absent Docker, install, or vector checks.
- Confirm the post-merge `main` full lane runs only for the touched package unless the test workflow, schedule, or manual dispatch requires an exhaustive run.
- After merge, confirm the push-to-`main` full lane runs as the merge confidence backstop.

## First PR Validation Result

Validated on 2026-04-19 HST with PR #8, `ci-pr-flow-aggregates`, merged as `72bdce96`.

- `PR Required Checks` passed on the PR.
- `Code Quality Required Checks` passed on the PR.
- `Full Test Summary` appeared on the PR and completed as skipped, satisfying branch protection without running the full lane before merge.
- Path-gated workflow checks behaved correctly: Docker build, install tests, and vector verification ran because this PR changed their workflow files; they were not global requirements for unrelated PRs.
- The post-merge `main` backstop passed: `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install summary, release check, and dev image build completed successfully.

Historical GitHub-era merge-queue validation is retained in repository history;
it is not part of the current Forgejo operating model.

## Actions permissions and mutation boundary

Repository workflow permissions are intentionally read-only:

- Forgejo Actions is the only CI authority and performs validation only.
- GitHub Actions is disabled at repository level.
- Workflows must not request write permissions, use distribution credentials,
  log in to registries, push images, create releases, deploy Pages, or dispatch
  downstream workflows.
- Diagnostic log-sink credentials and Forgejo artifact/cache uploads are allowed
  because they retain test evidence rather than publishing product artifacts.
- `scripts/ci/check-workflows-test-only.sh` enforces this boundary.
- After green Forgejo stable-tag gates, a trusted operator runs
  `npm run release:publish -- <tag>` to verify mirror/tag parity and create
  matching Forgejo/GitHub Release objects.

## Lizard Remediation PR Loop

The lizard cleanup loop now uses the same PR-first workflow as other development:

1. Start each batch from updated `main` on a short-lived branch.
2. Refactor the next highest-value complexity target with focused tests and local lizard verification.
3. Update `docs/plans/codebase-health-assessment.md`, grade history, and `tasks/todo.md` with the new warning count and verification evidence.
4. Open a PR and wait for `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
5. Merge only after required checks pass, then wait for the post-merge full lane on `main`.
6. Rebase or recreate the next batch branch from the updated `main`.

Validated loop sample: PR #42, `chore/lizard-batch-43-final-warnings`, passed `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick Backend, Quick Backend Integration Smoke, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, vector verification, and Docker builds before merge. `Full Test Summary` appeared as skipped/success on the PR. After merge, the push-to-`main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds; the lizard loop ended at 0 warnings.

Operational note: scheduled `Test Suite` runs share the same `main` concurrency group as push backstops. During PR #18 validation, a scheduled run began immediately before the merge and blocked the push backstop until it was canceled. If a scheduled run is already being canceled in favor of a higher-priority push run but a long-running job delays handoff, cancel the scheduled run and keep the merge backstop as the source of truth.

## CI Tiers

### Tier 0 - Local Loop

Run focused commands before pushing:

- Frontend/UI: `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:all`, and focused `npm run test:run -- ...`.
- Backend: `cd server && npm run typecheck:tests` and focused `npx vitest run ...`.
- Gateway: `cd gateway && npm run test:run` or focused gateway tests.
- Docker/install: relevant `tests/install/*` scripts when practical.

Before opening or updating a PR, run the full local gate for the touched package
so Forgejo Actions is a protection layer, not the first place basic package
coverage/build failures are discovered:

- Gateway changes: `cd gateway && npm run test:coverage && npm run build`.
- LLM egress proxy changes: `npm --prefix llm-egress-proxy run build` plus `npm run test:run -- tests/llm-egress-proxy`.
- Server security, Bitcoin, auth, access-control, or shared-service changes: focused tests, `npm run typecheck:server:tests`, and the broader changed-server test gate when paths are critical.
- Frontend changes: strict app/test typechecks plus the relevant coverage command for the changed surface.

Push once per batch after the relevant local gate is green, then let the Forgejo
PR checks run once. If CI finds a reproducible local gap, add that command to
this Tier 0 checklist before retrying.

### Tier 1 - PR Quick Gate

The PR quick gate is optimized for repeated branch updates.

`Test Suite` runs changed-file detection and then conditionally runs:

- Test hygiene for changed tests.
- Frontend typecheck plus related Vitest tests.
- Backend test typecheck in a DB-free job plus DB-backed related non-integration Vitest tests.
- Backend integration smoke for backend changes that touch integration-sensitive surfaces, such as API routes, middleware, repositories, Prisma migrations, worker/queue infrastructure, package/config files, or integration tests. Clearly unit-scoped backend helper changes still run backend typecheck and related non-integration tests, but skip the DB-backed smoke lane.
- Gateway related tests.
- LLM egress proxy build plus the dedicated `tests/llm-egress-proxy` suite for `llm-egress-proxy/` source/config changes and `tests/llm-egress-proxy/` changes. These paths do not run frontend tests unless a separate frontend path changed.
- Chromium browser smoke only for browser-flow-relevant paths such as app routing, auth/API clients, selected shell routes, server API/routing/auth middleware, and non-render E2E specs.
- Chromium render regression only for visual/rendering paths such as app shell, components, hooks, providers, themes, utilities, and render-regression fixtures/snapshots.
- Critical mutation gate for critical Bitcoin/auth/access-control paths.

`PR Required Checks` fails if any required quick-lane child fails, and allows skipped path-conditional children.

`Code Quality` runs lint, gitleaks, lizard, and jscpd on every PR. `Code Quality Required Checks` fails if any of those children fail.

The CI lizard job currently gates a measured CI-scope baseline of 9 warnings. That prevents new complexity regressions while the broader remediation loop continues ratcheting down the full lizard backlog. Lower `LIZARD_WARNING_BASELINE` whenever the CI-scope warning count is reduced.

### Tier 2 - Main Confidence Gate

The post-merge `main` gate proves the final merged commit, not every local-sized commit.

`Test Suite` full lane runs on `main`, schedule, and manual dispatch. On push
events, it first classifies changed paths and runs only the relevant full lanes.
Schedule and manual dispatch set `full_scan=true` and remain exhaustive.

Markdown and MDX files are docs-only for the test classifiers, including package-local docs under `server/`, `gateway/`, `llm-egress-proxy/`, and `tests/install/`. A docs-only change may still get required aggregate/no-op checks on PRs, but it must not start source tests, DB-backed tests, E2E lanes, install tests, or image builds.

- Full backend typecheck for backend changes, test-workflow changes, or exhaustive runs. This job does not start Postgres or run migrations.
- Full backend unit coverage for backend changes, test-workflow changes, or exhaustive runs. This remains DB-backed and keeps publishing the stable `backend-coverage` artifact.
- Full backend integration tests for integration-sensitive backend changes, test-workflow changes, or exhaustive runs. Integration-sensitive paths include API routes, middleware, repositories, Prisma migrations, worker/queue infrastructure, package/config files, and integration tests. Clearly unit-scoped backend helpers skip the DB-backed integration groups on merge/main but still run backend typecheck and unit coverage.
- `Full Backend Tests` remains the aggregate backend result consumed by `Full Test Summary`, so branch protection does not depend on path-conditional source or integration leaf jobs.
- Full frontend app typecheck, test typecheck, and threshold-enforced coverage for frontend changes, test-workflow changes, or exhaustive runs. Typechecks run in a small matrix, while frontend coverage runs as two Vitest shard jobs that upload blob reports. A merge job then combines those blobs, generates the normal `coverage/` output, and enforces the existing coverage thresholds once. The `full-frontend-tests` job remains the aggregate result consumed by `Full Test Summary`.
- Full gateway coverage for gateway changes, test-workflow changes, or exhaustive runs.
- Full LLM egress proxy build plus `tests/llm-egress-proxy` for LLM egress proxy changes, test-workflow changes, or exhaustive runs.
- Critical mutation gate for critical mutation paths or exhaustive runs.
- Full browser-flow Playwright E2E for browser/API/route/non-render E2E paths, test-workflow changes, or exhaustive runs. This lane starts from path classification instead of waiting behind full coverage lanes, but keeps its deterministic spec groups serialized inside one E2E lock until an isolated-runner rehearsal proves browser fan-out is stable.
- Full render-regression Playwright E2E for visual/rendering paths and render fixtures/snapshots, test-workflow changes, or exhaustive runs. This lane is frontend-only and does not start backend services.
- E2E-only changes run the relevant browser/render E2E lanes without also running backend integration, backend unit coverage, or frontend unit coverage. Backend/frontend source changes still trigger their source lanes independently, and test-workflow changes still run the broad full lane.
- Full frontend/backend build check for package, build config, Docker/image entrypoint, Prisma, test-workflow, or exhaustive runs. It also starts from path classification instead of waiting behind coverage. Typecheck and coverage remain the primary source-level compile gate for ordinary frontend/backend source changes.
- `Full Test Summary` aggregate, which fails if any required full-lane child fails.

Push-to-main full-lane runs are the path-aware backstop for the final merged
commit; scheduled and manual runs provide periodic exhaustive proof.

### Tier 3 - Scheduled Deep Validation

Scheduled or manual validation is for expensive and environment-sensitive checks:

- Full multi-browser Playwright matrix if it is added beyond the current Chromium CI lane.
- Broad mutation testing.
- Bitcoin vector verification/regeneration.
- Docker install/upgrade suites outside release flow.
- Ops smoke proofs.
- Performance and scale benchmarks.

Promote a scheduled check into the PR quick gate only when escaped defects show that waiting until nightly is too late.

### Tier 4 - Release Gate

Release validation intentionally duplicates install and image-build evidence,
but never publishes:

- `Install Tests` validates fresh install, install script flow, container health, auth flow, and upgrade on release-critical paths.
- Pull-request and main-branch install tests are scoped by `tests/install/utils/classify-install-scope.sh`: unit-only, installer, compose/docker, auth-flow, upgrade-baseline, upgrade, or release-critical. Container-health and auth-flow reuse one stack when both are relevant. Prisma/migration-only changes run the baseline upgrade matrix, while upgrade harness/fixture changes, release tags, schedules, install workflow edits, and manual release-critical/all/upgrade runs include both baseline and extended upgrade fixtures. Install Markdown/MDX changes are docs-only and should not run install tests.
- `Validate Docker Images` is scoped by
  `scripts/ci/classify-docker-build-images.sh`. Frontend-only inputs build only
  the frontend image, backend-only inputs build only the backend image, and
  shared image inputs build both. Every build uses `push: false`.
- `Release Candidate Validation` is the deliberate pre-release install validation pass.
- Stable-tag `Install Tests` is the final Forgejo release gate.
- The trusted operator release command owns GitHub tag reconciliation and
  matching GitHub/Forgejo Release objects.

Release/tag validation workflows must not use broad cancellation rules. A
superseded PR run can be canceled; an immutable tag validation run should not be
canceled unless an operator does so intentionally.

## Emergency Hotfix Process

Use this only when production or release infrastructure is blocked and waiting for the normal PR process would cause more risk than bypassing it.

1. Temporarily bypass Forgejo branch protection as an administrator.
2. Make the smallest safe fix.
3. Run the focused local command that covers the failure mode.
4. Push the hotfix and wait for the full `main` gate.
5. Open a follow-up PR that documents the bypass, adds missing regression coverage if needed, and updates `tasks/lessons.md` if the issue was caused by a preventable process mistake.
6. Re-enable the normal branch protection state immediately.

Emergency bypasses are not a replacement for the PR workflow.

## Measurement

Track CI health by lane, not as one blended number:

- PR quick gate p50 and p90 wall time.
- Merge/main full gate p50 and p90 wall time.
- Cancellation count after force-push/rebase updates.
- Failures caught only after merge.
- Nightly/deep-check failures that should move earlier.

Use the duration helper when tuning a completed run:

```bash
bash scripts/ci/report-workflow-durations.sh <run-id>
```

The helper uses `gh run view --json jobs` and prints the longest jobs first. The full frontend jobs and the backend source/integration jobs also wrap their long typecheck, coverage, and integration steps with `scripts/ci/time-command.sh`, so use the job log timing notices to decide whether the next split should target frontend coverage, backend integration tests, or setup overhead.

Use the timing-notice helper when a job is the tail and the setup/runtime split matters:

```bash
bash scripts/ci/report-timing-notices.sh --run <run-id> --job-filter "Full Browser E2E Tests"
bash scripts/ci/report-timing-notices.sh --run <run-id> --job-filter "Full Backend Integration Tests"
bash scripts/ci/report-timing-notices.sh --run <run-id> --job-filter "Install Stack Smoke"
```

This parses the notices emitted by `scripts/ci/time-command.sh` from matching job logs. Prefer this evidence over eyeballing logs when deciding whether repeated setup, build, migrations, or test runtime is the actual long pole.

Use the trend helper before changing a workflow shape:

```bash
bash scripts/ci/report-workflow-trends.sh --workflow test.yml --event push --limit 20
bash scripts/ci/report-workflow-trends.sh --workflow install-test.yml --limit 20
```

The trend helper fetches recent successful runs, sums job durations as runner
time, reports wall-time and runner-time p50/p90, and lists the longest job per
run. Keep PR quick gates, `main` gates, release/install gates, and
scheduled/manual runs separate; a combined average hides the cost model. Do not
shard or add setup reuse for a lane unless the p90 trend shows it is still a real
tail.

The frontend/backend matrix split intentionally trades extra runner minutes for
lower `main` gate wall time. Keep coverage artifact names stable
(`frontend-coverage`, `backend-coverage`) so `Full Test Summary` remains the
branch-protection aggregate. Frontend coverage now shards execution with Vitest
blob reports and enforces thresholds only in the merge job; if it becomes the
long pole again, increase the shard count only after measuring shard balance and
merge overhead from workflow durations.

Backend integration tests now use deterministic groups in `scripts/ci/backend-integration-groups.sh`. Run the group check after adding, removing, or renaming an integration spec:

```bash
bash scripts/ci/backend-integration-groups.sh --check
```

This split also trades runner minutes for wall time because each integration group performs its own service setup and migrations. Add more groups only after measuring group balance and duplicated setup cost from workflow durations.

Full browser-flow E2E uses deterministic spec groups in `scripts/ci/browser-e2e-groups.sh`. The groups currently run sequentially inside one job because Forgejo browser matrix children have failed before checkout on the shared runner pool. Revisit browser job fan-out only after an isolated-runner rehearsal proves checkout, Docker services, Playwright cache, and artifact upload are stable. Run the group check after adding, removing, or renaming a top-level browser spec:

```bash
bash scripts/ci/browser-e2e-groups.sh --check
```

Playwright runs also emit per-spec timing files under the existing `test-results/` artifact directory: `playwright-timing.json` for machine-readable history and `playwright-timing.md` for quick review. The quick and full E2E jobs also wrap dependency install, Playwright browser install, frontend build, backend setup/build, and the Playwright command itself with `scripts/ci/time-command.sh`. Use those notices to separate setup cost from spec runtime before changing group membership, browser count, retries, or shared setup.

As of the 2026-04-30 review, recent `main` Test Suite push runs show browser-flow jobs as the recurring wall-time tail when full browser E2E runs. A sampled wallet-experience job spent about 79 seconds in timed dependency/build/backend setup notices and 67 seconds in Playwright runtime, with the remaining time in hosted-runner service startup, checkout, cache, server readiness, and artifact overhead. That means setup reuse is worth continuing to measure, but a shared build artifact or prebuilt test image is not yet justified without proving upload/download or image-build overhead is lower than the duplicated setup it replaces.

Backend integration jobs are currently not the merge-gate tail on recent `main` runs. The workflow now times dependency install, shared schema linking, Prisma generation, migrations, and the grouped Vitest command separately so another integration split can be justified from setup/runtime evidence rather than group duration alone.

Install workflow push runs currently tail on `Install Stack Smoke` or baseline upgrade lanes, depending on the path scope. Fresh install, install-script E2E, stack startup, stack subtests, and upgrade lanes now emit timing notices. Keep the release/install lanes isolated unless timing data shows fixture scoping saves more than it costs in lost isolation.

### CI Timing Review Checkpoint

After 10-20 successful Forgejo PR or `main` runs with the E2E timing notices
enabled, review the latest `test.yml` trend sample and the slowest completed runs
before making another workflow-shape change.

- If dependency install or frontend build dominates E2E wall time, evaluate shared build artifacts, dependency-cache tuning, or moving repeated setup out of the browser matrix.
- If Playwright browser install dominates, tune browser cache keys, restore behavior, or install scope before changing test grouping.
- If backend setup, Prisma generation, migrations, or backend build dominates full browser E2E jobs, optimize backend setup reuse before adding more E2E shards.
- If Playwright runtime dominates after setup is accounted for, rebalance `scripts/ci/browser-e2e-groups.sh` or split the slowest spec group.
- Do not add another shard, shared artifact job, or cache layer unless the p90 trend shows the target remains a real tail across multiple runs.

When adding any new expensive CI trigger, add or update a classifier test in the same change so the path policy stays executable instead of living only in workflow comments.

Initial targets:

- Gateway-only PRs: under 3 minutes p50.
- Frontend/backend PRs without E2E-heavy changes: under 8 minutes p50.
- Merge/main full gate: under 15 minutes p50.

## Diagnostic harness for Docker-backed install jobs

Release tags use distinct workflow-level concurrency groups for
`install-test.yml` and `release-candidate.yml`, and each install release tag is
also isolated from scheduled and `main` install runs. GitHub-style concurrency
keeps only one pending run per group; sharing a group caused all three v0.8.58
release-candidate validations to be replaced before their jobs started. The
Docker-backed jobs use run-scoped projects and ports on the DIND runner so the
two workflows can coexist without coupling their pending slots.

Docker-backed install and release jobs also require the organization's
`x300-canary` runner label. That label selects the Docker-in-Docker runner whose
daemon socket can be mounted into the production `docker-proxy` service at
`/var/run/docker.sock`.

The rootless Podman runner does not satisfy that contract today, but the
obstacle is narrower than engine incompatibility. Podman exposes a
Docker-compatible API socket under `$XDG_RUNTIME_DIR/podman/`, and that runner
already targets it through `DOCKER_HOST`. What blocks it is that
`docker-compose.yml` hardcodes `/var/run/docker.sock` as the mount *source*,
which does not exist on a rootless host, and that the runner's `valid_volumes`
allowlist is empty so no bind mount is permitted. Whether
`tecnativa/docker-socket-proxy` works against Podman's compat API is untested;
see issue #667. Treat the label as "runner that can expose a mountable Docker
API socket" rather than "runner running Docker-in-Docker".

The Docker-backed install jobs in `install-test.yml` and `release-candidate.yml`
run through a diagnostic logging harness so failures that happen *before* a
test body executes (Docker readiness, isolated workspace setup, port
assignment, secret generation, image build) still leave a downloadable,
redacted log artifact. The artifact contract is what makes those failures
diagnosable without a Forgejo Web UI session cookie.

**Wrapper composition order** for lock-protected steps:

```
scripts/ci/run-with-log.sh \
  scripts/ci/with-runner-lock.sh <lock-name> \
  scripts/ci/time-command.sh "<label>" \
  <command body>
```

`run-with-log.sh` is outermost on purpose: `with-runner-lock.sh` emits its
"Waiting for runner lock" line before invoking its child, so the logger
must wrap the lock to capture that wait line in the diagnostic artifact.
`tests/ci/check-workflow-composition.test.sh` enforces this order across
both workflows.

**`docker/setup-buildx-action` removed** from the five Docker-backed
release-candidate install/upgrade jobs (`fresh-install-test`,
`container-health-test`, `auth-flow-test`, `upgrade-test`,
`upgrade-full-recovery-test`). Compose Bake is disabled in install E2E
and the dedicated `Docker Build` workflow owns Buildx coverage, so the
action's only role in those jobs was creating a buildx context the
install paths did not use, while expanding the action-internal blind
spot the diagnostic harness cannot reach. Do not reintroduce it without
restoring an actual Buildx-dependent invocation.

**Diagnostic artifact retention** is set to 14 days explicitly on every
`upload-artifact` invocation that writes to `${{ env.JOB_LOG_DIR }}`,
so retention does not drift with Forgejo instance defaults.

**Trace opt-in**: set `SANCTUARY_CI_DEBUG_TRACE=1` at the workflow env
level only for jobs whose helpers are reviewed and known not to print
secrets (today: `wait-for-docker.sh`). Do not enable it globally for
installer/E2E bodies that may handle generated secrets — the redactor
in `run-with-log.sh` is a defense-in-depth backstop, not permission to
trace secret-heavy flows.
