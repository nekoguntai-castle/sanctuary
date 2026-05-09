# Software Quality Report

Date: 2026-05-08
Owner: TBD
Status: Draft

**Overall Score**: 76/100
**Grade**: C
**Confidence**: High
**Mode**: full deep bug scrub
**Commit**: ec073c64 (working tree dirty)

This score is risk-adjusted from a codebase and feature bug scrub. The mechanical engineering signals are still unusually strong, but this pass found multiple high-impact correctness, security, and operational invariants that are either unenforced or tested in the wrong direction.

---

## Hard-Fail Blockers

1. `npm run check:semgrep-baseline` fails with 8 unbaselined findings and 7 stale baseline entries. The actionable findings include GitHub Actions shell-injection patterns in release workflows, an insecure WebSocket finding in `docker-compose.yml`, and a child-process finding in the address verification script.
2. Moderate dependency audit fails in package-level scans:
   - `npm --prefix server audit --omit=dev --audit-level=moderate` fails on `hono` advisories pulled through server tooling.
   - `npm --prefix ai-proxy audit --omit=dev --audit-level=moderate` fails on `express-rate-limit -> ip-address`.

The current high/critical policy still passes, but the moderate findings are active and CI policy currently lets them through.

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
| Moderate package audit | Server and AI proxy package-level moderate audits fail. |
| Semgrep baseline | `npm run check:semgrep-baseline` fails with new and stale findings. |
| Complexity | Lizard reported 0 warnings, average CCN 1.4. |
| Duplication | `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` passed with 1.68% duplicated lines. |
| File size | `node scripts/quality/check-large-files.mjs` passed; only `scripts/perf/phase3-benchmark.mjs` remains as a classified proof harness at 949 LOC. |

### P1 Findings

1. **Raw transaction broadcast can bypass policy with self-reported or missing intent.**
   - Evidence: broadcast policy returns early when `recipient` or `amount` is absent in `server/src/api/transactions/broadcasting.ts`; raw-hex broadcasts rely on caller metadata instead of decoding canonical outputs before policy and audit.
   - Impact: a permitted broadcaster can submit signed raw hex whose actual outputs differ from policy metadata, or omit metadata and skip policy evaluation before irreversible network broadcast.
   - Fix direction: decode raw transactions server-side before broadcast, derive canonical recipient/amount/fee/inputs, evaluate policy from decoded data, persist from decoded data, and reject ambiguous payloads.

2. **Existing access JWTs survive logout-all, revocation, role changes, and deletion until expiry.**
   - Evidence: `/auth/logout-all` calls `revokeAllUserTokens`, but `server/src/services/tokenRevocation.ts` delegates to `sessionRepository.revokeAllUserTokens`, which deletes refresh-token rows only. `requireAdmin` trusts the `isAdmin` claim already embedded in the access token.
   - Impact: demoted, deleted, or logged-out users can keep using already-issued access tokens until expiry; a demoted admin token can still satisfy `requireAdmin`.
   - Fix direction: add a user token-version/session-version or revocation watermark checked by `authenticate`, and force it to advance on password change/reset, logout-all, role change, user disable/delete, and security events.

3. **Registration issues a live session even when email verification is required.**
   - Evidence: registration creates `emailVerified: false`, computes `emailVerificationRequired`, then still generates access/refresh tokens and sets auth cookies. Later login correctly blocks the same unverified user.
   - Impact: email verification is bypassable for the first registration session and refresh chain.
   - Fix direction: when verification is required, return a pending-verification response without access/refresh cookies, or issue a deliberately limited unverified session that every protected route blocks.

4. **Normal send address validation accepts wrong-network addresses.**
   - Evidence: `components/send/steps/OutputsStep/OutputsStep.tsx` uses format-only `validateAddress(output.address)` for normal outputs, while network-aware validation exists separately in `utils/validateAddress.ts`.
   - Impact: users can proceed with a mainnet address in a testnet/signet wallet, or vice versa, until later failure. For a wallet send flow, that is too late.
   - Fix direction: pass wallet network into output validation and gate step progression on network-aware validation for all normal sends, BIP21, Payjoin, and QR paths.

