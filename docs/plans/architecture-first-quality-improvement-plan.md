# Architecture-First Codebase Improvement Plan

Date: 2026-04-14, Pacific/Honolulu
Status: Current architecture-first checklist complete; target-environment calibration remains release-specific

## Goal

Improve the codebase in ways that are objectively better for long-term operation, change safety, security, and maintainability. Higher grade scores are a secondary measurement of those improvements, not the primary goal.

This plan only includes work that can be verified mechanically or with concrete runtime evidence. A change is in scope when it does at least one of the following:

- Makes an important boundary explicit and enforceable.
- Turns a human convention into an executable contract.
- Removes an actual correctness, reliability, or security failure.
- Reduces drift between API contracts, runtime behavior, and tests.
- Improves diagnosability or recovery behavior under failure.
- Produces repeatable evidence for future changes.

## Current Baseline

The latest grade report at plan creation records a `69/100` overall score, with a raw domain total of `72/100` capped by hard-fail blockers. The useful facts for this plan are:

- At plan creation, `npm test` failed in API client cookie-auth and refresh behavior tests. Phase 0.1 has since restored the frontend test baseline.
- `npm run lint` and `npm run typecheck` pass.
- Root `npm audit --json` reports no high or critical advisories.
- At plan creation, full working-tree secret scan reported ignored local secrets in `.env` and `docker/nginx/ssl/privkey.pem`; tracked-tree and latest-commit secret scans were clean. Phase 0.2 has since moved those local runtime secrets outside the checkout and full-tree scans are clean.
- Exact duplicate code is low at `2.23%`, so broad deduplication is not a priority.
- At plan creation, coverage and complexity were not measured by the grade workflow, so quality decisions lacked two important repeatable signals.

After Phase 0.1 and Phase 0.2, the latest full grade report records `91/100` (`A`, high confidence). Tests, lint, typecheck, coverage, full-tree secrets, tracked-tree secrets, latest-commit secrets, pinned complexity, duplication, high-severity audits, large-file classification, browser-auth contract checks, architecture-boundary checks, OpenAPI route coverage, lifecycle wiring tests, and Phase 3 generated capacity proof are green through direct verification. Subsequent objective work has also closed the shell-string disk monitoring probe, triaged dependency advisory debt, proved fresh install plus upgrade e2e paths with external runtime secrets, migrated token-revocation cleanup into the lifecycle graph, added an enforceable route-to-repository boundary with a shrinking exception baseline, moved admin settings, admin monitoring, admin group, admin Electrum server, and wallet policy persistence behind service facades, added selected admin and wallet policy OpenAPI response-key parity guards, and reran the full generated scale proof after the lifecycle/startup change.

## Progress Log

### 2026-04-14

