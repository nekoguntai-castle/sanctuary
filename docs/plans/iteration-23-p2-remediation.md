# Iteration 23 — P2 remediation plan

- Iteration: 23 (bug-scrub-loop run `bug-scrub-loop-20260912t210000z-p2-backlog`)
- Status: complete — all fifteen phases merged (see Delivery record); the run was stopped by the user after this iteration, so no iteration-24 scrub follows
- Source target-branch SHA: `99da288d63b2525c156ec5319b9c6d47cf40bf10` (main after PR #1172; last code merge `d014f883`)
- Scope: whole repository
- Blocking findings (coordinator-reconfirmed at source, all P2):
  `broadcast-replacestxid-rejection-leaks-policy-reservation`,
  `admin-backup-large-body-parse-before-auth`,
  `label-schema-missing-length-bounds`,
  `label-description-null-rejected-by-backend-not-gateway`,
  `electrum-disconnect-does-not-cancel-inflight-connect`,
  `draftlist-wallet-switch-stale-load-overwrite`,
  `consoledrawer-session-switch-stale-turns-overwrite`,
  `webhook-replay-unguarded-reset-races-inflight-attempt-duplicate-delivery`,
  `telegram-wallet-settings-patch-stale-read-lost-update`,
  `createwallet-quorum-not-reclamped-after-signer-deselect`,
  `install-test-summary-fail-open-non-release`,
  `run-compose-e2e-subject-migration-wait-noop`,
  `classifier-rename-detection-blind-spot`,
  `coverage-shard-retry-defeated-by-own-guard`,
  `upgrade-e2e-2fa-phases-reuse-totp-step` (added mid-drain, Phase 14);
  P1 `esm-main-guard-silent-noop-under-symlink` (delivered first, Phase 0).
- P3 backlog (outside the blocking fix set): `electrum-pool-reconnect-reentrant-on-remote-drop-during-verify`, `gateway-validate-request-no-body-reassignment`, `push-unregister-token-missing-max-length`, `openapi-console-toolcalls-undocumented`, `audit-logs-pagination-stale-page-overwrite`, `websocket-disconnect-permanently-disables-reconnect`, `hardware-hook-service-connect-disconnect-unserialized`, plus the earlier P3 items in run state.

## Goal, non-goals, assumptions

Goal: fix the sixteen blocking findings (one P1, fifteen P2) with a failing regression test per finding, in fifteen independently mergeable phases, without schema migrations. The P1 (Phase 0) is delivered first.

Non-goals: a generic frontend cancellation layer; redesigning policy usage accounting beyond releasing pre-network rejections; changing Electrum reconnect strategy beyond cancellation of an abandoned connect; changing label semantics beyond bounds and nullability.

Assumptions: main is green (target CI verified through `d014f883`, docs-only `99da288d` verified); repository rules apply (tests-first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit`; lizard exactly 86; `check-large-files.mjs`; `arch:check` output committed; server `typecheck:tests`; `prisma.*` only in repositories; no new migrations). Sync-path repository calls stay inventoried in `config/wallet-sync-mutation-boundaries.json` and, for UTXO writers, wrapped in `scripts/perf/wallet-sync-persistence-driver.cjs` (no phase touches the sync path). No wallet-safety pinned file is touched (`config/wallet-safety-mutation-map.json` pins `advancedTx/{batch,cpfp,rbf}.ts`, `createBatchTransaction.ts`, `utxoSelection.ts`, `outputBuilder.ts`; Phase 1 edits `api/transactions/broadcasting.ts` and `services/bitcoin/transactions/broadcasting.ts`, neither pinned — confirm with `rg broadcasting.ts config/wallet-safety-mutation-map.json` before editing).

## Phase 0 — ESM CLIs detect direct execution by resolved path (scripts, P1)

Finding: `esm-main-guard-silent-noop-under-symlink`.

Evidence: `scripts/ownership/register-resource.mjs:61`, `scripts/ownership/cleanup-cli.mjs:559`, `scripts/ownership/describe-host-authority.mjs:147`, `scripts/ownership/operator-recovery-cli.mjs:484`, `scripts/ci/check-redis-service.mjs:95`, `scripts/ci/integration-db-guard.mjs:87` all guard their main body with ``import.meta.url === `file://${process.argv[1]}` ``; Node resolves symlinks and percent-encodes `import.meta.url` but not `argv[1]`, so from a symlinked or space-containing checkout path the CLI exits 0 having done nothing. `scripts/ci/cleanup-docker-resources.sh:57` invokes `cleanup-cli.mjs`, so the signed cleanup coordinator silently no-ops under that condition (CI runner checkouts are not symlinked; operator/local invocations are exposed).

Same class, second variant (shard D2, coordinator-reconfirmed): `pathToFileURL(resolve(process.argv[1])).href === import.meta.url` (or `pathToFileURL(process.argv[1]).href`) in `scripts/ci/{npm-audit-gate.mjs:467-469,check-npm-deprecations.mjs:207-211,check-npm-ci-callsites.mjs:165-169,check-npm-install-scripts.mjs:206-210,subject-budget.mjs:86,verify-jade-junit.mjs:117}`, `scripts/quality/check-root-layout.mjs:280-287`, `scripts/release/verify-prepared-release.mjs:119`, `scripts/support-package-runner.mjs:93`, `scripts/perf/wallet-sync-high-fanout-replay.mjs:1026`, and `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)` in `scripts/ownership/check-lifecycle-callsites.mjs:1359`: `resolve` normalizes but does not follow symlinks while Node loads the main entry through its realpath, so these skip their body under a symlinked invocation too (spaces are handled by `pathToFileURL`). `scripts/release/verify-release-artifacts.mjs:80` compares `import.meta.url` with itself — read it in full and treat it as always-main or fix per its intent; report which.

Contract: one shared helper (e.g. `scripts/lib/is-main-module.mjs` exporting `isMainModule(import.meta.url)`) compares `fileURLToPath(import.meta.url)` against `realpathSync(process.argv[1])` (both resolved; tolerate a missing `argv[1]` and a non-existent path by falling back to `resolve`), and every guard site listed above uses it (the six `file://` template sites first, then the `resolve`-based sites; the `.cjs` replay driver's `require.main` guard is a different, correct mechanism and stays); behavior when executed directly is unchanged; importing the modules still runs nothing. `wallet-sync-high-fanout-replay.mjs` is a sealed-digest file only for the driver/helper/fixture (not the harness itself — confirm `scripts/perf/wallet-sync-persistence-manifest.json` has no harness digest before editing; if it does, re-seal that field only). Confirmed: `scripts/ownership/check-lifecycle-callsites.mjs` is not a "driver registry" the CLIs need an entry in — it is a Docker-resource-ownership source scanner that classifies files by regex over literal `docker`/`podman` command text and a handful of path-specific marker substrings (e.g. `operator-recovery-cli.mjs` is recognized only via the literal string `executePreparedOperatorRecovery`, `check-lifecycle-callsites.mjs:800-801,875-876`). None of its classification logic inspects `import.meta.url`/`process.argv[1]` guard syntax, so replacing the six CLIs' inline guards with a call to the shared helper cannot change how they're classified; the new helper file itself contains no docker/podman command text and will classify as a no-op (`mechanism: 'producer'` with zero resource classes) if the scanner even reaches it. Running `node scripts/ownership/check-lifecycle-callsites.mjs` after the change (per Phase 0's own Verification line) is a sufficient, already-planned confirmation — no separate registry entry is needed.

Failing tests first (red against `origin/main`): a `tests/ci` node:test that creates a temp symlink to a copy of each CLI (or invokes via a symlinked directory) and asserts the CLI's `--help`/no-op invocation produces its usage output and non-empty stdout (today: empty stdout, exit 0); plus a unit test of the helper for symlinked path, percent-encoded space, and missing `argv[1]`.

Verification: root `typecheck:tests`, lint, `node --test tests/ci/<new test>`, `node scripts/ownership/check-lifecycle-callsites.mjs`, large-files, lizard, `git diff --check`.

## Phase 1 — pre-network broadcast rejections release the policy reservation (server)

Finding: `broadcast-replacestxid-rejection-leaks-policy-reservation`.

Evidence: `server/src/api/transactions/broadcasting.ts:284-324` `reservePolicyUsage` reserves enforce-mode spending-limit/velocity windows before `broadcastValidated`; `:346-358` `releaseReservationsOnFailure` returns unless `error instanceof DefiniteBroadcastRejectionError` (`services/bitcoin/blockchain/networkOperations.ts:39`, thrown only at `:63` from the node broadcast call); `services/bitcoin/transactions/broadcasting.ts:194-213` `assertReplacementLink` (`replacementLink.ts:111-136`) throws `InvalidInputError` before any network call, as do the other pre-network guards inside `broadcastAndSave` before `broadcastTransaction` (hardware capability, intent claim conflict). The iteration-21 Phase 1 record (#1155) chose "release only on definite rejection" so an unknown network outcome over-counts rather than under-counts; that rationale does not apply to failures raised before the network call.

Contract: `broadcastAndSave` marks the boundary between "not yet transmitted" and "transmitted or unknown": every throw raised before the network broadcast call is wrapped as (or carries a marker recognized as) a pre-network rejection — introduce `PreNetworkBroadcastRejectionError` (or a `broadcastAttempted: false` marker on the thrown error) in `services/bitcoin/transactions/broadcasting.ts`, thrown for `assertReplacementLink` failures and the other pre-network guards, preserving the original error's HTTP mapping (400 stays 400: the wrapper must extend/carry the original `ApiError` so `errorHandler` still maps it); `releaseReservationsOnFailure` releases for `DefiniteBroadcastRejectionError` OR the pre-network marker; any throw after the network call is attempted keeps the reservation (unchanged). Read-only evaluation and monitor-mode behavior unchanged. No schema change.

Failing tests first (red against `origin/main`): route contract — enforce-mode daily limit, broadcast with a non-verifying `replacesTxid` → 400 AND `releasePolicyUsage` called with the reservations (today not called); the same for the PSBT broadcast route; service contract — `assertReplacementLink` failure surfaces as a pre-network rejection carrying the original 400 mapping; a failure thrown by the node broadcast that is not a definite rejection still keeps the reservation (existing test stays green); `errorHandler` maps the wrapped error to the original status.

Verification: server gates (tsc, `typecheck:tests`, lint, architecture boundaries, unit coverage 100 on `tests/unit`, lizard, large-files, `arch:check`, `git diff --check`).

## Phase 2 — admin backup routes authenticate before parsing the body (server)

Finding: `admin-backup-large-body-parse-before-auth`.

Evidence: `server/src/api/admin/backup.ts:27` `largeBodyParser = express.json({ limit: '200mb' })`; the `/backup/validate` and `/restore` routes are wired `largeBodyParser, authenticate, requireAdmin`, every other route in the file puts `authenticate` first.

Contract: both routes are wired `authenticate, requireAdmin, largeBodyParser, …`; behavior for authenticated admins is unchanged (same 200 MB limit). Confirmed: the global default JSON parser mounted at `server/src/index.ts:158` (`app.use(defaultJsonParser())`) already bypasses these two exact routes — `server/src/middleware/bodyParsing.ts`'s `largeJsonBodyRoutes` table lists `POST /api/v1/admin/backup/validate` and `POST /api/v1/admin/restore` verbatim, and `bypassRouteSpecificJsonRoutes`/`usesRouteSpecificJsonParser` (`bodyParsing.ts:56-69`) calls `next()` without parsing for any route in that table. So the route-level `largeBodyParser` in `backup.ts:27` is already the only parser that ever touches these two routes' bodies (no 10 MB `DEFAULT_BODY_LIMIT` collision to reconcile) — reordering to `authenticate, requireAdmin, largeBodyParser` is a pure reorder with no interaction to audit at implementation time.

Failing tests first: supertest — unauthenticated POST with a JSON body to `/api/v1/admin/restore` and `/backup/validate` → 401 and the route's body parser was not invoked (spy on the parser factory or assert via a body-size sentinel that `req.body` is never populated before auth); authenticated admin with a large body still reaches the handler.

Verification: server gates.

## Phase 3 — label schemas match the documented contract (server)

Findings: `label-schema-missing-length-bounds`, `label-description-null-rejected-by-backend-not-gateway`.

Evidence: `server/src/api/labels.ts:25-35` schemas have no `.max()` and `description: z.string().optional()`; `server/src/api/openapi/schemas/labels.ts:59-91` and `shared/schemas/mobileApiRequests.ts:216-247` declare `labelNameMaxLength 100`, `labelColorMaxLength 32`, `labelDescriptionMaxLength 500` and `description .optional().nullable()`.

Contract: the backend label create/update schemas import the same limits (`MOBILE_API_REQUEST_LIMITS` or the shared constants) — `name` `.max(100)`, `color` `.max(32)`, `description` `.max(500).nullable().optional()` — and the handlers treat `description: null` as "clear the description" (persisted as null), matching the gateway contract; OpenAPI parity tests updated if the request schema shape changes. Confirmed persistence mechanism: `labelRepository.ts:234`'s update path already spreads `...(data.description !== undefined && { description: data.description })` — since `null !== undefined` is true, passing `description: null` through already writes a literal `null` (no repository change needed); the block is purely at the zod layer (`z.string().optional()` in `labels.ts:25-35` rejects `null` before the repository ever sees it). The create path (`labelRepository.ts:217`, `data.description || null`) already coalesces falsy/undefined to `null` and needs no change either.

Failing tests first: route supertests — 10,000-character `name` → 400 (currently 201); `color` over 32 → 400; `description` over 500 → 400; `{ name, description: null }` → 201/200 with description cleared (currently 400); OpenAPI/shared-schema parity test asserting the backend bounds equal the shared limits.

Verification: server gates.

## Phase 4 — Electrum disconnect cancels an in-flight connect (server)

Finding: `electrum-disconnect-does-not-cancel-inflight-connect`.

Evidence: `server/src/services/bitcoin/electrum/electrumClient.ts:134-143` `connect()`/`establishConnection` have no cancellation path; `:328-340` `disconnect()` tears down only when `this.socket` is set; `finishTcpConnection`/`finishTlsConnection` assign `this.socket` only after the handshake, so a `disconnect()` during the handshake is a no-op and the attempt later resolves with `connected = true`. Callers: `electrum/index.ts:68-74` `closeElectrumClientForNetwork` (drops the client from the registry right after `disconnect()`), `electrumPool/connectionManager.ts:146`.

Contract: `disconnect()` bumps a connect generation (or sets an abort flag consumed by the in-flight attempt) so that an attempt in progress rejects with a `Connection closed` error, destroys any socket it has created or later receives (reusing the iteration-22 late-socket path), never assigns `this.socket`, and never sets `connected = true`; a `connect()` after `disconnect()` starts a fresh generation and works normally; `connectionPromise` is cleared. Pool and manager callers that `await connect()` after `disconnect()` must keep working (they start a new attempt).

Failing tests first (red against `origin/main`): stub the socket factory to resolve on a deferred; `connect()` (not awaited), `disconnect()`, resolve the deferred → `isConnected()` is false, the socket was destroyed, `connect()` rejected with the closed error; a subsequent `connect()` succeeds; the TLS variant.

Verification: server gates.

## Phase 5 — DraftList loads are scoped to the mounted wallet (frontend)

Finding: `draftlist-wallet-switch-stale-load-overwrite`.

Evidence: `src/components/DraftList/useDraftListController.ts:76-88` and `src/components/WalletDetail/tabs/DraftsTab.tsx:38` (no key).

Contract: the controller keeps a ref of the current `walletId`; `loadDrafts` captures the id it was called for and applies `applyDrafts`/`onDraftsChange` only while that id is still current; switching wallets clears the list synchronously (render-time reset, as in `useTransferActions`) and the loading helper's error is applied only for the current wallet.

Failing tests first: controller/hook test — load for wallet A pending, switch to B, B resolves, A resolves late → list and count reflect B only; switch clears synchronously. Prove red against `origin/main`.

Verification: frontend gates (`typecheck:app/tests/all`, lint, unit coverage 100%, large-files, lizard, `git diff --check`).

## Phase 6 — ConsoleDrawer transcripts are scoped to the selected session (frontend)

Finding: `consoledrawer-session-switch-stale-turns-overwrite`.

Evidence: `src/components/ConsoleDrawer/useConsoleDrawerController.ts:144-155,279-290`.

Contract: `loadSessionTurns` captures the session id it was called for and applies `setMessages`/`setSetupReason` only while `selectedSessionIdRef.current` still equals it; errors from a superseded load are ignored; selecting a session clears or marks the transcript loading synchronously so a stale transcript is never shown under the new session.

Failing tests first: controller test — select A then B while A's `listConsoleTurns` is pending, resolve A after B → messages are B's; `sendPrompt` targets B. Prove red against `origin/main`.

Verification: frontend gates.

## Phase 7 — webhook replay cannot clobber an in-flight attempt; delivery success is the persisted outcome (server)

Finding: `webhook-replay-unguarded-reset-races-inflight-attempt-duplicate-delivery`.

Evidence: `server/src/repositories/webhookRepository.ts:358-374` `markDeliveryPendingForReplay` is an unguarded `update` (siblings `claimDeliveryAttempt` :329-356, `markDeliveryDelivered` :376-425, `markDeliveryFailed` :427-465 are `updateMany` gated on `attemptCount`/`attemptLeaseToken`); `server/src/services/webhooks/deliveryService.ts:131-143` ignores `markDeliveryDelivered`'s return on the success path (the failure path :252-260 checks `markDeliveryFailed`).

Contract: `markDeliveryPendingForReplay` becomes a guarded `updateMany` that resets only a row with no live lease (`attemptLeaseToken: null` OR `attemptLeaseExpiresAt < now`) and returns the count; this changes its return type from `Promise<WebhookDelivery>` to a count, so `replayWalletWebhookDelivery` (`server/src/services/webhooks/endpointService.ts:225-250`) — which currently reads `replayDelivery.attemptCount` off the direct return at line ~236 — must branch on the count before touching that field. The replay route/service maps a zero count to `ConflictError` (`server/src/errors/ApiError.ts:317-325`, 409/`CONFLICT`) — the same class already thrown elsewhere in `server/src/api/transactions/broadcasting.ts`, `server/src/api/devices/crud.ts`, `server/src/api/auth/login.ts` for in-progress/duplicate operations — instead of silently resetting; `sendWebhookDelivery` treats a `null` from `markDeliveryDelivered` as "outcome lost to a concurrent reset": it returns `{ success: false, reason: 'delivery_state_conflict' }` (no second POST is made by this call) and logs at warn, so the caller never reports `success: true` for a row still `pending`. Recovery re-selecting the row is unchanged (it is the replay's intent). No schema change.

Failing tests first (red against `origin/main`): repository — replay against a leased delivery returns 0 and leaves the row untouched; against an unleased/expired row resets it; `claimDeliveryAttempt` → `markDeliveryPendingForReplay` (unleased path) → `markDeliveryDelivered` with the stale attempt/lease returns `null`; service — `sendWebhookDelivery` whose `markDeliveryDelivered` returns `null` reports `success: false` with the conflict reason; route — replay of an in-flight delivery → 409.

Verification: server gates.

## Phase 8 — wallet Telegram/autopilot settings PATCH merges inside the atomic update (server)

Finding: `telegram-wallet-settings-patch-stale-read-lost-update`.

Evidence: `server/src/api/wallets/telegram.ts:73-92` reads `stored` outside the transaction and passes a fully computed record to `updateWalletTelegramSettings` (`server/src/services/telegram/settings.ts:43-66`), which re-reads preferences inside `userRepository.updatePreferencesAtomically` (`userRepository.ts:271-288`) but blind-replaces `wallets[walletId]`; identical shape in `server/src/api/wallets/autopilot.ts:38-47,79-104` and `server/src/services/autopilot/settings.ts:62-82`.

Contract: the services accept the PATCH (partial) and perform the `DEFAULT → stored → patch` merge inside the `updatePreferencesAtomically` callback against the re-read wallet record, so the serializable retry loop makes concurrent single-field PATCHes compose; the route handlers stop pre-reading `stored` for the merge (they may keep it for response shaping); `buildTelegramSettingsUpdate`/`buildAutopilotSettingsUpdate` move into (or are called from) the transactional callback. Confirmed callback contract: `updatePreferencesAtomically<T>(id, updater: PreferenceUpdater<T>)` (`userRepository.ts:41,271-288`) is a pure, synchronous `PreferenceUpdater<T> = (current: unknown) => PreferenceUpdate<T>` re-invoked per serializable-conflict retry (`attemptPreferenceUpdate`, `userRepository.ts:246-263`) against a freshly re-read `current.preferences` (`unknown`, not the caller's stale `stored`) inside `prisma.$transaction(..., { isolationLevel: 'Serializable' })`; the callback must synchronously decode `current` (parse/cast to the preferences shape), locate `wallets[walletId]`, and return `{ preferences, result }` — no `await` inside the updater, since the transaction re-invokes it on conflict rather than awaiting async work. Response shapes unchanged. No schema change.

Failing tests first (red against `origin/main`): service tests with a fake `updatePreferencesAtomically` that replays the callback against preferences mutated between the caller's read and the transaction — two single-field patches built from the same snapshot applied sequentially leave both fields set (today the second drops the first); the same for autopilot; route supertest — PATCH with one field does not reset a field committed by a concurrent PATCH (drive with a repository stub that commits another field between read and write).

Verification: server gates + `arch:check` (telegram/autopilot call graphs may change; commit regenerated docs).

## Phase 9 — Create Wallet re-clamps the quorum to the selected signers (frontend)

Finding: `createwallet-quorum-not-reclamped-after-signer-deselect`.

Evidence: `src/components/CreateWallet/useCreateWalletController.ts:35` (`quorumM` state, no re-clamp on `selectedSigners` change); `ReviewStep.tsx:62` renders `{quorumM} of {selectedSigners.length}`; `createWalletData.ts` step gating does not block `quorum > signers`; `server/src/api/wallets/crud.ts:91-95` rejects it with 400 surfaced as a generic failure.

Contract: the controller derives the effective quorum as `min(quorumM, selectedSigners.length)` whenever signers change (render-time clamp or `setQuorumM` in the signer toggle), the review step can never show `M > N`, and the step gate blocks continuing while `quorumM > selectedSigners.length` (defensive, should be unreachable after the clamp). The server rule is unchanged.

Failing tests first (red against `origin/main`): controller test — select 3 signers, set quorum 3, deselect one → `quorumM` is 2 and the review shows "2 of 2"; step gating blocks an invalid pair.

Verification: frontend gates.

## Phase 10 — install-test summary fails when any non-upgrade job failed (ci)

Finding: `install-test-summary-fail-open-non-release`.

Evidence: `.github/workflows/install-test.yml` `test-summary` job (~1178-1291): on non-release runs the only failing exit is `SELECTED_UPGRADE_FAILED`; unit/fresh-install/install-script/container-health/auth-flow results only feed the summary text; the full check is `if: is_release == 'true'`.

Contract: the summary step computes `ANY_FAILED` across every `needs` result (treating `failure`/`cancelled` as failed and `skipped` as neutral, matching the existing release-gate semantics) on every run and exits 1 when set; the release-gate step is unchanged. The existing harness `tests/ci/check-workflow-composition.test.sh` (already asserts structure around `"test-summary:"` at its lines ~1066 and ~1667, and around `IS_RELEASE`/`is_release` wiring at ~1325) is extended with new assertions for the non-release exit-1 branch; it is a static YAML-structure test harness, not a shell executor, so it cannot itself drive `IS_RELEASE=false` through the step — proving the branch red/green requires extracting the summary's shell logic into a standalone script (e.g. `scripts/ci/compute-test-summary-status.sh`) invoked by the workflow step, with its own new `tests/ci/compute-test-summary-status.test.sh` exercising the env-var matrix directly; `check-workflow-composition.test.sh` then only asserts the step still calls that script.

Failing tests first: the new `tests/ci/compute-test-summary-status.test.sh` asserts exit 1 for `IS_RELEASE=false`, `FRESH_INSTALL=failure`, others `success` (today's inline step logic does not fail here); exit 0 when all succeed; unchanged release behavior; `check-workflow-composition.test.sh` gains an assertion that `test-summary` invokes the new script on every run, not only `if: is_release == 'true'`.

Verification: `tests/ci` node/bash tests for the workflow, `check-workflow-composition`, lint, `git diff --check`.

## Phase 11 — compose e2e subject waits on the real migration outcome (ci)

Finding: `run-compose-e2e-subject-migration-wait-noop`.

Evidence: `scripts/ci/run-compose-e2e-subject.sh:102-105` (`ps migrate` without `--all`, `|| true`, fixed `sleep 30`); `scripts/ci/wait-for-migration.sh:47-77` already implements the correct wait.

Contract: the subject script calls `scripts/ci/wait-for-migration.sh` (or the same `ps --all` + exit-code logic) and fails fast with the migrate container's logs when migration exits non-zero or never exits within the budget; the fixed sleep is removed; success path unchanged.

Failing tests first (red against `origin/main`): no existing `tests/ci` file covers `run-compose-e2e-subject.sh` (`tests/ci/wait-for-migration.test.sh` covers only the helper it should now delegate to); add `tests/ci/run-compose-e2e-subject-migration-wait.test.sh` stubbing `docker compose ps` to report `Exited (1)` and asserting the script fails before starting health checks (today it proceeds after ~150 s); stubbing `Exited (0)` proceeds without the 120 s wait.

Verification: `tests/ci` bash tests, shellcheck/lint, `git diff --check`.

## Phase 12 — lane classifiers see renamed files' old paths (ci)

Finding: `classifier-rename-detection-blind-spot`.

Evidence: `scripts/ci/classify-test-changes.sh:257`, `scripts/ci/classify-docker-build-images.sh:212`, `scripts/ci/plan-test-run.sh:222` use `git diff --name-only` with rename detection; `scripts/ci/classify-quality-scope.sh` uses `--no-renames` and has `tests/ci/classify-quality-scope.test.sh:266-274`.

Contract: the three scripts pass `--no-renames` (both the vacated and the new path are classified), mirroring the quality-scope classifier; each gains the sibling's regression test in its existing harness file: `tests/ci/classify-test-changes.test.sh`, `tests/ci/classify-docker-build-images.test.sh`, `tests/ci/plan-test-run.test.sh` (all three already exist), following the pattern already proven at `tests/ci/classify-quality-scope.test.sh:266-274`.

Failing tests first (red against `origin/main`): for each of the three existing test files, add a case that renames a lane-selecting file in a temp repo and asserts the old path selects the lane/image/plan entry (today it does not).

Verification: `tests/ci` bash tests, lint, `git diff --check`.

## Phase 13 — coverage shard retry survives a crashed first attempt (ci)

Finding: `coverage-shard-retry-defeated-by-own-guard`.

Evidence: `scripts/ci/backend-coverage-shard.sh:59-64,105-118` and `scripts/ci/frontend-coverage-shard.sh:47-52,92-108`: the stale-report-directory guard runs in `run_vitest_shard_once`, which the segfault retry loop calls per attempt, with nothing clearing the directory between attempts.

Contract: the stale guards run once in `main` before the retry loop (a pre-existing directory is still refused); after a retryable infrastructure failure the loop removes the attempt's partial report directory (and the attempt-scoped `.tmp-*` artifacts) before retrying, and the attempt log guard stays per attempt; a non-retryable failure or the final attempt keeps its artifacts for diagnosis.

Failing tests first (red against `origin/main`): extend the existing `tests/ci/backend-coverage-scripts.test.sh` and `tests/ci/frontend-coverage-scripts.test.sh` (both already exercise the stale-report-directory guard around their `reports_with_stale_blob` fixture at line ~41/~228 respectively) with a stub vitest that segfaults on attempt 1 while creating the report directory and succeeds on attempt 2 — assert the script succeeds (today it fails on "refusing stale … directory"); a pre-existing directory before `main` is still refused (existing case must stay green).

Verification: `tests/ci` bash tests, lint, `git diff --check`.

## Phase 14 — upgrade e2e 2FA phases never reuse a TOTP step (tests-ci, added mid-drain)

Finding: `upgrade-e2e-2fa-phases-reuse-totp-step` (P2, found 2026-09-15 on PR #1177's Upgrade Baseline lane).

Evidence: run 16845, job 211758 (Upgrade Baseline, head 313d1995): "Verify 2FA Preserved" logged in at 11:16:30 and its next 2FA login at 11:16:33 was rejected `UNAUTHORIZED Invalid verification code`; postgres logged `Key (jti)=(totp-step:<user>:59649033) already exists` — the single-use TOTP step guard (the fix for `totp-code-replay-within-tolerance-window`) refuses a second login inside the same 30 s step. "Reset 2FA And Re-Enroll" hit the same step counter and the later phases cascaded. `tests/install/utils/upgrade-two-factor-verification-helpers.sh` `generate_totp_code`/`generate_upgrade_totp_code` (:200-221) mint the code for the current step and the phases log in back to back with no step-boundary wait, so the lane fails whenever two 2FA logins land in one step. No module-resolution or product error appears in the log.

Contract: a shared helper (in `tests/install/utils/upgrade-two-factor-verification-helpers.sh` or `upgrade-two-factor-auth-helpers.sh`) records the TOTP step counter of the last successful 2FA login per secret and, before minting the next code for the same secret, waits until the current step differs (bounded by one step, 30 s, with a log line); every phase that performs a 2FA login (verify-preserved, re-enroll, user-visible smoke, and any other caller of `generate_totp_code`) goes through it. No product change: the single-use step guard is the intended behavior.

Failing tests first: a `tests/install/unit` case that drives the helper with a stubbed clock/step source — two consecutive logins in the same step must produce a wait to the next step and distinct step counters (red today: the second code carries the same step); a case proving no wait when the step already advanced. Register the new test where `ci-registration-completeness` expects it.

Verification: `bash -n`, the new unit test, `bash tests/ci/ci-registration-completeness.test.sh`, root lint, large-file classifier, lizard 86/86, `git diff --check`; deployed proof is a green Upgrade Baseline lane on the delivering PR.

## Delivery

One PR per phase, serial merges on `main`, each rebased only when it is next; target-branch CI verified after each merge; branches deleted only after the merge-commit ancestry gate. PR order: 0 (P1), 1, 2, 3, 4, 7, 8 (server), 5, 6, 9 (frontend), 10, 11, 12, 13, 14 (ci); phases are merged as their rebased heads go green, with the P1 first among those ready. No container rebuild until the loop's clean pass (`--deploy final`).

## Completion criteria

All sixteen findings resolved in run state with a target-CI-verified attempt record; a fresh full scrub (iteration 24) of the resulting main SHA finds zero P0–P2.

## Review notes (pass 1)

Accepted (applied above): Phase 0 mischaracterized `check-lifecycle-callsites.mjs` as a "driver registry" the CLIs must register with — verified it is a docker-command-text/marker-substring scanner unrelated to ESM main-guard syntax, corrected. Phase 2 left the body-parser interaction as an open TODO ("if one exists, document") when it is a settled fact verifiable now — named the exact bypass mechanism (`bodyParsing.ts` `largeJsonBodyRoutes`) so Phase 2 is a pure route-order change with nothing left to discover mid-implementation. Phase 3 asserted null-persistence without citing the mechanism — verified and named the exact `!== undefined` spread in `labelRepository.ts:234` that already handles it. Phase 7 was missing a real breaking-change: changing `markDeliveryPendingForReplay`'s return type from a `WebhookDelivery` to a count breaks `replayWalletWebhookDelivery`'s existing `replayDelivery.attemptCount` read — added; also named `ConflictError` as the concrete existing 409 shape instead of a vague phrase. Phase 8 named the callback contract precisely (`PreferenceUpdater<T>`, pure/sync, no `await`). Phases 10-13 named the exact existing `tests/ci` harness files to extend (`check-workflow-composition.test.sh`, `classify-test-changes.test.sh`, `classify-docker-build-images.test.sh`, `plan-test-run.test.sh`, `backend-coverage-scripts.test.sh`, `frontend-coverage-scripts.test.sh`) and flagged that Phase 10 and Phase 11 need genuinely new script-level test files since the workflow-composition harness is structural/grep-only and no test file exists yet for `run-compose-e2e-subject.sh`.

Deferred (not applied — out of scope of this plan's coordinator-locked finding list, flagged for iteration-24 triage): `scripts/ownership/check-lifecycle-callsites.mjs` itself guards its own `main()` call at line 1359 with `process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)` — `path.resolve` does not resolve symlinks the way `fileURLToPath(import.meta.url)` does, so this script may carry the same silent-no-op class of bug as the six Phase 0 CLIs. It is not in the coordinator-reconfirmed finding list and pulling it in would expand Phase 0's scope beyond the six named files; note it for the next scrub instead of editing Phase 0.

All other evidence citations (file:line spans across Phases 1, 4, 5, 6, 9, 12, 13) were independently re-verified against source at `99da288d63b2525c156ec5319b9c6d47cf40bf10` and are accurate as written; no further changes found. Full pass 2 over the updated file yielded no new verified actionable comment — plan is clean.

## Delivery record

All fifteen phases merged serially on `main` (squash merges), each with target-branch CI verified, in the order the rebased heads went green (P1 first):

| Phase | PR | Merge SHA | Notes / verified divergences |
| --- | --- | --- | --- |
| 5 | #1175 | `223b6df1` | As planned. |
| 2 | #1176 | `d0c72b20` | As planned (route-order change; `largeJsonBodyRoutes` untouched). |
| 0 (P1) | #1177 | `e9edfb2d` | Shared helper `scripts/lib/is-main-module.mjs` across all 41 direct-execution guards (not only the six named CLIs); two extra commits add `scripts/lib` to the offline-bundle authority tree (`scripts/offline/create-bundle.sh`) and the upgrade-backup subject tree allowlist, which the install unit tests enforce; the two new `tests/ci` fixtures are registered in `config/resource-lifecycle-callsites.json`. Its Upgrade Baseline lane exposed the same-step TOTP collision that became Phase 14. |
| 3 | #1178 | `0e6356d8` | As planned; Semgrep runner stall retriggered with recorded evidence. |
| 7 | #1179 | `45071b49` | `markDeliveryPendingForReplay` returns `{ count, delivery }`; a lost race surfaces as `ConflictError` (`delivery_state_conflict`). |
| 14 | #1181 | `d026dfb1` | Added mid-drain via plan amendment #1180 (`860307dd`). Step tracking is keyed by account rather than by secret (re-enroll mints a new secret inside the same step), the state file is `TOTP_STEP_STATE_FILE` so phases in separate shells share it, and the wait log goes to stderr because `generate_totp_code` runs under command substitution. Hotfix #1184 (`e5a81543`) registers the new unit test's temp fixture in the lifecycle callsite inventory, which the Architecture lane requires for every host cleanup site. |
| 8 | #1182 | `65fac1a0` | As planned. |
| 1 | #1183 | `15e494b7` | `PreNetworkBroadcastRejectionError` marks the pre-network path; Jade image-retirement postcondition failure (host-side) retriggered with recorded evidence. |
| 4 | #1185 | `fea680d9` | `pendingConnectAbort` cancels the in-flight connect; as planned otherwise. |
| 6 | #1186 | `a6729d29` | As planned. |
| 9 | #1187 | `f6d417f0` | Quorum clamp is a `useMemo` over the selected signers; review gated on a valid pair. |
| 12 | #1188 | `0bb017c6` | All three classifiers run `--no-renames`. |
| 13 | #1189 | `6629f6e6` | Crashed attempt's report directory is renamed aside (`stash_attempt_coverage_artifacts`, `mv`) instead of deleted: a recursive delete in `scripts/` is an unclassified host lifecycle site that the ownership contract refuses to exempt. |
| 11 | #1190 | `a6a5ed9d` | `run-compose-e2e-subject.sh` delegates to `wait-for-migration.sh`; a second commit registers the new test's temp-fixture cleanup in `config/resource-lifecycle-callsites.json` (the Quality "CI classifier tests" lane fails on any unregistered host cleanup site). |
| 10 | #1174 | `2a8d51af` | `scripts/ci/compute-test-summary-status.sh` sources `scripts/ci/provider-context.sh` (`ci_step_summary_file`) because the provider-leak gate forbids raw `GITHUB_*` names under `scripts/`; the summary job gained a pinned checkout step because it used to be an inline `run:` and the job container has no repo without one (first rebased run failed exit 127 on the script path); an earlier Architecture failure on `7e6a9dbf` (`deployment-lifecycle.test.sh`, host-side, passes on the exact tree locally) was retriggered through the serial rebase with the four evidence items recorded on the PR. |

Iteration-23 plan PRs: #1173 (`b6208408`), #1180 (`860307dd`). Custody after delivery: no loop branches or worktrees remain.

The bug-scrub-loop run stops after this iteration at the user's request; iteration 24's fresh scrub was not started, so the completion criterion above (a clean iteration-24 scrub) is deliberately unmet. Candidates parked for the next run: label name trim asymmetry between backend and gateway, the provenance-pinned guard in `generate-address-key-corpora.mjs`, and the P3 backlog in run state.
