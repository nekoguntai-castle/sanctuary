# Bug scrub loop iteration 21 remediation plan

**Status:** Reviewing eighth pass: add bounded periodic-poll admission to the existing Phase 3 feature-runtime remediation. Phase 7 owner-page implementation is already complete under plan pin `670697`; preserve that pin and evidence. Only the Phase 3 follow-up requires this revised plan to be reviewed, committed, and recorded in durable run state before implementation.

## Run identity and scope

- **Iteration:** 21, whole repository.
- **Target:** `main`.
- **Scrub baseline:** `5bd498e7d31d0535fe11b82c95a5f65b1e14ecb1`.
- **Reviewed source SHA:** `8e037becf993904dee9e7ee567d5fc18c22a241f`.
- **Evidence:** `/home/nekoguntai/sanctuary/reports/bug-scrub-loop-20260920-iteration21/accepted-findings.json`, `coordinator.md`, `reconciliation.md`, and the four shard reports. `accepted-findings.json` records the original seven confirmed findings. Verification addendum `iteration21-combined/query-plan-standalone-diagnostic.json` confirms an additional owner-page P2: total eight findings, two P1 and six P2, no P0.
- **Caller-owned active goal:** `bug-scrub-loop-20260920t1514z-whole-repo`. Keep it active through nested implementation and complete it only after a fresh complete whole-repository scrub reports zero P0–P2.
- **Deployment:** final-only (`rebuild_policy: defer` for the nested implementation); no rebuild between phases. At loop closeout, rebuild only if the relevant stack was already running at startup, under the loop's crash-safe deployment record.
- **Non-goals:** P3 backlog; speculative hardening; unrelated product-policy changes; broad refactors; production data repair; real database or Docker operations by the plan drafter. Do not widen the findings' existing behavior contracts.

## Delivery and ownership contract — combined PR

**Purpose:** Replace the six-serial-PR delivery contract in the reviewed iteration 21 plan with one combined implementation PR. The original combined-delivery amendment changed publication cadence only; the subsequent reviewed revision added the confirmed Phase 7 owner-page finding. This revision retains that already-pinned Phase 7 work and adds only a bounded periodic-poll admission follow-up to the existing Phase 3 feature-runtime finding; other gates and delivery policy remain unchanged.

**Review/pin gate:** Phase 7 owner-page work is already implemented under plan pin `670697` and is not contingent on this review. Parent and an independent reviewer must review this exact Phase 3 follow-up with the complete plan to convergence. Commit and record this immutable revised-plan revision in durable run state before integrating the poll-admission/comment follow-up into the main worktree. Preserve the former plan pins and provenance for all work already performed; they remain evidence for the source revisions they tested. If review changes the follow-up contract, review and pin the changed revision before proceeding.

### Superseding delivery contract

**Progress at review pass 8:** Source commits 1–7 are complete and the owned branch is clean at `ca418`; Phase 7 remains under plan pin `670697`. The bounded Phase 3 poll-admission/comment follow-up is source commit 8 and remains pending review/pin and implementation. Do not infer completion from the earlier Phase 3 serialization slice or its evidence.

Use the already owned main worktree and `codex/bug-scrub-loop/20260920t1514z-iteration21-mobile-caps` branch. Retain that branch reservation to avoid churn. Phases 1–7 and source commits 1–7 are already integrated; retain their exact reviewed v3 source/test hashes and evidence. Review and integrate only the Phase 3 poll-admission/comment follow-up after the new plan revision is pinned. Then freeze the resulting v4 tree and run the required focused and combined gates before creating source commit 8. Preserve each phase's focused-test logs, reviewer disposition, and exact source diff. Assert that commit 8 and the final PR tree reproduce frozen v4 exactly; normal foreground commits and hooks remain enabled. Any source change invalidates the affected verification evidence and must pass its required checks again. Do not publish an intermediate PR or merge a slice independently.

The seven local slices use this plan order: (1) mobile self-reset caps, (2) guarded integration database preparation, (3) feature snapshot serialization, (4) stale webhook enqueue refusal, (5) fiat-currency price visibility and consumers, (6) backup failure status, and (7) bounded subscription owner-page lookup with supporting fixture cleanup. Maintain the existing finding IDs and evidence. The two DB concurrency/access proofs remain coordinator-owned guarded integration runs; no raw database or Docker command is allowed. The feature worker/queue ownership boundary and all current worktree/branch reservations remain unchanged except for the one retained publication branch.

At amendment drafting, preparation has already produced reviewed slice evidence; the Phase 1 literal backend unit-coverage run reported 100% across all four metrics (session 33849, exit 0). The guarded webhook database ordering proof also passed both tests with signed cleanup (session 53433, exit 0). These prior logs remain useful slice evidence but do not replace final combined-candidate gates; both guarded DB proofs must pass before the single PR is published.

After all seven slices pass their focused gates and parent reviews the full combined diff, open exactly one PR targeting `main`. Do not request `delete_branch_after_merge: true`; no PR is published until the complete combined implementation and reviewable evidence are ready. Wait for all applicable exact-head checks on that immutable PR head, with no required-check bypass and no parallel implementation PRs. If any gate fails, attribute it to the eight separate source commits and their per-slice focused logs; fix the owning slice, preserve failure evidence, and rerun every check invalidated by the changed head. The PR is mergeable only when the full combined exact head passes all required checks.

### Combined local gate before publication

Run each slice's focused gate as specified in its phase section and retain the individual logs. Then run the union of the applicable subsystem gates once against the complete candidate:

- **Backend:** run production and test TypeScript checks, owning shell/guard/provider/workflow/classifier contracts, and the guarded `mobilePermissionAccess` persisted-access plus deterministic webhook endpoint/enqueue ordering tests through their exact `./scripts/run-integration-tests.sh <test-file>` commands. For the final full-suite gates, first run the canonical backend main suite through the receipt-bound disposable database wrapper with `ops-destructive` excluded; then run the guarded destructive suite last; only after those finish and Prisma client generation is complete, run the literal `cd server && npx vitest run --coverage tests/unit` 100% gate serially. Do not overlap coverage with Prisma generation or another test/runtime process. Never run an unordered bare all-tests database invocation. Only the canonical receipt-bound integration harness may own its disposable DB runtime; do not use a real/shared database, direct DB command, or raw Docker command.
- **Frontend:** focused configured test commands for the currency race, animated price, and wallet summary; `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`; `npm run test:run`; `npm run test:coverage` with all four configured 100% coverage metrics; and `npm run build`.
- **Static rendering:** because the combined diff changes displayed output, run the Chromium `tests/e2e/render-regression.spec.ts` matrix against built `dist/`, using the committed scenarios and viewport matrix, a throwaway config with no `webServer`, and a static file server. Do not use host `npm run dev/preview/start` or `npx vite`.

The exact combined diff also determines the applicable repository PR workflows. Wait for every applicable exact-head required check and aggregate; use no classifier override or policy bypass. Before publication, review the complete diff and verify all eight local source commits and evidence map to the eight accepted findings. The combined branch contains no scope beyond the eight reviewed P1/P2 findings.

### Merge, target verification, and cleanup

After the one protected PR merges, record its exact merge-object SHA and verify that object exists and is an ancestor of refreshed `origin/main`. Wait for all applicable target-push workflows to pass on that exact target SHA before cleanup or loop closeout. Then delete the one loop-owned published branch and all loop-owned preparation worktrees/branches only through their recorded ownership workflows; archive the plan pin, per-slice evidence, complete CI receipts, merge ancestry proof, and target-CI proof before removing owned checkouts. Leave exactly one remote branch, `main`, including reconciliation of any new Renovate branches under the already authorized policy. If target CI fails, preserve the owned branch and exact failed-run evidence, diagnose under the repository retrigger discipline, and use a bounded protected recovery PR if a source repair is required; a merged PR cannot be reused. The one-PR optimization describes the successful delivery path and never forbids necessary protected recovery.

Final-only deployment remains deferred under the original active goal. After the combined merge and target-CI verification, complete a fresh whole-repository iteration 22 scrub. Rebuild only after that complete pass proves zero confirmed P0/P1/P2 and only under the existing policy if the relevant stack was running at loop startup. Complete ownership cleanup and durable goal state only under the original final completion gate.

### Tradeoff and acceptance

One combined PR reduces protected-branch and required-CI cycles from six to one, which directly reduces serial waiting. It creates a larger review and exact-head CI diff. Keep review tractable and failure attribution strong through the eight isolated local source commits, the bounded seven-phase plan, separate red/green logs, focused reviewer reports, and the single combined gate above. No slice skips its own evidence or gates to save time, and no test coverage or branch protection is weakened.

- [ ] Parent and independent reviewer approve the Phase 3 follow-up; its exact plan revision is pinned in durable state before that follow-up is integrated. Phase 7 remains governed by pin `670697`.
- [ ] All seven local slices were reviewed and integrated serially on the single owned branch, with separate commits and complete per-slice red/green evidence.
- [ ] Combined backend, frontend, static-render, guarded DB, and owning shell/CI gates pass; complete diff remains within the eight accepted findings.
- [ ] One protected PR passes every applicable exact-head check and merges; merge-object ancestry and exact target-push CI are verified before cleanup.
- [ ] Preparation and publication ownership is archived and cleaned; original final rescrub, deployment, and goal-completion requirements remain satisfied.


## Phase 1 — Preserve wallet-owner mobile permission caps (P1)

**Finding:** `mobile-permissions--self-reset-removes-owner-caps`.

**Evidence and boundary:** `server/src/api/mobilePermissions.ts` exposes authenticated `DELETE /wallets/:id/mobile-permissions` and passes the caller ID to `resetPermissions`; `server/src/services/mobilePermissions/mobilePermissionService.ts` deletes that caller's row; `server/src/repositories/mobilePermissionRepository.ts` deletes by wallet/user. With no row, permission resolution uses role defaults, so a restricted signer can restore owner-disabled actions. The owner-only `clearMaxPermissions` operation is a separate route and behavior. Current tests are `server/tests/unit/services/mobilePermissions/mobilePermissionService.test.ts`, `server/tests/unit/api/mobilePermissions.test.ts`, and `server/tests/integration/repositories/mobilePermissionAccess.test.ts`.

**Implementation boundary:** Follow the mobile design at `/home/nekoguntai/sanctuary/reports/bug-scrub-loop-20260920-iteration21/mobile-design.md`. Add a repository operation that atomically updates the existing `(walletId,userId)` row's 13 self-controlled capability columns to `true`, sets `lastModifiedBy`, omits `ownerMaxPermissions`, and returns update count; never upsert/create a row. Complete repository interfaces for `canApproveTransaction` and `canManagePolicies`, which are already mapped Prisma columns but missing from the capability/create/update types, and forward these two fields from `CreateMobilePermissionInput` through repository `create()` just like the other mapped fields. In the service, resolve current wallet role using existing direct-first/group fallback and reject an outsider before mutation. Existing owner caps remain as the further restriction. A missing row is a successful no-op; no schema migration is needed.

