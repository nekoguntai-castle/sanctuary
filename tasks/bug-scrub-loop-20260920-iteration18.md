# Bug scrub loop — iteration 18 remediation

Run `bug-scrub-loop-20260920t1514z-whole-repo`; whole repository; target `main`; source `7c51a686e8cfc9d7fb9aa126842261e2b2bc9d6d`. This exact plan is the input to recursive-plan-review and implement-merge. The outer goal remains active; nested rebuild_policy is defer. Three independent phases land serially through protected PRs with exact merge-push CI verification. No intermediate deployment.

## Evidence and objective

Complete coverage at this source is recorded in durable state, with eight inspected domains and no material inaccessible domain. Coverage is risk-based whole-repository sampling, not exhaustive line review. Shard reports, coordinator reconciliation and reproductions are archived outside the worktree. Current open PRs1300/1296 are unrelated.

- P2 `push-device--stale-owner-delete-after-reassignment`: authenticated A deletes a device while B re-registers the same token. Upsert preserves row ID and changes owner; A's read-before-unconditional-delete removes B's registration. Two isolated actual-router/actual-repository tests fail only the final B-survival assertion. No token theft or arbitrary takeover claim.
- P2 `account-twofactor--stale-status-after-navigation`: successful enable/disable changes only Account-local state. Persistent UserProvider retains the old flag, restored on route remount. Two actual Account/provider/router tests fail after Dashboard→Account navigation; backend truth and initial success UI are correct. No authentication bypass claim.
- P2 `local-test-plan--failed-diff-false-green`: absent 40-hex --since anchor survives rev-parse fallback; failed fetch is ignored and process-substitution diff failure is lost. Actual scripts/run-tests.sh emits Nothing to test and exits0. Valid HEAD..HEAD is a successful empty control. Protected CI scalar anchor verification is separate.

P3 `local-test-plan--schedule-explicit-base-not-full` stays backlog, explicitly outside this blocking fix set. No migrations, new endpoints, generic transaction/retry framework, authentication-policy changes, unrelated refactors or branch-protection changes.

## Phase 1 — atomic current-owner push deletion

Production: `server/src/repositories/pushDeviceRepository.ts`, `server/src/api/push.ts`. Preserve privileged internal/gateway deletion APIs and authority.

- [x] Tests first in `server/tests/unit/repositories/pushDeviceRepository.test.ts` and `server/tests/unit/api/push.test.ts`, with a focused separate actual-router/repository interleaving regression if useful. Carry both demonstrated race cases into durable CI-owned tests.
- [x] Add narrow repository methods deleting by identifier AND authenticated userId in one Prisma deleteMany predicate; return affected count. Do not authorize an unconditional mutation from a prior read. No process-local mutex or transaction required for a single conditional DELETE.
- [x] Unregister is always the existing success200 for missing/foreign/reassigned tokens. Device-by-ID returns existing404 if conditional deletion affects zero rows, success200 otherwise. Remove unnecessary ownership prereads, or retain only non-authoritative metadata reads; logs must not falsely report a removed device on count0 and never expose tokens.
- [x] Prove B registration succeeds before A deletion evaluates its predicate and B survives both paths. Exercise own deletion, missing/foreign owner, repeated unregister, zero-count device deletion and database-error propagation. Keep internal unconditional repository operations and callers unchanged.
- [x] Repository tests assert actual conditional Prisma arguments and affected count; route+repository tests use a model that evaluates those actual predicates, not a copied ownership decision. Existing integration repository tests stay compatible. SQL-specific transaction behavior is not claimed; this phase does not need a new database integration harness.

Acceptance: old owner cannot delete currently foreign registration; existing response contracts and privileged cleanup remain intact. Focused backend API/repository suites, backend production/test typechecks, full backend suite and literal `npx vitest run --coverage tests/unit`100% pass. Run lint/architecture/generated graph/CCN checks and foreground hooks. Frontend source/config/dependency-identical full suite/types/build/browser receipts may be reused only after explicit hash reconciliation; record reuse, not fresh execution.

