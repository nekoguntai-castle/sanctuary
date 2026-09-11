# Software Quality Report

Date: 2026-09-10
Owner: Claude
Status: Complete

**Overall Score**: 88/100
**Grade**: B
**Confidence**: High
**Mode**: full
**Commit**: `fcc7f70e`

---

## Hard-Fail Blockers

None. `tests=pass` (clean reruns), `typecheck=pass` (six repo-native commands),
`lint=pass`, `security_high=0`, `secrets=0` (repo-config tracked-tree gitleaks).

Near-blocker: `npm run coverage` exits 1 reproducibly (2/2 local runs). One
server test,
`server/tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts:304`
("rejects the impossible combined count shape before projecting any evidence"),
overruns its 20 s budget under coverage instrumentation. It passes the plain
suite, but only barely: 9.8 s isolated, 14.9 s in the full parallel run. The
root cause is the performance defect in Top Risk 1, not a test bug.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests pass on clean reruns (frontend 8416, backend unit 15767, gateway, llm-egress-proxy 176); lint and six typechecks pass; suppression density ~0.1/KLOC. |
| Reliability | 15/15 | Typed fail-closed evidence errors, stage budgets/deadlines, `AbortSignal.timeout` on external I/O; no crash-prone production patterns. |
| Maintainability | 8/15 | 3.1 = 0 (lizard 32 warnings project-wide, 14 production); duplication 1.31%; largest production file 993; 3.4 drops to Medium on a drifted hex/bytes parse pair and a lizard gate blind to `.tsx`. |
| Security | 15/15 | 0 high/critical advisories (23 moderate, 10 low); tracked-tree gitleaks 0; Zod validation at boundaries; no dangerous sinks. |
| Performance | 7/10 | 5.1 Medium: raw-transaction parsing is quadratic in size on Node (20k-input tx = 11 s), and the hex evidence path reaches it before its weight gate. |
| Test Quality | 13/15 | Coverage 100% (frontend/server/gateway); 6.4 Medium: `npm run coverage` fails on a CPU-bound test, plus dynamic-import-in-test and sleep patterns. |
| Operational Readiness | 10/10 | Compose + seven Dockerfiles + CI; health endpoints; observability; structured logging. |
| **TOTAL** | **88/100** | |

---

## Trend

- vs 2026-06-25 report (`7ae26a00`, not in machine history): overall **93 → 88 (-5)**, grade **A → B**, confidence High → High.
  Maintainability 9 → 8, Performance 10 → 7, Test Quality 15 → 13, Correctness/Reliability/Security/Operational unchanged.
- vs last machine-history entry 2026-06-04 (`5a74710b+grade-loop-working-tree`): overall 97 → 88 (-9), grade A → B.

## Quality Delta

From `trend.sh compare` against the 2026-06-04 history entry, with scope labels added:

| Area | Signal | Previous | Current | Interpretation |
| --- | --- | ---: | ---: | --- |
| domain | `correctness` | 18 | 20 | improved (suppression + completeness judged High; tests/typecheck/lint all pass) |
| domain | `maintainability` | 14 | 8 | regressed |
| domain | `performance` | 10 | 7 | regressed — new measured defect (quadratic parse) |
| domain | `test_quality` | 15 | 13 | regressed — coverage command red on a timing test |
| signal | `lizard_warning_count` | 0 | 32 | **newly measured scope**: prior value came from the repo gate scope, which skips `.tsx`; not a like-for-like regression |
| signal | `lizard_max_ccn` | 15 | 85 | newly measured scope (85 is a test file: `tests/components/DeviceDetail/hooks/useDeviceData.ownership.test.tsx`) |
| signal | `duplication_pct` | 1.64 | 1.31 | improved — within bucket (repo jscpd config both runs) |
| signal | `largest_file_lines` | 966 | 993 | regressed — within bucket (production source) |
| signal | `test_file_count` | 1412 | 1931 | improved |
| signal | `blocking_io_count` | 105 | 944 | **scope change — inspect**: 671 hits in `tests/`, 205 in `scripts/`; production has 8 (server/src 4, gateway/src 4), all covered by `check:blocking-io` |
| signal | `test_sleep_count` | 10 | 54 | scope change — inspect (collector now scans all test trees) |
| signal | `timeout_retry_count` | 1335 | 2557 | changed — inspect |