5. **Payjoin receiver requests are rejected in production for real BIP78 clients.**
   - Evidence: production mounts JSON and URL-encoded parsers only, while `server/src/api/payjoin.ts` expects raw text PSBT bodies. Unit tests mask this by adding `express.text({ type: 'text/plain' })` in the test app.
   - Impact: real `text/plain` BIP78 receiver requests can arrive with an undefined body and be rejected as `original-psbt-rejected`.
   - Fix direction: mount route-local `express.text({ type: 'text/plain', limit: ... })` before the Payjoin receiver route and add a production-shaped parser test. Also keep the receiver clearly marked incomplete until input signing is implemented.

6. **Backup restore can destroy data from partial backups and continue after delete failures.**
   - Evidence: missing required tables are warnings, not validation failures, and restore deletes existing tables before inserting backup tables. Delete failures are logged and swallowed.
   - Impact: a partial backup can wipe present data and restore an incomplete dataset; failed deletes can leave stale rows behind while the API reports success.
   - Fix direction: make missing core tables fatal for destructive restore unless an explicit partial-restore mode is requested, and abort the transaction on delete failures.

7. **Release workflow Semgrep findings are currently red.**
   - Evidence: `npm run check:semgrep-baseline` reports unbaselined `yaml.github-actions.security.run-shell-injection` findings in release workflows.
   - Impact: workflow inputs/tags are interpolated into shell in jobs that later use privileged GitHub APIs.
   - Fix direction: pass GitHub expression values through environment variables, quote shell variables, validate tags/version inputs, and refresh the baseline only after fixes or explicit review.

8. **Mobile gateway can run cleartext HTTP in production by default.**
   - Evidence: `docker-compose.yml` defaults `GATEWAY_TLS_ENABLED` to `false` while exposing gateway port `4000`; gateway config warns but still starts.
   - Impact: bearer tokens and mobile API traffic can be exposed if the default gateway port is deployed outside a trusted network.
   - Fix direction: fail closed when `NODE_ENV=production` and TLS is disabled unless an explicit internal-only override is set.

### P2 Findings

1. **Client download/upload/blob helpers do not refresh expired sessions on 401.**
   - Normal JSON requests refresh and retry; transfer helpers do direct fetches and fail Unauthorized.

2. **Send page loads mainnet mempool data for non-mainnet wallets.**
   - `bitcoinApi.getMempoolData()` is called without wallet network while fee estimates correctly pass `apiWallet.network`.

3. **Bulk admin group membership updates leave wallet-access cache stale.**
   - Dedicated add/remove paths invalidate access cache, but `setMembers` bulk update does not.

4. **Request timeout does not abort in-flight route work.**
   - The middleware sends 408 after the timeout, but async handlers can keep mutating state after the client sees a timeout.

5. **Service unhandled-rejection handlers log and keep running.**
   - Server, gateway, and AI proxy entrypoints log unhandled promise rejections without exiting, which can leave degraded services marked healthy.

6. **GHCR compose defaults include predictable database credentials and unauthenticated Redis.**
   - The prebuilt-image compose path can be launched with `sanctuary` defaults and open internal Redis.

7. **AI proxy tests are not covered by the root coverage gate, and CI allows no tests.**
   - Root coverage excludes `ai-proxy/src/**`; CI uses `--passWithNoTests` for AI proxy test jobs.

8. **Physical hardware-in-loop signing proof remains incomplete.**
   - The prior fixture matrix still needs 11 required Ledger/Trezor/BitBox signed fixture rows; normal tests pass without requiring those artifacts.

### P3 Findings

1. Capability-gated Intelligence nav is hidden, but direct `#/intelligence` route access is not route-gated.
2. Logged-in users with missing/null preferences cannot persist preference changes.
3. Authenticated refresh can briefly render the login screen during auth bootstrap.
4. Frontend Dockerfile creates a non-root user but does not switch to it.
5. `ENCRYPTION_SALT` has a static deployment default.
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
- CI policy thresholds are uneven: high/critical audit passes, but package-level moderate scans fail; Semgrep baseline drift is not clean; AI proxy coverage/test existence is weak.
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
- `npm run check:semgrep-baseline` - failed with 8 new findings and 7 stale baseline entries.
- `npm audit --omit=dev --audit-level=moderate` - root scan exited 0 with low root advisories only.
- `npm --prefix server audit --omit=dev --audit-level=moderate` - failed on `hono` moderate advisories.
- `npm --prefix ai-proxy audit --omit=dev --audit-level=moderate` - failed on `ip-address` via `express-rate-limit`.

No production code was changed in this scrub. The only intended repository edits are this report and `tasks/todo.md`.
