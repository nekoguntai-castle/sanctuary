# Bug-scrub loop 20261013 — iteration 22 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 22
- **Source SHA:** `bd215520df0cee8ba72903f0d0b4281072fe7676` (`main`, after #1424)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (2 × P2):**
  - A1 `cpfp--large-parent-child-rate-exceeds-intent-fee-cap`
  - C1 `ci-classifier--browser-e2e-group-guard-not-triggered-by-new-specs`

  Both findings were re-verified from source at `bd215520df0c` (file:line in each phase), and both fixes were
  prototyped test-first on a scratch copy of that tree.
- **Deferred P3s:** every other iteration-22 finding (10 new P3s, among them `send-review-upload--hex-psbt-treated-as-base64`
  and `console-gateway--provider-error-body-returned-to-non-admin-users`, plus re-confirmed backlog rows such as
  `check-shared-deps-orphaned-not-wired-into-any-gate`) is backlog in run state and is **outside this fix set**.
- **Scratchpad (`$SCRATCH`):** `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`.
  - Prototype diffs: `plan22-{A1,C1}-prototype.patch`; together `plan22-all.patch` applies cleanly on `bd215520df0c`
    (18 files, +710/−45). Prototype worktrees: `$SCRATCH/p22-a1`, `$SCRATCH/p22-c1` (HEAD = prototype, HEAD~1 = base).
  - Plan deltas prototyped while drafting: `plan22-A1-frontend-prototype.patch` (send wizard gate, 2 files),
    `plan22-A1-mutation-map-delta.patch` (a unified `git diff` with headers, relative to the `plan22-all.patch` tree:
    the fee-policy Stryker profile and mutation-map entries for `cpfpParent.ts`, second canary already moved to the
    review-pass-1 code; `git apply --check` passes on `$SCRATCH/p22-a1`).
  - Review pass 1 delta: `plan22-A1-r1-prototype.patch` (12 files, applies with `git apply` on `$SCRATCH/p22-a1`; worked
    in the copy `$SCRATCH/p22-a1r1`): confirmed-parent refusal at build and at broadcast, the 10,000 sat/vB child cap,
    per-branch authorization errors, and their tests. Red run on base: `p22-a1-r1-red.txt`.
  - Review pass 2 delta: `plan22-A1-r2-prototype.patch` (8 files, +229/−38; a `git diff` against the pass-1 state, so it
    applies after `plan22-A1-prototype.patch` and `plan22-A1-r1-prototype.patch`; worked in the fresh worktree
    `$SCRATCH/p22-a1r2`, removed afterwards): the shared parent-confirmed helper with its 20 s deadline and wallet-row
    first lookup, the reconciliation withhold, `markBroadcastWithheld`, and their tests. Red runs: `p22-a1-r2-red.txt`
    (base source, final tests) and `p22-a1-r2-red-on-r1.txt` (pass-1 source, the files pass 2 touches). The A1, pass-1,
    pass-2 and map-delta patches apply in that order on a fresh `f4d746f` (= `bd215520df0c`) tree.
  - Review pass 4 delta: `plan22-A1-r4-prototype.patch` (5 files, +107/−21; a `git diff` against the state after all six
    earlier patches — A1, pass 1, pass 2, map delta, frontend, C1, applied in that order — worked in the fresh worktree
    `$SCRATCH/p22-r4`, removed afterwards): the node-limit check at the child's smallest signed vsize
    (`minimumSignedVsize`), the map's `lineEnd` re-pin, and their tests. Red run: `p22-a1-r4-red.txt` (base source,
    final tests, eight files).
  - Review pass 5 delta: `plan22-A1-r5-prototype.patch` (6 files, +137/−33; a `git diff` against the state after all seven
    earlier patches — A1, pass 1, pass 2, map delta, frontend, C1, pass 4, applied in that order — worked in the fresh
    worktree `$SCRATCH/p22-r5`, removed afterwards; all eight patches apply in that order on a fresh `f4d746f` tree): the
    child bound moves below bitcoinjs-lib's finalizer limit (`CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT`, R5-1) and its
    tests. Red runs: `p22-a1-r5-red.txt` (base source, final tests, eight files) and `p22-a1-r5-red-on-r4.txt` (pass-4
    source, the four test files pass 5 touches).
  - Red-run outputs: `p22-a1-red.txt` (superseded by `p22-a1-r1-red.txt`, itself superseded by `p22-a1-r2-red.txt`, then
    by `p22-a1-r4-red.txt`, then by `p22-a1-r5-red.txt`), `p22-a1-fe-red.txt`, `p22-c1-red.txt`. Stryker evidence:
    `p22-stryker-fee-policy.log`, `p22-fee-policy-report.json`, `p22-stryker-taproot-af.log` (run in `$SCRATCH/p22-stry`,
    the A1 prototype plus the map delta, before review pass 1; the pass-1 code changes `cpfpParent.ts`, so the
    implementer re-runs the profile, Verification step 2).
  - A prototype is guidance; where the two differ, the phase text below governs. The plan adds four files the
    prototypes do not touch (A1: `server/stryker.fee-policy.config.mjs`, `src/contexts/send/stepValidation.ts`,
    `tests/contexts/stepValidation.test.ts`; plus the changelog), extends the prototype's mutation-map edit, and adds
    boundary tests to `cpfpParent.test.ts`, as Phase A1 states.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `cpfp--large-parent-child-rate-exceeds-intent-fee-cap` | P2 |
| C1 | `ci-classifier--browser-e2e-group-guard-not-triggered-by-new-specs` | P2 |

## Open questions

These are decided; none blocks the plan.