**Tests first:** Extend `server/tests/unit/services/mobilePermissions/mobilePermissionService.test.ts` with a stateful permission row and gateway check: apply an owner `broadcast:false` cap, call the actual service reset path, then assert the actual service gateway check still denies broadcast. Also prove authorized direct and group-only users reset, a missing row/count zero is a successful no-op, and an outsider is rejected with no mutation. In `server/tests/unit/repositories/mobilePermissionRepository.test.ts`, assert both-key scope, all 13 reset fields true, `lastModifiedBy`, and omission of `ownerMaxPermissions`; also assert `create()` forwards `canApproveTransaction` and `canManagePolicies` rather than silently dropping supported inputs. The guarded `server/tests/integration/repositories/mobilePermissionAccess.test.ts` case is required: persisted cap survives reset and repeated reset; no-row behavior is preserved; direct-role precedence and group-only access hold; outsider's stored row stays unchanged. Preserve owner-only cap clear and route self-scope. Run the persisted-access proof only with `./scripts/run-integration-tests.sh tests/integration/repositories/mobilePermissionAccess.test.ts` from the worktree root.

**Phase 1 compatibility amendment (implementation review):** Keeping the permission row must not leave `hasCustomRestrictions` true solely because a reset row exists. In the service effective-permission response and owner-list response, derive this flag from whether any of the existing 13 mapped self capability fields is not true, using `ALL_MOBILE_ACTIONS` and the existing field reader. Keep `hasOwnerRestrictions` separate and unchanged. This aligns those service responses with the existing user-list API predicate without changing role or owner-cap enforcement. Add failing regression assertions for an all-true retained row with owner caps (custom false, owner true, denied action stays denied), no-row false, and any self-disabled capability true; exercise effective and owner-list responses and assert persisted reset metadata in the existing integration case. No API schema or additional production file is needed. This bounded compatibility amendment must be reviewed and pinned before its source edits; already-running tests on the preceding frozen source remain evidence only for that earlier source.

**Acceptance / recovery:** Authenticated self-reset preserves the owner cap at both service and gateway checks; only the owner cap route can clear it; no-row and custom-permission cases behave as the mobile design specifies. Revert the phase commit to restore current reset behavior if a regression appears; no data migration/backfill or runtime cleanup is involved.

**Design gate resolved:** The mobile design note is integrated. The persisted-access case remains guarded and must run through the owned integration harness during implementation.

**Phase checklist:** [ ] regression test fails on baseline; [ ] focused service/repository tests pass; [ ] guarded access integration passes; [ ] broad backend gates pass; [ ] included in the single protected PR with exact target-CI verified; [ ] single combined merge object on `main` and final owned cleanup verified.

## Phase 2 — Guard and report integration database preparation truthfully (P1 + P2)

**Findings:** `integration-db-preparation--guard-migration-target-divergence` and `integration-db-preparation--failed-migration-reports-success`. These share one migration-preparation boundary and must land atomically.

**Evidence and boundary:** `scripts/ci/prepare-integration-db.sh` resolves the guarded URL as `TEST_DATABASE_URL || DATABASE_URL` but invokes Prisma using inherited `DATABASE_URL`; `server/prisma.config.ts` consumes `DATABASE_URL` and can fall back to the Sanctuary database. The wrapper has `set -uo pipefail`, ignores the migration command status, and accepts an existing `public.users` table as success. `scripts/ci/integration-db-guard.mjs` is the shared URL policy; `scripts/ci/check-integration-db.mjs` supplies readiness and schema assertion. Guarded entry points include the direct wrapper, `scripts/ci/resolve-postgres-service.sh`, and integration setup callers such as `server/tests/integration/repositories/setup/database.ts` and `server/tests/integration/setup/testDatabase.ts`. The registered shell contract is `tests/ci/prepare-integration-db.test.sh`.

**Implementation boundary:** Resolve one allowed database URL, then export that exact value to both `TEST_DATABASE_URL` and `DATABASE_URL` for every child, including Prisma, readiness, and assertion. Preserve URL allowlist/explicit opt-in policy and credential redaction. Require both `prisma migrate deploy` success and the subsequent schema assertion to succeed before returning zero; an existing `public.users` table cannot override nonzero migration. A nonzero migration fails fast with its original nonzero status and cannot be overridden by an assertion; preserve bounded retries only for a successful migration whose schema assertion still fails. Do not broaden target policy or change database cleanup authority.

**Tests first:** Add shell-stub cases proving (a) guarded test URL plus different inherited deployment URL makes the migration stub observe only the guarded test URL; (b) unset inherited `DATABASE_URL` cannot route Prisma to the Prisma-config fallback; (c) a failed migrate command with an existing `users` table exits nonzero and never reports preparation success; (d) successful migration plus existing schema succeeds; and (e) successful migration plus missing schema retries exactly up to the configured bound, including eventual success and exhausted-bound failure, while any nonzero migration stops immediately even when the schema is missing. Use synthetic URLs and stub commands; no network or real DB. Run `bash tests/ci/prepare-integration-db.test.sh`, `bash tests/ci/resolve-postgres-service.test.sh`, `node tests/ci/integration-db-guard.test.mjs`, `bash tests/ci/check-integration-db-guard.test.sh`, `bash tests/ci/check-provider-leaks.test.sh`, and `bash tests/ci/check-workflow-composition.test.sh`; add any newly implicated wrapper/classifier contract found by the required full reference search before implementation.

**Acceptance / recovery:** Guard, readiness check, migration, and assertion share one URL; migration failure remains failure regardless of existing schema; existing safe retry and target allowlist behavior remain. Revert the whole atomic phase if failure propagation changes a documented successful path; no schema/data migration is added.

**Focused commands:** Run each owning shell/guard/composition contract listed in Tests first from repository root; all use synthetic URLs/stubs. Do not run the backend full suite locally for this shell-only phase. Use the exact applicable PR and target-branch CI as the broad gate. If a guarded integration smoke is required by evidence, use only the coordinator-owned isolated harness.

