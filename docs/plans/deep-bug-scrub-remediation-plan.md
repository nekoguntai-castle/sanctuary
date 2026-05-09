# Deep Bug Scrub Remediation Plan

Date: 2026-05-08
Status: Refined Draft
Last refined: 2026-05-08
Source audit: `docs/plans/codebase-health-assessment.md`
Target outcome: close every P1/P2/P3 issue from the deep scrub, restore clean security/quality gates, and raise the risk-adjusted health score back to A range.

---

## Operating Rules

- Keep each remediation slice small enough to review and revert independently.
- Start every behavioral fix with failing or missing tests that prove the invariant, then implement the smallest production change that makes those tests pass.
- Do not baseline or suppress security findings until the underlying pattern has either been fixed or explicitly documented as a reviewed exception.
- Run focused tests for each slice, then run the repo-wide quality gate after each high-risk phase.
- Treat destructive data paths, transaction broadcast, auth/session changes, and deployment defaults as security-sensitive changes requiring edge-case tests.
- Do not start implementation until this plan is accepted; project instructions require check-in after planning.

---

## Definition Of Done

A finding is closed only when all of these are true:

1. The unsafe behavior has a regression test that fails before the fix or a documented reason a pre-fix failure cannot be run.
2. Production code implements the desired invariant, not just a UI or documentation workaround.
3. Null/empty/boundary/error cases are covered where applicable.
4. Focused tests, typecheck/lint for touched areas, and `git diff --check` pass.
5. For each phase, the relevant quality gate is clean or the remaining failure is documented as a separate open item.

Final completion requires:

- `npm run check:semgrep-baseline` passes.
- Root, server, and AI proxy dependency audits pass at the agreed threshold.
- The deep scrub P1/P2/P3 inventory below is either fixed or explicitly accepted with owner/date/rationale.
- `npm run coverage`, `npm run lint`, typechecks, lizard, jscpd, large-file check, and gitleaks pass.

---

## Prompt Coverage Checklist

This plan is complete only if it covers every issue from `docs/plans/codebase-health-assessment.md` and gives implementers enough detail to avoid hidden corner-case drift.

| Source Requirement | Covered By | Evidence In This Plan |
| --- | --- | --- |
| Address all P1 findings | P1-01 through P1-08 | Phases 1, 2, and 3 plus the corner-case matrix below. |
| Address all P2 findings | P2-01 through P2-09 plus P2-01a | Phases 2, 3, and 4 plus the corner-case matrix below. |
| Address all P3 findings | P3-01 through P3-06 | Phases 2, 3, and 4 plus the corner-case matrix below. |
| Include verification, not just intent | Per-row focused verification and rollup verification | Each row has focused tests/checks; final rollup lists full commands. |
| Capture deployment and CI details | Phase 2 | Semgrep, audit policy, gateway TLS, GHCR secrets, Redis, AI proxy coverage, Docker user, and salt defaults are all covered. |
| Capture product behavior details | Phases 1, 3, and 4 | Send, Payjoin, auth, preferences, route capability, and bootstrap UX have expected behavior and edge cases. |
| Avoid implementation before check-in | Phase 0 | Exit criteria require plan acceptance and first-slice selection before production code changes. |

---

## Cross-Cutting Design Decisions

Resolve these before or during the first relevant implementation slice. Leaving them implicit is how fixes become inconsistent across routes, clients, and tests.

1. **API contract compatibility**: any response-shape change, especially registration pending-verification and broadcast rejection details, needs frontend updates and contract tests in the same slice.
2. **Migration and rollback**: token revocation watermarks, default-secret rejection, Redis auth, and preference normalization may require schema/config migrations. Every migration must have rollback impact documented.
3. **Audit logging**: auth revocation, policy rejection, restore rejection, Semgrep baseline exceptions, production TLS override, and default-secret startup failures should log structured events without leaking secrets.
4. **Feature flags and rollout**: security fixes should default on. Temporary compatibility flags are allowed only with removal criteria and tests for both states.
5. **Multi-client behavior**: browser cookie auth, mobile bearer auth, gateway callers, and any CLI/offline flows must be checked where auth/session or broadcast contracts change.
6. **Concurrency**: auth revocation, cache invalidation, restore, broadcast, upload retry, and request timeout fixes must define behavior under simultaneous requests.
7. **Network identity**: any Bitcoin network comparison must use the repo's canonical network enum/mapping and account for mainnet, testnet3/testnet4, signet, and any existing legacy `testnet` aliases.
8. **No silent downgrade**: a blocked or incomplete feature should show an explicit unsupported/unavailable state, not silently fall back to mainnet/default success behavior.

