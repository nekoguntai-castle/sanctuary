# Sanctuary full-repo audit — 2026-05-12

Two-pass audit (Claude + Codex independent reads, merged per chunk). High-leverage subset run: 6 chunks covering ~304 source files. Server `services/` (399 files), `worker/`, `assistant/`, `agent/`, `events/`, `infrastructure/`, `mcp/`, `models/`, `observability/`, `validation/`, `websocket/`, and frontend `src/` deferred to a follow-up `/audit --resume` run.

## Headline numbers

| Severity | Count | Dual-flagged | Notes |
|---|---|---|---|
| **Critical** | **12** | 3 | Direct path to financial loss / RCE / auth bypass |
| **High** | **39** | ~14 | Normal-path bugs, auth boundary smells, fail-open defaults |
| **Medium** | 55 | ~8 | Error swallowing, secondary leaks, unusual-condition bugs |
| **Low** | 39 | ~3 | Smells, convention violations |
| **Total** | **145** | ~28 | Across 6 chunks, 304 files |

**All findings accepted** (0 rejected, 0 deferred) except 1 in gateway (logger console-use is the legit centralized sink). The merge default favors triage-time filtering over per-chunk rejection.

## Per-chunk breakdown

| Chunk | Files | C | H | M | L | Dual | Phase C file |
|---|---|---|---|---|---|---|---|
| repositories | 49 | 3 | 8 | 8 | 7 | 10 | [01-repositories.md](01-repositories.md) |
| middleware | 18 | 0 | 4 | 7 | 6 | 2 | [02-middleware.md](02-middleware.md) |
| api | 175 | 3 | 4 | 6 | 7 | 1 | [03-api.md](03-api.md) |
| utils | 26 | 1 | 12 | 18 | 8 | 8 | [04-utils.md](04-utils.md) |
| gateway | 26 | 0 | 6 | 9 | 6 | 1 | [05-gateway.md](05-gateway.md) |
| workflows | 10 | 5 | 5 | 7 | 5 | 5 | [06-workflows.md](06-workflows.md) |

Raw per-pass notes in [`raw/`](raw/). Codex sandbox blocked writes for middleware + gateway; those raw files were reconstructed from inline summaries (top findings only; medium/low Codex bucket exists by count but is not enumerated). Treat their medium/low merge counts as a floor.

## Top 12 critical findings

Sorted by blast radius. All accepted; none rejected.

### Multisig / vault custody (3) — highest user-visible financial risk
1. **`server/src/api/wallets/approvals.ts:59`** — Approval-vote `requestId` not scoped to wallet route. Approver on wallet A can cast votes against wallet B's request by guessing the ID. _IDOR on financial authorization._
2. **`server/src/api/wallets/approvals.ts:102`** — Owner override force-approves a draft from another wallet (same root cause: `draftId` accepted unscoped). _Owner of any wallet can force-approve drafts in any other wallet._
3. **`server/src/api/transactions/broadcastIntent.ts:176`** — Signed-PSBT policy enforcement evaluates only the **first** external output. Multi-output PSBTs bypass spend-limit and whitelist on outputs 2+. _Policy theater for multi-recipient sends._

### Repository-layer privilege & state-integrity (3)
4. **`server/src/repositories/walletRepository.ts:316`** — `findByIdWithEditAccess` treats `signer` as satisfying owner-only checks. Owner-only mutation paths accept signers.
5. **`server/src/repositories/policyRepository.ts:411`** — `findOrCreateUsageWindow` relies on a unique constraint over a nullable column; Postgres allows multiple NULLs, so concurrent first-spend evaluations split spend across duplicate windows. _Spend-limit accounting underflows; effective cap doubles._ (Dual-flagged.)
6. **`server/src/repositories/maintenanceRepository.ts:43`** — `deleteExpiredDrafts` deletes by `expiresAt < now` with no status guard. Broadcasted/terminal drafts get destroyed. _Audit history loss._

### Auth-token plumbing (1)
7. **`server/src/utils/jwt.ts:242`** — Bare `catch` around `isTokenRevoked()` masks Redis/DB outages as auth failures (401 instead of 5xx). Real revocation events are indistinguishable from infra outages. (Dual-flagged.)