**Phase checklist:** [ ] both regressions fail on baseline; [ ] owning shell/guard/provider/classifier/workflow contracts pass; [ ] single combined PR and target-branch CI pass; [ ] single combined merge object on `main` and final owned cleanup verified.

## Phase 3 — Serialize feature runtime snapshot installation (P2)

**Finding:** `feature-runtime--overlapping-snapshot-install-regression`.

**Evidence and design:** `server/src/services/featureFlagService.ts` installs snapshots from initialization, `setFlag`, event callbacks, cache reads, polling, and restore reconciliation. Current generation checks run before awaited cache publication, so an old event can overwrite a newer installed snapshot. `worker.ts` wires the treasury flags into recurring-schedule reconciliation; `middleware/featureGate.ts` consumes `isEnabled`. The bounded design is documented at `/home/nekoguntai/sanctuary/reports/bug-scrub-loop-20260920-iteration21/iteration21-backend-design.md`; it requires one private promise tail for every installation path, with admission checks inside the serialized transition. Avoid queuing `isEnabled`, whose candidate local flags are read by reconciliation itself.

**Implementation boundary:** Implement the design note's single-process serialized transition and failure-isolated promise tail. Keep generation/digest checks inside the owned transition; duplicate/stale snapshots must not mutate local flags, reconcile schedules, or publish stale acknowledgements. Keep local flags/snapshot coherent across failed cache publication or worker reconciliation, do not acknowledge a failed candidate, and leave a failed operation unable to poison later queue work. Put local heartbeat/ack publication behind the same generation-owned transition, including poll/duplicate refresh. Keep outbound event emission and remote roster waits outside the tail. Preserve persisted generations, Serializable writes, restore's committed-but-unreconciled result, Redis eventual-cache behavior, and timer shutdown. No migration or new distributed lock.

**Tests first:** In `server/tests/unit/services/featureFlagService.test.ts` (or a focused sibling), deterministically defer cache publication for generation 2 disable, queue a delayed generation 1 enable, then release in the observed order; assert generation and `isEnabled` never regress. Cover reversed ordering, duplicates, conflicting digest at one generation, three-plus queued changes, no stale reconcile/ack, reconciliation reading candidate flags, failed cache/reconcile then recoverable current poll, and poll/heartbeat acknowledgement ordering. Preserve runtime generation+digest tests in `server/tests/unit/services/featureFlagRuntime.test.ts`, recurring worker caller tests, initialization and shutdown contracts. No live Redis or DB.

**Acceptance / recovery:** Every install source shares the transition owner, acknowledged generation equals the committed local snapshot, stale updates cannot reconcile, and failure recovery remains possible without masking the originating error. No persistent schema change; revert the phase if ordering or restore outcome compatibility fails.

**Focused command:** From `server/`, run `npx vitest run tests/unit/services/featureFlagService.test.ts tests/unit/services/featureFlagRuntime.test.ts tests/integration/worker/featureFlagToggle.integration.test.ts`; backend broad gates are specified above.

**Phase checklist:** [ ] race/regression test fails on baseline; [ ] focused service/runtime/worker tests pass; [ ] broad backend gates pass; [ ] included in the single protected PR with exact target-CI verified; [ ] single combined merge object on `main` and final owned cleanup verified.

# Phase 3 bounded polling-admission amendment

This amendment completes the existing `feature-runtime--overlapping-snapshot-install-regression` remediation. It is not a new baseline finding, phase, or PR. It addresses a boundedness gap in periodic polling while preserving the reviewed single-process serialization design.

## Scope and behavior

Own only `server/src/services/featureFlagService.ts` and its existing focused suite `server/tests/unit/services/featureFlagService.test.ts` for behavior. The already-reviewed documentation-only hook comments may also touch `server/src/services/mobilePermissions/mobilePermissionService.ts`, `server/src/repositories/webhookRepository.ts`, and `server/src/repositories/subscriptionCheckpointRepository.ts`; add no behavior changes in those files.

A five-second timer tick currently starts another durable load and queues another snapshot installation even when an earlier poll is still loading or its installation/reconciliation is waiting on the transition tail. Add a single-flight admission guard for periodic `pollRuntimeState` only. Set the guard synchronously before starting the load; keep it held across durable load and the awaited installation/reconciliation; clear it in `finally` on both success and rejection. A timer tick observed while the guard is held must do no durable load and enqueue no transition. The first tick after settlement must load durable state afresh, so it sees the latest persisted snapshot.

Keep all candidate generation/digest validation, local-cache swap/rollback, reconciliation, publication, and acknowledgement within the existing serialized transition contract. The poll guard must not add a timeout, release serialization while work remains pending, coalesce explicit admin/event/restore operations, or change their admission. Preserve failure-isolated transition-tail behavior: a rejected poll reports through the existing timer error path, clears only its single-flight guard, and a later tick can proceed.

## Tests first and acceptance

Extend the existing feature service tests with deterministic deferred work and fake timers (or the existing timer controls). While a poll's queued install/reconciliation is held, advance multiple timer intervals and assert the durable loader and poll admission each ran only once. Release successfully, advance one more tick, and assert the loader runs again and returns the newly persisted snapshot. Repeat with the held poll rejecting: ticks during the hold remain bounded; after rejection, the next tick reloads and installs current durable state. Assert there is no stale acknowledgement, failed installation restores the process-local cache and current snapshot consistently (without claiming rollback of already-persisted shared cache state), and a later queue operation still succeeds. Keep the existing 63 focused tests and all existing explicit admin/event transition cases passing; do not test by depending on real time, Redis, or a database.

Capture the new regression failing before the production change, then run the focused suite:

