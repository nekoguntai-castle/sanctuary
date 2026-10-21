# Bug-scrub loop 20261013 — iteration 10 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 10
- **Source SHA:** `f9047d86d63eae16378bf7c57e39a12191331d4a` (`main`, after #1408)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (12 × P2).** All 12 were re-verified from source at `f9047d86d6` (file:line below). **None is
  rejected.** P3 findings from this scrub (including `payjoin-attempt--route-timeout-shorter-than-receiver-budget`)
  are backlog in run state and are **outside this fix set**.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `send-payjoin--stale-payjoin-url-after-output-remove-or-type-switch` | P2 |
| A2 | `send-review--payjoin-proposal-total-counts-receiver-fee` | P2 |
| B1 | `ownership-transfer--keep-existing-users-false-keeps-shared-users` | P2 |
| B2 | `agent-api--key-survives-user-wallet-access-loss` | P2 |
| C1 | `auth-refresh--fresh-expiry-short-circuits-401-recovery` | P2 |
| C2 | `settings-telegram--global-save-reverts-wallet-telegram-settings` | P2 |
| C3 | `support-package--armed-capture-unreadable-after-remount` | P2 |
| C4 | `node-config--fee-source-shown-mempool-runtime-electrum` | P2 |
| D1 | `create-wallet--script-type-chosen-after-signer-filter-dead-end` | P2 |
| E1 | `price-historical--unauthenticated-uncached-upstream-calls` | P2 |
| F1 | `ci-classifier--non-src-vitest-inputs-skip-frontend-lane` | P2 |
| F2 | `rc-canary--endpoint-and-fallback-gates-probe-api-not-worker` | P2 |

## Resolved question

- **OQ-1 (C4): what does a NULL fee-estimator URL mean?** `server/prisma/schema.prisma:848` comments
  `feeEstimatorUrl String? // ... (defaults to mempool.space)`, but runtime (`server/src/services/bitcoin/feeService.ts:31-35`
  → `hasConfiguredNodeMempoolFeeEstimator`, `shared/constants/nodeConfig.ts:546-553`) treats NULL as "not configured" and
  uses Electrum, and the UI round-trip convention stores an explicit Electrum choice as `''`. The two documented signals
  disagree. **Resolved by the coordinator (D-10.11):** this is not a new policy: runtime behaviour since the field was added is NULL = Electrum, and that is what every existing install does today. The fix keeps runtime unchanged (NULL = Electrum, no silent new
  third-party egress) and fix the admin projection to match it. Switching NULL to mempool.space would be a privacy-relevant behaviour
  change for every pre-2026-05 install and is out of scope. The schema comment is not edited here (no `schema.prisma` churn); the PR
  body flags it.

## Goal and non-goals

**Goal:** fix every P2 confirmed by the iteration-10 scrub, each with a non-regression test that fails on `f9047d86d6`
and passes after the fix, delivered in one protected PR with green CI.

**Non-goals:** the P3 backlog; new Prisma migrations or `schema.prisma` edits (frozen by the RC10 migration-tree digest);
branch-protection or workflow-trigger changes; receipt schema changes for the canary; revoking drafts, approval votes or
agents of users removed by an ownership transfer (B2's per-request guard makes their agents inert; drafts stay wallet
records); multisig script-type selection (no multisig picker exists, D-10.10); bounding distinct-valid-date historical
price fan-out beyond the per-IP valve (residual, D-10.8); device access derived from `Device.userId` or from membership of
a wallet that contains the device (`server/src/repositories/accessControl.ts:63-82`), which B1 does not revoke (residual,
D-10.4; stated in the PR body); deleting or fixing the dead duplicate `server/src/services/price/historicalPriceService.ts`
(P3 backlog material, D-10.16); serializing B1's confirm against a concurrent direct user share (residual, D-10.20; PR
body); F1 PR-time detection of a read added only under `server/tests/**` (caught by the nightly full scan) or of root
suites reading `server/src` on server-only PRs, routing `server/src` to the frontend lane, and re-running the
`phase2OperationsProof` integration suite on gateway-only PRs (allowlisted gateway import, D-10.18 rule 6), and running
root suites that read `gateway/src` (`addressDerivationBoundaryPolicy.test.ts:10`) on gateway-only PRs (caught by the
nightly full scan, pass 14) (residuals, D-10.21; PR body).

## Decisions

Coordinator directions are followed as written except where a numbered decision refines them.

- **D-10.1 (A1) binding shape.** Add `payjoinAddress: string | null` next to `payjoinUrl` in `TransactionState` and
  `SerializableTransactionState` (`src/contexts/send/types.ts:95,215`) and extend the action to
  `{ type: 'SET_PAYJOIN_URL'; url: string | null; address: string | null }`, instead of nesting `{url,address}`: the draft
  API (`src/api/drafts.ts:67,124`) and `useDraftManagement.ts:102` keep sending a plain `payjoinUrl`, and
  `useSendTransactionActions.ts:179` (`getSendIdentity`, which reads `payjoinUrl` into the send-identity memo key at `:209`;
  it is not a request) keeps a plain string too. `createInitialState` (`src/contexts/send/reducer.ts:60`) gains
  `payjoinAddress: null`. One pure selector `getBoundPayjoinUrl(state)` (new, in `src/contexts/send/reducerParts/payjoin.ts`)
  returns the URL only when `transactionType === 'standard'`, `outputs.length === 1`, `payjoinAddress` is set and
  `canonicalSegwitAddressCase(outputs[0].address) === canonicalSegwitAddressCase(payjoinAddress)`
  (`shared/utils/bitcoin.ts:96`). Every consumer (candidate predicate, review notice, badges, draft save, create request)
  reads the selector, never `state.payjoinUrl` directly. (Pass 5.) Every consumer imports `getBoundPayjoinUrl` directly
  from `src/contexts/send/reducerParts/payjoin`, never through the `src/contexts/send` barrel, and the selector is **not**
  added to the barrel: nine frontend suites mock the whole barrel with only `useSendTransaction` (e.g.
  `OutputsStep.test.tsx:14-16`, `OutputsStep.branches.test.tsx:28-30`, `ReviewStep.payjoin.test.tsx:23-25`,
  `ReviewStep{,.branches}.test.tsx`, `SendTransactionWizard{,.branches}.test.tsx`, `WizardNavigation.test.tsx`,
  `TypeSelection.test.tsx`), so a barrel import would be `undefined` there. Clearing is done by `clearPayjoinIfUnbound` (Phase A1: clear only
  when the bound address was present in the previous outputs and is absent from the next, compared canonically). `isPayjoinCandidate`'s state `Pick` (`usePayjoin.ts:122`) widens
  to include `transactionType` and `payjoinAddress`. Send wizard state is never persisted (`serializeState` is used only for
  drafts, `SendTransactionContext.tsx:339-341`), so there is no pre-deploy wizard state to migrate. Draft restore (`sendTransactionPageHelpers.ts:186`) binds to the
  restored first output's address (drafts are never payjoin candidates anyway, `usePayjoin.ts:136-137`).
- **D-10.2 (A2) round-two totals.** For a proposal under review, `Total Sending = effectiveAmount` (the server's net spend,
  `P - r`, identical to the panel's "Net spend"), `Network Fee = proposal.fee` (identical to the panel's "Total fee"), and
  `Total (including fee) = effectiveAmount + fee`. `intentSpend.ts:22-28` documents that `amount + fee` is the sender's
  real outflow (sender inputs − sender outputs; equals `P + originalFee` when the sender's change is unchanged), so the
  three lines add up, agree with the panel, and never charge the receiver's fee share to the sender. "Proposal under
  review" uses the panel's own predicate (`status ∈ {awaiting-signature, broadcasting}` and an original present,
  `PayjoinProposalPanel.tsx:130-131`), exported once as `isPayjoinProposalReview(status, originalTxData)`.
  (Pass 10.) `TransactionData.effectiveAmount` is optional (`src/hooks/send/types.ts:28`) and `getTotalSendingSats`
  returns `number` (`transactionSummaryModel.ts:56-75`), so the proposal arm is `txData.effectiveAmount ?? <the existing
  non-proposal result>`, never `?? 0` (which would show 0 sats); the including-fee total is that value `+ fee`.
  **Coordinator decision (pass 2): recipient row.** In round two the recipient row deliberately keeps showing `P`, the
  payment the user requested (`getRecipientDisplayAmount` from `txData.outputs`, `TransactionSummary.tsx:200-210`), while
  Total Sending / Total (including fee) show the real net cost; the round-two `ReviewStep.payjoin` test asserts the row value.
- **D-10.3 (A2) flow preview source.** The preview's outputs for a proposal come from the proposal PSBT
  (`txData.psbtBase64` outputs decoded with the wallet network), and receiver-added inputs get the label "Receiver input"
  instead of an empty address. Change is `txData.changeAddress` **plus every `decoyOutputs[].address`** (Stonewall decoys;
  `buildReviewOutputs` already treats them so, `reviewStepData.ts:229-243`). **Coordinator decision:** decoy sends stay
  payjoin-eligible; no `!useDecoys` is added to the candidate predicate. Network mapping uses one named helper
  `toBitcoinJsNetwork(network)` in `reviewStepData.ts` (A-owned) (mainnet or `undefined` → `bitcoin`, as
  `usePayjoin.ts:168` does, since `Wallet.network` is optional, `src/types/index.ts:497`; regtest → `regtest`,
  testnet3/testnet4/signet → `testnet`); the
  existing mapping in `psbtAccountBinding.ts:40` sends every non-mainnet network to `testnet` and would mislabel change on
  regtest, so it is not reused. (Pass 6.) `bitcoin.address.fromOutputScript` needs an initialised ECC library for P2TR
  outputs in bitcoinjs-lib 7.0.2 (`payments/p2tr.cjs:259`), and the only `initEccLib` calls in `src/` sit behind the lazily
  loaded hardware runtime (`psbtAccountBinding.ts:17`, `adapters/jadeSignedPsbt.ts:11`; `tests/setup.ts` does not init it);
  Taproot wallets are payjoin-eligible, so `reviewStepData.ts` initialises it at module level
  (`import * as ecc from '@bitcoinerlab/secp256k1'; bitcoin.initEccLib(ecc);`, the pattern of
  `psbtAccountBinding.ts:1-2,17`), or every proposal with a P2TR output would take the fallback. (Pass 8, replacing the
  pass-7 fixture wording.) The P2TR test fixture holds the script as raw bytes (`0x51 0x20` + the x-only key of a BIP86
  test-vector bc1p address) with no bitcoinjs address call and no `initEccLib`, and the round-trip is asserted inside the
  `reviewStepData.test.ts` P2TR case after `reviewStepData` is imported; no test file or fixture used by these suites calls
  `initEccLib` itself (see A2). Decoding runs in a `try/catch` that logs at `log.debug` and falls back to the current
  (`txData.outputs`) preview. `BuildReviewFlowDataParams` gains `payjoinStatus`, `payjoinOriginalTxData` and `network`
  (needed to tell receiver inputs from the original's), and all three join the `flowData` `useMemo` deps
  (`ReviewStep.tsx:134-146`; `payjoinStatus` is missing today). `TransactionData.outputs`
  is **not** rewritten (broadcast/draft metadata keeps the shape `applyPayjoinProposal` documents, `usePayjoin.ts:224-229`).
- **D-10.4 (B1) scope of "all existing access".** `keepExistingUsers=false` deletes every `WalletUser`/`DeviceUser` row
  except the new owner's and clears the resource's group grant (`groupId = null, groupRole = 'viewer'`, both wallet and
  device). `MobilePermission` rows are left untouched (parity with `DELETE /wallets/:id/share/user/:id`,
  `api/wallets/sharing.ts:161`; without a `WalletUser` row they grant nothing). Audit: `AuditAction.WALLET_UNSHARE`
  (defined, `auditService.ts:71`, currently unused) and a new `DEVICE_UNSHARE = 'device.unshare'` (action is a string
  column; no migration), category WALLET/DEVICE, details `{ reason: 'ownership_transfer', transferId, removedUserIds,
  removedGroupId }`, written after commit (`auditService.log` swallows its own failures). `true` is unchanged.
  **Device scope:** device acceptance covers direct (`DeviceUser`) and group grants only. Device access also flows via
  `Device.userId` and via membership of any wallet containing the device (`server/src/repositories/accessControl.ts:63-82`);
  that wallet-derived access is a recorded residual (non-goals, PR body), and any device `hasAccess` assertion documents it
  instead of implying `false`. New edge `services/transferService/confirm → services/auditService` (no cycle:
  `auditService` imports only repositories/utils).
- **D-10.5 (B2) guard location and reason.** The check lives in `authenticateAgentRequest` (`server/src/agent/auth.ts:102-146`),
  the single function every agent route passes (`api/agent.ts:83 router.use(authenticateAgent)` →
  `middleware/agentAuth.ts:15`), after the agent-active check and **before** `updateApiKeyLastUsedIfStale`, so a refused
  call is not recorded as use. Predicate: `walletRepository.hasAccess` for funding and operational wallets in
  `Promise.all` (the same predicate as `adminAgentService.ts:106-120`). Refusal:
  `ForbiddenError('Agent user no longer has access to the <funding|operational> wallet', ErrorCodes.FORBIDDEN,
  { reason: 'agent_user_wallet_access_lost', wallet: 'funding' | 'operational' })`. Agent state is not mutated.
- **D-10.6 (C1) snapshot API.** `refreshAccessToken(options?: { expiryAtRequestStart?: number | null })`. The 401
  interceptor captures `getAccessExpiresAtMs()` **inside each attempt's operation** passed to `withRetry` (not once before
  it, as `client.ts:561` would do today), so a retried safe read that spans a cross-tab rotation uses the last attempt's
  snapshot (last attempt wins); inside the lock the short-circuit fires only when the expiry is fresh **and** differs from
  the snapshot (another tab rotated after the request was sent). Callers without the option (the scheduled timer,
  `refresh.ts:~141-152`) keep today's short-circuit. **Joining:** `refreshAccessToken` returns any in-flight promise
  (`refresh.ts:252`), and that promise may itself be a short-circuited one (R1 with snapshot X 401s after a broadcast set Y,
  `refresh.ts:66-71`, and short-circuits; R2, a revoked-session 401 with snapshot Y, joins R1's promise, replays, 401s, and
  never logs out). So a joiner whose snapshot equals the current expiry re-runs the check (a fresh `refreshAccessToken`
  with its snapshot) after the shared promise settles; single-flight is otherwise preserved.
- **D-10.7 (C2) merge depth.** Client omits `wallets` from the global save; server merges `telegram` one level deep
  (`{...existing.telegram, ...patch.telegram}`), so an explicit `wallets` key still replaces (backward compatible with old
  bundles and API callers; old open tabs keep the bug until reload, noted in the PR). No per-wallet deep merge: it would not
  help a stale full copy. The client optimistic merge `mergePreferencePatch` (`src/utils/preferencePaths.ts:99-107`)
  documents that it mirrors the backend's top-level semantics, so it mirrors the same one-level `telegram` merge (keeping
  the optimistic `telegram.wallets`). Typing: `updatePreferences` takes `Partial<UserPreferences>`
  (`src/contexts/useUserPreferenceMutation.ts:74`) and `UserPreferences.telegram` is a full `TelegramConfig`
  (`src/types/user.ts:55`, which requires `wallets`, `src/types/ui.ts:59`), so a new `UserPreferencesPatch` type
  (`Omit<Partial<UserPreferences>, 'telegram'> & { telegram?: Partial<TelegramConfig> }`), defined in `src/types/user.ts`,
  is the parameter type at every `updatePreferences` signature: `src/contexts/userContextTypes.ts:39` (the context type
  that `useTelegramSettings.ts:16` reaches through `useUser()`), `useUserPreferenceMutation.ts:74` (return type) and `:276`
  (the implementation callback), and `src/api/auth.ts:133`.
