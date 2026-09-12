# Iteration 14 — P0 + P1 Remediation Plan

Iteration: 14
Source: target branch `main` @ `a231c551f30ef32fc6e0e27189efb6063587ab4b`.
Discovery: `reports/bug-scrub-iteration-13-closing-scrub-2026-09-12.md` (full-repository scrub, all
eight coverage domains). Every finding in this plan was independently reconfirmed against source
by the coordinator before planning.

Finding IDs: `backup-restore-legacy-schema-zero-wipes-database` (P0),
`worker-encryption-key-never-initialized` (P1), `stale-wallet-access-cache-after-ownership-transfer`
(P1), `owner-override-draft-approved-despite-recorded-rejection` (P1),
`wallet-stats-tab-utxo-refetch-loop` (P1), `react-query-cache-not-cleared-on-logout` (P1),
`preference-save-reports-false-success` (P1).

Goal: remediate the P0 and all six P1s, each with a failing-first non-regression test, in seven
independently mergeable phases — one per finding, one PR each, landed in severity order.

Non-goals: the ~25 P2 and ~8 P3 findings in the report are recorded in the run ledger as backlog
and are **outside this plan** by owner decision (2026-09-12). Because confirmed P2s remain
unremediated, this run cannot reach the clean P0–P2 termination gate; it will close as
`incomplete` with the backlog preserved. No refactors, no schema changes, no product-policy
changes.

Assumptions: phases are independent (distinct files; the two `approvalService` and
`transferService` phases do not overlap). Helper names below are implementation steps, not
existing APIs. Merges are strictly serial per `CLAUDE.md`; rebase only the next PR to merge.

Execution model: implementation of each phase is delegated to a Sonnet subagent working on a task
branch in the main checkout; the coordinator verifies every diff, runs the repository gates, and
delivers the PR. Subagents must not push, open PRs, or touch the run ledger.

---

## Phase 1 — P0: a legacy backup can no longer wipe the database

- Owner paths: `server/src/services/backupService/constants.ts`,
  `server/src/services/backupService/validation.ts`, `server/src/services/backupService/restore.ts`.
- Tests: `server/tests/unit/services/backupService/backupService-core.contracts.ts`,
  `server/tests/unit/services/backupService/schema-migration.contracts.ts`, plus a new contract file
  for destructive-restore admission.

### Root cause (verified)
`getRequiredRestoreTables` filters `LEGACY_TABLE_ORDER` by
`meta.schemaVersion >= LEGACY_RESTORE_TABLE_MIN_SCHEMA_VERSION[table]`; every entry is
`>= BASELINE_RESTORE_SCHEMA_VERSION = 1`, so `{version: '1.0.0', schemaVersion: 0}` yields **zero**
required tables (19 at schemaVersion 1; 56 for the current format). `validateBackupForRestore` runs
at `restore.ts:126` on the pre-migration meta. `tablesToDelete` (`restore.ts:185`) is the full
`TABLE_ORDER + CACHE_TABLES + EPHEMERAL_TABLES` independent of backup contents; the insert loop
`continue`s on absent tables. `validateRequiredTables` only warns; `validateUsers` is skipped when
`data.user` is absent. Net: all data deleted, nothing restored, HTTP 200.

### Contract
1. **A destructive restore always requires the baseline table set.** In
   `getRequiredRestoreTables`, clamp the effective schema version to
   `max(meta.schemaVersion, BASELINE_RESTORE_SCHEMA_VERSION)` for the legacy filter, so every table
   whose minimum is the baseline is required for any legacy backup. Newer-only tables (e.g.
   `mcpApiKey` at 47) remain optional below their minimum.
2. **Defense in depth in `validateBackupForRestore`:** if the computed required set is empty, reject
   with an explicit error — a restore that would delete everything and restore nothing is never
   valid, whatever produced that state.
3. **A destructive restore must contain at least one user.** Absence of `data.user` (or an empty
   array) is a hard rejection on the restore path (not merely on validate), because restoring it
   locks the instance out permanently. Keep the existing at-least-one-admin rule.
