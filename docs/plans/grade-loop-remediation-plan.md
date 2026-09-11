---
thread: grade-loop-remediation-plan
threadTitle: Grade-Loop Remediation
artifactKey: grade-loop-remediation-plan
type: plan
format: markdown
title: "Grade-Loop Remediation Plan"
status: approved
summary: "Converge the hex raw-transaction evidence path onto the O(n) weight preflight so over-weight evidence is rejected before the quadratic bitcoinjs parse."
tags:
  - grade-loop
  - audit
  - performance
  - wallet-safety
metadata:
  workStatus: complete
  disposition: remediation
---

# Grade-Loop Remediation Plan

**Source grade report**: `docs/plans/codebase-health-assessment.md`
**Source grade date**: 2026-09-10
**Source commit**: `fcc7f70e` (`origin/main`)
**Source score**: 88/100 (B, High confidence)

**Selected finding**: Top Risk 1, which spans three rubric criteria:

- Performance 5.1 Medium;
- Test Quality 6.4 Medium;
- the first `rationalize` row in the Divergent Paths table.

`parseAuthenticatedRawTransaction` (the hex path in
`server/src/services/bitcoin/rawTransactionEvidence.ts`) runs the full
bitcoinjs parse, `toHex`, and `getId` before it checks
`MAX_AUTHENTICATED_TRANSACTION_WEIGHT`. The sibling bytes path
(`parseAuthenticatedRawTransactionBytes`) runs the O(n)
`measureCanonicalRawTransactionWeight` preflight first. The preflight was added
there in #966/#968, but the hex path was never converged.

On Node, bitcoinjs-lib 7.0.1 parsing is quadratic in transaction size. Its
transitive `uint8array-tools` 0.0.8/0.0.9 copies the whole buffer on every
integer read, so a 20k-input transaction takes 11 s. As a result, over-weight
hex evidence costs O(n²) CPU before it is rejected. That cost is limited only
by the 16 MB Electrum frame.

Scope of this fix: it makes rejection of **above-ceiling** evidence O(n).
**Under-ceiling** large transactions still pay the quadratic parse, bounded per
transaction by the 4 MWU weight ceiling (about 10–16 s measured) and per attempt
by `MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT` (64M hex chars) and the stage
deadlines. Only D1 removes that residual.

The observable symptom is that `npm run coverage` is red: it failed 2/2 local
runs on
`server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts:304`,
which spends 9.8–15 s inside that parse against a hand-raised 20 s budget.

---

## Objective

Make every raw-transaction evidence path reject over-weight canonical framing
with the same O(n) preflight before bitcoinjs is invoked. Converge hex-input
classification onto the existing validated converter
(`rawTransactionBytesFromHex`).

**Acceptance criterion**: over-weight canonical hex evidence is rejected with
`transaction_complexity_exceeded` and bitcoinjs is never invoked (no
`bitcoin.Transaction.fromBuffer` call, which `fromHex` also delegates to). The `receiveEvidenceAuthentication` sync test passes at the server
default 10 s timeout, with no override. `server: npx vitest run --coverage
tests/unit` is green at 100%. The `receive-evidence` mutation profile scores at
least 90 on `rawTransactionEvidence.ts`, and every wallet-safety canary for that
file resolves and is killed by its named test.

## Non-Goals

- **No dependency change.** Adopting `uint8array-tools` 0.0.10 through npm
  `overrides` fixes the root cause for every Node parse site, but 0.0.10 was
  published 2026-09-07. It needs a supply-chain soak decision plus a
  `package-lock.json` change, which forces a regenerated hardware-compatibility
  statement. Deferred (D1).
- **No change** to `MAX_AUTHENTICATED_TRANSACTION_WEIGHT`, the post-parse
  weight checks, the bytes-path semantics, or `measureCanonicalRawTransactionWeight`.
- **No change** to other bitcoinjs parse sites (PSBT, drafts, broadcast
  preflight). Their inputs are locally produced or request-size bounded, and PSBT
  decode measured linear.
- **No reimplementation** of transaction parsing. bitcoinjs remains the
  authoritative parser for every transaction the preflight cannot measure.
- **No** lizard-gate, complexity, or frontend-test work (D2–D4).
- **No** version bump, CI workflow edit, or `verify-vectors.yml` /
  `sourceManifest.ts` edit.

---

## Design

In `rawTransactionEvidence.ts`:

1. Extract the bytes path's existing preflight block (currently lines 216–220)
   into a private helper placed directly after
   `measureCanonicalRawTransactionWeight`, and give it a short intent comment:

   ```ts
   const rejectOverweightCanonicalFraming = (rawBytes: Uint8Array): void => {
     const preflightWeight = measureCanonicalRawTransactionWeight(rawBytes);
     if (preflightWeight !== undefined
       && preflightWeight > MAX_AUTHENTICATED_TRANSACTION_WEIGHT) {
       throw evidenceError('transaction_complexity_exceeded');
     }
   };
   ```

2. `parseAuthenticatedRawTransactionBytes` calls
   `rejectOverweightCanonicalFraming(input.rawBytes)` where the block was. The
   behavior is identical.

3. `parseAuthenticatedRawTransaction` decodes once with
   `rawTransactionBytesFromHex(input.rawHex)` immediately after the
   `invalid_expected_txid` check. It then runs `rejectOverweightCanonicalFraming`
   on those bytes, and parses the same bytes with `bitcoin.Transaction.fromBuffer`.
   This is byte- and type-identical to the former `fromHex(rawHex)`, which in
   bitcoinjs 7.0.1 is `fromBuffer(Uint8Array.from(Buffer.from(hex,'hex')))`. It
   was amended in the `/simplify` pass. Everything after that is unchanged: the
   bitcoinjs parse, the canonical comparison, the txid binding, and the
   authoritative post-parse `transactionWeight > MAX` check. That post-parse
   check still covers framing the preflight leaves undefined, and it is still
   killed by the mocked-`weight()` ceiling tests.

### Behavior changes (intentional, fail-closed)

| Input on the hex path | Before | After |
| --- | --- | --- |
| Over-weight canonical transaction | `transaction_complexity_exceeded`, after an O(n²) parse | `transaction_complexity_exceeded`, O(n), bitcoinjs never invoked |
| Over-weight canonical transaction with a mismatched expected txid | `txid_mismatch`, after the parse | `transaction_complexity_exceeded` (same precedence as the bytes path) |
| Over-weight **non-canonical** framing (trailing byte, non-minimal CompactSize, truncated tail) | `malformed_raw_transaction` / `non_canonical_raw_transaction`, after the quadratic parse | unchanged, since the preflight cannot measure it (D6) |
| Odd-length or non-hex string (e.g. `<tx>0`, `<tx> `) | `non_canonical_raw_transaction` or `malformed_raw_transaction` (whatever bitcoinjs decided) | `malformed_raw_transaction` (same as `rawTransactionBytesFromHex` / the bytes path) |
| Everything else | unchanged | unchanged |

Reasons are recorded but never branched on. `blockchain/syncAddress.ts`
copies `error.reason` into its fail-closed failure records, and the evidence
worker propagates it. No code compares against `non_canonical_raw_transaction`
or depends on the order of reasons; `rg` finds only
`blockchain/receiveEvidenceAuthentication.ts:85`, which constructs
`malformed_raw_transaction`. Every value stays inside
`RAW_TRANSACTION_EVIDENCE_REASONS`, and every reason still rejects the
evidence.

Production exposure of the hex path (corrected after adversarial review):
**no in-repo production caller.**

- The worker's hex projection (`sync/transactionEvidenceWorker.ts:63`) is
  reached only through `projectTransactionEvidenceOffThread` and
  `createTransactionEvidenceProjector`. Both are exported, but nothing in
  `server/src` calls either one.
- Production sync (`sync/evidenceAuthentication.ts:324,346,487`) uses
  `createCompactTransactionEvidenceProjector`, which is the bytes path. That
  path already had the canonical preflight.
- `authenticateRawTransactionOutput` and `blockchain/receiveEvidenceAuthentication.ts:48`
  are reached only from the exported `syncAddress`, which has no in-repo caller.
- This PR is therefore defense-in-depth and path convergence for the exported
  hex API, plus a repair of the red coverage gate. The production quadratic
  exposure that remains is D6 on the bytes path, backed by D1.

Electrum frames are capped at 16 MB (`electrum/protocol.ts`
`ELECTRUM_MAX_FRAME_BYTES`), so a single hostile hex response can reach about
8 MB of raw transaction.

### Wallet-safety mutation map

`config/wallet-safety-mutation-map.json`, profile `serverReceiveEvidence`, pins
line and column locations for nine invariants in `rawTransactionEvidence.ts`
(lines 263–334 at `HEAD`). The final net insertion ahead of them is +11 lines:
the helper and its comment add 13, the bytes path loses 4, and the hex path
gains 2 (decode-once binding plus the preflight call). Update
each invariant's `lineStart`/`lineEnd` and each canary's `location.start.line`
/ `location.end.line` by the measured delta. Columns are unchanged because the
pinned lines' text does not change. Compute the new lines from the edited file,
not from arithmetic alone: match each canary line's old text at `HEAD` to its
new position.