- **D-10.8 (E1) where validation lives.** In the service (`getHistoricalPrice`/`getPriceHistory`), before the `try` that
  wraps errors into a generic 500, so the route, the mapped-JSON webhook (`mappedJson.ts:139,144`) and the assistant tool
  (`marketReadTools.ts:17,96`) are all protected. (Pass 10.) `PriceService` initializes lazily (the constructor creates an
  empty registry, `index.ts:71-73`; providers are registered only in `initialize()`, `:79-86`; nothing calls it at
  startup), so `await this.ensureInitialized()` stays the first line of both methods and every check below
  (`resolveSupportedCurrency` included) runs after it; a check before it would reject USD on the first request after boot. The two methods differ because their upstream calls differ:
  - `getPriceHistory` sends `vs_currency` upstream through the breaker, so it gets the supported-currency allowlist: the
    historical provider's own `supportedCurrencies` (CoinGecko, `coingecko.ts:39`), compared upper-cased. (Pass 3.) The
    check reads the static list of the **registered** history-capable provider
    (`registry.getAll().find(hasHistoricalSupport)?.supportsCurrency`, no health check) and runs **before** any
    `getHistoricalProvider()` call: `getHistoricalProvider()` (`index.ts:536-549`) runs `provider.healthCheck()` →
    `getPrice('USD')`, an uncached `axios.get` to `simple/price` (`providers/base.ts:71-80,89-99,123-127`), so validating
    after it would still hit CoinGecko for `zzz`. `getHistoricalProvider()` and the fetch move inside the `singleFlight`
    callback in both methods.
  - `getHistoricalPrice` gets **no allowlist**: CoinGecko `/coins/bitcoin/history` sends no currency
    (`providers/coingecko.ts:95-100`) and reads `current_price[currency]` from a multi-currency map, and webhooks and the
    assistant pass arbitrary codes that work today. Instead it single-flights and caches **by date** (storing the whole
    `current_price` map), resolves the currency locally from that map, and rejects a code absent from the map
    (`InvalidInputError`) without another upstream call. **Per-caller resolution (pass 14):** `historicalPriceRequests`
    is keyed by date only and `singleFlight` (`index.ts:185-202`) shares one promise per key, so the callback returns
    **only** the non-empty `current_price` map (`getHistoricalProvider()` → `getHistoricalPriceMap(date)` → cache write);
    each caller resolves its own lower-cased currency **after** `await this.singleFlight(...)`, and that is where
    `InvalidInputError('Unsupported currency')` is raised, outside the date-keyed promise (a lookup inside the callback
    would hand a concurrent EUR caller the USD value and couple a `ZZZ` caller's outcome to a USD caller's). **Provider method (pass 2):** caching the map needs a new
    `getHistoricalPriceMap(date)` on `IPriceProviderWithHistory` (`services/price/types.ts:100`) and
    `CoinGeckoPriceProvider`, returning the whole `current_price` map; `getHistoricalPrice` on the provider is kept
    unchanged (the dead `historicalPriceService.ts` and `types.test.ts` still use it). The service looks the map up with
    the **lower-cased** code (CoinGecko's map keys are lower case). **Optional method (pass 3, coordinator choice):** it is
    declared `getHistoricalPriceMap?(date: Date): Promise<Record<string, number>>`, **optional** on
    `IPriceProviderWithHistory`, because a required method breaks `typecheck:tests` through the dead-module test
    `server/tests/unit/services/price/historicalPriceService.test.ts:63-80`, which D-10.16 leaves untouched. It is
    implemented on `CoinGeckoPriceProvider`; when the provider lacks it, the service throws a typed "no provider with
    historical map support" error. **Map cache (pass 3):** `getHistoricalPriceMap` throws "not available" when
    `current_price` is missing or empty (as `coingecko.ts:103-107` does today); only non-empty maps are cached; a missing
    day gets only a short negative cache; `InvalidInputError('Unsupported currency')` is raised only for a code absent from
    a non-empty map. **Error wrapping (pass 6, pass 14):** the existing catches (`index.ts:479-485`, `:518-524`) rethrow
    `InvalidInputError` and the typed "no provider with historical map support" error unchanged, so a code missing from
    the map (resolved per caller after the `singleFlight` await) reaches the route as 400, not 500.
  The upper-cased code is the cache/response currency key (no `usd`/`USD` split). Invalid dates (`isNaN(date.getTime())`,
  reachable from `mappedJson.ts:144`) are rejected with `InvalidInputError` before the cutoff check (normalising first
  inside or before the `try` would surface a raw `RangeError` or a generic 500). The provider's `DD-MM-YYYY` construction
  (`coingecko.ts:90-93`) switches to `getUTCDate`/`getUTCMonth`/`getUTCFullYear` in the same commit, so the requested UTC
  day is the day fetched. The pure helpers (currency resolution, UTC day key, cutoff/invalid-date check) move into a new
  covered module `server/src/services/price/historicalLookup.ts`, because `server/vitest.config.ts:38` excludes
  `**/index.ts` from coverage (taking the comment's preferred option). Dates before 2013-04-28 (CoinGecko's first BTC history
  day) are rejected; failures are never cached today, so a short-lived per-day negative cache for "not available" is
  allowed. Date normalisation and comparison are in UTC (`index.ts:437` uses local `setHours` today). Residual (accepted):
  distinct valid past dates still cost one upstream call each until cached, bounded by the per-IP valve; PR notes it.
- **D-10.9 (C3) re-enterable, not persisted.** The selector inputs stay enabled while a capture is active and show copy
  telling the admin to re-enter the exact armed txid/sender/receiver and the approximate time (`incidentRequest` requires
  it, `SupportPackageCard.tsx:187-196`). Persisting them (sessionStorage) is rejected: the
  privacy doc (`docs/reference/privacy-safe-support-package.md:353-358`) keeps selector values out of every response, and
  storing txid + wallet ids in browser storage beyond the capture would weaken that. Arm is disabled unless the capture
  state is `inactive`, `invalid` or null, so every other state, including `tearing_down` (`controlledCapture.ts:116`), keeps
  it disabled (the server already refuses with `session_busy` whenever its phase is not inactive, `controlledCapture.ts:96`).
- **D-10.10 (D1) multisig.** No multisig script-type picker exists (`ConfigurationStep.tsx:70-94` renders only for
  `SINGLE_SIG`; multisig is fixed at `NATIVE_SEGWIT`), so "same principle for multisig" has no dead end to fix; multisig is
  unchanged. Single-sig: changing the script type in step 3 rebinds the account in place instead of clearing the selection
  and returning to step 2. **Defensive case:** `selectScriptType` with a type the selected signer does not support (the UI
  disables those options; only reachable when a test drives it through a mocked `ConfigurationStep`,
  `CreateWallet.branches.test.tsx:110`) is a no-op: `scriptType`, the selection and the step are unchanged, so no selection
  ever holds an account of another script type. The no-op applies only when a selected signer lacks the type: with **no
  selected signer**, `selectScriptType` sets `scriptType` and leaves the step unchanged (`CreateWallet.branches.test.tsx:369-370`
  expects step 1). **Step-2 path display:** `getDisplayAccount`
  (`getDisplayAccountForNetwork`, `useCreateWalletController.ts:164-167`) shows the account for the current script type if the device supports it, else
  the account for the device's first supported type (in `SINGLE_SIG_SCRIPT_ORDER`), so a 49'-only device is not listed
  without a path (`SignerDeviceCard.tsx:21,39-43`). **Prop (pass 4, coordinator choice):** `supportedScriptTypes` is a
  required `ConfigurationStep` prop, forwarded through `CreateWalletStepContent` from `CreateWallet.tsx`; every renderer
  of `ConfigurationStep` in tests (including `tests/components/coverageFallbacks.test.tsx:85-103`) passes it.
- **D-10.11 (C4)** follows OQ-1's default. The no-row `GET /admin/node-config` default (`api/admin/nodeConfig.ts:166-173`)
  also returns `''` fee estimators, because runtime with no row is Electrum too; fresh installs are unaffected (the seed
  writes explicit mempool URLs, `server/prisma/seed.ts:562-569`). The frontend mirror `DEFAULT_NODE_CONFIG`
  (`src/components/NodeConfig/nodeConfigData.ts:18-24`) sets its four fee-estimator fields to `''` to match. (Pass 2.) The
  projection goes through `getConfiguredNodeExternalServiceUrl(...) ?? ''`, so a whitespace-only stored value also reads
  as `''` (Electrum), matching runtime trimming (`shared/constants/nodeConfig.ts:491-493`) and the UI's truthiness check.
- **D-10.12 (F1) exact paths, no proof-input fallback.** (Amended in review pass 1; the first/preferred option of each
  comment is taken.) Vitest inputs are classified **by exact path only**: the paths the drift guard reports, hand-listed
  in a POSIX `case` in `classify-files-lib.sh` (pass 2: no generated manifest, D-10.18); there are no broad `docker/* | config/* | scripts/*` globs. Broad globs would
  claim the proof inputs (8 under `config/`, 3 under `config/ledger-emulator/`, 31 `scripts/verify-*`/`scripts/` inputs),
  would weaken `assert_every_test_workflow_script_is_classified` (`tests/ci/classify-test-changes.test.sh:137-140`), and
  would make a fallback unreachable. The step-2 proof-input full-scan fallback is **removed**: it would force full scans for
  frequently edited files (`.nvmrc`, 16 `scripts/ci/*` proof scripts, `scripts/ci/images/go-runner.Dockerfile`, 4
  `tests/ci/*` including `check-workflow-composition.test.sh`), contradicting the documented decision above
  `is_full_scan_trigger_file` (`classify-files-lib.sh:362-377`), and verify-vectors already re-runs the proofs for those
  inputs (`classify-verify-vectors-scope.sh:126`). A proof input that a Vitest suite reads (e.g.
  `config/jade-emulator-proof.json`) is classified by exact path like any other input (`frontend_changed=true` /
  backend). `scripts/lib/*` stays out; workflows a Vitest suite reads (e.g. `verify-vectors.yml`) are exact-path frontend
  inputs; `install-test.yml` and `quality.yml` stay unclaimed. (Pass 3, D-10.21.) `.nvmrc` is read by root Vitest suites,
  so it is an exact-path frontend input (`frontend_changed=true`, `full_scan=false`), not a full-scan trigger.
- **D-10.13 (F2) no receipt schema change.** The validator checks `remoteEvidence` with `exactKeys`
  (`verify-release-candidate-canary.mjs:304-310`), so an added `endpointOrigin` key would reject every existing v2 receipt.
  The fix is in the probe and selftest only, guarded by a static source test; the probe also proves worker reachability
  before arming instead of recording a hard-coded `workerReachable: true` (`canary-probe.mjs:111`). Worker reachability
  iterates every worker IP the way backend discovery does (`canary-probe.mjs:81-86`) and sets `workerBase` to the first
  that answers `/live`, in both the probe and the selftest (`canary-selftest.mjs:44`).
- **D-10.14 (cross-cutting) OpenAPI contract file.** `server/tests/unit/api/openapi.gateway.contracts.ts` (976 lines) holds
  the `/transfers` (`:787-794`), `/agent` (`:40-55`) and `/auth/me/preferences` (`:256,297`) contracts; B and C would both
  edit it and ~25 added lines break the 1,000-line gate. New OpenAPI assertions go in new **standalone** per-phase test
  files (`server/tests/unit/api/openapi.transfers-agent.test.ts` for B, `openapi.preferences.test.ts` for C; precedent
  `openapi.bitcoinStatusSchema.test.ts`, `openapi.psbt-signing-context.test.ts`), which Vitest picks up directly, so each
  B/C worker can record its own red/green run. Workers do not edit `openapi.gateway.contracts.ts` or `openapi.test.ts`, and
  there is no integrator registration step (amended in pass 2).
- **D-10.15 (Delivery) one worktree per phase.** Parallel phases on one worktree/index are unsafe (shared index, pre-commit
  tests flaking under another worker's coverage, `shared/dist` rebuild races, concurrent coverage OOM). Each phase gets its
  own worktree under `/home/nekoguntai` (never `/tmp`), cut from one base: the final reviewed plan commit (recorded by the
  integrator when cutting worktrees; amended in pass 3, it differs from `f9047d86d6` only under `tasks/`) so each worker
  has the plan. F1 and F2 are on separate branches (`…-i10-f1`, `…-i10-f2`) so F2 can be held alone (D-10.19). Set up with root `npm ci` + `npx prisma generate` (+ the
  shared build) and nvm node on `PATH` (the pre-commit hook trips `devEngines` with the default npm); workers edit, run
  targeted tests only and commit on their own phase branch. **Every commit, worker or integrator, is serialized through one
  host-wide lock:** `flock /home/nekoguntai/.i10-commit.lock git commit …` (the pre-commit hook runs tests that flake
  under concurrent load). The integrator cherry-picks the phase commits serially onto the PR branch, starts coverage only
  after all seven phase branches (A–E, F1, F2) are complete, or the six without a held F2, and is the only one who runs it, behind the coverage guard: a bounded wait
  loop on `pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage'` (this pattern also matches
  `npx vitest run --config … --coverage`) that fails loudly on timeout, then the run (amended in pass 2; replaces
  `pgrep … || (run)`, which skipped the run silently when another was active). (Pass 5.) The guard is called as
  `wait_for_no_coverage || exit 1` on its own line before each coverage run, and every gate in the Verification block is
  its own line: under `set -euo pipefail`, a failure in a non-final command of an `&&` list does not exit the script
  (`bash -c 'set -euo pipefail; false && true; echo still'` prints `still`). Each cherry-picked phase branch is proven
  upstream with `git cherry <PR-branch> <phase-branch>` (every line `-`) before `git branch -D`, and its worktree is
  removed by path; a held F2 branch is kept, not deleted (D-10.19).
- **D-10.16 (E1) dead duplicate module.** `server/src/services/price/historicalPriceService.ts` is not imported by anything
  in `server/src`; its test file `server/tests/unit/services/price/historicalPriceService.test.ts` tests that dead module.
  E1's failing-first tests target `PriceService` (`index.ts:428-525`) in the new
  `server/tests/unit/services/price.historical.test.ts` (pass 3; `price.test.ts` is already 765 lines). The
  dead module and its test are left untouched in this PR (noted as P3 backlog material in the PR body), not deleted.
- **D-10.17 (C1) joiner re-check.** Of the two fixes for the joined short-circuit (D-10.6), the preferred one is taken: a
  joiner whose snapshot equals the current expiry re-runs the check after the shared promise settles; joiners are not
  refused and the single-flight lock is not split. (Pass 6.) A joiner whose snapshot no longer equals the expiry after
  settling (R1 really refreshed) does not re-run, and a terminal rejection of the shared promise propagates to joiners
  with no second fetch; both arms are tested (C1 tests 4 and 5).
- **D-10.18 (F1) hand-listed exact paths; install-root manifests.** (Pass 2.) The exact Vitest-input paths are a
  hand-listed POSIX `case` in `classify-files-lib.sh`, not a generated manifest (the lib is sourced under `sh` by the
  pre-commit hook, and a generated file would be one more drift surface; the drift guard keeps the list honest). Every
  call site of the backend predicate gets the new backend-input predicate beside it (`classify-test-changes.sh:87`
  in `classify_full_scan_trigger_file`, `:238`, `plan-test-run.sh:218`). `scripts/verify-psbt/package.json` and
  `package-lock.json`, read through `tests/ci/npmOverridesApplied.test.ts`'s dynamic install-root discovery, are
  classified as exact-path frontend inputs (first option: expand to tracked files, not allowlist), and the guard fails on
  any directory literal that is neither expanded nor allowlisted with a reason. **Guard resolution rules** (pass 9;
  restated as one list in pass 10, the single source referenced by F1's design, tests and acceptance):
  1. *Scan scope:* the files in the Vitest include sets (root config, including `tests/ci/verify-jade-junit.test.mjs`,
     `config/tooling/vitest.config.ts:39`; the server Vitest config's include, `server/vitest.config.ts:18`; the
     llm-egress-proxy config's `tests/llm-egress-proxy/**`, `llm-egress-proxy/vitest.config.ts:11`) plus the
     **transitive closure** of their relative imports over every module outside `src/`, `shared/`, `server/src/` and
     `gateway/` (imports into those trees are not followed; pass 11: following the rule-6 gateway import would pull in
     `gateway/src/middleware/requestLogger.ts:35-37`, `auth.ts:38-40` and `config.ts:57-58`, five more gateway files that
     fail rule 5), e.g. `scripts/verify-addresses/implementations/{bitcoincore,bitcoinjs,go}.ts`
     and `outputFile.ts`, reached through `generate-vectors.ts:8-13`, and `scripts/verify-psbt/types.ts`. Excluded:
     `tests/e2e`, `tests/release`, `node --test` suites (e.g. `tests/install/unit/install-workflow-trigger-contract.test.mjs`,
     `tests/ownership/operator-recovery-*.test.mjs`) and the guard file itself.
  2. *Resolution order* for each relative import specifier and each repo-relative literal (`../` resolved against the
     file's directory; `server/tests/**` literals against both the repo root and `server/`): (a) the exact file as
     written; (b) TypeScript-style specifier mapping, `.js` → `.ts`/`.tsx` and `.mjs` → `.mts` (19 such specifiers today,
     e.g. `generate-vectors.ts:8` `'./implementations/bitcoincore.js'`); (c) appended extensions `.ts`, `.tsx`, `.mts`,
     `.mjs`, `.js`; (d) directory entries `/index.ts`, `/index.tsx`, `/index.js` (33 imports target an `index.tsx`
     directory, e.g. `tests/components/Login.test.tsx` → `'../../src/components/Login'`). The first tracked hit wins.
     (Pass 11.) A literal is resolved **first**, then kept only if its target lies under the literal prefix set
     (`docker/`, `config/`, `scripts/`, `.github/`, `docs/`, tracked root-level files, and non-`server/src` `server/`
     paths for root suites). A target equal to the repo root, or to an ancestor directory of the reading file, is a path
     anchor and is skipped, not treated as a directory input: e.g. `resolve(__dirname, '../..')` in the
     `tests/config/*Proof*`/`*Binding*` tests, `jadeProtocolHarness`, `coveragePolicy`, `addressDerivationBoundaryPolicy`,
     `tests/ci/{npmOverridesApplied,trezorEmulatorRunnerPreflight,dockerExecTcpForwarder}`, `tests/docs/readme-links` and
     `verifyPsbtProvenance`; `'../../..'` in `server/tests/helpers/hardwareSigned{FixtureIntake,EvidenceProvenance}.ts`;
     the anchors in `scripts/ci/hardware-compatibility-report.ts`, `scripts/demo/lib/env.mjs` and the `docs/site` plugin
     (`'../..'`).
  3. *Non-input trees:* `src/`, `shared/`, `tests/`, `server/src/` and `server/tests/` hold code and tests that the
     existing predicates already classify; a resolved target in them is not an input, except the non-`server/src`
     `server/` files root suites read (D-10.21, pass 9), which are inputs. `server/src/**` read by root suites stays the
     D-10.21 residual.
  4. *"Resolves to nothing":* a literal or specifier with no hit under rule 2 fails unless allowlisted with a reason,
     **only** when its target lies outside the non-input trees of rule 3; unresolved targets inside them are ignored.
     Gitignored generated paths are explicitly not inputs and never fail (99 imports reach the gitignored Prisma client,
     e.g. `server/tests/mocks/prisma.ts` → `'../../src/generated/prisma/client'`, `server/.gitignore:33`).
  5. *Lane acceptance:* each input read from a root suite must classify frontend or full-scan; from `server/tests/**`,
     backend or full-scan; from `tests/llm-egress-proxy/**`, `is_llm_egress_proxy_file` (`classify-test-changes.sh:206-213`;
     that lane's Vitest config includes `tests/llm-egress-proxy/**`) or full-scan. (Pass 11.) `tests/llm-egress-proxy/**`
     suites also match the root include (`config/tooling/vitest.config.ts:39`, not excluded by `:91-96`); a reader under
     `tests/llm-egress-proxy/**` is judged **only** by the llm-egress-proxy clause, matching the classifier's `continue`
     before the frontend branch (`classify-test-changes.sh:207-213`). No proof-fallback category exists.
     Directory literals are expanded to tracked files or allowlisted with a reason; a stale allowlist entry fails.
  6. *Gateway allowlist residual (coordinator choice, option b):* the single cross-package import
     `server/tests/integration/ops/phase2OperationsProof.integration.test.ts:135` →
     `gateway/src/middleware/requestLogger.ts` (classified `is_gateway_file` only) is allowlisted with that reason and
     is neither classified as an input nor followed (rule 1, pass 11), so the guard has zero `gateway/src` inputs;
     `backend_integration_changed` is not touched, so a gateway-only PR does not re-run that integration suite (residual,
     D-10.21; PR body).
  Every newly found input (from rules 1-2) is added to the hand-listed exact paths (`is_root_vitest_input_file` /
  `is_backend_vitest_input_file`).
- **D-10.19 (F2) worker latency gates are not loosened.** (Pass 2.) If the bounded sync-time sampling shows the worker
  missing a receipt gate (0 failures, p99 ≤ 250 ms, max ≤ 1000 ms), the gates stay as they are: F2 is held out of the PR
  (the other eleven findings ship) and escalated to the coordinator. A held F2 keeps its finding open in run state.
  (Pass 3, coordinator choice.) F2 lives on its own branch `codex/bug-scrub-loop/20261013-i10-f2`, separate from F1's
  `…-i10-f1`, so it can be held without touching F1. If F2 is held, the completion criteria count eleven regression tests
  and findings, the F2 branch and worktree are **kept** (not deleted), and the finding stays open in run state pending the
  coordinator's decision.
  (Pass 4.) The hold decision is made **before integration**: the F2 worker runs the live check (single sample and
  `CANARY_SELFTEST_SAMPLES=300` mode) from the F2 worktree, standalone and read-only against the running local stack. F2
  does not change the worker, so measuring the deployed worker is valid. The worker records the result, and the
  coordinator decides then whether F2 is cherry-picked; the integrator's selftest lines are only a confirmation. (Pass 8.)
  The single-sample run keeps today's exit contract (exit 2 only on unreachable backend/worker `/live`) and is recorded,
  not gated; only the sampling-mode window, judged by `evaluateSelftestWindow`, decides the hold. Sampling
  mode also polls `diagnostics(workerBase)` at the probe's 250 ms cadence (`canary-probe.mjs:199`) to approximate the real
  load. (Pass 5, coordinator choice, replacing the pass-4 25% share, which is unreachable on the local stack: receipts
  v0.8.77-rc1, v0.8.76-rc1-canary-2 and v0.8.75-rc6 show only 74/176/101 active diagnostics samples at 250 ms, and
  scheduled syncs run every 5 min only for wallets stale > 10 min, `envSections.ts:71-73`.) A window is valid only with
  an absolute minimum of **≥ 40 active diagnostics samples** (`Number(activeTotal) > 0`; `activeTotal` is a string,
  `canary-runtime.mjs:276`, `canary-probe.mjs:360`); the window is extended until that is reached, up to a stated limit
  of 900 s. (Pass 6.) Validity and the gates are computed by the exported pure helper `evaluateSelftestWindow` in
  `lib/canary-runtime.mjs`, tested behaviourally (F2 test 5). A window that hits 900 s without 40 active samples is invalid and is re-run once; a second invalid window is
  escalated to the coordinator. Latency gates unchanged. The PR body states the result is a lower bound and that the
  first real RC canary is the binding check.
- **D-10.20 (B1) concurrent direct share is a residual.** (Pass 3, coordinator choice.) Serializable isolation +
  `lockResourceOwnership` do not serialize the confirm against a direct user share: `walletSharingRepository.addUserToWallet`
  (`:33-42`) is a read-committed insert, and the fence (`transferRepository.ts:237-240`) takes `FOR NO KEY UPDATE`, which
  does not block the insert's FK `KEY SHARE` lock, so a share committed during the confirm can survive `keepExistingUsers=false`.
  Group-grant writes are safe (`updateWalletGroup`, `walletSharingRepository.ts:95-108`, conflicts with the fence). This is
  recorded as a residual and flagged in the PR body, not fixed: only the old owner can share (`requireWalletAccess('owner')`),
  and only by racing their own confirm.
- **D-10.21 (F1) `.nvmrc`, other install roots, guard reach.** (Pass 3.) `.nvmrc` is read by root Vitest suites
  (`tests/config/jadeEmulatorProofConfig.test.ts:118`, `tests/config/trezorEmulatorProofConfig.test.ts:129`), so it is an
  exact-path frontend input (`frontend_changed=true`, `full_scan=false`), and the guard's literal set includes tracked
  root-level files. `tests/ci/npmOverridesApplied.test.ts:119-126` `EXPECTED_INSTALL_ROOTS` also lists `docs/site` and
  `scripts/verify-addresses`: `docs/site/package{,-lock}.json` join the exact frontend list; `scripts/verify-addresses/package*.json`
  are already full-scan triggers, so that directory literal is expanded to only those two files. The guard excludes its
  own file from its scan. **Coordinator choice:** the guard's claim is narrowed to root-lane PRs. Residuals (non-goals, PR
  body): a read added only under `server/tests/**` is caught by the nightly full scan (`test.yml:14-15`), not on the PR;
  root suites that read `server/src` (`tests/config/addressDerivationBoundaryPolicy.test.ts:7,39,50`,
  `tests/scripts/checkSafetyCatchGuards.test.ts`, `tests/ci/signerInventoryGeneration.test.ts`) are skipped by server-only
  PRs. `server/src` is **not** routed to the frontend lane. (Pass 9, coordinator choice.) Non-src `server/` files that root
  suites read (`server/Dockerfile`, `tests/config/jadeProtocolHarness.test.ts:52`;
  `server/tests/fixtures/verified-address-vectors.ts`, `tests/scripts/verifyAddressesGenerated.test.ts:210`;
  `server/tests/fixtures/generated-{psbt,signed-psbt}-vectors.ts`, `tests/scripts/verifyPsbtProvenance.test.ts:68,72`)
  are in the guard's root-suite scan (`server/` literals excluding `server/src/**`) and listed as exact paths in
  `is_root_vitest_input_file`, so they select frontend as well as backend; the `server/src` residual stays. (Pass 10,
  coordinator choice.) The gateway import of `phase2OperationsProof.integration.test.ts:135` is allowlisted (D-10.18
  rule 6): a gateway-only PR does not re-run that server integration suite (residual; PR body). The guard neither
  classifies nor follows that import, so no other `gateway/src` file becomes an input (pass 11). (Pass 14.)
  `tests/config/addressDerivationBoundaryPolicy.test.ts:6-11,18-26` reads `gateway/src` recursively (`productionRoots`);
  `gateway/*` is only `is_gateway_file`, outside rule 2's prefix set and not followed by rule 1, so root suites reading
  `gateway/src` (`addressDerivationBoundaryPolicy.test.ts:10`) are skipped by gateway-only PRs; caught by the nightly full
  scan (residual; non-goals, PR body).

## Assumptions and constraints

As iteration 9: no new migrations; integration specs only extended (if a new one is added, register it in
`scripts/ci/backend-integration-groups.sh`); lizard must not exceed 86 (pass 14: the gate is `-i 86 -C 15 -T nloc=200`,
`scripts/quality.sh:21,284-311`; pinned lizard 1.24.0 reports 84 warnings on the tree, so the whole PR may add at most 2,
and every phase worker runs `lizard -C 15 -T nloc=200` on its new/changed files and reports zero new warnings); frontend and backend `tests/unit` coverage 100%;
files under 1,000 lines unless classified in `scripts/quality/large-file-classification.json` (watch `src/api/client.ts`
at 958 lines: C1 budget ≤ 15 lines; `server/tests/unit/api/openapi.gateway.contracts.ts` at 976 lines: no worker edits it,
D-10.14); `arch:check` in the i10 worktree (it has real `node_modules`, not symlinks), falling back to a detached primary
checkout only if it misbehaves, with `docs/architecture/generated` regenerated (`arch:graphs`, `arch:calls`) and committed
in the integrator commit before the verification block, so `arch:check` runs as a pure check (pass 6). B's new edges
(`agent/auth → repositories/walletRepository`, `services/transferService/confirm → services/auditService`) do **not**
change the generated graphs (`server.md` is collapsed by directory, `agent → repositories` already exists at `:97`, and
service → service collapses). A1 adds two frontend edges that do: `hooks/send → contexts/send` (a value import of
`getBoundPayjoinUrl`; none in `frontend.md:1136-1155` today) and `contexts/send → shared/utils/bitcoin.ts`
(`canonicalSegwitAddressCase`; `frontend.md:1100-1102`). So `docs/architecture/generated/frontend.md` changes and must be
regenerated and committed in the PR (the Architecture lane is not PR-required, so a stale graph would merge green and turn
`main` red); no new `finalize*` identifiers in `src/` (signer inventory); after `shared/` edits (C4), rebuild
`shared/dist` before server/gateway contract tests; the server reads `@sanctuary/shared` from the gitignored `shared/dist`
(`server/tsconfig.json:18-19`, `server/vitest.config.ts:5-6`; `nodeConfigData.ts:18` imports
`getNodeExternalServiceResponseUrl` from it) and the direct `npx tsc`/`vitest` calls skip the `pretest` `_predistshared`
hook (`server/package.json:18-25`), so the integrated branch runs `npm run build --workspace=shared` first in the
Verification block (pass 7). No new API endpoints anywhere in this plan, so **no e2e mock map
changes** (the thirteen `unhandledRequests` sites stay untouched); Playwright specs do change for D1 (below). Phases A and
D touch wallet-safety-critical files (`is_wallet_safety_critical_file` true for `src/contexts/send/reducerParts/outputs.ts`,
`transactionSummaryModel.ts`, `reviewStepData.ts`, `OutputsStep.tsx`, `createWalletData.ts`), so verify-vectors runs; none
of them is pinned in `config/wallet-safety-mutation-map.json` or a `server/stryker.*.config.mjs` mutate range.
`shared/constants/nodeConfig.ts` (C4) is a hardware-proof source (`config/hardware-emulator-source-inventory.json:40`,
pattern `shared/**`), and so are `src/api/client.ts` and `src/api/refresh.ts` (C1;
`config/hardware-emulator-source-inventory.json:17-18`), so C1 and C4 both trigger the emulator proof lanes; expect possible emulator flake and record retrigger
evidence (SHA, run/job ids, failure signature, hypothesis, discriminator) per CLAUDE.md before any second attempt.

**Phase file ownership (parallel workers, disjoint files, one worktree and branch per phase, D-10.15).**

| Phase | Owns |
|---|---|
| A | `src/contexts/send/{types.ts,reducer.ts,reducerParts/{outputs,transactionType,payjoin}.ts}`, `src/components/send/steps/OutputsStep/{OutputsStep.tsx,sections/RecipientsSection.tsx}`, `src/components/send/OutputRow.tsx`, `src/hooks/send/{usePayjoin.ts,useSendTransactionActions.ts,useDraftManagement.ts}`, `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts`, `src/components/send/steps/{ReviewStep.tsx,review/{TransactionSummary.tsx,transactionSummaryModel.ts,reviewStepData.ts,PayjoinProposalPanel.tsx}}`, `tests/fixtures/payjoinPsbt.ts` (new, pass 5) + their tests |
| B | `server/src/services/transferService/confirm.ts`, `server/src/services/auditService.ts`, `server/src/agent/auth.ts`, `server/src/api/openapi/{paths/transfers.ts,schemas/transfers.ts,paths/agent.ts}`, `server/tests/unit/services/transferService/*`, `server/tests/unit/services/transferService.test.ts` (registers the contract modules, `:2-6`), `server/tests/integration/flows/transfers.integration.test.ts` (new `keepExistingUsers` cases are additions), `server/tests/unit/agent/auth.test.ts`, `server/tests/unit/api/openapi.transfers-agent.test.ts` (new, standalone, D-10.14) + tests |
| C | `src/api/{refresh.ts,client.ts,auth.ts}`, `src/contexts/{useUserPreferenceMutation.ts,userContextTypes.ts}`, `src/types/user.ts`, `src/utils/preferencePaths.ts`, `src/components/Settings/sections/{telegramSectionData.ts,useTelegramSettings.ts}`, `server/src/api/auth/profile.ts`, `server/src/api/openapi/paths/auth.ts`, `src/components/SystemSettings/SupportPackageCard.tsx`, `shared/constants/nodeConfig.ts`, `src/components/NodeConfig/nodeConfigData.ts`, `server/src/api/admin/nodeConfig.ts` (+ the node-config OpenAPI description), `server/tests/unit/api/openapi.preferences.test.ts` (new, standalone, D-10.14), `tests/components/Settings.interactions.test.tsx`, `tests/components/Settings/sections/TelegramSection.branches.test.tsx` + tests |
| D | `src/components/CreateWallet/*`, `tests/components/CreateWallet*`, `tests/components/coverageFallbacks.test.tsx` (pass `supportedScriptTypes` at `:85-103`), `tests/e2e/create-wallet-flow.spec.ts`, `tests/e2e/user-journeys.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/render-regression/{renderRegressionWalletConnection,renderRegressionWalletDevice,renderRegressionChoiceFocus,renderRegressionSecondaryText}.contracts.ts` |
| E | `server/src/services/price/{index.ts,types.ts,historicalLookup.ts (new),providers/coingecko.ts}`, `server/src/api/price.ts`, `server/src/api/openapi/paths/bitcoinPrice.ts`, `server/tests/unit/services/price.historical.test.ts` (new; `price.test.ts` is not extended), `server/tests/unit/api/price.history.test.ts`, `server/tests/unit/api/price.historical-service-errors.test.ts` (new, pass 7), `server/tests/unit/services/price/{coingeckoProvider.test.ts,historicalLookup.test.ts (new)}` + tests (not `price/historicalPriceService.ts` or its test, D-10.16) |
| F | F1 (branch `…-i10-f1`): `scripts/ci/{classify-files-lib.sh,classify-test-changes.sh,plan-test-run.sh}`, `tests/ci/{classify-test-changes.test.sh,plan-test-run.test.sh,pre-commit-agent-gate.test.sh,vitestRepoInputsClassified.test.ts}`; F2 (branch `…-i10-f2`, D-10.19): `scripts/release/canary/{canary-probe.mjs,canary-selftest.mjs,lib/canary-runtime.mjs}`, `tests/release/canary-probe-tooling.test.mjs`, `docs/how-to/release-candidate-canary.md` |

**Shared files (integrator-owned, applied once at the end):** `docs/reference/changelog.md` `## [Unreleased]` (each worker
hands over its bullet text), `docs/architecture/generated/*` (regenerated once in the i10 worktree after all phases),
`scripts/quality/large-file-classification.json` (only if a classified file is touched). The new OpenAPI test files are
standalone and phase-owned, so `openapi.gateway.contracts.ts` / `openapi.test.ts` are not touched by anyone (D-10.14). F1's guard scans every phase's test files: run it last, after all phases are on the
branch. B2's `auth.test.ts` and B1's transfer contracts share nothing.

---

## Phase A — payjoin client (A1, A2)

### Phase A1 — Bind the payjoin endpoint to its BIP21 address (P2, `send-payjoin--stale-payjoin-url-after-output-remove-or-type-switch`)

**Evidence (re-verified at f9047d86d6).**
- `src/components/send/steps/OutputsStep/OutputsStep.tsx:131-173`: any BIP21 paste at any index sets `SET_PAYJOIN_URL`
  (`:146-153`); a plain edit clears it only when `index === 0` (`:170-172`). The consolidation auto-fill (`:119-129`) calls
  `updateOutputAddress(0, …)` directly, bypassing that clear.
- `src/contexts/send/reducerParts/outputs.ts:31-50` (`REMOVE_OUTPUT`), `:88-97` (`SET_OUTPUT_ADDRESS`) and
  `reducerParts/transactionType.ts:4-31` (`SET_TRANSACTION_TYPE`, rebuilds outputs for consolidation/sweep/standard) never
  touch `payjoinUrl`; `reducerParts/payjoin.ts:8-10` is its only writer.
- `src/hooks/send/usePayjoin.ts:132-141` `isPayjoinCandidate` checks only URL present + one output + single-sig
  segwit/taproot + no draft/approval; `resolvePayjoinRoundOne` (`:155-170`) then posts the signed original to that URL.
  `ReviewStep.tsx:195` shows the sign-twice notice from the same predicate; `TransactionSummary.tsx:206` and
  `OutputRow.tsx:595` show the payjoin badge from `Boolean(payjoinUrl) && index === 0`.
- Server forwards to `body.payjoinUrl` without recipient binding (`server/src/services/payjoin/attempt.ts`,
  `sender.ts:41-86`). Confirmed: remove/replace/consolidate keeps a third party's endpoint.

**Fix design.** D-10.1. Reducer clears `payjoinUrl` and `payjoinAddress` on: every `SET_TRANSACTION_TYPE` whose `txType`
differs from the current type; `REMOVE_OUTPUT` of the output whose address equals the bound address; `SET_OUTPUT_ADDRESS` /
`UPDATE_OUTPUT(field 'address')` that changes the bound output's address to anything else. `OutputsStep` dispatches
`SET_PAYJOIN_URL {url, address: parsed.address}` on a pj BIP21 paste and `{url:null,address:null}` otherwise, and drops its
own `index === 0` clear (the reducer owns clearing). `isPayjoinCandidate` replaces `state.payjoinUrl` with
`getBoundPayjoinUrl(state)` (its `outputs.length === 1` check moves into the selector) and its state `Pick`
(`usePayjoin.ts:122`) adds `transactionType` and `payjoinAddress`; `resolvePayjoinRoundOne` takes the URL from the
selector. `createInitialState` (`reducer.ts:60`) sets `payjoinAddress: null`. Badges (`TransactionSummary.tsx:206`, `OutputRow.tsx:595` via `RecipientsSection.tsx:106`) show only
for the bound output: `OutputsStep.tsx:307` passes `payjoinUrl={getBoundPayjoinUrl(state)}` (not `state.payjoinUrl`) to
`RecipientsSection` → `OutputRow` (pass 5). Every consumer imports the selector from
`src/contexts/send/reducerParts/payjoin` directly, not from the barrel (D-10.1). `useDraftManagement.ts:102`, `useSendTransactionActions.ts:179,383` and the draft restore use the
selector / bind as in D-10.1. Keep `reduceOutputCollection` flat (lizard): one helper `clearPayjoinIfUnbound(state, next)`,
defined as: clear `payjoinUrl` and `payjoinAddress` only when `state.outputs` had an output whose address equals
`payjoinAddress` (compared with `canonicalSegwitAddressCase`) and `next.outputs` has none. Comparing by presence before and
after (not by index) handles duplicate addresses and is independent of dispatch order. `OutputsStep` calls
`updateOutputAddress` **before** dispatching `SET_PAYJOIN_URL`, so the new binding is not cleared by the address write.

**Failing-first tests.**
- `tests/contexts/send/reducer.test.ts` (603 lines): new `describe('payjoin binding')`: (1) bound to output #2 address B,
  `REMOVE_OUTPUT index 1` → `payjoinUrl === null` (fails: URL kept); (2) bound B, `SET_TRANSACTION_TYPE consolidation` →
  raw fields cleared, `state.payjoinUrl === null && state.payjoinAddress === null` (fails: URL kept); (3) bound B on output #1, `SET_OUTPUT_ADDRESS index 0 → C` → cleared (fails); (4) removing an unrelated
  output keeps the binding (passes before and after); (5) `getBoundPayjoinUrl` returns null for two outputs, a different
  remaining address, non-standard type, or a missing `payjoinAddress`, and the URL for a case-different bech32 address —
  which must be pattern-valid (`canonicalSegwitAddressCase`, `shared/utils/bitcoin.ts:96-101`, lowercases only an
  all-uppercase address passing `isValidAddressFormat`; use e.g. ``MAINNET = `bc1q${'a'.repeat(38)}` `` as
  `OutputsStep.branches.test.tsx:85` does, stored once as `MAINNET.toUpperCase()` and once lowercase; the `bc1qrecipient`
  placeholders are pattern-invalid) — plus a negative row: a pattern-invalid uppercase placeholder is not equated (the
  selector must not fall back to `toLowerCase()`, D-10.1) (selector-only assertions belong here, not in (2)/(6));
  (6) the consolidation auto-fill path through the real reducer: bound state, `SET_TRANSACTION_TYPE consolidation` →
  `SET_OUTPUT_ADDRESS 0` → `state.payjoinUrl === null && state.payjoinAddress === null` (fails: URL kept). The raw fields
  are asserted, not the selector: the selector returns null for any non-standard type, so a selector assertion would fail
  on `f9047d86d6` only because `getBoundPayjoinUrl` does not exist and could not catch a regression. This case lives here (or in
  `tests/contexts/send/SendTransactionContext.test.tsx` with the real provider), not in `OutputsStep.branches.test.tsx`, which mocks `dispatch`
  (`:82,106`) and cannot observe reducer clearing.
- `tests/components/send/OutputsStep.branches.test.tsx`: it mocks `dispatch`, so only dispatch shape and order are
  tested here. The four existing exact dispatch assertions change: `:316` `{url}` → `{url, address}` with the parsed
  address (fails: no `address`); `:325` and `:344` `{url:null}` → `{url:null, address:null}` (fail: no `address`); `:355`
  plain-edit clear → `SET_PAYJOIN_URL` **not** dispatched (fails: it dispatches the clear). Add `mockDispatch.mockClear()`
  immediately before the `onAddressChange(0, 'bc1qplain')` call, so the "not dispatched" check is not polluted by the
  `:344` address-only BIP21 paste's dispatch. New: on a pj paste,
  `updateOutputAddress` runs before the `SET_PAYJOIN_URL` dispatch (assert call order). (Pass 5.) New red case for the
  `OutputsStep.tsx:307` call site, through the existing `capture.outputRows` capture: a state with `payjoinUrl` set and
  two outputs (or one output whose address differs from `payjoinAddress`) → `capture.outputRows[0].payjoinUrl === null`
  (fails: the raw URL is passed).
- Existing fixtures that set `payjoinUrl` without `payjoinAddress` fail closed after the fix and must be updated
  (`payjoinAddress = outputs[0].address`): `tests/hooks/useSendTransactionActions/useSendTransactionActionsTestHarness.tsx:217-220`
  `payjoinState()`; `tests/components/send/ReviewStep.payjoin.test.tsx:59-71` `context()`;
  `tests/contexts/sendTypes.test.ts:37,120`.
- `tests/components/send/TransactionSummary.test.tsx`: the default fixture (`:19-25`) has two outputs and the `:79-106`
  fixture is a consolidation, so after the fix the selector returns null and the badge assertions at `:61`, `:106` and the
  `:237-244` `it.each` fail. (Pass 7, superseding the pass-2 "rebuild the default fixture" wording.) The shared default
  `buildProps()` state (`:15-30`) is **kept**, because its two outputs, amounts and decoys are asserted at `:62`, `:63` and
  `:65`. The override state (one standard output + a matching `payjoinAddress`) is applied only in the badge cases: the
  `:55` case (either it asserts only the badge under the override, or its badge assertion moves into a new case and the
  `:55` case keeps the default with the badge line removed), the `:79` draft "Payjoin (fallback)" case (switched to
  `standard` with one output and `payjoinAddress`), and the `:237-244` `it.each`. Add the negative case with the
  unchanged default (two outputs → no badge).
- `payjoinAddress` is a required field, so every base state gains `payjoinAddress: null` or `typecheck:tests` fails:
  `tests/components/send/ReviewStep.test.tsx:212-225` ("shows payjoin status when enabled"; set `payjoinAddress` to the
  output address there), `tests/contexts/stepValidation.test.ts:22` `createMockState()`, and the harness base
  `createState` (`useSendTransactionActionsTestHarness.tsx:138`). (Pass 4.) The existing `SET_PAYJOIN_URL` action literal
  in `tests/contexts/send/reducer.test.ts:177-180` has no `address`, so with the now-required field it also breaks
  `typecheck:tests`: give it an `address` (the bound address, or `null` in a clearing case) and assert
  `state.payjoinAddress` there.
- Draft restore binding: a draft with `payjoinUrl` and one output restores through `buildDraftInitialState`
  (`sendTransactionPageHelpers.ts:186`) with `payjoinAddress === outputs[0].address`, and the re-save payload
  (`useDraftManagement.ts:102`) keeps `payjoinUrl` (restore case in `tests/components/send/draftTransactionData.test.ts`,
  which imports `sendTransactionPageHelpers`; re-save case in `tests/hooks/useDraftManagement.test.tsx`). That file's
  `createState` (`:55-64`) sets no `transactionType`, and `getBoundPayjoinUrl` requires `'standard'`, so the re-save case
  overrides `transactionType: 'standard'`, `payjoinUrl` and `payjoinAddress: 'bc1qrecipient'` (the fixture's single
  output address). (Pass 9.)
- `tests/hooks/useSendTransactionActions/useSendTransactionActions.payjoinRoundOne.contracts.tsx`: a state whose single
  remaining output differs from the bound address yields no round one. `negotiatePayjoin` is not observable (it is defined
  in `usePayjoin.ts:316` and called inside the hook at `useSendTransactionActions.ts:381`; the harness does not mock
  `usePayjoin`, and a same-module ESM call cannot be spied), so add an "unbound recipient" row
  (`{ state: { ...payjoinState(), payjoinAddress: 'bc1qother' } }`) to the existing refusal `it.each` (`:304-321`):
  `resolvePayjoinRoundOne(...)` returns null (fails: it returns a round one). Optionally add a broadcast-level case asserting
  `mocks.attemptPayjoin` is not called (`usePayjoin.ts:322-331`; fails: it is called). (Pass 9.)
- `tests/components/send/ReviewStep.payjoin.test.tsx:100-110` `it.each`: add "for an unbound recipient" (state with
  `payjoinUrl` set, `payjoinAddress` ≠ output) → no sign-twice notice (fails: notice shown).
- Confirm red first: `npx vitest run --config config/tooling/vitest.config.ts tests/contexts/send tests/components/send tests/hooks/useSendTransactionActions`.

**Acceptance.** The signed original is posted only to an endpoint that came with the single remaining recipient's address;
remove/replace/type switch/consolidation fill drop it; review notice, badges, draft save and create request agree with the
selector; a state without `payjoinAddress` gets no payjoin; the listed fixtures carry `payjoinAddress` (base states
`null`); a restored draft rebinds to its first output and re-saves its `payjoinUrl`; frontend coverage 100%.

### Phase A2 — Round-two review totals show the sender's real cost (P2, `send-review--payjoin-proposal-total-counts-receiver-fee`)

**Evidence (re-verified).**
- `usePayjoin.ts:241-256` `buildProposalTransaction` spreads the original (`outputs=[{recipient,P}]`, `changeAmount`) and
  replaces only `utxos/fee/totalInput/totalOutput/effectiveAmount` (`applyPayjoinProposal`, `:207-238`).
- `transactionSummaryModel.ts:56-75` `getTotalSendingSats` returns `sum(txData.outputs) = P`; `:81-90`
  `getTotalIncludingFeeSats` returns `P + proposal.fee = P + originalFee + r`; rendered at `TransactionSummary.tsx:104-116,
  221-280` ("Network Fee", "Total (including fee)").
- `PayjoinProposalPanel.tsx:80-93` shows `fee: proposal.fee`, `netSpend: proposal.effectiveAmount` (server `amount`,
  `attempt.ts:255-262`; `intentSpend.ts:22-28,96-106` = external − peer inputs, and "amount + fee is still the sender's real
  outflow"). The summary's total (`P + fee`) therefore exceeds the panel's `netSpend + fee` by `P − netSpend = r`, the receiver's fee contribution.
- `reviewStepData.ts:229-262` builds outputs from `txData.outputs` (original P) and `changeAmount` against proposal
  `totalInput/totalOutput/fee`; receiver inputs come from `applyPayjoinProposal`'s fallback `{txid,vout,amount}` with no
  address (`buildTxDataInput`, `:115`). Confirmed.

**Fix design.** D-10.2 / D-10.3. `transactionSummaryModel.ts`: `getTotalSendingSats`/`getTotalIncludingFeeSats` gain an
optional `proposal: boolean`; when true they return `txData.effectiveAmount ?? <the existing non-proposal result>` and
that value `+ fee` (pass 10, D-10.2: `effectiveAmount` is optional, `src/hooks/send/types.ts:28`; never `?? 0`). `TransactionSummary`
receives `payjoinOriginalTxData` from `ReviewStep.tsx:199-213` and computes `proposal = isPayjoinProposalReview(status,
original)` (exported from `PayjoinProposalPanel.tsx`, which uses it too). `reviewStepData.ts`: new
`buildProposalReviewOutputs(txData, originalTxData, network, getAddressLabel)` decoding
`bitcoin.Psbt.fromBase64(txData.psbtBase64).txOutputs` (`bitcoin.address.fromOutputScript` with
`toBitcoinJsNetwork(network)`, the new named helper of D-10.3, defined in `reviewStepData.ts`, `undefined` → mainnet;
network from the wallet already passed to the review step)
with change = any output whose address equals `txData.changeAddress` or a `decoyOutputs[].address`; used by
`buildReviewFlowData` when `proposal` is true (no change output appended twice). Decoding is wrapped in `try/catch` with
`log.debug` and falls back to the current `txData.outputs` preview. `reviewStepData.ts` calls
`bitcoin.initEccLib(ecc)` at module level with `@bitcoinerlab/secp256k1` (pass 6, D-10.3), so P2TR outputs decode.
`BuildReviewFlowDataParams` gains `payjoinStatus`,
`payjoinOriginalTxData` and `network`, and `ReviewStep.tsx:134-146` adds all three to the `flowData` `useMemo` deps.
Receiver inputs (outpoints not in the original) get `label: 'Receiver input'`. Decoy sends stay payjoin-eligible (no
`!useDecoys` in the predicate). Non-payjoin and round-one paths are byte-for-byte unchanged. No `finalize*` names.

**Failing-first tests.**
- `tests/components/send/steps/review/transactionSummaryModel.test.ts` (126 lines): proposal `fee 223, effectiveAmount 9900,
  outputs [{P:10000}]` → sending 9900, total 10123 (= `P + originalFee 123`) (fails: 10000 and 10223); `proposal:false`
  unchanged; (pass 10) `proposal: true` with `effectiveAmount` undefined → the non-proposal value (10000 here) and that
  value + fee, not 0 (covers the `??` arm for the 100% threshold).
- `tests/components/send/ReviewStep.payjoin.test.tsx:112-140` (the existing round-two case, fee 223 vs 123,
  `effectiveAmount 9900`): replace the fixture's `psbtBase64: 'psbt'` (`:46`, `:116-117`) with a real PSBT from the
  shared fixture `tests/fixtures/payjoinPsbt.ts` (below), since `flowData` now decodes it;
  then assert **within** the "Total Sending" and "Total (including fee)" rows (`within(row).getByText`), using the
  formatter's `${sats} sats` strings (`:93`): `9900 sats` and `10123 sats` (fails: `10000 sats` / `10223 sats`). A bare
  `getByText('9900 sats')` would throw, because the panel's Net spend shows the same string. Also assert the recipient row
  still shows `10000 sats` (`P`, D-10.2 coordinator decision; passes both, pins the intended display).
- `tests/components/send/steps/review/reviewStepData.test.ts` (26 lines): a real two-input proposal PSBT built with
  bitcoinjs (recipient output P + Rin − r, change C) → preview outputs sum to `totalOutput`, change flagged, receiver input
  labelled (fails: outputs show P and sum ≠ totalOutput); a Stonewall case where a `decoyOutputs[].address` output is
  flagged as change; a **regtest** case (bcrt1 addresses) where change is still detected (would fail with the
  `psbtAccountBinding.ts:40` all-testnet mapping); an undecodable `psbtBase64` falls back to the `txData.outputs` preview;
  `toBitcoinJsNetwork(undefined)` returns the mainnet (`bitcoin`) network; (pass 4) a **signet** case covers the
  testnet3/testnet4/signet → `testnet` arm: `toBitcoinJsNetwork('signet')` returns `bitcoin.networks.testnet`, and a tb1
  change address in the proposal PSBT is flagged as change; (pass 6) a **P2TR** case: a proposal PSBT with a P2TR
  recipient output and a P2TR change output (bc1p `changeAddress`) → change flagged and preview outputs sum to
  `totalOutput` (fails without the module-level `initEccLib`: decoding throws and the fallback preview is shown). (Pass 8.)
  The same case, after `reviewStepData` is imported, asserts
  `bitcoin.address.fromOutputScript(P2TR_SCRIPT, bitcoin.networks.bitcoin) === P2TR_ADDRESS`, so a bad key fails loudly
  instead of silently taking the fallback (also red without the module-level `initEccLib`, since `fromOutputScript` of a
  P2TR script throws without ECC, `address.cjs:69,93`).
- (Pass 5.) Shared PSBT fixture: `psbtWithOutputs` is a non-exported `const` inside `PayjoinProposalPanel.test.tsx:16-20`,
  and importing a `.test.tsx` would re-register its suite. Move the helper, with its PAYMENT/CHANGE scripts, into a new
  `tests/fixtures/payjoinPsbt.ts`, imported by `PayjoinProposalPanel.test.tsx`, `ReviewStep.payjoin.test.tsx` and
  `reviewStepData.test.ts` (`PayjoinProposalPanel.test.tsx` keeps passing unchanged in behaviour). (Pass 6.) The fixture
  also exports a P2TR output script (and its bc1p address) for the P2TR case. (Pass 7.) The P2TR script is **not** built
  from a repeated-byte key: `fill(0x11)` is not a valid x-only point (`isXOnlyPoint` is false, so bitcoinjs
  `payments/p2tr.cjs:258-260` throws) and the case would exercise only the fallback. (Pass 8, replacing the pass-7
  `toOutputScript` + fixture-setup round-trip wording.) `bitcoin.address.toOutputScript(<bc1p>)` itself throws "No ECC
  Library provided" without `initEccLib` (`address.cjs:238-240` → `p2tr.cjs:258-260`), and so does `fromOutputScript`
  of a P2TR script (`address.cjs:69,93`). So the fixture exports `P2TR_SCRIPT` as raw bytes,
  `Uint8Array.from([0x51, 0x20, ...<32-byte x-only key of a BIP86 test-vector bc1p address>])`, and `P2TR_ADDRESS` as
  that address string, with **no** bitcoinjs address call at module scope and **no** `initEccLib`. The round-trip check
  moves into the `reviewStepData.test.ts` P2TR case (above). No test file or fixture used by these suites
  (`PayjoinProposalPanel.test.tsx`, `ReviewStep.payjoin.test.tsx`, `reviewStepData.test.ts`, `tests/fixtures/payjoinPsbt.ts`)
  may call `initEccLib` itself, or the P2TR case would pass without the fix.
- `tests/components/send/TransactionSummary.test.tsx` (248 lines): non-payjoin totals unchanged (guard, passes both).

**Acceptance.** In round two, summary lines equal the panel's Net spend / Total fee and their sum equals sender inputs −
sender outputs; the recipient row still shows the requested payment `P`; the flow preview's outputs sum to the proposal's
total output (P2TR outputs included); everything else unchanged.

---

## Phase B — access control (B1, B2)

### Phase B1 — `keepExistingUsers=false` removes all other access (P2, `ownership-transfer--keep-existing-users-false-keeps-shared-users`)

**Evidence (re-verified).**
- Contract: `src/components/TransferOwnershipModal/TransferOptionsFields.tsx:42-47` (unchecked: "All existing access
  (including yours) will be removed after the transfer."); `server/prisma/schema.prisma:1529` (`// Keep viewers/signers
  after transfer`).
- `server/src/services/transferService/confirm.ts:151-162` (wallet) and `:216-226` (device): the `false` branch deletes only
  `currentOwner.id`; no other `walletUser`/`deviceUser` row and no `wallet.groupId/groupRole` (`schema.prisma:140-141`) or
  `device.groupId/groupRole` (`:277-278`) is touched. Only `invalidateWebSocketWalletAccess` runs after commit (`:90-94`).
  No audit entry exists for transfers at all.
- Tests: `server/tests/unit/services/transferService/transferService.confirm.contracts.ts:238` seeds only owner + recipient.

**Fix design.** D-10.4. In `confirm.ts` add `revokeOtherWalletAccess(tx, walletId, newOwnerId)` and
`revokeOtherDeviceAccess(tx, deviceId, newOwnerId)` (each: `findMany` the rows with `userId != newOwnerId` → `deleteMany` by
id → if `groupId` is set, `update {groupId:null, groupRole:'viewer'}` → return `{removedUserIds, removedGroupId}`), called
from the `false` branch instead of the single delete. The transaction callback returns the removal summary with
`walletId`; after commit and after `findByIdWithUsers` (which supplies the initiator's username), write the audit entry.
Serializable isolation + `lockResourceOwnership` (`:68-72`) serialize against concurrent transfers and group-grant writes
(`updateWalletGroup`, `walletSharingRepository.ts:95-108`, conflicts with the fence), but **not** against a direct user
share: `addUserToWallet` (`walletSharingRepository.ts:33-42`) is a read-committed insert, and the fence
(`transferRepository.ts:237-240`) takes `FOR NO KEY UPDATE`, which does not block the insert's FK `KEY SHARE` lock. A share
committed concurrently with the confirm can therefore survive it. Recorded residual (D-10.20), not fixed here.
OpenAPI: `schemas/transfers.ts:38,69` and `paths/transfers.ts` describe `keepExistingUsers=false`; their contract
assertions go in the new standalone `server/tests/unit/api/openapi.transfers-agent.test.ts` (D-10.14). Keep each helper small
(lizard). Prisma access stays on the `tx` client as in the rest of this file (no new layering exception). New edge
`services/transferService/confirm → services/auditService` (no cycle: `auditService` imports only repositories/utils);
it collapses in the generated `server.md`, so it changes no graph (see Assumptions).

**Failing-first tests.**
- `transferService.confirm.contracts.ts` (521 lines). The confirm tests build their own `txMock` inside
  `$transaction.mockImplementation` (`:261-278`): add the new tx methods (`walletUser.findMany/deleteMany`,
  `wallet.findUnique/update`, `deviceUser.findMany/deleteMany`, `device.findUnique/update`) **there**; the shared
  `mockPrismaClient` already has `findMany`/`deleteMany`. Add a **partial** mock of `src/services/auditService` to
  `transferServiceTestHarness.ts` (`:28-38`), so `AuditAction`/`AuditCategory` stay defined:
  `vi.mock('…/src/services/auditService', async (importOriginal) => ({ ...(await importOriginal()), auditService: { log: mockAuditLog } }))`
  (pass 4). `mockAuditLog` is declared in the existing `vi.hoisted` block of `transferServiceTestHarness.ts` (`:4`), so
  the hoisted `vi.mock` factory can reference it (pass 5). The red cases are the existing `keepExistingUsers:false` cases, rewritten:
  `:246` (wallet) and `:363` (device) assert `delete({where:{id:'wu-owner'}})` today; they become: wallet transfer `false`
  with a third member (signer) and `groupId: 'g1'` → `deleteMany` with ids of old owner + signer,
  `wallet.update {groupId:null, groupRole:'viewer'}`, audit `wallet.unshare` with `removedUserIds` (fails: only the owner
  delete); same for a device with a shared viewer and a group (audit `device.unshare`). `true` → no `deleteMany`, no group
  update, owner downgraded (passes both). (Pass 4.) Both rewritten cases seed `groupId: 'g1'`, which leaves the
  `groupId == null` arm of `revokeOtherWalletAccess`/`revokeOtherDeviceAccess` uncovered against the 100% branch threshold
  (`server/vitest.config.ts:65-70`), so add one wallet and one device `false` case with **no group**: `deleteMany` runs,
  no group `update`, audit `removedGroupId: null`. If the file would pass ~600 lines, put the new cases in
  `transferService.confirm-access.contracts.ts` and register it in `server/tests/unit/services/transferService.test.ts`
  (`:2-6`, B-owned).
- Integration (real DB, already registered at `scripts/ci/backend-integration-groups.sh:49`):
  `server/tests/integration/flows/transfers.integration.test.ts` (356 lines): seed owner A, recipient B, signer S, viewer V,
  group G (member M) on wallet W; transfer `false` → only B's row remains, `W.groupId` null, `walletRepository.hasAccess(W,
  S|V|M|A)` all false (fails on f9047d86d6); a `true` case keeps S, V, group and A as viewer. Any device `hasAccess`
  assertion covers direct and group grants only and documents the wallet-derived residual (D-10.4) in a comment; it must
  not imply that a member of a wallet containing the device loses access.

**Acceptance.** `false` leaves the new owner as the only direct member of the wallet/device with no group grant, audited;
device access that derives from `Device.userId` or wallet membership (`accessControl.ts:63-82`) is a recorded residual
(non-goals, PR body); a direct user share racing the confirm is a recorded residual (D-10.20, PR body); `true` unchanged;
unit + integration green; OpenAPI text matches.

### Phase B2 — Agent keys stop working when their user loses wallet access (P2, `agent-api--key-survives-user-wallet-access-loss`)

**Evidence (re-verified).** `server/src/services/adminAgentService.ts:106-120` checks `walletRepository.hasAccess` only at
creation. `server/src/agent/auth.ts:102-146` checks key revocation/expiry and agent status only;
`requireAgentFundingDraftAccess` (`:148-166`) compares wallet ids with the agent row. All agent routes pass
`router.use(authenticateAgent)` (`server/src/api/agent.ts:83`; routes at `:89,108,140,167,235`). `walletSharingRepository.removeUserFromWallet`
(`repositories/walletSharingRepository.ts:61-65`) and the transfer confirm never touch `walletAgent`. Confirmed.

**Fix design.** D-10.5. New edge `agent/auth.ts → repositories/walletRepository` (no cycle; `agent → repositories` already exists in
`server.md:97`, so no graph change).
OpenAPI `paths/agent.ts`: 403 description lists the new reason (contract assertions in the new
`openapi.transfers-agent.test.ts`, D-10.14). Cost: two indexed queries per agent request (agent routes are already
rate-limited).

**Failing-first tests.** `server/tests/unit/agent/auth.test.ts` (220 lines; add
`vi.mock('../../../src/repositories/walletRepository', …)` with `hasAccess`, and set `hasAccess.mockResolvedValue(true)` in
`beforeEach` (`:42-45`) so the existing success cases do not see `undefined`): (1) funding access false → `ForbiddenError`
with `details.reason === 'agent_user_wallet_access_lost'`, `wallet: 'funding'`, and `updateApiKeyLastUsedIfStale` not
called (fails: resolves); (2) operational false → same with `'operational'` (fails); (3) both true → context returned,
`hasAccess` called with `(fundingWalletId, userId)` and `(operationalWalletId, userId)`. `agent/auth` is mocked by the
route harnesses `agentRoutes.testHarness.ts:96` and `agent-wallet-funding-smoke.test.ts:104`, and separately by
`agentApiService.test.ts:37` and `tests/unit/middleware/agentAuth.test.ts:6`; none of them needs a change. Re-run all four.

**Acceptance.** Removing the agent's user from either wallet (share removal or a B1 transfer) makes every agent call 403
with the typed reason; no agent row is mutated; backend `tests/unit` coverage 100%.

---

## Phase C — auth, settings, support, node config (C1–C4)

### Phase C1 — A 401 on a token believed fresh still refreshes (P2, `auth-refresh--fresh-expiry-short-circuits-401-recovery`)

**Evidence (re-verified).** `server/src/services/accessTokenSessionService.ts:50` rejects on `sessionVersion` mismatch
before expiry. `src/api/client.ts:588-612` awaits `refreshAccessToken()` on 401 and replays once. `src/api/refresh.ts:256-268`
`runUnderLock` returns early when `accessExpiresAtMs > now + REFRESH_LEAD_TIME_MS`, so no `POST /auth/refresh`, no
`RefreshFailedError`, no `triggerTerminalLogout` (`:270-279`); the replay 401s. Expiry is set from response headers
(`client.ts:296-305` → `scheduleRefreshFromHeader`, `refresh.ts:161-167`) and cross-tab broadcasts (`refresh.ts:66-71`).
`tests/api/refresh.test.ts:241-256` pins the short-circuit in isolation. Confirmed.

**Fix design.** D-10.6 / D-10.17. `executeApiOperation` (`client.ts:553-616`): capture
`expiryAtRequestStart = getAccessExpiresAtMs()` at the start of each attempt's operation inside `withRetry` (not once before
it at `:561`), so the last attempt's snapshot is the one passed to `refreshAccessToken({ expiryAtRequestStart })`.
`refresh.ts`: `runUnderLock` short-circuits only if fresh and `options.expiryAtRequestStart === undefined ||
accessExpiresAtMs !== options.expiryAtRequestStart`. A caller that joins an in-flight promise (`refresh.ts:252`) with a
snapshot awaits it and then, if its snapshot still equals the current expiry, re-runs the check (one new
`refreshAccessToken` with the same snapshot, which then fetches or short-circuits on its own merits); a joiner whose
snapshot differs from the settled expiry does not re-run, and a rejected shared promise rejects joiners without another
fetch (pass 6). Also remove the
redundant identical branches at `client.ts:599-604` only if coverage requires (no behaviour change). Budget ≤ 15 lines in
`client.ts` (958 lines).

**Failing-first tests.**
- `tests/api/refresh.test.ts` (657 lines): (1) seed fresh expiry X, `refreshAccessToken({expiryAtRequestStart: X})` with
  fetch → 401 → rejects `RefreshFailedError` and fires terminal-logout listeners (fails: short-circuits, resolves, fetch not
  called); (2) seed X, call with `expiryAtRequestStart: Y≠X` → no fetch (rotation; passes both); the existing `:242` case
  (no option) keeps passing; (3) joined short-circuit: R1 with snapshot X starts, a broadcast sets Y (`refresh.ts:66-71`),
  R1 short-circuits; R2 with snapshot Y joins R1's in-flight promise → after it settles R2 re-runs, fetch → 401 →
  `RefreshFailedError` and terminal logout (fails: R2 resolves with R1's short-circuit, no logout); (pass 6) the other
  D-10.17 arms, needed for the 100% branch threshold and to reject an always-rerun implementation: (4) R1 really
  refreshes (expiry X → Z) and R2 joins with snapshot X → after it settles R2 does not re-run (snapshot X ≠ Z), and
  fetch is called exactly once; (5) R1 rejects terminally → R2 rejects with the same error and no second fetch.
- `tests/api/client/client.cookie-auth.contracts.ts` (476 lines): seed `__seedAccessExpiresAtMsForTests(X)`, first request
  401 → `mockRefreshAccessToken` called with `{ expiryAtRequestStart: X }` (fails: called with no argument); a retried safe
  read whose expiry changes from X to Y between attempts → called with `{ expiryAtRequestStart: Y }` (last attempt wins).
  Change the harness mock (`tests/api/client/clientTestHarness.ts:22-29`) to forward arguments.

**Acceptance.** A server-revoked session in an open tab reaches terminal logout on its next request, including when its
refresh joins another request's short-circuited refresh; a request whose token another tab rotated mid-flight (or between
retry attempts) still replays without a refresh; cross-tab single-flight unchanged.

### Phase C2 — Global Telegram save preserves per-wallet settings (P2, `settings-telegram--global-save-reverts-wallet-telegram-settings`)

**Evidence (re-verified).** `src/components/Settings/sections/telegramSectionData.ts:20-43` sends
`telegram.wallets = user.preferences.telegram.wallets` from the login-time `UserContext` (callers
`useTelegramSettings.ts:99,115`). Wallet-level writes go through `server/src/services/telegram/settings.ts:58-86`
(atomic, never refresh `UserContext`). `server/src/api/auth/profile.ts:44-55` `mergePreferences` is a shallow spread inside
`updatePreferencesAtomically` (`:90-101`), so the stale object replaces the stored one. No other client reads
`telegram.wallets` (grep). Confirmed.

**Fix design.** D-10.7. Client: `buildTelegramPreferences` returns `{ telegram: { botToken, chatId, enabled } }` typed
as the new `UserPreferencesPatch` (`telegram: Partial<TelegramConfig>`; drop `getTelegramWallets`). `UserPreferencesPatch`
(defined in `src/types/user.ts`) replaces `Partial<UserPreferences>` as the `updatePreferences` parameter in
`src/contexts/userContextTypes.ts:39`, `src/contexts/useUserPreferenceMutation.ts:74` and `:276` (implementation callback),
and `src/api/auth.ts:133` (a plain `Partial<TelegramConfig>` would not typecheck: `UserPreferences.telegram` is a full
`TelegramConfig`, `src/types/user.ts:55`, whose `wallets` is required, `src/types/ui.ts:59`). The client optimistic merge
`mergePreferencePatch` (`src/utils/preferencePaths.ts:99-107`) mirrors the backend's one-level `telegram` merge, so the
optimistic state keeps `telegram.wallets`. Server: `mergePreferences` merges `telegram` one level deep when both sides are
records; everything else unchanged; the merge runs inside the atomic update, so a concurrent wallet PATCH is not lost.
OpenAPI `paths/auth.ts` (`PATCH /auth/me/preferences`) documents the telegram merge; its contract assertions go in the new
standalone `server/tests/unit/api/openapi.preferences.test.ts` (D-10.14).

**Failing-first tests.**
- Server `server/tests/unit/api/authRegistration/profile-sessions.contracts.ts` (609 lines; PATCH block at `:79+`): stored
  `telegram {botToken:'a', chatId:'1', enabled:true, wallets:{w1:{enabled:true}}}`, PATCH `telegram {enabled:false}` →
  persisted telegram keeps `wallets.w1` and `botToken` (fails: wallets dropped); PATCH with explicit `wallets:{}` → replaced
  (passes both). The race: stored state reflects a wallet PATCH made after the client's snapshot; a global save without
  `wallets` keeps it (fails on f9047d86d6 only through the client case below, server case above covers the merge).
- `tests/components/Settings/sections/TelegramSection.branches.test.tsx` (263 lines): user fixture with
  `wallets:{w1:{enabled:true}}`; Save and Toggle each call `updatePreferences` with a telegram patch **without** a `wallets`
  key (fails: wallets copied). The existing `getTelegramWallets` fallback test (`:223-262`) goes red with the helper's
  removal: delete it or replace it with the no-`wallets`-key assertion.
- `tests/components/Settings.interactions.test.tsx:352-379`: the exact `toHaveBeenCalledWith({telegram:{…, wallets: {}}})`
  assertions for Save and Toggle go red; rewrite them without a `wallets` key (rewritten red cases).
- `tests/utils/preferencePaths.test.ts` (`mergePreferencePatch`): current
  `telegram {botToken:'a', wallets:{w1:{enabled:true}}}` + patch `telegram {enabled:false}` → result keeps `wallets.w1`
  and `botToken` (fails: shallow merge drops them); an explicit `wallets` in the patch replaces.
- Type guard: `npm run typecheck:app` and `typecheck:tests` pass with `UserPreferencesPatch` (a `Partial<TelegramConfig>`
  patch against the old `Partial<UserPreferences>` signature fails to compile).

**Acceptance.** A wallet-page Telegram change made after login survives a later global Save/Toggle, both in the optimistic
client state and on the server; explicit `wallets` still replaces; no visual change (the `settings-notifications-telegram-shell` PNG baseline stays valid).

### Phase C3 — Armed capture selectors can be re-entered after remount (P2, `support-package--armed-capture-unreadable-after-remount`)

**Evidence (re-verified).** `src/components/SystemSettings/SupportPackageCard.tsx:154-157` keeps txid/sender/receiver/time
in local state (reset on remount); `:218-220` `captureIsActive` (arming/ready/partial); `:283,287,294,301` disable all four
inputs while active; Generate Incident Preview (`:312-319`) needs `incidentRequest` (`:187-196`), null with empty fields;
Arm is disabled only for `ready` (`:336`). Server matches selectors exactly (`server/src/services/supportPackage/capture/controlledCapture.ts:152-168`,
`selector_unavailable` otherwise), refuses a second arm (`:96`, `session_busy`), and never returns selectors
(`docs/reference/privacy-safe-support-package.md:353-358`). Confirmed.

**Fix design.** D-10.9. Remove `captureIsActive` from the four `disabled` props (keep `walletsLoading` on the selects); when
`captureIsActive`, render an info line under the inputs: "A controlled capture is active. Re-enter the exact transaction ID,
sender wallet and receiver wallet it was armed with, and the approximate time, to include its evidence in the incident
preview." (`incidentRequest` also requires the approximate time, `SupportPackageCard.tsx:187-196`.) Arm is disabled
unless the capture state is `inactive`, `invalid` or null (so also for `tearing_down`, which `captureIsActive` does not
cover). No storage of selectors.

**Failing-first tests.** `tests/components/SupportPackageCard.test.tsx` (255 lines): the existing `:153` case asserts the
Transaction ID input is disabled after arming; it is the rewritten red case (enabled while `ready`). Mount with
`getIncidentCaptureStatus` → `{state:'ready'}`; the four inputs are enabled (fails: disabled), the copy (including the
approximate-time instruction) is shown; fill them,
confirm, Generate Incident Preview → `previewIncidentSupportPackage` called with those selectors. `tearing_down` case
(pass 9): as written it would pass on base, since Arm is disabled via `!captureConfirmed || !incidentRequest`
(`SupportPackageCard.tsx:332`); so mount with `getIncidentCaptureStatus` → `{state:'tearing_down'}`, fill the four
selectors and tick the capture confirmation (the inputs are enabled in `tearing_down` on base, `:218-220`), then assert
Arm is disabled, and record the red run (fails: enabled on base). Arm enabled for `inactive`, `invalid` and a null status,
each also after filling the four selectors and ticking the confirmation so that "enabled" is reachable. (Pass 6.) The `partial` case is
not mounted directly in `partial` (on base the inputs are then disabled and `incidentRequest` is null, so Arm is disabled
anyway and the case would pass on base): start `inactive`, fill the four selectors and tick the capture confirmation, then
transition to `partial` (`armIncidentCapture` resolving `{state:'partial'}`, or the next status poll returning it), and
assert Arm is disabled (fails: enabled on base).

**Acceptance.** After leaving and returning (or reloading) during an armed capture, the admin can re-enter the selectors and
generate the incident profile including the capture; Arm cannot be re-sent while active.

### Phase C4 — Node Config reports the fee source runtime actually uses (P2, `node-config--fee-source-shown-mempool-runtime-electrum`)

**Evidence (re-verified).** `server/src/api/admin/nodeConfigData.ts:416-440` maps every URL through
`getNodeExternalServiceResponseUrl` (`shared/constants/nodeConfig.ts:510-520`, `value ?? default`), so NULL fee estimators
become `https://mempool.space[/net]`. Runtime: `feeService.ts:27-35` → `hasConfiguredNodeMempoolFeeEstimator`
(`nodeConfig.ts:546-553` via `getConfiguredNodeExternalServiceUrl` `:486-494`) treats NULL as unconfigured → Electrum.
UI radio `checked={!!feeEstimatorUrl}` (`src/components/NodeConfig/ExternalServicesSection.tsx:224,244`); a save persists
the projected URL (`nodeConfigData.ts:394-400` `optionalExternalServiceUrl`). NULL rows exist on installs older than
migrations `20251211173018` / `20260506000000` (no backfill). The no-row GET (`api/admin/nodeConfig.ts:151-173`) has the same
mismatch. Explorer fields are not affected (runtime defaults explorers too). Confirmed; see OQ-1.

**Fix design.** D-10.11. `getNodeExternalServiceResponseUrl`: for `kind === 'feeEstimator'` return
`getConfiguredNodeExternalServiceUrl(...) ?? ''`, so NULL and whitespace-only stored values both project to `''`, matching
runtime trimming (`nodeConfig.ts:491-493`) and the UI's truthiness check (`ExternalServicesSection.tsx:224`); explorer
keeps `value ?? default`. No-row GET: the four fee-estimator fields → `''`. `buildNodeConfigData` and runtime unchanged. The
node-config OpenAPI description (`schemas/admin/shared.ts:198` area) states `''` = Electrum. Frontend mirror
`DEFAULT_NODE_CONFIG` (`src/components/NodeConfig/nodeConfigData.ts:18-24`): its four fee-estimator fields become `''`
(they hold mempool URLs today). Rebuild `shared/dist`. `shared/constants/nodeConfig.ts` is a hardware-proof source
(`shared/**`), so the emulator proof lanes run on this PR (see Assumptions).

**Failing-first tests.** Existing assertions that pin the old projection are **inverted** (record their red runs):
`tests/shared/nodeConfig.test.ts:217-218`, and
`server/tests/unit/api/adminNodeConfig/adminNodeConfig.read-update.contracts.ts:29,31,33` (no-row), `:81,84` (NULL row),
and (pass 4) `:455`, the PUT response fallback test (`:432-457`) that expects `'https://mempool.space'` for a NULL
`feeEstimatorUrl` through the same `buildNodeConfigBaseResponse` → `getNodeExternalServiceResponseUrl` path → expect `''`.
- `tests/shared/nodeConfig.test.ts` (231 lines; existing helper cases `:214-229`): NULL `feeEstimatorUrl`,
  `testnet3/testnet4/signetFeeEstimatorUrl` → `''` (fails: mempool URLs); NULL explorer → default (passes both); explicit
  URL and `''` round-trip unchanged; a whitespace-only stored fee URL (`'   '`) → `''` (fails: returned as is).
- `server/tests/unit/api/adminNodeConfig/adminNodeConfig.read-update.contracts.ts`: GET of a row with NULL fee fields → `''`
  for all four networks; no-row GET → `''` fees, default explorers (fails); PUT echoing that response persists `''`
  (no switch to mempool).
- `tests/components/NodeConfig/nodeConfigData.test.ts` (exists, 67 lines): `DEFAULT_NODE_CONFIG`'s four fee fields are
  `''` (fails: mempool URLs), labelled a consistency guard (`DEFAULT_NODE_CONFIG` has no `src` consumer; only
  `loadOwnership.test.tsx` imports it); and `getExternalServicesSummary` with `''` fee estimator → "Electrum"
  (`nodeConfigData.ts:88`).
- `tests/components/NodeConfig/ExternalServicesSection.test.tsx`: `''` → Electrum radio checked, no URL input (guard).
- e2e/render fixtures (`tests/e2e/render-regression/renderRegressionHarness.ts:191`, `adminOperationsFixtures.ts:236`,
  `userJourneyApi.ts:325`) use explicit URLs: unaffected.

**Acceptance.** Display, runtime and save agree for NULL rows on every network; an unrelated save never switches fees to
mempool.space; the frontend default agrees with the server default; explorers unchanged.

---

## Phase D — Create Wallet (D1)

### Phase D1 — Single-sig signer list is not pre-filtered by the default script type (P2, `create-wallet--script-type-chosen-after-signer-filter-dead-end`)

**Evidence (re-verified).** `src/components/CreateWallet/useCreateWalletController.ts:39` defaults `scriptType` to
`NATIVE_SEGWIT`; `selectWalletType` (`:136-142`) resets it; `selectScriptType` (`:143-149`) clears the selection and returns
to step 2. `createWalletData.ts:30-42` requires `account.scriptType === scriptType`; `getCompatibleDevices` (`:58-66`) hides
devices without an exact match; step 2 needs a selection (`:120-125`); the picker exists only in step 3
(`ConfigurationStep.tsx:70-94`). `signerSelectionData.ts:22` tells the user the device lacks a match "for this network and
script type". Fixtures (`tests/e2e/create-wallet-flow.spec.ts:40-70`) always include a native_segwit account. Confirmed.

**Fix design.** D-10.10. `createWalletData.ts`: `SINGLE_SIG_SCRIPT_ORDER = [NATIVE_SEGWIT, TAPROOT, NESTED_SEGWIT, LEGACY]`;
`getSupportedScriptTypes(device, walletType, network)` = script types with exactly one matching account (reuses
`getExactAccount`); for `SINGLE_SIG`, `getCompatibleDevices`/`getIncompatibleDevices` use "supports ≥ 1 script type";
multisig unchanged. Controller: `toggleDevice` for single-sig keeps the current `scriptType` if supported, else sets the
first supported one, and binds that account; `selectScriptType` for single-sig with a selected signer that supports the new
type rebinds `deviceAccountId` and stays on step 3 (unsupported types are disabled, so no clear); defensively, an
unsupported type is a no-op (scriptType, selection and step unchanged, D-10.10); with no selected signer it sets
`scriptType` and leaves the step unchanged; `reconcileSelectedSigners` unchanged.
`getDisplayAccount` (`getDisplayAccountForNetwork`, `useCreateWalletController.ts:164-167`) shows the account for the current script type if the device
supports it, else for the device's first supported type, so `SignerDeviceCard.tsx:21,39-43` always has a path to show.
`ConfigurationStep` receives `supportedScriptTypes` and renders unsupported options disabled with "Not available
on the selected signer". (Pass 4, coordinator choice.) `supportedScriptTypes` is a **required** prop, forwarded by
`CreateWalletStepContent` (`CreateWalletStepContent.tsx:9-31,79-89`) from `CreateWallet.tsx` (~`:33`);
`tests/components/coverageFallbacks.test.tsx:85-103` renders `ConfigurationStep` and passes it too (D-owned). `signerSelectionData.ts:22` copy: "…for this network" for single-sig.

**Failing-first tests.**
- `tests/components/CreateWallet/createWalletData.test.ts` (286 lines): `getSupportedScriptTypes` (49'-only device →
  `[NESTED_SEGWIT]`; two 84' accounts → native excluded as ambiguous); single-sig `getCompatibleDevices` includes the
  49'-only device (fails: excluded).
- `tests/components/CreateWallet/CreateWallet.branches.test.tsx` (421 lines): the file mocks `SignerSelectionStep`
  (`:77-104`) with fixed toggles and pins the shared `beforeEach` fixture (`:122-148`) via compatible `'1'` / incompatible
  `'4'` (`:164-165`) and `availableDevices` `toHaveLength(5)` (~`:359`). Leave the shared fixture alone: supply the
  49'-only device per test with `mocks.getDevices.mockResolvedValueOnce([...])`; add a toggle button for that device id to
  the `SignerSelectionStep` mock; make the `ConfigurationStep` mock (`:106-112`) capture its props so
  `supportedScriptTypes` can be asserted. (Pass 9.) 49'-only device is listed in step 2 (asserted via the mock's
  compatible-device count; its 49' path via a `getDisplayAccount` readout rendered by the mock),
  selecting it and advancing selects Nested and passes `supportedScriptTypes: [NESTED_SEGWIT]` to the mocked
  `ConfigurationStep` (the disabled options are asserted in `ConfigurationStep.branches.test.tsx`), create payload has
  `scriptType: 'nested_segwit'` and the 49' `deviceAccountId` (fails: device not listed); a native+taproot device switching
  to Taproot in step 3 rebinds and stays on step 3. Rewritten (they pin the old clear-and-return behaviour):
  `:286-302` (`'clears exact signer bindings when script type changes'`) becomes the defensive case: the mocked
  `ConfigurationStep`'s `change-script` (`:110`, `setScriptType('nested_segwit')`) on a signer without a 49' account is a
  no-op, staying on step 3 with the binding intact; `:304-323` (wallet-type change) keeps its wallet-type assertions
  without depending on the script-type clear; the existing no-signer case (`:369-370`, step 1) keeps passing (D-10.10).
- `tests/components/CreateWallet/ConfigurationStep.branches.test.tsx`: `CreateWallet.branches.test.tsx` mocks
  `ConfigurationStep` (`:106-112`), so the disabled-option assertions live here. `:65-78` clicks all four options and
  expects four `setScriptType` calls, so `baseProps` (`:17-18`) gains `supportedScriptTypes` with all four types; new cases:
  with `supportedScriptTypes: [NESTED_SEGWIT]` the other three options are disabled and show "Not available on the
  selected signer" (fails: no prop, all enabled).
- Step-2 path display (`CreateWallet.branches.test.tsx` via the mock's `getDisplayAccount` readout, pass 9, or a
  `SignerDeviceCard` test): a 49'-only device is listed with its 49' derivation path while the current script type is native segwit (fails: listed without a path, once it is listed).
- Playwright `tests/e2e/create-wallet-flow.spec.ts`: update `'selecting taproot script type updates review'` (`:617-640`,
  currently expects a return to "Select Signers") to the in-place rebind; add a 49'-only-device test that passes its own device list through
  `mockCreateWalletApi(page, { devices })` (`create-wallet-flow.spec.ts:423`, used that way at `:742`) instead of changing
  the default list (no new endpoint). Other Playwright code driving `/#/wallets/create` must be checked and
  updated if it relies on the old filter or the return to step 2: `tests/e2e/user-journeys.spec.ts:197,212`,
  `tests/e2e/accessibility.spec.ts:439,512`, `tests/e2e/render-regression/renderRegressionWalletConnection.contracts.ts:28,84,129`,
  `tests/e2e/render-regression/renderRegressionWalletDevice.contracts.ts:28-83` (drives step 2 → Configuration / "Script
  Type" on testnet3 with "Render Ledger"), `renderRegressionChoiceFocus.contracts.ts:128` and
  `renderRegressionSecondaryText.contracts.ts:230`.
  Render-regression create-wallet tests (`render-regression.spec.ts:42-44`, and the wallet-connection contracts) have no
  PNG baseline; re-run them.

**Acceptance.** A user whose devices have only Taproot/Nested/Legacy single-sig accounts can create that wallet; step 3 offers
only the signer's script types; every listed signer shows a derivation path; multisig unchanged; vitest + Playwright green
(including the other `/#/wallets/create` specs listed above).

---

## Phase E — price (E1)

### Phase E1 — Validate and single-flight historical price lookups (P2, `price-historical--unauthenticated-uncached-upstream-calls`)

**Evidence (re-verified).** `server/src/api/price.ts:399-437` (`/historical`) and `:443-469` (`/history`) pass the raw
`currency` query (`as string`) with no auth and no allowlist, unlike `/multiple` (`:95-121`, upper-case + supported set).
`server/src/services/price/index.ts:428-486` `getHistoricalPrice`: cache key `historical:<raw currency>:<day>` written only
on success; no single-flight; errors wrapped into a generic `Error` (`:479-485`). `:491-525` `getPriceHistory` likewise;
the provider runs it through `marketChartCircuit` (`coingecko.ts` `getPriceHistory`, threshold 3 / 60s), so three
`vs_currency=zzz` calls open the breaker for every caller. `singleFlight` exists (`index.ts:185-202`) but only for current
prices. CoinGecko supports `['USD','EUR','GBP','CAD','CHF','AUD','JPY','CNY','KRW','INR']` (`coingecko.ts:39`) for
`vs_currency`, but `/coins/bitcoin/history` sends no currency (`providers/coingecko.ts:95-100`) and reads
`current_price[currency]` from a multi-currency map, so `getHistoricalPrice` works today for any code in that map
(webhooks `mappedJson.ts:139` and the assistant `marketReadTools.ts:17` pass arbitrary codes). Failures are never cached;
CoinGecko has no BTC history before 2013-04-28; `index.ts:437` normalises the date with local `setHours`. Note:
`server/src/services/price/historicalPriceService.ts` is a dead duplicate (nothing in `server/src` imports it) and
`server/tests/unit/services/price/historicalPriceService.test.ts` tests only that module (D-10.16). Confirmed.

**Fix design.** D-10.8.
- `getPriceHistory`: `private resolveSupportedCurrency(currency)` → `trim().toUpperCase()`, throws
  `InvalidInputError('Unsupported currency: X', 'currency')` unless the registered history-capable provider's static
  list accepts it (`registry.getAll().find(hasHistoricalSupport)?.supportsCurrency(code)`, no health check); called
  **after** `await this.ensureInitialized()` (which stays the first line; pass 10, D-10.8: the registry is empty until
  then), and **before** any `getHistoricalProvider()` call and before the existing `try` (`getHistoricalProvider()`,
  `index.ts:536-549`, health-checks through an uncached `simple/price` call, `providers/base.ts:71-80,89-99,123-127`).
  The cache-miss path runs in `singleFlight` with a new map `priceHistoryRequests` keyed by the normalized cache key, and
  `getHistoricalProvider()` + the fetch run **inside** the `singleFlight` callback (D-10.8).
- `getHistoricalPrice`: **no allowlist.** The code is `trim().toUpperCase()`d. The date is normalised in UTC
  (`setUTCHours(0,0,0,0)`, replacing `index.ts:437`'s local `setHours`) and rejected with `InvalidInputError` before
  2013-04-28 (UTC). The cache and the single-flight map `historicalPriceRequests` are keyed **by date only**
  (`historical:<UTC day>`), and the cached value is the whole `current_price` map from one upstream call; the requested
  currency is resolved locally from that map (looked up with the lower-cased code), and a code absent from the map throws
  `InvalidInputError` without another upstream call. The upstream call is the new provider method
  `getHistoricalPriceMap?(date)`, **optional** on `IPriceProviderWithHistory` (`services/price/types.ts:100`) and
  implemented on `CoinGeckoPriceProvider`; a provider without it gets a typed "no provider with historical map support"
  error (D-10.8). The provider's `getHistoricalPrice` stays as is. As in `getPriceHistory`, `getHistoricalProvider()` and
  the fetch run inside the `singleFlight` callback, which returns **only** the non-empty map (fetch → cache write); each
  caller resolves its own lower-cased currency **after** `await this.singleFlight(...)`, outside the date-keyed promise,
  and raises `InvalidInputError('Unsupported currency')` there (pass 14, D-10.8). The provider throws "not available" for a missing or empty
  `current_price` (as `coingecko.ts:103-107` does today); only non-empty maps are cached; a missing day gets only a short
  negative cache, never a cached `{}`; `InvalidInputError('Unsupported currency')` only for a code absent from a non-empty
  map. An Invalid Date (`isNaN(date.getTime())`) throws `InvalidInputError` before the cutoff check. These checks run
  before the existing `try`.
- (Pass 6.) Error wrapping: the `catch` blocks of `getHistoricalPrice` and `getPriceHistory` (`index.ts:479-485`,
  `:518-524`) today rewrap every error as a generic `Error`, which would turn the per-caller map-lookup
  `InvalidInputError` (raised after `await this.singleFlight(...)`, outside the date-keyed callback, pass 14) into a 500.
  Both catches rethrow `InvalidInputError` and the typed "no provider with historical map support" error unchanged
  (wrapping only other errors); alternatively the per-caller currency resolution runs outside the `try`.
- Provider (`providers/coingecko.ts:90-93`): the `DD-MM-YYYY` string uses `getUTCDate`/`getUTCMonth`/`getUTCFullYear`
  (same commit), shared by `getHistoricalPrice` and `getHistoricalPriceMap`.
- Pure helpers (currency resolution, UTC day key, cutoff and invalid-date check) live in the new covered module
  `server/src/services/price/historicalLookup.ts` (`index.ts` is excluded from coverage, `server/vitest.config.ts:38`).
- Both new in-flight maps (`historicalPriceRequests`, `priceHistoryRequests`) are cleared in `reloadProviders`
  (`index.ts:121-122`) and in `shutdown` (`:701-702`), as the existing maps are. Route: reject non-string `currency` (array query)
  with 400 and respond with the upper-cased code. OpenAPI `paths/bitcoinPrice.ts:305-350`: 400 for unsupported currency /
  a date before 2013-04-28. Routes stay public (consistent with #1403).
- The dead `price/historicalPriceService.ts` and its test are not touched (D-10.16).

**Failing-first tests.**
- New `server/tests/unit/services/price.historical.test.ts` (tests `PriceService`, `index.ts:428-525`; copy the axios,
  cache **and** `providerSettings` mocks from `price.test.ts:1-115`, with `mockProviderSettingsState.enabled` including
  `'coingecko'` (pass 7: `readPriceProviderConfig` reads the DB through `systemSettingRepository.getValue`,
  `providerSettings.ts:98-102`, and `server/tests/setup.ts` does not mock Prisma); `price.test.ts` is already 765 lines
  and is not extended):
  `getPriceHistory('zzz', 30)` → `InvalidInputError` with **zero `axios.get` calls of any URL caused by the lookup** (no
  health-check `simple/price` call either), so the breaker is never exercised. (Pass 4.) A cold `PriceService` runs
  provider health checks at start-up through `registry.register` (`providers/registry.ts:107-134,376-378` →
  `providers/base.ts:71-80`), so the test first calls `await priceService.initialize(); mockedAxios.get.mockClear();`
  and only then makes the `'zzz'` call and asserts zero calls (fails: health check and provider called, generic
  Error); (pass 10) a cold-start case: a fresh `PriceService` with no explicit `initialize()` → `getPriceHistory('USD', 30)`
  resolves and `getPriceHistory('zzz', 30)` rejects with `InvalidInputError` (guards a check placed before
  `ensureInitialized()`; the zero-call assertion stays on the post-`initialize()` + `mockClear()` case); `getHistoricalPrice('ZZZ', d)` with an upstream map lacking `zzz` → `InvalidInputError`
  after exactly one upstream call (fails: generic Error); then `getHistoricalPrice('EUR', d)` and `('usd', d)` for the same
  day → served from the date cache with no further upstream call (fails: one call per currency); a code outside the
  `vs_currency` allowlist but present in the map (e.g. `'BRL'`) still resolves (guards webhooks/assistant); two concurrent
  identical cache-miss calls → exactly one history-URL `axios.get` call (fails: twice), for each method; (pass 14)
  `getHistoricalPrice('USD', d)`, `('EUR', d)` and `('ZZZ', d)` started together on a cold cache → exactly one
  `/coins/bitcoin/history` `axios.get`, USD and EUR each resolve to their own map value, and `ZZZ` rejects
  `instanceof InvalidInputError` (red for a currency lookup inside the `singleFlight` callback); a response
  without `market_data` (or with an empty `current_price`) is neither cached as `{}` nor reported as an unsupported
  currency (a "not available" error, and the next call after the short negative cache retries upstream); a provider
  without `getHistoricalPriceMap` → the typed "no provider with historical map support" error; `reloadProviders` and
  `shutdown` clear both new in-flight maps; a rejected upstream call removes the in-flight entry (next call retries); date `2013-04-27` → `InvalidInputError` (fails); an Invalid Date →
  `InvalidInputError`, not a `RangeError` or generic Error (fails); a date given at local midnight in a non-UTC offset maps
  to its UTC day (fails; see the TZ pin below). "Provider called once" is asserted as an `axios.get` call count on the CoinGecko `/coins/bitcoin/history`
  and `market_chart` URLs (the new file mocks axios as `price.test.ts` does). These service tests are the only guard on `index.ts`, which
  `server/vitest.config.ts:38` excludes from coverage (`**/index.ts`); the helpers moved into `historicalLookup.ts` get
  direct cases in `server/tests/unit/services/price/historicalLookup.test.ts` (new) so coverage measures them.
- `server/tests/unit/services/price/coingeckoProvider.test.ts`: `getHistoricalPriceMap` returns the whole `current_price`
  map; under the simulated `'Asia/Kolkata'` offset (TZ pin below), the instant `2026-01-01T18:30:00.000Z` (local midnight
  Jan 2 in UTC+05:30) requests `01-01-2026` (fails: requests `02-01-2026` from the local date getters).
- **TZ pin (pass 4).** `TZ` is pinned nowhere (server Vitest config, setup, `package.json`, workflows), and under UTC
  both the provider UTC-day test and the service "local midnight in a non-UTC offset" test pass on `f9047d86d6`.
  (Pass 5, coordinator choice.) A negative-offset zone cannot turn the service case red (local midnight in UTC−10 is the
  same UTC calendar day, so base and fix request the same `DD-MM-YYYY`), so the zone is the positive-offset
  **`'Asia/Kolkata'` (UTC+05:30)** for both files. (Pass 6, coordinator choice.) Setting `process.env.TZ` at runtime has
  no effect in Vitest worker threads (repo notes at `tests/utils/balanceHistorySeries.test.ts:5-6`,
  `tests/components/WalletDetail/tabs/TransactionFilterBar.test.tsx:46-47`), and backend CI coverage runs
  `--pool threads` (`scripts/ci/backend-coverage-shard.sh:95`, `run-lane.sh:141`), so **no `process.env.TZ` is set**.
  Both timezone cases are pool-independent instead: in `coingeckoProvider.test.ts` and `price.historical.test.ts` the
  instants are written in absolute UTC (`new Date('2026-01-01T18:30:00.000Z')`) and the +05:30 offset is simulated with
  `vi.spyOn(Date.prototype, 'getDate' | 'getMonth' | 'getFullYear' | 'setHours')` returning Kolkata-local values
  (restored in `afterEach`); the base code reads those local getters and requests `02-01-2026` (red), and the fix
  (`getUTC*` / `setUTCHours`) requests `01-01-2026` (green). Each timezone case must show a recorded red run on
  `f9047d86d6`.
- (Pass 6.) Error propagation: in `price.historical.test.ts`, `getHistoricalPrice('ZZZ', d)` with an upstream map
  lacking `zzz` rejects with an error that is `instanceof InvalidInputError` (not a rewrapped generic `Error`; fails on a
  catch that rewraps), and the typed "no provider with historical map support" error likewise passes through unchanged;
  and a route-level case drives the real `PriceService` so `GET /historical?currency=zzz` (code absent from the
  upstream map) returns 400, not 500. (Pass 7, coordinator choice.) It cannot live in `price.history.test.ts`, which
  imports `priceTestHarness.ts` and so mocks `src/services/price` module-wide (`priceTestHarness.ts:100-102`). It goes in a
  new standalone `server/tests/unit/api/price.historical-service-errors.test.ts` that mounts the real `src/api/price`
  router + `errorHandler` without the harness, with the same axios, cache and `providerSettings` mocks as
  `price.historical.test.ts` (copied from `price.test.ts:1-115`, `'coingecko'` enabled); fails on `f9047d86d6` (500).
- `server/tests/unit/api/price.history.test.ts` (156 lines): `currency=zzz` → 400 with the service's message when the mocked
  service throws `InvalidInputError` is a **guard** (passes on `f9047d86d6` too: the route already rethrows
  `InvalidInputError`); the red cases are `currency=a&currency=b` → 400 (fails: 500/pass-through) and the response
  `currency` upper-cased (fails).
- Re-run `tests/unit/services/webhooks` and `tests/unit/assistant` (codes in the upstream map keep working; codes absent
  from it now get a typed 400-class error; no fixture uses one).

**Acceptance.** Unsupported `vs_currency` codes never reach CoinGecko (no request of any URL caused by the lookup, health
check included; service start-up health checks are out of scope) or the circuit breaker; supported codes work on the
first request after boot (lazy initialization, pass 10); the UTC-day tests fail on
`f9047d86d6` under the simulated `Asia/Kolkata` offset (`Date.prototype` local-getter spies, no `process.env.TZ`;
red runs recorded); a code missing from the upstream map reaches the route as 400, not 500; an empty or missing upstream `current_price` is never cached as `{}` or reported as an unsupported
currency; `getHistoricalPrice` keeps
working for every code in CoinGecko's `current_price` map and makes at most one upstream call per UTC day across all
currencies; dates before 2013-04-28 are rejected without an upstream call; identical concurrent lookups share one
upstream call; Invalid Dates are a typed 400-class error; the provider requests the UTC day; valid lookups unchanged; the
dead duplicate module is untouched; backend coverage 100% (with `index.ts` guarded only by the listed tests).

---

## Phase F — CI and release tooling (F1, F2)

### Phase F1 — Classify every repo file a Vitest suite reads (P2, `ci-classifier--non-src-vitest-inputs-skip-frontend-lane`)

**Evidence (re-verified).** Root Vitest includes every `tests/**/*.test.{ts,tsx}` (`config/tooling/vitest.config.ts:39`).
Suites read non-src files: `tests/config/nginxProxyHeaders.test.ts:5-12` (docker/nginx templates),
`workerDatabaseTimeout.test.ts:5` (`docker-compose.yml`), `torIngress.test.ts:10-11`,
`tests/monitoring/wallet-sync-observability.test.ts:54-66`, `tests/config/trezorEmulatorProofConfig.test.ts:120-124`
(`verify-vectors.yml`), `tests/scripts/diagnoseWalletSync.test.ts:31`, `tests/scripts/canaryFleetManifest.test.ts:14`;
backend `server/tests/helpers/hardwareSignedFixtureIntake.ts:75-81` (`config/jade-emulator-proof.json`,
`scripts/verify-psbt/proof-manifest.json`). Sourcing `scripts/ci/classify-files-lib.sh` at f9047d86d6 gives
`fe=n be=n fs=n` for docker/nginx/default.conf.template, docker-compose.yml, docker/compose/tor.yml,
docker/monitoring/alert_rules.yml, .github/workflows/verify-vectors.yml, config/{trezor,jade}-emulator-proof.json,
scripts/ci/run-trezor-emulator-proof.sh, scripts/diagnose-wallet-sync.sh, scripts/generate-readme.sh,
scripts/release/canary/fleet-manifest.json, scripts/quality/safety-catch-allowlist.json; the proof inputs are
wallet-safety + hardware-proof (`ws=y hw=y`), but `classify-test-changes.sh:190-199` and `plan-test-run.sh:181-190` check
those predicates only inside the `is_docs_only_file` branch. A heuristic scan of `tests/**` string literals at f9047d86d6
finds ~60 tracked non-src paths no predicate claims (scripts/ci 12, scripts/verify-addresses 6, scripts/quality 5,
docker/monitoring 4, …). `tests/ci/classify-test-changes.test.sh:521-537` pins `install-test.yml → full_scan=false,
frontend_changed=false`. Confirmed.

**Fix design.** D-10.12 (exact paths, no fallback).
1. `classify-files-lib.sh`: new `is_root_vitest_input_file` (frontend) matches **exact paths only**: the root-Vitest inputs
   the drift guard reports, hand-listed in a POSIX `case` in the lib (no generated manifest, D-10.18) (e.g. `docker/nginx/default.conf.template`,
   `docker-compose.yml`, `.github/workflows/verify-vectors.yml`, `config/jade-emulator-proof.json`; never
   `install-test.yml`). No `docker/* | config/* | scripts/*` globs (they would claim 8 `config/`, 3
   `config/ledger-emulator/` and 31 `scripts/verify-*`/`scripts/` proof inputs and weaken the workflow-script check);
   `scripts/lib/*` stays out. `is_frontend_file` returns true for it. New `is_backend_vitest_input_file`: exact paths read by
   `server/tests/**` outside `server/`, at least `config/jade-emulator-proof.json`, `scripts/verify-psbt/proof-manifest.json`,
   `config/jade-protocol-harness.json` and `config/hardware-physical-evidence-trust.json`
   (`config/wallet-sync-lifecycle-contract.json` is **not** listed: it appears only in comments,
   `confirmations.*.contracts.ts:12,14,117`). `config/jade-protocol-harness.json` is also a runtime input
   (`server/src/services/jadePinRelay.ts:17` imports it). The adapters treat it like `is_backend_file`: set
   `backend_changed` **and append the path to `backend_files`** (otherwise `test.yml:262-269` hard-fails "backend_changed
   was true but no backend files were classified"). No integration helper reads these files (the readers are the unit
   suites `psbt.hardware-signed-vectors.test.ts` and `hardwareSignedEvidenceProvenance.test.ts`), so
   `backend_integration_changed` is not touched. Every call site of the backend predicate gets the new one beside it:
   `classify_full_scan_trigger_file` (`classify-test-changes.sh:87`), the main loop (`classify-test-changes.sh:238`) and
   `plan-test-run.sh:218`. `scripts/verify-psbt/package.json` and `package-lock.json` are exact-path root-Vitest inputs
   (read through `tests/ci/npmOverridesApplied.test.ts:119-126`'s dynamic install-root discovery, D-10.18), and so are
   `docs/site/package.json` and `docs/site/package-lock.json` (same `EXPECTED_INSTALL_ROOTS`, D-10.21);
   `scripts/verify-addresses/package*.json` are already full-scan triggers and need no entry. `.nvmrc` is an exact-path
   frontend input (read by `tests/config/{jade,trezor}EmulatorProofConfig.test.ts:118,129`; D-10.21).
   (Pass 9, coordinator choice.) Root suites also read non-src `server/` files, which today classify `fe=n be=y`; these
   exact paths join `is_root_vitest_input_file`: `server/Dockerfile` (`tests/config/jadeProtocolHarness.test.ts:52`),
   `server/tests/fixtures/verified-address-vectors.ts` (`tests/scripts/verifyAddressesGenerated.test.ts:210`),
   `server/tests/fixtures/generated-psbt-vectors.ts` and `server/tests/fixtures/generated-signed-psbt-vectors.ts`
   (`tests/scripts/verifyPsbtProvenance.test.ts:68,72`), plus any further input the guard finds under the D-10.18
   resolution rules (extensionless and `.js`/`.mjs`-mapped specifiers, transitive closure; e.g.
   `scripts/verify-addresses/sourceManifest.*`, `scripts/verify-psbt/provenance.*`,
   `scripts/ci/hardware-compatibility-report.*`, `server/tests/fixtures/bip32-test-vectors.ts`,
   `server/tests/fixtures/generated/address-key-corpora.*`, and (pass 10) the closure's
   `scripts/verify-addresses/implementations/{bitcoincore,bitcoinjs,go}.ts`, `scripts/verify-addresses/outputFile.ts` and
   `scripts/verify-psbt/types.ts`, each listed by its resolved path). `server/src/**` is still
   not listed (D-10.21 residual).
   `related-test-args` passes these config paths through; they select no related test (`passWithNoTests`), and the full
   backend coverage shards run the reader anyway.
2. **No proof-input fallback** (D-10.12): the adapters' lane logic is unchanged apart from the two new predicates, the md
   branch is unchanged, and the comment above `is_full_scan_trigger_file` (`:362-377`) gains one line: workflows a Vitest
   suite reads are exact-path frontend inputs, and proof inputs re-run through verify-vectors
   (`classify-verify-vectors-scope.sh:126`), not through a full scan.
3. `assert_every_test_workflow_script_is_classified` (`tests/ci/classify-test-changes.test.sh:137-140`) must not accept
   the Vitest-input predicates as classification for scripts that `test.yml` reaches: in the walker, `is_frontend_file
   "$path"` becomes `{ is_frontend_file "$path" && ! is_root_vitest_input_file "$path"; }`, so a path claimed only by
   the new predicate still fails the check.
4. Side effects to state in the PR: `server/.husky/pre-commit` `is_precommit_frontend_path` uses `is_frontend_file`, so
   staged edits to the listed exact paths now run the pre-commit frontend tests; frontend coverage runs on such PRs (cost
   accepted). The lib is sourced under POSIX `sh` there (`server/.husky/pre-commit:36`), so the new predicates must be POSIX
   (no `[[`, no arrays).

**Failing-first tests.**
- New drift guard `tests/ci/vitestRepoInputsClassified.test.ts` (root Vitest, so it runs whenever `tests/**` changes).
  It applies the **D-10.18 guard resolution rules 1-6** (scan scope and transitive closure, resolution order, non-input
  trees, the "resolves to nothing" failure, lane acceptance, the gateway allowlist entry); they are not restated here.
  Strip comments before extracting quoted repo-relative path literals (`docker/`, `config/`, `scripts/`, `.github/`,
  `docs/`, `docker-compose*.yml`, tracked root-level files such as `.nvmrc`, and, for root suites, `server/` paths
  **excluding `server/src/**`**, pass 9, D-10.21); keep tracked files. Classify all inputs in one
  `execFileSync('bash', ['-c', …])` that sources the lib (today 10 of 23 unclassified non-src import targets are
  extensionless specifiers, e.g. `tests/scripts/verifyAddressesGenerated.test.ts:14`
  `'../../scripts/verify-addresses/sourceManifest'`). Directory literals and dynamic discovery are never silently
  dropped (e.g. `tests/ci/npmOverridesApplied.test.ts:119-126` discovers `scripts/verify-psbt`, `docs/site` and
  `scripts/verify-addresses`, each expanded to its `package{,-lock}.json` only, D-10.18/D-10.21). False positives go in
  an in-file allowlist with a reason each; a stale allowlist entry fails. (Pass 11/12, implementer note.) Expect about 12
  reasoned allowlist entries: the 7 import-shaped fixture strings in `tests/server-worker-boundary.test.ts:36-90`, the
  `docs/architecture/containers` slug, the `scripts/perf/proof.mjs` temp path, the `scripts/ci`/`scripts/quality`
  temp-mkdir literals, and the `server/tests/helpers` directory literal
  (`server/tests/helpers/hardwareSignedEvidenceProvenance.ts:95`, reached by root suites via
  `tests/ci/hardwareCompatibilityReport.test.ts` → `scripts/ci/hardware-compatibility-report.ts` →
  `hardwareSignedPsbtReplay.ts:22`; reason: "readdirSync filtered to `hardwareSigned*.ts`, all four already listed" —
  expanding it would wrongly add unrelated helpers). The `../../../outside.md` and `../../../../outside.js` traversal
  strings are NOT reported under rule 2 (outside the repo / a `server/` literal read by a server suite), so they must not
  be pre-filled. Expect about 103 root-lane exact paths (a lower bound: the aid's regex misses extensionless dotfiles such
  as `.nvmrc` and the expanded `package{,-lock}.json` entries, which the rules name explicitly).
  Implementation aid: read-only prototypes of rules 1-6 are at
  `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad/f1guard/proto4.mjs`
  and (with the pass-11 rules) `.../scratchpad/r10f/p11.mjs` (output `out11.txt`); they are references, not
  deliverables, and the guard must not import them. No temp dirs,
  no `rm`, no `kill` (lifecycle scanner). (Pass 14, lizard.) The guard's rule logic is written as top-level `function`
  declarations, each CCN ≤ 15 and NLOC ≤ 200 (the prototype's single `scan()` is 112 NLOC / CCN 23, and nested arrow
  helpers inside a `describe` count as one function). Fails on f9047d86d6 listing the unclassified paths (~60 by the heuristic scan).
- `tests/ci/classify-test-changes.test.sh` (840 lines; one inline block in `main()` before
  `assert_every_test_workflow_script_is_classified`, as a loop to stay < 1,000): each of docker/nginx/default.conf.template,
  docker-compose.yml, docker/compose/tor.yml, docker/monitoring/alert_rules.yml, scripts/diagnose-wallet-sync.sh,
  scripts/generate-readme.sh, scripts/release/canary/fleet-manifest.json, scripts/quality/safety-catch-allowlist.json,
  .github/workflows/verify-vectors.yml → `frontend_changed=true` (fails: false); `config/jade-emulator-proof.json` →
  `frontend_changed=true` and `backend_changed=true` with a non-empty `backend_files` (it is read by
  `tests/config/jadeEmulatorProofConfig.test.ts` and `server/tests/helpers/hardwareSignedFixtureIntake.ts`; fails: false),
  and `full_scan=false`; `config/hardware-physical-evidence-trust.json` (a backend input that is also a root input via
  `scripts/ci/hardware-compatibility-report.ts:387`; none of the four backend inputs is backend-only) →
  `frontend_changed=true` and `backend_changed=true` with a non-empty `backend_files` (fails: fe=n be=n today); `.nvmrc` → `frontend_changed=true`, `full_scan=false`
  (D-10.21; fails: frontend false); `docs/site/package.json` and `docs/site/package-lock.json` → `frontend_changed=true`
  (fails); `server/Dockerfile` → `frontend_changed=true` and `backend_changed=true` (pass 9; fails: frontend false);
  `.github/workflows/quality.yml` → `full_scan=false` (no fallback); the existing `install-test.yml` assertions unchanged. The fixture repos run the real
  classifier, so the manifests resolve from the real repo.
- `tests/ci/plan-test-run.test.sh` (520 lines): mirror one docker case and the jade proof-config case (frontend + backend,
  no full scan). The failure fixture copies the lib without `config/` (`:83-87`); with exact paths and no fallback this is
  harmless, but confirm its injected diffs still classify as before.
- `tests/ci/pre-commit-agent-gate.test.sh`: add a POSIX-sh case
  `sh -c '. scripts/ci/classify-files-lib.sh; is_root_vitest_input_file docker-compose.yml'` (exit 0), since
  `server/.husky/pre-commit:36` sources the lib under `sh`.
- Run: `bash tests/ci/classify-test-changes.test.sh`, `bash tests/ci/plan-test-run.test.sh`,
  `bash tests/ci/check-workflow-composition.test.sh`, `bash tests/ci/pre-commit-agent-gate.test.sh`,
  `bash tests/ci/classify-verify-vectors-scope.test.sh`, `node --test tests/ci/check-wallet-safety-classifier.test.mjs`,
  `npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts`, and
  `lizard -C 15 -T nloc=200 tests/ci/vitestRepoInputsClassified.test.ts` (zero warnings; pass 14).

**Acceptance.** A PR touching only a file a Vitest suite reads selects that suite's lane (frontend and/or backend, with
`backend_files` non-empty when backend is selected); no new full-scan trigger (`.nvmrc`, `scripts/ci/*` proof scripts and
`tests/ci/*` do not become full-scan triggers; the guard will classify some of them, e.g. `.nvmrc`,
`scripts/ci/run-trezor-emulator-proof.sh` and `scripts/ci/run-jade-protocol-harness.sh`, as frontend inputs; proof inputs
re-run via verify-vectors); unrelated workflow edits still skip;
`assert_every_test_workflow_script_is_classified` is not weakened; the lib still sources under POSIX `sh`; on root-lane PRs
the guard catches any new unclassified read under rule 2's prefix set (pass 14: `gateway/src` is outside it), including non-`server/src` `server/` files read by root suites (e.g.
`server/Dockerfile` selects frontend and backend) and modules reached under the D-10.18 resolution rules, and fails on
any literal or specifier outside the non-input trees that resolves to nothing unless allowlisted (D-10.18 rules 1-6;
the full root and server test trees resolve with no false "resolves to nothing", pass 10; repo-root and ancestor-directory
path anchors are skipped, `tests/llm-egress-proxy/**` readers are judged only by the llm-egress-proxy lane, and the guard
has zero `gateway/src` inputs, pass 11) (residuals for
`server/tests/**`-only reads, root suites reading `server/src` or `gateway/src`, and the allowlisted gateway import, D-10.21); do not edit `verify-vectors.yml`. The quick frontend lane (`test.yml:180`) and the local fast
tier (`scripts/ci/run-lane.sh:152-167`) use `vitest related`, which cannot see `readFileSync` readers, so acceptance is
that the reader suite runs in the full lane that `Full Test Summary` requires; the PR body notes the local fast-tier blind
spot.

### Phase F2 — RC canary samples the worker (P2, `rc-canary--endpoint-and-fallback-gates-probe-api-not-worker`)

**Evidence (re-verified).** `scripts/release/canary/canary-probe.mjs:124-130` `sampleOnce` fetches
`${backendBase}/api/v1/health/live`, `/api/v1/health/ready` and `${backendBase}/metrics` (backendBase :3001, `:81-86`);
`workerBase` (`:87-88`, :3002) is used only for diagnostics (`:144`); `armed` records `workerReachable: true` without a
check (`:111`). Fallback delta `:322` feeds `remoteEvidence.runtime.fallbackCount` (`:393`), rejected when non-zero at
`verify-release-candidate-canary.mjs:133`, but `wallet_sync_fallback_total` is incremented only in the worker
(`server/src/worker/walletSyncAttemptTelemetry.ts:150`). The worker serves `/live`, `/ready`, `/metrics/prometheus`
(`server/src/worker/healthServer.ts:184-196`), the set the remediation plan requires
(`docs/plans/v0.8.69-release-gap-remediation-plan.md:929-935`). `canary-selftest.mjs:61` scrapes backend `/metrics` too.
`parseMetrics` (`lib/canary-runtime.mjs:130-138`) is origin-agnostic. **Pins:** grep of `config/`, `scripts/`, `.github/`,
`docs/reference/`, `tests/` finds no digest of any canary script (no container-image-lock, release-receipt or perf-seal
entry); re-grep before the PR. Confirmed.

**Fix design.** D-10.13. `lib/canary-runtime.mjs`: `export function workerProbeUrls(workerBase)` →
`{ live: `${workerBase}/live`, ready: `${workerBase}/ready`, metricsPrometheus: `${workerBase}/metrics/prometheus` }`.
Probe: `sampleOnce` fetches those three (+ UI unchanged); before `record({type:'armed'})`, iterate every worker IP the way
backend discovery does (`canary-probe.mjs:81-86`), set `workerBase` to the first that answers `/live` with 200 (exit 2 if
none does), and keep the backend reachability check. The selftest does the same worker discovery (replacing its fixed
worker base, `canary-selftest.mjs:44`) and scrapes `workerProbeUrls(...).metricsPrometheus`. Today the selftest takes one
idle sample and never measures worker `/ready` or `/live` latency (`canary-selftest.mjs:44-61`), so it now emits status and
latency for all three worker endpoints (`live`, `ready`, `metricsPrometheus`) and gains a bounded, read-only sampling mode
(e.g. 300 samples × 1 s) to run during a scheduled sync and check the receipt gates (0 failures, p99 ≤ 250 ms,
max ≤ 1000 ms; `verify-release-candidate-canary.mjs:115-124`). The mode is switched on by the env knob
`CANARY_SELFTEST_SAMPLES=<n>` (with `CANARY_SELFTEST_INTERVAL_MS`, default 1000), matching the selftest's existing
env-only configuration (`canary-selftest.mjs:25-27`), and `n` is capped at a fixed maximum. (Pass 3, amended pass 4.) The
sampling mode also polls `diagnostics(workerBase)` at the probe's 250 ms cadence (`canary-probe.mjs:199`) to approximate
the real probe load, and records a sync-activity signal across the window: `Number(activeTotal) > 0` (`activeTotal` is a
string, `canary-runtime.mjs:276`, `canary-probe.mjs:360`) in **at least 40 diagnostics samples** (absolute count, pass 5,
D-10.19). The window is extended past the base sample count until 40 active samples are seen, bounded by a fixed 900 s
limit; a window that reaches 900 s with fewer is reported as **invalid** (non-zero exit, not a pass). (Pass 6.) The
window and gate evaluation is an exported pure helper in `lib/canary-runtime.mjs` (the shared-runtime invariant,
`canary-probe-tooling.test.mjs:139-160`), e.g. `evaluateSelftestWindow({ endpointSamples, diagSamples, elapsedMs })` →
`{ valid, activeSamples, gates }`, which counts a diagnostics sample as active only when `Number(activeTotal) > 0`, marks
the window valid only with ≥ 40 active samples, and evaluates the receipt gates (0 failures, p99 ≤ 250 ms,
max ≤ 1000 ms) per endpoint; `canary-selftest.mjs` calls it to decide its exit status **in sampling mode only**. (Pass 8.)
Without `CANARY_SELFTEST_SAMPLES` the selftest keeps today's exit contract (the operator pre-flight on an idle host,
header `canary-selftest.mjs:3-11`): exit 2 only when the backend or every worker IP fails `/live`, otherwise exit 0
while reporting status and latency for the three worker endpoints (`canary-selftest.mjs:38-44,64-86`); latency gates
and the activity requirement are not applied to a single idle sample. Receipt keys
unchanged. `docs/how-to/release-candidate-canary.md` (operator
table at `:30`) is updated to describe the sampling knob and the activity requirement (≥ 40 active diagnostics samples,
window extended up to 900 s; an invalid window is re-run once, a second invalid window goes to the coordinator).

**Failing-first tests.** `tests/release/canary-probe-tooling.test.mjs` (312 lines, `node --test`): (1)
`typeof runtime.workerProbeUrls === 'function'` and it returns exactly the three worker paths (import the module namespace so
the absence fails the test, not the file); (2) static source check: `canary-probe.mjs` and `canary-selftest.mjs` contain no
`${backendBase}/metrics` or `${backendBase}/api/v1/health/ready` fetch and `sampleOnce` uses `workerProbeUrls` (fails: backend
fetches present); (3) the probe checks `${workerBase}/live` before the `armed` record, and both probe and selftest choose
`workerBase` by iterating the worker IPs (static check that neither hard-codes a single worker base); (4) static check that
the selftest reports status and latency for all three `workerProbeUrls` endpoints, that its sampling loop is bounded
(sample count capped at a fixed maximum and a 900 s deadline; pass 6 wording, since the window is extendable), that it
reads the `CANARY_SELFTEST_SAMPLES` knob, that it polls worker diagnostics at a 250 ms cadence, and that it calls
`evaluateSelftestWindow`; (pass 8) and that without the knob the exit contract is unchanged: `evaluateSelftestWindow`
is reached only on the branch guarded by `CANARY_SELFTEST_SAMPLES` (static check), or behaviourally, a knob-less run
against a stub worker answering `/live` with slow `/ready` latency exits 0, and one with every worker IP failing `/live`
exits 2; (5) (pass 6, replacing the pass-5 static activity check) behavioural cases for
`runtime.evaluateSelftestWindow` (imported from the module namespace, so its absence fails the test): 39 active
samples at `elapsedMs` 900 000 → invalid; 40 → valid; samples with `activeTotal: '0'` (a string,
`canary-runtime.mjs:276`) are not counted active; with a valid window, one endpoint failure, a p99 > 250 ms or a
max > 1000 ms → the matching gate is missed. Run
`node --test tests/release/canary-probe-tooling.test.mjs tests/release/release-candidate-canary.test.mjs` and
`npm run lint:release-canary`.

**Live check before integration (read-only, F2 worker, D-10.19 pass 4).** Worker `/ready` and `/metrics/prometheus`
share the sync event loop (`server/src/worker/healthServer.ts:137-147,194-196`), and the receipt gates (0 failures,
p99 ≤ 250 ms, max ≤ 1000 ms, `verify-release-candidate-canary.mjs:115-124`) were never measured against the worker. From
the F2 worktree, **before** the integrator cherry-picks anything, run `node scripts/release/canary/canary-selftest.mjs`
standalone against the running local stack (single sample) and its bounded sampling mode (`CANARY_SELFTEST_SAMPLES=300`,
1 s interval, diagnostics polled at 250 ms) during a scheduled sync. F2 does not change the worker, so measuring the
deployed worker is valid. Record (for the PR body) that the worker exposition has all 7 `FAMILIES` plus
`active_stage_oldest_seconds`, the per-endpoint status, p99 and max latency for `/live`, `/ready` and
`/metrics/prometheus`, and the count of diagnostics samples with `Number(activeTotal) > 0` (pass 5: at least 40, the
window extended up to 900 s; a window that reaches 900 s with fewer is invalid and re-run once, not counted, and a second
invalid window is escalated to the coordinator). The coordinator then decides whether F2 is cherry-picked. The PR body states the result is a lower
bound and the first real RC canary is the binding check. **Contingency:** if the worker misses any gate, the gates are
**not** loosened; F2 is held out of the PR and escalated to the coordinator (D-10.19).

**Acceptance.** Endpoint samples, counter families, stage-age and fallback delta come from the worker; the first answering
worker IP is used and an unreachable worker fails before arming; the local-stack selftest result (families, and status +
latency of all three worker endpoints under the bounded sync-time sampling loop with diagnostics polled at 250 ms, and
≥ 40 diagnostics samples with `Number(activeTotal) > 0` within a window of at most 900 s, as judged by the tested
`evaluateSelftestWindow` helper) is recorded from the F2 worktree before integration and meets the receipt
gates, or F2 is held and escalated without loosening them; the PR body calls the result a lower bound, with the first real
RC canary as the binding check; the operator doc describes the
sampling knob; existing receipts still validate.

---

## Implementation progress (2026-10-21)

- **Integrated on `codex/bug-scrub-loop/20261013-i10`:** A1, A2, B1, B2, C1–C4, D1, E1, F1 (cherry-picked from the phase
  branches, one commit per finding), then review fixes: E1 returns the existing "no provider" error before the currency
  check when no history-capable provider is registered (adversarial review; red-first test); the price route reuses
  `normalizeCurrencyCode`; B1's twin revocation helpers became one descriptor-driven helper that skips `deleteMany` when
  empty.
- **F2 held (D-10.19).** The F2 code is committed on `codex/bug-scrub-loop/20261013-i10-f2` (8bb41acd42), but both live
  sampling windows on the local stack were invalid (0 active diagnostics samples: the stale-wallet scheduler is retired
  there, so syncs start only from Electrum notifications or an explicit trigger), and one worker `/ready` sample failed
  while idle. The finding stays open; re-measurement needs sync activity on the local stack.
- **Phase G — added during implementation (new P2 `worker-ready--reconcile-flips-not-ready`).** The `/ready` failure
  traced to `RecurringScheduleCoordinator.reconcileConditionalState` (`server/src/worker/recurringSchedules.ts:350-377`)
  publishing `reconciliationHealthy: false` before its Redis round-trips on every 60 s no-op reconcile, so worker `/ready`
  (`healthServer.ts:137-147`) returned 503 for tens of ms each minute (≈40 % chance per 15-min canary window; also seen by
  the backend's `WORKER_HEALTH_URL` polling and the container healthcheck). Fix: keep the previously published state while
  the reconcile runs and publish desired/forbidden/health together at the end; failures still fail closed. Non-regression
  tests hold a reconcile mid-flight (red on `f9047d86d6`: "expected false to be true"). Committed on the F2 branch
  (3670142132) and cherry-picked here. F2 depends on it.

## Verification (before every push)

Workers (one worktree per phase, D-10.15) run only the typechecks and targeted tests for their phase. The integrator runs
the whole block below, as written, as one script on the integrated PR branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i10`
(every `cd server` is in a subshell, so later lines run from the repo root), only after all seven phase branches (A–E, F1,
F2; six if F2 is held, D-10.19) are complete,
and is the only one who runs coverage, one run at a time behind the bounded coverage guard.

**Integrator step before the block (pass 6).** `npm run arch:check` is `arch:graphs && arch:calls && git diff
--exit-code -- docs/architecture/generated && arch:lint`, and A1 changes `docs/architecture/generated/frontend.md`, so
the block would abort at `arch:check` before the graphs are committed. Before running the block, the integrator runs
`npm run arch:graphs` and `npm run arch:calls` in the i10 worktree and commits `docs/architecture/generated` in the
integrator commit; `arch:check` in the block then stays a pure check (a non-empty diff there is a failure).

```bash
set -euo pipefail
# coverage guard (D-10.15): bounded wait, fails loudly; the pattern also matches `npx vitest run --config ... --coverage`
wait_for_no_coverage() {
  for _ in $(seq 1 180); do
    pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage' >/dev/null || return 0
    sleep 10
  done
  echo "coverage guard: another vitest coverage run is still active after 30 min" >&2
  return 1
}
# One gate per line: under `set -e`, a failing non-final command of an `&&` list does not exit (pass 5).
# shared/dist (pass 7): the server resolves @sanctuary/shared from shared/dist (server/tsconfig.json:18-19,
# server/vitest.config.ts:5-6), which is gitignored; direct npx tsc/vitest calls skip the pretest hook. Run on the
# integrated branch, not only in the C worker's worktree.
npm run build --workspace=shared
# backend
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )
( cd server && npx vitest run tests/unit/agent tests/unit/services/transferService tests/unit/services/transferService.test.ts \
  tests/unit/services/price.test.ts tests/unit/services/price.historical.test.ts tests/unit/services/price \
  tests/unit/services/agentApiService.test.ts tests/unit/middleware/agentAuth.test.ts tests/unit/api/openapi.test.ts \
  tests/unit/api/openapi.transfers-agent.test.ts tests/unit/api/openapi.preferences.test.ts \
  tests/unit/api/price.history.test.ts tests/unit/api/price.historical-service-errors.test.ts tests/unit/api/adminNodeConfig tests/unit/api/authRegistration )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only
# integration: only with a reachable integration DB (scripts/ci/prepare-integration-db.sh); a skip is recorded and its CI group is relied on
if [ -n "${DATABASE_URL:-}" ]; then
  ( cd server && npx vitest run tests/integration/flows/transfers.integration.test.ts )
else
  echo "SKIPPED integration: no DB"
fi
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold
# Playwright (no host dev server): npm run build; serve dist/ with a static server; run a throwaway
# playwright config without webServer against it: full suite, at least create-wallet-flow, user-journeys, accessibility,
# send-transaction-flow, settings-persistence, render-regression (PNG baselines must stay unchanged)
# quality gates
npm run lint
npm run quality:lizard                             # CCN cap 86
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh   # fresh dir: the script refuses a non-empty one
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run arch:check                                 # pure check: graphs already regenerated and committed before the block; i10 worktree (real node_modules); only if it misbehaves, re-run in a detached primary checkout
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
npm run verify:signer-inventory
npm run check:safety-catch-guards
npm run check:wallet-sync-mutation-boundaries
npm run check:wallet-sync-lifecycle-contract
npm run check:openapi-route-coverage
npm run check:api-body-validation
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/plan-test-run.test.sh
bash tests/ci/check-workflow-composition.test.sh
bash tests/ci/pre-commit-agent-gate.test.sh
bash tests/ci/ci-registration-completeness.test.sh
bash tests/ci/classify-verify-vectors-scope.test.sh
sh -c '. scripts/ci/classify-files-lib.sh; is_root_vitest_input_file docker-compose.yml'   # lib still sources under POSIX sh
sh -c '. scripts/ci/classify-files-lib.sh; is_root_vitest_input_file server/Dockerfile'   # pass 9: non-src server/ root input
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree; D-10.18 rules 1-6 (pass 10)
node --test tests/release/canary-probe-tooling.test.mjs tests/release/release-candidate-canary.test.mjs
npm run lint:release-canary
# F2 confirmation only (skip if F2 is held): the binding live check already ran from the F2 worktree before integration (D-10.19)
node scripts/release/canary/canary-selftest.mjs     # read-only, local stack; worker FAMILIES + status/latency of /live, /ready, /metrics/prometheus
#   knob-less exit contract unchanged (pass 8): exit 2 only if the backend or every worker IP fails /live, else exit 0
#   (latency is reported, not gated; gates apply only in CANARY_SELFTEST_SAMPLES mode)
#   optional re-confirmation of the sampling mode during a scheduled sync (read-only):
#   CANARY_SELFTEST_SAMPLES=300 node scripts/release/canary/canary-selftest.mjs
#   valid only with >= 40 diagnostics samples where Number(activeTotal) > 0 (polled at 250 ms), window extended up to
#   900 s; gates: 0 failures, p99 <= 250 ms, max <= 1000 ms; never loosen the gates
echo "verification block: all gates passed"
```

No compose, install script or Dockerfile is touched, so the install unit tests (`bash scripts/ci/run-install-unit-tests.sh`)
are not required; run them if an implementation drifts into `docker/` or `scripts/setup.sh`. `/simplify` and an adversarial
review before committing; commits in the foreground (the pre-commit AI review must be read), each through
`flock /home/nekoguntai/.i10-commit.lock git commit …` (D-10.15); never commit while a coverage run is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i10` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i10`),
  one commit per finding (test + fix), then the integrator commit (changelog `[Unreleased]` bullets, architecture graphs
  regenerated with `npm run arch:graphs` + `npm run arch:calls` and `docs/architecture/generated` committed **before** the
  verification block runs (pass 6), F1 guard re-run over the final tree; the new OpenAPI test files are standalone and need no
  registration, D-10.14).
- **Workers (D-10.15):** phases A–E, F1 and F2 run in parallel, each in its own worktree under `/home/nekoguntai` (never
  `/tmp`), e.g. `/home/nekoguntai/sanctuary-bug-scrub-20261013-i10-<phase>` on branch
  `codex/bug-scrub-loop/20261013-i10-<phase>` (`<phase>` ∈ `a,b,c,d,e,f1,f2`; F2 is separate so it can be held alone,
  D-10.19), cut from the final reviewed plan commit (recorded by the integrator when cutting worktrees; it differs from
  `f9047d86d6` only under `tasks/`, so red runs still prove failure on `f9047d86d6` code), set up with root `npm ci` + `cd server && npx prisma generate` (+ the `shared` build; C
  rebuilds `shared/dist` after its `shared/` edit; the integrated branch rebuilds it again as the first Verification-block
  line, pass 7) and nvm node on `PATH`. Workers edit only their owned files, run
  typechecks and targeted tests only (no coverage), run `lizard -C 15 -T nloc=200` on their new/changed files and
  report zero new warnings (pass 14: 84 of 86 used, the PR may add at most 2), record their red runs, and commit in the foreground on their own phase
  branch through the host-wide `flock /home/nekoguntai/.i10-commit.lock git commit …`. No `git stash` (shared across
  worktrees).
- **F2 hold decision before integration (D-10.19, pass 4):** the F2 worker runs the live check (single sample +
  `CANARY_SELFTEST_SAMPLES=300` mode, diagnostics at 250 ms, ≥ 40 active diagnostics samples within at most 900 s; one
  re-run of an invalid window, then escalation) from its worktree, standalone and
  read-only against the running local stack, and records the result; the coordinator decides whether F2 is cherry-picked
  before the integrator starts.
- **Integrator:** cherry-picks the phase commits serially onto the PR branch, resolves nothing by editing another phase's
  files (conflicts go back to the owning worker), and alone runs coverage, starting only after all seven phase branches (six
  if F2 is held) are complete, behind the bounded `wait_for_no_coverage` guard (`[n]ode_modules/.bin/vitest run.*--coverage`, fails loudly on
  timeout); commits through the same `flock` lock and never while a coverage run is active. After the cherry-picks land,
  each phase branch is proven upstream with `git cherry <PR-branch> <phase-branch>` (every line `-`), then deleted with
  `git branch -D`, and its worktree is removed by path. A held F2 is not cherry-picked; its branch and worktree are kept
  and its finding stays open in run state pending the coordinator's decision (D-10.19).
- **Merge:** squash merge through protected `main`; no admin bypass; wait for every run on the head SHA, polling the
  required contexts via `/commits/<sha>/statuses` (the combined `/status` can read success while required verify-vectors
  contexts are still pending); C1 (`src/api/{client,refresh}.ts`) and C4 (`shared/**`) touch hardware-proof sources, so
  emulator lanes run, and any retrigger carries the CLAUDE.md four-part evidence. Verify the reported `merge_commit_sha` is
  an ancestor of `origin/main` before deleting the branch. PR body flags: OQ-1 and its default; B1 audit/removal semantics,
  the wallet-derived device-access residual and the concurrent direct-share residual (D-10.20); B2 per-request cost; C2 old-tab residual; D1 Playwright change; E1 residual fan-out, the `getHistoricalPrice`
  no-allowlist/date-cache design and the dead `historicalPriceService.ts` (P3 backlog material); F1 CI-cost and pre-commit
  side effects (exact paths, no full-scan fallback), the local fast-tier blind spot (`vitest related` cannot see
  `readFileSync` readers; the full lane runs them) and the guard-reach residuals (root-lane PRs only; `server/tests/**`-only
  reads caught nightly; root suites reading `server/src` skipped on server-only PRs, D-10.21; non-src `server/` files read
  by root suites, such as `server/Dockerfile`, now also select frontend, pass 9; the allowlisted gateway import of
`phase2OperationsProof.integration.test.ts`, not re-run on gateway-only PRs, D-10.18 rule 6, pass 10; root suites reading
  `gateway/src` (`addressDerivationBoundaryPolicy.test.ts:10`) skipped by gateway-only PRs, caught by the nightly full
  scan, pass 14); F2 "no receipt schema
  change" and the recorded local-stack selftest result (worker families, per-endpoint status + p99/max latency under
  sync-time sampling, count of active diagnostics samples), stated as a lower bound with the first real RC canary as the binding
  check, or F2 held and escalated (D-10.19); a skipped local integration run, if any.
- **Rollback:** every phase is code-only and independent (F2 can be held out of the PR on its own, D-10.19); no schema, data migration or stored-shape change (A1 adds an
  optional field to transient wizard state; B1's audit actions are new strings in an existing column). Reverting B1 restores
  the old narrower removal for future transfers only (removed rows are not restored, by design of the contract).
- **Concurrency/caches:** B1 runs inside the existing serializable transaction + resource lock, which serializes it
  against transfers and group-grant writes but not against a direct user share (`addUserToWallet` is a read-committed
  insert that the `FOR NO KEY UPDATE` fence does not block): residual D-10.20, flagged in the PR body; websocket grants
  refreshed after commit as today. C2's merge runs inside `updatePreferencesAtomically`. E1's in-flight maps are cleared in `reloadProviders`
  and `shutdown` like the existing ones; `getHistoricalPrice` single-flights per UTC day. C1 preserves the Web Lock single-flight;
a joiner whose snapshot still equals the current expiry re-runs the check after the shared promise settles (D-10.17).
- **Deployment:** none until clean closeout (coordinator policy); the local stack is rebuilt only after the loop closes.

## Completion criteria

- [ ] All twelve regression tests (eleven if F2 is held, D-10.19) fail on `f9047d86d6` and pass on the PR head (record
  the red runs).
- [ ] PR merged; target-branch CI green on its merge commit; ancestry verified; branch and worktree cleaned.
- [ ] The seven phase branches (`codex/bug-scrub-loop/20261013-i10-{a,b,c,d,e,f1,f2}`; six if F2 is held) each proven
  upstream with `git cherry <PR-branch> <phase-branch>` (all `-`) and deleted with `git branch -D`; their worktrees
  (`/home/nekoguntai/sanctuary-bug-scrub-20261013-i10-<phase>`) removed by path. A held F2 branch and worktree are kept,
  not deleted (D-10.19).
- [x] OQ-1 resolved by the coordinator (D-10.11): runtime unchanged, admin projection fixed.
- [ ] Each phase was implemented in its own worktree under `/home/nekoguntai` and committed on its phase branch; the
  integrator cherry-picked serially and alone ran coverage after all seven (six if F2 is held) were complete; every
  phase branch was cut from the final reviewed plan commit, whose SHA the integrator recorded; every commit went through the
  host-wide `flock` commit lock (D-10.15).
- [ ] Required contexts confirmed green via `/commits/<sha>/statuses` on the PR head, not the combined status.
- [ ] F2: `node scripts/release/canary/canary-selftest.mjs` run read-only on the local stack from the F2 worktree
  **before integration**, single sample and bounded sync-time sampling (`CANARY_SELFTEST_SAMPLES`, diagnostics at 250 ms)
  over a window with ≥ 40 diagnostics samples where `Number(activeTotal) > 0`, extended up to 900 s (an invalid window
  re-run once; a second invalid window escalated to the coordinator), and the cherry-pick decision taken then; the worker exposition's 7 `FAMILIES` + `active_stage_oldest_seconds` and the status, p99 and max
  latency of `/live`, `/ready` and `/metrics/prometheus` are recorded in the PR body and meet the receipt gates, or F2 was
  held and escalated to the coordinator without loosening them (D-10.19); the PR body calls it a lower bound.
- [ ] `npm run arch:graphs` and `npm run arch:calls` run and `docs/architecture/generated` committed in the integrator
  commit before the verification block; `arch:check` in the block passes as a pure check (pass 6).
- [ ] Verification block run as written on the integrated branch (`npm run build --workspace=shared` on its own line before
  `( cd server && npx prisma generate )`, pass 7; one gate per line under `set -euo pipefail`, `wait_for_no_coverage || exit 1`
  before each coverage run, a fresh jscpd output dir) with exit status 0 recorded (pass 5); the local integration run either executed against a reachable DB or
  its "SKIPPED integration: no DB" line is recorded.
- [ ] PR body carries every flag listed under Delivery (OQ-1, B1 + device and concurrent-share residuals, B2, C2, D1,
  E1 + dead module, F1 + guard-reach and gateway-allowlist residuals, F2 + selftest result).
- [ ] Run state updated (findings resolved, or eleven resolved and F2 open pending the coordinator if held; decisions
  D-10.1…D-10.21 recorded).
- [ ] F1 guard (pass 9) scans root suites' non-`server/src` `server/` literals and resolves extensionless imports; it
  fails on f9047d86d6 listing at least `server/Dockerfile` and the extensionless `scripts/verify-addresses/sourceManifest`
  target, and passes on the PR head with no unresolved literal outside the allowlist; (pass 10) it applies the D-10.18
  resolution rules 1-6 (transitive closure, `.js`/`.mjs` mapping, `/index.{ts,tsx,js}`, the "resolves to nothing"
  failure only outside the non-input trees, gitignored generated paths ignored, llm-egress-proxy lane accepted, the
  gateway import allowlisted), and the closure's newly found paths are in `is_root_vitest_input_file`.
- [ ] P3 backlog (including `payjoin-attempt--route-timeout-shorter-than-receiver-budget`) remains outside the blocking fix set.

## Review log

- Pass 1 (2026-10-20): 39 accepted comments applied (A/B 12, C/D/E 13, F/cross-cutting 14); rejected: none.
- Pass 2 (2026-10-20): 30 accepted comments applied (A/B 8, C/D/E 11, F/cross-cutting 11); rejected: none.
- Pass 3 (2026-10-20): 20 accepted comments applied (A/B 5, C/D/E 8, F/cross-cutting 7); rejected: none.
- Pass 4 (2026-10-20): 11 accepted comments applied (A/B 4, C/D/E 4, F/cross-cutting 3); rejected: none.
- Pass 5 (2026-10-20): 7 accepted comments applied (A 3, E 1, F/cross-cutting 3); B clean; rejected: none.
- Pass 6 (2026-10-20): 7 accepted comments applied (A 1, C/E 4, F/cross-cutting 2); B, D and F1 clean; rejected: none.
- Pass 7 (2026-10-20): 5 accepted comments applied (A 2, E 2, cross-cutting 1); B, C, D, F1, F2 clean; rejected: none.
- Pass 8 (2026-10-20): 2 accepted comments applied (A2 1, F2 1); B, C, D, E, F1 and cross-cutting clean; rejected: none.
- Pass 9 (2026-10-20): 6 accepted comments applied (A1 2, C3 1, D1 1, F1 2); A2, B, C1/C2/C4, E, F2 and cross-cutting clean; rejected: none.
- Pass 10 (2026-10-20): 5 accepted comments applied (A2 1, E1 1, F1 3); A1, B, C, D, F2 and cross-cutting clean; rejected: none.
- Pass 11 (2026-10-20): 3 accepted comments applied (D-10.18 guard rules); A, B, C, D, E, F2 and cross-cutting clean; rejected: none.
- Pass 12 (2026-10-20): 1 accepted comment applied (F1 implementer note: expected allowlist corrected to 12 entries; traversal strings removed; server/tests/helpers added); A, B, C, D, E, F2 and cross-cutting clean; rejected: none.
- Pass 13 (2026-10-20): 2 accepted comments applied (A1 test (5) pattern-valid case pair + negative row; F1 hardware-physical-evidence-trust.json is also a root input); A2, B, C, D, E, F2 and cross-cutting clean; rejected: none.
- Pass 14 (2026-10-20): 3 accepted comments applied (E1 per-caller currency resolution outside singleFlight; lizard 84/86 headroom; gateway/src read residual); A, B, C, D, F2 and the rest clean; rejected: none.