## Phase 2 — canonical 2FA management state

Start from phase1's verified target. Production: `src/contexts/UserContext.tsx`, `src/contexts/userContextTypes.ts`, new `src/contexts/useUserTwoFactorActions.ts`, `src/contexts/useUserPreferenceMutation.ts`, `src/components/Account/Account.tsx`, `src/components/Account/Account/useTwoFactorController.ts`. Reuse current auth API and lifecycle ownership utilities.

- [ ] Tests first: durable real Account/provider/router enable and disable remount cases, plus focused provider ownership tests and existing Account controller suites. Do not replace the real provider with a context mock for navigation acceptance.
- [ ] Provider-owned enable/disable actions capture current authenticated identity and auth epoch before API admission. On accepted success patch only twoFactorEnabled through a functional updater, checking identity/epoch inside the updater. Provider lifetime ownership must reject completions after unmount/StrictMode cleanup. Retired responses return null and cannot deliver backup codes to a replacement session.
- [ ] Render Account from canonical user.twoFactorEnabled; remove the independent local enabled-state copy. Keep secrets, modal state, errors and loading local. Guard modified async UI continuations after unmount using existing ownership patterns. A still-current provider accepts a successful mutation even if Account navigated away. Do not toggle global auth isLoading during management, which would unmount the route.
- [ ] Preserve currentUser.twoFactorEnabled when merging preference responses: preference writes do not own this field, and delayed server snapshots must not reverse a committed management result. Login/bootstrap still hydrate current server truth. Do not expose an unrestricted user setter or refetch on every Account mount.
- [ ] Test accepted success after Account departure; failures preserve status and allow retry; current enable success shows backup codes; pending responses after logout, different-user login, same-user new session and provider unmount cannot change replacement state or expose codes. Test StrictMode ownership and a delayed preference response after 2FA success. Use a synchronous provider-level, session-scoped single-flight admission guard for enable/disable: a duplicate returns null without an API call, and only its owning request may clear admission. A new auth epoch must not inherit an old session's pending guard; stale completion cannot clear a newer guard. Do not use latest-request-wins to discard a successfully committed mutation merely because a remounted Account submitted another action. Add a real route-remount pending-duplicate regression, including original success and failure/retry. Avoid speculative cross-client consistency claims.
- [ ] Update typed context mocks/fixtures and all affected callers without loosening types or coverage. Check null/no-session behavior explicitly. Keep edited functions CCN<=15 and split responsibilities where needed.

Acceptance: both navigation directions retain committed 2FA truth, current-session completions remain useful after route departure, retired completions cannot affect another session, and preference completion cannot undo status. Run focused tests, root typecheck:app/typecheck:tests/typecheck:all, full frontend test:run and literal frontend coverage100%, build, and browser suites against built dist with static server and throwaway no-webServer config (no host Vite/dev/preview). Backend broad receipts may be reused only when exact relevant source/config/dependencies remain identical. Run lint/architecture/generated graphs/CCN and foreground hooks.

## Phase 3 — fail on unavailable comparisons

Start from phase2 verified target. Production `scripts/ci/plan-test-run.sh`; tests `tests/ci/plan-test-run.test.sh`, with a focused caller contract in the same owning suite if appropriate. `scripts/run-tests.sh` already propagates planner failures through set-e; modify only if tests prove necessary.

- [ ] Tests first for missing base/head, failed fetch, successful fetch that still leaves object absent, git diff nonzero with empty or partial output, and actual run-tests caller nonzero/no lane dispatch. Use bounded git stubs delegating unaffected calls to real Git; never fetch/mutate real shared refs in failure tests.
- [ ] Reverify each comparison anchor resolves to a commit after any permitted fetch. Fail nonzero with useful stderr before emitting plan JSON if it remains unavailable. Preserve valid local anchors without fetching.
- [ ] Capture diff synchronously and check status before classifying any paths. A failed diff, including partial stdout, cannot produce a valid successful plan. Preserve existing newline/path classification semantics; do not expand into unrelated filename-protocol redesign.
- [ ] Preserve valid empty comparison success, ordinary changed-file classification, --full, coverage/tier settings and unchanged lane dispatch. No automatic expensive full-suite fallback. Do not fix adjacent P3 schedule precedence in this phase.
- [ ] Run planner, run-lane, related-test-args and workflow-composition shell suites, shell syntax/ShellCheck and exact pinned complexity entrypoint. Verify the owning quality workflow invokes the regression suite. Repeat actual supported caller failure and valid-empty controls.

