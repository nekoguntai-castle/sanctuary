# Iteration19 — preserve chat state across history and selection

Run bug-scrub-loop-20260920t1514z-whole-repo; locked whole repository; target main; source d409d408238e34428bdc6288c1e13b56d39488bc. Exact input to recursive-plan-review and implement-merge. Reuse outer active goal, nested rebuild_policy=defer. One coherent frontend phase, one protected PR and exact merge-push CI. No intermediate deployment.

## Evidence and scope

- P2 chat--late-history-overwrites-successful-send: controller history GET replaces messages after a successful same-conversation send. Real composer admits Enter while history pending. Two-case actual-component proof: history-first passes, history-last fails missing accepted response; coordinator independently reran it. No backend deletion claimed.
- P2 chat--same-selection-clears-state-without-reload: enabled selected sidebar row calls selectConversation, clears messages/input and sets loading; unchanged effect dependencies issue no replacement GET. Actual-component proof sees one GET, empty input, missing loaded response and indefinite spinner.
- Source/caller evidence: useChatTabController.ts45–67,104–133; ChatMessagePane.tsx; ChatInputComposer.tsx; ChatConversationList.tsx enabled selected button; Intelligence.tsx wallet-keyed parent does not guard same-conversation operations. Reports/proofs in ignored .tmp/iteration19-* and durable external archive.

Goal: preserve coherent current-conversation messages, typed text and loading/sending ownership. Preserve existing navigation, error recovery and API contracts. No backend, schema, migration, signing-policy, generic ownership-helper or visual redesign. P3 schedule, chart sampling and malformed fractional batch validation remain outside blocking fixes. Numeric draft overflow has only conditional mocked-persistence evidence and is not asserted as a confirmed P2.

## Phase1 — chat readiness and idempotent selection

- [x] Add registered behavioral regression contracts before production edits. Prefer a small new tests/components/IntelligenceTabs/chatReadiness.contracts.tsx imported by tests/components/Intelligence.tabs.test.tsx, sharing existing harness; keep test regions within complexity limits. Existing chatTab.contracts.tsx changes only where its old setup attempts sends before history readiness.
- [x] Prove pending history retains typed input, rejects keyboard Enter without API call and disables Send; complete history then submit retained input via keyboard and button controls, verifying accepted messages remain visible.
- [x] Prove history failure releases readiness and retains typed input; subsequent send works. Switching A→B while histories pending must keep B gated when stale A succeeds or rejects; only B settlement releases B.
- [x] Prove clicking active sidebar row preserves loaded messages and unsent input without another GET. Also cover same selection while history pending and while send pending, retaining original completion and sending ownership. Different conversation selection still clears old input/messages and rejects late old completions.
- [x] In useChatTabController.ts, make same-current-conversation selection a no-op before any reset or ownership change, using current selection dependency/appropriate existing state. Guard handleSend with loadingMessages and include readiness in callback dependencies. Preserve owner-only history finally/error handling and existing send failures/input restoration.
- [x] Pass loadingMessages through ChatMessagePane to ChatInputComposer; disable Send for pending history. Keep textarea editable so users can compose while waiting. Keep Shift+Enter behavior and empty-input/sending guards.
- [x] Adjust legacy tests to await real readiness before testing send retirement; do not weaken assertions or synthesize disabled-DOM bypasses. Keep actual UI regression paths.
- [x] Independent adversarial/reuse/edge review and coordinator full diff review. /simplify is unavailable here; perform its substantive reuse/quality/efficiency review explicitly. Resolve comments before freezing source.

Acceptance: both original failure paths prevented; typed text survives history wait/failure and repeated same selection; pending owners settle once; other conversation navigation retains existing behavior; registered tests discovered by normal runner. No policy for merging historical snapshots is introduced.

## Verification and delivery

