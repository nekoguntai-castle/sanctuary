# Software Quality Report

Date: 2026-05-08
Owner: TBD
Status: Draft

**Overall Score**: 98/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 15d2585a (working tree dirty)

This refresh covers `main` after the admin operations E2E secret-scan fixture follow-up plus the current CI runtime guard split working tree. The earlier audit found and fixed a real coverage hard-fail in newly added Bitcoin network-context branches; the current maintainability loop has removed all unclassified local large-file warnings where a clean split existed.

---

## Hard-Fail Blockers

None in the current working tree.

Resolved during this refresh:

- Full coverage initially failed at frontend statements 99.99% and branches 99.96%; after frontend tests were added, backend coverage then exposed missing branches at 99.97/99.96/99.87. The current `npm run coverage` run is 100% for frontend, server, and gateway.

Important non-blocking findings:

- Physical hardware-in-loop wallet proof remains incomplete; this is still the only correctness gap that needs real device access or committed vendor-signed fixtures. The fixture matrix now distinguishes 11 required missing rows from 4 explicitly blocked unsupported multisig rows.
- Layout `act(...)` warning noise was removed in PR #329; focused Layout tests and full frontend coverage ran without the repeated Layout warning.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Tests, lint, typecheck, API body validation, blocking-I/O guard, and Bitcoin network-boundary guard pass. Functional completeness remains medium until hardware-in-loop signed wallet fixtures are complete. |
| Reliability | 15/15 | Inspected broadcast, draft-update, node-client, and timeout/retry paths use explicit errors, retry boundaries, and contextual handling. |
| Maintainability | 15/15 | Lizard passes with zero warnings and jscpd is 1.68%; admin operations E2E, node-client, wallet create-account selection, mempool, console service, draft service, and the CI runtime guard were split below the warning band. The only warning-band file left is an explicitly classified performance proof harness. |
| Security | 15/15 | `npm audit --audit-level=high` reports 0 high/critical advisories; tracked-tree gitleaks is clean; Zod validation remains present at trust boundaries. |
| Performance | 10/10 | No new hot-path blocking I/O; broadcast/node-client changes preserve async I/O and bounded guardrails. |
| Test Quality | 15/15 | Full coverage is restored to 100% across frontend, server, and gateway with focused tests for the surfaced edge cases. |
| Operational Readiness | 10/10 | Docker/Compose, GitHub Actions, health/readiness endpoints, observability hooks, and structured logging remain present. |
| **TOTAL** | **98/100** | |

---

## Trend

