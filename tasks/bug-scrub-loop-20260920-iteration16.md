# Iteration 16: protect four settings owners from failed baseline reads

Run `bug-scrub-loop-20260920t1514z-whole-repo`; locked whole-repository scope, target main `2468409f08e89dafb259180dbc69681df71e4dbd`. The fresh eight-domain pass confirms four P2 findings and no P0/P1. All iteration15 phases are merged and their exact target CI passed. The existing outer goal owns completion; nested implement-merge receives this exact plan with `rebuild_policy: defer`. No iteration cap. P3 backlog remains outside the blocking set.

Goal: prevent a failed initial settings read from exposing writable substitutes that overwrite unread persisted values. Preserve successful absent-field/default configuration responses. Non-goals: backend/schema/API merge-policy changes, global mutation or loading frameworks, unrelated settings owners, or reversal of already accepted writes. Four independent owners will land through four serial protected PRs, with target CI verified after each.

## Prerequisites and evidence

- [x] Finish iteration15 protected delivery: PR1311 merge2468409 actual object/main ancestry/equal tested tree verified; PR19108–19112 and exact target19113–19117 all passed first attempt. Scheduled run19118 is separate, not a delivery retry; preserve its resources and investigate any concrete failure.
- [x] Refresh instructions, repository/worktree identity, main and open PRs; preserve unrelated resources. Fresh5,683-entry source inventory and backend/frontend/parent final-source checks completed on2468409. Four actual UI repros each failed at the intended assertion; no harness errors.
- [x] Reconcile every confirmed P0–P2 and append the complete eight-domain coverage manifest to durable state. All four below remain blocking; no other confirmed P0–P2 is omitted. Coverage uses risk sampling and explicit unchanged-source reuse, not exhaustive line inspection.
- [x] Recursively review this exact tracked plan to a complete clean pass; commit and pin its implementation revision before implementation. Phase1 branch is reserved before writes; reserve later phase branches before their writes. Parent alone integrates and delivers.

Four independently owned P2s are included below: Variables, Node configuration, Wallet Telegram and AI settings. At actual merge2468409, all four real UI reproductions were repeated and each failed at its intended preservation/admission assertion. Fresh inventory has5,683 tracked entries; final-source shard and parent artifacts retain exact identities and explicit fresh-read versus unchanged-source reuse. Complete coverage is appended in durable state; this plan now enters formal recursive review before implementation.

Phase1 confirmed P2: `system-variables--save-after-failed-settings-load`. At `src/components/Variables/useVariablesController.ts`, the initial GET error is discarded, while initialized thresholds1/3/546 render as ordinary editable settings. Save submits all three fields. The actual UI reproduction `.tmp/iteration16-variables-repro.test.tsx` seeds confirmation thresholds6/12, rejects GET, edits dust only and observes the unrelated persisted thresholds replaced with1/3. API update semantics accept supplied keys; confirmationThreshold affects minimum confirmations in UTXO selection. No funds-loss claim.

Counterevidence retained: all values are visible, an advanced-settings warning exists, and an existing test expects the page heading after load failure. None discloses an unavailable baseline or intentional reset. A successful response with missing/null fields deliberately uses defaults; preserve that separate contract. Supporting preparation: `.tmp/iteration16-variables-design.md`, `.tmp/iteration16-variables-adjudication.json`, and frontend/backend preparation inventories. Do not treat the already planned agent-create P2 as a new finding here.

## Phase 1: System Variables

One production/test owner per serial phase; parent alone owns plan/state/integration/commits/delivery. Each owner is independently mergeable in one protected PR. Phase1 production scope:

- `src/components/Variables/useVariablesController.ts`: narrow owned loader, load error and stable Retry, internal baseline readiness, save admission.
- `src/components/Variables/types.ts`: expose loadError and Retry; do not expose unused readiness state.
- `src/components/Variables.tsx`: existing loading view, then explicit load-error/Retry, otherwise known-baseline form. Reuse existing ErrorAlert and Button.
- Tests: `tests/components/Variables.test.tsx`; add `tests/components/Variables/loadOwnership.test.tsx` if isolation from existing timer/setup conventions is clearer.

