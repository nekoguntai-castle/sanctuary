# Iteration 13 Continuation — Five Blocker Remediation Plan

Iteration: 13 (continuation)
Source: target branch `main` @ `d0d492e0681a12227e1eb72ac2725df0c83a8558`.
Supersedes: `docs/plans/iteration-13-eight-blocker-remediation.md` (Phase 1 / F1 / F2 delivered by PR #827 → `048d69f4988fe72a694b56fa279f5e6fa91659aa`; remaining phases revalidated and re-scoped here).
Finding IDs: `concurrent-approval-vote-resolution-last-writer-wins` (F3), `bitcoin-network-switch-retains-placeholder-telemetry` (F4), `non-mainnet-custom-explorer-config-ignored` (F5), `maintenance-weekly-vacuum-parameterized-set-fails` (F7), `webhook-retry-uses-mutated-endpoint-not-delivery-snapshot` (F8).

Goal: remediate the five confirmed blockers that survived revalidation at `d0d492e0`, each with a failing-first non-regression test, in five independently mergeable phases — one per finding.

Non-goals: F6 (`wallet-log-reload-failure-retains-previous-wallet`) is **out of scope — resolved upstream** by `2d1f3e7d5f6e3a44c6a6cbe301d1448bc7f6a0f2` (#951) and verified at this SHA; no work remains. P3 backlog findings are outside the blocking fix set. No product-policy changes, no schema redesign, no unrelated refactors. The recommended Phase 3 option introduces no new columns; if the reviewer selects Option A instead, its additive column is the only schema change this plan permits.

Assumptions: phases are independently mergeable and no phase depends on another's merge. Helper functions named below are implementation steps in the listed owner path, not existing APIs. Merges are strictly serial per `CLAUDE.md` (`block_on_outdated_branch: true`) — rebase only the next PR to merge.

## Revalidation basis (2026-09-11, three independent read-only passes at `d0d492e0`)

| ID | Verdict vs. 2026-08-13 scrub | Change to scope |
| --- | --- | --- |
| F3 | STILL_REPRODUCES (P1) | Two secondary instances added (`ownerOverride`, expiry path); fix must update three tests that pin the buggy contract |
| F4 | STILL_REPRODUCES (P2) | **Narrowed**: Node Status card already fixed by #1008. Four leak sites remain. "Gate identity" clause withdrawn as unsubstantiated |
| F5 | STILL_REPRODUCES (P2) | **Expanded**: two additional call sites; double-prefix contract hazard must be reconciled in the same change |
| F6 | ALREADY_FIXED | Removed from plan |
| F7 | STILL_REPRODUCES (P2) | Confirmed empirically against real PostgreSQL; second production path added; test actively pins the bug |
| F8 | STILL_REPRODUCES (P2) | Contamination broader than URL (secret, signed path, payload profile, retry config); no secret snapshot column exists |

---

## Phase 1 — F3: conditional approval resolution (P1, land first) — IMPLEMENTED

Status: implemented on `codex/bug-scrub-loop/i13-phase1-approval-resolution`.
`updateApprovalRequestStatus` was replaced by `resolveApprovalRequestIfPending`,
which returns `ApprovalRequest | null`; all three resolution paths
(`checkAndResolveRequest` reject/veto/quorum, the expiry sweep, and
`ownerOverride`) now gate the derived draft-status write on having actually won.
Verified: 15,785 backend unit tests pass at 100% statements/branches/functions/lines;
`tsc --noEmit`, `typecheck:tests`, `lint:server`, architecture, Prisma-import,
safety-catch, API-body and `git diff --check` gates all pass.

Per the skill's severity ordering, the P0/P1 work is planned and delivered before the lower-severity phases.

- Owner paths: `server/src/repositories/policyRepository.ts`, `server/src/services/vaultPolicy/approvalService.ts`.
- Tests: `server/tests/unit/repositories/policyRepository/policyRepository.approvals-votes.contracts.ts`, `server/tests/unit/services/approvalService/approvalService.cast-vote-guards.contracts.ts`.

### Root cause
`updateApprovalRequestStatus` (`policyRepository.ts:231-243`) issues `prisma.approvalRequest.update({ where: { id: requestId }, … })` with no status predicate and discards the result. `resolveRequest` (`approvalService.ts:384-390`) ignores the returned row — no re-read, no final-state confirmation. The only status guard is a read-then-check TOCTOU at `:150-166`, separated from the write by three awaits (`:168`, `:175`, `:187`), and `castVote` is not transactional. `schema.prisma:1709-1734` has no version column and no partial unique constraint.

### Contract
1. Resolution becomes a conditional update affecting only rows currently `pending`, returning the affected count. Use `updateMany({ where: { id, status: 'pending' }, … })` — Prisma returns `{ count }` — or an equivalent guarded raw statement. `update()` by id alone must not remain on any resolution path. (`schema.prisma:1735` already carries `@@index([status])`, so the added predicate is indexed; no migration is needed for this change.)

   Note the return-shape change: `updateMany` returns `{ count }`, not the row, while `updateApprovalRequestStatus` is currently typed `Promise<ApprovalRequest>`. The signature must change to express "resolved or not" — returning the re-read row or `null` — rather than being coerced back to the old shape, which would reintroduce the habit of ignoring the outcome.
2. Zero affected rows is a normal, non-exceptional outcome meaning "another resolver won". The caller must not report success and must not write a derived draft status.
3. After a resolution that affected a row, re-read it and confirm the final state before reporting success.
4. Apply the same conditional discipline to the two secondary instances: `ownerOverride` (`approvalService.ts:270-279`), which currently filters `status === 'pending'` in memory and then writes unconditionally, and the expiry write at `:161`, which can overwrite a concurrently-committed resolution.
5. `updateDraftApprovalFromRequests` (`:395`) must derive the draft status only from a confirmed resolution, never from an unverified write.

### Tests (failing first)
- Concurrency: two resolvers race on one pending request (approve vs. reject) — exactly one wins; the loser observes `count: 0` and writes no draft status. Assert the rejected outcome cannot be overwritten by the approving resolver.
- Failure: resolving a non-pending (`rejected` / `vetoed` / `expired`) row affects 0 rows and reports not-resolved without throwing.
- Null: unknown request id → 0 affected, no exception.
- Boundary: an expired-but-pending row is not resolved as approved.
- `ownerOverride` cannot overwrite a concurrently-committed `rejected` / `vetoed` row.

**Required test-debt fix:** `policyRepository.approvals-votes.contracts.ts:149-195` contains three `toHaveBeenCalledWith({ where: { id: 'ar1' }, … })` assertions that pin the defective contract. These must be rewritten to assert the conditional predicate — not deleted.

### Verification
`cd server && npx tsc --noEmit && npx vitest run tests/unit/services/approvalService tests/unit/repositories/policyRepository`
Then the coverage gate, correctly scoped per `CLAUDE.md`: `cd server && npx vitest run --coverage tests/unit`.

### Acceptance
No unconditional `update()` by id remains on any approval-resolution path; every reported success is backed by a confirmed re-read; a rejection can never be converted to an approved draft by a concurrent voter.

### Rollback
Revert the phase PR. No schema or data migration is introduced.

---

## Phase 2 — F7: PostgreSQL-valid bounded statement timeout

- Owner paths: `server/src/jobs/definitions/maintenance.ts`, `server/src/repositories/maintenanceRepository.ts`.
- Tests: `server/tests/unit/jobs/maintenanceDefinitions.behavior.test.ts`, `server/tests/unit/repositories/maintenanceRepository.test.ts`.

### Root cause
`SET statement_timeout = ${timeout}` via `prisma.$executeRaw` binds the value as a query parameter. PostgreSQL does not accept placeholders in the `SET` utility command. Confirmed empirically against `sanctuary-postgres-1` (postgres:16-alpine) over the extended protocol: `ERROR: syntax error at or near "$1"`. Two production paths are affected: `maintenance.ts:359` (which sits **before** the `try` at `:361`, so the `finally` reset at `:379` never runs) and `maintenanceRepository.ts:77`. The weekly VACUUM/REINDEX has therefore never executed; `weeklyVacuumJob` has `attempts: 1` (`:397`) and writes no failure audit, so it surfaces only as a failed BullMQ job.

### Contract
Use the mechanism this codebase already uses correctly elsewhere — `SELECT set_config('statement_timeout', $1, false)`, as at `server/src/repositories/transactions/core.ts:488`, `supportNotificationDiagnosticsRepository.ts:41,169`, `supportWalletSyncDiagnosticsRepository.ts:78`. This keeps the value bound as a parameter and needs no literal validation, so it is preferred over building a `SET … TO '<literal>'` string.

If a literal `SET` form is chosen instead, the interval must be validated in code before interpolation and the change must use `$executeRawUnsafe` with an explicit comment justifying it — never an interpolated `$executeRaw`, whose tagged-template contract is precisely the parameter binding that breaks here.

Additionally: move the timeout application inside the `try` in `maintenance.ts` so the reset in `finally` always runs, and add a failure audit on the job path so a future breakage is observable rather than silent.

### Tests (failing first)
- Assert the emitted SQL is a valid bounded form and that the timeout is **not** passed as a separate bind value to a `SET` statement.
- Failure: a throwing timeout application still runs the reset and records a failure audit.
- Boundary: the reset path (`'0'`) remains a literal and is unchanged.
- Integration (preferred, since the unit layer is fully mocked): exercise the real statement against PostgreSQL so the mock cannot mask a syntax error again.

**Required test-debt fix:** `maintenanceDefinitions.behavior.test.ts:285` asserts `'SET statement_timeout = ?'` and `:293` asserts the timeout arrives as a separate bind value; the same assertion repeats at `:338` and `:433`. These pin the bug and must be rewritten. Note `prisma` is fully mocked at `:42-46`, which is why the defect survived — prefer adding real-PostgreSQL coverage over strengthening the mock assertions alone.

### Verification
`cd server && npx tsc --noEmit && npx vitest run tests/unit/jobs/maintenanceDefinitions.behavior.test.ts tests/unit/repositories/maintenanceRepository.test.ts`

Real-database proof — place the new spec under `server/tests/integration/repositories/` and run it through the guarded entry point. The script takes paths **relative to `server/`**, as the existing `test:ops:phase2` script shows:
`npm run test:integration tests/integration/repositories/<new maintenance spec>` from the repo root (→ `scripts/run-integration-tests.sh`), or `cd server && npm run test:integration:db` for the same script.
There is **no** `test:postgres` script in `server/package.json` — do not use one.

### Acceptance
No `$executeRaw` with an interpolated value targets a `SET` statement anywhere; the weekly vacuum path completes against a real PostgreSQL instance; a regression is caught by a non-mocked test.

### Rollback
Revert the phase PR. No schema or data migration.

---

## Phase 3 — F8: webhook deliveries cannot be redirected by an endpoint edit

- Owner paths (Option B): `server/src/services/webhooks/endpointService.ts`, `server/src/repositories/webhookRepository.ts`, and `server/src/services/webhooks/deliveryService.ts` only where the terminal status is honored.
- Additional owner paths if Option A is chosen: `server/src/services/webhooks/signers.ts`, `server/src/services/webhooks/payloadProfiles/index.ts`, `server/prisma/schema.prisma`.
- Tests: `server/tests/unit/services/webhooks/deliveryService.test.ts` and its fixtures.

### Root cause
`WebhookDelivery` already has snapshot columns `payloadProfile` (`schema.prisma:1219`) and `targetUrl` (`:1220`), written at enqueue (`deliveryService.ts:80-81`) — and never read. A repo-wide grep for `targetUrl` outside generated code returns only that write and a test fixture. Every retry re-reads the **live** endpoint (`claimDeliveryAttempt`, `webhookRepository.ts:298-325`, `include: { endpoint: true }`), and the POST destination is `policy.url` derived from `delivery.endpoint.url` (`:338-342`). The contamination is broader than the URL: the secret (`signers.ts:182-185` — **no secret snapshot column exists**), the signed path (`signers.ts:95`), the payload profile (`payloadProfiles/index.ts:29`), and `maxAttempts` / retry config (`:217`, `:278`). `updateWalletWebhook` (`endpointService.ts:144-176`) changes `url` and `secretEncrypted` without dead-lettering, requeuing, or re-snapshotting pending deliveries.

### Contract decision — RESOLVED 2026-09-11: Option B

The repository owner selected **Option B (dead-letter on endpoint mutation)**. Implement Option B. Option A is recorded below only to document why it was rejected; do not implement it, and do not add a secret-version column under this plan.

- **Option A — pin the delivery to its snapshot.** Retries use `delivery.targetUrl`, a secret reference, and `delivery.payloadProfile`. An in-flight delivery always completes against the destination recorded when the event occurred. **Cost is higher than it first appears:** no secret-versioning exists anywhere today — `schema.prisma:1187` is a single `secretEncrypted String?`, and `getSecretUpdate` (`endpointService.ts:178-182`) overwrites it in place with no history. Option A therefore requires inventing a secret-version mechanism (new column plus a retention/cleanup policy for superseded secrets), not just reading an existing one. Snapshotting the secret *value* onto the delivery row is not acceptable — it would create a second copy of key material with a different lifetime.
- **Option B (recommended) — dead-letter on endpoint mutation.** `updateWalletWebhook` marks pending/failed deliveries for the old destination as terminal, with an explicit status and audit, so nothing is silently redirected. No new columns, no key-material lifetime question, and it closes the security defect completely. The cost is that events pending at the moment of an endpoint edit are dropped rather than retried — which is arguably the correct semantic, since the operator has just repointed the endpoint.

Recommendation changed from A to B during plan review on the evidence above, and the owner confirmed B: it removes the vulnerability without introducing a secret-lifetime design this codebase has no precedent for. Delivery continuity across endpoint edits, if ever wanted, is a separate design task — not a phase of this plan.

Either way, `validateWebhookEndpointUrl` (`deliveryService.ts:128`) must still run against the resolved destination — this change must not weaken the existing SSRF/pinning policy.

### Tests (failing first)
Under the recommended Option B:

- The exact bug: a delivery whose `targetUrl` is `https://old.example/hook` while the joined endpoint is now `https://new.example/hook` is terminal — `claimDeliveryAttempt` does not hand it back for sending, and no request is made to either host.
- `updateWalletWebhook` changing `url` dead-letters pending and failed deliveries for the old destination and writes the audit record.
- `updateWalletWebhook` changing `secretEncrypted` dead-letters them too — a rotated secret must not sign an old event.
- A no-op update (neither `url` nor `secretEncrypted` changing) does **not** dead-letter anything, so ordinary edits keep retrying normally.
- Deliveries already terminal (`succeeded` / previously dead-lettered) are untouched and not double-audited.
- The operator replay path (`endpointService.ts:199-209` → `markDeliveryPendingForReplay`) cannot resurrect a dead-lettered delivery onto a changed destination.
- SSRF/pinning policy at `deliveryService.ts:128` still runs on every surviving send path.

If Option A is chosen instead, replace the first bullet with "the request goes to `delivery.targetUrl`" and add a secret-version-resolution case.

**Required fixture fix:** `deliveryService.fixtures.ts:41` sets `targetUrl: overrides.endpoint.url`, hard-mirroring the two fields and making the bug structurally untestable. The fixture must allow them to diverge.

### Verification
`cd server && npx tsc --noEmit && npx vitest run tests/unit/services/webhooks`, then the backend coverage gate scoped exactly as CI shards it: `cd server && npx vitest run --coverage tests/unit`.
Option B needs no migration. If Option A is chosen, add `npx prisma validate` and a migration review.

### Acceptance
An endpoint edit cannot cause an already-recorded event to reach a destination, or be signed with a secret, that it was not enqueued for. Under Option B this holds because such deliveries are terminal before the next send; under Option A because every send resolves from the delivery snapshot rather than the live endpoint.

### Rollback
Option B changes behavior only — revert the phase PR. Note that deliveries dead-lettered before the revert stay dead-lettered; that is data, not schema, and the PR description must say so. Option A introduces an additive column, so its revert needs a follow-up migration to drop it, stated explicitly in the phase PR.

---

## Phase 4 — F5: network-aware explorer URLs

Split from F4 during plan review. The two were originally grouped as "network identity in the frontend", but they have different root causes and different blast radii: F5 is pure frontend, while F4 must change a shared Zod response schema and the `shared` workspace build. Splitting keeps each diff attributable in the render-regression lane, which is where both 2026-08 dashboard CI failures landed. They remain independently mergeable in either order; `UTXOList.tsx` is touched by both but on different lines (`:57` here, `:59,67` in Phase 5), so the second to land takes a trivial rebase.

- Owner paths: `src/components/UTXOList/UTXOList/useExplorerUrl.ts`, `src/components/TransactionList/hooks/useTransactionList.ts`, `src/components/WalletDetail/hooks/walletDataLoaders.ts`, `src/utils/explorer.ts`, and every call site.
- Tests: `tests/utils/explorer.test.ts`, `tests/components/UTXOList.branches.test.tsx`, plus a new `tests/components/UTXOList/UTXOList/useExplorerUrl.test.ts`.

### F5 root cause and contract
`useExplorerUrl.ts:7` hardcodes `getDefaultNodeExternalServiceUrl('mainnet')`, `:9` takes no network, and `:17` calls `bitcoinApi.getStatus()` with no argument — which `src/api/bitcoin.ts:206` silently defaults to `'mainnet'`. The server is fully per-network capable (`networkStatusService.ts:412` → `nodeConfig.ts:497-506`, reading `explorerUrl` / `testnet3ExplorerUrl` / `testnet4ExplorerUrl` / `signetExplorerUrl`, all editable at `ExternalServicesSection.tsx:45-70`), so a configured non-mainnet explorer is silently discarded. The network is already in scope at the call site: `UTXOList.tsx:54-59` honors it for `useFeeEstimates` and ignores it for `useExplorerUrl`.

**Scope expansion — a hook-only fix is incomplete.** Two further sites share the identical defect: `useTransactionList.ts:40,53` and `walletDataLoaders.ts:185-187` (where `apiWallet.network` is in scope and unused, feeding `AddressActionsCell.tsx:50`). All three must be fixed together.

**Contract hazard — must be reconciled in the same change.** The server's per-network defaults are already path-prefixed (`nodeConfig.ts:80,92,104` → `https://mempool.space/testnet4`), while `src/utils/explorer.ts:22-44` prefixes again, yielding `/testnet4/testnet4/`. Naively passing `network` to `getStatus` therefore introduces a double-prefix bug. Decide which layer owns the prefix, and make the other layer stop.

Unknown or null network must yield no explorer URL and a disabled non-link placeholder — never a default-network URL. Today, with a customized mainnet explorer, `src/utils/explorer.ts:47` returns the base unchanged and sends a testnet4 address to a mainnet host.

### Tests (failing first)
- `expect(bitcoinApi.getStatus).toHaveBeenCalledWith('testnet4')` from `UTXOList` — fails today, it is called with zero arguments — and the equivalent for `useTransactionList` and `walletDataLoaders`.
- Each supported network resolves to its own configured explorer (`explorerUrl`, `testnet3ExplorerUrl`, `testnet4ExplorerUrl`, `signetExplorerUrl`).
- A customized mainnet explorer never receives a testnet address.
- Null/unknown network renders a disabled non-link placeholder, never a default-network URL.
- **An explicit no-double-prefix assertion** — `https://mempool.space/testnet4/address/X`, never `/testnet4/testnet4/`.

### Verification
`npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run`, then the frontend coverage gate `npm run test:coverage` (100% threshold).

Use the npm scripts, not bare `vitest`: there is no `vitest.config.ts` at the repo root — it lives at `config/tooling/vitest.config.ts`, and every root test script passes `--config config/tooling/vitest.config.ts` explicitly. A bare `npx vitest run --coverage` from the root resolves no config and does not run this project's suite.

**Render-regression is mandatory for this phase.** Per `CLAUDE.md`, a green `vitest` run is not sufficient for frontend work: explorer link URLs and dashboard/UTXO values are rendered output, and both CI failures in the 2026-08 dashboard work were in this layer.

The repo scripts for this lane are `npm run test:e2e:render` and `npm run test:e2e:render:update` (baselines under `tests/e2e/render-regression.spec.ts-snapshots/`). **Neither may be run as-is on the host**: `config/tooling/playwright.config.ts` carries a `webServer` block that runs `npm run dev`, which the Docker-only rule forbids. Follow the documented local path instead — `npm run build`, serve `dist/` with any static file server (the app is hash-routed and the e2e harness mocks the whole API, so no backend is needed), and point Playwright at it with a throwaway config that has **no** `webServer` block.

### Acceptance
Zero `getStatus` call sites omit the network; every explorer URL matches the active network with exactly one path prefix; an unknown network never yields a default-network URL.

### Rollback
Revert the phase PR. Frontend-only; no schema, no shared-workspace change.

---

## Phase 5 — F4: network identity on Bitcoin telemetry payloads

- Owner paths: `src/hooks/queries/useBitcoin.ts`, `src/components/Dashboard/hooks/useDashboardData.ts`, `src/components/WalletDetail/useWalletDetailController.ts`, `src/components/UTXOList/UTXOList.tsx`, `src/api/bitcoin.ts`, `shared/types/api.ts`, **`shared/schemas/bitcoinResponses.ts`**.
- Tests: `tests/hooks/queries/useBitcoin.test.ts`, `tests/components/Dashboard/useDashboardData.test.tsx`, `tests/components/UTXOList.branches.test.tsx`, plus wallet-detail controller coverage.

### Root cause
`placeholderData: keepPreviousData` is unconditional at `useBitcoin.ts:22`, `:37`, `:51`. #1008 fixed exactly one consumer — the Dashboard Node Status card, via `buildNodeStatusQueryData` (`dashboardDataModel.ts:254-271`) gating on `data.network === selectedNetwork && !isPlaceholderData`. Four leak sites remain: dashboard fees (`useDashboardData.ts:83`), dashboard mempool (`:86`), wallet-detail confirmation thresholds (`useWalletDetailController.ts:61,139-140`), and `UTXOList.tsx:59,67`, where the prior network's fee rate feeds `getDustStats`.

Withdrawn from the original finding: the "gate identity" clause. No gate parameter exists in the bitcoin query keys or `src/api/bitcoin.ts`; that text was plan boilerplate. Only the network half is real.

### Contract
Stamp the active network onto the payloads so the leak becomes *detectable*, then gate consumers on it — mirroring the `getStatus` stamping at `src/api/bitcoin.ts:206-211` that made the #1008 fix possible. Consumers must treat a network mismatch, or `isPlaceholderData`, as "not yet loaded" rather than rendering it. Same-network refetch must keep using `keepPreviousData`.

**Critical, and the reason this is its own phase — the response schema will silently discard the new field if it is not declared.** `FeeEstimatesSchema` (`shared/schemas/bitcoinResponses.ts:30-36`) is a plain `z.object`, which **strips unknown keys** by deliberate design (documented at `:4-17`: responses strip rather than reject so a lagging client does not break). It is actively applied at `src/api/bitcoin.ts:227` via `{ schema: FeeEstimatesSchema }`. So adding `network` to the server response and to `shared/types/api.ts` **without also adding it to `FeeEstimatesSchema` leaves the field stripped before any consumer sees it** — unit tests built on raw fixture objects would pass while the real `apiClient` path silently fails open, which is the exact failure shape this finding is about. Declare the field in the Zod schema in the same change.

The two payloads are asymmetric and must be handled differently:
- `FeeEstimates` — validated (`bitcoin.ts:227`). Add `network` to `FeeEstimatesSchema` *and* `shared/types/api.ts`. Because client and server ship as one deployment here, the field may be required; if it is made `.optional()`, a consumer must treat absence as "cannot verify identity" and refuse to render, never as a pass.
- `MempoolData` — **not** validated: `src/api/bitcoin.ts:509` is a bare `apiClient.get<MempoolData>` unchecked assertion, with no schema in `shared/schemas`. The field will pass through, but nothing checks its type. Prefer adding a schema alongside the field, consistent with the `#736`/`#738` rationale recorded at `bitcoinResponses.ts:14-16`.

Note also `getMempoolData(network = 'mainnet')` (`:508`) carries the same silent-default hazard as `getStatus` — a missing argument yields mainnet rather than a type error. Audit its call sites in this phase.

### Tests (failing first)
- Dashboard fees and mempool do not render prior-network values while the new query is in flight.
- `UTXOList` dust stats do not use the prior network's fee rate.
- Wallet-detail confirmation thresholds do not come from the prior network.
- **Schema round-trip:** a response carrying `network` survives `FeeEstimatesSchema` parsing — this test fails today and is what proves the stripping hazard above is closed.
- Same-network refetch still uses `keepPreviousData`; rapid switching settles on the last identity only.
- No prior data → loading, not an undefined crash.

### Verification
Same frontend commands as Phase 4, plus the shared workspace: `npm --workspace shared run build` before the typechecks, since `shared/dist/schemas/bitcoinResponses.d.ts` is a published artifact of this change.
Run `npm run arch:check` — it ends in `git diff --exit-code -- docs/architecture/generated`, so any regenerated graph must be committed in the same PR.

### Acceptance
No consumer observes data whose network identity differs from the active one, and the identity field survives response validation end to end.

### Rollback
Revert the phase PR. The `network` fields are additive response fields; confirm no persisted consumer depends on their absence, and rebuild `shared`.

---

## Final verification (after all five phases merge)

- Backend: `cd server && npx tsc --noEmit && npx vitest run`, then `cd server && npx vitest run --coverage tests/unit` (scoped exactly as CI's shards do — a bare coverage run also pulls in integration tests and reports a falsely reassuring number, so a branch covered only by an integration test passes locally and fails CI).
- Backend integration (Phase 2's real-PostgreSQL proof): `npm run test:integration` from the repo root.
- Frontend: `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run`, then `npm run test:coverage`.
- Render regression: Playwright against a static `dist/` build with a no-`webServer` config; baselines current.
- Grep gates: no `update({ where: { id` on an approval-resolution path; no interpolated `$executeRaw` targeting `SET`; no `getStatus()` or `getMempoolData()` call relying on the silent `'mainnet'` default; `network` present in `FeeEstimatesSchema`, not only in `shared/types/api.ts`.
  For Phase 3 the gate depends on the option chosen: under Option B, `delivery.endpoint.url` is still read for surviving deliveries and the gate is instead "no path in `updateWalletWebhook` changes `url` or `secretEncrypted` without dead-lettering pending deliveries". Only under Option A is "no retry path reads `delivery.endpoint.url`" the correct gate.
- Full-suite discipline per `CLAUDE.md`: grep the whole codebase for each pattern before committing; batch related fixes rather than fixing one file and re-pushing.

## Delivery, cleanup, and deployment contract

- Delivery: each phase is one PR to `main` via `$pr-delivery`. Merges are strictly serial — rebase only the next PR to merge, wait for green, merge, verify ancestry, then rebase the next. Do not rebase all open PRs after a merge.
- Branch deletion only after verifying the reported `merge_commit_sha` (not the PR head — squash merges produce a fresh commit) is an ancestor of `origin/main`. Never couple branch deletion to the merge signal.
- If a required status check is missing, emit it via the API pattern from PR #278. Never relax branch protection, never use admin bypass.
- Rebuild policy: `rebuild_policy: defer` for every phase — no container rebuild during implementation.
- Deployment: the run's immutable `containersRunningAtStart` is `false`, so the final deployment must **not** start or rebuild containers even though the stack is currently up. Record a terminal `skipped` deployment operation with the container-status evidence. This preserves the predecessor plan's deployment contract.
- Cleanup: after each merge, delete the owned branch and worktree and update bug-scrub-loop run state (plan metadata, PR record, revision) before starting the next phase.

## Completion criteria

All five findings resolved with merged, CI-verified PRs and non-regression tests that fail before the fix; a terminal `skipped` deployment recorded; then a fresh full-scope scrub at the resulting SHA decides whether the loop terminates.

**Test debt must be corrected, never deleted.** Four items, each of which actively concealed one of these bugs:

| Location | Debt | Phase |
| --- | --- | --- |
| `policyRepository.approvals-votes.contracts.ts:149-195` | Three `toHaveBeenCalledWith({ where: { id } })` assertions pin the unconditional update | 1 |
| `maintenanceDefinitions.behavior.test.ts:285,293,338,433` | Assert the placeholder form `'SET statement_timeout = ?'` and the separate bind value; `prisma` fully mocked at `:42-46` | 2 |
| `deliveryService.fixtures.ts:41` | `targetUrl: overrides.endpoint.url` hard-mirrors the two fields, making the bug structurally untestable | 3 |
| `tests/utils/explorer.test.ts`, `UTXOList` tests | No assertion on *which* network reaches `getStatus`; only that it was called | 4 |

A phase is not complete while its row still describes the tests on disk.