4. Do not change `tablesToDelete`, the migration order, or the validate-only endpoint's tolerance
   for legacy backups beyond (1)–(3).

### Tests (failing first)
- The exact P0: `{version:'1.0.0', schemaVersion:0, data:{}}` submitted to restore is rejected, and
  `deleteMany` is never invoked on any table.
- `getRequiredRestoreTables({version:'1.0.0', schemaVersion:0})` returns the baseline set (non-empty),
  and the `backupService-core` partial-restore test still rejects when its fixture's
  `schemaVersion` is set to `0`.
- A legacy backup at schemaVersion 0 that **does** carry all baseline tables and a user still
  restores (the existing `schema-migration` test must keep passing).
- Missing `data.user` on a destructive restore → rejected before any delete.

### Verification
`cd server && npx tsc --noEmit && npx vitest run tests/unit/services/backupService`, then
`cd server && npx vitest run --coverage tests/unit`.

### Acceptance
No combination of `meta.version`/`meta.schemaVersion`/`data` yields an empty required-table set on
the restore path; a backup without users cannot be restored; `deleteMany` is unreachable for a
rejected backup.

### Rollback
Revert the phase PR. Validation-only change, no schema or data migration.

---

## Phase 2 — P1: the worker initializes the encryption key

- Owner path: `server/src/worker.ts`.
- Tests: a new worker-bootstrap contract test; `server/tests/unit/services/webhooks/*` untouched.

### Root cause (verified)
`validateEncryptionKey()` is called only in `src/index.ts:237`. The worker registers
`webhookDeliveryJobs` at `worker.ts:394` and is the only process that runs them. Signing an
authenticated webhook calls `getEncryptionKey()`, which throws "Encryption key not initialized";
`isRetryableWebhookError` does not match that text, so `markDeliveryDead` fires on attempt 1.
`server/tests/setup.ts:19-21` initializes the key globally for every unit file, which is why no
test can see this.

### Contract
1. Call `await validateEncryptionKey()` during worker startup **before** `jobQueue.initialize()` /
   `registerWorkerJobs`, mirroring `index.ts:232-240`: log `FATAL` and exit non-zero on failure.
   The worker must not start accepting jobs with an uninitialized key.
2. Additionally harden the failure mode: in `deliveryService`, treat an encryption-key
   initialization error as **non-retryable but loud** — it must still dead-letter (retrying cannot
   help), but log at `error` level with a message naming the missing startup step, so a future
   regression is not silent.

### Tests (failing first)
- Worker bootstrap: `validateEncryptionKey` is awaited before `registerWorkerJobs`; a rejection
  from it prevents job registration and exits non-zero. Write this without relying on the global
  `tests/setup.ts` initialization (mock `../utils/encryption` in the test).
- deliveryService: an "Encryption key not initialized" error during signing is logged at `error`
  level and the delivery is dead-lettered on attempt 1 (pin the current behavior explicitly so it
  is a decision, not an accident).

### Verification
`cd server && npx tsc --noEmit && npx vitest run tests/unit/worker tests/unit/services/webhooks`,
then the coverage gate.

### Acceptance
The worker cannot reach job registration without a validated key; a key-init failure in signing is
observable in logs.

### Rollback
Revert the phase PR.

---

## Phase 3 — P1: ownership transfer invalidates the wallet access cache

- Owner path: `server/src/services/transferService/confirm.ts`.
- Tests: `server/tests/unit/services/transferService/**` (extend the harness at
  `transferServiceTestHarness.ts:37`, which currently mocks only `invalidateWebSocketWalletAccess`).

### Root cause (verified)
`executeWalletTransferTx` mutates `walletUser` directly on the transaction client
(`confirm.ts:152-160`), bypassing `walletSharingRepository` — the only site that calls
`invalidateWalletAccessCache`. The post-commit hook at `:91` calls only
`invalidateWebSocketWalletAccess`. The former owner keeps `owner` from `getUserWalletRole` for up to
`ACCESS_CACHE_TTL_SECONDS = 30`, during which `DELETE /wallets/:id` and `POST /:id/share` succeed.

