# Software Quality Report

Date: 2026-05-08
Owner: TBD
Status: In remediation; last updated 2026-05-09

**Overall Score**: 76/100 (original scrub score; not yet rescored after remediation slices)
**Grade**: C (original scrub grade)
**Confidence**: High
**Mode**: full deep bug scrub
**Commit**: ec073c64 (working tree dirty)

This score is risk-adjusted from a codebase and feature bug scrub. The mechanical engineering signals are still unusually strong, but this pass found multiple high-impact correctness, security, and operational invariants that are either unenforced or tested in the wrong direction.

---

## Hard-Fail Blockers

Original hard-fail blockers from the scrub are now addressed in the P1-06/P2-01 remediation slice:

1. `npm run check:semgrep-baseline` passes after fixing release workflow shell-injection patterns and replacing two remaining reported paths with dated, owned exceptions.
2. Package-level moderate production audits pass:
   - `npm --prefix server audit --omit=dev --audit-level=moderate` reports `0` vulnerabilities after overriding `hono` to `4.12.18`.
   - `npm --prefix ai-proxy audit --omit=dev --audit-level=moderate` reports `0` vulnerabilities after updating `express-rate-limit` to `8.5.1` and `ip-address` to `10.2.0`.

The root production audit still exits 0 at the moderate threshold and reports only accepted low-severity Trezor `elliptic` advisories with no safe upstream fix.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 14/20 | Core tests pass, but raw broadcast policy, wrong-network sends, Payjoin production parsing, backup restore behavior, and hardware-wallet proof gaps leave real user-facing risk. |
| Reliability | 10/15 | Good logging, retries, and request guards exist, but restore can continue after delete failures, request timeout does not cancel in-flight handlers, group access cache can go stale, and unhandled rejections do not fail services closed. |
| Maintainability | 15/15 | Lizard has 0 warnings, duplication is 1.68%, large-file guard is clean for unclassified production/test files, and code organization is generally disciplined. |
| Security | 8/15 | Session revocation, email verification, gateway TLS defaults, release workflow interpolation, default deployment secrets, and raw broadcast policy enforcement need hardening. |
| Performance | 9/10 | No major hot-path performance bug surfaced; blocking-I/O guard passes. |
| Test Quality | 12/15 | Coverage is excellent, but several important tests assert implementation details or unsafe legacy behavior instead of end-to-end security/business invariants. |
| Operational Readiness | 8/10 | Docker, Compose, CI, health checks, and observability are present, but fail-closed deployment policy and package-level audit/coverage thresholds are incomplete. |
| **TOTAL** | **76/100** | |

These domain scores are the original scrub scores; per-finding statuses below record remediated slices until the report is formally rescored.

---

## Trend

- vs previous report at `1a1786dc`: `98/A -> 76/C`.
- This is mostly a deeper-inspection correction, not a collapse in mechanical quality. The prior report over-weighted passing coverage/lint/typecheck and under-weighted feature-level security and correctness invariants.

---

## Evidence

### Mechanical Signals

| Signal | Result |
| --- | --- |
| Grade workflow | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed. |
| Tests and coverage | `npm run coverage` passed; frontend, server, and gateway reported 100% statements/branches/functions/lines in the grade run. |
| Lint | `npm run lint` passed in the grade run, including API body validation, Bitcoin network-boundary guard, gateway lint, and blocking-I/O guard. |
| Typecheck | App, frontend tests, and server tests passed in the grade run. |
| Secrets | Tracked-tree gitleaks passed with 0 findings in the grade run. |
| High/critical audit | Root `npm audit --audit-level=high` passed with 0 high/critical advisories in the grade run. |
| Moderate package audit | Server and AI proxy package-level production audits now pass at the moderate threshold. |
| Semgrep baseline | `npm run check:semgrep-baseline` now passes with all current findings covered by fixed code or reviewed baseline entries. |
| Complexity | Lizard reported 0 warnings, average CCN 1.4. |
| Duplication | `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` passed with 1.68% duplicated lines. |
| File size | `node scripts/quality/check-large-files.mjs` passed; only `scripts/perf/phase3-benchmark.mjs` remains as a classified proof harness at 949 LOC. |

### P1 Findings

1. **Raw transaction broadcast can bypass policy with self-reported or missing intent.**
   - Status: fixed in PR #341 (`4ff18340`) by decoding raw transactions server-side and evaluating policy/persistence from canonical derived intent.
   - Evidence: broadcast policy returns early when `recipient` or `amount` is absent in `server/src/api/transactions/broadcasting.ts`; raw-hex broadcasts rely on caller metadata instead of decoding canonical outputs before policy and audit.
   - Impact: a permitted broadcaster can submit signed raw hex whose actual outputs differ from policy metadata, or omit metadata and skip policy evaluation before irreversible network broadcast.
   - Fix direction: decode raw transactions server-side before broadcast, derive canonical recipient/amount/fee/inputs, evaluate policy from decoded data, persist from decoded data, and reject ambiguous payloads.

