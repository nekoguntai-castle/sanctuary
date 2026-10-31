# Bug-scrub loop 20261013 — iteration 21 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 21
- **Source SHA:** `c80fe34121d463f3f88fd51cbf582d305fdbc594` (`main`, after #1423)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (3 × P2):**
  - A1 `draft-create--inflight-broadcast-intent-draft-never-archived`
  - A2 `network-status--public-route-opens-fresh-electrum-connection-per-request`
  - C1 `compose-worker--intelligence-analysis-cannot-reach-llm-egress-proxy`

  Every finding was re-verified from source at `c80fe34121d4` (file:line in each phase), and every fix was prototyped
  test-first on a scratch copy of that tree.
- **Deferred P3s:** every other iteration-21 finding (17 P3s, including `two-factor-enable--no-password-step-up` and
  `notification-webhook--partial-channel-success-drops-transaction-webhooks`) is backlog in run state and is
  **outside this fix set**.
- **Scratchpad (`$SCRATCH`):** `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`.
  - Prototype diffs: `plan21-{A1,A2,C1}-prototype.patch`. Red-run outputs: `p21-{a1,a2,c1}-red.txt`.
  - All three patches apply together on `c80fe34121d4` (`git apply --check`; 27 files, +768/−49).
  - A prototype is guidance; where the two differ, the phase text below governs. The plan adds three files the
    prototypes do not touch (A1: `scripts/quality/safety-catch-allowlist.json`; C1: `llm-egress-proxy/README.md` and
    `llm-egress-proxy/src/endpointPolicy.ts`), and changes the prototypes' A1 integration case, A2 TTL and C1 rollback
    helper call as the phases state.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `draft-create--inflight-broadcast-intent-draft-never-archived` | P2 |
| A2 | `network-status--public-route-opens-fresh-electrum-connection-per-request` | P2 |
| C1 | `compose-worker--intelligence-analysis-cannot-reach-llm-egress-proxy` | P2 |

## Open questions

These are decided; none blocks the plan.

- **OQ-A1 (coordinator).** Close the window at both ends.
  - `claimBroadcast` and `lockDraftableIntent` both UPDATE the same intent row, so they serialise. If the claim commits
    first, a draft lock that requires `broadcastState: 'ready'` waits, matches nothing, and is refused. If the draft
    lock commits first, the claim still succeeds afterwards with metadata frozen without a `draftId`, so refusing
    alone leaves that race open.
  - Therefore: (a) refuse to bind a draft to an intent whose broadcast has started (409
    `intent_broadcast_in_flight`); (c) when a broadcast is accepted, archive every draft bound to that signing intent
    inside `persistTransaction`'s own transaction; (b) when a replayed broadcast finds the intent already `complete`,
    archive its drafts (best effort, warning on failure) so drafts left by earlier incidents are cleaned on the next
    replay.
  - The 409 needs no client change: the send flow already surfaces API errors. Hiding "Save draft" after a broadcast
    attempt is a UX refinement, not this bug.
  - Drafts orphaned before this release are cleaned only by a replay or by expiry. Data repair is not authorised.
  - Accepted limitation: archiving leaves the draft's approval requests as they are, as the existing archive by
    `metadata.draftId` in `persistTransaction` already does. `findPendingApprovalsForUser`
    (`policyRepository.ts:186-199`) filters only the draft's `approvalStatus`, not its status, so a `pending` request
    on an archived draft can stay listed. It cannot authorize a broadcast (`assertDraftAllowsBroadcast` refuses
    non-actionable drafts). Not fixed here; it stays in backlog.
- **OQ-A2 (coordinator).** Cache the status probe in `networkStatusService`, not only on the route, because the
  logged-in assistant/MCP tool `get_bitcoin_network_status` calls the same function (gap-fill G1).
  - TTL 15 s after a success, 5 s after a failure, single-flight per key (the `utils/async` `singleFlight` used by the
    price-health fix, #1411). The dashboard polls every 60 s and marks data stale after 120 s, so a 15 s TTL never
    shows stale data to it; upstream probes are capped at 4/min per network (12/min while failing).
  - The success TTL is capped at the pool health-check interval when that is shorter:
    `min(15 s, ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS)` (the probe outcome's `healthCheckIntervalMs`). The operational
    projection marks a server `stale` when `now - lastHealthCheck > 2 × interval + 5 s`
    (`nodeOperationalStatus.ts:52`, `:119`); at the 30 s default a cached probe is at most 45 s old against a 65 s
    window, but at 5 s an uncapped 15 s TTL gives up to 20 s against a 15 s window and reports a healthy server as
    stale.
  - Key: network plus a sha256 fingerprint of the `node_config` row (minus health columns) and each eligible server's
    id/host/port/useSsl/priority/serverUsage; `env-default` without a row. The fingerprint is the correctness
    mechanism. `getBitcoinNetworkStatus` has exactly two callers, both in the API process (`api/bitcoin/network.ts:73`
    and `assistant/tools/networkReadTools.ts:131`), and the DB row is read on every call before the cache lookup, so
    every API process or replica misses on its next call after any `node_config` or `electrum_servers` edit, with no
    cross-process notification. Every other probe input is in the row or is process-constant env.
  - `resetNodeClient()` invalidation is an extra: it only drops a probe that straddles a local reset (a generation
    counter keeps such a probe from being stored). The worker's `configChanges.ts` reset has no status cache to clear,
    and admin server-list edits (`adminElectrumServerService.ts:367`) go through `reloadElectrumServers`, which does
    not invalidate and relies on the fingerprint; the test "a config change without a reset" covers that path.
  - Pool mode goes through the same cache, so pool-mode status requests reach the pool (and its circuit breaker) at
    most once per cache period per network instead of once per request. A cache miss still runs `probePool`. Thrown
    errors are shared by in-flight callers but not cached.
- **OQ-C1 (coordinator).** Attach the worker to `llm-egress-network` and give it `LLM_EGRESS_PROXY_URL` and
  `LLM_EGRESS_PROXY_SECRET`.
  - History: when Treasury Intelligence shipped (6c0be5519) the proxy sat on `sanctuary-network` and the worker could
    reach it; the rename e1ebf457a moved the proxy to its own network and attached only the backend. Nothing records
    the worker's exclusion as intended.
  - The isolation the docs state (`llm-egress-proxy/ARCHITECTURE.md:151`, the `docker-compose.yml` comment ≈840-843)
    keeps Postgres and Redis service names off the proxy's network. That stays true: the proxy remains on
    `llm-egress-network` only, and neither Postgres nor Redis joins it.
  - The code already expects worker calls: `WORKER_INTELLIGENCE_RATE_KEY = 'worker:intelligence'`
    (`server/src/services/ai/llmEgressProxyClient.ts:13`, #1390) and the proxy's `rateLimit.ts:43` accepts `worker:`
    keys. Proxy auth is one shared secret for every caller.
  - Consequence (stated in the PR body): the worker's port 3002 (`/health`, `/ready`, `/metrics` and
    `/metrics/prometheus`, unauthenticated, as on `sanctuary-network` today) becomes reachable from the proxy's
    network, as the backend's 3001 already is. The worker runs the same image with the same secrets and database
    access as the backend, so holding the proxy secret adds no new trust. Existing installs pick the network up
    when the worker container is recreated, which an upgrade does.
  - The upgrade test helper `upgrade-wallet-sync-retirement-helpers.sh` picked the worker's first network with
    `head -n 1`; networks sort alphabetically, so `*_llm-egress-network` would come first and the rollback worker would
    lose Postgres. It now picks the network the worker shares with Postgres (`resolve_rollback_worker_network`).

## Goal and non-goals

**Goal.** The three P2s stop reproducing:
- A draft can no longer stay listed as actionable for a payment that is already on chain.
- Status requests (public route and assistant tool) no longer open an Electrum connection per request.
- Treasury Intelligence analysis can reach the egress proxy on a standard Compose install.

**Non-goals.**
- No schema change or migration; no repair of drafts orphaned before this release.
- No change to the status response shape, the route's authentication (backlog P3
  `bitcoin-status--unauthenticated-electrum-topology-disclosure`) or the dashboard.
- No change to the egress proxy's own network membership or to Postgres/Redis networks.
- No client change for the new 409. No version bump. The P3 backlog stays out.

## Decisions

### Cross-cutting decisions

- **D-21.X1 (delivery).**
  - One PR on `codex/bug-scrub-loop/20261013-i21` (worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i21`).
  - One commit per phase (failing test + fix) in the order A1, A2, C1, then the integrator commit (changelog and any
    regenerated `docs/architecture/generated`).
  - Phase workers implement in their own worktrees from the converged plan commit; the coordinator cherry-picks.
- **D-21.X2 (red evidence and setup).**
  - Every new test runs on base code before its fix and must fail for the reason its phase states. An unexpected red
    reason is a stop: record it and re-assess.
  - Setup in the integration worktree: root `npm ci`; `npx prisma generate` in `server/`;
    `npm run build --workspace shared`; about 810 `node_modules` entries in a real directory.
  - Never `server/npm ci`. Never `git stash`. One coverage run at a time host-wide.
  - Commits run in the foreground through the pre-commit hook with nvm node v24.21.0 (npm 12), never while a
    `vitest --coverage` runs on the host.
- **D-21.X3 (pinned surfaces).** No planned change touches:
  - `config/wallet-safety-mutation-map.json`, the Stryker configs, `server/scripts/mutation`,
    `.github/mutation-baseline.json`;
  - `config/wallet-sync-mutation-boundaries.json`, `config/wallet-sync-lifecycle-contract.json`;
  - `server/prisma`, `config/resource-lifecycle-callsites.json`;
  - `scripts/verify-addresses`, `scripts/perf`, `shared/`, `.github/workflows`;
  - `server/src/services/accessControl.ts`, the replay driver.

  Notes:
  - A1's `broadcasting.ts`, `persistTransaction.ts`, `broadcastReconciliation.ts` and A2's `nodeClient.ts` /
    `networkStatusService.ts` are under `server/src/services/bitcoin/**` (wallet-safety critical paths), so the
    wallet-safety full scan runs. `transactionSigningIntentRepository.ts`, `broadcasting.ts` and the
    `transactionServiceBroadcast/*` tests match `is_critical_mutation_file`, so the critical mutation lane runs.
  - `config/hardware-wallet-implementation-inventory.json` lists `broadcasting.ts:broadcastAndSave` by identity only.
    A1 adds no identifier starting with `broadcast` or `finalize`; `tests/ci/signerInventoryGeneration.test.ts` must
    stay green.
  - `scripts/quality/safety-catch-allowlist.json` pins one catch in `getNodeClient`/`attemptPool`; A2 adds no catch
    there. A1 adds exactly one non-terminal catch, the best-effort replay archive in `broadcasting.ts`
    (`archiveReplayedIntentDrafts`), and one matching allowlist entry (Phase A1). Without it
    `npm run check:safety-catch-guards` (and `npm run lint`) fails with a new finding at that function. The guard is not
    evaded with a promise `.catch()`.
- **D-21.X4 (lizard).** Pinned `lizard` 1.24.0 with CI's flags on every changed `.ts`: the per-file warning count must
  not grow, and the repository total stays ≤ the base total. The existing `broadcastAndSave` warning (CCN 20) may grow
  by at most one NLOC line (prototype: 138 → 139); its CCN must not grow.

## Phase A1 — A draft cannot outlive an accepted broadcast of its intent

**Finding.** `draft-create--inflight-broadcast-intent-draft-never-archived` (P2).

**Evidence (base).**
- `server/src/repositories/transactionSigningIntentRepository.ts:137` `lockDraftableIntent` matches
  `{ id, walletId, supersededById: null, source: { not: 'payjoin' } }`; it does not require `broadcastState: 'ready'`
  or `consumedAt: null`. Accepted/complete intents are refused earlier (`loadSigningIntent` → duplicate submission);
  claimed and unknown intents are not.
- A broadcast claimed without a draft freezes metadata without `draftId`, so `persistTransaction` archives nothing
  (`broadcasting.ts` ≈416-421 log only when `metadata.draftId`). A retried broadcast from the draft takes the replay
  path (`broadcasting.ts` ≈319), which does not archive either. Sync cleanup (`reconcileUtxos.ts:155`) only clears
  drafts whose UTXOs are not yet marked spent, and `persistTransaction` already marked them spent.
- Effect: an actionable draft stays listed for a payment already on chain until it expires (risk of paying twice).

**Change** (OQ-A1).
- `transactionSigningIntentRepository.ts`: `lockDraftableIntent` also requires `consumedAt: null` and
  `broadcastState: 'ready'`; new `hasStartedBroadcast(intentId, walletId, client)` distinguishes "broadcast in flight"
  from "superseded" for the refusal reason.
- `draftCreate.ts`: a failed lock with a started broadcast returns 409 `intent_broadcast_in_flight` ("This transaction
  is already being broadcast and cannot be saved as a draft"); the payjoin (409) and `stale_intent` (400) results are
  unchanged.
- `draftSigningIntentRepository.ts`: new `archiveDraftsForSigningIntent(walletId, signingIntentId, client)` deletes
  the UTXO locks of drafts bound to the intent and marks those still `unsigned`/`partial`/`signed` as `broadcasted`.
- `persistTransaction.ts`: optional `{ signingIntentId }`; calls `archiveDraftsForSigningIntent` inside its own
  transaction. `broadcasting.ts` (accepted path) and `broadcastReconciliation.ts` (`reconcileAccepted`, reconciler and
  stalled lookup) pass the intent id.
- `broadcasting.ts` replay path: when the intent is already `complete`, archive its drafts best effort in
  `archiveReplayedIntentDrafts` (a failure is a `log.warn`, and the replay still reports complete).
- `scripts/quality/safety-catch-allowlist.json`: one entry for that catch, in the format of the existing
  `broadcasting.ts` entries:
  `{ "file": "server/src/services/bitcoin/transactions/broadcasting.ts", "functionName": "archiveReplayedIntentDrafts",
  "issue": "non-terminal-catch", "count": 1, "reason": "Replay of an already complete broadcast; draft archiving is
  best effort after the spend is persisted, failure is logged and the draft still expires.", "owner": "fund-safety",
  "targetRemovalSlice": "intentional-post-acceptance-boundary" }`.
- `api/openapi/paths/drafts.ts`: the 409 description documents `intent_broadcast_in_flight`.
- The broadcast route (`api/transactions/broadcasting.ts` `resolveAuthoritativeDraft` /
  `assertDraftIntentMatchesRequest`) makes the draft bound to the intent authoritative, so `metadata.draftId` and the
  intent agree. Archive-by-intent is scoped by `walletId` + `signingIntentId` and needs nothing more.
- Archiving leaves approval requests as they are (accepted limitation, OQ-A1).

**Tests** (prototype; unit tests in the matching files):
- `transactionSigningIntentRepository.test.ts`: the lock's where clause; `hasStartedBroadcast`.
- `draftCreate.test.ts`: 409 `intent_broadcast_in_flight` for a claimed intent; guard: a ready intent still binds.
- `draftSigningIntentRepository.test.ts`: `archiveDraftsForSigningIntent` deletes locks and archives only actionable
  statuses.
- `persistTransaction.test.ts`: archives by intent; guard: nothing touched when no intent is named.
- `broadcastReconciliation.test.ts`: the reconciler and the stalled lookup pass the intent id.
- `transactionServiceBroadcast.broadcastAndSave.claim-states.contracts.ts`: accepted-from-ready archives; a complete
  replay archives; guard: a replay survives an archive failure.
- **Real database:** two cases in a new `describeWithDatabase('draftable intent lock integration')` block of the
  existing `server/tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts` (already in
  `scripts/ci/backend-integration-groups.sh:82`). Both call `lockDraftableIntent` only; `hasStartedBroadcast` stays
  covered by the unit test and is not imported here (on base it does not exist, and calling it would turn the red into
  `TypeError: hasStartedBroadcast is not a function`).
  - Seeds satisfy `transaction_signing_intents_broadcast_state_check` (migration
    `20260810180000_add_signing_intent_broadcast_claims`), as the file's existing seeds do. Claimed and unknown rows
    both need `broadcastTxid`, `broadcastRawTx` and `broadcastMetadata: { amount: 1 }` (non-null) with `consumedAt`,
    `broadcastAcceptedAt` and `broadcastCompletedAt` null; claimed also needs `broadcastLeaseToken` and
    `broadcastLeaseExpiresAt` (for example 60 s out), and unknown needs both lease fields null. Do not copy the
    prototype's seeds (`broadcastTxid` and `broadcastRawTx` only): they violate the constraint, so case 1 fails on head
    with a constraint error instead of a lock result.
  - The one-waiter wait is a new helper, `waitForOneLockWaiter(holderPid)`: it polls `pg_stat_activity` for a
    `wait_event_type = 'Lock'` backend whose `pg_blocking_pids(pid)` contains the holder, needs at least 1 waiter, and
    throws after 3 s. The existing `waitForTwoLockWaiters` requires 2 waiters and is not reused.
  - Reference version (guidance; the bullets here govern): the reviewer's working copy at
    `$SCRATCH/r2-a1/server/tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts`
    (`claimFields()`, `waitForOneLockWaiter`, the `draftable intent lock integration` block). It passes server
    `typecheck:tests`, lizard reports no warnings on base or head, and vitest collects 10 tests.
  - `'refuses to bind a draft to an intent whose broadcast has started'`: ready → `true`; claimed and unknown →
    `false`. On base the claimed intent locks, so it fails with `expected true to be false`.
  - `'a draft lock waiting behind a claim matches nothing once the claim commits'`: a holder transaction, built like
    the file's `holdReplacementLock` (`prisma.$transaction`, reports `pg_backend_pid()`, awaits a release promise),
    moves the ready intent to claimed with the whole claimed field set above (`tx.transactionSigningIntent.update`;
    `broadcastState: 'claimed'` alone violates the constraint) and holds the row. `lockDraftableIntent` starts in a
    second `prisma.$transaction`; the test waits until it is blocked behind the holder (`waitForOneLockWaiter`), releases the holder so the claim commits, and asserts the lock
    resolves `false`. On base the waiting UPDATE re-evaluates a WHERE without `broadcastState`, matches (count 1) and
    resolves `true`, so it fails with `expected true to be false`. This proves the OQ-A1 serialisation claim at READ
    COMMITTED (`draftRepository.withDraftTransaction` and `claimBroadcast` use plain `prisma.$transaction`).
  - Their red is recorded on a guarded base swap (Verification pre-step 1): exactly these two cases fail.

**Red (observed).** 9 new or updated unit tests fail on base for the reasons above; the guards pass.
- `p21-a1-red.txt` records 8 of them. It predates the final prototype patch: in that run the stalled-lookup test
  ("moves a stalled intent that now exists on the node to accepted without rebroadcasting") passed, and the final
  patch then changed its assertion to expect `persist(..., metadata, { signingIntentId: 'intent-1' })`. Base
  `reconcileAccepted` (`broadcastReconciliation.ts:41`) calls `persistTransaction` with 4 arguments, so that case
  fails on base too. `broadcastReconciliation.test.ts` therefore has 2 failures on base (the reconciler and the stalled
  lookup), not 1.
- The implementer re-records the A1 unit red with the final tests before the fix and expects 9 failures.

**Acceptance.** Draft, signing-intent, broadcast and transaction suites pass; both integration cases pass on head;
`signerInventoryGeneration` and `check:safety-catch-guards` pass; lizard per D-21.X4.

## Phase A2 — Status probes are cached and single-flight

**Finding.** `network-status--public-route-opens-fresh-electrum-connection-per-request` (P2).

**Evidence (base).**
- `GET /api/v1/bitcoin/status` (`server/src/api/bitcoin/network.ts`) needs no login and has no cache; the
  assistant/MCP tool `get_bitcoin_network_status` (`networkReadTools.ts:131`) calls the same
  `getBitcoinNetworkStatus()`.
- In singleton mode (the default on every non-mainnet network, and every pool fallback) `probeDirectSingleton`
  (`networkStatus/directClient.ts:29-83`) constructs a new `ElectrumClient`, connects (TLS or a Tor circuit),
  verifies the genesis hash, runs 2 RPCs and disconnects, per request. Only the 1000/min per-IP limit applies. In pool
  mode, timed-out status waits feed the pool circuit breaker.
- Regression from #1007 (`2cab474b5`), which used the cached shared client; same class as the resolved
  `price-health--unauthenticated-live-provider-probe`.

**Change** (OQ-A2).
- New leaf module `server/src/services/bitcoin/networkStatus/statusProbeCache.ts` (TTL cache, single-flight,
  generation counter, `invalidateNetworkStatusCache(network?)`), so `nodeClient.ts` can import it without a cycle.
- `networkStatusService.ts`: split into `runStatusProbe`, `statusProbeFingerprint`, `isProbeConnected`; only the probe
  result (`attemptedAt`, the attempt, the health-check interval, the strategy) is cached. Confirmation thresholds,
  explorer URL, the pool status block and the operational projection (fresh `now`) are built per call; the response
  shape is unchanged and `operational.attemptedAt` reports the cached probe's time.
- Success TTL cap. `statusProbeCache` is a generic leaf that only receives `isSuccess`, so it gains an interface
  change: `getCachedNetworkStatusProbe` and `probeAndStore` take a new `successTtlCapMs(value)` callback, and the
  success TTL is `Math.min(NETWORK_STATUS_SUCCESS_TTL_MS, successTtlCapMs(value))`. The service passes
  `(o) => o.healthCheckIntervalMs`. The failure TTL stays 5 s (OQ-A2).
  - Interval source: `outcome.healthCheckIntervalMs`, which `runPoolAttempt` reads from
    `pool.getOperationalConfigSnapshot()`. That value comes from `ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS`, read once
    per process in `poolRegistry.getEnvPoolConfig`. Outside pool mode the interval is 30 s, so the cap never applies.
  - No new dependency. Reference: `$SCRATCH/r2-capped-cache.ts` and `$SCRATCH/r2-capped-nss.ts` (reviewer's copy).
- `nodeClient.ts`: four invalidate calls, at the start and end of `resetOneNetwork` and `resetAllNodeClients`.
- `server/tests/unit/api/bitcoin/bitcoinTestHarness.ts`: `setupBitcoinApiMocks` invalidates the cache (the harness
  mocks `nodeClient`; without it 5 status contracts fail on leftover cache state).

**Tests.** New `server/tests/unit/services/bitcoin/networkStatusService.cache.test.ts` (12 tests): concurrent and
sequential calls within the TTL; re-probe after the TTL; cached failure; reset invalidation (all networks and one); a
probe in flight across a reset is returned but not stored (guard); a config change without a reset; independent
networks; pool mode; response shape with fresh thresholds; a pool outcome with `healthCheckIntervalMs = 5000` is
reused within 5 s and re-probed after 5 s (not 15 s), and its servers are not reported `stale`.
- TTL-cap test setup: two pool servers, interval 5000, a successful `probePool` on `srv-1`, and `getPoolStats`
  reporting `lastHealthCheck` about 4 s old (`Date.now() - 4000`) on every read. Calls at T0 and T+4 s (1 probe), then
  T+14 s (2 probes), where it asserts `operational.pool.stale === 0`. Without the cap the backup server's stats would
  be 18 s old at T+14 s against a 15 s window and show as stale, so the stale check discriminates only with this
  setup.

**Red (observed).** `p21-a2-red.txt`: 8 of the prototype's 9 fail on base (for example 10 concurrent calls opened 10
direct clients; 6 pool-mode calls made 6 pool probes); "in flight across reset is not stored" is a guard. The
TTL-cap test is new to the plan. The reviewer's run: base fails with `expected to be called 1 times, but got 2` (no
cache: the call at T+4 s probes again); the uncapped prototype fails with `expected to be called 2 times, but got 1`;
head passes 10/10. Its red is re-recorded with the phase commit.

**Acceptance.** networkStatus, nodeClient, api/bitcoin, assistant, worker and admin suites pass; the safety-catch
guard passes; `arch:check` reflects the new `nodeClient → statusProbeCache` edge if the graphs show it.

## Phase C1 — The worker can reach the LLM egress proxy

**Finding.** `compose-worker--intelligence-analysis-cannot-reach-llm-egress-proxy` (P2).

**Evidence (base).**
- `intelligence:analyze` runs only in the worker (`server/src/worker/jobs/intelligenceJobs.ts`,
  `recurringSchedules.ts:204`); `analysisService.ts:367/410` fetches `${LLM_EGRESS_PROXY_URL}/analyze` and
  `/check-provider`.
- `docker-compose.yml`: the worker is only on `sanctuary-network` (≈507-513); `llm-egress-proxy` is only on
  `llm-egress-network`, shared with the backend alone (≈358-360, ≈895-896); the worker has no
  `LLM_EGRESS_PROXY_SECRET`. The backend's health check reaches the proxy, so the UI shows Intelligence as available
  while every analysis fails.

**Change** (OQ-C1).
- `docker-compose.yml`: the worker joins `llm-egress-network` and gets `LLM_EGRESS_PROXY_URL` and
  `LLM_EGRESS_PROXY_SECRET` (same `:?` form as the backend); comment updated. The overlays that render the worker
  (`docker/compose/{prod,offline-core,ssl,tor,monitoring,test}.yml`) inherit it; `start.sh`, `install.sh` and
  `setup.sh` already generate and export the secret.
- `tests/install/utils/upgrade-assertions.sh`: `resolve_frontend_backend_network` generalised to
  `resolve_shared_container_network`, whose `log_error` goes to stderr (`>&2`), because `log_error` writes to stdout
  (`tests/install/utils/helpers.sh:57-58`) and a caller capturing the network name would otherwise capture the error
  text. The existing backend caller keeps its `|| return 1`.
- `tests/install/utils/upgrade-wallet-sync-retirement-helpers.sh`: new `resolve_rollback_worker_network` (the network
  the worker shares with Postgres) replaces `head -n 1`. The caller clears the variable on failure:
  `target_network=$(resolve_rollback_worker_network "$target_worker_container") || target_network=""`, so the
  existing `[ -z "$target_network" ]` guard fails with "could not resolve the target network" instead of creating
  the rollback worker with `--network '<error text>'`.
- Docs: `llm-egress-proxy/ARCHITECTURE.md:151`, `docs/architecture/containers.md` (Worker → proxy edge and boundary
  row), `docs/explanation/scalability-and-performance.md:19`, `llm-egress-proxy/README.md:75` ("...shares only a
  dedicated egress bridge with its callers, the backend and the worker").
- `llm-egress-proxy/src/endpointPolicy.ts:94` (comment only): "Proxy routes are reachable only by secret-holding
  callers (backend, worker); only the backend forwards a provider endpoint, and only from admin settings or admin
  detection." The worker never sends provider endpoints, so the second clause stays true. This runs the
  `full-llm-egress-proxy-tests` lane.

**Tests.**
- New `tests/config/llmEgressProxyCompose.test.ts`: backend and worker are on both networks; their secret matches the
  proxy's; the proxy is only on `llm-egress-network`; that network's members are exactly backend, worker and proxy.
- `tests/install/unit/upgrade-helpers.test.sh`: a `resolve_rollback_worker_network` case plus renamed references,
  and a failure case for `prove_below_floor_rollback_is_unsupported`:
  - Set `TEST_RUNTIME_DIR="$TEST_TMP_DIR"`, `SANCTUARY_CLEANUP_COORDINATED=1` and
    `WALLET_SYNC_RETIREMENT_SOURCE_WORKER_IMAGE`. Stub `get_container_name`, `docker` (disjoint network lists for the
    worker and Postgres; every call logged) and `run_project_compose` (logged as `compose: ...`).
  - Assert exit 1, the output contains "could not resolve the target network", and the call log has no `compose:`
    line and no `docker create`.
  - `TEST_RUNTIME_DIR` is required. Unset, the proof stops at `install -m 600 /dev/null
    /wallet-sync-retirement-rollback.env` before any mutation, so "no docker create" holds on base too (not a red), and
    as root it writes to `/`.

**Red (observed).** `p21-c1-red.txt`: the compose test fails 3 of 5 on base (worker missing the network, worker
missing the URL and secret, network members backend+proxy only); the helper test fails (`resolve_rollback_worker_network`
does not exist). The failure case is new to the plan. In the reviewer's run its base red is the first mutation,
`compose stop worker` (base logs "Starting the exact v0.8.66 worker image", calls compose stop, then fails on
`ownership_label_args: command not found`); head passes (`upgrade-helpers.test.sh` 112 tests). Its red is
re-recorded with the phase commit.

**Acceptance.** `tests/config`, `upgrade-helpers.test.sh` and every install unit suite
(`scripts/ci/run-install-unit-tests.sh`) pass; with `tests/install/utils/compose-contract-env.sh` sourced,
`docker compose config` renders the worker on both networks, with the proxy URL and secret, for the base file and for
the base file plus each overlay that renders the worker (prod, offline-core, ssl, tor, monitoring, test), and the
egress network's members are exactly backend, worker and proxy.
- `scripts/ci/run-install-unit-tests.sh` takes no arguments; it runs `npm ci --prefix tests/ci/lib` and then about 25
  suites in about 130 s (reviewer: 25/25 in 129 s, rc 0, tree clean apart from gitignored output).
- `docker/compose/offline-monitoring.yml` and `offline-tor.yml` are excluded from the render loop: they are not
  standalone renders (each applies only after `monitoring.yml` / `tor.yml`) and do not touch the worker.

## Implementation log (coordinator)

- Phase worktrees were created from the converged plan commit `40b8c1f38`. Each phase commit was cherry-picked with
  `-x` in plan order, proven upstream with `git cherry`, and its worktree and branch removed:

  | Phase | Integrated as | Worker commit |
  |---|---|---|
  | A1 | `239660dea` | `f51fa9c9c` |
  | A2 | `771f0c98d` | `6096cdf1e` |
  | C1 | `fbee1be88` | `7030cf458` |
- Red runs on base, all for the stated reasons: `$SCRATCH/i21-{a1,a2,c1}-red.txt`.
  - A1: 9 unit failures (missing `archiveDraftsForSigningIntent`/`hasStartedBroadcast`, the lock where clause, 400
    `stale_intent` instead of 409, no archive by intent on accept, complete replay or reconcile); guards pass. The
    real-database red on a guarded base swap (`i21-a1-integration-red.txt`): both named cases fail with
    `expected true to be false`, 8 pass, no wrong-reason output. On head: 10 passed.
  - A2: 9 of 10 (10 concurrent calls made 10 probes; the cap test "called 1 times, but got 2"); the in-flight guard
    passes.
  - C1: compose test 3 of 5; `upgrade-helpers.test.sh` 4 failures (renamed reference, two missing functions, the
    failure case reaching `docker create` paths).
- Divergences: A2 adds a NaN-safe expiry check (`!(expiresAt > now)`, a non-numeric
  `ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS` would otherwise cache forever; no new branch). The worker brief named the
  iteration-20 plan file; both A1 and C1 noticed and followed this plan, and A2's report matches it.
- `/simplify` (three reviewers) → `1551b0a6c`: `BROADCASTED_DRAFT_STATUS` in both archive paths; exported
  `PersistTransactionOptions`; one `BROADCAST_NOT_STARTED` filter for the lock and its probe; one `ttlMs` callback;
  an explicit status fingerprint and a typed `serverUseSsl()` accessor; one `waitForLockWaiters` and a `claimFields()`
  seed. Skipped: a shared TTL+single-flight utility (three call sites outside scope), the pre-existing raw
  `broadcastState` literals, and making `log_error` write to stderr everywhere (every install test).
- `npm run arch:graphs` / `arch:calls` left `docs/architecture/generated` unchanged.
- Adversarial implementation review (security reviewer, `$SCRATCH/i21-adversarial.json`): no P0–P2. A1, A2 and C1
  held against every attack tried (single draft-insert path; every route to `complete` archives; wallet-scoped
  archive and 409; failures never cached as success; NaN/zero/negative intervals fall back; the fingerprint follows
  `@updatedAt`; no credentials logged; every overlay and installer supplies the worker secret; the rollback helper
  works when the worker has one network). One **P3**, fixed in `7224e9bd5`: expiry used the wall clock, so a clock
  step back extended a cached success past its TTL; it now uses `performance.now()`. Red
  `i21-a2-red-clock.txt` (the new 11th cache test, 1 failed, 10 passed). The plan's OQ-C1 wording about the worker
  port was corrected (the endpoints are unauthenticated, as on `sanctuary-network` today).
- Verification (2026-10-31), on the integrated branch:
  - First full run stopped at the backend coverage gate (99.99%): `statusProbeCache.ts:105`, single-network
    invalidation with probes in flight, had no test. Covered by a 12th cache test (mainnet and signet in flight,
    reset mainnet: a new mainnet probe starts, signet still joins its running probe).
  - Second full run: typechecks, targeted backend, the three check:* scripts, signer inventory, critical-mutation
    config, the A1 integration spec (10 passed), backend coverage on `tests/unit` at 100%, `tests/config`,
    `upgrade-helpers.test.sh`, the 25 install unit suites, all 7 compose renders, pinned surfaces, the vector tests and
    the 31-file scope passed; it then stopped at a stale shape check (`/simplify` moved `broadcastState: 'ready'` into
    `BROADCAST_NOT_STARTED`). The check was updated.
  - The tail from "# shape checks" then passed with exit 0: shape and changelog checks, root typechecks and
    `test:run`, lint, lizard (base total not exceeded, `broadcastAndSave` 139 NLOC / 20 CCN), large files,
    `arch:check`, boundaries, cycle baseline, OpenAPI route coverage, lifecycle callsites, ownership and supply-chain
    gates, `git diff --check`.

## Verification (before every push)

The integrator runs this block on the integrated branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i21`, after
the three phase commits and the integrator commit, as `bash "$SCRATCH/i21-verify.sh"`.

**Before the block**, in this order:
1. After the three phase commits and before the integrator commit, on a clean tree (before any arch regeneration or
   changelog edit), record the A1 integration red on a guarded base swap. Write it to
   `$SCRATCH/i21-a1-integration-red.sh` and run it with `bash`:
   ```bash
   set -euo pipefail
   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
   SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
   cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i21
   docker info >/dev/null
   BASE=c80fe34121d463f3f88fd51cbf582d305fdbc594
   F=server/src/repositories/transactionSigningIntentRepository.ts
   test -z "$(git status --porcelain)"
   exec 9>/home/nekoguntai/.i21-integration.lock
   flock 9
   trap 'git checkout -- "$F"' EXIT
   git show "$BASE:$F" > "$F"
   RC=0
   npm --prefix server run test:integration:db -- tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts \
     >"$SCRATCH/i21-a1-integration-red.txt" 2>&1 || RC=$?
   git checkout -- "$F"
   git diff --exit-code HEAD -- "$F"
   trap - EXIT
   test "$RC" -ne 0 || { echo "A1 integration cases passed on base" >&2; exit 1; }
   OUT="$SCRATCH/i21-a1-integration-red.txt"
   grep -qE 'Tests +2 failed' "$OUT"
   # one assertion failure per case: both cases must fail on the lock result, not one
   [ "$(grep -c 'AssertionError: expected true to be false' "$OUT")" -ge 2 ]
   grep -qF 'refuses to bind a draft to an intent whose broadcast has started' "$OUT"
   grep -qF 'a draft lock waiting behind a claim matches nothing once the claim commits' "$OUT"
   # `! grep` would be exempt from set -e, so the wrong-reason checks are explicit ifs.
   if grep -qF 'is not a function' "$OUT"; then echo "A1 integration red has the wrong reason" >&2; exit 1; fi
   if grep -qF 'violates check constraint' "$OUT"; then echo "A1 integration red: check constraint" >&2; exit 1; fi
   if grep -qF 'Invalid `prisma' "$OUT"; then echo "A1 integration red: Prisma error" >&2; exit 1; fi
   echo "A1 integration red recorded"
   ```
   Only the two named cases may fail on base, both on the `lockDraftableIntent` assertion (the swap restores the
   repository file only, and neither case uses `hasStartedBroadcast`). A different red is a stop.
2. Then run `npm run arch:graphs` and `npm run arch:calls` and commit any change to `docs/architecture/generated` in
   the integrator commit; a change other than edges introduced by A2's new module is a stop to investigate.

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i21
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i21
test "$(npm --version | cut -d. -f1)" = 12
test -d node_modules
test ! -L node_modules
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"
BASE=c80fe34121d463f3f88fd51cbf582d305fdbc594
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
LZ_BASE_DIR=""
cleanup() {
  if [ -n "$LZ_BASE_DIR" ]; then git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true; git worktree prune; fi
}
trap cleanup EXIT
wait_for_no_coverage() {
  for _ in $(seq 1 180); do
    if ! pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage' >/dev/null && ! pgrep -f '[n]ode_modules/.bin/stryker run' >/dev/null; then
      return 0
    fi
    sleep 10
  done
  echo "coverage guard: another coverage or Stryker run still active after 30 min" >&2
  return 1
}
npm run build --workspace=shared
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )
# targeted backend: A1 (drafts, signing intents, broadcast), A2 (network status)
( cd server && npx vitest run tests/unit/services/draftCreate.test.ts tests/unit/repositories/draftSigningIntentRepository.test.ts \
  tests/unit/repositories/transactionSigningIntentRepository.test.ts tests/unit/services/bitcoin tests/unit/services/draftService.test.ts \
  tests/unit/api/bitcoin tests/unit/assistant tests/unit/worker tests/unit/api/admin )
npm run check:safety-catch-guards
npm run check:wallet-sync-mutation-boundaries
npm run check:wallet-sync-lifecycle-contract
npx vitest run --config config/tooling/vitest.config.ts tests/ci/signerInventoryGeneration.test.ts
node scripts/ci/check-critical-mutation-config.mjs
# A1 integration case on a real database
flock /home/nekoguntai/.i21-integration.lock npm --prefix server run test:integration:db -- tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # scoped to tests/unit as CI
# C1: compose and install helpers
npx vitest run --config config/tooling/vitest.config.ts tests/config
# every install unit suite (the CI glob; sets its own project-lock env; its tests/ci/lib/node_modules is gitignored)
bash scripts/ci/run-install-unit-tests.sh
# render the base file and base + each overlay that renders the worker, with the placeholder contract env;
# stderr stays visible so a render error is not silent
(
  . tests/install/utils/compose-contract-env.sh
  for overlay in '' docker/compose/prod.yml docker/compose/offline-core.yml docker/compose/ssl.yml \
      docker/compose/tor.yml docker/compose/monitoring.yml docker/compose/test.yml; do
    test -z "$overlay" || test -f "$overlay"
    args=(-f docker-compose.yml)
    if [ -n "$overlay" ]; then args+=(-f "$overlay"); fi
    json="$(docker compose "${args[@]}" config --format json)"
    jq -e '
      (.services.worker.networks | has("llm-egress-network") and has("sanctuary-network"))
      and (.services.worker.environment | has("LLM_EGRESS_PROXY_URL") and has("LLM_EGRESS_PROXY_SECRET"))
      and ((.services["llm-egress-proxy"].networks | keys) == ["llm-egress-network"])
      and ([.services | to_entries[] | select((.value.networks // {}) | has("llm-egress-network")) | .key] | sort
           == ["backend", "llm-egress-proxy", "worker"])
    ' <<<"$json" >/dev/null || { echo "C1 render failed for ${overlay:-docker-compose.yml}" >&2; exit 1; }
  done
)
# pinned surfaces (D-21.X3) and scope
PINNED_SURFACES=(
  config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation
  .github/mutation-baseline.json config/wallet-sync-mutation-boundaries.json config/wallet-sync-lifecycle-contract.json
  server/prisma config/resource-lifecycle-callsites.json scripts/verify-addresses scripts/perf shared .github/workflows
  .nvmrc server/src/services/accessControl.ts
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")"
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts
EXPECTED_FILES="$(sort <<'EOF'
docker-compose.yml
docs/architecture/containers.md
docs/explanation/scalability-and-performance.md
docs/reference/changelog.md
llm-egress-proxy/ARCHITECTURE.md
llm-egress-proxy/README.md
llm-egress-proxy/src/endpointPolicy.ts
scripts/quality/safety-catch-allowlist.json
server/src/api/openapi/paths/drafts.ts
server/src/repositories/draftSigningIntentRepository.ts
server/src/repositories/transactionSigningIntentRepository.ts
server/src/services/bitcoin/networkStatus/statusProbeCache.ts
server/src/services/bitcoin/networkStatusService.ts
server/src/services/bitcoin/nodeClient.ts
server/src/services/bitcoin/signingIntent/broadcastReconciliation.ts
server/src/services/bitcoin/transactions/broadcasting.ts
server/src/services/bitcoin/transactions/persistTransaction.ts
server/src/services/draftCreate.ts
server/tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts
server/tests/unit/api/bitcoin/bitcoinTestHarness.ts
server/tests/unit/repositories/draftSigningIntentRepository.test.ts
server/tests/unit/repositories/transactionSigningIntentRepository.test.ts
server/tests/unit/services/bitcoin/networkStatusService.cache.test.ts
server/tests/unit/services/bitcoin/signingIntent/broadcastReconciliation.test.ts
server/tests/unit/services/bitcoin/transactionServiceBroadcast/persistTransaction.test.ts
server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.claim-states.contracts.ts
server/tests/unit/services/draftCreate.test.ts
tests/config/llmEgressProxyCompose.test.ts
tests/install/unit/upgrade-helpers.test.sh
tests/install/utils/upgrade-assertions.sh
tests/install/utils/upgrade-wallet-sync-retirement-helpers.sh
EOF
)"
test "$(printf '%s\n' "$EXPECTED_FILES" | wc -l)" -eq 31   # A1 15, A2 5, C1 10, plus the changelog
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' ':(exclude)docs/architecture/generated' | sort)"
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# shape checks
grep -qF 'BROADCAST_NOT_STARTED' <(sed -n '/^export const lockDraftableIntent/,/^};/p' server/src/repositories/transactionSigningIntentRepository.ts)
grep -qE "BROADCAST_NOT_STARTED = \{ consumedAt: null, broadcastState: 'ready' \}" server/src/repositories/transactionSigningIntentRepository.ts   # shared with hasStartedBroadcast since /simplify
grep -qF 'intent_broadcast_in_flight' server/src/services/draftCreate.ts
grep -qF 'archiveDraftsForSigningIntent' server/src/services/bitcoin/transactions/persistTransaction.ts
grep -qF 'invalidateNetworkStatusCache' server/src/services/bitcoin/nodeClient.ts
# the worker's LLM_EGRESS_PROXY_SECRET is checked in the C1 render loop above (contract env sourced, stderr kept)
UNRELEASED="$(awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' docs/reference/changelog.md | tr '\n' ' ' | tr -s ' ')"
test -n "$UNRELEASED"
for phrase in 'already being broadcast' 'status probe' 'reach the LLM egress proxy'; do
  grep -qF "$phrase" <<<"$UNRELEASED" || { echo "changelog [Unreleased] missing: $phrase" >&2; exit 1; }
done
# frontend and repo-wide typechecks (tests/config is a root vitest suite)
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npm run test:run
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i21-lizard.txt"
LZ_BASE_DIR="$SCRATCH/i21-lizard-base"
git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true
git worktree prune
git worktree add -q --detach "$LZ_BASE_DIR" "$BASE"
( cd "$LZ_BASE_DIR" && LIZARD_BIN="$PINNED_LIZARD" bash scripts/quality/lizard-only.sh ) >"$SCRATCH/i21-lizard-base.txt" 2>&1
LZ_BASE_TOTAL="$(grep -c ': warning:' "$SCRATCH/i21-lizard-base.txt")"
test "$LZ_BASE_TOTAL" -gt 0
test "$(grep -c ': warning:' "$SCRATCH/i21-lizard.txt")" -le "$LZ_BASE_TOTAL"
mapfile -t LZ_CHANGED < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- '*.ts' '*.tsx')
for f in "${LZ_CHANGED[@]}"; do
  test -f "$f"
  head_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$f" | grep -c ': warning:' || true)"
  base_n=0
  if [ -f "$LZ_BASE_DIR/$f" ]; then base_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$LZ_BASE_DIR/$f" | grep -c ': warning:' || true)"; fi
  test "$head_n" -le "$base_n" || { echo "D-21.X4: $f warnings $base_n -> $head_n" >&2; exit 1; }
done
LZ_BAS="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 server/src/services/bitcoin/transactions/broadcasting.ts || true)"
grep -qE 'broadcastAndSave.* has 1(38|39) NLOC, 20 CCN' <<<"$LZ_BAS"
git worktree remove --force "$LZ_BASE_DIR"
LZ_BASE_DIR=""
node scripts/quality/check-large-files.mjs
npm run arch:check
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run check:openapi-route-coverage
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
node scripts/ci/check-supply-chain-locks.mjs
git diff --check "$BASE" HEAD
test -z "$(git status --porcelain)"
echo "i21 verification passed"
```

## Delivery, rollback, deployment

- **The PR.** One PR on `codex/bug-scrub-loop/20261013-i21`: the plan commits (only `tasks/`), three phase commits (A1,
  A2, C1) and the integrator commit. Squash-merged.
- **Merge rules.** Merge through protected `main`, no admin bypass; strictly serial merges; poll the required contexts
  via `/commits/<sha>/statuses`; never pass `delete_branch_after_merge`; verify the `merge_commit_sha` is an ancestor
  of `main` before deleting the branch; then verify target-branch CI.
- **Expected CI lanes** (a missing expected lane is investigated, not assumed skipped):
  - **Test Suite**, including the backend integration group with the signing-intent spec and the **Full Critical
    Mutation Gate** shards (A1 touches critical-mutation files). Record the job IDs.
  - **Verify Bitcoin Vectors**: A1/A2 are on the wallet-safety critical paths.
  - **Install Tests**: `docker-compose.yml` and `tests/install/**` (C1). Record the job IDs.
  - **Docker build** / image validation: `docker-compose.yml`.
  - **Release Candidate Validation**: `tests/install/**` and `docker-compose*.yml` select it. Record the job IDs.
  - **Full LLM Egress Proxy Tests**: C1 edits `llm-egress-proxy/README.md` and `src/endpointPolicy.ts`.
  - **Code Quality**.
  - **Architecture** runs on the PR but is not required: it must be green on the PR head and again after the merge.
- **CI triage is infrastructure first** (CLAUDE.md): sora contention for a sora-only timeout, then Podman archive
  stalls (runner-infra #34), the npm advisory endpoint, DIND, a stranded e2e runner lock, kumo's native builder.
- **Retriggers** carry the four-part evidence.
- **PR-body flags:** A1 both ends of the window and the 409; drafts orphaned earlier are cleaned only by a replay or
  expiry. A2 TTLs (success TTL capped at the pool health-check interval), key, and invalidation resting on the config
  fingerprint (resetNodeClient invalidation is an extra; both callers are in the API process); in pool mode status
  requests reach the pool at most once per cache period. C1 history, the unchanged
  Postgres/Redis isolation, the worker port now reachable from the proxy network, recreate-on-upgrade, and the
  rollback-helper fix. "No migration, no new endpoint, no workflow edit, no version bump."
- **Rollback.** Code, compose, test and docs only, with no stored-shape change; each commit reverts independently.
  Reverting C1 detaches the worker from the proxy network again.
- **Deployment.** None until clean closeout (`--deploy final`).

## Completion criteria

- [ ] Every failing-first test fails on `c80fe34121d4` code for its stated reason and passes on the PR head; guards are
  recorded as guards; the A1 integration red is recorded.
- [ ] `npm run arch:graphs` / `arch:calls` ran before the integrator commit; any change is committed and explained.
- [ ] The Verification block runs as written on the integrated branch, exit 0 recorded (backend coverage 100% on
  `tests/unit`, lizard not above base with no per-file growth, the 31-file scope diff, empty pinned-surface diff,
  `arch:check`).
- [ ] `/simplify` and an adversarial implementation review run on the integrated diff; findings fixed or recorded.
- [ ] PR head CI is green with run and job IDs recorded, including the critical mutation shards, verify-vectors and
  Install Tests.
- [ ] The PR is merged, required contexts green, target-branch CI green on the merge commit, ancestry verified,
  branches and worktrees cleaned.
- [ ] Run state: the three findings are resolved.
- [ ] The P3 backlog stays outside the blocking fix set.

## Integrator commit: changelog

`docs/reference/changelog.md`, under `## [Unreleased]` → `### Fixed`, three bullets (the Verification block greps one
phrase from each):
- Drafts: a transaction that is already being broadcast can no longer be saved as a draft (409
  `intent_broadcast_in_flight`), and when a broadcast is accepted every draft bound to the same signed transaction is
  archived, so a paid transaction no longer stays listed as an actionable draft. Drafts left by this problem before the
  upgrade are archived the next time their broadcast is retried, or expire as before.
- Node status: `GET /api/v1/bitcoin/status` and the assistant's network status tool reuse a status probe for 15
  seconds (or the pool health-check interval when that is shorter; 5 seconds after a failure), and simultaneous
  requests share one probe, instead of opening a new Electrum connection (or Tor circuit) for every request. In pool
  mode, status requests reach the pool at most once per cache period.
- Treasury Intelligence: analysis runs in the worker, which could not reach the LLM egress proxy on a standard Compose
  install, so every analysis failed while the status showed Intelligence as available. The worker now joins the
  proxy's network with the proxy secret, so analyses reach the LLM egress proxy; Postgres and Redis stay off that
  network. Existing installs pick this up when
  the worker container is recreated, which an upgrade does.

## Review log

- Draft assembled 2026-10-30 from the three prototypes (source `c80fe34121d4`). All patches apply cleanly together.
  - Coordinator decisions: OQ-A1 (refuse, archive on acceptance, archive on replay), OQ-A2 (service-level cache),
    OQ-C1 (attach the worker; no user decision needed: the documented isolation concerns Postgres/Redis visibility).
- Pass 1 (2026-10-31): three reviewers (A1; A2 and C1; whole plan with the combined patch applied).
  - A1:
    - The integration red accepted a wrong-reason red (`hasStartedBroadcast is not a function`). The real-DB cases
      now use `lockDraftableIntent` only, are named, and the red script greps `expected true to be false` and the
      case names and fails on `is not a function`.
    - Added a second real-DB case proving the wait-then-recheck serialisation (claim holds the row, draft lock
      waits, claim commits, lock matches nothing); the red now expects `Tests +2 failed`.
    - Pre-step order: the integration red runs on a clean tree after the three phase commits, before arch
      regeneration and the integrator commit.
    - Approval requests left pending on an archived draft recorded as an accepted limitation in OQ-A1.
    - Route citation fixed to `api/transactions/broadcasting.ts` `resolveAuthoritativeDraft` /
      `assertDraftIntentMatchesRequest`.
    - The best-effort replay archive catch failed `check:safety-catch-guards`; A1 adds one
      `scripts/quality/safety-catch-allowlist.json` entry (`intentional-post-acceptance-boundary`).
  - A2:
    - The circuit-breaker claim softened to "status requests reach the pool at most once per cache period"
      (OQ-A2, changelog, PR body).
    - Invalidation rests on the config fingerprint; `resetNodeClient` invalidation is an extra; both callers are in
      the API process.
    - Success TTL capped at `min(15 s, ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS)` so cached pool stats are not shown
      as stale; one cache test added (10 tests).
  - C1:
    - Compose renders source `tests/install/utils/compose-contract-env.sh` in a subshell, keep stderr, and loop
      over the base file plus the prod, offline-core, ssl, tor, monitoring and test overlays, checking the worker
      networks, URL and secret and the egress network members; the separate secret shape check is folded in.
    - The rollback helper's error goes to stderr and the caller clears the variable on failure; a failure-case
      unit test added.
    - `llm-egress-proxy/README.md:75` and the `endpointPolicy.ts:94` comment join C1.
    - The hand-picked install suites replaced by `scripts/ci/run-install-unit-tests.sh`.
  - Whole plan:
    - EXPECTED_FILES now 31 (A1 15, A2 5, C1 10, plus the changelog); completion criterion updated.
    - The changelog check searches only `## [Unreleased]` and uses 'reach the LLM egress proxy' instead of
      'Treasury Intelligence' (already present on base).
    - Release Candidate Validation and the Architecture PR run are expected lanes; the LLM egress proxy lane is
      added.
  - Rejected: none.
- Pass 2 (2026-10-31): two reviewers (pass-1 changes tried in prototype copies; full read).
  - A1:
    - R2-W1: the A1 unit red on base is 9, not 8. `broadcastReconciliation.test.ts` has 2 failures (the reconciler and
      the stalled lookup); `p21-a1-red.txt` predates the final prototype, and the implementer re-records it.
    - R2-A-1: the real-DB cases seed claimed and unknown rows with the field set
      `transaction_signing_intents_broadcast_state_check` requires (`broadcastMetadata`; claimed also the lease token
      and expiry); case 2's holder writes the full claimed field set; the one-waiter wait is the new
      `waitForOneLockWaiter` helper; the reviewer's working copy (`$SCRATCH/r2-a1`) is referenced as guidance.
    - R2-A-2: the red script requires at least 2 `AssertionError: expected true to be false` lines and rejects
      `violates check constraint` and ``Invalid `prisma`` with explicit `if grep ...; then exit 1; fi`.
  - A2:
    - R2-A-3: the cap is a new `successTtlCapMs` callback on `statusProbeCache`; the interval source is
      `outcome.healthCheckIntervalMs` (`ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS`, read once per process in
      `poolRegistry`; 30 s outside pool mode); the TTL-cap test's setup (pool stats ~4 s old, stale check at T+14 s)
      and red (base: called 2 times, expected 1) are recorded.
  - C1:
    - R2-A-4: the failure-case test sets `TEST_RUNTIME_DIR="$TEST_TMP_DIR"` and asserts no `compose:` call; red on base
      is the first mutation, `compose stop worker`; head passes (112 tests).
    - `run-install-unit-tests.sh` takes no arguments and runs `npm ci --prefix tests/ci/lib` (~25 suites, ~130 s);
      `offline-monitoring` and `offline-tor` are excluded from the render loop (not standalone, no worker).
  - Confirmed:
    - The allowlist entry makes `check:safety-catch-guards` pass (73 groups).
    - All 7 compose renders pass on the C1 prototype and fail on base.
    - The `[Unreleased]`-only changelog check works, and its phrases are absent on base.
    - The 31-file list is consistent.
    - `bash -n` passes on both fences (Verification block and A1 red script).
  - Rejected: none.
- **Pass 3 (2026-10-31): one independent full-plan reviewer — clean, review converged.** It applied the three
  prototypes plus every plan delta to a copy and ran the cheap Verification steps green: targeted backend (237 files,
  7055 tests), the three check:* scripts (73 safety-catch groups), signer inventory, critical-mutation config, all 7
  compose renders, `tests/config` (66), `upgrade-helpers.test.sh` (112), `run-install-unit-tests.sh` (25/25), the
  31-file scope and empty pinned-surface diff, shape and changelog greps, root typechecks, server and egress-proxy lint,
  lizard (`broadcastAndSave` 139 NLOC / 20 CCN), large files, OpenAPI route coverage, lifecycle callsites,
  `git diff --check`. Base reds confirmed: A1 9 unit failures; A2 9 of 10 (the in-flight guard passes; the cap test also
  fails on the uncapped prototype); C1 compose 3 of 5; the C1 failure case fails on base and the prototype helper.