---

## Recommended PR Order And Dependencies

1. **PR 1: P1-01 raw broadcast canonical validation**. This is highest risk because broadcast is irreversible. It should land before broader policy/audit cleanup.
2. **PR 2: P1-02 token revocation foundation**. Schema/model changes here become reusable for P1-03 and related auth tests.
3. **PR 3: P1-03 email verification session behavior**. Depends on the auth contract clarity from PR 2, but can be parallelized if response-shape work is isolated.
4. **PR 4: P1-04 send network validation and P2-04 mempool network context**. Both are frontend network-context fixes and should share helper semantics.
5. **PR 5: P1-05 backup restore safety**. Keep separate because it touches destructive data workflows and transaction semantics.
6. **PR 6: P1-06 Semgrep and P2-01 audits**. CI/security gate cleanup can run in parallel with app fixes but should merge before release.
7. **PR 7: P1-07 gateway TLS, P2-02 GHCR secrets, P3-02 salt, P3-01 Docker user**. Deployment hardening is cohesive but should be split if Compose/config changes become too broad.
8. **PR 8: P1-08 Payjoin parser and feature-boundary cleanup**. Keep receiver parsing separate from signing-completeness work unless signing support is implemented now.
9. **PR 9+: Phase 4 reliability/UX fixes**. These can be independent slices after the high-risk issues are closed.

---

## Phase 0 - Tracking And Guardrails

Goal: make the remediation work observable and prevent partial fixes from being mistaken as complete.

Work:

1. Open one implementation branch or one branch per slice, depending on delivery preference.
2. Add a progress checklist to `tasks/todo.md` before each slice starts.
3. For every issue below, create or update a local test/spec proving the desired behavior.
4. After each slice, update `docs/plans/codebase-health-assessment.md` only with measured status, not aspirational completion.

Exit criteria:

- This plan is accepted.
- First implementation slice is selected.
- No production code has been changed before check-in.

---

## Phase 1 - Critical User And Security Invariants

These are the highest-risk application bugs because they affect transaction safety, auth state, account verification, and destructive restore behavior.

| ID | Finding | Approach | Exit Criteria | Focused Verification |
| --- | --- | --- | --- | --- |
| P1-01 | Raw transaction broadcast can bypass policy using self-reported or missing intent. | Decode raw transaction server-side before network broadcast. Derive canonical outputs, fee, and wallet-spent inputs from the signed payload and wallet data. Evaluate policy and persistence from decoded data. Reject missing, ambiguous, or mismatched metadata instead of trusting request fields. | Raw-hex broadcasts cannot skip policy by omitting `recipient`/`amount`; mismatched metadata rejects before broadcast; audit/persistence use decoded values. | Broadcast route/service tests for missing metadata, mismatched metadata, valid decoded metadata, invalid network, and draft/raw paths. |
| P1-02 | Existing access JWTs survive logout-all, revocation, role changes, and deletion until expiry. | Add a per-user `tokensValidAfter` or `sessionVersion` checked by `authenticate`. Include token issue time/version in access JWTs. Advance the watermark/version on logout-all, password change/reset, admin role change, user disable/delete, and security revocation. | Old access tokens fail immediately after every revocation state transition; refresh-token chains cannot mint new access tokens after revocation. | Auth integration tests for logout-all, password reset, admin demotion, user deletion/disable, refresh after revocation, and admin-only route access with stale tokens. |
| P1-03 | Registration issues a live session when email verification is required. | When verification is required, create the user and send verification email, but do not issue access/refresh cookies or authenticated frontend state. Return a pending-verification response shape the frontend handles explicitly. | A newly registered unverified user has no auth cookies and cannot access protected routes until verification succeeds. | Registration route tests for required/disabled verification, cookie absence/presence, frontend `UserContext` registration behavior, and resend/verification completion path. |
| P1-04 | Normal send validation accepts wrong-network addresses. | Replace format-only output validation with network-aware validation for normal manual entry, BIP21, Payjoin, QR, and step gating. Keep error copy specific to wrong-network vs invalid-format. | Mainnet addresses fail in testnet/signet wallets and testnet/signet addresses fail in mainnet wallets before review/signing. | Frontend tests for manual outputs, BIP21, QR/update helper paths, and `canProceedFromStep` gating. |
| P1-05 | Backup restore can destroy data from partial backups and continue after delete failures. | Split backup validation into preview vs destructive-restore policy. For destructive restore, missing core tables and delete failures are fatal unless an explicit partial-restore mode is introduced. Roll back the transaction on any core-table delete failure. | Partial backups cannot wipe existing datasets by default; restore cannot report success after failed core deletes. | Backup validation tests, restore transaction tests, API route tests for missing core table, delete failure, explicit partial mode if added, and successful full restore. |

