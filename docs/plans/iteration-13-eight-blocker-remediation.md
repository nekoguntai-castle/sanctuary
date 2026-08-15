# Iteration 13 — Eight Blocker Remediation Plan

Scope: eight blocker findings (stable slugs are given in each finding heading below, F1–F8) in four independently mergeable phases, two findings per phase. Each phase is one PR with its own rollback.
Source: target branch `main` @ `948fef8b8d84e9351120d18bc57e4eacf9b99722`.
Goal: remediate the eight confirmed iteration-13 blockers (F1–F8) with fail-closed, regression-tested fixes.
Non-goals: no product/state/commit/push/PR changes from this plan itself; P3 backlog findings are outside the blocking fix set and are not addressed by this plan.
Assumptions: phases are independently mergeable with no schema or state migration; new repository/helper functions named in a phase are implementation steps (added in the listed owner path), not existing APIs — do not assume they exist.

## Phase 1 — Approval enforcement + atomic persistence (independently mergeable)

### F1 (slug: `approval-required-policy-direct-broadcast-bypass`) broadcasting.ts — approval enforcement independent of caller draftId
- Owner path: `server/src/api/transactions/broadcasting.ts`; test `server/tests/unit/api/transactionsSigningIntentBroadcast.test.ts` (add if absent).
- Root cause: `loadDraft` returns null when the caller does not supply a draftId, so `assertDraftAllowsBroadcast` is skipped and unapproved transactions reach broadcast.
- Contract: resolve signing intent/draft server-side from the transaction payload (psbt/txid), not caller draftId; match the approval record to the resolved intent+draft; fail closed (throw a typed approval-required error — add the error class if absent, implementation step) for both direct and PSBT paths when no matching approved record exists. Caller draftId is a hint only, never authoritative; `loadDraft` returning null must not skip the approval check.
- Tests: failure — unapproved tx rejected on direct and PSBT paths; concurrency — parallel broadcasts for distinct approved/unapproved intent+draft identities are independently gated (the approved one proceeds, the unapproved one is rejected), and duplicate attempts cannot bypass the same server-side approval gate; null — missing draftId still resolves and enforces (no `loadDraft`-null skip); boundary — stale approval for a different intent/draft is rejected.
- Verification: `cd server && npx tsc --noEmit && npx vitest run tests/unit/api/transactionsSigningIntentBroadcast.test.ts`.
- Acceptance: no code path reaches broadcast without a server-resolved approval match; default is fail-closed.

### F2 (slug: `approval-request-persistence-fails-open`) draftCreate.ts — atomic approval-request persistence
- Owner path: `server/src/services/draftCreate.ts`; test additions `server/tests/unit/services/draftCreate.test.ts` (add if absent) and related existing `server/tests/unit/services/bitcoin/signingIntent/ingressRegistry.test.ts`.
- Root cause: the catch/log after draft persistence leaves no approval request behind and falls back to a default nonblocking status (`not_required`), silently dropping enforcement.
- Contract: persist draft + approval request atomically (single transaction or single write). Remove the catch that maps errors to `not_required` — never catch/log into a nonblocking status; let persistence failure propagate. `not_required` is set only by an explicit policy decision, never from an error path.
- Tests: failure — injected persistence failure throws and leaves no partial draft; concurrency — parallel creates yield distinct drafts, each with its own request; null — optional fields absent still persist atomically; boundary — retry after failure does not duplicate.
- Verification: `cd server && npx tsc --noEmit && npx vitest run tests/unit/services/draftCreate.test.ts tests/unit/services/bitcoin/signingIntent/ingressRegistry.test.ts`.
- Acceptance: no `not_required` assignment inside any catch block; failure leaves zero partial state.

Backend verification (Phase 1): `cd server && npx tsc --noEmit && npx vitest run`.

Rollback (Phase 1): revert the phase-1 PR/commit; no schema or state migration is introduced by this phase.

## Phase 2 — Conditional resolution + stale-data guard (independently mergeable)