- vs 2026-05-01 (`working-tree-after-765cf0dd`): overall `+1`, grade `A -> A`, confidence `High -> High`.
- The previous deferred correctness gap remains physical hardware-in-loop proof. The new local coverage regression discovered during this refresh was fixed before this report was finalized.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; frontend 469 files/6,022 tests, server 441 passed/22 skipped files with 9,697 passed/507 skipped tests, gateway 21 files/528 tests | `npm run coverage` | Correctness 1.1 -> +6 |
| lint | pass | `npm run lint` | Correctness 1.3 -> +3 |
| typecheck | pass for app, frontend tests, and server tests | `npm run typecheck:app`; `npm run typecheck:tests`; `npm run typecheck:server:tests` | Correctness 1.2 -> +4 |
| coverage | 100% statements/branches/functions/lines for frontend, server, and gateway | `npm run coverage` | Test Quality 6.1 -> +5 |
| dependency vulnerabilities | 0 high/critical; 12 low root advisories in elliptic-family transitive deps | `npm audit --audit-level=high` | Security 4.1 -> +5 |
| secrets | 0 tracked-tree leaks | `GITLEAKS_BIN=/home/nekoguntai/.local/bin/gitleaks bash scripts/gitleaks-tracked-tree.sh` | Security 4.2 -> +4 |
| complexity | 0 warnings | `npm run quality:lizard` | Maintainability 3.1 -> +5 |
| duplication | 1.68% duplicated lines, 259 exact clones | `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` | Maintainability 3.2 -> +3 |
| largest file | 0 production-source warnings; 0 test warnings; 0 files over 1000 LOC; classified proof-harness warning: 949 lines (`scripts/perf/phase3-benchmark.mjs`, reviewWhenTouched=true) | `node scripts/quality/check-large-files.mjs` | Maintainability 3.3 -> +2 |
| deploy artifacts | 2 | `grade.sh`: Dockerfile/Compose plus GitHub Actions | Operational Readiness 7.1 -> +3 |
| health endpoints | 198 heuristic hits | `grade.sh` heuristics; prior inspection of `server/src/api/health/routes.ts` | Operational Readiness 7.2 -> +2 |
| observability library | present | `grade.sh` heuristics; inspected tracing/logging paths | Operational Readiness 7.3 -> +2 |
| suppression count | 23 | `grade.sh` heuristics plus prior `rg` inspection | Correctness 1.4 judged High -> +4 |
| timeout/retry count | 1306 | `grade.sh` heuristics plus inspection | Reliability 2.2 judged High -> +4 |
| blocking I/O guard | pass; 5 allow-listed production files | `npm run check:blocking-io` via `npm run lint` | Performance/Reliability judged High where hot paths are async |
| logging call count | 338 | `grade.sh` heuristics plus inspection | Operational Readiness 7.4 judged High -> +3 |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: suppressions remain low-density and localized to documented dynamic Prisma, response wrapper, Electrum protocol, and test override cases.
- **[1.5] Functional completeness - Medium -> +1**: the wallet software suite is broad and well-covered, but 11 required real hardware-signed PSBT fixture rows still need physical-device artifacts.
- **[2.1] Error handling quality - High -> +6**: transaction broadcast and draft update paths now cover unsupported wallet networks, missing drafts, non-actionable approvals, optimistic conflicts, and invalid legacy draft UTXO references with explicit error behavior.
- **[2.2] Timeouts and retries - High -> +4**: request-level timeouts and async retry utilities remain in place; draft signature updates retain bounded optimistic retries.
- **[2.3] Crash-prone paths - High -> +5**: inspected production changes avoid assertion-style crashes and either test or document unreachable legacy fallback behavior.
- **[3.4] Architecture clarity - High -> +3**: the codebase keeps clear API/service/repository boundaries; large-test splits follow existing helper/register patterns, and the CI runtime guard now separates manifest inspection from workflow policy enforcement.
- **[3.5] Readability/naming - High -> +2**: admin operations, node-client, wallet validation, mempool dashboard-formatting, console prompt-replay, draft deletion, and CI workflow-policy cases are grouped by behavior instead of mixed into oversized proof files.
- **[4.3] Input validation quality - High -> +3**: Zod/body-validation guard still passes, and unsupported wallet network values fail before broadcast service calls.
- **[4.4] Safe system/API usage - High -> +3**: no dangerous user-input shell/eval patterns were added; gitleaks tracked-tree scan is clean.
- **[5.1] Hot-path efficiency - High -> +5**: broadcast and node-client changes preserve existing async service boundaries.
- **[5.2] Data access patterns - High -> +3**: no new N+1 or unbounded query patterns were introduced.
- **[5.3] No blocking in hot paths - High -> +2**: blocking-I/O guard still passes with the existing allowlist.
- **[6.2] Test structure - High -> +4**: added targeted behavioral tests for UTXO fee-network normalization, fee API network params, draft broadcast edge cases, draft conflict conversion, and draft archival logging; large proofs now separate route/mock harnesses from scenario groups where touched.
- **[6.3] Edge cases covered - High -> +3**: new tests cover legacy `testnet`, unknown networks, missing drafts, unknown approval statuses, invalid draft UTXO references, null effective amounts, and non-optimistic conflicts.
- **[6.4] No flaky patterns - High -> +3**: no sleeps or timing-sensitive assertions were added; the repeated Layout `act(...)` warnings were removed without suppressing warning output.
- **[7.4] Logging quality - High -> +3**: broadcast archival logging remains contextual and structured through the existing logger.

### Missing

- Raw all-files gitleaks scan was not rerun in this slice; tracked-tree gitleaks passed and all changed files are tracked source/tests/docs.
- Physical hardware-in-loop validation still needs device access or committed vendor-signed fixture evidence for the 11 required rows.

---

## Top Risks

1. Physical hardware-in-loop wallet proof remains incomplete - real-device PSBT signing confidence still depends on 11 missing required Ledger/Trezor/BitBox fixture rows; 4 Ledger/BitBox multisig rows are now explicitly blocked as unsupported.
2. The only remaining warning-band file is the classified `scripts/perf/phase3-benchmark.mjs` performance proof harness; it is not an unclassified score blocker, but should still be reviewed if that harness is next touched.
3. Low-severity elliptic-family dependency advisories remain with no safe automatic fix; avoid forced upgrades without hardware-wallet compatibility testing.

## Fastest Improvements

