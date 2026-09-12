# Grade-Loop Remediation Plan — 2026-09-11

## Source

| Field | Value |
| --- | --- |
| Grade report | `docs/plans/codebase-health-assessment.md` |
| Report date | 2026-09-11 |
| Commit graded | `c42035b7` (`main`) |
| Score | 89/100, grade B, confidence High |
| Task branch | `codex/grade-loop/initial-grade-0911` |
| Selected finding | Top Risk 1 / Fastest Improvement 1 — quadratic raw-transaction parse on Node (D1) |

## Objective

Remove the O(n²) transaction-parse cost at its root by pinning the transitive
`uint8array-tools` dependency to 0.0.10 through npm `overrides`, and lock that
pin behind a named non-regression guard plus a behavioral parity test.

The user made the supply-chain decision to adopt 0.0.10 now (2026-09-11), after
being shown the release date (2026-09-07), the publisher, and the diff
(bounds-checked index arithmetic replacing a per-read whole-buffer
`Buffer.from` copy).

Provenance, stated precisely after review:

- Published `2026-09-07T16:25:53Z` by **`jl.landabaso`**, two years after 0.0.9
  (`2024-08-29`, by `junderw`). Both are listed maintainers of
  `github.com/bitcoinjs/uint8array-tools`.
- `dist.signatures` is present, but there is **no npm provenance attestation**
  — and 0.0.9 has none either, so this is not a regression. Beyond the registry
  signature, the integrity evidence is the lockfile hash, which `npm ci`
  verifies.
- No dependencies and no install scripts.
- The published API is strictly additive against every version this override
  replaces, including `tiny-secp256k1`'s 0.0.7, whose only used export
  (`compare`) is byte-identical in 0.0.10.

### Why this finding

`server/src/services/bitcoin/rawTransactionEvidence.ts` authenticates raw
transaction evidence. Since #1059 both parse paths run an O(n) canonical weight
preflight, but two costs remain, and only the dependency fix removes them:

1. Framing the preflight cannot measure — trailing bytes, non-minimal
   CompactSize, a truncated tail — is deliberately delegated to bitcoinjs and
   pays the quadratic parse before rejection (D6).
2. A *valid* under-ceiling ~4 MWU transaction still costs about 16 s in the
   evidence worker.

Measured with bitcoinjs-lib 7.0.1 on Node 24.14.1 (report table): 20,000
inputs/outputs parse in 11,085 ms; 25,000 in 23,230 ms.

## Non-Goals

- **No** production source change. This PR changes dependency resolution,
  generated release evidence, and tests only.
- **No** change to `rawTransactionEvidence.ts`, the preflight, the weight
  ceiling, or any evidence reason taxonomy. D6's lenient lower-bound framing
  mode stays deferred and becomes far less urgent once parsing is linear.
- **No** bitcoinjs-lib upgrade. It stays at the funds-critical pinned 7.0.1.
- **No** change to the other install roots (`scripts/verify-addresses`,
  `scripts/verify-psbt`, `llm-egress-proxy`, `docs/site`, `tests/ci/lib`). The
  verify-* roots are provenance-pinned; touching their lockfiles invalidates
  generated vectors.
- **No** complexity refactor and **no** timing-test work (deferred, below).

## Phases

### Phase 1 — Pin the dependency

1. Add `"uint8array-tools": "0.0.10"` to the root `package.json` `overrides`
   block, keeping the existing entries untouched and appending in the block's
   existing order.
2. Re-resolve with `npm install --package-lock-only`, then `npm ci` to
   materialize `node_modules` against the new lock. **Never hand-edit
   `package-lock.json`** — `scripts/claude-hooks/block-sensitive-edits.sh`
   blocks it (including from Bash), and npm records no `overrides` key in the
   lock, so a hand edit silently does nothing.
