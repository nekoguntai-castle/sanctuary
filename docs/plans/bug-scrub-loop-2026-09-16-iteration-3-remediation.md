# Bug-scrub loop 2026-09-16 — iteration 3 remediation plan

- Iteration: 3 (bug-scrub-loop run `bug-scrub-loop-20260916t1812z-whole-repo`)
- Status: reviewed — converged after eight recursive review passes by two independent reviewers each (see Review notes); implementation starts with Phase 1
- Source target-branch SHA: `b43ea0cb932f1cae450a06fba87edb61baaee443` (main after PR #1213; push runs for the code merges `4068fc9d`, `a2024c29` green, `bf3616d9` and `b43ea0cb` in progress at planning time — re-check before implementation)
- Scope: whole repository (locked at run start)
- Iteration-2 outcome: all five blocking findings merged (#1208–#1212) with verified target-branch CI; the iteration-3 rescrub (four read-only shards plus coordinator re-verification, coverage manifest sealed for all eight domains) found none of the twelve resolved findings recurring.
- Blocking finding (coordinator-reconfirmed at source; one P2):
  `mcp-audit-log-unbounded-operation-string-preauth`.
- P3 backlog recorded this iteration (outside the blocking fix set, not planned here): `mcp-anonymous-audit-row-flood-no-preauth-throttle` (every anonymous `/mcp` request still writes one bounded audit row; a pre-auth per-IP limiter for the MCP app is a rate-limit policy decision, not part of this fix), `audit-clientinfo-ip-useragent-unbounded-text` (`getClientInfo` copies `x-forwarded-for`/`user-agent` into unbounded `AuditLog` text columns for every caller, capped only by Node's header limit), `mcp-protocol-version-header-echoed-into-audit-errormsg` (`validateProtocolHeader` embeds the raw header value in the error message that reaches `AuditLog.errorMsg` and the warn line), plus the 135 P3 items carried from earlier iterations and the previous run.

## Goal, non-goals, assumptions

Goal: bound the MCP operation string once, at the point it is derived from the unauthenticated request body, so that this field of the audit row, the warn log line and the metrics label can never carry a caller-sized payload — with a failing regression test first, in one independently mergeable server phase, no schema change, no migration, no new endpoint. `ipAddress`, `userAgent` and the protocol-version error message on this same path remain unbounded by application code (capped only by Node's default 16 KiB header block) and are recorded as the two sibling P3 backlog items above, outside this phase.

Non-goals: adding a pre-auth rate limiter or IP throttle to the MCP app (tracked as the P3 above); changing which requests are audited (anonymous failures stay audited — that is the forensic requirement); changing the Prometheus label values chosen by `metricOperationLabel` in `server/src/mcp/metrics.ts` (they stay as delivered by #1211; a truncated name simply falls into its `*:other` bucket); truncating `AuditLog.details` generically inside `auditService.log` (other callers pass server-derived, already-bounded details; a blanket cap there would be speculative hardening with its own test surface); changing the SDK's 100KB JSON body limit. This phase also does not bound `ipAddress` or `userAgent` (both read via `getClientInfo`, `server/src/services/auditService.ts:197-208`, for every `auditService.log` caller app-wide) or `errorMsg` populated from `validateProtocolHeader`'s message (`server/src/mcp/transport.ts:59` embeds the raw `mcp-protocol-version` header) — all three are caller-controlled, reach the same pre-auth audit row and warn line as `operation`, sit outside `details`, and are tracked as separate backlog items rather than folded into this fix.

Reversal note: the iteration-2 plan listed "bounding MCP audit-row strings" as a non-goal on forensics grounds. The iteration-3 rescrub showed that argument only holds for registered names, which are short; an anonymous caller can make the "exact requested name" ~100KB per request with no throttle. Bounding by length (not by allowlist) keeps the forensic value for every realistic name while closing the storage path.

Assumptions: repository rules apply — tests first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit` at 100% branches; lizard warning count must not exceed main's (`npm run quality:lizard`); `node scripts/quality/check-large-files.mjs`; `npm run check:architecture-boundaries`; `npm run arch:check` from the primary checkout before pushing (this phase adds no import edge — confirm anyway because the Architecture lane is not PR-required and only fails on main); server `npx tsc --noEmit && npm run typecheck:tests`; `git diff --check`. `server/src/mcp/transport.ts` appears in none of `config/wallet-safety-mutation-map.json`, `config/wallet-sync-mutation-boundaries.json`, `config/resource-lifecycle-callsites.json` (`rg -n 'mcp/transport' config/` is empty at `b43ea0cb` — re-run before editing). No new `server/tests/integration` spec is planned. Only one `vitest --coverage` run at a time on the host; never commit while one is active.

## Phase 1 — the MCP operation string is bounded before it reaches audit, logs and metrics (server, P2)

Finding: `mcp-audit-log-unbounded-operation-string-preauth`.

Evidence: `server/src/mcp/transport.ts:63-90` `classifyMcpOperation` returns `` `tool:${params.name}` `` (`:77`), `` `resource:${new URL(params.uri).protocol}` `` (`:81` — a URL scheme can also be arbitrarily long), `` `prompt:${params.name}` `` (`:87`) or the raw `method` (`:89`) with no length bound. `:118` computes `operation` before `:126` `authenticateMcpRequest`; on the 401 path `:161` `log.warn('MCP request failed', { operation, ... })` and `:171` `auditMcpOperation(req, null, operation, false, message)` still run. `:92-115` passes `details: { operation, keyId, keyPrefix }` unmodified to `auditService.log`, which writes `input.details` straight into the `AuditLog.details` Json column (`server/src/services/auditService.ts:218-225`; no truncation; `server/src/utils/logger.ts` has none either). `:190-212` `createMcpHttpApp` mounts `POST /mcp` behind only the SDK's default `express.json()` (100KB) and no IP-level limiter; the limiters in `server/src/index.ts:116,128` belong to the main API app. `rateLimitService.consume('mcp:default', context.keyId)` (`:127`) runs only after successful authentication. Result: an anonymous client can write a ~100KB audit row plus a ~100KB warn line per request, at line rate. Exposure context (does not change the fix): `server/src/mcp-entry.ts` starts a bare `http.createServer` for the MCP app, `docker/nginx/nginx.conf` has no `mcp` location, and `docker-compose.yml` publishes the MCP port on `127.0.0.1` by default, so reaching `/mcp` anonymously needs loopback access or a non-default `MCP_BIND_ADDRESS`; the 29 other `auditService.log` callers pass server-derived or schema-bounded strings (e.g. the failed-login `username` is capped by `LoginSchema` `.max(50)`, `server/src/api/schemas/auth.ts:53-58`), so no generic cap in `auditService.log` is warranted. `server/tests/unit/mcp/transport.test.ts` asserts `auditService.log` is called (`:181,292,339`) but never bounds `details.operation`; `metrics.test.ts` covers only the label function. #1211 (`server/src/mcp/metrics.ts:45-61`) bounded the Prometheus label only.

Contract (all in `server/src/mcp/transport.ts`):
1. Add `const MAX_OPERATION_LENGTH = 128;` and a `boundOperation(operation: string): string` that counts and cuts in Unicode code points, not UTF-16 code units: `const chars = Array.from(operation); return chars.length <= MAX_OPERATION_LENGTH ? operation : `${chars.slice(0, MAX_OPERATION_LENGTH).join('')}…`;`. A naive `String.prototype.slice(0, 128)` can split a surrogate pair and yield a lone surrogate; `JSON.stringify` escapes it as `\ud83d`, PostgreSQL rejects an unpaired surrogate escape in a `Json` column, and `auditService.log` swallows its own write errors (`server/src/services/auditService.ts:239-242`) — so the attacker path this fix targets would silently lose the audit row instead. The visible `…` marker tells a forensic reader the name was cut; the result is at most 129 code points and always well-formed. Add a one-line comment above `classifyMcpOperation` stating that it does not bound its output and that `boundOperation` must wrap every call.
2. `:118` becomes `const operation = boundOperation(classifyMcpOperation(req.body));` so the single `operation` value that flows to `log.warn` (`:161`), `auditMcpOperation` (`:138,:154,:171,:180`) and `recordMcpRequest` (`:186`) is bounded at its source. `classifyMcpOperation` itself is unchanged.
3. Registered names pass through untouched: every registered tool name (`assistantReadToolRegistry.list()` in `server/src/assistant/tools`) and prompt name (`server/src/mcp/promptNames.ts`) is far shorter than 128 characters — the implementer verifies with `rg -on "name: '[A-Za-z0-9_-]+'" server/src/assistant/tools server/src/mcp/promptNames.ts | awk -F"'" '{ if (length($2) > 64) print }'` (expected empty) and records the longest length in the PR description. `metricOperationLabel` needs no change: a truncated `tool:`/`prompt:` name is not registered and already maps to `tool:other`/`prompt:other`; a truncated `resource:` scheme maps to `resource:other`; a truncated raw method maps to `other`.

Failing tests first (red against `origin/main`) in `server/tests/unit/mcp/transport.test.ts` — the file already hoists `mocks.auditLog`, `mocks.recordMcpRequest` and `mocks.authenticateMcpRequest` (`:7,:59-71,:77-79,:92-100`) and uses `mocks.authenticateMcpRequest.mockRejectedValueOnce(new McpUnauthorizedError(...))` for the 401 path (`:223-239`). Each new case sets `.set('mcp-protocol-version', '2025-11-25')` and arranges `mocks.authenticateMcpRequest.mockRejectedValueOnce(new McpUnauthorizedError('bad token'))` first, because the `beforeEach` at `:123` authenticates every request by default. `server/tests/setup.ts:23-31` already mocks `../src/utils/logger` globally with inert spies; add a file-local `vi.mock('../../../src/utils/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.logWarn, error: vi.fn() }) }))` with `logWarn: vi.fn()` inside the existing `vi.hoisted` block (`:1-22`) purely to obtain an assertable handle on the warn call. Lizard needs no special handling in this file (the pinned config `-C 15 -T nloc=200` already counts its 44 functions separately with zero warnings; largest NLOC 23). New cases go inside the existing top-level `describe('MCP HTTP transport')`:
1. Unauthenticated `tools/call` with `params.name = 'x'.repeat(5000)` → 401; `mocks.auditLog` was called with `expect.objectContaining({ success: false, details: expect.objectContaining({ operation: expect.any(String) }) })` and the captured `details.operation` has `Array.from(op).length <= 129`, starts with `tool:x` and ends with `…`; `mocks.recordMcpRequest` was called with that same bounded string; `mocks.logWarn` was called with `'MCP request failed'` and an object whose `operation` equals that same bounded string (today all three receive the 5005-character raw string).
2. Unauthenticated `resources/read` with `params.uri = `${'a'.repeat(5000)}://x`` (a 5000-character scheme parses in Node's WHATWG URL) → the audited `details.operation` starts with `resource:a` and has at most 129 code points (today ~5010 characters).
3. Unauthenticated `tools/call` with `params.name = `${'x'.repeat(122)}😀😀😀😀`` — `tool:` + 122 `x` is 127 code units and 127 code points, so the first emoji is code point 128 but occupies code units 128–129: code-unit `slice(0, 128)` splits the first emoji and leaves a lone `\ud83d`, whereas the code-point cut keeps it whole and drops the remaining three → the audited `details.operation` ends with `😀…` and round-trips unchanged through UTF-8: `expect(Buffer.from(op, 'utf8').toString('utf8')).toBe(op)` (a lone surrogate becomes U+FFFD on the round trip, so this fails for code-unit slicing; `String.prototype.isWellFormed` is not usable because `npm run typecheck:tests` resolves `server/tsconfig.test.full.json` → `tsconfig.test.json` with `lib: ["ES2023"]`). Red on main via the `…` assertion; the round-trip assertion guards the fix against regressing to code-unit slicing.
4. Control (already present, no change): the success-path test at `:318-345` asserts `details.operation` is exactly `'tool:query_transactions'` (`:342-347`), and the `:223-239` case asserts `'prompt:wallet_health'` verbatim — registered names are never marked or cut.

Verification — from `server/`: `npx tsc --noEmit && npm run typecheck:tests && npm run lint`, `npx vitest run tests/unit/mcp`, the repository's full backend gate `npx vitest run` (unscoped; `server/vitest.config.ts` collects `tests/integration/**` too, but every integration spec sits behind `canRunIntegrationTests()` → `describe.skip` unless `DATABASE_URL`/`TEST_DATABASE_URL` is set at all (`tests/integration/setup/testDatabase.ts:20-22`; the host allow-list from `scripts/ci/integration-db-guard.mjs` is a separate check that throws inside `setupTestDatabase()`, `:43`), and the `./start.sh` stack does not publish Postgres to the host (`docker-compose.yml:166` is commented out) — so this run exercises `tests/unit` plus DB-independent specs only; this phase touches no repository or database code, so the separate `npm run test:integration:db` (`scripts/run-integration-tests.sh`, which stands up `docker/compose/test.yml` and exports `TEST_DATABASE_URL`) is not required), `npx vitest run --coverage tests/unit` (both branches of `boundOperation` are exercised: the cut branch by tests 1–3, the pass-through branch by the pre-existing `:318-345` and `:223-239` cases). From the root: `npm run check:architecture-boundaries`, `node scripts/quality/check-large-files.mjs`, `npm run quality:lizard` (count must equal main's), `npm run arch:check` (primary checkout; expect no generated-graph diff), `git diff --check`.

Rollback: revert the single commit; no data or schema impact (existing oversized rows, if any, are unaffected either way).

Acceptance: the three new tests pass and are demonstrably red on `origin/main` (tests 1–2 on length, test 3 on the `…` marker); all pre-existing transport and metrics tests pass unchanged with the added logger mock; coverage holds at 100% branches (both branches of `boundOperation` are exercised: tests 1–3 cut, the existing `:318-345` and `:223-239` cases pass through); lizard count equals main's; only `server/src/mcp/transport.ts` and `server/tests/unit/mcp/transport.test.ts` change.

## Completion criteria

The finding is resolved in run state with a target-CI-verified attempt record; the three P3 backlog items above are recorded as `backlog`, not fixed; a fresh full scrub (iteration 4) of the resulting main SHA finds zero P0–P2.

## Delivery

One PR on `codex/bug-scrub/it3-mcp-audit-operation-bound`, serial merge on `main`; the plan lands first as a docs-only PR (`codex/bug-scrub/it3-plan`); the phase PR appends its delivery row; target-branch CI verified after the merge (including the non-required Architecture lane); the branch is deleted only after the merge-commit ancestry gate. No container rebuild until the loop's clean pass (`--deploy final`; nested `rebuild_policy: defer`).

## Delivery record

| Phase | PR | Merge commit | Notes |
| --- | --- | --- | --- |

## Review notes (pass 1)

Accepted (evidence-backed, applied):
- Contract: `String.prototype.slice(0, 128)` cuts on UTF-16 code units and can emit a lone surrogate; verified that `JSON.stringify` escapes it and PostgreSQL rejects the unpaired escape in a `Json` column while `auditService.log` swallows write errors (`auditService.ts:239-242`) — the fix as first written could make the attacker path drop the audit row entirely. Rewrote `boundOperation` to count and cut in code points and added test 3 with an `isWellFormed()` assertion.
- Tests: the lizard hedge ("keep or add a nested `function`") was unsupported for `transport.test.ts` — the pinned lizard config already counts its 44 functions separately with zero warnings (largest NLOC 23). Removed it to avoid diff creep.
- Tests: the planned "control" assertion already exists verbatim at `transport.test.ts:342-347`; restated it as an existing guarantee rather than a change.
- Tests: nothing pinned the `log.warn` copy of `operation`; added a logger mock and an assertion in test 1 so a future move of the bound to only the audit call would fail the suite.
- Source: added a one-line comment above `classifyMcpOperation` that it does not bound its own output (it is unexported with one call site today).
- Evidence: added the exposure context (loopback-only default port publish, no nginx `mcp` location, bare `http.createServer` in `mcp-entry.ts`) and the `auditService.log` caller enumeration that supports the "no generic cap" non-goal.

Rejected / non-actionable (checked, not applied):
- Bounding inside each `return` of `classifyMcpOperation` instead of at the call site: equivalent safety today (unexported, single call site at `transport.ts:118`), larger diff; the added comment covers the future-caller risk.
- The 5000-character URL scheme was suspected to throw in `new URL()`; verified it parses, so test 2's `resource:a…` expectation stands.
- Whether `…` (U+2026) is safe in the three sinks: it never reaches a Prometheus label (`metricOperationLabel` maps cut names to `*:other`), is valid JSON content, and passes the logger sanitizer unchanged — no change.
- Whether the P3 `mcp-anonymous-audit-row-flood-no-preauth-throttle` should be P2: with the row size closed by this phase and the default loopback-only publish, P3 stands; revisit if a supported deployment exposes MCP beyond loopback.
- Config inventories and dependency-cruiser rules: none reference `mcp/transport`; verification list matches the repo's server-change checklist.

## Review notes (pass 2)

Accepted (evidence-backed, applied):
- Test 3 used `op.isWellFormed()`, which is declared only in `lib.es2024.string.d.ts`; `npm run typecheck:tests` resolves `server/tsconfig.test.full.json` → `tsconfig.test.json` with `lib: ["ES2023"]`, so the test would not compile in the required Full Backend Typecheck lane. Replaced with a UTF-8 round-trip assertion, verified at runtime to distinguish a lone-surrogate cut from a well-formed one.
- Test 3's arithmetic said the *second* emoji straddles the cut; direct computation shows code-unit `slice(0, 128)` splits the *first* emoji (units 128–129). Corrected the wording so it matches contract item 1's `\ud83d` claim.
- `server/tests/setup.ts:23-31` already mocks the logger globally; restated the file-local mock as the way to obtain an assertable `mocks.logWarn` handle inside the hoisted block, not as first-time mocking.
- Tests 1–3 now state the protocol header and the `mockRejectedValueOnce(new McpUnauthorizedError(...))` arrangement explicitly, since the `beforeEach` at `:123` authenticates every request by default.

Rejected / non-actionable (checked, not applied):
- Whether `resources/read` bodies need `id`/`jsonrpc` to reach classification: no — `classifyMcpOperation` runs on any body at `transport.ts:118` before auth.
- Lizard on `transport.ts` after the change: simulated diff gives 14 functions, 0 warnings; no plan text needed.
- ESLint: no rule in `config/tooling/eslint.config.js` objects to a non-ASCII `…` literal.
- Coverage: the single ternary in `boundOperation` has both branches covered by tests 1–3 and the existing pass-through cases; `Array.from('')` and the fixed `'unknown'`/`'batch'` returns are trivially short.
- All cited line numbers, the exposure-context claims (`mcp-entry.ts`, `nginx.conf`, `docker-compose.yml:494` `MCP_BIND_ADDRESS:-127.0.0.1`), the `auth.ts:53-58` username cap, and the verification-command names were re-verified and stand.

## Review notes (pass 3)

Accepted (evidence-backed, applied):
- Goal and non-goals overstated what the fix closes: on the identical pre-auth path `ipAddress`/`userAgent` (`getClientInfo`, `auditService.ts:197-208`, unbounded `text` columns at `schema.prisma:1087-1088`) and `errorMsg` from `validateProtocolHeader`'s message (`transport.ts:59` embeds the raw header) still carry caller strings into the same row and warn line. Reworded both sections to scope the claim to the `operation` field and recorded the two siblings as P3 backlog (`audit-clientinfo-ip-useragent-unbounded-text`, `mcp-protocol-version-header-echoed-into-audit-errormsg`) — P3 because Node's default 16 KiB header block caps them and MCP publishes on loopback by default.
- Verification said both `boundOperation` branches are covered "by tests 1 and 3", but tests 1–3 are all over-limit inputs; the pass-through branch is covered by the pre-existing `:318-345`/`:223-239` cases, as Acceptance already said. Made the two sentences consistent.

Rejected / non-actionable (checked, not applied):
- Re-verified by direct computation: the code-point cut of `tool:` + 122 `x` + 4 emoji yields 129 code points ending `😀…` and round-trips through UTF-8, while the code-unit slice does not; raw lengths on main are exactly 5005 and 5010 characters.
- The `batch` (`Array.isArray`) and non-object body paths return fixed short strings; no other caller input reaches `details` besides `operation`.
- Longest registered name is 29 characters (`get_admin_operational_summary`); no registered name is ever cut.
- The hoisted-mock, `beforeEach :123`, `setup.ts:23-31` override semantics and every cited line number were re-verified and stand.

## Review notes (pass 4)

Accepted (evidence-backed, applied):
- Test 3 still said `npm run typecheck:tests` resolves `server/tsconfig.test.json` directly, contradicting the pass-2 note; corrected to `tsconfig.test.full.json` → `tsconfig.test.json`.
- Completion criteria said "the P3 backlog item" after pass 3 had added two more; corrected to the three items.

Rejected / non-actionable (checked, not applied):
- Implementation dry-run: the exact `boundOperation`, comment, line-118 change and the three `it` blocks were rendered and executed with `node -e`; every stated output (lengths, `tool:x…`/`resource:a…` prefixes, `😀…` ending, UTF-8 round-trip pass for the fix and fail for the naive slice) reproduced exactly.
- `Array.from(operation)` and an unimported `Buffer` typecheck under the project's `tsconfig.test.full.json` (`@types/node` present); the logger mock covers every member `transport.ts` calls (`warn`, `error`).
- ESLint rules scope to production source and none target non-ASCII literals; lizard's `-i` baseline is a ceiling, consistent with "must not exceed"; `transport.test.ts` at ~405 lines plus ~70 stays under the 800-line large-file warning.
- Delivery process (branch naming, docs-first plan PR, ancestry gate) matches the iteration-2 plan; rollback line accurate.

## Review notes (pass 5)

Accepted (evidence-backed, applied):
- Verification omitted the repository's unscoped backend gate `npx vitest run` (CLAUDE.md; distinct from the coverage run scoped to `tests/unit`, since `server/vitest.config.ts` includes `tests/**`). Added it.
- `server/tests/setup.ts:23-30` excluded the logger mock's closing line; corrected to `:23-31` everywhere.

Rejected / non-actionable (checked, not applied):
- Freshness: `origin/main` is still `b43ea0cb`; `bf3616d9` and `b43ea0cb` push batches have since completed green, so the header's re-check instruction is satisfied rather than stale.
- `git diff --stat origin/main..HEAD` on the plan branch shows only this file; no drift under `server/src/mcp`, `auditService.ts`, `server/tests/unit/mcp`, `server/tests/setup.ts`, `server/tsconfig*.json`, `config/tooling`, `scripts/quality.sh`.
- Finding and backlog ids are spelled identically in every section; the Delivery record header is present and empty.
- Over a dozen further file:line claims and both math-heavy test claims were re-reproduced (`node -e`) and stand; no cross-section contradiction remains.

## Review notes (pass 6)

Accepted (evidence-backed, applied):
- The unscoped `npx vitest run` sentence claimed it ran `tests/integration` "against the running local stack". Every integration spec is gated by `canRunIntegrationTests()` (`tests/integration/setup/testDatabase.ts:19-21`) → `describe.skip` without `DATABASE_URL`/`TEST_DATABASE_URL`, and the `./start.sh` stack does not publish Postgres to the host (`docker-compose.yml:166`); the real mechanism is `npm run test:integration:db`. Corrected the sentence and stated that this phase does not need the integration layer.

Rejected / non-actionable (checked, not applied):
- Both pass-5 edits verified applied and consistent (`setup.ts:23-31` in all three places; unscoped run present).
- 20+ body citations re-verified byte-accurate at `777aa61d`; every named npm script and script path resolves; the three `it` descriptions state arrangement, input and assertions unambiguously; "twelve resolved findings" = 7 (iteration 1) + 5 (iteration 2), correctly excluding the interposed #1198/#1206 fixes.

## Review notes (pass 7)

Accepted (evidence-backed, applied):
- The pass-6 sentence conflated two gates: `canRunIntegrationTests()` skips purely on whether `DATABASE_URL`/`TEST_DATABASE_URL` is set (`testDatabase.ts:20-22`); the host allow-list from `scripts/ci/integration-db-guard.mjs` is a separate check that throws inside `setupTestDatabase()` (`:43`). Reworded the mechanism; the conclusion (this phase needs no integration layer) is unchanged.

Rejected / non-actionable (checked, not applied):
- Every Phase 1 citation re-verified byte-accurate at `2c154a13`; the PR-description requirement lives in Contract item 3 and the Delivery section does not contradict it; the "only two files change" acceptance is consistent with the Assumptions (no inventory reference, no expected `arch:check` diff).
- Remaining implementer choices (declaration style and insertion line of `boundOperation`, ordering of the new `vi.mock`) compile, lint and pass identically under any reasonable option; not gate-affecting.

## Review notes (pass 8)

Converged: two independent reviewers found zero verified actionable comments. One re-verified the pass-7 clause (`testDatabase.ts:20-22`, `:43`, `integration-db-guard.mjs`) and every Phase 1 citation; the other audited all seven Review notes sections against source (14 citations, the lizard output, the string/code-point arithmetic, the 29-character longest name, and the twelve-finding count), all exact. Considered and rejected: `transport.test.ts:342-347` runs two lines past the assertion into the next test's declaration — a citation-range imprecision, not a factual error.