### Contract
1. After the transfer transaction **commits** (same place as the existing
   `invalidateWebSocketWalletAccess(result.walletId)` at `:91`), call
   `invalidateWalletAccessCache(result.walletId)`. The cache pattern is `*:${walletId}`, so one call
   covers both the previous and new owner.
2. Order: cache invalidation before the WebSocket notification, so any client reacting to the
   WS event re-reads a cold cache.
3. Do not invalidate inside the transaction (a rollback would leave a cold cache — harmless — but
   a commit-then-crash between the two would be worse than invalidating after commit).

### Tests (failing first)
- A confirmed transfer calls `invalidateWalletAccessCache` with the wallet id, after commit.
- An expired / not-yet-confirmable transfer does not invalidate.
- Ordering: access-cache invalidation happens before `invalidateWebSocketWalletAccess`.

### Verification
`cd server && npx tsc --noEmit && npx vitest run tests/unit/services/transferService`, then the
coverage gate.

### Acceptance
No `walletUser` mutation site remains without a corresponding access-cache invalidation
(`grep -rn "walletUser\.\(create\|update\|delete\)" server/src/` → each hit is either in
`walletSharingRepository` or followed by `invalidateWalletAccessCache`).

### Rollback
Revert the phase PR.

---

## Phase 4 — P1: owner override derives the draft status from all requests

- Owner path: `server/src/services/vaultPolicy/approvalService.ts`.
- Tests: `server/tests/unit/services/approvalService/approvalService.concurrent-resolution.contracts.ts`,
  `approvalService.owner-override.contracts.ts`.

### Root cause (verified) — incomplete fix from PR #1064
`ownerOverride` gates each request with `resolveApprovalRequestIfPending`, then writes
`updateDraftApprovalStatus(draftId, 'approved')` unconditionally at `:292`. If a request was
concurrently rejected it is correctly skipped — but the draft is still approved, violating the
invariant `updateDraftApprovalFromRequests` maintains (`:433`: any rejected → draft rejected). The
draft is the broadcast gate.

### Contract
1. Replace the unconditional `updateDraftApprovalStatus(draftId, 'approved')` with
   `updateDraftApprovalFromRequests(draftId)`, which re-reads every request for the draft and
   derives the status (rejected/vetoed wins; approved only when all are approved).
2. Keep the override audit events and the `ConflictError` when nothing was pending.
3. The `overridden`/`alreadySettledCount` logging stays.

### Tests (failing first)
- Override where one request was concurrently rejected: the draft is derived **rejected**
  (`mockDraftRepo.updateApprovalStatus` called with `'rejected'`, never `'approved'`).
- Override where all requests were still pending: draft derived approved.
- Override where one was concurrently vetoed: draft derived vetoed.
- The existing "skips requests another resolver already settled" contract gains the missing
  `updateApprovalStatus` assertion.

### Verification
`cd server && npx tsc --noEmit && npx vitest run tests/unit/services/approvalService.test.ts`, then
the coverage gate.

### Acceptance
No path in `approvalService` writes a draft `approved` without deriving from the current request
set.

### Rollback
Revert the phase PR.

---

## Phase 5 — P1: the Stats tab loads UTXOs once

- Owner paths: `src/components/WalletDetail/useWalletDetailController.ts`,
  `src/components/WalletDetail/hooks/useWalletData.ts`.
- Tests: `tests/components/WalletDetailWrapper/**`, `tests/components/WalletDetail/**` (the
  controller network test file has the harness pattern).

### Root cause (verified)
The effect at `useWalletDetailController.ts:283-287` guards on
`utxoStats.length > 0 || loadingUtxoStats` and depends on `loadingUtxoStats`.
`loadUtxosForStatsFn` (`useWalletData.ts:201-213`) sets `utxoStats([])` for an empty wallet and
never touches it on error; `loadingUtxoStats` flips true→false either way, so the guard passes again
and the dependency transition re-runs the effect — one `GET /utxos` per round trip while the tab is
open.

