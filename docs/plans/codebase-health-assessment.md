# Software Quality Report

Date: 2026-04-17 (Pacific/Honolulu)
Owner: TBD
Status: Draft

**Overall Score**: 69/100 (raw 79/100, capped by hard-fail gate)
**Grade**: D
**Confidence**: High
**Mode**: full
**Commit**: 1cbcef8a

---

## Remediation Update

2026-04-17 follow-up for fastest improvements 1-3 is complete; this is not a full regrade.

- High/critical audit findings are cleared in root, server, and gateway. Root and gateway still report low-severity residual advisories; server reports zero vulnerabilities.
- The two lint-blocking empty catches now record contextual debug information or retain explicit non-empty handling, and `npm run lint:app`, `npm run lint:server`, and `npm run lint:gateway` pass.
- The three flagged API route modules now delegate repository-backed work through service modules, and `npm run check:architecture-boundaries` passes.
- Focused verification also passed: `npm run typecheck:app`, `npm run build` in `server`, `npm run typecheck:server:tests`, `npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts` in `server`, and `git diff --check`.
- The oversized production file blocker is cleared by splitting the agent funding override modal out of `components/AgentManagement/index.tsx`; `node scripts/quality/check-large-files.mjs` now passes with `AgentManagement/index.tsx` at 936 lines.
- The worst lizard hotspot has been reduced: `components/DeviceList/DeviceList.tsx` dropped from CCN 304 to no focused warning after extracting data helpers, preference wiring, wallet-filter banner rendering, header controls, grouped card rendering, record state, and derived data hooks. `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DeviceList` now passes with no warnings; focused DeviceList tests still pass.
- The next focused lizard hotspot is also cleared: `components/WalletList/WalletList.tsx` dropped from CCN 178 to no focused warning, and the related `WalletGridView` warning is gone after extracting wallet data helpers, preference/network hooks, content/header/empty-state renderers, and grid-card subcomponents. `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletList` now passes with no warnings; focused WalletList tests still pass.
- The next hotspot, `components/WalletDetail/WalletDetail.tsx`, has been partially reduced from CCN 135 to CCN 47 by extracting tab-content routing, tab-state handling, admin-agent link loading, modal state/delete handling, address actions, and draft notifications. Focused WalletDetail tests pass, but a full clear needs a broader tab-props context split.
- The NodeConfig hotspot is cleared: `components/NodeConfig/NodeConfig.tsx` dropped from CCN 111 to no focused warning after extracting config load/save hooks, Electrum server controls, proxy/Tor controls, summary helpers, status messages, network tabs, and proxy/Tor subcomponents. `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NodeConfig` now passes with no warnings; the focused NodeConfig suite passes 65 tests.
- The ImportWallet hotspot is cleared: `components/ImportWallet/ImportWallet.tsx` dropped from CCN 105 to no focused warning, and the related `DescriptorInput`, `HardwareImport`, and `QrScanStep` warnings are gone after extracting flow actions, progress/footer/step rendering, descriptor input handlers/sections, hardware actions/sections, and QR scan decoding/sections. `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ImportWallet` now passes with no warnings; the focused ImportWallet suite passes 104 tests.
- The Telegram settings hotspot is cleared: `components/Settings/sections/TelegramSection.tsx` dropped from CCN 103 to no focused warning after extracting Telegram preference payload helpers, settings state/actions, timeout cleanup, result mapping, and form/rendering sections. Focused Settings/Telegram tests pass.
- The TransactionActions hotspot is cleared: `components/TransactionActions.tsx` dropped from CCN 91 to no focused warning after extracting RBF/CPFP action state, draft payload helpers, alerts/buttons, and modal components. Focused TransactionActions tests pass 29 tests.
- The CreateWallet hotspot is cleared: `components/CreateWallet/CreateWallet.tsx` dropped from CCN 87 to no focused warning, and the related `SignerSelectionStep.tsx` warning is gone after extracting wizard state/actions, compatibility helpers, progress/footer/step rendering, signer warnings, and device cards. Focused CreateWallet tests pass 27 tests.
- The ReceiveModal hotspot is cleared: `components/WalletDetail/modals/ReceiveModal.tsx` dropped from CCN 81 to no focused warning after extracting unused-address fetching, selected-address fallback, Payjoin status/URI handling, QR/address/copy rendering, and loading/empty states. Focused ReceiveModal/WalletDetail modal tests pass 46 tests.
- The Send ReviewStep hotspot is cleared: `components/send/steps/ReviewStep.tsx` no longer reports the focused CCN 75/19/17 warnings after extracting address lookup, flow-data construction, signature/broadcast gating, and PSBT upload handlers. Focused send ReviewStep/review tests pass 71 tests.
- The DraftRow hotspot is cleared: `components/DraftList/DraftRow.tsx` dropped from CCN 73 to no focused warning after extracting status/expiration badges, recipient/output rendering, amount/fee display, warning/agent/label sections, row actions, and flow preview toggle. Focused DraftList/DraftRow tests pass 43 tests.
- The PendingTransfersPanel hotspot is cleared: `components/PendingTransfersPanel.tsx` dropped from CCN 73 to no focused warning, and the related `TransferCard.tsx` CCN 35 warning is gone after delegating the legacy root export to the split implementation and extracting transfer-card metadata/actions/rendering helpers. Focused PendingTransfersPanel tests pass 96 tests; the next largest remaining single-component warning is `components/WalletDetail/tabs/AccessTab.tsx` at CCN 69.