Phase exit gate:

- Focused tests for all five issues pass.
- Relevant server/frontend typechecks pass.
- `npm run lint` and `git diff --check` pass.
- Update the health report with fixed status and any remaining risk.

---

## Phase 2 - CI And Deployment Fail-Closed Hardening

These items block confidence in releases and production safety. They should be fixed before a production release even if application code is otherwise healthy.

| ID | Finding | Approach | Exit Criteria | Focused Verification |
| --- | --- | --- | --- | --- |
| P1-06 | Semgrep baseline is red, including release workflow shell-injection findings. | Move GitHub expression values into `env`, quote shell variables, validate version/tag input formats, avoid shell interpolation in privileged steps, review the insecure WebSocket and child-process findings, and refresh the Semgrep baseline only after fixes or explicit exceptions. | `npm run check:semgrep-baseline` passes with no new/stale entries. | Semgrep baseline check, actionlint if available, workflow runtime guard tests. |
| P1-07 | Mobile gateway can run cleartext HTTP in production by default. | Fail gateway startup when `NODE_ENV=production` and TLS is disabled unless an explicit internal-only override is set. Update Compose defaults/docs so exposed production mode is secure by default. | Production gateway cannot start exposed cleartext by accident. | Gateway config tests for production TLS enabled/disabled/override, Compose config review, gateway unit tests. |
| P2-01 | Package-level moderate audits fail while policy only checks high/critical. | Upgrade or override vulnerable dependency chains for server `hono` and AI proxy `express-rate-limit -> ip-address`. Decide whether CI should fail on moderate for production packages. | Root, server, and AI proxy production audits are clean at the chosen threshold. | `npm audit --omit=dev --audit-level=moderate`, `npm --prefix server audit --omit=dev --audit-level=moderate`, `npm --prefix ai-proxy audit --omit=dev --audit-level=moderate`, plus package tests. |
| P2-01a | Root low elliptic-family advisories remain with no safe automatic fix. | Keep a dependency-audit triage entry for the Trezor/browser crypto chain, avoid forced upgrades without wallet compatibility testing, and periodically re-check whether upstream fixes become available. | The risk is either fixed by a compatible upgrade or explicitly accepted with owner/date/rationale. | Root audit, hardware-wallet compatibility tests, dependency triage review. |
| P2-02 | GHCR compose defaults include predictable DB credentials and unauthenticated Redis. | Require explicit DB password in GHCR compose, add Redis auth or isolate Redis with no exposed ports plus documented threat model, and fail config when production secrets use known defaults. | Prebuilt-image compose cannot launch production-like services with known DB password or unauthenticated Redis by default. | `docker compose -f docker-compose.ghcr.yml config`, server config tests for default-secret rejection, docs review. |
| P2-03 | AI proxy tests are excluded from coverage and CI allows no tests. | Add AI proxy test and coverage scripts, include AI proxy in coverage policy or add package-local coverage gate, and remove `--passWithNoTests` from CI for that package. | Missing AI proxy tests fail CI; coverage is measured for security-sensitive proxy code. | AI proxy test command, coverage command, CI workflow test discovery check. |
| P3-01 | Frontend container creates a non-root user but does not switch to it. | Switch final image to the non-root user if nginx permissions allow it; otherwise document and harden with read-only filesystem/capability drops. | Runtime user matches intended hardening or has explicit reviewed exception. | Docker build/config inspection and smoke run if feasible. |
| P3-02 | `ENCRYPTION_SALT` has a static deployment default. | Require explicit production salt or generate unique deployment salt. Reject known default salt in production config. | Production cannot start with `sanctuary-node-config` salt. | Server config tests and Compose config review. |

