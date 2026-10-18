# Bug-scrub loop 20261013 — iteration 6 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 6
- **Source SHA:** `a09b6a934ebce0a392f747ee6243545b04675052` (`main`, after #1397/#1398)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (9, all P2):** below. P3 findings are backlog in run state and are **outside this
  fix set**.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `rbf-draft-resume--replaces-link-lost` | P2 |
| A2 | `broadcast-retry--no-external-output-retry-busy-forever` | P2 |
| A3 | `vault-policy--payjoin-receiver-contribution-counted-as-spend` | P2 |
| A4 | `signing-intent--24h-expiry-strands-drafts-and-approvals` | P2 |
| B1 | `mcp-transport--batch-bypasses-rate-limit` (recurring; failed fix in #1390) | P2 |
| B2 | `auth-email-update--same-address-resets-verification` | P2 |
| B3 | `device-detail--load-error-shown-as-not-found` | P2 |
| B4 | `wallet-list-balance-chart--failed-history-drawn-as-flat-line` | P2 |
| B5 | `ci-classifier--emulator-inventory-docs-not-wallet-safety-critical` | P2 |

## Goal and non-goals

**Goal:** fix every P0–P2 confirmed by the iteration-6 scrub, each with a regression test that fails on
`a09b6a93` and passes after the fix, delivered through protected PRs with green CI.

**Non-goals:** the P3 backlog (including this iteration's `rate-limit-redis--eval-error-fails-open`,
`broadcast-reconcile--claims-ready-intent-after-route-release`, `device-detail--rename-and-share-failures-silent`,
`wallet-detail--full-resync-offered-to-read-only-roles`, `feature-flag-audit-log--total-is-page-length`,
`intent-spend--full-address-scan-per-evaluation`); new Prisma migrations (forbidden); new HTTP endpoints.

## Decisions (recorded)

- **D-1 (B5, decided by the operator 2026-10-17).** Close the proof-source gap in the CI classifiers
  only. `config/wallet-safety-critical-paths.json` is unchanged, so the release audit-review gate
  (`scripts/release/verify-wallet-safety-audit-review.mjs`, which reads the same manifest) keeps its
  current scope and `tests/release/wallet-safety-audit-review.test.mjs:233` stays as is.
- **D-2 (A4, superseded by D-3).** The pass-1–9 design extended and shortened the intent's stored
  `expiresAt`. Implementation found that migration `20260810170000_add_transaction_signing_intents`
  installs the `BEFORE UPDATE` trigger `transaction_signing_intents_protect_snapshot`, which raises 23514
  ("authorization snapshots are immutable") when `expiresAt` changes; a new migration is forbidden. The
  design was abandoned before any of it shipped.
- **D-3 (A4, decided by the operator 2026-10-17).** Draft-derived liveness: `expiresAt` is never written.
  An intent past its stored expiry is still live while an actionable draft in the same wallet references
  it and that draft has not expired. A4 ships as its own PR (PR C) after PR B.

## Assumptions and constraints

Same as iteration 5: funds-critical files go through critical mutation shard 3 (re-pin ranges if lines
shift; no new `finalize*` helper); new sync-path repository calls listed in
`config/wallet-sync-mutation-boundaries.json`; new integration specs registered in
`scripts/ci/backend-integration-groups.sh`; lizard gate 86 (measured 84 at `a09b6a93`, must not rise);
coverage 100%; test files under 1,000 lines; integration specs must clean up after their last test (an
`afterAll` cleanup) because CI runs every integration file in one database.

---

## Delivery group A — funds and policy (PR A: A1–A3; A4 ships separately as PR C after PR B)

### A1 — broadcast derives the RBF replacement link from the signing intent (P2)

**Evidence.** `server/src/api/transactions/broadcasting.ts:236-249` `resolveReplacementContext` uses only
the request's `replacesTxid`. An approval-required RBF bump (iteration-5 D-1) is created `pending` and
broadcast later via Drafts → Resume, which sends no `replacesTxid` (`sendTransactionPageHelpers.ts:183`
sets it null; `src/api/drafts.ts:80-83` documents it is not persisted). The bump is then evaluated and
reserved as a new spend (spending window double-counts; velocity counts an extra tx; near a limit the
bump is blocked by its own original), and the original is not linked as replaced. The authenticated
snapshot already carries `transaction.replacementTxid` (`signingIntent/schema.ts:16`, surfaced by
`deriveIntentSpend`, `intentSpend.ts:87`), and draft creation already uses it.

**Fix.** Derive the link once, beside `buildCanonicalMetadata` (which already calls `deriveIntentSpend`),
and use it in **both** handlers — `handleTransactionBroadcast` (`:471`, `:479`) and `handlePsbtBroadcast`
(`:500`, `:504`; its schema also accepts `replacesTxid`, `shared/schemas/mobileApiRequests.ts:365`).
Broadcast takes the replacement txid from the authenticated snapshot when present; a request
`replacesTxid` that disagrees with the snapshot is rejected (400) rather than trusted; the request field
is used only when the snapshot has none (legacy intents). The mismatch check runs before
`reservePolicyUsage`, so a 400 never reserves policy usage. The same derived value feeds
`resolveReplacementContext`, the persisted metadata's `replacesTxid`, and `broadcastAndSave`'s
replacement-link check, so a resumed bump links the original.

**Failing-first tests.** In a new spec file
`server/tests/unit/api/transactionsSigningIntentBroadcast.replacement.test.ts` (the existing file is 850
lines; add the new file to the critical Stryker command-runner list in `server/stryker.critical.config.mjs`),
for both handlers: broadcast of an RBF intent with no `replacesTxid` in the body → the policy
evaluation receives `{ replacedAmount, isReplacementBump: true }` and the persisted metadata carries the
snapshot's txid (fails today: `{}` and no link). Mismatched body vs snapshot → 400. Legacy intent without
`replacementTxid` + body value → unchanged behaviour.

### A2 — a no-external-output broadcast can be retried after an unknown outcome (P2)

**Evidence.** For consolidations and CPFP children `reservePolicyUsage` returns `NO_POLICY_USAGE`
(`broadcasting.ts:310`) and the route persists `policyReservations: []` (`:416`). On a user retry the
claim is fresh (`keepHeldReservations`), and `holdsPolicyReservations`
(`transactionSigningIntentRepository.ts:128-130`) treats any array — including `[]` — as held, so
`guardHeldReservations` (`:132-149`) keeps only the `ready` step and the retry is busy (409) forever.

**Fix.** An empty `policyReservations` array is not "held": `holdsPolicyReservations` requires a
non-empty array. (No reservations exist to overwrite, so the resume steps are safe.)

**Failing-first tests.** Repository: stored metadata with `policyReservations: []` and a fresh
`keepHeldReservations` claim on an `unknown` intent → resumes (today: busy). Route: a consolidation retry
after an unknown outcome → claims and broadcasts. Existing non-empty guard tests unchanged.

### A3 — payjoin receiver contributions are not counted as the sender's spend (P2)

**Evidence.** `deriveIntentSpend` (`intentSpend.ts:79-86`) sums every non-wallet output and ignores the
snapshot's input roles (`schema.ts:24`: `'wallet' | 'payjoin_peer'`). In BIP78 the receiver adds an
input C and raises its output from P to P + C (`payjoinProposalValidation.ts:93-96`), so the proposal is
evaluated and reserved at P + C. `/payjoin/attempt` checks the original at P (`payjoin.ts:~327`), so a
payjoin is attempted, then broadcast re-evaluates at P + C (`broadcasting.ts:~329`) and can refuse with
403 `approval_required` when an `amountAbove` threshold lies between P and P + C; spending windows
over-reserve by C.

**Second defect on the same path (found in plan review).** The web client's payjoin branch
(`src/hooks/send/useSendTransactionActions.ts:187-198`) swaps only `psbtBase64`, `intentId`,
`intentDigest` and `signingContext` into the result, so `useBroadcast.ts:339-350` still sends the
original `amount`, `fee` and `utxos`, and `assertOptionalMetadata` (`api/transactions/broadcasting.ts:464`,
before `reservePolicyUsage` at `:471`) returns 400 `metadata_mismatch` — today on `amount`, and after the
server fix on `utxos` (the canonical set includes the peer input, `assertExactOutpoints` `:173-187`) and
possibly `fee`. Web payjoin sends therefore fail before policy is ever checked.

**Fix.**
1. `deriveIntentSpend`'s `amount` is the sum of external outputs minus the sum of `payjoin_peer` input
   amounts (floored at 0); `externalOutputs` stay as they are (address controls still see every
   recipient). P is the correct net figure (sender outflow = external − peer contribution + fee).
2. Consumers of that amount, all of which now see P: policy evaluation and reservations (draft
   creation, create-route echo, payjoin attempt, broadcast), the persisted wallet-history amount
   `-(amount + fee)` (`services/bitcoin/transactions/persistTransaction.ts:129`), the notification and
   `transactionSent` event amount/recipients (`services/bitcoin/transactions/broadcasting.ts:435,448-450`),
   `recordMonitorUsage` (`api/transactions/broadcasting.ts:382-389`) and the body/draft amount checks
   (`:204`). Intents claimed before the deploy reconcile with their stored metadata
   (`broadcastReconciliation.ts:40`); acceptable for legacy rows.
3. The client's payjoin branch replaces `utxos` (every proposal input, the peer input included) and
   `fee` (the proposal fee) with the proposal's values, and the amount with the **canonical amount the
   server derives for the proposal intent**, which `/payjoin/attempt` returns (`deriveIntentSpend` on the
   new intent). It is P only when the receiver pays no extra fee: BIP78 lets the receiver raise the fee by
   r out of its own contribution (`payjoinProposalValidation.ts:85-98` forbids lowering sender outputs, the
   fee policy allows up to +50%), so the receiver output is P + C − r and the net amount is P − r, keeping
   amount + fee = the sender's real outflow. `assertOptionalMetadata` compares the body/draft amount
   against it (`:203-205`), so the client must not recompute it. Because a payjoin saved as a draft is
   built from the same `txData` (`src/hooks/send/useDraftManagement.ts:85-108`) and broadcast checks
   `draft.selectedUtxoIds` unconditionally (`:217-223`) and `draft.fee`/`effectiveAmount` (`:204-207`),
   omitting fields is not enough: the stored `txData` itself carries the proposal's outpoints, fee and
   canonical amount.
4. **How the amount is returned.** `/payjoin/attempt` builds `{...result, proposalPsbt, ...replacementIntent}`
   (`api/payjoin.ts:376-380`) and `createSigningIntent` returns only the handle (`service.ts:88`). The
   route therefore loads the just-minted intent with `loadSigningIntent(handle, walletId)` and returns
   `amount: deriveIntentSpend(...).amount` from that **persisted** snapshot (no change to
   `createSigningIntent`/`service.ts`). Contracts: `PayjoinAttemptResponseSchema`
   (`shared/schemas/bitcoinResponses.ts:69-75`) gains a required non-negative integer `amount` on the
   success branch; OpenAPI `PayjoinAttemptResponse.oneOf[0]` (`server/src/api/openapi/schemas/payjoin.ts:77-89`)
   gains it in properties and `required`, with the pin in
   `server/tests/unit/api/openapi.psbt-signing-context.test.ts:44-58` extended. The client success guard
   (`useSendTransactionActions.ts:187-189`) also requires `amount`; without it the client falls back to the
   original transaction rather than mixing the proposal's PSBT/fee/outpoints with P, and also when the
   amount is 0 (the server floors it; 0 can be neither broadcast nor saved as a draft).
   **Implementation divergence (adversarial review):** reloading the intent after creation put
   fallible DB work after the original intent was superseded, so a transient error stranded the user on a
   stale intent. Issuance is split into `prepareSigningIntent` (validate and build snapshot/digest, no
   write) and `persistSigningIntent` (the single write; `createSigningIntent` is prepare then persist and
   still returns only the handle, because seven routes spread it into their JSON). The route pre-fetches
   the wallet's address set, prepares the replacement, runs `deriveIntentSpend` on the prepared snapshot,
   refuses a net amount ≤ 0 (or a derive error) with nothing persisted, and only then persists and
   supersedes. No gateway route,
   mobile contract, e2e mock or agent/MCP path uses `/payjoin/attempt`.
**Failing-first tests.** `intentSpend.test.ts`: a snapshot with a `payjoin_peer` input (and multiple
peer inputs) of C and the receiver output at P + C → `amount === P`; floor at 0. Route (in the new
replacement spec file or another new file): broadcasting a payjoin proposal **with the client's real
body** — after the client fix — under an `amountAbove` policy whose threshold lies between P and P + C →
not refused; the spending-window reservation equals P; the persisted transaction amount is −(P + fee).
Route tests (`server/tests/unit/api/payjoin.test.ts` success cases): the response carries the
canonical amount, P − r when the receiver raises the fee. `payjoin.test.ts` mocks `loadSigningIntent` with one default
envelope that has no `snapshot.transaction` (`:88-101`) and success tests override only the first call, so
the harness supplies a replacement-intent envelope for the second call built from the proposal PSBT
(decodable output scripts, `prevout.role: 'payjoin_peer'` on the peer input) and adds `address.findMany`
to the Prisma mock returning the wallet's addresses (the real `deriveIntentSpend` calls
`addressRepository.findAddressStrings`, `intentSpend.ts:52`), so the P − r value is derived, not stubbed,
and the success tests assert that second call's arguments (`{ intentId: 'intent-2', intentDigest }`,
`walletId`). The frontend fixtures that return a payjoin success
(`tests/hooks/useSendTransactionActions/useSendTransactionActionsTestHarness.tsx`,
`useSendTransactionActions.creation.contracts.tsx`) add `amount`, so they do not silently test the
fallback. Shared-schema test: a success response without
`amount` is rejected. Hook tests: after a payjoin, the broadcast body (`useSendTransactionActions` creation contracts) and the
draft request (`useDraftManagement` / `buildDraftRequest`) carry the proposal's outpoints, fee and the
canonical amount, including a realistic proposal where the receiver raises the fee (amount P − r; wallet
input values unchanged). Update any test that pins P + C.