```bash
cd server
npx vitest run tests/unit/services/featureFlagService.test.ts tests/unit/services/featureFlagRuntime.test.ts tests/integration/worker/featureFlagToggle.integration.test.ts
npx tsc --noEmit -p tsconfig.json --pretty false
npm run typecheck:tests
cd ..
npm run lint:server
```

Run the pinned Lizard check on the changed production TypeScript files with CCN <= 15 and NLOC <= 200. The feature-focused green evidence must retain all existing tests plus the new held-poll success/rejection coverage. No frontend, browser, shell, guarded database, or integration-runtime gate is invalidated by this backend-only amendment.

After all source is frozen, preserve the required final backend gate ordering: canonical full backend main with `ops-destructive` excluded, then the guarded destructive suite last, then the literal `cd server && npx vitest run --coverage tests/unit` coverage gate serially. Complete Prisma generation before starting coverage; do not overlap the final coverage run with regeneration or another test/runtime process. Retain the existing green frontend, static-browser, shell, and guarded-database evidence because this amendment does not change those sources or contracts.

## Delivery accounting

Keep seven remediation phases, eight accepted findings, and one combined PR. This is one bounded Phase 3 follow-up source commit (the eighth local source commit overall), including the already-reviewed concise hook comments. Preserve separate red/green evidence. No new finding ID or additional phase is created.
## Phase 4 — Refuse stale webhook enqueue after endpoint identity changes (P2)

**Finding:** `webhook-delivery--stale-enqueue-after-endpoint-repoint`.

**Evidence and design:** `server/src/services/notifications/channels/webhook.ts` calls `queueWebhookEventsDeliveries` in `server/src/services/webhooks/deliveryService.ts`; it uses a cached endpoint snapshot to call `server/src/repositories/webhookRepository.ts:createDelivery`. `updateEndpoint` already locks the endpoint row and retires existing pending/failed rows transactionally; a stale enqueue after that transaction can insert a new pending delivery. The bounded backend design at `/home/nekoguntai/sanctuary/reports/bug-scrub-loop-20260920-iteration21/iteration21-backend-design.md` requires admission to share the endpoint lock and compare the protected identity: URL and stored `secretEncrypted`.

**Implementation boundary:** Extend the internal create input with the expected server-side endpoint identity. In one transaction, lock exact `endpointId` plus `walletId` using the same `FOR NO KEY UPDATE` boundary as endpoint updates, load current identity, and only then perform the existing idempotent upsert. Return an explicit safe no-enqueue result for missing/mismatched endpoint. Do not send ciphertext in delivery data, logs, DTOs, request payloads, or errors. On refused admission, delivery service must not increment `queued`, dispatch a worker job, or perform inline send; surface only a categorical safe summary in `errors`. Keep one-endpoint lock scope short and never hold it across queue/network calls.

Preserve the design note's policy boundaries: protect URL and `secretEncrypted` only; ordinary name/enable/filter/header/profile changes keep their existing retry semantics; do not use `updatedAt`; leave claim lease protocol, in-flight request behavior, manual replay (including replay of retired historical rows), and historical `targetUrl` untouched. No schema/migration/backfill or automatic retirement of ambiguous historical rows. Secret ciphertext is compared only to the current stored value to detect rotation.

**Tests first:** In delivery service tests, pause after reading endpoint A, repoint to B, resume enqueue; assert no new delivery, queue call, or inline HTTP, `queued === 0`, and safe error. Repeat same URL with secret rotation and `auth:none` clearing an existing secret. In repository tests prove scope/lock then identity compare happens before upsert; equality permits the existing duplicate-upsert behavior and mismatch/missing refuses without insertion or ciphertext leakage. Add guarded isolated PostgreSQL two-client barrier tests for create-first (updater waits then retires row) and update-first (stale creator waits then refuses), plus duplicate idempotency. Barriers, deadline, and teardown must be deterministic (no sleeps); use the repository's signed cleanup/isolated integration harness. Preserve rename/disable/filter semantics, hidden-header merge, HMAC, manual replay, active lease refusal, and send persistence-conflict tests.

**Acceptance / recovery:** Either create serializes first and is retired by repoint, or repoint serializes first and stale creation is refused. Concurrent duplicates remain one row; replay and already-started attempts retain established behavior. No schema change. If isolated DB proof cannot run under guarded owner policy, do not weaken or skip it; record the blocked gate for the parent.

**Focused commands:** From `server/`, run `npx vitest run tests/unit/repositories/webhookRepository.test.ts tests/unit/services/webhooks/deliveryService.test.ts tests/unit/services/notifications/channels/webhook.test.ts`. Add and register `server/tests/integration/repositories/webhookEndpointEnqueueOrdering.integration.test.ts` in the canonical integration group inventory. Run its two-client locking proof only with `./scripts/run-integration-tests.sh tests/integration/repositories/webhookEndpointEnqueueOrdering.integration.test.ts` from the worktree root, then run existing endpoint/core/signers tests and backend broad gates above.

**Phase checklist:** [ ] stale enqueue and identity tests fail on baseline; [ ] focused unit tests pass; [ ] guarded deterministic DB concurrency tests pass; [ ] broad backend gates pass; [ ] included in the single protected PR with exact target-CI verified; [ ] single combined merge object on `main` and final owned cleanup verified.

## Phase 5 — Bind displayed quote to selected currency (P2)

**Finding:** `price-context--currency-change-retains-mismatched-quote`.

