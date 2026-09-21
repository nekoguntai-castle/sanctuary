# Bug Scrub Loop Iteration 10: Async Ownership

## Provenance

- Iteration: 10
- Source target: `main` at `59a44781f17b7d65b6805f78b29ac3e263f734df`
- Scope: whole repository
- Blocking findings:
  - `mcp-access--stale-key-refresh` (P2)
  - `pending-transfers--async-completion-refresh-dropped` (P2)
  - `pending-transfers--post-mutation-refresh-misreported` (P2)
- Deployment policy: defer all rebuilds to the outer loop's final clean pass.
- P3 backlog is outside this plan's blocking fix set.

## Goal

Make the latest valid MCP key state own the UI when reads and mutations overlap, and keep transfer confirmation pending until its ownership refresh settles with an explicit outcome.

## Non-goals

- No server API, database schema, migration, authorization, or transfer state-machine changes.
- No redesign of the MCP access tab or transfer modal.
- No unrelated async-hook consolidation.
- No deployment between phases.

## Assumptions and evidence

### MCP key refresh ownership

`useMcpAccess.refresh` starts status, key, and user reads and later replaces all three states without request ownership. Create and revoke remain enabled while refresh is pending and update the same key state independently. A pre-mutation key snapshot that resolves last can therefore hide a newly created key or render a revoked key active. Existing hook tests cover sequential operations only.

### Transfer completion contract

`useTransferActions.runAction` types `afterSuccess` as synchronous, calls it without `await`, closes the confirmation modal, and clears action loading. The device detail callback is asynchronous and returns `committed`, `superseded`, or `failed` only after device and share reads. Its promise and explicit outcome are discarded. The wallet callback is also asynchronous and currently swallows refresh failure. After a successful mutation, `fetchTransfers` catches a list-refresh failure and retains the old `transfers` array; `runAction` then closes the modal and clears loading, leaving the stale transfer card able to reopen the action and repeat the committed transition. Existing tests assert callback invocation but do not defer or fail the callback or attempt a second action after failed reconciliation.

## Phase 1: Own MCP access reads and mutations

### Production changes

- [x] Add hook-local request ownership for MCP refreshes so only the newest enabled refresh may write status, keys, users, form defaults, errors, and loading state.
- [x] Invalidate every pending key-list snapshot when a create or revoke succeeds before applying its functional key-state update.
- [x] Settle loading and error ownership when a mutation invalidates a pending refresh so the invalidated refresh cannot leave a spinner stuck or replace a newer error.
- [x] Preserve composition of concurrent successful mutations; do not discard a create merely because an unrelated revoke finishes later.
- [x] Fence late refresh writes after the MCP tab is disabled or the hook unmounts.
- [x] Keep the current public hook and tab API unless a smaller typed helper materially reduces branching.

### Regression tests

- [x] Start refresh A with an old key list, complete create B, resolve A last, and prove the created key remains visible.
- [x] Start refresh A with an active key, complete revoke B, resolve A last, and prove the revoked state remains visible.
- [x] Resolve refresh B before refresh A and prove B owns all refresh state and loading.
- [x] Disable the hook while a refresh is pending and prove the late result cannot repopulate tab state.
- [x] Preserve existing create, revoke, status, users, form-default, and error behavior.

### Verification and acceptance

- [x] `npx vitest run --config config/tooling/vitest.config.ts tests/components/AISettings/useMcpAccess.hook.test.tsx`
- [x] `npm run typecheck:app`
- [x] `npm run typecheck:tests`
- [x] Phase 1 acceptance: reverse completion cannot overwrite a newer refresh or successful key mutation, and successful concurrent mutations still compose.
- [ ] Deliver as one frontend PR and verify exact head and squash-merge target CI before Phase 2 starts.

### Phase 1 evidence

- Focused hook suite: 18 tests passed, including reverse completion, disable/re-enable, unmount settlement, rejected stale work, and concurrent mutation composition.
- Broad frontend suite: 656 files and 8,870 tests passed with 100% statements, branches, functions, and lines.
- Static render regression: 44 Chromium tests passed against the built `dist/` output.
- Type checks, build, lint, architecture boundaries, server cycle baseline, lizard, and large-file checks passed.
- Adversarial implementation reviews converged after correcting tab-transition refresh ownership and preserving in-flight one-time credential delivery.

## Between-phase reset

- [ ] Verify the Phase 1 merge commit is a real ancestor of refreshed `origin/main` and its exact target workflows are green.
- [ ] Re-read repository instructions and this plan from disk.
- [ ] Refresh open PRs and target SHA, then revalidate the transfer finding and its callers.
- [ ] Start Phase 2 from the refreshed target branch, not from the Phase 1 topic head.

