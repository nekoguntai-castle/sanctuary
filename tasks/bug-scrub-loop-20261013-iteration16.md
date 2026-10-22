# Bug-scrub loop 20261013 — iteration 16 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 16
- **Source SHA:** `39831497382d1f77f90eab7383839c5373ae1a4c` (`main`, after #1416)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (6 × P2):** A1 `draft-create--display-fields-and-locks-not-bound-to-intent` (recurrence), A2
  `draft-delete--broadcasted-draft-deletable-resets-agent-funding-cap`, A3
  `agent-funding--draft-outputs-fail-strict-schema` (new, found while planning A1), B1
  `ai-transaction-filter--aggregates-include-rbf-replaced-rows`, C1
  `ci-diagnostics--breadcrumb-labels-step-timeout-as-post-verification-fault` (recurrence), C2
  `cleanup-receipt--failed-first-action-terminal-state-mismatch-deadlocks`. Every finding was re-verified from source
  at `39831497382d` (file:line in the phase sections), and every fix and red test was prototyped on a scratch copy of
  that tree (the phase sections say which reds were observed and which are predicted).
- The other **22 P3s** are backlog in run state and are **outside this fix set** (listed by id under Open
  questions): 19 from this 25-finding scrub (24 scrub findings plus A3) and 3 found in plan review (A1's
  unbound `feeRate`, A1's unbound consolidation amount, A3's mobile decoy display).
- **Scratchpad** (`scratchpad/…` in the phase sections, `$SCRATCH` in the Verification block):
  `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`. The prototype diffs
  are referenced there, not inlined: `i16-a1.patch`, `i16-a2.patch`, `i16-a3.patch`, `i16-a-draftServiceTest.patch`
  (Phase A), `p16b/prod.diff` (Phase B), `plan16-C1-prototype.patch`, `plan16-C2-prototype.patch` (Phase C). A
  prototype is guidance; the phase text below governs where they differ.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `draft-create--display-fields-and-locks-not-bound-to-intent` (recurrence of the iteration-9 fix #1406) | P2 |
| A2 | `draft-delete--broadcasted-draft-deletable-resets-agent-funding-cap` | P2 |
| A3 | `agent-funding--draft-outputs-fail-strict-schema` (new; coordinator-accepted, OQ-A1) | P2 |
| B1 | `ai-transaction-filter--aggregates-include-rbf-replaced-rows` (defence in depth, OQ-B1) | P2 |
| C1 | `ci-diagnostics--breadcrumb-labels-step-timeout-as-post-verification-fault` (recurrence of the iteration-12 fix `20361d62b`) | P2 |
| C2 | `cleanup-receipt--failed-first-action-terminal-state-mismatch-deadlocks` | P2 |

## Open questions

All open questions raised by the section drafters are **DECIDED by the coordinator**. The phase sections below carry
the decisions; where a drafted section recommended otherwise, it is amended in place and marked *(coordinator, at
assembly)*. One decision (OQ-A2) changes product-visible semantics; it is recorded as a coordinator decision that the
user may revisit, and the docs line and changelog state it plainly.

- **OQ-A1 — the agent output-metadata repair: DECIDED, its own finding A3 (P2).** The agent funding payload has failed
  the strict draft request schema since `a02748784` (2026-06-04), so no agent funding draft can be created at base.
  It is a separate commit, A3, after A2 (D-16.A3b).
- **OQ-A2 — what the agent daily/weekly caps count: DECIDED (coordinator decision; the user may revisit).** The caps
  count **every accepted funding request in the window**, including requests whose drafts are later rejected,
  expired, invalidated or deleted. The existing one-time owner override is the release valve for refills. Rationale:
  - rejection is not a safe exemption: broadcast needs no draft (`server/src/api/transactions/broadcasting.ts:67-72`,
    `:79-88`), and the agent's linked user may be an eligible approver;
  - the backlog finding `agent-funding-caps--invalidated-or-expired-drafts-uncounted` already treats expired drafts as
    counting;
  - a spending limit fails closed.

  A2 therefore **also resolves** backlog P3 `agent-funding-caps--invalidated-or-expired-drafts-uncounted` (record it as
  resolved by A2). The one-sentence docs line in `docs/how-to/agent-wallet-funding.md` (D-16.A2b) and the A2 changelog
  bullet state the semantics plainly. *(coordinator, at assembly)* The backlog P3
  `agent-funding-caps--rejected-drafts-counted` ("Rejected agent drafts still consume daily/weekly cap until deleted")
  describes behaviour OQ-A2 now makes intended (they count, and deleting no longer frees them); the coordinator
  records its disposition in run state (by-design under OQ-A2) when A2 merges.
- **OQ-B1 — B1 severity: DECIDED, stays P2** (run state never downgrades a confirmed severity) and ships as **defence
  in depth**. The plan records that the trigger is **not reachable with current server data**: the list route filters
  `rbfStatus: { not: "replaced" }` (`server/src/api/transactions/walletTransactions/listTransactions.ts:63`) and the
  repository forces it again through `withLiveTransactionWhere`
  (`server/src/repositories/transactions/core.ts:523`, `:543`); the client never writes `rbfStatus` locally.
- **C-Q1 — keep a positive "this was the runner" verdict in the breadcrumb: DECIDED, no.** Losing the #1009
  runner-fault verdict is accepted. Restoring it needs a per-job verification-complete marker in the
  provenance-pinned `verify-vectors.yml`; recorded as P3 follow-up
  `ci-diagnostics--breadcrumb-no-verification-complete-marker`.
- **C-Q2 — check operator hosts for an already-stranded cleanup pointer: DECIDED, no production host check from the
  loop** (outside the loop's authority). **Operator note** (carried into the PR body and the changelog): after this
  fix, the existing `cleanup-cli.mjs recover` command completes an already-stuck active-cleanup pointer (D-16.C2d);
  the symptom on a host is an upgrade refused with `deployment mutation is refused while cleanup state is active`.
- **C-Q3 — divergence 2's state: DECIDED, keep `cancelled`** for a cancelled mutation with an ambiguous
  reconciliation (no signed-journal rule change; both `cancelled` and `ambiguous` map to coordinator exit 4).

**P3 follow-ups recorded in run state by this plan (outside this fix set):**
- `ci-diagnostics--breadcrumb-no-verification-complete-marker` (C-Q1);
- `ai-transaction-filter--aggregation-runs-on-non-transaction-result-types` (D-16.B1c; latent: the hook still
  aggregates over the unfiltered input when `type !== 'transactions'`, which `llm-egress-proxy/src/naturalQuery.ts`
  never emits today).
- *(coordinator, at assembly)* The drafted P3 `ai-filter-summary--partial-label-ignores-known-total` duplicates the
  existing backlog P3 `ai-filter-summary--partial-label-on-exact-page-multiple`; no new id is recorded.

**P3s deferred (22: 19 from this iteration's scrub plus 3 from plan review, marked †; backlog, outside the
blocking fix set):**
`assistant-tools--row-budgets-not-enforced-balance-history-drafts`, `audit-logs--filter-omits-mcp-and-console-categories`,
`ci-diagnostics--parallel-suite-logs-dumped-as-failed`, `confirmation-sweep--candidate-threshold-6-vs-deep-threshold`,
`docker-build--ownership-and-wrapper-triggers-select-no-image`, `docker-proxy--create-and-post-open-to-every-network-peer`,
`draft-create--consolidation-amount-not-bound-to-intent-output`† (D-16.A1h (5)), `draft-create--fee-rate-display-not-bound-to-intent`† (D-16.A1h (4)), `draft-list--delete-offered-to-non-creator-signers`, `feature-flags--concurrent-startup-ensuredefaults-serialization-failure`,
`gateway-security-events--unauthenticated-audit-row-amplification`, `install-upgrade-e2e--failed-install-retry-reports-success`,
`mobile-agent-review--decoy-outputs-not-shown`† (D-16.A3a),
`openapi-admin-agents--create-nullable-and-threshold-bounds-drift`, `openapi-support-package--v2-schema-stale-vs-generator`,
`openapi-wallet-webhooks--filters-and-threshold-cap-undocumented`,
`ownership-image-registration--empty-lane-listing-fails-no-image-contract`,
`price-reload--inflight-fetch-repopulates-cache-after-provider-disable`, `psbt-broadcast--draft-bound-intent-refused-as-locked`,
`send-flow--fiat-follows-sidebar-network-not-wallet-network`, `usb-signing--bitbox-skips-signing-context-binding`,
`websocket-upgrade--unauthenticated-sockets-fill-global-cap`.

## Goal and non-goals

**Goal:** fix every blocking finding (6 × P2), each with a non-regression test that fails on `39831497382d` and
passes after the fix, delivered in one protected PR with green CI.

**Non-goals:** the P3 backlog and follow-ups (above); production data repair (drafts created before A1 keep what they
stored; no draft or attempt row is rewritten; operator hosts are not inspected, C-Q2); new Prisma migrations or
`schema.prisma` edits (RC10 migration-tree digest); new API endpoints, request/response fields or query parameters (A2
adds a `409` to the existing draft `DELETE`; no e2e mock-map entry is added or removed: the thirteen
`unhandledRequests` sites found by grepping `transactions/balance-history` stay untouched); any edit to a
provenance-pinned verify-vectors input (`scripts/verify-addresses/sourceManifest.ts` `VERIFIER_SOURCE_FILES`,
including `.github/workflows/verify-vectors.yml`); any edit to `server/src/services/bitcoin/**`,
`server/src/api/transactions/broadcasting.ts` or `server/src/api/drafts.ts` (critical-mutation files); a positive
verification-complete marker (C-Q1); lowering `LIZARD_WARNING_BASELINE`; regenerating any PNG baseline; a version
bump; branch-protection changes.

## Decisions

Decision ids are kept from the section drafts and are unique across the plan: **D-16.A1a–D-16.A3b** (Phase A),
**D-16.B1a–D-16.B1c** (Phase B), **D-16.C1a–D-16.C2e** (Phase C), and the cross-cutting **D-16.X1–D-16.X8** below.

### Cross-cutting decisions

- **D-16.X1 worker model and worktrees.** Phases `a` (A1, A2, A3), `b` (B1) and `c` (C1, C2) each get a worktree
  `/home/nekoguntai/sanctuary-bug-scrub-20261013-i16-<phase>` (never `/tmp`: long-lived worktrees there vanished
  mid-run) on branch `codex/bug-scrub-loop/20261013-i16-<phase>`, cut from the final reviewed plan commit (the
  integrator records its SHA; it differs from `39831497382d` only under `tasks/`). File ownership is disjoint at this
  granularity (table below). Setup: root `npm ci` (a real install, never a symlinked `node_modules`; ~810 entries),
  `cd server && npx prisma generate`, `npm run build --workspace=shared`, nvm node on `PATH`
  (`export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`; `.nvmrc` is `24.21.0`; the system `~/.local/bin` npm 11
  trips `devEngines` with EBADDEVENGINES). **One commit per finding (test + fix), in phase order** (a: A1, A2, A3; b:
  B1; c: C1, C2). Every commit runs in the foreground through `flock /home/nekoguntai/.i16-commit.lock git commit …`,
  never while a coverage or Stryker run is active (the pre-commit hook tests flake under coverage load); no
  `git stash` (refs/stash is shared by all worktrees). New files are `git add`ed before
  `node scripts/ownership/check-lifecycle-callsites.mjs` (it skips untracked files). Workers run only their phase's
  typechecks, targeted tests and per-file lizard, and record each red run on the plan-commit base as
  `$SCRATCH/i16-<phase>-red*.txt` (green as `-green*.txt`). Workers never run coverage, integration specs, Playwright
  or `arch:graphs`.
- **D-16.X2 integrator.** The integrator works in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i16` on branch
  `codex/bug-scrub-loop/20261013-i16` (a real root `npm ci`, `prisma generate`, shared build). It cherry-picks the
  phase branches serially with `-x` (a, b, c), never resolves a conflict by editing another phase's file (conflicts go
  back to the owner), owns `docs/reference/changelog.md` (`## [Unreleased]`, bullets handed over by the phases) and
  `docs/architecture/generated/*`, and alone runs: backend and frontend coverage (behind the bounded guard), the
  **full** backend integration suite with Redis, the A2 integration reds on a guarded base swap, the static
  Playwright run and the graph regeneration. It writes the Verification block to `$SCRATCH/i16-verify.sh` and runs
  `bash "$SCRATCH/i16-verify.sh"` (never `bash -c`: the `pgrep -f` guard would match the integrator's own shell).
- **D-16.X3 hold, stop and accepted-red rules.** **No phase is holdable** except as a unit: A2 and A3 must ship in the
  same PR (A3 without A2 reopens the cap reset for every new agent draft), and A3 is committed after A2. **Red-test
  stop rule:** if a failing-first test does not fail on the plan-commit base, or fails for a different reason than
  its phase states (a collection error, an unmocked-import `TypeError`, a different assertion, a fixture/control
  failure) and that reason is not on the accepted list below, the worker **stops** and the coordinator re-assesses
  before anything is cherry-picked. The same applies when the fix breaks an existing test the phase does not list,
  when a planned "green on base" guard is red (A1 accept rows and the `draftService.test.ts` fixture edits; A2
  capDurability guard; B1 case 3; the existing tests each phase says stay green), when the static Playwright run has
  a failure beyond the 7 known auth/login cases or leaves a PNG baseline changed or added, when the full integration
  suite has a failure, and when the integration database or the throwaway Redis cannot start (the Verification block
  stops there; see the integration rule). A stop is recorded in the implementation log with the observed output.
  **Accepted reds (pre-cleared; any other red reason for the same test is still a stop).** Match on the failing
  assertion line and its diff, not on the printed headline.
  - A1 `draftCreate.test.ts`: the 20 new reject cases (17 `it.each` rows + 3 `it`s), each `AssertionError: promise
    resolved "{ id: 'draft-789', …(2) }" instead of rejecting` at the `.rejects.toMatchObject` line of
    `expectMismatch` (observed; file `Tests 20 failed | 58 passed (78)`). Any accept row red on base is a stop.
  - A2 `agentFundingPolicy.capDurability.test.ts` "refuses the next request in the window after the funding draft was
    deleted": `AssertionError: promise resolved "{ overrideId: null }" instead of rejecting` (observed); its guard is
    green on base. `agentRepository.test.ts`: `TypeError: agentRepository.sumAcceptedFundingAmountsSince is not a
    function` (observed). `agentFundingPolicy.test.ts`: exactly the 7 cases failing with
    `agentRepository.sumAgentDraftAmountsSince is not a function` (observed rename red). `draftService.delete.contracts.ts`:
    the creator/owner cases `expected "vi.fn()" to be called with arguments: [ 'draft-789', 'wallet-456' ]` and the
    three 409 cases `promise resolved "undefined" instead of rejecting` (observed); `draftRepository.test.ts`:
    `TypeError: removeActionable is not a function` (observed). Integration (recorded by the integrator on the
    guarded base swap, Verification): the rewritten `agentRepository.sumDraftAmounts.test.ts` fails with a
    `… is not a function` `TypeError`, and the new `signingIntentDraftLifetime` case fails with `promise resolved
    "undefined" instead of rejecting` (both predicted).
  - A3 `agentApiService.test.ts`: exactly 2 failures — the new case `AssertionError: expected false to be true //
    Object.is equality` and the edited case `AssertionError: expected "vi.fn()" to be called with arguments: [
    'funding-wallet', 'user-1', …(2) ]` (observed; `Tests 2 failed | 14 passed (16)`).
  - B1: cases 1, 2, 4 and 5 (observed; `4 failed`): `expected [ 'txid-2', 'txid-2-original' ] to deeply equal [
    'txid-2' ]`; `expected [ 'txid-2-original', 'txid-3' ] to deeply equal [ 'txid-3', 'txid-1' ]`;
    `TestingLibraryElementError: Unable to find an element with the text: Showing 1 of 2 transactions`; the partial
    notice holding "3" instead of "2".
  - C1: `write-empty-diagnostic-breadcrumb.test.sh` `Total: 15, Passed: 6, Failed: 9` (cases 3, 8, 9, 10; observed);
    `psbt-core-subject.test.mjs` `pass 8, fail 4` (the two "setup runs as its own step log" cases `Expected values to
    be strictly equal`; the failed-attestation case and the edited foreign-ID case `ENOENT …
    diagnostics/psbt-core-setup-live.log`; observed); the D-16.C1c composition block (needle absent; observed).
  - C2: `node --test tests/ownership/cleanup-terminal-state.test.mjs tests/ownership/cleanup-execution-receipt.test.mjs`
    `pass 8, fail 7` (cases 1–4 `Error: receipt state is inconsistent with results, refusals, and postconditions`;
    case 5 `ERR_MODULE_NOT_FOUND … cleanup-terminal-state.mjs`; case 6 `AssertionError … cleanup-execution.mjs`; the
    edited privacy case `… did not match /private material/ … receipt state is inconsistent …`; observed).

  **Integration rule:** if the integration database or the throwaway Redis cannot start, the block stops at the
  integration lines (it runs under `set -euo pipefail`). That is a D-16.X3 stop, not a fallback: record it, triage
  infrastructure first (compose-backed runner, host load, the `.i16-integration.lock` holder, a stale Redis
  container), then **re-run the whole block** as written once both start. Completion requires the full block to exit
  0 with the full integration suite executed and every Redis-gated spec run (not skipped).
- **D-16.X4 lizard ceiling 83.** Pinned lizard 1.24.0 (`/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard`)
  with the repo arguments (`scripts/quality.sh` `run_lizard`, `:280-311`: `-w -i "$LIZARD_WARNING_BASELINE" -l
  javascript -l typescript -l tsx -C 15 -T nloc=200` plus nineteen `-x` excludes; `LIZARD_WARNING_BASELINE` is 86 in
  `scripts/quality.sh:21` and `.github/workflows/quality.yml:52`, unchanged). **Base count re-measured at assembly on
  `39831497382d`: 83** (from the i16 worktree root, which has no `node_modules`; rc 0; output
  `$SCRATCH/i16-lizard-base.txt`). No phase is expected to change it (Phase C measured 83 on base and patched copies
  with no diff in the warning list; Phases A and B add no warning). The Verification block gates
  `grep -c ': warning:'` at **≤ 83**. If the integrator's re-measured base differs from 83, the integrator records it
  as `$SCRATCH/i16-lizard-base-integrator.txt` (same binary and arguments, from a `git worktree` of `39831497382d` with
  no `node_modules`), edits the `-le 83` literal to that base, and records the change in the implementation log.
  Every worker runs pinned lizard `-C 15 -T nloc=200` on its new/changed `.ts/.tsx/.js/.mjs` files and reports zero
  new warnings. New helpers are top-level `function`/`const` declarations, CCN ≤ 15, NLOC ≤ 200; do not hoist a
  nested `function` out of a `describe` without re-measuring (lizard nested-function anchor). Known warnings in
  planned files (measured on base): `validateJournal` (`scripts/ownership/cleanup-execution-receipt.mjs:101`, CCN 27,
  NLOC 66) is one of the 83 and is not edited by C2 (its line moves to about `:104`); no other base warning sits in a
  planned file.
- **D-16.X5 coverage.** Backend unit coverage is 100% and CI's shards pass `tests/unit` as a positional filter, so the
  integrator runs `( cd server && npx vitest run --coverage tests/unit )` (never a bare `--coverage`, which also runs
  integration tests and reports a falsely high number). Frontend coverage is 100%
  (`npx vitest run --config config/tooling/vitest.config.ts --coverage`). Both run only behind the bounded guard on
  `[n]ode_modules/.bin/vitest run.*--coverage` (and Stryker), one coverage run at a time on this 61 GB host. Each
  phase's coverage paragraph is the integrator's checklist. `scripts/ownership/**` and `scripts/ci/**` are not in
  either coverage include; their proof is the node/bash suites.
- **D-16.X6 cross-phase couplings.** File ownership is disjoint (table below); the remaining couplings are shared
  gates only:
  1. **verify-vectors runs once on this PR.** A2 edits `server/src/repositories/**` (`config/wallet-safety-critical-paths.json:52`),
     A3 edits `server/src/services/agentApiService.ts` (`:50`), B1 edits `src/components/WalletDetail/**` (`:107`),
     and any non-documentation path runs the workflow anyway (`scripts/ci/classify-verify-vectors-scope.sh:140-147`).
     C1's PSBT subject change is exercised by that run's live PSBT step (D-16.C1b). **No phase edits a
     `scripts/verify-addresses/sourceManifest.ts` `VERIFIER_SOURCE_FILES` entry** (including
     `.github/workflows/verify-vectors.yml` and `scripts/ci/docker-endpoint-lib.sh`), so no vector is regenerated
     (D-16.C1e; Verification block provenance check).
  2. No phase edits a tier-1 mutation pin (`config/wallet-safety-mutation-map.json`, a `server/stryker*.mjs` /
     `config/tooling/stryker*.mjs` `mutate` list, `server/scripts/mutation/**`), a Tier-2 whole-file Stryker glob, a
     file under `server/src/services/bitcoin/**`, `config/wallet-sync-*.json`, the replay driver
     (`scripts/perf/wallet-sync-persistence-driver.cjs` wraps only `draftRepository.deleteManyByIds`, unchanged) or
     the `is_critical_mutation_file` list (`scripts/ci/classify-files-lib.sh:208`; `api/drafts.ts` and
     `api/transactions/broadcasting.ts` are on it and are not edited).
  3. A2 renames two repository methods (`draftRepository.remove` → `removeActionable`,
     `agentRepository.sumAgentDraftAmountsSince` → `sumAcceptedFundingAmountsSince`); neither caller is in a
     `config/wallet-sync-mutation-boundaries.json` `canonicalScopes` file, and no `finalize*`/signer identifier is
     added (`npm run verify:signer-inventory`).
  4. `scripts/ci/*`, `scripts/ownership/*` and `tests/ci/check-workflow-composition.test.sh` (C) are release-surface,
     ownership-cleanup and install-unit paths (`tests/install/utils/classify-install-scope.sh:483`, `:494`, `:499`),
     so the PR triggers the install, ownership and release-candidate lanes (Delivery).
  5. `docs/reference/changelog.md` `## [Unreleased]` and `docs/architecture/generated/*` are **integrator-owned**. No
     phase edits `scripts/ci/backend-integration-groups.sh` (A2 rewrites `agentRepository.sumDraftAmounts.test.ts` in
     place at its registered path, `:64`; no new integration spec), `config/resource-lifecycle-callsites.json` (new
     test files reuse registered patterns or add none), `scripts/quality/safety-catch-allowlist.json` (no catch
     added), `scripts/quality/large-file-classification.json`, or `config/container-image-lock.json`.
- **D-16.X7 e2e-helper sweep.** Each phase lists the `tests/e2e` helpers and specs that touch its behaviour, with the
  verdict. No phase adds an API endpoint, so no mock map changes.

  | Phase | `tests/e2e` helpers/specs touching the behaviour | Verdict |
  |---|---|---|
  | A1 | `send-transaction-flow.spec.ts:471` (`POST /wallets/:id/drafts` dispatcher) | The mock answers before any server logic; the frontend is unchanged. No edit. |
  | A2 | `grep -rn DELETE tests/e2e \| grep -i draft` is empty; no mock answers an agent cap | No edit. |
  | A3 | none (agent funding is API-key-only; no e2e spec drives it) | n/a |
  | B1 | `GET /ai/status` mocks serve disabled/unavailable (`node-status-card-responsive.spec.ts:168`, `adminOperationsApiState.ts:176`, `error-recovery.spec.ts:182`, `send-transaction-flow.spec.ts:492`, `wallet-sharing-privacy.spec.ts:275`); no spec posts `/ai/query` or asserts "Showing … of" | `AiFilterSummary` renders `null` without an AI filter, so no PNG can change. No edit. |
  | C1, C2 | none (CI scripts and ownership modules) | n/a |
- **D-16.X8 architecture graphs.** `docs/architecture/generated` is regenerated once by the integrator in the
  integration worktree (real root `npm ci`, never a symlink: the arch:check worktree-symlink artifact drops
  `shared/*` edges). Expected change: none. A1 adds no module; A2 drops `agentRepository.ts`'s
  `@sanctuary/shared/constants/drafts` import (an external-package edge the graphs do not draw); B1 adds
  `WalletDetail/hooks → TransactionList/displayedTransactions`, inside the existing collapsed WalletDetail →
  TransactionList edge (from `TransactionsTab.tsx:10`); C's `scripts/ownership` edges are outside the graph globs
  (`scripts/architecture/generate-graphs.mjs:34-57`). Whatever `arch:graphs`/`arch:calls` produce is committed in the
  integrator commit. The Architecture lane is not PR-required: watch its post-merge run on `main`.

### Phase file ownership (disjoint; one worktree and branch per phase)

| Phase | Production files | Test files | Other |
|---|---|---|---|
| a | **A1:** `server/src/services/draftCreate.ts`, `server/src/api/openapi/paths/drafts.ts` (POST 400 description, `:81-89`; reworded by the post-implementation review fix). **A2:** `server/src/repositories/agentRepository.ts`, `server/src/services/agentFundingPolicy.ts`, `server/src/services/draftService.ts`, `server/src/repositories/draftRepository.ts`, `server/src/api/openapi/paths/drafts.ts` (DELETE, `:115-126`). **A3:** `server/src/services/agentApiService.ts` | **A1:** `server/tests/unit/services/draftCreate.test.ts`, `server/tests/unit/services/draftService.test.ts` (A1 hunks). **A2:** new `server/tests/unit/services/agentFundingPolicy.capDurability.test.ts`, `server/tests/unit/services/agentFundingPolicy.test.ts`, `server/tests/unit/repositories/agentRepository.test.ts`, `server/tests/unit/repositories/agentRepository.testHarness.ts`, `server/tests/unit/services/draftService.delete.contracts.ts`, `server/tests/unit/repositories/draftRepository.test.ts`, `server/tests/unit/services/draftService.test.ts` (A2 hunks), `server/tests/unit/services/draftCreate.test.ts` (`:32`), `server/tests/integration/repositories/agentRepository.sumDraftAmounts.test.ts` (rewritten in place), `server/tests/integration/flows/signingIntentDraftLifetime.integration.test.ts` (one case). **A3:** `server/tests/unit/services/agentApiService.test.ts`. **Post-implementation review fix (integrator):** `server/tests/unit/api/agent-routes.funding.test.ts` (the cap-check instant is now passed to `enforceAgentFundingPolicy`) | **A2:** `docs/how-to/agent-wallet-funding.md` (one sentence at `:34`), `docs/explanation/state-machines.md` (`:130`, one row) |
| b | **B1:** `src/components/WalletDetail/hooks/useAITransactionFilter.ts`, `src/components/WalletDetail/tabs/TransactionsTab.tsx`, `src/components/WalletDetail/tabs/TransactionsTab/AiFilterSummary.tsx` | **B1:** `tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts`, `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx` | — |
| c | **C1:** `scripts/ci/write-empty-diagnostic-breadcrumb.sh`, `scripts/ci/run-psbt-core-subject.sh`. **C2:** new `scripts/ownership/cleanup-terminal-state.mjs`, `scripts/ownership/cleanup-execution.mjs`, `scripts/ownership/cleanup-execution-receipt.mjs`, `scripts/ownership/execution-receipt-schema.mjs`, `scripts/ownership/cleanup-journal-protocol.mjs` | **C1:** `tests/ci/write-empty-diagnostic-breadcrumb.test.sh`, `tests/ci/psbt-core-subject.test.mjs`, `tests/ci/check-workflow-composition.test.sh` (one new `assert_contains_in_order` block only). **C2:** new `tests/ownership/cleanup-terminal-state.test.mjs`, `tests/ownership/cleanup-execution-receipt.test.mjs` (the privacy-scan test's fixture only, `:259-270`). **Post-implementation review refactor (integrator):** new `tests/ownership/fixtures/cleanup-execution-fixture.mjs` (the shared signed-cleanup fixtures) and `tests/ownership/cleanup-execution.test.mjs` (fixture header only: its local copies replaced by that module's imports) | **C2:** `docs/reference/resource-ownership-cleanup.md` (one sentence in "Receipt interpretation") |

Integrator-owned: `docs/reference/changelog.md` (`## [Unreleased]`) and `docs/architecture/generated/*`. Read-only for
everyone: `config/wallet-safety-mutation-map.json`, every `server/stryker*.mjs` and `config/tooling/stryker*.mjs`,
`server/scripts/mutation/**`, `server/src/services/bitcoin/**`, `server/src/api/drafts.ts`,
`server/src/api/transactions/broadcasting.ts`, `config/wallet-sync-*.json`, `scripts/perf/**`, every
`scripts/verify-addresses/sourceManifest.ts` `VERIFIER_SOURCE_FILES` entry (including
`.github/workflows/verify-vectors.yml` and `scripts/ci/docker-endpoint-lib.sh`), every other workflow file,
`tests/ownership/cleanup-execution.test.mjs` (1,452 lines; a `reviewWhenTouched` large-file proof harness,
`scripts/quality/large-file-classification.json:237`; read-only for the phase workers — the integrator's
post-implementation review refactor moved only its fixture header into `tests/ownership/fixtures/`),
`config/resource-lifecycle-callsites.json`,
`scripts/quality/large-file-classification.json`, `scripts/verify-psbt/**`, `config/container-image-lock.json`,
`.github/workflows/quality.yml`, `scripts/quality.sh`, `server/prisma/**`, `shared/schemas/**`, and every `tests/e2e`
mock map and PNG baseline. Phase `a`'s three findings share two test files (`draftService.test.ts`: A1 fixture hunks,
then A2 rename hunks; `draftCreate.test.ts`: A1 rows, then A2's one-line mock-key removal at `:32`) and one production
file in different blocks (`server/src/api/openapi/paths/drafts.ts`: A1 POST 400 `:81-89`, A2 DELETE `:115-126`); one
worker owns all of them.

## Phase A — draft display binding, durable agent caps, agent payload repair (A1, A2, A3)

All three phases are server-only. Every file:line below was re-verified at `39831497382d1f77f90eab7383839c5373ae1a4c`
(`/home/nekoguntai/sanctuary-bug-scrub-20261013-i16`). Every fix and red test was prototyped on a scratch copy of
that tree (`scratchpad/p16a/tree`: a tar copy without `.git`, symlinked root and server `node_modules` from the
primary checkout, the primary checkout's generated Prisma client (identical `schema.prisma`), and a local
`shared/dist` build). The red results quoted below are **observed** on that copy with the base source files swapped
back in, except the two A2 integration cases, which are *expected red* (no disposable Postgres there; the integrator
records them on a guarded base swap, Verification, "Integrator step before the block"). Prototype diffs:
`scratchpad/i16-a1.patch`, `scratchpad/i16-a2.patch`, `scratchpad/i16-a3.patch`, and
`scratchpad/i16-a-draftServiceTest.patch` (the shared test file; A1's fixture hunks and A2's rename hunks).

No phase adds a Prisma migration, a sync-path repository callsite, a new integration spec file, or an identifier the
signer inventory sweeps (no `finalize*`, `signPSBT`, `signPsbt`, `signWith` or broadcast name). A2 renames two
repository methods: `draftRepository.remove` → `removeActionable` (only caller `draftService.ts`) and
`agentRepository.sumAgentDraftAmountsSince` → `sumAcceptedFundingAmountsSince` (only caller `agentFundingPolicy.ts`).
Neither caller is in `config/wallet-sync-mutation-boundaries.json`'s `canonicalScopes` (`:3-8`:
`services/bitcoin/blockchain/syncWallet.ts`, `services/bitcoin/sync/**`, `balanceCalculation.ts`,
`canonicalIncrementalSync.ts`). A2 reads `agent_funding_attempts` through its existing
`@@index([agentId, status, createdAt])` (`schema.prisma`, `AgentFundingAttempt`, `:1492`): no schema change.
`server/src/services/agentApiService.ts` (A3) is on `config/wallet-safety-critical-paths.json:50`, so the PR runs the
verify-vectors workflow once; it is not a `sourceManifest.ts` input and its
`config/hardware-wallet-implementation-inventory.json` entries (`:84-89`, `:4164`) are by function name and count,
not line, so nothing is re-pinned or regenerated. No touched file is in `config/wallet-safety-mutation-map.json`, a
`server/stryker*.mjs` / `config/tooling/stryker*.mjs` `mutate` list, `server/scripts/mutation/**` or the
`is_critical_mutation_file` list (`scripts/ci/classify-files-lib.sh:208`).

**One worktree, one commit per finding, in the order A1 → A2 → A3.** A2 before A3 is deliberate: A3 makes agent
funding drafts creatable again, so the cap must already be durable when it lands. **A2 and A3 must ship in the same
PR.**

Phase-local file ownership (all three rows belong to phase `a` in the plan-level table):

| Phase | Production files | Test files | Other |
|---|---|---|---|
| A1 | `server/src/services/draftCreate.ts`, `server/src/api/openapi/paths/drafts.ts` (POST 400 description) | `server/tests/unit/services/draftCreate.test.ts`, `server/tests/unit/services/draftService.test.ts` (A1 hunks: spend fixtures at `:175-180`, `:218-220`, `:247-249`, `:354`) | changelog bullet (integrator) |
| A2 | `server/src/repositories/agentRepository.ts` (`:16`, `:434-447`, `:785`), `server/src/services/agentFundingPolicy.ts` (`:99`, `:112`), `server/src/services/draftService.ts`, `server/src/repositories/draftRepository.ts`, `server/src/api/openapi/paths/drafts.ts` (DELETE 409) | new `server/tests/unit/services/agentFundingPolicy.capDurability.test.ts` (61 lines), `server/tests/unit/services/agentFundingPolicy.test.ts` (mock-key rename only), `server/tests/unit/repositories/agentRepository.test.ts` (`:8-11`, `:244-275`), `server/tests/unit/repositories/agentRepository.testHarness.ts` (`:18-21`, one mock key), `server/tests/unit/services/draftService.delete.contracts.ts`, `server/tests/unit/repositories/draftRepository.test.ts`, `server/tests/unit/services/draftService.test.ts` (A2 hunks: `:32`, `:400`, `:422`, `:915`), `server/tests/unit/services/draftCreate.test.ts` (`:32`), `server/tests/integration/repositories/agentRepository.sumDraftAmounts.test.ts` (rewritten in place; path unchanged, already in `scripts/ci/backend-integration-groups.sh:64`), `server/tests/integration/flows/signingIntentDraftLifetime.integration.test.ts` (one case) | `docs/how-to/agent-wallet-funding.md` (`:34`, one sentence), `docs/explanation/state-machines.md` (`:130`, one row); changelog bullet (integrator) |
| A3 | `server/src/services/agentApiService.ts` (`:136-171` removed, `:388-394`) | `server/tests/unit/services/agentApiService.test.ts` | changelog bullet (integrator) |

### Phase A1 — Bind the draft's displayed outputs, change, decoys, inputs, recipient and amount to the signing intent (P2 `draft-create--display-fields-and-locks-not-bound-to-intent`, recurrence)

**Evidence (re-verified at 39831497).**
- What iteration 9 (#1406, merge `c0debe606e`) binds: `assertDraftMatchesIntent` (`server/src/services/draftCreate.ts:409-421`)
  checks `selectedUtxoIds` (`:353-364`), `fee` (`:367-369`), `recipient` = first external output (`:372-377`), the
  net external amount (`:380-382`), non-zero totals (`:385-395`) and `isRBF` (`:398-402`). Recipient and amount are
  skipped when nothing leaves the wallet (`:414-417`), so a consolidation's `recipient` is unchecked text.
- What it leaves verbatim: `buildDraftJsonFields` (`:122-126`) stores `outputs`, `inputs`, `decoyOutputs`;
  `buildDraftTextFields` (`:128-133`) stores `changeAddress`; `buildDraftAmountFields` (`:135-142`) stores
  `changeAmount`. `api/drafts.ts:59-86` destructures all of them from the body and passes them to `createDraft`
  (`:88`). Nothing compares them with `deriveIntentSpend` (`server/src/services/bitcoin/signingIntent/intentSpend.ts:52-103`,
  which already returns `inputs` with prevout address/amount and `outputs` with `isOurs`).
- Who reads them (all approver/co-signer surfaces):
  - Drafts list: `src/components/DraftList/DraftRecipientSummary.tsx:59-67` shows `outputs[0].address` as "To:" for
    a one-entry list (instead of the bound `draft.recipient`) and every entry with its amount for a multi-entry list
    (`:12-34`); `:76-98` shows `changeAddress`/`changeAmount` as "Change".
  - Flow preview: `src/components/DraftList/utils.ts:73-80` (inputs with address/amount), `:94-111` (outputs),
    `:115-131` (decoys or change, marked as change).
  - Mobile agent review: `server/src/services/mobileAgentDraftService.ts:154-160` returns `inputs`, `outputs`,
    `changeAddress` to the mobile approver.
  - Resume: `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts:146-160` (`buildDraftTxData`:
    change, decoys) and `:185` (`payjoinAddress: outputs[0].address`, the restored payjoin binding).
- `amount` and `feeRate` *(review pass 1, A-P1-1)*. The stored `amount` is written verbatim (`buildDraftAmountFields`,
  `draftCreate.ts:136`). Rule (iii) compares only `data.effectiveAmount || data.amount` (`:380-382`), so once a correct
  `effectiveAmount` is supplied `amount` is never compared, and on a consolidation neither is (`:414-417`). Approvers
  see `amount`: in the resume fallback when `outputs` is empty (`sendTransactionPageHelpers.ts:217-221`), and in the
  created-draft notification (`draftCreate.ts:242`), which Telegram prints as "Amount"
  (`server/src/services/telegram/formatting.ts:108`, `:118`, `:140`). `feeRate` is stored as `Number(data.feeRate)`
  (`draftCreate.ts:161`) and never compared; it is shown as "Fee Rate" (`formatting.ts:119`, `:142`) and beside the
  bound fee in the drafts list (`src/components/DraftList/DraftAmountSummary.tsx:30`). On the reviewer's prototype
  (`scratchpad/rpr16a`), `{ amount: 1 }` and `{ feeRate: 999 }` on an otherwise bound draft are both accepted and
  stored. No caller sends `amount` ≠ `effectiveAmount`: web `src/hooks/send/useDraftManagement.ts:94`
  (`getEffectiveDraftAmount` returns `effectiveAmount`, `:38-40`) and `:112`; CPFP `transactionActionsData.ts:30`/`:47`;
  RBF `:100`/`:119`; agent `agentApiService.ts:382`/`:408`. The integration callers and the `draftService.test.ts`
  fixtures send no `effectiveAmount`. The only fixture where the two differ is the base consolidation accept
  (`draftCreate.test.ts:661-665`; `:680-684` in the A1 prototype).
- Why the rule is missing: the iteration-9 plan drafted "supplied outputs must contain each canonical external output"
  and then dropped it — `tasks/bug-scrub-loop-20261013-iteration9.md:189`: "The outputs-containment rule from the
  earlier draft is **dropped** (coordinator): broadcast never reads `draft.outputs`, and sendMax/subtractFees entries
  legitimately differ." Broadcast indeed never reads them, but the UI, the flow preview and the mobile review do, so
  the dropped rule left the approval display unbound. `inputs`, `decoyOutputs`, `changeAddress` and `changeAmount`
  were never in scope.
- Found while enumerating callers: the agent funding payload fails the strict request schema at base, so no agent
  funding draft can be created. That is its own finding and commit, **A3** (OQ-A1); the agent row of the table
  assumes A3.

**Callers and what each sends (the compatibility table that decides D-16.A1a).** Every value below was traced to
its source; "real" means the value the PSBT pays.

| Caller | `outputs` | `inputs` | `changeAddress` / `changeAmount` | `decoyOutputs` |
|---|---|---|---|---|
| Web send, single recipient (`src/hooks/send/useDraftManagement.ts:81-116`; tx data from `useSendTransactionActions.ts:86-99`, `:116-132`) | `[{ typed address, effectiveAmount }]` (`addMainOutput`); real amount (also for subtractFees, since `effectiveAmount` is post-fee); address may be upper-case bech32 | from the server's `utxos` (`createTransaction.ts:188`): real | from the server: `changeAmount` 0 and no address with decoys or no change (`createTransaction.ts:186-187`); else the single change output | the server's decoy outputs, real (`outputBuilder.ts:196-223`) |
| Web send, batch / sendMax (`useSendTransactionActions.ts:103-114`) | server `finalOutputs` with real amounts (`createBatchTransaction.ts:185`, `:351-354`) and the user's `sendMax` flag (`useDraftManagement.ts:69-79`) | real | `createBatchTransaction.ts:181-182`: change only when ≥ dust | none |
| RBF (`src/components/TransactionActions/transactionActionsData.ts:61-122`) | non-change outputs of the replacement, real values; may include a wallet receive address | not sent | first `isChange` output (`advancedTx/rbf.ts:365`: wallet branch-1 address) and its value, else none / 0 | not sent |
| CPFP (`transactionActionsData.ts:17-50`) | the child's one output (a wallet address), real | not sent | none / 0 | not sent |
| Agent funding (`agentApiService.ts:380-416`) | **base: fails the strict schema** (A3); after A3 `[{ recipient, effectiveAmount }]` | `buildInputMetadata(txData.utxos)`: real (`createTransaction.ts:188` always sets address and amount) | `txData` (same source as web single) | `txData.decoyOutputs` |
| Mobile / gateway | no create route: `gateway/src/routes/proxy/whitelist.ts:349-362` proxies only GET and PATCH for drafts | — | — | — |
| Payjoin | a payjoin intent is never draftable (C-D9, `draftCreate.ts:453-460`); a draft of a payjoin-capable original sends the web-single shape; resume binds `payjoinAddress` to `outputs[0].address` (`sendTransactionPageHelpers.ts:185`) | — | — | — |
| Integration callers (`signingIntentDraftLifetime.integration.test.ts:127-140`, `payjoinTwoRound.fallback-drafts.contracts.ts:28-36`) | none | none | none / 0 | none |

The legacy client shapes the existing tests pin (`draftCreate.test.ts:638-639`: a sendMax entry carrying 0, a
subtractFees entry carrying the typed amount) are not produced by today's web client, but they are kept as explicit
tolerances so a cached older SPA during an upgrade is not refused.

**Root cause.** Iteration 9 bound only the fields broadcast compares, on the premise that the others are cosmetic.
They are what approvers and co-signers read, so a wallet editor with a valid intent can still show approvers a
fabricated payment list, change address, decoys or inputs, while the PSBT pays something else.

**Decisions.**
- **D-16.A1a reject on mismatch (400 `metadata_mismatch`), not derive.** Options:
  - (a) *Derive the display fields from the intent server-side.* **Rejected.** (1) The server cannot label
    wallet-owned outputs: change, decoys and a self-send recipient all have `isOurs: true` (CPFP pays a wallet
    address; RBF lists a wallet receive output among its non-change outputs; a web send to an own address), so a
    derived `outputs`/`changeAddress`/`decoyOutputs` split would mislabel real drafts. (2) `outputs` carries client
    semantics that resume restores into the send wizard (`sendTransactionPageHelpers.ts:208` `buildDraftOutputs`;
    `SendTransactionWizard/draftTransactionData.ts:26-37`) and the payjoin binding (`:185`); rewriting them changes
    resumed drafts. (3) A silent rewrite stores something other than what the saving user was shown.
  - (b) **Chosen: extend `assertDraftMatchesIntent` with rules (vi)–(x) below**, same error shape and
    `details.field` as iteration 9, so the OpenAPI contract and the clients' error handling are unchanged. Every
    caller in the table already sends intent-consistent values (the agent caller after A3), so no real caller is
    refused.
- **D-16.A1b outputs (rule vi).** When `outputs` is non-empty: each entry must claim a distinct intent output at its
  address (`canonicalSegwitAddressCase(entry.address) === output.address`, as the recipient rule compares) whose
  amount fits, and every **external** intent output (`!isOurs && address && amount > 0`, the `deriveIntentSpend`
  definition) must be claimed. An entry's amount fits when it equals the intent output's amount, or when it is the
  sendMax shape (`entry.sendMax === true && data.sendMax === true && amount === 0`), or the subtractFees shape
  (`data.subtractFees === true && canonical < amount <= canonical + fee`, where fee is the intent's inputs − outputs).
  Wallet-owned outputs may be listed (agent and RBF lists, CPFP's only output) but need not be. Empty or absent
  `outputs` is allowed only when the intent pays at most one external output: the UI then falls back to the bound
  `recipient` *(post-implementation review: with two or more external outputs an omitted list hid every payee but
  the first, so it is refused on `outputs`)*. Claiming is greedy in entry order (first unclaimed output at that
  address that fits); a pathological same-address/different-amount pair could be refused — fail-closed, and no
  builder produces one. *(Post-implementation review:)* the subtractFees overstatements share one budget — their
  sum across all entries is at most the fee; at most one entry may carry `sendMax: true`; and outputs, decoys and
  change claim from **one** set of intent outputs, so no output is shown as more than one of them.
- **D-16.A1c change and decoys (rule vii).**
  - Each `decoyOutputs` entry claims a distinct **wallet-owned** intent output with exactly its amount.
  - `changeAddress`, when non-empty, must be a wallet-owned intent output paying exactly `Number(changeAmount || 0)`
    (the stored expression, `:140`). With no `changeAddress`, `changeAmount` must be 0. This matches every builder:
    the single-recipient path reports decoy change only through `decoyOutputs` (`createTransaction.ts:186-187`), the
    batch and exact-selection paths report 0 with no change output (`createBatchTransaction.ts:181`,
    `utxoSelection.ts:203-211`), RBF and CPFP send the change output's own value or 0.
  - Wallet-owned outputs that are not displayed (e.g. RBF's further decoy change outputs) are allowed: they stay in
    the wallet, and amount and fee are bound.
- **D-16.A1d inputs (rule viii) are in scope** — same gap: the flow preview (`utils.ts:73-80`) and the mobile review
  show input addresses and amounts. When `inputs` is non-empty it must be exactly the intent's inputs (same count, no
  duplicate `txid:vout`, txid case-insensitive), each with the prevout's decoded address (via
  `canonicalSegwitAddressCase`) and amount. Absent/empty is allowed (RBF and CPFP send none; the preview then shows a
  summary from the bound `selectedUtxoIds`).
- **D-16.A1e consolidation recipient (rule ix).** When the intent pays nothing outside the wallet, `recipient` must
  still be one of the intent's output addresses (CPFP and RBF-consolidation send their primary output; a web
  self-send sends its own address). Iteration 9 skipped it entirely (`:414-417`).
- **D-16.A1f agent caller.** The agent payload repair is finding A3, committed separately after A2. A1 alone leaves
  agent drafts refused exactly as at base (by the schema, before any A1 rule runs), so A1 never refuses an agent
  draft that base accepted.
- **D-16.A1g helper layout (lizard).** One top-level helper per rule, sequenced by `assertDraftMatchesIntent`:
  `assertConsolidationRecipient`, `claimOutput`, `outputAmountFits`, `assertOutputListMatches`, `assertDecoysMatch`,
  `assertChangeMatches`, `assertDisplayOutputsMatch`, `assertDisplayInputsMatch`, `assertStoredAmountMatches`
  (D-16.A1i, CCN 2) (plus two one-line type helpers). They
  stay in `draftCreate.ts` (no new module, so no architecture-graph edge). Prototype measured max CCN 7
  (`outputAmountFits`), `assertDraftMatchesIntent` CCN 2; `draftCreate.ts` grows 523 → 644 lines (under the
  800-line large-file warning, `scripts/quality/check-large-files.mjs:13`).
- **D-16.A1h residuals (documented, not fixed).** (1) A `sendMax: true` flag on an entry whose amount equals the
  intent's still renders "MAX" for that entry (`DraftRecipientSummary.tsx:27`); amounts and totals are bound. (2)
  Pre-existing from iteration 9: a web batch whose first typed output is a wallet address and a later one external
  sends `recipient` = the wallet address, which rule (iii) refuses (first external output). No caller change is made
  here. (3) Drafts created before this fix keep whatever they stored; the change gates creation only (rows are not
  rewritten; no migration). (4) *(review pass 1)* **`feeRate` is not bound.** The fee is bound (rule ii) and shown;
  `feeRate` is the client's sat/vB estimate, which the server cannot recompute exactly from the unsigned intent (the
  final vsize depends on the signatures, and the builders round). It stays stored verbatim (`:161`) and shown as
  "Fee Rate" in Telegram (`formatting.ts:119`, `:142`) and beside the fee in the drafts list
  (`DraftAmountSummary.tsx:30`). Recorded as P3 `draft-create--fee-rate-display-not-bound-to-intent`. (5) On a
  consolidation the intent pays nothing outside the wallet (`spend.amount` 0), so rule (x) keeps `amount` and
  `effectiveAmount` equal to each other but ties neither to an intent output, as at base; the outputs, change and
  fee are bound. The amount is still shown as "Amount" in the created-draft notification (`draftCreate.ts:242` →
  `telegram/formatting.ts:118`, `:140`). Recorded as P3 `draft-create--consolidation-amount-not-bound-to-intent-output`
  *(review pass 2)*.
- **D-16.A1i stored amount (rule x; review pass 1, A-P1-1).** For every draft kind, consolidation included:
  `assertIntegerMatches('amount', Number(data.effectiveAmount || data.amount), data.amount)`. The stored `amount`
  must be a safe integer equal to the stored effective amount (the `:141` expression). A mismatch is refused like
  the other rules: `InvalidInputError('Draft does not match the server-issued signing intent', 'amount', { reason:
  'metadata_mismatch', expected, actual })`, so 400 `metadata_mismatch` with `details.field: 'amount'`. It runs
  after the external/consolidation branch, so a wrong `effectiveAmount` on an external spend is still reported by
  (iii) first. Once (iii) holds, (x) makes `amount` the intent's net external spend. With `effectiveAmount` omitted
  the stored effective amount is `amount` itself, so (x) only requires a safe integer; on a consolidation a
  non-integer `amount` was already refused later by `BigInt` (`:136`). Every caller sends equal values (Evidence),
  so no real caller is refused.

**Production change** (`server/src/services/draftCreate.ts`, +121 prototyped: `i16-a1.patch` plus
`i16-a1-amount.patch`, the review-pass-1 delta).
In `assertDraftMatchesIntent`: add `else { assertConsolidationRecipient(data, spend); }` to the external-outputs
`if`, then call `assertStoredAmountMatches(data)` (D-16.A1i) before `assertTotalsMatch`, and after `assertRbfBinding` call `assertDisplayOutputsMatch(data, spend, totalInput - totalOutput)` and
`assertDisplayInputsMatch(data, spend)`. Update the doc comment above it ("display fields (recipient, amount,
outputs, inputs, change, decoys)"). Core of the new rules (full text in `i16-a1.patch` and `i16-a1-amount.patch`):
```ts
/** (x) The stored amount is the stored effective amount, which (iii) binds to the intent when anything leaves the wallet. */
const assertStoredAmountMatches = (data: CreateDraftInput): void => {
  assertIntegerMatches('amount', Number(data.effectiveAmount || data.amount), data.amount);
};

const isExternalOutput = (output: IntentOutput): boolean =>
  !output.isOurs && output.address.length > 0 && output.amount > 0;

const outputAmountFits = (data: CreateDraftInput, entry: DraftDisplayEntry, canonical: number, fee: number): boolean => {
  const amount = Number(entry.amount);
  if (amount === canonical) return true;
  if (entry.sendMax === true && data.sendMax === true && amount === 0) return true;
  return data.subtractFees === true && amount > canonical && amount <= canonical + fee;
};

const assertChangeMatches = (data: CreateDraftInput, spend: IntentSpend): void => {
  const changeAmount = Number(data.changeAmount || 0);
  if (!data.changeAddress) {
    assertIntegerMatches('changeAmount', 0, changeAmount);
    return;
  }
  const changeAddress = canonicalSegwitAddressCase(data.changeAddress);
  if (!spend.outputs.some(output => output.isOurs && output.address === changeAddress && output.amount === changeAmount)) {
    throw intentMismatch('changeAddress', undefined, { changeAddress: data.changeAddress, changeAmount: data.changeAmount });
  }
};
```
`details.field` values: `outputs`, `decoyOutputs`, `changeAddress`, `changeAmount`, `inputs`, `recipient`, `amount`. NaN and
non-integers never equal a canonical (safe-integer) amount, so they are refused without extra branches.
OpenAPI (`server/src/api/openapi/paths/drafts.ts:84-88`): append to the 400 description ", supplied outputs must be
distinct intent outputs covering every external output (amount equal, or 0 on a sendMax entry, or at most the fee
above on a subtractFees draft), each decoy and the change address a wallet-owned intent output with its amount
(changeAmount 0 without a change address), supplied inputs exactly the intent inputs with their prevout address and
amount, a consolidation's recipient one of its outputs, and amount equal to the effective amount".

**Failing-first tests.**
1. `server/tests/unit/services/draftCreate.test.ts` (766 → 805 lines), in `describe('createDraft binds draft
   metadata to the signing intent')`:
   - First, the fixture: `externalSpend()` outputs (`:119-122`) gain `isOurs: false` (`tb1qexternal`) and
     `isOurs: true` (`tb1qchange`); the multi-recipient case (`:669-673`) likewise. Green on base and after (the base
     ignores `isOurs`).
   - New `it.each('rejects %s')` rows (17), each through `expectMismatch` (refused with `metadata_mismatch` on the
     named field, nothing persisted or locked, policy not evaluated): an output the intent does not pay; outputs that
     leave out the external payment; an output with a different amount; one intent output listed twice; a 0 sendMax
     entry on a draft that is not sendMax; a subtractFees entry above the paid amount plus the fee (`101001`); a change
     address the intent does not pay; the external payment shown as change; a change amount that is not the change
     output (`18000`); a change amount without a change address; a decoy the intent does not pay; the external payment
     shown as a decoy; an input the intent does not spend; an input with a different amount; an input with a
     different address; one intent input listed twice (length mismatch); *(review pass 1)* `a stored amount that is
     not the effective amount` (`{ amount: 1 }`, field `amount`).
   - Three new `it`s: `rejects displayed inputs that repeat one intent input and leave out another` (two-input spend,
     equal length, covers the duplicate guard), `rejects a consolidation recipient the intent does not pay`, and
     *(review pass 1)* `rejects a consolidation whose amount is not its effective amount` (consolidation spend,
     `{ recipient: 'tb1qchange', amount: 100000, effectiveAmount: 119000 }`, field `amount`).
   - *(review pass 1)* Fixture change: the base consolidation accept (`:661-665`, `skips recipient and amount for a
     consolidation that pays nothing outside the wallet`) sends `effectiveAmount: 119000` with the base input's
     `amount: 100000`, which rule (x) now refuses. It becomes `accepts a consolidation whose recipient is an intent
     output and whose amount is its effective amount` with `{ recipient: 'tb1qchange', amount: 119000,
     effectiveAmount: 119000 }` (no real caller sends the two different; Evidence). It is green on base and after.
     No other fixture in the A1 file list sets `effectiveAmount` different from `amount` (`:635` sends `'100000'`,
     equal as a number; `:640` omits it).
   - New `it.each('accepts %s')` rows (4, guards, green on base and after): the change output with its amount (as a
     numeric string); a wallet-owned decoy with its amount; outputs that also list a wallet-owned output (agent/RBF
     shape); the intent inputs with an upper-case txid and a string amount. The existing sendMax-0 and
     subtractFees-unreduced accepts (`:638-639`) stay green.
   - **Observed red on base** (`scratchpad/p16a/a1-red.txt` for the first 18; the review-pass-1 total re-observed on
     `scratchpad/rpr16-p1amt` with base `draftCreate.ts` swapped in): `Tests 20 failed | 58 passed (78)` for the file;
     every failure is `AssertionError: promise resolved "{ id: 'draft-789', …(2) }" instead of rejecting` at the
     `.rejects.toMatchObject` line of `expectMismatch`. All accepts green.

Confirm red: `cd server && npx vitest run tests/unit/services/draftCreate.test.ts` on the plan-commit base with the
test edits applied (expected `20 failed | 58 passed`).

**Existing tests that encode the old behaviour** (edited in the A1 commit; green on base and after, observed):
`server/tests/unit/services/draftService.test.ts` (921 → 936 lines; under 1,000):
- `canonicalSpend.outputs` (`:178`) becomes `[{ address: 'tb1qtest...', amount: 1000, isOurs: true }]` (the
  consolidation recipient rule needs `validInput.recipient` to be an intent output).
- New local `metadataSpend(txid)` (inputs `txid:0` `tb1qinput` 100000; outputs `tb1qtest...` 70000, `tb1qoutput`
  25000, `tb1qdecoy` 5000, all `isOurs: true`) used via `mockResolvedValueOnce` by `normalizes string fee rates…`
  (`:218`) and `keeps numeric nested amount metadata…` (`:247`), each also passing `selectedUtxoIds: [txid + ':0']`.
  These two cases used unrelated addresses only to test JSON normalisation; their assertions on the stored values
  are unchanged.
- `uses empty selectedUtxoIds default…` (`:354`): the empty spend gains the recipient output
  (`{ ...canonicalSpend, inputs: [], outputs: [{ address: 'tb1qtest...', amount: 0, isOurs: true }] }`).
- Without these edits 19 `createDraft` cases in that file fail after the fix (observed); with them, 55/55 green on
  base and after.

**Green criteria.** `draftCreate.test.ts` 78/78 (observed on `scratchpad/rpr16-p1amt`, together with
`draftService.test.ts`, `mobileAgentDraftService.test.ts` and `agentApiService.test.ts` at A1+A2+A3: 180/180);
`draftService.test.ts`, `mobileAgentDraftService.test.ts`,
`api/drafts-routes.test.ts`, `api/drafts.test.ts`, `api/openapi.test.ts` green (observed on the prototype); the
integration callers (`signingIntentDraftLifetime.integration.test.ts`, the payjoin `fallback-drafts` contracts) send
no outputs, inputs or change and stay green unchanged in the integrator's full integration run.

**Pin / inventory / gate impact.** None beyond the critical-path note in the phase intro. No repository call added in
a sync-path file; no `finalize*`; no catch added (safety-catch allowlist untouched); no import edge added.

**Coverage (100% backend, `tests/unit`).** Every new branch is hit by the tests above: `displayEntries` array /
non-array (`decoyOutputs: null` in `draftService.test.ts:252`, absent elsewhere); `claimOutput` hit/miss;
`outputAmountFits` all three arms and the fall-through (equal; sendMax 0 accept and refuse; subtractFees in range,
above range; plain mismatch); `assertOutputListMatches` empty / unlisted / uncovered-external / pass;
`assertDecoysMatch` pass / miss / non-wallet; `assertChangeMatches` no-address 0 / no-address non-zero / address
match / mismatch, and `changeAmount || 0` both arms; `assertDisplayInputsMatch` empty / length mismatch / unknown
input / duplicate with equal length / address mismatch / amount mismatch / pass; `assertConsolidationRecipient`
pass / refuse; `assertStoredAmountMatches` pass / refuse (the `{ amount: 1 }` row and the consolidation case), and
`data.effectiveAmount || data.amount` both arms (the effectiveAmount-omitted accept row). The prototype was not run under coverage (coverage is the integrator's, D-16.X5).

**Lizard.** Pinned `lizard -C 15 -T nloc=200` over the prototype's `draftCreate.ts` and the two test files: rc 0, no
warnings.

**Compatibility.** The prototype's `tsc --noEmit` printed one error, `src/middleware/csrf.ts(262,14) TS2883`, a
symlinked-`node_modules` path artefact of the scratch copy (it names `/home/nekoguntai/sanctuary/node_modules/@types/qs`);
a real worktree with its own `npm ci` must be clean. Every caller in the table creates drafts unchanged (the agent
caller once A3 lands); iteration 9's rules (i)–(v) and their tests are unchanged.

**Acceptance.** A draft whose outputs, decoys, change or inputs disagree with its intent (beyond the two client-shape
tolerances), whose consolidation recipient is not an intent output, or whose `amount` differs from its effective
amount (any draft kind), is refused with 400 `metadata_mismatch` naming the field, before anything is stored or
locked. `feeRate` stays unbound client text (D-16.A1h (4)); the fee it is shown beside is bound.

**Rollback.** Revert the commit. No data or schema step. A3 does not depend on it.

### Phase A2 — Agent funding caps count accepted requests, so no draft deletion resets them; broadcasted drafts are kept (P2 `draft-delete--broadcasted-draft-deletable-resets-agent-funding-cap`)

**Evidence (re-verified at 39831497).**
- **The cap counts draft rows.** `agentFundingPolicy.ts:98-121` compares `dailyFundingLimitSats` /
  `weeklyFundingLimitSats` (set by an admin, `adminAgentService.ts:30-31`, `:49-50`) with
  `agentRepository.sumAgentDraftAmountsSince` (`agentRepository.ts:434-447`), which sums `draftTransaction.amount`
  for `agentId` over `DRAFT_LIFECYCLE_STATUS_VALUES` (actionable + `broadcasted`). Any way a row disappears lowers
  the total.
- **Path 1 — delete a broadcasted draft (the finding as filed).** `draftService.deleteDraft` (`draftService.ts:57-73`)
  loads with `findByIdInWallet` (`draftRepository.ts:159-166`, no status filter), checks creator-or-owner (`:68-70`)
  and calls `draftRepository.remove` (`:72` → `draftRepository.ts:382-386`, unconditional delete by id). Route:
  `DELETE /wallets/:walletId/drafts/:draftId`, `requireWalletAccess('view')` (`api/drafts.ts:145-151`). Agent drafts
  are created as the agent's linked user (`agent/auth.ts:170`), who may be a non-owner member and is the creator.
- **Path 2 — delete the still-actionable draft, then broadcast without it.** Deleting an actionable draft is allowed
  by design. The agent intent survives the draft (no FK; it expires on its own stored `expiresAt`), and
  `POST /wallets/:id/transactions/broadcast` accepts a request with no `draftId`
  (`api/transactions/broadcasting.ts:67-72` `loadDraft` returns `null`; `:79-88` finds no linked draft and returns
  `null`). Broadcast evaluates vault policies only (`:370-400`); nothing checks agent caps. Unless an enforce-mode
  `approval_required` vault policy applies (`assertApprovalSatisfied`, `:322-333`), the funding is sent and no draft
  row counts it.
- **Paths 3–4 — expiry and invalidation** remove actionable rows too (`draftRepository.deleteExpired` `:391-399`,
  `maintenanceRepository.deleteExpiredDrafts` `:44`, sync `deleteManyByIds` `:475+`); this is backlog finding
  `agent-funding-caps--invalidated-or-expired-drafts-uncounted`, which A2 resolves (OQ-A2).
- **A durable record already exists.** Every accepted agent funding draft is written together with an
  `AgentFundingAttempt { status: 'accepted', amount: effectiveAmountSats, draftId, createdAt }` **in the same
  transaction** (`agentApiService.ts:428-441`, inside `withAgentFundingTransaction`, `agentRepository.ts:707-724`, which
  also holds the per-agent advisory lock the cap check runs under). `agentApiService.ts` is the only writer of
  `status: 'accepted'` (`grep "status: 'accepted'"`; `recordAgentFundingAttempt`, `:228-262`, is called only from the
  rejection path `:461`) and the only creator of drafts with `agentId`. Nothing deletes attempts: no
  `agentFundingAttempt.delete*` in `server/src`; the only removal is `onDelete: Cascade` from `WalletAgent`
  (`schema.prisma:1489`, `AgentFundingAttempt.agent`), i.e. when the agent itself is deleted and its caps no longer
  exist. Backups classify attempts as `durable-restored` (`backupService/constants.ts:80`);
  `@@index([agentId, status, createdAt])` (`schema.prisma:1492`) already serves the sum. The amount equals the
  draft's (`draft.amount` is `effectiveAmount`, `agentApiService.ts:382`).
- Tests miss it: `agentFundingPolicy.test.ts` mocks the repository; the integration test
  `agentRepository.sumDraftAmounts.test.ts:26-63` only shows broadcast rows counting; no test deletes an agent draft.

**Root cause.** The admin-set cap is computed from mutable draft rows that the linked user (and expiry, sync
invalidation, owners) can remove, instead of from the record of what the agent was granted.

**Decisions.**
- **D-16.A2a count accepted funding attempts, not drafts.** Options:
  - (1) **Chosen: `sumAcceptedFundingAmountsSince(agentId, since)`** = `agentFundingAttempt.aggregate({ where: {
    agentId, status: 'accepted', createdAt: { gte: since } }, _sum: { amount: true } })`, replacing
    `sumAgentDraftAmountsSince` (one caller). It closes all four paths at once, because no draft operation and no
    broadcast touches the record; it is written atomically with the draft under the same advisory lock the check
    reads under, so there is no new race; it survives backup/restore; it needs no migration. Smallest change: one
    repository function and two call sites.
  - (2) *Signing intents as the record.* **Rejected.** `TransactionSigningIntent` has no agent column and
    `createSigningIntent` stores no agent identity (`agentApiService.ts:370-378`: wallet, user, `source: 'agent'`);
    several agents may share a funding wallet and linked user (`WalletAgent` is unique on funding + operational
    wallet only), so attribution would mean decoding every snapshot's outputs; intents are `security-ephemeral` in
    backups (`backupService/constants.ts:44`), so a restore would reset the caps; superseded/expired intents need
    their own rules.
  - (3) *Refuse deleting agent drafts by a non-owner creator* (plus the broadcasted 409). **Rejected as the cap fix.**
    It leaves expiry and sync invalidation (paths 3–4), blocks the linked user's legitimate cleanup, and still lets a
    wallet owner reset an admin-set cap by deleting (owners are not necessarily admins).
  - (4) *Enforce agent caps at broadcast for agent intents.* **Rejected.** Same attribution problem as (2) once the
    draft is gone, a second enforcement point with its own race against the funding lock, and it refuses after
    humans have signed.
- **D-16.A2b semantics (product-visible; OQ-A2, coordinator decision).** The cap counts every **accepted** agent
  funding request in the window, whatever later happens to its draft: rejected, expired, invalidated, deleted or
  broadcast. Rejected **attempts** (requests the policy refused) never counted and still do not. Release valve: the
  existing one-time owner override (`agentFundingPolicy.ts:124-131` → `requireOverrideOrThrow`, `:137-155`;
  `docs/how-to/agent-wallet-funding.md:89-99`). This is stricter than today only for abandoned requests.
  `docs/how-to/agent-wallet-funding.md:34` ("Optional daily and weekly caps.") gains, *(coordinator, at assembly)*
  worded to OQ-A2: "Daily and weekly caps count every accepted funding request in the window, including requests
  whose drafts are later rejected, expired, invalidated or deleted; use an owner override (below) for an exceptional
  refill."
- **D-16.A2c keep the broadcasted-draft 409 (secondary).** The cap no longer needs it, but the finding's second
  harm does: deleting a broadcasted draft erases its approval history (`ApprovalRequest` `onDelete: Cascade`,
  `schema.prisma:1730`) and the row authenticated replay resolves (`draftSigningIntentRepository.ts:1-8`, `:21-29`;
  `broadcasting.ts:79-88`; payjoin's draft-bound refusal `payjoin/attempt.ts:129`), against
  `BROADCAST_DRAFT_RETENTION_POLICY` (`broadcastContracts.ts:345-351`: archive, `preserveApprovalHistory: true`). New
  `draftRepository.removeActionable(draftId, walletId): Promise<boolean>` = `deleteMany({ where: { id, walletId,
  status: { in: ACTIONABLE } } })`, replacing `remove` (one caller); `deleteDraft` maps `false` to
  `ConflictError('Broadcasted drafts are retained and cannot be deleted', undefined, { reason: 'draft_retained' })`.
  The guard is in the statement, so it is race-safe: a broadcast archiving the row (`persistTransaction.ts:107-114`)
  that commits first makes the waiting DELETE re-check and skip it (409); a DELETE that commits first leaves the
  archive a no-op (`draftArchived = false`, `:114`), the pre-existing delete-before-broadcast case. A row deleted
  concurrently by another request also yields 409, not 404 (documented in the OpenAPI text). Callers checked: the
  Drafts list only shows actionable drafts (`useDraftListController.ts:136-149`; error shown via `runOperation`), the
  send-flow release is best-effort (`useSendTransactionActions.ts:432-442`), the gateway proxies no draft DELETE
  (`gateway/src/routes/proxy/whitelist.ts:349-362`), agent keys cannot delete (`api/agent.ts:140`, `:167`, `:235`),
  sweeps are actionable-only, and wallet deletion cascades drafts, agent and attempts together.
- **D-16.A2d no change at broadcast.** `broadcasting.ts` (a critical-mutation file) is not edited; path 2 is closed
  because the amount was counted when the request was accepted.

**Production change** (full text in `i16-a2.patch`):
```ts
// agentRepository.ts — replaces sumAgentDraftAmountsSince (:434-447); drops the now-unused
// DRAFT_LIFECYCLE_STATUS_VALUES import (:16); export list (:785) renamed.
export async function sumAcceptedFundingAmountsSince(agentId: string, since: Date): Promise<bigint> {
  const result = await prisma.agentFundingAttempt.aggregate({
    where: { agentId, status: 'accepted', createdAt: { gte: since } },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0n;
}

// agentFundingPolicy.ts:99 and :112 — call sumAcceptedFundingAmountsSince (same arguments).

// draftRepository.ts — replaces remove() (:382-386); export list remove → removeActionable
export async function removeActionable(draftId: string, walletId: string): Promise<boolean> {
  const result = await prisma.draftTransaction.deleteMany({
    where: { id: draftId, walletId, status: { in: [...ACTIONABLE_DRAFT_STATUS_VALUES] } },
  });
  return result.count > 0;
}

// draftService.ts deleteDraft, after the creator/owner check (replaces :72)
  if (!await draftRepository.removeActionable(draftId, walletId)) {
    throw retainedDraftConflict();
  }
```
OpenAPI (`paths/drafts.ts:115-126`): description "Delete an actionable draft transaction. The creator or wallet owner
may delete it; broadcasted drafts are retained." and a `409` "details.reason draft_retained: the draft was broadcast
(or is no longer actionable) and is kept". `docs/explanation/state-machines.md:130` becomes
`| UNSIGNED/PARTIAL/SIGNED | DELETED | DELETE /drafts/:id (BROADCAST is retained: 409 draft_retained) | \`draftsController.delete()\` |`
*(coordinator, at assembly: the table's fourth "Handler" column is kept)*.

**Failing-first tests.**
1. **New `server/tests/unit/services/agentFundingPolicy.capDurability.test.ts`** (61 lines; the behavioural red for
   paths 1–4). It runs the real `enforceAgentFundingPolicy` and the real `agentRepository` (`vi.importActual`) over a
   mocked `models/prisma` whose rows describe "a 30,000-sat request was accepted today, its draft row is gone (deleted
   before broadcast, intent broadcast without a draftId)": `agentFundingAttempt.aggregate` → 30,000,
   `draftTransaction.aggregate` → `null`, agent daily/weekly cap 30,000, no override.
   - `it('refuses the next request in the window after the funding draft was deleted')`: 1 sat →
     `rejects.toMatchObject({ details: { reasonCode: 'policy_daily_limit' } })`. **Observed red on base:**
     `AssertionError: promise resolved "{ overrideId: null }" instead of rejecting`.
   - `it('still admits a request that fits beside the accepted total')` (guard): accepted 29,999 → resolves
     `{ overrideId: null }`. Green on base and after.
   The broadcast route needs no fixture: with no `draftId` it reads no draft and writes no attempt
   (`broadcasting.ts:67-72`, `:79-88`), so "deleted, then broadcast without a draft" and "deleted" are the same cap
   state; the integration case below runs the real delete.
2. `server/tests/unit/repositories/agentRepository.test.ts` (437 → 423): the `sumAgentDraftAmountsSince` block in
   `lists, updates, and tracks wallet agent policy metadata` (`:244-275`) asserts the `agentFundingAttempt.aggregate`
   call (`where: { agentId, status: 'accepted', createdAt: { gte } }`), the `null` → `0n` arm, and that
   `draftTransaction.aggregate` is not called; the draft-status imports (`:8-11`) go. The harness
   (`agentRepository.testHarness.ts:18-21`) gains `aggregate: vi.fn()`. Red on base: `TypeError:
   agentRepository.sumAcceptedFundingAmountsSince is not a function` (observed; accepted missing-export red).
3. `server/tests/unit/services/agentFundingPolicy.test.ts`: the mock key and its 8 uses (9 occurrences) are renamed
   (`sed s/sumAgentDraftAmountsSince/sumAcceptedFundingAmountsSince/`), no other change. Red on base: 7 cases fail
   with `agentRepository.sumAgentDraftAmountsSince is not a function` (observed; accepted rename red).
4. `server/tests/integration/repositories/agentRepository.sumDraftAmounts.test.ts` (64 lines), **rewritten in place**
   (same registered path): accepted 10,000 (1 h ago) + accepted 20,000 (30 min) + rejected 70,000 + accepted 40,000
   (48 h) → 30,000; then the linked user deletes the 10,000 request's still-actionable draft through the real
   `draftService.deleteDraft(funding.id, draftId, user.id, 'signer')`, the row is gone, and the sum is still 30,000.
   Predicted red on base: the import `sumAcceptedFundingAmountsSince` is undefined (`TypeError … is not a function`).
5. `server/tests/unit/services/draftService.delete.contracts.ts` (96 → 118): mock type `remove` →
   `removeActionable`; creator/owner cases assert `removeActionable(draftId, walletId)`; new `it.each(['its creator',
   'the wallet owner'])('refuses to delete a broadcasted draft for %s with 409 draft_retained')`; new `it('refuses
   with 409 when a broadcast archives the draft between the read and the delete')`; the 403 case also asserts
   `removeActionable` not called.
6. `server/tests/unit/repositories/draftRepository.test.ts` (466 → 473): `remove` leaves the combined delegate case;
   new `it('removeActionable deletes only an actionable draft in the wallet and reports whether it did')` (use
   `mockResolvedValue` before each call; a queued `mockResolvedValueOnce` leaks into later cases on base).
7. `server/tests/integration/flows/signingIntentDraftLifetime.integration.test.ts`: after `:180-188` add
   `it('refuses to delete a broadcasted draft and keeps the row')` (status set to `broadcasted` via `getTestPrisma()`,
   `deleteDraft` rejects `{ statusCode: 409, details: { reason: 'draft_retained' } }`, `findUnique` still returns it).
   Predicted red: `promise resolved "undefined" instead of rejecting`.
- **Red-run mock note.** For the red run the `draftService.test.ts` repository mock factory carries both
  `remove: vi.fn()` and `removeActionable: vi.fn()` (otherwise base fails with `TypeError: draftRepository.remove is
  not a function`); the A2 commit drops `remove` there and in `draftCreate.test.ts:32`, and renames the two rollback
  assertions (`draftService.test.ts:400`, `:422`) and the delegate map entry (`:915`) to `removeActionable`.
- **Observed red on base** (A1 applied; base `agentRepository.ts`, `agentFundingPolicy.ts`, `draftService.ts`,
  `draftRepository.ts`): `scratchpad/p16a/a2-cap-red.txt` — `Tests 9 failed | 10 passed (19)` over the
  capDurability, `agentRepository.test.ts` and `agentFundingPolicy.test.ts` files (1 behavioural, 1 missing-export, 7
  rename reds as above); `scratchpad/p16a/a2-red.txt` — `Tests 6 failed | 72 passed (78)` over
  `draftService.test.ts` + `draftRepository.test.ts` (creator/owner `expected "vi.fn()" to be called with arguments:
  [ 'draft-789', 'wallet-456' ]`; three 409 cases `promise resolved "undefined" instead of rejecting`;
  `TypeError: removeActionable is not a function`).

**Existing tests.** `agentRepository.funding.test.ts`, `agentMonitoringService.test.ts`, `agentApiService.test.ts`,
`api/agent-routes.funding.test.ts`, `api/agent-wallet-funding-smoke.test.ts`, `api/drafts-routes.test.ts`,
`api/drafts/drafts.update-delete.contracts.ts` and the integration delete case `:180-188` (an `unsigned` draft) are
unchanged and green (unit files observed).

**Green criteria.** After the fix every phase-`a` unit file in the phase verification block passes (observed:
254/254 over 12 files on the prototype); the two integration cases pass in the integrator's full run.

**Coverage.** `sumAcceptedFundingAmountsSince` sum / `null` arms (repository test); both policy call sites (policy
tests and capDurability); `removeActionable` true/false; `deleteDraft` success, 409, 403, 404. No `v8 ignore` added.

**Lizard.** Prototype run over `agentRepository.ts`, `agentFundingPolicy.ts`, `draftService.ts`,
`draftRepository.ts` and every A2 test file: rc 0, no warnings. The integration rewrite keeps its helper as a `const`
arrow inside the `it` (no nested `function` declaration hoisted; lizard anchor unchanged).

**Concurrency.** The cap check (`enforceAgentFundingPolicy`, inside `withAgentFundingTransaction`) and the accepted
attempt insert run under the same `pg_advisory_xact_lock(hashtext('agent-funding:<agentId>'))`, as the draft insert
did, so two concurrent requests still serialize; draft deletion takes no part in the sum.

**Compatibility.** `DELETE` of an actionable draft is unchanged (204; 403/404 unchanged); the new `409` applies only
to broadcasted (or concurrently removed) rows, which no UI offers to delete. The cap's meaning changes as OQ-A2 says;
no stored row changes.

**Acceptance.**
- After an agent funding request is accepted, no draft deletion (actionable or broadcasted, by the linked user or the
  owner), expiry, invalidation or draft-less broadcast lowers the agent's daily/weekly total; only the window rolling
  or an owner override admits more.
- `DELETE` on a broadcasted draft returns 409 `draft_retained` and keeps the row, its approval history and its replay
  link.

**Rollback.** Revert the commit (and A3 with it; D-16.X3). No data or schema step; caps go back to counting draft
rows.

### Phase A3 — Agent funding drafts send outputs in the strict draft request shape (P2 `agent-funding--draft-outputs-fail-strict-schema`, new)

**Evidence (re-verified at 39831497).**
- `agentApiService.ts:136-171` (`buildOutputMetadata`) builds each `outputs` entry as `{ address, amount, outputType,
  isOurs }` and appends change and decoy entries; `submitAgentFundingDraft` passes it at `:388-394` and calls
  `draftService.createDraft` at `:418`.
- `createDraft` validates with `assertValidCreateDraftInput` (`draftCreate.ts:92-96`, called at `:488`) against
  `CreateDraftRequestSchema` (`shared/schemas/draftRequests.ts:40-67`), whose `outputs` items are
  `DraftOutputRequestSchema` = `z.object({ address, amount, sendMax? }).strict()` (`:22-26`). Unknown keys fail the
  parse, and `createDraft` throws `InvalidInputError('recipient, amount, feeRate, and psbtBase64 are required')`; the
  agent route records a rejected attempt (`agentApiService.ts:461`).
- History: the agent shape dates from `8c6ff9fc2` (2026-04-29, "Add requester-only agent wallet setup (#231)"); the
  schemas became strict in `a02748784` (2026-06-04, "Converge draft request schemas"). Every agent funding draft has
  failed since then.
- Observed on the prototype: an agent-shaped body fails `CreateDraftRequestSchema.safeParse` with
  `unrecognized_keys: ["outputType", "isOurs"]` at `outputs[0]`; the same body with `outputs: [{ address, amount }]`
  passes.
- Tests miss it: every agent test mocks `draftService.createDraft` (`agentApiService.test.ts:12`, `:78`;
  `api/agent-wallet-funding-smoke.test.ts:80`); `agentApiService.test.ts:400-424` even pins the extra keys.

**Root cause.** The agent caller's private output shape was never aligned with the shared request schema when the
schema was made strict, and no test runs the agent payload through the real validation.

**Decisions.**
- **D-16.A3a recipient-only outputs.** Delete `buildOutputMetadata` and send `outputs: [{ address: recipient, amount:
  txData.effectiveAmount }]`. Change and decoys already travel in `changeAddress` / `changeAmount` / `decoyOutputs`
  (`:396`, `:406-407`). This is the web send shape, passes the strict schema and A1's rules (vi)–(vii), and stops the
  flow preview listing change and decoys twice. **Residual (review pass 1, A-P1-2): the mobile agent review shows no
  decoy outputs after A3.** Its summary returns `inputs`, `outputs`, `changeAddress`/`changeAmountSats` and the totals
  but no `decoyOutputs` (`server/src/services/mobileAgentDraftService.ts:153-163`). For a decoy agent draft
  `changeAddress` is unset and `changeAmount` is 0 (`createTransaction.ts:186-187`), so the mobile approver sees one
  payment output, change 0, and a `totalOutputSats` larger than payment plus change, with the wallet-owned decoys
  listed nowhere (before A3 they were `outputType: 'decoy'` entries in `outputs`, though no agent draft could be
  created then). The payment, amount, fee and totals the mobile review shows are bound by A1; only the split of the
  wallet-owned remainder is missing. Returning `decoyOutputs` is a response-field change, which the non-goals
  exclude, so it is recorded as P3 `mobile-agent-review--decoy-outputs-not-shown`. The web drafts list and flow
  preview do show the decoys (from `decoyOutputs`). Alternatives rejected: loosening the schema (`.passthrough()`) would
  store arbitrary keys in every caller's draft JSON (and edits `shared/schemas/**`); mapping the extra entries to
  strict entries would display change and decoys as "To:" rows (`DraftRecipientSummary.tsx:12-34`).
- **D-16.A3b ordering.** Committed after A2: once this lands agent drafts are created again, and their cap must
  already be durable.

**Production change** (`agentApiService.ts`, −35/+2; `i16-a3.patch`):
```ts
        // The payment only, in the draft output shape; change and decoys travel in their own fields.
        outputs: [{ address: recipient, amount: txData.effectiveAmount }],
```

**Failing-first tests** (`server/tests/unit/services/agentApiService.test.ts`, 530 → 526 lines):
- New `it('sends createDraft only the payment output, in the strict draft request shape')`: a transaction with change;
  asserts `DraftOutputRequestSchema.array().safeParse(createDraft's outputs).success === true` (import from
  `@sanctuary/shared/schemas/draftRequests`) and `outputs` equals `[{ address: 'tb1qrecipient', amount: 1000 }]`.
- Edit `creates draft metadata for decoys, input defaults, and vault policy hits` (`:400-424`): expected `outputs`
  becomes the one recipient entry, and the expectation gains `changeAddress: 'tb1qchange', changeAmount: 300`.
- **Observed red on base** (`scratchpad/p16a/a1-agent-red.txt`): `Tests 2 failed | 14 passed (16)`; the new case
  `AssertionError: expected false to be true // Object.is equality`; the edited case `AssertionError: expected
  "vi.fn()" to be called with arguments: [ 'funding-wallet', 'user-1', …(2) ]`. Green after: 16/16.

**Green criteria.** `agentApiService.test.ts`, `api/agent-routes.funding.test.ts`,
`api/agent-wallet-funding-smoke.test.ts`, `mobileAgentDraftService.test.ts` green (observed); pinned lizard on
`agentApiService.ts` and its test: rc 0. No coverage branch is added (a function is removed). The signer/hardware
inventory still counts `assertWalletHardwareCapabilityById` once in `agentApiService.ts`
(`npm run verify:signer-inventory`).

**Acceptance.** An agent funding request whose policy checks pass creates its draft (no schema refusal), with only the
payment in `outputs` and change/decoys in their own fields. The mobile agent review then omits the decoys (D-16.A3a
residual, P3).

**Rollback.** Revert the commit; agent funding drafts fail again as at base. Do not revert A2 without A3.

### Phase A verification (worker, phase `a` worktree)

```bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i16-a
cd server
npx tsc --noEmit
npm run typecheck:tests
# A1 + A2 + A3 targeted (one file list; no coverage)
npx vitest run tests/unit/services/draftCreate.test.ts tests/unit/services/draftService.test.ts \
  tests/unit/repositories/draftRepository.test.ts tests/unit/services/agentFundingPolicy.capDurability.test.ts \
  tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts \
  tests/unit/repositories/agentRepository.funding.test.ts tests/unit/services/agentApiService.test.ts \
  tests/unit/services/agentMonitoringService.test.ts tests/unit/services/mobileAgentDraftService.test.ts \
  tests/unit/api/drafts-routes.test.ts tests/unit/api/drafts.test.ts tests/unit/api/openapi.test.ts \
  tests/unit/api/agent-routes.funding.test.ts tests/unit/api/agent-wallet-funding-smoke.test.ts
cd ..
# lizard on every changed file (pinned binary, repo thresholds): zero warnings
/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard -w -l typescript -C 15 -T nloc=200 \
  server/src/services/draftCreate.ts server/src/services/agentApiService.ts server/src/services/draftService.ts \
  server/src/repositories/draftRepository.ts server/src/repositories/agentRepository.ts \
  server/src/services/agentFundingPolicy.ts server/tests/unit/services/draftCreate.test.ts \
  server/tests/unit/services/draftService.test.ts server/tests/unit/services/draftService.delete.contracts.ts \
  server/tests/unit/services/agentApiService.test.ts server/tests/unit/repositories/draftRepository.test.ts \
  server/tests/unit/repositories/agentRepository.test.ts server/tests/unit/services/agentFundingPolicy.test.ts \
  server/tests/unit/services/agentFundingPolicy.capDurability.test.ts \
  server/tests/integration/repositories/agentRepository.sumDraftAmounts.test.ts
node scripts/quality/check-large-files.mjs
npm run verify:signer-inventory                   # "projection is current"
npm run check:wallet-sync-mutation-boundaries     # unchanged callsites
npm run check:safety-catch-guards                 # no catch added
# removed names have no remaining references
if grep -rn "buildOutputMetadata\|sumAgentDraftAmountsSince\|draftRepository\.remove\b\|remove: draftRepository\.remove" \
  server/src server/tests; then exit 1; fi
```
The three script names are in the root `package.json` (`:126`, `:133`, `:157`). The integration cases are the
integrator's (D-16.X2): the A2 reds on a guarded base swap, then green in the full integration run.

### Phase A changelog bullets (integrator, `## [Unreleased]`)

- **Fixed — draft review shows the payments and amount the transaction makes.** Saving a draft now refuses (400
  `metadata_mismatch`) outputs, change, decoy outputs or inputs that differ from the server-issued signing intent,
  an amount that differs from the draft's effective amount, and a consolidation recipient the transaction does not
  pay, so approvers and co-signers can no longer be shown a fabricated payment list or amount. The fee is bound; the
  fee rate shown beside it is still the saving client's estimate, and a consolidation's amount (which pays nothing
  outside the wallet) is still the saving client's figure.
- **Changed — agent funding caps count every accepted request.** Daily and weekly agent funding caps now count every
  accepted funding request in the window, including requests whose drafts are later rejected, expired, invalidated
  or deleted; an owner override allows an exceptional refill. Deleting, expiring or invalidating a draft, or
  broadcasting without one, no longer frees cap. Deleting a broadcast draft now returns 409 `draft_retained` and keeps
  its approval history.
- **Fixed — agent funding drafts can be created again.** Agent funding requests were refused by the stricter draft
  request schema since June; they now send their payment in the standard output shape.

## Phase B — AI transaction filter counts the rows the list renders (B1)

One finding, one worktree (`/home/nekoguntai/sanctuary-bug-scrub-20261013-i16-b`), one commit. Frontend only.
Every file:line below was re-verified at `39831497382d`. The fix and red tests were prototyped in
`scratchpad/p16b/tree`; the production diff is `scratchpad/p16b/prod.diff`.

| Phase | Production files | Test files | Other |
|---|---|---|---|
| b | **B1:** `src/components/WalletDetail/hooks/useAITransactionFilter.ts`, `src/components/WalletDetail/tabs/TransactionsTab.tsx`, `src/components/WalletDetail/tabs/TransactionsTab/AiFilterSummary.tsx` | **B1:** `tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts` (494 → 544 lines), `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx` (449 → 488 lines) | changelog bullet (integrator) |

### Phase B1 — AI sum/count/max/min, "Showing X of Y" and top-N limit skip RBF-replaced rows (P2 `ai-transaction-filter--aggregates-include-rbf-replaced-rows`; defence in depth, OQ-B1)

**Evidence (re-verified on 39831497382d).**
- `src/components/WalletDetail/hooks/useAITransactionFilter.ts:200-225`: `applyAITransactionFilter` copies the
  input (`[...transactions]`, `:208`), then filters (`:210-213`), sorts (`:215-218`) and slices to `limit`
  (`:220-222`). It never checks `rbfStatus`. `computeAIAggregationResult` (`:227-249`) sums, counts, maxes or mins
  `Math.abs(amount)` over that result. The hook memoizes both (`:274-281`).
- The hook's input is `manuallyFiltered`, the manual-filter output over the loaded `transactions`
  (`useWalletDetailController.ts:140-162`). Its outputs go through `WalletDetailLoadedView.tsx:75-80` to
  `TransactionsTab`.
- `TransactionsTab.tsx:104-118` passes `filteredTransactions` to `<TransactionList>`. `TransactionList` drops replaced
  rows before rendering rows and tiles (`TransactionList/hooks/useTransactionList.ts:77`, via
  `excludeReplacedTransactions` at `TransactionList/displayedTransactions.ts:8-10`).
- `TransactionsTab.tsx:92-99` passes the raw `filteredTransactions` and `transactions` to `AiFilterSummary`. That
  component prints:
  - `Showing {filteredTransactions.length} of {transactions.length}` (`AiFilterSummary.tsx:49`);
  - `over the {transactions.length} loaded transactions` (`:44`);
  - the aggregate (`:40`).
- Iteration 13 (D-13.B2b, `tasks/bug-scrub-loop-20261013-iteration13.md:814-822`) introduced
  `excludeReplacedTransactions`. It used the helper only for the manual partial notice (`TransactionsTab.tsx:54-60`).
  It explicitly left "`AiFilterSummary`'s own count … also counts RBF-replaced rows" out of scope. This finding is that
  leftover.
- Consumers of the AI result: `filteredTransactions` feeds only `TransactionList` (`:105`). `AiFilterSummary` counts
  it. `aiAggregationResult` feeds only `AiFilterSummary`. Nothing else uses the AI result: export
  (`onShowTransactionExport`), labels and `selectionTransactions` (`:106`) read the raw `transactions`. Grepping
  `filteredTransactions|aiAggregationResult|aiQueryFilter` under `src/components/WalletDetail` finds no other reader.
- Tests do not cover this. `tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts` has no
  `rbfStatus` fixture. The `TransactionsTab.test.tsx` replaced-row cases (`:339-368`) cover only the manual notice.
- **Reachability (decides OQ-B1: not reachable with current server data; the fix is defence in depth).** The server
  never returns a replaced row to this list:
  - `GET /wallets/:id/transactions` builds `rbfStatus: { not: "replaced" }`
    (`server/src/api/transactions/walletTransactions/listTransactions.ts:63`, in the where builder `:61-66`).
  - The repository forces it again: `findByWalletIdWithDetails` and `findByWalletIdsWithDetails` →
    `withLiveTransactionWhere` (`server/src/repositories/transactions/core.ts:523`, `:543`; `visibility.ts:21-33`,
    #1262).
  - Contract tests pin both (`server/tests/unit/api/transactions/transactions.wallet-ledger.contracts.ts:307-320`,
    `transactionsHttpRoutes.reads.contracts.ts:110`).

  The client never writes `rbfStatus` locally:
  - `formatApiTransaction` copies it from the API (`WalletDetail/mappers.ts:31`).
  - The only in-place list mutation is the confirmations patch (`useWalletWebSocket.ts:104-110`).
  - Every refresh replaces the list with page 1 (`useWalletData.ts:365-433`; `usePaginatedList.replaceItems`).

  A send that is fee-bumped after it loaded stays in the list as a stale non-`replaced` row. Both the list and the AI
  filter show it, so they agree. **The trigger in the finding ("original row stays in the loaded page with
  rbfStatus 'replaced'") cannot be produced by the shipped data path today.** The defect is a latent consistency gap.
  It becomes live only if a future loader (for example a pending-tx merge, or an audit-history view that reuses
  `TransactionsTab`) passes replaced rows through. `TransactionList`'s own exclusion (i13) is the same kind of guard.

**Root cause.** Two layers decide what counts as a "row" independently. `TransactionList` removes replaced rows when it
renders (`displayedTransactions.ts`). The AI hook and `AiFilterSummary` count, slice and aggregate the input before that
removal. i13 aligned only the manual notice with the render layer.

**Decisions.**
- **D-16.B1a — exclude replaced rows at the start of the AI pipeline, only while an AI transaction filter is active.**
  In `applyAITransactionFilter`, replace `let result = [...transactions];` with
  `let result = excludeReplacedTransactions(transactions);`. The helper is i13's, imported from
  `../../TransactionList/displayedTransactions`. It returns a new array, so the in-place `sort` stays safe.
  - Filter, sort, `limit` and the aggregation then run over exactly the rows `TransactionList` renders. A fee-bumped
    send counts once, and top-N gets N rows.
  - With no AI filter (or `type !== 'transactions'`), the early return still hands back the input array unchanged.
    `TransactionList` still drops replaced rows itself, and the default render path keeps its memo identity.
  - Rejected: **excluding in `useWalletDetailController` before both filter hooks.** The raw `transactions` also
    feed `selectionTransactions`, label editing, the highlight and `useTransactionResolution`, which reads
    `localTx?.rbfStatus === 'replaced'` (`useTransactionResolution.ts:229`) to close a replaced tx's tab. It would also
    change the manual-filter identity that i13's counts rely on. That is a larger blast radius for no gain.
  - Rejected: **excluding only inside `computeAIAggregationResult`.** The sum would be fixed, but `limit` would still
    slice before the list hides rows (top-5 shows 4), and "Showing X" would still be wrong.
  - Rejected: **moving AI filtering to the server.** The same reasons as D-13.B2a apply, and the server list
    already excludes replaced rows.
- **D-16.B1b — `AiFilterSummary` takes counts, not arrays, from the i13 displayed counts.** Replace the props
  `filteredTransactions: Transaction[]` and `transactions: Transaction[]` with `shownCount: number` and
  `loadedCount: number`. The doc comments match `ManualFilterPartialNotice.tsx:5-7`. `TransactionsTab` passes
  `shownCount={displayedFilteredCount}` and `loadedCount={displayedLoadedCount}`, which already exist at `:56-60`.
  - "Showing {shownCount} of {loadedCount} …" and "over the {loadedCount} loaded transactions" now use the same
    numbers as the manual notice and the server `totalCount` (live rows only).
  - The denominator fix is needed independently of D-16.B1a: the raw `transactions` still hold the replaced row.
  - Rejected: re-filtering inside `AiFilterSummary`. That would add a second owner of the "displayed rows" rule.
  - Exact text is unchanged, so no copy review is needed.
- **D-16.B1c — out of scope.**
  - The "Partial result" label decided from raw `hasMoreTx` rather than `isFilterResultPartial` is the existing
    backlog P3 `ai-filter-summary--partial-label-on-exact-page-multiple` *(coordinator, at assembly: replaces the
    drafted duplicate id `ai-filter-summary--partial-label-ignores-known-total`)*.
  - `ai-transaction-filter--aggregation-runs-on-non-transaction-result-types` (new P3, latent). When
    `type !== 'transactions'`, the hook still aggregates over the unfiltered input.
    `llm-egress-proxy/src/naturalQuery.ts:196` always emits `type: "transactions"`, so this cannot be reached today.
  - No other aggregation shares the replaced-row issue:
    - the stats tiles use server `getTransactionStats` (live rows);
    - export uses `exportPage.ts`, which applies `liveTransactionSql` and is pinned by
      `transactionsHttpRoutes.exports.contracts.ts:73`;
    - the Dashboard and cross-wallet lists use `crossWallet.ts:163-167`, `:279-282` plus `withLiveTransactionWhere`;
    - the assistant reads use `assistantRead/transactionReads.ts:42`;
    - the natural-query proxy returns a spec and computes nothing.

**Failing-first tests (prototyped in `scratchpad/p16b/tree`).**
- `tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts`: append
  `describe('RBF-replaced rows the list hides', …)`. The fixture `replacedOriginal` is the fee-bumped original of
  `txid-2`: `{ id: 'tx-2-original', txid: 'txid-2-original', type: 'sent', amount: -100_000, confirmations: 0,
  timestamp: 1_700_000_050, labels: [{ name: 'groceries' }], rbfStatus: 'replaced' }`, and
  `withReplaced = [...transactions, replacedOriginal]`.
  1. **"counts a fee-bumped send once in AI sum, count, max and min"**. For each aggregation, set
     `{ type: 'transactions', filter: { type: 'send' }, aggregation }` and expect `filteredTransactions` txids to equal
     `['txid-2']`, with sum 12_000, count 1, max 12_000 and min 12_000.
     **Red on base (observed):** `AssertionError: expected [ 'txid-2', 'txid-2-original' ] to deeply equal [ 'txid-2' ]`.
  2. **"fills a top-N limit from rows the list renders"**. Set `sort: amount desc` and `limit: 2`, and expect
     `['txid-3', 'txid-1']`.
     **Red on base (observed):** `expected [ 'txid-2-original', 'txid-3' ] to deeply equal [ 'txid-3', 'txid-1' ]`.
  3. Guard: **"passes the loaded list through untouched while no AI filter is active"**. `filteredTransactions`
     `toBe(withReplaced)` (identity), and the aggregation is `null`. Green on base and after the fix.
- `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx`: add `describe('AI summary counts only rows the list
  renders', …)` before `describe('manual filters over loaded pages only'`. The fixture is
  `replacedRow = { id: 'tx-3', txid: 'ghi', walletId: 'wallet-1', amount: -60, timestamp: Date.now(), type: 'sent',
  rbfStatus: 'replaced' }`.
  4. **'says "Showing X of Y" without RBF-replaced rows'**. Set `aiQueryFilter={{ type: 'transactions', aggregation:
     null }}` and `hasMoreTx={false}`, and append `replacedRow` to both `transactions` and `filteredTransactions`.
     Expect `getByText('Showing 1 of 2 transactions')`.
     **Red on base (observed):** `TestingLibraryElementError: Unable to find an element with the text: Showing 1 of 2
     transactions` (base renders "Showing 2 of 3").
  5. **"names the displayable loaded count in the partial aggregate notice"**. Set `aggregation: 'sum'`,
     `aiAggregationResult={12345}` and `hasMoreTx`, and append `replacedRow` to `transactions`. Expect
     `ai-filter-partial-notice` to contain "over the 2 loaded transactions; older transactions are not included".
     **Red on base (observed):** the text holds "3".
- Confirm red: `npx vitest run --config config/tooling/vitest.config.ts
  tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts tests/components/WalletDetail/tabs/TransactionsTab.test.tsx`
  → observed **4 failed** (cases 1, 2, 4, 5), all others green.
- Existing tests that encode the old behaviour: **none**. The existing `TransactionsTab` AI cases (`:199-213`,
  `:280-325`) use fixtures with no replaced row, so their counts are unchanged. `AiFilterSummary` has no direct test
  file (only `TransactionsTab.test.tsx` renders it), so the prop rename touches no other test.

**Green criteria (observed in p16b).** After D-16.B1a and B1b, the two files gave `Tests 55 passed`. The two files
plus `tests/components/TransactionList` gave `21 files | 303 passed`. The whole `tests/components/WalletDetail`
directory gave `Test Files 67 passed (67) | Tests 929 passed (929)`.

**Coverage (100% frontend gate).**
- `applyAITransactionFilter`: the new line runs on every active-filter path. Both predicate outcomes of
  `excludeReplacedTransactions` are exercised by cases 1-2 and by the existing i13 tests.
- `AiFilterSummary` and `TransactionsTab` gain no branch: prop substitution only.
- Integrator: the frontend coverage gate must show 100% statements, branches, functions and lines on the three files.

**Lizard / size / architecture.**
- Pinned lizard `-w -l javascript -l typescript -l tsx -C 15 -T nloc=200` on all five files gives **0 warnings**, base
  and after. `applyAITransactionFilter` is CCN 7, NLOC 18; `TransactionsTab` is CCN 9, NLOC 72.
- Test files stay at 544 and 488 lines (< 1000). `scripts/quality/check-large-files.mjs` exits 0.
- One new import edge, inside an existing collapsed edge (D-16.X8).
- No Stryker or mutation-map pin references these files. `src/components/WalletDetail/**` is a wallet-safety
  critical path (`config/wallet-safety-critical-paths.json:107`): verify-vectors runs (D-16.X6).

**E2E / Playwright / render-regression.** No impact (D-16.X7). The integrator's static Playwright run is
regression-only and must leave every PNG baseline unchanged.

**Compatibility.** No API, stored state or copy change; with no AI filter the render path is unchanged (same array
identity).

**Acceptance.** While an AI transaction query is active:
- the aggregate, "Showing X of Y" and top-N all count exactly the rows `TransactionList` renders;
- a fee-bumped send counts once;
- `limit: N` yields N visible rows when N exist;
- the AI banner's loaded count equals the manual partial notice's count.

**Rollback.** Revert the commit (three production edits and two test blocks). No stored state.

### Phase B verification (worker, phase `b` worktree)

```bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i16-b
npx vitest run --config config/tooling/vitest.config.ts tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts tests/components/WalletDetail/tabs/TransactionsTab.test.tsx
npx vitest run --config config/tooling/vitest.config.ts tests/components/WalletDetail tests/components/TransactionList
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npx eslint --config config/tooling/eslint.config.js src/components/WalletDetail/hooks/useAITransactionFilter.ts src/components/WalletDetail/tabs/TransactionsTab.tsx src/components/WalletDetail/tabs/TransactionsTab/AiFilterSummary.tsx
/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard -w -l javascript -l typescript -l tsx -C 15 -T nloc=200 \
  src/components/WalletDetail/hooks/useAITransactionFilter.ts src/components/WalletDetail/tabs/TransactionsTab.tsx \
  src/components/WalletDetail/tabs/TransactionsTab/AiFilterSummary.tsx \
  tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts tests/components/WalletDetail/tabs/TransactionsTab.test.tsx   # expect no output
node scripts/quality/check-large-files.mjs
```
Prototype note: `typecheck:tests` on the scratch copy printed only `server/src/utils/errors.ts: Cannot find module
'../generated/prisma/client'` (no generated client there); a real worktree runs `prisma generate` first (D-16.X1).

### Phase B changelog bullet (integrator, `## [Unreleased]` → `### Fixed`)

- AI transaction queries in the wallet Transactions tab now count only the transactions the list shows. A fee-bumped
  (RBF-replaced) original no longer adds to "total sent", count, max or min, no longer takes a slot in a "top N"
  result, and is no longer counted in "Showing X of Y" or the loaded-transactions notice. (The server does not return
  replaced rows today; this keeps the AI summary consistent with the list if a future view does.)

## Phase C — CI failure breadcrumb and cleanup terminal state (C1, C2)

Two findings, one phase, one worktree (`/home/nekoguntai/sanctuary-bug-scrub-20261013-i16-c`, branch
`codex/bug-scrub-loop/20261013-i16-c`, never `/tmp`), one commit per finding (C1 first, then C2; they share no file).

| Phase | Production files | Test files | Other |
|---|---|---|---|
| c | **C1:** `scripts/ci/write-empty-diagnostic-breadcrumb.sh`, `scripts/ci/run-psbt-core-subject.sh`. **C2:** new `scripts/ownership/cleanup-terminal-state.mjs`, `scripts/ownership/cleanup-execution.mjs`, `scripts/ownership/cleanup-execution-receipt.mjs`, `scripts/ownership/execution-receipt-schema.mjs`, `scripts/ownership/cleanup-journal-protocol.mjs` | **C1:** `tests/ci/write-empty-diagnostic-breadcrumb.test.sh`, `tests/ci/psbt-core-subject.test.mjs`, `tests/ci/check-workflow-composition.test.sh` (one new `assert_contains_in_order` block only). **C2:** new `tests/ownership/cleanup-terminal-state.test.mjs`, `tests/ownership/cleanup-execution-receipt.test.mjs` (the privacy-scan test's fixture only, `:259-270`) | **C2:** `docs/reference/resource-ownership-cleanup.md` (one sentence in "Receipt interpretation") |

Read-only for phase `c`: `.github/workflows/verify-vectors.yml` and every other file in
`scripts/verify-addresses/sourceManifest.ts` `VERIFIER_SOURCE_FILES` (`:2-37`; provenance-pinned, D-16.C1e),
`.github/workflows/quality.yml`, `.github/workflows/test.yml`, `tests/ownership/cleanup-execution.test.mjs`,
`config/resource-lifecycle-callsites.json`, `scripts/quality/large-file-classification.json`, `scripts/verify-psbt/**`.

Everything below was reproduced on a scratch copy of `39831497382d1f77f90eab7383839c5373ae1a4c` (`p16c`, a `tar` copy
with a fresh `git init` so `git diff --exit-code` inside the PSBT proof works) and a base copy with only the new and
edited tests dropped in (`p16c-red`), node v24.21.0, lizard 1.24.0. Prototype diffs (guidance; this text governs):
- `scratchpad/plan16-C1-prototype.patch` (C1: breadcrumb, PSBT subject, three test files);
- `scratchpad/plan16-C2-prototype.patch` (C2: new rule module, four consumers, two test files; the docs sentence is
  not in the patch).
Red and green runs: `scratchpad/p16c-tools/{c1-breadcrumb,c1-psbt,c2}-{red,green}.txt`.

### Phase C1 — The failure breadcrumb stops calling an unwrapped verification failure a post-verification fault (P2 `ci-diagnostics--breadcrumb-labels-step-timeout-as-post-verification-fault`, recurrence)

**Evidence (re-verified on `39831497`).**
- **What the i12 fix covered.** `20361d62b` (iteration 12, D-12.C2) added `list_incomplete_logs`
  (`scripts/ci/write-empty-diagnostic-breadcrumb.sh:103-125`): a `*.log` without a readable sidecar is reported as
  "never finished … not as a post-verification infrastructure fault" (`:146-162`). That only works when the failing
  step had already **created** its run-with-log.sh log.
- **The remaining verdict.** With no failed sidecar and no unfinished log, any exit-0 sidecar selects `:163-177`:
  "All N captured verification step(s) succeeded (wrapped_exit 0); this job failure is a post-verification
  runner/infrastructure fault -- not a proof regression".
- **The live instance.** `.github/workflows/verify-vectors.yml:407-417` ("Run receipt-bound live Bitcoin Core PSBT
  proof", `timeout-minutes: 25`) is a bare `run: |` that calls `cleanup-ci-callsite.sh run … --
  scripts/ci/run-psbt-core-subject.sh live`. The subject then does real verification work with no log:
  - `run-psbt-core-subject.sh:144` `create_core` (`docker pull`, `docker create`, exact-identity recovery,
    ownership registration);
  - `:145` `attest_and_start_core` (image-ID and repository-digest attestation, `:70-85`; the supply-chain check);
  - `:146-149` RPC-port read and `wait_for_core` (up to 60 × 2 s, `:87-101`);
  - only then `:150` → `run_live_proof`, whose first `run-with-log.sh` is `:108` (`live-psbt-proof.log`).
- Earlier steps in the same job leave exit-0 sidecars (`install-server-dependencies.log`, `psbt-bip174-tests.log`,
  the address-verifier and unit-test logs, `verify-vectors.yml:271-405`). So a digest-attestation failure, an
  image-ID drift, a readiness timeout, or a kill at the 25-minute step bound all reach "Write vector failure
  breadcrumb" (`:449-457`, `if: failure()`) with N > 0 and no unfinished log, and the operator is told the proof
  passed and the fault is infrastructure.
- **Why tests miss it.** `tests/ci/write-empty-diagnostic-breadcrumb.test.sh:176-177` (case 3) and `:265`, `:283`
  (guards 8, 9) pin "not a proof regression" whenever exit-0 sidecars exist and no log is unfinished. No case covers
  a failing step that never created a log.

**Workflow sweep (every workflow, CLAUDE.md batch rule).** A YAML walk of every job that runs
`write-empty-diagnostic-breadcrumb.sh` (quality.yml: 13 jobs; test.yml: `full-backend-unit-coverage-shards`;
verify-vectors.yml: 7 jobs), listing each step before the breadcrumb that does work outside `run-with-log.sh` after
the job's first wrapped step (the only position where the false verdict can fire). Script:
`scratchpad/p16c-tools/sweep.mjs`.

| Job | Unwrapped work after the first wrapped step | Disposition |
|---|---|---|
| quality.yml × 13, test.yml × 1 | none (only `uses:` upload actions, which run after the verdict could matter) | D-16.C1a wording |
| verify-vectors `verify-vectors` | "Verify Go toolchain" action (`:208`); `subject-budget.mjs step-deadline` preambles of "Run pinned Jade vendor protocol harness" (`:227`) and "Run cross-implementation address verifier" (`:276`); three "Verify … cleanup receipt" actions (`:231`, `:288`, `:419`); **the live PSBT step (`:407-417`), whose create/attest/wait is verification work** | D-16.C1a for all; **D-16.C1b** for the PSBT step |
| verify-vectors `verify-trezor-emulator`, `verify-ledger-emulator`, `verify-jade-emulator` | the `step-deadline` preamble of the proof step (`:747`, `:872`, `:997`); the "Verify … cleanup receipt" actions (`:754`, `:879`, `:1004`) | D-16.C1a |
| verify-vectors `verify-vectors-mutation-binding`, `-mutation-fee`, `determine-verify-scope` | none | — |

`step-deadline` exits 124 ("subject budget exhausted", `scripts/ci/subject-budget.mjs:38-40`, `:52-54`) when the
job budget is spent, so the proof never started: also not "verification passed". The steps before any wrapped step
(`Capture job budget origin`, `Observe hardware emulator scope`, `Verify wallet-safety classifier completeness`, …)
already get the generic wording (N = 0).

**Root cause.** Succeeded sidecars prove that **no wrapped step failed**. The breadcrumb reads them as proof that
**verification finished**. Any failing work outside `run-with-log.sh` — a verification preamble, a budget check, a
receipt-verification action — is indistinguishable, from the diagnostic directory alone, from the #1009 runner copy
fault. The i12 fix narrowed the false verdict to "steps that never created a log" but kept the verdict.

**Decisions.**
- **D-16.C1a — The breadcrumb names possibilities, not a verdict.** Replace the `:163-177` heredoc (unquoted
  heredoc: plain text only, no backticks; i12 pass-5 rule) with:

  ```
  No captured step failed or was interrupted: all $SUCCEEDED_SIDECARS run-with-log.sh
  step(s) exited 0. The failing step therefore ran outside run-with-log.sh.
  That can be the unwrapped part of a verification step: a subject budget
  check, cleanup coordinator setup or teardown, or a container create,
  image attestation or readiness wait before the step's first log. It can be
  a cleanup receipt verification or another action. Or it can be a
  post-verification runner/infrastructure fault, such as the runner's
  container-to-host artifact copy (SUMMARY.md, GITHUB_PATH) timing out against
  a hung podman/docker socket (sanctuary#1009).

  Find the failed step in the Forgejo task output before any retrigger. A failed
  verification, receipt or setup step is that step's failure; only a failure
  after the last verification step is a runner/infrastructure fault.
  ```

  followed by the existing two "Inspect the Forgejo task output …" lines. The `:77-82` comment is rewritten to say
  why (succeeded sidecars do not prove verification finished). "not a proof regression" and "this job failure is a
  post-verification runner/infrastructure fault" disappear from the script. The interrupted branch (`:146-162`), the
  generic branch, the sidecar (`wrapped_exit: 1`), the exit status and the arguments are unchanged. This fixes every
  row of the sweep table without touching a workflow. Per C-Q1 no positive runner-fault verdict is kept (P3
  `ci-diagnostics--breadcrumb-no-verification-complete-marker`).
- **D-16.C1b — The PSBT Core preamble becomes its own run-with-log.sh step.** In `run-psbt-core-subject.sh`
  (not provenance-pinned):
  - `mode` also accepts the internal values `setup-live` / `setup-regenerate` (the coordinator guard `:9-12`, the
    image/`DIAGNOSTIC_DIR` checks and the label setup still run first). In a `setup-*` mode the script runs
    `create_core`, `attest_and_start_core`, `rpc_port="$(core_rpc_port …)"`, `wait_for_core`, and exits 0.
  - The normal path runs `"$SCRIPT_DIR/run-with-log.sh" "$DIAGNOSTIC_DIR/psbt-core-setup-$mode.log"
    "$SCRIPT_DIR/run-psbt-core-subject.sh" "setup-$mode"`. On a non-zero exit it prints one line to stderr,
    `PSBT Core setup failed (exit N); see $DIAGNOSTIC_DIR/psbt-core-setup-$mode.log`, and exits with that status
    (create's own status, e.g. 23, is preserved as today).
  - The hand-off is the cidfile the setup already writes and verifies (`:53`): the parent reads it, requires
    `^[0-9a-f]{64}$`, and re-derives the port with the new `core_rpc_port` helper (the old `:146-147` inspect and
    `case` check moved verbatim into it). Then `run_live_proof` / `run_regenerate_proof` as today.
  - Effect: an attestation or create failure leaves `psbt-core-setup-live.log` with `wrapped_exit` ≠ 0, so the
    breadcrumb exits "failed diagnostic sidecar already exists; breadcrumb not needed" and
    `write-diagnostic-summary.sh` prints that log into the job output. A kill at the step timeout during setup has
    two outcomes. On SIGTERM or SIGINT, run-with-log.sh's trap (`run-with-log.sh:140-155`) writes a best-effort
    interrupted sidecar (`wrapped_exit: -1`, `sink_status: "interrupted"`); the breadcrumb's `has_failed_sidecar`
    (`write-empty-diagnostic-breadcrumb.sh:59-75`, `:127-130`) treats any non-zero `wrapped_exit` as failed and
    exits "breadcrumb not needed", and the summary shows the setup log as failed. On a hard kill (SIGKILL) or a lost
    runner no sidecar is written, the log is left never-finished, and the i12 "never finished … not as a
    post-verification infrastructure fault" branch fires. run-with-log.sh creates the log before running the command
    (`run-with-log.sh:96-98`), which the new test pins.
  - Nothing else moves: one `docker create` (lifecycle creation count 1,
    `scripts/ownership/check-lifecycle-callsites.mjs`), no `docker rm|stop|kill`, every
    `tests/scripts/verifyPsbtProvenance.test.ts:80-91` and `tests/ci/check-workflow-composition.test.sh:3057-3097`
    needle still present (verified green).
  - Output of the preamble (`docker pull` progress, attestation messages, `docker logs` on a readiness timeout) is
    now in the setup log, not live in the Forgejo step output; run-with-log.sh forwards only annotations, the same
    as every other wrapped step. The failure pointer line and the summary step keep the reason visible.
- **D-16.C1c — A static pin.** `tests/ci/check-workflow-composition.test.sh` gains one `assert_contains_in_order`
  on `$PSBT_SUBJECT` (inserted before the `for forbidden_cleanup` loop, `:3089`): `attest_and_start_core
  "$container_id"` → `"$SCRIPT_DIR/run-with-log.sh" "$DIAGNOSTIC_DIR/psbt-core-setup-$mode.log"` → `if [ "$mode" =
  live ]; then run_live_proof; else run_regenerate_proof; fi`.
- **D-16.C1d — Rejected alternatives.**
  - A per-step start marker (`run-with-log.sh` or a `: >"$DIAGNOSTIC_DIR/<step>.log"` line) in every workflow step:
    needs edits to `verify-vectors.yml` (provenance-pinned, D-16.C1e) and to ~20 steps, for a diagnostics-only change.
  - Wrapping the whole PSBT step in `run-with-log.sh` in the workflow: same pinned file.
  - Inferring the failed step from step names or timestamps in the breadcrumb: the script receives no step identity,
    and `steps.<id>.outcome` exists only for steps with ids.
  - Deleting only the phrase "not a proof regression" and keeping "this job failure is a post-verification … fault":
    still a false verdict for the PSBT preamble and the receipt actions.
  - Wrapping only the attestation call: a readiness or create failure, or a kill during the pull, would still be
    unlogged.
- **D-16.C1e — No provenance-pinned file is edited.** `scripts/verify-addresses/sourceManifest.ts:2-37` pins
  `.nvmrc`, `.github/workflows/verify-vectors.yml` and `scripts/ci/docker-endpoint-lib.sh` (plus the verifier
  sources); neither C1 file is in it. `npx vitest run --config config/tooling/vitest.config.ts
  tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts` on the patched scratch
  copy: 15/15. No vector regeneration.

**Failing-first tests.**
- `tests/ci/write-empty-diagnostic-breadcrumb.test.sh` (300 → 327 lines):
  - **new case 10** `unwrapped verification preamble after successful steps: no proof-passed verdict`: exit-0
    sidecars for `install-server-dependencies.log` and `psbt-bip174-tests.log`, no other log. Expects:
    `assert_not_contains` "not a proof regression" and "this job failure is a post-verification";
    `assert_contains` "image attestation" and "Find the failed step"; sidecar `"wrapped_exit": 1`.
    **RED on base:** `… verify-vectors-failure.log unexpectedly contains 'not a proof regression'` (4 assertions).
  - **case 3** (`:171-177`): the two "captured verification step(s) succeeded" / "not a proof regression"
    assertions become `assert_contains "outside run-with-log.sh"`, `assert_contains "sanctuary#1009"` (the runner
    fault stays named) and `assert_not_contains "not a proof regression"`. **RED on base** (3 assertions).
  - **guards 8 and 9** (`:255-286`): `assert_contains … "not a proof regression" "infra wording"` becomes
    `assert_contains … "outside run-with-log.sh"`; case 8's title becomes "keeps the unwrapped-step wording".
    The `never finished` negatives are unchanged. **RED on base** (one assertion each).
  - Base run: `Total: 15, Passed: 6, Failed: 9` (four cases, nine failed assertions; the suite totals passed plus
    failed assertions). Fixed: `Total: 10, Passed: 10`.
- `tests/ci/psbt-core-subject.test.mjs` (259 → 313 lines; fake `docker pull` additionally appends `setup log present
  at pull` to `$DOCKER_LOG` when `$DIAGNOSTIC_DIR/psbt-core-setup-$PSBT_MODE.log` exists; `fixtureEnv` sets
  `PSBT_MODE: 'live'`; helpers `setupLog`, `setupSidecar`):
  1. `live PSBT Core setup runs as its own step log before the first Docker call` and the `regenerate` twin:
     status 0, `calls[1] === 'setup log present at pull'`, setup sidecar `wrapped_exit === 0`.
     **RED on base:** `Expected values to be strictly equal` (the marker line is absent).
  2. `a failed PSBT Core attestation leaves a failed setup step, so the job breadcrumb is not needed`: repository
     digest drift, an exit-0 `psbt-bip174-tests.log` sidecar already in `DIAGNOSTIC_DIR`; expects status 1, the setup
     log contains `does not attest expected digest`, its sidecar `wrapped_exit === 1`, and running the real
     `write-empty-diagnostic-breadcrumb.sh` on that directory prints `failed diagnostic sidecar already exists;
     breadcrumb not needed` and writes no `verify-vectors-failure.log`.
     **RED on base:** `ENOENT … diagnostics/psbt-core-setup-live.log`.
  - Existing test changed: `PSBT successful create rejects a valid foreign ID …` (`:186-188`) reads the message from
    `setupLog(env, 'live')` instead of `result.stderr` (it moved into the setup log). **RED on base** with the same
    ENOENT. All other existing cases are unchanged and green (their status codes, including 23, survive the wrapper).
  - Base run: `pass 8, fail 4`. Fixed: `12/12`. (The base copy must be a git work tree: the live proof's
    `git diff --exit-code` fails in a plain directory and fakes a fifth red.)
- `tests/ci/check-workflow-composition.test.sh`: the D-16.C1c block fails on base (needle absent) and passes after;
  full suite green on the scratch copy (rc 0).

**Confirm RED first** (phase `c` worktree at the plan commit, tests edited, scripts not yet edited):
```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
bash tests/ci/write-empty-diagnostic-breadcrumb.test.sh      # red: cases 3, 8, 9, 10 (Passed 6, Failed 9)
node --test tests/ci/psbt-core-subject.test.mjs              # red: pass 8, fail 4
```

**Green criteria.** Breadcrumb suite 10/10; PSBT subject suite 12/12; composition suite rc 0;
`verifyAddressesGenerated` + `verifyPsbtProvenance` 15/15; on the PR, a green "Run receipt-bound live Bitcoin Core
PSBT proof" with a `psbt-core-setup-live.log` and exit-0 sidecar in the `ci-diagnostics-verify-vectors` artifact.

**Registry and gate impacts.**
- `config/resource-lifecycle-callsites.json` keys `tests/ci/psbt-core-subject.test.mjs` (`:2007`) and
  `tests/ci/write-empty-diagnostic-breadcrumb.test.sh` (`:2301`) by path; the new `mkdtempSync`/`rmSync` and
  `mktemp -d`/`rm -rf` uses reuse the registered patterns. `node scripts/ownership/check-lifecycle-callsites.mjs`:
  "registry is complete (416 lifecycle identities …)" on the scratch copy after `git add`.
- No new workflow step, so no `actions/checkout` question; no workflow file changes at all.
- `node scripts/ci/check-negated-test-assertions.mjs`: clean. `node scripts/ci/check-wallet-safety-classifier.mjs`,
  `node scripts/ci/hardware-emulator-source-inventory.mjs validate`, `node --test
  tests/ci/check-wallet-safety-classifier.test.mjs` (10/10): green.
- Large files: `psbt-core-subject.test.mjs` 313 lines; the `.sh` suites are not in the code-file gate.

**CI lanes.**
- **Verify Bitcoin Vectors** runs on this PR (any non-documentation path, `scripts/ci/classify-verify-vectors-scope.sh:140-147`).
  It runs `tests/ci/psbt-core-subject.test.mjs` (`verify-vectors.yml:217-221`) **and the real live PSBT step**
  through the new setup wrapper on a fleet host, so a green "Run receipt-bound live Bitcoin Core PSBT proof" plus a
  `psbt-core-setup-live.log` with an exit-0 sidecar in `ci-diagnostics-verify-vectors` is the end-to-end proof.
  Check the artifact for that file.
- **CI classifier tests** (`quality.yml` `ci-classifier-tests`, `:970`, `:973`) run the breadcrumb and composition
  suites; `scripts/ci/*` and `tests/ci/*` route there (`classify-quality-scope.sh:107`).
- **Not exercised by CI:** the `regenerate` mode (`verify-vectors.yml:1220`, `workflow_dispatch` with
  `regenerate_psbt`) — covered by the `regenerate` unit case; and the breadcrumb's new branch on a real failure
  (only a red run writes it) — covered by the unit cases. No dispatch is required.

**Lizard.** No JavaScript production change in C1; the test file adds no warning.

**Compatibility.** Diagnostics-only change in the breadcrumb text; the PSBT subject's exit codes, arguments and
Docker calls are unchanged; the preamble's output moves into its own log.

**Acceptance.** No breadcrumb this repo can write contains "not a proof regression". A PSBT Core create, attestation
or readiness failure leaves a failed `psbt-core-setup-<mode>.log`. A step-timeout SIGTERM/SIGINT during it leaves an
interrupted sidecar (`wrapped_exit: -1`, so the setup log reads as failed and the breadcrumb is not needed); only a
hard kill or a lost runner leaves a never-finished log (the i12 branch). The
PR's verify-vectors run is green with the new setup log present.

**Rollback.** Revert the C1 commit; the breadcrumb returns to the i12 wording and the subject to one unlogged
preamble. No artifact or state to undo.

### Phase C2 — One terminal-state rule for cleanup executions (P2 `cleanup-receipt--failed-first-action-terminal-state-mismatch-deadlocks`)

**Evidence (re-verified on `39831497`).**
- **Four copies of the rule.**
  - Executor: `scripts/ownership/cleanup-execution.mjs:61-70` `executionTerminalOutcome(results, recovered,
    cancelled)` (also used by recovery, `cleanup-recovery.mjs:180`, `:213`, `:221`, and
    `operator-recovery-session.mjs:16`).
  - Signed journal: `scripts/ownership/cleanup-journal-protocol.mjs:263-273` `terminalOutcome(state)`, enforced at
    the terminal checkpoint (`:279`). Same rule as the executor, with `cancellationSeen` / `recoverySeen`.
  - Receipt core: `scripts/ownership/cleanup-execution-receipt.mjs:231-280` `expectedTerminalStates`, called from
    `buildExecutionReceiptCore` → `validateExecutionReceiptCore`.
  - Receipt schema: `scripts/ownership/execution-receipt-schema.mjs:62-83` `stateCandidates` (`:146`), used by
    `validateArtifact`, i.e. by `verifySignedArtifact` and `verify-ci-cleanup-upload.mjs` (the "Verify … cleanup
    receipt" action).
  - The last two see only receipt rows and diverge from the first two.
- **Divergence 1 (the finding).** `cleanup-action-runner.mjs:305-316` `classify` gives `failed`/`mutation_failed`
  when a mutation fails but reconciliation finds the target absent or satisfied; `:488-500` then records every later
  action as `refused` with the same failure class. Executor and journal: `partial` (a failure is not a refusal).
  Receipt core and schema: `refusals.length > 0` → `{refused}`.
- **Divergence 2 (same root cause, found by the scratch reproduction).** A `cancelled` mutation whose
  reconciliation is `ambiguous` gives result `failed`/`cancelled` with postcondition `ambiguous`. Executor and
  journal: `cancelled`. Receipt core and schema: the ambiguous postcondition → `{ambiguous}`.
- **Divergence 3 (same).** A cancellation observed after the actions (signal aborted during `buildInventoryAfter`;
  `appendCancellation`, `cleanup-execution.mjs:274`, called at `:361-379`) with non-successful results and no
  `cancelled` failure class. Executor and journal: `cancelled` (the flag is in the journal). Receipt core and schema
  accept `cancelled` only for all-successful results → `{partial}` or `{refused}`.
- **What happens.** `buildExecutionReceiptCore` (`cleanup-execution.mjs:394`) throws `receipt state is
  inconsistent with results, refusals, and postconditions` after the mutations ran and `inventory-after.json` was
  persisted (`:375`), but before the terminal append, `finalizeApproval` and the pointer tombstone. Recovery
  recomputes the same state and throws at `cleanup-recovery.mjs:234`. The approval stays `reserved`, the pointer
  stays `active`, `publishActiveCleanupPointer` refuses every later cleanup (`cleanup-approval-ledger.mjs:337`,
  "another cleanup pointer is active"), and `assertNoActiveCleanup` refuses deployment mutations
  (`deployment-cleanup-gate.mjs:69-76`, "deployment mutation is refused while cleanup state is active") — on an
  operator host that blocks upgrades through `deployment-cli.mjs` / `deployment-session.mjs`.
- All three divergences reproduced at runtime on the scratch copy with the `cleanup-execution.test.mjs` fixtures
  (red runs below); divergence 1 also by G5 (`scratchpad/g5a/repro.test.mjs`).
- **Why tests miss it.** The only clean-failure test (`tests/ownership/cleanup-execution.test.mjs:836`) has one
  action (no refused tail); the stop-then-remove test has a successful action; no test aborts the signal after a
  failed action or returns an ambiguous reconciliation for a cancelled mutation.

**Root cause.** The executor and journal decide the state from results plus two journal-only flags; the receipt
validators re-derive it from receipt rows with their own precedence (refusal rows before failures, postcondition
ambiguity before cancellation, cancellation only for all-success). Four hand-maintained copies drifted, and the
validators run after the mutations, so any disagreement strands the execution.

**Decisions.**
- **D-16.C2a — One rule module.** New `scripts/ownership/cleanup-terminal-state.mjs` (no imports):
  - `cleanupTerminalOutcome(results, { recovered, cancelled })` — the executor/journal rule, byte-for-byte the
    current `executionTerminalOutcome` body (empty → `cancelled`/`recovered`/`no_op`; any `ambiguous` result →
    `ambiguous`; cancelled flag or `cancelled` failure class → `cancelled`; all successful → `recovered`/`cleaned`;
    some successful → `partial`; all `refused` → `refused`; otherwise `partial`).
  - `cleanupTerminalStateCandidates(results)` — the set of `cleanupTerminalOutcome` over the four
    `{recovered, cancelled}` combinations. The receipt cannot see those flags (they are in the signed journal the
    receipt binds by `journalDigest`), so it accepts exactly what some execution with these results could produce.
    Consistent with the executor by construction.
  - `cleanupRefusalRows(results)` — moved from `executionRefusalRows` (which now delegates; export kept).
  - `cleanupTerminalRowsError({ results, refusals, postconditions })` — the row invariants the old per-state rules
    checked only for `cleaned`, now always: a successful result has a `satisfied` postcondition, and all-successful
    results have no refusals. Returns a message or `null`.
  - Wiring: `executionTerminalOutcome` delegates (signature kept for `cleanup-recovery.mjs` and
    `operator-recovery-session.mjs`); journal `terminalOutcome(state)` delegates with `state.recoverySeen` /
    `state.cancellationSeen`; `validateTerminalState` in the receipt core and the schema check call
    `cleanupTerminalRowsError` (prefix `receipt ` / `$: `) and then the candidates, keeping their existing
    "state is inconsistent …" messages. `hasAmbiguousOutcome`, `hasCancelledOutcome`, `successfulResultCount`,
    `allActionsSuccessful`, `hasRefusedOutcome`, `expectedTerminalStates` and `stateCandidates` are deleted.
- **D-16.C2b — Executor semantics win.** Failed-then-refused is `partial`; cancelled mutation with an ambiguous
  postcondition is `cancelled` (the postcondition row still says `ambiguous`; C-Q3); an observed cancellation is
  `cancelled`. Reasons: `refused` means no action was attempted; the signed journal already enforces exactly this
  rule at its terminal checkpoint, so choosing it changes no journal semantics; and choosing the validators' rule
  would need the executor and journal to read reconciliation state (a signed-protocol change).
- **D-16.C2c — Existing artifacts stay valid.** Validation runs before the terminal append in both apply
  (`cleanup-execution.mjs:394` before the append that follows) and recovery (`cleanup-recovery.mjs:234` before
  `:241`), so every existing terminal journal, finalized approval and receipt has state = executor rule **and** was
  accepted by the old validator. The new candidates contain every executor outcome, so the receipt schema accepts
  every existing receipt (`verify-ci-cleanup-upload.mjs` re-verification included); the journal rule is unchanged.
  The two row invariants hold for every executor- or recovery-produced receipt (`classify` gives `cleaned`/`absent`
  only on an exact reconciliation; recovery's `reconciliationResult` likewise; refusals are always
  `executionRefusalRows(results)`). The only shape the new schema rejects that the old accepted is a zero-action
  receipt with refusals claiming `refused`, which no producer can emit (single producer:
  `cleanup-execution-receipt.mjs:331`).
- **D-16.C2d — Stranded executions recover with the existing command; no migration.** A pointer stranded by the old
  validator has every result journaled, `inventory-after.json` persisted, no terminal checkpoint, approval
  `reserved`, pointer `active`. That is byte-for-byte the state a crash at `afterBoundary('inventory_after_persisted')`
  leaves, which the recovery test below uses. With the fix, the existing `cleanup-cli.mjs` `recover` command
  (`recoverCommand`, `:509`, dispatched at `:555`; `recoverCleanupExecution`) and the CI coordinator's `recover`
  complete it: terminal append, approval `finalized` (`partial`), pointer tombstoned, deployment cleanup state
  `clear`, signed `partial` receipt. CI runtimes are per run (`$RUNNER_TEMP/sanctuary-cleanup/…`), so no CI pointer
  survives; only operator hosts can hold one, and its symptom is the `deployment mutation is refused while cleanup
  state is active` upgrade refusal (**operator note**, C-Q2: no host is checked by the loop). Exit codes do not
  change for consumers: `ci-cleanup-coordinator.mjs:64-68` maps `partial`/`refused` → 5 and `cancelled`/`ambiguous`
  → 4; success is only `no_op`/`cleaned`/`recovered` there and in `require-cleanup-success`.
- **D-16.C2e — Docs.** `docs/reference/resource-ownership-cleanup.md`, "Receipt interpretation" (after `:95-97`),
  one sentence: "`refused` means no action was attempted; a run whose first action failed and whose remaining
  actions were refused is `partial`, and an interrupted execution of that shape is completed by recovery."
- **Rejected alternatives.**
  - Patch only `expectedTerminalStates` for divergence 1: leaves divergences 2 and 3 and the schema copy.
  - Validator rule wins (`refused`): changes the signed journal's terminal rule, and `refused` would misreport an
    attempted mutation.
  - Catch the validator error and finalize anyway: signs a receipt the schema rejects at upload.
  - Exact refusal-row derivation in the validators (`refusals` deep-equal `cleanupRefusalRows(results)`): stronger,
    but outside this finding and it needs the unrelated privacy test rebuilt around a private action identity.
  - A one-off migration that tombstones stranded pointers: recovery already does it with signed evidence (D-16.C2d).

**Failing-first tests** (new `tests/ownership/cleanup-terminal-state.test.mjs`, 287 lines; fixtures copied from
`cleanup-execution.test.mjs:24-107` because that file is a `reviewWhenTouched` large-file harness; `tests/**` is
excluded from jscpd, `config/tooling/jscpd.json:27`; no `rmSync`, so no lifecycle registration):
1. `a failed first action with refused later actions finalizes as a signed partial receipt` — two networks, `mutate`
   → `command_failed`, `reconcile` → `absent`; expects `result.state === 'partial'`, the verified receipt `partial`
   with results `[failed/mutation_failed, refused/mutation_failed]` and one refusal row, approval `finalized`
   (`terminalOutcome: 'partial'`), pointer `tombstoned`, deployment state `clear`.
   **RED on base:** `Error: receipt state is inconsistent with results, refusals, and postconditions`
   (`validateTerminalState` ← `applyCleanupExecution` `cleanup-execution.mjs:394`).
2. `recovery finalizes a failed-first-action execution stranded before its terminal checkpoint` — same plan,
   `afterBoundary` throws at `inventory_after_persisted` (asserts approval `reserved`, pointer `active`), then
   `recoverCleanupExecution` with reload/mutate/reconcile/buildInventoryAfter all throwing; expects one mutation in
   total, `recovered.state === 'partial'`, a verified `partial` receipt, and the finalized/tombstoned/clear state.
   **RED on base:** the same message from `finishRecovery` (`cleanup-recovery.mjs:234`).
3. `a cancellation observed after a failed action finalizes as cancelled` — `buildInventoryAfter` aborts the
   `AbortController`; expects `cancelled` receipt, journal `cancellationSeen === true`, finalized state.
   **RED on base:** the same message.
4. `a cancelled mutation with an ambiguous reconciliation finalizes as cancelled` — `mutate` → `cancelled`,
   `reconcile` → `ambiguous`/`query_failed`; expects a `cancelled` receipt whose `postconditions[0].state` is
   `ambiguous`, finalized state. **RED on base:** the same message.
5. `every outcome the executor or journal can choose is a state the receipt accepts` — every result tuple of length
   0–3 over eight `(result, failureClass)` shapes × the four flag combinations; plus the two pinned values
   (`[failed, refused] → partial`, `[refused] → refused`). **RED on base:** `ERR_MODULE_NOT_FOUND …
   cleanup-terminal-state.mjs`.
6. `no cleanup module keeps a private copy of the terminal-state rule` — each of the four consumer files imports
   `./cleanup-terminal-state.mjs` and contains no `successful > 0) return`. **RED on base:**
   `AssertionError … cleanup-execution.mjs`.

**Existing test the fix changes.** `tests/ownership/cleanup-execution-receipt.test.mjs` `receipt content is
privacy scanned and raw secrets are rejected` (`:259-270`) builds a core with a `cleaned` result, a refusal row and
state `partial`, a shape no executor produces; with one rule it now fails the state check before the privacy scan.
Its fixture changes its one result to `failed`/`mutation_failed` (passed to both `buildExecutionReceiptCore` and
`terminalJournal`), so it still reaches `/private material/`. On base the edited case is red too (`… did not match
/private material/ … receipt state is inconsistent …`): base rejects `partial` for a failed result with a refusal
row, the finding's shape at the core level.

Observed on the scratch copy:
- Base (`p16c-red`, new + edited tests): `node --test tests/ownership/cleanup-terminal-state.test.mjs
  tests/ownership/cleanup-execution-receipt.test.mjs` → `pass 8, fail 7` (cases 1–6 and the edited privacy case).
- Fixed: `15/15`; `node --test tests/ownership/*.test.mjs` → `tests 567, pass 564, fail 0, skipped 3`.

**Confirm RED first** (phase `c` worktree at the plan commit, tests added/edited, modules not yet edited):
```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
node --test tests/ownership/cleanup-terminal-state.test.mjs tests/ownership/cleanup-execution-receipt.test.mjs  # pass 8, fail 7
```

**Green criteria.** The two files 15/15; `npm run test:ownership` green (node suites 567: 564 pass, 3 skipped, plus
the two bash suites); lifecycle registry complete (416 identities, unchanged); `check-contracts.mjs` valid.

**Registry and gate impacts.**
- New files must be `git add`ed before `node scripts/ownership/check-lifecycle-callsites.mjs` (it skips untracked
  files); scratch result after `git add`: complete, 416 identities, unchanged. `node scripts/ownership/check-contracts.mjs`:
  valid.
- Architecture graphs cover only `src/**` and `shared/**` (`scripts/architecture/generate-graphs.mjs:34-57`), so the
  new `scripts/ownership` import edges change no `docs/architecture/generated` file.
- `scripts/ownership/**` is not linted by `npm run lint` (no glob covers it); unused identifiers were checked by hand.
- Large files: new test 287 lines; `cleanup-execution.test.mjs` untouched.

**CI lanes.**
- **CI classifier tests** (`quality.yml` `ci-classifier-tests`, `:682` `npm run test:ownership`) — routed by
  `scripts/ownership/*` and `tests/ownership/*` (`classify-quality-scope.sh:107`). This is the required lane that
  runs all six new cases and the edited privacy case.
- **Architecture** runs `npm run test:ownership` again (`scripts/ci/run-architecture-validation-subject.sh:60-61`).
  Not PR-required — watch its post-merge run on `main`.
- **Every cleanup-receipt lane** (verify-vectors' four "Verify … cleanup receipt" actions, the e2e/install/quality
  coordinator lanes) re-verifies real receipts through the changed schema on the PR; all of them produce `cleaned`
  or `no_op` receipts in a green run, which the new candidates accept (D-16.C2c). No lane can produce the three
  divergent shapes on demand; the unit cases are the proof.
- **Ownership-cleanup install scope** (`tests/install/utils/classify-install-scope.sh:494`) and the **Lifecycle
  callsite registry** job run on `scripts/ownership/*`.

**Lizard.** All new functions are top-level, CCN ≤ 6. Per-file run on the five changed modules: the only warning is
the pre-existing `validateJournal` (`cleanup-execution-receipt.mjs:101`, CCN 27, NLOC 66, already one of the 83;
line moves to about `:104`).

**Compatibility.** Exit codes, receipt schema version and journal rule are unchanged; every existing receipt still
verifies (D-16.C2c); the CLI surface is unchanged.

**Acceptance.** A cleanup whose first action fails cleanly finalizes as a signed `partial` receipt with the approval
finalized and the pointer tombstoned; an execution stranded by the old validator is completed by `recover`; the
executor, journal, receipt core and receipt schema import one rule; every existing receipt still verifies.

**Rollback.** Revert the C2 commit. Receipts and journals written after the fix with the three formerly divergent
shapes stay valid for the journal verifier (its rule did not change) but would fail the reverted receipt schema on
re-verification; none is re-verified after upload, and those runs would otherwise have been stranded.

### Phase C verification (worker, phase `c` worktree)

```bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i16-c
git add -A scripts tests docs                                   # lifecycle scanner skips untracked files
bash tests/ci/write-empty-diagnostic-breadcrumb.test.sh        # 10/10
node --test tests/ci/psbt-core-subject.test.mjs                # 12/12
npm ci --prefix tests/ci/lib --ignore-scripts                  # as quality.yml's classifier job
bash tests/ci/check-workflow-composition.test.sh               # rc 0, includes the D-16.C1c block
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyPsbtProvenance.test.ts tests/scripts/verifyAddressesGenerated.test.ts   # 15/15, no vector change
node --test tests/ownership/cleanup-terminal-state.test.mjs tests/ownership/cleanup-execution-receipt.test.mjs  # 15/15
npm run test:ownership                                         # node suites 567 (564 pass, 3 skipped) + the two bash suites
node scripts/ownership/check-lifecycle-callsites.mjs           # complete
node scripts/ownership/check-contracts.mjs
node scripts/ci/check-wallet-safety-classifier.mjs
node --test tests/ci/check-wallet-safety-classifier.test.mjs
node scripts/ci/hardware-emulator-source-inventory.mjs validate
node scripts/ci/check-negated-test-assertions.mjs
node scripts/quality/check-large-files.mjs
bash -n scripts/ci/run-psbt-core-subject.sh
bash -n scripts/ci/write-empty-diagnostic-breadcrumb.sh
test -z "$(git diff --name-only 39831497382d1f77f90eab7383839c5373ae1a4c -- .nvmrc .github/workflows/verify-vectors.yml \
  scripts/ci/docker-endpoint-lib.sh shared/constants config/address-key-corpus-sources.json \
  scripts/generate-address-key-corpora.mjs server/tests/fixtures scripts/verify-addresses)"   # sourceManifest.ts:2-37
/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard -w -l javascript -C 15 -T nloc=200 \
  scripts/ownership/cleanup-terminal-state.mjs tests/ownership/cleanup-terminal-state.test.mjs tests/ci/psbt-core-subject.test.mjs   # 0 warnings
```
`shellcheck` is not installed on the dev host; the two edited scripts keep their existing `# shellcheck` directives
and add no new disable.

### Phase C changelog bullets (integrator, `## [Unreleased]`)

- CI: the job failure breadcrumb no longer says a failure is "a post-verification runner/infrastructure fault -- not
  a proof regression" when earlier steps succeeded; it names the possibilities (an unwrapped verification preamble,
  a receipt verification, or a runner fault such as #1009) and tells the operator to find the failed step. The live
  and regenerate Bitcoin Core PSBT proofs now log Core create, image attestation and readiness as their own
  diagnostic step (`psbt-core-setup-<mode>.log`), so a failed attestation or a timeout there is reported as that
  step's failure.
- Ownership: cleanup execution, its signed journal, the receipt core and the receipt schema share one terminal-state
  rule. A cleanup whose first action fails while later actions are refused now finalizes as `partial` instead of
  leaving the approval reserved and the cleanup pointer active; the same applies to a cancellation observed after a
  failed action and to a cancelled mutation with an ambiguous reconciliation (both `cancelled`). Operator note: an
  execution already stranded this way (an upgrade refused with "deployment mutation is refused while cleanup state
  is active") is completed by the existing cleanup `recover` command. Existing receipts remain valid.

## Implementation log (coordinator)

- (empty until the phase workers start; record the plan-commit SHA, each phase commit, each red/green run file
  `$SCRATCH/i16-<phase>-red*.txt` / `-green*.txt`, any D-16.X3 stop, the cherry-picked SHAs, the A2 integration red
  logs, the `/simplify` and adversarial-review outcome, the integrator commit and the Verification block's exit
  status.)
- **Post-implementation review fix, commit `fix: refuse drafts that omit a multi-recipient intent's outputs`**
  (red `$SCRATCH/i16-fix-red.txt`, green `$SCRATCH/i16-fix-green.txt`; adversarial probes `$SCRATCH/adv16`).
  - Adversarial **P2** (completes `draft-create--display-fields-and-locks-not-bound-to-intent`): a draft of an
    intent with two or more external outputs could omit `outputs` (or send `[]`), so the display fell back to the
    first payee and hid the rest. Now refused on `outputs` (400 `metadata_mismatch`); D-16.A1b amended. Callers
    re-checked: web (`useDraftManagement.ts` `getDraftOutputs` always sends the wizard's outputs), RBF and CPFP
    (`transactionActionsData.ts`, always non-empty), agent (one payment output, single external), and the
    integration fixtures (`signingIntentDraftLifetime`, payjoin fallback: single external output) — none sends a
    multi-external draft without outputs.
  - Folded P3s: subtractFees overstatement is bounded by the fee **in total** across entries (probe P2:
    61000 + 41000 shown, 100000 paid, was accepted); outputs, decoys and change claim from one set (probe P3: one
    change output shown as change, decoy and outputs entry, was accepted); `deleteDraft` re-reads the draft when
    nothing was deleted (missing → 404, else 409 `draft_retained`); the accepted `agentFundingAttempt` is filed
    with `createdAt` = the instant its caps were checked (the column was Prisma `@default(now())`, i.e. insert
    time after createTransaction, intent and draft creation, so a check at 23:59:59 UTC could be filed in the
    next day's window).
  - **sendMax decision:** at most one `sendMax: true` entry is now enforced. Every caller sends at most one: the
    web reducer clears sendMax on the other outputs whenever one is set (`reducerParts/outputs.ts`
    `disableSendMaxOnOtherOutputs`), the agent sends one entry without the flag, RBF and CPFP never set it.
    Residual D-16.A1h (1) (a sendMax flag on an exact-amount entry still renders MAX) is unchanged.
  - /simplify: one `outpointKey`, change claimed through `claimOutput`, display rules read the strict-schema
    parse (`DraftOutputRequest`/`DraftInputRequest`/`DraftDecoyOutputRequest`) instead of local types and an
    unchecked cast; the cap-durability test asserts `draftTransaction.aggregate` is never called.
- **Post-implementation review refactor, commit `refactor(ci,ownership): share cleanup result and cidfile helpers`**
  (no behaviour change): `isSuccessfulCleanupResult` is exported from `cleanup-terminal-state.mjs` and replaces the
  inline success lists in `cleanup-journal-protocol.mjs` (two sites), `cleanup-execution-receipt.mjs` and
  `execution-receipt-schema.mjs` (`cleanup-action-runner.mjs`, outside the plan's file set, keeps its copy), with a
  `REFUSAL_ROW_RESULTS` set for the refusal-row filter; `run-psbt-core-subject.sh` reads both cidfiles through one
  `read_cidfile_id` and its usage message names the internal `setup-*` modes (the existing
  `check-workflow-composition.test.sh` order pin on the create-path cidfile read now names `read_cidfile_id`, so
  that file's line-local check expects exactly one deleted line); the cleanup fixtures shared by
  `cleanup-terminal-state.test.mjs` and `cleanup-execution.test.mjs` moved to
  `tests/ownership/fixtures/cleanup-execution-fixture.mjs` (`fixture(nonce, resources = [row()])`; no
  `fixtureWithResources`, no duplicate `before`; it creates temp dirs with `mkdtempSync` only, so the lifecycle
  callsite checker needs no registry entry).
- *(post-fix adversarial check)* The shared claimed-output set was greedy and claimed `outputs` entries before change and
  decoys, so a subtractFees self-send to the freshly prepared change address (typed amount within the fee of the change
  output) was refused whenever the change output came first in the shuffled transaction. `assertDisplayOutputsMatch` now
  claims decoys and change (exact amount, wallet-owned) before the flexible `outputs` entries; red/green: the new
  two-order test fails on the change-first order before the reorder and passes after. The two double-display rows now
  report `outputs` instead of `changeAddress`/`decoyOutputs` (still refused).

## Verification (before every push)

Workers run only their phase's typechecks and targeted tests (no coverage, no integration specs) and record red runs
on the plan-commit base. The integrator runs the whole block below, as written, as one script on the integrated PR
branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i16` (every `cd server` is in a subshell), only after every
phase branch is cherry-picked. Write the block to `$SCRATCH/i16-verify.sh` and run `bash "$SCRATCH/i16-verify.sh"`
(D-16.X2). Any `tests/install/unit` suite run directly (outside `scripts/ci/run-install-unit-tests.sh`) needs the
`@runtime` project-lock-root env.

**Integrator step before the block.** Set up the integration worktree like the phase worktrees (D-16.X1). Run
`npm run arch:graphs` and `npm run arch:calls` and commit `docs/architecture/generated` (if changed) in the integrator
commit with the changelog bullets (Phase A, B and C sections), so `arch:check` below is a pure check. Create the
Playwright inputs under `$SCRATCH/i16-playwright/`: copy `$SCRATCH/i15-playwright/playwright.static.config.mts` and
`$SCRATCH/i15-playwright/known-auth-login-failures.txt` there, and change the wrapper's import path from
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i15/config/tooling/playwright.config.ts` to
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i16/config/tooling/playwright.config.ts` (the block asserts it). Do not
copy `results.json`, `failing.txt` or `unexpected.txt`. Confirm no container from an earlier attempt still holds the
name prefix `sanctuary-i16-redis-` (`docker ps -a --filter name=sanctuary-i16-redis-`); remove a stale one by its exact
ID only.

**A2 integration reds on a guarded base swap** (D-16.X3; workers may not run integration specs). After every phase is
cherry-picked and before the block, the integrator swaps in the four base A2 production files (no `git stash`), runs
only the two A2 integration cases under the same integration lock as the block, restores the files and verifies the
restore. Write it to `$SCRATCH/i16-a2-integration-red.sh` and run `bash "$SCRATCH/i16-a2-integration-red.sh"`. Any
non-zero exit (a DB that does not start, a different red reason, or a failed restore) is a D-16.X3 stop; on a failed
restore, run `git checkout -- <the four files>` and confirm `git diff --exit-code HEAD -- <the four files>` before
anything else. A1 and A3 stay at head during the swap (neither calls a renamed A2 method).

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i16
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i16
BASE=39831497382d1f77f90eab7383839c5373ae1a4c
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
FILES=(server/src/repositories/agentRepository.ts server/src/services/agentFundingPolicy.ts
  server/src/services/draftService.ts server/src/repositories/draftRepository.ts)
LOG_SUM="$SCRATCH/i16-a2-integration-red-sum.txt"
LOG_DEL="$SCRATCH/i16-a2-integration-red-delete.txt"
test -z "$(git status --porcelain)"                 # clean tree before the swap
exec 9>/home/nekoguntai/.i16-integration.lock
flock 9                                             # same lock as the block's integration lines; held to exit
trap 'git checkout -- "${FILES[@]}"' EXIT           # restore even if a later line fails
for f in "${FILES[@]}"; do git show "$BASE:$f" >"$f"; done
test "$(git diff --name-only HEAD -- "${FILES[@]}" | wc -l)" -eq 4   # the swap took effect
RC_SUM=0
npm --prefix server run test:integration:db -- tests/integration/repositories/agentRepository.sumDraftAmounts.test.ts \
  >"$LOG_SUM" 2>&1 || RC_SUM=$?
RC_DEL=0
npm --prefix server run test:integration:db -- tests/integration/flows/signingIntentDraftLifetime.integration.test.ts \
  -t "refuses to delete a broadcasted draft and keeps the row" >"$LOG_DEL" 2>&1 || RC_DEL=$?
git checkout -- "${FILES[@]}"
git diff --exit-code HEAD -- "${FILES[@]}"          # restore verified
test -z "$(git status --porcelain)"
trap - EXIT
test "$RC_SUM" -ne 0                                # red on base code
grep -qF 'is not a function' "$LOG_SUM"             # the accepted red: sumAcceptedFundingAmountsSince missing on base
test "$RC_DEL" -ne 0
grep -qF 'promise resolved "undefined" instead of rejecting' "$LOG_DEL"   # base deletes the broadcasted row
grep -qE 'Tests +1 failed' "$LOG_DEL"               # exactly the one filtered case failed
echo "A2 integration reds recorded in $LOG_SUM and $LOG_DEL; A2 files restored"
```

**The verification block.**

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i16
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i16
test "$(npm --version | cut -d. -f1)" = 12   # devEngines requires npm 12; the system ~/.local/bin npm 11 fails EBADDEVENGINES
test -d node_modules       # real install present (one gate per line: a failing non-final && command does not exit under set -e)
test ! -L node_modules     # real install; a symlink breaks arch:graphs (shared/* edges)
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"   # D-16.X4 pinned binary
BASE=39831497382d1f77f90eab7383839c5373ae1a4c
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
npm run build --workspace=shared
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )   # CI's Full Backend Typecheck; tsc --noEmit alone misses test files
# targeted backend: A1 (display binding), A2 (durable caps, retained drafts), A3 (agent payload)
( cd server && npx vitest run tests/unit/services/draftCreate.test.ts tests/unit/services/draftService.test.ts \
  tests/unit/repositories/draftRepository.test.ts tests/unit/services/agentFundingPolicy.capDurability.test.ts \
  tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts \
  tests/unit/repositories/agentRepository.funding.test.ts tests/unit/services/agentApiService.test.ts \
  tests/unit/services/agentMonitoringService.test.ts tests/unit/services/mobileAgentDraftService.test.ts \
  tests/unit/api/drafts-routes.test.ts tests/unit/api/drafts.test.ts tests/unit/api/openapi.test.ts \
  tests/unit/api/agent-routes.funding.test.ts tests/unit/api/agent-wallet-funding-smoke.test.ts )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only; scoped to tests/unit as CI (D-16.X5)
# --- full backend integration suite with Redis (D-16.X3 integration rule; serialized host-wide) ---
# CI's shape (test.yml "Run integration tests"): every non-destructive group in one vitest, then ops-destructive,
# with SANCTUARY_REQUIRE_REDIS_INTEGRATION=true so Redis-gated specs fail at collection instead of skipping
# (i15 PR #1416 went red in CI on a Redis-gated spec that was skipped locally).
bash scripts/ci/backend-integration-groups.sh --check   # every integration spec is grouped (A2's rewrite keeps its path)
bash tests/ci/backend-integration-groups.test.sh
REDIS_PASS="i16-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
REDIS_CID="$(docker run -d --rm --name "sanctuary-i16-redis-$$" -p 127.0.0.1::6379 "$REDIS_IMAGE" redis-server --requirepass "$REDIS_PASS" --save '' --appendonly no)"
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
flock /home/nekoguntai/.i16-integration.lock npm --prefix server run test:integration:db -- "${INT_MAIN[@]}" \
  --reporter=default --reporter=json --outputFile.json="$SCRATCH/i16-integration-main.json" 2>&1 | tee "$SCRATCH/i16-integration-main.txt"
flock /home/nekoguntai/.i16-integration.lock npm --prefix server run test:integration:db -- "${INT_DESTRUCTIVE[@]}" \
  2>&1 | tee "$SCRATCH/i16-integration-destructive.txt"
# every Redis-gated spec actually ran (a describe.skip would leave it with zero passed tests)
test -s "$SCRATCH/i16-integration-main.json"
mapfile -t REDIS_SPECS < <(git grep -l describeWithRedis -- server/tests/integration ':(exclude)server/tests/integration/setup')
test "${#REDIS_SPECS[@]}" -gt 0
for f in "${REDIS_SPECS[@]}"; do
  test "$(jq --arg f "/${f}" '[.testResults[] | select(.name | endswith($f)) | .assertionResults[] | select(.status == "passed")] | length' "$SCRATCH/i16-integration-main.json")" -gt 0 \
    || { echo "Redis-gated integration spec did not run: $f" >&2; exit 1; }
done
docker rm -f "$REDIS_CID" >/dev/null
REDIS_CID=""
unset REDIS_URL SANCTUARY_REQUIRE_REDIS_INTEGRATION
# --- mutation pins and scope (re-derived on 39831497382d) ---
# Tier 1 — CI-enforced pins with line ranges, canaries or minScores: NO planned change touches this surface.
PINNED_SURFACES=(
  server/src/services/bitcoin server/src/repositories/transactionSigningIntentRepository.ts
  server/src/api/transactions/broadcasting.ts server/src/api/drafts.ts server/src/middleware/auth.ts
  server/src/services/accessControl.ts src/services/hardwareWallet/psbtAccountBinding.ts shared/constants/walletPolicy.ts
  config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")"
# Tier 2 — whole-file globs in Stryker configs no CI lane runs: nothing planned here either
UNSCHEDULED_SURFACES=(
  server/src/services/scriptTypes server/src/services/authService.ts server/src/services/encryption.ts
  server/src/services/twoFactorAuth.ts server/src/services/tokenRevocation.ts server/src/services/walletService.ts
  server/src/utils src/hooks src/utils shared
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${UNSCHEDULED_SURFACES[@]}")"
# sync-path, replay and schema surfaces untouched (no migration; replay driver seal unchanged)
test -z "$(git diff --name-only "$BASE" HEAD -- server/prisma config/wallet-sync-mutation-boundaries.json config/wallet-sync-lifecycle-contract.json scripts/perf)"
# verify-vectors provenance (D-16.C1e): no VERIFIER_SOURCE_FILES entry changed (scripts/verify-addresses/sourceManifest.ts:2-37)
test -z "$(git diff --name-only "$BASE" HEAD -- .nvmrc .github/workflows/verify-vectors.yml scripts/ci/docker-endpoint-lib.sh shared/constants config/address-key-corpus-sources.json scripts/generate-address-key-corpora.mjs server/tests/fixtures scripts/verify-addresses)"
test -z "$(git diff --name-only "$BASE" HEAD -- .github)"   # no workflow or action edited
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts
# exact-file scope: the whole PR diff, minus tasks/ and docs/architecture/generated/, is exactly the ownership table
# plus the integrator's changelog
EXPECTED_FILES="$(sort <<'EOF'
docs/explanation/state-machines.md
docs/how-to/agent-wallet-funding.md
docs/reference/changelog.md
docs/reference/resource-ownership-cleanup.md
scripts/ci/run-psbt-core-subject.sh
scripts/ci/write-empty-diagnostic-breadcrumb.sh
scripts/ownership/cleanup-execution.mjs
scripts/ownership/cleanup-execution-receipt.mjs
scripts/ownership/cleanup-journal-protocol.mjs
scripts/ownership/cleanup-terminal-state.mjs
scripts/ownership/execution-receipt-schema.mjs
server/src/api/openapi/paths/drafts.ts
server/src/repositories/agentRepository.ts
server/src/repositories/draftRepository.ts
server/src/services/agentApiService.ts
server/src/services/agentFundingPolicy.ts
server/src/services/draftCreate.ts
server/src/services/draftService.ts
server/tests/integration/flows/signingIntentDraftLifetime.integration.test.ts
server/tests/unit/api/agent-routes.funding.test.ts
server/tests/integration/repositories/agentRepository.sumDraftAmounts.test.ts
server/tests/unit/repositories/agentRepository.testHarness.ts
server/tests/unit/repositories/agentRepository.test.ts
server/tests/unit/repositories/draftRepository.test.ts
server/tests/unit/services/agentApiService.test.ts
server/tests/unit/services/agentFundingPolicy.capDurability.test.ts
server/tests/unit/services/agentFundingPolicy.test.ts
server/tests/unit/services/draftCreate.test.ts
server/tests/unit/services/draftService.delete.contracts.ts
server/tests/unit/services/draftService.test.ts
src/components/WalletDetail/hooks/useAITransactionFilter.ts
src/components/WalletDetail/tabs/TransactionsTab/AiFilterSummary.tsx
src/components/WalletDetail/tabs/TransactionsTab.tsx
tests/ci/check-workflow-composition.test.sh
tests/ci/psbt-core-subject.test.mjs
tests/ci/write-empty-diagnostic-breadcrumb.test.sh
tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts
tests/components/WalletDetail/tabs/TransactionsTab.test.tsx
tests/ownership/cleanup-execution-receipt.test.mjs
tests/ownership/cleanup-execution.test.mjs
tests/ownership/cleanup-terminal-state.test.mjs
tests/ownership/fixtures/cleanup-execution-fixture.mjs
EOF
)"
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' ':(exclude)docs/architecture/generated' | sort)"
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# line-local scope inside shared files
test "$(git diff --numstat "$BASE" HEAD -- docs/explanation/state-machines.md | cut -f1-2)" = "$(printf '1\t1')"        # D-16.A2c: one row (:130)
test "$(git diff --numstat "$BASE" HEAD -- tests/ci/check-workflow-composition.test.sh | cut -f2)" = 1                    # D-16.C1c additions, plus the one PSBT cidfile needle the review refactor renamed (read_cidfile_id)
grep -qF 'including requests whose drafts are later rejected, expired, invalidated or deleted' <<<"$(tr '\n' ' ' <docs/how-to/agent-wallet-funding.md | tr -s ' ')"   # OQ-A2 docs line (wrap-insensitive; no pipe into grep -q under pipefail)
grep -qF 'is `partial`, and an interrupted execution of that shape is completed by recovery' <<<"$(tr '\n' ' ' <docs/reference/resource-ownership-cleanup.md | tr -s ' ')"   # D-16.C2e (wrap-insensitive: the doc is hard-wrapped at ~80 columns)
# removed names have no remaining references (A2, A3)
if grep -rn "buildOutputMetadata\|sumAgentDraftAmountsSince\|draftRepository\.remove\b\|remove: draftRepository\.remove" server/src server/tests; then echo "removed name still referenced" >&2; exit 1; fi
# C1: no breadcrumb wording claims a proof passed; C2: one terminal-state rule
if grep -nF 'not a proof regression' scripts/ci/write-empty-diagnostic-breadcrumb.sh; then echo "breadcrumb still claims 'not a proof regression'" >&2; exit 1; fi
for f in scripts/ownership/cleanup-execution.mjs scripts/ownership/cleanup-execution-receipt.mjs scripts/ownership/execution-receipt-schema.mjs scripts/ownership/cleanup-journal-protocol.mjs; do
  grep -qF './cleanup-terminal-state.mjs' "$f" || { echo "missing shared terminal-state import: $f" >&2; exit 1; }
done
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
node scripts/ci/check-wallet-safety-classifier.mjs
node scripts/ci/hardware-emulator-source-inventory.mjs validate
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/components/WalletDetail tests/components/TransactionList
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold (D-16.X5)
# Playwright (CLAUDE.md static-build procedure; no host dev server). Known limitation: the static server cannot answer
# POST /auth/login, so the 7 known cases fail here; the exit status is recorded, not gated. Bounded and non-vacuous.
PW_DIR="$SCRATCH/i16-playwright"
grep -qF "/home/nekoguntai/sanctuary-bug-scrub-20261013-i16/config/tooling/playwright.config.ts" "$PW_DIR/playwright.static.config.mts"
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
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i16-lizard.txt"   # cap 86 unchanged; pinned 1.24.0, no PyPI fetch
test "$(grep -c ': warning:' "$SCRATCH/i16-lizard.txt")" -le 83    # D-16.X4: base 39831497382d = 83, no new warnings; edit this literal only by the D-16.X4 procedure
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run check:bitcoin-network-boundaries
npm run arch:check                                 # pure check: graphs regenerated and committed before the block
node scripts/ownership/check-lifecycle-callsites.mjs
node scripts/ownership/check-contracts.mjs
npm run check:resource-ownership-contract
npm run verify:signer-inventory                   # A2/A3 add no signer identifier; agentApiService capability count unchanged
npm run check:safety-catch-guards                 # unchanged allowlist: no catch added
npm run check:wallet-sync-mutation-boundaries     # A2's renames are outside canonicalScopes; deleteManyByIds unchanged
npm run check:wallet-sync-lifecycle-contract
npm run check:openapi-route-coverage              # A1/A2 edit OpenAPI descriptions and add a 409
npm run check:api-body-validation
node scripts/ci/check-supply-chain-locks.mjs      # always-on Determine Quality Scope step
node scripts/ci/check-negated-test-assertions.mjs
# install, ownership and CI suites (C)
bash -n scripts/ci/run-psbt-core-subject.sh
bash -n scripts/ci/write-empty-diagnostic-breadcrumb.sh
bash tests/ci/write-empty-diagnostic-breadcrumb.test.sh          # 10/10 (C1)
node --test tests/ci/psbt-core-subject.test.mjs                  # 12/12 (C1)
node --test tests/ownership/cleanup-terminal-state.test.mjs tests/ownership/cleanup-execution-receipt.test.mjs   # 15/15 (C2)
node --test tests/ownership/cleanup-execution.test.mjs   # shares the moved fixture module with the C2 suite
npm run test:ownership   # every tests/ownership suite incl. producer hooks, as the CI classifier lane
bash scripts/ci/run-install-unit-tests.sh          # all tests/install/unit suites; installs tests/ci/lib
bash tests/ci/check-workflow-composition.test.sh   # includes the D-16.C1c block (needs tests/ci/lib, installed above)
bash tests/ci/ci-registration-completeness.test.sh
bash tests/ci/classify-test-changes.test.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree
echo "verification block: all gates passed"
```

If the integration DB or the throwaway Redis cannot start, the block stops at the integration lines. That is a
D-16.X3 stop, not a fallback: record the failure, triage it as infrastructure first, then re-run the whole block as
written once both start. Completion requires the full block to exit 0 with the full integration suite (both
invocations) executed and every Redis-gated spec run. `/simplify` and an adversarial review before committing;
commits in the foreground through `flock /home/nekoguntai/.i16-commit.lock git commit …`; never while a coverage run
is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i16` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i16`),
  one commit per finding (test + fix; six: A1, A2, A3, B1, C1, C2), then the integrator commit (changelog
  `[Unreleased]` bullets and any regenerated `docs/architecture/generated`).
- **Workers (D-16.X1):** phases `a`, `b`, `c` in parallel. Workers edit only owned files, run typechecks and targeted
  tests, run pinned lizard on changed files (zero new warnings), record red runs on the plan-commit base, apply the
  D-16.X3 stop rule, and commit through the flock.
- **Integrator (D-16.X2):** cherry-picks serially with `-x` (a, b, c), never resolves a conflict by editing another
  phase's files, records the A2 integration reds on the guarded base swap, then runs the block. Each phase branch is
  proven upstream with `git cherry codex/bug-scrub-loop/20261013-i16 <phase-branch>` (every line `-`), deleted with
  `git branch -D`, and its worktree removed by path.
- **Merge:** squash through protected `main`; no admin bypass; merges are strictly serial — this PR is rebased only
  when it is the next to merge, and no other open PR is rebased because of it; poll required contexts via
  `/commits/<sha>/statuses` (the combined status can say success while a required context such as the verify-vectors
  summary is still pending).
- **Expected CI lanes** (a missing expected lane is investigated, not assumed skipped):
  - **Verify Bitcoin Vectors** — `server/src/services/agentApiService.ts`, `server/src/repositories/**` and
    `src/components/WalletDetail/**` are on `config/wallet-safety-critical-paths.json` (`:50`, `:52`, `:107`), and
    any non-documentation path runs it. Its live PSBT step runs C1's setup wrapper: record the run and job IDs and
    confirm `psbt-core-setup-live.log` with an exit-0 sidecar in the `ci-diagnostics-verify-vectors` artifact.
  - Backend unit (coverage shards) + backend integration groups (Redis-required, as above); Full Backend Typecheck.
  - Frontend unit/coverage + render/browser e2e.
  - **CI classifier tests** (`scripts/ci/*`, `tests/ci/*`, `scripts/ownership/*`, `tests/ownership/*`,
    `docs/reference/resource-ownership-cleanup.md`; `classify-quality-scope.sh:107`): breadcrumb, composition and
    `npm run test:ownership`.
  - **Install and ownership lanes**: `scripts/ci/*` and `scripts/ownership/*` are release-surface paths
    (`tests/install/utils/classify-install-scope.sh:483`; PR release-surface smoke), `scripts/ownership/*` and
    `tests/ownership/*` enable the ownership-cleanup scope (`:494`), and `tests/ci/check-workflow-composition.test.sh`
    enables the install unit suites (`:499`); plus **Release Candidate Validation**, whose `pull_request` paths cover
    `scripts/ci/**` and `scripts/ownership/**` (`.github/workflows/release-candidate.yml`). Record each job ID.
  - Lifecycle callsite registry; Determine Quality Scope (always-on `Check supply-chain locks`).
  - Architecture is not PR-required: watch its post-merge run on `main` (it re-runs `test:ownership`).
- **CI failure triage, infrastructure first.** Before treating any red lane as a product failure, enumerate the
  CLAUDE.md infrastructure causes against the job log, the diagnostic artifact
  (`scripts/ci/write-diagnostic-summary.sh`) and the `Name:` host's snapshots: Podman socket archive stalls
  (runner-infra #34; the job budget is the deadline), npm advisory-endpoint outages in the audit gate (probe before
  retriggering; cite #1012), DIND/Podman daemon contention, a stranded `e2e` runner lock, native-builder divergence on
  `kumo` (`DOCKER_BUILDKIT=0`), runner capacity (sora running several emulator jobs at once), and registry egress. The
  install lanes this PR triggers are expensive and are not a signal about C when they fail for those reasons. Note
  that after C1 a verify-vectors failure breadcrumb no longer names the runner as the cause: find the failed step in
  the task output first.
- **Retriggers:** any second expensive attempt carries the CLAUDE.md four-part evidence (immutable 40-character SHA
  plus workflow run/job IDs, a redacted failure signature, a new hypothesis not tested by the failed attempt, and a
  cheap discriminator with its result); a `chore: retrigger CI` commit carries the fix or that evidence. Never push
  while an obsolete revision still owns runner resources.
- **After merge:** verify the reported `merge_commit_sha` (not the head SHA) exists locally and is an ancestor of
  `origin/main` (`git cat-file -e` + `git merge-base --is-ancestor`) before deleting the branch; never pass
  `delete_branch_after_merge`. Verify target-branch CI on the merge commit.
- **PR-body flags:**
  - A1: five display-binding rules (outputs, change/decoys, inputs, consolidation recipient, stored amount)
    refusing with 400 `metadata_mismatch`; two legacy client-shape tolerances kept; existing drafts not rewritten;
    `feeRate` stays unbound (P3 `draft-create--fee-rate-display-not-bound-to-intent`); a consolidation's amount is
    still not tied to an intent output (P3 `draft-create--consolidation-amount-not-bound-to-intent-output`)
    (D-16.A1h, D-16.A1i).
  - A3 residual: the mobile agent review shows no decoy outputs (P3 `mobile-agent-review--decoy-outputs-not-shown`,
    D-16.A3a).
  - A2: **product-visible cap semantics (OQ-A2, coordinator decision the user may revisit)** — caps count every
    accepted funding request in the window, including requests whose drafts are later rejected, expired, invalidated
    or deleted; owner override is the refill; draft `DELETE` of a broadcasted draft → 409 `draft_retained`; resolves
    backlog `agent-funding-caps--invalidated-or-expired-drafts-uncounted`.
  - A3: agent funding drafts were refused since `a02748784` (2026-06-04); A2 and A3 ship together.
  - B1: defence in depth — not reachable with current server data (`listTransactions.ts:63`, `core.ts:523`, `:543`);
    PNG baselines unchanged.
  - C1: breadcrumb names possibilities instead of a runner verdict (C-Q1 accepted loss of the #1009 verdict; P3
    `ci-diagnostics--breadcrumb-no-verification-complete-marker`); PSBT Core setup is its own logged step; no
    provenance-pinned file edited; verify-vectors run/job IDs with the setup log.
  - C2: one terminal-state rule; executor semantics win (`partial`; `cancelled` kept for divergence 2, C-Q3); every
    existing receipt still verifies; **operator note**: `cleanup-cli.mjs recover` completes an already-stuck
    active-cleanup pointer (upgrade refused with "deployment mutation is refused while cleanup state is active"); no
    production host was checked by the loop (C-Q2).
  - "No migration, no new endpoint or response field, no e2e mock-map change, no version bump"; the P3 backlog and
    follow-ups stay outside this PR.
- **Rollback:** every phase is code/CI/test/docs-only. No schema, migration or stored-shape change. Reverting A1
  re-admits unbound display fields; A2 returns caps to counting draft rows and re-allows deleting broadcasted drafts
  (A3 must be reverted with it); A3 makes agent funding drafts fail again; B1 restores raw counts in the AI summary;
  C1 restores the i12 breadcrumb wording and the unlogged PSBT preamble; C2 restores the four rule copies (receipts
  written in the three formerly divergent shapes would then fail re-verification; none is re-verified after upload).
- **Deployment:** none until clean closeout (`--deploy final`); the local stack is rebuilt only after the loop closes.

## Completion criteria

- [ ] Every failing-first test in Phases A–C fails on `39831497382d` code for the reason its phase states, or for an
  accepted red listed under D-16.X3 (red runs recorded per phase; the two A2 integration reds recorded by the
  integrator's guarded base swap, `$SCRATCH/i16-a2-integration-red-sum.txt` and `-delete.txt`, with the restore
  verified by `git diff --exit-code`), and passes on the PR head; honest-path guards stay green; no unresolved
  D-16.X3 stop.
- [ ] Verification block run as written on the integrated branch with exit status 0 recorded, including the lizard
  gate (≤ 83), the empty tier-1/tier-2 mutation-pin diffs, the empty verify-vectors provenance diff, the exact-file
  scope diff and the line-local checks, backend coverage scoped to `tests/unit` and frontend coverage at 100%, and
  the **full** backend integration suite (both invocations) executed with `REDIS_URL` set and
  `SANCTUARY_REQUIRE_REDIS_INTEGRATION=true`, every Redis-gated spec with passed tests.
- [ ] Playwright static run recorded (exit status, ≥ 380 executed, only the 7 known auth/login failures, PNG
  baselines unchanged, no untracked snapshot); CI's browser lane is binding.
- [ ] C1 end-to-end evidence recorded: the PR head's green verify-vectors run (run and job IDs) with
  `psbt-core-setup-live.log` and an exit-0 sidecar in its diagnostics artifact.
- [ ] PR merged; required contexts green via `/statuses`; target-branch CI green on its merge commit (including the
  post-merge Architecture lane); ancestry of `merge_commit_sha` verified; branches and worktrees cleaned
  (`git cherry` proof per phase branch).
- [ ] PR body carries every flag listed under Delivery, including the OQ-A2 semantics and the C-Q2 operator note.
- [ ] Run state updated: six findings resolved; backlog `agent-funding-caps--invalidated-or-expired-drafts-uncounted`
  resolved by A2; the disposition of `agent-funding-caps--rejected-drafts-counted` under OQ-A2 recorded; the decided
  open questions and the P3 follow-ups (`ci-diagnostics--breadcrumb-no-verification-complete-marker`,
  `ai-transaction-filter--aggregation-runs-on-non-transaction-result-types`) recorded; the three plan-review P3s
  (`draft-create--fee-rate-display-not-bound-to-intent`, `draft-create--consolidation-amount-not-bound-to-intent-output`,
  `mobile-agent-review--decoy-outputs-not-shown`) recorded as backlog.
- [ ] P3 backlog (the 22 deferred P3s: 19 from this scrub plus 3 from plan review, listed under Open questions)
  remains outside the blocking fix set.

## Review log

- Draft assembled 2026-10-21 from plan16-A/B/C (source `39831497382d`), with the coordinator decisions OQ-A1, OQ-A2,
  OQ-B1, C-Q1, C-Q2, C-Q3 applied. Lizard base re-measured at assembly on `39831497382d`: 83 (gate ≤ 83).
- Pass 1 (2026-10-22): three reviewers (A; B + cross-cutting + Verification; C). Applied: A-P1-1 (bind amount; feeRate residual + P3), A-P1-2 (mobile decoy residual + P3), C-P1-1 (red total/length), C-P1-2 (timeout outcome wording). Rejected: none. B reviewer: no actionable comments.
- Pass 2 (2026-10-22): two reviewers (A1 amount rule in depth; full plan). Both raised one comment: the run-state P3 `draft-create--consolidation-amount-not-bound-to-intent-output` for residual D-16.A1h (5) was missing from the plan — applied by the coordinator (id named, deferred list 22/3, PR flag, completion counts, A1 changelog qualifier). A1 rule (x) re-verified: no legitimate caller refused; reds/greens reproduced. Rejected: none.
- Pass 3 (2026-10-22): full-plan pass, 1 comment (P3-1: the D-16.C2e docs check was a one-line grep against a hard-wrapped doc) — applied by the coordinator: both docs checks now normalize whitespace first (command substitution + here-string, so no pipe into `grep -q` under pipefail). No other defect. Rejected: none.
- Pass 4 (2026-10-22): full-plan pass, **clean — review converged.**