### A4 — a signing intent lives as long as its draft (P2) — delivered in PR C (D-3)

**Evidence.** `DEFAULT_INTENT_LIFETIME_MS` is 24 h (`signingIntent/service.ts:27`, applied at `:86`), and
the only expiry enforcement is `loadSigningIntent` (`service.ts:157`, `stale_intent`), used by draft
creation (`draftCreate.ts:343`), draft-intent reads (`api/transactions/drafting.ts:74`), payjoin
(`api/payjoin.ts:317`) and artifact validation for signing and broadcast (`artifactValidation.ts:525,577`).
Drafts default to `DEFAULT_DRAFT_EXPIRATION_DAYS` (7) and approvals never expire by default, so after 24 h
a draft cannot be signed further or broadcast, and multisig and approval-required drafts must be rebuilt
and re-approved. The stored `expiresAt` cannot change (D-2 trigger).

**Fix (D-3).**
1. `draftSigningIntentRepository` gains `hasLiveDraftForSigningIntent(walletId, signingIntentId, now)`:
   `findFirst` (select `id`) where `{ walletId, signingIntentId, status: { in: ACTIONABLE_DRAFT_STATUS_VALUES },
   approvalStatus: { notIn: ['rejected', 'vetoed', 'expired'] }, expiresAt: { gt: now } }` — rejection,
   veto and approval expiry are `approvalStatus` values (`mobileAgentDraftService.ts:310` leaves `status`
   actionable), matching the existing filter at `draftRepository.ts:196-197`. `now` comes from the caller
   (not the DB clock). A draft with a null `expiresAt` (legacy) does not count.
