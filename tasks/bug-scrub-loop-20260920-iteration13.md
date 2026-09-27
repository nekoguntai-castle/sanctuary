# Bug scrub loop iteration 13: persisted vote state and active UI operations

Run: `bug-scrub-loop-20260920t1514z-whole-repo`. Scope: whole repository, target `main`.
Source: `e669657e6f966e86f183b9e3e9462bafbc92c295`.
Status: reviewed; prior target CI passed (19051–19055). Execute the phases serially.

## Goal and evidence

Fix three confirmed P2 defects, then perform a new complete eight-domain scrub. The previous five-phase plan is separate. Inventory and source identity evidence resides in the durable run artifacts and `.tmp/recovery-iteration13-{backend,lifecycle,frontend-ci}.json`. Each actual-module reproduction was rerun against the identical merged source tree.

1. `approval-vote--stale-resolved-status`: `castVote` reads pending request before awaiting resolution, then returns that stale object. The route uses it for response status and audit `requestStatus`. Two focused regressions show approved/rejected writes succeed but return pending. Prisma returns independent snapshots.
2. `network-sync-actions--aba-response-ownership`: hook compares only network strings. Start A, navigate B then A, start a new A request, resolve old A: old finally clears the new busy flag. Persistent WalletListHeader instance uses compact mode, so actual impact is prematurely enabled controls. Fresh deferred-hook reproduction fails.
3. `two-factor-login--cancel-during-verification`: enabled Back clears the challenge during verification; delayed success still installs the user and authentication cookies. Fresh actual-hook reproduction fails. Existing loading guards rule out an ordinary second login while verifying; no broader session-overwrite claim.

No schema/migration/data repair, public API shape/version changes, dependency updates, or unrelated refactors. P3 backlog is outside the blocking fix set. The latent prior-sync timer erasing a resync failure may be incidentally resolved by operation-owned timer cleanup; preserve its evidence and explicitly verify any claimed resolution.

## Phase 1 — approval response reflects persisted resolution

- [x] Add failing real-service regressions with distinct initial pending, post-vote pending and final persisted snapshots in `server/tests/unit/services/approvalService/approvalService.cast-vote-resolution.contracts.ts` and adjacent registered contracts.
- [x] In `server/src/services/vaultPolicy/approvalService.ts`, reread through existing `getApprovalRequestAfterVote(requestId)` after `checkAndResolveRequest`; use that final snapshot for event count and return value. Keep the actual created vote unchanged.
- [x] Test approved, rejected, vetoed, below-quorum pending, a concurrent extra vote, CAS-loser terminal state, concurrent expiration and final missing request. Reuse existing concurrency/guards/events contracts and harness; fixtures must not mutate old snapshots or hide missing terminal reads.
- [x] Extend `server/tests/unit/api/wallets-approvals-routes.test.ts` to check response counts/status and audit status use the same service snapshot for pending/approved/rejected/vetoed/expired. Route mocks complement, never replace, the real-service regression.
- [ ] Verify locally, independently review, deliver a standalone PR and verify exact merge-commit CI.

Acceptance: response/audit reflect the persisted snapshot read after resolution, including when another resolver wins. Existing repository CAS remains the serialization point; losing resolvers must not gain draft writes or notifications. Below-quorum calls also reread because a concurrent resolver may finish. Missing final row uses existing NotFoundError. Existing expiration-before-vote rejection and resolution-side-effect error behavior stay unchanged. One additional read per successful vote; no new transaction/isolation promise.

## Phase 2 — sync UI has current-operation ownership

- [ ] Add deferred real-hook regressions in a focused `tests/components/NetworkSyncActions/` ownership suite (or equivalent discovered test file), preserving existing `tests/components/NetworkSyncActions.test.tsx` contracts. Cover sync/resync A→B→A, old success/error while newest A pending, reverse completion, unmount, StrictMode replay and timer ownership.
- [ ] Update `src/components/NetworkSyncActions/useNetworkSyncActions.ts` using existing `useLatestRequest`/`createRequestOwnership`. Invalidate synchronously on rendered network change; capture operation token when action starts. Guard results, errors, busy cleanup, callbacks and timers; do not hold a render token that StrictMode cleanup permanently invalidates.
- [ ] Make shared action ownership coherent for both busy flags: latest admitted action retires prior operation and resets both flags to its own kind, so an obsolete finally cannot strand or clear current busy state. UI continues disabling both actions while busy. No server cancellation is implied.
- [ ] Retire prior result timers at admission/network change/unmount; a timer may clear only its own current result. Preserve API arguments, outcome text, confirmation semantics, timeout durations and persistent resync errors.
- [ ] Verify current compact controls remain busy until their own request settles; independently review and deliver a standalone PR with exact target CI. Record any incidental P3 timer resolution with the existing reproduction.

Acceptance: no roundtrip revives old ownership, including rejection/finally and callbacks; unmount and StrictMode replay are safe. Accepted server work continues independently of retired UI ownership. Keep existing formatting helpers intact and avoid adding a new generic concurrency framework.

## Phase 3 — 2FA remains visibly pending until verification settles

