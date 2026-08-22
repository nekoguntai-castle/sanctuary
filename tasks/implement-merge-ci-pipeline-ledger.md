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
| Phase 2b | `main` | `codex/implement-merge/ci-quick-lane-dedup` | `/home/nekoguntai/sanctuary-ci-quick-lane-dedup` | yes | no | active | pending | pending |

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