---

## Hard-Fail Blockers

- **High/critical vulnerabilities**: `security_high=10` from current npm audit metadata, which triggers the OWASP A06 / CVSS >=7 hard-fail gate and caps the grade at D.
  - Root audit: `8 critical`, `0 high`, `13 low`; root alone exceeds the `>=3` hard-fail threshold.
  - Server audit: `1 critical`, `0 high`, `1 moderate`.
  - Gateway audit: `1 critical`, `0 high`, `8 low`.
  - AI proxy audit: `0` vulnerabilities.
- No tests/typecheck/secrets hard-fail fired: `tests=pass`, `typecheck=pass`, and `secrets=0` from gitleaks.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Tests and typecheck pass, but lint fails with 2 enforced empty-catch errors. |
| Reliability | 12/15 | Timeout/retry and crash-prone-path posture is strong; lint-flagged silent catches keep error-handling quality at Medium. |
| Maintainability | 6/15 | Duplication is low, but lizard reports 122 CCN warnings, largest file is 2,637 lines, and the architecture boundary gate fails. |
| Security | 10/15 | Gitleaks is clean and validation/API usage are strong; dependency high/critical findings score 0 and trigger the cap. |
| Performance | 8/10 | Hot paths mostly use async I/O and timeouts; route/repository boundary drift leaves some data-access risk. |
| Test Quality | 15/15 | Root and backend line/branch/function coverage are 100%; gateway line coverage is 100%; tests cover broad edge cases. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability libraries, and structured logging are present. |
| **TOTAL** | **69/100** | Raw score `79/100`, capped to `69/100` by `security_high >= 3`. |

---

## Trend

