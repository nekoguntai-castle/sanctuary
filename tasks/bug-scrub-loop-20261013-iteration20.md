# Bug-scrub loop 20261013 — iteration 20 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 20
- **Source SHA:** `5e37cf45ad914df55a79944919dcd765b9c5e79e` (`main`, after #1422)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (5 × P2 after review), fixed in 5 phases:**
  - C1 `ci-classifier--render-lane-omits-api-services-public-runtime`. The backlog P3
    `ci-classifier--render-lane-omits-src-types-runtime` is folded in.
  - A2 `approval-specific--stale-votes-count-after-access-loss`
  - A1 `wallet-sync--spend-with-unfetched-parent-notified-as-received`
  - B1 `network-sync-actions--compact-mode-drops-result`
  - B2 `console-nav--amount-filter-and-limit-dropped-on-auto-navigation`

  Every finding was re-verified from source at `5e37cf45ad91` (file:line in each phase), and every fix was prototyped
  test-first on a scratch copy of that tree.
- **Rejected during review:** `ci-classifier--vite-config-and-polyfills-skip-browser-and-render-lanes` is a false
  positive (recorded in run state). `config/tooling/*` is an `is_full_scan_trigger_file`
  (`scripts/ci/classify-files-lib.sh:553`), and `test.yml` runs and requires both e2e lanes on `full_scan` (`:1362`,
  `:1595`), so a Vite config or polyfills change already runs Full Browser E2E and Full Render E2E.
- **Deferred P3s:** every other iteration-20 finding is backlog in run state and is **outside this fix set**.
- **Scratchpad (`$SCRATCH`):** `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`.
  - Prototype diffs: `plan20-{A1,A2,B1,B2,C1}-prototype.patch`. Red-run outputs: `p20-{a1,a2,b1,b2,c1}-red.txt`.
  - All five patches apply together on `5e37cf45ad91` (`git apply --check`; 32 files, +1104/−69). The C1 patch still
    carries the Vite work rejected in review pass 2; the implementer leaves it out.
  - A prototype is guidance; where the two differ, the phase text below governs.

| Phase | Finding id | Sev |
|---|---|---|
| C1 | `ci-classifier--render-lane-omits-api-services-public-runtime` (+ folded P3 `...-src-types-runtime`) | P2 |
| A2 | `approval-specific--stale-votes-count-after-access-loss` | P2 |
| A1 | `wallet-sync--spend-with-unfetched-parent-notified-as-received` | P2 |
| B1 | `network-sync-actions--compact-mode-drops-result` | P2 |
| B2 | `console-nav--amount-filter-and-limit-dropped-on-auto-navigation` | P2 |

## Open questions

These are decided; none blocks the plan.

- **OQ-C1 (coordinator, following the user's iteration-19 decision).** The render lane gets the same frontend runtime
  tree as the browser lane. (The Vite config and polyfills are full-scan triggers and already run both lanes.)
  - The user decided on 2026-10-30 ("Whole frontend tree") that every frontend runtime change runs Full Browser E2E.
    The render specs run the same built app against a mocked API, so the same reasoning applies.
  - **CI cost:** Full Render E2E (three Playwright workers, no backend) now also runs on PRs touching src/api,
    src/services, src/public, src/types (about 107 files); shared/ already ran render via the shared-workspace rule
    (`classify-test-changes.sh:229-236`, `render_changed=true` at `:234`). Both lanes take the e2e runner lock, so
    frontend-only PRs queue longer. The PR body states this.
- **OQ-A1 (coordinator).** Hold the notification, not the row.
  - Options weighed in the prototype:
    - (a) Do not save the candidate. Rejected: a candidate that is never saved has no place in the fair repair
      rotation (`classificationLastAttemptAt`), so a parent fetch that fails the same way every time (complexity cap,
      frame too large, a budget that always runs out at the same point) would lose a genuine receive for good.
    - (c) Recognise own inputs from the UTXO table. Rejected: partial (a coin received and spent between syncs is not
      in the table) and it would treat database rows as authenticated chain evidence.
    - (b) Save the row as today, but do not announce a `received` row created with incomplete evidence when any
      non-coinbase input has unknown ownership. Announce it when a later sync repairs it with complete evidence.
      **Chosen.**
  - Only rows a sync classifier wrote can be held and later announced: `incompleteReceiveTxids` takes `received`,
    incomplete rows with `classificationAddressCount > 0`. A broadcast-created internal receive
    (`internalReceiving.ts:83-97`) and a pre-classification legacy row keep the schema default 0, so their repair stays
    silent, as today. Without this filter every Sanctuary-to-Sanctuary transfer would be announced twice (once at
    broadcast, again when the receiving wallet's sync repairs the row).
  - Accepted consequences, stated in the changelog:
    - Incomplete `received` rows that a sync stored before this ships were announced at creation. When a repair later
      completes one, it is announced once more: a duplicate for a genuine receive, the correct `sent` for a false
      one. This applies only to sync-created incomplete received rows in the backlog that exists at upgrade.
    - A genuine receive held because an input's ownership was unknown, and whose classification can never become
      complete (permanently unfetchable parent, or a sibling input spending a non-standard output), is saved and
      visible but never announced. This is the failure that rejects option (a), but here the row is kept and shown.
    - A false row is still visible in the transaction history until the repair runs, as today. Only the announcement
      changes.
  - Not a consequence: `blockchain/syncAddress.ts` also writes incomplete rows but has no production caller (only the
    re-export in `blockchain/index.ts`). The baseline-sync filter still applies.
  - A stored "withheld" marker would remove the first consequence but needs a schema change, which is frozen
    (no new migrations; RC10 migration digest).
- **OQ-A2 (coordinator).** The threshold stays the live `min(requiredApprovals, specificApprovers.length)`. It is not
  capped by the number of listed approvers who still have access: losing access must not weaken the policy, as for
  `any_n`. A request whose listed approvers lost access stays pending until the roster is edited or the request
  expires.
- **OQ-B2 (coordinator).** Keep the fix in the frontend.
  - The wallet transactions tab applies the Console's amount range and limit through the existing AI filter, which
    already filters by absolute amount (inclusive) and limit and shows its clearable "Showing X of Y" summary and its
    loaded-pages notice.
  - `/console/results` fetches up to 500 rows per wallet when an amount filter is set, filters by amount in the
    browser, keeps the Console's limit, shows the amount filter as a badge, and shows a warning when a wallet may have
    more matches than shown.
  - Adding `minAmount`/`maxAmount` to `GET /wallets/:id/transactions` would make `/console/results` exact. It is
    recorded as P3 follow-up `console-results--amount-filter-scans-client-side`; it changes the API contract and is
    not needed to stop the silent drop.

## Goal and non-goals

**Goal.** The five P2s stop reproducing:
- A PR touching only `src/api`, `src/services`, `src/public` or `src/types` runs Full Render E2E (`shared/` already ran
  render).
- A `specific` approval request counts only votes from listed approvers who still have approver access.
- A spend whose parent could not be fetched is not announced as received, and an internal transfer is not announced
  twice.
- "Sync all" and "Full resync all" outcomes, including errors, are visible on the Wallets page at every supported
  width.
- A Console query's amount filter and limit reach the view it navigates to, or the view says it is broader.

**Non-goals.**
- No server API change, schema change or migration. No repair of stored rows.
- No change to sync classification, persistence, the receive-evidence gate or repair scheduling (A1 changes only which
  rows are announced).
- No change to e2e grouping, sharding or budgets.
- No version bump. The P3 backlog stays out.

## Decisions

### Cross-cutting decisions

- **D-20.X1 (delivery).**
  - One PR on `codex/bug-scrub-loop/20261013-i20` (worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i20`).
  - One commit per phase (failing test + fix) in the order C1, A2, A1, B1, B2, then the integrator commit
    (changelog only, text in "Integrator commit: changelog"; `docs/architecture/generated` is expected unchanged,
    Verification pre-step 1).
  - The coordinator implements each phase from its prototype in the integration worktree. The prototypes are disjoint.
- **D-20.X2 (red evidence and setup).**
  - Every new test runs on base code before its fix and must fail for the reason its phase states. An unexpected red
    reason is a stop: record it and re-assess.
  - Setup in the integration worktree: root `npm ci`; `npx prisma generate` in `server/`;
    `npm run build --workspace shared`; about 810 `node_modules` entries in a real directory.
  - Never `server/npm ci`. Never `git stash`. One coverage run at a time host-wide.
  - Commits run in the foreground with nvm node v24.21.0 (npm 12), never while a `vitest --coverage` runs on the host.
- **D-20.X3 (pinned surfaces).** No planned change touches:
  - `config/wallet-safety-mutation-map.json`, the Stryker configs, `server/scripts/mutation`,
    `.github/mutation-baseline.json`;
  - `config/wallet-sync-mutation-boundaries.json`, `config/wallet-sync-lifecycle-contract.json`;
  - `server/prisma`, `config/resource-lifecycle-callsites.json`;
  - `scripts/verify-addresses`, `scripts/perf`, `shared/`, `.github/workflows`;
  - `server/src/services/accessControl.ts`, the replay driver.

  Notes:
  - A1's files are under `server/src/services/bitcoin/**` (`config/wallet-safety-critical-paths.json`), so the PR
    triggers the wallet-safety full scan. None of them is in the mutation map or a Stryker range; A1 adds no repository
    call (`npm run check:wallet-sync-mutation-boundaries`, `npm run check:wallet-sync-lifecycle-contract` and
    `npm run check:safety-catch-guards` pass on the prototype) and no UTXO writer.
  - `approvalService.ts` is in no mutation map, Stryker range or `is_critical_mutation_file` list.
- **D-20.X4 (lizard).** Run the pinned `lizard` 1.24.0 with CI's flags on every changed `.ts`/`.tsx`: the per-file
  warning count must not grow, and the repository total stays ≤ the base total (measured on `5e37cf45ad91` in a
  detached worktree inside the Verification block). The existing `processTransactionsPhase` warning (136 NLOC, CCN
  24) and the `useWalletDetailController` warning (344 NLOC, CCN 17) must not grow; the Verification block asserts
  both texts after the per-file loop.

## Phase C1 — The render lane covers the whole frontend runtime

**Findings.** `ci-classifier--render-lane-omits-api-services-public-runtime` (P2), folded P3
`ci-classifier--render-lane-omits-src-types-runtime`. (The Vite finding was rejected in review; see the header.)

**Evidence (base).**
- `scripts/ci/classify-files-lib.sh:306-325` `is_render_file` does not match `src/api/*`, `src/services/*`,
  `src/public/*` or `src/types/*`; the render specs run the built app, which executes that code against the mocked
  API. A PR touching only those files skips Full Render E2E, and the summary accepts the skip.

**Change.**
- `is_render_file` additionally matches `src/api/*`, `src/services/*`, `src/public/*`, `src/types/*` and `shared/*`,
  the same runtime trees as `is_browser_smoke_file`. No Vite arm is added to `is_render_file` or
  `is_browser_smoke_file`. The render-regression snapshot and harness exclusions are unchanged. The `shared/*` arm adds
  no lane (`shared/` already selects render through `is_shared_workspace_file`, `classify-test-changes.sh:229-236`,
  `render_changed=true` at `:234`); it is kept for symmetry with `is_browser_smoke_file` and the drift guard only.
- `is_browser_smoke_file` and `is_build_file` are unchanged.
- `tests/ci/renderHarnessInputsClassified.test.ts` walks `src/main.tsx` and `src/App.tsx` as well as the harness
  (`config/tooling/vite.config.ts` is not a root), resolves the `@/` and `@sanctuary/shared/` aliases, skips
  comment-only lines, no longer treats `src/types/**` as type-only (`src/api/**/types.ts` stays excluded), and asserts
  that `src/api`, `src/services`, `src/hooks` and `shared/` are reachable. It asserts nothing about the Vite files.
- `tests/ci/browserSmokeInputsClassified.test.ts` is unchanged (the prototype's change there was only the Vite entry).
- `tests/ci/classify-test-changes.test.sh`: the existing Vite case (`≈669-680`) stays unchanged; the runtime-tree loop
  gains `src/api`, `src/services`, `src/public` and `shared` cases, each asserting `render_changed=true` (the `shared`
  case is for symmetry; it was already true); the two older assertions that recorded the gap
  (`src/services/hardwareWallet/service.ts`, `src/api/auth.ts`) flip to render true.
- `tests/ci/plan-test-run.test.sh` (the planner adapter has its own lane loop, `plan-test-run.sh:237-240`, used by
  `scripts/run-tests.sh` for local lane selection): one case in the existing fixture-repo style. A diff touching only
  `src/api/auth.ts` yields `lanes.render_regression.run` and `lanes.browser_smoke.run` true. (No Vite case: a Vite
  change is a full scan there too, `plan-test-run.sh:189-192`, so it would pass on base.)
- `docs/reference/ci-cd-strategy.md`: only the render-lane bullet changes; it lists the runtime trees and the guard.
  The browser-lane bullet is unchanged.
- The duplicated import-closure walker in the two guards stays duplicated in this PR (follow-up candidate only; not a
  finding).

**Red (observed).** `p20-c1-red.txt`: `expected render_changed=true, got render_changed=false`; the render guard lists
127 unclassified render inputs (93 under `src/api`/`src/services`, 4 under `src/types`, 30 under `shared/`; vitest
truncates the list, so count it from the full output). The browser guard does not
change and has no red. The `plan-test-run.test.sh` `src/api/auth.ts` case was added in review pass 1; the implementer
records its red on base (`api -> render: expected true, got false`).

**Acceptance.** The four classifier `.sh` suites, the other `classify-files-lib.sh` consumers named in the Verification
C1 block, and the three vitest drift guards pass; the Verification loop shows each named file selecting the render and
browser lanes.

## Phase A2 — `specific` quorum counts only listed approvers who still have access

**Finding.** `approval-specific--stale-votes-count-after-access-loss` (P2).

**Evidence (base).** `server/src/services/vaultPolicy/approvalService.ts:639-663` `checkSpecificQuorumMet` filters
approve votes by the live `specificApprovers` list only. `checkAllQuorumMet` (`:560-576`) and `checkAnyNQuorumMet`
(`:585-602`) both intersect with `getEligibleApproverIds(draft.walletId, draft.userId, request.allowSelfApproval)`.
Nothing removes a user from `specificApprovers` when their wallet access is revoked or downgraded
(`grep specificApprovers server/src`: only validation, types, DTO and schema). So an approve vote cast before access
was lost still counts, and a draft can be approved by fewer currently authorised approvers than required.

**Change.**
- `checkSpecificQuorumMet(request, approveVotes, draft)`: returns false on a missing draft; filters votes to the live
  list; returns false early (no eligibility query) when that count is below the threshold, as `any_n` does; otherwise
  counts only voters also in `getEligibleApproverIds(...)`. The live-threshold logic is unchanged (OQ-A2). JSDoc and
  the `checkAndResolveRequest` case comment updated.
- Callers: `checkAndResolveRequest` is called only from `castVote` (`:173`), which already loads the draft. Owner
  override, the expiry sweep and resolution do not call the quorum checks.

**Tests.**
- New `server/tests/unit/services/approvalService/approvalService.specific-eligibility.contracts.ts` (6 contracts),
  registered in `approvalService.test.ts` under "quorum membership (specific)": revoked approver's vote does not count;
  downgraded approver's vote does not count; the requester's vote does not count with self-approval off; a missing
  draft does not resolve; guards: self-approval allowed, and eligible listed approvers reach quorum.
- Six existing specific-quorum tests mock `findEffectiveApproverIds` with the listed voters
  (`cast-vote-resolution.contracts.ts` 1, `quorum-membership.contracts.ts` 5); the harness defaults it to `[]`.
- **New real-database spec** `server/tests/integration/flows/approvalSpecificEligibility.integration.test.ts`, mirroring
  `approvalAnyNEligibility.integration.test.ts` (165 lines), with exactly three tests. Each asserts through the same
  `statuses(requestId, draftId)` helper and `toEqual({ request, draft })` shape as that spec (`:110-144`):
  - `removing a listed approver after they approved keeps a specific request pending` (expects `pending`/`pending`);
  - `downgrading a listed approver to viewer after they approved keeps a specific request pending` (same);
  - guard: `a specific request resolves when the listed voters still hold approver access` (expects
    `approved`/`approved`).

  Registered in the `flows` group of `scripts/ci/backend-integration-groups.sh` next to `approvalAnyNEligibility`
  (`:35`), or the classifier lane fails.

**Red (observed).** `p20-a2-red.txt`: 4 of the 6 unit contracts fail on base (revoked, downgraded, self-vote, missing
draft); the 2 guards pass. The integration spec is new in the plan; its red is recorded on a guarded base swap
(Verification pre-step 3) and must show the two named cases resolving `approved` on base while the guard passes.

**Acceptance.** approvalService, vaultPolicy, approvals routes, draft and mobile agent draft suites pass (all in the
targeted Verification run); the integration spec passes on head.

## Phase A1 — A spend with an unfetched parent is not announced as received

**Finding.** `wallet-sync--spend-with-unfetched-parent-notified-as-received` (P2).

**Evidence (base).**
- `server/src/services/bitcoin/sync/phases/processTransactions/classification.ts` `classifyInputs`/`resolveInputEvidence`:
  when `fetchPreviousOutput` returns undefined (for example `fetch_budget_exhausted`), the wallet's own input is not
  recognised, so a spend made outside Sanctuary with change back to the wallet is classified `received` for the change
  amount (`≈417-425`) with `classificationInputsComplete: false`.
- `processTransactionsPhase.ts` `persistTransactionBatch` saves the batch, then `deferPostCommit(sendNotifications)`
  (`≈410-417`) announces it over push, Telegram, WebSocket and the `wallet.transaction.received` webhook, all through
  `dispatchTransactionNotifications`.
- `receiveEvidenceGate.ts` fails the attempt only after that; the row becomes a repair candidate (`checkExisting`
  treats `!classificationInputsComplete` as needing a recheck, rotated by `classificationLastAttemptAt`), and its
  later repair to `sent` announces nothing.

**Change** (OQ-A1 option b).
- `classification.ts`: export `hasUnresolvedInputOwnership(ctx, txid)` (a local evidence helper; no network or DB
  calls). True when any non-coinbase input has neither a script nor an address in evidence the sync already holds;
  missing transaction details count as unresolved.
- `notifications.ts`: `selectAnnounceableTransactions(ctx, created, repaired)` drops a created row that is `received`,
  incomplete, and has an input of unknown ownership; adds a repaired row whose txid is in
  `ctx.incompleteReceiveTxids`.
- `processTransactionsPhase.ts`: `persistTransactionBatch` notifies from that selection. Saving, I/O and repair
  behaviour are unchanged.
- `types.ts`, `context.ts`, `checkExisting.ts`: new `incompleteReceiveTxids: Set<string>`, filled from existing rows
  with `type === 'received' && !classificationInputsComplete && classificationAddressCount > 0` (the column is already
  selected, `checkExisting.ts:101`). Sync writers store `walletAddressSet.size` (`classification.ts`
  `createTransactionBase`; `historyTransactions.ts:272`); broadcast-created internal receives and legacy rows keep the
  default 0 and are excluded (OQ-A1).
- A receive whose parent output is non-standard (no address) has known ownership, still notifies at creation, and
  never repairs.

**Tests.** New `server/tests/unit/services/bitcoin/sync/phasesProcessTransactions/incomplete-receive-notifications.contracts.ts`
(6 cases), registered in `phases.processTransactions.test.ts`; one assertion in `phases.test.ts`
(`incompleteReceiveTxids` from `checkExistingPhase` holds a sync-written incomplete `received` row and excludes one
stored with `classificationAddressCount: 0`). Direct `selectAnnounceableTransactions` cases in
`server/tests/unit/services/bitcoin/sync/phases/processTransactions/notifications.test.ts` cover the helper branches
the phase contracts never reach (backend coverage is 100% on `classification.ts` at base): a txid missing from
`txDetailsCache` counts as unresolved (held); a transaction with no `vin` (the `vin || []` fallback) is not held; a
coinbase input is skipped. The phase contracts:
1. a spend with change whose parent fetch is exhausted is saved but not announced;
2. a repaired, previously held row is announced with its repaired type (`sent`);
3. guard: a genuine receive with complete evidence is announced at creation;
4. guard: repairing a row that was never held stays silent;
5. guard: a repaired row stored with `classificationAddressCount: 0` (a broadcast-created internal receive) stays
   silent; the set is built by `checkExistingPhase` from the seeded row, not set by hand. The case asserts only on the
   notification dispatch mock and never reads `ctx.incompleteReceiveTxids`, so it passes on base as a guard;
6. a `received` candidate with one non-standard input and one unfetched input is saved but not announced; a later sync
   that resolves the unfetched parent returns outcome `'unchanged'` and stays silent (pins the OQ-A1 permanent hold).

`phases.test.ts`: its existing incomplete-`received` fixture row has `classificationAddressCount: 0`, which the new
filter excludes (`expected [] to deeply equal [ Array(1) ]`). Set that row's count to 1, add a count-0 row, and assert
only the count-1 row is in `incompleteReceiveTxids`. The file grows from 1024 to about 1037 lines; it is an
already-classified proof harness in `check-large-files`, which passes.

**Red (observed).** `p20-a1-red.txt`: 3 of 138 fail on base — a `received` notification for 40000n sats (the change),
no notification on repair, and no `incompleteReceiveTxids`; the two guards pass. Cases 5 and 6 were added in review
pass 1; expected on base: case 6 fails (the held row is announced at creation), case 5 passes as a guard. The
implementer records both. The three direct `notifications.test.ts` cases (pass 4) fail on base with
`selectAnnounceableTransactions is not a function` (a new export).

**Acceptance.** `tests/unit/services/bitcoin`, notification and sync suites pass; the wallet-sync boundary,
lifecycle-contract and safety-catch checks pass; lizard per D-20.X4.

## Phase B1 — The Wallets page shows sync outcomes

**Finding.** `network-sync-actions--compact-mode-drops-result` (P2).

**Evidence (base).** `src/components/WalletList/WalletListHeader.tsx:76-82` is the only caller of
`NetworkSyncActions` and passes `compact`. `CompactNetworkSyncActions.tsx` never renders `result`; only
`FullNetworkSyncActions` renders `<NetworkSyncResult>`. `useNetworkSyncActions.ts` reports errors and partial outcomes
only through `result` (`≈227-275`; partial failures are documented to "stay until dismissed", but no dismiss path
exists), and `onSyncStarted` fires only on success.

**Change.**
- `types.ts`: `dismissResult` on `NetworkSyncActionState`.
- `useNetworkSyncActions.ts`: `dismissResult` clears the auto-clear timer and sets the result to null. Auto-clear timing
  is unchanged (sync 5 s, fully successful resync 8 s, partial/failed resync until dismissed).
- `NetworkSyncResult.tsx`: new `CompactNetworkSyncResult` (the visible panel) reusing the per-type colour classes;
  `role="alert"` for errors and no live-region role otherwise; an X button labelled "Dismiss sync result". It renders
  only with a result.
- `CompactNetworkSyncActions.tsx`: an always-mounted, visually empty `sr-only` `role="status"` region; non-error
  messages are written into it, so polite announcements fire (a polite live region must exist before its content
  changes). It is the only `role="status"` element and carries the announcement text; non-error text appears both
  there and in the panel, so tests query it by role, not `getByText`. It is empty and out of flow when idle. The visible panel renders under the buttons only with a result:
  `absolute left-0 right-0 top-full mt-2 sm:left-auto sm:w-72`, `z-20`. The wrapper no longer needs `relative`.
- `src/components/WalletList/WalletListHeader.tsx`: `relative` on the header action row
  (`flex flex-wrap items-center gap-2`, `:59`, the row holding sort, view, sync, Import and Create). Below `md` the
  header is `flex-col`, so that row is full width; the panel therefore spans the row on phones and sits right-aligned,
  18rem wide, from `sm` up. No ancestor between the panel and the row is positioned or transformed (the sync wrapper at
  `:75` is `flex surface-elevated ...`; `.surface-elevated` sets only background and box-shadow, `src/index.html:794`).
- **D-20.B1a (no clipping).** The implementer checks every ancestor of the action row up to and including LayoutShell's
  `<main>` (`overflow-y-auto`, `src/components/Layout/LayoutShell.tsx:151`; content at negative x cannot be scrolled
  to) and its `overflow-hidden` parents (`:120`, `:130`), and records the result in the implementation log.
  - Then one throwaway Playwright check (not committed, no baseline change) on the static build, with the
    render-regression API mocks as `renderWalletListActionsFit` uses them: at 1440, 390 and 320 px, in grid and table,
    route `POST **/sync/network/mainnet` to fail (registered after the harness mocks), click "Sync all Mainnet
    wallets", and assert the alert's bounding box is inside `main` with the same check as `expectFitsMain`
    (`tests/e2e/render-regression/renderRegressionListEntry.contracts.ts:44`). The spec lives in
    `$SCRATCH/i20-playwright/`, is copied into `tests/e2e/` only for that run and removed afterwards (the Verification
    block's clean-tree checks prove it is gone). Record the result in the implementation log.
  - A clip in either check is a stop: render the panel in flow below `sm` instead, and re-run the check.
- `FullNetworkSyncActions` is unchanged (no caller).

**Baselines.** The header is in `wallet-list-testnet-shell-chromium-linux.png` and the wallet grid/table captures;
no spec clicks the sync buttons, so the panel never renders there. `relative` on the row and the empty `sr-only`
region (absolutely positioned, 1 px, clipped) do not change the idle layout. The PNG baselines must not change.

**Tests.** Four compact-mode cases in `tests/components/NetworkSyncActions.branches.test.tsx`: failed "Sync all" shows
an alert and is dismissible; partial "Full resync all" stays after 30 s of fake time and is dismissible; deferred
"Sync all" puts its message in the status region (asserted on `getByRole('status')`'s text) and shows the panel;
guard: idle renders no alert, no Dismiss button, and every `role="status"` element is empty
(`screen.queryAllByRole('status').every(el => el.textContent === '')`). The guard passes on base, where none exist, and
on head. Do not assert that `role="status"` is absent.

**Red (observed).** `p20-b1-red.txt`: 3 of 4 fail on base (no alert, no message text, no status); the idle guard passes.

## Phase B2 — Console navigation keeps the amount filter and limit

**Finding.** `console-nav--amount-filter-and-limit-dropped-on-auto-navigation` (P2).

**Evidence (base).** The Console's `query_transactions` tool filters by `minAmount`/`maxAmount` (absolute sats,
inclusive, whole integers), but `src/app/consoleTransactionNavigation.ts:96-110` `collectConsoleTransactionFilters`
copies only wallet, dates, type and limit. The wallet tab ignores the limit too, and multi-wallet results stop at 100
per wallet without notice. So the view shown under the user's prompt is broader than the answer.

**Change** (OQ-B2).
- `consoleTransactionNavigation.ts`: the filter state carries `minAmount`/`maxAmount` (whole non-negative sats; anything
  else is dropped) and includes them in the dedupe key; the parsed route state has them as `number | null`; new helper
  `consoleFilterAsAiQuery(filter)`.
- `useWalletDetailController.ts`: `setAiQueryFilter(consoleFilterAsAiQuery(filter))` instead of `setAiQueryFilter(null)`.
  With no amount or limit it returns `null`, so behaviour is unchanged.
- `ConsoleResults` (`transactionResults.ts`, `consoleResultsModel.ts`, `ConsoleResultsContent.tsx`): with an amount
  filter, fetch up to 500 rows per wallet (server maximum 1000), filter by absolute amount, keep the Console limit
  (default 100); an amount badge ("≥ / ≤ / range … sats", or "Mixed amounts"); a warning
  (`data-testid="console-results-truncated-notice"`) when a wallet's fetched page was full or its matches exceeded the
  default 100, unless the Console's explicit limit stopped the list.
- No new request shape: `GET /wallets/:id/transactions` with `limit`, already in every e2e mock map; no map changes.

**Tests.** `tests/src/app/consoleTransactionNavigation.test.ts` (amount extraction, dedupe key, route-state parsing),
`tests/components/ConsoleResults.test.tsx` (amount and limit applied, cap notice, amount-scan notice),
`tests/components/WalletDetailWrapper/WalletDetailWrapper.states.contracts.tsx` (amount and limit reach the wallet tab;
these contracts run through `tests/components/WalletDetail.wrapper.test.tsx`, not on their own).
Existing fixtures gain `minAmount: null, maxAmount: null`. A route-state parsing case shows a `maxAmount` above
`Number.MAX_SAFE_INTEGER` (`'9007199254740993'`) parses to `maxAmount: null`, covering `parseSatsAmount`'s unsafe-integer arm
(frontend coverage is 100%).

**Red (observed).** `p20-b2-red.txt`: 7 new tests fail on base for those reasons. The pass-4 unsafe-integer
route-state case also fails on base (the field does not exist there), so 8 new tests fail on base in total.

## Integrator commit: changelog

`docs/reference/changelog.md`, under `## [Unreleased]`. Add these five bullets verbatim; bullet 2 goes under
`### Changed`, the others under `### Fixed` (CI bullets there lead with "CI:"). The Verification block greps phrases
from them.

- Under `### Fixed`:
  ```markdown
  - CI: Full Render E2E now runs for changes to `src/api`, `src/services`, `src/public` and `src/types`.
  ```
- Under `### Changed`:
  ```markdown
  - Approvals: a `specific` approval request now counts only approvers who still have access to the wallet. A vote from a listed approver who later lost access, or was downgraded below approver, no longer counts toward quorum; a request whose listed approvers lost access stays pending until the approver list is edited or the request expires.
  ```
- Under `### Fixed`:
  ```markdown
  - Wallet sync: a spend whose parent transaction could not be fetched is no longer announced as received (push, Telegram, WebSocket and the `wallet.transaction.received` webhook). The transaction is still saved and shown, and is announced when a later sync completes its classification. Consequences: an incomplete received transaction that a sync stored before this release is announced once more when a later sync completes it (a duplicate for a genuine receive, the correct "sent" for a misclassified spend); a genuine receive held because an input's ownership was unknown, and whose classification can never become complete (permanently unfetchable parent, or a sibling input spending a non-standard output), is saved and visible but never announced; a misclassified transaction stays visible in the history until the repair runs, as before.
  ```
  ```markdown
  - Wallets page: "Sync all" and "Full resync all" now show their outcome, including errors, under the header actions; a partial or failed full resync stays until dismissed.
  ```
  ```markdown
  - Console: a transaction query's amount filter and limit now reach the view it opens. The wallet transactions tab applies them through its filter summary; the multi-wallet results view scans up to 500 transactions per wallet, filters them by amount in the browser, and shows a warning when a wallet may have more matches than shown.
  ```

## Implementation log (coordinator)

- Phase worktrees were created from the converged plan commit `cf2deb162`. Each phase commit was cherry-picked with
  `-x` in plan order, proven upstream with `git cherry`, and its worktree and branch removed:

  | Phase | Integrated as | Worker commit(s) |
  |---|---|---|
  | C1 | `b2f0d7832` | `771616248` |
  | A2 | `bd301f0f1` | `af11e1c7d` |
  | A1 | `2e67c18cc`, `30b7d497c` | `351ce04ea`, `316ecc19d` |
  | B1 | `73fd8dd68` | `b737a4141` |
  | B2 | `5f45894f2`, `f3136065c` | `19bdddae0`, `ac8eaddfe` |
- Red runs on base, all for the stated reasons: `$SCRATCH/i20-{c1,a2,a1,b1,b2}-red.txt`, plus `i20-a1-red2.txt`.
  - C1: classifier `render_changed` false; plan-test-run `api -> render` false; render guard 127 unclassified
    (93/4/30).
  - A2: 4 of 6 unit contracts; the integration spec on a guarded base swap (`i20-a2-integration-red.txt`): 2 failed,
    1 passed, `"request": "approved"` on both failing titles. On head: 3 passed.
  - A1: 7 of 151 (cases 1, 2, 6, `phases.test.ts`, 3 direct cases); guards 3–5 pass; case 5 fails without the
    count filter.
  - B1: 3 of 4; the idle guard passes.
  - B2: 13 tests, not the planned 8. The extra 5 are prototype tests that postdate `p20-b2-red.txt` (two route-state
    fixtures, `consoleFilterAsAiQuery`, `selectConsoleWalletTransactions`, the amount badge); every failure is a
    missing field, helper or notice. Accepted.
- Divergences, each decided by the coordinator:
  - **A1 hold rule widened (second A1 commit).** The hook's AI review found that a received row whose inputs all had
    an address but one lacked a value was announced at creation and, being incomplete, announced again on repair
    (an ongoing duplicate, not only the upgrade backlog). The predicate became `hasRepairableIncompleteInput`: an
    input is unresolved when it has an address but no value, or no address and a script that is not non-standard
    (a standard script known only as hex can still complete). Invariant: a row announced at creation can never be
    repaired. A non-standard input (script decodes to no address) never completes, so such receives still announce
    at creation. The changelog bullet says "an incoming transaction whose inputs could not all be checked" instead
    of "ownership was unknown". Red on the first A1 commit: `i20-a1-red2.txt` (3 of 111).
  - **B2 amount badge in the user's unit (second B2 commit).** The planned "… sats" badge tripped
    `tests/components/amountUnitFormatting.test.ts`. Instead of an allowlist entry (a product decision per the
    guard), the badge renders through `usePriceFreeFormatter().format`. This adds the frontend graph edge
    `ConsoleResults → contexts/CurrencyContext.tsx`, so `docs/architecture/generated/frontend.md` changes (the plan
    expected no change); scope 37 → 38.
  - B1: a partial resync with a rejected wallet is an `error`-type result, so its test asserts the alert.
- `/simplify` (three reviewers) → `e1c4854a3`: shared `countEligibleApproveVotes`; the baseline notifiable filter
  runs before `selectAnnounceableTransactions`; `CompactNetworkSyncResult` owns the status region; shared
  `hasAmountFilter` and `CONSOLE_TRANSACTION_LIMIT_CAP`; a shared `WarningNotice`; test factories and typing.
  Skipped as scope expansion (follow-up candidates, not findings): moving the approval eligibility test helpers into
  the shared harness, sharing one amount predicate with `useAITransactionFilter`, and the duplicated import walker in
  the two CI drift guards.
- Adversarial implementation review (security reviewer, `$SCRATCH/i20-adversarial.json`): A2, B1, B2 and C1 held
  against every attack tried. One reproduced **P2 in A1**: after an import or a full resync, the baseline sync stores
  confirmed history without announcing it, but a historical row stored incomplete entered `incompleteReceiveTxids`
  and a later repair announced it as new (up to 100 per sync). Fixed in `af193a445`: a row counts as held only when
  its `blockTime` is null or no earlier than `createdAt` − 2 h (`HELD_RECEIVE_CONFIRMATION_TOLERANCE_MS`, the
  block-timestamp tolerance); nothing records when a baseline sync ended and a schema change is frozen. Red
  `i20-a1-red3.txt`; guard: a row confirmed 1 h before it was stored is announced once.
  - Focused re-review (`i20-adversarial-2.json`): the P2 is closed; one P3, a confirmed row with a null `blockTime`
    (block-header fetch failed in the baseline sync) was still treated as held. Fixed in `4e70fd737`: a null
    `blockTime` counts as held only when `blockHeight` is also null. Red `i20-a1-red4.txt`. No double announcement
    found on the A1 path.
  - Accepted, fail-silent (never a false announcement): a held genuine receive is not announced on repair when it
    confirmed more than 2 h before its row was stored (a wallet left unsynced, miner timestamp lag), when a
    confirmation update records a height without a block time, or when the user resets sync state before the
    repair (the repair then runs in a baseline sync). The changelog states the history case.
- Verification (2026-10-30), on the integrated branch:
  - First full run stopped at a stale shape check (the eligibility lookup moved into `countEligibleApproveVotes` in
    `/simplify`); the check was updated. Everything before it passed: typechecks, targeted backend (6922), the A2
    integration spec, backend coverage on `tests/unit` (17947 tests, 100%), the classifier suites and drift guards,
    the lane loop, pinned surfaces, the vector tests and the 38-file scope.
  - The tail from "# shape checks" then stopped at frontend coverage: 17525/17526 branches, the min-only arm of
    `consoleFilterAsAiQuery` (`consoleTransactionNavigation.ts:238`). Covered by one more case; the tail rerun passed
    with exit 0: frontend coverage 100%, Playwright 392 expected and only the 7 known auth/login failures (no
    unexpected), PNG baselines unchanged, lint, lizard (base total not exceeded, named warnings unchanged),
    large files, `arch:check`, boundaries, cycle baseline, lifecycle, ownership and supply-chain gates.
  - D-20.B1a throwaway check (`$SCRATCH/i20-b1-clip/`, not committed) on the same static build: 6/6 — the failed
    "Sync all" alert stays inside `<main>` with no horizontal overflow at 1440, 390 and 320 px in grid and table,
    light and dark, and dismisses.

## Verification (before every push)

The integrator runs this block on the integrated branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i20`, after
all five phase commits and the integrator commit, as `bash "$SCRATCH/i20-verify.sh"`.

**Before the block** (run these after the five phase commits and **before** creating the integrator commit, on a
clean tree; then create the integrator commit, then run the block):
1. Run `npm run arch:graphs` and `npm run arch:calls`. Expected: no change to `docs/architecture/generated` (the server
   graph is directory-collapsed, and `processTransactions` is outside `docs/architecture/calls.config.json`). Any diff
   is a stop to investigate, not something to commit: record it, then restore with
   `git checkout -- docs/architecture/generated`.
2. Copy `playwright.static.config.mts` and `known-auth-login-failures.txt` from `$SCRATCH/i19-playwright/` to
   `$SCRATCH/i20-playwright/`, with the config's import path changed to the i20 worktree.
3. Record the A2 integration red on a guarded base swap. Write it to `$SCRATCH/i20-a2-integration-red.sh` and run it
   with `bash`:
   ```bash
   set -euo pipefail
   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
   SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
   cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i20
   docker info >/dev/null
   BASE=5e37cf45ad914df55a79944919dcd765b9c5e79e
   F=server/src/services/vaultPolicy/approvalService.ts
   test -z "$(git status --porcelain)"
   exec 9>/home/nekoguntai/.i20-integration.lock
   flock 9
   trap 'git checkout -- "$F"' EXIT
   git show "$BASE:$F" > "$F"
   RC=0
   npm --prefix server run test:integration:db -- tests/integration/flows/approvalSpecificEligibility.integration.test.ts \
     >"$SCRATCH/i20-a2-integration-red.txt" 2>&1 || RC=$?
   git checkout -- "$F"
   git diff --exit-code HEAD -- "$F"
   trap - EXIT
   test "$RC" -ne 0 || { echo "A2 integration spec passed on base" >&2; exit 1; }
   OUT="$SCRATCH/i20-a2-integration-red.txt"
   grep -qF 'to deeply equal' "$OUT"
   grep -qF '+   "request": "approved",' "$OUT"
   grep -qE 'Tests +2 failed \| 1 passed' "$OUT"
   for t in 'removing a listed approver after they approved' 'downgrading a listed approver to viewer after they approved'; do
     grep -qE "(×|FAIL) .*$t" "$OUT" || { echo "A2 red: '$t' not on a failing line" >&2; exit 1; }
   done
   if grep -qE '(×|FAIL) .*resolves when the listed voters still hold approver access' "$OUT"; then
     echo "A2 red: the guard failed on base" >&2; exit 1
   fi
   echo "A2 integration red recorded"
   ```
   The patterns match vitest 4's `toEqual` failure on the pinned `statuses(...)` shape (`expected { request:
   'approved', …(1) } to deeply equal ...` followed by a `+`/`-` diff), so a DB or setup failure cannot pass. Any other
   red reason is a stop.

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i20
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i20
test "$(npm --version | cut -d. -f1)" = 12
test -d node_modules
test ! -L node_modules
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"
BASE=5e37cf45ad914df55a79944919dcd765b9c5e79e
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
# targeted backend: A2 (approvals), A1 (sync notifications)
( cd server && npx vitest run tests/unit/services/approvalService.test.ts tests/unit/services/vaultPolicy \
  tests/unit/services/mobileAgentDraftService.test.ts tests/unit/services/draftService.test.ts \
  tests/unit/services/draftCreate.test.ts tests/unit/api/approvals-routes.test.ts \
  tests/unit/api/wallets-approvals-routes.test.ts tests/unit/assistant \
  tests/unit/services/bitcoin tests/unit/services/notifications tests/unit/worker )
npm run check:safety-catch-guards
npm run check:wallet-sync-mutation-boundaries
npm run check:wallet-sync-lifecycle-contract
# A2 integration spec on a real database
flock /home/nekoguntai/.i20-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/approvalSpecificEligibility.integration.test.ts
bash scripts/ci/backend-integration-groups.sh --check
bash scripts/ci/backend-integration-groups.sh flows | grep -qxF tests/integration/flows/approvalSpecificEligibility.integration.test.ts
bash tests/ci/backend-integration-groups.test.sh
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # scoped to tests/unit as CI
# C1: classifier
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/plan-test-run.test.sh
bash tests/ci/classify-quality-scope.test.sh
bash tests/ci/check-workflow-composition.test.sh
# other classify-files-lib.sh consumers
bash tests/ci/classify-verify-vectors-scope.test.sh
node --test tests/ci/check-wallet-safety-classifier.test.mjs
node scripts/ci/check-critical-mutation-config.mjs
bash tests/ci/related-test-args.test.sh
bash tests/ci/pre-commit-agent-gate.test.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci/browserSmokeInputsClassified.test.ts \
  tests/ci/renderHarnessInputsClassified.test.ts tests/ci/vitestRepoInputsClassified.test.ts
for f in src/api/transactions/index.ts src/services/hardwareWallet/service.ts src/public/favicon.svg src/types/index.ts shared/schemas/walletResponses.ts; do
  test -e "$f"
  bash -c '. scripts/ci/classify-files-lib.sh; is_render_file "$1"' _ "$f" || { echo "C1: $f not a render input" >&2; exit 1; }
  bash -c '. scripts/ci/classify-files-lib.sh; is_browser_smoke_file "$1"' _ "$f" || { echo "C1: $f not a browser input" >&2; exit 1; }
done
# pinned surfaces (D-20.X3) and scope
PINNED_SURFACES=(
  config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation
  .github/mutation-baseline.json config/wallet-sync-mutation-boundaries.json config/wallet-sync-lifecycle-contract.json
  server/prisma config/resource-lifecycle-callsites.json scripts/verify-addresses scripts/perf shared .github/workflows
  .nvmrc server/src/services/accessControl.ts
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")"
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts
EXPECTED_FILES="$(sort <<'EOF'
docs/architecture/generated/frontend.md
docs/reference/changelog.md
docs/reference/ci-cd-strategy.md
scripts/ci/backend-integration-groups.sh
scripts/ci/classify-files-lib.sh
server/src/services/bitcoin/sync/context.ts
server/src/services/bitcoin/sync/phases/checkExisting.ts
server/src/services/bitcoin/sync/phases/processTransactions/classification.ts
server/src/services/bitcoin/sync/phases/processTransactions/notifications.ts
server/src/services/bitcoin/sync/phases/processTransactions/processTransactionsPhase.ts
server/src/services/bitcoin/sync/types.ts
server/src/services/vaultPolicy/approvalService.ts
server/tests/integration/flows/approvalSpecificEligibility.integration.test.ts
server/tests/unit/services/approvalService.test.ts
server/tests/unit/services/approvalService/approvalService.cast-vote-resolution.contracts.ts
server/tests/unit/services/approvalService/approvalService.quorum-membership.contracts.ts
server/tests/unit/services/approvalService/approvalService.specific-eligibility.contracts.ts
server/tests/unit/services/bitcoin/sync/phases.processTransactions.test.ts
server/tests/unit/services/bitcoin/sync/phases.test.ts
server/tests/unit/services/bitcoin/sync/phases/processTransactions/notifications.test.ts
server/tests/unit/services/bitcoin/sync/phasesProcessTransactions/incomplete-receive-notifications.contracts.ts
src/app/consoleTransactionNavigation.ts
src/components/ConsoleResults/ConsoleResultsContent.tsx
src/components/ConsoleResults/consoleResultsModel.ts
src/components/ConsoleResults/transactionResults.ts
src/components/NetworkSyncActions/CompactNetworkSyncActions.tsx
src/components/NetworkSyncActions/NetworkSyncResult.tsx
src/components/NetworkSyncActions/types.ts
src/components/NetworkSyncActions/useNetworkSyncActions.ts
src/components/WalletDetail/useWalletDetailController.ts
src/components/WalletList/WalletListHeader.tsx
tests/ci/classify-test-changes.test.sh
tests/ci/plan-test-run.test.sh
tests/ci/renderHarnessInputsClassified.test.ts
tests/components/ConsoleResults.test.tsx
tests/components/NetworkSyncActions.branches.test.tsx
tests/components/WalletDetailWrapper/WalletDetailWrapper.states.contracts.tsx
tests/src/app/consoleTransactionNavigation.test.ts
EOF
)"
test "$(printf '%s\n' "$EXPECTED_FILES" | wc -l)" -eq 38   # C1 5, A2 7, A1 10, B1 6, B2 8, plus the changelog and the regenerated frontend graph
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' | sort)"   # generated arch docs: no change
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# shape checks
grep -qF 'countEligibleApproveVotes' <(sed -n '/^async function checkSpecificQuorumMet/,/^}/p' server/src/services/vaultPolicy/approvalService.ts)
grep -qF 'getEligibleApproverIds' <(sed -n '/^async function countEligibleApproveVotes/,/^}/p' server/src/services/vaultPolicy/approvalService.ts)   # shared with any_n since /simplify
grep -qF 'incompleteReceiveTxids' server/src/services/bitcoin/sync/phases/checkExisting.ts
grep -qF 'classificationAddressCount > 0' server/src/services/bitcoin/sync/phases/checkExisting.ts
grep -qF 'selectAnnounceableTransactions' server/src/services/bitcoin/sync/phases/processTransactions/processTransactionsPhase.ts
grep -qF 'CompactNetworkSyncResult' src/components/NetworkSyncActions/CompactNetworkSyncActions.tsx
grep -qF 'consoleFilterAsAiQuery' src/components/WalletDetail/useWalletDetailController.ts
grep -qF "src/api/*" <(sed -n '/^is_render_file()/,/^}/p' scripts/ci/classify-files-lib.sh)
for phrase in 'CI: Full Render E2E now runs for changes to `src/api`, `src/services`, `src/public` and `src/types`.' 'now counts only approvers who still have access' \
  'is no longer announced as received' 'is announced once more when a later sync completes it' \
  'is saved and visible but never announced' 'now show their outcome, including errors' \
  'amount filter and limit now reach the view it opens' 'scans up to 500 transactions per wallet'; do
  grep -qF "$phrase" <<<"$(tr '\n' ' ' <docs/reference/changelog.md | tr -s ' ')" || { echo "changelog missing: $phrase" >&2; exit 1; }
done
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/components/NetworkSyncActions.branches.test.tsx \
  tests/components/WalletList tests/components/ConsoleResults.test.tsx tests/src/app tests/components/WalletDetail.wrapper.test.tsx
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # 100% threshold
# Playwright static run (known 7 auth/login failures recorded, not gated); baselines must not change
PW_DIR="$SCRATCH/i20-playwright"
grep -qF "/home/nekoguntai/sanctuary-bug-scrub-20261013-i20/config/tooling/playwright.config.ts" "$PW_DIR/playwright.static.config.mts"
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
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i20-lizard.txt"
LZ_BASE_DIR="$SCRATCH/i20-lizard-base"
git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true
git worktree prune
git worktree add -q --detach "$LZ_BASE_DIR" "$BASE"
( cd "$LZ_BASE_DIR" && LIZARD_BIN="$PINNED_LIZARD" bash scripts/quality/lizard-only.sh ) >"$SCRATCH/i20-lizard-base.txt" 2>&1
LZ_BASE_TOTAL="$(grep -c ': warning:' "$SCRATCH/i20-lizard-base.txt")"
test "$LZ_BASE_TOTAL" -gt 0
test "$(grep -c ': warning:' "$SCRATCH/i20-lizard.txt")" -le "$LZ_BASE_TOTAL"
mapfile -t LZ_CHANGED < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- '*.ts' '*.tsx')
for f in "${LZ_CHANGED[@]}"; do
  test -f "$f"
  head_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$f" | grep -c ': warning:' || true)"
  base_n=0
  if [ -f "$LZ_BASE_DIR/$f" ]; then base_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$LZ_BASE_DIR/$f" | grep -c ': warning:' || true)"; fi
  test "$head_n" -le "$base_n" || { echo "D-20.X4: $f warnings $base_n -> $head_n" >&2; exit 1; }
done
# D-20.X4 named warnings must not grow (if the implementation lowers a number, pin the lower text; higher is a stop)
# lizard -w exits 1 when it prints a warning, so capture with `|| true` before grepping (set -o pipefail)
LZ_PTP="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 server/src/services/bitcoin/sync/phases/processTransactions/processTransactionsPhase.ts || true)"
grep -qF 'processTransactionsPhase has 136 NLOC, 24 CCN' <<<"$LZ_PTP"
LZ_WDC="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 src/components/WalletDetail/useWalletDetailController.ts || true)"
grep -qF 'useWalletDetailController has 344 NLOC, 17 CCN' <<<"$LZ_WDC"
git worktree remove --force "$LZ_BASE_DIR"
LZ_BASE_DIR=""
node scripts/quality/check-large-files.mjs
npm run arch:check
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
node scripts/ci/check-supply-chain-locks.mjs
git diff --check "$BASE" HEAD
test -z "$(git status --porcelain)"
echo "i20 verification passed"
```

## Delivery, rollback, deployment

- **The PR.** One PR on `codex/bug-scrub-loop/20261013-i20`: the plan commits (only `tasks/`, excluded from the scope
  diff), five phase commits (C1, A2, A1, B1, B2) and the integrator commit. Squash-merged.
- **Merge rules.** Merge through protected `main`, no admin bypass; strictly serial merges; poll the required contexts
  via `/commits/<sha>/statuses`; never pass `delete_branch_after_merge`; verify the `merge_commit_sha` is an ancestor
  of `main` before deleting the branch; then verify target-branch CI.
- **Expected CI lanes** (a missing expected lane is investigated, not assumed skipped):
  - **Test Suite: full scan.** `scripts/ci/classify-files-lib.sh` is test-lane infrastructure
    (`is_full_scan_trigger_file`), so it forces `full_scan`: every Test Suite lane runs, including Full Browser E2E,
    Full Render E2E, the backend integration groups (`flows` now lists `approvalSpecificEligibility`), Full Critical
    Mutation Gate shards, Full Gateway Tests, Full LLM Egress Proxy Tests, and full backend and frontend coverage.
    Record the job IDs.
  - **Code Quality**, including ci-classifier-tests (`scripts/ci/*`).
  - **Verify Bitcoin Vectors**: A1 is on the wallet-safety critical paths.
  - **Release Candidate Validation**: runs on `scripts/ci/**` (C1). Record the job IDs.
  - **Validate Docker Images** (`docker-build.yml`): triggers on `src/**` and `server/**`.
  - **Architecture** (`architecture.yml`) runs on the PR (`**/*.ts`) but is not PR-required: watch the PR run and the
    post-merge run.
- **CI triage is infrastructure first** (CLAUDE.md): a sora-only timeout (mutation shards included) is contention
  first, then Podman archive stalls (runner-infra #34), the npm advisory endpoint, DIND, a stranded e2e runner lock,
  kumo's native builder.
- **Retriggers** carry the four-part evidence.
- **PR-body flags:** C1 cost as corrected in OQ-C1 (src/api, src/services, src/public, src/types, about 107 files;
  `shared/` already ran render; the Vite files were already full-scan triggers) and the iteration-19 decision it
  follows; A2 stricter threshold (OQ-A2); A1 option, the `classificationAddressCount > 0` filter and the accepted
  consequences (OQ-A1); B1 D-20.B1a ancestor check and throwaway Playwright result; B2 500-row client-side scan, its
  warning, and the P3 follow-up; "No migration, no new endpoint, no workflow edit, no version bump."
- **Rollback.** Code, test and docs only, with no stored-shape change; each commit reverts independently.
- **Deployment.** None until clean closeout (`--deploy final`).

## Completion criteria

- [ ] Every failing-first test fails on `5e37cf45ad91` code for its stated reason and passes on the PR head; guard
  cases are recorded as guards; the A2 integration red is recorded.
- [ ] The B1 D-20.B1a ancestor check and the throwaway Playwright clip check (1440/390/320, grid and table) are
  recorded in the implementation log, and the throwaway spec is gone from the tree.
- [ ] `npm run arch:graphs` / `arch:calls` left `docs/architecture/generated` unchanged before the integrator commit.
- [ ] The Verification block runs as written on the integrated branch, exit 0 recorded (both coverage runs at 100%,
  lizard not above base with no per-file growth and the two named warnings unchanged, the 38-file scope diff, empty
  pinned-surface diff, `arch:check`, Playwright with baselines unchanged and no new unhandled-request failures).
- [ ] `/simplify` and an adversarial implementation review run on the integrated diff; findings fixed or recorded.
- [ ] PR head CI is green with run and job IDs recorded, including Full Browser E2E, Full Render E2E, every Full
  Critical Mutation Gate shard and verify-vectors. A sora-only mutation timeout is triaged as contention per CLAUDE.md
  (four-part evidence before any retrigger).
- [ ] The PR is merged, required contexts green, target-branch CI green on the merge commit, ancestry verified,
  branches and worktrees cleaned.
- [ ] Run state: the five findings and the folded P3 are resolved (the Vite finding stays rejected); P3 follow-up
  `console-results--amount-filter-scans-client-side` is backlog.
- [ ] The P3 backlog stays outside the blocking fix set.

## Review log

- Draft assembled 2026-10-30 from the five prototypes (source `5e37cf45ad91`). All patches apply cleanly together
  (the B2 patch was regenerated without the scratch `node_modules` symlinks).
  - Coordinator decisions: OQ-C1, OQ-A1 (option b), OQ-A2, OQ-B2; D-20.B1a (clip check); the A2 real-database spec.
- Pass 1 (2026-10-30): three reviewers (A phases; B/C phases; whole plan with the combined patch applied). 18 comments,
  all accepted and applied.
  - C1: `shared/` dropped from the newly covered set in OQ-C1, Goal, PR body and changelog; the `shared/*` arm and its
    test case kept for symmetry only (C1-shared-already-render). Two `plan-test-run.test.sh` cases added; the file
    joins the C1 list (C1-plan-test-run-parity). The other `classify-files-lib.sh` consumers join the Verification C1
    block (W6).
  - A2: integration spec pinned to the any_n `statuses(...)`/`toEqual` shape with three named tests; red grep replaced
    by the `to deeply equal` / `+   "request": "approved",` / `Tests 2 failed | 1 passed` checks plus per-title
    failing-line checks, and the "implementer adjusts" sentence deleted (A2-red-grep-does-not-match-toEqual, W2).
    Registration checked with `--check`, the `flows` listing and `backend-integration-groups.test.sh` (W5). Approvals
    routes, draft, mobile agent draft and assistant suites join the targeted backend run (W9).
  - A1: `incompleteReceiveTxids` takes only rows with `classificationAddressCount > 0`, with a guard contract for a
    broadcast-created internal receive; OQ-A1 consequences rewritten (A1-internal-receive-duplicate). The permanent
    hold added to OQ-A1 and the changelog, with a pinning contract; contracts 4 → 6 (A1-permanent-hold-unstated). The
    `syncAddress` consequence dropped: no production caller (A1-syncAddress-consequence-moot).
  - B1: panel anchored to the full-width header action row in `WalletListHeader.tsx` (joins the B1 list); D-20.B1a
    checks ancestors through LayoutShell's `<main>`, plus a throwaway static-build Playwright clip check at 1440/390/320
    in grid and table (B1-mobile-clip). Always-mounted `sr-only` `role="status"` region; the visible panel renders only
    with a result; baselines unchanged (B1-status-live-region).
  - B2: the targeted frontend run names `tests/components/WalletDetail.wrapper.test.tsx`, which runs the states
    contracts (B2-verify-target-path).
  - Verification and delivery: wallet-sync checks run through their `npm run` scripts (W1). Expected CI lanes state
    the full scan forced by `classify-files-lib.sh`, Validate Docker Images and the Architecture PR run; completion
    requires mutation-shard job IDs (W3). "Integrator commit: changelog" subsection with the five bullets verbatim, and
    the Verification phrases taken from them, including two OQ-A1 consequence phrases (W4). Arch regeneration moved
    before the integrator commit and expected to leave `docs/architecture/generated` unchanged; the scope diff no
    longer excludes it (W7). The two D-20.X4 lizard warnings asserted by text (W8). Scope list now 37 files.
  - Rejected: none.
- Pass 2 (2026-10-30): two reviewers (pass-1 changed areas tried in prototype copies; full read). 4 comments, all
  accepted and applied.
  - C1: the Vite finding is a false positive and is rejected in run state: `config/tooling/*` is an
    `is_full_scan_trigger_file` (`classify-files-lib.sh:553`) and `test.yml` runs and requires both e2e lanes on
    `full_scan` (`:1362`, `:1595`) (C1-vite-already-full-scan, W2-vite-already-full-scan). Blocking set now 5 P2s. All
    Vite work removed from C1: no Vite arms, no Vite root or reachability assertion in the drift guards,
    `browserSmokeInputsClassified.test.ts` dropped from the change, the existing Vite case in
    `classify-test-changes.test.sh` unchanged, and the `plan-test-run.test.sh` Vite case dropped (it passed on base).
    Goal, OQ-C1, CI cost, PR-body flags, the Verification lane loop, changelog bullet 1 and its Verification phrase
    updated. The `shared/` cite corrected to `classify-test-changes.sh:229-236` (W2-shared-render-cite).
  - B1: the non-error panel has no live-region role; the always-mounted `sr-only` `role="status"` region is the only
    status element and carries the text; the idle guard asserts every status element is empty, not absent; the
    deferred test asserts the status region's text (B1-idle-guard-and-panel-role-vs-always-mounted-status).
  - Verification: the two D-20.X4 named-warning checks capture lizard output with `|| true` before grepping, so the
    block can exit 0 under `set -euo pipefail` (W2-lizard-named-warning-pipefail).
  - Confirmed: A1 cases 5/6 red/green as stated, including case 5 pinning the `classificationAddressCount > 0` filter;
    the A2 red greps match the exact vitest 4.1.11 output; the changelog phrases match the bullets; the file list is
    consistent at 37 → 36; the B1 header-row anchoring holds.
  - Rejected: none.
- **Pass 3 (2026-10-30): one independent reviewer**, who applied the five prototypes plus every plan delta to a copy
  and ran the cheap parts of the Verification block green (36-file scope, pinned surfaces, shape and changelog greps,
  targeted backend 6912 tests, targeted frontend 167 tests, classifier suites, drift guards, typechecks, lint, lizard
  named warnings, large files).
  - A1: the existing `phases.test.ts` fixture row needs `classificationAddressCount: 1` plus a count-0 row (about +13
    lines); case 5 asserts only on the dispatch mock so it is a guard on base.
  - C1: the render-guard red count corrected to 127 (93/4/30), counted from the full output.
  - Confirmed reds: plan-test-run `src/api` case; B1 3 of 4; A1 case 6; case 5 fails without the count filter.
  - Rejected: none.
- **Pass 4 (2026-10-30): one independent full-plan reviewer** (scoped coverage on the prototypes).
  - A1: three direct `selectAnnounceableTransactions` cases in `notifications.test.ts` for the helper's uncovered
    branches (missing cache entry, no `vin`, coinbase); on the prototype `classification.ts` was 97.82% branches
    (lines 309-311), which fails the backend 100% run. Scope 36 → 37 (A1 10).
  - B2: a case for the unsafe-integer arm of `parseSatsAmount` (consoleTransactionNavigation.ts 113/114 branches).
  - Confirmed: the re-extracted Verification block and A2 red script pass `bash -n`; all cited paths, scripts and
    lines match; EXPECTED_FILES; the changelog phrases; lizard; A2 and B1 coverage at 100%.
  - Rejected: none.
- **Pass 5 (2026-10-30): one independent full-plan reviewer** (scoped coverage on copies of the prototypes with the
  pass-4 cases added).
  - A1: stated the base red of the three `notifications.test.ts` cases (`selectAnnounceableTransactions is not a
    function`).
  - B2: the unsafe-integer case is a route-state parsing case expecting `maxAmount: null`; base red is 8.
  - Confirmed: `notifications.test.ts` path and include glob; 100% coverage on the four A1 source files (509 sync
    tests); the unsafe-integer arm covered; Verification and A2 scripts pass `bash -n`; 37 files = 5/7/10/6/8 + 1.
  - Rejected: none.
- **Pass 6 (2026-10-30): one independent full-plan reviewer — clean, review converged.** No verified actionable
  comments. It re-checked every new test's stated base red or guard status against its design (A2 6 unit + 3
  integration, A1 cases 5/6 + `phases.test.ts` + 3 `notifications.test.ts`, B1 3 + guard, B2 8, C1), all citations,
  the 37-file list, the changelog phrases, lizard per file, and `bash -n` on the Verification block and A2 red script.
