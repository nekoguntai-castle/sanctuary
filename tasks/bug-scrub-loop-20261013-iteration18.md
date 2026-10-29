# Bug-scrub loop 20261013 — iteration 18 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 18
- **Source SHA:** `41c6303163cea7d6ce33e6a4d2c97472f4f7fdfe` (`main`, after #1419 and #1420)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (3 × P2):**
  - A1 `push-toggle--insight-and-consolidation-notifications-never-sent` — a **recurrence** of the iteration-8 fix
    (#1404, plan phase A6) with a new root cause.
  - B1 `proxy-test--saved-proxy-null-username-rejected`.
  - C1 `ci-quality-classifier--composite-action-and-vendor-changes-skip-workflow-guards`.

  Every finding was re-verified from source at `41c6303163ce` (file:line in the phase sections). Every fix and red test
  was prototyped on a scratch copy of that tree; the phase sections say which reds were observed and which are
  predicted.
- **Deferred P3s:** the 20 iteration-18 P3s are backlog in run state and are **outside this fix set** (listed under
  Open questions). One previously recorded backlog P3,
  `upgrade-backup-manifest--compose-project-from-basename`, was rejected during the scrub. Its basename fallback has
  been unreachable since #1056; the evidence is in run state.
- **Scratchpad** (`$SCRATCH`): `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`.
  - Prototype diffs: `plan18-A-prototype.patch`, `plan18-B-prototype.patch` and `plan18-C-prototype.patch`.
  - Design note for A1: `plan18-A-design.md`.
  - A prototype is guidance only. Where it and the phase text below differ, the phase text governs.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `push-toggle--insight-and-consolidation-notifications-never-sent` (recurrence of #1404 A6) | P2 |
| B1 | `proxy-test--saved-proxy-null-username-rejected` | P2 |
| C1 | `ci-quality-classifier--composite-action-and-vendor-changes-skip-workflow-guards` | P2 |

## Open questions

None block the plan. These are the coordinator decisions taken at drafting (no product-policy change is involved):

- **OQ-A1 (delivery path).** Insight and consolidation pushes go through the gateway, which is the only process
  that holds push credentials. The worker gets no APNs/FCM environment.
  - Rejected alternative: forward `APNS_*`/`FCM_*` to the worker. It would duplicate credentials into a second
    process. It would also need a guard so transaction pushes, which the gateway already sends, are not sent twice.
    The server and gateway even read different variable names (`APNS_KEY_PATH`/`FCM_SERVICE_ACCOUNT` against
    `APNS_PRIVATE_KEY_PATH`/`FCM_SERVICE_ACCOUNT_PATH`).
- **OQ-A2 (delivery confirmation).** The worker cannot see whether a gateway is connected, so a published event is
  fire-and-forget.
  - `usersNotified` counts the audience, and `AIInsight.notifiedAt` is set, only when the event reached a gateway
    path per D-18.A1c: an in-process send to a connected gateway, or an external receiver count above 0. Otherwise
    the result is `no_recipients` and nothing is marked. Like today's direct send, this counts dispatch to a gateway
    path, not provider acceptance.
  - Known limitation (documented, not fixed): with no gateway connected the push is dropped without a retry, exactly
    as transaction pushes already are.
- **OQ-B1 (where to normalize).** Both sides change:
  - The server accepts `null` for the proxy username and password and treats it as absent. The OpenAPI request
    schema marks both nullable. Any client that echoes the read shape keeps working.
  - The client stops sending `null`.

**Deferred P3s (backlog; outside this fix set).**
- From S3, S5 and S7–S10: `worker-ready--flag-toggle-reconcile-transient-not-ready`,
  `sync-wakeup--lock-contention-exhausts-into-dlq-during-long-sync`,
  `wallet-remediation--snapshot-owner-set-ignores-direct-grant-precedence`,
  `operator-recovery-correlation--queries-not-bound-to-recovery-source`,
  `assistant-dashboard-summary--total-balance-sums-across-networks`,
  `mobile-agent-drafts--deep-link-webpath-dead-route`,
  `openapi-devices-create--403-foreign-fingerprint-undocumented`,
  `cleanup-recovery--journal-without-pointer-unrecoverable`,
  `monitoring--db-pool-panels-read-unwritten-metrics`,
  `install-e2e--gateway-port-and-readiness-checks-cannot-fail`.
- From gap-fill: `gateway-apns--environment-mismatch-prunes-all-ios-devices`,
  `agent-wallet-dashboard--operational-balance-total-sums-across-networks`,
  `about-modal--failed-update-check-shown-as-latest`,
  `openapi-admin-feature-flag--null-description-fields-documented-non-nullable`,
  `operator-secrets--postgres-and-grafana-passwords-in-docker-argv`,
  `install-unit-upgrade-backup--two-checks-cannot-fail`,
  `install-unit-upgrade-staleness--freshness-schedule-drift-count-never-compared`,
  `supply-chain-locks--funds-critical-check-reads-only-hoisted-lock-entry`,
  `alertmanager--documented-env-receivers-unwired`, `wallet-sync-mutation-gate--non-tx-helper-caller-skipped`.

## Goal and non-goals

**Goal.** The three P2s stop reproducing:
- A user who leaves Treasury Intelligence or Autopilot push on receives the minimal insight/consolidation push on a
  standard compose install.
- Node Config's "Verify Connection" works after a reload for a proxy saved without credentials.
- A PR that edits only `.github/actions/**` runs the workflow policy guards and the classifier suites.

**Non-goals.**
- No change to which users are eligible, to the D-4 minimal payloads or to the mobile permission caps.
- No change to transaction pushes.
- No APNs/FCM configuration change and no new environment variable.
- No change to the stored-proxy-password semantics (`********` mask).
- No change to other workflows' classifiers (`classify-test-changes.sh`, install, verify-vectors).
- No migration, no endpoint, no e2e mock-map change, no version bump.
- The P3 backlog stays out.

## Decisions

### Cross-cutting decisions

- **D-18.X1 (delivery).**
  - **One PR** on `codex/bug-scrub-loop/20261013-i18` (worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i18`).
  - **Commits:** one per finding (failing test + fix, in the order C1, B1, A1), then an integrator commit with the
    changelog `[Unreleased]` bullets and any regenerated `docs/architecture/generated`.
  - **Who does the work:** the coordinator implements C1 and B1 directly from their prototypes. A worker implements
    A1 in its own worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i18-a` on branch
    `codex/bug-scrub-loop/20261013-i18-a` from the final reviewed plan commit (its SHA is recorded in the
    Implementation log). The coordinator cherry-picks it with `-x` and proves
    it upstream with `git cherry` before deleting it.
- **D-18.X2 (red evidence).** Every new test is run on the plan-commit base code before its fix and must fail for the
  reason its phase states.
  - An unexpected red reason is a stop: record it and re-assess.
  - **Setup, in both the integration worktree (before Phase C1) and the A worktree:** root `npm ci`,
    `npx prisma generate` in `server/`, and `npm run build --workspace shared`. Check for about 810 `node_modules`
    entries in a real directory, not a symlink. Never use `server/npm ci`, never use `git stash`, and use one coverage
    run at a time host-wide (pgrep guard on `[n]ode_modules/.bin/vitest run --coverage`).
  - **Commits:** run them in the foreground with nvm node v24.21.0 (npm 12) on `PATH`, because the pre-commit hook
    trips on npm 11. Never commit while any `vitest --coverage` run is active anywhere on the host: the hook's timing
    tests flake under that load.
- **D-18.X3 (pinned surfaces).** No planned change touches any of these:
  - the wallet-safety mutation map, the Stryker configs or `.github/mutation-baseline.json`;
  - the wallet-sync mutation boundaries or lifecycle contract;
  - `server/prisma`, `config/resource-lifecycle-callsites.json` or `scripts/verify-addresses`;
  - the verify-vectors provenance sources.

  The Verification block asserts it.
- **D-18.X4 (lizard).** Run the pinned `lizard` 1.24.0 with CI's flags (`-w -C 15 -T nloc=200`; lizard analyses
  only `.ts`/`.tsx`/JavaScript here) on every changed `.ts`/`.tsx` file, comparing base and head copies: the
  per-file warning count must not grow. The repository total, re-measured on `41c6303163ce` inside the Verification
  block, must not grow either (83 at assembly, measured in a detached worktree of `41c6303163ce`).

## Phase C1 — A composite-action or vendored-bundle change runs the workflow guards and classifier suites

P2 `ci-quality-classifier--composite-action-and-vendor-changes-skip-workflow-guards`.

**Evidence (at `41c6303163ce`).**
- **Routing.** In `scripts/ci/classify-quality-scope.sh`, `is_workflow_file` (`:96-103`) matches only
  `.github/workflows/*.y{a,}ml`. `is_ci_classifier_file` (`:105-107`) lists exactly one action path,
  `.github/actions/setup-node-toolchain/action.yml`. The main loop (`:232-248`) sets `run_workflow_quality` and
  `run_ci_classifier_tests` only from those two predicates.
- **What gets skipped.** `quality.yml`'s `workflow-action-runtime-guard` job (`:517-523`, `if: run_workflow_quality`)
  runs `npm run check:github-action-runtimes` (`:589-596`). That script (`package.json:127`) is
  `node scripts/ci/check-github-action-runtimes.mjs && node scripts/ci/vendor/forgejo-artifact-v4/verify-vendor.mjs
  .github/actions/vendor/forgejo-artifact-v4`.
  - The runtime guard resolves every local action that a workflow `uses:` (`check-github-action-runtimes.mjs:129`,
    `:204-211`) and reads its manifest (`:421` composite branch).
  - `ci-classifier-tests` (`:623-628`) runs `tests/ci/check-github-action-runtimes.test.mjs`, which includes
    `assertVendoredArtifactRuntimeContract` (`:107`, `:996`).
- **Consequence.** A PR that changes only `.github/actions/upload-artifact/action.yml` or
  `.github/actions/vendor/forgejo-artifact-v4/upload/dist/upload/index.js` runs neither job. Code Quality Required
  Checks stays green, and so does the push to `main`, which uses the same classifier. Only the weekly schedule
  (`quality.yml:32`) runs everything.
- **Why tests miss it.** The existing test pins the wrong expectation:
  - `tests/ci/classify-quality-scope.test.sh:440-466` asserts `workflow=false` for both setup actions.
  - The iteration-17 subject deriver (`tests/ci/lib/classifier-suite-subjects.mjs`) does not follow data reads made
    through `path.join(REPO_ROOT, …)`.

**Fix.**
- `is_workflow_file` adds `.github/actions/*`, with a comment that cites D-18.C1.
- `is_ci_classifier_file` replaces the single setup-node entry with `.github/actions/*`.
- **Why both jobs, and why the whole tree:**
  - Both jobs read the action tree: the runtime guard and verify-vendor in one, the vendored-artifact contract and
    action-runtime suites in the other.
  - The tree has 21 tracked files, including the vendored `download/dist/*` and `upload/dist/upload/*` bundles, and a
    per-file list is what drifted.
  - ci-classifier-tests also runs `check-provider-leaks.sh` and its test (`quality.yml:905-906`), which scan
    `.github/actions/*/action.yml` and the vendored bundle.
  - Accepted side effect: the workflow-quality output also selects `semgrep-sast` (`quality.yml:414-418`) for an
    action-only change.
  - Routing every action file to both jobs costs two short jobs on a rare change.
  - The source-quality and dependency-audit routing of the two setup actions (`:183`, `:216`) is unchanged.
- **D-18.C1a (test expectation).** In the `classify-quality-scope.test.sh` loop at `:440`:
  - `.github/actions/*` entries now expect `workflow=true` and `classifier=true`.
  - The setup-node special case is removed (subsumed).
- **D-18.C1b (drift guard).** A new block before the backup-scripts loop does the following:
  - Lists `git -C "$ROOT_DIR" ls-files .github/actions` and asserts the list has at least 21 entries (the count at `41c6303163ce`),
    so an empty or truncated listing can't pass.
  - Commits each file into the fixture repository.
  - Asserts `run_workflow_quality=true` and `run_ci_classifier_tests=true` for each.

**Red (observed).** With only the test change applied, the suite fails at the first action entry:
`FAIL: expected run_workflow_quality=true, got run_workflow_quality=false`. With the fix it passes
(`classify-quality-scope regression checks passed`). `tests/ci/check-workflow-composition.test.sh` stays green with
the fix applied.
- The first scratch copy (`p18`) lost the four vendored `dist` files to the root `.gitignore`. Review pass 1 therefore
  re-observed red and green on a full clone of `41c6303163ce` with all 21 files (`$SCRATCH/rv-c1`).
- The prototype's guard floor `-ge 17` becomes `-ge 21`.

**Files (2).** `scripts/ci/classify-quality-scope.sh`, `tests/ci/classify-quality-scope.test.sh`
(prototype `plan18-C-prototype.patch`).

**Acceptance.**
- The red is recorded on base code.
- `bash tests/ci/classify-quality-scope.test.sh` and `bash tests/ci/check-workflow-composition.test.sh` pass.
- On the PR's own CI, `ci-classifier-tests` runs because of `scripts/ci/*`; record its job ID.
- **`Workflow policy guards` is expected to be skipped.** No planned file is under `.github/workflows` or
  `.github/actions`, so `run_workflow_quality=false` and the job is an allowed skip (`quality.yml:1340`). Record
  determine-scope's `run_workflow_quality=false` and `run_ci_classifier_tests=true`. The Verification block runs
  the classifier on the PR diff and `npm run check:github-action-runtimes` locally.

**Changelog (Fixed).** "CI: a pull request that changes only a composite action or the vendored artifact bundle
under `.github/actions/` now runs the workflow policy guards (action runtimes, vendored-bundle verification) and the
CI classifier suites; before, it passed Code Quality without them."

## Phase B1 — Node Config "Verify Connection" accepts the stored proxy's null credentials

P2 `proxy-test--saved-proxy-null-username-rejected`.

**Evidence (at `41c6303163ce`).**
- **Read side.** `server/prisma/schema.prisma:925` declares `proxyUsername String?`. GET `/admin/node-config` returns
  `proxyUsername: nodeConfig.proxyUsername` (`server/src/api/admin/nodeConfig.ts:224`), which is `null` for a proxy
  saved without one (bundled Tor, the default preset). `proxyPassword` is `undefined` or the mask (`:225`).
- **Client.** `src/components/NodeConfig/useProxyTorControls.ts:40-46` sends
  `username: nodeConfig.proxyUsername, password: nodeConfig.proxyPassword` unchanged. `src/types/index.ts:241`
  types it `proxyUsername?: string`, but the runtime value is `null`.
- **Server.** `server/src/api/admin/proxyTest.ts:23-28` uses `username: z.string().optional()` in a `.strict()`
  object, which rejects `null`. Because host and port are present, `:44-50` answers 400
  `Invalid proxy configuration`.
- **Effect.** After a page reload, "Verify Connection" fails for every proxy saved without a username.
- **Why tests miss it.** No server test sends `null`, and the frontend tests mock `testProxy` and use
  `proxyUsername: undefined` fixtures (`tests/components/NodeConfig.*.test.tsx`).

**Fix.**
- **Server.** `ProxyTestBodySchema` uses `z.string().nullish().transform((value) => value ?? undefined)` for
  `username` and `password`, with a comment citing the read shape. The handler's use of `username`/`password` is
  unchanged: the masked-password resolution and `username && password` already treat absent as no credentials.
- **OpenAPI.** `AdminProxyTestRequest` (`server/src/api/openapi/schemas/admin/ops-monitoring-node.ts:212-221`) marks
  `username` and `password` `nullable: true`, which is the file's convention (`:123`, `:132`).
- **Client.** `useProxyTorControls.ts` sends `nodeConfig.proxyUsername ?? undefined` and
  `nodeConfig.proxyPassword ?? undefined`.

**Tests (red first).**
- `server/tests/unit/api/adminNodeConfig/adminNodeConfig.proxy.contracts.ts` gets two cases in the
  `masked stored password` block:
  1. A stored proxy with `proxyUsername: null`, called with `{username: null, password: '********'}`, expects 200
     and decrypts the stored password.
  2. `{username: null, password: null}` expects 200, and the SOCKS connect is called without `userId`.

  **Observed red on the scratch copy:** both failed (`×`, 2 failed of 60) before the fix; with the fix, 60/60 pass and
  `server tsc --noEmit` passes. The runner file is `server/tests/unit/api/admin-nodeConfig-routes.test.ts`.
- `tests/components/NodeConfig.test.tsx` (555 lines → about 585) adds "sends no null credentials for a reloaded proxy
  saved without them". `getNodeConfig` returns `proxyUsername: null, proxyPassword: null`, and the test expects
  `testProxy` to be called with `{host, port, username: undefined, password: undefined}`.
  - The red is **predicted, not observed.** The scratch copy's frontend Vitest did not start jsdom (base also failed
    29/29 with `document is not defined`).
  - The integrator records it in the integration worktree: revert only `useProxyTorControls.ts` to base with
    `git show "$BASE:<path>" > <path>`, run the single test, then restore.

**Files (5).** `server/src/api/admin/proxyTest.ts`,
`server/src/api/openapi/schemas/admin/ops-monitoring-node.ts`,
`server/tests/unit/api/adminNodeConfig/adminNodeConfig.proxy.contracts.ts`,
`src/components/NodeConfig/useProxyTorControls.ts`, `tests/components/NodeConfig.test.tsx`
(prototype `plan18-B-prototype.patch`).

**Acceptance.**
- Server red observed on base; frontend red observed on the integrator's base swap.
- Green: the server route suite, `server/tests/unit/api/openapi*` (76 pass on the prototype), the NodeConfig
  component suites, and `typecheck:app`/`typecheck:tests`.
- Frontend coverage stays 100%. The `?? undefined` branches are exercised by the null case and the existing string
  cases.

**Changelog (Fixed).** "Node Config: \"Verify Connection\" no longer fails with \"Invalid proxy configuration\" after
a reload for a proxy saved without a username (such as bundled Tor); the proxy test accepts the null credentials the
settings read returns."

## Phase A1 — Insight and consolidation pushes are delivered through the gateway

P2 `push-toggle--insight-and-consolidation-notifications-never-sent`. This is a **recurrence**: the iteration-8 fix
(#1404, merge `10b6f8cb`, plan phase A6) gave the push channel insight/consolidation handlers. Those handlers can
only send with credentials that the deployment never gives the process running them.

**Evidence (at `41c6303163ce`).**
- **The push channel is off in the worker.** `server/src/services/push/pushService.ts:418-440` `isPushConfigured()`
  reads `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_KEY_PATH`/`APNS_BUNDLE_ID` and `FCM_SERVICE_ACCOUNT`.
  `server/src/services/notifications/channels/push.ts:77-79` `isEnabled()` returns it.
- **Only the gateway gets credentials.** `docker-compose.yml` sets `FCM_SERVICE_ACCOUNT_PATH`, `APNS_*`,
  `APNS_PRIVATE_KEY_PATH` and `APNS_PRODUCTION` for the **gateway** only (`:772-790`). Neither the backend nor the
  worker service has any `APNS_*`/`FCM_*` entry. Both have `GATEWAY_SECRET` (`:294`, `:491`).
- **Insights and consolidation suggestions run in the worker.** So the registry's insight/consolidation fan-out
  skips push as disabled, and even a forced call returns `{success:true, usersNotified:0}` at `pushService.ts:312`.
- **No process sends them.** The gateway's `PUSH_EVENT_TYPES` (`gateway/src/services/backendEvents/notifications.ts:13-21`)
  covers transaction, confirmation, broadcast and draft events only.
- **The UI promises them.** It offers the toggles, which default on: `src/components/Intelligence/tabs/SettingsTab.tsx:90`
  and `src/components/WalletDetail/WalletAutopilotSettings/AutopilotSettingsCard.tsx:251`.
- **The config test can't catch it.** Gap-fill G5 found that `tests/install/unit/compose-operator-env.test.sh` check 3
  passes a documented key forwarded to *any* service. So forwarding to the gateway only satisfies it. Its
  `REQUIRED_FORWARDS` has no backend/worker push rows.
- **Why tests miss it.** Unit tests mock `pushService`/`isPushConfigured` or set `process.env` directly. Nothing ties
  the server's push path to the deployment's environment.

**Fix (OQ-A1, OQ-A2; design `$SCRATCH/plan18-A-design.md`).**
- **Audience in the worker.** `pushService.resolveWalletPushAudience(walletId, isUserEligible)` is extracted from
  `notifyWalletUsers`/`findPermittedWalletUsers`. It keeps the same filters: wallet access, the mobile
  `viewTransactions` cap, `pushDevices > 0` and the per-user predicate, with no credentials check.
  `notifyWalletUsers` calls it.
  - The prototype changes one behaviour: a throwing eligibility predicate now counts as an audience-lookup failure
    (`usersNotified: 0`) instead of a send-loop failure. A test pins it.
- **Gateway-only Redis channel.** `server/src/websocket/redisBridge.ts` adds `sanctuary:ws:gateway`:
  - `publishGatewayEvent(event)` and `setGatewayEventHandler(handler)`;
  - a subscription only when not `publishOnly`;
  - incoming messages validated with `isGatewayPushEvent` and an instance's own messages dropped, as for the
    broadcast channel;
  - the handler cleared on shutdown.

  `server/src/websocket/server.ts` wires that handler to `getGatewayWebSocketServer()?.sendEvent` **only**, never
  `localBroadcast`, because the events carry a private `userIds` list. The server-only `GatewayPushEvent` type and
  `isGatewayPushEvent` live in `server/src/websocket/types.ts`. They are not added to the shared, frontend-visible
  `BroadcastEvent` union. `GatewayWebSocketServer.sendEvent` accepts `WebSocketEvent | GatewayPushEvent`.
- **`server/src/websocket/gatewayPush.ts` (new).**
  - `isGatewayPushDeliveryAvailable()` is true when `config.gatewaySecret` is set and either the Redis bridge is
    active or this process holds a gateway WebSocket server.
  - `dispatchGatewayPushEvent(event)` publishes to the gateway channel. When this process holds the gateway server, it
    also sends in-process, because a bridge never delivers an instance its own messages.
- **Push channel.**
  - `isEnabled()` is `isPushConfigured() || isGatewayPushDeliveryAvailable()`.
  - `notifyAIInsight`/`notifyConsolidationSuggestion` use the gateway when it is available, otherwise direct send —
    never both. With gateway delivery they resolve the audience, dispatch
    `{type:'ai_insight'|'consolidation_suggestion', walletId, walletName, userIds, data}` (only when `userIds` is
    non-empty) and return `usersNotified = userIds.length`, `outcome:'ambiguous'`.
  - `data` stays minimal per D-4: `{insightId, insightType, insightTypeLabel, severity}` or `{feeRate}`. There is no
    summary text, amount or UTXO count. `insightTypeLabel` comes from `INSIGHT_TYPE_LABELS`, so the gateway does not
    copy the map.
  - **Transactions keep base behaviour exactly (D-18.A1b, review passes 1–2).** `NotificationChannelHandler` gains
    an optional `isTransactionDeliveryEnabled?(): Promise<boolean>`. In the registry's transaction fan-out, the
    disabled check (`registry.ts:127-136`) calls it when present and falls back to `isEnabled()` otherwise. Push
    implements it as `pushService.isPushConfigured()`. Without credentials, push therefore takes the registry's
    existing disabled branch: `no_recipients`, and nothing recorded, byte-identical to base. `notifyTransactions`
    itself is unchanged. Transactions already reach the gateway through the broadcast path.
    - Why not widen `isEnabled()` for transactions: the registry would then call `notifyTransactions` in every process
      with a gateway secret.
      - Any result a handler returns goes through `recordTransportOutcome` (`registry.ts:139-140`, `:336-358`). So
        even a `no_recipients` early return would write a durable push `transport_attempted` event on every
        transaction, which base never writes.
      - Returning `toPushResult(...)` would also make it `ambiguous` and turn telegram-accepted plus push into a
        `partial` safe outcome (`outcomes.ts:119-129`).
    - Other handlers do not implement the new method, so their behaviour is unchanged.
  - **Publish result (D-18.A1c, review passes 1–3).** `redisBridge.publishGatewayEvent` is async and returns the
    **external** receiver count: Redis PUBLISH's count minus 1 when this bridge has its own subscriber
    (`this.subscriber` is set only when not `publishOnly`, and subscribing finishes before `isInitialized` at
    `redisBridge.ts:153-178`), floored at 0. The publisher is an ioredis `duplicate()` (`redisBridge.ts:143`), so `publish` returns
    `Promise<number>`, bounded by `maxRetriesPerRequest: 3` (`infrastructure/redis.ts:93`). It resolves `0` when the
    bridge is not initialized, for example when it is torn down after the availability check.
    `dispatchGatewayPushEvent` awaits it and reports whether the event reached a gateway path.
    - Delivered when either holds:
      - this process holds a gateway WebSocket server **and** `isGatewayConnected()`, so the in-process send happened;
      - the external receiver count `publishGatewayEvent` returns is above 0. This process's own subscriber counts in
        PUBLISH but is dropped as self, which is why the bridge subtracts it. The worker is `publishOnly`
        (`worker.ts:161`), so its count is exactly the subscribed API instances.
      - `GatewayWebSocketServer.isGatewayConnected()` already exists (`gatewayServer.ts:270`, used at
        `broadcast.ts:84`).
    - Delivered gives `usersNotified = userIds.length`, `outcome:'ambiguous'`.
    - Not delivered gives `success:true, usersNotified:0, outcome:'no_recipients', failureClass:'none'`.
    - A rejected publish gives `success:false, recorded:false` only when the in-process send did not happen.
    - Two cases leave the insight not marked notified (`analysisService.ts:160` needs `usersNotified > 0`): not
      delivered, and a rejected publish without an in-process send.
    - Known gap: during an ioredis resubscribe window an API's count can be one short, which gives a false
      `no_recipients`. The insight is then simply not marked notified.
    - OQ-A2's fire-and-forget limitation then covers only "a subscribed API instance with no gateway connected".
  - **Logging.** An audience-lookup failure on the gateway path logs
    `log.error(..., {walletId, error: getErrorMessage(err)})`, as the direct path does (`pushService.ts:314-316`).
- **Mapper (defence in depth).** `server/src/websocket/gatewayEventMapper.ts` gets a branch for the two types. It
  dedupes and re-filters `userIds` through `filterUserIdsByMobileAction(walletId, ids, 'viewTransactions')` at send
  time. A lookup failure sends to nobody, mirroring `eligibleUserIds`. The `setGatewayEventHandler` registration in
  `server.ts` goes after the `setBroadcastHandler` block (`:73-91`), as in the prototype.
  `GatewayWebSocketServer.mapAndSendEvent`
  returns early, without sending, for a `GatewayPushEvent` whose mapped `userIds` is empty, so the gateway never
  logs "Event missing recipients" for these.
- **Gateway.** `gateway/src/services/backendEvents/types.ts` adds the two `BackendEventType`s and the `data` fields.
  `notifications.ts` adds them to `PUSH_EVENT_TYPES`, with inline formatters that produce the iteration-8 strings:
  - insight: "Treasury Intelligence" / `${walletName}: ${severity} ${typeLabel} insight` /
    `{walletId, insightId, kind:'ai_insight'}`;
  - consolidation: "Consolidation opportunity" / `${walletName}: fees are low (${feeRate} sat/vB)` /
    `{walletId, kind:'consolidation_suggestion'}`.

  A malformed event (missing `insightId`/`severity`, or a non-finite `feeRate`) formats to `null` and is not sent.
  `handleEvent` is unchanged.
- **D-18.A1a (review items for the implementer).**
  - Use `getErrorMessage(error)` rather than `String(error)` in the new `server.ts` log line, and update the
    prototype's `server.singleton.test.ts` expectation to `error: 'gateway down'` to match.
  - Import cycles and worker load are settled by review pass 1:
    - `madge`'s cycle set is identical on base and the prototype. CI's Architecture lane uses dependency-cruiser
      (`run-architecture-validation-subject.sh:55,63`). Review pass 5 ran `check:server-cycle-baseline` (passed: 2
      known cycle sets, 4 circular edges) and `check:architecture-boundaries` (passed: 13 rules, 44 exceptions) on
      the prototype. Verification re-runs both on the implementation.
    - The worker already loads `websocket/server.ts` through `websocket/notifications/broadcasts.ts:8`.
    - `worker.integration.test.ts` and `websocket.integration.test.ts` pass on the prototype, with no `workerHarness.ts`
      mock change (2 files, 9 tests).

    The Verification block re-runs both specs. A `workerHarness.ts` change is out of scope; if one is ever needed,
    it is a plan amendment.
  - Document in `gatewayPush.ts`'s header that its in-process branch is not reached in production today: no API code
    path calls the insight/consolidation notifiers. It covers the topology where it would be.
  - Regenerate `docs/architecture/generated` (the new `services/notifications → websocket` edge and
    `calls/notifications.md`) in the integration worktree and commit it with the integrator commit.

**Tests (red first).**
- **New** `server/tests/unit/services/notifications/channels/pushGatewayDelivery.test.ts` (the 8 prototype cases plus the
  review-pass cases below). Setup: the
  real push channel and pushService, no `APNS_*`/`FCM_*` env, `config.gatewaySecret` set, the Redis bridge active with
  a publish spy, and one eligible user (`pushDevices: 1`, push preference on).
  - `notificationChannelRegistry.notifyInsight` publishes one gateway-channel event
    `{type:'ai_insight', walletId, userIds:[u1]}` with no summary text, nothing on the broadcast channel, and a push
    result `usersNotified: 1`. Consolidation is the same with autopilot `notifyPush`.
  - Further cases: no eligible users means no publish; direct send is used when no gateway path exists; never both.
  - Review-pass-1 cases:
    - A registry transaction dispatch with a dispatch context, no credentials and gateway delivery available (the
      worker's real state) returns push `no_recipients` and records **zero** push telemetry events. The same dispatch
      on base code gives the same result, so this is a regression guard, not a red test.
    - A rejected publish gives `success:false` and no `notifiedAt` marking.
    - Zero external receivers gives `usersNotified: 0`, `outcome:'no_recipients'`, `failureClass:'none'`. Cover both
      topologies: the worker (publish-only, count 0) and an API with its own subscriber only and no connected gateway
      (count 1, which is self).
    - The `outcome`/`failureClass` assertions are added to the existing direct-path case.
  - **Observed red on the scratch copy:** "publishes a minimal ai_insight gateway event for eligible users" and the
    consolidation twin failed with `expected … usersNotified: 1, received 0`, because `isEnabled()` is false on base
    and the registry skips push.
- **New** `server/tests/unit/websocket/gatewayPush.test.ts`: availability matrix (secret × bridge × in-process
  server) and the delivery rules (D-18.A1c):
  - in-process server connected, external count 0: delivered;
  - in-process server connected, publish rejects: delivered, `success:true`;
  - in-process server held but `isGatewayConnected()` false, external count 0: `no_recipients`;
  - no in-process server, external count 1: delivered;
  - no in-process server, external count 0: `no_recipients`;
  - no in-process server, publish rejects: `success:false`.
- `redisBridge.connected.test.ts` also asserts the external count: PUBLISH 2 with its own subscriber gives 1, PUBLISH
  1 with its own subscriber gives 0, a publish-only bridge returns PUBLISH's count unchanged, and an uninitialized
  bridge gives 0.
- **New case in the existing** `server/tests/unit/services/notifications/channels/registry.test.ts` (D-18.A1b): a
  handler whose `isTransactionDeliveryEnabled` is false while `isEnabled` is true gets `no_recipients`, its
  `notifyTransactions` is not called and nothing is recorded. A handler without the method still uses `isEnabled`,
  covering both arms of the new branch (backend branch coverage is 100%, `server/vitest.config.ts:65-70`).
  `handlers.test.ts` covers `push.isTransactionDeliveryEnabled` (credentials present gives true, absent gives
  false).
- **Extended:**
  - `redisBridge.connected.test.ts`: 7 gateway-channel cases; the existing subscribe/unsubscribe expectations go from
    two channels to three.
  - `server.singleton.test.ts`: a gateway-channel message reaches `sendEvent` and never `localBroadcast`.
  - `gatewayEventMapper.test.ts`: re-filter, dedupe, fail closed.
  - `gatewayServer.test.ts` (existing, 568 lines; it already mocks `ws` (`:39`), config (`:52`), metrics (`:57`) and
    `mapGatewayEvent` (`:35`, `:67-68`), and drives `server.sendEvent` (`:376-413`)): a `GatewayPushEvent` whose
    mocked `mapGatewayEvent` returns `userIds: []` is not sent to the authenticated gateway. A transaction event with
    an empty audience keeps its base behaviour. This covers the `mapAndSendEvent` early return under backend
    branch coverage (found by review pass 6).
  - `pushService.notifyWalletUsers.test.ts`: the throwing-predicate behaviour.
  - gateway `backendEvents.notifications.test.ts` (formatters, `PUSH_EVENT_TYPES`, malformed events) and
    `backendEvents.productionPayload.contract.test.ts`: insight and consolidation through the real server
    `GatewayWebSocketServer` into the gateway `handleEvent`.
- **Updated:** `handlers.test.ts` mocks `gatewayPush`, and its `isEnabled` case covers the gateway-only path.
- **Prototype results:**
  - Server: `tests/unit/services/notifications`, `push`, `websocket`, `intelligence` and `autopilot` give
    49 files / 1066 tests green, `tests/unit/services/push` 145 green, and `tsc --noEmit` plus `typecheck:tests` exit 0.
  - Gateway: the full suite is 613 green and `tsc --noEmit` exits 0.
  - Root: `typecheck:all`/`typecheck:tests` exit 0, eslint is clean and the large-file check passes. The longest
    touched test file is 740 lines.

**Deployment config pin (review pass 1).** `tests/install/unit/compose-operator-env.test.sh:39` `REQUIRED_FORWARDS`
gains `'worker|GATEWAY_SECRET|'` and `'backend|GATEWAY_SECRET|'`. Push delivery now depends on that secret reaching
both services; both already match compose `${GATEWAY_SECRET:-}` (`:294`, `:491`) and `start.sh:156`. This pins the
root-cause class (an env var that only the gateway receives) for the variable the fix relies on.

**Docs.**
- `scripts/templates/README.template.md:347-351` (canonical): gateway "How it works" — the gateway also pushes
  insight and consolidation events; the backend chooses recipients; only the gateway holds credentials. Then run
  `bash scripts/generate-readme.sh` to regenerate `README.md`. `tests/docs/readme-links.test.ts:158` requires
  `README.md` to equal the rendered template, which the prototype edited only in `README.md` (found by review
  pass 4).
- `gateway/ARCHITECTURE.md:99` and `gateway/README.md:113` (found by review pass 5) say the gateway's backend
  WebSocket delivers "transaction events" only. Add that insight and consolidation push events also arrive over it,
  forwarded by the API from the gateway-only Redis channel. `docs/architecture/notification-pipeline.md` was
  reviewed: its `ChannelPush --> GatewayPush` edge becomes accurate, so no change.
- `docs/reference/wallet-threat-model.md:129-131`: worker-resolved audience, send-time cap re-check that fails closed,
  and recipient lists that "travel only on the gateway-only Redis channel, never to browser clients" (this exact
  wording; the Verification block greps for "gateway-only Redis").

**Files (29 + generated).**
- Production: `scripts/templates/README.template.md`, `README.md` (regenerated), `docs/reference/wallet-threat-model.md`,
  `gateway/ARCHITECTURE.md`, `gateway/README.md`,
  `gateway/src/services/backendEvents/notifications.ts`, `gateway/src/services/backendEvents/types.ts`,
  `server/src/services/notifications/channels/push.ts`, `server/src/services/notifications/channels/registry.ts`,
  `server/src/services/notifications/channels/types.ts`, `server/src/services/push/pushService.ts`,
  `server/src/websocket/gatewayEventMapper.ts`, `server/src/websocket/gatewayPush.ts`,
  `server/src/websocket/gatewayServer.ts`, `server/src/websocket/redisBridge.ts`, `server/src/websocket/server.ts`,
  `server/src/websocket/types.ts`.
- Tests: `gateway/tests/unit/services/backendEvents.notifications.test.ts`,
  `gateway/tests/unit/services/backendEvents.productionPayload.contract.test.ts`,
  `server/tests/unit/services/notifications/channels/handlers.test.ts`,
  `server/tests/unit/services/notifications/channels/pushGatewayDelivery.test.ts`,
  `server/tests/unit/services/notifications/channels/registry.test.ts`,
  `server/tests/unit/services/push/pushService.notifyWalletUsers.test.ts`,
  `server/tests/unit/websocket/gatewayEventMapper.test.ts`, `server/tests/unit/websocket/gatewayPush.test.ts`,
  `server/tests/unit/websocket/gatewayServer.test.ts`,
  `server/tests/unit/websocket/redisBridge.connected.test.ts`, `server/tests/unit/websocket/server.singleton.test.ts`, `tests/install/unit/compose-operator-env.test.sh`.
- The integrator adds `docs/architecture/generated/**` as regenerated and the changelog. The prototype's changelog
  and generated hunks are replaced by the integrator's.

**Acceptance.**
- The red is observed on the plan-commit base in the A worktree.
- Green: the server, gateway and root typecheck results above, plus `arch:check` in the integration worktree, which
  has a real `node_modules`.
- The pinned surfaces (D-18.X3) are unchanged.

**Rollback.** Code-only. Reverting restores direct-only push sends: insight/consolidation pushes stop again, and
transaction pushes are unaffected. No stored state changes.

**Changelog (Fixed).** "Push notifications for Treasury Intelligence insights and autopilot consolidation suggestions
are delivered again. The worker that runs these jobs has no APNs/FCM credentials (only the gateway does), so these
pushes were silently dropped even with the push toggle on. The worker now resolves the recipients and hands a minimal
event (wallet name plus severity and insight type, or fee rate; no AI summary text, amounts or UTXO counts) to the
gateway over a gateway-only Redis channel, and the backend re-checks each recipient's mobile `viewTransactions` cap
before the gateway sends. Known limitation: if no gateway is connected when the event is published, the push is
dropped, as transaction pushes already are."

## Implementation log (coordinator)

- Final reviewed plan commit: `9d9293804` (8 review passes). The A worktree was created from it.
- Setup (D-18.X2): integration worktree `npm ci` (810 entries, real dir), `prisma generate`, `build --workspace shared`.
- **C1** `2837a7f7b`:
  - Red: the test change alone failed (`FAIL: expected run_workflow_quality=true, got run_workflow_quality=false`, rc 1; `$SCRATCH/i18-c1-red.txt`).
  - Green: `classify-quality-scope regression checks passed`; `check-workflow-composition.test.sh` rc 0. 21 tracked action files.
- **B1** `7c85d4b04`:
  - Server red: 2 failed / 58 passed (`$SCRATCH/i18-b1-red-server.txt`).
  - Frontend red, observed here with real jsdom: `"username": null` received where `undefined` was expected (`$SCRATCH/i18-b1-red-frontend.txt`).
  - Green: route and openapi tests 136/136; NodeConfig suites 88/88; server tsc and `typecheck:app` clean; pre-commit frontend suite passed.
- **A1**: worker commit `fbac015ee`, cherry-picked with `-x` as `d938800eb`.
  - `git cherry` showed `-`; the A worktree and branch were removed.
  - Red on base: 8 of 12 `pushGatewayDelivery` cases failed with `usersNotified 0` because push `isEnabled()` is false (`$SCRATCH/i18-a-red.txt`). The transaction regression guard passed on base, as planned.
  - Divergences from the plan text, accepted:
    - the in-process send also requires `isGatewayConnected()`;
    - a publish failure rejects, so the dispatcher can report `success:false`;
    - `filterByViewTransactions` is shared by the transaction and push paths.
- **Integrator** `28f3029bd`: the three changelog bullets and `calls/notifications.md` regenerated; `arch:check` rc 0.
- **/simplify** `1db07044d` (three reviewers: reuse, quality, efficiency).
  - Applied:
    - `isGatewayPushEventType` guard;
    - mapper overloads removed (single branch in `mapAndSendEvent`);
    - `noRecipientsResult` helper, with an empty gateway audience now `no_recipients`/`none`;
    - one gateway forward that skips when no gateway is connected;
    - hoisted proxy schema.
  - Divergence: the shared forward is `GatewayWebSocketServer.forwardPushEvent` (`forwardToGateway` in `gatewayPush.ts` wraps it). An import from `gatewayPush.ts` into `server.ts` would have added a cycle that `check:server-cycle-baseline` rejects.
  - Declined:
    - moving the message strings into `shared/` (a pinned surface);
    - shared event-type literals across the package boundary.
- **Adversarial review** (security-reviewer). Two should-fix findings, fixed in `e6ed488c5`:
  1. The API re-filter did not re-check wallet access and passed Redis-supplied `walletName`/`severity` into the push text. It now intersects `userIds` with current direct or group wallet access (existing `findGatewayPushAudience(walletId, '')`, the same user set the transaction path uses; no repository edit) and re-reads `walletName` from the DB.
  2. Extra keys (a top-level `userId`, extra `data` keys) and wrong field types passed through. `parseGatewayPushEvent` now rebuilds the event from validated fields only, and the bridge and mapper drop anything else.

  - Red: 23 tests failed before the fix (`$SCRATCH/i18-adv-red.txt`).
  - Nits recorded, not changed:
    - delivery can be counted for an API instance with no gateway connected (documented OQ-A2 limitation);
    - the gateway's pre-existing info-level `userIds` log now also covers these pushes.
- Run state: the plan's `commitShas` contains a stray `3450cfe0508d` from a failed command during review pass 4 (see Review log). It is not a plan revision.
- **Verification block** (`$SCRATCH/i18-verify.sh`), run on `e6ed488c5`: exit 0 (`$SCRATCH/i18-verify.log`).
  - Backend coverage (`tests/unit`): 100/100/100/100 (43,039 statements, 24,353 branches).
  - Gateway coverage: 100% (725 statements).
  - Frontend coverage: 100% (27,344 statements, 17,438 branches).
  - Playwright static run: exit 1 recorded; 392 expected, 2 skipped, 7 unexpected, exactly the 7 known auth/login cases. No PNG baseline change.
  - Lizard: 83 at head = 83 at base, with no per-file growth.
  - This PR's quality scope: `run_ci_classifier_tests=true`, `run_workflow_quality=false`.
  - Also clean: the 37-file scope diff, the pinned surfaces, `arch:check` and the architecture-boundary, server-cycle, lifecycle, ownership-contract and supply-chain gates.
- An earlier run on `1db07044d` was stopped mid-coverage when the adversarial findings arrived; no processes were left.

## Verification (before every push)

The integrator runs this block on the integrated branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i18`
after the A worker's branch has been cherry-picked and the integrator commit made. The integration worktree has a
real (non-symlinked) `node_modules`, set up per D-18.X2. Write the block to `$SCRATCH/i18-verify.sh` and run it with
`bash`.

**Integrator steps before the block.**
1. Run `npm run arch:graphs` and `npm run arch:calls`, and commit `docs/architecture/generated` (if it changed) with
   the changelog bullets.
2. Record the B1 frontend red:
   ```bash
   BASE=41c6303163cea7d6ce33e6a4d2c97472f4f7fdfe
   F=src/components/NodeConfig/useProxyTorControls.ts
   git show "$BASE:$F" > "$F"
   npx vitest run --config config/tooling/vitest.config.ts tests/components/NodeConfig.test.tsx -t 'sends no null credentials'
   git checkout -- "$F"
   git diff --exit-code HEAD
   ```
   The vitest run must fail on `username: null`. Record its output.
3. Copy only `playwright.static.config.mts` and `known-auth-login-failures.txt` from `$SCRATCH/i17-playwright/` to
   `$SCRATCH/i18-playwright/`, and change the config's import path to the i18 worktree.

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i18
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i18
test "$(npm --version | cut -d. -f1)" = 12
test -d node_modules
test ! -L node_modules
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"
BASE=41c6303163cea7d6ce33e6a4d2c97472f4f7fdfe
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
SRV=""
LZ_BASE_DIR=""
cleanup() {
  if [ -n "$SRV" ]; then kill "$SRV" 2>/dev/null || true; fi
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
( cd gateway && npx tsc --noEmit )
# targeted backend: A1 (push via gateway), B1 (proxy test)
( cd server && npx vitest run tests/unit/services/notifications tests/unit/services/push tests/unit/websocket \
  tests/unit/services/intelligence tests/unit/services/autopilot tests/unit/api/admin-nodeConfig-routes.test.ts \
  tests/unit/api/openapi tests/unit/api/openapi.test.ts )
( cd gateway && npx vitest run )
# A1 touches redisBridge/websocket server and the worker's import graph: run the DB-free integration specs (ops-workers group)
( cd server && npx vitest run tests/integration/worker/worker.integration.test.ts tests/integration/websocket/websocket.integration.test.ts )
bash tests/install/unit/compose-operator-env.test.sh
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # scoped to tests/unit as CI
( cd gateway && npx vitest run --coverage )
# pinned surfaces (D-18.X3) and scope
PINNED_SURFACES=(
  config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation
  .github/mutation-baseline.json config/wallet-sync-mutation-boundaries.json config/wallet-sync-lifecycle-contract.json
  server/prisma config/resource-lifecycle-callsites.json scripts/verify-addresses scripts/perf
  server/src/services/bitcoin server/src/repositories server/src/services/accessControl.ts shared
  .github/workflows .nvmrc
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")"
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts
EXPECTED_FILES="$(sort <<'EOF'
README.md
docs/reference/changelog.md
docs/reference/wallet-threat-model.md
gateway/ARCHITECTURE.md
gateway/README.md
gateway/src/services/backendEvents/notifications.ts
gateway/src/services/backendEvents/types.ts
gateway/tests/unit/services/backendEvents.notifications.test.ts
gateway/tests/unit/services/backendEvents.productionPayload.contract.test.ts
scripts/ci/classify-quality-scope.sh
scripts/templates/README.template.md
server/src/api/admin/proxyTest.ts
server/src/api/openapi/schemas/admin/ops-monitoring-node.ts
server/src/services/notifications/channels/push.ts
server/src/services/notifications/channels/registry.ts
server/src/services/notifications/channels/types.ts
server/src/services/push/pushService.ts
server/src/websocket/gatewayEventMapper.ts
server/src/websocket/gatewayPush.ts
server/src/websocket/gatewayServer.ts
server/src/websocket/redisBridge.ts
server/src/websocket/server.ts
server/src/websocket/types.ts
server/tests/unit/api/adminNodeConfig/adminNodeConfig.proxy.contracts.ts
server/tests/unit/services/notifications/channels/handlers.test.ts
server/tests/unit/services/notifications/channels/pushGatewayDelivery.test.ts
server/tests/unit/services/notifications/channels/registry.test.ts
server/tests/unit/services/push/pushService.notifyWalletUsers.test.ts
server/tests/unit/websocket/gatewayEventMapper.test.ts
server/tests/unit/websocket/gatewayPush.test.ts
server/tests/unit/websocket/gatewayServer.test.ts
server/tests/unit/websocket/redisBridge.connected.test.ts
server/tests/unit/websocket/server.singleton.test.ts
src/components/NodeConfig/useProxyTorControls.ts
tests/ci/classify-quality-scope.test.sh
tests/components/NodeConfig.test.tsx
tests/install/unit/compose-operator-env.test.sh
EOF
)"
test "$(printf '%s\n' "$EXPECTED_FILES" | wc -l)" -eq 37   # A 29, B 5, C 2, plus the integrator's changelog
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' ':(exclude)docs/architecture/generated' | sort)"
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# A1: recipient lists never reach browsers; the shared union is untouched
if grep -n "ai_insight\|consolidation_suggestion" shared/types/websocket.ts; then echo "A1: push types leaked into the shared BroadcastEvent union" >&2; exit 1; fi
grep -qF "sanctuary:ws:gateway" server/src/websocket/redisBridge.ts
grep -qF setGatewayEventHandler server/src/websocket/server.ts   # the next check must not pass on a rename
GW_HANDLER="$(awk '/setGatewayEventHandler\(/{f=1} f{print} f&&/^  \}\);/{exit}' server/src/websocket/server.ts)"
test -n "$GW_HANDLER"
if grep -q localBroadcast <<<"$GW_HANDLER"; then echo "A1: gateway channel reaches localBroadcast" >&2; exit 1; fi
grep -qF "'ai_insight'," gateway/src/services/backendEvents/notifications.ts
grep -qF "'consolidation_suggestion'," gateway/src/services/backendEvents/notifications.ts
# B1 and C1 shape
grep -qF 'nullish()' server/src/api/admin/proxyTest.ts
grep -qF 'proxyUsername ?? undefined' src/components/NodeConfig/useProxyTorControls.ts
grep -qF '.github/workflows/*.yml|.github/workflows/*.yaml|.github/actions/*)' scripts/ci/classify-quality-scope.sh
bash tests/ci/classify-quality-scope.test.sh
bash tests/ci/check-workflow-composition.test.sh
npm run check:github-action-runtimes   # the action guard itself (CI job skipped for this PR); needs egress to data.forgejo.org — if it fails for lack of egress, restore egress and rerun the block (not a C1 regression)
# this PR's own scope: classifier suites yes, workflow guards no (C1 acceptance)
CQ_OUT="$SCRATCH/i18-quality-scope.out"
: >"$CQ_OUT"
( unset PR_HEAD_SHA $(compgen -v | grep -E '^SANCTUARY_CI_.*_OVERRIDE$' || true)
  export EVENT_NAME=pull_request GITHUB_OUTPUT="$CQ_OUT" PR_BASE_SHA="$BASE" PUSH_BEFORE_SHA="$BASE" \
    MERGE_GROUP_BASE_SHA="$BASE" MERGE_GROUP_HEAD_SHA="$(git rev-parse HEAD)" WORKFLOW_SHA="$(git rev-parse HEAD)"
  bash scripts/ci/classify-quality-scope.sh )
grep -qx 'run_ci_classifier_tests=true' "$CQ_OUT"
grep -qx 'run_workflow_quality=false' "$CQ_OUT"
# docs and changelog
grep -qF 'gateway-only Redis channel' <<<"$(tr '\n' ' ' <docs/reference/changelog.md | tr -s ' ')"
grep -qF 'Invalid proxy configuration' <<<"$(tr '\n' ' ' <docs/reference/changelog.md | tr -s ' ')"
grep -qF 'vendored artifact bundle' <<<"$(tr '\n' ' ' <docs/reference/changelog.md | tr -s ' ')"
grep -qF 'gateway-only Redis' <<<"$(tr '\n' ' ' <docs/reference/wallet-threat-model.md | tr -s ' ')"
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/components/NodeConfig.test.tsx tests/components/NodeConfig
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # 100% threshold
# Playwright static run (CLAUDE.md procedure; known 7 auth/login failures recorded, not gated)
PW_DIR="$SCRATCH/i18-playwright"
grep -qF "/home/nekoguntai/sanctuary-bug-scrub-20261013-i18/config/tooling/playwright.config.ts" "$PW_DIR/playwright.static.config.mts"
rm -f "$PW_DIR/results.json" "$PW_DIR/failing.txt" "$PW_DIR/unexpected.txt"
npm run build
if curl -fsS -o /dev/null http://127.0.0.1:4173/ 2>/dev/null; then echo "port 4173 already serving" >&2; exit 1; fi
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SRV=$!
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done
kill -0 "$SRV"
PW_RC=0
npx playwright test --config "$PW_DIR/playwright.static.config.mts" --reporter=json >"$PW_DIR/results.json" || PW_RC=$?
echo "playwright exit $PW_RC (recorded)"
kill "$SRV" 2>/dev/null || true
SRV=""
test "$(jq '.stats.expected + .stats.unexpected + .stats.flaky' "$PW_DIR/results.json")" -ge 380
jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | .file + " :: " + .title] | .[]' "$PW_DIR/results.json" | sort -u >"$PW_DIR/failing.txt"
comm -23 "$PW_DIR/failing.txt" "$PW_DIR/known-auth-login-failures.txt" >"$PW_DIR/unexpected.txt"
test ! -s "$PW_DIR/unexpected.txt" || { cat "$PW_DIR/unexpected.txt" >&2; exit 1; }
git diff --exit-code "$BASE" HEAD -- tests/e2e/render-regression.spec.ts-snapshots
test -z "$(git status --porcelain -- tests/e2e/render-regression.spec.ts-snapshots)"
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i18-lizard.txt"
LZ_BASE_DIR="$SCRATCH/i18-lizard-base"
git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true   # a vanished or stale earlier copy
git worktree prune
git worktree add -q --detach "$LZ_BASE_DIR" "$BASE"   # lizard-only.sh needs a git checkout (an archive copy fails rc 128)
( cd "$LZ_BASE_DIR" && LIZARD_BIN="$PINNED_LIZARD" bash scripts/quality/lizard-only.sh ) >"$SCRATCH/i18-lizard-base.txt" 2>&1
LZ_BASE_TOTAL="$(grep -c ': warning:' "$SCRATCH/i18-lizard-base.txt")"
test "$LZ_BASE_TOTAL" -gt 0   # the base run produced output
test "$(grep -c ': warning:' "$SCRATCH/i18-lizard.txt")" -le "$LZ_BASE_TOTAL"   # D-18.X4: total does not grow
mapfile -t LZ_CHANGED < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- '*.ts' '*.tsx')
for f in "${LZ_CHANGED[@]}"; do
  test -f "$f"
  head_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$f" | grep -c ': warning:' || true)"
  base_n=0
  if [ -f "$LZ_BASE_DIR/$f" ]; then base_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$LZ_BASE_DIR/$f" | grep -c ': warning:' || true)"; fi
  test "$head_n" -le "$base_n" || { echo "D-18.X4: $f warnings $base_n -> $head_n" >&2; exit 1; }
done
git worktree remove --force "$LZ_BASE_DIR"
LZ_BASE_DIR=""
node scripts/quality/check-large-files.mjs
npm run arch:check
npm run check:architecture-boundaries   # Architecture lane gates (not PR-required; a regression would first show on main)
npm run check:server-cycle-baseline
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract   # CI's lifecycle-callsites lane command
node scripts/ci/check-supply-chain-locks.mjs
git diff --check "$BASE" HEAD
test -z "$(git status --porcelain)"
echo "i18 verification passed"
```

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i18`: three finding commits (C1, B1, A1) plus the integrator commit, after the plan commits (`tasks/` only, excluded
  from the scope diff); squash-merged.
- **Merge:**
  - Squash through protected `main`; no admin bypass.
  - Merges are strictly serial. This PR is rebased only when it is the next to merge.
  - Poll the required contexts via `/commits/<sha>/statuses`.
  - Never pass `delete_branch_after_merge`.
  - After merging, verify the reported `merge_commit_sha` exists locally and is an ancestor of `origin/main` before
    deleting the branch.
  - Verify target-branch CI on the merge commit.
- **Expected CI lanes** (a missing expected lane is investigated, not assumed skipped):
  - Code Quality, including **ci-classifier-tests**, selected by C1's `scripts/ci/*` change. **Workflow policy
    guards** is an allowed skip (`run_workflow_quality=false`; see C1 Acceptance).
  - Test Suite: backend unit and coverage shards, Full Backend Typecheck, frontend unit and coverage, render/browser
    e2e, and gateway tests.
  - Verify Bitcoin Vectors: any non-documentation path runs it.
  - Docker build: the server and gateway images.
  - The install and release-candidate lanes their classifiers select. `scripts/ci/*` is a release-surface path.

  Record the run and job IDs. Architecture is not PR-required: watch its post-merge run on `main`.
- **CI triage is infrastructure first** (CLAUDE.md): sora contention (several mutation or emulator jobs at once) is
  the first suspect for a sora-only timeout. Podman archive stalls, the npm advisory endpoint, DIND, a stranded e2e
  lock and kumo's native builder follow.
- **Retriggers** carry the four-part evidence: SHA plus run/job IDs, failure signature, new hypothesis and cheap
  discriminator.
- **PR-body flags:**
  - A1 is a recurrence of #1404 with a new root cause (deployment environment).
  - Delivery goes through the gateway over a gateway-only Redis channel.
  - Recipient lists never reach browser clients.
  - The known fire-and-forget limitation.
  - The `notifyWalletUsers` throwing-predicate behaviour change.
  - B1 accepts `null` proxy credentials (OpenAPI nullable).
  - C1 routes every `.github/actions/**` path to the workflow guards and classifier suites.
  - "No migration, no new endpoint, no e2e mock-map change, no workflow edit, no version bump."
- **Rollback:** every phase is code, test or docs only. There is no schema or stored-shape change, and each commit
  reverts independently.
- **Deployment:** none until clean closeout (`--deploy final`). The local stack is rebuilt only after the loop
  closes, from `/home/nekoguntai/sanctuary-main`.

## Completion criteria

- [ ] Every failing-first test fails on `41c6303163ce` code for the stated reason and passes on the PR head:
  - A1: observed in the A worktree;
  - B1 server: observed;
  - B1 frontend: the integrator's base swap;
  - C1: observed.
- [ ] Verification block run as written on the integrated branch, with exit status 0 recorded. This includes
  backend coverage scoped to `tests/unit`, gateway coverage, frontend coverage at 100%, lizard ≤ the base total (83), the 37-file
  scope diff, the empty pinned-surface diff, `arch:check` and the Playwright static run.
- [ ] `/simplify` and an adversarial implementation review run on the integrated diff; their findings are fixed or
  recorded.
- [ ] PR head CI green, with run and job IDs recorded, including ci-classifier-tests; Workflow policy guards recorded
  as an allowed skip.
- [ ] PR merged; required contexts green; target-branch CI green on the merge commit (and the post-merge
  Architecture run); `merge_commit_sha` ancestry verified; branches and worktrees cleaned.
- [ ] Run state: the three findings resolved. A1's attempt record notes the recurrence.
- [ ] The P3 backlog stays outside the blocking fix set.

## Review log

- Draft assembled 2026-10-29 from the S3/S7/G3 findings and prototypes `plan18-{A,B,C}-prototype.patch` (source
  `41c6303163ce`). All three apply cleanly to the i18 branch (`git apply --check`). With B and C applied, lizard on
  the scratch copy measures 83.
- **Pass 1 (2026-10-29): three reviewers (Phase A1; Phases B1/C1 and Verification; the whole plan).**
  - Applied, A1:
    - `notifyTransactions` returns `no_recipients` without credentials (blocking: the widened `isEnabled()` would
      have downgraded every transaction's safe outcome to `partial`);
    - the publish result is awaited and counted;
    - lookup-failure logging;
    - the empty audience is not sent;
    - the `GATEWAY_SECRET` forward rows in `compose-operator-env.test.sh`;
    - the in-process branch is documented;
    - the madge/import-load question settled with evidence;
    - the worker and websocket integration specs added to Verification.
  - Applied, C1:
    - 21 tracked action files and guard floor `-ge 21` (the scratch copy had lost the 4 vendored `dist` files; red
      and green re-observed on a full clone);
    - Workflow policy guards expected as an allowed skip (blocking: it would never appear), with the PR scope and
      `check:github-action-runtimes` checked locally instead;
    - extra rationale (provider-leak scan, semgrep side effect).
  - Applied, B1: an exact red-swap command.
  - Applied, whole plan:
    - the deferred-P3 count is 20;
    - setup in both worktrees before C1;
    - commit-hook constraints;
    - the Playwright copy list;
    - tr-joined changelog greps and a rename guard;
    - `check:resource-ownership-contract`.
  - Rejected: the optional `targetHost`/`targetPort` client-type cleanup (no caller sends them; outside the P2).
- **Pass 2 (2026-10-29): two reviewers (pass-1 changed areas; full read).**
  - Applied, A1:
    - transactions take the registry's existing disabled branch through an optional per-family
      `isTransactionDeliveryEnabled` (the pass-1 early return still wrote a push `transport_attempted` event per
      transaction);
    - exact receiver-count and in-process delivery rules, and the zero-receiver outcome (`no_recipients`/`none`), with
      worker and API-topology cases;
    - the threat-model wording fixed to the grepped phrase;
    - the handler placed after the broadcast handler, and the localBroadcast check scoped to the handler body;
    - the `broadcasts.ts:8` citation.
  - Applied, Verification:
    - per-file and total lizard comparison against a base copy, instead of a hard-coded 83;
    - the classifier output kept in `$SCRATCH`, with ambient override variables unset;
    - the egress note for `check:github-action-runtimes`.
  - Applied, delivery: the A worktree base is the final reviewed plan commit.
  - Rejected: none.
- **Pass 3 (2026-10-29): one full-plan reviewer.**
  - Applied:
    - D-18.A1b's two source files (`channels/registry.ts`, `channels/types.ts`) and `registry.test.ts` added to A1's
      files and the scope check (A 22 → 25, total 33; blocking: the scope diff would have failed), with tests for
      both arms of the new branch;
    - the external receiver count computed in `redisBridge` (it alone knows about its own subscriber), the
      resubscribe-window gap documented, and the full delivery-rule test matrix;
    - the lizard base worktree pruned before use and removed by the EXIT trap;
    - `test -f` per changed file;
    - Completion reads "≤ the base total (83)".
  - Confirmed, no edit: no other path calls push `isEnabled` with a changed outcome (drafts are excluded by
    capability; consolidation channel ids are settings-only; channel listings do not call `isEnabled`).
  - Rejected: none.
- **Pass 4 (2026-10-29): one full-plan reviewer.**
  - Applied:
    - A1 edits the canonical `scripts/templates/README.template.md` and regenerates `README.md` (blocking:
      `tests/docs/readme-links.test.ts:158` would have failed; reproduced on a scratch copy with the prototypes;
      A 25 → 26, total 34);
    - OQ-A2 aligned with D-18.A1c (counted and marked only when delivered);
    - the egress note now says to restore egress and rerun.
  - Rejected: none.
  - Run-state note: a failed edit command during this pass appended `3450cfe0508d` (an older `main` commit with no
    plan file) to this plan's `commitShas` in run state. The history is append-only, so the entry stays. It is not a
    plan revision; the pass-4 plan commit follows it.
- **Pass 5 (2026-10-29): one full-plan reviewer** (focus: generated and mirrored artifacts).
  - Applied:
    - the Architecture lane's dependency-cruiser gates (`check:architecture-boundaries`, `check:server-cycle-baseline`)
      added to Verification, both green on the prototype;
    - `gateway/ARCHITECTURE.md` and `gateway/README.md` updated with the README text (A 26 → 28, total 36);
    - `notification-pipeline.md` reviewed, unchanged;
    - Delivery names the plan commits.
  - Confirmed, no desync: OpenAPI is hand-written (no generated spec or snapshot); changelog tests check headings
    only; the docs site keeps no copies; no i18n or `*.generated.*` files; the lifecycle registry needs no new
    entries.
  - Rejected: none.
- **Pass 6 (2026-10-29): one full-plan reviewer.**
  - Applied: the empty-audience `mapAndSendEvent` test moved to the existing `gatewayServer.test.ts` (the mapper test
    cannot build a gateway server), and that file added to A1's files and the scope check (A 28 → 29, total 37).
  - Rejected: none.
- **Pass 7 (2026-10-29): one full-plan reviewer** (focus: a named test file in scope for every new branch).
  - Clean on coverage and scope: every new branch maps to a named test file in `EXPECTED_FILES` (37).
  - Applied two low-severity consistency edits:
    - the prototype's `server.singleton.test.ts` log expectation follows `getErrorMessage`;
    - the stale "8 cases" count.
  - Rejected: none.
- **Pass 8 (2026-10-29): one independent full-plan reviewer — clean, review converged.** No verified actionable
  comments. Noted, not edited: `registry.test.ts` is 851 lines at base, so "longest touched test file 740 lines"
  describes only the prototype. The new cases keep it well under the 1,000-line gate.