2. **Existing access JWTs survive logout-all, revocation, role changes, and deletion until expiry.**
   - Status: fixed in PR #342 (`b9aed6ab`) by adding per-user `sessionVersion` claims and checking current database user state in HTTP/WebSocket auth and refresh flows.
   - Evidence: `/auth/logout-all` calls `revokeAllUserTokens`, but `server/src/services/tokenRevocation.ts` delegates to `sessionRepository.revokeAllUserTokens`, which deletes refresh-token rows only. `requireAdmin` trusts the `isAdmin` claim already embedded in the access token.
   - Impact: demoted, deleted, or logged-out users can keep using already-issued access tokens until expiry; a demoted admin token can still satisfy `requireAdmin`.
   - Fix direction: add a user token-version/session-version or revocation watermark checked by `authenticate`, and force it to advance on password change/reset, logout-all, role change, user disable/delete, and security events.

3. **Registration issues a live session even when email verification is required.**
   - Status: fixed in the P1-03 slice by returning pending-verification registration responses without auth cookies, blocking unverified legacy access/refresh sessions while verification is required, and keeping `/auth/email/verify` public in the real route order.
   - Evidence: registration creates `emailVerified: false`, computes `emailVerificationRequired`, then still generates access/refresh tokens and sets auth cookies. Later login correctly blocks the same unverified user.
   - Impact: email verification is bypassable for the first registration session and refresh chain.
   - Fix direction: when verification is required, return a pending-verification response without access/refresh cookies, or issue a deliberately limited unverified session that every protected route blocks.

4. **Normal send address validation accepts wrong-network addresses.**
   - Status: fixed in PR #345 (`1297f538`) by making send output validation network-aware across manual, BIP21, QR/update helper, step-gating, and transaction-creation paths.
   - Evidence: `components/send/steps/OutputsStep/OutputsStep.tsx` uses format-only `validateAddress(output.address)` for normal outputs, while network-aware validation exists separately in `utils/validateAddress.ts`.
   - Impact: users can proceed with a mainnet address in a testnet/signet wallet, or vice versa, until later failure. For a wallet send flow, that is too late.
   - Fix direction: pass wallet network into output validation and gate step progression on network-aware validation for all normal sends, BIP21, Payjoin, and QR paths.

5. **Payjoin receiver requests are rejected in production for real BIP78 clients.**
   - Status: fixed in the P1-08 slice by mounting a route-local `text/plain` parser on the BIP78 receiver, replacing the masking test parser with an app-like JSON/urlencoded stack, rejecting wrong/missing/empty/oversized bodies as plain-text BIP78 errors, and documenting the unsigned receiver proposal boundary.
   - Evidence: production mounts JSON and URL-encoded parsers only, while `server/src/api/payjoin.ts` expects raw text PSBT bodies. Unit tests mask this by adding `express.text({ type: 'text/plain' })` in the test app.
   - Impact: real `text/plain` BIP78 receiver requests can arrive with an undefined body and be rejected as `original-psbt-rejected`.
   - Fix direction: mount route-local `express.text({ type: 'text/plain', limit: ... })` before the Payjoin receiver route and add a production-shaped parser test. Also keep the receiver clearly marked incomplete until input signing is implemented.

6. **Backup restore can destroy data from partial backups and continue after delete failures.**
   - Status: fixed in PR #346 (`8a8cf04c`) by adding strict destructive-restore validation and making core-table delete failures abort the restore transaction.
   - Evidence: missing required tables are warnings, not validation failures, and restore deletes existing tables before inserting backup tables. Delete failures are logged and swallowed.
   - Impact: a partial backup can wipe present data and restore an incomplete dataset; failed deletes can leave stale rows behind while the API reports success.
   - Fix direction: make missing core tables fatal for destructive restore unless an explicit partial-restore mode is requested, and abort the transaction on delete failures.

7. **Release workflow Semgrep findings are currently red.**
   - Status: fixed in the P1-06 slice by moving release workflow expressions into environment variables, validating tags/versions/run IDs, quoting shell variables and API paths, and refreshing the baseline after fixes/exceptions.
   - Evidence: `npm run check:semgrep-baseline` reports unbaselined `yaml.github-actions.security.run-shell-injection` findings in release workflows.
   - Impact: workflow inputs/tags are interpolated into shell in jobs that later use privileged GitHub APIs.
   - Fix direction: pass GitHub expression values through environment variables, quote shell variables, validate tags/version inputs, and refresh the baseline only after fixes or explicit review.

