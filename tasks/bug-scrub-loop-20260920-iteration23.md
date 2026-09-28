# Iteration 23 remediation plan: Payjoin authority and WebSocket late admission

Implementation gate: independent recursive review must converge, then the parent commits this exact plan normally and pins its reviewed commit and hash in the outer run ledger before production changes. The existing user-authorized loop owns all delivery; no new permission request is required.

## Goal and delivery boundary

Fix both parent-confirmed P2 authorization/lifecycle defects from the Iteration 23 scrub in one reviewable protected PR, with two separate commits on one branch. The user explicitly prefers one combined PR to avoid repeating serial CI; that preference intentionally overrides the implement-merge default of delivering unrelated phases in separate PRs. The changes remain isolated in commits and share one final full backend gate/CI cycle.

- Source baseline: `93b9d79d0dfd50d14da6eecf83918f427a2b2ec5` (`main`, `Stop automatic mutation retries after ambiguous write failures`).
- Implementation worktree: `/home/nekoguntai/sanctuary-bug-scrub-loop-20260920t1514z-iteration23`.
- Branch: `codex/bug-scrub-loop/20260920t1514z-iteration23-auth-lifecycle`.
- Findings:
  - `payjoin-attempt--viewer-supersedes-signing-intent`, fingerprint `payjoin-attempt|viewer-with-readable-draft|supersedes-signer-intent`.
  - `websocket-lifecycle--async-completion-after-close`, fingerprint `websocket-lifecycle|async-auth-or-subscription-completes-after-close|orphan-registry`.
- No Prisma/schema migration, external API contract change, frontend change, P3 cleanup, or deployment/rebuild is in scope. Final runtime deployment is deferred until the parent loop finishes a clean rescrub.

## Source evidence reviewed

- `server/src/api/payjoin.ts:281-350` currently uses `findByIdWithAccess`, loads the signing intent, then calls `attemptPayjoinSend`; on a proposal it calls `createSigningIntent` with `supersedesIntentId`. It does not check edit role. `server/src/services/accessControl.ts:124-139` exposes `requireWalletEditAccess`, which denies no-role access and non-edit roles while retaining the existing direct/group role resolution. `server/tests/unit/api/payjoin.test.ts:948-...` has success, proposal, and failure cases but no role gate cases. Parent proof and precise route trace are in `confirmed-payjoin-finding.json` and `trust-api.md`.
- `server/src/websocket/auth.ts:154-175` awaits upgrade-token verification before claims, connection tracking, and registration; late upgrade admission is bounded by the existing heartbeat once registration occurs, but an explicit liveness check still prevents admission after close. `auth.ts:200-259` awaits auth-message verification then mutates claims, starts the expiry timer, and tracks the per-user connection without a post-await live check. `server/src/websocket/channels.ts:17-104,135-224` and `:143-224` await wallet access before registry and metric writes in single/batch paths. `server/src/websocket/clientServer.ts:140-220,255-307` owns connection registration and close/error cleanup; cleanup stops the queue and removes the client/user/channel registry entries. The persistent connection-capacity and subscription-retention basis is the late auth-message/single/batch subscription path, not the heartbeat-bounded upgrade path. Supplemental proof and source trace are in `backend-state.md`; parent’s exact-Node proof covers three races in two tests.
- Current `server/tests/unit/websocket/auth.test.ts` fixtures need realistic `readyState` (and `isQueueStopped`) setup before adding an `OPEN`-based predicate. Existing focused baseline recorded by parent: 101 Payjoin, 77 clientServerLimits, and 19 auth tests pass.
- Read `AGENTS.md`, `CLAUDE.md`, and the `recursive-plan-review`, `implement-merge`, and `pr-delivery` skills. Project instructions require regression tests before fixes and backend unit coverage to be scoped to `tests/unit`.

## Ordered implementation tasks

### 1. Add and prove the Payjoin route regression before its production fix

- [ ] In `server/tests/unit/api/payjoin.test.ts`, add a viewer route case whose active intent and successful Payjoin proposal exercise the old path. Assert current code would negotiate and attempt intent replacement, then make the test fail at the authorization expectation before changing production code.
- [ ] Add role/relationship cases covering authorized owner and signer success, authorized sender failure (negotiation returns an unsuccessful/no-proposal result and no replacement intent is created), viewer and approver denial, and no-access denial. Use existing access-control role semantics for both direct and group membership; preserve `requireWalletEditAccess` semantics: no role fails closed, owner/signer edit paths remain permitted, and viewer/approver are forbidden. Assert denied requests do not call `attemptPayjoinSend`, `bindPsbtAccount`, or `createSigningIntent`.
- [ ] Keep response behavior compatible for successful authorized Payjoin and negotiated sender failure. The role gate must execute before any outbound negotiation or signing-intent mutation. Reuse `requireWalletEditAccess`; do not add a new role table or duplicate access-control logic. Preserve the existing missing-wallet concealment/denial semantics exposed by access control.
- [ ] Add only tests needed to prove direct/group resolution and route use of the existing helper. Avoid a redundant wallet relationship database fixture if service tests already prove those mappings; inspect `server/tests/unit/services/accessControl.test.ts` role cases (`direct`, group fallback, no role, malformed role) before deciding which existing assertions can be reused.