---

## Phases

### Phase 0 — Mutation baseline (before any edit)

With source and tests still identical to `origin/main`, run `cd server && npm
run test:mutation:receive-evidence` once. Record its wall-clock time and the
`rawTransactionEvidence.ts` score. This must precede Phase 1 because Stryker's
initial dry run aborts when any test fails, and the Phase 1 tests fail by
design until Phase 2.

### Phase 1 — Non-regression tests first (must fail before the fix)

File: `server/tests/unit/services/bitcoin/rawTransactionEvidence.test.ts`. This
is the only test file in the `receive-evidence` Stryker profile, so new kills
must land here.

- 1a. Add
  `it.each([legacy 999_937, witness 3_999_753])('rejects over-limit canonical %s hex before bitcoinjs parsing')`,
  reusing `makeLargeLegacyTransaction` / `makeLargeWitnessTransaction`. It spies
  on `bitcoin.Transaction.fromBuffer` (the initial draft used `fromHex`;
  see Implementation Status), expects `transaction_complexity_exceeded`,
  and asserts that the spy was not called. Before the fix, the spy assertion
  fails.
  - Deliberately do **not** add a combined 25,000×25,000 hex case to this file.
    It is the Stryker profile's test file (`disableBail`, `timeoutMS: 30000`),
    so every mutant that disables the preflight would pay a ~25 s quadratic
    parse. That would inflate the CI step "Prove exact transaction fee
    invariants by mutation", which has a 15-minute bound shared with
    fee-policy.
  - The two single-item fixtures parse linearly even under such mutants. The
    combined shape is guarded in 1c instead.
- 1b. Extend `rejects malformed raw hex %#` with `${makeTransaction().toHex()}0`
  (odd trailing nibble) and `${makeTransaction().toHex()} ` (trailing space),
  both expecting `malformed_raw_transaction`. Before the fix both yield
  `non_canonical_raw_transaction`.

File: `server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts`.

- 1c. For "rejects the impossible combined count shape before projecting any
  evidence", remove the `20_000` timeout override (falling back to the default
  10 s) and add a `bitcoin.Transaction.fromBuffer` spy asserting that it was not
  called, restored in `finally`. Before the fix this fails: the spy was called,
  and the test runs 10–15 s.

Run the three tests and confirm each fails for the stated reason before
touching production code.

### Phase 2 — Converge the preflight

File: `server/src/services/bitcoin/rawTransactionEvidence.ts`. Implement the
Design steps 1–3. No other production file changes.

### Phase 3 — Re-anchor the mutation map

File: `config/wallet-safety-mutation-map.json`. Shift the nine
`serverReceiveEvidence` invariants and canaries by the measured delta,
verifying each canary's line text. Change no other profile.

### Phase 4 — Verification

Focused:

- `cd server && npx vitest run tests/unit/services/bitcoin/rawTransactionEvidence.test.ts tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts tests/unit/services/bitcoin/sync/transactionEvidenceProjection.test.ts tests/unit/services/bitcoin/blockchain/receiveEvidenceAuthentication.test.ts tests/unit/services/bitcoin/sync/transactionEvidenceThread.test.ts`
- `cd server && npm run test:mutation:receive-evidence`: `rawTransactionEvidence.ts` score ≥ 90 (profile break is 85).
  Compare wall-clock time with the Phase 0 baseline. The after-run must not
  grow by more than ~10%, since the CI step shares a 15-minute bound with the
  fee-policy profile.
- Validate only the `serverReceiveEvidence` profile with the repo checker,
  since the full checker also needs the other profiles' reports:
  `node -e` calling `validateMutationEvidence` from
  `scripts/ci/check-wallet-safety-mutation-map.mjs` with the map filtered to that
  profile and `server/reports/mutation/receive-evidence.json`.
- `node --test tests/ci/check-wallet-safety-mutation-map.test.mjs`

Broad, per `CLAUDE.md`:

- `cd server && npx tsc --noEmit && npx vitest run --coverage tests/unit`: green, 100%.
- `cd server && npx vitest run`: the full server suite, including the gated integration skips.
- `npm run lint`
- `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`
- `npm run test:run`: frontend. No frontend change is expected; this is the repo rule.
- `git diff --check`

