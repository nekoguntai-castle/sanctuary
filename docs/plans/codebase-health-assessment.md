# Software Quality Report

Date: 2026-04-20 (Pacific/Honolulu)
Owner: TBD
Status: Draft

**Overall Score**: 92/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: b1f24a73 + working tree

---

## Hard-Fail Blockers

None.

- `tests=pass`: native and coverage test suites pass.
- `typecheck=pass`: TypeScript checks pass.
- `security_high=0`: no high or critical npm advisories across root, server, gateway, or AI proxy audits.
- `secrets=0`: gitleaks found no leaks after normalizing a prior grade-history metadata value to the documented schema.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests, lint, typecheck, browser auth contract, OpenAPI route coverage, and API body validation pass. |
| Reliability | 15/15 | Error handling, request timeouts, retry/backoff, typed validation, and shutdown paths are consistent by inspection. |
| Maintainability | 7/15 | Architecture and duplication are strong, and the large-file policy is green again; lizard now reports 67 CCN warnings and the largest file is a classified 2,637-line proof harness. |
| Security | 15/15 | No high/critical advisories, gitleaks is clean, trust-boundary validation is present, and sampled unsafe API patterns are controlled. |
| Performance | 10/10 | Request-facing I/O is async/bounded; sampled data-access paths use grouped/windowed queries instead of per-row fan-out. |
| Test Quality | 15/15 | App, backend, and gateway coverage gates are green at 100% statements/branches/functions/lines. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability libraries, and contextual logging are present. |
| **TOTAL** | **92/100** | Grade A; no hard-fail cap applied. |

---

## Trend

