# Bug scrub loop iteration 5: align access, transaction, and UI state contracts

Source target: `8268726550e14ead6c7974a9fa81aa40d17e7884` (`origin/main`). Scope: whole repository. The iteration 4 merge is the only change from the prior scrub target. Six P2 findings remain after source and caller review; all five exact merge-SHA target workflows passed before acceptance into the durable coverage pass.

## Goal and evidence

1. **Group-only mobile wallet access is denied.** `mobilePermissionService.getWalletRole` reads only `WalletUser` (`server/src/services/mobilePermissions/mobilePermissionService.ts:441-446`), while `getUserWalletRoleUncached` resolves group membership when no direct grant exists (`server/src/services/accessControl.ts:59-76`). Gateway action checks return 403 for a group signer that the wallet service permits to edit. Permission list/read paths also assume direct grants.
2. **Wallet import can add an account to a viewer-shared device.** `resolveDevices` matches every device shared with the importer (`server/src/services/walletImport/deviceResolution.ts:42-69`); `reuseImportedDevice` creates a missing `DeviceAccount` on that device (`walletImportService.ts:160-205`) without checking owner access. The ordinary account-add API requires device owner access (`server/src/api/devices/accounts.ts:49-68`).
3. **An edit-only Telegram draft can reach a direct viewer.** `findByWalletAccess` ORs a qualifying group role with a direct role (`server/src/repositories/userRepository.ts:361-381`). Agent draft notifications request owner/signer recipients (`server/src/services/telegram/notifications.ts:54-57,284`), but a direct viewer in a signer group matches the group branch despite direct-first role precedence.
4. **RBF creation accepts less than its advertised fee bump.** `canReplaceTransaction` reports `minNewFeeRate` from the current rate plus at least 1 sat/vB or 10% (`server/src/services/bitcoin/advancedTx/rbf.ts:123-129`), but `createRBFTransaction` checks only `newFeeRate > currentFeeRate` (`:182-186`). The RBF UI treats the reported minimum as a hard bound. An API client can create a replacement PSBT that fails relay policy.
5. **The dashboard can show another network's status and explorer.** `useBitcoinStatus` retains previous data during a network switch; `useDashboardData` filters fee and mempool placeholders but passes raw Bitcoin status to MempoolSection and recent transaction presenters (`src/components/Dashboard/hooks/useDashboardData.ts:85-100,194,401-402`). The NodeStatusCard path already filters network identity.
6. **Overlapping wallet renames can restore an obsolete name.** `useWalletMutations.handleUpdateWallet` permits same-wallet requests to overlap and an older failure rolls back to its captured `wallet.name` (`src/components/WalletDetail/hooks/useWalletMutations.ts:65-84`). A newer successful rename can therefore be hidden by the old failure; reversed server completion can also leave server and UI names divergent.

## Assumptions and limits

- Preserve direct-first wallet role precedence, existing mobile owner maximum and self-restriction behavior, and group sharing policy. Resolve roles from durable relationships at authorization points.
- Preserve exact existing-account reuse during wallet import for a user who still has device access. Recheck effective access inside the import transaction before every existing-device reuse, and require ownership immediately before adding a new account. Keep import atomic and do not alter descriptor validation. A transaction-time check closes stale pre-resolution access; it does not by itself serialize a concurrent revocation after that check.
- Preserve unfiltered wallet notification audiences. Apply direct-first precedence when a role filter is requested; keep agent draft formatting and per-user Telegram preferences.
- Keep the existing RBF minimum formula and message, but enforce the advertised bound at creation. Do not change CPFP or transaction signing semantics.
- Keep dashboard cached results for the selected network and the existing node card freshness rules; only withhold foreign-network or placeholder status from presenters.
- Preserve immediate optimistic rename display and route ownership fencing. Serialize same-wallet writes so server order matches user order, and roll back only the newest failed edit to the last confirmed name without replacing unrelated wallet fields.

## Phase 1 — access and persistence PR