Supplemental, not in the v1 schema: ESLint AST `complexity > 15` over production
source went from **31 (2026-06-25) to 62**, measured with the same ESLint 10.x
config. The growth is real code change. Examples, old CCN measured by linting
the `7ae26a00` blob through stdin with today's config:
`executeSyncPipeline` 17 → 53, `createTransaction` 16 → 26, and
`processJobWithLock` / `processTransactionsPhase` / worker `shutdown` /
`syncWallet` from ≤15 to 27–29. Part of the growth comes from ESLint counting
`?.` and `??` as branches (the optional attempt-runtime pattern).

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass | vitest: frontend 626 files / 8416 tests; server `tests/unit` 684 files / 15767 tests; gateway; llm-egress-proxy 22 files / 176 tests | 1.1 → +6 |
| typecheck | pass | `typecheck:app`, `typecheck:tests`, `typecheck:all`, `typecheck:scripts`, `server tsc --noEmit`, `gateway tsc --noEmit` (grade.sh reported `missing`: no root `tsconfig.json`) | 1.2 → +4 |
| lint | pass | `npm run lint` (eslint ×5 + api-body-validation, bitcoin-network-boundaries, safety-catch-guards, blocking-io) | 1.3 → +3 |
| coverage | 100.00 | vitest v8: frontend 100/100/100/100, server 100/100/100/100 (40099 stmts), gateway 100; llm-egress-proxy 86.73% lines | 6.1 → +5 |
| security_high | 0 | `npm audit` (33 total: 23 moderate, 10 low) | 4.1 → +5 |
| secrets | 0 | gitleaks 8.30.1, repo config + ignore file, tracked tree (`git archive HEAD`) | 4.2 → +4 |
| lizard_warning_count | 32 | lizard 1.21.2 `-w .` (14 production, 11 tests, 5 SQL migrations, 2 scripts) | 3.1 → 0 |
| lizard_avg_ccn / max | 1.5 / 85 | lizard | (info) |
| duplication_pct | 1.31 | jscpd 4.0.9 with `config/tooling/jscpd.json` (5561/423916 lines, 304 clones) | 3.2 → +3 |
| largest_file_lines | 993 | `server/src/repositories/walletRepository.ts` (production source) | 3.3 → +1 |
| deploy_artifact_count | 2 | compose + Dockerfiles, and CI (collector counted 1: it only sees a root `Dockerfile`, which moved to `docker/frontend/Dockerfile`) | 7.1 → +3 |
| health_endpoint_count | 279 | grep heuristic | 7.2 → +2 |
| observability_lib_present | 1 | filesystem | 7.3 → +2 |
| validation_lib_present | 1 | filesystem | 4.3 signal |
| suppression_count | 30 (prod: 16 eslint-disable, 9 ts-expect-error, 12 `as any` / ~346 KLOC) | grep | 1.4 signal |
| timeout_retry_count | 2557 | grep heuristic | 2.2 signal |
| blocking_io_count | 944 (8 in production) | grep heuristic | 5.3 signal |
| logging_call_count | 331 | grep heuristic | 7.4 signal |
| test_file_count | 1931 | filesystem | 6.2 signal |
| test_sleep_count | 54 | grep heuristic | 6.4 signal |

### Measured performance evidence (Top Risk 1)

`bitcoin.Transaction.fromBuffer` / `fromHex` on Node, bitcoinjs-lib 7.0.1,
timed with synthetic canonical transactions of `n` inputs and `n` outputs:

| n | parse ms |
| ---: | ---: |
| 2,500 | 331 |
| 5,000 | 1,033 |
| 10,000 | 3,469 |
| 20,000 | 11,085 |
| 25,000 (1.25 MB, weight 5,000,056) | 23,230 |

Root cause: in the Node build (`src/cjs/index.cjs`), `uint8array-tools` 0.0.8
and 0.0.9 run `Buffer.from(buffer)` on every `readUInt32` / `readInt64`, which
copies the whole transaction for each 4- or 8-byte read. The browser build does
index arithmetic, so the frontend is unaffected. Upstream fixed this in
`uint8array-tools` 0.0.10, published 2026-09-07. bitcoinjs-lib 7.0.2 still
declares `^0.0.9`, which pins exactly 0.0.9. Realistic standard transactions
stay cheap (a 3,000-output batch payout parses in about 36 ms), and PSBT decode
is linear (a 950 KB PSBT decodes in about 103 ms).

The amplifier sits in `server/src/services/bitcoin/rawTransactionEvidence.ts`,
which has two parse paths.

