# CI pipeline implement-merge ledger

Plan: `tasks/ci-pipeline-analysis-plan-2026-08-21.md`  
Target: `main`  
Rebuild policy: `after-plan`

| Phase | Target branch | Task branch | Worktree | Created by loop | Converted to next phase | Cleanup status | PR | Merge commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 0/1a | `main` | `codex/implement-merge/ci-truthful-gates` | `/home/nekoguntai/sanctuary-ci-truthful-gates` | yes | no | retained pending final cleanup | [#871](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/871) | `331bcb83272a12d58b7b9299832d5950c7ef3dd6` |
| Phase 1b | `main` | `codex/implement-merge/ci-install-hermetic` | `/home/nekoguntai/sanctuary-ci-install-hermetic` | yes | no | retained pending final cleanup | [#873](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/873) | `fdee4acc2bf41126a8dab309a7345a2c6179d7e9` |
| Phase 1c | `main` | `codex/implement-merge/ci-upgrade-sync-fixture` | `/home/nekoguntai/sanctuary-ci-upgrade-sync-fixture` | yes | no | retained pending final cleanup | [#874](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/874) | `c8200025442cc8bab6a9bf9d87d31ee36b9a1fdc` |
| Phase 0b | `main` | `codex/implement-merge/ci-performance-report` | `/home/nekoguntai/sanctuary-ci-performance-report` | yes | no | retained pending final cleanup | [#875](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/875) | `e3a8780e7869cda3ffadd60de35dc710830c5582` |
| Phase 2a | `main` | `codex/implement-merge/ci-critical-path` | `/home/nekoguntai/sanctuary-ci-critical-path` | yes | no | retained pending final cleanup | [#881](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/881) | `4e43ab9acd1ed36a9b75b34a094c927261f23b02` |
| Phase 2b | `main` | `codex/implement-merge/ci-quick-lane-dedup` | `/home/nekoguntai/sanctuary-ci-quick-lane-dedup` | yes | no | retained pending final cleanup | [#882](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/882) | `908d7ede694a9772aa246565c0749fb8064f5860` |
| Phase 3a | `main` | `codex/implement-merge/ci-architecture-scope` | `/home/nekoguntai/sanctuary-ci-architecture-scope` | yes | no | retained pending final cleanup | [#883](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/883) | `07c7d37cac14f461b7cd6e321ddebf8e7f07712d` |
| Phase 3b (rejected pilot) | `main` | `codex/implement-merge/ci-frontend-coverage-parallel` | `/home/nekoguntai/sanctuary-ci-frontend-coverage-parallel` | yes | no | retained as experiment record | [#884](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/884) | not merged (timing rollback) |
| Phase 3c | `main` | `codex/implement-merge/ci-artifact-policy` | `/home/nekoguntai/sanctuary-ci-artifact-policy` | yes | no | retained pending final cleanup | [#885](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/885) | `f6894c80135e29147e1d37262c038a8632841a20` |
| Phase 1d | `main` | `codex/implement-merge/ci-quality-push-scope` | `/home/nekoguntai/sanctuary-ci-quality-push-scope` | yes | no | retained pending final cleanup | [#886](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/886) | `1c608ae13f1ad4747ecf2c43226088b56b8eb39b` |
| Phase 5a | `main` | `codex/implement-merge/ci-hardware-proof-sources` | `/home/nekoguntai/sanctuary-ci-hardware-proof-sources` | yes | no | retained pending final cleanup | [#887](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/887) | `244aa7c45d7f9e9da3667af05602bc88e95d4ccc` |
| Phase 1e | `main` | `codex/implement-merge/ci-redis-integration` | `/home/nekoguntai/sanctuary-ci-redis-integration` | yes | no | retained pending final cleanup | [#888](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/888) | `57a1776b158ffc2c264d1af33dcfecd025edb43a` |
| Phase 5b | `main` | `codex/implement-merge/ci-hardware-shadow` | `/home/nekoguntai/sanctuary-ci-hardware-shadow` | yes | no | retained pending final cleanup | [#889](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/889) | `32e2dfe0d99e87da3ba5aa75b7b32e778bb878a4` |
| Phase 1f | `main` | `codex/implement-merge/ci-auth-e2e-fidelity` | `/home/nekoguntai/sanctuary-ci-auth-e2e-fidelity` | yes | no | cleaned after landed-main verification | [#891](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/891) | `2b5d05b818d33609b45748f51fa72079d5a8dad6` |
| Phase 4 | `main` | `codex/implement-merge/ci-release-preflight-truth` | `/home/nekoguntai/sanctuary-ci-release-preflight-truth` | yes | no | cleaned after landed-main and manual RC verification | [#892](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/892) | `a355673249e98c2b3cfff38a7f5643b2968e517b` |
| Phase 3d | `main` | `codex/implement-merge/ci-quality-artifact-policy` | `/home/nekoguntai/sanctuary-ci-quality-artifact-policy` | yes | no | retained pending final cleanup | [#893](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/893) | `6436668d9766ba2be180f664c874f1a096f207ca` |
| Phase 3e | `main` | `codex/implement-merge/ci-runtime-cve-socket` | `/home/nekoguntai/sanctuary-ci-runtime-cve-socket` | yes | no | active correction | pending | pending |

## Ownership boundary

Only branches and worktrees listed above are owned by this loop. Existing
release, rationalization, and Claude-session worktrees are explicitly excluded
from cleanup and mutation.

## Evidence log

- 2026-08-21: created isolated worktree from `origin/main` at `19ee80e59f`.
- 2026-08-21: confirmed the primary Sanctuary stack was already running; defer
  rebuild until all plan phases have merged.
- 2026-08-21: Phase 0/1a static contract slice implemented without changing
  aggregate status names: truthful PR documentation, quality-on-main, proxy
  lint/coverage parity, shared-and-gateway production compilation, and bounded
  Docker jobs.
- 2026-08-21: local verification passed: 304 workflow-composition assertions,
  quality classifier regression, test-only workflow policy, actionlint 1.7.12,
  proxy lint/build/coverage (176 tests), shared and gateway builds, and gateway
  coverage (565 tests, 100% thresholds).
- 2026-08-21: Phase 0/1a merged through PR #871. All five landed-main
  workflows passed at the exact merge commit: architecture, Docker, quality,
  test, and vector verification.
- 2026-08-21: `v0.8.66-rc2` passed its install, Podman canary, and RC workflows
  at the Phase 0/1a merge commit. The subsequent immutable `v0.8.66` tag exposed
  a clean-daemon install defect in run 11801: Compose did not pull the missing
  digest-pinned docker-socket-proxy before `up --no-build`, so the backend was
  never created. Phase 1b owns the hermetic external-image prefetch fix; the
  existing tag is not mutated.
- 2026-08-21: Phase 1b merged through PR #873. PR CI, all landed-main
  workflows, fresh-install E2E, and installer E2E passed. Manual upgrade-baseline
  run 11812 proved the missing-image failure was fixed, then exposed a separate
  fixture defect: `latest-stable` now already contains the wallet-sync-state
  migration, while the fixture incorrectly expected that migration to rerun.
  Phase 1c owns schema-aware legacy-versus-structured fixture seeding; the
  older `n-2` baseline retains the actual migration proof.
- 2026-08-21: Phase 1c merged through PR #874. PR baseline proof passed after a
  live-gate correction for shell-quoted SQL parameterization. Merged-revision
  workflow-dispatch run 11826 then passed latest-stable preservation, `n-2`
  migration proof, exact Docker cleanup, and the install summary. Every
  landed-main workflow at `c8200025442c` also passed.
- 2026-08-21: Phase 0b started from `c8200025442c` to replace the GitHub-only
  trend collector with GET-only Forgejo reporting and a trusted,
  event-separated, non-blocking weekly artifact.
- 2026-08-21: Phase 0b merged through PR #875. Manual merged-main run 11835
  produced a valid 10-cohort performance artifact; its pre-optimization Test
  PR baseline is p50 1,229 seconds and p90 1,905 seconds, while vector PR proof
  is p50 1,081 seconds and p90 1,295 seconds.
- 2026-08-21: Per user direction, Phase 2a moved ahead of the remaining
  coverage-hardening phases so later PRs benefit from the shorter CI feedback
  loop. The phase starts from `e3a8780e7869` and owns only test-workflow DAG,
  duplicated quick mutation, and frontend typecheck setup reductions.
- 2026-08-21: Phase 2a implementation starts the full lane immediately after
  classification, removes false quick-job ordering, removes duplicate quick
  backend/frontend typechecks, replaces the duplicate quick Stryker pass with
  a dependency-free shard/baseline contract check, and consolidates frontend
  typechecks behind one install. Protected aggregate names remain unchanged.
- 2026-08-21: Comparable historical runs project the DAG change removing 516
  seconds of imposed delay from frontend PR run 11717 (about 42% of wall time)
  and 455 seconds from backend PR run 11703 (about 36%). Full mutation run
  11620 used about 823 runner-seconds and 565 wall seconds; Phase 2a avoids
  paying that Stryker work twice on a matching PR.
- 2026-08-21: Phase 2a local verification passed 312 workflow-composition
  assertions, action-runtime policy, test-only policy, actionlint 1.7.12,
  frontend strict/catch-all TypeScript plus 7,999 tests, and backend TypeScript
  plus 14,257 tests.
- 2026-08-21: Phase 2a merged through PR #881 as `4e43ab9acd`. All 30 PR
  contexts passed, including the exact protected Code Quality, PR Required
  Checks, and Full Test Summary contexts. The Test PR run finished in 1,353
  seconds and proved that the full lane started immediately after the 9-second
  classifier while the CI-only quick leaves skipped as intended.
- 2026-08-21: Every landed-main workflow passed at the Phase 2a merge commit.
  The Test push run finished in 1,239 seconds with 21 successful jobs, 10
  expected path/event skips, and no failures; architecture finished in 105
  seconds, quality in 510 seconds, and vector verification in 1,165 seconds.
- 2026-08-21: Phase 2b starts from `4e43ab9acd` in a new isolated worktree. It
  owns the remaining evidence-based comparison of quick jobs with their full
  counterparts and will retain only materially earlier, distinct PR signal.
- 2026-08-21: A GET-only audit of 393 completed Test PR runs retained changed-test
  hygiene, related frontend/backend tests, DB-backed integration smoke, and the
  mutation configuration contract because they provide unique or materially
  earlier signal. Quick gateway and proxy were slower than their immediately
  concurrent full supersets in representative runs. Quick browser and render
  exercised no unique spec, consumed at least 21,929 observed runner-seconds,
  and held the same E2E lock needed by full validation. Phase 2b removes those
  four quick jobs while preserving every authoritative full job and stable
  aggregate context.
- 2026-08-21: Phase 2b local verification passed 304 workflow-composition
  assertions, classifier and browser-group regressions, action-runtime policy,
  test-only policy, actionlint 1.7.12, frontend strict/catch-all TypeScript plus
  7,999 tests, and backend TypeScript plus 14,257 tests. Independent final review
  found no stale dependency, classifier, full-summary, or protected-context gap.
- 2026-08-21: Phase 2b merged through PR #882 as `908d7ede69`. The final PR
  Test run passed in 1,291 seconds with all 30 contexts green. Landed-main
  architecture, quality, Test, and vector workflows passed in 134, 380, 1,176,
  and 1,011 seconds respectively. The main Test run retained all selected full
  jobs, skipped the PR-only quick lane, and completed 202 seconds faster than
  the pre-Phase-2 main run 11833.
- 2026-08-21: Phase 3 evidence rejects a shared frontend build artifact for now.
  Browser and render builds embed different `VITE_API_URL` values, still need
  their own Playwright dependencies, and spend only 4-6 seconds building. Warm
  npm download-cache hits also left `npm ci` near the existing 16-20 second
  range, so neither mechanism has a measured critical-path win yet.
- 2026-08-21: Phase 3a starts from `908d7ede69` and separates architecture
  graph/boundary proof from Docusaurus validation inside one stable job.
  Landed-main run 11852 spent 30 seconds installing both dependency trees, 45
  seconds building docs, one second typechecking docs, and nine seconds
  regenerating dependency graphs in a 134-second combined job. A 202-run audit
  found meaningful runner queues and projects that two parallel jobs would add
  about 11% PR runner use. In-job scope selection instead lets source-only
  changes avoid about 54 seconds of docs work, docs-only changes avoid about 35
  seconds of application/architecture work, and 16% of sampled main pushes skip
  the workflow entirely while retaining one visible Architecture result.
- 2026-08-21: Phase 3a merged through PR #883 as `07c7d37cac`. All 30 PR
  contexts passed; Architecture proved both selected scopes. Every landed-main
  workflow passed, and the scoped Architecture job completed in 113 seconds.
- 2026-08-21: Phase 3b PR #884 safely proved a two-child frontend coverage
  matrix, but the experiment failed its validation-time contract. Raw coverage
  execution improved 230 seconds and Test runner time rose only 4.1%, with no
  native, OOM, artifact, lock, or test failure. Runner queues delayed the
  children 220-247 seconds, however: coverage-gate latency improved only 71-72
  seconds and Full Test Summary regressed 17 seconds. The PR was closed without
  merge, its branch was retained, and a completion-ordering alternative was
  rejected because it delayed frontend coverage and depended on queue order.
- 2026-08-21: Phase 3c starts from `07c7d37cac`. A live-log audit found that
  `Full Test Summary` had no checkout, so all five local artifact downloads
  failed under `continue-on-error` and successful summaries contained no
  coverage tables. The slice restores the local action, fixes the gateway
  extraction path, removes an unused mutation download, and makes 16 verbose
  Test diagnostic bundles plus two Playwright HTML reports failure-only while
  preserving coverage, mutation, and Playwright timing evidence.
- 2026-08-21: Phase 3c merged through PR #885 as `f6894c8013`. Its final PR
  Test run passed in 1,422 seconds. Full Test Summary downloaded all four
  coverage artifacts successfully, including gateway coverage at the corrected
  extraction root. The successful run retained 13 required coverage, mutation,
  and Playwright timing artifacts while publishing no verbose diagnostic or
  Playwright HTML artifact.
- 2026-08-21: The Phase 3c landed-main quality run 11881 exposed a distinct
  Phase 1 contract defect: `Determine Quality Scope` did not receive the push
  event's `before` SHA, diffed the merge commit against itself, and skipped 11
  quality jobs. Phase 1d starts from exact merged main `f6894c8013`; it owns
  exact push-range wiring, fail-closed missing-range behavior, and cross-scope
  rename classification without changing the protected aggregate name.
- 2026-08-21: Phase 1d PR #886's first complete Quality attempt selected all
  intended leaves and passed 11 of them. Workflow lint never reached actionlint:
  runner 1c1c5ea1 timed out in the Podman archive API while copying workflow
  command files after checkout. Local actionlint and the independent diff review
  remain clean; the failed attempt is classified as a proven runner fault, not
  a source failure.
- 2026-08-21: Phase 1d merged through PR #886 as `1c608ae13f`. The final PR
  commit and landed-main commit both passed all 30 contexts. The main Quality
  event exposed the exact `before=f6894c8013` and `after=1c608ae13f` range;
  Determine Scope selected all 11 leaves, every leaf passed, and the stable
  aggregate passed. Landed Quality, Test, and Vector workflows completed in
  738, 1,406, and 1,002 seconds respectively.
- 2026-08-21: A reproducible GET-only 60-day Vector audit captured 434 runs and
  1,558 SHA256-manifested evidence files. In the comparable current-topology
  cohort, 55 successful unrelated PR runs model a median 425.5 runner-second
  and 272 wall-second emulator saving, but only ten days of topology exposure
  and zero product-validation emulator failures cannot establish false-negative
  retention. Phase 5 therefore does not activate skipping yet.
- 2026-08-21: Phase 5a starts from exact merged main `1c608ae13f`. It owns one
  canonical, conservatively expanded common/vendor proof-source inventory and
  atomically migrates Trezor, Ledger, and Jade source hashing to it. The phase
  changes no emulator condition, workflow dependency, summary result, artifact
  schema, required context, or branch-protection rule; a separate Phase 5b will
  add report-only classifier observation after this dependency closure lands.
- 2026-08-21: Phase 5a's final local audit made the proof inventory strictly
  commit-bound: selectors expand from Git's tracked index only, and vendor
  runners reject relevant modified, staged, deleted, or untracked paths plus
  selected symlinks before hashing. The resolved inventories contain 115
  Trezor, 94 Ledger, and 106 Jade sources while retaining every legacy source
  and the recursive local-import closure of each proof entrypoint. Focused
  verification passed 10 inventory tests, 8 wallet-classifier tests,
  351 workflow-composition assertions, 12 emulator configuration tests, Quality
  scope classification, action-runtime guards, workflow test-only policy,
  provider-context tests, actionlint, ESLint, syntax checks, and diff checks. The
  official repeatable address verifier regenerated both byte-identical vector
  fixtures to bind their provenance hash to the intentional Vector workflow
  change; its generated-vector and hardware-compatibility suites passed 19/19.
- 2026-08-21: Phase 5a opened as PR #887 from exact main `1c608ae13f` after the
  full pre-commit backend and frontend suites also passed. The PR remains a
  dependency-closure change only: all three emulator jobs still execute
  unconditionally, and the existing Vector summary and protected contexts are
  unchanged pending terminal PR and landed-main verification.
- 2026-08-21: Phase 5a merged through PR #887 as `244aa7c45d`. Its corrected
  head passed all 30 PR contexts after selector validation was split below the
  repository CCN threshold. All five landed-main workflows then passed:
  Architecture 122 seconds, Docker 18 seconds, Quality 748 seconds, Test 1,446
  seconds, and Vectors 1,008 seconds. The base vector proof and all three
  emulator proofs remained selected and green.
- 2026-08-21: Phase 1e starts from exact merged main `244aa7c45d` in a new
  isolated worktree. It owns the four Redis-conditional worker integration
  suites, a published-port Redis resolver shared with browser E2E, and explicit
  fail-closed CI enforcement. It does not change backend integration grouping,
  retry policy, aggregate names, or protected contexts.
- 2026-08-21: Phase 1e local rehearsal used the workflow's exact digest-pinned
  Redis image on a random published localhost port. The shared resolver proved
  that endpoint, and all four worker files then executed 14/14 tests in 4.10
  seconds with zero skips. The first positive run exposed two previously hidden
  test-contract defects: the dead-letter retry fixture had not initialized the
  real Redis infrastructure used by its production enqueue path, and a BullMQ
  scheduler assertion required an optional key to exist with value `undefined`.
  Both fixtures now exercise the production contract accurately. Separate
  rehearsals prove required-without-URL fails with the exact collection error
  and optional local mode reports all 14 tests as explicit skips.
- 2026-08-21: Phase 1e opened as PR #888 at `8a95aa001c` after two independent
  read-only reviews found no P0-P2 issue. The local pre-commit gate also passed
  14,266 backend and 7,999 frontend tests. The first remote run owns acceptance
  of Forgejo's assigned Redis port/gateway behavior and the backend-integration
  timing threshold; no protected aggregate name or dependency changed.
- 2026-08-21: PR #888's first remote Test run failed truthfully before both
  Redis-backed lanes: Forgejo v13 left `job.services.redis.ports['6379']`
  empty even though both service containers were healthy. Browser and backend
  integration therefore rejected the missing port, and the two protected Test
  aggregates failed; the 14 worker cases did not run. The correction does not
  restore the rotating unauthenticated alias. Instead, each Redis health check
  installs a job-unique password, and the resolver falls back by enumerating
  concrete alias IPs and accepting exactly one authenticated candidate. A
  local digest-pinned password-enabled rehearsal then passed 14/14 worker tests
  with zero skips in 3.97 seconds. The amended remote run owns final acceptance.
- 2026-08-21: PR #888's corrected head passed all 30 contexts. Browser E2E
  completed in 355 seconds, and backend integration completed in 167 seconds
  versus the 169-second Phase 5a baseline. The integration result moved from
  645 passed plus 14 skipped tests to 659 passed and zero skipped tests: the
  four Redis worker suites executed all 14 cases. PR #888 squash-merged as
  `57a1776b15`; landed-main verification is in progress.
- 2026-08-21: Phase 5b rebased onto exact Phase 1e main `57a1776b15`. It adds
  only report-only hardware-emulator shadow telemetry: PRs use merge-base diff
  semantics, push and merge-group events use exact ranges, and every ambiguous
  or unknown hardware path predicts all three vendors. The observer reuses the
  existing base Vector checkout/toolchain; both report steps are bounded and
  nonblocking, expose no outputs, and remain absent from emulator and summary
  dependencies. No emulator execution changes before the 30-day evidence gate.
- 2026-08-22: Phase 1e's first landed-main integration run exposed a load-racy
  BullMQ fixture: Worker startup and QueueEvents delivery consumed the entire
  five-second terminal-state deadline. PR #890 replaced that event race with
  explicit Worker readiness and bounded persisted-state polling while retaining
  exact completed/failed payload assertions. It squash-merged as `4de94846df`;
  both its PR and landed-main runs executed all 14 Redis cases with zero skips,
  including the repaired retention pair in 194 and 201 milliseconds.
- 2026-08-22: Phase 5b merged through PR #889 as `32e2dfe0d9`. All 30 PR
  contexts passed, the exact-revision shadow artifact predicted all three
  vendors, and Trezor, Ledger, Jade, and the stable Vector summary still ran
  unconditionally. Provider-context policy passed. The measured full-history
  checkout plus observer delay before unchanged core proof was about 3.6
  seconds, below the ten-second retain bound; activation remains prohibited
  until the documented 30-day/30-run shadow evidence gate is satisfied.
- 2026-08-22: Phase 1f starts from exact merged main `32e2dfe0d9`. It adds a
  guarded, idempotent browser-E2E seeder for deterministic login, 2FA-prompt,
  logout, and wallet list-to-detail evidence; removes the legacy auth skip and
  conditional wallet no-ops; and classifies seeder-only changes into the browser
  lane. Local proof passed the focused seeder tests, server test typecheck,
  classifier and planner regressions, browser group ownership, 371 workflow
  composition assertions, action/runtime policy, actionlint, Playwright
  discovery, and the production-environment refusal rehearsal. Independent
  review found no remaining P0-P2 issue; remote browser execution owns final
  acceptance of zero skipped auth/wallet cases and seed overhead.
- 2026-08-22: Every landed-main workflow passed at the Phase 5b merge commit.
  The Vector base proof, Trezor, Ledger, Jade, and stable summary all executed
  successfully; the shadow artifact remained revision-bound and explicitly
  reported that emulator and summary execution were not conditioned. The base
  Vector job completed within 5.4 seconds of the immediately preceding
  non-observer landed-main comparison, inside the ten-second representative
  retain bound. Test and Quality also finished with all 30 commit contexts
  green and no failure or pending status.
- 2026-08-22: Phase 1f merged through PR #891 as `2b5d05b818`. All five PR
  workflows and the exact three protected contexts passed. The guarded browser
  seed completed before the sequential browser groups, the seeded-wallet case
  passed 1/1 without a retry or skip, and the admin-auth group completed after
  removal of its runtime skip flag and every local `test.skip` branch. Landed
  main Architecture, Docker, Quality, Test, and Vector workflows then passed in
  103, 669, 694, 1,324, and 1,240 seconds respectively; Browser repeated the
  seeded-wallet pass in 365 seconds. The owned remote branch, local branch, and
  isolated worktree were removed only after ancestry, tree, and landed-CI proof.
- 2026-08-22: Phase 4 rebases onto exact merged main `2b5d05b818`. Release
  Candidate Validation now resolves its trusted ref once, locks the resulting
  full commit SHA, and fans that immutable commit out to all retained evidence
  jobs. The two sequential warning-only health/auth stack rebuilds are retired;
  canonical release-tag Install Tests remain the sole blocking health, auth,
  and upgrade evidence, and the trusted publisher still requires their
  successful run at the exact release commit. The stable `Validation Summary`
  and `Install Test Summary` contexts are unchanged, while both summaries now
  state the commit/evidence boundary without claiming approval. Local proof
  passed 366 workflow-composition assertions, all 13 install unit suites plus
  their two CI guards, the release-distribution suite, CI registration checks,
  actionlint with error-level shellcheck, and diff checks.
- 2026-08-22: Phase 4 merged through PR #892 as `a355673249`. All five standard
  PR workflows and the stable Install Test Summary passed; the workflow-only
  install scope correctly ran its unit/static owner and skipped every expensive
  stack and upgrade lane. Landed-main and controlled manual RC preflight proof
  were pending at merge and are recorded in the next entry.
- 2026-08-22: Phase 4 landed-main and manual acceptance are complete. Exact
  merge commit `a355673249` passed Architecture run 11990 (127 seconds), Install
  Tests 11991 (1,053 seconds), Quality 11992 (586 seconds), Test 11993 (1,577
  seconds), and Vectors 11994 (1,136 seconds), with 30/30 terminal commit
  contexts green or intentionally skipped. Controlled manual RC run 11995
  resolved `main` once to full SHA `a355673249e98c2b3cfff38a7f5643b2968e517b`;
  Hardware Compatibility Evidence, Unit Tests, and Fresh Install E2E each
  checked out that exact SHA and passed. Its hardware artifact binds the same
  revision. Only the five retained jobs existed, and the stable Validation
  Summary finished the 239-second workflow with: “Release candidate preflight
  passed for a355673249e98c2b3cfff38a7f5643b2968e517b; release approval remains
  pending same-commit Install Tests.” The previously observed duplicated RC path
  took about 21.5 minutes, so this controlled rehearsal reduced RC preflight wall
  by about 81% while removing no canonical release gate.
- 2026-08-22: Phase 4 cleanup completed after exact ancestry/tree/remote-head
  checks. Its isolated worktree and owned local/remote branch were removed;
  unrelated worktrees and retained experiments were not touched.
- 2026-08-22: Phase 3d rebases onto exact Phase 4 main `a355673249`. Its
  bounded final artifact-policy slice makes the 13 verbose
  `ci-diagnostics-quality-*` bundles failure-only while retaining always-visible
  diagnostic summaries and the Semgrep, jscpd, and weekly performance evidence.
  Exact landed-main run 11972 published all 13 successful diagnostic bundles
  for only 36,773 bytes. Full Quality PR run 11967 measured a 10.483-second
  lower bound of runner action time from content discovery through post hooks,
  excluding action initialization; the protected aggregate's upload alone
  added at least 757 milliseconds to terminal wall time. No validator, job
  dependency, classifier, stable context, or branch-protection rule changes.
  Local proof passed 422 workflow-composition assertions, Quality scope and
  audit regressions, workflow test-only policy, the action-runtime suite,
  actionlint with error-level shellcheck, shell syntax, and diff checks.
- 2026-08-22: The final CI closeout persists the reproducible 60-day GET-only
  audit under `tasks/evidence/ci-completion-audit-2026-08-22/`, including the
  portable collector, derived summaries, checksums, and the manifest digest for
  the external 184 MiB raw capture. Seven requested cohorts reached 20
  comparable successful runs; docs-only reached 10 and gateway-only reached 1,
  so those two sample gates are recorded as failed rather than padded. The audit
  attributes mutation and install failures, records at least 63.9 runner-hours
  consumed by cancelled work, and supports retaining every deep gate. Hardware
  emulator execution remains unconditional while the Phase 5 shadow observer
  gathers its separately required 30-day evidence.
- 2026-08-22: Phase 4 classifier ownership closes by deleting the unused
  `test-plan-load` composite. Both the CI scalar adapter and local JSON planner
  continue to source the sole path predicate library, and composition tests
  prevent another unconsumed classifier contract. Documentation now records the
  actual unit-only scheduled Install Tests behavior, the retained package-level
  coverage thresholds, and Desktop Chromium as the required browser evidence.
- 2026-08-22: The image-CVE evaluation retains a nonblocking RC observer rather
  than a PR gate or scheduled rebuild. The fresh-install lane binds its four
  candidate images to the immutable candidate and image-lock SHA, then scans
  their immutable image IDs with digest-pinned Trivy and retains a 90-day JSON
  artifact whose status is `observed`, `partial`, or `unavailable`. Scanner,
  database, and vulnerability outcomes cannot feed the stable Validation
  Summary. Local proof passed 55 observer cases, six supply-chain lock tests,
  439 workflow-composition assertions, CI registration/classifier/planner/lane/
  portability/runtime-policy suites, actionlint, evidence checksums, and diff
  checks. Remote RC observation and overhead remain the final acceptance proof.
- 2026-08-22: Phase 3d merged through PR #893 as `6436668d97`. All five PR
  workflows and the exact three protected contexts passed. Quality success
  retained only Semgrep and jscpd reports and emitted zero verbose
  `ci-diagnostics-quality-*` artifacts. Landed Architecture, Docker, Quality,
  Test, and Vector workflows then passed in 134, 835, 828, 1,519, and 1,033
  seconds respectively, with the same success-artifact result.
- 2026-08-22: Controlled RC run 12006 proved candidate and image-lock binding
  for all four immutable application image IDs, preserved the truthful
  nonblocking Validation Summary, and completed successfully in 350 seconds.
  The observer itself occupied about 12 seconds, below its 60-second threshold;
  the 111-second workflow delta versus run 11995 came primarily from a
  99-second increase in the unchanged fresh-install core. The first remote
  artifact correctly reported `unavailable`, not clean: Trivy downloaded its
  database, but every scan failed because the nested container tried to mount
  job-local `/var/run/docker.sock` as a daemon-host path on the rootless Podman
  runner. Phase 3e therefore owns the deterministic socket-discovery correction;
  no release gate or summary dependency changes.
