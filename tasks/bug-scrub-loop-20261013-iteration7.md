# Bug-scrub loop 20261013 — iteration 7 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 7
- **Source SHA:** `e1769d9ef660326f83c00ed9f77519f67347aa29` (`main`, after #1399/#1400/#1401)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (9: 1 P1, 8 P2).** P3 findings are backlog in run state and are **outside this fix
  set** (`webhook-allowed-cidrs--empty-prefix-matches-everything`, `apns-provider--fetch-http1-cannot-reach-apns`,
  `cpfp--confirmed-parent-not-rejected`, `wallet-list-load-error--intelligence-and-console-results-show-empty`,
  `intelligence-chat--send-create-delete-failures-silent`).

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `payjoin-broadcast--peer-input-persistence-fails-forever` | **P1** |
| A2 | `send-recipient--uppercase-bech32-broadcast-mismatch` | P2 |
| A3 | `rbf-draft--multi-recipient-amount-recipient-mismatch` | P2 |
| A4 | `approval-expiry--draft-stuck-pending-forever` | P2 |
| B1 | `auth-step-up--password-reverify-unthrottled` | P2 |
| B2 | `price-api--unauthenticated-upstream-fanout` | P2 |
| B3 | `webhook-allowlist--env-not-forwarded-by-compose` | P2 |
| B4 | `wallet-remediation--signer-path-notation-blocks-proof` | P2 |
| B5 | `ci-classifier--lifecycle-callsite-check-skipped-for-sh-yml-sources` | P2 |

## Goal and non-goals

**Goal:** fix every P0–P2 confirmed by the iteration-7 scrub, each with a regression test that fails on
`e1769d9e` and passes after the fix, delivered through protected PRs with green CI.

**Non-goals:** the P3 backlog; new Prisma migrations (forbidden); changing who may read prices
(the price API stays public).

## Assumptions and constraints

As iteration 6: funds-critical files go through critical mutation shard 3 and any pinned `mutate` ranges /
`config/wallet-safety-mutation-map.json` line pins are re-pinned if lines shift; no new `finalize*`
identifiers; new sync-path repository calls listed in `config/wallet-sync-mutation-boundaries.json`; new
integration specs registered in `scripts/ci/backend-integration-groups.sh` with `afterAll` cleanup; lizard
must not rise above 84; coverage 100%; test files under 1,000 lines unless already classified; set up
worktrees with root `npm ci` only (never in `server/`). Coverage gap carried from the scrub: a handful of
small unchanged files (electrumPool config/metrics/breaker, a few support-package helpers and collectors) are
read in full by the next scrub.

---

## Delivery group A — funds (PR A, first)

### A1 — a payjoin broadcast persists (P1)

**Evidence.** `buildCanonicalMetadata` puts every snapshot input into `metadata.utxos`
(`server/src/api/transactions/broadcasting.ts:168`), including the receiver's `payjoin_peer` input.
`persistTransaction` (`services/bitcoin/transactions/persistTransaction.ts:52-63`) runs
`tx.uTXO.update({ where: { walletId_txid_vout } })` for each; the peer outpoint has no row in this wallet, so
Prisma throws P2025 and the whole persistence transaction rolls back: no Transaction row, UTXOs not marked
spent, draft not archived and its locks held, no label/memo, event or notification. The route answers 202
`pending_reconciliation`; `reconcileAccepted` (`signingIntent/broadcastReconciliation.ts:31-42`) retries the
same write every run, `accepted` rows have no attempt cap and are listed oldest-`broadcastLastAttemptAt`-first
50 at a time (`transactionSigningIntentRepository.ts:334-347`), and a failed reconcile never advances that
timestamp — so ~50 stuck payjoins starve every other reconciliation. #1399 made this reachable (web payjoin
broadcasts used to fail metadata checks before reaching the network).

**Fix.**
1. The UTXOs marked spent are the wallet's own inputs only, derived from data every row **already has**, so
   `accepted` rows stuck since #1399 also recover: `persistTransaction` marks spent only the inputs whose
   address is one of the wallet's addresses (the durable `inputs` carry addresses; the strict
   `DurableBroadcastMetadataSchema`, `broadcastLifecycle.ts:23-48`, gains no field). `buildCanonicalMetadata`
   keeps `utxos` as the full canonical input list (what the client must echo); peer inputs are still
   recorded as transaction inputs. A wallet-owned input with no UTXO row still fails as today. `inputs` is
   optional (`persistTransaction.ts:40`, `broadcastLifecycle.ts:36`): when it is absent or empty (pre-payjoin
   rows), every `metadata.utxos` entry is marked spent as today. The wallet address set is one
   `tx.address.findMany({ where: { walletId, address: { in: inputAddresses } } })` inside the existing
   `withTransaction` (`persistTransaction` is an allowed Prisma boundary, `server/scripts/check-prisma-imports.ts:82`,
   and is not a wallet-sync mutation boundary, so no `config/wallet-sync-mutation-boundaries.json` entry or
   replay-driver re-seal is needed).