Do not edit ThresholdsCard: the preferred view hides the editable form while baseline is unknown. Do not change generic useLoadingState/useLatestRequest, API adapters, settingsModel defaults/validation, backend schemas, VariablesWarning, other settings pages, or add a reset-all fallback.

- [x] Tests first: port the failed-read real UI proof. Assert contextual load failure, Retry, absent editable Save path and zero update calls. Capture a discriminating red log before production changes; do not mock Variables/controller/view primitives.
- [x] Replace only runLoad with a stable local async loader using existing useLatestRequest unchanged. Retain runSave for existing mutation feedback. On admission begin ownership, mark baseline not ready, set loading, clear load error. On current success resolveVariableThresholds and commit all thresholds plus readiness. Current failure records the error using existing extraction helpers and leaves readiness false. Only current finally clears loading; obsolete success/error/finally and unmounted work cannot publish state. No render/effect request loop.
- [x] Initial effect and Retry call the same loader. Reuse the helper's StrictMode-safe lifecycle; avoid layering a second ownership framework or generic loading hook finally around it. Newer reads supersede older ones.
- [x] Use a single save-admission predicate: return immediately when baselineReady is false. Do not add a redundant loading disjunct: admission already clears readiness until current successful read. Keep readiness internal unless a demonstrated view need arises. This guard is defense; the real UI proof is failure/retry/form behavior.
- [x] Variables renders loading while a read is pending, explicit contextual failure and Retry after failure, and the existing form only after success. No editable defaults after failed reads. Retry cannot itself enable Save before success. Keep current form validation, complete PUT payload and success/save-error semantics once loaded.
- [x] Independently reread source/tests for contract fidelity, minimal scope, stable callbacks, request ownership and meaningful branch coverage. Keep edited functions CCN<=15; use small named helpers only when needed.

## Behavioral test matrix

- [x] GET failure with persisted6/12: explicit failure/Retry, no spinbuttons or Save, no PUT. Repeated failed Retry remains non-editable and retryable.
- [x] Retry returns6/12 and known dust: real form displays server baseline; dust-only edit/Save preserves6/12 in outgoing payload. Deferred Retry keeps form/Save absent until settled.
- [x] Initial successful load retains loading UX; successful missing/null values still use supported1/3/546 defaults and can save.
- [x] StrictMode creates real overlapping initial reads. Deferred old success/error cannot replace a current baseline/error or clear newer loading. No synthetic hidden retry control or sleeps. Unmount retires pending local work.
- [x] Preserve current validation, API save failure/retry and success feedback tests. Update the old load-error test to assert the new explicit failure contract rather than only a heading.
- [x] A small direct controller test invokes Save while readiness is false and asserts zero PUT; label it admission defense, separate from user-path proof. Do not invent impossible state combinations to satisfy coverage.

Use API boundary mocks and real component/controller/input/Button paths. Reset mock implementations deliberately, especially rejected/deferred cases. Use real timers except existing bounded success-feedback tests; settle pending promises during cleanup. No DB, external API or emulator is required for these proofs.

## Phase 2: Node configuration

Accepted stable finding `node-config--save-after-failed-settings-load`. Primary GET failure installs writable DEFAULT_NODE_CONFIG; a later Save overwrites unread networks and can disable stored proxy settings. Detailed source design: .tmp/iteration16-node-telegram-design.md. Preserve successful backend first-setup defaults; no server change.

Owner files: src/components/NodeConfig/useNodeConfigData.ts and src/components/NodeConfig/NodeConfig.tsx. Existing useNodeConfigSave null-config admission guard already blocks unknown baseline; do not add redundant guards unless final source contradicts this. Failed primary read leaves config null and exposes loadError/Retry, not DEFAULT_NODE_CONFIG. Hide sections/Save until a successful baseline. Treat auxiliary Electrum/Tor/pool sources independently: tolerated auxiliary failures must not become baseline failures. Stable retry must preserve current initial-load behavior and prevent obsolete responses/finally from replacing a newer attempt; use existing lifetime/ownership mechanisms with minimal local adjustment, no generic loader rewrite.

