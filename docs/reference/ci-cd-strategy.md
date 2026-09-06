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
- `Full Test Summary`
- `Code Quality Required Checks`

Required for `main` confidence:

- `Full Test Summary`
- `Code Quality Required Checks`

`PR Required Checks` and `Full Test Summary` live in the same `Test Suite`
workflow. Forgejo pull requests run both the changed-file quick lane and the
path-aware full lane; `PR Required Checks` fails unless `Full Test Summary`
succeeds. Pushes to `main` repeat the path-aware full lane against the immutable
merged commit. This intentionally keeps exhaustive pre-merge validation while
Forgejo pull requests, rather than a merge queue, are the active merge model.

Do not globally require `Validate Docker Images`, `Install Test Summary`, or
`Verify Bitcoin Vectors`. Those workflows are intentionally path-gated or
release-gated. They should run when their trigger paths match, including changes
to their own workflow files, but requiring them globally would block unrelated
PRs where the workflow never starts.

## PR validation checklist

- Confirm `PR Required Checks` runs on the pull request and fails when a required quick-lane child or `Full Test Summary` fails.
- Confirm `Code Quality Required Checks` runs on the pull request and reflects lint, gitleaks, lizard, and jscpd.
- Confirm `Full Test Summary` runs and succeeds on the pull request before merge.
- Confirm docs-only or workflow-only PRs do not wait on absent Docker, install, or vector checks.
- Confirm the post-merge `main` full lane runs only for the touched package unless the test workflow, schedule, or manual dispatch requires an exhaustive run.
- After merge, confirm the push-to-`main` full lane runs as the merge confidence backstop.

## First PR Validation Result

The first aggregate implementation was validated on 2026-04-19 HST with PR #8,
`ci-pr-flow-aggregates`, merged as `72bdce96`. Its quick-only PR policy is
historical; the current workflow also requires the full PR lane.