### F3 (slug: `concurrent-approval-vote-resolution-last-writer-wins`) approvalService.ts + policyRepository.ts — pending-only conditional resolution plus reread
- Owner paths: `server/src/services/vaultPolicy/approvalService.ts`, `server/src/repositories/policyRepository.ts`; tests `server/tests/unit/services/approvalService.test.ts`, `server/tests/unit/repositories/policyRepository.test.ts`.
- Root cause: resolution updates any matching record regardless of status (can re-resolve resolved/expired rows) and decides on a stale in-memory read without rereading.
- Contract: conditional update that only affects rows currently pending (e.g., `UPDATE ... WHERE id=$1 AND status='pending'`), returning the affected count; after resolution, reread the row and confirm final state before reporting success.
- Tests: failure — resolve on a non-pending row affects 0 rows and reports not-resolved; concurrency — two resolvers race, exactly one wins; null — unknown id → 0 affected, no exception; boundary — expired pending row is not resolved.
- Verification: `cd server && npx tsc --noEmit && npx vitest run tests/unit/services/approvalService.test.ts tests/unit/repositories/policyRepository.test.ts`.
- Acceptance: no unconditional UPDATE by id; every resolution path rereads before success.

### F4 (slug: `bitcoin-network-switch-retains-placeholder-telemetry`) useBitcoin.ts — keepPreviousData must not cross network identity / gate placeholder
- Owner path: `src/hooks/queries/useBitcoin.ts`; test `tests/hooks/queries/useBitcoin.test.ts`.
- Root cause: query keys already include network, but `placeholderData: keepPreviousData` serves data from a previous network/gate identity while the new query is in flight; consumers render cross-network or pre-gate data.
- Contract: condition/remove `keepPreviousData` on identity crossing — apply the previous-data placeholder only when the incoming query's network/gate identity matches the prior one; on crossing, return loading/placeholder instead of stale cross-identity data. Same-network refetch must keep using `keepPreviousData`. Gate placeholder consumers must not receive real network data before the gate passes (and vice versa).
- Tests: failure — query error on a new network shows the error, not old-network data; concurrency — rapid network switch settles on the last identity only; null — no prior data → loading, not an undefined crash; boundary — same-network refetch still uses keepPreviousData.
- Verification: `npx tsc --noEmit && npx vitest run tests/hooks/queries/useBitcoin.test.ts`.
- Acceptance: no consumer can observe data whose network/gate identity differs from the active one.

Verification (Phase 2) — backend: `cd server && npx tsc --noEmit && npx vitest run`; frontend: `npx tsc --noEmit && npx vitest run`.

Rollback (Phase 2): revert the phase-2 PR/commit; the placeholder-conditioning change is additive and needs no data migration.

## Phase 3 — Network-aware explorer URLs + wallet-log isolation (independently mergeable)

### F5 (slug: `non-mainnet-custom-explorer-config-ignored`) useExplorerUrl.ts — accept network, use matching custom/status explorer; callers pass network
- Owner path: `src/components/UTXOList/UTXOList/useExplorerUrl.ts`; all call sites (enumerate via grep at implementation time); tests: add `tests/components/UTXOList/UTXOList/useExplorerUrl.test.ts` and related existing `tests/utils/explorer.test.ts`.
- Root cause: the hook builds explorer URLs from a single hardcoded/default network; custom and status explorers do not match the active network.
- Contract: `useExplorerUrl(network)` selects the explorer base (custom config or status) matching the passed active network; unknown/null network yields no explorer URL (or an explicit error), and the caller may render a disabled/non-link placeholder — it must never use a default-network URL. Update every caller to pass the active network (implementation step).
- Tests: failure — unknown network → no URL/explicit error, never a default-network URL; concurrency — rapid re-renders with changing network always yield the matching URL; null — null/undefined network → no explorer URL, caller renders a disabled/non-link placeholder (never a default-network URL), no crash; boundary — each supported network maps to its own custom/status explorer.
- Verification: `npx tsc --noEmit && npx vitest run tests/components/UTXOList/UTXOList/useExplorerUrl.test.ts tests/utils/explorer.test.ts` plus grep for call sites missing the network argument.
- Acceptance: zero callers omitting network; returned URL always matches the active network.

