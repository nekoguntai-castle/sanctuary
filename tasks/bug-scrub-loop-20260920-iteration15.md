# Iteration 15: retire departed creation flows without undoing accepted mutations

Run `bug-scrub-loop-20260920t1514z-whole-repo`; locked whole-repository scope, target main `4467e96e11ea914a0239d54f1fa4b7d053fd0747`. Fresh eight-domain scrub confirms three P2 findings below. PR1308 actual merge and all five exact target-push workflows19083–19087 passed. The existing outer goal owns completion; nested implement-merge receives this exact plan and `rebuild_policy: defer`. No iteration cap. P3 backlog is outside this blocking fix set.

Goal: retire obsolete UI continuations in three creation controllers while preserving accepted mutations and application-wide cache effects. Non-goals: server cancellation/rollback, backend/schema/auth changes, general admin-action refactoring, or global navigation interception.

## Accepted scope and evidence

Merged-source revalidation: main `4467e96e11ea914a0239d54f1fa4b7d053fd0747` has the exact tested PR tree. Fresh 5,679-entry inventory and both domain shards are archived in `iteration15-source-inventory.json`, `iteration15-backend-final-prep.json`, and `iteration15-frontend-final-prep.json`; all five UI repros were repeated with the same expected failures. The repaired RBF focused suite passed 71 tests. Eight-domain coverage pass is appended in durable state after exact target CI completed.

Original evidence was gathered at PR1308 head `1f5b8562543e94f47c48f6283e60a6155ef6ff52` and all five repros were reconfirmed at the tree-identical main merge above. Three accepted P2s, separate controller boundaries:

1. `create-wallet--late-navigation-after-exit`: `src/components/CreateWallet/useCreateWalletController.ts:157-171`; actual wizard submission, three Back clicks then Cancel, deferred API response steals route. One expected-failing real component/real React Query/real router test: `.tmp/iteration15-createwallet-repro.test.tsx` and matching config/log.
2. `connect-device--late-navigation-after-exit`: `src/hooks/useDeviceSave.ts:94-109,133-142`; actual SD import/Save Device or conflict Merge then browser Back. Created, automatic-merge and explicit-merge success all steal route. Three expected-failing real component/controller/router tests: `.tmp/iteration15-devicesave-repro.test.tsx` and matching config/log. Sidebar refresh is asserted to run on accepted success.
3. `agent-create--late-navigation-after-exit`: `src/components/AgentManagement/index.tsx:165-170`; actual Add Agent Wallet modal submission then browser Back. Create and subsequent list reload finish, redirecting to `/admin/agent-wallets`. One expected-failing actual modal/router test: `.tmp/iteration15-agentcreate-repro.test.tsx` and matching config/log.

No programmatic hook action creates these paths. Whole-app AppRoutes loading reads UserContext and these mutations do not alter authentication loading. Route definitions directly mount the affected flows. This is distinct from the withdrawn auth cancellation finding: pending auth verification removes Login before another normal user event.

Read inventories/rejections in `.tmp/iteration15-frontend-prep.json` and `.tmp/iteration15-navigation-pattern-audit.json`. Same-pattern enumeration found guarded RBF, ImportWallet, send draft/broadcast, device/wallet deletion and transfer handlers. Synchronous links and notification-panel close-then-zero-timeout navigation are intentionally user-directed, not deferred mutation results. Do not expand these phases into them.

Contract: accepted wallet/device/account/agent mutations persist. Application-scoped query invalidation/sidebar refresh remains. The retired UI cannot navigate, display obsolete conflict/error state, run local completion notifications or clear a newer operation's busy state. No abort/delete/revert of accepted server work. No backend/schema/query-factory/auth/import change.

## Phase 0: lock and review

- [x] Refresh instructions, target/head/tree, worktree and PRs; source revalidated and all five actual UI proofs rerun at exact merged main. Primary main fast-forwarded preserving five unrelated untracked files; owned cleanup remains deferred for exact one-off user authorization.
- [x] Complete whole-repository eight-domain fresh scrub; three confirmed P2 findings are the complete blocking set. Coverage is risk-based sampling plus explicitly reconfirmed unchanged-source inspections, not exhaustive line review.
- [x] Persist and recursively review this exact plan to clean. Phase1 branch reserved in durable state; record reviewed commit before implementation. Later phase branches are reserved before their writes. Parent alone integrates and commits.

