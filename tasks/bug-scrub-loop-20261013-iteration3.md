# Bug-scrub loop 2026-10-13 — iteration 3 remediation plan

- Run: `bug-scrub-loop-20261013-sanctuary`, iteration 3
- Source SHA: `336bc94b59517fb913a117a8d1522e66df5690d7` (origin/main after PRs #1387, #1388)
- Scope: whole repository (locked at run start)
- Branch / worktree: `codex/bug-scrub-loop/20261013-i3` in `/tmp/sanctuary-bug-scrub-20261013-i3-scrub`
  (per-PR delivery branches are cut from this plan branch, see Delivery)
- Deploy policy `final`: no container rebuild in this plan.

## Goal

Fix all 41 P0–P2 findings accepted by the iteration-3 rescrub (4 P1, 37 P2), each with a
non-regression test that fails on `336bc94b` and passes after the fix. A phase whose
test-first gate passes on `336bc94b` (B6, B11, B17 are marked as such) is instead recorded
as `rejected` with that evidence and dropped from its PR.

## Non-goals

- All P3 findings (~72 in run state backlog), including the P3s noted inside phases.
- Enabling any hardware capability row (all rows are `enabled: false` since #811, so A4/A6/A7
  are latent; they are fixed but nothing is enabled).
- Prisma schema or migration changes (RC10 migration digest is pinned).
- Product-policy changes beyond the explicitly flagged **Decision** items, each of which
  takes the conservative option (fail closed, reject invalid config, or label partial data).

## Assumptions

- Express 5, Prisma 7 (`server/package.json` `^7.10.0`) and bitcoinjs-lib 7.0.2 behave as cited in each phase; phases whose
  behaviour is uncertain carry a test-first gate.
- The primary checkout's `node_modules` is stale (`@modelcontextprotocol/sdk` 1.30.1 vs the
  locked 1.32.1). Implementation must run `npm ci` inside the implementation worktree (with
  nvm node 24.21.0 / npm 12) instead of symlinking the primary checkout's `node_modules`.

## Delivery groups and PR sequence

The fix set is split into four PRs, merged strictly serially in this order:

1. **PR A — funds & signing (A1–A11).** Touches `config/wallet-safety-mutation-map.json` pins,
   the critical-mutation lane and verify-vectors/emulator lanes; isolating it keeps those
   expensive, funds-critical gates attributable to funds changes only.
2. **PR B — server data & edge (B1–B17).**
3. **PR C — frontend non-signing + tests (C1–C6).**
4. **PR D — CI/ops/install (D1–D7).** Changes lane classification (`classify-files-lib.sh`) and
   install scripts (install-test lanes); landing it last avoids changing the CI lane plan
   underneath PRs A–C.

Split rationale (required by the loop contract): distinct gating surfaces (wallet-safety
mutation map and verify-vectors provenance for A; classifier/lane semantics for D) and
review size (~41 findings). Each PR carries its own phase commits and regression tests; the
plan file lands with PR A. Each PR is rebased onto the previous merge before its CI run.

## Group A — PR A — funds & signing (bug-scrub iteration 3, base 336bc94b)

All line numbers re-verified in `/tmp/sanctuary-bug-scrub-20261013-i3-scrub` at 336bc94b.

### Cross-cutting gating facts (read before any phase)

- **Capability manifest is all-disabled at 336bc94b.** `shared/constants/hardwareWalletCapabilities.ts:282` builds every row with `enabled: false`. So:
  - server `getHardwareWalletCapabilityDecision` returns `allowed:false` for every identified vendor (`hardwareWalletCapabilities.ts:83-91`);
  - browser `assertHardwareActionEnabled` (`src/services/hardwareWallet/service.ts:53-63`) throws on every USB connect.

  As a result, A4 (payjoin receiver, blocked at `receiver.ts:57`), A6 and A7 (USB connect) cannot be reached in production today. They are still real code defects that become live as soon as any row is enabled, so they are fixed here. Their severities are kept as filed, with "latent" noted.
- **Pins to update or regenerate (exact list):**
  1. `config/wallet-safety-mutation-map.json` has no generator. Edit it by hand and check it against the Stryker reports.
     - `serverFeePolicy` / `rbf-input-policy-drives-exact-weight` (`rbf.ts` 231-241, canary 231:54-241:4) shifts by the net line delta that A3 adds above line 231.
     - `serverTaprootArtifactFinalization`: four invariants on `artifactValidation.ts` (321-457; canaries 336/337/343/355/368/377/418/438/453-455) shift by +1 if A2 adds a new import line. Prefer that over a two-statement line.
     - `serverFeePolicy` / `fee-surplus-is-independently-bounded` (`feePolicy.ts` 136-159, canary 150:72-157:4) and `cpfp-package-fee-is-conserved` (`cpfp.ts` 56-64) stay unchanged if the A2 edits are line-neutral, as prescribed.
     - Check locally:
       - run `npm --prefix server run test:mutation:fee-policy` (writes `server/reports/mutation/fee-policy.json`) and `npm --prefix server run test:mutation:taproot-artifact-finalization`;
       - `jq` each pinned canary's `location` / `mutatorName` / `replacement` out of those reports and confirm it is `Killed`;
       - run `node --test tests/ci/check-wallet-safety-mutation-map.test.mjs`.

       `node scripts/ci/check-wallet-safety-mutation-map.mjs` needs all six profile reports. CI's `verify-vectors-mutation` job is the authority.
     - `minScore` floors still apply: `feePolicy.ts` 60 and `rbf.ts` 75.
  2. `config/hardware-wallet-implementation-inventory.json`: `npm run verify:signer-inventory`, then `npm run generate:signer-inventory` if it drifts. No drift is expected:
     - keep exactly one `assertWalletHardwareCapabilityById` call in `receiver.ts` (inventory line 133, count 1);
     - add no new `finalize*`, `sign*` or `broadcast*` identifiers (memory: the `finalize*` prefix is swept into the funds-execution inventory). `finalizeMultisigInput` keeps its name and count.
  3. Critical-mutation lane: `feePolicy.ts` and `artifactValidation.ts` match `server/src/services/bitcoin/signingIntent/*` in `scripts/ci/classify-files-lib.sh:73` (`is_critical_mutation_file`). That runs shard 3 of `server/stryker.critical.config.mjs`, gated by `.github/mutation-baseline.json` (raw 52 / weighted 48). Every new branch needs a killing unit test.
  4. verify-vectors provenance:
     - None of `scripts/verify-addresses/sourceManifest.ts` `VERIFIER_SOURCE_FILES` is touched, so `tests/scripts/verifyAddressesGenerated.test.ts` is unaffected.
     - The hardware-signed evidence manifest (`server/tests/helpers/hardwareSignedEvidenceProvenance.ts:15-35` plus its import closure) does cover `artifactValidation.ts`, `multisigFinalization.ts`, `feePolicy.ts`, `useUsbSigning.ts`, `src/services/hardwareWallet/service.ts` and `types.ts`. But `HARDWARE_SIGNED_PSBT_VECTORS` is `[]` (`server/tests/fixtures/hardware-signed-psbt-vectors.ts:413`), so there is nothing to recapture. Recheck this if a vector lands before merge.
  5. Expected lanes:
     - `config/wallet-safety-critical-paths.json` (`server/src/services/bitcoin/**`, `server/src/services/payjoin/**`) triggers verify-vectors;
     - `config/hardware-emulator-source-inventory.json` lists `useUsbSigning.ts` and `service.ts`, so the emulator lanes run. That inventory needs no edit because there is no closure check.
  6. Release-time only: `tests/fixtures/wallet-safety-required-files.json` lists `useUsbSigning.ts` and `useQRSigningModalController.ts`. The next RC needs wallet-safety audit review evidence (`tests/release/wallet-safety-audit-review.test.mjs`).
  7. Imports: `cpfp.ts:29` already imports `{ estimateTransactionWeight, feeForRate }` from `'../transactionWeight'`, and `rbf.ts:15` is the repositories import line (`{ walletRepository, addressRepository }`). A2 and A3 must **extend these existing import lines in place**. A new import line above the cpfp pin would shift `cpfp-package-fee-is-conserved` (56-64, canary 60:20-60:40) by +1, and would mis-count the rbf Δ.
  8. Large files: `artifactValidation.test.ts` (1,086 lines) is classified (`large-file-classification.json:125`), so extending it is fine. `advancedTx.rbf-creation.contracts.ts` is 999 lines and unclassified: put A3 mock/default changes in `advancedTxTestHarness.ts`. `tests/services/hardwareWallet.service.test.ts` (919) and `tests/hooks/useUsbSigning.test.tsx` (905) are near the limit: add A7 tests compactly, or in a new contracts file if they would cross 1,000. Run `node scripts/quality/check-large-files.mjs`.

---

### Phase A1 — Multisig finalization accepts more than m valid signatures (P2, `multisig-finalize--surplus-signatures-rejected`)

**Evidence**
- `server/src/services/bitcoin/psbtBuilder/multisigFinalization.ts:191-211`: `orderSignatures` returns every sig matching a script pubkey, in script order.
- `:229-240`: `assertSignatureCount` throws when `orderedSigs.length !== requiredSignatures`, so a 2-of-3 PSBT signed by all three cosigners throws `has 3 signatures but needs exactly 2`.
- The only production caller is `signingIntent/artifactValidation.ts:446-461` (`finalizePsbt`). It wraps any throw as `InvalidInputError reason:'not_finalizable'`, so a fully signed PSBT cannot be broadcast.
- The re-exports (`psbtBuilder/index.ts:21`, `bitcoin/index.ts:12`) have no other callers.
- No other server code compares sig counts: `artifactValidation.ts:370/382/451` only test `partialSig?.length` for presence.
- The frontend counters are display only: `useQrSigning.ts:155`, `SigningFlowHeader`.

**Change**
- In `finalizeMultisigInput`, change the `assertSignatureCount` condition to `orderedSigs.length < requiredSignatures`. Keep the zero-match branch, and change the message to `... needs at least ${m} for m-of-n multisig`.
- Pass `orderedSigs.slice(0, state.m)` to `applyFinalWitness` and to the log's `signatureCount`. Any m-subset in script order satisfies `OP_CHECKMULTISIG`, so the first m in script order is deterministic.
- Keep `verifyPartialSignatures` and `assertSignerMetadataMatchesPartialSignatures` over **all** partial sigs. A surplus sig that is invalid or lacks metadata still fails closed.
- No change for P2SH-P2WSH: `applyFinalWitness` already sets `finalScriptSig` from `redeemScript`.
- Do not rename the function or add a `finalize*` helper (signer inventory).

**Test first**
- In `server/tests/unit/services/bitcoin/psbtBuilder.finalization.test.ts`, extend the fixture at :253:
  1. a 2-of-3 P2WSH input signed by all 3 keys. Expect no throw, `extractTransaction(true).ins[0].witness` to have length 4, and `witness[1..2]` to equal the sigs of the first two script-ordered pubkeys.
  2. the same as a P2SH-P2WSH input (redeemScript = `p2wsh.output`). Expect a non-empty `finalScriptSig`.
  3. 3 sigs where the third is corrupted. Expect a `signature verification failed` throw (surplus sigs are still verified).
- Update the expected string at :115 to `needs at least 2`.
- `server/tests/unit/services/bitcoin/psbt.signed-vectors.test.ts:234` asserts `has 1 signatures but needs exactly 2`; update it to the new `needs at least 2` message.
- Add an end-to-end case in `server/tests/unit/services/bitcoin/signingIntent/artifactValidation.test.ts`: a 3-of-3-signed 2-of-3 artifact passes `finalizePsbt` instead of `not_finalizable`.
- Confirm that cases 1 and 2 fail on 336bc94b with `has 3 signatures but needs exactly 2`: `cd server && npx vitest run tests/unit/services/bitcoin/psbtBuilder.finalization.test.ts`.

**Constraints**
- Signer inventory: run `npm run verify:signer-inventory`; no change is expected.
- Not a mutation-map file. `artifactValidation.ts` is untouched by this phase.

**Acceptance**
- A PSBT with ≥ m valid sigs finalizes with exactly m sigs in script order.
- A PSBT with < m sigs, or with any invalid or unmetadata'd sig, is still rejected.
- Backend unit coverage stays at 100%.

---

### Phase A2 — Signing-intent fee policy: integer-exact requested-rate fee (P2, `signing-intent-fee-policy--float-ceil-off-by-one`)

**Evidence**
- `server/src/services/bitcoin/signingIntent/feePolicy.ts:135`: `unsignedFloorFee = Math.ceil(rate * unsigned.virtualSize())`.
- `:145-147`: `maximumSignedFee = Math.ceil(rate * estimatePsbtMaximumSignedVsize(psbt))`.
- `artifactValidation.ts:236`: `requestedFeeSatsAtFinalVsize = Math.ceil(policy.requestedFeeRateSatsPerVbyte * vsize)`.
- Verified in node:
  - `1.1*110 = 121.00000000000001` gives 122, while builders use `feeForRate(110, 1.1) = 121` (`transactionWeight.ts:399-410`). `dustAbsorption = -1` throws `fee_too_low`.
  - CPFP passes `cpfpCalc.childFee / childTxSize` (`cpfp.ts:249-253`): `117/110*110 = 117.00000000000001` gives 118.
- **Correction to the finding:** swapping in `feeForRate` alone does **not** fix the CPFP case. `String(117/110) = "1.0636363636363637"` is a decimal slightly above 117/110, so `feeForRate(110, …)` still yields 118. CPFP must pass a decimal-exact rate that does not exceed `childFee/childTxSize`.

**Change**
1. `feePolicy.ts`:
   - Add `feeForRate` to the **existing** line-9 import (`import { estimateTransactionWeight, feeForRate, type TransactionWeightInput } …`).
   - Line 135 becomes `feeForRate(unsigned.virtualSize(), requestedFeeRateSatsPerVbyte)`.
   - Lines 145-147 keep a 3-line shape: `const maximumSignedFee = feeForRate(` / `estimatePsbtMaximumSignedVsize(psbt), requestedFeeRateSatsPerVbyte,` / `);`.
   - These edits are line-neutral, so the 136-159 pin and the 150:72 canary are unchanged.
2. `artifactValidation.ts:236` uses `feeForRate(vsize, policy.requestedFeeRateSatsPerVbyte)`. Add `import { feeForRate } from '../transactionWeight';`. This shifts lines by +1, so re-pin the four `serverTaprootArtifactFinalization` invariants by +1 (lineStart/lineEnd and every canary start/end line).
   - `feeForRate` throws a plain `Error` only for non-finite or ≤0 rate or vsize < 1. Both are already excluded here (zod `min(0.1)` and the `vsize` guard at :230), so the existing `Number.isSafeInteger` check stays as the overflow guard. The `fee exceeds the safe integer range` throw is unreachable for rate ≤ 1000.
3. `cpfp.ts:249-253`:
   - Pass `exactFeeRateNotAbove(cpfpCalc.childFee, childTxSize)` instead of the float division.
   - Add `exactFeeRateNotAbove` to the **existing** `cpfp.ts:29` import line (`{ estimateTransactionWeight, exactFeeRateNotAbove, feeForRate }`); do not add a new import line, which would shift the `cpfp-package-fee-is-conserved` pin (56-64, canary 60:20-60:40).
   - Add that helper at the end of `transactionWeight.ts`, after line 410, so the pins at 119-161 do not move: `Number((BigInt(fee) * 100_000_000n) / BigInt(vsize)) / 100_000_000`. It validates `fee` as a non-negative safe integer and `vsize` as a positive safe integer.
   - Proof: K = ⌊fee·10⁸/vsize⌋ ≤ 10¹¹ has ≤ 15 significant digits, so `String(K/1e8)` is exactly K·10⁻⁸ and `feeForRate(vsize, K/1e8) = ⌈vsize·K/10⁸⌉ = fee` for vsize < 10⁸. Enumerated: round-trips through `feeForRate` for vsize 50..1999, fee 1..2999.
4. `server/src/api/payjoin.ts:334-337` computes `proposalFeeSurplus` with `Math.ceil(requestedFeeRate * proposalMaximumVsize)`. Once the policy uses `feeForRate`, payjoin send would be rejected as `fee_too_high` whenever float error lands above an integer. Change it to `feeForRate(proposalMaximumVsize, requestedFeeRate)` (extend an existing `transactionWeight` import if present, else add one; `api/payjoin.ts` carries no mutation pins). The `(fee-0.5)/V` rate branch is safe (0 mismatches enumerated) and stays.

**Test first**
- `server/tests/unit/services/bitcoin/signingIntent/feePolicy.test.ts`: build a 1-in/1-out PSBT whose `estimatePsbtMaximumSignedVsize` = V. Set fee = `feeForRate(V, 1.1)` and call `buildSigningIntentFeePolicy(psbt, 1.1, fee)`. Expect no throw and `expectedFeeSats === fee`. On 336bc94b it throws `fee_too_low` whenever `1.1*V` has float error (pick V=110).
  First confirm `estimatePsbtMaximumSignedVsize` for the fixture actually equals the chosen V; if the 1-in/1-out p2wpkh fixture gives a different V, pick a rate r for that V with `Math.ceil(r*V) !== feeForRate(V, r)`.
- `artifactValidation.test.ts`: a finalized tx accepted at tolerance 0 with expectedFee = `feeForRate(vsize, r)`. It uses a real signed fixture whose vsize may not be 110, so the test must take the fixture's actual vsize V and pick a rate r where `Math.ceil(r*V) !== feeForRate(V, r)` (assert that inequality in the test so it cannot pass vacuously on 336bc94b). It fails today with a policy delta of -1.
- `server/tests/unit/api/payjoin.test.ts`: `buildSigningIntentFeePolicy` is **not** mocked there (only `signingIntent/service` is), so assert through the real policy. Use a proposal PSBT with maximum vsize V and a mocked original rate r where `Math.ceil(r*V) !== feeForRate(V, r)` (assert that inequality in the test), and a proposal fee F === `Math.ceil(r*V)` (e.g. F=122 for r=1.1, V=110). Old surplus is 0, so the new policy throws `fee_too_high`; the new surplus is 1. Expect 200 and `mockCreateSigningIntent.mock.calls[0][0].feePolicy.roundingToleranceSats` to include the +1 surplus. It fails if the policy change lands without the surplus change.
- `server/tests/unit/services/bitcoin/advancedTx/advancedTx.cpfp.contracts.ts`:
  - `createCPFPTransaction` where childFee=117 and childTxSize=110 returns a `feePolicy` whose rate is ≤ 117/110 and which `buildSigningIntentFeePolicy` accepts;
  - unit tests for `exactFeeRateNotAbove` in `tests/unit/services/bitcoin/transactionWeight.test.ts` covering the boundary, invalid input and exact divisibility.

**Constraints**
- Mutation map:
  - `artifactValidation` pins +1 as above;
  - the feePolicy pins are unchanged (verify the 150:72-157:4 BlockStatement canary in the fee-policy report);
  - add a `feeForRate` ArithmeticOperator survivor check: the new test must kill a `Math.ceil` → `Math.floor` style mutation.
