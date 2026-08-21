# CI pipeline implement-merge ledger

Plan: `tasks/ci-pipeline-analysis-plan-2026-08-21.md`  
Target: `main`  
Rebuild policy: `after-plan`

| Phase | Target branch | Task branch | Worktree | Created by loop | Converted to next phase | Cleanup status | PR | Merge commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 0/1a | `main` | `codex/implement-merge/ci-truthful-gates` | `/home/nekoguntai/sanctuary-ci-truthful-gates` | yes | no | retained pending final cleanup | [#871](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/871) | `331bcb83272a12d58b7b9299832d5950c7ef3dd6` |
| Phase 1b | `main` | `codex/implement-merge/ci-install-hermetic` | `/home/nekoguntai/sanctuary-ci-install-hermetic` | yes | no | retained pending final cleanup | [#873](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/873) | `fdee4acc2bf41126a8dab309a7345a2c6179d7e9` |
| Phase 1c | `main` | `codex/implement-merge/ci-upgrade-sync-fixture` | `/home/nekoguntai/sanctuary-ci-upgrade-sync-fixture` | yes | no | active | pending | pending |

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