3. **Prove the re-resolution stayed surgical before going further.** #1041
   warns that a *full* re-resolution drifts 487 packages, including
   `@bitcoinerlab/descriptors` 3.1.7 → 3.2.0 (chain-data parsing), and that
   `npm install --package-lock-only` has previously reported "up to date"
   without re-evaluating a new override. Neither failure mode may be assumed
   away in either direction: diff every lockfile entry's version against
   `HEAD` and require that **only** `uint8array-tools` entries changed.

Verified on this tree with npm 11.19.0 (2026-09-11): the override *was*
re-evaluated, and exactly 8 entries changed with no other package touched —
the seven nested copies collapsed into the hoisted entry:

```
node_modules/uint8array-tools: 0.0.8 -> 0.0.10
node_modules/tiny-secp256k1/node_modules/uint8array-tools: 0.0.7 -> (absent)
node_modules/bitcoinjs-lib/node_modules/uint8array-tools: 0.0.9 -> (absent)
node_modules/bitcoinjs-lib/node_modules/varuint-bitcoin/node_modules/uint8array-tools: 0.0.8 -> (absent)
node_modules/bip174/node_modules/uint8array-tools: 0.0.9 -> (absent)
node_modules/bip174/node_modules/varuint-bitcoin/node_modules/uint8array-tools: 0.0.8 -> (absent)
node_modules/@bitcoinerlab/descriptors/node_modules/uint8array-tools: 0.0.9 -> (absent)
node_modules/@bitcoinerlab/descriptors/node_modules/varuint-bitcoin/node_modules/uint8array-tools: 0.0.8 -> (absent)
```

The resulting entry carries the registry integrity
`sha512-sSbrZqlr04w4p8KKpHw0ME/R4JzQaadum+BWhMlk2M7LrDyXWTfJOco3d1jNMdQNxgk5DDm88R3IWYH0nR+tzQ==`.
If a rerun ever produces broader drift, stop and re-plan rather than accepting it.

Files: `package.json`, `package-lock.json`.

### Phase 2 — Regenerate pinned release evidence

`scripts/ci/hardware-compatibility-report.ts` hashes `package-lock.json` into
`packageLockSha256`, and `tests/ci/hardwareCompatibilityReport.test.ts` asserts
the checked-in artifacts equal a fresh build. Any lockfile change breaks it
until the report is regenerated.

Regenerate **preserving the existing identity** — reuse the current
`generatedAt` and `revision` from the checked-in JSON, exactly as
`scripts/bump-version.sh` `run_hardware_report` does. Do not stamp a new
timestamp; this is not a release. The checked-in values are
`generatedAt: 2026-08-11T00:00:00.000Z` and `revision: null`, so `--revision`
is omitted:

```bash
npx tsx scripts/ci/hardware-compatibility-report.ts \
  --as-of 2026-08-11T00:00:00.000Z \
  --json docs/reference/generated/hardware-wallet-compatibility.json \
  --markdown docs/reference/generated/hardware-wallet-compatibility.md
```

Expect `packageLockSha256` to be the only semantic change. Diff the JSON and
confirm no capability row, proof tier, or release decision moved.

Files: `docs/reference/generated/hardware-wallet-compatibility.{json,md}`.

### Phase 3 — Non-regression and parity tests

1. **Named pin guard** in `tests/ci/npmOverridesApplied.test.ts`, following the
   existing `deepmerge-ts` block's pattern: assert the override is at or above
   0.0.10 and that no copy below it ships **in the root lockfile**. This records
   *why* the pin exists so a future dedupe cannot silently drop it.

   **Scope it to the root install root**, unlike the `deepmerge-ts` block, which
   sweeps every install root. `scripts/verify-addresses/package-lock.json`
   (0.0.7, 0.0.8, 0.0.9) and `scripts/verify-psbt/package-lock.json` (0.0.8,
   0.0.9) still carry older copies by design, and
   `scripts/verify-addresses/package-lock.json` is provenance-hashed through
   `VERIFIER_SOURCE_FILES` (`tests/scripts/verifyAddressesGenerated.test.ts`),
   so changing it invalidates generated vectors. An all-roots assertion would
   fail on this tree. State that exclusion in the test comment so the narrower
   scope reads as deliberate.

   The generic assertions in that file already cover the new entry: the run on
   2026-09-11 went from 51 to 53 tests and passed.