Final evidence: `grade --diff origin/main`. Also time the impossible-combined
test, targeting < 1 s.

---

## Compatibility And Rollback

- **Risk**: low to medium. The change sits in a wallet-safety critical path
  (`server/src/services/bitcoin/**`), so CI will run the full verify-vectors
  lane, including the mutation proofs. It only adds an earlier rejection that
  reuses a measurer already trusted by the bytes path. Accepted transactions
  follow the identical bitcoinjs path, so there is no change to what is accepted.
- **False-rejection guard**: `measureCanonicalRawTransactionWeight` equals
  `bitcoin.Transaction.weight()` for canonical framing. Existing tests pin this
  at both ceiling encodings and across CompactSize boundaries. It returns
  `undefined`, deferring to bitcoinjs, for anything it cannot frame, so it
  cannot reject a transaction bitcoinjs would accept at or under the ceiling.
- **Release**: this change touches a wallet-safety critical path, so the next
  release's wallet-safety audit review must list it
  (`scripts/release/verify-wallet-safety-audit-review.mjs`). No action in this
  PR.
- **Rollback**: revert the single squash commit. The map re-anchoring reverts
  with it, and no data or schema is involved.

## Acceptance Criteria

- [x] Phase 1 tests fail before Phase 2 for the stated reasons, and pass after.
- [x] Over-weight canonical hex is rejected with `transaction_complexity_exceeded`
      and `fromBuffer` is never called: legacy and witness fixtures in
      `rawTransactionEvidence.test.ts`, and the combined 25k×25k shape in the
      sync test.
- [x] `receive-evidence` mutation cost stays well inside the CI step budget. See
      Implementation Status: the ~10% profile bound was replaced by a CI-step
      bound after measurement.
- [x] Odd-length and trailing-space hex is classified `malformed_raw_transaction`.
- [x] The sync impossible-combined test passes at the default 10 s timeout, in under 1 s.
- [x] `server` unit coverage is 100% and `npm run coverage`'s server leg is green.
- [x] The `receive-evidence` mutation score is ≥ 90 on `rawTransactionEvidence.ts`,
      and all nine canaries resolve to exactly one mutant that is killed by its named test.
- [x] Server tsc, root lint, and root typechecks pass. The frontend suite is unchanged and green.
- [x] No dependency, lockfile, workflow, or version change.

## Implementation Status

- Phase 0 done. Baseline `receive-evidence` profile: 361 mutants, score 93.77, 70 s wall.
- Phase 1 done. Before the fix, all five new or changed assertions failed for the stated reasons:
  - 1a legacy/witness: "expected fromHex to not be called";
  - 1b cases 4/5: `non_canonical_raw_transaction`;
  - 1c: `fromHex` was called, and the test took 8.9 s.
- Phase 2 done. The helper and its doc comment add +13 lines, the bytes path
  −4, and the hex path +1. Focused suites (6 files, 270 tests) are green. The
  sync impossible-combined test went from 9.8–15 s to **9 ms**.
- Phase 3 done. Rewrote 36 line fields in `serverReceiveEvidence` by +10 (by
  +11 after the `/simplify` decode-once change), with
  every pinned block verified verbatim at the new offset and no other profile
  touched. The profile-filtered `validateMutationEvidence` passes: all nine
  canaries are Killed by their named tests.
- **Divergence (mutation runtime).** After the change: 362 mutants, score
  **93.79** (312 killed + 5 timeout / 338). Alternating local runs on the same
  host measured base 70 s / 69 s against after 88 s / 93 s.
  - The increase is proportional coverage, not slow fixtures: Stryker test
    executions went from 4,558 to 6,162 (+35%), because every hex-path test now
    also covers the shared preflight and cursor mutants. The new tests each run
    in under 20 ms.
  - The ~10% *profile* bound was therefore the wrong yardstick. The CI step
    "Prove exact transaction fee invariants by mutation" runs fee-policy and
    receive-evidence together. Its workflow comment records contended runs at
    91–92% of the former 8-minute bound (≈ 7.3 min), and its current bound is 15
    minutes.
  - +20–25 s is ≈ +5% of that step's runtime, leaving about 50% headroom.
    Accepted; do not trade away preflight coverage to recover it.
