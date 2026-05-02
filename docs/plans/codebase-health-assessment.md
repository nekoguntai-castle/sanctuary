# Software Quality Report

Date: 2026-05-01
Owner: TBD
Status: Draft

**Overall Score**: 97/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 765cf0dd (working tree dirty)

This audit covers the current working tree, including the uncommitted device-network visibility fix and the grade follow-up fixes. The follow-up restored the repo's 100% coverage gate and made the configured raw all-files gitleaks scan clean; physical hardware proof work remains deferred.

---

## Hard-Fail Blockers

None under the grade hard-fail gates.

Important non-blocking findings:

- Physical hardware-in-loop wallet proof remains incomplete; this is still the only deferred correctness gap called out in this follow-up.
- The bundled `rg` fallback secret scan can still report PEM-marker fixture/prose hits, but configured gitleaks scans are clean for tracked source and raw all-files scanning.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Tests, lint, and typecheck pass. Functional completeness remains medium because physical hardware-signed wallet fixture evidence is still not complete. |
| Reliability | 15/15 | Request timeout middleware, async timeout/retry helpers, health checks, circuit breakers, typed errors, and structured failure handling are present. |
| Maintainability | 14/15 | Lizard passes with zero warnings and jscpd is 1.98%; largest file is 984 LOC, so the file-size criterion remains partial. |
| Security | 15/15 | High/critical npm audit count is 0; configured tracked-tree and raw all-files gitleaks scans are clean; Zod validation is used at API trust boundaries. |
| Performance | 10/10 | Hot paths use async I/O, bounded concurrency, timeouts, Redis/Lua atomics, and repository/service separation without obvious N+1 issues in inspected paths. |
| Test Quality | 15/15 | The full coverage gate passes at 100% across frontend, backend, and gateway; tests include strong boundary/error coverage. |
| Operational Readiness | 10/10 | Docker/Compose, GitHub Actions, health/readiness endpoints, observability hooks, and structured/redacted logging are present. |
| **TOTAL** | **97/100** | |

---

## Trend

