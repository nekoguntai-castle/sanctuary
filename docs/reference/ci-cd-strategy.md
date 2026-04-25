# Sanctuary CI/CD Strategy

Date: 2026-04-22 (Pacific/Honolulu)
Status: Active baseline for PR-first development with protected `main` and merge queue enabled

This document explains which checks should run at each point in development. The goal is not to run fewer tests; it is to run each test at the cheapest point where it gives useful signal.

## Development Model

Normal development happens on short-lived branches and enters `main` through pull requests. Direct human pushes to `main` are reserved for documented emergencies only.

`main` is protected with:

- Pull requests required before merge.
- Required status checks enabled.
- Linear history required.
- Force pushes and branch deletion disabled.
- Merge queue enabled for the final merge candidate.

Because this repository currently has a single human collaborator, the branch protection baseline requires a PR but does not require an external approving review. If additional maintainers are added, raise `required_approving_review_count` to `1` and enable stale-review dismissal.

## Merge Queue Status

Merge queue is the active merge model for protected `main`. The required workflows include `merge_group` triggers, and the full confidence lane validates the queued merge-group SHA before GitHub merges the pull request.

The queue is configured with:

- Merge method: squash.
- Build concurrency: `3`.
- Minimum group size: `1`.
- Maximum group size: `1` until the suite has enough history to batch safely.
- Required all-green queue entries.
- Status check timeout: `60` minutes.
- Required checks: `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.

## Required Checks

Use stable aggregate jobs as branch-protection targets. Do not require path-conditional leaf jobs directly, because docs-only or unrelated PRs can leave those checks absent.

Required for PRs:

- `PR Required Checks`
- `Full Test Summary`, expected to appear as skipped/success on pull requests
- `Code Quality Required Checks`

Required for merge/main confidence, and for merge queue when available:

- `Full Test Summary`
- `Code Quality Required Checks`

`PR Required Checks` and `Full Test Summary` live in the same `Test Suite` workflow. On PRs, the quick-lane aggregate is meaningful and the full-lane aggregate is skipped. On merge-queue events, the full-lane aggregate is meaningful, path-aware, and the PR aggregate is skipped. GitHub treats skipped jobs as successful checks, so both names can safely exist in branch protection now and remain valid when merge queue is enabled.

Do not globally require `Build Dev Images`, `Install Test Summary`, or `Verify Bitcoin Vectors`. Those workflows are intentionally path-gated or release-gated. They should run when their trigger paths match, including changes to their own workflow files, but requiring them globally would block unrelated PRs where the workflow never starts.

`CodeQL Required Checks` is emitted by the repo-owned advanced CodeQL workflow, but it is not a branch-protection requirement yet. GitHub default setup must stay disabled for this repository because GitHub rejects advanced CodeQL uploads while default setup is enabled; keep the aggregate context observed for Actions, JavaScript/TypeScript, Go, and Python path fixtures before deciding whether to promote it to branch protection.

## First PR Validation Checklist

The first PR after enabling this strategy should be treated as a process validation, not only a code change.

- Confirm `PR Required Checks` runs on the pull request and fails only when a quick-lane child fails.
- Confirm `Code Quality Required Checks` runs on the pull request and reflects lint, gitleaks, lizard, and jscpd.
- Confirm `Full Test Summary` is present on the pull request as skipped/success, so branch protection does not wait on the full lane.
- Confirm docs-only or workflow-only PRs do not wait on absent Docker, install, or vector checks.
- Confirm merge-queue full-lane jobs run only for the touched package unless the test workflow, schedule, or manual dispatch requires an exhaustive run.
- After merge, confirm the push-to-`main` full lane runs as the merge confidence backstop.

## First PR Validation Result

Validated on 2026-04-19 HST with PR #8, `ci-pr-flow-aggregates`, merged as `72bdce96`.

- `PR Required Checks` passed on the PR.
- `Code Quality Required Checks` passed on the PR.
- `Full Test Summary` appeared on the PR and completed as skipped, satisfying branch protection without running the full lane before merge.
- Path-gated workflow checks behaved correctly: Docker build, install tests, and vector verification ran because this PR changed their workflow files; they were not global requirements for unrelated PRs.
- The post-merge `main` backstop passed: `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install summary, release check, and dev image build completed successfully.

