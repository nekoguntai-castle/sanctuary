# Stale-Wallet Scheduler Removal

Status: implemented in one local commit; PR not yet opened
Date: 2026-11-06
Supersedes: the compatibility layer described in ADR 0004 ("Marker-absent
compatibility scheduling, startup catch-up, and retained completion admission")

## Goal

Remove the legacy `check-stale-wallets` scheduler compatibility layer that
#933 retired in v0.8.67. Wallet sync is tip- and activity-driven (ADR 0004);
nothing re-syncs on elapsed time.

## Decisions

1. Delete marker-absent scheduling, startup catch-up, retained completion
   admission, the `check-stale-wallets` handler and checker, the cutover
   orchestration and repository, the tombstone policy repository, the periodic
   cutover retry, and their tests. Keep the activation gate and mutation-fence
   floor machinery.
2. Keep a small, unconditional, idempotent worker-startup purge of the
   `sync:check-stale-wallets` repeatable and queued `check-stale-wallets` /
   stale-only sync jobs. It covers an install whose cutover never completed.
3. Stop reading and writing the system_settings key
   `operational.wallet-sync.check-stale-wallets-forbidden.v1`. Leave existing
   rows in place; v0.8.67–v0.8.84 binaries read them on rollback.
4. No new Prisma migrations (RC10 migration digest gate). Keep the
   `lastSyncedAt` indexes and mark them as unused legacy indexes.
5. Keep `staleThresholdMs` while support-package stuck detection uses it; keep
   the deprecated sync environment warnings.
6. Minimum supported upgrade source becomes v0.8.67. Remove the
   `wallet-sync-retirement` upgrade fixture (v0.8.66 source).
7. Update the wallet-sync lifecycle contract, its checker and tests, and every
   pinned inventory (mutation boundaries, mutation map, Stryker ranges, replay
   driver, lifecycle callsite registry, integration groups, generated
   architecture).
8. Update ADR 0004, the operations runbook, `server/ARCHITECTURE.md`,
   `docs/explanation/state-machines.md`, and the changelog.

## Delivery

One PR. No deployment or migration sequencing boundary applies.

## Acceptance criteria

- No production code reads or writes the stale-wallet marker, schedules
  `check-stale-wallets`, or handles that job; the startup purge is the only
  remaining reference and is unit tested.
- Every remaining repository hit for the stale-wallet identifiers is the purge,
  historical documentation, or the changelog.
- Backend `tsc`, `typecheck:tests`, unit tests and unit coverage thresholds
  pass; frontend `typecheck:app`, `typecheck:tests`, `typecheck:all` and
  `test:run` pass.
- The lifecycle contract checker and its tests, the large-file gate, the
  touched install unit tests, and `arch:check` pass.
- All four required PR contexts are green, the PR is merged, the merge commit
  is on `origin/main`, and its target-branch CI is green.