- Critical-mutation shard 3 runs (signingIntent/*).
- `minScore` 60 (`feePolicy.ts`) and 80 (`transactionWeight.ts`).

**Acceptance**
- For every rate the builders admit, the policy accepts exactly the fee the builders produce, including CPFP and the payjoin send surplus.
- The broadcast-time check (`artifactValidation`) uses the identical integer arithmetic.

---

### Phase A3 — RBF check: detect a confirmed original without decoded-tx `confirmations` (P2, `rbf-check--confirmed-original-not-detected`)

**Evidence**
- `server/src/services/bitcoin/advancedTx/rbf.ts:77-86` reads `txDetails.confirmations`.
- The node client's `getTransaction` on Electrum is `electrum/methods.ts:270-277`: `blockchain.transaction.get [txid,false]` passed to `decodeRawTransaction`, which has no confirmations field. The branch is dead on Electrum, the only `NodeClient` backend.
- `api/bitcoin/transactions.ts:142-158` (`rbf-check`) and `:164-208` (`rbf`) only require that the DB row exists (`requireWalletTransaction`, :99-107). `createRBFTransaction` calls `canReplaceTransaction` (`rbf.ts:186`), so a confirmed tx gets a replacement PSBT and signing intent. The failure appears only at broadcast, after hardware signing.
- The tests mock `confirmations: 1` (`advancedTx.rbf-detection.contracts.ts:60-71`), which hides this.

**Change**
- `canReplaceTransaction(txid, network, walletId?)`:
  - (a) If `walletId` is given, load `transactionRepository.findByTxid(txid, walletId)` (read-only, existing repo). Treat the original as confirmed when `confirmations > 0 || blockHeight != null && blockHeight > 0`.
  - (b) **Decided:** skip the Electrum check when the DB row already settles confirmation (case (a) says confirmed). Otherwise, after the tx is decoded, pick the output address to query: prefer a **wallet-owned** output address (change or own receive address, matched against the wallet's addresses), and only when none exists fall back to the first output with a decodable address (`bitcoin.address.fromOutputScript`, terminal try/catch → skip OP_RETURN). Call `client.getAddressHistory(address)` and treat it as confirmed when an entry has `tx_hash === txid && height > 0`.
  - Either source saying confirmed returns `{replaceable:false, reason:'Transaction is already confirmed'}`.
  - A history lookup error returns `upstreamError:true` (fail closed).
  - Remove the dead `txDetails.confirmations` branch.
- **Decision (residual limitation):** `getAddressHistory` on a busy third-party payee address can error ("history too large" or a timeout), and failing closed would then block RBF for that tx. Preferring a wallet-owned output and skipping the lookup when the DB row settles it make that rare; the remaining case (no wallet-owned output, busy payee address, DB row not settled) still fails closed with `upstreamError:true`. Accepted as the conservative cost; noted as a follow-up.
- Pass `walletId` from `createRBFTransaction` (`rbf.ts:186`) and from the `rbf-check` route (:155). (`requireWalletTransaction` at `transactions.ts:153,178` already loads the row, but the lookup stays inside `canReplaceTransaction` so the service path via `createRBFTransaction` is covered by one implementation; the route signature is otherwise unchanged.)
- Add `transactionRepository` to the **existing** repository import line (`rbf.ts:15`); do not add a new import line (it would distort Δ).
- Put the new helper (`isOriginalConfirmed`) **after** `createRBFTransaction` (function declarations hoist). Count the net line delta Δ inside `canReplaceTransaction`, which sits above line 231.
- Safety-catch gate: `scripts/check-safety-catch-guards.mjs` scans `services/bitcoin`, and `scripts/quality/safety-catch-allowlist.json:14` allows exactly 1 non-terminal catch for `rbf.ts:canReplaceTransaction`. Write the address decoder as a terminal catch (`try { return bitcoin.address.fromOutputScript(...) } catch { return null }`) in its own small function, and make every catch in `isOriginalConfirmed` end in `return`/`throw`, so no allowlist entry is needed. Keep `canReplaceTransaction`'s non-terminal catch count at 1 (removing the dead branch must not change it; if it does, update the allowlist count to match).

**Test first**
- In `server/tests/unit/services/bitcoin/advancedTx/advancedTx.rbf-detection.contracts.ts`:
  1. a decoded tx **without** a `confirmations` field (Electrum shape) plus `mockElectrumClient.getAddressHistory` → `[{tx_hash: txid, height: 850000}]`. Expect `replaceable:false` with a `confirmed` reason. Fails today: it returns `replaceable:true`.
  2. the DB row has `confirmations: 3` and history is empty. Expect `replaceable:false`.
  3. history has `height: 0`. Expect replaceable.
  4. `getAddressHistory` rejects. Expect `upstreamError:true`.
  5. the DB row settles confirmation (`blockHeight > 0`). Expect `replaceable:false` and `getAddressHistory` not called.
  6. a tx with a wallet-owned change output and a payee output: `getAddressHistory` is called with the wallet-owned address, not the payee's.
- Rewrite the `confirmations: 1` test at :60 to the Electrum shape.
- `server/tests/unit/api/bitcoin/bitcoin.transaction.contracts.ts`: the route passes `walletId`.
- Repo-mock tests use `mockPrismaClient.transaction.findUnique` (`transactionRepository.findByTxid` uses `findUnique` with the `txid_walletId` compound key, `repositories/transactions/core.ts:268-273`).
- Put shared mock defaults (e.g. `mockElectrumClient.getAddressHistory` → `[]`) in `advancedTxTestHarness.ts`, not in the 999-line `advancedTx.rbf-creation.contracts.ts`.
- The harness default covers `advancedTxTestHarness.ts` consumers and the shared `mocks/electrum` client (used by `industry/rbfCpfpEdgeCases.test.ts`). It does **not** cover `server/tests/unit/services/bitcoin/advancedTx.pubkeyBranch.test.ts`, which hoists its own `mockElectrumClient` with only `getTransaction` (:14-19). After A3, `canReplaceTransaction` calls `client.getAddressHistory` for unsettled originals, so that test would hit a TypeError → `upstreamError` → `createRBFTransaction` throws (`rbf.ts:186-195`) and break at :149. Add `getAddressHistory: vi.fn().mockResolvedValue([])` to that local mock (:16-18).
- Also run `advancedTx.rbf-creation.contracts.ts`, `industry/rbfCpfpEdgeCases.test.ts` and `advancedTx.pubkeyBranch.test.ts`, which exercise `canReplaceTransaction`.

**Constraints**
- Mutation map: shift `rbf-input-policy-drives-exact-weight` (lineStart 231, lineEnd 241, canary 231:54 → 241:4) by Δ. Verify with `test:mutation:fee-policy` that the `ObjectLiteral` → `{}` mutant at the new location is `Killed`.
- `rbf.ts` `minScore` is 75, so the new branches need killing assertions on `reason` and `upstreamError`.
- `config/wallet-sync-mutation-boundaries.json`: not a sync-path file, and it is a read-only repo call.
- No OpenAPI change: the response shape is unchanged.
- `node scripts/check-safety-catch-guards.mjs` must pass with no allowlist growth.

**Acceptance**
- A confirmed original is never offered or built as an RBF replacement on Electrum.
- An unknown status from an upstream error fails closed.

---

### Phase A4 — Payjoin receiver: fail closed instead of returning a wrong proposal (P2, latent, `payjoin-receiver--proposal-output-not-credited`)

**Evidence**
- `server/src/services/payjoin/receiver.ts:133`: `proposalPsbt.txOutputs[ourOutputIndex].value = …` assigns to a clone. In bitcoinjs-lib 7.0.2 the `txOutputs` getter maps and copies the outputs, and there is no output-value setter. The proposal therefore returns the receiver input unsigned (:135-137) with the original outputs, so the whole contribution becomes fee.
- Latent today: `assertWalletHardwareCapabilityById(…, 'sign')` at :57 always throws (all rows are disabled). The route is also behind `payjoinSupport` (`api/payjoin.ts:386-390`).
- The existing tests mock `clonePsbt` (`payjoinService.utxo.contracts.ts:233-249, 278-294`), which hides the bug.

**Decision (recommended conservative option):**
- Return an explicit BIP78 `unavailable` error instead of building a proposal.
- Rebuilding the PSBT with a credited output is **not** sufficient. BIP78 requires receiver inputs in the proposal to be finalized, and receiver signing is a documented unimplemented boundary (`docs/explanation/advanced-features.md:197`). Any proposal the receiver can build today is invalid.

**Change**
- In `processPayjoinRequest`, replace lines 114-149 (proposal construction and success return) with:
  - `log.info('Payjoin receiver proposal unsupported: receiver input signing not implemented', { addressId })`;
  - `return { success:false, error: PayjoinErrors.UNAVAILABLE, errorMessage: 'Payjoin receiver proposals are unavailable until receiver input signing is implemented' }`.
- Keep the prior validations: unknown address, the capability assertion at :57 (inventory count 1), PSBT structure, our output, NOT_ENOUGH_MONEY, and min fee rate. Senders still get precise BIP78 rejections for bad originals.
- Remove the now-unused `clonePsbt` import.
- `selectContributionUtxo` stays, because it still gates NOT_ENOUGH_MONEY.
- The route needs no behaviour change: `!result.success` becomes 400 `unavailable`. Update the comments only: the `receiver.ts` file header, and the route comment in `api/payjoin.ts` (~:379, "Returns: Unsigned proposal PSBT") to say it returns `unavailable` until receiver signing lands.

**Test first**
- `server/tests/unit/services/payjoinService/payjoinService.process.contracts.ts`: with real (unmocked) `bitcoinjs` PSBT helpers if the harness allows, otherwise with the mocks, a valid original plus an eligible UTXO returns `success:false, error:'unavailable'`, and `clonePsbt` / `addInput` are never called. This fails today with `success:true`.
- Update the two `success).toBe(true)` cases in `payjoinService.utxo.contracts.ts` (closest-candidate and fallback). They now assert `unavailable` and assert on the harness's `mockPrismaClient.uTXO.findMany` call (the repository is not mocked directly). The candidate choice is no longer observable; keep the NOT_ENOUGH_MONEY dust tests, and keep at least one test per `selectContributionUtxo` branch so coverage stays at 100%.

**Constraints**
- Signer inventory: the assertion count is unchanged. Run `npm run verify:signer-inventory`.
- `wallet-safety-critical-paths` (`payjoin/**`) triggers verify-vectors.
- Docs: in `docs/explanation/advanced-features.md:197`, state that the receiver endpoint returns `unavailable` until signing lands.
- No OpenAPI change (`text/plain` error already documented).

**Acceptance**
- The receiver never emits a proposal that does not credit its output or that carries an unsigned receiver input.
- Coverage stays at 100% after the dead code is removed.

---

### Phase A5 — Vault policy: `unknownAddressesOnly`-only approval trigger must not be accepted as enforced (P2, `vault-policy--unknown-addresses-only-never-triggers`)

**Evidence**
- `server/src/services/vaultPolicy/vaultPolicyService.ts:516-533` (`validateApprovalTrigger`) accepts `unknownAddressesOnly: true` as the only condition.
- The same rule is accepted by:
  - the API zod refine (`server/src/api/schemas/vaultPolicy.ts:43-46`);
  - OpenAPI `anyOf` branch 3 (`server/src/api/openapi/schemas/walletPolicy.ts:88`).
- `policyEvaluationEngine.ts:785-811` (`evaluateApprovalRequired`) never triggers on it (comment at :803-805). The test `evaluate.spending-approval.contracts.ts:549-572` pins that silent no-op.
- The precedent is time_delay failing closed at create/update (`vaultPolicyService.ts:327-344`).
- No frontend references the field (no hits under `src/`).

**Change**
- Validation (definite):
  - In `validateApprovalTrigger`, require `trigger.always === true || trigger.amountAbove !== undefined`. Message: `unknownAddressesOnly is not enforceable on its own yet; combine it with always or amountAbove`.
  - Make the matching change to the zod `.refine` in `api/schemas/vaultPolicy.ts:44`.
  - Drop OpenAPI `anyOf` branch 3.
  - Combined configs stay accepted. The engine ignores the flag, which is more restrictive and so fails closed.
  - `validateApprovalTrigger` takes no enforcement argument, so the lone-flag trigger is rejected in **both** enforce and monitor modes. This differs from the time_delay precedent (enforce only) on purpose: a time delay is meaningful to observe in monitor mode, but a trigger that never fires records nothing in either mode, so accepting it in monitor mode only hides the misconfiguration.
- **Decision (coordinator; legacy rows already persisted):** do **not** change runtime behaviour for already-stored `unknownAddressesOnly`-only approval policies. They keep evaluating as today (no trigger). In `evaluateApprovalRequired`, when `trigger.unknownAddressesOnly === true && !trigger.always && trigger.amountAbove === undefined`, the engine logs a warning (`legacy approval_required policy with unknownAddressesOnly only is not enforced; edit the policy`), throttled to at most once per evaluation (debug/warn), and returns the same not-triggered result as today. The only behaviour change in this phase is rejecting such triggers on create and update. Rationale: switching legacy rows to trigger on every send could lock out wallets whose approvers are not set up. Enforcing legacy rows is recorded as a follow-up that requires product sign-off.

**Test first**
- `server/tests/unit/services/vaultPolicyService/vaultPolicyService.create-validation.contracts.ts`:
  - create and update with `trigger:{unknownAddressesOnly:true}` in enforce mode throw `InvalidInputError`. This fails today because the call resolves;
  - the same lone-flag trigger in monitor mode also throws `InvalidInputError`;
  - `{unknownAddressesOnly:true, amountAbove:1000}` is accepted.
- `server/tests/unit/api/schemas/vaultPolicy.test.ts`: `ApprovalRequiredConfigSchema` rejects the lone flag and accepts the combined config.
- `evaluate.spending-approval.contracts.ts:549`: keep its not-triggered expectation (legacy rows are unchanged per the Decision) and add an assertion that the legacy warning is logged.
- `server/tests/unit/api/openapi.wallet.contracts.ts:661-664` (the OpenAPI assertion for this schema; not `openapi.core.contracts.ts`): update it for the narrowed `anyOf` and assert that `trigger.anyOf` has no `unknownAddressesOnly`-only branch.

**Constraints**
- No schema or migration change.
- `docs/plans/vault-policies-plan.md` mentions the field; add a one-line note.
- No e2e mock change (no new endpoint).

**Acceptance**
- An approval policy (enforce or monitor mode) can no longer be created or updated to a trigger that silently never requires approval.
- Legacy rows evaluate exactly as before and log the "not enforced; edit the policy" warning; enforcing them is a follow-up pending product sign-off.

---

### Phase A6 — Resumed drafts keep the server-issued `signingContext` (P1, latent behind the capability gate, `send-draft-resume--signing-context-dropped`)

**Evidence**
- `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts:147-160` (`buildDraftTxData`) drops `draftData.signingContext`. That field is `src/api/drafts.ts:85`, `PsbtSigningContext | null`.
- Both duplicate `DraftTransactionData` interfaces lack it:
  - `src/components/send/SendTransactionPage/types.ts:6-17`;
  - `src/components/send/SendTransactionWizard/types.ts:4-15`.
- `createDraftInitialTxData` (`SendTransactionWizard/draftTransactionData.ts:58-71`) therefore returns `TransactionData` without `signingContext`. `useUsbSigning.ts:246-261` throws `no server-issued hardware signing context` for every resumed draft.
- Server side is correct:
  - `GET /wallets/:id/drafts/:draftId` returns the full row (`server/src/api/drafts.ts:43-48`, then `serializeForJson`; `draftRepository.findByIdInWallet` has no `select`);
  - the column is persisted (`draftRepository.ts:303`, `draftCreate.ts:331-363`);
  - the frontend schema is `z.looseObject` (`shared/schemas/transactionResponses.ts:73`) and passes it through;
  - OpenAPI documents it (`server/src/api/openapi/schemas/drafts.ts:114`).

**Change**
- Add `signingContext?: PsbtSigningContext` to both `DraftTransactionData` interfaces.
- In `buildDraftTxData`, set `signingContext: draftData.signingContext ?? undefined`.
- In `createDraftInitialTxData`, pass `signingContext: draftTxData.signingContext`.
- Do not fabricate a context or refuse missing ones here: legacy drafts stay viewable, and USB signing keeps its explicit error. QR and file signing are unaffected.

**Test first**
- `tests/components/send/draftTransactionData.test.ts`: `createDraftInitialTxData` with `draftTxData.signingContext = ctx` returns `txData.signingContext === ctx`. Fails today: `undefined`.
- `buildDraftTxData` maps both `signingContext` and `null` → `undefined`. Add this to the file's existing `buildInitialState` / `buildDraftTxData` block, or to `tests/components/send/SendTransactionPage.branches.test.tsx`.
- One integration assertion in `tests/components/send/SendTransactionWizard.test.tsx`: a resumed draft reaches `hardwareWallet.signPSBT` with the context (mocked hardware hook).

**Constraints**
- No server, OpenAPI or e2e change.
- `useUsbSigning.ts` is untouched in this phase.
- Frontend coverage 100%.

**Acceptance**
- A reopened draft signs over USB with its persisted context, once a capability row is enabled.
- Drafts without a context still surface the explicit error.

---

### Phase A7 — USB multisig signing verifies the connected device is the clicked cosigner (P2, latent, `usb-multisig-signing--device-identity-unchecked`)

**Evidence**
- `src/hooks/send/useUsbSigning.ts:185-198` (`signingConnectionOptions`) passes only `chainEnvironment` and `expectedModel`.
- `applyDeviceSignResult` (:263-285) marks `device.id` signed and PATCHes `signedDeviceId: device.id`, whichever signer is actually connected.
- `src/services/hardwareWallet/service.ts:390-411` already normalizes the connected fingerprint and enforces `expectedModel`. `HardwareWalletConnectionOptions` (`types.ts:85-88`) has no fingerprint expectation.
- `requireMatchingMasterFingerprint` already exists (`src/services/hardwareWallet/identity.ts:29-43`).
- QR and file paths already check the fingerprint (`useQrSigning` `validateUploadedSignature`).

**Change**
- Add `expectedFingerprint?: string` to `HardwareWalletConnectionOptions`.
- In `service.ts`, inside the existing identity `try` at :392-411, after the `fingerprint` normalization: `if (options && 'expectedFingerprint' in options) requireMatchingMasterFingerprint(fingerprint, options.expectedFingerprint ?? '', \`Connected ${adapter.displayName}\`);`. The check is presence-based on the option key (not `!== undefined`), so a caller that asks for a fingerprint check but passes an empty/undefined value fails closed instead of skipping it. The existing catch already disconnects (`cleanupAdapterForOwnership`) and rethrows.
- `signingConnectionOptions(hwType, device, wallet)` adds `expectedFingerprint: device.fingerprint`. `Device.fingerprint` is typed as a required string (`src/types/user.ts:97`), but legacy rows can be empty: when `device.fingerprint` is falsy, throw `Error('Hardware signing requires the stored device fingerprint')`, mirroring the existing model check at `useUsbSigning.ts:189`.
- `signWithDevice` already routes thrown errors to `setError` before `applyDeviceSignResult`, so nothing is marked or persisted on mismatch.
- The single-sig `signWithHardwareWallet` path needs no change: it has no clicked-device identity.

**Test first**
- `tests/services/hardwareWallet.service.test.ts`: `connectWithLease(type, {expectedModel, expectedFingerprint:'aaaaaaaa'})` with an adapter reporting `bbbbbbbb` rejects with `fingerprint mismatch`, and the adapter is disconnected. A matching fingerprint connects. Fails today: it connects.
  Also: `expectedFingerprint` key present but `undefined` rejects (presence-based check).
- `tests/hooks/useUsbSigning.test.tsx`: `signWithDevice(deviceA)` calls `hardwareWallet.connect` with `expect.objectContaining({ expectedFingerprint: deviceA.fingerprint })`. When `connect` rejects, `setSignedDevices` and `draftsApi.updateDraft` are not called. A device with an empty fingerprint fails with `requires the stored device fingerprint` before `connect` is called.
- Fixture updates for the new option: the connect-options assertions (~:596-620) and every `signWithDevice` device fixture in `tests/hooks/useUsbSigning.test.tsx` (each needs a fingerprint); `tests/hooks/useSendTransactionActions/useSendTransactionActions.signing.contracts.tsx` (~:150); and `tests/components/send/steps/review/UsbSigning.branches.test.tsx` if it asserts connect options. Both `hardwareWallet.service.test.ts` (919 lines) and `useUsbSigning.test.tsx` (905) are near the 1,000-line gate: add the new cases compactly, or in a new `*.contracts.ts(x)` file.

**Constraints**
- Signer inventory: run `npm run verify:signer-inventory`; no new `sign*`, `finalize*` or `broadcast*` identifiers.
- Emulator lanes run (both files are listed in `config/hardware-emulator-source-inventory.json`); no inventory edit.
- Hardware-signed manifest covers `service.ts`, `types.ts` and `useUsbSigning.ts`; the vectors are empty.
- Release audit evidence required (see cross-cutting item 6).

**Acceptance**
- Clicking USB sign for cosigner A while cosigner B is connected fails before signing, with nothing marked or persisted.

---

### Phase A8 — Clear an in-session-adopted draft id when the transaction changes (P2, `send-draft-save--stale-draft-id-after-edit`)

**Evidence**
- `src/hooks/send/useDraftManagement.ts:187-213` (`createNewDraft`) calls `setDraftId(result.id)` before the signed-state PATCH. If that PATCH fails, `saveDraft` shows the error and stays on the page (:312-316).
- An output edit changes the identity (`useSendTransactionActions.ts:203-214`), and the layout effect (:372-380) calls `reset()`, which clears txData but **not** `state.draftId`.
- The next `saveDraft` takes the `stateSnapshot.draftId` branch (:282-292). `updateExistingDraft` PATCHes only `signedPsbtBase64` and `signedDeviceId` (:142-156; `UpdateDraftRequest` in `src/api/drafts.ts:138-144` cannot carry tx content) and reports `Draft updated successfully`.
- `useBroadcast.ts:292` sends `draftId: state.draftId`, which binds the old draft.

**Change (smallest correct)**
- In `useSendTransactionActions`, add `adoptedDraftIdRef`.
- In the layout effect, when `previous.draftId === null && draftId !== null && previous.tx === identity`, record `adoptedDraftIdRef.current = draftId`. That is the adoption branch.
- When `previous.tx !== identity && draftId !== null && draftId === adoptedDraftIdRef.current`, call `setDraftId(null)` and clear the ref, in addition to `reset()`. The edited tx then saves as a new draft through `createDraft`, which carries the full tx.
- **Decision:** release the abandoned draft. The adopted draft X still holds `draftUtxoLock` rows, so a later `createDraft` that keeps any of its UTXOs fails with `ConflictError('One or more UTXOs are already locked by another draft transaction')` (`server/src/services/draftCreate.ts:171-200`). When clearing an adopted id, also call `draftsApi.deleteDraft(walletId, adoptedId)` (`src/api/drafts.ts:199`) best-effort: `void ...catch(error => log.warn(...))`. `UpdateDraftRequest` cannot carry tx content, so delete-then-create is the only option. If the user saves before the delete settles, `createDraft` surfaces the existing lock-conflict error and a retry succeeds; nothing is lost. Rationale: without the delete, the old draft's UTXO locks make the next `createDraft` return 409. Scope: this only affects failed or stale adoptions, because a successful save navigates away (`useDraftManagement.ts:318`).
- Clear `adoptedDraftIdRef` whenever `draftId` becomes `null` or changes to a different id, so a stale ref never matches a later draft.
- Read `setDraftId` (and `walletId`) through a ref inside the layout effect, so an inline arrow passed by the caller does not re-run the effect every render.
- The follow-up `draftChanged` re-run calls `reset()` again on an already reset state, which is harmless.
- Drafts resumed from the server (`isDraftMode`, id present at mount) are untouched. Treating edits of resumed drafts is out of scope; note it as a follow-up.

**Test first**
- `tests/hooks/useSendTransactionActions/useSendTransactionActions.draftAdoption.contracts.tsx`, next to `still resets when an output changes after adoption` (:66). These contracts render a real reducer, so assert on state. The new first test must construct the **failure** path: adoption (null → id) with `draftsApi.updateDraft` rejecting (the follow-up PATCH fails), then an output change. Expect `state.draftId === null` and `draftsApi.deleteDraft` (already mocked by the harness) called once with `(walletId, id)`.
- The existing `still resets when an output changes after adoption` test (:66) performs a successful save and then edits. Keep its expectations as they are; do not extend it to encode "delete after a successful save".
- `deleteDraft` rejecting is logged and does not throw or restore the id.
- A second case: a draft id present from mount, then an output change. Expect `state.draftId` unchanged and `deleteDraft` not called.
- A third case: after adoption, the id is cleared by other means and a different id is adopted; an output change clears only the new id (ref was reset).
- `tests/hooks/useDraftManagement.test.tsx`: when the follow-up PATCH fails, `setDraftId(id)` was called and `saveDraft` returns null.
- Confirm on 336bc94b that the first case fails because `state.draftId` keeps the adopted id.

**Constraints**
- No server change (PATCH semantics unchanged; `DELETE` draft already exists).
- No e2e mock change (no new endpoint).
- Frontend coverage 100% (both ref branches and the delete-failure branch).

**Acceptance**
- After a failed follow-up and an edit, saving creates a new draft containing the edited tx (the abandoned draft and its UTXO locks are released), and broadcast does not bind the stale draft id.

---

### Phase A9 — QR signing: reset the UR decoder after a rejected submission, ignore scans while in flight (P2, `qr-signing--stale-ur-decoder-after-rejection`)

**Evidence**
- `src/components/qr/QRSigningModal/useQRSigningModalController.ts:266-279` (`finishSignedPsbt`): the catch sets `scanError` and `processing=false` but never clears `decoderRef`.
- `resetScanner` (:45-51) runs only on close or step change.
- The next scan frame reaches `handleUrPsbtScan` (:192-225) with the completed decoder. `feedDecoderPart` is a no-op after completion (bc-ur), `result.complete` is still true, and `getDecodedPsbt` resubmits the **old** PSBT. A corrected multi-frame scan is never decoded.
- The decode-failure catch (:220-224) has the same problem.
- In-flight guard: `getFirstScanContent(results, processing)` (`qrScanModel.ts:9-15`) reads React state captured in the `handleQrScan` closure. Frames delivered before the re-render pass the guard and submit duplicates.

**Change**
- Add `inFlightRef = useRef(false)` and a `resetDecoder = () => { decoderRef.current = null; setScanProgress(0); }` callback.
- `handleQrScan`: return early if `inFlightRef.current`.
- Pass `onSubmitStart: () => { inFlightRef.current = true; }` and `onSubmitFailed: () => { inFlightRef.current = false; resetDecoder(); }` through `FinishSignedPsbtOptions`:
  - set in-flight before `await onSignedPsbt`;
  - on success `handleClose` → `resetScanner`, and also clear `inFlightRef` in `resetScanner`;
  - in the catch, call `onSubmitFailed()` before `setScanError`.
- Call `resetDecoder()` in the `getDecodedPsbt` catch in `handleUrPsbtScan`.
- The file-upload path uses the same `finishSignedPsbt` and gets the same guard.
- **Decision:** after a reset, a camera still pointed at the same animated QR would rebuild and resubmit the same rejected PSBT in a loop. Keep `lastRejectedPsbtRef` (set in `onSubmitFailed` to the rejected base64) and ignore a decoded PSBT identical to it, leaving the existing `scanError` visible, **and call `resetDecoder()` before returning** so the next frames start a fresh decode (otherwise the completed decoder for the ignored PSBT makes every later frame a no-op and a corrected PSBT B can never be decoded). Test-first case 5: after A is rejected and then ignored on re-decode, feed a fresh complete UR sequence for B; `onSignedPsbt` receives B and `createPsbtDecoder` was called again after the ignore. Scope the guard to the **camera paths only** (UR scans and raw base64 scans); `importSignedPsbtFile` does not consult it, so a deliberate re-upload of the same file always produces feedback. Clear it in `resetScanner` (close or step change), so the user can deliberately retry the same PSBT by closing and reopening. Accepted side effect: the guard also blocks a camera retry of the same PSBT after a **transient** `onSignedPsbt` failure until the modal is closed and reopened (or the file path is used). (Verified: bc-ur `URDecoder.receivePart` returns false once complete and `isComplete` stays true, so the decoder reset is required.)

**Test first**
- `tests/components/qr/QRSigningModal.test.tsx` (it already drives the scanner mock, and mocks `../utils/urPsbt` entirely at :73-77, so assertions are structural):
  1. Make `createPsbtDecoder` return a distinct object per call. Complete a UR for PSBT-A with `onSignedPsbt` rejecting once. Then emit further UR frames. Expect `createPsbtDecoder` to be called again, and `feedDecoderPart` / `getDecodedPsbt` to receive the **new** decoder object, and a decoded PSBT-B to reach `onSignedPsbt` (calls `[A, B]`). Today the old decoder is reused and A is resubmitted.
  2. Emit the completing frame twice inside one `act()`, with `onSignedPsbt` a pending promise. Expect one call.
  3. After A is rejected, a fresh decoder that decodes A again does not call `onSignedPsbt` a second time (UR path), and a raw base64 scan of A is also ignored; after close and reopen, A can be submitted again.
  4. After A is rejected via the camera, `importSignedPsbtFile` with the same A still calls `onSignedPsbt` (the guard is camera-only).
- Run `npx vitest run tests/components/qr/QRSigningModal.test.tsx` on 336bc94b to confirm the failure.

**Constraints**
- Frontend coverage 100%.
- The file is in `tests/fixtures/wallet-safety-required-files.json`, so release audit evidence is required.

**Acceptance**
- After a rejected submit, the next scan decodes fresh frames.
- Duplicate frames never double-submit, and the same rejected PSBT is not resubmitted in a loop.

---

### Phase A10 — Send review: MAX/sweep "Total Sending" from the built transaction (P2, `send-review--sendmax-total-uses-heuristic-fee`)

**Evidence**
- `src/components/send/steps/review/transactionSummaryModel.ts:27-34`: `getTotalSendingSats` = `selectedTotal - estimatedFee` for sendMax.
- `:36-38` and `TransactionSummary.tsx:61-73`: Network Fee = `txData.fee`.
- `estimatedFee` comes from `SendTransactionContext` → `calculateFee` (`sendTransactionPageHelpers.ts:18-25`), which assumes 68-vB inputs regardless of `scriptType` or multisig.
- The flow preview on the same screen uses `txData.outputs` (`reviewStepData.ts:164-175, 223-227`).
- sendMax always goes through the batch API (`useSendTransactionActions.ts:72-74`), whose `outputs` carry the resolved recipient amounts.

**Change**
- `getTotalSendingSats(outputs, selectedTotal, estimatedFee, totalOutputAmount, txData)`: when `hasSendMaxOutput(outputs) && txData` is present, return `txData.totalInput - txData.fee - (txData.changeAmount ?? 0)`. Otherwise keep the current logic, which is the pre-build estimate.
  - No decoy term: decoys are unreachable for sendMax. sendMax always takes the batch path, which builds no decoys, and the batch builder forces `changeAmount` to 0 for send-max (`createBatchTransaction.ts:181`).
  - Do **not** sum `txData.outputs[].amount`: resumed MAX drafts build `txData.outputs` as `{ amount: 0, sendMax: true }` (`draftTransactionData.ts:23-35`), so that sum would show 0.
- `getTotalIncludingFeeSats`: when sendMax and `txData` is present, return `totalSending + networkFee`.
- Pass `txData` from `TransactionSummary.tsx`.
- Do not change `calculateFee` in this PR. A scriptType-aware outputs-step estimate (`INPUT_VBYTES` exists in `src/components/UTXOList/dustUtils.ts` but has no multisig sizes) is a follow-up, because the review numbers become exact once txData exists.

**Test first**
- `tests/components/send/TransactionSummary.test.tsx` (156 lines, fine to extend): a sendMax output, `selectedTotal=100000`, `estimatedFee=500`, `txData={totalInput:100000, fee:1200, changeAmount:0, outputs:[{amount:98800}]}`. Expect Total Sending `98,800` and total `100,000`. Today Total Sending is `99,500`.
- A resumed-draft case: `txData.outputs=[{amount:0, sendMax:true}]` with `totalInput`/`fee`/`changeAmount` set. Expect Total Sending = `totalInput - fee - changeAmount`, not 0.
- No model test file exists: create `tests/components/send/steps/review/transactionSummaryModel.test.ts` with pure-function cases for `getTotalSendingSats` / `getTotalIncludingFeeSats`, with and without `txData`.

**Constraints**
- Frontend coverage 100%.
- Render-regression PNG baselines under `tests/e2e/render-regression.spec.ts-snapshots/` could change if a MAX review screen is snapshotted. Run Playwright against a static `dist/` build per CLAUDE.md.

**Acceptance**
- For MAX or sweep, Total Sending + Network Fee = the selected input total. Both use the built transaction's numbers.

---

### Phase A11 — Wallet export: multisig Passport/Coldcard QR uses the server coldcard export (P2, `wallet-export--client-multisig-qr-diverges`)

**Evidence**
- `src/components/WalletDetail/modals/ExportModal.tsx:51-86` (`generateMultisigConfigText`) has these defects:
  - no `Sorted: true`;
  - raw device xpub, so Zpub/Vpub is not normalized;
  - `Derivation` taken from `devices[0]` only, which can be `'No matching account'`;
  - `Format: P2SH` emitted for legacy multisig.
- `getQrValue` (:168-177) encodes it.
- The server handler `server/src/services/export/handlers/coldcard.ts:85-133`:
  - emits `Sorted: true`;
  - normalizes to xpub/tpub;
  - validates quorum, unique signers and the shared policy path (:60-81);
  - refuses legacy multisig (`canExport`, :92-96).
- The endpoint already exists: `GET /wallets/:id/export?format=coldcard` (`server/src/api/wallets/export.ts:288-321`).
- `apiClient.fetchBlob` exists (`src/api/client.ts:803`).

**Change**
- Add `walletsApi.getWalletExportText(walletId, formatId): Promise<string>` in `src/api/wallets.ts`, as `apiClient.fetchBlob('/wallets/${id}/export', {params:{format}})` → `.text()`.
- Put the fetch in a small hook (e.g. `usePassportMultisigExportText(walletId, enabled)` returning `{ text, error, loading }`) so `ExportModal` stays under the lizard complexity limit. It fetches `coldcard` when `isMultisig && exportTab==='qr' && qrFormat==='passport'` (keep the existing `devices.length > 0` condition, so the raw-descriptor fallback still works), with a cancelled flag on unmount or dependency change.
- `src/components/WalletDetail/modals/exportTabs/QrExportTab.tsx` renders `QRCodeSVG` unconditionally today: give it loading and error states. While loading, render a loading note. On error, render the error (e.g. "This wallet cannot be exported as a Coldcard/Passport multisig config") and **no QR**. Never fall back to client text.
- Delete `generateMultisigConfigText` and its export. Remove the props and imports that become unused (`scriptType`, `quorum`, `totalSigners`, `getQuorumM`/`getQuorumN`, `WalletScriptType`) and update the `WalletDetail` callers; keep any that are still used elsewhere.
- Legacy multisig: `/export?format=coldcard` returns 500 (plain `Error` from `canExport`). `fetchBlob` retries GET 5xx today (`client.ts:812-842` uses `resolveRetryOptions(method)`, default 3 retries; `RETRYABLE_STATUS_CODES` includes 500), and `TransferRequestOptions` (`client.ts:117-124`) has no retry field. **Decided:** add `retryOptions?: RetryOptions` to `TransferRequestOptions`, use `resolveRetryOptions(method, options.retryOptions)` in `fetchBlob`, and have `getWalletExportText` pass `{ retryOptions: NO_RETRY }` (`NO_RETRY` is exported by `src/api/retryPolicy.ts`). `client.ts` is in `config/hardware-emulator-source-inventory.json` `common.files`; PR A already runs the emulator lanes. Show the fixed message above rather than the raw server text.
- The export-text hook passes an `AbortSignal` (`options.signal`) to `getWalletExportText` / `fetchBlob`, so retries and backoff stop on unmount or tab switch.
- Prop-removal cascade (`scriptType`, `quorum`, `totalSigners`; typecheck uses `noUnused*`): `src/components/WalletDetail/WalletDetailLoadedView.tsx:261-264`, `src/components/WalletDetail/WalletDetailModals.tsx:15-18,57-60`, `src/components/WalletDetail/WalletDetailModals/types.ts:8-11`, `src/components/WalletDetail/WalletDetailModals/ExportModalMount.tsx`, and `tests/components/WalletDetail/WalletDetailModals.test.tsx:33-36`.
- The descriptor QR format is unchanged.

**Test first**
- `tests/components/WalletDetail/modals/ExportModal.test.tsx`:
  - mock `walletsApi.getWalletExportText`. The Passport QR value equals the server text, including `Sorted: true`. Today the QR is built client-side and the mock is never called;
  - on rejection, no QR is rendered and the error shows;
  - a multisig wallet with no devices still shows the raw-descriptor fallback;
  - an unmount during fetch does not set state (and aborts the signal);
  - the `src/api/wallets` mock factory (:73-78) must add `getWalletExportText`, with a default `mockResolvedValue` set in `beforeEach`;
  - tests that assert client-generated text synchronously must change to await the mocked server text: :272 (switch back to Passport), :282-309, ~:311 (descriptor fallback), :323-337, :339-349 and :346 (those targeting `generateMultisigConfigText` are replaced).
- No-retry is tested at the client level, not through the mocked API (a "called once" assertion against a mocked `getWalletExportText` is vacuous): in `tests/api/client/client.transfer.contracts.ts`, a `fetchBlob` GET answered with 500 and `retryOptions: NO_RETRY` performs exactly one `fetch`. Fails today: the option does not exist and the request is retried. Also assert, in a `tests/api/wallets*` test, the `fetchBlob` call args of `getWalletExportText` (`params.format === 'coldcard'`, `retryOptions: NO_RETRY`, `signal`).
- `tests/components/WalletDetail.test.tsx:611` references the helper; update it.
- `tests/components/WalletDetail/WalletDetailModals.test.tsx:33-36`: drop the removed props.

**Constraints**
- No new endpoint, so no e2e mock map change. Verified: no `tests/e2e` spec opens the export modal (`grep -rn "/export" tests/e2e` only hits remediation-proposal export). Re-grep before push.
- No OpenAPI change.
- Frontend coverage 100%.
- `src/api/client.ts` is listed in `config/hardware-emulator-source-inventory.json` `common.files`; the emulator lanes already run for PR A, no inventory edit.

**Acceptance**
- The QR that devices scan is byte-identical to the server Coldcard export.
- A refused (5xx) export is fetched once, not retried.
- Wallets the server refuses get no QR.

---

### Files touched by these phases

**Backend source**
- `server/src/services/bitcoin/psbtBuilder/multisigFinalization.ts` (P1)
- `server/src/services/bitcoin/signingIntent/feePolicy.ts` (P2)
- `server/src/services/bitcoin/signingIntent/artifactValidation.ts` (P2)
- `server/src/services/bitcoin/transactionWeight.ts` (P2, appended helper)
- `server/src/services/bitcoin/advancedTx/cpfp.ts` (P2)
- `server/src/services/bitcoin/advancedTx/rbf.ts` (P3)
- `server/src/api/bitcoin/transactions.ts` (P3)
- `server/src/api/payjoin.ts` (P2 surplus `feeForRate`; P4 route comment)
- `server/src/services/payjoin/receiver.ts` (P4)
- `server/src/services/vaultPolicy/vaultPolicyService.ts` (P5)
- `server/src/services/vaultPolicy/policyEvaluationEngine.ts` (P5, legacy-row warning only)
- `server/src/api/schemas/vaultPolicy.ts` (P5)
- `server/src/api/openapi/schemas/walletPolicy.ts` (P5)

**Frontend source**
- `src/components/send/SendTransactionPage/types.ts` (P6)
- `src/components/send/SendTransactionPage/sendTransactionPageHelpers.ts` (P6)
- `src/components/send/SendTransactionWizard/types.ts` (P6)
- `src/components/send/SendTransactionWizard/draftTransactionData.ts` (P6)
- `src/hooks/send/useUsbSigning.ts` (P7)
- `src/services/hardwareWallet/types.ts` (P7)
- `src/services/hardwareWallet/service.ts` (P7)
- `src/hooks/send/useSendTransactionActions.ts` (P8)
- `src/components/qr/QRSigningModal/useQRSigningModalController.ts` (P9)
- `src/components/send/steps/review/transactionSummaryModel.ts` (P10)
- `src/components/send/steps/review/TransactionSummary.tsx` (P10)
- `src/components/WalletDetail/modals/ExportModal.tsx` (P11)
- `src/components/WalletDetail/modals/exportTabs/QrExportTab.tsx` (P11, loading/error states)
- new small fetch hook for the Passport export text (P11; next to `ExportModal`)
- `WalletDetail` callers of `ExportModal` (P11, removed props): `src/components/WalletDetail/WalletDetailLoadedView.tsx`, `src/components/WalletDetail/WalletDetailModals.tsx`, `src/components/WalletDetail/WalletDetailModals/types.ts`, `src/components/WalletDetail/WalletDetailModals/ExportModalMount.tsx`
- `src/api/wallets.ts` (P11)
- `src/api/client.ts` (P11, `retryOptions` on `TransferRequestOptions`)

**Config and docs**
- `config/wallet-safety-mutation-map.json` (P2 and P3 re-pins)
- `config/hardware-wallet-implementation-inventory.json` (verify only; regenerate only on drift)
- `scripts/quality/safety-catch-allowlist.json` (P3; only if the `canReplaceTransaction` count changes, otherwise untouched)
- `docs/explanation/advanced-features.md` (P4)
- `docs/plans/vault-policies-plan.md` (P5)

**Backend tests**
- `server/tests/unit/services/bitcoin/psbtBuilder.finalization.test.ts`
- `server/tests/unit/services/bitcoin/psbt.signed-vectors.test.ts` (A1 message)
- `server/tests/unit/services/bitcoin/signingIntent/artifactValidation.test.ts`
- `server/tests/unit/api/payjoin.test.ts` (A2 surplus)
- `server/tests/unit/services/bitcoin/advancedTx/advancedTxTestHarness.ts` (A3 defaults)
- `server/tests/unit/services/bitcoin/advancedTx.pubkeyBranch.test.ts` (A3: `getAddressHistory` on the local electrum mock)
- `server/tests/unit/services/bitcoin/signingIntent/feePolicy.test.ts`
- `server/tests/unit/services/bitcoin/transactionWeight.test.ts`
- `server/tests/unit/services/bitcoin/advancedTx/advancedTx.cpfp.contracts.ts`
- `server/tests/unit/services/bitcoin/advancedTx/advancedTx.rbf-detection.contracts.ts`
- `server/tests/unit/api/bitcoin/bitcoin.transaction.contracts.ts`
- `server/tests/unit/services/payjoinService/payjoinService.process.contracts.ts`
- `server/tests/unit/services/payjoinService/payjoinService.utxo.contracts.ts`
- `server/tests/unit/services/vaultPolicyService/vaultPolicyService.create-validation.contracts.ts`
- `server/tests/unit/services/policyEvaluationEngine/evaluate.spending-approval.contracts.ts`
- `server/tests/unit/api/openapi.wallet.contracts.ts`
- `server/tests/unit/api/schemas/vaultPolicy.test.ts`

**Frontend tests**
- `tests/components/send/draftTransactionData.test.ts`
- `tests/components/send/SendTransactionPage.branches.test.tsx`
- `tests/components/send/SendTransactionWizard.test.tsx`
- `tests/services/hardwareWallet.service.test.ts`
- `tests/hooks/useUsbSigning.test.tsx` (or a new contracts file if it would exceed 1,000 lines)
- `tests/hooks/useSendTransactionActions/useSendTransactionActions.signing.contracts.tsx` (A7 fixtures)
- `tests/components/send/steps/review/UsbSigning.branches.test.tsx` (A7, if it asserts connect options)
- `tests/hooks/useSendTransactionActions/useSendTransactionActions.draftAdoption.contracts.tsx`
- `tests/hooks/useDraftManagement.test.tsx`
- `tests/components/qr/QRSigningModal.test.tsx`
- `tests/components/send/TransactionSummary.test.tsx`
- `tests/components/send/steps/review/transactionSummaryModel.test.ts` (new)
- `tests/components/WalletDetail/modals/ExportModal.test.tsx`
- `tests/components/WalletDetail.test.tsx`
- `tests/components/WalletDetail/WalletDetailModals.test.tsx` (A11 removed props)
- `tests/api/client/client.transfer.contracts.ts` (A11 no-retry)
- `tests/api/wallets*` test for `getWalletExportText` call args (A11)

## Group B (PR B: server data & edge)

Base: `origin/main` 336bc94b59. All evidence below was re-read at that SHA in
`/tmp/sanctuary-bug-scrub-20261013-i3-scrub`. No Prisma schema or migration
changes anywhere in this group.

Cross-cutting checks for the PR:
- `scripts/check-safety-catch-guards.mjs` scans `server/src/middleware`, `server/src/services/bitcoin`,
  `server/src/services/accessControl.ts` and others. Any new `catch` in those roots must end in
  `return`/`throw`. B7 and B16 touch scanned roots; their catches, if any, must exit.
- `cd server && npx tsc --noEmit && npm run typecheck:tests && npx vitest run --coverage tests/unit`
  (100% unit coverage). Run integration specs that are touched, using the existing registered files where
  possible, so `scripts/ci/backend-integration-groups.sh` needs no change.
- Gateway (`gateway/`) and llm-egress-proxy (`llm-egress-proxy/`) have their own vitest and coverage gates.
  Run each package's typecheck and tests.
- Frontend changes (B3 copy, B7 client timeout) need the root `typecheck:app/tests/all` and `test:run --coverage` at 100%.
- B3 and B15 touch the sync lifecycle: run `node scripts/check-wallet-sync-lifecycle-contract.mjs` and
  `node scripts/check-wallet-sync-mutation-boundaries.mjs`.

---

### Phase B1 — WebSocket subscribe DB error crashes the API (P1, `websocket-subscribe--db-error-crashes-api`)

**Evidence.**
- `server/src/websocket/channels.ts:97` (`handleSubscribe`) and `:201` (`handleSubscribeBatch`) both
  `await checkWalletAccessUncached(...)` with no try/catch.
- `server/src/websocket/clientServer.ts:226-236` (`handleMessage`) calls `this.handleSubscribe(...)` and
  `this.handleSubscribeBatch(...)` without `await` or `.catch`, so a Prisma rejection becomes an unhandled rejection.
- `server/src/index.ts:383` registers `registerFatalProcessHandlers`, which treats `unhandledRejection` as fatal
  (`shared/utils/fatalProcessHandlers.ts:64` → `shutdown(event, 1)`). The API process exits.
- `handleAuth` → `handleAuthMessage` already has its own try (auth.ts), so only the two subscribe paths are exposed.

**Change.**
1. `channels.ts` `handleSubscribe`: wrap the `checkWalletAccessUncached` call in try/catch. On error:
   `log.warn('Wallet access check failed during subscribe', { userId, walletId, error: getErrorMessage(error) })`,
   then, if `isClientLiveForAdmission(client)`, send
   `{ type: 'error', data: { code: 'SUBSCRIPTION_CHECK_FAILED', message: 'Unable to verify wallet access; retry later', channel } }`
   and `return`. Fail closed: the client is not subscribed.
2. `handleSubscribeBatch`: same try/catch per channel. On error, push `{ channel, reason: 'Access check failed' }`
   to `errors` and `continue`. Fail closed for that channel; the rest of the batch proceeds.
3. Defense in depth in `clientServer.ts` `handleMessage`: call both as
   `void this.handleSubscribe(client, message.data).catch(error => log.error('Subscribe handler failed', { error: getErrorMessage(error) }))`.
   Do the same for `handleSubscribeBatch`. No empty catch.

**Test first.** In `server/tests/unit/websocket/clientServerLimits/clientServerLimits.subscriptions.contracts.ts`,
which runs through `clientServerLimits.test.ts` and its harness that mocks `checkWalletAccessUncached` as
`clientServerLimitMocks.mockCheckWalletAccess`, add two tests:
(a) `mockCheckWalletAccess.mockRejectedValueOnce(new Error('pool timeout'))`, then
`await (server as any).handleSubscribe(client, { channel: 'wallet:<uuid>' })` resolves, the client gets one
`error` payload with `code: 'SUBSCRIPTION_CHECK_FAILED'`, and `client.subscriptions` does not contain the channel.
(b) The same for `handleSubscribeBatch` with two wallet channels where the first rejects. Expect the second
subscribed and the first in `errors`.
On 336bc94b both `await`s reject, so the tests fail with the thrown error. Confirm with
`cd server && npx vitest run tests/unit/websocket/clientServerLimits.test.ts`.
Add a third test that drives `handleMessage` with a raw `subscribe` buffer while the mock rejects. Assert no
unhandled rejection: register `process.on('unhandledRejection')` in the test and flush microtasks.
Coverage of the step-3 `.catch` callbacks (after steps 1-2 the handlers no longer reject on their own): add two
spy-based tests, `vi.spyOn(server as any, 'handleSubscribe').mockRejectedValue(new Error('x'))` and the same for
`handleSubscribeBatch`, drive `handleMessage` with raw `subscribe` / `subscribe_batch` buffers, and assert `log.error`
was called and no unhandled rejection occurred (`server/vitest.config.ts` enforces 100% functions/branches).

**Constraints.** None of the inventories apply (`server/src/websocket` is outside the safety-catch scan roots).

**Acceptance.** A rejected access check never escapes a subscribe handler. The client gets an explicit error
and is not subscribed. Unit coverage stays at 100%.

---

### Phase B2 — Admin user delete strips signers from shared wallets (P1, `admin-user-delete--cascades-shared-wallet-signers`)

**Evidence.**
- `server/src/repositories/userAdminUpdate.ts:133-155` `findSoleOwnedNonGroupWalletIds` refuses only when the user
  is the sole `WalletUser` of a non-group wallet. `attemptAdminUserDelete` (`:157-178`) then calls `tx.user.delete`.
- Schema: `Device.user` is `onDelete: Cascade` (`schema.prisma` model Device, `user ... onDelete: Cascade`) and
  `WalletDevice.device` is `onDelete: Cascade`. Deleting the user deletes their owned devices, and with them every
  `WalletDevice` link, including links in wallets other users still hold. That silently removes a multisig
  cosigner or the single-sig signer from a surviving wallet.
- `WalletUser.role` is `owner|approver|signer|viewer`. A non-group wallet whose only `owner` is the deleted user
  but that has other members (viewer/signer) survives with no owner.
- `deviceRepository.deleteDeviceIfUnused` (`deviceRepository.ts:229-244`) already refuses when `device.wallets.length > 0`.
  The admin path bypasses that rule.

**Change** (all inside the existing Serializable transaction in `attemptAdminUserDelete`):
1. Add `findWalletLinkedOwnedDevices(tx, userId)`:
   `tx.walletDevice.findMany({ where: { device: { userId } }, select: { wallet: { select: { id: true, name: true } }, device: { select: { label: true } } } })`.
   If the result is not empty, throw
   `ConflictError('Cannot delete user: their device(s) are signers in wallet(s) <names>; remove the device from the wallet(s) or delete/transfer the wallets first')`.
   (Only the device owner can start a device transfer, so "transfer device ownership" is not an action an admin can take for a departing user.)
   Sort and deduplicate the wallet names, and cap the list at 10 with "and N more".
2. Add `findSoleOwnerSharedWalletIds(tx, userId)`: `WalletUser` rows where `userId`, `role: 'owner'`,
   `wallet.groupId: null`, and no other `WalletUser` with `role: 'owner'` exists on the wallet
   (`wallet: { users: { none: { role: 'owner', userId: { not: userId } } } }`). The existing sole-member check
   already covers wallets where the user is the only member. This one covers wallets with other non-owner members.
   Throw a `ConflictError` naming those wallets ("transfer ownership first").
3. Run the existing checks first (final admin, sole member). Then run 2, then 1. Keep messages consistent with
   the existing `ConflictError` text.

**Decision (flag).** This refuses every owned device with any wallet link, including group wallets, the same as
`deleteDeviceIfUnused`. It does not auto-reassign devices. That is the conservative, fail-closed option.
Group-owned wallets stay exempt from the owner check (2) only, matching the existing comment's reasoning.
Consequence: because only the device owner can initiate a device transfer, a user whose devices sign surviving
wallets stays undeletable until those devices are removed from the wallets or the wallets are deleted/transferred.
That is accepted as the fail-closed cost.

**Test first.**
- Unit: `server/tests/unit/repositories/userAdminUpdate.test.ts`. The helper `installAdminDeleteTransaction`
  (:345-367) lacks `walletDevice` and returns one `walletUser.findMany` result for every call: add
  `walletDevice.findMany` (default `[]`) and sequence the two `walletUser.findMany` results with
  `mockResolvedValueOnce` (sole-member check first, then sole-owner check), so the 5 existing tests (:369-455) keep
  passing. Also add `walletDevice: { findMany: vi.fn().mockResolvedValue([]) }` to the `tx` in `installAdminSetBarrier`
  (:65-95, `tx` at ~:90) so "allows only one barrier-synchronized demotion or deletion to commit" (:333-341) does not
  throw on the new call (its `$transaction` count of 3 is unchanged). Add cases: (a) linked owned device → rejects with `ConflictError` naming the wallet, and
  `tx.user.delete` is not called; (b) sole owner with other viewer members → rejects; (c) no links and a co-owner
  present → deletes.
  At 336bc94b, (a) and (b) resolve and call `user.delete`, so they fail.
- Integration (real cascades): `server/tests/integration/flows/admin/users.contracts.ts` (registered via
  `admin.integration.test.ts`; `userRepository.test.ts` has no admin-delete tests). Create users A and B, a wallet W
  with both as members (A owner, B owner), a device D owned by A linked to W, and call the admin delete for A.
  Expect 409 / `ConflictError`, and `walletDevice` count for W still 1. At base, the delete succeeds and the link is gone.
- **Existing test that breaks:** `users.contracts.ts:486-520` "cascades wallet user associations when another member
  remains" makes the deleted user owner and the other member a viewer, and expects 200. Under the new sole-owner
  check it becomes 409. Change that test's other member to `owner` (so it still proves the cascade on a co-owned
  wallet) and add a separate case asserting 409 for the owner + viewer shape.

**Constraints.** None of the config inventories apply. The admin UI already surfaces `ConflictError` messages for
the sole-member case. Check the admin users page test fixtures for a hard-coded message and update them if present.

**Acceptance.** An admin can't delete a user whose devices sign surviving wallets, or who is the only owner of a
shared non-group wallet. Existing guards are unchanged.

---

### Phase B3 — Full resync destroys transaction labels and memos (P1, `wallet-resync--user-labels-and-memos-destroyed`)

**Evidence.**
- `server/src/repositories/resyncRepository.ts:322` `resetWalletForFullResync` runs
  `tx.transaction.deleteMany({ where: { walletId } })` inside the wallet `FOR UPDATE` transaction (optionally under
  `withWalletSyncMutationFence`).
- `Transaction.label` and `Transaction.memo` live on the deleted rows. `TransactionLabel.transaction` is
  `onDelete: Cascade`, so manual label assignments are lost. `Label` rows (wallet-scoped) and `AddressLabel` survive.
- Rows are recreated by `transactionRepository.reconcileTransactionBatch`
  (`server/src/repositories/transactions/sync.ts:687`, `createManyAndReturn skipDuplicates`). It re-derives only
  address-label-inherited transaction labels (`findAddressLabelsByAddressIds` + `createManyTransactionLabels`).
  Manual tx labels and memos are never restored.
- Completion is `completeFencedWalletFullResync` (`resyncRepository.ts:354+`), called only from
  `worker/jobs/canonicalIncrementalSync.ts:127` (`completeCanonicalSync`). The reset is called from `:268`.
- UI copy: `src/components/NetworkSyncActions/ResyncConfirmationDialog.tsx:40-43` lists history, UTXO and derivation
  clearing but says nothing about labels and memos. `src/components/WalletDetail/hooks/useWalletSync.ts:194`
  confirm text is the same.

**Options evaluated.**
- (b) Keep annotated rows and reset them. Rejected. `reconcileTransactionBatch` reconciles existing rows
  "monotonically", so stale `type`, classification, IO and `balanceAfter` (the usual reasons to full-resync) could
  persist on exactly the annotated rows. Rows that are no longer wallet transactions would also survive.
- (c) Warn only. Too weak for P1 data loss. It is kept as a complement to (a), not a replacement.
- (a) Snapshot and restore, using an existing table. **Chosen.** No `Wallet` Json column exists (the Json columns
  are on other models). `SystemSetting` (`key` unique, `value` JSON-encoded string) is a fit under the
  `operational.` prefix. `systemSettingRepository.getAll` excludes `operational.*` from the admin listing, and
  backup restore preserves rather than exports them (`backupService/restore.ts:59`), so the snapshot never appears
  in admin settings or backups.

**Change.**
1. New module `server/src/repositories/resyncAnnotationSnapshot.ts`, used only by `resyncRepository.ts`:
   - key: `operational.wallet-resync-annotations.v1:<walletId>`.
   - payload (zod-validated via `safeJsonParse`):
     `{ v: 1, walletId, entries: { [txid]: { label?: string|null, memo?: string|null, labelIds?: string[] } } }`.
   - `captureAnnotations(tx, walletId)`: one `findMany` for `{ walletId, OR: [{ label: { not: null } }, { memo: { not: null } }, { transactionLabels: { some: {} } }] }`,
     selecting `txid, label, memo, transactionLabels.labelId`. Then merge into any existing snapshot (left over
     from an attempt that never completed). For each txid, a non-null value on the live row wins, and `labelIds`
     are unioned. Upsert the setting.
   - `restoreAnnotations(tx, walletId)`: read the snapshot. Load the live rows for the snapshot txids
     (`findMany where walletId, txid in [...]` in chunks of 1,000). Set `label`/`memo` only where the live value
     is null, so edits made after the rows were recreated win. The restore runs inside the 60 s fenced completion
     transaction (`syncIntentRepository.ts:252,287`), so it must be bulk, never one `UPDATE` per row: per chunk of
     1,000, one `tx.$executeRaw` (the Transaction model is `@@map("transactions")`, `schema.prisma:615`):
     `UPDATE "transactions" t SET label = COALESCE(t.label, v.label), memo = COALESCE(t.memo, v.memo), "updatedAt" = now() FROM unnest(${txids}::text[], ${labels}::text[], ${memos}::text[]) AS v(txid, label, memo) WHERE t."walletId" = ${walletId} AND t.txid = v.txid AND ((t.label IS NULL AND v.label IS NOT NULL) OR (t.memo IS NULL AND v.memo IS NOT NULL))`.
     `"updatedAt" = now()` is required because raw SQL bypasses Prisma's `@updatedAt`. Arrays with null elements
     are untested in this repo: if null elements fail against real Postgres, pass `''` sentinels and use
     `NULLIF(v.label, '')` / `NULLIF(v.memo, '')`.
     Label links: the live-row `findMany` selects `{ id, txid }`; build a `txid → id` map and insert
     `{ transactionId: id, labelId }` with `transactionLabel.createMany({ skipDuplicates: true })`. Skip txids that
     were not recreated, and skip `labelId`s deleted meanwhile (filter to labels that still exist for this wallet
     with one `label.findMany`).
     Delete the restored entries from the snapshot. If no entries remain, delete the setting; otherwise upsert the
     remainder.
   - Size guard: export `RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES` (e.g. 50,000 txids) from
     `resyncAnnotationSnapshot.ts`. Check it with a cheap `count` of annotated rows (merged with the existing
     snapshot's entry count) **before** loading rows. On overflow, throw so the reset transaction rolls back and
     nothing is deleted (fail closed; dropping annotations would be irreversible), and `log.error` the wallet id and
     count. `resetWalletForFullResync` runs inside `runSyncAttemptWithTimeout`
     (`worker/jobs/canonicalIncrementalSync.ts:268`), where a plain error is classified as retryable and retried
     forever. Map the overflow to `PermanentIncrementalSyncError` (`canonicalIncrementalSync.ts:106`, used at
     :244-256), so the wallet goes to `action_required` with a message to export or clean up labels and memos first.
   - Corrupt existing snapshot: at **capture**, a snapshot value that fails `safeJsonParse`/zod throws (same
     permanent-error mapping) and rolls the reset back, rather than overwriting it. At **restore**, log the error and
     leave the setting in place (do not delete it).
2. `resetWalletForFullResync`: inside `reset`, after the high-water-mark early return and immediately before
   `deleteMany`, call `captureAnnotations(tx, walletId)`. It runs in the same database transaction as the delete,
   so the operation is crash-safe: either both commit or neither does.
3. `completeFencedWalletFullResync`: inside the fenced transaction, after the generation guards pass and before
   the wallet update, call `restoreAnnotations(tx, walletId)`. It runs only when completion is recorded, and the
   wallet `FOR UPDATE` lock serializes it with any newer reset.
   Also call it in the non-fenced `completeWalletFullResync` (`resyncRepository.ts` ~:430, exercised by
   `syncCorrectionAtomicity.test.ts:154-157`), inside its transaction, so both completion paths restore.
   **Known edge (accepted):** a superseded generation's leftover snapshot can resurrect a label the user cleared
   on a recreated row before the next generation's reset, because the merge cannot tell "cleared" from "never
   restored". Making the live row win at capture would instead wipe annotations in the superseded case the
   second test covers, which is the worse failure, so the edge is accepted.
4. Unmatched entries (txids not recreated, for example because the tx is no longer found within the gap limit)
   are **kept**. A later full resync that finds them restores them.
   **Decision (flag):** keep rather than drop, because dropping is irreversible. Bound growth by deleting the
   setting when the wallet is deleted: in `walletRepository.deleteById` (`walletRepository.ts:691`, today a bare
   `prisma.wallet.delete`), delete the snapshot setting and the wallet in the same `$transaction`. Put the key
   construction and the `systemSetting.deleteMany({ where: { key: <wallet key> } })` in
   `resyncAnnotationSnapshot.ts` as `deleteResyncAnnotationSnapshot(tx, walletId)`, and keep the
   `walletRepository.ts` delta to ≤ 3 lines: the file is 995 lines and unclassified in
   `scripts/quality/large-file-classification.json` (1,000-line gate). Run
   `node scripts/quality/check-large-files.mjs` after the edit. Known residue (accepted, P3): wallets removed by paths other than
   `deleteById`, and snapshot rows left after a backup restore, leave an orphan `operational.` row; entries for
   txids that come back only through a later incremental sync stay in the snapshot until the next full resync.
5. Frontend copy: add "Transaction labels and memos are kept and re-applied as transactions are found again"
   to `ResyncConfirmationDialog.tsx` (as a separate `<li>`) and to the `useWalletSync.ts:194` confirm string. No
   test edits are needed for the copy: `tests/components/NetworkSyncActions.test.tsx:171` uses a regex and
   `tests/components/NetworkSyncActions.branches.test.tsx:604` matches an existing `<li>` text, so both stay valid
   with a new separate `<li>`; no test asserts the `useWalletSync.ts:194` confirm text.

**Test first.**
- Integration (real cascade and real recreate): add the cases to
  `server/tests/integration/repositories/syncCorrectionAtomicity.test.ts` (290 lines, registered), using the fenced
  helper pattern from `syncIntentLifecycle.test.ts:306`. Do not grow `syncIntentLifecycle.test.ts` (1,192 lines,
  `reviewWhenTouched` at `large-file-classification.json:188`; if it is touched anyway, bump its `lastReviewed`).
  Seed a wallet with tx T1 that has `label`, `memo`, and a `TransactionLabel`
  to label L. Reserve a full-resync generation, then call `resetWalletForFullResync`. Recreate T1 via
  `reconcileTransactionBatch`, then call `completeFencedWalletFullResync` with a valid fence. Expect T1's label,
  memo and `TransactionLabel(L)` restored. At 336bc94b they are null or absent, so the test fails.
  Add a second case where the generation is superseded between reset and completion: two resets, then one
  completion. All annotations must still be restored.
  Add a third case through the non-fenced `completeWalletFullResync` path, and a bulk case with several thousand
  annotated txids (e.g. 3,000) that completes well inside the fenced transaction timeout.
  Against real Postgres, also cover the raw `UPDATE`'s null handling: label-only, memo-only and neither (no row
  touched, `updatedAt` unchanged), plus the 1,000/1,001 chunk boundary. If null array elements fail, switch to the
  `''` + `NULLIF` form above.
- Worker unit test (`server/tests/unit/worker/jobs/canonicalIncrementalSync*`): a snapshot overflow from
  `resetWalletForFullResync` is surfaced as `PermanentIncrementalSyncError` (wallet `action_required`), not retried.
- `walletRepository.deleteById` unit test in
  `server/tests/unit/repositories/walletRepository/walletRepository.mutations.contracts.ts:749-758`: it asserts a
  bare `prisma.wallet.delete` today; change it to assert the `$transaction` form, with the snapshot setting delete
  (via `deleteResyncAnnotationSnapshot`) and the wallet delete in one transaction. Add a unit test for
  `deleteResyncAnnotationSnapshot` in `resyncAnnotationSnapshot.test.ts`.
- Unit: `server/tests/unit/repositories/resyncRepository.test.ts`. The "atomically clears sync-derived state" test
  gains an expectation that the snapshot upsert happens on the same `tx` before `deleteMany`. The completion tests
  assert that restore runs only when the guards pass. Add direct unit tests for `resyncAnnotationSnapshot.ts`
  covering merge precedence, the chunking boundary at exactly 1,000 and 1,001 txids, a deleted label id, an empty
  snapshot, a corrupt existing snapshot (capture throws and nothing is overwritten; restore logs and leaves the
  setting in place), and the size-guard cap (`RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES`, checked by `count` before
  any row load).

**Constraints.**
- `config/wallet-sync-mutation-boundaries.json` lists call sites in sync-path files
  (`canonicalIncrementalSync.ts` → `resetWalletForFullResync` and `completeFencedWalletFullResync`, `fenced_lifecycle`).
  The new helpers are called only inside `resyncRepository.ts`, so no new sync-path call sites and no inventory
  change are expected. Run `node scripts/check-wallet-sync-mutation-boundaries.mjs` and
  `node scripts/check-wallet-sync-lifecycle-contract.mjs` (which pins `resyncRepository.ts` symbol authorities)
  to confirm.
- Replay driver (`scripts/perf/wallet-sync-persistence-driver.cjs`) wraps only utxoRepository writers
  (`createMany`, `batchUpdateByIds`, `markManyAsSpent`, `restoreUnspentByIds`) and `transactionRepository`, and has
  no full-resync path. No `driverSha256` re-seal is needed. Verify no wrapped file changed.
- No migration. The `SystemSetting` row is the store (RC10 migration digest is untouched).
- Docs: `docs/how-to/operations-runbooks.md` has no resync section; add a short "Full resync" subsection stating
  that annotations are preserved and re-applied at completion.

**Acceptance.** After a full resync (wallet or network) completes, every manual label, memo and label assignment
on a txid that the resync finds again is restored; entries for txids found only later stay pending until the next
full resync. A crash between reset and completion loses nothing. The UI states accurately what is kept.

---

### Phase B4 — Console turns list returns only the oldest 100 (P2, `console-turns--only-oldest-100-returned`)

**Evidence.** `server/src/repositories/consoleRepository.ts:195-205` `listTurns` uses `orderBy: { createdAt: 'asc' }, take: limit`.
`server/src/assistant/console/service.ts:339-350` defaults `limit = 100`. `GET /console/sessions/:id/turns`
(`server/src/api/console.ts:105-109`) passes no limit or cursor. A session with more than 100 turns never shows
its newest turns.

**Change.** In `listTurns`, use `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, `take: limit`, and return
`rows.reverse()`. This gives the newest `limit` turns in chronological order, which is what the UI renders.
Tool-trace ordering is unchanged. No API shape change. Paging is out of scope.

**Test first.** `server/tests/unit/repositories/consoleRepository.test.ts`, around line 189 where `listTurns` is
asserted. Change the expectation to the desc order plus id tiebreak. Add a test where the mocked `findMany` returns
`[t3, t2, t1]` and the call resolves to `[t1, t2, t3]`. At base the order assertion fails.

**Constraints.** None. OpenAPI response shape is unchanged.

**Acceptance.** Reloading a 150-turn session shows turns 51-150 in order.

---

### Phase B5 — Device API leaks unrelated wallets to shared viewers (P2, `device-api--shared-viewer-sees-unrelated-wallets`)

**Evidence.** `server/src/repositories/deviceRepository.ts:282-305` `findByIdFull` and `:626-660`
`findAccessibleByUser` include `wallets → wallet {id,name,type,scriptType,network}` with no access filter.
`server/src/api/devices/crud.ts:47-53` (list, via `services/deviceAccess.ts:132` `getUserAccessibleDevices`) and
`:111-125` (`GET /:id`, gated only by `requireDeviceAccess('view')`) return them. The assistant tool
`assistant/tools/deviceReadTools.ts:134` exposes the same list.

**Change.** Add a helper in `deviceRepository.ts`:
`visibleDeviceWalletsWhere(userId): Prisma.WalletDeviceWhereInput = { OR: [ { device: { users: { some: { userId, role: 'owner' } } } }, { wallet: buildWalletAccessWhere(userId) } ] }`,
using `repositories/accessControl.ts:29`. `deviceRepository.ts` currently has only `import type` from the generated
Prisma client; add a value import of `buildWalletAccessWhere` (the `Prisma.WalletDeviceWhereInput` type can stay a
type import).
- `findAccessibleByUser(userId)`: `wallets: { where: visibleDeviceWalletsWhere(userId), select: ... }`.
- `findByIdFull(deviceId, userId)`: add the `userId` parameter and the same `where`. Update the only caller,
  `crud.ts:115`, to pass `requireAuthenticatedUser(req).userId`.

The device owner keeps the full list. Others see only wallets they can access directly or through a group.
**Decision:** "owner" means a `DeviceUser` row with role `owner`, not `Device.userId`, because ownership
transfer (`transferService/confirm.ts:183-198`) moves the `DeviceUser` owner role.
**Decision (accepted gaps):**
- `deviceAccess` treats a group-granted `groupRole === 'owner'` as `isOwner`, but `visibleDeviceWalletsWhere` checks
  only the `DeviceUser` owner row. A group owner therefore sees only wallets they can access. That is the more
  restrictive reading and is accepted.
- `getUserAccessibleDevices` `walletCount` (`deviceAccess.ts` ~:160) and the assistant `listDevicesTool`
  `countDeviceWallets` become "visible wallets only" for non-owners, since they count the filtered relation.
  This is intended (a count also leaks existence).

**Test first.**
- Integration: `server/tests/integration/repositories/deviceRepository.test.ts` (registered). Owner A has device D
  linked to A's private wallet WA. D is shared with B (viewer). `findAccessibleByUser(B)` and `findByIdFull(D, B)`
  must return D with `wallets: []`. Called for A, they return WA. At base, B sees WA, so the test fails.
- Unit: `server/tests/unit/api/devices/devices.crud.contracts.ts` (run by the `devices.test.ts` aggregator). No
  existing test references `findByIdFull`. `deviceRepository` is not mocked in the devices harness
  (`devicesTestHarness.ts:17-44`), so add one in the `GET /:id` block asserting
  `mockPrismaClient.device.findUnique` (harness mock at `:107`) was called with `include.wallets.where` equal to
  `visibleDeviceWalletsWhere(userId)` for the requesting user.
- Update `walletCount` / `countDeviceWallets` assertions (deviceAccess and `listDevicesTool` tests) for the
  visible-only count, and add a non-owner case.

**Constraints.** No response-shape change, so no OpenAPI or e2e mock change. Check the
`tests/unit/repositories/deviceRepository*` mocks that assert the exact `include` and update them.

**Acceptance.** A device shared with a user never reveals names or ids of wallets that user can't access.

---

### Phase B6 — Clearing a mobile-permission cap writes plain `null` to a `Json?` column (P2, `mobile-permissions--clear-cap-plain-null-json`)

**Evidence.** `server/src/services/mobilePermissions/mobilePermissionService.ts:358-361` passes
`ownerMaxPermissions: null` to `mobilePermissionRepository.updateByWalletAndUser` (`mobilePermissionRepository.ts:291-305`).
That function spreads `input` and casts `input.ownerMaxPermissions as Prisma.InputJsonValue`. Prisma 7
(`server/package.json` `^7.10.0`) rejects a literal `null` for a nullable Json field and requires
`Prisma.DbNull` or `Prisma.JsonNull`. The cast hides this from tsc. The route is
`DELETE /wallets/:id/mobile-permissions/:userId/caps` (`api/mobilePermissions.ts:259-263`). No existing test clears a cap.

**Test first (gate).** In `server/tests/integration/repositories/mobilePermissionAccess.test.ts` (registered), add:
the owner sets a cap on a member, `mobilePermissionService.clearMaxPermissions(walletId, member, owner)` resolves,
and the stored `ownerMaxPermissions` is `null` (SQL NULL). Run it at 336bc94b first.
**If it passes at base, stop and record this finding as Rejected with the test output.** The expected failure is a
`PrismaClientValidationError` ("must not be null").

**Change.** In `mobilePermissionRepository.ts`, add
`function toOwnerCapsInput(value: Record<string, boolean> | null | undefined) { return value === null ? Prisma.DbNull : value; }`.
Use it at every `ownerMaxPermissions:` site (`:210`, `:261`, `:267`, `:283`, `:302`) in place of the cast. Do not
spread a raw `null` through `...input`. `DbNull` keeps "never set" and "cleared" identical (SQL NULL). This matches
`mcpApiKeyRepository.ts:28` and `agentRepository.ts:466`.
`mobilePermissionRepository.ts:9` is `import type { MobilePermission, Prisma }`, but `Prisma.DbNull` is a runtime
value: change it to a value import of `Prisma` (keep `MobilePermission` as a type import), following
`mcpApiKeyRepository.ts:28`. `toOwnerCapsInput(undefined)` must return `undefined`, so the five sites that spread
`...input` still skip the field when it is not provided.

**Unit.** `server/tests/unit/repositories/mobilePermissionRepository.test.ts`: passing `null` sends
`Prisma.DbNull`, passing an object sends the object, and omitting the field (`undefined`) leaves
`data.ownerMaxPermissions` `undefined` (assert `toBeUndefined()`, not `not.toHaveProperty`, since the spread keeps the key).

**Acceptance.** The clear-caps endpoint returns 200 and the effective permissions revert to uncapped.

---

### Phase B7 — Route timeouts shorter than AI/intelligence handler deadlines (P2, `request-timeout--shorter-than-handler-deadlines`)

**Evidence.**
- `server/src/middleware/requestTimeout.ts:22` declares `AI_REQUEST_TIMEOUT_MS = 125000` but never uses it.
  `/^\/api\/v1\/ai\//` gets 60 s (`:42`).
- `server/src/services/ai/features.ts:43,124`: `executeNaturalQuery` fetch deadline is 125 s.
- `/api/v1/intelligence/...` has no extended entry, so it gets the 30 s default.
  `services/intelligence/conversationService.ts:143` uses a 35 s fetch deadline, and both messages are persisted
  regardless. A 408 followed by a client retry duplicates the user message.
- Frontend: `src/api/ai.ts:10` `AI_NATURAL_QUERY_TIMEOUT_MS = 120_000` (below the server's 125 s), and
  `src/api/intelligence.ts:146-153` `sendChatMessage` uses the 30 s client default (`src/api/client.ts:70`).
- nginx `/api/` `proxy_read_timeout 310s` (`docker/nginx/default.conf.template:68-69`) is not the bottleneck.
- `server/src/errors/errorHandler.ts:36+` writes `res.status().json()` without checking `res.headersSent`. After a
  408 a late handler error raises `ERR_HTTP_HEADERS_SENT` inside the error handler.

**Change.** Order the deadlines handler < route < client.
1. `requestTimeout.ts`: add `{ pattern: /^\/api\/v1\/ai\/query$/, timeout: AI_REQUEST_TIMEOUT_MS, reason: 'AI natural query' }`
   **before** the generic `/api/v1/ai/` entry, and set `AI_REQUEST_TIMEOUT_MS = 130_000` (handler 125 s + 5 s).
   Add `{ pattern: /^\/api\/v1\/intelligence\/conversations\/[^/]+\/messages$/, timeout: 45_000, reason: 'Intelligence chat' }`.
   The array is first-match, so the specific `/ai/query` entry must precede the generic `/api/v1/ai/` entry. The
   middleware is mounted app-level (`server/src/index.ts:170`), so `req.path` is the full `/api/v1/...` path the
   patterns match.
2. Frontend: `src/api/ai.ts` `AI_NATURAL_QUERY_TIMEOUT_MS = 135_000`. In `src/api/intelligence.ts`,
   `sendChatMessage` passes `{ timeoutMs: 50_000 }`.
   `src/api/client.ts:74` lists 408 as retryable, but `resolveRetryOptions` (`src/api/retryPolicy.ts:25-36`) disables
   transport retry for mutation methods, so these POSTs are not replayed. No client change is needed; a test pins it
   (below), so a later retry-policy change cannot reintroduce duplicate messages.
3. `errorHandler.ts`: first statement `if (res.headersSent) { log.warn('Error after response sent', { requestId, error: error.message }); return; }`.
   That file is outside the safety-catch scan roots, and the guard is a return, not a catch.

**Test first.**
- `server/tests/unit/middleware/requestTimeout.test.ts`: `/api/v1/ai/query` gets 130000, `/api/v1/ai/analyze` still
  gets 60000, and `/api/v1/intelligence/conversations/abc/messages` gets 45000. Use fake timers and the existing
  helpers, with requests whose `path` is the full `/api/v1/...` path (app-level mount). At base they get 60000 and
  30000, so the tests fail.
- `server/tests/unit/errors/errorHandler.test.ts`: with `res.headersSent = true`, `status` and `json` are not called.
- Frontend (there is no `tests/api/ai.test.ts`; `tests/api/intelligence.test.ts` mocks `apiClient`):
  - `tests/api/intelligence.test.ts:321-325`: update the `sendChatMessage` exact-args assertion to include the new
    options argument (`{ timeoutMs: 50_000 }`).
  - `tests/api/coreApiModules.test.ts` (which covers `executeNaturalQuery`): assert `timeoutMs: 135_000` is passed.
  - The "408 → exactly one `fetch` call (no replay)" pin for a mutation POST goes in the real-client suite
    `tests/api/client/client.basic.contracts.ts`, since the module tests mock the client.

**Constraints.** Keep the 280 s console entries. Docs: if `docs/reference` lists route timeouts, update the table
(grep `EXTENDED_TIMEOUT_ROUTES`).

**Acceptance.** A 100 s local-LLM query and a 33 s intelligence reply complete without a 408. No duplicate message
on retry.

---

### Phase B8 — Audit and session IP taken from the first X-Forwarded-For entry (P2, `audit-log--client-ip-from-x-forwarded-for`)

**Evidence.** `server/src/services/auditService.ts:197-209` `getClientInfo` takes `forwardedFor.split(',')[0]`.
That is the client-controlled left-most entry. The app sets `trust proxy` to 1 (`server/src/index.ts:86`), and
`middleware/rateLimit.ts:86-90` `getClientIp` already uses `req.ip` for this reason. `getClientInfo` has 32 call
sites: login, tokens, 2FA, agent, MCP, console. `middleware/requestLogger.ts:83` logs raw XFF (log-only, same pattern).

**Change.** `getClientInfo`: `ipAddress = req.ip || req.socket?.remoteAddress || 'unknown'` (optional chaining is
required: many mock requests have no `socket`). Leave `userAgent` unchanged. In `requestLogger.ts:83`, use `req.ip`
the same way. Inline the expression with a comment pointing at `getClientIp` (`middleware/rateLimit.ts:86-90`)
rather than importing it, so no new `services` → `middleware` import edge (and no `arch:check` regeneration) is
introduced.

**Note (not fixed here, flag).** The MCP app sets `trust proxy` to 1 (`mcp/transport.ts:204`) but is published
directly on host loopback (compose `mcp` profile). With no proxy in front, `req.ip` there trusts one client-supplied
XFF hop. Raise this as a follow-up decision: set MCP `trust proxy` from config, default `false`.

**Test first.** `server/tests/unit/services/auditService.test.ts:485+` currently asserts that XFF wins. Rewrite it:
`{ ip: '10.0.0.9', headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.9' } }` → `10.0.0.9`, and with no `req.ip` it
falls back to the socket address, and with neither it returns `'unknown'` (no `socket` property). At base the
first case returns `1.2.3.4`, so it fails. Tests that break and must be rewritten: the three XFF tests in
`server/tests/unit/services/auditService.test.ts:497-530`, and `server/tests/unit/middleware/requestLogger.test.ts:138`.
`tests/unit/mcp/auth.test.ts`, `tests/unit/api/email.test.ts` and `tests/unit/api/agent-wallet-funding-smoke.test.ts`
mock `getClientInfo` and are unaffected.

**Acceptance.** Audit and session IPs match the rate limiter's `req.ip`. A forged XFF prefix has no effect.

---

### Phase B9 — Gateway doesn't forward the client IP (and passes client XFF through) (P2, `gateway-proxy--client-ip-not-forwarded`)

**Evidence.** `gateway/src/routes/proxy/proxyConfig.ts:46-80` uses `createProxyMiddleware` (http-proxy-middleware
^4.2.0) without `xfwd` and never sets `X-Forwarded-For`. The gateway is published directly
(`docker-compose.yml` gateway `ports: ${GATEWAY_PORT:-4000}:4000`, no nginx in front) and has no `trust proxy`, so
its `req.ip` is the real client socket. The backend (`trust proxy` 1, not published) derives `req.ip` from the
last XFF entry. Two failures follow:
(1) Without XFF from the client, every mobile request has `req.ip` = the gateway container, so the per-IP
`auth:2fa` and `auth:login` buckets and the audit IPs collapse into one.
(2) The client's own `X-Forwarded-For` header is passed through unchanged, so the client chooses its backend
`req.ip` (spoofed audit IP, rotated rate-limit buckets).

**Change.** In the `proxyReq` handler, before `fixRequestBody` (which commits headers):
`const clientIp = req.ip || req.socket?.remoteAddress; if (clientIp) proxyReq.setHeader('X-Forwarded-For', clientIp); else proxyReq.removeHeader('X-Forwarded-For');`
Also `proxyReq.removeHeader('Forwarded')` and `proxyReq.removeHeader('X-Real-IP')`. Do **not** optional-chain
`removeHeader`: a real `ClientRequest` always has it, `stripBrowserAuthCookies` already calls it unguarded, and the
gateway vitest config requires 100% branch coverage, so a `?.` adds an uncoverable branch. Update the test fixtures
to include `removeHeader` instead. This replaces, not appends,
so a client-supplied XFF is dropped. Don't enable `xfwd`, because it appends to the client value.
With one entry and `trust proxy 1`, backend `req.ip` = the gateway-observed client.

**Decision (flag).** The gateway keeps no `trust proxy`, which is correct for the shipped topology. An operator who
puts a reverse proxy in front of the gateway would need a config knob. That is out of scope.

**Test first.** `gateway/tests/unit/routes/proxyConfig.test.ts` (the existing pattern at `:64-74` calls
`config.on.proxyReq` with a `setHeader` spy). New test: req with `ip: '203.0.113.7'` and
`headers: { 'x-forwarded-for': '6.6.6.6' }` → `setHeader('X-Forwarded-For', '203.0.113.7')`, and `removeHeader` is
called for `Forwarded`. At base `setHeader` is never called with XFF, so the test fails. The existing tests at
`proxyConfig.test.ts` ~:53-77 call `on.proxyReq` with `proxyReq = { setHeader }` only and a `req` without `ip` or
`socket`: update those fixtures to add a `removeHeader` spy and an `ip`. Gateway vitest requires 100% branch
coverage, so add three explicit cases: (1) `req.ip` present → XFF set to it; (2) `req.ip` absent with
`socket.remoteAddress` present → XFF set to the socket address; (3) neither → no XFF set,
`removeHeader('X-Forwarded-For')` called, no throw. If
`gateway/tests/unit/routes/proxyTransport.test.ts` runs a real upstream, add a case asserting the upstream sees
exactly the client IP.

**Acceptance.** Each mobile client gets its own backend rate-limit bucket and audit IP. A client-supplied XFF never
reaches the backend.

---

### Phase B10 — LLM egress proxy rate limit is one global bucket (P2, `llm-egress--global-rate-limit-bucket`)

**Evidence.** `llm-egress-proxy/src/rateLimit.ts:43-63` keys on `req.socket.remoteAddress`. Only the backend and
worker connect, so effectively there is one bucket of `AI_RATE_LIMIT_MAX_REQUESTS` (default 10) per 60 s
(`constants.ts:8-9`). It applies to `/analyze`, `/chat`, `/console/*`, provider routes, and (via express-rate-limit
default `req.ip`) `labelQueryRoutes.ts:28-40`. `app.use(requireLlmEgressProxySecret(...))` (`index.ts:64`)
authenticates every request with the shared secret. The backend already rate-limits users (`rateLimitByUser('ai:analyze')`).

**Change (conservative: keep the cost backstop, partition it).**
1. Proxy: in `rateLimit.ts`, add `rateLimitKey(req)`, which reads header `x-llm-egress-rate-key`. Accept only
   `^(user|worker|admin):[A-Za-z0-9_-]{1,64}$`; otherwise fall back to the socket address. Use it as the Map key.
   It must tolerate a request with no `headers` object and treat an array-valued header as invalid (fallback).
   Apply the same key to `labelQueryRoutes.ts` through express-rate-limit's `keyGenerator`; with express-rate-limit 8
   the IP fallback there must use `ipKeyGenerator(req.ip)` (the library rejects a raw-IP key generator).
   The custom limiter covers `/analyze`, `/chat`, `/console/plan` and provider routes; `labelQueryRoutes` uses
   express-rate-limit. The header is trusted only because the secret middleware runs first. Assert that ordering in a test.
2. Backend: in `server/src/services/ai/llmEgressProxyClient.ts`, add the `rateLimitKey` option to
   `buildLlmEgressProxyAuthHeaders` (:17), which emits the header, and make `buildLlmEgressProxyJsonHeaders` (:33)
   delegate to it. `listModels` (`features.ts` ~:247) uses the auth-headers builder, not the JSON one, so both must
   carry the key. The header allowlist `[A-Za-z0-9_-]{1,64}` fits UUID user ids. Callers:
   - `services/ai/features.ts` `suggestTransactionLabel` and `executeNaturalQuery` → `user:<userId>`.
     Add a `userId` parameter and pass `req.user.userId` from `api/ai/features.ts:79` and `:128`. Those are the only
     callers; both functions are otherwise only re-exported via `services/aiService.ts` and `services/ai/index.ts`.
     Update the mocks and tests for the new argument.
   - `services/intelligence/conversationService.ts:138` → `user:<userId>`; `sendMessage` already has `userId` (:84).
   - Console gateway (`assistant/console/modelGateway.ts`): `fetchConsoleGateway(path, body)` (:108),
     `planConsoleTools(input)` (:186) and `synthesizeConsoleAnswer(input)` (:205) spread `input` into the request
     body. Add a **separate** `rateLimitKey` (or `userId`) parameter to each, **not** a field of `input` (that would
     be serialized into the body and could fail the proxy's `requestSchemas`), and send it as the header
     `user:<actor.userId>`. Update the plan and synthesize call sites in `assistant/console/service.ts` and their tests.
   - `services/intelligence/analysisService.ts:354,397` (`callAnalysis`, worker-only) → constant `worker:intelligence`.
   - Admin and provider calls (`features.ts:167,201,248`, including `listModels`) and the `/test` caller
     (`services/ai/health.ts:117`, rate-limited by `aiRequestRateLimit` at `labelQueryRoutes.ts:198`) → `admin:system`.
     `services/ai/config.ts:286` calls `/config`, which has no rate limit, so it gets no key and is unchanged. The
     only server caller of `/check-provider` is `intelligence/analysisService.ts:395`, already `worker:intelligence`;
     `/check-ollama` has no server caller.

**Decision (flag).** Per-principal buckets at the existing limit. Total throughput may rise to N×10/min. That is
bounded by backend per-user limits, and the worker keeps its own 10/min, as before.

**Test first.**
- Proxy tests live in `tests/llm-egress-proxy/`. `tests/llm-egress-proxy/rateLimit.test.ts` has only cleanup-timer
  tests today; add: 11 requests from one socket with `user:a` then 1 with `user:b` → the `user:b` request passes.
  At base it gets 429, so the test fails. A malformed header, an array-valued header, and a request with no
  `headers` each fall back to the socket key.
- `tests/llm-egress-proxy/labelQueryRoutes.test.ts` (:37-99, uses `makeRateLimitRequest(ip)`): the same partitioning
  for the label-query route via `keyGenerator`.
- Server: create `server/tests/unit/services/ai/llmEgressProxyClient.test.ts` (it does not exist) covering header
  emission from both `buildLlmEgressProxyAuthHeaders` and `buildLlmEgressProxyJsonHeaders` (the JSON builder
  delegates) and sanitisation (invalid keys are not emitted; a UUID user id is accepted). Each caller test asserts
  its key (including `listModels`, `/test` (health) and `/check-provider` (analysisService)), and the `api/ai/features`
  route tests assert `userId` is passed.
- Console gateway tests: `planConsoleTools` / `synthesizeConsoleAnswer` send the key as a header and the request
  body does **not** contain it; `assistant/console/service.ts` tests assert the actor's user id is passed.

**Acceptance.** A worker intelligence run cannot 429 interactive users' console or chat turns.

---

### Phase B11 — MCP JSON-RPC batch costs one rate-limit token (P2, `mcp-transport--batch-bypasses-rate-limit`)

**Evidence.** `server/src/mcp/transport.ts:135` calls `rateLimitService.consume('mcp:default', context.keyId)` once
per POST. `classifyMcpOperation` returns `'batch'` for arrays (`:71-74`). The SDK's
`webStandardStreamableHttp.js` accepts arrays up to `MAX_BATCH_SIZE = 100` (verified in installed 1.30.1; lockfile
pins 1.32.1, so re-verify in the test). `SUPPORTED_PROTOCOL_VERSIONS` includes `2025-03-26`, which permits batching.
`rateLimitService.consume(policy, key, cost = 1)` already supports a cost (`rateLimitService.ts:86-90`).

**Change.** `const cost = Array.isArray(req.body) ? Math.max(1, req.body.length) : 1;`, then
`consume('mcp:default', context.keyId, cost)`. A batch larger than the remaining budget gets the existing 429
JSON-RPC error.

**Test first (gate).** `server/tests/unit/mcp/transport.test.ts`. First add a test that POSTs a 3-element
`tools/call` array through the real `StreamableHTTPServerTransport` with an initialized session or the stateless
config, and asserts the SDK processes 3 messages. **If the SDK rejects arrays, record Rejected with the output.**
Then assert `consume` is called with cost 3 and that a 3-message batch with `remaining: 2` is refused. At base cost
is 1, so the test fails.

**Constraints.** None. Update `docs/reference` MCP rate-limit text if it says "per request".

**Acceptance.** N batched messages consume N tokens.

---

### Phase B12 — AI insight Telegram messages not HTML-escaped (P2, `ai-insight-telegram--unescaped-html`)

**Evidence.** `server/src/services/notifications/channels/aiInsights.ts:183-199` `formatInsightMessage` interpolates
`insight.walletName`, `insight.title`, `insight.summary`, `insight.severity` and the fallback `insight.type` raw
into an HTML message (sent at `:166` via `telegramApi.sendTelegramMessage`, `parse_mode: HTML`). A `<` or `&` makes
Telegram return 400, which is non-retryable, so the insight is lost. `services/telegram/formatting.ts:152` exports
`escapeHtml`.

**Change.** Import `escapeHtml` and apply it to every interpolated dynamic value (walletName, title, summary,
severity, typeLabel). Keep the static `<b>` tags.

**Test first.** `server/tests/unit/services/notifications/channels/aiInsights.test.ts`: walletName `A&B <cold>`,
summary `x < y`. The message sent to the `sendTelegramMessage` mock contains `A&amp;B &lt;cold&gt;` and
`x &lt; y`. At base the raw text is present, so the test fails.

**Constraints.** `aiInsights.ts` and `telegram/formatting.ts` are listed in `docs/architecture/calls.config.json`
(`notifications` subsystem); the generated `docs/architecture/generated/calls/notifications.md` embeds `#L<line>`
links and call edges, so run `npm run arch:check` in the primary checkout against the branch tree and commit the
regenerated `docs/architecture/generated/**` files.

**Acceptance.** Insights with HTML-significant characters deliver.

---

### Phase B13 — Invalid webhook `minAmountSats` blocks all wallet deliveries (P2, `webhooks--invalid-min-amount-blocks-wallet-deliveries`)

**Evidence.** `server/src/services/webhooks/config.ts:16` accepts any string `minAmountSats`.
`subscriptions.ts:38-41` calls `BigInt(filters.minAmountSats)`, which throws on `'0.001'`, `'1,000'` or `'abc'`.
`deliveryService.ts:71` evaluates `matchesEndpointFilters` **outside** the per-endpoint `try` (`:75`), so the throw
aborts `queueWebhookEventsDeliveries` for every endpoint and event of the wallet. `api/wallets/webhooks.ts:28,49`
validates `filters` only as `z.record(z.string(), z.unknown())`.

**Change.**
1. API: replace `filters: JsonRecordSchema.optional()` with
   `WebhookFiltersSchema = z.object({ transactionTypes: z.array(z.string().min(1).max(40)).max(20).optional(), minAmountSats: z.string().regex(/^\d{1,16}$/).optional(), confirmationThreshold: z.number().int().min(0).max(1_000_000).optional() }).catchall(z.unknown())`.
   Update and create both use it (the update schema is `.partial()` of the body).
   This deliberately rejects input that was previously accepted: more than 20 `transactionTypes`, a non-integer
   `confirmationThreshold`, and a PATCH that resends stored filters which are now invalid (the client must correct
   them). Stated in the PR body as a user-visible change.
2. Runtime: `config.ts` `getFilterConfig` returns `minAmountSats` only if it matches `/^\d+$/`. Otherwise it sets
   `invalidMinAmount: true`. `matchesEndpointFilters` returns `false` (no match) when `invalidMinAmount` and a
   transaction is present, and logs at `debug` with the endpoint id (it runs per event per endpoint, so `warn` would
   flood; the save-time 400 is the operator-facing signal).
   **Decision:** fail closed for that endpoint (it receives nothing filtered by amount) rather than ignore the
   filter (which would over-deliver).
3. Isolation: in `deliveryService.ts`, move the `matchesEndpointEventType`/`matchesEndpointFilters` evaluation
   inside the per-endpoint `try`, so any future filter throw affects only that endpoint and is pushed to `errors`.

**Test first.**
- `server/tests/unit/services/webhooks/deliveryService.test.ts` (near `:518`): two endpoints, one with
  `minAmountSats: '0.001'`. The valid endpoint's delivery is still created. At base the call throws, so the test fails.
- `server/tests/unit/services/webhooks/webhookCore.test.ts`: `matchesEndpointFilters` with `'abc'` returns false and
  doesn't throw.
- `server/tests/unit/api/wallet-webhooks-routes.test.ts`: POST with `filters.minAmountSats: '1,000'` → 400.

**Constraints.** Response shape is unchanged. If the OpenAPI schema documents webhook `filters` (grep
`server/src/api/openapi` for `filters`), document the regex.

**Acceptance.** A bad filter can't stop a wallet's other webhooks, and new bad filters are rejected at save.

---

### Phase B14 — Privacy score reloads wallet aggregates per UTXO (P2, `privacy-score--quadratic-wallet-scan`)

**Evidence.** `server/src/services/privacyService.ts:274` `calculateWalletPrivacy` awaits
`calculateUtxoPrivacy(utxo.id)` sequentially. Each call issues `findByIdWithWallet`, `countUnspentByAddress`,
`countUnspentByTxid`, `countUnspentByBlockHeight` and `findUnspentAmounts(walletId)` (`:194`). That is 5 queries
per UTXO, and the last loads every unspent row, so cost is O(n²) rows. It is reachable from
`GET /wallets/:id/privacy` and the assistant `walletReadTools.ts:284`.
Semantics to preserve: the per-UTXO counts and averages use **all unspent** UTXOs (`spent: false`, frozen
included; see `utxoRepository.ts:583-642`). The scored list is unspent **and unfrozen** (`findUnspentForPrivacy`, `:647-660`).

**Change.**
1. `utxoRepository.ts`: add the read `findUnspentForPrivacyAggregates(walletId)`. `where { walletId, spent: false }`,
   select `id, txid, vout, amount, address, blockHeight, frozen`.
2. `privacyService.ts`: extract pure
   `scoreUtxoWithAggregates(utxo, agg: { byAddress: Map<string,number>, byTxid: Map<string,number>, byHeight: Map<number, Map<string, number>> /* txid→count */, avgAmount: bigint })`
   that reproduces the exact formulas. The address count includes self. The txid count excludes self. The
   same-height count excludes self **and** the same txid, which equals `heightTotal - countAtHeightWithSameTxid`.
   `avgAmount = total / max(n,1)`.
   Preserve the existing `if (utxo.blockHeight)` truthiness: a height of `0` or `null` skips the timing factor,
   exactly as today.
   `calculateWalletPrivacy` loads the aggregate rows once, builds the maps, filters `!frozen` for the scored list
   (keep `orderBy amount desc`), and scores in memory.
3. Delete `utxoRepository.findUnspentForPrivacy` (`:647-660`): its only caller (`privacyService.ts:235`) is replaced,
   and leaving it uncalled breaks the 100% function-coverage gate.
   `calculateUtxoPrivacy(utxoId)` keeps its signature and its existing queries, but computes its score through the
   same `scoreUtxoWithAggregates` (building single-UTXO aggregates from its count queries), so the formulas exist
   once. Keep each function under the lizard complexity limit (split map-building into its own helper).

**Test first.** `server/tests/unit/services/privacyService.test.ts`: a wallet with 50 UTXOs (mocked repo).
`privacyService.test.ts` mocks `mockPrismaClient` (not repository functions): assert `mockPrismaClient.uTXO.findMany`
is called once and `uTXO.count` zero times on the wallet path (no per-UTXO queries). Add a parity test: for a fixture with address reuse, a shared txid, same-height different-txid,
and a frozen UTXO, plus UTXOs with `blockHeight` `null` and `0`, the scores equal the old per-UTXO path computed
through `calculateUtxoPrivacy` with the same mock data (record the expected scores from 336bc94b in the fixture
before refactoring). At base the call-count assertion fails.
Expected churn: `privacyService.test.ts` mocks the per-UTXO repository calls for `calculateWalletPrivacy`; those
tests are rewritten to mock `findUnspentForPrivacyAggregates`.

**Constraints.** utxoRepository gains a **read** only. The replay driver wraps only writers, so no re-seal is
needed. `config/wallet-safety-mutation-map.json` pins no utxoRepository or privacyService lines (verified).

**Acceptance.** One aggregate load per wallet privacy request (no per-UTXO queries), with identical scores.

---

### Phase B15 — WalletSyncFailures alert and sync dashboards read dead counters (P2, `monitoring--wallet-sync-alert-dead-metric`)

**Evidence.** `server/src/observability/metrics/businessMetrics.ts:13-28` defines `sanctuary_wallet_syncs_total{status}`
and `sanctuary_wallet_sync_duration_seconds{walletType}`. `git show 0198d46c60` (#905) removed the only producers
(`walletSyncsTotal.inc({status:'success'|'failure'})`, `walletSyncDuration.observe({walletType:'all'}, …)`).
`docker/monitoring/alert_rules.yml:49-52` (`WalletSyncFailures`) and
`docker/monitoring/grafana/dashboards/sanctuary-wallet-sync.json` (`:150,211,272,325,382,505,595,688-703,783`) and
`sanctuary-overview.json` (`:312,790,870,875`) query them, and the result is always empty.
`sanctuary_wallet_sync_terminal_total` covers only timeout/aborted (`walletSyncMetrics.ts:124-129`), so repointing
cannot express a failure ratio. Re-adding producers is the correct fix.

**Change.** In `server/src/worker/walletSyncAttemptTelemetry.ts` `WalletSyncAttemptTelemetry`:
- record `startedAtMs = Date.now()` in the constructor.
- in `finish(outcome)` (the guarded single-terminal path): for `completed` call
  `walletSyncsTotal.inc({ status: 'success' })`; for `failed` and `timedOut` call
  `walletSyncsTotal.inc({ status: 'failure' })`; for `aborted` do not touch `walletSyncsTotal`. For every outcome
  except `aborted`, call `walletSyncDuration.observe({ walletType: 'all' }, (Date.now() - startedAtMs) / 1000)`.
  **Decision:** aborted outcomes (shutdown, lock loss) are excluded from the failure counter, so deploys and
  restarts do not fire `WalletSyncFailures`. They remain visible in `sanctuary_wallet_sync_terminal_total`.
  Import from `observability/metrics/businessMetrics` (or the metrics index).
  The worker is scraped (`docker/monitoring/prometheus.yml` job `sanctuary-worker`, `worker:3002`).
- Dashboard panel `:783` groups `by (le, walletType)`. It gets a single `all` series, as before #905. Leave it.

**Out of scope (flag).** `sanctuary_db_connection_pool`, `sanctuary_db_pool_health`, `sanctuary_db_pool_latency_ms`
and `sanctuary_db_slow_queries_total` are also never written. Only `sanctuary-cache-efficiency.json` panels use them,
and no alert does. Record them as a P3 follow-up rather than widen this PR.
Also P3 (not fixed here): `walletSyncDuration` buckets top out at 60 s (`businessMetrics.ts:27`), so longer syncs
land only in `+Inf`.

**Test first.** `server/tests/unit/worker/walletSyncAttemptTelemetry.test.ts`: `finish('completed')` increments
`sanctuary_wallet_syncs_total{status="success"}` and observes the duration. `finish('failed')` and
`finish('timedOut')` each increment `status="failure"` exactly once; `finish('aborted')` increments neither status
and observes no duration; a second `finish` is a no-op. Stub `Date.now` (or use `vi.useFakeTimers()` +
`vi.setSystemTime`) so the observed duration is exact. Read values through the registry
(`registry.getSingleMetricAsString` or the metrics test helper used in
`tests/unit/observability/walletSyncMetrics.test.ts`), not via the mocked metric objects. At base nothing
increments, so the test fails. Add a case documenting existing behaviour: when completion throws **after**
`completeCanonicalSync` (publish/wake), the counters record exactly one terminal outcome, **`failure`**:
`finish('completed')` (:343) is only reached after publish (:330) and wake (:337) succeed, so a throw there lands in
the catch's `finish(cancellationOutcome ?? 'failed')` (:362); `status="failure"` is incremented once and
`status="success"` not at all. Record this (a durably completed sync counted as failed when publish/wake throws)
as a P3 follow-up; do not change the ordering in this phase. Also extend the **root** test
`tests/monitoring/wallet-sync-observability.test.ts` (repo root, not under `server/`): assert every metric referenced by `WalletSyncFailures` has a
producer. A grep-based check over `server/src` for `walletSyncsTotal.inc` is acceptable.
`server/tests/unit/services/syncService/syncServiceTestHarness.ts:342` mocks these metrics. Keep the mock shape.

**Docs.** `docs/explanation/scalability-and-performance.md:40,82` remain accurate once producers exist. No edit
beyond confirming.

**Constraints.** Run `node scripts/check-wallet-sync-lifecycle-contract.mjs` (the telemetry file is on the sync
lifecycle path).

**Acceptance.** Failing syncs raise `WalletSyncFailures`, aborted syncs do not, and the Wallet Sync dashboard shows
throughput and duration.

---

### Phase B16 — Electrum pool breakers share one registry key (P2, `electrum-health--pool-breakers-share-registry-key`)

**Evidence.** `server/src/services/bitcoin/electrumPool/poolCircuitBreaker.ts:12` names every breaker
`'electrum-pool'`. `createCircuitBreaker` auto-registers (`circuitBreaker.ts:281-285`).
`CircuitBreakerRegistry.register` uses a `Map` keyed by name (`:231-234`), so each new pool overwrites the previous
entry. Pools are created per network and feature scope (`poolRegistry.ts:137` `createPool`, `:332`, `:364`), and the
network is set after construction (`pool.setNetwork`, `electrumPool.ts:201`). `ElectrumPool.shutdown()`
(`electrumPool.ts:369+`) never unregisters. `services/health/serviceChecks.ts:21-50` `checkElectrum` uses the first
breaker whose name includes `electrum`. `/health` therefore reports whichever pool registered last. A mainnet open
circuit is hidden by a later testnet or feature pool.

**Change.**
1. `poolCircuitBreaker.ts`: `createElectrumPoolCircuitBreaker(onStateChange, instanceName)`, where
   `ElectrumPool`'s constructor passes `electrum-pool:${seq}` from a module-level monotonically increasing counter.
   The network isn't known at construction; `getCircuitHealth()` callers already log the network separately.
   Store the name on the pool.
2. `ElectrumPool.shutdown()` (`electrumPool.ts:369-419`) has no surrounding `try` today. Wrap its existing body in
   `try { ... } finally { circuitBreakerRegistry.unregister(this.circuitBreakerName); }`, so the entry is removed
   whether or not shutdown succeeds. No `catch` is added, so the safety-catch gate is unaffected (`services/bitcoin`
   is a scanned root). The pool is single-use after shutdown (`isShuttingDown`), so it never needs to re-register.
3. `serviceChecks.ts` `checkElectrum`: aggregate all breakers with `name.includes('electrum')` (this matches
   `electrum-pool:N` and keeps the existing `health.test.ts` fixtures named `electrum` and `electrum-mainnet` valid). Worst state wins
   (`open` → unhealthy, else `half-open` → degraded, else healthy). Add `details.breakers: [{ name, state, failures }]`.
   Keep the "No circuit breaker registered" branch unchanged; that is the separate P3
   `health-checks--disk-and-electrum-healthy-on-unknown`.

**Decision (flag).** "Worst state wins" means an open feature-scoped or non-default-network pool marks Electrum
unhealthy. Coordinator directive, and conservative.

**Test first.**
- `server/tests/unit/services/circuitBreaker.test.ts` or a new `server/tests/unit/services/bitcoin/electrumPool/poolCircuitBreaker.test.ts`:
  constructing two `ElectrumPool`s yields two registry entries. After `shutdown()` of one, one entry remains; a
  shutdown whose body throws still unregisters. The body is otherwise defensive, so force the throw explicitly: e.g.
  spy `globalThis.clearInterval` (or the module logger's `info`) to throw once during `shutdown()`, or give a
  connection a `client.disconnect` that throws on a path the body does not catch; assert the rejection propagates
  and the registry entry is gone. Clear the registry in the test's `beforeEach` (it is module-global).
  At base there is one entry, so the test fails.
- `server/tests/unit/api/health.test.ts` (it already asserts the half-open and "No circuit breaker" texts) mocks
  `circuitBreakerRegistry.getAllHealth` (`health.test.ts:20-24`), and base `checkElectrum` uses `find()` (first
  match). Return `electrum-pool:1` **closed first** and `electrum-pool:2` open second. Expect `checkElectrum`
  unhealthy. At base `find()` picks the closed breaker and reports healthy, so the test fails. (The
  last-registered-wins overwrite is covered by the real-registry two-pools-two-entries test above.) Optionally add
  half-open + closed (→ degraded) and open + half-open (→ unhealthy) cases for worst-state-wins. The existing tests at
  `health.test.ts:561-573` and `:588-602` (breaker names `electrum`, `electrum-mainnet`) must still pass unchanged
  under the `includes('electrum')` aggregation.

**Constraints.** `config/wallet-safety-mutation-map.json` pins no electrumPool files (verified). Check
`supportPackage/healthCollector.test.ts` and any other fixture for a literal `'electrum-pool'` breaker name
(`grep -rn "'electrum-pool'" server/tests`) and update it to the `electrum-pool:N` form.

**Acceptance.** `/health` reflects every live Electrum pool, and shut-down pools disappear from the registry.

---

### Phase B17 — Tor lifecycle requires per-run provenance labels to match (P2, medium confidence, `tor-control--per-run-labels-break-ownership`)

**Evidence.** `server/src/utils/docker/tor.ts:55-86` `currentTorOwnership()` builds the expected label set from the
backend env, including `io.sanctuary.created-at` (`SANCTUARY_CLEANUP_CREATED_AT`), `created-by-release`,
`created-by-commit` and `creation-run-id` (`SANCTUARY_OPERATION_RUN_ID`). `labelsMatch` (`:88-96`) requires all of
them to be equal. It is used in `findTorContainer` (`:192`, which throws "exact ownership identity is ambiguous"),
in inspect checks (`:224`, `:293`), and therefore in `getTorStatus`, `startTor`, `stopTor` and `createTorContainer`.
The Tor container is created only by the backend (`createTorContainer` stamps `...ownership.labels`, `:465`);
`docker-compose.yml` has no tor service. `scripts/ownership/producer-hooks.sh:34,37` defaults
`SANCTUARY_OPERATION_RUN_ID` and `SANCTUARY_CLEANUP_CREATED_AT` to fresh values on every operation, so the next
`./start.sh` or upgrade recreates the backend with new values. The existing UI-created Tor container then fails
every lifecycle action and cannot be recreated (the name is taken). The test harness pins fixed values
(`server/tests/unit/utils/docker/dockerTestHarness.ts:76-79`), so this drift is untested.

**Test first (gate).** In `server/tests/unit/utils/docker/tor-lifecycle.contracts.ts` (run by
`tests/unit/utils/docker.test.ts`), add: the container listing returns `/<project>-tor` with all labels equal
except `created-at`, `created-by-release`, `created-by-commit` and `creation-run-id` (the fixture must set values
that differ from the harness's pinned ones at `dockerTestHarness.ts:76-79`). `getTorStatus()` returns
the running status (not `error`), and `startTor()` on a stopped one succeeds. Also keep the existing "foreign
ownership tuple" test: a different `deployment-id` or `owner-id` must still be refused.
Also add (in `tor-create.contracts.ts`, next to the foreign-tuple cases at `:456-524`):
- after a lost create response, the widened `recoverCreatedTor` adopts a created-state container with the same
  identity but different provenance, and still refuses one with a foreign `owner-id`;
- post-create inspect at `:254` with matching identity but mismatched provenance returns null (covers
  `inspectHasExactCreatedProvenance`).
**If the new test passes at 336bc94b, record Rejected with the output.** Static reading says it fails with the
ambiguity error.

**Change.** Split `TorOwnership.labels` into `identityLabels` (project, deployment-id, owner-id, resource-class,
lifecycle, cleanup-policy, compose project/service) and `provenanceLabels` (created-at, release, commit, run-id).
`summaryHasExactIdentity` and the inspect checks at `:224` and `:293` match **identity only**. `createTorContainer`
still stamps both.
- Split `currentTorOwnership()` (called at the top of `startTor` `:543`, `stopTor` `:590`, `createTorContainer`
  `:388`, and inside `findTorContainer` `:172`; it throws when any provenance env var is missing) into
  `currentTorIdentity()` (used by `getTorStatus`, `startTor`, `stopTor`, `findTorContainer`) and
  `currentTorProvenance()` (create path only). Without this split the "`SANCTUARY_OPERATION_RUN_ID` missing →
  `getTorStatus`/`startTor` still succeed" test below fails.
- Split `inspectHasCreatedIdentity` (`tor.ts:215`), which today serves both `recoverCreatedTor` (`:232`, `:236`) and
  `verifyReturnedContainerId` (`:254`): keep `inspectHasCreatedIdentity` as identity-only (used by
  `recoverCreatedTor`, per the Decision below), and add `inspectHasExactCreatedProvenance` (identity + provenance),
  used at `:254`. The immediate post-create verification therefore keeps the **exact** identity + provenance
  check, so a just-created container is still proven to be ours. `verifyReturnedContainerId` falls back to
  `recoverCreatedTor` (`:248`) when the returned id is invalid; that fallback is identity-only by design.

**Decision (flag).** Identity-only matching in `inspectHasCreatedIdentity` widens `recoverCreatedTor`
(`tor.ts:215-256`): it will adopt a leftover created container from an earlier run of the same deployment and owner.
That is the intended effect (same deployment, same owner), and foreign deployments or owners are still refused.

**Constraints.**
- `scripts/ownership/check-lifecycle-callsites.mjs` and the lifecycle callsite registry: no new `kill`, `rm` or
  delete callsites. Run `node scripts/ownership/check-lifecycle-callsites.mjs` to confirm.
- The ownership cleanup tooling keys on `creation-run-id` when sweeping a run's resources
  (`producer-hooks.sh:124`). Stamping is unchanged, so cleanup semantics hold.
- Leave the "reports a missing ownership manifest field" test (`:157`) unchanged: it deletes `SANCTUARY_PROJECT`,
  which is still a required identity field. Add instead: with `SANCTUARY_OPERATION_RUN_ID` missing,
  `getTorStatus` and `startTor` still succeed, but `createTorContainer` fails.

**Acceptance.** A Tor container created by an earlier operation stays controllable after backend restarts and
upgrades. A container with another deployment or owner identity is still refused.

---

### Files touched (Group B) by these phases

Server:
- server/src/websocket/channels.ts, server/src/websocket/clientServer.ts
- server/src/repositories/userAdminUpdate.ts
- server/src/repositories/resyncRepository.ts, server/src/repositories/resyncAnnotationSnapshot.ts (new), server/src/repositories/walletRepository.ts (`deleteById`: snapshot cleanup via `deleteResyncAnnotationSnapshot` in the same `$transaction`, ≤ 3-line delta), server/src/worker/jobs/canonicalIncrementalSync.ts (snapshot overflow / corrupt snapshot → `PermanentIncrementalSyncError`)
- server/src/repositories/consoleRepository.ts
- server/src/repositories/deviceRepository.ts, server/src/api/devices/crud.ts
- server/src/repositories/mobilePermissionRepository.ts
- server/src/middleware/requestTimeout.ts, server/src/errors/errorHandler.ts
- server/src/services/auditService.ts, server/src/middleware/requestLogger.ts
- server/src/services/aiService.ts and server/src/services/ai/index.ts (re-exports of the new `userId` signatures, if they declare signatures)
- server/src/services/ai/llmEgressProxyClient.ts, server/src/services/ai/features.ts, server/src/api/ai/features.ts, server/src/services/ai/health.ts, server/src/services/intelligence/conversationService.ts, server/src/services/intelligence/analysisService.ts, server/src/assistant/console/modelGateway.ts, server/src/assistant/console/service.ts (plan/synthesize call sites)
- server/src/mcp/transport.ts
- server/src/services/notifications/channels/aiInsights.ts
- server/src/api/wallets/webhooks.ts, server/src/services/webhooks/config.ts, server/src/services/webhooks/subscriptions.ts, server/src/services/webhooks/deliveryService.ts
- server/src/repositories/utxoRepository.ts, server/src/services/privacyService.ts
- server/src/worker/walletSyncAttemptTelemetry.ts
- server/src/services/bitcoin/electrumPool/poolCircuitBreaker.ts, server/src/services/bitcoin/electrumPool/electrumPool.ts, server/src/services/health/serviceChecks.ts
- server/src/utils/docker/tor.ts

Gateway / proxy:
- gateway/src/routes/proxy/proxyConfig.ts
- llm-egress-proxy/src/rateLimit.ts, llm-egress-proxy/src/labelQueryRoutes.ts

Frontend:
- src/components/NetworkSyncActions/ResyncConfirmationDialog.tsx, src/components/WalletDetail/hooks/useWalletSync.ts
- src/api/ai.ts, src/api/intelligence.ts

Tests:
- server/tests/unit/websocket/clientServerLimits/clientServerLimits.subscriptions.contracts.ts
- server/tests/unit/repositories/userAdminUpdate.test.ts, server/tests/integration/flows/admin/users.contracts.ts (new case + rewrite of :486-520)
- server/tests/unit/repositories/resyncRepository.test.ts, server/tests/unit/repositories/resyncAnnotationSnapshot.test.ts (new), server/tests/integration/repositories/syncCorrectionAtomicity.test.ts, worker canonicalIncrementalSync unit test (overflow → permanent), server/tests/unit/repositories/walletRepository/walletRepository.mutations.contracts.ts (`deleteById` `$transaction` form)
- server/tests/unit/repositories/consoleRepository.test.ts
- server/tests/integration/repositories/deviceRepository.test.ts, server/tests/unit/api/devices/devices.crud.contracts.ts, deviceAccess / listDevicesTool walletCount tests
- server/tests/integration/repositories/mobilePermissionAccess.test.ts, server/tests/unit/repositories/mobilePermissionRepository.test.ts
- server/tests/unit/middleware/requestTimeout.test.ts, server/tests/unit/errors/errorHandler.test.ts
- server/tests/unit/services/auditService.test.ts, server/tests/unit/middleware/requestLogger.test.ts
- gateway/tests/unit/routes/proxyConfig.test.ts (+ proxyTransport.test.ts)
- tests/llm-egress-proxy/rateLimit.test.ts, tests/llm-egress-proxy/labelQueryRoutes.test.ts, server/tests/unit/services/ai/llmEgressProxyClient.test.ts (new) and caller tests (ai features, conversationService, analysisService, health, console modelGateway and console service)
- server/tests/unit/mcp/transport.test.ts
- server/tests/unit/services/notifications/channels/aiInsights.test.ts
- server/tests/unit/services/webhooks/deliveryService.test.ts, webhookCore.test.ts, server/tests/unit/api/wallet-webhooks-routes.test.ts
- server/tests/unit/services/privacyService.test.ts
- server/tests/unit/worker/walletSyncAttemptTelemetry.test.ts, tests/monitoring/wallet-sync-observability.test.ts
- server/tests/unit/services/circuitBreaker.test.ts (or new poolCircuitBreaker.test.ts), server/tests/unit/api/health.test.ts
- server/tests/unit/utils/docker/tor-lifecycle.contracts.ts, server/tests/unit/utils/docker/tor-create.contracts.ts (B17 recover/post-create provenance cases)
- tests/api/intelligence.test.ts, tests/api/coreApiModules.test.ts, tests/api/client/client.basic.contracts.ts (B7)
- server/tests/unit/repositories/walletRepository/walletRepository.mutations.contracts.ts (B3, listed above)

Docs/config:
- docs/how-to/operations-runbooks.md (new "Full resync" subsection: annotations preserved)
- MCP rate-limit and route-timeout docs, if present (grep before editing)
- No changes expected to config/wallet-sync-mutation-boundaries.json, config/wallet-safety-mutation-map.json,
  config/hardware-wallet-implementation-inventory.json, scripts/quality/safety-catch-allowlist.json,
  scripts/ci/backend-integration-groups.sh, or the e2e mock maps (no new endpoints). Run their checkers to confirm.

## Group C — PR C: frontend non-signing + tests

### Phase C1: TZ regression test valid under both pools (P2, `transaction-filter-test--tz-mutation-under-threads`)

**Evidence**
- `tests/components/WalletDetail/tabs/TransactionFilterBar.test.tsx:45-85` assigns `process.env.TZ` (Honolulu, Berlin) and asserts `getTimezoneOffset()`.
- Under `--pool threads`, the reassignment does not reach the worker's ICU zone, so the Berlin case fails.
- `.github/workflows/test.yml:178` and `:286` run frontend tests with `--pool threads`. Coverage shards use forks (`scripts/ci/frontend-coverage-shard.sh:83`).
- `tests/utils/balanceHistorySeries.test.ts:3-6` already records this limitation. The repo's approach is to build times in the host zone with local constructors.
- The code under test is `toDateInputValue` (`src/components/WalletDetail/tabs/TransactionFilterBar.tsx:33-40`). It now uses local getters. Before 336bc94b it used `new Date(ts).toISOString().slice(0, 10)`.

**Change (test only; product code unchanged)**
- Delete the `process.env.TZ` mutation, the `originalTz` `afterEach`, and the `it.each` zone table.
- Replace them with two tests that hold in any host zone and under either pool:
  1. **Round trip.** Build `dateFrom = new Date(2026, 9, 5).getTime()` and `dateTo = new Date(2026, 9, 5, 23, 59, 59, 999).getTime()`, as today. Assert the inputs show `'2026-10-05'`. Assert the `fireEvent.change` callbacks receive `new Date(2026, 9, 4).getTime()` and the end of day 2026-10-06. Keep the empty-value → `null` assertion. This is valid in every zone.
  2. **Discriminator against UTC formatting.** `vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('1999-01-01T00:00:00.000Z')`, render with the same filters, then assert both inputs show `'2026-10-05'`. Restore with `mockRestore()` in a `finally` or `afterEach`.
     - Pre-iteration-2 code shows `1999-01-01` in every host zone, including UTC CI hosts, so it fails.
     - Current code does not call `toISOString`, so it passes.
  - Follow the precedent `tests/components/BackupRestore.test.tsx:523` (`vi.spyOn(Date.prototype, 'toLocaleString')`).
- Put the comment from `balanceHistorySeries.test.ts:3-6` above the tests so nobody re-adds TZ mutation.

**Test first / confirm**
- Temporarily revert line 36-39 of `TransactionFilterBar.tsx` to `return new Date(ts).toISOString().slice(0, 10);`. Test 2 must fail under both `--pool threads` and `--pool forks`.
- Restore the code. Then run both:
  - `npx vitest run --config config/tooling/vitest.config.ts --pool threads tests/components/WalletDetail/tabs/TransactionFilterBar.test.tsx`
  - the same command with `--pool forks`
- Both must pass. Also run `npx vitest related --config config/tooling/vitest.config.ts --run --pool threads --maxWorkers=2 --no-file-parallelism src/components/WalletDetail/tabs/TransactionFilterBar.tsx`, which is the exact Quick Frontend Tests shape.

**Constraints**
- None (test-only).
- No test or source file assigns `process.env.TZ`: `grep -rnE "process\.env\.TZ[[:space:]]*=[^=]" tests src` must return nothing afterwards. (Comments that mention `process.env.TZ`, including the one copied from `balanceHistorySeries.test.ts`, are allowed.)

**Acceptance**
- The file passes under threads and forks.
- Reverting the fix makes it fail under both.
- Coverage of `TransactionFilterBar.tsx` stays at 100%.

---

### Phase C2: Wallet Stats first activity and accumulation chart from full history (P2, `wallet-stats--first-activity-from-loaded-page`)

**Evidence**
- `src/components/WalletDetail/WalletDetailLoadedView.tsx:170-179` (`buildStatsTabProps`) passes `controller.transactions`. These are the loaded pages only (`TX_PAGE_SIZE = 50`, `src/components/WalletDetail/hooks/walletDataTypes.ts:20`).
- `src/components/WalletStats.tsx:28,48` feeds them to `getOldestTransactionDate` and `buildAccumulationHistory` (`src/components/WalletStats/walletStatsData.ts:89-154`). The chart starts at 0 the day before the oldest *loaded* transaction.
- UTXOs already use the full set (`loadUtxosForStats`, `walletDataLoaders.ts:100`). Transactions do not.
- A server-side full-history series already exists: `GET /transactions/balance-history?timeframe=ALL&walletIds=<id>` (`server/src/api/transactions/crossWallet.ts:330-397`).
  - Its client is `transactionsApi.getBalanceHistory` (`src/api/transactions/transactions.ts:201`). The wallet sparklines already call it per wallet (`src/hooks/queries/useWallets.ts:309`).
  - For `ALL` it returns daily buckets. `points[0]` (`name: 'Start'`) is stamped at the first activity bucket. With no activity it returns exactly 2 points (Start = Now).

**Change**
- Add `useWalletActivityHistory(walletId, balance, enabled)` in `src/hooks/queries/useWallets.ts`.
  - Key it through the existing `walletActivityKeys` factory (`src/hooks/queries/useWallets.ts:43-68`), not a literal key: add `walletActivityHistory: { all: [...], detail: (walletId, balance) => [...] }` under it. `balance` stays in the key only because it is a request parameter.
  - The factory is **not** invalidated as a whole today: `useWebSocketQueryInvalidation.ts:58-84` invalidates only `pendingTransactions.all`, `recentTransactions.all`, `activitySummary.all` and `walletKeys.all`, and `useBroadcast.ts:200-208` refetches `pendingTransactions.all` / `walletKeys.all` and invalidates `recentTransactions.all`. **Decided (approach a):** add `walletActivityKeys.walletActivityHistory.all` invalidation to `handleTransactionEvent` and `handleNewBlock` in `src/hooks/websocket/useWebSocketQueryInvalidation.ts`, and to `refetchBroadcastCaches` in `src/hooks/send/useBroadcast.ts`, with a test at each site. The history then refreshes on any new tx, confirmation or broadcast (including self-transfers, which keying on balance alone would miss).
  - It is a `useQuery` that calls `transactionsApi.getBalanceHistory('ALL', balance, [walletId])`.
- In `walletStatsData.ts`, add:
  - `buildAccumulationFromHistory(points, now)`: maps `{timestamp, value}` to `{name: dateFormat(date), amount: value}`, using the existing `getAccumulationDateFormatter` span logic and de-duplication by label.
  - `getFirstActivityFromHistory(points)`: returns `new Date(points[0].timestamp)` when `points.length > 2`, else `null`.
- Thread `walletId` and `hasMoreTx` through `buildStatsTabProps` → `StatsTab` (`src/components/WalletDetail/tabs/StatsTab.tsx`) → `WalletStats`.
- In `WalletStats`:
  - **`hasMoreTx` false (all history loaded):** keep today's exact client computation. No request is made, so small wallets are unchanged.
  - **`hasMoreTx` true:** enable the query.
    - On success, use the server series for both the First Activity card and the accumulation chart.
    - While loading, show the existing `chartReady` placeholder.
    - On error, fall back to the loaded-page computation and show the caption "Based on the N most recent transactions". Never present partial data as final.
- Caveat: the server series excludes unconfirmed rows and is day-bucketed. The card shows only month/year and "N days ago", so day precision is enough. Note this in a code comment.

**Test first**
- `tests/components/WalletStats.test.tsx` renders `WalletStats` with no `QueryClientProvider`, and the new `useQuery` throws "No QueryClient set" even with `enabled: false`. Wrap every `WalletStats` render in a `QueryClientProvider` (fresh `QueryClient`, `retry: false`) via a local render helper (or `vi.mock` the new hook for the existing cases), and use the provider for the new `getBalanceHistory` cases.
- `tests/components/WalletStats.test.tsx`: render with 50 transactions (oldest 2026-01-10) and `hasMoreTx: true`. Mock `transactionsApi.getBalanceHistory` to return a series starting 2021-03-01. Expect the First Activity card to show Mar 2021. This fails at 336bc94b because the props and hook do not exist and the card shows Jan 2026. Also cover:
  - `hasMoreTx: false` makes no request;
  - the error fallback caption appears;
  - a 2-point (no activity) series gives "No transactions".
- `tests/hooks/queries/useWallets.test.tsx`: the new hook calls `getBalanceHistory('ALL', balance, [id])` and is disabled when `enabled` is false. Add a `walletActivityKeys` case: `walletActivityHistory.detail(id, balance)` starts with `walletActivityHistory.all`, so invalidating `.all` matches it.
- Invalidation sites: the `useWebSocketQueryInvalidation` tests assert `handleTransactionEvent` and `handleNewBlock` invalidate `walletActivityKeys.walletActivityHistory.all`; the `useBroadcast` tests assert `refetchBroadcastCaches` invalidates it too. Both fail at 336bc94b.
- The extra invalidation makes `invalidateQueries` fire twice in `refetchBroadcastCaches`: update the exact-count assertions at `tests/hooks/useBroadcast.test.tsx:310` and `tests/hooks/useSendTransactionActions/useSendTransactionActions.signing.contracts.tsx:212` to 2.
- `tests/components/WalletDetail/tabs/StatsTab.test.tsx` and the `buildStatsTabProps` consumer test (`tests/components/WalletDetail/WalletDetailLoadedView*`): assert `walletId` and `hasMoreTx` are passed through.
- Create `tests/components/WalletStats/walletStatsData.test.ts` (it does not exist) for the `walletStatsData` helper unit tests.

**Constraints**
- No new endpoint.
- `/transactions/balance-history` is already handled by all 13 e2e mock sites, including the `wallet-sharing-privacy.spec.ts` dispatcher. Confirm that the `stats tab shows transaction statistics` e2e (`wallet-sharing-privacy.spec.ts:690`) still has `unhandledRequests == []`. If a mocked wallet reports `hasMoreTx`, its balance-history mock response must be a valid point array (≥ 2 points), or the Stats tab renders the error fallback; check each such mock.
- No openapi change.
- Frontend coverage must stay at 100%.

**Acceptance**
- On a wallet with more than 50 transactions, Stats shows the true first-activity month and a full-history chart.
- Wallets with 50 or fewer transactions make no extra request.
- The failure path is labelled partial.

---

### Phase C3: AI transaction filter labels results computed over loaded pages only (P2, `ai-transaction-filter--aggregates-loaded-page-only`)

**Evidence**
- `src/components/WalletDetail/hooks/useAITransactionFilter.ts:205-267` filters, sorts, limits and aggregates the `transactions` argument. `useWalletDetailController.ts:159` passes the loaded pages.
- `src/components/WalletDetail/tabs/TransactionsTab/AiFilterSummary.tsx:28-35` prints `Result: X (sum)` or `Showing N of M transactions`, where M is the loaded count.
- `TransactionsTab.tsx:74-80` has `hasMoreTx` in scope (it passes it to `LoadMoreTransactions` at :96) but does not pass it to `AiFilterSummary`.

**Change (Decision: conservative labelling, not auto-load)**
- Add a `hasMoreTx: boolean` prop to `AiFilterSummary`, and pass `hasMoreTx={hasMoreTx}` from `TransactionsTab`. No `loadedCount` prop: `transactions.length` is already passed and gives N.
- When `hasMoreTx` is true:
  - **Aggregation:** render `Partial result: <value> (<agg>)` followed by `— over the <N> loaded transactions; older transactions are not included. Load more to extend.` Add `data-testid="ai-filter-partial-notice"`.
  - **No aggregation** (including sort + limit queries, which are also computed over loaded pages only): render `Showing N of M loaded transactions (more not loaded)`.
- When `hasMoreTx` is false, the text is unchanged.
- Auto-loading every page before aggregating would give exact answers, but it fans out unbounded requests on large wallets. It is flagged **Decision** for product. Server-side aggregation would be the proper long-term answer.

**Test first**
- `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx` already defaults `hasMoreTx: true` (line 69).
- Add: with `aiQueryFilter.aggregation = 'sum'` and `hasMoreTx: true`, expect the `ai-filter-partial-notice` test id or the text "older transactions are not included". This fails at 336bc94b.
- Add the `hasMoreTx: false` counterpart, where the plain `Result:` has no notice.
- Existing assertions that depend on the old wording under the default `hasMoreTx: true` are at :117 (`'Result:'`), :118, :153, :189 and :205 (`'Showing 1 of 2 transactions'`). Set `hasMoreTx: false` explicitly in those tests so they keep asserting the unchanged final wording, and cover the partial wording only in the new tests (add a sort + limit partial case).

**Constraints**
- Frontend coverage must stay at 100% (both branches).
- No API change.

**Acceptance**
- No AI aggregate or count is ever shown as final while unloaded pages exist.

---

### Phase C4: Proxy "Verify" resolves the stored password when the mask is sent (P2, `proxy-test--masked-password-sent`)

**Evidence**
- `server/src/api/admin/nodeConfig.ts:222`: GET returns `proxyPassword: MASKED_PROXY_PASSWORD` (`'********'`, `nodeConfigData.ts:110`).
- `src/components/NodeConfig/useProxyTorControls.ts:40-45` posts `nodeConfig.proxyPassword` (the mask) to `adminApi.testProxy`.
- `server/src/api/admin/proxyTest.ts:55-66,96-98` uses it literally, both as the SOCKS `password` and in the `socks5://user:pass@` URL.
- Only `resolveProxyPassword` (`nodeConfigData.ts:193-201`, save path) understands the sentinel.