8. **Mobile gateway can run cleartext HTTP in production by default.**
   - Status: fixed in the deployment hardening slice by making production HTTP a startup error unless `GATEWAY_ALLOW_INSECURE_PRODUCTION_HTTP=true` is set, and by defaulting Compose gateway TLS on.
   - Evidence: `docker-compose.yml` defaults `GATEWAY_TLS_ENABLED` to `false` while exposing gateway port `4000`; gateway config warns but still starts.
   - Impact: bearer tokens and mobile API traffic can be exposed if the default gateway port is deployed outside a trusted network.
   - Fix direction: fail closed when `NODE_ENV=production` and TLS is disabled unless an explicit internal-only override is set.

### P2 Findings

1. **Client download/upload/blob helpers do not refresh expired sessions on 401.**
   - Status: fixed in the transfer helper session-refresh slice by moving JSON, blob, download, upload, and admin backup blob calls onto a shared one-shot refresh/replay path with replayable-body guards.
   - Normal JSON requests refresh and retry; transfer helpers do direct fetches and fail Unauthorized.

2. **Send page loads mainnet mempool data for non-mainnet wallets.**
   - Status: fixed in PR #345 (`1297f538`) by passing the selected wallet network into send-page mempool loading and preserving intentional mainnet defaults for other callers.
   - `bitcoinApi.getMempoolData()` is called without wallet network while fee estimates correctly pass `apiWallet.network`.

3. **Bulk admin group membership updates leave wallet-access cache stale.**
   - Status: fixed in the bulk group cache-invalidation slice by returning the validated add/remove diff from `groupRepository.setMembers()` and invalidating user access caches for actually added and removed users after successful bulk replacement.
   - Dedicated add/remove paths already invalidated access cache; bulk `memberIds` replacement now matches that behavior. Role changes are not part of the bulk `memberIds` API.

4. **Request timeout does not abort in-flight route work.**
   - Status: partially fixed in the request-timeout cancellation slice by adding a request-scoped `AbortSignal` that aborts on middleware timeout or client disconnect, and by propagating it into read-only mempool HTTP calls. Destructive/non-cancellable backup, restore, sync, and broadcast workflows remain documented boundaries until they can move to explicit job/idempotency semantics.
   - The middleware sends 408 after the timeout, but async handlers can keep mutating state after the client sees a timeout.

5. **Service unhandled-rejection handlers log and keep running.**
   - Status: fixed in the unhandled-rejection shutdown slice by routing server, worker, MCP, gateway, and AI proxy `unhandledRejection`/`uncaughtException` events through fatal logging plus each entrypoint's bounded graceful shutdown path with exit code 1. Runtime restart remains the supervisor/container orchestrator's responsibility.
   - Server, gateway, and AI proxy entrypoints log unhandled promise rejections without exiting, which can leave degraded services marked healthy.

6. **GHCR compose defaults include predictable database credentials and unauthenticated Redis.**
   - Status: fixed in the deployment hardening slice by requiring explicit Postgres and Redis passwords, requiring a production encryption salt, wiring authenticated Redis URLs, and adding Redis auth health checks.
   - The prebuilt-image compose path can be launched with `sanctuary` defaults and open internal Redis.

7. **AI proxy tests are not covered by the root coverage gate, and CI allows no tests.**
   - Status: fixed in the AI proxy coverage-gate slice by adding package-local `test`/`test:coverage` scripts, a dedicated `ai-proxy/vitest.config.ts` coverage gate over `ai-proxy/src/**`, CI commands without `--passWithNoTests`, and full-lane coverage artifact/summary reporting.
   - Added route/runtime tests for sanitized config responses, provider detection/model management, endpoint-policy runtime helpers, and Ollama model-pull streaming/error progress. The initial enforced baseline is 78% statements, 69% branches, 90% functions, and 81% lines.
   - Original issue: root coverage excluded `ai-proxy/src/**`, and CI used `--passWithNoTests` for AI proxy test jobs.

8. **Physical hardware-in-loop signing proof remains incomplete.**
   - The prior fixture matrix still needs 11 required Ledger/Trezor/BitBox signed fixture rows; normal tests pass without requiring those artifacts.

### P3 Findings

1. Capability-gated Intelligence nav is hidden, but direct `#/intelligence` route access is not route-gated.
   - Status: fixed in the frontend route-gate slice by moving `requiredCapabilities` onto route metadata, gating direct route rendering for loading/unavailable/available capability states, and adding direct hash-route tests.