- **Bytes path** (`parseAuthenticatedRawTransactionBytes`), used by production
  sync through `createCompactTransactionEvidenceProjector` in
  `sync/evidenceAuthentication.ts`.
  - It runs an O(n) `measureCanonicalRawTransactionWeight` preflight before
    bitcoinjs.
  - Framing the preflight cannot measure (trailing bytes, non-minimal
    CompactSize, a truncated tail) is deliberately delegated to bitcoinjs. It
    therefore pays the quadratic parse before being rejected: 28.5 s for a
    25k×25k shape with one trailing byte.
- **Hex path** (`parseAuthenticatedRawTransaction`) has no preflight. It runs
  the full bitcoinjs parse, `toHex`, and `getId` first, and only then checks
  `MAX_AUTHENTICATED_TRANSACTION_WEIGHT`.
  - It is reached from `sync/transactionEvidenceProjection.ts:312`,
    `rawTransactionEvidence.ts:286` (`authenticateRawTransactionOutput`), and
    `blockchain/receiveEvidenceAuthentication.ts:48`.
  - Their entry points are all exported but never called in-repo:
    `projectTransactionEvidenceOffThread`, `createTransactionEvidenceProjector`,
    and `syncAddress`.

Reachability was corrected during the remediation's adversarial review.

### Judged Findings

- **[1.4] Suppression density — High → +4**: ~37 production suppressions across ~346 KLOC (~0.1/KLOC); `ts-expect-error` carries descriptions per the ESLint `ban-ts-comment` config.
- **[1.5] Functional completeness — High → +3**: no large unfinished scope. Feature plans under `docs/plans/` are closed or tracked.
- **[2.1] Error handling — High → +6** (Fault Tolerance): `RawTransactionEvidenceError` carries a fixed reason enum and static messages. `getErrorMessage` and the logger are used consistently. `check:safety-catch-guards` enforces its 73 allow-listed groups.
- **[2.2] Timeouts & retries — High → +4** (Availability): `AbortSignal.timeout` in `services/workerDiagnosticsClient.ts`; per-stage remote budgets in `sync/attemptRuntime.ts` and `sync/pipeline.ts`.
- **[2.3] Crash-prone paths — High → +5** (Fault Tolerance): the only production `process.exit` is the deliberate lock-loss hard termination (`worker/workerJobQueue/hardTermination.ts`). About 173 non-null assertions in `server/src`, none in the sampled hot paths.
- **[3.1] Complexity — 0 (mechanical)**: lizard reports 32 functions over CCN 15. Production: `TransactionList.tsx` 49, `WalletRemediationPanel.tsx` 38, `SupportPackageCard.tsx` 37, `Tooltip.tsx` 33, `hasAllowedStageDimensions` 23.
- **[3.4] Architecture & path convergence — Medium → +2** (Modularity/Analyzability): the frontend/server/gateway/shared split and the repository layer are clear. Two drifted pairs, though. The hex and bytes raw-transaction parsers have diverged on fail-fast weight preflight. The repo lizard gate (`scripts/quality.sh` `run_lizard`, `-l javascript -l typescript`) does not scan `.tsx` in a directory walk, so 9 gated warnings stand against 32 real ones.
- **[3.5] Readability — High → +2**: spot-checked `sync/pipeline.ts`, `workerDiagnosticsClient.ts`, `rawTransactionEvidence.ts`, and `worker.ts` (shutdown). Naming and intent comments are strong.
- **[4.3] Input validation — High → +3** (Integrity): Zod at API boundaries; `check:api-body-validation` passes; raw evidence is authenticated against the expected txid.
- **[4.4] Safe API usage — High → +3**: no `eval`, `innerHTML` with user input, string-built SQL, or shell interpolation found in production.
- **[5.1] Hot-path efficiency — Medium → +2** (Time Behaviour): see the measured evidence above. Mitigations already exist: sync projection runs in `worker_threads` (`sync/transactionEvidenceWorkerFactory.ts`) under stage budgets, and a 4 MWU ceiling applies. Even so, the hex path spends O(n²) CPU on hostile over-weight evidence before rejecting it, and a valid ~1 MB transaction costs about 10 s to parse.
- **[5.2] Data access — High → +3** (Resource Utilization): Prisma confined to `server/src/repositories/**`, batched sync phases, and paginated histories.
- **[5.3] Blocking in hot paths — High → +2**: 8 production sync-IO sites, all allow-listed by `check:blocking-io`, none in request handlers.
- **[6.2] Test structure — High → +4**: behavioral tests over a real module graph, contract tests for CI scripts, mutation baselines.
- **[6.3] Edge cases — High → +3**: e.g. `receiveEvidenceAuthentication.test.ts` covers hostile count shapes, per-limit rejection, and event-loop yielding.
- **[6.4] Flaky patterns — Medium → +1** (Testability): `npm run coverage` is red on a CPU-bound test with a hand-raised 20 s timeout. `tests/components/TransactionList.test.tsx` pays a dynamic `await import(...)` inside a 5 s test; it timed out once under concurrent host load and passed on an isolated rerun (1.3 s). 54 sleep/timer patterns.
- **[7.4] Logging — High → +3**: `createLogger` enforced by ESLint `no-restricted-syntax`; `walletLog` gives contextual sync logs.