### 2. Add and prove the WebSocket post-await liveness regressions before its production fix

- [ ] In `server/tests/unit/websocket/auth.test.ts` and/or `server/tests/unit/websocket/clientServerLimits/` contracts, use deferred token verification to close/stop a socket before verification resolves. Cover upgrade auth, auth-message auth, and assert late completion performs no claim/timer creation, per-user connection tracking, client registration, auth response, or connection metric mutation. Preserve the normal open-socket and connection-cap flows.
- [ ] In `server/tests/unit/websocket/clientServerLimits/clientServerLimits.subscriptions.contracts.ts`, gate `checkWalletAccessUncached` with a deferred promise, then close/stop the client before allowing access. Cover both single subscribe and batch subscribe. Assert no late client or channel subscription, no subscription gauge increment/generation bump, no reply queued, and batch stops before checking/admitting later channels. Keep private-event delivery revalidation intact.
- [ ] Use realistic WebSocket state in shared fixtures. Add a small shared admission predicate (prefer a new narrowly scoped `server/src/websocket/clientAdmission.ts` over adding executable logic to coverage-excluded `types.ts`) for `readyState === WebSocket.OPEN && !isQueueStopped`, then test its open, closed, and queue-stopped outcomes. Keep this helper limited to lifecycle admission; do not add an auth-generation or connection-registry redesign.
- [ ] Check terminal liveness at entry to single/batch subscribe and before each batch channel, including global channels without a wallet-access await. This prevents a stopped batch from admitting a later synchronous channel. Add regression coverage for already-stopped single/batch requests and a batch that closes during wallet lookup before a later global channel.
- [ ] Explicitly exercise error cleanup and authorization revocation while `readyState` remains `OPEN` but `isQueueStopped` is true, resolving pending auth-message and wallet authorization afterward. Assert no claims, expiry timer, registry, gauge, generation, or queued response resurrection. Test normal CLOSING/CLOSED transitions too; cleanup remains the owner of decrements.
- [ ] Apply the predicate after each asynchronous admission boundary and immediately before side effects: upgrade-token verification before claims/connection-limit mutation/tracking/registration; auth-message verification before claims, expiry timer, tracking, and response; single wallet access before subscription/gauge mutation; and after every awaited wallet access plus before each next admission in batch subscription. If a socket is no longer live, return without re-registering, tracking, metric writes, or sending a response.
- [ ] Preserve current behavior for live clients: successful auth/admission, access-denied responses while live, subscription limits/rate-limit behavior, auth timeout/expiry, close/error cleanup, unsubscribe, and revoke handling must still pass.
- [ ] Regression acceptance is outcome-based, not implementation-name-based: auth-message completion after close leaves no connection entry capable of consuming the per-user cap; late single/batch completion leaves no orphaned registry or gauge count; no late upgrade completion registers or starts timers/metrics; open active requests still work.

### 3. Freeze and verify the combined candidate, then commit the fixes separately

- [ ] Commit 1 contains only Payjoin route authorization and its tests. Suggested message: `fix(payjoin): require wallet edit access for sender negotiation`.
- [ ] Commit 2 contains only WebSocket lifecycle helper/auth/channel guards and their tests. Suggested message: `fix(websocket): fence admission after client close`.
- [ ] Re-read both commits and check for unrelated changes. Keep the branch as the single PR unit. Do not push a separate phase PR or run the final remote CI gate between commits.
- [ ] Run pure mocked focused Payjoin/WebSocket tests locally using already-generated dependencies before any normal fix commit, then freeze the complete combined candidate and run the full guarded backend test scope before the two fix commits once the regressions pass. A test-only PostgreSQL service may be used only as the disposable Compose dependency of these guarded scripts; do not point tests at a running application, host/live database, or production service. Do not generate Prisma Client on the host: generated artifacts must be created only by the backend test image, preserving the worktree’s shared generated-client symlink.
- [ ] Run backend unit coverage through the guarded `backend-coverage` service; require the configured 100% backend unit coverage threshold. The coverage lane is `tests/unit` only, matching CI. A broad `vitest --coverage` that includes integration tests is not an acceptable substitute.
- [ ] Run repository full quality and architecture gates against the frozen combined candidate before both fix commits: `npm run quality` and `npm run arch:check`. The quality command owns the project typecheck/quality sequence; do not replace it with a subset. Run `npm run typecheck:server:tests`, `npm --workspace server exec tsc -- --noEmit`, `npm run typecheck:app`, `npm run typecheck:tests`, and `npm run typecheck:all`, and do not invoke any `prisma generate` from the host.
- [ ] Open one protected PR only after local gates pass. Use the PR-delivery workflow and wait for required checks/reviews. Because the target branch blocks outdated branches and CI is serial, keep this as the sole PR for this plan and do not stack/rebase multiple PRs.
- [ ] Merge only under normal protection after all required checks and reviews are green. Verify the platform merge SHA is a real git object and ancestor of `origin/main`, then wait for exact target-branch push CI. Clean only this plan’s branch/worktree after the merge and target CI are verified; leave unrelated dirty/untracked work untouched.
- [ ] After verified merge and owned cleanup, perform the parent-requested fresh whole-repository rescrub. Do not deploy/rebuild services in this PR closeout; report deployment deferred to the loop’s final clean-pass decision.

