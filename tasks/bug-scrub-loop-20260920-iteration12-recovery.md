# Iteration 12 recovery: approval membership, history, and async ownership

## Identity and recovery

- Run: `bug-scrub-loop-20260920t1514z-whole-repo`; target `main`; whole repository scope.
- Refreshed eight-domain source pass: `a00287db48d413ff561e3588540272cb43c00d29`.
- Supersedes unfinished portions of `docs/plans/bug-scrub-loop-2026-09-21-iteration-12-push-timeframe-request-ownership.md`; preserves its delivery history.
- Gateway push and shutdown phases landed in #1278 and #1279. Shutdown merge `4e82b71bb3508c826eda0aab1cd9182d3c321cff` is reachable from main; five exact-merge push workflows succeeded. Current focused lifecycle tests: 46 passed.
- Aggregate invalid timeframe was externally fixed by #1283 (`41fdd000ed841dc4b7e3cb8360648b07e3ef61f5`). `TimeframeSchema.catch('1W')` now normalizes it. The new intentional weekly hourly buckets must be preserved.
- Outer goal remains active. Nested implement-merge uses this exact plan and `rebuild_policy: defer`. Final deployment only after a clean whole-repository rescrub, using `./start.sh --rebuild` if the originally running stack remains running.

## Goal, boundaries, and evidence

Fix seven confirmed P1/P2 defects without changing approval policy, transaction accounting, provider selection policy, or backup validation rules. No schema migration or production data repair. P3 backlog is outside the blocking fix set.

1. **P1 `vault-policy-all-quorum-omits-group-approvers`**: `server/src/services/vaultPolicy/approvalService.ts:458` enumerates only direct wallet users although `accessControl.ts` grants group approvers voting access. A signer-created draft with owner O and group approver G resolves after O alone; an owner-created draft can remain pending after G votes when self approval is disabled. Expected: all effective approvers, respecting direct-role precedence, must approve.
2. **P2 `wallet-balance-history--all-truncated-five-years`**: `server/src/api/wallets/analytics.ts:60` maps ALL to five years and the repository enforces that lower bound. Expected: all retained history. Invalid wallet timeframe also retains its invalid response/cache identity despite using the default date range.
3. **P2 `audit-logs--stale-query-response`**: `src/components/AuditLogs/AuditLogs.tsx:144` applies every query response and shared loading/error completion. Reverse filter/page completion can overwrite current rows, totals, and state.
4. **P2 `backup-restore--stale-validation-result`**: `src/components/BackupRestore/hooks/useBackupHandlers.ts:170` has no file generation. Cleared A can validate replacement B and enable restore with misleading metadata.
5. **P2 `currency-providers--stale-list-persistence`**: `src/contexts/CurrencyPreferencesContext.tsx:218` runs independent mount/reload requests. A late obsolete list can persist auto after a newer list retained the selected provider.
6. **P2 `websocket-client-backpressure-never-resumes`**: `server/src/websocket/messageQueue.ts:116` waits for a WebSocket `drain` event which installed ws never emits. After >64KiB buffering, processing remains true and future messages queue/drop indefinitely. Actual-module reproduction with real ws instance confirms zero sent/two queued after socket recovery; existing test fabricates client drain.
7. **P2 `wallet-import--validation-input-owner-mismatch`**: import action ownership tracks network only. Editable same-network content B can replace A while A validates; the wizard reviews A and submits B. Actual-module deferred harness reproduced this mismatch. Backend reparsing B does not establish client review consistency.

## Mergeable phases (tests first)

### Phase 1 — Effective all-quorum membership

- [x] Add failing approval tests: group-only approvers, direct owner plus group approver, duplicate membership, direct viewer overriding group approver, direct approver overriding group viewer, self-exclusion, and membership changes before resolution.
- [x] Add a repository effective-approver query following existing direct-role-over-group precedence; reuse canonical role constants. Inspect `walletSharingRepository`, `accessControl`, and existing access-union helpers before choosing the query.
- [x] Use this enumeration for initial all-quorum count and live all-quorum resolution. Preserve numeric/any quorum, veto, owner override, and empty eligible-set semantics.
- [x] Add real PostgreSQL repository behavioral coverage using existing guarded integration harness; register any new integration file in `scripts/ci/backend-integration-groups.sh`.
- [ ] Verify/review and deliver one server PR with exact merge-SHA target CI.

Acceptance: every currently eligible effective approver must vote; group-only approval can complete; direct role precedence and requester exclusion match authorization. No membership or policy data mutation.

### Phase 2 — Wallet history timeframe contract

- [ ] First add failing wallet route tests for ALL epoch bound and older-than-five-years retained data, invalid/omitted input default 1M, normalized response/cache key. Add an invalid aggregate timeframe regression preserving current 1W hourly behavior.
- [ ] Parse wallet timeframe with the canonical schema and wallet-specific 1M fallback; map ALL to epoch. Preserve valid ranges, response shape, sampling, and ten-second cache TTL.
- [ ] Tighten wallet OpenAPI enum/default and cover the contract. Use repository-bound filtering proof or guarded integration if the route test cannot demonstrate old-history inclusion.
- [ ] Verify/review and deliver one independent server PR with exact target CI.

Acceptance: ALL includes retained old history; invalid values cannot create divergent response/cache identities. No chart-sampling/accounting refactor.

### Phase 3 — Audit, backup, and provider request ownership