- vs 2026-05-01 (`working-tree-after-e0fa1661`, previous local recovery entry): overall `+/-0`, grade `A -> A`, confidence `High -> High`.
- The earlier full-mode hard cap at `e0fa1661` was 69/D due typecheck and high-severity website dependency findings. Those hard caps remain cleared, and the follow-up removed the coverage-gate and raw all-files gitleaks warnings from the current sidebar/network working tree.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; frontend 457 files/5,983 tests, backend 435 files/9,625 tests with 505 skipped, gateway 21 files/528 tests | `npm run coverage` | Correctness 1.1 -> +6 |
| lint | pass | `npm run lint` | Correctness 1.3 -> +3 |
| typecheck | pass for app and tests | `npm run typecheck`; `npm run typecheck:tests` | Correctness 1.2 -> +4 |
| coverage | 100% statements/branches/functions/lines for frontend, backend, and gateway | `npm run coverage` | Test Quality 6.1 -> +5; repo 100% gate restored |
| dependency vulnerabilities | 0 high/critical; 16 low root advisories | `grade.sh` -> `npm audit --audit-level=high` and `npm audit --json` | Security 4.1 -> +5 |
| secrets | 0 in tracked tree and 0 in raw all-files scan | `scripts/gitleaks-tracked-tree.sh`; `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml` | Security 4.2 -> +4 |
| secret fallback context | 8 `rg` fallback fixture/prose hits; configured gitleaks scans are clean | `grade.sh` fallback; gitleaks tracked-tree and raw all-files scans | Not scored over configured gitleaks gate; source-controlled and raw configured scans are clean |
| complexity | 0 warnings | `npm run quality:lizard` | Maintainability 3.1 -> +5 |
| duplication | 1.98% duplicated lines, 266 clones | `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` | Maintainability 3.2 -> +3 |
| largest file | 984 lines (`e2e/admin-operations.spec.ts`) | `grade.sh` file-size scan | Maintainability 3.3 -> +1 |
| deploy artifacts | 2 | `grade.sh`: Dockerfile/Compose plus GitHub Actions | Operational Readiness 7.1 -> +3 |
| health endpoints | 198 heuristic hits | `grade.sh` heuristics; inspected `server/src/api/health/routes.ts` | Operational Readiness 7.2 -> +2 |
| observability library | present | `grade.sh` heuristics; inspected tracing/logging paths | Operational Readiness 7.3 -> +2 |
| suppression count | 23 | `grade.sh` heuristics plus `rg` inspection | Correctness 1.4 judged High -> +4 |
| timeout/retry count | 1292 | `grade.sh` heuristics plus inspection | Reliability 2.2 judged High -> +4 |
| blocking I/O count | 55 | `grade.sh` heuristics plus inspection | Performance/Reliability judged High where hot paths are async |
| logging call count | 330 | `grade.sh` heuristics plus inspection | Operational Readiness 7.4 judged High -> +3 |
| test file count | 1317 | `grade.sh` heuristics | Test Quality context |
| test sleep count | 10 | `grade.sh` heuristics plus `rg` inspection | Test Quality 6.4 judged High; fixed sleeps are limited to install/e2e helpers and most unit timer behavior is mocked |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: 23 suppressions across 3,460 files are low-density and mostly documented dynamic Prisma, overloaded response wrapper, Electrum protocol, or test override cases (`server/src/repositories/maintenanceRepository.ts`, `server/src/middleware/metrics.ts`, `server/src/services/bitcoin/electrum/publicApi.ts`, targeted tests).
- **[1.5] Functional completeness - Medium -> +1**: the wallet software suite is broad, but prior grade evidence still shows missing real hardware-signed PSBT fixture rows, so hardware-in-loop release confidence is incomplete.
- **[2.1] Error handling quality - High -> +6**: Express routes use `asyncHandler` and typed API errors, and inspected device routes validate and convert errors with context (`server/src/api/devices/crud.ts`, `server/src/middleware/validate.ts`).
- **[2.2] Timeouts and retries - High -> +4**: request-level timeouts and reusable `withTimeout`/`withRetry` utilities cover external I/O and long-running operations (`server/src/middleware/requestTimeout.ts`, `server/src/utils/async.ts`).
- **[2.3] Crash-prone paths - High -> +5**: inspected production paths avoid panic-style assertions; dangerous casts are localized and documented, with broad test coverage around error cases.
- **[3.4] Architecture clarity - High -> +3**: frontend components/hooks/utils and backend api/service/repository boundaries are clear; health/device/validation routes show focused modules instead of flat cross-cutting logic.
- **[3.5] Readability/naming - High -> +2**: inspected files use domain names and small helpers (`filterDevicesByNetwork`, `parseDeviceRequestBody`, `determineOverallStatus`) that make responsibilities explicit.
- **[4.3] Input validation quality - High -> +3**: Zod validation is applied at backend and gateway trust boundaries (`server/src/middleware/validate.ts`, `gateway/src/middleware/validateRequest.ts`, shared mobile API schemas).
- **[4.4] Safe system/API usage - High -> +3**: inspected child-process usage uses argument arrays (`execFileSync`/`spawn`) in tooling; Redis `eval` usage is static-script based, and no user-input shell interpolation was found in production request paths.
- **[5.1] Hot-path efficiency - High -> +5**: request handlers use async database/service calls, repository boundaries, and no obvious synchronous filesystem or shell work in inspected hot paths.
- **[5.2] Data access patterns - High -> +3**: device list/detail and health checks aggregate through service/repository helpers rather than per-row controller loops (`server/src/api/devices/crud.ts`, `server/src/api/health/routes.ts`).
- **[5.3] No blocking in hot paths - High -> +2**: blocking child-process calls are limited to scripts/startup tooling, not normal API request handling.
- **[6.2] Test structure - High -> +4**: focused behavior tests exist for components, hooks, APIs, wallet logic, and the new network-scoped device helper (`tests/utils/networkScopedDevices.test.ts`, `tests/components/DeviceList/DeviceList.branches.test.tsx`).
- **[6.3] Edge cases covered - High -> +3**: the new device tests cover mismatched wallet links, legacy derivation paths, unknown paths, and aggregate-only wallet counts; broader suites cover null/error/timeout/security branches.
- **[6.4] No flaky patterns - High -> +3**: unit tests mostly fake or spy on timers; fixed sleeps are concentrated in install/e2e shell helpers and one Playwright wait, not the primary unit suite.
- **[7.4] Logging quality - High -> +3**: server/gateway loggers add module prefixes, request/trace context, redaction, and structured metadata (`server/src/utils/logger.ts`, `gateway/src/utils/logger.ts`).

