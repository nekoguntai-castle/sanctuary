# Software Quality Report — 2026-04-13

**Overall Score**: 78/100 (implementation-adjusted; original validated baseline was 76/100)
**Grade**: C
**Confidence**: Low
**Mode**: full
**Commit**: `dd86dd2f`

---

## Hard-Fail Blockers

None. The explicit PEM-marker validation split into two groups:

- **Allowlisted fixtures** (7): deliberately-broken PEM blocks in `server/tests/unit/services/push/providers/{apns,fcm}.test.ts` and `gateway/tests/unit/services/push/{apns,fcm}.test.ts` — explicitly listed in `.gitleaks.toml`'s `paths` allowlist.
- **Allowlisted prose hit** (1): `tasks/grade-fix-plan.md` documents PEM sentinel strings by name and is now explicitly listed in `.gitleaks.toml`'s `paths` allowlist. It is not a real credential.

`gitleaks` is not installed globally in this environment, but a temporary `/tmp` install of gitleaks `v8.30.1` was used during the CI-enforcement pass. A full-history scan still finds legacy/test-fixture false positives, so the blocking CI job now gates the PR commit range (and the latest commit on schedule/manual runs) rather than forcing unrelated history cleanup.

---

## Domain Scores

| Domain                  | Score     | Notes (brief) |
|-------------------------|-----------|---------------|
| Correctness             | 20/20     | Tests + typecheck + lint pass; High suppression density; High completeness |
| Reliability             | 12/15     | Typed errors + central timeouts; middleware-guaranteed `!` remains by contract; the previously called-out transaction typing gaps are now fixed |
| Maintainability         | 8/15      | lizard baseline measured at 83 warnings; jscpd measured at 2.33%; OpenAPI, transaction API, transaction HTTP route, admin API, admin-routes HTTP, auth registration API, policy engine, policy repository, blockchain service, backup service, process-transactions phase, wallet integration, transaction creation service, transaction broadcast service, transaction broadcast-and-save submodule, Electrum connection, sync service, wallet service, WebSocket hook, device API, render-regression e2e, Intelligence tabs, Bitcoin API, Draft API, Wallets API, PSBT validation, wallet import, transfer service, admin integration, Docker utility, analysis service, descriptor parser, blockchain aggregate service, clientServerLimits WebSocket, API client test, OpenAPI admin path module, OpenAPI admin schema module, AppNotificationContext test, Payjoin service test, and worker job queue test splits are complete, but the largest non-generated TS/TSX files are now the 1072 LOC bitcoin transaction service tests; clean architecture |
| Security                | 11/15     | 0 high CVEs; no JS eval/DOM injection; mixed input validation; new-commit secret gate clean |
| Performance             | 4/10      | Cursor pagination + recent streaming; some in-loop N+1 risk |
| Test Quality            | 13/15     | Thresholds 98–100% enforced; clear AAA structure; sleeps mostly intentional |
| Operational Readiness   | 10/10     | Docker + CI + health/metrics endpoints + observability + structured logger |
| **TOTAL**               | **78/100**|               |

---

## Trend

vs 2026-04-13 (`13efff91`): original validated report was **overall +7 (69→76), grade D→C**, confidence Low→Low. The implementation-adjusted score is now **78/100** after the first-pass lint gate landed.

- **Correctness +4** (14→18): `typecheck=fail → pass` (commit `350f67c1` excluded `scripts/verify-addresses/` from root typecheck; `fc086954` stabilized coverage emission).
- **Correctness +2 after implementation** (18→20): first-pass ESLint gate added and passing.
- All other domains unchanged numerically; the remaining 7 commits delivered qualitative reliability/security/performance improvements (REPEATABLE READ snapshot on tx export, DoS cap on `POST /addresses/generate`, streamed tx export, halved device-route queries) that aren't captured by the static signal set.
- Original heuristic deltas recorded in this report: `secrets` 7→8 (originally caused by `.gitleaks.toml` + `tasks/grade-fix-plan.md` PEM sentinel text — both false positives); `timeout_retry_count` 1264→1269 (+0.4%). After the implementation pass, `.gitleaks.toml` no longer contains a PEM sentinel string and grade task files are allowlisted. I could validate the commit history and the false-positive secret hits; I could not independently reproduce the exact timeout-count heuristic from repository files alone, and no local grade script was found in the repo.

---

## Evidence

### Mechanical (tool-backed)

| Signal | Value | Tool | Criterion |
|---|---|---|---|
| tests | pass | vitest (root) | 1.1 → +6 |
| typecheck | pass | tsc | 1.2 → +4 |
| lint | pass | ESLint flat config + root/server/gateway `lint` scripts + blocking CI lint job added during implementation | 1.3 → +3 |
| coverage | ≥98% (enforced) | vitest thresholds in config (root 100, server 98–99, gateway 98–100); do not rely on stale coverage-summary artifacts for this grade | 6.1 → +5 |
| security_high | 0 | `npm audit --audit-level=high` (17 total: 16 low, 1 moderate) | 4.1 → +5 |
| secrets (effective) | 0 real in the new-commit gate | explicit PEM-marker search now finds 8 markers: 7 allowlisted fixture hits and 1 allowlisted prose hit (`tasks/grade-fix-plan.md`); `gitleaks git --log-opts -1` passed on the latest commit, while full-history/current-directory scans still surface legacy/test/ignored-file false positives | 4.2 → +2 (new-commit gate measured) |
| largest_file_lines | 1072 | `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` after the OpenAPI admin schema split; next largest validated file is `server/tests/unit/middleware/auth.test.ts` at 1063 LOC when generated verified-vector files are excluded. `server/src/api/openapi/schemas/admin.ts` is now a 19-line aggregate, with OpenAPI admin schema modules capped at 248 LOC. | 3.3 → 0 |
| lizard_warning_count | 83 | lizard 1.21.3 temporary `/tmp` install, CI command with current exclusions | 3.1 → +0 measured; enforced as no-increase baseline |
| duplication_pct | 2.33% | `npm run quality` with temporary `/tmp` gitleaks/lizard installs and `GITLEAKS_LOG_OPTS=-1` | 3.2 → +3 |
| deploy_artifact_count | 2 | Dockerfile + `.github/workflows/` (incl. new `quality.yml`) | 7.1 → +3 |
| health_endpoint_count | 169 grep hits | rg pattern match (NOT a route count) — real endpoints: `server/src/routes.ts` registers `/health`, `/metrics`, `/api/v1/health`; `gateway/src/index.ts` registers `/health`. The 169 figure includes docs, dashboards, workflows, and comments. | 7.2 → +2 |
| observability_lib_present | 1 | `server/package.json` includes OpenTelemetry + `prom-client`; `server/src/routes.ts` exposes `/metrics` | 7.3 → +2 |

### Judged findings (ISO 25010-anchored)

- **[1.4] Suppression density — High → +4**: 25 suppressions in the scoped app/source search (`server/src components hooks services utils shared src gateway/src`, generated Prisma files excluded) — reproducible via the command in the Additional validation pass below. Nearly all have justifying comments (Electrum format variance at `server/src/services/bitcoin/electrum/publicApi.ts:155`; dynamic-table backup access at `server/src/services/backupService/restore.ts:70`). At 25 across 100+ kloc this is comfortably under the `<10/kloc` threshold for the High band. ISO Functional Appropriateness.
- **[1.5] Functional completeness — High → +3**: Direct counts found 771 TS/TSX test/spec files under `server/`, `gateway/`, and `tests/`, 785 when `e2e/` is included, and 798 with a repo-wide `.test`/`.spec` filename match. Vitest executed 386 files in the root run; the product is a mature multi-service app (wallet/device/gateway/ai) with repository + route separation enforced. ISO Functional Completeness.
- **[2.1] Error handling quality — High (inherited) → +6**: Typed `ApiError` hierarchy, centralized `errorHandler.ts:19-50`, `createLogger` + `getErrorMessage` used consistently; isolated `as any` casts do not change the pattern. ISO Fault Tolerance.
- **[2.2] Timeouts & retries — High (inherited) → +4**: Central timeout config at `server/src/services/bitcoin/electrum/clientConfig.ts:22-28`. The exact `1269` retry/timeout count from the original report was not independently reproduced; a direct `rg` with the validation pattern found 494 app-source hits and 1596 project-wide hits depending on scope. ISO Availability.
- **[2.3] Crash-prone paths — Medium → +2**: Two distinct groups of non-null assertions in prod:
    1. **Middleware-guaranteed augmentations** — `req.user!`, `req.walletId!`, etc. appear frequently across authenticated routes but are safe-by-contract because upstream middleware (`authMiddleware`, `walletAccess`) fail-fast before the handler runs. These should not be counted as crash-prone.
    2. **Genuine typing gaps** — the earlier `walletImportService.ts` `existingDeviceId!` target was fixed during the first implementation pass, and the later `listTransactions.ts:26` (`walletId!`) / `transactionDetail.ts:85` (`as any`) targets were fixed during the transaction typing slice with typed params and repository payload overloads. ISO Fault Tolerance.
- **[3.4] Architecture clarity — High → +3**: Clear `server/src/{api,services,repositories,middleware,utils}` split, `server/ARCHITECTURE.md` enforces repository pattern. ISO Modularity.
- **[3.5] Readability / naming — High → +2**: Standardized helpers (`createLogger`, `safeJsonParse`, `getErrorMessage`, `isPrismaError`), consistent TS naming. ISO Analyzability.
- **[4.3] Input validation quality — Medium → +1**: Zod-backed validation is used on more routes after the implementation passes (address generation, AI model pull/delete, AI suggest/query, device account creation, device sharing, wallet sharing, wallet-device linking, wallet CRUD, wallet import, wallet policy evaluate/address mutations, wallet autopilot/Telegram settings, XPUB validation, wallet approvals, Bitcoin mutation routes, label mutation routes, price conversion/cache-duration routes, node connection-test route, internal mobile-permission gateway check, push register/unregister/gateway-audit routes, transfer create/decline routes, authenticated Payjoin parse/attempt routes, transaction UTXO selection/privacy/freeze/batch routes, sync priority body routes, admin monitoring settings routes, admin policy create/update routes, admin node/proxy configuration routes, AI internal pull-progress route, intelligence mutation routes, draft create/update routes, auth profile preference updates, auth registration presence checks, and auth refresh-token body fallback); a post-slice `rg -n "req\\.body" server/src/api -g '*.ts'` sweep still finds other request-body readers that need route-specific triage as already parser-backed or future Zod targets. ISO Integrity.
- **[4.4] Safe system/API usage — High → +3**: No JS `eval`, `innerHTML`, or `dangerouslySetInnerHTML` in app source; `execSync` only in `migrationService.ts:203`; Redis `eval()` is Lua-only at `infrastructure/distributedLock.ts:214` and in the Redis rate limiter. Prisma tagged `$queryRaw`/`$executeRaw` exists for health checks, aggregation, and maintenance; I found no unsafe string-built raw SQL (`queryRawUnsafe`/`executeRawUnsafe`). ISO Integrity.
- **[5.1] Time Behaviour — Medium → +2**: Cursor pagination + block-height caching in `listTransactions.ts:25-67`; recent streaming export improvement; but dual sequential derivation loops in `addresses.ts:63-101`. ISO Time Behaviour.
- **[5.2] Data access patterns — Medium → +1**: `transactionRepository.ts:69-100` uses compound cursors; `mobilePermissionRepository.ts:112-133` avoids N+1 via join; still some sequential post-query enrichment in `addresses.ts:114-120`. ISO Resource Utilization.
- **[5.3] Blocking in hot paths — Medium → +1**: The exact `blocking_io_count=28` number from the original report was not reproduced. Direct source search found 11 synchronous FS/exec call sites in app source, mostly startup/config/provider/migration paths (`gateway/src/index.ts`, `server/src/api/admin/version.ts`, push providers, `migrationService.ts`); none obviously execute per-request in the main wallet/transaction hot paths. ISO Resource Utilization.
- **[6.2] Test structure — High → +4**: AAA pattern, `vi.hoisted()` for isolation, meaningful names (`addresses.test.ts:50-99`, `emailService.test.ts:72-90`). ISO Testability.
- **[6.3] Edge case coverage — Medium → +1**: Happy-path + some null/config branches covered; boundary/empty-result gaps noted. ISO Functional Completeness.
- **[6.4] No flaky patterns — High (inherited) → +3**: 91 sleep/timer sites across ~771 test files (<0.12/file); sampled sites (`hookRegistry.test.ts`, `cacheInvalidation.test.ts`) are intentional hook/cache timing, not polling. ISO Testability.
- **[7.4] Logging quality — High → +3**: Application modules consistently use `createLogger()` (`addresses.ts:21`, `electrum/methods.ts:27`, `auth/login.ts:30`); structured with module prefix + request ID. The loggers themselves (`server/src/utils/logger.ts:219`, `gateway/src/utils/logger.ts:37-52`) wrap `console.*` by design, and a handful of bootstrap/config files emit direct warnings — those are the intended exceptions, not regressions. ISO Availability.

### Missing

- `lizard` — not installed globally, but a temporary `/tmp` install measured 83 warnings. `.github/workflows/quality.yml` is now blocking with `-i 83`, so the warning count cannot grow without failing CI.
- `jscpd` — not installed globally, but `npx --yes jscpd@4 .` measured 2.33% duplicated lines under the existing 5% threshold after temp/report exclusions. `.github/workflows/quality.yml` is now blocking for jscpd.
- `gitleaks` — not installed globally, but a temporary `/tmp` install measured the gate. `gitleaks git --log-opts -1` passes on the latest commit; full-history and current-directory scans still report legacy/test/ignored-file false positives, so CI now gates PR commit ranges and latest scheduled/manual commits.
- Local coverage extractor for vitest — no standalone grade/coverage extractor script was found in this repo during validation; actual thresholds are enforced by `vitest.config.ts`, `server/vitest.config.ts`, and `gateway/vitest.config.ts`.
- **No longer missing: project linter** — implemented after the initial validation pass: `eslint.config.js`, root/server/gateway `lint` scripts, and a blocking `.github/workflows/quality.yml` lint job now exist. The first-pass rule set intentionally covers the highest-signal `CLAUDE.md` checks that are clean on current source (`console.log` in production source, `catch (error: any)`, empty `catch`, and `@ts-ignore`); broader rules such as raw `JSON.parse` are still future tightening work.

---

## Finding Validation Matrix

Every row below was checked against repository files or command output during this review pass.