- [x] Real component tests first: failed GET shows failure/Retry, no editable or Save controls; repeated failure remains blocked.
- [x] Retry returns nondefault host/network/custom URLs/proxy data; edit one field and assert unchanged unrelated payload fields. Deferred retry cannot admit save; successful first-setup default JSON remains editable.
- [x] Preserve existing configured saves/current errors and auxiliary-source tolerance. Exercise actual initial StrictMode overlap/unmount or newly admitted retry races without synthetic hidden controls.
- [ ] Implement only this owner, independent review, all phase gates, one protected PR and exact target CI before next phase.

## Phase 3: Wallet Telegram

Accepted stable finding `wallet-telegram--toggle-after-failed-settings-load`. Failed wallet GET retains default settings; enabling the wallet submits defaults that overwrite unread false notification preferences. Detailed design: .tmp/iteration16-node-telegram-design.md (its earlier pending-adjudication wording is historical; durable finding is now confirmed).

Owner files: src/components/WalletDetail/WalletTelegramSettings/useWalletTelegramSettingsController.ts, types.ts and WalletTelegramSettingsPage.tsx. Preserve the notifications-subtab caller and global Telegram availability notices; do not change wallet-role authorization. Distinguish primary loadError/Retry from existing save errors; hide toggles until a successful response. Preserve successful new-wallet defaults returned by backend. Guard toggle admission with one loaded-baseline predicate; do not duplicate an implied loading guard. Synchronize settingsRef and confirmedSettingsRef only from current successful load. Reuse current wallet/request ownership and preserve same-wallet optimistic ordering, rollback, saving and success-timer behavior. No server PATCH changes or wholesale concurrency rewrite.

- [x] Real component tests first: globally configured Telegram, stored disabled wallet with false notification preferences, failedGET -> explicit failure/Retry and no toggles/mutation.
- [x] Retry success then Enable preserves untouched false fields; repeated failure/deferred retry stays blocked. Successful backend defaults for new wallet still enable/save.
- [x] Test wallet switch/ABA/unmount retirement and retry settlement against existing ownership. Preserve unavailable-global notices and existing optimistic-save failure rollback.
- [ ] Implement narrowly, independent review, complete phase gates, one protected PR and exact target CI before next phase.

## Phase 4: AI settings

Accepted stable finding `ai-settings--save-after-failed-settings-load`. Actual real UI reproduction proves rejected bootstrap -> Enable modal/toggle -> Settings/save replaces unread provider array. Backend explicitly replaces supplied profile arrays. Detailed pinned preparation design: .tmp/iteration16-ai-design.md. No credential-loss claim.

Owner files: src/components/AISettings/hooks/useAISettingsBootstrap.ts, hooks/useAISettings.ts, types.ts and AISettings.tsx. Bootstrap owns new load-error/retry behavior; keep near-limit492line useAISettings owner below500 via existing bootstrap extraction/state ownership, not unrelated refactoring. Loading -> existing feature-unavailable -> explicit primary load-error/Retry -> normal page. All normal toggle/modal/settings/detect mutation controls remain inaccessible until baseline success. No useAIFeatureToggle policy change or redundant per-handler checks for inaccessible controls. Include loadError in MCP activation predicate if needed to prevent an already selected tab activating against failure.

- [x] Tests first using actual AISettings and stable API-boundary harness: failed primaryGET shows Retry/no Enable/save/detect controls and makes no PUT; repeated/deferred retry stays gated.
- [x] Retry returns multiple existing profiles; real enable/settings/endpoint/save keeps untouched profile IDs. Preserve successful legacy/default-profile normalization and existing configured flows.
- [x] Preserve feature-disabled/flags403 unavailable handling and non403 flags-fetch fallback. Optional model-discovery errors remain model feedback, not failed primary baseline.
- [x] Extend existing bootstrap effect lifetime for retry; stable retry generation plus active cleanup is sufficient. Guard obsolete post-await commits, preserve StrictMode/unmount, and avoid extra generic ownership machinery. Test genuine StrictMode overlaps.
- [ ] Independent source/test review, phase gates, one protected PR and exact target CI. No backend/schema or unrelated settings mutation changes.