### Contract
1. Track *attempted* separately from *has data*: `useWalletData` keeps a `utxoStatsLoadedFor`
   (wallet id or `null`) state set in the loader's `finally` when the route is still owned. Reset it
   to `null` inside the existing `[routeKey]` effect at `useWalletData.ts:92-112` — the one that
   already does `setUtxoStats([])` at `:101` — so it follows the same wallet/user identity every
   other loader uses (`routeKey = \`${id}:${user?.id}\``, `:52`).
2. The effect guards on `utxoStatsLoadedFor === id || loadingUtxoStats`; `utxoStats.length` leaves
   the dependency list.
3. A failed load is *attempted* — no automatic retry loop. The existing error log stays; if the tab
   has a retry affordance, wire it to reset `utxoStatsLoadedFor`; if not, do not add UI in this
   phase.

### Tests (failing first)
- Empty wallet, Stats tab: the loader is called exactly once across subsequent re-renders (drive
  `loadingUtxoStats` true→false in the harness — the current harness stubs the loader inertly,
  which is why the loop was invisible).
- Loader rejects: called exactly once.
- Switching wallets re-arms the load for the new wallet.

### Verification
`npm run typecheck:app && npm run typecheck:tests && npm run test:run`, then `npm run test:coverage`.

### Acceptance
Opening Stats on an empty wallet issues one request; no effect dependency can retrigger it without
a wallet change or explicit retry.

### Rollback
Revert the phase PR.

---

## Phase 6 — P1: the React Query cache is cleared on logout

- Owner paths: `src/providers/QueryProvider.tsx`, `src/contexts/useUserAuthActions.ts`, and the
  terminal-logout path in `src/api/refresh.ts` (`triggerTerminalLogout`).
- Tests: `tests/contexts/**` (auth actions), `tests/providers/**`.

### Root cause (verified)
`queryClient.clear()` / `resetQueries` appear nowhere in `src/`; query keys carry no user identity
(`createQueryKeys('wallets')` → `['wallets', ...]`). The logout path calls `authApi.logout`,
`triggerLogout`, `resetPreferenceTracking`, `setUser(null)` — none touch the query client, and
`App.tsx` has no remount key. User B in the same tab sees user A's wallets within `gcTime`.

### Contract
1. Export the singleton `queryClient` from `QueryProvider.tsx` (or a small `queryClient.ts` module
   it imports), so non-React code paths can reach it. (`QueryProvider` wraps `UserProvider` —
   `AppProviders.tsx:8-9` — so `useQueryClient()` would also work inside `UserContext`; either is
   acceptable, but the terminal-logout listener below is the path that must be covered.)
2. Clear it on **every** logout path. There are exactly two: the explicit logout in
   `useUserAuthActions.ts:155-166`, and the terminal logout that `refresh.ts:312-317`
   (`triggerTerminalLogout`) dispatches via `fireTerminalLogoutListeners()` — find the listener
   `UserContext` registers for it (the one that already calls `setUser(null)` on session expiry) and
   clear there too. Prefer `queryClient.clear()` (drops cache and in-flight state) over
   `resetQueries` (which refetches).
3. Clear **after** `setUser(null)` so no authenticated query remounts against the cleared cache
   before the tree unmounts; also cancel in-flight queries first (`cancelQueries`) so a slow
   response for user A cannot land after user B logs in.

### Tests (failing first)
- Seed the client with a `walletKeys.lists()` entry, run logout, assert the cache is empty.
- Same for the terminal-logout path.
- An in-flight query resolving after logout does not repopulate the cache.

### Verification
`npm run typecheck:app && npm run typecheck:tests && npm run test:run`, then `npm run test:coverage`.
Render-regression is not expected to change (no rendered output differs), but run the
`tests/e2e/auth.spec.ts` shape locally if the static-dist harness supports it; note it needs a live
backend and fails on `main` too, so treat it as informational.

### Acceptance
No query cache entry survives a logout of any kind.

### Rollback
Revert the phase PR.

---

## Phase 7 — P1: preference saves report failure

- Owner paths: `src/contexts/useUserPreferenceMutation.ts`,
  `src/components/Settings/sections/useTelegramSettings.ts`.