- **OQ-A1 (coordinator).** Cap the CPFP *package* target at 1000 sat/vB and let the child's own rate exceed it only
  when the parent's size is bounded from authenticated data. The four trade-offs are accepted:
  1. `parentFeeRate` in the `POST /api/v1/bitcoin/transaction/cpfp` response is computed over the bounded parent
     vsize (`min(served, bound)`), not the served one. For an honest parent the two agree.
  2. Input types with no known witness bound (Taproot script path, nested Taproot, unknown witness versions, P2WSH
     scripts that are not multisig) keep the 1000 sat/vB child cap and fail with an explicit error naming it.
  3. The parent's witness is not authenticated (the txid does not commit to it). A server that serves a *smaller*
     witness than the real one can only make the bounded vsize smaller, so the child underpays the target (the package
     confirms later); it can never make the child pay more than the authenticated maximum.
  4. Backlog P3 `cpfp-rbf--witness-padding-inflates-vsize` is partly fixed by the bound (CPFP over bounded input types).
     The RBF half is unchanged. After the merge, record this in run state as a note on that row; the row stays
     `backlog`, not `resolved`.

  Review pass 1 added two coordinator decisions:
  5. **The child's own fee stays below 5000 sat/vB of its smallest signed size** (review pass 5, R5-1, coordinator
     decision option (a); pass 1 capped it at 10,000 sat/vB and pass 4 measured that on the smallest signed size).
     - Pass 1's limit was Bitcoin Core's default `sendrawtransaction` `maxfeerate` (0.1 BTC/kvB, 10,000 sat/vB).
       Sanctuary broadcasts only through Electrum's `blockchain.transaction.broadcast` with the raw hex
       (`server/src/services/bitcoin/electrum/methods.ts:283-288`); ElectrumX, Fulcrum and electrs relay it to bitcoind
       with that default. That limit still holds, but it is not the one that binds.
     - **The binding limit is bitcoinjs-lib's (R5-1).** `finalizePsbt` calls `candidate.extractTransaction()` with no
       `disableFeeCheck` (`signingIntent/artifactValidation.ts:470`, on a `bitcoin.Psbt.fromBase64` with default options,
       `:97`), and so does the Trezor adapter (`src/services/hardwareWallet/adapters/trezor/signPsbtValidation.ts:142`).
       bitcoinjs-lib 7.0.2 defaults `maximumFeeRate: 5000` (`psbt.cjs:81`); `checkFees` (`:1092-1104`) throws when
       `feeRate >= 5000`, with `feeRate = floor(fee / vsize)` of the extracted signed transaction (`:1703`, a BigInt
       division). The catch at `:471-475` turns that into 400 "Signed PSBT is not finalizable" (`not_finalizable`). So
       every child between 5000 and 10,000 sat/vB of its signed size was authorized, signed on a hardware device and
       then refused at finalize: the wasted signing round this item exists to prevent. Reproduced by the pass-5
       reviewer (fee 600,000 on a 1-in-1-out P2WPKH child refused, 400,000 accepted) and by the pass-5 test below.
     - **Decision: authorize only `childFee < CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT · C_min`** (strict;
       `CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT = 5000`, a separate named constant in `signingIntent/types.ts`).
       The arithmetic: the fee is a whole number of sats, C_min ≤ v for every actual signed vsize v (below), so
       `fee ≤ 5000 · C_min − 1 ≤ 5000 · v − 1`, hence `fee / v < 5000` and `floor(fee / v) ≤ 4999 < 5000`: no signed
       size can trip the check. The integer condition is `childFee ≤ 5000 · C_min − 1`, i.e. the code refuses
       `childFee >= CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT * child.minimumSignedVsize`. With `<=` the fee
       `5000 · C_min` would be authorized, and a child signed at exactly C_min would have `floor = 5000` and be refused.
       bitcoind's sigop-adjusted vsize is never below the plain vsize, so its 10,000 sat/vB check is far from binding.
       For the P2WPKH child (C = 110, C_min = 94) the largest authorized fee is 469,999 sats (4272.72 sat/vB of C).
     - **Why not option (b)** (`extractTransaction(true)` in `finalizePsbt` and the Trezor adapter): both call sites
       are pinned surfaces. `artifactValidation.ts:470` is inside the taproot-artifact-finalization Stryker `mutate`
       range 466-470 (`server/stryker.taproot-artifact-finalization.config.mjs:15`) whose map invariants D-22.X3 keeps
       byte-identical, and `signPsbtValidation.ts` is listed in `config/hardware-wallet-implementation-inventory.json`,
       which D-22.X3 leaves untouched; (b) would widen the pinned-surface set and the 33-file scope. It would also
       remove bitcoinjs-lib's fee check as an independent backstop: today a fee-policy bug that let a large fee
       through would still be stopped at finalize, on the server and on the Trezor path, by code Sanctuary does not
       own. Option (a) keeps that backstop and costs only rescue range (the table below).
     - **`SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE` is lowered to match** (`= CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT`, 5000).
       The stored policy's rate is over C ≥ C_min, so an authorized child's policy rate is
       `exactFeeRateNotAbove(childFee, C) ≤ childFee / C < 5000`; the builder can never produce 5000 or more. A
       10,000 ceiling would admit, at prepare, in the schema and at finalize, policy rates in [5000, 10,000] that no
       finalizable child can carry, so it would bound nothing real. At 5000 the ceiling is tight: `maximumFeeRate =
       min(packageCeiling, 5000)`, the schema `.max(5000)`, the `feePolicy.ts` bound range [1000, 5000], and the
       per-source finalize check. It stays a separate constant from the finalizer limit because the two mean different
       things (an inclusive stored-policy ceiling over C; a strict library threshold over the actual signed size), and
       its doc comment says why they are equal.
     - **The node checks the signed child, not the estimate (review pass 4, R4-1).** The same holds for bitcoinjs-lib,
       which divides by the extracted signed transaction's vsize. bitcoind refuses when
       `fee > maxfeerate · GetVirtualTransactionSize(tx)` of the real signed transaction (sigop-adjusted, never smaller
       than the plain vsize). `C = estimateTransactionWeight(...).vsize` is the *maximum* signed size: it reserves a
       73-byte ECDSA signature (`transactionWeight.ts:51`, used at `:207`, `:215`, `:231`, `:240`) and a 65-byte Schnorr one
       (`:249`). A real signature is shorter: ECDSA with its sighash byte is 9 to 73 bytes (Bitcoin Core's
       `IsValidSignatureEncoding` refuses `< 9` and `> 73`); a low-S signature is at most 72, about half are 71, and
       about 1 in 128 is 70 or shorter (a 31-byte `s` or `r`), so a 71-byte floor is not a bound. A BIP 340 signature
       is exactly 64 bytes (65 with an explicit sighash byte). So the signed child can be smaller than C, and a child
       authorized at `exactFeeRateNotAbove(childFee, C) ≤ 10,000` could still be refused.
     - **Decision (R4-1, kept by R5-1 with the 5000 limit): the check uses the provable minimum.** `C_min =
       minimumSignedVsize(spendPolicy, W) = ceil((W − slack) / 4)`, where W is the estimate's maximum signed weight and
       the slack is every required signature at its shortest valid encoding: ECDSA 73 − 9 = 64 bytes, Schnorr
       65 − 64 = 1 byte. Legacy scriptSig bytes weigh 4, witness bytes 1. The CPFP child always has one input, the
       wallet's output of the parent (`cpfp.ts`, `addInputsWithBip32` with one input; `resolveTransactionSpendPolicy`
       gives its policy), so the slack weight is: P2PKH 4 · 64 = 256; P2WPKH and P2SH-P2WPKH 64; Taproot key path 1;
       P2WSH and P2SH-P2WSH sortedmulti m · 64 (m signatures). Each push stays one byte (≤ 75), and the scriptSig
       length prefix stays one byte (108 → 44), so no other byte changes. Integer math, exact: both sides are whole
       sats, and `ceil` gives the true minimum vsize (bitcoinjs-lib's `virtualSize()` is `ceil(weight / 4)` too), so
       no extra rounding margin is needed.
     - The weight module has no minimum-size variant, so the helper lives in `cpfpParent.ts` beside its existing
       `MAX_ECDSA_SIGNATURE_BYTES` / `MAX_SCHNORR_SIGNATURE_BYTES`. `transactionWeight.ts` is not edited: it has its own
       fee-policy invariants in the map (file gate at base `config/wallet-safety-mutation-map.json:931`, invariants at `:965`, `:988`).
     - Values for a 1-in-1-out child to a P2WPKH output (max weight W → C / C_min vB): P2WPKH 439 → 110 / 94;
       P2PKH 760 → 190 / 126; P2SH-P2WPKH 531 → 133 / 117; Taproot key path 397 → 100 / 99; 2-of-3 P2WSH 586 →
       147 / 115; 2-of-3 P2SH-P2WSH 726 → 182 / 150.
     - Why the provable floor and not the reviewer's "71–73 bytes": a 70-byte signature is common enough (≈ 1 in 128)
       to hit the window. A node or finalizer refusal fails closed (no funds move), but it wastes a hardware signing
       round, which is the exact outcome item 5 exists to prevent. The cost is a smaller rescue range (≈ −15% for
       P2WPKH against a bound on C); legacy and multisig children lose more, and a lower target still works for them.
     - The stored-policy ceiling is 5000 sat/vB of C (`maximumFeeRate = min(packageCeiling, 5000)`, the schema `.max`,
       finalize): the exact-fee check binds the absolute fee, and that fee is now at most 5000 · C_min − 1.

     The per-package ceiling for a bounded parent is `min(5000, exactFeeRateNotAbove(1000 · (P + C), C))`, and the
     absolute child fee is at most 5000 · C_min − 1. Which large parents can be rescued (1 sat/vB parent, P2WPKH child,
     C = 110 vB, C_min = 94 vB; the child fee is `ceil(T · (P + C)) − P = (T − 1) · P + T · C` for whole P and T, so the
     limit is `P ≤ floor((5000 · C_min − 1 − T · C) / (T − 1)) = floor((469,999 − 110 · T) / (T − 1))`):

     | Target T | Before this fix | With this fix | Refused with the finalizer-limit error |
     |---|---|---|---|
     | 50 sat/vB | P ≤ ~2.1k vB | P ≤ 9,479 vB (~9.5k) | P > ~9.5k vB (a lower target works, e.g. 40 up to 11,938 vB) |
     | 20 sat/vB | P ≤ ~5.7k vB | P ≤ 24,621 vB (~24.6k) | P > ~24.6k vB (e.g. 10 up to ~52.1k vB) |
     | 10 sat/vB | P ≤ ~12.1k vB | P ≤ 52,099 vB (~52.1k) | P > ~52.1k vB (5 sat/vB reaches every standard parent: 117,362 vB) |

     Exact: T = 50: 464,499 / 49 = 9,479.57; T = 40: 465,599 / 39 = 11,938.4; T = 20: 467,799 / 19 = 24,621 (exact);
     T = 10: 468,899 / 9 = 52,099.9; T = 5: 469,449 / 4 = 117,362.25. Against pass 4's 10,000 limit
     (`P ≤ (940,000 − 110 · T) / (T − 1)`: ~19.1k, ~49.4k, ~104.3k vB) the range is roughly halved; it is still
     4.5× (T = 50) to 4.3× (T = 10) the pre-fix range.

     The prototype's 100,000 vB parent gate is dropped. It existed only to bound the stored-policy ceiling
     (`1000 · (100,000 + 1)`), and the child cap (5000 since pass 5) now bounds both that ceiling and the absolute child
     fee on its own. With the gate, a bounded parent above 100k vB fell back to the 1000 cap; such a parent is
     non-standard, and with or without the gate its child stays under the same cap, so the gate added a branch, a
     constant (`MAX_STANDARD_TX_VSIZE`) and a boundary test without bounding anything.
  6. **CPFP refuses a confirmed parent** at build time (`createCPFPTransaction`, before any fee math), at broadcast
     time (an intent of source `cpfp` is refused before the network when its parent is mined) and, since review pass 2,
     in background reconciliation (a `cpfp` child whose own lookup missed is withheld, not re-submitted, when its
     parent is mined; A1-R2-1). Without it, A1 would
     multiply the overpay on a parent that was mined in the meantime: the child fee was capped near 1000 · C (≈110k
     sats) and can now reach 5000 · C_min − 1 (469,999 sats for a P2WPKH child), all of it wasted. RBF already refuses a mined original
     (`advancedTx/rbf.ts:81-86`, `:426-456`); CPFP had only the client-side render guard
     (`src/components/TransactionActions.tsx:34-35`).
- **OQ-A1-M (plan; decided with evidence).** `cpfpParent.ts` joins the fee-policy Stryker profile and the
  wallet-safety mutation map.
  - It is the only code that lets a signing intent authorize more than 1000 sat/vB, and the profile exists to prove
    "exact fee authorization and final transaction enforcement" (`server/stryker.fee-policy.config.mjs:3`). Before
    this change the CPFP fee math the profile proved (`cpfp.ts:38-70`, `calculateCPFPFee`) was the whole of it.
  - Precedent: earlier fee fixes extended this profile and the map in the same PR (`c0f5bd002` added the batch
    ranges with their invariants; `8ede0fe6d` widened a range and added an invariant). Authentication helpers were not
    profiled (`advancedTx/shared.ts`, `nodeTransactionAuthentication.ts`), but `cpfpParent.ts` is fee math, not
    authentication.
  - Cost, measured: the profile with `cpfpParent.ts` added ran in 369 s locally (`p22-stryker-fee-policy.log`, 24 cores,
    the profile's `concurrency: 4`), 1059 mutants (about 150 more than without it, roughly +17%). Total score 85.46
    (break 75); `cpfpParent.ts` 75.00 with the prototype's tests (114 killed, 37 survived, 1 no coverage).
  - The map's checker requires every mapped file to have an invariant with an executable canary
    (`scripts/ci/check-wallet-safety-mutation-map.mjs:43-45`). Both canaries below were found and `Killed` by their
    named tests in that run, and the filtered check (`validateMutationEvidence` for `serverFeePolicy` and
    `serverTaprootArtifactFinalization` only) passed on the prototype plus the delta. Review pass 1 moved the second
    canary to the new unbounded-branch condition (Phase A1 Change); it has not been through Stryker yet, so the A1
    worker's own run (Verification step 2) is its first proof.
  - Provenance: neither the map nor the Stryker configs are in `VERIFIER_SOURCE_FILES`
    (`scripts/verify-addresses/sourceManifest.ts:2-37`), so `tests/scripts/verifyAddressesGenerated.test.ts` is not
    affected and no vector regeneration is needed. Both files are listed in `config/wallet-safety-critical-paths.json`
    (`:146`, `:148`), which only selects the full verify-vectors scan; that file is not edited.
  - `cpfpParent.ts` is not added to the critical mutation gate. That gate's globs are fixed in
    `server/scripts/mutation/shards.mjs` and cover `signingIntent/**` (which A1 also edits), not `advancedTx/**`.
  - Surviving mutants found test gaps (target exactly 1000, P2SH-wrapped Taproot, witness-program length bounds, and
    the authorization boundaries). A1 adds those tests (the target-1000 mutant is killed by the ceiling tests, R3-2). Review pass 1 replaced the prototype's `bounded` expression
    and its 100,000 vB gate (OQ-A1 item 5), so the "parent exactly 100,000 vB" survivor no longer exists, and the
    "child rate exactly at the ceiling" survivor is killed by unit tests of `authorizeCpfpChildFeeRate` at each of its
    three ceilings, not by a builder test (the builder cannot reach the package ceiling, A1-R1-3). The survivors at
    module-level constants and arrow-function definitions (`cpfpParent.ts:26-29`, `:40`, `:46` in the prototype) are
    static mutants the Vitest runner does not reload; they are accepted, and `minScore` 75 allows for them.
  - The 369 s / 1059 mutants / 75.00 figures predate review pass 1, which rewrote `authorizeCpfpChildFeeRate` (about
    the same size). The A1 worker re-measures on the final commit (Verification step 2); `rbf.ts` and `shared.ts` are
    outside the profile's `mutate` list (it pins only `rbf.ts:232-242`, which pass 1 leaves byte-identical).
- **OQ-A1-F (plan; found while drafting).** The fix must also reach the send wizard, or CPFP stays broken for the
  user.
  - After `POST /transaction/cpfp` the client saves a draft whose `feeRate` is the child's own rate
    (`src/components/TransactionActions/transactionActionsData.ts:31`) and opens it in the send wizard
    (`useTransactionActions.ts:151-156`). The draft is restored with `feeRate: draftData.feeRate` and
    `isDraftMode: true` (`sendTransactionPageHelpers.ts:173-177`).
  - `isReadyToSign` → `validateOutputsStep` refuses any fee rate above `MOBILE_API_REQUEST_LIMITS.maxFeeRate`
    (`src/contexts/send/stepValidation.ts:52-55`, `:142-147`), which disables Sign and Sign & Broadcast
    (`src/components/send/steps/review/DraftActions.tsx:89`, `:121`) and shows "Please complete all required
    fields before signing" (`:166-173`). So once the server issues a child above 1000 sat/vB, the draft cannot be
    signed from the UI.
  - Fix: in draft mode the upper bound is skipped (the fee is fixed by the server-built PSBT and its signing intent,
    whose exact fee the server re-checks at broadcast); the lower bound and every user-entered fee keep the cap. The
    draft API already accepts any positive fee rate (`shared/schemas/draftRequests.ts:12-18`).
  - This contradicts the brief's "no frontend change". It is included because without it the P2 still reproduces end
    to end. Review pass 1 confirmed it.
  - The skip relies on the draft lock: in draft mode the Edit control for the fee is hidden
    (`src/components/send/steps/review/TransactionSummary.tsx:246`, under "Saved Draft - Parameters Locked", `:143-147`)
    and nothing is rebuilt (`src/components/send/SendTransactionWizard/useReviewStepTransactionLifecycle.ts:22`,
    `!isDraftMode`), so the user cannot type an uncapped rate on this path. A later change that unlocks draft editing
    must revisit the skip; the code comment in `stepValidation.ts` says so.
  - The skip stays draft-wide, not CPFP-only (decided with evidence): a draft does not carry its source. The draft
    request has no source field (`cpfpDraftRequest`, `transactionActionsData.ts:17-50`; `shared/schemas/draftRequests.ts`),
    and the only CPFP marker is the free-text, user-editable `label` ("CPFP: accelerate …"). A draft-wide skip is safe
    because the server admits a stored rate above 1000 only for a `cpfp` intent (`service.ts` `parseFeePolicy`) and
    re-checks the exact fee at broadcast.
  - The review step shows the child's own rate unlabeled ("Fee (1043 sat/vB)" in `TransactionFlowPreviewParts.tsx:275`;
    `{state.feeRate} sat/vB` in `TransactionSummary.tsx:261`) right after the user asked for a package target. Neither
    component knows the draft source, so labelling it is not cheap here; it is recorded as new backlog P3
    `cpfp-review--child-rate-unlabeled` (possible discriminator: in draft mode a rate above
    `MOBILE_API_REQUEST_LIMITS.maxFeeRate` can only come from a `cpfp` intent).
- **OQ-C1 (coordinator).** Option (b) only: `run-browser-e2e-subject.sh` runs `browser-e2e-groups.sh --check` after
  the cleanup-coordinator guard and before it starts the backend.
  - `is_browser_smoke_file` already selects Full Browser E2E for every `tests/e2e/*` change except the render-regression
    spec, its directory and its snapshots (`scripts/ci/classify-files-lib.sh:283-295`). The group check does not apply
    to render-regression: `list_repo_browser_specs` excludes `tests/e2e/render-regression.spec.ts`
    (`scripts/ci/browser-e2e-groups.sh:4`, `:59-61`) and `check_groups` refuses it if assigned (`:95-98`). The
    fixture test's "complete" case adds that spec and must still reach the backend start.
  - Not option (a) (routing `tests/e2e/*` to `ci-classifier-tests`): the lane that runs the specs is the one that
    should refuse to skip one, as `backend-docker-test.sh:56` does for integration groups.
  - The same gap for `tests/install/e2e/*.test.sh` (section 6 of `tests/ci/ci-registration-completeness.test.sh`,
    `:305-307`, runs only in `ci-classifier-tests`) has no group registry to check against. It is recorded as a new
    backlog P3 (`ci-classifier--install-e2e-orphan-guard-not-triggered-by-new-suites`) and is not fixed here.

## Goal and non-goals

**Goal.** Both P2s stop reproducing:
- A large, low-fee parent can be accelerated with an ordinary target rate, and the resulting draft can be signed.
- A PR that adds a top-level browser spec without a group fails Full Browser E2E instead of merging green.

**Non-goals.**
- The package target stays capped at 1000 sat/vB; the route's `targetFeeRate` limit is unchanged
  (`server/src/api/bitcoin/transactions.ts:57`).
- No route, OpenAPI, schema-migration or response-shape change. No RBF behaviour change: `rbf.ts` only moves its
  confirmation lookup to `advancedTx/shared.ts` and calls it from there (the RBF half of the witness-padding P3 stays in
  backlog).
- Payjoin and RBF of a CPFP child above 1000 sat/vB stay refused (fail closed); only the `buildSigningIntentFeePolicy`
  call in `advancedTx/cpfp.ts` passes `maximumFeeRateSatsPerVbyte`. A payjoin round on a `cpfp` original would build its
  policy with the default 1000 cap and throw (`server/src/services/payjoin/attempt.ts:187-208`; a draft-bound intent is
  refused earlier, `:129`); an RBF of such a child needs a new rate above the child's, which the 1000 cap refuses
  (`rbf.ts:197-199`). Giving those paths the CPFP ceiling is out of scope; Verification greps that no other caller
  raises the cap.
- No change to `browser-e2e-groups.sh`, the classifiers or any workflow. No install-e2e registry.
- No version bump. The P3 backlog stays out.

## Decisions

### Cross-cutting decisions

- **D-22.X1 (delivery).**
  - One PR on `codex/bug-scrub-loop/20261013-i22` (worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i22`).
  - One commit per phase (failing tests + fix) in the order A1, C1, then the integrator commit (changelog and any
    regenerated `docs/architecture/generated`).
  - Phase workers implement in their own worktrees from the converged plan commit; the coordinator cherry-picks.
- **D-22.X2 (red evidence and setup).**
  - Every new behavioural test runs on base code before its fix and must fail for the reason its phase states. An
    unexpected red reason is a stop: record it and re-assess. Tests of the new module `cpfpParent.ts` cannot load on
    base and are coverage, not red evidence.
  - Setup in the integration worktree: root `npm ci`; `npx prisma generate` in `server/`;
    `npm run build --workspace shared`; about 810 `node_modules` entries in a real directory.
  - Never `server/npm ci`. Never `git stash`. One coverage or Stryker run at a time host-wide.
  - Commits run in the foreground through the pre-commit hook with nvm node v24.21.0 (npm 12), never while a
    `vitest --coverage` or Stryker run is active on the host.
- **D-22.X3 (pinned surfaces).** This iteration legitimately touches exactly three pinned surfaces:
  - `config/wallet-safety-mutation-map.json` (A1: re-pin `fee-surplus-is-independently-bounded`, add the
    `cpfpParent.ts` file gate and two invariants; every other profile byte-identical);
  - `server/stryker.fee-policy.config.mjs` (A1: add `cpfpParent.ts` to `mutate` and `cpfpParent.test.ts` to
    `testFiles`; `cpfp.ts:38-70` unchanged);
  - `config/resource-lifecycle-callsites.json` (C1: one `exempt` `temporary_artifact` entry for
    `tests/ci/browser-e2e-groups.test.sh`).

  No planned change touches: the other `server/stryker*` configs, `config/tooling/stryker*`, `server/scripts/mutation`,
  `.github/mutation-baseline.json`; `config/wallet-sync-mutation-boundaries.json`,
  `config/wallet-sync-lifecycle-contract.json`; `config/wallet-safety-critical-paths.json`,
  `config/hardware-wallet-implementation-inventory.json`, `scripts/quality/safety-catch-allowlist.json`;
  `server/prisma`; `scripts/verify-addresses`, `scripts/perf`, `shared/`, `.github/workflows`, `.nvmrc`;
  `server/src/services/accessControl.ts`; `scripts/ci/browser-e2e-groups.sh` and the `classify-*` scripts.

  Notes:
  - `signingIntent/{artifactValidation,feePolicy,schema,service,types}.ts` and their tests match
    `is_critical_mutation_file` (`scripts/ci/classify-files-lib.sh:208`), so the critical mutation lane runs. Every
    A1 file is under `server/src/services/bitcoin/**`, so the verify-vectors full scan and all seven mutation proofs
    run.
  - Pins that must hold, checked against the prototype: `cpfp.ts:38-70` is byte-identical to base, so
    `cpfp-package-fee-is-conserved` (`lineStart` 56, canary 60:20-60:40) holds; `feePolicy.ts` base 136-159 is
    byte-identical to head 143-166 (+7 lines above it), which the map re-pin follows (canary 150:72-157:4 →
    157:72-164:4); `artifactValidation.ts` keeps its line count (672) and lines 300-480 are byte-identical, so the
    taproot-artifact-finalization pins (`server/stryker.taproot-artifact-finalization.config.mjs:7-15`, map invariants
    at 323-470) hold. That profile ran green on the prototype in 11 s (100%, `p22-stryker-taproot-af.log`).
  - `rbf.ts:232-242` (`rbf-input-policy-drives-exact-weight`, the fee-policy profile's `rbf.ts` range) stays
    byte-identical: review pass 1 replaces three import lines and line 82 in place and removes only lines 415-456.
  - `transactions/broadcasting.ts` and `signingIntent/broadcastLifecycle.ts` are in critical mutation shard 3
    (`server/scripts/mutation/shards.mjs:32-45`); their new tests live in files the critical test list loads
    (`transactionService.broadcast.test.ts`, `broadcastLifecycle.test.ts`), and `check-critical-mutation-config.mjs`
    reports "complete and non-vacuous" on `$SCRATCH/p22-a1r1`. The shard's floor (`.github/mutation-baseline.json`, raw
    52 / weighted 48) is not edited.
  - Review pass 2 adds two more shard-3 files: `signingIntent/broadcastReconciliation.ts` (matched by
    `signingIntent/**`) and `repositories/transactionSigningIntentRepository.ts`. The repository's new test lives in
    `transactionSigningIntentRepository.test.ts`, a critical test file. The new reconciliation mutants (the
    `source === 'cpfp'` condition and the withhold branch) are killed by `broadcastReconciliation.test.ts` (review
    pass 3, R3-1). CI's critical shards run Stryker's default Vitest runner (`STRYKER_TEST_RUNNER` unset,
    `server/stryker.critical.config.mjs:22-24`) with `configFile: 'vitest.config.ts'` (`tests/**/*.test.ts`) and
    `coverageAnalysis: 'perTest'` (`:70-80`), so every server unit test that covers a mutant runs against it.
    `CRITICAL_TEST_FILES` (`server/scripts/mutation/shards.mjs`) feeds only the `STRYKER_TEST_RUNNER=command`
    fallback, which CI does not use, and the lane-selection completeness check; `scripts/ci/classify-files-lib.sh:214-217`
    says the default runner also kills critical mutants from other server tests. Listing every test of a critical
    file is not the pattern: `feePolicy.test.ts`, `json.test.ts` and `migration.test.ts` are absent at base too. So
    `broadcastReconciliation.test.ts` is not added and `server/scripts/mutation` stays an untouched pinned surface.
    A shard below its floor is still a stop to investigate, not a reason to edit the baseline or the test list.
    `check-critical-mutation-config.mjs` still reports "complete and non-vacuous" on `$SCRATCH/p22-a1r2`.
  - A1 adds no `finalize*`/`broadcast*` identifier (the new helpers are `isTransactionConfirmed`,
    `assertCpfpParentUnconfirmed`, `assertPreNetworkChecks`, `recordPreNetworkCheckFailure`; pass 2 adds
    `isCpfpChildParentConfirmed`, `isConfirmedInWalletRow`, `isConfirmedInAddressHistory`,
    `CPFP_PARENT_LOOKUP_DEADLINE_MS` and the repository's `markBroadcastWithheld`);
    `node scripts/generate-signer-inventory.mjs --check` reports "Signer inventory projection is current" on
    `$SCRATCH/p22-a1r1` and again on `$SCRATCH/p22-a1r2`. The one new catch (`assertCpfpParentUnconfirmed`, which
    logs and rethrows a 503) passes `check:safety-catch-guards` (73 groups, unchanged). Pass 2 adds no catch: a parent
    lookup error in reconciliation falls into `reconcileUncertain`'s existing outer catch, so
    `scripts/quality/safety-catch-allowlist.json` gains no entry (the later complexity refactor removes one; see the Review log). `check:bitcoin-network-boundaries`,
    `check:architecture-boundaries` and `check:server-cycle-baseline` (2 known cycle sets, unchanged) pass on both trees.
- **D-22.X4 (lizard).** Pinned `lizard` 1.24.0 with CI's flags on every changed `.ts`/`.tsx`: the per-file warning
  count must not grow, and the repository total stays ≤ the base total. The existing `createCPFPTransaction` warning
  (base 144 NLOC / 20 CCN) must not grow (pass-1 prototype: 141 / 20; pass-4 prototype: 142 / 20), nor the existing `broadcastAndSave` warning
  (base 139 / 20; pass-1 prototype 133 / 19, because the replacement-link check moves into `assertPreNetworkChecks`).
  Pass-2 prototype: `broadcastAndSave` stays 133 / 19; `reconcileUncertain` 69 NLOC / 13 CCN and the new `shared.ts`
  functions (at most 21 NLOC / 6 CCN) raise no warning; no changed file gains a warning.

## Phase A1 — CPFP caps the package target, not the child's own rate

**Finding.** `cpfp--large-parent-child-rate-exceeds-intent-fee-cap` (P2).

**Evidence (base).**
- `server/src/services/bitcoin/advancedTx/cpfp.ts:185-191` calls `calculateCPFPFee`, so
  `childFee = feeForRate(parentVsize + childVsize, target) − parentFee` (`:38-70`): the child pays the whole package
  deficit. Its own rate exceeds 1000 sat/vB whenever `P·(T − r_p) > C·(1000 − T)`; with a 1-in-1-out P2WPKH child
  (C ≈ 110 vB) and a 1 sat/vB parent, that is P > ~2.1k vB at T = 50 or P > ~5.7k vB at T = 20.
- `cpfp.ts:252-256` passes `exactFeeRateNotAbove(childFee, childTxSize)` as the requested rate to
  `buildSigningIntentFeePolicy`, which throws "Fee rate must be between 0.1 and 1000 sat/vB" above
  `SIGNING_INTENT_MAX_FEE_RATE` (`signingIntent/feePolicy.ts:107-121`, `types.ts:7`). The stored-policy schema
  (`schema.ts:36-38`) and the finalize check (`artifactValidation.ts:239`) apply the same cap.
- The route accepts `targetFeeRate` up to 1000 (`server/src/api/bitcoin/transactions.ts:57`) and calls the builder
  with no pre-check (`:255-270`), so a user asking for 20–50 sat/vB gets a 400 naming a range they never exceeded and
  cannot accelerate a stuck consolidation or batch payout, CPFP's main use case.
- The parent vsize is the served `virtualSize()` (`cpfp.ts:109`), which counts witness bytes the txid does not commit
  to (backlog P3 `cpfp-rbf--witness-padding-inflates-vsize`).
- Tests miss it: `advancedTx.cpfp.contracts.ts` uses only small parents, and the fee-policy tests check the cap only
  against directly requested rates.
- Client side (OQ-A1-F): a child above 1000 sat/vB would be saved as a draft that the send wizard refuses to sign
  (`stepValidation.ts:52-55`, `:142-147`; `DraftActions.tsx:89`, `:121`).
- Found in review pass 1 (OQ-A1 items 5-6):
  - `createCPFPTransaction` never checks that the parent is unconfirmed (`cpfp.ts:78-170`; "confirm" appears only in
    the header comment), and a CPFP draft persists, so it can be signed and broadcast after the parent is mined.
    `broadcastAndSave` (`transactions/broadcasting.ts:296-380`) has a pre-network check only for `replacesTxid`
    (`:348-378`).
  - Electrum broadcast relays to bitcoind's default `maxfeerate` (10,000 sat/vB on the child's own rate);
    `server/src` has no `maxfeerate` or `max-fee-exceeded` handling.
- Found in review pass 5 (R5-1): bitcoinjs-lib's `extractTransaction()` refuses `floor(fee / signed vsize) >= 5000`
  (default `maximumFeeRate`) in `finalizePsbt` (`artifactValidation.ts:470`) and in the Trezor adapter
  (`signPsbtValidation.ts:142`), so the pass-1 and pass-4 10,000 sat/vB bound authorized children that are then
  refused after signing (OQ-A1 item 5).

**Change** (OQ-A1, OQ-A1-M, OQ-A1-F). Review pass 1 code is in `$SCRATCH/plan22-A1-r1-prototype.patch` on top of the
A1 prototype; review pass 2 code is in `$SCRATCH/plan22-A1-r2-prototype.patch` on top of both; review pass 4 code
(R4-1) is in `$SCRATCH/plan22-A1-r4-prototype.patch` on top of all six earlier patches; review pass 5 code (R5-1) is in
`$SCRATCH/plan22-A1-r5-prototype.patch` on top of all seven.
- New `server/src/services/bitcoin/advancedTx/cpfpParent.ts` (pass-1 prototype, 174 lines):
  - `measureCpfpParent(client, transaction)`: authenticated fee from txid-authenticated prevouts (moved from
    `cpfp.ts:165-177`), and `vsize = min(served, bound)`, where the bound is the stripped size plus the largest valid
    witness per input type, derived from the authenticated prevout script (and, for P2SH, the redeem script, the last
    push of the txid-authenticated scriptSig): P2WPKH 109 bytes; P2WSH multisig by its threshold, only when the
    served witness script hashes to the program; Taproot key path 67 bytes, only when not nested and the served
    witness has one element; non-witness inputs 0 (1 empty-stack byte when the transaction has witnesses). Any other
    witness program leaves `vsizeBound` undefined.
  - `authorizeCpfpChildFeeRate(parent, child, target, childFee)` (pass-4 prototype `:134-177`), where
    `child: { vsize: number; minimumSignedVsize: number }` replaces pass 1's `childVsize: number` on the same line (so
    line 146, the second canary, does not move); every field `targetFeeRate`, one message per branch:
    1. target above 1000 (or NaN): "Target package fee rate must be at most 1000 sat/vB";
    2. unbounded parent (`vsizeBound === undefined`), child rate above 1000: "CPFP child fee rate {r} sat/vB exceeds
       1000 sat/vB: the parent size cannot be bounded from authenticated data"; ceiling 1000;
    3. bounded parent, `childFee >= CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT * child.minimumSignedVsize` (R4-1's smallest
       signed size, R5-1's strict 5000 limit; integer sats on both sides, OQ-A1 item 5): "CPFP child fee rate
       {exactFeeRateNotAbove(childFee, C_min)} sat/vB at its smallest signed size ({C_min} vB) is not below 5000 sat/vB,
       the PSBT finalizer limit: choose a lower target fee rate". A two-line comment says finalization refuses
       `floor(fee / signed vsize) >= the limit` and the signed child can be smaller than the estimate. The condition
       and message are edited in place (same line count), and `CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT` joins the existing
       one-line `../signingIntent/types` import, so lines 1-177, both canaries and `lineEnd` 177 do not move. Pass 1's
       `feeRate > SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE` (the rate over the maximum size C) and pass 4's
       `childFee > SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE * child.minimumSignedVsize` are gone;
    4. bounded parent, child rate above the package ceiling `exactFeeRateNotAbove(1000 · (P + C), C)`: "CPFP child fee
       rate {r} sat/vB exceeds {ceiling} sat/vB, what a 1000 sat/vB package needs". Defense in depth, commented as
       such: with the target capped at 1000 the builder's child fee `ceil(T · (P + C)) − parentFee` cannot exceed it
       (A1-R1-3), so only the unit tests reach this branch.
    - Returns `{ feeRate, maximumFeeRate }` with `maximumFeeRate = min(packageCeiling, 5000)` for a bounded parent,
      1000 otherwise. `feeRate` stays the rate over C, the policy's rate convention. No parent-size gate (OQ-A1 item 5).
  - `minimumSignedVsize(spendPolicy: SpendPolicy, maximumWeight: number): number` (R4-1), appended at the end of the
    file after `MIN_ECDSA_SIGNATURE_BYTES = 9` and `MIN_SCHNORR_SIGNATURE_BYTES = 64`, with a comment citing Bitcoin
    Core's `IsValidSignatureEncoding` (9 to 73 bytes) and BIP 340 (64 bytes). It returns
    `Math.ceil((maximumWeight − slackWeight) / 4)` with the slack of OQ-A1 item 5: `p2pkh` 4 · 64, `p2wpkh` and
    `p2sh-p2wpkh` 64, `p2tr-keypath` 65 − 64 = 1, otherwise (both sortedmulti policies) `spendPolicy.m` · 64. Appended
    rather than placed with the other constants so that lines 1-177, and both canaries, do not move. `SpendPolicy` is
    imported as a type on the existing `../transactionWeight` import line.
- `cpfp.ts`: right after `fetchAuthenticatedTransaction` (base `:108`) and before any fee math, refuses a mined parent:
  `if (await isTransactionConfirmed(client, parentTxid, parentTx.canonicalHex, network, walletId)) throw new
  InvalidInputError('Parent transaction is already confirmed; CPFP is not needed', 'parentTxid')` (RBF says
  "Transaction is already confirmed"). A lookup error propagates (fails closed), as it does for RBF. Then uses
  `measureCpfpParent` and `authorizeCpfpChildFeeRate` and passes the child rate and its ceiling to
  `buildSigningIntentFeePolicy`. Lines 38-70 stay byte-identical. R4-1: the child estimate is destructured as
  `const { weight: childWeight, vsize: childTxSize } = estimateTransactionWeight({...})`, then
  `const childSize = { vsize: childTxSize, minimumSignedVsize: minimumSignedVsize(evidence.spendPolicy, childWeight) };`
  is passed to `authorizeCpfpChildFeeRate` (written in two lines to keep `createCPFPTransaction` at 142 NLOC, under
  D-22.X4's 144).
- `advancedTx/shared.ts`: gains `isTransactionConfirmed(client, txid, txHex, network, walletId?)` and its private
  `decodeOutputAddresses`, moved from `rbf.ts:416-456` (renamed from `isOriginalConfirmed`): the wallet's
  DB row settles it when it shows confirmations or a block height; otherwise Electrum address history for a
  wallet-owned output of the transaction (falling back to its first decodable output); a lookup error propagates.
  Review pass 2 splits its body into two private steps, `isConfirmedInWalletRow(txid, walletId?)` and
  `isConfirmedInAddressHistory(client, txid, txHex, network, walletId?)`, and `isTransactionConfirmed` returns
  `row || history` (same order, same queries, so RBF and the CPFP builder see no change). It also gains the shared
  parent check (A1-R2-1, A1-R2-2):
  - `CPFP_PARENT_LOOKUP_DEADLINE_MS = 20_000`, commented as well inside the 60 s broadcast lease
    (`BROADCAST_LEASE_MS`, `signingIntent/broadcastLifecycle.ts:11`; reconciliation's `LEASE_MS` is also 60 s).
  - `isCpfpChildParentConfirmed(inputs, network, walletId): Promise<boolean>` over each distinct input txid. It reads
    the wallet rows first, so a parent the wallet already records as confirmed is settled with no `getNodeClient` call.
    Only then does it call `getNodeClient(network)`, `fetchAuthenticatedTransaction` per parent and the address-history
    step. Either source saying "confirmed" wins, so a DB/node disagreement refuses. The DB-first order is safe: the
    only thing a stale "confirmed" row can do is refuse a broadcast, which is the fail-closed direction, and RBF already
    trusts the same row. The whole lookup runs under `withTimeout` (`utils/async.ts:113`, timer cleared in `finally`,
    late rejection observed), and a timeout throws like any lookup error. The helper never decides 409 or 503; its
    callers map its result and its errors.
- `advancedTx/rbf.ts`: imports `isTransactionConfirmed` from `./shared` and calls it at `:82`; drops the moved
  functions and the now-unused `parseTransaction`/`transactionRepository` imports. No behaviour change.
- `signingIntent/broadcastLifecycle.ts`: the `claimed` result of `claimSigningIntentBroadcast` (base `:62`, `:97`)
  carries `source: result.record.source`, read from the row the claim just locked (the repository already returns it,
  `transactionSigningIntentRepository.ts:60-62`). `ValidatedBroadcastArtifact` is not widened: that would shift
  `artifactValidation.ts`, whose line count the taproot-artifact-finalization pins need (D-22.X3).
- `transactions/broadcasting.ts` (the broadcast-time check; A1-R1-1(b)):
  - Where: after the claim and before `broadcastTransaction`, in the slot of the existing `replacesTxid` check
    (base `:348-378`). The block becomes one `try { await assertPreNetworkChecks(artifact, metadata, claim) }` with the
    existing failure handling. `assertPreNetworkChecks` runs the replacement-link check when `replacesTxid` is set, then
    `assertCpfpParentUnconfirmed(artifact)` when `claim.source === 'cpfp'`. After the claim, not before it, because
    (i) an idempotent replay (`complete`/`accepted`, `:335-346`) must return success without re-validating, exactly as
    for `replacesTxid` (a child mined together with its parent would otherwise turn a harmless replay into a 409), and
    (ii) the live lease keeps a concurrent attempt from broadcasting between the check and the send. The check
    finishes within `CPFP_PARENT_LOOKUP_DEADLINE_MS` (20 s) of a 60 s lease, so a slow node cannot let the lease
    lapse mid-check (A1-R2-2). Even if a lease did lapse, reconciliation would re-run the same parent check before
    any re-submission (A1-R2-1).
  - Parent txid: every distinct `artifact.snapshot.transaction.inputs[].txid` (the CPFP builder binds exactly one
    input, `parentTxid:vout`, base `cpfp.ts:217-223`). The snapshot is the server-issued, digest-bound intent, so the
    client cannot choose it. The error details carry them as `parentTxid` (the distinct txids joined with `,`, so the
    one parent's txid).
  - Lookup (pass 2): `const { inputs } = artifact.snapshot.transaction;` (the same local feeds `parentTxid`), then
    `await isCpfpChildParentConfirmed(inputs, artifact.network, artifact.walletId)` from `advancedTx/shared.ts` (the
    Verification grep matches this exact call; R4-2). `broadcasting.ts` no longer imports `getNodeClient`,
    `fetchAuthenticatedTransaction` or `isTransactionConfirmed`.
  - Confirmed: `ConflictError('Parent transaction is already confirmed; CPFP is not needed', undefined, { reason:
    'cpfp_parent_confirmed', parentTxid })` (409, the convention of `broadcast_stalled`/`duplicate_submission`).
  - Lookup failure or deadline (node client, parent fetch or authentication, DB row, address history, or the 20 s
    timeout): log `warn` and throw
    `ServiceUnavailableError('Could not verify that the CPFP parent is still unconfirmed; retry the broadcast',
    undefined, { reason: 'cpfp_parent_status_unavailable', parentTxid })` (503, operational). Fail closed and
    retryable.
  - Both are ApiErrors, so `asPreNetworkRejection` wraps them as `PreNetworkBroadcastRejectionError` (status, code and
    details kept) and the failure tag is `{ claimed: true, priorState, releasedToReady }`.
    `recordReplacementLinkFailure` is renamed `recordPreNetworkCheckFailure` (base `:257-272`, unchanged otherwise): a
    first (`ready`) claim is released to `ready`, so the route releases fresh policy reservations
    (`api/transactions/broadcasting.ts` `failureReleasesFreshReservations`) and a retry claims afresh; a resumed
    claim returns to `unknown` without counting an attempt; a stalled one stays `stalled`.
  - No source other than `cpfp` does a lookup.
- `signingIntent/broadcastReconciliation.ts` (A1-R2-1). Pass 1 left a gap here, and its stated reason for accepting
  it was wrong.
  - The gap: `listBroadcastsForReconciliation` (`repositories/transactionSigningIntentRepository.ts:478`) also resumes
    a `claimed` row whose lease expired. `broadcastAndSave` leaves exactly that state when a pre-network refusal's
    release write fails ("lease expiry will reconcile it"), when the process dies between the claim and the send, or
    when the check outlives the lease. In each case nothing reached a node. `reconcileUncertain` (`:74-138`) then
    re-submitted the child with no parent check.
  - Why pass 1's reason was wrong: "the child may already be in mempools" does not hold, because reconciliation
    re-submits only after its own lookup of the child txid misses (`:101-117`). With the parent mined and the child
    unknown to the node, withholding costs nothing (a child relayed elsewhere confirms anyway). Re-submitting can only
    add a confirmable child that overpays by up to 5000 · C_min − 1 sats.
  - Change: the record type gains `source: string`; the row comes from a plain `findMany`, so `source` is present.
    After the snapshot parse and before `broadcastAuthenticatedRawTransaction`, so only once the child lookup has
    missed:
    `if (record.source === 'cpfp' && await isCpfpChildParentConfirmed(snapshot.data.transaction.inputs,
    record.network, record.walletId)) { log.warn(...); await transactionSigningIntentRepository.markBroadcastWithheld(
    record.id, leaseToken, CPFP_PARENT_CONFIRMED_ERROR); return false; }`, with the module constant
    `const CPFP_PARENT_CONFIRMED_ERROR = 'CPFP parent confirmed; child withheld';` (the Verification grep matches the
    constant, not a string literal; R4-2).
  - A parent lookup error, including the 20 s deadline, falls into the existing outer catch, so
    `recordUncertainFailure` keeps the row `unknown`. The error is not node-answered, so `countAttempt: false` and no
    attempt is counted. No new catch is added.
  - A child the node already knows is accepted by the earlier lookup before any parent check. A non-`cpfp` row does no
    parent lookup.
- `repositories/transactionSigningIntentRepository.ts` (pass 2): new `markBroadcastWithheld(id, leaseToken, error)`,
  exported beside `markBroadcastStalled`.
  - It is the same lease-guarded `transitionClaim` to `unknown` (lease cleared, error recorded) and also sets
    `broadcastAttemptCount: MAX_RECONCILE_ATTEMPTS`, so the row joins the derived stalled set.
  - Why not the reviewer's `markBroadcastStalled`: it refuses below the cap (`extraWhere: { broadcastAttemptCount:
    { gte: MAX_RECONCILE_ATTEMPTS } }`, `:376-385`). The integration test pins that refusal
    (`transactionSigningIntentRepository.integration.test.ts:138`), and a reconciled row is usually far below the cap.
  - A withheld row is lookup-only: `lookupStalledIntent` still accepts the child if it surfaces.
  - A user retry is a `stalled` claim, so `broadcastAndSave` re-runs the parent check and answers 409.
    `recordPreNetworkCheckFailure` keeps it stalled, because a claim increments the count, which stays ≥ the cap.
  - A count already above the cap is lowered to the cap and stays stalled.
- `signingIntent/types.ts` (R5-1): `CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT = 5000`, documented as bitcoinjs-lib's default
  Psbt `maximumFeeRate` that `extractTransaction()` enforces in `finalizePsbt` and the Trezor adapter (refusing
  `floor(fee / signed vsize) >= 5000`), with Bitcoin Core's 10,000 sat/vB `maxfeerate` named as further away;
  `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE = CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT` (the stored-policy ceiling for a `cpfp`
  intent; its comment says an authorized child's policy rate over C is below the finalizer limit, so the ceiling is
  equal, OQ-A1 item 5) and `maximumSigningIntentFeeRate(source)` (5000 for `source === 'cpfp'`, else 1000); no
  `MAX_STANDARD_TX_VSIZE`. The comment says the builder's per-package bound is **at most** this (W3; the prototype said
  "below", which is wrong at equality).
- `signingIntent/feePolicy.ts`: optional `maximumFeeRateSatsPerVbyte` (default 1000) on
  `buildSigningIntentFeePolicy`, checked by `assertRequestedFeeRate`, which also refuses a bound outside
  [1000, `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE`] (= [1000, 5000] since R5-1; `feePolicy.ts` itself is not edited by
  pass 5, so the `fee-surplus` re-pin holds) or NaN ("Fee-rate bound is outside the supported range").
- `signingIntent/schema.ts`: `requestedFeeRateSatsPerVbyte` max becomes `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE`
  (5000 since R5-1; a structural limit; the per-source cap is enforced where the source is known).
- `signingIntent/service.ts`: `parseFeePolicy(input)` in `prepareSigningIntent` applies
  `maximumSigningIntentFeeRate(input.source)`, so only a `cpfp` intent may store a rate above 1000.
- `signingIntent/artifactValidation.ts`: `validateFinalizedFeePolicy` takes the envelope and checks
  `requestedRate <= maximumSigningIntentFeeRate(source)` (with the 5000 cap this per-source finalize check is no
  longer a no-op for `cpfp`). The exact-fee check (`actualFeeSats === expectedFeeSats`, `:256`) is unchanged, so the
  absolute child fee stays bound to the builder's. `finalizePsbt`'s `candidate.extractTransaction()` (`:470`) keeps its
  default fee check (R5-1 option (a); the line is inside the taproot-artifact-finalization pins).
- `server/stryker.fee-policy.config.mjs`: `'src/services/bitcoin/advancedTx/cpfpParent.ts'` after the `cpfp.ts:38-70`
  entry, and `'tests/unit/services/bitcoin/advancedTx/cpfpParent.test.ts'` after `advancedTx.test.ts`.
- `config/wallet-safety-mutation-map.json` (`serverFeePolicy` only; targeted text edits, never `json.dump`):
  - re-pin `fee-surplus-is-independently-bounded`: 136-159 → 143-166, canary 150:72-157:4 → 157:72-164:4 (prototype);
  - file gate `{ "path": "src/services/bitcoin/advancedTx/cpfpParent.ts", "minScore": 75 }` after `cpfp.ts`;
  - invariant `cpfp-parent-vsize-is-capped-by-its-authenticated-bound` (the `measureCpfpParent` return, prototype
    121-125), canary `padded-parent-is-priced-at-its-bound`: `MethodExpression` → `Math.max(servedVsize, vsizeBound)`
    at 123:53-123:86, required killing test "CPFP parent measurement caps a padded witness on a non-witness input at
    the stripped size";
  - invariant `cpfp-child-rate-above-cap-requires-a-bounded-parent` (134-177 since pass 4, the whole
    `authorizeCpfpChildFeeRate`; pass 1 had 134-174, and R4-1's longer node-limit branch adds three lines; pass 5
    rewrites that branch in place, so 134-177 holds), canary `unbounded-parent-keeps-the-per-transaction-cap`: `ConditionalExpression` →
    `false` at 146:7-146:38 (the `parent.vsizeBound === undefined` branch condition), required killing test "CPFP child
    fee-rate authorization keeps the per-transaction cap for an unbounded parent" (the mutant gives an unbounded
    parent the 5000 ceiling, so the 1000.01 refusal and the `maximumFeeRate: 1000` expectation both fail);
  - both invariants name the same test as their killing test in `requiredTests`, in
    `tests/unit/services/bitcoin/advancedTx/cpfpParent.test.ts`.
  - The first canary's position is the prototype's Stryker report value (unchanged by passes 1 and 4). The second
    canary's position (unchanged by pass 4, whose `lineEnd` 174 → 177 is in `plan22-A1-r4-prototype.patch`) is computed
    from the pass-1 source with the report's convention (1-based column, exclusive end, as the
    prototype's 144:19-144:91 shows), not Stryker-verified. The implementer takes the final ones from the phase's own
    `fee-policy.json` report (match location, `mutatorName`, `replacement`); `$SCRATCH/plan22-A1-mutation-map-delta.patch`
    (unified diff with headers, both files) shows the edit.
- `src/contexts/send/stepValidation.ts`: one helper `isFeeRateInRange(state)` used by `validateOutputsStep` and
  `getStepErrors`: `feeRate >= minFeeRate && (isDraftMode || feeRate <= maxFeeRate)`, with a comment that a resumed
  draft's fee is fixed by the server-built PSBT and its signing intent, and that the skip relies on drafts being
  locked (no fee edit, no rebuild; OQ-A1-F) (`$SCRATCH/plan22-A1-frontend-prototype.patch`).
- No route or OpenAPI change: the response fields are unchanged (`childFeeRate`/`parentFeeRate` are `minimum: 0`
  numbers, `server/src/api/openapi/schemas/bitcoin.ts:715-716`).

**Tests** (prototype unless stated):
- New `server/tests/unit/services/bitcoin/advancedTx/advancedTx.cpfp-package-cap.contracts.ts`, registered from
  `advancedTx.test.ts`: a ≈2,230 vB parent at 1 sat/vB with target 50 succeeds and the child rate exceeds 1000; a
  target of 1000.5 is refused naming the target; guard: a small parent's fee and policy are unchanged; a
  witness-padded parent (same txid) is priced at its bound; a Taproot script-path parent keeps the 1000 cap.
  **Added in review pass 1** (`buildParent`/`mockWalletOutputOf` take an optional UTXO amount):
  - "refuses a bounded parent whose child would reach the PSBT finalizer limit" (renamed in pass 5): a ≈25k vB parent
    (800 filler outputs) at 1 sat/vB with target 50 and a 5,000,000-sat UTXO is refused with "is not below 5000 sat/vB,
    the PSBT finalizer limit", field `targetFeeRate`;
  - "a confirmed parent": refused when the wallet row is confirmed (`transaction.findUnique` → confirmations 2; exact
    message, field `parentTxid`), refused when address history shows it mined (height 850,000), and fails closed when
    the history lookup rejects (the error propagates). All three use a small parent at target 20, so on base they
    resolve.
  **Added in review pass 4** (R4-1), **retargeted in pass 5** (R5-1): "refuses a child under 5000 sat/vB of its
  estimated size that a shorter signature would push to it": a parent with 330 filler outputs (≈10.3k vB) at 1 sat/vB,
  target 50, a 5,000,000-sat UTXO. The test first asserts the window, `5000 · 94 ≤ childFee < 5000 · 110` (child fee
  computed as `feeForRate(P + 110, 50) − parentFee`; the window is P in [9,480, 11,112] at T = 50), then expects the
  refusal matching `/at its smallest signed size \(94 vB\) is not below 5000 sat\/vB, the PSBT finalizer limit/`,
  field `targetFeeRate`. On the pass-4 source the child is issued (the R5-1 defect).
- New `server/tests/unit/services/bitcoin/advancedTx/cpfpParent.test.ts`: measurement per input type (P2WPKH,
  non-witness with padding, P2SH-P2WPKH, P2SH legacy and empty scriptSig, P2WSH and P2SH-P2WSH multisig, Taproot key
  path beside a legacy input, five unbounded cases) and authorization. Authorization is tested by calling
  `authorizeCpfpChildFeeRate` directly at each boundary, with the exact message of each branch (pass-1 prototype; since
  pass 4 the child argument is built by a local `child(vsize, minimumSignedVsize = vsize)`):
  - "lets a bounded parent raise the child ceiling up to the stored-policy ceiling" (renamed in pass 5;
    `maximumFeeRate` `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE`, 5000);
  - "keeps the per-transaction cap for an unbounded parent": child rate exactly 1000 accepted (`maximumFeeRate`
    1000), 1000.01 refused with the "cannot be bounded" message (the second canary's killing test);
  - "caps a bounded parent's child below the PSBT finalizer limit on its smallest signed size" (R4-1, retargeted by
    R5-1; replaces pass 1's "exactly 10,000 accepted, 10,000.01 refused" at C): a P2WPKH child `child(110, 94)` under a
    50,000 vB bounded parent at target 1000. The largest allowed fee, 469,999 = 5000 · 94 − 1, is accepted with
    `{ feeRate: 4272.71818181, maximumFeeRate: 5_000 }`; one sat more, 470,000, is refused with exactly "CPFP child fee
    rate 5000 sat/vB at its smallest signed size (94 vB) is not below 5000 sat/vB, the PSBT finalizer limit: choose a
    lower target fee rate"; 550,000 (5000 sat/vB of C) and 940,000 (pass 4's largest allowed fee) are refused with the
    finalizer-limit message. The 469,999/470,000 pair kills the `>=` → `>` mutant;
  - "caps a bounded parent's child at what a package at the cap needs": a 100 vB parent and child, exactly 2,000
    accepted, 2,000.01 refused with the package message;
  - **Added in review pass 4** (R4-1): `describe('CPFP child minimum signed size')`, one `it.each` row per child
    policy: the input goes through `estimateTransactionWeight` with a P2WPKH output, and the test pins the maximum
    weight and `minimumSignedVsize` (the OQ-A1 item 5 values): P2PKH 760 / 126, P2WPKH 439 / 94, P2SH-P2WPKH 531 / 117,
    Taproot key path 397 / 99, 2-of-3 P2WSH 586 / 115, 2-of-3 P2SH-P2WSH 726 / 150. Each row has a different slack,
    so a mutant of any branch or of the 4× legacy weight fails a row;
  - these replace the prototype's "parent above the standard size" test and the planned "parent of exactly
    `MAX_STANDARD_TX_VSIZE`" and "child rate exactly at the ceiling" builder tests (no gate any more; the builder cannot
    reach the package ceiling, A1-R1-3).
  **Added by this plan** (each kills a mutant that survived in the prototype run):
  - a P2SH-wrapped Taproot program is unbounded (kills `program === prevoutScript` → `true`);
  - witness-program length bounds: a 4-byte v1 program and a 42-byte v16 program are unbounded; a 43-byte script
    starting with `OP_1` is a non-witness spend; a 23-byte script that is not `OP_HASH160 <20> OP_EQUAL` is not
    treated as P2SH. That input's scriptSig pushes a P2WPKH program and it carries a P2WPKH witness (expected vsize
    = the stripped size), so treating it as P2SH would bound it at 109 witness bytes; an empty or legacy scriptSig
    gives the same result either way and leaves the `isP2sh` mutants alive.
  - The prototype's separate "target of exactly 1000" test is dropped as redundant (R3-2): the ceiling tests above
    already call `authorizeCpfpChildFeeRate` with target 1000, and three of them fail under the `<=` → `<` mutant.
  - Guidance: the pass-3 reviewer's working file `$SCRATCH/r22p3-cpfpParent.test.ts` (25 tests, each mutant above
    hand-applied and killed).
- `feePolicy.test.ts`: a rate above 1000 needs a caller-supplied CPFP bound; bounds 999, 5001 (CPFP ceiling + 1; the
  test reads `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE + 1`) and NaN are refused. **Added by this plan, prototyped in pass
  2 (R2-W2), renamed in pass 5:** "admits a fee-rate bound of exactly the CPFP child ceiling (5000 sat/vB)". It uses `witnessPsbt(1_000_000n, 800_000n)` with rate
  `exactFeeRateNotAbove(200_000, estimatePsbtMaximumSignedVsize(psbt))` (above 1000, asserted) and bound
  `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE`; the policy is built with `expectedFeeSats` 200,000 and that rate. It is red
  evidence, not a guard: on base it fails with `InvalidInputError: Fee rate must be between 0.1 and 1000 sat/vB`
  (base ignores the fifth argument).
- `service.test.ts`: a stored rate above 1000 is refused for `standard` and admitted for `cpfp`.
- `artifactValidation.test.ts`: a `cpfp` intent's policy rate of 1500 passes the finalize check (the existing range
  test keeps refusing 1000.5 for other sources). **Added in review pass 5** (R5-1), a new
  `describe('a CPFP child at the PSBT finalizer fee-rate limit')` over a 1-in-1-out P2WPKH child (2,000,000-sat input
  under the file's test key `01…01`, P2WPKH output; C = 110 asserted with `estimatePsbtMaximumSignedVsize`, C_min = 94
  as pinned by the `minimumSignedVsize` rows), `source` `cpfp`:
  - "builds, signs and finalizes a CPFP child at the top of the authorized range": fee 469,999 = 5000 · 94 − 1; the
    policy comes from `buildSigningIntentFeePolicy(psbt, exactFeeRateNotAbove(fee, 110), fee, 0, 5_000)`; the PSBT is
    signed with the test key and `validateSignedArtifact` resolves with `actualFeeSats` 469,999 and the signed vsize.
    Red on base (`InvalidInputError: Fee rate must be between 0.1 and 1000 sat/vB`); passes on the pass-4 source.
  - "never authorizes a child that finalization refuses": fee 550,000 = 5000 · 110, signed (vsize 110, asserted via
    `extractTransaction(true)`), with the policy the pass-4 builder issued (rate 5000 over C, tolerance 0):
    `validateSignedArtifact` rejects with "Signed PSBT is not finalizable" (`not_finalizable`), and one sat less
    (549,999 at the same 110 vB) extracts, which pins bitcoinjs-lib's `>=` at 5000. Then
    `authorizeCpfpChildFeeRate` (dynamic `import()` of `advancedTx/cpfpParent`, so the file still loads on base) must
    refuse both 550,000 and 470,000 for a bounded parent and `{ vsize: 110, minimumSignedVsize: 94 }`. Red on the
    pass-4 source (`expected [Function] to throw an error`: the child is authorized, then refused at finalize) and on
    base (`Cannot find module …/advancedTx/cpfpParent`, after the finalize refusal passed).
- **Added in review pass 1**, broadcast time:
  - new `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.cpfp-parent.contracts.ts`,
    registered from `transactionServiceBroadcast.broadcastAndSave.contracts.ts` (so `transactionService.broadcast.test.ts`,
    a critical test file, runs it). The claim mock returns `source: 'cpfp'` and the snapshot's one input spends a
    built parent; `getNodeClient` serves that parent and an address history:
    - "refuses a CPFP child whose parent is already mined, before the network, and releases the claim":
      `PreNetworkBroadcastRejectionError`, 409, `reason: 'cpfp_parent_confirmed'`, tag `{ claimed: true, priorState:
      'ready', releasedToReady: true }`, lease released, `broadcastTransaction` not called;
    - "refuses from the wallet row alone when it already records the parent as confirmed" (409; pass 2 tightens it:
      `getNodeClient` is never called, so the wallet row settles it before any node call, A1-R2-2);
    - "fails closed with a retryable 503 when the parent lookup fails" (503, `cpfp_parent_status_unavailable`,
      released, not broadcast);
    - **added in pass 2** (A1-R2-2), "fails closed with a retryable 503 when the parent lookup outlives its deadline":
      fake timers; `getTransaction` never resolves; after `vi.advanceTimersByTimeAsync(CPFP_PARENT_LOOKUP_DEADLINE_MS)`
      the outcome is a `PreNetworkBroadcastRejectionError` (503, `cpfp_parent_status_unavailable`), the tag is
      `{ claimed: true, priorState: 'ready', releasedToReady: true }`, the claim is released, and nothing is broadcast.
      The outcome is captured in a variable rather than awaited, so a missing deadline reads as `'pending'`, not a
      test timeout;
    - guards: "broadcasts a CPFP child whose parent is still in the mempool" (history height 0) and "does not look the
      parent up for a non-CPFP intent or an idempotent replay" (`getNodeClient` never called);
  - `broadcastLifecycle.test.ts`: "returns the claimed row source so a source-specific pre-network check reads the
    locked intent" (`record: { source: 'cpfp' }` → the claimed result carries `source: 'cpfp'`).
- **Added in review pass 2** (A1-R2-1), reconciliation:
  - `broadcastReconciliation.test.ts` mocks `advancedTx/shared` (`isCpfpChildParentConfirmed`, default `false`) and
    the repository's `markBroadcastWithheld`. A new `describe('a CPFP child whose re-submission would follow a
    lookup miss')` holds four tests (the child lookup misses by default):
    - "withholds an expired claim whose parent is mined instead of re-submitting it": a `claimed` `cpfp` row, parent
      confirmed → `{ examined: 1, completed: 0 }`. The helper is called with the snapshot inputs, `'testnet3'` and
      `'wallet-1'`; `markBroadcastWithheld('intent-1', <lease>, 'CPFP parent confirmed; child withheld')`; no
      broadcast; no `markBroadcastUnknown`. Red on base and on pass 1: `expected { examined: 1, completed: 1 } to
      deeply equal { examined: 1, completed: +0 }` (the child is re-submitted).
    - "keeps the intent uncertain without counting an attempt when the parent lookup fails": the helper rejects →
      `markBroadcastUnknown('intent-1', <lease>, 'electrum unavailable', { countAttempt: false })`, not broadcast, not
      withheld. Red on base and on pass 1, with the same message.
    - Guard: "re-submits a child whose parent is still in the mempool" (one broadcast, not withheld).
    - Guard: "does not look a parent up for a non-CPFP intent or a child the node already knows".
  - `transactionSigningIntentRepository.test.ts`: "withholds a claimed intent below the cap by moving it to the
    stalled (lookup-only) set". It expects the exact `updateMany` call: where `{ id, broadcastState: 'claimed',
    broadcastLeaseToken }` with no cap guard; data `unknown`, lease cleared, error, `broadcastAttemptCount: 60`. A
    wrong lease returns `false`. Red on base and on pass 1: `TypeError: markBroadcastWithheld is not a function`.
- RBF's existing confirmation tests (`advancedTx.rbf-detection.contracts.ts`, DB row and address history) keep
  covering `isTransactionConfirmed` after the move.
- **Added by this plan:** `tests/contexts/stepValidation.test.ts`: "accepts a resumed draft whose server-authorized
  fee rate exceeds the entry cap" (draft mode, 1030.5: `isReadyToSign` true, no outputs-step error); guard: "keeps the
  entry cap for a fee rate the user typed" (not draft mode, 1030.5: false and the range error).

**Red (observed).**
- Server, `p22-a1-r1-red.txt` (base source `bd215520d` under the pass-1 tests, in the copy `$SCRATCH/p22-a1r1-base`;
  `advancedTx.test.ts`, `feePolicy.test.ts`, `service.test.ts`, `artifactValidation.test.ts`,
  `transactionService.broadcast.test.ts`, `broadcastLifecycle.test.ts`): **18 failures, 421 passed** (was 10 over the
  first four files before pass 1):
  - the original 10: the ≈2,230 vB parent at target 50 fails with `InvalidInputError: Fee rate must be between 0.1
    and 1000 sat/vB`; the padded parent overpays (`expected 46119 to be 1114`); the 1000.5 target and the Taproot
    script-path case fail on the message; the finalize check refuses the `cpfp` rate (`fee_too_high`); the fee-policy
    bound tests (base has no CPFP constant, so the ceiling + 1 case runs as NaN) and the service test fail on the 1000
    message or on the schema;
  - node broadcast limit (1): `expected 'Fee rate must be between 0.1 and 1000…' to match /exceeds 1…/vB, the node
    broadcast limit/`;
  - confirmed parent at build (3): `expected 'resolved' to be an instance of InvalidInputError` and twice `promise
    resolved … instead of rejecting`;
  - confirmed parent at broadcast (3): `expected 'resolved' to be an instance of PreNetworkBroadcastRejectionError`
    (twice) and `promise resolved … instead of rejecting`;
  - claim source (1): `expected { status: 'claimed', …(2) } to deeply equal { status: 'claimed', …(3) }`.
  - Guards that pass on base: the small-parent case, the mempool-parent broadcast and the non-CPFP/replay case.
- Server after review pass 2, `p22-a1-r2-red.txt`: the base source under the final tests, with `server/src` swapped
  to `f4d746f` in `$SCRATCH/p22-a1r2` and `cpfpParent.ts` removed. It covers the six files above plus
  `broadcastReconciliation.test.ts` and `tests/unit/repositories/transactionSigningIntentRepository.test.ts`, eight
  files in all. Result: **23 failures, 517 passed**, which is the 18 above plus five:
  - the 10,000 bound (R2-W2, 1): `InvalidInputError: Fee rate must be between 0.1 and 1000 sat/vB`;
  - the broadcast deadline (1): `expected 'resolved' to be an instance of PreNetworkBroadcastRejectionError`;
  - reconciliation withhold and lookup failure (2): `expected { examined: 1, completed: 1 } to deeply equal
    { examined: 1, completed: +0 }`;
  - repository withhold (1): `TypeError: markBroadcastWithheld is not a function`.
  - The tightened wallet-row broadcast test is one of the 18: on base it still fails because the broadcast resolves.
  - Guards that still pass on base: the two pass-2 reconciliation guards.
- Server after review pass 4, `p22-a1-r4-red.txt`: the same eight files and the same swap (`server/src` at
  `f4d746f`, `cpfpParent.ts` removed) in the fresh worktree `$SCRATCH/p22-r4`, with the pass-4 tests. Result:
  **24 failures, 517 passed (541)**, the 23 above plus one:
  - the smallest-signed-size window (R4-1, 1): `expected 'Fee rate must be between 0.1 and 1000…' to match /at its
    sm…/vB, the node broadcast limit/`.
  - On the pass-2 source (all six earlier patches) the same test fails because the child is issued: `expected { psbt:
    Psbt{ …(3) }, …(8) } to be an instance of InvalidInputError` (1 failed, 118 passed in `advancedTx.test.ts`). That
    is the R4-1 defect itself.
- Server after review pass 5, `p22-a1-r5-red.txt`: the same eight files and the same swap (`server/src` at `f4d746f`,
  `cpfpParent.ts` removed) in the fresh worktree `$SCRATCH/p22-r5`, with the pass-5 tests. Result: **26 failures, 517
  passed (543)**, the 24 above plus the two new `artifactValidation.test.ts` tests:
  - top of the authorized range (1): `InvalidInputError: Fee rate must be between 0.1 and 1000 sat/vB` (base ignores
    the bound argument);
  - finalizer refusal (1): `Error: Cannot find module '/src/services/bitcoin/advancedTx/cpfpParent'`, raised after the
    test's finalize-refusal and 549,999 assertions passed on base.
  - The two retargeted builder tests stay among the 24, now failing on `expected 'Fee rate must be between 0.1 and
    1000…' to match /…the PSBT finalizer limit/`.
- On the pass-4 source (`p22-a1-r5-red-on-r4.txt`; the four test files pass 5 touches, `server/src` at the pass-4
  state): **4 failures, 288 passed (292)**, each the R5-1 defect: the ≈25k vB builder test (`expected 'CPFP child fee
  rate 13044.55319148 sa…' to match /is not be…/vB, the PSBT finalizer limit/`), the window builder test (`expected
  { psbt: Psbt{ …(3) }, …(8) } to be an instance of InvalidInputError`: the child is issued), the authorization unit
  test (`maximumFeeRate` 10,000 where 5000 is expected), and "never authorizes a child that finalization refuses"
  (`expected [Function] to throw an error`). The top-of-range finalize test passes there (a guard on pass 4).
- On the pass-1 source (`p22-a1-r2-red-on-r1.txt`; the four test files pass 2 touches, `server/src` at the pass-1
  state): 5 failures, 236 passed. These are the five pass-2 behaviours, and each fails for the reason it should:
  - the wallet-row test: pass 1 calls `getNodeClient` first, and the harness's default client fails authentication,
    so it gets a 503 instead of a 409;
  - the deadline test: `expected 'pending' …` (pass 1 waits forever);
  - the two reconciliation reds and the repository red, with the messages above.
- Frontend, `p22-a1-fe-red.txt`: 1 failure (`expected false to be true`, the draft-mode case), 50 passed; the
  typed-rate guard passes. With the fix: 51 passed; the send, context and transaction-action suites pass (62 files,
  1010 tests).
- The implementer re-records both reds with the final tests before the fix. `cpfpParent.test.ts` cannot load on base
  and is not red evidence (D-22.X2).
- Green on `$SCRATCH/p22-a1r1` (the A1 prototype plus the pass-1 patch and the map delta): `npx tsc --noEmit` and
  `tsc -p tsconfig.test.full.json` clean; the Verification block's targeted backend run passes (175 files, 6162
  tests); `cpfpParent.test.ts` 19 and `advancedTx.test.ts` 118 pass; ESLint on the changed server source files is clean.
- Green on `$SCRATCH/p22-a1r2` (fresh worktree: A1 prototype, then pass 1, then pass 2): `npx tsc --noEmit` and
  `npm run typecheck:tests` are clean. The targeted backend run plus the repository test and `tests/unit/worker`
  passes (215 files, 6926 tests). ESLint (`config/tooling/eslint.config.js`) is clean on the four changed source
  files. `check:safety-catch-guards` (73), `check:bitcoin-network-boundaries`, `check:architecture-boundaries`,
  `check:server-cycle-baseline`, the signer inventory and `check-critical-mutation-config.mjs` all pass. Lizard is
  per D-22.X4.
- Green on `$SCRATCH/p22-r4` (fresh worktree of `$SCRATCH/p22`: the six earlier patches in order, then the pass-4
  increment): `npx tsc --noEmit` and `tsc -p tsconfig.test.full.json` are clean; `tests/unit/services/bitcoin`,
  `tests/unit/api/bitcoin` and `tests/unit/api/bitcoin.test.ts` pass (166 files, 5638 tests), among them
  `cpfpParent.test.ts` 25 (19 + the six `minimumSignedVsize` rows) and `advancedTx.test.ts` 119;
  `node --test tests/ci/check-wallet-safety-mutation-map.test.mjs` passes (13); ESLint is clean on `cpfp.ts` and
  `cpfpParent.ts`; lizard: `createCPFPTransaction` 142 NLOC / 20 CCN, no new warning in `cpfpParent.ts`. The new
  `minimumSignedVsize` mutants have not been through Stryker; the A1 worker's run (Verification step 2) is their first
  proof, under the same `cpfpParent.ts` minScore 75.
- Green on `$SCRATCH/p22-r5` (fresh worktree of `$SCRATCH/p22`: the seven earlier patches in order, then the pass-5
  increment; removed afterwards): `npx tsc --noEmit` and `npm run typecheck:tests` are clean; the targeted run
  (`tests/unit/services/bitcoin/advancedTx`, `advancedTx.test.ts`, `tests/unit/services/bitcoin/signingIntent`,
  `transactionService.broadcast.test.ts`, the repository test) passes, 17 files and 713 tests (the pass-5 reviewer's
  711 plus the two new finalize tests), among them `cpfpParent.test.ts` 25, `advancedTx.test.ts` 119,
  `artifactValidation.test.ts` 108; `node --test tests/ci/check-wallet-safety-mutation-map.test.mjs` passes (13); the
  map's `cpfpParent.ts` pins hold unchanged (`lineEnd` 177; canaries at 123:53-123:86 `Math.min(servedVsize,
  vsizeBound)` and 146:7-146:38 `parent.vsizeBound === undefined`); ESLint is clean on `cpfpParent.ts` and
  `types.ts`; lizard on the six changed files: no warning added (`artifactValidation.test.ts` 1 → 0, the others 0 → 0);
  `cpfp.ts` and `feePolicy.ts` are not touched, so `createCPFPTransaction` stays 142 / 20 and the `fee-surplus` re-pin
  holds. The changed `>=` condition has not been through Stryker; the A1 worker's run (Verification step 2) proves it,
  and the 469,999/470,000 unit pair kills its `>` mutant.

**Acceptance.**
- `tests/unit/services/bitcoin`, the bitcoin and transaction API suites, payjoin suites and `tests/contexts` pass.
- A CPFP is refused for a mined parent at build (400, field `parentTxid`) and at broadcast (409
  `cpfp_parent_confirmed`; 503 `cpfp_parent_status_unavailable` when the lookup fails or exceeds 20 s), before
  anything reaches the network; reconciliation withholds (lookup-only) a `cpfp` child whose own lookup missed and whose
  parent is mined, and leaves it `unknown`, uncounted, when the parent lookup fails; no CPFP child is issued whose fee
  is not below 5000 sat/vB (`CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT`, bitcoinjs-lib's finalizer limit) of the smallest
  vsize it can have once signed (`minimumSignedVsize`), and a child at the top of that range signs and finalizes.
- The fee-policy Stryker profile passes its break threshold, and the filtered map check for `serverFeePolicy` and
  `serverTaprootArtifactFinalization` passes (every canary present and `Killed` by its named test), with
  `cpfpParent.ts` ≥ 75.
- Signer inventory, critical-mutation config, safety-catch and network-boundary checks pass; lizard per D-22.X4.

## Phase C1 — Full Browser E2E refuses an unassigned spec

**Finding.** `ci-classifier--browser-e2e-group-guard-not-triggered-by-new-specs` (P2).

**Evidence (base).**
- `scripts/ci/run-browser-e2e-subject.sh:82-98` runs Playwright only for the specs `browser-e2e-groups.sh` lists per
  group; the lists are hand-kept (`browser-e2e-groups.sh:18-57`, 18 specs plus the render spec in `tests/e2e`), and
  `check_groups` (`:82-105`) is the only reconciliation with `tests/e2e/*.spec.ts`.
- The check runs only from `tests/ci/browser-e2e-groups.test.sh` in `quality.yml` `ci-classifier-tests`
  (`.github/workflows/quality.yml:920`). `is_ci_classifier_file` (`scripts/ci/classify-quality-scope.sh:108-156`) has
  no `tests/e2e/*` entry, so a spec-only PR does not select that job; it does select Full Browser E2E
  (`classify-files-lib.sh:283-295`), which passes without running the new spec.
- Historical occurrence: #1008 (`525369c8a`) added `tests/e2e/node-status-card-responsive.spec.ts` with no group
  and merged green; #1010 (`fb0c7607c`) registered it later. Scheduled quality runs (`classify-quality-scope.sh:37-40`)
  catch an orphan only after the merge.
- The sibling integration guard runs in its own lane: `backend-docker-test.sh:56`.

**Change** (OQ-C1).
- `scripts/ci/run-browser-e2e-subject.sh`: after the `SANCTUARY_CLEANUP_COORDINATED` guard (`:8-11`) and before
  `api_port` and the backend start (`:13`, `:44-49`), run `"$SCRIPT_DIR/browser-e2e-groups.sh" --check` with a
  two-line comment. `set -e` makes a failed check end the subject before the backend exists; the EXIT trap then has
  no backend to mark terminal.
- `tests/ci/browser-e2e-groups.test.sh`: `run_subject_fixture` builds a fixture checkout (the two scripts, an empty
  file for every assigned spec plus extra specs, a stub `node` that records `backend-started` and exits 1) and runs the
  subject with `SANCTUARY_CLEANUP_COORDINATED=1 BROWSER_E2E_API_PORT=1`; `assert_subject_refuses_unassigned_spec`
  asserts the orphan run fails, reports "Missing browser E2E group assignments:" and the spec path, and never starts
  the backend, and that a complete fixture including `tests/e2e/render-regression.spec.ts` reaches the backend start.
  The fixture root is a `mktemp -d` removed by an EXIT trap.
- `config/resource-lifecycle-callsites.json`: one entry after `tests/ci/backend-docker-test.test.mjs`
  (`:1692-1697`), in the same format: `path` `tests/ci/browser-e2e-groups.test.sh`, `resourceClass`
  `temporary_artifact`, `operation` `cleanup`, `disposition` `exempt`, the standard private-fixture `safetyContract`.
  Without it `node scripts/ownership/check-lifecycle-callsites.mjs` flags the new `rm -rf`.
- `docs/reference/ci-cd-strategy.md`, after the `--check` block (`:577-580`): Full Browser E2E runs the same check
  before it starts the backend, so an unassigned spec fails the lane; every top-level spec change selects that lane,
  and a spec-only change does not select `CI classifier tests`.
- Lane selection for this PR: `run-browser-e2e-subject.sh` is test-lane infrastructure
  (`classify-files-lib.sh:481`, `:520`), so the PR runs the full test scan, including Full Browser E2E with the new
  check; `scripts/ci/*`, `tests/ci/*` and the lifecycle registry select `ci-classifier-tests`
  (`classify-quality-scope.sh:110`).

**Tests.** `tests/ci/browser-e2e-groups.test.sh` gains `assert_subject_refuses_unassigned_spec` (above).

**Red (observed).** `p22-c1-red.txt`: on base the suite prints "Browser E2E group coverage is complete." for the repo,
then fails with `FAIL: subject did not report the unassigned spec:` and exit 1. The base subject never runs the check;
its first `node` call (the start token, `:44`) hits the stub, which records `backend-started` and exits 1, so the log
is empty. On head: "browser E2E group regression checks passed", and `check-lifecycle-callsites.mjs` reports the
registry complete (417 identities).

**Acceptance.** `browser-e2e-groups.test.sh`, `ci-registration-completeness.test.sh`, the classifier, plan and
workflow-composition suites pass; `browser-e2e-groups.sh --check` passes on the repo; the lifecycle registry check
passes.

## Implementation log (coordinator)

- Phase worktrees were created from the converged plan commit `717956c3d`; each phase commit was cherry-picked with
  `-x`, proven upstream with `git cherry`, and its worktree and branch removed:

  | Phase | Integrated as | Worker commit |
  |---|---|---|
  | A1 | `afc459c38` | `8cc352804` |
  | C1 | `e3c5ab65f` | `3f342a57a` |
- Reds on base, for the stated reasons: A1 server 26 failed / 517 passed (`$SCRATCH/i22-a1-red.txt`), frontend 1 of
  51 (`i22-a1-fe-red.txt`); C1 "FAIL: subject did not report the unassigned spec" (`i22-c1-red.txt`). A1 applied the
  seven prototype patches in the plan's order (A1, r1, r2, map delta, frontend, r4, r5) and the r3 boundary tests.
- `/simplify` (three reviewers) → `4da5344f7`: the confirmed-parent helpers moved to a new neutral module
  `server/src/services/bitcoin/parentConfirmation.ts` (re-exported from `advancedTx/shared.ts`) because
  `transactions/helpers.ts:11` warns that importing `advancedTx/shared` from the transactions layer closes a runtime
  cycle (scope 33 → 34; cycle baseline, boundaries and `arch:check` pass); one `CPFP_PARENT_CONFIRMED_MESSAGE`,
  `cpfpParentTxids`, `parseSigningIntentSource`; exported `assertRequestedFeeRate` (same-line); one
  `BROADCAST_LEASE_MS` in `signingIntent/types.ts` with the lookup deadline derived from it; each reconcile row's lease
  measured from its own claim time (new test); a shared `releaseToUnknown` builder; `!isP2sh(prevoutScript)` instead
  of the identity check and a trailing comment on the multisig dummy, both same-line so the pins hold (cpfpParent.ts
  199 lines, lines 123/146 byte-identical; feePolicy.ts 157-164 unchanged). Skipped: typing the two broadcast reasons
  (`broadcastContracts.ts` is outside scope), shifting edits inside pinned ranges, address-query batching, lookup
  cancellation (no resource is freed).
- Adversarial implementation review (security reviewer, `$SCRATCH/i22-adversarial.json`): no P0–P2. Three P3s,
  fixed test-first in `fd492264b` (reds `$SCRATCH/i22-adv-red.txt`):
  - `spentProgram` treated the last push of any P2SH scriptSig as a witness program; BIP141 counts it only for a
    scriptSig that is exactly one push of the program. A legacy P2SH spend now gets a witness bound of 0 (consensus
    requires an empty witness), so a padded served witness cannot inflate the parent (red: measured 526 vs true 118).
    Same-line edit: cpfpParent.ts from line 57 on is byte-identical, pins unchanged, map test 13/13.
  - `browser-e2e-groups.sh --check` looked only at top-level `*.spec.ts`; it now discovers specs as Playwright does
    (recursive under tests/e2e, the default testMatch, render spec excluded by path) and fails loudly if the
    Playwright config ever sets testMatch/testIgnore. This adds `scripts/ci/browser-e2e-groups.sh` to the scope
    (35 files) and removes it from the pinned-surface list.
  - A CPFP claim not taken from `ready` now looks up the child first (`assertTransactionKnownToNode`, same deadline);
    a child the node already serves is marked accepted instead of refused with 409 when it was mined with its parent.
  - Confirmed: the fee bound is exact for P2WPKH, P2WSH, P2PKH and Taproot key-path children; forged or hidden
    witnesses can only make the child underpay; the 5000 finalizer check rounds correctly; no non-CPFP source can
    obtain the raised cap and the cap is consistent at prepare, schema, finalize and broadcast; a withheld row is
    never re-sent automatically; the frontend skip cannot sign a non-CPFP high-fee draft; no runtime import cycle from
    `parentConfirmation.ts` (dependency-cruiser, 181 modules).

## Verification (before every push)

The integrator runs this block on the integrated branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i22`,
after the two phase commits and the integrator commit, as `bash "$SCRATCH/i22-verify.sh"`, **regenerated from this
plan's `bash` fence immediately before each run** (R4-3). Any existing `$SCRATCH/i22-verify.sh` may be stale (a pass-1
copy with a 29-file scope once sat there); never run a copy that was not extracted in the same step:

```sh
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
PLAN=/home/nekoguntai/sanctuary-bug-scrub-20261013-i22/tasks/bug-scrub-loop-20261013-iteration22.md
awk '/^## Verification/{f=1} f&&/^```bash$/&&!d{n++; if(n==1){p=1;next}} p&&/^```$/{p=0;d=1} p' "$PLAN" > "$SCRATCH/i22-verify.sh"
bash -n "$SCRATCH/i22-verify.sh"
bash "$SCRATCH/i22-verify.sh"
```

The `awk` takes the first `bash` fence after the `## Verification` heading (this `sh` fence does not match) up to its
closing fence.

**Before the block**, in this order:
1. Each phase worker re-records its red on base before its fix, with the final tests, into
   `$SCRATCH/i22-a1-red.txt`, `$SCRATCH/i22-a1-fe-red.txt` and `$SCRATCH/i22-c1-red.txt`. A1 server expects the
   pass-5 prototype's 26 failures (`p22-a1-r5-red.txt`) over the eight files of Phase A1 "Red" (the new
   `cpfpParent.test.ts` cases are not run on base); A1 frontend expects 1; C1 expects the "did not report the unassigned spec" failure. A different reason is
   a stop.
2. The A1 worker runs `npm --prefix server run test:mutation:fee-policy` on its final commit (about 6 minutes) and
   pins the two new canaries and the `fee-surplus` re-pin from `server/reports/mutation/fee-policy.json`.
3. Then, on the integrated branch, run `npm run arch:graphs` and `npm run arch:calls` (in this checkout, whose
   `node_modules` is a real directory) and commit any change to `docs/architecture/generated` in the integrator
   commit. Expected: the `cpfpParent.ts` node and its edges, the pass-1 edges and the pass-2 edges:
   - `advancedTx/shared.ts` → `repositories`, `../utils`, `../nodeClient` (now a value import), `../networks`,
     `utils/async` (its `../nodeTransactionAuthentication` re-export edge already exists);
   - `transactions/broadcasting.ts` → `../advancedTx/shared` only (pass 2 drops pass 1's `../nodeClient` edge);
   - `signingIntent/broadcastReconciliation.ts` → `../advancedTx/shared` (new in pass 2).

   Any other change is a stop to investigate.

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i22
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i22
test "$(npm --version | cut -d. -f1)" = 12
test -d node_modules
test ! -L node_modules
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"
BASE=bd215520df0cee8ba72903f0d0b4281072fe7676
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
LZ_BASE_DIR=""
cleanup() {
  if [ -n "$LZ_BASE_DIR" ]; then git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true; git worktree prune; fi
}
trap cleanup EXIT
wait_for_no_coverage() {
  for _ in $(seq 1 180); do
    if ! pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage' >/dev/null && ! pgrep -f '[n]ode_modules/.bin/stryker run' >/dev/null; then
      return 0
    fi
    sleep 10
  done
  echo "coverage guard: another coverage or Stryker run still active after 30 min" >&2
  return 1
}
npm run build --workspace=shared
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )
# targeted backend: CPFP, advancedTx, signing intents (services/bitcoin), bitcoin and transaction APIs, payjoin
( cd server && npx vitest run tests/unit/services/bitcoin tests/unit/api/bitcoin tests/unit/api/bitcoin.test.ts \
  tests/unit/api/transactions-http-routes.test.ts tests/unit/api/transactionsSigningIntentBroadcast.test.ts \
  tests/unit/api/transactionsSigningIntentBroadcast.replacement.test.ts tests/unit/api/transactionsSigningIntentBroadcast.retry.test.ts \
  tests/unit/api/payjoin.test.ts tests/unit/services/payjoinService.test.ts tests/unit/services/payjoinService \
  tests/unit/repositories/transactionSigningIntentRepository.test.ts tests/unit/worker )
npm run check:safety-catch-guards
npm run check:bitcoin-network-boundaries
node scripts/generate-signer-inventory.mjs --check
node scripts/ci/check-critical-mutation-config.mjs
node --test tests/ci/check-wallet-safety-mutation-map.test.mjs tests/ci/check-critical-mutation-config.test.mjs
# A1 mutation proofs: the fee-policy profile (about 6 min locally; CI runs it in verify-vectors-mutation-fee) and
# the taproot-artifact-finalization profile (artifactValidation.ts), then the map check for those two profiles
wait_for_no_coverage || exit 1
npm --prefix server run test:mutation:fee-policy
npm --prefix server run test:mutation:taproot-artifact-finalization
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { validateMutationEvidence } from './scripts/ci/check-wallet-safety-mutation-map.mjs';
const map = JSON.parse(readFileSync('config/wallet-safety-mutation-map.json', 'utf8'));
for (const id of ['serverFeePolicy', 'serverTaprootArtifactFinalization']) {
  const profile = map.profiles.find(p => p.id === id);
  validateMutationEvidence({ ...map, profiles: [profile] }, new Map([[id, JSON.parse(readFileSync(profile.reportPath, 'utf8'))]]));
  console.log(id + ': canaries present and killed by their named tests');
}"
# the map edit stays inside serverFeePolicy: every other profile is unchanged, and exactly the two new invariants are added
diff <(git show "$BASE:config/wallet-safety-mutation-map.json" | jq -S '[.profiles[] | select(.id != "serverFeePolicy")]') \
  <(jq -S '[.profiles[] | select(.id != "serverFeePolicy")]' config/wallet-safety-mutation-map.json)
test "$(comm -13 <(git show "$BASE:config/wallet-safety-mutation-map.json" | jq -r '.profiles[] | select(.id == "serverFeePolicy") | .invariants[].id' | sort) \
  <(jq -r '.profiles[] | select(.id == "serverFeePolicy") | .invariants[].id' config/wallet-safety-mutation-map.json | sort) | tr '\n' ' ')" \
  = 'cpfp-child-rate-above-cap-requires-a-bounded-parent cpfp-parent-vsize-is-capped-by-its-authenticated-bound '
jq -e '.profiles[] | select(.id == "serverFeePolicy") | .files[] | select(.path == "src/services/bitcoin/advancedTx/cpfpParent.ts" and .minScore == 75)' config/wallet-safety-mutation-map.json >/dev/null
grep -qF "'src/services/bitcoin/advancedTx/cpfp.ts:38-70'," server/stryker.fee-policy.config.mjs
grep -qF "'src/services/bitcoin/advancedTx/cpfpParent.ts'," server/stryker.fee-policy.config.mjs
grep -qF "'tests/unit/services/bitcoin/advancedTx/cpfpParent.test.ts'," server/stryker.fee-policy.config.mjs
# the second canary is the unbounded-parent branch, killed by its unit test (pass 1)
jq -e '.profiles[] | select(.id == "serverFeePolicy") | .invariants[] | select(.id == "cpfp-child-rate-above-cap-requires-a-bounded-parent")
  | .canaries[0] | select(.mutatorName == "ConditionalExpression" and .replacement == "false"
  and .requiredKillingTest.name == "CPFP child fee-rate authorization keeps the per-transaction cap for an unbounded parent")' \
  config/wallet-safety-mutation-map.json >/dev/null
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # scoped to tests/unit as CI
wait_for_no_coverage || exit 1
npm run test:coverage   # frontend, 100% threshold (stepValidation.ts)
# C1 and CI shell suites
bash -n scripts/ci/run-browser-e2e-subject.sh
bash scripts/ci/browser-e2e-groups.sh --check
bash tests/ci/browser-e2e-groups.test.sh
bash tests/ci/ci-registration-completeness.test.sh
bash tests/ci/classify-quality-scope.test.sh
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/plan-test-run.test.sh
bash tests/ci/check-workflow-composition.test.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci
# the group check runs after the coordinator guard and before the backend start
CHECK_LINE="$(grep -nF '"$SCRIPT_DIR/browser-e2e-groups.sh" --check' scripts/ci/run-browser-e2e-subject.sh | cut -d: -f1)"
GUARD_LINE="$(grep -nF 'SANCTUARY_CLEANUP_COORDINATED' scripts/ci/run-browser-e2e-subject.sh | head -n 1 | cut -d: -f1)"
COPROC_LINE="$(grep -nF 'coproc SANCTUARY_BACKEND' scripts/ci/run-browser-e2e-subject.sh | cut -d: -f1)"
test -n "$CHECK_LINE"
test "$GUARD_LINE" -lt "$CHECK_LINE"
test "$CHECK_LINE" -lt "$COPROC_LINE"
# lifecycle registry (the checker skips untracked files: everything it reads must be committed)
test -z "$(git status --porcelain --untracked-files=all -- tests/ci config scripts)"
node scripts/ownership/check-lifecycle-callsites.mjs
# pinned surfaces (D-22.X3) and scope
PINNED_SURFACES=(
  'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation .github/mutation-baseline.json
  config/wallet-sync-mutation-boundaries.json config/wallet-sync-lifecycle-contract.json config/wallet-safety-critical-paths.json
  config/hardware-wallet-implementation-inventory.json server/prisma
  scripts/verify-addresses scripts/perf shared .github/workflows .nvmrc server/src/services/accessControl.ts
  'scripts/ci/classify-*'
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}" ':(exclude)server/stryker.fee-policy.config.mjs')"
# the allowlist change is exactly the removal of broadcastAndSave's two non-terminal catches (moved into the
# value-returning persistFailureTransition helper, which needs no entry)
test "$(git diff "$BASE" HEAD -- scripts/quality/safety-catch-allowlist.json | grep -c '^+[^+]')" -eq 0
git diff "$BASE" HEAD -- scripts/quality/safety-catch-allowlist.json | grep -qF -e '-      "functionName": "broadcastAndSave",'
test "$(git diff --name-only "$BASE" HEAD -- config/wallet-safety-mutation-map.json server/stryker.fee-policy.config.mjs \
  config/resource-lifecycle-callsites.json | LC_ALL=C sort | tr '\n' ' ')" \
  = 'config/resource-lifecycle-callsites.json config/wallet-safety-mutation-map.json server/stryker.fee-policy.config.mjs '
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts
EXPECTED_FILES="$(LC_ALL=C sort <<'EOF'
config/resource-lifecycle-callsites.json
config/wallet-safety-mutation-map.json
docs/reference/changelog.md
docs/reference/ci-cd-strategy.md
scripts/ci/browser-e2e-groups.sh
scripts/ci/run-browser-e2e-subject.sh
scripts/quality/safety-catch-allowlist.json
server/src/repositories/transactionSigningIntentRepository.ts
server/src/services/bitcoin/advancedTx/cpfp.ts
server/src/services/bitcoin/advancedTx/cpfpParent.ts
server/src/services/bitcoin/advancedTx/rbf.ts
server/src/services/bitcoin/advancedTx/shared.ts
server/src/services/bitcoin/parentConfirmation.ts
server/src/services/bitcoin/signingIntent/artifactValidation.ts
server/src/services/bitcoin/signingIntent/broadcastLifecycle.ts
server/src/services/bitcoin/signingIntent/broadcastReconciliation.ts
server/src/services/bitcoin/signingIntent/feePolicy.ts
server/src/services/bitcoin/signingIntent/schema.ts
server/src/services/bitcoin/signingIntent/service.ts
server/src/services/bitcoin/signingIntent/types.ts
server/src/services/bitcoin/transactions/broadcasting.ts
server/stryker.fee-policy.config.mjs
server/tests/unit/repositories/transactionSigningIntentRepository.test.ts
server/tests/unit/services/bitcoin/advancedTx.test.ts
server/tests/unit/services/bitcoin/advancedTx/advancedTx.cpfp-package-cap.contracts.ts
server/tests/unit/services/bitcoin/advancedTx/cpfpParent.test.ts
server/tests/unit/services/bitcoin/signingIntent/artifactValidation.test.ts
server/tests/unit/services/bitcoin/signingIntent/broadcastLifecycle.test.ts
server/tests/unit/services/bitcoin/signingIntent/broadcastReconciliation.test.ts
server/tests/unit/services/bitcoin/signingIntent/feePolicy.test.ts
server/tests/unit/services/bitcoin/signingIntent/service.test.ts
server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.contracts.ts
server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.cpfp-parent.contracts.ts
src/contexts/send/stepValidation.ts
tests/ci/browser-e2e-groups.test.sh
tests/contexts/stepValidation.test.ts
EOF
)"
test "$(printf '%s\n' "$EXPECTED_FILES" | wc -l)" -eq 36   # A1 28 + parentConfirmation.ts (/simplify) + safety-catch-allowlist.json (complexity refactor), C1 4 + browser-e2e-groups.sh (adversarial review), plus the changelog
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' ':(exclude)docs/architecture/generated' | LC_ALL=C sort)"
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# shape checks
grep -qF 'measureCpfpParent(client, parentTx.transaction)' server/src/services/bitcoin/advancedTx/cpfp.ts
grep -qF 'authorizeCpfpChildFeeRate(' server/src/services/bitcoin/advancedTx/cpfp.ts
# the child fee stays strictly below the PSBT finalizer limit at the smallest signed child vsize (R4-1, R5-1)
CPFP_PARENT_TS=server/src/services/bitcoin/advancedTx/cpfpParent.ts
grep -qF 'if (childFee >= CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT * child.minimumSignedVsize) {' "$CPFP_PARENT_TS"
if grep -qF 'childFee > SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE' "$CPFP_PARENT_TS"; then
  echo "the child bound still uses the 10,000 sat/vB node limit (R5-1)" >&2; exit 1
fi
# option (a): both bitcoinjs extractTransaction() call sites keep the library's default fee check
grep -qF 'return candidate.extractTransaction();' server/src/services/bitcoin/signingIntent/artifactValidation.ts
grep -qF 'const expected = finalPsbt.extractTransaction();' src/services/hardwareWallet/adapters/trezor/signPsbtValidation.ts
grep -qF 'const MIN_ECDSA_SIGNATURE_BYTES = 9;' "$CPFP_PARENT_TS"
grep -qF 'const MIN_SCHNORR_SIGNATURE_BYTES = 64;' "$CPFP_PARENT_TS"
grep -qF 'export const minimumSignedVsize = (spendPolicy: SpendPolicy, maximumWeight: number): number => {' "$CPFP_PARENT_TS"
grep -qF 'minimumSignedVsize(evidence.spendPolicy, childWeight)' server/src/services/bitcoin/advancedTx/cpfp.ts
if grep -qF 'feeRate > SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE' "$CPFP_PARENT_TS"; then
  echo "the node-limit check still compares the rate over the maximum child size" >&2; exit 1
fi
# confirmed-parent refusal at build (before any fee math) and at broadcast (pass 1)
# the refusal message is one constant in the neutral parentConfirmation.ts, thrown by the builder and the broadcast check
PARENT_CONF=server/src/services/bitcoin/parentConfirmation.ts
grep -qF "export const CPFP_PARENT_CONFIRMED_MESSAGE = 'Parent transaction is already confirmed; CPFP is not needed';" "$PARENT_CONF"
grep -qF "throw new InvalidInputError(CPFP_PARENT_CONFIRMED_MESSAGE, 'parentTxid');" server/src/services/bitcoin/advancedTx/cpfp.ts
grep -qF 'throw new ConflictError(CPFP_PARENT_CONFIRMED_MESSAGE, undefined, {' server/src/services/bitcoin/transactions/broadcasting.ts
CONFIRM_LINE="$(grep -nF 'isTransactionConfirmed(client, parentTxid, parentTx.canonicalHex' server/src/services/bitcoin/advancedTx/cpfp.ts | cut -d: -f1)"
MEASURE_LINE="$(grep -nF 'measureCpfpParent(client, parentTx.transaction)' server/src/services/bitcoin/advancedTx/cpfp.ts | cut -d: -f1)"
test -n "$CONFIRM_LINE"
test "$CONFIRM_LINE" -lt "$MEASURE_LINE"
grep -qF 'export async function isTransactionConfirmed(' "$PARENT_CONF"
grep -qF "export { CPFP_PARENT_CONFIRMED_MESSAGE, isTransactionConfirmed } from '../parentConfirmation';" server/src/services/bitcoin/advancedTx/shared.ts
grep -qF 'isTransactionConfirmed(client, txid, txDetails.hex, network, walletId)' server/src/services/bitcoin/advancedTx/rbf.ts
if grep -rqF 'isOriginalConfirmed' server/src; then echo "isOriginalConfirmed still defined or called" >&2; exit 1; fi
diff <(git show "$BASE:server/src/services/bitcoin/advancedTx/rbf.ts" | sed -n 232,242p) <(sed -n 232,242p server/src/services/bitcoin/advancedTx/rbf.ts)
grep -qF "source: parseSigningIntentSource(result.record.source)" server/src/services/bitcoin/signingIntent/broadcastLifecycle.ts
grep -qF "if (claim.source === 'cpfp') await assertCpfpParentUnconfirmed(artifact);" server/src/services/bitcoin/transactions/broadcasting.ts
grep -qF "reason: 'cpfp_parent_confirmed'" server/src/services/bitcoin/transactions/broadcasting.ts
grep -qF "reason: 'cpfp_parent_status_unavailable'" server/src/services/bitcoin/transactions/broadcasting.ts
# one shared, deadline-bounded parent check for broadcast and reconciliation, wallet rows before the node (pass 2)
# the deadline is derived from the one broadcast lease (20 s inside 60 s), not a second literal
grep -qF 'export const BROADCAST_LEASE_MS = 60_000;' server/src/services/bitcoin/signingIntent/types.ts
grep -qF 'export const CPFP_PARENT_LOOKUP_DEADLINE_MS = Math.floor(BROADCAST_LEASE_MS / 3);' "$PARENT_CONF"
if grep -rnE '(LEASE_MS|BROADCAST_LEASE_MS) = 60_000' server/src --include='*.ts' \
  | grep -v '^server/src/services/bitcoin/signingIntent/types.ts:' | grep -q .; then
  echo "a second broadcast lease literal is defined outside signingIntent/types.ts" >&2; exit 1
fi
grep -qF 'export async function isCpfpChildParentConfirmed(' "$PARENT_CONF"
grep -qF 'export async function assertTransactionKnownToNode(' "$PARENT_CONF"
test "$(grep -cF 'CPFP_PARENT_LOOKUP_DEADLINE_MS,' "$PARENT_CONF")" -ge 1
test "$(grep -cF 'withTimeout(' "$PARENT_CONF")" -eq 2
ROW_LINE="$(grep -nF 'if (await isConfirmedInWalletRow(txid, walletId)) return true;' "$PARENT_CONF" | cut -d: -f1)"
NODE_LINE="$(grep -nF 'const client = await getNodeClient(network);' "$PARENT_CONF" | cut -d: -f1)"
test -n "$ROW_LINE"
test -n "$NODE_LINE"
test "$ROW_LINE" -lt "$NODE_LINE"
grep -qF 'await isCpfpChildParentConfirmed(inputs, artifact.network, artifact.walletId)' server/src/services/bitcoin/transactions/broadcasting.ts
if grep -qE 'getNodeClient|isTransactionConfirmed' server/src/services/bitcoin/transactions/broadcasting.ts; then
  echo "broadcasting.ts looks the parent up outside the shared helper" >&2; exit 1
fi
test "$(grep -rlF 'isCpfpChildParentConfirmed(' server/src --include='*.ts' | LC_ALL=C sort | tr '\n' ' ')" \
  = 'server/src/services/bitcoin/parentConfirmation.ts server/src/services/bitcoin/signingIntent/broadcastReconciliation.ts server/src/services/bitcoin/transactions/broadcasting.ts '
# reconciliation withholds a cpfp child whose own lookup missed, before the re-submission, with no new catch (A1-R2-1)
RECON=server/src/services/bitcoin/signingIntent/broadcastReconciliation.ts
# (after /simplify the withholding lives in withholdConfirmedCpfpChild; the ordering uses its one call site)
grep -qF "if (parseSigningIntentSource(record.source) !== 'cpfp'" "$RECON"
grep -qF '|| !await isCpfpChildParentConfirmed(inputs, network, record.walletId)) {' "$RECON"
test "$(grep -cF 'await withholdConfirmedCpfpChild(' "$RECON")" -eq 1
grep -qF 'transactionSigningIntentRepository.markBroadcastWithheld(record.id, leaseToken, CPFP_PARENT_CONFIRMED_ERROR)' "$RECON"
LOOKUP_LINE="$(grep -nF 'await getTransactionDetails(record.broadcastTxid, record.network)' "$RECON" | head -n 1 | cut -d: -f1)"
WITHHOLD_LINE="$(grep -nF 'if (await withholdConfirmedCpfpChild(record, record.network, snapshot.data.transaction.inputs, leaseToken)) return false;' "$RECON" | cut -d: -f1)"
RESUBMIT_LINE="$(grep -nF 'await broadcastAuthenticatedRawTransaction({' "$RECON" | cut -d: -f1)"
test -n "$LOOKUP_LINE"
test -n "$WITHHOLD_LINE"
test -n "$RESUBMIT_LINE"
test "$LOOKUP_LINE" -lt "$WITHHOLD_LINE"
test "$WITHHOLD_LINE" -lt "$RESUBMIT_LINE"
# the helper adds no catch: a failed parent lookup still throws to reconcileUncertain's existing catch
test "$(grep -c 'catch (' "$RECON")" -eq "$(git show "$BASE:$RECON" | grep -c 'catch (')"
grep -qF 'leaseExpiresAt: new Date(Date.now() + BROADCAST_LEASE_MS),' "$RECON"
grep -qF 'export const markBroadcastWithheld = (' server/src/repositories/transactionSigningIntentRepository.ts
grep -qF 'broadcastAttemptCount: MAX_RECONCILE_ATTEMPTS,' server/src/repositories/transactionSigningIntentRepository.ts
# the pre-network checks run after the claim and before the network broadcast
CLAIM_LINE="$(grep -nF 'claim = await claimSigningIntentBroadcast(' server/src/services/bitcoin/transactions/broadcasting.ts | cut -d: -f1)"
PRECHECK_LINE="$(grep -nF 'await assertPreNetworkChecks(artifact, metadata, claim);' server/src/services/bitcoin/transactions/broadcasting.ts | cut -d: -f1)"
SEND_LINE="$(grep -nF ': await broadcastTransaction(artifact, claim.priorState === '"'ready'"');' server/src/services/bitcoin/transactions/broadcasting.ts | cut -d: -f1)"
# fd492264b: only a cpfp retry not taken from `ready` may skip the checks, and only when the node serves the child
grep -qF "if (claim.source !== 'cpfp' || claim.priorState === 'ready') return false;" server/src/services/bitcoin/transactions/broadcasting.ts
grep -qF 'await assertTransactionKnownToNode(artifact.txid, artifact.network);' server/src/services/bitcoin/transactions/broadcasting.ts
KNOWN_LINE="$(grep -nF 'const childKnown = await isRetriedCpfpChildKnown(artifact, claim);' server/src/services/bitcoin/transactions/broadcasting.ts | cut -d: -f1)"
grep -qF 'if (!childKnown) await assertPreNetworkChecks(artifact, metadata, claim);' server/src/services/bitcoin/transactions/broadcasting.ts
test -n "$KNOWN_LINE"
test "$KNOWN_LINE" -gt "$CLAIM_LINE"
test "$KNOWN_LINE" -lt "$PRECHECK_LINE"
test -n "$CLAIM_LINE"
test -n "$PRECHECK_LINE"
test -n "$SEND_LINE"
test "$CLAIM_LINE" -lt "$PRECHECK_LINE"
test "$PRECHECK_LINE" -lt "$SEND_LINE"
# only the CPFP builder raises the fee-rate cap of buildSigningIntentFeePolicy (A1-R1-5)
test "$(grep -rlE 'maximumFeeRate|SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE' server/src --include='*.ts' \
  | grep -v '^server/src/services/bitcoin/signingIntent/' | LC_ALL=C sort | tr '\n' ' ')" \
  = 'server/src/services/bitcoin/advancedTx/cpfp.ts server/src/services/bitcoin/advancedTx/cpfpParent.ts '
grep -qF 'childRate.maximumFeeRate,' server/src/services/bitcoin/advancedTx/cpfp.ts
# `! grep` would be exempt from set -e, so the negative checks are explicit ifs
if grep -qF 'parentTx.transaction.virtualSize()' server/src/services/bitcoin/advancedTx/cpfp.ts; then
  echo "cpfp.ts still prices the parent at its served vsize" >&2; exit 1
fi
diff <(git show "$BASE:server/src/services/bitcoin/advancedTx/cpfp.ts" | sed -n 38,70p) <(sed -n 38,70p server/src/services/bitcoin/advancedTx/cpfp.ts)
grep -qF "source === 'cpfp' ? SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE : SIGNING_INTENT_MAX_FEE_RATE" server/src/services/bitcoin/signingIntent/types.ts
grep -qF 'export const CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT = 5000;' server/src/services/bitcoin/signingIntent/types.ts
grep -qF 'export const SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE = CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT;' server/src/services/bitcoin/signingIntent/types.ts
grep -qF 'at most this' server/src/services/bitcoin/signingIntent/types.ts
if grep -rqF 'MAX_STANDARD_TX_VSIZE' server/src; then echo "the 100k vB parent gate is dropped (OQ-A1 item 5)" >&2; exit 1; fi
grep -qF '.max(SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE)' server/src/services/bitcoin/signingIntent/schema.ts
grep -qF 'maximumSigningIntentFeeRate(input.source)' server/src/services/bitcoin/signingIntent/service.ts
grep -qF 'maximumSigningIntentFeeRate(source)' server/src/services/bitcoin/signingIntent/artifactValidation.ts
test "$(wc -l < server/src/services/bitcoin/signingIntent/artifactValidation.ts)" -eq "$(git show "$BASE:server/src/services/bitcoin/signingIntent/artifactValidation.ts" | wc -l)"
grep -qE 'state\.isDraftMode \|\| state\.feeRate <= MOBILE_API_REQUEST_LIMITS\.maxFeeRate' src/contexts/send/stepValidation.ts
UNRELEASED="$(awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' docs/reference/changelog.md | tr '\n' ' ' | tr -s ' ')"
test -n "$UNRELEASED"
for phrase in 'large low-fee parent' 'still capped at 1000 sat/vB' 'below 5000 sat/vB' 'refused when its parent is already confirmed' \
  'never re-submitted' 'padded witness' \
  'not assigned to a browser E2E group'; do
  grep -qF "$phrase" <<<"$UNRELEASED" || { echo "changelog [Unreleased] missing: $phrase" >&2; exit 1; }
done
# frontend and repo-wide typechecks and tests
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npm run test:run
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i22-lizard.txt"
LZ_BASE_DIR="$SCRATCH/i22-lizard-base"
git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true
git worktree prune
git worktree add -q --detach "$LZ_BASE_DIR" "$BASE"
( cd "$LZ_BASE_DIR" && LIZARD_BIN="$PINNED_LIZARD" bash scripts/quality/lizard-only.sh ) >"$SCRATCH/i22-lizard-base.txt" 2>&1
LZ_BASE_TOTAL="$(grep -c ': warning:' "$SCRATCH/i22-lizard-base.txt")"
test "$LZ_BASE_TOTAL" -gt 0
test "$(grep -c ': warning:' "$SCRATCH/i22-lizard.txt")" -le "$LZ_BASE_TOTAL"
mapfile -t LZ_CHANGED < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- '*.ts' '*.tsx')
for f in "${LZ_CHANGED[@]}"; do
  test -f "$f"
  head_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$f" | grep -c ': warning:' || true)"
  base_n=0
  if [ -f "$LZ_BASE_DIR/$f" ]; then base_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$LZ_BASE_DIR/$f" | grep -c ': warning:' || true)"; fi
  test "$head_n" -le "$base_n" || { echo "D-22.X4: $f warnings $base_n -> $head_n" >&2; exit 1; }
done
LZ_CPFP="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 server/src/services/bitcoin/advancedTx/cpfp.ts || true)"
if grep -qF 'createCPFPTransaction has' <<<"$LZ_CPFP"; then
  CPFP_NLOC="$(sed -nE 's/.*createCPFPTransaction has ([0-9]+) NLOC, ([0-9]+) CCN.*/\1/p' <<<"$LZ_CPFP")"
  CPFP_CCN="$(sed -nE 's/.*createCPFPTransaction has ([0-9]+) NLOC, ([0-9]+) CCN.*/\2/p' <<<"$LZ_CPFP")"
  test "$CPFP_NLOC" -le 144
  test "$CPFP_CCN" -le 20