Revalidated after organization migration and protected-main rollout on 2026-04-22 HST:

- PR #87, `security/codeql-alert-triage`, passed PR required checks, entered the merge queue, passed merge-group `Code Quality` and `Test Suite`, and merged as `9358e84a`.
- PR #88, `security/cache-codeql-fixes`, passed PR required checks, entered the merge queue, passed merge-group `Code Quality` and `Test Suite`, and merged as `50d54aad`.
- On both merge-group runs, quick-lane jobs skipped correctly while `Full Test Summary` represented the full-lane result.
- After PR #87 merged, the push-to-`main` backstop passed Release, Build Dev Images, Install Tests, and Test Suite.

## Repository Actions Permissions

Repository workflow permissions are intentionally narrow:

- Default `GITHUB_TOKEN` permission: `read`.
- GitHub Actions pull-request creation/approval setting: disabled.
- Workflow files request write scopes only for jobs that need them, such as release editing, package publishing, or check inspection.
- Umbrel automation no longer needs this repository token to create PRs. Stable releases dispatch an `image-published` event to `nekoguntai-castle/sanctuary-umbrel` through `UMBREL_DISPATCH_TOKEN`; that repository owns its own PR/update workflow.

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

- Frontend/UI: `npm run typecheck:app`, `npm run typecheck:tests`, and focused `npx vitest run ...`.
- Backend: `cd server && npm run typecheck:tests` and focused `npx vitest run ...`.
- Gateway: `cd gateway && npm run test:run` or focused gateway tests.
- Docker/install: relevant `tests/install/*` scripts when practical.

Before opening or updating a PR, run the full local gate for the touched package so GitHub Actions is a protection layer, not the first place basic package coverage/build failures are discovered:

- Gateway changes: `cd gateway && npm run test:coverage && npm run build`.
- AI proxy changes: `npm --prefix ai-proxy run build` plus `npx vitest run tests/ai-proxy`.
- Server security, Bitcoin, auth, access-control, or shared-service changes: focused tests, `npm run typecheck:server:tests`, and the broader changed-server test gate when paths are critical.
- Frontend changes: strict app/test typechecks plus the relevant coverage command for the changed surface.

Push once per batch after the relevant local gate is green. Let PR checks run once, then enter merge queue once. If CI finds a reproducible local gap, add that command to this Tier 0 checklist before retrying.

### Tier 1 - PR Quick Gate

The PR quick gate is optimized for repeated branch updates.

`Test Suite` runs changed-file detection and then conditionally runs:

- Test hygiene for changed tests.
- Frontend typecheck plus related Vitest tests.
- Backend test typecheck in a DB-free job plus DB-backed related non-integration Vitest tests.
- Backend integration smoke for backend changes that touch integration-sensitive surfaces, such as API routes, middleware, repositories, Prisma migrations, worker/queue infrastructure, package/config files, or integration tests. Clearly unit-scoped backend helper changes still run backend typecheck and related non-integration tests, but skip the DB-backed smoke lane.
- Gateway related tests.
- AI proxy build plus the dedicated `tests/ai-proxy` suite for `ai-proxy/` source/config changes and `tests/ai-proxy/` changes. These paths do not run frontend tests unless a separate frontend path changed.
- Chromium browser smoke only for browser-flow-relevant paths such as app routing, auth/API clients, selected shell routes, server API/routing/auth middleware, and non-render E2E specs.
- Chromium render regression only for visual/rendering paths such as app shell, components, hooks, providers, themes, utilities, and render-regression fixtures/snapshots.
- Critical mutation gate for critical Bitcoin/auth/access-control paths.