- vs 2026-04-15 (`d8d884d8`): overall `-25` (`94 -> 69`), grade `A -> D`, confidence `High -> High`.
- Main movement: current npm audits now report critical advisories in the root/server/gateway package trees, which hard-caps the grade. Secondary regressions are lint failures, architecture-boundary failures, lizard CCN warnings, and an unclassified oversized production file.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; 395 files, 5,540 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh`; exit 0 | Correctness 1.1 |
| typecheck | pass | `grade.sh`; `npm run typecheck:server:tests`; exit 0 | Correctness 1.2 |
| lint | fail; 2 errors | `npm run lint`, `npm run lint:app`, `npm run lint:server`, `npm run lint:gateway`; app/server fail, gateway pass | Correctness 1.3 |
| lint_error_1 | `components/AgentWalletDashboard/index.tsx:141:15` empty catch | ESLint `no-restricted-syntax` | Correctness 1.3 / Reliability 2.1 |
| lint_error_2 | `server/src/services/agentFundingDraftValidation.ts:296:13` empty catch | ESLint `no-restricted-syntax` | Correctness 1.3 / Reliability 2.1 |
| coverage | 100% line coverage | root `coverage/coverage-summary.json`; `npm run test:backend:coverage`; `npm --prefix gateway run test:coverage` | Test Quality 6.1 |
| root_coverage | 100% statements/branches/functions/lines | first stage of `npm run test:coverage:full`; summary file verified | Test Quality 6.1 |
| backend_coverage | 100% statements/branches/functions/lines; 9,084 tests passed, 503 skipped | `npm run test:backend:coverage` with local socket binding allowed | Test Quality 6.1 |
| gateway_coverage | 100% statements/branches/lines, 98.92% functions; 513 tests passed | `npm --prefix gateway run test:coverage` with local socket binding allowed | Test Quality 6.1 |
| security_high | 10 high/critical audit counts | npm audit package metadata: root critical 8, server critical 1, gateway critical 1, AI proxy 0 | Security 4.1 / hard-fail |
| root_audit | 13 low, 0 moderate, 0 high, 8 critical | `npm audit --audit-level=high --json`; exit 1 due findings | Security 4.1 |
| server_audit | 0 low, 1 moderate, 0 high, 1 critical | `npm --prefix server audit --audit-level=high --json`; exit 1 due findings | Security 4.1 |
| gateway_audit | 8 low, 0 moderate, 0 high, 1 critical | `npm --prefix gateway audit --audit-level=high --json`; exit 1 due findings | Security 4.1 |
| ai_proxy_audit | 0 vulnerabilities | `npm --prefix ai-proxy audit --audit-level=high --json`; rerun after sandbox DNS failure | Security 4.1 |
| dependency_paths | root `@trezor/connect-web@9.7.2 -> protobufjs@7.4.0`; server/gateway `protobufjs@7.5.4`; server `hono@4.12.12` | `npm ls ...` | Security 4.1 context |
| secrets | 0 | `/tmp/gitleaks detect`, `/tmp/gitleaks git`, `GITLEAKS_BIN=/tmp/gitleaks bash scripts/gitleaks-tracked-tree.sh` | Security 4.2 |
| rg_secret_fallback | 8 PEM-shaped hits | `grade.sh` rg fallback; superseded by gitleaks | Security 4.2 false-positive context |
| lizard_warning_count | 122 functions with CCN > 15 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w ...`; exit 1 due warnings | Maintainability 3.1 |
| lizard_avg_ccn | 2.36 | lizard CSV over app/server/gateway/ai-proxy/shared/scripts source paths | Maintainability 3.1 |
| lizard_max_ccn | 304 | lizard; top hit `components/DeviceList/DeviceList.tsx` | Maintainability 3.1 context |
| duplication_pct | 2.28% | `npx --yes jscpd@4`; 5,533 duplicated lines, 286 clones, 1,561 files | Maintainability 3.2 |
| largest_file_lines | 2,637 | `grade.sh`; `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 |
| large_file_policy | fail; 5 files >1,000 lines, 1 unclassified production file | `node scripts/quality/check-large-files.mjs`; `components/AgentManagement/index.tsx` is 1,173 lines | Maintainability 3.3 context |
| architecture_boundaries | fail; 3 violations | `npm run check:architecture-boundaries` | Maintainability 3.4 |
| architecture_violations | API routes import repositories directly | `server/src/api/admin/agents.ts`, `server/src/api/admin/mcpKeys.ts`, `server/src/api/agent.ts` | Maintainability 3.4 |
| browser_auth_contract | pass; 557 browser files scanned | `npm run check:browser-auth-contract` | Correctness 1.5 |
| openapi_route_coverage | pass; 315 Express routes, 311 operations, 4 exceptions | `npm run check:openapi-route-coverage` | Correctness 1.5 |
| api_body_validation | pass | `npm run check:api-body-validation` | Security 4.3 |
| deploy_artifact_count | 2 | `grade.sh`; Docker/Compose and GitHub Actions present | Operational Readiness 7.1 |
| health_endpoint_count | 180 | `grade.sh` heuristic evidence | Operational Readiness 7.2 |
| observability_lib_present | 1 | `grade.sh`; OpenTelemetry/Prometheus packages present | Operational Readiness 7.3 |
| validation_lib_present | 1 | `grade.sh`; Zod in server/gateway/AI proxy trust boundaries | Security 4.3 |
| suppression_count | 22 | `grade.sh` heuristic evidence | Correctness 1.4 |
| timeout_retry_count | 1,206 | `grade.sh` heuristic evidence | Reliability 2.2 |
| blocking_io_count | 36 | `grade.sh` heuristic evidence | Performance 5.1/5.3 |
| logging_call_count | 319 | `grade.sh` heuristic evidence | Operational Readiness 7.4 |
| test_file_count | 1,185 | `grade.sh` heuristic evidence | Test Quality 6.2 |
| test_sleep_count | 10 | `rg "sleep\\(|setTimeout\\(" tests server/tests gateway/tests --glob '*.{ts,tsx}'`; direct sleeps isolated to async helper tests | Test Quality 6.4 |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=22` is low for this repository size; inspected suppressions in `server/src/services/agentFundingDraftValidation.ts` are narrow coverage annotations, though two catch blocks still fail lint.
- **[1.5] Functional completeness - High -> +3**: ISO Functional Completeness is strong because 5,540 native tests pass, OpenAPI route coverage passes, browser auth contract passes, and AI proxy/server/gateway validation surfaces are covered.
- **[2.1] Error handling quality - Medium -> +3**: ISO Fault Tolerance is mixed because `src/api/client.ts`, `src/api/refresh.ts`, `server/src/models/prisma.ts`, and `ai-proxy/src/index.ts` use contextual handling, but lint identifies silent catch blocks in `components/AgentWalletDashboard/index.tsx` and `server/src/services/agentFundingDraftValidation.ts`.
- **[2.2] Timeouts and retries - High -> +4**: ISO Availability/Fault Tolerance is strong across `src/api/client.ts`, `src/api/refresh.ts`, `server/src/models/prisma.ts`, AI proxy endpoint checks, and Electrum/DB/service retry paths.
- **[2.3] Crash-prone paths - High -> +5**: ISO Fault Tolerance is strong because direct `process.exit` calls are centralized in small process-exit helpers, and authenticated request access uses `requireAuthenticatedUser(req)` instead of broad `req.user!` assertions.
- **[3.4] Architecture clarity - Medium -> +2**: ISO Modularity is only Medium because the repo has explicit boundaries and enforcement, but `check:architecture-boundaries` fails on repository imports from `server/src/api/admin/agents.ts`, `server/src/api/admin/mcpKeys.ts`, and `server/src/api/agent.ts`.
- **[3.5] Readability/naming - Medium -> +1**: ISO Analyzability is mixed because naming is generally clear, but 122 CCN warnings and large JSX modules such as `components/DeviceList/DeviceList.tsx`, `components/WalletList/WalletList.tsx`, and `components/WalletDetail/WalletDetail.tsx` make review and change analysis harder.
- **[4.3] Input validation quality - High -> +3**: ISO Integrity is strong because `server/src/middleware/validate.ts`, `gateway/src/middleware/validateRequest.ts`, `shared/schemas/mobileApiRequests.ts`, and `ai-proxy/src/requestSchemas.ts` validate trust-boundary payloads, and `check:api-body-validation` passes.
- **[4.4] Safe system/API usage - High -> +3**: ISO Integrity is strong because dangerous grep targets did not find user-fed `eval`, `innerHTML`, or unsafe raw SQL, and inspected Redis Lua calls in `server/src/infrastructure/distributedLock.ts` and `server/src/services/rateLimiting/redisRateLimiter.ts` use fixed scripts.
- **[5.1] Hot-path efficiency - High -> +5**: ISO Time Behaviour is strong because request-facing HTTP and DB paths use async calls, bounded timeouts, retry/backoff, query metrics, and scoped repository/service operations.
- **[5.2] Data access patterns - Medium -> +1**: ISO Resource Utilization is mixed because most repositories batch/select deliberately, but boundary violations and loops such as `validateWalletScope()` in `server/src/api/admin/mcpKeys.ts` keep request-path data access less disciplined.
- **[5.3] No blocking in hot paths - High -> +2**: ISO Capacity is strong by inspection; the 36 blocking-I/O heuristic hits are concentrated in scripts, startup, maintenance, support-package, or ops paths rather than primary request hot paths.
- **[6.2] Test structure - High -> +4**: ISO Testability is strong because tests are organized by app/API/service/repository/gateway/worker/contract scopes with behavioral names and reusable harnesses.
- **[6.3] Edge cases covered - High -> +3**: ISO Functional Completeness is strong because sampled tests cover invalid payloads, refresh terminal/transient failures, agent PSBT mismatch cases, null/default schemas, wallet access, and boundary values.
- **[6.4] No flaky patterns - High -> +3**: ISO Testability is strong because the only direct sleep references are in `server/tests/unit/utils/async.test.ts`, the async helper's own test file.
- **[7.4] Logging quality - High -> +3**: Availability support is strong because `server/src/utils/logger.ts`, `utils/logger.ts`, gateway/AI loggers, and `shared/utils/redact.ts` provide contextual logging and redaction.