2. `loadSigningIntent` gains an opt-in option `allowLiveDraftExtension`, passed only from signing and
   broadcast validation (`artifactValidation.ts:525,577`) and payjoin (`payjoin.ts:317`). Draft creation
   (`draftCreate.ts:343`) and the `/create` mint re-evaluation (`drafting.ts:74`, a just-minted intent) leave
   it off, so a new draft can be created only while the intent's stored expiry is unexpired — otherwise a
   live draft could seed another draft with a fresh lifetime and chain the intent's liveness without limit.
   With the option set, when the stored expiry has passed (and it is not a broadcast replay), it consults
   that method with the request's `walletId` and the intent id, after `assertStoredIntentScope`; only when
   no live draft exists does it throw `stale_intent`. Nothing else changes: snapshot, digest and PSBT
   authentication still run, consumed/superseded handling is untouched (`resolveAuthenticatedReplay`
   and the broadcast lifecycle are unaffected), and the envelope's `expiresAt` stays the stored value.
3. Consequences, all intended: a draft-less intent still expires at 24 h; deleting or expiring the last
   actionable draft (any path — user delete, `maintenanceRepository.deleteExpiredDrafts`, sync
   invalidation, broadcast archival to a terminal status) returns the intent to its stored 24 h with no
   writes, locks or races; several drafts sharing an intent keep it live while any one is live; RBF
   drafts (no UTXO locks) keep their intent live for the draft's lifetime, which is accepted (their inputs
   are the original transaction's, already spent-unconfirmed). Rejected drafts are not actionable, so
   they do not keep an intent live; neither do rejected, vetoed or approval-expired drafts.