`PR Required Checks` fails if any required quick-lane child fails, and allows skipped path-conditional children.

`Code Quality` runs lint, gitleaks, lizard, and jscpd on every PR. `Code Quality Required Checks` fails if any of those children fail.

The CI lizard job currently gates a measured CI-scope baseline of 9 warnings. That prevents new complexity regressions while the broader remediation loop continues ratcheting down the full lizard backlog. Lower `LIZARD_WARNING_BASELINE` whenever the CI-scope warning count is reduced.

### Tier 2 - Merge/Main Confidence Gate

The merge/main gate exists to prove the final candidate, not every local-sized commit.

`Test Suite` full lane runs on `main`, schedule, manual dispatch, and merge queue. On merge-queue and push events, it first classifies changed paths and runs only the relevant full lanes. Schedule and manual dispatch set `full_scan=true` and remain exhaustive.

Markdown and MDX files are docs-only for the test classifiers, including package-local docs under `server/`, `gateway/`, `ai-proxy/`, and `tests/install/`. A docs-only change may still get required aggregate/no-op checks on PRs, but it must not start source tests, DB-backed tests, E2E lanes, install tests, or image builds.

- Full backend typecheck for backend changes, test-workflow changes, or exhaustive runs. This job does not start Postgres or run migrations.
- Full backend unit coverage for backend changes, test-workflow changes, or exhaustive runs. This remains DB-backed and keeps publishing the stable `backend-coverage` artifact.
- Full backend integration tests for integration-sensitive backend changes, test-workflow changes, or exhaustive runs. Integration-sensitive paths include API routes, middleware, repositories, Prisma migrations, worker/queue infrastructure, package/config files, and integration tests. Clearly unit-scoped backend helpers skip the DB-backed integration groups on merge/main but still run backend typecheck and unit coverage.
- `Full Backend Tests` remains the aggregate backend result consumed by `Full Test Summary`, so branch protection does not depend on path-conditional source or integration leaf jobs.
- Full frontend app typecheck, test typecheck, and threshold-enforced coverage for frontend changes, test-workflow changes, or exhaustive runs. Typechecks run in a small matrix, while frontend coverage runs as two Vitest shard jobs that upload blob reports. A merge job then combines those blobs, generates the normal `coverage/` output, and enforces the existing coverage thresholds once. The `full-frontend-tests` job remains the aggregate result consumed by `Full Test Summary`.
- Full gateway coverage for gateway changes, test-workflow changes, or exhaustive runs.
- Full AI proxy build plus `tests/ai-proxy` for AI proxy changes, test-workflow changes, or exhaustive runs.
- Critical mutation gate for critical mutation paths or exhaustive runs.
- Full browser-flow Playwright E2E for browser/API/route/non-render E2E paths, test-workflow changes, or exhaustive runs. This lane starts from path classification instead of waiting behind full coverage lanes and runs deterministic spec groups in parallel, so relevant browser flows prove the merge candidate earlier.
- Full render-regression Playwright E2E for visual/rendering paths and render fixtures/snapshots, test-workflow changes, or exhaustive runs. This lane is frontend-only and does not start backend services.
- E2E-only changes run the relevant browser/render E2E lanes without also running backend integration, backend unit coverage, or frontend unit coverage. Backend/frontend source changes still trigger their source lanes independently, and test-workflow changes still run the broad full lane.
- Full frontend/backend build check for package, build config, Docker/image entrypoint, Prisma, test-workflow, or exhaustive runs. It also starts from path classification instead of waiting behind coverage. Typecheck and coverage remain the primary source-level compile gate for ordinary frontend/backend source changes.
- `Full Test Summary` aggregate, which fails if any required full-lane child fails.

When merge queue is available, use the merge-queue SHA as the authoritative merge candidate. Push-to-main full-lane runs are a path-aware backstop for the final merged commit; scheduled and manual runs provide the periodic exhaustive proof.

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

