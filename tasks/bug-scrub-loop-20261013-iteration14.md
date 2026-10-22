# Bug-scrub loop 20261013 — iteration 14 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 14
- **Source SHA:** `d6cee837b47709f681264e6d1b47234613752b91` (`main`, after #1414)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (7 × P2):** A1 `worker-electrum--node-config-and-server-changes-not-applied`, A3
  `descriptor-import--multisig-signer-count-uncapped`, B1 `network-scoped-devices--h-notation-paths-hidden`, B2
  `monitoring--grafana-anonymous-toggle-never-applied`, B3 `node-config--singleton-preset-applies-only-last-field`, C1
  `install-upgrade-e2e--harness-pins-env-path-and-exports-secrets`, C2
  `ci-classifier--supply-chain-lock-inputs-skip-classifier-job`. Every finding was re-verified from source at
  `d6cee837b4` (file:line in the phase sections).
- **Rejected at review pass 1:** `sync-wallet--recursive-gap-sync-failure-swallowed` (drafted as A2). `syncWallet.ts:175`
  is `return syncWallet(...)` **without `await`** inside the scan's `try`, so a recursive rejection never reaches the
  `catch` and already propagates; the drafted tests 1 and 3 were green on base. Already recorded as rejected in run
  state; evidence in "Phase A2 — REJECTED at review pass 1". A2 is not part of this fix set.
- **P3 follow-ups added at review pass 1** (outside this fix set; full list under Open questions):
  `sync-wallet--recursive-pass-progress-stage-closed-early`, `backup-restore--node-config-change-not-propagated`,
  `device-cells--h-notation-legacy-multisig-badge`.
- The other 15 P3s from this 23-finding scrub are backlog in run state and are **outside this fix set**.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `worker-electrum--node-config-and-server-changes-not-applied` | P2 |
| A3 | `descriptor-import--multisig-signer-count-uncapped` | P2 |
| B1 | `network-scoped-devices--h-notation-paths-hidden` | P2 |
| B2 | `monitoring--grafana-anonymous-toggle-never-applied` | P2 |
| B3 | `node-config--singleton-preset-applies-only-last-field` | P2 |
| C1 | `install-upgrade-e2e--harness-pins-env-path-and-exports-secrets` | P2 |
| C2 | `ci-classifier--supply-chain-lock-inputs-skip-classifier-job` | P2 |

## Open questions

All open questions raised by the section drafters are **decided by the coordinator**. None needs a user decision: each
decision either keeps current behaviour, narrows a fix to its smallest correct form, or is strictly stricter than today,
and none invents product policy. Each deferred item is recorded in run state as a P3 follow-up, outside this fix set.

- **OQ-A1 — the worker notification rides Redis pub/sub, which is at-most-once: DECIDED, accept** (D-14.10). A running
  worker can stay stale only if the publish fails during a Redis outage, and D-14.2 logs that at error. A worker
  periodic config re-check (fingerprint `node_config.updatedAt` and the `electrum_servers` rows every 60 s, like the
  feature-flag runtime at `featureFlagService.ts:325`) is a **P3 follow-up**.
- **OQ-A3 — existing stored wallets with more than 16 signers: DECIDED, unchanged in this phase** (D-14.19). No data
  repair is authorised. Counting them (a read-only `SELECT count(*) …`) and an "unsupported policy" banner that disables
  the receive surfaces while keeping sync, audit and export working are a **P3 follow-up**.
- **OQ-B1 — normalize device account paths at storage: DECIDED, NO.** B1 is narrowed to the **client-side fix only**:
  every client read site normalizes with the shared `normalizeDerivationPath` before the canonical parse
  (`src/utils/derivationPathGroups.ts` `derivationPathCoinType`, `src/components/CreateWallet/createWalletData.ts:39`;
  D-14.B1a). That fixes existing rows with no migration. The server-side storage normalization (D-14.B1b) and the
  notation-insensitive duplicate checks (D-14.B1c) are **withdrawn** from this plan, with their production changes,
  tests, ownership, critical-path notes and acceptance lines, and become the P3 follow-up
  `device-paths--h-notation-stored-unnormalized-and-dedupe`. Rationale: the P2 is the hidden device; the documented
  byte-exact hardware-evidence storage rule (`deviceAccountConflicts.ts:150`, "rejects silently normalized multi-account
  evidence") is not changed inside a bug-fix PR. The B1 reachability table is kept as evidence for the follow-up.
- **OQ-B2 — Grafana anonymous viewing: DECIDED, read-only effective status** through the unauthenticated Grafana probe
  (D-14.B2a/b). `GRAFANA_ANONYMOUS_ENABLED` stays the only control. The dead `PUT /admin/monitoring/grafana` is removed
  (D-14.B2c).
- **C-Q1 — a failing legacy-runtime-env dispatch run after D-14.C3: DECIDED, treat it as a product finding.** "Failing"
  means a `failure` conclusion of a job that ran; a `cancelled` conclusion from the shared concurrency group is
  re-dispatched, not C-Q1 (review pass 3, C-9; see Delivery). The dispatch runs every extended fixture (`upgrade_fixture=all`); C-Q1 covers only a
  legacy-runtime-env `failure`, and a `failure` in any other fixture or in the dispatch's Upgrade Baseline job is a
  D-14.X3 stop (review pass 4, C-11; pass 5, C-13). A failure is attributed to a fixture by the `Extended upgrade
  fixture failed: <fixture>` line in `upgrade-extended-fixtures.log` inside the `diag-upgrade-extended-fixtures-<run_id>`
  artifact (log-file-only, not a job annotation; fallback: the live `::error title=CI timing::upgrade extended <ref>
  <fixture> … with exit code N` line), and is routed only after infrastructure triage: an infrastructure failure
  (runner-lock timeout, DIND/Podman stall, budget overrun, host builder divergence) is re-dispatched under the
  four-part retrigger evidence, not C-Q1 and not a stop (pass 5, C-14; see C1 "Legacy fixture"). A fixtures-job
  failure with no attributable fixture line is, after infrastructure triage, a D-14.X3 stop (pass 6, C-15). Write it up with the run ID. If the defect is in `install.sh:85-130`, `install.sh:288-324` or `scripts/setup.sh:56-75`
  (review pass 1, C-3: the likely failure site is `install.sh`'s ownership-identity load and deployment-lock acquire
  against the legacy `.env`, not `setup.sh`'s unread `ENV_FILE_IS_LEGACY` branch), the coordinator adds that
  file to phase `c`'s ownership and C1 fixes it red-first before merging. Otherwise the D-14.X3 stop rule applies and the
  coordinator decides (D-14.X3: nothing is pre-authorised as holdable). The move is never weakened back to a copy to
  make the lane green.
- **C-Q2 — the 46 other unrouted real-checkout reads by `ci-classifier-tests` suites: DECIDED, P3 follow-up**, paired
  with the existing P3 `ci-npm-ci-callsites--prefix-form-undiscovered-and-gate-scope` and with D-14.C7
  (`ci-registration-completeness.test.sh`'s `tests/install/**` input).
- **C-Q3 — a scoped supply-chain job instead of an always-on step: DECIDED, always-on step in `determine-scope`**
  (D-14.C5).

**P3 follow-ups recorded in run state (outside this fix set; ids are proposed):**
- `worker-electrum--periodic-config-recheck` (OQ-A1);
- `multisig-signer-cap--existing-over-16-wallets-unsupported-policy` (OQ-A3);
- `device-paths--h-notation-stored-unnormalized-and-dedupe` (OQ-B1: storage normalization of `accounts[]`, the legacy
  pair and `PATCH /devices/:id`, plus notation-insensitive `compareAccounts`/`findDuplicateAccount`/add-account dedupe);
- `ci-classifier--real-checkout-reads-unrouted` (C-Q2 and D-14.C7);
- `sync-wallet--recursive-pass-progress-stage-closed-early` (review pass 1, A-1: the scan's `finally` calls
  `phaseProgress?.finish()` after the un-awaited recursive `syncWallet` has already begun `initial_network`
  synchronously, `sync/pipeline.ts:75-79`, so the recursive pass's first progress stage is closed early;
  telemetry/progress only, the sync outcome is unchanged);
- `backup-restore--node-config-change-not-propagated` (review pass 1, A-8: a backup restore rewrites `node_config` and
  `electrum_servers`, `backupService/constants.ts:33`, `:45`, `restore.ts:89`, without `resetNodeClient` or
  `publishElectrumConfigChange`; the fix is to call both, with `{ scope: 'node-config', network: null }`, after the
  restore commits);
- `device-cells--h-notation-legacy-multisig-badge` (review pass 1, B-8: `src/components/cells/DeviceCells.tsx:193`
  classifies the legacy `Device.derivationPath` badge with `includes("48'")`, so a legacy `m/48h/…` multisig path gets
  the single-sig badge; cosmetic).

**P3 candidate for the next scrub (plan14-B observation, not planned here):** the Monitoring page's Grafana card always
shows the password as "Not configured" and tells the admin to "Set GRAFANA_PASSWORD…", because
`docker-compose.yml:277-278` deliberately does not forward `GRAFANA_PASSWORD` to the backend, while `getGrafanaConfig`
reads `process.env.GRAFANA_PASSWORD` (`adminMonitoringService.ts:127`). B2 does not change the password fields.

## Goal and non-goals

**Goal:** fix every blocking finding (7 × P2), each with a non-regression test that fails on `d6cee837b4` and passes
after the fix, delivered in one protected PR with green CI.

**Non-goals:** the P3 backlog (above); production data repair (OQ-A3); new Prisma migrations or `schema.prisma` edits
(RC10 migration-tree digest); storing device account paths in normalized notation or changing duplicate detection
(OQ-B1); a runtime Grafana anonymous-access control (OQ-B2); new API endpoints or query parameters (B2 **removes**
`PUT /admin/monitoring/grafana`; no e2e mock-map entry is added or changed: the thirteen `unhandledRequests` sites
found by grepping `transactions/balance-history` stay untouched); a change to the supply-chain gate's logic or locks
(D-14.C8); routing the other 46 unrouted real-checkout reads (C-Q2); product changes to `install.sh`/`setup.sh` (C1 is
harness-only unless C-Q1 fires); a version bump; branch-protection changes.

## Decisions

Decision ids are kept from the section drafts and are unique across the plan: **D-14.1–D-14.21** (Phase A;
D-14.11–D-14.14 are **withdrawn** with the rejected A2 finding and kept only as references),
**D-14.B1a–D-14.B3c** (Phase B; D-14.B1b and D-14.B1c are withdrawn by OQ-B1 and kept only as references),
**D-14.C1–D-14.C8** (Phase C), and the cross-cutting **D-14.X1–D-14.X6** below.

### Cross-cutting decisions

- **D-14.X1 lizard headroom.** Pinned lizard 1.24.0 (`/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard`)
  with the repo arguments (`scripts/quality.sh` `run_lizard`, `:280-310`: `-w -i 86 -l javascript -l typescript -l tsx
  -C 15 -T nloc=200` plus its `-x` excludes) allows 86 warnings. **Base count re-measured on `d6cee837b4`: 84** (run
  from the repository root of the i14 worktree, which has no `node_modules`, with exactly those arguments; 2026-10-21).
  The PR targets 0 new warnings, and the Verification block enforces it with a `grep -c ': warning:'` count gate at
  ≤ 84 (if the integrator's recorded base count differs, that number replaces 84 in the gate). Every worker runs
  `lizard -C 15 -T nloc=200 <new/changed .ts/.tsx/.js/.mjs files>` and reports zero new warnings. New helpers are
  top-level `function` declarations, CCN ≤ 15, NLOC ≤ 200; do not hoist a nested `function` out of a `describe` without
  re-measuring. Near-limit functions in planned files (measured on `d6cee837b4`):
  - `resolveElectrumServerUpdateValues` (`adminElectrumServerService.ts:307-322`) is at **CCN 15**: A1 adds no branch to
    it (D-14.3's helper is a separate top-level function).
  - `validateWalletInput` (`walletCreate.ts:52-78`) is at CCN 9: A3 adds one branch.
  - Lizard also warns on a function **length** over 1,000 lines (its default `length` threshold):
    `server/tests/unit/worker/electrumManager/electrumManager.standalone.contracts.ts:24-25` already carries two base
    warnings for it. A1's new `electrumManager.config-changes.contracts.ts` (about 220 lines) stays far below.
  - `scripts/ci/check-supply-chain-locks.mjs:61` (`contextualImageLine`, 205 NLOC) is one of the 84; C2 does not edit
    the file (D-14.C8).
- **D-14.X2 one worktree per phase.** Phases `a` (A1, A3), `b` (B1–B3) and `c` (C1–C2) each get a worktree
  `/home/nekoguntai/sanctuary-bug-scrub-20261013-i14-<phase>` (never `/tmp`) on branch
  `codex/bug-scrub-loop/20261013-i14-<phase>`, cut from the final reviewed plan commit (the integrator records its SHA;
  it differs from `d6cee837b4` only under `tasks/`). File ownership is disjoint at this granularity (table below), so no
  further split is needed. Setup: root `npm ci` + `cd server && npx prisma generate` + `npm run build --workspace=shared`,
  nvm node on `PATH` (~810 `node_modules` entries). Every commit goes through
  `flock /home/nekoguntai/.i14-commit.lock git commit …` in the foreground; never while a coverage or Stryker run is
  active; no `git stash`. **One commit per finding (test + fix), in phase order** (a: A1, A3; b: B1, B2, B3; c: C1,
  C2). Workers record each red run on the plan-commit base. The integrator alone runs coverage, behind the bounded guard
  in the Verification block.
- **D-14.X3 hold and stop rules.** **No phase is holdable**: all seven findings are independent P2s with
  self-contained diffs. **Red-test stop rule:** if a failing-first test does not fail on the plan-commit base, or fails
  for a different reason than the phase states (a collection error, an unmocked-import `TypeError`, a different
  assertion, a fixture/control failure), the worker **stops** and the coordinator re-assesses before anything is
  cherry-picked. The same applies when the fix breaks an existing test the phase does not list (iteration 13's b3
  ownership divergence is the precedent), when a planned "green on base" guard is red, and when the C1 extended-fixture
  dispatch fails for a non-infrastructure cause (C-Q1 for legacy-runtime-env; a D-14.X3 stop for any other fixture,
  review pass 4, C-11, or for the dispatch's own Upgrade Baseline job, review pass 5, C-13, or for an Upgrade Extended
  Fixtures `failure` with no attributable fixture line, review pass 6, C-15). An infrastructure failure
  of the dispatch is triaged first and re-dispatched under the four-part retrigger evidence; it is not a stop (review
  pass 5, C-14; see C1 "Legacy fixture"). A stop is recorded in the implementation log with the observed output.
  **Accepted reds (pre-cleared, not a stop):** A3 failing-first test 3 (service `totalSigners: 17`) fails on base with
  `expected [Function] to throw error including 'Multisig wallets support at most 16 s…' but got 'Cannot read
  properties of null (reading 'devices')'`. The unbound create reaches the harness's null repository result, so the
  received error is a `TypeError`, but the red is an assertion on the message, not a collection or unmocked-import
  error. This exact red is accepted (review pass 1, A-5); any other red reason for that test is still a stop.
- **D-14.X4 cross-phase couplings.** File ownership is disjoint (table below); the remaining couplings are ordering or
  shared-gate only:
  1. A1 and B2 both edit files under `server/src/api/admin/` (`nodeConfig.ts` vs `monitoring.ts`) and under
     `server/tests/unit/api/`; neither edits the other's files. Only B2 edits OpenAPI files (A3's
     `CreateWalletBodySchema` change adds no schema shape, D-14.20).
  2. A (`server/src/services/bitcoin/**`, `services/wallet/**`, `services/import/**`) and B1
     (`src/components/CreateWallet/**`) are both on `config/wallet-safety-critical-paths.json`, so the PR runs
     verify-vectors once for both. Neither touches `.github/workflows/verify-vectors.yml` or a `sourceManifest` input.
  3. `docs/reference/changelog.md` `## [Unreleased]` (workers hand over bullet text) and `docs/architecture/generated/*`
     are **integrator-owned**. Phase docs are owned per phase: B2 `docs/how-to/operations-runbooks.md`, C1
     `tests/install/README.md`, C2 `docs/reference/ci-cd-strategy.md`.
  4. No phase edits `scripts/ci/backend-integration-groups.sh`, `tests/install/run-all-tests.sh` or
     `config/resource-lifecycle-callsites.json` (no new integration spec, install suite or lifecycle callsite).
- **D-14.X5 e2e-helper sweep (iteration 13 missed one).** Each phase section and the table below list the
  `tests/e2e` helpers and specs that touch its behaviour, with the verdict. A helper that **waits for** a request or
  state the fix removes (iteration 13's `changeDevicePreference` waited for a refetch B3 removed) must be listed and
  edited by its phase, even when no mock map changes.

  | Phase | `tests/e2e` helpers/specs touching the behaviour | Verdict |
  |---|---|---|
  | A1 | `PUT /admin/node-config`: `adminOperationsApiMock.ts:200` (dispatcher), `userJourneyApi.ts:435`, `render-regression/renderRegressionHarness.ts:635`; `GET …/electrum-servers` mocks in `adminOperationsApiState.ts`, `userJourneyApi.ts`, `renderRegressionHarness.ts`; specs `admin-operations.spec.ts:440-470`, `network-sync-toggle-dark.spec.ts`, `render-regression/renderRegressionAdmin.contracts.ts:58` | No request, response or UI change (the publish is server-internal); no edit. Covered by the static Playwright run. |
  | A3 | wallet create/import flows (`create-wallet-flow.spec.ts`, `import-wallet-flow.spec.ts`, `renderRegressionHarness.ts`, `userJourneyApi.ts`) | Every literal `totalSigners` in `tests/e2e` is ≤ 16 (A3's grep `totalSigners: ?(1[7-9]\|[2-9][0-9])` over `tests` finds none); server-side cap only; no edit. |
  | B1 | device fixtures in every mock map (all apostrophe notation); `render-regression/renderRegressionSecondaryText.contracts.ts:22` and `renderRegressionControlVisibility.contracts.ts:11` use `m/84h/…` **5-level address** paths | Address paths never reach `derivationPathGroups`; apostrophe device rows parse identically before and after; no edit. |
  | B2 | `GET /admin/monitoring/grafana` mocks: `adminOperationsApiState.ts:175` (no `anonymousAccessNote`), `userJourneyApi.ts:444`, `admin-drafts-smoke.spec.ts:159`, `render-regression/renderRegressionHarness.ts:639` (`GRAFANA_CONFIG`, `:302-303`); `renderRegressionAdmin.contracts.ts:92` (`getByText('Anonymous viewing')`); `admin-drafts-smoke.spec.ts:235-240` (headings) | No `PUT /admin/monitoring/grafana` mock or toggle click exists anywhere in `tests/e2e`; the GET mocks stay valid (`anonymousAccess: false` → "Off"; a missing note renders nothing). `getByText('Anonymous viewing')` is a case-insensitive substring match, so no text on the Grafana card other than the label may contain "anonymous viewing" (the D-14.B2a notes are worded to avoid it; review pass 1, B-6). The e2e mock notes do not contain it. No edit. |
  | B3 | node-config specs `admin-operations.spec.ts:440-470`, `network-sync-toggle-dark.spec.ts:10`, `renderRegressionAdmin.contracts.ts:58`; no spec clicks a Quick Preset (grep `Quick Presets\|Blockstream (TCP)\|BlueWallet (TCP)`: none) | No edit. |
  | C1, C2 | none (`tests/install/e2e` is the install harness, not Playwright) | n/a |
- **D-14.X6 architecture graphs.** `docs/architecture/generated` is regenerated once by the integrator in the
  integration worktree, which has a real root `npm ci` `node_modules` (never a symlink: the arch:check worktree-symlink
  artifact drops `shared/*` edges). Section text that says "in the primary checkout" means this no-symlink condition.
  Expected new edges: B1 `src/utils/derivationPathGroups.ts` and `src/components/CreateWallet/createWalletData.ts` →
  `@sanctuary/shared/utils/bitcoin`; A1 new modules (`services/bitcoin/electrumConfigChanges.ts`,
  `worker/electrumManager/configChanges.ts`); A3 new leaf module `services/bitcoin/multisigSignerLimit.ts` (review pass
  1, A-3) with edges `services/bitcoin/descriptorBuilder`, `services/import`, `services/wallet` and `api/wallets` →
  `services/bitcoin/multisigSignerLimit`, plus `services/wallet` and `api/wallets` → `services/bitcoin/transactionWeight`
  (collapsed `src/<dir>` edges already exist); B2 removes no module.

### Phase file ownership (disjoint; one worktree and branch per phase)

| Phase | Production files | Test files |
|---|---|---|
| a | **A1:** `server/src/events/types.ts`, new `server/src/services/bitcoin/electrumConfigChanges.ts`, `server/src/api/admin/nodeConfig.ts`, `server/src/services/adminElectrumServerService.ts`, `server/src/worker/electrumManager/electrumManager.ts`, new `server/src/worker/electrumManager/configChanges.ts`, `scripts/quality/safety-catch-allowlist.json` (one reviewed entry, D-14.21). **A3:** `server/src/services/bitcoin/transactionWeight.ts` (one keyword at `:50`, nothing else), new `server/src/services/bitcoin/multisigSignerLimit.ts`, `server/src/services/bitcoin/descriptorBuilder.ts`, `server/src/services/import/index.ts`, `server/src/services/wallet/walletCreate.ts`, `server/src/api/wallets/crud.ts` | **A1:** `server/tests/unit/api/adminNodeConfig/adminNodeConfig.read-update.contracts.ts`, `server/tests/unit/services/adminElectrumServerService.test.ts`, `server/tests/unit/worker/electrumManager/electrumManagerTestHarness.ts`, new `server/tests/unit/worker/electrumManager/electrumManager.config-changes.contracts.ts` (+ one registration line in `server/tests/unit/worker/electrumManager.test.ts`). **A3:** `server/tests/unit/services/bitcoin/descriptorBuilder.test.ts`, `server/tests/unit/api/wallets/wallets.crud.contracts.ts`, `server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts`, new `server/tests/unit/services/import/parseImportInput.signerBound.test.ts` |
| b | **B1:** `src/utils/derivationPathGroups.ts`, `src/components/CreateWallet/createWalletData.ts`. **B2:** `server/src/services/adminMonitoringService.ts`, `server/src/api/admin/monitoring.ts`, `server/src/repositories/systemSettingRepository.ts`, `server/src/api/openapi/paths/admin/operations.ts`, `server/src/api/openapi/schemas/admin/ops-monitoring-node.ts`, `src/api/admin/monitoring.ts`, `src/api/admin/index.ts`, `src/api/admin/types.ts`, `src/components/Monitoring/useMonitoringController.ts`, `src/components/Monitoring/MonitoringServicesGrid.tsx`, `src/components/Monitoring/Monitoring.tsx`, `src/components/Monitoring/ServiceCard.tsx`, `docs/how-to/operations-runbooks.md`. **B3:** `src/components/NetworkConnectionCard/SingletonConfig.tsx`, `src/components/NetworkConnectionCard/NetworkConnectionCard.tsx`, `src/components/NetworkConnectionCard/NetworkConnectionCard/useNetworkConnectionCardController.ts` | **B1:** `tests/utils/derivationPathGroups.test.ts`, `tests/utils/networkScopedDevices.test.ts`, `tests/components/CreateWallet/createWalletData.test.ts`. **B2:** `server/tests/unit/services/adminMonitoringService.test.ts`, `server/tests/unit/api/admin-monitoring-routes.test.ts`, `server/tests/unit/api/openapi.admin-ops.contracts.ts`, `tests/components/Monitoring.test.tsx`, `tests/components/Monitoring.branches.test.tsx`, `tests/components/Monitoring/ServiceCard.branches.test.tsx`, `tests/api/remainingAdminApiModules.test.ts`. **B3:** new `tests/components/NodeConfig/singletonPresetState.test.tsx`, `tests/components/NetworkConnectionCard.test.tsx`, `tests/components/NetworkConnectionCard/SingletonConfig.branches.test.tsx` |
| c | **C1:** `tests/install/e2e/upgrade-install.test.sh`, `tests/install/utils/upgrade-assertions.sh`, `tests/install/utils/upgrade-fixtures.sh`, `tests/install/README.md`. **C2:** `.github/workflows/quality.yml`, `scripts/ci/classify-quality-scope.sh`, `docs/reference/ci-cd-strategy.md` | **C1:** `tests/install/unit/upgrade-helpers.test.sh`, `tests/install/unit/install-script.test.sh` (one characterization test). **C2:** `tests/ci/classify-quality-scope.test.sh`, `tests/ci/check-workflow-composition.test.sh` |

Integrator-owned: `docs/reference/changelog.md` (`## [Unreleased]`) and `docs/architecture/generated/*`. Read-only for
everyone: `config/wallet-safety-mutation-map.json`, every `server/stryker*.mjs` and `config/tooling/stryker*.mjs`,
`server/scripts/mutation/**`, `config/wallet-sync-*.json`, `scripts/perf/wallet-sync-persistence-manifest.json`,
`scripts/ci/check-supply-chain-locks.mjs` and its lock files, `install.sh`, `scripts/setup.sh`, `start.sh`.

## Phase A — backend fixes (A1, A3; A2 rejected at review pass 1)

Both phases are server-only. Every file:line below was re-verified at `d6cee837b4`
(`/home/nekoguntai/sanctuary-bug-scrub-20261013-i14`). None of the phases adds a Prisma migration, a new repository
method, a new repository callsite in a sync-path file, or an identifier starting with `sign`, `finalize` or
`broadcast`. None adds an integration test, so `scripts/ci/backend-integration-groups.sh` is untouched. Each phase
touches `server/src/services/bitcoin/**` (A1 a new file, A3 the new `multisigSignerLimit.ts`, `descriptorBuilder.ts`
and `transactionWeight.ts`). That glob is in `config/wallet-safety-critical-paths.json:11`, so the PR also runs the
verify-vectors workflow. A3 also touches `server/src/services/wallet/**` and `server/src/services/import/**`
(`:18`, `:20`). No touched file is in `scripts/verify-addresses/sourceManifest.ts`
(`grep -n "descriptorBuilder\|transactionWeight\|multisigSignerLimit\|electrum\|nodeClient\|descriptorParser"` has no
hits). The two phases touch disjoint production and test files and can ship in one PR, one commit per finding.

Phase-local file ownership:

| Phase | Production files | Test files |
|---|---|---|
| A1 | `server/src/events/types.ts`, new `server/src/services/bitcoin/electrumConfigChanges.ts`, `server/src/api/admin/nodeConfig.ts`, `server/src/services/adminElectrumServerService.ts`, `server/src/worker/electrumManager/electrumManager.ts`, new `server/src/worker/electrumManager/configChanges.ts`, `scripts/quality/safety-catch-allowlist.json` (one reviewed entry, D-14.21) | `server/tests/unit/api/adminNodeConfig/adminNodeConfig.read-update.contracts.ts`, `server/tests/unit/services/adminElectrumServerService.test.ts`, `server/tests/unit/worker/electrumManager/electrumManagerTestHarness.ts`, new `server/tests/unit/worker/electrumManager/electrumManager.config-changes.contracts.ts` (+ one registration line in `server/tests/unit/worker/electrumManager.test.ts`) |
| A3 | `server/src/services/bitcoin/transactionWeight.ts` (one keyword at `:50`), new `server/src/services/bitcoin/multisigSignerLimit.ts`, `server/src/services/bitcoin/descriptorBuilder.ts`, `server/src/services/import/index.ts`, `server/src/services/wallet/walletCreate.ts`, `server/src/api/wallets/crud.ts` | `server/tests/unit/services/bitcoin/descriptorBuilder.test.ts`, `server/tests/unit/api/wallets/wallets.crud.contracts.ts`, `server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts`, new `server/tests/unit/services/import/parseImportInput.signerBound.test.ts` |

### Phase A1 — Propagate Node Config and Electrum server changes to the worker (P2 `worker-electrum--node-config-and-server-changes-not-applied`)

**Evidence (re-verified at d6cee837b4).**
- The API applies changes only to its own process:
  - `server/src/api/admin/nodeConfig.ts:299`: `await resetNodeClient();` after the save. The response at `:304` says
    "Backend will reconnect on next request".
  - `server/src/services/adminElectrumServerService.ts` calls `reloadElectrumServers` at `:91` (reorder, all
    networks), `:149` (create), `:187` (delete), `:235` (saved-server test, after `updateHealth` writes
    health/capability columns) and `:359`/`:361` (`reloadPoolsForServerUpdate`, previous and new network).
- Both functions mutate module-level state only:
  - `server/src/services/bitcoin/nodeClient.ts:121` `networkClients` map, set at `:263`, deleted only by
    `resetOneNetwork` (`:291`). `getNodeClient` returns the cached client while `isConnected()` (`:194-196`).
  - `server/src/services/bitcoin/electrumPool/poolRegistry.ts:471-487` `reloadElectrumServers` resets the
    per-network pool (`resetElectrumPoolForNetwork`, `:304-322`).
  - `grep -rn "resetNodeClient\|reloadElectrumServers\|reloadServers" server/src` has no caller under
    `server/src/worker`.
- The worker runs every wallet sync and the subscription stream:
  - syncs use `getNodeClient` (e.g. `blockchain/syncWallet.ts:158`), so they keep the cached client/pool;
  - the subscription connection is the per-network `ElectrumClient` singleton
    (`worker/electrumManager/networkConnection.ts:107`, `getElectrumClientForNetwork`,
    `services/bitcoin/electrum/index.ts:48-55`). It re-reads `node_config` on every `connect()`
    (`electrum/electrumClient.ts:184-186` → `connectionConfigResolver.ts:187-199`), but it never reconnects on a
    config change. An explicit `disconnect()` (`electrumClient.ts:365-383`) nulls `this.socket` before
    `socket.destroy()`, so `handleSocketClose` (`:338-348`) returns early and no `'close'` event reaches the
    manager's reconnect handler (`networkConnection.ts:304-316`).
- **The worker's own `resetNodeClient()` kills its subscription socket** (review pass 1, A-7). Without a network,
  `resetAllNodeClients` calls `resetElectrumClient()`, which is `closeElectrumClientForNetwork('mainnet')`
  (`services/bitcoin/electrum/index.ts:62-70`, `:89-92`): it disconnects **and deregisters** the mainnet
  `ElectrumClient`, which is the subscription manager's `state.client`. In singleton mode `resetOneNetwork`
  (`nodeClient.ts:287-291`) also calls `disconnect()` on the per-network `ElectrumClient`, the same object the
  subscriptions use (`getElectrumClientForNetwork`). `disconnect()` nulls the socket first, so no `'close'` reaches
  the manager. On the subscription owner the reset alone therefore leaves subscriptions silently dead until the next
  health check: D-14.7's reconnect is required to restore them, not only to pick up the new config. It works on a
  deregistered `state.client` because `connectNetwork` re-resolves the client through `getElectrumClientForNetwork`
  (`networkConnection.ts:107`).
- The proxy (Tor) lives in `node_config` (`connectionConfigResolver.ts:50-56`, `:75`, `:94`), so a proxy change is a
  `node_config` change. The singleton resolves from `node_config` only (`:195-198`); the pool reads
  `electrum_servers` plus the proxy (`electrumPool.ts:235-262`, `loadPoolConfigFromDatabase`).
- The existing cross-process transport is the Redis pub/sub event bus:
  - `server/src/events/redisEventBus.ts:87` psubscribes `sanctuary:events:*` in every process; `:95-120` delivers
    a remote envelope to local handlers and skips the publisher's own instance (`:103-105`); `emitAsync`
    (`:191-216`) runs local handlers, then `await`s `publisher.publish`.
  - `server/src/infrastructure/redis.ts:217-223` `getDistributedEventBus()` returns it, or the in-process
    `eventBus` when Redis is not initialised. The worker requires Redis (`server/src/worker.ts:389-392`); the API
    initialises it (`server/src/index.ts:264`).
  - Precedent: feature flags. `featureFlagService.ts:226-237` emits `system:featureFlag.changed` "for cache
    coherence and worker reactions"; `:293-307` registers the listener from service init (`:115`), which the worker
    reaches through `featureFlagService.initialize()` (`worker.ts:440`). The event type is in
    `server/src/events/types.ts:169-177`. No node-config or Electrum event exists
    (`types.ts:143-178`; `system:config.changed` at `:163-168` has no emitter or listener).
- Tests miss it: `tests/unit/api/adminNodeConfig/adminNodeConfigTestHarness.ts:59-62` and
  `tests/unit/services/adminElectrumServerService.test.ts:37-44` mock `resetNodeClient`/`reloadElectrumServers`
  inside one process; no test crosses the API → worker boundary.

**Root cause.** The reset/reload helpers are process-local caches, and the admin write paths call them only in
the API process. Nothing tells the worker that `node_config` or `electrum_servers` changed.

**Decisions.**
- **D-14.1 transport.** Reuse the distributed event bus. Add one typed event to `SystemEvents`
  (`server/src/events/types.ts`, after `:177`):
  `'system:electrumConfig.changed': { scope: 'node-config' | 'electrum-servers'; network: string | null };`.
  No new transport, queue or Redis key. `system:config.changed` is not reused: its payload
  (`key/previousValue/newValue/changedBy`) is for system settings and would need sentinel values.
- **D-14.2 publish after commit, best effort.** New module `server/src/services/bitcoin/electrumConfigChanges.ts`
  (about 35 lines) exports `ELECTRUM_CONFIG_CHANGED_EVENT`, the `ElectrumConfigChange` type and
  `publishElectrumConfigChange(change)`. It calls `getDistributedEventBus().emitAsync(...)` (imported from
  `'../../infrastructure'`, as `featureFlagService.ts:10` does) and catches any error with
  `log.error('Failed to publish Electrum config change', { scope, network, error: getErrorMessage(error) })`.
  It never throws: the row is already committed and the API process is already reset, so failing the HTTP request
  would misreport a successful save. Callers publish only after their write and local reset have succeeded.
- **D-14.21 reviewed safety-catch allowlist entry for the publish catch (review pass 4, A4-1; coordinator decision).**
  `scripts/check-safety-catch-guards.mjs` scans `server/src/services/bitcoin` (`:16-30`) and reports D-14.2's
  log-and-swallow `catch` as a new `non-terminal-catch` finding in `publishElectrumConfigChange`, which fails
  `npm run check:safety-catch-guards` and therefore `npm run lint` (`lint:server`). The module **stays** at
  `server/src/services/bitcoin/electrumConfigChanges.ts`, and phase `a`'s A1 commit adds exactly one reviewed entry to
  `scripts/quality/safety-catch-allowlist.json` `entries` (the checker requires non-empty `file`, `functionName`,
  `issue`, `reason`, `owner`, `targetRemovalSlice` and a positive integer `count`,
  `check-safety-catch-guards.mjs:211-220`; `functionName` is the D-14.2 export name):
  `{"file": "server/src/services/bitcoin/electrumConfigChanges.ts", "functionName": "publishElectrumConfigChange", "issue": "non-terminal-catch", "count": 1, "reason": "Best-effort cross-process notification after the node-config/Electrum-server write has committed: a pub/sub failure must not fail the admin request; it is logged, and a worker that misses the event re-reads config on its next start (accepted residual OQ-A1).", "owner": "fund-safety", "targetRemovalSlice": "intentional-post-commit-notification-boundary"}`.
  The exception is permanent by design, not a debt awaiting removal: the slice name follows the existing allowlist
  precedent `broadcasting.ts` `emitAcceptedTransactionEvent` → `intentional-post-acceptance-boundary` (review pass 5).
  Rejected alternatives: moving the module out of the scan roots (for example to `server/src/services/`) only to
  escape the scanner, and replacing `try/catch` with a promise `.catch(...)` the scanner does not see. Both dodge the
  fund-safety gate instead of recording a reviewed exception, so the swallow stays visible in the allowlist with an
  owner and a removal slice. The entry is a PR-body flag (Delivery).
- **D-14.3 API call sites.**
  - `nodeConfig.ts:299`: after `await resetNodeClient();` add
    `await publishElectrumConfigChange({ scope: 'node-config', network: null });`.
  - `adminElectrumServerService.ts`: add one private helper
    `async function reloadElectrumServersEverywhere(network?: NetworkType): Promise<void>` that runs
    `await reloadElectrumServers(network);` then
    `await publishElectrumConfigChange({ scope: 'electrum-servers', network: network ?? null });`, and replace the
    six calls at `:91`, `:149`, `:187`, `:235`, `:359`, `:361`. `:235` stays included: the saved-server test writes
    health and capability columns that pool routing reads, and the API already reloads there.
- **D-14.4 only the worker listens.** The API registers no listener. `emitAsync` runs local handlers, so an API
  listener would reset the API twice. The MCP process (`mcp-entry.ts:38`) has no node-client user
  (`grep -rln "nodeClient\|electrumPool\|getElectrumClient" server/src/mcp*` is empty) and is out of scope.
- **D-14.5 where the worker listens.** `ElectrumSubscriptionManager.start()` (`electrumManager.ts:72`) registers
  the listener once, before the lock logic, and `stop()` (`:470-474`) unregisters it. Reasons:
  - `start()` is called exactly once per worker process, whether or not it wins the subscription lock
    (`worker.ts:473`), so every worker resets its own node clients;
  - it mirrors `featureFlagService.initialize()` registering its own listener (D-14.1 precedent);
  - `server/src/worker.ts` is 997 lines against the 1,000-line gate (`scripts/quality/check-large-files.mjs`,
    `lines > lineLimit`); the manager is 517 lines.
  - `handleSubscriptionLockLost` (`:246-249`) calls `stopRunningManager`, not `stop`, so the listener survives a
    lost lock. Registration is guarded by a private `configChangeUnsubscribe` field so a restart after `stop()`
    re-registers once.
- **D-14.6 what the worker does.** New helper `server/src/worker/electrumManager/configChanges.ts` exports
  `applyElectrumConfigChange(change, deps)`, with
  `deps = { resetNodeClient, reloadElectrumServers, reconnectSubscriptions }`. The manager passes the real
  `resetNodeClient` (`services/bitcoin/nodeClient`), `reloadElectrumServers` (`services/bitcoin/electrumPool`) and
  a bound private method.
  - `scope === 'electrum-servers'`: `await reloadElectrumServers(isBitcoinNetwork(change.network) ? change.network : undefined)`.
    No subscription reconnect: the subscription singleton reads `node_config` only (`connectionConfigResolver.ts:195-198`),
    so server-list edits and test clicks must not churn subscriptions.
  - any other scope (only `'node-config'` is emitted): `await resetNodeClient()` (all networks, all pools, the
    mainnet singleton), then `reconnectSubscriptions()`. An unknown scope or network gets this full treatment,
    the safe superset.
  - This mirrors exactly what the API does for the same change, plus the subscription reconnect the API has no
    equivalent of.
- **D-14.7 subscription reconnect.** New private `reconnectSubscriptionsForConfigChange()` on the manager:
  returns immediately unless `isSubscriptionOwner()` (`:436-438`); otherwise, for **every** `[network, state]` in
  `this.networks`, regardless of which config field changed (the worker's own `resetNodeClient()` has already closed
  and deregistered the subscription client, see Evidence): set `state.connected = false`, `state.subscribedToHeaders = false`,
  `state.subscribedAddresses.clear()`, `state.reconnectAttempts = 0`, call `state.client.disconnect()` and
  `this.doScheduleReconnect(network)` (`:275-299`). This is the health-check failure path
  (`healthMonitoring.ts:61-64`) plus the explicit disconnect the config change needs. `scheduleReconnect`
  clears any pending timer (`reconnection.ts:34-37`), uses the base delay when attempts is 0 (`:39-43`, 5 s,
  `types.ts:68`), and restoration re-subscribes every address and runs `onNetworkReady`
  (`electrumManager.ts:285-297`). The reconnect must not reuse the stale `state.client`: `connectNetwork` re-resolves
  the client through `getElectrumClientForNetwork` (`networkConnection.ts:107`) and calls `client.connect()`, which
  re-resolves `node_config` (proxy included). `setupEventHandlers` detaches the old listeners (`networkConnection.ts:235-243`).
- **D-14.8 ordering and idempotency.** The manager chains handler work on a private promise
  (`this.configChangeChain = this.configChangeChain.then(() => applyElectrumConfigChange(...))`), so two saves in
  quick succession apply in arrival order and never interleave a pool reload with a full reset. The chain catches
  and logs (`log.error('Failed to apply Electrum config change', …)`) so one failure does not block later events.
  Every step re-reads the database lazily on next use, so the payload carries no state and replaying an event is
  harmless.
- **D-14.9 in-flight syncs are not drained.** A reset rejects in-flight pool requests (`electrumPool.ts:390-400`,
  `'Pool is shutting down'` / `'Connection closed'`). The current sync phase then fails through the existing
  `SyncPipelineError` path and the worker's normal retry/backoff runs it again on the new config. This is the same
  behaviour as an Electrum outage and as the API process today. Draining would hold the old (possibly
  distrusted or clearnet) path open after an admin explicitly changed it, which is the bug.
- **D-14.10 missed events and multiple workers.**
  - Redis pub/sub is at-most-once. A worker that is down, or a publish that fails, misses the event. A worker that
    starts reads fresh config: `getNodeClient` and the pool load from the database on first use, and the subscription
    singleton resolves on `connect()`. So only a running worker during a Redis outage can stay stale; D-14.2 logs it.
    A durable backstop is OQ-A1 (**DECIDED: accept**; the periodic re-check is a P3 follow-up).
  - Every worker psubscribes, so every worker resets its own clients; only the subscription owner reconnects
    subscriptions (D-14.7).

**Production changes (summary).**
1. `server/src/events/types.ts`: the D-14.1 event in `SystemEvents`.
2. New `server/src/services/bitcoin/electrumConfigChanges.ts` (D-14.2).
3. `server/src/api/admin/nodeConfig.ts`: import plus one call after `:299` (D-14.3).
4. `server/src/services/adminElectrumServerService.ts`: helper plus six replaced calls (D-14.3).
5. New `server/src/worker/electrumManager/configChanges.ts` (D-14.6), about 30 lines, top-level functions.
6. `server/src/worker/electrumManager/electrumManager.ts`: two private fields, registration in `start()`,
   unregister in `stop()`, `reconnectSubscriptionsForConfigChange()` (D-14.5, D-14.7, D-14.8). About 45 lines
   added; the file stays under 600.
7. `scripts/quality/safety-catch-allowlist.json`: one reviewed `non-terminal-catch` entry for
   `publishElectrumConfigChange` (D-14.21).

**Failing-first tests.**
1. `server/tests/unit/api/adminNodeConfig/adminNodeConfig.read-update.contracts.ts` (816 lines now, about 870 after).
   Import `{ eventBus } from '../../../../src/events/eventBus'` (the bus `getDistributedEventBus()` returns when Redis
   is not initialised, `redis.ts:34`, `:217-221`). In each new case,
   `const emitAsync = vi.spyOn(eventBus, 'emitAsync').mockResolvedValue(undefined)` and `mockRestore()` after.
   - `it('publishes a node-config change to other processes after resetting the API node client', …)`: same
     setup as the case at `:154-197`. Assert `response.status === 200`,
     `emitAsync` `toHaveBeenCalledWith('system:electrumConfig.changed', { scope: 'node-config', network: null })`
     and `mockResetNodeClient.mock.invocationCallOrder[0] < emitAsync.mock.invocationCallOrder[0]`.
     **Red on base:** `expected "spy" to be called with arguments` (0 calls).
   - `it('does not publish a node-config change when the save fails', …)`: setup of `:800-814`; assert 500 and
     `emitAsync` not called. **Green on base and after.**
   - `it('still returns success when publishing the node-config change fails', …)`:
     `emitAsync.mockRejectedValueOnce(new Error('redis down'))`; assert 200 and the harness logger's `error` mock
     called with `'Failed to publish Electrum config change'` and `expect.objectContaining({ error: 'redis down' })`.
     **Red on base:** the logger assertion fails (0 calls). Status is 200 on base too.
2. `server/tests/unit/services/adminElectrumServerService.test.ts` (410 lines, about 460 after). **Not** a spy on
   `eventBus` (review pass 1, A-2): the suite reloads the service per case with `vi.resetModules()` plus a dynamic
   import (`:45-48`), so the real `src/infrastructure` would re-register the prom-client metrics on every reload (all
   13 existing cases fail with `A metric with the name sanctuary_process_cpu_user_seconds_total has already been
   registered`), and each reload builds a fresh `events/eventBus`, so a spy on the static import never sees the call.
   Instead add `emitAsync: vi.fn()` to the hoisted `mocks` and
   `vi.mock('../../../src/infrastructure', () => ({ getDistributedEventBus: () => ({ emitAsync: mocks.emitAsync }) }))`;
   in `beforeEach`, `mocks.emitAsync.mockResolvedValue(undefined)`.
   - `it.each` over the six operations already exercised in the file (reorder `:150`, create `:225`, delete,
     saved-server test `:326`/`:366`, network move `:288-289`, update with undefined previous network `:303-304`):
     `'publishes an electrum-servers change for every pool reload: %s'`. Assert `mocks.emitAsync` call count equals
     the `mocks.reloadElectrumServers` call count, each call
     `toHaveBeenNthCalledWith(i + 1, 'system:electrumConfig.changed', { scope: 'electrum-servers', network: net ?? null })`
     where `net` is the i-th reload's network argument, and that each publish follows its reload
     (`invocationCallOrder`).
     **Red on base:** every row fails `expected "vi.fn()" to be called N times, but got 0 times` (prototype: red on
     base, 16/16 green after the fix).
   - `it('does not publish when the saved-server test fails on proxy configuration', …)`: reuse the `:408` setup;
     assert neither reload nor publish. **Green on base and after.**
3. `server/tests/unit/worker/electrumManager/electrumManagerTestHarness.ts` (122 lines): harness additions, made in
   the test commit before the fix (they are inert on base):
   - hoisted `mockDistributedEventBus = { on: vi.fn((_event: string, _handler: (change: unknown) => Promise<void>) => mockConfigChangeUnsubscribe) }`
     and `mockConfigChangeUnsubscribe = vi.fn()`, both exported. The typed parameters are required (review pass 2,
     A2-1): with a zero-parameter `vi.fn(() => …)` the inferred call tuple is `[]`, and the `configChangeHandler()`
     helper below fails `npm run typecheck:tests` with `TS2493: Tuple type '[]' of length '0' has no element at
     index '1'`. Vitest alone does not catch it (the suite stays 131/131 green), so the worker must run
     `cd server && npm run typecheck:tests`;
   - add `getDistributedEventBus: vi.fn(() => mockDistributedEventBus)` to the existing
     `vi.mock('../../../../src/infrastructure', …)` at `:75-85`;
   - `vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({ resetNodeClient: vi.fn().mockResolvedValue(undefined) }))`;
   - `vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({ reloadElectrumServers: vi.fn().mockResolvedValue(undefined) }))`.
   New file `server/tests/unit/worker/electrumManager/electrumManager.config-changes.contracts.ts` (about 220
   lines) exporting `registerElectrumManagerConfigChangeContracts()`, registered in
   `server/tests/unit/worker/electrumManager.test.ts` after `:20`. A local helper
   `configChangeHandler()` returns
   `vi.mocked(mockDistributedEventBus.on).mock.calls.find(([event]) => event === 'system:electrumConfig.changed')?.[1]`
   (kept as written; the call form below stays `handler!(...)`).
   Cases:
   - (a) `it('listens for Electrum config changes from start even without subscription ownership', …)`:
     `acquireLock` → `null`; `await manager.start()`; expect `mockDistributedEventBus.on` called once with
     `('system:electrumConfig.changed', expect.any(Function))`. **Red on base:** 0 calls.
   - (b) `it('resets every node client and reconnects owned subscriptions on a node-config change', …)`:
     `vi.useFakeTimers()`; `acquireLock` → `{ key: 'lock', token: 'token' }`;
     `walletRepository.findRepresentedNetworks` → `['mainnet']` (pattern at
     `electrumManager.start.contracts.ts:204-210`); `await manager.start()`; record
     `mockClient.connect.mock.calls.length`. Then `const handler = configChangeHandler(); expect(handler).toBeDefined();`
     `await handler!({ scope: 'node-config', network: null })`. Assert: `resetNodeClient` called once with no
     arguments; `reloadElectrumServers` not called; `mockClient.disconnect` called; `manager.isConnected() === false`.
     Record `vi.mocked(getElectrumClientForNetwork).mock.calls.length` before the handler.
     `await vi.advanceTimersByTimeAsync(RECONNECT_BASE_DELAY_MS)`; assert `mockClient.connect` was called once more,
     `expect(getElectrumClientForNetwork).toHaveBeenCalledTimes(<calls before> + 1)` (the reconnect re-resolves the
     client instead of reusing the stale `state.client`; review pass 1, A-7) and `manager.isConnected() === true`.
     **Red on base:** `expect(handler).toBeDefined()` fails.
   - (c) `it('reloads only the named pool and keeps subscriptions on an electrum-servers change', …)`: owner
     setup as (b); `await handler!({ scope: 'electrum-servers', network: 'testnet4' })`. Assert
     `reloadElectrumServers` called with `'testnet4'`, `resetNodeClient` not called, `mockClient.disconnect` not
     called, still connected. **Red on base:** handler undefined.
   - (d) `it('reloads every pool when an electrum-servers change names no supported network', …)`:
     `it.each([null, 'bogusnet'])`; assert `reloadElectrumServers` called with `undefined`. **Red on base.**
   - (e) `it('resets node clients without touching subscriptions when this worker is not the owner', …)`:
     `acquireLock` → `null`; node-config change; `resetNodeClient` called, `getElectrumClientForNetwork` not
     called, `mockClient.disconnect` not called. **Red on base.**
   - (f) `it('applies overlapping config changes in arrival order', …)`: `resetNodeClient` first returns a
     deferred promise; fire node-config then electrum-servers without awaiting; assert `reloadElectrumServers` not
     called until the deferred resolves, then called. **Red on base.**
   - (g) `it('logs a failed config change and still applies the next one', …)`: `resetNodeClient` rejects once;
     both handler promises resolve; the harness logger's `error` saw `'Failed to apply Electrum config change'`;
     the second change still reached `reloadElectrumServers`. **Red on base.** (The harness logger mock at
     `:66-73` returns fresh `vi.fn()`s per `createLogger` call; for this assertion change it to a hoisted shared
     `mockLog` object exported from the harness. That is part of the harness edit above.)
   - (h) `it('stops listening when stopped and registers once per start', …)`: `start()`, `stop()`, `start()`,
     `stop()`; assert `on` called twice and `mockConfigChangeUnsubscribe` called twice; `start()` twice without
     `stop()` registers once. **Red on base.**
   - If module collection fails on base, fix the harness first. A collection error is not an acceptable red.

Confirm red first (tests only, before the source change):
`cd server && npx vitest run tests/unit/api/admin-nodeConfig-routes.test.ts tests/unit/services/adminElectrumServerService.test.ts tests/unit/worker/electrumManager.test.ts`

Expected red: the node-config publish case and the publish-failure case (2), the six `it.each` rows (6), and the
worker cases (a)–(h) (9 with the two `it.each` rows of (d)). The "save fails" and "proxy configuration" guards and
every existing case pass.

**Existing tests the fix touches.**
- `grep -rn "getDistributedEventBus" server/tests/unit` lists the suites that mock `src/infrastructure`. The new
  `getDistributedEventBus` call happens only in `ElectrumSubscriptionManager.start()`. Suites that construct a real
  manager: `tests/unit/worker/electrumManager.test.ts` (harness updated above) only.
  `tests/unit/worker/worker.entry.test.ts` mocks the manager module (`:256` mocks infrastructure; the manager class is
  mocked), so it is unaffected. Both integration worker harnesses replace `ElectrumSubscriptionManager` and
  `src/infrastructure` with doubles (`tests/integration/setup/workerHarness.ts:183` doMocks infrastructure and
  `:261-268` the manager; `tests/integration/worker/featureFlagToggle.integration.test.ts:300-307` and `:321-327`), so
  they are unaffected and do **not** cover the change (review pass 1, A-6). A1's cross-process path is covered by the
  unit spies plus the `redisEventBus.ts:87-120`/`:191-216` semantics and the optional manual check.
- The node-config harness does not mock `src/infrastructure`; there the publish goes to the real local `eventBus`
  (no listeners, resolves) and the planned `vi.spyOn(eventBus, 'emitAsync')` works (verified red, then green). The
  service suite mocks `src/infrastructure` (test 2, for the module-reload reason given there).
  `electrumConfigChanges.ts`'s success and catch paths are covered through the node-config route cases, which keeps
  unit coverage at 100%. No existing assertion counts `eventBus` emissions. Run the full commands above after the fix
  and record any failure as a plan deviation.

**Mutation-pin / inventory impact (checked at d6cee837b4).**
- `config/wallet-safety-mutation-map.json` and `server/stryker.*.config.mjs`: **no**. No hit for `nodeConfig`,
  `adminElectrumServerService`, `electrumManager`, `nodeClient` or `electrumPool`; shards
  (`server/scripts/mutation/shards.mjs:18-62`) do not cover them.
- `config/wallet-sync-mutation-boundaries.json`: **no**. Its `canonicalScopes` (`:3-8`) are `syncWallet.ts`,
  `services/bitcoin/sync/**`, `balanceCalculation.ts` and `canonicalIncrementalSync.ts`; A1 edits none and adds no
  repository call.
- `config/wallet-sync-lifecycle-contract.json`: **checked, no change expected**. `electrumManager.ts` and
  `nodeClient.ts` are inventoried by role (`:968`, `:997`, `:1009`) for the symbols listed at the
  `"symbol"` keys (`subscribeAddress`, `subscribeAddressBatch`, `subscribeHeaders`, `onHeaderObservation`, …).
  The new code references none of them (it calls `doScheduleReconnect`). Run
  `npm run check:wallet-sync-lifecycle-contract` (root `package.json:132`) to confirm.
- Replay driver sealed digests (`scripts/perf/wallet-sync-persistence-manifest.json:3-7`): **no**. The seal covers
  the driver, helper, fixture builder and migration tree only.
- `config/wallet-safety-critical-paths.json:11`: **yes** (new file under `services/bitcoin/**`); verify-vectors runs,
  no regeneration.
- Signer inventory: **no** new `sign*`/`finalize*`/`broadcast*` identifier.
- Large files: `worker.ts` untouched (997); `electrumManager.ts` ≈ 562; new test file ≈ 220. Run
  `node scripts/quality/check-large-files.mjs`.
- `arch:check`: new edges `worker → services` and `services → infrastructure` already exist at the collapsed
  `src/<dir>` level; integrator runs it in the primary checkout.

**Verification.**
- Worker: `cd server && npx tsc --noEmit && npm run typecheck:tests` (mandatory: the A2-1 harness typing is caught
  only by `typecheck:tests`, not by vitest), the red command above (now green),
  `npx vitest run tests/unit/worker tests/unit/api/admin tests/unit/services/featureFlagService.test.ts`,
  `npm run check:wallet-sync-lifecycle-contract`, lizard on changed files, `node scripts/quality/check-large-files.mjs`,
  and from the repository root `npm run check:safety-catch-guards` (must pass with the D-14.21 entry and report no
  other new finding; review pass 4, A4-1).
- Integrator: `cd server && npx vitest run --coverage tests/unit` (100%; every new branch — publish catch, scope
  switch, network fallback, owner guard, chain catch, register-once guard — has a case above).
- Manual (optional, local stack via `./start.sh --rebuild` from the `sanctuary-main` checkout): change the Electrum
  host in Node Config and confirm the worker log shows `Scheduling Electrum mainnet reconnection` and a new
  `Connected to Electrum mainnet` line without restarting the worker container.

**Acceptance.**
- Saving Node Config (host, port, SSL, per-network fields or proxy) makes every running worker drop its cached
  node clients and pools and, on the subscription owner, reconnect every subscription network through the new
  config within the base reconnect delay.
- Adding, editing, deleting, reordering or testing an Electrum server makes every running worker reload that
  network's pool (all pools for reorder) without touching subscriptions.
- A failed publish never fails the admin request and is logged at error.
- No new transport, migration or repository call.
- Out of scope: a backup restore also rewrites `node_config`/`electrum_servers` without a reset or publish; that is
  the P3 follow-up `backup-restore--node-config-change-not-propagated` (review pass 1, A-8).

**Rollback.** Revert the commit. No data or schema step. Workers go back to picking up config only on restart.

### Phase A2 — REJECTED at review pass 1 (`sync-wallet--recursive-gap-sync-failure-swallowed`)

The drafted A2 is removed from the fix set: no production change, no test, no ownership row, no verification line, no
changelog bullet and no completion item. D-14.11–D-14.14 are **withdrawn**. The rejection is recorded in run state.

**Why the finding is false as stated (review pass 1, A-1).**
- `server/src/services/bitcoin/blockchain/syncWallet.ts:175` is `return syncWallet(...)` inside the `async` scan's
  `try`, **without `await`**. A rejection of the returned promise is never seen by the `catch` at `:184`; the
  `finally` (`:206-209`) runs as soon as the call returns its pending promise, so `stage.dispose()` clears the
  `gap_limit_recursive_history` budget timer before the recursive pass can fail. A recursive failure therefore always
  propagates to the caller, and the drafted "budget mislabel" cannot happen.
- Reproduced on a scratch copy of `d6cee837b4` (`scratchpad/rpr14p1A`): the drafted test 1 (second
  `executeSyncPipeline` call rejects with the real `SyncPipelineError` shape) is **green on base**: the `catch` is
  never entered and `syncWallet` rejects with `{"name":"SyncPipelineError",…,"failedPhase":"fetchHistories"}` after 2
  pipeline calls. The drafted test 3 (late failure after the stage deadline, fake timers) is also green on base.

**What is real, and where it went (P3, outside this fix set).**
- `sync-wallet--recursive-pass-progress-stage-closed-early`: only the drafted test 2 was red (`expected false to be
  true`). `executeSyncPipeline` calls `phaseProgress?.begin('initial_network')` synchronously before its first `await`
  (`sync/pipeline.ts:75-79`); `begin` auto-finishes the active `address_history` stage (`phaseProgress.ts:137`), and the
  scan's `finally` then calls `phaseProgress?.finish()`, which closes the **recursive pass's** `initial_network` stage
  early (`phaseProgress.ts:103-131`). Wrong progress/telemetry events only: no failure is swallowed and the sync
  outcome is unchanged.
- `backup-restore--node-config-change-not-propagated` (review pass 1, A-8, an A1-adjacent observation): a backup
  restore replaces `node_config`/`electrum_servers` (`backupService/constants.ts:33`, `:45` classify them
  `durable-restored`; `restore.ts:89`) without resetting API or worker clients; the follow-up calls `resetNodeClient` +
  `publishElectrumConfigChange({ scope: 'node-config', network: null })` after the restore commits.

### Phase A3 — Reject multisig policies with more than 16 signers at create and import (P2 `descriptor-import--multisig-signer-count-uncapped`)

**Evidence (re-verified at d6cee837b4).**
- `server/src/services/bitcoin/descriptorParser/canonicalDescriptor.ts:193-207` (`parseMultisigExpression`)
  checks a positive threshold, `threshold <= keys.length` and `keys.length >= 2`; no upper bound.
- The other validators have no upper bound either:
  - `descriptorParser/domainValidation.ts:106-115` (`validateMultisigQuorum`; the finding's `:325-333` is stale);
  - `import/schemas.ts:47-55` (`JsonImportConfigSchema`, `devices` `.min(1)` only);
  - `descriptorParser/bluewalletParser.ts:146-162` (`assertExactDeviceSet`);
  - `descriptorBuilder.ts:146-157` (`buildMultiSigDescriptor`: `< 2`, quorum checks);
  - `api/wallets/crud.ts:59-99` (`CreateWalletBodySchema`: `totalSigners < 2`, `quorum > totalSigners`);
  - `services/wallet/walletCreate.ts:52-76` (`validateWalletInput`).
- Receive works for any n: `addressDerivation/multisigDerivation.ts:138-146` builds `p2ms` without an output
  script, so bitcoinjs's `n <= 20` check (extended validation under `if (a.output)`) never runs (the finding verified
  addresses for 17, 20, 21 and 25 keys).
- Spend fails for n > 16: `transactionWeight.ts:50` `const MAX_STANDARD_MULTISIG_KEYS = 16;` and `:155-160`
  `validateSortedMulti` throws `'sortedmulti requires 1 <= m <= n <= 16'` from every weight estimate. For n > 20,
  `OP_CHECKMULTISIG` fails by consensus.

**Where the cap can and cannot go.** The parsers are shared with paths that read stored wallets:
- `parseCanonicalDescriptor` is used for runtime address derivation (`addressDerivation/descriptorParser.ts:33`),
  spending (`descriptorParser/descriptorParser.ts:26`), descriptor policy (`wallet/descriptorPolicy.ts:64`, `:100`,
  `:161`) and remediation (`walletRemediation/proof.ts:349`);
- `parseDescriptorForImport` despite its name is also used by the wallet-safety audit
  (`walletSafetyAudit/descriptorEvidence.ts:83-86`, `:145-146`) and backup restore validation
  (`backupService/validation.ts:50`).
A cap in either would make every existing n > 16 wallet fail derivation, gap-limit sync, audit and restore. The
cap therefore goes at the create/import boundaries, which never run for a stored wallet:

| Entry | File:line | Reached by | Cap here? |
|---|---|---|---|
| Wallet create API schema | `api/wallets/crud.ts:70-99` (superRefine) | `POST /api/v1/wallets` | **yes** (400 before the service) |
| Wallet create service | `services/wallet/walletCreate.ts:67-75` (`validateWalletInput`) | every `createWallet` caller (`crud.ts:172`, hooks) | **yes** |
| Import parse convergence | `services/import/index.ts:84-97` (`parseImportInput`) | every import format's preview and import: `walletImport/prepareImport.ts:66`, `:140`; `walletImport/descriptorImport.ts:40`; registry handlers descriptor, walletExport, jsonConfig, bluewallet, coldcard | **yes** |
| Descriptor generation | `bitcoin/descriptorBuilder.ts:133-174` (`buildMultiSigDescriptor`) | `walletImport/walletImportService.ts:209` (every import persists through `createWalletTransaction`), `walletImport/prepareImport.ts:77` (adapter previews), `wallet/walletCreate.ts:144` (create with signers), `wallet/walletDevices.ts:102` (device linking completes a multisig) | **yes** (last line of defence) |
| JSON import schema | `import/schemas.ts:47-70` | handler `jsonConfig.ts:63` and `walletImport/jsonImport.ts:35` | no: both run after `parseImportInput` (`importWallet` calls `prepareWalletImport` first, `walletImportService.ts:427`) and before the builder cap |
| BlueWallet / Coldcard / domain validation | `bluewalletParser.ts:146-162`, `domainValidation.ts:106-115` | import handlers only, but `validateParsedDescriptorDomain` is a shared validator | no: covered by `parseImportInput` |
| Canonical/runtime parsers | `canonicalDescriptor.ts:193-207`, `descriptorParser.ts:25-54` | runtime, audit, restore | **no** (would break stored wallets) |
| Legacy `descriptorParser/parseImportInput.ts` | exported at `descriptorParser/index.ts:55` | no production caller (`grep -rn "parseImportInput" server/src` → only `walletImport/*` via `'../import'`) | no |

**Decisions.**
- **D-14.15 one constant.** Export the existing constant in place: `transactionWeight.ts:50` becomes
  `export const MAX_STANDARD_MULTISIG_KEYS = 16;`. Same line, so no pinned range moves (see pins). No second
  copy of the number.
- **D-14.16 one guard, in a new leaf module** (review pass 1, A-3). New file
  `server/src/services/bitcoin/multisigSignerLimit.ts` (about 8 lines):
  ```ts
  import { MAX_STANDARD_MULTISIG_KEYS } from './transactionWeight';

  export const MULTISIG_SIGNER_LIMIT_MESSAGE =
    `Multisig wallets support at most ${MAX_STANDARD_MULTISIG_KEYS} signers`;

  export function assertSupportedMultisigSignerCount(signerCount: number): void {
    if (signerCount > MAX_STANDARD_MULTISIG_KEYS) throw new Error(MULTISIG_SIGNER_LIMIT_MESSAGE);
  }
  ```
  Not in `descriptorBuilder.ts`: `server/tests/unit/services/wallet/walletTestHarness.ts:284-290` mocks
  `src/services/bitcoin/descriptorBuilder` with a factory exporting only `buildDescriptorFromDevices` and
  `getDerivationPath` (and `walletImport.setup.ts:74-76` exports only `buildDescriptorFromDevices`), so a
  `walletCreate.ts` import of the message from `descriptorBuilder` makes vitest throw `[vitest] No
  "MULTISIG_SIGNER_LIMIT_MESSAGE" export is defined on the mock` and test 3 stays red after the fix (reproduced). No
  suite mocks the leaf module. The name starts with `assert`, not `sign`/`finalize`/`broadcast`.
- **D-14.17 call sites.** `descriptorBuilder.ts`, `services/import/index.ts`, `walletCreate.ts` and
  `api/wallets/crud.ts` import the guard and/or message from `services/bitcoin/multisigSignerLimit`; `walletCreate.ts`
  and `crud.ts` also import `MAX_STANDARD_MULTISIG_KEYS` from `services/bitcoin/transactionWeight`.
  - `buildMultiSigDescriptor`: `assertSupportedMultisigSignerCount(devices.length)` right after the
    `devices.length < 2` check (`:146-148`).
  - `parseImportInput` (`services/import/index.ts:84-97`): after `importFormatRegistry.parse(input)`,
    `if (result.parsed.type === WalletType.MULTI_SIG) assertSupportedMultisigSignerCount(result.parsed.devices.length);`
    (`WalletType` from `@sanctuary/shared/constants/walletIdentity`). Using `devices.length`, not `totalSigners`,
    because every parser sets `devices` and the builder counts the same thing.
  - `validateWalletInput` (`walletCreate.ts`, after `:73-75`):
    `if (input.totalSigners > MAX_STANDARD_MULTISIG_KEYS) throw new InvalidInputError(MULTISIG_SIGNER_LIMIT_MESSAGE);`.
  - `CreateWalletBodySchema` superRefine (`crud.ts`, after `:93-98`): an issue with
    `message: MULTISIG_SIGNER_LIMIT_MESSAGE`, `path: ['totalSigners']` when
    `data.totalSigners > MAX_STANDARD_MULTISIG_KEYS`. Imports from `'../../services/bitcoin/multisigSignerLimit'`
    and `'../../services/bitcoin/transactionWeight'` (the collapsed `api → services` edge already exists).
- **D-14.18 limit is 16, not 20.** 16 is Sanctuary's own spend limit (`transactionWeight.ts:155-160`); any wallet
  above it can receive but never send in Sanctuary. Raising the spend limit is out of scope.
- **D-14.19 stored wallets.** No runtime path changes: existing n > 16 wallets keep deriving, syncing, auditing and
  restoring. The one stored-wallet effect is intended: completing device linking for an incomplete n > 16 multisig
  (`walletDevices.ts:102`) now fails with the cap message. Such a wallet has no descriptor and no addresses yet, so
  no funds are affected. Anything more is OQ-A3.
- **D-14.20 frontend.** `src/components/CreateWallet/ConfigurationStep.tsx:114` caps quorum at the selected device
  count but not the count itself. Out of scope here: the server message surfaces through the existing error path.
  The OpenAPI `totalSigners` input schema (`api/openapi/schemas/wallet.ts:119`) is left as is.

**Failing-first tests.**
1. `server/tests/unit/services/bitcoin/descriptorBuilder.test.ts` (807 lines, about 850 after), inside
   `describe('buildMultiSigDescriptor')` → `describe('Error handling')` (`:497`). Helper in the describe:
   `const signers = (n: number, path = "m/48'/0'/0'/2'") => Array.from({ length: n }, (_, i) => ({ fingerprint: (0x10000000 + i).toString(16), xpub: accountXpub(path, i + 1), derivationPath: path }));`
   (uses `accountXpub`, `:26-34`).
   - `it.each([17, 20, 21])('rejects a %i-signer sortedmulti policy', n => expect(() => buildMultiSigDescriptor(signers(n), 2, 'native_segwit', 'mainnet')).toThrow('Multisig wallets support at most 16 signers'))`.
     **Red on base:** `expected [Function] to throw an error` ×3.
   - `it.each(['native_segwit', 'nested_segwit'] as const)('accepts the 16-signer maximum for %s', st => expect(buildMultiSigDescriptor(signers(16, st === 'nested_segwit' ? "m/48'/0'/0'/1'" : "m/48'/0'/0'/2'"), 2, st, 'mainnet')).toContain('sortedmulti(2,'))`.
     Nested SegWit multisig needs the BIP48 script-type `1'` origin: with `…/2'` the `nested_segwit` row fails on base
     with `Descriptor origin is not a canonical account path for its wrapper` (review pass 1, A-4).
     **Green on base and after** (control: the fixture builds valid descriptors; verified).
2. `server/tests/unit/api/wallets/wallets.crud.contracts.ts`: add a row to the `it.each` at `:182-195`:
   `['too many total signers', { quorum: 2, totalSigners: 17 }, 'Multisig wallets support at most 16 signers']`.
   The case asserts 400, the exact message and `mockCreateWallet` not called (`:205-207`).
   **Red on base:** `expected 201 to be 400` (or whatever success status the mocked create returns).
   Add `['sixteen total signers is allowed', …]` only if the it.each shape allows a success row; otherwise skip
   (the builder control covers 16).
3. `server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts` (600 lines): after `:78-88`,
   `it("rejects multi-sig wallets with more than 16 signers", …)` calling
   `createWallet(userId, { name: 'Too Many', type: 'multi_sig', scriptType: 'native_segwit', quorum: 2, totalSigners: 17 })`
   and expecting `rejects.toThrow("Multisig wallets support at most 16 signers")`.
   **Red on base:** `expected [Function] to throw error including 'Multisig wallets support at most 16 s…' but got
   'Cannot read properties of null (reading 'devices')'` — the unbound create reaches the harness's null repository
   result. This is the accepted red recorded under D-14.X3 (an assertion on the message, not a collection or
   unmocked-import error), so the stop rule does not apply to it. **Green after the fix** only with the D-14.16 leaf
   module (with the guard in `descriptorBuilder.ts` it stays red on `No "MULTISIG_SIGNER_LIMIT_MESSAGE" export is
   defined on the mock`). This file is registered through `create-account-selection.contracts.ts` → `tests/unit/services/wallet.test.ts`.
4. New `server/tests/unit/services/import/parseImportInput.signerBound.test.ts` (about 130 lines). Mock only the
   logger (pattern at `importRegistry.test.ts:11-18`); import the real `parseImportInput` from
   `'../../../../src/services/import'`. Fixtures built in the file from
   `bip32.fromSeed(Buffer.alloc(32, i + 1)).derivePath("m/48'/0'/0'/2'").neutered().toBase58()` (import
   `bip32` from `'../../../../src/services/bitcoin/bip32'`, as `descriptorBuilder.test.ts:23` does) and
   fingerprints `(0x20000000 + i).toString(16)`:
   - descriptor: `wsh(sortedmulti(2,${keys.map(k => `[${k.fp}/48h/0h/0h/2h]${k.xpub}/0/*`).join(',')}))`;
   - JSON config: `JSON.stringify({ type: 'multi_sig', scriptType: 'native_segwit', quorum: 2, network: 'mainnet', devices: keys.map(k => ({ fingerprint: k.fp, derivationPath: "m/48'/0'/0'/2'", xpub: k.xpub })) })`;
   - BlueWallet text: `Name: Big\nPolicy: 2 of ${n}\nDerivation: m/48'/0'/0'/2'\nFormat: P2WSH\nSorted: true\n\n` plus
     `${k.fp}: ${k.xpub}` rows (format per `bluewalletParser.ts:20-36`, `:179-217`).
   Cases:
   - `it.each(FORMATS)('accepts a 16-signer %s import', …)`: `parseImportInput(build(16)).parsed.devices` has length
     16. **Green on base and after** (control: if a fixture fails to parse on base, fix the fixture; a control
     failure is a harness problem, not the bug).
   - `it.each(FORMATS)('rejects a 17-signer %s import', …)`:
     `expect(() => parseImportInput(build(17))).toThrow('Multisig wallets support at most 16 signers')`.
     **Red on base:** `expected [Function] to throw an error` ×3.
   - `it('keeps accepting a single-sig import', …)`: one `wpkh` descriptor,
     `wpkh([20000000/84h/0h/0h]${bip32.fromSeed(Buffer.alloc(32, 1)).derivePath("m/84'/0'/0'").neutered().toBase58()}/0/*)`;
     assert `parsed.devices` has length 1. **Green on base and after** (covers the non-multisig arm of the new `if`).
     The control xpub must be derived at `m/84'/0'/0'` (review pass 2, A2-2): reusing the depth-4 BIP48 key fails on
     base with `Extended public key depth does not match descriptor origin` (`canonicalDescriptor.ts:162`), which
     would be a D-14.X3 control stop.

Confirm red first (tests only):
`cd server && npx vitest run tests/unit/services/bitcoin/descriptorBuilder.test.ts tests/unit/api/wallets.test.ts tests/unit/services/wallet.test.ts tests/unit/services/import/parseImportInput.signerBound.test.ts`
(runners verified: `wallets.crud.contracts.ts` is registered by `tests/unit/api/wallets.test.ts`,
`create-account-selection.contracts.ts` by `tests/unit/services/wallet.test.ts`). Expected red: 3 (builder) + 1 (crud row) + 1 (service) + 3 (import) = 8; the controls and every
existing case pass.

**Existing tests the fix touches.** None expected:
`grep -rnE "totalSigners: ?(1[7-9]|[2-9][0-9])\b|of (1[7-9]|[2-9][0-9])\b" server/tests tests src` finds no
fixture above 16 signers. The new `if` in `parseImportInput` runs after the registry, so
`tests/unit/services/import/importRegistry.test.ts` and `handlers.test.ts` (which test the registry and handlers
directly with mocks) are unaffected; `tests/unit/services/bitcoin/parseImportInputDrift.test.ts` compares the two
dispatchers' outputs for valid inputs (≤ 3 signers) and stays green. After the fix run
`npx vitest run tests/unit/services/import tests/unit/services/walletImport tests/unit/services/walletImport.validation.test.ts tests/unit/services/walletImport.operations.test.ts tests/unit/services/bitcoin tests/unit/api/wallets.test.ts`.
Also check the zod ↔ OpenAPI parity suite (`tests/unit/api/openapi.wallet.contracts.ts`) still passes with the new
superRefine issue; it should, because no schema shape changes.

**Mutation-pin / inventory impact (checked at d6cee837b4).**
- `config/wallet-safety-mutation-map.json`: **pinned file touched, no line moves**. `transactionWeight.ts` is pinned
  at `:931` (whole file, `minScore: 80`), `:963-985` (`multisig-quorum-is-bounded`, lines 155-161, canary at line
  158 cols 7-26) and `:986-1008` (lines 119-121). D-14.15 only adds `export ` to line 50: no line is inserted or
  removed, and columns on lines 119-121 and 155-161 are unchanged. Re-check with
  `git diff -U0 server/src/services/bitcoin/transactionWeight.ts` (exactly one changed line, `:50`).
- `server/stryker.fee-policy.config.mjs:8`: mutates `transactionWeight.ts` whole-file. `export` adds no mutant.
  No other Stryker config or critical shard covers the A3 files.
- `config/wallet-sync-mutation-boundaries.json` / lifecycle contract / replay digests: **no** (no A3 file is in
  their scopes).
- `config/wallet-safety-critical-paths.json:11`, `:18`, `:20`: **yes**; verify-vectors runs, no regeneration.
- Signer inventory: **no** (`assertSupportedMultisigSignerCount`, `MULTISIG_SIGNER_LIMIT_MESSAGE`; no identifier
  starts with `sign`, `finalize` or `broadcast`).
- New file `server/src/services/bitcoin/multisigSignerLimit.ts` is under `services/bitcoin/**` (critical-path glob
  `:11`) but in no mutation map entry, Stryker `mutate` list or tier-2 whole-file glob in the Verification block.
- `arch:check`: new edges `services/bitcoin/descriptorBuilder`, `services/import`, `services/wallet` and `api/wallets` →
  `services/bitcoin/multisigSignerLimit` (D-14.X6) are covered by existing collapsed edges; integrator runs it.

**Verification.** `cd server && npx tsc --noEmit && npm run typecheck:tests`, the confirm command (now green), the
post-fix suite list above, lizard on changed files, `node scripts/quality/check-large-files.mjs`. Integrator:
backend unit coverage at 100% (new branches: `multisigSignerLimit.ts` guard `> 16` both arms, reached through the
builder, `parseImportInput` multisig/single-sig arms,
service and schema `> 16` arms).

**Acceptance.**
- Creating a multisig wallet with `totalSigners > 16` returns 400 with "Multisig wallets support at most 16
  signers" from the API and from the service.
- Previewing or importing a descriptor, wallet export, JSON config, BlueWallet text or Coldcard export with more
  than 16 multisig keys fails with the same message; 16 keys still import.
- Generating a multisig descriptor from more than 16 devices fails in every caller.
- Existing stored wallets of any size keep deriving, syncing, auditing and restoring.

**Rollback.** Revert the commit. No data or schema step. Imports above 16 signers are accepted again.

### Phase A open questions

1. **OQ-A1 — durability of the worker notification (A1, D-14.10).** Redis pub/sub is at-most-once. A save made
   while Redis is unreachable from the API (the publish fails and is logged) leaves running workers on the old
   config until they restart. *Recommendation:* accept for this phase. The worker requires Redis to run at all
   (`worker.ts:389-392`), so this window is narrow, and the save itself already depends on the database the worker
   also reads. If a guarantee is wanted, add a follow-up poll backstop like the feature-flag runtime
   (`featureFlagService.ts:325`): the worker fingerprints `node_config.updatedAt` and the
   `electrum_servers` rows every 60 s and applies a change when the fingerprint moves. That needs no migration.
   **DECIDED (coordinator): accept for this phase; the worker periodic config re-check is a P3 follow-up
   (`worker-electrum--periodic-config-recheck`).**
2. **OQ-A3 — existing stored wallets with more than 16 signers (A3, D-14.19).** They can receive (addresses derive
   for any n) but never spend in Sanctuary, and above 20 never spend anywhere. Data repair is not authorised.
   Options:
   - (a) leave them as they are and document the limit;
   - (b) refuse new receive addresses for them. This is not one call site: addresses reach users through
     `POST /api/v1/wallets/:id/addresses` (`api/wallets/devices.ts:28`), the stored unused addresses the UI shows,
     payjoin URIs (`api/payjoin.ts:209`) and agent operational addresses. Blocking derivation itself would also stop
     gap-limit sync and hide balances that may need recovering elsewhere.
   *Recommendation:* (a) in this phase. First find out whether any such wallet exists (on a deployment, a read-only
   `SELECT count(*) FROM wallets WHERE type = 'multi_sig' AND "totalSigners" > 16`). If any do, plan a follow-up
   that marks the wallet "unsupported policy" in the UI and disables the receive surfaces listed in (b), while
   keeping sync, audit and export working so the funds stay visible and recoverable.
   **DECIDED (coordinator): (a), unchanged in this phase; no data repair is authorised. Counting the wallets and an
   "unsupported policy" banner are a P3 follow-up (`multisig-signer-cap--existing-over-16-wallets-unsupported-policy`).**

## Phase B — frontend and admin fixes (B1–B3)

I re-read all evidence on `d6cee837b4` in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i14`. The decisions are
D-14.B1a–D-14.B3c (ids kept as drafted; D-14.B1b and D-14.B1c are withdrawn by OQ-B1). B1, B2 and B3 touch disjoint
files; they run in one worktree `b` as three commits, B1 then B2 then B3 (D-14.X2).

Shared surfaces and gates:
- **`docs/architecture/generated`.** B1 adds import edges: `src/utils/derivationPathGroups.ts` and
  `src/components/CreateWallet/createWalletData.ts` gain `@sanctuary/shared/utils/bitcoin`. (The drafted server edges to
  `services/deviceAccountConflicts` are withdrawn with D-14.B1b/c.) B2 removes nothing at module level. The integrator
  regenerates the graph once, in a checkout with a real `npm ci` `node_modules` (D-14.X6; the arch:check
  worktree-symlink artifact drops `shared/*` edges).
- **Wallet-safety lane.** B1 edits `src/components/CreateWallet/createWalletData.ts`, under
  `src/components/CreateWallet/**` in `config/wallet-safety-critical-paths.json` (`:72`). This triggers the
  verify-vectors classifier (Phase A triggers it too). After OQ-B1, B1 touches no server file, so the
  `assertHardwareWalletCapability` per-file counts pinned by `config/hardware-wallet-implementation-inventory.json` and
  `scripts/generate-signer-inventory.mjs:96,109,110` are untouched. No `finalize*` identifiers.
- **No phase adds an endpoint, a Prisma migration or an e2e mock-map entry.** B2 **removes** one endpoint
  (`PUT /admin/monitoring/grafana`). No e2e map mocks it (grep `admin/monitoring/grafana` in `tests/e2e`: only `GET`,
  at `adminOperationsApiState.ts:175`, `userJourneyApi.ts:444`, `admin-drafts-smoke.spec.ts:159`,
  `render-regression/renderRegressionHarness.ts:639`).

All frontend test commands below use `npx vitest run --config config/tooling/vitest.config.ts <files>`. All backend
commands run from `server/` as `npx vitest run <files>`.

### Phase B1 — Normalize h-notation device account paths on every client read (P2 `network-scoped-devices--h-notation-paths-hidden`)

**Reachability (established first): REACHABLE.** (Kept as evidence; after OQ-B1 it scopes the P3 follow-up, and B1
itself fixes only the read side.) Nothing between a client and the `DeviceAccount`/`Device` row
normalizes or rejects `h`/`H` hardened notation:
- **Schemas.** `ExactDeviceEvidenceStringSchema` (`shared/schemas/deviceIdentity.ts:16-19`) checks only `min(1)` and
  no surrounding whitespace.
- **Server create.** `normalizeIncomingAccounts` (`server/src/services/deviceAccountConflicts.ts:90-108`) passes
  `accounts[]` through `validateAccount` (`:128-155`). That checks only presence, enum membership and whitespace; the
  comment at `:150` reads "Preserve byte-exact hardware evidence". The legacy pair goes through `buildLegacyAccount`
  (`:161-196`). It parses with `parseDerivationPath`, which normalizes internally (`shared/utils/bitcoin.ts:316-318`),
  but it stores the **raw** `derivationPath` (`:191`).
- **Repository.** `createWithOwnerAndAccounts` / `mergeAccounts` / `updateWithModel` /
  `createAccount` (`server/src/repositories/deviceRepository.ts:358, 418, 448, 507`) write the
  values verbatim.
- **Account comparison.** `compareAccounts` (`deviceAccountConflicts.ts:62-65`) and `findDuplicateAccount`
  (`deviceRepository.ts:490-502`) compare byte-exact, so `m/84h/0h/0h` and `m/84'/0'/0'` count as different accounts.
  The `@@unique([deviceId, derivationPath])` constraint (`server/prisma/schema.prisma:314`) does not catch the pair
  either.

| # | Entry path | Normalizes? | Concrete input that stores h-notation | Verdict |
|---|---|---|---|---|
| 1 | Web ConnectDevice → SD-card file → `coldcardNestedParser` | No (`src/services/deviceParsers/parsers/coldcardNested.ts:56,72`) | `{"xfp":"0F056943","bip84":{"_pub":"zpub…","xpub":"xpub…","deriv":"m/84h/0h/0h"}}`. Coldcard's generic JSON export uses `h` (verified on its `desc`-bearing format). `useDeviceForm.buildAccountsPayload` sends `account.derivationPath` unchanged (`src/components/ConnectDevice/hooks/useDeviceForm.ts:318-332`). It reaches `POST /devices` `accounts[]` and is stored raw | **Reachable** |
| 2 | Web ConnectDevice → file → `simpleColdcardParser` / `genericJsonParser` / `coldcardFlatParser` / `bitboxParser` | No (`generic.ts:74-82,196`; `coldcardFlat.ts:78-86`; `bitbox.ts:48`) | `{"xfp":"0F056943","xpub":"xpub…","deriv":"m/84h/0h/0h"}`. The top-level legacy pair (`useDeviceForm.ts:344,360`) goes to `buildLegacyAccount` and is stored raw (`deviceAccountConflicts.ts:191`) | **Reachable** |
| 3 | Web ConnectDevice → QR, plain JSON or BBQr (`useQrScanner.processPlainContent`, `bbqrDecoder.ts:11`) | Top-level path only (`src/hooks/qr/useQrScanner.ts:122`). `accounts[]` from `parseDeviceJson` pass raw (`:144-150`) | A Coldcard Q BBQr of the JSON in row 1 | **Reachable** |
| 4 | DeviceDetail → Add account → file or plain/bytes QR | No (`src/components/DeviceDetail/accounts/hooks/useAddAccountFlow.ts:76-115,427-431,644-650`). `processImportedAccounts` dedupes byte-exact (`accountImportUtils.ts:41-58`) | The JSON in row 1, sent to `POST /devices/:id/accounts`. `addDeviceAccountWithEvidence` stores it raw (`server/src/services/deviceAccountRegistration.ts:41-57`) and can create a second row for an account the device already has as `m/84'/0'/0'` | **Reachable** |
| 5 | Mobile gateway / direct API: `POST /api/v1/devices` | No (`gateway/src/routes/proxy/whitelist.ts:332-333`, `gateway/src/middleware/validateRequest.ts:104`, `shared/schemas/mobileApiRequests.ts:368-390`) | `{"type":"coldcard","label":"CC","fingerprint":"0f056943","accounts":[{"purpose":"single_sig","scriptType":"native_segwit","derivationPath":"m/84h/0h/0h","xpub":"xpub…"}]}` | **Reachable** |
| 6 | Mobile/API `PATCH /api/v1/devices/:id` (legacy `Device.derivationPath`) | No (`server/src/api/devices/crud.ts:135-160`; schema `mobileApiRequests.ts:392-397` is `z.string().min(1)`) | `{"derivationPath":"m/49h/1h/0h"}`. `filterDevicesByNetwork` reads the legacy column (`src/utils/networkScopedDevices.ts:41`) | **Reachable** |
| 7 | USB connect / USB add-account | n/a: requests canonical `STANDARD_PATHS` (`src/services/hardwareWallet/service.ts:561-578`). `validateXpubResult` rejects any returned path other than the requested one (`identity.ts:67-71`) | — | Unreachable |
| 8 | DeviceDetail add-account via UR QR | Yes (`useAddAccountFlow.ts:125-141`, `urHelpers.ts:4-14`) | — | Unreachable |
| 9 | Wallet import (descriptor / JSON / BlueWallet) | Yes (`server/src/services/walletImport/walletImportService.ts:162`; `descriptorParser/jsonParser.ts:46`; `bluewalletParser.ts:197`) | — | Unreachable |
| 10 | Backup restore | Restores rows verbatim | Carries forward any h-row created through rows 1–6, or by earlier releases (iteration 7 B4 documents legacy h-rows) | Carries existing data |

**Evidence (re-verified).**
- `src/utils/derivationPathGroups.ts:35-37`: `derivationPathCoinType` returns
  `parseCanonicalAccountPath(path)?.coinType ?? null` on the raw path. `parseCanonicalAccountPath`
  (`shared/constants/walletPolicy.ts:216-227`) matches only apostrophe notation
  (`/^m\/(44|48|49|84|86)'\/(0|1)'\/(0|[1-9]\d*)'(?:\/(1|2)')?$/`, `:218`). So `m/84h/0h/0h` gives `null`.
- `src/utils/networkScopedDevices.ts:35-47`: a device that has paths, none of which parse, fails
  `deviceHasUsableDerivationPathForNetwork` on **every** network. `filterDevicesByNetwork` (`:49-58`) then drops it
  from the Devices page (`src/components/DeviceList/DeviceList.tsx:55`) and the sidebar
  (`src/components/Layout/useLayoutController.ts:59`).
- The same raw parse puts h-notation testnet accounts in the wrong network group:
  - `groupAccountsByNetwork` (`derivationPathGroups.ts:77-87`, used at `DeviceDetail/DeviceAccountsSection.tsx:89`)
    files `m/84h/1h/0h` under "mainnet".
  - `splitTestnetSignetAccounts` (`:61-75`, used at `ConnectDevice/DeviceDetailsForm/AccountSelectionList.tsx:24`) does
    the same in the ConnectDevice account picker.
- Same root cause in a sibling: `accountMatchesSelection` (`src/components/CreateWallet/createWalletData.ts:31-44`)
  calls `accountPathMatchesWalletPolicy(account.derivationPath, …)` on the raw path. An h-row device therefore has no
  eligible account in Create Wallet, although the server accepts it.
- The server treats the same path as valid. `validateAccountPath`
  (`server/src/services/wallet/walletAccountSelection.ts:83-96`) runs `normalizeDerivationPath` before
  `parseCanonicalAccountPath` and `accountPathMatchesWalletPolicy`.
- Tests miss it: `tests/utils/networkScopedDevices.test.ts` (74 lines) and `tests/utils/derivationPathGroups.test.ts`
  (56 lines) use only apostrophe paths and `'not-a-path'`.

**Decisions.**
- **D-14.B1a — every client read normalizes before the canonical parse, exactly as the server does.**
  `derivationPathCoinType` becomes `parseCanonicalAccountPath(normalizeDerivationPath(path))?.coinType ?? null`.
  `normalizeDerivationPath` is imported from `@sanctuary/shared/utils/bitcoin`, as in `walletAccountSelection.ts:11`.
  `accountMatchesSelection` passes `normalizeDerivationPath(account.derivationPath)` to `accountPathMatchesWalletPolicy`,
  mirroring `walletAccountSelection.ts:83,96`. This also fixes rows that already exist; no data migration (no new
  Prisma migrations).
  **Notation-variant dedupe in `getExactAccount`** (review pass 1, B-1). `getExactAccount`
  (`createWalletData.ts:46-57`) returns an account only when exactly one matches. A device holding both
  `m/84'/0'/0'` and `m/84h/0h/0h` (reachable through reachability row 4; `findDuplicateAccount` is byte-exact) works
  on base because only the apostrophe row parses; after the normalization alone both rows match and the device would
  silently disappear from Create Wallet. So `getExactAccount` collapses matches that are the same account in a
  different notation: when every match has the same `normalizeDerivationPath(derivationPath)` **and** the same `xpub`,
  return the match whose stored path already equals its normalized form (the apostrophe row), else the first match.
  Matches that differ in `xpub` stay ambiguous and return `null` (fail closed).
- **D-14.B1b — WITHDRAWN (OQ-B1 DECIDED NO).** The drafted server-side storage normalization
  (`canonicalDeviceAccountPath` in `server/src/services/deviceAccountConflicts.ts`, applied to `accounts[]`, the legacy
  pair and `PATCH /devices/:id`) is not part of this plan. It is the P3 follow-up
  `device-paths--h-notation-stored-unnormalized-and-dedupe`. The documented byte-exact hardware-evidence storage rule
  (`deviceAccountConflicts.ts:150`, "Preserve byte-exact hardware evidence") is not changed inside a bug-fix PR.
- **D-14.B1c — WITHDRAWN (OQ-B1 DECIDED NO).** The notation-insensitive duplicate and conflict checks (`compareAccounts`,
  `addDeviceAccountWithEvidence`, `findDuplicateAccount`) move to the same P3 follow-up.
- **D-14.B1d — no client parser or add-account dedupe change, and no server change.** Device paths keep being stored as
  submitted. The client read sites below are the whole fix for the P2 (the device is hidden); a notation-variant second
  row (`m/84h/0h/0h` beside `m/84'/0'/0'`) stays storable (P3 follow-up); the client treats an identical-xpub
  notation pair as one account (D-14.B1a dedupe) and a differing-xpub pair as ambiguous. Normalizing in
  `src/services/deviceParsers/registry.ts` would only change how the add-account preview dedupes, which belongs with that
  follow-up.

**Client sweep of every canonical-path parse in `src/`** (`grep -rn "parseCanonicalAccountPath\|accountPathMatchesWalletPolicy" src`,
widened at review pass 1 with `grep -rnE "derivationPath.*\.(includes|startsWith|match)\(" src`):

| Site | Input | Verdict |
|---|---|---|
| `src/utils/derivationPathGroups.ts:36` (`derivationPathCoinType`) | stored device/account path | **BUG — fixed here (D-14.B1a)** |
| `src/components/CreateWallet/createWalletData.ts:39` (`accountMatchesSelection`) | stored `DeviceAccount.derivationPath` | **BUG — fixed here (D-14.B1a)** |
| `src/services/hardwareWallet/identity.ts:52`, `adapters/jade.ts:224`, `adapters/jadeIdentity.ts:39`, `adapters/ledger/walletPolicy.ts:29` | the path the USB flow requested (canonical `STANDARD_PATHS`, reachability row 7) | not a stored-row read; out of scope |
| `src/services/hardwareWallet/psbtAccountBinding.ts:107` | account path rebuilt from PSBT BIP32 derivations (numeric indexes) | not a stored-row read; **mutation-pinned file, must not be edited** |
| `src/components/ImportWallet/importHelpers.ts:64` (`buildDescriptorFromXpub`) | `state.xpubData.path` from the hardware import flow (`useImportWalletActions.ts:145-148`) | not a stored-row read; out of scope |
| `src/components/cells/DeviceCells.tsx:193` (`AccountsCell` legacy badge, `device.derivationPath.includes("48'")`) | stored legacy `Device.derivationPath` | cosmetic mis-badge for h-notation (a legacy `m/48h/…` multisig path gets the single-sig badge); out of scope → P3 follow-up `device-cells--h-notation-legacy-multisig-badge` (review pass 1, B-8) |

**Production changes.**
- `src/utils/derivationPathGroups.ts`: import `normalizeDerivationPath`; change `:36` (D-14.B1a).
  `isTestnetSignetDerivationPath`, `derivationPathMatchesNetwork`, `derivationNetworkGroup`,
  `splitTestnetSignetAccounts`, `groupAccountsByNetwork` and `filterDevicesByNetwork` all inherit the fix.
- `src/components/CreateWallet/createWalletData.ts:39`: normalize before `accountPathMatchesWalletPolicy`; and
  `getExactAccount` (`:46-57`) gains the D-14.B1a same-normalized-path + same-xpub collapse (a top-level `function`
  helper, CCN ≤ 15 per D-14.X1). The selected signer is still sent by `deviceAccountId` (`:147,197`), so the request payload does not
  change.

No server file, shared file or stored value changes.

**Tests first.**

Frontend, failing on base:
1. `tests/utils/derivationPathGroups.test.ts`, **"classifies h-notation account paths by coin type"**.
   - `isTestnetSignetDerivationPath('m/84h/1h/0h')` and `('m/48H/1H/0H/2H')` are `true`.
   - `derivationPathMatchesNetwork('m/84h/0h/0h','mainnet')` is `true`.
   - `derivationNetworkGroup('m/86h/1h/0h')` is `'testnet-signet'`.
   - `groupAccountsByNetwork` puts `{derivationPath:'m/84h/1h/0h'}` in `testnet-signet`, and
     `splitTestnetSignetAccounts` puts it in `testnetSignetAccounts`.
   - **Red on base:** `false` / `'mainnet'`.
2. `tests/utils/networkScopedDevices.test.ts`, **"keeps h-notation devices visible on their own network family"**.
   - An accounts-device `m/84h/0h/0h` is returned for `mainnet` and not for `testnet4`.
   - A legacy device with `derivationPath: 'm/49h/1h/0h'` is returned for `signet` and `testnet4`, and not for
     `mainnet`.
   - Use `testnet4`, not `testnet`: `filterDevicesByNetwork` takes a `TabNetwork` (`src/app/networks.ts:7`), and
     `'testnet'` exists only in `LegacyTabNetwork`. Vitest passes either way, but `npm run typecheck:tests` fails
     with TS2345 on `'testnet'` (review pass 3, B-1).
   - **Red on base:** `[]` for every network.
3. `tests/components/CreateWallet/createWalletData.test.ts` (362 lines), **"accepts an exact account stored in
   h-notation"**. `singleMainnetDevice` with the account path `m/84h/0h/0h`: `getExactAccount(…, SINGLE_SIG,
   NATIVE_SEGWIT, 'mainnet')` returns that account. **Red on base:** `null`. The existing `it.each` invalid rows (`:144-160`)
   stay invalid after normalization and must still pass.
4. Same file, **"keeps a device with a notation-variant duplicate row selectable"** (review pass 1, B-1). Accounts
   `[{ id: 'single-mainnet-account', …, derivationPath: "m/84'/0'/0'" }, { …same fields and xpub, id: 'dup-h',
   derivationPath: 'm/84h/0h/0h' }]`; `getExactAccount(…, SINGLE_SIG, NATIVE_SEGWIT, 'mainnet')?.id` is
   `'single-mainnet-account'`. **Guard: passes on base** (only the apostrophe row parses), **fails after the naive
   normalization alone** (`expected undefined to be 'single-mainnet-account'`, reproduced), and passes after the
   D-14.B1a collapse.
5. Same file, **"fails closed when notation variants carry different xpubs"**. The same pair with `xpub:
   'xpub-other'` on the `dup-h` row; `getExactAccount(…)` is `null`. **Red on base:** returns
   `single-mainnet-account` (the h row is invisible on base); green after.
6. Same file, **"collapses notation variants when no row is in apostrophe form"** (review pass 2, B-3). Accounts
   `[{ id: 'h', …, derivationPath: 'm/84h/0h/0h' }, { …same fields and xpub, id: 'H', derivationPath: 'm/84H/0H/0H' }]`;
   `getExactAccount(…, SINGLE_SIG, NATIVE_SEGWIT, 'mainnet')?.id` is `'h'` (the D-14.B1a "else the first match" arm).
   **Red on base:** `null`; green after. This covers the fallback arm even if the implementation keeps a length-1
   shortcut, so frontend branch coverage stays at 100%.

Guard (passes on base and must still pass): in `tests/utils/derivationPathGroups.test.ts`, the existing
`'not-a-path'` cases stay `null`/unmatched, and add `derivationPathCoinType('M/84h/0h/0h')` → `null` (normalization
yields `m/M/…`, which is not canonical). The fix widens client parsing only to what the server's `validateAccountPath`
already accepts through the same normalizer (`h`/`H`, a missing `m/` prefix, surrounding whitespace).

Confirm red first:
`npx vitest run --config config/tooling/vitest.config.ts tests/utils/derivationPathGroups.test.ts
tests/utils/networkScopedDevices.test.ts tests/components/CreateWallet/createWalletData.test.ts`.
Record cases 1–3, 5 and 6 failing for the reasons above, and the guard and case 4 passing.

**Existing tests the fix touches.**
- `tests/components/ConnectDevice/ConnectDevice.branches.test.tsx:377-391,476` shows the h path in the form. The form
  and its payload are unchanged, so this still passes.
- Consumers of the changed helpers (`tests/components/DeviceList*`, `tests/components/Layout*`,
  `tests/components/DeviceDetail*`, `tests/components/ConnectDevice*`, `tests/components/CreateWallet`) use apostrophe
  fixtures; re-run them.
- **E2E:** grep `tests/e2e` for `h/` in derivation paths finds only 5-level **address** paths
  (`render-regression/renderRegressionControlVisibility.contracts.ts:11`,
  `renderRegressionSecondaryText.contracts.ts:22`). These are not device accounts and do not pass through
  `derivationPathGroups`. Every device fixture uses apostrophes. No spec or PNG baseline depends on this behaviour, and
  no mock map changes (D-14.X5).

**Mutation-pin / inventory impact.** `src/utils/derivationPathGroups.ts` matches the whole-file glob `src/utils/**/*.ts`
of `config/tooling/stryker.config.mjs` (root `npm run test:mutation`, which no CI lane runs; no line ranges), so nothing
is re-pinned. `src/utils/networkScopedDevices.ts` (critical-path listed, `config/wallet-safety-critical-paths.json:122`)
is not edited. `src/components/CreateWallet/**` (`:72`) is, so the verify-vectors classifier runs (A already triggers
it). No server file is touched, so `config/hardware-wallet-implementation-inventory.json` counts are unaffected.

**Verification.** Worker:
- the targeted files above and the consumer re-run set;
- `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`;
- `npm run lint:app`;
- lizard on the changed files.

Integrator only:
- frontend coverage at 100% for `derivationPathGroups.ts` and `createWalletData.ts`;
- `arch:check` with the regenerated `docs/architecture/generated` (D-14.X6);
- the verify-vectors classifier.

**Acceptance.**
- A device whose stored account path is in h-notation (an existing row, or one saved from a Coldcard file whose `deriv`
  is `m/84h/0h/0h`) appears on the Mainnet Devices page and in the sidebar, and its account is selectable in Create
  Wallet.
- A pre-existing h-row device appears on its network family, and its testnet accounts are grouped under
  Testnet/Signet in Device Detail and the ConnectDevice account picker.
- Stored values are unchanged (no server change). Notation-variant duplicate rows remain storable and are the P3
  follow-up `device-paths--h-notation-stored-unnormalized-and-dedupe`.
- A device holding the same account as both `m/84'/0'/0'` and `m/84h/0h/0h` with the same xpub stays selectable in
  Create Wallet (the apostrophe row is used); if the two rows carry different xpubs, the account is ambiguous and not
  offered.

**Rollback.** Revert the two client files and the test edits. No stored value was written by the fix.

### Phase B2 — The Monitoring page shows Grafana's real anonymous-access state, read-only (P2 `monitoring--grafana-anonymous-toggle-never-applied`)

**Evidence (re-verified).**
- Client write:
  - `src/components/Monitoring/useMonitoringController.ts:43-54` (`handleToggleAnonymous`) calls
    `adminApi.updateGrafanaConfig({ anonymousAccess })` (`src/api/admin/monitoring.ts:57-61`) and flips local state.
  - `ServiceCard.tsx:146-175` renders the switch from `anonymousAccess`, with the note "Requires container restart to
    take effect" (`:171-173`).
  - The props are wired through `MonitoringServicesGrid.tsx:10,13,40-42` and `Monitoring.tsx:36,39`.
- Server:
  - `PUT /admin/monitoring/grafana` (`server/src/api/admin/monitoring.ts:105-128`, body `GrafanaUpdateBodySchema`
    `:37-39`) calls `updateGrafanaConfig` (`server/src/services/adminMonitoringService.ts:139-154`). That only does
    `setBoolean(SystemSettingKeys.GRAFANA_ANONYMOUS_ACCESS, …)` (key `'grafana.anonymousAccess'`,
    `server/src/repositories/systemSettingRepository.ts:69`).
  - `getGrafanaConfig` (`:121-137`) echoes the stored boolean.
- Nothing else reads the key. A grep for `grafana.anonymousAccess|GRAFANA_ANONYMOUS_ACCESS` across `server/src`,
  `docker`, `scripts`, `start.sh` and `install.sh` finds only the service, the repository constant and tests.
- Grafana is configured only by env: `GF_AUTH_ANONYMOUS_ENABLED: ${GRAFANA_ANONYMOUS_ENABLED:-false}`
  (`docker/compose/monitoring.yml:334-337`). `docs/how-to/operations-runbooks.md:44` documents the env var.
- **Runtime change is not possible.** `[auth.anonymous] enabled` is a startup ini/env setting. Grafana OSS has no API
  to change it at runtime; the SSO-settings API covers OAuth/SAML providers, not anonymous auth. Option (b) is out.
- **Effective state is observable without credentials.** Probed on this host:
  - The local stack's Grafana (anonymous off) answers `GET /api/search?limit=1` with **401**.
  - A throwaway `grafana/grafana:13.2.2` container (the pinned image) with `GF_AUTH_ANONYMOUS_ENABLED=true` answers
    **200**.
  - `/api/health` answers 200 in both cases, so it cannot tell them apart.
- The backend already reaches Grafana at `http://grafana:3000` for health checks
  (`adminMonitoringService.ts:165-187`).
- Tests miss it: `server/tests/unit/services/adminMonitoringService.test.ts:125-145` and
  `server/tests/unit/api/admin-monitoring-routes.test.ts:414-474` assert only the `setBoolean` call.

**Options weighed.**
- **(a) Show the live state read-only and remove the dead write.** Chosen.
- **(b) Apply the setting through Grafana's HTTP API or provisioning.** Not possible: the setting is read only at
  startup, and provisioning does not cover `auth.anonymous`.
- **(c) Have `start.sh` or compose read the DB setting.** Rejected. The installer would need a DB query before
  `compose up`, which couples it to Postgres. A plain `docker compose up grafana` would bypass it. And it would compete
  with the `.env` value that `docs/how-to/operations-runbooks.md:44` tells operators to set.
- **Env mirror only** (forward `GRAFANA_ANONYMOUS_ENABLED` to the backend). Rejected. It reports configuration, not
  the running container: a stale container keeps the old value until it is recreated. It would also have to copy
  go-ini's boolean parsing (`yes`, `on`, `1`…). Either gap can show "off" while Grafana is open.

**Decisions.**
- **D-14.B2a — the backend reports Grafana's effective state from an unauthenticated probe.** `getGrafanaConfig`
  sends `GET http://grafana:3000/api/search?limit=1` with no credentials and a 3 s timeout, reusing the existing
  `AbortController` pattern. The result maps to `anonymousAccess`:

  | Probe result | `anonymousAccess` |
  |---|---|
  | 200 | `true` |
  | 401 | `false` |
  | any other status, network error or timeout | `null` |

  `null` means unknown, so the UI never shows "off" without proof. The DB setting is no longer read.
  `anonymousAccessNote` becomes:
  - for `true`: `'Grafana allows dashboards to be viewed without logging in. Set GRAFANA_ANONYMOUS_ENABLED=false in the
    Sanctuary runtime environment and recreate the Grafana container to turn this off.'`
  - for `false`: `'Grafana requires a login. Logged-out access is controlled by GRAFANA_ANONYMOUS_ENABLED in the
    Sanctuary runtime environment.'`
  - for `null`: `'Could not reach the bundled Grafana container to read its anonymous-access state.'`

  No note may contain the label text "anonymous viewing" (case-insensitive): Playwright's `getByText('Anonymous
  viewing')` (`renderRegressionAdmin.contracts.ts:92`) is a case-insensitive substring match, so a note repeating it
  would be a strict-mode violation against a real backend (review pass 1, B-6).

  **Custom Grafana URL limitation** (review pass 1, B-10). The probe reports the **bundled** `grafana` container only
  (`http://grafana:3000`). When an admin has set a custom Grafana URL (the `SystemSettingKeys.MONITORING_GRAFANA_URL` setting `monitoring.grafanaUrl`,
  `adminMonitoringService.ts:49`, `:56`; "Configure URL") to an
  external Grafana, the card still reports the bundled container's state, or Unknown when the bundled container is
  absent; the `null` note names the bundled container so the admin can tell. Probing a custom URL is out of scope.

  The probe uses a fixed internal URL, sends no credentials and takes no user input, so it adds no SSRF surface. The
  probe failure path logs with `log.debug` (no empty catch). The service has no logger today; add
  `createLogger('ADMIN:MONITORING')`.
- **D-14.B2b — the UI shows a read-only status, not a switch.** The Grafana card keeps the "Anonymous viewing" label,
  which `tests/e2e/render-regression/renderRegressionAdmin.contracts.ts:92` asserts. Next to it is a status pill with
  `data-testid="grafana-anonymous-state"`: **On** (amber), **Off** (neutral) or **Unknown** (neutral, italic). Below
  is the server note. There is no button, and "Requires container restart to take effect" is removed.
- **D-14.B2c — remove the dead write path.**
  - Server: `PUT /admin/monitoring/grafana` (route, `GrafanaUpdateBodySchema`/`GrafanaUpdateBody`),
    `updateGrafanaConfig`/`GrafanaUpdateResponse`, and `SystemSettingKeys.GRAFANA_ANONYMOUS_ACCESS`.
  - OpenAPI: the `put` operation (`server/src/api/openapi/paths/admin/operations.ts:353-364`) and the schemas
    `AdminUpdateGrafanaRequest`/`AdminGrafanaUpdateResponse`
    (`server/src/api/openapi/schemas/admin/ops-monitoring-node.ts:139-153`).
  - Client: `updateGrafanaConfig` (`src/api/admin/monitoring.ts:54-61`, re-export `src/api/admin/index.ts:128`).

  The endpoint is admin-only and web-only. It is not in the gateway whitelist and no e2e map mocks it. Any stale
  `grafana.anonymousAccess` row is left in place and is harmless (no migration).
- **D-14.B2d — contract type.** `anonymousAccess: boolean | null`: in `GrafanaConfigResponse`
  (`adminMonitoringService.ts:38`), `GrafanaConfig` (`src/api/admin/types.ts:309`) and OpenAPI
  `AdminGrafanaConfigResponse.properties.anonymousAccess` (`ops-monitoring-node.ts:134`, now `{ type: 'boolean',
  nullable: true }`). The required list is unchanged. Also update the stale descriptions (review pass 1, B-9): the
  OpenAPI GET description (`server/src/api/openapi/paths/admin/operations.ts:344`, "…anonymous-access setting…")
  becomes "Get Grafana admin credential hints and the effective anonymous-access state probed from Grafana (null when
  unreachable).", and the route JSDoc (`server/src/api/admin/monitoring.ts:98`, "…anonymous access setting") is
  changed to match.

**Production changes.**
- `server/src/services/adminMonitoringService.ts`:
  - Factor `fetchMonitoringHealth`'s timeout fetch into `fetchWithTimeout(url)`.
  - Add `probeGrafanaAnonymousAccess(): Promise<boolean | null>` and use it in `getGrafanaConfig`.
  - Delete `updateGrafanaConfig` and `GrafanaUpdateResponse`.
- `server/src/api/admin/monitoring.ts`: delete the PUT route, its schema and its type; drop the import; update the GET
  JSDoc at `:98` (D-14.B2d).
- `server/src/repositories/systemSettingRepository.ts:68-69`: delete the key and its comment.
- OpenAPI path and schema edits as in D-14.B2c and D-14.B2d (including the GET description at `operations.ts:344`).
- `src/api/admin/monitoring.ts`, `src/api/admin/index.ts`, `src/api/admin/types.ts`: as in D-14.B2c and D-14.B2d.
- `src/components/Monitoring/useMonitoringController.ts`: delete the toggle `useLoadingState` (`:19`),
  `handleToggleAnonymous` (`:43-54`) and both return keys (`:116,122`).
- `MonitoringServicesGrid.tsx`: drop `isTogglingAnonymous`/`onToggleAnonymous`. `Monitoring.tsx:36,39`: drop the
  props.
- `ServiceCard.tsx`:
  - replace `onToggleAnonymous`/`isTogglingAnonymous` with `anonymousAccess?: boolean | null` and
    `anonymousAccessNote?: string`, passed from the grid only for Grafana;
  - render the D-14.B2b pill in place of `:146-175`;
  - drop the unused imports.
- `docs/how-to/operations-runbooks.md:44`: add one sentence. The Monitoring page shows Grafana's live
  anonymous-access state, and the env var is the only control.

**Tests first.**

Backend, failing on base:
1. `adminMonitoringService.test.ts` (166 lines), **"reports Grafana's live anonymous access, not the stored
   setting"**. `vi.stubGlobal('fetch', …)` responds 200 while `mocks.getBoolean` resolves `false`. Expect
   `anonymousAccess: true`, with fetch called on `'http://grafana:3000/api/search?limit=1'` and no `Authorization`
   header. Add `it.each`:
   - 401 → `false`, with `getBoolean` set to `true`;
   - 500 → `null`;
   - fetch rejects → `null`;
   - an abort after 3 s under fake timers → `null`. The timeout stub must honour the signal:
     `(_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))`;
     advance with `await vi.advanceTimersByTimeAsync(3000)`; restore real timers in `finally` (a resolved or
     never-settling stub never exercises the timeout branch or hangs the case; review pass 1, B-5).

   Every row (and the 200 case) also asserts `anonymousAccessNote` equals the D-14.B2a string for that state, so
   swapped notes fail.

   **Red on base:** the stored boolean is returned, and fetch is never called.
2. `admin-monitoring-routes.test.ts` (474 lines), **"no longer routes PUT /admin/monitoring/grafana"**. Expect 404
   and `mockSetBoolean` not called. **Red on base:** 200.

Frontend, failing on base:

3. `tests/components/Monitoring.test.tsx` (649 lines). Replace the `describe('anonymous access toggle')` block
   (`:295-361`) with `describe('anonymous viewing status')`:
   - `it.each([[true,'On'],[false,'Off'],[null,'Unknown']])`. `getByTestId('grafana-anonymous-state')` has that text,
     and the server note is shown.
   - **"offers no anonymous-access control"** (review pass 1, B-4). Find the row from the label,
     `const row = screen.getByText('Anonymous viewing').parentElement!.parentElement!` (on base this is the `<label>`
     holding the switch), and `expect(within(row).queryByRole('button')).toBeNull()` — **red on base on that
     assertion**. Check the real client module, not the file-wide `../../src/api/admin` mock (`:13-18`):
     `const actual = await vi.importActual<typeof import('../../src/api/admin')>('../../src/api/admin');
     expect('updateGrafanaConfig' in actual).toBe(false)` (alternatively
     `expect('updateGrafanaConfig' in adminMonitoringApi).toBe(false)` in `tests/api/remainingAdminApiModules.test.ts`,
     which imports the real module). No typecheck-only variant.
   - For each `it.each` state, `expect(screen.getAllByText(/anonymous viewing/i)).toHaveLength(1)` (only the label
     contains the text; B-6).
   - **Red on base:** the `it.each` rows fail with `Unable to find … [data-testid="grafana-anonymous-state"]`; the
     no-control case fails on the `queryByRole('button')` assertion.

Guard: the "Anonymous viewing" label is still visible (pins the e2e assertion).

Confirm red first:
- `cd server && npx vitest run tests/unit/services/adminMonitoringService.test.ts
  tests/unit/api/admin-monitoring-routes.test.ts`
- `npx vitest run --config config/tooling/vitest.config.ts tests/components/Monitoring.test.tsx`

**Existing tests the fix touches.**
- `server/tests/unit/services/adminMonitoringService.test.ts:125-145`: drop the `updateGrafanaConfig` half; keep the
  password assertions and stub fetch. `:147-157` also needs a fetch stub.
- `server/tests/unit/api/admin-monitoring-routes.test.ts`:
  - the GET cases `:355-401` stub `mockFetch` (already global at `:73`) per case and assert `anonymousAccess` from
    the probe and the matching D-14.B2a note (`:370` asserts the `true` note instead of `toContain('restarting the
    Grafana container')`);
  - **delete** `:403-410` ("returns 500 when grafana config lookup fails", driven by `mockGetBoolean.mockRejectedValue`):
    after D-14.B2a `getGrafanaConfig` reads no setting and the probe swallows every error, so the route has no 500
    path (`expected 200 to be 500` after the fix, reproduced). Replace it with "returns `anonymousAccess: null` and the
    unknown note when the probe rejects" (review pass 1, B-3);
  - delete the PUT cases `:414-474`, which test 2 replaces;
  - remove `GRAFANA_ANONYMOUS_ACCESS` from the repository mock (`:50`).
- `server/tests/unit/api/openapi.admin-ops.contracts.ts` (627 lines):
  - remove `['/admin/monitoring/grafana','put']` (`:180`);
  - delete the put/request/response assertions (`:265-283`);
  - add `expect(…AdminGrafanaConfigResponse.properties.anonymousAccess).toEqual({ type: 'boolean', nullable: true
    })`;
  - add `expect(openApiSpec.paths['/admin/monitoring/grafana']).not.toHaveProperty('put')`.
- `tests/components/Monitoring.branches.test.tsx` (168 lines):
  - its `useLoadingState` mock round-robins **three** hooks (`:22-56`, `% 3`). After D-14.B2c there are two (load,
    save), so change it to `% 2` (branch 1 = load, 2 = save) and drop `toggleExecute`;
  - delete "guards anonymous toggle when grafana config is unavailable" (`:123-136`);
  - drop `onToggleAnonymous` from the `ServiceCard` mock (`:58-65`) and `updateGrafanaConfig` from the API mock
    (`:17,116`).
- `tests/components/Monitoring.test.tsx:16,81`: drop the `updateGrafanaConfig` mock.
- `tests/components/Monitoring/ServiceCard.branches.test.tsx` renders the Grafana card directly (review pass 1, B-9):
  add the pill branch cases there (`anonymousAccess` `true`/`false`/`null`, note present/absent, and no pill rendered
  when `anonymousAccess` is `undefined`).
- `tests/api/remainingAdminApiModules.test.ts:259-260,286-290`: drop the `updateGrafanaConfig` call and assertion.
- **E2E:**
  - The four GET mocks return `anonymousAccess: false`, which is still a valid response. Their `anonymousAccessNote`
    strings are rendered as given, which is harmless.
  - `renderRegressionAdmin.contracts.ts:92` (`getByText('Anonymous viewing')`) still matches, because the label is
    kept. `admin-drafts-smoke.spec.ts:235-240` asserts only headings.
  - There is no PNG baseline for `/admin/monitoring`. The baselines in `tests/e2e/render-regression.spec.ts-snapshots/`
    are admin-settings-websocket, dashboard-testnet, settings-notifications-telegram, wallet-detail-addresses-empty and
    wallet-list-testnet.
  - No mock-map change.
  - The integrator still runs the static Playwright pass. `getByText('Anonymous viewing')` is a case-insensitive
    substring match, so no text on the Grafana card other than the label may contain "anonymous viewing"
    (case-insensitive): not the pill and not the server notes (D-14.B2a). The e2e mock notes ('Disabled by default',
    'Disabled', 'Anonymous access disabled', or none) do not contain it.

**Verification.** Worker:
- the targeted files;
- `cd server && npx tsc --noEmit && npm run typecheck:tests`;
- `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`;
- `npm run lint:app`;
- lizard.

Integrator: 100% frontend coverage for `src/components/Monitoring/**` and `src/api/admin/monitoring.ts`; backend unit
coverage; static Playwright run of `render-regression.spec.ts` (admin monitoring) and `admin-drafts-smoke.spec.ts`.

**Acceptance.**
- With the default `.env`, Administration › Monitoring shows "Anonymous viewing: Off".
- With `GRAFANA_ANONYMOUS_ENABLED=true` and Grafana recreated, it shows "On", even if a stale `grafana.anonymousAccess`
  row says `false`.
- With the monitoring overlay down, it shows "Unknown".
- With a custom Grafana URL and no bundled Grafana container, the state is "Unknown" (the probe reads the bundled
  container only; D-14.B2a limitation).
- The page offers no control that does nothing.

**Rollback.** Revert. The removed setting key's DB rows were never read, so nothing needs restoring.

### Phase B3 — Singleton Quick Presets apply host, port and protocol together (P2 `node-config--singleton-preset-applies-only-last-field`)

**Evidence (re-verified).**
- `src/components/NetworkConnectionCard/SingletonConfig.tsx:107-111`: the preset `onClick` calls
  `onUpdateConfig('singletonHost', …)`, `onUpdateConfig('singletonPort', …)` and `onUpdateConfig('singletonSsl', …)`
  synchronously.
- The chain:
  1. `onUpdateConfig` is `controller.updateNetworkConfig` (`NetworkConnectionCard.tsx:55`).
  2. That calls `onConfigChange(createNetworkConfigPatch(network, field, value))`
     (`NetworkConnectionCard/useNetworkConnectionCardController.ts:59-61`, `:303-320`).
  3. `NetworkConnectionsSection.tsx:58` passes `(updates) => onConfigChange({ ...nodeConfig, ...updates })`.
  4. `NodeConfig.tsx:88` passes `onConfigChange={configData.setNodeConfig}`, a raw `useState` setter
     (`useNodeConfigData.ts:16`).

  Each call spreads the same render-time `nodeConfig` and passes a whole object, so React keeps only the last:
  `nodeConfig + {<net>SingletonSsl}`.
- Concrete case: the shipped mainnet default is `electrum.blockstream.info:50002`, SSL. "Blockstream (TCP)"
  (`constants.ts:12`, port 50001) leaves port 50002 with SSL off. "BlueWallet (TCP)" (`:13`) leaves the Blockstream
  host. After Save All Settings (`useNodeConfigSave.ts:21` sends the whole `nodeConfig`), that network's Electrum
  connection is broken.
- Tests miss it:
  - `tests/components/NetworkConnectionCard.test.tsx:240-253` uses a `vi.fn` `onConfigChange` and asserts only
    `toHaveBeenCalledWith({ mainnetSingletonHost })`;
  - `tests/components/NetworkConnectionCard/SingletonConfig.branches.test.tsx:49-70` asserts the three separate
    calls;
  - every `NodeConfig*.test.tsx` mocks `NetworkConnectionCard`.

**Audit of other multi-call sites (same stale-spread pattern).**

| Site | Calls per handler | Affected? |
|---|---|---|
| `PoolConfig.tsx:105,116,126` (`poolMin`/`poolMax`/`poolLoadBalancing`) | 1 per `onChange` | No |
| Controller `handleModeChange`/`handleEnabledChange` (`:63-69`) | 1 | No |
| Controller `handleAddPreset` (pool mode, `:235-243`) | one `setNewServer` | No |
| `ExternalServicesSection.tsx:179,198,226,246,270,301` | 1 `onConfigChange(updateUrlField(...))` / spread per handler | No |
| `CustomProxyControls.tsx:94,104,125,132`, `ProxyTorHeader.tsx:43` | 1 spread per handler | No |
| `useProxyTorControls.ts:66` (`handleProxyPreset`) | one `setNodeConfig(nextConfig)` built at once | No |
| `useProxyTorControls.ts:182` (`stopTorContainer`) | functional updater | No |
| `SingletonConfig.tsx:107-111` | **3** | **Yes (this finding)** |

The singleton preset is the only multi-field write in a single handler.

**Decisions.**
- **D-14.B3a — a preset is one combined patch.** The controller gains
  `updateNetworkConfigFields(updates: Partial<Record<NetworkConfigField, unknown>>)`:
  - `createNetworkConfigPatch` takes the record and maps every key through `fieldMap`
    (`Record<NetworkConfigField, string>`);
  - `updateNetworkConfig(field: string, value: unknown)` **keeps its signature** and delegates to
    `updateNetworkConfigFields({ [field]: value })`;
  - add `applySingletonPreset(preset)`, which calls `updateNetworkConfigFields({ singletonHost: preset.host,
    singletonPort: preset.port, singletonSsl: preset.useSsl })`.

  `SingletonConfig` gets a new required prop `onApplyPreset: (preset: PresetServer) => void`, used by the preset
  button. `NetworkConnectionCard.tsx` wires it to `controller.applySingletonPreset`. Export the `NetworkConfigField`
  union (the `fieldMap` keys) from the controller module. Only `updateNetworkConfigFields`, `createNetworkConfigPatch`
  and `applySingletonPreset` take `NetworkConfigField`, so a misspelled field in the preset patch is a type error. The
  `onUpdateConfig: (field: string, value: unknown) => void` prop types of `SingletonConfig` (`:15`) and `PoolConfig`
  (`:33`) do not change: narrowing `updateNetworkConfig`'s `field` makes it unassignable to them under
  `strictFunctionTypes` (TS2322 at `NetworkConnectionCard.tsx:55` and `:81`, reproduced), and `PoolConfig.tsx` is not
  owned (review pass 1, B-2). `{ [field]: value }` with `field: string` is assignable to
  `Partial<Record<NetworkConfigField, unknown>>` (typecheck passes).
- **D-14.B3b — keep the parent contract (`onConfigChange: (config: NodeConfigType) => void`,
  `src/components/NodeConfig/types.ts:15,27,42`).** A functional updater would also fix it, but it changes three prop
  types and five call sites to guard against a pattern the audit shows exists nowhere else. One combined patch is the
  minimal correct fix.
- **D-14.B3c — no e2e change.** No Playwright spec clicks a singleton preset (grep `Quick Presets|Blockstream (TCP)` in
  `tests/e2e`: none). The vitest case below drives the real chain from click to the `updateNodeConfig` payload.

**Production changes.** Only these three:
- `SingletonConfig.tsx`: add the prop; preset `onClick={() => onApplyPreset(preset)}`.
- `NetworkConnectionCard.tsx`: pass `onApplyPreset={controller.applySingletonPreset}` at `:47-57`.
- `useNetworkConnectionCardController.ts`: D-14.B3a. Return `applySingletonPreset` next to `updateNetworkConfig`
  (`:278`). `PoolConfig.tsx` and the `onUpdateConfig` prop types are not touched (D-14.B3a).

**Tests first.**

Failing on base:
1. New file `tests/components/NodeConfig/singletonPresetState.test.tsx` (about 120 lines). It uses the **real**
   `NodeConfig` → `NetworkConnectionsSection` → `NetworkConnectionCard` → `SingletonConfig` chain, with real
   `useState` in `useNodeConfigData`.
   - Mock only `../../../src/api/admin` and `../../../src/api/bitcoin`, as in `tests/components/NodeConfig.test.tsx:26-40`:
     - `getNodeConfig` returns a mainnet `singleton` config: `electrum.blockstream.info`, 50002, SSL true;
     - `getElectrumServers` returns `[]`;
     - `getTorContainerStatus` returns `null`;
     - `updateNodeConfig` resolves;
     - `getStatus` rejects.
   - Mock `../../../src/utils/logger`. Do **not** mock `NetworkConnectionCard`.
   - **"applies every field of a singleton preset"**. Click the "Network Connections" header. Click "Blockstream
     (TCP)". The `spinbutton` value is `50001` and the TCP button has the accent class. Click "BlueWallet (TCP)". The
     `getByPlaceholderText('electrum.example.com')` value is `electrum1.bluewallet.io`. **Red on base:** port 50002,
     host unchanged.
   - **"saves the preset's host, port and protocol"**. Then click "Save All Settings". `updateNodeConfig` is called
     with `expect.objectContaining({ mainnetSingletonHost: 'electrum1.bluewallet.io', mainnetSingletonPort: 50001,
     mainnetSingletonSsl: false })`. **Red on base:** host and port are stale.

Confirm red first: `npx vitest run --config config/tooling/vitest.config.ts
tests/components/NodeConfig/singletonPresetState.test.tsx`.

**Existing tests the fix touches.**
- `tests/components/NetworkConnectionCard.test.tsx:240-253` ("applies preset when clicked") now expects one call:
  `toHaveBeenCalledTimes(1)` with `{ mainnetSingletonHost: 'electrum.blockstream.info', mainnetSingletonPort: 50001,
  mainnetSingletonSsl: false }`. It fails after the fix if left unchanged, because the exact-object match no longer
  equals `{ mainnetSingletonHost }`.
- `tests/components/NetworkConnectionCard/SingletonConfig.branches.test.tsx:26-46,49-70,87-99,106-118` (base line
  numbers):
  - add `onApplyPreset` to `renderConfig` **and** to both `rerender(<SingletonConfig …/>)` calls in the second test
    (base `:87-99` and `:106-118`; `tsc` reports them as `TS2741: Property 'onApplyPreset' is missing` at `:91` and
    `:110` once `renderConfig` grows), e.g. `onApplyPreset={vi.fn()}`. D-14.B3a makes the prop required; making it
    optional is not a fix, because it adds an unexercised branch (review pass 2, B-2);
  - move the five existing `onUpdateConfig` assertions (base `:63-67`: `singletonHost 'next.example.com'`,
    `singletonPort 60001/50002`, `singletonSsl true/false`) to just after the TCP click (`:60`), then call
    `onUpdateConfig.mockClear()`, click "Preset B", and replace the two preset assertions (base `:68-69`) with
    `expect(onUpdateConfig).not.toHaveBeenCalled()` and `expect(onApplyPreset).toHaveBeenCalledWith(presets[1])`.
    The move is required: a `mockClear()` placed before the Preset B click with the five assertions left after it
    wipes the calls they check (review pass 1, B-7; review pass 2, B-1).
- `tests/components/NetworkConnectionCard/NetworkConnectionCard.branches.test.tsx` mocks `SingletonConfig` (`:24-33`)
  and never calls a preset. It needs no change. `applySingletonPreset` coverage comes from
  `NetworkConnectionCard.test.tsx` (real `SingletonConfig`) and the new test.
- **E2E:** none (D-14.B3c). The node-config specs (`admin-operations.spec.ts:440-470`,
  `network-sync-toggle-dark.spec.ts:10`, `renderRegressionAdmin.contracts.ts:58`) do not click presets. Mock maps are
  unchanged.

**Verification.** Worker: the targeted files plus `tests/components/NetworkConnectionCard*`,
`tests/components/NodeConfig*`; then `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`
(`typecheck:tests` is the only check that catches a missed `onApplyPreset` at the two `rerender` sites; vitest passes
without it), `npm run lint:app` and lizard. Integrator: 100% frontend coverage for the three changed files.

**Acceptance.**
- In Singleton mode, each Quick Preset sets host, port and SSL/TCP to the preset values in one click.
- Save All Settings persists exactly those three values.
- Field-by-field edits still behave as before.

**Rollback.** Revert the three production files and the test edits.

### Phase B open questions

- **OQ-B1 — normalize account-path notation at storage, given the "byte-exact hardware evidence" invariant?
  DECIDED (coordinator): NO.** B1 ships the client-side read normalization only (D-14.B1a); D-14.B1b/c are withdrawn and
  recorded as the P3 follow-up `device-paths--h-notation-stored-unnormalized-and-dedupe`. The P2 is the hidden device,
  which D-14.B1a fixes for existing and new rows alike; the documented byte-exact storage rule is not changed inside a
  bug-fix PR. The drafter's analysis is kept below for the follow-up.

  *Drafter's analysis:* `deviceAccountConflicts.ts:150` and "rejects silently normalized multi-account evidence"
  (`deviceRegistration.test.ts:105-117`) treat device evidence as byte-exact. D-14.B1b rewrites only hardened notation
  and the `m/` prefix, and only on a path that parses as BIP32. That rewrite is lossless: `84h` and `84'` are the same
  index. Whitespace and malformed paths stay rejected or byte-exact.

  The alternative is read-side-only normalization (D-14.B1a without D-14.B1b/c). It fixes visibility, but it leaves
  notation-variant duplicate rows possible and keeps the byte-exact `findDuplicateAccount` blind.

  *Drafter's recommendation (not taken):* normalize at storage. Every server consumer already normalizes before comparing
  (`walletAccountSelection.ts:83`, `deviceReuseAccess.ts:63-65`, `walletSafetyAudit/signerEvidence.ts:84`), so the
  canonical form is what the system already treats as identity.
- **OQ-B2 — should admins be able to change Grafana anonymous viewing from the UI at all? DECIDED (coordinator): no.**
  The page shows the read-only effective status from the unauthenticated probe (D-14.B2a/b), and the dead PUT is removed
  (D-14.B2c). A UI control would need the installer or start script to read a DB value and recreate Grafana (option
  (c)), which turns a security-relevant setting into one with two sources of truth. `GRAFANA_ANONYMOUS_ENABLED` stays
  the only control. The runbook already says to keep it `false` in production, and D-14.B2a/b make the UI report it
  honestly.

**Out-of-scope observation for the coordinator (not planned here).** `getGrafanaConfig` reads
`process.env.GRAFANA_PASSWORD` (`adminMonitoringService.ts:127`). But `docker-compose.yml:277-278` deliberately does not
forward `GRAFANA_PASSWORD` to the backend, and no compose file gives the backend an `env_file`. So in the shipped stack
the Grafana card always shows "Not configured" and tells the admin to "Set GRAFANA_PASSWORD…", although it is set.
That is a misleading hint, a candidate for the next scrub (recorded in the header). B2 does not change the password
fields.

## Phase C — install and CI fixes (C1, C2)

C1 and C2 touch disjoint files. They run in **one worktree and one branch** (`c`), as two commits (C1, then C2), and
ship in the single iteration PR (D-14.X2, Delivery). C1 changes only the install test harness (`tests/install/**`),
which brings the PR-scoped Upgrade Baseline lane. C2 changes `quality.yml`, the quality classifier and `tests/ci/**`.
*The drafter recommended two branches and separate PRs, so that a red Docker upgrade lane cannot block the CI-gate fix;
the coordinator keeps one PR.* A red Upgrade Baseline therefore blocks the whole PR; it is handled by the D-14.X3 stop
rule and C-Q1, never by splitting the PR mid-flight without a recorded coordinator decision.

Line numbers were re-read on `d6cee837b4` (`/home/nekoguntai/sanctuary-bug-scrub-20261013-i14`). Every RED below was
reproduced on a scratch `git archive` copy of that commit: Node 24.21.0, with no Docker, `install.sh` or `start.sh`.
Decisions: D-14.C1–D-14.C8.

Shared rules for both phases:
- Tests first. Confirm each new test RED on `d6cee837b4` before you edit production or harness code. The confirm-RED
  commands below are the ones that were run.
- Never run `start.sh`, `install.sh`, `scripts/setup.sh` or `docker compose` against a real daemon on the host. C1's
  unit tests drive the harness's own functions against a fake `install.sh` written into the suite's `$TEST_TMP_DIR`.
  The real installer runs only in the CI install E2E lanes.
- New `*.test.sh` code uses `if <cmd>; then …; return 1; fi`, never a bare leading `!`
  (`scripts/ci/check-negated-test-assertions.mjs`).
- No new test suite, `trap`, `kill` or Docker verb is added (review pass 1, C-6):
  - C1's tests live in `tests/install/unit/upgrade-helpers.test.sh`. That suite is already registered in
    `tests/install/run-all-tests.sh:166` and in `config/resource-lifecycle-callsites.json:2518`. Its tests use the
    suite's own `TEST_TMP_DIR`: `setup` and `teardown` at `upgrade-helpers.test.sh:28-36` run around every `run_test`
    (`:190-209`).
  - C2's tests extend `tests/ci/classify-quality-scope.test.sh` (registered at `:1790`) and
    `tests/ci/check-workflow-composition.test.sh` (`:1755`).
  - Test 6's single `rm -f "$TEST_ENV_FILE"` under the suite's `$TEST_TMP_DIR` is covered by the existing
    `temporary_artifact`/`cleanup` exempt registration of `tests/install/unit/upgrade-helpers.test.sh`
    (`config/resource-lifecycle-callsites.json:2518`); the reviewer prototype kept `check-lifecycle-callsites.mjs` green
    with it.
  - C1 adds two `mv`s of a fixture env file (D-14.C3's hide in `test_simulate_git_update` and its teardown restore). A
    file move is not a lifecycle class in `scripts/ownership/check-lifecycle-callsites.mjs`.
  - Still run `node scripts/ownership/check-lifecycle-callsites.mjs` before the commit.
- `scripts/quality/check-large-files.mjs` scans JS/TS only, and neither phase edits a JS/TS file. If a reviewer folds
  in the C-Q3 alternative (a scoped job with a predicate exported from the gate), `scripts/ci/check-supply-chain-locks.mjs`
  is under lizard's misparse. `contextualImageLine` already reads as `@61-265`, nloc 205 under local lizard 1.21.2 (and
  under the pinned 1.24.0: it is one of the 84 base warnings, D-14.X1), and the file's own comment at `:50-52` says so.
  Under that alternative, add no line below `:61`.
- Neither phase touches `.github/workflows/verify-vectors.yml` or any `scripts/verify-addresses/sourceManifest.ts`
  input, so the verify-vectors provenance pin is not affected. C2 only adds those verifier files to a classifier `case`
  pattern.

---

### Phase C1 — The upgrade lane runs the target installer the way an operator does, and checks secrets from the file (P2 `install-upgrade-e2e--harness-pins-env-path-and-exports-secrets`)

**Evidence (re-verified on `d6cee837b4`).**
- **The harness exports every runtime secret into its own shell.** `load_runtime_env`
  (`tests/install/e2e/upgrade-install.test.sh:296-310`) runs `set -a; source "$env_file"; set +a` at `:304-306`. That
  exports every key of the runtime env, including `JWT_SECRET`, `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `GATEWAY_SECRET`
  and `POSTGRES_PASSWORD`. `test_restart_containers_after_upgrade` (`:1839`) calls it at `:1845`, then calls
  `run_install_script "$PROJECT_ROOT"` at `:1853`.
- **The target installer inherits those secrets, plus a pinned env path.** `run_install_script_command` (`:730-766`)
  runs `bash "$project_dir/install.sh"` (`:764`) in a `( … )` subshell. The subshell inherits the exported secrets. It
  also forces `export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"` (`:755`). The harness top level already exported the same
  value (`:206`, `:1033`).
- **The product keeps any inherited secret.**
  - `install.sh:927` re-exports the nine secrets to `setup.sh`.
  - `scripts/setup.sh` `load_or_generate_secrets` (`:698-808`) sources the env file only when it exists (`:709-713`).
  - It then keeps every non-empty inherited value: the nine `"  - <NAME>: using existing"` branches at `:739`, `:747`,
    `:760`, `:773`, `:780`, `:787`, `:794`, `:801` and `:808`.
  - So if neither script finds or reads the existing env file, the target still writes the **source** secrets back,
    and the lane passes.
  - In production (`cd ~/sanctuary && ./install.sh`, `README.md:1052-1061`, with no secret in the shell), the same
    regression generates a new `ENCRYPTION_KEY` and `ENCRYPTION_SALT`. Every encrypted 2FA secret and node password
    then becomes unreadable (`setup.sh:764` states this consequence).
- **Env discovery is never exercised.**
  - `install.sh` resolves the env file in `resolve_runtime_env_file` (`:315-324`), with `DEFAULT_ENV_FILE` at `:36-39`.
    It takes the legacy `$INSTALL_DIR/.env` fallback only when `SANCTUARY_ENV_FILE` is empty.
  - `setup.sh:64-75` has a similar rule, but on the upgrade path its legacy branch is never taken (review pass 1,
    C-3): `install.sh`'s `ensure_install_deployment_lock` (`:288-313`) runs before `setup.sh`, sets and exports
    `SANCTUARY_ENV_FILE="$(resolve_runtime_env_file)"` (`:296-300`), and runs `load_persisted_install_ownership_identity`
    (`:85-130`) and the deployment-lock acquire against that file. `setup.sh` therefore sees a non-empty
    `SANCTUARY_ENV_FILE`, so `:72`'s `-z` guard is false. `ENV_FILE_IS_LEGACY` is assigned at `:71`/`:74` and never
    read (`git grep -n ENV_FILE_IS_LEGACY` finds only those two lines and one grep test).
  - On the `SKIP_GIT_CHECKOUT=true` path the harness uses (`:758`), `install.sh` classifies the run as an upgrade only
    when it finds the file (`:814`, `:843-848`). It then prints `Existing runtime env detected: <file>` (`:847`) and
    `Loading existing configuration...` (`:902`).
  - Because `:755` always pins the path, neither fallback runs, and no lane asserts that the target found the file.
  - The only coverage is grep-based: `tests/install/unit/install-script.test.sh:594-601` (`Existing runtime env
    detected`) and `:2167-2175` (`ENV_FILE_IS_LEGACY`).
- **The legacy-runtime-env fixture does not test what it is named for.**
  - Its usage text says "repo-root .env compatibility path" (`tests/install/utils/upgrade-fixtures.sh:175`,
    `tests/install/README.md:188`). The fixture pins its source to `v0.8.69` (`tests/install/utils/upgrade-selection.sh:109-129`).
  - In CI the cleanup coordinator exports `SANCTUARY_ENV_FILE=<runtimeDirectory>/sanctuary.env`
    (`scripts/ownership/ci-cleanup-subject-lifecycle.mjs:27-28`). The harness therefore takes the `else` branch at
    `:196-200`, and the source installs into the runtime env.
  - `test_simulate_git_update` (`:1777`) then **copies** that file to the target's `.env` (`:1812`) and re-pins
    `SANCTUARY_ENV_FILE` to it (`:1815`).
  - The target installer is handed the legacy path explicitly. The runtime env it would otherwise find also still
    exists. So the fallback branch is unreachable on both counts.
  - `test_verify_fixture_runtime_shape` (`:1967-1977`) checks only the harness's own `resolve_env_file` (`:250-258`),
    not what `install.sh` resolved.
- **The preservation check accepts stale shell values.**
  - `test_verify_secrets_preserved` (`:1884-1916`) calls `load_runtime_env` without checking its status (`:1888`).
  - Sourcing never unsets a key, and `ORIGINAL_*` were captured from the same exported variables (`:1318-1325`; the
    source-install copy is at `:1213-1225`).
  - So a missing post-upgrade env file, or a secret dropped from it, compares the stale shell value against itself and
    passes.
  - `resolve_env_file` also silently falls back to `$PROJECT_ROOT/.env` (`:253-254`).
- **The same inheritance affects two more child invocations.** `test_recover_postgres_password_drift` (`:2277`) runs
  `setup.sh` (`:2318`) in a subshell after `load_runtime_env` (`:2281`). `test_force_rebuild_upgrade` runs
  `start.sh --rebuild` (`:2443`) after `load_runtime_env` (`:2428`). Both inherit the exported secrets.
- **Reproduced RED on a scratch copy**, by extracting the real harness functions with awk and running them:
  - **Masking proof.** Setup: write a runtime env with known secrets, call `load_runtime_env`, then call
    `run_install_script_command` against a fake `install.sh`. The fake mirrors `setup.sh`: it keeps an inherited value,
    otherwise generates one, and it never reads the existing file. Result: the post-upgrade file held the original
    secrets, and `test_verify_secrets_preserved` printed `All 5 secrets preserved correctly`.
  - **Missing file.** Deleting the env file after the upgrade still passed. The log shows
    `Runtime env not found: …/runtime/sanctuary.env`, followed by `All 5 secrets preserved correctly`.
  - **Dropped key.** Removing `ENCRYPTION_SALT` from the file still passed.
  - **Inheritance.** A fake `install.sh` that reports inherited names printed `inherited JWT_SECRET`,
    `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `GATEWAY_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` and
    `SANCTUARY_ENV_FILE`.
- **What a real operator passes.**
  - The documented upgrade is a bare `./install.sh` (`README.md:1052-1061`).
  - `SANCTUARY_ENV_FILE` is a documented operator override for a non-default location
    (`docs/how-to/runtime-secrets.md:22-25`).
  - `SANCTUARY_RUNTIME_DIR` relocates the default (`install.sh:38`). Both source refs honour it too: `git show
    v0.8.69:install.sh` and `v0.8.66` have it at `:34-35`.
  - So "an operator invocation" in the lane means: `SANCTUARY_RUNTIME_DIR` set, and `SANCTUARY_ENV_FILE` set only when
    the file is somewhere the installer would not find on its own.

**Root cause.** The harness puts the system under test's inputs into the environment in two ways. Its preservation
check then reads the same environment back instead of the file the installer wrote. So the lane cannot observe the two
failures it exists to catch:
- the target cannot find the existing env file;
- the target does not reload the existing env file.

**Fix design** (harness and test utilities only; no product code changes).
- **D-14.C1 — Scrub inherited secrets for every installer, setup and start child.**
  - Add `UPGRADE_INHERITABLE_RUNTIME_SECRETS=(JWT_SECRET ENCRYPTION_KEY ENCRYPTION_SALT GATEWAY_SECRET
    WORKER_DIAGNOSTICS_SECRET POSTGRES_PASSWORD GRAFANA_PASSWORD LLM_EGRESS_PROXY_SECRET REDIS_PASSWORD)` to
    `tests/install/utils/upgrade-assertions.sh`. This is exactly the `install.sh:927` export list, and exactly the
    `setup.sh` "using existing" set.
  - Add `scrub_inherited_runtime_secrets() { unset "${UPGRADE_INHERITABLE_RUNTIME_SECRETS[@]}"; }`.
  - Call it as the first statement after `initialize_install_test_ownership_for_root` in `run_install_script_command`,
    so it runs before `:733`'s exports.
  - Also call it as the first line inside the `setup_output=$( … )` subshell of `test_recover_postgres_password_drift`
    (`:2301`) and inside the `rebuild_output=$( … )` subshell of `test_force_rebuild_upgrade` (`:2432`).
  - It runs only inside the subshells, so the harness shell keeps its exported values for its own `psql` and API
    calls.
  - A drift guard (test 8 below) fails if `setup.sh` gains a new inherited-secret branch that the list lacks.
- **D-14.C2 — Give `SANCTUARY_ENV_FILE` to the installer only when it could not find the file on its own.**
  - Add `upgrade_installer_env_file_override PROJECT_DIR ENV_FILE RUNTIME_DIR` to `upgrade-assertions.sh`. It prints
    nothing in two cases:
    - `ENV_FILE` is `RUNTIME_DIR/sanctuary.env`, which `install.sh`'s `DEFAULT_ENV_FILE` already resolves to under the
      exported `SANCTUARY_RUNTIME_DIR`;
    - `ENV_FILE` is `PROJECT_DIR/.env`, the file exists, and `RUNTIME_DIR/sanctuary.env` does not, which is the
      installer's legacy fallback.
  - Otherwise it prints `ENV_FILE`: a genuinely custom location, which operators pass explicitly.
  - In `run_install_script_command`, replace `:755` with: `env_override="$(upgrade_installer_env_file_override
    "$project_dir" "$TEST_ENV_FILE" "$TEST_RUNTIME_DIR")"`, then `export SANCTUARY_ENV_FILE="$env_override"` when it
    is non-empty, else `unset SANCTUARY_ENV_FILE`.
  - The harness top-level exports at `:206` and `:1033` stay. Operator commands run later still need them, and
    `test_upgrade_harness_exports_operator_runtime_state` (`upgrade-helpers.test.sh:2637-2645`) pins `:206`.
  - Effect on each lane:
    - **Coordinated CI:** `TEST_ENV_FILE == $TEST_RUNTIME_DIR/sanctuary.env` (`:163`, `:199`), so the Upgrade
      Baseline (owned source, upgraded in place) now discovers the env through the default path.
    - **Fresh source installs:** they write to the same default.
    - **Local uncoordinated legacy source:** `TEST_ENV_FILE = <source>/.env`, and the file does not exist before the
      install, so the source keeps its explicit override and its repo-root shape.
- **D-14.C3 — Make the legacy fixture reach the legacy fallback.**
  - Add `move_runtime_env_to_legacy_path RUNTIME_ENV LEGACY_ENV`: it returns 1 unless the source exists and the
    destination does not, then runs `mv` and `chmod 600`.
  - In `test_simulate_git_update`'s legacy block (`:1806-1817`): when `TEST_ENV_FILE` is
    `$TEST_RUNTIME_DIR/sanctuary.env` (the coordinated case), move it to `$LEGACY_TARGET_ENV_FILE` and set a new
    global `UPGRADE_HID_RUNTIME_ENV=true`, declared next to `UPGRADE_CREATED_TARGET_LEGACY_ENV` at `:208`.
    Otherwise keep today's `cp` (`:1812`).
  - The target then runs with no runtime env, `SANCTUARY_ENV_FILE` unset (by D-14.C2) and only `<target>/.env`
    present. That is a pre-migration operator's real shape. `install.sh:315-324` takes the legacy branch, and
    `ensure_install_deployment_lock` (`:288-313`) exports that path to `setup.sh`, which then uses it explicitly
    (review pass 1, C-3).
  - The ownership layer resolves the same way (`scripts/ownership/deployment-definition.mjs:51-63` falls back to
    `<project>/.env`).
  - In `teardown` (`:1102-1104`): when `UPGRADE_HID_RUNTIME_ENV=true`, the runtime env is absent and the legacy file
    exists, move the legacy file **back** to `$TEST_RUNTIME_DIR/sanctuary.env`, so the coordinator's post-subject
    steps see the file they bound. Otherwise keep today's `rm -f`.
  - `ensureRuntimeInputs` (`scripts/ownership/ci-cleanup-lifecycle.mjs:73-82`) would write an ownership marker anyway
    if the file were missing. The restore keeps the real file.
- **D-14.C4 — Check what install.sh found, and compare secrets from files, not the shell.** Add to
  `upgrade-assertions.sh`:
  - `runtime_env_file_value FILE KEY`: the last `KEY=` definition, read with awk. Status 1 when the key is absent or
    empty. The file is never sourced. Every writer from `v0.8.66` to `HEAD` emits unquoted `KEY=$KEY` lines (`git
    show v0.8.69:scripts/setup.sh` `:772-777`; `HEAD` `setup.sh:847-853`).
  - `capture_runtime_env_secrets FILE`:
    - fails if the file is missing;
    - sets `ORIGINAL_<NAME>` for every inheritable secret the file defines;
    - fails if any of the five required ones (`JWT_SECRET ENCRYPTION_KEY ENCRYPTION_SALT GATEWAY_SECRET
      POSTGRES_PASSWORD`) is absent.
  - `assert_runtime_env_secrets_preserved FILE`: fails on a missing file, or on any secret that was captured non-empty
    and is now missing or different.
    - All nine are compared when present before the upgrade, not just today's five. No upgrade path legitimately
      rotates one: `scripts/ops/migrate-grafana-password.sh:151-200` resets Grafana to the existing
      `GRAFANA_PASSWORD` and never rewrites it.
  - `assert_install_output_was_upgrade LOG EXPECTED_ENV_FILE`: requires both `Existing runtime env detected:
    $EXPECTED_ENV_FILE` (`install.sh:847`) and `Loading existing configuration` (`:902`) in the redacted install log.
    `redact_stream` (`scripts/ci/redactor.sh:33-58`) rewrites only `*secret*|*password*|*key*…=` tokens, so the path
    line survives.

  Harness edits:
  - `test_capture_pre_upgrade_state`: replace the `load_runtime_env`/`ORIGINAL_*` block (`:1318-1328`) with
    `capture_runtime_env_secrets "$TEST_ENV_FILE" || return 1`, then `load_runtime_env || return 1` for the rest of
    the capture.
  - In the source-install step (`test_ensure_existing_installation`, `:1152`), replace the `ORIGINAL_*` assignments
    (`:1222-1226`) with the same capture, keeping the MCP check.
  - `test_restart_containers_after_upgrade`: after `:1853` succeeds, add `assert_install_output_was_upgrade
    "$(install_log_path "$PROJECT_ROOT")" "$TEST_ENV_FILE" || return 1`. `TEST_ENV_FILE` is the file the target must
    have found: the runtime env, or `$LEGACY_TARGET_ENV_FILE` after `:1814`. `run_install_script_attempt` truncates
    the log per attempt (`:778`), so an in-place source log cannot satisfy it.
  - `test_verify_secrets_preserved` (`:1884-1916`) becomes `assert_runtime_env_secrets_preserved "$TEST_ENV_FILE" ||
    return 1; load_runtime_env || return 1`. There is no `resolve_env_file` fallback, and a failed load fails.
  - `test_verify_fixture_runtime_shape` (`:1972-1977`), legacy branch: also fail when `UPGRADE_HID_RUNTIME_ENV=true`
    and `$TEST_RUNTIME_DIR/sanctuary.env` exists. That would mean the target wrote a new runtime env instead of
    updating the legacy one.
  - Update the fixture text at `upgrade-fixtures.sh:175` and `tests/install/README.md:188`: "target install discovers
    the repo-root `.env` through `install.sh`'s fallback; the runtime env is hidden".

**Failing-first tests** (all in `tests/install/unit/upgrade-helpers.test.sh`).
- Add `extract_harness_function NAME`: a copy of `extract_shell_function` (`install-script.test.sh:145-163`) bound to
  `tests/install/e2e/upgrade-install.test.sh`.
- Each test body is a `( … )` subshell, so exported secrets cannot leak into later tests. It evals the extracted
  functions and stubs `initialize_install_test_ownership_for_root() { :; }`.
- Each test sets `TEST_RUNTIME_DIR`, `TEST_ENV_FILE`, `TEST_SSL_DIR`, `TEST_COMPOSE_SSL_DIR` and `TARGET_PROJECT_ROOT`
  under `$TEST_TMP_DIR`, plus `UPGRADE_ENABLE_{MONITORING,TOR,MCP}=no`.
- The fake `$project_dir/install.sh` writes only under `$TEST_TMP_DIR`.
- Register the tests in `main` (`:2812`) next to `test_upgrade_harness_exports_operator_runtime_state`.

1. `test_upgrade_installer_scrubs_inherited_runtime_secrets`
   - Setup: export all nine secrets and `SANCTUARY_ENV_FILE`, as `load_runtime_env` does. The fake installer prints
     `inherited <NAME>` for each of the nine that is set (`${!k+x}`).
   - Assertion: the output is empty.
   - **RED on base:** `inherited JWT_SECRET` … `inherited REDIS_PASSWORD` (reproduced).
2. `test_upgrade_installer_uses_default_runtime_env_discovery`
   - Setup: `TEST_ENV_FILE=$TEST_RUNTIME_DIR/sanctuary.env`, with `SANCTUARY_ENV_FILE` exported.
   - Assertion: the fake reports `SANCTUARY_ENV_FILE` unset and `SANCTUARY_RUNTIME_DIR=$TEST_RUNTIME_DIR`.
   - **RED on base:** `inherited SANCTUARY_ENV_FILE` (`:755`).
3. `test_upgrade_installer_keeps_explicit_custom_env_file`
   - Setup: `TEST_ENV_FILE=$TEST_TMP_DIR/custom/sanctuary.env`.
   - Assertion: the fake sees exactly that path.
   - Green on base. It guards D-14.C2's custom-location branch.
4. `test_legacy_fixture_target_install_takes_repo_root_fallback`
   - Setup: `UPGRADE_USE_LEGACY_RUNTIME_ENV=true`, with `<target>/.env` present, the runtime env absent and
     `TEST_ENV_FILE=<target>/.env`. The fake installer is built from the **real** `resolve_runtime_env_file` extracted
     from `install.sh`, with `INSTALL_DIR`/`DEFAULT_RUNTIME_DIR`/`DEFAULT_ENV_FILE` set exactly as `install.sh:36-39`
     does. It prints the resolved path and `${SANCTUARY_ENV_FILE-unset}`.
   - Assertions: `unset`, and the resolved path is `<target>/.env`.
   - **RED on base:** `SANCTUARY_ENV_FILE` is the injected path (`:755`).
5. `test_secrets_preserved_check_catches_installer_that_ignores_env_file`
   - Setup: write a runtime env with `JWT_SECRET=j1 … POSTGRES_PASSWORD=p1`. Set `ORIGINAL_*` to those literals. Call
     the extracted `load_runtime_env` (as `:1845` does), then `run_install_script_command` with the **regressed**
     fake. That fake writes `${SANCTUARY_ENV_FILE:-$SANCTUARY_RUNTIME_DIR/sanctuary.env}` with an inherited value or
     `regenerated-<NAME>-$RANDOM`, and never reads the old file.
   - Assertion: `if test_verify_secrets_preserved; then echo 'preservation check passed for an installer that never
     read the env file' >&2; return 1; fi`.
   - Positive control in the same test: rerun with a **correct** fake, which sources the existing file and then
     rewrites it, and require `test_verify_secrets_preserved` to pass.
   - **RED on base:** the check prints `All 5 secrets preserved correctly` for the regressed fake (reproduced).
     **GREEN after the fix:** `JWT_SECRET changed after upgrade` (reproduced with a prototype of D-14.C1/C2/C4).
6. `test_secrets_preserved_check_fails_without_runtime_env`
   - Setup: as test 5, but delete the env file instead of running an installer.
   - Assertion: `test_verify_secrets_preserved` fails.
   - **RED on base:** passes after logging `Runtime env not found` (reproduced). Prototype after the fix: `Post-upgrade
     runtime env not found`.
7. `test_secrets_preserved_check_fails_on_dropped_secret`
   - Setup: delete the `ENCRYPTION_SALT=` line.
   - Assertion: the check fails.
   - **RED on base:** passes (reproduced). Prototype after the fix: `ENCRYPTION_SALT missing from post-upgrade runtime
     env`.
8. `test_runtime_secret_scrub_list_covers_setup_inherited_secrets` (drift guard)
   - Derive the names with `sed -n 's/^ *echo "  - \([A-Z_]*\): using existing"$/\1/p' scripts/setup.sh`.
   - Assertions: the list is non-empty and has 9 entries, and each name is in `UPGRADE_INHERITABLE_RUNTIME_SECRETS`.
     Also assert every name on `install.sh`'s `export JWT_SECRET …` line (`:927`) is in the list.
   - **RED on base:** `UPGRADE_INHERITABLE_RUNTIME_SECRETS` is undefined, so all nine are reported missing.
9. `test_install_output_upgrade_assertion_requires_expected_env_file`
   - Assertion 1: a log with `Existing runtime env detected: /x/sanctuary.env` and `Loading existing configuration...`
     passes for `/x/sanctuary.env`.
   - Assertion 2: the same log fails for `/y/.env`.
   - Assertion 3: a log missing the second line fails.
   - **RED on base:** `assert_install_output_was_upgrade: command not found`.
10. `test_legacy_runtime_env_move_refuses_overwrite`
    - Assertion 1: `move_runtime_env_to_legacy_path` moves the file (source gone, destination mode `600`).
    - Assertion 2: it returns 1, and touches neither file, when the destination exists or the source is missing.
    - **RED on base:** `command not found`.

Plus one characterization test in `tests/install/unit/install-script.test.sh`:
`test_install_resolve_runtime_env_file_prefers_runtime_then_legacy`.
- It extracts `resolve_runtime_env_file` with the suite's `extract_shell_function` (`:145-163`) and checks three cases:
  - runtime env present: picks the runtime env;
  - runtime env absent, `<dir>/.env` present: picks `<dir>/.env`;
  - `SANCTUARY_ENV_FILE` set: picks it even when only `.env` exists.
- It replaces the grep-only coverage at `:594-601` as behavioural evidence for the branch D-14.C3 now drives end to
  end. It is green on base: the product is correct today, and this makes the claim checkable without Docker.
- Register it next to `test_install_script_detects_skip_checkout_upgrade_mode`.

**Confirm RED first** (on `d6cee837b4`, tests added, no harness edit):
```bash
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/upgrade-helpers.test.sh   # red: tests 1,2,4-10; tests 3 and the 100 existing pass
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/install-script.test.sh      # green: characterization only
```
(The base suite was run on the scratch copy: 100/100 pass in about 10 s.)

Then apply D-14.C1–C4. All of the above go GREEN, followed by:
```bash
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/upgrade-helpers.test.sh
bash -n tests/install/e2e/upgrade-install.test.sh
bash scripts/ci/run-install-unit-tests.sh
bash tests/ci/ci-registration-completeness.test.sh
node scripts/ci/check-negated-test-assertions.mjs
node scripts/ownership/check-lifecycle-callsites.mjs
```
A prototype of D-14.C1/C2/C4 on the scratch copy turned the reproduced REDs for tests 1, 2, 5, 6 and 7 GREEN. The 100
existing `upgrade-helpers` tests stayed green, and `bash -n` passed.

**Existing tests the fix touches.**
- `test_upgrade_harness_exports_operator_runtime_state` (`upgrade-helpers.test.sh:2637-2645`) greps for `export
  SANCTUARY_ENV_FILE="$TEST_ENV_FILE"`. `:206` still has that line, so the test is unaffected.
- `test_upgrade_harness_sources_extracted_helpers` (`:1437-1447`) pins the `run_install_script_command … | tee` line
  (`:778`), which is unchanged.
- `test_upgrade_harness_never_logs_secret_prefixes` (`:1801-1808`): the new code prints no `:0:8}` slice.
- `test_fixture_defaults_are_composable` (`:406`) still sees `UPGRADE_USE_LEGACY_RUNTIME_ENV=true`.

**CI lanes that exercise it, and how the PR proves it.**
- **Unit tests.** `Install Script Unit Tests` (`.github/workflows/install-test.yml:261`, `:284` →
  `scripts/ci/run-install-unit-tests.sh`, glob `tests/install/unit/*.test.sh` at `:47`) and Release Candidate
  Validation's install unit step (`.github/workflows/release-candidate.yml:291`) run tests 1–10.
- **Upgrade Baseline on the PR.** The PR edits `tests/install/e2e/upgrade-install.test.sh` and
  `tests/install/utils/upgrade-*`:
  - `classify-install-scope.sh:472` sets `upgrade_harness_touched`, and `:573-578` enables the upgrade;
  - `defer_automatic_upgrade_e2e` (`:356-368`, called at `:591`) defers it;
  - `enable_pr_upgrade_baseline_for_harness_changes` (`:397`, called at `:592`) re-enables one bounded baseline
    (`latest-stable`).

  So **Upgrade Baseline** (`install-test.yml:868`) runs on the PR head. It is an owned source upgraded in place. This
  is the end-to-end proof of D-14.C1, C2 and C4: secrets scrubbed, `SANCTUARY_ENV_FILE` unset, `install.sh` finding
  the runtime env through `DEFAULT_ENV_FILE` (`Existing runtime env detected: <runtime>/sanctuary.env`), and secrets
  compared from the file.
- **Legacy fixture (D-14.C3).** It runs only in **Upgrade Extended Fixtures** (`install-test.yml:1026`), on release
  tags and dispatch. The PR proves it with a `workflow_dispatch` of `install-test.yml` on the PR branch, with
  `test_suite=upgrade`, `upgrade_fixture=all` and `upgrade_source_ref=latest-stable`
  (`install-test.yml:144-171`; `apply_manual_upgrade_selection`'s `all)` branch, `classify-install-scope.sh:170-174`;
  the per-fixture source pins still apply, `run-extended-upgrade-fixtures.sh:237`). The dispatch starts the same jobs
  an RC tag runs (review pass 5, C-13):
  - **Upgrade Baseline** (`install-test.yml:868`), one latest-stable baseline;
  - **Upgrade Extended Fixtures** (`:1026`), all five extended fixtures sequentially in one job; it continues past a
    failed fixture (`run-extended-upgrade-fixtures.sh:212-247`), so one failure does not hide a later one;
  - the **Upgrade Extended Fixture Canary (optional-profiles, owned source)** (`:1168`), informational only: it
    always exits 0 and reports a failure only as a `::warning title=Owned-source canary` annotation (`:1236-1246`), so
    a canary warning is recorded in the PR body, never routed;
  - the **Upgrade Extended** aggregate (`:1311`).

  The dispatch is **green** when Upgrade Baseline, Upgrade Extended Fixtures and the Upgrade Extended aggregate all
  succeed. Attribute an Upgrade Extended Fixtures `failure` to a fixture by the `Extended upgrade fixture failed:
  <fixture>` line (`run-extended-upgrade-fixtures.sh:242`) in `upgrade-extended-fixtures.log` inside the
  `diag-upgrade-extended-fixtures-<run_id>` artifact; the job conclusion alone cannot say which fixture failed (review
  pass 6, C-15). That line is not a job annotation and is not in the live job log: the fixtures step runs under
  `scripts/ci/run-with-log.sh` (`install-test.yml:1078-1091`), which keeps ordinary output log-file-only and forwards
  live only timing, performance-budget and lifecycle lines (`forward-live-annotations.mjs:104-109`). The diag upload is
  `continue-on-error` with 14-day retention (`install-test.yml:1146-1153`), so download it within that window. If the
  artifact is missing, fall back to the live `::error title=CI timing::upgrade extended <ref> <fixture> … with exit
  code N` line (`time-command.sh:47`, forwarded live). All fixtures run because
  D-14.C1, C2 and C4 change harness code every extended fixture executes (`run_install_script_command`,
  `test_capture_pre_upgrade_state`, `test_ensure_existing_installation`, `test_restart_containers_after_upgrade`,
  `test_verify_secrets_preserved`), and no pre-merge lane otherwise runs `browser-origin-ip`, `notification-delivery`,
  `optional-profiles` or `wallet-sync-retirement` (review pass 4, C-11). **Infrastructure triage first (review pass 5,
  C-14):** before routing any dispatch `failure`, check the failing job's and fixture's logs (the `upgrade-extended-fixtures`
  and `diag-upgrade-extended-fixtures-<run_id>` artifacts), the diagnostic summary (`scripts/ci/write-diagnostic-summary.sh`)
  and the runner host snapshots for the job's `Name:` host against CLAUDE.md "CI/Infrastructure Debugging": a runner-lock
  timeout (`timed out ... waiting for runner lock`, or a stranded `e2e` lock holder), a DIND or Podman stall, a subject
  budget overrun before the target install, or host-specific builder divergence. Each fixture takes the host's `e2e`
  runner lock in turn (`run-extended-upgrade-fixtures.sh:189`) and competes with the dispatch's baseline and canary
  and the PR's own install lanes, and an infrastructure failure still surfaces as `Extended upgrade fixture failed:
  <fixture>`. A failed fixtures job with no per-fixture `CI timing` line never reached the harness (it failed in
  `with-runner-lock` or cleanup setup before `time-command.sh`), which points at infrastructure and goes to this
  triage (review pass 6, C-15). A failure caused by the infrastructure is neither C-Q1 nor a D-14.X3 stop and is not a product finding:
  re-dispatch it under CLAUDE.md's four-part retrigger evidence (immutable 40-character SHA plus run and job IDs,
  failure signature, new hypothesis, cheap discriminator) and record both run IDs. Only a failure inside the harness
  or installer steps is routed: a `failure` in legacy-runtime-env is C-Q1; a `failure` in any other fixture, or of the
  dispatch's own Upgrade Baseline job (it runs the same C1-changed functions), is a C1 harness regression and a D-14.X3
  stop (coordinator re-assessment), not C-Q1. An Upgrade Extended Fixtures `failure` with no attributable fixture line
  (for example the `if: always()` `Verify extended upgrade cleanup receipts` step, `install-test.yml:1121-1127`, after
  every fixture passed, or a pre-fixture step such as `Check Docker`) is, after infrastructure triage, a D-14.X3 stop
  (review pass 6, C-15). Without `upgrade_source_ref` the
  dispatch also runs two full Upgrade Baselines (`upgrade_default_baseline_refs` = `latest-stable,n-2`,
  `tests/install/utils/upgrade-selection.sh:8-10`) on the e2e-locked hosts, contending with the PR's own required
  lanes; the n-2 baseline is intentionally not re-run. The legacy fixture keeps its v0.8.69 source
  (`upgrade_extended_fixture_source_ref`, `upgrade-selection.sh:101-130`) (review pass 1, C-2).
  - Record that run's ID in the PR body.
  - A dispatch run is evidence, not the required gate.
  - Run it **before** the merge: if the product's legacy fallback is broken, this is the first lane that can show it
    (see C-Q1).

**Acceptance.**
- No installer, `setup.sh` or `start.sh --rebuild` child of the upgrade lane inherits any of the nine secrets.
- The target installer gets `SANCTUARY_ENV_FILE` only for a custom location. On the baseline and legacy lanes it finds
  the env itself, and the lane fails unless the install log names the expected file.
- The legacy-runtime-env fixture upgrades with no runtime env present, through the repo-root `.env`.
- A missing post-upgrade env file, or a secret that is dropped or changed, fails `Verify Secrets Preserved`.
- Unit tests 1–10 and the characterization test pass. The PR's Upgrade Baseline is green. The dispatch run of all
  extended fixtures (`upgrade_fixture=all`) is green: its Upgrade Baseline, Upgrade Extended Fixtures and Upgrade
  Extended jobs succeed, and any owned-source canary `::warning` is recorded (review pass 5, C-13). Otherwise, after
  infrastructure triage (an infrastructure failure is re-dispatched with four-part evidence, C-14), C-Q1 is triggered
  by a legacy-runtime-env `failure` attributed through its `Extended upgrade fixture failed:` line in the
  `diag-upgrade-extended-fixtures-<run_id>` log (fallback: its live `CI timing` error line; C-15), and a `failure` in
  any other fixture, in the dispatch's Upgrade Baseline, or of the fixtures job with no attributable fixture line is a
  D-14.X3 stop.

**Rollback.** Revert the C1 commit. Only test-harness code changes. There is no product, data or deployment-store
effect, and the teardown restore (D-14.C3) means a reverted harness finds the runtime env where it expects it.

---

### Phase C2 — The supply-chain lock gate runs on every quality run, and real-checkout contract suites route their inputs (P2 `ci-classifier--supply-chain-lock-inputs-skip-classifier-job`)

**Evidence (re-verified on `d6cee837b4`).**
- **Where the gate runs.**
  - In `quality.yml`, `npm run check:supply-chain-locks` appears only at `.github/workflows/quality.yml:865`, inside
    `ci-classifier-tests` (`:614`).
  - That job is gated by `if: always() && needs.determine-scope.outputs.run_ci_classifier_tests == 'true'` (`:619`).
    The aggregate accepts it as skipped unless the flag is true (`:1335-1339`).
  - The only other caller is `.github/workflows/renovate-preflight.yml:69`, which runs on Renovate PRs only.
  - `docs/reference/ci-cd-strategy.md:132-133` documents the gate as running in the "CI classifier tests" job.
- **What the gate reads** (`scripts/ci/check-supply-chain-locks.mjs`):
  - `isImageSource` (`:35-48`): every Dockerfile, `docker-compose.yml`, `.github/workflows/*.yml`, `docker/**/*.yml`,
    `scripts/verify-*/**/*.yml`, three `config/*-proof.json` files and three named scripts. A digest drift fails at
    `:128-129`.
  - Every Dockerfile with `apk add`/`apt-get install`: any byte change fails `changed after its OS package
    acquisition review` (`:142-154`).
  - Every `package.json` and `package-lock.json` in the tree, for the funds-critical pins (`:168-190`, `:244-247`).
  - `scripts/ci/images/go-runner.Dockerfile`, `.github/actions/setup-node-toolchain/action.yml`,
    `scripts/verify-addresses/implementations/go.mod`, `.nvmrc` and four workflows (`:192-237`).
  - Its own locks: `config/container-image-lock.json` (`:101`) and `config/ci-toolchain-lock.json` (`:242`).
- **What the classifier routes.** `is_ci_classifier_file` (`scripts/ci/classify-quality-scope.sh:105-130`) lists
  `scripts/ci`, `tests/ci`, ownership files, release files and root `package.json` only. `:210` is the only place
  `run_ci_classifier_tests` becomes true for `pull_request`, `merge_group` and `push`.
- **Reproduced on a scratch copy.** `scripts/ci/classify-quality-scope.sh` was run with `EVENT_NAME=pull_request` and
  then `push` in a fixture repo, committing one path at a time. Each of these emits `run_ci_classifier_tests=false`:
  - `server/Dockerfile`, `gateway/Dockerfile`, `docker/frontend/Dockerfile`, `docker/test/backend.Dockerfile`;
  - `server/package.json`, root `package-lock.json`, `scripts/verify-addresses/package.json`,
    `scripts/verify-psbt/package-lock.json`;
  - `docker-compose.yml`, `docker/compose/monitoring.yml`, `docker/compose/test.yml`;
  - `.nvmrc`, `scripts/verify-addresses/implementations/go.mod`;
  - `config/container-image-lock.json` (the gate's **own** lock), `config/trezor-emulator-proof.json`;
  - `.github/workflows/release-candidate.yml`, `scripts/offline/bundle-common.sh`.

  So an unreviewed `apk add` in `server/Dockerfile`, or a server-only `bitcoinjs-lib` bump, merges green. It surfaces
  only on the nightly schedule (`classify-quality-scope.sh:37-42`) or on the next unrelated PR that touches `scripts/ci`.
- **The same blind spot affects four other gates.** These suites run only in `ci-classifier-tests` and read the
  **real** checkout:
  - `tests/ci/docker-compose-test-contract.test.mjs` (`quality.yml:867`) reads `docker/compose/test.yml` (`:5`),
    `docker/frontend/Dockerfile` (`:6-7`), `scripts/run-tests.sh` (`:197`), `docker/test/backend.Dockerfile` (`:203`)
    and its `.dockerignore` (`:209`, `:220`).
  - `tests/ci/integration-compose-isolation.test.sh` (`:920`) reads `docker/compose/test.yml` and
    `scripts/run-integration-tests.sh` (`:20-21`).
  - `tests/ci/verify-addresses-repeatable.test.sh` (`:958`) reads `scripts/verify-addresses/verify-repeatable.sh`
    (`:5`), copies the real `go.mod`/`go.sum` (`:373-376`) and greps the real `scripts/verify-addresses/docker-compose.yml`
    (`:391`).
  - `tests/ci/verify-repeatable-rpc-wait.test.sh` (`:940`) reads `verify-repeatable.sh` (`:16`).

  None of those inputs routes to the job.
- **Why the existing guard misses it.** The D-11.18 guard derives subjects only from six hard-coded suites
  (`tests/ci/classify-quality-scope.test.sh:124-137`). Its regex also accepts only
  `scripts/quality*|scripts/ops/*|server/.husky/*` (`:140-150`, regex at `:143`).
- **Precedent for a gate that always runs.** `determine-scope` (`quality.yml:56-121`) has no job-level `if:`. Its
  success is required unconditionally (`require_success "Determine Quality Scope"`, `:1285`). It already runs a
  repository-wide gate before classifying: `Check tracked root layout` → `check-root-layout.mjs` (`:78-81`). The
  supply-chain gate needs only Node built-ins and `scripts/lib/is-main-module.mjs`, with no `npm ci`. It took 0.19 s
  on the scratch copy (`Supply-chain image, toolchain, and funds-critical package locks verified`).

**Root cause.** A gate that checks repository-wide invariants was placed in a job whose trigger is a hand-maintained
list of paths, and none of the gate's inputs are on that list. The real-checkout contract suites have the same flaw.
The routing guard derives its subjects from too few suites to notice.

**Fix design.**
- **D-14.C5 — Run the supply-chain gate unconditionally in `determine-scope`; do not route it.**
  - Add a step `Check supply-chain locks` immediately after `Classify quality scope` (`quality.yml:83-97`) and before
    `Write quality scope failure breadcrumb` (`:98`):
    ```yaml
          - name: Check supply-chain locks
            run: >
              ${{ github.workspace }}/scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/supply-chain-locks.log"
              node ${{ github.workspace }}/scripts/ci/check-supply-chain-locks.mjs
    ```
  - Place it after classify so the scope outputs are already written when it fails. Give it no `if:`.
  - Remove `npm run check:supply-chain-locks` from `ci-classifier-tests` (`:865`), so the gate has one owner. Keep
    `node --test tests/ci/check-supply-chain-locks.test.mjs` (`:855`) there. It is the gate's own unit suite, and its
    inputs (`scripts/ci/*`, `tests/ci/*`) already route.
  - Update `docs/reference/ci-cd-strategy.md:132-133` to "run in the Determine Quality Scope job on every quality run".
  - Rationale against the two designs the finding suggested:
    - Deriving a trigger set from the gate's inputs needs a predicate that mirrors `walk` + `isImageSource` + the
      Dockerfile/manifest sweeps + the toolchain list. That must be refactored into the gate under the lizard
      constraint above.
    - Hand-listing the inputs is what failed here.
    - Running a 0.2 s gate on every event has no trigger to drift. It also covers `merge_group` and `push`, and it
      needs no aggregate change, because `determine-scope` success is already required.
- **D-14.C6 — Route the real-checkout inputs of the four contract suites, and derive them in the guard.**
  - In `is_ci_classifier_file`, after the backup/pre-commit case (`classify-quality-scope.sh:117-119`), add one case:
    ```
    docker/compose/test.yml|docker/frontend/Dockerfile|docker/test/backend.Dockerfile|docker/test/backend.Dockerfile.dockerignore|scripts/run-tests.sh|scripts/run-integration-tests.sh|scripts/verify-addresses/verify-repeatable.sh|scripts/verify-addresses/docker-compose.yml|scripts/verify-addresses/implementations/go.mod|scripts/verify-addresses/implementations/go.sum)
    ```
    Comment it as "real checkout files read by the classifier-only contract suites (D-14.C6)".
  - These are exact paths, not globs. `docker-compose.yml`, `docker/compose/<other>.yml` and other Dockerfiles stay
    unrouted. They are now covered by D-14.C5, and the existing assertions that `docker-compose.yml` and
    `docker/compose/example.yml` do not select the classifier (`classify-quality-scope.test.sh:349-364`) keep holding.
- **D-14.C7 — Exclude `ci-registration-completeness.test.sh` from routing (justified).**
  - Its only unrouted input is `tests/install/**`: `run-all-tests.sh` vs `tests/install/unit/*.test.sh`
    (`tests/ci/ci-registration-completeness.test.sh:353-372`).
  - The CI install lane runs suites by glob (`scripts/ci/run-install-unit-tests.sh:47`), so a missing `run-all-tests.sh`
    line under-covers only the **local** documented runner. It does not skip any CI gate.
  - Routing `tests/install/unit/*` would put the whole classifier job on every install unit-test edit, against the
    explicit assertion at `classify-quality-scope.test.sh:349-364`.
  - It still runs on any `scripts/ci`/`tests/ci` change and nightly. Record it as a P3 backlog item, together with C-Q2.
- **D-14.C8 — No change to the funds-critical logic, the lock files or the gate script.** The fix is entirely about
  *when* the gate runs.

**Failing-first tests.**
1. `tests/ci/classify-quality-scope.test.sh`: add a second derived guard next to `CLASSIFIER_SUBJECT_SUITES`
   (`:124-137`).
   - `REAL_INPUT_SUITES=(tests/ci/docker-compose-test-contract.test.mjs tests/ci/integration-compose-isolation.test.sh
     tests/ci/verify-addresses-repeatable.test.sh tests/ci/verify-repeatable-rpc-wait.test.sh)`.
   - `derive_real_input_subjects`:
     - collects tokens anchored on `$ROOT_DIR/`, `$REPO_ROOT/` or `readFileSync('`, plus `const x = '<dir>/<file>'`
       literals (for `docker-compose-test-contract.test.mjs:6`);
     - strips trailing punctuation;
     - keeps only tracked regular files, as `derive_classifier_subjects` does (`:140-150`).
   - Pinned `EXPECTED_REAL_INPUT_SUBJECTS`, as derived on the scratch copy (14 entries):
     ```
     docker/compose/test.yml
     docker/frontend/Dockerfile
     docker/test/backend.Dockerfile
     docker/test/backend.Dockerfile.dockerignore
     scripts/ci/docker-endpoint-lib.sh
     scripts/ci/provider-context.sh
     scripts/ownership/producer-hooks.sh
     scripts/run-integration-tests.sh
     scripts/run-tests.sh
     scripts/verify-addresses/docker-compose.yml
     scripts/verify-addresses/implementations/go.mod
     scripts/verify-addresses/implementations/go.sum
     scripts/verify-addresses/verify-repeatable.sh
     server/tests/integration/ops/phase2OperationsProof.integration.test.ts
     ```
   - `assert_real_input_subjects_routed REPO HEAD OUT`:
     - fails `real-input suite subjects drifted; derived: …` when the derived list differs from the pin;
     - then commits each subject in the fixture and runs the classifier as `pull_request`;
     - fails `real-input suite subjects do not run ci-classifier-tests: <list>`.
   - Call it right after `assert_classifier_subjects_routed` (`:305`).
   - **RED on base** (reproduced on the scratch copy): `FAIL: real-input suite subjects do not run ci-classifier-tests:
     docker/compose/test.yml docker/frontend/Dockerfile docker/test/backend.Dockerfile
     docker/test/backend.Dockerfile.dockerignore scripts/run-integration-tests.sh scripts/run-tests.sh
     scripts/verify-addresses/docker-compose.yml scripts/verify-addresses/implementations/go.mod
     scripts/verify-addresses/implementations/go.sum scripts/verify-addresses/verify-repeatable.sh`.
   - **GREEN after D-14.C6** (reproduced): `classify-quality-scope regression checks passed`. Every existing assertion
     in the file still holds.
2. `tests/ci/check-workflow-composition.test.sh`: next to the determine-scope diagnostics block (`:4021-4036`), add:
   - `assert_named_job_step_contains_in_order "$QUALITY_WORKFLOW" "determine-scope" "Check supply-chain locks" "quality
     runs the supply-chain lock gate on every event (D-14.C5)" 'scripts/ci/run-with-log.sh
     "$DIAGNOSTIC_DIR/supply-chain-locks.log"' 'scripts/ci/check-supply-chain-locks.mjs'`;
   - `assert_named_job_step_not_contains "$QUALITY_WORKFLOW" "determine-scope" "Check supply-chain locks" "supply-chain
     lock step is unconditional" 'if:'`;
   - `assert_named_job_not_contains "$QUALITY_WORKFLOW" "determine-scope" "determine-scope has no job-level condition"
     $'\n    if:'` (steps' `if:` lines sit at 8 spaces and cannot match);
   - `assert_named_job_not_contains "$QUALITY_WORKFLOW" "ci-classifier-tests" "supply-chain lock gate has one owner"
     'npm run check:supply-chain-locks'`.

   **RED on base:** `could not extract determine-scope/Check supply-chain locks` (two failures) and
   `ci-classifier-tests contains forbidden text: npm run check:supply-chain-locks`.

**Confirm RED first** (on `d6cee837b4`, tests added, no workflow or classifier edit):
```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" bash tests/ci/classify-quality-scope.test.sh   # red: test 1
npm ci --prefix tests/ci/lib --strict-allow-scripts --ignore-scripts --audit=false --fund=false   # as quality.yml:636
bash tests/ci/check-workflow-composition.test.sh                                                  # red: test 2 (3 labels)
```
Then apply D-14.C5–C6 and the doc edit. Both go GREEN, followed by:
```bash
node scripts/ci/check-supply-chain-locks.mjs
bash tests/ci/ci-registration-completeness.test.sh
node --test tests/ci/check-supply-chain-locks.test.mjs
bash -n scripts/ci/classify-quality-scope.sh
node scripts/ci/check-negated-test-assertions.mjs
node scripts/ownership/check-lifecycle-callsites.mjs
bash tests/ci/run-actionlint.test.sh    # actionlint on the edited quality.yml, if the binary is present locally
```
`ci-registration-completeness` still finds `scripts/ci/check-supply-chain-locks.mjs` executed: it appears as
`node scripts/ci/check-supply-chain-locks.mjs` in `renovate-preflight.yml:69`, and as a reference in the new step.

**CI lanes that exercise it, and how the PR proves it.**
- The PR edits `.github/workflows/quality.yml`, `scripts/ci/classify-quality-scope.sh` and `tests/ci/*`. All three are
  in `is_ci_classifier_file` (`:107`), so **CI classifier tests** runs on the PR head and executes both modified suites
  (`quality.yml:909`, `:965`).
- `determine-scope` runs the new step on the PR head itself. Its successful `Check supply-chain locks` step is the
  end-to-end proof (the log file is not exposed on a green run; review pass 3, C-10).
  The aggregate already requires `Determine Quality Scope` success (`:1285`).
- `quality.yml` is listed in `config/hardware-emulator-source-inventory.json:84` (jade), so the PR also runs the Jade
  emulator proof. Expect that cost; it is not a signal about this change.
- The proof is **local and red-first**, per repo rules: the reproduced RED and GREEN above. No CI retrigger is needed to
  show the routing.

**Acceptance.**
- Every `pull_request`, `merge_group`, `push`, `schedule` and `workflow_dispatch` quality run executes
  `check-supply-chain-locks.mjs` in `determine-scope`. A failure fails the required `Quality required checks`
  aggregate.
- A PR that changes only `server/Dockerfile`, `server/package.json`, `.nvmrc`, `config/container-image-lock.json` or a
  compose image reference runs the gate.
- A PR that changes only one of the ten D-14.C6 paths selects `ci-classifier-tests`.
- Both new guards pass. Every existing `classify-quality-scope.test.sh` assertion still passes unchanged.

**Rollback.** Revert the C2 commit. The gate moves back to `ci-classifier-tests`, and the classifier loses ten exact
paths. There is no state, lock or artifact change.

---

### Phase C open questions

- **C-Q1 — What if the legacy-runtime-env dispatch run fails in the target install after D-14.C3? DECIDED
  (coordinator): treat it as a product finding**, as recommended below, with one change: nothing is pre-authorised as
  holdable (D-14.X3). Only a `failure` conclusion of a job that ran triggers C-Q1. A `cancelled` conclusion caused by
  the shared `sanctuary-runner-e2e-workflow` concurrency group (`install-test.yml:176-192`) is re-dispatched with both
  run IDs recorded, not filed as a product finding (review pass 3, C-9). A `failure` in any extended fixture other than
  legacy-runtime-env in the `upgrade_fixture=all` dispatch, or of the dispatch's own Upgrade Baseline job, is not C-Q1
  but a D-14.X3 stop (review pass 4, C-11; review pass 5, C-13); attribute a fixture failure by its `Extended upgrade
  fixture failed: <fixture>` line (`run-extended-upgrade-fixtures.sh:242`) in `upgrade-extended-fixtures.log` inside
  the `diag-upgrade-extended-fixtures-<run_id>` artifact (log-file-only, not a job annotation; 14-day retention), or,
  if the artifact is missing, by the live `::error title=CI timing::upgrade extended <ref> <fixture> … with exit code
  N` line (`time-command.sh:47`) (review pass 6, C-15). A fixtures-job failure with no attributable fixture line (the
  cleanup-receipt verification, a pre-fixture step) is, after infrastructure triage, a D-14.X3 stop. Before routing any dispatch
  `failure`, triage infrastructure causes first (review pass 5, C-14): check the fixture and job logs, the diagnostic
  summary (`scripts/ci/write-diagnostic-summary.sh`) and the runner host snapshots for a runner-lock timeout (`waiting
  for runner lock`), a DIND or Podman stall, a budget overrun or host-specific builder divergence. An infrastructure
  failure is re-dispatched under CLAUDE.md's four-part retrigger evidence (immutable SHA plus run/job IDs, failure
  signature, new hypothesis, cheap discriminator) with both run IDs recorded; it is neither C-Q1 nor a stop. A defect in `install.sh:85-130`, `install.sh:288-324` or `scripts/setup.sh:56-75` (review pass 1,
  C-3) is fixed red-first inside C1 after the
  coordinator adds that file to phase `c`'s ownership; any other cause stops delivery and the coordinator decides
  whether D-14.C3 is split out, recording the decision in the implementation log.
  - Such a failure would come from the target no longer upgrading through `<target>/.env` alone. That is the product
    path a pre-migration operator takes, and today no lane exercises it.
  - **Recommendation:** treat it as a new product finding, not harness noise:
    - Write it up with the run ID.
    - If the defect is in `install.sh:85-130`, `install.sh:288-324` or `scripts/setup.sh:56-75`, add a unit-level red
      test and fix it inside C1 before merging. The likely failure surface for a pre-ownership `.env` on an
      ownership-aware target is `install.sh`'s ownership-identity load and deployment-lock acquire, not `setup.sh`.
    - Otherwise (drafter's fallback, now a coordinator decision under D-14.X3, not a pre-authorised hold): hold C1's
      D-14.C3 part, and ship D-14.C1/C2/C4 alone.
  - Do **not** weaken the move back to a copy to make the lane green.
- **C-Q2 — Should C2 fix the wider blind spot that the same sweep reveals? DECIDED (coordinator): no; P3 follow-up
  `ci-classifier--real-checkout-reads-unrouted`** (with D-14.C7), paired with
  `ci-npm-ci-callsites--prefix-form-undiscovered-and-gate-scope`. Sweeping *all* 118 suites that
  `ci-classifier-tests` invokes for anchored real-file reads finds 46 tracked paths that do not route.
  - Examples: `server/package.json`, `server/Dockerfile`, `gateway/Dockerfile`, `llm-egress-proxy/Dockerfile`,
    `docker-compose.yml`, `docker/compose/{monitoring,tor}.yml`, `.github/workflows/{architecture,docker-build,release-candidate}.yml`,
    `tests/install/utils/{classify-install-scope,upgrade-selection}.sh`.
  - Reproduce: extract the `ci-classifier-tests` job, grep each invoked `tests/ci/*.test.*` for
    `$ROOT_DIR/|$REPO_ROOT/|$ROOT/|readFileSync('` tokens, keep tracked files and drop the already-routed patterns.
  - Some of those reads are fixture copies rather than assertions.
  - Routing all of them would run the classifier job on most Docker and dependency PRs.
  - **Recommendation:** keep C2 bounded to the gate in the finding plus the four suites Fork A named. File a P3
    backlog item that pairs this sweep with the existing P3 `ci-npm-ci-callsites--prefix-form-undiscovered-and-gate-scope`.
    Its fix should decide, suite by suite, between "route", "move to an always-on step like D-14.C5" and "stop
    reading the real file".
- **C-Q3 — Should the supply-chain gate get its own scoped job instead of an always-on step? DECIDED (coordinator): no;
  always-on step in `determine-scope` (D-14.C5).** That design adds a
  `run_supply_chain_locks` output fed by an `isSupplyChainLockInputPath` predicate exported from the gate, mirroring
  `isLifecycleScannedPath` (`classify-quality-scope.sh:224-237`).
  - **Recommendation: no.** It costs:
    - a new job;
    - two aggregate branches;
    - a predicate that must track three file sweeps;
    - edits below `check-supply-chain-locks.mjs:61` under the lizard constraint.

    It does this to save about 0.2 s per run.
  - Revisit only if the gate ever needs `npm ci` or network access.

## Implementation log (coordinator)

- Phase worktrees cut from plan commit `86263c8d9` (reviewed, 9 passes). Workers a, b, c; every red failed on base for the
  stated reason (accepted reds per D-14.X3), every GREEN set passed; no D-14.X3 stop. Red/green evidence in the scratchpad
  (`i14-<phase>-red*.txt` / `-green*.txt`).
- a: `73d1f67e7` (A1), `2fd9e7104` (A3); b: `0eb464cf1` (B1), `143841235` (B2), `73e4720b9` (B3); c: `09e92fe4d` (C1),
  `b92e1f876` (C2). Integrated by `git cherry-pick -x` as `c7f4b1a1e`, `575d169bb`, `555f41e96`, `cc97b59cc`, `6195f0f86`,
  `66a587528`, `ce7ce54dd`; every phase branch proven upstream with `git cherry` (all `-`), branches and worktrees removed.
- `/simplify` (reuse, quality, efficiency) + adversarial review: no P0–P2. Applied in `17fea1467` ("refactor: simplify
  iteration 14 fixes after review"), each behavioural item with a red-first test:
  - A1: admin requests no longer await the publish (a hung Redis — reproduced pending >15 s — stalled the save); node-config
    saves publish only changed networks (`network: null` only for global fields; nothing when unchanged) and the worker
    resets only those; `testSavedElectrumServer` no longer broadcasts and a no-op reorder skips it; malformed events are
    dropped before the worker's serial chain (one bad payload previously skipped the next valid change); shared
    `teardownNetworkState` (the new reconnect path had skipped detaching listeners and active-state cleanup).
  - A3 `exceedsMultisigSignerLimit` predicate; B2 shared Grafana base URL, `AbortSignal.timeout`, body discarded, one
    anonymous-state badge table; test and harness de-duplication.
  - Not applied (decided): narrowing `field` to `NetworkConfigField` (D-14.B3a); the pre-existing ENABLE_MCP read.
- Integrator commit: `docs/architecture/generated/frontend.md` (B1's two new `shared/utils/bitcoin` edges) and the
  changelog bullets.
- **Verification block** (on `ae9802682`, host load ~9 after waiting out unrelated load ~19): EXIT 0 first run — backend `vitest --coverage tests/unit` 17703/17703, frontend coverage 9974/9974 at 100%, both integration worker specs green (cleanup `cleaned`), Playwright 392 expected / only the 7 known auth-login failures / PNG baselines unchanged, lizard 84 (= base), mutation-pin allow-lists and scope check, arch:check, every quality/ownership/install/CI gate green.

## Verification (before every push)

Workers run only their phase's typechecks and targeted tests (no coverage) and record red runs on the plan-commit
base. The integrator runs the whole block below, as written, as one script on the integrated PR branch in
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i14` (every `cd server` is in a subshell), only after every phase branch
is cherry-picked, and is the only one who runs coverage (backend and frontend), the static Playwright run and the
`docs/architecture/generated` regeneration; the coverage branches each phase names are the integrator's checklist.
Any `tests/install/unit` suite run directly (outside `scripts/ci/run-install-unit-tests.sh`) needs the `@runtime`
project-lock-root env shown below. Write the block to `$SCRATCH/i14-verify.sh` and run
`bash "$SCRATCH/i14-verify.sh"` — never paste it into `bash -c` or the Bash tool: a `pgrep -f` guard would match the
integrator's own shell (the guard is anchored to `[n]ode_modules/.bin/...`).

**Integrator step before the block.** Set up the integration worktree like the phase worktrees (D-14.X2): a real root
`npm ci` (no symlinked `node_modules`), `cd server && npx prisma generate`, and `npm run build --workspace=shared`,
with nvm node on `PATH`. Then run `npm run arch:graphs` and `npm run arch:calls` and commit
`docs/architecture/generated` in the integrator commit (with the changelog bullets below), so `arch:check` below is a
pure check. Re-use the Playwright scratch inputs from iteration 13: copy
`$SCRATCH/i13-playwright/playwright.static.config.mts` and `$SCRATCH/i13-playwright/known-auth-login-failures.txt` to
`$SCRATCH/i14-playwright/`, and change the wrapper's import path from
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i13/config/tooling/playwright.config.ts` to
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i14/config/tooling/playwright.config.ts` (the block asserts it).

**Changelog bullets (integrator, `docs/reference/changelog.md` `## [Unreleased]`):**
- A1: "Saving Node Config or editing Electrum servers now takes effect in the background worker without a restart".
- A3: "Creating or importing a multisig wallet with more than 16 signers is rejected with a clear message".
- B1: "Devices whose account paths use h-notation (for example `m/84h/0h/0h`) are shown on their network again".
- B2: "Monitoring shows Grafana's actual anonymous-viewing state; the toggle that had no effect is removed".
- B3: "Node Config Quick Presets set host, port and protocol together".
- C1: "The upgrade test lane runs the target installer as an operator does and checks secrets from the env file".
- C2: "The supply-chain lock check runs on every quality run".

```bash
export PATH="$HOME/.nvm/versions/node/v$(cat /home/nekoguntai/sanctuary-bug-scrub-20261013-i14/.nvmrc)/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i14
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i14
test "$(npm --version | cut -d. -f1)" = 12   # devEngines requires npm 12; the system ~/.local/bin npm 11 fails EBADDEVENGINES
test -d node_modules       # real install present (one gate per line: a failing non-final && command does not exit under set -e)
test ! -L node_modules     # real install; a symlink breaks arch:graphs (shared/* edges)
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"   # D-14.X1 pinned binary
BASE=d6cee837b47709f681264e6d1b47234613752b91
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
# targeted backend: A1 (node config, electrum servers, worker manager), A3 (builder, signer-limit guard, create
# API/service, import), B2 (monitoring service, routes, OpenAPI contracts)
( cd server && npx vitest run tests/unit/api/admin-nodeConfig-routes.test.ts tests/unit/services/adminElectrumServerService.test.ts \
  tests/unit/worker tests/unit/api/admin tests/unit/services/featureFlagService.test.ts )
( cd server && npx vitest run tests/unit/services/bitcoin tests/unit/services/import tests/unit/services/walletImport \
  tests/unit/services/walletImport.validation.test.ts tests/unit/services/walletImport.operations.test.ts \
  tests/unit/api/wallets.test.ts tests/unit/services/wallet.test.ts )
( cd server && npx vitest run tests/unit/services/adminMonitoringService.test.ts tests/unit/api/admin-monitoring-routes.test.ts \
  tests/unit/api/openapi.test.ts )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only; scoped as CI
# integration (real DB via the compose-backed runner; serialized host-wide): worker boot regression only (manager and
# infrastructure are mocked in both specs; no integration spec covers A1)
flock /home/nekoguntai/.i14-integration.lock npm --prefix server run test:integration:db -- tests/integration/worker/featureFlagToggle.integration.test.ts
flock /home/nekoguntai/.i14-integration.lock npm --prefix server run test:integration:db -- tests/integration/worker/worker.integration.test.ts
# --- mutation pins (re-derived on d6cee837b4) ---
# Tier 1 — CI-enforced pins with line ranges, canaries or minScores: config/wallet-safety-mutation-map.json
# path/productionFile entries; the `mutate` lists of server/stryker.{fee-policy,psbt-account-binding,receive-evidence,
# taproot-artifact-finalization,taproot-construction}.config.mjs (verify-vectors.yml:518-522,603-604); the critical
# shards (server/scripts/mutation/shards.mjs:14-63, stryker.critical.config.mjs, test.yml:1329); config/tooling/
# stryker.{psbt-account-binding,wallet-policy}.config.mjs (verify-vectors.yml:518-519). The ONLY planned change on this
# surface is A3's keyword at transactionWeight.ts:50, which moves no pinned line range or canary column (pinned at
# map :931 whole-file, :963-985 lines 155-161 canary 158:7-26, :986-1008 lines 119-121; stryker.fee-policy:8 whole-file).
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
test "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")" = server/src/services/bitcoin/transactionWeight.ts
TW_DIFF="$(git diff -U0 "$BASE" HEAD -- server/src/services/bitcoin/transactionWeight.ts)"
test "$(grep -c '^@@' <<<"$TW_DIFF")" = 1                       # one hunk ...
grep -qE '^@@ -50 \+50 @@' <<<"$TW_DIFF"                        # ... at line 50, no line inserted or removed
test "$(grep -c '^[-+][^-+]' <<<"$TW_DIFF")" = 2                # exactly one line out, one line in
grep -qxF '+export const MAX_STANDARD_MULTISIG_KEYS = 16;' <<<"$TW_DIFF"
# Tier 2 — whole-file globs in Stryker configs no CI lane runs (server/stryker.conf.mjs via `npm --prefix server run
# test:mutation`; server/stryker.config.mjs; config/tooling/stryker.config.mjs via root `test:mutation`): no line
# ranges, so nothing can move. Planned changes there: A3 descriptorBuilder.ts and B1 src/utils/derivationPathGroups.ts only.
# The new A3 leaf module services/bitcoin/multisigSignerLimit.ts is in neither the tier-1 nor the tier-2 list.
UNSCHEDULED_SURFACES=(
  server/src/services/bitcoin/descriptorBuilder.ts server/src/services/bitcoin/descriptorParser.ts
  server/src/services/scriptTypes server/src/services/authService.ts server/src/services/encryption.ts
  server/src/services/twoFactorAuth.ts server/src/services/tokenRevocation.ts server/src/services/walletService.ts
  server/src/utils/errors.ts server/src/utils/safeJson.ts src/hooks src/utils shared
)
test "$(git diff --name-only "$BASE" HEAD -- "${UNSCHEDULED_SURFACES[@]}" | tr '\n' ' ')" = \
  "server/src/services/bitcoin/descriptorBuilder.ts src/utils/derivationPathGroups.ts "
# critical-path scope: under server/src/services/bitcoin only the four planned files changed (A1 new module; A3 new
# multisigSignerLimit.ts leaf module, descriptorBuilder.ts, transactionWeight.ts); A2 was rejected at review pass 1
test "$(git diff --name-only "$BASE" HEAD -- server/src/services/bitcoin | tr '\n' ' ')" = \
  "server/src/services/bitcoin/descriptorBuilder.ts server/src/services/bitcoin/electrumConfigChanges.ts server/src/services/bitcoin/multisigSignerLimit.ts server/src/services/bitcoin/transactionWeight.ts "
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
# --- B2 removed PUT /admin/monitoring/grafana: no route, OpenAPI operation/schema, setting key or client call remains,
# and no e2e map mocks it (the four GET mocks stay valid; D-14.X5) ---
test -z "$(git grep -n -e updateGrafanaConfig -e GRAFANA_ANONYMOUS_ACCESS -e 'grafana\.anonymousAccess' -e GrafanaUpdateBody \
  -e AdminUpdateGrafanaRequest -e AdminGrafanaUpdateResponse -- server/src src shared gateway || true)"
test -z "$(git grep -n -e 'PUT /admin/monitoring/grafana' -e "put.*'/admin/monitoring/grafana'" -- tests/e2e src || true)"
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/utils/derivationPathGroups.test.ts \
  tests/utils/networkScopedDevices.test.ts tests/components/CreateWallet tests/components/ConnectDevice \
  tests/components/DeviceList tests/components/DeviceList.test.tsx tests/components/DeviceDetail \
  tests/components/Layout tests/components/Layout.test.tsx tests/components/Monitoring \
  tests/api/remainingAdminApiModules.test.ts \
  tests/components/NodeConfig tests/components/NodeConfig.test.tsx tests/components/NetworkConnectionCard \
  tests/components/NetworkConnectionCard.test.tsx
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold
# Playwright (CLAUDE.md static-build procedure; no host dev server). Known limitation: the static server cannot answer
# POST /auth/login, so the 7 known cases fail here; the exit status is recorded, not gated. Bounded and non-vacuous.
PW_DIR="$SCRATCH/i14-playwright"
grep -qF "/home/nekoguntai/sanctuary-bug-scrub-20261013-i14/config/tooling/playwright.config.ts" "$PW_DIR/playwright.static.config.mts"
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
# PNG baselines unchanged (no phase changes a baselined render; there is no /admin/monitoring baseline): nothing
# committed since BASE, and no new/modified/untracked file left by this run (Playwright's default
# updateSnapshots: 'missing' writes new baselines as untracked files)
git diff --exit-code "$BASE" HEAD -- tests/e2e/render-regression.spec.ts-snapshots
test -z "$(git status --porcelain -- tests/e2e/render-regression.spec.ts-snapshots)"
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i14-lizard.txt"   # cap 86; pinned 1.24.0, no PyPI fetch (scripts/quality.sh:209-222)
test "$(grep -c ': warning:' "$SCRATCH/i14-lizard.txt")" -le 84    # D-14.X1: no new warnings (base d6cee837b4 = 84)
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run check:bitcoin-network-boundaries
npm run arch:check                                 # pure check: graphs regenerated and committed before the block
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
npm run verify:signer-inventory
npm run check:safety-catch-guards
npm run check:wallet-sync-mutation-boundaries     # unchanged: no phase edits a sync-path file
npm run check:wallet-sync-lifecycle-contract      # A1 (electrumManager/nodeClient roles)
npm run check:openapi-route-coverage              # B2: route and OpenAPI put removed together
npm run check:api-body-validation
node scripts/ci/check-supply-chain-locks.mjs      # C2 moves where CI runs it; the gate itself is unchanged (D-14.C8)
node scripts/ci/check-negated-test-assertions.mjs
bash scripts/ci/backend-integration-groups.sh --check   # unchanged: no new integration spec
bash tests/ci/backend-integration-groups.test.sh
# install, ownership and CI suites (C)
# upgrade-helpers does not set its own project-lock root; run it only with the @runtime lock-root env
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/upgrade-helpers.test.sh
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/install-script.test.sh
bash -n tests/install/e2e/upgrade-install.test.sh
npm run test:ownership   # every tests/ownership suite incl. producer hooks, as the CI classifier lane
bash scripts/ci/run-install-unit-tests.sh          # all tests/install/unit suites; installs tests/ci/lib
bash tests/ci/ci-registration-completeness.test.sh
bash -n scripts/ci/classify-quality-scope.sh
bash tests/ci/classify-quality-scope.test.sh       # C2 real-input guard + every existing assertion
bash tests/ci/check-workflow-composition.test.sh   # C2 determine-scope step assertions (needs tests/ci/lib, installed above)
node --test tests/ci/check-supply-chain-locks.test.mjs
bash tests/ci/run-actionlint.test.sh
ACTIONLINT="${SANCTUARY_ACTIONLINT_BIN:-$(command -v actionlint || true)}"
if [ -n "$ACTIONLINT" ] && [ -x "$ACTIONLINT" ]; then SANCTUARY_ACTIONLINT_BIN="$ACTIONLINT" bash scripts/ci/run-actionlint.sh; else echo "actionlint binary absent: recorded; CI's workflow-quality lane is binding for quality.yml"; fi
bash tests/ci/classify-test-changes.test.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree
echo "verification block: all gates passed"
```

If the integration DB cannot start, the block stops at the integration lines (it runs under `set -euo pipefail`, so no later gate runs). That is a D-14.X3 stop, not a fallback: record the failure, triage it as infrastructure first (compose-backed runner, host load, the `.i14-integration.lock` holder), then re-run the whole block as written once the DB starts. Completion requires the full block to exit 0 with both integration specs executed (review pass 7, A7-1; the earlier "rely on the CI integration groups" fallback could not be carried out under `set -e`).
`/simplify` and an adversarial review before committing; commits in the foreground through
`flock /home/nekoguntai/.i14-commit.lock git commit …`; never while a coverage run is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i14` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i14`),
  one commit per finding (test + fix; seven), then the integrator commit (changelog `[Unreleased]` bullets, regenerated
  `docs/architecture/generated`).
- **Workers (D-14.X2):** phases `a`, `b`, `c` in parallel. Workers edit only owned files, run typechecks and targeted
  tests, run lizard on changed files (zero new warnings), record red runs on the plan-commit base, apply the D-14.X3
  stop rule, and commit through the flock.
- **Integrator:** cherry-picks serially with `-x` (a, b, c), never resolves a conflict by editing another phase's files
  (conflicts go back to the owner), then runs the block. Each phase branch is proven upstream with
  `git cherry codex/bug-scrub-loop/20261013-i14 <phase-branch>` (every line `-`), deleted with `git branch -D`, and its
  worktree removed by path.
- **B2 endpoint removal check (before pushing).** `PUT /admin/monitoring/grafana` is removed from the route
  (`server/src/api/admin/monitoring.ts`), the OpenAPI path and schemas (`paths/admin/operations.ts`,
  `schemas/admin/ops-monitoring-node.ts`) and the client (`src/api/admin/monitoring.ts`, `index.ts`). Checked at
  `d6cee837b4`: every e2e mock map mocks only `GET /admin/monitoring/grafana` (`adminOperationsApiState.ts:175`,
  `userJourneyApi.ts:444`, `admin-drafts-smoke.spec.ts:159`, `render-regression/renderRegressionHarness.ts:639`), no
  `tests/e2e` file mocks or triggers the PUT, the gateway whitelist does not carry it, and no generated OpenAPI artifact
  or `docs/reference` page names it. So no mock map changes and the thirteen `unhandledRequests` sites stay valid. The
  block enforces it (`git grep` checks, `openapi.test.ts`, `check:openapi-route-coverage`, `check:api-body-validation`,
  the static Playwright run).
- **C1 manual extended-fixture dispatch (before merge).** Dispatch `install-test.yml` on the PR branch with
  `test_suite=upgrade`, `upgrade_fixture=all` and `upgrade_source_ref=latest-stable` (`classify-install-scope.sh:170-174`;
  review pass 4, C-11; it starts Upgrade Baseline `install-test.yml:868`, Upgrade Extended Fixtures `:1026` with all
  five fixtures in one job that continues after a failed fixture, the informational owned-source canary `:1168` that
  always exits 0 and only warns, and the Upgrade Extended aggregate `:1311`; review pass 5, C-13)
  (`install-test.yml:144-171`; `POST $API/actions/workflows/install-test.yml/dispatches` with payload
  `{"ref":"codex/bug-scrub-loop/20261013-i14","inputs":{"test_suite":"upgrade","upgrade_fixture":"all","upgrade_source_ref":"latest-stable"}}`;
  the n-2 baseline is intentionally not re-run, C-2). Record the run ID, job IDs, head SHA and runner `Name:` lines in
  the PR body, with any canary `::warning`. It is green when Upgrade Baseline, Upgrade Extended Fixtures and Upgrade
  Extended succeed. It is evidence, not a required gate. Before routing a `failure`, triage infrastructure causes
  first (review pass 5, C-14): the fixture and job logs (`upgrade-extended-fixtures`,
  `diag-upgrade-extended-fixtures-<run_id>`), the diagnostic summary (`scripts/ci/write-diagnostic-summary.sh`) and
  the `Name:` host's runner snapshots, for a runner-lock timeout (`waiting for runner lock`), a DIND/Podman stall, a
  budget overrun or host-specific builder divergence. An infrastructure failure is re-dispatched under CLAUDE.md's
  four-part retrigger evidence (immutable SHA plus run/job IDs, failure signature, new hypothesis, cheap
  discriminator), with both run IDs recorded; it is not a product finding and not a stop. A failed fixtures job with no
  per-fixture `CI timing` line points at infrastructure. Otherwise, attributing by the `Extended upgrade fixture
  failed: <fixture>` line in `upgrade-extended-fixtures.log` inside the `diag-upgrade-extended-fixtures-<run_id>`
  artifact (fallback: the live `::error title=CI timing::upgrade extended <ref> <fixture> … with exit code N` line;
  review pass 6, C-15), a legacy-runtime-env `failure` is a product finding (C-Q1), and a `failure` in any other
  fixture, in the dispatch's Upgrade Baseline, or of the fixtures job with no attributable fixture line is a C1 harness
  regression or unrouted failure and a D-14.X3 stop; either stops the merge until the coordinator decides. A dispatch run cannot satisfy the required install gates. **Staleness rule (review
  pass 1, C-1):** before merge, the dispatch stays valid only if
  `git diff --quiet <dispatched_sha> <final_head> -- tests/install install.sh start.sh scripts .github/workflows .github/actions docker docker-compose*.yml ':(glob)**/Dockerfile'`
  succeeds (a `block_on_outdated_branch` rebase or a later fix push changes the head). The list is the release surface
  (`classify-install-scope.sh:407-411`) plus all of `scripts/`, so the lane's own workflow and CI wrappers, the
  installer-invoked helpers (`scripts/create-upgrade-backup.sh`, `scripts/ops/…`, `scripts/reconcile-postgres-password.sh`)
  and the compose/Dockerfile inputs are covered (review pass 2, C-8). Otherwise re-dispatch on the final head and
  record both run IDs. **Concurrency (review pass 3, C-9):** the dispatch joins `install-test.yml`'s global concurrency
  group `sanctuary-runner-e2e-workflow` (`:176-192`, `cancel-in-progress: false`), shared with the nightly schedule
  (`17 10 * * *`, `:140-141`); the group keeps one pending run, so a pending dispatch and a pending nightly run cancel
  one another. Before dispatching, confirm through `$API/actions/runs?status=…` that no `install-test.yml` schedule or
  dispatch run is queued or running. Identify group members by workflow `install-test.yml` and `trigger_event`
  `schedule` or `workflow_dispatch`. Scheduled runs report `event=push`, so never filter on `?event=schedule` (always
  empty on this Forgejo) and never dismiss an `event=push` run as a tag run without checking its `trigger_event`
  (review pass 4, C-12). A `cancelled` conclusion caused by that concurrency displacement is re-dispatched,
  not C-Q1; record both run IDs. Only a non-infrastructure legacy-runtime-env `failure` of a job that ran is a C-Q1
  product finding; a non-infrastructure `failure` in any other fixture, in the dispatch's Upgrade Baseline, or of the
  fixtures job with no attributable fixture line is a D-14.X3 stop.
- **Merge:** squash through protected `main`; no admin bypass; merges are serial and no other open PR is rebased; poll
  required contexts via `/commits/<sha>/statuses` (the combined status can say success while a required context is
  still pending). Expected lanes: verify-vectors (A touches `server/src/services/bitcoin/**`, `services/wallet/**`,
  `services/import/**`; B1 touches `src/components/CreateWallet/**`), backend unit + integration groups, frontend unit +
  render/browser e2e, Install Script Unit Tests and the PR-bounded Upgrade Baseline (latest-stable; C1 edits the
  upgrade harness), Install Stack Smoke (release-surface PR smoke, `enable_pr_release_surface_smoke`,
  `tests/install/utils/classify-install-scope.sh:426-437`), Release Candidate Validation (`release-candidate.yml:34-40`
  pull_request paths `scripts/ci/**`, `tests/install/**`, `.github/workflows/**`; its install unit step runs C1 tests
  1–10) (review pass 1, C-4), CI classifier tests (C2 edits `quality.yml`, the classifier and `tests/ci/*`) with the new
  `determine-scope` "Check supply-chain locks" step on the PR head, and the Jade emulator proof (`quality.yml` is in
  `config/hardware-emulator-source-inventory.json:84`). A missing expected lane is investigated, not assumed skipped.
  **C2 evidence (review pass 3, C-10):** the PR head's `Determine Quality Scope` job is green and its log shows the
  `Check supply-chain locks` step completing successfully. The gate's own output is log-file-only
  (`run-with-log.sh:224-228`), and the diagnostics artifact uploads only on failure (`quality.yml:111-119`), so the
  step's success is the evidence, not `supply-chain-locks.log` content. Record the run ID and job ID. **C1 evidence:** the Upgrade Baseline job is green.
  That alone proves the line was present, because D-14.C4's `assert_install_output_was_upgrade` fails the lane without
  it. The line itself is in the `diag-upgrade-baseline-<run_id>` artifact, file `upgrade-baseline-latest-stable.log`
  (installer output is log-file-only, `run-with-log.sh:224-228`; the job-log API never shows it on a green run, review
  pass 2, C-7). Record the run ID, job ID, runner `Name:` and, when the artifact can be downloaded, the line in the PR
  body.
- **Retriggers:** any second expensive attempt carries the CLAUDE.md four-part evidence (40-character SHA plus run/job
  IDs, redacted failure signature, new hypothesis, cheap discriminator and its result); a `chore: retrigger CI` commit
  carries the fix or that evidence. Never push while an obsolete revision still owns runner resources.
- **After merge:** verify the reported `merge_commit_sha` (not the head SHA) is an ancestor of `origin/main`
  (`git cat-file -e` + `git merge-base --is-ancestor`) before deleting the branch; never pass
  `delete_branch_after_merge`. Verify target-branch CI on the merge commit.
- **PR-body flags:** A1 cross-process `system:electrumConfig.changed` event, publish-after-commit best effort, worker
  reset and owner-only subscription reconnect, accepted at-most-once (OQ-A1), and the new reviewed
  `scripts/quality/safety-catch-allowlist.json` entry for `publishElectrumConfigChange`'s best-effort publish catch
  with its rationale (D-14.21: a reviewed exception, not a module move or `.catch()` swap; owner `fund-safety`,
  removal slice `intentional-post-commit-notification-boundary`); A2 rejected at review pass 1 (the un-awaited recursive `return syncWallet(...)`
  already propagates failures; not in this PR); A3 cap of 16 at create/import/builder boundaries through the new
  `multisigSignerLimit.ts` leaf module only, runtime parsers untouched, existing >16 wallets unchanged (OQ-A3), `transactionWeight.ts:50` keyword-only with
  no pinned line moved; B1 client-side read normalization only, storage unchanged, identical-xpub notation pairs
  collapsed and differing-xpub pairs fail closed in Create Wallet (OQ-B1 decided no; P3 follow-up named); B2 read-only probe-based status of the bundled Grafana container (custom-URL limitation stated),
  `PUT /admin/monitoring/grafana` removed with the e2e/OpenAPI check result;
  B3 one combined preset patch; C1 secrets scrubbed, `SANCTUARY_ENV_FILE` only for custom locations, legacy fixture
  reaches the repo-root fallback, file-based secret comparison, the dispatch run ID(s) and the C-1 staleness check; C2 always-on supply-chain step and
  ten routed exact paths; "no migration, no new endpoint, no e2e mock-map change, no version bump"; the P3 backlog and
  follow-ups stay outside this PR.
- **Rollback:** every phase is code/CI/test-only. No schema, migration or stored-shape change; B2 leaves any stale
  `grafana.anonymousAccess` row unread. Reverting A1 returns workers to picking up config on restart; reverting A3 re-admits >16-signer imports; reverting C1/C2 is harness/CI-only.
- **Deployment:** none until clean closeout (`--deploy final`); the local stack is rebuilt only after the loop closes.

## Completion criteria

- [ ] Every failing-first test in Phases A–C fails on `d6cee837b4` code for the reason its phase states (red runs
  recorded per phase) and passes on the PR head; honest-path guards stay green; no unresolved D-14.X3 stop.
- [ ] Verification block run as written on the integrated branch with exit status 0 recorded, including the lizard
  gate (≤ 84), the tier-1/tier-2 mutation-pin allow-lists and the `transactionWeight.ts:50` single-line check; the two
  integration worker specs executed through the flock'd `test:integration:db` (worker boot regression only: both mock
  the manager and infrastructure, so they do not cover A1; review pass 1, A-6).
- [ ] Playwright static run recorded (exit status, ≥ 380 executed, only the 7 known auth/login failures, baselines
  unchanged); CI's browser lane is binding.
- [ ] B2 endpoint-removal check recorded (OpenAPI, route coverage, every e2e mock map).
- [ ] C1 all-extended-fixtures dispatch run (`upgrade_fixture=all`, `upgrade_source_ref=latest-stable`) green before merge on a SHA whose C1-relevant paths (`tests/install`,
  `install.sh`, `start.sh`, `scripts`, `.github/workflows`, `.github/actions`, `docker`, `docker-compose*.yml`,
  `':(glob)**/Dockerfile'`) equal the merged head's (`git diff --quiet` rule under Delivery; otherwise re-dispatched
  and both run IDs recorded); green means its Upgrade Baseline, Upgrade Extended Fixtures and Upgrade Extended jobs
  succeeded, with any owned-source canary `::warning` recorded; or, after infrastructure triage (an infrastructure
  failure re-dispatched under the four-part retrigger evidence with both run IDs recorded, not routed), C-Q1
  (legacy-runtime-env `failure`, attributed by its `Extended upgrade fixture failed:` line in the
  `diag-upgrade-extended-fixtures-<run_id>` log, or the live `CI timing` error line as fallback) or a D-14.X3 stop (any
  other fixture's `failure`, the dispatch's Upgrade Baseline, or a fixtures-job failure with no attributable fixture
  line) handled and recorded; checked before dispatch, by `trigger_event` `schedule`/`workflow_dispatch` (never
  `?event=schedule`), that no `install-test.yml` schedule or dispatch run was queued or running; a
  concurrency-`cancelled` dispatch re-dispatched with both run IDs recorded (only a legacy-runtime-env `failure`
  conclusion is C-Q1); Upgrade Baseline green; evidence line recorded from the
  diag artifact when retrievable.
- [ ] C2 evidence recorded: the PR head's green `Determine Quality Scope` job with its successful
  `Check supply-chain locks` step (run ID and job ID; not `supply-chain-locks.log` content, which a green run never
  exposes).
- [ ] PR merged; target-branch CI green on its merge commit; ancestry of `merge_commit_sha` verified; branches and
  worktrees cleaned (`git cherry` proof per phase branch).
- [ ] PR body carries every flag listed under Delivery.
- [ ] Run state updated: seven findings resolved; `sync-wallet--recursive-gap-sync-failure-swallowed` stays rejected
  (review pass 1); the decided open questions and the P3 follow-ups
  (`worker-electrum--periodic-config-recheck`, `multisig-signer-cap--existing-over-16-wallets-unsupported-policy`,
  `device-paths--h-notation-stored-unnormalized-and-dedupe`, `ci-classifier--real-checkout-reads-unrouted`,
  `sync-wallet--recursive-pass-progress-stage-closed-early`, `backup-restore--node-config-change-not-propagated`,
  `device-cells--h-notation-legacy-multisig-badge`) recorded,
  and the Grafana-password observation recorded as a candidate for the next scrub.
- [ ] P3 backlog remains outside the blocking fix set.

## Review log

- Draft assembled 2026-10-21 from plan14-A/B/C (source d6cee837b4).
- Coordinator decisions applied at assembly: OQ-A1 accept; OQ-A3 unchanged; OQ-B1 **no** (B1 narrowed to client-side
  read normalization; D-14.B1b/c withdrawn to the P3 follow-up); OQ-B2 read-only probe; C-Q1 product finding; C-Q2 P3;
  C-Q3 always-on step; phase `c` ships in the single PR (drafter's two-PR recommendation not taken).
- Pass 1 (2026-10-21): 24 comments (A 8, B 10, C 6) — all accepted and applied; A-1 rejected finding sync-wallet--recursive-gap-sync-failure-swallowed (return without await propagates; green on base) — A2 removed, 7 × P2 remain; reviewers ran every planned red on a scratch copy and the green after the fix; rejected comments: none.
- Pass 2 (2026-10-21): 7 comments (A 2, B 3, C 2; A2-1 blocking) — all accepted and applied (typed harness mock for typecheck:tests; single-sig control fixture; B3 assertion order and rerender props + typecheck:tests; B1 h/H dedupe branch test; C1 evidence from the diag artifact; widened dispatch staleness paths); rejected: none.
- Pass 3 (2026-10-21): 4 comments (A 1, B 1, C 2; none blocking) — all accepted and applied (node_modules gate split into one gate per line; B1 test 2 uses testnet4 for typecheck:tests; C1 dispatch concurrency-cancel rule; C2 evidence from the green Check supply-chain locks step); rejected: none. Phase B full change set prototyped: every red observed on base, all typechecks and suites green after, 247 static Playwright tests passed.
- Pass 4 (2026-10-21): 3 comments (A 1 blocking, C 2) — all accepted; A4-1 applied as a reviewed safety-catch allowlist entry (coordinator chose this over moving the module out of the scanned tree); C-11 dispatch runs all extended fixtures; C-12 trigger_event filter; rejected: none.
- Pass 5 (2026-10-21): 3 comments (A 1, C 2; none blocking) — all accepted and applied (D-14.21 removal slice renamed to intentional-post-commit-notification-boundary, permanent by design; dispatch job set, green definition and per-fixture attribution; infrastructure triage before routing a dispatch failure); rejected: none. D-14.21 prototyped: safety-catch-guards passes with the entry (72 allowed groups, 0 new, 0 stale).
- Pass 6 (2026-10-21): A 0, B 0, C 1 — C-15 accepted and applied (fixture attribution from the diag artifact log with the live CI timing line as fallback; unattributable fixtures-job failures → infrastructure triage, then D-14.X3 stop); rejected: none.
- Pass 7 (2026-10-21): A 1, B 0, C 0 — A7-1 accepted and applied by the coordinator (integration-DB start failure is a D-14.X3 stop with a full re-run; the carried-over fallback was not executable under set -e); rejected: none.
- Pass 8 (2026-10-21): A 1, B 0, C 1 (same defect) — the pass-7 paragraph required "all three" integration specs where the block runs two; corrected to "both" by the coordinator; rejected: none.
- Pass 9 (2026-10-21): full-plan pass, **clean — review converged.** Three non-actionable wording slips noted (electrumManager.test.ts registration needs an import plus a call; A1 prototype count; "test commit" vs the one-commit-per-finding rule D-14.X2, which governs).
