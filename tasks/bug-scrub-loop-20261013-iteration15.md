# Bug-scrub loop 20261013 — iteration 15 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 15
- **Source SHA:** `560e8f110ed93246c659b25aaa063751cb3e09a0` (`main`, after #1415)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (6 × P2):** A1 `wallet-sync--attempt-evidence-ceiling-counts-whole-history-permanent-failure`, A2
  `create-wallet--descriptor-only-wallet-unspendable`, B1 `fee-tiers--client-maps-server-tiers-one-slot-down`, B2
  `admin-settings--smtp-values-json-encoded-break-email`, B3 `webhooks--confirmed-event-never-emitted-after-mempool`, C1
  `ci-supply-chain-locks--line-local-image-scan-misses-untagged-and-continuation-refs`. Every finding was re-verified
  from source at `560e8f110e` (file:line in the phase sections), and every fix and red test was prototyped on a scratch
  copy of that tree (the phase sections say which reds were observed and which are predicted).
- The other 18 P3s from this 24-finding scrub are backlog in run state and are **outside this fix set**.
- **Scratchpad** (`scratchpad/…` and `<scratchpad>/…` in the phase sections, `$SCRATCH` in the Verification block):
  `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`. The prototype diffs
  are referenced there, not inlined: `i15-a1-src.patch`, `i15-a2-src.patch` (Phase A), `plan15-B-prototype.patch`
  (Phase B; it predates the coordinator folds D-15.B2e and D-15.B3h and omits some listed test edits), and
  `plan15-C-gate.diff`, `plan15-C-tests.diff`, `plan15-C-live-fixes.diff` (Phase C). A prototype is guidance; the
  phase text below governs where they differ.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `wallet-sync--attempt-evidence-ceiling-counts-whole-history-permanent-failure` | P2 |
| A2 | `create-wallet--descriptor-only-wallet-unspendable` | P2 |
| B1 | `fee-tiers--client-maps-server-tiers-one-slot-down` | P2 |
| B2 | `admin-settings--smtp-values-json-encoded-break-email` | P2 |
| B3 | `webhooks--confirmed-event-never-emitted-after-mempool` | P2 |
| C1 | `ci-supply-chain-locks--line-local-image-scan-misses-untagged-and-continuation-refs` | P2 |

## Open questions

All open questions raised by the section drafters are **DECIDED by the coordinator**. None needs a user decision: each
decision keeps current behaviour, narrows a fix to its smallest correct form, or is strictly stricter than today, and
none invents product policy. Each deferred item is recorded in run state as a P3 follow-up, outside this fix set. The
phase sections below carry the decisions; where a section's drafted text recommended otherwise, it is amended in place
and marked *(coordinator, at assembly)*.

- **OQ-A1 — the remaining per-wallet sync ceiling: DECIDED, option (d) plus a distinct failure reason.** A1 adopts
  D-15.1 (d): compact envelopes charge **0 outputs** to the attempt; the raw-hex, input and script-hex attempt ceilings,
  the per-transaction limits and every replay seal are unchanged. The genuine capacity limit that remains (retained
  canonical bytes plus foreign parents over 32 MiB, or over 100,000 inputs) gets a **distinct, clearly surfaced failure
  reason** instead of the generic `transaction_complexity_exceeded`: new decision **D-15.11** records
  `attempt_evidence_capacity_exceeded`, which reaches `wallets.lastSyncError` (and the wallet header's sync-failure
  banner, `src/components/WalletDetail/WalletHeader.tsx:59`, `:83`) through the existing
  `summariseRejectedEvidence` path, and logs one `error` per attempt naming the wallet and the binding counter, so the
  retry is never a silent loop. Retry cadence is unchanged. Windowed or parent-narrowed history authentication
  (options (iii)/(iv)) and stopping retries for a wallet that cannot fit are a **P3 design follow-up**
  `wallet-sync--retained-evidence-capacity-limit-design`.
- **A2 — descriptor-only `POST /wallets`: DECIDED, reject with 400 pointing at `/api/v1/wallets/import`** (D-15.5,
  D-15.6). Existing descriptor-only wallets are **not repaired** (D-15.9); that is a documented known limitation in the
  changelog bullet (D-15.8).
- **OQ-B1 — PNG baseline: DECIDED, change the render-regression harness fee mock** (D-15.B1c) so
  `dashboard-testnet-shell-chromium-linux.png` keeps depicting the values it shows. The screenshot compares at
  `maxDiffPixelRatio: 0.01`, so it does not pin fee digits (the unit tests do). The integrator's static Playwright run
  is binding: the PNG baseline files stay unchanged and the screenshot assertions pass at the repo tolerance; any
  screenshot failure is a **D-15.X3 stop**, not a regeneration. *(review pass 1, B-1)*
- **B2 P3 candidate — monitoring URL settings: DECIDED, folded into B2** (new D-15.B2e). The Grafana, Prometheus and
  Jaeger custom-URL readers in `adminMonitoringService.ts:54-56` use the same `decodeStoredString`; the production
  change and its red test are part of B2. The drafted P3 id `admin-settings--monitoring-urls-json-quoted-via-generic-put`
  is withdrawn.
- **OQ-B3 — `confirmationThreshold` above the confirmation-tracking horizon: DECIDED, save-time validation folded into
  B3** (new D-15.B3h). Creating or updating a webhook endpoint whose `filters.confirmationThreshold` exceeds the
  confirmation-tracking horizon, min(deep confirmation threshold, 6) *(review pass 1, B-2)*, returns **400**
  (`INVALID_INPUT`) with a message naming the threshold and that bound. The webhook is **never fired early**. Existing endpoints already above the threshold are a documented known limitation
  (changelog) and the P3 follow-up `webhooks--threshold-above-deep-confirmation-never-fires`; the drafted P3 id
  `webhooks--confirmation-threshold-beyond-tracking-horizon` is replaced by it.
- **C-Q1 — Docker Hub spellings: DECIDED, normalise in the gate** (D-15.C5); the lock file keeps its bytes.
- **C-Q2 — `tests/install/{utils,e2e}`: DECIDED, include them in the scan** (D-15.C1), with the three D-15.C6 pins.
- **C-Q3 — `LIZARD_WARNING_BASELINE`: DECIDED, leave the ceiling at 86** in both `quality.yml:52` and
  `scripts/quality.sh:21`. The Verification block still gates this PR at the measured count (D-15.X1).
- **C-Q4 — variable-built image references: DECIDED, P3 residual** `ci-supply-chain-locks--variable-built-image-refs-unscanned`
  (the drafted id `ci-supply-chain-locks--variable-indirected-image-refs` is replaced by it).

**P3 follow-ups recorded in run state (outside this fix set):**
- `wallet-sync--retained-evidence-capacity-limit-design` (OQ-A1: windowed or parent-narrowed authentication, a raised
  resident budget, or stopping retries for a wallet over the capacity limit; trigger: a real wallet past about 50% of
  the raw-hex ceiling, which A1's `canonicalBytesHighWater` receipts measure);
- `webhooks--threshold-above-deep-confirmation-never-fires` (OQ-B3: endpoints saved before D-15.B3h with a threshold
  above the confirmation-tracking horizon, min(deep confirmation threshold, 6), and endpoints left above it when an
  admin later lowers that threshold; note that `headerConfirmationUpdater.ts:14` keeps its own literal `6`, the same
  value as the exported `PENDING_CONFIRMATION_CANDIDATE_THRESHOLD`, and is not edited in this PR);
- `ci-supply-chain-locks--variable-built-image-refs-unscanned` (C-Q4, including `docker`/`podman` argv arrays in
  `.mjs/.cjs/.ts` sources);
- `webhooks--classification-repair-confirmation-skips-confirmed-event` *(review pass 1, B-3)*: a classification repair
  in `repositories/transactions/sync.ts` writes `confirmations` directly (`:83`, `:565-568`, `:649-652`) and bypasses
  `recordCommittedUpdates`, so a mempool-first row repaired after it confirms gets no `confirmed` webhook (D-15.B3g(iii));
- `autopilot-card--economy-fee-label-differs-from-send-economy` *(review pass 1, B-4)*: after B1 the send page's
  "Economy" is the ~6-block `hour` rate while the Autopilot health card's "Economy fee"
  (`AutopilotHealthStatusCard.tsx:62`) still shows the server `economy` (~12-block) tier.

## Goal and non-goals

**Goal:** fix every blocking finding (6 × P2), each with a non-regression test that fails on `560e8f110e` and passes
after the fix, delivered in one protected PR with green CI.

**Non-goals:** the P3 backlog and follow-ups (above); production data repair (existing descriptor-only wallets,
existing over-threshold webhook endpoints, stored JSON-quoted settings rows are read as they are, never rewritten); new
Prisma migrations or `schema.prisma` edits (RC10 migration-tree digest); new API endpoints, request/response fields or
query parameters (no e2e mock-map entry is added or removed: the thirteen `unhandledRequests` sites found by grepping
`transactions/balance-history` stay untouched); windowed history authentication (OQ-A1); a change to
`rawTransactionEvidence.ts` (tier-1 mutation surface, D-15.11); edits to sealed replay files; a lock-file change
(D-15.C6); lowering `LIZARD_WARNING_BASELINE` (C-Q3); regenerating any PNG baseline (OQ-B1); a version bump;
branch-protection changes.

## Decisions

Decision ids are kept from the section drafts and are unique across the plan: **D-15.1–D-15.11** (Phase A; D-15.11 is
the coordinator's OQ-A1 addition), **D-15.B1a–D-15.B3h** (Phase B; D-15.B2e and D-15.B3h are the coordinator's folds),
**D-15.C1–D-15.C7** (Phase C), and the cross-cutting **D-15.X1–D-15.X6** below.

### Cross-cutting decisions

- **D-15.X1 lizard headroom.** Pinned lizard 1.24.0 (`/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard`)
  with the repo arguments (`scripts/quality.sh` `run_lizard`, `:280-311`: `-w -i 86 -l javascript -l typescript -l tsx
  -C 15 -T nloc=200` plus its nineteen `-x` excludes) allows 86 warnings. **Base count re-measured on `560e8f110e`: 84**
  (run at assembly from the repository root of the i15 worktree, which has no `node_modules`, with exactly those
  arguments; rc 0; output `$SCRATCH/i15-lizard-base.txt`). **Phase C is expected to lower it by one** (D-15.C7 removes
  the `contextualImageLine` misparse warning without exposing the two CCN warnings it hid), so the PR's expected count
  is **83**, and the Verification block gates `grep -c ': warning:'` at **≤ 83** plus "no warning in
  `scripts/ci/check-supply-chain-locks.mjs`". Gating at 83 rather than 84 keeps C's reduction from masking a new
  warning in another phase. If the integrator's re-measured base on `560e8f110e` differs from 84, base − 1 replaces 83.
  *(review pass 1, C-8)* The integrator records that base run as `$SCRATCH/i15-lizard-base-integrator.txt` (same
  pinned binary and arguments, from a `git worktree` of `560e8f110e` with no `node_modules`) and, only if it differs
  from 84, edits the `-le 83` literal in `$SCRATCH/i15-verify.sh` to base − 1 and records the change in the
  implementation log.
  Every worker runs `lizard -C 15 -T nloc=200 <new/changed .ts/.tsx/.js/.mjs files>` and reports zero new warnings.
  New helpers are top-level `function`/`const` declarations, CCN ≤ 15, NLOC ≤ 200; do not hoist a nested `function`
  out of a `describe` without re-measuring (lizard nested-function anchor). Near-limit functions in planned files
  (measured on `560e8f110e`):
  - `fetchCompactWithProjector` (`evidenceAuthentication.ts:244-317`) is **already one of the 84** (CCN 17, NLOC 50).
    A1 must not edit it; a per-file lizard run on `evidenceAuthentication.ts` therefore reports exactly that one warning
    (its line number moves down with the added helpers; CCN 17 and NLOC 50 unchanged). `cacheCompactResult`
    (`:175-218`) is CCN 8: D-15.11's label choice lives in a separate top-level helper.
  - `matchesEndpointFilters` (`subscriptions.ts:30-60`) is at **CCN 15**: B3 adds no branch to it (D-15.B3b's
    `crossesEndpointConfirmationThreshold` is a separate function).
  - `validateWalletInput` (`walletCreate.ts:53-83`) is CCN 10; A2 does not change it. `queueWebhookEventsDeliveries`
    (`deliveryService.ts:61-111`) is CCN 9; B3 adds one optional predicate call.
  - `scripts/ci/check-supply-chain-locks.mjs:61` (`contextualImageLine`, 205 NLOC) is one of the 84 and is removed by
    D-15.C7; `inspectContainerLocks` (CCN 22) and `verifyToolchainSources` (CCN 28) must be split as D-15.C7 says, or
    the naive quote fix makes the count 85.
- **D-15.X2 one worktree per phase.** Phases `a` (A1, A2), `b` (B1–B3) and `c` (C1) each get a worktree
  `/home/nekoguntai/sanctuary-bug-scrub-20261013-i15-<phase>` (never `/tmp`) on branch
  `codex/bug-scrub-loop/20261013-i15-<phase>`, cut from the final reviewed plan commit (the integrator records its SHA;
  it differs from `560e8f110e` only under `tasks/`). File ownership is disjoint at this granularity (table below), so no
  further split is needed. Setup: root `npm ci` + `cd server && npx prisma generate` + `npm run build --workspace=shared`,
  nvm node on `PATH` (`$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin`; the system `~/.local/bin` npm 11 trips
  `devEngines` with EBADDEVENGINES; ~810 `node_modules` entries). Every commit goes through
  `flock /home/nekoguntai/.i15-commit.lock git commit …` in the foreground; never while a coverage or Stryker run is
  active; no `git stash`. **One commit per finding (test + fix), in phase order** (a: A1, A2; b: B1, B2, B3; c: C1).
  Workers record each red run on the plan-commit base. The integrator alone runs coverage, behind the bounded guard
  in the Verification block, and alone runs the integration specs (D-15.X3 integration rule), including the A2
  integration red on a guarded base swap (Verification, "Integrator step before the block").
- **D-15.X3 hold and stop rules.** **No phase is holdable**: all six findings are independent P2s with self-contained
  diffs. **Red-test stop rule:** if a failing-first test does not fail on the plan-commit base, or fails for a
  different reason than the phase states (a collection error, an unmocked-import `TypeError`, a different assertion, a
  fixture/control failure) and that reason is not on the accepted list below, the worker **stops** and the coordinator
  re-assesses before anything is cherry-picked. The same applies when the fix breaks an existing test the phase does
  not list, when a planned "green on base" guard is red (A1 tests 2, 4 and 5; B2 legacy-raw guard; B3 endpoint-service equal-threshold and no-threshold guards; B1 "returns null without
  estimates"; C1 test 5; the existing `emailService.test.ts`, `confirmationUpdater.test.ts` and
  `receiveEvidenceAuthentication.test.ts` cases the phases say stay green), when the C1 gate on the live tree reports
  anything other than exactly the four D-15.C6 errors, when the integrator's static Playwright run has any screenshot
  assertion failure or leaves any PNG baseline file changed or added (OQ-B1; the screenshot is a layout check at the
  repo tolerance, not a check on fee pixels), and when the integration database cannot start (the Verification block
  stops there; see the rule under it). A stop is recorded in the implementation log with the observed output.
  **Accepted reds (pre-cleared, not a stop; any other red reason for the same test is still a stop).** Match on the
  failing assertion line and its diff, not on the printed headline: vitest 4 prints `Map{ …(1) }` in the headline and
  puts keys and counts only in the `- Expected / + Received` diff. *(review pass 1, A-4; strings quoted from the
  reviewer logs `$SCRATCH/rpr15-a1-red.txt`, `rpr15-a2-red.txt`, `rpr15B-b3-red.txt`)*
  - A1 test 1: the `rejectedEvidenceReasons` `toEqual(new Map())` assertion; headline `AssertionError: expected Map{
    …(1) } to deeply equal Map{}`, diff `+   "transaction_complexity_exceeded" => 1,` (observed).
  - A1 test 3: the reasons `toEqual` assertion; headline `AssertionError: expected Map{ …(1) } to deeply equal Map{ …(1)
    }`, diff `-   "attempt_evidence_capacity_exceeded" => 2,` / `+   "transaction_complexity_exceeded" => 2,` (observed
    by the reviewer with the two-payout form).
  - The relabelled `receiveEvidenceAuthentication.test.ts` assertions (`:424`, the outputs test; `:458`, the shared
    `it.each` assertion for raw hex, inputs and scripts; four cases in all): the reasons `toEqual` assertion; headline
    `AssertionError: expected Map{ …(1) } to deeply equal Map{ …(1) }`, diff `-   "attempt_evidence_capacity_exceeded"
    => 1,` / `+   "transaction_complexity_exceeded" => 1,` (observed, 4 failed).
  - A2 unit `it.each` (both rows): `AssertionError: promise resolved "{ id: 'wallet-signerless', …(7) }" instead of
    rejecting` at the `.rejects.toMatchObject` line (observed). A2 integration (`core-crud.contracts.ts`, "refuses a
    signerless descriptor wallet"): `expected 400 "Bad Request", got 201 "Created"` (predicted; recorded by the
    integrator on the guarded base swap of `walletCreate.ts`, Verification, "Integrator step before the block").
  - B1: the two `formatFees` cases and the `toDashboardFeeEstimate` case fail on the mapped values (observed,
    `Tests 3 failed`).
  - B2: `emailService.storedSettings.test.ts` `3 failed | 1 passed` (observed); `emailVerificationService.test.ts`
    "server name saved" `1 failed` (observed); `safeJson.test.ts` `decodeStoredString` block fails because the export
    is missing (`TypeError: … is not a function`); the D-15.B2e monitoring case fails with the JSON-quoted URL
    (predicted).
  - B3: `confirmationUpdater.webhooks.test.ts` delivery cases `expected "vi.fn()" to be called 1|3 times, but got 0
    times` (observed) and the two log cases (no warn; predicted); `confirmationDeliveries.test.ts` fails to collect
    because the module does not exist; the new `eventBuilder.test.ts` and `webhookCore.test.ts` cases fail with a
    missing-export `TypeError`; the D-15.B3h endpoint-service refusal cases (create, update, and the
    deep-above-6 case) fail with `AssertionError: promise resolved "{ id: 'endpoint-1', …(21) }" instead of rejecting`
    (observed by the reviewer for create and update; predicted for the deep-above-6 case).
  - C1: tests 1–4 with the quoted `Input: ''` / deep-equal messages (observed; `pass 10, fail 4`), and the live-tree
    gate red with exactly the four D-15.C6 errors after the gate fix and before the pins.

  **Integration rule:** if the integration database cannot start, the block stops at the integration lines (it runs
  under `set -euo pipefail`). That is a D-15.X3 stop, not a fallback: record it, triage infrastructure first
  (compose-backed runner, host load, the `.i15-integration.lock` holder), then **re-run the whole block** as written
  once the DB starts. Completion requires the full block to exit 0 with all four integration specs executed.
- **D-15.X4 cross-phase couplings.** File ownership is disjoint (table below); the remaining couplings are shared
  gates only:
  1. A1 (`server/src/services/bitcoin/**`), A2 (`server/src/services/wallet/**`,
     `server/src/api/openapi/schemas/wallet.ts`) are on `config/wallet-safety-critical-paths.json` (`:11`, `:18`,
     `:37`), so the PR runs verify-vectors once. No phase touches `.github/workflows/verify-vectors.yml`, a
     `scripts/verify-addresses/sourceManifest.ts` input, or a sealed replay file. Phase B and C files are not on that
     list.
  2. B2 (`server/src/utils/safeJson.ts`) is the only edit on a Stryker whole-file glob (`server/stryker.config.mjs`);
     no phase edits a tier-1 pinned file (Verification block allow-lists).
  3. C1's gate scans every tracked and unignored source of a scanned kind (D-15.C1), so it also scans the files phases
     a and b add. None of them contains an image reference; the integrator runs the gate over the final tree.
  4. `docs/reference/changelog.md` `## [Unreleased]` (workers hand over bullet text) and `docs/architecture/generated/*`
     are **integrator-owned**. `server/API.md` is A2's. No phase edits `scripts/ci/backend-integration-groups.sh`
     (no new integration spec), `config/resource-lifecycle-callsites.json`, `scripts/quality/safety-catch-allowlist.json`
     (no new catch in a scanned root: A1 adds none; B3's `.catch` is in `services/sync`, outside the scan roots),
     `config/container-image-lock.json` (D-15.C6), or `LIZARD_WARNING_BASELINE` (C-Q3).
- **D-15.X5 e2e-helper sweep.** Each phase lists the `tests/e2e` helpers and specs that touch its behaviour, with the
  verdict. A helper that **waits for** a request or state the fix removes must be listed and edited by its phase, even
  when no mock map changes.

  | Phase | `tests/e2e` helpers/specs touching the behaviour | Verdict |
  |---|---|---|
  | A1 | none: the attempt ceiling is server-internal sync (`grep -rn "rejectedEvidence\|complexity_exceeded" tests/e2e` is empty) | n/a |
  | A2 | `create-wallet-flow.spec.ts:425` (`POST /wallets` dispatcher, `getCreateWalletMutationResponse`); `import-wallet-flow.spec.ts:269-272` and `render-regression/renderRegressionImportAuth.contracts.ts:36` (import) | The UI sends `signers` and never `descriptor` on create (`createWalletData.ts:286`); the mocks answer before any server logic; import is unchanged. No edit. |
  | B1 | `GET /bitcoin/fees` mocks: `fixtures/apiBaseline.ts:83`, `adminOperationsApiState.ts:148`, `node-status-card-responsive.spec.ts:153`, `error-recovery.spec.ts:189`, `send-transaction-flow.spec.ts:367-368`, `wallet-sharing-privacy.spec.ts:254-255`, `dashboard-price-blocks.spec.ts:206`, `settings-persistence.spec.ts:129`, `import-wallet-flow.spec.ts:229`, `create-wallet-flow.spec.ts:328`, `accessibility.spec.ts:190`; `render-regression/renderRegressionHarness.ts:561`; value/geometry assertions `dashboard-price-blocks.spec.ts:435-495`, `:499`, `:580`, `renderRegressionCore.contracts.ts:35`, `send-transaction-flow.spec.ts:729-732` | **Edit `renderRegressionHarness.ts:561` only** (D-15.B1c, phase b). The other mocks already carry `halfHour`; `dashboard-price-blocks.spec.ts:435-495` geometry must be **run** (18 · 12 · 8 instead of 18 · 8 · 3), not assumed. |
  | B2 | `grep -rln smtp tests/e2e` is empty; monitoring mocks `admin-drafts-smoke.spec.ts:144`, `adminOperationsApiState.ts:174`, `userJourneyApi.ts:443`, `render-regression/renderRegressionHarness.ts:638` (`MONITORING_SERVICES`, `:271-291`, `isCustomUrl: false`), `renderRegressionAdmin.contracts.ts:101` | The response shape is unchanged; the mocks return decoded URLs already. No edit. |
  | B3 | `grep -rli webhook tests/e2e` is empty | n/a |
  | C1 | none (`tests/install/{utils,e2e}` is the install harness, not Playwright) | n/a |
- **D-15.X6 architecture graphs.** `docs/architecture/generated` is regenerated once by the integrator in the
  integration worktree, which has a real root `npm ci` `node_modules` (never a symlink: the arch:check worktree-symlink
  artifact drops `shared/*` edges). Section text that says "in the primary checkout" means this no-symlink condition.
  Expected change: possibly none. A2 removes the file-level `services/wallet/walletCreate → services/bitcoin/descriptorParser`
  import (the collapsed `src/services` graph keeps its edge through other files); B3 adds
  `services/sync/confirmationUpdater → services/webhooks/confirmationDeliveries` (an internal `services → services`
  edge), D-15.B3h adds `services/webhooks/endpointService → services/sync/confirmationUpdater` for the exported
  `PENDING_CONFIRMATION_CANDIDATE_THRESHOLD` *(review pass 1, B-2)*, and B2 adds `services/adminMonitoringService →
  utils/safeJson` (an existing collapsed edge). Whatever
  `arch:graphs`/`arch:calls` produce is committed in the integrator commit.

### Phase file ownership (disjoint; one worktree and branch per phase)

| Phase | Production files | Test files | Other |
|---|---|---|---|
| a | **A1:** `server/src/services/bitcoin/sync/evidenceAuthentication.ts`. **A2:** `server/src/services/wallet/walletCreate.ts`, `server/src/api/openapi/schemas/wallet.ts` (one line), `server/API.md` | **A1:** new `server/tests/unit/services/bitcoin/sync/historyEvidenceAttemptCeiling.test.ts`, `server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts` (the two expected-label literals at `:424` and `:458` only, D-15.11; no line added or removed). **A2:** `server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts`, `server/tests/integration/flows/wallet/core-crud.contracts.ts`, `server/tests/integration/flows/wallet/groups-telegram.contracts.ts`, `server/tests/integration/flows/walletDescriptorAtomicity.integration.test.ts`, `server/tests/unit/api/openapi.wallet.contracts.ts` | **A2:** `scripts/perf/phase3-benchmark.mjs`, `scripts/perf/phase3-compose/large-wallet-history-proof.mjs`, `scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs` |
| b | **B1:** `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts`, `src/components/Dashboard/hooks/dashboardDataModel.ts`. **B2:** `server/src/utils/safeJson.ts`, `server/src/services/email/emailService.ts`, `server/src/services/email/emailVerificationService.ts`, `server/src/services/adminMonitoringService.ts` (D-15.B2e). **B3:** `server/src/services/webhooks/subscriptions.ts`, `server/src/services/webhooks/deliveryService.ts`, `server/src/services/webhooks/eventBuilder.ts`, new `server/src/services/webhooks/confirmationDeliveries.ts`, `server/src/services/sync/confirmationUpdater.ts`, `server/src/services/webhooks/endpointService.ts` (D-15.B3h) | **B1:** new `tests/components/send/formatFees.test.ts`, `tests/components/Dashboard/dashboardDataModel.test.ts`, `tests/components/Dashboard/useDashboardDataHarness.ts`, `tests/components/Dashboard/useDashboardData.networkIdentity.test.tsx`, `tests/components/send/SendTransactionPage.test.tsx`, `tests/components/send/SendTransactionPage.branches.test.tsx`, `tests/e2e/render-regression/renderRegressionHarness.ts` (`:561` mock values only). **B2:** new `server/tests/unit/services/email/emailService.storedSettings.test.ts`, `server/tests/unit/services/email/emailVerificationService.test.ts`, `server/tests/unit/utils/safeJson.test.ts`, `server/tests/unit/services/adminMonitoringService.test.ts`. **B3:** new `server/tests/unit/services/sync/confirmationUpdater.webhooks.test.ts`, new `server/tests/unit/services/webhooks/confirmationDeliveries.test.ts`, `server/tests/unit/services/webhooks/eventBuilder.test.ts`, `server/tests/unit/services/webhooks/webhookCore.test.ts`, `server/tests/unit/services/webhooks/endpointService.test.ts` | — |
| c | **C1:** `scripts/ci/check-supply-chain-locks.mjs`, `.github/workflows/podman-socket-canary.yml` (`:125` only), `tests/install/utils/helpers.sh` (`:543`, `:719` only), `tests/install/e2e/upgrade-install.test.sh` (`:2351` only) | **C1:** `tests/ci/check-supply-chain-locks.test.mjs` | — |

Integrator-owned: `docs/reference/changelog.md` (`## [Unreleased]`) and `docs/architecture/generated/*`. Read-only for
everyone: `config/wallet-safety-mutation-map.json`, every `server/stryker*.mjs` and `config/tooling/stryker*.mjs`,
`server/scripts/mutation/**`, `server/src/services/bitcoin/rawTransactionEvidence.ts`, `config/wallet-sync-*.json`,
`scripts/perf/wallet-sync-persistence-manifest.json` and every sealed replay file
(`scripts/perf/wallet-sync-persistence-driver*.cjs`, `wallet-sync-high-fanout-replay.mjs`),
`config/container-image-lock.json`, `scripts/quality/large-file-classification.json`, `scripts/quality/semgrep-baseline.json`,
`.github/workflows/quality.yml`, `scripts/quality.sh`, `install.sh`, `scripts/setup.sh`, `start.sh`. The `tests/e2e`
mock maps are read-only except B1's one harness line.

## Phase A — sync and wallet-creation fixes (A1, A2)

Both phases are server-only. Every file:line below was re-verified at `560e8f110e`
(`/home/nekoguntai/sanctuary-bug-scrub-20261013-i15`). Both fixes and their red tests were prototyped on a scratch
copy of that tree (`scratchpad/p15a`, `git archive HEAD` + symlinked `node_modules`, `npx prisma generate`, local
`shared/dist` build). The red results quoted below are observed, not predicted. Two exceptions: the integration
cases in A2 were not run, because there was no disposable Postgres. They are marked *expected red*; the integrator
records the A2 integration red on a guarded base swap (Verification, "Integrator step before the block").
*(review pass 1)* A reviewer re-ran every A red on base and green after the fix on `scratchpad/rpr15a`, including
the D-15.11 implementation the drafter had not prototyped.

Neither phase adds a Prisma migration, a repository method, a repository callsite in a sync-path file, a new
integration spec file, or an identifier the signer inventory sweeps (`finalize*`, `signPSBT`, `signPsbt`, `signWith`,
broadcast names: `scripts/generate-signer-inventory.mjs:467-477`). A1 touches `server/src/services/bitcoin/**` and
A2 touches `server/src/services/wallet/**` (`config/wallet-safety-critical-paths.json:11`, `:18`), so the PR runs the
verify-vectors workflow. Neither touched file is in `scripts/verify-addresses/sourceManifest.ts` (no hit for `sync/`,
`services/wallet`, `walletCreate`), so no vectors are regenerated. The phases touch disjoint files. They can ship in
one PR, one commit per finding.

Phase-local file ownership:

| Phase | Production files | Test files | Other |
|---|---|---|---|
| A1 | `server/src/services/bitcoin/sync/evidenceAuthentication.ts` | new `server/tests/unit/services/bitcoin/sync/historyEvidenceAttemptCeiling.test.ts` (≈150 lines); `server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts` (two label literals at `:424`, `:458`; D-15.11) | changelog bullet (integrator) |
| A2 | `server/src/services/wallet/walletCreate.ts`, `server/src/api/openapi/schemas/wallet.ts` (one line), `server/API.md` | `server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts`, `server/tests/integration/flows/wallet/core-crud.contracts.ts`, `server/tests/integration/flows/wallet/groups-telegram.contracts.ts`, `server/tests/integration/flows/walletDescriptorAtomicity.integration.test.ts`, `server/tests/unit/api/openapi.wallet.contracts.ts` | `scripts/perf/phase3-benchmark.mjs`, `scripts/perf/phase3-compose/large-wallet-history-proof.mjs`, `scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs`; changelog bullet (integrator) |

### Phase A1 — Charge the per-attempt evidence ceiling only for what an attempt keeps (P2 `wallet-sync--attempt-evidence-ceiling-counts-whole-history-permanent-failure`)

**Evidence (re-verified at 560e8f110e).**
- Every sync, including an incremental one, authenticates the whole current history and then every input's parent:
  - `phases/fetchHistories.ts:85-94` adds every history item to `allTxids`, then calls
    `authenticateHistoryResults(ctx, requestOptions)`.
  - `historyEvidenceAuthentication.ts:134-141` compacts every unique history txid
    (`fetchCompactAuthenticatedTransactions`). It then fetches the parent of **every** input
    (`parentOutpointRequests`, `:24-40`), with no filter to wallet-owned inputs.
- Each compact envelope is charged its full shape against one counter for the whole attempt:
  - Limits: `evidenceAuthentication.ts:37-42` (`MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT` 64 Mi,
    `…_INPUTS_PER_ATTEMPT` 100,000, `…_OUTPUTS_PER_ATTEMPT` 600,000, `…_SCRIPT_HEX_CHARS_PER_ATTEMPT` 64 Mi; per
    transaction 25,000 inputs and 25,000 outputs).
  - The counter: `complexityFor` (`:113-127`) seeds it once per context from every envelope (`:117-119`) and from
    legacy `txDetailsCache` entries (`:120-124`). `cacheCompactResult` adds each accepted envelope's complexity
    (`:198`). Nothing ever subtracts from it.
  - The checks: `remainingProjectionLimits` (`:129-140`) caps the projector at
    `min(per-transaction, attempt − used)`, and `rawHexFits` (`:142-145`) checks the raw hex.
  - The failure: a refused transaction is recorded as `transaction_complexity_exceeded` (`:187-188`, `:207-216`).
- A refused current transaction drops out of the history and fails the sync:
  - its history items are dropped, because `authenticateAddressHistory` keeps only accepted envelopes
    (`historyEvidenceAuthentication.ts:90-98`);
  - `receiveEvidenceGatePhase` (`phases/receiveEvidenceGate.ts:15-22`) then throws `ReceiveEvidenceRetryableError`;
  - the next attempt starts a fresh counter, recharges the same history and fails the same way.
- Which transactions get refused: addresses are loaded in index order (`repositories/addressRepository.ts:274`,
  `orderBy: [{ index: "asc" }, …]`), so the refused transactions are the ones on the highest-index addresses. Those
  are the newest deposits.
- How close a real wallet is: the RC9 production wallet carried 471,732 outputs over 169 transactions
  (`docs/plans/v0.8.69-release-gap-remediation-plan.md:440-441`). That is 79% of the 600,000-output ceiling.

**What is authenticated each sync, and why (the design this fix must keep).**
- **Authenticating the whole history on every attempt is deliberate.** The RC11 contract
  (`docs/plans/v0.8.69-release-gap-remediation-plan.md:571-608`) says: "Before database selection, authenticate
  every history transaction into a separate compact envelope", and "Release compact envelopes … after UTXO
  reconcile/insert".
- **Later phases rely on this round's authenticated set:**
  - Spend authority: `collectAuthenticatedSpentOutpoints` (`historyEvidenceAuthentication.ts:63-79`) builds
    `authenticatedSpentOutpointKeys` from every accepted current transaction. `reconcileUtxos.ts:86-93` restores a
    spent coin only when its spend is missing from this round's set, and `:155` marks a coin spent only from this
    round's set.
  - UTXO evidence: listed UTXOs are extracted from the same envelopes (`fetchUtxos.ts:183-186`), and existing UTXOs
    are matched against them (`reconcileUtxos.ts:54-66`).
  - Relevance: each history item must pay or spend the script it is listed under (`envelopePaysScript` /
    `envelopeSpendsScript`, `historyEvidenceAuthentication.ts:42-61`, `:94-97`).
- **The sealed replay encodes it.** `scripts/perf/wallet-sync-high-fanout-replay.mjs:177-179` fails with "Fresh-context
  compact authentication sets diverged" unless every pass, including the no-op third pass, compacts the same txid
  set.
- **What stays resident.** Envelopes live in `ctx.authenticatedTransactionEvidence` for the whole attempt. They are
  released only at `insertUtxos.ts:103-108` (`releaseAuthenticatedEvidence(ctx, 'attempt')`) or on pipeline
  failure (`pipeline.ts:244`).
  - `releaseAuthenticatedTransactionDetails` (`evidenceArchitectureReceipts.ts:129-143`) clears only the transient
    full-projection cache (`txDetailsCache`, one candidate batch (≤ 25) at a time: `processTransactionsPhase.ts:189`
    per candidate, `:209` per batch). It never releases envelopes. *(review pass 1, A-3)* The compact flow itself fills
    that cache: `resolveCandidateBatch` (`processTransactionsPhase.ts:292`) calls `fetchAuthenticatedTransactions`
    with a whole candidate batch (`TX_BATCH_SIZE = 25`, `:46`), which runs `projectFull` and sets `txDetailsCache`
    for every pending txid (`evidenceAuthentication.ts:349-365`).
  - An envelope (`transactionEvidenceProjection.ts:56-67`, built at `:187-208`) holds:
    - the canonical bytes (counted as `rawHexChars`, bytes × 2);
    - packed input outpoints, 36 bytes per non-coinbase input (`packNonCoinbaseInputs`, `:156-168`);
    - the **unique wallet-script indexes** it pays (`paidWalletScriptIndexes`, `:170-180`).
  - It holds **no decoded output**. Outputs are scanned once in the projector, bounded per transaction, and dropped.
- **What each ceiling actually bounds:**

  | Ceiling | What it bounds | Resident? |
  |---|---|---|
  | Raw hex 64 Mi | Canonical bytes, 32 MiB. The replay asserts `canonicalBytesHighWater ≤ 32 MiB` and `sourceRawHexCharsHighWater ≤ 64 MiB` (`wallet-sync-high-fanout-replay.mjs:171-174`, `:214-215`). | yes |
  | Inputs 100,000 | Packed outpoints plus the parent-request fan-out. | yes |
  | Script hex 64 Mi | Script bytes. These are a subset of the canonical bytes, so the raw-hex ceiling always binds first on the compact path. | inside raw |
  | Outputs 600,000 | An output **scan** count ("600,000-output-scan", plan `:583`). Compact envelopes keep none of these outputs. *(review pass 1, A-3)* Decoded outputs exist only in full projections of the current candidate batch, which are not charged separately (they have envelopes, so `complexityFor` skips them, `:120-123`). After A1 they are bounded by `TX_BATCH_SIZE` (25, `processTransactionsPhase.ts:46`) × 25,000 = 625,000 at the batch peak (`:292` → `evidenceAuthentication.ts:349-365`), and by legacy `txDetailsCache` entries (`addLegacyDetailsComplexity`, `:100-111`), which the counter still charges. `confirmations/fetchHelpers.ts:127` writes its own local map. | no, for compact envelopes; the current batch's full projections are bounded by batch size × the per-transaction limit |

**Root cause.** A non-resident scan counter (outputs) sits next to the resident counters in the per-attempt
budget. It is charged with the whole re-authenticated history on every sync. The output ceiling is the one that
binds first for batch-payout wallets, at about 600,000 outputs. That is well below the 32 MiB resident bound it was
meant to sit beside (≈1.08 M P2WPKH outputs, see D-15.2). Once a history crosses it, no attempt can succeed.

**Decisions.**
- **D-15.1 options considered.**
  - (a) *Charge per evidence batch and release with the batch* (the brief's suggestion via
    `releaseAuthenticatedTransactionDetails`). **Rejected.** That function never releases envelopes, and envelopes
    must stay resident until `insertUtxos` for spend detection, UTXO extraction and candidate full projection.
    Releasing the canonical-byte charge per batch would break the 32 MiB resident bound the replay asserts.
  - (b) *Skip re-authenticating txids already stored with unchanged height.* **Rejected.** It breaks the RC11
    "authenticate every history transaction" contract and the replay's per-pass compact-set equality
    (`wallet-sync-high-fanout-replay.mjs:177-179`). It would also need database stand-ins in three funds-relevant
    consumers (relevance, `authenticatedSpentOutpointKeys`, `evidenceMatchesExistingUtxo`). And it would not help
    the trigger wallet: a receive-heavy wallet's old transactions still carry unspent UTXOs, so `fetchUtxos.ts:183`
    compacts them again.
  - (c) *Page or resume the attempt.* **Rejected for this phase.** It needs a windowed redesign of history
    authentication, reconcile and the replay. See OQ-A1.
  - (d) **Chosen: charge each attempt ceiling only for state the attempt keeps.** Compact envelopes are charged
    their raw hex, inputs and script hex as now, but **zero outputs**. Legacy decoded details keep their full
    output charge. This keeps the security property: every history transaction is still raw-authenticated on every
    attempt, and no evidence path changes. It keeps the memory bound: raw hex (32 MiB of canonical bytes) and
    inputs stay cumulative, and the per-transaction 25,000-input, 25,000-output and 4,000,000 WU limits are
    unchanged (`rawTransactionEvidence.ts:14`). It keeps the work bound: every scanned output lies inside canonical
    bytes that the raw-hex ceiling caps (an output is at least 9 bytes, so at most ≈3.7 M outputs per attempt), and
    the stage budget still caps time.
- **D-15.2 effect, stated honestly.** The binding limit moves from 600,000 outputs to the 64 Mi raw-hex ceiling.
  - For P2WPKH batch outputs (31 bytes = 62 hex chars each) that is ≈1.08 M outputs.
  - The RC9 shape (471,732 × 62 ≈ 29.2 M chars) falls from 79% of the binding ceiling to about 44%.
  - This estimate ignores foreign parents. Their canonical bytes also count, and they can be large for exchange
    payouts.
  - *(review pass 1, A-3)* Decoded outputs held at once: on base the current candidate batch's full projections were
    bounded indirectly by the envelope output charge (at most 600,000 in total); after A1 they are bounded by
    `TX_BATCH_SIZE × MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION` = 25 × 25,000 = 625,000 at the batch peak. That is a
    small increase, released per candidate and per batch (`processTransactionsPhase.ts:189`, `:209`).
  - A wallet whose retained history plus parents exceeds 32 MiB, or whose current-plus-parent inputs exceed
    100,000, still fails permanently. Whether to accept that, raise it, or redesign is OQ-A1. *(coordinator, at assembly)* OQ-A1 is
    DECIDED: that failure is reported under its own reason (D-15.11) and the redesign is the P3 follow-up
    `wallet-sync--retained-evidence-capacity-limit-design`.
- **D-15.3 no rename.** Keep `MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT` (tests import it) and add the JSDoc
  *(review pass 1, A-3)*: "Bounds decoded outputs charged to the attempt (legacy detail entries). Compact envelopes
  retain none; the current batch's full projections are bounded by the candidate batch size × the per-transaction
  output limit."
- **D-15.4 no change** to the existing reason codes (other than the one D-15.11 adds), the receive-evidence gate,
  parent fetching, release points or the per-transaction limits. *(coordinator, at assembly)* Narrowing parent fetches to parents already in the current set was considered and left
  to OQ-A1. It changes the replay's compact set and the RC11 parent contract.

- **D-15.11 a distinct, surfaced reason for the remaining capacity limit** *(coordinator, at assembly)* (OQ-A1).
  - **Label.** Export `ATTEMPT_EVIDENCE_CAPACITY_EXCEEDED = 'attempt_evidence_capacity_exceeded'` (36 characters, under
    `MAX_REASON_LABEL_LENGTH` 48, `rejectedEvidence.ts`) from `evidenceAuthentication.ts`. It is a plain string passed
    to `recordFailClosed`; `RawTransactionEvidenceError`'s reason union and messages in `rawTransactionEvidence.ts`
    are **not** edited (that file is a tier-1 mutation surface, `stryker.receive-evidence.config.mjs`).
  - **When.** Inside `cacheCompactResult`, a refusal is relabelled from `transaction_complexity_exceeded` to the
    capacity label when the *attempt* remainder, not a per-transaction limit, was the binding one. A new top-level
    helper `complexityRefusalReason(complexity, details, rawHexRefused)` decides it, so `cacheCompactResult` (CCN 8)
    gains at most one branch and `fetchCompactWithProjector` (a base lizard warning) is not touched:
    - *(review pass 1, A-2)* the raw-hex attempt check refused **and the transaction alone fits a fresh attempt**
      (`authenticatedRawHexChars(details) <= MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT`) → capacity. A single
      transaction over the attempt ceiling keeps `transaction_complexity_exceeded` (a remote result longer than 64 Mi
      hex chars is a per-transaction impossibility — 4,000,000 WU caps a real transaction at about 8 Mi hex chars — and
      must not fire the capacity `error` log; guard test 5);
    - the projector refused with `transaction_complexity_exceeded` and either `MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT −
      used.inputs < MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION`, or `MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT −
      used.outputs < MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION` (only legacy decoded entries still charge outputs), or
      the script-hex remainder is below the transaction's own raw-hex length (a transaction's script bytes are a
      subset of its canonical bytes) → capacity. *(review pass 2, A-2)* These inputs, outputs and script-hex arms
      are evaluated **only when `!rawHexRefused`** (`rawHexRefused ? fitsFresh : inputs || outputs || script`).
      Putting the raw-hex "fits a fresh attempt" guard into one OR chain with them is wrong: on test 5 the
      script-hex arm then fires (`MAX_SCRIPT − 0` is below the transaction's own `MAX_RAW + 2` hex length) and
      relabels it capacity (reviewer probe: 1 failed | 4 passed);
    - every other refusal keeps its current label. A fresh context (every remainder at or above the per-transaction
      limit) therefore never produces the new label: the sealed replay driver's boundary fixtures
      (`wallet-sync-persistence-driver.cjs:747`, fresh `contextFor(...)` per case) keep reading
      `transaction_complexity_exceeded` and no seal changes.
    - Accepted labelling edge *(review pass 1, A-2, reworded)*: the label means 'an attempt remainder was already
      below a per-transaction bound when this transaction was refused'. A refusal actually caused by this
      transaction's own output count or weight can then also read capacity (every projector refusal shares
      `transaction_complexity_exceeded`, `rawTransactionEvidence.ts:203`, `:215`, `:276`,
      `transactionEvidenceProjection.ts:157`, `:329`, so the helper cannot tell weight from count). Both are permanent
      for that attempt.
  - **Surfaced, not silent.** The label reaches `wallets.lastSyncError` through the existing
    `receiveEvidenceGatePhase` → `summariseRejectedEvidence` path (no gate change) and the wallet header's sync-failure
    banner shows it. The first capacity refusal of an attempt also logs once at `error` (a module-level
    `WeakSet<SyncContext>`, no new catch): `'[SYNC] Wallet history exceeds the per-attempt authenticated evidence
    capacity'` with `{ walletId: ctx.walletId, rawHexChars, inputs, scriptHexChars }` of the used counters (no
    transaction data). Retry cadence and backoff are unchanged; stopping retries is part of the P3 design follow-up.

**Production change** (`server/src/services/bitcoin/sync/evidenceAuthentication.ts`, +11/−2 prototyped for D-15.1;
D-15.11 adds the label constant, `complexityRefusalReason`, the once-per-attempt error log and their two call sites,
about 30 more lines, not prototyped):
```ts
/**
 * A compact envelope keeps its canonical bytes, packed input outpoints and the
 * indexes of wallet scripts it pays, never a decoded output. Its outputs were
 * scanned once by the projector (bounded per transaction) and are not resident,
 * so they are not charged to the attempt's retained-output ceiling.
 */
const retainedEnvelopeComplexity = (
  complexity: TransactionEvidenceComplexity,
): TransactionEvidenceComplexity => ({ ...complexity, outputs: 0 });
```
Use it at `:118` (`addComplexity(initialized, retainedEnvelopeComplexity(envelope.complexity))`) and `:198` (same).
The envelope's own `complexity` stays unchanged, because sealed re-projection compares it byte-for-byte
(`transactionEvidenceProjection.ts:217-219`). Also add the JSDoc on `:39` from D-15.3.

**Failing-first tests.** New file `server/tests/unit/services/bitcoin/sync/historyEvidenceAttemptCeiling.test.ts`
(≈150 lines).
- The existing `receiveEvidenceAuthentication.test.ts` is already 1,216 lines. It is a classified proof harness
  (`scripts/quality/large-file-classification.json:146-151`), so it is not extended.
- The new file mocks `transactionEvidenceThread` with an in-process compact projector, the same pattern as
  `receiveEvidenceAuthentication.test.ts:46-127` trimmed to `projectCompact`/`projectFull`/`extractOutputs`/`close`.
- Fixtures: a single testnet P2WPKH wallet address and a `batchPayout(ordinal, outputCount)` builder. It builds a
  coinbase input (no parent requests), `outputCount − 1` one-byte `OP_TRUE` outputs and one wallet output.
  1. `it('authenticates a whole history whose summed outputs exceed the output-scan ceiling while its retained bytes fit')`
     - Setup: `floor(600,000 / 25,000) + 1 = 25` payouts of 25,000 outputs each (625,000 outputs, ≈12.6 M hex
       chars, under 64 Mi), listed under the wallet address, then `authenticateHistoryResults(ctx)`.
     - Assert: `rejectedEvidenceReasons` is empty; `allTxids` holds all 25; summed envelope outputs exceed
       `MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT`; summed canonical hex is below
       `MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT`; `receiveEvidenceGatePhase(ctx)` resolves.
     - Timeout 60 s (observed ≈1 s).
     - **Observed red on base:** `expected Map{ "transaction_complexity_exceeded" => 1 } to deeply equal Map{}`. The
       25th payout is refused once 24 × 25,000 = 600,000 outputs are charged.
  2. `it('still refuses one transaction beyond the per-transaction output limit')` (guard)
     - Setup: a single payout with 25,001 outputs, passed to `fetchCompactAuthenticatedTransactions`.
     - Assert: it resolves to an empty set, no envelope is stored, and the reasons are
       `{transaction_complexity_exceeded: 1}`.
     - Observed green on base and after.
  3. `it('reports the attempt capacity limit once retained canonical bytes reach the attempt ceiling')`
     *(coordinator, at assembly)* (was a green guard; now a red test for D-15.11; *review pass 1, A-1*: one
     specification, two payouts)
     - Setup: mock `../../../../../src/utils/logger` (`vi.hoisted` logger with `error: vi.fn()`, the
       `gapLimitPhase.test.ts:15-22` pattern). Seed one envelope whose `complexity.rawHexChars = MAX_RAW −
       next.hex.length + 1` and whose outputs are 0. Then request two small payouts in one
       `fetchCompactAuthenticatedTransactions` call.
     - Assert: both are refused; the reasons are `{attempt_evidence_capacity_exceeded: 2}`; `log.error` is called
       exactly once with a message containing `per-attempt authenticated evidence capacity` and
       `objectContaining({ walletId })`; and `receiveEvidenceGatePhase(ctx)` rejects with
       `attempt_evidence_capacity_exceeded x 2`.
     - **Observed red on base** (reviewer, `scratchpad/rpr15-a1-red.txt`): the reasons `toEqual` assertion, diff
       `-   "attempt_evidence_capacity_exceeded" => 2,` / `+   "transaction_complexity_exceeded" => 2,` (accepted red,
       D-15.X3). With the fix it passes with one `log.error` call and the gate message `… x 2`.
  4. `it('keeps the per-transaction label when the attempt remainder is not binding')` *(coordinator, at assembly)* (guard): on
     a context that already holds one small envelope, a single payout with 25,001 outputs is still refused as
     `transaction_complexity_exceeded`. Green on base and after.
  5. `it('keeps the per-transaction label for one raw transaction larger than the whole attempt')` *(review pass 1,
     A-2)* (guard): a fresh context, details `hex: { length: MAX_RAW + 2 } as string`; the reasons are
     `{transaction_complexity_exceeded: 1}` and `log.error` is not called. Green on base; it fails after a naive
     D-15.11 (the reviewer's probe read `+ "attempt_evidence_capacity_exceeded" => 1`) and passes with the D-15.11
     raw-hex guard **and** the projector arms gated on `!rawHexRefused` *(review pass 2, A-2)*; the guard alone,
     inside one OR chain with the projector arms, still fails it (the script-hex arm fires).

Confirm red: `cd server && npx vitest run tests/unit/services/bitcoin/sync/historyEvidenceAttemptCeiling.test.ts`
(observed on the draft tests: 1 failed | 2 passed; log `scratchpad/i15-a1-red.txt`). *(coordinator, at assembly; review
pass 1)* With the D-15.11 tests the expected base result is **2 failed | 3 passed** (tests 1 and 3 red; 2, 4 and 5
green). The reviewer observed tests 1–4 on base as 2 failed | 2 passed and 4/4 green after the fix.

**Existing tests that encode the old behaviour.** *(coordinator, at assembly)* Two assertions change with D-15.11, in the A1 commit,
red-first: `receiveEvidenceAuthentication.test.ts:424` (the outputs test at `:406-427`) and `:458` (the shared
`it.each` at `:429-460` for raw hex, inputs and scripts). Each seeds a legacy entry that saturates one attempt
counter, so the refusal is attempt-bound: replace the literal `'transaction_complexity_exceeded'` with
`'attempt_evidence_capacity_exceeded'` on those two lines only (no line added or removed; the file is a classified
1,216-line proof harness, `large-file-classification.json:146-151`, whose `reviewWhenTouched` flag is informational
and not edited). Red on base for all four cases (accepted, D-15.X3; observed by the reviewer: the reasons `toEqual`
assertion, diff `-   "attempt_evidence_capacity_exceeded" => 1,` / `+   "transaction_complexity_exceeded" => 1,`). The projector-level assertions at `:301`
and `:321` (direct `RawTransactionEvidenceError` throws) and `rawTransactionEvidence.test.ts` are unchanged. The
drafted notes below hold for everything else:
- `receiveEvidenceAuthentication.test.ts:406-427` ("fails closed before retaining evidence beyond the attempt output
  ceiling") seeds a **legacy** `txDetailsCache` entry with 600,000 decoded outputs. That entry is still charged, so
  the test still refuses (D-15.1); only its expected label changes (D-15.11).
- `:429-460` (raw hex, inputs and scripts via legacy entries) still refuses; only its expected label changes.
- Observed with the fix applied: `npx vitest run tests/unit/services/bitcoin/sync` gave 29 files and 484 tests
  green. `tests/unit/services/bitcoin tests/unit/worker` gave 6,066 green, with 1 unrelated failure
  (`hardwareSignedEvidenceProvenance` needs a git checkout; the scratch copy has none).
- No integration or e2e test asserts the attempt output ceiling (`grep -rn OUTPUTS_PER_ATTEMPT` has hits only in the
  source, this unit file and the v0.8.69 plan).

**Pin / inventory / seal impact (checked at 560e8f110e).**
- `config/wallet-safety-mutation-map.json`, `server/stryker.*.config.mjs`, `server/scripts/mutation/shards.mjs`:
  **no**. `stryker.receive-evidence.config.mjs` mutates only `rawTransactionEvidence.ts`, and no map entry or shard
  names `evidenceAuthentication.ts`.
- `config/wallet-sync-mutation-boundaries.json`: **no**. `services/bitcoin/sync/**` is in scope (`:5`), but A1 adds
  no repository call. `check:wallet-sync-mutation-boundaries` passed on the prototype (48 callsites).
- `config/wallet-sync-lifecycle-contract.json`: **no** entry for the file. `check:wallet-sync-lifecycle-contract`
  passed on the prototype.
- Replay sealed digests (`scripts/perf/wallet-sync-persistence-manifest.json:3-7`, driver, helper, fixture builder,
  migration tree): **no**. No sealed file is edited.
  - The driver loads the compiled module and reads only `MAX_AUTHENTICATED_*_PER_TRANSACTION`
    (`wallet-sync-persistence-driver.cjs:834-835`). Those are unchanged.
  - *(coordinator, at assembly)* The driver's `assertRejectedBoundary` (`:738-757`) counts
    `rejectedEvidenceReasons.get('transaction_complexity_exceeded')` on a fresh context per boundary fixture; under
    D-15.11 a fresh context never yields the capacity label, so it still counts 1. The Verification block asserts the
    driver line is unchanged.
  - Live-shape receipts are unaffected: 471,732 outputs were under the old ceiling, the canonical-byte high water is
    unchanged, and the per-pass compact set is unchanged.
  - The max-shape fixtures are single transactions at or under the per-transaction limits. They behaved identically
    before, because a single transaction's remaining attempt budget was never below 25,000.
  - The live replay runs only at release-candidate time; the RC that carries this phase re-runs it.
- Signer inventory: **no**. `verify:signer-inventory` reports "projection is current" on the prototype.
- `check:safety-catch-guards`: passed (no catch added). Large files: the new file is ≈150 lines.

**Verification.** `cd server && npx tsc --noEmit && npm run typecheck:tests`, the confirm command (green),
`npx vitest run tests/unit/services/bitcoin/sync`, and `npx vitest run --coverage tests/unit` (integrator). Both
call sites of the helper are covered by test 1 (`:198`) and by any seeded-envelope test (`:118`, test 3). *(coordinator,
at assembly)* `complexityRefusalReason`'s arms (D-15.11) are covered by test 3 (raw hex), test 5 (raw hex refused
but the transaction alone exceeds the attempt), the relabelled `receiveEvidenceAuthentication.test.ts` cases (outputs,
inputs, scripts; legacy entries), and tests 2 and 4 (no binding remainder → unchanged label); test 3's second payout
covers the once-per-attempt log's "already logged" arm. The reviewer measured 100% statements, branches, functions
and lines for `evidenceAuthentication.ts` from the sync suite.

**Acceptance.**
- A history whose summed outputs exceed 600,000 authenticates completely and passes the receive-evidence gate when
  its retained canonical bytes and inputs fit the attempt.
- *(coordinator, at assembly)* A history that does not fit the attempt's raw-hex, input or script-hex capacity fails with
  `attempt_evidence_capacity_exceeded` in `lastSyncError` and one error log per attempt (D-15.11); a transaction over
  a per-transaction limit on an otherwise unloaded attempt, including one raw transaction larger than the whole
  attempt's raw-hex ceiling (test 5), still reports `transaction_complexity_exceeded` and logs no capacity error.
- Per-transaction limits and the raw-hex and input attempt ceilings refuse exactly as before.
- Envelope `complexity` values and every replay receipt are unchanged.

**Rollback.** Revert the commit. No data or schema step. Wallets above 600,000 history outputs go back to failing
every sync.

### Phase A2 — Refuse signerless descriptor wallet creation and point to import (P2 `create-wallet--descriptor-only-wallet-unspendable`)

**Evidence (re-verified at 560e8f110e).** The finding's line numbers (`walletCreate.ts ~354-375, ~499-523`) are
stale; the file is 303 lines.
- **Create accepts it:**
  - `CreateWalletBodySchema` (`api/wallets/crud.ts:60-71`) makes both `descriptor` and `signers` optional, and the
    route forwards both (`:167-193`).
  - `createWallet` (`services/wallet/walletCreate.ts:241-303`) resolves zero bindings when `signers` is absent
    (`:251-253`).
  - `buildWalletDescriptorPolicy` (`:122-147`) then builds an `imported` policy from the bare descriptor
    (`:133-146`). `createWithDeviceLinks` (`:271-295`) persists it with `[]` signer links and 2 × 20 initial
    addresses, so receive addresses are handed out.
- **It can never spend:**
  - Every spend entry point first calls `assertWalletHardwareCapabilityById(walletId, 'sign')`:
    `api/transactions/drafting.ts:118`, `:213`, `:310`; `api/bitcoin/transactions.ts:184`, `:250`, `:309`. For a
    wallet with zero devices, `assertWalletHardwareCapability` throws "no signer provenance is linked to this wallet"
    (`services/hardwareWalletCapabilities.ts:127-131`).
  - Below that gate, `psbtConstruction.ts:165` ("immutable signer snapshot is missing") and
    `psbtAccountBinding.ts:88-89` ("signer count does not match the descriptor pair") also refuse.
- **It cannot be repaired:** `addDeviceToWallet` throws once a descriptor is set (`walletDevices.ts:178-180`).
  `repairWalletDescriptor` is retired (`:218-227`). The recovery design names this population as fail-closed
  `signer.binding_ambiguous`, and its honest answer is export and re-import
  (`docs/plans/legacy-wallet-descriptor-policy-recovery.md:301`).
- **It also gets no gap-limit growth:** `display` is refused for zero devices, so sync skips gap expansion
  (`services/bitcoin/sync/addressDiscovery.ts:88-95`).
- **Import is the existing path for the same input:**
  - `descriptorImport.ts:44` runs `checkDuplicateWallet`, which create skips.
  - `resolveDevices` reuses the caller's existing device by fingerprint (`walletImport/deviceResolution.ts:63-80`).
    Otherwise it creates a `watch_only` device (`:87-89`; `walletImportService.ts:134-181`, type at `:146`).
  - Every key gets a signer link.
  - Correction to the finding: a *freshly created* `watch_only` signer is itself allowed only `import`
    (`hardwareWalletCapabilities.ts:37-38`), so it does not spend today either. But an import that reuses a
    registered hardware device is bound to it and spends when that device's capability row allows. A
    descriptor-only create never binds anything and can never get there.
- **Reachability:**
  - The web UI never sends `descriptor` on create: `src/components/CreateWallet/createWalletData.ts:286` sends
    `signers`, and `src/api/wallets.ts:142` is the only caller.
  - API clients can send it: OpenAPI `CreateWalletRequest` (`api/openapi/schemas/wallet.ts:111-131`) documents
    `descriptor` without semantics, and `server/API.md:181` lists `"descriptor": "string (optional)"`.
  - Three operator perf scripts use it as a receive-only fixture: `scripts/perf/phase3-benchmark.mjs:349-361`,
    `scripts/perf/phase3-compose/large-wallet-history-proof.mjs:102-111` and
    `scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs:133-142`. They are operator-run
    (`npm run perf:phase3[:compose-smoke]`, `docs/reference/release-gates.md:65`), not CI.

**Root cause.** Create kept a signerless "imported descriptor" branch that import superseded. Import materializes
signer links and runs the duplicate check; create's branch produces a wallet with no signer provenance. Every spend
path, and the remediation flow, require that provenance.

**Decisions.**
- **D-15.5 refuse, do not materialize.**
  - Mirroring import inside create is rejected. `walletImportService.ts` already imports `../wallet/*` (`:42-53`).
    Calling it from `services/wallet/walletCreate.ts` adds a `wallet ↔ walletImport` cycle, which
    `check:server-cycle-baseline` would flag. The alternative is duplicating device materialization (≈80 lines,
    `walletImportService.ts:134-191`) and the duplicate check.
  - Import already is the canonical descriptor path, and it is the remedy the recovery design prescribes.
  - This is not left open: the UI never used the branch, and the resulting wallets are a documented fail-closed
    population.
- **D-15.6 where.** Throw in `buildWalletDescriptorPolicy` when `bindings.length === 0 && input.descriptor`.
  - This runs after `requireWalletGroupMembership` (`:246`) and `loadWalletDevices`, so the existing 403 group
    tests keep their status.
  - Error: `InvalidInputError` (400, `INVALID_INPUT`) with exported
    `DESCRIPTOR_ONLY_CREATE_MESSAGE = "Creating a wallet from a descriptor alone is not supported. Import the descriptor with POST /api/v1/wallets/import, or create the wallet from its signers."`.
    The name is deliberately not `sign*` or `finalize*`. *(review pass 1, A-8)* The prototype patch
    `i15-a2-src.patch` names it `SIGNERLESS_DESCRIPTOR_CREATE_MESSAGE`; use the plan's name,
    `DESCRIPTOR_ONLY_CREATE_MESSAGE`, everywhere.
  - `validateWalletInput`'s change-without-receive check (`:60-62`) stays. It is still reachable and fires first.
- **D-15.7 delete the now-dead branch:** `assertDescriptorMatchesWalletInput` (`:180-201`),
  `descriptorNetworkMatchesWallet` (`:169-178`), the `parseDescriptorForImport` import (`:14`) and
  `descriptorPolicyFingerprint` (`:35`). The `bindings.length === 0` branch keeps only the
  `{ policy: undefined, fingerprint: input.fingerprint }` return, which is the "add signers later" path
  `addDeviceToWallet` completes. Prototype diff: walletCreate.ts −60/+12.
- **D-15.8 contract, not schema.**
  - Keep `descriptor`/`changeDescriptor` in the Zod schema and OpenAPI, because a client sending them *with*
    signers is unaffected; with signers they are ignored as today.
  - Add one line in OpenAPI (`wallet.ts:120`) *(review pass 1, A-8: the descriptor is ignored whenever signers are
    given, `buildWalletDescriptorPolicy`, `walletCreate.ts:149-166`, so "Requires signers" was misleading)*:
    `descriptor: { type: 'string', description: 'Ignored when signers are given; a descriptor without signers is refused (400). To add a wallet from a descriptor use POST /wallets/import.' },`.
    It stays on one line, so the file remains 997 lines and under the large-file limit.
  - Same wording in `server/API.md:181`: `"descriptor": "string (optional; ignored when signers are given; a
    descriptor without signers is refused (400). To add a wallet from a descriptor use POST /wallets/import.)"`.
  - Changelog `### Changed`: "`POST /api/v1/wallets` with a descriptor and no signers now returns 400; import
    descriptor-only wallets with `POST /api/v1/wallets/import`, which links their signers." *(coordinator, at assembly)* The bullet
    also states the known limitation of D-15.9: "Wallets already created from a descriptor alone are not repaired;
    they keep receiving but cannot spend, and the remedy is export and re-import."
- **D-15.9 existing descriptor-only wallets.** No data repair is authorized and none is made. They keep receiving
  and syncing on their initial 20 + 20 addresses (gap expansion is already skipped). Spending stays refused at the
  `sign` capability gate, exactly as today. Recovery remains export and re-import
  (`legacy-wallet-descriptor-policy-recovery.md:301`). This phase neither improves nor worsens them.
- **D-15.10 perf fixtures.** Switch the three scripts to `POST /api/v1/wallets/import` with
  `{ data: <descriptor>, name, network }` (`api/wallets/import.ts:44-67`). Read `response.wallet.id` and `.name`
  (`ImportWalletResult`, `walletImport/types.ts:53-65`).
  - `backend-scale-out.mjs` has a Semgrep baseline pin at line 24 (`scripts/quality/semgrep-baseline.json:47-50`,
    content sha). The edit is at `:133-147`, below it, and must not change line count above line 24.
  - Run `node --check` on all three. A live run is optional (operator proof).
  - *(review pass 1, A-6)* **Network.** All three scripts send `network: 'testnet'` today
    (`phase3-benchmark.mjs:48` default, `large-wallet-history-proof.mjs:109`, `backend-scale-out.mjs:140`), which both
    create and import refuse (`z.enum(BITCOIN_NETWORKS)`, `shared/constants/bitcoin.ts:9`: `mainnet`, `testnet3`,
    `testnet4`, `signet`, `regtest`), so they already 400 on base. Send `network: 'testnet3'`: change the
    `phase3-benchmark.mjs:48` default to `'testnet3'`; the two compose scripts use the literal (and the
    `large-wallet-history-proof.mjs:121` result fallback becomes `'testnet3'`).
  - **409 on the first compose run, and on reruns** *(review pass 2, A-1)*. Import runs `checkDuplicateWallet` per
    user by script type and key origins, not by name or network (`walletImport/deviceResolution.ts:119-142`). The
    compose smoke first runs `perf:phase3` with `SANCTUARY_BENCHMARK_PROVISION=true`, which provisions
    `Phase 3 Compose Benchmark Wallet` (`phase3-compose/config.mjs:301`) as the same `admin` user with the same
    native-segwit origin `[aabbccdd/84'/1'/0']` (`phase3-benchmark.mjs:330-361`). Only then does it run the
    large-wallet proof and the backend scale-out proof (`phase3-compose-benchmark-smoke.mjs:285-310`), so **both
    proofs already get 409 on a fresh stack**, not only on a rerun. A direct `perf:phase3` run (default name
    `Phase 3 Benchmark Wallet`, `phase3-benchmark.mjs:47`) also gets 409 when a wallet with the other default name
    exists, which its name-only pre-check misses.
    - Accept `[201, 409]` in all three scripts (in `phase3-benchmark.mjs`, after its existing name-based pre-check,
      which stays).
    - On 409, take the existing wallet's name from the response `message`. The server text is exactly
      `A wallet with these devices already exists: "<name>"` (`walletImport/deviceResolution.ts:139`, a
      `ConflictError`; `ApiError.toResponse` carries `message`, `server/src/errors/ApiError.ts:120-124`). Parse it with
      string operations, not a regex: require `message.startsWith('A wallet with these devices already exists: "')`
      and `message.endsWith('"')`, and take the text between the first and the last `"`. This keeps the code free of
      backslashes, because `backend-scale-out.mjs` holds its proof script inside a template literal
      (`getBackendScaleOutProofConfigScript`, `:1`).
    - Reuse the id of the `GET /api/v1/wallets` entry whose `name` equals the parsed name exactly. If the message does
      not parse or no entry matches, fail with an error that quotes the 409 message.
    - Do **not** match on `descriptor` or `fingerprint`: the list returns both as `null`, because
      `redactDerivationMaterial` needs the `display` capability (`walletQueries.ts:22-35`, `:103-104`), which no
      wallet type is granted (`hardwareWalletCapabilities.ts:30-90`).
    - **Verification (lightest verifiable form; no test location covers `scripts/perf`).** `node --check` on all
      three files. The outer `node --check` of `backend-scale-out.mjs` does not parse the proof script embedded in its
      template literals, so the generated script (`getBackendScaleOutProofScript()`, run by the harness as
      `node --input-type=module --eval`, `backend-scale-out-proof.mjs:48-49`) is also written to a temp `.mjs` file and
      `node --check`ed (prototyped on base: passes). A grep gate then fails if the server text drifts or a script
      lacks the parse or the 409 acceptance. Both are in the Verification block.
  - All edits to `backend-scale-out.mjs` stay below line 24 (the Semgrep pin).

**Production change.** `walletCreate.ts` per D-15.6/D-15.7 (prototyped; diff `scratchpad/i15-a2-src.patch`), plus
the OpenAPI and API.md lines.

**Failing-first tests.**
1. Unit: `server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts` (612 lines now, ≈506
   after). It runs through `tests/unit/services/wallet.test.ts`. Insert after `:57-64`:
   - Test: `it.each([["single-sig", {single_sig, native_segwit, VALID_RECEIVE/CHANGE}], ["multisig", {multi_sig, quorum 2, totalSigners 2, MULTISIG_RECEIVE/CHANGE}]])('refuses a signerless %s descriptor wallet and points at descriptor import')`.
   - Setup: `mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({ id: 'wallet-signerless', …, devices: [], addresses: [] })`.
     On base this lets the create *resolve* rather than die on a harness TypeError, so the red shows the real
     behaviour. The harness `mockReset`s Prisma mocks per test (`walletTestHarness.ts:126-155`, `:378`), so the
     once-value cannot leak.
   - Assert: `rejects.toMatchObject({ name: 'InvalidInputError', message: expect.stringContaining('POST /api/v1/wallets/import') })`.
     `walletRepository.createWithDeviceLinks` and `mockWakeInitialWalletSync` are not called.
   - **Observed red on base** *(review pass 1, A-4: exact vitest text, `scratchpad/rpr15-a2-red.txt`)*: both rows
     fail at the `.rejects.toMatchObject` line with `AssertionError: promise resolved "{ id: 'wallet-signerless', …(7)
     }" instead of rejecting` (diff: `- Error { "message": "rejected promise" }` against the created wallet,
     `deviceCount: 0`).
   - Confirm: `cd server && npx vitest run tests/unit/services/wallet.test.ts -t "signerless"` (log
     `scratchpad/i15-a2-red.txt`).
2. Integration (*expected red*; not run by the worker, who has no disposable database and may not run integration
   specs; *review pass 1, A-5*: the integrator records the red on a guarded base swap of `walletCreate.ts`,
   Verification, "Integrator step before the block"):
   `server/tests/integration/flows/wallet/core-crud.contracts.ts`. Replace `:26-51`
   ("should create a single-sig native segwit wallet") with
   `it('refuses a signerless descriptor wallet and points at descriptor import')`.
   - Request: POST the same body. Assert `400`, `response.body.code === 'INVALID_INPUT'`, the message contains the
     literal `/api/v1/wallets/import` (do **not** import `DESCRIPTOR_ONLY_CREATE_MESSAGE`: the base swap removes that
     export), and `prisma.wallet.count({ where: { name } }) === 0`.
   - Red on base: `expected 400 "Bad Request", got 201 "Created"` (supertest's text; A-4).

**Existing tests that encode the old behaviour (all change in the fix commit).**
- Unit, `create-account-selection.validation.contracts.ts` (11 failures observed on the prototype before migrating;
  the 11th is collateral, see below):
  - `:297-315` "propagates atomic wallet policy persistence failures": switch the input to a signer.
    - Add a local `singleSigSignerInput()` helper before `describe("Validation")`. It queues
      `mockBuildDescriptorFromDevices` (VALID_RECEIVE/CHANGE, `abc12345`) and `device.findMany` with
      `createMockDevice('device-1', 'abc12345', [BIP84 account])`, and returns
      `{ type, scriptType, signers: [{ deviceId: 'device-1', deviceAccountId: 'device-1-account-0', signerIndex: 0 }] }`.
      This is the same setup as `:176-200`.
    - Without this migration its unconsumed `createWithDeviceLinks.mockRejectedValueOnce` leaks into `:418`
      ("creates wallet without device links"). That is the 11th failure.
  - `:317-400` (6 `it.each` rows, "rejects descriptor identity that contradicts the requested %s") and `:402-416`
    ("rejects a caller fingerprint that contradicts descriptor origins"): **delete**. The code they exercised is
    removed (D-15.7). The new `it.each` covers single-sig and multisig refusal. Import has its own descriptor
    parsing and duplicate tests.
  - `:487-543` "persists an imported descriptor pair with canonical identity and initial rows": **delete**. The
    behaviour is removed. Initial address rows on the signer path stay covered by `:176-280`.
  - `:545-573` "fails address derivation before opening the atomic create transaction": switch the input to
    `...singleSigSignerInput()`.
  - Observed after the migration: `tests/unit/services/wallet.test.ts` 115/115 green; `tests/unit/api` and
    `tests/unit/services/wallet` all green (124 files, 3,339 tests before the migration, with only the 11 above
    failing).
- Unit, `tests/unit/api/openapi.wallet.contracts.ts:296-302`: still green (`toMatchObject` subset). Extend it to
  assert the new `descriptor.description`.
- Integration, `core-crud.contracts.ts`:
  - `:26-51` becomes the red test above.
  - `:53-79` (multisig) and `:81-101` (taproot): re-target to `POST /api/v1/wallets/import` with
    `{ data: <receive descriptor>, name, network: 'testnet3' }`. Assert `201` and `response.body.wallet` type,
    scriptType, quorum and totalSigners. `changeDescriptor` is not in the import result, so drop that assertion.
- Integration, `groups-telegram.contracts.ts`:
  - `:19-46` and `:48-68` (403 group denials) are unchanged; the group check precedes the refusal.
  - `:70-130` ("group members access … groupId") and `:132-154` ("without groupId"): create with signers.
    - Register a device via `POST /api/v1/devices` and pass `signers`, exactly as `setup/helpers.ts:166-207` does.
      The `groupId` case needs the explicit body; the other can call `createTestWallet(app, token, { name })`.
      *(review pass 1, A-7)* Import `createTestWallet` directly from `../../setup/helpers` (do not extend
      `walletIntegrationTestHarness.ts`, whose re-exports at `:90` lack it and which is outside the ownership table).
      `createTestWallet` accepts only `{ name }`, which is why the `groupId` case keeps the explicit body.
    - Replace `expect(wallet?.changeDescriptor).toBe(CHANGE_DESCRIPTOR)` with `.not.toBeNull()`.
- Integration, `walletDescriptorAtomicity.integration.test.ts`. The file mocks the capability gate (`:20-25`), so
  signer fixtures are allowed.
  - `:258-274` ("rolls back wallet creation when initial address insertion fails"): build the signer with the
    file's `createSignerFixture(prisma, user.id, { fingerprint: 'aabbccdd', xpub: XPUB, purpose: 'single_sig', derivationPath: "m/84'/1'/0'" })`
    (`:89-114`). Call `createWallet` with `signers: [{ deviceId, deviceAccountId, signerIndex: 0 }]`. Add the
    assertion that `walletDevice.count({ where: { deviceId } })` is 0.
  - `:371-406` ("preserves the live verified wallet byte-for-byte when restore address insertion fails"): obtain
    the wallet with `importFromDescriptor(user.id, { descriptor: RECEIVE_DESCRIPTOR, changeDescriptor: CHANGE_DESCRIPTOR, name, network: 'testnet3' })`
    (already imported at `:9`, used at `:280-285`) and use `.wallet.id`.
    - The `toMatchObject` at `:386-394` keeps `imported_pair`, because import with an explicit change descriptor
      is `sourceKind: 'imported'` (`prepareImport.ts:64`). Verify at run time and record any field difference as a
      plan deviation.
    - The test's purpose, `toEqual(original)` after a failed restore, is unchanged.
- e2e (`tests/e2e/**`): **none**. `create-wallet-flow.spec.ts` mocks the API, and the UI sends `signers`. No new
  endpoint, so the e2e mock maps are untouched.
- Integration group registry: no new spec file. All three files are already listed
  (`scripts/ci/backend-integration-groups.sh:54-55` and the wallet flow group).

**Pin / inventory / seal impact (checked at 560e8f110e).**
- `config/wallet-safety-mutation-map.json`, stryker configs, shards: **no**. No hit for `walletCreate`.
  `psbtConstruction.ts:67-77` (`stryker.taproot-construction.config.mjs:7`) and `psbtAccountBinding.ts` are
  untouched.
- `config/hardware-wallet-implementation-inventory.json:145-149`, `:4329-4342`: **no change**.
  `createWallet` keeps exactly one `assertHardwareWalletCapability(…, "import")`.
- `config/wallet-sync-lifecycle-contract.json:340-345`, `:452-457`: **no change**. The
  `requestedIncrementalSyncGeneration` write and `wakeInitialWalletSync` stay one each in `createWallet`;
  `check:wallet-sync-lifecycle-contract` passed.
- `config/wallet-sync-mutation-boundaries.json`: **no** (`services/wallet` is out of scope).
- Replay seal: **no**. The driver seeds wallets directly through Prisma (`wallet-sync-persistence-driver-helpers.cjs`
  `walletSeed`) and never calls `createWallet`.
- `check:architecture-boundaries` and `check:server-cycle-baseline`: passed on the prototype. The file-level
  `walletCreate → descriptorParser` edge disappears. If `docs/architecture/generated` is file-granular, the
  integrator regenerates it with `arch:check` in the primary checkout.
- Signer inventory: **no**. `verify:signer-inventory` is current on the prototype.
- `check:safety-catch-guards`: passed. eslint is clean on both changed source files.
- Semgrep baseline: `backend-scale-out.mjs:24` pin. Keep the edit below that line (D-15.10).

**Verification.**
- Server: `cd server && npx tsc --noEmit && npm run typecheck:tests` (the prototype passed `tsconfig.test.full.json`),
  the confirm command (green), `npx vitest run tests/unit/services/wallet.test.ts tests/unit/api`, and the
  integration groups that contain the three edited files.
- Scripts: `node --check` on the three perf scripts, and *(review pass 1, A-6)* the grep gate: `grep -nE
  "network: *'testnet'|\|\| 'testnet'"` over the three scripts must find nothing (the Verification
  block writes it as `if grep …; then exit 1; fi`). *(review pass 2, A-1)* The 409-reuse parse: the generated
  backend scale-out proof script passes `node --check`, and the grep gate finds the server's 409 text in
  `walletImport/deviceResolution.ts` and the parse prefix plus `409` in each of the three scripts.
- Integrator: `npx vitest run --coverage tests/unit`. Both arms of the new `if (input.descriptor)` are covered:
  the new `it.each` and `:418` "creates wallet without device links".

**Acceptance.**
- `POST /api/v1/wallets` with a descriptor and no signers returns 400 `INVALID_INPUT` naming
  `POST /api/v1/wallets/import`, and persists nothing.
- Create with signers, create with neither (add-signers-later), group 403s and import are unchanged.
- Existing descriptor-only wallets are untouched.

**Rollback.** Revert the commit. No data or schema step. Signerless descriptor wallets become creatable again.

### Phase A open questions

*(coordinator, at assembly)* **DECIDED** — see the plan header: option (d) is adopted (D-15.1) and the remaining capacity
failure gets its own surfaced reason (D-15.11); (iii)/(iv) and a retry stop are the P3 design follow-up
`wallet-sync--retained-evidence-capacity-limit-design`. The drafted question is kept as the record:

1. **OQ-A1 — the remaining per-wallet sync ceiling (A1, D-15.2).** After A1, a wallet whose authenticated history
   plus foreign parents exceeds 32 MiB of canonical bytes or 100,000 inputs still fails every sync, and its newest
   deposits are the ones refused. Several valid options exist:
   - (i) accept a documented maximum wallet size, and report it under a distinct non-generic reason instead of
     `transaction_complexity_exceeded`, so `lastSyncError` names it;
   - (ii) raise the resident budget. The worker container has 1 GiB, and the RC11 live replay peaked at 517 MiB
     against a 768 MiB limit;
   - (iii) narrow history-phase parent fetches to parents already in the current set. That roughly halves resident
     bytes for receive-heavy wallets, but it changes the replay's compact set and the RC11 parent contract;
   - (iv) stream or window history authentication. That redesigns RC11 and the sealed replay.

   *Recommendation:* (i) now as a small follow-up, with no behaviour change beyond the reason label. Track (iii) and
   (iv) as a design item, triggered only if a real wallet passes about 50% of the raw ceiling. A1's receipts
   (`canonicalBytesHighWater`) already measure that.

## Phase B — fee tiers, email and webhook fixes (B1–B3)

I re-read all evidence on `560e8f110e` (`560e8f110ed93246c659b25aaa063751cb3e09a0`) in
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i15`. Every file:line below was verified there. The decisions are
D-15.B1a–D-15.B3g. B1 (frontend), B2 (server email) and B3 (server webhooks/sync) touch disjoint files; they run in one
worktree `b` as three commits, B1 then B2 then B3.

**Prototype.** All three fixes and every red test below were prototyped on a `git archive` copy of `560e8f110e` at
`<scratchpad>/b15` (node_modules symlinked from `/home/nekoguntai/sanctuary`, `shared/dist` rebuilt in place, the server
`src/generated` Prisma client symlinked). The full diff is `<scratchpad>/plan15-B-prototype.patch` (16 files). Red was
observed on the unmodified copy; green, the adjacent suites, server `tsc --noEmit -p tsconfig.json`,
`tsc -p tsconfig.test.full.json`, frontend `tsc -p config/tooling/tsconfig.tests.json`, and pinned lizard 1.24.0
(`-C 15 -T nloc=200`, zero warnings on every changed/new file) were all run on the patched copy. Coverage and
Playwright were **not** run (read-only drafting; one coverage run at a time is the integrator's). *(review pass 1)* A
reviewer re-ran every B red on base and green after the fix on `<scratchpad>/rpr15B` / `rpr15B-fix`, including the
unprototyped D-15.B2e and D-15.B3h, plus a static Playwright run of the fixed build (282 expected, 0 unexpected).

**Commands.** On this host `npx` trips npm 11's `devEngines` check (EBADDEVENGINES); use nvm's node/npm on PATH (memory:
pre-commit hook needs nvm node) or call the binary directly. Frontend:
`node node_modules/.bin/vitest run --config config/tooling/vitest.config.ts <files>`. Backend, from `server/`:
`node ../node_modules/.bin/vitest run <files>`.

Shared surfaces and gates:
- **No new API endpoint, request/response field, Prisma model or migration** (RC10 migration-tree digest). No e2e mock map
  changes for B2/B3. *(coordinator, at assembly)* D-15.B3h adds a 400 to the existing webhook create/update routes; no new route or
  field. B1 changes one render-regression harness mock value set (D-15.B1c) so that no PNG baseline changes.
- **Architecture graphs.** `docs/architecture/generated/server.md` collapses at `src/<dir>` (`services → services` edges
  are internal), and `docs/architecture/generated/calls/notifications.md` lists 15 files, none of them touched. B3's new
  `services/sync/confirmationUpdater.ts → services/webhooks/confirmationDeliveries.ts` edge therefore should not change the
  committed graphs; the integrator still runs `npm run arch:check` in the primary checkout (memory: worktree symlink
  artifact) and commits any regenerated output.
- **Pins and inventories.** `server/src/utils/safeJson.ts` is a whole-file `mutate` entry in `server/stryker.config.mjs:26`
  (no line ranges; nothing to re-pin). None of the touched files is in `config/wallet-safety-critical-paths.json`,
  `config/wallet-safety-mutation-map.json`, `config/wallet-sync-mutation-boundaries.json` (canonical scopes are
  `services/bitcoin/sync/**` etc., not `services/sync/**`), or the replay driver. No `finalize*` identifiers.
- **Test-file size.** `server/tests/unit/services/sync/confirmationUpdater.test.ts` is **exactly 1,000 lines** and
  `server/tests/unit/services/webhooks/deliveryService.test.ts` is 996: B3 adds nothing to either (new files instead).
- **No new integration spec** (would need `scripts/ci/backend-integration-groups.sh` registration); all new tests are unit
  tests.

### Phase B1 — Send presets, the default send rate and the Dashboard fee card read the matching server tier (P2 `fee-tiers--client-maps-server-tiers-one-slot-down`)

**Evidence (re-verified).**
- Server tiers, by confirmation target:
  - Electrum: `server/src/services/bitcoin/blockchain/networkOperations.ts:145-154` — `fastest` 1 block, `halfHour` 3,
    `hour` 6, `economy` 12; defaults `:156-161`. Type comments `blockchain/types.ts:29` (`halfHour  // ~3 blocks`) and
    `mempool/types.ts:37` (`halfHourFee // ~3 blocks`).
  - mempool.space: `server/src/services/bitcoin/feeService.ts:39-47` maps `fastestFee/halfHourFee/hourFee/economyFee/
    minimumFee` one-to-one onto `fastest/halfHour/hour/economy/minimum`; the Electrum path sets `minimum: fees.economy || 1`
    (`:52-57`).
  - Wire type `shared/types/api.ts:275-283`; runtime schema `shared/schemas/bitcoinResponses.ts:30-35` **requires**
    `halfHour`.
- Client tier shape `src/types/index.ts:557-563` (`fastestFee, halfHourFee, hourFee, economyFee?, minimumFee?`) uses the
  mempool.space names, i.e. the same five tiers.
- **Bug, send flow.** `formatFees` (`src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts:70-78`) sets
  `halfHourFee ← hour`, `hourFee ← economy`, `economyFee ← minimum || 1`; `feeEstimates.halfHour` is never read. Called at
  `loadSendTransactionPageData.ts:76`.
- **Bug, dashboard.** `toDashboardFeeEstimate` (`src/components/Dashboard/hooks/dashboardDataModel.ts:139-148`) sets
  `medium ← hour`, `slow ← economy`. Called at `useDashboardData.ts:191`.
- **Intended semantics, from the labels.** `FeeSelector.tsx:46-50`: High Priority `fastestFee` "~10m", Standard
  `halfHourFee` "~30m", Economy `hourFee` "~1hr". `FeeEstimationCard.tsx:19-23`: fast "~10 min / ~1 block", normal
  `medium` "~30 min / ~3 blocks", slow `slow` "~60 min / ~6 blocks". So Standard/normal = server `halfHour` (3 blocks) and
  Economy/slow = server `hour` (6 blocks). Today each is one tier slower than its label.
- **Downstream consumers of the client shape** (`grep -rn "halfHourFee\|hourFee\|economyFee\|minimumFee\|fastestFee" src`):
  - `src/contexts/send/SendTransactionContext.tsx:144` seeds every new send's fee rate from `halfHourFee` → today the
    6-block rate presented as "Standard ~30m".
  - `src/components/send/steps/OutputsStep/hooks/useTransactionComposition.ts:116-121`: the ">2x the economy rate" warning
    uses `hourFee ?? minimumFee` → today the 12-block rate.
  - `FeeSelector.tsx:47-49` presets.
  - Nothing else reads `economyFee`. `minimumFee` keeps `minimum || 1`.
- **Consumers of the raw server shape that are correct and untouched:** `src/components/UTXOList/UTXOList.tsx:87` (`hour`
  for dust economics), `WalletAutopilotSettings/AutopilotHealthStatusCard.tsx:62` (`feeSnapshot.economy`). Server-side
  readers (`autopilot/feeMonitor.ts`, `jobs/definitions/maintenance.ts:203-208`, `assistant/tools/cache.ts`,
  `api/bitcoin/fees.ts:40`) use server names consistently. RBF/CPFP suggestions are server-side (no client tier read).
  Gateway forwards `/bitcoin/fees` raw (no mapper); there is no mobile client in the repo.
- Tests miss it: `tests/components/send/SendTransactionPage.test.tsx:147-152` and
  `SendTransactionPage.branches.test.tsx:148-153, 206-211` mock fees **without `halfHour`**; Dashboard harness fixtures
  `tests/components/Dashboard/useDashboardDataHarness.ts:329` and `useDashboardData.networkIdentity.test.tsx:40` also omit
  it; nothing pins `formatFees` or `toDashboardFeeEstimate`.

**Decisions.**
- **D-15.B1a — identity mapping by tier name.** `formatFees` → `fastestFee ← fastest`, `halfHourFee ← halfHour`,
  `hourFee ← hour`, `economyFee ← economy`, `minimumFee ← minimum || 1`. `toDashboardFeeEstimate` → `fast ← fastest`,
  `medium ← halfHour`, `slow ← hour`. Labels stay (they are already correct); relabelling to the old numbers was rejected
  because it would advertise the 6-block rate as "Standard" with no faster middle option.
- **D-15.B1b — the overpay warning keeps `hourFee` as its baseline.** After D-15.B1a `hourFee` is exactly the rate the UI
  calls "Economy ~1hr", which is what the warning text names ("the economy rate"). Effect: the baseline rises from the
  12-block to the 6-block rate, so the warning fires only above 2x the displayed Economy preset (fewer false alarms). No
  code change in `useTransactionComposition.ts`; its tests inject `FeeEstimate` objects and are unaffected.
- **D-15.B1c — keep the PNG baseline truthful by adjusting one harness mock.** The render-regression harness mocks
  `GET /bitcoin/fees` as `{ fastest: 22, halfHour: 16, hour: 10, economy: 4 }`
  (`tests/e2e/render-regression/renderRegressionHarness.ts:561`), and
  `tests/e2e/render-regression.spec.ts-snapshots/dashboard-testnet-shell-chromium-linux.png` shows the fee card as
  **22 · 10 · 4** (read from the PNG). Change the mock to `{ fastest: 22, halfHour: 10, hour: 4, economy: 2 }`: the
  visible tiers stay 22 · 10 · 4, and `renderRegressionCore.contracts.ts:35` (`getByText("22", { exact: true })`) still
  matches. *(review pass 1, B-1: rationale corrected)* The render-regression screenshot compares at
  `maxDiffPixelRatio: 0.01` (`renderRegressionHarness.ts:28`). Measured on the fixed build, the old mock renders
  22 · 16 · 10 and still passes: 1,246 px differ against the 1,033 px of host drift and a limit of about 7,370 px. The
  mock is changed so that the baseline keeps showing the values it depicts. Fee semantics are pinned by the unit tests
  (`formatFees.test.ts`, `dashboardDataModel.test.ts`), not by the PNG. Regenerating a PNG outside the digest-pinned
  `sanctuary-ci-playwright` image risks font drift, so no PNG is regenerated. Side effect checked: this harness's `hour` also feeds
  `UTXOList` dust economics, but no render-regression contract asserts dust text and none of the five PNGs
  (`admin-settings-websocket`, `dashboard-testnet-shell`, `settings-notifications-telegram`,
  `wallet-detail-addresses-empty`, `wallet-list-testnet`) shows the UTXO list. Alternative (not chosen): keep the mock
  and regenerate `dashboard-testnet-shell-chromium-linux.png` in the CI image so it depicts 22 · 16 · 10.
- **D-15.B1d — fixture realism.** Add `halfHour` to the send-page and dashboard fixtures listed below so they match
  `FeeEstimatesSchema`; assertions keep their values (see "Existing tests").

**Production changes.**
- `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts:73-75` (D-15.B1a).
- `src/components/Dashboard/hooks/dashboardDataModel.ts:146-147` (D-15.B1a).
- `tests/e2e/render-regression/renderRegressionHarness.ts:561` mock values (D-15.B1c; test harness, not production).

**Tests first.** Frontend, failing on base:
1. New `tests/components/send/formatFees.test.ts` (24 lines), **"maps every server fee tier to the client tier with the
   same confirmation target"**: `formatFees({fastest:40, halfHour:30, hour:20, economy:10, minimum:2})` equals
   `{fastestFee:40, halfHourFee:30, hourFee:20, economyFee:10, minimumFee:2}`. **Observed red:** received
   `halfHourFee: 20, hourFee: 10, economyFee: 2`.
2. Same file, **"falls back to 1 sat/vB only for the missing minimum relay tier"**: input without `minimum` →
   `{…, economyFee:10, minimumFee:1}`. **Observed red:** `halfHourFee: 20, hourFee: 10, economyFee: 1`. (Also covers both
   arms of `minimum || 1`.)
3. `tests/components/Dashboard/dashboardDataModel.test.ts` (260 → 275 lines; add `toDashboardFeeEstimate` to the import),
   **"shows the ~3-block rate as normal and the ~6-block rate as slow"**: `{fast:40, medium:30, slow:20}`. **Observed red:**
   `medium: 20, slow: 10`. Plus guard **"returns null without estimates"** (green on base).

Confirm red: `node node_modules/.bin/vitest run --config config/tooling/vitest.config.ts tests/components/send/formatFees.test.ts tests/components/Dashboard/dashboardDataModel.test.ts`
→ observed `Tests 3 failed | 24 passed`.

**Existing tests that encode the old behaviour.**
- `tests/components/Dashboard/useDashboardData.test.tsx:112` expects `{ fast: 18.6, medium: 9, slow: 3.4 }` from the
  harness fixture `{ fastest: 18.6, hour: 9, economy: 3.4 }` (`useDashboardDataHarness.ts:329`). **This is the only
  existing test that fails after the fix** (observed: `1 failed | 1098 passed` across `tests/components/send`,
  `tests/components/Dashboard`, `tests/components/Dashboard.test.tsx`, `tests/contexts/send`,
  `tests/components/UTXOList.test.tsx`, `tests/components/TransactionActions`). Change the fixture to
  `{ fastest: 18.6, halfHour: 9, hour: 3.4, economy: 1.2, network: 'mainnet' }` and leave the `:112` assertion unchanged;
  same fixture edit at `useDashboardData.networkIdentity.test.tsx:40` (its assertions are null/not-null only), *(review
  pass 1, B-5)* and `:71` → `{ fastest: 5, halfHour: 3, hour: 2, economy: 1, network: 'testnet4' }` (it stays green
  either way, but without `halfHour` it yields `medium: undefined` and breaks D-15.B1d's schema-match goal).
- D-15.B1d: add `halfHour` to `SendTransactionPage.test.tsx:147-152` (`halfHour: 35`) and
  `SendTransactionPage.branches.test.tsx:148-153, 206-211` (`halfHour: 28`); these pass either way (the branches test's
  `min-fee` assertion at `:266` is unchanged).
- `FeeSelector.test.tsx`, `OutputsStep*.test.tsx`, `useTransactionComposition.test.ts`, `FeeEstimationCard.test.tsx`,
  `Dashboard.render.test.tsx`, `tests/contexts/send/SendTransactionContext.test.tsx` inject already-mapped shapes —
  unaffected (verified green).
- **E2E.** Fee mocks (`grep -rn "GET /bitcoin/fees" tests/e2e`): `fixtures/apiBaseline.ts:83`,
  `adminOperationsApiState.ts:148`, `node-status-card-responsive.spec.ts:153`, `error-recovery.spec.ts:189`,
  `send-transaction-flow.spec.ts:367-368`, `wallet-sharing-privacy.spec.ts:254-255`, `dashboard-price-blocks.spec.ts:206`,
  `settings-persistence.spec.ts:129`, `import-wallet-flow.spec.ts:229`, `create-wallet-flow.spec.ts:328`,
  `accessibility.spec.ts:190` (all `{18,12,8,3}`, all already include `halfHour`), and the harness (D-15.B1c). Value
  assertions: only `dashboard-price-blocks.spec.ts:499,580` (`fee-tier` first = `'18'`, the unchanged fastest tier) and
  `renderRegressionCore.contracts.ts:35` (`"22"`). `dashboard-price-blocks.spec.ts:435-495` measures tier geometry; its
  card now renders 18 · 12 · 8 instead of 18 · 8 · 3 (wider middle number) — it must be run, not assumed.
  `send-transaction-flow.spec.ts:729-732` asserts only the preset button names. The default send rate becomes 12 instead
  of 8 in those specs; no spec asserts a fee amount or the custom-rate value (`grep` for numeric `toHaveValue/
  toContainText/getByText` in `tests/e2e`). No mock map entry is added or removed.

**Verification.** Worker: the targeted files plus the consumer set above; `npm run typecheck:app && npm run
typecheck:tests && npm run typecheck:all`; `npm run lint:app`; lizard on the two production files. Integrator:
frontend coverage 100% for both files; **Playwright** per CLAUDE.md (`npm run build`, serve `dist/` statically,
throwaway config without `webServer`) for `render-regression.spec.ts` (must pass with **no** baseline update),
`dashboard-price-blocks.spec.ts`, `send-transaction-flow.spec.ts`, `error-recovery.spec.ts`, `accessibility.spec.ts`.

**Acceptance.** Standard (~30m) and the default send rate equal the server `halfHour` (3-block / mempool `halfHourFee`)
rate; Economy (~1hr) equals `hour`; the Dashboard "normal" and "slow" tiers show `halfHour` and `hour`; the overpay warning
compares against the displayed Economy rate; the PNG baseline files are unchanged and the screenshot assertions pass at
the repo tolerance.

**Rollback.** Revert the two mapper lines, the harness mock and the test edits. No stored state.

### Phase B2 — The email service decodes SMTP settings the way the admin API stores them (P2 `admin-settings--smtp-values-json-encoded-break-email`)

**Evidence (re-verified).**
- Writer: `updateAdminSettings` (`server/src/services/adminSettingsService.ts:86-104`) stores
  `serializeSetting(key, value)` for every key (`:95-97`); `serializeSetting` (`:160-165`) returns `JSON.stringify(value)`,
  and for a new `smtp.password` `JSON.stringify(encrypt(value))` → `"\"iv:tag:ct\""`. `PUT /admin/settings` accepts any key
  (`server/src/api/schemas/admin.ts:134` `z.record(z.string(), z.unknown())`); there is no SMTP UI (`grep smtp. src` empty).
- Reader: `getSmtpConfig` (`server/src/services/email/emailService.ts:24-59`) reads host/user/password/fromAddress/fromName
  with `systemSettingRepository.getValue` (`:25, :34-37`), which returns the raw column (`systemSettingRepository.ts:83-86`).
  Port/secure use `getNumber`/`getBoolean` (`:32-33`; repository `:102-122`), which happen to accept JSON scalars.
- `isEncrypted('"iv:tag:ct"')` is false (`server/src/utils/encryption.ts:118-127`: three base64 parts; the quote fails), so
  the quoted ciphertext becomes the literal SMTP password (`emailService.ts:40-48`); the transporter gets host
  `'"smtp.example.com"'` (`:89-99`) and the sender `"\"Ops\"" <"a@b">` (`:134`).
- `isSmtpConfigured` (`:64-67`) is true, so `login.ts:154`, `emailVerificationService.ts:93, 170, 198`
  (`assertEmailChangeDeliverable`) let flows proceed into a send that always fails; with `DEFAULT_EMAIL_VERIFICATION_REQUIRED
  = true` (`server/src/constants.ts:182`) an email change leaves the user unverified with no deliverable link.
- **Same root cause, second symptom (found while verifying):** a backup restore deliberately disables SMTP by writing
  `JSON.stringify('')` = `'""'` into `smtp.host/user/password/fromAddress` (`server/src/services/backupService/restoreTransforms.ts:74-94`,
  warning "SMTP settings restored disabled"). Read raw, `'""'` is a non-empty string, so after every restore
  `getSmtpConfig()` returns a config and `isSmtpConfigured()` is **true** — the "disabled" state is not honoured.
- **Same root cause, third reader:** `getServerName` (`emailVerificationService.ts:64-67`) reads `server.name` raw; a value
  saved through `PUT /admin/settings` puts literal quotes into every verification subject (`templates/verification.ts:12`).
- **Canonical format (how every other reader parses).** JSON-encoded is canonical for admin-API settings:
  `buildAdminSettingsResponse` decodes every row with `safeJsonParseUntyped(value, value)` (`adminSettingsService.ts:47-50`);
  `getJson`/`getParsed` (`systemSettingRepository.ts:127-148`) JSON-decode; `updateConfirmations.ts:43-47` reads
  `deepConfirmationThreshold` via `getParsed`; backup restore writes `JSON.stringify` values; the backup fixtures
  (`server/tests/unit/services/backupService/restore.contracts.ts:711-715`) and the integration fixture
  (`server/tests/integration/ops/phase2OperationsProof.integration.test.ts:42-45`) store SMTP JSON-encoded. The one raw
  writer is `adminMonitoringService.ts:111` (`set(settingKey, trimmedUrl)`), read raw at `:54-56` — consistent with itself.
- Tests miss it: `server/tests/unit/services/email/emailService.test.ts:93-99` (448 lines) mocks `getValue` with raw values
  and mocks `encryption`; `adminSettingsService.atomic.test.ts:39-46` pins the JSON-encoded write; nothing round-trips
  write → read.

**Decisions.**
- **D-15.B2a — the writer stays; JSON-encoded is canonical.** Changing `serializeSetting` to store strings raw was rejected:
  existing quoted rows (live installs and restored backups) would still need a tolerant reader, and the GET response's
  `safeJsonParseUntyped(value, value)` would turn a raw host like `1234` into a number.
- **D-15.B2b — the reader decodes, tolerantly and silently.** New exported `decodeStoredString(value: string): string` in
  `server/src/utils/safeJson.ts` = `safeJsonParseSensitive(value, SystemSettingSchemas.string) ?? value` (both already
  in that file, `:104-114`, `:119-125`). It returns the decoded string when the row is a JSON string literal and the raw value
  otherwise (legacy raw rows, raw `iv:tag:ct`), and never logs the value — `safeJsonParseUntyped` was rejected because it
  logs a 100-char `valuePreview` at warn on every raw row (`safeJson.ts:90-94`), which would leak a legacy raw password.
  `emailService.ts` gains a top-level `getStringSetting(key)` (`getValue` then `decodeStoredString`, `null` stays `null`)
  used for host/user/password/fromAddress/fromName; decryption runs on the decoded value. The helper lives in
  `emailService.ts` (not as a repository method) so the existing 448-line `emailService.test.ts`, which mocks the repository
  object with `getValue/getNumber/getBoolean` only, keeps passing unchanged.
- **D-15.B2c — `server.name` uses the same decoder** in `getServerName` (`(name === null ? '' : decodeStoredString(name)) ||
  'Sanctuary'`). *(coordinator, at assembly)* The monitoring URL readers are changed too, by D-15.B2e below (folded from the
  drafter's P3 candidate).
- **D-15.B2d — restored SMTP reads as unconfigured.** A consequence of D-15.B2b, not extra code: `'""'` decodes to `''`, so
  `getSmtpConfig()` is `null` and `isSmtpConfigured()` false after a restore, matching the restore warning. Flows gated on
  SMTP (`login.ts:154`, `assertEmailChangeDeliverable`) then report "not configured" instead of failing at send time.
- No data repair, no migration; existing quoted rows work unchanged. Port/secure unchanged.
- **D-15.B2e — monitoring custom URLs use the same decoder** *(coordinator, at assembly)*. `PUT /admin/settings` accepts any key, so
  `monitoring.grafanaUrl`, `monitoring.prometheusUrl` and `monitoring.jaegerUrl` written through it are stored
  JSON-quoted, while `getMonitoringServices` reads them raw (`adminMonitoringService.ts:54-56`) and the response then
  carries a quoted URL with `isCustomUrl: true`. Add a top-level `readCustomUrl(key)` in `adminMonitoringService.ts`
  (`getValue`, then `decodeStoredString`; `null` stays `null`) and use it for the three reads. The service's own writer
  (`:111`, raw `trimmedUrl`) is unchanged; a raw URL is not a JSON string literal, so it decodes to itself, and `'""'`
  decodes to `''`, which falls back to the default `{host}:<port>` URL with `isCustomUrl: false`.

**Production changes.**
- `server/src/utils/safeJson.ts`: append `decodeStoredString` (D-15.B2b).
- `server/src/services/adminMonitoringService.ts:54-56`: `readCustomUrl` + three call sites (D-15.B2e).
- `server/src/services/email/emailService.ts:24-37`: `getStringSetting` + five call sites (D-15.B2b).
- `server/src/services/email/emailVerificationService.ts:64-67` (D-15.B2c).

**Tests first.** Backend, failing on base:
1. New `server/tests/unit/services/email/emailService.storedSettings.test.ts` (122 lines). It mocks `src/repositories` with
   a `Map`-backed `systemSettingRepository` (`getValue`; `getNumber`/`getBoolean` with the real repository semantics;
   `getAll`; `updateAtomically(derive)` applying the derived rows) and `nodemailer`; it uses the **real**
   `updateAdminSettings` and the **real** AES-GCM `encrypt` (key initialised by `server/tests/setup.ts:15-20`).
   - **"reads back the plain values and decrypts the stored password"**: `updateAdminSettings({host, port: 465, secure:
     true, user, password: 'p@ss:word', fromAddress, fromName})`; asserts the stored host row is `'"smtp.example.com"'` (pins
     the writer) and `getSmtpConfig()` equals the plain values with `password: 'p@ss:word'`. **Observed red:** every string
     quoted, `password: "\"2hA8…:eaoR…:iBOo…\""` (the quoted ciphertext).
   - **"sends with the decoded host, credentials and sender"**: `sendEmail(...)` → `createTransport` with `host:
     'smtp.example.com', auth: { user: 'mailer', pass: 'secret' }`, `sendMail` with `from: '"Ops Desk" <noreply@example.com>'`.
     **Observed red:** host/user quoted, `pass` = quoted ciphertext.
   - **"treats the empty values a backup restore writes as not configured"**: rows `smtp.host`/`smtp.fromAddress` =
     `JSON.stringify('')` → `getSmtpConfig()` `null`, `isSmtpConfigured()` `false`. **Observed red:** `{ host: '""', port:
     587, … }`.
   - Guard **"still reads legacy raw rows"**: raw host/user/fromAddress and a raw `encrypt('legacy-secret')` password →
     decoded values, `password: 'legacy-secret'`, `fromName: 'Sanctuary'`. **Green on base, must stay green** (the
     "accept both forms" requirement).
2. `server/tests/unit/services/email/emailVerificationService.test.ts` (699 → 712 lines), in `describe('createVerificationToken')`,
   **"uses a server name saved through the admin settings API without its JSON quotes"**: `getValue('serverName')` →
   `JSON.stringify('Home Vault')`; `sendEmail` called with `subject: 'Verify your email for Home Vault'`. **Observed red:**
   `"Verify your email for \"Home Vault\""`.
3. `server/tests/unit/utils/safeJson.test.ts` (389 lines), `describe('decodeStoredString')`: `'"a"'`→`'a'`, `'""'`→`''`,
   `'plain'`→`'plain'`, `'587'`→`'587'` (non-string JSON keeps the raw text), `'"unterminated'`→ raw, and the logger mock
   is not called. Red on base by missing export (new unit; the behavioural red is test 1). *(review pass 1, B-7)* The
   existing mock (`safeJson.test.ts:12-19`) returns a fresh anonymous logger per call, so hoist it: `const mockLog =
   vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))`; `createLogger: () => mockLog`;
   and assert `mockLog.warn`/`mockLog.debug` not called for every row. Prototyped by the reviewer: all 5 rows red on
   base by `TypeError`, green after the fix; the rest of the file stays green.

4. *(coordinator, at assembly)* `server/tests/unit/services/adminMonitoringService.test.ts` (215 lines), **"reads a custom URL saved through
   the admin settings API without its JSON quotes"**: `getValue('monitoring.grafanaUrl')` → `JSON.stringify('https://grafana.example.com')`
   → the grafana service has `url: 'https://grafana.example.com'`, `isCustomUrl: true`; and **"treats an empty
   JSON-encoded URL as not customised"**: `'""'` → the default `{host}:3000` URL (the test config's `grafanaPort`), `isCustomUrl: false`. **Predicted
   red on base:** `url` is `'"https://grafana.example.com"'`, and `isCustomUrl` is `true` for `'""'`. The existing raw
   URL case (`:64-80`) stays green.

Confirm red (from `server/`): `node ../node_modules/.bin/vitest run tests/unit/services/email/emailService.storedSettings.test.ts`
→ observed `3 failed | 1 passed`; and `… tests/unit/services/email/emailVerificationService.test.ts -t "server name saved"`
→ observed `1 failed`. After the prototype fix: `tests/unit/services/email`, `adminSettingsService*.test.ts`,
`tests/unit/utils` → `27 files / 656 tests passed`.

**Existing tests that encode the old behaviour.** None fails. `emailService.test.ts` (raw values + mocked `isEncrypted`)
passes unchanged because raw values decode to themselves; `adminSettingsService.atomic.test.ts:39-46` still pins the
JSON-encoded write (D-15.B2a); `restore.contracts.ts:711-715` and `phase2OperationsProof.integration.test.ts:42-45` are
unaffected (they do not read through `getSmtpConfig`). **E2E:** `grep -rln "smtp\." tests/e2e` is empty; no mock map
changes.

**Coverage notes.** `getStringSetting`'s `null` arm is hit by `emailService.test.ts`'s "host is not configured" case;
`decodeStoredString`'s fallback arm by the legacy-raw guard; `getServerName`'s `null` arm by the existing suites
(`getValue` → `null`).

**Verification.** Worker: the files above; `cd server && npx tsc --noEmit && npm run typecheck:tests`; lint; lizard.
Integrator: backend unit coverage (`npx vitest run --coverage tests/unit`) at 100% for the four files (with
`adminMonitoringService.ts`, D-15.B2e: `readCustomUrl`'s `null` arm is the existing default-URL cases).

**Acceptance.** SMTP settings saved through `PUT /admin/settings` produce a transporter with the plain host, user and
decrypted password and a correct `From`; legacy raw rows keep working; a restored ("disabled") SMTP configuration reports
not configured; verification subjects use the unquoted server name; monitoring custom URLs saved through the generic
settings API are returned unquoted (D-15.B2e). No stored value is rewritten.

**Rollback.** Revert the four production files and the tests; stored rows were never modified.

### Phase B3 — wallet.transaction.confirmed (and threshold-gated events) are queued when the confirmation refresh crosses the threshold (P2 `webhooks--confirmed-event-never-emitted-after-mempool`)

**Evidence (re-verified).**
- The only producer of transaction webhooks is the notification channel: `webhookChannelHandler.notifyTransactions`
  (`server/src/services/notifications/channels/webhook.ts:33-55`) → `buildTransactionWebhookEventsForBatch`
  (`server/src/services/webhooks/eventBuilder.ts:21-43`) → `queueWebhookEventsDeliveries`
  (`deliveryService.ts:61-111`). It is reached only through `dispatchTransactionNotifications` for **newly inserted**
  transactions (`bitcoin/sync/phases/processTransactions/notifications.ts:28-46`, from
  `processTransactionsPhase.ts:417`) and broadcasts (`bitcoin/transactions/broadcasting.ts:431-432, 476-477`).
- `buildEventsForTransaction` (`eventBuilder.ts:45-59`) reads `confirmations` from the stored row at build time (`:51`);
  `buildConfirmationEvents` (`:159-168`) emits `wallet.transaction.confirmed` only if `confirmations > 0` then. A
  mempool-first transaction has 0, so the confirmed event is never built, although
  `WEBHOOK_DEFAULT_WALLET_TRANSACTION_EVENTS` includes it (`shared/constants/webhooks.ts:43-47`) and the event-id comment
  (`eventBuilder.ts:194-196`) models "threshold reached" as one logical event.
- Threshold filter: `matchesEndpointFilters` (`subscriptions.ts:30-58`; the threshold check is `:53-55`, not `:261-263` as
  the finding says) drops any event whose `transaction.confirmations < filters.confirmationThreshold`; the API accepts
  `confirmationThreshold` 0..1,000,000 (`server/src/api/wallets/webhooks.ts:32`). A mempool-first transaction's one and only
  notification is therefore dropped for such endpoints — they never hear about it at all.
- **Where confirmations change.** Every confirmation-updater commit *(review pass 1, B-3: narrowed; a classification
  repair writes confirmations outside it, D-15.B3g(iii))* funnels through `recordCommittedUpdates`
  (`server/src/services/sync/confirmationUpdater.ts:213-226`), which dedupes by `txid:old:new` and calls
  `publishConfirmationUpdates` (`:126-147` → `eventService.emitTransactionConfirmed`). Callers: `populateMissingTransactionFields`
  and `updateTransactionConfirmations` commits (`:258-281`), the height refresh (`:288-309`), the sweeps
  (`refreshPendingConfirmations*`, `:452-468`; worker `syncJobs.ts:674, 696`), header reconciliation
  (`headerConfirmationUpdater.ts:75, 113`; worker `networkHeaderReconciliationRuntime.ts:172`) and `syncCoordinator.ts:343`.
  The only `transaction:confirmed` listener is `cacheInvalidation.ts:98`, registered in the API process
  (`server/src/index.ts:273`) on the local `eventBus` (`transactionEvents.ts:74-91`).
- **Tracking horizon.** Stored confirmations are refreshed only while `< deepConfirmationThreshold`
  (`bitcoin/sync/confirmations/updateConfirmations.ts:43-58`; `repositories/transactions/sync.ts:836-850`; default
  `DEFAULT_DEEP_CONFIRMATION_THRESHOLD = 3`, `server/src/constants.ts:55`).
- **Idempotency already in place.** Event ids are stable `wallet:<id>:tx:<txid>:<eventType>:v1` (`eventBuilder.ts:189-197`);
  `createDelivery` upserts on `@@unique([endpointId, eventId, payloadProfile])` with `update: {}`
  (`webhookRepository.ts:310-331`; `schema.prisma:1246`); `sendWebhookDelivery` returns early for `delivered`/`dead`
  (`deliveryService.ts:121`); `claimDeliveryAttempt` only claims `pending`/`failed` rows whose `nextAttemptAt <= now` and
  whose lease is free (`webhookRepository.ts:368-383`).
- Tests miss it: `server/tests/unit/services/webhooks/eventBuilder.test.ts` asserts the events for a given stored count;
  nothing drives a transaction from 0 to N confirmations and asserts a delivery.

**Decisions.**
- **D-15.B3a — emission point: `recordCommittedUpdates`, by direct call.** After `publishConfirmationUpdates`, call
  `queueConfirmationWebhooks(walletId, unpublished)` with the same deduped, already-committed updates. This reuses the
  single confirmation funnel, so every confirmation-updater path above is covered once, in the process that committed
  the change *(review pass 1, B-8)* (usually the worker; the API process for a user-triggered `POST …/confirmations`
  refresh, `syncCoordinator.ts:343`). Either works, because enqueueing goes through `queueWebhookDeliveryNotification`
  with the inline fallback and is not awaited.
  Rejected: (i) an `eventBus` `transaction:confirmed` listener — listeners are per-process and the existing one is registered
  only in the API process, while confirmations commit in the worker; (ii) `dispatchTransactionNotifications` — it would
  re-notify Telegram and push on every confirmation.
- **D-15.B3b — admission is a per-endpoint threshold crossing.** New `crossesEndpointConfirmationThreshold(endpoint,
  eventType, previous, current)` in `subscriptions.ts`: `T = filters.confirmationThreshold ?? 0`, raised to at least 1 for
  `wallet.transaction.confirmed`; admit iff `previous < T <= current`. This is applied **in addition to** the existing
  event-type and filter checks. Results: a default endpoint gets `confirmed` exactly on 0→1 and nothing else (it already
  received `observed`/`received`/`sent` at insert); an endpoint with threshold N gets `observed`, its direction event and
  `confirmed` on the change that reaches or jumps past N; decreases (reorg) and changes past T admit nothing. The insert
  path is unchanged.
- **D-15.B3c — idempotency rides the existing outbox key.** Confirmation-path events use the same event ids as the insert
  path. A repeat (reorg then re-confirm, or a race with a late insert-path notification job that already sees 1
  confirmation) upserts the existing row: no second row, no second HTTP send for `delivered`/`dead`, and backoff/lease are
  respected for `pending`/`failed` (evidence above). No schema change.
- **D-15.B3d — best-effort, not awaited, never under the lock's critical path.** `queueWebhookEventsDeliveries` falls back
  to an inline HTTP send when the worker queue refuses (`deliveryService.ts:101-104`, `REQUEST_TIMEOUT_MS = 10_000` at
  `:27`), which must not extend the wallet sync lock. `queueConfirmationWebhooks` is a top-level function: no-op for an
  empty list; otherwise `void queueTransactionConfirmationWebhooks(...)` with `.then` logging partial `errors` at warn
  ("Confirmation webhooks partially queued") and `.catch` logging at warn ("Failed to queue confirmation webhooks").
  Failures are **not** added to `publicationFailures` (those are synchronous publication results with their own retry
  semantics). `confirmationUpdater.ts` gains `createLogger('SYNC:CONFIRMATIONS')`.
- **D-15.B3e — the orchestration module.** New `server/src/services/webhooks/confirmationDeliveries.ts`,
  `queueTransactionConfirmationWebhooks(walletId, updates)`: keep only rising updates (`new > old`), return early if none;
  `webhookRepository.listEndpoints(walletId)` and return early unless one is enabled (so wallets without webhooks cost one
  query and no event building); `buildConfirmationWebhookEventsForBatch(walletId, rising)`; then
  `queueWebhookEventsDeliveries(events, (endpoint, eventIndex) => crossesEndpointConfirmationThreshold(endpoint,
  pairs[eventIndex].event.eventType, pairs[eventIndex].update.oldConfirmations, pairs[eventIndex].update.newConfirmations))`.
  - `eventBuilder.ts` gains `buildConfirmationWebhookEventsForBatch(walletId, updates): Promise<Array<{ update, event }>>`
    — one wallet lookup and one `findManyByTxids`; iterates the **updates**, skips a vanished row or a row whose `type` is
    not one of `received|sent|consolidation|self_transfer` (top-level `isNotificationType` guard: `Transaction.type` is a
    `String` column, `schema.prisma`), builds the `TransactionNotification` from the stored row (`type`, `amount`,
    `fee`), and reuses `buildEventsForTransaction`, which gains a `dispatchPath` parameter defaulting to
    `'notifications.transaction'`.
  - `deliveryService.queueWebhookEventsDeliveries` gains an optional `admits(endpoint, eventIndex) => boolean`
    (default `() => true`); the loop becomes `for (const [eventIndex, event] of events.entries())`. Index-based pairing
    avoids an unreachable "no matching update" branch under the 100% backend branch threshold.
- **D-15.B3f — payload provenance.** Confirmation-path events carry `source.dispatchPath: 'sync.confirmation'`; the payload
  shape is unchanged (no consumer reads `dispatchPath`: `grep -rn dispatchPath server/src shared src docs` finds only the
  builder and the type). The insert path keeps `'notifications.transaction'` (`webhookCore.test.ts:700` unchanged).
- **D-15.B3g — accepted edges.** (i) A baseline (first) sync suppresses notifications for already-confirmed history
  (`notifications.ts:17-23`); a threshold-N endpoint will still get events for a transaction imported with 1..N-1
  confirmations when it later crosses N (bounded to the tracking horizon, i.e. at most a few blocks old) — acceptable.
  (ii) Thresholds above the confirmation-tracking horizon, min(deep threshold, 6) *(review pass 1, B-2)*, never fire.
  *(coordinator, at assembly)* New saves above it are refused by D-15.B3h; endpoints saved earlier remain a known
  limitation (P3 `webhooks--threshold-above-deep-confirmation-never-fires`).
  (iii) *(review pass 1, B-3)* A classification repair that writes confirmations directly
  (`repositories/transactions/sync.ts:83` `getAuthoritativeClassificationData`, written by
  `reconcileAddressSyncTransaction` `:565-568` and `repairExistingBatchCandidate` `:649-652`; callers
  `processTransactionsPhase.ts:393`, `historyTransactions.ts:276`) bypasses the funnel: a mempool-first row repaired
  after it confirms jumps 0 → N with no `ConfirmationUpdate`, so no `confirmed` event is queued. Accepted edge: rare,
  and only for rows whose classification was incomplete. No code change here (`sync.ts` is outside phase b and a
  sync-mutation surface); P3 `webhooks--classification-repair-confirmation-skips-confirmed-event`.
- **D-15.B3h — save-time validation of `confirmationThreshold`** *(coordinator, at assembly)* (OQ-B3). In
  `server/src/services/webhooks/endpointService.ts`, `createWalletWebhook` (`:117`) and `updateWalletWebhook`
  (`:144`, only when the patch carries `filters`) call a new top-level
  `assertConfirmationThresholdTracked(filters)` before writing. `filters` is `unknown` (`endpointService.ts:72`), so
  the helper first narrows it with the existing `isPlainRecord` (`:446`) before reading `confirmationThreshold`
  *(review pass 1, B-2)*. It returns immediately unless `filters` is a plain record whose `confirmationThreshold` is a
  number (so endpoints without the filter, and every existing test, never read the setting; `updateWalletWebhook`'s
  `{ minAmountSats }` case, `endpointService.test.ts:181`, covers the record-without-threshold arm); otherwise it reads
  `systemSettingRepository.getParsed('deepConfirmationThreshold', SystemSettingSchemas.number,
  DEFAULT_DEEP_CONFIRMATION_THRESHOLD)` exactly as `updateConfirmations.ts:43-47` does.
  - *(review pass 1, B-2)* **Compare against the tracking horizon, not the deep threshold alone.** Every automatic
    refresh selects candidate wallets at a fixed 6, not at the deep threshold: the block sweep
    (`refreshPendingConfirmations`), the maintenance sweep (`refreshAllPendingConfirmations`,
    `confirmationUpdater.ts:452-468`; worker `syncJobs.ts:674, 696`) and header reconciliation
    (`headerConfirmationUpdater.ts:14, 61-62`) all query `findWalletIdsWithPendingConfirmations`
    (`repositories/transactions/core.ts:586-608`, `confirmations < 6`); the only other caller of
    `refreshWalletConfirmations` is the user-triggered `syncCoordinator.updateWalletConfirmations` (`:338-343`). The
    admin UI allows a deep threshold up to 100 (`src/components/Variables/ThresholdsCard.tsx:29,38`). So compute
    `tracked = Math.min(deep, PENDING_CONFIRMATION_CANDIDATE_THRESHOLD)`, where
    `PENDING_CONFIRMATION_CANDIDATE_THRESHOLD = 6` is exported from `server/src/services/sync/confirmationUpdater.ts`
    (rename the existing `CONFIRMATION_THRESHOLD` at `:32`, or alias it; the file is already B3-owned).
    `headerConfirmationUpdater.ts` is not edited: its own `6` is the same value (noted in the P3). If importing the
    constant from `confirmationUpdater.ts` into `endpointService.ts` breaks `endpointService.test.ts` collection or
    adds a cycle to `check:server-cycle-baseline`, that is a D-15.X3 stop (do not move the constant to an unowned
    file).
  - It throws `InvalidInputError` (400, `INVALID_INPUT`) when the threshold is greater than `tracked`:
    `` `confirmationThreshold ${threshold} is above the confirmation-tracking horizon ${tracked}. Confirmations stop
    being tracked at ${tracked}, so this webhook would never fire. Use ${tracked} or less.` `` Equal is allowed (the
    update that reaches `tracked` is still recorded, `updateConfirmations.ts:43-58`).
  The webhook is **never fired early** and nothing is clamped. The Zod range at `api/wallets/webhooks.ts:32` stays
  (shape validation); the route's existing error handler maps the service error to 400. A PATCH that changes other
  fields of an endpoint already above the threshold is not refused (known limitation). No OpenAPI change: webhook
  filters are not described there (`grep confirmationThreshold server/src/api/openapi` finds only admin and bitcoin
  schemas).

**Production changes.**
- `server/src/services/webhooks/subscriptions.ts`: `crossesEndpointConfirmationThreshold` + import of
  `WEBHOOK_EVENT_TRANSACTION_CONFIRMED` (D-15.B3b).
- `server/src/services/webhooks/deliveryService.ts:61-74`: optional `admits` predicate (D-15.B3e).
- `server/src/services/webhooks/eventBuilder.ts`: `buildConfirmationWebhookEventsForBatch`, `isNotificationType`,
  `dispatchPath` parameter (D-15.B3e/f).
- New `server/src/services/webhooks/confirmationDeliveries.ts` (D-15.B3e).
- `server/src/services/webhooks/endpointService.ts`: `assertConfirmationThresholdTracked` + two calls (D-15.B3h).
- `server/src/services/sync/confirmationUpdater.ts`: logger, `queueConfirmationWebhooks`, one call in
  `recordCommittedUpdates` (D-15.B3a/d); exported `PENDING_CONFIRMATION_CANDIDATE_THRESHOLD` (D-15.B3h, review pass 1).

**Tests first.** Backend, failing on base:
1. New `server/tests/unit/services/sync/confirmationUpdater.webhooks.test.ts` (128 lines). Black-box through the real
   `refreshWalletConfirmations`: mocks `config`, `infrastructure` (lock + `queueWebhookDeliveryNotification` → `true`),
   `jobs/syncJobContract`, `bitcoin/blockchain` (`populateMissingTransactionFields` → no updates;
   `updateTransactionConfirmations` → the scripted update), `updateConfirmations`, `eventService`, `utils/logger`, and
   `repositories` (`transactionRepository.findManyByTxids`, `walletRepository.findById`, `webhookRepository.listEndpoints/
   createDelivery`); the real `webhooks/*` modules run. Uses `makeEndpoint` from `../webhooks/deliveryService.fixtures`.
   - **"queues wallet.transaction.confirmed once when a mempool transaction gets its first confirmation"**: default-events
     endpoint, update 0→1 → `createDelivery` called exactly once with `eventType: 'wallet.transaction.confirmed'`, `eventId:
     'wallet:wallet-1:tx:tx-1:wallet.transaction.confirmed:v1'` (`vi.waitFor`). **Observed red:** `expected "vi.fn()" to be
     called 1 times, but got 0 times`.
   - **"delivers every subscribed event to a threshold endpoint when the threshold is reached"**: `eventTypes: ['*']`,
     `filters: { confirmationThreshold: 2 }`, update 1→2 → three deliveries `observed, received, confirmed` in that order.
     **Observed red:** `… 3 times, but got 0 times`.
   - **"logs, and does not fail the refresh, when a delivery cannot be queued"**: `createDelivery` rejects → refresh
     resolves (`confirmationUpdateCount: 1`), warn `('Confirmation webhooks partially queued', { walletId, errors: ['db
     down'] })`. Red on base (no warn).
   - **"logs, and does not fail the refresh, when endpoints cannot be read"**: `listEndpoints` rejects → warn `('Failed to
     queue confirmation webhooks', { walletId, error: 'endpoints unavailable' })`. Red on base.
2. New `server/tests/unit/services/webhooks/confirmationDeliveries.test.ts` (95 lines; deterministic, awaited; red on base
   by the missing module):
   - **"does nothing for confirmation decreases (reorg) or no change"** → `{ queued: 0, errors: [] }`, no endpoint lookup;
   - **"skips building events when the wallet has no enabled endpoint"** → `findManyByTxids` not called;
   - **"does not re-queue a confirmed event the endpoint already crossed"** (default endpoint, 1→2) → no `createDelivery`;
   - **"waits for a threshold and fires on the change that jumps across it"** (threshold 3, default events: 0→2 nothing, then
     2→5 → `received`, `confirmed`; `eventPayload.source.dispatchPath === 'sync.confirmation'`);
   - **"ignores stored rows that are not notifiable transaction types"**;
   - **"skips a change whose transaction is no longer stored"**.
3. `server/tests/unit/services/webhooks/eventBuilder.test.ts` (167 lines): `buildConfirmationWebhookEventsForBatch`
   returns `[]` without repository calls for `[]`, and `[]` when the wallet is missing (covers the two early returns the
   orchestrator never reaches).
4. `server/tests/unit/services/webhooks/webhookCore.test.ts` (703 lines): `it.each` table for
   `crossesEndpointConfirmationThreshold` — `(no filter, observed, 0, 1) → false`, `(no filter, confirmed, 0, 1) → true`,
   `(no filter, confirmed, 1, 2) → false`, `(threshold 0, confirmed, 0, 1) → true`, `(threshold 3, received, 1, 2) → false`,
   `(threshold 3, received, 2, 3) → true`, `(threshold 3, confirmed, 0, 6) → true`, `(threshold 3, confirmed, 3, 2) → false`.
5. *(coordinator, at assembly)* `server/tests/unit/services/webhooks/endpointService.test.ts` (641 lines; add
   `systemSettingRepository: { getParsed: mockGetParsed }` to its `src/repositories` mock): **"refuses a confirmation
   threshold above the deep confirmation threshold on create"** (`getParsed` → 3, threshold 6 → rejects
   `InvalidInputError` whose message names 6 and 3; `mockCreateEndpoint` not called); **"refuses it on update"** (same,
   `mockUpdateEndpoint` not called); **"accepts a threshold equal to the deep confirmation threshold"** (3 → created);
   **"does not read the setting when no threshold is set"** (`getParsed` not called); *(review pass 1, B-2)* **"refuses a
   threshold above the six-confirmation candidate horizon even when the deep threshold is higher"** (`getParsed` → 10,
   threshold 7 → rejects `InvalidInputError` whose message names 7 and 6; `mockCreateEndpoint` not called). Red on base
   for the three refusals (the save resolves: `promise resolved "{ id: 'endpoint-1', …(21) }" instead of rejecting`,
   observed by the reviewer for create and update); the other two are green guards. No route case is added to
   `server/tests/unit/api/wallet-webhooks-routes.test.ts` (that file mocks the service); the 400 comes from the existing
   `InvalidInputError` mapping.

Confirm red (from `server/`): `node ../node_modules/.bin/vitest run tests/unit/services/sync/confirmationUpdater.webhooks.test.ts`
→ observed `2 failed` for the two delivery cases on the unmodified copy (the two log cases were added after and fail the
same way: no queueing happens on base). After the prototype fix: `tests/unit/services/sync tests/unit/services/webhooks
tests/unit/worker/jobs/confirmationJobs.test.ts tests/unit/services/notifications tests/unit/api/bitcoin` →
`41 files / 844 tests passed` (before the log cases), then `sync` + `webhooks` → `28 files / 474 passed`; server
`tsc -p tsconfig.json` and `tsc -p tsconfig.test.full.json` clean (apart from a pre-existing TS2883 in
`src/middleware/csrf.ts` that is an artefact of the symlinked scratch `node_modules`, not of this change).

**Existing tests that encode the old behaviour.** None fails.
- `server/tests/unit/services/sync/confirmationUpdater.test.ts` (1,000 lines; must not grow) mocks `models/prisma` without
  `webhookEndpoint` and does not mock the webhooks module, so the new hook's `listEndpoints` throws inside the un-awaited
  promise and is caught by D-15.B3d's `.catch` — the file passes unchanged (verified, no unhandled rejection).
  `confirmationUpdaterSettlementLock.test.ts`, `syncCoordinator.test.ts`, `worker/jobs/confirmationJobs.test.ts` pass.
- `eventBuilder.test.ts`, `deliveryService*.test.ts`, `webhookCore.test.ts:700` (`dispatchPath:
  'notifications.transaction'`) pass: defaults preserve the insert path.
- **E2E:** `grep -rln webhook tests/e2e` is empty; no API change, no mock map entry.

**Verification.** Worker: the files above; `cd server && npx tsc --noEmit && npm run typecheck:tests`; lint; lizard on the
six production files and the new/edited test files (prototype: zero warnings on the first five). Integrator: backend
unit coverage at 100% for `confirmationDeliveries.ts`, `eventBuilder.ts`, `subscriptions.ts`, `deliveryService.ts`,
`confirmationUpdater.ts` and `endpointService.ts` (D-15.B3h: both arms of the "threshold present" check and of the
comparison) (scope `tests/unit`); `npm run arch:check` in the primary checkout.

**Acceptance.** *(coordinator, at assembly; review pass 1, B-2)* Creating or updating an endpoint with
`confirmationThreshold` above the confirmation-tracking horizon, min(deep confirmation threshold, 6), returns 400 naming
the threshold and that bound, and nothing is written (D-15.B3h).
For a wallet with a default-events endpoint, a transaction first stored at 0 confirmations produces one
`wallet.transaction.confirmed` delivery when it reaches 1 confirmation, and none afterwards; an endpoint with
`confirmationThreshold` N (N ≤ the confirmation-tracking horizon) receives `observed`, `received`/`sent` and `confirmed` once,
on the refresh that reaches N; re-syncs, reorgs and races create no duplicate delivery rows; a webhook failure never fails
or slows a confirmation refresh.

**Rollback.** Revert the six production files and the new tests. Delivery rows already created are ordinary outbox rows
(no schema change); nothing to clean up.

### Phase B open questions

*(coordinator, at assembly)* **All DECIDED** — see the plan header: OQ-B3 → save-time 400 against min(deep threshold,
6) (D-15.B3h, review pass 1 B-2) plus the P3
`webhooks--threshold-above-deep-confirmation-never-fires` (replacing the drafted id below); OQ-B1 → harness mock
(D-15.B1c), the PNG baseline files stay unchanged and the screenshot assertions pass at the repo tolerance, and a
screenshot failure in the integrator's Playwright run is a D-15.X3 stop, not a regeneration (review pass 1, B-1); the
monitoring-URL P3 candidate → folded into B2 (D-15.B2e). The drafted text is kept as the record:

- **OQ-B3 — endpoint `confirmationThreshold` above the confirmation-tracking horizon.** Stored confirmations stop being
  refreshed once they reach `deepConfirmationThreshold` (default 3, admin-configurable;
  `updateConfirmations.ts:43-58`, `sync.ts:836-850`), while the API accepts thresholds up to 1,000,000
  (`api/wallets/webhooks.ts:32`). After B3, an endpoint with threshold 6 on a default install still never fires.
  **Recommendation:** keep B3 as planned (it fixes every threshold ≤ the horizon and the default subscription), and record
  a P3 follow-up `webhooks--confirmation-threshold-beyond-tracking-horizon`: reject or clamp, at save time, a threshold
  above `deepConfirmationThreshold`, mirroring the existing save-time 400 for an invalid `minAmountSats`
  (`subscriptions.ts:41-45`). Extending confirmation tracking for webhook endpoints is a larger change and not recommended
  inside this bug fix.
- **OQ-B1 — keep the render-regression PNG byte-identical (D-15.B1c) or regenerate it.** **Recommendation:** adjust the
  harness mock (D-15.B1c); regenerate `dashboard-testnet-shell-chromium-linux.png` in the CI Playwright image only if the
  integrator's local Playwright run shows a pixel diff anyway.
- **P3 candidate (observation, not planned):** `PUT /admin/settings` accepts any key, so `monitoring.grafanaUrl`,
  `monitoring.prometheusUrl` and `monitoring.jaegerUrl` written through it would be stored JSON-quoted while
  `adminMonitoringService.ts:54-56` reads them raw (their own writer, `:111`, stores raw). Proposed id
  `admin-settings--monitoring-urls-json-quoted-via-generic-put`; the fix would reuse `decodeStoredString` there.

## Phase C — supply-chain lock gate (C1)

One finding, one phase, one worktree (`/home/nekoguntai/sanctuary-bug-scrub-20261013-i15-c`, branch
`codex/bug-scrub-loop/20261013-i15-c`, never `/tmp`).

**Phase file ownership:**
- `scripts/ci/check-supply-chain-locks.mjs`
- `tests/ci/check-supply-chain-locks.test.mjs`
- `.github/workflows/podman-socket-canary.yml`, line 125 only
- `tests/install/utils/helpers.sh`, lines 543 and 719 only
- `tests/install/e2e/upgrade-install.test.sh`, line 2351 only

`config/container-image-lock.json` is **not** edited (D-15.C6).

Everything below was reproduced on a scratch copy of `560e8f110e` (`git archive HEAD`, then `git init`) with
node v24.21.0 and lizard 1.24.0, the version pinned in `scripts/quality/lizard-requirements.txt`. The scratch copy
holds the full patch:
- gate diff: `scratchpad/plan15-C-gate.diff`;
- unit test diff: `scratchpad/plan15-C-tests.diff`;
- live-reference diff: `scratchpad/plan15-C-live-fixes.diff`.

### Phase C1 — The image lock gate sees untagged images, continued `docker run` lines and every image-pulling source (P2 `ci-supply-chain-locks--line-local-image-scan-misses-untagged-and-continuation-refs`)

**Evidence (re-verified on `560e8f110e`).**
- **Token shape.** `IMAGE_TOKEN` (`scripts/ci/check-supply-chain-locks.mjs:9`) matches only `<ref>@sha256:<64hex>` or
  `<ref>:<tag>`.
  - An untagged reference such as `FROM alpine`, `image: postgres` or `image: docker.io/library/redis` yields no token.
  - So it is never reported as "absent from the lock" or "not digest-pinned"; the fixture tests below get `''` back.
- **Line-local context.** `contextualImageLine` (`:61-66`) and `extractImageUses` (`:74-86`) test one physical line at
  a time.
  - The image argument of a backslash-continued `docker run` sits on a later line, so it is never examined.
  - Only the first line of the command matches `/\bdocker\s+(?:run|pull)\b/` (`:64`).
  - `docker create` is not a context at all.
- **Hand-picked file set.** `isImageSource` (`:35-48`) accepts every Dockerfile, but YAML only under four prefixes,
  three `config/*.json` files and exactly three scripts (`:43-47`). Every other `.sh` file is skipped, including:
  - `scripts/verify-addresses/verify-repeatable.sh:49`: `core_image='bitcoin/bitcoin:31.1@sha256:da25…'`, the
    wallet-proof oracle;
  - `scripts/offline/create-bundle.sh:212-214`;
  - `scripts/setup.sh:475` and `:1005-1023`, where the installer pulls 11 images;
  - `scripts/create-upgrade-backup.sh:277`;
  - `tests/install/utils/helpers.sh` and the install e2e harness.
- **Live instance.** `.github/workflows/podman-socket-canary.yml` has three problem references:
  - `:124-125` runs `docker run --rm … \` followed by `docker.io/library/alpine:3.20 test -S …`, with no digest. Lines
    `:339` and `:352` of the same file, and `config/container-image-lock.json:17`, pin that image to
    `sha256:d9e853e8…`.
  - `:173-180` uses `docker.io/tecnativa/docker-socket-proxy:latest@…`. The lock lists only
    `tecnativa/docker-socket-proxy:latest` (`:15`).
  - `:276-281` uses `docker.io/library/postgres:16-alpine@…`. The lock lists only `postgres:16-alpine` (`:13`).
  - The last two pass only because they sit on continuation lines. Lock entries are matched as exact strings, so these
    Docker Hub spellings would otherwise read as "absent from the lock".
  - `node scripts/ci/check-supply-chain-locks.mjs` on `560e8f110e` prints `Supply-chain image, toolchain, and
    funds-critical package locks verified` (rc 0).
- **Why the tests miss it.** `tests/ci/check-supply-chain-locks.test.mjs:70-92` only feeds single-line tagged
  references: `FROM example.invalid/proof:1.0.0` and `image: unknown.invalid/proof:1.0.0`.
- **Lizard state of the file (lizard 1.24.0, repository arguments from `scripts/quality.sh:284-291`).**
  - The repository baseline count is **84** warnings. The ceiling is `LIZARD_WARNING_BASELINE: '86'`
    (`.github/workflows/quality.yml:52`, mirrored at `scripts/quality.sh:21`).
  - One of the 84 is `check-supply-chain-locks.mjs:61: contextualImageLine has 205 NLOC … 205 length`.
  - That warning is a **misparse**: the lone `"` in the regex literal `/^\s*"/` at `:65` makes lizard read
    `contextualImageLine` as running to end of file. The comment at `:50-52` works around it instead of fixing it.
  - The misparse also **hides two real CCN warnings** inside that span: `inspectContainerLocks` (`:99-138`, CCN 22)
    and `verifyToolchainSources` (`:192-238`, CCN 28).
  - Measured on a scratch copy: replacing only the `"` with `\x22` turns 1 warning into 2, a net **+1**. A naive fix
    therefore makes the lizard lane worse.

**Root cause.** The gate decides "is this an image?" from what one physical line looks like. It decides "where can
an image be?" from a hand-maintained list. So references that are untagged, continued onto another line, or placed in
an unlisted file are invisible. And because "invisible" is indistinguishable from "verified", the gate passes. Lock
lookup is also a byte-exact string match, so Docker Hub's equivalent spellings (`docker.io/library/x` and `x`)
behave as different images.

**Fix design.**
- **D-15.C1 — Derive the scanned file set from git, not a hand list.**
  - Replace `isImageSource` (`:35-48`) with two functions:
    - `listImageScanFiles(root)`: `git -C <root> ls-files -z --cached --others --exclude-standard`. This covers
      tracked files plus new, unignored, uncommitted files. `.gitignore` already drops `node_modules/`, `dist/`,
      `coverage/`, `.tmp/` and `reports/`.
    - `imageSourceKind(file)` classifies each file:
      - `dockerfile`: `Dockerfile`, `Dockerfile.*`, `*.Dockerfile`, but not `*.dockerignore`;
      - `shell`: `*.sh`, `*.bash`;
      - `yaml`: `*.yml`, `*.yaml`;
      - `data`: `*.json`, `*.jq`, `*.{c,m,}js`, `*.ts`;
      - anything else is skipped.
  - Documented exclusions, as the `IMAGE_SCAN_EXCLUDED` regex with a comment above it:
    - `docs/`, `tasks/`, `reports/`: prose and plans;
    - any `fixtures/` directory, and `scripts/verify-addresses/output/`: generated or fixture data;
    - `server/tests/`;
    - `tests/`, **except** `tests/install/utils/` and `tests/install/e2e/`. Those drive a real daemon in the install
      lanes (C-Q2).
  - `existsSync` filters tracked-but-deleted paths.
  - `walk` (`:21-33`) stays for the OS-package review sweep (`:142`) and the manifest/lockfile sweep (`:244`). Their
    behaviour is unchanged and out of this finding's scope.
  - The unit fixtures become git repositories (`git init --quiet` in `fixture()`) and still need no commits.
  - When `--root` is not a git work tree, `execFileSync` throws `fatal: not a git repository`, which fails closed.
    *(review pass 1, C-5)* `listImageScanFiles` wraps the git call and throws
    `Error('image scan needs a git work tree at <root>: <message>')` (no catch-and-continue; CCN +1, still ≤ 11), so a
    non-git root or a missing `git` (`spawnSync git ENOENT`) prints a gate message instead of a bare stack. Untracked,
    unignored files are scanned on purpose (a new file must not bypass the gate before it is committed); a local
    `npm run check:supply-chain-locks` in a checkout with stray scratch `.sh/.json/.yml` files outside `tasks/` can
    therefore fail.
    Every caller passes a checkout: the `quality.yml:105` determine-scope step, `renovate-preflight.yml:69`,
    `package.json:130` and `scripts/bump-funds-critical.sh:302`. `tests/ci/esm-main-guard-symlink.test.mjs:72` runs
    the CLI in a non-git copy and still passes, because the lock-file read fails first.
- **D-15.C2 — Join backslash continuations and drop full-line comments before matching.**
  - `logicalLines(contents, kind)` concatenates every line ending in `\` with the next one. It reports the **first**
    line's number, so errors point at the `docker run` line (for example `podman-socket-canary.yml:124`).
  - For `dockerfile`, `shell` and `yaml` files, lines whose first non-blank character is `#` become empty. `data`
    files have no `#` comments.
- **D-15.C3 — Extract the image argument structurally, so untagged references are found.** `structuredImage` returns
  at most one image per logical line:
  - Dockerfile `FROM [--platform=…] <img> [AS <stage>]`:
    - records `<stage>`;
    - returns nothing when `<img>` names an earlier stage (`FROM node-toolchain`, `FROM runtime-base`, as at
      `server/Dockerfile:12/34/65/131/166`, `gateway/Dockerfile:11/29/41` and `docker/frontend/Dockerfile:13/33`), or
      when it is `scratch`.
  - YAML or compose `image: <ref>` / `- image: <ref>`, workflow `container: <ref>` and `uses: docker://<ref>`.
  - `docker|podman [container|image] run|create|pull …`, via `dockerCommandImage`:
    - shell-tokenizes the joined line, respecting `"…"` and `'…'`;
    - skips `--flag=value` tokens, boolean flags and array expansions like `"${OWNERSHIP_LABEL_ARGS[@]}"`;
    - skips the value of each flag in `DOCKER_VALUE_FLAGS`: the docker run/create options that take a value, such as
      `-v`, `-e`, `--name`, `--network`, `-p`, `--platform`, `--entrypoint` and `--cidfile`;
    - returns the first remaining token.
  - A new check in `checkImageUse` reports any candidate without a tag or digest as
    `<file>:<line> external image is untagged and not digest-pinned: <ref>`, before the lock lookup.
- **D-15.C4 — Two further match sources, which keep or generalize the existing special cases:**
  - **Digest-anchored tokens**: any `<ref>@sha256:<64hex>` in a scanned file of any kind, on any logical line. A digest
    is unambiguous, so this has no false positives. It catches:
    - `verify-repeatable.sh:49`;
    - `create-bundle.sh:212-214`;
    - `setup.sh`;
    - `create-upgrade-backup.sh:277`;
    - `scripts/verify-addresses/standardsOracle.ts:24/29`;
    - `scripts/perf/wallet-sync-high-fanout-replay.mjs:19`;
    - `scripts/verify-psbt/proof-manifest.json:3`;
    - `config/ledger-emulator/proof.json:7/10`;
    - `scripts/ci/validate-jade-protocol-manifest.jq:18`.

    These are all locked today; from now on they are checked for drift.
  - **Tagged contexts** (`isTaggedContext`) apply the existing `IMAGE_TOKEN` to:
    - `"image":` and `image:` lines in any kind;
    - shell assignments whose name contains `image` (`readonly|local|export`, optional), which generalizes the
      `TRIVY_IMAGE=` special case at `:62`;
    - the existing `scripts/offline/bundle-common.sh` quoted-element rule (`:65`), kept so that dropping a digest there
      still fails.
- **D-15.C5 — Treat Docker Hub spellings of one image as one lock entry.**
  - `canonicalReference` strips a leading `docker.io/` or `index.docker.io/`, then `library/` when one path component
    remains.
  - It is applied to lock keys in `readLockedImages` and to lookups in `checkImageUse`.
  - Duplicate detection now runs on the canonical key, so `postgres:16-alpine` and
    `docker.io/library/postgres:16-alpine` cannot both be locked with diverging digests.
  - Messages keep the reference exactly as written, and "unused locked image entry" prints the lock's own spelling.
  - The canary keeps its fully qualified names (C-Q1).
- **D-15.C6 — Live violations: pin each one to an existing lock entry. No lock-file edit.**
  - Running the fixed gate on unmodified `560e8f110e` reports exactly four errors and nothing else (rc 1).
  - All four resolve to digests that are already locked, so `config/container-image-lock.json` keeps its bytes. That
    means:
    - its SHA, carried as `SANCTUARY_IMAGE_LOCK_SHA256` / `dev.sanctuary.image-lock-sha256`, does not change
      (`scripts/ownership/producer-hooks.sh:81/280`, `scripts/offline/create-bundle.sh:200`);
    - the `docker-build.yml` path trigger (`:29`) does not fire.

  | # | Reported by the fixed gate on `560e8f110e` | Exact edit | Lock entry used |
  |---|---|---|---|
  | 1 | `.github/workflows/podman-socket-canary.yml:124 external image is not digest-pinned: docker.io/library/alpine:3.20` | `:125` `docker.io/library/alpine:3.20 test -S` → `docker.io/library/alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc test -S` (the same pin as `:339`/`:352`) | `config/container-image-lock.json:17` (runner-canary) |
  | 2 | `tests/install/e2e/upgrade-install.test.sh:2350 external image is not digest-pinned: postgres:16-alpine` | `:2351` `postgres:16-alpine \` → `postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 \` (the digest the installed stack already runs). *(review pass 1, C-4)* The result is captured with `2>/dev/null \|\| true` (`:2349-2352`), so a pull failure reads as `Database did not accept the synchronized PostgreSQL password …` (`:2354-2356`); check the image before reading that as a `setup.sh` regression. `setup.sh:475` runs the identical reference (see Delivery). No code change (line scope stays 1/1). | `:13` (production-and-ci-service) |
  | 3 | `tests/install/utils/helpers.sh:543 external image is absent from the lock: alpine:3` | `:543` `alpine:3 \` → `alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b \` (read-only `ls` probe) | `:16` (test-runtime, as `docker/compose/test.yml:188`) |
  | 4 | `tests/install/utils/helpers.sh:718 external image is absent from the lock: alpine:3` | `:719` `alpine:3 sleep 300` → `alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b sleep 300` (`docker create` holder for `docker cp`) | `:16` |

  - The canary references at `:180` and `:281` need no edit: under D-15.C5 they resolve to `:15` and `:13` with
    matching digests.
  - No test asserts the literal `alpine:3` or the bare `postgres:16-alpine` at those lines (checked with
    `git grep`).
  - `config/resource-lifecycle-callsites.json` keys these files by path only, with no line pins.
    `node scripts/ownership/check-lifecycle-callsites.mjs` stays green.
  - **Scan delta (scratch copy).** Compared with the base scan, the fixed scan finds 93 image uses against 64.
    - It **loses none** of the 64.
    - Of the 29 new uses, 25 are locked and correctly pinned; the other four are the violations above.
- **D-15.C7 — Lizard: remove the misparse and the two CCN warnings it was hiding. Net 84 → 83.**
  - Every quote, `#` or `//` inside a new regex literal is written as `\x22`, `\x27`, `\x23` or `[/]`. Lizard 1.24.0
    misreads each of them, as measured one construct at a time. Examples:
    - `/^\s*"/` becomes `/^\s*\x22/`;
    - `/^\s*#/` becomes `/^\s*\x23/`;
    - `'\\'` becomes `'\x5c'`;
    - `docker\.io\//` becomes `docker\.io[/]`.
  - Split `inspectContainerLocks` into `readLockedImages`, `checkImageUse` and a short driver; the largest piece is
    CCN 10.
  - Split `verifyToolchainSources` into `verifyToolchainArtifacts` (CCN 9), `verifyGoRunnerImage` (CCN 9) and the
    remainder (CCN 11).
  - Delete the work-around comment at `:50-52`.
  - Measured on the patched scratch copy:
    - `lizard -w … scripts/ci/check-supply-chain-locks.mjs` reports **0** warnings;
    - every new function, measured alone, is CCN ≤ 11 and NLOC ≤ 26;
    - a full-repository run with the `quality.sh` arguments gives **83**. The only change from the base list is the
      removed `contextualImageLine` line.
  - Leave `LIZARD_WARNING_BASELINE` at 86 (C-Q3).
- **False-positive handling (each one is a fixture case or a measured property).**
  - **Shell variables.** Any candidate containing `$` is skipped (`"$IMAGE"`, `${image_name}`, `FROM ${BASE}`,
    `image: sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local}`). The existing `isLocalImage` `${` rule
    (`:95-97`) and `localImagePrefixes` still apply.
  - **Array expansions** of label flags are skipped as flag groups.
  - **Shape check.** A candidate that is not a lowercase image reference (`IMAGE_REFERENCE`) is dropped:
    - the `\\` in `scripts/bitcoin-core-docker/build.sh:105`'s `echo` text;
    - `printf 'docker pull:%s'` in tests;
    - prose words after `docker create` in assertion messages.
  - The existing `looksLikeImageReference` filters still apply: `.sock`, `:ro`, `host-gateway`, `localhost` and
    numeric prefixes.
  - **Comments** are blanked (D-15.C2).
  - **Docs, plans, fixtures and unit-test data** are excluded by path (D-15.C1). On the base tree this removes 17 lock errors plus 3 shape-dropped tokens:
    - `tests/ci/verify-addresses-repeatable.test.sh`;
    - `tests/install/unit/{offline-bundle-script,upgrade-helpers,upgrade-backup-script,install-script}.test.sh`;
    - `server/tests/unit/utils/docker/tor-create.contracts.ts`.

    All of these are fixture strings or deliberately wrong digests.
  - **Unknown value flags** fail closed. A future `docker run --gpus all img` would report
    `untagged and not digest-pinned: all`; the fix is to add the flag to `DOCKER_VALUE_FLAGS`, never to exclude the
    file.
  - **Residual, out of scope (C-Q4).**
    - Images assembled at run time from variables (`docker pull "$runtime_image"`, `"$VERIFY_PSBT_CORE_IMAGE"`) are
      checked only where their value is a literal in a scanned context.
    - `server/src/utils/docker/tor.ts:19-23` builds `dperson/torproxy@<digest>` from two constants, so no token
      matches it.
    - *(review pass 1, C-6)* `docker`/`podman` argv arrays in `.mjs/.cjs/.ts` sources
      (`scripts/ci/write-runtime-image-evidence.mjs:80`, `scripts/perf/wallet-sync-high-fanout-replay.mjs:612-680`,
      `scripts/verify-addresses/implementations/python.ts:61`), which the data kind scans only for digest tokens and
      `image:` keys. Today each takes a variable or a digest-pinned constant, so nothing is missed, but a future literal
      `'alpine:3'` in such an array would pass.

**Failing-first tests** (`tests/ci/check-supply-chain-locks.test.mjs`; `fixture()` gains `git init --quiet`):
1. `rejects untagged images in Dockerfile, compose and workflow image contexts`. Fixture files:
   - `docker/proof/Dockerfile`: `FROM …@D AS base` / `FROM base` / `FROM alpine`;
   - `docker/compose/proof.yml`: `image: postgres` / `image: "docker.io/library/redis"`;
   - `.github/workflows/proof.yml`: `container:` / `image: node`.

   It expects `untagged and not digest-pinned` at `Dockerfile:3`, `proof.yml:3`, `proof.yml:5` and the workflow's
   `:4`, and no error for the `base` stage.
   - **RED on base:** `The input did not match … /docker\/proof\/Dockerfile:3 external image is untagged and not
     digest-pinned: alpine/. Input: ''`.
2. `checks the image argument of a backslash-continued docker run`. A workflow `run: |` block has two commands:
   - `docker run --rm "${labels[@]}" -v "$sock:…:ro" \` / `example.invalid/proof:1.0.0 test -S …`;
   - `docker run -d --name proxy \` / `-e CONTAINERS=1 \` / `docker.io/unknown/proxy:latest@D`.

   It expects `proof.yml:5 … not digest-pinned` and `proof.yml:7 … absent from the lock`.
   - **RED on base:** `… /proof\.yml:5 external image is not digest-pinned: example\.invalid\/proof:1\.0\.0/. Input:
     ''`.
3. `scans every shell script that names an image, not a fixed list`. Fixture files:
   - `scripts/verify-addresses/verify-repeatable.sh`: `core_image='example.invalid/proof:1.0.0@sha256:bbbb…'`, a
     drift;
   - `scripts/offline/create-bundle.sh`: a continued `printf` of `"unknown.invalid/db:16@D"`, absent from the lock;
   - `tests/install/utils/helpers.sh`: `docker run --rm -v … unknown.invalid/probe:3 ls`, absent from the lock.
   - **RED on base:** `… /verify-repeatable\.sh:1 image digest drift for example\.invalid\/proof:1\.0\.0/. Input: ''`.
4. `treats Docker Hub spellings of one image as the same lock entry`.
   - The lock gains `docker.io/library/hubimage:1.0` and `docker/compose/hub.yml` uses `image: hubimage:1.0@D`; the
     test expects `[]`.
   - It then adds `hubimage:1.0` to the lock and expects `duplicate locked image reference: hubimage:1.0`.
   - **RED on base:** deep-equal fails with `docker/compose/hub.yml:3 external image is absent from the lock:
     hubimage:1.0` and `unused locked image entry: docker.io/library/hubimage:1.0`.
5. `ignores variables, comments, gitignored paths and test fixtures`. A guard against false positives; it is green on
   both base and fix. Fixture files:
   - `# docker run alpine sh`, `docker pull "$IMAGE"` and a run of `"$image"` after a label-array expansion;
   - an `echo "  docker run --rm ${image_name} --version"`;
   - `FROM ${BASE}` and `FROM scratch`;
   - a gitignored `ignored/Dockerfile` with `FROM alpine`;
   - `tests/ci/proof.test.sh` and `docs/how-to/proof.md` with `docker run --rm alpine`.

   It expects `[]`.

Observed on the scratch copy:
- Tests added on base: `ℹ pass 10`, `ℹ fail 4`. Tests 1–4 fail as quoted; the nine existing tests and test 5 pass.
- With the fixed gate: `ℹ pass 14`, `ℹ fail 0`.

The existing tests at `:66-175` pass unchanged, including the offline-overlay alias test (`:81-92`). With the new
`git init`, the file's temp-fixture lifecycle registration (`config/resource-lifecycle-callsites.json:1748`) still
holds.

**Confirm RED first** (worktree at `560e8f110e`, tests added, gate not yet edited):
```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
node --test tests/ci/check-supply-chain-locks.test.mjs        # red: tests 1-4 (pass 10, fail 4)
```
Then apply D-15.C1–C5 and C7 to the gate.
1. Re-run the suite: 14/14 green.
2. Run `node scripts/ci/check-supply-chain-locks.mjs`. It must fail with exactly the four D-15.C6 errors (rc 1); this
   is the live-tree RED.
3. Apply the four D-15.C6 edits and verify:
```bash
node scripts/ci/check-supply-chain-locks.mjs                    # "…locks verified", rc 0 (0.3 s on scratch)
node --test tests/ci/check-supply-chain-locks.test.mjs          # 14/14
node --test tests/ci/esm-main-guard-symlink.test.mjs            # 3/3 (CLI still exits via its guarded path)
bash tests/ci/podman-socket-canary-composition.test.sh          # "composition checks passed"
node scripts/ownership/check-lifecycle-callsites.mjs            # registry complete
node scripts/ci/check-negated-test-assertions.mjs
node scripts/quality/check-large-files.mjs                      # gate 366 lines, test 247 lines: far below 800/1000
bash -n tests/install/utils/helpers.sh tests/install/e2e/upgrade-install.test.sh
lizard -w -l javascript -C 15 -T nloc=200 scripts/ci/check-supply-chain-locks.mjs   # 0 warnings (lizard 1.24.0)
# full-repo lizard with scripts/quality.sh:284-311 arguments: `grep -c ': warning:'` must be ≤ 83 (D-15.X1; measured 83)
```
`bash tests/ci/check-workflow-composition.test.sh` also needs `npm ci --prefix tests/ci/lib …`, as in quality.yml's
classifier job. Run it, because the PR edits a workflow.

**CI lanes that exercise it, and how the PR proves it.**
- **Determine Quality Scope** runs the edited gate on the PR head (`quality.yml:98-106`, always-on since D-14.C5).
  Its green `Check supply-chain locks` step is the end-to-end proof on the real tree.
- **CI classifier tests** runs the unit suite (`quality.yml:864`). Both `scripts/ci/*` and `tests/ci/*` route there.
- **Install lanes.** `scripts/ci/*`, `tests/install/*` and `.github/workflows/*` are all on the release-surface list
  (`tests/install/utils/classify-install-scope.sh:483-484`). On a PR, the release-surface install smoke and the bounded
  upgrade-baseline core lane run either way. `tests/install/utils/*` also sets `upgrade_harness_touched` (`:471-472`), but
  that adds no lane beyond these. *(review pass 1, C-3)* None of these lanes executes the three install-harness pins:
  `upgrade-install.test.sh:2351` is full-mode only (no CI lane), `helpers.sh:718-719` sits behind the
  monitoring-config sync, and `helpers.sh:543` runs only on the baseline's unhealthy-stack failure path
  (`upgrade-install.test.sh:1217`). *(review pass 2, C2-1; coordinator decision)* On the rootless-Podman fleet no lane
  reaches `:719` either: the harness always exports `SANCTUARY_MONITORING_CONFIG_DIR` (`upgrade-install.test.sh:170`,
  `:878`), so `sync_monitoring_configs_to_daemon` stands down at `helpers.sh:695-700` before `docker create`
  (`[sync] skipped: configs reachable at …`, observed for the `optional-profiles` fixture on kumo and the owned-source
  canary on sora in i14's all-fixture dispatch run 21232). The pins' pre-merge evidence is therefore **static**, and no
  manual dispatch is required:
  - `upgrade-install.test.sh:2351`: the byte-identical `postgres:16-alpine@sha256:57c72fd2…` reference that
    `scripts/setup.sh:471-476` already runs, in the same `docker run --network … psql` shape, on every upgrade
    (`reconcile_postgres_password_with_running_database`, `:1569`).
  - `helpers.sh:543` and `:718-719`: the `alpine:3.24@sha256:28bd5fe8…` digest that is already the lock's
    `test-runtime` entry (`config/container-image-lock.json:16`) and the `test-all` image at `docker/compose/test.yml:188`
    (reached through `npm run test:docker` → `scripts/ci/run-docker-test-subject.sh test-all`). No CI workflow runs the
    `test-all` service (`.github/workflows` references `run-docker-test-subject.sh` only in `bash -n` checks,
    `quality.yml:722`, `:879`), so this is reference identity, not proof of a CI pull.
  - For all three: the fixed gate, `bash -n`, and the registry check that each pinned digest is a multi-arch OCI index
    (amd64 and arm64 included).
  - The PR's own **Upgrade Baseline** (core mode) runs the changed harness files (`helpers.sh`,
    `upgrade-install.test.sh`) end to end, outside the pinned branches.
  - Expect that cost; it is not a signal about the gate.
  - If it fails, triage infrastructure causes first (CLAUDE.md) before reading it as a regression of another phase.
- **Podman socket canary.** `podman-socket-canary.yml` is `workflow_dispatch`-only (`:21-33`), so the PR does not run
  it. The pinned reference is byte-identical to the one the same workflow already pulls at `:339`/`:352`. One optional
  dispatch on a Podman host after merge is enough confirmation; do not dispatch it as a retrigger.
- **Not affected.** No funds-critical pin, verifier vector, `verify-vectors.yml`, `sourceManifest` file or lock file is
  touched, so the provenance and supply-chain memories do not apply beyond running the gate itself.

**Acceptance.**
- `FROM alpine`, `image: postgres`, `image: docker.io/library/redis`, `container: node` and
  `docker run … \` + `<img>:<tag>` each fail the gate, in any tracked or unignored source of a scanned kind outside the
  documented exclusions.
- So does a digest-pinned reference in any shell, data or YAML file whose digest drifts from the lock.
- The real tree passes after the four D-15.C6 edits with **no lock-file change**. The fixed scan finds a superset of
  the base scan's 64 uses.
- `docker.io/library/<x>` and `<x>` resolve to one lock entry, and both cannot be locked at once.
- The gate file has 0 lizard warnings, and the repository count goes from 84 to 83.

**Rollback.** Revert the C1 commit. The gate returns to line-local, hand-listed scanning, and the four references
return to their mutable tags. There is no lock, state or artifact change to undo.

---

### Phase C open questions

*(coordinator, at assembly)* **All DECIDED as recommended** — see the plan header: C-Q1 normalise in the gate, C-Q2 include
`tests/install/{utils,e2e}`, C-Q3 leave the ceiling at 86, C-Q4 P3 residual
`ci-supply-chain-locks--variable-built-image-refs-unscanned` (replacing the drafted id below). The drafted text is kept
as the record:

- **C-Q1 — Docker Hub spellings: canonicalize in the gate (D-15.C5), or keep exact-string matching?**
  - The alternatives:
    - add two duplicate lock rows (`docker.io/tecnativa/docker-socket-proxy:latest`,
      `docker.io/library/postgres:16-alpine`, scope `runner-canary`);
    - or shorten the canary's references to the unqualified names.
  - **Recommendation: canonicalize.**
    - Duplicate rows for one image can drift apart independently, while the canonical key makes that a hard error.
    - The canary uses fully qualified names on purpose: rootless Podman's short-name resolution is the thing it probes.
    - Adding rows changes the lock file's bytes, which changes `SANCTUARY_IMAGE_LOCK_SHA256` on every image built
      after the merge and fires the `docker-build.yml` trigger for no functional reason.
- **C-Q2 — Should `tests/install/utils/` and `tests/install/e2e/` be in the scan?**
  - They are the only `tests/` paths that pull images on a real daemon. Including them is what surfaces rows 2–4 of
    the D-15.C6 table.
  - The alternative is to exclude all of `tests/` and file the three mutable install-lane pulls as a P3.
  - **Recommendation: include them.**
    - `alpine:3` and an untagged-digest `postgres:16-alpine` are real mutable pulls in CI.
    - The pins reuse already-locked digests.
    - The PR already pays for the release-surface install smoke and upgrade-baseline lanes because it edits
      `scripts/ci/*`, so including them adds no lane.
- **C-Q3 — Lower `LIZARD_WARNING_BASELINE` from 86 to 83 in the same PR?**
  - The ceiling lives in two places, `quality.yml:52` and `scripts/quality.sh:21`, and
    `tests/ci/quality-lizard-bootstrap.test.sh:132-138` checks that they agree. Another phase may be merging in
    parallel.
  - **Recommendation: no.** Keep this PR to the gate. The ceiling only matters as a maximum, and 83 is under it.
    Ratcheting it belongs to the quality lane's owner, done once after the iteration's phases land, so a parallel phase
    cannot go red on a number this phase moved.
- **C-Q4 — Variable-indirected and split image references stay unchecked at the use site. Accept as a residual, or
  resolve shell variables?**
  - Examples:
    - `docker pull "$runtime_image"` (`scripts/ci/run-jade-protocol-harness.sh:190`);
    - `"$VERIFY_PSBT_CORE_IMAGE"` (`scripts/ci/run-psbt-core-subject.sh:30`);
    - `server/src/utils/docker/tor.ts:19-23`, which builds the Tor image from separate repository and digest
      constants;
    - *(review pass 1, C-6)* `docker`/`podman` argv arrays in `.mjs/.cjs/.ts` sources
      (`scripts/ci/write-runtime-image-evidence.mjs:80`, `scripts/perf/wallet-sync-high-fanout-replay.mjs:612-680`),
      which the data kind scans only for digest tokens and `image:` keys.
  - **Recommendation: accept and file a P3** (drafted as `ci-supply-chain-locks--variable-indirected-image-refs`;
    recorded as `ci-supply-chain-locks--variable-built-image-refs-unscanned`).
    - Every current definition site of those variables is a literal that D-15.C4 already checks (the emulator proof
      JSON, `standardsOracle.ts`, digest-anchored assignments).
    - `tor.ts` names its digest in a comment as "rotate only through container-image-lock review".
    - Resolving shell variables across files would need a real shell parser, which is out of proportion to a P2 fix.

## Implementation log (coordinator)

- (empty until the phase workers start; record the plan-commit SHA, each phase commit, each red/green run file
  `$SCRATCH/i15-<phase>-red*.txt` / `-green*.txt`, any D-15.X3 stop, the cherry-picked SHAs, the `/simplify` and
  adversarial-review outcome, the integrator commit and the Verification block's exit status.)
- *(post-implementation review fixes)* **B3 gap.** A mempool-first transaction's 0→N confirmation is usually
  committed by the canonical incremental sync's missing-field repair (`populateMissingTransactionFields` from
  `server/src/worker/jobs/canonicalIncrementalSync.ts`, which passed no commit handler), not by the confirmation
  sweep, so neither `wallet.transaction.confirmed` nor the in-app `transaction:confirmed` event was emitted. Fix: the
  call site now passes a commit handler that calls the new `publishCommittedConfirmationUpdates`
  (`confirmationUpdater.ts`), the same publish-and-queue step `recordCommittedUpdates` runs; nothing under
  `server/src/services/bitcoin` other than `evidenceAuthentication.ts` changed, and
  `config/wallet-sync-mutation-boundaries.json` and the replay driver seal are untouched. Red/green:
  `$SCRATCH/i15-fix-red.txt` / `i15-fix-green.txt` (`canonicalIncrementalSync.test.ts`). Review cleanups in the same
  commit: `PENDING_CONFIRMATION_CANDIDATE_THRESHOLD` moved to `server/src/constants.ts` (also replaces
  `headerConfirmationUpdater.ts`'s literal 6; removes the webhooks→sync import), `SystemSettingKeys.DEEP_CONFIRMATION_THRESHOLD`,
  `parseFilterConfig` shared by delivery and save-time threshold reads, endpoints listed once per confirmation enqueue,
  `systemSettingRepository.getString` for the B2 readers, `TRANSACTION_NOTIFICATION_TYPES`, one client fee-tier mapping
  (`src/app/feeTiers.ts`; not `src/utils`, which is a Tier-2 unscheduled surface), and the perf 409 parse and
  multipath descriptor shared from `scripts/perf/phase3-benchmark-utils.mjs`.
- *(post-implementation review fixes)* **C1 additions.** The image lock gate also follows `docker run` forms with more
  value-taking flags (`--ip`, `--memory-swap`, `--cpuset-cpus`, `--gpus`, …), digit-leading flag values, a `$VAR`
  argument before the image, a quoted or variable docker binary (`"$DOCKER" run`), and Containerfile and Makefile
  sources; `.github/actions/vendor/` is excluded from the image scan. Images launched from `execSync` strings inside
  `.mjs`/`.ts` stay in the C-Q4 P3 residual.

## Verification (before every push)

Workers run only their phase's typechecks and targeted tests (no coverage, no integration specs) and record red runs
on the plan-commit base. The integrator runs the whole block below, as written, as one script on the integrated PR
branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i15` (every `cd server` is in a subshell), only after every
phase branch is cherry-picked, and is the only one who runs coverage (backend and frontend), the integration specs,
the static Playwright run and the `docs/architecture/generated` regeneration; the coverage branches each phase names
are the integrator's checklist. Any `tests/install/unit` suite run directly (outside
`scripts/ci/run-install-unit-tests.sh`) needs the `@runtime` project-lock-root env. Write the block to
`$SCRATCH/i15-verify.sh` and run `bash "$SCRATCH/i15-verify.sh"` — never paste it into `bash -c` or the Bash tool: a
`pgrep -f` guard would match the integrator's own shell (the guard is anchored to `[n]ode_modules/.bin/...`).

**Integrator step before the block.** Set up the integration worktree like the phase worktrees (D-15.X2): a real root
`npm ci` (no symlinked `node_modules`), `cd server && npx prisma generate`, and `npm run build --workspace=shared`,
with nvm node on `PATH`. Then run `npm run arch:graphs` and `npm run arch:calls` and commit
`docs/architecture/generated` (if changed) in the integrator commit with the changelog bullets below, so `arch:check`
below is a pure check. Create the Playwright inputs under `$SCRATCH/i15-playwright/`: copy
`$SCRATCH/i14-playwright/playwright.static.config.mts` and `$SCRATCH/i14-playwright/known-auth-login-failures.txt`
there, and change the wrapper's import path from
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i14/config/tooling/playwright.config.ts` to
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i15/config/tooling/playwright.config.ts` (the block asserts it). Delete
any `results.json`, `failing.txt` or `unexpected.txt` copied by mistake.

**A2 integration red on a guarded base swap** *(review pass 1, A-5; coordinator decision)*. Workers may not run
integration specs, so the `core-crud.contracts.ts` red is recorded here, by the integrator, after every phase is
cherry-picked and before the block. It swaps in the base `walletCreate.ts` (no `git stash`: refs/stash is shared by
all worktrees), runs only the new integration case under the same integration lock as the block, restores the file and
verifies the restore. Write it to `$SCRATCH/i15-a2-integration-red.sh` and run `bash "$SCRATCH/i15-a2-integration-red.sh"`.
Any non-zero exit (a DB that does not start, a different red reason, or a failed restore) is a D-15.X3 stop; on a
failed restore, run `git checkout -- server/src/services/wallet/walletCreate.ts` and confirm `git diff --exit-code HEAD
-- server/src/services/wallet/walletCreate.ts` before anything else.

```bash
export PATH="$HOME/.nvm/versions/node/v$(cat /home/nekoguntai/sanctuary-bug-scrub-20261013-i15/.nvmrc)/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i15
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i15
BASE=560e8f110ed93246c659b25aaa063751cb3e09a0
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
F=server/src/services/wallet/walletCreate.ts
LOG="$SCRATCH/i15-a2-integration-red.txt"
test -z "$(git status --porcelain)"                 # clean tree before the swap
exec 9>/home/nekoguntai/.i15-integration.lock
flock 9                                             # same lock as the block's integration lines; held to exit
trap 'git checkout -- "$F"' EXIT                    # restore even if a later line fails
git show "$BASE:$F" >"$F"
test -n "$(git diff --name-only HEAD -- "$F")"      # the swap took effect
RC=0
npm --prefix server run test:integration:db -- tests/integration/flows/wallet.integration.test.ts \
  -t "refuses a signerless descriptor wallet" >"$LOG" 2>&1 || RC=$?
git checkout -- "$F"
git diff --exit-code HEAD -- "$F"                   # restore verified
test -z "$(git status --porcelain)"
trap - EXIT
test "$RC" -ne 0                                    # red on base code
grep -qF 'expected 400 "Bad Request", got 201 "Created"' "$LOG"   # the accepted red (D-15.X3), not another reason
grep -qE 'Tests +1 failed' "$LOG"                   # exactly the one filtered case failed
echo "A2 integration red recorded in $LOG; walletCreate.ts restored"
```

**Changelog bullets (integrator, `docs/reference/changelog.md` `## [Unreleased]`):**
- A1: "Wallets whose transaction history pays out more than 600,000 outputs in total sync again. A wallet whose
  history exceeds the per-sync evidence capacity now reports `attempt_evidence_capacity_exceeded` in its sync error
  instead of a generic complexity error."
- A2 (`### Changed`): "`POST /api/v1/wallets` with a descriptor and no signers now returns 400; import
  descriptor-only wallets with `POST /api/v1/wallets/import`, which links their signers. Known limitation: wallets
  already created from a descriptor alone are not repaired; they keep receiving but cannot spend, and the remedy is
  export and re-import."
- B1 *(review pass 1, B-4)*: "The Standard and Economy fee presets, the default send fee rate and the Dashboard's
  normal and slow fee tiers now use the ~3-block and ~6-block rates their labels describe (Economy was the ~12-block
  rate). The fee-rate overpay warning now compares against the displayed Economy rate."
- B2: "SMTP settings, the server name and monitoring service URLs saved through the admin settings API are read
  without their JSON quotes; a restored backup's disabled SMTP settings now read as not configured."
- B3: "Webhooks now receive `wallet.transaction.confirmed` when a transaction first seen unconfirmed confirms, and
  endpoints with a confirmation threshold receive their events when it is reached. Saving a threshold above the
  confirmation-tracking horizon (the deep confirmation threshold, at most 6) is rejected. Known limitation: endpoints
  saved earlier with a threshold above it still never fire."
- C1: "The supply-chain image lock check now finds untagged images, continued `docker run` lines and image references
  in every shell, YAML, Dockerfile and data source."

```bash
export PATH="$HOME/.nvm/versions/node/v$(cat /home/nekoguntai/sanctuary-bug-scrub-20261013-i15/.nvmrc)/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i15
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i15
test "$(npm --version | cut -d. -f1)" = 12   # devEngines requires npm 12; the system ~/.local/bin npm 11 fails EBADDEVENGINES
test -d node_modules       # real install present (one gate per line: a failing non-final && command does not exit under set -e)
test ! -L node_modules     # real install; a symlink breaks arch:graphs (shared/* edges)
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"   # D-15.X1 pinned binary
BASE=560e8f110ed93246c659b25aaa063751cb3e09a0
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
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
# One gate per line: under `set -e`, a failing non-final command of an `&&` list does not exit.
npm run build --workspace=shared
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )
# targeted backend: A1 (attempt ceiling, evidence harness), A2 (create service, API, OpenAPI contracts)
( cd server && npx vitest run tests/unit/services/bitcoin/sync tests/unit/services/wallet.test.ts tests/unit/api )
# B2 (stored-settings decode, email, verification, monitoring URLs, admin settings writer)
( cd server && npx vitest run tests/unit/services/email tests/unit/utils/safeJson.test.ts \
  tests/unit/services/adminMonitoringService.test.ts tests/unit/services/adminSettingsService.test.ts \
  tests/unit/services/adminSettingsService.atomic.test.ts tests/unit/repositories/systemSettingRepository.test.ts )
# B3 (confirmation funnel, webhooks, threshold save-time validation, worker confirmation jobs, notifications)
( cd server && npx vitest run tests/unit/services/sync tests/unit/services/webhooks tests/unit/worker/jobs/confirmationJobs.test.ts \
  tests/unit/worker/jobs/canonicalIncrementalSync.test.ts tests/unit/worker/jobs/syncJobs.test.ts \
  tests/unit/services/notifications tests/unit/api/wallet-webhooks-routes.test.ts )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only; scoped as CI
# integration (real DB via the compose-backed runner; serialized host-wide; D-15.X3 integration rule):
# A2 (core-crud and groups-telegram contracts run inside wallet.integration.test.ts; descriptor atomicity).
# B2/B3: regression-only (these specs reach emailVerificationService and updateWalletWebhook but not the new
# decode/threshold arms; the unit tests are the proof) (review pass 1, B-6)
flock /home/nekoguntai/.i15-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/wallet.integration.test.ts
flock /home/nekoguntai/.i15-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/walletDescriptorAtomicity.integration.test.ts
flock /home/nekoguntai/.i15-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/emailVerification.integration.test.ts
flock /home/nekoguntai/.i15-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/webhookHeaderPatch.integration.test.ts
# --- mutation pins (re-derived on 560e8f110e) ---
# Tier 1 — CI-enforced pins with line ranges, canaries or minScores: config/wallet-safety-mutation-map.json
# path/productionFile entries; the `mutate` lists of server/stryker.{fee-policy,psbt-account-binding,receive-evidence,
# taproot-artifact-finalization,taproot-construction}.config.mjs; the critical shards (server/scripts/mutation/shards.mjs,
# stryker.critical.config.mjs); config/tooling/stryker.{psbt-account-binding,wallet-policy}.config.mjs. NO planned change
# touches this surface. In particular A1/D-15.11 adds its reason label in evidenceAuthentication.ts and does not edit
# rawTransactionEvidence.ts (stryker.receive-evidence.config.mjs mutates that file whole).
PINNED_SURFACES=(
  server/src/services/bitcoin/advancedTx/batch.ts server/src/services/bitcoin/advancedTx/cpfp.ts
  server/src/services/bitcoin/advancedTx/rbf.ts server/src/services/bitcoin/psbtAccountBinding.ts
  server/src/services/bitcoin/psbtSigningContextValidation.ts server/src/services/bitcoin/rawTransactionEvidence.ts
  server/src/services/bitcoin/signingIntent server/src/services/bitcoin/transactionWeight.ts
  server/src/services/bitcoin/transactions/createBatchTransaction.ts server/src/services/bitcoin/transactions/outputBuilder.ts
  server/src/services/bitcoin/transactions/psbtConstruction.ts server/src/services/bitcoin/transactions/psbtInputConstruction.ts
  server/src/services/bitcoin/transactions/broadcastContracts.ts server/src/services/bitcoin/transactions/broadcasting.ts
  server/src/services/bitcoin/utxoSelection.ts server/src/services/bitcoin/addressDerivation.ts
  server/src/services/bitcoin/addressDerivation server/src/services/bitcoin/psbtValidation.ts
  server/src/services/bitcoin/psbtInfo.ts server/src/services/bitcoin/validationEvidenceContracts.ts
  server/src/services/bitcoin/blockchain/broadcastPreflight.ts server/src/repositories/transactionSigningIntentRepository.ts
  server/src/api/transactions/broadcasting.ts server/src/middleware/auth.ts server/src/services/accessControl.ts
  src/services/hardwareWallet/psbtAccountBinding.ts shared/constants/walletPolicy.ts
  config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")"
# Tier 2 — whole-file globs in Stryker configs no CI lane runs (server/stryker.conf.mjs; server/stryker.config.mjs;
# config/tooling/stryker.config.mjs): no line ranges, so nothing can move. Planned change there: B2 safeJson.ts only
# (an appended export). A2 removes walletCreate.ts's descriptorParser import but does not edit descriptorParser.ts.
UNSCHEDULED_SURFACES=(
  server/src/services/bitcoin/descriptorBuilder.ts server/src/services/bitcoin/descriptorParser.ts
  server/src/services/scriptTypes server/src/services/authService.ts server/src/services/encryption.ts
  server/src/services/twoFactorAuth.ts server/src/services/tokenRevocation.ts server/src/services/walletService.ts
  server/src/utils/errors.ts server/src/utils/safeJson.ts src/hooks src/utils shared
)
test "$(git diff --name-only "$BASE" HEAD -- "${UNSCHEDULED_SURFACES[@]}" | tr '\n' ' ')" = "server/src/utils/safeJson.ts "
# critical-path scope: under server/src/services/bitcoin only A1's file changed
test "$(git diff --name-only "$BASE" HEAD -- server/src/services/bitcoin | tr '\n' ' ')" = \
  "server/src/services/bitcoin/sync/evidenceAuthentication.ts "
# exact-file scope: the whole PR diff, minus tasks/ and docs/architecture/generated/, is exactly the ownership table
# plus the integrator's changelog
EXPECTED_FILES="$(sort <<'EOF'
.github/workflows/podman-socket-canary.yml
docs/reference/changelog.md
scripts/ci/check-supply-chain-locks.mjs
scripts/perf/phase3-benchmark-utils.mjs
scripts/perf/phase3-benchmark.mjs
scripts/perf/phase3-compose/large-wallet-history-proof.mjs
scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs
server/API.md
server/src/api/openapi/schemas/wallet.ts
server/src/constants.ts
server/src/repositories/systemSettingRepository.ts
server/src/services/adminMonitoringService.ts
server/src/services/bitcoin/sync/evidenceAuthentication.ts
server/src/services/email/emailService.ts
server/src/services/email/emailVerificationService.ts
server/src/services/notifications/channels/types.ts
server/src/services/sync/confirmationUpdater.ts
server/src/services/sync/headerConfirmationUpdater.ts
server/src/services/wallet/walletCreate.ts
server/src/services/webhooks/config.ts
server/src/services/webhooks/confirmationDeliveries.ts
server/src/services/webhooks/deliveryService.ts
server/src/services/webhooks/endpointService.ts
server/src/services/webhooks/eventBuilder.ts
server/src/services/webhooks/subscriptions.ts
server/src/utils/safeJson.ts
server/src/worker/jobs/canonicalIncrementalSync.ts
server/tests/integration/flows/wallet/core-crud.contracts.ts
server/tests/integration/flows/wallet/groups-telegram.contracts.ts
server/tests/integration/flows/walletDescriptorAtomicity.integration.test.ts
server/tests/unit/api/admin-monitoring-routes.test.ts
server/tests/unit/api/openapi.wallet.contracts.ts
server/tests/unit/repositories/systemSettingRepository.test.ts
server/tests/unit/services/adminMonitoringService.test.ts
server/tests/unit/services/bitcoin/sync/historyEvidenceAttemptCeiling.test.ts
server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts
server/tests/unit/services/email/emailService.storedSettings.test.ts
server/tests/unit/services/email/emailService.test.ts
server/tests/unit/services/email/emailVerificationService.test.ts
server/tests/unit/services/sync/confirmationUpdater.webhooks.test.ts
server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts
server/tests/unit/services/webhooks/confirmationDeliveries.test.ts
server/tests/unit/services/webhooks/deliveryService.fixtures.ts
server/tests/unit/services/webhooks/endpointService.test.ts
server/tests/unit/services/webhooks/eventBuilder.test.ts
server/tests/unit/services/webhooks/webhookCore.test.ts
server/tests/unit/utils/safeJson.test.ts
server/tests/unit/worker/jobs/canonicalIncrementalSync.test.ts
server/tests/unit/worker/jobs/syncJobs.test.ts
src/app/feeTiers.ts
src/components/Dashboard/hooks/dashboardDataModel.ts
src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts
tests/ci/check-supply-chain-locks.test.mjs
tests/components/Dashboard/dashboardDataModel.test.ts
tests/components/Dashboard/useDashboardData.networkIdentity.test.tsx
tests/components/Dashboard/useDashboardDataHarness.ts
tests/components/send/SendTransactionPage.branches.test.tsx
tests/components/send/SendTransactionPage.test.tsx
tests/components/send/formatFees.test.ts
tests/e2e/render-regression/renderRegressionHarness.ts
tests/install/e2e/upgrade-install.test.sh
tests/install/utils/helpers.sh
EOF
)"
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' ':(exclude)docs/architecture/generated' | sort)"
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# line-local scope inside shared files
test "$(git diff --numstat "$BASE" HEAD -- server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts | cut -f1-2)" = "$(printf '2\t2')"   # D-15.11: two label literals (:424, :458), nothing else
test "$(git diff --numstat "$BASE" HEAD -- .github/workflows/podman-socket-canary.yml | cut -f1-2)" = "$(printf '1\t1')"            # D-15.C6 row 1 (:125)
test "$(git diff --numstat "$BASE" HEAD -- tests/install/utils/helpers.sh | cut -f1-2)" = "$(printf '2\t2')"                          # rows 3-4 (:543, :719)
test "$(git diff --numstat "$BASE" HEAD -- tests/install/e2e/upgrade-install.test.sh | cut -f1-2)" = "$(printf '1\t1')"               # row 2 (:2351)
test -z "$(git diff --name-only "$BASE" HEAD -- config/container-image-lock.json)"                                                    # D-15.C6: lock bytes unchanged
# D-15.10: the Semgrep baseline pins backend-scale-out.mjs:24 by content; lines 1-24 are byte-identical
test "$(git show "$BASE":scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs | head -n 24 | sha256sum)" = \
  "$(head -n 24 scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs | sha256sum)"
node --check scripts/perf/phase3-benchmark.mjs
node --check scripts/perf/phase3-compose/large-wallet-history-proof.mjs
node --check scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs
# D-15.10 (review pass 2, A-1): the embedded proof script also parses, and the 409-reuse parse matches the server text
BSO_TMP="$(mktemp -d)"
node --input-type=module -e "import('./scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs').then((m) => process.stdout.write(m.getBackendScaleOutProofScript()))" > "$BSO_TMP/bso.mjs"
node --check "$BSO_TMP/bso.mjs"
rm -r -- "$BSO_TMP"
grep -qF 'A wallet with these devices already exists: "${wallet.name}"' server/src/services/walletImport/deviceResolution.ts
# (post-review) phase3-benchmark.mjs and large-wallet-history-proof.mjs import the parse from phase3-benchmark-utils.mjs;
# backend-scale-out.mjs keeps its inline copy (template-literal script, lines 1-24 pinned above)
grep -qF 'A wallet with these devices already exists: "' scripts/perf/phase3-benchmark-utils.mjs
for f in scripts/perf/phase3-benchmark.mjs scripts/perf/phase3-compose/large-wallet-history-proof.mjs; do
  grep -q 'duplicateWalletName(' "$f" || { echo "missing 409 parse: $f" >&2; exit 1; }
done
grep -qF 'A wallet with these devices already exists: "' scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs
for f in scripts/perf/phase3-benchmark.mjs scripts/perf/phase3-compose/large-wallet-history-proof.mjs scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs; do
  grep -q '409' "$f" || { echo "409 not accepted: $f" >&2; exit 1; }
done
# D-15.10 (review pass 1, A-6): no perf script sends the refused 'testnet' network. Written as `if … exit 1`, not
# `! grep`: set -e ignores the status of a `!`-inverted command, so `! grep` could never fail the block.
if grep -nE "network: *'testnet'|\|\| 'testnet'" scripts/perf/phase3-benchmark.mjs scripts/perf/phase3-compose/large-wallet-history-proof.mjs scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs; then echo "perf script still sends network 'testnet'" >&2; exit 1; fi
# D-15.11: the new label is set only in evidenceAuthentication.ts; the sealed driver still reads the per-transaction label
test "$(git grep -l attempt_evidence_capacity_exceeded -- server/src | tr '\n' ' ')" = "server/src/services/bitcoin/sync/evidenceAuthentication.ts "
grep -qF "rejectedEvidenceReasons.get('transaction_complexity_exceeded')" scripts/perf/wallet-sync-persistence-driver.cjs
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/components/send tests/components/Dashboard \
  tests/components/Dashboard.test.tsx tests/contexts/send tests/components/UTXOList.test.tsx tests/components/TransactionActions
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold
# Playwright (CLAUDE.md static-build procedure; no host dev server). Known limitation: the static server cannot answer
# POST /auth/login, so the 7 known cases fail here; the exit status is recorded, not gated. Bounded and non-vacuous.
PW_DIR="$SCRATCH/i15-playwright"
grep -qF "/home/nekoguntai/sanctuary-bug-scrub-20261013-i15/config/tooling/playwright.config.ts" "$PW_DIR/playwright.static.config.mts"
rm -f "$PW_DIR/results.json" "$PW_DIR/failing.txt" "$PW_DIR/unexpected.txt"
npm run build
if curl -fsS -o /dev/null http://127.0.0.1:4173/ 2>/dev/null; then echo "port 4173 already serving; refusing to test another build" >&2; exit 1; fi
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:4173/
kill -0 "$SRV"   # our server (not another process) answered
PW_RC=0
npx playwright test --config "$PW_DIR/playwright.static.config.mts" --reporter=json >"$PW_DIR/results.json" || PW_RC=$?
echo "playwright exit $PW_RC (recorded)"
test -s "$PW_DIR/results.json"
test "$(jq '.stats.expected + .stats.unexpected + .stats.flaky' "$PW_DIR/results.json")" -ge 380
jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | .file + " :: " + .title] | .[]' "$PW_DIR/results.json" | sort -u >"$PW_DIR/failing.txt"
comm -23 "$PW_DIR/failing.txt" "$PW_DIR/known-auth-login-failures.txt" >"$PW_DIR/unexpected.txt"
test "$(wc -l <"$PW_DIR/known-auth-login-failures.txt")" -eq 7
test ! -s "$PW_DIR/unexpected.txt" || { echo "Playwright failures beyond the 7 known auth/login cases:" >&2; cat "$PW_DIR/unexpected.txt" >&2; exit 1; }
# PNG baseline files unchanged (OQ-B1: B1 changes the harness fee mock so dashboard-testnet-shell keeps depicting its
# values; the screenshot compares at maxDiffPixelRatio 0.01, so it is a layout check, not a fee-pixel check; any
# screenshot failure is a D-15.X3 stop): nothing committed since BASE, and no new/modified/untracked file left by this
# run (Playwright's default updateSnapshots: 'missing' writes new baselines as untracked files)
git diff --exit-code "$BASE" HEAD -- tests/e2e/render-regression.spec.ts-snapshots
test -z "$(git status --porcelain -- tests/e2e/render-regression.spec.ts-snapshots)"
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i15-lizard.txt"   # cap 86 (C-Q3); pinned 1.24.0, no PyPI fetch
test "$(grep -c ': warning:' "$SCRATCH/i15-lizard.txt")" -le 83    # D-15.X1: base 560e8f110e = 84, minus D-15.C7's misparse, no new warnings; edit this literal only by the D-15.X1 procedure (C-8)
test -z "$(grep 'check-supply-chain-locks.mjs' "$SCRATCH/i15-lizard.txt" | grep ': warning:' || true)"   # D-15.C7: gate file at 0
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh
npm run check:architecture-boundaries
npm run check:server-cycle-baseline              # A2 must not add a wallet <-> walletImport cycle (D-15.5)
npm run check:bitcoin-network-boundaries
npm run arch:check                                 # pure check: graphs regenerated and committed before the block
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
npm run verify:signer-inventory
npm run check:safety-catch-guards                 # unchanged allowlist: no new catch in a scanned root
npm run check:wallet-sync-mutation-boundaries     # A1 adds no repository call
npm run check:wallet-sync-lifecycle-contract      # A2 keeps one requestedIncrementalSyncGeneration write and one wake
npm run check:openapi-route-coverage
npm run check:api-body-validation
node scripts/ci/check-supply-chain-locks.mjs      # C1: the fixed gate passes on the final tree (four pins applied)
node scripts/ci/check-negated-test-assertions.mjs
bash scripts/ci/backend-integration-groups.sh --check   # unchanged: no new integration spec
bash tests/ci/backend-integration-groups.test.sh
# install, ownership and CI suites (C)
bash -n tests/install/utils/helpers.sh
bash -n tests/install/e2e/upgrade-install.test.sh
npm run test:ownership   # every tests/ownership suite incl. producer hooks, as the CI classifier lane
bash scripts/ci/run-install-unit-tests.sh          # all tests/install/unit suites; installs tests/ci/lib
bash tests/ci/ci-registration-completeness.test.sh
node --test tests/ci/check-supply-chain-locks.test.mjs   # 14 original cases + the post-review hardening cases
node --test tests/ci/esm-main-guard-symlink.test.mjs     # the CLI still exits through its guarded path
bash tests/ci/podman-socket-canary-composition.test.sh
bash tests/ci/check-workflow-composition.test.sh   # also run inside run-install-unit-tests.sh; repeated here as the workflow-edit gate (needs tests/ci/lib, installed above)
bash tests/ci/run-actionlint.test.sh
ACTIONLINT="${SANCTUARY_ACTIONLINT_BIN:-$(command -v actionlint || true)}"
if [ -n "$ACTIONLINT" ] && [ -x "$ACTIONLINT" ]; then SANCTUARY_ACTIONLINT_BIN="$ACTIONLINT" bash scripts/ci/run-actionlint.sh; else echo "actionlint binary absent: recorded; CI's workflow-quality lane is binding for podman-socket-canary.yml"; fi
bash tests/ci/classify-test-changes.test.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree
echo "verification block: all gates passed"
```

If the integration DB cannot start, the block stops at the integration lines. That is a D-15.X3 stop, not a fallback
(D-15.X3 integration rule): record the failure, triage it as infrastructure first, then re-run the whole block as
written once the DB starts. Completion requires the full block to exit 0 with all four integration specs executed.
`/simplify` and an adversarial review before committing; commits in the foreground through
`flock /home/nekoguntai/.i15-commit.lock git commit …`; never while a coverage run is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i15` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i15`),
  one commit per finding (test + fix; six), then the integrator commit (changelog `[Unreleased]` bullets and any
  regenerated `docs/architecture/generated`).
- **Workers (D-15.X2):** phases `a`, `b`, `c` in parallel. Workers edit only owned files, run typechecks and targeted
  tests, run lizard on changed files (zero new warnings), record red runs on the plan-commit base, apply the D-15.X3
  stop rule, and commit through the flock.
- **Integrator:** cherry-picks serially with `-x` (a, b, c), never resolves a conflict by editing another phase's
  files (conflicts go back to the owner), then runs the block. Each phase branch is proven upstream with
  `git cherry codex/bug-scrub-loop/20261013-i15 <phase-branch>` (every line `-`), deleted with `git branch -D`, and its
  worktree removed by path.
- **Merge:** squash through protected `main`; no admin bypass; merges are strictly serial — this PR is rebased only
  when it is the next to merge, and no other open PR is rebased because of it; poll required contexts via
  `/commits/<sha>/statuses` (the combined status can say success while a required context such as the verify-vectors
  summary is still pending). Expected lanes: verify-vectors (A touches `server/src/services/bitcoin/**`,
  `services/wallet/**` and `api/openapi/schemas/wallet.ts`), backend unit + integration groups (the wallet, email and
  webhook flow groups), frontend unit + render/browser e2e, CI classifier tests (`scripts/ci/*`, `tests/ci/*`), the
  **Determine Quality Scope** job whose always-on `Check supply-chain locks` step runs the edited gate on the PR head
  (the end-to-end proof for C1), workflow quality/actionlint (`podman-socket-canary.yml` edited), and the release-surface
  install lanes (`scripts/ci/*`, `tests/install/*` and `.github/workflows/*` are release-surface paths,
  `tests/install/utils/classify-install-scope.sh:483-484`): Install Script Unit Tests, Install Stack Smoke and the
  PR-bounded Upgrade Baseline, plus Release Candidate Validation (its pull_request paths cover `scripts/ci/**`,
  `tests/install/**` and `.github/workflows/**`). A missing expected lane is investigated, not assumed skipped.
  **C1 evidence:** the PR head's green `Determine Quality Scope` job with its successful `Check supply-chain locks`
  step (run ID and job ID; the gate's own log is log-file-only and a green run uploads no diagnostics).
  *(review pass 1, C-1)* C1's `upgrade-install.test.sh:2351` pin runs only in `--mode full`
  (`run_extended_upgrade_scenarios`, `:2368-2378`), and **no CI lane runs full mode**: the baseline and
  extended-fixture runners pass `--mode core` (`run-upgrade-baseline-isolated-subject.sh:65`,
  `run-extended-upgrade-fixtures.sh:191`; `release-gates.md:96`). Its evidence is therefore static: the fixed gate,
  `bash -n`, the registry check that `postgres@sha256:57c72fd2…` is a multi-arch index, and `scripts/setup.sh:471-476`,
  which runs the byte-identical image reference in the same `docker run --network … psql` shape on every upgrade lane
  (`reconcile_postgres_password_with_running_database`, `:1569`). No post-merge lane will execute it; an operator
  `--mode full` rehearsal is the only path that does, and is out of scope. The
  `podman-socket-canary.yml` workflow is `workflow_dispatch`-only and is not run by the PR; one optional dispatch on a
  Podman host after merge is enough, never as a retrigger.
- **Install-harness pins: static evidence, no required dispatch** *(review pass 2, C2-1; coordinator decision;
  supersedes the pass-1 C-2 requirement)*. Both install-harness pin sites rest on the static evidence under Phase C
  "Install lanes": `upgrade-install.test.sh:2351` on the identical postgres reference that `setup.sh:471-476` runs on
  every upgrade; `helpers.sh:543` and `:718-719` on the locked `alpine:3.24@sha256:28bd5fe8…` digest
  (`config/container-image-lock.json:16`, `docker/compose/test.yml:188`). The PR's own Upgrade Baseline (core mode)
  runs the changed harness files. A manual all-fixture `install-test.yml` dispatch cannot exercise `:719` on this
  fleet (run 21232: `[sync] skipped: configs reachable at …` on kumo and sora), so it is **not** a merge gate and no
  concurrency pre-check, fixture attribution or staleness diff is required.
  - **Optional.** An operator may still dispatch it (`test_suite=upgrade`, `upgrade_fixture=all`,
    `upgrade_source_ref=latest-stable`) for extra A/B-upgrade coverage with optional profiles on. It does not gate the
    merge. Before dispatching, check for a pending nightly or dispatch run in the shared
    `sanctuary-runner-e2e-workflow` group with `$API/actions/runs?status=waiting` and `status=running` only (Forgejo
    has no `queued` status; the API returns HTTP 400 for it), reading each run's `trigger_event`. Record the run ID
    in the PR body; a failure is triaged infrastructure first (CLAUDE.md) and reported to the
    coordinator, not treated as a stop by itself.
- **CI failure triage, infrastructure first.** Before treating any red lane as a product failure, enumerate the
  infrastructure causes in CLAUDE.md and the runner memories against the job log, the diagnostic artifact
  (`scripts/ci/write-diagnostic-summary.sh`) and the `Name:` host's snapshots: Podman socket archive stalls
  (runner-infra #34; no `docker_timeout`, the job budget is the deadline), npm advisory-endpoint outages in the audit
  gate (probe the endpoint before retriggering; cite #1012), DIND/Podman daemon contention, a stranded `e2e` runner
  lock, buildx/native-builder divergence on `kumo` (`DOCKER_BUILDKIT=0`), runner capacity, and registry egress. The
  install lanes this PR triggers are expensive and are not a signal about the gate when they fail for those reasons.
- **Retriggers:** any second expensive attempt carries the CLAUDE.md four-part evidence (immutable 40-character SHA
  plus workflow run/job IDs, a redacted failure signature, a new hypothesis not tested by the failed attempt, and a
  cheap discriminator with its result); a `chore: retrigger CI` commit carries the fix or that evidence. Never push
  while an obsolete revision still owns runner resources.
- **After merge:** verify the reported `merge_commit_sha` (not the head SHA) exists locally and is an ancestor of
  `origin/main` (`git cat-file -e` + `git merge-base --is-ancestor`) before deleting the branch; never pass
  `delete_branch_after_merge`. Verify target-branch CI on the merge commit.
- **PR-body flags:**
  - A1: compact envelopes charge 0 outputs to the attempt (D-15.1 (d)); raw-hex, input and script-hex attempt
    ceilings, per-transaction limits, envelope `complexity` values and every replay seal unchanged; the remaining
    capacity limit is reported as `attempt_evidence_capacity_exceeded` in `lastSyncError` with one error log per
    attempt (D-15.11); `rawTransactionEvidence.ts` and the sealed driver untouched; two label literals in the
    classified `receiveEvidenceAuthentication.test.ts` proof harness change; P3 design follow-up named.
  - A2: descriptor-only `POST /wallets` → 400 naming `/api/v1/wallets/import`; existing descriptor-only wallets not
    repaired (known limitation, changelog); three operator perf scripts moved to import; Semgrep pin preserved.
  - B1: identity tier mapping in the send page and dashboard; overpay-warning baseline now the displayed Economy rate;
    render-regression harness fee mock changed so the PNG keeps depicting its values; **PNG baseline files unchanged**
    and the screenshot assertions pass at the repo tolerance (static Playwright result recorded); the Economy preset
    is now the ~6-block rate.
  - B2: tolerant, silent `decodeStoredString` for SMTP, `server.name` and the monitoring URLs (D-15.B2e); writer and
    stored rows unchanged; restored SMTP reads as not configured.
  - B3: confirmation-path webhook queueing from `recordCommittedUpdates`, per-endpoint threshold crossing, idempotent
    by the existing outbox key, best effort and not awaited; save-time 400 for a threshold above the
    confirmation-tracking horizon, min(deep confirmation threshold, 6) (D-15.B3h); existing over-threshold endpoints
    and classification-repair confirmations (D-15.B3g(iii)) are known limitations with P3 follow-ups.
  - C1: git-derived scan set with documented exclusions, continuation joining, structural image extraction, Docker
    Hub canonicalisation, four live pins with **no lock-file change**, lizard 84 → 83 with the ceiling left at 86;
    *(review pass 2, C2-1)* "install-harness pins rest on static evidence: `:2351` = the identical
    `setup.sh:471-476` postgres reference (core-only, no CI lane); `helpers.sh:543`/`:719` = the locked alpine 3.24
    digest (`container-image-lock.json:16`, `docker/compose/test.yml:188`); `:719` is not reached on the rootless-Podman
    fleet (run 21232); Upgrade Baseline (core) ran the changed harness files; no manual dispatch required" (plus the
    run ID if an optional dispatch was made).
  - *(review pass 1, B-4)* B1 additionally: the Autopilot health card's "Economy fee" still shows the server `economy`
    (~12-block) tier, so it no longer matches the send page's "Economy" (P3
    `autopilot-card--economy-fee-label-differs-from-send-economy`).
  - "No migration, no new endpoint or response field, no e2e mock-map change, no version bump"; the P3 backlog and
    follow-ups stay outside this PR.
- **Rollback:** every phase is code/CI/test-only. No schema, migration or stored-shape change. Reverting A1 returns
  wallets above 600,000 history outputs to failing every sync; A2 re-admits signerless descriptor creates; B1 restores
  the off-by-one tiers (and the old harness mock); B2 restores raw reads (quoted values reappear); B3 stops
  confirmation-path deliveries (outbox rows already created are ordinary rows) and re-admits over-threshold saves;
  C1 returns the gate to line-local, hand-listed scanning and the four references to mutable tags.
- **Deployment:** none until clean closeout (`--deploy final`); the local stack is rebuilt only after the loop closes.

## Completion criteria

- [ ] Every failing-first test in Phases A–C fails on `560e8f110e` code for the reason its phase states, or for an
  accepted red listed under D-15.X3 (red runs recorded per phase; the A2 integration red recorded by the integrator's
  guarded base swap, `$SCRATCH/i15-a2-integration-red.txt`, with the `walletCreate.ts` restore verified by
  `git diff --exit-code`), and passes on the PR head; honest-path guards stay green; no unresolved D-15.X3 stop.
- [ ] Verification block run as written on the integrated branch with exit status 0 recorded, including the lizard
  gate (≤ 83 and no warning in `check-supply-chain-locks.mjs`), the empty tier-1 mutation-pin diff, the tier-2
  allow-list (`server/src/utils/safeJson.ts` only), the `server/src/services/bitcoin` scope check, the exact-file scope
  diff and the line-local numstat checks, and all four integration specs executed through the flock'd
  `test:integration:db` (the email-verification and webhook-header-patch specs are regression-only for B2/B3; the unit
  tests are their proof; review pass 1, B-6).
- [ ] Playwright static run recorded (exit status, ≥ 380 executed, only the 7 known auth/login failures, PNG
  baseline files unchanged and the screenshot assertions pass at the repo tolerance, no untracked snapshot); CI's
  browser lane is binding.
- [ ] C1 evidence recorded: the PR head's green `Determine Quality Scope` job with its successful
  `Check supply-chain locks` step (run ID and job ID), and the live-tree red (exactly the four D-15.C6 errors) from the
  phase `c` worker's log.
- [ ] *(review pass 2, C2-1; supersedes pass-1 C-2)* Install-harness pins: the static evidence (identical
  `setup.sh:471-476` postgres reference for `:2351`; locked alpine 3.24 digest for `helpers.sh:543`/`:719`; registry
  multi-arch check) and the PR's green Upgrade Baseline (core) job ID recorded in the PR body. No manual dispatch is
  required; an optional one, if made, is recorded by run ID and does not gate the merge.
- [ ] PR merged; required contexts green via `/statuses`; target-branch CI green on its merge commit; ancestry of
  `merge_commit_sha` verified; branches and worktrees cleaned (`git cherry` proof per phase branch).
- [ ] PR body carries every flag listed under Delivery.
- [ ] Run state updated: six findings resolved; the decided open questions and the P3 follow-ups
  (`wallet-sync--retained-evidence-capacity-limit-design`, `webhooks--threshold-above-deep-confirmation-never-fires`,
  `ci-supply-chain-locks--variable-built-image-refs-unscanned`,
  `webhooks--classification-repair-confirmation-skips-confirmed-event`,
  `autopilot-card--economy-fee-label-differs-from-send-economy`) recorded.
- [ ] P3 backlog (the other 18 findings) remains outside the blocking fix set.

## Review log

- Draft assembled 2026-10-22 from plan15-A/B/C (source 560e8f110e).
- Coordinator decisions applied at assembly: OQ-A1 option (d) plus the distinct `attempt_evidence_capacity_exceeded`
  reason (new D-15.11; D-15.4 and A1's tests amended; P3 `wallet-sync--retained-evidence-capacity-limit-design`); A2
  reject with 400, no repair, known limitation in the changelog; OQ-B1 harness mock, PNG diff is a D-15.X3 stop; B2
  monitoring URL readers folded in (new D-15.B2e; D-15.B2c amended); OQ-B3 save-time 400 folded into B3 (new
  D-15.B3h; D-15.B3g amended; P3 `webhooks--threshold-above-deep-confirmation-never-fires`); C-Q1 normalise, C-Q2
  include `tests/install/{utils,e2e}`, C-Q3 ceiling stays 86, C-Q4 P3
  `ci-supply-chain-locks--variable-built-image-refs-unscanned`.
- Lizard base re-measured at assembly on `560e8f110e`: 84 (gate ≤ 83 after D-15.C7).
- Pass 1 (2026-10-22): 24 comments (A 8, B 8, C 8; A-1 blocking) — all accepted and applied; reviewers ran every
  planned red on base and green after the fix on scratch copies (incl. the assembler's D-15.11, D-15.B2e, D-15.B3h);
  coordinator decisions: A2 integration red recorded by a guarded base swap; pre-merge all-fixture dispatch required
  for the helpers.sh:719 pin; rejected: none.
- Pass 2 (2026-10-22): 4 comments (A 2, C 2; B 0) — all accepted; coordinator decision: the pre-merge all-fixture dispatch is no longer required (run 21232 shows it cannot exercise the helpers.sh:719 pin; both install-harness pins rest on static evidence) — supersedes the pass-1 requirement; perf-script 409 reuse parses the existing wallet name from the 409 message; refusal arms gated on !rawHexRefused; status=queued dropped; rejected: none.
- Pass 3 (2026-10-22): full-plan pass, 1 nit (two off-by-one line citations: deviceResolution.ts:139, upgrade-install.test.sh:878) — corrected by the coordinator; no other defect; rejected: none.
- Pass 4 (2026-10-22): full-plan pass, **clean — review converged.**