### F6 (slug: `wallet-log-reload-failure-retains-previous-wallet`) useWalletLogs.ts + LogTab — clear logs/seen IDs only on wallet identity change; empty/error on failure
- Owner paths: `src/hooks/websocket/useWalletLogs.ts`, `src/components/WalletDetail/LogTab.tsx`; tests: add `tests/hooks/websocket/useWalletLogs.test.ts` and extend existing `tests/components/WalletDetail/LogTab.test.tsx`, `tests/components/WalletDetail/LogTab.branches.test.tsx`.
- Root cause: the log buffer and seen-ID set persist across wallet reloads, so a new or failed load shows the previous wallet's logs.
- Contract: clear the log buffer and seen-ID set only when wallet identity changes (including cross-wallet reload), before fetching the new wallet; a same-wallet refresh preserves its seen-ID set/dedup while refreshing current-wallet logs. On an identity-change fetch failure or lost race, state remains empty or an explicit error — never prior-wallet data. LogTab renders only current-wallet logs, with no fallback to a previous wallet.
- Tests: failure — identity-change fetch failure → empty/error, not prior-wallet logs; concurrency — overlapping reloads show only the latest wallet's logs with no seen-ID cross-contamination; null — no wallet selected → empty list; boundary — same-wallet refresh preserves its seen-ID set/dedup while refreshing current-wallet logs.
- Verification: `npx tsc --noEmit && npx vitest run tests/hooks/websocket/useWalletLogs.test.ts tests/components/WalletDetail/LogTab.test.tsx tests/components/WalletDetail/LogTab.branches.test.tsx`.
- Acceptance: LogTab output is a function of current wallet state only.

Verification (Phase 3) — frontend from root: `npx tsc --noEmit && npx vitest run`. F5/F6 change rendered UI (explorer link URLs, wallet log tab): per CLAUDE.md a green vitest run is not sufficient for frontend work — if rendered output changes, update the PNG baselines under `tests/e2e/render-regression.spec.ts-snapshots/` and verify the render regression lane (Playwright against a static `dist/` build; never run a host dev server).

Rollback (Phase 3): revert the phase-3 PR/commit; hook signature changes are contained to callers updated in the same PR.

## Phase 4 — Bounded maintenance timeout + immutable delivery snapshot (independently mergeable)

### F7 (slug: `maintenance-weekly-vacuum-parameterized-set-fails`) maintenance.ts + maintenanceRepository.ts — PostgreSQL-valid bounded statement timeout; replace placeholder test
- Owner paths: `server/src/jobs/definitions/maintenance.ts`, `server/src/repositories/maintenanceRepository.ts`; tests `server/tests/unit/jobs/maintenanceDefinitions.behavior.test.ts`, `server/tests/unit/repositories/maintenanceRepository.test.ts`.
- Root cause: the timeout is applied via a parameterized PostgreSQL `SET` (e.g. `SET statement_timeout = $1`), which PostgreSQL does not accept as a bound, so no timeout is enforced; the test asserts the placeholder-joined value instead of a real interval.
- Contract: use a validated PostgreSQL-valid bounded timeout mechanism — build `SET statement_timeout TO '<interval>'` with the interval literal validated in code before use (e.g. `'5s'`) per statement; `SET statement_timeout = '0'` remains only as post-statement cleanup/reset. Replace the placeholder-joined buggy test assertion with one asserting a valid bounded interval is applied per statement (implementation step).
- Tests: failure — invalid timeout value rejected before reaching the DB; concurrency — concurrent maintenance invocations each issue their validated bounded `SET statement_timeout TO '<interval>'` before work and reset to `'0'` afterward, with no cross-call leakage; assert SQL ordering/shape in the existing behavior/repository unit tests (`maintenanceDefinitions.behavior.test.ts`, `maintenanceRepository.test.ts`); actual statement cancellation at the bound is required only as an integration test if the repository already has an existing PostgreSQL integration harness — do not add that as a unit gate; null — no timeout configured → explicit default applied, never a placeholder; boundary — min/max allowed values accepted and reset to `'0'` after.
- Verification: `cd server && npx tsc --noEmit && npx vitest run tests/unit/jobs/maintenanceDefinitions.behavior.test.ts tests/unit/repositories/maintenanceRepository.test.ts` plus grep confirming the placeholder assertion is gone.
- Acceptance: no test asserts a placeholder; every maintenance statement carries a validated bounded interval, reset to `'0'` after.