fi
LZ_BAS="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 server/src/services/bitcoin/transactions/broadcasting.ts || true)"
if grep -qF 'broadcastAndSave has' <<<"$LZ_BAS"; then
  test "$(sed -nE 's/.*broadcastAndSave has ([0-9]+) NLOC.*/\1/p' <<<"$LZ_BAS")" -le 139
  test "$(sed -nE 's/.*broadcastAndSave has [0-9]+ NLOC, ([0-9]+) CCN.*/\1/p' <<<"$LZ_BAS")" -le 20
fi
git worktree remove --force "$LZ_BASE_DIR"
LZ_BASE_DIR=""
node scripts/quality/check-large-files.mjs
npm run arch:check
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run check:openapi-route-coverage
npm run check:resource-ownership-contract
node scripts/ci/check-supply-chain-locks.mjs
git diff --check "$BASE" HEAD
test -z "$(git status --porcelain)"
echo "i22 verification passed"
```

## Delivery, rollback, deployment

- **The PR.** One PR on `codex/bug-scrub-loop/20261013-i22`: the plan commits (only `tasks/`), two phase commits (A1,
  C1) and the integrator commit. Squash-merged.
- **Merge rules.** Merge through protected `main`, no admin bypass; strictly serial merges; poll the required contexts
  via `/commits/<sha>/statuses`; never pass `delete_branch_after_merge`; verify the `merge_commit_sha` is an ancestor
  of `main` before deleting the branch; then verify target-branch CI.
- **Expected CI lanes** (a missing expected lane is investigated, not assumed skipped):
  - **Test Suite**, full scan (C1 edits test-lane infrastructure): Full Backend/Frontend coverage, **Full Browser E2E**
    (now running the group check first; it must pass on the repo) and the **Full Critical Mutation Gate** shards (A1
    edits `signingIntent/*` and `transactions/broadcasting.ts`, both in shard 3). Record the job IDs.
  - **Verify Bitcoin Vectors**, including `verify-vectors-mutation-fee` and `verify-vectors-mutation`. Record the
    duration of the "fee-policy mutation proof" time-command notice against the step's 15-minute bound
    (`.github/workflows/verify-vectors.yml:594-598`); the profile grows by about 150 mutants (≈ +17%). Above
    12 minutes is a stop to report, not a retrigger and not a bound to raise: `verify-vectors.yml` is
    provenance-pinned (`scripts/verify-addresses/sourceManifest.ts:4`; D-22.X3 and Non-goals leave it untouched), so
    raising the step bound would need vector regeneration and a plan revision. Prefer trimming the profile (for
    example narrowing the `cpfpParent.ts` `mutate` entry) within this PR, after reporting.
  - **Code Quality**, including `ci-classifier-tests` (`scripts/ci/*`, `tests/ci/*`, the lifecycle registry) and the
    mutation-map and critical-mutation-config node tests.
  - **Architecture** runs on the PR but is not required: it must be green on the PR head and again after the merge.
- **CI triage is infrastructure first** (CLAUDE.md): sora contention for a sora-only timeout, then Podman archive
  stalls (runner-infra #34), the npm advisory endpoint, DIND, a stranded e2e runner lock, kumo's native builder.
- **Retriggers** carry the four-part evidence.
- **PR-body flags:** A1: the package target stays capped at 1000 sat/vB; the child may exceed it only for a bounded
  parent, and only while its fee is below 5000 sat/vB of the smallest vsize the signed child can have (every
  signature at its shortest valid encoding): bitcoinjs-lib's default `maximumFeeRate`, which `extractTransaction()`
  enforces when the server finalizes and in the Trezor adapter, so a signed child is never refused at finalize for its
  fee rate (and Bitcoin Core's 10,000 sat/vB `maxfeerate` is further away); those two call sites are untouched, so
  the library's fee check stays an independent backstop (R5-1 option (a)); the rescue range is about halved
  against a 10,000 bound (at 50 sat/vB a parent up to ~9.5k vB); `parentFeeRate` uses the
  bounded vsize; unbounded input types keep the 1000 child cap with an explicit error; a faked smaller witness can
  only make the child underpay; a CPFP on an already confirmed parent is refused when it is built and again before
  broadcast (409, or a retryable 503 when the lookup fails or exceeds its 20 s deadline; the wallet's own row is read
  before the node), and reconciliation withholds (lookup-only) a child whose parent is mined instead of re-submitting
  it; the exact absolute fee is still re-checked at broadcast;
  payjoin and RBF of a child above 1000 sat/vB stay refused; the send wizard skips the upper bound only for a resumed
  (locked) draft, and the review shows the child's rate unlabeled (backlog P3); `cpfpParent.ts` joins the fee-policy
  mutation profile; RBF's confirmation lookup moved to `advancedTx/shared.ts` unchanged. C1: the subject runs the group check before the backend; render-regression stays outside it; the
  install-e2e orphan gap is a new backlog P3. "No migration, no new endpoint, no workflow edit, no version bump."
- **Rollback.** Code, config, test and docs only. Each commit reverts independently. Reverting A1 restores the
  1000 sat/vB child cap and removes the confirmed-parent checks (build, broadcast, reconciliation). A row withheld
  in between keeps its attempt count at the cap, so it stays stalled and lookup-only after the revert (fail closed).
  A `cpfp` intent created in between with a stored
  rate above 1000 then fails to load
  (`SigningIntentSnapshotSchema` max 1000, `signingIntent/service.ts:162`), so its draft can no longer be signed or
  broadcast and expires. That fails closed (no funds risk). Reverting C1 removes the subject check.
- **Deployment.** None until clean closeout (`--deploy final`).

## Completion criteria

- [ ] Every failing-first test fails on `bd215520df0c` code for its stated reason and passes on the PR head; guards
  are recorded as guards; the reds are re-recorded with the final tests.
- [ ] The two new canaries and the `fee-surplus` re-pin are taken from the phase's own fee-policy report; both profiles'
  filtered map checks pass with every canary `Killed` by its named test.
- [ ] `npm run arch:graphs` / `arch:calls` ran before the integrator commit; any change is committed and explained.
- [ ] The Verification block runs as written on the integrated branch, exit 0 recorded (backend coverage 100% on
  `tests/unit`, frontend coverage 100%, lizard not above base with no per-file growth, the 36-file scope diff, the
  three-file pinned-surface set, `arch:check`).
- [ ] `/simplify` and an adversarial implementation review run on the integrated diff; findings fixed or recorded.
- [ ] PR head CI is green with run and job IDs recorded, including the critical mutation shards, verify-vectors (with
  the fee-policy step duration) and Full Browser E2E.
- [ ] The PR is merged, required contexts green, target-branch CI green on the merge commit, ancestry verified,
  branches and worktrees cleaned.
- [ ] Run state: both findings resolved; `cpfp-rbf--witness-padding-inflates-vsize` annotated as partly fixed (stays
  backlog); `ci-classifier--install-e2e-orphan-guard-not-triggered-by-new-suites` and
  `cpfp-review--child-rate-unlabeled` added as backlog P3s.
- [ ] The P3 backlog stays outside the blocking fix set.

## Integrator commit: changelog

`docs/reference/changelog.md`, under `## [Unreleased]` → `### Fixed`, two bullets (the Verification block greps
`large low-fee parent`, `still capped at 1000 sat/vB`, `below 5000 sat/vB`, `refused when its parent is already confirmed`,
`never re-submitted`, `padded witness` and `not assigned to a browser E2E group`, all within `[Unreleased]`; none of
them occurs there at `bd215520d`; R2-W1: the earlier `already confirmed` also matched the base wallet-sync bullet):
- CPFP: a large low-fee parent can now be accelerated with an ordinary target fee rate. The target package fee rate is
  still capped at 1000 sat/vB, but the child's own rate may now exceed it, because the child pays the parent's
  shortfall, while it stays below 5000 sat/vB, the limit applied when a signed transaction is finalized, measured on
  the smallest size the signed child can have so that a signed child is never refused. For example, at a 50 sat/vB
  target a parent of up to about 9,500 vB can now be accelerated (before: about 2,100 vB); a larger one needs a lower
  target.
  This applies when the parent's size can be bounded from its authenticated data (single-sig and multisig inputs,
  Taproot key-path spends); a parent that spends a Taproot script path or an unknown witness version keeps the
  1000 sat/vB child limit and says so. For those bounded input types, a parent served with a padded witness no longer
  inflates the child fee: the parent is priced at its largest valid size. A CPFP is now refused when its parent is
  already confirmed, both when it is created and when it is broadcast, and a child whose broadcast outcome is still
  being reconciled is never re-submitted once its parent is mined, so no child is sent for a mined parent. The CPFP
  draft opens in the send wizard ready to sign.
- CI: Full Browser E2E now fails when a top-level browser spec is not assigned to a browser E2E group
  (`scripts/ci/browser-e2e-groups.sh`). Before, such a spec was skipped and its PR could merge green.

## Review log

- Draft assembled 2026-10-31 from the two prototypes (source `bd215520df0c`). The combined patch applies cleanly
  (18 files, +710/−45).
  - Coordinator decisions: OQ-A1 (cap the package target; accept the four trade-offs: bounded-vsize
    `parentFeeRate`, unbounded input types keep the 1000 cap, a faked smaller witness only underpays, the
    witness-padding P3 is partly fixed and stays backlog); the three pins (`fee-surplus` re-pinned +7 lines;
    `cpfp.ts:38-70` unchanged; signer inventory current); OQ-C1 (option (b) only; render-regression outside the group
    check; the install-e2e orphan gap becomes a backlog P3); `config/resource-lifecycle-callsites.json` legitimately
    touched.
  - Plan-author decisions, for pass 1 to confirm:
    - OQ-A1-M: `cpfpParent.ts` joins the fee-policy profile and the mutation map (two invariants, minScore 75),
      measured at 369 s / 1059 mutants / 75.00 on the prototype; the map and Stryker configs are outside the
      verify-vectors provenance manifest. Five boundary tests added from the surviving mutants.
    - OQ-A1-F: the send wizard's fee cap blocked signing a CPFP draft above 1000 sat/vB; `stepValidation.ts` skips the
      upper bound in draft mode (red: 1 failure on base; green: 51/51, 1010 send-area tests).
    - EXPECTED_FILES is 22 (A1 17, C1 4, changelog), not 19.
- Pass 1 (2026-10-31): two reviewers (A1 adversarial; whole plan with the prototypes applied).
  - Applied:
    - A1-R1-1 (high): CPFP refuses a confirmed parent. Build time: `isOriginalConfirmed` moves to
      `advancedTx/shared.ts` as `isTransactionConfirmed` (RBF keeps calling it) and `createCPFPTransaction` calls it
      before any fee math ("Parent transaction is already confirmed; CPFP is not needed", field `parentTxid`).
      Broadcast time: the claim carries the intent's `source`; for `cpfp`, `broadcastAndSave` checks every input txid
      of the snapshot after the claim and before the network (beside the `replacesTxid` check), 409
      `cpfp_parent_confirmed` or a retryable 503 `cpfp_parent_status_unavailable`, releasing a first claim. Prototyped
      in `$SCRATCH/p22-a1r1` (`plan22-A1-r1-prototype.patch`, 12 files): typechecks, targeted backend run green (175
      files, 6162 tests), reds fail on base for the stated reasons (`p22-a1-r1-red.txt`).
    - A1-R1-2: the child's own rate is capped at 10,000 sat/vB (`SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE = 10_000`),
      ceiling `min(10,000, exactFeeRateNotAbove(1000 · (P + C), C))`; the 100k vB parent gate is dropped (no longer
      bounds anything); boundary tests at exactly 10,000 and above; OQ-A1 rescue table and changelog updated.
    - A1-R1-3: one error message per branch; the unreachable "exactly at the ceiling" builder test is replaced by unit
      tests of `authorizeCpfpChildFeeRate` at its three ceilings; the package branch is commented as defense in depth.
    - A1-R1-4: OQ-A1-F records that the draft-mode skip relies on the draft lock (`TransactionSummary.tsx:246`,
      `useReviewStepTransactionLifecycle.ts:22`) and stays draft-wide because a draft does not carry its source; the
      unlabeled child rate on the review step becomes backlog P3 `cpfp-review--child-rate-unlabeled`.
    - A1-R1-5: Non-goals state that payjoin and RBF of a CPFP child above 1000 sat/vB fail closed; Verification greps
      that only `advancedTx/cpfp.ts` raises `maximumFeeRateSatsPerVbyte`.
    - W1: a fee-policy proof above 12 minutes is a stop to report; raising the bound is no longer offered
      (`verify-vectors.yml` is provenance-pinned).
    - W2: the mutation-map delta is regenerated as a unified diff with headers, `plan22-A1-mutation-map-delta.patch`
      (applies with `git apply` on `$SCRATCH/p22-a1`; second canary moved to the pass-1 branch condition).
    - W3: the `types.ts` comment says the per-package bound is "at most" the CPFP ceiling; Verification greps it.
    - Counts: EXPECTED_FILES 22 → 29 (A1 17 → 24); A1 server red 10 → 18 over six files; Verification adds the
      confirmed-parent, broadcast-order, rbf pin, 10,000 cap, A1-R1-5 and `broadcastAndSave` lizard checks.
  - Confirmed:
    - No source spoofing: the broadcast-time check reads `source` from the claimed intent row and the parent txid from
      the server-issued, digest-bound snapshot; a client cannot choose either.
    - Witness bounds only lower the size: `vsize = min(served, bound)`, so a faked witness can only make the child
      underpay.
    - The draft schema and the broadcast request do not cap the rate (`shared/schemas/draftRequests.ts:12-18`
      accepts any positive rate), so only the signing-intent caps and the send wizard needed changes.
    - Mutation CI cost fits: about +150 mutants (≈ +17%) on the fee-policy profile against its 15-minute step.
    - C1 is correct, including the render-regression exclusion and the lifecycle registry entry.
    - The cheap Verification steps are green on the prototypes.
  - Rejected: none.
- Pass 2 (2026-10-31): two reviewers (A1 adversarial in a fresh prototype tree; full read).
  - Applied:
    - A1-R2-1 (P2): the reconciliation gap is closed, not accepted. The Non-goals bullet that accepted it is removed.
      Its reason was wrong: reconciliation re-submits only after its own child lookup misses, and it also resumes
      expired `claimed` rows that never reached a node.
      - `advancedTx/shared.ts` gains `isCpfpChildParentConfirmed`, a boolean that throws on a lookup error. Both
        `broadcastAndSave` (which maps it to the existing 409/503) and `reconcileUncertain` use it.
      - In `reconcileUncertain`, a `cpfp` row whose parent is mined becomes lookup-only. That needs a new repository
        transition, `markBroadcastWithheld`, which moves the count to the cap. The suggested `markBroadcastStalled`
        refuses below the cap (`:376-385`, pinned by the integration test).
      - A parent-lookup error falls into the existing catch, so the row stays `unknown`, uncounted, and no catch is
        added.
      - Four reconciliation tests (two red, two guards) and one repository test (red).
      - Prototyped in `$SCRATCH/p22-a1r2` (`plan22-A1-r2-prototype.patch`).
    - A1-R2-2 (P3): the parent lookup runs under a 20 s `withTimeout` deadline (`CPFP_PARENT_LOOKUP_DEADLINE_MS`),
      and a timeout raises the same 503. Reason (ii) now names the deadline.
      - The reviewer's DB-first suggestion was evaluated and adopted. The wallet rows are read before any
        `getNodeClient` call: a confirmed row refuses with no node call, and an unconfirmed or absent row goes to the
        node. It is safe because a stale "confirmed" row can only refuse, which is fail-closed, and RBF trusts the
        same row.
      - `isTransactionConfirmed` is split into its row and history steps, with unchanged behaviour.
      - Tests: a fake-timer deadline test (red), and the wallet-row test is tightened to "no `getNodeClient` call"
        (red on pass 1).
    - R2-W1: the changelog grep no longer uses `already confirmed`, which the base wallet-sync bullet also matches.
      It uses `refused when its parent is already confirmed` and `never re-submitted`, both absent from base
      `[Unreleased]`. The bullet now also covers reconciliation.
    - R2-W2: the feePolicy "exactly 10,000" test is specified (rate above 1000, bound
      `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE`, admitted) and prototyped. It is red on base ("Fee rate must be between
      0.1 and 1000 sat/vB"), not a guard.
    - Counts:
      - A1 server red 18 → 23 over 6 → 8 files (`p22-a1-r2-red.txt`; 5 failures on the pass-1 source,
        `p22-a1-r2-red-on-r1.txt`);
      - EXPECTED_FILES 29 → 33 (A1 24 → 28: `broadcastReconciliation.ts`, the repository and both tests);
      - the targeted run adds the repository test and `tests/unit/worker`;
      - Verification adds the shared-helper, DB-before-node, single-lookup-site and reconciliation-order greps, plus
        an unchanged catch count;
      - the arch:graphs expected edges are updated;
      - the shard-3 survivor risk for the reconciliation mutants is recorded under D-22.X3 (corrected in pass 3,
        R3-1: there is no such risk).
  - Confirmed:
    - Every broadcast route goes through `broadcastAndSave`, so the broadcast-time check covers them all.
    - Pre-upgrade intents carry `source` `'cpfp'`, so the check and the withhold apply to CPFP intents created before
      the deploy.
    - Release and reservation stay consistent: a refused first claim is released to `ready` and the route releases
      fresh reservations. A 503 does not loop: it is returned to the caller and never retried by the route;
      reconciliation keeps a failed lookup `unknown` without counting it.
    - A DB/node disagreement refuses: either source saying "confirmed" wins.
    - Only `cpfp` raises the cap. The Verification grep for `maximumFeeRate|SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE`
      outside `signingIntent/` still finds only `cpfp.ts` and `cpfpParent.ts`.
    - The 10,000 cap is consistent at prepare (`maximumSigningIntentFeeRate`), in the stored-policy schema (`.max`)
      and at finalize.
    - Dropping the 100k vB gate is safe: the 10,000 cap bounds both the ceiling and the absolute fee.
    - All patches apply on a fresh tree: A1, pass 1, pass 2 and the map delta apply in order on a fresh `f4d746f`
      tree. The pins hold: `cpfp.ts:38-70` and `rbf.ts:232-242` are byte-identical to base, `artifactValidation.ts`
      is 672 lines, and the `feePolicy.ts` re-pin (base 136-159 = head 143-166) is unchanged by pass 2.
  - Rejected: none.
- Pass 3 (2026-10-31): one independent reviewer (fresh tree with all six patches applied).
  - Applied:
    - R3-1 (P3): the D-22.X3 bullet on `broadcastReconciliation.test.ts` is corrected. CI's critical shards use the
      default Vitest runner over `tests/**/*.test.ts` with perTest coverage, so that test kills the new reconciliation
      mutants; `CRITICAL_TEST_FILES` feeds only the command-runner fallback and lane selection
      (`classify-files-lib.sh:214-217`), and `feePolicy.test.ts`, `json.test.ts`, `migration.test.ts` are absent at
      base too. The file is not added; `server/scripts/mutation` stays untouched. The "survivors accepted" premise is
      removed; a shard below its floor remains a stop to investigate.
    - R3-2 (P4): the redundant "target of exactly 1000" test is dropped (the pass-1 ceiling tests use target 1000 and
      kill the `<` mutant). The 23-byte not-P2SH test's input pushes a P2WPKH program in its scriptSig and carries a
      P2WPKH witness. `$SCRATCH/r22p3-cpfpParent.test.ts` is referenced as guidance. No red count changes:
      `cpfpParent.test.ts` cannot load on base and is not red evidence.
  - Confirmed:
    - All cheap Verification steps are green: server and frontend typechecks; the targeted backend run (215 files,
      6932 tests); frontend `test:run` (724 files, 10028 tests); the `check:*` scripts; signer inventory; the
      critical-mutation config check; the mutation-map and critical-config node tests; the CI shell suites and
      `tests/ci` vitest (161); lifecycle registry (417 identities); the pinned surfaces; the 33-file scope; the shape
      and changelog greps; lizard 82 warnings vs base 83, with no per-file growth; large files; `git diff --check`;
      ESLint.
    - Reds match: server 23 of 540, frontend 1 of 51, C1 red.
  - Rejected: none.
- Pass 4 (2026-10-31): one independent full-plan reviewer.
  - Applied:
    - R4-1 (P3, funds-adjacent): the 10,000 sat/vB node-limit check now holds for the smallest vsize the signed child
      can have, not the estimate's maximum. bitcoind checks `fee > maxfeerate · vsize` on the real signed transaction,
      and `estimateTransactionWeight` reserves 73-byte ECDSA and 65-byte Schnorr signatures.
      - Bound: authorize only if `childFee ≤ 10,000 · C_min`, with `C_min = minimumSignedVsize(spendPolicy, W) =
        ceil((W − slack) / 4)`. The slack is every required signature at its shortest valid encoding: ECDSA
        73 − 9 = 64 bytes (Bitcoin Core's `IsValidSignatureEncoding` minimum), Schnorr 65 − 64 = 1 byte; × 4 for the
        P2PKH scriptSig, × m for sortedmulti.
      - The reviewer's 71-byte floor was not adopted: about 1 in 128 low-S signatures is 70 bytes or shorter, so it is
        not a bound. The provable floor costs about 15% of the P2WPKH rescue range (T = 50: P ≤ ~19.1k vB, not
        ~22.3k vB); the OQ-A1 table, changelog and PR-body flags are updated.
      - The weight module has no min variant; the helper is appended to `cpfpParent.ts` so lines 1-177 and both
        canaries keep their positions. The map's invariant `lineEnd` moves 174 → 177.
      - Tests: the authorization boundary moves to 940,000 sats (allowed) / 940,001 (refused) for a 110 / 94 vB P2WPKH
        child, and 1,100,000 (pass 1's "exactly 10,000") is refused; six `minimumSignedVsize` rows; a builder test in
        the window (≈21k vB parent, target 50), red on base and on the pass-2 source.
      - Prototyped in a fresh worktree `$SCRATCH/p22-r4` (removed): `plan22-A1-r4-prototype.patch` (5 files). Counts:
        A1 server red 23 → 24 (`p22-a1-r4-red.txt`, 24 failed, 517 passed); `cpfpParent.test.ts` 19 → 25,
        `advancedTx.test.ts` 118 → 119; `createCPFPTransaction` 142 / 20 (≤ 144); EXPECTED_FILES unchanged at 33.
        Verification adds the R4-1 greps.
    - R4-2 (P4): the phase text now names the forms the Verification greps expect, checked against the pass-2
      prototype source: `const { inputs } = artifact.snapshot.transaction;` then
      `await isCpfpChildParentConfirmed(inputs, artifact.network, artifact.walletId)` in `broadcasting.ts`, and the
      module constant `CPFP_PARENT_CONFIRMED_ERROR` passed to `markBroadcastWithheld` in `broadcastReconciliation.ts`.
    - R4-3 (P4): the Verification run instruction regenerates `$SCRATCH/i22-verify.sh` from the plan's `bash` fence
      immediately before running (the exact `awk` command is given) and says a stale copy must not be used; the
      stale pass-1 copy was overwritten by a fresh extraction.
  - Confirmed: the six patches apply in order on a fresh tree; the 33-file scope; the fence passes `bash -n`; the
    shape, pinned-surface, mutation-map and C1-order checks pass on the patched tree; the C1 red reproduces; the pins
    hold (`cpfp.ts:38-70`, `rbf.ts:232-242`, `artifactValidation.ts` at 672 lines, the `feePolicy.ts` re-pin); about
    60 file:line citations are accurate.
  - Rejected: none.
- Pass 5 (2026-10-31): one independent reviewer (fresh tree, seven patches).
  - Applied:
    - R5-1 (P2), coordinator decision option (a): bitcoinjs-lib's `Psbt.extractTransaction()` refuses a signed fee rate
      `floor(fee / vsize) >= 5000` (default `maximumFeeRate`), and `finalizePsbt` (`artifactValidation.ts:470`) and the
      Trezor adapter (`signPsbtValidation.ts:142`) call it without `disableFeeCheck`, so every child authorized
      between 5000 and 10,000 sat/vB was signed and then refused at finalize.
      - Both call sites stay untouched (pinned surfaces); option (b) is rejected in OQ-A1 item 5 because it widens
        the pinned-surface set and the 33-file scope and removes the library's fee check as an independent backstop.
      - The child is authorized only if `childFee < CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT · C_min` (new constant 5000 in
        `signingIntent/types.ts`; the code refuses `childFee >= …`): the fee is whole sats and C_min ≤ every actual
        signed vsize v, so `fee ≤ 5000 · C_min − 1 ≤ 5000 · v − 1` and `floor(fee / v) ≤ 4999`.
      - `SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE` is lowered to `CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT` (5000): an
        authorized child's policy rate over C ≥ C_min is below 5000, so a 10,000 ceiling would admit only policies no
        child can finalize; at 5000 the prepare, schema, fee-policy bound and finalize ceilings stay tight.
      - The branch is rewritten in place: `cpfpParent.ts` lines 1-177, both canaries and the invariant `lineEnd` 177
        do not move; `cpfp.ts` and `feePolicy.ts` are not edited.
      - Rescue table recomputed exactly (T = 50: P ≤ 9,479 vB; T = 20: 24,621; T = 10: 52,099; T = 5 covers every
        standard parent); error message ("is not below 5000 sat/vB, the PSBT finalizer limit"); boundary tests
        (469,999 allowed, 470,000, 550,000 and 940,000 refused; the window builder test moves to a ≈10.3k vB parent);
        changelog bullet (grep `below 5000 sat/vB`), PR-body flags and Verification greps (the `>=` condition, both
        constants, both unchanged `extractTransaction()` call sites).
      - New red tests in `artifactValidation.test.ts`: a child at the top of the authorized range (469,999 sats) is
        built, signed with the test key and finalized by `validateSignedArtifact`; a child at 5000 sat/vB of its signed
        size is refused at finalize (549,999 extracts) and refused by `authorizeCpfpChildFeeRate`.
      - Prototyped in a fresh worktree `$SCRATCH/p22-r5` (removed): `plan22-A1-r5-prototype.patch` (6 files,
        +137/−33). Counts: A1 server red 24 → 26 (`p22-a1-r5-red.txt`, 26 failed, 517 passed, 543); on the pass-4
        source 4 failed, 288 passed (`p22-a1-r5-red-on-r4.txt`); targeted run 713 tests; EXPECTED_FILES unchanged at 33.
  - Confirmed: `minimumSignedVsize` is a true lower bound for p2pkh, p2wpkh, p2sh-p2wpkh, p2tr-keypath, and p2wsh /
    p2sh-p2wsh sortedmulti with m = quorum; the child has one input and one output; the slack values and the `ceil` are
    correct; the finalize tolerance and stored-policy checks do not compare at the maximum vsize; 711 targeted tests,
    both typechecks, the map test 13/13, the scope, pinned-surface and shape greps, and lizard (no growth) pass; the
    reds (24 failed, 517 passed) and the map's `lineEnd` and canaries match the plan.
  - Rejected: none.
- **Pass 6 (2026-10-31): one independent reviewer — clean, review converged.** No verified actionable comments. It
  traced every limit between "authorized" and "broadcast accepted" for a CPFP child at the top of the range: only
  server `finalizePsbt` and the Trezor adapter's `extractTransaction()` check fees (bitcoinjs-lib 7.0.2 refuses at
  `floor(fee/vsize) >= 5000`; every other call passes `true`); the finalize tolerance, draft sign/update
  (`validatePartialSignedPsbt`), `broadcastPreflight`, Electrum broadcast, the `Float` fee-rate columns, the draft and
  broadcast request schemas, vault policy (a CPFP child pays nothing outside the wallet) and the frontend
  (`FeeSelector` clamps only user input; the draft-list fee-vs-amount warning only displays) impose no refusal. On a
  fresh tree with the eight patches: typechecks clean, 713 targeted tests, map test 13/13, `stepValidation` 51/51,
  lizard no per-file growth; red 26/543 and 4/292 on pass 4; 33 files; boundary values, rescue table, canaries and
  `lineEnd` 177 match; Verification fence `bash -n`.
  - Known device-side limits, outside Sanctuary (recorded for the PR body, not a plan change): Trezor firmware asks
    for an extra fee confirmation above about 2,000 sat/vB; ColdCard's "Max Network Fee" setting (10% of outputs by
    default) can refuse a large CPFP fee on a small UTXO, as it already could before this fix.
- 2026-10-31: Verification shape checks updated after /simplify and the adversarial fixes (no plan-decision change).
  /simplify (4da5344f7) moved the parent-confirmation helpers and the refusal message into
  `server/src/services/bitcoin/parentConfirmation.ts` (re-exported from `advancedTx/shared.ts`), derived the lookup
  deadline as `Math.floor(BROADCAST_LEASE_MS / 3)`, typed the claim source with `parseSigningIntentSource` and moved
  reconciliation withholding into `withholdConfirmedCpfpChild`; fd492264b added `assertTransactionKnownToNode` and
  the child-first lookup for CPFP retries not taken from `ready`. The checks now assert the same properties at the
  new locations: the message constant and its two throw sites, the derived deadline and a single lease literal, the
  row-before-node order inside the new module, the call-site file list (new module, reconciliation, broadcasting),
  the reconciliation order via the helper's one call site, and the retry lookup between the claim and the
  pre-network checks. The reconciliation catch count still equals base: the helper adds no catch, and a failed
  parent lookup still throws to the existing one. Probe (preamble + shape checks + changelog) exits 0.
- Complexity refactor after the adversarial fixes (`c3`): the child-first retry branch raised `broadcastAndSave` to
  CCN 21 (limit 20). Its two duplicated "persist the failure, log if that write fails" try/catch blocks became one
  value-returning helper `persistFailureTransition` (CCN 19, 126 NLOC). The helper's catch returns a value, so the
  allowlist's `broadcastAndSave` non-terminal-catch entry (count 2) became stale and was removed: the only change to
  the otherwise pinned `scripts/quality/safety-catch-allowlist.json`, asserted by the Verification block. Scope 36.
- Verification (2026-10-31) on the integrated branch:
  - Full run: typechecks, targeted backend, the check:* scripts, signer inventory, critical-mutation config, both
    mutation profiles run locally (`test:mutation:fee-policy`, `test:mutation:taproot-artifact-finalization`) with
    `serverFeePolicy` and `serverTaprootArtifactFinalization` canaries present and killed by their named tests, backend
    coverage on `tests/unit` 100%, the A1 integration spec, the CI shell suites and the lifecycle registry passed.
    `tests/ci/dockerExecTcpForwarder.test.ts` failed once under host load (load ~12; reading a relay's /proc start
    time); untouched by this PR and 3/3 green in isolation.
  - Later stops were plan-side, each fixed and rerun: stale shape checks after `/simplify` and the adversarial fixes;
    the `broadcastAndSave` CCN limit (fixed by the `persistFailureTransition` refactor); the pinned allowlist (the
    stale-entry removal is now permitted and asserted); a `grep` pattern starting with `-`.
  - Final tail from the pinned-surface checks: exit 0 (`i22 verification passed`) — 36-file scope, pinned surfaces,
    shape and changelog checks, frontend typechecks and `test:run`, frontend coverage, lint, lizard (base total not
    exceeded, `createCPFPTransaction` 142/20, `broadcastAndSave` 126/19), large files, `arch:check`, boundaries, cycle
    baseline, OpenAPI route coverage, ownership and supply-chain gates, `git diff --check`, clean tree.