Acceptance: all lookup/diff failures are nonzero before valid plan output; caller cannot claim Nothing to test on those failures. App suites may reuse exact unchanged receipts with input hashes; run changed owning contracts and foreground hooks.

## Delivery, rollback and completion

- [ ] Recursive whole-plan review converges; pin immutable reviewed plan commit before production edits. Amendments require another complete review and new pin. Parent owns plan/state/final integration.
- [ ] Before each phase reserve branch in durable state, refresh target and open PRs, reconfirm source evidence and prevent topic overlap. Preserve five unrelated primary untracked files and unrelated worktrees/PRs.
- [ ] Independent adversarial/reuse/edge-case implementation review, parent diff review, smallest meaningful tests plus required broad gates, foreground commit hooks. No threshold waivers or hook bypass. Generated artifacts only from canonical commands.
- [ ] Serial PR delivery: exact-head required checks and applicable workflows/reviews green; protected squash with delete_branch_after_merge=false; actual merge object, main ancestry and tested-tree equality verified; exact merge-triggered target workflows green before resolving findings or incrementing attempts.
- [ ] Record immutable plan pin, heads, merge, CI and attempt evidence; settle sessions/agents before next phase. On expensive failure record exact identity, signature, new hypothesis and cheap discriminator before retry; old resource cleanup must be terminal.
- [ ] Archive evidence externally. Owned branch/worktree cleanup remains pending exact one-off destructive approval under AGENTS.md; no resource deletion inferred from merge. Keep this obligation visible rather than declaring resources cleaned.
- [ ] After all phases, reset context and run another complete current-main whole-repository scrub. Further confirmed P0-P2 require remediation. Only a clean pass plus owned cleanup and final deployment to the originally running relevant stack can close the goal.

Rollback uses separate protected revert PRs; no schema migration/data repair. Reverting a phase restores its known defect and requires reopening the finding. An already-deleted push registration needs normal client registration, not speculative restoration. A page reload can refresh old 2FA UI but is not the fix. Final deployment is an outer-owned crash-safe operation persisted before ./start.sh --rebuild, with exact build identity/health/readiness evidence. No stopped/unrelated stack is started.

## Review record

Round1: coordinator and three independent whole-plan/source reviews. Accepted one frontend comment: route departure resets local busy state, allowing a second management submission; pin provider session-scoped single-flight admission and regression coverage so a later failed request cannot suppress earlier committed success. Backend and infrastructure reviews found no actionable comments. Round2: coordinator and independent frontend reviewer reread the complete amended plan at blob f2210be6c8e7e0294ee02c776c69fabde3628829; no actionable comments remain. git diff --check passes. This record changes no implementation requirements. Pin this converged revision before production edits.

## Phase1 local progress

Implemented under immutable reviewed pin a88d978ce7986a2f14b92c0f54feab091faba122. Both tests-first ownership races failed before the fix; final71 focused tests/3files and backend production/test typechecks pass. Independent adversarial review of all seven changed blobs is clean. Lint, architecture boundaries, generated graph regeneration/diagram validation, pinned complexity gate and diff whitespace pass; graph regeneration has no tracked changes. Full backend suite passed727files/16578tests (66files/773tests skipped,1todo); literal-unit coverage passed100%: 41130statements,23207branches,8760functions,38308lines. Session11653 is terminal exit0. No database pass, delivery or resolution claimed. Unchanged frontend input/receipt hashes were reconciled for disclosed reuse.