**Failing-first tests.**
- `tests/unit/services/bitcoin/signingIntent/service.test.ts`: an expired intent with a live actionable
  draft loads; with no draft, an expired draft, a broadcasted draft (`status`), a rejected/vetoed/approval-expired draft
  (`approvalStatus`, actionable `status`), or a draft in another wallet → `stale_intent`; without
  `allowLiveDraftExtension` an expired intent with a live draft → `stale_intent`; `createDraft` on an expired
  intent with a live draft → `stale_intent`; an unexpired intent does not consult drafts; a broadcast replay is
  unchanged.
- Repository unit test for `hasLiveDraftForSigningIntent` (exact `where`, including the status set, the
  `approvalStatus` exclusion and `expiresAt > now`).
- Integration spec (registered in `scripts/ci/backend-integration-groups.sh`, `afterAll` cleanup): a real
  intent created normally with `createSigningIntent` (the `expiresAt > createdAt` CHECK forbids past
  insert-time values) and a real draft with its default 7-day expiry; then
  `vi.useFakeTimers({ now: Date.now() + 25 * HOUR, toFake: ['Date'] })`: `loadSigningIntent` with the
  option succeeds while the draft is live and fails with `stale_intent` once the draft is deleted, and
  without the option fails. The worker's earlier spec
  (`scratchpad/signingIntentDraftLifetime.integration.test.ts`) is the starting point, minus its D-2
  assertions on the stored `expiresAt`.