Phase exit gate:

- Semgrep baseline passes.
- Production package audits pass at selected threshold.
- Gateway/compose/config tests pass.
- `git diff --check` passes.

---

## Phase 3 - Wallet Feature Correctness And Feature Boundaries

These fixes close feature-level correctness gaps and reduce user confusion around network context and incomplete feature surfaces.

| ID | Finding | Approach | Exit Criteria | Focused Verification |
| --- | --- | --- | --- | --- |
| P1-08 | Payjoin receiver rejects real `text/plain` BIP78 requests in production. | Mount route-local `express.text({ type: 'text/plain', limit: ... })` before the Payjoin receiver route. Add production-shaped tests using the same parser stack as the app. Keep receiver signing incompleteness clearly feature-gated or documented. | Real text/plain PSBT requests reach the Payjoin handler as strings; malformed/empty bodies still reject correctly. | Payjoin route tests with app-like middleware, content-type tests, max body size test. |
| P2-04 | Send page loads mainnet mempool data for non-mainnet wallets. | Thread `apiWallet.network` through `bitcoinApi.getMempoolData`. Verify API default behavior remains only for callers that truly want mainnet. | Testnet/signet send pages request matching network mempool data. | Send page loader tests for mainnet/testnet/signet. |
| P2-05 | Physical hardware-in-loop signing proof remains incomplete. | Capture required Ledger/Trezor/BitBox signed fixture rows on real devices or commit vendor-signed artifacts with provenance. Keep unsupported multisig rows explicitly marked unsupported. | Required fixture gate passes or each missing row has a tracked blocker with device/artifact owner. | `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts`. |
| P3-03 | Capability-gated Intelligence nav is hidden but direct route access is not gated. | Apply `requiredCapabilities` at route render time, not only sidebar filtering. Show unavailable/loading/denied state consistently. | Direct `#/intelligence` access respects capability state. | App route tests for available, unavailable, and loading capability states. |

Phase exit gate:

- Focused frontend/server tests pass.
- Feature availability is explicit for incomplete Payjoin/hardware surfaces.
- No network-context regression in send tests.

---

## Phase 4 - Reliability And Session UX Consistency

These issues are lower immediate severity than Phase 1, but they reduce operational ambiguity and inconsistent user-visible behavior.

| ID | Finding | Approach | Exit Criteria | Focused Verification |
| --- | --- | --- | --- | --- |
| P2-06 | Client download/upload/blob helpers do not refresh expired sessions on 401. | Refactor API client 401 refresh/retry into a shared helper used by JSON, blob, download, and upload paths. Ensure retry preserves body/file semantics safely. | Transfer helpers recover from expired access tokens the same way normal requests do. | API client tests for blob/download/upload 401 refresh success, refresh failure, CSRF behavior, and non-retryable methods/body reuse. |
| P2-07 | Bulk admin group membership updates leave wallet-access cache stale. | Invalidate affected user-wallet/group access cache entries after `setMembers`, matching dedicated add/remove paths. | Added/removed users see correct wallet access immediately after bulk update. | Admin group service tests and integration route tests around cache priming then bulk membership update. |
| P2-08 | Request timeout does not abort in-flight route work. | Add request-scoped `AbortSignal` or route-level cancellation for external I/O and long DB workflows. For operations that cannot safely cancel, move to explicit job/202 pattern or document idempotency. | Timed-out long-running handlers do not continue unsafe state mutation silently. | Middleware tests proving signal abort; route-specific tests for backup/restore/broadcast/sync behavior where cancellation is supported. |
| P2-09 | Service unhandled-rejection handlers log and keep running. | Convert server, gateway, and AI proxy unhandled-rejection behavior to fatal logging plus graceful shutdown/exit, with supervisor restart expected. | Unhandled promise rejections do not leave services healthy-but-degraded. | Entrypoint/process-handler tests using isolated child processes or extracted handler modules. |
| P3-04 | Logged-in users with missing/null preferences cannot persist preference changes. | Normalize missing preferences to defaults on load/update, and persist merged preferences for logged-in users. | Legacy/null-preference users can change and persist preferences. | `UserContext` and `useUserPreference` tests for null/missing preferences. |
| P3-05 | Authenticated refresh briefly renders login during auth bootstrap. | Add a bootstrap/loading route gate before rendering login for protected routes. | Authenticated refresh shows neutral loading state, not login flash. | App route tests for bootstrapping authenticated session and unauthenticated final state. |
| P3-06 | Stale cookie-auth/CSRF comments drift from current behavior. | Refresh comments while touching related auth/CSRF files; avoid standalone churn unless those files are already in a slice. | Comments match implemented behavior. | Review-only; no dedicated test required. |

