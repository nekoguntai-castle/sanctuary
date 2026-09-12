# Software Quality Report

Date: 2026-09-11
Owner: Claude
Status: Complete

**Overall Score**: 89/100
**Grade**: B
**Confidence**: High
**Mode**: full
**Commit**: `c42035b7` (initial grade for grade-loop run 2026-09-11)

---

## Hard-Fail Blockers

None.

- `tests=pass`: every leg passed on the first run, with no reruns needed.
- `typecheck=pass`: all six repo-native commands.
- `lint=pass`, `security_high=0`, `secrets=0` (repo-config tracked-tree
  gitleaks).

The `transactions-http-routes` backpressure timing race that flaked once in
the previous post-closeout run did not recur. Neither did the
`TransactionList.test.tsx` first-import timeout. Both remain scored under 6.4,
not as gates.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests pass (frontend 8416, backend unit 15870, gateway 565, llm-egress-proxy 176); lint and six typechecks pass; suppression density ~0.1/KLOC. |
| Reliability | 15/15 | Typed fail-closed evidence errors, stage budgets/deadlines, `AbortSignal.timeout` on external I/O; no crash-prone production patterns. |
| Maintainability | 9/15 | 3.1 = 0 (lizard 32 warnings project-wide, 14 production); duplication 1.31%; largest production file 993. 3.4 returns to High: #1059 converged the hex/bytes parse pair and #1060 made the lizard gate scan `.tsx`. |
| Security | 15/15 | 0 high/critical advisories; tracked-tree gitleaks 0; Zod validation at boundaries; no dangerous sinks. |
| Performance | 7/10 | 5.1 Medium: raw-transaction parsing is still quadratic in size on Node (20k-input tx = 11 s). Non-canonical over-weight framing on the production bytes path still reaches the parser (D6); the root fix is D1. |
| Test Quality | 13/15 | Coverage 100% (frontend/server/gateway). 6.4 Medium: two load-sensitive timing patterns remain (the export backpressure race on a 75 ms wall-clock timeout, and first-test dynamic imports), plus 54 sleep/timer patterns. |
| Operational Readiness | 10/10 | Compose + Dockerfiles + CI; health endpoints; observability; structured logging. |
| **TOTAL** | **89/100** | |

---

## Trend