**Constraints.** `signingIntent/service.ts` is in critical mutation shard 3 (`shards.mjs:37,56`); re-pin
any shifted `mutate` ranges in `server/stryker.*.config.mjs` and `config/wallet-safety-mutation-map.json`
line pins, and confirm the new branch's mutants are Killed. No new `finalize*` identifiers.

---

## Delivery group B — services, frontend and CI (PR B, after A merges)

### B1 — the Redis rate limiter charges a request's full cost (P2, recurring)

**Evidence.** `server/src/services/rateLimiting/redisRateLimiter.ts` consume Lua (~`:44-52`) checks
`current + cost <= limit` but adds one sorted-set member, so a JSON-RPC batch of N (`mcp/transport.ts:136-137`
passes `cost = batch length`) costs one slot. Redis is the only runtime limiter. The #1390 fix was proven
only against `MemoryRateLimiter` or a mocked `redis.eval`, so its tests never exercised the script.

**Fix.** The script adds `cost` members, each with a distinct member id (loop `ZADD` with
`now .. ':' .. INCR`). `remaining` already uses `limit - current - cost` (`:52`) and `CHECK_ONLY_SCRIPT`
stays correct; only the `ZADD` count changes.

**Failing-first test.** A Redis-gated integration spec (registered in the ops-workers group, modelled on
`flows/auth/twoFactorAccountRateLimit.integration.test.ts`; unique `keyPrefix`; `reset()` of the key and
its `:seq` key in `afterAll`) runs the real script: `consume(key, cost=5)` with limit 10 leaves `ZCARD` 5 and a following
`consume(cost=6)` is refused (today: `ZCARD` 1 and allowed). `describeWithRedis` skips silently without
`REDIS_URL` (`tests/integration/setup/redis.ts:20-31`), so the failing-first and passing proofs run with
`REDIS_URL` set and `SANCTUARY_REQUIRE_REDIS_INTEGRATION=true` (CI already requires Redis for this job,
`.github/workflows/test.yml:810`), and that is recorded. The failure analysis of the previous attempt is
recorded in run state.

### B2 — re-saving the current email address does not reset verification (P2)

**Evidence.** `PUT /auth/me/email` (`server/src/api/auth/email.ts:277-293`) skips only the conflict check
when the normalized address equals the current one, then calls `updateEmailWithVerification`, whose
repository write (`emailVerificationRepository.ts:112-119`) always sets `emailVerified=false`. A verified
user who re-saves their address becomes unverified and, when verification is required, every request
and refresh returns 401 (`accessTokenSessionService.ts:17-56`).

**Fix.** When the normalized address equals the current one **and the user is already verified**,
return success without writing (no token, no reset, no deliverability check) with the existing
`UpdateEmailResponse` shape (`openapi/schemas/auth.ts:318-327`): `success: true`, `email`,
`emailVerified: true`, `verificationSent: false`, and a message that does not say to check the inbox.
An unverified user re-saving the same address keeps today's behaviour (a fresh token), which is
harmless.