- [x] Cheap preflight: Node24/npm12 from .nvmrc, existing dependencies/generated prerequisites, free bytes/inodes, exact source and owning test discovery. Do not launch services or touch live DB.
- [x] Focused: npm run test:run -- tests/components/Intelligence.tabs.test.tsx tests/components/Intelligence.test.tsx. Add relevant requestOwnership suite if implementation touches that helper (not planned).
- [x] Fresh full frontend: npm run test:coverage (normal complete configured suite,100% thresholds); npm run typecheck:app; npm run typecheck:tests; npm run typecheck:all; npm run build. No coverage exclusions or threshold changes.
- [x] Fresh Chromium render regression against built dist via static server and temporary Playwright config with no webServer. Never host npm dev/start/preview/Vite. Verify all configured render cases and stop exact owned static server afterward.
- [x] Run npm run lint:app, npm run check:architecture-boundaries and exact pinned npm run quality:lizard; affected architecture generation/diagram checks if selected by canonical quality workflow. Verify unchanged source after gates.
- [x] Backend previous full/unit100%/types receipts may be reused only after exact source/test/config/dependency-lock hashes and receipt hashes match current checkout, with limitations disclosed (historical runtime/generated artifact bytes are not retroactively proven). Any changed backend/shared/config/dependency input requires fresh owning guarded checks. No new DB pass claim from reused evidence.
- [ ] Refresh main and open PRs before delivery; rerun affected review/scrub if materially changed. Foreground normal commit hooks; no bypass. Commit/push owned branch only, open PR with concise problem/result/verification.
- [ ] All applicable exact-head workflows and non-render browser coverage required. If changed-path selection omits full browser, use supported exact-head full TestSuite dispatch with internally verified signed cleanup; static render does not replace real-auth browser gates. Record any detached receipt availability limitation explicitly.
- [ ] Fresh required statuses/protection/reviews/head/base; protected squash with delete_branch_after_merge=false. Verify real merge object, target ancestry and tested-tree equality, then exact merge-push workflows. No red/missing check bypass. Expensive failure requires identity, signature, new hypothesis and cheap discriminator before another attempt.
- [ ] Record plan immutable pin/head history, merge and target CI, then resolve both findings with attempt records. Update plan progress. Keep outer goal active.

No migrations or compatibility break. Rollback is a protected revert of this phase, restoring old chat defects; no data repair. Cache changes are local component state only. Caller goal owns exact approved branch/worktree cleanup, evidence archiving, full-scope rescrub and final-only original-stack rebuild/health/readiness verification. No destructive cleanup without required exact one-off authorization.

## Review

Round1: coordinator and two independent complete source-backed reviews converged at substantive blob f8e7c05391d9ca933626cc184f2d45c595f193d1 with no actionable comments. Readiness/error ownership, same-selection ordering and callback dependencies, registrar discovery, browser gate applicability, receipt reuse and cleanup boundaries checked. Rejected expansions: snapshot merging, generic ownership redesign and unrelated numeric/signing policy. Coordinator reread final plan; this record changes no requirements. Pin before production edits; requirement amendments need another complete review and new immutable pin.

## Local verification

Reviewed pin b2a86a99a6cc2d7545aaa5c1261b3dccf688b381. Eight registered real-UI regression cases failed before the fix,107 existing cases passed. Minimal three-file production fix plus new contracts/registrar and one legacy readiness setup correction now pass115focused tests. Initial assertions-pass run with an unhandled rejection was retained and rejected as verification; corrected test proves actual send admission before retiring it.

Frozen six-file diff independently and coordinator reviewed clean. Fresh full frontend682files/9230tests and100%coverage (26253statements,16688branches,7243functions,23914lines), app/tests/all typechecks, build,144Chromium render cases, lint, architecture/graphs/diagram checks and pinned complexity pass. Quality cleanup terminal no_op; static server stopped. Source hashes remain unchanged. Backend3065 selected input hashes and7historical receipt hashes reverified; the previously delivered planner-only shell difference is excluded from direct backend commands. Historical generated/runtime bytes remain unproven; no fresh DB or backend execution claimed.

Main remains d409d408; unrelated dependency PRs1296/1300 preserved. Foreground hooks, exact-head CI/full non-render browser, protected merge and target CI remain pending. Neither finding is resolved before verified delivery. Cleanup and final-only deployment remain outer-owned.