### Missing

- No scoring signal remains unknown.
- `npm run test:coverage:full` failed under sandboxed local socket restrictions, then backend and gateway coverage were rerun with socket binding allowed and passed.
- The first AI proxy audit hit sandbox DNS failure; the escalated rerun passed with `0` vulnerabilities.
- `gitleaks` is not on PATH, but `/tmp/gitleaks` is available and was used for full-tree, latest-commit, and tracked-tree scans.

---

## Top Risks

1. Critical dependency advisories trigger the hard-fail gate - root audit reports `8 critical` and server/gateway each report `1 critical`; current paths include `@trezor/connect-web@9.7.2 -> protobufjs@7.4.0`, server/gateway `protobufjs@7.5.4`, and server `hono@4.12.12`.
2. Lint is red on production code - empty catches in `components/AgentWalletDashboard/index.tsx` and `server/src/services/agentFundingDraftValidation.ts` hide malformed-balance/signature-validation details.
3. Architecture boundaries are regressing - three API route modules import repositories directly instead of delegating data access through services.
4. Maintainability signal is materially worse than the prior assessment - lizard reports 122 CCN warnings, including `DeviceList` CCN 304, `WalletList` CCN 178, and `WalletDetail` CCN 135.
5. Oversized-file governance is failing - `components/AgentManagement/index.tsx` is an unclassified 1,173-line production file, and the largest physical file remains 2,637 lines.