**Change (server-side sentinel; Decision: stored secret is only replayed to the stored proxy)**
- In `proxyTest.ts`, after parsing: if `password === MASKED_PROXY_PASSWORD`, load `nodeConfigRepository.findDefault()` (new import in `proxyTest.ts`; `findDefault` is `findFirst({ where: { isDefault: true } })`).
  - If the stored `proxyPassword` is set **and** `stored.proxyHost?.toLowerCase() === host.toLowerCase()`, `Number(stored.proxyPort) === Number(proxyPort)` and `(stored.proxyUsername ?? '') === (username ?? '')`, substitute `decryptIfEncrypted(stored.proxyPassword)` (from `server/src/utils/encryption.ts`).
  - Otherwise throw `InvalidInputError('Re-enter the proxy password to test this proxy')`.
- This way an admin session cannot replay the stored credential to an arbitrary host.
- Import `MASKED_PROXY_PASSWORD` from `./nodeConfigData`.
- Also wrap `username`/`password` in `encodeURIComponent` when building `proxyUrl` (line 96-98). Without that, a password containing `@`, `:` or `/` breaks the URL. Same function, same test.
- Client: no change is required. Optionally keep it sending the mask, which is now meaningful.

**Test first**
- `server/tests/unit/api/adminNodeConfig/adminNodeConfigTestHarness.ts:62-64` mocks `../utils/encryption` with only `encrypt`. Extend the mock with `decryptIfEncrypted` (a `mockDecrypt` spy) and adjust any expectations that assumed the narrower mock.
- In `server/tests/unit/api/adminNodeConfig/adminNodeConfig.proxy.contracts.ts`, add:
  - **Mask + matching stored config:** mock `mockPrismaClient.nodeConfig.findFirst` (what `findDefault` uses; the harness already mocks `nodeConfigRepository` through it) to return host 127.0.0.1, port 9050, username tor-user and an encrypted `proxyPassword`, with `mockDecrypt` returning `'tor-pass'`. POST with `password: '********'`. Expect SOCKS called with `password: 'tor-pass'`. At 336bc94b it receives `'********'`, so this fails.
  - **Mask + same host in different case and port as string:** substitutes the stored password.
  - **Mask + different host:** expect 400.
  - **Mask + no stored password:** expect 400.
  - **Password with `@`:** expect an encoded URL.
