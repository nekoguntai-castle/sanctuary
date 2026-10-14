# Bug-scrub loop 2026-10-13 — iteration 4 remediation plan

- Run: `bug-scrub-loop-20261013-sanctuary`, iteration 4
- Source SHA: `f2c7e217d0ff7cab2900b5add438183e6d819afd` (origin/main after PRs #1389–#1392)
- Scope: whole repository (locked at run start)
- Branch / worktree: `codex/bug-scrub-loop/20261013-i4` in `/tmp/sanctuary-bug-scrub-20261013-i4`
  (per-PR delivery branches are cut from `origin/main`, see Delivery)
- Deploy policy `final`: no container rebuild in this plan.

## Goal

Fix all 27 P0–P2 findings accepted by the iteration-4 rescrub and planning: 1 P0, 5 P1 and
21 P2 (27 blocking). That includes `wallet-list--load-error-shows-empty-state`, found while planning C7, and
`broadcast--all-own-output-amount-mismatch` (B12), found while reviewing C1. Each
fix gets a non-regression test that fails on `f2c7e217` and passes after the fix. A phase whose
test-first gate passes on `f2c7e217` is recorded as `rejected` with that evidence and dropped
from its PR. B1 carries an explicit gate of this kind.

## Non-goals

- All P3 findings (about 70 in the run-state backlog), including P3s noted inside phases.
  `feature-flags--load-error-dropped` (P3) is the one exception: C7's assertions need it, so it
  is fixed there.
- Prisma schema or migration changes (RC10 migration digest is pinned).
  `TransactionSigningIntent.broadcastState` is a plain `String` column, so B3's new `stalled`
  value needs no migration.
- Product-policy changes beyond the explicitly flagged **Decision** items. Each takes the
  conservative option: fail closed, refuse with an actionable message, or remove a misleading
  signal.

## Assumptions

- Express 5, Prisma 7 (`^7.10.0`, adapter-pg 7.10.0), ws ^8.21 and bitcoinjs-lib 7.0.2 behave as
  cited in each phase. Phases whose behaviour is uncertain carry a test-first gate.
- Implementation runs `npm ci` inside each implementation worktree (nvm node 24.21.0 / npm 12),
  plus `llm-egress-proxy` `npm ci`, `server npx prisma generate` and `shared npm run build`.

## Delivery groups and PR sequence

Four PRs, merged strictly serially in this order:

1. **PR A — P0 hotfix (A1).** It ships alone and first, so the unauthenticated API crash is
   fixed before any lower-severity work. The loop contract requires a P0 to be delivered
   before unrelated lower-severity work.
2. **PR B — server, funds and edge (B1–B12).** B3 and B12 touch the critical-mutation lane. B10 wires a new env
   var through `docker-compose.yml` and `start.sh`, so PR B also runs the install-test lanes.
3. **PR C — frontend (C1–C7).** C1 includes a small server change to the CPFP response shape. C1 depends
   on B12 (a CPFP child draft cannot broadcast without it), so PR B must merge before PR C.
4. **PR D — CI, ops and install (D1–D6).** It changes lane classification and install and
   offline scripts, and lands last so the CI lane plan does not change under PRs A–C.

Split rationale: the P0-first rule, distinct gating surfaces (critical-mutation, verify-vectors and,
through B10, install-test for B; Playwright and e2e for C; classifier and install lanes for D), and review
size. Each PR carries its own phase commits and regression tests. The plan file lands with PR A.

## Cross-cutting gating facts (read before any phase)

- **No new migrations.** Any data shape change must reuse existing columns. B3 adds a
  `broadcastState` string value.
- **Bitcoin pin files.** For any edit to a file named in `config/wallet-safety-mutation-map.json`
  or in a `server/stryker.*.config.mjs` `mutate` range (notably `advancedTx/cpfp.ts`, `rbf.ts`,
  `signingIntent/*`):
  - keep edits outside the pinned ranges or line-neutral above them, or shift both the map and
    the Stryker ranges by the same delta;
  - then rerun the profile and confirm every canary is present and `Killed`.
  C1 must keep its `cpfp.ts` edits below line 78.
- **Critical-mutation lane.** `signingIntent/*` and the other `is_critical_mutation_file` paths
  run Stryker shard 3 against `.github/mutation-baseline.json`. Every new branch needs a killing
  unit test.
- **Signer inventory.** Add no new `finalize*`, `sign*` or `broadcast*` identifiers without
  running `npm run verify:signer-inventory`.
- **Sync-path boundaries.** New repository calls in sync-path files need
  `config/wallet-sync-mutation-boundaries.json`. Sync-path files may import only `*Repository`
  bindings from `repositories/`.
- **API surface.**
  - A new API endpoint must be added to OpenAPI (`server/src/api/openapi/**`; checked by
    `check-openapi-route-coverage`) and to every e2e mock map that could reach it (grep
    `transactions/balance-history` under `tests/e2e`).
  - API routes may not import repositories directly (`check-architecture-boundaries`).
    Delegate through a service.
- **Test registration.**
  - New `server/tests/integration` specs must be registered in
    `scripts/ci/backend-integration-groups.sh`.
  - New `tests/ci` scripts go in the `quality.yml` lists and `ci-registration-completeness`.
  - Test fixtures that `rm`/`kill` need `config/resource-lifecycle-callsites.json` entries.
    `git add` new files first, because the checker skips untracked files.
- **Generated files.**
  - Run `npm run arch:check` and commit regenerated `docs/architecture/generated/**`.
  - `README.md` is generated from `scripts/templates/README.template.md`.
- **Size limits.** Files over 1,000 lines fail `check-large-files` unless classified. Lizard
  counts a `describe` without a nested `function` as one function.
- **Lizard warning budget is shared and nearly spent.** The repo is at 84 lizard warnings against
  `LIZARD_WARNING_BASELINE` 86 (`scripts/quality.sh:21`, threshold `-C 15` at `:290`), and all four PRs draw on
  that one budget. No phase may add a lizard warning. New logic goes in **top-level** (module-level, not nested)
  helpers so existing handlers gain no branches (see B10). Run `bash scripts/quality/lizard-only.sh` and record
  the warning count in each PR.

---

## Group A — PR A — P0 hotfix

Base: `origin/main` f2c7e217d0. Evidence re-read in `/tmp/sanctuary-bug-scrub-20261013-i4`. PR A ships
alone, ahead of every other group. It has no schema or migration change and touches no bitcoin file,
inventory, or e2e mock map.

### Phase A1 — Unauthenticated client can crash the API via a `/ws` socket with no `error` listener (P0, `websocket-upgrade--no-error-listener-before-auth`)

**Evidence (reproduces at f2c7e217).**
- `server/src/websocket/clientServer.ts:97-135` `handleConnection`. The connection-limit branch (`:113-117`) calls
  `client.close(1008, …)` and returns. The async-auth branch (`:120-131`) returns while the token is still
  being verified. Neither branch attaches any listener.
- The only `client.on('error', …)` is at `:185`, inside `completeClientRegistration`. Three paths never reach it:
  - a junk bearer or cookie token (`server/src/websocket/auth.ts:180-184`, `close(1008,'Authentication failed')`);
  - the per-user limit (`auth.ts:163-169`);
  - the global limit (`clientServer.ts:113-117`).
  On those sockets the error listener is either never attached or attached only after an await.
- `ws@^8.21.3` (`server/package.json:104`) emits `'error'` on the `WebSocket` when its receiver rejects a frame
  (invalid opcode, RSV bits, unmasked client frame, oversize). This can happen during the closing handshake.
  With no listener, `EventEmitter` throws, the throw becomes `uncaughtException`, and
  `registerFatalProcessHandlers` (`server/src/index.ts:383` → `shared/utils/fatalProcessHandlers.ts:63`)
  shuts the API down.
- The same gap exists on the gateway path: `server/src/websocket/gatewayServer.ts:78-82` closes with 4003
  and returns before its listener at `:125`. It is reachable only when `GATEWAY_SECRET` is unset.

**Change.**
1. In `clientServer.ts` `handleConnection`, attach the error and close handlers as the first statements after
   the client fields are initialised, before the limit check:
   - `client.on('error', (error) => { log.warn('WebSocket error', { error: getErrorMessage(error), registered: this.clients.has(client) }); client.closeReason = 'error'; this.handleDisconnect(client); client.terminate(); })`
   - `client.on('close', () => this.handleDisconnect(client))`

   `handleDisconnect` (`:255-…`) is already safe on an unregistered client: it clears the auth timers and
   returns early at `if (!this.clients.delete(client)) return;`.
2. Delete the `'close'` and `'error'` registrations in `completeClientRegistration` (`:179-189`) so each
   handler runs exactly once. Keep `message` and `pong` there.
3. In `gatewayServer.ts` `handleConnection`, move the existing `client.on('error', …)` (`:124-127`) above the
   `config.gatewaySecret` check (`:78`).
4. No other change to `auth.ts`. Its `.then`/`.catch` already guard on `isClientLiveForAdmission`.

**Test first.**
- Unit: `server/tests/unit/websocket/clientServerLimits/clientServerLimits.auth-upgrade.contracts.ts`, run via
  `clientServerLimits.test.ts`. The fake client from `createClient` (`clientServerLimitsTestHarness.ts:111-140`)
  records handlers in a Map. Add:
  - (a) Async auth with `mockVerifyToken` left pending: after `handleConnection`, an `'error'` handler is
    registered, and invoking it does not throw and calls `client.terminate`.
  - (b) Global limit: an `'error'` handler exists after the early close. `MAX_WEBSOCKET_CONNECTIONS` is a
    module constant read from the env at import (`websocket/types.ts:19`). Reach the limit the way the existing
    "rejects new connection when total connection limit is reached" case does
    (`clientServerLimits.auth-upgrade.contracts.ts:195-203`): set `process.env.MAX_WEBSOCKET_CONNECTIONS = '0'`
    **before** `loadServer()`, which calls `vi.resetModules()` and re-imports the server
    (`clientServerLimitsTestHarness.ts:105-109`); the harness `beforeEach` restores the env to `'10000'`
    (`:181`). Extend that case, or add a sibling with the same setup, to assert that the `'error'` handler is
    registered and invoking it neither throws nor leaves the client registered. Never fill the private `clients`
    set with 10,000 dummy clients: the heartbeat iterates and pings every entry (`clientServer.ts:457-459`).
  - (c) Post-fix double-registration guard: after a successful registration through `handleConnection`,
    `'error'` and `'close'` are each registered exactly once. This passes at base too
    (`completeClientRegistration` registers each once, `clientServer.ts:173-189`), so it is not a discriminator;
    it guards against the fix registering the handlers twice.

  The base discriminators are (a), (b) and the gateway test below: at f2c7e217 no handler is registered.
- Rewrite the existing tests in `clientServerLimits.message-flow.contracts.ts:63-79` (message/close routing) and
  `:80-95` (pong and error callback). They call `completeClientRegistration` directly and then emit
  `close`/`error`, which no longer reaches handlers registered there. Drive them through `handleConnection`
  with no token instead.
- Gateway unit: in `server/tests/unit/websocket/gatewayServer.test.ts`, with `gatewaySecret` unset, an
  `'error'` handler is registered before the 4003 close.
- Integration (a real `ws` frame parser; the fake sockets cannot see this bug):
  `server/tests/integration/websocket/websocket.integration.test.ts`, already registered in
  `scripts/ci/backend-integration-groups.sh:101`. Use `createWebSocketTestServer()`
  (`tests/integration/setup/websocketHarness.ts`). The spec mocks `verifyToken` to accept **any** token
  (`websocket.integration.test.ts:8-20`), so as written a junk-token socket would register before the frame
  arrives and the test would pass at base. Make the junk token's verification hang instead:
  1. `vi.mocked(verifyToken).mockImplementationOnce(() => new Promise(() => {}))`, then connect with header
     `Authorization: Bearer junk`. The socket stays in async auth, unregistered.
  2. On `open`, write a raw frame with a reserved opcode, masked and zero-length:
     `socket._socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]))`. The frame lands before registration.
  3. Assert that a `process.on('uncaughtException')` spy installed for the test is not called within 200 ms.
     At base the unlistened `'error'` surfaces as a Vitest "Unhandled Error", which fails the run.
  4. Assert that a second client can still connect and receives `connected`.

  Repeat once with the server at the connection limit. `MAX_WEBSOCKET_CONNECTIONS` is a module constant, so
  either set `MAX_WEBSOCKET_CONNECTIONS` in the env before the harness imports the server (`vi.resetModules()`
  plus a dynamic import, the integration analogue of unit test (b)), or swap the server's private `clients`
  set (`clientServer.ts:69`) for a `Set` subclass whose `size` getter returns `MAX_WEBSOCKET_CONNECTIONS`,
  reached through `handle.wsServer` (the integration harness exposes the server instance,
  `websocketHarness.ts:15`), e.g. `(handle.wsServer as any).clients`. Do not open thousands of real sockets. In this variant, restore the original
  `clients` set (or end the env override) before step 4, or drop step 4: while the limit holds, the second
  client is rejected too (`clientServer.ts:113-117`).

**Constraints.**
- `server/src/websocket` is outside the safety-catch scan roots and every inventory, so no gate config changes.
- `clientServer.ts` is 498 lines, so the large-file gate is unaffected.
- Unit coverage must stay at 100%: the new handlers are hit by tests (a), (b) and (c).

**Acceptance.**
- No sequence of bytes from an unauthenticated or limit-rejected socket can raise `uncaughtException`.
- Registered clients behave as before, with one intended change: on `'error'` they are now `terminate()`d and the
  error is logged at `warn` (was `error`). `ws` already closes the socket on a receiver error, so `terminate()`
  only makes the teardown explicit.
- `cd server && npx tsc --noEmit && npm run typecheck:tests && npx vitest run --coverage tests/unit` is green.
- The integration spec passes with a real `ws` frame parser (it mocks JWT verification, access checks and
  metrics, so it is not a real-Postgres/Redis proof).

**Files touched.** `server/src/websocket/{clientServer.ts,gatewayServer.ts}`; tests
`server/tests/unit/websocket/clientServerLimits/{clientServerLimits.auth-upgrade.contracts.ts,clientServerLimits.message-flow.contracts.ts}`,
`server/tests/unit/websocket/gatewayServer.test.ts`, `server/tests/integration/websocket/websocket.integration.test.ts`.

---

## Group B — PR B — server, funds & edge (B1–B12)

Base: `origin/main` f2c7e217d0. Every finding below was re-read at that SHA. There are **no Prisma
schema or migration changes** in this group (RC10 migration digest). `broadcastState` is a free `String`
column (`schema.prisma:802`), so a new state value needs no migration.

Cross-cutting for PR B:
- **Critical-mutation lane.** B3 edits `networkOperations.ts`, `signingIntent/broadcastReconciliation.ts`,
  `transactions/broadcasting.ts` and `transactionSigningIntentRepository.ts`; B12 edits
  `server/src/api/transactions/broadcasting.ts` (Stryker shard 3, `broadcast-auth-access`,
  `server/scripts/mutation/shards.mjs:32-45`). All of them match
  `is_critical_mutation_file` (`scripts/ci/classify-files-lib.sh:73`), which triggers `stryker.critical`
  shard runs gated by `.github/mutation-baseline.json`. Every new branch needs a killing unit test.
- **Mutation map and Stryker pins.** No B phase touches a file pinned in `config/wallet-safety-mutation-map.json`
  or in a `server/stryker.*.config.mjs` `mutate` range. Checked: `batch`, `cpfp`, `rbf`, `psbtAccountBinding`,
  `rawTransactionEvidence`, `artifactValidation`, `feePolicy`, `createBatchTransaction`, `outputBuilder`,
  `psbtConstruction`, `psbtInputConstruction`, `transactionWeight`, `utxoSelection`.
  B8 deliberately puts its new helper under `services/vaultPolicy/` rather than editing
  `services/bitcoin/utils.ts`.
- **Signer inventory.** Add no new `finalize*`, `sign*` or `broadcast*` identifiers. Run
  `npm run verify:signer-inventory`; no drift is expected.
- **Sync path.** B4 edits `sync/confirmations/feePopulation.ts`, which makes no repository calls. Run
  `node scripts/check-wallet-sync-mutation-boundaries.mjs` and
  `node scripts/check-wallet-sync-lifecycle-contract.mjs`; no boundary entry is expected.
- **Integration specs.** Put new integration specs in already-registered files where possible. B1 (unless
  rejected by its gate), B2 and B10 (a Redis-gated spec) each add one new file and register it in
  `scripts/ci/backend-integration-groups.sh`.
- **Install-test lanes.** B10 edits `docker-compose.yml`, `start.sh`, `tests/install/unit/install-script.test.sh`
  and `tests/install/e2e/upgrade-install.test.sh`, so PR B also runs the install-test lanes.
- **Gates to run.**
  - Server: `cd server && npx tsc --noEmit && npm run typecheck:tests && npx vitest run --coverage tests/unit`.
  - Gateway (B9): `cd gateway && npx tsc --noEmit && npx vitest run --coverage`.
  - Install unit (B10): `bash tests/install/unit/install-script.test.sh`, plus `bash -n` on
    `tests/install/e2e/upgrade-install.test.sh` and `start.sh`.
  - Frontend (B2): `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npx vitest run --coverage`.
  - Then `npm run build` plus Playwright against a static `dist/`, per CLAUDE.md.
  - Run `npm run arch:check` in the primary checkout and commit `docs/architecture/generated` if it regenerates
    anything (B2's new frontend module and B11's removed edge may; B8's import is not expected to, because the
    server graph collapses at `src/<dir>`).
  - Run `node scripts/quality/check-large-files.mjs`.

---

### Phase B1 — Agent funding lock and alert dedupe use `$queryRaw` on a `void` function (P1, `agent-funding-lock--queryraw-void-advisory-lock`)

**Evidence (reproduces by code reading; the integration test below is the discriminator).**
- `server/src/repositories/agentRepository.ts:512`: `createAlertIfNotDuplicate` runs
  `await tx.$queryRaw\`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))\``.
- `:713`: `withAgentFundingTransaction` runs the same statement. It is used by `agentApiService.ts:342`
  (funding-draft submission) and, through `withAgentFundingLock`, by the operational receive-address path.
- `server/src/repositories/sessionFamilyLock.ts:7-11` (commit d91189cb39) documents that the Prisma pg adapter
  cannot deserialize the `void` result through `$queryRaw`. Every other lock site uses `$executeRaw`:
  `walletImportLock.ts:12`, `syncRbf.ts:17`, `sync.ts:61,799`, `syncIntentRepository.ts:240,269`,
  `walletSyncRetirementLock.ts:11`.
- The unit harness hides the failure: `tests/unit/repositories/agentRepository.testHarness.ts:66` mocks
  `$queryRaw` to return `[{ pg_advisory_xact_lock: '' }]`. No integration test calls either function.

**Change.** At both sites, replace `tx.$queryRaw` with `tx.$executeRaw`. Copy the one-line adapter comment from
`sessionFamilyLock.ts`. Leave `hashtext` and the lock keys unchanged so the lock space stays compatible during a
rolling deploy.

**Test first.**
- New integration spec `server/tests/integration/repositories/agentRepository.advisoryLocks.test.ts`, using
  `describeIfDatabase` and `setupRepositoryTests`, modelled on `agentRepository.sumDraftAmounts.test.ts`:
  - (a) `withAgentFundingTransaction(agentId, async tx => tx.walletAgent.findUnique(...))` resolves.
  - (b) `createAlertIfNotDuplicate({dedupeKey: \`k-${randomUUID()}\`, …}, since)` returns a row, and a second
    call with the same key returns `null`.
  - (c) Two concurrent `createAlertIfNotDuplicate` calls with the same key produce exactly one row
    (`Promise.all`).
  - Test data: every test creates its own agent fixture and uses a unique `dedupeKey`
    (`` `k-${randomUUID()}` ``), as `agentRepository.sumDraftAmounts.test.ts` does.
    `setupRepositoryTests` does no cleanup between tests (`tests/integration/repositories/setup/hooks.ts:17-25`),
    so fixed keys or shared agents would collide across tests and reruns.

  **Gate (Goal rule).** If (a)–(c) pass on f2c7e217, the adapter now deserializes `void` and the finding does not
  reproduce. Record B1 as `rejected` in the run state with the passing test output as evidence, and drop the
  phase (code change, unit edits and new spec) from PR B. There is no P3 downgrade and no "consistency fix"
  carry-over.
- Register the new file in `scripts/ci/backend-integration-groups.sh` next to `:56`, in the same group as
  `agentRepository.sumDraftAmounts.test.ts`.
- Unit: in `tests/unit/repositories/agentRepository.funding.test.ts:22,39,376,410,427` and the harness `:47,66`,
  switch the expectations to `$executeRaw`. The harness `$transaction` passes `mockPrisma` itself as `tx`
  (`agentRepository.testHarness.ts:62-65`), so there is no separate harness tx: add `$executeRaw: vi.fn()` next
  to `$queryRaw` in the `mockPrisma` object (`:47`) and `prisma.$executeRaw.mockResolvedValue(1)` in
  `resetAgentRepositoryMocks` (`:61-67`).

**Constraints.** Not a sync-path file and not an inventory file. CI's backend-integration classifier test
(`scripts/ci/backend-integration-groups.sh` registry) must list the new spec.

**Acceptance.**
- Either the gate fails on base and, after the fix, both lock sites run against real Postgres and concurrent
  alert dedupe inserts exactly one row; or the gate passes on base and B1 is recorded `rejected` and dropped.
- Unit coverage stays at 100%.

**Files touched (if not rejected).** `server/src/repositories/agentRepository.ts`; tests
(new) `server/tests/integration/repositories/agentRepository.advisoryLocks.test.ts`,
`server/tests/unit/repositories/{agentRepository.funding.test.ts,agentRepository.testHarness.ts}`,
`scripts/ci/backend-integration-groups.sh`.

---

### Phase B2 — Email verification cannot be completed from the web UI and resend is unreachable (P1, `email-verification--unreachable-completion-and-resend`)

**Evidence (reproduces).**
- **The link has no route.**
  - `server/src/services/email/emailVerificationService.ts:71-75` builds `${clientUrl}/verify-email?token=…`.
  - The app is a `HashRouter` (`src/App.tsx:7`).
  - `src/app/AppRoutes/AppRoutes.tsx:17-19` renders `<Login />` for every unauthenticated location.
  - nginx `try_files … /index.html` (`docker/nginx/default.conf.template:112`) serves the SPA, so the token
    is ignored.
  - Nothing in `src/` calls `POST /auth/email/verify`.
- **Resend is behind auth.** `server/src/api/auth/email.ts:106-109` mounts `/email/resend` behind `authenticate`.
  - `accessTokenSessionService.ts:54-56` throws `Email verification required` for unverified users.
  - Unverified users never get a session anyway: registration returns 201 without cookies (`login.ts:175-184`),
    and login returns 403 with `emailVerificationRequired: true` and `canResend: true` (`login.ts:268-274`).
  - The login UI drops that body: `src/contexts/useUserAuthActions.ts:69-70` keeps only
    `setError(getApiMessage(err, 'Login failed'))`.
  - So resend is reachable only by users who are already verified.
- **Self-lockout.** `PUT /me/email` (`email.ts:155-232`) → `updateEmailWithVerification`
  (`emailVerificationService.ts:168`) → `replaceUnusedForEmailUpdate` (`emailVerificationRepository.ts:85-122`)
  writes the new address and sets `emailVerified:false` immediately. The user's next request fails auth, and
  with no pre-auth resend the user cannot get a new link. When SMTP is not configured, the not-configured
  branch (`emailVerificationService.ts:182-207`) has already written the address and unverified the user when
  it reports `SMTP not configured`, so no link is ever sent.
  - No frontend calls `/me/email` (grep of `src/` is empty), so the self-lockout is reachable through direct
    API calls only (the gateway whitelist has no `/me/email` route).

**Scope (decided, simplified).** The fix makes verification completable and resend reachable before login, and
refuses an email change that could never be verified. It does **not** change how `PUT /me/email` stores the
address: apart from the SMTP guard it keeps its base behaviour (writes the new email, sets
`emailVerified:false`, issues a token). With the verify page, the pre-auth resend and the login resend action,
a user who changed their email can always get a new link before login and finish verification, so the change no
longer locks them out permanently. `consumeForCurrentEmail` keeps its `EMAIL_MISMATCH` → `INVALID_TOKEN`
behaviour unchanged (`emailVerificationService.ts:273-275`), so a token for a superseded address stays harmless.
- **Residual (P3, recorded, not fixed here).** A mistyped address that cannot receive mail still needs an
  administrator to correct it, because resend goes to the stored (mistyped) address.

**Change (server).**
1. `getVerificationUrl` → `${baseUrl}/#/verify-email?token=…`. This links straight to a hash route.
2. **Credentialed pre-auth resend.** Add `POST /api/v1/auth/email/resend-pending`, a public route with body
   `{ username, password }`, validated by a new `ResendPendingVerificationSchema` in `api/schemas/email.ts`.
   - The handler does the same lookup as login and always runs `verifyPassword`; when the user is missing it
     runs it against a fixed dummy hash, so timing matches.
   - It sends (through `resendVerification(user.id)`, `emailVerificationService.ts:307`) only when the user
     exists, the password is valid, an email is set, the email is unverified, and verification is required.
   - It **always** returns `202 { success: true, message: 'If the account needs verification, a new email has been sent.' }`.
     The response is identical for every outcome, so it gives an attacker no more than login already does and
     enables no enumeration.
   - **Router wiring.** `getLoginRateLimitUsername` is module-private to `server/src/api/auth.ts` (`:36-39`), so
     build both new limiters there, next to `loginLimiter` (`:41-44`): `rateLimitByIpAndKey('auth:login',
     getLoginRateLimitUsername)` (or reuse `loginLimiter`) and `rateLimitByIpAndKey('auth:email-resend-pending',
     getLoginRateLimitUsername)`. Pass them to `createEmailRouter` through a new parameter (an object
     `{ login, resendPending }` after `updateLimiter`; signature at `email.ts:27-31`, call at `auth.ts:73`) and
     mount them on `/email/resend-pending`.
   - Rate limit: a new `auth:email-resend-pending` policy (`keyStrategy: 'ip+user'`, with
     `message: 'Too many verification email requests. Please try again later.'` — `policies.test.ts:446-471` requires
     every policy to carry a message containing "too many"/"rate limit"/"exceeded"/"please"/"wait") through
     `rateLimitByIpAndKey` with the login username extractor (`api/auth.ts:36-44`). It reuses
     `rl.emailResendAttempts` / `rl.emailResendWindowSeconds` (`config/types.ts:55-56`), so no new config field,
     env var or schema change is needed; extend `server/tests/unit/services/rateLimiting/policies.test.ts` for the
     new policy.
   - **Login bucket too.** Also mount `rateLimitByIpAndKey('auth:login', <login username extractor>)` on this
     route, so it consumes the same `${ip}:${username}` bucket as `POST /auth/login`. Otherwise the route is a
     second password-guessing oracle with its own, separate budget.
   - **Per-user bucket, after the password check only.** Consume the existing `auth:email-resend` bucket inside
     the handler only after `verifyPassword` succeeds. The key must be exactly `user:${user.id}`, the key
     `rateLimitByUser` uses for authenticated requests (`middleware/rateLimit.ts:162`), so the pre-auth and
     authenticated resend share one bucket. When it is exhausted, still return the identical 202 and skip the
     send: a 429 here would appear only for a correct password and would be a password oracle.
   - **Consume failure.** Wrap that in-handler `rateLimitService.consume` call: if it throws (for example no
     limiter, `getLimiter`, `rateLimitService.ts:73-79`), `log.warn` with `getErrorMessage`, skip the send and
     return the identical 202. A 500 there would also appear only for a correct password.
     `resendVerification` already enforces its own pending-token count.
   - Audit `AUTH_EMAIL_VERIFICATION_SENT` only on an actual send.
   - Keep the existing authenticated `/email/resend`.
3. **SMTP guard (lives in the service).** When verification is required (`isVerificationRequired()`,
   `emailVerificationService.ts:53-58`) and SMTP is not configured (`isSmtpConfigured()`), refuse
   `PUT /me/email` before writing anything. The check lives in `emailVerificationService.ts`: an exported guard
   (e.g. `assertEmailChangeDeliverable()`, re-exported from `services/email`) that the route calls before
   `updateEmailWithVerification` (`email.ts:189`), and that `updateEmailWithVerification` also runs first. Use an
   actionable error (503 `ServiceUnavailableError` or a 4xx such as `Email verification is required but outgoing
   email is not configured; ask an administrator`). Today the not-configured branch (`:182-207`) has already
   written the new address and unverified the user when it reports `SMTP not configured`.
   - When verification is not required, the not-configured branch keeps today's behaviour (write the email,
     `emailVerified:false`, `verification.success: false`); it does not block auth.
   - Otherwise `PUT /me/email`, its response shape and `replaceUnusedForEmailUpdate` are unchanged.
4. OpenAPI (`server/src/api/openapi/paths/auth.ts:358-420`): add `/auth/email/resend-pending` with a `202`
   response and no `security`, and document the SMTP-guard error status on `/auth/me/email`.

**Change (frontend).**
- New `src/components/VerifyEmail/VerifyEmailPage.tsx` and `useVerifyEmail.ts`. The page reads `token` from
  `useLocation().search` and POSTs it once (StrictMode-safe ref guard) via a new `authApi.verifyEmail`. It shows
  success with a "Sign in" link, or the mapped error with a resend form (username and password, calling
  `authApi.resendPendingVerification`).
- In `AppRoutes.tsx`, before the `!isAuthenticated` branch, render `<VerifyEmailPage />` when
  `location.pathname === '/verify-email'`, for authenticated and unauthenticated users alike.
- Legacy links (`/verify-email?token=` with no hash): in the entry point `src/main.tsx` (there is no
  `src/index.tsx`; `tests/index.branches.test.tsx:28` imports `../src/main`), before mounting, when
  `window.location.pathname === '/verify-email'`, call
  `history.replaceState(null, '', '/#/verify-email' + window.location.search)`.
- Login: when the login 403 body has `emailVerificationRequired`, show a "Resend verification email" action.
  It calls `authApi.resendPendingVerification({username, password})` with the values still in the form.
  - The action lives in `src/components/Login/LoginForm/LoginFormActions.tsx` (the component that renders the
    submit button, error and notice alerts; rendered by `src/components/Login/LoginForm.tsx:47`). Add the flag
    and an `onResendVerification` callback (plus its success/error feedback) to `LoginFormActionsProps`, thread
    them through `LoginFormProps` (`src/components/Login/LoginForm/types.ts`) and `LoginForm.tsx`, and supply
    them from `useLoginFlow.ts` via `src/components/Login/index.tsx:55`.
  - Today the 403 body never reaches the form (`useUserAuthActions.ts:69-70`, above). Extend the login result
    (`LoginResult`, or a context flag) with `emailVerificationRequired` (and `canResend`), read from
    `ApiError.response`, and have the Login flow use it.
- Add types to `shared/types/api` (then rebuild `shared/dist`).