**Failing-first test.** Route test: verified user, same address (also differing only in case;
`EmailSchema` lowercases and rejects padded input, `validation/commonSchemas.ts:27`) → 200 with
`verificationSent: false`, user stays verified, no token or email (today: reset). Unverified user, same
address → a fresh token as today. `server/tests/unit/api/email.test.ts:676-698` (case-only change calling
`updateEmailWithVerification`) runs as an unverified user (the default mock has no `emailVerified`,
`:464-471`) and stays valid; the verified-user no-op is a new case beside it.

### B3 — DeviceDetail shows a load failure instead of "not found" (P2)

**Evidence.** `src/components/DeviceDetail/hooks/useDeviceData.ts` catch sets the device to null and
records no error; `DeviceDetail.tsx:16` then renders "Device not found." with no retry, so a network/5xx
failure looks like a deleted device.

**Fix.** Track the load error and expose a retry (the NodeConfig/DeviceList pattern). Classify from
the `getDevice` call alone (the load is a `Promise.all` with `getDeviceModels`, `useDeviceData.ts:122-125`,
so a models failure must not read as not-found): `ApiError` 403 or 404 from `getDevice` → "Device not
found." (an unshared or deleted device returns 403 via `requireDeviceAccess`,
`middleware/resourceAccess.ts:75-84`); 5xx, network and other errors (including a `getDeviceModels`
failure) → error banner with Retry. A `getDevice` that resolves `null`/empty is checked before it is
dereferenced (today `deviceData.isOwner` throws a TypeError at `useDeviceData.ts:131` that the catch maps
to null) and shown as "Device not found.", so `tests/components/DeviceDetailPage.test.tsx:61-66` keeps
passing. The error state is cleared in the route-reset `useLayoutEffect`
(`:87-107`) and keyed to `loadedOwnershipKey`, so route A's error never shows on route B.

**Failing-first test.** `getDevice` rejects with 500 → banner + Retry, no "Device not found."; 403 and
404 → "Device not found."; `getDeviceModels` rejects → banner; Retry reloads; extend
`tests/components/DeviceDetail/hooks/useDeviceData.ownership.test.tsx:119` so a route change clears the
error.

### B4 — the Wallets balance chart shows a failed history as unavailable (P2)

**Evidence.** `src/components/WalletList/BalanceChart.tsx` ignores `isUnavailable` from
`useBalanceHistory` and draws the placeholder flat line at the current balance when the request fails
(the Dashboard handles it); because the query key includes `totalBalance`, every balance change also
flashes that flat line.