- Frontend: `tests/components/NodeConfig.interactions.test.tsx` gets an assertion that Verify still posts the current field value. Behaviour is unchanged, so this only guards against regressions.

**Constraints**
- Openapi `/admin/proxy/test` (`server/src/api/openapi/paths/admin/core.ts:305`): add to the description that `"********"` means "use the stored password for the stored host/port". The 400 response is already declared.
- Backend unit coverage must stay at 100% for the new branches.
- No schema change.

**Acceptance**
- An authenticated SOCKS proxy verifies without retyping the password.
- The mask sent with a different host is rejected.

---

### Phase C5: Admin and other e2e specs stop skipping their bodies (P2, `e2e-admin--vacuous-group-tests`)

**Evidence**
- Non-waiting `isVisible()` guards appear immediately after navigation in `tests/e2e/admin-operations.spec.ts`:
  - :51 (Change History);
  - :107 (delete user);
  - :125 and :143 (group input, rendered by `src/components/UsersGroups/GroupPanel.tsx:110` with placeholder `"New group name"` only after load);
  - :160 (delete group, `title="Delete group"` at `GroupPanel.tsx:45`);
  - :624 (audit Filters).
- `isVisible({timeout}).catch(() => false)` guards appear in:
  - `tests/e2e/settings-persistence.spec.ts:313`;
  - `tests/e2e/error-recovery.spec.ts:462` (Save button is always rendered: `src/components/Variables/ThresholdsCard.tsx:54-60`);
  - `tests/e2e/wallet-sharing-privacy.spec.ts:743` (tab loop).