- `PR Required Checks` passed on the PR.
- `Code Quality Required Checks` passed on the PR.
- `Full Test Summary` was skipped under the historical policy. Do not use that
  result as evidence for the current full pre-merge contract.
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
- After both exact accepted-RC Forgejo gates and the production canary pass, a
  trusted operator runs `npm run release:promote -- ...` with explicit RC,
  stable, receipt, raw-evidence, rehearsal-output, and key paths. Only that
  command may push the stable tag. The operator then runs
  `npm run release:publish -- <stable> --candidate <rc> --receipt <abs>
  --evidence <abs> --rehearsal-manifest <abs> --public-key <abs>` to revalidate
  the same evidence, verify mirror/tag parity, and create matching
  Forgejo/GitHub Release objects. The complete command sequence is in
  [Release distribution](release-distribution.md#release-sequence).

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

### Tier 1 - PR Feedback And Full Gate

The PR quick lane and path-aware full lane start concurrently after changed-file
classification. Both lanes are part of the required pre-merge contract, but the
quick lane is feedback rather than a prerequisite for starting exhaustive work.

`Test Suite` runs changed-file detection and then conditionally runs:

- Test hygiene for changed tests.
- Frontend related Vitest tests; strict typechecks run once in the full lane.
- Backend related non-integration Vitest tests. The test typecheck runs once in
  the full lane.
- Backend integration smoke for backend changes that touch integration-sensitive surfaces, such as API routes, middleware, repositories, Prisma migrations, worker/queue infrastructure, package/config files, or integration tests. Clearly unit-scoped backend helper changes still run backend typecheck and related non-integration tests, but skip the DB-backed smoke lane.
- Gateway and LLM egress proxy changes rely on their full jobs, which start
  immediately after classification and include the former quick signal plus
  production build and coverage enforcement.
- Browser-flow and render changes rely on their full Playwright jobs. The
  retired quick copies exercised no unique specs, repeated dependency and
  browser setup, and contended with the exhaustive jobs for the shared E2E
  lock.
- Critical mutation configuration sanity for critical
  Bitcoin/auth/access-control paths. The full lane owns the single exhaustive
  pre-merge mutation execution.

`PR Required Checks` fails if any required quick-lane child or `Full Test
Summary` fails, and allows skipped path-conditional children.

`Code Quality` runs lint, gitleaks, lizard, and jscpd on every PR. `Code Quality Required Checks` fails if any of those children fail.

The CI lizard job currently gates a measured CI-scope baseline of 9 warnings. That prevents new complexity regressions while the broader remediation loop continues ratcheting down the full lizard backlog. Lower `LIZARD_WARNING_BASELINE` whenever the CI-scope warning count is reduced.

The `Architecture` workflow classifies its changed paths into independent core
architecture and Docusaurus validation groups. Source, architecture-script,
boundary-policy, and generated-architecture changes skip docs-site install and
build work. Published documentation and docs-site implementation changes skip
application-workspace install, boundary scans, and graph regeneration. Changes
under `docs/architecture/` and per-service `ARCHITECTURE.md` files intentionally
run both because they are architecture evidence and published site input.

### Tier 2 - Main Confidence Backstop

The post-merge `main` gate proves the final merged commit after the same
path-aware full checks have already protected the pull request.

`Test Suite` full lane runs on pull requests, `main`, schedule, and manual
dispatch. Pull requests and pushes classify changed paths and run only the
relevant full lanes. Schedule and manual dispatch set `full_scan=true` and
remain exhaustive.

Markdown and MDX files are docs-only for the test classifiers, including package-local docs under `server/`, `gateway/`, `llm-egress-proxy/`, and `tests/install/`. A docs-only change may still get required aggregate/no-op checks on PRs, but it must not start source tests, DB-backed tests, E2E lanes, install tests, or image builds.

- Full backend typecheck for backend changes, test-workflow changes, or exhaustive runs. This job does not start Postgres or run migrations.
- Full backend unit coverage for backend changes, test-workflow changes, or exhaustive runs. This remains DB-backed and keeps publishing the stable `backend-coverage` artifact.
- Full backend integration tests for integration-sensitive backend changes, test-workflow changes, or exhaustive runs. Integration-sensitive paths include API routes, middleware, repositories, Prisma migrations, worker/queue infrastructure, package/config files, and integration tests. The job provisions digest-pinned Postgres and Redis services. Each Redis health check installs a job-unique password; the resolver prefers a runner-assigned published port and, when Forgejo omits it, authenticates every concrete service-alias IP and accepts exactly one. With `SANCTUARY_REQUIRE_REDIS_INTEGRATION=true`, the four Redis worker suites fail during test collection if Redis evidence is unavailable instead of silently skipping. Clearly unit-scoped backend helpers skip the DB-backed integration groups on merge/main but still run backend typecheck and unit coverage.
- `Full Backend Tests` remains the aggregate backend result consumed by `Full Test Summary`, so branch protection does not depend on path-conditional source or integration leaf jobs.
- Full frontend app typecheck, test typecheck, and threshold-enforced coverage for frontend changes, test-workflow changes, or exhaustive runs. The three typecheck commands run as separately timed steps after one checkout/install. The two logical coverage shards run sequentially after one checkout/install in the coverage job, which then combines their blob reports, generates the normal `coverage/` output, and enforces the existing thresholds once. The `full-frontend-tests` job remains the aggregate result consumed by `Full Test Summary`.
- Full gateway coverage for gateway changes, test-workflow changes, or exhaustive runs.
- Full LLM egress proxy build plus `tests/llm-egress-proxy` for LLM egress proxy changes, test-workflow changes, or exhaustive runs.
- Critical mutation gate for critical mutation paths or exhaustive runs.
- Full browser-flow Playwright E2E for browser/API/route/non-render E2E paths, test-workflow changes, or exhaustive runs. After migrating the isolated test database, the lane reconciles guarded, idempotent auth and wallet fixtures so login, 2FA-prompt, logout, and wallet list-to-detail behavior execute without conditional skips. Changes to that seeder are themselves browser-smoke inputs. This lane starts from path classification instead of waiting behind full coverage lanes, but keeps its deterministic spec groups serialized inside one E2E lock until an isolated-runner rehearsal proves browser fan-out is stable.
- Full render-regression Playwright E2E for visual/rendering paths and render fixtures/snapshots, test-workflow changes, or exhaustive runs. This lane is frontend-only and does not start backend services.
- E2E-only changes run the relevant browser/render E2E lanes without also running backend integration, backend unit coverage, or frontend unit coverage. Backend/frontend source changes still trigger their source lanes independently, and test-workflow changes still run the broad full lane.
- Full frontend/backend build check for package, build config, Docker/image entrypoint, Prisma, test-workflow, or exhaustive runs. It also starts from path classification instead of waiting behind coverage. Typecheck and coverage remain the primary source-level compile gate for ordinary frontend/backend source changes.
- `Full Test Summary` aggregate, which fails if any required full-lane child fails.

The required browser evidence contract is Desktop Chromium. CI installs and
runs Chromium only. The Firefox, WebKit, and mobile projects in Playwright
configuration are developer-facing compatibility aids, not release evidence.
General UI support documentation may describe additional browsers, while
hardware-wallet flows remain limited by each browser's WebUSB, WebHID, and
WebSerial support; neither claim should be inferred from a green Chromium lane.

Coverage remains a deliberately mixed, non-decreasing policy rather than one
global percentage. This review retains every current threshold:

| Package/scope | Branches | Functions | Lines | Statements |
| --- | ---: | ---: | ---: | ---: |
| Frontend | 100% | 100% | 100% | 100% |
| Backend unit scope | 100% | 100% | 100% | 100% |
| Gateway | 100% | 98% | 100% | 100% |
| LLM egress proxy | 69% | 90% | 81% | 78% |

Thresholds must not be lowered merely to reduce validation time. A later change
requires mutation and escaped-defect evidence, a named replacement invariant,
and a non-decreasing ratchet for any scope that is not held at 100%.

Push-to-main full-lane runs are the path-aware backstop for the final merged
commit; scheduled and manual runs provide periodic exhaustive proof.

`Architecture` uses the same trigger paths for PR and `main` events. A merge
therefore receives the same specialized backstop that validated its source
branch, while unrelated main pushes do not consume an architecture runner.

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

Release validation separates fast preflight evidence from canonical blocking
install evidence, and never publishes from CI:

- `Install Tests` validates fresh install, install script flow, container health, auth flow, and upgrade on release-critical paths.
- Pull-request and main-branch install tests are scoped by `tests/install/utils/classify-install-scope.sh`: unit-only, installer, compose/docker, auth-flow, upgrade-baseline, upgrade, or release-critical. Container-health and auth-flow reuse one stack when both are relevant. Prisma/migration-only changes run the baseline upgrade matrix, while upgrade harness/fixture changes, release tags, install workflow edits, and manual release-critical/all/upgrade runs include both baseline and extended upgrade fixtures. The scheduled drift check is deliberately unit-only; release tags remain the periodic full install/upgrade owner. Install Markdown/MDX changes are docs-only and should not run install tests.
- `Validate Docker Images` is scoped by
  `scripts/ci/classify-docker-build-images.sh`. Frontend-only inputs build only
  the frontend image, backend-only inputs build only the backend image, and
  shared image inputs build both. Every build uses `push: false`.
- `Release Candidate Validation` resolves one immutable candidate SHA and runs unit, hardware-compatibility, and fresh-install preflight checks. Its stable `Validation Summary` explicitly leaves release approval pending. It also runs as smoke on pull requests that touch the release surface (`scripts/ci/**`, `scripts/ownership/**`, `tests/install/**`, workflows, Dockerfiles, compose files, `start.sh`, `install.sh`, `scripts/setup.sh`), validating the exact PR head commit so release-lane regressions surface before merge instead of one per RC (issue 1020). The same release-surface PR smoke widens `install-test.yml`'s `install-stack-smoke` and baseline-upgrade lanes (single `latest-stable` source ref, no extended fixtures): `tests/install/utils/classify-install-scope.sh`'s `enable_pr_release_surface_smoke` carve-out enables them for any PR touching that path set, without duplicating the fresh-install/install-script E2E that `Release Candidate Validation`'s own PR run already covers same-commit.
- `Release Candidate Validation` also runs nightly (03:07 UTC, clear of `Install Tests`' 10:17 UTC unit-only heartbeat and `Test Suite`'s 07:00 UTC schedule) against `main`'s current head, so ownership/release-lane drift on `main` is found within a day instead of at release time (issue 1020 item 4). The idle-fleet gate is the same bounded `e2e` runner-lock wait every lane already uses (`scripts/ci/with-runner-lock.sh`, `SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS` below each job's `timeout-minutes`): a nightly run that lands on a busy fleet waits its turn and fails fast with a named diagnostic rather than needing a dedicated capacity check. Its concurrency group is ref-scoped (`sanctuary-release-candidate-refs/heads/main`), distinct from every tag group and every PR group, so it can never cancel or be cancelled by a tag validation.
- The RC fresh-install lane also observes high/critical CVEs in exactly the four
  candidate-built application images. It verifies candidate and image-lock OCI
  labels, discovers and verifies the daemon-host socket bind source on
  containerized rootless runners, scans immutable image IDs with digest-pinned
  Trivy, and retains JSON evidence for 90 days. This observer is nonblocking and
  reports `observed`, `partial`, or `unavailable`; it is not release approval and is not consumed by
  `Validation Summary`. Consider a blocking policy only after at least 95% report
  availability and an owned remediation baseline; roll the observer back if its
  p95 RC overhead exceeds 60 seconds or scanner/DB failures become persistent.