## Verification per phase

Use nvm Node from .nvmrc and configured scripts. Resolve existing test filenames/subtrees at preflight; invoke the relevant phase selection below, not all independent phase suites unnecessarily. Implementation owner runs focused checks, then stops writes for parent integration:

```bash
npm run test:run -- tests/components/Variables.test.tsx tests/components/Variables tests/hooks/useLatestRequest.test.tsx
npm run test:run -- tests/components/NodeConfig.test.tsx tests/components/NodeConfig.branches.test.tsx tests/components/NodeConfig.interactions.test.tsx tests/components/NodeConfig.secondpass.test.tsx tests/components/NodeConfig
npm run test:run -- tests/components/WalletDetail/WalletTelegramSettings.test.tsx tests/components/WalletDetail/useWalletTelegramSettingsController.test.tsx
npm run test:run -- tests/components/AISettings.test.tsx tests/components/AISettings tests/components/AISettings.logic.test.tsx
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
```

Parent runs full frontend test suite and literal100% coverage, production build, app/server lint as required, architecture boundaries/cycles/generated graphs/index, diagram validation and complexity gates. Preserve behavioral coverage rather than adding coverage ignores. Compare backend/shared/gateway/dependency/config identities with verified baselines before reusing their gates; rerun relevant checks for any actual changes.

Run Chromium `tests/e2e/render-regression.spec.ts` against built dist using an owned static server and ignored Playwright config without webServer. No host dev/preview servers or live seeded wallet suites. Additional Variables browser proof, if selected, must mock APIs and preserve actual authentication prerequisites; parent owns browser/diagram integration separately. Stop only that owned static server.

Record exact commands/counts, red/green evidence, source/test hashes and review disposition under ignored artifacts and then the selected plan/state after actual results. Avoid temporary Vitest configs that merge include arrays and accidentally run broad suites. No gate is complete merely because this draft lists it.

## Delivery, rollback and continuation

- [ ] Parent refreshes main and open PRs, pins reviewed implementation head, commits/pushes through pr-delivery and opens one protected PR per phase. Wait all required checks/reviews; address verified issues with focused verification and renewed review.
- [ ] Merge exact reviewed head with branch deletion disabled; verify real merge object, main ancestry and tested-tree equality. Verify all exact target-push workflows before recording the finding resolved/delivered.
- [ ] Return full evidence to the existing outer goal. Do not declare a clean loop from this fix: perform a new complete whole-repository scrub at final main; any confirmed P0–P2 requires another reviewed complete plan.

Each phase can be rolled back independently through a protected revert PR, with no migration. It restores masked-read write behavior and cannot undo settings already accepted by the server. Preserve owned resources/evidence until cleanup provenance and exact one-off destructive authorization are satisfied. Final cleanup and deferred crash-safe deployment remain outer-loop obligations; do not start a stopped stack or deploy this intermediate phase. No final clean result is asserted.


## Review and completion record

- [x] Exact-file recursive review converged; pin reviewed revision before production changes.
- [x] Phase1 Variables merged; actual merge and exact target CI verified.
- [x] Phase2 Node configuration merged; actual merge and exact target CI verified.
- [x] Phase3 Wallet Telegram merged; actual merge and exact target CI verified.
- [x] Phase4 AI settings merged; actual merge and exact target CI verified.
- [x] Return delivery evidence to the outer loop for a fresh full-repository scrub. Owned cleanup and final deferred deployment remain outer closeout requirements.