## Fastest Improvements

1. Clear high/critical advisories - expected gain: remove hard-fail cap and +5 Security points; effort: medium. Start with `protobufjs >=7.5.5` and `hono >=4.12.14` paths, then rerun all four audits.
2. Fix the two empty catches with contextual handling or narrow helper extraction - expected gain: +2 Correctness and likely +3 Reliability; effort: small.
3. Move direct repository access out of `server/src/api/admin/agents.ts`, `server/src/api/admin/mcpKeys.ts`, and `server/src/api/agent.ts` - expected gain: +1 Maintainability and restores the architecture gate; effort: medium.
4. Classify or split `components/AgentManagement/index.tsx` - expected gain: governance risk reduction now, file-size score only if the largest file drops below 1,000/500; effort: medium.
5. Reduce the highest CCN JSX modules by extracting decision helpers or subcomponents - expected gain: up to +5 Maintainability if lizard warnings are driven to 0; effort: high because 122 warnings must be cleared for full credit.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 0 | Remove hard cap | Update/override vulnerable `protobufjs` and `hono` paths without unsafe downgrades. | Root/server/gateway/AI proxy audits show `0` high/critical. | `69/D` -> about `84/B`. |
| 1 | Restore green gates | Fix empty catches and route/repository boundary violations. | `npm run lint` and `npm run check:architecture-boundaries` pass. | About `+3` to `+6`. |
| 2 | Recover maintainability | Address top CCN modules and classify/split oversized production files. | `lizard_warning_count` trends down sharply; large-file policy passes. | Up to `+7`. |
| 3 | Preserve coverage and ops | Keep root/backend/gateway coverage, gitleaks, OpenAPI, validation, and auth-contract checks green. | Coverage/audit/contract verification remains repeatable in CI. | Keeps A stable after blockers are cleared. |