- [ ] Add deferred reverse-success/reverse-error/unmount regressions for all three owners before production edits.
- [ ] Audit logs: independent log/stats generations; guard rows, totals, errors, logging, and loading/finally; invalidate on unmount. Keep filter/page/refresh behavior.
- [ ] Backup upload: increment owner before each file read, invalidate on clear/unmount, reset filename/validation/error/success/validating state, guard read/parse/validation success/failure/finally and input reset. Use existing safe JSON parsing utility when editing this boundary. Keep validation failure semantics.
- [ ] Currency providers: one generation and shared reload path for mount/events/manual reload; guard list/fallback/persistence/logging and invalidate on unmount. Preserve current selected-provider checks and fallback policy.
- [ ] Verify 100% frontend coverage, typechecks, production build and static-server Playwright render checks. Review/deliver one frontend PR with exact target CI.

Acceptance: only current request/file owns results and terminal state; stale requests cannot persist provider changes or enable restore for another file.

### Phase 4 — Browser WebSocket backpressure recovery

- [ ] Add a failing regression using supported ws transport behavior, not a fabricated WebSocket drain event.
- [ ] Choose a supported send-completion or bounded retry mechanism; guarantee a single queue owner, ordered messages, retry cancellation on close, and bounded memory under sustained pressure. Inspect `clientServer` cleanup and the `AuthenticatedWebSocket` type before implementation.
- [ ] Test recovery, sustained/repeated pressure, close while waiting, send errors, and ordering; preserve existing overflow modes and metrics.
- [ ] Verify/review and deliver one server PR with exact target CI.

Acceptance: temporary backpressure resumes delivery without reconnect; closed clients retain no retry resources. No private ws fields or new unbounded polling.

### Phase 5 — Import validation tied to current input

- [ ] Add deferred component/action regressions: same-network A-to-B edit, Back/format change, replacement file read, stale success/error, and unmount. Assert reviewed input equals submitted input.
- [ ] Extend existing ownership to include import content/validation lifetime. Invalidate pending work at content/format/back changes and file read replacement; preserve network and hardware/QR ownership checks.
- [ ] Require current validated input before advancing/importing. Ensure hardware-generated descriptor paths capture the new owner after setting content, avoiding self-invalidating successful validation.
- [ ] Verify frontend coverage, types, build/render checks and adversarial review; deliver a separate PR with exact target CI.

Acceptance: replacing input requires validation of that input; old work never advances or rewrites a new wizard session. No backend import-policy change.

## Verification and delivery

Run Node commands after `source "$HOME/.nvm/nvm.sh" && nvm use --silent`.
Use owned worktree only; never point integration tests at the running application DB.

- Focused suites: approvalService quorum/repository; wallet analytics/OpenAPI/cross-wallet history; AuditLogs/BackupRestore/providerInit; clientServerLimits/messageQueue; ImportWallet ownership.
- Server phases: server TypeScript and full test suite; unit coverage scoped to `tests/unit` with literal 100% thresholds; root typechecks and configured relevant lint/architecture checks. Guarded DB tests through `./scripts/run-integration-tests.sh <spec>` with terminal signed cleanup receipt.
- Frontend phases: `npm run typecheck:app`, `typecheck:tests`, `typecheck:all`, `test:run`, and frontend coverage; build, lint, architecture/cycles/complexity/large-file/generated checks as applicable. Serve built dist with a static server and throwaway Playwright config without webServer; never host Vite dev/preview.
- Full frontend and server tests plus TypeScript before code commits as repository rules require. Record expensive failures with exact revision, signature, hypothesis, and cheap discriminator before retry.
- Every phase gets independent adversarial and simplification/edge-case review before foreground commit. Preserve CCN <=15 and split functions/components where needed.
- Re-fetch main and recheck open PRs before delivery. Revalidate changed evidence; revise/review if necessary. Never bypass required CI/protection. Record exact reviewed plan revision, heads, merge ancestry, target CI, and owned cleanup in durable state.
- Owned resource cleanup follows proven merge/CI evidence and exact command authorization. Preserve unrelated release worktrees and untracked plans.

## Compatibility, rollback, and closeout

No migration required. Each PR can be reverted independently; rollback reintroduces its named defect. Existing approval requests derive membership live, so no backfill is needed. Wallet invalid cache keys age out in ten seconds. Async ownership affects only obsolete work, not API formats. WebSocket recovery must not alter public events.

- [ ] Deliver all five phases and update findings with verified merge/test evidence.
- [ ] Fresh complete eight-domain scrub of the new target SHA; repeat for any P0-P2.
- [ ] Settle all owned PRs/resources, verify target ancestry/CI, record crash-safe final deployment operation and health/readiness/build identity.
- [ ] Validate final durable state; only then complete outer goal.

## Recursive review

Two complete passes: coordinator source/contract review and independent read-only review. No verified actionable comments remain. Checked direct-role precedence, hardware descriptor owner recapture, separate stats/log owners, shutdown cleanup, and guarded test feasibility. Implementation must still pass adversarial review.

## Phase 1 verification progress

- Group-only quorum regression failed against pre-fix code; 166 focused tests pass after the fix.
- Guarded PostgreSQL wallet-sharing suite: 19 tests passed, receipt state `cleaned` (`/tmp/sanctuary-cleanup-local.2sbFXj/artifacts/final-upload.json`).
- Frontend: 665 files / 8,995 tests passed. Root and server source/test typechecks, server lint, architecture boundaries/cycles/diagrams, complexity and independent final review passed.
- Backend full suite: 722 files / 16,493 tests passed (65 DB-dependent suites skipped; affected PostgreSQL suite executed separately). Scoped unit coverage passed: 100% statements, branches, functions, and lines. PR delivery pending.