- vs 2026-04-18 (`219e2d98`): overall `+/-0` (`92 -> 92`), grade `A -> A`, confidence `High -> High`.
- Positive movement: app/backend/gateway coverage gates are now green at 100%.
- Post-audit remediation: large-file classification is green again after extracting dashboard read-model code from `server/src/repositories/agentRepository.ts` into `server/src/repositories/agentDashboardRepository.ts`.
- Current remediation: `WalletStats`, `TransactionRow`, `TransactionList`, `LabelEditor`, `FlowPreview`, `NetworkConnectionCard`, `ServerForm`, `AddressesTab`, `DeviceDetail`, `QRSigningModal`, `DeviceDetailsForm`, `NetworkSyncActions`, `Monitoring`, `WalletDetail`, `WalletTelegramSettings`, `AppRoutes`, `LoginForm`, `ChatTab`, `UsersGroups`, `AIQueryInput`, `Layout`, `SidebarContent`, `PriceChart`, `RestorePanel`, `Variables`, `UTXOGarden`, `DraftList`, `LabelSelector`, `SendTransactionPage`, `LabelManager`, `NotificationToast`, `NotificationPanel`/`NotificationItem`, `BlockVisualizer`, `Block`, `QueuedSummaryBlock`, `PendingTxDot`, `AppearanceTab`, `BackgroundsPanel`, `Account`, and `AgentManagement` are no longer top lizard findings; warning-band file pressure dropped by splitting dashboard repository tests, AgentManagement views, TransactionList helpers, NetworkConnectionCard controller/form helpers, AddressesTab address-list helpers, DeviceDetail page helpers, QR signing modal scan/upload helpers, DeviceDetailsForm render helpers, NetworkSyncActions sync/resync helpers, Monitoring controller/render helpers, WalletDetail controller/view helpers, wallet Telegram settings controller/render helpers, AppRoutes controller/shell helpers, LoginForm header/field/action/footer helpers, ChatTab controller/render helpers, UsersGroups controller/render helpers, AIQueryInput controller/render helpers, Layout controller/render helpers, SidebarContent section helpers, PriceChart tooltip/animated-price helpers, RestorePanel state/modal helpers, Variables controller/render helpers, and UTXOGarden dot/model helpers, and gitleaks now has a pinned project-tooling path.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 399 files/5,568 tests; backend 390 passed/22 skipped files with 9,151 passed/503 skipped tests after current remediation; gateway 20 files/513 tests | `grade.sh`; `npm run test:coverage`; `npm run test:backend:coverage`; `npm run test:coverage` in `gateway` | Correctness 1.1 |
| typecheck | pass | `grade.sh`; native TypeScript check | Correctness 1.2 |
| lint | pass | `grade.sh`; `npm run lint` | Correctness 1.3 |
| browser_auth_contract | pass; 663 browser files scanned | `npm run check:browser-auth-contract` | Correctness 1.5 |
| openapi_route_coverage | pass; 315 Express routes, 311 OpenAPI operations, 4 documented exceptions | `npm run check:openapi-route-coverage` | Correctness 1.5 |
| api_body_validation | pass | `grade.sh`; `npm run check:api-body-validation` through lint | Security 4.3 |
| coverage | app 100%, backend 100%, gateway 100% statements/branches/functions/lines | V8/Vitest coverage summaries | Test Quality 6.1 |
| security_high | 0 high/critical | `npm audit --json`; `npm --prefix server audit --json`; `npm --prefix gateway audit --json`; `npm --prefix ai-proxy audit --json` | Security 4.1 |
| root_audit | 16 low, 0 moderate, 0 high, 0 critical | `npm audit --json` | Security 4.1 context |
| server_audit | 0 vulnerabilities | `npm --prefix server audit --json` | Security 4.1 context |
| gateway_audit | 8 low, 0 moderate, 0 high, 0 critical | `npm --prefix gateway audit --json` | Security 4.1 context |
| ai_proxy_audit | 0 vulnerabilities | `npm --prefix ai-proxy audit --json` | Security 4.1 context |
| secrets | 0 | `scripts/quality.sh` gitleaks lane with pinned `.tmp/quality-tools/gitleaks-8.30.1/gitleaks`; prior `/tmp/gitleaks-grade/gitleaks` scan was also clean | Security 4.2 |
| rg_secret_fallback | 8 raw PEM/API-shaped hits; treated as weaker fallback evidence | `grade.sh` regex fallback | Security 4.2 context |
| lizard_warning_count | 67 functions with CCN > 15 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w .` | Maintainability 3.1 |
| lizard_avg_ccn | 1.4 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard .` | Maintainability 3.1 context |
| lizard_max_ccn | 35; current top JSX component is `AILabelSuggestion` | lizard CSV sort | Maintainability 3.1 context |
| duplication_pct | 2.03%; 276 clones, 5,283 duplicated lines | `npx --yes jscpd@4 .` | Maintainability 3.2 |
| largest_file_lines | 2,637 | `grade.sh`; `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 |
| large_file_classification | pass; `server/src/repositories/agentRepository.ts` is 720 lines, dashboard repository tests are split, and warning-band files are down to 8 | `node scripts/quality/check-large-files.mjs` | Maintainability 3.3 context |
| architecture_boundaries | pass; 1,465 files, 6,093 imports, 9 rules, 40 exceptions | `npm run check:architecture-boundaries` | Maintainability 3.4 |
| deploy_artifact_count | 2 | `grade.sh`; Docker/Compose and GitHub Actions present | Operational Readiness 7.1 |
| health_endpoint_count | 180 | `grade.sh` heuristic | Operational Readiness 7.2 |
| observability_lib_present | 1 | `grade.sh` heuristic | Operational Readiness 7.3 |
| validation_lib_present | 1 | `grade.sh` heuristic | Security 4.3 |
| suppression_count | 22 | `grade.sh` heuristic | Correctness 1.4 |
| timeout_retry_count | 1,209 | `grade.sh` heuristic | Reliability 2.2 |
| blocking_io_count | 36 | `grade.sh` heuristic | Performance 5.1/5.3 |
| logging_call_count | 319 | `grade.sh` heuristic | Operational Readiness 7.4 |
| test_file_count | 1,199 | `grade.sh` heuristic | Test Quality 6.2 |
| test_sleep_count | 10 | `grade.sh` heuristic; direct hits concentrated in async helper tests and UI timers | Test Quality 6.4 |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: ISO Functional Appropriateness is strong because `suppression_count=22` is low for the repository size and inspected suppressions are targeted.
- **[1.5] Functional completeness - High -> +3**: ISO Functional Completeness is strong because native tests pass and browser-auth, OpenAPI-route, architecture, and API-body validation contracts are green.
- **[2.1] Error handling quality - High -> +6**: ISO Fault Tolerance is strong in `src/api/client.ts`, `server/src/middleware/validate.ts`, `server/src/errors/errorHandler.ts`, and gateway validation paths, with typed error conversion and contextual logging.
- **[2.2] Timeouts and retries - High -> +4**: ISO Availability/Fault Tolerance is strong across `src/api/client.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/models/prisma.ts`, Electrum clients, gateway request logging, and AI/admin monitoring calls.
- **[2.3] Crash-prone paths - High -> +5**: ISO Fault Tolerance is strong because process exits are centralized in process-exit helpers and sampled production code avoids broad panic/assert-style paths.
- **[3.4] Architecture clarity - High -> +3**: ISO Modularity is strong because `check:architecture-boundaries` passes and root/server/gateway/shared boundaries are enforced.
- **[3.5] Readability/naming - Medium -> +1**: ISO Analyzability is mixed because naming is generally clear, but 67 lizard warnings and oversized files make review/change analysis harder.
- **[4.3] Input validation quality - High -> +3**: ISO Integrity is strong because Zod schemas validate request bodies, params, query data, and runtime config at trust boundaries.
- **[4.4] Safe system/API usage - High -> +3**: ISO Integrity is strong because inspected `eval` hits in Redis locking/rate-limiting are fixed Lua scripts, Prisma raw SQL uses tagged templates, and browser `innerHTML` hits are test-only.
- **[5.1] Hot-path efficiency - High -> +5**: ISO Time Behaviour is strong because request-facing HTTP, DB, Redis, Electrum, and AI paths use async calls, timeouts, and bounded retry/backoff patterns.
- **[5.2] Data access patterns - High -> +3**: ISO Resource Utilization is strong in `server/src/repositories/agentDashboardRepository.ts`: dashboard data uses `groupBy`, `Promise.all`, and windowed SQL rather than per-agent fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: ISO Capacity is strong because blocking-I/O heuristic hits are concentrated in scripts, startup, shutdown, support, or maintenance paths.
- **[6.2] Test structure - High -> +4**: ISO Testability is strong because app, server, and gateway tests are organized by behavior, API/service/repository layer, contract, and branch coverage.
- **[6.3] Edge cases covered - High -> +3**: Functional Completeness is strong because sampled tests cover invalid payloads, auth refresh failures, rate-limit boundaries, coverage policy, null/default schemas, wallet access, and async timeout utilities.
- **[6.4] No flaky patterns - High -> +3**: ISO Testability is strong because direct sleeps are isolated to async utility tests and local UI timers; main suites use deterministic assertions and fake timers where appropriate.
- **[7.4] Logging quality - High -> +3**: Availability support is strong because `server/src/utils/logger.ts`, gateway request logging, request context, and redaction utilities provide contextual, redacted logs.

### Missing

- No scoring signal remains unknown.
- Reproducibility note: `scripts/quality.sh` now resolves gitleaks through explicit `GITLEAKS_BIN`, pinned `.tmp/quality-tools/gitleaks-8.30.1/gitleaks`, or bootstrap from `GITLEAKS_VERSION=8.30.1`; the pinned-path gitleaks-only quality lane passed with `QUALITY_BOOTSTRAP_TOOLS=0`.
- Environment note: backend and gateway coverage needed escalated execution because sandboxed `supertest` listeners failed with `listen EPERM 0.0.0.0`; escalated reruns passed.
- The bundled `grade.sh` did not auto-detect the repo's `test:coverage` script name; coverage was measured directly with app, backend, and gateway coverage commands.
- The bundled `grade.sh` root `npm audit` attempt hit sandbox DNS (`EAI_AGAIN`); direct npm audits were rerun with network approval and succeeded.

---

## Top Risks

1. Complexity remains the largest score drag - lizard reports 67 functions above CCN 15, led by `AILabelSuggestion` among JSX components.
2. File-size pressure remains in the warning band - the hard large-file policy is green, but `server/tests/unit/api/admin-agents-routes.test.ts`, `e2e/admin-operations.spec.ts`, and several other production/test files remain above 800 lines.
3. Secret scanning now has pinned project-tooling support, but the weaker regex fallback still reports fixture/doc-shaped hits.
4. Low-severity dependency advisories remain - root has 16 low advisories and gateway has 8 low advisories; suggested fixes include behavior-risky major-version changes.
5. Verification friction remains in sandboxed environments - backend/gateway supertest coverage needs local listener permissions.

## Fastest Improvements

1. Reduce top lizard components - expected gain: up to +5 Maintainability if warnings reach 0; effort: high, with `AILabelSuggestion` as the clear next starting point.
2. Continue shrinking warning-band production/test files where ownership and reviewability improve - expected gain: maintainability stability; effort: medium.
3. Keep pinned gitleaks project tooling exercised in CI/local quality runs - expected gain: stable secret-scan reproducibility; effort: small.
4. Continue low-advisory triage without unsafe major downgrades - expected gain: security posture stability; effort: medium.

## Roadmap To Stronger A

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 0 | Maintain green large-file policy | Keep `agentRepository.ts` and new dashboard repository under 1,000 lines; avoid classifying production files. | `node scripts/quality/check-large-files.mjs` exits 0. | Score stays about `92/A`, but gate remains green. |
| 1 | Reduce complexity concentration | Extract top JSX decision/render helpers from the highest CCN components. | lizard warnings trend below 15. | `+1` to `+3`; `WalletStats`, `TransactionRow`, `TransactionList`, `NetworkConnectionCard`, `AddressesTab`, `DeviceDetail`, `QRSigningModal`, `DeviceDetailsForm`, `NetworkSyncActions`, `Monitoring`, `WalletDetail`, `WalletTelegramSettings`, `AppRoutes`, `LoginForm`, `ChatTab`, `UsersGroups`, `AIQueryInput`, `Layout`, `SidebarContent`, `PriceChart`, `RestorePanel`, `Variables`, `UTXOGarden`, `DraftList`, `LabelSelector`, `SendTransactionPage`, `LabelManager`, `NotificationToast`, `NotificationPanel`, `BlockVisualizer`, `ThemeSection`, `Account`, and `AgentManagement` extractions have started this trend. |
| 2 | Clear complexity threshold | Continue focused extractions until no function exceeds CCN 15. | `lizard_warning_count=0`. | Up to `+5`, about `97/A`. |
| 3 | Harden audit reproducibility | Keep pinned gitleaks project tooling and grade-history metadata on the documented schema. | gitleaks scans report zero raw findings without manual triage. | Confidence stays High with less manual interpretation; pinned local tooling is now in place. |
| 4 | Keep gates green | Preserve 100% coverage, lint/typecheck, architecture, route, auth, and validation checks. | All quality gates pass repeatedly in CI and local audit. | Preserves A-grade stability. |

## Strengths To Preserve

- App, backend, and gateway coverage gates are all green at 100%.
- High/critical dependency risk, lint, typecheck, route coverage, architecture-boundary drift, browser auth contracts, and API body validation are green.
- Request validation, runtime config validation, request context, and redacted logging are strong system-boundary controls.
- Agent dashboard data access is isolated in `server/src/repositories/agentDashboardRepository.ts` and uses grouped/windowed queries, which avoids obvious fan-out regressions as agent counts grow.
- Operational readiness is mature: Docker/Compose, GitHub Actions, health endpoints, observability packages, request context, and redacted logging are present.

## Work To Defer Or Avoid

- Do not lower coverage thresholds; the current 100% gates are passing.
- Do not accept npm audit suggestions that downgrade hardware-wallet or Firebase packages without behavior proof.
- Do not split generated/proof artifacts purely for score unless ownership and reviewability improve.
- Do not relax lizard, architecture, lint, route coverage, or validation gates to preserve the A grade.

## Verification Notes

- `git rev-parse --show-toplevel`, `git status --short --branch`, `git rev-parse --short HEAD`, `trend.sh prev sanctuary_ full`, and `trend.sh append sanctuary_ ... full` completed.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed: tests pass, lint pass, typecheck pass, heuristic signals collected; coverage/audit/secrets/complexity/duplication needed direct supplemental commands as noted above.
- `npm audit --json`, `npm --prefix server audit --json`, `npm --prefix gateway audit --json`, and `npm --prefix ai-proxy audit --json` completed with `security_high=0`.
- `/tmp/gitleaks-grade/gitleaks detect --source . --no-git --redact --report-format json` completed clean after normalizing prior grade-history metadata to the documented schema value.
- `scripts/quality.sh` gitleaks-only lane completed clean through pinned `.tmp/quality-tools/gitleaks-8.30.1/gitleaks` with `QUALITY_BOOTSTRAP_TOOLS=0`.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard .` and `-w .` completed after current remediation: 67 warnings, average CCN 1.4, max CCN 35.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `npm run test:coverage` passed after current remediation: 399 app test files, 5,568 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` passed after current remediation: 390 backend test files passed, 22 skipped; 9,151 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run test:coverage` in `gateway` passed outside the sandbox: 20 files, 513 tests, 100% statements/branches/functions/lines.
- Focused remediation checks passed: `npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/agent/dto.test.ts`, `npx vitest run tests/components/WalletStats.test.tsx`, `npx vitest run tests/components/TransactionList/TransactionRow.branches.test.tsx tests/components/TransactionList.test.tsx`, `npx vitest run tests/components/DraftList.test.tsx tests/components/DraftList/DraftList.branches.test.tsx tests/components/DraftList/DraftRow.branches.test.tsx tests/components/DraftList/utils.branches.test.ts`, `npx vitest run tests/components/LabelSelector.test.tsx`, `npx vitest run tests/components/send/SendTransactionPage.test.tsx tests/components/send/SendTransactionPage.branches.test.tsx`, `npx vitest run tests/components/LabelManager.test.tsx tests/components/NotificationToast.test.tsx tests/components/NotificationToast.branches.test.tsx tests/components/NotificationPanel.test.tsx tests/components/NotificationPanel.branches.test.tsx`, `npx vitest run tests/components/BlockVisualizer/BlockVisualizer.branches.test.tsx tests/components/BlockVisualizer/Block.test.tsx tests/components/BlockVisualizer/QueuedSummaryBlock.test.tsx tests/components/BlockVisualizer/PendingTxDot.test.tsx tests/components/BlockVisualizer/blockUtils.test.ts`, `npx vitest run tests/components/Settings/sections/ThemeSection/AppearanceTab.branches.test.tsx tests/components/Settings/sections/ThemeSection/panels/BackgroundsPanel.branches.test.tsx tests/components/ThemeSection.test.tsx`, `npx vitest run tests/components/Account.test.tsx tests/components/Account.branches.test.tsx tests/components/Account/PasswordForm.branches.test.tsx tests/components/Account/SetupTwoFactorModal.test.tsx tests/components/Account/DisableTwoFactorModal.branches.test.tsx tests/components/Account/BackupCodesModal.test.tsx`, `npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/agentDashboardRepository.test.ts`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletStats.tsx components/WalletStats server/tests/unit/repositories/agentRepository.test.ts server/tests/unit/repositories/agentDashboardRepository.test.ts scripts/quality.sh`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionList/TransactionRow.tsx components/TransactionList/TransactionRow`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DraftList/DraftList.tsx components/DraftList/draftListHelpers.ts components/DraftList/useDraftListController.ts`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/LabelSelector.tsx components/LabelSelector`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/send/SendTransactionPage.tsx components/send/SendTransactionPage`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/LabelManager.tsx components/LabelManager components/NotificationToast.tsx components/NotificationToast components/NotificationPanel.tsx components/NotificationPanel`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/BlockVisualizer/BlockVisualizer.tsx components/BlockVisualizer/BlockVisualizer components/BlockVisualizer/Block.tsx components/BlockVisualizer/Block components/BlockVisualizer/QueuedSummaryBlock.tsx components/BlockVisualizer/QueuedSummaryBlock components/BlockVisualizer/PendingTxDot.tsx components/BlockVisualizer/PendingTxDot`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Settings/sections/ThemeSection/AppearanceTab.tsx components/Settings/sections/ThemeSection/AppearanceTab components/Settings/sections/ThemeSection/panels/BackgroundsPanel.tsx components/Settings/sections/ThemeSection/panels/BackgroundsPanel`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Account/Account.tsx components/Account/Account`, `npm run lint:app`, `npm run lint:server`, `npm run typecheck:app`, and `npm run typecheck:server:tests`.
- AgentManagement batch focused checks passed: `npx vitest run tests/components/AgentManagement.extracted.branches.test.tsx tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts tests/components/AgentWalletDashboard.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AgentManagement/index.tsx components/AgentManagement/AgentManagement tests/components/AgentManagement.extracted.branches.test.tsx`, `npm run typecheck:app`, and `npm run lint:app`.
- TransactionList batch focused checks passed: `npx vitest run tests/components/TransactionList.test.tsx tests/components/TransactionList/TransactionList.branches.test.tsx tests/components/TransactionList/LabelEditor.test.tsx tests/components/TransactionList/FlowPreview.branches.test.tsx tests/components/TransactionList/useTransactionList.branches.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionList/TransactionList.tsx components/TransactionList/TransactionList components/TransactionList/LabelEditor.tsx components/TransactionList/LabelEditor components/TransactionList/FlowPreview.tsx components/TransactionList/FlowPreview tests/components/TransactionList/TransactionList.branches.test.tsx`, `npm run typecheck:app`, and `npm run lint:app`.
- NetworkConnectionCard batch focused checks passed: `npx vitest run tests/components/NetworkConnectionCard.test.tsx tests/components/NetworkConnectionCard/NetworkConnectionCard.branches.test.tsx tests/components/NetworkConnectionCard/SingletonConfig.branches.test.tsx tests/components/NetworkConnectionCard/PoolConfig.branches.test.tsx tests/components/NetworkConnectionCard/ServerRow.branches.test.tsx tests/components/NetworkConnectionCard/ServerForm.branches.test.tsx tests/components/NetworkConnectionCard/HealthHistoryBlocks.test.tsx tests/components/NetworkConnectionCard/networkConfigHelpers.test.ts`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NetworkConnectionCard/NetworkConnectionCard.tsx components/NetworkConnectionCard/NetworkConnectionCard components/NetworkConnectionCard/ServerForm.tsx components/NetworkConnectionCard/ServerForm components/NetworkConnectionCard/SingletonConfig.tsx components/NetworkConnectionCard/PoolConfig.tsx components/NetworkConnectionCard/ServerRow.tsx components/NetworkConnectionCard/networkConfigHelpers.ts`, `npm run typecheck:app`, and `npm run lint:app`.
- AddressesTab batch focused checks passed: `npx vitest run tests/components/WalletDetail/tabs/AddressesTab.test.tsx tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/tabs/AddressesTab.tsx components/WalletDetail/tabs/AddressesTab tests/components/WalletDetail/tabs/AddressesTab.test.tsx tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts`, `npm run typecheck:app`, and `npm run lint:app`.
- DeviceDetail batch focused checks passed: `npx vitest run tests/components/DeviceDetailPage.test.tsx tests/components/DeviceDetail.test.ts tests/components/DeviceDetail/tabs/DetailsTab.branches.test.tsx tests/components/DeviceDetail/AccountList.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DeviceDetail/DeviceDetail.tsx components/DeviceDetail/DeviceDetail tests/components/DeviceDetailPage.test.tsx tests/components/DeviceDetail.test.ts`, `npm run typecheck:app`, and `npm run lint:app`.
- QRSigningModal batch focused checks passed: `npx vitest run tests/components/qr/QRSigningModal.test.tsx tests/hooks/useQrSigning.test.tsx tests/components/send/QrSigning.test.tsx tests/components/qr/AnimatedQRCode.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/qr/QRSigningModal.tsx components/qr/QRSigningModal tests/components/qr/QRSigningModal.test.tsx tests/hooks/useQrSigning.test.tsx tests/components/send/QrSigning.test.tsx`, `npm run typecheck:app`, and `npm run lint:app`.
- DeviceDetailsForm batch focused checks passed: `npx vitest run tests/components/ConnectDevice/DeviceDetailsForm.test.tsx tests/components/ConnectDevice/DeviceDetailsForm.branches.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ConnectDevice/DeviceDetailsForm.tsx components/ConnectDevice/DeviceDetailsForm`, `npm run typecheck:app`, and `npm run lint:app`.
- NetworkSyncActions batch focused checks passed: `npx vitest run tests/components/NetworkSyncActions.test.tsx tests/components/NetworkSyncActions.branches.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NetworkSyncActions.tsx components/NetworkSyncActions tests/components/NetworkSyncActions.test.tsx tests/components/NetworkSyncActions.branches.test.tsx`, `npm run typecheck:app`, and `npm run lint:app`.
- Monitoring batch focused checks passed: `npx vitest run tests/components/Monitoring.test.tsx tests/components/Monitoring.branches.test.tsx tests/components/Monitoring/ServiceCard.branches.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Monitoring/Monitoring.tsx components/Monitoring tests/components/Monitoring.test.tsx tests/components/Monitoring.branches.test.tsx tests/components/Monitoring/ServiceCard.branches.test.tsx`, `npm run typecheck:app`, and `npm run lint:app`.
- WalletDetail batch focused checks passed: `npx vitest run tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx tests/components/WalletDetail tests/components/WalletDetailWrapper`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletDetail.tsx components/WalletDetail/WalletDetailLoadedView.tsx components/WalletDetail/useWalletDetailController.ts`, `npm run typecheck:app`, and `npm run lint:app`.
- ChatTab batch focused checks passed: `npx vitest run tests/components/Intelligence.tabs.test.tsx tests/components/Intelligence.test.tsx tests/components/IntelligenceTabs/chatTab.contracts.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Intelligence/tabs/ChatTab.tsx components/Intelligence/tabs/ChatConversationList.tsx components/Intelligence/tabs/ChatInputComposer.tsx components/Intelligence/tabs/ChatMessagePane.tsx components/Intelligence/tabs/useChatTabController.ts`, `npm run typecheck:app`, and `npm run lint:app`.
- PriceChart batch focused checks passed: `npx vitest run tests/components/Dashboard/PriceChart.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Dashboard/PriceChart.tsx components/Dashboard/PriceChart`, `npm run typecheck:app`, and `npm run lint:app`.
- RestorePanel batch focused checks passed: `npx vitest run tests/components/BackupRestore.test.tsx tests/components/BackupRestore/useBackupHandlers.branches.test.tsx tests/components/BackupRestore/RestorePanel.branches.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/BackupRestore/RestorePanel.tsx components/BackupRestore/RestorePanel`, `npm run typecheck:app`, and `npm run lint:app`.
- Variables batch focused checks passed: `npx vitest run tests/components/Variables.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Variables.tsx components/Variables`, `npm run typecheck:app`, and `npm run lint:app`.
- UTXOGarden batch focused checks passed: `npx vitest run tests/components/UTXOList/UTXOGarden.test.tsx tests/components/UTXOList.branches.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UTXOList/UTXOGarden.tsx components/UTXOList/UTXOGarden`, `npm run typecheck:app`, and `npm run lint:app`.
- WalletTelegramSettings batch focused checks passed: `npx vitest run tests/components/WalletDetail/WalletTelegramSettings.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletTelegramSettings.tsx components/WalletDetail/WalletTelegramSettings`, `npm run typecheck:app`, and `npm run lint:app`.
- AppRoutes batch focused checks passed: `npx vitest run tests/App.branches.test.tsx tests/src/app/appRoutes.test.ts` (9 tests), `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w App.tsx src/app/AppRoutes`, `npm run typecheck:app`, and `npm run lint:app`.
- LoginForm batch focused checks passed: `npx vitest run tests/components/Login/LoginForm.test.tsx tests/components/Login.test.tsx tests/components/ui/Button.test.tsx` (47 tests), `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Login/LoginForm.tsx components/Login/LoginForm tests/components/Login/LoginForm.test.tsx`, `npm run typecheck:app`, and `npm run lint:app`.
- UsersGroups batch focused checks passed: `npx vitest run tests/components/UsersGroups.test.tsx tests/components/UsersGroups.branches.test.tsx tests/components/UsersGroups/CreateUserModal.test.tsx tests/components/UsersGroups/EditUserModal.branches.test.tsx tests/components/UsersGroups/GroupPanel.branches.test.tsx tests/components/UsersGroups/EditGroupModal.branches.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UsersGroups`, `npm run typecheck:app`, and `npm run lint:app`.
- AIQueryInput batch focused checks passed: `npx vitest run tests/components/AIQueryInput.test.tsx`, `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AIQueryInput.tsx components/AIQueryInput`, `npm run typecheck:app`, and `npm run lint:app`.
- Layout batch focused checks passed: `npx vitest run tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx` (45 tests), `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Layout/Layout.tsx components/Layout/LayoutShell.tsx components/Layout/useLayoutController.ts`, `npm run typecheck:app`, and `npm run lint:app`.
- SidebarContent batch focused checks passed: `npx vitest run tests/components/Layout/SidebarContent.branches.test.tsx tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx` (53 tests), `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Layout/SidebarContent.tsx components/Layout/SidebarContent`, `npm run typecheck:app`, and `npm run lint:app`.
- `npm run check:architecture-boundaries`, `npm run check:browser-auth-contract`, and `npm run check:openapi-route-coverage` passed.
- `node scripts/quality/check-large-files.mjs` passed after extracting dashboard read-model code; `server/src/repositories/agentRepository.ts` is now 720 lines.