1. Capture the 11 remaining hardware-signed PSBT fixture rows from physical Ledger/Trezor/BitBox devices - expected gain: +2 correctness - effort: hardware-dependent.
2. Keep the large-file gate clean by splitting future production/test warning files only at natural boundaries - expected score movement: none, but protects maintainability - effort: ongoing review.
3. Keep the Layout no-warning state by avoiding redundant async state setters in render-heavy shell components - expected score movement: none, but protects CI diagnosability - effort: ongoing review.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Keep A stable | Preserve coverage, lint, typecheck, gitleaks, lizard, jscpd, API body validation, blocking-I/O, and Bitcoin network-boundary gates. | All listed commands pass on each PR. | Holds 98/A |
| 2 | Cleaner test signal | Preserve the PR #329 Layout no-warning behavior. | Focused Layout tests and full frontend coverage have no repeated Layout act warnings. | No score movement; better diagnosability |
| 3 | Stronger correctness | Add real hardware-signed PSBT fixture evidence for the 11 required rows. | `REQUIRE_HARDWARE_SIGNED_FIXTURES=1` fixture contract passes. | +2 correctness |
| 4 | Maintainability polish | Keep the production/test large-file warning inventory empty, and keep the perf proof-harness classification explicit. | `node scripts/quality/check-large-files.mjs` reports 0 production/test warnings. | Complete |

## Strengths To Preserve

- High-volume behavioral tests with strict 100% coverage gates.
- Guardrail scripts for API body validation, Bitcoin network boundaries, blocking I/O, lizard, duplication, and secrets.
- Zod validation at backend and gateway trust boundaries.
- Structured, redacted, request-aware logging.
- Clear API/service/repository and frontend component/hook/helper separation.

## Work To Defer Or Avoid

- Do not chase historical `tasks/todo.md` unchecked boxes without first re-measuring current evidence; many older active sections are superseded.
- Do not split cohesive production modules solely for the remaining file-size point.
- Do not force dependency upgrades for the low-severity elliptic-family advisories without hardware-wallet compatibility testing.

## Next Slice Queue

1. **Physical Hardware Fixture Capture**: capture the 11 required Ledger/Trezor/BitBox signing artifacts on real devices. Exit with `REQUIRE_HARDWARE_SIGNED_FIXTURES=1` passing.
2. **Classified Perf Proof Harness Watch**: leave `scripts/perf/phase3-benchmark.mjs` cohesive unless it is next touched or a measured maintenance problem appears. Exit with classification metadata still passing.