- Release-tag `Install Tests` owns the blocking same-commit install, health, auth, and upgrade evidence and remains the final Forgejo release gate.
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
FORGEJO_API_URL=https://forge.example/api/v1 \
FORGEJO_REPOSITORY=owner/sanctuary \
FORGEJO_TOKEN=... \
  bash scripts/ci/report-workflow-durations.sh <run-id>
```

The helper uses Forgejo's read-only run, job, and task APIs and prints the
longest jobs first. It resolves the database run ID to the run's exact task-ID
set, scans bounded 50-row task pages until every started job is present, and
fails rather than report a partial or still-running run as complete. The full
frontend jobs and the backend source/integration jobs also wrap their long
typecheck, coverage, and integration steps with `scripts/ci/time-command.sh`, so
use the job log timing notices to decide whether the next split should target
frontend coverage, backend integration tests, or setup overhead.

Use the timing-notice helper when a job is the tail and the setup/runtime split matters:

```bash
FORGEJO_API_URL=https://forge.example/api/v1 \
FORGEJO_REPOSITORY=owner/sanctuary \
FORGEJO_TOKEN=... \
  bash scripts/ci/report-timing-notices.sh --run <run-id> --job-filter "Full Browser E2E Tests"
```

This parses the notices emitted by `scripts/ci/time-command.sh` from matching
members of Forgejo's run-log ZIP without extracting attacker-controlled paths.
Forgejo may expose a partial archive for a still-running job, so absence from a
live run is unavailable evidence, not a zero duration. Prefer completed-run
evidence over eyeballing logs when deciding whether repeated setup, build,
migrations, or test runtime is the actual long pole.

For a compact wall-clock CSV and p50/p90 summary across runs, use the older
Forgejo-native collector:

```bash
SANCTUARY_FORGE_API_URL=https://forge.example \
SANCTUARY_FORGE_OWNER=owner \
SANCTUARY_FORGE_REPO=sanctuary \
SANCTUARY_FORGE_TOKEN=... \
  bash scripts/ci/measure-wallclock.sh --workflow test.yml --event push --branch main --limit 20
