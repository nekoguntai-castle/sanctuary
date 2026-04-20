# Sanctuary CI/CD Strategy

Date: 2026-04-19 (Pacific/Honolulu)
Status: Active baseline for PR-first development; merge-queue ready, but not currently enforceable on this user-owned repository

This document explains which checks should run at each point in development. The goal is not to run fewer tests; it is to run each test at the cheapest point where it gives useful signal.

## Development Model

Normal development happens on short-lived branches and enters `main` through pull requests. Direct human pushes to `main` are reserved for documented emergencies only.

`main` should be protected with:

- Pull requests required before merge.
- Required status checks enabled.
- Linear history required.
- Force pushes and branch deletion disabled.
- The branch required to be up to date before merge unless GitHub merge queue is enabled.

Because this repository currently has a single human collaborator, the branch protection baseline requires a PR but does not require an external approving review. If additional maintainers are added, raise `required_approving_review_count` to `1` and enable stale-review dismissal.

## Merge Queue Status

Merge queue is the preferred long-term merge model once GitHub makes it available for this repository. The required workflows already include `merge_group` triggers, and the full confidence lane is ready to validate the queued merge-group SHA.

Current blocker: `nekoguntai/sanctuary` is a public repository owned by a paid personal user account. GitHub Pro/personal billing still leaves the repository owner type as `User`, not `Organization`. GitHub currently limits pull request merge queues to public repositories owned by organizations, or private repositories owned by organizations using GitHub Enterprise Cloud. An API attempt to add a repository ruleset with a `merge_queue` rule failed with HTTP 422, `Invalid rule 'merge_queue'`, which matches that availability limit.

When the repository is moved under an eligible organization, enable a repository-level merge queue for `main` with:

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

`PR Required Checks` and `Full Test Summary` live in the same `Test Suite` workflow. On PRs, the quick-lane aggregate is meaningful and the full-lane aggregate is skipped. On merge-queue events, the full-lane aggregate is meaningful and the PR aggregate is skipped. GitHub treats skipped jobs as successful checks, so both names can safely exist in branch protection now and remain valid when merge queue is enabled.

Do not globally require `Build Dev Images`, `Install Test Summary`, or `Verify Bitcoin Vectors`. Those workflows are intentionally path-gated or release-gated. They should run when their trigger paths match, including changes to their own workflow files, but requiring them globally would block unrelated PRs where the workflow never starts.

## First PR Validation Checklist

The first PR after enabling this strategy should be treated as a process validation, not only a code change.

- Confirm `PR Required Checks` runs on the pull request and fails only when a quick-lane child fails.
- Confirm `Code Quality Required Checks` runs on the pull request and reflects lint, gitleaks, lizard, and jscpd.
- Confirm `Full Test Summary` is present on the pull request as skipped/success, so branch protection does not wait on the full lane.
- Confirm docs-only or workflow-only PRs do not wait on absent Docker, install, or vector checks.
- After merge, confirm the push-to-`main` full lane runs as the merge confidence backstop.

## First PR Validation Result

Validated on 2026-04-19 HST with PR #8, `ci-pr-flow-aggregates`, merged as `72bdce96`.

- `PR Required Checks` passed on the PR.
- `Code Quality Required Checks` passed on the PR.
- `Full Test Summary` appeared on the PR and completed as skipped, satisfying branch protection without running the full lane before merge.
- Path-gated workflow checks behaved correctly: Docker build, install tests, and vector verification ran because this PR changed their workflow files; they were not global requirements for unrelated PRs.
- The post-merge `main` backstop passed: `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install summary, release check, and dev image build completed successfully.

## Lizard Remediation PR Loop

The lizard cleanup loop now uses the same PR-first workflow as other development:

1. Start each batch from updated `main` on a short-lived branch.
2. Refactor the next highest-value complexity target with focused tests and local lizard verification.
3. Update `docs/plans/codebase-health-assessment.md`, grade history, and `tasks/todo.md` with the new warning count and verification evidence.
4. Open a PR and wait for `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
5. Merge only after required checks pass, then wait for the post-merge full lane on `main`.
6. Rebase or recreate the next batch branch from the updated `main`.

## CI Tiers

### Tier 0 - Local Loop

Run focused commands before pushing:

- Frontend/UI: `npm run typecheck:app`, `npm run typecheck:tests`, and focused `npx vitest run ...`.
- Backend: `cd server && npm run typecheck:tests` and focused `npx vitest run ...`.
- Gateway: `cd gateway && npm run test:run` or focused gateway tests.
- Docker/install: relevant `tests/install/*` scripts when practical.

Run full coverage locally when the change affects coverage policy, broadly shared code, auth, Bitcoin transaction logic, or release readiness.

### Tier 1 - PR Quick Gate

The PR quick gate is optimized for repeated branch updates.

`Test Suite` runs changed-file detection and then conditionally runs:

- Test hygiene for changed tests.
- Frontend typecheck plus related Vitest tests.
- Backend test typecheck plus related non-integration Vitest tests.
- Backend integration smoke for backend changes.
- Gateway related tests.
- Chromium E2E smoke/render checks for frontend or E2E changes.
- Critical mutation gate for critical Bitcoin/auth/access-control paths.

`PR Required Checks` fails if any required quick-lane child fails, and allows skipped path-conditional children.

`Code Quality` runs lint, gitleaks, lizard, and jscpd on every PR. `Code Quality Required Checks` fails if any of those children fail.

The CI lizard job currently gates a measured CI-scope baseline of 9 warnings. That prevents new complexity regressions while the broader remediation loop continues ratcheting down the full lizard backlog. Lower `LIZARD_WARNING_BASELINE` whenever the CI-scope warning count is reduced.

### Tier 2 - Merge/Main Confidence Gate

The merge/main gate exists to prove the final candidate, not every local-sized commit.

`Test Suite` full lane runs on `main`, schedule, manual dispatch, and merge queue:

- Full backend unit coverage and integration tests.
- Full frontend typecheck and threshold-enforced coverage.
- Full gateway coverage.
- Critical mutation gate when critical paths changed on push, and on non-push full-lane events.
- Chromium Playwright E2E.
- Full frontend/backend build check.
- `Full Test Summary` aggregate, which fails if any required full-lane child fails.

When merge queue is available, use the merge-queue SHA as the authoritative merge candidate and treat push-to-main full-lane runs as a backstop.

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
- `Release Candidate Validation` is the deliberate pre-release install validation pass.
- `Release` builds and publishes multi-arch images, creates manifests, updates Umbrel metadata, and updates release notes.

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

Initial targets:

- Gateway-only PRs: under 3 minutes p50.
- Frontend/backend PRs without E2E-heavy changes: under 8 minutes p50.
- Merge/main full gate: under 15 minutes p50.