### CI / supply chain (5) — RCE in CI runner with secret access
8. **`.github/workflows/test.yml:371,663`** — PR changed-file output from `classify-test-changes.sh` flows unquoted into a `run:` step. Crafted filename = arbitrary command execution in CI with secrets.
9. **`.github/workflows/release-candidate.yml:130`** — `workflow_dispatch` accepts free-text `ref`, checked out and run against steps holding release secrets. Anyone with dispatch rights points it at arbitrary code.
10. **`.github/workflows/test.yml:958`** — Merge-group required check is an unconditional no-op. If branch protection gates on the job name (not full status), untested PRs merge. _Branch-protection bypass._
11. **`.github/workflows/test.yml:1595`** — Full-scan changes skip coverage and E2E gates entirely. _Bypass of declared quality gates._
12. **`.github/workflows/install-test.yml:236`** — PR install-test E2E lanes report success without running E2E. _Bypass of declared quality gates._

## Top high-impact findings (selected — see per-chunk files for full list)

- **`server/src/utils/redact.ts:140`** (HIGH, dual) — Arrays bypass structured redaction. Tokens/passwords inside `headers[]`, `devices[]`, validation-error arrays land in logs unredacted.
- **`server/src/utils/redact.ts:211`** (HIGH) — `safeError` returns unredacted error messages and stacks.
- **`server/src/utils/async.ts:65`** (HIGH) — `batchProcess(items, fn, 0)` is an infinite event-loop hang. No guard on non-positive batch size.
- **`gateway/src/index.ts:39`** (HIGH) — `trust proxy` never set; `req.ip` collapses to the upstream proxy address. Auth rate limiter (`authRateLimiter`) shares one IP bucket across the entire internet. _Brute-force surface; one client DoSes everyone via 429._
- **`gateway/src/services/backendEvents/index.ts:101`** (HIGH, dual) — `handleEvent(...)` called without `await`/`.catch`. Failed FCM/APNs send or backend error escapes to process-level fatal handler. _Gateway crash._
- **`gateway/src/middleware/mobilePermission.ts:87`** (HIGH) — Fail-open permission gate accepts `{"allowed":"false"}` (truthy string) as permitting wallet-scoped action.
- **`gateway/src/routes/proxyConfig.ts:37-42`** (HIGH) — Proxied user-identity headers (`X-Gateway-User-Id`, etc.) are forwarded without HMAC signature unlike sibling internal calls. _Backend trusts headers based on network isolation alone._
- **`server/src/middleware/auth.ts:97-109`** (HIGH) — `authenticate`'s broad catch returns 401 for *any* error including DB failures during revocation lookup. _Real outages silently log users out and disappear from monitoring._
- **`server/src/middleware/rateLimit.ts:86-95`** (HIGH, dual) — `getClientIp` reads the leftmost `X-Forwarded-For` despite `trust proxy: 1` only trusting the last hop. Rate-limit-bypass via XFF spoofing on login/register/2FA.
- **`server/src/middleware/featureGate.ts:73-90`** (HIGH, dual) — Feature gates fail open to static config on flag-service error. _Flag disabled in DB for security reasons can re-enable itself during any flag-service blip._
- **`server/src/repositories/sessionRepository.ts:143`** (HIGH, dual) — `revokeRefreshToken` swallows every error as log.debug. _Logout appears successful while refresh token stays live._
- **`server/src/repositories/emailVerificationRepository.ts:69`** (HIGH) — One-time verification tokens replayable under concurrent requests; `markUsed` updates by ID without guarding `usedAt: null`.
- **`server/src/api/transactions/broadcastIntent.ts:209`** (HIGH) — Signed PSBT inputs not proven to belong to route wallet before network broadcast. Network side-effect lands before DB mismatch is detected.
- **`server/src/api/node.ts:60-211`** (HIGH, dual) — `/api/v1/node/test` SSRF surface — any authenticated user can probe internal Docker hosts.

## Methodology notes