Release validation intentionally duplicates some install and image-building evidence:

- `Install Tests` validates fresh install, install script flow, container health, auth flow, and upgrade on release-critical paths.
- Pull-request and main-branch install tests are scoped by `tests/install/utils/classify-install-scope.sh`: unit-only, installer, compose/docker, auth-flow, upgrade-baseline, upgrade, or release-critical. Container-health and auth-flow reuse one stack when both are relevant. Prisma/migration-only changes run the baseline upgrade matrix, while upgrade harness/fixture changes, release tags, schedules, install workflow edits, and manual release-critical/all/upgrade runs include both baseline and extended upgrade fixtures. Install Markdown/MDX changes are docs-only and should not run install tests.
- `Release Candidate Validation` is the deliberate pre-release install validation pass.
- `Release` builds and publishes multi-arch images, creates manifests, notifies the separate Umbrel repository for stable releases, and updates release notes.

Release/tag workflows must not use broad cancellation rules. A superseded PR run can be canceled; a publishing run should not be canceled unless an operator does so intentionally.

## Emergency Hotfix Process

Use this only when production or release infrastructure is blocked and waiting for the normal PR process would cause more risk than bypassing it.

1. Temporarily bypass branch protection as an admin, or use GitHub's explicit bypass mechanism if enabled.
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

Use the trend helper before changing a workflow shape:

```bash
bash scripts/ci/report-workflow-trends.sh --workflow test.yml --event merge_group --limit 20
bash scripts/ci/report-workflow-trends.sh --workflow install-test.yml --limit 20
```

The trend helper fetches recent successful runs, sums job durations as runner time, reports wall-time and runner-time p50/p90, and lists the longest job per run. Keep PR quick gates, merge-group gates, release/install gates, and scheduled/manual runs separate; a combined average hides the cost model. Do not shard or add setup reuse for a lane unless the p90 trend shows it is still a real tail.

The frontend/backend matrix split intentionally trades extra runner minutes for lower merge-queue wall time. Keep coverage artifact names stable (`frontend-coverage`, `backend-coverage`) so `Full Test Summary` remains the branch-protection aggregate. Frontend coverage now shards execution with Vitest blob reports and enforces thresholds only in the merge job; if it becomes the long pole again, increase the shard count only after measuring shard balance and merge overhead from workflow durations.

Backend integration tests now use deterministic groups in `scripts/ci/backend-integration-groups.sh`. Run the group check after adding, removing, or renaming an integration spec:

```bash
bash scripts/ci/backend-integration-groups.sh --check
```

This split also trades runner minutes for wall time because each integration group performs its own service setup and migrations. Add more groups only after measuring group balance and duplicated setup cost from workflow durations.

Full browser-flow E2E uses deterministic spec groups in `scripts/ci/browser-e2e-groups.sh`. The wallet lifecycle and wallet transaction flows are split into separate groups because the repeated setup cost is still smaller than the wall-time cost of keeping the long wallet-flow spec set together. Avoid adding a shared build-artifact dependency ahead of the browser matrix unless measured setup/build duplication becomes larger than the extra artifact job and download overhead. Run the group check after adding, removing, or renaming a top-level browser spec:

```bash
bash scripts/ci/browser-e2e-groups.sh --check
```

Playwright runs also emit per-spec timing files under the existing `test-results/` artifact directory: `playwright-timing.json` for machine-readable history and `playwright-timing.md` for quick review. Use those artifacts to find slow browser-flow or render-regression specs before changing group membership, browser count, retries, or shared setup.

When adding any new expensive CI trigger, add or update a classifier test in the same change so the path policy stays executable instead of living only in workflow comments.

Initial targets:

- Gateway-only PRs: under 3 minutes p50.
- Frontend/backend PRs without E2E-heavy changes: under 8 minutes p50.
- Merge/main full gate: under 15 minutes p50.
