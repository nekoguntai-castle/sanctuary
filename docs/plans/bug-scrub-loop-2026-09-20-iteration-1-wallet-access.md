# Bug scrub loop iteration 1: wallet role cache race

Source target: `5bd498e7d31d0535fe11b82c95a5f65b1e14ecb1` (`origin/main`).  Scope: whole repository.  Finding: `wallet-access--stale-owner-after-transfer` (P1).

## Goal and evidence

Ensure a committed wallet role change cannot be undone by an in-flight cache fill. `getUserWalletRole` reads a role from the database after a cache miss, then writes it to the access cache (`server/src/services/accessControl.ts:84-105`). Wallet transfer changes the role in a transaction and invalidates cache after commit (`server/src/services/transferService/confirm.ts:80-101`). If the old database read finishes before commit but its cache write finishes after invalidation, a former owner's `owner` role is restored for 30 seconds. `requireWalletAccess('owner')` uses this value; wallet deletion also calls the cached role check (`server/src/middleware/walletAccess.ts`, `server/src/services/wallet/walletMutations.ts:106-115`). Existing tests cover sequential invalidation only.

Expected: a request begun after transfer confirmation reads the current role and rejects the former owner. Actual: it can accept the stale cached role, including for wallet deletion and policy changes.

## Assumptions and limits

- The wallet user and group membership repositories remain the durable role source; a lookup started before a transfer commit may complete with the earlier snapshot. The acceptance gate concerns new authorization lookups after confirmation.
- `getAccessCache()` has no reader outside `getUserWalletRole`. Once role caching is removed, access-cache invalidation has no remaining consumer. Remove its obsolete callers in the same PR so strict Redis invalidation cannot report a committed group or restore mutation as failed. Preserve separate WebSocket authorization invalidation and unrelated cache clears.
- Backup restore's result type reports `cacheInvalidated` and `accessCacheReconciled`; the failed-restore API exposes both, while the success API exposes `accessCacheReconciled` (`server/src/services/backupService/types.ts`, `server/src/api/admin/backup.ts`). Preserve these fields for compatibility; after a committed restore, an absent access-role cache is already reconciled, so report true for that component. Update the result type comment to state the new meaning. Keep both false before commit and true after commit even when feature-runtime reconciliation fails. Preserve that independent failure path and its tests.
- No schema migration, data repair, credentials, or production data access is required.
- The two P2 findings (`device-accounts--concurrent-last-account-deletion`, `user-context--auth-bootstrap-after-logout`) remain blocking for later loop plans. Any P3 backlog is outside this plan.

## Phase 1 — one mergeable application PR

- [x] Add a failing service regression in `server/tests/unit/services/accessControl.test.ts`: pause an old role lookup after it reads `owner`, simulate the transfer's durable downgrade and cache invalidation, release the old lookup, then prove a new `getUserWalletRole`/owner check sees the downgraded role. Include a cached `owner` entry after invalidation to demonstrate the authorization failure; cover a null or viewer new role.
- [x] Change `server/src/services/accessControl.ts` so authorization role lookups use the durable repository result. Preserve `getUserWalletRoleUncached` and existing role parsing; remove the role-cache read/write and TTL path that can resurrect grants. Keep error handling fail closed: a repository failure must not turn into an allowed role. Correct its cache documentation and the now-stale authorization comment in `server/src/middleware/walletAccess.ts`.
- [x] Remove obsolete access-cache invalidation and exports from `server/src/infrastructure/accessCache.ts`, `server/src/repositories/walletSharingRepository.ts`, `server/src/services/transferService/confirm.ts`, `server/src/services/adminGroupService.ts`, and `server/src/services/backupService/restore.ts`. In particular, remove strict Redis invalidation after committed group/restore writes; preserve WebSocket access refresh and all other backup cache clears. Keep restore's public reconciliation fields with truthful vacuous success once no access-role cache exists. Remove the infrastructure module only after checking all production and test imports.
- [x] Update cache-specific service, repository, group, transfer, and restore tests to assert durable-role behavior and no spurious failure from the retired access cache. In `server/tests/unit/services/wallet.test.ts` (which registers `mutations-maintenance.contracts.ts`), assert a former owner is denied wallet deletion after a role downgrade; check owner middleware behavior as well. Review `getUserWalletRole` callers for any identity or latency assumptions; document any measurable performance concern rather than reintroducing a stale grant.
- [x] Re-read the diff for simplification, null/empty/error boundaries, concurrent interleavings, and accidental scope expansion. Update this plan with the regression proof, exact PR, merge SHA, and verification evidence.

Acceptance: the regression fails on the source target and passes with the fix; a stale cache entry never authorizes an owner-only operation after a durable downgrade; existing direct and group role semantics remain intact; cache failure cannot turn a committed group or restore operation into a reported failure.

## Verification and delivery

1. Focused: `cd server && npx vitest run tests/unit/services/accessControl.test.ts tests/unit/middleware/walletAccess.test.ts tests/unit/services/wallet.test.ts tests/unit/services/adminGroupService.test.ts tests/unit/services/transferService.test.ts tests/unit/services/backupService.test.ts tests/unit/repositories/walletSharingRepository.test.ts tests/unit/api/admin-backup-routes.test.ts`.
2. Relevant integration/caller tests selected after source review; use the documented disposable database entry point for any DB-backed test, never the live stack.
3. Required local gate before commit: `cd server && npx tsc --noEmit && npx vitest run`; from repo root, `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run`. Run coverage only if the changed tests affect the gate, using `cd server && npx vitest run --coverage tests/unit`.
4. Run adversarial implementation review, then deliver one PR through `pr-delivery`; require exact head checks, verified merge ancestry, and target-branch CI. The loop owns the goal and defers container rebuild until a final clean scrub.
5. Refresh `origin/main`, verify the finding no longer recurs, and rescrub all eight original domains. Do not call the loop clean while either P2 remains.

Backout: revert the bounded PR if authorization or performance regressions appear; no data migration is required. If a running build has used the former role cache, expire its 30-second keys or clear the access namespace before re-enabling cache reads, then verify an owner downgrade is enforced. Deployment uses `./start.sh --rebuild` only at the loop's final clean closeout because the Sanctuary stack was running at startup.

## Delivered result

The regression failed on the original cached implementation and passed after durable role reads replaced it. Full backend and frontend suites, typechecks, 100% backend unit coverage, architecture check, and the repository pre-commit gate passed locally. [Forgejo PR #1251](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/1251) merged at `d507146c82bf20d93676bfd6be8f09fb1f596bf6`; ancestry on `origin/main` and all five exact-SHA target push workflows (18082–18086) were verified. The iteration 2 full scrub found no recurrence of this P1; three P2 findings remain.