Phase exit gate:

- Focused reliability/frontend tests pass.
- `npm run test:run` for touched frontend suites and server tests for touched backend suites pass.
- `git diff --check` passes.

---

## Per-Issue Corner-Case Matrix

### P1-01 Raw Transaction Broadcast Canonical Validation

Must handle before calling the network broadcast service:

- Raw hex, signed PSBT, and draft-backed broadcast paths should converge on one canonical parsed intent object.
- Reject payloads when decoded transaction network/address type conflicts with wallet network.
- Reject or require explicit policy handling for multiple external recipients, OP_RETURN-only outputs, dust outputs, and unknown script types.
- Identify wallet-owned inputs and change outputs using existing wallet address/UTXO data, not caller labels.
- Compute fee from decoded inputs minus outputs; reject negative, zero-input, missing-input, or unknown-input fee cases unless explicitly supported.
- Re-evaluate policies using decoded external recipient set, total spend, fee, and wallet context.
- Ensure metadata mismatch rejects before broadcast, including mismatched `recipient`, `amount`, `fee`, `utxos`, `draftId`, and network.
- Ensure persistence and notifications use decoded values after broadcast.
- Define idempotency for duplicate broadcasts and mempool "already known" responses.
- Define behavior when broadcast succeeds but persistence fails; at minimum, durable audit/reconciliation should capture the txid and raw transaction.
- Cover RBF, CPFP-like extra inputs/outputs, taproot/segwit/legacy script types, and large transaction size limits.

### P1-02 Access JWT Revocation

Must handle:

- Legacy tokens without the new version/watermark fields should fail closed after rollout or be accepted only during a short documented migration window.
- Clock skew if using `iat` vs `tokensValidAfter`; prefer monotonic version or carefully compare timestamps with precision tests.
- Password change, password reset, logout-all, admin demotion/promotion, account disable/delete, email verification state changes if protected routes depend on it, and explicit security revocation.
- Refresh-token reuse after watermark changes must fail and clear browser cookies.
- Mobile bearer auth and gateway-authenticated calls must use the same revocation check as browser cookie auth.
- Deleted or disabled users must fail authentication even if JWT signature is valid.
- Admin checks should not rely only on stale JWT role claims if the database role changed.
- Cache any user/session-version lookup only if invalidation is immediate and tested.
- Concurrent requests around revocation should have deterministic behavior; requests authenticated after the revocation write must fail.

### P1-03 Email Verification Registration Session

Must handle:

- Verification required vs disabled, including existing setting defaults.
- First-admin/bootstrap registration if the app has a special first-user path.
- Email delivery failure: decide whether user is created pending verification, whether resend is allowed, and whether no auth cookies are still guaranteed.
- Duplicate email and unverified existing account flows without creating account enumeration leaks.
- Expired, reused, malformed, and already-used verification tokens.
- Resend rate limits and audit logging.
- Frontend registration response shape for pending verification, including no `setUser` authenticated state.
- Refresh endpoint behavior for unverified users with any existing legacy token.
- Existing unverified sessions created before the fix: revoke them or block them at auth middleware.

