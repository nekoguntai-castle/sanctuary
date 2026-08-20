# Sync Failure Visibility & Resync Reliability

Status: investigation complete, not yet implemented
Date: 2026-08-19
Target: remote v0.8.64 install — 3 wallets stuck "not syncing", "Full resync"
silently no-ops, "Resync all" leaves wallets unspun.

## Executive summary

**The support bundle the user supplied cannot diagnose this.** Both bundles
(2026-08-18 / 2026-08-19) use profile `shareable_aggregate`, which admits exactly
7 collectors — `config` plus 6 `notification*`. They contain zero wallet-sync
data: `grep -c lastsync` = 0, `resync` = 0. A `wallets` collector exists at
`server/src/services/supportPackage/collectors/wallets.ts` and does select
`lastSyncError`, but it is registered via plain `registerCollector`, and
`runner.ts:185` reads only `getShareableCollectors()` — so it is dead code. See §3(c).

**The remote is already on v0.8.64**, which contains both legacy-wallet sync
fixes (#829 `d8a6cc0758`, #831 `ce47097f78`). The wallets are stuck *despite*
having the fix, which rules out the plain v0.8.63 canonical-guard regression as
the sole cause and points at durable wedged state that a code upgrade cannot clear.

**The single largest finding, verified directly against the code:**

> A worker-run sync cannot tell the UI anything, and the UI never asks.

1. `server/src/worker.ts` never calls `initializeWebSocketServer()` — the only
   call site is `server/src/index.ts:208` (the API process).
2. `server/src/worker/jobs/syncJobs.ts` — the worker's sync handler — contains no
   broadcast, no `walletLog`, no websocket reference at all. The instrumented
   implementation (`executeSyncJob` in `services/sync/walletSync.ts`) is a
   *different function*, reachable only from the in-API-process path.
3. Even if it did broadcast, `getBroadcastServer()`
   (`server/src/websocket/notifications/broadcasts.ts:33-39`) returns null
   without an initialized server, and the Redis publish lives inside
   `WebSocketServer.broadcast` — so a process with no WS server cannot publish.
4. Nothing polls to mask it: `useWallets` is
   `createListQuery(walletKeys, walletsApi.getWallets)` called with **no options**
   (`src/hooks/queries/useWallets.ts:28`, factory at `src/hooks/queries/factory.ts:80-88`),
   so no `refetchInterval`. `QueryProvider.tsx:9-17` sets `staleTime: 30s`,
   `refetchOnWindowFocus: false`, `refetchOnReconnect: false`. (The
   `refetchInterval: 30000` at `useWallets.ts:122` belongs to the
   *pendingTransactions* query, not the wallet list.)

So after clicking Full Resync or Resync All, the UI has no mechanism to learn the
sync started, progressed, or finished — only a hard refresh reveals it. This
explains symptoms (2) and (3) as *visibility* failures on top of whatever real
sync fault exists, and explains why symptom (1)'s failure reason is unreadable.
It also means the `Log` tab is structurally empty for every worker-run sync:
`walletLog()` writes the **worker's** in-memory buffer while
`GET /sync/logs/:walletId` reads the **API's** (`syncCoordinator.ts:183-186`).

**Method.** 4 parallel code probes → every claimed finding handed to an
independent agent prompted to *refute* it → 28 survived, 18 were killed. The
refuted list is preserved in §5 so it is not re-litigated. The local database has
zero wallets, so nothing here was confirmed against live data; §2 is the
read-only command set the user must run on the remote box to discriminate the
remaining candidates.

---

## Scope

Only mechanisms that survived adversarial refutation appear below. Refuted
hypotheses are listed in §5 so they are not re-litigated.

---


## 1. What is actually broken

### Cross-cutting root cause A — the worker process cannot talk to the UI at all

This is the single largest contributor and it underlies all three symptoms.

- `server/src/worker/jobs/syncJobs.ts:107-277` — `syncWalletJob.handler` performs the entire sync (`walletRepository.update({syncInProgress:true})` at :141, `syncWallet()` at :146-148, success write at :164-170) and emits **no** WebSocket event and **no** domain event.
- The instrumented implementation is a *different function*: `executeSyncJob` in `server/src/services/sync/walletSync.ts` (:158, :165, :270, :279, :339, :400, :414) — reachable only from the in-API-process path.
- Even if the worker called the broadcasters, they would emit nothing: `server/src/websocket/notifications/broadcasts.ts:32-39` `getBroadcastServer()` returns null unless `initializeWebSocketServer()` ran, and that happens only in `server/src/index.ts:208`. `server/src/worker.ts` never initializes the WS server or the Redis bridge (`index.ts:264`). The Redis publish lives inside `WebSocketServer.broadcast` (`server/src/websocket/clientServer.ts:400`), so a process with no WS server cannot publish.
- No client-side polling masks it: `src/hooks/queries/useWallets.ts:27` builds the wallet list query with no `refetchInterval`; `src/providers/QueryProvider.tsx:9-17` sets `staleTime: 30s`, `refetchOnWindowFocus:false`, `refetchOnReconnect:false`. The only refresh after a resync click is the immediate `onDataRefresh()` in `src/components/WalletDetail/hooks/useWalletSync.ts:114-116`, which races ahead of the worker dequeuing the job.
- Consequence for diagnostics: `walletLog()` writes into the **worker's** in-memory `walletLogBuffer` (`broadcasts.ts:162-176`), while `GET /sync/logs/:walletId` reads the **API's** buffer (`server/src/services/sync/syncCoordinator.ts:183-186`). The log tab is structurally empty for every worker-run sync.

**Scope correction:** this proves *invisibility*, not *non-execution*. A hard refresh would reveal DB progress. It fully explains "appears to do nothing" for symptoms (2) and (3), and explains why symptom (1)'s failure reason is unreadable. It does not on its own stop a wallet from syncing.

---

### Symptom (1) — 3 wallets stuck "not syncing"

**A1. Ordinary sync jobs silently no-op under lock contention, and a lock leak makes it permanent.**

- `server/src/worker/workerJobQueue/jobProcessor.ts:123-131` — when `acquireLock('sync:wallet:<id>')` fails and `retryDelayMsIfUnavailable` returns null, it logs at `debug` and `return { skipped: true, reason: 'lock_held' }`. The job **completes successfully having done nothing**.
- `server/src/worker/jobs/syncJobs.ts:98-105` — `retryDelayMsIfUnavailable` returns `5000` only when `data.fullResync === true`, `null` otherwise. So every ordinary sync (Sync All, stale sweep, `queueNetworkSync`) takes the silent-skip branch.
- The lock is shared cross-process: `server/src/services/sync/walletSync.ts:66` uses the identical key `sync:wallet:${walletId}` with `ttlMs = maxSyncDurationMs + 60000` (31 min). `server/src/index.ts:258` and `server/src/worker.ts:158` both call `initializeDistributedLock('redis-required')`.
- Redis TTL bounds an orphaned lock at ≤31 min, **but** `walletSync.ts:186-216` races `syncWallet()` against `maxSyncDurationMs` and on timeout only logs "taking longer than expected" then `await syncPromise` — the sync is never cancelled and the lock is never released early. A hung Electrum call holds the lock indefinitely.

**A2. The `activeSyncs` in-memory leak — the likeliest cause of three *permanently* stuck wallets.**

- `server/src/services/sync/walletSync.ts:56-58` — `acquireSyncLock` short-circuits on in-memory state *before* Redis: `if (state.activeSyncs.has(walletId)) return false;`
- `activeSyncs` is cleared only by `releaseSyncLock` (:96), which for a hung `syncWallet()` never runs (the :186-216 timeout does not abort).
- Downstream: `syncService.syncNow` returns `{success:false, error:'Sync already in progress'}` (`server/src/services/sync/syncService.ts:345-353`); `queueSync` logs "already syncing, skipping queue" and drops the request (`server/src/services/sync/syncQueue.ts:41-44`). Both return HTTP 200.
- **Nothing reaps it.** `resetStuckSyncs` (`syncService.ts:523-532`) and the worker's stuck reaper (`syncJobs.ts:307-331`) clear only the DB `syncInProgress` column. So the DB flag is cleared (UI stops showing "syncing") while the in-memory set still blocks every new sync — producing exactly "wallet reports not syncing and will not start", and surviving the 31-minute Redis TTL and every stale sweep.

**A3. A wallet that stops syncing without throwing keeps a green "Synced" badge.**

- `server/src/worker/jobs/syncJobs.ts:141` marks work started with `{syncInProgress:true}` and deliberately does not touch `lastSyncStatus`. `lastSyncStatus` is written **only** on a terminal outcome (:168 success, :198/:219/:234 failed). The `finally` at :262-274 writes only `{syncInProgress:false}` — it never downgrades the status.
- Same defect in the other sync path: `server/src/services/sync/walletSync.ts:151` has the identical start-marker with no status write.
- Non-throwing non-completion paths: the A1 lock-held no-op; a job never enqueued; a worker down; a hard kill. In all of them the row stays `lastSyncStatus='success'`, `syncInProgress=false`, `lastSyncedAt=<stale>`, `lastSyncError=null`.
- `src/components/WalletDetail/walletSyncStatusBadgeStatus.ts:55-64` `successDescriptor` then renders a green Check, "Synced", title "Last synced: <old date>". `src/components/Dashboard/WalletSummary.tsx:236-242` does the same on the dashboard.
- No frontend code compares `lastSyncedAt` to now. **The staleness signal already exists server-side and is already on the wire** — `server/src/services/sync/syncService.ts:324` computes `isStale`, typed at `src/api/sync.ts:16` — but `getSyncStatus` (`src/api/sync.ts:54`) is called by no component. This is wiring, not new computation.
- Amplifier: `src/hooks/queries/useWallets.ts:163,176` and `src/hooks/websocket/useWebSocketQueryInvalidation.ts:97,110` apply `...(!syncInProgress && { lastSyncedAt: new Date().toISOString() })` to the query cache on any sync event with `inProgress=false`, **including `status==='failed'`**. The "Last synced: now" tooltip can be client-invented.

**A4. 'retrying' is a durable orphan state with a fabricated attempt count and no cause.**

- `server/src/services/sync/walletSync.ts:348-352` writes `lastSyncStatus:'retrying'`, `lastSyncError: '<msg> (retrying n/3)'`, `syncInProgress:false`. `shouldRetrySyncError` (:42-44) is `!isNetworkDisabledError(error)` — essentially every error takes this path.
- The retry is re-driven only by an in-process `setTimeout` in `state.pendingRetries` (:359-367). Stranding does **not** require a restart: the callback deletes its own `pendingRetries` entry *before* invoking `executeSyncJobFn`; if that call then fails the lock, `executeSyncJob` returns at :136-143 with "Already syncing" — no reschedule, no DB write, zero pending timers, in a live process. `syncService.stop()` (:229-235) also clears every timer with no compensating DB write.
- No reaper touches it: a 'retrying' row already has `syncInProgress:false`, so it is invisible to `resetAllStuckSyncFlags` (`server/src/repositories/walletRepository.ts:369`), `findStuckSyncing` (:380), `findStuckWithCutoff` (:389) and `syncJobs.ts:317-327`.
- UI: `src/components/WalletDetail/walletSyncStatusBadgeStatus.ts:104` tries `retryingDescriptor` **first**; :29 matches on `lastSyncStatus === 'retrying'` alone; :30-31 default to `1`/`3`; :36 sets `title: syncRetryInfo?.error || "Sync failed, retrying..."` — it is the one descriptor that **never reads `wallet.lastSyncError`**, which is exactly where the cause was stored. `syncRetryInfo` comes only from live WS events (`src/components/WalletDetail/hooks/useWalletWebSocket.ts:117-122`) and is nulled on mount (`useWalletSync.ts:55-64`), so after any page load the badge shows a hardcoded "Retrying 1/3".
- `src/components/WalletDetail/WalletHeader.tsx:170-176` additionally suppresses the "Wallet not synced / Sync Now" banner when status is 'retrying', removing the only guided affordance.
- Bounded, not permanent, **only if the worker is healthy**: `findStale` (`walletRepository.ts:392-408`) ignores `lastSyncStatus`, so `check-stale-wallets` re-queues within ~one interval and the worker path overwrites with 'success'/'failed'. It stays "Retrying" forever exactly when the worker queue is not draining — i.e. in combination with A1/A2.

**A5. Every recovery path clears `syncInProgress` without clearing `lastSyncStatus` or writing `lastSyncError`.**

Six sites, all writing `{syncInProgress:false}` only:
`server/src/worker/jobs/syncJobs.ts:267`, `server/src/worker/jobs/syncJobs.ts:323`, `server/src/services/sync/staleWalletChecker.ts:58`, `server/src/services/sync/syncService.ts:551`, `server/src/repositories/walletRepository.ts:372` (`resetAllStuckSyncFlags`, blanket `updateMany` on API start), `server/src/services/sync/syncCoordinator.ts:202` (`resetWalletSyncState`).

Combined with `server/src/repositories/resyncRepository.ts:58-67` (which commits `{syncInProgress:true, lastSyncedAt:null, lastSyncStatus:'resyncing', lastSyncError:null}` **after deleting all transactions**), any interruption leaves `{lastSyncStatus:'resyncing', syncInProgress:false, lastSyncedAt:null, lastSyncError:null}`. The trigger is broader than a crash: `syncJobs.ts:190-210` writes 'failed' on a shutdown abort **only when `isFinalAttempt(job)`**, so a graceful restart during attempt 1 or 2 of 3 reproduces it.

`'resyncing'` is an orphan status no surface handles: absent from the union at `src/types/index.ts:503`, falls through to `notSyncedDescriptor` ("Not Synced"/"Never synced") in `walletSyncStatusBadgeStatus.ts:98-110`, shows "Pending" in `src/components/cells/WalletCells/SyncCell.tsx`, and neither synced nor error in `src/components/Layout/SidebarContent/sidebarItems.tsx`. A wallet with years of history that just had its transactions deleted claims it was never synced.

**A6. The stale reaper force-clears wallets whose full resync is still running (false-idle).**

- `server/src/repositories/walletRepository.ts:414-427` `findStuckWithCutoff` WHERE is `syncInProgress:true AND (lastSyncedAt < cutoff OR lastSyncedAt IS NULL)` — **the NULL arm has no time bound**.
- `resetWalletForFullResync` sets `lastSyncedAt: null`, so a resync running for 3 seconds matches. `server/src/worker/jobs/syncJobs.ts:318-330` then force-clears `syncInProgress` on the next 5-minute tick (`SYNC_INTERVAL_MS` default 300000, `server/src/config/envSections.ts:68`; schedule at `server/src/worker/recurringSchedules.ts:88-98`).
- Not serialized behind the sync: `WORKER_CONCURRENCY` defaults to 5 (`server/src/worker.ts:167`), applied per queue.
- **Same tick**, not next: `findStale` runs a few lines later (`syncJobs.ts:335-339`) and immediately re-selects the wallet (`syncInProgress:false AND lastSyncedAt IS NULL`), enqueuing an ordinary sync (`server/src/worker.ts:474-491`, unique `sync:stale:<id>:<Date.now()>` jobId, no dedupe) that dies as the A1 silent `lock_held` no-op.
- The reaper does **not** abort the resync; if the resync completes, `syncJobs.ts:164-170` self-heals the row. So this is the *false-idle / wasted-job* defect, not a permanent wedge. The same NULL arm also catches any never-successfully-synced wallet — for those it is self-sustaining, since every attempt is flag-cleared mid-flight and every retry is swallowed.
- Two broader clearers with the same shape: `syncService.ts:143 → resetAllStuckSyncFlags` (unconditional on every API start) and `syncService.ts:536-556 checkAndQueueStaleSyncs` using `findStuckSyncing()` (no cutoff at all), which clears any wallet not in the API's in-memory `activeSyncs` — which never contains worker-run syncs.

---

### Symptom (2) — "Full resync" appears to do nothing

**B1. The lock-contention retry loop pins the BullMQ dedup key for as long as the lock is held.**

- `server/src/worker/jobs/syncJobs.ts:39` `SYNC_LOCK_TTL_MS = appConfig.sync.maxSyncDurationMs + 60_000` (31 min at defaults, `envSections.ts:79`); :40 `FULL_RESYNC_LOCK_RETRY_DELAY_MS = 5_000`; :97-105 the lock options.
- `server/src/worker/workerJobQueue/jobProcessor.ts:119-128` — for `fullResync === true`, a held lock triggers `await job.moveToDelayed(Date.now()+5000, job.token); throw new DelayedError()`. bullmq 5.79.0 `dist/cjs/classes/worker.js:649-658` returns before `job.moveToFailed` on `DelayedError`: **`attemptsMade` is not incremented and the job is not finalized**. `SYNC_WALLET_JOB_OPTIONS.attempts:3` (`server/src/worker/jobs/jobOptions.ts`) is never exhausted; the job ping-pongs delayed→active→delayed every 5s.
- `server/src/services/workerSyncQueue.ts:270-291` — the add uses `deduplication: { id: 'full-resync:<walletId>', keepLastIfActive: true }` with **no `ttl` and no `replace`**, routing to bullmq's `deduplicateJobWithoutReplace` → `SET de:full-resync:<walletId> <jobId> NX` with **no expiry**. The key is deleted only by `removeDeduplicationKeyIfNeededOnFinalization` (on completed/failed) or `...OnRemoval`. `moveStalledJobsToWait-9.js` contains no reference to `de:` at all, so stall recovery never releases it. `Job.removeDeduplicationKey()` is called nowhere in `server/src`.
- `keepLastIfActive` does **not** save the new request: `storeDeduplicatedNextJob.lua` stores a successor only when the retained job is in the `active` list; during the 5s ping-pong it is `delayed` for essentially the whole cycle, so the new add is silently dropped. The comment at `workerSyncQueue.ts:286-288` claiming otherwise is false on this path.
- Every subsequent click returns `'deduplicated'` (`workerSyncQueue.ts:294-299`) → `syncCoordinator.ts:210-243` returns HTTP 200 `{success:true, message:'A full resync is already queued for this wallet.'}`.
- **Bound:** an orphaned lock (hard-killed worker → `loseOwnership` → `hardTerminate(1)`, `jobProcessor.ts:147-165`) self-heals in ≤31 min via `SET ... PX NX` (`distributedLock.ts:170-180`). Truly unbounded pinning requires a **live** holder: the refresh timer at `jobProcessor.ts:186-199` re-extends the lock at ttl/3 for as long as the handler promise is pending, and there is no per-job timeout anywhere. A hung Electrum call = permanent pin. Worker concurrency defaults to 3 (`server/src/worker/workerJobQueue/types.ts:9-10`), so one Redis flap can orphan up to 3 wallet locks at once — matching "3 wallets".
- Ordinary sync jobs cannot *sustain* the contention (they take the null-retry branch and skip immediately) but can *originate* it.

**B2. The per-wallet UI renders `deduplicated` as a green success toast.**

- `src/components/WalletDetail/hooks/useWalletSync.ts:112-124` — `const result = await syncApi.resyncWallet(id); ... showSuccess(result.message, "Resync Queued");`. `result.status` is never read, here or in `useWalletDetailController.ts` / `WalletDetailLoadedView.tsx`. The `status` field on `ResyncResult` (`src/api/sync.ts:66-78`) is dead frontend-wide.
- Only the two 503 paths (`rejected` / `indeterminate`, `syncCoordinator.ts:226-233` → `ServiceUnavailableError` → `server/src/errors/ApiError.ts:376-384`) reach `handleError`.
- Not byte-identical, but identical in every status affordance: HTTP 200, title "Resync Queued", `success` severity, CheckCircle icon, `text-success-600` / `bg-success-50` (`src/components/NotificationToast/notificationToastHelpers.tsx:19,29`), 3000 ms auto-dismiss (`src/hooks/useErrorHandler.ts:59-64`). The only differentiator is body copy that vanishes in 3 seconds.

**B3. Full resync deletes all transactions *before* proving it can rebuild them.**

- `server/src/worker/jobs/syncJobs.ts:128` `await prepareFullResync(job)` runs **before** `syncWallet()` at ~:144.
- `server/src/repositories/resyncRepository.ts:24-74` — in one transaction: `tx.transaction.deleteMany({where:{walletId}})` (:53), `address.updateMany({used:false})` (:54-57), wallet state (:58-67). The generation gate at :49-51 makes it once-per-generation, so retries 2 and 3 do not re-delete — but the data is already gone and the terminal state is `lastSyncStatus='failed'` with `lastSyncedAt` still null.
- Whether data is lost depends on where the sync fails, because `processTransactions` is phase 4 of 11 (`server/src/services/bitcoin/sync/phases/index.ts:56-67`) and the legacy canonical guard is phase 10:
  - **Legacy wallet (`canonicalPolicyId` NULL, no migration backfills it):** `pipeline.ts:96` now skips `assertCanonicalAddressesMatchWallet` via `hasCanonicalPolicyIdentity` (the d8a6cc0758 fix), so transactions are re-fetched and re-inserted, then it throws in `gapLimit → ensureGapLimit → assertPersistedCanonicalPolicy` (`addressDiscovery.ts:91`). Data rebuilt, wallet still ends 'failed'. **No loss.**
  - **Wallet with canonical identity but drifted address rows:** throws at `pipeline.ts:96` before any phase. **Permanent transaction loss.**
  - **Any pre-phase failure** — `getNodeClient` / `getBlockHeight` at `pipeline.ts:81-83` against an unreachable Electrum. **Permanent loss**, and the likeliest branch on a box where 3 wallets are already stuck.

**B4. jobId collision returns 'accepted' for a job that was never enqueued.**

- `server/src/worker/jobs/jobOptions.ts:1-6` — `SYNC_WALLET_JOB_OPTIONS` has no `removeOnComplete` / `removeOnFail`. The API-side queue (`server/src/services/workerSyncQueue.ts:64-67`) is constructed with only `{connection, prefix}` and no `defaultJobOptions`, unlike the worker-side queue (`server/src/worker/workerJobQueue/index.ts:176-181`, which sets 500/250 — but `defaultJobOptions` apply at *add* time on the adding instance). `createBullWorker` (:122-127) passes no worker-level `removeOnComplete` either, so bullmq's `getKeepJobs` falls through to `{count: -1}`: `moveToFinished-14.js:979-994` ZADDs the id and skips `removeJobsByMaxCount`. Job hashes are retained forever.
- `addPrioritizedJob-9.js` (~:510) and `addDelayedJob-6.js:554-560` both do `if rcall("EXISTS", jobIdKey) == 1 then return handleDuplicatedJob(...)` **before** `deduplicateJob(...)`. `handleDuplicatedJob` returns the same jobId having stored nothing, so `workerSyncQueue.ts:296` `job.id === candidateJobId` is TRUE → status `'accepted'` → HTTP 200 "Full resync queued…" → green toast → nothing runs.
- Precondition is an in-product action: the built-in restore reinstates wallet rows verbatim (`backupService/restore.ts:303` `createMany`, Wallet classified `durable-restored` at `backupService/constants.ts:40,175`) with the backup-time `requestedFullResyncGeneration`, while Redis is not part of backup/restore and is persistent (`docker-compose.yml:52`, `--appendonly yes`, named volume).
- **Self-limiting:** `reserveFullResyncGeneration` (`resyncRepository.ts:11-18`) increments unconditionally *before* the add, so if a restore rolled the counter back by K, exactly the next K clicks no-op and click K+1 works. It cannot alone explain a wallet resynced many more times than K.
- Adjacent from the same root cause: unbounded `sanctuary:worker:sync` growth against `--maxmemory 128mb --maxmemory-policy noeviction`. That failure is loud (503), not silent, but the fix is shared.

---

### Symptom (3) — "Resync all" does not get all wallets to spin

**C1. `resyncNetwork` counts deduplicated wallets as queued.** `server/src/services/sync/syncCoordinator.ts:313-322` folds `deduplicatedWalletIds` into `queuedWalletIds`/`walletIds` and returns success, so wallets blocked by B1's pinned dedup key are reported as queued.

**C2. The network result collapses per-wallet identity and reason into four integers, rendered green.**

- `src/components/NetworkSyncActions/useNetworkSyncActions.ts:22-39` — `createResyncSuccessResult` takes only four numbers (the caller at :76-81 passes `.length` of each array), so `walletId` and `reason` from `NetworkResyncResult` (`src/api/sync.ts:88-108`) are structurally discarded before the message exists. `type: 'success'` is hardcoded at :35.
- `src/components/NetworkSyncActions/NetworkSyncResult.tsx:8-14` paints it `text-sm text-success-600`. `useNetworkSyncActions.ts:15,88` clears it after `RESYNC_RESULT_TIMEOUT_MS = 8000`.
- **Bounded:** a total-failure batch is *not* green — `syncCoordinator.ts:315-321` throws `ServiceUnavailableError` when `accepted + deduplicated === 0`, which renders red. Consequently `reason:'queue_unavailable'` is unreachable in the green path (it always rejects the whole batch). Only `queue_error`, `queue_state_unknown` and the `deduplicated` bucket can hide behind a green count. The worst case that *does* render green is `accepted === 0, deduplicated > 0`: "Queued 0 wallets for resync; N already queued."

**C3. Sync All (non-resync) silently drops lock-contended wallets.** `CompactNetworkSyncActions.tsx:35 → syncNetworkWallets → POST /sync/network/:network → queueNetworkSync → enqueueWalletSyncBatch`, `fullResync` absent ⇒ the A1 silent `lock_held` no-op. This applies to "Sync all", **not** to "Full Resync All" (which takes the B1 delayed-retry path instead).

**C4. Stagger — real, ruled out as a cause at this scale.** `server/src/config/envSections.ts:73` `SYNC_STAGGER_DELAY_MS` default 2000, capped at 30000 (`schema.ts:133`); applied as `index * staggerDelayMs` at `workerSyncQueue.ts:328` and :397. With 3 wallets the last delay is 4 s against worker concurrency 3. Single-wallet resync passes no stagger (delay 0). Only cosmetic, and only in combination with the missing WS start signal. The genuinely user-visible "nothing is spinning" window is startup catch-up: `startupCatchUpDelayMs` 10000 + `startupCatchUpStaggerDelayMs` 1000 × `startupCatchUpBatchSize` 250 (`envSections.ts:75-76`, `worker.ts:294-303`) ⇒ up to ~4.3 min after a worker restart. Self-clearing.

**C5. Regtest wallets are displayed under Mainnet but excluded from the batch.** `src/app/networks.ts:90-93` `toTabNetwork('regtest')` falls back to `'mainnet'`; `src/components/WalletList/walletListData.ts:28-36` therefore renders and *counts* the wallet under the Mainnet tab (feeding `walletCount` at `WalletListHeader.tsx:72-76`), while `syncCoordinator.parseSyncNetwork` restricts to `BITCOIN_NON_REGTEST_NETWORKS` (`shared/constants/bitcoin.ts:13`) and `walletRepository.findByNetworkWithSyncStatus` (:116-131) does an exact string match that never returns it. The wallet is not reported as rejected/deduplicated/indeterminate — it is invisible in the response. **Requires the user to own a regtest wallet** (creatable only via API/import — `server/src/api/wallets/crud.ts:61` `z.enum(BITCOIN_NETWORKS)`); confirm before acting. Not permanently unsyncable: `findStale` has no network filter.

---

### Cross-cutting root cause D — the failure reason exists but is never displayed anywhere useful

- The API **does** ship it: `server/src/services/wallet/walletQueries.ts:112` (list) and :207 (detail); typed at `server/src/services/wallet/types.ts:108` and `src/types/index.ts:510`. No server-side stripping (`server/src/api/wallets/crud.ts:128-132` is a raw pass-through; `walletRepository.ts:491-506` uses `include`, not `select`), no client-side Zod stripping (`shared/schemas/walletResponses.ts:59-65` `WalletSchema` is a `z.looseObject`), no react-query `select`.
- Frontend consumers, exhaustively: `src/components/WalletDetail/WalletHeader.tsx:152/163/175`, `src/components/WalletDetail/walletSyncStatusBadgeStatus.ts:72`, `src/components/WalletDetail/hooks/walletDataFormatters.ts:57`. **Zero** in WalletList, Dashboard, sidebar, or the cells table.
- The one inline rendering is gated on a hardcoded string: `WalletHeader.tsx:39-41` `isNetworkSyncOffMessage` = `/sync is off in Node Configuration/i`, gating :151-166. Electrum refusals, TLS failures, canonical-policy errors, timeouts, abort messages — none match, so none get a banner. The neighbouring "Wallet not synced" banner is additionally gated on `!wallet.lastSyncedAt`.
- The same hardcoded gate is duplicated on the manual-sync path: `src/components/WalletDetail/hooks/useWalletSync.ts:17,79-85` — every non-matching error is `log.error` to the browser console and nothing else.
- Even the tooltip fallback is narrow: `getWalletSyncStatusDescriptor` (`walletSyncStatusBadgeStatus.ts:97-107`) is an ordered chain; `syncingDescriptor` wins with `title: ""` whenever `syncInProgress` is true, and 'resyncing'/'partial' never reach the failed branch. `lastSyncError` is reachable in a tooltip **only** when `lastSyncStatus==='failed' && !syncInProgress && !syncing`.
- The comparison surfaces drop it entirely: `src/components/cells/WalletCells/SyncCell.tsx:21-28` (visible text, no reason, no `resyncing` branch → "Pending"); `src/components/WalletList/WalletGridCardMetadata.tsx:26-44` (bare `title="Sync failed"`); `src/components/Dashboard/WalletSummary.tsx:49-58` (`getSyncTooltipText` hardcodes `'Sync failed'`, no `resyncing` branch, and its mapper `src/components/Dashboard/hooks/dashboardDataModel.ts:66-82` **drops `lastSyncError` from the object it builds**); `src/components/Layout/SidebarContent/sidebarItems.tsx:13-18` collapses everything unrecognized to `'pending'`, and `src/components/Layout/SubNavItem.tsx:36` renders `title={statusDot}` — a tooltip that echoes the collapsed word.
- No compensating notification channel: `'sync_error'` exists as a type at `src/contexts/AppNotificationContext.tsx:19` and an icon-map key at `src/components/NotificationPanel/notificationPanelHelpers.tsx:19` with **zero producers** anywhere.
- Tooltip infrastructure: there is no `Tooltip` in `src/components/ui/` and no general-purpose overlay component (`src/components/Dashboard/PriceChart/ChartTooltip.tsx` is Recharts-bound). But there **is** plenty to build on: the `.tooltip-popup` / `.tooltip-arrow` / `.tooltip-arrow-centered` CSS pair in `src/index.html:928-981` with hover activation (`.tooltip-trigger:hover`, `.group\/fee:hover`, `.group\/sync:hover`) and a controlled-open class `.tooltip-visible`; the shared `src/hooks/useDismissable.ts` (outside-click + Escape); and a focusable, touch-dismissible reference implementation at `src/components/BlockVisualizer/QueuedSummaryBlock/QueuedSummaryBlockView.tsx:20-23,74-88,191`. `src/components/Dashboard/WalletSummary.tsx:264-273` already renders a per-wallet hover sync tooltip. Accessibility caveat: no `:focus-within` rule exists for tooltips in `index.html`, and `.tooltip-popup` sets `pointer-events: none`.

---

### Cross-cutting root cause E — the support bundle structurally cannot carry sync evidence

- `server/src/services/supportPackage/collectors/registry.ts:43` `getCollectors()` has **no production consumer** (only `collectors/index.ts:12` re-export and three test files). `runner.ts:185` reads `getShareableCollectors()` only.
- The ~25 collectors registered via plain `registerCollector` are dead code — including `wallets` (`collectors/wallets.ts:12`), `sync`, `walletLogs`, `jobQueue`, `workerHealth`, `electrumPool`, `database`. The admitted set is exactly 7 (`config` + 6 `notification*`), pinned by `server/tests/unit/services/supportPackage/shareableProfile.test.ts:36-44`.
- The second downloadable profile (`incidentProfile.ts`, `POST /api/v1/admin/support-package/incident`) bypasses the registry entirely and emits only notification-incident enums over one txid.
- **The current `wallets` collector cannot simply be admitted.** `privacy.ts:146-169` `serializePrivacySafeArtifact` scans the final bytes of the whole artifact and throws; `runner.ts:228` has no try/catch; `server/src/api/admin/supportPackage.ts:109-110` turns it into a blanket 503. `FORBIDDEN_BYTE_PATTERNS` (`privacy.ts:89-96`) include `/\b[a-f0-9]{64}\b/i`, base58/bech32 address patterns, the xpub family, credentialed URLs, and a key-name regex matching `walletId|userId|txid|jobId|token|secret|…`. Raw `lastSyncError` (written verbatim at `syncJobs.ts:199/220/235`, `walletSync.ts:351/409`) can echo a relayed Electrum server string (`electrum/protocol.ts:66-68`) or `Node returned unexpected txid ${txid}` (`blockchain/networkOperations.ts:73`) — intermittent and host-dependent, so it would generate fine locally and 503 on the user's box.
- The 16 KiB `MAX_COLLECTOR_BYTES` cap is **also** whole-package fail-closed: `validateCollectorData` (`runner.ts:108-120`) throws and is invoked at :165 *outside* the inner catch, so the rejection propagates to `runner.ts:203-205`. Only collector *timeout* and *internal error* degrade gracefully. `walletRepository.findAllWithSelect` (:432-440) has no `take`, so an unbounded row list is fatal.
- `truncated`/`droppedCount` are section-level fields hardcoded by the runner (`runner.ts:169-170`, :53-54) and validated by `sectionBase` (`privacy.ts:34-38`) — a collector cannot set them.
- `requestedFullResyncGeneration` / `processedFullResyncGeneration` (`server/prisma/schema.prisma:146-147`) are read nowhere outside `resyncRepository.ts` — not in `walletQueries.ts:110-113`/:205-208, not in `findByNetworkWithSyncStatus`, not in `getSyncStatus`, not in the collector select, not in `src/types/index.ts`. (Narrow exception: the requested side leaks into `collectors/deadLetterQueue.ts` via verbatim `entry.payload`.)
- **Important caveat on interpreting the drift** (see §2): `reserveFullResyncGeneration` runs *before* `queue.add` and is never rolled back, so a deduplicated outcome permanently increments `requested` while the retained job stamps an older value into `processed`. Drift is an **upper bound** on missed resets, not proof of one. Conversely `enqueueFullResyncBatch` with a null queue returns `queue_unavailable` *without* reserving, so a fully dead path shows drift 0.
- `SupportPackageCard.tsx:237-241` currently promises the aggregate profile excludes "wallet and transaction data … and raw errors". Adding wallet-sync aggregates makes that copy false; it must change.

---

## 2. How to confirm on the remote box

All commands are READ-ONLY. Run them in this order.

### 2.0 Generation drift — run this first

```sql
-- A: the headline signature.
SELECT id, name, network,
       "lastSyncStatus", "syncInProgress", "lastSyncedAt", "lastSyncError",
       "requestedFullResyncGeneration" AS req,
       "processedFullResyncGeneration" AS proc,
       "requestedFullResyncGeneration" - "processedFullResyncGeneration" AS drift
FROM wallets
ORDER BY drift DESC, "lastSyncedAt" NULLS FIRST;
```

Interpretation — **drift alone is not proof** (each deduplicated click permanently burns a generation, §1 E):

| Reading | Means |
|---|---|
| `drift = 0` for all 3 wallets | No resync request was ever reserved, or every one completed. Points at C5 (regtest exclusion) or a fully dead queue path (`queue_unavailable`, which never reserves). |
| `drift = 1..2` | Consistent with normal deduplication. Weak signal on its own. |
| `drift >= 3` **and** `lastSyncStatus <> 'resyncing'` **and** transactions still present | Strong: repeated clicks were accepted/deduplicated and no reset ever executed. B1 or B4. |
| `drift > 0` **and** `lastSyncStatus = 'resyncing'` **and** `transactionCount = 0` | The reset *did* run; the sync then failed or was interrupted. B3 / A5. |

### 2.1 Distinguish "reset ran" from "reset never ran"

```sql
-- B: did the destructive reset execute? (resetWalletForFullResync deletes all txs)
SELECT w.id, w.name, w."lastSyncStatus", w."syncInProgress", w."lastSyncedAt",
       count(t.id) AS tx_count
FROM wallets w
LEFT JOIN transactions t ON t."walletId" = w.id
GROUP BY w.id
ORDER BY tx_count ASC;
```

`tx_count = 0` + `lastSyncStatus='resyncing'` + `lastSyncedAt IS NULL` ⇒ B3 fired and the rebuild did not complete.

### 2.2 The stranded / orphan state fingerprints

```sql
-- C: A5 — cleared flag, orphaned status, no reason.
SELECT id, name, "lastSyncStatus", "syncInProgress", "lastSyncedAt", "lastSyncError"
FROM wallets
WHERE "lastSyncStatus" IN ('resyncing','retrying')
  AND "syncInProgress" = false
  AND "lastSyncError" IS NULL;

-- D: A4 — orphaned in-memory retry.
SELECT id, name, "lastSyncStatus", "lastSyncError", "syncInProgress", "lastSyncedAt"
FROM wallets
WHERE "lastSyncStatus" = 'retrying';
-- lastSyncError ending in '(retrying N/3)' + syncInProgress=false = orphaned timer.

-- E: A3 — reassuring green badge over a dead wallet.
SELECT id, name, "lastSyncStatus", "lastSyncedAt",
       now() - "lastSyncedAt" AS age, "lastSyncError"
FROM wallets
WHERE "lastSyncStatus" = 'success'
  AND "lastSyncedAt" < now() - interval '1 hour'
ORDER BY age DESC;

-- F: A6 — false-idle mid-resync.
SELECT id, name, "lastSyncStatus", "syncInProgress", "lastSyncedAt"
FROM wallets
WHERE "lastSyncedAt" IS NULL;
-- expect lastSyncStatus='resyncing', lastSyncError IS NULL, syncInProgress=false

-- G: C5 — regtest wallets rendered under the Mainnet tab.
SELECT network, count(*) FROM wallets GROUP BY network;
-- any 'regtest' row means those wallets are excluded from every network resync batch
```

### 2.3 Redis — the pinned dedup key (B1) and the held lock

```bash
# Enter redis-cli read-only. Substitute the compose service/password as configured.
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning <<'EOF'
INFO memory
SCAN 0 MATCH sanctuary:worker:sync:de:* COUNT 1000
ZCARD sanctuary:worker:sync:delayed
ZRANGE sanctuary:worker:sync:delayed 0 -1 WITHSCORES
LLEN sanctuary:worker:sync:active
LRANGE sanctuary:worker:sync:active 0 -1
ZCARD sanctuary:worker:sync:completed
ZCARD sanctuary:worker:sync:failed
EOF
```

Then, for each `de:` key found:

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning TTL  'sanctuary:worker:sync:de:<b64id>'
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning GET  'sanctuary:worker:sync:de:<b64id>'
# then, with the job id X returned above:
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning EXISTS 'sanctuary:worker:sync:<X>'
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning HGET   'sanctuary:worker:sync:<X>' atm
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning HGET   'sanctuary:worker:sync:<X>' timestamp
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ZSCORE 'sanctuary:worker:sync:completed' '<X>'
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ZSCORE 'sanctuary:worker:sync:failed'    '<X>'
```

**B1 confirmed** when: `TTL == -1` (persistent), the job id decodes (base64url) to `full-resync-attempt:<walletId>:<gen>`, it is present in the **delayed** ZSET, `atm` (attemptsMade) is stuck at `0` while `timestamp` is hours old.
**B4 confirmed** when: the job id is a member of `completed` or `failed` with an old `finishedOn`, i.e. a stale terminal job whose hash was never trimmed.

Wallet lock:

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning KEYS '*lock*sync:wallet*'
# for each key:
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PTTL '<lockkey>'
```

A `PTTL` that keeps *rising back toward ~1_860_000 ms* on repeated reads = a **live** holder refreshing at ttl/3 ⇒ hung sync ⇒ permanent B1 pin. A monotonically decreasing PTTL = an orphaned lock that will self-heal within 31 min.

Also check the duplicated-jobId trace for B4:

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning XRANGE 'sanctuary:worker:sync:events' - + COUNT 200
# look for event=duplicated (B4) vs event=deduplicated / debounced (B1)
```

### 2.4 API

```bash
# The list endpoint already carries lastSyncError — prove the data is on the wire.
curl -sS -H "Authorization: Bearer $TOKEN" "$HOST/api/v1/wallets" \
  | jq '.[] | {id, name, network, lastSyncStatus, lastSyncError, syncInProgress, lastSyncedAt}'

# Server-computed staleness, already exposed and unused by the UI.
curl -sS -H "Authorization: Bearer $TOKEN" "$HOST/api/v1/sync/status/<walletId>" | jq

# Worker-run syncs write into the WORKER's log buffer; this returns [] for them.
curl -sS -H "Authorization: Bearer $TOKEN" "$HOST/api/v1/sync/logs/<walletId>" | jq '.logs | length'
```

### 2.5 Logs

```bash
docker compose logs --since 2h worker | grep -E \
  "Reset stuck syncInProgress flag|Skipping job - lock held|Prepared full resync|synced successfully|sync failed|Auto-unstuck|Safety-net reset"
docker compose logs --since 2h server | grep -E "already syncing, skipping queue|Sync already in progress"
```

- `Reset stuck syncInProgress flag for wallet <name>` with `stuckForMs:'unknown'` every 5 min ⇒ A6.
- `Skipping job - lock held: sync:sync-wallet` (needs `LOG_LEVEL=debug`) ⇒ A1/C3.
- `already syncing, skipping queue` / `Sync already in progress` from the **API** process while no job is running ⇒ A2 `activeSyncs` leak.

---

## 3. The fix

### (a) Backend correctness — ordered

**a1. Stop the silent no-op. `server/src/worker/workerJobQueue/jobProcessor.ts:123-131`.**
`{ skipped: true, reason: 'lock_held' }` must not look like success to anything downstream. Raise the log to `warn` with `walletId`/`lockKey`, and have `syncJobs.ts` record the outcome instead of leaving the row untouched (see a3). Keep the return shape — callers rely on it (`server/tests/integration/worker/workerJobQueueLock.integration.test.ts:79`, `server/tests/unit/worker/workerJobQueue/workerJobQueue.internal-locks.contracts.ts:60`); both tests must be updated.

**a2. Bound the full-resync retry loop. `server/src/worker/workerJobQueue/jobProcessor.ts:126-129` + `server/src/worker/jobs/syncJobs.ts:100-105`.**
`DelayedError` never advances `attemptsMade`, so the loop is unbounded. Add an explicit re-delay budget carried in `job.data` (e.g. `lockRetryCount`), and once it exceeds a cap (suggest 12 ≈ 60 s, or `SYNC_LOCK_TTL_MS / retryDelay`) fail the job normally so `moveToFinished` runs, the dedup key is released, and `lastSyncError` is written. This is the single change that unblocks a permanently pinned wallet.

**a3. Release the dedup key defensively. `server/src/services/workerSyncQueue.ts:270-291`.**
Add a `ttl` to the `deduplication` option (bounded by `SYNC_LOCK_TTL_MS`) so a key can never outlive any conceivable job, *and* call `queue.removeDeduplicationKey('full-resync:<walletId>')` on the failure path. Note the existing `keepLastIfActive` successor guarantee does not hold while the retained job is `delayed` — fix or delete the misleading comment at :286-288.

**a4. Bound job retention. `server/src/worker/jobs/jobOptions.ts:1-6` (or `server/src/services/workerSyncQueue.ts:64-67`).**
Add `removeOnComplete` / `removeOnFail` (mirror the worker-side 500/250). This closes B4's jobId-collision precondition *and* the unbounded Redis growth against `--maxmemory 128mb --maxmemory-policy noeviction`.

**a5. Fix the `activeSyncs` leak — the likeliest cause of the 3 permanently stuck wallets. `server/src/services/sync/walletSync.ts:56-58`, :96, :186-216.**
Either make the `maxSyncDurationMs` race actually abort `syncWallet()` (pass the abort signal through rather than `await syncPromise`), or add a timestamped entry to `activeSyncs` and reap entries older than `maxSyncDurationMs` in `resetStuckSyncs` (`server/src/services/sync/syncService.ts:523-532`) and in the worker reaper (`syncJobs.ts:307-331`). Today both clear only the DB column, which is the exact source of the "DB says idle, in-memory says busy" divergence.

**a6. Stop the reaper from false-idling in-flight syncs. `server/src/repositories/walletRepository.ts:414-427` + `server/src/worker/jobs/syncJobs.ts:318-330`.**
`lastSyncedAt` is the wrong clock for "how long has this sync been running". Add a `syncStartedAt` (or heartbeat) column written by `syncWalletJob` at :141 and by `walletSync.ts:151`, and bound the reaper on **that**. Also probe the `sync:wallet:<id>` lock before clearing, and skip rows with `requestedFullResyncGeneration > processedFullResyncGeneration` or a fresh `lastSyncStatus='resyncing'`. Apply the same liveness test to the two broader clearers: `syncService.ts:143` (`resetAllStuckSyncFlags`, unconditional on every API start) and `syncService.ts:536-556` (`findStuckSyncing`, no cutoff at all). Note `server/tests/unit/worker/jobs/syncJobs.test.ts:803-829` currently asserts the unbounded NULL arm verbatim and locks the defect in.

**a7. Never leave a status orphaned. Six sites: `syncJobs.ts:267`, `syncJobs.ts:323`, `staleWalletChecker.ts:58`, `syncService.ts:551`, `walletRepository.ts:372`, `syncCoordinator.ts:202`.**
Every one must also normalize `lastSyncStatus` (out of `'resyncing'`/`'retrying'`) and write a `lastSyncError` explaining the reset ("Sync flag cleared by stale-wallet recovery"), so the UI can never show "Never synced" for a wallet whose history was just deleted.

**a8. Do not destroy transactions before the pipeline can prove it will run. `server/src/worker/jobs/syncJobs.ts:128` + `server/src/repositories/resyncRepository.ts:24-74`.**
Move `prepareFullResync` to *after* the pipeline preflight (`pipeline.ts:81-83` node client + block height, and `pipeline.ts:96`'s canonical-address assertion), so an unreachable Electrum or a drifted canonical wallet fails **before** `transaction.deleteMany`. This is the difference between "resync failed" and "resync silently ate your history".

**a9. Fix the residual canonical wedge for legacy wallets. `server/src/services/bitcoin/blockchain/addressDiscovery.ts:91` → `canonicalPolicy.ts:80-93`.**
`assertPersistedCanonicalPolicy` still throws unconditionally for `canonicalPolicyId == null` at phase 10, after the transactions have been rebuilt. Legacy wallets (which the d8a6cc0758 fix deliberately admits at `pipeline.ts:96`) should skip the gap-limit canonical assertion the same way, or degrade to a warning, rather than turning an otherwise successful sync into `lastSyncStatus='failed'`.

**a10. Report enqueue outcomes honestly. `server/src/services/sync/syncCoordinator.ts:313-322`.**
Stop folding `deduplicatedWalletIds` into `queuedWalletIds`. Also report wallets that were **filtered out of the batch entirely** (C5's regtest case) as a distinct bucket, so a success banner can never claim a count that omits a wallet the user can see.

**a11. Bridge worker → UI. `server/src/worker.ts` (new), `server/src/websocket/redisBridge.ts`.**
Adding broadcaster calls to `syncJobs.ts` would emit nothing (§1 A). Two viable shapes — pick one:
- **Preferred:** have the worker publish sync-status events directly into the Redis bridge channel that `WebSocketServer.broadcast` (`clientServer.ts:400`) already publishes to, so the API process fans them out to clients unchanged.
- **Alternative:** subscribe an API-side `QueueEvents` to the `sanctuary:worker`/`sync` queue and re-broadcast on completion/failure.
Also route worker `walletLog` entries across the same bridge so `GET /sync/logs/:walletId` (`syncCoordinator.ts:183-186`) stops returning `[]` for worker-run syncs. `eventService` is a bare in-process `EventEmitter` (`server/src/services/event/walletEvents.ts`) and cannot cross processes — do not rely on it.

**a12. Fix the network-bucketing mismatch. `src/app/networks.ts:90-93` + `src/components/WalletList/walletListData.ts:28-36`.**
`toTabNetwork` silently coerces `'regtest'` → `'mainnet'`. Either surface regtest as its own tab or exclude it from the Mainnet count so the UI and `findByNetworkWithSyncStatus` agree. Gate this on §2.2 query G showing regtest rows actually exist.

---

### (b) The GUI sync-failure visibility feature

**Palette rule for every item below.** `primary`, `warning`, `success`, `sent`, `shared` use **inverted** scales in dark mode (low 50-200 = dark, high 800-950 = light). `sanctuary-*`, `emerald-*`, `rose-*` are standard Tailwind. `success`, `warning` and `sent` **have no 300 or 400 shade** — a class naming a shade the config does not declare emits no CSS and silently inherits. Because these palettes already invert per mode, write the base class only: `text-success-600`, **never** `text-success-600 dark:text-success-400`. `tests/config/themeClassPolicy.test.ts` enforces this and names the offending file and line.

**b0. Introduce a shared status helper — one source of truth. New: `src/utils/walletSyncPresentation.ts` (or `shared/` if the enum is shared).**
Five surfaces independently re-derive the sync presentation and all five get it wrong differently. Extract one function returning `{ tone, label, reason, icon }` from `(wallet, syncRetryInfo?)`, handling **every** persisted `lastSyncStatus` value: `'success'`, `'failed'`, `'retrying'`, `'resyncing'`, `null`, plus an `other` fallback (`'partial'` is declared in the union at `src/types/index.ts:503` and rendered by `SyncCell.tsx:37` but has **no server writer** — keep it mapped, do not build features on it). `reason` must come from `wallet.lastSyncError`. If placed under `shared/`, it falls under the 100% frontend coverage gate and needs `tests/shared/<name>.test.ts` in the same PR.

**b1. Build a reusable focusable Tooltip. New: `src/components/ui/Tooltip.tsx`.**
There is no `Tooltip` in `src/components/ui/` — but do not start from scratch. Lift the pattern from `src/components/BlockVisualizer/QueuedSummaryBlock/QueuedSummaryBlockView.tsx:20-23,74-88,191`: a focusable trigger (`<button>` with `aria-describedby`), `src/hooks/useDismissable.ts` for outside-click + Escape, and the existing `.tooltip-popup` / `.tooltip-arrow` CSS from `src/index.html:928-981` driven by the **controlled** `.tooltip-visible` class rather than `:hover` only (no `:focus-within` rule exists today, and `.tooltip-popup` sets `pointer-events: none`). This makes the reason reachable by keyboard and touch, which the current native `title=` on a non-interactive `<span>` (`src/components/WalletDetail/WalletSyncStatusBadge.tsx:20`) is not.

**b2. WalletDetail badge — read the reason that already exists. `src/components/WalletDetail/walletSyncStatusBadgeStatus.ts`.**
- `retryingDescriptor` (:29-38): change `title` from `syncRetryInfo?.error || "Sync failed, retrying..."` to fall back to `wallet.lastSyncError`. Stop fabricating the attempt count — when `syncRetryInfo` is null (i.e. after every page load, `useWalletSync.ts:55-64`), show "Retrying" without a hardcoded `1/3`.
- Add an explicit `resyncingDescriptor` so `'resyncing'` stops falling through to `notSyncedDescriptor` ("Never synced") for a wallet whose history was just deleted. Tone: `warning` (inverted palette — `bg-warning-100 text-warning-700`, no `dark:` variant, no 300/400 shade).
- Add a staleness tone to `successDescriptor` (:55-64): when `lastSyncedAt` is older than the threshold, do not render the green `bg-success-100 text-success-700` Check. Wire `isStale` from `GET /sync/status/:walletId` (`src/api/sync.ts:54`, currently a dead export; server-side computation already exists at `server/src/services/sync/syncService.ts:324`) or compare client-side against a shared constant. Use `sanctuary-*` (non-inverted) or `warning-*` (inverted) for the stale tone — never `success`.
- Replace `src/components/WalletDetail/WalletSyncStatusBadge.tsx:20`'s bare `title=` with the b1 Tooltip. Two tests assert the current attribute (`tests/components/WalletDetail/WalletHeader.test.tsx:148,157`) and must be updated.

**b3. WalletHeader — stop gating the reason on one hardcoded string. `src/components/WalletDetail/WalletHeader.tsx:39-41,150-176`.**
`isNetworkSyncOffMessage` (`/sync is off in Node Configuration/i`) should select the *banner variant*, not whether a reason is shown at all. Render an inline reason banner for **any** `lastSyncStatus === 'failed'` with a non-null `lastSyncError`, using the existing `src/components/ui/ErrorAlert.tsx` (rose — non-inverted) or `src/components/ui/NoticeAlert.tsx`. Remove the `lastSyncStatus !== 'retrying'` suppression at :173-175 so a never-synced retrying wallet keeps its "Sync Now" affordance. Apply the same change to the duplicated gate on the manual-sync path at `src/components/WalletDetail/hooks/useWalletSync.ts:17,79-85` — every non-matching error currently goes to `log.error` and nowhere else.

**b4. Dashboard — carry the reason through the mapper. `src/components/Dashboard/hooks/dashboardDataModel.ts:66-82` + `src/components/Dashboard/WalletSummary.tsx:49-58,228-262`.**
The mapper is an explicit 13-field whitelist that drops `lastSyncError`; add it (the API already sends it, `walletQueries.ts:112`). Then widen `getSyncTooltipText` — it currently hardcodes `'Sync failed'` and has no `'retrying'` branch, so an actively-failing wallet renders as a neutral `text-sanctuary-400` Clock labelled `Cached from <date>`. Add `'retrying'` and `'resyncing'` branches to both `getSyncTooltipText` and `WalletSyncIcon`, surfacing `lastSyncError`. Note the `as 'success'|'failed'|'partial'|null` cast at :79 is a TS-erased no-op re-widened by the `: Wallet` return type — it does not block adding branches. Keep the existing mobile `role="img" aria-label={getSyncTooltipText(wallet)}` path at :353 working. `tests/components/Dashboard/WalletSummary.test.tsx:106-107` pins the current strings.

**b5. Table + grid — surface the reason on the comparison surfaces.**
- `src/components/cells/WalletCells/SyncCell.tsx:5-50` — add a `'resyncing'` branch (today it falls to "Pending") and attach the b1 Tooltip carrying `lastSyncError` to the "Failed"/"Retrying" states. The visible text label is already better than a tooltip; keep it and add the reason.
- `src/components/WalletList/WalletGridCardMetadata.tsx:26-44` — replace the bare `title="Sync failed"` with the b1 Tooltip and the real reason; add `'resyncing'`. `tests/components/WalletList/WalletGridView.test.tsx:175-177` asserts `getByTitle('Sync failed')` and must be updated.

**b6. Sidebar — stop collapsing failure-adjacent states. `src/components/Layout/SidebarContent/sidebarItems.tsx:13-18` + `src/components/Layout/SubNavItem.tsx:36`.**
`getWalletSyncStatus` recognizes only `syncInProgress`/`'success'`/`'failed'` and returns `'pending'` for everything else, so a wallet in retry backoff or a stranded resync draws the same neutral `bg-sanctuary-400` dot as a brand-new wallet — with a `title={statusDot}` echoing the collapsed word "pending". Add `'retrying'` and `'resyncing'` dot states and pass a real human title (drawn from `lastSyncError` where present) rather than the enum. Note `'resyncing'` initially renders as `'syncing'` because `resyncRepository.ts:59-65` sets `syncInProgress: true` in the same update — it degrades to `'pending'` only after a reaper clears the flag, which is exactly the a7 fix's territory. `tests/components/Layout/SidebarContent.branches.test.tsx:267-269` covers only the three handled cases today.

**b7. Network resync result — name the wallets, use the right severity. `src/components/NetworkSyncActions/useNetworkSyncActions.ts:22-39,76-88` + `NetworkSyncResult.tsx:8-14`.**
Stop passing only `.length` — pass the arrays so `walletId` and `reason` survive, and resolve ids to wallet names. Stop hardcoding `type: 'success'`: when `accepted === 0` (the "Queued 0 wallets for resync; N already queued" case) or when `rejectedWallets.length > 0`, render a warning/error tone. Do not auto-clear a non-success result after `RESYNC_RESULT_TIMEOUT_MS = 8000` (:15,:88) — a partial failure must persist until dismissed. Palette: success path `text-success-600` (inverted, no `dark:` variant); failure path `text-rose-600 dark:text-rose-400` (rose is **not** inverted, so the explicit dark variant is correct and must stay).

**b8. Per-wallet resync toast — stop lying. `src/components/WalletDetail/hooks/useWalletSync.ts:112-124`.**
Read `result.status` (declared and currently dead at `src/api/sync.ts:66-78`). `'accepted'` → `showSuccess`. `'deduplicated'` → `showWarning` with a distinct title (e.g. "Already Queued") and a longer dismiss timeout, so a permanently dedup-blocked wallet is visually distinguishable from a working resync. `tests/components/WalletDetail/hooks/useWalletSync.test.ts:181-197` currently asserts the unconditional success and must be updated.

**b9. Stop fabricating `lastSyncedAt` in the cache. `src/hooks/websocket/useWebSocketQueryInvalidation.ts:97,110` + `src/hooks/queries/useWallets.ts:163,176`.**
`...(!syncInProgress && { lastSyncedAt: new Date().toISOString() })` stamps "now" into the cache on *any* terminal sync event, including `status: 'failed'`. Only apply it when the event's status is a success, or better, accept only a server-supplied timestamp — as `src/components/WalletDetail/hooks/useWalletWebSocket.ts:111-113` already correctly does (`data.lastSyncedAt ? … : prevWallet.lastSyncedAt`). This is why detail and list currently disagree.

---

### (c) Support-bundle gap

**c1. New shareable collector `walletSync`. New file under `server/src/services/supportPackage/collectors/`.**
Do **not** admit `collectors/wallets.ts` as-is: it is per-wallet, anonymised-id, raw-`lastSyncError` shaped and would fail `validateCollectorData`/`privacy.ts` and 503 the entire package.

Register with `registerShareableCollector('walletSync', { collect, schema, sourceProcess: 'database_shared', sourceKind: 'aggregate_query', authoritativeFor, notAuthoritativeFor })`.

Emit **aggregate-only, strictly categorical** data — no wallet ids, names, descriptors, addresses, or per-wallet rows. Aggregate-only removes the row cap, the 16 KiB section limit (also whole-package fail-closed, `runner.ts:108-120,165,203-205`) and the anonymiser from the problem at once:

- `totalWallets` (bounded int; bounded ints are already precedented — `notificationRuntimeSchemas.ts` `countObservation` allows `.min(0).max(1_000_000)`).
- `byStatus: { success, failed, retrying, resyncing, never_synced, other }` — the `other` bucket is required because `'partial'` is a legal legacy value with no current writer.
- `byNetwork: Record<'mainnet'|'testnet3'|'testnet4'|'signet'|'regtest', {...}>` — **required**, or symptom (3) is unanswerable: "Resync all" is per-network *and* per-user (`syncCoordinator.resyncNetwork` → `findByNetworkWithSyncStatus(userId, network)`), so an instance-wide aggregate cannot distinguish "never in the batch" from "batch ran and failed".
- `syncInProgressCount`, `stuckCandidatesCount` (`syncInProgress = true AND lastSyncedAt older than the stale threshold`) and `lastSyncAgeBuckets`. These, not `errorClasses`, are the primary stuck-detector: a wallet stuck with `syncInProgress=true` and `lastSyncError=null` contributes no error class.
- `fullResync: { pendingCount, maxDrift: enum('none','one','two_to_five','six_plus') }`. **Drop `staleRequestAgeBucket`** — it is uncomputable: nothing timestamps the generation increment and `Wallet.updatedAt` is `@updatedAt` (`schema.prisma:150`), bumped by every sync write. Adding it requires a new `fullResyncRequestedAt` column written in `reserveFullResyncGeneration` (`resyncRepository.ts:11-18`) — a third column plus a migration, not "two columns, one collector".
- `errorClasses: Record<enum('electrum_unavailable'|'node_rpc_unavailable'|'descriptor_policy_missing'|'canonical_evidence_missing'|'lock_contention'|'timeout'|'database_unavailable'|'other'), int>` — derived by matching `lastSyncError` against a fixed local pattern table and emitting **only the enum label**. The raw string must never enter the artifact.

Field names must avoid the literal substrings `walletId|userId|txid|jobId|payload|rawError` — `shareableProfile.test.ts:53` asserts the serialized bundle never matches that regex.

Implementation shape: put the aggregate in a dedicated repository doing `GROUP BY` in SQL (mirroring `supportNotificationDiagnosticsRepository`) rather than `walletRepository.findAllWithSelect` pulling every row into the API process, and wrap with `.catch(() => ({ observation: 'unavailable' }))` so the section degrades instead of failing the package.

**c2. Update the admitted-collector roster test. `server/tests/unit/services/supportPackage/shareableProfile.test.ts:36-44`.**
It asserts the exact sorted key list. Adding any shareable collector fails it until updated — an unconditional cost of this change.

**c3. Add two authorities. `server/src/services/supportPackage/collectors/types.ts:54` — `SUPPORT_PACKAGE_AUTHORITIES`.**
E.g. `'wallet_sync_state'`, `'wallet_full_resync_intent'`.

**c4. Correct the UI copy. `src/components/Settings/SupportPackageCard.tsx:237-241`.**
It currently promises the aggregate profile excludes "wallet and transaction data … and raw errors". Adding wallet-sync aggregates makes that sentence false as written. Rewrite it to state that wallet **counts and status categories** are included while identities, transactions and raw error text are not.

**c5. Optionally admit the infrastructure half.** `walletSync` alone is not sufficient for a full diagnosis: `sync`, `walletLogs`, `jobQueue`, `workerHealth`, `electrumPool` are all dead legacy collectors too. Each needs the same categorical rewrite before admission. Scope as a follow-up; `walletSync` is the minimum that makes symptoms (1)-(3) falsifiable.

---

## 4. Tests required

Project rule: **write the failing test first, then fix.** Backend coverage must be run scoped: `cd server && npx vitest run --coverage tests/unit`. Anything landing under `shared/` is subject to the 100% frontend coverage gate and needs `tests/shared/<name>.test.ts` in the same PR.

### Backend

| Test file | Case it must assert (before the fix, must fail) |
|---|---|
| `server/tests/unit/worker/workerJobQueue/workerJobQueue.internal-locks.contracts.ts` | A non-`fullResync` job whose lock is held records a durable outcome (status/error write or a `warn`-level log) rather than resolving silently. **Existing lines 60 and `workerJobQueueLock.integration.test.ts:79` currently assert the silent `{skipped:true}` and must be updated, not merely extended.** |
| `server/tests/unit/worker/workerJobQueue/workerJobQueue.internal-locks.contracts.ts` | A `fullResync` job whose lock stays unavailable terminates after a bounded number of re-delays: the job reaches a terminal state, `moveToFinished` runs, and `lastSyncError` is written. Existing lines 63-87 assert `moveToDelayed` + `DelayedError` with no termination assertion. |
| `server/tests/unit/services/workerSyncQueue.test.ts` | The `deduplication` option passed to `queue.add` carries a bounded `ttl`; and on the enqueue failure path `removeDeduplicationKey` is called for `full-resync:<walletId>`. |
| `server/tests/unit/services/workerSyncQueue.test.ts` | A full-resync add whose `jobId` hash already exists in Redis is **not** reported as `'accepted'`. Today `queue.add` is mocked to return `{id: candidateJobId}` (lines 122-224), encoding the happy path; the B4 collision has zero coverage. |
| `server/tests/unit/worker/jobs/jobOptions.test.ts` (new or extend) | `SYNC_WALLET_JOB_OPTIONS` (or the API-side queue `defaultJobOptions`) declares `removeOnComplete`/`removeOnFail`. |
| `server/tests/unit/services/sync/walletSync.test.ts` | A `syncWallet` that never settles does not pin `state.activeSyncs` forever: after `maxSyncDurationMs` the entry is reaped (or the sync is aborted) and a subsequent `syncNow` is not rejected with "Sync already in progress". |
| `server/tests/unit/worker/jobs/syncJobs.test.ts` | A wallet mid-full-resync (`syncInProgress=true, lastSyncedAt=null, lastSyncStatus='resyncing'`, started seconds ago) survives a `check-stale-wallets` tick with `syncInProgress` intact. **Lines 803-829 currently assert the unbounded `{lastSyncedAt: null}` OR-arm verbatim and lock the defect in — that assertion must change.** |
| `server/tests/unit/worker/jobs/syncJobs.test.ts` | The stale re-queue skips a wallet whose `sync:wallet:<id>` lock is held, so a `lock_held` result is never produced by the reaper's own re-enqueue. |
| `server/tests/unit/repositories/walletRepository/walletRepository.mutations.contracts.ts` | `resetAllStuckSyncFlags` and every stuck-flag clearer also normalizes `lastSyncStatus` away from `'resyncing'`/`'retrying'` and writes a `lastSyncError`. **Lines 366-382 currently assert it writes exactly `{syncInProgress:false}`.** |
| `server/tests/unit/worker/jobs/syncJobs.test.ts` | A full resync whose pipeline preflight fails (unreachable node / canonical assertion) does **not** call `transaction.deleteMany`. Existing lines 100-131 and 168-200 assert deletion happens and is not repeated; add the preflight-abort case. |
| `server/tests/unit/services/bitcoin/sync/pipeline.legacyWalletUpgrade.test.ts` | A legacy wallet (`canonicalPolicyId` null, `changeDescriptor` null) completes the full phase list including `gapLimit` without `assertPersistedCanonicalPolicy` throwing. |
| `server/tests/unit/services/sync/syncCoordinator.test.ts` (or `server/tests/unit/api/sync.test.ts`) | `resyncNetwork` reports `deduplicated` wallets separately from `queued`, and reports wallets excluded from the batch by network filtering as their own bucket. |
| `server/tests/unit/worker/jobs/syncJobs.test.ts` (or a new bridge test) | A completed worker sync publishes a sync-status event onto the Redis bridge channel (a1's `a11` fix). Currently `syncJobs.test.ts` contains zero broadcast/websocket references. |
| `server/tests/unit/services/supportPackage/walletSyncCollector.test.ts` (new) | The `walletSync` collector output (a) contains no wallet id, name, descriptor, address or raw error string; (b) survives `serializePrivacySafeArtifact` when fed rows whose `lastSyncError` contains a 64-hex txid, a bech32 address, and the literal substring `txid`; (c) emits the `byNetwork` axis; (d) stays under `MAX_COLLECTOR_BYTES` with a large wallet count. |
| `server/tests/unit/services/supportPackage/shareableProfile.test.ts` | The admitted roster includes `'walletSync'` (lines 36-44) and the full serialized bundle still fails the forbidden-substring regex check at line 53. |

### Frontend

| Test file | Case it must assert |
|---|---|
| `tests/utils/walletSyncPresentation.test.ts` (new; `tests/shared/...` if placed under `shared/`) | Every persisted status — `'success'`, `'failed'`, `'retrying'`, `'resyncing'`, `null`, `'partial'`, an unknown string — maps to a defined tone/label, and `reason` is populated from `lastSyncError` wherever it is non-null. **100% branch coverage required if under `shared/`.** |
| `tests/components/ui/Tooltip.test.tsx` (new) | The tooltip opens on focus and on click/tap, closes on Escape and outside click, and its content is associated to the trigger via `aria-describedby`. |
| `tests/components/WalletDetail/WalletHeader.test.tsx` | A wallet with `lastSyncStatus='failed'` and an arbitrary `lastSyncError` (e.g. `connect ECONNREFUSED`) renders that reason inline, not only in a native `title`. **Lines 148 and 157 currently assert the `title` attribute and lines 205-209 assert the network-sync-off-only banner — both must change.** |
| `tests/components/WalletDetail/WalletHeader.test.tsx` | `lastSyncStatus='retrying'` with `syncRetryInfo === null` does **not** render a fabricated "Retrying 1/3", and its title is `wallet.lastSyncError`, not the generic "Sync failed, retrying...". **Lines 139-149 currently assert exactly the fabricated output.** |
| `tests/components/WalletDetail/WalletHeader.test.tsx` | A wallet with `lastSyncStatus='resyncing'`, `lastSyncedAt=null`, `syncInProgress=false` does **not** render "Not Synced"/"Never synced". |
| `tests/components/WalletDetail/WalletHeader.test.tsx` | A wallet with `lastSyncStatus='success'` and a `lastSyncedAt` far in the past does not render the green `success` badge. |
| `tests/components/WalletDetail/hooks/useWalletSync.test.ts` | `resyncWallet` resolving with `status: 'deduplicated'` calls `showWarning` (distinct title), not `showSuccess`. **Lines 181-197 currently assert `showSuccess("queued","Resync Queued")` unconditionally.** |
| `tests/components/WalletDetail/hooks/useWalletSync.test.ts` | A `handleSync` error whose message does **not** match `/sync is off in Node Configuration/i` still surfaces a user-visible toast (today it only hits `log.error`). |
| `tests/components/Dashboard/WalletSummary.test.tsx` | `lastSyncStatus='retrying'` renders a failure-toned icon and a tooltip containing `lastSyncError`, not a neutral Clock reading `Cached from <date>`. **Lines 85-109 pin the current strings.** |
| `tests/components/Dashboard/hooks/dashboardDataModel.test.ts` (new or extend) | `mapApiWalletToDashboardWallet` carries `lastSyncError` through. |
| `tests/components/WalletList/WalletGridView.test.tsx` | The failed card exposes the actual `lastSyncError`, and a `'resyncing'` wallet is not labelled "Pending sync". **Lines 175-177 assert `getByTitle('Sync failed')` / `getByTitle('Pending sync')`.** |
| `tests/components/cells/WalletCells/SyncCell.test.tsx` | `'resyncing'` renders a distinct state (not "Pending"), and the "Failed" state exposes the reason. |
| `tests/components/Layout/SidebarContent.branches.test.tsx` | `'retrying'` and `'resyncing'` produce distinct dot states with human-readable titles, not `'pending'` with `title="pending"`. **Lines 267-269 cover only the three handled cases.** |
| `tests/components/NetworkSyncActions.branches.test.tsx` | A batch with `acceptedWalletIds: []` and `deduplicatedWalletIds: ['w1','w2']` renders a **non-success** tone; a batch with `rejectedWallets` names the affected wallets and their reasons; a non-success result is **not** auto-cleared after 8000 ms. **Lines 113-121, 140-155, 162-177 and 181-201 all pin the current count-only green behaviour.** |
| `tests/hooks/websocket/useWebSocketQueryInvalidation.branches.test.tsx` | A sync event with `inProgress:false, status:'failed'` does **not** stamp `lastSyncedAt` into the cache. **Lines 88-146 currently only exercise the success/syncing cases.** |
| `tests/hooks/queries/useWallets.test.tsx` | Same assertion for `useUpdateWalletSyncStatus`. **Lines 302-320 pin the current unconditional stamp.** |
| `tests/config/themeClassPolicy.test.ts` | Runs green after every palette change — it is the enforcement point for the inverted-scale and missing-300/400-shade rules. |

---

## 5. Risks / open questions

**Hypotheses explicitly refuted — do not re-open.** These were investigated and disproven; listing them so they are not rediscovered:
1. *"Stale dedup key + non-active retained job = hard silent drop."* BullMQ reaps the `de:` key on every finalization, removal, and `clean`; the pre-start states (`waiting`/`delayed`/`prioritized`) are legitimate dedup where the retained job will still run. The **live** mechanism is B1's never-finalizing delayed loop, not an orphaned key.
2. *"Generation reservation before `queue.add` causes silent no-ops."* The drift is real but inert — no downstream reader gates on it; a fresh generation is always > `processed`, so the wipe always executes.
3. *"Redis 128 MB `noeviction` freezes the queue."* Under a global OOM, `Job.getState()` (an EVALSHA) fails, producing `indeterminate` → HTTP 503, not a false success; and a global freeze cannot produce a partial 3-of-N symptom.
4. *"Stagger puts wallets into `delayed` where `keepLastIfActive` cannot store a successor."* Dedup ids are per-wallet and injective; wallets never dedup against each other.
5. *"Dead-letter retry strips dedup and degrades a resync."* No frontend surface exists for DLQ retry; the generation replay is deliberate exactly-once semantics.
6. *"`getSyncStatus` reports in-memory state."* True but unreachable — `/sync/status/*` and `/sync/queue/*` have zero frontend callers.
7. *"`ensureGapLimit` fails wallets with descriptor+changeDescriptor but no canonical policy."* That row shape is DB-illegal (CHECK constraint) and unproducible.
8. *"Pipeline canonical guard fails wallets with canonical id but incomplete address evidence."* No writer can produce that state in v0.8.64.
9. *"`findStale` excluding `syncInProgress=true` removes a wallet permanently."* Bounded by an in-handler reaper whose clock cannot advance while the flag is set.
10. *"`resetWalletSyncState` has no frontend caller."* True but inert — three automatic reapers perform the identical mutation.
11. *"Network filtering uses raw string equality."* True, but migration `20260505000000` rewrote `'testnet'` → `'testnet3'` and every write surface is enum-constrained. Only the **regtest display mismatch** (C5) survives.
12. *"Redis-down makes `queueNetworkSync` return `queued:0` silently."* `rateLimitByUser('sync:batch')` fails closed with 503 before the handler is reached.
13. *"`'resyncing'` renders as an indefinite spinner."* It renders as "Not Synced"/"Pending" — the opposite; the spinner is driven by `syncInProgress` alone.
14. *"`cachedDescriptor` shows the same green check as success."* `bg-sanctuary-100 text-sanctuary-600` (gray) vs `bg-success-100 text-success-700` (green); different label too.
15. *"The WS handler drops the failure reason."* True at `useWalletWebSocket.ts:106-114`, but the HTTP refetch overwrites within one round trip, and the full-resync path emits no WS event at all.
16. *"The incident profile is scope-gated, not privilege-gated, so no GUI action yields sync evidence."* The Log tab exists for every user; and dead collectors cannot cause a sync failure.
17. *"No reusable Tooltip means the feature must be built from scratch."* False — see b1's existing primitives.

**Open questions requiring the user's data before acting:**
- **Which of B1 (live hung lock) vs B4 (jobId collision) is actually hitting?** §2.3's `TTL == -1` + `atm == 0` + delayed-ZSET membership vs `completed`/`failed` membership discriminates them. B4 additionally requires evidence of a backup restore or Postgres rollback; if `drift` is large and the wallets have been resynced many times, B4 is ruled out (it is self-limiting to K clicks).
- **Is there a regtest wallet?** §2.2 query G. If not, drop a12/C5 entirely.
- **Did the transactions survive?** §2.1 query B. If `tx_count = 0` on any of the three, B3 already destroyed history and the a8 reordering becomes urgent rather than merely correct — and the user needs to know the data is only recoverable by a successful resync.
- **Is the PTTL on `sync:wallet:<id>` rising or falling?** Rising = a live hung Electrum call, which is a *separate* underlying fault (network/node) that a2/a3 will surface but not cure.

**Implementation risks:**
- **a2's re-delay budget must not regress legitimate contention.** A full resync genuinely queued behind a running ordinary sync should still wait; the cap needs to exceed a normal sync duration or be expressed as "give up after `SYNC_LOCK_TTL_MS`", not a small fixed count.
- **a6 requires a schema migration** (`syncStartedAt`). Version-sync across the four `package.json` files applies, and the migration must not rewrite data.
- **a8 (reordering the destructive reset) changes full-resync semantics.** A resync that previously "always cleared" will now refuse to start when Electrum is down. That is correct, but it is a behaviour change users may perceive as a new failure.
- **a11's bridge is the largest single change** and touches the WS transport. It is also what makes every GUI item in (b) actually update live rather than on refresh. Consider landing (b) first (it works on refresh) and a11 second, so the visibility feature is not blocked on the transport work.
- **The support-bundle `errorClasses` pattern table can go stale silently.** If a new error string form appears, it lands in `other` and the bundle quietly loses fidelity. Same class of hazard as the `runtimeSurface` field in audit waivers — nothing checks it.
- **c1's `byNetwork` axis is instance-wide while `resyncNetwork` is per-user.** A wallet owned by another user will never appear in a given user's batch; the collector cannot express that, so a diagnosis from the bundle must not conclude "the batch skipped it" from network counts alone.
- **Existing tests encode most of these defects as intended behaviour.** At least 14 named test cases must be *changed*, not merely added. Batch all related fixes before pushing — do not fix one file at a time and re-push.