## Verification command recipes

Use Node24.21.0 via `/home/nekoguntai/.nvm/versions/node/v24.21.0/bin` on PATH. Focused tests are pure mocked unit entry points and run locally without DB or Prisma generation. Run from `server/`:

```bash
../node_modules/.bin/vitest run tests/unit/api/payjoin.test.ts \
  tests/unit/websocket/auth.test.ts tests/unit/websocket/clientServerLimits.test.ts \
  --no-file-parallelism --maxWorkers=1
```

The `.contracts.ts` files are imported by the `.test.ts` entry points and must not be invoked as if independently discovered tests. Include any new `.test.ts` entry point and existing accessControl role tests in the focused command. Capture failing-first assertions, then successful authorization/lifecycle controls. No full-suite or Prisma-generation overlap with other source readers in the same worktree. Normal commit hooks remain enabled.

Final local gates, each through the repository’s cleanup/ownership coordinator:

```bash
./scripts/ci/run-docker-test-subject.sh backend-test
./scripts/ci/run-docker-test-subject.sh backend-coverage
npm run quality
npm run arch:check
npm run check:architecture-boundaries
npm run check:wallet-sync-lifecycle-contract
npm run check:wallet-sync-mutation-boundaries
npm --workspace server run check:prisma-imports
npm run check:server-cycle-baseline
npm run check:resource-ownership-contract
```

If a guard reports stale owned resources or an expensive lane fails, stop and follow `CLAUDE.md` retrigger discipline: record immutable SHA/run IDs, failure signature, new hypothesis, and cheap discriminator before any retry. Do not bypass the cleanup coordinator or run raw Compose teardown.

## Rollback and risk

- No migration or persisted format changes. If either slice breaks its contract, revert that commit on the same task branch; if needed, close the single PR without merging and report why. Preserve the other independently passing slice only if it remains safe and the parent explicitly revises the reviewed plan.
- Payjoin authorization risk is limited to role-policy compatibility: preserve existing direct/group access resolution and permit only roles that `requireWalletEditAccess` currently treats as editable. Successful authorized negotiation and sender-failure behavior are regression-covered.
- WebSocket liveness risk is accidentally rejecting a still-open connection or mutating metrics inconsistently. Exercise open, closed, queue-stopped, access-denied, limit, and revoke cases; existing cleanup remains the sole owner of removal/decrement for already registered connections/subscriptions.
- Do not broaden into WebSocket auth generations, worker behavior, BIP78 receiver policy, general access-control refactors, or existing P3 findings.

## Plan review state

- First source/evidence pass: two accepted findings, both parent-reconfirmed; baseline worktree/branch and focused test inventory checked.
- Self-review pass 1: added explicit heartbeat qualification for upgrade auth, narrowed persistent leak basis to auth-message and subscriptions, specified close/error/revocation side effects, and made the single-PR/two-commit batching decision explicit.
- Self-review pass 2: added direct/group role semantics, no-access behavior, authorized failure path, single and batch subscription race coverage, exact guarded test recipe, disposable DB and generated-client constraints, and rollback/target-CI cleanup criteria.
- Independent pass 2 and parent final reread: no verified actionable comments remain. Implementation remains gated on the normal plan commit and exact reviewed commit/hash recorded in the outer ledger.

Parent review pass 1 applied: use actual discoverable .test.ts entry points; run pure mock regressions on host without expensive Docker; pin combined implementation content for guarded provenance gates; require explicit server and frontend typechecks plus owning architecture contracts. Every guarded engine/host gate must produce terminal verified cleanup evidence before another attempt or branch cleanup.

Independent review pass 1 applied: actual .test.ts aggregator already corrected by parent; subscription entry/per-batch-channel liveness and no-await global channel cases now explicit; error/revocation OPEN-but-terminal fixtures required. Independent reviewer completed the updated full reread and found no remaining comments.

Parent sequencing amendment / independent review pass 3: CLAUDE.md requires full tests before committing. Stop both implementation agents after final review, freeze all tracked and nonignored new candidate files (path, mode, symlink target, SHA256) outside the checkout, then run guarded full backend tests and unit-only100% coverage plus full quality/frontend coverage, types and architecture before the two normal fix commits. Docker COPY tests these candidate bytes; its revision/inside-container Git HEAD remain the prior plan commit, so do not claim those metadata identify the final source. Record the candidate manifest hash and guarded build/cleanup receipts, verify unchanged files after all gates and again after the normal commits, and bind the final commit to that same tested content. If a hook changes source, repeat the affected verification. Immutable remote CI tests the final pushed head. This ordering resolves the repository pre-commit requirement without duplicate Docker cycles. Reviewed helper/source contract supports dirty candidate testing; no cleanliness bypass or hook disable is used.
