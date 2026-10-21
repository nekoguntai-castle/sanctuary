# Bug-scrub loop 20261013 — iteration 11 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 11
- **Source SHA:** `f793fbb90f223d104089e48f2740e15730b72768` (`main`, after #1410)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (2 × P1, 9 × P2; eleven).** The ten scrub findings were re-verified from source at `f793fbb90f`
  (file:line below); the eleventh, A2, was added from SQ-1 and coordinator-verified.
  **None is rejected.** The P3 `advanced-tx--fee-math-from-unauthenticated-prevouts` is **folded into A1** (same
  defect class, same fix, its own red tests, D-11.2). Every other P3 from this scrub (42 iteration-11 findings minus the
  ten scrub blockers and the folded fee-math P3, including `client-broadcast--30s-timeout…`) is backlog in run state and is
  **outside this fix set**.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `rbf-create--replacement-outputs-from-unauthenticated-electrum-bytes` (+ folded P3 `advanced-tx--fee-math-from-unauthenticated-prevouts`) | P1 (+P3) |
| A2 | `legacy-send--raw-tx-helper-returns-decoded-object` (added from SQ-1; coordinator-verified, recorded in run state) | **P1** |
| B1 | `two-factor-setup--manual-secret-is-ciphertext` | P2 |
| C1 | `price-health--unauthenticated-live-provider-probe` | P2 |
| D1 | `admin-restore--client-30s-timeout-reports-failure-of-committing-restore` | P2 |
| E1 | `electrum-test--bypasses-configured-tor-proxy` | P2 |
| F1 | `create-wallet--shared-signer-rejected-device-not-found` | P2 |
| G1 | `install-unit-tests--run-test-swallows-non-final-assertions` | P2 |
| G2 | `ci-install-test--migrate-entrypoint-not-classified` | P2 |
| G3 | `ci-classifier--render-lane-blind-to-shared-e2e-helpers` | P2 |
| G4 | `ci-classifier--quality-suite-subjects-outside-trigger` | P2 |

## Open questions

- **Product policy: none.** Every direction below is either the coordinator's decision (plan11-decisions) or a
  refinement recorded as a D-11.x decision. No product policy is invented.
- **SQ-1 — RESOLVED by the coordinator: accepted as A2, severity P1** (a core send flow cannot complete for legacy wallets; recorded as finding `legacy-send--raw-tx-helper-returns-decoded-object`). A2 is part of the fix set and is not droppable; the original question text follows for the record.
  Found while re-verifying A1's "other `getTransaction` callers that feed signing" (coordinator instruction).
  `server/src/services/bitcoin/transactions/helpers.ts:26-31` `getRawTransactionHex` returns
  `client.getTransaction(txid, false)` typed as a hex `string`, but every real node client returns the decoded
  `TransactionDetails` object: `ElectrumClient.getTransaction` ignores `verbose` (`electrum/electrumClient.ts:671-672`)
  and `electrum/methods.ts:268-277` always runs `decodeRawTransaction` (`:121-166`); `PooledNodeClient` forwards to it
  (`pooledNodeClient.ts:114-115`). `psbtConstruction.ts:211-226` `fetchRawTransactionsForLegacy` then calls
  `Buffer.from(<object>, 'hex')`, which throws `TypeError: The first argument must be of type string …` (checked with
  `node -e`). Callers: `createTransaction.ts:150-152` and `createBatchTransaction.ts:143-145`, both only for
  `isLegacy`. So creating any send from a legacy (P2PKH) wallet fails with a 500, and the bytes are also never
  txid-checked. Tests miss it because their node mocks return a raw hex string
  (`server/tests/unit/services/bitcoin/transactionService.test.ts:42`,
  `transactionServiceCreate/transactionServiceCreateTestHarness.ts:116`,
  `transactionServiceBroadcast/transactionServiceBroadcastTestHarness.ts:50`,
  `server/tests/integration/flows/payjoin/payjoinIntegrationTestHarness.ts:27`), which the real client never does.
  (Pass-1 correction: of these, only `transactionServiceCreateTestHarness.ts:116` reaches a legacy create; the other
  three never do and are not A2's. The legacy-path sites A2 actually breaks are listed under Phase A2.)
  **Default if the coordinator does not answer before cutting worktrees:** A2 is implemented on its own stacked branch
  (D-11.4) so it can be dropped without touching A1; if declined, the coordinator records it as a new P2 in run state
  and A2 is not cherry-picked. It is not counted in the ten blocking findings either way.

## Goal and non-goals

**Goal:** fix every blocking finding (2 × P1, 9 × P2; eleven, including A2 from SQ-1), plus the folded fee-math
P3, each with a non-regression test that fails on `f793fbb90f` and passes after the fix, delivered in one protected PR
with green CI.

**Non-goals:** the P3 backlog (above); new Prisma migrations or `schema.prisma` edits (RC10 migration-tree digest);
branch-protection changes; OpenAPI response-shape changes (none are needed: B1 keeps the `secret` key, C1 keeps the
`{ healthy, providers }` shape, E1's `/node/test` keeps `{ success, message, serverInfo? }`,
`schemas/bitcoin.ts:835-846`); new API endpoints (so **no e2e mock-map edits**: the thirteen `unhandledRequests`
sites found by grepping `transactions/balance-history` stay untouched); authenticating the advisory early-return
reads of `canReplaceTransaction` (confirmed/no-hex/non-RBF, D-11.2); server-side abort of a running restore
(`restoreFromBackup` takes no signal, residual D-11.9); testing an *unsaved* proxy form (the test body has no proxy
fields, D-11.11); routing `src/types/*` into the render lane (type-only imports, D-11.17); a broader
`scripts/quality/*` or `scripts/ops/*` classifier glob (D-11.18).

## Decisions

Coordinator directions (plan11-decisions) are followed as written except where a numbered decision refines them.

- **D-11.1 (A1) reuse the existing authenticated parser, no new txid logic.** `server/src/services/bitcoin/rawTransactionEvidence.ts`
  already has the fail-closed, typed primitives: `parseAuthenticatedRawTransaction({ expectedTxid, rawHex })`
  (`:253-280`: hex syntax, canonical re-encoding, `getId() === expectedTxid`, weight cap) and
  `authenticateRawTransactionOutput({ expectedTxid, rawHex, vout })` (`:282-317`: plus `missing_output`), both throwing
  `RawTransactionEvidenceError` with a static message and an enumerable `reason` (`:51-59`; `txid_mismatch`,
  `malformed_raw_transaction`, `non_canonical_raw_transaction`, `missing_output`, …). A1 adds one thin module
  `server/src/services/bitcoin/advancedTx/nodeTransactionAuthentication.ts` (new) with three functions:
  `authenticateNodeTransaction(txid, details)` (pure: reads `details.hex` only if it is a string, else `''`, and returns
  `parseAuthenticatedRawTransaction(...)`), `fetchAuthenticatedTransaction(client, txid)` (one `client.getTransaction(txid)`
  call, then the pure function) and `fetchAuthenticatedPrevout(client, txid, vout)` (one call, then
  `authenticateRawTransactionOutput`, returning `{ valueSats: number, scriptPubKeyHex, canonicalHex }`; `valueSats` is
  `Number(bigint)`, always a safe integer below 21e14). Values, scripts and legacy `nonWitnessUtxo` bytes are then read
  from the authenticated `bitcoin.Transaction`, never from the client's decoded `vout` projection. One call per fetch
  keeps every existing `getTransaction` call-count assertion valid (e.g. `advancedTx.rbf-creation.contracts.ts:176-183`).
  `nodeTransactionAuthentication.ts` imports only `../rawTransactionEvidence` plus `import type` from `../nodeClient`,
  **never `./shared`** (so A2's direct import of it, D-11.4, adds no runtime cycle).
  `rawTransactionEvidence.ts` is imported, **not edited** (it is the `serverReceiveEvidence` mutation profile,
  `config/wallet-safety-mutation-map.json` `rawTransactionEvidence.ts minScore 90`). The module is re-exported from
  `advancedTx/shared.ts` so the three call-site files extend an existing `./shared` import line (D-11.3); it is **not**
  added to `advancedTx/index.ts` (the barrel is mocked wholesale by `server/tests/unit/api/bitcoin/bitcoinTestHarness.ts`
  and `server/tests/unit/services/autopilot/feeMonitor.test.ts`). No identifier starts with `sign`, `finalize` or
  `broadcast` (`scripts/generate-signer-inventory.mjs:27,551-553` sweeps `server/src/services/bitcoin`).
- **D-11.2 (A1) where authentication is required; the folded P3.** Unauthenticated bytes may only ever cause a
  *refusal*, never a positive result or a signable PSBT. So: (a) `canReplaceTransaction` keeps its early-return checks on
  the fetched original (`rbf.ts:79-113`: DB/address-history confirmation, missing hex, non-RBF signal); these can only
  return `replaceable: false`. Its fee computation authenticates: `rbf.ts:116` parses the already-fetched hex through
  `authenticateNodeTransaction(txid, txDetails)` (no second fetch), and the prevout loop `:121-126` uses
  `fetchAuthenticatedPrevout`. A `RawTransactionEvidenceError` there lands in the existing catch (`:145-151`) as
  `{ replaceable: false, upstreamError: true, reason: <static message> }`, so `createRBFTransaction` throws a plain
  `Error` (500, `:190-192`), consistent with other node faults. (b) `createRBFTransaction`'s own original fetch
  (`:204-205`) uses `fetchAuthenticatedTransaction`, so a server that serves the genuine tx to the check and a forgery
  to the create is also refused (the error propagates uncaught: a typed `RawTransactionEvidenceError`, 500).
  (c) `collectRbfInputs` (`:317-337`) uses `fetchAuthenticatedPrevout` for value, script and the legacy raw-tx cache.
  (d) CPFP: the parent fetch (`cpfp.ts:107-108`, reused at `:165` and for the legacy cache at `:226`) uses
  `fetchAuthenticatedTransaction`, and the parent prevout loop (`:167-172`) uses `fetchAuthenticatedPrevout`; this is
  the folded P3 (`parentFee` and therefore `childFee`/fee policy at `:175-190,251-255` come only from authenticated
  values). (e) Advanced batch legacy cache (`batch.ts:189-196`) uses `fetchAuthenticatedTransaction(...).canonicalHex`.
  With the original authenticated by txid, the replacement's recipient outputs are the original's by construction
  (txid commits to outputs), so no separate output comparison is added. `signingIntent/prevoutValidation.ts:183-215`
  `assertAuthenticatedReplacement` (inputs + RBF signal only) and the sync path (`sync/evidenceAuthentication.ts:228-277`)
  already authenticate and are unchanged.
- **D-11.3 (A1) funds-path pins: line-neutral edits, mandatory re-pin otherwise.** Pinned ranges in the touched files:
  `config/wallet-safety-mutation-map.json` `serverFeePolicy` invariants `advanced-batch-change-and-fee-selection`
  (`batch.ts` 151-170, canaries 151:31-170:6 and 167:26-167:48), `advanced-batch-pinned-selection-spends-full-set`
  (`batch.ts` 259-279, canary 271:41-273:4), `cpfp-package-fee-is-conserved` (`cpfp.ts` 56-64, canary 60:20-60:40),
  `rbf-input-policy-drives-exact-weight` (`rbf.ts` 232-242, canary 232:54-242:4); and
  `server/stryker.fee-policy.config.mjs:13-16` mutate ranges `batch.ts:120-178`, `batch.ts:259-279`, `cpfp.ts:38-70`,
  `rbf.ts:232-242`. None of `rbf.ts`, `cpfp.ts`, `batch.ts`, `transactions/helpers.ts` is in a critical mutation shard
  (`server/scripts/mutation/shards.mjs` lists none of them; `stryker.critical.config.mjs` derives from it). The A worker
  keeps every edit **line-neutral above each pinned range**: imports extend the existing `./shared` import lines
  (`rbf.ts:20`, `cpfp.ts:18`, `batch.ts:17`; no new import line); `rbf.ts:116` is a one-for-one line replacement;
  `rbf.ts:123-125` (3 lines) stays 3 lines (fetch, one explanatory comment naming the folded P3, accumulate);
  `rbf.ts:204-205` (2 lines) stays 2 lines (one explanatory comment, the authenticated fetch); `batch.ts:192-193` stays
  2 lines; `cpfp.ts` edits are all below `:70`. Edits below the last pinned line of a file (`rbf.ts` ≥ 243,
  `batch.ts` ≥ 280) are free. **If any pinned range moves anyway**, the worker shifts both the map (targeted text edit,
  never `json.dump`) and the stryker range by the same delta. Either way, because A1 rewrites fixtures in the suites
  that hold the named killing tests (and A2 rewrites fixtures in two fee-policy `testFiles`, Phase A2), the integrator
  runs the fee-policy profile on the integrated branch **after A2 is cherry-picked** and the scoped checker
  (Verification) and confirms every `serverFeePolicy` canary is present and `Killed` by its named test. The named tests
  (`advancedTx.test.ts` → "Advanced Transaction Features RBF Transaction Creation should create an RBF replacement PSBT
  when a wallet change output exists", "… CPFP Fee Calculation should calculate correct child fee for target package
  rate", "… Batch transactions creates a batch PSBT with recipients and change", "… accepts exact no-change coverage
  after adding the final input", "… spends the entire pinned batch UTXO set even when the first UTXO alone covers the
  outputs") keep their exact names and describe nesting.
- **D-11.4 (A2, SQ-1 accepted) stacked branch.** `getRawTransactionHex(txid, network)` keeps its signature
  and returns `(await fetchAuthenticatedTransaction(client, txid)).canonicalHex`. A2 needs A1's module, so its branch
  `codex/bug-scrub-loop/20261013-i11-a2` is cut from the A1 branch head after A1 commits; the integrator cherry-picks A1
  then A2. `transactions/helpers.ts` imports `fetchAuthenticatedTransaction` **directly from
  `../advancedTx/nodeTransactionAuthentication`**, not from `../advancedTx/shared` (helpers → shared → `../estimation` →
  `transactions/psbtConstruction` → `./helpers` would be a new runtime cycle) nor from the `../advancedTx` barrel
  (rbf → psbtConstruction → helpers); `check:server-cycle-baseline` admits only the two existing walletImport cycle
  sets. A2 owns only `transactions/helpers.ts`, its new test, and the legacy-path test sites it breaks (Phase A2
  ownership row).
- **D-11.5 (B1) explicit names in the service, unchanged response.** `generateSecret` returns
  `{ manualEntrySecret, encryptedSecret, qrCodeDataUrl }` (`manualEntrySecret` = the base32 secret encoded in the QR's
  otpauth URI; `encryptedSecret` = `encrypt(plaintext)`), so a caller that destructures the old `secret` fails to
  compile instead of silently storing or returning the wrong one. `/2fa/setup` stores `encryptedSecret` and responds
  `{ secret: manualEntrySecret, qrCodeDataUrl }` (response key and `TwoFactorSetupResponse`, `schemas/auth.ts:191-198`,
  unchanged; `openapi.gateway.contracts.ts:396` keeps passing). The response goes only to the authenticated user
  starting their own setup (`setup.ts:28-29`); the audit entry logs only `{ userId }` (`:45-48`) and no middleware logs
  response bodies (`server/src/middleware/requestLogger.ts`), so the plaintext is never logged. Stored secrets keep the
  same ciphertext format; a setup started before deploy still enables.
- **D-11.6 (C1) stay public, serve cached health with single-flight refresh.** No client needs a live probe:
  `src/api/price.ts:211-212` `checkProviderHealth` has no consumer in `src/`, and no gateway, e2e or monitoring caller
  exists (grep). The least surprising fix keeps the documented public route (`openapi/paths/bitcoinPrice.ts:233-246`,
  no security) and stops the per-request fan-out: `ProviderRegistry` (`server/src/providers/registry.ts`) gains (a) a
  per-provider in-flight map so concurrent `checkProviderHealth` calls (`:376-401`) share one `provider.healthCheck()`
  (cleared in `finally`, and on `unregister`/`shutdown`), and (b) a public `getCachedHealth()` that resolves each
  provider through the existing TTL cache `isProviderHealthy` (`:414-427`; price registry TTL 30 s,
  `services/price/providers/index.ts:46-49`) and builds the same `RegistryHealthSummary` (`lastCheck` = the cache
  timestamp). `PriceService.healthCheck` (`services/price/index.ts:736-753`) calls `getCachedHealth()` instead of
  `getHealth()` (`registry.ts:309-347`, the live probe, kept for its other caller `services/push/pushService.ts:379`).
  Bound: at most one upstream call per provider per 30 s regardless of request volume. Requiring authentication was
  rejected: it would change a documented public contract for no client benefit. The single-flight in
  `checkProviderHealth` also applies to the push registry and to the periodic `checkAllHealth` (benign: fewer duplicate
  probes).
- **D-11.7 (D1) timeout above the server budget, not equal to it.** The server answers a timed-out restore with **408**
  at 120 s (`server/src/middleware/requestTimeout.ts:33-34,113-114`), and validation + restore can both run under that
  budget. A client timeout of exactly 120 s would race the server's answer, so `src/api/admin/backup.ts` exports
  `ADMIN_RESTORE_TIMEOUT_MS = 150_000` and passes `{ timeoutMs: ADMIN_RESTORE_TIMEOUT_MS }` to both `validateBackup`
  (`:62-64`) and `restoreBackup` (`:71-76`). `src/api/client.ts` (963 lines; a hardware-proof source,
  `config/hardware-emulator-source-inventory.json` "common") is **not** edited: `post` already forwards `timeoutMs`
  (`client.ts:734-759`), and `FILE_TRANSFER_TIMEOUT_MS` stays private.
- **D-11.8 (D1) an unknown outcome never invites a second restore.** A new pure helper
  `src/components/BackupRestore/hooks/restoreOutcome.ts` exports `isRestoreOutcomeUnknown(error)` =
  `error instanceof ApiError && (error.status === 0 || error.status === 408)` (`ApiError` from `src/api/client.ts:487`;
  status 0 is how the client reports aborts/network failures, `client.ts:196-204`) and `RESTORE_OUTCOME_UNKNOWN_MESSAGE`
  ("The restore did not report back in time. The server may still be restoring and may already have replaced your data.
  Do not start another restore: wait a few minutes, reload this page and check your data first."). In
  `useBackupHandlers.ts` `handleRestore`'s catch (`:255-257`), an unknown outcome clears the uploaded backup, file name
  and validation result (so the Restore button, `RestorePanel/RestoreActionButton.tsx:19`, is gone and a re-run needs a
  fresh upload and a new RESTORE confirmation) and then sets that message; every other error keeps today's behaviour.
  The button is already disabled while `isRestoring` (`RestoreActionButton.tsx:19-23`).
- **D-11.9 (D1) residual.** If the server's own 120 s budget expires after the transaction has committed, the 408 can
  still arrive for a committed restore (`restoreFromBackup` ignores the request abort, `services/backupService/restore.ts`
  `:273-274` transaction timeout; only `creation.ts` honours a signal). D-11.8's message covers that case truthfully
  ("may already have replaced your data"). Server-side cancellation is out of scope (PR body).
- **D-11.10 (E1) one proxy source, resolved inside `testNodeConfig`.** New exported
  `resolveConfiguredElectrumProxy(): Promise<ProxyConfig | undefined>` in
  `services/bitcoin/electrum/connectionConfigResolver.ts`: `nodeConfigRepository.findDefault()` →
  `type === 'electrum' ? proxyConfigFromNodeConfig(row) : undefined` — the same projection runtime singletons use
  (`dbConnectionConfig`, `:168-185`, and `proxyConfigFromNodeConfig`, `:50-56` → `projectNodeProxyConfigDecrypted`,
  `proxyCredentials.ts:31-46`, which the pool also uses, `electrumPool/poolRegistry.ts:128-146,355-375`).
  `testNodeConfig` (`nodeClient.ts:380-411`) resolves it **inside its `try`** before constructing the client and passes
  `...(proxy?.enabled ? { proxy } : {})` to `ElectrumClient`. Resolving inside `testNodeConfig` keeps every caller
  unchanged (`adminElectrumServerService.ts:96-111,194-209`, `api/admin/nodeConfig.ts:311-333`); their
  `toHaveBeenCalledWith({host,port,protocol,network})` assertions stay valid. `NodeConfig` (`nodeClient.ts:50-57`) gains
  optional `allowSelfSignedCert?: boolean`, forwarded to `ElectrumClient` (`ElectrumConfig.allowSelfSignedCert`,
  `electrum/types.ts:259-268`), for the `/node/test` route below.
- **D-11.11 (E1) fail closed, never fall back to a direct dial; do not mark a server unhealthy for a proxy-config
  fault.** If resolution throws (`ProxyConfigurationError`, undecryptable stored password, `proxyCredentials.ts:37-45`),
  `testNodeConfig` returns `{ success: false, message, failureKind: 'proxy_configuration' }` without constructing a
  client. `testSavedElectrumServer` (`adminElectrumServerService.ts:194-209`) skips `updateHealth` when
  `failureKind === 'proxy_configuration'` and returns the failure, so a Tor-only server is not recorded unhealthy for a
  configuration fault. A reachable proxy that cannot reach the server is a real failure and is recorded as today. The
  test uses the **saved** proxy settings (the test body schemas carry no proxy fields; documented in the route
  description text only if it already describes the body, otherwise PR body only).
- **D-11.12 (E1) `/node/test` raw-socket route.** `server/src/api/node.ts:72-187` opens `net`/`tls` sockets directly.
  It is admin-only and has no `src/` consumer. When `resolveConfiguredElectrumProxy()` returns an enabled proxy, the
  route delegates to `testNodeConfig({ host, port, protocol, allowSelfSignedCert })` and maps the result to
  `{ success, message }` (schema-valid, `serverInfo` optional). The route calls `resolveConfiguredElectrumProxy()`
  itself, which throws `ProxyConfigurationError` for an undecryptable stored password (`proxyCredentials.ts:37-45`) and
  the handler (`node.ts:192-211`) has no `try`: a resolver throw is **never** caught into the raw-socket path; the route
  maps it to `{ success: false, message }` with no socket opened. With no proxy, the raw-socket path is unchanged, so
  `server/tests/unit/api/node.test.ts` (827 lines, mocks `net`/`tls`) keeps its cases. `node.ts` imports both functions
  from `services/bitcoin/nodeClient` (which re-exports the resolver), an existing `api → services` edge.
- **D-11.13 (F1) widen the existing repository query; keep its name.** `deviceRepository.findByIdsAndUserWithAccounts`
  (`repositories/deviceRepository.ts:777-785`, `where: { id: { in: ids }, userId }`) becomes
  `where: { id: { in: ids }, OR: [{ userId }, { users: { some: { userId } } }, sharedThroughGroupWhere(userId)] }`
  — the access rule of `findByUserIdWithModel` (`:109-126`; group helper `:104-106`), a superset of today's owner-only
  rule and of the `GET /devices` listing (`findAccessibleByUser`, `:643-648`). Its only callers are
  `walletCreate.ts:106-113` and `walletDevices.ts:144-148`. Name kept (doc comment updated to "accessible to the
  user") so the wallet unit harness (`server/tests/unit/services/wallet/walletTestHarness.ts:264-265`, which
  reimplements it owner-only over `mockPrismaClient`) needs no change. Policy: parity with import
  (`walletImport/deviceReuseAccess.ts:33-45`: any current device role may reuse an existing account). Creation and
  add-signer only bind existing accounts (no `DeviceAccount` create in `walletCreate.ts`/`walletDevices.ts`), so the
  owner-only "add an account" arm of the import rule does not arise. No new data exposure: the device's accounts and
  xpubs are already returned to that user by `GET /devices`. Wallet-derived device access
  (`repositories/accessControl.ts:63-82`) is not added (the listing does not offer those devices either).
- **D-11.14 (G1) assertion-failure counter, not subshell errexit.** Running each test in `( set -e; "$fn" )` was
  rejected: the four suites capture expected non-zero statuses with plain `out=$(cmd); rc=$?` and `set +e … set -e`
  blocks (e.g. `install-script.test.sh:2668-2686`), which errexit would abort, and reset-2fa test bodies call
  `teardown_fake_docker` at their end, which an aborted subshell would skip (leaked `mktemp -d`). Instead a new shared
  file `tests/install/utils/assertion-tracking.sh` defines `: "${INSTALL_TEST_ASSERTION_FAILURES:=0}"` (no reset on
  re-source), `install_test_record_assertion_failure` (increments) and `install_test_run_function fn` (records the
  counter, saves the caller's errexit state, runs `fn` as a plain statement with errexit off as base `run_test` does,
  captures `$?` immediately, sets `INSTALL_TEST_LAST_STATUS` non-zero if `fn` returned non-zero **or** the counter grew
  during the call and `0` otherwise, restores the caller's errexit state, and always returns 0). Every assertion helper's failure branch calls the recorder: the local helpers in
  `reset-user-2fa-script.test.sh:19-78` (4), `upgrade-helpers.test.sh:38-80` (3) and `install-script.test.sh:42-165`
  (8), and the generic helpers in `tests/install/utils/helpers.sh:1273-1390` (8; used by `e2e/fresh-install.test.sh`),
  each sourcing `assertion-tracking.sh`. Each of the four `run_test` bodies (`reset-user-2fa-script.test.sh:80-99`,
  `upgrade-helpers.test.sh:186-205`, `install-script.test.sh:171-190`, `e2e/fresh-install.test.sh:133-152`) replaces its
  `set +e; "$fn"; rc=$?; set -e` triple with exactly `install_test_run_function "$test_func"; local
  exit_code="$INSTALL_TEST_LAST_STATUS"`, a plain statement outside any `||`/`&&`/`if`/`!` context. Because the
  function always returns 0, the suites' `set -e` does not abort at a failing test (the summary and, in
  `upgrade-helpers.test.sh:196-197`, the teardown still run). The `|| exit_code=$?` form is rejected: bash ignores
  errexit for the whole call tree of a command on the left of `||`, and 27 test bodies re-enable `set -e`
  (`reset-user-2fa-script.test.sh:213,240`; `upgrade-helpers.test.sh` 12, e.g. `:1326,2469,2491,2690`;
  `install-script.test.sh` 10, e.g. `:2671-2683`; `e2e/fresh-install.test.sh` 1). On base a failing non-assertion
  command after such an in-body `set -e` aborts the suite non-zero; under `||` it is swallowed (probe
  `t(){ set +e; true; set -e; false; echo continued; true; }`: base-style suite exits 1, `t || rc=$?` prints
  `continued` with rc=0 and the suite exits 0). With the plain-statement form an in-body `set -e` stays fatal exactly
  as on base. Assertions run inside a `( … )` or `$( … )`
  subshell cannot reach the parent counter; such blocks exist (`upgrade-helpers.test.sh` 7, `install-script.test.sh`
  18 subshell openers) and the worker audits each one that contains an assertion helper, making the subshell's own exit
  status carry the failure (`|| exit 1` inside, checked outside). Suites that already guard every assertion are
  untouched.
- **D-11.15 (G1) unmasked failures.** The fix will surface assertions that fail today. Each is reported to the
  coordinator before being changed, classified as (a) a real product/script bug → new finding in run state, the test
  left red is not acceptable, so the G1 branch is held (D-11.21) until the coordinator decides, or (b) a stale or
  mis-specified assertion → fixed in G1 with a one-line justification in the commit body and the PR body.
- **D-11.16 (G2) migrate.sh is install scope and release surface.** `server/scripts/migrate.sh` is the CMD of the
  migration image (`server/Dockerfile:163`) and the `migrate` service command (`docker-compose.yml:632`) that every
  install and upgrade runs. It joins (1) `install-test.yml` push and pull_request `paths` (kept identical,
  `tests/install/unit/install-workflow-trigger-contract.test.mjs:47-48`); (2) `release-candidate.yml` pull_request
  `paths` (`:34-52`); (3) `classify-install-scope.sh`'s scope case beside `server/prisma/*` (`:566-571`; same
  fresh-install + upgrade-baseline scope, reason "Migration entrypoint or Prisma migration scope changed"); and (4) the
  release-surface case (`:478-486`), whose comment says it mirrors `release-candidate.yml`'s pull_request trigger, so a
  PR touching `migrate.sh` gets the bounded PR smoke (install-stack-smoke + one-ref upgrade baseline). No other
  install-path entrypoint is unclassified: `server/scripts/project-runtime-dependencies.cjs` and
  `check-runtime-prisma-deps.cjs` run only at image build (`server/Dockerfile:71-80,194`) and are covered by
  `**/Dockerfile` builds via `docker-build`; the other `server/scripts/*` are not run by install. CI-cost increase is
  accepted (PR body).
- **D-11.17 (G3) exact render inputs plus a drift guard.** The render harness (`tests/e2e/render-regression.spec.ts`,
  `tests/e2e/render-regression/*`) transitively imports, outside its own tree, exactly `tests/e2e/helpers.ts`,
  `tests/e2e/apiSimulator.ts`, `tests/e2e/fixtures/apiBaseline.ts`, `tests/e2e/fixtures/balanceHistory.ts` (computed at
  `f793fbb90f`) plus `src/themes/*` (already render) and type-only `src/types/*`/`src/api/transactions/types.ts`
  (not runtime; out of scope). `is_render_file` (`scripts/ci/classify-files-lib.sh:281-294`) gains those four exact
  paths, not a `tests/e2e/fixtures/*` glob, so `tests/e2e/fixtures/browserFixture.ts` (not imported by the harness)
  keeps `render_changed=false` (`tests/ci/classify-test-changes.test.sh:677-689` unchanged). A new root Vitest drift
  guard `tests/ci/renderHarnessInputsClassified.test.ts` walks the harness's relative imports (`.ts`/`.tsx`/`/index.ts`
  resolution; specifiers quoted with `'`, `"` or `` ` ``; it follows `import type`, `export … from` and dynamic
  `import()`, because `tests/e2e/helpers.ts:9` uses double quotes and `tests/e2e/apiSimulator.ts` is reachable only via
  `import type` from `tests/e2e/fixtures/apiBaseline.ts:1`; type-only reachability is excluded by path only, never by
  import kind) and asserts every reachable file outside `tests/e2e/render-regression*` and outside `src/types/**` and
  `src/api/**/types.ts` is matched by `is_render_file` (one `execFileSync('bash', ['-c', …])` that sources the lib),
  with an in-file allowlist (reason per entry; a stale entry fails). It must itself pass the F1 guard
  `tests/ci/vitestRepoInputsClassified.test.ts` (its only repo literal outside non-input trees is
  `scripts/ci/classify-files-lib.sh`, a full-scan trigger). POSIX `case` only (the lib is sourced under `sh`,
  `server/.husky/pre-commit:36`). Callers that pick it up with no edit: `classify-test-changes.sh:118,265`,
  `plan-test-run.sh:240`. **Residual (pass 1):** `tests/e2e/*` is excluded from `is_frontend_file`
  (`classify-files-lib.sh:17-19`) and `tests/` is a non-input tree for the F1 guard, so a PR that only adds a
  render-harness import of a new `tests/e2e` helper does not run the root Vitest lane holding this guard. A new
  unclassified render-harness import is caught by the scheduled full scan (as the F1 guard's residuals), not on the PR
  that adds it. The lane is not widened (PR body).
- **D-11.18 (G4) exact subjects, not globs.** `is_ci_classifier_file` (`scripts/ci/classify-quality-scope.sh:105-114`)
  gains exactly the subjects whose fail-closed regression suites run only in `ci-classifier-tests`
  (`quality.yml:619` gate; suites at `:903,904,921,935,938,954`): `scripts/quality.sh`,
  `scripts/quality/jscpd-only.sh`, `scripts/quality/lizard-only.sh`, `scripts/quality/check-lockfile-peer-resolution.sh`,
  `scripts/ops/sanctuary-backup.sh`, `scripts/ops/install-sanctuary-backup.sh`, `server/.husky/pre-commit` (seven), plus
  `scripts/quality/lockfile-peer-resolution-allowlist.txt` as a classifier subject only: it is not tracked (written into
  a temp tree by `check-lockfile-peer-resolution.test.sh:67`, read optionally by the script `:24`), so it is optional,
  untracked, and routed so creating it runs its suite; it is asserted only by the existing `:256-278` loop entry
  (`expected_classifier=true`), not by the static guard. `scripts/quality/lizard-requirements.txt`
  stays `false` (no suite reads it) and `scripts/ops/example.sh` keeps the lifecycle-only expectation
  (`classify-quality-scope.test.sh:282-295`). A static guard in `classify-quality-scope.test.sh` derives, for each of
  those six suites, the `scripts/quality*`/`scripts/ops/*`/`server/.husky/*` tokens it references, keeps only tokens
  that, after stripping trailing punctuation, are tracked regular files (`git ls-files --error-unmatch`; directory and
  other non-file tokens such as `scripts/quality`, `scripts/quality/` in `tests/ci/jscpd-only.test.sh:22-23` and
  `check-lockfile-peer-resolution.test.sh:2,19` are dropped), asserts each kept path classifies `classifier=true`, and
  asserts the derived set **equals** the seven tracked subjects above (so a new subject or a dropped subject both
  fail).
- **D-11.19 (cross-cutting) lizard headroom.** Pinned lizard 1.24.0
  (`/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard`) reports **84** warnings on `f793fbb90f`
  with the repo arguments (`scripts/quality.sh:21,284-311`: `-i 86 -C 15 -T nloc=200`, same excludes); the PR may add at
  most 2 and targets 0. `createCPFPTransaction` already warns (145 NLOC, CCN 20, `cpfp.ts:78`); A1 must not raise it to
  a second warning nor add branches (the helper calls add none). Every worker runs
  `lizard -C 15 -T nloc=200 <new/changed .ts/.tsx/.js/.mjs files>` and reports zero new warnings. New test helpers are
  top-level `function` declarations, CCN ≤ 15, NLOC ≤ 200; no regex literals in `for … of` headers (they confuse
  lizard's JS reader); do not hoist a nested `function` declaration out of a `describe` in the advancedTx contracts
  without re-measuring (a describe without one is counted as one function).
- **D-11.20 (Delivery) one worktree per phase.** As D-10.15: each phase gets its own worktree under `/home/nekoguntai`
  (never `/tmp`) on branch `codex/bug-scrub-loop/20261013-i11-<phase>` (`<phase>` ∈ `a1, a2, b, c, d, e, f, g1, g`),
  cut from the final reviewed plan commit (the integrator records its SHA; it differs from `f793fbb90f` only under
  `tasks/`), except `a2`, which is cut from the `a1` head (D-11.4). Setup: root `npm ci` + `cd server && npx prisma generate`
  + `npm run build --workspace=shared`, nvm node on `PATH`. Every commit goes through
  `flock /home/nekoguntai/.i11-commit.lock git commit …` in the foreground; never while a coverage or Stryker run is
  active; no `git stash`. The integrator alone runs coverage and Stryker, behind the bounded guard.
- **D-11.21 (Delivery) hold rules.** Only G1 may be held out of the PR without blocking the others, and only by
  coordinator decision (an unmasked real bug, D-11.15); A2 is not holdable (SQ-1 accepted). A held phase keeps its
  branch and worktree and its
  finding stays open in run state.

## Assumptions and constraints

- No migrations; integration specs are only extended through contract files registered by an already-registered spec
  (F1 adds `flows/wallet/shared-device-signers.contracts.ts`, registered by `flows/wallet.integration.test.ts`, which
  is listed at `scripts/ci/backend-integration-groups.sh:53`), so `backend-integration-groups.sh` needs no edit.
- Coverage: frontend 100% and backend `tests/unit` 100% (backend run scoped to `tests/unit`, as CI). `**/index.ts` is
  excluded from backend coverage (`server/vitest.config.ts:38`): the C1 change in `services/price/index.ts` is one call
  and is guarded only by the new service test; all new branches live in covered files (`providers/registry.ts`,
  `advancedTx/nodeTransactionAuthentication.ts`, `restoreOutcome.ts`, `connectionConfigResolver.ts`, `nodeClient.ts`,
  `adminElectrumServerService.ts`, `api/node.ts`).
- Large files (`scripts/quality/check-large-files.mjs`, limit 1,000 lines, `> 1000` fails):
  `server/tests/unit/services/bitcoin/advancedTx/advancedTx.rbf-creation.contracts.ts` is **at exactly 1,000**: its net
  growth must be ≤ 0 (new red cases go in a new contracts file; the fixture helper moves into the harness, D-A1);
  `server/tests/unit/api/node.test.ts` 827, `server/tests/unit/services/price.test.ts` 765 (not extended),
  `src/api/client.ts` 963 (not edited). Shell files are not scanned by the gate.
- Architecture: new server edges stay inside `services/bitcoin` (advancedTx → rawTransactionEvidence; A2's
  transactions/helpers → advancedTx/nodeTransactionAuthentication, direct, D-11.4; nodeClient →
  electrum/connectionConfigResolver) or reuse `api → services` (`api/node.ts → services/bitcoin/nodeClient`); the D1 hook
  imports `ApiError` from `src/api/client` like `src/components/Account/Account/twoFactorHelpers.ts:1`. The integrator
  still runs `npm run arch:graphs` and `npm run arch:calls` and commits `docs/architecture/generated` in the integrator
  commit before the Verification block, so `arch:check` is a pure check (the Architecture lane is not PR-required).
  `check:server-cycle-baseline` must stay green: `connectionConfigResolver` imports only config/repositories/shared/
  `./types`/`./proxyCredentials`, none of which imports `nodeClient`; `nodeTransactionAuthentication` imports only
  `../rawTransactionEvidence` and types from `../nodeClient` (D-11.1), so A2's direct edge closes no cycle.
- Wallet-safety classifier: A1/A2/E1 touch `server/src/services/bitcoin/**`
  (`config/wallet-safety-critical-paths.json:11`), so verify-vectors runs; only A1's three files are mutation-pinned
  (D-11.3). No hardware-proof source is touched (`src/api/client.ts`, `src/api/refresh.ts`, `shared/**` are avoided;
  `config/hardware-emulator-source-inventory.json`), so no emulator lane is expected; if one runs and flakes, record
  the four-part retrigger evidence (CLAUDE.md) before any second attempt.
- Signer inventory: no new identifier with prefix `sign`, `finalize` or `broadcast` (A1 names: `authenticateNodeTransaction`,
  `fetchAuthenticatedTransaction`, `fetchAuthenticatedPrevout`); `npm run verify:signer-inventory` in the block.
- CI classifier changes (G2–G4, G1) keep fail-closed behaviour: no predicate is removed or narrowed, the F1 drift guard
  `tests/ci/vitestRepoInputsClassified.test.ts` stays green over the final tree, `classify-files-lib.sh` still sources
  under POSIX `sh`, `assert_every_test_workflow_script_is_classified` (`classify-test-changes.test.sh:137-140`) is not
  weakened (G3 adds render predicates only).
- The pre-commit hook runs AI review agents and tests; commits are foreground, through the flock, never during a
  coverage/Stryker run.

### Phase file ownership (disjoint; one worktree and branch per phase)

| Phase | Owns |
|---|---|
| A1 | `server/src/services/bitcoin/advancedTx/{rbf,cpfp,batch,shared}.ts`, `server/src/services/bitcoin/advancedTx/nodeTransactionAuthentication.ts` (new), `server/tests/unit/services/bitcoin/advancedTx/*` (harness, the four contracts files, new `advancedTx.node-authentication.contracts.ts`), `server/tests/unit/services/bitcoin/advancedTx.test.ts`, `server/tests/unit/services/bitcoin/advancedTx.pubkeyBranch.test.ts`, `server/tests/unit/services/bitcoin/industry/rbfCpfpEdgeCases.test.ts`, `server/tests/unit/services/bitcoin/advancedTx/nodeTransactionAuthentication.test.ts` (new); `config/wallet-safety-mutation-map.json` and `server/stryker.fee-policy.config.mjs` **only if** a pinned range moves (D-11.3) |
| A2 (SQ-1) | `server/src/services/bitcoin/transactions/helpers.ts`, `server/tests/unit/services/bitcoin/transactionHelpers.legacyRawTx.test.ts` (new), the legacy-path test sites it breaks: `server/tests/unit/services/bitcoin/transactionServiceCreate/transactionServiceCreateTestHarness.ts`, `server/tests/unit/services/bitcoin/transactionServiceCreate/psbt-helpers-legacy.contracts.ts`, `server/tests/unit/services/bitcoin/transactionServiceBatch/transactionServiceBatch.create.contracts.ts` (the last two are registered by fee-policy Stryker `testFiles`) |
| B | `server/src/services/twoFactorService.ts`, `server/src/api/auth/twoFactor/setup.ts`, `server/tests/unit/services/twoFactorService.test.ts`, `server/tests/unit/api/auth2fa/{auth2faTestHarness.ts,auth2fa.setup-enable.contracts.ts}`, `server/tests/unit/api/authRegistration/authRegistrationTestHarness.ts` |
| C | `server/src/providers/registry.ts`, `server/src/services/price/index.ts`, `server/tests/unit/providers/registry.test.ts`, `server/tests/unit/services/price.health.test.ts` (new) |
| D | `src/api/admin/backup.ts`, `src/components/BackupRestore/hooks/{useBackupHandlers.ts,restoreOutcome.ts (new)}`, `tests/api/remainingAdminApiModules.test.ts`, `tests/components/BackupRestore/{useBackupHandlers.branches.test.tsx,restoreOutcome.test.ts (new)}` |
| E | `server/src/services/bitcoin/{nodeClient.ts,electrum/connectionConfigResolver.ts}`, `server/src/services/adminElectrumServerService.ts`, `server/src/api/node.ts`, `server/tests/unit/services/bitcoin/{nodeClient.test-node-config.contracts.ts,nodeClient.test.ts}`, `server/tests/unit/services/bitcoin/electrum/connectionConfigResolver.test.ts` (existing; resolver cases), `server/tests/unit/services/adminElectrumServerService.test.ts`, `server/tests/unit/api/node.test.ts`, `server/tests/unit/api/node.proxy.test.ts` (new) |
| F | `server/src/repositories/deviceRepository.ts`, `server/tests/unit/repositories/deviceRepository.test.ts`, `server/tests/integration/flows/wallet.integration.test.ts`, `server/tests/integration/flows/wallet/shared-device-signers.contracts.ts` (new) |
| G1 | `tests/install/utils/{assertion-tracking.sh (new),helpers.sh}`, `tests/install/unit/{reset-user-2fa-script,upgrade-helpers,install-script}.test.sh`, `tests/install/e2e/fresh-install.test.sh`, `tests/install/unit/install-assertion-tracking.test.sh` (new), `tests/install/run-all-tests.sh` (registers the new suite) |
| G (G2–G4) | `.github/workflows/{install-test,release-candidate}.yml`, `tests/install/utils/classify-install-scope.sh`, `tests/install/unit/{install-scope.test.sh,install-workflow-trigger-contract.test.mjs}`, `tests/ci/check-workflow-composition.test.sh`, `scripts/ci/classify-files-lib.sh`, `tests/ci/{classify-test-changes.test.sh,plan-test-run.test.sh,renderHarnessInputsClassified.test.ts (new)}`, `scripts/ci/classify-quality-scope.sh`, `tests/ci/classify-quality-scope.test.sh` |

**Integrator-owned (applied once):** `docs/reference/changelog.md` `## [Unreleased]` (workers hand over bullet text),
`docs/architecture/generated/*` (regenerated after all phases), `scripts/quality/large-file-classification.json` (only
if a classified file is touched; none is planned). G1 and G2 both live under `tests/install/` but own disjoint files;
G1's `helpers.sh` edit and G2's `classify-install-scope.sh` edit do not overlap.

---

## Phase A — advanced transactions (A1, A2)

### Phase A1 — Authenticate every Electrum transaction the advanced-tx builders use (P1 `rbf-create--replacement-outputs-from-unauthenticated-electrum-bytes`; folded P3 `advanced-tx--fee-math-from-unauthenticated-prevouts`)

**Evidence (re-verified at f793fbb90f).**
- `server/src/services/bitcoin/electrum/methods.ts:268-277` `getTransaction` requests `blockchain.transaction.get` and
  returns `decodeRawTransaction(rawTx)` (`:121-166`), whose `txid` is the decoded tx's own `getId()`; nothing compares it
  with the requested txid.
- `server/src/services/bitcoin/advancedTx/rbf.ts:204-205` fetches the original by `originalTxid` and parses
  `txDetails.hex` with no txid check; `:246-255` + `collectRbfOutputs` `:356-369` + `addRbfOutputs` `:408-415` copy every
  `tx.outs` into the replacement, recognising only change (branch 1). `bindPsbtAccount` checks inputs against the DB, so a
  forgery that keeps the real inputs and change passes. The route builds the RBF draft's recipient from that PSBT
  (`server/src/api/bitcoin/transactions.ts:187-224`, `externalOutputs[0]`), so later recipient/amount checks compare the
  attacker's address with itself. `signingIntent/prevoutValidation.ts:183-215` re-authenticates the original but
  compares only input outpoints and the RBF signal.
- Prevout values: `rbf.ts:121-126` (check fee rate) and `:317-337` (`collectRbfInputs`: value, script, legacy raw-tx
  cache), `cpfp.ts:167-176` (`parentFee` → `childFee`, `:184-190`; fee policy `:251-255`), and the parent itself
  `cpfp.ts:107-108,165,226`, all read `client.getTransaction(...)` projections with no txid check. `batch.ts:189-196`
  legacy `nonWitnessUtxo` bytes likewise. Confirmed (P1 and the folded P3).
- Tests miss it: `advancedTx.rbf-creation.contracts.ts:29-37` (`prevoutResponse` overrides `txid`), `:74-82`,
  `:225-247` serve hex whose `getId()` differs from the requested txid; `originalTxid = 'a'.repeat(64)` (`:27`).

**Fix design.** D-11.1, D-11.2, D-11.3. Call sites as listed in D-11.2; module and exports as in D-11.1; line-neutral
edits as in D-11.3. `collectRbfInputs` uses `prevOut.valueSats`, `prevOut.scriptPubKeyHex` and, for legacy,
`Buffer.from(prevOut.canonicalHex, 'hex')`. CPFP keeps `parentVsize` from the authenticated parent. No behaviour change
for honest servers other than rejecting non-canonical or overweight encodings (`rawTransactionEvidence.ts:262-275`),
which the sync path already rejects.

**Existing tests the fix breaks (fixture migration, not deletions).** After the fix, any mock that serves bytes whose
`getId()` differs from the requested txid, or that relies on the decoded `vout` instead of the bytes, fails closed. The
A1 worker first applies only the source change, runs the suites below, and records the list of newly failing tests; each
must be in this set and is migrated (never deleted or renamed; the five mutation-map killing tests keep their names,
D-11.3):
- **Rule:** every case in the five listed advancedTx test files (the four contracts files below and
  `advancedTx.pubkeyBranch.test.ts`) that reaches `rbf.ts:116` or a prevout/parent fetch is in the migration set, whether
  or not its line is listed; the lines below are the known instances.
- `advancedTx/advancedTx.rbf-creation.contracts.ts` (1,000 lines): `getTransaction` mocks at
  `:74,100,108,126,145,161,176,242,304,348,387,433,493,563,606,640,680,726,759,794,829,894,931,979`. `:161-163`
  (`mockResolvedValueOnce(mockTx)` with `sampleTransactions.rbfEnabled` under `'a'.repeat(64)`, then
  `prevoutResponse('b'.repeat(64), …)`) expects `InvalidInputError` `'must be at least'` (`:166-168`); after A1
  `canReplaceTransaction` returns `upstreamError` and `rbf.ts:190-191` throws a plain `Error`, so it is migrated to
  authentic bytes (the fee-rate rejection it pins must still be reached).
- `advancedTx/advancedTx.rbf-detection.contracts.ts` (235): `:49-50` (replaceable path: `sampleTransactions.rbfEnabled`
  under txid `'a'.repeat(64)` and a prevout `{ vout: […] }` with no hex) and `:118-128` ("should stay replaceable when
  history only lists the original as mempool (height 0)": not an early return; it serves `electrumShapedTx(...)`, whose
  `getId()` ≠ `'a'.repeat(64)` (`:35,64-76`), reaches `rbf.ts:116` and after A1 becomes `replaceable: false`). Only the
  early-return cases at `:83-116` and `:130-206` (confirmed, history, non-RBF, no hex, client error, malformed hex)
  return before authentication and keep passing (D-11.2a).
- `advancedTx/advancedTx.cpfp.contracts.ts` (535): `:79-110` `cpfpChain` + `mockResolvedValue(parent)` for **every**
  txid (the funding lookup then receives the parent) and the fixed `parentTxid`; the `beforeEach` (`:100-110`) moves to
  a txid-keyed store and `parentTxid` becomes `cpfpChain().parent.txid`.
- `advancedTx/advancedTx.batch-fees.contracts.ts` (751): `:430` (legacy batch).
- `advancedTx.pubkeyBranch.test.ts:69,120` (`originalTxid = 'f'.repeat(64)`), `industry/rbfCpfpEdgeCases.test.ts:78,103`.
- Migration pattern (D-11.19-compliant, top-level functions): `advancedTxTestHarness.ts` gains
  `serveNodeTransactions(...txs: bitcoin.Transaction[])` (a `getTransaction.mockImplementation` keyed by `getId()`,
  returning the real `decodeRawTransaction`-shaped `{ txid, hex, vin, vout }`, throwing on an unknown txid) and builders
  that create the prevout transaction first and spend it by `prevout.getHash()`; `prevoutResponse`
  (`rbf-creation.contracts.ts:29-37`) is replaced by it, which also offsets the new lines so the 1,000-line file does
  not grow. Mocks not in the advancedTx tree are unaffected: `bitcoinTestHarness.ts` and `feeMonitor.test.ts` mock the
  `advancedTx` barrel, and `transactionServiceBatch/*` test `transactions/createBatchTransaction.ts`, not `advancedTx/batch.ts`.

**Failing-first tests** (new file `advancedTx/advancedTx.node-authentication.contracts.ts`, registered in
`advancedTx.test.ts`; each uses real transactions so only the authentication differs):
1. **RBF create, forged original on both fetches.** Original O (real txid T, RBF-signalled, recipient R, wallet change C,
   prevout P served authentically). The node serves, for T, forged O' = O with R's script replaced by attacker A
   (same inputs, sequences and change). Expect `createRBFTransaction(T, …)` to reject with message
   `Raw transaction id does not match the expected transaction id` and `bindPsbtAccount` not called. **Red on base:** it
   resolves with an output paying A (the check computes a fee from O' and create copies O' outputs).
2. **RBF create, genuine to the check, forged to the create** (call-count–keyed mock: first T lookup genuine, second
   forged). Expect rejection `instanceof RawTransactionEvidenceError` with `reason === 'txid_mismatch'`. **Red on base:**
   resolves paying A (pins `rbf.ts:204`).
3. **Folded P3, RBF check.** Genuine O, but the prevout lookup for P's txid serves P'' (a different transaction whose
   output 0 has a smaller value). Expect `canReplaceTransaction(T)` → `{ replaceable: false, upstreamError: true }` with
   the txid-mismatch reason. **Red on base:** `replaceable: true` with an inflated `currentFeeRate`/`minNewFeeRate`.
4. **Folded P3, CPFP.** Genuine parent; the parent's funding prevout lookup serves a different transaction with an
   understated value. Expect `createCPFPTransaction` to reject with the txid-mismatch reason. **Red on base:** resolves
   with `childFee` larger than the honest computation (assert the honest value in a sibling passing case).
5. **CPFP forged parent** (parent txid served a different transaction) → rejection. **Red on base:** resolves.
6. **Legacy raw-tx caches** (RBF legacy wallet, `advancedSignableWallet(id, 'legacy')`; advanced batch legacy):
   forged bytes for a spent txid → rejection `instanceof RawTransactionEvidenceError`. **Red on base:** resolves or
   throws a different error (the `instanceof` + `reason` assertion fails either way). The **RBF-legacy** mock is
   call-count keyed for the spent txid: the first lookup (from `canReplaceTransaction`'s prevout loop, `rbf.ts:121-126`)
   gets the genuine prevout, the second (from `collectRbfInputs`, `rbf.ts:319`) gets the forged one. Otherwise the
   check would authenticate the forgery first and its catch (`rbf.ts:145-151`) would turn the typed error into
   `{ replaceable: false, upstreamError: true }`, after which `createRBFTransaction` throws a plain `Error`
   (`rbf.ts:190-192`) and the `instanceof` assertion could not pass. The advanced-batch legacy variant stays as
   written (`batch.ts` has no catch).
7. Honest-path guards (pass on base and after): genuine O/P → same PSBT outputs, fee and `feeDelta` as today; CPFP honest
   → same `childFee`.
- `advancedTx/nodeTransactionAuthentication.test.ts` (new, 100% branches): non-string `hex` (undefined, object) →
  `malformed_raw_transaction`; missing output index → `missing_output`; uppercase expected txid accepted (`TXID_PATTERN`
  `rawTransactionEvidence.ts:3`); `valueSats` is a number equal to the output value. (Red on base: module absent — a
  supporting unit, not one of the behavioural reds above.)
- Confirm red first:
  `cd server && npx vitest run tests/unit/services/bitcoin/advancedTx.test.ts tests/unit/services/bitcoin/advancedTx.pubkeyBranch.test.ts tests/unit/services/bitcoin/industry/rbfCpfpEdgeCases.test.ts tests/unit/services/bitcoin/advancedTx/nodeTransactionAuthentication.test.ts`
  (the last is standalone, not registered through `advancedTx.test.ts`).

**Acceptance.** No advanced-tx PSBT or fee figure is built from bytes whose txid differs from the requested txid; a
forged original or prevout is refused (check → `replaceable: false, upstreamError: true`; create → typed error);
honest results are byte-for-byte unchanged; the `serverFeePolicy` canaries are present and Killed by their named tests;
backend `tests/unit` coverage 100%; signer inventory unchanged.

### Phase A2 — Legacy raw-transaction helper returns authenticated hex (P1 `legacy-send--raw-tx-helper-returns-decoded-object`, from SQ-1)

Implemented on its own branch stacked on A1 (D-11.4); SQ-1 accepted.

**Evidence.** SQ-1 above (`transactions/helpers.ts:26-31`, `psbtConstruction.ts:211-226`, `createTransaction.ts:150-152`,
`createBatchTransaction.ts:143-145`, `electrum/methods.ts:268-277`).

**Fix design.** `getRawTransactionHex` returns `(await fetchAuthenticatedTransaction(client, txid)).canonicalHex`,
imported directly from `../advancedTx/nodeTransactionAuthentication` (D-11.4; no new runtime cycle).
`psbtConstruction.ts` is **not** edited (it is mutation-pinned, `stryker.taproot-construction.config.mjs:7`
`psbtConstruction.ts:67-77`).

**Failing-first tests.** New `server/tests/unit/services/bitcoin/transactionHelpers.legacyRawTx.test.ts`: a node client
whose `getTransaction` returns the real decoded shape (`decodeRawTransaction(hex, 'testnet3')` of a real tx) →
`getRawTransactionHex` returns `typeof 'string'` equal to that hex (**red on base:** returns the object), and
`fetchRawTransactionsForLegacy([txid], 'testnet3')` yields a Buffer equal to the bytes (**red on base:** `TypeError`); a
mismatching txid → `RawTransactionEvidenceError` `txid_mismatch` (**red on base:** returns the object).

**Existing tests the fix breaks (known migrations; serve the decoded `{ txid, hex }` shape and give each legacy UTXO
the real txid of the served transaction).**
- `transactionServiceBatch/transactionServiceBatch.create.contracts.ts:594-605`: `mockGetTransaction` resolves a raw hex
  string, so after A2 `details.hex` is `''` → `malformed_raw_transaction`. Serve the decoded shape; the fixture txid is
  already real (`transactionServiceBatchBindingFixtures.ts:132-137`). Registered via `transactionService.batch.test.ts`
  (a fee-policy Stryker `testFile`, `server/stryker.fee-policy.config.mjs:24`).
- `transactionServiceCreate/psbt-helpers-legacy.contracts.ts`, `describe("Legacy Wallet Handling")`: the migration
  site is the shared `beforeEach` (`:331-361`) plus all three cases that depend on it (`:362-377`, `:382-390` "should
  fetch raw transactions for legacy inputs", `:392-405`). The `beforeEach` spends `sampleUtxos[2]`, whose txid is
  `'c'.repeat(64)` (`server/tests/fixtures/bitcoin.ts:138`); give the spent UTXO the real txid of the served transaction
  (the harness transaction, `transactionServiceCreateTestHarness.ts:116`) and serve the decoded shape. The `:392` case's
  expected message `Failed to fetch raw transaction for ${...txid}` moves to the migrated UTXO's real txid. Registered
  via `transactionService.create.test.ts` (also a fee-policy `testFile`).
- `transactionServiceCreate/transactionServiceCreateTestHarness.ts:116` (legacy-path cases that reach
  `getRawTransactionHex`). The SQ-1 sites `transactionService.test.ts:42`, `transactionServiceBroadcastTestHarness.ts:50`
  and `payjoinIntegrationTestHarness.ts:27` never reach a legacy create and are not touched. Any further newly failing
  case the worker finds is recorded and migrated the same way (never deleted or renamed).
- Confirm red first:
  `cd server && npx vitest run tests/unit/services/bitcoin/transactionHelpers.legacyRawTx.test.ts tests/unit/services/bitcoin/transactionService.create.test.ts tests/unit/services/bitcoin/transactionService.batch.test.ts`.
- Because two fee-policy `testFiles` change, the integrator's fee-policy Stryker profile and scoped canary check
  (Verification) run on the integrated branch **after A2**, not only after A1.

**Acceptance.** A legacy wallet can create a send and a batch; legacy `nonWitnessUtxo` bytes are txid-authenticated;
the `serverFeePolicy` canaries stay present and Killed with A2 applied.

---

## Phase B — Two-factor setup returns the manual-entry secret (P2 `two-factor-setup--manual-secret-is-ciphertext`)

**Evidence (re-verified).** `server/src/services/twoFactorService.ts:29-44` builds the otpauth URI/QR from
`plaintextSecret` but returns `{ secret: encrypt(plaintextSecret) }`; `server/src/api/auth/twoFactor/setup.ts:39-50`
stores that value and responds `res.json({ secret, qrCodeDataUrl })`; `src/components/Account/SetupTwoFactorModal.tsx:70-75`
shows and copies `setupData.secret` under "Or enter this code manually". Ciphertext is `iv:authTag:ciphertext` base64
(`utils/encryption.ts`), not base32. Tests pin the bug: `server/tests/unit/services/twoFactorService.test.ts:51-62`
asserts `result.secret` is ciphertext; route contracts mock `generateSecret` → `'mock-secret'`
(`auth2faTestHarness.ts:182`, `authRegistrationTestHarness.ts:211`, asserted at `auth2fa.setup-enable.contracts.ts:55`).
Confirmed.

**Fix design.** D-11.5.

**Existing tests the fix changes.** `twoFactorService.test.ts:30-71`: `result.secret` → `result.manualEntrySecret`
(`:30-49`), the ciphertext assertion (`:51-62`) moves to `result.encryptedSecret`, and `verifyToken(result.secret, …)`
(`:64-71`) → `encryptedSecret`. Both harness mocks return `{ manualEntrySecret: 'JBSWY3DPEHPK3PXP',
encryptedSecret: 'iv:tag:ct', qrCodeDataUrl }`; `auth2fa.setup-enable.contracts.ts:55` then expects
`'JBSWY3DPEHPK3PXP'`.

**Failing-first tests.**
- `twoFactorService.test.ts`: `manualEntrySecret` matches `/^[A-Z2-7]+=*$/`;
  `decryptIfEncrypted(encryptedSecret) === manualEntrySecret`; and a code generated with otplib `generateSync` from
  `manualEntrySecret` verifies through `verifyToken(encryptedSecret, code)` (proves the manual secret is the secret the
  server checks). **Red on base:** `manualEntrySecret` is undefined.
- `auth2fa.setup-enable.contracts.ts` (212 lines) "should successfully start 2FA setup" (`:42-57`): response
  `secret === 'JBSWY3DPEHPK3PXP'` and `mockPrismaClient.user.update` called with `twoFactorSecret: 'iv:tag:ct'`; the
  audit `logFromRequest` details do not contain the secret. **Red on base:** the route destructures `secret` (undefined
  with the new mock), so the response has no `secret` and the update stores `undefined`.
- Confirm red first (`tests/unit/api/auth2fa` and `tests/unit/api/authRegistration` hold no `*.test.ts`; their
  contracts run only through the registering suites):
  `cd server && npx vitest run tests/unit/services/twoFactorService.test.ts tests/unit/api/auth.routes.2fa.test.ts tests/unit/api/auth.routes.registration.test.ts`.

**Acceptance.** The manual-entry code is the base32 secret in the QR; only ciphertext is stored; the response shape and
OpenAPI are unchanged; no log contains the plaintext.

---

## Phase C — Public price health is served from a bounded cache (P2 `price-health--unauthenticated-live-provider-probe`)

**Evidence (re-verified).** `server/src/api/price.ts:327-333` `GET /health`: no `authenticate`, no route limiter;
`services/price/index.ts:736-753` `healthCheck` → `registry.getHealth()`; `providers/registry.ts:309-347` awaits
`provider.healthCheck()` for every provider on every call (it writes `healthCache` but never reads it); each
`healthCheck` is a live `getPrice('USD')` (`services/price/providers/base.ts:71-80`). Unit tests mock
`priceService.healthCheck` (`server/tests/unit/api/price.test.ts:345-372`). Confirmed.

**Fix design.** D-11.6.

**Existing tests.** `server/tests/unit/services/price.test.ts:641-689` (`healthCheck`, a fresh `PriceService` per test,
`:126-130`): the cold `ensureInitialized()` registers providers, and registration's health checks use the same axios
mock as the test, so the cached statuses equal what the old live probe returned: expected to keep passing; the worker
re-runs and records. `registry.test.ts` cases for `getHealth` stay (method unchanged). Re-run
`tests/unit/services/push` (shared registry class).

**Failing-first tests.**
- New `server/tests/unit/services/price.health.test.ts` (copies the axios, cache and `providerSettings` mocks from
  `price.test.ts:1-115`, `'coingecko'` enabled as there; `afterEach` shuts the service down): `await svc.initialize();
  mockedAxios.get.mockClear();` then five concurrent `svc.healthCheck()` calls → **zero** `axios.get` calls and the
  same `{ healthy, providers }` as the registration probe. **Red on base:** 5 × (enabled providers) calls. Then advance
  time past the 30 s TTL (`vi.spyOn(Date, 'now')`) and fire five concurrent calls → exactly one `axios.get` per enabled
  provider. **Red on base:** five per provider.
- `server/tests/unit/providers/registry.test.ts` (359 lines): `getCachedHealth()` with a fresh cache does not call
  `provider.healthCheck`; with a stale cache, concurrent callers share one call; a throwing `healthCheck` is cached as
  unhealthy; the in-flight entry is cleared after settle (next stale call probes again) and on `unregister`/`shutdown`;
  `lastCheck` equals the cache timestamp. (Red on base: method absent; the behavioural red is the service test.)

**Acceptance.** Any number of public `/price/health` requests cause at most one upstream call per provider per 30 s;
the response shape is unchanged; admin/push live probes unchanged.

---

## Phase D — Admin restore waits past the server budget and never invites a second restore (P2 `admin-restore--client-30s-timeout-reports-failure-of-committing-restore`)

**Evidence (re-verified).** `src/api/admin/backup.ts:62-64,71-76` call `apiClient.post` with no `timeoutMs`, so
`client.ts:641-645` applies `DEFAULT_REQUEST_TIMEOUT_MS = 30_000` (`:70`); POST retries are off; an abort becomes
`ApiError(…, 0)` (`client.ts:196-204`). The server budgets 120 s for `/admin/backup*` and `/admin/restore`
(`middleware/requestTimeout.ts:33-34`, 408 on expiry `:113-114`) and the restore transaction 120 s
(`services/backupService/restore.ts:273-274`); `restoreFromBackup` does not observe the abort. On the client,
`useBackupHandlers.ts:255-257` shows "Restore failed" with the timeout message, keeps the uploaded backup (the Restore
button stays available) and skips the reload (`:247-251`). Tests pin no timeout (`tests/api/remainingAdminApiModules.test.ts:60-66`).
Confirmed.

**Fix design.** D-11.7, D-11.8, residual D-11.9.

**Failing-first tests.**
- `tests/api/remainingAdminApiModules.test.ts:60-66`: the two exact `toHaveBeenCalledWith` assertions gain the third
  argument `{ timeoutMs: ADMIN_RESTORE_TIMEOUT_MS }`, plus `expect(ADMIN_RESTORE_TIMEOUT_MS).toBeGreaterThan(120_000)`.
  **Red on base:** no third argument (and no constant).
- `tests/components/BackupRestore/useBackupHandlers.branches.test.tsx` (338 lines): `restoreBackup` rejects
  `new ApiError('signal timed out', 0)` → `restoreError === RESTORE_OUTCOME_UNKNOWN_MESSAGE`, `uploadedBackup === null`,
  `validationResult === null`; same for `new ApiError('Request timeout', 408)`. **Red on base:** the message is the
  raw error text and the backup is kept. The existing `:181-193` cases (`new Error('boom')` → `'boom'`, non-Error →
  `'Restore failed'`) keep passing (guards).
- `tests/components/BackupRestore/restoreOutcome.test.ts` (new): status 0 and 408 → true; 500, 400, a plain `Error`,
  `null` → false (100% branches).
- Confirm red first (pass 6: there is no root Vitest config — `package.json` passes `--config
  config/tooling/vitest.config.ts`, which sets jsdom and the setup files; without it `renderHook` fails for environment
  reasons on base and fix alike): `npx vitest run --config config/tooling/vitest.config.ts
  tests/api/remainingAdminApiModules.test.ts tests/components/BackupRestore/useBackupHandlers.branches.test.tsx
  tests/components/BackupRestore/restoreOutcome.test.ts` — record the named failing cases (missing third argument /
  `ADMIN_RESTORE_TIMEOUT_MS`, the status 0 and 408 unknown-outcome cases, the `restoreOutcome` import failure).
- Playwright: no endpoint or success-path change; run the admin backup/restore e2e and render-regression specs through
  the throwaway static-server config (Verification).

**Acceptance.** Validate and restore wait 150 s; a timeout or dropped connection produces the "may still be restoring"
message and removes the Restore button until a fresh upload; other failures unchanged; frontend coverage 100%.

---

## Phase E — Electrum connection tests use the configured Tor proxy (P2 `electrum-test--bypasses-configured-tor-proxy`)

**Evidence (re-verified).** `server/src/services/bitcoin/nodeClient.ts:404-411` builds `ElectrumClient({ host, port,
protocol, network })` with no `proxy`; an explicit config resolves through `explicitConnectionConfig`
(`electrum/connectionConfigResolver.ts:147-157`), which copies only `explicitConfig.proxy`, so the connection takes the
direct-socket branch. Every caller passes no proxy: `adminElectrumServerService.ts:96-111` (`testElectrumConnection`),
`:194-209` (`testSavedElectrumServer`, which persists `isHealthy`, `healthCheckFails`, `lastHealthCheckError`),
`api/admin/nodeConfig.ts:311-333`; `api/node.ts:72-187` dials raw `net`/`tls` sockets. Runtime honours the proxy
(`connectionConfigResolver.ts:58-145` `proxy: proxyConfigFromNodeConfig(...)`; pool `electrumPool.ts:179-188`,
`poolRegistry.ts:128-146`). Tests have no proxy case. Confirmed.

**Fix design.** D-11.10, D-11.11, D-11.12.

**Existing tests.** `nodeClient.test.ts:30-46` mocks the repositories barrel (`findDefault` →
`mockPrismaClient.nodeConfig.findFirst`), so `testNodeConfig` resolves no proxy by default; existing
`nodeClient.test-node-config.contracts.ts` cases keep passing (worker re-runs; any case that seeds a proxy row in a
shared `findFirst` mock must reset it). `adminElectrumServerService.test.ts`, `electrumServers.test.ts`,
`adminNodeConfig/adminNodeConfigTestHarness.ts` and `admin/adminTestHarness.ts` mock `testNodeConfig` entirely:
unaffected. `node.test.ts` gains a module mock of `src/services/bitcoin/nodeClient` (factory with
`resolveConfiguredElectrumProxy: vi.fn().mockResolvedValue(undefined)` and `testNodeConfig: vi.fn()`; `node.ts` uses
no other export, so no enum/constant needs `importOriginal`) so its raw-socket cases never touch Prisma.

**Failing-first tests.**
- `nodeClient.test-node-config.contracts.ts` (340 lines): stored row `{ type: 'electrum', proxyEnabled: true,
  proxyHost: '127.0.0.1', proxyPort: 9050 }` → `ElectrumClient` constructed with
  `proxy: { enabled: true, host: '127.0.0.1', port: 9050 }`. **Red on base:** no `proxy`. Stored proxy whose password
  cannot be decrypted → `ElectrumClient` **not** constructed, `{ success: false, failureKind: 'proxy_configuration' }`.
  **Red on base:** a direct client is constructed. Proxy disabled → no `proxy` key (guard, passes both).
  `allowSelfSignedCert: true` in the config → forwarded (red on base: dropped).
- `adminElectrumServerService.test.ts` (392 lines): `testNodeConfig` resolving
  `{ success: false, message, failureKind: 'proxy_configuration' }` → `updateHealth` not called. **Red on base:**
  called with `isHealthy: false`. A plain failure still records unhealthy (guard).
- New `server/tests/unit/api/node.proxy.test.ts`: resolver returns an enabled proxy → `POST /api/v1/node/test` calls
  `testNodeConfig` with `{ host, port, protocol, allowSelfSignedCert }`, responds `{ success, message }`, and
  `net.connect`/`tls.connect` are not called. **Red on base:** the raw socket is opened. Resolver rejects with
  `ProxyConfigurationError` → `net.connect` and `tls.connect` never called and the response is
  `{ success: false, ... }`. **Red on base:** no resolver call exists, so base dials directly.
- `server/tests/unit/services/bitcoin/electrum/connectionConfigResolver.test.ts` resolver cases (100% branches): electrum row with proxy → config; non-electrum row or no row → `undefined`;
  decrypt failure propagates.
- Confirm red first (pass 5: the contracts file runs only through its registering suite
  `server/tests/unit/services/bitcoin/nodeClient.test.ts:5`; the server Vitest include is `tests/**/*.test.ts`, so running
  the contracts path directly reports "No test files found"): `cd server && npx vitest run
  tests/unit/services/bitcoin/nodeClient.test.ts tests/unit/services/bitcoin/electrum/connectionConfigResolver.test.ts
  tests/unit/services/adminElectrumServerService.test.ts tests/unit/api/node.test.ts tests/unit/api/node.proxy.test.ts`
  — record the named failing cases, not just the exit code.

**Acceptance.** With Tor enabled, every connection test (saved server, add-server form, Node Config test, `/node/test`)
dials through the saved SOCKS proxy, so `.onion` servers can pass; a proxy-configuration fault never falls back to a
direct dial and never marks a saved server unhealthy; with Tor disabled nothing changes.

---

## Phase F — Shared signers can be used in Create Wallet and add-signer (P2 `create-wallet--shared-signer-rejected-device-not-found`)

**Evidence (re-verified).** `GET /devices` lists devices shared through `DeviceUser` or a group
(`services/deviceAccess.ts:134-166` → `deviceRepository.findAccessibleByUser`, `:643-648`); the create wizard offers
them (`src/components/CreateWallet/createWalletData.ts` filters by account compatibility only). `walletCreate.ts:106-113`
and `walletDevices.ts:144-148` look them up with `findByIdsAndUserWithAccounts` (`deviceRepository.ts:777-785`,
`userId` owner column only) and throw `DeviceNotFoundError` (404). Import allows any current role to reuse an account
(`walletImport/deviceReuseAccess.ts:33-45`). Tests: `server/tests/unit/repositories/deviceRepository.test.ts:475-495`
pins the owner-only `where`; wallet unit tests use the harness reimplementation. Confirmed.

**Fix design.** D-11.13.

**Failing-first tests.**
- `server/tests/unit/repositories/deviceRepository.test.ts:488-494`: the exact `where` becomes
  `{ id: { in: [...] }, OR: [{ userId }, { users: { some: { userId } } }, { groupId: { not: null }, group: { members: { some: { userId } } } }] }`.
  **Red on base** (rewritten case).
- Integration (real DB), new `server/tests/integration/flows/wallet/shared-device-signers.contracts.ts` registered in
  `flows/wallet.integration.test.ts` (capability asserts are already mocked there, `:28-33`): owner B creates a device
  with an account; (1) B shares it with A as `viewer` → A `POST /api/v1/wallets` with that signer → 201 and the wallet
  binds B's account (**red on base:** 404 `DEVICE_NOT_FOUND`); (2) device in group G with A a member → 201 (**red on
  base:** 404); (3) unrelated user C → 404 (guard); (4) A adds the shared device as a signer to A's existing wallet via
  `POST /api/v1/wallets/:id/devices` → success (**red on base:** 404).
- Re-run `tests/unit/services/wallet` and `tests/unit/services/walletImport` (unchanged).
- Confirm red first (pass 5: `wallet.integration.test.ts:39` skips every case without `DATABASE_URL`/`TEST_DATABASE_URL`
  (`tests/integration/setup/testDatabase.ts:20-22`), so a plain vitest run exits 0 with nothing executed): from the F
  worktree on base, `flock /home/nekoguntai/.i11-integration.lock npm --prefix server run test:integration:db --
  tests/integration/flows/wallet.integration.test.ts` — record that the four new cases executed (not skipped) and that
  (1), (2) and (4) fail with 404 `DEVICE_NOT_FOUND`; unit leg: `cd server && npx vitest run
  tests/unit/repositories/deviceRepository.test.ts`.

**Acceptance.** Any device the user can see in `GET /devices` (direct or group share, any role) can be selected as a
signer in Create Wallet and add-signer; unrelated devices are still 404; import behaviour unchanged.

---

## Phase G — CI and install test infrastructure (G1–G4)

### Phase G1 — Install suites fail on any failed assertion (P2 `install-unit-tests--run-test-swallows-non-final-assertions`)

**Evidence (re-verified).** `tests/install/unit/reset-user-2fa-script.test.sh:80-99` (`set +e; "$test_func";
exit_code=$?; set -e`) with helpers that only `return 1` (`:19-78`); same runner at `upgrade-helpers.test.sh:186-205`,
`install-script.test.sh:171-190`, `e2e/fresh-install.test.sh:133-152`; generic helpers `tests/install/utils/helpers.sh:1273-1390`.
Only the last statement's status counts. The scrub's reproduction (reset-2fa with `ASSUME_YES=true` forced: "ASSERTION
FAILED" printed, suite "Passed: 6 Failed: 0", exit 0) matches the code. The other runners with this shape guard every
assertion (scrub sweep). Confirmed.

**Fix design.** D-11.14, D-11.15.

**Failing-first tests.**
- New `tests/install/unit/install-assertion-tracking.test.sh` (picked up by `scripts/ci/run-install-unit-tests.sh`'s
  `tests/install/unit/*.test.sh` glob; `set -euo pipefail`; no temp dirs, no `rm`, no `kill`): (1) sources
  `tests/install/utils/assertion-tracking.sh` and `helpers.sh`, defines `fixture_non_final_failure() { assert_equals a b
  "deliberate non-final failure" >/dev/null; true; }` → `install_test_run_function fixture_non_final_failure` returns
  0 and leaves `INSTALL_TEST_LAST_STATUS` non-zero; `fixture_pass() { assert_equals a a; true; }` → status 0; a
  function returning 1 with no assertion → non-zero status; the function's own return is 0 in every case; errexit
  state of the caller is restored (both `set -e` and `set +e` callers); and, run in a child `bash -c` that sources the
  tracking file under `set -e` and calls the runner in the mandated form, a body doing `set -e; false; true` ends that
  child non-zero (passes on base `run_test`, fails under the rejected `||` form). (2) Static wiring: each of the four
  suites' `run_test` body calls `install_test_run_function` only in the form
  `install_test_run_function "$test_func"; local exit_code="$INSTALL_TEST_LAST_STATUS"` (D-11.14; any other form
  fails), rejects any `install_test_run_function` call inside a `||`/`&&`/`if`/`!` context, and contains no direct call
  of the function variable: only a statement that STARTS with it is rejected (anchored
  `^\s*"?\$test_func"?(\s|$)`), so the `"$test_func"` argument inside the required form is allowed; every column-0
  `^assert_[a-z_]+\(\)` definition in those suites, and in `helpers.sh` only within the block from the
  `# Test Assertion Functions` title line to the `# Test Environment Setup` title line (`helpers.sh:1270` and `:1396` on
  base; the `# ====` rule right after the first title is that header's own closing rule, `:1269-1271`, so it is not the
  block end; both bounds are located by title text, not line numbers, which shift when G1 adds the source line), calls
  `install_test_record_assertion_failure` on its failure path. The scan asserts exact definition counts — `helpers.sh`
  block 8, `reset-user-2fa-script.test.sh` 4, `upgrade-helpers.test.sh` 3, `install-script.test.sh` 8 (column-0, at
  base) — so an empty or short scan fails. Named exclusions: the indented in-test stub
  `assert_frontend_proxy_recovers_after_backend_recreate_inner` (`upgrade-helpers.test.sh:2681`) and the product-check
  helpers `assert_install_output_was_fresh` (`helpers.sh:45`) and `assert_installed_image_matches_checkout`
  (`helpers.sh:820`; deliberate rejection test at `upgrade-helpers.test.sh:247-260`). **Red on base:** the tracking file
  does not exist and every static check fails.
- Registration: `tests/ci/ci-registration-completeness.test.sh:353-370` requires every `tests/install/unit/*.test.sh`
  to be listed in `tests/install/run-all-tests.sh` (unless allowlisted). G1 adds
  `run_test_suite "Install Assertion Tracking Unit Tests" "$SCRIPT_DIR/unit/install-assertion-tracking.test.sh"` to
  `run-all-tests.sh`, matching the file's existing `if ! run_test_suite … ; then … fi` pattern (`:136-196`).
  `run_test_suite` (`:115-117`) executes `$script $VERBOSE` directly, so the new file is committed as mode `100755`
  and accepts and ignores a `--verbose` argument. G1 runs
  `bash tests/ci/ci-registration-completeness.test.sh` among its targeted tests.
- Behavioural proof per suite (recorded, not committed): in a scratch copy outside the repo, force
  `scripts/reset-user-2fa.sh`'s default to `ASSUME_YES=true` and run the patched reset-2fa suite → exit non-zero with
  `Failed: ≥1` (on base it exits 0); record both runs in the PR body.
- Run the unmasked suites: `bash tests/install/unit/reset-user-2fa-script.test.sh`,
  `bash tests/install/unit/upgrade-helpers.test.sh`, `bash tests/install/unit/install-script.test.sh`,
  `bash tests/ci/ci-registration-completeness.test.sh` and `bash scripts/ci/run-install-unit-tests.sh`; every newly failing test is handled per D-11.15. `e2e/fresh-install.test.sh`
  needs Docker and runs only in the install lanes (deferred on PRs): after the PR's required checks are green, the
  integrator dispatches `install-test.yml` (`workflow_dispatch`, fresh-install suite) on the PR head once, respecting
  serial runner use, and records the run id; an unmasked fresh-install failure is handled per D-11.15.

**Acceptance.** In all four suites, any failed assertion fails its test and the suite; the fixture proves a non-final
failure is caught and an in-body `set -e` failure still ends the suite non-zero; every unmasked failure is reported and resolved per D-11.15; the new suite is registered in
`run-all-tests.sh`; `run-install-unit-tests.sh` and `ci-registration-completeness.test.sh` green.

### Phase G2 — The migration entrypoint triggers the install lanes (P2 `ci-install-test--migrate-entrypoint-not-classified`)

**Evidence (re-verified).** `server/scripts/migrate.sh` is run by `server/Dockerfile:163` and `docker-compose.yml:632`.
`install-test.yml` push `paths` (`:19-75`) and pull_request `paths` (`:77-…`) list `server/Dockerfile` (`:26`/`:87`) and
`server/prisma/**` (`:28`/`:89`) but not `server/scripts/**`; `release-candidate.yml` pull_request `paths` (`:34-52`)
omit it; `tests/install/utils/classify-install-scope.sh` has `server/Dockerfile` (`:536`) and `server/prisma/*`
(`:566-571`) cases and a release-surface case (`:478-486`) without it. Confirmed.

**Fix design.** D-11.16.

**Failing-first tests.**
- `tests/install/unit/install-workflow-trigger-contract.test.mjs:27-45` `releaseSurfacePaths` gains
  `'server/scripts/migrate.sh'`. **Red on base:** both event path filters miss it.
- `tests/ci/check-workflow-composition.test.sh:916-926` RC helper loop gains `server/scripts/migrate.sh`. **Red on base.**
- `tests/install/unit/install-scope.test.sh` (782 lines): add `server/scripts/migrate.sh` to the release-surface loop
  (`:731-760`; expects `release-surface-pr-smoke`, `run_upgrade_baseline=true`, `run_reuse_stack=true`) — **red on
  base** (no scope) — and a push-event case asserting the same `assert_scope` as `server/prisma/schema.prisma` (`:440-442`).
- Run `node tests/install/unit/install-workflow-trigger-contract.test.mjs`, `bash tests/install/unit/install-scope.test.sh`,
  `bash tests/ci/check-workflow-composition.test.sh`.

**Acceptance.** A PR or push changing only `migrate.sh` runs the install workflows with the migration scope and the
release-surface PR smoke; push/PR filters stay aligned.

### Phase G3 — Render lane runs when the shared e2e helpers it imports change (P2 `ci-classifier--render-lane-blind-to-shared-e2e-helpers`)

**Evidence (re-verified).** `scripts/ci/classify-files-lib.sh:281-294` `is_render_file` covers `src/{app,components,
hooks,contexts,providers,themes,utils}/*`, package files, the Playwright config and `tests/e2e/render-regression*` only;
the harness imports `tests/e2e/helpers.ts`, `tests/e2e/apiSimulator.ts`, `tests/e2e/fixtures/apiBaseline.ts`,
`tests/e2e/fixtures/balanceHistory.ts` (transitive import walk at `f793fbb90f`), which today classify `render=n`
(sourced probe). `test.yml` runs Full Render E2E only when `render_changed || full_scan || test_suite_changed` and accepts
a skipped render lane. Confirmed.

**Fix design.** D-11.17.

**Failing-first tests.**
- `tests/ci/classify-test-changes.test.sh` (886 lines; one loop before `assert_every_test_workflow_script_is_classified`):
  each of the four paths → `render_changed=true`. **Red on base.** `tests/e2e/fixtures/browserFixture.ts` stays
  `render_changed=false` (`:677-689`, unchanged).
- `tests/ci/plan-test-run.test.sh` (547 lines): `tests/e2e/helpers.ts` → `lanes.render_regression.run == true`. **Red on base.**
- New `tests/ci/renderHarnessInputsClassified.test.ts`: fails on base listing exactly the four paths (no more, no fewer;
  a walker that drops double-quoted or `import type` specifiers lists fewer); passes after.
- `lizard -C 15 -T nloc=200 tests/ci/renderHarnessInputsClassified.test.ts` → zero warnings.

**Acceptance.** A PR touching any of the four harness-imported files runs Full Render E2E; browser-only fixtures do
not; a new unclassified render-harness import is caught by the drift guard in the scheduled full scan (as the F1
guard's residuals), not on the PR that adds it (D-11.17 residual).

### Phase G4 — Gate scripts run their own regression suites (P2 `ci-classifier--quality-suite-subjects-outside-trigger`)

**Evidence (re-verified).** `scripts/ci/classify-quality-scope.sh:105-114` `is_ci_classifier_file` has no
`scripts/quality*`, `scripts/ops/*` or `server/.husky/*`; their suites (`tests/ci/jscpd-only.test.sh`,
`check-lockfile-peer-resolution.test.sh`, `quality-lizard-bootstrap.test.sh`, `quality-audit.test.sh`,
`sanctuary-backup.test.sh`, `pre-commit-agent-gate.test.sh`) run only in `ci-classifier-tests` (`quality.yml:903-954`,
gated `:619`), whose skip `quality-required-checks` accepts. `tests/ci/classify-quality-scope.test.sh:256-278` pins
`expected_classifier=false` for those subjects. Confirmed; the coordinator chose to route them.

**Fix design.** D-11.18.

**Failing-first tests.** `tests/ci/classify-quality-scope.test.sh` (341 lines): in the `:256-278` loop,
`expected_classifier` becomes `true` for `scripts/quality.sh`, `scripts/quality/lizard-only.sh`,
`scripts/quality/jscpd-only.sh`, `scripts/quality/check-lockfile-peer-resolution.sh`,
`scripts/quality/lockfile-peer-resolution-allowlist.txt` (via the `case` at `:269-273`; optional, untracked; routed so
creating it runs its suite; this loop entry is its only assertion), **red on base**;
`scripts/quality/lizard-requirements.txt` stays `false`; new `classify_commit` cases for `scripts/ops/sanctuary-backup.sh`,
`scripts/ops/install-sanctuary-backup.sh`, `server/.husky/pre-commit` → classifier `true` (**red on base**);
`scripts/ops/example.sh` keeps the lifecycle-only expectation (`:282-295`); the static subject guard (D-11.18: tracked
regular files only, trailing punctuation stripped, directory tokens dropped, derived set equal to the seven tracked
subjects, the untracked allowlist excluded) is
red on base for all six suites.

**Acceptance.** Changing any gate script or the backup/pre-commit scripts runs the suites that pin their fail-closed
behaviour; other scripts unchanged.

---

## Phase H — Decoded Electrum transactions carry real hex (P2 `electrum-decode--hex-fields-decimal-bytes`, added during implementation)

**Why it is here.** Found by the A1 worker while migrating fixtures and confirmed by the coordinator: under bitcoinjs-lib
7.0.2 `decodeRawTransaction` (`server/src/services/bitcoin/electrum/methods.ts:143,159`) calls `toString('hex')` on
`Uint8Array` values, which ignores the encoding and yields `"65,4,103,…"`. A read-only consumer audit found RBF
fee-bump creation broken by it (already fixed by A1, which now reads authenticated bytes), `GET
/api/v1/bitcoin/transaction/:txid` returning the malformed fields, and a latent persistence path
(`blockchain/transactionIO.ts:116`). It is the same Electrum-decoding seam as A1/A2, so it joins this delivery rather
than waiting for iteration 12 (skill rule: a blocking bug exposed inside the same boundary is added to the active plan).

**Fix.** `Buffer.from(output.script).toString('hex')`; `hash` becomes Bitcoin Core's: hash256 of the full
serialization (witness included), display order (bitcoinjs-lib's `getHash(true)` zeroes a coinbase's witness hash).
No pinned file (lifecycle-contract entries for `methods.ts` are role-only).

**Failing-first test.** New `server/tests/unit/services/bitcoin/electrum/decodeRawTransaction.hex.test.ts`: genesis
coinbase `vout[0].scriptPubKey.hex` equals the script bytes as hex; `hash` equals `txid` without witness data and the
full-serialization hash for a segwit spend. **Red on base:** both cases (`expected '65,4,103,…'`). Green after, plus
861 Electrum/blockchain/sync/API tests.

**Delivery.** Commit `8d113f378c` on the integration branch (coordinator-authored, through the flock and the hook).

## Implementation log (coordinator)

- Phases A1+A2, B, C, D, E, F, G1, G2–G4 implemented by one worker per worktree and cherry-picked with `-x`; each
  phase branch proven upstream with `git cherry` and removed.
- G2 follow-up (coordinator-verified): `tests/install/utils/assertion-tracking.sh`, new in G1, matched no install
  lane on its own; routed with `helpers.sh` (commit `59a58517a6`, red on base: no lane).
- Phase H added (above).
- `/simplify` pass applied in one refactor commit (shared `singleFlight`, bounded registry health probes with an
  identity guard after unregister, `accessibleDeviceWhere`, `clearUploadedBackup`); pinned advanced-tx ranges
  byte-identical.
- Adversarial review: no P0–P2. New P3 backlog: `cpfp-rbf--witness-padding-inflates-vsize`,
  `device-delete--conflict-lists-other-users-wallet-names`, `advanced-tx--redundant-sequential-node-fetches`.

## Verification (before every push)

Workers run only their phase's typechecks and targeted tests (no coverage, no Stryker) and record red runs on the
plan-commit base. The integrator runs the whole block below, as written, as one script on the integrated PR branch in
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i11` (every `cd server` is in a subshell), only after every non-held
phase branch is cherry-picked, and is the only one who runs coverage and Stryker.

**Integrator step before the block.** Run `npm run arch:graphs` and `npm run arch:calls` and commit
`docs/architecture/generated` in the integrator commit (with the changelog bullets), so `arch:check` below is a pure
check.

```bash
set -euo pipefail
# heavy-run guard (D-11.20): bounded wait, fails loudly; covers vitest coverage (incl. `npx vitest run --config ... --coverage`) and Stryker
wait_for_no_coverage() {
  for _ in $(seq 1 180); do
    if ! pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage' >/dev/null && ! pgrep -f '[s]tryker run' >/dev/null; then
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
( cd server && npx vitest run tests/unit/services/bitcoin/advancedTx.test.ts tests/unit/services/bitcoin/advancedTx \
  tests/unit/services/bitcoin/advancedTx.pubkeyBranch.test.ts tests/unit/services/bitcoin/industry \
  tests/unit/services/bitcoin/transactionService.test.ts tests/unit/services/bitcoin/transactionService.create.test.ts \
  tests/unit/services/bitcoin/transactionService.batch.test.ts tests/unit/services/bitcoin/transactionHelpers.legacyRawTx.test.ts \
  tests/unit/services/twoFactorService.test.ts tests/unit/api/auth.routes.2fa.test.ts tests/unit/api/auth2fa \
  tests/unit/api/auth.routes.registration.test.ts \
  tests/unit/providers tests/unit/services/price.test.ts tests/unit/services/price.health.test.ts tests/unit/services/push \
  tests/unit/api/price.test.ts tests/unit/services/bitcoin/nodeClient.test.ts tests/unit/services/bitcoin/electrum \
  tests/unit/services/adminElectrumServerService.test.ts tests/unit/api/node.test.ts tests/unit/api/node.proxy.test.ts \
  tests/unit/api/electrumServers.test.ts tests/unit/api/admin-nodeConfig-routes.test.ts tests/unit/repositories/deviceRepository.test.ts \
  tests/unit/services/wallet tests/unit/services/walletImport tests/unit/api/openapi.test.ts )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only; scoped as CI
# integration (real DB via the compose-backed runner; serialized host-wide)
flock /home/nekoguntai/.i11-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/wallet.integration.test.ts
# funds-path mutation proof (D-11.3): fee-policy profile, then the scoped map check; runs after A1 AND A2 are
# cherry-picked (A2 rewrites fixtures in fee-policy testFiles transactionService.{create,batch}.test.ts)
wait_for_no_coverage || exit 1
npm --prefix server run test:mutation:fee-policy
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { validateMutationEvidence } from './scripts/ci/check-wallet-safety-mutation-map.mjs'; const map = JSON.parse(readFileSync('config/wallet-safety-mutation-map.json', 'utf8')); const profiles = map.profiles.filter((p) => p.id === 'serverFeePolicy'); validateMutationEvidence({ ...map, profiles }, new Map([['serverFeePolicy', JSON.parse(readFileSync('server/reports/mutation/fee-policy.json', 'utf8'))]])); console.log('serverFeePolicy canaries present and killed by their named tests');"
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold
# Playwright (CLAUDE.md static-build procedure; no host dev server). Scratch inputs written by the integrator before the
# block:
# - $PW_DIR/playwright.static.config.mts, a wrapper that imports the repo config by absolute path (a copied config
#   cannot load outside the repo, and config/tooling/playwright.config.ts:5 derives repoRoot from its own directory):
#     import base from '/home/nekoguntai/sanctuary-bug-scrub-20261013-i11/config/tooling/playwright.config.ts';
#     export default { ...base, webServer: undefined, use: { ...base.use, baseURL: 'http://127.0.0.1:4173' }, projects: base.projects?.filter((p) => p.name === 'chromium') };
#   Chromium only, as CI (test.yml:1674, scripts/ci/run-lane.sh:200-206) and the *-chromium-linux.png baselines;
#   `--list` reports 401 tests in 19 files.
# - $PW_DIR/known-auth-login-failures.txt: the 7 known static-server POST /auth/login cases, one `file :: title` per
#   line, sorted, built from a chromium-only JSON run of this same wrapper (`.file` relative to testDir, e.g. auth.spec.ts).
# Known limitation: the static server cannot answer POST /auth/login, so those 7 cases fail here; the Playwright exit
# status is recorded, not gated. Bounded and non-vacuous: the block fails if results.json is empty, if fewer than 380
# tests executed, or if any failing case is outside that list.
PW_DIR=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad/i11-playwright
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done   # bounded readiness wait (30 s)
curl -fsS -o /dev/null http://127.0.0.1:4173/   # readiness gate: fails if the static server never came up
PW_RC=0
npx playwright test --config "$PW_DIR/playwright.static.config.mts" --reporter=json >"$PW_DIR/results.json" || PW_RC=$?   # chromium suite incl. admin-operations.spec.ts (restore tab, :490) and render-regression.spec.ts
echo "playwright exit $PW_RC (recorded)"
test -s "$PW_DIR/results.json"
test "$(jq '.stats.expected + .stats.unexpected + .stats.flaky' "$PW_DIR/results.json")" -ge 380   # executed-count floor (401 listed)
jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | .file + " :: " + .title] | .[]' "$PW_DIR/results.json" | sort -u >"$PW_DIR/failing.txt"
comm -23 "$PW_DIR/failing.txt" "$PW_DIR/known-auth-login-failures.txt" >"$PW_DIR/unexpected.txt"
test "$(wc -l <"$PW_DIR/known-auth-login-failures.txt")" -eq 7
test ! -s "$PW_DIR/unexpected.txt" || { echo "Playwright failures beyond the 7 known auth/login cases:" >&2; cat "$PW_DIR/unexpected.txt" >&2; exit 1; }
git diff --exit-code -- tests/e2e/render-regression.spec.ts-snapshots   # PNG baselines unchanged
# quality gates
npm run lint
npm run quality:lizard                             # cap 86; 84 on the base (D-11.19)
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh   # fresh dir
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run arch:check                                 # pure check: graphs regenerated and committed before the block
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
npm run verify:signer-inventory
npm run check:safety-catch-guards
npm run check:wallet-sync-mutation-boundaries
npm run check:wallet-sync-lifecycle-contract
npm run check:openapi-route-coverage
npm run check:api-body-validation
# CI classifier and install suites (G)
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/plan-test-run.test.sh
bash tests/ci/classify-quality-scope.test.sh
bash tests/ci/check-workflow-composition.test.sh
bash tests/ci/pre-commit-agent-gate.test.sh
bash tests/ci/ci-registration-completeness.test.sh
bash tests/ci/classify-verify-vectors-scope.test.sh
sh -c '. scripts/ci/classify-files-lib.sh; is_render_file tests/e2e/helpers.ts'   # lib still sources under POSIX sh
bash scripts/ci/run-install-unit-tests.sh          # all tests/install/unit suites, incl. install-scope and the new tracking test; installs tests/ci/lib
node tests/install/unit/install-workflow-trigger-contract.test.mjs   # needs tests/ci/lib from the line above
npx vitest run --config config/tooling/vitest.config.ts tests/ci/renderHarnessInputsClassified.test.ts
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree
echo "verification block: all gates passed"
```

If the integration DB cannot start, record the
failure and rely on the `wallet` integration CI group (`backend-integration-groups.sh:53`), never skip silently.
`/simplify` and an adversarial review before committing; commits in the foreground through
`flock /home/nekoguntai/.i11-commit.lock git commit …`; never while a coverage/Stryker run is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i11` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i11`),
  one commit per finding (test + fix; A1 may be two commits: fixture migration, then fix), then the integrator commit
  (changelog `[Unreleased]` bullets, regenerated `docs/architecture/generated`).
- **Workers (D-11.20):** phases A1, B, C, D, E, F, G1, G in parallel, each in
  `/home/nekoguntai/sanctuary-bug-scrub-20261013-i11-<phase>` on `codex/bug-scrub-loop/20261013-i11-<phase>`; A2 after A1
  (stacked). Workers edit only owned files, run typechecks and targeted tests, run lizard on changed files (zero new
  warnings), record red runs, and commit through the flock. A1 records the line delta of every pinned range (expected
  0) and, if non-zero, the map/stryker re-pin it made.
- **Integrator:** cherry-picks serially (A1, A2, B, C, D, E, F, G1, G), never resolves a conflict by editing another
  phase's files (conflicts go back to the owner), then runs the block. After the cherry-picks land, each phase branch
  is proven upstream with `git cherry codex/bug-scrub-loop/20261013-i11 <phase-branch>` (every line `-`), deleted with
  `git branch -D`, and its worktree removed by path; a held phase (D-11.21) keeps branch and worktree.
- **Merge:** squash through protected `main`; no admin bypass; poll required contexts via `/commits/<sha>/statuses`
  (not the combined status); verify-vectors runs (A1/A2/E1 touch `server/src/services/bitcoin/**`) including the
  fee-policy proof; install-test and release-candidate PR lanes run (G edits workflows, `tests/install/**`); expect the
  release-surface PR smoke. Any retrigger carries the CLAUDE.md four-part evidence. Verify the reported
  `merge_commit_sha` is an ancestor of `origin/main` before deleting the branch. Merges are serial; do not rebase other
  open PRs.
- **PR-body flags:** A1 P1 + folded P3, fail-closed semantics (D-11.2: advisory early returns unauthenticated by
  design), mutation pins unchanged or re-pinned with the Killed evidence; A2 legacy-send fix (direct
`nodeTransactionAuthentication` import, no new cycle; fee-policy proof run after A2); B1 response key unchanged and
  no logging of the plaintext; C1 public route kept with a 30 s single-flight cache (and the shared-registry side effect
  on push); D1 150 s timeout, unknown-outcome UX and the server-side residual (D-11.9); E1 saved-proxy semantics, fail
  closed, no unhealthy mark for proxy-config faults, `/node/test` delegation (a resolver throw → `{ success: false }`, no
  socket); F1 access parity with import (viewer may
  use a shared device's existing account; no new data exposure); G1 counter design, the scratch reproduction, every
  unmasked failure and its classification, the fresh-install dispatch run id; G2 CI-cost increase (release-surface PR
  smoke for `migrate.sh`); G3 exact paths + guard, type-only `src/types` imports out of scope, and the D-11.17 residual
(a new unclassified render-harness import is caught by the scheduled full scan, not on the PR that adds it; lane not
widened); G4 exact subjects + guard (tracked files only, derived set equals the seven tracked subjects; the untracked
  `lockfile-peer-resolution-allowlist.txt` routed as an optional subject asserted only by the loop entry); G1
  registration in `run-all-tests.sh` (mode 100755, accepts/ignores `--verbose`);
  "no e2e mock-map or OpenAPI shape change"; the P3 backlog stays outside this PR.
- **Rollback:** every phase is code/CI-only and independent (only G1 can be held alone, D-11.21). No schema, data-migration or
  stored-shape change: B1 stores the same ciphertext format; C1/E1/F1/D1 change runtime behaviour only. Reverting A1
  re-opens the forgery path; reverting F1 re-narrows device lookup; reverting G2–G4 only removes CI triggers.
- **Concurrency:** C1's in-flight map is per registry instance and cleared on settle, `unregister` and `shutdown`; E1
  resolves the proxy per test call (no cache); A1 adds no shared state.
- **Deployment:** none until clean closeout (coordinator policy); the local stack is rebuilt only after the loop closes.

## Completion criteria

- [ ] Every failing-first test above fails on `f793fbb90f` code (red runs recorded per phase) and passes on the PR head;
  A1's behavioural reds 1-6 and the folded-P3 reds 3-4 are among them.
- [ ] A1: every `serverFeePolicy` canary present and `Killed` by its named test in `server/reports/mutation/fee-policy.json`;
  pinned-range line deltas recorded (expected 0) and map + `stryker.fee-policy.config.mjs` re-pinned if not.
- [ ] A2 (P1, SQ-1 accepted) shipped with its non-regression test; its known migrations
  (`transactionServiceBatch.create.contracts.ts`, `psbt-helpers-legacy.contracts.ts`) green; the fee-policy profile run
  after A2 with every `serverFeePolicy` canary Killed.
- [ ] G1: every unmasked failure reported and resolved per D-11.15; fresh-install dispatch run recorded.
- [ ] Verification block run as written on the integrated branch with exit status 0 recorded; integration run executed
  through the flock'd `test:integration:db`.
- [ ] Playwright (static build, chromium-only `playwright.static.config.mts` wrapper importing the repo config) run
  recorded: exit status, a non-empty `results.json` with at least 380 executed tests, the failing set, and its
  classification — only the 7 known static-server `POST /auth/login` cases (list built from the same chromium-only run)
  may fail (any other failure is real and blocks); render-regression PNG baselines unchanged. CI's browser lane is binding.
- [ ] PR merged; target-branch CI green on its merge commit; ancestry verified; branches and worktrees cleaned
  (`git cherry` proof per phase branch); held phases kept.
- [ ] PR body carries every flag listed under Delivery.
- [ ] Run state updated (findings resolved, folded P3 resolved by A1, A2 finding
  `legacy-send--raw-tx-helper-returns-decoded-object` resolved, decisions D-11.1…D-11.21 recorded).
- [ ] P3 backlog remains outside the blocking fix set.

## Review log

- Pass 0 (2026-10-20): plan authored from plan11-decisions and scrub11-S1…S10; all ten blocking findings re-verified at
  `f793fbb90f`, none rejected; fee-math P3 folded into A1; SQ-1 raised for the coordinator; lizard re-measured (84/86).
- Pass 1 (2026-10-21): 6 accepted comments applied (A 3, G 3); B, C, D, E, F clean; rejected: none.
- Pass 2 (2026-10-21): 7 accepted comments applied (A1 1, E 1, G/cross-cutting 5); A2, B, C, D, F clean; rejected: none.
- Pass 3 (2026-10-21): 5 accepted comments applied (A2 1, G1 2, G3 1, Verification 1); A1, B, C, D, E, F, G2, G4 clean; rejected: none.
- Pass 4 (2026-10-21): 2 accepted comments applied (B confirm-red/targeted paths, Verification Playwright wrapper + non-vacuous checks); A, C, D, E, F, G clean; rejected: none.
- Pass 5 (2026-10-21): 2 accepted comments applied (E and F confirm-red commands that actually execute the registering suite / the integration DB); A, B, C, D, G and cross-cutting clean; rejected: none.
- Pass 6 (2026-10-21): 2 accepted comments applied (D confirm-red command with the frontend Vitest config; A2 decode network literal 'testnet3', a valid BitcoinNetwork); A1, B, C, E, F, G and cross-cutting clean; rejected: none.
- Pass 7 (2026-10-21): 3 accepted comments applied (A2 fetchRawTransactionsForLegacy network argument; A1 confirm-red includes the standalone nodeTransactionAuthentication.test.ts; G1 runner call form moved out of the errexit-ignored `||` context with INSTALL_TEST_LAST_STATUS, plus an in-body `set -e` fixture); B, C, D, E, F, G2, G3, G4 and cross-cutting clean; rejected: none.
- Pass 8 (2026-10-21): clean — no verified actionable comments in any section (A, B–F, G incl. end-to-end probes of the D-11.14 runner design). Converged after 8 passes; origin/main unchanged at f793fbb90f, so every finding stands as re-verified.