Formal review: two complete clean passes (coordinator and independent source-backed reviewer). No verified actionable comments remained. Rejected expansions were generic loader/mutation frameworks, backend merge-policy changes, redundant implied loading guards, inaccessible-handler synthetic tests, and unrelated async-save changes. Existing test filenames and manifest production paths verified; git diff --check passed. Scope remains the four confirmed owners.


## Phase1 implementation verification

Three production files now retain an unknown-baseline gate until a current successful settings read, expose contextual failure/Retry, and prevent Save without readiness. Existing defaults, validation and runSave behavior remain. Twelve new behavioral cases plus the updated old load-error expectation: initial seven red failures, then an additional empty-error failure identified during review and fixed with a null-sentinel view check. Final focused47/3files and app/tests/all typechecks passed. Full frontend9,160/677files passed with100% coverage:26,147statements,16,618branches,7,228functions,23,832lines; the changed Variables view and controller are both included and100%. Build10.56s,144staticChromium render tests50.5s, app/server lint, architecture boundaries/cycles/graphs/index, diagram lint and lizard passed. Owned static server stopped; quality cleanup receipt no_op/success.

Independent implementation/reuse review clean at controller `38d2f718232ae8fd36d8cebe0b014131db496d6c`, view `5ec9d3f3c9b996fc1a26b65e2943ef681da51ef4`, types `b611aaf854994510fd576336afcf497ba755365e`, new tests `f9184cf9a65320cabc17c4adb306a699a95c0a18` and updated existing tests `25c140f90d9c797106e0da3a2ff0343cf7153cc1`. Backend/shared/dependency/tooling identities remain unchanged from verified6004978 baseline; exact target2468409 and separate scheduled19118 passed. Protected serial delivery pending under reviewed revision `4b9f164e9c133d3b8a3e284742deb8c0df526a6f`.

Commit-hook documentation feedback addressed with two comments explaining the baseline guard and existing loading/Retry feedback. Controller final blob `e8e221b9a8e185da36692e27e16a64e25b90a33a`; executable behavior and test inputs are unchanged from the fully verified revision.

Phase1 delivered as PR1312, head `384b0f85fdc3b24a762904cdfb3bfb25c192f0be`, squash merge `12359c8021def33c677edf9677f3539a51808031`. Actual commit/main ancestry/tested-tree equality verified; PR19119–19123 and exact merge-push19124–19128 all passed first attempt. Finding resolved, attempt1, reviewed plan4b9f164 retained. Owned cleanup and final deployment remain deferred outer obligations. Phase2 begins from verified12359c; relevant owner/test/backend sources unchanged from accepted evidence.

## Phase2 implementation verification

Node loader/view now retain null configuration after a failed primary read and expose contextual error/Retry before normal controls. Existing null-config save guard, successful first-setup defaults and auxiliary tolerance remain unchanged. Eleven new real UI/lifecycle cases plus updated old failure expectation: red4fail/78pass, then focused82/9files and app/tests/all typechecks pass. Independent adversarial/reuse review clean at data `57712e639770be74d017b63cb506a8c9ecb18ed4`, view `bf2067be2468dad562f302bab7dcb7f54dc3de41`, existing tests `e08135c745562ed7ad63f2a35c4e22d8c90cf9dc`, new tests `e2ee11ca3aebb1c5e9608859f3a2fe8437a49e03`. Broad verification passed:9,171frontend tests/678files,100%coverage26,160statements/16,626branches/7,228functions/23,843lines; both changed executable files included and100%. Build5.53s,144Chromium render tests, app/server lint, architecture boundaries/cycles/graphs/index/diagram validation and lizard passed. Static server stopped; quality receipt no_op/success. Delivery pending under exact reviewed plan4b9f164.

Phase2 delivered as PR1313, head `30b52bcdf55997d9b9c26deb60f1a7328a5c0633`, squash merge `ba89ad1e1cf1769922be581f5e7148d4bef2f5bb`. Actual commit/main ancestry/tested-tree equality verified; PR19131–19135 and exact merge-push19136–19140 all passed first attempt. Finding resolved, attempt1, reviewed plan4b9f164 retained. Owned cleanup and final deployment remain deferred outer obligations. Phase3 begins from verifiedba89ad; relevant owner/test/backend sources unchanged from accepted evidence.