**Evidence and boundary:** `src/contexts/PriceContext.tsx` suppresses stale responses by request ID, but retains the settled `btcPrice` and `priceChange24h` after preferences change. `CurrencyPreferencesContext` / `CurrencyContext` supply the selected currency; `src/components/Settings/sections/DisplaySection.tsx` changes it; `src/components/Amount.tsx` and `src/components/Dashboard/BitcoinPriceCard.tsx` display the retained numeric price using the new currency's symbol. Existing race contract is `tests/contexts/CurrencyContext/priceRefreshRace.test.tsx`; context helpers expose `priceLoading` and `priceError`.

**Implementation boundary:** Prevent an old-currency quote from being represented as the new currency synchronously during render, so a preference update cannot produce even one render with a USD amount and EUR/JPY symbol before an effect runs. Associate price, 24h change, and timestamp with the fiat currency that produced them, and expose them only when that currency matches the current fiat preference. Preserve the same-currency refresh behavior that keeps showing its last valid quote while refreshing, plus request-ID stale-response protection. Do not change provider selection or introduce provider-specific quote visibility policy; do not change API data, currency symbols, formatting, or general stale-response behavior.

**Tests first:** Add to `priceRefreshRace.test.tsx` a settled USD quote followed by EUR/JPY selection. Assert immediately on preference change/render that the old price, 24h change, and timestamp are masked, and the UI never pairs the old amount with the new symbol; retain the assertion after the replacement request rejects. Verify same-currency refresh preserves its last valid quote, successful new-currency response restores matching data, and an older response arriving after the new result remains ignored. Use a local timestamp-observing consumer or extend `tests/contexts/CurrencyContext/helpers.tsx` to assert `lastPriceUpdate`; keep fixtures deterministic. Provider-only changes do not add currency-mismatch behavior.

**Acceptance / recovery:** Every displayed quote, 24h change, and timestamp belongs to the currently selected fiat currency; pending/error cases show no mislabeled number, same-currency refresh retains its last valid quote, and a successful response restores the new-currency quote. Provider-only selection changes do not mask a same-currency quote. No API/schema migration; revert on changes to unrelated preference or display behavior.

**Focused command:** `npm run test:run -- tests/contexts/CurrencyContext/priceRefreshRace.test.tsx`; run the full frontend gates and static render regression because this changes displayed price state.

**Phase checklist:** [ ] render-time mismatch test fails on baseline; [ ] focused race tests pass; [ ] all frontend type/test/coverage/build gates pass; [ ] static `dist/` Chromium render suite passes; [ ] included in the single protected PR with exact target-CI verified; [ ] single combined merge object on `main` and final owned cleanup verified.

### Phase 5 bounded consumer amendment

This amendment completes the existing `price-context--currency-change-retains-mismatched-quote` finding. It does not add another finding or broaden quote ownership beyond the selected fiat currency.

#### Bounded source and test scope

Production files:

- `src/contexts/PriceContext.tsx` — retain the current fiat-currency-owned quote and render-time masking of price, 24-hour change, and timestamp.
- `src/components/Dashboard/PriceChart/useAnimatedPriceValue.ts` and `src/components/Dashboard/PriceChart/AnimatedPrice.tsx` — make a null price immediately render the placeholder even when animation state retains the previous number; cancel any pending animation frame, clear `isAnimating`, and reset its previous-value baseline on null. When a later quote arrives after that unavailable interval, seed the display with the new value without interpolating from the prior currency. Preserve interpolation for ordinary non-null same-currency updates. Do not key by symbol (USD and CAD may share one) or provider.
- `src/components/WalletStats.tsx` and `src/components/WalletStats/WalletSummaryCards.tsx` — pass a null fiat balance through instead of coercing it to zero. Render an explicit unavailable placeholder when the balance is null and fiat display is selected; keep a real numeric zero displayed as zero.

Focused tests:

- Extend `tests/contexts/CurrencyContext/helpers.tsx` and `tests/contexts/CurrencyContext/priceRefreshRace.test.tsx` with a render-snapshot observer. After a settled USD quote and an EUR preference change, assert that the first render observing EUR already has null price, 24-hour change, and timestamp. Assert no observed EUR render pairs the previous USD amount with the EUR symbol, through both pending and rejected request states. Keep the existing successful-new-currency, same-currency refresh, provider-only, and stale-response cases.
- Extend the `AnimatedPrice` cases in `tests/components/Dashboard/PriceChart.test.tsx`: non-null USD → null while the animation has a pending frame renders the placeholder synchronously and cancels/reset the old animation; null → new-currency price displays that new value directly without an old→new intermediate value; normal non-null price changes still animate. Assert no stale direction indicator after null-to-new. Exercise queued-frame cancellation and no post-null state update under normal RAF semantics; do not require artificially invoking an already-cancelled callback.
- Extend `tests/components/WalletStats.test.tsx`: with `showFiat`, a null quote/value renders the explicit unavailable placeholder and loading caption rather than a currency-prefixed zero; a legitimate `fiatBalance: 0` still renders numeric zero.

#### Test-first execution and acceptance

1. Add the consumer and first-render regressions before production edits. Capture them failing against the current implementation: the dashboard retains its local `displayValue` after context price becomes null, and WalletStats currently changes null fiat conversion into zero.
2. Implement only the quote-null animation reset and null fiat-balance propagation described above. Leave request-ID stale-response logic and provider behavior unchanged.
3. Run focused tests with the configured tooling:

   ```bash
   npm run test:run -- tests/contexts/CurrencyContext/priceRefreshRace.test.tsx tests/components/Dashboard/PriceChart.test.tsx tests/components/WalletStats.test.tsx
   npm run typecheck:app
   npm run typecheck:tests
   ```

The gate is: the first render after fiat selection cannot expose any old-currency price, percent, timestamp, animated value, or fiat balance; a new-currency quote appears without cross-currency interpolation; null stays visibly unavailable through pending/error; numeric zero stays numeric; same-currency and provider-only transitions preserve the last quote; ordinary same-currency price changes continue to animate; and stale request/animation completions cannot replace current UI state. No API, schema, provider-specific visibility, unrelated preference policy, or broad UI refactor changes are part of this amendment.