- Tests: `tests/contexts/useUserPreferenceMutation*`,
  `tests/components/Settings/sections/TelegramSection.branches.test.tsx`.

### Root cause (verified)
`flushPreferenceBatch` ends in `finally { resolve(); }` (`:238-240`), so the batch promise only ever
resolves; `updatePreferences` returns `batch.settled` (`:353`) and cannot reject. The Telegram
`catch` at `useTelegramSettings.ts:90-116` is unreachable; the success toast fires while values are
rolled back. The rollback error lands on `UserContext.error`, which nothing in the authenticated
shell renders. The existing Telegram test mocks a rejection the real implementation never produces.

### Contract
**Design decision (plan review):** do not make `updatePreferences` reject. Eight call sites fire it
without `await` or `.catch` (`useUserPreference.ts:80`, `CurrencyPreferencesContext.tsx:122-174`
×5, `useAppRoutesController.ts:39`, `useDeviceListPreferences.ts:16`, `useWalletListPreferences.ts:16`,
`useAppearanceTabController.ts:41-44`); a rejecting promise would turn every failed background
preference write into an unhandled rejection. Instead:

1. `updatePreferences` / `flushPreferenceBatch` return `Promise<PreferenceSaveResult>` where
   `PreferenceSaveResult = { ok: true } | { ok: false; error: string }`, and **never reject**.
   `flushPreferenceBatch` resolves `{ ok: false, error }` from its `catch` (keeping the rollback and
   the `UserContext.error` write) and `{ ok: true }` only on success. Fire-and-forget callers are
   untouched and remain safe.
2. Every **awaiting** caller checks `.ok`: `useTelegramSettings.ts:91,108` and the four awaits in
   `SoundSection.tsx:260-303`. On `ok: false`: show the error, no success toast, and for Telegram
   **roll back the optimistic `setEnabled`** and re-sync local `botToken`/`chatId` from the
   rolled-back preferences so the form reflects what was actually saved.
3. Do not add a global error banner in this phase; the per-form error is the fix.

### Tests (failing first)
- A failed `PATCH /auth/me/preferences` resolves `updatePreferences` to `{ ok: false, error }` and
  never rejects; a successful one resolves `{ ok: true }`.
- Telegram save failure: no success toast, error shown, `enabled` rolled back, form values re-synced.
- Rewrite the existing `mockRejectedValueOnce` Telegram test to mock `{ ok: false }` — the
  rejection contract it asserts has never existed.
- SoundSection: a failed save does not show success.
- Logout with a failing flush still completes logout.

### Verification
`npm run typecheck:app && npm run typecheck:tests && npm run test:run`, then `npm run test:coverage`.

### Acceptance
`updatePreferences` has a rejection path; no caller can observe a success signal for a rejected
save.

### Rollback
Revert the phase PR.

---

## Final verification (after all seven phases merge)

- Backend: `cd server && npx tsc --noEmit && npx vitest run --coverage tests/unit` (scoped as CI
  shards it).
- Frontend: `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all &&
  npm run test:run && npm run test:coverage`.
- Both lizard (`bash scripts/quality/lizard-only.sh`, baseline 86) and `npm run arch:check` before
  every commit — both bit iteration 13.
- Grep gates: no `updateDraftApprovalStatus(.*'approved')` outside a derived path; every
  `walletUser` mutation site invalidates the access cache; `validateEncryptionKey` present in
  `worker.ts`; `queryClient.clear` on every logout path.

## Delivery, cleanup, and deployment contract

- One PR per phase via `$pr-delivery`, serial merges, ancestry + zero-content-diff gate before branch
  deletion (`git cherry` does not work for squash merges of multi-commit branches).
- `rebuild_policy: defer`; deployment recorded as `skipped` at closeout because the run's immutable
  `containersRunningAtStart` is `false`.
- The run closes as **`incomplete`**, not clean: P2 findings remain confirmed in the ledger by owner
  decision. The final report must say so plainly.

## Completion criteria

All seven findings resolved with merged, CI-verified PRs and failing-first tests; ledger updated
with attempt records; P2/P3 backlog preserved; run status `incomplete` with the reason recorded.
