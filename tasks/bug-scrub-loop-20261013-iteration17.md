# Bug-scrub loop 20261013 — iteration 17 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 17
- **Source SHA:** `c81b2d372576da75efa0b9406dc480777b1dbb7f` (`main`, after #1417)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (8 × P2):** A1
  `wallet-sync--gap-expansion-blocked-by-display-capability-freeze-hides-funds` (USER DECISION 2026-10-28), A2
  `wallet-sync--history-budget-fixed-regardless-of-wallet-size-permanent-failure` (folds in P3
  `fetch-histories--budget-expiry-continuation-throws-in-history-authentication`), B1
  `agent-funding--viewer-role-user-can-create-drafts`, B2 `broadcast--mixed-send-amount-sums-own-outputs` (also
  resolves backlog P3 `broadcast--mixed-send-own-first-recipient-mismatch`), B3
  `support-package--scheduler-readiness-collector-outlives-deadline-fences-generation`, C1
  `tor-payjoin-ingress--stale-ips-after-container-recreate`, C3 `tor-payjoin-ingress--empty-host-header-rejected-400`
  (found by plan review pass 1), C2 `ci-classifier--quality-suite-subjects-outside-trigger`
  (recurrence of the iteration-11 fix `51b0b69af`). Every finding was re-verified from source at `c81b2d372576`
  (file:line in the phase sections), and every fix and red test was prototyped on a scratch copy of that tree (the
  phase sections say which reds were observed and which are predicted).
- The **22 deferred P3s** are backlog in run state and are **outside this fix set** (listed by id under Open
  questions): 16 from this iteration's scrub and 6 recorded by this plan (5 by its open questions, 1 by review pass
  1). A 23rd iteration-17 P3,
  `fetch-histories--budget-expiry-continuation-throws-in-history-authentication`, is folded into A2 and resolved by it.
- **Scratchpad** (`scratchpad/…` in the phase sections, `$SCRATCH` in the Verification block):
  `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`. The prototype diffs
  are referenced there, not inlined: `plan17-A2-prototype.patch`, `plan17-A1-prototype.patch` (Phase A),
  `p17b/b1.patch`, `p17b/b2.patch`, `p17b/b3.patch` (Phase B), `plan17-C1-prototype.patch`,
  `plan17-C3-prototype.patch`, `plan17-C2-prototype.patch` (Phase C). Seven pass `git apply --check` on
  `c81b2d372576` singly; `plan17-C3-prototype.patch` applies on top of `plan17-C1-prototype.patch` (same two files);
  all eight apply together in the order A2, A1, B1, B2, B3, C1, C3, C2 (re-checked in review pass 1, which updated the
  A2, B2 and C2 patches and added C3; the pass-0 versions are kept as `*.pass0`; review passes 2 and 3 updated the C2
  patch again, previous versions `plan17-C2-prototype.patch.pass1` and `.pass2`). Pass-1 re-observations are in
  `scratchpad/pr1/` (a scratch copy of `c81b2d372576` with all eight applied). A prototype is guidance; the phase text
  below governs where they differ.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `wallet-sync--gap-expansion-blocked-by-display-capability-freeze-hides-funds` (USER DECISION 2026-10-28: decouple) | P2 |
| A2 | `wallet-sync--history-budget-fixed-regardless-of-wallet-size-permanent-failure` (folds in P3 `fetch-histories--budget-expiry-continuation-throws-in-history-authentication`, D-17.A2b) | P2 |
| B1 | `agent-funding--viewer-role-user-can-create-drafts` | P2 |
| B2 | `broadcast--mixed-send-amount-sums-own-outputs` (also resolves backlog P3 `broadcast--mixed-send-own-first-recipient-mismatch`, OQ-B2) | P2 |
| B3 | `support-package--scheduler-readiness-collector-outlives-deadline-fences-generation` | P2 |
| C1 | `tor-payjoin-ingress--stale-ips-after-container-recreate` | P2 |
| C3 | `tor-payjoin-ingress--empty-host-header-rejected-400` (found by plan review pass 1; fixed in phase `c` after C1) | P2 |
| C2 | `ci-classifier--quality-suite-subjects-outside-trigger` (recurrence of the iteration-11 fix `51b0b69af`, D-11.18) | P2 |

## Open questions

All open questions raised by the section drafters are **DECIDED**: one by the user, the rest by the coordinator. The
phase sections below carry the decisions; where a drafted section recommended a different P3 id or wording, it is
amended in place and marked *(coordinator, at assembly)*. Two decisions change product-visible behaviour (A1 by user
decision, OQ-B1b by coordinator decision); the docs lines and changelog bullets state both plainly.

- **USER DECISION (2026-10-28) — A1: decouple sync's read-only gap expansion from the `display` capability.**
  Background sync derives and watches addresses past the gap limit for every wallet with a canonical policy, whatever
  its signer. Address display and generation stay frozen exactly as #781 set them: every user-facing surface keeps its
  own `display` gate (surface audit in Phase A1). The alternative "flag the sync incomplete instead of expanding" was
  declined by the user: the freeze must not hide funds.