- Completed Phase 0.1 by extracting browser auth policy into `src/api/authPolicy.ts`, wiring ApiClient, the raw refresh request, and the admin backup direct-fetch path through that shared policy, and updating the stale `/auth/me` comment in `contexts/UserContext.tsx`.
- Added direct policy tests in `tests/api/authPolicy.test.ts` for CSRF header injection, cookie parsing, refresh-exempt endpoint normalization, and first-pass `401` refresh eligibility.
- Updated ADR 0002 to identify `src/api/authPolicy.ts` as the shared owner for browser refresh eligibility and CSRF header decisions.
- Verification evidence: `npx vitest run tests/api/authPolicy.test.ts tests/api/refresh.test.ts tests/api/client.test.ts tests/api/remainingApiModules.test.ts` passed `125` tests; `npm run typecheck` passed; `npm run lint:app` passed; final `npm run test:run` passed `388` test files and `5504` tests.
- Follow-up: the original cookie-auth failure did not reproduce before or after the extraction. If CI sees it again, preserve the Vitest file order, random seed if present, and worker isolation details before changing behavior; treat it as a possible shared cookie/mock isolation issue until evidence says otherwise.
- Completed Phase 0.2 for the current checkout by moving `.env`, `docker/nginx/ssl/fullchain.pem`, and `docker/nginx/ssl/privkey.pem` to `/home/nekoguntai/.config/sanctuary`, adding external runtime-secret support to `start.sh`, Docker Compose SSL mounts, and the cert generator, and documenting the runtime secret contract in `docs/RUNTIME_SECRETS.md`.
- Added `scripts/secrets/migrate-runtime-secrets.sh` to make the migration repeatable without weakening secret detection; migrated env files stay `600`, while PEM files stay `644` so the existing containers can read bind-mounted certificates.
- Added `docker/nginx/ssl/*.pem` to `.dockerignore` so TLS private keys are excluded from Docker build contexts even if a developer recreates them in the legacy path.
- Verification evidence: `bash -n start.sh`, `bash -n docker/nginx/ssl/generate-certs.sh`, and `bash -n scripts/secrets/migrate-runtime-secrets.sh` passed; `bash tests/install/unit/install-script.test.sh` passed `69` tests; `SANCTUARY_SSL_DIR=/tmp/sanctuary-ssl JWT_SECRET=test ENCRYPTION_KEY=12345678901234567890123456789012 GATEWAY_SECRET=test POSTGRES_PASSWORD=test docker compose config --quiet` passed; full working-tree gitleaks, tracked-tree gitleaks, and latest-commit gitleaks all found no leaks.
- Completed the Phase 0.2 fresh-install follow-up: `scripts/setup.sh` now defaults fresh runtime env files to `${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}/sanctuary.env` and fresh TLS material to `${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}/ssl`, while preserving legacy repo-root `.env` and repo-local SSL fallbacks for upgrades.
- Updated `install.sh` to load the resolved runtime env first during upgrades, with repo-root `.env` retained as a backwards-compatible fallback.
- Updated installer unit/e2e coverage to assert the external runtime-secret contract for setup, install, upgrade, and certificate-generation paths.
- Verification evidence: `bash -n scripts/setup.sh install.sh tests/install/e2e/install-script.test.sh tests/install/e2e/upgrade-install.test.sh tests/install/e2e/fresh-install.test.sh` passed; `bash tests/install/unit/install-script.test.sh` passed `73` tests; a non-start setup smoke with `SANCTUARY_RUNTIME_DIR=/tmp/...` created external `sanctuary.env` and `ssl/*.pem`, did not recreate repo-local `.env` or PEMs, and `docker compose config --quiet` passed with the external env.
- Re-ran the full grade after Phase 0.1 and Phase 0.2. That point-in-time report was `87/100` (`B`, high confidence), with no hard-fail blockers.
- Added the missing `src/api/authPolicy.ts` non-browser cookie fallback test after `npm run test:coverage` exposed one uncovered branch. Final `npm run test:coverage` passed `388` files, `5505` tests, and `100%` statements/branches/functions/lines.
- Verification evidence: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm audit --json`, full-tree gitleaks, tracked-tree gitleaks, latest-commit gitleaks, and `npx --yes jscpd@4 --silent --reporters json --output /tmp/grade-jscpd-current .` passed or produced actionable clean/non-blocking signals.
- Replaced `server/src/services/maintenance/diskMonitoring.ts` shell-string `exec` calls with fixed-argument `execFile` calls for Docker and `df -hP`, and kept malformed Docker/df output non-fatal for maintenance.
- Updated maintenance unit coverage to assert the fixed `execFile` argument arrays, warning/audit behavior, missing Docker behavior, per-volume failures, and malformed `df` output.
- Expanded `scripts/quality.sh` into the project-owned quality gate for lint, typecheck, coverage tests, root/server/gateway high-severity audit gates, full-tree/latest-commit/tracked-tree gitleaks scans, pinned `lizard` complexity, and `jscpd` duplication reporting.
- Added `scripts/quality/lizard-requirements.txt` with `lizard==1.21.2`, updated CI to install that pinned version, and ignored `.tmp/` for local quality-tool bootstraps.
- Verification evidence: `npm run test:run -- tests/unit/services/maintenanceService.test.ts` passed `25` tests; `npm run build` in `server/` passed; `npm run lint:server` passed; `QUALITY_SKIP_COVERAGE=1 QUALITY_SKIP_AUDIT=1 QUALITY_SKIP_GITLEAKS=1 QUALITY_SKIP_LIZARD=1 QUALITY_SKIP_JSCPD=1 npm run quality` passed lint and typecheck through the gate.
- Quality-gate signal evidence: the coverage lane passed `388` files and `5505` tests with `100%` statements/branches/functions/lines; pinned `lizard 1.21.2` passed with `0` warnings, `28660` functions, `avg_ccn=1.35`, and `max_ccn=15`; the quality gate's gitleaks lane found no leaks in full-tree, latest-commit, and tracked-tree modes; `jscpd` reported `2.22%` duplicated lines (`5109/230256`, `263` clones, `1483` files); the audit lane passed the high-severity gate while surfacing existing low/moderate advisory debt.
- Follow-up: run a full uninterrupted `npm run quality` before release, classify oversized proof/generated files, reduce test warning/sleep noise, and triage the remaining low/moderate dependency advisories.
- Completed large-file classification in the project quality gate. `scripts/quality/check-large-files.mjs` now enforces `scripts/quality/large-file-classification.json`; all `>1000` line files are explicitly classified as proof harnesses, generated output, or test fixtures, and the gate keeps unclassified oversized production files from entering unnoticed.
- Reduced targeted test noise without lowering coverage. `tests/components/NotificationToast.test.tsx` now uses fake timers for delayed toast cleanup, and `tests/components/Layout/SidebarContent.branches.test.tsx` mocks the block-height indicator to avoid unrelated API retry noise in a sidebar branch test.
- Completed dependency advisory triage with safe lockfile updates. Root remains `16 low`, server remains `3 moderate` through the Prisma tooling chain, gateway remains `8 low` in full installs and `0` vulnerabilities with production optional dependencies omitted. `docs/DEPENDENCY_AUDIT_TRIAGE.md` records accepted-risk rationale and revisit triggers.
- Completed full Docker install/upgrade e2e proof with external runtime env paths. `tests/install/e2e/install-script.test.sh` passed `9` tests and `tests/install/e2e/upgrade-install.test.sh` passed `12` tests using `HTTPS_PORT=18443 HTTP_PORT=18080`.
- Added executable browser-auth contract drift checks in `scripts/check-browser-auth-contract.mjs` and wired them into `npm run quality` as `check:browser-auth-contract`. The check pins the browser cookie/CSRF/refresh contract, gateway mobile Bearer boundary, and server cookie-vs-body refresh precedence.
- Moved access-cache invalidation below the service layer into `server/src/infrastructure/accessCache.ts`, moved shared validation schemas into `server/src/validation/commonSchemas.ts`, and moved reusable health checks into `server/src/services/health/` so repositories and services no longer depend upward on API/service implementation modules.
- Added executable architecture dependency-boundary checks in `scripts/check-architecture-boundaries.mjs` and wired them into `npm run quality` as `check:architecture-boundaries`. The current run scans `1281` files and `5387` imports across `9` rules with `47` documented route-to-repository exceptions.
- Verification evidence: full `npm run quality` passed end to end after these changes. The integrated gate passed lint, typecheck, browser-auth contract, architecture-boundary, coverage (`388` files / `5505` tests / `100%` coverage), high-severity audits, all gitleaks modes, pinned lizard, jscpd (`2.22%`, `5126/230920`, `264` clones, `1487` files), and large-file classification.
- Added executable OpenAPI route coverage drift checks in `scripts/check-openapi-route-coverage.mjs` and wired them into `npm run quality` as `check:openapi-route-coverage`.
- Added `scripts/quality/openapi-route-coverage-exceptions.json` so intentionally undocumented non-JSON endpoints are explicit and fail if they go stale.
- Closed five real OpenAPI gaps found by the checker: gateway push lookup/delete/audit operations and draft create/delete operations.
- Verification evidence: `npm run check:openapi-route-coverage` passed with `288` Express routes, `284` OpenAPI operations, and `4` documented exceptions; the integrated quality wrapper with expensive lanes skipped also passed lint, typecheck, browser-auth contract, architecture boundaries, and OpenAPI route coverage.
- Extracted server background service lifecycle definitions from `server/src/index.ts` into `server/src/services/serverBackgroundServices.ts`, migrated token-revocation cleanup into `serviceRegistry`, and made `sync` explicitly depend on `worker-heartbeat` because sync startup reads worker health state.
- Added lifecycle wiring tests in `server/tests/unit/services/serverBackgroundServices.test.ts` and preserved registry/startup graph coverage in the existing service tests.
- Moved admin backup password re-authentication behind `server/src/services/adminCredentialService.ts`, removing one direct route-to-repository exception from the admin backup route.
- Extended `scripts/check-architecture-boundaries.mjs` with a `server-api-runtime-repositories` rule and `scripts/quality/architecture-boundary-exceptions.json`. The rule now fails new direct API route-to-repository imports, validates owner/removal metadata, and fails stale exceptions; the first baseline after adding the rule was `51` explicit exceptions.
- Patched `scripts/perf/phase3-compose-benchmark-smoke.mjs` to generate disposable SSL certificates in a temporary `SANCTUARY_SSL_DIR` before Compose starts, preserving the external runtime-secret model for the generated proof.
- Verification evidence: lifecycle tests passed (`31` tests across server background services, service registry, and startup manager); admin credential plus admin backup route tests passed (`20` tests); `npm --prefix server run build`, `npm run lint:server`, and `npm run check:architecture-boundaries` passed. The Phase 3 generated capacity proof passed in `docs/plans/phase3-compose-benchmark-smoke-2026-04-15T06-25-20-675Z.md` with benchmark output in `docs/plans/phase3-benchmark-2026-04-15T06-25-45-349Z.md`.
- Extracted admin settings persistence, defaulting, SMTP password redaction/encryption, transporter-cache clearing, and confirmation-threshold validation into `server/src/services/adminSettingsService.ts`; `server/src/api/admin/settings.ts` now owns HTTP request parsing, logging, audit, and response orchestration only.
- Removed the stale admin settings route-to-repository exception, reducing the explicit exception baseline from `51` to `50`.
- Added a first selected OpenAPI response-schema parity guard: the GET `/api/v1/admin/settings` route contract now asserts each runtime response key is documented by the `AdminSettings` OpenAPI schema.
- Verification evidence: `npm --prefix server run test:run -- tests/unit/services/adminSettingsService.test.ts` passed `3` service tests; `npx vitest run tests/unit/api/admin-routes.test.ts` in `server/` passed `59` admin route tests after elevation for Supertest local listener binding; `npm --prefix server run build`, `npm run lint:server`, and `npm run check:architecture-boundaries` passed with `1279` files, `5385` imports, `9` rules, and `50` documented route-to-repository exceptions; `QUALITY_SKIP_COVERAGE=1 QUALITY_SKIP_AUDIT=1 QUALITY_SKIP_GITLEAKS=1 QUALITY_SKIP_LIZARD=1 QUALITY_SKIP_JSCPD=1 npm run quality` passed lint, typecheck, browser-auth contract, architecture boundaries, OpenAPI route coverage, and large-file classification.
- Extracted admin monitoring URL override persistence, Grafana settings, and optional monitoring health checks into `server/src/services/adminMonitoringService.ts`; `server/src/api/admin/monitoring.ts` now owns HTTP validation, logging, and response orchestration only.
- Removed the stale admin monitoring route-to-repository exception, reducing the explicit exception baseline from `50` to `49`.
- Added a second selected OpenAPI response-schema parity guard: GET `/api/v1/admin/monitoring/services` route coverage now asserts the response and service item runtime keys are documented by `AdminMonitoringServicesResponse` and `AdminMonitoringService`.
- Tightened release-gate target-environment calibration evidence in `docs/RELEASE_GATES.md` so hardware/topology, replica counts, DB/Redis limits, input shape, strict-mode command, and pass/fail thresholds must be recorded before claiming target deployment capacity.
- Verification evidence: `npm --prefix server run test:run -- tests/unit/services/adminMonitoringService.test.ts` passed `4` service tests; `npx vitest run tests/unit/api/admin-monitoring-routes.test.ts` in `server/` passed `16` route tests after elevation for Supertest local listener binding; `npm --prefix server run build`, `npm run lint:server`, and `npm run check:architecture-boundaries` passed with `1280` files, `5386` imports, `9` rules, and `49` documented route-to-repository exceptions; `QUALITY_SKIP_COVERAGE=1 QUALITY_SKIP_AUDIT=1 QUALITY_SKIP_GITLEAKS=1 QUALITY_SKIP_LIZARD=1 QUALITY_SKIP_JSCPD=1 npm run quality` passed lint, typecheck, browser-auth contract, architecture boundaries, OpenAPI route coverage, and large-file classification.
- Extracted admin group persistence, member validation, membership mutation, and access-cache invalidation into `server/src/services/adminGroupService.ts`; `server/src/api/admin/groups.ts` now owns HTTP parsing, audit logging, and response orchestration only.
- Removed the stale admin groups route-to-repository exceptions, reducing the explicit exception baseline from `49` to `47`.
- Added another selected OpenAPI response-schema parity guard: GET `/api/v1/admin/groups` route coverage now asserts group and member runtime keys are documented by `AdminGroup` and `AdminGroupMember`.
- Verification evidence: `npm --prefix server run test:run -- tests/unit/services/adminGroupService.test.ts` passed `4` service tests; `npx vitest run tests/unit/api/admin-groups-routes.test.ts tests/unit/api/admin-routes.test.ts` in `server/` passed `86` route tests after elevation for Supertest local listener binding; `npm --prefix server run build`, `npm run lint:server`, and `npm run check:architecture-boundaries` passed with `1281` files, `5387` imports, `9` rules, and `47` documented route-to-repository exceptions; `QUALITY_SKIP_COVERAGE=1 QUALITY_SKIP_AUDIT=1 QUALITY_SKIP_GITLEAKS=1 QUALITY_SKIP_LIZARD=1 QUALITY_SKIP_JSCPD=1 npm run quality` passed lint, typecheck, browser-auth contract, architecture boundaries, OpenAPI route coverage, and large-file classification.
- Extracted wallet policy route persistence details into `server/src/services/vaultPolicy/vaultPolicyService.ts`; `server/src/api/wallets/policies.ts` no longer imports `policyRepository` or `walletRepository` directly and now owns only HTTP validation, audit logging, and response orchestration for policy events, policy listing, and address-list endpoints.
- Removed the stale wallet policy route-to-repository exceptions, reducing the explicit exception baseline from `47` to `45`.
- Added wallet policy OpenAPI response-envelope parity guards for policy events, evaluation, list/detail/create/update/delete, and address list/create/delete responses.
- Reduced test-suite noise by adding a jsdom canvas 2D context shim in `tests/setup.ts`, fixing the `PriceChart` Recharts mock so SVG definition nodes render under `<svg>`, and replacing the stale "internal push routes are undocumented" OpenAPI assertion with explicit gateway-HMAC push route contract checks.
- Refactored `scripts/check-openapi-route-coverage.mjs` so `collectOpenApiRoutes` stays below the lizard complexity threshold while preserving the same `288` Express routes, `284` OpenAPI operations, and `4` documented exceptions result.
- Refreshed dependency advisory evidence: root production audit still reports `14` low advisories, server production audit still reports `3` moderate advisories through Prisma tooling, and gateway production audit with optional dependencies omitted reports `0` vulnerabilities; no accepted-risk disposition changed.
- Re-checked the target-environment calibration boundary in `docs/RELEASE_GATES.md`: the repository-controlled generated Phase 3 proof remains current, but deployment-specific capacity claims still require a release record naming the exact topology, hardware, database, Redis, and replica inputs before they are treated as complete.
- Verification evidence: `npm --prefix server run test:run -- tests/unit/services/vaultPolicyService.test.ts` passed `56` service tests; `npx vitest run tests/unit/api/wallets-policies-routes.test.ts` in `server/` passed `55` route tests; `npx vitest run tests/unit/api/openapi.test.ts` in `server/` passed `42` OpenAPI tests; `npx vitest run tests/components/AnimatedBackground.test.tsx tests/components/AnimatedBackground.lazyLoading.test.tsx tests/components/Dashboard/PriceChart.test.tsx tests/components/qr/AnimatedQRCode.test.tsx` passed `89` frontend tests; `npm run check:architecture-boundaries` passed with `1281` files, `5386` imports, `9` rules, and `45` exceptions; full unskipped `npm run quality` passed with `388` coverage files, `5505` tests, `100%` coverage, `0` high-severity advisories, clean gitleaks scans, `0` lizard warnings, `2.21%` duplication, and passing large-file classification.
- Extracted admin Electrum server persistence, duplicate checks, priority reordering, pool reloads, and saved-server health updates into `server/src/services/adminElectrumServerService.ts`; `server/src/api/admin/electrumServers.ts` now owns HTTP validation, logging, and response orchestration without importing `nodeConfigRepository` directly.
- Removed the stale admin Electrum server route-to-repository exception, reducing the explicit exception baseline from `45` to `44`.
- Verification evidence: `npm --prefix server run test:run -- tests/unit/services/adminElectrumServerService.test.ts` passed `9` service tests; `npx vitest run tests/unit/api/electrumServers.test.ts` in `server/` passed `35` route tests; `npm --prefix server run build`, `npm run lint:server`, `npm run check:openapi-route-coverage`, and `npm run check:architecture-boundaries` passed with `1282` files, `5388` imports, `9` rules, and `44` documented route-to-repository exceptions. Full unskipped `npm run quality` also passed with `388` coverage files, `5505` tests, `100%` coverage, `0` high-severity advisories, clean gitleaks scans, `0` lizard warnings, `2.21%` duplication (`5128/232113`, `264` clones, `1494` files), and passing large-file classification.

## Phase 0: Restore Trust In The Baseline

Purpose: remove active correctness and security blockers so later architectural work can be measured against a stable baseline.

### 0.1 Fix Browser Auth Contract Failures

Status: Completed 2026-04-14.

Problem: At plan creation, API client cookie-auth, CSRF, refresh, and `401` handling behavior was failing tests. This was not just a test score problem; it meant the browser auth contract was ambiguous or regressed.

Architecture improvement:

- Extract the refresh decision rules into a small explicit policy module instead of letting behavior live implicitly across the API client, refresh helper, user context, and websocket usage.
- Model the policy as pure decisions where possible: exempt endpoints, refresh eligibility, original-error preservation, CSRF header injection, retry limits, and sign-out behavior.
- Keep transport and browser storage at the edges so the core policy can be tested without network mocking.

Objective exit criteria:

- Completed: `npm run test:run` passes.
- Completed: browser auth gate passes for `tests/api/client.test.ts`, `tests/api/refresh.test.ts`, `tests/services/websocket.test.ts`, and `tests/contexts/UserContext.test.tsx`.
- Completed: auth refresh behavior has focused pure-policy tests plus API client integration tests.
- Completed: `src/api/authPolicy.ts` is the documented owner for refresh eligibility and CSRF injection rules used by ApiClient, refresh, and direct backup fetches.

Secondary grade effect:

- Removes the correctness hard fail.
- Improves correctness, reliability, and test-quality evidence.

### 0.2 Remove Runtime Secrets From The Repo Checkout

Status: Completed on 2026-04-14.

Problem: ignored local files inside the repo contain secrets. Even when not tracked, this weakens local security posture and makes full-tree secret scans noisy.

Architecture improvement:

- Move developer/runtime secrets to an operator-owned path outside the repository, or to a clearly ignored runtime directory that is excluded from Docker contexts, support bundles, and archive workflows.
- Generate local TLS material outside `docker/nginx/ssl` unless a test specifically needs checked-in dummy fixtures.
- Keep only safe examples in the repository.

Objective exit criteria:

- Completed: full working-tree gitleaks scan is clean.
- Completed: tracked-tree and latest-commit gitleaks scans remain clean.
- Completed: `docs/RUNTIME_SECRETS.md` identifies the runtime secret location and rotation path.
- Completed for this scope: Docker build contexts exclude repo-local TLS PEMs, and support package collectors do not package raw repo files.
- Completed: `scripts/setup.sh` creates external runtime secrets by default and install e2e coverage reflects that contract.

Secondary grade effect:

- Removes the security hard fail.
- Makes future secret findings actionable instead of mixed with expected local runtime files.

## Phase 1: Make Auth And API Contracts Enforceable

Purpose: reduce drift across frontend client code, backend routes, gateway behavior, and OpenAPI documentation.

### 1.1 Create A Browser Auth State Machine

Problem: auth behavior currently depends on interactions among several modules. That makes regressions likely when a route, cookie behavior, or refresh endpoint changes.

Architecture improvement:

- Define browser auth as a state machine or decision table: anonymous, authenticated, refresh-in-flight, expired, denied, and forced sign-out.
- Centralize concurrency behavior for multiple simultaneous `401` responses.
- Define how download endpoints, JSON endpoints, CSRF-protected methods, and refresh endpoints participate in the policy.
- Document the state transitions in an ADR or architecture note.

Objective exit criteria:

- No duplicated refresh decision logic across API client, contexts, or websocket code.
- Tests cover concurrent `401` behavior, refresh failure, refresh success, exempt endpoints, and original error preservation.
- Auth-sensitive client behavior can be reviewed from one policy module and one integration test suite.

Secondary grade effect:

- Improves correctness and maintainability through a real boundary, not by adding superficial coverage.

### 1.2 Add Contract Drift Checks

Status: Completed for current API/OpenAPI route drift checks and selected response-key parity guards 2026-04-14.

Problem: API behavior, gateway rules, frontend expectations, validation schemas, and OpenAPI docs can drift independently.

Architecture improvement:

- Add a contract check that maps backend routes to OpenAPI paths and methods.
- Require request body routes to declare a validation schema or an explicit documented exception.
- Require gateway-exposed routes to be covered by gateway whitelist and proxy contract tests.
- Require auth-sensitive browser client methods to be covered by the auth policy tests.

Objective exit criteria:

- Existing `check:api-body-validation` remains green.
- Completed: OpenAPI route coverage check passes.
- Existing gateway proxy and whitelist tests remain part of the broader quality/test suite.
- Completed for browser auth: new or changed auth-sensitive browser client behavior now fails CI if it drifts from `src/api/authPolicy.ts`, cookie/CSRF transport, gateway mobile Bearer auth, or server refresh-token precedence.
- Completed: intentionally non-OpenAPI root endpoints must be listed in `scripts/quality/openapi-route-coverage-exceptions.json` with a concrete reason, and stale exceptions fail the check.
- Completed for selected response surfaces: GET `/api/v1/admin/settings`, GET `/api/v1/admin/monitoring/services`, and GET `/api/v1/admin/groups` fail route-contract tests if runtime response keys are not documented by their OpenAPI schemas.

Secondary grade effect:

- Improves functional completeness, security, maintainability, and regression detection.

## Phase 2: Strengthen Service Lifecycle Boundaries

Purpose: make startup, shutdown, dependency order, and health reporting deterministic.

### 2.1 Move Manual Services Into The Lifecycle Graph Only With Evidence

Status: Completed for token-revocation cleanup and server background service wiring 2026-04-14. Continue future migrations one service at a time with the same dependency-order proof.

Problem: some services are still manually wired. Moving them blindly can create startup-order regressions, so this should be incremental and test-driven.

Architecture improvement:

- Pick one manually wired service at a time.
- Before moving it, write tests or assertions that pin dependency order, startup timing, shutdown behavior, and health reporting.
- Register it through the existing lifecycle graph only after those expectations are executable.
- Keep provider/export/notification/script registries separate unless their semantics genuinely match the shared registry abstraction.

Objective exit criteria:

- Completed for the current migration: token-revocation cleanup is registered through `serviceRegistry`.
- Completed for the current migration: `sync` declares its `worker-heartbeat` dependency, and startup/shutdown ordering remains covered by service lifecycle tests.
- Completed for the current migration: `server/tests/unit/services/serverBackgroundServices.test.ts`, `serviceRegistry.test.ts`, and `startupManager.test.ts` passed.
- Future manual-service migrations remain follow-up work only when dependency and health-output expectations are executable first.

Secondary grade effect:

- Improves reliability and maintainability with lower operational risk.

### 2.2 Enforce Repository And Service Boundaries

Status: Completed for current dependency-boundary guard and route-to-repository cleanup slices 2026-04-14. Further exception burn-down remains follow-up architecture work.

Problem: architecture boundaries decay when imports are enforced only by review.

Architecture improvement:

- Add dependency-boundary checks for route, service, repository, worker, and gateway layers.
- Keep a narrow allowlist for existing exceptions, with each exception tied to an owner and removal condition.
- Prefer existing local checks before introducing a new framework.

Objective exit criteria:

- Completed: `npm run check:architecture-boundaries` fails on repository runtime imports from service/API/worker/job/websocket layers.
- Completed: `npm run check:architecture-boundaries` fails when services import API route modules at runtime.
- Completed: `npm run check:architecture-boundaries` fails when browser runtime imports server or gateway internals, when gateway runtime imports server/browser internals, when frontend API adapters import UI state at runtime, and when shared modules import app-specific runtime layers.
- Completed for non-route-to-repository rules: no allowlist is required after moving access cache, common schemas, and health checks to lower-level modules.
- Completed: `npm run check:architecture-boundaries` fails on new direct API route-to-repository runtime imports unless a documented exception with owner and removal condition exists.
- Completed: stale route-to-repository exceptions fail the boundary check; current baseline is `44` exceptions after moving admin backup credential lookup, admin settings persistence, admin monitoring persistence, admin group persistence, wallet policy persistence, and admin Electrum server persistence behind services.

Secondary grade effect:

- Improves maintainability by making architecture review mechanical.

## Phase 3: Improve Operational Configuration And Secret Handling

Purpose: separate source-controlled configuration from runtime state so development, Docker, CI, and production have the same security model.

### 3.1 Define Runtime Configuration Ownership

Problem: runtime files currently can live inside the checkout, which makes scans noisy and increases accidental exposure risk.

Architecture improvement:

- Define a runtime directory contract for local development, Docker Compose, and production.
- Keep checked-in files limited to schemas, examples, and safe defaults.
- Validate required environment variables at startup with clear errors.
- Ensure Docker build contexts cannot include runtime secret material.

Objective exit criteria:

- Full-tree secret scan is clean after normal local setup.
- Fresh setup writes runtime env and TLS material outside the repository checkout by default.
- Docker context audit proves secret paths are excluded.
- Startup config validation tests cover missing, malformed, and unsafe defaults.
- Documentation identifies which process owns each secret.

Secondary grade effect:

- Improves security and operational readiness evidence.

## Phase 4: Make Quality Evidence Reproducible

Purpose: measure important qualities without relying on ad hoc local commands.

### 4.1 Add A Project Quality Gate

Status: Completed 2026-04-14.

Problem: coverage was measurable through `npm run test:coverage`, but it was not wrapped into one project-owned quality command. Complexity was also unknown because `lizard` was not installed or pinned, so the repo could not track whether architecture changes were simplifying or complicating the system.

Architecture improvement:

- Add a single project-owned quality command that runs lint, typecheck, tests, coverage, duplication, complexity, audit, and secret checks.
- Prefer wrappers around existing scripts rather than a new quality framework.
- Store generated reports in ignored output paths and summarize stable metrics in docs or CI artifacts.

Objective exit criteria:

- One command produces the quality evidence needed for a grade run.
- Coverage is measured through the existing `test:coverage` script.
- Complexity is measured with a pinned or documented tool invocation.
- Secret scans include both tracked-tree and full-working-tree modes, with clear local setup expectations.

Secondary grade effect:

- Increases confidence and removes unknown-score areas without changing code solely for measurement.

### 4.2 Track Architecture Health Metrics

Status: Completed for current metrics 2026-04-14. Lifecycle graph coverage metrics remain tied to Phase 2.1 work.

Problem: raw line counts, duplication, and coverage do not prove architecture quality by themselves.

Architecture improvement:

- Track boundary violations, route-contract drift, lifecycle graph coverage, auth-policy coverage, and runtime-secret scan status.
- Add trend history for these architecture-specific metrics.
- Treat score changes as lagging indicators after these metrics improve.

Objective exit criteria:

- Completed: architecture-health metrics are visible through `npm run quality`: browser-auth contract scan count, architecture-boundary scan/import/rule/exception counts, route-to-repository exception baseline, large-file classification, high-severity audits, secret scans, complexity, duplication, coverage, lint, and typecheck.
- Completed: new browser-auth and dependency-boundary violations fail fast.
- Completed for current non-route-to-repository rules: no existing exception allowlist is needed; route-to-repository exceptions are explicit, owned, and stale-checked.

Secondary grade effect:

- Improves confidence and maintainability scoring through direct architectural evidence.

## Phase 5: Reduce Complexity Where It Affects Change Safety

Purpose: split large or complex code only where doing so improves ownership, testability, or failure isolation.

### 5.1 Split Production Entry Points By Responsibility

Status: Completed for the clear server entrypoint lifecycle split 2026-04-14. Broader size reductions remain deferred unless a responsibility boundary is already clear.

Problem: large entry points increase review cost and hide unrelated responsibilities.

Architecture improvement:

- Prioritize production code over scripts when reducing file size.
- Split large entry points into route registration, health, provider management, model operations, callbacks, and request execution only where those responsibilities already exist conceptually.
- Preserve public behavior with characterization tests before moving code.

Objective exit criteria:

- Completed for the current clear split: background service definitions moved from `server/src/index.ts` into `server/src/services/serverBackgroundServices.ts`.
- Completed for the current clear split: lifecycle wiring has focused unit tests and the server build/lint passed.
- Deferred: broad size reduction of unrelated large production files remains out of scope until a clean responsibility boundary exists.

Secondary grade effect:

- Improves maintainability and reviewability. It may also improve complexity signals once those are measured.

### 5.2 Keep Proof Harnesses Stable

Problem: performance and release proof scripts can be large because they encode scenario evidence. Splitting them for score alone would make the codebase worse.

Architecture improvement:

- Only split proof harnesses when reusable setup, assertions, or reporting logic can be extracted without hiding the scenario.
- Keep the scenario orchestration readable end to end.

Objective exit criteria:

- Performance proof output remains byte-for-byte or semantically equivalent.
- Extracted helpers have focused tests where practical.
- Release gate documentation still maps directly to the proof command.

Secondary grade effect:

- Avoids score-chasing refactors that reduce clarity.

## Phase 6: Use Performance Work To Drive Architecture, Not The Other Way Around

Purpose: change data flow, caching, queues, or persistence only when evidence shows a real bottleneck or failure mode.

### 6.1 Complete Remaining Reliability And Scale Proofs

Status: Completed for repository-controlled generated Phase 3 proof 2026-04-14/2026-04-15 UTC. Target-environment calibration remains required when topology or hardware differs.

Problem: the reliability-plan checks needed current generated evidence for wallet sync/fanout behavior, large wallet datasets, job queue processing, worker scale-out, backend scale-out, and capacity snapshots.

Architecture improvement:

- Run the 10-concurrent-wallet sync and notification burst proof.
- Run large dataset tests with at least 10k transactions per wallet.
- Verify job queue health endpoints expose the metrics needed for operators.
- Change architecture only where these proofs expose limits.

Objective exit criteria:

- Completed: `npm run perf:phase3:compose-smoke` passed with the documented stronger generated profile: `25,000` synthetic transactions, `100` authenticated history requests at concurrency `10`, p95 `70ms`, p99 `77.17ms`, `16.3 MiB` generated restore, worker queue proof, two-worker scale-out, `100/100` WebSocket fanout across two backend replicas, and Postgres/Redis capacity snapshots.
- Completed: the proof writes Markdown and JSON evidence under `docs/plans/` and links from the quality report, release gates, and scalability baseline.
- Completed: the wrapper now provisions disposable TLS material outside the repo checkout before Compose health checks, so the proof matches the runtime-secret architecture.
- Remaining: target-environment calibration is release-specific and required only when hardware, load balancer, Postgres, Redis, worker sizing, or supported backup size differs from this local generated proof.

Secondary grade effect:

- Improves reliability and performance evidence when changes are justified by runtime data.

## Priority Order

- [x] 1. Fix browser auth contract failures through an explicit auth policy boundary. Completed 2026-04-14.
- [x] 2. Remove local runtime secrets from the repository checkout and make full-tree secret scans clean. Completed for current checkouts and fresh installs on 2026-04-14.
- [x] 3. Harden maintenance disk monitoring system calls. Completed 2026-04-14.
- [x] 4. Add a project-owned quality gate that measures coverage, complexity, duplication, audit, tests, and secrets. Completed 2026-04-14.
- [x] 5. Add browser-auth/gateway/server refresh contract drift checks. Completed 2026-04-14.
- [x] 6. Classify oversized proof/generated files in the quality gate. Completed 2026-04-14.
- [x] 7. Reduce targeted test noise and time-based toast cleanup. Completed first pass 2026-04-14; jsdom canvas and stale OpenAPI push assertion noise also reduced 2026-04-14.
- [x] 8. Triage low/moderate dependency advisory debt. Completed 2026-04-14 and refreshed after the latest full quality run; accepted-risk disposition unchanged.
- [x] 9. Run full `npm run quality` and full Docker install/upgrade e2e proof. Completed 2026-04-14; latest unskipped `npm run quality` passed after the wallet policy cleanup slice.
- [x] 10. Add dependency-boundary checks for repository, service, API, worker, gateway, browser, frontend API, and shared layers. Completed 2026-04-14.
- [x] 11. Add OpenAPI route coverage drift checks to complete Phase 1.2. Completed 2026-04-14.
- [x] 12. Incrementally migrate manual services into the lifecycle graph with dependency-order tests. Completed for token-revocation cleanup and server background service wiring 2026-04-14.
- [x] 13. Continue route/service/repository boundary cleanup beyond the current import guard, especially direct route-to-repository and API-to-infrastructure/websocket coupling where service facades are clearer. Completed for the enforceable route-to-repository guard and wallet/admin cleanup slices with eight exception removals 2026-04-14.
- [x] 14. Split large production entry points only where responsibility boundaries are already clear. Completed for server background lifecycle wiring 2026-04-14.
- [x] 15. Complete remaining reliability and scale proofs before making performance architecture changes. Completed for repository-controlled generated Phase 3 proof 2026-04-14/2026-04-15 UTC.
- [x] 16. Add selected response-schema parity guards after OpenAPI route coverage. Completed for admin settings, monitoring, group, and wallet policy response envelopes 2026-04-14.
- [x] 17. Define the target-environment capacity calibration evidence contract. Completed in `docs/RELEASE_GATES.md` 2026-04-14; actual calibration remains target-topology evidence, not local repo evidence.

## Work To Avoid

- Do not refactor only to raise the score.
- Do not add allowlist suppressions for real secret findings.
- Do not split proof harnesses if the scenario becomes harder to audit.
- Do not merge registries that have different semantics just to reduce abstraction count.
- Do not move lifecycle-managed services without startup and shutdown evidence.
- Do not chase coverage before the failing correctness tests are fixed.
- Do not start a broad framework rewrite unless a specific boundary cannot be enforced within the current architecture.

## Verification Matrix

Baseline gates:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm audit --json`
- Tracked-tree gitleaks scan
- Full-working-tree gitleaks scan
- Duplication scan
- Coverage run
- Complexity scan

Architecture gates:

- Browser auth policy tests
- Browser auth contract check
- API client integration tests
- OpenAPI route coverage check
- Gateway whitelist and proxy contract tests
- Request body validation check
- Dependency-boundary check
- Lifecycle startup and shutdown tests
- Job queue health endpoint tests

Runtime evidence:

- Concurrent wallet sync proof
- Notification burst proof
- Large-wallet dataset proof
- Phase 3 performance smoke or target-environment calibration when deployment topology changes

## Success Definition

This plan succeeds when the system has fewer implicit contracts, fewer manual architecture conventions, cleaner runtime boundaries, and more repeatable evidence. A better grade should follow from those facts, but the grade is only a reporting mechanism for the underlying engineering outcome.