2. Reconciliation cannot be starved by a row that keeps failing: a new guarded repository method
   (`updateMany({ where: { id, broadcastState: 'accepted' } })` setting `broadcastLastAttemptAt = now`) in
   `transactionSigningIntentRepository.ts` is called from the **existing** catch in
   `reconcileSigningIntentBroadcasts`, so the row moves to the back of the batch. The call is
   `await advance(id, now).catch((error) => log.warn(...))`, so a failing advance cannot abort the rest of the
   batch or the stalled-lookup pass (the allowlist entry relies on that isolation; a promise `.catch` is not a
   `CatchClause`, so the pinned count stays 1). No new try/catch inside
   `reconcileAccepted` (the safety-catch gate pins catches per function,
   `scripts/quality/safety-catch-allowlist.json:626-639`); no migration.

**Failing-first tests.** `persistTransaction` unit: metadata with a wallet input and a `payjoin_peer` input →
only the wallet UTXO is updated and the transaction persists (today: P2025); metadata with no `inputs` → every
`utxos` entry is marked spent as today. The reconciler unit tests mock `persistTransaction`, so the stuck-row
recovery is proven in the integration spec: an `accepted` signing-intent row whose durable metadata (no new
field) has a wallet input and a `payjoin_peer` input is reconciled by `reconcileSigningIntentBroadcasts` against
real PostgreSQL to complete, with only the wallet UTXO marked spent. Reconciler unit (with `createLogger` mocked): the failing path calls the
guarded advance; when the advance itself rejects, `log.warn` is called with the intent id and the error, and the
next record and the stalled pass still run. Repository **unit** test (mandatory; shard 3 and CI's unit-scoped
coverage): the new method calls `updateMany` with exactly `where: { id, broadcastState: 'accepted' }`,
`data: { broadcastLastAttemptAt: now }` and returns its result. The integration ordering test (an advanced
row sorts after other accepted rows) is extra proof only. Integration (registered, with
cleanup): broadcast persistence of a payjoin proposal against real PostgreSQL completes and marks only the
wallet UTXO spent. 

### A2 — an uppercase bech32 recipient broadcasts (P2)

**Evidence.** A scanned or pasted all-uppercase bech32 address or BIP21 URI (common in payment QRs) is stored
as typed (`OutputRow.tsx:595-601`, `bip21Parser.ts:57-63`, `reducerParts/outputs.ts:88-94`); the shared
validators accept it (`shared/constants/bitcoin.ts:64-70`, case-insensitive); the server create path accepts it
(bitcoinjs lowercases bech32). At broadcast the client sends `recipient: state.outputs[0].address`
(`useBroadcast.ts:347`) and the server compares it strictly with the lowercase decoded recipient
(`broadcasting.ts:226-236`) → 400 `metadata_mismatch` after the user has signed. Saved drafts keep the
uppercase recipient.

**Fix.** Normalise all-uppercase bech32/bech32m addresses to lowercase where an address enters the send state
(address input, QR scan and BIP21 parse), and make the server recipient comparison canonical (compare
addresses by their decoded output script, or lowercase both sides when both are bech32), so drafts saved
before the fix also broadcast. Mixed-case remains rejected by the existing validator.

**Failing-first tests.** Reducer/parser: an uppercase bech32 address or `BITCOIN:BC1Q...` URI is stored
lowercase. Server route: a broadcast whose body recipient is the uppercase form of the canonical recipient is
accepted (today 400); a genuinely different recipient is still refused; a base58 (P2PKH/P2SH) recipient that
differs only in letter case and a mixed-case bech32 recipient are both still refused with `metadata_mismatch`
(kills a weakened comparison).

### A3 — an RBF fee bump on a multi-recipient transaction broadcasts (P2)