**Test first.**
- Server route unit. `server/tests/unit/api/email.test.ts` mocks `services/email` wholesale (`:59`) and is
  already 688 lines. Because `email.ts` now imports the `services/rateLimiting` barrel (which loads
  `infrastructure` while the test only partially mocks `repositories`/`utils/errors`), add a
  `vi.mock` of `services/rateLimiting` (`consume` resolving allowed) to `email.test.ts` too, so the suite cannot
  break at import time. Then:
  - (a) goes in a **new** `server/tests/unit/api/email.resendPending.test.ts` (same mocking pattern):
    `/email/resend-pending` with valid credentials for an unverified user → 202 and `resendVerification`
    called; with a wrong password or unknown user → the same 202 body and no send. This fails at base with 404.
    Also: with the per-user `auth:email-resend` bucket exhausted and a correct password → the same 202 body and
    no send (no 429); `consume` throwing → the same 202 body, a `warn` log and no send (no 500); with a wrong
    password the per-user bucket is not consumed; the route runs the `auth:login` and
    `auth:email-resend-pending` limiters passed to `createEmailRouter`.
  - **Auth harness mocks (shared with B10).** `email.ts` now imports `rateLimitService` from the
    `services/rateLimiting` barrel, which brings `policies.ts` (load-time `getRateLimitPolicies()`,
    `policies.ts:217`, reading `config.mcp`) into the auth router graph. `auth2faTestHarness.ts:22-41` and
    `authRegistrationTestHarness.ts:28-47` mock `src/config` without `mcp`, so the import would crash
    `auth.routes.2fa.test.ts` and `auth.routes.registration.test.ts`. The `vi.mock` of `services/rateLimiting`
    that B10 adds to both harnesses covers B2 as well; whichever of B2/B10 is implemented first adds it.
    Branch cases for the server 100% gate (`server/vitest.config.ts:65-70`), each with a correct password:
    the user has no email, the email is already verified, and `isVerificationRequired` resolves `false` → each
    the identical 202 and no send (the handler's own skip checks, mirroring `emailVerificationService.ts:324-336`);
    and `resendVerification` resolving `{ success: false }` → the identical 202 and no
    `AUTH_EMAIL_VERIFICATION_SENT` audit.
  - (c, route half) in `email.test.ts`: the mocked SMTP guard throws → the actionable error status, and the
    mocked `updateEmailWithVerification` is not called. Add the guard to the `services/email` mock factory.
  - Update `createEmailRouter(...)` at `email.test.ts:112` for the new limiter parameter. The existing
    `PUT /api/v1/auth/me/email` tests (describe at `:452`) keep their response shape.
- `server/tests/unit/services/email/emailVerificationService.test.ts`:
  - `getVerificationUrl` contains `/#/verify-email?token=`; update the existing URL assertion at `:237`
    (`http://localhost:3000/verify-email?token=`);
  - (c, service half) with verification required and SMTP not configured, `updateEmailWithVerification`
    rejects with the actionable error and makes no repository write (`replaceUnusedForEmailUpdate` not
    called). At base it writes the email and returns success with `verificationSent: false`;
  - the existing case at `:268` ("should invalidate old intents, update email, and truthfully report unsent mail
    when SMTP is disabled") runs with verification required (the `getBoolean` default is `true`, `:112`) and
    would now be refused: set `mockSystemSettingRepository.getBoolean.mockResolvedValueOnce(false)` in it so it
    keeps covering the not-required, SMTP-disabled branch. The SMTP-configured cases at `:307`, `:337` and
    `:372` are unchanged.
- `server/tests/unit/api/openapi.gateway.contracts.ts` (auth route enumeration at `:342-358`): add
  `['/auth/email/resend-pending', 'post']` and assert it has no `security`, like `/auth/email/verify` (`:356`).
- `server/tests/unit/services/rateLimiting/policies.test.ts`: `auth:email-resend-pending` exists and uses the
  `emailResend*` config values.
- Integration (real tokens): a **new** spec `server/tests/integration/flows/emailVerification.integration.test.ts`,
  registered in `scripts/ci/backend-integration-groups.sh` (`auth.integration.test.ts` is already 955 lines and
  is not classified for growth).
  - **Settings.** Public registration defaults to disabled (`login.ts:79-81`, `registrationEnabled` default
    `false`). Before the register step set `registrationEnabled` to `'true'` and `email.verificationRequired`
    to `'true'`, and delete both keys in a `finally`, as `auth.integration.test.ts` does
    (`registrationSettingKeys` at `:164`, `deleteSystemSettings` at `:65-69`, cleanup at `:239`):
    `cleanupTestData` keeps `systemSetting` rows (`testDatabase.ts:87-91`), so they would leak into later tests.
  - **Flow 1.** Register (201, unverified) → login is 403 with `emailVerificationRequired` → resend-pending →
    202 → verify the captured token → login succeeds.
  - **Flow 2 (no permanent lockout).** A verified user changes email through `PUT /me/email` (base behaviour:
    the email is written and unverified) → login is 403 → resend-pending → verify the token → login succeeds and
    `email` is the new address.
  - **Which token.** `replaceUnusedAndCreate` and `replaceUnusedForEmailUpdate` delete every unused token for
    the user (`emailVerificationRepository.ts:60-65`, `:93-98`), so in both flows "verify the token" means the
    token parsed from the **last** `sendEmail` call (the resend-pending send). Before verifying it, also POST
    the earlier token (from the register or `PUT /me/email` send) and assert `INVALID_TOKEN`; this proves
    resend-pending issued a fresh token.
  - Only the token hash is stored (`emailVerificationService.ts:101`), so the raw token cannot be read from the
    database. Mock `./emailService` (`src/services/email/emailService`, imported at
    `emailVerificationService.ts:14`) in the spec with `isSmtpConfigured` → `true` and `sendEmail` captured, and
    parse the token from the `verificationUrl` passed to it (`emailVerificationService.ts:123`, `:219`).
  - **Stub the in-handler consume.** The integration server never calls `rateLimitService.initialize()`, so
    the in-handler `rateLimitService.consume` throws (`getLimiter`, `rateLimitService.ts:73-79`) and the send
    is skipped. In this spec stub `rateLimitService.consume` to an allowed result (`vi.spyOn`, or mock
    `src/services/rateLimiting`). Server vitest sets `restoreMocks: true` (`server/vitest.config.ts:22`), which
    restores every `vi.spyOn` before each test, so the spy goes in a `beforeEach` (or inside each `it` that
    needs it), never in `beforeAll` or at module scope. Optionally add one case with `consume` throwing → the
    identical 202 and no send. The route-level limiters are pass-through in integration, so the `auth:login`
    bucket wiring is proven by unit test (a), not here.
- **Existing integration test that the SMTP guard breaks.**
  `server/tests/integration/flows/authIntentConcurrency.integration.test.ts:143-185` ("invalidates old email
  intents before an SMTP-disabled email update …") deletes the SMTP settings and expects
  `updateEmailWithVerification` to write the new address. Verification is required by default
  (`email.verificationRequired` is not seeded, `server/tests/integration/setup/testDatabase.ts:70-84`;
  `isVerificationRequired` defaults to `true`, `emailVerificationService.ts:53-58`), so the new guard refuses
  before writing and the case fails. Split it:
  - (a) set the `email.verificationRequired` system setting to `'false'` first, keeping the
    `replaceUnusedForEmailUpdate` invalidation coverage (the old token → `INVALID_TOKEN`, `user.email` = new,
    `emailVerified: false`). `cleanupTestData` keeps `systemSetting` rows (`testDatabase.ts:87-91`), so the
    setting would leak into later tests: restore it by deleting the key in a `finally` (as
    `auth.integration.test.ts`'s `deleteSystemSettings`, `:65-69`, does);
  - (b) verification required and no SMTP: first assert the `email.verificationRequired` key is absent (so a leak
    from (a) or elsewhere fails loudly), then `updateEmailWithVerification` rejects with the actionable error,
    `user.email` is unchanged, and the old token row is untouched (`usedAt` null, still present).
- Frontend: `tests/components/VerifyEmail/VerifyEmailPage.test.tsx` (success, expired → resend, double-mount
  POSTs once; no `token` in the search → no POST; resend-form submit success; resend-form submit failure),
  `tests/api/auth.test.ts` (the new `authApi.verifyEmail` and `authApi.resendPendingVerification` call the
  right endpoint with the right body; `src/api/auth.ts` is under the frontend 100% gate, coverage include at
  `config/tooling/vitest.config.ts:43`), `tests/components/Login/LoginForm.test.tsx` (the resend action renders
  only when the flag is set; a click calls the resend callback, which calls `resendPendingVerification` with the
  form's username and password; success and error feedback both render), `tests/App.branches.test.tsx` (an unauthenticated `/verify-email` renders the page, not Login;
  the case navigates to `/verify-email` with **no** token, so the existing `../src/api/auth` mock
  (`tests/App.branches.test.tsx:41-43`, `getCurrentUser` only) needs no new export, and `VerifyEmail` is not
  mocked; there is no `tests/app/AppRoutes` file),
  `tests/index.branches.test.tsx` (legacy path rewrite in `src/main.tsx`), `tests/components/Login/useLoginFlow.test.ts`
  (resend action after a 403), and `tests/contexts/useUserAuthActions.test.ts` (a 403 with
  `emailVerificationRequired` surfaces the flag in the login result; other errors do not).
- E2E: add a case in `tests/e2e/auth.spec.ts` that visits `/#/verify-email?token=t` and mocks the verify call with
  `page.route('**/auth/email/verify', …)`. The `page.on('request')` at `:76` is a listener that records login
  bodies, not a router, so it cannot answer the request.

**Constraints.**
- **E2E mock maps.** The new endpoints are called only from the verify page and the login 403 action, never
  during the 13 `transactions/balance-history` map flows, so those maps need no entry. Re-grep before
  committing: `grep -rn "unhandledRequests" tests/e2e`. Check `tests/e2eApiSimulator.test.ts` for an exhaustive
  route list and add the routes there if it asserts one.
- **Render-regression PNGs.** Login renders unchanged unless it is in the 403 state, so no baseline update is
  expected. Confirm with a local Playwright run.
- **Gateway.** Do not whitelist `resend-pending` in `gateway/src/routes/proxy/whitelist.ts`: it is web-only.
- **OpenAPI.** OpenAPI route-coverage tests (`server/tests/unit/api/openapi.test.ts`, `openapi.core.contracts.ts`)
  must pass.
- **New frontend module.** Run `arch:check` because the new module adds import edges.
- **No repository or migration change.** `emailVerificationRepository.ts`, `userAdminUpdate.ts` and
  `api/admin/users.ts` are untouched.
- **New integration spec.** Register `emailVerification.integration.test.ts` in
  `scripts/ci/backend-integration-groups.sh` or the classifier lane fails.

**Acceptance.**
- A self-registered user can verify from the emailed link (hash or legacy form).
- A self-registered user, or a user who changed their email, can request a resend without a session and
  complete verification, so an email change no longer locks the user out permanently. The pre-auth resend
  shares the login ip+username budget and never returns a response that depends on whether the password was
  correct.
- The login 403 for an unverified account offers a resend action in the UI.
- With verification required and SMTP not configured, an email change is refused before anything is written.
- A token for a superseded address is still rejected as `INVALID_TOKEN` (unchanged).
- Residual P3 recorded: a mistyped, undeliverable address still needs an administrator to correct it.
- Coverage stays at 100% on server and frontend.

**Files touched.** `server/src/services/email/emailVerificationService.ts` (URL and SMTP guard) and the
`services/email` barrel (guard export), `server/src/api/auth.ts` (limiters and the `createEmailRouter` call),
`server/src/api/auth/email.ts`, `server/src/api/schemas/email.ts`, `server/src/services/rateLimiting/policies.ts`,
`server/src/api/openapi/paths/auth.ts`, `shared/types/api` (new types),
`src/components/VerifyEmail/{VerifyEmailPage.tsx,useVerifyEmail.ts}` (new), `src/app/AppRoutes/AppRoutes.tsx`,
`src/main.tsx`, `src/contexts/useUserAuthActions.ts` (login result flag), `src/api/auth.ts` (`verifyEmail`,
`resendPendingVerification`), the Login 403 action (`src/components/Login/LoginForm/{LoginFormActions.tsx,types.ts}`,
`src/components/Login/{LoginForm.tsx,index.tsx,useLoginFlow.ts}`); tests `server/tests/unit/api/email.test.ts`, (new)
`server/tests/unit/api/email.resendPending.test.ts`,
`server/tests/unit/services/email/emailVerificationService.test.ts`,
`server/tests/unit/api/openapi.gateway.contracts.ts`, `server/tests/unit/services/rateLimiting/policies.test.ts`,
`server/tests/unit/api/auth2fa/auth2faTestHarness.ts` and
`server/tests/unit/api/authRegistration/authRegistrationTestHarness.ts` (the `services/rateLimiting` mock, shared with B10),
(new) `server/tests/integration/flows/emailVerification.integration.test.ts`, `scripts/ci/backend-integration-groups.sh`,
`server/tests/integration/flows/authIntentConcurrency.integration.test.ts` (split SMTP-disabled case),
`tests/contexts/useUserAuthActions.test.ts`, (new) `tests/components/VerifyEmail/VerifyEmailPage.test.tsx`,
`tests/App.branches.test.tsx`, `tests/index.branches.test.tsx`, `tests/components/Login/useLoginFlow.test.ts`,
`tests/components/Login/LoginForm.test.tsx`, `tests/api/auth.test.ts`, `tests/e2e/auth.spec.ts`.

---

### Phase B3 — Definite node rejections are classed unknown and re-broadcast forever (P2, `broadcast--node-rejection-marked-unknown-rebroadcast-forever`)

**Evidence (reproduces).**
- `server/src/services/bitcoin/blockchain/networkOperations.ts:50-65`: only a preflight failure becomes
  `DefiniteBroadcastRejectionError`. `:71-82` wraps every `client.broadcastTransaction` error as
  `Broadcast outcome is unknown`.
- Electrum JSON-RPC errors arrive as plain `Error(message)` (`electrum/protocol.ts:310-312`), so a policy reject
  is indistinguishable from a timeout.
- `transactions/broadcasting.ts:246-253` then calls `markSigningIntentBroadcastUnknown`.
- `signingIntent/broadcastReconciliation.ts:37-104`:
  - every reconciler pass claims `unknown` intents, re-submits the raw transaction, and re-marks them `unknown`
    on any failure;
  - `listBroadcastsForReconciliation` (`transactionSigningIntentRepository.ts:186-199`) has no attempt cap and
    no expiry, although `claimBroadcast` increments `broadcastAttemptCount` (`:105`).
- Latent sibling: `claimBroadcast` also claims from `unknown` (`:91-95`). A preflight failure on that resumed
  claim takes the definite path, which releases the intent to `ready` and clears `broadcastTxid`
  (`releaseRejectedBroadcast`, `:151-163`). That contradicts the reconciler's own invariant at
  `broadcastReconciliation.ts:86-89`.

**Change.**
1. `electrum/protocol.ts:310-312`: reject with `new ElectrumRpcError(message, response.error.code)`, a new
   exported class that extends `Error` and lives in `electrum/types.ts`. The message text is unchanged, so
   existing callers are unaffected.
   - **Import paths (decided).** `protocol.ts:10` imports `./types` with `import type`, which cannot construct
     the class; add a separate value import `import { ElectrumRpcError } from './types';`.
     `networkOperations.ts` imports it from `'../electrum/types'`, extending the existing value import at
     `networkOperations.ts:10` (`import { ElectrumNoFeeEstimateError, ElectrumRpcError } from '../electrum/types';`),
     not from the `../electrum` barrel. Tests import it from `src/services/bitcoin/electrum/types`, never
     from the `services/bitcoin/electrum` barrel: `transactionServiceBroadcastTestHarness.ts:54` mocks that
     barrel with an explicit export list that does not include it, and Vitest 4 throws on a missing mock export.
2. `networkOperations.ts`:
   - add a helper `isDefiniteNodeRejection(error)` (not `broadcast*`-prefixed). It returns true only for an
     `ElectrumRpcError` whose message matches this allowlist: `min relay fee not met`, `mempool min fee not met`,
     `insufficient fee`, `dust`, `txn-mempool-conflict`, `non-mandatory-script-verify-flag`,
     `mandatory-script-verify-flag`, `bad-txns-` **excluding** `bad-txns-inputs-missingorspent`, and
     `non-final`;
   - `missingorspent`, `already in block chain`, `txn-already-known` and every transport error stay unknown;
   - add an input `allowDefiniteRejection` to `broadcastAuthenticatedRawTransaction`, and thread it
     through the `broadcastTransaction(artifact)` wrapper (`networkOperations.ts:25-37`) as a second parameter.
     Throw `DefiniteBroadcastRejectionError`, from preflight or from the allowlist, only when it is true.
     Otherwise wrap as unknown;
   - **Decided (optional flag).** The wrapper parameter is `broadcastTransaction(artifact,
     allowDefiniteRejection?)`, **optional with default `false`** (conservative: unknown). The new
     `allowDefiniteRejection` input of `broadcastAuthenticatedRawTransaction` is likewise optional, default
     `false`. `broadcasting.ts` and the reconciler always pass it explicitly. This keeps the existing one-argument
     typed callers compiling unchanged: `networkBoundary.test.ts:42`, `:50`, `:73`;
     `broadcasting-validation-reorg.contracts.ts:78`, `:101`; and
     `server/tests/unit/services/bitcoin/blockchain/syncWallet-core.contracts.ts:252`, `:270` (typed through
     `blockchainTestHarness.ts:270`);
   - both unknown wrappers keep the original error as `cause` (`new Error(message, { cause: error })`): the
     broadcast wrapper (`networkOperations.ts:81`, today a bare `new Error(...)`) and the new preflight unknown
     wrapper used when `allowDefiniteRejection` is false (the preflight catch at `:57-66`). Callers can then tell a
     node-data answer from a transport or timeout failure. Add an exported predicate
     `isNodeAnsweredBroadcastFailure(error)` (not `broadcast*`-prefixed) that returns true only when `error.cause`
     is:
     - an `ElectrumRpcError` whose message matches a **node-verdict pattern**: the definite-rejection allowlist
       above plus `missingorspent`, `already in block chain` and `txn-already-known`. Any other RPC error (for
       example an Electrum server answering while its bitcoind is down) is transport and returns false; or
     - a `BroadcastPreflightError` whose `reason` (the `BroadcastErrorReason` field, `broadcastPreflight.ts:30`) is
       `'node_preflight_rejected'` (a rejection built from node data, e.g. `stale_or_spent_input`,
       `broadcastPreflight.ts:201-205`) or `'invalid_raw_transaction'` (`:58`, `:75`; deterministic, so a retry
       cannot change it) (**decided**).
     A `BroadcastPreflightError` with reason `'node_preflight_unavailable'` (fetch or evidence failures,
     `broadcastPreflight.ts:103-106`, `:117`, `:125`, `:140`, `:181-184`, `:194`) is transport and returns false,
     as does any other preflight failure.
   - **Decided residual (missing parent).** An intent whose parent transaction no longer exists gets preflight
     `missing_previous_transaction` (`broadcastPreflight.ts:139-143`) or a batch-fetch RPC error (`:103-106`), both
     reason `node_preflight_unavailable`. It is treated as transport and is **not** capped. This matches base
     behaviour and carries no funds or double-pay risk, because such a transaction can never be broadcast. Recorded
     as P3 follow-up `broadcast--missing-parent-reconcile-loop`.
   - **Barrel export.** `broadcasting.ts:9-13` and `broadcastReconciliation.ts:6` import from the `../blockchain`
     barrel, whose network-operations re-export is an explicit list (`blockchain/index.ts:23-30`). Add
     `isNodeAnsweredBroadcastFailure` to that list.
3. `claimBroadcast` returns `priorState: 'ready' | 'resumed' | 'stalled'` on a `claimed` result. To get it
   (**decided**), run up to three conditional `updateMany` calls inside the same transaction, in order, each with
   the existing claim `data`, and take `priorState` from whichever one hit (`count === 1`); there is no separate
   read:
   Every step keeps the shared claim guards of today's filter (`id`, `snapshotDigest: input.digest`,
   `supersededById: null`, `consumedAt: null`; `transactionSigningIntentRepository.ts:78-82`) and adds only its
   own state condition:
   1. `broadcastState: 'ready'` → `priorState: 'ready'`;
   2. the existing claimed-with-expired-lease or `unknown` branches (`transactionSigningIntentRepository.ts:85-96`)
      → `'resumed'`;
   3. only when the claim input `allowStalled` is true (user broadcasts; the reconciler passes `false`):
      the shared guards plus `{ broadcastState: 'stalled', broadcastTxid: input.txid, broadcastRawTx: input.rawTx }`
     → `'stalled'`.
   - **Wiring `allowStalled` (decided).** Add `allowStalled?: boolean` (OPTIONAL, default `false`, the
     conservative value) to `BroadcastClaimInput` (`transactionSigningIntentRepository.ts:20`), so the existing
     callers that omit it keep compiling under `typecheck:tests` (`tsconfig.test.full.json` includes integration
     specs): `transactionSigningIntentRepository.integration.test.ts:45-54` and the unit `claimInput()` helper
     (`transactionSigningIntentRepository.test.ts:103-107`, used at `:111/:140/:162/:173`). Both production call
     sites still pass it explicitly. `claimSigningIntentBroadcast`
     (`signingIntent/broadcastLifecycle.ts:62-71`, the user path) passes `allowStalled: true`; the reconciler's
     `claimBroadcast` call (`broadcastReconciliation.ts:52-61`) passes `allowStalled: false`. Without this wiring
     a user retry of a stalled intent misses all three steps, falls to `busy`
     (`transactionSigningIntentRepository.ts:117-125`) and gets `Signing intent broadcast is already in progress`
     (`broadcastLifecycle.ts:76-79`).
   - Carry it through the service layer: add `priorState` to the `claimed` arm of the `BroadcastClaim` type and
     return it from `claimSigningIntentBroadcast` (`signingIntent/broadcastLifecycle.ts:46-49`, `:72`).
   - `broadcasting.ts` passes `allowDefiniteRejection: claim.priorState === 'ready'`, and the reconciler always
     passes `false`. A claim from `stalled` is therefore a resumed claim: no definite rejection is honoured.
   - **Replacement-link failure.** The `assertReplacementLink` catch in `broadcasting.ts:223-241` releases the
     claim to `ready` on any claim today. Gate the release on `claim.priorState === 'ready'`; on a `resumed`
     claim call `markSigningIntentBroadcastUnknown` instead, so a resumed claim is never rolled back.
     - **Decided (claim from `stalled`).** The failure re-marks the intent stalled (`markBroadcastStalled`; no
       release, no unknown) and throws the existing pre-network rejection, `throw asPreNetworkRejection(error)`
       (`broadcasting.ts:240`, helper at `:56`), exactly as today, not the `broadcast_stalled` `ConflictError` of
       item 5 (no broadcast was attempted).
4. Reconciler cap (**Decision 4**): constant `MAX_RECONCILE_ATTEMPTS = 60`.
   - **Only node-answered attempts count.** `claimBroadcast` increments `broadcastAttemptCount` on every claim
     (`transactionSigningIntentRepository.ts:105`). When an attempt fails without a node answer
     (`!isNodeAnsweredBroadcastFailure(error)`: transport error, timeout, lookup-only failure, a non-verdict
     `ElectrumRpcError`, or a `node_preflight_unavailable` preflight error), the unknown
     transition gives the attempt back: `markBroadcastUnknown(id, leaseToken, lastError, { countAttempt: false })`
     adds `broadcastAttemptCount: { decrement: 1 }` to the same lease-token CAS update. The fourth parameter
     `{ countAttempt }` is **optional** (default `countAttempt: true`) on both `markBroadcastUnknown` and the
     service wrapper `markSigningIntentBroadcastUnknown`, because existing 3-argument callers stay valid
     (`broadcastLifecycle.test.ts:104`, `transactionSigningIntentRepository.test.ts:177`, `:196`). Both callers
     (`broadcasting.ts` and the reconciler) pass `countAttempt: isNodeAnsweredBroadcastFailure(error)`. Transport
     and timeout failures therefore never advance the cap, however long an outage lasts.
   - The check lives **inside the existing catch** after the re-broadcast (`broadcastReconciliation.ts:88-96`)
     and reads only the post-claim count `claim.record.broadcastAttemptCount` (returned by `claimBroadcast`).
     The `reconcileUncertain` record parameter type (`:37-45`) is unchanged. When the error is node-answered and
     the count is `>= MAX_RECONCILE_ATTEMPTS`, call a new repository transition
     `markBroadcastStalled(id, leaseToken, lastError)` (`broadcastState: 'stalled'`, raw tx and txid kept) and
     `log.warn` once; otherwise call `markBroadcastUnknown` as above.
   - `listBroadcastsForReconciliation` is unchanged, so `stalled` is excluded from the rebroadcast pass.
   - `broadcasting.ts` reaches `markBroadcastStalled` through a new service wrapper
     `markSigningIntentBroadcastStalled(id, leaseToken, lastError)` in `signingIntent/broadcastLifecycle.ts`,
     next to `markSigningIntentBroadcastUnknown`.
5. **User broadcast of a stalled intent (decided).** A user broadcast claims from `stalled` as a resumed claim
   (item 3) and re-submits the exact raw transaction with `allowDefiniteRejection: false`.
   - Success → `accepted`, as for any claim.
   - Any broadcast failure → `markBroadcastStalled` again (not `unknown`, so the reconciler does not restart
     rebroadcasting), and throw a `ConflictError` with reason `broadcast_stalled` and an actionable message, for
     example `This transaction's broadcast outcome could not be confirmed after repeated attempts. Check a block
     explorer for the txid before creating a replacement.` This replaces the misleading
     `Signing intent broadcast is already in progress` (`broadcastLifecycle.ts:76-79`) a stalled intent would
     otherwise get.
   - A pre-network `assertReplacementLink` failure on that claim re-marks it stalled and throws
     `asPreNetworkRejection(error)` instead (item 3, decided).
   - Add `broadcast_stalled` to `BROADCAST_ERROR_REASON_VALUES` (`transactions/broadcastContracts.ts:4`) and
     classify it as terminal (not auto-retryable).
6. **Stalled intents that later confirm.** Add a lookup-only pass (no rebroadcast) over `stalled` intents to
   the reconciler job (`reconcileSigningIntentBroadcastsJob`, `server/src/jobs/definitions/maintenance.ts:23-30`,
   which calls `reconcileSigningIntentBroadcasts`).
   - Cadence is time-based in the database, not a tick counter: a new repository read
     `listStalledBroadcastsForLookup(now, limit)` returns only `stalled` rows with
     `broadcastLastAttemptAt <= now - 1h`, and each lookup bumps `broadcastLastAttemptAt` to `now` (a
     conditional `updateMany` on `broadcastState: 'stalled'`), so each stalled intent is looked up at most
     hourly across restarts and workers.
   - Then `getTransactionDetails(txid)`; a hit moves the intent to `accepted` through a new lease-free
     conditional transition (`where: { id, broadcastState: 'stalled', broadcastTxid }`) that sets **the same
     fields as `markBroadcastAccepted`** (`transactionSigningIntentRepository.ts:165-176`): `broadcastState:
     'accepted'`, lease token and expiry cleared, `broadcastAcceptedAt: now`, `consumedAt: now`,
     `broadcastLastError: null`. `consumedAt` matters: the replay path in `signingIntent/service.ts:113-118`
     depends on it. Then `reconcileAccepted`. A miss leaves it `stalled`.
   - Surfacing `stalled` in the UI is out of scope; it is a follow-up.

**Test first.**
- `server/tests/unit/services/bitcoin/signingIntent/broadcastReconciliation.test.ts`: a claim whose
  `claim.record.broadcastAttemptCount` is 60 and whose lookup and re-broadcast fail with a node-answered error
  (unknown wrapper with an `ElectrumRpcError` cause) → `markBroadcastStalled` is called and
  `markBroadcastUnknown` is not. At base, unknown is re-marked. Also: count 59 → `markBroadcastUnknown`
  (boundary); count 60 with a `BroadcastPreflightError` cause of reason `node_preflight_rejected` (e.g.
  `stale_or_spent_input`) → stalled, like a verdict `ElectrumRpcError` cause; count 60 with a
  `BroadcastPreflightError` cause of reason `node_preflight_unavailable` → `markBroadcastUnknown` with
  `countAttempt: false`, never stalled; count 60 with a non-verdict `ElectrumRpcError` cause (e.g. a
  bitcoind-down message) → `countAttempt: false`, never stalled; count 60 with a transport failure (including a
  non-`BroadcastPreflightError` preflight failure) → `markBroadcastUnknown` with `countAttempt: false`, never
  stalled; the lookup-only stalled pass moves a found txid to `accepted` without calling
  `broadcastAuthenticatedRawTransaction`, and leaves a missed one `stalled`. The stalled lookup pass does not
  change the returned `{ examined, completed }` shape: those counts still cover only the
  `listBroadcastsForReconciliation` pass, so the existing `toEqual({ examined, completed })` assertions stay
  as they are. Also: a stalled lookup hit whose lease-free stalled → accepted transition returns `false` (a
  concurrent user claim won the row) → neither `reconcileAccepted` nor `persistTransaction` is called and the
  intent is left to the user broadcast. Also assert that the reconciler's `claimBroadcast` receives
  `allowStalled: false` (`expect.objectContaining({ allowStalled: false })`); with the `allowStalled: true`
  assertion in `broadcastLifecycle.test.ts` below, this kills the shard-3 boolean-literal mutants on both
  call sites.
- `server/tests/unit/services/bitcoin/signingIntent/broadcastLifecycle.test.ts`: `claimSigningIntentBroadcast`
  returns `priorState` on a claim (including `stalled`), and extend the `objectContaining` claim-input
  assertion at `:44-47` with `allowStalled: true`. Add `markBroadcastStalled` to the repository mock
  (`:3-14`) and extend `delegates every lease-bound outcome transition` (`:99-108`):
  `markSigningIntentBroadcastStalled(id, lease, err)` delegates to `markBroadcastStalled` with the same
  arguments, and `markSigningIntentBroadcastUnknown(id, lease, err, { countAttempt: false })` forwards the
  options object to `markBroadcastUnknown`. Both are required by the 100% functions gate and by Stryker shard 3,
  which mutates `broadcastLifecycle.ts`.
- `broadcastAndSave` cases, in `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.errors.contracts.ts`
  and `transactionServiceBroadcast.broadcastAndSave.core.contracts.ts` (both run via
  `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts`). These contracts **cannot observe
  classification**: the harness replaces the blockchain barrel (`broadcastTransaction` is a `vi.fn` and
  `DefiniteBroadcastRejectionError` a stub class, `transactionServiceBroadcastTestHarness.ts:62-66`), so a raw
  mocked `ElectrumRpcError` would just be marked unknown by the catch at `broadcasting.ts:247-253`. They assert
  the forwarded flag and the transition chosen for a given thrown error instead:
  - the flag: `broadcastTransaction` is called with `(artifact, true)` when `priorState` is `'ready'`, and with
    `(artifact, false)` for `'resumed'` and `'stalled'` claims. This fails first: base passes no second argument;
  - outcomes are driven by the error the mocked `broadcastTransaction` rejects with: the harness's
    `DefiniteBroadcastRejectionError` → `releaseRejectedSigningIntentBroadcast`; `new Error('Broadcast outcome is
    unknown: …', { cause })` → `markSigningIntentBroadcastUnknown`, with `countAttempt` taken from the real
    predicate (a verdict `ElectrumRpcError` cause → `countAttempt: true`; a transport cause → `countAttempt: false`);
  - the per-entry allowlist, `missingorspent`, and preflight-on-resumed (the latent sibling) cases live **only**
    in `networkBoundary.test.ts` and `broadcasting-validation-reorg.contracts.ts` (real `networkOperations`),
    not here;
  - an `assertReplacementLink` failure on a resumed claim → unknown, not released (and on a ready claim →
    released, as today); on a claim with `priorState: 'stalled'` → `markBroadcastStalled` called, neither
    `releaseRejectedSigningIntentBroadcast` nor `markSigningIntentBroadcastUnknown` called, and the thrown error
    is the existing pre-network rejection from `asPreNetworkRejection` (not the `broadcast_stalled`
    `ConflictError`);
  - a user broadcast of a `stalled` intent: success → accepted; failure → `markBroadcastStalled` again and the
    `broadcast_stalled` `ConflictError` with the actionable message (not `already in progress`).
- `server/tests/unit/services/bitcoin/transactionServiceBroadcast/broadcastContracts.test.ts`:
  `broadcast_stalled` is in `BROADCAST_ERROR_REASON_VALUES` and classified terminal. The test pins the whole
  registry with `toEqual(REQUIRED_REASON_CODES)` (`:74`, list at `:19`), so add `broadcast_stalled` to
  `REQUIRED_REASON_CODES` in the same position as in `BROADCAST_ERROR_REASON_VALUES`.
- networkOperations cases in `server/tests/unit/services/bitcoin/signingIntent/networkBoundary.test.ts` and
  `server/tests/unit/services/blockchainService/broadcasting-validation-reorg.contracts.ts`: the allowlist (one
  case per entry), a transport `Error` → unknown, the `cause` on both unknown wrappers (broadcast and preflight),
  `isNodeAnsweredBroadcastFailure` true for a verdict `ElectrumRpcError` (allowlist entries, `missingorspent`,
  `already in block chain`, `txn-already-known`) and for `BroadcastPreflightError` causes with reason
  `node_preflight_rejected` or `invalid_raw_transaction`; false for a non-verdict `ElectrumRpcError`, a
  `BroadcastPreflightError` with reason `node_preflight_unavailable`, and any other cause; and the
  `broadcastTransaction(artifact, allowDefiniteRejection)` wrapper forwarding the flag. These two files run the
  real `networkOperations`, so they are the only place the allowlist (one case per entry), `missingorspent` on
  a definite-allowed call → unknown, and a preflight failure with the flag false (the resumed-claim latent
  sibling) → unknown are asserted.
- `server/tests/unit/repositories/transactionSigningIntentRepository.test.ts` (coverage and Stryker shard 3
  kills): the three-step conditional claim (`priorState` ready, resumed and stalled, each from the matching
  `updateMany`; `allowStalled: false` issues no third update and does not claim a stalled row), `markBroadcastStalled`, `markBroadcastUnknown` with `countAttempt: false` (decrement in the same
  CAS update), `listStalledBroadcastsForLookup` (the `broadcastLastAttemptAt <= now - 1h` filter and the bump),
  `listStalledBroadcastsForLookup` called with an explicit and with the default limit (same pattern as
  `lists durable uncertain broadcasts with an explicit or default batch limit`, `:200-207`), the hourly bump's
  count-0 skip arm if the bump is a separate conditional `updateMany` (a row another worker already bumped is
  not looked up), and the lease-free stalled → accepted transition setting the `markBroadcastAccepted` field
  set (and returning `false` when the row is no longer `stalled`).
- `server/tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts` (registered):
  `claimBroadcast.priorState` for ready, unknown and stalled, `markBroadcastStalled` excluded from
  `listBroadcastsForReconciliation`, the hourly lookup filter, and the stalled → accepted lookup transition
  with `consumedAt` set.
- **Existing tests to update** (they encode the old shapes):
  - `networkBoundary.test.ts:53-68` and `broadcasting-validation-reorg.contracts.ts:108-120` expect a definite
    preflight rejection from `broadcastTransaction(artifact)` with no flag. Pass `true` there, and add the no-flag
    → unknown counterpart;
  - `transactionServiceBroadcast.broadcastAndSave.core.contracts.ts:114`: `toHaveBeenCalledWith(objectContaining(…))`
    fails once `broadcastTransaction` gets a second argument; add the expected flag (`true`, since the default
    harness claim is `priorState: 'ready'`);
  - `transactionSigningIntentRepository.test.ts:109-176` asserts a single `updateMany` shape for the claim;
    update it for the three-step conditional claim;
  - `broadcastLifecycle.test.ts:43` and `:92` assert the claim result with `toEqual({ status: 'claimed',
    leaseToken })`, and their repository mocks return no `priorState`; add `priorState` to the mocks and the
    expected shape. The repository mock (`:3-14`) gains `markBroadcastStalled`, and the delegation case
    (`:99-108`) gains the stalled and `countAttempt: false` delegations (Test first above);
  - the one-argument `broadcastTransaction(artifact)` calls at `networkBoundary.test.ts:42`, `:50`, `:73`,
    `broadcasting-validation-reorg.contracts.ts:78`, `:101` and `syncWallet-core.contracts.ts:252`, `:270` need
    **no** change: the flag is optional, default `false`, and none of them expects a definite rejection;
  - `transactionServiceBroadcastTestHarness.ts:174-176`: the default `mockClaimSigningIntentBroadcast` result
    becomes `{ status: 'claimed', leaseToken: 'lease-1', priorState: 'ready' }`, because
    `transactionServiceBroadcast.broadcastAndSave.failures-rbf.contracts.ts:367` expects the replacement-link
    failure to release the claim, which now happens only for a `ready` claim;
  - `broadcastReconciliation.test.ts:8-17`: the repository mock lists only `listBroadcastsForReconciliation`,
    `claimBroadcast`, `markBroadcastAccepted`, `markBroadcastComplete`, `markBroadcastUnknown` and
    `releaseRejectedBroadcast`. Add `markBroadcastStalled` and `listStalledBroadcastsForLookup` (defaulting to
    `[]` in `beforeEach`, so the existing cases see no stalled rows), plus the lease-free stalled → accepted
    transition;
  - `broadcastReconciliation.test.ts:104` asserts `markBroadcastUnknown` with three arguments
    (`toHaveBeenCalledWith('intent-1', expect.any(String), 'connection lost')`); the reconciler now passes a fourth,
    `{ countAttempt }`, so add it there. `transactionServiceBroadcast.errors.contracts.ts` needs no change: its
    `markSigningIntentBroadcastUnknown` assertions (`:121-129`, `:135`) use bare `toHaveBeenCalled()` or only
    exercise the rejection, so the extra argument does not break them. The 3-argument direct calls at
    `broadcastLifecycle.test.ts:104` and `transactionSigningIntentRepository.test.ts:177`, `:196` stay as they
    are (the parameter is optional) and keep covering the default `countAttempt: true` path.
  - **Blockchain mock factories (decided).** Both `vi.mock('…/services/bitcoin/blockchain')` factories,
    `transactionServiceBroadcastTestHarness.ts:62-66` and `broadcastReconciliation.test.ts:18-21`, list explicit
    exports. Vitest 4 throws on a missing mock export, so the failure-path cases that now call
    `isNodeAnsweredBroadcastFailure` (`transactionServiceBroadcast.errors.contracts.ts:121-129`,
    `broadcastReconciliation.test.ts:100-106`) would break. Both factories provide the **real** predicate via
    `vi.importActual` of the `networkOperations` module (for example
    `isNodeAnsweredBroadcastFailure: (await vi.importActual<typeof import('…/blockchain/networkOperations')>('…/blockchain/networkOperations')).isNodeAnsweredBroadcastFailure`),
    not a stub;
  - `transactionServiceBroadcastTestHarness.ts:68-76`: add `markSigningIntentBroadcastStalled` to the
    `broadcastLifecycle` mock factory (a new `transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastStalled`),
    so the stalled cases above can assert on it.

**Constraints.**
- Critical-mutation lane: `networkOperations.ts`, `signingIntent/*`, `broadcasting.ts` and the intent repository
  all match `is_critical_mutation_file`. Stryker shard 3 (`server/scripts/mutation/shards.mjs:32-43`) mutates
  `broadcasting.ts`, `signingIntent/**` (so `broadcastLifecycle.ts` and `broadcastReconciliation.ts`) and the
  intent repository, but **not** `networkOperations.ts`. Raw and weighted scores must not drop below
  `.github/mutation-baseline.json`, so every new branch in those four files needs a killing unit test.
  `networkOperations.ts` (allowlist and wrapper) needs full branch coverage, with one test per allowlist entry.
  Electrum `protocol.ts` and `types.ts` are not pinned.
- Safety-catch scan (`scripts/check-safety-catch-guards.mjs`) covers `services/bitcoin`: every new catch must
  `throw` or `return`. `scripts/quality/safety-catch-allowlist.json:626-650` pins the non-terminal catch counts
  `reconcileUncertain` 1, `reconcileSigningIntentBroadcasts` 1 and `broadcastAndSave` 2. Put each new
  non-terminal catch (the stalled branch, the stalled lookup pass, the resumed replacement-link path) in a
  helper whose catch returns or throws, so those counts are unchanged. If that is not possible, add the
  allowlist to Files touched with the bumped counts and a reason per entry.
- `config/wallet-safety-critical-paths.json` (`server/src/services/bitcoin/**`) triggers verify-vectors. No
  `VERIFIER_SOURCE_FILES` is touched.

**Acceptance.**
- A first-attempt node policy rejection releases the intent with a clear error.
- An ambiguous outcome stays unknown.
- The reconciler stops rebroadcasting after 60 node-answered attempts; transport and timeout failures,
  non-verdict Electrum RPC errors and `node_preflight_unavailable` preflight errors never advance the cap. A stalled intent that later confirms still reaches `accepted` (with `consumedAt` set)
  through the at-most-hourly lookup-only pass.
- Known residual: an intent whose parent transaction no longer exists (`missing_previous_transaction` or a
  batch-fetch RPC error, both `node_preflight_unavailable`) is still re-tried without a cap. This phase does not
  claim that loop is gone for that sub-case; it is P3 follow-up `broadcast--missing-parent-reconcile-loop`.
- A user retry on a stalled intent re-submits once as a resumed claim; if that fails it gets an actionable
  `broadcast_stalled` message, not "already in progress".
- A resumed claim is never rolled back to `ready`, including after a replacement-link failure.

**Files touched.** `server/src/services/bitcoin/electrum/{protocol.ts,types.ts}`,
`server/src/services/bitcoin/blockchain/networkOperations.ts`,
`server/src/services/bitcoin/blockchain/index.ts` (export `isNodeAnsweredBroadcastFailure`, `:23-30`),
`server/src/services/bitcoin/signingIntent/{broadcastLifecycle.ts,broadcastReconciliation.ts}`,
`server/src/services/bitcoin/transactions/{broadcasting.ts,broadcastContracts.ts}`,
`server/src/repositories/transactionSigningIntentRepository.ts` (including `allowStalled` on
`BroadcastClaimInput`, `:20`), `server/src/jobs/definitions/maintenance.ts`
(only if the lookup pass is not run from inside `reconcileSigningIntentBroadcasts`),
`scripts/quality/safety-catch-allowlist.json` (only if a new non-terminal catch cannot live in a returning or
throwing helper); tests
`server/tests/unit/services/bitcoin/signingIntent/{broadcastReconciliation.test.ts,broadcastLifecycle.test.ts,networkBoundary.test.ts}`,
`server/tests/unit/services/bitcoin/transactionServiceBroadcast/{transactionServiceBroadcast.errors.contracts.ts,transactionServiceBroadcast.broadcastAndSave.core.contracts.ts,transactionServiceBroadcastTestHarness.ts,broadcastContracts.test.ts}`,
`server/tests/unit/services/blockchainService/broadcasting-validation-reorg.contracts.ts`,
`server/tests/unit/repositories/transactionSigningIntentRepository.test.ts`,
`server/tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts`.

---

### Phase B4 — Fee population persists a fee computed from a partial input sum (P2, `fee-populate--partial-input-sum-persisted`)

**Evidence (reproduces).**
- `server/src/services/bitcoin/sync/confirmations/feePopulation.ts:52-66`: `getInputValueSats` returns `0` when
  a parent is missing from `prevTxCache`. `fetchHelpers.ts:248-262` counts the failed fetch but omits it from
  the cache.
- `:68-81`: `sumInputSats` adds the 0.
- `:83-95`: `calculatedFeeSats` rejects only `total <= 0 || total < outputs`. A missing parent worth no more
  than the true fee therefore yields an understated fee that is still positive.
- `shouldPopulateFee` (`:14-20`) runs only while `fee === null`, so the wrong value is permanent.
- `applyFeeUpdate` (`:108-121`) also sets the consolidation `amount = -fee`.

**Change.**
- `getInputValueSats` returns `number | null`: `null` when there is no `prevout.value` and the parent output
  cannot be resolved. That includes the `!input.txid || input.vout == null` case.
- `sumInputSats` returns `null` as soon as any input is unresolved; the coinbase early return is unchanged.
- `calculatedFeeSats` returns `null` on a `null` sum, so the fee stays `null` and the next populate pass retries
  it.
- Add `log.debug` with the txid and the unresolved count. The Electrum `fee` path (`electrumFeeSats`) is unchanged.

**Test first.** Extend `server/tests/unit/services/bitcoin/sync/confirmations.test.ts`, or the
`confirmations/*.contracts.ts` that drives `populateMissingTransactionFields`:
- A sent transaction with `fee: null` and two inputs, one parent cached (1.0 BTC) and one parent missing
  (0.0001 BTC), with outputs of 0.9999 BTC. The true fee is 1.0001 − 0.9999 = 0.0002 BTC (20,000 sats). At base
  the partial input sum is 1.0 BTC, so the update persists `fee: 10000n`, understated by the missing 10,000-sat
  input, and the test fails. The expected result is that `updates.fee` is undefined.
- The same for a consolidation: `amount` is not rewritten.
- All parents present → the fee is populated (existing behaviour).
- Fixture rules for the new cases: set `txDetails.fee` to `undefined`/`null` and leave `prevout` off the inputs.
  `resolveFeeSats` prefers the Electrum `txDetails.fee` (`feePopulation.ts:98-104`, `electrumFeeSats` first), and
  `getInputValueSats` prefers `prevout.value`, so either would bypass the partial-sum path and the test would pass
  at base.
- The `!input.txid || input.vout == null` branch of `getInputValueSats` now returns `null`. Confirm with the
  coverage run (`cd server && npx vitest run --coverage tests/unit`) whether an existing sent or consolidation
  test reaches it; if none does, add a case with an input lacking `txid` (or `vout`) whose `fee` stays `null`.

**Constraints.**
- A sync-path file with no repository calls added, so no `wallet-sync-mutation-boundaries.json` entry is needed.
  Run both sync checkers anyway.
- `feePopulation.ts` is not pinned in any Stryker profile. It sits under `services/bitcoin/**`, so verify-vectors
  lanes run.
- The only `v8 ignore` in the file is in `sumOutputSats` (`feePopulation.ts:46`), which this phase does not
  touch. Add no new `v8 ignore`; every new `null` branch in `getInputValueSats`, `sumInputSats` and
  `calculatedFeeSats` is covered by the tests above.
- Safety-catch allowlist: `scripts/quality/safety-catch-allowlist.json:292-300` records exactly one non-terminal
  catch in `populateFee` (`count: 1`). Add no catch to `populateFee` and remove none, so the count stays 1 and
  `node scripts/check-safety-catch-guards.mjs` stays green without an allowlist edit.
- Some populate contracts build `fee: null` fixtures whose parents are not all cached; they may now leave `fee`
  null. Run every `populateMissingTransactionFields` contract (`confirmations.test.ts` and all
  `confirmations/*.contracts.ts`), not just the new cases, and fix any fixture that relied on a partial sum by
  caching its parents.

**Acceptance.** No fee is persisted unless every input value is known. Partial data leaves `fee` null for a retry.

**Files touched.** `server/src/services/bitcoin/sync/confirmations/feePopulation.ts`; test
`server/tests/unit/services/bitcoin/sync/confirmations.test.ts` (or the matching `confirmations/*.contracts.ts`),
plus any populate contract whose `fee: null` fixture relied on a partial input sum.

---

### Phase B5 — Main Redis client stops reconnecting after 10 retries (P2, `redis--main-client-stops-reconnecting`)

**Evidence (reproduces).**
- `server/src/infrastructure/redis.ts:78-92`: `retryStrategy` returns `null` once `times > 10`. In ioredis that
  ends reconnection permanently (status `end`). Nothing re-creates the client.
- The log message claims an "in-memory fallback". None exists after init: `getDistributedCache` returns the
  Redis cache whenever `isInitialized` (`:170-176`).
- The publisher and subscriber retry forever (`:117-128`).
- With the main client in `end`, these stay broken until a restart: the cache, the distributed locks, the rate
  limiter and BullMQ users of `getRedisClient()` (28 call sites).

**Change.**
- `retryStrategy(times)` always returns `Math.min(times * 100, 3000)`, matching the pub/sub clients and
  `services/cache/redisCache.ts:192`.
- Log `warn` for the first 10 attempts, then `error` once every 20 attempts (`times % 20 === 0`) with the
  message `Redis still unreachable after ${times} retries; retrying every 3s`. Remove the fallback claim.
- Startup behaviour is unchanged: the 10 s ready timeout (`:95-108`) still rejects `initializeRedis`, and the
  catch block quits the client.
- **Persistent error listener.** After a successful init, attach `redisClient.on('error', …)`. The only error
  listener today is the init-time `once('error')` (`:105`). Without a listener, ioredis writes
  `[ioredis] Unhandled error event` plus a stack to `console.error` on every failed reconnect
  (`ioredis/built/Redis.js:549-553`), which with infinite retries floods the logs. The listener logs through
  `log` and is throttled: `log.warn` for the first error of an outage, then at most one `log.debug` per 30 s
  (a module-level last-logged timestamp, reset on `ready`).
- **Remove the init-time `once('error')` after ready.** The `once('error')` registered in the ready wait
  (`redis.ts:104-107`) stays attached after `ready` resolves, so it consumes (swallows) the first post-init error:
  that error rejects an already-settled promise and never reaches the persistent listener. Detach it when
  `ready` fires (keep a named handler and `redisClient.off('error', onInitError)` in the `ready` callback, and
  the `ready` handler symmetrically on error/timeout).

**Test first.**
- `server/tests/unit/infrastructure/redis.test.ts:190` currently asserts `retryStrategy(12)` is `null`, which
  encodes the bug. Change it to expect `1200` (`Math.min(12 * 100, 3000)`), not `3000`.
- Add `retryStrategy(1000) === 3000` (the cap).
- Add a test that the `error` log fires at times 20 and 40 and not at 21.
- Add a test that after init a persistent `'error'` listener is registered; emitting two errors in quick
  succession logs one `warn` and no second warn/debug inside the throttle window; after `ready` the next error
  warns again. The test must account for the init-time listener: assert that after init the only `'error'`
  listener is the persistent one (`listenerCount('error') === 1`), so the **first** post-init error reaches it
  and warns. At base the first post-init error is swallowed by the leftover `once('error')`.
- Add a throttle-window case with fake time (`vi.useFakeTimers()` or a `Date.now` spy): emit an error (warn),
  advance past 30 s, emit again → exactly one `log.debug`; emit again inside the next 30 s window → no further
  `log.debug`. Both arms of the 30 s comparison are needed for the 100% branch gate
  (`server/vitest.config.ts:65-70`).

These fail at base.

**Constraints.**
- `ioredis` without an error listener does not crash the process (memory: ioredis-unlistened-error); the
  listener is for log hygiene, not crash safety. Do not add an empty catch.
- No inventories are affected.

**Acceptance.** The main client reconnects after any outage length, the logs no longer claim a fallback, and a
long outage produces throttled structured logs instead of an unhandled-error line per retry. No init-time error
listener survives `ready`, so the first post-init error is logged.

**Files touched.** `server/src/infrastructure/redis.ts`; test `server/tests/unit/infrastructure/redis.test.ts`.

---

### Phase B6 — Worker Electrum health check reads a cached version instead of pinging (P2, `worker-electrum-health--cached-version-not-a-ping`)

**Evidence (reproduces).**
- `server/src/worker/electrumManager/healthMonitoring.ts:46-49` calls `await state.client.getServerVersion()` as
  its ping.
- `electrumClient.ts:631-638` returns the cached `this.serverVersion` without I/O once it is set. A half-open or
  hung connection therefore stays `connected`, and no reconnect is ever scheduled.
- The pool health checker uses a real ping (`electrumPool/healthChecker.ts:145`), and `ElectrumClient.ping()`
  exists (`electrumClient.ts:647-648`). Each request carries its own timeout (`electrumClient.ts:494` for single
  requests, `:586` for batch requests).

**Change.** Replace the call with `await state.client.ping()` and update the comment. Nothing else changes: the
existing catch already marks the network disconnected and calls `scheduleReconnect`.

**Test first.**
- `server/tests/unit/worker/electrumManager/electrumManagerTestHarness.ts:93`: add
  `ping = vi.fn().mockResolvedValue(null)`.
- In `electrumManager.standalone.contracts.ts`, retarget the health tests from `getServerVersion` to `ping`:
  - the `'health failed'` case at `:467` becomes `mockClient.ping.mockRejectedValueOnce`;
  - the ownership-lost `it.each` cases at `:486-496` mock `getServerVersion.mockImplementationOnce` to simulate
    the health call; retarget those mocks to `mockClient.ping` too, or they stop exercising the health path.
- Add: `ping` rejects while `getServerVersion` resolves (cached) → `state.connected === false` and
  `scheduleReconnect` is called. At base, the cached version passes and the test fails.
- Leave the connect-time `getServerVersion` cases (`:83-111`) as they are.

**Constraints.**
- `src/worker` sits outside the bitcoin inventories. There is no sync-boundary repository call.
- Run `node scripts/check-wallet-sync-lifecycle-contract.mjs`: its contract lists `healthMonitoring.ts` (under
  `subscribeAddressBatch` only). No entry change is expected, but the gate must stay green.

**Acceptance.** A connection that cannot answer `server.ping` within the request timeout is reconnected.

**Files touched.** `server/src/worker/electrumManager/healthMonitoring.ts`; tests
`server/tests/unit/worker/electrumManager/{electrumManagerTestHarness.ts,electrumManager.standalone.contracts.ts}`.

---

### Phase B7 — Admin user delete fails with a misleading 400 on RESTRICT foreign keys (P2, `admin-user-delete--restrict-fks-block-delete`)

**Evidence (reproduces).**
- These foreign keys are `ON DELETE RESTRICT`, and none was altered later:
  - `draft_transactions_userId_fkey` (`prisma/migrations/20251214100000_add_draft_transactions/migration.sql:43`)
  - `vault_policies_createdBy_fkey` (`20260317000000_add_vault_policies/migration.sql:142`)
  - `approval_votes_userId_fkey` (`:150`)

  Schema: `DraftTransaction.user`, `VaultPolicy.creator` and `ApprovalVote.user` have no `onDelete`.
- `server/src/repositories/userAdminUpdate.ts:203-244` `attemptAdminUserDelete` runs its wallet and device
  prechecks and then `tx.user.delete`. That delete raises P2003, which `utils/errors.ts:124-128` maps to
  `ValidationError('Referenced record does not exist')`, a 400 that does not explain why.
- Broadcast drafts are retained on purpose (`maintenanceRepository.ts:44-50` deletes only expired *actionable*
  drafts) because agent funding caps count them.

**Decision: 409 with an actionable message. No in-transaction cleanup or reassignment.**
- Every other user foreign key in the migrations cascades. RESTRICT was chosen only for these three
  audit-bearing records.
- Each alternative is wrong for a funds product:
  - deleting the user's policies silently removes spending protections from surviving wallets;
  - deleting votes rewrites approval history and can flip a pending request's quorum;
  - deleting broadcast drafts breaks funding-cap accounting;
  - reassigning any of them to the acting admin falsifies attribution.
- Soft-delete or tombstoning needs product sign-off and is out of scope.

**Change.**
- New `findRestrictedUserReferences(tx, userId)`, in the same Serializable transaction, after the existing
  wallet and device checks. It runs four `count`s: two `draftTransaction.count` calls for the actionable/other
  split (`status` in `ACTIONABLE_DRAFT_STATUS_VALUES`, and `status` not in it; not `groupBy`, so the unit
  `draftTransaction.count` stub returning 0 fits), `vaultPolicy({createdBy})`, and `approvalVote({userId})`.
- If any count is non-zero, throw a `ConflictError`, for example:
  `Cannot delete user: they are referenced by N draft(s) (K still pending), M vault policy(ies) they created and V approval vote(s). Pending drafts can be deleted from the wallet; policies, broadcast drafts and votes are retained for audit, so this account cannot be deleted.`
- Defense in depth: wrap `tx.user.delete` so that `isPrismaError(e) && e.code === 'P2003'` becomes a
  `ConflictError('Cannot delete user: other records still reference this account')`.
- OpenAPI: add `409: apiErrorResponse` to `DELETE /admin/users/{userId}` in
  `server/src/api/openapi/paths/admin/identity-policy.ts:70-83`. Leave the 400 entry as it is: it is the shared
  `apiErrorResponse` constant (`:77-82`) with no per-route description to adjust.

**Test first.**
- Unit: `server/tests/unit/repositories/userAdminUpdate.test.ts`.
  - Extend `installAdminDeleteTransaction` (`:347`) with `draftTransaction.count`, `vaultPolicy.count` and
    `approvalVote.count`, each defaulting to 0.
  - The barrier helper is `installAdminSetBarrier` (`:59`). Its `tx` has no `draftTransaction`, `vaultPolicy` or
    `approvalVote`, and the barrier test at `:338-342` calls `deleteFromAdmin('admin-b')`, which now reaches
    `findRestrictedUserReferences`. Add the same three zero-count stubs to that `tx`.
  - Cases: a policy count of 1 → `ConflictError` naming the policy, and `user.delete` is not called; a P2003 from
    `user.delete` → `ConflictError`.
  - Branch cases for the 100% unit branch gate (`server/vitest.config.ts:65-70`; integration tests do not count
    toward it): `user.delete` rejecting with a non-P2003 error → rethrown unchanged; a draft count only (one case
    with an actionable draft and one with only a non-actionable draft, so both arms of the actionable/other split
    are hit) → `ConflictError`, policy and vote counts 0; a vote count only → `ConflictError`, draft and policy
    counts 0. Each operand of the "any count non-zero" `||` is a branch, so draft-only, policy-only and vote-only
    are each needed.
- OpenAPI: in `server/tests/unit/api/openapi.admin-ops.contracts.ts` (the admin user route test at `:286-292`),
  add `expect(openApiSpec.paths['/admin/users/{userId}'].delete.responses[409]).toBeDefined()`. Fails at base.
- Integration (real FKs): `server/tests/integration/flows/admin/users.contracts.ts`, registered through
  `server/tests/integration/flows/admin.integration.test.ts` (`:20` imports `registerAdminUserManagementContracts`). Seed a user who created a vault policy on a co-owned wallet, then call the admin
  delete. Expect 409 with the message; the user still exists. At base this is a 400 `Referenced record does not exist`.
  Repeat for a broadcast draft and for an approval vote.

**Constraints.**
- No migration.
- The admin UI already shows `ConflictError` text. Check `tests/components/*Users*` fixtures for a hard-coded
  400 message and update any you find.
- Not an inventory file.

**Acceptance.**
- Deletion is refused with a 409 that names what blocks it and what the admin can do.
- No audit-bearing row is deleted or re-attributed.
- OpenAPI documents the 409, and the OpenAPI route tests pass.

**Files touched.** `server/src/repositories/userAdminUpdate.ts`,
`server/src/api/openapi/paths/admin/identity-policy.ts`; tests
`server/tests/unit/repositories/userAdminUpdate.test.ts`, `server/tests/unit/api/openapi.admin-ops.contracts.ts`,
`server/tests/integration/flows/admin/users.contracts.ts`, and any `tests/components/*Users*` fixture with a hard-coded 400 message.

---

### Phase B8 — Vault policy address lists are stored raw and compared exactly (P2, `vault-policy-address-lists--unnormalized-compare`)

**Evidence (reproduces).**
- `server/src/api/wallets/policies.ts:65-73` `PolicyAddressBodySchema`: `address` is checked only with `max(100)`.
- `vaultPolicyService.ts:262-280` `createPolicyAddressInWallet` stores `input.address` verbatim, with no
  validation.
- `policyEvaluationEngine.ts:821-857` `evaluateAddressControl` builds a `Set` of the stored strings and calls
  `Set.has(addr)`. An uppercase bech32 entry, a padded entry or an uppercase recipient therefore bypasses a
  denylist or wrongly blocks an allowlisted address.
- The draft path passes the raw recipient (`drafting.ts:102,193,295`). The broadcast path passes canonical
  `fromOutputScript` addresses.
- `PolicyAddress` has `@@unique([policyId, address])` (`schema.prisma:1797`).

**Change.**
1. New `server/src/services/vaultPolicy/policyAddressCanonical.ts`:
   - `canonicalizePolicyAddress(address, network)` returns
     `bitcoin.address.fromOutputScript(addressToOutputScript(address.trim(), network), getNetwork(network))`.
     It imports from `services/bitcoin/utils` and leaves that file unchanged. Bech32 comes out lowercase and
     base58 keeps its case.
   - **Resolve the stored network strictly first.** `getNetwork` goes through `bitcoinJsNetworkName`
     (`server/src/constants/bitcoinNetworks.ts:52-55`), which silently maps an invalid string to mainnet. So the
     helper first resolves the stored value with `resolvePersistedBitcoinNetwork` (`bitcoinNetworks.ts:25-29`,
     which maps the legacy `testnet` alias and throws on anything invalid) and passes only the resolved value on.
     If it throws, the network is treated as **unknown**: on compare, the fallback form on both sides (as for a
     missing network); on insert, the same `NotFoundError('Wallet not found')` refusal as a missing network.
   - `tryCanonicalize` returns `null` on a throw.
2. Insert: `createPolicyAddressInWallet` loads the wallet network (`walletRepository.findNetwork(walletId)`,
   `walletRepository.ts:449-455`). When it returns `null`, throw `NotFoundError('Wallet not found')`; never
   assume mainnet. Then canonicalize, and throw `InvalidInputError('Invalid address for this wallet network')`
   when the address is invalid. Store the canonical form. A duplicate (P2002 via `isUniqueConstraintError`)
   becomes `ConflictError('Address already on this policy (allow or deny list)')`: the unique key is
   `@@unique([policyId, address])`, not per list type, so the same address cannot sit on both lists.
   - OpenAPI: add `409: apiErrorResponse` to `POST /wallets/{walletId}/policies/{policyId}/addresses`
     (`server/src/api/openapi/paths/walletPolicies.ts:264-279`).
3. Compare: `createEvaluationState(input)` runs at `policyEvaluationEngine.ts:122`, before the wallet is fetched
   (`walletRepository.findById`, `:125`), so the network cannot come from there. Add an optional `network` field
   to `EvaluationState` and set `state.network = wallet?.network` right after the fetch at `:125`. Pass it
   through `applyAddressControlPolicy` (`:255-265`) as a new argument to `evaluateAddressControl` (`:821`).
   `evaluateAddressControl` canonicalizes the recipients and every **stored** entry with `tryCanonicalize`.
   All of the canonicalize, fallback and warn-once logic below lives in `policyAddressCanonical.ts`; the engine
   only threads `network` (see Constraints, large-file headroom).
   - **One fallback form**, used on both sides: `trim()`, then ASCII-lowercase only when the value starts with a
     bech32 HRP (`bc1`/`tb1`/`bcrt1`, case-insensitive); otherwise the trimmed raw value.
   - A legacy stored row that does not decode uses the fallback form.
   - An undecodable recipient uses the fallback form. In allowlist mode it then fails closed.
   - **Unknown wallet network** (`wallet?.network` missing, or rejected by `resolvePersistedBitcoinNetwork`): skip decoding entirely and use the fallback form on
     both sides. Never assume mainnet. The evaluate harness's `findById` returns no `network`
     (`policyEvaluationEngineTestHarness.ts:87`), so the existing undecodable fixtures (`bc1qallowed1`,
     `bc1qbadactor`) take this path and stay green.
   - **Decided: guard-free warn shape.** The canonical helper returns the list of undecodable stored entries;
     `evaluateAddressControl` calls `log.warn` once (a single call) when that list is non-empty. No `Set` of
     policy ids and no module-level set.
   - This handles legacy rows without a migration.

**Test first.**
- `server/tests/unit/services/policyEvaluationEngine/evaluate.controls-timing.contracts.ts`:
  - a denylist entry `BC1Q…` (uppercase) blocks the recipient `bc1q…`;
  - an allowlist entry `bc1q…` with surrounding spaces lets `BC1Q…` through;
  - a denylist with **two** legacy undecodable rows on the same policy does not throw, and `log.warn` is called
    exactly once for that call. This case must set
    `mockWalletRepo.findById.mockResolvedValue({ id: context.walletId, groupId: null, network: 'mainnet' })`:
    the harness default has no `network` (`policyEvaluationEngineTestHarness.ts:87`), so the unknown-network
    rule would skip decoding and never warn;
  - with the same `network: 'mainnet'` wallet and only decodable stored rows (zero undecodable), `log.warn` is
    not called (covers the empty-list arm);
  - with no wallet network, an uppercase bech32 denylist entry still blocks the lowercase recipient (fallback
    form on both sides, no decode);
  - with an invalid stored network string (`findById` returning `network: 'bogus'`), the same uppercase-denylist
    case still blocks via the fallback form and nothing throws. Set it with `mockResolvedValueOnce` (the harness `beforeEach` resets `findById`,
    `policyEvaluationEngineTestHarness.ts:85-87`);
  - the fallback form's non-bech32 arm: a stored base58 (non-HRP) entry with surrounding spaces, for example a
    padded legacy row, matches the recipient after `trim()` and keeps its case (an entry differing only in case
    does not match), with no wallet network so decoding is skipped. Without this the non-HRP arm of the fallback
    is uncovered.

  The first two fail at base. Optionally run the first two cases with a known network (`network: 'mainnet'` as
  above) and valid checksummed addresses, so they also exercise the decode path rather than only the fallback
  form.
- `server/tests/unit/services/vaultPolicyService/vaultPolicyService.read-address.contracts.ts` (the real
  fail-first for insert validation): a mainnet address on a testnet wallet is rejected with
  `InvalidInputError`, a malformed address is rejected, and a stored value is canonical. At base the address is
  stored verbatim, so these fail. Also: `findNetwork` returning `null` → `NotFoundError` and nothing stored; a
  P2002 on insert → `ConflictError('Address already on this policy (allow or deny list)')`; `findNetwork`
  returning an invalid string (e.g. `'bogus'`) → the same `NotFoundError` and nothing stored (at base it would be
  treated as mainnet); `policyRepository.createPolicyAddress` rejecting with a non-unique-constraint error →
  rethrown unchanged (not mapped to `ConflictError`), so both arms of the P2002 check are covered.
  - Fix the existing fixtures at `:115-149`: `'tb1qfoo'` is not a valid address and would now be rejected;
    replace it with a valid testnet bech32 address.
  - Add `findNetwork: vi.fn()` to the harness `mockWalletRepo` object (`vaultPolicyServiceTestHarness.ts:28-30`,
    the `walletRepository` mock that the `vi.mock` at `:45` returns).
    Server vitest's `clearMocks`/`restoreMocks` (`server/vitest.config.ts:21-22`) and the harness `beforeEach`
    (`vi.clearAllMocks()` only, `vaultPolicyServiceTestHarness.ts:65-67`) do not reset `vi.fn` implementations,
    so set the `'testnet'` default with `mockWalletRepo.findNetwork.mockResolvedValue('testnet')` **inside that
    `beforeEach`**, and use `mockResolvedValueOnce` / `mockRejectedValueOnce` for the null, invalid-network and
    P2002 cases so no override leaks into later tests.
- `server/tests/unit/api/walletPolicies/walletPolicies.addresses.contracts.ts`: error mapping only. The
  `walletPoliciesTestHarness` mocks `services/vaultPolicy` wholesale, so this test cannot fail first: a mocked
  `InvalidInputError` maps to 400 and a mocked `ConflictError` maps to 409.
- `server/tests/unit/api/openapi.wallet.contracts.ts` (next to the `POST …/addresses` assertions at `:752-759`):
  the route documents `409`. Fails at base.
- `evaluate.controls-timing.contracts.ts`: the network set after the wallet fetch reaches
  `evaluateAddressControl` (a testnet wallet decodes a `tb1…` entry).

**Constraints.**
- The new file lives in `services/vaultPolicy`, so it is not under the bitcoin critical paths and has no mutation
  pins.
- **Large-file headroom.** `policyEvaluationEngine.ts` is 950 lines at f2c7e217 (limit 1,000,
  `scripts/quality/check-large-files.mjs:12`). Keep the canonicalize, fallback-form and warn-once logic in
  `policyAddressCanonical.ts` (export a helper that takes the stored entries, recipients and network and returns
  the comparison sets plus the list of undecodable stored entries); the engine only threads `network` into the
  call and emits the single `log.warn` when that list is non-empty. Record the
  engine's post-change line count in the PR (expected under 965, leaving at least 35 lines of headroom).
- `arch:check`: run it in the primary checkout. Do not promise a regenerated-graph commit: the server graph
  collapses at `src/<dir>`, so the new `vaultPolicy → bitcoin/utils` import (both under `services`) is not
  expected to change `docs/architecture/generated/**`. Commit whatever it regenerates, if anything.

**Acceptance.** Allow and deny matching is case- and whitespace-insensitive wherever bitcoin semantics allow it,
including when the wallet network is unknown. New entries are validated against the wallet network.

**Files touched.** (new) `server/src/services/vaultPolicy/policyAddressCanonical.ts`,
`server/src/services/vaultPolicy/{vaultPolicyService.ts,policyEvaluationEngine.ts}`,
`server/src/api/openapi/paths/walletPolicies.ts` (409); tests
`server/tests/unit/services/policyEvaluationEngine/evaluate.controls-timing.contracts.ts`,
`server/tests/unit/services/vaultPolicyService/{vaultPolicyService.read-address.contracts.ts,vaultPolicyServiceTestHarness.ts}`,
`server/tests/unit/api/walletPolicies/walletPolicies.addresses.contracts.ts`,
`server/tests/unit/api/openapi.wallet.contracts.ts`.

---

### Phase B9 — Mobile view permissions are settable but never enforced (P2, `mobile-permissions--view-caps-not-enforced`)

**Evidence (reproduces, with one correction).**
- `gateway/src/routes/proxy/index.ts:70-71` mounts `requireMobilePermission` only when `route.mobilePermission`
  is set. None of the wallet-scoped GET contracts in `gateway/src/routes/proxy/whitelist.ts` sets it:
  `GET /wallets/:id` (`:175`), `/wallets/:id/transactions` (`:186`), `/wallets/:walletId/transactions/:txid`
  (`:191`), `/wallets/:id/addresses/summary` (`:202`, returns `totalBalance` among other totals),
  `/wallets/:id/addresses` (`:206`), `/wallets/:id/utxos` (`:218`), `/wallets/:id/labels` (`:224`),
  `/wallets/:id/drafts` (`:342`), `/wallets/:id/drafts/:draftId` (`:346`) and `/wallets/:id/mobile-permissions`
  (`:361`).
- Backend read routes check only the wallet role.
- The existing drift guard in `gateway/tests/unit/routes/proxy.test.ts:189-201` requires a `mobilePermission` or
  an `accessControlReason` only for wallet-scoped **writes** (`route.method !== 'GET'`), so nothing catches an
  unguarded wallet-scoped read.
- **Correction:** `canViewTransactions` does have one consumer, `server/src/services/mobileAgentDraftService.ts:199-202,258`.

**Decision: enforce, not remove.**
- `docs/plans/vault-policies-plan.md:62-66` lists `viewBalance` and `viewTransactions` in the capability matrix.
  `docs/archive/ios-backend-enhancements.md:62-65,360-382` designs them as enforced mobile gates.
- `server/src/services/mobilePermissions/types.ts:25-27` maps all three, and the mobile draft service already
  enforces one.
- Removing the caps would change a shared schema and the documented product model.

**Change.**
- `whitelist.ts`:
  - `GET /wallets/:id` → `mobilePermission: 'viewBalance'`;
  - `GET /wallets/:id/addresses/summary` → `'viewBalance'` (it returns the wallet's balance totals);
  - `GET /wallets/:id/addresses` → `'viewBalance'` (per-address balances; **decided**, see Decision 7: a user
    with `generateAddress` on and `viewBalance` off can create an address, `whitelist.ts:210-215`, but cannot
    list addresses);
  - both wallet-scoped transaction GETs → `'viewTransactions'`;
  - `GET /wallets/:id/utxos` → `'viewUtxos'`;
  - `GET /wallets/:id/drafts` and `/drafts/:draftId` → `'viewTransactions'`, which matches
    `mobileAgentDraftService`;
  - `GET /wallets/:id/labels` → `'viewTransactions'`. Labels are annotations on the wallet's transactions and
    addresses, so they reveal the same history; the label writes already use `manageLabels`.
  - `GET /wallets/:id/mobile-permissions` → `accessControlReason: 'Backend mobile-permissions route enforces
    wallet access.'`. A user must be able to read their own caps even with every view cap off, so it is not
    capped.
- `ROUTE_ACTION_MAP` (`middleware/mobilePermission.ts:196-204`) picks these up automatically.
- **Residual, documented, not fixed here.** `GET /wallets` (list with balances), `GET /transactions/{txid}`
  (the deprecated route without a wallet id) and `GET /transactions/pending` have no wallet id in the path. The
  middleware returns 400 without one (`:145-152`), so they cannot carry a cap. Record them in
  `docs/reference/wallet-threat-model.md` and file a follow-up for backend-side filtering.

**Test first.**
- `gateway/tests/unit/routes/proxy.test.ts` (the contract test that enumerates `GATEWAY_ROUTE_CONTRACTS`):
  - assert the mappings above;
  - **drift guard**, modelled on the write guard at `:189-201`: every wallet-scoped GET
    (`/api/v1/wallets/:…` expressPath, `method === 'GET'`) declares `mobilePermission` or
    `accessControlReason`. At base all ten routes listed under Evidence fail it.
- `gateway/tests/unit/middleware/mobilePermission.test.ts`: `ROUTE_ACTION_MAP['GET:/wallets/:id/transactions'] === 'viewTransactions'`
  and `ROUTE_ACTION_MAP['GET:/wallets/:id/addresses/summary'] === 'viewBalance'`.
- Proxy routing, in `proxy.test.ts`. That file mocks `requireMobilePermission` wholesale (`:26`, `:74-76`), so it
  cannot observe a real 403.
  - `requireMobilePermission(route.mobilePermission)` runs **once, when the router is built** at import
    (`gateway/src/routes/proxy/index.ts:70-71`, loop at `:78-80`), not per request, and its `mock.calls` are
    cleared before every test (`gateway/vitest.config.ts:15` `clearMocks: true`; `vi.clearAllMocks()` in the
    `beforeEach` at `proxy.test.ts:100-102`). A per-request assertion on its arguments would therefore see no
    calls.
  - Per-request fail-first: a request to `GET /api/v1/wallets/<uuid>/transactions` runs
    `proxyRouteMocks.mobilePermissionMiddleware` (modelled on the write case at `:221-229`). At base the request
    takes the authenticated catch-all, which skips the middleware (catch-all case at `:233-240`).
  - Which cap each route uses is proven by the contract assertions above and the `ROUTE_ACTION_MAP` assertions
    below. Optionally also capture the build-time calls into a module-scope constant right after the router
    import (`const builtCaps = proxyRouteMocks.requireMobilePermission.mock.calls.map((c) => c[0]);`, before any
    `beforeEach` clears them) and assert it contains `viewTransactions`, `viewBalance` and `viewUtxos`.
  - The 403 and not-proxied behaviour stays covered by `gateway/tests/unit/middleware/mobilePermission.test.ts`.

All of these fail at base, where the contracts have no `mobilePermission`.
- Server (not fail-first): `server/tests/unit/api/mobilePermissions.test.ts` confirms that `viewBalance`,
  `viewTransactions` and `viewUtxos` are accepted actions on the backend permission check. It passes at base and
  guards against a backend change rejecting the new gateway calls. There is no OpenAPI target for this phase.

**Constraints.**
- Gateway coverage gate.
- Each guarded GET adds one backend round-trip. The middleware already fails closed.
- No server schema change.
- If a gateway route-contract snapshot or generated doc exists (`grep -rn mobilePermission gateway/tests docs/reference`),
  regenerate it.

**Acceptance.**
- Through the gateway, a user with a view capability turned off gets 403 on every wallet-scoped read in that
  category, including address summaries, address lists and labels.
- Every wallet-scoped GET in the whitelist declares a cap or an access-control reason, enforced by the drift guard.
- Intended side effect (fail closed): a GET for a nonexistent or inaccessible wallet through the gateway now
  returns 403 from the permission check instead of the backend's 404.
- The residual routes are documented.

**Files touched.** `gateway/src/routes/proxy/whitelist.ts`, `docs/reference/wallet-threat-model.md`; tests
`gateway/tests/unit/routes/proxy.test.ts`, `gateway/tests/unit/middleware/mobilePermission.test.ts`,
`server/tests/unit/api/mobilePermissions.test.ts` (not fail-first).

---

### Phase B10 — 2FA verify is throttled per IP only (P2, `two-factor-verify--ip-only-throttle`)

**Evidence (reproduces).**
- `server/src/services/rateLimiting/policies.ts:37-43`: `auth:2fa` has `keyStrategy: 'ip'`.
- `server/src/api/auth.ts:46` wires `rateLimit('auth:2fa')`, keyed `ip:<ip>` (`middleware/rateLimit.ts:97-106`).
- `api/auth/twoFactor/verify.ts:34-102`: a failed code only writes the `TWO_FACTOR_FAILED` audit row and throws.
  The 5-minute temp token stays valid.
- Login is keyed `ip+user` (`rateLimitByIpAndKey`, `rateLimit.ts:189-200`, key `${ip}:${username}`). An attacker
  who holds the password can therefore spread TOTP guesses over many IPs, minting a fresh temp token per IP.

**Change.**
- New policy `auth:2fa-account` (`keyStrategy: 'custom'`):
  - limit `rl.twoFaAccountAttempts`, default 10, from a new env var `RATE_LIMIT_2FA_ACCOUNT`;
  - window `rl.twoFaWindowSeconds`;
  - message `'Too many 2FA attempts for this account. Please try again later.'`. Every policy needs a message
    (`policies.test.ts:448-455`), and it must contain one of `too many`/`rate limit`/`exceeded`/`please`/`wait`
    (`:457-466`). Define it once as an exported constant `TWO_FA_ACCOUNT_RATE_LIMIT_MESSAGE` in a **new,
    side-effect-free** module `server/src/services/rateLimiting/policyMessages.ts` (no imports, constants
    only), imported by both `policies.ts` (for the policy) and `verify.ts` (for the 429 `RateLimitError`).
    **Not** from `policies.ts`: `policies.ts:217` runs `getRateLimitPolicies()` at module load, and
    `buildPolicies` reads `config.mcp.rateLimitPerMinute` (`:165`). `auth2faTestHarness.ts:22-41` and
    `authRegistrationTestHarness.ts:28-47` mock `src/config` without `mcp`, so importing `policies.ts` (directly,
    or through the barrel: `rateLimitService.ts:34` imports `./policies`) throws at import, `createAuthTestApp()`
    rejects, and every case in `auth.routes.2fa.test.ts` and `auth.routes.registration.test.ts` fails;
  - add the field to `config/types.ts:49`, `config/schema.ts:60` (`int().min(1).max(100)`) and
    `config/envSections.ts:27`;
  - wire the env var through the deployment surface: `RATE_LIMIT_2FA_ACCOUNT: ${RATE_LIMIT_2FA_ACCOUNT:-10}` in
    `docker-compose.yml` next to `RATE_LIMIT_2FA` (`:259`), and append `RATE_LIMIT_2FA_ACCOUNT` at the **end** of
    the `start.sh:158` export list (`export RATE_LIMIT_LOGIN RATE_LIMIT_2FA RATE_LIMIT_PASSWORD_CHANGE
    RATE_LIMIT_2FA_ACCOUNT`), so the existing substring grep in `install-script.test.sh:1339`
    (`'RATE_LIMIT_LOGIN RATE_LIMIT_2FA RATE_LIMIT_PASSWORD_CHANGE'`) still matches. Without this, operators
    cannot set it and the install tests' rate-limit relaxations do not reach it.
- In `verify.ts`, after the temp token is decoded and the user is loaded, and before the code check, call
  `rateLimitService.consume('auth:2fa-account', \`user:${user.id}\`)`. Import `rateLimitService` from the
  `services/rateLimiting` barrel (`services/rateLimiting/index.ts`), the module path the unit harness `vi.mock`
  targets, not from `services/rateLimiting/rateLimitService.ts` directly, or the harness mock does not apply.
  - If not allowed, set the `Retry-After` header and throw
    `RateLimitError(TWO_FA_ACCOUNT_RATE_LIMIT_MESSAGE, retryAfter)`
    (`errors/ApiError.ts:341`; there is no `TooManyRequestsError`), and audit `TWO_FACTOR_FAILED` with
    `details.reason: 'account_rate_limited'`.
    - `retryAfter` is the consume result's `retryAfter` (seconds). Do not derive it from `resetAt`, which is epoch
      milliseconds (`services/rateLimiting/types.ts:42-45`).
    - `RateLimitError` only puts `retryAfter` in the error details; the header is set by the rate-limit
      middleware (`middleware/rateLimit.ts:38-40`), which this in-handler check bypasses. So `verify.ts` calls
      `res.setHeader('Retry-After', …)` itself before throwing. `retryAfter` is optional (`number | undefined`,
      `services/rateLimiting/types.ts:45`), so narrow it first: set the header only when
      `result.retryAfter !== undefined` (passing `String(result.retryAfter)`), and pass the same value to
      `RateLimitError`.
  - Consuming per attempt, rather than per failure, keeps the check atomic. Ten attempts per 15 minutes cannot
    hurt a legitimate user.
  - **Consume throw → 503 (decided).** With no limiter, `consume` **throws**: `rateLimitService.ts:103` calls
    `getLimiter()` before the `try` at `:106`, and `getLimiter` (`:73-79`) throws `Redis rate limiter
    unavailable`. Only an unknown policy (`:90-99`) and errors inside the try (`:124-131`) fail open. Catch a
    throw from this `consume` call in `verify.ts` and respond 503 (`ServiceUnavailableError`), matching the
    middleware's fail-closed behaviour (`middleware/rateLimit.ts:110-117`); log it with `getErrorMessage`. Do
    not check the code.
- **Lizard: a top-level helper.** The `verify.ts` route handler (anonymous, `verify.ts:34-136`) is CCN 13
  today (a bare local `lizard` run reports CCN 12, labelled `error@42-136`; record the `lizard-only.sh` figure);
  inlining the consume, throw-to-503, `retryAfter` narrowing and deny branches would take it to 16, over
  `-C 15` (`scripts/quality.sh:290`), and the shared warning budget has no slack (see Cross-cutting gating facts).
  Put the whole account check in a **top-level (module-level, not nested)** function in `verify.ts`, for example
  `async function enforceTwoFactorAccountLimit(req, res, user): Promise<void>`: it consumes, maps a throw to
  `ServiceUnavailableError` (503), sets `Retry-After`, writes the audit row and throws `RateLimitError` (429). The
  handler calls it with one `await` and gains no branches.
- Keep the per-IP limiter.
- Known trade-off: someone who holds the password can make 2FA fail for the real user for one window. Rotating
  the password ends that.

**Test first.**
- Unit harness: `server/tests/unit/api/auth2fa/auth2faTestHarness.ts` mocks only `middleware/rateLimit`
  (`:82-91`), and `tests/setup.ts:51-56` also mocks only the middleware. Add a `vi.mock` of
  `services/rateLimiting` there whose `rateLimitService.consume` resolves `{ allowed: true, remaining: 9, limit:
  10, resetAt: … }` by default, so every existing verify contract keeps passing (otherwise `consume` throws
  `Redis rate limiter unavailable`). Override it per test for the deny and throw cases. The `vi.mock` factory
  replaces the barrel, so `policies.ts` (and its load-time `config.mcp` read) is never evaluated.
- Add the **same** `vi.mock` of `services/rateLimiting` (`consume` allowed by default) to
  `server/tests/unit/api/authRegistration/authRegistrationTestHarness.ts`. It builds the same auth router, whose
  graph now reaches the barrel (`verify.ts`, and B2's `email.ts`); with the config mock at `:28-47` (no `mcp`)
  the barrel import alone crashes `auth.routes.registration.test.ts`.
- `server/tests/unit/api/auth2fa/auth2fa.verify.contracts.ts` (or `auth.routes.2fa.test.ts`): mock
  `rateLimitService.consume` to deny for `user:<id>` (with `retryAfter: 900`) → 429 with `Retry-After: 900`,
  the code not checked, audit written. At base the code is checked, so the test fails. Also:
  a deny with no `retryAfter` → 429, no `Retry-After` header, the code not checked (the other arm of
  the `retryAfter !== undefined` narrowing); `consume` rejects → 503, the code not checked.
  - "The code not checked" is asserted on the mocked service, not on `verifyAndConsumeTotp`/`consumeVerifiedTotp`
    (not mocked in `auth2faTestHarness.ts`, so it cannot be spied on): assert `twoFactorService.verifyTokenStep`
    (harness `:169`; called by `consumeVerifiedTotp.ts:18`), `twoFactorService.isBackupCode` (`:174`) and
    `twoFactorService.verifyBackupCode` (`:172`) were not called. The harness mocks `services/twoFactorService` at
    `:162`.
- `server/tests/integration/flows/authIntentConcurrency.integration.test.ts` (`:80-110` expects `[200, 401]`
  from two concurrent verifies on the shared, uninitialised integration server): add
  `vi.spyOn(rateLimitService, 'consume').mockResolvedValue({ allowed: true, … })` in that spec, or the throw
  maps to 503 and it fails. Server vitest sets `restoreMocks: true` (`server/vitest.config.ts:22`), which restores
  every `vi.spyOn` before each test, so the spy goes **inside the 2FA `it`** (or a `beforeEach`), never in
  `beforeAll` or at module scope. Do not stub `consume` in the shared `testServer`: the new Redis spec needs the real
  `consume`.
- `server/tests/unit/services/rateLimiting/policies.test.ts`: the policy exists, with its config default, and
  is registered with the rate-limit service. This assertion matters: `consume` on an unregistered policy fails
  open (`rateLimitService.ts:90-99`), so a missing registration would silently disable the cap. Add `twoFaAccountAttempts` to the config fixture at `policies.test.ts:16`. The existing message-quality loops
  (`:448-455`, `:457-466`) then cover the new policy's message; also assert it equals
  `TWO_FA_ACCOUNT_RATE_LIMIT_MESSAGE` (imported from `policyMessages.ts`), and the verify deny case asserts the
  429 body carries that message.
- `server/tests/unit/config/schema.test.ts:35`: add `twoFaAccountAttempts` to the config fixture, plus a bounds
  case for the new field. **Lizard:** the fixture function `buildValidConfig@4-204` is already exactly 200 NLOC and
  the gate runs `-T nloc=200` over `server/tests`, so a new line would add a warning (budget 84/86). Put the new key on
  the same line as the existing one (`twoFaAttempts: 10, twoFaAccountAttempts: 10,`), or move the `rateLimit` literal
  to a module-level const; verify `lizard -w -T nloc=200 server/tests/unit/config/schema.test.ts` stays clean. The
  bounds case goes in its own `it`, outside `buildValidConfig`.
- Integration: a **new Redis-gated** spec, `server/tests/integration/flows/auth/twoFactorAccountRateLimit.integration.test.ts`,
  registered in `scripts/ci/backend-integration-groups.sh`. The shared integration `testServer` never calls
  `rateLimitService.initialize()` (`tests/integration/setup/testServer.ts:36-60`), so `consume` has no limiter
  and throws (`getLimiter`, `rateLimitService.ts:73-79`, called before the try at `:106`), which the fix maps
  to 503: the cap cannot be observed there. The new
  spec wraps its suite in `describeWithRedis` (`tests/integration/setup/redis.ts:28`, as the worker specs do)
  and calls `initializeRedis()` and `rateLimitService.initialize()` in `beforeAll`. Send 11 wrong codes against
  the same user. The 11th returns 429 with a `Retry-After` header. Distinct `X-Forwarded-For` values are
  harmless but unnecessary: the per-IP middleware is mocked globally (`tests/setup.ts:51-56`). Do **not**
  enable Redis in the shared `twoFactor.contracts.ts`.
  - Register it in the ops-workers group of `backend-integration-groups.sh` (`GROUP_OPS_WORKERS`, `:99-112`),
    with the other `describeWithRedis` suites. `describeWithRedis` silently skips without `REDIS_URL`; CI sets
    `SANCTUARY_REQUIRE_REDIS_INTEGRATION: 'true'` (`.github/workflows/test.yml:810`) so a missing Redis fails at
    collection. Update that step's "four Redis-backed suites" comment (`:807-808`). Run it locally with
    `REDIS_URL` set and `SANCTUARY_REQUIRE_REDIS_INTEGRATION=true`, so a skip cannot pass as green.
- Install unit: extend the assertion in `tests/install/unit/install-script.test.sh:1337-1339` to require
  `RATE_LIMIT_2FA_ACCOUNT` in `docker-compose.yml` and in the `start.sh` export list.
- Install e2e: add `export RATE_LIMIT_2FA_ACCOUNT=100` next to each of the three `export RATE_LIMIT_2FA=100` lines
  in `tests/install/e2e/upgrade-install.test.sh` (`:761`, `:2297`, `:2421`), so repeated 2FA in the upgrade
  scenarios does not hit the new per-account cap.

**Constraints.**
- `RATE_LIMIT_2FA_WINDOW` appears only in `envSections.ts`, so no env-doc parity file exists to update.
  Re-grep `RATE_LIMIT_2FA` before committing.
- **Lizard gate.** Run `bash scripts/quality/lizard-only.sh` and record the `verify.ts` handler's CCN after the
  change (must be `<= 15`, and the PR's lizard warning count must not rise).
- **Import side effects.** `verify.ts` must not import `services/rateLimiting/policies` (load-time
  `getRateLimitPolicies()`, `policies.ts:217`); the message constant comes from `policyMessages.ts`, and
  `rateLimitService` from the barrel, which both auth unit harnesses mock.
- **PR B becomes an install-test lane change.** `docker-compose.yml`, `start.sh` and `tests/install/**` trigger the
  install-test lanes; run `bash tests/install/unit/install-script.test.sh` locally and wait for install-test on
  the PR. Never run the install or start scripts for real.

**Acceptance.** 2FA guesses against one account are capped across all source IPs. The cap is configurable through
`RATE_LIMIT_2FA_ACCOUNT` in the compose deployment. If the limiter is unavailable, verify fails closed with 503
and never checks the code.

**Files touched.** `server/src/services/rateLimiting/policies.ts`, (new)
`server/src/services/rateLimiting/policyMessages.ts`, `server/src/config/{types.ts,schema.ts,envSections.ts}`,
`server/src/api/auth/twoFactor/verify.ts`, `docker-compose.yml`, `start.sh`; tests
`server/tests/unit/api/auth2fa/{auth2faTestHarness.ts,auth2fa.verify.contracts.ts}` (or `auth.routes.2fa.test.ts`),
`server/tests/unit/api/authRegistration/authRegistrationTestHarness.ts`,
`server/tests/integration/flows/authIntentConcurrency.integration.test.ts`,
`server/tests/unit/services/rateLimiting/policies.test.ts`,
`server/tests/unit/config/schema.test.ts`, (new)
`server/tests/integration/flows/auth/twoFactorAccountRateLimit.integration.test.ts`,
`scripts/ci/backend-integration-groups.sh`, `.github/workflows/test.yml` (comment only),
`tests/install/unit/install-script.test.sh`, `tests/install/e2e/upgrade-install.test.sh`.

---

### Phase B11 — Approval-required drafts send approvers a bogus zero-amount notification (P2, `approval-notification--zero-amount-draft-placeholder`)

**Evidence (reproduces).**
- `server/src/services/vaultPolicy/approvalNotifications.ts:17-48` calls `handler.notifyDraft` with
  `{ amount: 0n, recipient: '', feeRate: 0, label: '[Approval Required]' }`. The comment says "resolved by the
  channel", but no channel does that.
- Telegram renders `Amount: 0.00000000 BTC` and `Fee Rate: 0 sat/vB`.
- The call bypasses the queue, dedupe and dead-letter path used by `dispatchDraftNotification`
  (`notifications/dispatch.ts:177-204`).
- On every path, the approval dispatch is followed by the real draft notification:
  - `draftCreate.ts:280-286` (post-commit);
  - `:376-381` (in-transaction approval, then `dispatchCreatedDraftNotification`);
  - `approvalService.ts:160-165`, reached via `runDraftCreatedSideEffects`, `draftCreate.ts:260-268`.

  So the placeholder is always a second, wrong message.

**Change (simpler design: the worker derives the flag from the reloaded draft).**
- Remove the placeholder. `notifyApprovalRequested` (`approvalNotifications.ts:17-48`) contains nothing but the
  `notifyDraft` loop, so delete the function; delete `dispatchApprovalRequestedNotification` (`approvalService.ts:60-67`, its export at `:710`) and its three call
  sites (`approvalService.ts:163-164`, `draftCreate.ts:284`, `draftCreate.ts:380`), and delete the
  `suppressNotification` parameter (`approvalService.ts:80`, `draftCreate.ts:215,228`) that only existed for it.
  Also drop the trailing `true` argument at the two `createApprovalRequestsIfNeeded` call sites that pass it
  (`draftCreate.ts:354` in the transaction branch, `:370` in the external-client branch); the call at `:267`
  passes none.
  Drop the then-unused `notificationChannelRegistry` import from `approvalNotifications.ts:8` and the
  then-unused `getErrorMessage` import (`:10`; its only use is at `:44`, inside the deleted function).
  `createLogger` stays: `notifyApprovalResolved` still logs.
  In `approvalService.ts`, remove `notifyApprovalRequested` from the import at `approvalService.ts:20`, which
  becomes `import { notifyApprovalResolved } from './approvalNotifications';` (its only use, `:65`, is inside the
  deleted `dispatchApprovalRequestedNotification`; leaving it would fail the build once the export is gone).
  `getErrorMessage` (`:19`) stays imported there: it is still used at `:339`, `:425` and `:682`.
- No new payload field. The draft-notify worker already reloads the draft
  (`worker/jobs/notificationJobs.ts:221`, `draftRepository.findById`, which returns the full row). When building
  `draftNotification` (`:230-241`) it sets exactly `approvalRequired: draft.approvalStatus === 'pending'`: no
  `?.`, `??`, `&&` or ternary, because the handler (`handler`, `notificationJobs.ts:200-293`) is already at
  CCN 15, the `-C 15` limit, and any extra branch would fail lizard.
  `approvalStatus` is set to `'pending'` at draft creation when approval is required (`draftCreate.ts:160`;
  column `schema.prisma:766`).
  - Nothing is added to the queue payload: `queueDraftNotification` (`notifications/dispatch.ts:183-193`),
    `infrastructure/notificationDispatcher.ts:93` and the job-data type `worker/jobs/types.ts:46` are unchanged.
  - Jobs already queued before the deploy are covered too, because the flag is computed when the job runs.
  - If the draft is approved before the job runs, the line is correctly omitted.
- **Inline fallback.** When `queueDraftNotification` returns false, `dispatchDraftNotification` sends
  `notifyNewDraft` with the in-memory `DraftData` it was given, without a reload (`dispatch.ts:195-203`). So
  `dispatchCreatedDraftNotification` (`draftCreate.ts:231-255`) also sets
  `approvalRequired: draft.approvalStatus === 'pending'` on the object it passes. The created row carries
  `approvalStatus: 'pending'` when approval is required (`draftCreate.ts:160`). `DraftData` is
  `DraftNotification` (`notifications/notificationService.ts:27`), so the type change below covers it. The
  queued path ignores this field and the worker re-derives it.
- The display type is the only type change: add an optional `approvalRequired?: boolean` to `DraftNotification`
  (`notifications/channels/types.ts:28-40`, mirrored in `telegram/types.ts:110-121`) so the channel formatter can
  read it. `services/telegram/formatting.ts` `formatDraftMessage` (`:94-147`, whose `draft` parameter is an
  inline type at `:95-103`, so add `approvalRequired?: boolean` there too) prints `Approval required before
  signing` when it is true. It returns early for agent drafts (`:110-129`), so add the line in **both** the
  agent-funding branch (before the early `return message`) and the standard branch.
- Keep `notifyApprovalResolved` unchanged.

**Test first.**
- `server/tests/unit/services/draftCreate.test.ts` (the fail-first assertion): an approval-required draft calls
  `dispatchDraftNotification` exactly once with the real amount, and
  `approvalService.dispatchApprovalRequestedNotification` is not called. At base it is called, so the test
  fails. Also assert that the `dispatchDraftNotification` argument carries `approvalRequired: true` for an
  approval-required draft and `false` otherwise (the inline-fallback input).
  - Fixture: `mockDraft` (`draftCreate.test.ts:90`) has no `approvalStatus`, and `draftRepository.create` is
    mocked to return it (`:122`). The approval-required cases must mock `create` to return
    `{ ...mockDraft, approvalStatus: 'pending' }` (or echo the create args), or the `approvalRequired: true`
    assertion fails even after the fix.
  - The ordering test at `:208-220` ("dispatches the approval notification before the draft-created notification
    after commit") encodes the deleted dispatch; rewrite it to assert the single `dispatchDraftNotification` call
    (with `approvalRequired: true`) and that `createApprovalRequestsForDraft` ran once, or delete it.
  - Three existing `createApprovalRequestsForDraft` expectations pass the deleted trailing flag: the test at
    `:129` (assertion ending `:149`, `(…, tx, true)`), the test at `:239` (`(…, client, true)` at `:257-258`)
    and the test at `:317` (`(…, client, false)` at `:333-334`). Drop the trailing `true`/`false` from all three
    `toHaveBeenCalledWith`. The same trailing flag appears in `server/tests/unit/services/draftService.test.ts:495-502`
    (`createApprovalRequestsForDraft` expectation ending `expect.any(Object), true` at `:500-501`); drop that `true`
    too.
  - **Decided: keep the absence pins.** Keep the `dispatchApprovalRequestedNotification: vi.fn()` key in the
    `approvalService` mock factory (`draftCreate.test.ts:55`) even though the export is deleted, and keep every
    `expect(approvalService.dispatchApprovalRequestedNotification).not.toHaveBeenCalled()` line (`:228`, `:260` in
    the `:239` test, `:279`, `:298`, `:313` in the `:302` test, `:361`). They pin the absence of a second
    dispatch; do not remove them. Because the export is gone, `approvalService.dispatchApprovalRequestedNotification`
    no longer type-checks (TS2339 under `npm run typecheck:tests`); read the mock once through a local cast (e.g.
    `const removedApprovalDispatch = (approvalService as unknown as Record<string, Mock>).dispatchApprovalRequestedNotification;`)
    and point those lines, and the rewritten `:208` and `:339` tests, at it.
  - The test at `:339-355` ("dispatchDraftCreatedPostCommitNotifications dispatches approval before draft
    exactly once …") asserts `dispatchApprovalRequestedNotification` is called once and before the draft
    notification. Rewrite it to assert a single `dispatchDraftNotification` call carrying `approvalRequired`
    from the draft (pass a fixture with `approvalStatus: 'pending'`, so `approvalRequired: true`) and that
    `createApprovalRequestsForDraft` is not called.
- `server/tests/unit/services/approvalNotifications.test.ts`: delete the `notifyApprovalRequested` placeholder
  tests with the function; keep the `notifyApprovalResolved` tests unchanged.
- `server/tests/unit/worker/jobs/notificationJobs.draft.test.ts`: a reloaded draft with
  `approvalStatus: 'pending'` yields `approvalRequired: true` in the notification passed to the channels;
  `'not_required'` and `'approved'` yield `false`.
- `server/tests/unit/services/telegram/formatting.test.ts`: for the agent-funding branch (`agentName` set) and
  the standard branch, each with the flag on and off: on renders `Approval required before signing`, off (or
  absent) does not. Four cases, so both branches' new conditionals are covered.
- Update the other files that reference the deleted symbols:
  `server/tests/unit/services/draftService.test.ts`,
  `server/tests/unit/services/approvalService/approvalServiceTestHarness.ts` (mocked `notifyApprovalRequested`
  at `:28`, `:104`) and `server/tests/unit/services/approvalService/approvalService.create.contracts.ts`. In the
  last: delete the `suppressNotification` test (`:340`, "suppresses only the notification when
  suppressNotification is true") and the `dispatchApprovalRequestedNotification` test (`:371`); delete the
  warning test at `:273` ("logs warning when notifyApprovalRequested fails"); and drop the
  `notifyApprovalRequested` assertions at `:202` and `:337` from the tests that otherwise stay.

**Constraints.**
- Run `npm run arch:check` because the `approvalNotifications` → notification-channel import edge is removed.
- **Lizard.** Record the `notificationJobs.ts` draft handler CCN (`handler@200-293`, 15 at base) from
  `bash scripts/quality/lizard-only.sh`; it must stay `<= 15`.
- Coverage: delete dead exports rather than `v8 ignore` them.
- No inventories are affected.

**Acceptance.** Approvers receive one notification with the real amount, recipient and fee rate, marked
approval-required. On the queued path (with its dedupe and dead-letter handling) the worker derives the mark from
the reloaded draft; on the inline fallback, when queueing fails, the mark comes from the created draft. Jobs queued
before the deploy render correctly.

**Files touched.** `server/src/services/vaultPolicy/{approvalNotifications.ts,approvalService.ts}`,
`server/src/services/draftCreate.ts`, `server/src/worker/jobs/notificationJobs.ts`,
`server/src/services/notifications/channels/types.ts`, `server/src/services/telegram/{types.ts,formatting.ts}`,
`docs/architecture/generated/**` if the graph changes; tests
`server/tests/unit/services/{draftCreate.test.ts,approvalNotifications.test.ts,draftService.test.ts}`,
`server/tests/unit/services/approvalService/{approvalServiceTestHarness.ts,approvalService.create.contracts.ts}`,
`server/tests/unit/worker/jobs/notificationJobs.draft.test.ts`, `server/tests/unit/services/telegram/formatting.test.ts`.

---

### Phase B12 — An all-own-output transaction can never broadcast with the client's amount (P1, `broadcast--all-own-output-amount-mismatch`)

**Finding / evidence (re-read at `f2c7e217`; status: reproduces by code reading, the route test below is the
discriminator).**
- `buildCanonicalMetadata` (`server/src/api/transactions/broadcasting.ts:163-212`) marks an output `isOurs`
  when its address is in `addressRepository.findAddressStrings` (`:166`, `:176`), builds `externalOutputs` from
  the outputs that are not ours (`:192-194`), and sets `amount` to their sum (`:205`). When every output belongs
  to the wallet, `externalOutputs` is empty and `metadata.amount` is `0`.
- The client always sends a positive amount. `useBroadcast` posts `amount: getEffectiveAmount(txData)`
  (`src/hooks/send/useBroadcast.ts:290-301`, `amount` at `:298`). `getEffectiveAmount` (`:158-168`) returns
  `txData.effectiveAmount` when it is set and non-zero, otherwise `Σ txData.outputs[].amount`, and throws unless
  the result is a positive satoshi number.
- `assertOptionalMetadata` (`:237-262`) compares `metadata.amount` with `optional.amount`, or with
  `Number(draft.effectiveAmount)` when the body has no amount (`:244`), and throws `metadata_mismatch` on any
  difference (`:247-252`). Both handlers call it: `handleTransactionBroadcast` (`:440-445`) and
  `handlePsbtBroadcast` with the draft only (`:473-474`).
- Consolidation from the send wizard: the `consolidation` type defaults to one `sendMax` output
  (`src/contexts/send/reducerParts/transactionType.ts:16-18`), so it takes the batch path
  (`shouldCreateBatchTransaction`, `src/hooks/send/useSendTransactionActions.ts:73`). The batch response has no
  `effectiveAmount` (`server/src/api/transactions/drafting.ts:227-239`) and, with `sendMax`, no change output
  (`createBatchTransaction.ts:161`), so the client sends `Σ outputs` = the single output value, against an
  expected `0` → 400.
- Consolidation **draft**: `getEffectiveDraftAmount` (`src/hooks/send/useDraftManagement.ts:36-50`) falls back to
  `Σ txData.outputs` because `effectiveAmount` is undefined on a batch result; the request carries it as `amount`
  (`:92`) with `effectiveAmount: undefined` (`:110`), and `draftCreate.ts:130` stores
  `effectiveAmount = BigInt(data.effectiveAmount || data.amount)`. So a consolidation draft's
  `effectiveAmount` equals `Σ outputs`, and a body-less draft broadcast is rejected the same way.
- CPFP child drafts (C1): one input, one output, to a fresh wallet address when the caller passes no recipient (`cpfp.ts:140-143`; an external recipient already works because it is a non-empty `externalOutputs`), and C1's
  `cpfpDraftRequest` sets `effectiveAmount` from `outputs[0].value`, which is again `Σ outputs`. Without B12,
  C1's draft can be signed but never broadcast.
- The existing all-own test (`server/tests/unit/api/transactionsSigningIntentBroadcast.test.ts:321-331`) posts
  `body` (`:136-140`), which has no `amount`, `fee`, `recipient` or draft, so the amount check is skipped and the
  client path is never exercised.

**Change (server only, smallest correct). Decided: skip the client-reported `amount` and `recipient` checks when
nothing leaves the wallet.**
- In `assertOptionalMetadata` (`:237-262`), when `metadata.externalOutputs.length === 0` (every output belongs to
  the wallet), leave out the `recipient` row (`:243`) and the `amount` row (`:244`). Keep both rows exactly as
  they are when there is at least one external output. For example:
  `const spendChecks: Array<[string, unknown, unknown]> = metadata.externalOutputs.length === 0 ? [] : [<the :243 row>, <the :244 row>];`
  followed by `const checks = [...spendChecks, <the :245 fee row>];`.
- **Rationale.** With no external output, nothing leaves the wallet, so the client's `amount` and `recipient`
  carry no spend-authorization meaning. The canonical values (`metadata.amount`, `metadata.recipient`) stay
  authoritative for persistence and policy usage, and are unchanged.
- **What this covers.** A wizard MAX consolidation (the client sends `Σ outputs`, expected `0`); a consolidation
  or CPFP child draft (`effectiveAmount = Σ outputs`); and a non-MAX self-send with a change output, where the
  client sends only the recipient output's value and `metadata.recipient` is the first output after the shuffle
  (`server/src/services/bitcoin/transactions/outputBuilder.ts:83`), which can be the change output. The
  self-send case is fixed here, not deferred.
- Do **not** change `metadata.amount` or `metadata.recipient` (`:204-205`). `metadata.amount` is still
  `Σ externalOutputs` and feeds `broadcastAndSave` (`:392`), `recordMonitorUsage` (`:368-374`, which skips
  `amount <= 0`) and `reservePolicyUsage` (`:294-296`, which returns early with no external outputs). Changing it
  would count a consolidation as spend in policy usage windows.
- The `fee` row (`:245`), the `utxos` check (`:254`) and the draft-outpoint check (`:255-261`) are unchanged and
  still run for all-own transactions.
- No sum-of-all-outputs helper. Any new helper name must not start with `finalize`, `sign` or `broadcast`
  (signer inventory).
- A zero-value all-own case (OP_RETURN only, the test at `:333-344`) sends no `amount` or `recipient`, so it is
  unaffected.

**Test first (must fail at `f2c7e217` where marked).** In
`server/tests/unit/api/transactionsSigningIntentBroadcast.test.ts`, hoist the address derivation from `:322-327`
into a local helper inside the describe so the new cases share it (the file is 760 lines; keep it under the
large-file limit). "All-own" means `findAddressStrings` returns every state output address. The artifact has one
10000-sat input and one 9000-sat output (`:100-104`).
- (a) All-own, client-shaped body:
  `{ ...body, amount: 9000, fee: 1000, recipient: <first state output address>, utxos: [{ txid: '1'.repeat(64), vout: 0 }] }`
  (`amount` = `Σ outputs`) → 200, and `broadcastAndSave` called with `amount: 0` and `recipient` = the first
  output address (pins that the canonical metadata is unchanged). At base: 400 `metadata_mismatch` on `amount`.
- (b) All-own two-output self-send: clone the artifact with two outputs, a 4000-sat change output first and a
  5000-sat recipient output second (different `scriptPubKeyHex`, both in `findAddressStrings`); body
  `{ ...body, amount: 5000, recipient: <second output address> }` → 200. At base: 400 (amount `5000 ≠ 0`, and the
  recipient is not the first output).
- (c) All-own with `fee: 999` → 400 `metadata_mismatch`, `broadcastAndSave` not called.
- (d) All-own with mismatched `utxos` (`[]`, or `vout: 1`) → 400, `broadcastAndSave` not called.
- (e) External output (`findAddressStrings` returns `[]`, the default at `:122`): `{ amount: 8999 }` → 400 and
  `{ recipient: 'tb1qwrong' }` → 400. The existing `it.each` at `:199-209` already has `{ amount: 1 }` and
  `{ recipient: 'tb1qwrong' }`; keep it and confirm it runs with the external default. These kill the mutants
  that force the skip condition to `true` or drop either row.
- (f) Draft-based all-own: `findDraft` returns `draft({ recipient: <first output address>, effectiveAmount: 9000n })`
  (the fixture at `:142-156`; `fee` `1000n` and `selectedUtxoIds` already match) and the body is
  `{ draftId: 'draft-1' }` → 200. At base: 400.
- **Goal-rule gate.** If (a) passes at `f2c7e217`, record B12 `rejected` with that evidence and drop it from PR B;
  C1 then loses its dependency on B12.

**Constraints.**
- `server/src/api/transactions/broadcasting.ts` matches `is_critical_mutation_file`
  (`scripts/ci/classify-files-lib.sh:73`) and is mutated by Stryker shard 3 (`broadcast-auth-access`,
  `server/scripts/mutation/shards.mjs:32-45`). Every new branch must be killed: the condition forced `false` by
  (a)/(b)/(f), forced `true` and the `=== 0` operator by (e), the empty-array arm by (a) (a mutated non-empty
  array row throws), and the unchanged `fee`/`utxos` rows by (c)/(d). Run the shard-3 critical mutation run and
  record no new survivors against `.github/mutation-baseline.json`.
- **Lizard.** `assertOptionalMetadata` is CCN 13 at base (`assertOptionalMetadata@237-262`, pinned lizard 1.24.0).
  The inline ternary adds one branch (expected 14). Record the value from `bash scripts/quality/lizard-only.sh`;
  it must be `<= 15`. If it is over 15, extract a small top-level module-private helper that returns the
  `recipient`/`amount` rows (or `[]` when all-own), and record both CCNs.
- No other metadata check changes. Not a bitcoin pin file (`config/wallet-safety-mutation-map.json` and the
  profile `mutate` ranges do not name it). No signer-inventory identifiers.
- Server coverage: `cd server && npx vitest run --coverage tests/unit` stays at 100%.
- `server/src/api/transactions/**` is listed in `config/wallet-safety-critical-paths.json:28`, so verify-vectors
  runs on PR B for B12 as well as B3/B4.

**Acceptance.** When every output belongs to the wallet, a wizard consolidation, a non-MAX self-send with change,
and a consolidation or CPFP child draft (C1) are accepted whatever `amount` and `recipient` the client or draft
reports. A wrong `fee` or `utxos` is still rejected for all-own transactions, and a wrong `amount` or `recipient`
is still rejected when there is an external output. Persisted transaction amount and policy usage for an all-own
transaction are unchanged (`amount: 0`, no reservation).

**Files touched.** `server/src/api/transactions/broadcasting.ts`; test
`server/tests/unit/api/transactionsSigningIntentBroadcast.test.ts`.

---

### Decisions for the reviewer to check

1. **A1.** Error and close listeners move to the top of `handleConnection` and are removed from
   `completeClientRegistration`, so each fires once. Registered clients are now `terminate()`d on error and
   the error is logged at `warn`. The gateway early-close gap (`gatewayServer.ts:78-82`) is
   fixed in the same P0 PR even though it was not in the finding.
2. **B1.** A new integration spec, registered in `backend-integration-groups.sh`, is the discriminator. If it
   passes at base, B1 is recorded `rejected` with that evidence and the whole phase is dropped from PR B (the
   Goal rule; no P3 downgrade, no consistency-fix carry-over).
3. **B2.**
   - **Decided: simplified scope.** No pending email change. `PUT /me/email` keeps its base behaviour (writes the
     new address, sets `emailVerified:false`, issues a token) apart from the SMTP guard below.
     `consumeForCurrentEmail` keeps `EMAIL_MISMATCH` → `INVALID_TOKEN`, so tokens for a superseded address stay
     harmless. No repository change (`emailVerificationRepository.ts`, `userAdminUpdate.ts` untouched), no new
     public error code. Repeated reviews found new concurrency holes in the pending-change design, and the
     verify page plus pre-auth resend already remove the permanent lockout.
   - The link moves to `/#/verify-email`, and legacy `/verify-email` links are rewritten in the entry point
     `src/main.tsx`.
   - Pre-auth resend is credentialed: username and password, with an identical 202 for every outcome and an
     ip+user plus per-user rate limit. The alternative, a token-only resend keyed by email, was rejected because
     it allows enumeration and abuse. The new pre-auth resend policy reuses the `emailResend*` config values. The
     route also consumes the `auth:login` ip+username bucket. The `user:<id>` bucket it shares with the
     authenticated resend is consumed only after the password verifies; when it is exhausted, or when that
     `consume` throws, the route still returns the identical 202 and sends nothing, so there is no password
     oracle through a 429 or 500. The limiters are built in `api/auth.ts` (where the login username extractor
     lives) and passed into `createEmailRouter`.
   - The login 403 `emailVerificationRequired`/`canResend` flag reaches the form through
     `useUserAuthActions.ts`, so the login UI offers a resend, rendered by
     `src/components/Login/LoginForm/LoginFormActions.tsx`.
   - The resend-pending integration flows verify the token from the last `sendEmail` call and assert the earlier
     token is now `INVALID_TOKEN` (unused tokens are deleted on reissue), proving a fresh token was issued.
   - With verification required and SMTP not configured, `PUT /me/email` is refused before any write. This
     breaks the existing SMTP-disabled case in `authIntentConcurrency.integration.test.ts:143-185` (verification is
     required by default in integration), which is split into a not-required case (keeps the
     `replaceUnusedForEmailUpdate` invalidation coverage; the setting is deleted in a `finally`) and a
     required-plus-no-SMTP refusal case (asserts the setting absent first; email and old token unchanged).
   - The new `emailVerification.integration.test.ts` stubs `rateLimitService.consume` to allowed in a
     `beforeEach` or inside the `it` (server `restoreMocks: true`), because the integration server never
     initializes the rate limiter and the in-handler consume would otherwise throw and skip every send. Its
     register step sets `registrationEnabled` and `email.verificationRequired` and deletes both in a `finally`.
   - **Residual (P3, recorded):** a mistyped address that cannot receive mail still needs an administrator to
     correct it.
4. **B3.**
   - Definite rejections come from an allowlist of message fragments on a new typed `ElectrumRpcError`, and are
     honoured only on a first claim (`priorState:'ready'`).
   - `missingorspent` stays unknown.
   - **Decided:** only attempts where the node answered count toward `MAX_RECONCILE_ATTEMPTS` (60): an
     `ElectrumRpcError` whose message matches a node-verdict pattern (the definite-rejection allowlist plus
     `missingorspent`, `already in block chain`, `txn-already-known`), or a `BroadcastPreflightError` with reason
     `node_preflight_rejected` (e.g. `stale_or_spent_input`) or the deterministic `invalid_raw_transaction`. Other
     RPC errors and `node_preflight_unavailable` preflight errors are transport. Both unknown wrappers carry the
     original error as `cause`. Transport and timeout failures give their claim increment back
     (`countAttempt: false`), so an outage never stalls an intent. The `{ countAttempt }` parameter is optional
     (default `true`), so existing 3-argument callers stay valid. The check runs inside the reconciler's
     re-broadcast catch on the post-claim `claim.record.broadcastAttemptCount`.
     - **Decided residual (missing parent):** an intent whose parent transaction no longer exists (preflight
       `missing_previous_transaction`, `broadcastPreflight.ts:139-143`, or a batch-fetch RPC error, `:103-106`, both
       `node_preflight_unavailable`) is treated as transport and is not capped. This matches base behaviour; there
       is no funds or double-pay risk because such a transaction can never be broadcast. P3 follow-up
       `broadcast--missing-parent-reconcile-loop`.
   - The new `stalled` state stops rebroadcasts but not lookups: a lookup-only pass, at most hourly per intent
     (DB filter on `broadcastLastAttemptAt`), moves a stalled intent that later confirms to `accepted` with the
     same fields as `markBroadcastAccepted`.
   - **Decided:** `claimBroadcast` reports `priorState` from up to three conditional `updateMany` calls (ready;
     claimed-expired or unknown; stalled when `allowStalled`), taking it from whichever hit, with no separate read.
     `allowStalled` is a field on `BroadcastClaimInput`: `claimSigningIntentBroadcast` (user path) passes `true`,
     the reconciler passes `false`, and both literals are pinned by unit assertions.
     Each keeps the shared guards (`id`, `snapshotDigest`, `supersededById: null`, `consumedAt: null`).
   - **Decided:** the `allowDefiniteRejection` flag is optional with default `false` on both
     `broadcastTransaction(artifact, allowDefiniteRejection?)` and `broadcastAuthenticatedRawTransaction`;
     `broadcasting.ts` and the reconciler always pass it explicitly, and existing one-argument typed callers
     compile unchanged.
   - **Decided:** a user broadcast may claim from `stalled` as a resumed claim (`allowDefiniteRejection: false`).
     If that attempt fails, the intent returns to `stalled` and the user gets a terminal `broadcast_stalled`
     conflict with an actionable message. There is no UI for it yet (follow-up).
   - This also fixes the latent resumed-claim rollback on preflight failure, and the same rollback after an
     `assertReplacementLink` failure (release only when `priorState === 'ready'`).
   - **Decided:** an `assertReplacementLink` failure on a claim whose `priorState` is `'stalled'` re-marks the
     intent stalled (no release, no unknown) and throws the existing pre-network rejection
     (`asPreNetworkRejection`, `broadcasting.ts:223-241`); the test asserts exactly that.
   - **Decided:** `isNodeAnsweredBroadcastFailure` is exported through the `blockchain/index.ts` barrel, and both
     blockchain `vi.mock` factories (`transactionServiceBroadcastTestHarness.ts:62-66`,
     `broadcastReconciliation.test.ts:18-21`) supply the real predicate via `vi.importActual` of
     `networkOperations`, not a stub.
   - **Decided (test boundary):** the `broadcastAndSave` contracts mock the blockchain barrel, so they assert only
     the forwarded `allowDefiniteRejection` flag (`true` for `ready`, `false` for `resumed`/`stalled`) and the
     transition for a given thrown error (stub `DefiniteBroadcastRejectionError` → release; unknown-wrapper
     `Error` with `cause` → unknown with `countAttempt` from the real predicate). Classification (allowlist,
     `missingorspent`, preflight on a resumed claim) is tested only against the real `networkOperations`.
5. **B7.** A 409 with an actionable message, instead of cleanup or reassignment. The actionable/other draft
   split uses two `draftTransaction.count` calls, not `groupBy`. The consequence is that any user
   who ever created a policy, cast a vote or broadcast a draft cannot be deleted. Soft-delete or tombstoning
   needs product sign-off.
6. **B8.** Legacy stored rows are canonicalized at compare time, with a lowercase fallback for undecodable bech32.
   They are not rewritten. When the wallet network is unknown (missing, or an invalid stored string rejected by
   `resolvePersistedBitcoinNetwork`; `getNetwork` alone would silently map it to mainnet), nothing is decoded and
   both sides use the trimmed, HRP-lowercased fallback; mainnet is never assumed. On insert, a wallet with no or
   an invalid network is a `NotFoundError`. A duplicate is a 409 `Address already on this policy (allow or deny list)`, because the unique
   key spans both lists; OpenAPI documents the 409.
   - **Decided:** guard-free warn shape. The canonical helper returns the list of undecodable stored entries and
     `evaluateAddressControl` warns once (a single `log.warn`) when it is non-empty; no `Set` of policy ids. The
     test seeds two undecodable rows on one policy (wallet network `'mainnet'`) and asserts exactly one warn, and
     a zero-undecodable case asserts no warn.
7. **B9.**
   - Caps are enforced at the gateway on wallet-scoped GETs: address summary and address list under
     `viewBalance`; drafts and labels under `viewTransactions` (labels annotate transaction history).
     `GET /wallets/:id/mobile-permissions` carries an `accessControlReason` instead, so users can always read
     their own caps.
   - **Decided:** `GET /wallets/:id/addresses` stays under `viewBalance`, because the list carries per-address
     balances. Consequence: a user with `generateAddress` on and `viewBalance` off can create an address
     (`POST /wallets/:id/addresses/generate`, `whitelist.ts:210-215`) but cannot list addresses.
   - The proxy test asserts per request only that the mobile-permission middleware runs on the newly capped
     routes; which cap each route uses is proven by the contract and `ROUTE_ACTION_MAP` assertions (or a
     module-scope capture of the build-time `requireMobilePermission` calls, which run once at router build and
     are cleared before each test). The 403 path stays in `mobilePermission.test.ts`, because `proxy.test.ts`
     mocks the middleware wholesale.
   - A drift guard in `gateway/tests/unit/routes/proxy.test.ts` requires every wallet-scoped GET to declare a cap
     or an access-control reason.
   - Fail closed: a GET for a nonexistent or inaccessible wallet through the gateway now returns 403 instead
     of 404.
   - `GET /wallets`, `GET /transactions/{txid}` and `GET /transactions/pending` remain uncapped. This is
     documented as a residual.
   - The finding's "no other consumer" claim is corrected.
8. **B10.** The per-account bucket is consumed on every attempt, not only on failures. That is an accepted
   lockout trade-off for anyone who already holds the password. There is a new env var,
   `RATE_LIMIT_2FA_ACCOUNT` (default 10), wired through `docker-compose.yml` and appended at the end of the
   `start.sh` export list, and relaxed to 100 in the upgrade e2e scenarios, which makes PR B an install-test lane
   change. Rejection uses `RateLimitError` with `retryAfter` in seconds and a `Retry-After` header set in
   `verify.ts` (only after narrowing the optional `retryAfter`). **Decided:** a `consume` throw (no limiter: `getLimiter` throws before the fail-open try) maps
   to 503, matching the middleware's fail-closed path. The integration proof is a new Redis-gated spec, because
   the shared integration server runs without a rate limiter; `authIntentConcurrency.integration.test.ts`
   stubs `consume` to allowed so its `[200, 401]` race stays meaningful. That `vi.spyOn` sits inside the 2FA `it`
   (or a `beforeEach`), because `restoreMocks: true` would undo a `beforeAll` or module-scope spy; the same rule
   applies to B2's stub in `emailVerification.integration.test.ts`. The account check lives in a top-level
   helper in `verify.ts` so the route handler gains no branches (lizard budget); tests assert "code not checked"
   on the mocked `twoFactorService` (`verifyTokenStep`, `isBackupCode`, `verifyBackupCode`). The policy's
   message, `'Too many 2FA attempts for this account. Please try again later.'`, is one exported constant
   (`TWO_FA_ACCOUNT_RATE_LIMIT_MESSAGE`) in a new side-effect-free `services/rateLimiting/policyMessages.ts`,
   shared by the policy and the 429 `RateLimitError`; not in `policies.ts`, whose load-time
   `getRateLimitPolicies()` (`:217`) reads `config.mcp` and crashes the auth unit harnesses. Both
   `auth2faTestHarness.ts` and `authRegistrationTestHarness.ts` mock the `services/rateLimiting` barrel (consume
   allowed by default); the same mocks cover B2's `email.ts` import of `rateLimitService`.
9. **B11.** The separate approval notification is dropped in favour of an `approvalRequired` flag on the single
   queued draft notification. The worker derives the flag from the reloaded draft
   (`approvalStatus === 'pending'`), so nothing is added to the job payload and jobs queued before the deploy are
   covered. The inline fallback has no reload, so `dispatchCreatedDraftNotification` also sets the flag from the
   created row. `dispatchApprovalRequestedNotification` and the `suppressNotification` plumbing are deleted,
   including the trailing flag at the `createApprovalRequestsIfNeeded` call sites (`draftCreate.ts:354`, `:370`)
   and the tests that pin the flag or the deleted dispatch (`draftCreate.test.ts`, `draftService.test.ts:495-502`,
   `approvalService.create.contracts.ts`).
   - **Decided:** `draftCreate.test.ts` keeps the `dispatchApprovalRequestedNotification` mock key (`:55`) and all
     its `not.toHaveBeenCalled()` lines (`:228`, `:260`, `:279`, `:298`, `:313`, `:361`), read through a local
     cast because the export is deleted; they pin the absence of a second dispatch.
10. **B12.** When `metadata.externalOutputs` is empty, `assertOptionalMetadata` skips the client/draft-reported
    `amount` and `recipient` checks; nothing leaves the wallet, so those values carry no spend-authorization
    meaning. The `fee`, `utxos` and draft-outpoint checks still run, and both rows are unchanged when there is an
    external output. `metadata.amount`/`metadata.recipient` (persisted values, policy usage) are unchanged. This
    covers MAX consolidations, CPFP children and non-MAX self-sends with a change output (shuffled recipient,
    `outputBuilder.ts:83`); no residual is deferred. C1 depends on B12, so PR B merges before PR C.

## Group C — PR C — frontend

All line numbers were re-verified in `/tmp/sanctuary-bug-scrub-20261013-i4` at `f2c7e217`.

### Cross-cutting gating facts (Group C)

- **Frontend coverage is 100%.** Every new branch in `src/**` needs a unit test. Removing a code path (C1 removes the CPFP `success` message) means removing its render branch too, or that branch drops out of coverage. `src/components/animations/**` is excluded from coverage (`config/tooling/vitest.config.ts:57`, pinned by `tests/config/coveragePolicy.test.ts:126`). Do not add or remove exclude globs.
- **Server touch (C1 only).** C1 changes `server/src/api/bitcoin/transactions.ts` and `server/src/services/bitcoin/advancedTx/cpfp.ts`.
  - The paths match `config/wallet-safety-critical-paths.json` (`server/src/services/bitcoin/**`), so verify-vectors runs.
  - `server/stryker.fee-policy.config.mjs:15` pins `cpfp.ts:38-70`, and `config/wallet-safety-mutation-map.json:1277` (`cpfp-package-fee-is-conserved`, canary line 60) pins lines inside that range. All C1 edits must stay **below line 78** so the pinned range and canary do not move. Confirm `sed -n 38,70p` is byte-identical before and after.
  - No `finalize*`, `sign*` or `broadcast*` identifiers may be added, because the signer inventory sweeps them.
- **verify-vectors runs for C1–C5, not just C1.** `config/wallet-safety-critical-paths.json` (lines 71-129) also
  lists `src/components/send/**` (C2, C5), `src/hooks/send/**` (C5), `src/components/ImportWallet/**` (C3),
  `src/components/AgentManagement/**` (C4), `src/api/bitcoin.ts` and `shared/schemas/bitcoinResponses.ts` (C1).
  C6 and C7 touch no listed path. Every PR C push therefore runs the verify-vectors workflow; budget one full run
  per push (jobs carry timeouts of up to 60 minutes, `.github/workflows/verify-vectors.yml:126`), batch fixes
  before pushing, and include it in the "every workflow run finished" check before merge.
- **E2E.** No Group C phase adds an endpoint, so the 13 `unhandledRequests` mock maps are unchanged. No spec reaches the CPFP button, the review step's Change row or hardware import. `grep -rn "Accelerate\|checkRBF" tests/e2e` and `grep -n "review" tests/e2e/send-transaction-flow.spec.ts` show the review step is never reached. **One spec does reach inline agent import:** `tests/e2e/admin-operations.spec.ts:209-327` ("wallet agent setup creates link and lands on agent wallet dashboard") runs as `ADMIN_USER` (`user-ops-admin`, `GET /auth/me` in `adminOperationsApiState.ts:141`), targets `user-ops-regular` (:297) and clicks Import (:304) then "Import and select" (:309). Under C4 that Import button is disabled and `click()` times out, so C4 rewrites that test (see Phase C4). Two specs are edited: C7's `error-recovery.spec.ts` and C4's `admin-operations.spec.ts`. `git grep "Import and select" tests/e2e` finds no other caller. Run it against a static `dist/` build with a throwaway Playwright config that has no `webServer` block (CLAUDE.md). The PNG baselines (5 files) do not cover any touched screen.
- **Large files** (js/ts gate is 1,000 lines):
  - `tests/components/ImportWallet/HardwareImport.test.tsx` is 877 lines. Keep C3 additions under 60 lines, or use a new `*.contracts.tsx` file.
  - `tests/hooks/useDraftManagement.test.tsx` is 598, `tests/components/TransactionActions.test.tsx` 737 and `server/tests/unit/api/bitcoin/bitcoin.transaction.contracts.ts` 894. All have room.

---

### Phase C1 — CPFP Accelerate hands the child PSBT to the send wizard as a draft (P1, `cpfp-accelerate--child-psbt-discarded`)

**Finding / evidence (current source)**
- `handleCPFP` is at `src/components/TransactionActions/useTransactionActions.ts:138-162`. It calls `bitcoinApi.createCPFPTransaction`, then only `setSuccess(cpfpSuccessMessage(result.effectiveFeeRate))`, closes the modal and calls `onActionComplete`. `psbtBase64`, `intentId` and `intentDigest` are dropped.
- `handleRBF` (:98-136) instead builds a draft (`rbfDraftRequest`), calls `draftsApi.createDraft` and navigates to `/wallets/:id/send` with `state.draft`.
- The server route `POST /bitcoin/transaction/cpfp` (`server/src/api/bitcoin/transactions.ts:216-264`) persists a `source: 'cpfp'` signing intent. Its response has no `inputs` or `outputs`. `CPFPTransactionResponseSchema` (`shared/schemas/bitcoinResponses.ts:111-117`) and OpenAPI `CpfpResponse` (`server/src/api/openapi/schemas/bitcoin.ts:701-721`) agree.
- `createCPFPTransaction` (`cpfp.ts:78-255`) knows the single input (`parentTxid:resolvedVout`, `utxo.amount`), the single output (`resolvedRecipientAddress`, `outputValue`) and `sequence: 0xffffffff`, which means no RBF.
- Draft creation accepts a CPFP intent with no extra fields:
  - `draftCreate.ts:325-337` loads the intent by `intentId`/`intentDigest`, checks the PSBT hash, and copies `signingContext` from the server intent. The client never posts `signingContext`, and the strict `CreateDraftRequestSchema` has no such field.
  - The returned `DraftTransaction.signingContext` is restored by `buildDraftTxData` (`sendTransactionPageHelpers.ts:146-160`).
  - `lockSelectedUtxos` (`draftCreate.ts:170-200`) locks `txid:vout` for non-RBF drafts, and `getValidDraftUtxoIds` (`src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts:227-237`) keeps a UTXO with `lockedByDraftId === draft.id`.
- **Status: reproduces.**
- **Depends on B12.** The CPFP child pays only the wallet's own address, so without B12 the draft C1 saves is
  rejected at broadcast with `metadata_mismatch` on `amount` (see Phase B12). PR B (with B12) merges before
  PR C. If B12 is rejected by its gate, this dependency lapses.

**Change**
1. **Server, additive.** `createCPFPTransaction` returns `inputs: [{ txid: parentTxid, vout: resolvedVout, value: utxoValue }]` and `outputs: [{ address: resolvedRecipientAddress, value: outputValue, isChange: false }]`.
   - Extend the return type at :89-97 (a type-only edit below line 78) and the return object at :242.
   - The route adds `inputs: result.inputs, outputs: result.outputs` to `res.json`.
   - Add both to `CPFPTransactionResponseSchema`, using the same element shapes as `RBFTransactionResponseSchema` (:100, :108; `.min(1)`), to OpenAPI `CpfpResponse` (properties and `required`), and to `src/api/bitcoin.ts` `CPFPTransactionResponse`.
2. **Client.** Add `cpfpDraftRequest({ parentTxid, result, targetFeeRate })` to `transactionActionsData.ts`, mirroring `rbfDraftRequest`:
   - `recipient`/`amount` come from `outputs[0]`;
   - `feeRate: result.childFeeRate`, `fee: result.childFee`, `selectedUtxoIds: inputs.map(txid:vout)`;
   - `enableRBF: false`, `isRBF: false`, `subtractFees: false`, `sendMax: false`;
   - `outputs` as in RBF;
   - `psbtBase64`, `intentId`, `intentDigest`;
   - `totalInput`, `totalOutput`, `changeAmount: 0`, `effectiveAmount`, `inputPaths: []`;
   - `label: 'CPFP: accelerate <txid…>'` and `memo: 'Accelerating transaction <txid>'`.
3. `handleCPFP` calls `draftsApi.createDraft`, then `navigate('/wallets/:id/send', { state: { draft } })` under the same `actions.isCurrent(token)` guards as RBF. There is no `replacesTxid`.
4. Delete `cpfpSuccessMessage`, the `success` state, `TransactionActionState.success`, and the success `ActionMessage` in `TransactionActionsPanel.tsx:16`, so no uncovered branch is left.
   - `ActionMessage` has only two callers (`:16` success, `:17` error), so after the deletion collapse it to
     error-only: drop the `type` prop and its `'error' | 'success'` union (`:27-44`, union at `:32`), the success
     arm of the icon choice (`:36`), and the success arm of `actionMessageClass` (`:143-144`; inline the error
     class or keep a no-argument helper).
   - Remove `CheckCircle` from the `lucide-react` import (`:1`); its only use is the success arm at `:36`.
   - Leaving any success arm in place keeps a dead branch that fails the 100% frontend coverage gate.

**Test first (fails at f2c7e217)**
- `tests/components/TransactionActions.test.tsx`, in the CPFP describe at :498: mock `createCPFPTransaction` with `inputs`/`outputs`, click Accelerate, then assert `draftsApi.createDraft` is called with `psbtBase64`/`intentId`/`intentDigest`/`selectedUtxoIds: ['parent:0']`/`enableRBF:false`, and that `navigate` is called with `/wallets/wallet-1/send` and the draft (`defaultProps.walletId` is `'wallet-1'`, `TransactionActions.test.tsx:51-56`). Keep the mocked `inputs[0].txid` as `'parent'` so the UTXO id is `parent:0`.
  - Today `createDraft` is never called, so this fails.
  - Replace the "shows success message" cases (:562, :617) with a navigation assertion. Keep the error and fallback-error cases.
  - Update the `beforeEach` default CPFP mock (`:87-90`, today `{ psbtBase64, effectiveFeeRate }` only) to a full
    response: `inputs`, `outputs`, `intentId`, `intentDigest`, `childFee`, `childFeeRate` (the `createDraft`
    default at `:83` already exists). Otherwise every remaining CPFP test silently takes the error path once `cpfpDraftRequest` needs
    those fields.
- `tests/components/TransactionActions/transactionActionsData.test.ts`: `cpfpDraftRequest` field mapping, and drop the `cpfpSuccessMessage` case.
- `server/tests/unit/api/bitcoin/bitcoin.transaction.contracts.ts:474`: the response carries `inputs`/`outputs`.
- `server/tests/unit/services/bitcoin/advancedTx/advancedTx.cpfp.contracts.ts`: the returned `inputs[0]` is `{parentTxid, resolvedVout, utxo.amount}` and `outputs[0].value === utxo.amount - childFee`.
- `server/tests/unit/api/openapi.core.contracts.ts` (~:450): assert `CpfpResponse.required` includes `inputs` and `outputs`.
- `tests/shared/bitcoinResponses.test.ts`:
  - the CPFP accept fixture at `:146-153` has no `inputs`/`outputs` and would now fail to parse; add them;
  - the CPFP case in the reject `it.each` at `:167` must stay a reject for its original reason (add valid
    `inputs`/`outputs` so it does not pass vacuously);
  - add reject cases for `inputs: []` and `outputs: []`, matching `.min(1)`.
- `tests/components/TransactionActions/ownership.test.tsx`:
  - the `beforeEach` default at `:96` resolves `createCPFPTransaction` with `{ effectiveFeeRate: 25 }` only; make
    it the same full response as above;
  - `:180-191` ("retires CPFP %s after unmount") resolves `createCPFPTransaction` with `{ effectiveFeeRate: 25 }`
    only; give it `inputs`/`outputs` (and the PSBT/intent fields) so `cpfpDraftRequest` can build the draft;
  - the deferred CPFP resolution at `:206` (`current.resolve({ effectiveFeeRate: 25 })`) needs the same fields,
    or the CPFP half of that test takes the error path;
  - `:193-211` ("old RBF finally cannot clear newer CPFP processing") asserts `state.success` contains `'25.00'`.
    With the fix CPFP also calls `createDraft`. The RBF draft is deferred through `deferBoundary('draft')`
    (`:78`, `mockReturnValueOnce`), so the CPFP draft resolves through the `beforeEach` default (`:95`); rewrite
    the end of the test to assert `navigate` to `/wallets/<id>/send` with the CPFP draft instead of the success
    text. Note `:23` uses a persistent `mockReturnValue` deferred for the first test only; do not rely on it;
  - add a stale-token case for CPFP modelled on the RBF test at `:14-47`: the reader leaves the route while the
    CPFP `createDraft` is pending, the draft then resolves, and there is no navigation and no `onActionComplete`;
  - add a CPFP twin of `:243-249` ("does not invoke completion if navigation synchronously retires the owner"):
    `navigate.mockImplementationOnce(unmount)`, run `handleCPFP`, assert `navigate` called once and `complete`
    not called. It covers the false arm of `if (actions.isCurrent(token)) onActionComplete?.()` after `navigate`
    (the RBF pattern at `useTransactionActions.ts:126`), which `handleCPFP` gains;
  - "keeps a new action busy when CPFP completion reenters the hook" (`:252-262`) relies on the full CPFP
    response default in `beforeEach` (`:96`); with the old `{ effectiveFeeRate: 25 }` default it would take the
    error path and never reach `complete`.

**Constraints**
- Server coverage gate: `cd server && npx vitest run --coverage tests/unit`.
- `npm run typecheck:app/tests/all` and `cd server && npm run typecheck:tests`.
- Rebuild `shared/dist` before server contract tests (memory: shared workspace build).
- Mutation pins: run `npm --prefix server run test:mutation:fee-policy` and confirm the `cpfp-package-fee-is-conserved` canary (60:20-60:40) is still `Killed`.
- `npm run verify:signer-inventory` must show no drift.
- `gateway/src/routes/proxy/whitelist.ts` has no CPFP route. The response change is additive for API clients.

**Acceptance**
- Accelerate lands on the send wizard review step with a saved, UTXO-locked draft whose PSBT is the server's child PSBT.
- The CPFP draft broadcasts once signed (covered by B12's route test: an all-own draft with
  `effectiveAmount = Σ outputs` is accepted).
- No success toast claims a CPFP that was never broadcast.
- Expected, not a defect: a resumed CPFP draft is shown as a `consolidation`, because its recipient is the
  wallet's own address (`getDraftTransactionType`, `SendTransactionPage/sendTransactionPageHelpers.ts:236-243`).
- Expected behaviour change: the saved draft locks the parent output, so a second Accelerate on the same parent is
  refused with `UTXO is locked by a pending draft` (`cpfp.ts:133-136`) until that draft is deleted or broadcast.
  Today repeated Accelerates succeed because nothing is saved.

---

### Phase C2 — Send review Change, recipient and totals from the built transaction (P2, `send-review--change-row-from-client-heuristic`)

**Finding / evidence**
- The Change row comes from `getReviewChangeAmount` (`src/components/send/steps/review/reviewStepData.ts:43-51`), which computes `selectedTotal - totalOutputAmount - estimatedFee`. `ReviewStep.tsx:104-106` computes it and passes it into `TransactionSummary`, which only renders the `changeAmount` prop (`TransactionSummary.tsx:233-240`).
  - Without coin control, `selectedTotal` is every spendable UTXO, while the server selects a subset (`createTransaction.ts:184-186` returns the real `changeAmount`).
- The flow preview on the same screen already uses `txData.changeAmount` (`reviewStepData.ts:241,267`), so the two contradict each other.
- `getTotalSendingSats` / `getTotalIncludingFeeSats` (`transactionSummaryModel.ts:27-53`) use `txData` only for `sendMax`. This is the iteration-3 A10 fix.
  - With `subtractFees`, Total Sending is the typed amount, and the recipient row (`TransactionSummary.tsx:176`, `getRecipientAmountText`) shows the typed amount. The built transaction pays `effectiveAmount` (`useSendTransactionActions.ts:76-88`, which puts it into `txData.outputs[0].amount`).
- With decoys, `txData.changeAmount` is 0 and change sits in `txData.decoyOutputs` (`createTransaction.ts:177-191`).
- **Status: reproduces.**

**Change (generalises A10; no change to the pre-build estimate path)**
- `getReviewChangeAmount(outputs, selectedTotal, totalOutputAmount, estimatedFee, txData?)`:
  - when `txData` is present, return `(txData.changeAmount ?? 0) + Σ (txData.decoyOutputs ?? [])[].amount`. The
    `?? 0` covers a `txData` of `{}` (no `changeAmount`), which would otherwise yield `NaN`; `TransactionSummary`
    hides a `NaN` today, so the guard keeps the row honest rather than relying on that;
  - otherwise keep the current heuristic.
  - `ReviewStep.tsx:104-106` passes `txData` (and adds it to the `useMemo` deps).
- `getTotalSendingSats(…, txData)` (**Decision (a)**, decided):
  - with `txData`, `txData.outputs?.length` and **no** output flagged `sendMax`, return `Σ txData.outputs[].amount`;
  - otherwise with `txData`: for `sendMax`, `txData.totalInput - txData.fee - change`, where `change` is the same
    `changeAmount + Σ decoys` (the A10 rule); for non-MAX sends without built outputs keep `totalOutputAmount`.
    A resumed `sendMax` draft stores its MAX output with `amount: 0` (`SendTransactionWizard/draftTransactionData.ts:30-31`,
    `hooks/send/useDraftManagement.ts:69-72`), so summing outputs there would show 0;
  - without `txData`, keep the current logic.
  - The existing assertions stay unchanged: `transactionSummaryModel.test.ts:46-49` (non-MAX with `txData` →
    5000) and `:63-66` (→ 5400), plus the A10 `sendMax` cases.
- **Resumed drafts lose decoy change.** `buildDraftTxData` (`SendTransactionPage/sendTransactionPageHelpers.ts:146-160`)
  returns a `DraftTransactionData` (`SendTransactionWizard/types.ts:5-17`), which has no `outputs` or
  `decoyOutputs`. The review's `txData` for a resumed draft is built by `createDraftInitialTxData`
  (`SendTransactionWizard/draftTransactionData.ts:40-72`): it rebuilds `outputs` from `state.outputs` and drops
  `decoyOutputs`. So:
  - add `decoyOutputs?: { address: string; amount: number }[]` to `DraftTransactionData`;
  - `buildDraftTxData` maps `DraftTransaction.decoyOutputs` (`src/api/drafts.ts:62`; `:120` is the request type) into it;
  - `createDraftInitialTxData` copies `draftTxData.decoyOutputs` into the returned `TransactionData`.
  - `outputs` needs no new mapping: `createDraftInitialTxData` already rebuilds them from `state.outputs`.
- `getTotalIncludingFeeSats`: with `txData`, `getTotalSendingSats(...) + networkFee`.
- Add `getRecipientDisplayAmount(output, index, outputCount, txData)`: for a `sendMax` row, return `MAX` (its stored
  amount may be 0). Otherwise, when `txData?.outputs?.length === outputCount` and the addresses match at `index`, use
  `txData.outputs[index].amount`; else the typed amount. `TransactionSummary` passes `state.outputs.length` as
  `outputCount` and uses the result for the label and the `FiatDisplay`.
- `buildReviewFlowData` already prefers `txData`. Leave it unchanged.

**Test first**
- `tests/components/send/steps/review/transactionSummaryModel.test.ts`:
  - `subtractFees`: typed 100000, `txData.outputs[0].amount` 99800, fee 200. Expect Total Sending 99800 and total including fee 100000. Today it gives 100000 and 100200, so it fails.
  - Decoys: `changeAmount` 0, `decoyOutputs` [3000, 4000]. Expect the change helper to give 7000.
  - `txData` of `{}` (no `changeAmount`, no `decoyOutputs`): the change helper gives 0, not `NaN`.
  - Direct unit cases for `getRecipientDisplayAmount(output, index, outputCount, txData)`, one per outcome: a
    `sendMax` row → `MAX`; `outputCount` equal to `txData.outputs.length` and matching address at `index` → the
    built `txData.outputs[index].amount`; `outputCount` differing from `txData.outputs.length` → the typed amount;
    equal counts but a different address at `index` → the typed amount.
- New `tests/components/send/steps/review/reviewStepData.test.ts`: `getReviewChangeAmount` with `selectedTotal` 1,000,000 and `txData.changeAmount` 50000 expects 50000. Today it gives ~899,800.
- `tests/components/send/TransactionSummary.test.tsx`: the recipient row shows the effective amount under `subtractFees`, and the totals use the built outputs. Only recipient-row and total assertions go here: `TransactionSummary` renders whatever `changeAmount` prop it is given (`TransactionSummary.tsx:233-240`), so a Change-row assertion there cannot fail first.
- `tests/components/send/ReviewStep.branches.test.tsx` (the Change-row fail-first): that file mocks `TransactionSummary` (`:40-45`) and captures its props in `capture.summaryProps`, so no Change row is rendered. Render `ReviewStep` with a `txData.changeAmount` that differs from the heuristic (`selectedTotal - totalOutputAmount - estimatedFee`, computed at `ReviewStep.tsx:104-106`) and assert `capture.summaryProps.changeAmount === txData.changeAmount`. At base `ReviewStep` passes the heuristic value, so it fails.
- `tests/components/send/draftTransactionData.test.ts`:
  - `buildDraftTxData` maps `decoyOutputs` from the draft, and `createDraftInitialTxData` (the `describe` at
    `:38`) carries them into the returned `TransactionData`. It fails today because neither does;
  - resumed-`sendMax` non-regression case: a draft whose MAX output has `amount: 0` goes through
    `createDraftInitialTxData`, and the summary model shows Total Sending `totalInput - fee - change` (not 0) and
    the recipient row shows `MAX`.

**Constraints**
- Frontend 100% coverage on `reviewStepData.ts`, `transactionSummaryModel.ts`, `TransactionSummary.tsx`,
  `sendTransactionPageHelpers.ts` and `SendTransactionWizard/draftTransactionData.ts`.
- No server change and no e2e impact. The review step is not reached in any spec.
- `src/components/send/**` is a wallet-safety critical path, so verify-vectors runs (see the Group C gating facts).

**Acceptance**
- Once `txData` exists, every amount on the summary card equals the flow preview and the PSBT, including for a
  resumed draft with decoys. A resumed `sendMax` draft shows `MAX` and a non-zero Total Sending.
- Before the build, the estimate path is unchanged, and non-MAX sends without built outputs still show the typed
  total.

---

### Phase C3 — Import wallet: no "Connected" without a lease after Back (P2, `import-wallet--stale-connected-after-back`)

**Finding / evidence**
- `useHardwareImportActions.ts:75-77` releases the lease on unmount, and `connectionRef` is reset (:66). `deviceConnected`, `deviceLabel` and `xpubData` live in the parent `useImportState` and survive.
- `handleBack` (`useImportWalletActions.ts:63-76`) resets hardware state only when leaving step 2 (`state.step === 2` is the pre-update value).
- Going from step 3 back to 2 remounts `HardwareImport` with `deviceConnected=true` and `ConnectedHardwareOptions` visible (`HardwareImport.tsx:123`). The first script or account change clears `xpubData` (:100-112), and Fetch then throws "Connect a hardware device before fetching its xpub" (:178).
- **Status: reproduces.**

**Change**
1. `handleBack`: reset when `state.step === 2 || (state.step === 3 && state.format === 'hardware')`, by calling `state.resetHardwareState()` (`src/components/ImportWallet/hooks/useImportState.ts:154-159`). The device type and model selection are kept.
2. Defence in depth: the unmount/owner-change cleanup in `useHardwareImportActions.ts:75-77` also calls `setDeviceConnected(false)` and `setDeviceLabel(null)`. It does **not** clear `xpubData`, because step 3/4 still need it after 2→3. This way any unmount that drops the lease also drops "Connected".

**Test first**
- `tests/components/ImportWallet/importOwnership.test.tsx` (234 lines): hardware format, step 3, `deviceConnected=true`, `xpubData` set → `handleBack()` → expect `deviceConnected=false` and `xpubData=null`. It fails today.
- `tests/components/ImportWallet/HardwareImport.test.tsx` (877; at most about 40 lines): connect, then
  `props.setDeviceConnected.mockClear()` and `props.setDeviceLabel.mockClear()`, then `unmount()`, then expect
  `setDeviceConnected` called with `false` and `setDeviceLabel` with `null` after `releaseConnection` (or use
  `toHaveBeenLastCalledWith(false)`). Without the `mockClear`, the assertion passes at base: `handleConnect`
  already calls `setDeviceConnected(false)`/`setDeviceLabel(null)` at the start of every connect
  (`src/components/ImportWallet/steps/useHardwareImportActions.ts:126-127`).
- `tests/components/ImportWallet/ImportWallet.logic.test.tsx` (478): a hardware-format Back from step 3 calls
  `resetHardwareState`, covering the new `state.step === 3 && state.format === 'hardware'` branch of `handleBack`;
  a non-hardware Back from step 3 does not.

**Constraints**
- Coverage stays at 100% for both hooks.
- The QR path is unchanged.
- No e2e: `import-wallet-flow.spec.ts` does not use hardware.

**Acceptance**
- After Back, the hardware step shows Connect, and reconnecting and fetching works.
- Next from 2→3 still imports with the fetched xpub.

---

### Phase C4 — Agent form: inline operational import only when the importer is the target user (P2, `agent-form--inline-operational-import-dead-end`)

**Finding / evidence**
- `InlineOperationalWalletImport.tsx` imports through `walletsApi.importWallet`, so the importing admin owns the wallet.
- `handleOperationalWalletImported` (`AgentFormModal.tsx:90-93`) sets `operationalWalletId`. Then `getOperationalWallets` → `isOperationalWallet` → `walletMatchesUser(wallet, form.userId)` (`formOptions.ts:19-41`) filters it out, and the reconcile effect (:69-78, `formOptions.ts:117-129`) clears the selection.
- The server enforces the same rule: `assertTargetUserWalletAccess` (`adminAgentService.ts:106-121`) requires `walletRepository.hasAccess(operationalWalletId, userId)`.
- Server APIs that could avoid the dead end:
  - `POST /wallets/:id/share/user` (`src/api/wallets.ts:247`) would grant the target user access to an admin-owned wallet. That leaves the agent's spend wallet owned by the admin, which changes the ownership model, and needs a role decision.
  - There is no "import on behalf of" API.
- **Status: reproduces.**

**Change (Decision: block, the smallest correct option)**
- `src/components/AgentManagement/index.tsx` reads `useCurrentUser()` (`src/contexts/UserContext.tsx:141`) and passes `currentUserId` to `AgentFormModal`, then to `CreateAgentWizardFields` (`AgentManagement/AgentFormSections.tsx:91`). `currentUserId` stops there; it is **not** threaded into the import component.
  - `currentUserId: string | undefined` is a **required** prop on `AgentFormModal` and `CreateAgentWizardFields`
    (not optional), so a missed call site is a type error rather than a silently enabled import.
- **Decided: the wizard computes the reason.** `CreateAgentWizardFields` has `form.userId` and `userOptions`, so it
  computes `disabledReason: string | null`: when `form.userId && form.userId !== currentUserId`, the text "Only
  <user> can import their operational wallet. Ask them to import it, or select yourself as the agent user." (copy
  reviewed; `<user>` is the `userOptions` label for `form.userId`, i.e. `userOptions.find(o => o.value === form.userId)?.label ?? 'the selected user'`, so a `form.userId` missing from `userOptions` reads "Only the selected user can import …"), otherwise `null`. It passes it through
  `AgentWalletStep` to `InlineOperationalWalletImport` (render at `AgentFormSections.tsx:219-223`).
- `InlineOperationalWalletImport` gains a **required** prop `disabledReason: string | null` (props type at
  `InlineOperationalWalletImport.tsx:16-20`). When it is non-null:
  - render the inline import disabled and show `disabledReason`;
  - keep the existing `FullImportPageLink` hint.
- When the target is the importer, behaviour is unchanged.
- Sharing is rejected: an admin-owned operational wallet would put a funds-holding wallet in the admin's list, and the server's role semantics for agents are not designed for it.

**Test first**
- `tests/components/AgentManagement.test.tsx` (680): the mocked current user defaults to `{ id: 'user-1' }`, which
  is the user the existing inline-import tests already target (`AgentManagement.test.tsx:444`, `:482`), so they
  stay green unchanged. The new disabled case adds `'user-2'` to `options.users`, selects it as the agent user,
  and expects the inline import disabled with the reason. Do not introduce `'u-admin'`/`'u-other'` ids.
  - **Not vacuous at base.** Every mock wallet has `accessUserIds: ['user-1']` (`AgentManagement.test.tsx:103-121`),
    so with only `user-2` added there is no funding wallet for it and the import is already disabled by
    `disabled={!form.fundingWalletId}` (`AgentFormSections.tsx:219-223`). Add a wallet `{ id: 'funding-2', type:
    'multi_sig', accessUserIds: ['user-1', 'user-2'], … }` to `options.wallets` (both users, so the enabled
    companion below uses the identical wallet), select it as the funding wallet, and only
    then assert. Two companions show the disabled state can only come from `disabledReason`, neither of which
    can break after the fix:
    - **Manual base-SHA check (recorded in the PR, not committed).** Run the new disabled case against
      f2c7e217 (e.g. the test file copied onto a detached f2c7e217 worktree) and confirm it fails on the
      disabled expectation, i.e. the Import control is **enabled** at base for exactly that `user-2` +
      `funding-2` setup. Record the command, the base SHA and the failing assertion in the PR body. No committed
      test asserts base behaviour.
    - **Committed enabled companion.** A second case with the same funding-wallet setup (`funding-2` added to
      `options.wallets` and selected as the funding wallet) but with
      `form.userId === currentUserId` (`'user-1'`, the mocked current user) expects the Import control
      **enabled** and no reason text. It passes before and after the fix.
  - `useCurrentUser` throws without a provider (`src/contexts/UserContext.tsx:123-126`), so the `UserContext`
    mock (`vi.mock('…/src/contexts/UserContext', …)`) is required in **both** `tests/components/AgentManagement.test.tsx`
    and `tests/components/AgentManagement/createOwnership.test.tsx`, which render `index.tsx`. Check
    `AgentManagement.extracted.branches.test.tsx` too and mock it there only if it renders `index.tsx`.
  - At f2c7e217 the import is enabled, so the test fails.
- `tests/components/AgentManagement.inlineOperationalWalletImport.branches.test.tsx`: render-only coverage of the
  prop, no reason computation. `renderImport` (`:23-31`) passes an explicit `disabledReason` (an
  `overrides.disabledReason` defaulting to `null`), because the prop is required; the direct render at `:89-93`
  ("describes imports when no funding wallet network is selected") also passes `disabledReason={null}`. Add one
  case: a non-null `disabledReason` renders the import disabled with that text; `null` renders it enabled.
- `tests/components/AgentManagement.extracted.branches.test.tsx`: the `AgentFormModal` renders at `:376`, `:396`
  and `:436` pass `currentUserId="user-1"` (required prop). The disabled-reason **computation** branch is tested
  here, at the `AgentFormModal`/`CreateAgentWizardFields` level: with `form.userId` set to a user other than
  `currentUserId`, the wallet step shows the reason naming that user's label and the import is disabled; with
  `form.userId === currentUserId` (or no `form.userId`) no reason is shown. Same non-vacuity rule: set
  `fundingWalletId` in the form (e.g. `form.userId: 'user-2'` with the fixture's `funding-2`, which has
  `accessUserIds: ['user-2']`, `AgentManagement.extracted.branches.test.tsx:90-97`), so `disabled={!form.fundingWalletId}`
  is false and the disabled state comes only from `disabledReason`.
  - **Label fallback case (100% branch gate).** In create mode `form.userId` can only come from the user
    `<select>` (`createInitialAgentForm` gives `''`, `AgentFormModal.tsx:44`; edit mode renders
    `EditAgentFormFields` with no inline import), so reach the "id absent from `userOptions`" state by re-rendering:
    (1) render create mode with `options` containing `user-2` and `funding-2`; (2) select `user-2`, then `funding-2`
    on the wallet step; (3) `rerender` the same `<MemoryRouter><AgentFormModal …/></MemoryRouter>` with
    `options.users` filtered to drop `user-2` while keeping `funding-2` in `options.wallets` (so the reconcile effect
    keeps it selected); (4) expect the reason "Only the selected user can import their operational wallet. …" and
    the import disabled. This covers the `?.`/`??` fallback arm.
- **E2E rewrite, `tests/e2e/admin-operations.spec.ts:209-327` (updated for new behaviour, not fail-first).** At
  f2c7e217 the current spec passes (the admin imports inline; the mocked imported wallet spreads
  `AGENT_MANAGEMENT_OPTIONS.wallets[1]`, so it inherits `accessUserIds: ['user-ops-regular']`, a state the real
  server never produces). After C4 its Import click times out. The rewrite keeps `user-ops-regular` and the
  link-and-land flow; its selection steps pass at base and after, and its disabled-reason assertion passes only
  after C4. The fail-first evidence for C4 is the unit tests above, not this spec.
  - **Selectable, verified.** `wallet-agent-operational` (`adminOperationsFixtures.ts:47-54`) is `single_sig`,
    `testnet3` (same as `wallet-agent-funding`), `accessUserIds: ['user-ops-regular']` and not the funding wallet,
    so `isOperationalWallet` (`formOptions.ts:30-41`) keeps it for `user-ops-regular` after `wallet-agent-funding`
    is selected. It is already in the default `GET /admin/agents/options` (`adminOperationsApiState.ts:158`,
    `AGENT_MANAGEMENT_OPTIONS.wallets`). The user label is `viewer` (`toUserOptions` uses `username`;
    `REGULAR_USER.username`).
  - **Test changes:**
    - Rename to "wallet agent setup selects an existing operational wallet and lands on agent wallet dashboard".
    - Delete `importedOperationalWallet` and `optionsWithImportedOperational`, and the `"GET /admin/agents/options"`,
      `"POST /wallets/import/validate"` and `"POST /wallets/import"` overrides (the defaults serve the options; the
      import endpoints are no longer called, and no unhandled request is added).
    - `createdAgent`: drop the `operationalWalletId`/`operationalWallet` overrides so it keeps
      `WALLET_AGENTS[0]`'s `wallet-agent-operational` ("Agent Operating Wallet"); keep `id`, `name`,
      `signerDeviceId: null`, `signerDevice: null`, `apiKeys: []`. `createdDashboardRow` is unchanged in shape.
      Keep the `"POST /admin/agents"` and `"GET /admin/agents/dashboard"` overrides.
    - After `selects.nth(0).selectOption("wallet-agent-funding")` on the wallet step: assert
      `main.getByRole("button", { name: "Import" })` is disabled and
      `main.getByText(/Only viewer can import their operational wallet/)` is visible; keep the
      "Open full import page" href assertion.
    - Replace the Import / fill / "Import and select" / "Imported and selected" steps with
      `selects.nth(1).selectOption("wallet-agent-operational")` (wallet step order: funding, operational, signer;
      `AgentWalletStep`, `AgentFormSections.tsx:204-232`).
    - Capture the create request (`page.waitForRequest(r => r.method() === "POST" && r.url().endsWith("/admin/agents"))`)
      around the final "Add Agent Wallet" click and assert `postDataJSON().operationalWalletId === "wallet-agent-operational"`
      and `userId === "user-ops-regular"`.
    - Final href assertion: `toHaveAttribute("href", /wallet-agent-operational$/)` (anchored, so it cannot match
      the old `-inline` id). `expect(unhandledRequests).toEqual([])` stays.
  - No change to `adminOperationsFixtures.ts`, `adminOperationsApiState.ts` or `adminOperationsApiMock.ts`.

**Constraints**
- 100% coverage.
- No server change and no new endpoint. One e2e spec changes (`admin-operations.spec.ts:209-327`, above); no mock
  map changes.

**Acceptance**
- An admin can no longer create an admin-owned operational wallet that is then silently dropped from the form.
- The PR body records the manual f2c7e217 run of the new disabled case (command, SHA, failing assertion).

---

### Phase C5 — Draft save records every signed device (P2, `draft-save--signed-devices-first-only`)

**Finding / evidence**
- `getFirstSignedDeviceId` (`src/hooks/send/useDraftManagement.ts:116-119`) is used by `buildSignedDraftUpdate` (:130-140, the existing-draft path) and by `saveSignedStateForNewDraft` (:167-184). Each sends one `signedDeviceId` with the combined PSBT.
- The server's `updateDraft` (`server/src/services/draftUpdate.ts:188-240`) validates one id (`normalizeAndAssertSignedDeviceBelongsToWallet`, `draftSigning.ts:6-27`, which rejects non-wallet ids). `addSignedDeviceIfNeeded` (:97-108) appends it idempotently under optimistic retry. `UpdateDraftRequest` takes one `signedDeviceId` (`src/api/drafts.ts:138-144`).
- On resume, `signedDevices: draftData.signedDeviceIds` (`sendTransactionPageHelpers.ts:179`).
- `useQrSigning.ts:76` can add the sentinel `'psbt-signed'`, which is not a device id. If it is the first entry, the server returns 400 today.
- **Status: reproduces.**

**Change (Decision: one idempotent PATCH per device, no server change)**
- Replace `getFirstSignedDeviceId` with `getDraftSignedDeviceIds(signedDevices)`. It returns every entry except the `'psbt-signed'` sentinel, in insertion order. Export the sentinel as a named constant from `useQrSigning.ts` and reuse it in `reviewStepData.ts:93` and `UsbSigning.tsx:139`.
- Both paths:
  - send PATCH #1 with `signedPsbtBase64` and the first id;
  - then send one PATCH `{ signedDeviceId }` per remaining id, sequentially, checking `lease.isCurrent()` and passing `lease.signal` between calls.
  - **Decided: one shared helper.** The remaining-device PATCH loop is a single helper (for example
    `patchRemainingSignedDevices(draftId, remainingIds, lease)`) that takes the lease and is called by both
    `saveSignedStateForNewDraft` and `updateExistingDraft`, so one stale-lease test covers its stale branch for
    both paths.
  - `updateExistingDraft` (`useDraftManagement.ts:142-157`) receives only `signal` today. Pass it the lease
    itself (or `{ signal, isCurrent }`), so the existing-draft path can stop between PATCHes when the lease goes
    stale.
  - The server is idempotent, so a retry after a partial failure converges.
- **QR upload path.** `useQrSigning.ts:250-263` `persistUploadedSignatureToDraft` sends `signedDeviceId:
  effectiveDeviceId`, which is the `'psbt-signed'` sentinel for an unattributed upload. The server rejects it
  (`draftSigning.ts:21-23`, `signedDeviceId must belong to the wallet`) and the client swallows the 400 as a
  warning (`:265-266`), so the uploaded signed PSBT is never persisted. Omit `signedDeviceId` from that PATCH when
  it equals the sentinel constant; still send `signedPsbtBase64`.
- Rejected alternative: add `signedDeviceIds: string[]` to the shared `UpdateDraftRequestSchema`. It is atomic, but touches the shared schema, OpenAPI, the server service and the gateway/mobile draft contracts, for at most m−1 extra requests.

**Test first**
- `tests/hooks/useDraftManagement.test.tsx` (598):
  - new draft with `signedDevices = new Set(['dev-A','dev-B'])` → `updateDraft` is called twice, the second time with `{ signedDeviceId: 'dev-B' }`;
  - existing draft, same expectation;
  - `new Set(['psbt-signed'])` → no `signedDeviceId` is ever sent, and the PSBT is still saved;
  - the lease goes stale between calls → no further PATCH (one case suffices, because both paths share the loop
    helper).
  - At f2c7e217 only one call is made, so these fail.
- `tests/hooks/useQrSigning.test.tsx`: the assertion at `:337-341` expects `updateDraft` with
  `signedDeviceId: 'psbt-signed'`; change it to expect `{ signedPsbtBase64 }` with no `signedDeviceId` (fails at
  base). Keep a case where a real device id is still sent.

**Constraints**
- 100% coverage.
- E2E: no spec creates or patches drafts, so the additional `PATCH …/drafts/:id` calls reach no e2e mock map. No new endpoint.

**Acceptance**
- A draft saved after two cosigner signatures resumes with both devices marked as signed, and DraftList shows "2 signed".
- An unattributed QR/file upload persists the signed PSBT to the draft instead of failing with a swallowed 400.

---

### Phase C6 — Mycelium animation: hard cap on nodes, branches and tips (P2, `mycelium-animation--unbounded-node-growth`)

**Finding / evidence**
- In `src/components/animations/myceliumNetwork.ts:322-324`, the `> 100` check only makes tips survive with probability 0.99 per frame.
- New tips still spawn at :331-342 (the `< 20` branch cap at :307) and when `< 5` tips exist.
- `addNode` (:106-130) appends one node and one branch every time. Nothing is ever removed, and the arrays reset only in `initializeNetwork` (:73-104) on resize.
- Per-frame drawing is O(nodes + branches).
- **Status: reproduces.**

**Change**
- Move the per-frame growth step into a pure, exported `advanceMyceliumGrowth(state, { width, height }, random)` in a new `src/components/animations/myceliumNetwork/model.ts`, together with `addNode`, `MYCELIUM_MAX_NODES = 150` and `MYCELIUM_MAX_TIPS = 20`. The hook calls it. This also reduces the nested-function complexity lizard counts.
  - It goes in a subdirectory, as `bunnyMeadow/` and `ducklingParade/` do, because
    `tests/components/AnimatedBackground.test.tsx:31` globs every top-level `animations/*.ts` and requires each to
    map to an `ANIMATED_PATTERNS` entry; a top-level `myceliumNetworkModel.ts` would fail that test.
- At the cap:
  - `addNode` is not called and the tip retires;
  - the `< 5`-tips respawn is gated on `nodes.length < MAX_NODES`.
- Branches are therefore at most `MAX_NODES - seedCount`, and pulses stay bounded per branch.
- Recycling (fade, then `initializeNetwork`) is a reviewer decision. The default is a static hard cap, with pulses keeping the network visibly alive.

**Test first**
- New `tests/components/animations/myceliumNetwork/model.test.ts`: on a large canvas (`{ width: 2000, height: 2000 }`, so growth is not limited by the bounds before the cap is reached), seed with a deterministic LCG `random`, step 50,000 frames, then assert `nodes.length <= 150`, `branches.length <= 150` and `tips.length <= 20`.
  - Against the current logic, extracted unchanged first, nodes exceed 150, so the test fails. The commit order is "extract unchanged + test (red)", then "cap (green)".

**Constraints**
- Coverage-excluded path. `coveragePolicy.test.ts:121-152` stays green: do not touch the exclude list or the `AnimatedBackground` registry test.
- Run `bash scripts/quality/lizard-only.sh` (lizard anchor: keep a named `function` inside any new `describe`).

**Acceptance**
- Memory and frame cost stay flat over a long session.
- The visual starts the same.

---

### Phase C7 — `error-recovery.spec.ts` asserts real outcomes (P2, `e2e-error-recovery--assertions-pass-on-any-render`)

**Finding / evidence**
- `tests/e2e/error-recovery.spec.ts` has twelve tests (two 401 tests at :328 and :337). Seven assert only `getByRole('main')` visible (:356, :367, :381, :392, :444, :477/485, :507/514), and the UTXO failure test (:415) asserts only `main` after opening the UTXOs tab (:427).
- `:394` `not.toHaveText('Application error')` is a full-text match on `body`, so it can never fail. The app's crash text is `ErrorBoundary.tsx:57` "Something went wrong".
- `:473` collects `unhandledRequests` but never asserts it, and the other tests do not collect it at all.
- Product gaps found while choosing real assertions:
  - **Wallet list 500.** `useWalletListData.ts:26` ignores `isError`, so `WalletList.tsx:35-42` renders the "no wallets, create one" empty state.
  - **Feature flags 500.** `FeatureFlags/index.tsx:34,46-51` drops the `runLoad` error, so the page renders an empty list.
- The related specs (accessibility, admin-operations, send-transaction-flow, create-wallet-flow) have no remaining `isVisible(`, `.catch(() => false)` or `toBeGreaterThanOrEqual(0)` patterns (grep at f2c7e217, after iteration-3 C5). Any remaining weakness is softer; leave it as P3 backlog.
- **Status: reproduces.**

**Change**
- `mockErrorApi` callers keep the returned array, and every test ends with `expect(unhandledRequests).toEqual([])`. The recovery test passes `unhandledRequests` into `createApiRouteHandler`.
- **Retry budget (applies to every case below).** The failure mocks answer every retry with the same failure
  (`maybeFulfillFailure`, `error-recovery.spec.ts:86-104`), and the API client retries GETs on 500 and network
  errors (`RETRYABLE_STATUS_CODES` includes 500, `src/api/client.ts:74`; `DEFAULT_MAX_RETRIES = 3`,
  `src/api/retryPolicy.ts:1`; delays 1000/2000/4000 ms from `client.ts:65-67`, `:216-219`, with ±10% jitter via
  `sleepWithJitter` at `:227`). A failed GET therefore reaches its error state after about 7–7.7 s, and the wallet
  list (react-query `retry: 1`, `src/providers/QueryProvider.tsx:13`, which repeats the whole client retry
  chain) after about 14–16.5 s. Playwright's default `expect` timeout is 5 s, so every assertion that waits for
  a post-failure state passes an explicit `timeout`: `>= 15_000` ms for wallet detail, feature flags, and the
  Transactions and UTXOs tabs; `>= 25_000` ms for the wallet list.
- Assertions per case:
  - 500 wallet detail: heading "Failed to Load Wallet" (`WalletDetailStates.tsx:23`), with
    `{ timeout: 15_000 }`.
  - Timeout on `bitcoin/status` or `price`: a dashboard content marker that does not depend on the failed call is visible, and `page.getByText('Something went wrong')` has count 0. This replaces :394.
  - Transaction list failure: the Transactions tab content shows the specific error or empty copy (pin the exact text), with `{ timeout: 15_000 }`.
  - UTXO fetch failure: after opening the UTXOs tab, assert the tab's specific error or empty copy (pin the exact text), not just `main`, with `{ timeout: 15_000 }`.
  - Settings save failure: the mock body's message today is `'Failed to save settings'` (:449), which is also a plausible generic fallback, so it does not prove the server error is surfaced. Use a distinctive mock message (for example `'Settings store unavailable (e2e)'`) and assert the text `SaveFeedback` actually renders from `displayError` (`Variables/SaveFeedback.tsx:18-21`). `waitForRequest('PUT …/admin/settings')` proves the save was attempted.
  - Refresh recovery: before the reload, `page.getByTestId('price-change-24h')` contains `---`; after it,
    `page.getByTestId('telemetry-price')` shows `95,000` (the mocked 95000 USD). `BitcoinPriceCard` has no
    "unavailable" text (`src/components/Dashboard/BitcoinPriceCard.tsx:28`, `:32`).
  - 500 wallet list: the test calls `test.setTimeout(45_000)`. It waits for the error state with Retry **first**
    (`{ timeout: 25_000 }`), and only then asserts the empty-state "Create" CTA has count 0 (a count-0 check made
    before the error state renders would pass trivially). This **requires the product fix**: `useWalletListData` exposes `isError`/`refetch`, and `WalletList` renders an `ErrorAlert` plus Retry before the empty-state check. Gate the error state on `isError && !data`, where `data` is the **raw** query result, not the `wallets` value with its `= []` default (`useWalletListData.ts:26`, `const { data: wallets = [] … } = useWallets()`): the defaulted `[]` is truthy and would never show the error. Expose the raw `data` (or a derived `hasData`) from the hook for this check. A failed background refetch must not hide a list that is already populated. Unit-test both (error with no data → error state; error with cached data → list). Retry calls the hook's `refetch` (or `onClick={refetch}` directly); `WalletList.branches.test.tsx` adds a case that clicks Retry and asserts the mocked `useWallets().refetch` (the `useWallets` mock at `:44-45`, return value set at `:193`) was called, for the 100% functions gate (`config/tooling/vitest.config.ts:86`).
  - Feature flags 500: an error banner, asserted with `{ timeout: 15_000 }`. This **requires the product fix**: destructure `error: loadError` from `runLoad` and render `ErrorAlert` with the fixed text "Failed to load feature flags". The raw error message is not rendered, only that fixed banner text.
- Default: include both small product fixes in this PR, with unit tests in `tests/components/WalletList.branches.test.tsx` and `tests/components/FeatureFlags.test.tsx` for 100% coverage. Reviewer alternative: file them as new findings and mark those two cases `test.fixme` with the finding id.
  - Existing test to update: `tests/components/FeatureFlags.test.tsx:202-213` ("renders shell when initial feature flag fetch fails") asserts the raw `'Initial load failed'` is **not** shown. Rewrite it to also assert the "Failed to load feature flags" banner is shown; keep its `queryByText('Initial load failed')` not-shown assertion, which stays valid because the banner uses fixed text.

**Test first**
- Against f2c7e217 `dist/`:
  - the wallet-list and feature-flags tests fail;
  - temporarily throwing in the wallet-detail error path, or removing `SaveFeedback`'s error branch, makes the matching new assertion fail where the old spec passed.
- Run per CLAUDE.md: `npm run build`, then serve `dist/` statically, then `npx playwright test -c <scratch config without webServer> tests/e2e/error-recovery.spec.ts`.

**Constraints**
- No new endpoints: mock maps are unchanged. If `unhandledRequests` now exposes a missing mock in this spec, add it to this spec's map only.
- PNG baselines are unaffected.
- E2E and browser-smoke lanes run.
- No assertion that waits for a post-failure state relies on Playwright's 5 s default `expect` timeout (retry
  budget above); the wallet-list case sets `test.setTimeout(45_000)`.

**Acceptance**
- Each test fails when its error handling regresses.
- `unhandledRequests` is empty in all twelve tests.
- The spec passes without timeouts from the client retry chain: every post-failure assertion carries its explicit
  timeout.

### Files touched (Group C)
- C1: `src/components/TransactionActions/{useTransactionActions.ts,transactionActionsData.ts,TransactionActionsPanel.tsx,types.ts}`, `src/api/bitcoin.ts`, `shared/schemas/bitcoinResponses.ts`, `server/src/api/bitcoin/transactions.ts`, `server/src/services/bitcoin/advancedTx/cpfp.ts` (below line 78 only), `server/src/api/openapi/schemas/bitcoin.ts`; tests `tests/components/TransactionActions.test.tsx`, `tests/components/TransactionActions/transactionActionsData.test.ts`, `server/tests/unit/api/bitcoin/bitcoin.transaction.contracts.ts`, `server/tests/unit/services/bitcoin/advancedTx/advancedTx.cpfp.contracts.ts`, `server/tests/unit/api/openapi.core.contracts.ts`, `tests/shared/bitcoinResponses.test.ts`, `tests/components/TransactionActions/ownership.test.tsx`
- C2: `src/components/send/steps/review/{reviewStepData.ts,transactionSummaryModel.ts,TransactionSummary.tsx}`, `src/components/send/steps/ReviewStep.tsx`, `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts` (`buildDraftTxData`), `src/components/send/SendTransactionWizard/{types.ts,draftTransactionData.ts}` (`DraftTransactionData.decoyOutputs`, `createDraftInitialTxData`); tests `tests/components/send/draftTransactionData.test.ts`, `tests/components/send/steps/review/transactionSummaryModel.test.ts`, (new) `tests/components/send/steps/review/reviewStepData.test.ts`, `tests/components/send/TransactionSummary.test.tsx`, `tests/components/send/ReviewStep.branches.test.tsx`
- C3: `src/components/ImportWallet/useImportWalletActions.ts`, `src/components/ImportWallet/steps/useHardwareImportActions.ts`; tests `tests/components/ImportWallet/importOwnership.test.tsx`, `tests/components/ImportWallet/HardwareImport.test.tsx`, `tests/components/ImportWallet/ImportWallet.logic.test.tsx`
- C4: `src/components/AgentManagement/index.tsx`, `src/components/AgentManagement/AgentManagement/{AgentFormModal.tsx,AgentFormSections.tsx,InlineOperationalWalletImport.tsx}`; tests `tests/components/AgentManagement.test.tsx` (disabled case plus the committed `form.userId === currentUserId` enabled companion; the base-SHA check is a manual PR-body step, not committed), `tests/components/AgentManagement/createOwnership.test.tsx` (UserContext mock), `tests/components/AgentManagement.inlineOperationalWalletImport.branches.test.tsx` (required `disabledReason` prop in `renderImport` and the direct render at `:89-93`; render-only), `tests/components/AgentManagement.extracted.branches.test.tsx` (required `currentUserId`; disabled-reason computation branch; label-fallback case), `tests/e2e/admin-operations.spec.ts` (`:209-327` rewritten to select `wallet-agent-operational` and assert the disabled reason; fixtures/api state/mock unchanged)
- C5: `src/hooks/send/useDraftManagement.ts`, `src/hooks/send/useQrSigning.ts` (sentinel constant and `persistUploadedSignatureToDraft`), `src/components/send/steps/review/{reviewStepData.ts,UsbSigning.tsx}`; tests `tests/hooks/useDraftManagement.test.tsx`, `tests/hooks/useQrSigning.test.tsx`
- C6: `src/components/animations/myceliumNetwork.ts`, (new) `src/components/animations/myceliumNetwork/model.ts`; (new) `tests/components/animations/myceliumNetwork/model.test.ts`
- C7: `tests/e2e/error-recovery.spec.ts`, `src/components/WalletList/{useWalletListData.ts,WalletList.tsx}`, `src/components/FeatureFlags/index.tsx`; tests `tests/components/WalletList.branches.test.tsx`, `tests/components/FeatureFlags.test.tsx`

---

## Group D — PR D — CI/ops/install

### Cross-cutting gating facts (Group D)

- **Shell tests.** These are not under the js/ts large-file gate.
  - `tests/install/unit/offline-bundle-script.test.sh` is 1,194 lines and already registered for lifecycle (`config/resource-lifecycle-callsites.json`, see D7 of iteration 3). Any new `rm -rf` must be in the same file or be registered. Run `node scripts/ownership/check-lifecycle-callsites.mjs` after `git add`.
  - A new `tests/ci/*.test.sh` needs the `bash -n` list (`.github/workflows/quality.yml` ~:763), the execution list (~:901), and `tests/ci/ci-registration-completeness.test.sh` green.
- **Lanes.** `scripts/offline/**`, `scripts/create-upgrade-backup.sh` and `install.sh` trigger install-test. `scripts/ci/classify-files-lib.sh` triggers full scan. `scripts/check-wallet-sync-lifecycle-contract.mjs` triggers the Architecture lane, which is not PR-required, so run its test locally.
- The README is generated from `scripts/templates/README.template.md`. No Group D phase needs a README change; `grep` found no `allow-downgrade` or `install-offline` mention in the template.

---

### Phase D1 — Offline bundle tools run in the extracted-bundle layout (P1, `offline-bundle--installer-sources-missing-ownership`)

**Finding / evidence (re-verified, with one extra missing file)**
- `scripts/offline/apply-bundle.sh:51-54` (`ensure_apply_lock`, reached on every `--apply`) sources `$SCRIPT_DIR/../ownership/{producer-hooks,deployment-lifecycle}.sh`, which is `<bundle>/ownership/`.
- `scripts/create-upgrade-backup.sh:15-17` sources `$SCRIPT_DIR/ownership/…`, which is `<bundle>/tools/ownership/`, at top level.
- `create-bundle.sh` `copy_bootstrap_tools` (:436-456) ships them only at `authority/scripts/ownership/`. Under `set -e`, both scripts abort in the bundle layout. `install-offline.sh` runs both from `$BUNDLE_DIR/tools/` (create-bundle.sh heredoc, around :596 and :611-613).
- The CI helpers already fall back to `../authority/scripts/ci` (`apply-bundle.sh:10-15`, `create-upgrade-backup.sh:18-23`).
- **Additionally:** `create-upgrade-backup.sh:482-487` execs `authority/scripts/ci/cleanup-ci-callsite.sh`, which runs `authority/scripts/ownership/ci-cleanup-coordinator.mjs:27`. That file statically imports `../ci/forward-live-annotations.mjs`, which `copy_bootstrap_tools` does not ship (:445-449), so the backup would fail even after the sourcing fix.
- The existing bundle-layout tests stub both tools (`offline-bundle-script.test.sh:1009-1032`, :1077-1098).
- **Status: reproduces.**

**Change**
- `apply-bundle.sh`: set `OWNERSHIP_DIR="$SCRIPT_DIR/../ownership"`, and if `[ ! -f "$OWNERSHIP_DIR/producer-hooks.sh" ]`, fall back to `$SCRIPT_DIR/../authority/scripts/ownership`. Source both files from `$OWNERSHIP_DIR`, keeping the `# shellcheck source=` directives.
- `create-upgrade-backup.sh`: same pattern, with `$SCRIPT_DIR/ownership` → `$SCRIPT_DIR/../authority/scripts/ownership`. The check must run before line 15.
- `create-bundle.sh:445-449`: add `scripts/ci/forward-live-annotations.mjs` to the authority CI copy list. Its own imports, `../ownership/canonical-json.mjs` and `../lib/is-main-module.mjs`, are already shipped.

**Test first** (`tests/install/unit/offline-bundle-script.test.sh`)
- `test_extracted_bundle_apply_runs_from_bundle_layout`: build an unsigned dev core-only bundle with `run_create_bundle` and the latest repo tag, skipping when there are no tags, as at :990-996. Extract it, then run the **real** `"$extracted/tools/apply-bundle.sh" --staged-dir "$extracted" --install-dir "$TEST_TMP_DIR/install" --apply --allow-unsigned-dev-bundle` with the fake docker and `SANCTUARY_RUNTIME_DIR`/`SANCTUARY_OWNERSHIP_ROOT`, as in `test_apply_accepts_signed_inventory_via_runtime_refs` (:652).
  - Expect status 0 and a `load` in the docker log.
  - Today it fails with `…/ownership/producer-hooks.sh: No such file`.
  - **Isolate the project lock.** This test does not go through `setup_inventory_bundle`, so set the isolation it
    sets (`offline-bundle-script.test.sh:630-631`) explicitly: export `SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime`
    and `SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true`, a test-unique `SANCTUARY_PROJECT` (for example
    `sanctuary-test-$$`), and `SANCTUARY_OWNERSHIP_ROOT="$TEST_TMP_DIR/ownership"` (as at `:707`). Otherwise
    `scripts/ownership/project-lock.mjs:14-25` resolves the shared `/tmp/sanctuary-ownership-<uid>/project-locks`
    root and the real apply takes the developer's real deployment lock. `teardown_bundle_workspace` (`:326-333`)
    already unsets the two lock variables; unset `SANCTUARY_PROJECT` there too or in the test.
  - **Real git.** This test uses the real `git` for `checkout_bundle_source` (`apply-bundle.sh:375-397`); do not
    call `setup_fake_git` here. It fetches the tag from the bundle's own `repo/sanctuary.git.bundle`
    (`apply-bundle.sh:376`, `:395`), so no network is needed.
- `test_extracted_bundle_authority_imports_resolve`: in the extracted bundle, run `node --input-type=module -e` to `await import()` each executed entrypoint: `authority/scripts/ownership/{register-resource,describe-host-authority,write-ci-cleanup-request,ci-cleanup-coordinator}.mjs` and `authority/scripts/ci/provider-context.mjs`.
  - `register-resource`, `describe-host-authority`, `write-ci-cleanup-request` and `ci-cleanup-coordinator` are
    guarded by `isMainModule`, and `provider-context.mjs` is a library with no top-level entry, so importing them
    has no side effects.
  - **Decided: `deployment-session.mjs` is not in this list.** It has no `isMainModule` guard and calls
    `main(process.argv.slice(2))` at top level (`scripts/ownership/deployment-session.mjs:404-415`), so an import
    sets `exitCode` 1 both before and after the fix and cannot discriminate. The real-apply test above already
    loads it through `ensure_apply_lock` → `deployment-lifecycle.sh` (`DEPLOYMENT_SESSION_SCRIPT`,
    `scripts/ownership/deployment-lifecycle.sh:13`).
  - Today `ci-cleanup-coordinator.mjs` fails with `ERR_MODULE_NOT_FOUND`.
- Run `"$extracted/tools/create-upgrade-backup.sh" --bogus-flag` and assert the usage/argument error, not "No such file". This proves top-level sourcing works.
- Add `scripts/ci/forward-live-annotations.mjs` to the CI authority list at :507-513.
- **Existing tests to update.** `test_create_bundle_signs_outer_archive` (`:868`, copy at `:881-886`) and
  `test_create_bundle_skip_build_rejects_stale_revision` (`:923`, copy at `:937-941`; its fresh half at `:973-978`
  reuses that repo) both need `"$PROJECT_ROOT/scripts/ci/forward-live-annotations.mjs"` added to the
  `release_repo/scripts/ci/` copy. Its imports are already copied there.
- Register every new test function in the `run_test` list in `main()` (`offline-bundle-script.test.sh:1144-1192`);
  a function that is defined but not listed never runs.

**Constraints**
- `bash -n` on all three scripts.
- `tests/install/run-all-tests.sh` already includes this file.
- Install-test lanes run.
- No inventory-format change: `image-inventory.tsv` is pinned (`apply-bundle.sh:214-219`).

**Acceptance**
- `./install-offline.sh` gets through verify, backup (when a database exists) and apply from a freshly extracted bundle.

---

### Phase D2 — Offline bundle apply refuses a downgrade (P2, `offline-bundle--no-downgrade-guard`)

**Finding / evidence**
- `install.sh` runs `reject_downgrade_unless_allowed` (:491-504) only on the `--offline-bundle` path (:829).
- The bundle bootstrap (`install-offline.sh`, in the create-bundle.sh heredoc around :611-620) runs `tools/apply-bundle.sh --apply`. That calls `checkout_bundle_source` (`apply-bundle.sh:375-397`) and moves the checkout to `SANCTUARY_GIT_TAG` with no version comparison. It then runs `install.sh --offline-prepared`, which sets `SKIP_GIT_CHECKOUT=true` (:339-342) and takes the :838 branch, skipping the guard.
- **Status: reproduces.**

**Change**
- Move `semver_parts` and `is_semver_downgrade` into `scripts/offline/bundle-common.sh`. Keep `install.sh`'s copies, because `install.sh` must stay standalone. If jscpd flags the duplicate, have `install.sh` source `bundle-common.sh` when it exists. That is a reviewer decision.
- Add `reject_bundle_downgrade` to `apply-bundle.sh`:
  - if `$INSTALL_DIR/.git` exists, `current=$(git -C "$INSTALL_DIR" describe --tags 2>/dev/null || true)`;
  - if `is_semver_downgrade "$current" "$SANCTUARY_GIT_TAG"` and `ALLOW_DOWNGRADE != true`, call `offline_fail "Refusing downgrade from $current to $SANCTUARY_GIT_TAG …"`.
  - Unparsable versions are allowed, the same fail-open semantics as `install.sh:470`.
  - Call it in `apply_prepared_bundle` after `ensure_apply_lock`, before `load_bundle_images`, so nothing has been loaded or checked out yet.
- `--allow-downgrade` / `SANCTUARY_ALLOW_DOWNGRADE=true` becomes an `apply-bundle.sh` option.
- `install.sh` `apply_offline_bundle` (:441-454) passes the override through the **environment**, not the CLI:
  `SANCTUARY_ALLOW_DOWNGRADE=true "$apply_script" "${args[@]}"` when `ALLOW_DOWNGRADE=true`. Its fallback
  (`:444-447`) can run the already-installed, older `apply-bundle.sh`, which rejects an unknown `--allow-downgrade`
  flag; an unknown environment variable is harmless there.
- `install-offline.sh` accepts and forwards `--allow-downgrade` as the CLI flag. It always runs
  `tools/apply-bundle.sh` from the same bundle, so the flag is always understood.

**Test first** (`tests/install/unit/offline-bundle-script.test.sh`)
- **Fake git must answer `describe`.** `setup_inventory_bundle` installs the fake `git` from `setup_fake_git`
  (`offline-bundle-script.test.sh:318-324`), which exits 0 and prints nothing for every command. `describe` would
  return an empty version and the guard would fail open, so the test would pass for the wrong reason. Change the
  fake to print `$SANCTUARY_FAKE_GIT_DESCRIBE` when its arguments include `describe` and the variable is set, and
  otherwise keep `exit 0`. Existing tests leave the variable unset and are unaffected.
- `test_apply_refuses_bundle_downgrade`: using `setup_inventory_bundle`, create `$TEST_TMP_DIR/install/.git` as a
  plain directory (no real repository is needed with the fake `git`), set `SANCTUARY_FAKE_GIT_DESCRIBE=v99.0.0`,
  then run `$APPLY_SCRIPT … --apply`. The bundle's tag is `v9.9.9` (`:130`), so this is a downgrade.
  - Expect non-zero, "Refusing downgrade", and no `load` in the docker log.
  - With `SANCTUARY_ALLOW_DOWNGRADE=true`, expect success.
  - Today it applies, so the test fails.
- `test_install_offline_forwards_allow_downgrade`: in a bundle-layout run with stubbed tools (pattern at :1009), assert the stub receives `--allow-downgrade`.
- `tests/install/unit/install-script.test.sh` ~:1459: that suite is grep-based, so the new assertion is grep-based
  too. The existing `test_install_script_supports_offline_bundle` already greps `--allow-downgrade` anywhere in
  `install.sh`, which passes at base; scope the new grep to the `apply_offline_bundle` function body and to the
  environment form (for example
  `sed -n '/^apply_offline_bundle()/,/^}/p' "$INSTALL_SCRIPT" | grep -q 'SANCTUARY_ALLOW_DOWNGRADE=true'`), so it
  fails at base. Also assert that body does **not** contain `--allow-downgrade`, so the older-installed-script
  fallback can never receive the flag.
- Register the new offline-bundle test functions in `main()`'s `run_test` list (`:1144-1192`).

**Constraints**
- Lifecycle: the new git fixture lives in the already-registered file's temp dir.
- Docs: `docs/reference/offline-bundles.md:139-145` already says downgrades are refused and names
  `--allow-downgrade` for `install.sh --offline-bundle`; extend it to state that `install-offline.sh` (the bundle
  bootstrap) also refuses downgrades and accepts `--allow-downgrade`. `docs/how-to/migrate-from-packaged-deployments.md`
  does not mention `--allow-downgrade`; it only links to `offline-bundles.md` for "downgrade rules" (`:100-101`),
  so check that link still reads correctly and do not edit it. `release-distribution.md` is not touched.

**Acceptance**
- An older signed bundle cannot move an install backward without an explicit override.
- `install.sh --offline-bundle --allow-downgrade` still works when its fallback runs an older installed
  `apply-bundle.sh` (the override travels in the environment).

---

### Phase D3 — `support-package.sh` runner works when fed over stdin (P2, `support-package-script--runner-relative-import`)

**Finding / evidence**
- `scripts/support-package.sh:29-31` pipes `scripts/support-package-runner.mjs` into `docker compose exec -T backend node --input-type=module -`.
- The runner's static `import { isMainModule } from './lib/is-main-module.mjs'` (:4) resolves against the container cwd `/app`. The backend image copies only `server/scripts` (`server/Dockerfile:124`), so the module fails to load before `main()`.
- `tests/scripts/support-package-runner.test.ts` imports the runner from the repo, where `./lib` exists.
- `tests/ci/esm-main-guard-symlink.test.mjs:60` requires that symlinked file execution still reaches `main()`.
- **Status: reproduces.**

**Change (stdin entry free of `isMainModule`; no image change)**
- Remove the static import.
- At the bottom:
  ```js
  if (process.argv[1] === '-') { await main(); }
  else { const { isMainModule } = await import('./lib/is-main-module.mjs'); if (isMainModule(import.meta.url)) await main(); }
  ```
  The relative helper is then loaded only for file execution, where it resolves against the module's own URL.
- Rejected alternatives:
  - copying `scripts/` into the backend image (larger image and release surface);
  - inlining a realpath check (duplicates `scripts/lib/is-main-module.mjs`).

**Test first**
- `tests/scripts/support-package-runner.test.ts` (110): spawn `node --input-type=module -` with the runner source on stdin, and `cwd` set to a fresh `mkdtemp` that contains only `dist/server/src/services/supportPackage.js` (CJS, `exports.generateSupportPackage = async () => ({ ok: 1 })`) and **no** `lib/`.
  - Expect exit 0 and stdout JSON `{ "ok": 1 }`.
  - Today it fails with `ERR_MODULE_NOT_FOUND`.
- `node --test tests/ci/esm-main-guard-symlink.test.mjs` stays green.

**Constraints**
- Register the temp-dir `rmSync` in `config/resource-lifecycle-callsites.json` (`git add` first, then run `check-lifecycle-callsites.mjs`).
- `typecheck:tests`.
- `tests/scripts/**` is not part of `src` coverage.

**Acceptance**
- `./scripts/support-package.sh` writes a JSON package against a running stack.
- Verify manually on the local stack from `/home/nekoguntai/sanctuary-main` only when the user permits.

---

### Phase D4 — jscpd retry can actually retry (P2, `jscpd--retry-defeated-by-stale-dir-guard`)

**Finding / evidence**
- `scripts/quality/jscpd-only.sh:37-41` refuses any existing `$output_dir`, then runs `mkdir -p`.
- `.github/workflows/quality.yml:1071-1073` wraps the script in `scripts/ci/retry-command.sh`. Attempt 1 creates `reports/jscpd`. If `npx` (:43) then fails transiently, attempts 2 and 3 exit with "Refusing stale jscpd output directory" without running `npx`.
- The guard is still needed because the job checks out with `clean: false` (:1057), so an old non-empty report must not be uploaded.
- **Status: reproduces.**

**Change**
- Refuse only a **non-empty** pre-existing dir: `if [ -e "$output_dir" ] && { [ ! -d "$output_dir" ] || [ -n "$(ls -A "$output_dir")" ]; }; then …refuse…; fi`. An empty dir left by a failed earlier attempt is reused. No `rm` is added, so there is no lifecycle registration.
- jscpd writes reports only when it completes. A real duplication failure leaves a non-empty dir, and later attempts fail fast with the stale message. The first attempt's log keeps the real failure.
- Reviewer alternative: retry only `npx --yes jscpd@4 --version` (the prefetch) inside the script, and drop `retry-command` around the analysis.

**Test first**
- New `tests/ci/jscpd-only.test.sh`:
  - in a temp git repo containing copies of `scripts/quality/jscpd-only.sh`, `scripts/ci/provider-context.sh`, `scripts/ci/retry-command.sh` and `config/tooling/jscpd.json`;
  - with `SANCTUARY_CLEANUP_COORDINATED=1`, `SANCTUARY_RETRY_DELAY_SECONDS=0`, and a fake `npx` on `PATH` that fails on its first call and writes `jscpd-report.json` on its second. The report must have the shape the script's summary reads (`report.statistics.total.*`, `jscpd-only.sh:49`): `{"statistics":{"total":{"percentage":0,"duplicatedLines":0,"lines":1,"clones":0,"sources":1}}}`. An empty or differently shaped file makes the summary step fail and hides the retry result;
  - with `npm_config_cache="$tmp/npm-cache"` set and `RUNNER_TEMP` and `SANCTUARY_CI_TEMP_DIR_OVERRIDE` unset. Otherwise, when `ci_temp_dir` is not `/tmp`, `jscpd-only.sh:20-26` calls `create-registered-staging.sh` to make an npm cache, which the temp repo does not have;
  - run `retry-command.sh "jscpd" jscpd-only.sh`. Expect exit 0 and two `npx` calls. Today there is 1 call and exit 1.
  - Also: a pre-existing non-empty `reports/jscpd` is still refused.

**Constraints**
- Register the new test in `quality.yml` (`bash -n` list and execution list) and keep `ci-registration-completeness.test.sh` green.
- Register its temp-dir `rm -rf` in `config/resource-lifecycle-callsites.json`.
- `tests/ci/classify-quality-scope.test.sh` covers routing for `jscpd-only.sh` and needs no change.

**Acceptance**
- A transient `npx`/registry failure on attempt 1 is retried.
- A stale non-empty report is still refused.

---

### Phase D5 — Classifier lane-infra list plus a transitive drift guard (P2, `ci-classifier--lane-infra-list-incomplete`)

**Finding / evidence**
- `is_test_lane_infrastructure_file` (`scripts/ci/classify-files-lib.sh:217-267`) omits:
  - `scripts/ci/subject-budget.mjs`, run by `with-runner-lock.sh:52` and `run-in-isolated-workspace.sh:81`;
  - `scripts/ci/record-command-timing.mjs`, run by `time-command.sh:38`;
  - `scripts/ci/create-isolated-workspace.sh`, run by `run-in-isolated-workspace.sh:95`;
  - `.github/ci-performance-budget.json`, read by `time-command.sh:30`.
- The drift guard (`tests/ci/classify-test-changes.test.sh:78-98`) only checks direct `scripts/ci/…` tokens in `test.yml` and the actions.
- A transitive walk over `$script_dir/X`, `scripts/ci/X`, relative ESM imports and `.github/*.json`, starting from the classified seeds (scratch `trans4.py`), found three more unclassified dependencies:
  - `scripts/ci/action-runtime-workflow-guards.mjs`, imported by `check-github-action-runtimes.mjs`;
  - `scripts/lib/is-main-module.mjs` and `scripts/ownership/canonical-json.mjs`, imported by `forward-live-annotations.mjs` and others.
  - `run-quality-lint.sh` is reached only through the excluded `classify-quality-scope.sh`. It is a pattern, not executed, so it is correctly skipped.
  - `scripts/ownership/**` is already owned by the quality and architecture classifiers (`classify-quality-scope.sh:104`, `classify-architecture-scope.sh:20`), so `canonical-json.mjs` is not a gap (**Decision (b)**, decided).
- **Status: reproduces.**

**Change**
- Add these six paths to the full-scan arm of `is_test_lane_infrastructure_file`: the 4 named gaps (`subject-budget.mjs` via `with-runner-lock.sh:52` and `run-in-isolated-workspace.sh:81`; `create-isolated-workspace.sh` via `run-in-isolated-workspace.sh:95`; `record-command-timing.mjs` via `time-command.sh:38`; `.github/ci-performance-budget.json` via `time-command.sh:30`) plus the 2 non-ownership transitive dependencies (`scripts/ci/action-runtime-workflow-guards.mjs`, `scripts/lib/is-main-module.mjs`).
- Do **not** add `scripts/ownership/canonical-json.mjs`.

**Test first** (`tests/ci/classify-test-changes.test.sh`)
- Extend the :716 loop with `subject-budget.mjs`, `record-command-timing.mjs` and `create-isolated-workspace.sh`, plus one case for `.github/ci-performance-budget.json`. Each expects `full_scan=true`; today all lanes are false.
- Replace `assert_every_test_workflow_script_is_classified` with a transitive version:
  - BFS from the existing seed list;
  - for each visited root file, extract `\$\{?(script_dir|SCRIPT_DIR)\}?/NAME`, `scripts/ci/NAME`, `from '(\.\.?/…)'` (resolved against the file's own dir) and `\.github/[A-Za-z0-9_.-]+\.json`;
  - a `$SCRIPT_DIR/NAME` (or `$script_dir/NAME`) token is a **single path segment**: `NAME` matches
    `[A-Za-z0-9_.-]+` and never `../`. So `scripts/verify-addresses/implementations/go.mod` and similar
    `../`-relative inputs are not walked; verify-vectors has its own provenance pin for those (**Decision**,
    documented in a comment in the guard);
  - keep only existing root files;
  - **neither report nor descend into** anything matched by the explicit exclusion arm (`classify-files-lib.sh:219`),
    which assigns those scripts to a narrower lane; otherwise `classify-quality-scope.sh` itself would be reported
    as unclassified;
  - **stop at `scripts/ownership/**`**: do not report or descend into it, with a comment giving the reason (those files are owned by the quality and architecture classifiers, `classify-quality-scope.sh:104`, `classify-architecture-scope.sh:20`, not the test-lane full-scan list);
  - assert each reached path satisfies `is_full_scan_trigger_file || is_frontend_file || is_test_suite_file || is_critical_mutation_file || is_backend_file`.
- The existing assertions at :262-275, :279-310, :324-335 and :470-478 stay unchanged.
- `tests/ci/plan-test-run.test.sh`: `subject-budget.mjs` gives `full_scan == true`.

**Constraints**
- `bash -n`.
- Both test files are already lifecycle-registered and need no new `rm`.
- Run `bash tests/ci/classify-quality-scope.test.sh` too.

**Acceptance**
- Editing any helper that a lane runs, directly or transitively, forces a full scan.
- The guard fails when someone adds an unclassified transitive input.

---

### Phase D6 — Wallet-sync lifecycle gate scans `.tsx`/`.jsx` (P2, `wallet-sync-lifecycle-gate--tsx-not-scanned`)

**Finding / evidence**
- `walkCode` (`scripts/check-wallet-sync-lifecycle-contract.mjs:162-175`) accepts only `/\.(?:ts|js|mjs|cjs)$/` (:167).
- `collectProductionSources` (:177-182, roots `gateway/src`, `server/src`, `src`, :106) therefore never reads React components. `validateForbiddenClientHistory` (:989-1003), which checks `queueUserWallets` and `/sync/user` from config `:511-514`, and the producer, queue and re-export inventories all miss `.tsx`.
- `ts.createSourceFile` (e.g. :726, :929) infers the script kind from the extension, so `.tsx` parses as TSX.
- `parseContractSource` (:1572-1574) forces TS, but only for the named contract files it is given.
- **Status: reproduces.**

**Change**
- Change the regex to `/\.(?:ts|tsx|js|jsx|mjs|cjs)$/`.
- Run `node scripts/check-wallet-sync-lifecycle-contract.mjs` on the branch. If the newly scanned `.tsx` files surface real inventory entries (callsites or address-creation authorities), reconcile `config/wallet-sync-lifecycle-contract.json` explicitly and list each one in the PR. Do not loosen any check. If nothing surfaces (the expected outcome), say so in the PR: the widened regex produced no new inventory entries and `config/wallet-sync-lifecycle-contract.json` is unchanged.
- Update `lastReviewed` in `scripts/quality/large-file-classification.json` for both touched proof-harness files (`reviewWhenTouched: true`).

**Test first** (`tests/ci/check-wallet-sync-lifecycle-contract.test.mjs`, a classified proof harness)
- With `createFixture()` (:454), write `src/components/SyncButton.tsx` containing `import { queueUserWallets } from '../api/sync'; export const B = () => <button onClick={() => queueUserWallets()} />;`.
- Expect `errors` to include `forbidden client wallet-history symbol queueUserWallets: src/components/SyncButton.tsx`. Today there are no errors, so the test fails.
- The live-repo test (:648) must stay `errors: []`. Run `cd server && npx prisma generate` first (see Assumptions),
  so a stale generated client cannot produce spurious errors in the live-repo scan.

**Constraints**
- The Architecture lane is not PR-required (memory). Run `node --test tests/ci/check-wallet-sync-lifecycle-contract.test.mjs` and `npm run arch:check` in the primary checkout before pushing.
- Run `node scripts/quality/check-large-files.mjs`.

**Acceptance**
- Forbidden client wallet-sync calls in components fail the gate.

### Files touched (Group D)
- D1: `scripts/offline/apply-bundle.sh`, `scripts/create-upgrade-backup.sh`, `scripts/offline/create-bundle.sh`; test `tests/install/unit/offline-bundle-script.test.sh`
- D2: `scripts/offline/{apply-bundle.sh,bundle-common.sh,create-bundle.sh}` (`install-offline.sh` heredoc), `install.sh`, `tests/install/unit/{offline-bundle-script.test.sh,install-script.test.sh}`, `docs/reference/offline-bundles.md`, `docs/how-to/migrate-from-packaged-deployments.md` (check only)
- D3: `scripts/support-package-runner.mjs`, `tests/scripts/support-package-runner.test.ts`, `config/resource-lifecycle-callsites.json`
- D4: `scripts/quality/jscpd-only.sh`, (new) `tests/ci/jscpd-only.test.sh`, `.github/workflows/quality.yml`, `config/resource-lifecycle-callsites.json`
- D5: `scripts/ci/classify-files-lib.sh`, `tests/ci/classify-test-changes.test.sh`, `tests/ci/plan-test-run.test.sh`
- D6: `scripts/check-wallet-sync-lifecycle-contract.mjs`, `tests/ci/check-wallet-sync-lifecycle-contract.test.mjs`, `scripts/quality/large-file-classification.json`, possibly `config/wallet-sync-lifecycle-contract.json`

---

### Decisions for the reviewer
1. **C1:** extend the server CPFP response with `inputs`/`outputs` (additive, mirrors RBF) instead of decoding the PSBT on the client. Also remove the CPFP success-message path entirely, collapsing `ActionMessage` to error-only. A resumed CPFP draft displays as a `consolidation` (its recipient is the wallet's own address); that is expected. The draft locks the parent output, so a second Accelerate on the same parent is refused until the draft is deleted.
2. **C1:** label and memo copy, and `enableRBF: false`, which follows from the child's `sequence 0xffffffff`.
3. **C2:** Change row = `(txData.changeAmount ?? 0) + Σ decoys` (the `?? 0` keeps a `txData` of `{}` at 0, not `NaN`). Recipient rows use `txData.outputs[i]` only when the arrays align by index and address. **Decided (a):** Total Sending uses `Σ txData.outputs` when present; without built outputs, non-MAX sends keep `totalOutputAmount` and only `sendMax` uses `totalInput - fee - change`, so the existing 5000/5400 assertions stay unchanged. Summing outputs applies only when no output is `sendMax`, because a resumed MAX output is stored as 0; a `sendMax` row always displays `MAX`. Resumed drafts keep their decoy change: `decoyOutputs` is added to `DraftTransactionData` and threaded through `buildDraftTxData` and `createDraftInitialTxData` (`outputs` already come from `state.outputs`).
4. **C3:** reset hardware state, including `xpubData`, on Back from step 3. The unmount cleanup also clears `deviceConnected`.
5. **C4:** block inline import for another target user, rather than share an admin-owned wallet. Review the disabled-reason copy. Tests mock the current user as `user-1` so the existing inline-import tests are unchanged. `currentUserId: string | undefined` is a required prop on `AgentFormModal` and `CreateAgentWizardFields`, so every call site must pass it. **Decided:** `CreateAgentWizardFields` computes the reason (it has `form.userId` and `userOptions`) and passes `InlineOperationalWalletImport` a required `disabledReason: string | null`; `currentUserId` is not threaded into the import component. The reason-computation branch is tested at the `AgentFormModal`/`CreateAgentWizardFields` level; the import component's tests only render disabled vs enabled from the prop. The disabled-case tests give the other user a funding wallet and select it, so `disabled={!form.fundingWalletId}` is false and only `disabledReason` can disable the import. **Decided:** the base-behaviour proof is a manual f2c7e217 run recorded in the PR body, and the committed companion is an enabled case with `form.userId === currentUserId` and the same funding wallet, so no committed test asserts base behaviour. **Decided:** the reason's user label falls back to 'the selected user' when `form.userId` is not in `userOptions` (one extracted.branches case covers it). **Decided (b):** the e2e "wallet agent setup" test in `admin-operations.spec.ts` keeps `user-ops-regular`, asserts the disabled reason, and selects the existing `wallet-agent-operational` instead of importing; it is updated for new behaviour, not a fail-first test.
6. **C5:** one PATCH per device on the client, instead of a new `signedDeviceIds[]` server field. **Decided:** the remaining-device PATCH loop is one shared lease-taking helper used by both `saveSignedStateForNewDraft` and `updateExistingDraft`. Excluding the `psbt-signed` sentinel also fixes a latent 400, including in `useQrSigning`'s `persistUploadedSignatureToDraft`, which today loses an unattributed uploaded PSBT to a swallowed 400.
7. **C6:** a static hard cap of 150 nodes / 20 tips, versus fade-and-recycle. The model lives in `animations/myceliumNetwork/model.ts` so the `AnimatedBackground` pattern-registry test is untouched. The cap test runs on a 2000×2000 canvas so bounds cannot mask unbounded growth.
8. **C7:** include the two small product fixes (wallet-list error state, feature-flags load error) in PR C, versus filing new findings and using `test.fixme`. The wallet-list error state shows only when `isError && !data` on the raw query data (not the `= []` default in `useWalletListData.ts:26`), so a failed background refetch keeps a populated list. The feature-flags banner uses the fixed text "Failed to load feature flags" and never renders the raw error, so `FeatureFlags.test.tsx:202-213` keeps its not-shown assertion and gains a banner assertion. Related-spec weak assertions stay P3 backlog.
9. **D1:** scope grew. `forward-live-annotations.mjs` is also missing from the bundle, so the backup coordinator would fail with `ERR_MODULE_NOT_FOUND` even after the sourcing fix. The real-apply test isolates the project lock (test lock root, test-unique `SANCTUARY_PROJECT`, test ownership root) so it never takes the developer's real deployment lock, and uses real `git` (no `setup_fake_git`) for `checkout_bundle_source`. **Decided:** `deployment-session.mjs` is dropped from the import-resolution test, because it runs `main()` at top level with no `isMainModule` guard (an import sets `exitCode` 1 before and after the fix); the real-apply test already loads it via `ensure_apply_lock` → `deployment-lifecycle.sh`.
10. **D2:** guard placement in `apply-bundle.sh` (after the lock, before the image load), the fail-open behaviour on unparsable versions, and the semver-helper duplication versus sourcing `bundle-common.sh` from `install.sh`. `install.sh` passes the override as `SANCTUARY_ALLOW_DOWNGRADE=true` in the environment (its fallback may run an older installed `apply-bundle.sh` that rejects unknown flags); `install-offline.sh` keeps the `--allow-downgrade` CLI flag because it always runs the same bundle's tool. The test's fake `git` answers `describe` from `SANCTUARY_FAKE_GIT_DESCRIBE`, so the guard cannot pass by failing open.
11. **D3:** a lazy `import()` for file execution, versus inlining or copying `scripts/` into the image.
12. **D4:** reuse an empty output dir, versus retrying only the `npx` prefetch.
13. **D5 (decided, option b):** the transitive walk stops at `scripts/ownership/**`, which the quality and architecture classifiers own (`classify-quality-scope.sh:104`, `classify-architecture-scope.sh:20`); the stop carries a documented reason in the guard. `scripts/ownership/canonical-json.mjs` is not added to the full-scan list. The 4 named gaps and the 2 non-ownership transitive inputs (`action-runtime-workflow-guards.mjs`, `scripts/lib/is-main-module.mjs`) are added. Paths matched by the `classify-files-lib.sh:219` exclusion arm are neither reported nor descended into. **Decided:** `$SCRIPT_DIR/NAME` tokens are a single path segment (no `../`), so `scripts/verify-addresses/implementations/go.mod` is not walked; verify-vectors has its own provenance pin. The guard documents this.
14. **D6:** any inventory entries newly surfaced in `.tsx` must be listed and justified in the PR. If none surface, the PR states that the widened regex produced no new inventory entries and `config/wallet-sync-lifecycle-contract.json` is unchanged.

## Verification (every PR)

Use the guarded entry points only. The Docker-only rule applies: never run `npm run dev` or
vite on the host. Work in the implementation worktree after `npm ci`, and run one coverage job
at a time.

- **Focused tests:** every new or changed test for the PR's phases, confirmed failing on
  `f2c7e217` first.
- **Typechecks:** `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`.
- **Backend:** `cd server && npm run typecheck:tests && npx vitest run --coverage tests/unit`
  (100%).
- **Frontend coverage:** `npm run test:coverage` (100%) when frontend files in `src/` or
  `tests/` change. A run with "Unhandled Errors" counts as a failure.
- **Integration:** `cd server && npm run test:integration:db -- <touched integration specs>`.
- **Other packages:** gateway and llm-egress-proxy package tests and typechecks when those
  packages change. Run them from both the package directory (as CI does) and the repo root.
- **Quality gates** (`git add` new files first):
  - `bash scripts/quality/lizard-only.sh`: record the warning count in the PR. It must stay at or below 84
    (base; `LIZARD_WARNING_BASELINE` 86, `scripts/quality.sh:21`), i.e. no PR adds a warning;
  - `bash scripts/quality/jscpd-only.sh` (remove `reports/jscpd` between runs until D4 lands);
  - `node scripts/quality/check-large-files.mjs`.
- **Boundary and safety checkers:**
  - `node scripts/check-architecture-boundaries.mjs`;
  - `node scripts/check-wallet-sync-mutation-boundaries.mjs`;
  - `node scripts/check-wallet-sync-lifecycle-contract.mjs`;
  - `node scripts/check-safety-catch-guards.mjs`;
  - `node scripts/ownership/check-lifecycle-callsites.mjs`;
  - `npm run verify:signer-inventory`.
- **PR B:**
  - the critical-mutation shard (Stryker shard 3) for B3's and B12's files and any profile named in its phases;
  - `cd gateway && npx tsc --noEmit && npx vitest run --coverage` for B9;
  - `bash tests/install/unit/install-script.test.sh` and `bash -n` on `start.sh` and
    `tests/install/e2e/upgrade-install.test.sh` for B10. B10 makes PR B an install-test lane change, so the
    install-test lanes run on the PR; never run the install or start scripts for real;
  - the new integration specs (B2's `emailVerification.integration.test.ts`, B10's Redis-gated
    `twoFactorAccountRateLimit.integration.test.ts`, and B1's unless rejected) through
    `npm run test:integration:db`, each registered in `scripts/ci/backend-integration-groups.sh`. Run B10's
    spec with `REDIS_URL` set and `SANCTUARY_REQUIRE_REDIS_INTEGRATION=true`; a skipped suite is a failure.
    Also rerun `authIntentConcurrency.integration.test.ts` (B10 stubs `consume` there; B2 splits its
    SMTP-disabled case into not-required and required-plus-no-SMTP refusal, with the `email.verificationRequired`
    setting deleted in a `finally` and asserted absent at the start of the refusal case). B2's new spec runs the
    register → resend-pending → verify → login flow and the change-email → resend-pending → verify recovery flow
    (each verifies the token from the last `sendEmail` call and asserts the earlier token is `INVALID_TOKEN`),
    with `registrationEnabled` and `email.verificationRequired` deleted in a `finally`; it stubs
    `rateLimitService.consume` to allowed, so its sends actually happen; every `consume` spy (B2 and B10) sits in a
    `beforeEach` or inside the `it`, because server `restoreMocks: true` undoes `beforeAll`/module-scope spies.
    Run each spec twice in a row (and the whole touched group once) to catch leaked settings or spies;
  - B11: `cd server && npm run typecheck:tests` (the kept `dispatchApprovalRequestedNotification` absence pins in
    `draftCreate.test.ts` must read the mock through a cast);
  - B3: `node scripts/check-safety-catch-guards.mjs` with the `reconcileUncertain`,
    `reconcileSigningIntentBroadcasts` and `broadcastAndSave` allowlist counts unchanged (or the allowlist edit
    committed with reasons);
  - B8: `node scripts/quality/check-large-files.mjs` and record `policyEvaluationEngine.ts`'s line count;
  - B4: every `populateMissingTransactionFields` contract, not only the new cases, and
    `node scripts/check-safety-catch-guards.mjs` with the `populateFee` allowlist count still 1; confirm in the
    coverage report that the `!input.txid || input.vout == null` branch is covered;
  - B10: the `verify.ts` route handler's CCN from `lizard-only.sh`, recorded and `<= 15`; and
    `auth.routes.2fa.test.ts` plus `auth.routes.registration.test.ts` pass in full (proves the
    `services/rateLimiting` harness mocks and the side-effect-free `policyMessages.ts` import);
  - B11: the `notificationJobs.ts` draft handler CCN from `lizard-only.sh`, recorded and `<= 15`;
  - B12: `assertOptionalMetadata` CCN (13 at base) from `lizard-only.sh`, recorded and `<= 15` (plus the
    extracted helper's CCN if the skip pushed it over 15); the Stryker shard-3 run (`api/transactions/broadcasting.ts`)
    shows no new survivor on the new branch;
  - B3: `broadcastLifecycle.test.ts` covers the `markSigningIntentBroadcastStalled` and
    `countAttempt: false` delegations (100% functions), and the stalled lookup's lost-race (`false`) arm;
  - B3: the blockchain mock factories in `transactionServiceBroadcastTestHarness.ts` and
    `broadcastReconciliation.test.ts` use the real `isNodeAnsweredBroadcastFailure` (`vi.importActual`); the
    `broadcastAndSave` contracts assert the forwarded `allowDefiniteRejection` flag, and the classification
    cases (allowlist, `missingorspent`, preflight on a resumed claim) run only against the real
    `networkOperations` in `networkBoundary.test.ts` and `broadcasting-validation-reorg.contracts.ts`.
- **PR C:** build `dist/`, serve it statically on a free port, and run Playwright (chromium)
  with a throwaway config that has no `webServer`. Cover the changed specs
  (`error-recovery.spec.ts` for C7, `admin-operations.spec.ts` for C4) and
  `render-regression`, and compare any failures against an unmodified base build. C1–C5 touch
  wallet-safety critical paths, so the verify-vectors workflow runs on every PR C push; wait for it.
- **PR D:** D1's real-apply test runs with real `git`, the isolated project lock root and a test-unique
  `SANCTUARY_PROJECT`; confirm nothing was created under `/tmp/sanctuary-ownership-<uid>/project-locks`.
  D1's import-resolution test imports only the guarded or library modules (not `deployment-session.mjs`).
- **PR D:** the `tests/ci/*.test.sh` and `tests/install/unit/*.test.sh` suites named in its
  phases, plus `bash -n` on every changed shell file. Never run install/start/setup/bundle
  scripts for real; use only the repo's test fakes.
- **Architecture graphs:** `npm run arch:check` for every PR, in the primary checkout. Commit
  whatever it regenerates under `docs/architecture/generated/**`; no phase promises a regenerated graph
  (the server graph collapses at `src/<dir>`).
- **Before committing:** `/simplify` and the edge-case audit for each PR.

## Delivery, rollback, deployment

- **Merge order:** four PRs, serial (PR B before PR C is also a hard dependency: C1 needs B12). Rebase only the next PR to merge, wait for green, then
  merge. Squash, no admin bypass, `delete_branch_after_merge: false`. Verify the
  `merge_commit_sha` is an ancestor of `main` before starting the next PR. Hold finished B, C
  and D branches locally (not pushed) until the previous PR has merged.
- **Before each merge:** wait for every workflow run on the head to finish, not just the
  required contexts. Architecture is not PR-required but turns `main` red. install-test and
  release-candidate exercise installer changes in PR D, and install-test also runs on PR B (B10 touches
  `docker-compose.yml`, `start.sh` and `tests/install/**`). verify-vectors runs on PR B (B3, B4, B12) and on
  PR C (C1–C5).
- **Rollback:** each phase is an independent commit and independently revertible. There is no
  data migration. B3's `stalled` broadcast state is additive; older code treats unknown states
  as non-reconcilable. Reverting B3 leaves any `stalled` rows unreconciled until they are set back
  to `unknown` by hand; record the count of `stalled` rows before a revert.
- **Behaviour changes users can see:**
  - A1: a registered WebSocket client that hits a socket error is now terminated, and the error is
    logged at `warn` instead of `error`.
  - B2: the verification link moves to `/#/verify-email`, and old links are rewritten. Resend
    works before login, and the login screen offers it when an account is unverified, so a user who changed
    their email can verify the new address without a session. With verification required and SMTP not
    configured, an email change is refused with an actionable error instead of locking the user out. The
    pre-auth resend shares the login attempt budget for that IP and username, and always answers with the same
    202. A mistyped, undeliverable address still needs an administrator to correct it (P3 residual).
  - B3: a first-attempt node policy rejection releases the draft with the node's reason; an intent whose
    node keeps rejecting the rebroadcast for 60 attempts becomes `stalled` (network outages, Electrum errors that
    are not a node verdict, and preflight-unavailable failures do not count).
    A user retry of a stalled intent re-submits once and, if that fails, gets an actionable "could not be
    confirmed" message instead of "already in progress". A stalled intent that later confirms is still
    picked up, within about an hour.
  - B7: admin delete refuses with a 409 naming the blocking drafts, policies or votes.
  - B8: policy address entries are validated against the wallet network; a duplicate on the same policy, on
    either list, is a 409 `Address already on this policy (allow or deny list)`.
  - B9: mobile view caps are enforced on wallet-scoped reads through the gateway, including address
    summaries, address lists and labels. A gateway read of a nonexistent or inaccessible wallet now returns
    403 instead of 404 (fail closed). A mobile user with `generateAddress` on and `viewBalance` off can
    still create addresses but can no longer list them.
  - B10: 2FA verify has a per-account budget, configurable with the new `RATE_LIMIT_2FA_ACCOUNT`
    (default 10) in `docker-compose.yml`; a capped attempt gets a 429 with `Retry-After`. If the rate limiter
    is unavailable, 2FA verify returns 503 instead of checking the code (fail closed).
  - B5: the main Redis client keeps reconnecting after any outage, with throttled logs and no false
    "in-memory fallback" claim.
  - B11: approvers get no zero-amount placeholder message; the single draft notification is marked
    approval-required.
  - B12: a transaction whose outputs all belong to the wallet (send-wizard MAX consolidation, non-MAX send to an
    own address with change, saved consolidation or CPFP draft) now broadcasts instead of failing with a metadata
    mismatch; the client's `amount` and `recipient` are no longer compared for it, while `fee` and UTXOs still are.
  - C1: CPFP opens the signing wizard instead of reporting false success. The saved draft locks the parent
    output, so a second Accelerate on the same parent is refused ("UTXO is locked by a pending draft") until
    that draft is deleted.
  - C2: the review card's Change, recipient and total amounts come from the built transaction, including
    decoy change on resumed drafts; a resumed send-max draft shows `MAX`.
  - C4: inline agent import is disabled when the target user is not the importer.
  - C5: a draft saved after several cosigner signatures records every signing device, and an unattributed
    QR/file signature upload is now persisted to the draft.
  - C7: the wallet list shows an error state with Retry on an initial load failure (a failed background
    refetch keeps the populated list), and feature flags show a load error.
  - D2: offline bundle downgrades require `--allow-downgrade` (on `install.sh --offline-bundle` and
    `install-offline.sh`); `install.sh` hands the override to `apply-bundle.sh` as
    `SANCTUARY_ALLOW_DOWNGRADE=true`.
- **Deployment:** no container rebuild here (`--deploy final`).

## Completion criteria

- [ ] PR A merged; target-branch CI green on its merge commit.
- [ ] PR B merged; target-branch CI green.
- [ ] PR C merged; target-branch CI green.
- [ ] PR D merged; target-branch CI green.
- [ ] Every phase's regression test failed on `f2c7e217` and passes on its merge. Gated phases
      that did not fail are recorded `rejected` with evidence and dropped from their PR (B1: if the
      advisory-lock integration spec passes on base, B1 is `rejected`, not downgraded to P3).
- [ ] New Redis-gated integration spec (B10) ran, not skipped, locally and in CI.
- [ ] B3's safety-catch allowlist counts unchanged, or the allowlist edit is in PR B with reasons.
- [ ] verify-vectors green on PR B and PR C heads (B3/B4/B12 and C1–C5 touch critical paths).
- [ ] B12: cases (a), (b) and (f) failed on `f2c7e217` and pass; all-own wrong `fee` and wrong `utxos` and
      external wrong `amount` and wrong `recipient` are still 400; `assertOptionalMetadata` CCN recorded `<= 15`;
      no new shard-3 survivor; PR B merged before PR C (C1 depends on it), or B12 recorded `rejected` with evidence.
- [ ] B2: `authIntentConcurrency.integration.test.ts` SMTP-disabled case split (not-required keeps the
      invalidation coverage and deletes the setting in a `finally`; required plus no SMTP asserts the setting
      absent, then is refused with `user.email` and the old token unchanged).
- [ ] B2: `emailVerification.integration.test.ts` passes (register → resend-pending → verify → login, and
      change-email → resend-pending → verify → login), with its system settings deleted in a `finally`.
- [ ] B2: the mistyped-address residual is recorded as a P3 in the run state.
- [ ] B3: only node-verdict `ElectrumRpcError`s and `node_preflight_rejected`/`invalid_raw_transaction`
      preflight errors advance the reconcile cap (unit cases for `node_preflight_unavailable` and a non-verdict
      RPC error prove `countAttempt: false`).
- [ ] D6's PR states whether the widened regex surfaced inventory entries (expected: none).
- [ ] Owned branches and worktrees cleaned; run state updated.
- [ ] P3 backlog remains outside the blocking fix set.