2. Logged-in users with missing/null preferences cannot persist preference changes.
   - Status: fixed in the null-preferences slice by treating authenticated null/missing preferences as an empty server-backed preference record, preserving existing/unknown keys during optimistic merges, and keeping localStorage fallback limited to anonymous users.
3. Authenticated refresh can briefly render the login screen during auth bootstrap.
   - Status: fixed in the frontend route-gate slice by rendering a neutral authenticated-route bootstrap skeleton while `/auth/me` is still loading, then rendering login only after unauthenticated resolution.
4. Frontend Dockerfile creates a non-root user but does not switch to it.
   - Status: fixed in the deployment hardening slice by switching the runtime image to UID `1001`, moving nginx to high internal ports, and making SSL startup fail clearly when mounted certificates are missing or unreadable.
5. `ENCRYPTION_SALT` has a static deployment default.
   - Status: fixed in the deployment hardening slice by rejecting missing/default production salts in server config and making setup refuse legacy default salt states instead of writing an unusable env file.
6. Some comments still describe old cookie-auth/CSRF phase behavior and should be refreshed when those files are next touched.

---

## What The Codebase Does Well

- Mechanical quality is strong: tests, coverage, lint, typecheck, lizard, duplication, large-file checks, gitleaks, API body validation, Bitcoin network-boundary checks, and blocking-I/O checks are all present.
- Complexity discipline is excellent: lizard reports 0 warnings and the average CCN is low.
- Architecture is generally clean: backend API/service/repository boundaries are clear, frontend components/hooks/helpers are separated, and gateway validation is explicit.
- Validation and security middleware are broad: Zod schemas, CSRF/cookie auth, rate limits, request timeouts, auth contracts, and route-level guards are consistently visible.
- Observability is mature for the project size: structured logging, health/readiness endpoints, metrics/tracing hooks, Docker/Compose, and monitoring stack artifacts are present.
- The test suite is large and behavior-oriented in many areas, especially auth flows, admin operations, transaction broadcasting, gateway validation, and frontend API client behavior.

## What Is Lacking

- Security state transitions need end-to-end invariants: access-token revocation, role changes, email verification, account deletion, and cache invalidation are not consistently proven.
- Transaction broadcast needs server-canonical validation. Policy/audit/persistence should derive from decoded signed payloads, not caller-supplied metadata.
- Frontend network context is still inconsistently threaded through send surfaces.
- Production deployment defaults warn too often and fail closed too rarely.
- CI policy thresholds are improving: Semgrep and package-level moderate production audits are now clean, and AI proxy tests now have a package-local coverage/existence gate. Remaining AI proxy coverage gaps should be raised from the new baseline as insight/label-query/backend-context routes get direct behavioral tests.
- Some tests encode current unsafe behavior instead of desired product/security invariants, especially backup restore and missing transaction metadata paths.
- Hardware-wallet correctness still depends on physical artifacts that are not committed.

---

## Fastest Improvements

Detailed remediation plan: `docs/plans/deep-bug-scrub-remediation-plan.md`

1. Fix raw transaction broadcast canonical validation and add tests for mismatched/missing metadata.
2. Add token-version or revocation-watermark enforcement in `authenticate`, then cover logout-all, role demotion, password reset, user deletion, and refresh chains.
3. Stop issuing full auth cookies on registration when email verification is required.
4. Make send output validation network-aware for all output paths.
5. Fix Payjoin text parsing with production-shaped tests.
6. Clean Semgrep release workflow findings and enforce a fresh baseline.
7. Fail production gateway startup unless TLS is enabled or an explicit internal-only override is set.
8. Harden backup restore validation and transactional delete behavior.

## Verification Notes

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - completed.
- `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` - passed, 1.68% duplication.
- `node scripts/quality/check-large-files.mjs` - passed.
- `npm run check:semgrep-baseline` - now passes with 10 current findings covered by baseline entries and no new/stale entries.
- `npm audit --omit=dev --audit-level=moderate` - root scan exits 0 with accepted low root advisories only.
- `npm --prefix server audit --omit=dev --audit-level=moderate` - now reports `0` vulnerabilities after the Hono override refresh.
- `npm --prefix ai-proxy audit --omit=dev --audit-level=moderate` - now reports `0` vulnerabilities after the `express-rate-limit` / `ip-address` refresh.
- `npm --prefix ai-proxy run test:coverage -- --pool threads --maxWorkers=1 --no-file-parallelism` - now measures `ai-proxy/src/**` with a package-local baseline gate and fails if no AI proxy tests are discovered.

This report started as a scrub-only artifact; subsequent remediation slices now update status lines as fixes land.