### F8 (slug: `webhook-retry-uses-mutated-endpoint-not-delivery-snapshot`) deliveryService.ts — retry uses immutable targetUrl/profile snapshot; endpoint-drift test
- Owner path: `server/src/services/webhooks/deliveryService.ts`; test `server/tests/unit/services/webhooks/deliveryService.test.ts`.
- Root cause: retry re-resolves the target URL/profile at delivery time, so config drift between attempt 1 and the retry changes the endpoint.
- Contract: delivery records already contain immutable `targetUrl` + profile snapshots; all retries consume the existing snapshot and never refetch or re-resolve the mutable endpoint. Missing profile at capture fails closed before attempt 1.
- Tests: failure — retry after an endpoint change still hits the original snapshot URL; concurrency — parallel retries both use the same snapshot with no interleaved re-resolution; null — missing profile at capture → fail closed before first attempt; boundary — final attempt after max retries still uses the snapshot.
- Verification: `cd server && npx tsc --noEmit && npx vitest run tests/unit/services/webhooks/deliveryService.test.ts` (the endpoint-drift case is the gate).
- Acceptance: endpoint-drift test passes; the retry path never invokes the resolver.

Verification (Phase 4) — backend from repo: `cd server && npx tsc --noEmit && npx vitest run`.

Rollback (Phase 4): revert the phase-4 PR/commit; no schema or state migration is introduced by this phase.

## Final verification (after all four phases merged)
- Backend: `cd server && npx tsc --noEmit && npx vitest run`.
- Frontend (from repo root): `npx tsc --noEmit && npx vitest run`.
- Backend coverage gate (before delivery/push, per CLAUDE.md): `cd server && npx vitest run --coverage tests/unit`; configured thresholds must pass.
- Frontend coverage gate (from repo root, before delivery/push, per CLAUDE.md): `npx vitest run --coverage`; configured thresholds must pass.
- Render regression (F5/F6 UI): if rendered output changed, `tests/e2e/render-regression.spec.ts-snapshots/` baselines are updated and the render regression lane passes.
- Grep gates: no `not_required` inside catch blocks; no placeholder `'?'` timeout assertion; every useExplorerUrl caller passes network.
- Merge order is flexible; the four phases are independent and no phase builds on another's changes, so there is no required landing order.

## Delivery, cleanup, and deployment contract (bug-scrub-loop)
- Delivery: each phase is delivered via pr-delivery as one PR targeting `main`; post-merge CI verification on target-main must pass before the next phase starts. Phases remain independently mergeable; no phase depends on another's merge.
- Cleanup: after each merge, delete the owned branch and worktree, release loop-owned resources, and update bug-scrub-loop state (plan metadata + revision) before starting the next phase.
- Rebuild policy: implementation uses `rebuild_policy: defer` — no container deploy/rebuild during any phase.
- Deployment: deploy/rebuild only after the final clean scrub passes (all four phases merged and Final verification green).
- Containers: historical `containersRunningAtStart=false`, so the final deployment must not start or rebuild containers; record a terminal `skipped` deployment with evidence (container status check output) in loop state.