**Evidence.** `rbfDraftRequest` (`src/components/TransactionActions/transactionActionsData.ts:62-107`) sets the
draft amount and recipient from the first non-change output only, where "change" is only branch-1
addresses on the server (`rbf.ts:252-255,360-368`). The server's canonical amount is the sum of all external
outputs and its recipient is the first external output (`intentSpend.ts:87-103`, `broadcasting.ts:165-167`),
so a batch with two external outputs fails on amount and one whose first non-change output is the wallet's
own receive address fails on recipient (`metadata_mismatch`), leaving CPFP as the only way to speed it up.

**Fix.** The RBF create route returns the canonical spend of the minted replacement intent (amount and
recipient from `deriveIntentSpend` on the persisted snapshot, as `/payjoin/attempt` now does), nullable when
the replacement has no external output. `rbfDraftRequest` / the RBF draft use those values when present. A
consolidation bump (no external output) keeps today's positive draft amount, `effectiveAmount`, recipient and
output order: the server skips the recipient/amount checks when nothing leaves the wallet
(`broadcasting.ts:226-229`), and a 0 amount would make the resumed draft unbuildable
(`draftTransactionData.ts:52-56`, `sendAmount.ts:24`). Because broadcast sends `recipient: state.outputs[0].address` (`useBroadcast.ts:347`) and a resumed
draft's `outputs` keep their stored order (`sendTransactionPageHelpers.ts:209-216`), the RBF draft's `outputs`
put the canonical recipient output first, so the broadcast body matches.
Contracts: the RBF response schema in `shared/schemas` and OpenAPI gain the fields (required), with the pin
tests updated.

**Failing-first tests.** Server route: RBF of a two-external-output transaction returns the summed amount and
the first external recipient; an own-receive-output-first transaction returns the external recipient; a
consolidation returns null canonical fields. Frontend: `rbfDraftRequest` uses the returned canonical values
(multi-recipient and own-first cases) and orders the canonical recipient first; a resumed RBF draft's
**broadcast request body** carries the canonical recipient and amount; a resumed consolidation RBF draft still
builds its txData and its broadcast body passes (unchanged behaviour).

### A4 — an expired approval request releases its draft (P2)