- The mocks support `POST` and `DELETE /admin/groups` and `/admin/users` (`tests/e2e/adminOperationsApiMock.ts:106-166`).
- Delete uses `window.confirm` (`useUsersGroupsController.ts:147,213`).

**Change**
- In every listed site, replace `if (await x.isVisible())` with `await expect(x).toBeVisible()` and remove the conditional, so the body always runs.
- Specifics:
  - **Group tests:** use `page.getByPlaceholder('New group name')`. Use `page.getByRole('listitem').filter({ hasText: 'Group To Delete' }).getByTitle('Delete group')` instead of the `button:has(svg)` `.last()` heuristic. Register `page.once('dialog', d => d.accept())` before the click.
  - **wallet-sharing-privacy tab loop:** fix the list to the tabs the mocked wallet actually has (derive from `src/components/WalletDetail/tabDefinitions` for the mocked role and type). Assert each tab, click it, then `await expect(tab).toHaveAttribute('aria-selected', 'true')` plus one content marker per tab, instead of `waitForTimeout(200)`. Wallet-detail tabs have no `role="tabpanel"` (`TabBar` `getTabProps` sets no `aria-controls`; only `TransactionList.tsx:249` and `TransactionDetailPanel.tsx:55` use that role), so a `getByRole('tabpanel')` assertion cannot work.
  - **settings-persistence:** the "Fiat Currency" label (`DisplaySection.tsx:60-64`) has no `htmlFor` and the select has no `id`, so `getByRole('combobox', { name: 'Fiat Currency' })` cannot match. Use a container-scoped locator: `page.locator('div').filter({ has: page.getByText('Fiat Currency', { exact: true }) }).getByRole('combobox')`. Assert it, then assert the option count.
  - **error-recovery:** use `page.getByRole('button', { name: 'Save Changes' })`; once the assertion is unconditional, a looser locator would trip Playwright strict mode.