## Strengths To Preserve

- Native tests and typecheck pass across a large app/server/gateway surface.
- Root and backend coverage are literal 100%; gateway line/branch coverage is 100%.
- Browser auth, refresh locking, CSRF, request validation, OpenAPI coverage, and AI proxy schemas are explicitly tested.
- Gitleaks scans are clean despite the weaker rg fallback reporting PEM-shaped fixture/doc hits.
- Deployment/ops enablers are mature: Docker/Compose, GitHub Actions, health endpoints, OpenTelemetry/Prometheus, and structured logging.

## Work To Defer Or Avoid

- Do not accept npm's force/downgrade remediation paths without hardware-wallet, gateway, and server behavior proof.
- Do not relax lint, architecture, coverage, or audit gates to make the grade pass.
- Do not split proof/generated files purely for score unless reviewability or ownership improves.
- Do not start a framework rewrite; current issues are concrete dependency, boundary, lint, and complexity problems.

## Verification Notes

- `git rev-parse --show-toplevel`, `git status --short`, `git rev-parse --short HEAD`, `bash /home/nekoguntai/.codex/skills/grade/trend.sh slug`, and `trend.sh prev sanctuary_ full` completed.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed: tests pass, typecheck pass, lint fail, coverage unknown in the bundled script, npm audit DNS warning, rg secret fallback hits, and heuristic signals collected.
- `npm run lint` failed after the app lint stage; `npm run lint:app` failed with 1 error, `npm run lint:server` failed with 1 error, and `npm run lint:gateway` passed.
- `npm run check:browser-auth-contract` passed.
- `npm run check:architecture-boundaries` failed with 3 API-to-repository import violations.
- `npm run check:openapi-route-coverage` passed.
- `npm run check:api-body-validation` passed.
- `npm run typecheck:server:tests` passed.
- `npm audit --audit-level=high --json`, `npm --prefix server audit --audit-level=high --json`, `npm --prefix gateway audit --audit-level=high --json`, and `npm --prefix ai-proxy audit --audit-level=high --json` ran; AI proxy needed an escalated rerun after sandbox DNS failure.
- `/tmp/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner`, `/tmp/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1`, and `GITLEAKS_BIN=/tmp/gitleaks bash scripts/gitleaks-tracked-tree.sh` found no leaks.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 ...` produced 122 warnings, average CCN 2.36, and max CCN 304 over source/script paths.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-grade-jscpd .` reported 2.28% duplication.
- `node scripts/quality/check-large-files.mjs` failed because `components/AgentManagement/index.tsx` is an unclassified oversized production file.
- `npm run test:coverage:full` failed in sandbox on backend supertest socket binding; `npm run test:backend:coverage` and `npm --prefix gateway run test:coverage` passed with local socket binding allowed.
- Trend history appended and corrected in `docs/plans/grade-history/sanctuary_.jsonl`.