## Phase 6 — Mark failed scheduled backup as failed (P2)

**Finding:** `ops-backup--failed-dump-retains-success-status`.

**Evidence and boundary:** `scripts/ops/sanctuary-backup.sh` runs with `set -euo pipefail`; its `fail()` function writes failed status, but `dump_database` is invoked as an ordinary command at the script's top-level sequence. A failed function/pipeline exits through the EXIT trap before the explicit `fail()` path can update status, leaving the previous success marker. `scripts/ops/install-sanctuary-backup.sh` generates a systemd ExecStart that calls the script directly. Registered contract is `tests/ci/sanctuary-backup.test.sh`; status machinery and existing stubbed Docker commands are in the production script/test harness.

**Implementation boundary:** Capture the `docker exec pg_dump | gzip` pipeline's component exit codes before `set -e` can exit the function, then route pipeline failure through the existing bounded `fail()` status writer while preserving a nonzero pipeline result if status writing fails. Do not add a global EXIT handler that writes `failed` for unrelated early exits such as lock contention. A failed `pg_dump`/gzip pipeline must publish no partial daily or weekly backup. Keep success status after all backup/rotation work only. Do not alter backup format, retention, lock ownership, production data, generated service policy, or container ownership.

**Tests first:** Extend the registered shell contract to start from an existing success status, stub `docker exec`/`pg_dump` failure and gzip failure separately, then assert nonzero exit, a fresh failed status/reason, and no partial published backup. Force failed-status writing to fail and prove a pipeline-specific nonzero result remains. Also prove an unrelated pre-dump lock-contention exit does not overwrite the prior status. Retain success, dry-run, duplicate timestamp, cleanup trap, output permissions, weekly, and rotation assertions. Stubs only; no Docker or real backup data.

**Acceptance / recovery:** A failed dump pipeline leaves a fresh failed status and nonzero process exit; status-write trouble cannot turn it into success or replace the originating failure, and no partial dump is published. Successful run writes `ok` only after the whole sequence; unrelated pre-dump failures retain existing status semantics. No format/schema migration or production backup mutation.

**Focused command:** `bash tests/ci/sanctuary-backup.test.sh`; broader shell/ops CI applies as classified by exact PR diff.

**Phase checklist:** [ ] pg_dump/gzip regressions fail on baseline; [ ] registered shell contract passes; [ ] applicable CI passes; [ ] included in the single protected PR with exact target-CI verified; [ ] single combined merge object on `main` and final owned cleanup verified.

## Phase 7 — Bound subscription owner lookup under skewed wallet populations (P2)

**Finding:** `subscription-owner-page--wallet-driven-unbounded-address-scan`.

**Verified failure:** Parent-controlled guarded standalone diagnostic session 66923 ran the actual `findSubscriptionCheckpointOwners` query captured through a call-through Prisma spy, preserving the full production projection and bindings. With 39 explicitly owned testnet3 distractor wallets and one signet wallet containing 10,202 addresses, the query returned 200 rows but visited 10,202 addresses (existing bound 400). Four other tests passed, the regression failed as expected, and signed cleanup finished `cleaned` at `/tmp/sanctuary-cleanup-local.a7tvY1`. Source was restored exactly. Evidence is externally archived under `iteration21-combined/query-plan-standalone-{diagnostic.json,instrumented.test.ts,run.json}` and `query-plan-standalone.log`. Earlier narrow-projection and reordered attempts remain diagnostic history, not substitute acceptance evidence. This confirmed P2 was subsequently repaired under plan pin `670697` and source commit `ca418630685fa75b05d53a25d70a4a7152bdd9eb`; the focused guarded suite passed 62 tests with verified cleanup. The following root-cause and implementation details retain that completed revision’s rationale and contract; they do not authorize repeating it under the Phase 3 follow-up pin.

### Original root and test-isolation evidence

`server/src/repositories/subscriptionCheckpointRepository.ts:112-146` implements the owner reader with three ordinary joins, then filters by checkpoint network/hash/status and wallet network, orders by checkpoint address ID, and limits to 200. With the planner starting from a matching wallet, it loads that wallet's full address population before applying the owner checkpoint filter and limit.

The existing `findPendingSubscriptionEnrollments` immediately below uses the desired local pattern: scan checkpoint candidates, then `INNER JOIN LATERAL` to an address/wallet lookup by the checkpoint's primary-key address ID with the wallet network filter inside the lateral subquery and `LIMIT 1`. Use this established shape for owner lookup too; preserve the full existing result projection and checkpoint filters.

The preceding suite also has a real cleanup defect. In `server/tests/integration/repositories/transactionSyncReconciliation.test.ts`, `createWalletFixture()` and three other call sites create wallets, but `afterEach` deletes only tracked users. `Wallet` has no direct user foreign key; deleting a user cascades the `WalletUser` join row, not the wallet. Wallet addresses and checkpoints therefore remain live. The diagnostic's 40 live wallets / 10,239 live addresses are consistent with this leakage plus the target test's 10,202 rows. This leakage explains why the original test failed only in that sequence, but fixing cleanup alone would conceal the owner query's excessive work under realistic mixed-network wallet populations.

### Completed bounded implementation contract