## Phase 1: create-wallet owner

Sole production file: `src/components/CreateWallet/useCreateWalletController.ts`. New focused test `tests/components/CreateWallet/ownership.test.tsx`; existing `tests/components/CreateWallet.test.tsx` and subtree only as needed. Reuse `src/hooks/useLatestRequest.ts` unchanged. Preserve component interfaces.

- [x] Tests first: port actual wizard Back/Cancel late-result proof. Add pending success/error after route exit, current success/error/retry, StrictMode replay, and actual Back-to-earlier-step result retirement while still mounted. Preserve real query mutation hook so accepted query invalidation is asserted. Log red before code.
- [x] Back is explicit abandonment of the current review. Invalidate its UI action before stepping backward, clear local submitting flag and retain existing editable data. The pending server request remains accepted work; do not merely disable Back (browser/sidebar exit still exists).
- [x] SidebarNetworkSelector is independently available during wallet creation. Existing controller resets signers/step when selectedNetwork changes. Invalidate action generation synchronously on that identity change, clear obsolete busy state, preserve existing signer-reset behavior. Cover network A -> B -> A where reachable via real provider/context changes. Payload remains captured at admission; do not claim or implement a new server network policy.
- [x] Capture existing helper operation token on submit; guard local navigate, error handler/logging and finally. Current successful flow still navigates once. New operation supersedes prior token; retained stale handlers must not admit API work if their render scope was retired. Keep implementation local and CCN<=15.
- [x] Focused verification, typechecks, independent production/tests review and full phase gates before serial delivery.

## Phase 2: device-save owner

Sole production file: `src/hooks/useDeviceSave.ts`. Actual caller: `ConnectDevice -> useConnectDeviceController -> useDeviceForm -> saveDevice/mergeDevice`. New focused integration-style unit suite `tests/components/ConnectDevice/saveOwnership.test.tsx`; existing `tests/hooks/useDeviceSave.test.tsx`, `tests/hooks/useDeviceSave.branches.test.tsx` only if expectations change. No form/QR/USB/parser/view interface edits.

Pinned caller semantics from current source:

- `useDeviceForm.ts:163-173` invokes stable `resetSave` in its selected-model effect. Model cards remain enabled during save. `reset()` therefore retires outstanding local save/merge continuations before clearing all existing state. The effect also runs on initial mount/StrictMode replay, which must not permanently disable later saves.
- Method selection at `useDeviceForm.ts:302-310` resets QR/USB/scanned fields but does **not** invoke `resetSave`; do not misdescribe this as existing save retirement. This phase does not add a method/input snapshot policy or alter method selection. Confirmed root scope is route lifetime plus existing explicit save reset/conflict dismissal and latest-operation ownership.
- `ConflictDialogActions.tsx` disables only the Merge button while merging. Cancel and View Existing Device remain enabled. Cancel calls `save.clearConflict`; View Existing navigates and unmounts. Thus Cancel must retire the pending merge's local effects even while ConnectDevice stays mounted; View Existing is covered by unmount ownership. Preserve those enabled controls.
- `useDeviceSave` is used only by this ConnectDevice controller. `clearError` only acknowledges an error; it must not invalidate an otherwise current operation. `reset` and `clearConflict` remain stable useCallback functions so the form's reset effect does not loop.

Implementation is pinned:

