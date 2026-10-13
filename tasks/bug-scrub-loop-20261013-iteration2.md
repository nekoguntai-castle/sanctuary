# Bug-scrub loop 2026-10-13 — iteration 2 remediation plan

- Run: `bug-scrub-loop-20261013-sanctuary`, iteration 2
- Source SHA: `3a44e1e8c7c8fd9b848777e2e3138ba0ed65a18e` (origin/main after PR #1387)
- Scope: whole repository (locked at run start)
- Branch / worktree: `codex/bug-scrub-loop/20261013-i2` in `/tmp/sanctuary-bug-scrub-20261013-i2-scrub`
- Delivery: one PR for all phases below, one commit per phase, each with its own
  non-regression test written first. Deploy policy `final`: no container rebuild
  in this plan; the loop rebuilds once after a clean scrub.

## Goal

Fix the nine P0–P2 findings accepted by the iteration-2 rescrub, each with a
regression test that fails on `3a44e1e8` and passes after the fix.

| Phase | Finding | Severity |
|---|---|---|
| 1 | `payjoin-receiver--route-shadowed-by-authenticated-routers` | P1 |
| 2 | `send-draft-save--new-draft-id-resets-signed-state` | P1 |
| 3 | `subtract-fees--pinned-utxos-partially-spent` | P2 |
| 4 | `agent-funding-caps--broadcast-drafts-uncounted` | P2 |
| 5 | `wallet-sync--full-resync-renotifies-history` | P2 |
| 6 | `console-prompt-replay--deleted-session-404` | P2 |
| 7 | `ai-routes--feature-flag-and-admin-gate-missing` | P2 |
| 8 | `transaction-filter--date-input-utc-local-mismatch` | P2 |
| 9 | `ci-classifier--shared-only-pr-skips-backend-lanes` | P2 |

## Non-goals

- All P3 findings (iteration-1 and iteration-2 backlog in run state) stay
  outside this plan. In particular: `ai/status` exposing endpoint/model,
  `admin-settings--unvalidated-values-break-drafts`, prototype-key lookups,
  gateway body-parser status codes, and QR signed-device proof.
- No Prisma schema changes or migrations (RC10 migration digest is pinned).
- No product-policy changes beyond restoring the documented behaviour named in
  each phase. BitBox02 change-output blocking (#815) is intentional and untouched.
- No refactors outside the touched functions.

## Assumptions

- Express 5 `router.use(fn)` without a path runs for every request that enters
  that router, so mount order in `server/src/routes.ts` decides whether a
  later, more specific mount is reachable.
- `resetWalletForFullResync` sets `lastSyncedAt: null`
  (`server/src/repositories/resyncRepository.ts:327-331`), and a newly imported
  wallet starts with `lastSyncedAt: null`; `pipeline.ts:79` loads the full
  wallet row into `SyncContext.wallet`.
- `requireFeature(flag)` (`server/src/middleware/featureGate.ts`) returns 403
  when the flag is off, as already used by `api/payjoin.ts` and `api/intelligence.ts`.

## Phase 1 — Payjoin receiver and API docs reachable without auth (P1)

Evidence: `routes.ts:79-82` mounts `approvalRoutes`, `transactionRoutes`,
`labelRoutes`, `draftRoutes` at `/api/v1`; each calls `router.use(authenticate)`
(`approvals.ts:16`, `transactions.ts:40`, `labels.ts:52`, `drafts.ts:26`).
`payjoinRoutes` (`:83`) and `openApiRoutes` (`:84`) are mounted after them, so the
unauthenticated BIP78 handler (`api/payjoin.ts:385`) and the public docs
(`api/openapi/index.ts:39,49`) are answered with the `authenticate` 401.

Change: move the `/api/v1/payjoin` and `/api/v1/docs` entries above the
"must come LAST" block in `server/src/routes.ts`, and extend that comment to say
specific prefixes must precede the root `/api/v1` mounts.

Test first, in a new file `server/tests/unit/routes.mountOrder.test.ts`
(the existing `routes.test.ts` asserts hoisted `vi.fn` router identities and a
fake `{get, use}` app, so it cannot host this): with its own `vi.mock` set
(mirroring `routes.test.ts`, including `../../src/config`,
`middleware/metrics`, `services/workerHealth`), make the approval, transaction,
label and draft router mocks real `express.Router()`s that `use()` a 401
responder (mirroring `router.use(authenticate)`), and the payjoin and openapi
mocks real routers answering 200. Call the real `registerRoutes` on a real
`express()` app and drive it with supertest. Assert unauthenticated
`POST /api/v1/payjoin/addr?v=1` and `GET /api/v1/docs/openapi.json` return 200,
and a root-mounted path (e.g. `GET /api/v1/labels/x`) still returns 401. The
only side effect of the move is that an unknown `/api/v1/payjoin/...` path now
404s instead of 401; payjoin's own authenticated routes keep their per-route
`authenticate`. `routes.test.ts`'s `app.use` count is unchanged.

Acceptance: the new test fails on `3a44e1e8` and passes; existing payjoin and
routes tests pass.

## Phase 2 — Saving a new draft keeps the signed state (P1)

Evidence: `src/hooks/send/useDraftManagement.ts:196-215` calls
`setDraftId(result.id)` and then awaits `saveSignedStateForNewDraft(..., lease.signal)`.
`getSendIdentity` (`src/hooks/send/useSendTransactionActions.ts:203-215`)
includes `state.draftId`; the identity `useLayoutEffect` (`:372-376`) calls
`reset()`, whose `owner.invalidate()` aborts the signing slot that
`beginDraftSave` (= `beginSigning`, `useSendOperationOwner.ts:74`) holds, and
clears `txData`, `unsignedPsbt`, `signedDevices`, `signedRawTx`.

Change: adopting a server id for the current unsaved transaction
(`draftId` going from `null` to a value with every other identity field unchanged)
must not count as an identity change. Split identity into the transaction
fields (`getSendIdentity` without `draftId`) and `draftId`, tracked in one ref
`{ tx, draftId }`. In the layout effect:
`reset = txChanged || (prev.draftId !== null && draftId !== prev.draftId)`,
and advance the ref on every run, including the skipped one. `SET_DRAFT_ID` is
only dispatched by `createNewDraft` (via `SendTransactionWizard.tsx:54`);
`LOAD_DRAFT` runs at mount and nothing calls `loadDraft()` in-session; `RESET`
returns the id to null (still resets). Add a short comment saying so.

Test first: new `tests/hooks/useSendTransactionActions/useSendTransactionActions.draftAdoption.contracts.tsx`,
registered from `tests/hooks/useSendTransactionActions.test.tsx` and reusing
that harness's hoisted `createDraft`/`updateDraft` mocks. Use a `renderHook`
wrapper that holds `useReducer(transactionReducer, undefined, () => createInitialState(...))`
(both exported from `src/contexts/send/reducer.ts`) and passes
`setDraftId: id => dispatch({ type: 'SET_DRAFT_ID', id })`. Flow:
`createTransaction` → mark one device signed → `saveDraft` with `updateDraft`
pending until its `signal` aborts. Assert the signal is not aborted,
`txData`/`signedDevices` are retained, and `saveDraft` resolves to the id
(and navigates). Further cases, so the new branch is fully covered: an output
change after adoption resets; an output change in the same render as adoption
resets; a draft that already had an id resets when the id changes or returns
to null (RESET).

Acceptance: test fails on `3a44e1e8`; frontend coverage stays 100%.

## Phase 3 — Subtract-fees spends the whole pinned UTXO set (P2)

Evidence: `server/src/services/bitcoin/transactions/utxoModes.ts:142-164`
filters to the pinned set, then the incremental loop breaks once
`totalAmount >= amount`, dropping remaining pinned UTXOs. Normal mode
(`selectUTXOsExact`) and `createBatchTransaction.selectPinnedBatchCoverage`
spend a pinned set in full.

Change: when `selectedUtxoIds` is non-empty, select the entire pinned set (no
early break); keep the incremental selection for the unpinned case. Fee, change
and dust arithmetic is unchanged and runs on the full set.

Test first, in `server/tests/unit/services/bitcoin/transactionSelection.boundaries.test.ts`
next to the existing "explicit subtract-fee coin control" case (uses
`selectUtxosForMode`, `mockAvailable`, `utxo(...)`): mock the pinned rows in
repository order (amount desc) as `[B=50,000 sats, A=10,000 sats]`, pin both
outpoints, `subtractFees=true`, `amount=20,000`. On `3a44e1e8` the loop breaks
after B and drops A; after the fix both inputs are selected and change includes
A's value. The unpinned case keeps the minimal prefix. No config inventory
references `utxoModes.ts`.

Acceptance: test fails on `3a44e1e8`; backend unit coverage 100%.

## Phase 4 — Agent funding caps count broadcast drafts (P2)

Evidence: `server/src/repositories/agentRepository.ts:433-444`
(`sumAgentDraftAmountsSince`) sums only `ACTIONABLE_DRAFT_STATUS_VALUES`; a
broadcast draft is archived as `broadcasted` (`persistTransaction.ts:75-83`,
`agentId` retained), so `agentFundingPolicy.ts:98-120` daily/weekly caps forget
it. The docs only say "Optional daily and weekly caps"
(`docs/how-to/agent-wallet-funding.md:34`); a cap that resets on broadcast does
not bound funding per day/week.

Change: sum `DRAFT_LIFECYCLE_STATUS_VALUES` (actionable + `broadcasted`, from
`@sanctuary/shared/constants/drafts`, where `agentRepository.ts:16` already
imports from). Deleted/expired drafts remain excluded (human cancellation).
Windows stay keyed on draft `createdAt`, as today.

Tests first: in `server/tests/unit/repositories/agentRepository.test.ts`, update
both the `where.status.in` expectation (~:255) and the `.not.toContain`
assertion (:262-264) to require `broadcasted`. Add
`server/tests/integration/repositories/agentRepository.sumDraftAmounts.test.ts`
(an agent with one `unsigned` and one `broadcasted` draft today plus a
`broadcasted` one before the window; assert the sum covers the first two), and
register it in the repositories-core list of
`scripts/ci/backend-integration-groups.sh` (beside `draftRepository.test.ts`).

Acceptance: tests fail on `3a44e1e8`; agent funding policy tests pass.

## Phase 5 — Baseline sync does not notify historical transactions (P2)

Evidence: full resync deletes all transaction rows
(`resyncRepository.ts:322`); re-sync reports them as `created`, and
`processTransactionsPhase.ts:412-414` hands all to `sendNotifications`
(push/Telegram via `dispatchTransactionNotifications`, WebSocket inline). The
only dedupe is the BullMQ job id with last-500 retention.

Change: in `persistTransactionBatch` (`processTransactionsPhase.ts`), when
`ctx.wallet.lastSyncedAt === null` (baseline sync: first sync after import or
after a full-resync reset; `pipeline.ts:79` loads the full row, and
`lastSyncedAt` is only written at sync completion), pass only unconfirmed
created transactions (`(tx.confirmations ?? 0) === 0`) to `sendNotifications`;
confirmed ones are history. This filters push/Telegram and the WebSocket
broadcast together (both live in `sendNotifications`). Incremental syncs are
unchanged. Use strict `=== null`: the test context factory
(`sync/context.ts:163`) leaves `lastSyncedAt` undefined, so existing tests stay
on the incremental path. Extract the filter as a small pure helper in
`processTransactions/notifications.ts`, with no try/catch
(`scripts/quality/safety-catch-allowlist.json` counts catches in that file). No
new repository calls, so `config/wallet-sync-mutation-boundaries.json` is
unaffected; the replay driver hash does not cover src files.

Known trade-off: while a wallet's first syncs keep failing it stays at
`lastSyncedAt === null`, so a genuinely new confirmed transaction found in that
window is not notified (unconfirmed ones still are).

Test first, under `server/tests/unit/services/bitcoin/sync/phases/processTransactions/`:
helper tests in `notifications.test.ts`, and a phase-level test with
`wallet.lastSyncedAt: null` set explicitly and two created txs (one confirmed,
one unconfirmed) → `sendNotifications` receives only the unconfirmed one;
`lastSyncedAt` set → both.

Acceptance: test fails on `3a44e1e8`; sync unit tests and wallet-sync boundary
inventory check pass.

## Phase 6 — Console prompt replay survives a deleted session (P2)

Evidence: `server/src/assistant/console/service.ts:555-562` marks the prompt
replayed, then uses `input.sessionId ?? prompt.sessionId`; `resolveSession`
(`:225-231`) throws `NotFoundError` for a soft-deleted session
(`consoleRepository.ts:98-105`, `softDeleteSession` keeps `prompt.sessionId`).

Change, all inside `replayPromptHistory` before `markPromptReplayed`:
- explicit `input.sessionId`: look it up with
  `consoleRepository.findSessionForUser`; if missing throw
  `NotFoundError("Console session not found")` (same as today, but before the
  mark);
- no `input.sessionId`: use `prompt.sessionId` only if `findSessionForUser`
  still returns it, otherwise pass `sessionId: undefined` so `resolveSession`
  creates a new session.
Then mark and run the turn as today. Accepted race: a session deleted between
this lookup and `resolveSession` still 404s (same as today's behaviour).

Test first in `server/tests/unit/assistant/consoleService.promptReplay.contracts.ts`
(mocks in `consoleService.testUtils.ts`): prompt with a soft-deleted origin
session (`findSessionForUser.mockResolvedValueOnce(null)`) and no input session
→ `createSession` called, `updateSessionScope` not called, turn runs; explicit
missing session → `NotFoundError` and `markPromptReplayed` not called.

Acceptance: tests fail on `3a44e1e8`; console tests pass.

## Phase 7 — AI routes honour the aiAssistant flag and admin gate (P2)

Evidence: `server/src/api/ai/features.ts:73-146` (`/suggest-label`, `/query`)
check only `aiService.isEnabled()` (settings), while `status.ts:63,97` and
`intelligence.ts:68` treat `aiAssistant` as the feature switch.
`models.ts:58-66` `/detect-ollama` lacks `requireAdmin`, unlike
`/detect-provider` (`:78`) and `/models` (`:107`).

Change: add `requireFeature('aiAssistant')` (`src/middleware/featureGate.ts`)
directly after `authenticate` on `/suggest-label` and `/query` (unauthenticated
callers still get 401); add `requireAdmin` after `rateLimitByUser` on
`/detect-ollama`, matching `/detect-provider`. Add `403: apiErrorResponse` to
those three entries in `server/src/api/openapi/paths/ai.ts`. Frontend: the
label-suggestion and query UIs only render when `/ai/status` reports enabled
(which already folds in `aiAssistant`), and `detectOllama` is only called from
the admin AI settings page, so no legitimate UI call gets a new 403 and no e2e
mock changes.

Test first, in `server/tests/unit/api/ai/`: flag off
(`featureFlagService.isEnabled.mockResolvedValue(false)`) + AI settings on →
403 for both routes (`ai.suggest-query.contracts.ts`); non-admin
`/detect-ollama` → 403 and admin (`x-test-admin: true`) → 200
(`ai.models.contracts.ts`; add `x-test-admin` to its three existing
detect-ollama cases). Run the openapi contract tests.

Acceptance: tests fail on `3a44e1e8`; AI route tests pass.

## Phase 8 — Transaction filter date inputs use local dates (P2)

Evidence: `src/components/WalletDetail/tabs/TransactionFilterBar.tsx:33-46`
formats with `toISOString()` (UTC) but parses `value + 'T00:00:00'` /
`'T23:59:59.999'` as local time.

Change: format with local `getFullYear()/getMonth()+1/getDate()` (zero-padded).
The presets in `useTransactionFilters.ts:68-82` already produce local midnight,
so they display correctly too.

Test first (`tests/components/WalletDetail/tabs/TransactionFilterBar.test.tsx`):
`it.each` over `Pacific/Honolulu` and `Europe/Berlin`, setting
`process.env.TZ` inside the test and restoring it in `afterEach` (delete when it
was unset); verified to take effect in this vitest/Node 24 setup. Guard with
`expect(new Date(2026, 9, 5).getTimezoneOffset()).toBe(<expected>)` so a runtime
that ignores TZ fails loudly. Build `dateFrom`/`dateTo` from
`new Date(2026, 9, 5).getTime()` and `new Date(2026, 9, 5, 23, 59, 59, 999).getTime()`
after setting TZ and assert both inputs show `2026-10-05`. Add a round-trip case
through the rendered input's change event and the `onCustomDateRangeChange`
spy, and a null case (empty value).

Acceptance: test fails on `3a44e1e8` for a non-UTC TZ; frontend coverage 100%.

## Phase 9 — shared/ changes run backend, gateway, render and build lanes (P2)

Evidence: `scripts/ci/classify-files-lib.sh` lists `shared/*` only in
`is_frontend_file`; `is_backend_file`, `is_backend_integration_file`,
`is_gateway_file`, `is_render_file`, `is_build_file` and
`is_full_scan_trigger_file` do not. Server and gateway build against
`shared/dist` (`scripts/ci/setup-server-dependencies.sh:36`,
`.github/workflows/test.yml:1166-1172`).

Constraint: `shared/*` must not be appended to `backend_files`. The quick
backend lane (`test.yml:236-286`) passes `backend_files` through
`related-test-args.sh server` and runs `vitest related` from `server/`; a
`shared/...` path resolves to `server/shared/...`, and the server resolves
`@sanctuary/shared` to `shared/dist` anyway (`server/vitest.config.ts:81-84`),
so `--passWithNoTests` would turn the required lane into a silent no-op.

Change:
- `scripts/ci/classify-files-lib.sh`: add `is_shared_workspace_file`
  (`shared/*`). Do not add `shared/*` to `is_backend_file` or `is_gateway_file`
  (both append to related-file lists: `backend_files` in the classifier,
  `gateway_unit_files` in `plan-test-run.sh:214-216`, which `run-lane.sh` feeds
  to `vitest related` from `gateway/` — the same silent no-op), nor to the LLM
  egress predicate (that package must not import shared, enforced by
  `check-llm-egress-proxy-shared-isolation.sh`).
- `scripts/ci/classify-test-changes.sh`: an explicit
  `if is_shared_workspace_file` block sets `backend_changed`,
  `backend_integration_changed`, `gateway_changed`, `render_changed`,
  `build_changed` and a new `shared_changed` output to true, appending to no
  `*_files` list. Add `shared_changed=false` to the base outputs and to
  `emit_outputs`.
- `scripts/ci/plan-test-run.sh`: the same block sets `backend_unit_run`,
  `gateway_unit_run`, `backend_integration_run`, `render_regression_run`,
  `build_run` to true and records `shared_touched`; after the loop, when
  `shared_touched` is set, empty `backend_unit_files` and `gateway_unit_files`
  so `run-lane.sh` runs those lanes in full instead of `vitest related` on only
  the `server/`/`gateway/` paths of a mixed diff.
- `.github/workflows/test.yml`: expose `shared_changed` in the detect-changes
  `outputs:` block (`:50-57`), and change the quick backend job condition
  (`:196-201`) to also require
  `(needs.detect-changes.outputs.backend_files != '' || needs.detect-changes.outputs.shared_changed != 'true')`.
  A shared-only diff then skips the quick lane (the quick summary already
  accepts skipped, `test.yml:472`), while the full backend typecheck, coverage
  shards and integration lanes still run on `backend_changed`. The step's
  existing "backend_changed but no backend files" error stays for every other
  empty list; update that step's comment (`:261-263`) to say shared-only
  diffs skip the job. `browser_smoke` stays unchanged (render + build cover shared UI
  contracts).
- `classify-quality-scope.sh` needs no change (its source predicate already
  matches `shared/**/*.ts`). No workflow-contract test enumerates the
  detect-changes outputs. Editing `test.yml` makes this PR a full scan
  (expected).

Test first: add a `shared/schemas/wallet.ts`-only case to
`tests/ci/classify-test-changes.test.sh` (case shape: write, `git add`,
commit, advance `base`/`head`, `run_classifier ... pull_request`,
`assert_exact_output`) asserting `backend_changed`,
`backend_integration_changed`, `gateway_changed`, `render_changed`,
`build_changed`, `frontend_changed`, `shared_changed` = true,
`llm_egress_proxy_changed` and `full_scan` = false, and `backend_files` and
`gateway_files` empty; add a mixed `server/` + `gateway/` + `shared/` case
asserting `backend_files`/`gateway_files` hold only their workspace paths.
Mirror in `tests/ci/plan-test-run.test.sh` asserting
`lanes.backend_unit.run`, `lanes.backend_integration.run`,
`lanes.gateway_unit.run`, `lanes.render_regression.run`, `lanes.build.run`,
`lanes.frontend_unit.run` true, `lanes.llm_egress_proxy_unit.run` false, and
`lanes.backend_unit.files` / `lanes.gateway_unit.files` empty, plus a mixed
`server/` + `shared/` case asserting `lanes.backend_unit.files` is still empty
(full lane). Both suites run in quality.yml's "CI classifier tests" job.

Acceptance: new cases fail on `3a44e1e8` and pass; CI classifier test suite
passes (`bash tests/ci/classify-test-changes.test.sh`, `bash tests/ci/plan-test-run.test.sh`).

## Verification

Guarded entry points only (Docker-only rule; no dev servers). With
`PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH`, one coverage run at a time:

- Focused: each phase's new tests.
- `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`
- `cd server && npm run typecheck:tests`
- `cd server && npx vitest run --coverage tests/unit` (100%)
- `npm run test:coverage` (frontend, 100%)
- `cd server && npm run test:integration:db -- <touched integration files>`
- `bash tests/ci/classify-test-changes.test.sh && bash tests/ci/plan-test-run.test.sh`
- `bash tests/ci/check-workflow-composition.test.sh`,
  `bash tests/ci/portability.test.sh`,
  `node --test tests/ci/check-github-action-runtimes.test.mjs`
- `bash tests/ci/related-test-args.test.sh`,
  `bash scripts/ci/check-llm-egress-proxy-shared-isolation.sh`
- `cd server && npx vitest run tests/unit/api/openapi*` (Phase 7 spec change)
- `git add` new files before the large-file and lifecycle checks (they skip
  untracked files); run `/simplify` and the edge-case audit before committing.
- `bash scripts/quality/lizard-only.sh`, `bash scripts/quality/jscpd-only.sh`,
  `node scripts/quality/check-large-files.mjs`
- `npm run arch:check` in the primary checkout against the branch tree if any
  import edge changes (worktree symlink artifact otherwise).

## Delivery, rollback, deployment

- One PR from `codex/bug-scrub-loop/20261013-i2` to `main`, nine phase commits
  plus this plan; merge only with all required checks green, no admin bypass,
  `delete_branch_after_merge: false`; verify `merge_commit_sha` ancestry before
  deleting the branch.
- Each phase is independently revertible; no data or schema migration.
- Compatibility: Phase 1 makes BIP78 and docs reachable as originally designed;
  Phase 7 returns 403 where the flag is off (documented behaviour); Phase 4
  can reject agent drafts that previously slipped past the caps (intended).
- No container rebuild in this plan (`--deploy final`).

## Completion criteria

- [ ] Phases 1–9 merged with regression tests that fail on `3a44e1e8`.
- [ ] All verification commands above pass locally; PR required checks green.
- [ ] Target-branch push CI green on the merge commit.
- [ ] Owned branch and worktree cleaned; run state updated.
- [ ] P3 backlog remains outside the blocking fix set.