- **Two-pass independence held.** Claude and Codex caught largely different findings. Codex independently surfaced 3 criticals in `wallets/approvals.ts` + `transactions/broadcastIntent.ts` (Claude found 0 in that chunk) and 5 criticals in `.github/workflows/` (Claude found 0). This is the case study for two-pass auditing — neither pass alone would have caught these.
- **Dual-flags = high signal.** ~28 findings flagged by both reviewers. These are highest-priority triage candidates.
- **Coverage caveat for `api/`.** Claude read 28 + grep-sampled 50 of 175 files; Codex read 66 of 175 deeply. Union coverage ≈80+. Skipped: OpenAPI specs, health, console, intelligence, transfers, most pure-CRUD listings. The 3 criticals all sit inside the read-deep set; an unsampled-route critical would be missed by both passes.
- **Codex sandbox write blocked for 2 chunks.** Middleware and gateway Codex raw files were reconstructed from inline summaries (top findings only; med/low counts are correct but entries aren't enumerated). Treat those merge medium/low totals as a floor.
- **`@sanctuary/shared` workspace shims** in `server/utils/`, `gateway/utils/` are intentional per migration convention and were not flagged.
- **Deferred chunks** for a follow-up run: `server/src/services/` (399 files — includes the Bitcoin domain with `services/bitcoin/` at 141 files), `server/src/worker/`, `server/src/assistant/`, `server/src/agent/`, `server/src/events/`, `server/src/infrastructure/`, `server/src/mcp/`, `server/src/models/`, `server/src/observability/`, `server/src/validation/`, `server/src/websocket/`, `src/` (frontend), `scripts/`, `tests/install/`. Bitcoin services should be the next priority — that's where bugs hurt most.

## Recommended next steps

1. **Triage now.** `/triage tasks/audit-2026-05-12/index.md` → drafts Forgejo issues; default dry-run, so first review the draft.
2. **Phase D follow-up.** Failing non-regression tests for the 7 vitest-addressable critical findings (the 5 workflow criticals need YAML-level fixes / static checks, not vitest). See Phase D notes below.
3. **`/audit --resume`** to cover deferred chunks. **Highest priority: `server/src/services/bitcoin/`** — where the wallet/PSBT/key-handling logic lives. The PSBT bypass critical (#3) likely has siblings in that surface.
4. **Reproduce the dual-flagged findings first** when fixing — those are the most likely to be real bugs (two independent passes agreed).

## Phase D scope

Test-first-then-stop discipline applies. Of the 12 criticals:
- **7 are vitest-addressable** (repositories ×3, api ×3, utils ×1).
- **5 are workflow YAML / CI-runtime** (workflows ×5). Not vitest-testable. Concrete fix-shapes are documented in `06-workflows.md`; remediation is YAML-level patches + a CI-side static check that the patterns don't reappear. Recommend a follow-up `scripts/ci/check-workflow-injection.sh` that fails CI if untrusted GitHub context flows into unquoted `run:` blocks.

### Phase D test inventory (honest accounting after two self-review rounds)

Two rounds of Codex stop-time review pushed back on false-gate risk. After validating each test against (a) what valid fix-shapes would do to the assertion, and (b) whether the test actually runs in any automated context, the final state is:

**Real gates (verified-failing today, will flip red on the documented fix shape): 4**

| Test file | Finding | Why it's a real gate |
|---|---|---|
| `server/tests/unit/repositories/maintenanceRepository.audit.test.ts` | `maintenanceRepository.ts:43` — terminal-draft destruction | Asserts `deleteMany` is called with a `where.status.in` filter AND that filter excludes `'broadcasted'`. Aligned with the existing `draftRepository.deleteExpired` convention (which uses `status: { in: [...ACTIONABLE_DRAFT_STATUSES] }`). Residual risk: a fix using `status.notIn` or `status.not` would false-fail (developer must update the assertion shape). Acceptable. |
| `server/tests/unit/utils/jwt.audit.test.ts` | `jwt.ts:242` — bare-catch flattens infra outages | Mocks `isTokenRevoked` to reject with `Error('redis: connection refused')`; asserts `verifyToken` rejects with a message matching `/redis\|revocation.*unavailable\|outage\|infrastructure/i`. Any valid fix (propagating the original error, wrapping in a custom outage class) will trip the regex and flip `.fails()` red. |
| `server/tests/integration/api/walletApprovalsAudit.test.ts` (vote-IDOR) | `wallets/approvals.ts:59` | End-to-end HTTP test: builds two wallets, posts a cross-wallet vote, asserts 4xx response and no persisted vote row. **Now wired** into the `quick-backend-integration-smoke` job in `test.yml` — runs against a real Postgres service container whenever `backend_integration_changed` is true (changes under `server/src/api/*` or `server/tests/integration/*`, per `classify-files-lib.sh`). All 10 imported test helpers verified present in `server/tests/integration/setup/`. |
| `server/tests/integration/api/walletApprovalsAudit.test.ts` (override-IDOR) | `wallets/approvals.ts:102` | Same file, same wiring. End-to-end test posts an owner-override against another wallet's draft ID; asserts 4xx and that the foreign draft's `approvalStatus` remains `'pending'`. |

**Documented scaffolds (`.todo` only): 3**

| Test file | Finding | Why it's NOT a real gate |
|---|---|---|
| `server/tests/unit/repositories/walletRepository.audit.test.ts` | `walletRepository.ts:316` — signer-as-owner | `.todo` only. The earlier helper-shape `.fails()` was removed in self-review round 2 because the audit's canonical fix-shape (split helpers, switch owner-only call sites to the new helper) leaves the function under test unchanged → permanent false-pass. The proper gate is a call-site integration test (PATCH/DELETE wallet endpoint rejects signer-only user with 403/404). File header has the full spec. |
| `server/tests/unit/repositories/policyRepository.audit.test.ts` | `policyRepository.ts:411` — NULL-distinct unique constraint | `.todo` only. Needs a `withConcurrentDb` integration helper that doesn't exist; fix is primarily a DB migration (`NULLS NOT DISTINCT`), so any code-shape `.fails()` would be a false gate. File header documents the exact fixture spec the next engineer needs. |
| `server/tests/integration/api/broadcastIntentAudit.test.ts` | `broadcastIntent.ts:176` — first-output-only PSBT policy | `.todo` only. Needs a multi-output signed-PSBT fixture builder (bitcoinjs-lib). File header has the exact spec. |

**Removed during self-review (false gates that didn't pin the bug):**

| Removed test | Why it was a false gate |
|---|---|
| `walletRepository.audit` — "REJECTS signer-only access" (dumb-mock variant) | Mocked `prisma.wallet.findFirst` to always return a wallet, then asserted `null`. The mock returned the wallet regardless of where-clause, so the assertion failed both before and after a valid fix. Would never flip red. Documented in the file's self-review history block. |
| `walletRepository.audit` — "issues an owner-only role filter" (deep-equal variant) | `toHaveBeenCalledWith({ ..., role: 'owner' })` deep-equal would flip red ONLY for a literal-string fix. Two other valid fixes leave it as a permanent false gate: `role: { in: ['owner'] }` (deep-equal mismatch) and the audit's canonical split-helpers fix (function unchanged, call sites swap). Documented in the file's self-review history block. |
| `policyRepository.audit` — "uses an atomic upsert" | Asserted `prisma.policyUsageWindow.upsert` was called. The fix shape is primarily a DB migration with no required code change; the test would fail-positive on a migration-only fix and pass-by-accident on an unrelated refactor that introduces `upsert`. Documented in a `NOTE:` block in the file. |

**API integration test CI wiring — DONE.** `tests/integration/api/walletApprovalsAudit.test.ts` was added to the `quick-backend-integration-smoke` job's vitest invocation in `.github/workflows/test.yml`. The job runs whenever `backend_integration_changed` is true (changes under `server/src/api/*` or `server/tests/integration/*`). When the underlying approvals.ts IDOR bugs are fixed, the `.fails()` tests will flip red in CI and the fixer must convert them to regular `test(...)` calls before the PR can merge.

The 39 HIGH findings are intentionally **not** in Phase D for this run. The audit skill's strict reading wants tests for all critical+high; a single-session full-D pass for 51 tests with verification would dilute test quality. Recommend a follow-up run that picks one high-severity chunk at a time and writes tests for that chunk's highs.