- [ ] Add hook/flow/screen regressions before production edits, including cancellation and duplicate verification in the same tick before React rerenders.
- [ ] In `src/contexts/useUserAuthActions.ts`, add synchronous ref admission for one verification. Reject duplicate verify with false before any state writes. Preserve idle no-challenge error. Only the admitted call releases the guard in finally.
- [ ] Make `cancel2FA` return false without mutation while verifying, true after normal idle clearing. Update its local interface and `src/contexts/userContextTypes.ts` boolean contract; retain context forwarding and update only affected typed fixtures.
- [ ] In `src/components/Login/useLoginFlow.ts`, clear local code/notice only after cancellation is accepted. In `src/components/Login/TwoFactorScreen.tsx`, disable native Back while `isLoading || isBootLoading`, with ordinary disabled styling.
- [ ] Test success still hydrates once; failed verification releases guard and permits retry/idle cancellation; duplicate calls do not clear primary loading/errors. Screen Back is callable idle, blocked while verifying, and restored after failure. Flow refusal preserves code/notice; accepted cancellation clears them. Existing API/non-API error and no-challenge tests remain green.
- [ ] Verify frontend, independently review, deliver a standalone PR and verify exact target CI.

Acceptance: Back cannot claim to cancel an already submitted verification whose response sets cookies. No UI-only discarded success, transport abort/session cleanup machinery, or unrelated auth concurrency changes. `cancel2FA` boolean is internal; existing consumers ignoring it remain valid. UI and synchronous action guard must both enforce the policy.

## Verification and delivery

Run commands from the owned worktree after `source "$HOME/.nvm/nvm.sh" && nvm use --silent`; backend typechecks run from `server/`, not npm-exec in the root. Check disk/inodes and installed/generated dependencies before expensive gates. No host dev/preview/start/Vite server.

- Phase 1 focused: from server, `npx vitest run tests/unit/services/approvalService.test.ts tests/unit/api/wallets-approvals-routes.test.ts`; then `npx tsc --noEmit` and `npm run typecheck:tests`.
- Phase 2 focused: configured frontend runner for existing NetworkSyncActions and new ownership suite.
- Phase 3 focused: configured frontend runner for useUserAuthActions, UserContext, useLoginFlow, TwoFactorScreen and Login suites.
- Each changed package: full tests and configured typechecks before commit. Root: `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:all`, `npm run test:run`. Backend: `npm --prefix server test -- --run --maxWorkers=1`. Reuse unchanged-package evidence only when exact source identity is recorded.
- Changed-package literal 100% coverage: frontend `npm run test:coverage`; backend **unit-only** `npm --prefix server test -- --run --coverage tests/unit --maxWorkers=1`.
- Frontend phases: `npm run build`; serve `dist/` with an owned static HTTP process and throwaway Playwright config without webServer. Run Chromium render regression plus affected wallet-list/auth behavior specs; stop only that owned server afterward.
- Run configured app/server lint, architecture boundaries/cycles/graphs as impacted, `bash scripts/quality/lizard-only.sh`, diff whitespace and independent adversarial review. Update generated graphs when imports change; stage expected graphs before index-based architecture check. Keep new/edited functions CCN<=15; no unrelated file splits.
- Inspect foreground pre-commit feedback; fix verified comments and retest affected paths. Never bypass hooks. An expensive failure requires exact identity/signature/new hypothesis/cheap discriminator before retry.
- One PR per phase in the sequence above. Reserve each branch/worktree in durable state before creation/writes. Refresh main/open PRs before planning and delivery; revalidate changed evidence. Wait all required PR workflows, merge with pinned head and deletion disabled, verify actual squash object/tree/ancestry, then exact push CI. Append immutable plan/head/merge provenance.
- Nested implement-merge reuses the outer goal with `rebuild_policy: defer`. No intermediate deployment. Preserve unrelated release/dependency PRs, worktrees and untracked plans.
- Preserve prior owned branches pending their exact one-off cleanup authorization; do not call them cleaned. Reuse the recorded owned worktree, archive operational evidence outside it before final removal. Prepare concrete per-resource proof and exact commands for final permission, as required by AGENTS.md.

## Rollback and completion

Each phase can be reverted through a protected PR without data migration; revert restores the specific previous bug. No stored data or cache format changes. Network/API operations already accepted by the server are not rolled back by UI retirement. The auth phase deliberately disables cancellation only while verification is in flight.

- [ ] All three phases merged, target CI verified, plan progress and finding attempts recorded.
- [ ] Perform another fresh complete eight-domain scrub at the new main SHA; a nonempty P0–P2 set requires another reviewed plan, not completion.
- [ ] After the eventual zero-P0–P2 gate, finish authorized owned cleanup and crash-safe final rebuild of the originally running stack via `./start.sh --rebuild`, with deployed identity/health/readiness proof. Never start a stopped stack.
- [ ] Validate complete durable run state before completing the outer goal.

## Recursive review

Two complete clean passes: coordinator source/contract review and independent formal review of this exact file. No verified actionable comments remain. Rejected broader approval transaction isolation and auth abort/session cleanup: the demonstrated defects need a persisted reread and pending-verification interaction guard. Exact reviewed commit is pinned in durable state before implementation.

## Phase 1 verification progress

The post-resolution reread is implemented; decision/CAS and resolution side effects are unchanged. Twelve real-service regressions failed before the fix; 127 focused service/route tests now pass. Full backend: 723 files / 16,535 tests passed (65 database integration suites skipped by their guard). Server production/test types pass. Independent review identified one fixture status mismatch, corrected to approved and reverified in the 127-test suite. Unit-only coverage passed all 16,436 tests with 100% statements (41,106), branches (23,194), functions (8,752) and lines (38,290). Root/server typechecks, lint, architecture/cycles/diagrams and complexity passed; final independent review is clean. Frontend source/tests/config/dependencies are byte-identical to verified e669657, preserving 9,055 frontend tests, 100% coverage and 157 browser tests. Delivery remains pending.