2. **Behavioral parity test** in
   `server/tests/unit/services/bitcoin/rawTransactionEvidence.test.ts`, driven
   through bitcoinjs rather than by importing the transitive package directly
   (which is not a declared dependency). 0.0.10 replaces Node `Buffer` reads
   with hand-rolled arithmetic, so the risk it introduces is a mis-read value.
   Round-trip transactions whose fields sit on the boundaries that arithmetic
   touches, asserting parsed fields and txid:
   - output value `2^63 - 1`, all-ones, and `0` (`readInt64` sign composition);
   - input sequence `0xFFFFFFFF` and `0` (`readUInt32`, unsigned range);
   - version bytes `0xFFFFFFFF` and `0x80000000` — bitcoinjs reads the version
     with **`readUInt32`** (`transaction.cjs`), not `readInt32`, so these are
     the cases that discriminate 0.0.10's multiplication-based decode from a
     bitwise one that would wrap above 2^31;
   - a witness item and a legacy input, so both framing paths are read.

   Assemble these bytes directly rather than through the builder API, which
   validates on write and rejects both a negative version and an out-of-range
   value. The read path is what this test exists to cover. Derive the expected
   txid from an independent double-SHA-256 of the bytes, not from
   `Transaction.getId()`, so the assertion cannot restate the library under
   test.
3. **Parse-cost guard** in the same file. Drive it through
   `parseAuthenticatedRawTransactionBytes` on a shape **just under**
   `MAX_AUTHENTICATED_TRANSACTION_WEIGHT`, not through bitcoinjs directly:
   - an over-ceiling shape is rejected by the preflight without ever parsing,
     so it cannot measure parse cost;
   - the under-ceiling case is also the one that matters operationally — valid
     evidence that is accepted and parsed in full;
   - a test that never touches production code would still slow every Stryker
     mutant run for this file without ever killing a mutant.

   13,000 inputs/outputs is 3,744,056 weight units, just inside the ceiling.
   Budget rule: **at least 10× the measured end-to-end time and at most
   2,000 ms**. If 10× the measured time exceeds 2,000 ms, the fix did not work
   — stop and re-plan rather than widening the budget.

   Comment the measured before/after values and state that the assertion is a
   coarse regression guard, not a benchmark. This is the plan's one
   wall-clock-dependent assertion; it is justified because parse cost is the
   defect, and it clears the measured time by more than an order of magnitude —
   unlike the ~1× margins that make the deferred D2 tests flaky.

## Compatibility And Backout

- **Blast radius**: every Node consumer of bitcoinjs/bip32/ecpair/tiny-secp256k1
  — signing, PSBT handling, address derivation, sync evidence. This is why
  Phase 3 asserts value-level parity and why the full suites run.
- **Browser unaffected**: `npm pack` of both versions shows only three files
  differ — `package.json`, `src/cjs/index.cjs`, `src/mjs/index.js`.
  `src/mjs/browser.js`, which the `browser` export condition resolves to, is
  byte-identical, and it already used index arithmetic. Frontend tests run
  under jsdom and may resolve the `node` condition, so they exercise the
  changed build too; the full frontend suite is in the closeout gates.
- **Backout**: revert the `overrides` entry, rerun
  `npm install --package-lock-only` and `npm ci`, then regenerate the report.
  The pin is one line; no production code depends on it.
- **Stop trigger**: if a parity test fails, revert the pin and re-plan. Do not
  adjust the assertion to accommodate a value the previous implementation
  returned differently — that would be the supply-chain risk materializing.