- **vs 2026-09-10 post-closeout (`8b89b70b`): overall 88 → 89 (+1), grade
  B → B, confidence High → High.**
  - Maintainability 8 → 9: 3.4 Architecture & path convergence goes Medium →
    High. Both divergences cited last run are converged, and no new
    candidates appeared (only #1060 quality tooling and #1061 docs landed).
  - Every mechanical signal is unchanged.
- vs 2026-09-10 initial grade (`fcc7f70e`): 88 → 89.
- vs 2026-06-25 report (`7ae26a00`, not in machine history): 93 → 89 (-4).

## Quality Delta

From `trend.sh compare` against the `8b89b70b` history entry:

| Area | Signal | Previous | Current | Interpretation |
| --- | --- | ---: | ---: | --- |
| score | `overall` | `88` | `89` | improved |
| domain | `maintainability` | `8` | `9` | improved (judged 3.4: divergences converged) |

No mechanical signal moved. What changed in evidence quality:

- The repo lizard **gate** now measures `.tsx`: 86 gated warnings, against 9
  before #1060. The rubric's project-wide `lizard .` count (32) was already
  scanning `.tsx`, so it is unchanged.
- `npm run coverage` is green on the first run (the previous post-closeout run
  needed one rerun).

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass | vitest: frontend 626 files / 8416 tests; server `tests/unit` 691 files / 15870 tests; gateway 21 files / 565 tests; llm-egress-proxy 22 files / 176 tests | 1.1 → +6 |
| typecheck | pass | `typecheck:app`, `typecheck:tests`, `typecheck:all`, `typecheck:scripts`, `server tsc --noEmit`, `gateway tsc --noEmit` all exit 0 (grade.sh reports `missing`: no root `tsconfig.json`) | 1.2 → +4 |
| lint | pass | `npm run lint` via grade.sh | 1.3 → +3 |
| coverage | 100.00 | vitest v8: frontend, server, gateway 100/100/100/100; llm-egress-proxy 86.73% lines | 6.1 → +5 |
| security_high | 0 | `npm audit` | 4.1 → +5 |
| secrets | 0 | gitleaks with `config/tooling/gitleaks.toml` + `gitleaksignore` over `git archive HEAD` (raw unconfigured scan: 119, all in ignored/untracked scratch, coverage, and dist output) | 4.2 → +4 |
| lizard_warning_count | 32 | lizard 1.21.2 `-w .`: 14 production, 11 tests, 5 SQL migrations, 2 scripts | 3.1 → 0 |
| lizard_avg_ccn / max | 1.5 / 85 | lizard (85 is a test: `useDeviceData.ownership.test.tsx`) | (info) |
| duplication_pct | 1.31 | jscpd 4.0.9 with `config/tooling/jscpd.json` (5561/423927 lines, 304 clones); grade.sh's whole-tree run was `unknown` | 3.2 → +3 |
| largest_file_lines | 993 | `server/src/repositories/walletRepository.ts` (production source; grade.sh's 30918 is a generated fixture) | 3.3 → +1 |
| deploy_artifact_count | 2 | compose + `docker/*/Dockerfile`, and CI (collector counted 1: it only sees a root `Dockerfile`) | 7.1 → +3 |
| health_endpoint_count | 279 | grep heuristic | 7.2 → +2 |
| observability_lib_present | 1 | filesystem | 7.3 → +2 |
| validation_lib_present | 1 | filesystem | 4.3 signal |
| suppression_count | 30 (prod: 16 `eslint-disable`, 9 `ts-expect-error`, 10 `as any`, 0 `ts-ignore`) | grep | 1.4 signal |
| timeout_retry_count | 2557 | grep heuristic | 2.2 signal |
| blocking_io_count | 944 (8 in production) | grep heuristic | 5.3 signal |
| logging_call_count | 331 | grep heuristic | 7.4 signal |
| test_file_count | 1931 | filesystem | 6.2 signal |
| test_sleep_count | 54 | grep heuristic | 6.4 signal |

Production lizard warnings (CCN > 15):

- `TransactionList.tsx` 49
- `WalletRemediationPanel.tsx` 38
- `SupportPackageCard.tsx` 37 / 21 / 19
- `Tooltip.tsx` 33
- `notifications/telemetry.ts` `hasAllowedStageDimensions` 23
- `FloatingPanel.tsx` `startGesture` 19
- `SubNavItem.tsx` 19
- `restoreTransforms.ts` `invalidateUserSessions` 18
- `notifications/outcomes.ts` `legacyOutcome` 18
- `MempoolSection.tsx` `getNetworkLabel` 17
- `WizardNavigation.tsx` 17
- `api/devices/crud.ts` 16

The five SQL-migration warnings are immutable applied migrations.

### Measured performance evidence (Top Risk 1)

Setup: `bitcoin.Transaction.fromBuffer` / `fromHex` on Node, bitcoinjs-lib
7.0.1, timed with synthetic canonical transactions of `n` inputs and `n`
outputs (measured 2026-09-10; no code change since):

| n | parse ms |
| ---: | ---: |
| 2,500 | 331 |
| 5,000 | 1,033 |
| 10,000 | 3,469 |
| 20,000 | 11,085 |
| 25,000 (1.25 MB, weight 5,000,056) | 23,230 |

**Root cause.** In the Node build, `uint8array-tools` 0.0.8 and 0.0.9 run
`Buffer.from(buffer)` on every `readUInt32` / `readInt64`, which copies the
whole transaction for each 4- or 8-byte read.

**Upstream status.** `uint8array-tools` 0.0.10, published 2026-09-07 by the
bitcoinjs maintainers with a registry signature, replaces those copies with
bounds-checked index arithmetic. The re-inspection on 2026-09-11 compared the
0.0.9 and 0.0.10 packs: the diff touches only `src/cjs/index.cjs`,
`src/mjs/index.js`, and `package.json`.

**Remaining pins.**

- bitcoinjs-lib 7.0.2 still declares `^0.0.9`. `varuint-bitcoin` 2.0.1 has
  moved to `^0.0.10`.
- The installed tree carries 0.0.7 (`tiny-secp256k1`), 0.0.8 (`bip32`,
  `ecpair`, `varuint-bitcoin`), and 0.0.9 (`bitcoinjs-lib`, `bip174`,
  `descriptors-core`).

**Where it still bites.** `server/src/services/bitcoin/rawTransactionEvidence.ts`
has two parse paths, and since #1059 both run `rejectOverweightCanonicalFraming`
first. Framing the preflight cannot measure is still delegated to bitcoinjs,
and pays the quadratic parse before rejection (D6):

- trailing bytes
- non-minimal CompactSize
- a truncated tail

Separately, a *valid* under-ceiling ~4 MWU transaction still costs about 16 s
in the budgeted evidence worker.

### Judged Findings

Judged rows inherit the 2026-09-10 post-closeout scores because signals are
unchanged and no production code changed (only #1060 quality tooling and #1061
docs), except where noted.

- **[1.4] Suppression density — High → +4**: ~35 production suppressions across ~346 KLOC (~0.1/KLOC); `ts-expect-error` carries descriptions per the ESLint `ban-ts-comment` config.
- **[1.5] Functional completeness — High → +3**: no large unfinished scope. Feature plans under `docs/plans/` are closed or tracked.
- **[2.1] Error handling — High → +6** (Fault Tolerance): `RawTransactionEvidenceError` carries a fixed reason enum. `getErrorMessage` and the logger are used consistently. `check:safety-catch-guards` enforces its allow-listed groups.
- **[2.2] Timeouts & retries — High → +4** (Availability): `AbortSignal.timeout` in `services/workerDiagnosticsClient.ts` and `api/transactions/walletTransactions/exportTransactions.ts`; per-stage remote budgets in `sync/attemptRuntime.ts` and `sync/pipeline.ts`.
- **[2.3] Crash-prone paths — High → +5** (Fault Tolerance): the only production `process.exit` is the deliberate lock-loss hard termination (`worker/workerJobQueue/hardTermination.ts`).
- **[3.1] Complexity — 0 (mechanical)**: 32 functions over CCN 15; production list above.
- **[3.4] Architecture & path convergence — High → +3** (was Medium +2) (Modularity/Analyzability):
  - The frontend/server/gateway/shared split and the repository layer are clear.
  - The hex/bytes raw-transaction parse pair shares one preflight (#1059).
  - The repo lizard gate and the rubric now measure the same languages (#1060; `tests/ci/quality-lizard-bootstrap.test.sh` pins the language set).
  - The remaining candidates are justified boundaries (see Divergent Paths).
- **[3.5] Readability — High → +2**: naming and intent comments remain strong (spot-checked `rawTransactionEvidence.ts`, `exportTransactions.ts`, `requestTimeout.ts`).
- **[4.3] Input validation — High → +3** (Integrity): Zod at API boundaries; `check:api-body-validation` passes; raw evidence is authenticated against the expected txid.
- **[4.4] Safe API usage — High → +3**: no `eval`, user-controlled `innerHTML`, string-built SQL, or shell interpolation in production.
- **[5.1] Hot-path efficiency — Medium → +2** (Time Behaviour): see the measured evidence. Sync projection runs in `worker_threads` under stage budgets with a 4 MWU ceiling. The Node parser is still O(n²) per transaction, and non-canonical over-weight framing reaches it before rejection.
- **[5.2] Data access — High → +3** (Resource Utilization): Prisma confined to `server/src/repositories/**`, batched sync phases, and paginated histories.
- **[5.3] Blocking in hot paths — High → +2**: 8 production sync-IO sites, all allow-listed by `check:blocking-io`, none in request handlers.
- **[6.2] Test structure — High → +4**: behavioral tests over a real module graph, contract tests for CI scripts, mutation baselines.
- **[6.3] Edge cases — High → +3**: e.g. `receiveEvidenceAuthentication.test.ts` covers hostile count shapes, per-limit rejection, and event-loop yielding.
- **[6.4] Flaky patterns — Medium → +1** (Testability):
  - `transactionsHttpRoutes.exports.contracts.ts` ("honors production request-timeout cancellation while response backpressure is pending") reaches its target window by wall clock. `withTimeout(75)` has to fire after an 8 MB capture finished but before the paused client drains. Under load the capture can outlast 75 ms, taking the 408 pre-header path instead. It flaked once on 2026-09-10 and passed this run.
  - `tests/components/TransactionList.test.tsx` pays its first `await import(...)` of the component graph inside a 5 s test (25 frontend test files use this pattern). It flaked once under concurrent host load.
  - There are 54 sleep/timer patterns.
- **[7.4] Logging — High → +3**: `createLogger` enforced by ESLint `no-restricted-syntax`; contextual sync logs.

### Missing / Caveats

- `grade.sh` `jscpd .` walked the full tree and produced no report inside `GRADE_TIMEOUT=2400`, so its value is `unknown`. The repo-config jscpd run (1.31%) is used instead.
- `grade.sh` `typecheck=missing`: there is no root `tsconfig.json`. The six repo-native typecheck commands were run instead.
- The raw `gitleaks --no-git .` count (119) includes ignored `.tmp/` clones and coverage/dist output. The repo-config tracked-tree scan reports 0.
- `npm ls --all` flags `@bitcoinerlab/descriptors-core`'s optional peer ranges (`@noble/*` / `@scure/*` ^2) as `invalid` against the hoisted 1.x copies. The lockfile records this as-is; it is not install drift.

---

## Top Risks

1. **Quadratic raw-transaction parse on Node** — CPU amplification from hostile or over-weight evidence, and ~16 s for a valid ~4 MWU transaction — transitive `uint8array-tools` 0.0.7–0.0.9 (Node build); `server/src/services/bitcoin/rawTransactionEvidence.ts`.
   - Non-canonical over-weight framing (trailing byte, non-minimal CompactSize, truncated tail) bypasses the canonical preflight and pays the quadratic parse before rejection (D6).
   - The root fix (D1) is available upstream but needs a supply-chain decision.
2. **Production complexity hotspots** — 14 production functions over CCN 15, now held by the lizard gate's baseline of 86 — `TransactionList.tsx` 49, `WalletRemediationPanel.tsx` 38, `SupportPackageCard.tsx` 37, `Tooltip.tsx` 33.
3. **Load-sensitive tests** — two wall-clock-dependent patterns that have each flaked once under host load — `transactionsHttpRoutes.exports.contracts.ts:609`, `tests/components/TransactionList.test.tsx:194`.

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Raw transaction evidence parse (hex vs bytes) | `rawTransactionEvidence.ts` `parseAuthenticatedRawTransaction` vs `parseAuthenticatedRawTransactionBytes` | justified (converged in #1059) | Both share `rejectOverweightCanonicalFraming` and the validated hex→bytes converter. |
| Complexity measurement (repo lizard gate vs rubric) | `scripts/quality.sh` `run_lizard` vs `lizard .` | justified (converged in #1060) | The gate now scans `javascript`, `typescript`, `tsx`; a contract test pins the set. |
| Worker diagnostics protocol v2 / v1 / bare | `services/workerDiagnosticsClient.ts`, `internal/workerDiagnostics/protocol.ts` | justified / watch | Mixed-version rolling compatibility. Add a retirement note when v1 workers are unsupported. |
| Hardware-wallet adapters | `src/services/hardwareWallet/adapters/*` | justified | Per-device protocol boundary. |

## Fastest Improvements

1. **Adopt `uint8array-tools` 0.0.10 via npm `overrides`**. It fixes the quadratic at its root for every Node parse site, and with it D6's amplification.
   - Needs a supply-chain decision (a 4-day-old release on the transaction-parsing path).
   - Needs a lockfile change and a regenerated `docs/reference/generated/hardware-wallet-compatibility.*`.
   - Expected: Performance 5.1 Medium → High (+3). Effort: ~2 h.
2. **Make the export backpressure timeout test deterministic**, and hoist the first-test component import out of the 5 s test budget in `TransactionList.test.tsx`. Removes the two known load-sensitive patterns. Expected: 6.4 toward High (+0 to +2). Effort: ~2 h.
3. **Reduce one production hotspot at a time** (for example `Tooltip.tsx` 33 or `SupportPackageCard.tsx` 37) behind existing behavioral tests. Guardrail-held: points move only when the project count drops to ≤ 15.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Root-cause parse fix | `uint8array-tools` 0.0.10 override after a supply-chain decision | `fromBuffer` linear (20k inputs < 100 ms); hardware-compat report regenerated | 89 → ~92 (Performance +3) |
| 2 | Deterministic timing tests | Export backpressure test driven by an explicit trigger; first-import hoisting | No wall-clock-gated windows in the named tests | Test Quality +0 to +2 |
| 3 | Complexity reduction | Production lizard warnings from 14 toward ≤ 5 (named hotspots) | Project `lizard_warning_count` ≤ 15 | 3.1: 0 → +1 |

## Strengths To Preserve

- 100% statement/branch/function/line coverage across frontend, server, and gateway, with 1931 test files.
- Fail-closed, reason-typed transaction evidence authentication with worker-thread isolation and stage budgets.
- Repo-owned guardrails: blocking-IO, safety-catch, API-body-validation, and bitcoin-network-boundary checks; the lizard gate now covers `.tsx`; semgrep baseline; large-file classification.
- Zero high/critical advisories and zero tracked secrets.

## Work To Defer Or Avoid

- Do not reimplement a Bitcoin transaction parser to escape the quadratic; bitcoinjs stays the authoritative parser.
- Do not adopt a days-old transitive release into the transaction-parsing path without an explicit supply-chain decision.
- Do not run a broad complexity-refactor campaign. Reduce named hotspots one at a time, with non-regression tests first where funds or signing are involved.
- Do not treat `blocking_io_count` or `test_sleep_count` movement as regression without scoping; most hits are in tests and scripts.

## Prior Status Notes

- 2026-09-10 grade-loop pass 1 (#1059) converged the hex evidence path onto the O(n) weight preflight, which fixed the red `npm run coverage`.
- 2026-09-10 grade-loop pass 2 (#1060) added `-l tsx` to the lizard gate and rebaselined it from 9 to 86.
- The 2026-06-25 selected hotspot (`ExportModal.tsx` CCN 31) was remediated in #549.
- The 2026-06-25 deferral "do not add the complexity CI gate before reductions land" is superseded: the lizard gate with the 86 baseline now acts as a count ratchet.

## Verification Notes

- Branch `codex/grade-loop/initial-grade-0911` (from `origin/main` `c42035b7`), worktree `/home/nekoguntai/sanctuary`. Files changed by this grade: `docs/plans/codebase-health-assessment.md` and `docs/plans/grade-history/sanctuary_.jsonl`.
- Installed tree checked against the lockfile: `node_modules/.package-lock.json` postdates the last `package-lock.json` change, and the server tree is clean.
- `CI=true GRADE_TIMEOUT=2400 bash grade.sh` exit 0:
  - pass: tests (frontend 8416 ×2, server 15870, gateway 565, llm-egress-proxy 176) and lint;
  - coverage 100% ×4, security_high 0, lizard 32 / 1.5 / 85;
  - same caveats as before: `typecheck=missing`, `secrets=119` raw, duplication `unknown`, largest 30918 (fixture), deploy 1.
- `npm run typecheck:{app,tests,all,scripts}`, `server tsc --noEmit`, `gateway tsc --noEmit`: all exit 0.
- gitleaks 8.30.1 on `git archive HEAD` with the repo config and ignore file: 0 findings.
- `jscpd --config config/tooling/jscpd.json --gitignore`: 1.31% (5561/423927, 304 clones).
- `lizard -w -C 15 .` classified by path: 14 production / 11 test / 5 SQL / 2 script.
- `npm pack uint8array-tools@0.0.9 uint8array-tools@0.0.10` diffed; `npm ls uint8array-tools --all` for consumer paths.
- `main` CI for `c42035b7`: all three push runs succeeded (15484–15486).