### Missing / Caveats

- `grade.sh` `jscpd .` walked the full tree and produced no report inside `GRADE_TIMEOUT=2400`, so its value is `unknown`. The repo-config jscpd run (1.31%) is used instead.
- `grade.sh` `typecheck=missing`: there is no root `tsconfig.json`. The repo-native typecheck commands were run instead.
- The raw `gitleaks --no-git .` scan (no repo config) found 119 hits: 67 in ignored `.tmp/` scratch clones, 7 in ignored coverage/dist output, and the rest either untracked or allowlisted by `config/tooling/gitleaks.toml`. The repo-config tracked-tree scan reports 0.
- The first frontend `npm test` inside `grade.sh` failed one test (`TransactionList.test.tsx`, 5 s timeout) while an ESLint scan ran concurrently. The rerun passed, and the coverage run passed all 8416 tests.
- Forgejo CI status for the `Full Backend Unit Coverage` lane on `main` was not queried during grading. The coverage-lane failure is a local reproduction (2/2).

---

## Top Risks

1. **Quadratic raw-transaction parse behind an incomplete weight gate** — CPU amplification from hostile or over-weight evidence, plus a red `npm run coverage` — `server/src/services/bitcoin/rawTransactionEvidence.ts`; transitive `uint8array-tools` 0.0.8/0.0.9 (Node build).
   - The exported hex path `parseAuthenticatedRawTransaction` has no weight preflight at all. It has no in-repo production caller, but its test turns the coverage gate red.
   - The production bytes path (`createCompactTransactionEvidenceProjector`) preflights only canonical framing. Non-canonical over-weight framing, such as a single trailing byte, still reaches the quadratic parser.
2. **Complexity guardrail blind spot** — the repo lizard gate skips `.tsx`, and nothing gates ESLint-measured complexity, which doubled (31 → 62) since June in sync/worker paths — `scripts/quality.sh` `run_lizard`; `server/src/services/bitcoin/sync/pipeline.ts` (53).
3. **Time-sensitive tests under load** — dynamic imports inside default-timeout tests (13 frontend files) and a CPU-bound server test on a raised timeout — `tests/components/TransactionList.test.tsx`, `receiveEvidenceAuthentication.test.ts:304`.

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Raw transaction evidence parse (hex vs bytes) | `rawTransactionEvidence.ts` `parseAuthenticatedRawTransaction` vs `parseAuthenticatedRawTransactionBytes` | rationalize | The bytes path gained the O(n) weight preflight in #966/#968; the hex path did not. Converge the preflight (small, contained fix). |
| Complexity measurement (repo lizard gate vs rubric) | `scripts/quality.sh` `-l javascript -l typescript` vs `lizard .` | rationalize | The gate silently excludes `.tsx`; add `-l tsx` and rebaseline, or adopt an ESLint complexity ratchet. |
| Worker diagnostics protocol v2 / v1 / bare | `services/workerDiagnosticsClient.ts`, `internal/workerDiagnostics/protocol.ts` | justified / watch | Mixed-version rolling compatibility; add a retirement note when v1 workers are unsupported. |
| Hardware-wallet adapters | `src/services/hardwareWallet/adapters/*` | justified | Per-device protocol boundary. |

## Fastest Improvements