## Phase3 implementation verification

Wallet Telegram primary-read failures now retain a baseline gate with contextual error/Retry; successful retry initializes optimistic and confirmed settings before toggles are admitted. Global notices, backend defaults and existing optimistic save/rollback behavior remain. Tests-first red3fail/23pass; final focused29/3files with15new cases and app/tests/all typechecks pass. Independent adversarial/reuse review clean at controller `ace0e7a3cfdd8b66a62dcf8416e1eb25c97ddc7d`, page `32393e2cf045f5b466cfe28d1bba73178f024e5a`, types `ed3beba2fba82c9a33324263f6010d841a32972b`, newtests `b934b8924780ef4d19a8e136c30a6aca7ec0a88f`. Full frontend coverage100%:26,178statements/16,632branches/7,230functions/23,859lines; both changed executable files included and100%. Build7.14s,144Chromium render tests1.1m, app/server lint, architecture boundaries/cycles/generated graphs/index/diagram validation and lizard passed. Owned static server stopped; quality cleanup receipt no_op/success. Protected delivery pending under exact reviewed plan4b9f164; no deployment performed.

Phase3 delivered as PR1314, head `14c24d007d8890ac4aa88b99b8e91fe0bd3b5b17`, squash merge `1bb115809135e1e479a3ab6dadfdbc6377b63f23`. Actual commit/main ancestry/tested-tree equality verified; PR19141–19145 and exact merge-push19146–19150 all passed first attempt. Finding resolved, attempt1, reviewed plan4b9f164 retained. Final controller `faad98a83be604cadedb94630fdf6d3fa02976c6` adds only two reviewed explanatory comments after local gates; amend hooks reran9,186tests successfully. Phase4 begins from verified1bb1158; relevant source/tests unchanged from accepted evidence. Owned cleanup and final deployment remain outer obligations.

## Phase4 implementation verification

AI primary settings reads now expose contextual failure/Retry before normal mutation controls. Existing effect lifetime retires obsolete flag/primary responses; successful retry retains recovered provider profiles. Feature availability and optional model discovery remain distinct from primary-read failure. Tests-first5expectedfail/163pass; final focused168/13files(new9), app/tests/all typechecks pass. Independent adversarial/reuse review clean: bootstrap `314a548db9dfc126e8b36b27a8aeedbb56deab27`, controller `e6824a28f491f1c87cc59030274f72ca34b079f5` (494lines), view `2a0b75a99620bb26a5431060ab802622ca3c8359`, types `04cc10625d91d1af879e51a77c24cb0f3a4b09e3`. Full frontend9,195tests/680files passed with100%coverage26,193statements/16,639branches/7,232functions/23,872lines; all3changed executable files included and100%. Build6.64s,144Chromium render tests1.2m, lint/boundaries/cycles/graphs/index/diagram/complexity checks passed. One expected generated errorHandler graph edge reviewed; static server stopped; quality cleanup no_op/success. Protected delivery pending under exact reviewed plan4b9f164; cleanup/deployment remain outer obligations.

Phase4 delivered as PR1315, head `35202de5a16027844dd779dcc8eb1b8e0eadff9b`, squash merge `ef70e322c9df9d6d2ee2245b4e5a99cdffba56b6`. Actual commit/main ancestry/tested-tree equality verified; PR19152–19156 and exact merge-push19157–19161 all passed first attempt. Finding resolved, attempt1, reviewed plan4b9f164 retained. Iteration17 fresh complete eight-domain whole-repository scrub found three distinct P2 issues (atomic admin settings and two local test-runner defects), with no recurrence of these four fixes;310focused repaired-seam tests passed. Next exact plan is tasks/bug-scrub-loop-20260920-iteration17.md. Owned cleanup and final deployment remain outer-loop obligations.