### Missing

None for the mechanical follow-up checks. The remaining physical hardware-in-loop proof is tracked as judged functional-completeness debt, not a missing tool signal.

---

## Top Risks

1. Physical hardware-in-loop wallet proof remains incomplete - release confidence for real-device PSBT signing still depends on missing fixture capture.
2. The largest-file point remains partial because `e2e/admin-operations.spec.ts` is 984 LOC; split or classify only when naturally touching that flow.
3. Low-severity dependency advisories remain in the root audit; high/critical dependency risk is still clear.

## Fastest Improvements

1. Capture or explicitly classify the remaining hardware-signed PSBT fixture matrix - expected gain: +2 correctness - effort: hardware-dependent.
2. Split or classify the 984-line E2E/admin operations test only when touching that flow - expected gain: +1 maintainability - effort: 1 hour if a natural boundary exists.
3. Keep the 100% coverage gate, tracked-tree gitleaks, raw all-files gitleaks, lizard, lint, and typecheck checks green through PR review - expected score movement: holds 97/A - effort: ongoing.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Keep A stable | Preserve green tests/lint/typecheck and the configured gitleaks/lizard/jscpd gates. | `npm test`, lint, typecheck, gitleaks tracked-tree, lizard, and jscpd pass. | Holds 97/A |
| 2 | Stronger correctness | Add real hardware-signed PSBT fixture evidence or documented unsupported rows. | Hardware fixture contract passes when required. | +2 correctness |
| 3 | Maintainability polish | Split or formally classify oversized E2E/admin proof files when naturally touching that flow. | Largest-file criterion reaches full credit or remains explicitly justified. | +1 maintainability |

## Strengths To Preserve

- High-volume behavioral tests with strong branch/error coverage.
- Zod validation at backend and gateway trust boundaries.
- Structured, redacted, request-aware logging.
- Clear API/service/repository and frontend component/hook/helper separation.
- Source-controlled quality gates for gitleaks, lizard, jscpd, health checks, Docker/Compose, and GitHub Actions.

## Work To Defer Or Avoid

- Do not split cohesive production modules just to chase the remaining file-size point.
- Do not remove the generated `website/build` gitleaks allowlist unless raw scans are changed to respect ignored build outputs another way.
- Do not force dependency upgrades for the 16 low-severity elliptic-family advisories without hardware-wallet compatibility testing.

## Verification Notes

- `npm run test:run -- tests/components/DeviceList/DeviceList.branches.test.tsx tests/utils/networkScopedDevices.test.ts` - passed, 19 tests after fixing aggregate wallet-count scoping.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - completed during the audit; tests/lint/typecheck passed; high/critical audit count was 0; fallback secret scanner reported fixture/prose hits.
- `npm run coverage` - passed after follow-up fixes; frontend, backend, and gateway all reported 100% statements/branches/functions/lines.
- `npm run typecheck` - passed.
- `npm run typecheck:tests` - passed.
- `npm run lint` - passed.
- `npm run quality:lizard` - passed with zero lizard warnings.
- `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` - passed, 1.98% duplication.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` - passed, no leaks found.
- `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` - passed, no leaks found.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml` - passed, no leaks found.
- `git diff --check` - passed.