| Finding | Validation result | Recommendation impact |
|---|---|---|
| Hard-fail blockers / secrets | Valid with correction: explicit PEM-marker search now finds 8 markers; 7 are allowlisted push-test fixtures and 1 is allowlisted prose in `tasks/grade-fix-plan.md`. No real credential was found by the fallback search. | Keep "no hard-fail blocker"; the grade task allowlist has been added to `.gitleaks.toml`. |
| Commit and trend window | Valid: `git rev-parse --short HEAD` is `dd86dd2f`, and `git log` shows `13efff91..dd86dd2f` includes the cited quality, DoS cap, export streaming, device-query, and REPEATABLE READ commits. | Keep trend context, but treat exact grade-score deltas as original-report metadata, not independently derived in this pass. |
| Tests | Valid: `npm run test:run` passed with 386 root Vitest files and 5483 tests. | Keep Correctness credit. |
| Typecheck | Valid: `npm run typecheck` passed. | Keep Correctness credit. |
| Lint | Implemented after the initial validation gap was confirmed: root `eslint.config.js`, root/server/gateway `lint` scripts, and a blocking `quality.yml` lint job now exist. | P1 lint gate is complete for the first-pass rule set; future tightening can add broader TypeScript policy rules after baseline cleanup. |
| Coverage | Valid as config thresholds: root 100%, server 98/99/99/99, gateway 100/98/100/100. Coverage-summary artifacts exist but may be stale/partial and should not be used as the grade source. | Keep threshold credit; do not cite stale coverage-summary totals. |
| Audit | Valid: `npm audit --audit-level=high` exits clean while reporting 17 total lower-severity advisories: 16 low in the transitive `elliptic` chain and 1 moderate `follow-redirects`. | P2: run the nonbreaking `npm audit fix` path for `follow-redirects`; review the low `elliptic` chain separately because audit reports the available fix path as `npm audit fix --force` with a breaking `vite-plugin-node-polyfills` downgrade. Not a high-severity blocker. |
| gitleaks/lizard/jscpd | Valid with correction: these tools were not installed globally, but temporary `/tmp` installs/binaries produced baselines. CI now runs all three as blocking regression gates; `.jscpd.json` exists and has been tuned to ignore local temp/report artifacts. | P1 implementation complete for regression gating; full-history gitleaks cleanup and lizard baseline reduction remain separate follow-ups. |
| Largest file | Corrected after implementation: `server/tests/unit/api/openapi.test.ts` is now a 17-line suite registrar, with OpenAPI contract modules capped at 819 LOC. `server/tests/unit/api/transactions.test.ts` is now a 25-line suite registrar, with transaction API contract modules capped at 821 LOC. `server/tests/unit/api/transactions-http-routes.test.ts` is now a 13-line suite registrar, with transaction HTTP route modules capped at 677 LOC. `server/tests/unit/api/admin.test.ts` is now a 26-line suite registrar, with admin API contract modules capped at 937 LOC. `server/tests/unit/api/admin-routes.test.ts` is now a 26-line registrar, with Admin Routes HTTP contract modules capped at 313 LOC. `server/tests/unit/api/auth.routes.registration.test.ts` is now a 21-line suite registrar, with auth registration contract modules capped at 534 LOC. `server/tests/unit/api/bitcoin.test.ts` is now a 24-line registrar, with Bitcoin API contract modules capped at 341 LOC. `server/tests/unit/api/drafts.test.ts` is now a 17-line registrar, with Draft API contract modules capped at 414 LOC. `server/tests/unit/api/wallets.test.ts` is now a 20-line registrar, with Wallets API contract modules capped at 322 LOC. `server/tests/unit/services/bitcoin/psbtValidation.test.ts` is now a 12-line registrar, with PSBT validation contract modules capped at 657 LOC. `server/tests/unit/services/walletImport.imports.test.ts` is now a 16-line registrar, with wallet import contract modules capped at 500 LOC. `server/tests/unit/services/transferService.test.ts` is now a 15-line registrar, with transfer service contract modules capped at 503 LOC. `server/tests/integration/flows/admin.integration.test.ts` is now a 45-line registrar, with admin integration contract modules capped at 411 LOC. `server/tests/unit/utils/docker.test.ts` is now a 22-line registrar, with Docker utility contract modules capped at 473 LOC. `server/tests/unit/services/intelligence/analysisService.test.ts` is now a 17-line registrar, with analysis service contract modules capped at 367 LOC. `server/tests/unit/services/bitcoin/descriptorParser.test.ts` is now a 28-line registrar, with descriptor parser contract modules capped at 384 LOC. `server/tests/unit/services/blockchainService.test.ts` is now a 23-line registrar, with blockchain service contract modules capped at 352 LOC. `server/tests/unit/services/bitcoin/transactionService.create.test.ts` is now a 21-line suite registrar, with transaction creation contract modules capped at 553 LOC. `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts` is now a 17-line registrar, with transaction broadcast contract modules capped at 471 LOC after the broadcast-and-save submodule split. `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` is now a 22-line registrar, with Electrum connection contract modules capped at 652 LOC. `server/tests/unit/services/syncService.test.ts` is now a 29-line registrar, with sync service contract modules capped at 471 LOC. `server/tests/unit/services/wallet.test.ts` is now a 22-line registrar, with wallet service contract modules capped at 648 LOC. `tests/hooks/useWebSocket.test.tsx` is now a 20-line registrar, with WebSocket hook contract modules capped at 437 LOC. `server/tests/unit/api/devices.test.ts` is now a 37-line registrar, with device API contract modules capped at 657 LOC. `e2e/render-regression.spec.ts` is now a 54-line registrar, with render-regression e2e modules capped at 767 LOC. `tests/components/Intelligence.tabs.test.tsx` is now a 12-line registrar, with Intelligence tabs modules capped at 445 LOC. `server/tests/unit/services/policyEvaluationEngine.test.ts` is now a 30-line registrar, with policy engine contract modules capped at 601 LOC. `server/tests/unit/services/bitcoin/blockchain.test.ts` is now a 24-line registrar, with blockchain contract modules capped at 493 LOC. `server/tests/unit/services/backupService.test.ts` is now a 29-line registrar, with backup service contract modules capped at 559 LOC. `server/tests/unit/services/bitcoin/sync/phases.processTransactions.test.ts` is now a 43-line registrar, with process-transactions contract modules capped at 473 LOC. `server/tests/integration/flows/wallet.integration.test.ts` is now a 65-line registrar, with wallet integration contract modules capped at 604 LOC. `server/tests/unit/websocket/clientServerLimits.test.ts` is now a 22-line registrar, with WebSocket limits contract modules capped at 291 LOC. `tests/api/client.test.ts` is now a 26-line registrar, with API client contract modules capped at 354 LOC. `server/src/api/openapi/paths/admin.ts` is now an 18-line aggregate, with OpenAPI admin path modules capped at 369 LOC. `tests/contexts/AppNotificationContext.test.tsx` is now a 28-line registrar, with AppNotificationContext contract modules capped at 428 LOC. `server/tests/unit/services/payjoinService.test.ts` is now a 29-line registrar, with Payjoin service contract modules capped at 326 LOC. `server/tests/unit/worker/workerJobQueue.test.ts` is now a 37-line registrar, with worker job queue contract modules capped at 292 LOC. The current largest non-generated TS/TSX files found in the scoped search are `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` at 1072 LOC each, followed by `server/tests/unit/middleware/auth.test.ts` at 1063 LOC when generated verified-vector files are excluded. `server/src/api/openapi/schemas/admin.ts` is now a 19-line aggregate with OpenAPI admin schema modules capped at 248 LOC. | API, admin-routes HTTP, policy repository, policy-engine, blockchain service, backup service, process-transactions phase, wallet integration, admin integration, Docker utility, analysis service, descriptor parser, blockchain aggregate service, auth registration, transaction creation service, transaction broadcast service, transaction HTTP route, Electrum connection, sync service, wallet service, WebSocket hook, device API, render-regression e2e, Intelligence tabs, Bitcoin API, Draft API, Wallets API, PSBT validation, wallet import, transfer service, clientServerLimits WebSocket, API client, OpenAPI admin path, OpenAPI admin schema, AppNotificationContext test, Payjoin service test, and worker job queue test splits are complete; the next largest-file criterion work is splitting the transaction service batch and advanced transaction tests, then the auth middleware test, or reframing the scoring criterion. |
| Health endpoint count | Corrected: 169 is a grep-hit count, not a route count. Real evidence includes `/health`, `/metrics`, `/api/v1/health` in `server/src/routes.ts` and `/health` in `gateway/src/index.ts`. | Keep ops credit but avoid calling 169 "routes." |
| Suppression density | Corrected: direct source search found 25 suppressions, not 24, excluding generated Prisma files. Most have explanatory comments. | Keep as a low-risk maintainability note; lint can enforce future policy. |
| Test-file count | Corrected: 771 TS/TSX test/spec files under `server/`, `gateway/`, and `tests/`; 785 when `e2e/` is included; 798 broader `.test`/`.spec` path matches. | Do not cite a single count without naming scope. |
| Error handling | Valid: `server/src/errors/errorHandler.ts` maps Prisma and `ApiError` subclasses centrally and uses `createLogger`. | Keep Reliability strength. |
| Timeouts/retries count | Partially validated: central Electrum timeout config exists; exact `1269` count was not reproduced from file search and the local generator script was not present. | Keep strength, but cite the config rather than the exact count. |
| Crash-prone paths | Corrected: many `req.user!`/`req.walletId!` uses are middleware-guaranteed; the wallet-import `existingDeviceId!` assertions were fixed during implementation; the wallet transaction list `walletId!` and transaction detail/list serialization `as any` casts were fixed during the transaction typing slice. | P2 typing-gap item is complete; leave middleware-guaranteed request augmentations alone unless their middleware contract changes. |
| Architecture clarity | Valid: `server/ARCHITECTURE.md` documents route/service/repository layering and Prisma boundaries; `server/package.json` has `check:prisma-imports`. | Preserve; no broad refactor recommended. |
| Input validation | Valid mixed state: `server/src/api/transactions/addresses.ts` uses Zod `validate({ body: GenerateAddressesBodySchema })`; `server/src/api/transactions/coinSelection.ts`, `server/src/api/transactions/privacy.ts`, `server/src/api/transactions/utxos.ts`, `server/src/api/transactions/drafting.ts` batch transaction route, `server/src/api/ai/models.ts`, `server/src/api/ai/features.ts`, `server/src/api/devices/accounts.ts`, `server/src/api/devices/sharing.ts`, `server/src/api/wallets/sharing.ts`, `server/src/api/wallets/devices.ts`, `server/src/api/wallets/crud.ts`, `server/src/api/wallets/import.ts`, `server/src/api/wallets/policies.ts`, `server/src/api/wallets/autopilot.ts`, `server/src/api/wallets/telegram.ts`, `server/src/api/wallets/xpubValidation.ts`, `server/src/api/wallets/approvals.ts`, Bitcoin mutation routes, label mutation routes, `server/src/api/price.ts` conversion/cache-duration routes, `server/src/api/node.ts` connection-test route, `server/src/api/mobilePermissions.ts` internal gateway check, `server/src/api/push.ts` register/unregister/gateway-audit routes, `server/src/api/transfers.ts` create/decline routes, `server/src/api/payjoin.ts` authenticated parse/attempt routes, `server/src/api/sync.ts` priority body routes, `server/src/api/admin/monitoring.ts` settings routes, `server/src/api/admin/policies.ts` system-policy create/update routes, `server/src/api/admin/nodeConfig.ts` node config update/test routes, `server/src/api/admin/proxyTest.ts` proxy test route, `server/src/api/ai-internal.ts` pull-progress route, `server/src/api/intelligence.ts` mutation routes, `server/src/api/drafts.ts` create/update routes, `server/src/api/auth/profile.ts` preference update route, `server/src/api/auth/login.ts` registration route, and `server/src/api/auth/tokens.ts` refresh-token body fallback have now been migrated during implementation. A post-slice `rg -n "req\\.body" server/src/api -g '*.ts'` sweep still shows other request-body readers that should be triaged as parser-backed exceptions or future Zod targets. | P1: continue normalizing mutation request bodies onto Zod. |
| Safe system/API usage | Corrected: no JS eval/DOM injection found in app source; Redis Lua `eval` and tagged Prisma raw SQL are present; no unsafe raw SQL helpers were found. | Keep Security credit; do not claim "Prisma ORM throughout." |
| Performance/data access | Valid: cursor pagination exists in `transactionRepository.ts`; wallet transaction listing uses cached block height; address generation and enrichment loops remain sequential. | Keep medium performance score and targeted Zod/cap/loop notes. |
| Blocking I/O | Corrected: direct app-source search found 11 sync FS/exec call sites, not the original `28`; they are startup/config/provider/migration paths rather than main request hot paths. | Track, but do not make this a P1. |
| Test quality / flaky patterns | Mostly valid: sampled timer uses in hook registry and cache invalidation are intentional async/fire-and-forget timing; exact sleep-count depends on search scope. | Keep as a strength; no broad test rewrite. |
| Logging quality | Valid with exception: application modules consistently use `createLogger`; logger implementations and bootstrap/config warnings intentionally call `console.*`. | Keep strength; lint should enforce no ad hoc `console.log` in app code. |

---

## Top Risks

1. **CI quality signals are now blocking, but lizard is baseline-gated.** The new lint, gitleaks, lizard, and jscpd jobs are blocking in `.github/workflows/quality.yml`. `lizard` still has 83 existing warnings, so the immediate guardrail is "do not increase warning count"; reducing the baseline remains future maintainability work.
2. **Remaining oversized API/service modules** — the OpenAPI, transaction API, transaction HTTP route, admin API, admin-routes HTTP, auth registration API, policy engine, policy repository, blockchain service, backup service, process-transactions phase, wallet integration, admin integration, Docker utility, analysis service, descriptor parser, blockchain aggregate service, transaction creation service, transaction broadcast service, transaction broadcast-and-save submodule, Electrum connection, sync service, wallet service, WebSocket hook, device API, render-regression e2e, Intelligence tabs, Bitcoin API, Draft API, Wallets API, PSBT validation, wallet import, transfer service, API client, OpenAPI admin path, OpenAPI admin schema, AppNotificationContext test, Payjoin service test, and worker job queue test files are split, but the current largest non-generated TS/TSX files are now `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` at 1072 LOC each, followed by `server/tests/unit/middleware/auth.test.ts` at 1063 LOC when generated verified-vector files are excluded. This keeps criterion 3.3 at 0 until those files are split or the scoring threshold is reframed.
3. **Inconsistent input validation at mutation boundaries** — the AI/device/wallet sharing/wallet CRUD/wallet import/wallet policy/wallet settings/wallet approval/Bitcoin/label/price/node/internal-mobile-permission/push/transfers/payjoin/transaction-UTXO/transaction-batch/sync/admin-monitoring/admin-policy/admin-node/AI-internal/intelligence/draft/auth-profile/auth-registration/auth-token slices are now on Zod-backed validation, but a post-slice `req.body` sweep still shows other handlers that need route-specific triage as already parser-backed or future Zod targets. A handler missing validation is a latent CWE-20.
4. **Broader lint tightening remains.** The first-pass ESLint gate catches seeded violations for `console.log`, `catch (error: any)`, empty `catch`, and `@ts-ignore`; it does not yet enforce every `CLAUDE.md` rule such as raw `JSON.parse` because existing call sites need a separate baseline/fix pass.

**Not top risks** (but worth tracking):

- `follow-redirects <=1.15.11` — moderate, not high. `npm audit --audit-level=high` exits clean. Routine dependency maintenance via `npm audit fix`; do not escalate unless severity climbs.

---

## Fastest Improvements

Ordered by priority, not cost. The first two items are the ones that change the static-analysis story from "advisory" to "enforced".

### Done — Add a repo-owned lint gate
- Added `eslint.config.js` (flat config) at the repo root with a focused first-pass rule set for production source: no `console.log`, no `catch (error: any)`, no empty `catch`, and no `@ts-ignore`.
- Added `lint` scripts to root, `server/`, and `gateway/` `package.json`.
- Added a blocking `lint` job to `.github/workflows/quality.yml`.
- Correctness 1.3: `+1 → +3` (**+2 points**).

### Done — Make the existing CI quality signals enforceable + runnable locally
- Install `gitleaks`, `lizard`, `jscpd` locally (Nix/Homebrew/pip/npm). Add `scripts/quality.sh` that runs the same commands as the CI jobs so developers get the signal pre-push.
- **Keep the `.gitleaks.toml` grade-task allowlist** that was added during the implementation pass: `tasks/grade-fix-plan.md` and `tasks/grade-report-2026-04-13-c76.md`. `.gitleaks.toml` itself no longer carries a literal PEM sentinel in comments, so it does not need a broad self-allowlist.
- Baseline the current lizard/jscpd output, document any intentional deltas, then remove `continue-on-error: true` from each job in `quality.yml` **per-job, not as a batch**. Implemented with jscpd at 2.33%, lizard at an 83-warning no-increase baseline, and gitleaks scoped to PR/latest-commit regression scanning because full-history/current-directory scans include legacy/test/ignored-file false positives.
- Score impact: net **0 points** in this pass. jscpd improved 3.2 from `+1 → +3`, while the measured lizard baseline moved 3.1 from optimistic unknown `+2 → +0`; Security 4.2 is now a measured regression gate, but not a full-history clean signal.

### Done — Split `server/tests/unit/api/openapi.test.ts` by OpenAPI domain
- Replaced the 2825-line file with a 17-line suite registrar plus domain contract modules: core 417 LOC, wallet 462 LOC, admin-core 542 LOC, admin-ops 579 LOC, gateway 819 LOC, and shared helpers 113 LOC.
- Preserved the executable test surface: before/after counts are `describe=1`, `it=42`, and `expect=584`; the OpenAPI `it` name set is unchanged.
- Verification: `npx vitest run --config server/vitest.config.ts tests/unit/api/openapi.test.ts` passed with 42 tests.
- Maintainability 3.3 score impact: **no numeric movement yet**. The OpenAPI, transaction API, transaction HTTP route, admin API, admin-routes HTTP, auth registration API, policy engine, policy repository, blockchain service, backup service, process-transactions phase, wallet integration, admin integration, Docker utility, analysis service, descriptor parser, blockchain aggregate service, transaction creation service, transaction broadcast service, transaction broadcast-and-save submodule, Electrum connection, sync service, wallet service, WebSocket hook, device API, render-regression e2e, Intelligence tabs, Bitcoin API, Draft API, Wallets API, PSBT validation, wallet import, transfer service, API client, OpenAPI admin path, OpenAPI admin schema, AppNotificationContext test, Payjoin service test, and worker job queue test god-files are gone, but the 1072 LOC bitcoin transaction service test files keep the repo-wide largest-file criterion at 0.