- [x] Add behavioral regressions for group-only mobile viewer/signer/owner, mixed direct viewer plus signer group, outsider, saved restrictions, and owner cap/list views. Show current service/gateway behavior fails; use real PostgreSQL relationships where role precedence matters.
- [x] Reuse canonical direct-first wallet role resolution in mobile permission checks and read/list results. Deduplicate users in owner listings and exclude revoked access; keep owner maximum and per-user restrictions intact.
- [x] Add wallet import regressions with a viewer-shared device and new derivation path (deny with no partial account/wallet writes), an owner adding a path (allow), an authorized viewer reusing an exact account (allow), and access revoked after resolution but before transaction (deny exact reuse). Recheck current effective device access for every reused device inside the transaction and require current owner role before a new `DeviceAccount` insert. Review whether the device-sharing mutation path needs a common lock or stronger isolation for a concurrent revocation after the check; record the observed limit rather than claiming serializable revocation safety without it.
- [x] Add a real PostgreSQL `findByWalletAccess` role-filter regression: direct viewer plus group signer excluded, group-only signer and direct signer included, outsider excluded. Assert an agent draft does not send to the excluded recipient. Restrict the group branch to users with no direct wallet grant when role filtering.
- [x] Re-read the permission, import, and notification call chains for role parsing, transaction atomicity, and unintended changes. Run focused tests, guarded PostgreSQL integration tests with signed cleanup evidence, typechecks, full required server/root coverage and lint/architecture gates, adversarial review, and pre-commit checks.
- [x] Record verified merge and target-CI evidence in the completed iteration 3 and 4 plan files; keep this documentation change with the first iteration 5 PR.

Acceptance: group-only mobile users receive actions allowed by their wallet role and saved restrictions; a viewer cannot add accounts to a shared device through import; edit-only agent drafts reach only effective owner/signer users.

## Phase 2 — RBF contract PR

- [ ] Add a red service/API regression with an original 5 sat/vB transaction and requested 5.1 sat/vB where the check reports a 6 sat/vB minimum. The create path must reject before building a PSBT. Cover equality at the reported minimum, decimal rounding, and an eligible higher rate with a signable fixture.
- [ ] Enforce `minNewFeeRate` from the same check result used by the UI, retain useful `InvalidInputError` details, and review absolute fee delta handling for any narrower relay-policy boundary.
- [ ] Run focused transaction tests, typechecks, full required coverage/lint/architecture gates, adversarial review, and pre-commit checks.

Acceptance: the public create route rejects rates below the minimum it reports and accepts valid rates at or above it, subject to existing transaction constraints.

## Phase 3 — client state PR

- [ ] Add network-switch regressions proving pending mainnet status is absent from testnet node, explorer, and confirmation presenters; test matching network, mismatched non-placeholder, empty, and error cases. Gate dashboard status through the same network-aware query result already used by NodeStatusCard.
- [ ] Add deferred same-wallet rename regressions: first failure then newer success; first success then newer failure; both fail; both succeed; route switch while queued; and an external sync snapshot with other updated fields. Serialize same-route API writes, track the last confirmed name, and only let the latest failed request roll back its own optimistic name.
- [ ] Re-read client ownership, loading, and error behavior. Run focused tests, root typechecks/full coverage/lint/architecture gates, adversarial review, and pre-commit checks.

Acceptance: a network switch never exposes prior-network status or explorer links under the new network; overlapping renames finish with the newest confirmed server name and preserve unrelated wallet state.

## Verification and delivery

Use Node 24.21.0/npm 12.0.2. Review this executable plan recursively until no material comments remain. Deliver each phase through `pr-delivery`: exact head checks green, verified squash-merge ancestry, and all exact merge-SHA target workflows green before the next phase. Keep the already-running local stack rebuild for final clean closeout. Refresh `origin/main` and run the complete eight-domain scrub after the final phase; continue the loop for any new P0–P2 finding.

Backout: revert the affected phase PR. No schema migration or data repair is planned.

## Phase 1 implementation evidence before PR

- The filtered Telegram audience query failed its direct-first unit assertion before production changes and passed afterward. A real PostgreSQL test verifies direct viewer plus group signer is excluded while group-only and direct signers are included; the agent-draft service test verifies an empty edit audience sends no message.
- Mobile permission unit and real PostgreSQL tests cover direct-first group access across gateway actions, saved restrictions, owner listings, caps, and revoked access. Import tests cover viewer denial with no writes, owner account creation, authorized viewer exact reuse, group roles, and access revoked after resolution. The import role query was also verified against real PostgreSQL.
- Each of the three disposable PostgreSQL runs ended with signed `cleanupState: cleaned` evidence. The full server suite passed 16,389 tests with 100% statements, branches, functions, and lines after a serial rerun; root coverage passed 8,714 tests at 100%. All app/root/server test typechecks, server lint, architecture boundaries, signer inventory, large-file classification, and integration-manifest checks passed. Independent adversarial review found no actionable P0–P2 issue.
- A simultaneous revocation after import's final transaction-time role check can still race because the sharing mutation path uses no common lock. The fix closes stale pre-resolution access and enforces owner role before each new account insert; no stronger serializable claim is made.