- [ ] Tests first: port all three actual ConnectDevice SD/UI/router proof outcomes (created, auto-merged, manual conflict-merge), asserting accepted sidebar refresh remains and final route stays chosen. Add current created/merged/conflict/error flows, retired errors/finally, StrictMode. Stabilize stub adapter identities; mock API/parser/unused hardware dependencies without replacing affected form/save/navigation owners. Capture red log.
- [ ] Add actual pending-merge Cancel regression: dialog disappears immediately; merging and saving are false; later accepted merge refreshes sidebar but never navigates/reopens conflict/shows an obsolete error. Add model-switch reset retirement through real model selection. Include a reachable supersession sequence: start merge, Cancel, start new save; old result/finally cannot clear new save busy state. No invented direct hook-only cancellation contract.
- [ ] Reuse one `useLatestRequest` owner shared by save and merge. A small `beginOperation(kind)` begins a token and sets **both** flags atomically for the new operation (`saving = kind === save`, `merging = kind === merge`) plus existing error clearing. Save still clears previous conflict at admission; merge retains the visible conflict while pending. A current-only finish helper clears both flags; retired finally does nothing. This prevents stranded opposite-operation flags when latest operation supersedes an older operation.
- [ ] A stable local retirement helper invalidates the owner and sets both busy flags false. `reset()` calls it before clearing error/conflict as today. `clearConflict()` calls it before clearing conflict, preserving its existing error policy (do not introduce an unrelated error-clear behavior). Both callbacks include only stable helper dependencies. Unmount invalidation comes from existing `useLatestRequest`, not a second lifecycle framework.
- [ ] For accepted created/merged results, preserve existing application-level success logging and always call `refreshSidebar()` even when the local owner retired. Recheck ownership **after** refreshSidebar before navigation, since that callback can synchronously retire/reenter the owner. This applies to created, automatic merge, and explicit merge. Do not let an early current-owner return suppress required sidebar refresh.
- [ ] Conflict result is local UI: only a current owner may log/display conflict. Catch errors and local error state are current-only; finally is current-only as above. Current success destinations and error messages remain unchanged. Keep each function CCN<=15; extract small result-specific helpers if needed, without a generic framework.
- [ ] Do not cancel accepted device creation, undo account merge, add global navigation interception or edit caller form behavior. Run focused hook/component tests, types and phase-wide gates; independent review verifies all busy transitions, reset/Cancel reachability, current/retired refresh semantics and source/test fidelity before serial delivery.

## Phase 3: agent creation owner

Production boundary `src/components/AgentManagement/index.tsx`: dedicated create handler, narrowly guarded local load helper, and its direct Retry wrapper. New focused suite `tests/components/AgentManagement/createOwnership.test.tsx`; existing `tests/components/AgentManagement.test.tsx` only as necessary. No broad admin-action/framework refactor.

Pinned policy and design from independent backend reviewer:

- [ ] Tests first: port actual AgentFormModal/wizard/browser-Back proof. Delay create and separately delay its subsequent reload. Leaving at either boundary prevents navigation and obsolete create-local busy/error/state effects. Current create -> reload -> navigation still works. Cover current failures/retry and StrictMode; capture red evidence.
- [ ] Capture a create-operation token from existing `useLatestRequest`. Retire only on component unmount or a newer create operation. Closing the modal with Close/backdrop/Escape while the page remains mounted does **not** cancel accepted creation or retire this page-owned continuation: explicitly test that current accepted creation still reloads and navigates. Do not add cancellation from modal dismissal.
- [ ] Replace only `handleCreateAgent`'s `runAction` wrapper with a dedicated create handler whose busy/error/catch/finally commits check create ownership. Leave `runAction` and unrelated update/key/revoke/override callers unchanged. Check current ownership after awaited create before closing the modal or starting reload; check it again after reload before navigate. Accepted server create is never undone.
- [ ] Give local `loadData` an optional current-owner predicate with default `() => true`, preserving all existing ordinary callers. Check the predicate before local start state and after await before agents/options/error/finally commits. The create handler passes its captured token predicate. Keep reload request semantics unchanged once admitted; do not cancel accepted mutation or expand into a global fetch framework.
- [ ] Existing Retry passes `loadData` directly as an onClick handler: change it to `onClick={() => { void loadData(); }}` so a React event is never treated as the optional ownership predicate. Verify Retry remains functional.
- [ ] Preserve current reload failure semantics: `loadData` catches its errors, and an active successful create still navigates after a failed reload. Test current reload rejection and departed reload rejection separately; do not accidentally change swallowed reload failures into creation failure or skip current navigation. Guard departed local error/finally without logging/notification policy expansion.
- [ ] New create supersedes prior create's local ownership. Test that old create/reload/finally cannot overwrite a newer action's owned state where actual modal reopen/new submission admits it. Keep CCN<=15 with only small named local helpers as needed. Independent review, focused/types and full phase gates before serial delivery.

### Agent busy-state boundary refinement

- [ ] A pending create can coexist with a later non-create action after same-page modal Close: AgentRow disables only revoked agents, not other busy actions. Keep the dedicated create owner, and in its current-only finally clear busy state only if it still equals `create-agent` (`setBusyAction(current => current === 'create-agent' ? null : current)`). Do not clear a later update/revoke/key action. Add a real UI test that submits create, closes its modal, starts another action, rejects create, and verifies the later action remains busy. This bounds create cleanup without claiming general cross-action ownership or modifying `runAction`.