1. **Converge the hex evidence path onto the O(n) weight preflight** and prove it with a deterministic test that bitcoinjs is never invoked for over-weight evidence. This fixes the red `npm run coverage` (6.4 → High, +2) and closes the canonical gap on the exported hex API. The production non-canonical bypass remains until item 3 or a lower-bound preflight. Effort: ~2 h.
2. **Add `-l tsx` to the repo lizard gate and rebaseline** so `.tsx` complexity is gated at all. Guardrail; points unchanged until the count drops. Effort: ~1 h.
3. **Adopt `uint8array-tools` 0.0.10 via npm `overrides`** once it has soaked, to fix the quadratic at its root for every Node parse site. Needs a supply-chain decision plus lockfile and hardware-compat-report regeneration. Effort: ~2 h.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Evidence-path fail-fast | Preflight weight on the hex path; deterministic non-regression test; drop the 20 s override | `npm run coverage` green; the test runs in ms | 88 → ~93 (Performance +3, Test Quality +2) |
| 2 | Gate `.tsx` complexity | `-l tsx` in `run_lizard`, rebaseline `LIZARD_WARNING_BASELINE` | Gate count equals project count | guardrail |
| 3 | Root-cause dependency fix | `uint8array-tools` 0.0.10 override after soak | fromBuffer linear (20k inputs < 100 ms) | Performance hardening |
| 4 | Complexity reduction | Reduce production lizard warnings from 14 to ≤5 (TransactionList 49, WalletRemediationPanel 38, SupportPackageCard 37, Tooltip 33, …) | `lizard_warning_count` ≤ 15 project-wide | 3.1: 0 → +1 or +3 |

## Strengths To Preserve

- 100% statement/branch/function/line coverage across frontend, server, and gateway, with 1931 test files.
- Fail-closed, reason-typed transaction evidence authentication with worker-thread isolation and stage budgets.
- Repo-owned guardrails: blocking-IO, safety-catch, API-body-validation, and bitcoin-network-boundary checks; semgrep baseline; large-file classification.
- Zero high/critical advisories and zero tracked secrets.

## Work To Defer Or Avoid

- Do not reimplement a Bitcoin transaction parser to escape the quadratic; bitcoinjs stays the authoritative parser.
- Do not adopt a days-old transitive release into the transaction-parsing path without an explicit supply-chain decision.
- Do not run a broad complexity-refactor campaign. Reduce named hotspots one at a time, with non-regression tests first where funds or signing are involved.
- Do not treat `blocking_io_count` or `test_sleep_count` movement as regression without scoping; most hits are in tests and scripts.

## Prior Status Notes

- The 2026-06-25 selected hotspot (`ExportModal.tsx` CCN 31) was remediated in #549 and no longer appears in either complexity list.
- The 2026-06-25 deferral "do not add the complexity CI gate before reductions land" preceded the ESLint count doubling from 31 to 62. Revisit it with a ratchet rather than a hard threshold.

## Verification Notes

- Branch `codex/grade-loop/initial-grade` (from `origin/main` `fcc7f70e`), worktree `/home/nekoguntai/sanctuary`. Files changed by this grade: `docs/plans/codebase-health-assessment.md`, `docs/plans/grade-history/sanctuary_.jsonl`.
- `npm ci` first (the local install had drifted: `nodemailer` 9.0.1 vs `^9.1.1`).
- `CI=true GRADE_TIMEOUT=2400 bash grade.sh`: tests=fail (contention, see Caveats), lint=pass, typecheck=missing, security_high=0, secrets=119 (raw), lizard=32, duplication=unknown, largest=30918 (generated fixture), deploy=1.
- Clean reruns: `vitest run tests/components/TransactionList.test.tsx` (26/26, 1.28 s); `server: vitest run tests/unit` (684/684); `server: vitest run --coverage tests/unit` failed 2/2 on `receiveEvidenceAuthentication.test.ts:304` (20 s timeout); the same with that single test excluded gives 100% ×4.
- `npm run test:coverage:llm-egress-proxy`: 176/176, 86.73% lines.
- `npm run typecheck:{app,tests,all,scripts}`, `server tsc --noEmit`, `gateway tsc --noEmit`: all exit 0.
- `gitleaks detect --no-git` on `git archive HEAD` with `config/tooling/gitleaks.toml` and `config/tooling/gitleaksignore`: 0 findings.
- `jscpd --config config/tooling/jscpd.json --gitignore`: 1.31%.
- `eslint --rule '{"complexity":["error",15]}'` over production globs: 62; historical CCNs via `git show 7ae26a00:<file> | eslint --stdin`.
- Parse benchmarks: bitcoinjs-lib 7.0.1 on Node 24.14.1 (table above); upstream inspected via `npm pack uint8array-tools@0.0.10 bitcoinjs-lib@7.0.2 varuint-bitcoin@2.0.1`.
