# Iteration 16 — P1/P2 remediation after the iteration-15 clean-up

Run `bug-scrub-loop-20260912t210000z-p2-backlog` · iteration 16 · scope: whole repository · target `main`
Source SHA scrubbed: `5944b6ce27e8341c23382015aad14d16d04d295e` (all 21 iteration-15 phases merged; final verification green: backend 15875 unit + 765 integration, frontend 8538, all gates).

Findings (19; all reconfirmed by the coordinator from current source; ids are the ledger's stable ids):

| Phase | Sev | Finding | Boundary |
| --- | --- | --- | --- |
| 1 | P1 | `approval-specific-quorum-ignores-specificapprovers` + P1 `vault-policy-all-quorum-requiredapprovals-static-not-membership` | `server/src/services/vaultPolicy/approvalService.ts` (+ `vaultPolicyService.ts` validation) |
| 2 | P1 | `node-config-masked-proxy-password-overwrites-on-save` | `server/src/api/admin/nodeConfig.ts` + `nodeConfigData.ts` |
| 3 | P1 | `mobile-permission-check-fetch-no-timeout` | `gateway/src/middleware/mobilePermission.ts` |
| 3b | P1 | `trezor-getcoinforpath-substring-misclassifies-mainnet-account-1-as-testnet` | `src/services/hardwareWallet/adapters/trezor/trezorAdapter.ts`, `trezor/signPsbtNetwork.ts` (reuses the existing `src/services/hardwareWallet/pathUtils.ts:isTestnetPath` — no new parser file) |
| 4 | P2 | `totp-code-replay-within-tolerance-window` | `server/src/services/twoFactorService.ts` + Prisma migration |
| 5 | P2 | `recalculate-endpoint-mutates-with-view-only-access` | `server/src/api/transactions/walletTransactions/recalculate.ts` |
| 6 | P2 | `autopilot-telegram-patch-resets-omitted-fields-to-defaults` | `server/src/api/wallets/autopilot.ts`, `telegram.ts` |
| 7 | P2 | `push-register-devicename-null-rejected-by-gateway` | `shared/schemas/mobileApiRequests.ts` |
| 8 | P2 | `prepare-integration-db-no-production-guard` | `scripts/ci/prepare-integration-db.sh`, `scripts/ci/check-integration-db.mjs`, `server/tests/integration/repositories/setup/database.ts`, `scripts/ci/resolve-postgres-service.sh` |
| 9 | P2 | `rbf-negative-fee-delta-desyncs-returned-fee-from-outputs` | `server/src/services/bitcoin/advancedTx/rbf.ts` (mutation-map pinned file family: check `config/wallet-safety-mutation-map.json`) |
| 10 | P2 | `hex-psbt-import-skips-magic-byte-check` | `src/utils/psbtFormat.ts`, `src/components/DraftList/draftListHelpers.ts`, `src/components/qr/QRSigningModal/psbtFileImport.ts` |
| 11 | P2 | `send-remove-output-scanning-index-desync` | `src/contexts/send/reducerParts/outputs.ts` |
| 12 | P2 | `hardwarewallet-service-connect-disconnect-race-reconnects-after-cancel` + P2 `ledgeradapter-connect-disconnect-race-reconnects-after-cancel` + P2 `bitbox-connect-partial-failure-leaks-hid-handle` + P2 `jade-adapter-overlapping-connect-cross-contaminates-cleanup` | `src/services/hardwareWallet/service.ts`, `adapters/ledger/ledgerAdapter.ts`, `adapters/bitbox/bitboxAdapter.ts`, `adapters/jade.ts` |
| 13 | P2 | `label-selector-create-error-survives-cancel-and-reopen` | `src/components/LabelSelector/useLabelSelectorController.ts` |
| 14 | P2 | `node-config-server-crud-errors-silently-swallowed` | `src/components/NetworkConnectionCard/**` |

Goal: resolve every finding above with a merged, CI-verified PR carrying a regression test proven red against `origin/main`.
Non-goals: the 31 P3 backlog items (recorded in the ledger; not blocking), product decisions such as the `getStatus` unknown-network fallback, and any refactor beyond the named boundary.
Assumptions: Forgejo branch protection unchanged (serial merges, `block_on_outdated_branch`); one coverage run at a time on the dev host; subagents never `git stash`; mapped bitcoin files keep their mutation-map line pins.

## Ordering

P1s first (1, 2, 3, 3b), then P2s grouped by boundary. All phases are independent except: Phase 4 adds a migration (land before any later phase that touches `schema.prisma` — none planned); Phase 14 and Phase 2 both touch node-config surfaces but different layers (frontend card vs server update path) — no file overlap.

Every phase: tests first (red on `origin/main`, quoted failure message), then the fix; gates per package (server: `tsc`, `typecheck:tests`, `lint:server`, boundaries, unit coverage 100% on `tests/unit`, `check-large-files`, lizard exactly 86, `arch:check` in the primary checkout, `git diff --check`; frontend: `typecheck:app/tests/all`, `lint`, coverage 100%, same quality gates); one PR per phase; branch deletion after ancestry + zero-content-diff.

## Phase 1 — P1: `'specific'` quorum must count only the named approvers

Root cause (verified): `approvalService.ts:380-396` resolves `'specific'` exactly like `'any_n'`; `specificApprovers` is validated at creation (`vaultPolicyService.ts:386-401`) and never read again; `castVote` checks only "not yet voted" and self-approval.
Contract: (a) `'specific'`: when resolving, load the originating policy's `config.specificApprovers` and count only approve votes whose `userId` is in that list; refuse (`InvalidInputError`/403-class) a vote from a user not in the list at `castVote` time so ineligible votes never accumulate; validate at policy creation that `requiredApprovals <= specificApprovers.length`. (b) `'all'` (`vault-policy-all-quorum-requiredapprovals-static-not-membership`, `approvalService.ts:86-92` copies the admin-typed count; no eligible-approver computation exists): derive the required set from the wallet's live eligible approvers (the users with an approving role on the wallet, excluding the requester when `allowSelfApproval` is false) at request creation, and at resolution require an approve vote from every currently eligible approver — a membership change after creation must not resolve early nor deadlock (an approver removed from the wallet no longer counts). `'any_n'` unchanged. Data boundary: `ApprovalRequest.policyId` (`schema.prisma:1712`) resolves the `VaultPolicy` whose `config` Json (`:1677`) holds `specificApprovers`; load it through the existing vault-policy repository (no direct Prisma in the service).
Failing-first tests: `specific` — policy `{quorumType:'specific', specificApprovers:['userA'], requiredApprovals:1}`; `userB` approves → pending (today: approved); `userA` approves → approved; `castVote` by `userB` rejected. `all` — two approvers at creation, a third added before voting; the original two approve → still pending (today: approved); the third approves → approved; one approver removed → resolves with the remaining set. Existing quorum tests stay green.
Verification: server gates. Rollback: revert.

## Phase 2 — P1: an untouched masked proxy password must not be persisted

Root cause (verified): GET masks with the literal `'********'` (`nodeConfig.ts:217`); PUT accepts `proxyPassword` (`:65`) and `buildProxyData` (`nodeConfigData.ts:174-182`) persists `encryptedOrNull(input.proxyPassword)` — the mask is encrypted, or the password nulled when omitted. The web UI round-trips the masked value (`CustomProxyControls.tsx:131-132`).
Contract: in the update path, when `proxyPassword` is the mask sentinel or `undefined`, keep the stored encrypted value; only an explicit new string replaces it and only explicit `null`/empty clears it (define the clearing semantics from the existing frontend behaviour — `event.target.value || undefined` means "cleared" arrives as `undefined`, so clearing needs an explicit affordance; do not invent one silently — keep `undefined` as unchanged and document that clearing requires the proxy to be disabled/re-saved with a new password, unless the UI already has a clear action).
Failing-first tests: PUT with a real password, then PUT with `'********'` plus an unrelated change → stored password unchanged (today: becomes the mask); PUT omitting `proxyPassword` → unchanged; PUT with a new string → replaced. Route-level supertest through `nodeConfig.ts`.
Verification: server gates. Rollback: revert (no schema change).

## Phase 3 — P1: the gateway permission check must fail closed on a hung backend

Root cause (verified): `mobilePermission.ts:80-91` `fetch()` has no `signal`; `deviceTokens.ts:35,72` use `AbortSignal.timeout(config.backendRequestTimeoutMs)`.
Contract: add the same timeout; on abort, log and deny (the existing fail-closed branch).
Failing-first tests: a never-resolving `fetch` mock → the middleware rejects within the configured timeout (today: hangs); a normal response path unchanged.
Verification: gateway tests + lint/typecheck for the gateway package. Rollback: revert.

Status: done. Fixed `mobile-permission-check-fetch-no-timeout` by passing `signal: AbortSignal.timeout(config.backendRequestTimeoutMs)` to the `fetch()` in `checkPermissionWithBackend`; the existing catch already fails closed (403, logged) on abort. Non-regression tests added in `gateway/tests/unit/middleware/mobilePermission.test.ts`.

## Phase 3b — P1: Trezor coin selection parses the BIP44 coin type

Root cause (verified): `trezorAdapter.ts:103-105` `getCoinForPath` returns `'Testnet'` when the path contains `/1'/` or `/1h/`, so a mainnet path with account index 1 (`m/84'/0'/1'/0/0`) is misclassified; used by `getXpub` (`:344`) and `verifyAddress` (`:404`). `bitbox/pathUtils.ts` parses `coinType` correctly; `trezor/pathUtils.ts` has no parser.
Contract: derive the coin from the coin-type segment (second hardened index) — `1` → `'Testnet'`, `0` → `'Bitcoin'`, anything else rejected. Do not extract a new parser from BitBox's `getCoin` (it returns BitBox-API `constants.messages.BTCCoin` values, not `'Bitcoin'`/`'Testnet'` strings, so it is not directly reusable here) — `src/services/hardwareWallet/pathUtils.ts` already exports `isTestnetPath(path)`, built on the same `parseDerivationPath(path).coinType` field and already consumed by `ledgerAdapter.ts:22` and `bitbox/bitboxAdapter.ts:9,287`/`bitbox/signPsbt.ts:12,250`; `getCoinForPath` should call `isTestnetPath` directly (`isTestnetPath(path) ? 'Testnet' : 'Bitcoin'`) instead of building a new shared parser. The same substring heuristic lives in the signing path, `trezor/signPsbtNetwork.ts:26` (`updateNetworkFromPath`: `/1'/` → testnet, `/0'/` → keep); replace it with the same `isTestnetPath` call so a mainnet account-1 input path cannot flip signing-network detection, and keep the existing precedence of `validated.network` where it applies.
Failing-first tests: `getXpub("m/84'/0'/1'/0/0")` passes `coin: 'Bitcoin'` to `TrezorConnect.getPublicKey` (today `'Testnet'`); `m/84'/1'/0'/0/0` → `'Testnet'`; `verifyAddress` likewise; `updateNetworkFromPath("m/84'/0'/1'/0/0")` does not set `isTestnet` (today it does); malformed path rejected.
Verification: frontend gates. Rollback: revert.

## Phase 4 — P2: a TOTP code is single-use

Root cause (verified): `twoFactorService.ts:50-66` is stateless; no consumed-step persistence exists in `schema.prisma`.
Contract: persist the last accepted time step per user — additive nullable `twoFactorLastUsedStep Int?` next to `twoFactorSecret` on `User` (`schema.prisma:35-37`) via a new Prisma migration; `verifyToken` callers (`/2fa/verify`, `/2fa/disable`, `/2fa/backup-codes/regenerate`, login) reject a code whose step is ≤ the stored step, and store the accepted step atomically with the successful verification (compare-and-swap so two concurrent submissions of the same code cannot both pass). Backup codes are already CAS-consumed — unchanged.
Migration/rollback: additive nullable column; rollback = drop column; no backfill.
Failing-first tests: same valid code accepted twice today → second rejected; a later step accepted; concurrent duplicate submissions → exactly one succeeds (integration test against real PostgreSQL, added to a group in `backend-integration-groups.sh`).
Verification: server gates + the integration spec + `--check`.

## Phase 5 — P2: recalculate requires edit access

Contract: `requireWalletAccess('edit')` at `recalculate.ts:23`. Failing-first test: a view-only share gets 403 (today 200). Verification: server gates. Rollback: revert.

## Phase 6 — P2: PATCH autopilot/telegram merges onto stored settings

Root cause (verified): `autopilot.ts:38-43` merges onto `DEFAULT_AUTOPILOT_SETTINGS`; `telegram.ts:57-65` uses `?? default`.
Contract: read the stored settings first and merge the compacted body onto them; when nothing is stored, fall back to defaults as today.
Failing-first tests: store `{enabled:true, minDustCount:7}`, PATCH `{notifyPush:false}` → `minDustCount` stays 7 (today: reset); same shape for telegram. Verification: server gates. Rollback: revert.

## Phase 7 — P2: gateway push registration accepts `deviceName: null`

Contract: `.nullable()` on `deviceName` in `MobilePushRegisterRequestSchema` (matching `server/src/api/push.ts:51`). Failing-first test: schema parse of `{..., deviceName: null}` succeeds (today fails); a contract test that the gateway and backend schemas accept the same shapes. Verification: shared + gateway tests. Rollback: revert.

## Phase 8 — P2: integration-DB entry points refuse non-test targets

Root cause (verified): `prepare-integration-db.sh`, `check-integration-db.mjs:42`, `server/tests/integration/repositories/setup/database.ts:9,17` resolve `TEST_DATABASE_URL || DATABASE_URL` with no target guard; only the root `scripts/run-integration-tests.sh` provisions its own compose Postgres.
Contract: one shared guard (a small script/module both the CI helper and the vitest setup call) that accepts a URL only when its host is `localhost`/`127.0.0.1`/the compose service name, or when `SANCTUARY_ALLOW_INTEGRATION_DB_TARGET=1` is set explicitly. Refuse with a clear message otherwise. `run-integration-tests.sh` unchanged — it always builds `TEST_DATABASE_URL` against `localhost` (`scripts/integration-test-defaults.sh:24`, `scripts/run-integration-tests.sh:137`), so it passes the guard unmodified. **CI's `test.yml` lane does not**: `scripts/ci/resolve-postgres-service.sh` (`published_host()`, `is_containerized_runner`) resolves `DATABASE_URL` on a containerized runner to the DinD default-route gateway IP or a `getent`-resolved `postgres` alias IP — never `localhost`/`127.0.0.1`, and not a static "compose service name" string the guard could allowlist. `SANCTUARY_ALLOW_INTEGRATION_DB_TARGET` does not exist anywhere in the repo today (verified via repo-wide grep); nothing currently sets it. The guard as scoped (`scripts/ci/prepare-integration-db.sh`, `scripts/ci/check-integration-db.mjs`, `server/tests/integration/repositories/setup/database.ts`) will refuse CI's real integration DB target unless this phase also exports `SANCTUARY_ALLOW_INTEGRATION_DB_TARGET=1` from `scripts/ci/resolve-postgres-service.sh` (or the `test.yml` steps that call it) before the guarded helpers run — add that file to the phase boundary.
Failing-first tests: `tests/ci/*.test.sh` / node test for the guard: a `postgres://prod-host/...` URL is refused (today accepted); localhost accepted; the opt-in env accepted; a CI run exercising `resolve-postgres-service.sh` still resolves and passes the guard (add or extend a `tests/ci` case covering the gateway-IP host, not just localhost). Verification: server gates, `tests/ci` scripts, `--check`. Rollback: revert.

## Phase 9 — P2: an RBF that cannot raise the absolute fee is refused

Root cause (verified): `rbf.ts:352` early-returns when `feeDelta <= 0`; the caller returns `fee: newFee`, negative `feeDelta`, and a fee policy built from `newFee` while the outputs still pay `oldFee`.
Contract: when `feeDelta <= 0`, throw with a BIP-125 rule-3 message (`New fee must exceed the original fee by at least …`); no silent return. Mutation map: `rbf.ts` is in the `serverFeePolicy` profile (per-file floor 75) with one pinned invariant `rbf-input-policy-drives-exact-weight` at lines 208–218; `adjustChangeOutputForFeeDelta` (~:346) is below it, so an in-place change shifts nothing — do not add lines above 218. Prove with `test:mutation:fee-policy` + `check-wallet-safety-mutation-map.mjs` (serverFeePolicy profile) before pushing.
Failing-first tests: `feeDelta = -50` path throws (today returns inconsistent fee); positive path unchanged. Verification: server gates + fee-policy stryker + map checker. Rollback: revert.

## Phase 10 — P2: hex PSBT imports validate the PSBT magic

Contract: `hexTextToBytes` rejects odd-length hex; both hex import sites check `hasPsbtMagicBytes` after decoding and raise the same invalid-format error the base64/binary branches raise.
Failing-first tests: `deadbeef` and odd-length hex through `draftListHelpers` and `psbtFileImport` → rejected (today accepted); a real hex PSBT still imports. Verification: frontend gates. Rollback: revert.

## Phase 11 — P2: removing an output keeps the QR scanner on the intended output

Contract: `REMOVE_OUTPUT` sets `scanningOutputIndex` to `null` when it equals the removed index and decrements it when greater.
Failing-first test: reducer with 3 outputs, `scanningOutputIndex: 2`, remove index 0 → `1` (today stays 2); remove the scanning index → `null`. Verification: frontend gates. Rollback: revert.

## Phase 12 — P2: hardware-wallet connect lifecycle — cancellation races and handle leaks (service, Ledger, BitBox, Jade)

Contract: a monotonic attempt token in `HardwareWalletService`; `disconnect()` bumps it; `connect()` captures it before `await adapter.connect(...)` and, if it changed afterwards, disconnects the resolved adapter and throws a cancelled error instead of committing. The same shape independently inside `LedgerAdapter` (`ledgerAdapter.ts` connect ~:190-272 assigns `connection`/`connectedDevice` after several awaits; `disconnect()` ~:277-287 no-ops on null): a per-attempt generation token, close the transport and throw cancelled when `disconnect()` bumped it. BitBox (`bitbox-connect-partial-failure-leaks-hid-handle`, `bitboxAdapter.ts` connect ~:170-256): `api.close()` runs only in three explicit branches (:215,:219,:234); the outer catch (:253-255) rethrows without closing, so a `readRootFingerprint`/`api.connect` failure leaks the exclusive WebHID handle — wrap the body after `new BitBox02API(...)` so every failure closes the handle before rethrowing. Jade (`jade-adapter-overlapping-connect-cross-contaminates-cleanup`, `jade.ts` connect ~:151-201, `closeTransport` :279-287): the catch releases instance-global port/reader/writer, so an overlapping attempt's failure tears down another attempt's transport — capture the resources per attempt (or a generation token) and close only what the attempt opened; reject a `connect()` while one is in flight.
Failing-first tests: service — race `connect()` against `disconnect()` with a manually resolved adapter mock → `isConnected()` false and the adapter's `disconnect` called (today: committed); Ledger — start `connect()` with a deferred transport mock, `disconnect()` before resolving, resolve → `isConnected()` false and the transport closed (today: connected); BitBox — `readRootFingerprint` throwing and `api.connect` rejecting each assert `api.close()` (today not called); Jade — two overlapping `connect()` calls where the first fails after the second assigned the port → the second's port stays open (today closed); normal paths unchanged. Verification: frontend gates. Rollback: revert.

## Phase 13 — P2: the label-create form reopens clean

Contract: `createMutation.reset()` in `cancelCreate`, the Escape path, the click-outside handler and the opener. Failing-first test: reject once, cancel, reopen → no `ErrorAlert` (today shown). Verification: frontend gates. Rollback: revert.

## Phase 14 — P2: server CRUD failures in the network connection card are shown

Contract: a `serverActionError` state set in every catch of `useNetworkConnectionCardController` (add/update/delete/toggle/reorder), cleared at the start of each action, rendered in the card with the existing inline-error idiom; success paths unchanged (render-regression baselines capture non-error states).
Failing-first tests: reject `adminApi.addElectrumServer` → the error renders (today nothing); same for update/delete. Verification: frontend gates. Rollback: revert.

## Final verification (after all phases merge)

Backend: `cd server && npx tsc --noEmit && npm run typecheck:tests && npx vitest run --coverage tests/unit`; the integration lane (root `npm run test:integration`) including the new TOTP spec; `bash scripts/ci/backend-integration-groups.sh --check`; fee-policy stryker + mutation-map checker for Phase 9.
Frontend: `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run && npm run test:coverage`.
Both: `node scripts/quality/check-large-files.mjs`, lizard at 86, `npm run arch:check`, lint. Then a fresh full-scope scrub at the resulting SHA decides termination.

## Delivery, cleanup, deployment

One PR per phase; serial merges; branch deletion only after ancestry + zero-content-diff. `rebuild_policy: defer`. At the clean pass, `containersRunningAtStart` is `true`, so the final policy rebuilds the running stack via `./start.sh --rebuild` after the owner confirms.

## Completion criteria

All 19 findings resolved with merged, target-CI-verified PRs and regression tests proven red against `origin/main`; P3 backlog preserved; a fresh scrub at the resulting SHA with zero P0–P2 findings — or a clear statement of what remains.