## Phase 2: Await transfer ownership refreshes

### Contract changes

- [ ] Define one exported transfer-completion callback/result contract shared through `PendingTransfersPanel`, wallet access, and device access props.
- [ ] Allow synchronous callers only where compatibility requires it; ownership refresh callers must return an awaited promise.
- [ ] Treat `committed` as refreshed success and `superseded` as a benign result owned by a newer route/read.
- [ ] Treat `failed` or a rejected callback as a post-transfer refresh failure, distinct from a failed transfer mutation.

### Production changes

- [ ] Await the completion callback after the transfer mutation and before the transfer-list refresh while the initiating resource still owns the action.
- [ ] Separate the committed transfer mutation from both reconciliation steps: await the ownership callback, remove the committed transfer locally, then refresh the transfer list even when ownership refresh fails.
- [ ] Keep action loading active until the callback settles; recheck resource ownership after every await before writing UI state.
- [ ] Once the mutation commits, never leave its stale card actionable or present either reconciliation failure as a failed or retryable mutation. Close the completed confirmation, surface a bounded refresh-specific error, and keep that error renderable when no transfer cards remain.
- [ ] Return explicit outcomes from both wallet and device ownership refresh callbacks without duplicating share-info writes.
- [ ] Ensure route changes supersede all late callback, modal, error, and loading writes.

### Regression tests

- [ ] Return a deferred completion promise and prove loading remains active and the modal does not report completion before settlement.
- [ ] Resolve `committed` and prove normal completion closes the modal and clears loading.
- [ ] Resolve `superseded` after a resource change and prove no stale modal, error, or loading write reaches the new resource.
- [ ] Resolve `failed` and reject the callback in separate cases; prove the transfer is not retried or misreported as a failed mutation and the refresh-specific error remains visible with an empty transfer list.
- [ ] Let the transfer mutation succeed and the transfer-list refresh fail; prove the modal closes, the stale card cannot reopen or issue a second API action, and a reconciliation-specific error remains visible.
- [ ] Cover both wallet and device callback adapters or typed outcomes where their behavior differs.

### Verification and acceptance

- [ ] `npx vitest run --config config/tooling/vitest.config.ts tests/components/PendingTransfersPanel/useTransferActions.test.ts tests/components/PendingTransfersPanel.test.tsx`
- [ ] Run focused wallet/device hook and access-tab tests selected from changed callers.
- [ ] `npm run typecheck:app`
- [ ] `npm run typecheck:tests`
- [ ] Phase 2 acceptance: transfer completion never clears loading before the ownership refresh settles, every explicit outcome is handled, post-commit reconciliation failures cannot invite duplicate actions, and route supersession prevents stale writes.
- [ ] Deliver as one frontend PR and verify exact head and squash-merge target CI.

## Broad verification after each phase

- [ ] `npm run typecheck:all`
- [ ] `npm run test:run`
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `npm run check:architecture-boundaries`
- [ ] `npm run check:server-cycle-baseline`
- [ ] `npm run quality:lizard`
- [ ] `node scripts/quality/check-large-files.mjs`
- [ ] Run frontend coverage and preserve the 100% threshold for changed production branches.
- [ ] After building, serve `dist/` with a temporary static server and run the fully mocked Playwright render-regression suite through a throwaway config with no `webServer`; never start Vite or a host development server. Full backend-backed browser coverage remains an exact PR/target CI gate.
- [ ] Run an adversarial implementation review and the required simplify/edge-case review before delivery.

The changes are frontend-only and do not add an endpoint, so the Playwright API mock maps need no new entry. Exact PR and target CI remain mandatory in all cases.

## Compatibility, rollback, and cleanup

- API and persistence compatibility: no wire, schema, storage, cache, or migration changes.
- Concurrency: refresh ownership must distinguish read ordering from composable functional mutation updates; transfer callbacks must recheck resource ownership after awaiting.
- Rollback: revert the affected phase PR independently. Each phase begins and ends with a valid public UI contract.
- Cleanup: do not delete loop branches or the worktree without the exact one-off permission required by `AGENTS.md`. Keep the final deployment deferred until a later complete whole-repository scrub finds zero P0–P2 defects.

## Completion criteria

- [ ] All three findings have failing-before/passing-after behavioral regressions.
- [ ] Both phase PRs are merged serially and their exact target-branch workflows pass.
- [ ] The reviewed implementation plan revision and merge evidence are recorded in durable loop state.
- [ ] A fresh complete eight-domain scrub runs against the final target SHA; deployment occurs only after a zero P0–P2 pass.