```

Use the trend helper before changing a workflow shape:

```bash
FORGEJO_API_URL=https://forge.example/api/v1 \
FORGEJO_REPOSITORY=owner/sanctuary \
FORGEJO_TOKEN=... \
  bash scripts/ci/report-workflow-trends.sh --workflow test.yml --event push --branch main --limit 20
```

The Forgejo-native trend helper performs GET-only API calls and reports
wall-time p50/p90 for recent successful runs. It also reports runner-time and
the longest job when fixture or provider data includes job timestamps; the
current Forgejo job API does not expose those timestamps, so live reports mark
runner metrics as unavailable instead of inventing them. `Code Quality` uploads
an event-separated, non-blocking `ci-performance-report` artifact from trusted
scheduled/manual `main` runs. Keep PR, `main`, release/install, and
scheduled/manual cohorts separate; a combined average hides the cost model.
Do not shard or add setup reuse for a lane unless the p90 trend shows it remains
a real tail.

Keep coverage artifact names stable (`frontend-coverage`, `backend-coverage`)
so `Full Test Summary` remains the branch-protection aggregate. Frontend
coverage keeps two logical Vitest blobs but runs them sequentially in one job to
avoid duplicate setup. If it becomes the long pole again, change parallelism
only after measuring shard balance, setup overhead, runner pressure, and merge
overhead from workflow durations. The merge job uploads root-level `junit.xml`
as the separate `frontend-junit` artifact; never add it to the single-directory
`frontend-coverage` artifact, because that changes its extraction root and can
silently remove the coverage table from `Full Test Summary`.

`Full Test Summary` attempts a non-blocking checkout before invoking the local
Forgejo artifact downloader. The checkout and coverage downloads are
presentation-only and remain non-blocking; the upstream coverage gates own
threshold and artifact completeness. Single-directory artifacts extract
directly into their requested destination, so gateway coverage is read from
`gateway-results/coverage-summary.json` rather than a synthetic nested
`coverage/` directory.

Test jobs always write concise diagnostic notices into their job summaries, but
upload the verbose `ci-diagnostics-*` bundles only on failure. Browser and
render HTML reports follow the same failure-only policy. Required evidence is
different: coverage blobs and reports, mutation reports, and Playwright
`test-results` timing files continue to upload on every outcome. Do not convert
those evidence artifacts to failure-only troubleshooting data.

Each diagnostic summary also aggregates the job's local
`runner-lock: acquired/released/timeout` records into a wait/hold table before
the success-path logs disappear. It preserves incomplete and unavailable values
as `n/a`, writes `runner-lock-summary.json` beside failure diagnostics, and is
strictly observational: aggregation failure cannot change the owning job result.
The measurements are whole seconds and host-local. They must not justify lock
removal until the separately tracked workspace-clean/inode issue is resolved.

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

Install workflow push runs currently tail on `Install Stack Smoke` or baseline upgrade lanes, depending on the path scope. Fresh install, install-script E2E, stack startup, stack subtests, and upgrade lanes now emit timing notices. The baseline and extended-fixture upgrade jobs become eligible together after their shared install prerequisites complete. Two `docker-socket` hosts can therefore run them concurrently, while the host-local `e2e` lock still limits each host to one active fixture and the `Upgrade Extended` relay still waits for both suites. Use the runner-lock wait/hold notices to measure whether this cross-host overlap lowers wall time before widening concurrency elsewhere.

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

Docker-backed install and release jobs require the organization's
`docker-socket` runner label. It means "runner that can expose a mountable
Docker API socket for the production `docker-proxy` service" — a capability,
not a host. Both runners carry it, so these lanes schedule on either.

It replaced `x300-canary`, which pinned twelve jobs to a single host and made
that host a single point of failure for the release gate. The pin existed
because the fleet ran Docker-in-Docker there; the fleet now runs rootless
Podman on every runner, and Podman's Docker-compatible API socket under
`$XDG_RUNTIME_DIR/podman/` satisfies the same contract. Verified end to end by
the canary in `.github/workflows/podman-socket-canary.yml`, which exercises the
socket mount, `tecnativa/docker-socket-proxy` against the compat API, published
ports, volume uid mapping, and healthcheck execution.

Two engine differences these lanes depend on, both handled in-tree:

- published ports resolve via `host.containers.internal`, not loopback, so
  container detection checks `/run/.containerenv` as well as `/.dockerenv`
- a healthcheck embedding shell syntax must use `CMD-SHELL`; the
  `["CMD","sh","-c",<script>]` form arrives truncated and never runs

### Runner fleet and build paths

The two `docker-socket` hosts, `x300` and `kumo`, are provisioned from the same
runner-infra bootstrap: rootless Podman 5.4 behind the compat socket, capacity
2, and a buildx docker-container builder on each. Neither runs Docker Engine.
The one build-relevant difference is that kumo's profile exports
`DOCKER_BUILDKIT=0` for another repository's workflows, so on kumo
`docker compose build` goes through Podman's native (Buildah) builder while on
x300 it goes through BuildKit. The preflight diagnostic's `docker info`
"Name:" line and `docker buildx ls` say which host and builder a job used.

The native builder behaves differently in ways only image-inspecting lanes
notice (verified against Podman 5.4.2; runner-infra documents the same list
under its `DOCKER_BUILDKIT` guidance):

- A fully cached rebuild still commits a **new image ID**, because build labels
  are applied at commit; BuildKit returns the cached ID. Every service declares
  `pull_policy: build`, so a compose `up` without `--no-build` rebuilds. The
  upgrade lane registers its images for receipt-bound cleanup, and one
  post-registration `up` without `--no-build` left the registered backend image
  dangling on kumo for weeks while x300 stayed green (#1032, fixed in #1033;
  `tests/install/unit/upgrade-helpers.test.sh` now pins `--no-build` on every
  lane compose `up`, and teardown re-checks registered image identities).
- `docker container ls --filter ancestor=sha256:<id>` matches nothing; the bare
  ID or a name does.
- Plain `docker image ls` hides every dangling image; `--all` shows them plus
  every labelled intermediate layer image the native builder keeps.
- Compat builds store the name as `docker.io/library/<name>`, native builds as
  `localhost/<name>`, and inspect reports `RepoDigests` for local builds.

A lane that fails on one host only is a builder divergence, not flake: read
the host name before retriggering. The cleanup coordinator's job-log summary
carries `refusedResources` (class, identity, locator, classifications,
references) whenever cleanup refuses, so a refusal on a host without shell
access is diagnosable from the run alone. To force a run onto a particular
host, dispatch `install-test.yml` (`test_suite=upgrade`,
`upgrade_fixture=baseline`) and repeat; the scheduler picks either host.

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

**`docker/setup-buildx-action` is omitted** from the retained
release-candidate `fresh-install-test`. Compose Bake is disabled in install E2E
and the dedicated `Docker Build` workflow owns Buildx coverage, so the action's
only role there was creating a buildx context the install path did not use,
while expanding the action-internal blind spot the diagnostic harness cannot
reach. Do not reintroduce it without restoring an actual Buildx-dependent
invocation.

**Diagnostic artifact retention** is set to 14 days explicitly on every
`upload-artifact` invocation that writes to `${{ env.JOB_LOG_DIR }}`,
so retention does not drift with Forgejo instance defaults.

**Trace opt-in**: set `SANCTUARY_CI_DEBUG_TRACE=1` at the workflow env
level only for jobs whose helpers are reviewed and known not to print
secrets (today: `wait-for-docker.sh`). Do not enable it globally for
installer/E2E bodies that may handle generated secrets — the redactor
in `run-with-log.sh` is a defense-in-depth backstop, not permission to
trace secret-heavy flows.