## Verification and gates per phase

Use nvm Node from `.nvmrc` and configured scripts. Exact focused commands (new files become real in their phase):

```bash
npm run test:run -- tests/components/CreateWallet.test.tsx tests/components/CreateWallet tests/hooks/useLatestRequest.test.tsx
npm run test:run -- tests/hooks/useDeviceSave.test.tsx tests/hooks/useDeviceSave.branches.test.tsx tests/components/ConnectDevice.test.tsx tests/components/ConnectDevice tests/hooks/useLatestRequest.test.tsx
npm run test:run -- tests/components/AgentManagement.test.tsx tests/components/AgentManagement tests/components/AgentManagement.extracted.branches.test.tsx
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
```

Parent runs full frontend `npm run test:run`, literal100% `npm run test:coverage`, `npm run build`, app lint, required architecture/cycle/complexity/diagram gates for each deliverable phase. Add meaningful branch tests; no coverage ignores. Reuse backend/shared/dependency checks only with exact unchanged-source evidence from verified baseline; rerun relevant gates when source/config/dependencies change. Recheck required architecture generated artifacts and plan completeness before commit.

Built-dist static Chromium `tests/e2e/render-regression.spec.ts` via owned static server/ignored Playwright config (no webServer) verifies real render surfaces. The actual UI+MemoryRouter suites are direct delayed-navigation proofs. Do not run live seeded `tests/e2e/wallet.spec.ts` on static dist. Additional browser regressions must explicitly mock APIs and preserve real authentication/route preconditions. Parent owns browser/diagram integration, separate from production/unit owner.

Only declare gates after captured passing evidence and exact counts/SHA. Existing ignored repro configs override test.include directly; never merge include arrays and accidentally invoke full suites. No DB is needed for these frontend unit proofs.

## Serial delivery, rollback, continuation

Parent owns docs/state/integration/commit/push via pr-delivery. Each phase is a protected PR with exact reviewed head pin, required CI/review completion, exact-head merge, actual merge/tree/ancestry verification and exact target-push CI before next phase delivery. Do not batch independent owners into an unreviewed rewrite. Runtime deployment remains deferred under caller policy; do not start/alter service containers.

Rollback is a protected revert PR for the relevant phase. It needs no schema/cache migration and reintroduces that owner's late-navigation defect. Revert cannot undo accepted wallets/devices/accounts/agents. Cleanup only proven owned branch/worktree resources after target CI under caller provenance; preserve ignored evidence as needed. After all phases and target checks, fresh whole-repository scrub at final merged SHA decides continuation; this bounded pattern audit cannot conclude the loop by itself.

## Review and completion record

- [x] Recursive exact-file review converged: coordinator and independent source-backed passes found no remaining actionable comments. Commit and pin this reviewed revision before implementation.
- [ ] Phase1 merged, actual merge verified, exact target CI passed.
- [ ] Phase2 merged, actual merge verified, exact target CI passed.
- [ ] Phase3 merged, actual merge verified, exact target CI passed.
- [ ] Return delivery evidence to outer loop; fresh whole-repository rescrub, exact authorized cleanup and final deployment remain outer closeout requirements.

Formal review: two complete clean passes. Preparatory source-backed corrections pinned device reset/Cancel and shared busy flags, agent dedicated create/load predicate/Retry behavior, preserved same-page modal close and reload-error behavior, and create-only busy-key cleanup. No unrelated action refactor or accepted mutation rollback. `git diff --check` passed.

## Phase1 implementation verification

Controller-only ownership fix plus16 new regression cases. Tests first:10failed/3passed before production change; final focused70passed across8files. Full frontend9,118tests/674files passed; coverage100% statements26,103, branches16,594, functions7,224 and lines23,798. App/tests/all typechecks, build, lint app/server, architecture boundaries/cycles/graphs/index, diagram lint and lizard gate passed. All144 static-build Chromium render tests passed; initial CLI file/project ordering error launched zero tests and was corrected. Owned static server stopped. Independent implementation/simplification review clean at production blob `388ce73793ad6de1201a10d5ec68f1609ad8d04a`, tests `682e4abfc97f1c61c90ade0f212bbdc87864e96a`. Backend/shared/gateway/dependencies/config identities match verified6004978 baseline (16,535 backend tests and unit100% coverage), with subsequent targetCIgreen. Protected delivery pending.