**Evidence.** When a vote arrives after `expiresAt`, `castVote` resolves the request `expired` and throws
(`approvalService.ts:191-194`) without updating the draft; `updateDraftApprovalFromRequests`
(`:629-662`) only handles rejected/vetoed/all-approved; nothing writes draft `approvalStatus = 'expired'`; no
job sweeps expired requests; `ownerOverride` (`:347-350`) then finds no pending request (409). The draft stays
`pending` forever, keeps its UTXO locks, and keeps its signing intent live (`pending` counts as live, #1401)
until the draft itself expires.

**Fix.**
1. `updateDraftApprovalFromRequests` sets the draft's `approvalStatus` to `expired` when any of its requests
   is expired (after rejected/vetoed, which take precedence), and the `castVote` expiry path calls it so the
   draft is updated in the same flow.
2. An expiry sweep runs as a maintenance job: pending approval requests past `expiresAt` are resolved
   `expired` and their drafts updated, so a draft no one votes on is also released. It also repairs drafts
   already stuck before the fix (a late vote on `main` marks the request `expired` without updating the draft,
   `:191-192`): drafts with `approvalStatus = 'pending'` that have any `expired` request get
   `updateDraftApprovalFromRequests`. Registered at all three
   sites: `jobs/definitions/maintenance.ts` (`maintenanceJobs`), `worker/jobs/maintenanceJobs.ts` (handler and
   lock key) and `worker/recurringSchedules.ts` (schedule), alongside the expired-draft cleanup.
3. `ownerOverride` (`:340-366`) checks expiry the way `castVote` does, **before approving anything**: if any
   pending request is past `expiresAt`, those requests are resolved `expired`, the draft is updated, and the
   override returns 409 without approving any request or writing any `overridden` policy event.
4. An `expired` draft is not live (already excluded by the D-3 filter) and not broadcastable; the user deletes
   it (releasing locks) and recreates the spend. Notifying approvers/owners of expiry is a non-goal here
   (`notifyApprovalResolved` has no `expired` type; recorded for the backlog).

**Failing-first tests.** `castVote` after expiry → the draft's `approvalStatus` becomes `expired`;
`updateDraftApprovalFromRequests` with an expired request → `expired`; sweep: a pending request past expiry is
resolved and its draft updated; a pre-seeded draft with an `expired` request and `pending` status (the
state `main` leaves today) is moved to `expired` by the sweep; precedence (rejected over expired); owner override on a past-expiry request →
409, request and draft expired, no `overridden` event; with two requests (one expired, one live) the live one
stays `pending` and no `overridden` event is written; the job is registered at all three sites.

---

## Delivery group B — security, operations and CI (PR B, after A merges)

### B1 — step-up password checks are throttled (P2)

**Evidence.** `createTwoFactorRouter(twoFactorLimiter)` passes the limiter only to the verify router
(`api/auth/twoFactor/index.ts:26`); `/2fa/disable`, `/2fa/backup-codes`, `/2fa/backup-codes/regenerate`
(`twoFactor/management.ts:33,88,120`) and `/admin/encryption-keys` (`api/admin/backup.ts:42-56`) re-verify a
password with only the coarse `/api` valve (1000/min/IP). `/2fa/backup-codes` checks the password before
`twoFactorEnabled`, so it is a password oracle for every user; bcrypt runs on the main thread (up to 11
compares per `/2fa/disable` request). Change-password and email-update already have per-user limiters.

**Fix.** A new policy `auth:step-up-password` in `services/rateLimiting/policies.ts`, reusing the
`rl.passwordChange*` limits (no new env var), applied with `rateLimitByUser` (keyed per user, as
`passwordChangeLimiter` is, `api/auth.ts:48`) **after `authenticate` on each route** (`twoFactor/management.ts`
attaches `authenticate` per route; a router-level limiter would key by IP) to the three management routes and
`/admin/encryption-keys`, sharing one budget. An unknown policy name fails open
(`rateLimitService.ts:91-100`), so the policy is also added to the standard-names list in
`tests/unit/services/rateLimiting/policies.test.ts`.

**Failing-first tests.** The 2FA harness stubs the limiter (`auth2faTestHarness.ts:90-99`), so route tests keep
the real `rateLimitByUser` middleware and mock only `rateLimitService.consume`: all four routes consume
`auth:step-up-password` keyed `user:<id>`, and when consume denies they return 429 without calling
`verifyPassword`. In the 2FA harness, the `middleware/rateLimit` mock passes the real `rateLimitByUser` through
(`vi.importActual`) while still stubbing `rateLimit` and `rateLimitByIpAndKey` (`auth2faTestHarness.ts:90-99`),
and the rateLimiting mock (`:84-88`) gains `getPolicy`, because the real `rateLimitByUser` calls it when the
route is built (`middleware/rateLimit.ts:133`). `tests/unit/api/admin-backup-routes.test.ts` (five supertest
requests to `/encryption-keys`, no rate-limit mock today) gains a rateLimiting mock (`consume` allowed,
`getPolicy`) — otherwise the real limiter fails closed with 503 without Redis — and hosts the
`/encryption-keys` 429 and policy/key tests. The seven admin
tests that call the `/encryption-keys` handler as `route.stack[2].handle`
(`tests/unit/api/admin/admin.settings-node-backup.contracts.ts:615-741`) are updated for the extra middleware
(look the handler up from the end of the stack). The policies test fails today on the missing name.

### B2 — public price reads cannot fan out upstream (P2)

**Evidence.** `GET /api/v1/price` has no auth and honours `useCache=false` (`api/price.ts:62-75`), which skips
the cache and calls every provider (`services/price/index.ts:158,202,326-343`); `GET /price/multiple` splits an
unbounded comma list and runs `getPrice` per entry concurrently with no single-flight (`:348-363`), so one
request with thousands of duplicate currencies, or a loop with `useCache=false`, drives thousands of provider
calls, trips the circuit breakers and risks an IP ban.

**Fix.** The price API stays public, but: `useCache` is ignored (reads always use the cache with single-flight
refresh; the only frontend caller already sends `useCache=true`, `src/contexts/PriceContext.tsx:68`, and admins
keep `/price/cache/clear`), with the parameter's OpenAPI docs updated (`openapi/paths/bitcoinPrice.ts:18-24`);
`/price/multiple` deduplicates case-insensitively (the response is keyed by the upper-cased currency, matching
the cache key, `services/price/index.ts:155`), validates against the supported currency set and caps the list
length (400 beyond the cap); `getPrice` gains in-flight single-flight per currency like `getPriceFrom`.

**Failing-first tests.** Route: `useCache=false` is served from cache; duplicate (any case) and over-cap lists
are deduplicated/refused. Service: concurrent `getPrice` calls for one currency fetch once.

### B3 — documented webhook allowlist settings reach the containers (P2)

**Evidence.** README.md:1029-1035 tells operators to set `WEBHOOK_ALLOW_HTTP`, `WEBHOOK_ALLOWED_HOSTS`,
`WEBHOOK_ALLOWED_CIDRS`, which `services/webhooks/endpointPolicy.ts:60,66,70,73` reads, but
`docker-compose.yml` forwards none of them to the backend or worker, so the Test route always reports the URL
blocked and every delivery to an allowlisted LAN/HTTP receiver goes dead on attempt 1
(`deliveryService.ts:139,225-235`). The guard `tests/install/unit/compose-operator-env.test.sh` scans only
`.env.example` and the runbook, and the names are read via `getEnvList(name)`.

**Fix.** Forward the three variables (empty defaults) to both the backend and worker services in
`docker-compose.yml`, and export them in `start.sh` (beside the other operator settings, `start.sh:156-164`;
the guard's check 1 requires it). Extend the guard: add README.md's operator env block as a source (it then
fails today on exactly the three names) and add exact-name entries to `REQUIRED_FORWARDS` for each of the three names on both `backend` and `worker`
(six entries; the guard matches exact keys), because check 3 passes if any one service forwards a key and the worker delivers
webhooks. `is_env_read` already matches `getEnvList(...)`. `config/env/.env.example` does not change.

**Failing-first tests.** The extended guard fails today on the three names (and on a worker-only omission)
and passes after the compose and `start.sh` changes.

### B4 — remediation matches signers in either path notation (P2)

**Evidence.** `signerMatchesKey` (`services/walletRemediation/proof.ts:388,391`) compares the raw
`DeviceAccount.derivationPath` (stored verbatim, `deviceAccountConflicts.ts:146-152`;
`walletRemediationRepository.ts:82`) with the descriptor key path, which the parser normalises to `'`
(`canonicalDescriptor.ts:81-84`), and `parseCanonicalAccountPath` accepts only `'`. A legacy wallet whose
account path is stored as `m/84h/...` always gets `signer.binding_ambiguous` and can never be remediated.
Every other signer-binding path normalises first (`walletAccountSelection.ts`, `deviceReuseAccess.ts`,
the Coldcard export, the safety audit).

**Fix.** Normalise the signer account path (the existing `normalizeDerivationPath`) before both comparisons
in `proof.ts`.

**Failing-first tests.** `proof.test.ts`: the `pathNotation: 'h'` fixture also writes the signer's account
path in h-notation → the document is eligible (today `signer.binding_ambiguous`).

### B5 — the lifecycle callsite gate runs for every file it scans (P2)

**Evidence.** `check:resource-ownership-contract` runs only in quality's `ci-classifier-tests` job (gated by
`run_ci_classifier_tests`, `quality.yml:618,671`) and the Architecture workflow. `is_ci_classifier_file`
(`scripts/ci/classify-quality-scope.sh:102-111`) misses most paths the lifecycle scanner covers
(`start.sh`, `uninstall.sh`, `scripts/setup.sh`, `docker-compose.yml`, `docker/compose/*.yml`,
`scripts/offline/*.sh`, `scripts/ops/*.sh`, `tests/install/**/*.sh`, several workflows), and Architecture's
path filter has none of them, so an unregistered callsite or broad prune merges green (#1181→#1184, #1190,
#1336).

**Fix.** The scanner's scope (`isSourcePath || isHostSourcePath`, `check-lifecycle-callsites.mjs:148-162,1234`)
covers nearly every source file, so widening `run_ci_classifier_tests` would run the ~80-suite classifier job
on almost every PR. Instead, `classify-quality-scope.sh` gains a separate output `run_lifecycle_callsites`,
computed by calling an exported scope predicate from `check-lifecycle-callsites.mjs` once with the whole
changed-file list (exporting is safe: `main()` runs only behind `isMainModule`, `:1380`), and a dedicated
lightweight job in `quality.yml` runs only `npm run check:resource-ownership-contract` when it is true; that job
is added to the quality aggregate's `needs` and allowed-skipped list (`quality.yml:1164-1230`).
`is_ci_classifier_file` keeps gating the classifier suites.
Wiring details:
- `classify-quality-scope.sh`: `run_lifecycle_callsites` is initialised with the other flags (`:15`, `:186`),
  set true in `mark_full_quality` (`:26-32`, so schedule/dispatch/unknown-event/no-base runs check
  everything) and emitted by `emit_outputs` (`:17-24`); the predicate module is imported by a path built from
  `$SCRIPT_DIR` (the test runs the script from a fixture repo, `classify-quality-scope.test.sh:63-77`).
- `quality.yml`: the `determine-scope` job's `outputs:` map gains
  `run_lifecycle_callsites: ${{ steps.classify.outputs.run_lifecycle_callsites }}` (`:62-67`); the new job has
  the usual `DIAGNOSTIC_DIR`, `run-with-log.sh`, upload-diagnostics (`if: failure()`) and diagnostic-summary
  (`if: always()`) steps and needs no `npm ci` (`check-contracts.mjs` uses only node built-ins and local files,
  so the `--strict-allow-scripts` count stays); the aggregate gets `RUN_LIFECYCLE_CALLSITES` and the job result
  in its env and a `require_success` block when true / `allow_success_or_skipped` otherwise, like the other jobs
  (`:1174-1278`).
- `tests/ci/check-workflow-composition.test.sh`: a matching `assert_named_job_step_contains_in_order` case
  (`:4272-4288`), the job added to the diagnostics list (`:4290-4304`) and the pinned artifact count raised from
  13 to 14 (`:4325-4328`).

**Failing-first tests.** `tests/ci/classify-quality-scope.test.sh` cases for `uninstall.sh`, `start.sh`,
`docker-compose.yml`, `tests/install/unit/x.test.sh` → `run_lifecycle_callsites=true` (today the gate is
skipped); schedule and workflow_dispatch → `run_lifecycle_callsites=true`; a parity test that every path registered in `config/resource-lifecycle-callsites.json` triggers it;
the workflow-composition test covers the new job and aggregate wiring.

---

## Verification (every PR)

Focused tests failing first on `e1769d9e`; typechecks (app/tests/all + server `tsc` + `typecheck:tests`);
full `npm run lint`; server and frontend coverage 100%; touched integration specs (registered, cleaned up);
lizard (≤ 84), jscpd, large files, architecture boundaries, safety-catch, wallet-sync checkers, lifecycle
callsites, signer inventory, `arch:check`. **PR A:** critical mutation shard 3 for the changed funds files
(`api/transactions/broadcasting.ts`, `transactionSigningIntentRepository.ts`, `signingIntent/broadcastReconciliation.ts`,
`intentSpend.ts`; `persistTransaction.ts` is in no mutate set), every mutant on changed lines Killed;
Playwright against a static `dist/` for `send-transaction-flow` and `render-regression` (expected local-harness
failures in `auth.spec`/`wallet.spec`/remediation export are pre-existing and need the real API proxy).
**PR B:** classifier and install shell suites; `compose-operator-env` guard. `/simplify` and an adversarial
review before committing.

## Delivery, rollback, deployment

- **Order:** PR A → PR B, serial; hold B locally until A merges; rebase only the next PR; squash; no admin
  bypass; verify `merge_commit_sha` ancestry; wait for every run on the head.
- **Rollback:** each phase is an independent change; no schema or data migration. A4 writes
  `approvalStatus = 'expired'` (an existing enum value) on drafts whose requests expired, including drafts left
  stuck by the current code.
- **User-visible changes:** payjoin sends are recorded; uppercase QR addresses broadcast; multi-recipient fee
  bumps broadcast; expired approvals release their drafts; step-up password checks are rate-limited; public
  price reads cannot bypass the cache; documented webhook allowlists take effect; legacy wallets with
  h-notation signer paths can be remediated.
- **Deployment:** none here (`--deploy final`).

## Completion criteria

- [x] PR A merged; target-branch CI green on its merge commit (#1402, merge `d82d430d21`).
- [ ] PR B merged; target-branch CI green on its merge commit.
- [ ] Every phase's regression test failed on `e1769d9e` and passes on its merge.
- [ ] Owned branches and worktrees cleaned; run state updated.
- [ ] P3 backlog remains outside the blocking fix set.

## Progress

- **PR A — #1402**, squash merge `d82d430d211ef5e3ce0d17683f9c65ebdac3b79c`; target-branch CI green
  (verify-vectors, quality, architecture). Phases A1–A4 delivered as planned. Divergences:
  - The lifecycle classifier lane failed once on a 1–2 s wall-clock wait in
    `tests/ci/registered-collector-process.test.sh` (no code in that area changed); the PR carried a stability
    fix that widens the waits (final argv 5 s, cancellation pid 10 s) with the evidence in its commit body.
  - Generated architecture graph updated for the new `shared/utils/bitcoin` edges from the send flow.
- **PR B** — follows A; adds a guard so a request started before a price-provider reload cannot remove a
  newer request's single-flight entry (found by the commit-hook review).