### P1-04 Wrong-Network Send Validation

Must handle:

- Manual output entry, BIP21 URI paste, QR scan, Payjoin URI, multi-output editing, and output removal/reordering.
- Mainnet, testnet3, testnet4, signet, regtest if supported, and legacy `testnet` aliases.
- Bech32/bech32m, taproot, legacy base58, P2SH, uppercase/lowercase, whitespace, and invisible character trimming.
- BIP21 amount parsing boundaries: zero, negative, too many decimals, over-balance, and malformed amount.
- Distinguish "invalid address" from "valid address for wrong network" in UI state and tests.
- Ensure `canProceedFromStep` cannot pass while any output has wrong-network validation failure.
- Ensure backend compose/broadcast validation also rejects wrong-network addresses so UI is not the only guard.

### P1-05 Backup Restore Safety

Must handle:

- Required core tables vs optional/audit/legacy tables, with a versioned allowlist.
- Backup schema version mismatch, unknown future version, and migration-needed backups.
- Empty backup, malformed JSON, invalid checksums/signatures if present, encrypted backup failure, and over-limit payload size.
- Partial restore mode, if added, must require explicit API/UI acknowledgement and must not be the default.
- Restore should acquire a lock or reject concurrent restore/export/mutation workflows.
- Delete failures for core tables must abort and roll back. Do not log-and-continue.
- Foreign-key ordering, cascade behavior, row counts, and post-restore integrity checks must be verified.
- Preserve a pre-restore safety snapshot or make rollback expectations explicit.
- Audit who started restore, validation warnings, table counts, and final status.

### P1-06 Semgrep Baseline And Workflow Injection

Must handle:

- Every reported new and stale Semgrep baseline entry, not only release workflow findings.
- Release, create-release, release-candidate, release-offline-bundle, install-test, insecure WebSocket, and child-process findings from the current failed baseline output.
- Use `env` to pass GitHub expression values into shell, quote all shell variables, and validate tags/versions against strict regexes before use.
- Avoid passing untrusted tags/inputs into `gh api`, file paths, package names, or shell command fragments.
- Refresh baseline only after findings are fixed or each exception has owner/date/rationale.
- Keep workflow runtime guard and actionlint checks green.

### P1-07 Gateway Production TLS

Must handle:

- Direct public gateway deployments and deployments behind a trusted TLS-terminating reverse proxy are different modes; require an explicit `GATEWAY_ALLOW_INSECURE_INTERNAL_HTTP=true`-style override for the latter.
- Production startup should fail closed when TLS is disabled and no explicit internal-only override exists.
- Local development and test environments should remain usable without production TLS.
- Health/readiness endpoints should clearly expose TLS mode without leaking secrets.
- Compose port mapping should not publish cleartext gateway externally by default in production examples.
- Mobile docs must specify certificate and reverse-proxy expectations.

### P1-08 Payjoin Parser And Feature Boundary

Must handle:

- `text/plain`, `text/plain; charset=utf-8`, missing content type, wrong content type, empty body, oversized body, and malformed PSBT.
- Parser ordering so JSON/urlencoded body parsers do not consume or reject the Payjoin text body first.
- Preserve BIP78 response content type and plain-text error bodies.
- Rate limiting and body-size limit for unauthenticated receiver endpoints.
- Receiver signing incompleteness: either feature-gate receiver mode, return explicit unsupported status, or implement signing before advertising production readiness.
- Tests should build the app-like middleware stack, not a custom parser stack that masks production behavior.

### P2-01 And P2-01a Dependency Audit Policy

Must handle:

- Server `hono` advisories introduced through tooling dependencies; avoid `npm audit fix --force` without checking Prisma/MCP compatibility.
- AI proxy `express-rate-limit -> ip-address` upgrade path and any API changes.
- Root low elliptic-family advisories through Trezor/browser crypto dependencies; avoid forced upgrades without hardware-wallet compatibility tests.
- Decide and document whether CI blocks moderate production advisories or tracks them with SLA.
- Ensure lockfiles are updated consistently and no package manager drift is introduced.

### P2-02 GHCR Secrets And Redis

Must handle:

- Require explicit Postgres password and reject known defaults in production-like compose.
- Redis auth must be wired through every service that connects to Redis, including health checks and local examples.
- If Redis remains unauthenticated, document why it is isolated and ensure it is not externally exposed.
- Update `.env` examples without committing real secrets.
- Verify `docker compose -f docker-compose.ghcr.yml config` still works with required env placeholders.

### P2-03 AI Proxy Coverage

Status: implemented in the AI proxy coverage-gate slice. The AI proxy package now owns `test`, `test:coverage`, and `coverage` scripts backed by `ai-proxy/vitest.config.ts`; full CI runs the coverage script without `--passWithNoTests` and uploads/reports the AI proxy coverage artifact.

Must handle:

- Added package-local `test` and `coverage` scripts.
- Removed `--passWithNoTests` from AI proxy CI so missing tests fail.
- Included `ai-proxy/src/**` in a dedicated coverage gate without destabilizing unrelated root coverage.
- Added or preserved behavioral coverage for auth, rate limiting, upstream errors/timeouts, request validation, provider/config routes, model-pull streaming progress, and secret redaction. Remaining baseline improvement work is concentrated in insight, label-query, and backend-context routes.

### P2-04 Send Mempool Network Context

Must handle:

- Thread wallet network into `bitcoinApi.getMempoolData` and ensure backend/API supports the same network values.
- Cache keys must include network to avoid cross-network data reuse.
- Failure fallback should remain local to mempool context and should not mask fee-estimate network failures.
- Tests should cover mainnet, testnet3/testnet4, signet, and default-mainnet callers outside wallet context.

### P2-05 Hardware Signing Fixtures

Must handle:

- Record device model, firmware/app version, derivation path, xpub/fingerprint handling, network, script type, and fixture provenance.
- Avoid committing private keys, seed material, or personally identifying wallet metadata.
- Keep unsupported multisig rows explicitly classified with reason and source.
- CI should run the non-hardware fixture tests normally and the required-hardware gate only when artifacts are available or explicitly requested.

### P2-06 Transfer Helper Session Refresh

Status: implemented in the transfer helper session-refresh slice. `ApiClient` now uses one refresh-on-401 executor for JSON, blob, download, and upload paths; transfer retries rebuild headers so refreshed CSRF cookies are observed, downloads preserve the retried response filename, upload keeps its existing transient retry behavior, and non-replayable blob/upload bodies are rejected before fetch. `createBackup()` now delegates to `apiClient.fetchBlob()` so backup blobs use the same session refresh path.

Must handle:

- GET downloads, blob fetches, uploads with `File`/`Blob`, and any stream body that cannot be replayed after a failed request.
- 401 before side effects vs 401 after partial upload; retry only when safe.
- CSRF token refresh ordering and concurrent refresh de-duplication.
- Refresh failure should clear auth state consistently with JSON requests.
- Preserve response headers/filename handling for downloads after retry.

### P2-07 Bulk Group Cache Invalidation

Status: implemented in the bulk group cache-invalidation slice. `setMembers` now returns the validated add/remove diff, and `updateAdminGroup` invalidates access caches for affected users after successful bulk membership replacement.

Must handle:

- Invalidates users removed and users added, not only the final membership set.
- Invalidates all affected user-scoped wallet/group role cache keys, including inherited wallet access.
- Bulk `memberIds` replacement does not carry role changes; the current explicit member-role API is add-member only, so this slice does not invent a role-update path.
- Define behavior for multi-process deployments if cache is in-memory only.
- Tests cover cache invalidation for bulk allow-to-deny and deny-to-allow membership transitions.

### P2-08 Request Timeout Cancellation

Must handle:

- Express request lifecycle should expose an `AbortSignal` or equivalent cancellation context to downstream services.
- External HTTP/Electrum/AI calls should honor the signal where libraries support it.
- Prisma/database operations may not be cancellable; long destructive workflows may need job/202 pattern or explicit idempotency.
- Backup restore and transaction broadcast need special handling because continuing after timeout can mutate irreversible state.
- Timeout response should not be sent twice if the handler later fails or completes.
- Logs should distinguish "client timed out but work completed" from "work aborted".