- **OQ-A1 — the residual capacity ceiling after A2: DECIDED, accept and record P3
  `wallet-sync--history-work-beyond-attempt-window-never-completes`.** A2 moves the permanent failure from about 3,000
  history items (addresses + history txids + parent txids at 1 s Tor RTT) to about 12,000 items (the 20-minute
  window's 1,200 sequential round trips at 1 s RTT; about 24,000 at 0.5 s). A wallet beyond the window still never
  completes, because no authenticated evidence carries across attempts. Closing it needs cross-attempt reuse of stored
  raw transactions or a trust-model change for parent fetches (Phase A, OQ-A1 options (a)/(b)); neither is in this
  plan. **The A2 changelog bullet states the capacity limit plainly.** *(coordinator, at assembly: the drafted id
  `wallet-sync--history-work-beyond-window-never-converges` is replaced by the run-state id above.)*
- **OQ-A2 — a failed recursive gap pass reported as success: DECIDED, keep the behaviour (D-17.A1d) and record P3
  `wallet-sync--recursive-gap-pass-failure-reported-as-success`.** No funds are lost: gap rows and ownership-repair
  targets are durable, and the next scheduled sync (≤ 5 min, `SYNC_INTERVAL_MS`) scans them at depth 0 and runs the
  receive gate. Propagating would make a deep import burn all three job attempts and land in `action_required` while
  it is still progressing. *(coordinator, at assembly: the drafted id
  `sync-wallet--recursive-gap-sync-failure-reported-as-success` is replaced by the run-state id above.)*
- **OQ-B1a — the admin agent form still offers funding wallets by any role: DECIDED, P3
  `agent-form--funding-wallet-options-ignore-role`.** After B1 such a create is refused with a 400 (hidden behind the
  modal by backlog P3 `agent-management--modal-errors-hidden`); the dashboard keeps showing such an agent `active`.
  Not widened into the frontend here.
- **OQ-B1b — upgrade impact: DECIDED, intended; no operator-host check.** Existing agents whose user is a viewer or
  approver on the funding wallet get 403 `agent_user_wallet_role_insufficient` on every call after upgrade, until an
  owner grants signer or the admin re-links. The changelog states it. No operator host is inspected by the loop
  (outside the loop's authority; same precedent as i16 C-Q2).
- **OQ-B2 — backlog P3 `broadcast--mixed-send-own-first-recipient-mismatch`: DECIDED, resolved by B2** (D-17.B2b;
  record it as resolved when B2 merges).
- **OQ-B3 — the 2 s statement timeout: DECIDED, 2 s**, matching the sibling support-package DB collectors. On very
  large installs the readiness section may show `unavailable` in a package more often; the worker's cutover gate is
  untouched. Any future value must keep `maxWait + timeout = 4 × ms < 15_000`, i.e. below 3.75 s (pinned by B3 case 1).
- **OQ-C1 — Tor reload on an ingress IP change: DECIDED, keep SIGHUP** (D-17.C1b) and record P3
  `install-upgrade--tor-overlay-recreate-not-exercised`. The `kill -TERM` fallback is safe only under a restart
  policy, and CI uses `SANCTUARY_RESTART_POLICY=no`.
- **OQ-C2 — files a classifier suite only reads or greps (workflow YAMLs, Dockerfiles, vitest configs, docs):
  DECIDED, out of this fix; P3 `ci-classifier--contract-suite-data-inputs-outside-trigger`.** No mechanical rule
  separates real reads from fixture strings, so it cannot be a fail-closed guard.

**The P3 backlog is outside the blocking fix set.** Nothing below fixes a P3 except the one folded into A2 and the one
resolved by B2.

**P3 follow-ups recorded in run state by this plan (6; outside this fix set):**
`wallet-sync--history-work-beyond-attempt-window-never-completes` (OQ-A1),
`wallet-sync--recursive-gap-pass-failure-reported-as-success` (OQ-A2), `agent-form--funding-wallet-options-ignore-role`
(OQ-B1a), `install-upgrade--tor-overlay-recreate-not-exercised` (OQ-C1),
`ci-classifier--contract-suite-data-inputs-outside-trigger` (OQ-C2), and
`install-upgrade--legacy-tor-fixture-incompatible-with-ingress-template` (review pass 1, C1 Compatibility).

**Proposed by a phase draft but not yet in run state (coordinator to record or reject):**
`tor-ingress--healthcheck-does-not-exercise-backend-route` (D-17.C1c). Phase A also notes, without minting an id, the
separate size-driven failure at `electrum/methods.ts:41-58` (`ELECTRUM_MAX_HISTORY_ITEMS = 4096`, 512 KiB / 2 MiB frame
caps, #964); A2 does not address it.

**P3s deferred (22: 16 from this iteration's scrub plus the 6 above, marked †; backlog, outside the blocking fix
set):**
`agent-dashboard--resolved-approval-drafts-counted-pending`, `agent-form--funding-wallet-options-ignore-role`†,
`ci-classifier--contract-suite-data-inputs-outside-trigger`†,
`ci-cleanup-refused-summary--classifications-and-ownership-never-populated`,
`dashboard-balance-trend--no-change-claimed-when-history-unavailable-or-loading`,
`device-add-account--partial-failure-closes-silently`, `gateway-rate-limit--exponential-backoff-advisory-only`,
`install-upgrade--legacy-tor-fixture-incompatible-with-ingress-template`†,
`install-upgrade--tor-overlay-recreate-not-exercised`†, `monitoring--electrum-latency-panel-legend-absent-server-label`,
`natural-query--intent-path-drops-aggregation-sort-amount-label`, `openapi-device-accounts--delete-409-undocumented`,
`openapi-full-resync--503-details-outcomes-never-emitted`, `send-review-flow--resumed-sendmax-draft-recipient-shown-as-zero`,
`transfer-ownership--search-error-shown-as-no-users-found`,
`wallet-detail--stale-sync-retry-info-shows-attention-after-missed-success`,
`wallet-detail-tx-list--explorer-link-never-shown`, `wallet-sync--history-work-beyond-attempt-window-never-completes`†,
`wallet-sync-lifecycle-gate--comment-strip-swallows-code-after-glob-strings`,
`wallet-sync--reconcile-deletes-broadcast-pending-draft`, `wallet-sync--recursive-gap-pass-failure-reported-as-success`†,
`worker-subscription-checkpoint--outage-redials-every-second-and-churns-failure-evidence`.

The scrub also re-observed three existing backlog P3s (`grafana-card--password-always-not-configured`,
`websocket-upgrade--unauthenticated-sockets-fill-global-cap`, and `broadcast--mixed-send-own-first-recipient-mismatch`,
which B2 resolves); they are not new and are not counted above.

## Goal and non-goals

**Goal:** fix every blocking finding (8 × P2), each with a non-regression test that fails on `c81b2d372576` and
passes after the fix, delivered in one protected PR with green CI.

**Non-goals:** the P3 backlog and follow-ups (above); cross-attempt evidence reuse or a parent-fetch trust-model change
(OQ-A1); changing the recursive gap pass's error policy (OQ-A2); the admin agent form's options (OQ-B1a); production
data repair (no address, draft, agent or receipt row is rewritten; operator hosts are not inspected, OQ-B1b); new
Prisma migrations or `schema.prisma` edits (RC10 migration-tree digest); new API endpoints or query parameters (B2 adds
two optional fields to the existing batch response; B1 adds a 403 `details.reason` value; no e2e mock-map entry is
added or removed: the thirteen `unhandledRequests` sites found by grepping `transactions/balance-history` stay
untouched); any edit to a provenance-pinned verify-vectors input (`scripts/verify-addresses/sourceManifest.ts`
`VERIFIER_SOURCE_FILES`, including `.github/workflows/verify-vectors.yml`); any edit to a tier-1 mutation pin, to
`shared/constants/hardwareWalletCapabilities.ts` (the default-deny manifest stays as is), to
`server/src/api/transactions/broadcasting.ts`, `server/src/api/drafts.ts`, `server/src/services/draftCreate.ts` or
`server/src/services/agentApiService.ts`; any workflow file; a health check that exercises the backend route
(D-17.C1c); lowering `LIZARD_WARNING_BASELINE`; regenerating any PNG baseline; a version bump; branch-protection
changes.

## Decisions

Decision ids are unique across the plan: **D-17.A1a–D-17.A2e** (Phase A), **D-17.B1a–D-17.B3c** (Phase B),
**D-17.C1a–D-17.C3b** (Phase C), and the cross-cutting **D-17.X1–D-17.X8** below.

### Cross-cutting decisions

- **D-17.X1 worker model and worktrees.** Phases `a` (A2, A1), `b` (B1, B2, B3) and `c` (C1, C3, C2) each get a worktree
  `/home/nekoguntai/sanctuary-bug-scrub-20261013-i17-<phase>` (never `/tmp`: long-lived worktrees there vanished
  mid-run) on branch `codex/bug-scrub-loop/20261013-i17-<phase>`, cut from the final reviewed plan commit (the
  integrator records its SHA; it differs from `c81b2d372576` only under `tasks/`). File ownership is disjoint at this
  granularity (table below). Setup: root `npm ci` (a real install, never a symlinked `node_modules`; ~810 entries),
  `cd server && npx prisma generate`, `npm run build --workspace=shared` (**required before any red run**: the
  primary checkout's `shared/dist` is stale relative to `c81b2d372576`, and the Phase B prototype's first run against
  it produced unrelated reds; B2 also edits `shared/schemas`, so phase `b` rebuilds `shared` again after its B2 edit),
  nvm node on `PATH` (`export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`; `.nvmrc` is `24.21.0`; the system
  `~/.local/bin` npm 11 trips `devEngines` with EBADDEVENGINES). **One commit per finding (test + fix), in phase
  order** (a: **A2, then A1**; b: B1, B2, B3; c: C1, C3, C2). Every commit runs in the foreground through
  `flock /home/nekoguntai/.i17-commit.lock git commit …`, never while a coverage or Stryker run is active (the
  pre-commit hook tests flake under coverage load); no `git stash` (refs/stash is shared by all worktrees; base
  files are swapped in with `git show <plan-commit>:<path> > <path>` and restored with `git checkout -- <path>`). New
  files are `git add`ed before `node scripts/ownership/check-lifecycle-callsites.mjs` (it skips untracked files).
  Workers run only their phase's typechecks, targeted tests and per-file lizard, and record each red run on the
  plan-commit base as `$SCRATCH/i17-<phase>-red*.txt` (green as `-green*.txt`). Workers never run coverage,
  integration specs, Playwright or `arch:graphs`; phase `c` runs no docker.
- **D-17.X2 integrator.** The integrator works in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i17` on branch
  `codex/bug-scrub-loop/20261013-i17` (a real root `npm ci`, `prisma generate`, shared build). It cherry-picks the
  phase branches serially with `-x` (a, b, c), never resolves a conflict by editing another phase's file (conflicts go
  back to the owner), owns `docs/reference/changelog.md` (`## [Unreleased]`, bullets handed over by the phases) and
  `docs/architecture/generated/*`, and alone runs: backend and frontend coverage (behind the bounded guard), the
  **full** backend integration suite with Redis, the B3 integration red on a guarded base swap, the static Playwright
  run and the graph regeneration. It writes the Verification block to `$SCRATCH/i17-verify.sh` and runs
  `bash "$SCRATCH/i17-verify.sh"` (never `bash -c`: the `pgrep -f` guard would match the integrator's own shell).
- **D-17.X3 hold, stop and accepted-red rules.** **No phase is holdable** except as a unit for A: A2 and A1 must ship
  in the same PR, and A2 is committed first (A1 raises the history work per attempt and makes the recursive gap pass
  reachable for the first time since #781; A1 without A2 adds that work under the old fixed budget). B1, B2, B3, C1,
  C3 and C2 are independent commits (C3 edits the C1 template and test file, so dropping C1 means re-cutting C3 on
  base, where the same one-line Host fix and test apply to the plain config); none is dropped without a coordinator
  decision. **Red-test stop rule:** if a
  failing-first test does not fail on the plan-commit base, or fails for a different reason than its phase states (a
  collection error, an unmocked-import `TypeError`, a different assertion, a fixture/control failure) and that reason
  is not on the accepted list below, the worker **stops** and the coordinator re-assesses before anything is
  cherry-picked. The same applies when the fix breaks an existing test the phase does not list (the B1 harness
  migrations are listed), when a planned "green on base" guard is red (A1 legacy-wallet guard; A2 cancellation
  controls (phase cancellation and outpoint-lock cancellation); B1 cases 2, 3, 7; B2 case 2; B3 cases 2, 3), when the static Playwright run has a failure beyond the 7
  known auth/login cases or leaves a PNG baseline changed or added, when the full integration suite has a failure,
  and when the integration database or the throwaway Redis cannot start (the Verification block stops there; see
  the integration rule). A stop is recorded in the implementation log with the observed output.
  **Accepted reds (pre-cleared; any other red reason for the same test is still a stop).** Match on the failing
  assertion line and its diff, not on the printed headline.
  - A2 `historyStageBudget.test.ts` (new): `Tests 5 failed | 2 passed (7)`. Four cases fail with `AssertionError:
    expected SyncRemoteStageBudgetError: Wallet sync r… { stage: '…' } to be { walletId: 'wallet-id', …(34) } //
    Object.is equality`; the outpoint case with `AssertionError: promise rejected "SyncRemoteStageBudgetError: Wallet
    sync r… { stage: '…' }" instead of resolving` (`Caused by: … budget exhausted: history_parents`). The two
    cancellation controls (the phase and the outpoint lock) must be green on base (observed, pass 1).
    `attemptRuntime.test.ts`: `Tests 7 failed | 9 passed (16)`, all `TypeError: workScaledStageBudgetMs is not a
    function` (×4) / `TypeError: createSyncWindowRuntime is not a function` / `TypeError: syncHistoryWindowMs is not a
    function` (×2) (observed, pass 1). `blockchain.syncWalletRecursion.test.ts`: `Tests 1 failed | 14 passed (15)`,
    `AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times` (observed).
  - A1 `blockchainService.test.ts` (runs `address-discovery.contracts.ts`): `Tests 4 failed | 41 passed (45)`, each
    `it.each` row `AssertionError: expected [] to deeply equal [ 'm/84\'/0\'/0\'/0/20', …(19) ]`; the legacy-wallet
    guard must be green on base (observed). `bitcoin/blockchain.test.ts` (runs `gapLimit.contracts.ts`): `Tests 1
    failed | 63 passed (64)`, `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1
    times` (observed). `npm run verify:signer-inventory` with the source change but before D-17.A1c:
    `Server capability enforcement boundaries drifted` (observed; fixed in the same commit).
  - B1 `auth.test.ts` + `adminAgentService.test.ts`: exactly `Tests 6 failed | 19 passed (25)` (cases 1 ×2, 4, 5 ×2,
    6): `AssertionError: expected { keyId: 'key-access', …(10) } to be an instance of ForbiddenError` (×2);
    `AssertionError: expected "vi.fn()" to be called with arguments: [ 'funding-wallet', 'user-1' ]` (×2, cases 4
    and 6); `AssertionError: promise resolved "{ id: 'agent-1', hydrated: true }" instead of rejecting` (×2).
    `openapi.transfers-agent.test.ts`: `1 failed | 1 passed`, `AssertionError: expected 'Forbidden: the agent is not
    active, t…' to match /agent_user_wallet_role_insufficient/` (all observed).
  - B2 server: `tests/unit/api/transactions-http-routes.test.ts` → `Tests 5 failed | 134 passed (139)`: case 1
    `AssertionError: expected undefined to be 50000 // Object.is equality` and the four `expectPreviewEcho` refactor
    reds `AssertionError: expected "vi.fn()" to be called with arguments: [ 'wallet-123', 'test-user-id', …(2) ]`;
    `tests/unit/api/openapi.test.ts` → `Tests 1 failed | 52 passed (53)`, `AssertionError: expected { …(13) } to match
    object { effectiveAmount: { …(2) }, …(1) }` (observed, pass 1, after the assertion moved into its own case). B2
    frontend (the five files) → `Tests 5 failed | 252 passed (257)`, exactly cases 3–7 with the messages in Phase B2
    (observed, pass 1).
  - B3 unit: the two files → `Tests 2 failed | 49 passed (51)`: case 1 `AssertionError: expected "vi.fn()" to be
    called once, but got 0 times`; case 4 `AssertionError: expected "vi.fn()" to be called with arguments: [ {
    statementTimeoutMs: 2000 } ]` (observed). B3 integration (recorded by the integrator on the guarded base swap,
    Verification): the new `walletSyncCrossNetworkContract.test.ts` case fails because the base read waits for the
    lock and returns `available` (`expected { status: 'available', … } to match object { status: 'unavailable', … }`;
    **predicted**; the case asserts the result object first, so this is the failing headline, B3). If the
    integration pool has a single connection, the bounded read fails on `maxWait` instead; that is still
    `unavailable` after the fix, so the predicted base red is unchanged.
  - C1 `tests/config/torIngress.test.ts`: `Tests 3 failed | 2 passed (5)`: `AssertionError: expected '# ====…' to
    contain '- ${SANCTUARY_TOR_INGRESS_CONFIG:-./d…'`; `AssertionError: expected 'server {\n    listen 8080;…' to
    contain 'upstream payjoin_backend {'`; `AssertionError: tor command must define the ingress watcher: expected
    undefined to be defined` (observed).
  - C3 `tests/config/torIngress.test.ts` (at the C1 commit, C3 test added, `payjoin-ingress.conf` at the C1 commit):
    `Tests 1 failed | 5 passed (6)`, `AssertionError: expected 'HTTP/1.1 400 Bad Request' to be 'HTTP/1.1 200 OK' //
    Object.is equality` (observed, pass 1).
  - C2 `bash tests/ci/classify-quality-scope.test.sh`: rc 1 with `FAIL: files the ci-classifier-tests suites execute
    do not select the job: .github/ci-performance-budget.json config/tooling/jscpd.json …
    tests/install/utils/upgrade-source-refs.sh`, listing exactly the 55 subjects of the Phase C2 table (observed,
    pass 3).

  **Integration rule:** if the integration database or the throwaway Redis cannot start, the block stops at the
  integration lines (it runs under `set -euo pipefail`). That is a D-17.X3 stop, not a fallback: record it, triage
  infrastructure first (compose-backed runner, host load, the `.i17-integration.lock` holder, a stale Redis
  container), then **re-run the whole block** as written once both start. Completion requires the full block to exit
  0 with the full integration suite executed and every Redis-gated spec run (not skipped).
- **D-17.X4 lizard ceiling 83.** Pinned lizard 1.24.0 (`/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard`)
  with the repo arguments (`scripts/quality.sh` `run_lizard`, `:280-311`: `-w -i "$LIZARD_WARNING_BASELINE" -l
  javascript -l typescript -l tsx -C 15 -T nloc=200` plus nineteen `-x` excludes; `LIZARD_WARNING_BASELINE` is 86 in
  `scripts/quality.sh:21` and `.github/workflows/quality.yml:52`, unchanged). **Base count re-measured at assembly on
  `c81b2d372576`: 83** (from the i17 worktree root, which has no `node_modules`; rc 0; output
  `$SCRATCH/i17-lizard-base.txt`). No phase is expected to change it: A2 leaves the one base warning in a planned file
  (`fetchCompactWithProjector`, `server/src/services/bitcoin/sync/evidenceAuthentication.ts:322`, CCN 17, NLOC 50,
  already one of the 83, not edited, stays at `:322`) and raises `scanGeneratedAddresses` only from CCN 13 to 14;
  A1 lowers `prepareGapLimitExpansion` by 2. B measures 0 warnings on every B file only with two layout rules: the
  inline `??` in `useBroadcast.ts` gave CCN 16 and is replaced by a helper (D-17.B2b), and B2's OpenAPI assertion goes
  in its own `it` because `server/tests/unit/api/openapi.wallet.contracts.ts`'s `(anonymous)@57-264` callback is
  already 199 NLOC on base (the pass-0 prototype extended it to 203, a new warning). C measured 0. **Re-measured in
  review pass 1 on a scratch copy of `c81b2d372576` with all eight prototypes applied: 83 warnings, the same
  function set as `$SCRATCH/i17-lizard-base.txt`** (`scratchpad/pr1/lizard-all.txt`; again 83 with the same set in review
  pass 2 with the rule (g) C2 prototype, `scratchpad/pr1/lizard-all-p2.txt`, and in review pass 3 with the rule (h)
  C2 prototype through `scripts/quality/lizard-only.sh`, rc 0, `scratchpad/pr1/lizard-all-p3.txt`; the changelog, docs and the B3
  integration case are not in the prototypes, and the B3 case goes in a callback whose base size is at most 119
  NLOC). The Verification block gates
  `grep -c ': warning:'` at **≤ 83**. If the integrator's re-measured base differs from 83, the integrator records it
  as `$SCRATCH/i17-lizard-base-integrator.txt` (same binary and arguments, from a `git worktree` of `c81b2d372576` with
  no `node_modules`), edits the `-le 83` literal to that base, and records the change in the implementation log.
  Every worker runs pinned lizard `-C 15 -T nloc=200` on its new/changed `.ts/.tsx/.js/.mjs` files and reports zero
  new warnings. New helpers are top-level `function`/`const` declarations, CCN ≤ 15, NLOC ≤ 200; do not hoist a
  nested `function` out of a `describe` without re-measuring (lizard nested-function anchor; A1's
  `useProductionCapabilityGate` is top-level from the start).
- **D-17.X5 coverage.** Backend unit coverage is 100% and CI's shards pass `tests/unit` as a positional filter, so the
  integrator runs `( cd server && npx vitest run --coverage tests/unit )` (never a bare `--coverage`, which also runs
  integration tests and reports a falsely high number). Frontend coverage is 100%
  (`npx vitest run --config config/tooling/vitest.config.ts --coverage`). Both run only behind the bounded guard on
  `[n]ode_modules/.bin/vitest run.*--coverage` (and Stryker), one coverage run at a time on this 61 GB host. Each
  phase's coverage paragraph is the integrator's checklist. A2's lock cancellation arm (`evidenceAuthentication.ts`
  `:465`) is covered by an unconditional case in `historyStageBudget.test.ts` (review pass 1 found that no existing
  test reaches it). `scripts/ci/**`, `docker/**` and
  `scripts/generate-signer-inventory.mjs` are not in either coverage include; their proof is the node/bash/vitest
  suites the phases name.
- **D-17.X6 cross-phase couplings.** File ownership is disjoint (table below); the remaining couplings are shared
  gates only:
  1. **verify-vectors runs once on this PR.** A edits `server/src/services/bitcoin/**`
     (`config/wallet-safety-critical-paths.json:11`), B2 edits `server/src/api/transactions/**` (`:28`),
     `src/components/send/**` (`:73`) and `src/hooks/send/**` (`:98`), B3 edits `server/src/repositories/**`
     (`:52`), and any non-documentation path runs the workflow anyway (`scripts/ci/classify-verify-vectors-scope.sh:140-147`).
     Its `verify:signer-inventory` step covers A1's regeneration. A1's regenerated
     `config/hardware-wallet-implementation-inventory.json` is listed in `config/hardware-emulator-source-inventory.json:10`,
     so the **hardware-emulator proof jobs** run too. **No phase edits a `scripts/verify-addresses/sourceManifest.ts`
     `VERIFIER_SOURCE_FILES` entry** (`:2-37`; B2's `shared/schemas/transactionResponses.ts` is not one; only three
     `shared/constants/*` files are), so no vector is regenerated (Verification block provenance check).
  2. **Tier-1 mutation pins are untouched; the critical mutation lane still runs.** No phase edits
     `config/wallet-safety-mutation-map.json`, a CI-run Stryker `mutate` target (`server/stryker.critical.config.mjs`,
     `stryker.fee-policy`, `stryker.receive-evidence` (`rawTransactionEvidence.ts` only), `stryker.psbt-account-binding`,
     `stryker.taproot-*`, `config/tooling/stryker.{psbt-account-binding,wallet-policy}.config.mjs`),
     `server/scripts/mutation/**`, `config/wallet-sync-*.json`, the replay driver (`scripts/perf/**`) or
     `server/prisma/**`. *(coordinator, at assembly)* However, B2's `server/src/api/transactions/drafting.ts` and
     `server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts.ts` are on
     `is_critical_mutation_file` (`scripts/ci/classify-files-lib.sh:206-209`), so the PR runs the **Full Critical
     Mutation Gate** shards (`.github/workflows/test.yml:1293-1300`). `drafting.ts` is not a `mutate` target, so no
     range moves; the added contract cases can only add kills. A red there is triaged against
     `.github/mutation-baseline.json` and the shard reports, infrastructure first.
  3. **Tier-2 (unscheduled) Stryker globs are touched only by B2.** `config/tooling/stryker.config.mjs` mutates
     `src/hooks/**/*.ts` and `shared/**/*.ts`; no CI lane runs it (`package.json:148` `test:mutation` is not invoked by
     any workflow). B2 edits exactly four files there: `src/hooks/send/types.ts`, `src/hooks/send/useBroadcast.ts`,
     `src/hooks/send/useDraftManagement.ts`, `shared/schemas/transactionResponses.ts`. The Verification block asserts
     that set exactly.
  4. **Signer inventory.** A1 removes one `REQUIRED_SERVER_CAPABILITY_BOUNDARIES` row and regenerates
     `config/hardware-wallet-implementation-inventory.json` with `npm run generate:signer-inventory` (never
     hand-edited; D-17.A1c). No other phase adds an `assertWalletHardwareCapabilityById` call or a `finalize*`/
     `broadcast*`/signer identifier (`drafting.ts` keeps exactly its three `sign` calls, inventory `:53-57`), so the
     integrator's `npm run verify:signer-inventory` on the integrated tree must print `Signer inventory projection is
     current.` without a second regeneration. If it does not, that is a D-17.X3 stop.
  5. **Sync-path inventories.** A adds or moves no repository call (`check:wallet-sync-mutation-boundaries`: "verified
     48 repository callsites"; `syncWallet.ts` and `addressDiscovery.ts` boundary rows key on function and count,
     `config/wallet-sync-mutation-boundaries.json:49-53`), no `utxoRepository` writer (replay driver seal unchanged),
     and `check:wallet-sync-lifecycle-contract` passes.
  6. **Release surface.** C1 and C3 change `docker/**` (install-test PR path filter, `install-test.yml:30`, `:92`;
     `tests/install/utils/classify-install-scope.sh:536`), `docker/compose/**` (Release Candidate Validation,
     `release-candidate.yml:44`) and the frontend image (`docker/nginx/docker-entrypoint.sh` is baked in,
     `docker/frontend/Dockerfile:89`; docker-build selects it, `scripts/ci/classify-docker-build-images.sh:136`). C2
     changes `scripts/ci/*` (install scope `classify-install-scope.sh:483`; RCV `release-candidate.yml:37`). So the PR
     triggers the install/upgrade lanes, docker-build and RCV (Delivery).
  7. `docs/reference/changelog.md` `## [Unreleased]` and `docs/architecture/generated/*` are **integrator-owned**. No
     phase edits `scripts/ci/backend-integration-groups.sh` (B3 adds one case to
     `server/tests/integration/repositories/walletSyncCrossNetworkContract.test.ts`, already registered at `:89`; no
     new integration spec), `config/resource-lifecycle-callsites.json` (no new callsite: C1's `kill -HUP` lives in a
     compose command and the test only `wait`s; C2's helper adds none; checker complete at 416 identities on the
     patched trees), `scripts/quality/safety-catch-allowlist.json` (no catch added),
     `scripts/quality/large-file-classification.json`, or `config/container-image-lock.json`.
  8. **C2's guard reads the integrated tree.** `tests/ci/classify-quality-scope.test.sh` derives the classifier
     suites' executed subjects from `quality.yml` at test time, so it re-checks every phase's files on the integrated
     branch; A and B add no classifier suite and no import into one (the integrator runs it in the block). A1's
     `scripts/generate-signer-inventory.mjs` becomes a routed classifier subject through C2 (an `esm-main-guard`
     `SITES` entry); its edit only selects a job the integrated PR runs anyway.
- **D-17.X7 e2e-helper sweep.** Each phase lists the `tests/e2e` helpers and specs that touch its behaviour, with the
  verdict. No phase adds an API endpoint, so no mock map changes.

  | Phase | `tests/e2e` helpers/specs touching the behaviour | Verdict |
  |---|---|---|
  | A1, A2 | none (wallet sync is server-side; the e2e harness mocks the whole API; address-list mocks such as `create-wallet-flow.spec.ts:352-360` are fixed data) | n/a |
  | B1 | the `/agent/*` bearer API has no UI caller and no e2e mock; `tests/e2e/adminOperationsFixtures.ts:38-55` (agent fixtures) are unchanged | No edit. |
  | B2 | `grep -rn "transactions/batch" tests/e2e` is empty; the send e2e mocks only `POST …/transactions/create` (`send-transaction-flow.spec.ts:468`), whose response and client path (`recipient` absent → `state.outputs[0]`) are unchanged | No edit. No PNG may change. |
  | B3 | `renderRegressionChoiceFocus.contracts.ts:23` mocks only `GET /admin/support-package/incident-capture`; no spec generates a package | n/a |
  | C1, C3, C2 | none (compose/nginx/Tor config and a CI classifier) | n/a |
- **D-17.X8 architecture graphs.** `docs/architecture/generated` is regenerated once by the integrator in the
  integration worktree (real root `npm ci`, never a symlink: the arch:check worktree-symlink artifact drops
  `shared/*` edges). Expected change: none or a server-graph edge inside an existing collapsed edge. B1's
  `agent/auth.ts` drops `repositories/walletRepository` and adds `services/accessControl` (the collapsed
  `agent → services` edge already exists, `docs/architecture/generated/server.md:98`; `agent → repositories` stays via
  `agentRepository`) and `@sanctuary/shared/constants/walletRoles` (an external-package edge in the server graph);
  B2's `src/hooks/send/types.ts` imports `@sanctuary/shared/utils/bitcoin`, which the two hooks already import (and
  drop); A2's new imports are within `services/bitcoin/sync` and `services/bitcoin/blockchain → sync` (existing); C's
  files are outside the graph globs (`scripts/architecture/generate-graphs.mjs:30-58`). Whatever `arch:graphs`/
  `arch:calls` produce is committed in the integrator commit. *(/simplify: `agent/auth.ts` and
  `adminAgentService.ts` no longer import `@sanctuary/shared/constants/walletRoles`; they import
  `findAgentWalletAccessProblem` from the new `services/agentWalletAccess.ts`, which imports `repositories`,
  `services/accessControl` and `@sanctuary/shared/constants/walletRoles`. Every collapsed edge it adds already exists
  (`agent → services`, `services → repositories`, `services → shared`), so the expected graph change is still none.)* The Architecture lane is not PR-required: watch its
  post-merge run on `main`.

### Phase file ownership (disjoint; one worktree and branch per phase)

| Phase | Production files | Test files | Other |
|---|---|---|---|
| a | **A2:** `server/src/services/bitcoin/sync/attemptRuntime.ts`, `server/src/services/bitcoin/sync/phases/fetchHistories.ts`, `server/src/services/bitcoin/sync/historyEvidenceAuthentication.ts`, `server/src/services/bitcoin/sync/evidenceAuthentication.ts` (`:465`; /simplify adds `isAttemptCancelled` at `:223`/`:465` and the shared batch constant), `server/src/services/bitcoin/blockchain/syncWallet.ts`. **A1:** `server/src/services/bitcoin/sync/addressDiscovery.ts`, `scripts/generate-signer-inventory.mjs` (`:107` removed), `config/hardware-wallet-implementation-inventory.json` (regenerated, never hand-edited) | **A2:** new `server/tests/unit/services/bitcoin/sync/historyStageBudget.test.ts`, `server/tests/unit/services/bitcoin/sync/attemptRuntime.test.ts`, `server/tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts`, `server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts` and `server/tests/unit/services/bitcoin/sync/receiveEvidenceCompactStaging.test.ts` (one caller line each, /simplify; no growth). **A1:** `server/tests/unit/services/blockchainService/address-discovery.contracts.ts`, `server/tests/unit/services/bitcoin/blockchain/gapLimit.contracts.ts` | **A2:** `docs/plans/wallet-sync-progress-timeout-remediation.md` (`:48-59`, D-17.A2e). **A1:** `docs/explanation/address-derivation.md` (`:279`, one sentence, D-17.A1e) |
| b | **B1:** `server/src/agent/auth.ts`, `server/src/services/adminAgentService.ts`, `server/src/api/openapi/paths/agent.ts`, new `server/src/services/agentWalletAccess.ts` (`findAgentWalletAccessProblem`; /simplify, see D-17.B1b). **B2:** `server/src/api/transactions/drafting.ts`, `server/src/api/openapi/schemas/transactions.ts`, `shared/schemas/transactionResponses.ts`, `src/hooks/send/types.ts`, `src/hooks/send/useBroadcast.ts`, `src/hooks/send/useDraftManagement.ts`, `src/components/send/SendTransactionWizard/types.ts`, `src/components/send/SendTransactionWizard/draftTransactionData.ts`, `src/components/send/SendTransactionPage/types.ts`, `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts`, `src/api/transactions/types.ts` (`CreateBatchTransactionResponse.recipient`). **B3:** `server/src/repositories/subscriptionCoverageReadRepository.ts`, `server/src/repositories/subscriptionCoverageRepository.ts` (type re-export), `server/src/services/sync/schedulerRetirementReadiness.ts`, `server/src/services/supportPackage/collectors/schedulerRetirementReadiness.ts` | **B1:** `server/tests/unit/agent/auth.test.ts`, `server/tests/unit/services/adminAgentService.test.ts`, new `server/tests/unit/services/agentWalletAccess.test.ts` (helper cases, /simplify), `server/tests/unit/api/adminAgentsRoutes.testHarness.ts`, `server/tests/unit/api/admin-agents-routes.fixtures.ts`, `server/tests/unit/api/admin-agents-routes.test.ts`, `server/tests/unit/api/agent-wallet-funding-smoke.test.ts`, `server/tests/unit/api/openapi.transfers-agent.test.ts`. **B2:** `server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts.ts`, `server/tests/unit/api/openapi.wallet.contracts.ts`, `tests/hooks/useBroadcast.test.tsx`, `tests/hooks/useDraftManagement.test.tsx`, `tests/components/send/draftTransactionData.test.ts`, `tests/shared/transactionResponses.test.ts`, `tests/hooks/useSendTransactionActions/useSendTransactionActions.drafts.contracts.tsx`. **B3:** `server/tests/unit/repositories/subscriptionCoverageRepository.test.ts`, `server/tests/unit/services/supportPackage/schedulerRetirementReadinessCollector.test.ts`, `server/tests/integration/repositories/walletSyncCrossNetworkContract.test.ts` (one case) | **B1:** `docs/how-to/agent-wallet-funding.md` (one sentence under "Register An Agent", `:23`) |
| c | **C1:** `docker/tor/payjoin-ingress.conf`, `docker/compose/tor.yml`, `docker/nginx/docker-entrypoint.sh`. **C3** (after C1, same phase): `docker/tor/payjoin-ingress.conf` (one line). **C2:** `scripts/ci/classify-quality-scope.sh` | **C1:** `tests/config/torIngress.test.ts`. **C3:** `tests/config/torIngress.test.ts` (one case + one helper). **C2:** `tests/ci/classify-quality-scope.test.sh`, new `tests/ci/lib/classifier-suite-subjects.mjs` (test-side helper, not a suite) | — |

Integrator-owned: `docs/reference/changelog.md` (`## [Unreleased]`) and `docs/architecture/generated/*`. Read-only for
everyone: `config/wallet-safety-mutation-map.json`, every `server/stryker*.mjs` and `config/tooling/stryker*.mjs`,
`server/scripts/mutation/**`, `shared/constants/hardwareWalletCapabilities.ts`, `server/src/api/drafts.ts`,
`server/src/api/transactions/broadcasting.ts`, `server/src/services/draftCreate.ts`,
`server/src/services/agentApiService.ts`, `server/src/runner.ts`'s support-package fence and
`server/src/services/supportPackage/runner.ts`, `config/wallet-sync-*.json`, `scripts/perf/**`, every
`scripts/verify-addresses/sourceManifest.ts` `VERIFIER_SOURCE_FILES` entry (including
`.github/workflows/verify-vectors.yml` and `scripts/ci/docker-endpoint-lib.sh`), every workflow file
(`.github/workflows/quality.yml` is **read** by C2's helper, never edited), `tests/install/**` (C2 routes three of
these files but does not edit them), `docker/nginx/default*.conf.template`, `docker/compose/offline-tor.yml`,
`scripts/ci/classify-files-lib.sh`, `config/resource-lifecycle-callsites.json`,
`scripts/quality/large-file-classification.json`, `config/container-image-lock.json`, `scripts/quality.sh`,
`server/prisma/**`, `server/tests/unit/services/bitcoin/sync/phases.test.ts` (1,024 lines) and
`receiveEvidenceAuthentication.test.ts` (1,216 lines) (A2's new cases go in a new file so neither large file grows;
/simplify changes one `authenticateHistoryResults` caller line in the latter, no growth),
every display-gated file in the A1 surface table, and every `tests/e2e` mock map and PNG baseline.

## Phase A — background gap discovery without the display freeze, and history budgets that scale with the wallet (A2, A1; folds in one P3)

All file:line references below were re-verified at `c81b2d372576da75efa0b9406dc480777b1dbb7f`
(`/home/nekoguntai/sanctuary-bug-scrub-20261013-i17`). Every fix and every red test was prototyped on a scratch copy of
that tree (`scratchpad/p17a/tree`: a tar copy without `.git`, with root and server `node_modules` symlinked from the
primary checkout, the primary checkout's generated Prisma client (`schema.prisma` is identical), and a local
`shared/dist` rebuilt from the i17 `shared/` sources, because the primary checkout's `shared/` differs). The reds
quoted below are **observed** on that copy with the base source files swapped back in. Prototype diffs:
`scratchpad/plan17-A2-prototype.patch` and `scratchpad/plan17-A1-prototype.patch`. Run logs are in `scratchpad/p17a/`
(`a1-red.txt`, `a1-red-gaplimit.txt`, `a2-red.txt`, `a2-red-p3only.txt`, `a2-red-runtime.txt`, `a2-red-recursion.txt`,
`a1-green.txt`, `a-broad.txt`, `a-broad2.txt`).

**Commit order: A2, then A1, in one PR.** A1 makes every wallet derive and watch more addresses, and makes the
recursive gap pass in `syncWallet` reachable for the first time since #781. Both raise the history work per attempt.
A2 has to be in place first, so no commit on the branch has A1 without A2. Neither phase can be held without the
other (D-17.X3).

The open questions this section raised are decided above (USER DECISION, OQ-A1, OQ-A2). The A1 legacy-wallet skip
(D-17.A1b) and the A2 recursion window guard (D-17.A2c) are coherence guards that the decoupling and the scaling each
need; they are not scope growth.

Phase-local file ownership (both rows belong to phase `a` in the plan-level table):

| Phase | Production files | Test files | Other |
|---|---|---|---|
| A2 | `server/src/services/bitcoin/sync/attemptRuntime.ts` (3 constants + `workScaledStageBudgetMs`, `syncHistoryWindowMs`, `createSyncWindowRuntime`), `server/src/services/bitcoin/sync/phases/fetchHistories.ts` (`:15-20` imports, `:48-50`, `:94`), `server/src/services/bitcoin/sync/historyEvidenceAuthentication.ts` (opener type, `runEvidenceStage`, `:123-141`), `server/src/services/bitcoin/sync/evidenceAuthentication.ts` (`:465` only), `server/src/services/bitcoin/blockchain/syncWallet.ts` (`:21-27` import, guard after `:174`) | new `server/tests/unit/services/bitcoin/sync/historyStageBudget.test.ts` (225 lines), `server/tests/unit/services/bitcoin/sync/attemptRuntime.test.ts` (147 → 190: 3 imports, 2 `it.each`, 1 `it`), `server/tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts` (587 → 618: +1 import, +1 case; /simplify +1 case), `server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts`, `server/tests/unit/services/bitcoin/sync/receiveEvidenceCompactStaging.test.ts` (/simplify: one caller line each, size unchanged) | `docs/plans/wallet-sync-progress-timeout-remediation.md` (`:48-59`, D-17.A2e); changelog bullet (integrator) |
| A1 | `server/src/services/bitcoin/sync/addressDiscovery.ts` (`:13-15`, `:88-98`), `scripts/generate-signer-inventory.mjs` (`:107` removed), `config/hardware-wallet-implementation-inventory.json` (regenerated) | `server/tests/unit/services/blockchainService/address-discovery.contracts.ts` (`:77-114` replaced; one top-level helper; one `beforeEach` line), `server/tests/unit/services/bitcoin/blockchain/gapLimit.contracts.ts` (`:146-155`, one case rewritten) | `docs/explanation/address-derivation.md` (`:279`, one sentence, D-17.A1e); changelog bullet (integrator) |

### Decisions (D-17.A1a–D-17.A2e)

- **D-17.A1a — background discovery does not consult `display`** (USER DECISION). Delete the
  `assertWalletHardwareCapabilityById(walletId, "display")` try/catch from `prepareGapLimitExpansion`
  (`addressDiscovery.ts:88-98`) and its two imports (`:13-14`). Every user-facing path keeps its own gate, unchanged.
  The surface audit is in A1 below. Alternatives rejected:
  - Gate on a new capability such as `watch`. That needs a manifest row and evidence ids
    (`shared/constants/hardwareWalletCapabilities.ts`), and it would be default-deny like the others, so it would
    reproduce the bug.
  - Flag the sync incomplete instead of expanding. The user decided against this: the freeze must not hide funds.
  - Expand only for device-less (watch-only) wallets. Hardware-signer wallets are exactly the ones whose `display` is
    frozen.
- **D-17.A1b — a wallet without canonical policy identity skips expansion and does not fail.** At base,
  `assertPersistedCanonicalPolicy` (`addressDiscovery.ts:100`, added by #789 one day after #781) has never run in
  production: the display gate before it returned `null` for every wallet. If only the gate were removed, every
  legacy wallet (descriptor present, `canonicalPolicyId`/`canonicalPolicyVersion` null) would throw
  `InvalidInputError` in the `gapLimit` phase, and every legacy sync would fail. That contradicts the v0.8.62 parity
  that `pipeline.ts:132-143` promises. Return `null` when `!hasCanonicalPolicyIdentity(wallet)`
  (`server/src/services/wallet/canonicalPolicy.ts:55-60`: true when either field is set) and log at `debug`, because
  this runs every sync. A wallet with an inconsistent identity, where one field is set or the fields do not match the
  policy, still throws (fail closed). That matches `generateAddress` (`addressGeneration.ts:129-137`), which sends
  such wallets to remediation.
- **D-17.A1c — the signer-inventory boundary row is removed, and the inventory is regenerated.**
  `REQUIRED_SERVER_CAPABILITY_BOUNDARIES` (`scripts/generate-signer-inventory.mjs:92-124`) pins the
  `addressDiscovery.ts` display call at `:107`. The exact-projection check fails with
  `Server capability enforcement boundaries drifted` once the call is gone (observed). Delete that row and regenerate
  `config/hardware-wallet-implementation-inventory.json` with `npm run generate:signer-inventory`. The regeneration
  drops the `requiredServerCapabilityBoundaries` entry (`:108-113`) and the
  `server-capability-enforcement:…addressDiscovery.ts…display:1` row (`:4223-4236`); the prototype diff is exactly
  those two hunks (0 additions, 21 deletions). The independent review the row's header comment asks for (`:85-91`)
  is this plan's surface audit.
- **D-17.A1d — keep the recursion's error policy** (OQ-A2). A1 does not touch `scanGeneratedAddresses`' `catch`
  (`syncWallet.ts:184-205`).
- **D-17.A1e — docs.** *(coordinator, at assembly: exact text fixed so the Verification check is deterministic.)*
  `docs/explanation/address-derivation.md`, after the "Gap limit: 20 unused addresses" line (`:279`), one line:
  "- Background sync derives and watches addresses past the gap limit for every wallet with a canonical policy
  identity, whatever the signer's display capability is; showing or handing out an unused address still requires it.
  A legacy wallet without a canonical policy identity skips this discovery until wallet remediation records one."
  *(Adversarial review, P3: the first text implied every wallet; `addressDiscovery.ts` still returns early for a
  wallet without a canonical policy identity, so the sentence names that scope.)*
- **D-17.A2a — work-scaled history stages inside one history window sized from the time left.**
  `fetchHistoriesPhase` opens a window `createSyncWindowRuntime(attempt, syncHistoryWindowMs(attempt.deadlineAt,
  now), now)`, where `syncHistoryWindowMs(deadlineAt, now) = min(SYNC_HISTORY_WINDOW_MS, max(0, floor((deadlineAt −
  now) × 2/3)))` (review pass 1). `SYNC_HISTORY_WINDOW_MS` is 20 min, two thirds of the default
  `WALLET_SYNC_MAX_EXECUTION_MS` (`server/src/constants/walletSyncActivation.ts:22`). The relative bound matters
  because neither "the attempt is 30 minutes" nor "the phase starts at t≈0" holds:
  - the attempt is `getConfig().sync.maxSyncDurationMs` (`worker/jobs/canonicalIncrementalSync.ts:273-275`), which an
    operator may set anywhere in `[1 s, 30 min]` (`SYNC_MAX_DURATION_MS`, `config/schema.ts:142`,
    `config/envSections.ts:83`). With an absolute 20-minute window a 10-minute attempt would let history work run to
    the attempt deadline, so the post-history phases (`fetchUtxos`, the receive gate, `gapLimit`, then
    `populateMissingTransactionFields` and `enrollWalletSubscriptions`, `canonicalIncrementalSync.ts:300-325`) would
    never run; base's single 5-minute stage left them 5 minutes;
  - `initial_network` (`pipeline.ts:98`) and, on a full resync, `assertFullResyncChainReachable` +
    `resetWalletForFullResync` (`canonicalIncrementalSync.ts:277-299`) run before the window opens.

  So the window always leaves at least a third of the remaining attempt (10 min at the default when the phase starts
  at once; 200 s of a 10-minute attempt). It then creates three sequential stages from that window, each
  budgeted `workScaledStageBudgetMs(items) = max(SYNC_REMOTE_STAGE_BUDGET_MS, ceil(items/10) × 3 s)` from its own exact
  count:
  - `address_histories`: the stored addresses;
  - `history_transactions`: the distinct history txids;
  - `history_parents`: the distinct parent txids of the accepted transactions.

  `createSyncStageRuntime` already caps each stage at the window (`attemptRuntime.ts:54`).
  - Effect on small wallets: every stage of up to 1,000 items keeps today's 5-minute budget.
  - Effect on large wallets: each stage gets 3 s per sequential round trip, and the whole phase still ends at least a
    third of the remaining attempt before its deadline (10 minutes at the default), so the persisting phases and the
    receive-evidence gate still run.

  The 3 s allowance is a Tor round trip plus a ten-item raw-hex transfer. The finding models 0.5–1 s RTT plus
  transfer. Alternatives rejected:
  - One fixed larger budget (for example, 20 minutes for every wallet). A slow server would then hold a small wallet
    four times longer before the retry.
  - A progress-renewed stall timer. It needs progress callbacks threaded through `evidenceAuthentication.ts`'s batch
    loops, which is a wider change on the authentication path, and it gives the same bound.
  - Sizing one stage from the address count. The transaction and parent counts are not known when the phase starts.
- **D-17.A2b — fold in P3 `fetch-histories--budget-expiry-continuation-throws-in-history-authentication`.** The lock
  in `evidenceAuthentication.ts:465` (`withOutpointFetchLock`) throws `signal?.throwIfAborted()` for any aborted
  signal. With D-17.A2a this is still reachable: a window that is exhausted creates the `history_parents` stage
  already expired (`attemptRuntime.ts:65-67`), and the lock then throws the budget error out of the phase. That turns
  the documented continuation into an attempt failure classified `other`, and the later phases persist nothing.
  Change the line to `if (signal?.aborted && isAttemptCancellation(signal.reason)) signal.throwIfAborted();`, the
  module's own budget contract (`:53`, `:246`, `:329`), as the i17 verifier specified (`scratchpad/v17fh-verdict.md`,
  "Smallest fix"). Do not instead skip the parent step after a budget expiry: the verifier showed that would silently
  drop spend-only history entries (`historyEvidenceAuthentication.ts:94-98`).
- **D-17.A2c — recursion starts only when a whole history window still fits.** In `scanGeneratedAddresses`, after
  `persistOwnershipRepair` and before `return syncWallet(...)` (`syncWallet.ts:174-175`), return `undefined` when
  `input.attemptDeadlineAt - Date.now() < SYNC_HISTORY_WINDOW_MS`. The generated rows are already durable (written by
  the depth-0 `gapLimit` phase), and so are the repair targets, so the next sync (≤ 5 min) continues the discovery.
  Without the guard, A1 makes a deep import run recursive full-history passes into the attempt deadline; the attempt
  would then be cancelled, and that cancellation propagates (`:202`) and burns a job attempt. **The guard and the
  window share one bound** (review pass 1): the recursive pass opens its own window through the same
  `syncHistoryWindowMs`, so with R ≥ 20 min left its window is `min(20 min, ⌊2R/3⌋)` and leaves it at least R/3 ≥ 6.7
  min for its post-history phases (an absolute window would have left 30 s at R = 20.5 min). An attempt configured
  at 20 minutes or less never recurses; the next sync continues. With `attemptDeadlineAt = +∞` (callers with no
  runtime) recursion is unchanged and the window is 20 min. `MAX_GAP_LIMIT_RECURSION` (`:63`, 10) is unchanged.
  *(/simplify, efficiency: the guard is now `syncHistoryWindowMs(input.attemptDeadlineAt) <
  SYNC_REMOTE_STAGE_BUDGET_MS`. The window already leaves the attempt at least a third of the time left, so requiring
  a whole 20-min window was redundant and stopped every attempt of 20 min or less from recursing; recursion now runs
  whenever its window fits one stage budget (R ≥ 7.5 min).)*
- **D-17.A2d — no cross-attempt reuse in this phase** (OQ-A1). The memory bound and the iteration-15 evidence
  ceilings (`evidenceAuthentication.ts:37-47`, `MAX_AUTHENTICATED_*`) are untouched. A2 changes time budgets only, and
  the per-attempt evidence accounting (`complexityFor`, `:133-147`) applies across the three stages exactly as it did
  across one.
- **D-17.A2e — the design doc's budget sentence is amended.** `docs/plans/wallet-sync-progress-timeout-remediation.md:48-59`
  currently states that "one test-injected five-minute deadline spans the complete address-history phase" and that
  Tor "does not receive a larger stage budget". Replace those two clauses with one sentence *(coordinator, at
  assembly: exact text fixed; review pass 1: window bound to the time left)*: "The address-history phase runs inside
  one window of at most 20 minutes and at most two thirds of the time left in the attempt, and each of its three
  stages (history fetch, history transactions, their parents) is budgeted `max(5 min, 3 s per ten items)` from its
  own item count." The surrounding statements (nested helpers never reset a budget; recursion never creates a fresh
  outer budget) stay.

### Phase A2 — History stages budgeted from their own work inside one window; the budget-expiry continuation reaches the gate (P2 `wallet-sync--history-budget-fixed-regardless-of-wallet-size-permanent-failure`; folds in P3 `fetch-histories--budget-expiry-continuation-throws-in-history-authentication`)

**Evidence (re-verified at c81b2d372).**
- `attemptRuntime.ts:7` `SYNC_REMOTE_STAGE_BUDGET_MS = 5 * 60_000`. `createSyncStageRuntime` defaults to it
  (`:47-52`) and caps it at the attempt deadline (`:54`). `fetchHistories.ts:48-50` creates the single
  `address_histories` stage with that default. The same `requestOptions` (`:51-53`) cover the history fetch (`:58`)
  and the whole-history authentication (`:94`).
- The history fetch is sequential, 10 addresses per batch (`fetchHistories.ts:32`, `:122-130`), over **all** stored
  addresses (`pipeline.ts:130`). Authentication fetches every distinct history txid
  (`historyEvidenceAuthentication.ts:134-137` → `evidenceAuthentication.ts:347-393`, 10 per batch, `:35`). It then
  fetches every distinct parent of every accepted transaction (`historyEvidenceAuthentication.ts:24-40`, `:138-141` →
  `evidenceAuthentication.ts:560-574`). All of it is sequential and inside one 5-minute stage.
- Nothing carries across attempts. The evidence maps and caches start empty per context (`context.ts:120-153`), a
  failed phase releases them (`pipeline.ts:244`), and Electrum histories are not cached. The attempt is 30 minutes
  (`constants/walletSyncActivation.ts:22`). The job retries 3 times (`server/src/jobs/syncJobContract.ts:172-175`) and
  then goes `action_required`.
- The P3. When the history fetch outlives the budget, the inner `catch` (`fetchHistories.ts:59-79`) records
  `fetch_budget_exhausted` per unsettled address and continues. `authenticateHistoryResults(ctx, requestOptions)`
  (`:94`) then gets the already-aborted stage signal. The current-transaction fetch records budget rejections
  (`evidenceAuthentication.ts:342-345`). `withOutpointFetchLock` (`:465`) then throws the budget error
  unconditionally, `historyEvidenceAuthentication.ts:153-160` rolls back and rethrows, and the pipeline fails at
  `fetchHistories` (`pipeline.ts:243-259`).
- Observed on base, from the new red tests below: a 2,000-address wallet at 1.8 s per history batch, and a
  2,000-transaction history at 1.6 s per evidence batch, both reject with `SyncRemoteStageBudgetError` (budget
  exhausted at 300 s). With **only** the D-17.A2b line fixed, they resolve but record
  `fetch_budget_exhausted => 341` and `=> 130`, so the receive gate would refuse every attempt
  (`scratchpad/p17a/a2-red-p3only.txt`). That separates the scaling fix from the P3 fix.

**Root cause.** The budget that stops a stalled stage is a constant applied to work that grows with the wallet. The
same constant also covers three sequential sub-steps whose sizes become known only one after another. Separately, the
outpoint lock ignores the module's budget-versus-cancellation contract, so even the documented degraded path fails
the attempt.

**Production change** (`plan17-A2-prototype.patch`).
- `attemptRuntime.ts`, after `:8`:
  ```ts
  export const SYNC_REMOTE_BATCH_SIZE = 10;
  export const SYNC_REMOTE_BATCH_ALLOWANCE_MS = 3_000;
  export const SYNC_HISTORY_WINDOW_MS = 20 * 60_000;
  ```
  Each constant gets a doc comment (see the patch). `SYNC_HISTORY_WINDOW_MS`'s comment calls it the ceiling and
  names `syncHistoryWindowMs` as the window actually opened (never more than two thirds of the time left); it does
  not claim a 30-minute attempt. Three exported helpers go before `isSyncStageBudgetError`:
  - `workScaledStageBudgetMs(items)` returns
    `Math.max(SYNC_REMOTE_STAGE_BUDGET_MS, Math.ceil(Math.max(0, items) / SYNC_REMOTE_BATCH_SIZE) * SYNC_REMOTE_BATCH_ALLOWANCE_MS)`;
  - `syncHistoryWindowMs(attemptDeadlineAt, now = Date.now())` returns
    `Math.min(SYNC_HISTORY_WINDOW_MS, Math.max(0, Math.floor((attemptDeadlineAt - now) * 2 / 3)))` (an infinite
    deadline gives `SYNC_HISTORY_WINDOW_MS`; an expired one gives 0);
  - `createSyncWindowRuntime(attempt, windowMs, now = Date.now())` returns `{ ...attempt, deadlineAt: Math.min(attempt.deadlineAt, now + Math.max(0, windowMs)) }`.
- `fetchHistories.ts`. Replace `:48-50` with `const windowOpenedAt = Date.now()`, the window
  `createSyncWindowRuntime(ctx.attemptRuntime, syncHistoryWindowMs(ctx.attemptRuntime.deadlineAt, windowOpenedAt),
  windowOpenedAt)` and an `openStage(name, items)` closure that returns
  `createSyncStageRuntime(window, name, workScaledStageBudgetMs(items))`, and set
  `const stage = openStage?.('address_histories', addresses.length)`. Change `:94` to
  `await authenticateHistoryResults(ctx, undefined, openStage)`. Callers without `attemptRuntime` keep `undefined`
  stages, as they do today.
- `historyEvidenceAuthentication.ts`:
  - Add an optional third parameter `openStage?: HistoryEvidenceStageOpener`, typed
    `(stage: string, items: number) => SyncStageRuntime` with a type-only import from `./attemptRuntime`.
  - Add a `runEvidenceStage` helper. It opens the stage, passes `{ ...options, signal, deadlineAt }`, and disposes the
    stage in `finally`. Without an opener it passes `options` through, which keeps the two existing direct callers
    unchanged: `receiveEvidenceCompactStaging.test.ts:427` and `receiveEvidenceAuthentication.test.ts:1053`.
  - Run the current fetch in a `'history_transactions'` stage sized by `currentTxids.length`. Then compute
    `parentRequests`, and run the parent fetch in a `'history_parents'` stage sized by `parentRequests.size`.
  - The snapshot and rollback (`:127-132`, `:153-160`) are unchanged. No `catch` is added.
- `evidenceAuthentication.ts:465` → `if (signal?.aborted && isAttemptCancellation(signal.reason)) signal.throwIfAborted();`
  plus a one-line comment (D-17.A2b).
- `syncWallet.ts`. Import `SYNC_REMOTE_STAGE_BUDGET_MS` and `syncHistoryWindowMs` from `../sync/attemptRuntime`
  (/simplify; originally `SYNC_HISTORY_WINDOW_MS`). After `:174`, add the D-17.A2c guard
  with an `info` log `'[BLOCKCHAIN] Deferring the recursive gap-limit sync to the next sync'` and fields
  `{ walletId, depth }`, and a comment that the recursive pass's window (`syncHistoryWindowMs`) still leaves it a
  third of the time left.

**Failing-first tests.**
1. New `server/tests/unit/services/bitcoin/sync/historyStageBudget.test.ts` (225 lines). It runs the real
   `fetchHistoriesPhase`, the real evidence modules, and the real compact projector in-process (the same
   `transactionEvidenceThread` mock as `historyEvidenceAttemptCeiling.test.ts:24-53`). It uses real bitcoinjs
   coinbase-funded wallet payments, fake timers, and a client whose batch calls resolve after a fixed latency or hang
   until the stage aborts. Cases:
   - "completes a history fetch that needs more than five minutes of round trips": 2,000 addresses at 1.8 s per batch
     (360 s). Expects `ctx`, no rejections, and the receive gate passing.
   - "authenticates a history whose transaction evidence needs more than five minutes": 2,000 transactions at 1.6 s
     per batch (320 s). Expects `ctx`, no rejections, and `allTxids.size === 2000`.
   - "records the unsettled addresses and reaches the retryable receive gate": the history fetch hangs. Expects
     `ctx`, `fetch_budget_exhausted => 2`, and the gate rejecting with `ReceiveEvidenceRetryableError`.
   - "records each unsettled transaction when its evidence outlives the stage budget": the evidence fetch hangs.
     Expects `ctx`, `fetch_budget_exhausted => 2`, and the gate throwing `fetch_budget_exhausted x 2`.
   - "still fails the phase on attempt cancellation": the control. Expects a rejection with the attempt's reason.
   - "fetchAuthenticatedOutpoints records pending parents after a budget expiry instead of throwing": a pre-aborted
     `SyncRemoteStageBudgetError('history_parents')` signal. Expects the call to resolve with
     `fetch_budget_exhausted => 1`.
   - "fetchAuthenticatedOutpoints still rejects with the reason of an attempt cancelled before the lock" (review pass
     1; **unconditional**, because it is the only test that reaches the cancellation arm of the `:465` condition): a
     signal pre-aborted with a plain `Error('lease lost')`. Expects the call to reject with exactly that error and no
     rejected-evidence entry. Green on base (the base lock throws for any aborted signal).

   **Observed red on base** (`scratchpad/pr1/a2-red-budget.txt`, pass 1): `Tests 5 failed | 2 passed (7)` (messages
   under D-17.X3). Both cancellation controls are green on base. Green after the fix: 7/7.
2. `server/tests/unit/services/bitcoin/sync/attemptRuntime.test.ts`:
   - New `it.each` "budgets %i items at %i ms (five-minute floor, 3 s per ten-item round trip)" with rows
     `[0, 300000]`, `[1000, 300000]`, `[1001, 303000]`, `[20000, 6000000]`.
   - New `it` "caps every work-scaled stage at the history window inside the attempt". It asserts
     `SYNC_HISTORY_WINDOW_MS < WALLET_SYNC_MAX_EXECUTION_MS`, that a stage budgeted for 1e9 items ends at the window,
     and that re-narrowing does not widen.
   - New `it.each` (review pass 1) "opens a %i ms attempt's history window at %i ms (two thirds of the time left at
     most)" with rows `[30 * 60_000, 20 * 60_000]` and `[10 * 60_000, 400_000]`. Each row asserts
     `syncHistoryWindowMs(10_000 + attemptMs, 10_000)` and that `createSyncWindowRuntime` with it ends the window at
     `10_000 + windowMs`. The 10-minute row is the regression: an absolute window would end at the attempt deadline
     (`10_000 + 600_000`). Both rows are **red on base as new-behaviour tests** (`TypeError: syncHistoryWindowMs is
     not a function`); the 10-minute row would also be red against the pass-0 absolute window.

   **Observed red** (`scratchpad/pr1/a2-red-runtime.txt`, pass 1): `Tests 7 failed | 9 passed (16)`, with
   `TypeError: workScaledStageBudgetMs is not a function` (×4), `TypeError: createSyncWindowRuntime is not a
   function` and `TypeError: syncHistoryWindowMs is not a function` (×2). Green after the fix: 16/16.
3. `server/tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts`: new case "defers the recursive sync
   when less than one history window remains in the attempt". The deadline is `Date.now() + SYNC_HISTORY_WINDOW_MS -
   60_000`, and the generated address has history. The pipeline mock gives a second result so that the base red is an
   assertion. Expects the ownership-repair insert to have run, `executeSyncPipeline` to have been called once, and the
   depth-0 result. **Observed red** (`scratchpad/pr1/a2-red-recursion.txt`, re-observed in pass 1): `Tests 1 failed |
   14 passed (15)`,
   `AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times`. Green after the fix: 15/15. The
   existing "records and closes a recursive address-history budget fallback" case (deadline `Date.now() - 1`, empty
   history) stays green: it returns before the guard.
   *(/simplify: the case is renamed "defers the recursive sync when its history window would be shorter than one
   stage budget" with deadline `Date.now() + SYNC_REMOTE_STAGE_BUDGET_MS * 3 / 2 - 30_000`; a new case "recurses
   inside a 10-minute attempt whose history window still fits a stage budget" was red on `b9657f6d9`
   (`expected "vi.fn()" to be called 2 times, but got 1 times`, `scratchpad/i17-fix-red.txt`) and is green after the
   guard change: 16/16.)*

Confirm red (phase `a` worktree at the plan commit, the A2 tests added, A2 production files at base): `cd server &&
npx vitest run tests/unit/services/bitcoin/sync/historyStageBudget.test.ts
tests/unit/services/bitcoin/sync/attemptRuntime.test.ts tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts`
→ the three totals above; save as `$SCRATCH/i17-a-red-a2.txt`.

**Green criteria.**
- The three files above are green: `38 passed (38)` (`scratchpad/pr1/a2-green.txt`, pass 1).
- The existing sync and blockchain suites are green unchanged. Observed on the prototype:
  - `tests/unit/services/bitcoin/sync`, `tests/unit/services/bitcoin/blockchain`, `blockchain.test.ts`,
    `blockchain.syncWalletRecursion.test.ts` and `blockchainService.test.ts`: `76 files, 1437 tests` passed
    (`a-broad.txt`).
  - `tests/unit/services/bitcoin` plus the wallet and display-surface suites: `6065 passed`, plus one failure,
    `hardwareSignedEvidenceProvenance.test.ts`'s Git-ancestry case, which fails only because the scratch copy has no
    `.git` (`a-broad2.txt`). It is not a stop; in a real worktree it must pass.
- No test pins the old throw. The verifier's watch list (`receiveEvidenceAuthentication*.test.ts`,
  `evidenceOutpointConcurrency.test.ts`, `phases.utxoReconciliation*`) is green unchanged.
- `npx tsc --noEmit` and `npm run typecheck:tests` are clean in the prototype, apart from one `csrf.ts` TS2883
  portability message caused by the symlinked `node_modules`. It does not occur in a real `npm ci` worktree.

**Mutation pins, boundaries, replay, provenance (all checked at c81b2d372; nothing to re-pin).**
- No touched file is in `config/wallet-safety-mutation-map.json` (its `path`s are `advancedTx/*`, `psbt*`,
  `rawTransactionEvidence.ts`, `signingIntent/*`, `transactions/*`, `transactionWeight.ts`, `utxoSelection.ts` and
  `hardwareWallet/psbtAccountBinding.ts`). None is in a `server/stryker*.mjs` `mutate` list (`stryker.receive-evidence`
  mutates only `rawTransactionEvidence.ts`), in `server/scripts/mutation/shards.mjs`, or in the
  `is_critical_mutation_file` list (`scripts/ci/classify-files-lib.sh:206-209`).
- No repository call is added or moved. `npm run check:wallet-sync-mutation-boundaries` reports "verified 48
  repository callsites" (prototype). `syncWallet.ts`'s boundary rows (`config/wallet-sync-mutation-boundaries.json:49-51`)
  key on enclosing function, method and count, not line.
- No `utxoRepository` writer is added, so the replay driver (`scripts/perf/wallet-sync-persistence-driver.cjs`) and its
  seal are unchanged. No Prisma schema or migration change.
- `npm run check:wallet-sync-lifecycle-contract` passed (prototype).
- No `VERIFIER_SOURCE_FILES` entry is touched. `services/bitcoin/**` is on `config/wallet-safety-critical-paths.json`
  (`:11`), so verify-vectors runs once on the PR.
- No `finalize*` or signer identifier is added.

**Coverage branches (integrator, `cd server && npx vitest run --coverage tests/unit`).**
- `workScaledStageBudgetMs`: both `Math.max` arms (the `it.each` rows).
- `createSyncWindowRuntime`: the window is the shorter (new `it`); the attempt is the shorter (the existing
  `phases.test.ts:285` budget case, deadline `now + 100`). `syncHistoryWindowMs` has no branch (`Math.min`/`Math.max`);
  both of its bounds are exercised by the new `it.each` rows.
- `fetchHistories` `window ?`: both arms (existing no-runtime cases and new runtime cases).
- `runEvidenceStage`: with an opener (new file) and without (`historyEvidenceAttemptCeiling.test.ts`,
  `receiveEvidenceCompactStaging.test.ts`).
- The lock condition: no signal; not aborted; budget-aborted (new outpoint case); cancellation-aborted (the new
  unconditional "attempt cancelled before the lock" case). *(Review pass 1 correction:
  `receiveEvidenceCompactStaging.test.ts:427` does not reach this arm; it aborts inside `projectorControl.beforeCompact`,
  after the lock check has passed with an un-aborted signal. An instrumented run of `tests/unit/services`,
  `tests/unit/worker`, `tests/unit/api/sync.test.ts` and `tests/unit/api/bitcoin` hit the arm 0 times, and backend
  branch coverage is 100%.)*
- `syncWallet` guard: both arms (the new defer case, and the infinite-deadline case at `:39`).

**Lizard.** Pinned lizard 1.24.0 `-C 15 -T nloc=200` on all A2 files reports one warning only:
`fetchCompactWithProjector` (`evidenceAuthentication.ts:322`, CCN 17, NLOC 50). It is already one of the base 83, is
not edited, and stays at `:322`. `scanGeneratedAddresses` goes from CCN 13 to 14 and from 71 to 78 NLOC. The new
helpers are top-level `const`/`function` declarations with CCN ≤ 3. The new test file declares its helpers at top
level and nests no `function` inside a `describe`.

**Compatibility, concurrency.**
- Workers of mixed versions only differ in how long a large wallet's history phase may run. Both versions stay
  inside the same 30-minute attempt and lease.
- The stages are sequential within one attempt. `withOutpointFetchLock` still serializes concurrent outpoint fetches.
  The only behaviour change: a caller whose signal is already budget-aborted runs its task, which records
  `fetch_budget_exhausted` per pending parent and extracts already-accepted outputs locally, instead of throwing.
  Attempt cancellation still throws.

**Acceptance.** A wallet whose history fetch, transaction evidence and parent evidence each take longer than 5 minutes
but together fit the history window (20 minutes at the default attempt; at most two thirds of the time left in a
shorter one) completes its sync, and the post-history phases always keep at least a third of the remaining attempt. A wallet whose history work exceeds the window still
reaches the retryable receive gate with its authenticated siblings persisted, instead of failing at `fetchHistories`;
it does not complete (OQ-A1 capacity limit, P3 `wallet-sync--history-work-beyond-attempt-window-never-completes`). A gap
recursion whose history window would not fit one stage budget is deferred to the next sync.

**Rollback.** Revert the commit. No data is written differently, and nothing needs repair. Reverting A2 alone while A1
stays is not allowed (A1 without A2 adds work under the old fixed budget); revert A1 first.

### Phase A1 — Background sync derives and watches past the gap limit; address display and generation stay frozen (P2 `wallet-sync--gap-expansion-blocked-by-display-capability-freeze-hides-funds`, USER DECISION)

**Evidence (re-verified at c81b2d372).**
- `addressDiscovery.ts:88-98`: `prepareGapLimitExpansion` calls `assertWalletHardwareCapabilityById(walletId,
  'display')` and returns `null` on `ForbiddenError`. Its callers are `ensureGapLimit` (`:161`) and the `gapLimit`
  phase (`phases/gapLimit.ts:34`).
- `hardwareWalletCapabilities.ts:30-92` never allows anything except `watch_only` + `import`. `:127-132` throws for a
  wallet with no devices unless the capability is `account_add`. So `display` is denied for every wallet, and no
  wallet derives past the initial 20 + 20 addresses (`addressGeneration.ts:70-87`, `INITIAL_ADDRESS_COUNT`).
- Sync scans only stored addresses (`pipeline.ts:130`). The receive gate runs before `gapLimit`
  (`phases/index.ts:53-65`), and nothing records the undiscovered range, so the sync reports healthy with a short
  balance.
- The skip is pinned as intended by `address-discovery.contracts.ts:85-114` (ledger/jade/trezor, then "propagates
  unexpected capability lookup failures") and by `gapLimit.contracts.ts:146-155`.
- The recursive gap pass already exists (`syncWallet.ts:90-120`, `:140-210`). Once expansion persists rows whose
  history is non-empty, it marks ownership repair and re-runs the pipeline over the new rows. A1 needs no new
  discovery logic.

**Root cause.** #781 placed a user-facing safety gate (`display`: "may this address be shown to a payer?") on a
background, read-only operation (derive and watch). The two have different safety properties, and only the first
needs signer display evidence.

**Surface audit: derived-but-unused rows never reach a user without the display gate.** Gap expansion writes ordinary
canonical `Address` rows, the same kind as the initial 20 that wallet creation already writes without a display
check. Every surface that can return an **unused** address string was traced at c81b2d372:

| Surface | How an unused gap row is kept off it | Verdict |
|---|---|---|
| `GET /wallets/:id/addresses` | `used !== "true"` asserts `display` (`api/transactions/addresses.ts:88-90`), then canonical match (`:102-104`); `used=true` lists only used rows ("used-address history remains viewable", `:86-87`) | gated |
| `GET /wallets/:id/addresses/summary` | counts and balances only (`:146-175`) | no address |
| `POST /wallets/:id/addresses/generate` | `display` (`:200`) | gated |
| receive / `generateAddress` | `display` (`services/wallet/addressGeneration.ts:127`) | gated |
| wallet detail / list | `addressCount` only (`walletQueries.ts:218`); descriptor and fingerprint redacted without `display` (`:22-35`, `:203-214`) | no address |
| wallet update response | `display`, else `addresses: []` (`walletMutations.ts:69-79`) | gated |
| BIP-329 label export | `display` (`api/wallets/export.ts:196`) + `assertUnusedAddressesSafeForDisplay` (`:202`) | gated |
| label detail | `assertUnusedAddressesSafeForDisplay` (`api/labels.ts:77`); `/addresses/:addressId/labels` returns labels for an id the caller already holds (`:199-250`) | gated |
| assistant `search_addresses` / `get_address_detail` / `get_address_summary` | `display` (`assistant/tools/walletReadTools.ts:169-172`); `assertUnusedAddressesSafeForDisplay` (`addressReadTools.ts:85`); counts only (`:42-58`) | gated |
| MCP `wallet-addresses` resource | `display` unless `used=true` (`mcp/resources/index.ts:246-249`) | gated |
| agent operational receive address | `display` (`agentOperationalAddressService.ts:80-83`) | gated |
| agent `operational-address/verify` | echoes only the address the agent supplied (`verifyOperationalReceiveAddress`, `agentOperationalAddressService.ts:154-181`); after A1 it also verifies expanded receive rows, and the funding drafts that would use one stay behind `sign` | not fresh (review pass 1) |
| payjoin BIP21 URI (`GET /payjoin/address/:addressId/uri`) | `assertFreshReceiveAddressSafeForDisplay` (`api/payjoin.ts:223`, route `:209-242`) | gated (review pass 1) |
| change output in a PSBT | `findNextUnusedChange` is reached only through `sign`-gated paths (`api/transactions/drafting.ts:118`, `:213`, `:310`; `api/bitcoin/transactions.ts:184`, `:250`, `:309`; `agentApiService.ts:301`); the estimate route selects no change (`services/bitcoin/estimation.ts`) | gated by `sign` |
| payjoin receiver | `sign` (`services/payjoin/receiver.ts:55`) on an address the payer already holds | gated |
| transactions, UTXOs, `api/bitcoin/address.ts` lookup | show only addresses that have on-chain outputs, or that the caller supplied | not fresh |
| support package | counts only (`supportPackage/collectors/wallets.ts:1-5`) | no address |
| websocket `walletLog` | counts and `currentMax` index only (`addressDiscovery.ts:40-56`, `:140-147`) | no address |

No guard is added. The only behavioural reach is the change-output selection, and it sits behind `sign`, which is
denied for every wallet today. If `sign` is ever enabled, change selection after a wallet uses its first 20 change
addresses would pick an expanded change address. That is the correct, pre-#781 behaviour. An admin full backup
contains address rows as data, and already contains the initial unused 20; it is not a display surface and is
unchanged.

**Production change** (`plan17-A1-prototype.patch`, `addressDiscovery.ts` −13/+13).
```ts
  // Background discovery derives and watches addresses; it never hands one to a
  // user, so it does not consult the signer's `display` capability. Every
  // user-facing surface (address lists, receive, generate, export, labels,
  // assistant, MCP) keeps its own display gate (#781).
  if (!hasCanonicalPolicyIdentity(wallet)) {
    log.debug("Skipping gap expansion for a wallet without canonical policy identity", {
      walletId,
    });
    return null;
  }
```
The imports become `{ assertPersistedCanonicalPolicy, hasCanonicalPolicyIdentity }` from `../../wallet/canonicalPolicy`.
`assertWalletHardwareCapabilityById` and `ForbiddenError` are no longer imported. Then delete
`scripts/generate-signer-inventory.mjs:107` and run `npm run generate:signer-inventory` (D-17.A1c). Add the D-17.A1e
docs line.

**Failing-first tests (the #781 contract tests updated to the user decision).**
1. `server/tests/unit/services/blockchainService/address-discovery.contracts.ts` (run through
   `blockchainService.test.ts`):
   - Add a top-level helper `useProductionCapabilityGate()`. It points the harness mock at the **real**
     `assertWalletHardwareCapabilityById` (`vi.importActual`), so the default-deny manifest is evaluated exactly as in
     production. It is top-level, not nested in a `describe`, because of the lizard nested-function anchor.
   - Add `mockAssertWalletHardwareCapabilityById.mockReset()` to the describe's `beforeEach`, so no implementation
     leaks into the other contract files that share the harness.
   - Replace `:85-114` with:
     - `it.each(["ledger", "jade", "trezor", "no-signer"])` "watches receive addresses past index 19 for a %s wallet
       while address display stays denied". Receive indexes 0–19 are stored with funds on 19, and the change gap is
       already full. The case expects `ensureGapLimit` to return exactly `m/84'/0'/0'/0/20` … `/39`, expects the
       capability mock **not** to be called, and expects the real `display` assertion for the same wallet to still
       reject with `ForbiddenError` (#781 intact).
     - "skips a legacy wallet without canonical policy identity instead of failing sync" (D-17.A1b guard): expects
       `[]`, no derivation and no write.
   - "propagates unexpected capability lookup failures" is deleted: the capability is no longer consulted.

   **Observed red on base** (`a1-red.txt`): `Tests 4 failed | 41 passed (45)`. Each `it.each` row fails with
   `AssertionError: expected [] to deeply equal [ 'm/84\'/0\'/0\'/0/20', …(19) ]`. The legacy guard is **green on
   base**, because the display gate returns `null` first. It must stay green after the fix: a fix that only deletes
   the gate turns it red with `InvalidInputError: Wallet canonical policy identity is missing or inconsistent`. Green
   after the fix: 45/45.
2. `server/tests/unit/services/bitcoin/blockchain/gapLimit.contracts.ts:146-155` (run through
   `bitcoin/blockchain.test.ts`): "propagates non-capability failures while loading signer provenance" becomes "does
   not load signer provenance for background gap expansion" (a device row of `null`; resolves `[]`; the capability
   mock is not called). **Observed red on base** (`a1-red-gaplimit.txt`): `Tests 1 failed | 63 passed (64)`,
   `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times`. Green after the
   fix: 64/64.
3. Inventory gate. With the A1 source change but without D-17.A1c, `npm run verify:signer-inventory` fails with
   `Server capability enforcement boundaries drifted` (observed). After the row deletion and regeneration it prints
   `Signer inventory projection is current.`, and `tests/ci/signerInventoryGeneration.test.ts` is 27/27 (root
   `config/tooling/vitest.config.ts`, observed).

Confirm red (phase `a` worktree after the A2 commit, the A1 tests edited, A1 production files at base): `cd server &&
npx vitest run tests/unit/services/blockchainService.test.ts tests/unit/services/bitcoin/blockchain.test.ts` → the two
totals above; save as `$SCRATCH/i17-a-red-a1.txt`.

**Green criteria.**
- `blockchainService.test.ts`, `bitcoin/blockchain.test.ts`, `bitcoin/sync/gapLimitPhase.test.ts` and
  `bitcoin/sync/phases.test.ts` are green: 158/158 observed (`a1-green.txt`).
- All display-surface suites are green unchanged: `addresses.test.ts`,
  `transactions-addresses-routes-extended.test.ts`, `wallets-export-routes.test.ts`, `tests/unit/assistant`,
  `tests/unit/mcp`, `agentOperationalAddressService.test.ts`, `tests/unit/services/wallet` (in `a-broad2.txt`).
- `npm run verify:signer-inventory` passes.
- Integration is predicted unchanged. The repository wallet factory (`tests/integration/repositories/setup/factories.ts:81-98`)
  sets no `changeDescriptor`, so expansion returns `null` there. The integrator's full integration run confirms this.

**Mutation pins, boundaries, replay, provenance.**
- `addressDiscovery.ts` is in no mutation map, Stryker list or critical list.
- Its boundary rows (`config/wallet-sync-mutation-boundaries.json:52-53`: `findByIdWithSelect`,
  `createCanonicalBatch`) are unchanged, because no repository call is added or removed.
- No replay-driver or schema impact.
- `config/hardware-wallet-implementation-inventory.json` is listed in `config/hardware-emulator-source-inventory.json:10`
  and in `is_root_vitest_input_file` (`scripts/ci/classify-files-lib.sh:42`), and `scripts/generate-signer-inventory.mjs`
  is also in `is_root_vitest_input_file` (`:90`). So the PR runs the hardware-emulator proof lanes and the root vitest
  input lane. That is expected CI cost; nothing is re-pinned.
- No `VERIFIER_SOURCE_FILES` entry is touched.

**Compatibility, concurrency.**
- Expansion persists through the existing fenced `gap_limit_expansion` unit (`phases/gapLimit.ts:36-45`) and
  `createCanonicalBatch`'s locked summary, so concurrent workers of either version cannot double-allocate.
- An old worker simply does not expand.

**Coverage.** `!hasCanonicalPolicyIdentity` has both arms (the legacy guard and the `it.each` rows). The removed
`try/catch` removes three branches. `scripts/generate-signer-inventory.mjs` is outside the coverage includes; its
proof is `tests/ci/signerInventoryGeneration.test.ts`.

**Lizard.** `prepareGapLimitExpansion`'s CCN drops by 2. The new test helper is a top-level `async function`. Pinned
lizard reports no warning in either A1 file (prototype).

**Acceptance.** For every wallet with a canonical policy, whatever its signer, background sync derives and watches
addresses past index 19. Funds paid there are found by the recursive pass, or by the next sync when D-17.A2c defers
it. No address list, receive, generate, export, label, assistant or MCP surface returns an unused address without
`display`, which is still denied for every signer.

**Rollback.** Revert the commit (the regenerated inventory reverts with it). Rows already expanded stay; they are
display-gated and are scanned by every later sync, which is harmless. Do not revert A2 without A1.

### Phase A verification (worker, phase `a` worktree)

```bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i17-a
BASE=c81b2d372576da75efa0b9406dc480777b1dbb7f   # the plan commit differs from it only under tasks/
L=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
cd server
npx tsc --noEmit
npm run typecheck:tests
# A2 + A1 targeted, plus every suite that exercises history authentication, recursion and display gates (no coverage)
npx vitest run tests/unit/services/bitcoin/sync tests/unit/services/bitcoin/blockchain \
  tests/unit/services/bitcoin/blockchain.test.ts tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts \
  tests/unit/services/blockchainService.test.ts tests/unit/services/wallet tests/unit/assistant tests/unit/mcp \
  tests/unit/api/addresses.test.ts tests/unit/api/transactions-addresses-routes-extended.test.ts \
  tests/unit/api/wallets-export-routes.test.ts tests/unit/services/agentOperationalAddressService.test.ts
cd ..
npx vitest run --config config/tooling/vitest.config.ts tests/ci/signerInventoryGeneration.test.ts
npm run verify:signer-inventory                    # "Signer inventory projection is current."
npm run check:wallet-sync-mutation-boundaries      # "verified 48 repository callsites"
npm run check:wallet-sync-lifecycle-contract
npm run check:safety-catch-guards                  # no catch added
node scripts/ci/hardware-emulator-source-inventory.mjs validate
node scripts/check-architecture-boundaries.mjs
node scripts/check-server-cycle-baseline.mjs
node scripts/quality/check-large-files.mjs
# pinned lizard on every changed .ts/.mjs except evidenceAuthentication.ts: zero warnings
"$L" -w -l typescript -l javascript -C 15 -T nloc=200 \
  server/src/services/bitcoin/sync/attemptRuntime.ts server/src/services/bitcoin/sync/phases/fetchHistories.ts \
  server/src/services/bitcoin/sync/historyEvidenceAuthentication.ts server/src/services/bitcoin/blockchain/syncWallet.ts \
  server/src/services/bitcoin/sync/addressDiscovery.ts scripts/generate-signer-inventory.mjs \
  server/tests/unit/services/bitcoin/sync/historyStageBudget.test.ts server/tests/unit/services/bitcoin/sync/attemptRuntime.test.ts \
  server/tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts \
  server/tests/unit/services/blockchainService/address-discovery.contracts.ts \
  server/tests/unit/services/bitcoin/blockchain/gapLimit.contracts.ts
# evidenceAuthentication.ts carries one base warning (fetchCompactWithProjector, :322); nothing else may appear
lizard_ea=$("$L" -w -l typescript -C 15 -T nloc=200 server/src/services/bitcoin/sync/evidenceAuthentication.ts || true)
if printf '%s\n' "$lizard_ea" | grep ': warning:' | grep -v 'fetchCompactWithProjector'; then exit 1; fi
# pins, sync inventories, schema and the capability manifest untouched
git diff --quiet "$BASE" -- config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' \
  server/scripts/mutation config/wallet-sync-mutation-boundaries.json config/wallet-sync-lifecycle-contract.json \
  scripts/perf server/prisma shared/constants/hardwareWalletCapabilities.ts
# the display gates are all still present: single-line call sites go from 11 on base to 10 (addressDiscovery's removed);
# agentOperationalAddressService.ts:80-83 is a multi-line call and is checked separately
test "$(grep -rn "'display'\|\"display\"" server/src --include=*.ts | grep -c assertWalletHardwareCapabilityById)" -eq 10
grep -n '"display",' server/src/services/agentOperationalAddressService.ts
if grep -n "assertWalletHardwareCapabilityById\|ForbiddenError" server/src/services/bitcoin/sync/addressDiscovery.ts; then exit 1; fi
```
The single-line display-gate count of 10 after the fix is: `addresses.ts` ×2, `addressGeneration.ts`,
`walletMutations.ts`, `walletQueries.ts`, `export.ts`, `walletReadTools.ts`, `mcp/resources/index.ts`, and
`addressDisplaySafety.ts` ×2. It is 11 on base (re-measured at assembly). `agentOperationalAddressService.ts:80-83` is
the multi-line twelfth (`"display",` at `:82`) and has its own grep. The integrator alone runs backend coverage
(behind the bounded guard, scoped to `tests/unit`), the full integration suite with Redis, and the verify-vectors and
hardware-emulator lanes, through CI.

### Phase A changelog bullets (integrator, `## [Unreleased]`)

- **Fixed — sync finds funds beyond the first 20 addresses again.** Background wallet sync now derives and watches
  addresses past the gap limit for every wallet with a descriptor policy, whatever its signer. Funds received on
  later addresses are discovered, and the balance includes them. Showing, generating or exporting an unused address
  still needs the signer's display capability, which is still unavailable for every hardware signer. Wallets that
  predate descriptor policies (no persisted canonical policy) still sync only their stored addresses and still skip
  discovery past them; run wallet remediation on such a wallet to enable discovery.
- **Fixed — large wallets over Tor can finish syncing, up to a limit.** Each stage of the address-history step now
  gets a time budget that grows with its own work: history lookups, transactions and their parent transactions. The
  whole step stays inside a window of at most 20 minutes and at most two thirds of the time left in the sync attempt,
  so the sync always keeps time to save its results, including with a shorter `SYNC_MAX_DURATION_MS`. When a budget
  does run out, the sync now saves what it verified and retries cleanly, instead of failing outright. A follow-up
  pass over newly found addresses starts only when it can finish; otherwise the next scheduled sync continues it.
  **Capacity limit:** a wallet whose address history needs more lookups than fit in the 20-minute window (about
  12,000 history items at one second per Tor round trip, about 24,000 at half a second) still cannot finish syncing;
  this is a known limit tracked for a later release.

## Phase B — agent role parity, mixed batch send metadata, bounded readiness collector (B1, B2, B3)

Three P2 findings, one worktree (`/home/nekoguntai/sanctuary-bug-scrub-20261013-i17-b`, branch
`codex/bug-scrub-loop/20261013-i17-b`), **one commit per finding in order B1, B2, B3** (test + fix together). Every
file:line below was re-verified at `c81b2d372576da75efa0b9406dc480777b1dbb7f`. Every fix and every red/green
below was **prototyped and observed** in `scratchpad/p17b/tree` (a copy of the i17 worktree with a rebuilt
`shared/dist` and a fresh `prisma generate`; the first run against the primary checkout's stale `shared/dist`
produced unrelated reds — **workers must run `npm run build --workspace shared` and `prisma generate` before any red
run**, D-17.X1). Prototype diffs: `scratchpad/p17b/b1.patch`, `b2.patch`, `b3.patch`; red/green transcripts
`scratchpad/p17b/b{1,2,3}-*-{red,green}.txt`. Review pass 1 updated `b2.patch` (the OpenAPI assertion in its own
`it`, the client response type and case 7; pass-0 copy `b2.patch.pass0`) and re-observed B2 in `scratchpad/pr1/b2-*.txt`.
The prototype is guidance; this text governs. The B1 docs sentence and
the B3 integration case are not in the prototype patches.

| Phase | Production files | Test files | Other |
|---|---|---|---|
| b | **B1:** `server/src/agent/auth.ts`, `server/src/services/adminAgentService.ts`, `server/src/api/openapi/paths/agent.ts`, new `server/src/services/agentWalletAccess.ts` (/simplify: one shared helper) | **B1:** `server/tests/unit/agent/auth.test.ts` (293 → 341), new `server/tests/unit/services/agentWalletAccess.test.ts` (/simplify: helper cases), `server/tests/unit/services/adminAgentService.test.ts` (204 → 251), `server/tests/unit/api/adminAgentsRoutes.testHarness.ts` (84 → 88), `server/tests/unit/api/admin-agents-routes.fixtures.ts`, `server/tests/unit/api/admin-agents-routes.test.ts` (670, 3 edits), `server/tests/unit/api/agent-wallet-funding-smoke.test.ts` (558 → 562), `server/tests/unit/api/openapi.transfers-agent.test.ts` | `docs/how-to/agent-wallet-funding.md` (one sentence); changelog (integrator) |
| b | **B2:** `server/src/api/transactions/drafting.ts`, `server/src/api/openapi/schemas/transactions.ts`, `shared/schemas/transactionResponses.ts`, `src/hooks/send/types.ts`, `src/hooks/send/useBroadcast.ts`, `src/hooks/send/useDraftManagement.ts`, `src/components/send/SendTransactionWizard/types.ts`, `src/components/send/SendTransactionWizard/draftTransactionData.ts`, `src/components/send/SendTransactionPage/types.ts`, `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts`, `src/api/transactions/types.ts` (377 → 382) | **B2:** `server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts.ts` (640 → 687), `server/tests/unit/api/openapi.wallet.contracts.ts` (801 → 808: one new `it`), `tests/hooks/useBroadcast.test.tsx` (825 → 858), `tests/hooks/useDraftManagement.test.tsx` (743 → 774), `tests/components/send/draftTransactionData.test.ts` (277 → 289), `tests/shared/transactionResponses.test.ts` (181 → 189), `tests/hooks/useSendTransactionActions/useSendTransactionActions.drafts.contracts.tsx` (230 → 262) | changelog (integrator) |
| b | **B3:** `server/src/repositories/subscriptionCoverageReadRepository.ts`, `server/src/repositories/subscriptionCoverageRepository.ts` (type re-export), `server/src/services/sync/schedulerRetirementReadiness.ts`, `server/src/services/supportPackage/collectors/schedulerRetirementReadiness.ts` | **B3:** `server/tests/unit/repositories/subscriptionCoverageRepository.test.ts` (515 → 555), `server/tests/unit/services/supportPackage/schedulerRetirementReadinessCollector.test.ts` (83 → 94), `server/tests/integration/repositories/walletSyncCrossNetworkContract.test.ts` (799 → ~830; already registered in `scripts/ci/backend-integration-groups.sh:89`) | changelog (integrator) |

Untouched on purpose: `server/src/services/agentApiService.ts` (wallet-safety critical path; the fix sits in the
auth choke point that every agent route passes), `server/src/services/draftCreate.ts` (the iteration-16 A1 binding
rules are unchanged and are what B2 now satisfies), `server/src/api/transactions/broadcasting.ts`,
`server/src/services/bitcoin/**`, `server/src/services/supportPackage/runner.ts`'s fence (`runner.ts:152-157` stays
exactly as is), no Prisma schema or migration.

### Phase B1 — An agent key needs the same funding-wallet role as the human draft route (P2 `agent-funding--viewer-role-user-can-create-drafts`)

**Evidence (re-verified on c81b2d372).**
- `server/src/agent/auth.ts:104-124` `assertAgentUserWalletAccess` calls `walletRepository.hasAccess` on both linked
  wallets. `hasAccess` (`server/src/repositories/walletRepository.ts:284-293`) is "any direct share or group
  membership", so a viewer or approver passes. It runs on every agent request (`auth.ts:159`, via
  `router.use(authenticateAgent)` at `server/src/api/agent.ts:83`).
- The human equivalents need edit: `POST /wallets/:walletId/drafts` → `requireWalletAccess('edit')`
  (`server/src/api/drafts.ts:54`), `PATCH …/drafts/:draftId` → `'edit'` (`:124`). `canWalletRoleEdit` is owner/signer
  (`shared/constants/walletRoles.ts:26-29`, `:63-65`). The middleware resolves the role with
  `getUserWalletRole` (`server/src/services/accessControl.ts:54-79`): a direct role takes precedence over group
  membership, which `hasAccess`'s OR does not model (a direct viewer who is also in a signer group is a viewer to the
  human route but "has access" to the agent check).
- The agent routes that mutate the funding wallet: `POST /agent/wallets/:fundingWalletId/funding-drafts`
  (`api/agent.ts:167-229` → `submitAgentFundingDraft`, `server/src/services/agentApiService.ts:268`, which mints an
  intent at `:338` and calls `draftService.createDraft(fundingWalletId, context.userId, …)` at `:381` with no role
  check — draft creation relies on route middleware) and `PATCH …/funding-drafts/:draftId/signature`
  (`api/agent.ts:235-280`, `draftService.updateDraft`). Both lock funding-wallet UTXOs or rewrite a draft.
- Link time: `server/src/services/adminAgentService.ts:106-121` `assertTargetUserWalletAccess` (called from
  `validateAgentLink`, `:137-161`, on create only; update cannot change the linked wallets) uses `hasAccess` too, so
  an admin can link a viewer.
- Resolved P2 `agent-api--key-survives-user-wallet-access-loss` (iteration 10) added the per-request check for *total*
  loss; tests (`server/tests/unit/agent/auth.test.ts:253-292`) never use a viewer/approver role.
- **Same gap elsewhere (checked):**
  - Mobile agent-draft review routes (`server/src/api/mobileAgentDrafts.ts:72-200`): human JWT routes gated per action
    by role-derived mobile permissions (`server/src/services/mobileAgentDraftService.ts:195-226`: view, review =
    approve or sign, reject = approve, sign = signPsbt). **No gap.**
  - Agent dashboard (`GET /admin/agents/dashboard`, `adminAgentService.getAgentDashboardRows` → repository read): admin
    read-only, authorizes nothing. **No gap**; it will keep showing an agent `active` while its key is refused —
    OQ-B1a.
  - Admin agent form options (`adminAgentService.ts:260-350` `getAgentOptions`, `accessUserIds` = any role, consumed by
    `src/components/AgentManagement/AgentManagement/formOptions.ts:15-28`): offers a funding wallet where the target
    user is only viewer/approver; after B1 the create is refused with a 400. **UX gap, not an authorization gap** —
    OQ-B1a, P3 `agent-form--funding-wallet-options-ignore-role`.
  - MCP keys (`server/src/mcp/auth.ts:123-130`, `hasAccess`): read-only tools, so any role is the right parity. **No
    gap.**

**Root cause.** The agent path re-implemented wallet authorization as "has access" instead of reusing the role rule
the human routes use, so a role below `edit` (at link time or after a downgrade) keeps the agent's draft creation.

**Decisions.**
- **D-17.B1a — roles: funding wallet needs owner/signer (`canWalletRoleEdit`); operational wallet needs any role.**
  - Funding: every agent capability that touches it creates or rewrites a funding draft, which humans can do only with
    `edit` (`drafts.ts:54`, `:124`).
  - Operational: the agent only reads its balance (summary), verifies a destination, and receives into it. The one
    write is `getOrCreateOperationalReceiveAddress` deriving the initial receive gap when the wallet has no unused
    receive address (`server/src/services/agentOperationalAddressService.ts:75-140`): receive-only, no spend
    authority. The documented setup imports the operational wallet watch-only, often by the admin
    (`docs/how-to/agent-wallet-funding.md:17-18`, `:31`), so the target user may legitimately be a viewer there.
  - Rejected: **`edit` on both.** It would break documented watch-only operational setups for no spend-safety gain.
  - Rejected: **`approve` for the funding wallet.** Approvers vote on drafts; they cannot create them on the human path.
- **D-17.B1b — enforce in the one runtime choke point, with the human role resolver.** `assertAgentUserWalletAccess`
  calls `getUserWalletRole` (`services/accessControl.ts`) for both wallets (one durable read each, as before):
  - role `null` on either wallet → the existing `ForbiddenError`, `details { reason: 'agent_user_wallet_access_lost',
    wallet }` (funding checked first, then operational: the resolved P2's behaviour and its tests are kept);
  - funding role not `canWalletRoleEdit` → new `ForbiddenError('Agent user cannot create drafts on the funding wallet',
    FORBIDDEN, { reason: 'agent_user_wallet_role_insufficient', wallet: 'funding' })`;
  - still before `updateApiKeyLastUsedIfStale`, so a refused call does not refresh `lastUsedAt`; agent state is never
    mutated; restoring the role restores the key.
  - It applies to all five agent routes, including the summary and operational-address reads: the key exists only to
    request funding, the link-time rule (D-17.B1c) makes a read-only funding role reachable only by downgrade, and a
    half-working key is harder to reason about. Rejected: **per-route roles (view for summary, edit for drafts)** —
    a second role check site in `api/agent.ts`, and `agentApiService.ts` (critical path) would need its own check.
  - Rejected: **checking in `submitAgentFundingDraft` / `draftService.createDraft`.** Edits a wallet-safety critical
    file (`agentApiService.ts`, verify-vectors) and misses the signature PATCH.
  - Import: `agent/auth.ts` drops `repositories/walletRepository` and adds `services/accessControl` plus
    `@sanctuary/shared/constants/walletRoles` (D-17.X8). `services/accessControl.ts` is imported, not edited (it is on
    the critical mutation list and stays read-only).
  - *(/simplify, changes the two bullets above: both callers now share `findAgentWalletAccessProblem` in the new,
    unpinned `services/agentWalletAccess.ts`, which returns `'funding_access' | 'operational_access' | 'funding_role' |
    null` in that order. The funding wallet resolves its full role (`getUserWalletRole` from `accessControl.ts` +
    `canWalletRoleEdit`); the operational wallet needs any role, so it uses `walletRepository.hasAccess` (one query).
    `agent/auth.ts` maps the result to the 403s above, `adminAgentService.ts` to the 400s of D-17.B1c; neither
    imports `walletRoles` any more. `services/accessControl.ts` stays imported, not edited (byte-identical to the
    base; it is a Stryker mutate target and on the critical mutation list). The new module and
    `tests/unit/services/agentWalletAccess.test.ts` match no Stryker `mutate` entry, no `is_critical_mutation_file` /
    critical test-input glob in `scripts/ci/classify-files-lib.sh`, no `config/wallet-safety-mutation-map.json` or
    `config/wallet-safety-critical-paths.json` path. The new test covers every return and the group-role path; the
    agent-auth and admin-service unit tests drive the real helper through mocked
    `walletSharingRepository.findWalletUser` / `walletRepository.hasAccess`; the route and smoke harnesses mock
    `services/agentWalletAccess`.)*
- **D-17.B1c — the same rule at link time.** `assertTargetUserWalletAccess` uses `getUserWalletRole` for both wallets:
  `null` keeps the two existing 400 messages; a funding role below edit → `InvalidInputError('User must be an owner or
  signer of the funding wallet')`.
- **D-17.B1d — OpenAPI and docs.** `agentForbiddenResponse` (`server/src/api/openapi/paths/agent.ts:26-32`) also names
  `details.reason = agent_user_wallet_role_insufficient, details.wallet = funding`. One sentence in
  `docs/how-to/agent-wallet-funding.md` under "Register An Agent" (`:23`): "The target user must be an owner or signer
  of the funding wallet (any role on the operational wallet). An agent key is refused while its user is only a viewer
  or approver of the funding wallet."
- **D-17.B1e — out of scope.** The admin form still lists funding wallets by any role (OQ-B1a). Already-created
  drafts are not touched (human signers still act on them). Existing agents on a viewer/approver link start failing
  on upgrade (OQ-B1b, intended).

**Failing-first tests (observed red on c81b2d372 production files).**
- `server/tests/unit/agent/auth.test.ts`: add `getUserWalletRole: vi.fn()` to the hoisted mocks and
  `vi.mock('../../../src/services/accessControl', …)`; default `'signer'` in `beforeEach`. `denyWalletAccess` sets
  **both** `hasAccess` (false) and `getUserWalletRole` (`null`) for the named wallet, so the two existing access-loss
  cases stay green on base and after. New `describe('funding wallet role (parity with POST /wallets/:walletId/drafts
  requireWalletAccess(edit))')`:
  1. `it.each(['viewer','approver'])` "refuses a key whose user is only %s on the funding wallet" — `ForbiddenError`,
     message and `details { reason: 'agent_user_wallet_role_insufficient', wallet: 'funding' }`, no `lastUsedAt`
     update. **Red on base:** `AssertionError: expected { keyId: 'key-access', …(10) } to be an instance of
     ForbiddenError` (×2).
  2. `it.each(['owner','signer'])` "accepts a %s of the funding wallet who only views the operational wallet" (guard,
     green on base).
  3. "reports lost operational access before a read-only funding role" (guard: funding `viewer`, operational `null`
     → `agent_user_wallet_access_lost`/`operational`; green on base via `hasAccess`).
  4. Edited "checks the agent user still has access to both wallets": asserts `getUserWalletRole` was called with each
     wallet. **Red on base:** `AssertionError: expected "vi.fn()" to be called with arguments: [ 'funding-wallet',
     'user-1' ]`.
- `server/tests/unit/services/adminAgentService.test.ts`: same `accessControl` mock (default `'signer'`); new
  `describe('linked user wallet roles (same rule as the agent key at runtime)')` with a `grantRoles(funding,
  operational)` helper that drives both `hasAccess` and `getUserWalletRole`:
  5. `it.each(['viewer','approver'])` "refuses to link a user who is only %s on the funding wallet" → rejects with
     `User must be an owner or signer of the funding wallet`, `createAgent` not called. **Red on base:**
     `AssertionError: promise resolved "{ id: 'agent-1', hydrated: true }" instead of rejecting` (×2).
  6. "links a funding-wallet signer who only views the operational wallet" (asserts `getUserWalletRole` calls).
     **Red on base:** `expected "vi.fn()" to be called with arguments: [ 'funding-wallet', 'user-1' ]`.
  7. `it.each` no access to funding / operational → existing 400 messages (guards, green on base).
- `server/tests/unit/api/openapi.transfers-agent.test.ts`: the existing loop also expects
  `/agent_user_wallet_role_insufficient/` on every `/agent/*` 403. **Red on base:** `AssertionError: expected
  'Forbidden: the agent is not active, t…' to match /agent_user_wallet_role_insufficient/`.
- Observed on base: `auth.test.ts` + `adminAgentService.test.ts` → `Tests 6 failed | 19 passed (25)` (exactly cases
  1 ×2, 4, 5 ×2, 6); openapi file → `1 failed | 1 passed`. Accepted reds are exactly these (D-17.X3).
- **Harness migrations (fix-induced, not reds of the finding; listed so they are not a D-17.X3 stop).** The
  admin-route and smoke suites mock `src/repositories` with only `walletRepository`, so `accessControl` would read an
  undefined `walletSharingRepository` and the create routes return 500 (observed after the fix: 5 failures in
  `admin-agents-routes.test.ts` and `agent-wallet-funding-smoke.test.ts`). Fix in the same commit:
  `adminAgentsRoutes.testHarness.ts` + `admin-agents-routes.fixtures.ts` replace `walletRepository.hasAccess` with a
  `getUserWalletRole` mock of `services/accessControl` (default `'owner'`); `admin-agents-routes.test.ts:184`,
  `:426-428`, `:440-442` switch to `getUserWalletRole` with `null`/`'owner'`; the smoke test adds the same mock
  (`'owner'`) and drops its `hasAccess`.

Confirm red: `cd server && npx vitest run tests/unit/agent/auth.test.ts tests/unit/services/adminAgentService.test.ts
tests/unit/api/openapi.transfers-agent.test.ts` on the plan-commit base with the B1 test edits applied; save as
`$SCRATCH/i17-b-red-b1.txt`.

**Green (observed).** The 14 agent-related server files (`tests/unit/agent`, `adminAgentService`, `admin-agents-routes`
(+controls), `agent-wallet-funding-smoke`, `middleware/agentAuth`, `services/agentApiService`, `agent-routes`
(+funding), `mobile-agent-drafts-routes`, `openapi.transfers-agent`, `openapi.test.ts`, `services/accessControl*`):
`Test Files 14 passed (14) | Tests 211 passed (211)`. `npm run typecheck:tests` (server) clean; `tsc --noEmit` shows
only the scratch-copy artefact `src/middleware/csrf.ts(262,14) TS2883 … ParsedQs` (symlinked `node_modules`; not in a
real worktree).

**Coverage.** Every new branch is hit: funding `null`, operational `null`, funding below edit, accept (auth.ts);
the same three plus accept (adminAgentService). No `v8 ignore` added.

**Lizard / size / safety.** Pinned lizard on the B1 files: 0 warnings. Test files ≤ 670 lines. No new `catch`
(`check:safety-catch-guards` passed: 72 allowed groups, unchanged). `agent/auth.ts` and `adminAgentService.ts` are not
in `config/wallet-safety-critical-paths.json`, any Stryker `mutate` range, `wallet-safety-mutation-map.json`,
`is_critical_mutation_file` or `VERIFIER_SOURCE_FILES`.

**E2E / Playwright.** No new endpoint or response field. The `/agent/*` bearer API has no UI caller and no e2e mock;
the admin e2e fixtures (`tests/e2e/adminOperationsFixtures.ts:38-55`) are unchanged. No render change.

**Compatibility / rollback.** Behaviour change on upgrade: **an existing agent whose user is a viewer or approver of
its funding wallet gets 403 `agent_user_wallet_role_insufficient` on every call** until an owner grants signer (or
the admin re-links). This is the fix (OQ-B1b); the changelog states it. Revert = one commit; no stored state.

**Acceptance.** An agent key works only while its user can edit (owner/signer) the funding wallet and has any role on
the operational wallet; the admin cannot link a user below that; refused calls leave the key and agent state
unchanged.

### Phase B2 — A batch send that also pays the wallet's own address saves and broadcasts (P2 `broadcast--mixed-send-amount-sums-own-outputs`; also resolves backlog P3 `broadcast--mixed-send-own-first-recipient-mismatch`)

**Evidence (re-verified on c81b2d372).**
- Batch route response, `server/src/api/transactions/drafting.ts:256-268`: `psbtBase64, fee, totalInput, totalOutput,
  changeAmount, changeAddress, utxos, inputPaths, outputs, policyEvaluation, …signingIntent` — **no
  `effectiveAmount`, no recipient**. The single route returns `effectiveAmount` (`:185`). `outputs` come from
  `createBatchTransaction` (`services/bitcoin/transactions/createBatchTransaction.ts:185`, `:351-354`) as `{ address,
  amount }` only: **no ownership flag**. The shared schema allows `effectiveAmount` but does not require it
  (`shared/schemas/transactionResponses.ts:56-66`).
- What the server binds: `deriveIntentSpend` (`server/src/services/bitcoin/signingIntent/intentSpend.ts:88-100`) —
  `externalOutputs` excludes wallet-owned outputs; `amount` = external total minus payjoin-peer inputs. Broadcast:
  `metadata.recipient = externalOutputs[0]` (`api/transactions/broadcasting.ts:166`), compared with the reported
  recipient/amount at `:271-274` and, for an intent-bound draft, `:255-259`. Draft save: `assertRecipientMatches`
  (`server/src/services/draftCreate.ts:384-389`, first external output), `assertAmountMatches` (`:392-394`,
  `effectiveAmount || amount` = `spend.amount`), `assertStoredAmountMatches` (`:397-399`).
- What the client reports:
  - `src/hooks/send/useBroadcast.ts:174-184` `getEffectiveAmount`: with no `effectiveAmount`, the **sum of every built
    output** (own ones included), sent as `amount` (`:365`, `:373`); `recipient` = `state.outputs[0].address` (`:372`).
  - `src/hooks/send/useDraftManagement.ts:38-52` `getEffectiveDraftAmount`: the same sum, stored as `amount` (`:94`);
    `effectiveAmount: currentTxData.effectiveAmount` stays undefined (`:112`); `recipient` = `state.outputs[0]`
    (`:93`).
  - Example: external 50 000 + own 20 000 → client 70 000, server 50 000 → `metadata_mismatch` on save and broadcast,
    whatever the output order. With the own output first, the recipient also mismatches (the P3).
- Resume path: a saved draft is resumed through `buildDraftTxData`
  (`src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts:145-160`) and `createDraftInitialTxData`
  (`src/components/send/SendTransactionWizard/draftTransactionData.ts:40-74`); neither carries the draft's stored
  (server-bound) recipient, and `state.outputs` keeps the entered order, so an own-first draft would still broadcast
  the wrong recipient after this fix unless the resume path carries it.
- The server already accepts correct values: `server/tests/unit/services/draftCreate.test.ts:659` ("outputs that also
  list a wallet-owned output", own output listed first, recipient `tb1qexternal`, amount = spend) is an accept row.
- Tests miss it: `tests/hooks/useBroadcast.test.tsx:266-295` asserts the outputs-sum fallback with two
  external-looking addresses; server broadcast/draft tests build requests directly.
- e2e: `grep -rn "transactions/batch" tests/e2e` → **no match** (the send e2e mocks only `/transactions/create`,
  `tests/e2e/send-transaction-flow.spec.ts:468`); none of the 13 `transactions/balance-history` mock sites has a batch
  entry.

**Root cause.** The batch route leaves the client to infer the bound recipient and amount from its output list, but
the client cannot tell which outputs are the wallet's own; the server, which can, derives them from the intent and
then rejects the client's guess.

**Decisions.**
- **D-17.B2a — the server returns what it will bind; the client reports it.** The batch route derives the minted
  intent's spend once and returns `effectiveAmount = spend.amount` and `recipient = spend.externalOutputs[0].address`
  when `spend.amount > 0` (both omitted for a batch that pays only the wallet, where neither server check applies and
  the existing client fallback is harmless).
  - Same function, same inputs as the broadcast and draft checks → consistent by construction, including payjoin-peer
    and decoy/change ownership rules.
  - Implementation (`drafting.ts`): `evaluateMintedIntent` becomes a thin wrapper over a new
    `evaluateMintedIntentSpend(walletId, userId, handle)` that loads the intent, calls `deriveIntentSpend` once and
    passes it to `buildIntentPolicyInput(…, spend)` (its existing `precomputedSpend` parameter), returning `{
    policyEvaluation?, spend }`. No extra query on any route (the derivation moved; it was already done inside
    `buildIntentPolicyInput`). A pure `batchIntentSpendSummary(spend)` builds the two fields. The three `sign`
    capability calls (`:118`, `:213`, `:310`) are unchanged.
  - Rejected: **client excludes `isOurs` outputs.** The batch `outputs` carry no ownership, and the client's address
    list is paginated/partial; adding `isOurs` to outputs would copy the server's rule (payjoin peers, decoys) into a
    second owner.
  - Rejected: **client omits recipient/amount on batches.** Drops the client↔server consistency check the broadcast
    route relies on.
  - Rejected: **changing `createBatchTransaction` to return `effectiveAmount`.** `services/bitcoin/**` is a
    critical-mutation/mutation-pinned surface (`createBatchTransaction.ts:301-406`, `:412-466` are fee-policy mutate
    ranges); the route already has the intent.
- **D-17.B2b — fix the P3 in the same commit (same client code path).** `recipient` reported by broadcast and draft
  save comes from one helper, `getReportedRecipient(txData, state)` in `src/hooks/send/types.ts`:
  `canonicalSegwitAddressCase(txData.recipient ?? state.outputs[0].address)`. A helper (not an inline `??`) because
  the inline form raised the `broadcastTransaction` callback from CCN 14 to 16 (observed lizard warning). Backlog P3
  `broadcast--mixed-send-own-first-recipient-mismatch` is **resolved by B2** (OQ-B2).
- **D-17.B2c — the resume path carries the bound recipient.** `recipient?: string` on `TransactionData` and on both
  `DraftTransactionData` types; `buildDraftTxData` copies `draftData.recipient` (the value draft creation bound to
  the intent); `createDraftInitialTxData` copies it into `TransactionData`. Legacy drafts: their stored recipient was
  the old client's `outputs[0]`, the same value `state.outputs[0]` gives, so nothing changes for them.
- **D-17.B2d — contract.** `CreateBatchTransactionResponseSchema` gains `recipient: z.string().min(1).optional()`
  (`effectiveAmount` is already there). OpenAPI `TransactionBatchResponse` gains `effectiveAmount` (`integer`,
  `minimum: 1`) and `recipient` (`string`), both optional, with descriptions. *(Review pass 1)* The hand-written
  client type `CreateBatchTransactionResponse` (`src/api/transactions/types.ts:223-238`, the declared return type of
  `transactionsApi.createBatchTransaction`, consumed by `useSendTransactionActions.ts:101-112`) gains `recipient?:
  string` with the same doc comment as `TransactionData.recipient`; without it `recipient` reached `TransactionData`
  only through structural passthrough, and a future explicit field mapping in `createBatchTransactionData` would
  drop it with every other B2 test still green (case 7 pins the hop). **e2e mock maps: none to change** (no
  batch mock anywhere in `tests/e2e`; recorded so the integrator does not search again). Additive fields: an older
  cached SPA ignores `recipient` but already prefers `effectiveAmount`, so it gets the amount fix immediately.
- **D-17.B2e — the iteration-16 A1 binding holds.** `draftCreate.ts` is not edited; the draft now carries `recipient`
  = first external output, `amount = effectiveAmount = spend.amount`, and the unchanged `outputs` list (own output
  claimed as an `isOurs` output by `assertOutputListMatches`, the accepted shape at `draftCreate.test.ts:659`).

**Failing-first tests (observed).**
- Server, `transactionsHttpRoutes.creation.contracts.ts`, new `describe('batch spend the broadcast and draft checks
  bind')` inside `registerTransactionHttpCreationTests` (envelope from `mintedIntentEnvelope()` with input 70 150 and
  outputs `[own 0014 33…, 20 000]`, `[external 0014 44…, 50 000]`; addresses decoded with `bitcoinjs-lib` testnet;
  `mockFindAddressStrings` returns the own address):
  1. "returns the external recipient and net spend when the batch also pays a wallet address first" → `effectiveAmount
     50000`, `recipient` = external. **Red on base:** `AssertionError: expected undefined to be 50000 // Object.is
     equality`.
  2. "omits both when the batch pays only the wallet" (both addresses owned) → no `effectiveAmount`, no `recipient`
     (guard, green on base).
  - Edited `expectPreviewEcho` (same file): `buildIntentPolicyInput` is now called with a 4th argument
    `expect.objectContaining({ externalOutputs: expect.any(Array) })`. **Red on base (refactor red, accepted):** the
    four echo cases `AssertionError: expected "vi.fn()" to be called with arguments: [ 'wallet-123', 'test-user-id',
    …(2) ]`.
  - Observed on base: `tests/unit/api/transactions-http-routes.test.ts` → `Tests 5 failed | 134 passed (139)` (case 1
    + the 4 echo cases).
- Server, `openapi.wallet.contracts.ts`: a **new `it`** "documents the server-bound spend fields on the batch
  response" (inserted before "documents wallet delete as a 204 empty response") asserts that
  `TransactionBatchResponse.properties` matches `{ effectiveAmount: { type: 'integer', minimum: 1 }, recipient: {
  type: 'string' } }`. It must not extend the "documents transaction helper, UTXO selection, and privacy routes"
  callback (`(anonymous)@57-264`, 199 NLOC on base; four more lines make it 203 and a new lizard warning, review pass
  1). Measured: that callback stays at 199 NLOC and the new one is 6. **Red on base:** `AssertionError: expected {
  …(13) } to match object { effectiveAmount: { …(2) }, …(1) }` (run via `tests/unit/api/openapi.test.ts`, `Tests 1
  failed | 52 passed (53)`, observed in pass 1, `scratchpad/pr1/b2-openapi-red.txt`).
- Frontend (`--config config/tooling/vitest.config.ts`):
  3. `tests/hooks/useBroadcast.test.tsx` "reports the server-bound recipient and net spend when a batch pays a wallet
     address first" (state outputs own then external; txData `effectiveAmount 50000`, `recipient 'bc1qexternal'`) →
     `broadcastTransaction` called with `objectContaining({ recipient: 'bc1qexternal', amount: 50000 })`. **Red on
     base:** `AssertionError: expected "vi.fn()" to be called with arguments: [ 'wallet-1', ObjectContaining{…} ]`
     (base sends `bc1qown`).
  4. `tests/hooks/useDraftManagement.test.tsx` "saves the server-bound recipient and net spend when a batch pays a
     wallet address first" → `createDraft` with `objectContaining({ recipient: 'bc1qexternal', amount: 50_000,
     effectiveAmount: 50_000 })`. **Red on base:** `expected "vi.fn()" to be called with arguments: [ 'wallet-1', …(2) ]`.
  5. `tests/components/send/draftTransactionData.test.ts` "resumes a draft with the recipient draft creation bound,
     not the first listed output" (`buildDraftTxData` then `createDraftInitialTxData` keep `recipient 'bc1qtwo'`).
     **Red on base:** `AssertionError: expected undefined to be 'bc1qtwo' // Object.is equality`.
  6. `tests/shared/transactionResponses.test.ts` "accepts the server-bound recipient and rejects an empty or non-string
     one" (`''`, `42`, `null` rejected). **Red on base:** `AssertionError: expected true to be false` (the loose
     object passes them through).
  7. *(Review pass 1)* `tests/hooks/useSendTransactionActions/useSendTransactionActions.drafts.contracts.tsx` (run
     through `tests/hooks/useSendTransactionActions.test.tsx`) "saves a batch draft with the recipient and net spend
     the batch response binds": `mocks.createBatchTransaction` resolves `{ ...baseTxData, totalOutput: 70000,
     effectiveAmount: 50000, recipient: 'bc1qexternal', outputs: [own 20 000, external 50 000] }`, the state lists
     `bc1qown` then `bc1qexternal`, and `saveDraft()` (no `txData` yet, so it creates the batch first) must call
     `createDraft('wallet-1', objectContaining({ recipient: 'bc1qexternal', amount: 50000, effectiveAmount: 50000 }),
     any(AbortSignal))` after exactly one `createBatchTransaction`. This is the API → `TransactionData` → draft-save
     hop that cases 3 and 4 skip by injecting `txData`. **Red on base:** `AssertionError: expected "vi.fn()" to be
     called with arguments: [ 'wallet-1', …(2) ]` (the base sends `recipient: 'bc1qown'`).
  - Observed on base (pass 1, `scratchpad/pr1/b2-fe-red.txt`): the five files → `Tests 5 failed | 252 passed (257)`,
    exactly cases 3–7.
- Existing tests that stay as they are: the outputs-sum fallback (`useBroadcast.test.tsx:266-295`) still describes
  consolidation batches (no `effectiveAmount`); `draftTransactionData.test.ts` "maps valid outputs…" `toEqual` ignores
  the undefined `recipient`.

Confirm red: server `cd server && npx vitest run tests/unit/api/transactions-http-routes.test.ts
tests/unit/api/openapi.test.ts` and frontend `npx vitest run --config config/tooling/vitest.config.ts
tests/hooks/useBroadcast.test.tsx tests/hooks/useDraftManagement.test.tsx tests/components/send/draftTransactionData.test.ts
tests/shared/transactionResponses.test.ts tests/hooks/useSendTransactionActions.test.tsx`, each after `npm run build
--workspace=shared` with the base `shared/schemas/transactionResponses.ts` in place; save as
`$SCRATCH/i17-b-red-b2-{server,fe}.txt`.

**Green (observed).** Server: `tests/unit/api/transactions-http-routes.test.ts tests/unit/api/transactions
tests/unit/api/transactionsSigningIntentBroadcast.replacement.test.ts` → `15 files | 483 passed`; OpenAPI
(`openapi.test.ts`, `openapi.psbt-signing-context.test.ts`) → `61 passed` (pass 1). Frontend: `tests/hooks
tests/components/send tests/shared tests/components/TransactionActions tests/api/transactions.test.ts` → `Test Files
121 passed (121) | Tests 2018 passed (2018)` (pass 1, with case 7 and the client type, `scratchpad/pr1/b2-fe-green.txt`). `npm run typecheck:app` and
`npm run typecheck:tests` clean; server `typecheck:tests` clean. ESLint (repo config) clean on all B2 files;
`check:api-body-validation`, `check:bitcoin-network-boundaries` passed.

**Coverage.** `batchIntentSpendSummary` both arms (cases 1, 2); `evaluateMintedIntentSpend` `!input` arm (existing
"omits the echo…" case) and evaluated arm (echo cases); `getReportedRecipient` both arms (cases 3/4 and every existing
hook case); resume mapping has no branch; `src/api/transactions/types.ts` gains a type-only field. Frontend gate
needs 100% on `src/hooks/send/types.ts`, `useBroadcast.ts`, `useDraftManagement.ts`, `draftTransactionData.ts`,
`sendTransactionPageHelpers.ts`.

**Lizard / size / pins.** Pinned lizard on every B2 file: 0 warnings after D-17.B2b (the inline form gave
`useBroadcast.ts:337 … 16 CCN`) **and** with the OpenAPI assertion in its own `it` *(review pass 1: the pass-0
prototype's in-place assertion made `openapi.wallet.contracts.ts:57` a 203-NLOC warning, so the repo-wide count was
84 against the ≤ 83 gate)*. Test files ≤ 858 lines. Signer inventory: no new `broadcast*`/`finalize*` identifier
and `drafting.ts` keeps exactly its 3 `assertWalletHardwareCapabilityById` calls
(`config/hardware-wallet-implementation-inventory.json:53-57`). `server/src/api/transactions/**`,
`src/hooks/send/**`, `src/components/send/**`, `src/api/transactions/**` are wallet-safety critical paths → **verify-vectors runs** (no
`VERIFIER_SOURCE_FILES`, tier-1 Stryker or mutation-map entry touched). *(coordinator, at assembly)* `drafting.ts` and
the `transactionsHttpRoutes/*` contracts file are on `is_critical_mutation_file`, so the Full Critical Mutation Gate
shards run (D-17.X6 (2)); three of B2's files and `shared/schemas/transactionResponses.ts` are in the unscheduled
tier-2 glob (D-17.X6 (3)). New import: `src/hooks/send/types.ts` → `@sanctuary/shared/utils/bitcoin` (already
imported by the two hooks, which drop it) — integrator `arch:check`.

**E2E / Playwright.** No mock-map change (D-17.B2d). The static Playwright run is regression-only; the send e2e uses
the single-output route, whose response and client path (`recipient` absent → `state.outputs[0]`) are unchanged. No
PNG baseline may change.

**Compatibility / rollback.** Additive response field and optional type field; no stored state. Revert = one commit.

**Acceptance.** A batch send that also pays a wallet-owned address, in any output order, saves as a draft and
broadcasts: the client reports the server-derived recipient and net external amount, and a resumed draft keeps the
bound recipient.

### Phase B3 — The scheduler-retirement readiness collector settles inside the support-package deadline (P2 `support-package--scheduler-readiness-collector-outlives-deadline-fences-generation`)

**Evidence (re-verified on c81b2d372).**
- Runner: collector deadline `DEFAULT_COLLECTOR_TIMEOUT_MS = 15_000`, quiesce budget `DEFAULT_CLEANUP_TIMEOUT_MS =
  1_000` (`server/src/services/supportPackage/runner.ts:27-28`). On timeout it aborts and waits for the source to settle
  (`:96-105`, `:145-151`); if not, `generationFenced = true` (`:152-157`, "intentionally has no in-process reset") and
  every later `buildPackage` throws (`:241`) → `POST /admin/support-package` 503 until restart.
- Collector: `server/src/services/supportPackage/collectors/schedulerRetirementReadiness.ts:32-44` ignores the context
  (`signal`, `deadlineMs`), has no `cleanup`, and calls `readSchedulerRetirementReadiness()`
  (`server/src/services/sync/schedulerRetirementReadiness.ts:18-22`) → `readSubscriptionCoverage()`
  (`server/src/repositories/subscriptionCoverageReadRepository.ts:211-236`): `$transaction(…, { maxWait: 5_000,
  timeout: 15_000, RepeatableRead })`, **no `statement_timeout`**; an in-flight `$queryRaw` is not cancelled by the
  Prisma transaction timeout. Worst case ≥ 20 s > 15 s + 1 s.
- Siblings: `supportWalletSyncDiagnosticsRepository.ts:63` (`QUERY_TIMEOUT_MS = 2_000`), `:78` (`SET LOCAL` via
  `set_config('statement_timeout', …, true)`), `:232` (`{ timeout: 2_000 }`); `supportNotificationDiagnosticsRepository.ts:35`,
  `:41`, `:148`, `:169`, `:209`.
- Other caller: the worker's cutover gate `server/src/worker.ts:609` (`readSchedulerRetirementReadiness()`) — it must
  keep today's generous bounds (a false "unavailable" there blocks scheduler retirement).

**Root cause.** The collector shares the worker's unbounded read, whose own time bound exceeds the runner's
deadline, and nothing cancels the query server-side.

**Decisions.**
- **D-17.B3a — opt-in server-side bound on the read.** `readSubscriptionCoverage(bounds?: { statementTimeoutMs })`:
  - with `bounds`: inside the RepeatableRead transaction, first `SELECT set_config('statement_timeout',
    '<ms>', true)` (transaction-local, the siblings' exact form), then the unchanged
    `readSubscriptionCoverageWithClient`; transaction options `{ maxWait: ms, timeout: 3 × ms }` (three statements);
  - without `bounds`: byte-for-byte today's behaviour (`{ maxWait: 5_000, timeout: 15_000 }`, no `set_config`) —
    the worker gate and `readSubscriptionCoverageWithClient` (cutover repository) are unchanged;
  - a cancelled statement rejects the transaction and the existing `catch` returns `{ status: 'unavailable', reason:
    'storage_unavailable' }` (no new catch).
  - `readSchedulerRetirementReadiness(bounds?)` passes it through; `SubscriptionCoverageReadBounds` is re-exported from
    `subscriptionCoverageRepository.ts`.
- **D-17.B3b — the collector uses 2 s, like its siblings** (OQ-B3). `SUPPORT_COVERAGE_STATEMENT_TIMEOUT_MS = 2_000`,
  exported from the collector, passed as `{ statementTimeoutMs }`. Worst case to settle: 2 s wait for a connection +
  at most 6 s of statements (the real bound is ~2 s on the one heavy statement) = **8 s < 15 s**, so the collector
  returns an `unavailable` readiness section **before** the runner deadline; the timeout/quiesce path is no longer
  reachable from this collector. Rejected: **5 s** — with `maxWait = ms` and `timeout = 3 × ms` the worst case is
  `4 × ms` = 20 s, past the deadline; any value must stay below 3.75 s, and 2 s keeps one rule across the three DB
  collectors. A slow database now yields "readiness unavailable" in the package rather than a fenced generator.
- **D-17.B3c — the abort signal is not wired, deliberately.** Prisma `$queryRaw` takes no `AbortSignal`. Racing the
  read against `signal` would make the collector's promise settle while the statement keeps running — exactly the
  "ownership of timed-out work is uncertain" state the fence (`runner.ts:153-155`) exists to catch, so it would be
  dishonest quiescence. The server-side `statement_timeout` makes the work itself end. Rejected also: a `cleanup` that
  calls `pg_cancel_backend` (needs the backend pid of a pooled Prisma connection; far larger blast radius). The
  runner and its latch are not edited.

**Failing-first tests (observed).**
- `server/tests/unit/repositories/subscriptionCoverageRepository.test.ts`, new `describe("readSubscriptionCoverage
  deadline bounds")` before `recordSubscriptionComparisonFailure`:
  1. "bounds every statement server-side when the caller has a deadline": `readSubscriptionCoverage({
     statementTimeoutMs: 2_000 })` → `executeRaw` called once, SQL text contains `set_config('statement_timeout', 2000,
     true)`, issued before the first `queryRaw`; options match `{ maxWait: 2_000, timeout: 6_000, isolationLevel:
     "RepeatableRead" }` and `maxWait + timeout < 15_000`. **Red on base:** `AssertionError: expected "vi.fn()" to be
     called once, but got 0 times`.
  2. "keeps the worker read unbounded by statement timeout" (no `executeRaw`; `{ maxWait: 5_000, timeout: 15_000 }`;
     guard, green on base).
  3. "settles a cancelled bounded read as unavailable" (`$transaction` rejects with `canceling statement due to
     statement timeout` → `unavailable`/`storage_unavailable`; guard, green on base).
- `server/tests/unit/services/supportPackage/schedulerRetirementReadinessCollector.test.ts`:
  4. "reads readiness with a statement timeout well inside the collector deadline" → `mockReadiness` called with `{
     statementTimeoutMs: 2_000 }`. **Red on base:** `AssertionError: expected "vi.fn()" to be called with arguments: [
     { statementTimeoutMs: 2000 } ]`.
  - Observed on base: the two files → `Tests 2 failed | 49 passed (51)` (cases 1 and 4).
- Integration (integrator only; **predicted**, not run in the prototype — no database there):
  `server/tests/integration/repositories/walletSyncCrossNetworkContract.test.ts` (already in
  `scripts/ci/backend-integration-groups.sh:89`; gated by `describeWithDatabase`, `:50`, not by Redis), new case
  "cancels a bounded read that waits past its statement timeout": a holder transaction runs
  `` tx.$executeRaw`LOCK TABLE "wallets" IN ACCESS EXCLUSIVE MODE` `` and keeps it until released or 3 s; then
  `readSubscriptionCoverage({ statementTimeoutMs: 200 })` is timed; release; await the holder. The assertions are, in
  this order and with these matchers *(review pass 1)*:
  `expect(result).toMatchObject({ status: 'unavailable', reason: 'storage_unavailable' });` first, then
  `expect(elapsedMs).toBeLessThan(2_000);` (Postgres counts the lock wait toward `statement_timeout`). **The order
  and the whole-object `toMatchObject` are load-bearing:** the B3 integration red script accepts the base red only
  when `grep -qF "status: 'available'"` matches, which happens only for a whole-object headline; asserting elapsed
  first (`expected 30xx to be less than 2000`) or `expect(result.status).toBe(…)` would print a different headline
  and turn the expected red into a D-17.X3 stop. **Predicted red on base:** `expected { status: 'available', … } to match object { status:
  'unavailable', … }` after ~3 s (the read waits for the lock). If the integration pool has a single connection the
  bounded read fails on `maxWait` instead — still `unavailable` under 2 s; the unit case 1 pins the `set_config`. Use
  only tagged-template `$executeRaw` (no `Unsafe`). The integrator records the red on the guarded base swap
  (Verification, "Integrator step before the block").

Confirm red (unit): `cd server && npx vitest run tests/unit/repositories/subscriptionCoverageRepository.test.ts
tests/unit/services/supportPackage/schedulerRetirementReadinessCollector.test.ts` → `2 failed | 49 passed (51)`; save as
`$SCRATCH/i17-b-red-b3.txt`.

**Green (observed).** `tests/unit/repositories/subscriptionCoverageRepository.test.ts tests/unit/services/supportPackage
tests/unit/services/sync tests/unit/worker` → `Test Files 109 passed (109) | Tests 1504 passed (1504)`. Server
`typecheck:tests` clean.

**Coverage.** Both `bounds ?` arms (callback and options) by cases 1/2; collector line by case 4 and the existing two
cases. No branch in the pass-through.

**Lizard / size / pins.** Pinned lizard on the four production files and two test files: 0 warnings. Not in any
critical-path, Stryker, mutation-map, wallet-sync-mutation-boundaries or replay-driver inventory (grep of `config/`,
`server/stryker*.mjs`, `scripts/` for `subscriptionCoverage`/`schedulerRetirementReadiness`: no match). B3's
`server/src/repositories/**` files are on `config/wallet-safety-critical-paths.json:52` (verify-vectors, D-17.X6 (1)).
No migration.

**E2E / Playwright.** None (server-only, no response shape change: the section was already allowed to be
`unavailable`).

**Compatibility / rollback.** Worker behaviour unchanged. Support packages on a slow database show the readiness
section as `unavailable` instead of fencing generation. Revert = one commit.

**Acceptance.** The readiness collector settles (as `unavailable` at worst) in under 15 s on any database, so a slow
database never fences support-package generation through this collector; the worker gate's read is unchanged.

### Phase B verification (worker, phase `b` worktree)

```bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i17-b
BASE=c81b2d372576da75efa0b9406dc480777b1dbb7f   # the plan commit differs from it only under tasks/
npm run build --workspace=shared            # B2 edits shared/schemas; server tests read shared/dist
( cd server && npx prisma generate )
# B1
( cd server && npx vitest run tests/unit/agent tests/unit/services/adminAgentService.test.ts \
  tests/unit/api/admin-agents-routes.test.ts tests/unit/api/admin-agents-routes.controls.test.ts \
  tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/middleware/agentAuth.test.ts \
  tests/unit/services/agentApiService.test.ts tests/unit/api/agent-routes.test.ts tests/unit/api/agent-routes.funding.test.ts \
  tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/api/openapi.transfers-agent.test.ts tests/unit/api/openapi.test.ts )
# B2 server + B3
( cd server && npx vitest run tests/unit/api/transactions-http-routes.test.ts tests/unit/api/transactions \
  tests/unit/api/transactionsSigningIntentBroadcast.replacement.test.ts tests/unit/api/openapi.psbt-signing-context.test.ts \
  tests/unit/services/draftCreate.test.ts tests/unit/repositories/subscriptionCoverageRepository.test.ts \
  tests/unit/services/supportPackage tests/unit/services/sync tests/unit/worker )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )
# B2 frontend
npx vitest run --config config/tooling/vitest.config.ts tests/hooks tests/components/send tests/shared \
  tests/components/TransactionActions tests/api/transactions.test.ts
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npx eslint --config config/tooling/eslint.config.js \
  server/src/agent/auth.ts server/src/services/adminAgentService.ts server/src/api/openapi/paths/agent.ts \
  server/src/api/transactions/drafting.ts server/src/api/openapi/schemas/transactions.ts shared/schemas/transactionResponses.ts \
  src/hooks/send/types.ts src/hooks/send/useBroadcast.ts src/hooks/send/useDraftManagement.ts \
  src/components/send/SendTransactionWizard/types.ts src/components/send/SendTransactionWizard/draftTransactionData.ts \
  src/components/send/SendTransactionPage/types.ts src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts \
  src/api/transactions/types.ts \
  server/src/repositories/subscriptionCoverageReadRepository.ts server/src/repositories/subscriptionCoverageRepository.ts \
  server/src/services/sync/schedulerRetirementReadiness.ts server/src/services/supportPackage/collectors/schedulerRetirementReadiness.ts
npm run -s check:safety-catch-guards
npm run -s check:api-body-validation
npm run -s check:bitcoin-network-boundaries
npm run -s verify:signer-inventory               # B adds no capability call or signer identifier
mapfile -t B_TS < <(git diff --name-only "$BASE"...HEAD -- '*.ts' '*.tsx')
test "${#B_TS[@]}" -gt 0
/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard -w -l javascript -l typescript -l tsx -C 15 -T nloc=200 \
  "${B_TS[@]}"   # expect no output
node scripts/quality/check-large-files.mjs
if grep -rn "transactions/batch" tests/e2e; then exit 1; fi                                   # D-17.B2d: still no batch mock
if grep -rn "walletRepository.hasAccess" server/src/agent server/src/services/adminAgentService.ts; then exit 1; fi
```
The integrator additionally runs the B3 integration case on the guarded base swap (red) and after (green, inside the
full integration suite), backend `tests/unit` and frontend coverage, static Playwright (regression-only, no PNG
change), and `arch:check` (B1/B2 import edges), regenerating `docs/architecture/generated` if it reports drift.

### Phase B changelog bullets (integrator, `## [Unreleased]` → `### Fixed`)

- Wallet agent keys now need their user to be an owner or signer of the funding wallet, the same role a person needs
  to create a draft. A key whose user is (or is downgraded to) a viewer or approver of the funding wallet is refused
  with 403 `agent_user_wallet_role_insufficient`, and the admin cannot link such a user; any role on the operational
  wallet is still enough. **After upgrading, existing agents linked to a viewer or approver of their funding wallet
  stop working until that user is made an owner or signer;** check that each active agent's user can still edit its
  funding wallet.
- A batch send that also pays one of the wallet's own addresses can now be saved as a draft and broadcast, in any
  output order. The server returns the amount and recipient it checks (the payment leaving the wallet), and the send
  flow reports those instead of the total of all outputs or the first output in the list.
- Generating a support package while the database is slow no longer disables support-package generation until the
  API restarts. The scheduler-retirement readiness section gives up after 2 seconds per query and reports itself
  unavailable, like the other database sections.

## Phase C — Tor Payjoin route reaches the backend and survives container recreation; classifier suites run for every file they execute (C1, C3, C2)

Three findings, one phase, one worktree (`/home/nekoguntai/sanctuary-bug-scrub-20261013-i17-c`, branch
`codex/bug-scrub-loop/20261013-i17-c`, never `/tmp`). One commit per finding: C1, then C3, then C2. C1 and C3 share
`docker/tor/payjoin-ingress.conf` and `tests/config/torIngress.test.ts` (sequential commits in the same worktree);
C2 shares no file with either.

| Phase | Production files | Test files | Other |
|---|---|---|---|
| c | **C1:** `docker/tor/payjoin-ingress.conf`, `docker/compose/tor.yml`, `docker/nginx/docker-entrypoint.sh`. **C3:** `docker/tor/payjoin-ingress.conf` (one line). **C2:** `scripts/ci/classify-quality-scope.sh` | **C1:** `tests/config/torIngress.test.ts` (54 → ~176). **C3:** `tests/config/torIngress.test.ts` (~176 → ~223). **C2:** `tests/ci/classify-quality-scope.test.sh` (461 → ~544), new `tests/ci/lib/classifier-suite-subjects.mjs` (test-side helper, ~202 lines) | none (no docs edit; changelog bullets go to the integrator) |

Read-only for phase `c`: `.github/workflows/*.yml` (quality.yml is **read** by the C2 helper, never edited),
`tests/install/**` (C2 routes three of these files but does not edit them), `config/resource-lifecycle-callsites.json`
(no new callsite; the checker reports the registry complete on the patched tree), every file in
`scripts/verify-addresses/sourceManifest.ts` `VERIFIER_SOURCE_FILES`, `docker/nginx/default*.conf.template`,
`docker/compose/offline-tor.yml`, `scripts/ci/classify-files-lib.sh`.

**Release-surface note** (D-17.X6 (6)). C1 changes `docker/**` (install-test PR path filter, `install-test.yml:30`,
`:92`; `classify-install-scope.sh:536`) and `docker/compose/**` (Release Candidate Validation,
`release-candidate.yml:44`). It also changes the frontend image: the entrypoint is baked in
(`docker/frontend/Dockerfile:89`), and the docker-build lane selects it (`classify-docker-build-images.sh:136`). C2
changes `scripts/ci/*`, which the install scope routes (`classify-install-scope.sh:483`). C3 changes
`docker/tor/payjoin-ingress.conf` (`docker/**`, install-test path filter). So the phase runs the install/upgrade lanes
and RCV. None of the three adds an image, a compose service, a migration or an API surface.

All evidence is re-verified at `c81b2d372576da75efa0b9406dc480777b1dbb7f`. Prototyped on a `tar` copy of that tree
with a fresh `git init` (`scratchpad/p17c`), node v24.21.0, lizard 1.24.0. Prototype diffs (guidance; this text
governs): `scratchpad/plan17-C1-prototype.patch`, `scratchpad/plan17-C3-prototype.patch` (on top of C1),
`scratchpad/plan17-C2-prototype.patch`. Red/green transcripts: `scratchpad/p17c-tools/c1-{red,green}.txt`;
`scratchpad/pr1/{c3,c2}-{red,green}.txt` (review pass 1). Sweep tooling: `scratchpad/p17c-tools/{sweep*.mjs,unrouted*.txt,derived.tsv}`.

### Phase C1 — The onion Payjoin route re-resolves backend and tor-ingress after either is recreated (P2 `tor-payjoin-ingress--stale-ips-after-container-recreate`)

**Evidence (re-verified at `c81b2d372`).**
- **Hop 1 (tor-ingress → backend).** `docker/tor/payjoin-ingress.conf:20` is `proxy_pass http://backend:3001;`, a
  literal host with no `resolver`. nginx resolves it once when it loads the config. `docker/compose/tor.yml:65-66`
  overrides the entrypoint to bare `nginx -g 'daemon off;'`. That skips the image entrypoint
  (`docker/nginx/docker-entrypoint.sh:27-54`), which derives `NGINX_DNS_RESOLVER` from `/etc/resolv.conf`.
  `tor.yml:71` mounts the file straight over `/etc/nginx/conf.d/default.conf`.
- **Hop 2 (tor → tor-ingress).** `tor.yml:109-113` resolves `tor-ingress` once with `getent` and then runs
  `exec /usr/bin/torproxy.sh -s "80;$${ingress_ip}:8080"`. Tor's `HiddenServicePort` keeps that IP until the tor
  container restarts. `tor.yml:93-95` `depends_on` has no restart coupling.
- **The pattern that fixed the main frontend.** #967 (`9786db409`, "fix upgrades retaining stale backend routes")
  made three changes:
  - an `upstream` with `zone`, `resolver ${NGINX_DNS_RESOLVER} valid=5s ipv6=off`, `resolver_timeout 2s` and
    `server ${BACKEND_HOST}:${BACKEND_PORT} resolve` (`docker/nginx/default-ssl.conf.template:15-21`,
    `default.conf.template:4-10`);
  - a resolver derived from the container's `resolv.conf`, needed on rootless Podman where DNS is not 127.0.0.11
    (`docker-entrypoint.sh:27-54`);
  - a substitution allow-list (`:77`).

  The Tor ingress was added later (`ebdf124d7`) and did not adopt it.
- **Why tests miss it.**
  - `tests/config/torIngress.test.ts:14-25` pins the static strings, including the `getent` form and the
    `conf.d/default.conf` mount.
  - `tests/install/unit/upgrade-helpers.test.sh:1011-1033` pins the same strings.
  - Correction to the finding: a lane *does* start the Tor overlay. The `optional-profiles` upgrade fixture sets
    `UPGRADE_ENABLE_TOR=yes` (`tests/install/utils/upgrade-fixtures.sh:257-262`; `upgrade-install.test.sh:746`).
    That fixture runs only in `upgrade-extended-fixture-test`, which is non-PR (`install-test.yml:1026-1032`) and also
    runs in RCV. No lane recreates backend or tor-ingress under the overlay.
- **Constraint found while prototyping.** dperson's `torproxy.sh` (pinned digest, `tor.yml:88`) refuses to start Tor
  when `ps -ef | egrep -v 'grep|torproxy.sh' | grep -q tor` matches, printing "Service already running". So nothing
  may be running at Tor start whose `ps` line contains `tor`, other than torproxy.sh itself. Upstream source (fetched):
  `-s` appends `HiddenServicePort $port $host` to `/etc/tor/torrc`, and the final branch runs `exec /usr/bin/tor`.
  The image's entrypoint is `/sbin/tini`, which stays PID 1, so Tor is a child of tini under some other PID
  *(adversarial review, P2: the first draft assumed Tor became PID 1, so the watcher never found it)*.

**Root cause.** Both hops turn a service name into an IP once, at process start, and keep it for the life of the
process. A compose recreate gives the service a new IP. Examples: `PAYJOIN_PUBLIC_URL` added to `.env` recreates
backend (`tor.yml:26-27` tells the operator to do this), and a rebuilt frontend image recreates tor-ingress. Docker
and Podman allocate IPs serially, so the old IP is dead or belongs to another container. The sender then falls back
to the original transaction without any error. *(Review pass 1: this is a transport defect on top of another one.
Since `ebdf124d7` the ingress has also stripped `Host`, and the backend answers every forwarded request 400 before
the handler runs (C3), so no onion Payjoin request has reached the receiver since v0.8.63. C1 fixes where requests
go; C3 makes them acceptable once they arrive.)*

**Decisions.**
- **D-17.C1a — Hop 1 mirrors #967 exactly; the image entrypoint renders the ingress.**
  - `docker-entrypoint.sh` gains a first branch. When `NGINX_CONFIG_TEMPLATE` is set, it must be readable (if not:
    `Error: NGINX_CONFIG_TEMPLATE … is not readable`, exit 1), and `TEMPLATE` is that path. The SSL branch becomes
    `elif`, so the certificate check never runs for the ingress. The resolver derivation, the envsubst allow-list
    and `exec "$@"` are unchanged.
  - `payjoin-ingress.conf` becomes a template:
    ```
    upstream payjoin_backend {
        zone payjoin_backend 64k;
        resolver ${NGINX_DNS_RESOLVER} valid=5s ipv6=off;
        resolver_timeout 2s;
        server ${BACKEND_HOST}:${BACKEND_PORT} resolve;
    }
    ```
    `proxy_pass http://payjoin_backend;` replaces `:20`. Nothing else in the file changes (route regex, 100k body
    cap, 413 handler, header scrubbing, the 8081 static health server). There is no `keepalive`, same as today. The
    file keeps its name, so `SANCTUARY_TOR_INGRESS_CONFIG` and the install harness plumbing
    (`helpers.sh:670-676`, `upgrade-install.test.sh:171`, `:874-890`, `upgrade-fixtures.sh:142-158`) are untouched.
  - `tor.yml` tor-ingress:
    - drop `entrypoint:` and `command: []`, and set `command: ["nginx", "-g", "daemon off;"]` explicitly (with the
      image entrypoint, an empty command would `exec` nothing);
    - set `environment: NGINX_CONFIG_TEMPLATE: /etc/nginx/templates/payjoin-ingress.conf.template`;
    - change the mount target to that path (`:ro`). `/etc/nginx/conf.d` is owned by the runtime user
      (`Dockerfile:98`), so the render succeeds.
  - Rejected:
    - (i) a variable `proxy_pass` with an inline resolver in the ingress file. It needs the resolver IP anyway, which
      only the entrypoint derives.
    - (ii) an inline `sh -c` in tor.yml that copies the awk resolver parser. That would be two resolver parsers to
      keep in sync.
    - (iii) `depends_on: backend: restart: true`. It needs Compose ≥ 2.17 (older Compose rejects the key and fails
      the whole `up`). It does not fire for `up --no-deps backend`, which the upgrade lane itself uses
      (`upgrade-assertions.sh:206`), and it does not fire for runtime restarts.
- **D-17.C1b — Hop 2 is a re-resolving watcher that reloads Tor with SIGHUP** (OQ-C1). In the tor `command`, before
  the existing resolve loop, a quoted heredoc writes `/tmp/payjoin-ingress-watch.sh`:
  - it finds Tor's PID on every check by scanning `$PAYJOIN_INGRESS_PROC_ROOT/[0-9]*/comm` (default `/proc`) for
    `tor`, with the shell's `read` builtin (busybox-safe; no `pidof`, no child process per entry), and waits until
    such a process exists before its first lookup;
  - every `PAYJOIN_INGRESS_RECHECK_SECONDS` (default 15) it runs `getent hosts tor-ingress`;
  - on a **non-empty, changed** IP it rewrites `^HiddenServicePort 80 .*` in `$PAYJOIN_INGRESS_TORRC` (default
    `/etc/tor/torrc`), sends `kill -HUP` to Tor, logs `Payjoin ingress moved from A to B; reloaded Tor` to stderr,
    and records the new IP (the HUP goes to the PID just discovered);
  - it exits when no process named `tor` remains.

  The launch line becomes `sh /tmp/payjoin-ingress-watch.sh "$$ingress_ip" &`, then the unchanged `exec
  /usr/bin/torproxy.sh …`. The `getent hosts tor-ingress` and `torproxy.sh -s "80;$${ingress_ip}:8080"` needles that
  `upgrade-helpers.test.sh:1021-1024` pins are kept. Why it is shaped this way:
  - Neither the file name nor its argument contains `tor`, so torproxy's `ps` check cannot match the watcher.
  - The watcher does no lookups until a process named `tor` exists, so its `getent hosts tor-ingress` child never
    exists during that check; the scan itself uses only shell builtins.
  - Tor stays a child of tini (PID 1), which forwards `docker stop`'s SIGTERM to it and reaps orphans, as today.
    `entrypoint: []` is rejected: it would make the shell PID 1 and lose tini's reaping.
  - A reload keeps the hidden-service keys and the `.onion` address.

  The `PAYJOIN_INGRESS_*` variables are runtime defaults (inside the quoted heredoc). Compose does not interpolate
  them, and they exist only so the test can drive the real script (`PAYJOIN_INGRESS_PROC_ROOT` points the scan at a
  fake proc root whose PID 1 is a `tini` entry and whose Tor entry is a symlink to a live stub's `comm`). Rejected:
  - (i) `depends_on: tor-ingress: restart: true`. Same Compose-version and `--no-deps` gaps as C1a(iii).
  - (ii) Exit the container on an IP change and rely on the restart policy. CI sets `SANCTUARY_RESTART_POLICY=no`
    (`install-test.yml:208`, `release-candidate.yml:121`), so Tor would stay down.
  - (iii) `network_mode: service:tor` with `127.0.0.1:8080`. A container that joins another's network namespace
    loses networking when that container restarts.
  - (iv) A unix socket in a shared volume. Volume ownership for the uid-1001 nginx, plus a stale socket after
    SIGKILL (nginx does not unlink it, so an `rm` callsite would be needed), make it riskier than the watcher.
  - (v) A static `ipv4_address`. It needs IPAM on `sanctuary-network`, which docker-compose.yml does not declare.
  - (vi) `kill -TERM` instead of HUP on a change (OQ-C1): safe only under a restart policy, and CI uses `no`.
- **D-17.C1c — Health check stays static (rejected: make it exercise the backend).** Proxying `8081/health` to
  backend `/health` is cheap in config, but backend `/health` returns 503 when its worker is unhealthy
  (`server/src/routes.ts:43-52`). tor-ingress would then go unhealthy for reasons unrelated to routing, and tor's
  `depends_on: service_healthy` (`tor.yml:93-95`) would fail a later `compose up`. Making it route-only (intercept
  upstream 5xx, fail only on nginx 502/504) is new nginx behaviour that no PR lane can execute (no nginx on the dev
  host; the Tor overlay runs only in non-PR lanes). Proposed P3 follow-up
  `tor-ingress--healthcheck-does-not-exercise-backend-route` (not yet in run state; see Open questions).
- **D-17.C1d — No lifecycle registry change.** `kill -HUP` inside the compose command is not a scanner callsite. On
  the patched tree `node scripts/ownership/check-lifecycle-callsites.mjs` reports `complete (416 lifecycle
  identities…)`, the same as base. The test's `rmSync(dir, {recursive:true})` is not flagged either (verified).

**Failing-first tests (red on base; observed).** `tests/config/torIngress.test.ts` (root Vitest, frontend lane):
- edited case "routes the hidden service only through the dedicated ingress": the mount assertion now expects
  `…:/etc/nginx/templates/payjoin-ingress.conf.template:ro` and forbids any `payjoin-ingress.conf:/etc/nginx/conf.d/`
  mount. **Red:** `AssertionError: expected '# ====…' to contain '- ${SANCTUARY_TOR_INGRESS_CONFIG:-./d…'`.
- new "re-resolves a recreated backend through the container DNS resolver" (static, #967 style):
  - the ingress has the upstream, zone, resolver, timeout and `resolve` lines, exactly one `proxy_pass
    http://payjoin_backend;` and no `proxy_pass http://backend:`;
  - the parsed (`yaml`, root devDependency) tor-ingress service has no `entrypoint`, has
    `command: ["nginx","-g","daemon off;"]` and the template env;
  - the `NGINX_CONFIG_TEMPLATE` branch precedes `elif [ "$ENABLE_SSL" = "true" ]`;
  - **every `${VAR}` in the template is in the entrypoint's envsubst allow-list** (otherwise nginx would see a
    literal `${…}`).

  **Red:** `AssertionError: expected 'server {\n    listen 8080;…' to contain 'upstream payjoin_backend {'`.
- new "moves the hidden service to a recreated ingress and reloads Tor once" (behavioural):
  - it extracts the heredoc from the parsed tor `command` (with `$$`→`$`) and asserts the launch line precedes
    `exec /usr/bin/torproxy.sh` and contains no `tor`;
  - it runs the real watcher under `sh` with a `getent` stub on `PATH` and a stub named `tor` (so `/proc/<pid>/comm`
    is `tor`). The stub appends to a log and exits on SIGHUP, with a 10 s cap;
  - phases: same IP (0.4 s), then lookup empty (0.4 s), then a new IP;
  - it asserts the torrc becomes `…HiddenServicePort 80 10.0.0.9:8080` with the other lines intact, exactly one HUP,
    the stderr message, and exit 0. A spurious HUP in the no-op phases would end the stub early and leave the torrc
    unchanged, so the case discriminates.

  No `kill` callsite: the harness only `wait`s. **Red:** `AssertionError: tor command must define the ingress
  watcher: expected undefined to be defined`.
- File result on base: `Tests 3 failed | 2 passed (5)`. Green: `Tests 5 passed (5)` (behavioural case ~0.9 s).
  Transcripts: `p17c-tools/c1-red.txt`, `c1-green.txt`.

Confirm red (phase `c` worktree, C1 test edited, the three C1 production files at base): `npx vitest run --config
config/tooling/vitest.config.ts tests/config/torIngress.test.ts` → `3 failed | 2 passed (5)`; save as
`$SCRATCH/i17-c-red-c1.txt`.

**Green criteria.**
- The file passes 5/5 at the C1 commit (6/6 after C3).
- `tests/config/` 11 files / 60 tests are green at the C1 commit (61 after C3), including `nginxProxyHeaders.test.ts` (entrypoint #967 pins
  unchanged).
- `tests/install/unit/upgrade-helpers.test.sh` 110/110, `tests/install/unit/offline-compose-images.test.sh` and
  `node --test tests/ownership/{compose-oci-labels,deployment-definition,owner-container-label}.test.mjs` (18/18) are
  green.
- `node --test tests/ci/check-supply-chain-locks.test.mjs` 17/17, `bash tests/ci/check-workflow-composition.test.sh`
  rc 0, `tests/ci/vitestRepoInputsClassified.test.ts` 4/4 (no new repo input: the test reads only already-classified
  files). Lifecycle registry complete.

All of these were observed on the prototype.

**CI lanes and evidence.**
- **PR lanes, static plus a behavioural shell harness:** root Vitest (frontend lane: `torIngress.test.ts`),
  install-test unit (`upgrade-helpers`, `offline-compose-images`), quality ci-classifier (supply-chain and
  composition suites), docker-build (frontend image rebuild).
- **Runtime evidence, non-PR only:** `upgrade-extended-fixture-test` `optional-profiles` (push to main, schedule,
  tags) and RCV start the Tor overlay through `start.sh`. tor-ingress must render, parse and become healthy before
  tor starts, so a template or entrypoint mistake fails there. The integrator watches the post-merge
  `upgrade-extended-fixture-test` run on `main` (Completion criteria).
- **Static evidence only (no lane executes it):** the nginx `resolve` re-resolution itself (same image and directive
  as #967, which `assert_frontend_proxy_recovers_after_backend_recreate` proves for the frontend), and Tor's SIGHUP
  reload of a changed `HiddenServicePort` target (Tor manual: SIGHUP reloads the configuration; onion-service config
  is reload-capable). Recorded as P3 `install-upgrade--tor-overlay-recreate-not-exercised` (OQ-C1): an
  optional-profiles assertion that recreates tor-ingress and backend through the coordinator and checks torrc and an
  onion-port POST route.

**Lizard.** `tests/config/torIngress.test.ts`: 0 warnings at `-C 15 -T nloc=200`. No new function in shell or
config. Repo-wide count unchanged (no new `.ts/.js` production function).

**Compatibility.**
- The `.onion` address and keys are unchanged; an operator's `SANCTUARY_TOR_INGRESS_CONFIG` override still points at
  a file named `payjoin-ingress.conf`, now mounted as a template: a customized override written as a plain nginx
  config keeps working only if it contains no `${…}` other than the allow-listed variables (the envsubst allow-list
  leaves other `$` text untouched).
- *(Review pass 1)* The legacy Tor isolation branch of the upgrade harness becomes incompatible with the new overlay.
  `isolate_legacy_optional_profile_compose` (`tests/install/utils/upgrade-fixtures.sh:120-165`) copies the target
  `tor.yml` and `payjoin-ingress.conf` into a legacy checkout whose own `tor.yml` predates `ebdf124d7` (sources older
  than v0.8.63), which then runs its own legacy frontend image. After C1, tor-ingress drops its `entrypoint:` override
  and relies on the image entrypoint honouring `NGINX_CONFIG_TEMPLATE`; a legacy entrypoint (for example
  `v0.8.62:docker/nginx/docker-entrypoint.sh:22`, `:28-31`) ignores that variable, defaults `ENABLE_SSL=true` and
  exits on the missing `/etc/nginx/ssl` certificates, so tor-ingress never becomes healthy and that legacy source
  install would fail. **No current fixture reaches the branch:** `optional-profiles` is pinned to v0.8.69
  (`tests/install/utils/upgrade-selection.sh:154`) and `optional-owned-source` uses latest-stable, and both already
  ship tor-ingress; the stub test `test_legacy_optional_profile_compose_can_use_target_tor_overlay`
  (`upgrade-helpers.test.sh:933-979`) stays green. `tests/install/**` is read-only for phase `c`, so the branch is not
  changed here; recorded as P3 `install-upgrade--legacy-tor-fixture-incompatible-with-ingress-template` (fail the
  branch closed, or drop it, when a fixture next needs a pre-v0.8.63 Tor source).

**Acceptance.** After backend or tor-ingress is recreated, the ingress forwards onion Payjoin requests to the new
container: nginx re-resolves the backend through the container resolver (`valid=5s`), and the watcher moves
`HiddenServicePort` to the new ingress IP and reloads Tor within one recheck interval (15 s), keeping the `.onion`
identity. That the backend then accepts the forwarded request is C3's acceptance; C1 does not claim that the route
worked before.

**Rollback.** Revert the C1 commit; the next `compose up` restores the bare-nginx ingress and the one-shot `getent`.
No state to undo (the torrc is rewritten from the image at container start).

### Phase C3 — The onion Payjoin route reaches the receiver handler: the ingress sends a fixed Host (P2 `tor-payjoin-ingress--empty-host-header-rejected-400`, found by review pass 1)

**Evidence (re-verified at `c81b2d372`).**
- `docker/tor/payjoin-ingress.conf:27` sets `proxy_set_header Host "";` inside the Payjoin `location`, with
  `proxy_http_version 1.1;` (`:21`). nginx does not send a header whose value is empty, so the upstream request is
  HTTP/1.1 with no `Host` at all.
- The backend is a plain `createServer(app)` (`server/src/index.ts:212`, `http` import `:22`) without
  `requireHostHeader: false`. Node ≥ 20 rejects an HTTP/1.1 request that has no `Host` with 400 before Express runs.
  Reproduced on node v24.21.0 (coordinator, and again in pass 1 with `scratchpad/pr1/hostprobe.mjs`): a raw `POST
  /api/v1/payjoin/x HTTP/1.1` with no Host header gets `HTTP/1.1 400 Bad Request` from a default
  `http.createServer`; the same request with `Host: payjoin-ingress` gets `HTTP/1.1 200 OK` from the handler.
- Introduced by `ebdf124d7` ("fix: isolate Tor Payjoin ingress", first released in v0.8.63-rc1). So every onion
  Payjoin POST since then has been answered 400 by Node, and the sender silently fell back to the original
  transaction. **Why nothing caught it:** no lane POSTs through the ingress (P3
  `install-upgrade--tor-overlay-recreate-not-exercised`, OQ-C1), and the ingress health check is a static nginx
  `return 200` (D-17.C1c). *(Correction to the review report: `tests/config/torIngress.test.ts` does not pin the empty
  Host. Its `:51` pin is `proxy_set_header X-Forwarded-Host "";`, which stays; `tests/install/**` has no Host pin
  either. The defect was simply unpinned.)*
- **What the backend does with Host on this route (checked, so a fixed value is safe):**
  - Receiver route `router.post('/:addressId')` (`server/src/api/payjoin.ts:358`) and `services/payjoin/**` read no
    Host, `req.hostname` or `req.protocol`.
  - The only Payjoin URL builder that reads Host is `GET /payjoin/address/:addressId/uri`
    (`api/payjoin.ts:227`: `config.payjoin.publicUrl`, else the request's protocol and Host). It is
    authenticated and is not reachable through the ingress, whose only route is the POST regex
    (`payjoin-ingress.conf:15-18`), so it never
    sees the ingress's Host.
  - `trust proxy` is `1` (`server/src/index.ts:86`). With `X-Forwarded-Host ""` dropped by the ingress, `req.hostname`
    falls back to `Host`; its only consumer is the tracing span attribute `http.host`
    (`server/src/utils/tracing/middleware.ts:94`). The request logger does not log Host
    (`middleware/requestLogger.ts:83-89`: request id, IP, user agent).
  - CSRF (`middleware/csrf.ts`) has no Host or allowed-host check. CORS's `getRequestOrigin`
    (`middleware/corsOrigin.ts:128-146`) turns Host into a same-origin candidate `http://payjoin-ingress`, which only
    matters for a request carrying `Origin: http://payjoin-ingress`; a Payjoin sender sends no credentials and the
    receiver route needs none.
  - No allowed-hosts check exists on the main app (`allowedHosts` is the MCP server's own setting,
    `mcp/transport.ts:203`, a separate listener).

**Root cause.** The ingress removes `Host` so that the onion name never reaches the backend, but an empty `Host` is not
a "neutral" Host under HTTP/1.1: nginx omits the header, and Node's parser then refuses the request.

**Decisions.**
- **D-17.C3a — send a fixed, non-identifying Host.** `proxy_set_header Host payjoin-ingress;` replaces `:27` (the C1
  template keeps the line in the same `location`). Never `$host`, `$http_host` or the onion name: those would forward
  the client-chosen or onion identity that the ingress exists to strip. `payjoin-ingress` contains no `$`, so the C1
  envsubst render leaves it alone. Rejected:
  - `requireHostHeader: false` on the backend server: it would loosen HTTP/1.1 parsing for every route on the main
    listener to fix one proxy hop;
  - dropping the `proxy_set_header Host` line: nginx would then send `Host: payjoin_backend` (its `$proxy_host`),
    which works but names an internal upstream implicitly and is easy to change by accident; an explicit fixed value
    is pinned by the test.
- **D-17.C3b — behavioural proof without nginx.** The test parses the single `proxy_set_header Host` line, builds the
  request nginx would forward (no `Host` line when the value is empty), sends it to a default `http.createServer` on
  `127.0.0.1:0`, and requires the handler's `HTTP/1.1 200 OK`. Then it pins the exact line and forbids `$host` /
  `$http_host`. The behavioural assertion comes first, so the base red is the 400 itself. `tests/config/` is excluded
  from the lifecycle callsite scanner (`scripts/ownership/check-lifecycle-callsites.mjs` `EXCLUDED_PREFIXES`); the
  helper closes its server in `finally` and its socket has a 5 s timeout.

**Failing-first test (red at the C1 commit; observed in pass 1).** `tests/config/torIngress.test.ts`, new case
"sends the backend a fixed Host that its HTTP server accepts" (after "removes client forwarding identity at the
trusted hop") and one top-level helper `backendStatusLine(host)` at the end of the file (imports `createServer` from
`node:http`, `connect` and `type AddressInfo` from `node:net`). **Red:** `Tests 1 failed | 5 passed (6)`,
`AssertionError: expected 'HTTP/1.1 400 Bad Request' to be 'HTTP/1.1 200 OK' // Object.is equality`
(`scratchpad/pr1/c3-red.txt`). Green: `tests/config` `Test Files 11 passed (11) | Tests 61 passed (61)`
(`c3-green.txt`). Lizard: 0 warnings on the file.

Confirm red (phase `c` worktree after the C1 commit, the C3 test added, `docker/tor/payjoin-ingress.conf` at the C1
commit): `npx vitest run --config config/tooling/vitest.config.ts tests/config/torIngress.test.ts` → `1 failed | 5
passed (6)`; save as `$SCRATCH/i17-c-red-c3.txt`.

**CI lanes.** Root Vitest (frontend lane), install/upgrade lanes and RCV (`docker/**`). Docker-build is not selected by
this file alone (`classify-docker-build-images.sh:136` lists only `docker/nginx/*` inputs; the ingress file is
mounted, not baked in). The runtime evidence is the same
non-PR `upgrade-extended-fixture-test` and RCV start of the Tor overlay, which proves the template still renders and
nginx still parses; no lane POSTs through it (P3 `install-upgrade--tor-overlay-recreate-not-exercised`).

**Compatibility.** The backend now sees `Host: payjoin-ingress` on onion Payjoin requests; nothing on that route
depends on Host (above). An operator's own `SANCTUARY_TOR_INGRESS_CONFIG` override keeps whatever Host line it has;
the changelog tells operators with an override to replace an empty Host.

**Acceptance.** An onion Payjoin POST forwarded by the ingress reaches the receiver handler instead of Node's 400, and
the backend never sees the onion name or a client-supplied Host.

**Rollback.** Revert the C3 commit (onion Payjoin requests get 400 again). No state.

### Phase C2 — Every file a ci-classifier-tests suite executes selects that job, derived from quality.yml (P2 `ci-classifier--quality-suite-subjects-outside-trigger`, recurrence)

**Evidence (re-verified at `c81b2d372`).**
- **What the i11 fix did.** `51b0b69af` (plan `44d202f89`, D-11.18) added seven exact paths
  (`classify-quality-scope.sh:110-119`). It also added a static guard whose suites are a **hand-kept list of six**
  (`tests/ci/classify-quality-scope.test.sh:124-131`) and whose token grep is limited to
  `scripts/quality*|scripts/ops/*|server/.husky/*` (`:151-156`). D-14.C6 added a second hand list of four contract
  suites (`:163-168`).
- **Why it recurred.** The job runs about 200 suites (`quality.yml:641-978`, including `npm run test:ownership` `:682`
  and `npm run test:release-distribution` `:978`). Neither hand list covers the suites that import or run these files:
  - `check-root-layout.test.mjs` (`quality.yml:874`) imports `scripts/quality/check-root-layout.mjs` and reads its
    schema (`tests/ci/check-root-layout.test.mjs:14-20`, `:260-266`);
  - the wallet-sync suites (`:852`, `:854`) import `scripts/perf/*`;
  - `runtime-prisma-dependencies.test.cjs` (`:871`) requires `server/scripts/*.cjs`.

  Also, the grep prefixes exclude `scripts/perf`, `server/scripts` and any import-only subject.
- **Gate.** The job runs only when `run_ci_classifier_tests == 'true'` (`quality.yml:628`). `is_ci_classifier_file`
  (`classify-quality-scope.sh:105-131`) matches none of the subjects below.

**Full sweep (CLAUDE.md batch rule; every suite the job runs).** The sweep parses the job body plus the npm scripts it
calls (208 suites) and derives what each suite **executes**:
- (a) the transitive static relative import/require graph of each JS suite;
- (b) files a shell suite sources, runs or copies from the checkout (`. "$ROOT_DIR/x"`, `bash "$ROOT_DIR/x"`,
  `cp "$SOURCE_ROOT/x" …`), or binds to a variable when the file is a script (`.sh/.mjs/.cjs/.js` or extensionless);
- (c) `resolve('x')` / `path.resolve('x')` in a JS suite;
- (d) *(review pass 1)* a checkout script a shell suite runs **as a command**: `"$ROOT_DIR/x.sh" --flag` in command
  position (line start, after `;`/`&`/`|`/`(`/`!`/`{` or `then`/`do`/`else`/`exec`, optionally behind `VAR=value`
  assignments), executable extensions only. Neither (b) pattern sees it: `SHELL_RUN_PATTERN` needs a
  `.|source|bash|sh|node|cp` prefix and the binding pattern needs `VAR="$ROOT/…"`. It finds
  `scripts/reset-user-2fa.sh`, run directly by `tests/ownership/deployment-lifecycle.test.sh:336` and `:344`
  (`npm run test:ownership`, `package.json:135`, `quality.yml:682`);
- (e) *(review pass 1)* `new URL('../../x.mjs', import.meta.url)` in a JS suite, resolved against the suite's
  directory like an import, executable extensions only (so `package.json`, manifests and Dockerfiles a suite reads
  stay out, OQ-C2). It finds nothing unrouted today (every target is already under a routed glob), but a new one
  outside a routed glob is now caught;
- (f) *(review pass 1)* the `SITES` table of a JS suite that copies the checkout's `scripts/` tree with `cpSync(…,
  'scripts')` and runs each entry from the copy: each entry's first string resolves under `scripts/`. Only
  `tests/ci/esm-main-guard-symlink.test.mjs` (`quality.yml:869`; copies `scripts/` at `:106`, spawns every entry
  through `node` at `:131-134`) has this shape. The table form (`['architecture/generate-graphs.mjs', []]`, joined at
  run time) is invisible to (a)–(e). This rule is needed so the floor (D-17.C2c) can require the seven entries below:
  the floor check fails any floor path the derivation does not produce. Their transitive imports add no further
  unrouted file (checked: `scratchpad/pr1/sites-closure.txt`, 134 files).
- (g) *(review pass 2)* in a JS suite that calls `spawnSync`, `execFileSync`, `spawn` or `execFile` with
  `process.execPath`, each repo-root-relative string literal `'(scripts|server|tests|config|gateway|shared)/….(mjs|cjs|js)'`
  that is a tracked file is a subject, plus its import closure (rule (a) applied to it; ESM evaluates every static
  import before the entry runs). `tests/ownership/phase-smoke-cleanup-composition.test.mjs` (`npm run test:ownership`,
  `quality.yml:682`) lists `scripts/ops/phase2-alert-receiver-smoke.mjs`,
  `scripts/ops/phase2-gateway-audit-compose-smoke.mjs` and `scripts/perf/phase3-compose-benchmark-smoke.mjs` (`:9-13`)
  and runs each with `spawnSync(process.execPath, [subject])` (`:221-232`). (a)–(f) see none of them, and a
  `throw` added to `scripts/perf/phase3-compose/config.mjs` turns that suite red while selecting no
  ci-classifier-tests job (review pass 2). Over all 208 suites the rule adds those 3 entries, their 18-file import
  closure, and 2 files already routed (`scripts/ci/vendor/forgejo-artifact-v4/verify-vendor.mjs`,
  `scripts/ci/write-runtime-image-evidence.mjs`); nothing else.
- (h) *(review pass 3)* in every derived **shell** subject (`.sh`, or extensionless with a `sh`/`bash` shebang such as
  `server/.husky/pre-commit`), a `source`/`.` in command position of `"$VAR/x.sh"`, `"$(dirname "$0")/x.sh"` (or
  `${BASH_SOURCE[0]}`) or a literal relative `x/y.sh` is a subject, applied transitively to what it sources. The
  helper recognises exactly two variable classes:
  - **script-dir** variables, by name `SCRIPT_DIR`, `script_dir`, `*_SCRIPT_DIR` or `*_script_dir` (all assigned from
    `dirname "${BASH_SOURCE[0]}"`/`"$0"` in the tree), and an inline `$(dirname "$0")` or
    `$(dirname "${BASH_SOURCE[0]}")`: resolved against the **sourcing file's** directory;
  - **root** variables, any name containing `ROOT` or `WORKSPACE` (case-insensitive: `ROOT_DIR`, `REPO_ROOT`,
    `PROJECT_ROOT`, `repo_root`, `WORKSPACE`, …): resolved against the **repo root**.

  A literal relative path resolves against the repo root (the scripts `cd` there first). Any other variable
  (`$port_env`, `$config_file`, `$ownership_dir`, `$SANCTUARY_OWNERSHIP_TOOL_DIR`) is a runtime input and is not
  followed; their tracked targets are under routed `scripts/ownership/*` and `scripts/ci/*` today. Rules (a)–(g)
  applied the shell patterns only to the suites, so a file sourced by a sourced or run subject was executed but never
  derived. Two are executed by a suite:
  - `tests/install/utils/upgrade-source-refs.sh`: `tests/ci/install-test-ports.test.sh:71` sources
    `tests/install/utils/upgrade-selection.sh`, which sources it at `:4-6` through `upgrade_selection_script_dir`
    (also `scripts/ci/run-upgrade-baseline-isolated-subject.sh:20`, through `$WORKSPACE`). An `exit 7` inserted at
    its line 2 turned `install-test-ports.test.sh` from rc 0 to rc 7 (review pass 3, `scratchpad/p3-usr-probe.txt`);
  - `scripts/integration-test-defaults.sh`: `tests/ci/integration-compose-isolation.test.sh:165` runs
    `scripts/run-integration-tests.sh`, which sources it at `:70` through `SCRIPT_DIR`. A failing
    `apply_integration_test_defaults` turned that suite from 12/12 to 11 passed / 1 failed, rc 1
    (`scratchpad/p3-ici-{base,probe}.txt`).

  The rule also yields `tests/install/utils/helpers.sh` (sourced by `tests/install/run-all-tests.sh:27` through
  `SCRIPT_DIR`, and by `scripts/ci/run-compose-e2e-subject.sh:79` as a literal path) and, transitively,
  `tests/install/utils/assertion-tracking.sh` (sourced by `helpers.sh:14` through an inline
  `$(dirname "${BASH_SOURCE[0]}")`). No suite executes the real copies of those two today:
  `ci-registration-completeness.test.sh:353-361` only greps `run-all-tests.sh`, and
  `run-compose-e2e-subject-migration-wait.test.sh:65` runs its subject in a stub workspace. They are routed anyway
  rather than narrowing (h): over-routing only selects the classifier job more often, and edits to either already run
  the install lanes. Rule (h) also adds the already-routed `scripts/ci/forgejo-report-api.sh`. Rule (h) is applied to the
  shell suites themselves as well (`reached` starts from the suite plus its import graph — review pass 4); today that adds
  nothing (checked, passes 3 and 4), but a suite that `source`s an unrouted file through `$SCRIPT_DIR` or a literal path now
  fails the guard (pass-4 probe: `. "$SCRIPT_DIR/../../tests/install/utils/upgrade-assertions.sh"` in a suite → guard FAIL). Over all 208 suites (h) adds those 5 files and nothing else.
  The pass-3 sourced-file sweep over every derived `.sh` subject (both resolutions for every `"$VAR/x"`) found no
  other unrouted target, and a wider probe of every quoted script or data literal and every `$ROOT/…` path in the
  suites found no other executed, unrouted file; the rest are reads or fixture strings (OQ-C2).

That gives 291 subjects (243 with rules (a)–(c) only; rule (g) adds 23; rule (h) adds 5; the patched tree adds the
helper itself, 292). **55 are unrouted at base:**

| Subject | Executed by (suite) | Class |
|---|---|---|
| `scripts/quality/check-root-layout.mjs` | check-root-layout.test.mjs | finding |
| `scripts/perf/wallet-sync-{database-readiness,replay-ownership,replay-cleanup}.mjs` | wallet-sync-{database-readiness,replay-cleanup}.test.mjs | finding |
| `server/scripts/{check-runtime-prisma-deps,project-runtime-dependencies}.cjs` | runtime-prisma-dependencies.test.cjs | finding |
| `scripts/perf/wallet-sync-{high-fanout-replay,replay-creation,health-probe}.mjs` | same wallet-sync suites (import graph) | new instance |
| `scripts/lib/is-main-module.mjs` | is-main-module, esm-main-guard-symlink and ~30 more | new instance |
| `server/stryker.critical.config.mjs`, `server/scripts/mutation/shards.mjs` | check-critical-mutation-config.test.mjs. The mutation lane runs the gate (`test.yml:415`), not this suite | new instance |
| `scripts/bump-funds-critical.sh` | tests/release/bump-funds-critical.test.mjs (spawns it) | new instance |
| `scripts/create-forge-release.sh` | tests/release/create-forge-release.test.sh (copies and runs it) | new instance |
| `scripts/offline/{apply-bundle,bundle-common}.sh` | tests/release/prepare-release-assets.test.mjs (copies, sources) | new instance |
| `tests/install/utils/upgrade-selection.sh` | install-test-ports.test.sh (sources it) | new instance |
| `tests/install/utils/collect-upgrade-artifacts.sh` | redactor-fixture.test.sh | new instance |
| `tests/install/run-all-tests.sh` | ci-registration-completeness.test.sh | new instance |
| `config/tooling/jscpd.json` | jscpd-only.test.sh (copies it into the fixture) | new instance |
| `config/wallet-safety-critical-paths.json` | tests/release/publish-release.test.sh (copies it) | new instance |
| `.github/ci-performance-budget.json` | time-command.test.sh (copies it) | new instance |
| `scripts/reset-user-2fa.sh` | tests/ownership/deployment-lifecycle.test.sh (runs it as a command, rule (d)) | new instance (review pass 1) |
| `scripts/support-package-runner.mjs`, `scripts/generate-signer-inventory.mjs`, `scripts/check-server-cycle-baseline.mjs`, `scripts/check-wallet-sync-{lifecycle-contract,mutation-boundaries}.mjs`, `scripts/architecture/{generate-graphs,extract-call-graphs}.mjs` | esm-main-guard-symlink.test.mjs (`SITES`, rule (f)) | new instance (review pass 1) |
| `scripts/ops/{phase2-alert-receiver-smoke,phase2-gateway-audit-compose-smoke}.mjs`, `scripts/perf/phase3-compose-benchmark-smoke.mjs`, and their import closure: `scripts/perf/phase3-benchmark-utils.mjs`, `scripts/perf/phase3-compose/{api,backend-scale-out-proof,benchmark-harness,benchmark-proof,capacity-snapshots,common,compose-runtime,config,large-wallet-history-proof,postgres,proofs,report,sized-backup-restore-proof,worker-proofs}.mjs`, `scripts/perf/phase3-compose/proof-scripts/{backend-scale-out,worker-queue,worker-scale-out}.mjs` (21 files) | phase-smoke-cleanup-composition.test.mjs (spawns via `process.execPath`, rule (g)) | new instance (review pass 2) |
| `tests/install/utils/upgrade-source-refs.sh`, `scripts/integration-test-defaults.sh` | install-test-ports.test.sh / integration-compose-isolation.test.sh (sourced by a sourced or run shell subject, rule (h)) | new instance (review pass 3) |
| `tests/install/utils/{helpers,assertion-tracking}.sh` | ci-registration-completeness, run-compose-e2e-subject-migration-wait (reached by rule (h) through `run-all-tests.sh` and `run-compose-e2e-subject.sh`; not executed by a suite today, routed because over-routing is safe) | new instance (review pass 3) |

Plus the root-layout schema `scripts/quality/root-layout-classification.schema.json`, which is read, not executed,
and is named by the finding. Sweep output: `p17c-tools/derived.tsv`, `unrouted-final.txt` (pass 1);
`scratchpad/p2-derived.tsv`, `scratchpad/p2-unrouted.txt` (pass 2, rule (g)); `scratchpad/p3fix-derived.tsv` (292
lines), `scratchpad/p3fix-unrouted.txt` (55 lines) (pass 3, rule (h)). **Out of this fix
(OQ-C2):** files suites only *name or grep* (workflow YAMLs such as `architecture.yml`, `docker-build.yml` and
`release-candidate.yml` read by check-workflow-composition; Dockerfiles; vitest configs; docs). A text-token rule over
them was prototyped and is dominated by fixture strings (`classify-test-changes.test.sh` commits stubs at
`scripts/generate-readme.sh` and others; the composition test lists path filters), so it cannot be a fail-closed
guard (P3 `ci-classifier--contract-suite-data-inputs-outside-trigger`).

**Root cause.** The trigger list is maintained by hand against suite lists that are also maintained by hand. Nothing
ties either one to what `quality.yml` actually runs, so a new suite, or a new import of an existing suite, is never
checked.

**Decisions.**
- **D-17.C2a — Derive, do not list.** New `tests/ci/lib/classifier-suite-subjects.mjs` (helper, not a suite; under
  `tests/ci/*`, so it routes itself):
  - `deriveSuites(root)`: slices the `ci-classifier-tests` job out of quality.yml as text. This needs no YAML
    dependency, so the bash test runs without `tests/ci/lib/node_modules`. It drops comment, `bash -n` and
    `node --check` lines, appends the bodies of `npm run <x>` scripts from package.json, and expands globs against
    `git ls-files`.
  - `deriveSubjects(root, suites)`: applies rules (a)–(h) above, tracked files only, starting each suite's reached set from
    `[...importGraph(root, suite, tracked), suite]` so rule (h) also follows the suite's own `source` lines (review pass 4,
    `scratchpad/rpr17p4/suite-closure-fix.diff`), and excludes the suites
    themselves. Rules (e), (f) and (g) live in one small top-level helper (`jsLocatedFiles`) so `directlyRunFiles`
    stays short. Rule (h) is `addSourcedClosure` (a worklist over the reached shell files) with `sourcedFiles` and
    `isShellFile`; its two variable classes are named in the helper's header comment.
  - CLI: `node tests/ci/lib/classifier-suite-subjects.mjs <root> [suites|subjects]` prints `path<TAB>suites`.
  - It imports `scripts/lib/is-main-module.mjs` for its main guard. About 202 lines. Lizard: 0 warnings (pass 3).
- **D-17.C2b — Route the 55 plus the schema as exact paths** (no globs, per the D-11.18 rule). These are five new
  `case` arms in `is_ci_classifier_file`, after the D-11.18 arm, with a comment naming D-17.C2 and the guard; the
  third (`server/scripts/*` and `tests/install/*` entries) also holds the four rule (h) files
  (`scripts/integration-test-defaults.sh`, `tests/install/utils/{assertion-tracking,helpers,upgrade-source-refs}.sh`,
  review pass 3), the fourth (review pass 1) holds `scripts/reset-user-2fa.sh` and the seven `SITES` entries, and the
  fifth (review pass 2) holds the 21 rule (g) files (the three Phase 2/3 smoke entries and their import closure) by
  exact path. Globs
  are rejected: `scripts/perf/*` would claim the RC replay driver inputs, `scripts/lib/*` would claim other
  helpers, and a `scripts/perf/phase3-compose/*` glob would still miss `scripts/perf/phase3-benchmark-utils.mjs`.
  Exact paths are what the guard enforces anyway. Cost: `is-main-module.mjs`, `scripts/offline/*.sh`, the seven
  `SITES` scripts, the 21 Phase 2/3 Compose smoke files and the four rule (h) shell helpers are now in the classifier
  job's trigger set and run it when edited (A1's `scripts/generate-signer-inventory.mjs`
  edit is one; the integrated PR runs that job anyway for `scripts/ci/*`). That is cheap; most of those files already
  run install, architecture or verify lanes.
- **D-17.C2c — Drift guard in `classify-quality-scope.test.sh`.** It is added next to the D-11.18 and D-14.C6
  guards, which stay unchanged:
  - `assert_executed_subjects_routed` runs the helper, then checks a **floor** list: the 30 pass-1 subjects, the
    three rule (g) entry scripts (so rule (g) cannot be lost silently), the four rule (h) files (one per resolution
    path: `*_script_dir`/`WORKSPACE`, `SCRIPT_DIR`, `SCRIPT_DIR`/literal, inline `dirname`), plus
    `scripts/quality/jscpd-only.sh` and `server/.husky/pre-commit` (39 lines, `LC_ALL=C` sorted). The floor must be present, so a regression that
    narrows the derivation fails instead of passing vacuously.
  - It then evaluates the real `is_ci_classifier_file` (extracted from the shipped script with `awk`, in a subshell)
    on **every** derived subject (292 on the patched tree; under 1 s) and fails listing each unrouted one.
  - The floor and the schema then go end to end through `run_classifier` in the fixture repo, one commit each,
    asserting `run_ci_classifier_tests=true`.
  - The existing `config/tooling/jscpd.json` loop expectation flips to classifier `true` (one `case` line with a
    D-17.C2 comment).

  Runtime grows from 3.6 s to about 5.4 s (5.42 s observed, pass 3). Rejected:
  - (i) Running all 292 derived subjects through `run_classifier` (about 40 s inside the 4-way parallel suite
    runner, for no extra signal over the shipped predicate).
  - (ii) Exact equality between the derived set and an expected list (the D-11.18 style). It would make every new
    import fail the test, and the developer would just paste the new path in two places.
  - (iii) A manifest file that `classify-quality-scope.sh` reads at runtime. It moves the list rather than
    removing it, and the classifier runs in `determine-scope` before any install.
  - (iv) Also requiring named-only data inputs (OQ-C2).

**Failing-first test (red on base; observed).** `bash tests/ci/classify-quality-scope.test.sh` with the new test and
helper on the base classifier fails with:

`FAIL: files the ci-classifier-tests suites execute do not select the job: .github/ci-performance-budget.json
config/tooling/jscpd.json … tests/install/utils/upgrade-source-refs.sh`

That is exactly the 55 (the 30 of pass 1, the 21 rule (g) files and the 4 rule (h) files), rc 1
(`scratchpad/pr1/c2-red-p3.txt`, pass 3; re-run on a fresh copy, `scratchpad/rpr17p3fix`, with all eight prototypes
applied and the base `classify-quality-scope.sh` swapped in). The
schema and floor end-to-end loop runs after the guard and would fail on its first entry. Green:
`classify-quality-scope regression checks passed`, rc 0, 5.42 s (`scratchpad/pr1/c2-green-p3.txt`).

Confirm red (phase `c` worktree after the C3 commit, the C2 test and helper added, `classify-quality-scope.sh` at
base): `bash tests/ci/classify-quality-scope.test.sh` → rc 1 with exactly the 55; save as `$SCRATCH/i17-c-red-c2.txt`.

**Green criteria (observed on the prototype).**
- `classify-quality-scope.test.sh` passes.
- `tests/ci/ci-registration-completeness.test.sh` 10/10 (the helper is not a `*.test.*` file).
- `bash tests/ci/check-workflow-composition.test.sh` rc 0 (its `classify-quality-scope.sh` order pin at `:3835`
  holds).
- `node tests/ci/check-root-layout.test.mjs` rc 0, `node scripts/quality/check-large-files.mjs` passes, and the
  lifecycle registry is complete.
- Lizard reports 0 for the helper.

**CI lanes.** quality `determine-scope` (the classifier itself), `ci-classifier-tests` (this suite; routed by
`tests/ci/*` and `scripts/ci/*`), `lifecycle-callsites`, `lizard`, `jscpd`, large-file. install-test and RCV also
run (`scripts/ci/*` is release surface). The routing change is proven by the suite's end-to-end classifier runs.
No lane runs the newly routed suites against an edit of their subjects in this PR (that is the point of the fix).

**Compatibility / rollback.** Classifier-only: more PRs select `ci-classifier-tests`; nothing is deselected. Revert the
C2 commit to restore the hand lists.

**Acceptance.** Every file a ci-classifier-tests suite executes selects the job, as derived by the eight rules:
(a) the JS import/require graph, (b) shell `source`/run/copy/script binding through a ROOT variable, (c) JS
`resolve('x')`, (d) a checkout script run as a shell command, (e) `new URL(…, import.meta.url)` scripts, (f) the
`SITES` table of a suite that copies `scripts/`, (g) script literals of a suite that spawns `process.execPath`, and
(h) files **sourced by a derived shell subject**, followed transitively (script-dir and ROOT/WORKSPACE variables, inline
`dirname`, literal relative paths). That includes the 55 unrouted at base; a new suite, import or `source` that adds
an unrouted subject fails `classify-quality-scope.test.sh`.

### Phase C verification (worker, phase `c` worktree)

```bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i17-c
BASE=c81b2d372576da75efa0b9406dc480777b1dbb7f   # the plan commit differs from it only under tasks/
git add -A docker scripts tests                                  # scanners skip untracked files
npx vitest run --config config/tooling/vitest.config.ts tests/config     # 11 files / 61 tests incl. torIngress 6/6 (C1 + C3)
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # 4/4
bash tests/install/unit/upgrade-helpers.test.sh                  # 110/110
bash tests/install/unit/offline-compose-images.test.sh
node --test tests/ownership/compose-oci-labels.test.mjs tests/ownership/deployment-definition.test.mjs \
  tests/ownership/owner-container-label.test.mjs                 # 18/18
npm ci --prefix tests/ci/lib --ignore-scripts                    # as quality.yml's classifier job
node --test tests/ci/check-supply-chain-locks.test.mjs           # 17/17
bash tests/ci/classify-quality-scope.test.sh                     # passed
bash tests/ci/ci-registration-completeness.test.sh               # 10/10
bash tests/ci/check-workflow-composition.test.sh                 # rc 0
node tests/ci/check-root-layout.test.mjs
node scripts/ownership/check-lifecycle-callsites.mjs             # complete
node scripts/quality/check-large-files.mjs
sh -n docker/nginx/docker-entrypoint.sh
bash -n scripts/ci/classify-quality-scope.sh
npm run typecheck:tests
test -z "$(git diff --name-only "$BASE" -- .nvmrc .github/workflows/verify-vectors.yml \
  scripts/ci/docker-endpoint-lib.sh shared/constants config/address-key-corpus-sources.json \
  scripts/generate-address-key-corpora.mjs server/tests/fixtures scripts/verify-addresses)"   # provenance-pinned
test -z "$(git diff --name-only "$BASE" -- .github)"            # quality.yml is read, never edited
/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard -w -l javascript -l typescript -C 15 -T nloc=200 \
  tests/config/torIngress.test.ts tests/ci/lib/classifier-suite-subjects.mjs   # 0 warnings
```

Notes:
- **Red recording.** Copy the base `docker/{compose/tor.yml,tor/payjoin-ingress.conf,nginx/docker-entrypoint.sh}` or
  `scripts/ci/classify-quality-scope.sh` over the patched tree with `git show <plan-commit>:<path> > <path>`, never
  `git stash`. For C3, copy `docker/tor/payjoin-ingress.conf` from the C1 commit (`git show <C1-commit>:<path>`). Run
  the test, restore with `git checkout -- <path>`, and save `$SCRATCH/i17-c-red-{c1,c3,c2}.txt`.
- `shellcheck` is not installed on the dev host. No new disable.
- No docker, Playwright or coverage in this phase. The runtime Tor-overlay evidence arrives with
  `upgrade-extended-fixture-test` after merge and in RCV.

### Phase C changelog bullets (integrator, `## [Unreleased]`)

- Tor: Payjoin over Tor works. Since v0.8.63 the Tor ingress removed the `Host` header, and the backend rejected every
  onion Payjoin request with 400 before it reached the receiver, so senders silently fell back to an ordinary
  transaction. The ingress now sends a fixed `Host: payjoin-ingress`, which names neither the `.onion` address nor
  the client. If you set `SANCTUARY_TOR_INGRESS_CONFIG` to your own copy of the ingress file, replace its
  `proxy_set_header Host "";` line the same way.
- Tor: the Tor Payjoin route also keeps reaching the backend after the backend or the Tor ingress container is
  recreated (for example after adding `PAYJOIN_PUBLIC_URL` to `.env`, or after an upgrade). The ingress now
  re-resolves the backend through the container DNS resolver, as the main frontend has done since #967. The Tor
  service checks the ingress address every 15 seconds and reloads Tor when it changes; the `.onion` address and keys
  are unchanged. Previously both hops kept the IP they saw at startup until Tor was restarted by hand.
- CI: changing a script or config that a CI-classifier suite runs now runs that suite on the same PR. The suites
  include root-layout, wallet-sync replay cleanup and readiness, runtime Prisma dependencies, critical-mutation
  config, `is-main-module`, release bump and Forgejo release scripts, offline bundle helpers, install-test helpers,
  the 2FA reset script, and the CLIs the ESM main-guard suite runs (support-package runner, signer-inventory
  generator, architecture graph generators, wallet-sync contract checks, server cycle baseline), the Phase 2/3
  Compose smoke scripts, the upgrade baseline-ref helper, the install-test shell helpers, and the integration-test
  defaults. Files those scripts `source` count too. The trigger list is now checked against what `quality.yml` actually runs, not against a hand-kept list.

## Implementation log (coordinator)

- (empty until the phase workers start; record the plan-commit SHA, each phase commit, each red/green run file
  `$SCRATCH/i17-<phase>-red*.txt` / `-green*.txt`, any D-17.X3 stop, the cherry-picked SHAs, the B3 integration red
  log, the `/simplify` and adversarial-review outcome, the integrator commit and the Verification block's exit
  status.)
- Post-implementation review fixes, commit 1 (`fix: find the running Tor process for the ingress watcher`, on
  `b9657f6d9`):
  - Adversarial C1, P2 (completes `tor-payjoin-ingress--stale-ips-after-container-recreate`): the pinned torproxy
    image runs `/sbin/tini` as PID 1 with Tor as its child, so the watcher's `until /proc/1/comm = tor` never
    succeeded and the ingress re-resolve never ran. The watcher now scans `$PAYJOIN_INGRESS_PROC_ROOT/[0-9]*/comm`
    (default `/proc`) with builtins on every check, gates its first lookup on a `tor` process, HUPs the PID it found
    and exits when none remains; the `PAYJOIN_INGRESS_TOR_PID` hook is gone; `entrypoint: []` rejected (tini
    reaping). Red on `b9657f6d9` (fake proc root with a `tini` PID 1 and Tor under another PID; the bounded watcher
    exits 124) and green in `$SCRATCH/i17-fix-red.txt` / `i17-fix-green.txt`; also green with busybox ash as `sh`
    and against a real `/proc` under `unshare -rpf --mount-proc` (busybox PID 1, Tor as PID 3). The unshare harness
    is not committed: CI's job container is not known to allow user namespaces.
  - /simplify efficiency #2: D-17.A2c guard is `syncHistoryWindowMs(deadline) < SYNC_REMOTE_STAGE_BUDGET_MS`
    (10-minute attempt recursion case red on `b9657f6d9`, green after).
  - Adversarial A1, P3: D-17.A1e sentence names the canonical-policy-identity scope and the legacy-wallet skip; two
    Verification needles added.
- Post-implementation review fixes, commit 2 (`refactor: share agent wallet role resolution and sync batch
  constants`):
  - quality #2 + efficiency #1: `findAgentWalletAccessProblem` (see the D-17.B1b note), used by `agent/auth.ts` and
    `adminAgentService.ts`; ordering and error mapping unchanged. First landed in `services/accessControl.ts`.
  - quality #1: `fetchHistories.ts` and `evidenceAuthentication.ts` use `SYNC_REMOTE_BATCH_SIZE` instead of private
    10s.
  - quality #3 (narrowed): `readSubscriptionCoverage` refuses a `statementTimeoutMs` that is not an integer in
    1..60000 with a `RangeError` before opening a transaction (Postgres reads 0 as "no timeout"). Six invalid-value
    cases red on `b0b0307cf`, green after. Sibling repositories untouched.
  - quality #4: `classifier-suite-subjects.mjs` reuses `listTrackedFiles` (already exported by
    `scripts/quality/check-root-layout.mjs`, not edited) and reads `jobs['ci-classifier-tests'].steps[].run` through
    `tests/ci/lib/yaml.mjs`; derived set unchanged at 292 (only the owner lists of `check-root-layout.mjs` and
    `tests/ci/lib/yaml.mjs` gain `classify-quality-scope.test.sh`).
  - quality #5: `authenticateHistoryResults(ctx, { requestOptions?, openStage? })`; the two test callers that passed
    request options (`receiveEvidenceAuthentication.test.ts`, `receiveEvidenceCompactStaging.test.ts`) change one
    line each.
  - quality #6: `historyWindow` in `fetchHistories.ts`; `isAttemptCancelled(signal)` in `evidenceAuthentication.ts`
    at `:223` and `:465`.
  - quality #7: the B2 `batchIntentSpendSummary` comment states the `spend.amount > 0` guard.
- Post-implementation review fixes, commit 3 (`refactor: keep agent wallet role resolution out of the pinned
  access-control module`): coordinator decision. Commit 2 had edited `services/accessControl.ts` (a Stryker mutate
  target the plan keeps read-only) and dropped it from `PINNED_SURFACES`. The helper and its 7 cases move to the new
  `services/agentWalletAccess.ts` and `tests/unit/services/agentWalletAccess.test.ts`; `accessControl.ts` and
  `accessControl.test.ts` are byte-identical to `c81b2d372576` again; `accessControl.ts` is back in
  `PINNED_SURFACES` and the additions-only special case is gone. Callers, the route harness and the smoke test point
  at the new module. Expected `arch:graphs` change: none (every collapsed edge already exists; see D-17.X8).

## Verification (before every push)

Workers run only their phase's typechecks and targeted tests (no coverage, no integration specs) and record red runs
on the plan-commit base. The integrator runs the whole block below, as written, as one script on the integrated PR
branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i17` (every `cd server` is in a subshell), only after every
phase branch is cherry-picked. Write the block to `$SCRATCH/i17-verify.sh` and run `bash "$SCRATCH/i17-verify.sh"`
(D-17.X2). Any `tests/install/unit` suite run directly (outside `scripts/ci/run-install-unit-tests.sh`) needs the
`@runtime` project-lock-root env.

**Integrator step before the block.** Set up the integration worktree like the phase worktrees (D-17.X1). Run
`npm run arch:graphs` and `npm run arch:calls` and commit `docs/architecture/generated` (if changed) in the integrator
commit with the changelog bullets (Phase A, B and C sections), so `arch:check` below is a pure check. Create the
Playwright inputs under `$SCRATCH/i17-playwright/`: copy `$SCRATCH/i16-playwright/playwright.static.config.mts` and
`$SCRATCH/i16-playwright/known-auth-login-failures.txt` there, and change the wrapper's import path from
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i16/config/tooling/playwright.config.ts` to
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i17/config/tooling/playwright.config.ts` (the block asserts it). Do not
copy `results.json`, `failing.txt` or `unexpected.txt`. Confirm no container from an earlier attempt still holds the
name prefix `sanctuary-i17-redis-` (`docker ps -a --filter name=sanctuary-i17-redis-`); remove a stale one by its exact
ID only.

**B3 integration red on a guarded base swap** (D-17.X3; workers may not run integration specs). After every phase is
cherry-picked and before the block, the integrator swaps in the four base B3 production files (no `git stash`), runs
only the new B3 integration case under the same integration lock as the block, restores the files and verifies the
restore. Write it to `$SCRATCH/i17-b3-integration-red.sh` and run `bash "$SCRATCH/i17-b3-integration-red.sh"`. Any
non-zero exit (a DB that does not start, a different red reason, or a failed restore) is a D-17.X3 stop; on a failed
restore, run `git checkout -- <the four files>` and confirm `git diff --exit-code HEAD -- <the four files>` before
anything else. Every other phase stays at head during the swap (none calls the B3 read).

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i17
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i17
BASE=c81b2d372576da75efa0b9406dc480777b1dbb7f
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
FILES=(server/src/repositories/subscriptionCoverageReadRepository.ts server/src/repositories/subscriptionCoverageRepository.ts
  server/src/services/sync/schedulerRetirementReadiness.ts server/src/services/supportPackage/collectors/schedulerRetirementReadiness.ts)
LOG_B3="$SCRATCH/i17-b3-integration-red.txt"
test -z "$(git status --porcelain)"                 # clean tree before the swap
exec 9>/home/nekoguntai/.i17-integration.lock
flock 9                                             # same lock as the block's integration lines; held to exit
trap 'git checkout -- "${FILES[@]}"' EXIT           # restore even if a later line fails
for f in "${FILES[@]}"; do git show "$BASE:$f" >"$f"; done
test "$(git diff --name-only HEAD -- "${FILES[@]}" | wc -l)" -eq 4   # the swap took effect
RC_B3=0
npm --prefix server run test:integration:db -- tests/integration/repositories/walletSyncCrossNetworkContract.test.ts \
  -t "cancels a bounded read that waits past its statement timeout" >"$LOG_B3" 2>&1 || RC_B3=$?
git checkout -- "${FILES[@]}"
git diff --exit-code HEAD -- "${FILES[@]}"          # restore verified
test -z "$(git status --porcelain)"
trap - EXIT
test "$RC_B3" -ne 0                                 # red on base code
grep -qE 'Tests +1 failed' "$LOG_B3"                # exactly the one filtered case failed (not a collection error)
grep -qF "status: 'available'" "$LOG_B3"            # the predicted reason: the unbounded base read waited and succeeded
echo "B3 integration red recorded in $LOG_B3; B3 files restored"
```
If the red reason differs from the predicted one (for example the case fails on the elapsed-time assertion with
`unavailable`, or the holder transaction errors), that is a D-17.X3 stop: record the log and re-assess before the
block.

**The verification block.**

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i17
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i17
test "$(npm --version | cut -d. -f1)" = 12   # devEngines requires npm 12; the system ~/.local/bin npm 11 fails EBADDEVENGINES
test -d node_modules       # real install present (one gate per line: a failing non-final && command does not exit under set -e)
test ! -L node_modules     # real install; a symlink breaks arch:graphs (shared/* edges)
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"   # D-17.X4 pinned binary
BASE=c81b2d372576da75efa0b9406dc480777b1dbb7f
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
REDIS_IMAGE='redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2'   # config/container-image-lock.json:14
REDIS_CID=""
SRV=""
cleanup() {
  if [ -n "$SRV" ]; then kill "$SRV" 2>/dev/null || true; fi
  if [ -n "$REDIS_CID" ]; then docker rm -f "$REDIS_CID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
wait_for_no_coverage() {
  for _ in $(seq 1 180); do
    if ! pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage' >/dev/null && ! pgrep -f '[n]ode_modules/.bin/stryker run' >/dev/null; then
      return 0
    fi
    sleep 10
  done
  echo "coverage guard: another vitest coverage or Stryker run is still active after 30 min" >&2
  return 1
}
npm run build --workspace=shared   # B2 edits shared/schemas; server and frontend tests read shared/dist
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )   # CI's Full Backend Typecheck; tsc --noEmit alone misses test files
# targeted backend: A2 (history budgets), A1 (gap expansion), B1 (agent roles), B2 (batch spend), B3 (readiness bound)
( cd server && npx vitest run tests/unit/services/bitcoin/sync tests/unit/services/bitcoin/blockchain \
  tests/unit/services/bitcoin/blockchain.test.ts tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts \
  tests/unit/services/blockchainService.test.ts tests/unit/services/wallet tests/unit/assistant tests/unit/mcp \
  tests/unit/api/addresses.test.ts tests/unit/api/transactions-addresses-routes-extended.test.ts \
  tests/unit/api/wallets-export-routes.test.ts tests/unit/services/agentOperationalAddressService.test.ts \
  tests/unit/agent tests/unit/services/adminAgentService.test.ts tests/unit/services/agentWalletAccess.test.ts \
  tests/unit/api/admin-agents-routes.test.ts \
  tests/unit/api/admin-agents-routes.controls.test.ts tests/unit/api/agent-wallet-funding-smoke.test.ts \
  tests/unit/middleware/agentAuth.test.ts tests/unit/services/agentApiService.test.ts tests/unit/api/agent-routes.test.ts \
  tests/unit/api/agent-routes.funding.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts \
  tests/unit/api/openapi.transfers-agent.test.ts tests/unit/api/openapi.test.ts \
  tests/unit/api/transactions-http-routes.test.ts tests/unit/api/transactions \
  tests/unit/api/transactionsSigningIntentBroadcast.replacement.test.ts tests/unit/api/openapi.psbt-signing-context.test.ts \
  tests/unit/services/draftCreate.test.ts tests/unit/repositories/subscriptionCoverageRepository.test.ts \
  tests/unit/services/supportPackage tests/unit/services/sync tests/unit/worker )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only; scoped to tests/unit as CI (D-17.X5)
# --- full backend integration suite with Redis (D-17.X3 integration rule; serialized host-wide) ---
# CI's shape (test.yml "Run integration tests"): every non-destructive group in one vitest, then ops-destructive,
# with SANCTUARY_REQUIRE_REDIS_INTEGRATION=true so Redis-gated specs fail at collection instead of skipping.
bash scripts/ci/backend-integration-groups.sh --check   # every integration spec is grouped (B3 adds a case, not a spec)
bash tests/ci/backend-integration-groups.test.sh
REDIS_PASS="i17-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
REDIS_CID="$(docker run -d --rm --name "sanctuary-i17-redis-$$" -p 127.0.0.1::6379 "$REDIS_IMAGE" redis-server --requirepass "$REDIS_PASS" --save '' --appendonly no)"
test -n "$REDIS_CID"
REDIS_PORT="$(docker port "$REDIS_CID" 6379/tcp | head -n 1 | sed 's/.*://')"
test -n "$REDIS_PORT"
for _ in $(seq 1 30); do
  if docker exec "$REDIS_CID" redis-cli --no-auth-warning -a "$REDIS_PASS" ping 2>/dev/null | grep -qx PONG; then break; fi
  sleep 1
done
docker exec "$REDIS_CID" redis-cli --no-auth-warning -a "$REDIS_PASS" ping | grep -qx PONG   # Redis ready, else stop
export REDIS_URL="redis://:${REDIS_PASS}@127.0.0.1:${REDIS_PORT}"
export SANCTUARY_REQUIRE_REDIS_INTEGRATION=true
INT_MAIN=()
INT_DESTRUCTIVE=()
mapfile -t INT_GROUPS < <(bash scripts/ci/backend-integration-groups.sh --groups)
test "${#INT_GROUPS[@]}" -gt 0
for g in "${INT_GROUPS[@]}"; do
  mapfile -t g_specs < <(bash scripts/ci/backend-integration-groups.sh "$g")
  test "${#g_specs[@]}" -gt 0
  if [ "$g" = ops-destructive ]; then INT_DESTRUCTIVE+=("${g_specs[@]}"); else INT_MAIN+=("${g_specs[@]}"); fi
done
test "${#INT_MAIN[@]}" -gt 0
test "${#INT_DESTRUCTIVE[@]}" -gt 0
flock /home/nekoguntai/.i17-integration.lock npm --prefix server run test:integration:db -- "${INT_MAIN[@]}" \
  --reporter=default --reporter=json --outputFile.json="$SCRATCH/i17-integration-main.json" 2>&1 | tee "$SCRATCH/i17-integration-main.txt"
flock /home/nekoguntai/.i17-integration.lock npm --prefix server run test:integration:db -- "${INT_DESTRUCTIVE[@]}" \
  2>&1 | tee "$SCRATCH/i17-integration-destructive.txt"
# every Redis-gated spec actually ran (a describe.skip would leave it with zero passed tests)
test -s "$SCRATCH/i17-integration-main.json"
mapfile -t REDIS_SPECS < <(git grep -l describeWithRedis -- server/tests/integration ':(exclude)server/tests/integration/setup')
test "${#REDIS_SPECS[@]}" -gt 0
for f in "${REDIS_SPECS[@]}"; do
  test "$(jq --arg f "/${f}" '[.testResults[] | select(.name | endswith($f)) | .assertionResults[] | select(.status == "passed")] | length' "$SCRATCH/i17-integration-main.json")" -gt 0 \
    || { echo "Redis-gated integration spec did not run: $f" >&2; exit 1; }
done
# B3's new integration case ran and passed on the integrated head
test "$(jq '[.testResults[] | .assertionResults[] | select(.title == "cancels a bounded read that waits past its statement timeout" and .status == "passed")] | length' "$SCRATCH/i17-integration-main.json")" -eq 1
docker rm -f "$REDIS_CID" >/dev/null
REDIS_CID=""
unset REDIS_URL SANCTUARY_REQUIRE_REDIS_INTEGRATION
# --- mutation pins and scope (re-derived on c81b2d372576) ---
# Tier 1 — CI-run Stryker mutate targets, the mutation map, the critical list's production files: NO planned change touches them.
PINNED_SURFACES=(
  server/src/services/bitcoin/addressDerivation.ts server/src/services/bitcoin/addressDerivation
  server/src/services/bitcoin/psbtValidation.ts server/src/services/bitcoin/psbtInfo.ts
  server/src/services/bitcoin/validationEvidenceContracts.ts server/src/services/bitcoin/signingIntent
  server/src/services/bitcoin/transactions server/src/services/bitcoin/blockchain/broadcastPreflight.ts
  server/src/services/bitcoin/blockchain/networkOperations.ts server/src/services/bitcoin/advancedTx
  server/src/services/bitcoin/psbtAccountBinding.ts server/src/services/bitcoin/psbtSigningContextValidation.ts
  server/src/services/bitcoin/rawTransactionEvidence.ts server/src/services/bitcoin/transactionWeight.ts
  server/src/services/bitcoin/utxoSelection.ts server/src/repositories/transactionSigningIntentRepository.ts
  server/src/api/transactions/broadcasting.ts server/src/api/drafts.ts server/src/middleware/auth.ts
  server/src/services/accessControl.ts src/services/hardwareWallet/psbtAccountBinding.ts shared/constants/walletPolicy.ts
  config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation
  .github/mutation-baseline.json
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")"
grep -qF 'export async function findAgentWalletAccessProblem(' server/src/services/agentWalletAccess.ts   # /simplify helper lives outside the pinned module
# B2's drafting.ts and its contracts file are on is_critical_mutation_file but are not mutate targets (D-17.X6 (2))
test "$(git diff --name-only "$BASE" HEAD -- server/src/api/transactions server/tests/unit/api/transactionsHttpRoutes | sort | tr '\n' ' ')" \
  = "server/src/api/transactions/drafting.ts server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts.ts "
# Tier 2 — whole-file globs in Stryker configs no CI lane runs: exactly B2's four files (D-17.X6 (3))
UNSCHEDULED_SURFACES=(
  server/src/services/scriptTypes server/src/services/bitcoin/descriptorParser.ts server/src/services/bitcoin/descriptorBuilder.ts
  server/src/services/authService.ts server/src/services/encryption.ts server/src/services/twoFactorAuth.ts
  server/src/services/tokenRevocation.ts server/src/services/walletService.ts server/src/utils src/hooks src/utils shared
)
test "$(git diff --name-only "$BASE" HEAD -- "${UNSCHEDULED_SURFACES[@]}" | sort | tr '\n' ' ')" \
  = "shared/schemas/transactionResponses.ts src/hooks/send/types.ts src/hooks/send/useBroadcast.ts src/hooks/send/useDraftManagement.ts "
# sync-path, replay, schema and capability-manifest surfaces untouched (no migration; replay driver seal unchanged)
test -z "$(git diff --name-only "$BASE" HEAD -- server/prisma config/wallet-sync-mutation-boundaries.json config/wallet-sync-lifecycle-contract.json scripts/perf shared/constants/hardwareWalletCapabilities.ts)"
# critical-path services the plan keeps read-only
test -z "$(git diff --name-only "$BASE" HEAD -- server/src/services/draftCreate.ts server/src/services/agentApiService.ts server/src/services/supportPackage/runner.ts)"
# verify-vectors provenance: no VERIFIER_SOURCE_FILES entry changed (scripts/verify-addresses/sourceManifest.ts:2-37)
test -z "$(git diff --name-only "$BASE" HEAD -- .nvmrc .github/workflows/verify-vectors.yml scripts/ci/docker-endpoint-lib.sh shared/constants config/address-key-corpus-sources.json scripts/generate-address-key-corpora.mjs server/tests/fixtures scripts/verify-addresses)"
test -z "$(git diff --name-only "$BASE" HEAD -- .github)"   # no workflow or action edited
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts
# exact-file scope: the whole PR diff, minus tasks/ and docs/architecture/generated/, is exactly the ownership table
# plus the integrator's changelog
EXPECTED_FILES="$(sort <<'EOF'
config/hardware-wallet-implementation-inventory.json
docker/compose/tor.yml
docker/nginx/docker-entrypoint.sh
docker/tor/payjoin-ingress.conf
docs/explanation/address-derivation.md
docs/how-to/agent-wallet-funding.md
docs/plans/wallet-sync-progress-timeout-remediation.md
docs/reference/changelog.md
scripts/ci/classify-quality-scope.sh
scripts/generate-signer-inventory.mjs
server/src/agent/auth.ts
server/src/api/openapi/paths/agent.ts
server/src/api/openapi/schemas/transactions.ts
server/src/api/transactions/drafting.ts
server/src/repositories/subscriptionCoverageReadRepository.ts
server/src/repositories/subscriptionCoverageRepository.ts
server/src/services/adminAgentService.ts
server/src/services/agentWalletAccess.ts
server/src/services/bitcoin/blockchain/syncWallet.ts
server/src/services/bitcoin/sync/addressDiscovery.ts
server/src/services/bitcoin/sync/attemptRuntime.ts
server/src/services/bitcoin/sync/evidenceAuthentication.ts
server/src/services/bitcoin/sync/historyEvidenceAuthentication.ts
server/src/services/bitcoin/sync/phases/fetchHistories.ts
server/src/services/supportPackage/collectors/schedulerRetirementReadiness.ts
server/src/services/sync/schedulerRetirementReadiness.ts
server/tests/integration/repositories/walletSyncCrossNetworkContract.test.ts
server/tests/unit/agent/auth.test.ts
server/tests/unit/api/admin-agents-routes.fixtures.ts
server/tests/unit/api/admin-agents-routes.test.ts
server/tests/unit/api/adminAgentsRoutes.testHarness.ts
server/tests/unit/api/agent-wallet-funding-smoke.test.ts
server/tests/unit/api/openapi.transfers-agent.test.ts
server/tests/unit/api/openapi.wallet.contracts.ts
server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts.ts
server/tests/unit/repositories/subscriptionCoverageRepository.test.ts
server/tests/unit/services/adminAgentService.test.ts
server/tests/unit/services/agentWalletAccess.test.ts
server/tests/unit/services/bitcoin/blockchain.syncWalletRecursion.test.ts
server/tests/unit/services/bitcoin/blockchain/gapLimit.contracts.ts
server/tests/unit/services/bitcoin/sync/attemptRuntime.test.ts
server/tests/unit/services/bitcoin/sync/historyStageBudget.test.ts
server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts
server/tests/unit/services/bitcoin/sync/receiveEvidenceCompactStaging.test.ts
server/tests/unit/services/blockchainService/address-discovery.contracts.ts
server/tests/unit/services/supportPackage/schedulerRetirementReadinessCollector.test.ts
shared/schemas/transactionResponses.ts
src/api/transactions/types.ts
src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts
src/components/send/SendTransactionPage/types.ts
src/components/send/SendTransactionWizard/draftTransactionData.ts
src/components/send/SendTransactionWizard/types.ts
src/hooks/send/types.ts
src/hooks/send/useBroadcast.ts
src/hooks/send/useDraftManagement.ts
tests/ci/classify-quality-scope.test.sh
tests/ci/lib/classifier-suite-subjects.mjs
tests/components/send/draftTransactionData.test.ts
tests/config/torIngress.test.ts
tests/hooks/useBroadcast.test.tsx
tests/hooks/useDraftManagement.test.tsx
tests/hooks/useSendTransactionActions/useSendTransactionActions.drafts.contracts.tsx
tests/shared/transactionResponses.test.ts
EOF
)"
test "$(printf '%s\n' "$EXPECTED_FILES" | wc -l)" -eq 63   # ownership rows: a 17, b 38, c 7 (C3 adds no file); plus the integrator's changelog
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' ':(exclude)docs/architecture/generated' | sort)"
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# line-local scope inside shared/generated files
test "$(git diff --numstat "$BASE" HEAD -- scripts/generate-signer-inventory.mjs | cut -f1-2)" = "$(printf '0\t1')"   # D-17.A1c: one row removed (:107)
test "$(git diff --numstat "$BASE" HEAD -- config/hardware-wallet-implementation-inventory.json | cut -f1)" = 0         # D-17.A1c: regeneration only removes
test "$(git diff --numstat "$BASE" HEAD -- server/src/services/bitcoin/sync/evidenceAuthentication.ts | cut -f1-2)" = "$(printf '11\t6')"   # D-17.A2b :465, plus /simplify isAttemptCancelled (:223, :465) and SYNC_REMOTE_BATCH_SIZE
test "$(git diff --numstat "$BASE" HEAD -- server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts | cut -f1-2)" = "$(printf '1\t1')"   # one caller line, no growth
test "$(git diff --numstat "$BASE" HEAD -- server/tests/unit/services/bitcoin/sync/receiveEvidenceCompactStaging.test.ts | cut -f1-2)" = "$(printf '1\t1')"   # one caller line
# docs lines (wrap-insensitive: command substitution + here-string, so no pipe into grep -q under pipefail)
grep -qF 'The address-history phase runs inside one window of at most 20 minutes' <<<"$(tr '\n' ' ' <docs/plans/wallet-sync-progress-timeout-remediation.md | tr -s ' ')"   # D-17.A2e
if grep -qF 'it does not receive a larger stage budget' <<<"$(tr '\n' ' ' <docs/plans/wallet-sync-progress-timeout-remediation.md | tr -s ' ')"; then echo "D-17.A2e: old Tor budget clause still present" >&2; exit 1; fi
grep -qF "whatever the signer's display capability is" <<<"$(tr '\n' ' ' <docs/explanation/address-derivation.md | tr -s ' ')"   # D-17.A1e
grep -qF 'past the gap limit for every wallet with a canonical policy identity' <<<"$(tr '\n' ' ' <docs/explanation/address-derivation.md | tr -s ' ')"   # D-17.A1e scope (adversarial P3)
grep -qF 'skips this discovery until wallet remediation records one' <<<"$(tr '\n' ' ' <docs/explanation/address-derivation.md | tr -s ' ')"   # D-17.A1e legacy wallets
grep -qF 'The target user must be an owner or signer of the funding wallet (any role on the operational wallet).' <<<"$(tr '\n' ' ' <docs/how-to/agent-wallet-funding.md | tr -s ' ')"   # D-17.B1d
grep -qF 'about 12,000 history items' <<<"$(tr '\n' ' ' <docs/reference/changelog.md | tr -s ' ')"   # OQ-A1: capacity limit stated in the changelog
grep -qF 'run wallet remediation on such a wallet to enable discovery' <<<"$(tr '\n' ' ' <docs/reference/changelog.md | tr -s ' ')"   # A1: legacy-policy remedy stated in the changelog
grep -qF 'agent_user_wallet_role_insufficient' docs/reference/changelog.md                           # OQ-B1b: upgrade impact stated
# removed names and kept gates (A1, B1, C1)
if grep -n "assertWalletHardwareCapabilityById\|ForbiddenError" server/src/services/bitcoin/sync/addressDiscovery.ts; then echo "A1: display gate still in background discovery" >&2; exit 1; fi
test "$(grep -rn "'display'\|\"display\"" server/src --include=*.ts | grep -c assertWalletHardwareCapabilityById)" -eq 10   # every user-facing display gate kept
grep -qF '"display",' server/src/services/agentOperationalAddressService.ts
if grep -rn "walletRepository.hasAccess" server/src/agent server/src/services/adminAgentService.ts; then echo "B1: hasAccess still authorizes agents" >&2; exit 1; fi
grep -qF 'walletRepository.hasAccess(input.operationalWalletId, input.userId)' server/src/services/agentWalletAccess.ts   # /simplify: any role on the operational wallet
if grep -nF 'proxy_pass http://backend:' docker/tor/payjoin-ingress.conf; then echo "C1: literal backend proxy_pass remains" >&2; exit 1; fi
grep -qxF '        proxy_set_header Host payjoin-ingress;' docker/tor/payjoin-ingress.conf   # C3: fixed non-identifying Host
if grep -nE 'proxy_set_header Host ("";|\$host|\$http_host)' docker/tor/payjoin-ingress.conf; then echo "C3: empty or client-derived Host" >&2; exit 1; fi
grep -qF 'Payjoin over Tor works' docs/reference/changelog.md                                     # C3 changelog bullet
if grep -rn "transactions/batch" tests/e2e; then echo "B2: unexpected batch mock" >&2; exit 1; fi
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
node scripts/ci/check-wallet-safety-classifier.mjs
node scripts/ci/hardware-emulator-source-inventory.mjs validate   # A1's regenerated inventory is a listed input
npx vitest run --config config/tooling/vitest.config.ts tests/ci/signerInventoryGeneration.test.ts   # 27/27 (A1)
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/hooks tests/components/send tests/shared \
  tests/components/TransactionActions tests/api/transactions.test.ts tests/config
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold (D-17.X5)
# Playwright (CLAUDE.md static-build procedure; no host dev server). Known limitation: the static server cannot answer
# POST /auth/login, so the 7 known cases fail here; the exit status is recorded, not gated. Bounded and non-vacuous.
PW_DIR="$SCRATCH/i17-playwright"
grep -qF "/home/nekoguntai/sanctuary-bug-scrub-20261013-i17/config/tooling/playwright.config.ts" "$PW_DIR/playwright.static.config.mts"
rm -f "$PW_DIR/results.json" "$PW_DIR/failing.txt" "$PW_DIR/unexpected.txt"
npm run build
if curl -fsS -o /dev/null http://127.0.0.1:4173/ 2>/dev/null; then echo "port 4173 already serving; refusing to test another build" >&2; exit 1; fi
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SRV=$!
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:4173/
kill -0 "$SRV"   # our server (not another process) answered
PW_RC=0
npx playwright test --config "$PW_DIR/playwright.static.config.mts" --reporter=json >"$PW_DIR/results.json" || PW_RC=$?
echo "playwright exit $PW_RC (recorded)"
kill "$SRV" 2>/dev/null || true
SRV=""
test -s "$PW_DIR/results.json"
test "$(jq '.stats.expected + .stats.unexpected + .stats.flaky' "$PW_DIR/results.json")" -ge 380
jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | .file + " :: " + .title] | .[]' "$PW_DIR/results.json" | sort -u >"$PW_DIR/failing.txt"
comm -23 "$PW_DIR/failing.txt" "$PW_DIR/known-auth-login-failures.txt" >"$PW_DIR/unexpected.txt"
test "$(wc -l <"$PW_DIR/known-auth-login-failures.txt")" -eq 7
test ! -s "$PW_DIR/unexpected.txt" || { echo "Playwright failures beyond the 7 known auth/login cases:" >&2; cat "$PW_DIR/unexpected.txt" >&2; exit 1; }
# PNG baselines unchanged: nothing committed since BASE, and no new/modified/untracked file left by this run
git diff --exit-code "$BASE" HEAD -- tests/e2e/render-regression.spec.ts-snapshots
test -z "$(git status --porcelain -- tests/e2e/render-regression.spec.ts-snapshots)"
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i17-lizard.txt"   # cap 86 unchanged; pinned 1.24.0, no PyPI fetch
test "$(grep -c ': warning:' "$SCRATCH/i17-lizard.txt")" -le 83    # D-17.X4: base c81b2d372576 = 83, no new warnings; edit this literal only by the D-17.X4 procedure
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run check:bitcoin-network-boundaries
npm run arch:check                                 # pure check: graphs regenerated and committed before the block
node scripts/ownership/check-lifecycle-callsites.mjs   # complete, 416 identities (unchanged)
node scripts/ownership/check-contracts.mjs
npm run check:resource-ownership-contract
npm run verify:signer-inventory                   # A1 regenerated; B adds no signer identifier (D-17.X6 (4))
npm run check:safety-catch-guards                 # unchanged allowlist: no catch added
npm run check:wallet-sync-mutation-boundaries     # "verified 48 repository callsites" (A adds or moves none)
npm run check:wallet-sync-lifecycle-contract
npm run check:openapi-route-coverage              # B1/B2 edit OpenAPI descriptions and add two optional fields
npm run check:api-body-validation
node scripts/ci/check-supply-chain-locks.mjs      # always-on Determine Quality Scope step (C1 edits compose/Dockerfile inputs)
node scripts/ci/check-negated-test-assertions.mjs
# install, compose, ownership and CI suites (C)
sh -n docker/nginx/docker-entrypoint.sh
bash -n scripts/ci/classify-quality-scope.sh
npm run test:ownership   # every tests/ownership suite incl. compose-oci-labels, deployment-definition, owner-container-label
bash scripts/ci/run-install-unit-tests.sh          # all tests/install/unit suites (upgrade-helpers, offline-compose-images); installs tests/ci/lib
node --test tests/ci/check-supply-chain-locks.test.mjs
bash tests/ci/classify-quality-scope.test.sh       # C2 drift guard over the integrated tree (D-17.X6 (8))
bash tests/ci/check-workflow-composition.test.sh   # needs tests/ci/lib, installed above
bash tests/ci/ci-registration-completeness.test.sh
bash tests/ci/classify-test-changes.test.sh
node tests/ci/check-root-layout.test.mjs
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree
echo "verification block: all gates passed"
```

If the integration DB or the throwaway Redis cannot start, the block stops at the integration lines. That is a
D-17.X3 stop, not a fallback: record the failure, triage it as infrastructure first, then re-run the whole block as
written once both start. Completion requires the full block to exit 0 with the full integration suite (both
invocations) executed and every Redis-gated spec run. `/simplify` and an adversarial review before committing;
commits in the foreground through `flock /home/nekoguntai/.i17-commit.lock git commit …`; never while a coverage run
is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i17` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i17`),
  one commit per finding (test + fix; eight: A2, A1, B1, B2, B3, C1, C3, C2), then the integrator commit (changelog
  `[Unreleased]` bullets and any regenerated `docs/architecture/generated`).
- **Workers (D-17.X1):** phases `a`, `b`, `c` in parallel. Workers edit only owned files, run typechecks and targeted
  tests, run pinned lizard on changed files (zero new warnings), record red runs on the plan-commit base, apply the
  D-17.X3 stop rule, and commit through the flock.
- **Integrator (D-17.X2):** cherry-picks serially with `-x` (a, b, c), never resolves a conflict by editing another
  phase's files, records the B3 integration red on the guarded base swap, then runs the block. Each phase branch is
  proven upstream with `git cherry codex/bug-scrub-loop/20261013-i17 <phase-branch>` (every line `-`), deleted with
  `git branch -D`, and its worktree removed by path.
- **Merge:** squash through protected `main`; no admin bypass; merges are strictly serial — this PR is rebased only
  when it is the next to merge, and no other open PR is rebased because of it; poll required contexts via
  `/commits/<sha>/statuses` (the combined status can say success while a required context such as the verify-vectors
  summary is still pending).
- **Expected CI lanes** (a missing expected lane is investigated, not assumed skipped):
  - **Verify Bitcoin Vectors** — `server/src/services/bitcoin/**` (A), `server/src/api/transactions/**`,
    `src/hooks/send/**`, `src/components/send/**` (B2) and `server/src/repositories/**` (B3) are on
    `config/wallet-safety-critical-paths.json` (`:11`, `:28`, `:98`, `:73`, `:52`), and any non-documentation path
    runs it; its `verify:signer-inventory` step proves A1's regeneration. The **hardware-emulator proof jobs**
    (Trezor, Ledger, Jade) run because A1 changes `config/hardware-wallet-implementation-inventory.json`
    (`config/hardware-emulator-source-inventory.json:10`). Record the run and job IDs.
  - **Full Critical Mutation Gate** shards (`test.yml:1293-1300`) — B2's `drafting.ts` and
    `transactionsHttpRoutes.creation.contracts.ts` are on `is_critical_mutation_file` (D-17.X6 (2)).
  - Backend unit (coverage shards) + backend integration groups (Redis-required, as above); Full Backend Typecheck.
  - Frontend unit/coverage (including `tests/config/torIngress.test.ts`) + render/browser e2e; the root vitest input
    lane (`scripts/generate-signer-inventory.mjs` and the inventory JSON are `is_root_vitest_input_file`,
    `scripts/ci/classify-files-lib.sh:42`, `:90`).
  - **CI classifier tests** (`scripts/ci/*`, `tests/ci/*`, and the integrator's `docs/reference/changelog.md`;
    `classify-quality-scope.sh:105-131`): `classify-quality-scope.test.sh`, composition, supply-chain locks.
  - **Install and upgrade lanes**: `docker/**` (`install-test.yml:30`, `:92`; `classify-install-scope.sh:536`) and
    `scripts/ci/*` (`:483`) are release-surface paths; plus **Release Candidate Validation**, whose `pull_request`
    paths cover `scripts/ci/**` (`release-candidate.yml:37`) and `docker/compose/**` (`:44`). Record each job ID.
  - **Docker build** — the frontend image is selected by `docker/nginx/docker-entrypoint.sh`
    (`scripts/ci/classify-docker-build-images.sh:136`).
  - Lifecycle callsite registry; Determine Quality Scope (always-on `Check supply-chain locks`).
  - Architecture is not PR-required: watch its post-merge run on `main`. **`upgrade-extended-fixture-test`**
    (`optional-profiles`, the only lane that starts the Tor overlay) is non-PR: watch its post-merge run on `main` as
    C1's runtime evidence.
- **CI failure triage, infrastructure first.** Before treating any red lane as a product failure, enumerate the
  CLAUDE.md infrastructure causes against the job log, the diagnostic artifact
  (`scripts/ci/write-diagnostic-summary.sh`) and the `Name:` host's snapshots: Podman socket archive stalls
  (runner-infra #34; the job budget is the deadline), npm advisory-endpoint outages in the audit gate (probe before
  retriggering; cite #1012), DIND/Podman daemon contention, a stranded `e2e` runner lock, native-builder divergence on
  `kumo` (`DOCKER_BUILDKIT=0`), runner capacity (sora running several emulator jobs at once: Trezor bridge "session not
  found"), and registry egress. The install, RCV and emulator lanes this PR triggers are expensive and are not a
  signal about C or A1 when they fail for those reasons. The verify-vectors failure breadcrumb names no runner
  verdict since i16: find the failed step in the task output first.
- **Retriggers:** any second expensive attempt carries the CLAUDE.md four-part evidence (immutable 40-character SHA
  plus workflow run/job IDs, a redacted failure signature, a new hypothesis not tested by the failed attempt, and a
  cheap discriminator with its result); a `chore: retrigger CI` commit carries the fix or that evidence. Never push
  while an obsolete revision still owns runner resources.
- **After merge:** verify the reported `merge_commit_sha` (not the head SHA) exists locally and is an ancestor of
  `origin/main` (`git cat-file -e` + `git merge-base --is-ancestor`) before deleting the branch; never pass
  `delete_branch_after_merge`. Verify target-branch CI on the merge commit.
- **PR-body flags:**
  - A1: **user decision (2026-10-28)** — background sync expands the gap without the `display` capability; every
    user-facing display gate kept (surface audit); legacy wallets without canonical policy identity skip expansion;
    signer inventory regenerated (one boundary row removed).
  - A2: work-scaled history stages inside a window of at most 20 minutes and at most two thirds of the time left in
    the attempt; budget-expiry continuation reaches the receive gate
    (resolves P3 `fetch-histories--budget-expiry-continuation-throws-in-history-authentication`); recursion deferred
    when less than a window remains; **capacity limit** about 12,000 history items at 1 s Tor RTT (P3
    `wallet-sync--history-work-beyond-attempt-window-never-completes`); recursive-pass failure policy unchanged (P3
    `wallet-sync--recursive-gap-pass-failure-reported-as-success`). A2 and A1 ship together.
  - B1: funding wallet needs owner/signer at link time and on every agent call; **existing viewer/approver-linked
    agents get 403 after upgrade (OQ-B1b, intended; no operator host checked)**; admin form options unchanged (P3
    `agent-form--funding-wallet-options-ignore-role`).
  - B2: batch response gains optional `effectiveAmount`/`recipient` (zod, OpenAPI and the client response type);
    resolves backlog P3
    `broadcast--mixed-send-own-first-recipient-mismatch`; no e2e mock change; critical mutation lane runs.
  - B3: readiness collector bounded at 2 s per statement; may show `unavailable` on very large installs (OQ-B3);
    worker gate unchanged.
  - C1: ingress re-resolves the backend (#967 pattern); Tor reloaded by SIGHUP on an ingress IP change (OQ-C1; runtime
    proof only in non-PR lanes, P3 `install-upgrade--tor-overlay-recreate-not-exercised`).
  - C3 (found by review pass 1): the Tor ingress sent no `Host`, so Node answered every onion Payjoin POST 400 since
    v0.8.63; it now sends a fixed `Host: payjoin-ingress` (never the onion name); backend Host use on the route
    audited.
  - C1 also: the legacy Tor isolation branch of the upgrade harness is incompatible with the new overlay, unreachable
    by any current fixture (P3 `install-upgrade--legacy-tor-fixture-incompatible-with-ingress-template`).
  - C2: classifier routing derived from `quality.yml` (rules (a)–(h), including files sourced by a sourced or run
    shell script); 55 subjects plus the root-layout schema routed; read-only
    inputs out of scope (P3 `ci-classifier--contract-suite-data-inputs-outside-trigger`).
  - "No migration, no new endpoint, no e2e mock-map change, no workflow edit, no version bump"; the P3 backlog and
    follow-ups stay outside this PR.
- **Rollback:** every phase is code/config/CI/test/docs-only. No schema, migration or stored-shape change. Reverting
  A1 stops gap expansion again (rows already expanded stay, display-gated); A2 restores the fixed 5-minute history
  budget (revert A1 first); B1 restores "any role" agent authorization; B2 drops the two optional response fields and
  the client goes back to summing outputs; B3 restores the unbounded collector read; C1 restores the one-shot IP
  resolution; C3 restores the empty Host (onion Payjoin requests get 400 again); C2 restores the hand-kept
  classifier lists.
- **Deployment:** none until clean closeout (`--deploy final`); the local stack is rebuilt only after the loop closes
  (from `/home/nekoguntai/sanctuary-main`). C1 and C3 take effect on the next `compose up` of the Tor overlay.

## Completion criteria

- [ ] Every failing-first test in Phases A–C fails on `c81b2d372576` code for the reason its phase states, or for an
  accepted red listed under D-17.X3 (red runs recorded per phase; the B3 integration red recorded by the integrator's
  guarded base swap, `$SCRATCH/i17-b3-integration-red.txt`, with the restore verified by `git diff --exit-code`), and
  passes on the PR head; honest-path guards stay green; no unresolved D-17.X3 stop.
- [ ] Verification block run as written on the integrated branch with exit status 0 recorded, including the lizard
  gate (≤ 83), the empty tier-1 diff and the exact tier-2 set, the empty verify-vectors provenance diff, the exact-file
  scope diff (59 files) and the line-local and docs checks, backend coverage scoped to `tests/unit` and frontend
  coverage at 100%, and the **full** backend integration suite (both invocations) executed with `REDIS_URL` set and
  `SANCTUARY_REQUIRE_REDIS_INTEGRATION=true`, every Redis-gated spec with passed tests and B3's new case passed.
- [ ] Playwright static run recorded (exit status, ≥ 380 executed, only the 7 known auth/login failures, PNG
  baselines unchanged, no untracked snapshot); CI's browser lane is binding.
- [ ] PR head CI evidence recorded: green verify-vectors (with hardware-emulator jobs), Full Critical Mutation Gate,
  install/upgrade lanes, RCV, docker-build and ci-classifier-tests (C2's drift guard) (run and job IDs).
- [ ] PR merged; required contexts green via `/statuses`; target-branch CI green on its merge commit (including the
  post-merge Architecture lane and the post-merge `upgrade-extended-fixture-test` `optional-profiles` run as C1's
  runtime evidence); ancestry of `merge_commit_sha` verified; branches and worktrees cleaned (`git cherry` proof per
  phase branch).
- [ ] PR body carries every flag listed under Delivery, including the A1 user decision, the A2 capacity limit and the
  OQ-B1b upgrade impact.
- [ ] Run state updated: eight findings resolved (C3 `tor-payjoin-ingress--empty-host-header-rejected-400` recorded
  as a P2 found by review pass 1); P3 `fetch-histories--budget-expiry-continuation-throws-in-history-authentication`
  resolved by A2; backlog P3 `broadcast--mixed-send-own-first-recipient-mismatch` resolved by B2; the decided open
  questions and the six P3 follow-ups (`wallet-sync--history-work-beyond-attempt-window-never-completes`,
  `wallet-sync--recursive-gap-pass-failure-reported-as-success`, `agent-form--funding-wallet-options-ignore-role`,
  `install-upgrade--tor-overlay-recreate-not-exercised`, `ci-classifier--contract-suite-data-inputs-outside-trigger`,
  `install-upgrade--legacy-tor-fixture-incompatible-with-ingress-template`) recorded as backlog; the coordinator's disposition of the proposed `tor-ingress--healthcheck-does-not-exercise-backend-route`
  recorded.
- [ ] P3 backlog (the 22 deferred P3s: 16 from this scrub plus the 6 above, listed under Open questions) remains
  outside the blocking fix set.

## Review log

- Draft assembled 2026-10-28 from plan17-A/B/C (source `c81b2d372576`), with the user decision on A1 and the
  coordinator decisions OQ-A1, OQ-A2, OQ-B1a, OQ-B1b, OQ-B2, OQ-B3, OQ-C1, OQ-C2 applied. Lizard base re-measured at
  assembly on `c81b2d372576`: 83 (gate ≤ 83). All seven prototype patches `git apply --check` clean on
  `c81b2d372576`, singly and together. Assembly amendments: run-state P3 ids for OQ-A1/OQ-A2; A2 changelog states the
  capacity limit; B1 changelog states the upgrade impact; fixed doc sentences for D-17.A1e and D-17.A2e; `BASE` defined
  in every worker block; tier-1/tier-2 surfaces re-derived (B2's `drafting.ts` and contracts file are on the critical
  mutation list; B2 touches four unscheduled tier-2 files).
- Pass 1 (2026-10-28): three reviewers. Applied: A-1 window bound to remaining attempt time, A-2 cancellation-branch coverage, A-3 legacy-policy changelog + surface rows, B-1 lizard split, B-2 B3 assertion order, B-3 client type + hook test, C-1 new P2 tor-payjoin-ingress--empty-host-header-rejected-400 (C3), C-2 8 more executed files routed, C-3 legacy fixture compatibility note + P3. Rejected: none.
- Pass 2 (2026-10-28): two reviewers (changed areas with all prototypes applied; full plan). Applied: C2 rule (g) for process.execPath spawn subjects + 21 more routed files (51 total), A1 remediation changelog check, ci-classifier-tests evidence in Completion, C2 confirm-red commit reference. Rejected: none.
- Pass 3 (2026-10-28): full-plan pass, 1 comment (C2 did not follow shell `source` from subjects; 2 executed files unrouted) — applied: rule (h) + 4 routed files (55 total; rule (h) also reaches assertion-tracking.sh via helpers.sh). Rejected: none. Re-observed while applying: rule (h) also reaches `tests/install/utils/assertion-tracking.sh` transitively (sourced by `helpers.sh:14` through an inline `dirname`), so 4 files are routed (55 total, floor 35 → 39, 291/292 derived subjects); red rc 1 with exactly the 55, green rc 0 (5.42 s), full-repo pinned lizard 83 with the base function set.
- Pass 4 (2026-10-28): full-plan pass, 1 comment (P4-1: rule (h) never ran on the shell suites themselves, so a suite's own `source` via `$SCRIPT_DIR` or a literal path escaped derivation) — applied by the coordinator: `deriveSubjects` starts each suite's reached set from the suite itself (one line; derived set unchanged at 292, guard green; pass-4 probe now fails the guard as intended). Final sweep: 3,583 unrouted tracked executable files broken at once, whole ci-classifier-tests job identical to the clean baseline. Rejected: none.
- Pass 5 (2026-10-28): full-plan pass, **clean — review converged.**