- Grep the whole `tests/e2e` for `isVisible(` outside `expect(` afterwards. It must return nothing.

**Test first**
- The non-regression is the specs themselves. To confirm they were vacuous, temporarily break the create handler, for example by making the `POST /admin/groups` mock return 500. At 336bc94b the old spec still passes; the new spec must fail.
- Run locally per CLAUDE.md, without the dev server:
  - `npm run build`;
  - serve `dist/` with a static server, e.g. `npx http-server dist -p 4173`;
  - use a throwaway Playwright config in the scratchpad that copies `config/tooling/playwright.config.ts` minus `webServer`, with `baseURL` set to the static server;
  - run `npx playwright test -c <throwaway> tests/e2e/admin-operations.spec.ts tests/e2e/settings-persistence.spec.ts tests/e2e/error-recovery.spec.ts tests/e2e/wallet-sharing-privacy.spec.ts`.

**Constraints**
- No new endpoints, so the mock maps are unchanged.
- Render-regression snapshots are not affected.
- `tests/e2e/*` routes to the e2e and browser-smoke lanes.

**Acceptance**
- Every touched test asserts unconditionally.
- All four specs pass against the static build.
- The deliberately broken mock makes the group test fail.

---

### Phase C6: Electrum SOCKS proxy uses the decrypted password at runtime (P2, `node-proxy--runtime-uses-encrypted-password`)