1. **Standalone regression first, red on unchanged production SQL.** Make `syncIntentReaders.test.ts` self-contained: create exactly one large signet wallet with its existing 10,000 quiet, 201 pending, and one rolling-writer addresses, plus 39 deterministic distractor wallets on `testnet3` with one address each. The test must reproduce the `> 400` address-touch failure when run alone against unchanged production SQL; do not depend on a previous-suite leak. Use unique fixture IDs, analyze the three involved tables as today, and keep the 200-row result and `<= 400` address-touch assertions.
2. Capture the `$queryRaw` argument while calling the real `findSubscriptionCheckpointOwners` function, delegate the spy to the original Prisma method, validate the returned page projection, then restore the spy in `finally`. Build EXPLAIN by composing the captured `Prisma.Sql` as a nested interpolation so the original query and bound values are preserved; do not manually reconstruct its SQL text or bind list:

```ts
const explainSql = Prisma.sql`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${capturedSql}
`;
```

Explain that captured query directly. This proves the plan for the repository's full production projection rather than another hand-written narrow SELECT. Assert the first page IDs and representative returned owner/checkpoint fields, and assert a second cursor page is ordered, unique, and correct.

3. Require both proof gates before accepting the production finding: the standalone mixed-network test is red with unchanged production SQL and the captured exact-production-query/full-projection EXPLAIN shows the corresponding excessive address visits. Do not weaken bounds or rely on a full-suite leak to make it red.
4. Change only `findSubscriptionCheckpointOwners` to the already-established checkpoint-driven `INNER JOIN LATERAL` owner lookup: select the address fields plus wallet network from an exact `addresses.id = checkpoints.addressId` lookup joined to wallets, filter normalized wallet network inside the lateral query, `LIMIT 1`; retain checkpoint network/hash/status/cursor filters, all returned columns, ordering, and outer page limit. Do not add a migration in this amendment. If exact-query plan still cannot meet the address-touch bound using existing address/checkpoint primary-key and checkpoint network/script-hash indexes, stop and request a separately reviewed schema/query plan rather than adding an unplanned index.
5. Repair test isolation in `transactionSyncReconciliation.test.ts`: track every created wallet ID (including the `createWalletFixture` helper and the three direct `createTestWallet` call sites), delete those wallets in `afterEach` before deleting users, and retain existing trigger/function cleanup. This is supporting hygiene; the self-contained mixed-network owner regression remains the production behavior proof.

### Ownership, scope, rollback, and verification

Keep this as one bounded source slice within the already-authorized combined single PR; do not create a separate PR or migration. Own only `subscriptionCheckpointRepository.ts`, `syncIntentReaders.test.ts`, `transactionSyncReconciliation.test.ts`, and the focused `subscriptionCheckpointRepository.test.ts` if its SQL-shape assertion needs updating. No broader repository refactor, wrapper change, or fixture cleanup sweep.

Rollback is limited to reverting those query/test edits together; no schema state needs rollback. Preserve all seven previously reviewed regression proofs and the previously green frontend/browser/unchanged-production checks. After source freeze, replay the affected gates: the subscription-checkpoint repository unit test; both `transactionSyncReconciliation` and `syncIntentReaders` through the guarded wrapper on one fresh DB (suite order is irrelevant because the regression now owns its entire fixture); and the existing owner-query consumers' focused `subscriptionCheckpointLifecycle` and `walletSyncCrossNetworkContract` integration specs. These focused replays do not waive the final canonical full backend main. After all source changes are frozen, run the canonical full backend main with ops-destructive suites excluded, then run the destructive suite last under its existing guarded lifecycle. Also run the literal unit-coverage, type, and size gates required by the pinned plan on the final combined diff. Preserve the frontend/browser gates as unaffected and retain their existing green evidence; do not restart them absent a relevant failure.

The exact production-query and standalone red gates passed before implementation under pin `670697`. Phase 7 is now implemented and focused verification is complete. Retain that evidence and source unchanged except for the permitted explanatory comment; the final combined backend replay and single PR delivery remain pending after the Phase 3 follow-up.


**Phase checklist:** [x] exact production-query standalone regression fails on unchanged source; [x] retain deterministic regression and repair bounded query/fixture cleanup; [x] focused guarded proofs pass; [ ] final combined backend gates pass after the Phase 3 follow-up; [ ] included in single combined PR with exact head/target CI and owned cleanup.

## Final completion gate

- [ ] All seven local phases for eight confirmed findings integrated serially and reviewed, with eight separate source commits and recoverable per-slice red/green evidence.
- [ ] Combined candidate passes the complete backend suite with destructive tests last, literal backend unit 100% coverage, backend production/test types, frontend types/full tests/100% coverage/build, static Chromium matrix, both guarded DB proofs, owning shell/CI contracts and applicable quality gates before source commits/publication. Preserve the frozen tested source tree through normal foreground commits and verify final PR-head identity.
- [ ] One protected PR passes every applicable exact-head check; its reported merge object exists and is an ancestor of refreshed `origin/main`. All applicable exact target-push CI passes before cleanup. A necessary protected recovery PR remains allowed after a diagnosed post-merge failure.
- [ ] Plan and durable state map all eight findings to seven remediation phases, eight source commits, and the single PR/merge/target-CI proof; original and amended reviewed plan pins remain recoverable.
- [ ] Archive all owned source/evidence and delivery history, clean the publication branch and every recorded preparation branch/worktree, then remove the final owned worktree. Preserve unrelated work. Verify exactly one remote branch, `main`, including any required Renovate reconciliation.
- [ ] Run a fresh complete whole-repository iteration 22 scrub against that exact current `main` SHA. Continue the loop unless coverage is complete and there are zero confirmed P0/P1/P2 findings. Preserve existing P3 backlog unless fresh source changes the evidence.
- [ ] Only after that clean pass, apply final-only deployment policy if the relevant stack was running at startup, through the repository command with crash-safe pending state and verified identity, health and readiness. Complete the caller-owned goal and durable state only after delivery, rescrub, owned cleanup and deployment gates all pass.