## Verification Notes

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - initial refresh completed and exposed the coverage hard-fail plus current mechanical signals.
- `npm run test:run -- tests/components/UTXOList.test.tsx tests/api/coreApiModules.test.ts` - passed, 35 tests.
- `cd server && npm test -- tests/unit/api/transactions-http-routes.test.ts tests/unit/services/draftService.test.ts tests/unit/services/bitcoin/nodeClient.test.ts tests/unit/services/bitcoin/transactionService.broadcast.test.ts` - passed, 211 tests.
- `cd server && npm test -- tests/unit/api/transactions-http-routes.test.ts tests/unit/services/bitcoin/nodeClient.test.ts` - passed, 125 tests after the broadcast metadata simplification.
- `cd server && npm test -- tests/unit/api/transactions-http-routes.test.ts` - passed, 87 tests after reviewer hardening.
- `cd server && npm run test:coverage` - passed, 100% server statements/branches/functions/lines.
- `npm run coverage` - passed, 100% frontend/server/gateway statements/branches/functions/lines.
- `npm run typecheck:app` - passed.
- `npm run typecheck:tests` - passed.
- `npm run typecheck:server:tests` - passed.
- `npm run lint` - passed, including API body validation, Bitcoin network-boundary guard at 0 allowed findings, gateway lint, and blocking-I/O guard.
- `npm run quality:lizard` - passed with zero warnings.
- `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` - passed, 1.68% duplication.
- `npm audit --audit-level=high` - passed with 0 high/critical advisories and 12 low advisories.
- `GITLEAKS_BIN=/home/nekoguntai/.local/bin/gitleaks bash scripts/gitleaks-tracked-tree.sh` - passed, no leaks found.
- `npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` - passed, 10 tests after hardware row classification.
- `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` - intentionally fails until the 11 required physical artifacts are committed.
- `npm run typecheck:tests` - passed after the admin operations E2E split.
- `npm run quality:lizard -- e2e/admin-operations.spec.ts e2e/adminOperationsApiMock.ts` - passed after the split.
- `npm run test:e2e -- --project=chromium e2e/admin-operations.spec.ts` - passed, 24 tests after the split.
- `node scripts/quality/check-large-files.mjs` - passed; `e2e/admin-operations.spec.ts` dropped out of the warning inventory, and the largest remaining test file is 961 LOC.
- `npm --prefix server test -- --run tests/unit/services/bitcoin/nodeClient.test.ts` - passed, 40 tests after the node-client test split.
- `npm run typecheck:server:tests` - passed after the node-client test split.
- `npm run quality:lizard -- server/tests/unit/services/bitcoin/nodeClient.test.ts server/tests/unit/services/bitcoin/nodeClient.client-selection.contracts.ts server/tests/unit/services/bitcoin/nodeClient.active-config.contracts.ts server/tests/unit/services/bitcoin/nodeClient.test-node-config.contracts.ts server/tests/unit/services/bitcoin/nodeClientTestContext.ts` - passed after the split.
- `node scripts/quality/check-large-files.mjs` - passed; `server/tests/unit/services/bitcoin/nodeClient.test.ts` dropped out of the warning inventory, and the largest remaining test file is 948 LOC.
- `npm --prefix server test -- --run tests/unit/services/wallet.test.ts` - passed, 66 tests after the wallet create-account validation split.
- `npm run typecheck:server:tests` - passed after the wallet create-account validation split.
- `npm run quality:lizard -- server/tests/unit/services/wallet/create-account-selection.contracts.ts server/tests/unit/services/wallet/create-account-selection.validation.contracts.ts` - passed after the split.
- `node scripts/quality/check-large-files.mjs` - passed; `server/tests/unit/services/wallet/create-account-selection.contracts.ts` dropped out of the warning inventory, and the largest remaining test file is 850 LOC.
- `npm --prefix server test -- --run tests/unit/services/bitcoin/mempool.test.ts` - passed, 29 tests after the mempool dashboard-formatting split.
- `npm run typecheck:server:tests` - passed after the mempool dashboard-formatting split.
- `npm run quality:lizard -- server/tests/unit/services/bitcoin/mempool.test.ts server/tests/unit/services/bitcoin/mempool.dashboard-formatting.contracts.ts` - passed after the split.
- `node scripts/quality/check-large-files.mjs` - passed; `server/tests/unit/services/bitcoin/mempool.test.ts` dropped out of the warning inventory, and the largest remaining test file is 808 LOC.
- `npm --prefix server test -- --run tests/unit/assistant/consoleService.test.ts` - passed, 26 tests after the console prompt-replay split.
- `npm run typecheck:server:tests` - passed after the console prompt-replay split.
- `npm run quality:lizard -- server/tests/unit/assistant/consoleService.test.ts server/tests/unit/assistant/consoleService.promptReplay.contracts.ts` - passed after the split.
- `node scripts/quality/check-large-files.mjs` - passed; `server/tests/unit/assistant/consoleService.test.ts` dropped out of the warning inventory, and the largest remaining test file is 802 LOC.
- `npm --prefix server test -- --run tests/unit/services/draftService.test.ts` - passed, 48 tests after the draft deletion split.
- `npm run typecheck:server:tests` - passed after the draft deletion split.
- `npm run quality:lizard -- server/tests/unit/services/draftService.test.ts server/tests/unit/services/draftService.delete.contracts.ts` - passed after the split.
- `node scripts/quality/check-large-files.mjs` - passed; `server/tests/unit/services/draftService.test.ts` dropped out of the warning inventory, leaving 0 test-file warnings.
- `GITLEAKS_BIN=/home/nekoguntai/.local/bin/gitleaks bash scripts/gitleaks-tracked-tree.sh` - passed after replacing a secret-shaped admin E2E encryption fixture.
- `npm run typecheck:tests` - passed after the admin E2E fixture cleanup.
- `npm run test:e2e -- --project=chromium e2e/admin-operations.spec.ts` - passed, 24 tests after the admin E2E fixture cleanup.
- `npm run quality:lizard -- e2e/adminOperationsApiMock.ts` - passed after the admin E2E fixture cleanup.
- `node tests/ci/check-github-action-runtimes.test.mjs` - passed after the CI runtime guard split.
- `npm run check:github-action-runtimes` - passed after the CI runtime guard split, 16 manifests checked.
- `npm run quality:lizard -- scripts/ci/check-github-action-runtimes.mjs scripts/ci/action-runtime-workflow-guards.mjs` - passed after the split.
- `node scripts/quality/check-large-files.mjs` - passed; production/test warning inventories are now 0, with only the classified perf proof harness above the warning band.
- `git diff --check` - passed.