Evidence (re-verified at 336bc94b): `server/src/api/admin/nodeConfigData.ts:185-201`
`resolveProxyPassword` persists `encryptedOrNull(input)`; `shared/constants/nodeConfig.ts:441-459`
`projectNodeProxyConfig` reads `proxyPassword` raw. It has **three** server callers:
`server/src/services/bitcoin/electrumPool/poolConfig.ts:141-145` (`proxyConfigFromNodeConfig`, used at :252),
`server/src/services/bitcoin/electrum/connectionConfigResolver.ts:50-56` (`proxyConfigFromNodeConfig`, used at
:75/:94/:113/:131/:143; consumed by `networkStatusService.ts`, `networkStatus/directClient.ts` and
`electrum/electrumClient.ts`), and `server/src/services/bitcoin/electrumPool/nodeConfigMapper.ts:74-75`
(`getProxyConfig`, referenced only by `module-level-pool-helpers.contracts.ts` (import :21, cases :441-454), i.e. dead in production).
`server/src/services/bitcoin/electrum/connection.ts` uses the projection as the SOCKS password. `decrypt(` is not
called anywhere on this path, so an authenticated SOCKS proxy always fails to authenticate.

Change:
- Add one server-side helper, e.g. `projectNodeProxyConfigDecrypted(nodeConfig)` in
  `server/src/services/bitcoin/electrum/proxyCredentials.ts` (or next to `connectionConfigResolver.ts`), which calls
  `projectNodeProxyConfig` and replaces a non-empty `password` with `decryptIfEncrypted(password)` (the helper C4
  uses, `server/src/utils/encryption.ts`). Keep `shared/` free of crypto.
- Use it in `poolConfig.ts` and `connectionConfigResolver.ts`. Delete the dead `nodeConfigMapper.getProxyConfig`
  and its test references in `module-level-pool-helpers.contracts.ts` (the import at line 21 and the cases at
  441-454) rather than covering it.
- **Decision (decrypt failure):** if decryption throws (wrong `ENCRYPTION_KEY`, corrupt value), the helper logs
  `log.error('Stored proxy password cannot be decrypted', …)` without the value and throws a typed
  `ProxyConfigurationError('Stored proxy password cannot be decrypted; re-enter it in Node Config')`.
  `ProxyConfigurationError` does not exist yet: define and export it server-side next to the new helper. It never
  falls back to the ciphertext and never returns `null`/`undefined` (that would connect without the proxy and leak
  traffic outside Tor).
- Pool path: `loadPoolConfigFromDatabase` (`electrumPool/poolConfig.ts:244-264`) catches everything, logs "using
  defaults" and resolves `{ config: {}, servers: [], proxy: null }`, so the decrypt error would be swallowed and a
  zero-server pool cached. Add, before the generic warn:
  `if (error instanceof ProxyConfigurationError) { log.error('Stored proxy password cannot be decrypted', { network }); throw error; }`
  (it ends in `throw`, so the safety-catch gate passes). Pool callers tolerate the rejection: `poolRegistry`
  `getElectrumPoolForNetwork` clears its init promise in `finally` (:204-208); `nodeClient.ts:204,351` fall back to
  the singleton; `reloadServers` catches; `networkStatusService` rejects into the route catch.
- Direct path: `connectionConfigResolver` rejects; `ElectrumClient.establishConnection` turns it into a connect
  failure; `GET /bitcoin/status` returns `connected:false` with the message (`api/bitcoin/network.ts:72-85`). No crash.
- Any other catch added in `services/bitcoin` must end in `return`/`throw` (safety-catch gate).

Test first:
- `server/tests/unit/services/bitcoin/electrumPool/poolConfig.test.ts`: a persisted config whose `proxyPassword` is
  `encrypt('s3cret')` yields `proxy.password === 's3cret'` (fails on 336bc94b with the ciphertext).
- The same for `connectionConfigResolver` (its existing test, or a new
  `server/tests/unit/services/bitcoin/electrum/connectionConfigResolver.test.ts`).
- Failure case (pool): with a `proxyPassword` that fails decryption, `loadPoolConfigFromDatabase` **rejects** with
  `ProxyConfigurationError` (it does not resolve with `proxy: null`), and it still resolves with defaults for other
  errors (e.g. a DB failure).
- Failure case (direct): `connectionConfigResolver` rejects with `ProxyConfigurationError`; the result never
  contains the ciphertext or a proxy-less config.
- Unit tests for the helper itself: no proxy, proxy without password, plaintext legacy value (passes through
  `decryptIfEncrypted`), encrypted value.

Constraints: mutation map: confirm no pinned mutant in `poolConfig.ts` / `connectionConfigResolver.ts` /
`nodeConfigMapper.ts` shifts (grep `config/wallet-safety-mutation-map.json`). Run
`node scripts/check-safety-catch-guards.mjs`.

Acceptance: the decrypt tests fail on 336bc94b and pass after; an undecryptable password fails closed without
taking down the process; backend unit coverage 100%.

## Group D — PR D: CI/ops/install

### Phase D1: test.yml lane scripts trigger their lanes (P2, `ci-classifier--lane-scripts-trigger-nothing`)

**Evidence**
- `scripts/ci/classify-files-lib.sh` has no predicate for most `scripts/ci/*` helpers.
  - `is_full_scan_trigger_file` (:224-237) lists only manifests, tooling configs, `test.yml` and composite actions.
  - `is_test_suite_file` (:190-197) lists 3 scripts and sets only browser-smoke, render and build.
  - Only frontend coverage scripts are in `is_frontend_file` (:22).
- `test.yml` invokes `prepare-integration-db.sh` (:363, :882, :889), `backend-coverage-shard.sh` (:595), and 24 other root `scripts/ci/*` helpers (`run-with-log.sh` ×48, `with-runner-lock.sh` ×32, `retry-command.sh` ×20, …). A PR that edits only one of these gets every lane skipped, and `pr-required-checks` (:417, :457 `allow_success_or_skipped`) accepts that.
- Three refs are working-directory-relative server paths (`scripts/mutation/*.mjs`, `scripts/seed-browser-e2e.ts` → `server/scripts/...`). They are already covered by `is_backend_file`, `is_critical_mutation_file` and `is_browser_smoke_file`.

**Change (Decision: full_scan, not per-lane mapping)**
- Add a predicate `is_test_lane_infrastructure_file` in `classify-files-lib.sh`, listing every root `scripts/ci/*` path that `test.yml` or `.github/actions/*/action.yml` executes, plus the scripts those scripts call or source.
  - Derive the list once with `grep -o 'scripts/ci/[A-Za-z0-9_.-]*'`, run transitively over the referenced scripts.
  - It also includes `classify-files-lib.sh`, `classify-test-changes.sh` and `related-test-args.sh`.
  - **Excluded** (they already have a dedicated, narrower predicate whose classification is asserted by existing tests): `classify-quality-scope.sh` (`classify-test-changes.test.sh:262-275`), `backend-integration-groups.sh` and `browser-e2e-groups.sh` (:279-310), `frontend-coverage-*` including `frontend-coverage-shard.sh` (:324-335), `setup-verifier-test-dependencies.sh` (:470-478), and `verify-jade-junit.mjs`. Implement the exclusion as an explicit list checked before the full-scan list, so those existing assertions stay unchanged.
- Call it from `is_full_scan_trigger_file`.
- These helpers wrap every lane, so the narrowest safe answer is a full scan. A per-lane map would drift.
- Keep the existing `is_frontend_file` entries.
- `classify-test-changes.sh` (:194) and `plan-test-run.sh` (:184) need no change because they already honour `is_full_scan_trigger_file`.

**Test first**
- `tests/ci/classify-test-changes.test.sh` (694 lines, so ~40 more is fine; the large-file gate only scans js/ts):
  - a case where a PR changes only `scripts/ci/backend-coverage-shard.sh` must give `full_scan=true`. This fails at 336bc94b, where all lanes are false.
  - Same for `scripts/ci/prepare-integration-db.sh` and `scripts/ci/with-runner-lock.sh`.
- `tests/ci/plan-test-run.test.sh`: the same three files give `full_scan == true` and `lanes.backend_unit.run == true`.
- **Drift guard** (in `classify-test-changes.test.sh`):
  - extract every `scripts/ci/...` path from `.github/workflows/test.yml` and from every file returned by `find .github/actions -name action.yml`, with grep;
  - keep only paths that exist as files at the repo root (this drops grep artifacts such as `scripts/ci/vendor.` and the server-relative refs, which resolve under `server/` and do not exist at the root);
  - for each remaining path, assert that `is_full_scan_trigger_file`, `is_frontend_file` or the dedicated predicate of an excluded script returns 0 (source the lib);
  - the existing assertions at `classify-test-changes.test.sh:262-275`, `:279-310`, `:324-335` and `:470-478` must pass unchanged.
  - The guard fails when someone adds a new helper to `test.yml` without classifying it.

**Constraints**
- Both test files already register temp-dir cleanup in `config/resource-lifecycle-callsites.json`. A new `rm -rf` site is covered only if it lives in the same file, and the checker (`scripts/ownership/check-lifecycle-callsites.mjs`) must pass.
- `scripts/ci/classify-quality-scope.sh` may need these test files in scope. Its tests are in `tests/ci/classify-quality-scope.test.sh`.

**Acceptance**
- Editing any `test.yml`-executed helper forces a full test scan.
- The drift guard is green on the current `test.yml`.

---

### Phase D2: Lockfile peer-resolution gate fails closed when npm fails (P2, `quality-gate--lockfile-peer-check-fails-open`)

**Evidence**
- `scripts/quality/check-lockfile-peer-resolution.sh:32`: `out=$(... npm install --package-lock-only --no-audit --no-fund --dry-run 2>&1 || true)` discards npm's exit status. The script then only greps peer patterns. A registry 5xx, timeout or crash prints `peer resolution clean`.
- Callers: `.github/workflows/quality.yml:197` and `renovate-preflight.yml:70`, with no retry.

**Change**
- Capture the status: `status=0; out=$(cd "$pkg_dir" && npm install ... 2>&1) || status=$?`.
- Keep the peer-pattern and allowlist logic, then:
  - if non-allowlisted peer drift remains, report drift as today;
  - else if `status -ne 0` **and** `$out` contains no recognised peer pattern at all, print `::error::npm resolver failed for $dir/package-lock.json (exit $status); peer resolution NOT verified` plus the last 20 lines of `$out`, and count it as a failure (fail closed);
  - else print clean.
- **Decision (allowlist semantics):** npm exits non-zero on the very peer warnings the allowlist accepts, so a non-zero exit whose recognised peer matches are all allowlisted counts as clean. Only a non-zero exit with no recognised peer pattern (registry 5xx, timeout, crash) is treated as resolver failure.
- Before merge, confirm `npm install --package-lock-only --dry-run` exits 0 (or non-zero with only allowlisted peer matches) for `.`, `server`, `gateway` and `llm-egress-proxy` on the current lockfiles, so the gate is green on `main`.
- Do not add a retry loop here. A transient failure turns the job red and is retriggered under the repo's retrigger discipline (memory: npm audit gate registry stalls). Fail closed is the policy.

**Test first**
- Create `tests/ci/check-lockfile-peer-resolution.test.sh`.
  - Copy the script into a temp tree `$tmp/scripts/quality/`; `REPO_ROOT` derives from `$0`. Add a `package-lock.json` at `$tmp/` and a stub `npm` on `PATH`.
  - Cases:
    1. stub exits 1 printing `npm ERR! code ECONNRESET` → script exits non-zero. This fails at 336bc94b, which exits 0 with "clean".
    2. stub exits 0 with no output → exit 0.
    3. stub prints `EBADPEER foo` and exits 0 → exit 1.
    4. No allowlist file exists in the repo today, so this case creates one in the temp tree (at the path the script reads). Stub prints only an allowlisted peer line and exits 1 → exit 0 (clean).
    5. stub prints an allowlisted peer line plus a non-allowlisted one and exits 1 → exit 1 (drift).
- Do not name `package-lock.json` in the same Bash call as writers (memory: the lockfile hook). Create fixtures with `printf` in a separate step.

**Constraints**
- Add `bash tests/ci/check-lockfile-peer-resolution.test.sh` to the quality.yml helper-test run list (near :899), plus the `bash -n` list near :762; both are required by the ci-registration-completeness check.
- Register its temp-dir `rm -rf` in `config/resource-lifecycle-callsites.json` (`temporary_artifact` / `cleanup`), then `git add` before running the checker (it skips untracked files).
- Update `scripts/ci/classify-quality-scope.sh:169` and its test (`tests/ci/classify-quality-scope.test.sh:249`) if the new test path needs routing.
- `tests/ci/check-workflow-composition.test.sh:4005-4013` orders strings in quality.yml. Keep the script invocation unchanged.

**Acceptance**
- An npm failure with no recognised peer output turns the gate red with an explicit "NOT verified" message.
- Real peer drift is still reported as before, and allowlisted-only peer output stays clean.

---

### Phase D3: Secret generation uses /dev/urandom correctly and never falls back to timestamps (P2, `setup-secrets--urandom-check-never-true`)

**Evidence**
- `scripts/setup.sh:355-373`: `generate_secret` and `generate_password` test `[ -f /dev/urandom ]`. A character device is never a regular file, so without openssl the code always reaches `echo "$(date +%s%N)$$" | sha256sum`.
- These generate JWT_SECRET, ENCRYPTION_KEY, GATEWAY_SECRET, and the DB, Redis and Grafana passwords (`:711-783`).
- `check_openssl` (:287) only warns.
- Also, the openssl branch is a pipeline without `pipefail` (`set -e` only, :44). If `openssl rand` fails, it yields an empty secret.
- `tests/install/unit/install-script.test.sh:238-245` tests a *copy* of the function, not setup.sh.

**Change**
- Rewrite both functions:
  - **openssl branch:** as today, then validate the length (≥ 32 for a secret; ≥ 16 for a password, because `tr -d '=/+'` trims about 0.7 characters on average from the 22-character base64 output, so ≥ 20 would spuriously reject). Otherwise fall through.
  - **else, if `[ -c /dev/urandom ] && [ -r /dev/urandom ]`:** capture without a pipeline, since the script has no `pipefail`: `out=$(od -An -N24 -tx1 /dev/urandom) || return 1`, then strip whitespace with `out=${out//[[:space:]]/}` (or `printf '%s' "$out" | tr -d ' \n'` on the already-captured value) and check the length is exactly 48 hex chars (192 bits) before printing it, else `return 1`. Passwords use `-N16` (32 hex chars, 128 bits).
    - `od -N` reads a bounded amount, so there is no SIGPIPE under `set -e`. The output is alphanumeric, matching existing consumers.
  - **else:** print `ERROR: no CSPRNG available (install openssl or provide /dev/urandom)` to stderr and `return 1`.
- Remove the `date | sha256sum` fallback entirely.
- Callers (nine sites). `setup.sh:741`, `:755` and `:776` are `X=$(openssl ... 2>/dev/null || generate_*)`; the substitution's status already aborts under `set -e`, so leave them. The six direct `X=$(generate_secret)` / `X=$(generate_password)` assignments are at `setup.sh:714`, `:722`, `:748`, `:762`, `:769` and `:783`. A plain assignment from a failing command substitution already aborts under `set -e`, so the new `return 1` aborts setup there; make it explicit anyway on those six with `X=$(generate_secret) || exit 1` so it survives any later refactor into a `local X=$(...)` (which would mask the status).
- **Decision:** the fallback password length changes from 24 to 32. Only the no-openssl path is affected; existing secrets are preserved.

**Test first**
- Add to `tests/install/unit/setup-upgrade-state.test.sh` (146 lines), using its `extract` helper:
  - **Fallback is random:** eval `extract generate_secret`, set `PATH` to a temp bin holding symlinks to `od tr head cat` and a stub `date` that prints a constant, with no `openssl`. Call it twice and assert the outputs differ and are ≥ 32 `[A-Za-z0-9]`.
    - At 336bc94b, both calls take the date fallback, return identical hashes, and the test fails.
  - **Hard fail:** a stub `od` that exits 1 makes `generate_secret` return non-zero with empty stdout (this is the pipefail case: with the old pipeline shape `tr` would have masked the failure).
  - **Password length:** with a stub `openssl` that prints a 22-char base64 string containing `=/+`, `generate_password` accepts it if ≥ 16 chars remain.
- Delete the stale duplicated function at `install-script.test.sh:238-245`. Point its four tests at the extracted real function, or delete them as superseded.

**Constraints**
- The install-test lanes trigger on `scripts/setup.sh` and `tests/install/**` changes. Expect them to run.
- If the new fixtures in `setup-upgrade-state.test.sh` add an `rm -rf` (temp bin cleanup), register it in `config/resource-lifecycle-callsites.json` (`temporary_artifact` / `cleanup`) and `git add` before running `node scripts/ownership/check-lifecycle-callsites.mjs` (the checker skips untracked files).

**Acceptance**
- Without openssl, secrets come from /dev/urandom.
- Without any CSPRNG, setup aborts.
- No timestamp-derived secret is reachable.

---

### Phase D4: Upgrade rewrite preserves operator-added env keys (P2, `install-upgrade--env-file-drops-operator-keys`)

**Evidence**
- `scripts/setup.sh:793-875`: `write_env_file` does `cat > "$ENV_FILE" << EOF` from a fixed template. It is called unconditionally (:1447).
- `load_or_generate_secrets` sources the old file (:683-687). Known keys survive through `${VAR:-default}`, but any key not in the template is dropped. Examples:
  - `PAYJOIN_PUBLIC_URL`, which `start.sh:581` and `docker/compose/tor.yml:27` tell operators to add;
  - `JWT_EXPIRES_IN`, `MCP_*`, `RATE_LIMIT_*`, `APNS_*`, `FCM_*`, `CLIENT_URL`.
- The template also hard-codes `GATEWAY_TLS_ENABLED=true` (:822), which overwrites an operator's `false`.