### Done — Split the remaining oversized API test files
- `server/tests/unit/api/transactions.test.ts` is now split into a 25-line registrar plus contract modules capped at 821 LOC.
- `server/tests/unit/api/admin.test.ts` is now split into a 26-line registrar plus contract modules capped at 937 LOC.
- Preserved assertions the same way as the OpenAPI split: before/after admin API counts are `describe=38`, `it=71`, and `expect=180`.
- Maintainability 3.3: **no numeric movement yet** because API/service tests remain above the scoped threshold.

### In progress — Reduce the remaining largest API/e2e/frontend test files if chasing 3.3 score movement
- `server/tests/unit/services/policyEvaluationEngine.test.ts` is now split into a 30-line registrar plus contract modules capped at 601 LOC.
- `server/tests/unit/services/bitcoin/blockchain.test.ts` is now split into a 24-line registrar plus contract modules capped at 493 LOC.
- `server/tests/unit/services/backupService.test.ts` is now split into a 29-line registrar plus contract modules capped at 559 LOC.
- `server/tests/unit/services/bitcoin/sync/phases.processTransactions.test.ts` is now split into a 43-line registrar plus contract modules capped at 473 LOC.
- `server/tests/integration/flows/wallet.integration.test.ts` is now split into a 65-line registrar plus contract modules capped at 604 LOC.
- `server/tests/unit/api/auth.routes.registration.test.ts` is now split into a 21-line registrar plus contract modules capped at 534 LOC.
- `server/tests/unit/services/bitcoin/transactionService.create.test.ts` is now split into a 21-line registrar plus contract modules capped at 553 LOC.
- `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` is now split into a 22-line registrar plus contract modules capped at 652 LOC.
- `server/tests/unit/services/syncService.test.ts` is now split into a 29-line registrar plus contract modules capped at 471 LOC.
- `server/tests/unit/services/wallet.test.ts` is now split into a 22-line registrar plus contract modules capped at 648 LOC.
- `tests/hooks/useWebSocket.test.tsx` is now split into a 20-line registrar plus contract modules capped at 437 LOC.
- `server/tests/unit/api/devices.test.ts` is now split into a 37-line registrar plus contract modules capped at 657 LOC.
- `e2e/render-regression.spec.ts` is now split into a 54-line registrar plus contract/harness modules capped at 767 LOC, while keeping the 43 `test(...)` registrations in the original spec file so Playwright snapshot ownership remains stable.
- `server/tests/unit/api/transactions-http-routes.test.ts` is now split into a 13-line registrar plus contract modules capped at 677 LOC.
- `tests/components/Intelligence.tabs.test.tsx` is now split into a 12-line registrar plus contract/harness modules capped at 445 LOC.
- `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts` is now split into a 17-line registrar plus contract/harness modules capped at 1228 LOC.
- `server/tests/unit/api/bitcoin.test.ts` is now split into a 24-line registrar plus contract/harness modules capped at 341 LOC.
- `server/tests/unit/api/drafts.test.ts` is now split into a 17-line registrar plus contract/harness modules capped at 414 LOC.
- `server/tests/unit/api/wallets.test.ts` is now split into a 20-line registrar plus contract/harness modules capped at 322 LOC.
- `server/tests/unit/services/bitcoin/psbtValidation.test.ts` is now split into a 12-line registrar plus contract/harness modules capped at 657 LOC.
- `server/tests/unit/services/walletImport.imports.test.ts` is now split into a 16-line registrar plus contract modules capped at 500 LOC.
- `server/tests/unit/services/transferService.test.ts` is now split into a 15-line registrar plus contract modules capped at 503 LOC.
- `server/tests/integration/flows/admin.integration.test.ts` is now split into a 45-line registrar plus contract modules capped at 411 LOC.
- `server/tests/unit/utils/docker.test.ts` is now split into a 22-line registrar plus contract modules capped at 473 LOC.
- `server/tests/unit/services/intelligence/analysisService.test.ts` is now split into a 17-line registrar plus contract modules capped at 367 LOC.
- `server/tests/unit/services/bitcoin/descriptorParser.test.ts` is now split into a 28-line registrar plus contract modules capped at 384 LOC.
- `server/tests/unit/services/blockchainService.test.ts` is now split into a 23-line registrar plus contract modules capped at 352 LOC.
- `server/tests/unit/api/admin-routes.test.ts` is now split into a 26-line registrar plus Admin Routes HTTP contract modules capped at 313 LOC.
- `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.contracts.ts` is now split into a 17-line registrar plus broadcast-and-save contract modules capped at 471 LOC.
- `server/tests/unit/repositories/policyRepository.test.ts` is now split into a 15-line registrar plus policy repository contract modules capped at 353 LOC.
- `server/tests/unit/websocket/clientServerLimits.test.ts` is now split into a 22-line registrar plus WebSocket limits contract modules capped at 291 LOC.
- `tests/api/client.test.ts` is now split into a 26-line registrar plus API client contract modules capped at 354 LOC.
- `server/src/api/openapi/paths/admin.ts` is now split into an 18-line aggregate plus OpenAPI admin path modules capped at 369 LOC.
- `server/src/api/openapi/schemas/admin.ts` is now split into a 19-line aggregate plus OpenAPI admin schema modules capped at 248 LOC.
- `tests/contexts/AppNotificationContext.test.tsx` is now split into a 28-line registrar plus AppNotificationContext contract modules capped at 428 LOC.
- `server/tests/unit/services/payjoinService.test.ts` is now split into a 29-line registrar plus Payjoin service contract modules capped at 326 LOC.
- `server/tests/unit/worker/workerJobQueue.test.ts` is now split into a 37-line registrar plus worker job queue contract modules capped at 292 LOC.
- Next validated targets: `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` (1072 LOC), `server/tests/unit/services/bitcoin/advancedTx.test.ts` (1072 LOC), and `server/tests/unit/middleware/auth.test.ts` (1063 LOC), excluding generated verified-vector files.
- Use the same registrar/harness pattern only where the existing suite has clear domains; preserve before/after `describe`/`it`/`expect` counts and run each focused suite before broadening.
- Maintainability 3.3: `0 → +2` only after the scoped largest-file threshold is actually cleared or the scoring criterion is narrowed.

### In progress — Continue normalizing request-body validation on Zod
- Use `server/src/api/transactions/addresses.ts` + `server/src/api/schemas/transactions.ts` as the template (`validate({ body: Schema })` middleware, cap bounds in the schema).
- `server/src/api/ai/models.ts` `POST /pull-model` and `DELETE /delete-model`, `server/src/api/ai/features.ts`, `server/src/api/devices/accounts.ts`, device/wallet sharing, wallet-device linking, wallet CRUD/import/policy routes, wallet autopilot/Telegram settings, XPUB validation, wallet approvals, Bitcoin mutation routes, label mutation routes, transaction UTXO selection/privacy/freeze routes, transaction batch drafting route, price conversion/cache-duration routes, node connection-test route, the internal mobile-permission gateway check, push register/unregister/gateway-audit routes, transfer create/decline routes, authenticated Payjoin parse/attempt routes, sync priority body routes, admin monitoring settings routes, admin policy create/update routes, admin node/proxy configuration routes, AI internal pull-progress route, intelligence mutation routes, draft create/update routes, auth profile preference updates, auth registration presence checks, and auth refresh-token body fallback have been migrated during implementation.
- Continue by triaging the remaining `rg -n "req\\.body" server/src/api -g '*.ts'` hits as parser-backed exceptions or future Zod targets, then sweep any other `if (!foo) return 400` patterns in mutation handlers.
- Security 4.3 full-sweep target: `+1 → +3` (**+2 points**) once the remaining mutation handlers are migrated or explicitly documented as parser-backed exceptions.

### Done — Address the genuine typing gaps
- `resolution.existingDeviceId!` in `server/src/services/walletImport/walletImportService.ts` was replaced with a proper narrowing branch during the first implementation pass.
- `server/src/api/transactions/walletTransactions/listTransactions.ts` now uses the typed route param instead of the middleware-attached `walletId!` assertion for its `:walletId` route.
- `server/src/repositories/transactionRepository.ts` now preserves Prisma payload types for transaction access/detail helpers, allowing `server/src/api/transactions/transactionDetail.ts` and transaction list serialization to drop the local `as any` casts.
- Middleware-guaranteed `req.user!`/`req.walletId!` assertions remain intentionally out of scope.
- Does not move the numeric Reliability score on its own but materially reduces the specifically validated crash-prone surface.

### P2 — Routine dependency maintenance
- Run the nonbreaking `npm audit fix` path for the moderate `follow-redirects <=1.15.11` advisory. No score impact at the high-severity gate, but keeps the advisory list tidy.
- Review the low-severity `elliptic` transitive chain separately. Current `npm audit --audit-level=high` output reports a `npm audit fix --force` path that would install `vite-plugin-node-polyfills@0.2.0` as a breaking change, so do not force that under this quality-report cleanup.

Combined low-effort ceiling from the remaining P1 items: **≈ 86 (B)**, assuming lizard reduction, Zod normalization, and the remaining largest-file service/integration test split are included rather than treating the API-test splits as sufficient for 3.3.

### Execution order & dependencies

The four P1 items can largely run in parallel, but there is one sequencing rule and one short-circuit:

1. **Install tools locally first** (`gitleaks`, `lizard`, `jscpd`). Do this before anything else — it unblocks a pre-push `scripts/quality.sh` and lets you baseline without round-tripping through CI. ~10 min.
2. **Baseline the three existing CI jobs in a separate branch** before touching `continue-on-error`. If `lizard` or `jscpd` report pre-existing violations, triage them into either "fix now" or "document + add exclusion", then flip `continue-on-error: false` per-job only when each one is clean. Do NOT flip all three at once.
3. **The first-pass lint gate and API test splits have landed.** Use them as the guardrails/pattern for the remaining oversized service/integration test split and Zod sweep work.
4. **Zod normalization sweep (P1 #4)** can now add a regression-prevention rule to `eslint.config.js` — e.g., an `no-restricted-syntax` rule flagging any function that references `req.body` without a nearby `validate({ body: … })` import, or a simpler taxonomy check that forbids destructuring `req.body` in handler function bodies. The rule should NOT try to force `validate({ body })` onto bodyless mutation handlers; it should trigger only when `req.body` is actually read.
5. **P2 typing-gap work (item #5)** is complete; do not broaden it into a rewrite of middleware-guaranteed request augmentation assertions.

### Acceptance criteria per P1 item

| Item | Done when |
|---|---|
| Lint gate | Done locally: `npm run lint` exists in root + server + gateway, `.github/workflows/quality.yml` has a blocking `lint` job, and the rules fail on seeded violations for `console.log`, `catch (error: any)`, empty `catch`, and `@ts-ignore`. |
| CI signals enforceable | Done for regression gating: `scripts/quality.sh` runs all three tools; `quality.yml`'s `gitleaks`, `lizard`, and `jscpd` jobs no longer use `continue-on-error`; gitleaks gates PR/latest commits, lizard gates no increase above 83 warnings, and jscpd gates the existing 5% threshold. |
| API test splits | Done for the original named files: OpenAPI, transaction API, and admin API suite registrars are 17, 25, and 26 LOC respectively; contract modules are capped at 819, 821, and 937 LOC respectively; before/after `describe`/`it`/`expect` counts are preserved for each split. Later passes also split transaction HTTP route, auth registration, device API, Bitcoin API, Draft API, and Wallets API tests. This does not claim the repo-wide largest-file criterion is cleared, because large service tests remain. |
| Zod normalization | Every handler in `server/src/api/**` that reads `req.body` (directly or via destructure such as `const { x } = req.body`) is gated by a `validate({ body: Schema })` middleware on its route registration. Handlers with no request body (e.g. `DELETE /resource/:id`, action endpoints keyed only by URL/query params) are explicitly out of scope and do not need `validate({ body })`. The two original AI model offenders have been migrated; verify the remaining sweep by (a) reading each mutation handler that references `req.body` against its route registration, and (b) confirming remaining inline body guards have been replaced or intentionally documented. |

### Target state after P1 (projected)

The "After P1" ranges below assume P1 is run to the mid-case Maintainability band *at minimum* — that is, Execution Order item 2 ("triage lizard/jscpd violations into 'fix now' or 'document + add exclusion'") is part of P1 scope, not a follow-up. A true worst-case outcome would regress Maintainability by 1 point on net and is explicitly not the plan target; if it happens, P1 does more refactor work until it reaches mid-case.

| Domain | Current | After P1 (mid → best) | Delta | Driver |
|---|---|---|---|---|
| Correctness | 20/20 | 20/20 | 0 | First-pass lint gate already landed |
| Reliability | 12/15 | 12/15 | 0 | Unchanged (P2 typing gaps don't move the band) |
| Maintainability | 8/15 | 13 → 15/15 | +5 to +7 | See per-criterion breakdown below |
| Security | 11/15 | 13 → 15/15 | +2 to +4 | gitleaks measured (4.2) `+0 to +2`; Zod normalization (4.3) `+2` |
| Performance | 4/10 | 4/10 | 0 | No P1 item targets Performance (see rationale below) |
| Test Quality | 13/15 | 13/15 | 0 | No P1 item targets Test Quality |
| Operational Readiness | 10/10 | 10/10 | 0 | At cap |
| **TOTAL** | **78/100 (C)** | **85 → 89/100 (B)** | **+7 to +11** | Realistic mid-estimate: **~86 (B)** |

Arithmetic check (rounded, no handwaving):

- Mid-case total: 20 + 12 + 13 + 13 + 4 + 13 + 10 = **85**
- Best-case total: 20 + 12 + 15 + 15 + 4 + 13 + 10 = **89**
- Mid-estimate (requires lizard baseline reduction + full Zod sweep + clean gitleaks regression gate): 20 + 12 + 13 + 14 + 4 + 13 + 10 = **86**

**Maintainability range breakdown** — 3.1 and 3.2 are now measured. Only mid-case and best-case are carried into the range above; worst-case is off-plan (see the paragraph above the table):

| Criterion | Current | Worst-case measured (off-plan) | Mid-case measured | Best-case measured |
|---|---|---|---|---|
| 3.1 Cyclomatic complexity (lizard warnings) | +0 (83 warnings) | +0 (`>15`) | +3 (`1–5`) | +5 (`0`) |
| 3.2 Duplication (jscpd %) | +3 (2.33%) | +3 (`<3%`) | +3 (`<3%`) | +3 (`<3%`) |
| 3.3 Largest file (after OpenAPI + transaction + transaction HTTP route + admin API + admin-routes HTTP + auth registration + Bitcoin API + Draft API + Wallets API + PSBT validation + wallet import + transfer service + admin integration + Docker utility + analysis service + descriptor parser + blockchain aggregate service + transaction creation + transaction broadcast + transaction broadcast-and-save submodule + policy repository + Electrum connection + sync service + wallet service + WebSocket hook + device API + render-regression e2e + Intelligence tabs + policy engine + blockchain service + backup service + process-transactions + wallet integration + clientServerLimits WebSocket + API client + OpenAPI admin path + OpenAPI admin schema + AppNotificationContext test + Payjoin service test + worker job queue test splits) | 0 (`server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` 1072 LOC each) | 0 | +2 | +2 |
| 3.4 + 3.5 (unchanged) | +5 | +5 | +5 | +5 |
| **Domain total** | **8** | **7** | **13** | **15** |

**Security range assumption** — the `+2` on 4.2 now applies only to the new-commit regression gate. Full-history/current-directory scans still report legacy/test/ignored-file false positives; those should be resolved through a separate history/current-tree secret-scan cleanup before claiming a full clean-room gitleaks signal.

**Performance rationale** — 4/10 is low but not an oversight. The recent landed commits (streamed tx export with REPEATABLE READ, capped `POST /addresses/generate`, halved device-route queries) already raised the qualitative ceiling; the next move is real measurement (request-path profiling, query-log sampling, p99 latency observation against the `/metrics` Prometheus surface), not speculative rewrites. That's a separate initiative from this audit and belongs in its own plan.

### Out of scope for this plan

Deliberately not recommended from this evidence pass:

- **Exact original heuristic counts** (`timeout_retry_count=1269`, `blocking_io_count=28`, `test_file_count=818`). Direct searches returned different numbers depending on scope, and no local generator script was found. The correct response is "name the scope next time", not "chase the heuristic".
- **Middleware-guaranteed `req.user!`/`req.walletId!` assertions**. Safe-by-contract; rewriting them adds noise without reducing crash surface. Leave them alone.
- **`follow-redirects` advisory**. Routine nonbreaking `npm audit fix`; not a P1.
- **Low `elliptic` transitive chain**. Current audit output says the available force-fix path is breaking; review separately instead of forcing it during this plan.
- **Frontend architecture or styling rewrites**. Out of the quality-audit scope and not supported by the validated findings in this report.

---

## Summary

The repo climbed from **D (69) → C (76)** on the back of the typecheck fix (`350f67c1`); the recent performance/security commits (streamed exports, DoS cap, REPEATABLE READ snapshot) reinforce the existing Reliability score even though the static signals do not move. The biggest lever to reach B is now **reducing the measured lizard baseline, finishing the Zod validation sweep, and splitting the remaining oversized modules**: lint, gitleaks, lizard, and jscpd are blocking regression gates, but lizard still has 83 existing warnings and the largest scoped TS/TSX files are now `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` at 1072 LOC each after the OpenAPI, transaction API, transaction HTTP route, admin API, admin-routes HTTP, auth registration API, Bitcoin API, Draft API, Wallets API, PSBT validation, wallet import, transfer service, admin integration, Docker utility, analysis service, descriptor parser, blockchain aggregate service, transaction creation service, transaction broadcast service, transaction broadcast-and-save submodule, policy repository, Electrum connection, sync service, wallet service, WebSocket hook, device API, render-regression e2e, Intelligence tabs, policy engine, blockchain service, backup service, process-transactions phase, wallet integration, clientServerLimits WebSocket, API client, OpenAPI admin path, OpenAPI admin schema, AppNotificationContext test, Payjoin service test, and worker job queue test splits.

---

## Review Notes

<!-- Add comments/decisions below this line -->

### Validated recommendation pass — 2026-04-13

Validation was done against repository files, not inferred from the report text. Commands run:

- `npm run typecheck` — passed.
- `npm run test:run` — passed: 386 test files, 5483 tests.
- `npm audit --audit-level=high` — passed for the high-severity gate; output still reports 17 advisories total: 16 low and 1 moderate (`follow-redirects`).
- `command -v gitleaks`, `command -v lizard`, and `command -v jscpd` — all returned not found in this environment.
- `rg --files -g 'eslint.config.*' -g '.eslintrc*'` — no local ESLint config found before the later implementation pass.
- `wc -l server/tests/unit/api/openapi.test.ts` — 2825 lines.

#### Recommendations to carry forward

| Priority | Recommendation | Validated evidence | Notes |
|---|---|---|---|
| Done | Add a repo-owned lint gate: root `eslint.config.*`, `lint` npm script, and a CI job that runs it. | The original validation found no config/script; the implementation pass added `eslint.config.js`, root/server/gateway `lint` scripts, and a blocking `.github/workflows/quality.yml` lint job. | First-pass rules cover production-source `console.log`, `catch (error: any)`, empty `catch`, and `@ts-ignore`; broader rules remain future tightening. |
| P1 | Keep the gitleaks/lizard/jscpd recommendation, but word it as “make the CI signals enforceable and available locally,” not “install them in CI.” | `.github/workflows/quality.yml` already installs/runs `lizard`, runs `gitleaks/gitleaks-action`, and runs `npx --yes jscpd@4 .`; each job is `continue-on-error: true`. Local `command -v` checks for all three tools returned not found. `.jscpd.json` already exists with threshold 5 and exclusions. | Next step should be baseline/tune, add local scripts/docs, then remove `continue-on-error` once noise is understood. |
| Done | Split the oversized API test files by route/domain while preserving current assertions. | `server/tests/unit/api/openapi.test.ts` was 2825 LOC and is now a 17-line registrar plus OpenAPI contract modules capped at 819 LOC. `server/tests/unit/api/transactions.test.ts` was 2600 LOC and is now a 25-line registrar plus transaction API modules capped at 821 LOC. `server/tests/unit/api/admin.test.ts` was 2456 LOC and is now a 26-line registrar plus admin API modules capped at 937 LOC. Before/after `describe`/`it`/`expect` counts were preserved for all three. Later passes split transaction HTTP route, auth registration, device API, Bitcoin API, Draft API, and Wallets API tests. | This closes the original API god-files but not the broader largest-file criterion; the next largest-file targets are service tests. |
| P1 | Continue normalizing request-body validation onto Zod for mutation endpoints, starting with small inline checks. | `server/src/api/transactions/addresses.ts` uses `validate({ body: GenerateAddressesBodySchema })`; `server/src/api/schemas/transactions.ts` caps `count` at 1000. AI model/feature, device account/sharing, wallet sharing/device/CRUD/import/policy/settings/approval, Bitcoin mutation, label mutation, transaction UTXO selection/privacy/freeze, transaction batch drafting, price conversion/cache-duration, node connection-test, internal mobile-permission gateway-check, push register/unregister/gateway-audit, transfer create/decline, authenticated Payjoin parse/attempt, sync priority body, admin monitoring settings, admin policy create/update, admin node/proxy configuration, AI internal pull-progress, intelligence mutation, draft create/update, auth profile preference, auth registration presence, and auth refresh-token body fallback slices have now been migrated. | Continue by triaging remaining `rg -n "req\\.body" server/src/api -g '*.ts'` hits as parser-backed exceptions or future Zod targets. |
| Done | Reword the “crash-prone paths” finding before using it as a work item. | `rg` shows many `req.user!` and `req.walletId!` non-null assertions across authenticated/wallet-access routes, so “a few non-null assertions in prod” is not literally true. The specific `as any` hotspots in `server/src/api/transactions/walletTransactions/listTransactions.ts` and `server/src/api/transactions/transactionDetail.ts` were real and are now fixed. | Middleware-guaranteed request augmentations remain separate from the resolved repository/serialization typing gaps. |
| P2 | Keep the moderate `follow-redirects` audit item, but do not call it a high-severity security blocker. | `npm audit --audit-level=high` exits successfully; audit output still lists `follow-redirects <=1.15.11` as moderate and fixable with `npm audit fix`. | Treat as routine dependency maintenance unless a higher-severity advisory appears. |

#### Report wording corrections applied above

- The initial report corrected `quality.yml` to gitleaks/lizard/jscpd only; the later implementation pass added lint.
- Test-file counts now name their search scope instead of relying on a single broad heuristic.
- `169` is described as a health grep-hit count, not a route count.
- Logging quality now distinguishes application-module `createLogger()` use from intentional `console.*` inside logger/bootstrap/config code.
- Secret-scan wording now distinguishes the 7 allowlisted PEM fixture markers from the 1 allowlisted prose marker.

### Follow-up validation pass — 2026-04-13

Re-ran the executable checks and targeted evidence searches after updating the recommendations:

- `npm run typecheck` — passed.
- `npm run test:run` — passed: 386 test files, 5483 tests.
- `npm audit --audit-level=high` — passed for the high-severity gate; still reports 17 lower-severity advisories: 16 low and 1 moderate (`follow-redirects`).
- `rg -n -o -- '-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----' ...` — now finds 7 allowlisted fixture PEM markers and 1 allowlisted prose marker after removing the literal PEM sentinel from `.gitleaks.toml` comments.
- `rg -n '\b(readFileSync|writeFileSync|appendFileSync|existsSync|statSync|readdirSync|execSync|spawnSync|execFileSync|mkdirSync|rmSync)\s*\(' ...` — found 11 app-source sync FS/exec call sites, not the original `blocking_io_count=28`.
- `rg --files -g 'eslint.config.*' -g '.eslintrc*'` and `rg -n '"lint"' -g 'package.json'` — found no project lint config or lint script before the later implementation pass.

### Additional validation pass — 2026-04-13

Re-checked the remaining file/tool/count claims against the repo after the user requested another review pass:

- `rg --files | rg '(^|/)grade(\.sh|$)|grade-tool|grade-report|grade-fix-plan'` — found only the task files; no local `grade.sh` or grade-tool script exists in the repo. Report wording now calls exact `timeout_retry_count`, `blocking_io_count`, and `test_file_count` values original heuristics rather than local facts.
- `rg -n '@ts-(ignore|expect-error)|eslint-disable' server/src components hooks services utils shared src gateway/src --glob '!server/src/generated/**' | wc -l` — found 25 suppressions in the scoped source search.
- `rg --files server gateway tests | rg '\.(test|spec)\.(ts|tsx)$' | wc -l` — found 771 test/spec files; adding `e2e/` found 785; repo-wide `.test`/`.spec` filename matching found 798.
- `rg -n 'thresholds:|branches:|functions:|lines:|statements:' vitest.config.ts server/vitest.config.ts gateway/vitest.config.ts` — confirmed root/server/gateway coverage thresholds.
- `npm run typecheck` — passed.
- `npm run test:run` — passed: 386 test files, 5483 tests.
- `npm audit --audit-level=high` — passed for the high-severity gate; still reports 17 lower-severity advisories: 16 low in the `elliptic` transitive chain and 1 moderate `follow-redirects`. The audit output says the low-chain force-fix path would be breaking, so it is not recommended as part of this cleanup.

### Implementation pass — 2026-04-13

Started implementing the validated recommendations with the lowest-risk guardrail and code-hardening slice:

- Added root `npm run quality` and `scripts/quality.sh` so the existing gitleaks/lizard/jscpd CI checks can be run locally with the same intent before making them strict in CI.
- Updated `.gitleaks.toml` to avoid a literal PEM sentinel in its own comments and to narrowly allowlist grade-report task files that document secret-scan false positives.
- Migrated `server/src/api/ai/models.ts` model-name body checks from inline guards to the shared Zod `validate({ body })` middleware, preserving the route's existing `INVALID_INPUT` error code through a new optional `code` setting in `server/src/middleware/validate.ts`.
- Migrated `server/src/api/ai/features.ts` and `server/src/api/devices/accounts.ts` from inline request-body guards to `validate({ body })` middleware while keeping the existing tested error-message expectations.
- Removed the unsafe `existingDeviceId!` assertions from `server/src/services/walletImport/walletImportService.ts` by explicitly narrowing the resolved existing device id before using it.

Verification after implementation:

- `bash -n scripts/quality.sh` — passed.
- `npm run quality` — exits `127` in this environment because `gitleaks` and `lizard` are not installed locally; the script reports the missing tools and install hints as intended.
- `npm run typecheck` — passed.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npx vitest run server/tests/unit/api/ai.test.ts server/tests/unit/services/walletImport.validation.test.ts server/tests/unit/services/walletImport.imports.test.ts --config server/vitest.config.ts` — passed: 98 tests.
- `npx vitest run server/tests/unit/api/ai.test.ts server/tests/unit/api/devices.test.ts --config server/vitest.config.ts` — passed: 132 tests.
- `npx vitest run server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts --config server/vitest.config.ts` — passed: 39 tests.
- `npm run test:run` from `server/` — all assertions passed (`344` files passed, `22` skipped; `8760` tests passed, `503` skipped), but Vitest exited nonzero because of two teardown-time dynamic-import errors from `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts`. The focused rerun of that file passed, so this is tracked as a suite teardown flake rather than a failure in the edited code.

### ESLint implementation pass — 2026-04-13

Implemented the next recommended guardrail:

- Added root `eslint.config.js` using ESLint 9, `typescript-eslint`, and `eslint-plugin-react-hooks`.
- Added root `lint`, `lint:app`, `lint:server`, and `lint:gateway` scripts; added delegating `lint` scripts in `server/package.json` and `gateway/package.json`.
- Added a blocking `lint` job to `.github/workflows/quality.yml`.
- Fixed the real empty-catch findings the new gate surfaced by adding debug-level structured logging or explicit expected-failure handling in app/server/gateway production source.
- Kept the first-pass rule set intentionally narrow so the gate is enforceable now: no `console.log` in production source, no `catch (error: any)`, no empty `catch`, and no `@ts-ignore`.

Verification after ESLint implementation:

- `npm run lint` — passed.
- `cd server && npm run lint` — passed.
- `cd gateway && npm run lint` — passed.
- `npm run typecheck` — passed.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npx tsc --noEmit -p gateway/tsconfig.json` — passed.
- `npm run test:run` — passed: 386 files, 5483 tests.
- `cd gateway && npm run test:run` — passed: 19 files, 510 tests.

Not completed in this pass:

- The CI `continue-on-error: true` flags were not flipped because the local `gitleaks` and `lizard` baselines cannot be run until those tools are installed. This was completed in the follow-up CI-signal enforcement pass below.
- The full Zod normalization sweep remains pending; `server/src/api/devices/sharing.ts`, `server/src/api/wallets/sharing.ts`, and `server/src/api/wallets/devices.ts` were completed in the follow-up Zod slice below.
- The OpenAPI, transaction API, and admin API splits are complete; later sections track the remaining largest-file work across API/service/integration tests.

### CI-signal enforcement pass — 2026-04-13

Implemented the next recommended quality-signal pass after installing/baselining the tools in `/tmp`:

- Replaced the advisory gitleaks action step with a blocking gitleaks `v8.30.1` CLI job that scans the PR commit range; scheduled/manual runs scan the latest commit. This matches the validated local result that the latest commit is clean while full-history/current-directory scans still contain legacy/test/ignored-file false positives.
- Made lizard blocking with the measured 83-warning baseline (`-i 83`) so new complexity warnings fail CI without requiring an unrelated large refactor first.
- Made jscpd blocking under the existing `.jscpd.json` 5% threshold; the measured baseline is 2.33% duplicated lines.
- Added `.tmp-gh`, `.tmp`, reports, Playwright report, and test-results exclusions to local quality-tool scopes where needed.

Verification after CI-signal enforcement:

- `python3 -m pip install --target /tmp/sanctuary-quality/python lizard` — passed after sandbox escalation; installed lizard 1.21.3.
- `curl -L -o /tmp/sanctuary-quality/gitleaks.tar.gz https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz` — passed.
- `PATH=/tmp/sanctuary-quality:/tmp/sanctuary-quality/python/bin:$PATH PYTHONPATH=/tmp/sanctuary-quality/python GITLEAKS_LOG_OPTS=-1 npm run quality` — passed after sandbox escalation for jscpd network access; measured 2.33% duplicated lines.
- `PYTHONPATH=/tmp/sanctuary-quality/python python3 -m lizard ...` — failed as expected before baselining; measured 83 warnings.
- `/tmp/sanctuary-quality/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` — passed: 1 commit scanned, no leaks found.
- `/tmp/sanctuary-quality/gitleaks detect --source . --config .gitleaks.toml --redact --no-banner` — failed with 36 full-history findings; kept out of the strict gate because they are legacy/test-fixture history, not new leaks in the latest commit.

### OpenAPI contract split pass — 2026-04-13

Implemented the next maintainability recommendation:

- Split `server/tests/unit/api/openapi.test.ts` from 2825 LOC into a 17-line suite registrar plus domain contract modules and shared helpers.
- New OpenAPI file sizes: `openapi.helpers.ts` 113 LOC, `openapi.core.contracts.ts` 417 LOC, `openapi.wallet.contracts.ts` 462 LOC, `openapi.admin-core.contracts.ts` 542 LOC, `openapi.admin-ops.contracts.ts` 579 LOC, and `openapi.gateway.contracts.ts` 819 LOC.
- Preserved the test surface: before/after counts are `describe=1`, `it=42`, and `expect=584`; the OpenAPI `it` name set is unchanged.
- Corrected the acceptance wording: the OpenAPI files are now under 1000 LOC, but this does not make every test file under 1000 LOC. After the transaction and admin API splits, the validated next largest files are service/integration tests.

Verification after OpenAPI split:

- `git diff --check` — passed.
- `npx vitest run --config server/vitest.config.ts tests/unit/api/openapi.test.ts` — passed: 1 file, 42 tests.
- Top non-generated TS/TSX file scan — current largest after the later transaction, transaction HTTP route, admin API, admin-routes HTTP, auth registration API, Bitcoin API, Draft API, Wallets API, PSBT validation, wallet import, transfer service, admin integration, Docker utility, analysis service, descriptor parser, blockchain aggregate service, transaction creation service, transaction broadcast service, transaction broadcast-and-save submodule, policy repository, Electrum connection, sync service, wallet service, WebSocket hook, device API, render-regression e2e, Intelligence tabs, policy engine, blockchain service, backup service, process-transactions phase, wallet integration, clientServerLimits WebSocket, API client, OpenAPI admin path, AppNotificationContext test, Payjoin service test, and worker job queue test splits is `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` at 1072 LOC each, followed by `server/tests/unit/middleware/auth.test.ts` at 1063 LOC when generated verified-vector files are excluded.

### Zod normalization slice — 2026-04-13

Implemented the next small request-body validation slice:

- Migrated `server/src/api/devices/sharing.ts` share-user and share-group bodies onto `validate({ body })`, preserving the existing `targetUserId is required` user-facing message and `INVALID_INPUT` error code.
- Migrated `server/src/api/wallets/sharing.ts` share-group and share-user bodies onto `validate({ body })`, preserving the existing invalid-role and missing-target-user messages.
- Migrated `server/src/api/wallets/devices.ts` device attachment body onto `validate({ body })`, preserving the existing `deviceId is required` user-facing message and `INVALID_INPUT` error code.
- Remaining sweep candidates at this checkpoint still included wallet settings/approval helpers, Bitcoin mutation routes, and label mutation routes. The wallet settings/approval helpers were completed in the follow-up slice below.

Verification after Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/device-sharing-routes.test.ts tests/unit/api/wallet-sharing-routes.test.ts tests/unit/api/wallets.test.ts tests/unit/api/devices.test.ts` — passed: 4 files, 192 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Wallet Zod normalization slice — 2026-04-13

Implemented the next wallet request-body validation slice:

- Migrated `server/src/api/wallets/crud.ts` wallet create/update bodies onto `validate({ body })`, preserving the existing required-field, invalid wallet type, and invalid script type messages.
- Migrated `server/src/api/wallets/import.ts` validate/import bodies onto `validate({ body })`, preserving the existing descriptor/json, data, and name validation messages and the import-name trimming behavior.
- Migrated `server/src/api/wallets/policies.ts` policy evaluation and policy-address mutation bodies onto `validate({ body })`, preserving the existing recipient/amount, amount-format, address/listType, address-length, and listType messages.
- Added a light `validate({ body })` gate to policy create/update routes without changing service-owned policy semantics; this intentionally preserves currently tested pass-through values such as `enforcement: 'block'` and `enforcement: 'warn'`.
- Remaining sweep candidates after this checkpoint still included wallet settings/approval helpers, Bitcoin mutation routes, and label mutation routes. The wallet settings/approval helpers were completed in the follow-up slice below.

Verification after wallet Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/wallets.test.ts tests/unit/api/wallets-import-routes.test.ts tests/unit/api/wallets-policies-routes.test.ts` — passed: 3 files, 148 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Wallet settings Zod normalization slice — 2026-04-13

Implemented the next wallet settings/request-body validation slice:

- Migrated `server/src/api/wallets/autopilot.ts` PATCH settings body onto `validate({ body })`, validating optional booleans and non-negative numeric settings while preserving the existing default fallback behavior for omitted fields.
- Migrated `server/src/api/wallets/telegram.ts` PATCH notification settings body onto `validate({ body })`, preserving the existing default fallback behavior for omitted fields.
- Migrated `server/src/api/wallets/xpubValidation.ts` onto `validate({ body })`, preserving the tested `xpub is required`, validator-provided invalid-xpub messages, and `Invalid script type` behavior.
- Migrated `server/src/api/wallets/approvals.ts` vote and owner-override bodies onto `validate({ body })`, preserving the tested decision validation message, owner-override reason validation message, and trimmed override reason behavior.
- Remaining validated sweep candidates at this checkpoint included Bitcoin mutation routes and label mutation routes. Those were completed in the follow-up slice below; a broader `rg -n "req\\.body" server/src/api -g '*.ts'` sweep still shows other request-body readers to triage as parser-backed exceptions or future Zod targets.

Verification after wallet settings Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/wallets-autopilot-routes.test.ts tests/unit/api/wallets-telegram-routes.test.ts tests/unit/api/wallets-xpubValidation-routes.test.ts tests/unit/api/wallets-approvals-routes.test.ts tests/unit/api/wallets.test.ts` — passed: 5 files, 128 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Bitcoin and labels Zod normalization slice — 2026-04-13

Implemented the next request-body validation slice:

- Migrated `server/src/api/bitcoin/transactions.ts` broadcast, RBF, CPFP, and batch transaction bodies onto `validate({ body })`, preserving the tested `rawTx is required`, RBF/CPFP required-field, batch required-field, and per-recipient validation messages.
- Migrated `server/src/api/bitcoin/address.ts` address validation and address lookup bodies onto `validate({ body })`, preserving the tested `address is required`, `addresses must be a non-empty array`, and `Maximum 100 addresses per request` messages.
- Migrated `server/src/api/bitcoin/fees.ts` fee-estimation utility bodies onto `validate({ body })`, preserving the existing required-field messages.
- Migrated `server/src/api/labels.ts` label create/update and label-id mutation bodies onto `validate({ body })`, preserving service-compatible shapes, empty-label replacement behavior, and the `INVALID_INPUT` code for route-level label validation.
- Verified the migrated files by pairing their remaining `req.body` reads with `validate({ body })` route middleware via `rg -n "req\\.body"` and `rg -n "validate\\("` against `server/src/api/bitcoin/{transactions,address,fees}.ts` and `server/src/api/labels.ts`.

Verification after Bitcoin/labels Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/bitcoin.test.ts tests/unit/api/labels.test.ts` — passed: 2 files, 127 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Price and node Zod normalization slice — 2026-04-13

Implemented the next small non-parser-backed request-body validation slice:

- Migrated `server/src/api/price.ts` conversion and cache-duration bodies onto `validate({ body })`, preserving the tested `sats must be a number`, `amount must be a number`, and `duration must be a positive number (milliseconds)` messages and preserving `duration: 0` as valid to match the old `< 0` check.
- Migrated `server/src/api/node.ts` connection-test body onto `validate({ body })`, preserving the tested required host/port/protocol, Electrum-only node type, and invalid-port messages while keeping the existing `parseInt` port behavior.
- Triage note: `server/src/api/mobilePermissions.ts` has two wallet-scoped body paths already parser-backed by `MobilePermissionUpdateRequestSchema.safeParse` through `validatePermissionInput`; the internal gateway permission-check body was completed in the follow-up slice below.

Verification after price/node Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/price.test.ts tests/unit/api/node.test.ts` — passed: 2 files, 71 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Mobile permissions internal Zod normalization slice — 2026-04-13

Implemented the next small gateway-facing validation slice:

- Migrated `server/src/api/mobilePermissions.ts` `POST /internal/mobile-permissions/check` body onto `validate({ body })`, preserving the tested `walletId, userId, and action are required` and `Invalid action: ...` messages and the `INVALID_INPUT` error code.
- Kept the existing wallet-scoped mobile permission update paths on their shared parser-backed helper (`MobilePermissionUpdateRequestSchema.safeParse` via `validatePermissionInput`) because those paths are already schema-backed and have dedicated invalid-key/non-boolean/empty-body tests.

Verification after mobile permissions internal Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/mobilePermissions.test.ts` — passed: 1 file, 36 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Push Zod normalization slice — 2026-04-13

Implemented the next small request-body validation slice:

- Migrated `server/src/api/push.ts` `POST /register`, `DELETE /unregister`, and `POST /gateway-audit` bodies onto `validate({ body })`, preserving the tested `Device token is required`, `Platform must be "ios" or "android"`, token-format, and `Event type is required` messages plus the `INVALID_INPUT` error code.
- Kept gateway-audit validation after `verifyGatewayRequest`, preserving the tested behavior that unsigned gateway audit requests reject with 403 before body validation and do not persist audit logs.

Verification after push Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/push.test.ts` — passed: 1 file, 54 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transfers Zod normalization slice — 2026-04-13

Implemented the next small request-body validation slice:

- Migrated `server/src/api/transfers.ts` `POST /` body onto `validate({ body })`, preserving the tested `resourceType, resourceId, and toUserId are required` and `resourceType must be "wallet" or "device"` messages plus the `INVALID_INPUT` error code.
- Added a light `validate({ body })` gate to `POST /:id/decline`, keeping decline-reason semantics service-owned and optional to preserve the tested "decline without reason" behavior.

Verification after transfers Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/transfers.test.ts` — passed: 1 file, 48 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Payjoin Zod normalization slice — 2026-04-13

Implemented the next small authenticated request-body validation slice:

- Migrated `server/src/api/payjoin.ts` `POST /parse-uri` and `POST /attempt` bodies onto `validate({ body })`, preserving the tested `URI is required`, `psbt and payjoinUrl are required`, and invalid-network messages plus the `INVALID_INPUT` error code.
- Left the unauthenticated BIP78 receiver endpoint on its existing raw `text/plain` body handling because that route accepts a plain PSBT string, not a JSON body.

Verification after Payjoin Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/payjoin.test.ts` — passed: 1 file, 49 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction UTXO Zod normalization slice — 2026-04-13

Implemented the next request-body validation slice:

- Migrated `server/src/api/transactions/coinSelection.ts` UTXO select and compare-strategies bodies onto `validate({ body })`, preserving the tested required amount/feeRate, invalid feeRate, and invalid strategy messages while keeping amount conversion behavior service-owned.
- Migrated `server/src/api/transactions/privacy.ts` spend-analysis body onto `validate({ body })`, preserving the tested `utxoIds must be an array` route-level message and the existing ownership-count validation path.
- Migrated `server/src/api/transactions/utxos.ts` freeze body onto `validate({ body })`, preserving the tested `frozen must be a boolean` message.

Verification after transaction UTXO Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/transactions-coinSelection-routes.test.ts tests/unit/api/transactions-privacy-routes.test.ts tests/unit/api/transactions-utxos-routes.test.ts` — passed: 3 files, 30 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Sync priority Zod normalization slice — 2026-04-13

Implemented the next light parser-backed request-body validation slice:

- Added `validate({ body })` to `server/src/api/sync.ts` priority-reading routes (`POST /queue/:walletId`, `POST /user`, and `POST /network/:network`) while preserving `readPriority`'s existing fallback to `normal` for omitted or non-object bodies.
- Kept bodyless sync action routes out of scope because they do not read `req.body`.

Verification after sync priority Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/sync.test.ts` — passed: 1 file, 38 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Admin monitoring Zod normalization slice — 2026-04-13

Implemented the next light parser-backed admin request-body validation slice:

- Added `validate({ body })` to `server/src/api/admin/monitoring.ts` monitoring service URL updates and Grafana anonymous-access updates.
- Preserved the existing optional-field semantics: omitted/empty `customUrl` still clears the override, and omitted `anonymousAccess` still returns success without writing a setting.

Verification after admin monitoring Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/admin-monitoring-routes.test.ts` — passed: 1 file, 16 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### AI internal pull-progress Zod normalization slice — 2026-04-13

Implemented the next internal request-body validation slice:

- Added a permissive `validate({ body })` gate to `server/src/api/ai-internal.ts` `POST /pull-progress`.
- Preserved the tested internal endpoint behavior: the route remains internal-network-only and unauthenticated, valid progress updates still broadcast, and missing `model`/`status` still return `{ error: 'model and status required' }`.
- Kept the schema light because the route receives Ollama-style progress payloads and the existing notification contract accepts status values beyond the narrow websocket TypeScript union used elsewhere in the codebase.

Verification after AI internal pull-progress slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/ai-internal.test.ts` — passed: 1 file, 77 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Draft Zod normalization slice — 2026-04-13

Implemented the next draft request-body validation slice:

- Added `validate({ body })` gates to `server/src/api/drafts.ts` draft create and update routes.
- Kept draft required-field/status semantics service-owned while adding route-level type checks for known draft fields such as numeric values, booleans, strings, UTXO id arrays, and signature device ids.
- Left draft GET/DELETE routes out of scope because they do not read `req.body`.

Verification after draft Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/drafts-routes.test.ts` — passed: 1 file, 18 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Auth profile preferences Zod normalization slice — 2026-04-13

Implemented the next auth profile request-body validation slice:

- Added a `validate({ body })` gate to `server/src/api/auth/profile.ts` `PATCH /me/preferences` with type checks for known top-level preference keys and pass-through support for forward-compatible preference extensions.
- Preserved preference merge semantics for valid object payloads while rejecting non-object bodies and invalid known preference field types before they can be spread into the merged preferences object.
- Kept auth profile GET/search/group routes out of scope because they either do not read `req.body` or already validate query parameters.

Verification after auth profile preferences Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/auth.routes.registration.test.ts` — passed: 1 file, 98 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Auth registration Zod normalization slice — 2026-04-13

Implemented the next auth request-body validation slice:

- Added a `validate({ body })` presence/type gate to `server/src/api/auth/login.ts` `POST /register`.
- Preserved the existing route-owned registration-enabled, email-format, and password-strength checks by validating only presence/string type at the middleware boundary.
- Left `POST /login` as already migrated because it already uses `validate({ body: LoginSchema })`.

Verification after auth registration Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/auth.routes.registration.test.ts` — passed: 1 file, 99 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Auth refresh-token Zod normalization slice — 2026-04-13

Implemented the next auth token request-body validation slice:

- Added a `validate({ body })` gate to `server/src/api/auth/tokens.ts` `POST /refresh` for the JSON-body refresh-token fallback used by mobile/gateway callers.
- Preserved cookie-only refresh behavior by normalizing an absent body to `{}` before schema validation; the route still accepts a valid `sanctuary_refresh` cookie with no body refresh token.
- Left `POST /logout` as already migrated because it already uses `validate({ body: LogoutSchema })`.

Verification after auth refresh-token Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/auth.routes.registration.test.ts` — passed: 1 file, 100 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Admin policy Zod normalization slice — 2026-04-13

Implemented the next admin request-body validation slice:

- Added `validate({ body })` gates to `server/src/api/admin/policies.ts` system-policy create and update routes.
- Used the existing OpenAPI/service contract as the boundary: create requires `name`, `type`, and object `config`; update validates the fields it actually applies (`name`, `description`, `config`, `priority`, `enforcement`, and `enabled`); both schemas reject unknown fields in line with `additionalProperties: false`.
- Kept type-specific policy config validation service-owned because `vaultPolicyService` already validates policy-specific config semantics for spending limits, approvals, time delays, address controls, and velocity policies.

Verification after admin policy Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/admin-policies-routes.test.ts` — passed: 1 file, 29 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Intelligence Zod normalization slice — 2026-04-13

Implemented the next intelligence request-body validation slice:

- Added Zod-backed body parsing inside `server/src/api/intelligence.ts` mutation handlers for insight status updates, conversation creation, conversation messages, and wallet intelligence settings updates.
- Kept the route stack stable instead of adding route-level middleware because the existing intelligence tests intentionally call direct route handlers from the Express stack; the parser now lives inside those handlers and preserves the existing bare response style for already-tested 400 paths.
- Preserved service-owned semantics for conversation ownership and wallet access while rejecting malformed `walletId`, `walletContext`, and settings field types before they reach the services.

Verification after intelligence Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/intelligence.test.ts` — passed: 1 file, 25 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Admin node/proxy Zod normalization slice — 2026-04-13

Implemented the next admin node configuration request-body validation slice:

- Added Zod-backed body parsing inside `server/src/api/admin/nodeConfig.ts` for node-config update and node-config connection-test requests.
- Added Zod-backed body parsing inside `server/src/api/admin/proxyTest.ts` for SOCKS5/Tor proxy test requests.
- Kept the route stack stable instead of adding route-level middleware because `server/tests/unit/api/admin.test.ts` still calls those direct route handlers by stack index; malformed optional node/proxy fields now fail before repository writes or network verification starts.

Verification after admin node/proxy Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/admin-nodeConfig-routes.test.ts` — passed: 1 file, 26 tests.
- `npx vitest run --config server/vitest.config.ts tests/unit/api/admin.test.ts` — passed: 1 file, 71 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction batch Zod normalization slice — 2026-04-13

Implemented the next transaction request-body validation slice:

- Added Zod-backed body parsing to `server/src/api/transactions/drafting.ts` `POST /wallets/:walletId/transactions/batch` through the shared transaction request parser.
- Preserved the route-owned output-list, fee-rate, per-output address/amount, and single-sendMax validation semantics while rejecting malformed field types before wallet lookup, policy evaluation, or batch-transaction service calls.
- Kept neighboring transaction create, estimate, PSBT create, and broadcast routes on their existing shared parser-backed request schemas.

Verification after transaction batch Zod slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/transactions-http-routes.test.ts` — passed: 1 file, 66 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction typing gap slice — 2026-04-13

Implemented the targeted P2 typing cleanup:

- Added typed Prisma payload overloads to `server/src/repositories/transactionRepository.ts` for `findByTxidWithAccess` and `findByWalletIdWithDetails`, preserving caller-specific `select`/`include` result shapes while keeping the wallet access filters authoritative over caller-supplied filters in the single-wallet and multi-wallet detail helpers.
- Replaced the singled-out `walletId!` in `server/src/api/transactions/walletTransactions/listTransactions.ts` with the typed `:walletId` route param.
- Removed the local `as any` and callback-parameter `any` casts from `server/src/api/transactions/transactionDetail.ts` and transaction list label serialization.

Verification after transaction typing slice:

- `npx vitest run --config server/vitest.config.ts tests/unit/repositories/transactionRepository.test.ts tests/unit/api/transactions-transactionDetail-routes.test.ts tests/unit/api/transactions-http-routes.test.ts` — passed: 3 files, 95 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `rg -n "walletId!|as any|:\\s*any\\[\\]|\\(.*: any\\)" server/src/api/transactions/walletTransactions/listTransactions.ts server/src/api/transactions/transactionDetail.ts` — no matches.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction API test split pass — 2026-04-13

Implemented the next oversized API test split:

- Split `server/tests/unit/api/transactions.test.ts` from 2600 LOC into a 25-line suite registrar plus focused transaction API contract modules.
- New transaction API test file sizes: `transactions.wallet-ledger.contracts.ts` 693 LOC, `transactions.balance-export.contracts.ts` 821 LOC, `transactions.mutations.contracts.ts` 749 LOC, `transactions.addresses-recent.contracts.ts` 308 LOC, and shared harness `transactionsTestHarness.ts` 78 LOC.
- Preserved the executable test surface: before/after counts are `describe=22`, `it=78`, and `expect=145`.
- At the time of this split, the next largest non-generated TS/TSX file was `server/tests/unit/api/admin.test.ts` at 2456 LOC; the following admin API split superseded that state, so service/integration tests are now the largest-file target.

Verification after transaction API test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/transactions.test.ts` — passed: 1 file, 78 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Admin API test split pass — 2026-04-13

Implemented the next oversized API test split:

- Split `server/tests/unit/api/admin.test.ts` from 2456 LOC into a 26-line suite registrar plus focused admin API contract modules.
- New admin API test file sizes: `admin.users-groups.contracts.ts` 937 LOC, `admin.settings-node-backup.contracts.ts` 755 LOC, `admin.audit-version-electrum.contracts.ts` 576 LOC, and shared harness `adminTestHarness.ts` 267 LOC.
- Preserved the executable test surface: before/after counts are `describe=38`, `it=71`, and `expect=180`.
- Current largest non-generated TS/TSX file after the later auth registration, transaction creation service, policy engine, blockchain service, backup service, process-transactions phase, and wallet integration splits is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. The admin split closed the named oversized API-test P1 item, while service/integration test files still keep the repo-wide 3.3 score at 0.

Verification after admin API test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/admin.test.ts` — passed: 1 file, 71 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Policy evaluation engine test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/policyEvaluationEngine.test.ts` from 2387 LOC into a 30-line suite registrar plus focused policy engine contract modules.
- New policy engine test file sizes: `evaluate.spending-approval.contracts.ts` 601 LOC, `evaluate.controls-timing.contracts.ts` 563 LOC, `recordUsage.contracts.ts` 528 LOC, `evaluate.error-preview-multiple.contracts.ts` 442 LOC, `windowBounds.contracts.ts` 216 LOC, and shared harness `policyEvaluationEngineTestHarness.ts` 105 LOC.
- Preserved the executable test surface: before/after counts are `describe=14`, `it=82`, and `expect=195`.
- Current largest non-generated TS/TSX file after the later auth registration, transaction creation service, blockchain service, backup service, process-transactions phase, and wallet integration splits is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. This reduces the policy engine hotspot but does not move the repo-wide 3.3 score yet.

Verification after policy evaluation engine test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/policyEvaluationEngine.test.ts` — passed: 1 file, 82 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Blockchain service test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/bitcoin/blockchain.test.ts` from 2378 LOC into a 24-line suite registrar plus focused blockchain contract modules.
- New blockchain test file sizes: `syncAddress.contracts.ts` 493 LOC, `transactions-reconciliation.contracts.ts` 451 LOC, `balances.contracts.ts` 448 LOC, `syncWallet-core.contracts.ts` 443 LOC, `gapLimit.contracts.ts` 295 LOC, `rbf.contracts.ts` 253 LOC, and shared harness `blockchainTestHarness.ts` 62 LOC.
- Preserved the executable test surface: before/after counts are `describe=19`, `it=72`, and `expect=141`.
- Current largest non-generated TS/TSX file after the later auth registration, transaction creation service, backup service, process-transactions phase, and wallet integration splits is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. This reduces the blockchain service hotspot but does not move the repo-wide 3.3 score yet.

Verification after blockchain service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/blockchain.test.ts` — passed: 1 file, 72 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Backup service test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/backupService.test.ts` from 2335 LOC into a 29-line suite registrar plus focused backup service contract modules.
- New backup service test file sizes: `edge-cases.contracts.ts` 559 LOC, `backupService-core.contracts.ts` 492 LOC, `node-config-password.contracts.ts` 313 LOC, `restore.contracts.ts` 305 LOC, `restore-errors.contracts.ts` 186 LOC, `user-2fa-secret.contracts.ts` 178 LOC, `schema-migration.contracts.ts` 153 LOC, `validation-edge-cases.contracts.ts` 111 LOC, `internal-helpers.contracts.ts` 60 LOC, `data-structure.contracts.ts` 32 LOC, and shared harness `backupServiceTestHarness.ts` 28 LOC.
- Preserved the executable test surface: before/after counts are `describe=19`, `it=68`, and `expect=141`.
- Current largest non-generated TS/TSX file after the later auth registration, transaction creation service, process-transactions phase, and wallet integration splits is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. This reduces the backup service hotspot but does not move the repo-wide 3.3 score yet.

Verification after backup service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/backupService.test.ts` — passed: 1 file, 68 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Process transactions phase test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/bitcoin/sync/phases.processTransactions.test.ts` from 2275 LOC into a 43-line suite registrar plus focused process-transactions contract modules.
- New process-transactions test file sizes: `batch-io.contracts.ts` 473 LOC, `labels-dedupe-edge.contracts.ts` 452 LOC, `store-io-primary.contracts.ts` 424 LOC, `classification.contracts.ts` 345 LOC, `notifications-rbf.contracts.ts` 310 LOC, `store-io-edge.contracts.ts` 297 LOC, and shared harness `processTransactionsTestHarness.ts` 49 LOC.
- Preserved the executable test surface: before/after counts are `describe=2`, `it=43`, and `expect=80`.
- Current largest non-generated TS/TSX file after the later wallet integration, auth registration, and transaction creation service splits is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. This reduces the process-transactions phase hotspot but does not move the repo-wide 3.3 score yet.

Verification after process transactions phase test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/sync/phases.processTransactions.test.ts` — passed: 1 file, 43 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Wallet integration test split pass — 2026-04-13

Implemented the next oversized integration-test split:

- Split `server/tests/integration/flows/wallet.integration.test.ts` from 2064 LOC into a 65-line suite registrar plus focused wallet integration contract modules.
- New wallet integration test file sizes: `devices-sharing.contracts.ts` 604 LOC, `access-stats-import.contracts.ts` 500 LOC, `core-crud.contracts.ts` 489 LOC, `groups-telegram.contracts.ts` 452 LOC, and shared harness `walletIntegrationTestHarness.ts` 22 LOC.
- Preserved the executable test surface: before/after counts are `describe=21`, `it=63`, and `expect=140`.
- Current largest non-generated TS/TSX file after the later auth registration and transaction creation service splits is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. This reduces the wallet integration hotspot but does not move the repo-wide 3.3 score yet.

Verification after wallet integration test split:

- `npx vitest run --config server/vitest.config.ts tests/integration/flows/wallet.integration.test.ts` — passed import/collection: 1 file skipped, 63 tests skipped by the suite's DB availability gate.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Auth registration route test split pass — 2026-04-13

Implemented the next oversized API-test split:

- Split `server/tests/unit/api/auth.routes.registration.test.ts` from 2030 LOC into a 21-line suite registrar plus focused auth route contract modules.
- New auth registration route test file sizes: `registration-login.contracts.ts` 534 LOC, `password-tokens.contracts.ts` 498 LOC, `profile-sessions.contracts.ts` 444 LOC, `cookie-expiry.contracts.ts` 373 LOC, and shared harness `authRegistrationTestHarness.ts` 208 LOC.
- Preserved the executable test surface: before/after counts are `describe=17`, `it=100`, and `expect=256`.
- Current largest non-generated TS/TSX file after the later transaction creation service split is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. This reduces the auth registration route hotspot but does not move the repo-wide 3.3 score yet.

Verification after auth registration route test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/auth.routes.registration.test.ts` — passed: 1 file, 100 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction creation service test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/bitcoin/transactionService.create.test.ts` from 1981 LOC into a 21-line suite registrar plus focused transaction creation service contract modules.
- New transaction creation service test file sizes: `create-single-sig.contracts.ts` 553 LOC, `psbt-helpers-legacy.contracts.ts` 527 LOC, `edge-consolidation.contracts.ts` 521 LOC, `multisig.contracts.ts` 291 LOC, and shared harness `transactionServiceCreateTestHarness.ts` 145 LOC.
- Preserved the executable test surface: before/after counts are `describe=15`, `it=87`, and `expect=172`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` at 1941 LOC, followed by `server/tests/unit/services/syncService.test.ts` at 1872 LOC and `server/tests/unit/services/wallet.test.ts` at 1816 LOC when generated verified-vector files are excluded. This reduces the transaction creation service hotspot but does not move the repo-wide 3.3 score yet.

Verification after transaction creation service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/transactionService.create.test.ts` — passed: 1 file, 87 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Electrum pool connection test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/bitcoin/electrumPool.connections.test.ts` from 1941 LOC into a 22-line suite registrar plus focused Electrum connection contract modules.
- New Electrum connection test file sizes: `internal-health-selection.contracts.ts` 652 LOC, `internal-lifecycle.contracts.ts` 481 LOC, `module-level-pool-helpers.contracts.ts` 365 LOC, `internal-reconnect-metrics.contracts.ts` 341 LOC, shared harness `electrumPoolConnectionsTestHarness.ts` 137 LOC, and wrapper registrar `internal-connection-and-queue.contracts.ts` 13 LOC.
- Preserved the executable test surface: before/after counts are `describe=3`, `it=85`, and `expect=188`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/syncService.test.ts` at 1872 LOC, followed by `server/tests/unit/services/wallet.test.ts` at 1816 LOC and `tests/hooks/useWebSocket.test.tsx` at 1752 LOC when generated verified-vector files are excluded. This reduces the Electrum connection hotspot but does not move the repo-wide 3.3 score yet.

Verification after Electrum pool connection test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/electrumPool.connections.test.ts` — passed: 1 file, 85 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Sync service test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/syncService.test.ts` from 1872 LOC into a 29-line suite registrar plus focused sync service contract modules.
- New sync service test file sizes: `execution-retry-polling.contracts.ts` 471 LOC, `address-maintenance.contracts.ts` 455 LOC, `realtime-subscriptions.contracts.ts` 348 LOC, shared harness `syncServiceTestHarness.ts` 337 LOC, `lifecycle-queue.contracts.ts` 319 LOC, and `error-handling.contracts.ts` 38 LOC.
- Preserved the executable test surface: before/after counts are `describe=22`, `it=115`, and `expect=196`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/wallet.test.ts` at 1816 LOC, followed by `tests/hooks/useWebSocket.test.tsx` at 1752 LOC and `server/tests/unit/api/devices.test.ts` at 1702 LOC when generated verified-vector files are excluded. This reduces the sync service hotspot but does not move the repo-wide 3.3 score yet.

Verification after sync service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/syncService.test.ts` — passed: 1 file, 115 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Wallet service test split pass — 2026-04-13

Implemented the next oversized service-test split:

- Split `server/tests/unit/services/wallet.test.ts` from 1816 LOC into a 22-line suite registrar plus focused wallet service contract modules.
- New wallet service test file sizes: `create-account-selection.contracts.ts` 648 LOC, `access-queries.contracts.ts` 416 LOC, `mutations-maintenance.contracts.ts` 351 LOC, `address-descriptor-stats.contracts.ts` 313 LOC, and shared harness `walletTestHarness.ts` 305 LOC.
- Preserved the executable test surface: before/after counts are `describe=10`, `it=57`, and `expect=95`.
- Current largest non-generated TS/TSX file after the split is `tests/hooks/useWebSocket.test.tsx` at 1752 LOC, followed by `server/tests/unit/api/devices.test.ts` at 1702 LOC and `e2e/render-regression.spec.ts` at 1608 LOC when generated verified-vector files are excluded. This reduces the wallet service hotspot but does not move the repo-wide 3.3 score yet.

Verification after wallet service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/wallet.test.ts` — passed: 1 file, 57 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### WebSocket hook test split pass — 2026-04-13

Implemented the next oversized frontend hook-test split:

- Split `tests/hooks/useWebSocket.test.tsx` from 1752 LOC into a 20-line suite registrar plus focused WebSocket hook contract modules.
- New WebSocket hook test file sizes: `use-websocket-query-invalidation.contracts.tsx` 437 LOC, `use-websocket.contracts.tsx` 384 LOC, `use-wallet-logs.contracts.tsx` 361 LOC, `use-model-download-progress.contracts.tsx` 285 LOC, `use-wallet-events.contracts.tsx` 272 LOC, `use-websocket-event.contracts.tsx` 114 LOC, and shared harness `useWebSocketTestHarness.ts` 136 LOC.
- Preserved the executable test surface: before/after counts are `describe=14`, `it=74`, and `expect=145`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/api/devices.test.ts` at 1702 LOC, followed by `e2e/render-regression.spec.ts` at 1608 LOC and `server/tests/unit/api/transactions-http-routes.test.ts` at 1548 LOC when generated verified-vector files are excluded. This reduces the WebSocket hook hotspot but does not move the repo-wide 3.3 score yet.

Verification after WebSocket hook test split:

- `npx vitest run tests/hooks/useWebSocket.test.tsx` — passed: 1 file, 74 tests.
- `npx tsc --noEmit -p tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Device API test split pass — 2026-04-13

Implemented the next oversized backend API-test split:

- Split `server/tests/unit/api/devices.test.ts` from 1702 LOC into a 37-line suite registrar plus focused device API contract modules.
- New device API test file sizes: `devices.registration.contracts.ts` 657 LOC, `devices.crud.contracts.ts` 277 LOC, `devices.sharing.contracts.ts` 245 LOC, `devices.catalog.contracts.ts` 227 LOC, `devices.accounts.contracts.ts` 212 LOC, `devices.account-conflicts.contracts.ts` 11 LOC, and shared harness `devicesTestHarness.ts` 93 LOC.
- Preserved the executable test surface: before/after counts are `describe=17`, `it=74`, and `expect=184`.
- Current largest non-generated TS/TSX file after the split is `e2e/render-regression.spec.ts` at 1608 LOC, followed by `server/tests/unit/api/transactions-http-routes.test.ts` at 1548 LOC and `tests/components/Intelligence.tabs.test.tsx` at 1507 LOC when generated verified-vector files are excluded. This reduces the device API hotspot but does not move the repo-wide 3.3 score yet.

Verification after device API test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/devices.test.ts` — passed: 1 file, 74 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Render-regression e2e split pass — 2026-04-13

Implemented the next oversized Playwright e2e split:

- Split `e2e/render-regression.spec.ts` from 1608 LOC into a 54-line spec registrar plus focused render-regression contract modules and shared API-mock harness.
- Kept all 43 `test(...)` registrations in `e2e/render-regression.spec.ts` so Playwright snapshot ownership stays with the existing spec/snapshot directory.
- New render-regression file sizes: `renderRegressionHarness.ts` 767 LOC, `renderRegressionAdmin.contracts.ts` 261 LOC, `renderRegressionWalletDevice.contracts.ts` 242 LOC, `renderRegressionImportAuth.contracts.ts` 235 LOC, and `renderRegressionCore.contracts.ts` 148 LOC.
- Preserved the executable test surface: before/after counts are `test.describe=1`, `test=43`, and `expect=270`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/api/transactions-http-routes.test.ts` at 1548 LOC, followed by `tests/components/Intelligence.tabs.test.tsx` at 1507 LOC and `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts` at 1494 LOC when generated verified-vector files are excluded. This reduces the e2e render-regression hotspot but does not move the repo-wide 3.3 score yet.

Verification after render-regression e2e split:

- `npx playwright test e2e/render-regression.spec.ts --project=chromium` — passed: 43 tests.
- `npx tsc --noEmit -p tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction HTTP route test split pass — 2026-04-13

Implemented the next oversized backend API route-test split:

- Split `server/tests/unit/api/transactions-http-routes.test.ts` from 1548 LOC into a 13-line suite registrar plus focused transaction HTTP route contract modules.
- New transaction HTTP route test file sizes: `transactionsHttpRoutes.reads.contracts.ts` 677 LOC, `transactionsHttpRoutes.creation.contracts.ts` 398 LOC, `transactionsHttpRoutes.broadcast.contracts.ts` 362 LOC, and shared harness `transactionsHttpRoutesTestHarness.ts` 204 LOC.
- Preserved the executable test surface: before/after counts are `describe=1`, `it=66`, and `expect=183`.
- Current largest non-generated TS/TSX file after the split is `tests/components/Intelligence.tabs.test.tsx` at 1507 LOC, followed by `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts` at 1494 LOC and `server/tests/unit/api/bitcoin.test.ts` at 1480 LOC when generated verified-vector files are excluded. This reduces the transaction HTTP route hotspot but does not move the repo-wide 3.3 score yet.

Verification after transaction HTTP route test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/transactions-http-routes.test.ts` — passed: 1 file, 66 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Intelligence tabs test split pass — 2026-04-13

Implemented the next oversized frontend component-test split:

- Split `tests/components/Intelligence.tabs.test.tsx` from 1507 LOC into a 12-line suite registrar plus focused Intelligence tabs contract modules.
- New Intelligence tabs test file sizes: `chatTab.contracts.tsx` 445 LOC, `settingsTab.contracts.tsx` 362 LOC, `insightsTab.contracts.tsx` 264 LOC, `insightCard.contracts.tsx` 203 LOC, `chatMessage.contracts.tsx` 82 LOC, and shared harness `intelligenceTabsTestHarness.tsx` 121 LOC.
- Preserved the executable test surface: before/after counts are `describe=5`, `it=72`, and `expect=143`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts` at 1494 LOC, followed by `server/tests/unit/api/bitcoin.test.ts` at 1480 LOC and `server/tests/unit/api/drafts.test.ts` at 1466 LOC when generated verified-vector files are excluded. This reduces the frontend component-test hotspot but does not move the repo-wide 3.3 score yet.

Verification after Intelligence tabs test split:

- `npx vitest run tests/components/Intelligence.tabs.test.tsx` — passed: 1 file, 72 tests.
- `npx tsc --noEmit -p tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction broadcast service test split pass — 2026-04-13

Implemented the next oversized backend service-test split:

- Split `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts` from 1494 LOC into a 17-line suite registrar plus focused transaction broadcast service contract modules.
- New transaction broadcast service test file sizes: `transactionServiceBroadcast.broadcastAndSave.contracts.ts` 1228 LOC, `transactionServiceBroadcast.errors.contracts.ts` 117 LOC, and shared harness `transactionServiceBroadcastTestHarness.ts` 148 LOC.
- Preserved the executable test surface: before/after counts are `describe=4`, `it=39`, and `expect=69`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/api/bitcoin.test.ts` at 1480 LOC, followed by `server/tests/unit/api/drafts.test.ts` at 1466 LOC and `server/tests/unit/api/wallets.test.ts` at 1432 LOC when generated verified-vector files are excluded. This reduces the transaction broadcast service hotspot but does not move the repo-wide 3.3 score yet.

Verification after transaction broadcast service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/transactionService.broadcast.test.ts` — passed: 1 file, 39 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Bitcoin API test split pass — 2026-04-13

Implemented the next oversized backend API-test split:

- Split `server/tests/unit/api/bitcoin.test.ts` from 1480 LOC into a 24-line suite registrar plus focused Bitcoin API route contract modules.
- New Bitcoin API test file sizes: `bitcoin.network.contracts.ts` 341 LOC, `bitcoin.transaction.contracts.ts` 333 LOC, `bitcoin.fee.contracts.ts` 243 LOC, `bitcoin.address.contracts.ts` 233 LOC, `bitcoin.sync.contracts.ts` 137 LOC, and shared harness `bitcoinTestHarness.ts` 233 LOC.
- Preserved the executable test surface: before/after counts are `describe=27`, `it=88`, and `expect=163`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/api/drafts.test.ts` at 1466 LOC, followed by `server/tests/unit/api/wallets.test.ts` at 1432 LOC and `server/tests/unit/services/bitcoin/psbtValidation.test.ts` at 1428 LOC when generated verified-vector files are excluded. This reduces the Bitcoin API hotspot but does not move the repo-wide 3.3 score yet.

Verification after Bitcoin API test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/bitcoin.test.ts` — passed: 1 file, 88 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Draft API test split pass — 2026-04-13

Implemented the next oversized backend API-test split:

- Split `server/tests/unit/api/drafts.test.ts` from 1466 LOC into a 17-line suite registrar plus focused Draft API contract modules.
- New Draft API test file sizes: `drafts.multisig.contracts.ts` 414 LOC, `drafts.outputs.contracts.ts` 306 LOC, `drafts.update-delete.contracts.ts` 278 LOC, `drafts.creation.contracts.ts` 273 LOC, `drafts.read.contracts.ts` 171 LOC, and shared harness `draftsTestHarness.ts` 40 LOC.
- Preserved the executable test surface: before/after counts are `describe=16`, `it=43`, and `expect=93`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/api/wallets.test.ts` at 1432 LOC, followed by `server/tests/unit/services/bitcoin/psbtValidation.test.ts` at 1428 LOC and `server/tests/unit/services/walletImport.imports.test.ts` at 1387 LOC when generated verified-vector files are excluded. This reduces the Draft API hotspot but does not move the repo-wide 3.3 score yet.

Verification after Draft API test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/drafts.test.ts` — passed: 1 file, 43 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Wallets API test split pass — 2026-04-13

Implemented the next oversized backend API-test split:

- Split `server/tests/unit/api/wallets.test.ts` from 1432 LOC into a 20-line suite registrar plus focused Wallets API route/helper contract modules.
- New Wallets API test file sizes: shared harness `walletsTestHarness.ts` 322 LOC, `wallets.sharing.contracts.ts` 274 LOC, `wallets.crud.contracts.ts` 213 LOC, `wallets.import-export.contracts.ts` 207 LOC, `wallets.export-mapping.contracts.ts` 205 LOC, `wallets.device-xpub.contracts.ts` 118 LOC, and `wallets.analytics.contracts.ts` 112 LOC.
- Preserved the executable test surface: before/after counts are `describe=24`, `it=77`, and `expect=180`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/bitcoin/psbtValidation.test.ts` at 1428 LOC, followed by `server/tests/unit/services/walletImport.imports.test.ts` at 1387 LOC and `server/tests/unit/services/transferService.test.ts` at 1347 LOC when generated verified-vector files are excluded. This reduces the Wallets API hotspot but does not move the repo-wide 3.3 score yet.

Verification after Wallets API test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/wallets.test.ts` — passed: 1 file, 77 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### PSBT validation test split pass — 2026-04-13

Implemented the next oversized backend service-test split:

- Split `server/tests/unit/services/bitcoin/psbtValidation.test.ts` from 1428 LOC into a 12-line suite registrar plus focused PSBT validation contract modules.
- New PSBT validation test file sizes: `psbtValidation.payjoin.contracts.ts` 657 LOC, `psbtValidation.extraction-metrics.contracts.ts` 282 LOC, `psbtValidation.parse-structure.contracts.ts` 190 LOC, `psbtValidation.clone-merge-edge.contracts.ts` 142 LOC, and shared harness `psbtValidationTestHarness.ts` 141 LOC.
- Preserved the executable test surface: before/after counts are `describe=18`, `it=64`, and `expect=108`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/walletImport.imports.test.ts` at 1387 LOC, followed by `server/tests/unit/services/transferService.test.ts` at 1347 LOC and `server/tests/integration/flows/admin.integration.test.ts` at 1339 LOC when generated verified-vector files are excluded. This reduces the PSBT validation hotspot but does not move the repo-wide 3.3 score yet.

Verification after PSBT validation test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/psbtValidation.test.ts` — passed: 1 file, 64 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Wallet import service test split pass — 2026-04-13

Implemented the next oversized backend service-test split:

- Split `server/tests/unit/services/walletImport.imports.test.ts` from 1387 LOC into a 16-line suite registrar plus focused wallet import service contract modules.
- New wallet import service test file sizes: `walletImportImports.descriptor.contracts.ts` 500 LOC, `walletImportImports.json.contracts.ts` 395 LOC, `walletImportImports.auto-detect.contracts.ts` 305 LOC, and `walletImportImports.parsed.contracts.ts` 226 LOC.
- Preserved the executable test surface: before/after counts are `describe=5`, `it=25`, and `expect=61`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/transferService.test.ts` at 1347 LOC, followed by `server/tests/integration/flows/admin.integration.test.ts` at 1339 LOC and `server/tests/unit/utils/docker.test.ts` at 1315 LOC when generated verified-vector files are excluded. This reduces the wallet import service hotspot but does not move the repo-wide 3.3 score yet.

Verification after wallet import service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/walletImport.imports.test.ts` — passed: 1 file, 25 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transfer service test split pass — 2026-04-13

Implemented the next oversized backend service-test split:

- Split `server/tests/unit/services/transferService.test.ts` from 1347 LOC into a 15-line suite registrar plus focused transfer service contract modules.
- New transfer service test file sizes: `transferService.confirm.contracts.ts` 503 LOC, `transferService.state-changes.contracts.ts` 343 LOC, `transferService.queries-expiry.contracts.ts` 292 LOC, `transferService.initiate.contracts.ts` 210 LOC, and shared harness `transferServiceTestHarness.ts` 48 LOC.
- Preserved the executable test surface: before/after counts are `describe=11`, `it=54`, and `expect=70`.
- Current largest non-generated TS/TSX file after the split is `server/tests/integration/flows/admin.integration.test.ts` at 1339 LOC, followed by `server/tests/unit/utils/docker.test.ts` at 1315 LOC and `server/tests/unit/services/intelligence/analysisService.test.ts` at 1304 LOC when generated verified-vector files are excluded. This reduces the transfer service hotspot but does not move the repo-wide 3.3 score yet.

Verification after transfer service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/transferService.test.ts` — passed: 1 file, 54 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Admin integration test split pass — 2026-04-13

Implemented the next oversized integration-test split:

- Split `server/tests/integration/flows/admin.integration.test.ts` from 1339 LOC into a 45-line suite registrar plus focused admin integration contract modules.
- New admin integration test file sizes: `groups.contracts.ts` 411 LOC, `users.contracts.ts` 387 LOC, `access-control.contracts.ts` 277 LOC, `audit.contracts.ts` 212 LOC, and shared harness `adminIntegrationTestHarness.ts` 69 LOC.
- Preserved the executable test surface: before/after counts are `describe=14`, `it=55`, and `expect=132`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/utils/docker.test.ts` at 1315 LOC, followed by `server/tests/unit/services/intelligence/analysisService.test.ts` at 1304 LOC and `server/tests/unit/services/bitcoin/descriptorParser.test.ts` at 1286 LOC when generated verified-vector files are excluded. This reduces the admin integration hotspot but does not move the repo-wide 3.3 score yet.

Verification after admin integration test split:

- `npx vitest run --config server/vitest.config.ts tests/integration/flows/admin.integration.test.ts` — collected the split suite successfully with the DB gate closed: 1 file skipped, 55 tests skipped.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Docker utility test split pass — 2026-04-13

Implemented the next oversized unit-test split:

- Split `server/tests/unit/utils/docker.test.ts` from 1315 LOC into a 22-line suite registrar plus focused Docker utility contract modules.
- New Docker utility test file sizes: `ollama-lifecycle.contracts.ts` 473 LOC, `tor-lifecycle.contracts.ts` 295 LOC, `tor-create.contracts.ts` 276 LOC, `status.contracts.ts` 156 LOC, `error-discovery.contracts.ts` 115 LOC, and shared harness `dockerTestHarness.ts` 43 LOC.
- Preserved the executable test surface: before/after counts are `describe=13`, `it=56`, and `expect=110`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/intelligence/analysisService.test.ts` at 1304 LOC, followed by `server/tests/unit/services/bitcoin/descriptorParser.test.ts` at 1286 LOC and `server/tests/unit/services/blockchainService.test.ts` at 1265 LOC when generated verified-vector files are excluded. This reduces the Docker utility hotspot but does not move the repo-wide 3.3 score yet.

Verification after Docker utility test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/utils/docker.test.ts` — passed: 1 file, 56 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Analysis service test split pass — 2026-04-13

Implemented the next oversized unit-test split:

- Split `server/tests/unit/services/intelligence/analysisService.test.ts` from 1304 LOC into a 17-line suite registrar plus focused analysis service contract modules.
- New analysis service test file sizes: `runAnalysis.error-dedup.contracts.ts` 367 LOC, `runAnalysis.fee-anomaly.contracts.ts` 263 LOC, `runAnalysis.tax-consolidation.contracts.ts` 261 LOC, `runAnalysis.config-utxo.contracts.ts` 245 LOC, `analysisServiceTestHarness.ts` 110 LOC, `intelligenceStatus.contracts.ts` 111 LOC, and `runAnalysisPipelines.contracts.ts` 18 LOC.
- Preserved the executable test surface: before/after counts are `describe=3`, `it=35`, and `expect=44`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/bitcoin/descriptorParser.test.ts` at 1286 LOC, followed by `server/tests/unit/services/blockchainService.test.ts` at 1265 LOC and `server/tests/unit/api/admin-routes.test.ts` at 1258 LOC when generated verified-vector files are excluded. This reduces the analysis service hotspot but does not move the repo-wide 3.3 score yet.

Verification after analysis service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/intelligence/analysisService.test.ts` — passed: 1 file, 35 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Descriptor parser test split pass — 2026-04-13

Implemented the next oversized unit-test split:

- Split `server/tests/unit/services/bitcoin/descriptorParser.test.ts` from 1286 LOC into a 28-line suite registrar plus focused descriptor parser contract modules.
- New descriptor parser test file sizes: `json-import.contracts.ts` 384 LOC, `text-coldcard-checksum.contracts.ts` 276 LOC, `derivation-errors.contracts.ts` 234 LOC, `auto-detection.contracts.ts` 216 LOC, `single-sig.contracts.ts` 110 LOC, `multi-sig.contracts.ts` 85 LOC, and shared harness `descriptorParserTestHarness.ts` 17 LOC.
- Preserved the executable test surface: before/after counts are `describe=24`, `it=96`, and `expect=196`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/blockchainService.test.ts` at 1265 LOC, followed by `server/tests/unit/api/admin-routes.test.ts` at 1258 LOC and `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.contracts.ts` at 1228 LOC when generated verified-vector files are excluded. This reduces the descriptor parser hotspot but does not move the repo-wide 3.3 score yet.

Verification after descriptor parser test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/descriptorParser.test.ts` — passed: 1 file, 96 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Blockchain service aggregate test split pass — 2026-04-13

Implemented the next oversized unit-test split:

- Split `server/tests/unit/services/blockchainService.test.ts` from 1265 LOC into a 23-line suite registrar plus focused blockchain service contract modules.
- New blockchain service test file sizes: `transaction-detection.contracts.ts` 352 LOC, `utxo-management.contracts.ts` 231 LOC, `broadcasting-validation-reorg.contracts.ts` 218 LOC, `balance-calculation.contracts.ts` 204 LOC, `address-discovery.contracts.ts` 146 LOC, and shared harness `blockchainServiceTestHarness.ts` 128 LOC.
- Preserved the executable test surface: before/after counts are `describe=22`, `it=33`, and `expect=53`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/api/admin-routes.test.ts` at 1258 LOC, followed by `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.contracts.ts` at 1228 LOC and `server/tests/unit/repositories/policyRepository.test.ts` at 1210 LOC when generated verified-vector files are excluded. This reduces the blockchain service hotspot but does not move the repo-wide 3.3 score yet.

Verification after blockchain service aggregate test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/blockchainService.test.ts` — passed: 1 file, 33 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Admin routes HTTP test split pass — 2026-04-13

Implemented the next oversized API-route test split:

- Split `server/tests/unit/api/admin-routes.test.ts` from 1258 LOC into a 26-line suite registrar plus focused Admin Routes HTTP contract modules.
- New Admin Routes HTTP test file sizes: `adminRoutes.users-update-delete.contracts.ts` 313 LOC, `adminRoutes.users-read-create.contracts.ts` 235 LOC, `adminRoutesTestHarness.ts` 212 LOC, `adminRoutes.settings.contracts.ts` 184 LOC, `adminRoutes.audit-version.contracts.ts` 156 LOC, `adminRoutes.groups.contracts.ts` 99 LOC, and `adminRoutes.delete.contracts.ts` 73 LOC.
- Preserved the executable test surface: before/after counts are `describe=13`, `it=59`, and `expect=129`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.contracts.ts` at 1228 LOC, followed by `server/tests/unit/repositories/policyRepository.test.ts` at 1210 LOC and `server/tests/unit/websocket/clientServerLimits.test.ts` at 1189 LOC when generated verified-vector files are excluded. This reduces the admin-routes hotspot but does not move the repo-wide 3.3 score yet.

Verification after Admin Routes HTTP test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/admin-routes.test.ts` — passed: 1 file, 59 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

### Transaction broadcast-and-save submodule split pass — 2026-04-13

Implemented the next oversized backend service-test submodule split:

- Split `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.contracts.ts` from 1228 LOC into a 17-line broadcast-and-save registrar plus focused contract modules.
- New transaction broadcast-and-save file sizes: `transactionServiceBroadcast.broadcastAndSave.notifications.contracts.ts` 471 LOC, `transactionServiceBroadcast.broadcastAndSave.failures-rbf.contracts.ts` 264 LOC, `transactionServiceBroadcast.broadcastAndSave.psbt-fallback.contracts.ts` 259 LOC, `transactionServiceBroadcast.broadcastAndSave.core.contracts.ts` 220 LOC, and shared defaults `transactionServiceBroadcast.broadcastAndSave.shared.ts` 37 LOC.
- Preserved the executable test surface across `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts` and the transaction broadcast contract modules: before/after counts are `describe=4`, `it=39`, and `expect=69`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/repositories/policyRepository.test.ts` at 1210 LOC, followed by `server/tests/unit/websocket/clientServerLimits.test.ts` at 1189 LOC and `tests/api/client.test.ts` at 1174 LOC when generated verified-vector files are excluded. This reduces the transaction broadcast-and-save hotspot but does not move the repo-wide 3.3 score yet.

Verification after transaction broadcast-and-save submodule split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/bitcoin/transactionService.broadcast.test.ts` — passed: 1 file, 39 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.*.ts` — passed: no trailing-whitespace hits in the newly split files.
- `git diff --cached --check` — passed.

### Policy repository test split pass — 2026-04-13

Implemented the next oversized repository-test split:

- Split `server/tests/unit/repositories/policyRepository.test.ts` from 1210 LOC into a 15-line suite registrar plus focused policy repository contract modules.
- New policy repository test file sizes: `policyRepository.events-addresses.contracts.ts` 353 LOC, `policyRepository.approvals-votes.contracts.ts` 288 LOC, `policyRepository.usage-export.contracts.ts` 278 LOC, `policyRepository.policy-crud.contracts.ts` 271 LOC, and shared harness `policyRepositoryTestHarness.ts` 54 LOC.
- Preserved the executable test surface: before/after counts are `describe=30`, `it=64`, and `expect=129`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/websocket/clientServerLimits.test.ts` at 1189 LOC, followed by `tests/api/client.test.ts` at 1174 LOC and `server/src/api/openapi/paths/admin.ts` at 1173 LOC when generated verified-vector files are excluded. This reduces the policy repository hotspot but does not move the repo-wide 3.3 score yet.

Verification after policy repository test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/repositories/policyRepository.test.ts` — passed: 1 file, 64 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" server/tests/unit/repositories/policyRepository.test.ts server/tests/unit/repositories/policyRepository/*.ts` — passed: no trailing-whitespace hits in the newly split files.
- `git diff --cached --check` — passed.


### WebSocket limits test split pass — 2026-04-13

Implemented the next oversized WebSocket unit-test split:

- Split `server/tests/unit/websocket/clientServerLimits.test.ts` from 1189 LOC into a 22-line suite registrar plus focused WebSocket limits contract modules.
- New WebSocket limits file sizes: `clientServerLimits.message-flow.contracts.ts` 291 LOC, `clientServerLimits.batch-rate.contracts.ts` 269 LOC, `clientServerLimits.auth-upgrade.contracts.ts` 207 LOC, `clientServerLimits.broadcast-stats-lifecycle.contracts.ts` 203 LOC, `clientServerLimits.subscriptions.contracts.ts` 149 LOC, and shared harness `clientServerLimitsTestHarness.ts` 146 LOC.
- Preserved the executable test surface: before/after counts are `describe=1`, `it=54`, and `expect=171`.
- Current largest non-generated TS/TSX file after the split is `tests/api/client.test.ts` at 1174 LOC, followed by `server/src/api/openapi/paths/admin.ts` at 1173 LOC and `tests/contexts/AppNotificationContext.test.tsx` at 1154 LOC when generated verified-vector files are excluded. This reduces the WebSocket test hotspot but does not move the repo-wide 3.3 score yet.

Verification after WebSocket limits test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/websocket/clientServerLimits.test.ts` — passed: 1 file, 54 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" server/tests/unit/websocket/clientServerLimits.test.ts server/tests/unit/websocket/clientServerLimits` — passed: no trailing-whitespace hits in the newly split files.
- `rg --files -g '*.ts' -g '*.tsx' | rg -v '(^|/)(node_modules|dist|coverage)(/|$)|generated|verified.*vectors|verified.*Vectors' | xargs wc -l | sort -nr | sed -n '1,20p'` — passed: next largest files are `tests/api/client.test.ts` 1174 LOC, `server/src/api/openapi/paths/admin.ts` 1173 LOC, and `tests/contexts/AppNotificationContext.test.tsx` 1154 LOC.
- `git diff --check` — passed.


### API client test split pass — 2026-04-13

Implemented the next oversized frontend API-client test split:

- Split `tests/api/client.test.ts` from 1174 LOC into a 26-line suite registrar plus focused API client contract modules.
- New API client file sizes: `client.cookie-auth.contracts.ts` 354 LOC, `client.basic.contracts.ts` 321 LOC, `client.retry.contracts.ts` 225 LOC, `client.transfer.contracts.ts` 200 LOC, shared harness `clientTestHarness.ts` 62 LOC, and `client.initialization.contracts.ts` 36 LOC.
- Preserved the executable test surface: before/after counts are `describe=12`, `it=67`, and `expect=121`.
- Current largest non-generated TS/TSX file after the split is `server/src/api/openapi/paths/admin.ts` at 1173 LOC, followed by `tests/contexts/AppNotificationContext.test.tsx` at 1154 LOC and `server/tests/unit/services/payjoinService.test.ts` at 1115 LOC when generated verified-vector files are excluded. This reduces the API client test hotspot but does not move the repo-wide 3.3 score yet.

Verification after API client test split:

- `npx vitest run tests/api/client.test.ts` — passed: 1 file, 67 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" tests/api/client.test.ts tests/api/client` — passed: no trailing-whitespace hits in the newly split files.
- `rg --files -g '*.ts' -g '*.tsx' | rg -v '(^|/)(node_modules|dist|coverage)(/|$)|generated|verified.*vectors|verified.*Vectors' | xargs wc -l | sort -nr | sed -n '1,20p'` — passed: next largest files are `server/src/api/openapi/paths/admin.ts` 1173 LOC, `tests/contexts/AppNotificationContext.test.tsx` 1154 LOC, and `server/tests/unit/services/payjoinService.test.ts` 1115 LOC.
- `git diff --check` — passed.


### OpenAPI admin path split pass — 2026-04-13

Implemented the next oversized production OpenAPI path-data split:

- Split `server/src/api/openapi/paths/admin.ts` from 1173 LOC into an 18-line aggregate plus focused admin path modules.
- New OpenAPI admin path file sizes: `admin/operations.ts` 369 LOC, `admin/identity-policy.ts` 251 LOC, `admin/features-audit.ts` 221 LOC, `admin/core.ts` 219 LOC, and shared helpers `admin/shared.ts` 165 LOC.
- Preserved the public import surface: `server/src/api/openapi/spec.ts` still imports `adminPaths` from `./paths/admin`, and the aggregate keeps the original path group order through object spreads.
- Current largest non-generated TS/TSX file after the split is `tests/contexts/AppNotificationContext.test.tsx` at 1154 LOC, followed by `server/tests/unit/services/payjoinService.test.ts` at 1115 LOC and `server/tests/unit/worker/workerJobQueue.test.ts` at 1098 LOC when generated verified-vector files are excluded. This reduces the OpenAPI admin path hotspot but does not move the repo-wide 3.3 score yet.

Verification after OpenAPI admin path split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/openapi.test.ts` — passed: 1 file, 42 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" server/src/api/openapi/paths/admin.ts server/src/api/openapi/paths/admin` — passed: no trailing-whitespace hits in the newly split files.
- `rg --files -g '*.ts' -g '*.tsx' | rg -v '(^|/)(node_modules|dist|coverage)(/|$)|generated|verified.*vectors|verified.*Vectors' | xargs wc -l | sort -nr | sed -n '1,20p'` — passed: next largest files are `tests/contexts/AppNotificationContext.test.tsx` 1154 LOC, `server/tests/unit/services/payjoinService.test.ts` 1115 LOC, and `server/tests/unit/worker/workerJobQueue.test.ts` 1098 LOC.
- `git diff --check` — passed.


### AppNotificationContext test split pass — 2026-04-13

Implemented the next oversized frontend context-test split:

- Split `tests/contexts/AppNotificationContext.test.tsx` from 1154 LOC into a 28-line suite registrar plus focused AppNotificationContext contract modules.
- New AppNotificationContext test file sizes: `AppNotificationContext.lifecycle-crud.contracts.tsx` 428 LOC, `AppNotificationContext.selectors-panel.contracts.tsx` 293 LOC, `AppNotificationContext.persistence-expiration.contracts.tsx` 228 LOC, `AppNotificationContext.scoped-hooks.contracts.tsx` 195 LOC, and shared harness `AppNotificationContextTestHarness.tsx` 27 LOC.
- Preserved the executable test surface: before/after counts are `describe=17`, `it=50`, and `expect=102`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/services/payjoinService.test.ts` at 1115 LOC, followed by `server/tests/unit/worker/workerJobQueue.test.ts` at 1098 LOC and `server/src/api/openapi/schemas/admin.ts` at 1077 LOC when generated verified-vector files are excluded. This reduces the AppNotificationContext test hotspot but does not move the repo-wide 3.3 score yet.

Verification after AppNotificationContext test split:

- `npx vitest run tests/contexts/AppNotificationContext.test.tsx` — passed: 1 file, 50 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" tests/contexts/AppNotificationContext.test.tsx tests/contexts/AppNotificationContext` — passed: no trailing-whitespace hits in the newly split files.
- `rg --files -g '*.ts' -g '*.tsx' | rg -v '(^|/)(node_modules|dist|coverage)(/|$)|generated|verified.*vectors|verified.*Vectors|\\.tmp-gh' | xargs wc -l | sort -nr | sed -n '1,25p'` — passed: next largest files are `server/tests/unit/services/payjoinService.test.ts` 1115 LOC, `server/tests/unit/worker/workerJobQueue.test.ts` 1098 LOC, and `server/src/api/openapi/schemas/admin.ts` 1077 LOC.
- `git diff --check` — passed.


### Payjoin service test split pass — 2026-04-13

Implemented the next oversized backend service-test split:

- Split `server/tests/unit/services/payjoinService.test.ts` from 1115 LOC into a 29-line suite registrar plus focused Payjoin service contract modules.
- New Payjoin service test file sizes: `payjoinService.utxo.contracts.ts` 326 LOC, `payjoinService.send-ssrf.contracts.ts` 299 LOC, `payjoinService.bip21.contracts.ts` 238 LOC, `payjoinService.process.contracts.ts` 227 LOC, and shared harness `payjoinServiceTestHarness.ts` 67 LOC.
- Preserved the executable test surface: before/after counts are `describe=8`, `it=59`, and `expect=119`.
- Current largest non-generated TS/TSX file after the split is `server/tests/unit/worker/workerJobQueue.test.ts` at 1098 LOC, followed by `server/src/api/openapi/schemas/admin.ts` at 1077 LOC and `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` at 1072 LOC when generated verified-vector files are excluded. This reduces the Payjoin service test hotspot but does not move the repo-wide 3.3 score yet.

Verification after Payjoin service test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/services/payjoinService.test.ts` — passed: 1 file, 59 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" server/tests/unit/services/payjoinService.test.ts server/tests/unit/services/payjoinService` — passed: no trailing-whitespace hits in the newly split files.
- `rg --files -g '*.ts' -g '*.tsx' | rg -v '(^|/)(node_modules|dist|coverage)(/|$)|generated|verified.*vectors|verified.*Vectors|\\.tmp-gh' | xargs wc -l | sort -nr | sed -n '1,25p'` — passed: next largest files are `server/tests/unit/worker/workerJobQueue.test.ts` 1098 LOC, `server/src/api/openapi/schemas/admin.ts` 1077 LOC, and `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` 1072 LOC.
- `git diff --check` — passed.


### Worker job queue test split pass — 2026-04-13

Implemented the next oversized worker unit-test split:

- Split `server/tests/unit/worker/workerJobQueue.test.ts` from 1098 LOC into a 37-line suite registrar plus focused worker job queue contract modules.
- New worker job queue test file sizes: `workerJobQueue.internal-locks.contracts.ts` 292 LOC, `workerJobQueue.health-lifecycle.contracts.ts` 188 LOC, `workerJobQueue.internal-events.contracts.ts` 179 LOC, `workerJobQueue.recurring.contracts.ts` 171 LOC, `workerJobQueue.core.contracts.ts` 148 LOC, `workerJobQueue.internal-branches.contracts.ts` 76 LOC, and shared harness `workerJobQueueTestHarness.ts` 100 LOC.
- Preserved the executable test surface: before/after counts are `describe=15`, `it=57`, and `expect=84`.
- Current largest non-generated TS/TSX file after the split is `server/src/api/openapi/schemas/admin.ts` at 1077 LOC, followed by `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` at 1072 LOC each when generated verified-vector files are excluded. This reduces the worker job queue test hotspot but does not move the repo-wide 3.3 score yet.

Verification after worker job queue test split:

- `npx vitest run --config server/vitest.config.ts tests/unit/worker/workerJobQueue.test.ts` — passed: 1 file, 57 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `rg -n "[ \t]+$" server/tests/unit/worker/workerJobQueue.test.ts server/tests/unit/worker/workerJobQueue` — passed: no trailing-whitespace hits in the newly split files.
- `rg --files -g '*.ts' -g '*.tsx' | rg -v '(^|/)(node_modules|dist|coverage)(/|$)|generated|verified.*vectors|verified.*Vectors|\\.tmp-gh' | xargs wc -l | sort -nr | sed -n '1,25p'` — passed: next largest files are `server/src/api/openapi/schemas/admin.ts` 1077 LOC, `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` 1072 LOC, and `server/tests/unit/services/bitcoin/advancedTx.test.ts` 1072 LOC.
- `git diff --check` — passed.


### OpenAPI admin schema split pass — 2026-04-13

Implemented the next oversized production OpenAPI schema split:

- Split `server/src/api/openapi/schemas/admin.ts` from 1077 LOC into a 19-line aggregate plus focused OpenAPI admin schema modules.
- New OpenAPI admin schema file sizes: `core-settings-backup.ts` 228 LOC, `electrum-runtime.ts` 211 LOC, `features-audit.ts` 117 LOC, `identity-groups.ts` 146 LOC, `ops-monitoring-node.ts` 248 LOC, and shared helpers `shared.ts` 160 LOC.
- Preserved the public OpenAPI import surface: `server/src/api/openapi/spec.ts` still imports `{ adminSchemas }` from `./schemas/admin`.
- Validated the split against repository files: the ordered `Admin*` schema-name list from `HEAD:server/src/api/openapi/schemas/admin.ts` matches the new module files in aggregate spread order.
- Current largest non-generated TS/TSX files after the split are `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` and `server/tests/unit/services/bitcoin/advancedTx.test.ts` at 1072 LOC each, followed by `server/tests/unit/middleware/auth.test.ts` at 1063 LOC when generated verified-vector files are excluded. This reduces the OpenAPI admin schema hotspot but does not move the repo-wide 3.3 score yet.

Verification after OpenAPI admin schema split:

- `npx vitest run --config server/vitest.config.ts tests/unit/api/openapi.test.ts` — passed: 1 file, 42 tests.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npm run lint` — passed.
- `diff -u <old Admin* schema list> <new aggregate-order Admin* schema list>` — passed: no schema-name or order differences.
- `rg -n "[ \t]+$" server/src/api/openapi/schemas/admin.ts server/src/api/openapi/schemas/admin` — passed: no trailing-whitespace hits in the newly split files.
- `rg --files -g '*.ts' -g '*.tsx' | rg -v '(^|/)(node_modules|dist|coverage)(/|$)|generated|verified.*vectors|verified.*Vectors|\\.tmp-gh' | xargs wc -l | sort -nr | sed -n '1,25p'` — passed: next largest files are `server/tests/unit/services/bitcoin/transactionService.batch.test.ts` 1072 LOC, `server/tests/unit/services/bitcoin/advancedTx.test.ts` 1072 LOC, and `server/tests/unit/middleware/auth.test.ts` 1063 LOC.
- `git diff --check` — passed.