- `/simplify` follow-up (three reviewers) applied:
  - The hex path now decodes once and parses the validated bytes with
    `fromBuffer`. This is identical to bitcoinjs `fromHex`, which is
    `fromBuffer(Uint8Array.from(Buffer.from(hex,'hex')))`. It adds 1 line, so
    the map is re-anchored at +11 and re-verified.
  - Spies now target `fromBuffer`; a `fromHex` spy would go vacuous if the parse
    call changes.
  - One shared `OVER_LIMIT_CANONICAL_FRAMINGS` table replaces the duplicated fixtures.
  - Comments are trimmed.
- Mutation-runtime fix found by bisection. Spying `fromBuffer` made a failing
  `expect(spy).not.toHaveBeenCalled()` pretty-print the recorded 1–4 MB
  `Uint8Array`, costing 2–3 s per failing test per preflight-disabling mutant.
  That doubled the profile to ~187 s. All three evidence-file spy assertions,
  including the two pre-existing bytes-path ones, now assert
  `spy.mock.calls.length` is 0.
  - **Final profile: 362 mutants, score 93.79 (314 killed + 3 timeout / 338),
    80 s wall, against a 70 s baseline.** All nine canaries are Killed by their
    named tests.
- Phase 4 gates on the final tree, all green:
  - server `tsc`;
  - `server: vitest run --coverage tests/unit`, 684 files / 15,771 tests,
    100% on all four measures. This command failed 2/2 before the change.
  - full server suite: 691 files passed, 57 integration files skipped;
  - `tests/ci/check-wallet-safety-mutation-map.test.mjs`;
  - `npm run lint` and `typecheck:{app,tests,all}`;
  - frontend `vitest run`: 626 files / 8,416 tests;
  - `git diff --check`.
- Diff-scope grade evidence (`diff_scan.sh` vs `origin/main`, 4 comparable
  files): secrets 0; lizard warnings 0 with a delta of 0 (max CCN 14);
  duplication 1.87%; largest-file delta 0. Repo-config ESLint on the changed
  source reports 0 errors. The collector's `lint=fail` is ESLint finding no
  root config, not a finding. The full-mode report was not rewritten for this
  diff.
- Residual noted by the efficiency reviewer: framing the preflight cannot
  measure goes to bitcoinjs, as designed in #966/#968. Examples are trailing
  bytes, non-minimal CompactSize, and a truncated tail. So an over-weight but
  *non-canonical* buffer still pays the quadratic parse before being rejected
  as malformed (measured 28.5 s for 25k×25k plus one trailing byte). This
  predates the change and applies equally to the bytes path. Closing it
  properly is D1, the linear parser. A lower-bound framing preflight is D6.

## Deferred Findings (explicit)

| ID | Finding (grade evidence) | Why deferred |
| --- | --- | --- |
| D1 | `uint8array-tools` 0.0.8/0.0.9 Node build copies the buffer per read, making every Node transaction parse O(n²); fixed upstream in 0.0.10 (2026-09-07), but bitcoinjs-lib 7.0.2 still pins `^0.0.9` | A supply-chain decision on adopting a days-old transitive release into the parsing path. It needs `overrides`, a lockfile change, and a regenerated `docs/reference/generated/hardware-wallet-compatibility.*`. The selected fix removes the unbounded above-ceiling amplifier without it. The bounded under-ceiling quadratic (≤ ~16 s per 4 MWU transaction, in the budgeted evidence worker) remains until D1 lands. |
| D2 | The repo lizard gate (`scripts/quality.sh` `run_lizard`, `-l javascript -l typescript`) skips `.tsx` in directory walks: 9 gated vs 32 project warnings | An independent guardrail PR (add `-l tsx`, rebaseline `LIZARD_WARNING_BASELINE`). Candidate for the next loop pass. |
| D3 | ESLint AST complexity >15 grew from 31 to 62 production functions (`executeSyncPipeline` 53) | Needs a ratchet design (per-file budget) and hotspot sequencing; not one bounded PR. |
| D4 | Dynamic `await import(...)` inside default-timeout frontend tests (13 files; `TransactionList.test.tsx` flaked once under host load) | Low evidence (1 contention-induced failure, 0 in clean runs). Watch. |
| D5 | 23 moderate and 10 low npm advisories | Below the high/critical gate; handled by the audit-waiver process. |
| D6 | Non-canonical over-weight evidence (trailing byte, non-minimal CompactSize, truncated tail) bypasses the canonical preflight on both parse paths and pays the quadratic parse before `malformed`/`non_canonical` rejection | Pre-existing (#966/#968 deliberately delegate unmeasurable framing to bitcoinjs). D1 removes it at the root. The alternative is a lenient lower-bound weight measurement: a new security-critical framing mode, with re-pinned mutation canaries. |