**Change**
- In `write_env_file`:
  1. Write the template to `tmp="$ENV_FILE.tmp.$$"` (same directory) instead of `$ENV_FILE`, created with mode 600 from the start: run the write in a subshell with `umask 077` (`( umask 077; cat > "$tmp" << EOF ... EOF )`), so secrets are never briefly world-readable.
  2. If `$ENV_FILE` exists, append a block `# OPERATOR SETTINGS (preserved by setup.sh across upgrades)` containing every line of the old file matching `^(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=` whose key is not already defined in `$tmp`.
     - Use one `awk` over both files: the first pass collects the template keys, the second emits old lines with other keys, verbatim and in their original order.
     - Key extraction strips a leading `export ` before comparing, so `export FOO=1` and `FOO=1` are the same key.
     - De-duplicate preserved keys: if the old file defines a key more than once, keep only the last definition (the one the shell would have used).
     - Multi-line quoted values are unsupported: a preserved line whose value opens a quote that is not closed on the same line is skipped, with a stderr warning naming the key. Document this in the section header comment.
     - Skip the existing preserved-section header, so repeated upgrades do not duplicate it.
  3. `mv -f "$tmp" "$ENV_FILE"`. This is atomic; keep an explicit `chmod 600 "$ENV_FILE"` after the move as today.
- Change `GATEWAY_TLS_ENABLED=true` to `GATEWAY_TLS_ENABLED=${GATEWAY_TLS_ENABLED:-true}`.
- On failure, remove `$tmp` inline (`... || { rm -f "$tmp"; return 1; }` around the write, awk and move). Do **not** add an EXIT trap: `setup.sh:1434` already sets `trap deployment_lock_release EXIT`, and a second trap would replace it.

**Test first**
- Add `env_file_preservation_contract` to `tests/install/unit/setup-upgrade-state.test.sh`:
  - pre-write `$ENV_FILE` with template keys, `PAYJOIN_PUBLIC_URL=http://x.onion`, `export RATE_LIMIT_MAX=500`, `GATEWAY_TLS_ENABLED=false`, a duplicated key (`MCP_PORT=1` then `MCP_PORT=2`), and an unterminated multi-line quoted value (`APNS_KEY="line1`);
  - the test runs under `set -euo pipefail`, so set **every** variable the template references (enumerate them with `grep -o '\${[A-Z_]*' scripts/setup.sh` over the `write_env_file` body), as `mode_contract` does; then `eval "$(extract write_env_file)"` and call it twice.
- Assert:
  - `PAYJOIN_PUBLIC_URL=http://x.onion` and `export RATE_LIMIT_MAX=500` appear exactly once;
  - `MCP_PORT=2` appears once and `MCP_PORT=1` not at all;
  - the `APNS_KEY` line is not preserved;
  - `GATEWAY_TLS_ENABLED=false`;
  - every template key appears once;
  - the mode is 600.
- At 336bc94b the PAYJOIN line is gone, so the test fails.

**Constraints**
- If the new `rm -f "$tmp"` in `scripts/setup.sh` is flagged by `scripts/ownership/check-lifecycle-callsites.mjs`, register it as `temporary_artifact`/`cleanup`.
- The `deployment_lock_release` EXIT trap (`setup.sh:1434`) must remain the only EXIT trap; a test asserts `trap -p EXIT` is unchanged after `write_env_file`.
- Docs: `docs/` install/upgrade reference and README "Environment Variables". State that unknown keys are preserved in the operator section.
- The install-test lanes will run.

**Acceptance**
- Repeated upgrades keep operator keys exactly once.
- Template keys stay authoritative only for keys the template owns.
- The write is atomic.

---

### Phase D5: macOS host scripts (bash 3.2 / BSD sed) (P2, `deploy-scripts--macos-bash32-and-bsd-sed`)

**Evidence**
- `scripts/ownership/deployment-lifecycle.sh:34,90` use `mapfile -d '' -t` (bash ≥ 4.4).
- `scripts/ownership/producer-hooks.sh:11` uses `${1,,}` (bash ≥ 4). It is sourced by `start.sh:23` and `scripts/setup.sh:49`.
- `start.sh`, `scripts/setup.sh` and `install.sh` start with `#!/bin/bash`, which is 3.2 on macOS even when Homebrew bash is installed.
- `install.sh:931` execs `"$INSTALL_DIR/scripts/setup.sh"` via its shebang.
- `start.sh:84` (`persist_runtime_env_value`) uses GNU `sed -i` without a suffix. It also breaks on values containing `|` or `&`.
- README documents macOS installation (`README.md:79`, section at ~:506) and `curl … | bash` (:116).

**Change (Decision: require bash ≥ 4.4 explicitly + fix sed; do not attempt a full 3.2 port)**
- The bash-4 surface spans sourced libraries (`producer-hooks.sh`, `provider-context.sh`, `deployment-lifecycle.sh`) that cannot be tested under 3.2 in CI. A partial port would regress silently, so require bash ≥ 4.4 instead:
  - Change the shebangs of `start.sh`, `scripts/setup.sh` and `install.sh` to `#!/usr/bin/env bash`, so Homebrew bash on PATH is used.
  - Add an identical guard as the first executable lines of each:
    `if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then echo "Sanctuary requires bash 4.4+ (found ${BASH_VERSION:-unknown}). On macOS: brew install bash, then re-run." >&2; exit 1; fi`
  - Put the same guard at the top of the two sourced libraries that carry the bash-4 constructs, `scripts/ownership/producer-hooks.sh` and `scripts/ownership/deployment-lifecycle.sh`. That covers every other entry point that sources them (`uninstall.sh` → `producer-hooks.sh`; `scripts/reconcile-postgres-password.sh` → `deployment-lifecycle.sh`; `scripts/ops/run-grafana-password-migration.sh` → both) without a per-script list. Also switch those three scripts' shebangs to `#!/usr/bin/env bash`.
  - `install.sh:931` runs `"$INSTALL_DIR/scripts/setup.sh"` by shebang; run it as `"${BASH:-bash}" "$INSTALL_DIR/scripts/setup.sh"` so a Homebrew-bash invocation carries through to setup.
- Replace `start.sh:84` `sed -i` with a portable rewrite that passes key and value through the environment, not `-v` (awk `-v` interprets backslash escapes): `K="$key" V="$value" awk 'BEGIN{FS=OFS="="} $1==ENVIRON["K"]{print ENVIRON["K"]"="ENVIRON["V"]; next} {print}' "$ENV_FILE" > "$ENV_FILE.tmp.$$" && chmod 600 … && mv -f …`. This also fixes values containing `|`, `&` or `\`.
- `tests/install/unit/install-script.test.sh:485-488` `test_install_script_has_shebang` asserts the first line is `#!/bin/bash`; update it to `#!/usr/bin/env bash`.
- In README's macOS section, add step "Install bash 4.4+: `brew install bash`". In Quick Install, add the note `curl … | "$(brew --prefix)/bin/bash"` for macOS.

**Test first**
- Create `tests/install/unit/host-shell-portability.test.sh`.
  1. For each of `start.sh scripts/setup.sh install.sh`: assert the shebang is `#!/usr/bin/env bash` and the guard text is present before the first `source`/`.` line. For `scripts/ownership/producer-hooks.sh` and `scripts/ownership/deployment-lifecycle.sh`: assert the guard is the first executable statement. For `uninstall.sh`, `scripts/reconcile-postgres-password.sh` and `scripts/ops/run-grafana-password-migration.sh`: assert the `#!/usr/bin/env bash` shebang. Assert `install.sh` invokes setup through `"${BASH:-bash}"`. This fails at 336bc94b.
  2. Run the guard snippet (extracted with awk) under a fake `BASH_VERSINFO`. In a child, `bash -c` with the snippet text where `BASH_VERSINFO` is replaced by a test array, since `BASH_VERSINFO` is readonly. Assert 3.2 → exit 1 with "requires bash 4.4" and 5.2 → exit 0.
  3. `grep -nE "sed -i( |$)"` over `start.sh install.sh uninstall.sh scripts/*.sh scripts/ownership/*.sh scripts/ops/*.sh` must find nothing. This fails at 336bc94b on `start.sh:84`.
  4. Behavioural: extract `persist_runtime_env_value` and run it on fixtures with `KEY=a|b&c` and `KEY=a\b`. Assert an exact, byte-identical replacement and a single occurrence.
- Update `test_install_script_has_shebang` (`tests/install/unit/install-script.test.sh:485-488`) to expect `#!/usr/bin/env bash`; it fails after the shebang change otherwise.
- Register the file in `tests/install/run-all-tests.sh` (next to :187). Check that `tests/install/unit/install-unit-suite-runner.test.sh` does not require a fixed list.

**Constraints**
- The install-test lanes trigger.
- Register any new test `rm -rf` cleanup in `config/resource-lifecycle-callsites.json`.
- Docs: README macOS section and Quick Install.

**Acceptance**
- macOS with system bash fails fast with an actionable message instead of mid-setup, from every entry point that sources the ownership libraries.
- `start.sh` env persistence works with BSD sed absent.
- The static guard prevents `sed -i` from returning.

---

### Phase D6: Demo reset and seed only touch demo-marked users and groups (P2, `demo-reset--deletes-users-groups-by-name`)

**Evidence**
- In `scripts/demo/lib/seed.mjs:229-235`, `reset` deletes every `/admin/groups` entry whose `name` is in the manifest and every `/admin/users` entry whose `username` is in it. A real `alice`/`bob` or a group named `Family` is deleted.
- `ensureUsers` (:10-20) and `ensureGroups` (:22-34) likewise adopt same-named real entities. Seed would then share demo wallets to a real `alice`.
- Available markers:
  - manifest users have `@demo.invalid` emails (`scripts/demo/manifest.json`), and `/admin/users` returns `email` (`server/src/api/admin/users.ts:48`);
  - groups are created with `purpose: 'demo'` and a fixed description, and `/admin/groups` returns both (`server/src/services/adminGroupService.ts:133-147`).
- The demo login already uses the same `.invalid` marker (`scripts/demo/lib/container.mjs:12`).

**Change**
- Add `isDemoUser(u, spec)`: `u.username === spec.username && u.email === spec.email` (the manifest `@demo.invalid`).
- Add `isDemoGroup(g, spec)`: `g.name === spec.name && g.purpose === 'demo'`. Do not compare `description`: it is free text that an operator may edit, and coupling the marker to it would make reset skip (and seed refuse) the instance's own demo groups.
- `reset`: filter with these predicates. For a same-name entity without the marker, log `kept <user|group> <name>: not created by the demo (marker mismatch)` and do not delete it.
- `ensureUsers`/`ensureGroups`: if a same-name entity exists without the marker, throw `Error('demo seed refused: existing user "alice" is not a demo user; rename it or use a fresh instance')`. This fails closed rather than adopting it.
- Pre-validate before any write: today `ensureUsers`/`ensureGroups` create in manifest order, so a conflict on a later entry would throw after earlier POSTs and leave a half-seeded state. Check **all** manifest users and groups for marker conflicts first (one `/admin/users` and one `/admin/groups` read), and only then write anything. `seed()` PATCHes `/auth/me/preferences` (`seed.mjs:162`) before `ensureUsers`, so move the marker pre-validation ahead of that PATCH too.
- Update the `reset` doc comment (:191-196).

**Test first**
- `tests/scripts/demoReset.test.ts`: extend `fakeApi` with
  - `/admin/users` returning `[{id:'u1', username:'alice', email:'alice@real.example'}, {id:'u2', username:'bob', email:'bob@demo.invalid'}]`;
  - `/admin/groups` returning `[{id:'g1', name:'Family', purpose:null, description:'Our family'}]`.
- Use a manifest with the real users and groups specs. Expect `deleted` to contain `/admin/users/u2` but not `/admin/users/u1` or `/admin/groups/g1`.
- At 336bc94b all three are deleted, so the test fails.
- Add a seed test (same file or `tests/scripts/demoSeed.test.ts`): `seed` with a non-marked `alice` rejects with "not a demo user" and posts nothing to `/wallets/import` or the share endpoints. Add a conflict on a **later** manifest entry (e.g. a non-marked group, or the last user): seed rejects and makes **no** write at all: no POST (no earlier user or group was created) and no `PATCH /auth/me/preferences`.

**Constraints**
- None beyond frontend vitest (tests/scripts runs in the frontend lane).
- Memory: the local stack is also the demo instance. The seeded demo users carry the marker, so the existing demo keeps working. Verify against `scripts/demo/manifest.json` emails and the group `purpose` (`'demo'`).

**Acceptance**
- `demo:reset` never deletes, and `demo:seed` never adopts, an entity lacking the demo marker.

---

### Phase D7: `create-bundle --skip-build` verifies image revision equals the tag commit (P2, `offline-bundle--skip-build-images-unverified`)

**Evidence**
- `scripts/offline/create-bundle.sh:149-154`: `build_sanctuary_images` returns immediately on `--skip-build`.
- `save_images` (:259-308) and `write_image_inventory` (:311+) check only the Id, OS, architecture, alias and digest. Nothing compares the image's `org.opencontainers.image.revision` label to the tag commit.
- The label is stamped by every Sanctuary Dockerfile from `SANCTUARY_SOURCE_COMMIT`: server :107 (the migration stage inherits `runtime-base`), frontend :66, gateway :83, llm-egress-proxy :43, grafana-migration :16.
- `validate_release_checkout` (:132) checks only the checkout.
- `main` (:655-690) signs the result.
- Memory: the release flow rebuilds bundles per tag with `--skip-build`.

**Change**
- Add `verify_sanctuary_image_revisions "$commit"`, called in `main` right after `build_sanctuary_images` (so on both paths).
- For each image from `bundle_images` matching `sanctuary-*`, read `rev="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"`.
  - If `[ "$rev" != "$commit" ]`: `offline_fail "image $image was built from ${rev:-<unlabelled>}, not $TAG ($commit); rebuild or drop --skip-build"`.
- **Decision:** with `--unsigned-for-dev` (`UNSIGNED_FOR_DEV=true`), downgrade to a warning, since dev bundles are not release artifacts. Signed bundles always fail closed.
- Do **not** record the verified revision in any inventory file. `image-inventory.tsv` is strict: `apply-bundle.sh:214-219` pins header lines 1-2 and requires exactly 6 fields, and `scripts/release/prepare-release-assets.mjs:180-197` compares the whole file. `image-inventory.json` is also validated (`validInventoryImage` / `validateBundleInventory`). The check is a build-time gate only; the bundle's existing embedded `gitCommit` already records the source commit.

**Test first**
- In `tests/install/unit/offline-bundle-script.test.sh` (shell; not subject to the js/ts large-file gate), extend the fake docker's `image inspect` branch (:226-247), which routes by `--format` substring:
  - add an explicit `*'image.revision'*)` case **above** the default case of that `case` statement, printing `${SANCTUARY_FAKE_IMAGE_REVISION:-}`; otherwise the default branch would answer the revision query.
- Add `test_create_bundle_skip_build_rejects_stale_revision`, cloned from `test_create_bundle_signs_outer_archive` (:856):
  - with `SANCTUARY_FAKE_IMAGE_REVISION=0000…`, `--skip-build` must exit non-zero with "not v9.9.9";
  - with `SANCTUARY_FAKE_IMAGE_REVISION="$(git -C "$release_repo" rev-parse v9.9.9)"`, it succeeds.
  - At 336bc94b the stale case signs successfully, so the test fails.
- Set `SANCTUARY_FAKE_IMAGE_REVISION` to the tag commit in every existing create-bundle test that reaches the new check, so they keep passing. The callers of `run_create_bundle` at 336bc94b are: `test_create_bundle_signs_outer_archive`, `test_create_bundle_tags_digest_refs_and_saves_runtime_refs`, `test_create_bundle_unsigned_core_dev_archive_shape`, `test_create_full_bundle_builds_and_saves_migration_without_pull`, `test_create_bundle_rejects_runtime_tag_for_different_image_id`, `test_create_bundle_rejects_unexpected_archive_repo_tag`, `test_create_tag_failure_precedes_ambiguous_alias_verification`, `test_create_tag_response_loss_proves_alias_and_preserves_failure`, `test_fresh_bootstrap_ignores_unrelated_database_volume` and `test_upgrade_bootstrap_resolves_current_and_legacy_project_names`. Simplest: export `SANCTUARY_FAKE_IMAGE_REVISION` (tag commit) inside `run_create_bundle` itself unless the caller already set it, so every caller passes and only the new stale-revision test overrides it. The `rejects_*` / failure tests must still fail for their original reason, not the revision check.

**Constraints**
- `scripts/release/prepare-release-assets.mjs:137` calls `create-bundle.sh` without `--skip-build` and inherits the check.
- The `--bundle` copy path validates the embedded `gitCommit` only, and the bundle it copies was made by the fixed script.
- Docs: `docs/reference/release-distribution.md`, the offline-bundle section. State that `--skip-build` requires images labelled with the tag commit.
- The install-test lanes trigger.
- Lifecycle registry: the test file is already registered (`config/resource-lifecycle-callsites.json:2462`).
- Pre-merge check: on the release host, `docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'` each current `sanctuary-*:local` image and confirm it equals the commit of the RC it was built for. Record the result in the PR; if any image is unlabelled or mismatched, rebuild it before the next release so the next `--skip-build` run does not fail closed unexpectedly.

**Acceptance**
- A signed bundle can no longer contain Sanctuary images from a different commit.
- The fresh-build path passes unchanged.

---

### Files touched (Groups C and D)

**Group C**
- `tests/components/WalletDetail/tabs/TransactionFilterBar.test.tsx`
- `src/components/WalletDetail/WalletDetailLoadedView.tsx`
- `src/components/WalletDetail/tabs/StatsTab.tsx`
- `src/components/WalletStats.tsx`
- `src/components/WalletStats/walletStatsData.ts`
- `src/hooks/queries/useWallets.ts` (new hook + `walletActivityKeys.walletActivityHistory` factory entry)
- `tests/components/WalletStats.test.tsx`
- `tests/hooks/queries/useWallets.test.tsx` (hook + `walletActivityKeys` case)
- `src/hooks/websocket/useWebSocketQueryInvalidation.ts` and its test (C2 `walletActivityHistory.all` invalidation)
- `src/hooks/send/useBroadcast.ts` and its test (C2 `walletActivityHistory.all` invalidation in `refetchBroadcastCaches`; `tests/hooks/useBroadcast.test.tsx:310` count → 2)
- `tests/hooks/useSendTransactionActions/useSendTransactionActions.signing.contracts.tsx` (C2: `invalidateQueries` count at :212 → 2; also touched by A7 in PR A)
- `tests/components/WalletDetail/tabs/StatsTab.test.tsx`
- `tests/components/WalletDetail/WalletDetailLoadedView*` (the `buildStatsTabProps` consumer tests)
- (new) `tests/components/WalletStats/walletStatsData.test.ts`
- e2e balance-history mocks for wallets reporting `hasMoreTx` (only if a mock response is not a valid point array)
- `src/components/WalletDetail/tabs/TransactionsTab.tsx`
- `src/components/WalletDetail/tabs/TransactionsTab/AiFilterSummary.tsx`
- `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx`
- `server/src/api/admin/proxyTest.ts`
- `server/src/api/openapi/paths/admin/core.ts`
- `server/tests/unit/api/adminNodeConfig/adminNodeConfig.proxy.contracts.ts`
- `server/tests/unit/api/adminNodeConfig/adminNodeConfigTestHarness.ts` (encryption mock gains `decryptIfEncrypted`)
- `tests/components/NodeConfig.interactions.test.tsx`
- C6: `server/src/services/bitcoin/electrumPool/poolConfig.ts`, `server/src/services/bitcoin/electrum/connectionConfigResolver.ts`, `server/src/services/bitcoin/electrumPool/nodeConfigMapper.ts` (dead `getProxyConfig` removed), new decrypted-projection helper plus the exported `ProxyConfigurationError` (e.g. `server/src/services/bitcoin/electrum/proxyCredentials.ts`) and its test
- C6 tests: `server/tests/unit/services/bitcoin/electrumPool/poolConfig.test.ts`, `server/tests/unit/services/bitcoin/electrum/connectionConfigResolver.test.ts` (new), `server/tests/unit/services/bitcoin/electrumPoolConnections/module-level-pool-helpers.contracts.ts` (remove the dead-helper case)
- `tests/e2e/admin-operations.spec.ts`
- `tests/e2e/settings-persistence.spec.ts`
- `tests/e2e/error-recovery.spec.ts`
- `tests/e2e/wallet-sharing-privacy.spec.ts`

**Group D**
- `scripts/ci/classify-files-lib.sh`
- `tests/ci/classify-test-changes.test.sh`
- `tests/ci/plan-test-run.test.sh`
- `scripts/quality/check-lockfile-peer-resolution.sh`
- (new) `tests/ci/check-lockfile-peer-resolution.test.sh`
- `.github/workflows/quality.yml`
- `scripts/ci/classify-quality-scope.sh` (if routing is needed)
- `tests/ci/classify-quality-scope.test.sh` (if routing is needed)
- `scripts/setup.sh`
- `tests/install/unit/setup-upgrade-state.test.sh`
- `tests/install/unit/install-script.test.sh` (D3 stale copy; D5 `test_install_script_has_shebang`)
- `start.sh`
- `install.sh`
- `uninstall.sh` (shebang)
- `scripts/reconcile-postgres-password.sh` (shebang)
- `scripts/ops/run-grafana-password-migration.sh` (shebang)
- `scripts/ownership/producer-hooks.sh` (bash ≥ 4.4 guard)
- `scripts/ownership/deployment-lifecycle.sh` (bash ≥ 4.4 guard)
- (new) `tests/install/unit/host-shell-portability.test.sh`
- `tests/install/run-all-tests.sh`
- `README.md`
- `scripts/demo/lib/seed.mjs`
- `tests/scripts/demoReset.test.ts`
- (optional new) `tests/scripts/demoSeed.test.ts`
- `scripts/offline/create-bundle.sh`
- `tests/install/unit/offline-bundle-script.test.sh`
- `scripts/release/prepare-release-assets.mjs` and `scripts/offline/apply-bundle.sh` (read-only dependencies: inventory format is not changed)
- `docs/reference/release-distribution.md`
- install/upgrade docs for D4
- `config/resource-lifecycle-callsites.json` (new test-fixture and tmp cleanup registrations)


## Verification (every PR)

Guarded entry points only (Docker-only rule; never `npm run dev`/vite on the host). In the
implementation worktree after `npm ci` (nvm node 24.21.0 / npm 12), one coverage run at a time:

- Focused: every new/changed test for the PR's phases, confirmed failing on `336bc94b` first.
- `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`
- `cd server && npm run typecheck:tests && npx vitest run --coverage tests/unit` (100%)
- `npm run test:coverage` (frontend, 100%) when `src/` or `tests/` frontend files change
- `cd server && npm run test:integration:db -- <touched integration specs>`
- gateway / llm-egress-proxy package tests and typechecks when those packages change
- `bash scripts/quality/lizard-only.sh`, `bash scripts/quality/jscpd-only.sh`,
  `node scripts/quality/check-large-files.mjs` (after `git add` of new files)
- `node scripts/check-wallet-sync-mutation-boundaries.mjs`, `node scripts/check-safety-catch-guards.mjs`
- `node scripts/ownership/check-lifecycle-callsites.mjs` (lifecycle callsite checker; `git add` new files first,
  it skips untracked files)
- PR A: the mutation profile runs and map test listed in the Group A gating facts
- PR D: `tests/ci/*.test.sh` suites named in its phases; `tests/install/unit` suites
- Frontend e2e-affecting changes (C2: Stats tab, `wallet-sharing-privacy.spec.ts:690` asserts
  `unhandledRequests` is empty; C5): build `dist/`, serve statically, throwaway Playwright
  config with no `webServer` (CLAUDE.md)
- `npm run arch:check` in the primary checkout against the branch tree for every PR (import edges, and the
  call graphs in `docs/architecture/generated/calls/*` embed line links for every file listed in
  `docs/architecture/calls.config.json`); commit any regenerated `docs/architecture/generated/**` files
- `/simplify` and the edge-case audit before committing each PR.

## Delivery, rollback, deployment

- Four PRs, serial: rebase only the next PR to merge, wait for green, merge (squash, no admin
  bypass, `delete_branch_after_merge: false`), verify `merge_commit_sha` ancestry, then the next.
- Hold finished PR B/C/D branches locally (not pushed) until the previous PR has merged
  (CLAUDE.md serial-merge rule); pushing into a draining queue only burns CI runs.
- Each phase is an independent commit and independently revertible; no data migration. B3's
  snapshot row (`operational.wallet-resync-annotations.v1:<walletId>`) is additive and ignored
  by older code.
- Behaviour changes users can see: B2 refuses some admin deletes (409 listing wallets);
  A5 rejects `unknownAddressesOnly`-only approval policies on save (already stored ones evaluate
  unchanged and only log a warning); A8 best-effort deletes a previously adopted draft (releasing
  its UTXO locks) when a failed or stale adoption is followed by a transaction edit; A9 ignores a
  camera re-scan of the same just-rejected PSBT, including after a transient submit failure, until
  the QR modal is closed and reopened (file re-upload is unaffected); A4 returns BIP78
  `unavailable` instead of an invalid proposal; C3 labels partial AI results; D3 fails setup
  when no CSPRNG exists; D5 requires bash ≥ 4.4 on macOS.
- No container rebuild here (`--deploy final`).

## Completion criteria

- [ ] PR A merged; target-branch CI green on its merge commit.
- [ ] PR B merged; target-branch CI green.
- [ ] PR C merged; target-branch CI green.
- [ ] PR D merged; target-branch CI green.
- [ ] Every phase's regression test failed on `336bc94b` and passes on its merge; gated phases
      that did not fail are recorded `rejected` with evidence.
- [ ] Owned branches/worktrees cleaned; run state updated.
- [ ] P3 backlog remains outside the blocking fix set.