- **Install-script surface unchanged**: `uint8array-tools` 0.0.10 declares no
  `preinstall`/`install`/`postinstall` script and no dependencies, so it needs
  no `scripts/ci/npm-install-script-policy.json` entry.
  `node scripts/ci/check-npm-install-scripts.mjs` passes against the
  re-resolved lock (14 packages, 3 version-pinned scripts allowed).
- **Hardware-wallet risk**: the compat report's capability rows stay
  fail-closed and unverified; only `packageLockSha256` changes. Trezor/Ledger
  adapters go through `@trezor/connect` and `@ledgerhq/*`, which are separately
  pinned funds-critical packages and are not re-resolved by this override
  beyond their shared `uint8array-tools` copy.

### Rejected alternative

Registering `uint8array-tools` in `config/ci-toolchain-lock.json`
`fundsCriticalPackages`. That list pins a reviewed `integrity`, but
`packageSpec()` in `scripts/ci/check-supply-chain-locks.mjs` reads only
`dependencies` / `devDependencies` / `optionalDependencies`, so an override-only
pin would fail its "must declare exact version" rule until the checker learns
about `overrides`. The lockfile already records and `npm ci` already verifies
the tarball integrity, lockfile hand-edits are hook-blocked, and
`npmOverridesApplied` enforces the exact version across every copy recorded in
the lockfile of the install root that declares the override. Deferred as a
separate tooling change rather than bundled here.

## Verification

Per phase:

Root-level vitest needs an explicit config — the repo has no root
`vitest.config.ts`, and `npm run test:run` is
`vitest run --config config/tooling/vitest.config.ts`.

| Phase | Command | Expected |
| --- | --- | --- |
| 1 | `npm ls uint8array-tools --all` | every copy 0.0.10 |
| 1 | `npx vitest run --config config/tooling/vitest.config.ts tests/ci/npmOverridesApplied.test.ts` | pass |
| 2 | `npx vitest run --config config/tooling/vitest.config.ts tests/ci/hardwareCompatibilityReport.test.ts` | pass |
| 3 | `cd server && npx vitest run tests/unit/services/bitcoin/rawTransactionEvidence.test.ts` | pass, new cases included |

Closeout (blast radius is the whole dependency tree, so run the repo's full
gates):

Run `npm ci` first so `node_modules` matches the new lock; every gate below is
meaningless against a stale tree.

```bash
cd server && npx tsc --noEmit && npx vitest run
cd .. && npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run
cd server && npx vitest run --coverage tests/unit   # scoped: CI's shards pass tests/unit
npm run test:coverage                                # frontend, 100% threshold
npm run lint
node scripts/ci/npm-audit-gate.mjs
node scripts/ci/check-supply-chain-locks.mjs
node scripts/ci/check-npm-install-scripts.mjs
```