**Fix.** Render an "unavailable" state (matching the Dashboard's) when `isUnavailable`. Keep the previous
series locally in `BalanceChart` (not in the shared `useBalanceHistory`, `src/hooks/queries/useWallets.ts:213-249`,
used by the Dashboard and `WalletStats.tsx:43`) and only while the change is to `totalBalance` with the same
`walletIdsKey` and `timeframe`; a wallet-set or network change still drops the old series, honouring the
hook's rule at `:229`.

**Failing-first test.** Hook mock returns `isUnavailable: true` → unavailable state, no flat line; a
`totalBalance` change with a previous series → the previous series stays rendered while loading; a
`walletIds` or network change → the old series is dropped.

### B5 — emulator-inventory reference docs are wallet-safety critical (P2)

**Evidence.** `docs/reference/hardware-wallet-validation.md`, `docs/reference/release-gates.md` and
`docs/reference/trust-and-verification.md` are listed in `config/hardware-emulator-source-inventory.json`
and hashed into the Jade proof sources (`scripts/ci/run-jade-emulator-proof.sh` → `proof-sources.sha256`),
but are not in `config/wallet-safety-critical-paths.json`, so a docs-only PR that edits, renames or
deletes one skips verify-vectors (summary green) and breaks the next code PR, `main` or the schedule.

Plan review also found a fourth proof-source doc: `shared/utils/README.md`, resolved through the
inventory's `common.patterns` entry `shared/**` (`config/hardware-emulator-source-inventory.json:39`).

**Fix (D-1: classifiers only; the wallet-safety manifest is unchanged).**
1. `scripts/ci/classify-files-lib.sh` gains a POSIX `is_hardware_proof_source_file` that reads
   `config/hardware-emulator-source-inventory.json` (resolved from the library's own location, like the
   wallet-safety manifest; POSIX `sed`, no jq/node). It extracts **every** quoted string on each line —
   arrays are sometimes inline (`"patterns": ["shared/**", "src/services/hardwareWallet/*.ts"]`, `:40`),
   unlike the one-string-per-line parse in `load_wallet_safety_regex` (`:223-231`) — drops strings
   followed by `[[:space:]]*:` (the keys `schemaVersion`, `common`, `files`, `patterns`, `vendors`,
   `trezor`, `ledger`, `jade`), and builds the ERE with the existing escape/`**`/`*` sed chain (the
   inventory validator already rejects `?`, `[`, `]`, `***`). A missing, unreadable **or empty-result**
   inventory fails closed (every path is a proof source), as `is_wallet_safety_critical_file` does
   (`:236-238`).
2. The verify-vectors docs allowlist (`classify-verify-vectors-scope.sh:121-139`) and the test-lane
   docs-only branches (`classify-test-changes.sh`, `plan-test-run.sh`) treat a docs path that is a
   hardware proof source exactly like a wallet-safety critical path (verify-vectors `run`; test-lane full
   scan).
3. A guard in `tests/ci/check-wallet-safety-classifier.test.mjs` (already run at `quality.yml:834`) takes
   the resolved list from `node scripts/ci/hardware-emulator-source-inventory.mjs list --vendor <v> --format lines`
   for each of trezor, ledger and jade (the CLI accepts only that form, `:347-352`; no `--require-clean`)
   and requires every path the docs allowlist would accept (`*.md`, `*.mdx`, `docs/*`, `tasks/*`) to be
   classified as a proof source by the bash function, under both bash and POSIX `sh`.

**Failing-first tests.** The guard fails today on the four docs (including `shared/utils/README.md`,
via `shared/**`); classifier tests (verify-vectors scope,
`classify-test-changes`, `plan-test-run`) show a docs-only change to one of them runs verify-vectors /
full-scans, and an ordinary doc still skips. `tests/release/wallet-safety-audit-review.test.mjs` is run
and stays green (release scope unchanged).

---

## Verification (every PR)

As iteration 5: focused tests failing first on `a09b6a93`; typechecks (app/tests/all + server
`tsc` + `typecheck:tests`); full `npm run lint`; server and frontend coverage 100% (no "Unhandled
Errors"); touched integration specs (registered, cleaned up); lizard (no rise above 84), jscpd, large
files, architecture boundaries, safety-catch, wallet-sync checkers, lifecycle callsites, signer
inventory, `arch:check` (commit graphs). **PR A:** critical mutation shard 3 for `intentSpend.ts`,
`broadcasting.ts` and the repository; confirm the new branches' mutants are Killed. **PR C:** critical
mutation shard 3 for `signingIntent/service.ts`; integration spec run. **PR B:** gateway
untouched; classifier suites + `check-wallet-safety-classifier` (+ test) +
`tests/release/wallet-safety-audit-review.test.mjs`; Playwright against a static
`dist/` for `render-regression` and any spec touching DeviceDetail/WalletList. `/simplify` and the
edge-case audit before committing.

## Delivery, rollback, deployment

- **Order:** PR A (A1–A3) → PR B → PR C (A4), serial; hold B locally until A merges and C locally until B merges; rebase only the next PR to merge; squash; no admin bypass;
  verify `merge_commit_sha` ancestry; wait for every run on the head.
- **Rollback:** each phase is an independent commit; no schema or data migration and no data writes
  (A4 is read-only). Reverting A4 restores the 24 h limit immediately.
- **User-visible changes:** resumed RBF bumps are evaluated as bumps; consolidation retries work; payjoin
  spends broadcast from the web and are evaluated, recorded and notified at the sender's net amount; drafts stay
signable/broadcastable for their lifetime (their intents stay live only while the draft does);
  MCP batches are charged per message; re-saving your email no longer unverifies you; DeviceDetail and the
  Wallets balance chart show load failures honestly.
- **Deployment:** none here (`--deploy final`).

## Completion criteria

- [ ] PR A merged; target-branch CI green on its merge commit.
- [ ] PR B merged; target-branch CI green on its merge commit.
- [ ] PR C (A4) merged; target-branch CI green on its merge commit.
- [ ] Every phase's regression test failed on `a09b6a93` and passes on its merge.
- [ ] Owned branches and worktrees cleaned; run state updated.
- [ ] P3 backlog remains outside the blocking fix set.
