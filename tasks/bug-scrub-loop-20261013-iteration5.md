# Bug-scrub loop 20261013 — iteration 5 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 5
- **Source SHA:** `9f2e17ee2dd7a9b5b4df8d62ae3bdac2e8e457ae` (`main`, after #1393–#1396)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (12):** 1 P1, 11 P2, listed below with their phase. P3 findings are recorded as
  backlog in run state and are **outside this fix set**.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `vault-policy--approval-required-not-enforced-for-user-drafts` | P1 |
| A2 | `broadcast-retry--policy-usage-double-reserved` | P2 |
| B1 | `mobile-permissions--cross-wallet-routes-bypass-view-caps` | P2 |
| B2 | `mobile-permissions--push-notifications-ignore-view-caps` | P2 |
| B3 | `websocket-servers--no-max-payload-unauth-memory-dos` | P2 |
| B4 | `ai-conversation--only-oldest-100-messages-returned` | P2 |
| B5 | `send-draft-resume--single-sig-uploaded-signature-lost` | P2 |
| B6 | `system-settings-access-control--load-error-shows-registration-disabled` | P2 |
| B7 | `users-groups--load-error-shows-empty-lists` | P2 |
| B8 | `intelligence-tabs--load-errors-render-as-empty` | P2 |
| B9 | `compose-env--documented-operator-settings-not-forwarded` | P2 |
| B10 | `ci-classifier--docs-only-skips-wallet-safety-adr` | P2 |

## Goal and non-goals

**Goal:** fix every P0–P2 confirmed by the iteration-5 scrub, each with a regression test that fails on
`9f2e17ee` and passes after the fix, delivered through protected PRs with green CI.

**Non-goals:**
- The P3 backlog, including the adjacent P3s found this iteration (2FA budget consumed by successful
  verifications, draft PATCH `status`, `allowSelfSend`, Electrum pool registry, BIP 329 `origin`,
  Telegram chat-id lookup, egress empty CIDR prefix, ws concurrent auth timer, docker-build Jade
  manifest input, drift guard blind spots, alertmanager inhibit, raw tx hex in list responses).
- A web approvals UI (approving/rejecting requests). A1 makes the existing approval workflow apply to
  human spends and surfaces the status.
- New Prisma migrations (forbidden: the release replay gate pins the migration-tree digest) and new
  HTTP endpoints (each needs 13 e2e mock-map entries).

## Decisions (recorded)

These follow the documented pre-broadcast rule in `docs/plans/vault-policies-plan.md` §5.2 ("all
policies re-evaluated … block") and fail closed:

- **D-1. RBF fee bumps on approval-required wallets need their own approval.** Approval triggers
  (`always`, `amountAbove`; the legacy `unknownAddressesOnly` trigger is not enforced,
  `policyEvaluationEngine.ts:239-247`) are authorization checks on the transaction's real value,
  as `broadcasting.ts:284-288` already states for broadcast; only spending-limit/velocity window
  accounting uses the replacement's incremental amount. A bump is therefore saved as a pending draft
  like any other approval-required spend.
- **D-2. Payjoin is not attempted on approval-required wallets.** A payjoin attempt mints a proposal
  intent that supersedes the original (`api/payjoin.ts:339-351` → `transactionSigningIntentRepository.ts:70-80`;
  superseded intents are refused, `signingIntent/service.ts:105`), so it must be stopped **before**
  anything is superseded and before the original PSBT leaves the server: `/payjoin/attempt` (which already
  has `wallet`, `userId` and `originalIntent.snapshot`, `payjoin.ts:288-292`) evaluates the original
  intent with the shared helper, **with `preview: true`**, and returns 403 `approval_required` **before
  `attemptPayjoinSend`** (`:303`; BIP78 receivers can act on the original). The client's
  `shouldAttemptPayjoin(state, payjoinAttempted, result)` (`useSendTransactionActions.ts:134-136`) gains
  the create result (passed from `applyPayjoinIfNeeded`, `:150`; the check stays out of
  `applyPayjoinIfNeeded`, already CCN 14) and returns false when it carries an enforce-mode
  `approval_required` action. The send
  then proceeds without payjoin through the pending-draft path.
- **D-3. Mobile view caps redact rather than omit** wallets in `GET /wallets` (receive-only devices
  still need the wallet), and filter rows/recipients elsewhere.

## Assumptions and constraints

- Funds-critical files: run the critical mutation shard covering edited files and re-pin
  `config/wallet-safety-mutation-map.json` and `server/stryker.*.config.mjs` `mutate` ranges if edits
  shift pinned lines. Do not name a new helper `finalize*` (signer-inventory sweep).
- New repository calls on sync-path files must be listed in `config/wallet-sync-mutation-boundaries.json`.
  New server integration specs must be registered in `scripts/ci/backend-integration-groups.sh`.
- Lizard: CCN ≤ 15 and NLOC ≤ 200 per function; the gate baseline is 86 (`scripts/quality.sh:21`); 84 is the count measured on `9f2e17ee` with `bash scripts/quality/lizard-only.sh`, and no PR may raise it.
- Coverage is 100% (frontend and server `tests/unit`).

---

## Delivery group A — funds and policy (PR A, first)

A1 and A2 both change `server/src/api/transactions/broadcasting.ts` `reservePolicyUsage`, so they ship
together. This PR goes first and alone: it holds the only P1 and the funds-policy changes, so it can be
reviewed and reverted independently of the rest.

### A1 — approval-required policies apply to human spends (P1)

**Evidence.** `policyEvaluationEngine.ts:228-257` records `approval_required` without setting
`allowed=false`. The create routes (`api/transactions/drafting.ts` ~102/193/295) act only on `!allowed`
and evaluate the client's requested `amount` before the transaction is built. `POST /drafts`
(`api/drafts.ts:88`) passes no `policyEvaluation` to `draftService.createDraft`, so `requiresApproval()`
(`draftCreate.ts:36`) is false and every human draft is born `not_required`. Broadcast
(`reservePolicyUsage` ~302-339, `assertDraftAllowsBroadcast` `:50-63`) also acts only on `!allowed` and
gates only drafts already marked pending; a draft-less broadcast is never gated. Only the agent path
(`agentApiService.ts:355-414`) creates approval requests. `docs/plans/vault-policies-plan.md` §5.1–5.2:
approval_required forces the draft into pending, and broadcast re-evaluates and blocks.

**Fix (server).**
1. Extract the external-output derivation in `buildCanonicalMetadata` (`broadcasting.ts:163-212`) into
   `services/bitcoin/signingIntent/intentSpend.ts` (`deriveIntentSpend(walletId, network, snapshot)` →
   `{ externalOutputs, amount, inputs, replacementTxid }` (`inputs` as txid/vout outpoints, needed by
   `findVerifiedReplacement`'s candidate outpoints, `replacementLink.ts:87-91`), the last from the
   snapshot's replacement field,
   `signingIntent/schema.ts:16`) and use it from both places. Export it through the barrel
   (`signingIntent/index.ts` gains `export * from './intentSpend'`) and import it from the barrel, so
   tests that mock the barrel (`draftCreate.test.ts:59-65`) control it. The route tests' fixed mock
   factories must export the new symbols: the signingIntent barrel mocks in
   `transactionsSigningIntentBroadcast.test.ts:52-55` and `transactionsHttpRoutesTestHarness.ts:176-180`
   (`deriveIntentSpend`, A2's `findHeldPolicyReservations`, and — because the create-route tests in
   `transactionsHttpRoutes.creation.contracts.ts` run through the same harness — `loadSigningIntent` with
   a default resolving to a v2 snapshot, plus a `vi.mock` of `services/vaultPolicy/intentPolicyInput`;
   the harness today mocks the barrel with only `createSigningIntent`, `validateSignedArtifact`,
   `findDraftBySigningIntent` at `:175-179` and only the `services/vaultPolicy` barrel at `:181`), and the
   harness's broadcasting mock
   (`:170-173`) any new tag reader the route imports, plus the real `PreNetworkBroadcastRejectionError`
   via `vi.importActual` (as `transactionsSigningIntentBroadcast.test.ts:56-60` does) — the route already
   imports it (`api/transactions/broadcasting.ts:30`, `:363`), and without it `broadcast.contracts.ts:140-155`
   and `:254-268` pass today only because the missing export throws. It works only from the authenticated
   signing-intent snapshot and the wallet's addresses — never client `recipient`/`amount`.
2. A shared helper, `buildIntentPolicyInput` in `services/vaultPolicy/intentPolicyInput.ts`, builds the
   evaluation input from that spend, including replacement context: when
   `replacementTxid` is set, `findVerifiedReplacement` (the broadcast route's existing check) supplies
   `{ replacedAmount, isReplacementBump }` exactly as broadcast does (D-1: approval triggers still see
   the full amount; only window accounting uses the delta). Confirm with
   `check-architecture-boundaries.mjs` that this import edge (vaultPolicy → transactions/replacementLink)
   is allowed; if not, place the helper where the boundary permits and say so in the PR.
3. `createDraft` (`draftCreate.ts`, already CCN 13 at `:308-383`): a top-level helper
   `withServerPolicyEvaluation(data, ...)` returns `data` **with `policyEvaluation` set** — when it is
   undefined, it evaluates server-side with that helper after `loadSigningIntent`, throws
   `ForbiddenError` on `!allowed`, and skips evaluation when there are no external outputs. It must be
   assigned back to `data` (not a local): `requiresApproval(data)` is recomputed at `:160`, `:216` and
   `:334`, and a local would leave the draft `not_required` with no approval requests. The
   agent path passes its own evaluation unconditionally (drop the `triggered.length > 0 ?` ternary at
   `agentApiService.ts:414`) so it is not evaluated twice.
4. Create routes (`drafting.ts` create, batch, psbt/create): after the signing intent is minted, load it
   with `loadSigningIntent(handle, walletId)` (`createSigningIntent` returns only the handle,
   `signingIntent/service.ts:46-89`; do **not** widen `IssuedSigningIntentHandle`, which `payjoin.ts:358`
   spreads into its response) and re-evaluate with the same helper from the minted intent, **with `preview: true`** (no extra
   `PolicyEvent` rows; `policyEvaluationEngine.ts:145-147`), and echo **that** result as
   `policyEvaluation` (psbt/create gains the field), so `sendMax`/`subtractFees` effective amounts are
   what the UI sees. Keep the existing pre-build `!allowed` refusal (which logs once).
5. Broadcast: `reservePolicyUsage` receives the authoritative draft; after `evaluatePolicies`, a new
   `assertApprovalSatisfied(result, draft)` throws `ForbiddenError` with
   `{ reason: 'approval_required', draftId: authoritativeDraft?.id }` (the server resolves a linked draft
   even when the client sends none, `broadcasting.ts:72-87`) when an enforce-mode `approval_required` action fired and the
   request has no draft or a `not_required` draft (the only statuses that reach it: the existing
   `assertDraftAllowsBroadcast`, `broadcasting.ts:50-63`, already refuses `pending`, `rejected`, `vetoed`
   and `expired` with `pending_approval` before `reservePolicyUsage` runs, `:438`, `:477`). Monitor-mode policies stay informational. An approved draft passes even though
   re-evaluation fires the trigger again.
6. OpenAPI documents psbt/create `policyEvaluation`, the broadcast 403 reasons (including the new
   `approvalStatus` detail on `pending_approval`), and `approvalStatus` on the
   `DraftTransaction` schema (`server/src/api/openapi/schemas/drafts.ts:84`; the serializer already
   returns it, `utils/serialization.ts:50-51`).

**Fix (frontend).** Add `policyEvaluation?` to `TransactionData` (`src/hooks/send/types.ts`) and the
create response types in `src/api`. When the create response has an enforce-mode `approval_required`
action, the review step replaces Sign/Broadcast with **Submit for approval**, which calls the existing
`saveDraft` (the server creates it as `pending`) and shows a pending-approval notice. Submit for
approval is offered only when there is **no draft** — `!(details.draftId ?? state.draftId)`, using the
403's server-resolved `draftId` (a duplicate `POST /drafts` would hit the UTXO-lock conflict,
`draftCreate.ts:194-201`): `saveDraft` on an existing draft PATCHes
(`useDraftManagement.ts:298-299`), and PATCH never changes `approvalStatus` (only `createDraft` sets it,
`draftCreate.ts:160`). The broadcast hook maps a 403 `reason: 'approval_required'` to a notice in a module-level helper that
replaces `getBroadcastErrorMessage` (`useBroadcast.ts:212`; the callback is already CCN 12 at
`:261-326`, so nothing inline in its catch) and returns `{ message, approvalAction: 'submit' | 'recreate'
| null }`; the hook exposes `approvalAction` as new state (alongside the existing `setError` message,
`:316-319`) that the review step reads to render the button. It maps `approval_required`, and also
`approval_rejected` (`api/transactions/broadcasting.ts:59`) to `recreate`, and `pending_approval` — which
the server returns for every non-allowed status except `rejected`, including `pending` — according to
the draft's `approvalStatus`, which `assertDraftAllowsBroadcast` now adds to the 403 details
(`approvalStatus: draft.approvalStatus`, `broadcasting.ts:57-60`; the hook has no other source — the send
state carries only `draftId`) and the helper reads from `ApiError.response.details` (the pattern in
`src/api/console.ts:24-28`): `pending` → "awaiting approval" notice with `approvalAction: null` (an RBF/CPFP
draft created `pending` and opened in Send must not be told to delete itself); `vetoed` or `expired` →
`recreate`; missing (an older server) → `recreate`, the stated fallback. Each is tested — the pending case
through the 403 response details, not injected state — plus a server route test asserting the new detail
field: without a draft it offers Submit for approval; with an existing draft that is not `pending`/`approved`
(including pre-fix `not_required` drafts and RBF/CPFP drafts created before navigation,
`useTransactionActions.ts:120-125,151-156`) it tells the user to delete the draft (`draftService.deleteDraft`, `draftService.ts:57`, which releases
its UTXO locks via `draftLockService.unlockUtxosForDraft`, `draftLockService.ts:125`) and create the
transaction again. The frontend `DraftTransaction` type (`src/api/drafts.ts:40`) gains
`approvalStatus`. DraftList has no broadcast control (its row actions are Resume, Download/Upload
PSBT and Delete, `DraftRowActions.tsx`), so: `DraftStatusBadges.tsx` shows an approval-status badge, and
shows the "Ready to broadcast" badge (`:51`, today for `status === 'signed'`) only when `approvalStatus`
is `not_required` or `approved` — the broadcast allow-list (`api/transactions/broadcasting.ts:48`). Resume
stays enabled (apart from its existing `expired`-draft rule, `DraftRowActions.tsx:31-54`), so the user
reaches the 403 awaiting-approval / recreate notice; Delete remains the way out. The web RBF/CPFP flows create their drafts through
`POST /drafts`, so with A1.3 those drafts are born `pending` when approval is required (D-1).

**Compatibility.** Drafts created before the fix as `not_required` on a wallet with an enforce-mode
approval policy are refused at broadcast (intended; release note: recreate them). The mobile app has no
`POST /drafts` through the gateway, so approval-required spends from mobile get the 403 and must go
through an approved draft. Agent API behaviour is unchanged apart from an empty `triggered` list being
passed explicitly.

**Failing-first tests.**
- `server/tests/unit/services/draftCreate.test.ts` (extend its `bitcoin/signingIntent` barrel mock with
  `deriveIntentSpend` and a snapshot): an enforce `approval_required` policy and no `policyEvaluation`
  → `approvalStatus: 'pending'` and `createApprovalRequestsForDraft` called once. An RBF draft with a
  verified replacement passes `{ replacedAmount, isReplacementBump: true }` to `evaluatePolicies`.
- Broadcast route: no draft, evaluation `allowed: true` with an enforce `approval_required` trigger →
  403 `approval_required`, `broadcastAndSave` not called; a `not_required` draft → the same. `approved`
  passes; monitor mode passes. Guard (passes on base): `vetoed`/`expired` drafts keep the existing
  `pending_approval` refusal.
- Create routes: a `sendMax` create echoes the evaluation from the minted intent's effective amount
  (an `amountAbove` trigger that the requested amount misses).
- Frontend: review step Submit for approval creates the draft; broadcast 403 without a draft offers
  Submit for approval; broadcast 403 on a resumed `not_required` draft shows delete-and-recreate and no
  Submit for approval; DraftList, for each approval status, shows the approval badge and shows "Ready to broadcast" only
  for `not_required`/`approved`, with Resume still enabled; payjoin is skipped when
  the create response requires approval.
- Payjoin: `/payjoin/attempt` on an approval wallet → 403 `approval_required`, `createSigningIntent` not
  called, **`attemptPayjoinSend` not called** (the original PSBT never reaches the receiver), the
  original intent not superseded.
- Policy events (a guard, not failing-first — it passes on `9f2e17ee`): one create and one payjoin
  attempt each log `createPolicyEvent` at most once (the echo and attempt evaluations are previews).
- Existing payjoin tests (`payjoin.test.ts:78-90`, `payjoin.security.contracts.ts`) mock
  `loadSigningIntent` without a transaction and the prisma mock has no policy tables: mock
  `vaultPolicy/intentPolicyInput` and the engine there so the existing attempt tests keep passing.
- e2e: `tests/e2e/send-transaction-flow.spec.ts` approval case. That spec today mocks only
  `POST .../transactions/build` (`:370`, unused by the client) and `GET .../drafts` (`:356`) and never
  reaches review, so add a schema-valid `POST /wallets/:id/transactions/create` responder
  (`CreateTransactionResponseSchema`: psbt, `signingContext`, intent fields, plus `policyEvaluation`)
  and a `POST /wallets/:id/drafts` responder for Submit for approval, keeping `unhandledRequests` empty.
  No new endpoint, so no mock-map fan-out.

### A2 — a broadcast retry does not reserve policy usage twice (P2)

**Evidence.** `broadcasting.ts:451/480` reserves whenever `!artifact.broadcastReplay`. Replay requires
`consumedAt` and an `accepted`/`complete` state (`signingIntent/service.ts:109-125`), so a retry after an
`unknown`/stalled outcome reserves again while the first reservation is still held
(`releaseReservationsOnFailure` releases only on definite or pre-network rejections). Usage windows are
aggregate rows (`PolicyUsageWindow`), so a reservation cannot be keyed to an intent there without a
migration.

**Fix.** Persist the reservations on the intent's existing `broadcastMetadata` JSON:
1. `DurableBroadcastMetadataSchema` (`signingIntent/broadcastLifecycle.ts`) gains optional
   `policyReservations: [{ windowId, amount }]` (amount as a decimal string). No fixed entry cap: each
   enforce policy reserves up to three windows (one reserver per policy type, dispatched at
   `policyEvaluationEngine.ts:519`/`:528`: spending_limit daily/weekly/monthly `:556-558`, or velocity
   hourly/daily/weekly `:579-581`) and the
   policy count per wallet is unbounded; bound the array only by a generous sanity limit derived from
   the policy count, and test more than 16 entries.
2. `findHeldPolicyReservations(intentId, txid)` returns the reservations only when the intent is
   `unknown`, or `claimed` with an **expired** lease, and its `broadcastTxid` equals `txid`; otherwise
   null (a live `claimed` intent belongs to an in-flight attempt).
3. The route, when reservations are held: still run `evaluatePolicies` (an authorization check) with
   `{ replacedAmount: amount, isReplacementBump: true }` — both are required, because the engine reads
   `replacedAmount` only when `isReplacementBump` is set (`policyEvaluationEngine.ts:213`) and velocity
   skips only on it (`:895-897`) — and skip `reserveEnforcedUsage`. It claims with a new
   `claimBroadcast` option that **excludes the `ready` step** (`transactionSigningIntentRepository.ts:96`): a reusing retry may
   resume only `unknown`/expired-`claimed`; if the intent was released back to `ready` in between (the
   first attempt was definitely rejected and its reservations freed), the claim fails before the
   network — `releaseRejectedBroadcast` nulled `broadcastTxid` (`transactionSigningIntentRepository.ts:210`),
   so the fallback lookup returns `conflict` (`:149-153`), mapped to 400 `metadata_mismatch`
   (`broadcastLifecycle.ts:86`) — and nothing is broadcast holding no reservation.
4. Reservations (held or fresh) are threaded into `broadcastAndSave`'s metadata so every claim
   re-persists them.
5. Release rule. Today `releaseReservationsOnFailure` (`api/transactions/broadcasting.ts:357-370`)
   decides from the error type alone and never sees the claim. `broadcastAndSave` therefore tags every
   failure with `{ claimed, priorState, releasedToReady }` (a field on the error it already throws; see A2.6), and the route releases **fresh** reservations only when
   (a) no claim was taken (hardware-capability refusal, claim busy/conflict for a non-reusing request),
   or (b) `priorState === 'ready'` and the transition back to `ready` returned true — this includes the
   replacesTxid mismatch, which is checked **after** the claim (`services/bitcoin/transactions/broadcasting.ts:251`
   claims, `:275-293` checks) and so releases only when `recordReplacementLinkFailure` returned true.
   **Untagged errors default to retain** (fail safe), except an untagged `PreNetworkBroadcastRejectionError`,
   which counts as no-claim — so the existing release tests at `transactionsSigningIntentBroadcast.test.ts:537-552`
   and `:663-680` stay green. The five existing tests that expect a release from an untagged
   `DefiniteBroadcastRejectionError` (`transactionsSigningIntentBroadcast.test.ts:525-535`, `:553-563`;
   `transactionsHttpRoutes.broadcast.contracts.ts:127-138`, `:157-169`, `:309-320`) are rewritten to
   throw tagged errors `{ claimed: true, priorState: 'ready', releasedToReady: true }`. **Held (reused) reservations are never released by the route.** This closes three
   holes: a resumed claim with a `DefiniteBroadcastRejectionError` (`recordClaimFailure` marks the intent
   `unknown`, `services/bitcoin/transactions/broadcasting.ts:174-190`, but `broadcastAndSave` rethrows the definite error),
   a reusing retry whose claim loses the A2.3 race (`asPreNetworkRejection`, `:58`, `:253`), and fresh
   reservations that end up on a resumed claim (the legacy fallback, or a lease that expired between
   the held read and the claim) failing the replacement link while the intent stays `unknown`.
6. The tag is set inside `broadcastAndSave`'s three catch blocks (`services/bitcoin/transactions/broadcasting.ts`;
   `recordClaimFailure` `:174-190` and `recordReplacementLinkFailure` `:199-212` only return
   `Promise<boolean>`, and also return `true` for the mark-unknown/stalled transitions,
   `broadcastLifecycle.ts:90-95`): the two helpers return `{ releasedToReady }`, which is true **only**
   when the path actually returned the intent to `ready` — `releaseRejectedSigningIntentBroadcast` in
   `recordClaimFailure` (`ready` + definite rejection) or in `recordReplacementLinkFailure` (`ready`), and
   only when that call returned true; mark-unknown, stalled, a false return or a throw give false. The
   tag is attached as a **field on the error object `broadcastAndSave` already throws** — the
   `asPreNetworkRejection` wrapper (`:253`, `:292`), the `broadcastFailureToThrow` `ConflictError`
   (`:192-196`), or the original error — so identity, class and message are unchanged, and only when that
   error is a non-null object (a thrown primitive cannot carry it). At the claim catch (`:252-253`),
   `{ claimed: false }` is attached **only when the thrown error is the `PreNetworkBroadcastRejectionError`
   wrapper**: `asPreNetworkRejection` (`:58-60`) rethrows non-`ApiError`s unchanged, and a Prisma or
   connection error from `claimSigningIntentBroadcast` (`:251`) may come after the claim committed and
   re-persisted the reservations (A2.4), so it stays untagged and is retained. Guards:
   `transactionServiceBroadcast.broadcastAndSave.claim-states.contracts.ts:72` (`rejects.toBe(error)`),
   `:101-102` (ConflictError, not PreNetwork), `:152-153` (PreNetwork), `core.contracts.ts:57` and
   `failures-rbf.contracts.ts:285` (PreNetwork wrapper), `transactionServiceBroadcast.errors.contracts.ts:121-124`,
   `failures-rbf.contracts.ts:375-393`.
7. Intents in flight before the fix (no `policyReservations`) fall back to a fresh reservation —
   over-counting, as today, which is the safe direction.

**Compatibility.** Rolling back to older code while an intent carries `policyReservations` makes the
old strict schema reject its metadata: an `unknown` intent becomes non-reconcilable, and an intent the
node already **accepted** is never persisted or completed by the old reconciler
(`broadcastReconciliation.ts:38-39`). The release note says so and advises finishing in-flight
broadcasts before a rollback. No client-visible contract change.

**Failing-first tests.** New route cases go in
`server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.broadcast.contracts.ts` (run by
`transactions-http-routes.test.ts`) or a new contracts file registered from that runner — not in
`transactionsSigningIntentBroadcast.test.ts`, which is at 835 lines, unclassified, and would cross the
1,000-line gate (`check-large-files.mjs:12,194-197`). Route level: first broadcast throws an unknown-outcome error and leaves the
intent `unknown` with the same txid; the retry succeeds; expect `reserveEnforcedUsage` called exactly
once and `releasePolicyUsage` never. Velocity: the original reaches a velocity cap and the retry still
passes. Race: the intent flips to `ready` between the held read and the claim → the retry gets 400
`metadata_mismatch`, nothing is broadcast, `releasePolicyUsage` is not called, and a further retry (which
finds nothing held) reserves fresh and broadcasts. An untagged definite rejection is retained. Integration with a real `PolicyUsageWindow`: `totalSpent` equals
the amount after the retry. `releasePolicyUsage` is **not** called for: a legacy `unknown` intent whose
retry fails the replacement link; a resumed claim with a definite rejection; a reusing retry that loses
the claim race. The existing hardware-capability and replacesTxid release tests stay green. Service-level unit tests in the `broadcastAndSave` contract files under
`server/tests/unit/services/bitcoin/transactionServiceBroadcast/` (`*.broadcastAndSave.claim-states`
/ `failures-rbf` contracts, or a new contracts file registered from
`transactionServiceBroadcast.broadcastAndSave.contracts.ts`; all run by
`tests/unit/services/bitcoin/transactionService.broadcast.test.ts:8-9`) (route tests mock `broadcastAndSave`, so these are what catch a wrong tag): `ready` + non-definite
error (unknown outcome) → `releasedToReady: false`; `ready` + `DefiniteBroadcastRejectionError` with the
release returning true → `{ claimed: true, priorState: 'ready', releasedToReady: true }`; the same with the
release returning false, and throwing → `releasedToReady: false`; replacesTxid mismatch on a `ready` claim →
`releasedToReady: true`; on a resumed claim → `false`; a non-`ApiError` thrown by the claim → no tag. Route
guards: `releasedToReady: false` and an untagged non-PreNetwork error → `releasePolicyUsage` not called. Unit tests for the schema field (> 16 entries), the helper's state, lease
and txid matching, and the release guard.

---

## Delivery group B — edge, frontend and operations (PR B, after A merges)

### B1 — cross-wallet routes honour mobile view caps (P2)

**Evidence.** `GET /wallets`, `GET /transactions/pending` and the legacy `GET /transactions/:txid` carry
no wallet id in the path, so the gateway cannot cap them (`gateway/src/routes/proxy/whitelist.ts`;
documented as a follow-up in `docs/reference/wallet-threat-model.md:121-126`). They return balances and
transactions to mobile users whose `viewBalance`/`viewTransactions` cap is off.

**Fix.** The gateway always overwrites `X-Gateway-Request: true` on proxied requests
(`gateway/src/routes/proxy/proxyConfig.ts:70-75`). Add `isGatewayRequest(req)`; trusting it is safe
because it can only restrict what the caller sees. Add batch helpers in `mobilePermissionService`
(`filterWalletIdsByMobileAction(userId, walletRoles, action)` and
`filterUserIdsByMobileAction(walletId, members, action)`, reusing the private
`calculateEffectivePermission`). Every role grants the three view actions (`mobilePermissions/types.ts:44-104`), and every
row these routes return is already access-filtered, so for view actions only the user's permission row
decides; the helpers take wallet/user ids and pass any granting role to `calculateEffectivePermission`
(role precedence is not observable for view actions and gets no test). Where a role is already at hand
(`GET /wallets`' `userRole`) it is passed through. Permission rows are batch-loaded with `findByUserId`
(`mobilePermissionRepository.ts:99`, filtered to the wallet ids) for `filterWalletIdsByMobileAction`,
and with `findByWalletIdAndUserIds` (`:174`) for `filterUserIdsByMobileAction`. For gateway
requests only:
- `GET /wallets` (`api/wallets/crud.ts`): keep the wallet but set `balance: 0` and the additive
  `balanceHidden: true`, and blank any other per-wallet money fields the list returns (check
  `walletQueries.ts`) (D-3).
- `GET /transactions/pending` (`crossWallet.ts`): filter `walletIds` before the query.
- Legacy `GET /transactions/:txid` (`transactionDetail.ts:219-230`): filter `matches` by
  `viewTransactions` **before** the duplicate check (`matches.length > 1` → 409); return the permitted
  row when exactly one remains, keep the 409 for several permitted matches, and when every match is
  denied return the gateway's denial body `{ error: 'Forbidden', message: 'Mobile access denied for
  action: viewTransactions' }` (`gateway/src/middleware/mobilePermission.ts:176-179`).
Web requests (no header) are unchanged. Update the threat model to remove the limitation and OpenAPI for
`balanceHidden`.

**Failing-first tests.** Pending route with the header and `canViewTransactions: false` on one of two
wallets → only the other wallet's rows. `GET /wallets` with the header and `canViewBalance: false` →
`balance: 0, balanceHidden: true`. Legacy txid: denied single match → 403 with the gateway body; a txid
in one capped and one permitted wallet → the permitted row (not 409). Same requests without the header →
unchanged.

### B2 — push notifications honour mobile view caps (P2)

**Evidence.** Two push paths filter on notification preferences only:
- gateway push: `eligibleUserIds` (`server/src/websocket/gatewayEventMapper.ts:31-44`), audience from
  `pushAudienceRepository.ts`;
- backend FCM/APNs: `notifications/channels/push.ts:45` → `pushService.notifyNewTransactions`
  (`services/push/pushService.ts:228-305`), recipients from `userRepository.findByWalletAccess`.
Both carry amount, txid or wallet name.

**Fix.** Both paths drop recipients whose effective `viewTransactions` is off for the wallet via
`filterUserIdsByMobileAction`; the audience queries need no extra role columns (see B1: view actions are
decided by the permission row). Gateway push filters both the transaction and confirmation branches; on a permission-lookup error it
sends to nobody and logs a warning (fail closed). `notifyNewTransactions` keeps its existing failure
contract instead: a lookup error returns `{ success: false, recorded: false, error }`
(`pushService.ts:250-257`) so the channel and the job's dead-letter queue see it
(`channels/push.ts:47-56,68-73`). Telegram, webhook and AI-insight channels are operator/user-configured
server-side channels, not mobile access, and stay outside the mobile-cap scope. Check whether either caller sits on a
wallet-sync path listed in `config/wallet-sync-mutation-boundaries.json`. Run `arch:check` in the
primary checkout if websocket or push → mobilePermissions is a new import edge and commit the regenerated
graphs.

**Failing-first tests.** `gatewayEventMapper.test.ts`: U2 has `canViewTransactions: false` → `userIds`
is `[U1]`; lookup error → empty audience. Backend push cases go in a new
`server/tests/unit/services/push/pushService.mobileCaps.test.ts` (not `pushService.test.ts`, already 976
lines, which would cross the 1,000-line gate): U2 is not sent to; a lookup error
returns `{ success: false, recorded: false }`.

### B3 — WebSocket servers cap frame size (P2)

**Evidence.** `clientServer.ts:75` and `gatewayServer.ts:52` construct `WebSocketServer` without
`maxPayload`; `ws` defaults to 100 MiB (`node_modules/ws/lib/websocket-server.js:74`). `/ws` accepts
unauthenticated sockets, and `ws` buffers a whole frame before the rate limiter or schema runs.

**Fix.** Set `maxPayload` from named constants sized from the **inbound** messages each server accepts:
the client server's largest is a ~1100-channel `subscribe_batch` (under 100 KiB) → 1 MiB; the gateway
server only receives `auth_response` (`gatewayServer.ts:110,146`) → 64 KiB. An oversized frame closes
the socket (code 1009) and is handled by the existing error/close listeners.

**Failing-first test.** A real-`ws` test (in `server/tests/unit` on an ephemeral port, or in
`server/tests/integration` registered in `backend-integration-groups.sh`): an unauthenticated client
sends a frame larger than the cap → the socket closes with 1009, no `uncaughtException`, and the server
keeps serving. Unit: both servers pass `maxPayload`.

### B4 — AI conversation history returns the newest messages (P2)

**Evidence.** `GET /intelligence/conversations/:id/messages` → `conversationService.getMessages` →
`intelligenceRepository.getMessages(conversationId, 100)` orders `createdAt asc` with `take: 100`, so
turns after the hundredth vanish on reload. The repository's `getNewestMessages` already takes the newest
N with an id tiebreaker and reverses them (the resolved `console-turns--only-oldest-100-returned` fix).

**Fix.** Change `getMessages` itself (mirroring `getNewestMessages`): `desc` order with an `id`
tiebreaker, `take: limit`, then `reverse()` to chronological order. `conversationService` keeps calling
`getMessages(id, 100)` (`conversationService.ts:76`, asserted at `conversationService.test.ts:269`).

**Failing-first test.** The repository unit tests mock `prisma.aIMessage.findMany`
(`tests/unit/repositories/intelligenceRepository.test.ts:539-563`), so assert the query shape (`desc`
order with an id tiebreaker, `take: 100`) and, with **two** mocked rows, that the result is reversed to
chronological order (update the existing `asc` assertions). A DB-backed integration test (registered in `backend-integration-groups.sh`)
with 101 messages is optional extra proof.

### B5 — a resumed single-sig draft with an uploaded signature can be broadcast (P2)

**Evidence.** Since iteration-4 C5, the unattributed `psbt-signed` upload no longer persists a device id
(`useQrSigning.ts`, `useDraftManagement.ts`), and the Drafts-tab upload never sent one
(`DraftList/useDraftListController.ts`). On resume, `buildDraftInitialState`
(`SendTransactionPage/sendTransactionPageHelpers.ts:164-188`) builds `signedDevices` only from
`signedDeviceIds`, so `broadcastUploadedSignedPsbt` (`useSendWizardActionHandlers.ts:39`) returns false
and Sign & Broadcast silently does nothing.

**Fix.** `buildDraftInitialState` has one caller, `buildInitialState` (`sendTransactionPageHelpers.ts:136-137`),
called from `loadSendTransactionPageData.ts:77` where `apiWallet` is loaded (`:45`): add
a **required** `walletType: apiWallet.type` to `buildInitialState`'s params (an optional one would seed
multisig drafts via `!isMultisigType(undefined)`; update the direct calls at
`tests/components/send/draftTransactionData.test.ts:143,189,195`) and seed only when
`!isMultisigType(walletType)` (already used at `sendTransactionPageHelpers.ts:110`). For a **single-sig** wallet,
when the resumed draft has `signedPsbtBase64` and no attributed device ids, seed `signedDevices` with the
local `UNATTRIBUTED_SIGNATURE_ID` (`src/hooks/send/types.ts`), the UI-only marker the upload path uses;
it is never sent to the server. Multisig drafts are not seeded (an unattributed partial signature must
not count toward the quorum).

**Failing-first tests.** Single-sig resume with `signedPsbtBase64` and empty `signedDeviceIds` →
`signedDevices` contains the marker, and the wizard's Sign & Broadcast calls `broadcastTransaction` with
the signed PSBT. Negative: a resumed multisig draft with an unattributed upload gets no seeded marker.

### B6–B8 — admin and intelligence screens show load failures (P2 ×3)

**Evidence.**
- B6 `SystemSettings/AccessControlTab.tsx:155-194`: initial `registrationEnabled = false`; the load error
  from `useLoadingState` is never read, so a failed load shows "Public registration is disabled" and the
  toggle would send `true`.
- B7 `useUsersGroupsController.ts:33,53-68,219-250`: the load error is never exposed; `UserPanel` shows
  "No users found" and `GroupPanel` an empty list.
- B8 `useInsightsController.ts:36-41,57-61` sets `[]` on error ("No insights found."), status updates
  fail log-only; `useChatTabController.ts:35-37,61-64` conversation list and message history fail
  log-only and leave the composer enabled.

**Fix.** Follow the existing NodeConfig/Variables/AISettings pattern (`loadError`, `retryLoad`, a
baseline-ready flag): a load-failure banner with Retry; in B6 no toggle and no status text until the real
value is known; in B7 no empty-list text on failure; in B8 an error state with Retry for insights,
conversations and messages, a visible error for a failed status update, and the composer disabled while
the conversation's history failed to load. B8's `loadError` is set and cleared under the existing
`isFetchOwner(token)` guards and reset in `selectConversation` and on `walletId` change, so a stale
failure never disables the current conversation's composer (test: switching conversation clears it).

**Failing-first tests.** For each: the API mock **rejects** on mount → the banner and Retry render, and
the misleading text does not (B6: neither `RegistrationControlRow` nor "Public registration is
disabled"; B7: no "No users found"; B8: no "No insights found." and the composer disabled), and Retry
reloads. The e2e render-regression contract that pins the disabled text on the success path
(`tests/e2e/render-regression/renderRegressionAdmin.contracts.ts:22-23`) must still pass.

### B9 — documented operator settings reach the containers (P2)

**Evidence.** `docker-compose.yml` has no `env_file`; the backend/worker `environment:` blocks list keys
explicitly and omit settings the server reads and the docs tell operators to set:
`CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_API_DEFAULT`, `JWT_REFRESH_EXPIRES_IN`, `*_RETENTION_DAYS`,
`SLOW_QUERY_THRESHOLD_MS`, `WORKER_HEALTH_TIMEOUT_MS`, `WORKER_HEALTH_CHECK_INTERVAL_MS`
(`WORKER_HEALTH_URL` is already forwarded at `docker-compose.yml:281`). Server reads:
`config/index.ts`, `config/envSections.ts`, `middleware/corsOrigin.ts`, `models/prisma.ts`; docs: the
`config/env/.env.example` and `docs/how-to/operations-runbooks.md`.

**Fix.** Enumerate every key the `config/env/.env.example` or the runbooks document as operator-settable **and**
that `server/src` reads (including `GRAFANA_PORT`, `DISK_WARNING_THRESHOLD_PERCENT`,
`WORKER_DIAGNOSTICS_TIMEOUT_MS`; `start.sh:66-70` already exports the whole env file via
`set -a; source`, and every listed key's parser treats `''` as unset — `envSections.ts:13-19`,
`prisma.ts:37`, `config/index.ts:366-369` — so compose defaults equal to the server defaults suffice); forward each to the service that reads it (backend and/or worker) and export it
from `start.sh` like `RATE_LIMIT_2FA_ACCOUNT`. Compose cannot omit an unset key (`${X-}` and `${X:-}`
both deliver `''`), so each forwarded key either gets a compose default equal to the server's default,
or a test proves the server's parser treats `''` as unset. **`PRICE_PROVIDERS_*` are not forwarded:**
`hasLegacyPriceProviderEnv` tests `!== undefined` (`services/price/providers/config.ts:118-125`), so an
empty value would switch provider bootstrap on (enabling binance) and log a deprecation on every boot;
they are bootstrap-only legacy keys (`server/.env.example:60-61`, the local-development file compose
never reads, is left alone). Correct `config/env/.env.example` instead (its claim that compose
defaults `PRICE_PROVIDERS_DISABLED` is false). **`GRAFANA_PASSWORD` is not forwarded to the backend:**
#770 made it an independent credential that only the monitoring overlay receives
(`docker/compose/monitoring.yml:303,331`), and the backend would return it from `getGrafanaConfig`
(`adminMonitoringService.ts:127-133`). Documented keys nothing reads (`ELECTRUM_SSL`) are removed from the
docs.

**Services.** The gateway also reads `CORS_ALLOWED_ORIGINS` (`gateway/src/config/env.ts:12-13`, used at
`gateway/src/index.ts:61`), and its compose service (`docker-compose.yml:640`) does not forward it —
forward it there too. The `mcp` service runs the backend image (`docker-compose.yml:456-458`): forward the
keys it reads at runtime (`SLOW_QUERY_THRESHOLD_MS` via `models/prisma.ts`, plus the config keys its
startup path reads) or list them as commented exemptions with the reason.

**Failing-first test.** A guard in `tests/install/unit/` (or `tests/ci/`): every documented key that
`server/src` or `gateway/src` reads appears in the right service's compose `environment` (backend,
worker, gateway, mcp) and in `start.sh`'s
export list, with an explicit, commented exemption list (`PRICE_PROVIDERS_*`, and `GRAFANA_PASSWORD`
citing #770). The guard's documented-key set also includes keys from `docs/how-to/operations-runbooks.md`
(e.g. `RATE_LIMIT_API_DEFAULT`, documented only there) — parsed or as a pinned list — or the key is
added to the `config/env/.env.example`. It fails today on the missing keys. The guard is a bash
`tests/install/unit/<name>.test.sh`: CI runs install unit suites through
`scripts/ci/run-install-unit-tests.sh:47`, which globs `tests/install/unit/*.test.sh` and installs no root
dependencies (`:41-44`), so a Node guard would run only if an existing `.sh` suite calls it (as
`install-scope.test.sh:757` does) using built-ins or the `tests/ci/lib` YAML parser. It must **also** be
listed in `tests/install/run-all-tests.sh` (`run_test_suite "…" "$SCRIPT_DIR/unit/<name>.test.sh"` in
`run_unit_suites`, `:133-193`): `tests/ci/ci-registration-completeness.test.sh:353-369` fails CI
(`quality.yml:786`, `:926`) for any unlisted suite. A `tests/ci` file instead goes in `quality.yml`'s
`bash -n` list (`:748-829`) and the `QUALITY_CI_CLASSIFIER_SUITES` heredoc (`:879-965`) (a `.mjs`
test goes in the Node helper list, `:832-834`). Plus the server-side `''`-as-unset test wherever that is relied on.

### B10 — the verify-vectors classifier never skips a wallet-safety critical path (P2)

**Evidence.** `scripts/ci/classify-verify-vectors-scope.sh:119-131` treats every `*.md` / `docs/*` path as
documentation-only. `docs/adr/0003-jade-plus-authentication-boundary.md` is listed in
`config/wallet-safety-critical-paths.json:175`, is hashed into the Jade proof sources
(`run-jade-protocol-harness.sh:226`) and is asserted by `tests/config/jadeProtocolHarness.test.ts`. An
ADR-only PR skips every funds-safety proof while the summary stays green. The test-lane docs check
`is_docs_only_file` (`scripts/ci/classify-files-lib.sh:199`, used by `scripts/ci/classify-test-changes.sh:190`
and `scripts/ci/plan-test-run.sh:181`) has the same gap.

**Fix.** A new shared `is_wallet_safety_critical_file` in `classify-files-lib.sh` matches any `paths`
entry in `config/wallet-safety-critical-paths.json`.
- Verify-vectors classifier: its `is_documentation_only_file` (`classify-verify-vectors-scope.sh:119-131`)
  returns false for such a path, so the scope is `run`.
- Test-lane adapters: `is_docs_only_file` (`classify-files-lib.sh:199-206`) is unchanged; instead, in
  both adapters' docs-only branch — the real CI classifier `classify-test-changes.sh:186-196` (run by
  `test.yml:74`) and the local `plan-test-run.sh:178-185` — a docs-only path that is wallet-safety
  critical calls `mark_full_scan` (plus `classify_full_scan_trigger_file` in `classify-test-changes.sh`)
  instead of being skipped. There is no unknown-file fallback and `is_full_scan_trigger_file`
  (`classify-files-lib.sh:298-311`) has no manifest case, so this explicit branch is what makes an
  ADR-only change run `tests/config/jadeProtocolHarness.test.ts`. Only paths that would otherwise be
  skipped as docs are promoted, so backend manifest paths keep their normal lane routing.
Both resolve the
manifest from their own location (`$(dirname "${BASH_SOURCE[0]}")/../../config/wallet-safety-critical-paths.json`),
never the cwd or `git rev-parse --show-toplevel`: the tests run the real scripts inside fixture repos
(`plan-test-run.test.sh:46-83`, `classify-verify-vectors-scope.test.sh:44-55,~166`), and CI checks out
the full trusted tree (`verify-vectors.yml:73-76`). If the manifest is missing or unreadable,
`is_wallet_safety_critical_file` returns true (critical) — the single owner of the fail-closed contract,
consistent with the classifier's rule for unknowns (`classify-verify-vectors-scope.sh:10-14`) — so the verify-vectors `is_documentation_only_file`
returns false (`run`) and both adapters' docs-only branches `mark_full_scan` for any docs path. The
docs-only assertions at `plan-test-run.test.sh:392-398` run the real script from `$ROOT_DIR` and resolve the
real manifest. The failure fixture at `:78-83` copies `classify-files-lib.sh` into a repo with no
`config/`, so there the matcher hits the missing-manifest case; it stays harmless only because that
fixture's injected diffs (`:107-109`: `server/src/api/push.ts`, `package.json`) contain no docs paths —
note this in the fixture so a docs path added later doesn't trigger an unexpected full scan. Comments in `classify-files-lib.sh` name
`check-wallet-safety-classifier.mjs` and `classify-verify-vectors-scope.sh` by bare filename only, never
as a `scripts/ci/...` literal: the test-lane drift guard (`tests/ci/classify-test-changes.test.sh:78-145`)
greps every literal `scripts/ci/<name>` in the lib, comments included (`:99`), and fails for paths no
predicate covers. Run that guard in B10's verification. The matcher and manifest
reader live **once**, in `classify-files-lib.sh`, which `classify-verify-vectors-scope.sh` also sources
(today it sources only `provider-context.sh`, `:24`). The verify-vectors
classifier job is bash + git only (no Node; `verify-vectors.yml:77-78`), and `verify-vectors.yml` is
provenance-pinned, so **do not edit the workflow**: read the manifest's `paths` strings with POSIX tools
(grep/sed; no jq/node assumption) and implement the matcher in bash with the same semantics as
`matchesClassifierPath` (`scripts/ci/check-wallet-safety-classifier.mjs:12-16`: `**` → any characters,
`*` → any characters except `/`, everything else literal, anchored). Globbed entries also cover
`scripts/verify-addresses/README.md` and `scripts/verify-psbt/README.md`; those triggering a run is
intended (they sit inside proof directories).

**Failing-first tests.** Only that ADR changed → verify-vectors `run`
(`classify-verify-vectors-scope.test.sh`) and full scan in `tests/ci/classify-test-changes.test.sh` (the
real script) and `plan-test-run.test.sh`, asserting `full_scan=true` and the plan JSON's full-scan
field (not only individual lane flags); a backend manifest path keeps its normal lane; an ordinary `docs/` file → still
skipped. The parity test lives in the existing `tests/ci/check-wallet-safety-classifier.test.mjs`
(already imports `matchesClassifierPath`, `:5-9`, and already runs at `quality.yml:834`, so it needs no new
registration): it sources `scripts/ci/classify-files-lib.sh` through `bash -c` (`child_process`), runs
`is_wallet_safety_critical_file` and `matchesClassifierPath` over every manifest pattern and a fixed path
set (literal, `*`, `**`, near-misses), and requires identical results. Register any new `rm -rf` fixture
in `config/resource-lifecycle-callsites.json` (`git add` first), and register any new `tests/ci` test in `.github/workflows/quality.yml`: a
`tests/ci/*.test.sh` in the `bash -n` list (`:748-829`) and the `QUALITY_CI_CLASSIFIER_SUITES` heredoc
(`:879-965`); a new `.mjs` test in the Node helper list (`:832-834`).

---

## Verification (every PR)

Never `npm run dev`/vite on the host. One coverage run at a time. Commit only when no coverage run is
active.

- Focused tests for every phase, confirmed failing on `9f2e17ee` first (record the failure line).
- Typechecks: `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`;
  `cd server && npx tsc --noEmit && npm run typecheck:tests`.
- **Full lint chain:** `npm run lint` (it adds `check:blocking-io`, which the individual `lint:*`
  targets do not run; `lint:server` already runs `check:bitcoin-network-boundaries`).
- Coverage: `cd server && npx vitest run --coverage tests/unit` (100%); `npm run test:coverage` (100%,
  no "Unhandled Errors").
- Integration: touched/new server integration specs (registered in `backend-integration-groups.sh`).
- Quality: `lizard-only.sh` (no rise above the measured 84; gate 86), `jscpd-only.sh`, `check-large-files.mjs`,
  `check-architecture-boundaries.mjs`, `check-safety-catch-guards.mjs`, wallet-sync checkers,
  `check-lifecycle-callsites.mjs`, `npm run verify:signer-inventory`, `npm run arch:check` in the primary
  checkout (commit regenerated graphs).
- **PR A:** critical mutation shard 3 (`MUTATION_SHARD=3`, which mutates `signingIntent/**` and both
  `broadcasting.ts` files per `server/scripts/mutation/shards.mjs:35-40`); add the new and edited test
  files to the critical test list (`server/stryker.critical.config.mjs:63-81` today lists only
  `transactionServiceBroadcast/broadcastContracts.test.ts` from that area): the new `intentSpend` test,
  `tests/unit/services/bitcoin/signingIntent/broadcastLifecycle.test.ts` and
  `tests/unit/services/bitcoin/transactionService.broadcast.test.ts` (the runner for the tag tests) to the
  list in `server/stryker.critical.config.mjs` — this only keeps the `STRYKER_TEST_RUNNER=command`
  fallback (`buildCriticalTestCommand()`) in step; CI's shard uses the default vitest runner
  (`stryker.critical.config.mjs:90` `testRunner: 'vitest'`, `:94` `coverageAnalysis: 'perTest'`; the test glob is `vitest.config.ts:18`), so the
  score comes from those tests killing mutants. Re-pin ranges if lines shift, confirm the gated score in
  `check-critical-mutation-gate.mjs`, and confirm in the shard-3 JSON report that the A2 tag mutants in
  `services/bitcoin/transactions/broadcasting.ts` (the `releasedToReady` branches) are Killed.
- **PR B:** Playwright against a static `dist/` build for changed specs plus `render-regression`
  (including `renderRegressionAdmin.contracts.ts`); the `tests/ci` and `tests/install/unit` suites B9 and
  B10 touch; `node scripts/ci/check-wallet-safety-classifier.mjs` and
  `node tests/ci/check-wallet-safety-classifier.test.mjs`; `bash -n` on changed shell; every new test file
registered in its runner (install unit suites are picked up by the glob in
  `run-install-unit-tests.sh:47` **and** listed in `run-all-tests.sh`, which
  `ci-registration-completeness.test.sh` enforces; `tests/ci` files in `quality.yml`'s `bash -n` list and
  `QUALITY_CI_CLASSIFIER_SUITES` heredoc); gateway package
  tests if gateway files change.
- Semgrep is not installed locally: scan diffs for committed secrets by hand.
- Before committing: `/simplify` and the edge-case audit.

## Delivery, rollback, deployment

- **Order:** PR A → PR B, strictly serial. Hold B locally until A merges, then rebase B only. Squash,
  no admin bypass, `delete_branch_after_merge: false`, verify `merge_commit_sha` ancestry, wait for every
  run on the head (install-test and release-candidate exercise B9).
- **Rollback:** each phase is a separate commit and independently revertible; no data migration. A2's
  metadata field is additive (see its compatibility note).
- **User-visible changes:** A1 approval-required spends (including RBF bumps) go through a pending
  draft, stale `not_required` drafts on such wallets are refused at broadcast, and payjoin is not attempted
  on such wallets (403 at `/payjoin/attempt`; the send goes through a pending draft);
  B1 mobile `balanceHidden` / filtered pending / txid denial; B2 fewer pushes for users without
  `viewTransactions`; B5 resumed single-sig uploaded drafts broadcast; B6–B8 error banners; B9
  documented settings take effect.
- **Deployment:** none here (`--deploy final`).

## Completion criteria

- [ ] PR A merged; target-branch CI green on its merge commit.
- [ ] PR B merged; target-branch CI green on its merge commit.
- [ ] Every phase's regression test failed on `9f2e17ee` and passes on its merge.
- [ ] Owned branches and worktrees cleaned; run state updated.
- [ ] P3 backlog remains outside the blocking fix set.