The audit gate queries the registry advisory endpoint, which has stalled for
hours before (#1012). If it hangs, probe the endpoint rather than retrying
blindly, and do not treat a stall as a code failure.

Also confirm the parse improvement directly, with the same synthetic shape the
report measured. Record the observed time; it sets the committed budget under
the Phase 3.3 rule (≥ 10× observed, ≤ 2,000 ms):

```
20,000 inputs/outputs: 11,085 ms before  ->  expect low tens of ms after
```

## Acceptance Criteria

1. `npm ls uint8array-tools --all` reports 0.0.10 for every copy; no 0.0.7,
   0.0.8, or 0.0.9 remains in the **root** `package-lock.json`. The
   `scripts/verify-*` lockfiles are deliberately untouched and keep theirs.
2. A 13,000-input/output canonical transaction (3,744,056 weight units, just
   under the ceiling so the production path parses it in full) is authenticated
   in under 2,000 ms, asserted by a committed test whose budget is at least 10×
   the locally measured time. A 20,000 in/out shape cannot serve here: at
   ~5.76 MWU the preflight rejects it before the parser ever runs.
3. Value-boundary round-trips produce fields matching Node `Buffer` readers and
   a txid matching an independent double-SHA-256 oracle: max/zero satoshis,
   all-ones satoshis, max/zero sequence, versions at 0xFFFFFFFF and 0x80000000,
   and witness as well as legacy framing.
4. The checked-in hardware compatibility JSON/Markdown equal a fresh build, with
   `generatedAt` and `revision` unchanged from before this PR.
5. Full backend, frontend, gateway, and llm-egress-proxy suites pass; six
   typechecks pass; lint passes; coverage thresholds hold.
6. `npm audit` reports no new high/critical advisory, and the audit gate exits 0.

## Deferred Findings

| ID | Finding | Why deferred |
| --- | --- | --- |
| D6 | Non-canonical over-weight framing (trailing byte, non-minimal CompactSize, truncated tail) bypasses the canonical preflight and reaches the parser | Pre-existing and deliberate (#966/#968 delegate unmeasurable framing to bitcoinjs). A lenient lower-bound weight measurement is a new security-critical framing mode needing re-pinned mutation canaries. This PR removes the amplification that made it matter: the parse it reaches is now linear. |
| D2 | Load-sensitive timing tests: the export backpressure test's 75 ms wall clock (`transactionsHttpRoutes.exports.contracts.ts:609`), first-test dynamic imports (`tests/components/TransactionList.test.tsx:194`, 25 files), and `psbt.hardware-signed-vectors.test.ts` (see below) | Separate, test-only slice; bundling it with a dependency change would confuse a bisect. Candidate for the next pass. |
| D3 | 14 production functions over CCN 15 (`TransactionList.tsx` 49, `WalletRemediationPanel.tsx` 38, `SupportPackageCard.tsx` 37, `Tooltip.tsx` 33) | Held by the #1060 lizard gate baseline (86). Scoring needs the project count ≤ 15, which is a multi-PR campaign; the repo's own guidance is to reduce named hotspots one at a time. |
| D4 | `uint8array-tools` not registered in `fundsCriticalPackages` | See Rejected alternative. Needs `check-supply-chain-locks.mjs` to understand `overrides`. |
| D5 | 23 moderate and 10 low npm advisories | Below the high/critical gate; handled by the audit-waiver process. |

#### New D2 evidence from this pass

A server coverage run started *while an analysis subagent was running* failed
three files: `psbt.hardware-signed-vectors.test.ts` timed out at 10 s on one
test, and `admin.test.ts` / `wallets.test.ts` timed out in their 30 s
`beforeAll` hooks. Host load average was ~22 on 24 cores, and the run's
transform/import phases inflated from 107 s/341 s to 400 s/1000 s.

This is contention, not a regression from the pin — the same file ran **49,134 ms
pre-change** at `c42035b7`, **42,136 ms post-change uncontended** (slightly
faster), and **80,241 ms under load**. The uncontended runs pass.

It does show the flaky surface is wider than the two tests D2 names: a 47 s
test file with 10 s per-test budgets has no headroom. Worth folding into the D2
slice.

## Status

- [x] Phase 1 — pin the dependency. `npm install --package-lock-only` changed
      exactly the 8 `uint8array-tools` entries and nothing else; `npm ci`
      installed the tree; every copy resolves 0.0.10 (`overridden` + `deduped`).
- [x] Phase 2 — regenerate pinned release evidence. `packageLockSha256`
      `3548007131…` → `b0c04c9bd1…` is the only change; the Markdown is
      byte-identical and `generatedAt`/`revision` are unchanged.
- [x] Phase 3 — non-regression and parity tests.
      - `tests/ci/npmOverridesApplied.test.ts`: root-scoped pin guard (55 tests pass).
      - `rawTransactionEvidence.test.ts`: 6 field-parity cases against Node
        `Buffer` readers, a witness-framing case, and the parse-cost guard
        (97 tests pass).
      - The guard runs the production authenticated parse on a 13,000
        in/out, 3,744,056-weight transaction: **122 ms** end to end, budget
        **2,000 ms** (~16× headroom). The pre-fix cost was reproduced on this
        host by installing bitcoinjs-lib 7.0.1 with `uint8array-tools` 0.0.9 in
        an isolated scratch tree: **7,499 ms for the parse step alone**, ~4×
        over the budget, so the guard fails without the pin.
- [x] Closeout verification — 16/16 gates pass on the final tree:
      `server tsc`, `gateway tsc`, `typecheck:{app,tests,all,scripts}`, `lint`,
      server 15878 tests, server unit coverage 100% ×4 (40103 statements),
      frontend 8420 tests, frontend coverage 100% ×4 (24658 statements),
      llm-egress-proxy coverage, `npm-audit-gate` (8 targets, 2 exceptions
      used), `check-supply-chain-locks`, `check-npm-install-scripts`.
      `server tsc` and the server unit coverage run were repeated after the
      final test edit: 684 files, 15779 tests, 100% ×4 (see the D2 note for the
      contention-failed run in between and why it was not a regression).

      The 16th gate is the **receive-evidence mutation profile**, which the
      closeout list originally missed. It matters here specifically: this PR
      edits the only `testFiles` entry of
      `server/stryker.receive-evidence.config.mjs`, that profile is gated at
      `minScore: 90`, and `check-wallet-safety-mutation-map.mjs` counts
      `Timeout` as killed — so making parsing linear could in principle have
      flipped timeout-killed mutants to survived.
      `npm --prefix server run test:mutation:receive-evidence` →
      **93.79** (316 killed + 1 timeout / 338), unchanged, and in 39 s rather
      than the 70–80 s baseline. The two preflight-disabling mutants at
      `rawTransactionEvidence.ts:199` and `:201` flipped Timeout → Killed,
      caught by the existing `spy.mock.calls.length` assertions; the one
      remaining timeout is a genuine infinite loop
      (`AssignmentOperator index -= 1`), unaffected by this change.
      `node scripts/ci/check-wallet-safety-mutation-map.mjs` passes.

### Measured result

`bitcoin.Transaction.fromBuffer` on this host (Node 24.14.1), same synthetic
shapes as the grade report:

| n inputs/outputs | 0.0.9 (pre-fix) | 0.0.10 (pinned) |
| ---: | ---: | ---: |
| 5,000 | 774 ms | 10 ms |
| 10,000 | 3,380 ms | 13 ms |
| 13,000 (near ceiling) | 7,499 ms | 10 ms |
| 20,000 | 11,298 ms | 22 ms |

Parse cost is now linear in transaction size rather than quadratic, and the
20,000 figure reproduces the grade report's 11,085 ms.

### Adversarial review evidence

The Phase 4.5 reviewer differential-tested 0.0.9 against 0.0.10 across **22.4 M
cases** on the CJS build and **11.2 M** on the ESM build: all 8 read functions ×
little/big endian × in-range, exact-fit, one-past-end, negative and
non-integer offsets, over adversarial (`00`/`ff`/`7f`/`80`) and 200k random
buffers. **Zero** value or throw/no-throw divergences.

One benign behavior change: for a negative or non-integer offset, 0.0.9
delegated to Node `Buffer` and raised `RangeError` with
`code: 'ERR_OUT_OF_RANGE'`, while 0.0.10 raises a plain `Error`. Beyond-length
offsets already raised the plain `Error`. Nothing in this repo matches
`ERR_OUT_OF_RANGE`, `instanceof RangeError`, or that message outside
`node_modules`, no caller passes a negative offset, and
`rawTransactionEvidence.ts` catches unconditionally.

No pre-delivery `grade` re-run: the selected finding's evidence is this
measured benchmark plus the committed guard, and the diff is a lockfile, two
test files and generated evidence, so diff-scoped complexity/duplication
signals would say nothing about it. The full-mode post-closeout grade covers
score movement.