### P2-09 Unhandled Rejection Shutdown

Must handle:

- Extract process handlers into testable modules or test via child processes.
- Fatal path should stop accepting new requests, close servers, flush logs/metrics if practical, and exit with non-zero code after a bounded grace period.
- Avoid double shutdown on repeated `uncaughtException`/`unhandledRejection`/signals.
- Test behavior separately for server, gateway, AI proxy, and worker-like entrypoints if present.

### P3-01 Frontend Container Runtime User

Must handle:

- Nginx needs permission to read static files and write any required pid/cache/temp paths as non-root.
- If binding privileged port requires root, switch to unprivileged port internally or document why runtime root remains.
- Keep `no-new-privileges` and consider read-only filesystem/capability drops if compatible.

### P3-02 Static Encryption Salt

Must handle:

- Reject known default salt in production and production-like GHCR compose.
- Decide whether development/test keep a deterministic default.
- Ensure config error messages do not log encryption key material.
- Document rotation implications: changing salt may make existing encrypted values unreadable unless migration path exists.

### P3-03 Capability-Gated Intelligence Route

Must handle:

- Loading, unavailable, available, and error states.
- Direct hash route access, sidebar navigation, browser back/forward, and deep links.
- Avoid redirect loops; preserve intended destination only when capability can become available.
- Tests should verify route render behavior, not just sidebar visibility.

### P3-04 Null Preferences

Must handle:

- `null`, `undefined`, empty object, partial object, and unknown preference keys.
- Merge defaults without dropping server-provided preferences.
- Persist for logged-in users and keep local fallback only for anonymous/bootstrap states.
- Multi-tab preference updates and race behavior should match existing auth/session patterns.

### P3-05 Auth Bootstrap Login Flash

Must handle:

- Protected routes should render a neutral bootstrap/loading state while auth refresh is in progress.
- Public routes should not be unnecessarily blocked.
- Refresh failure should eventually render login or an unauthenticated route, not an infinite spinner.
- Direct deep links should land on the intended route after successful bootstrap.

### P3-06 Stale Comments

Must handle:

- Update comments in files touched by auth/CSRF fixes so comments describe current cookie auth and CSRF behavior.
- Avoid standalone comment-only churn unless comments are actively misleading in a high-risk area.

---

## Rollup Verification

Run this after all phases or before a release candidate:

1. `npm run coverage`
2. `npm run lint`
3. `npm run typecheck:app`
4. `npm run typecheck:tests`
5. `npm run typecheck:server:tests`
6. `npm run check:semgrep-baseline`
7. `npm audit --omit=dev --audit-level=moderate`
8. `npm --prefix server audit --omit=dev --audit-level=moderate`
9. `npm --prefix ai-proxy audit --omit=dev --audit-level=moderate`
10. `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .`
11. `npm run quality:lizard`
12. `node scripts/quality/check-large-files.mjs`
13. `GITLEAKS_BIN=/home/nekoguntai/.local/bin/gitleaks bash scripts/gitleaks-tracked-tree.sh`
14. `git diff --check`

Hardware-dependent release gate:

- `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts`

---

## Expected Score Recovery

| Milestone | Expected Outcome |
| --- | --- |
| Phase 1 complete | Correctness and Security recover materially; highest user-loss/security bypass bugs closed. |
| Phase 2 complete | Hard-fail blockers removed; Operational Readiness improves; release confidence restored. |
| Phase 3 complete | Feature correctness improves; remaining wallet feature gaps are either fixed or explicitly blocked on hardware. |
| Phase 4 complete | Reliability and UX consistency improve; lower-severity drift is closed. |
| Hardware fixture gate complete | Final correctness gap closes; target score should be A range if gates remain clean. |

---

## Work To Avoid

- Do not only add tests around current unsafe behavior.
- Do not fix raw broadcast by requiring more client metadata without server-side decoding.
- Do not treat access-token expiry as sufficient revocation for admin demotion or account deletion.
- Do not baseline Semgrep release workflow findings until interpolation patterns are fixed or explicitly accepted.
- Do not weaken coverage or audit thresholds to make the plan appear complete.
- Do not mix every P1 into one large PR; the review blast radius would be too high.
