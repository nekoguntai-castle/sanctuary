# Software Quality Report

Date: 2026-04-27
Owner: TBD
Status: Current

**Overall Score**: 92/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 816ced3e

Current post-AI/MCP/Console-release score. The application remains in A territory with no hard-fail blockers: tests, lint, typecheck, coverage, audits, and gitleaks are green. The score drops from the previous 97/100 report because the current full lizard scan reports 65 threshold warnings over `CCN > 15`, which removes the complexity margin.

---

## Hard-Fail Blockers

None.

Full working-tree, tracked-tree, and latest-commit gitleaks scans report 0 findings. Dependency audits report 0 high/critical vulnerabilities. Tests, lint, typecheck, and app/backend/gateway coverage gates pass.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Frontend tests, backend tests, gateway tests, lint, and typecheck pass; suppression density remains low relative to repo size. |
| Reliability | 15/15 | Validation, typed error handling, request timeout, retry, and fail-closed rate-limit paths are present at HTTP and service boundaries. |
| Maintainability | 7/15 | Duplication remains low and architecture boundaries are clear, but the current full lizard scan reports 65 complexity warnings and the largest scanned fixture remains 2,118 lines. |
| Security | 15/15 | Gitleaks scans are clean; root/server/gateway/ai-proxy audits have 0 high/critical findings; MCP keys use hashed lookup, revocation, expiration, scoped wallets, and admin-only issuance. |
| Performance | 10/10 | Sampled hot paths use async I/O, bounded request timeouts, rate limiting, database grouping/windowing, and explicit tool-call limits. |
| Test Quality | 15/15 | App/backend/gateway coverage all report 100%, with broad edge, error, auth, rate-limit, MCP, Console, and API contract coverage. |
| Operational Readiness | 10/10 | Docker/Compose, CI workflows, health endpoints, observability hooks, request IDs, and redacted contextual logging are present. |
| **TOTAL** | **92/100** | No hard-fail cap applies. |

---

## Trend

- vs previous full report on 2026-04-25 (`1af2fe0d`): overall `-5` (`97 -> 92`), grade `A -> A`, confidence `High -> High`.
- The movement is entirely maintainability: `lizard_warning_count` moved from `0` to `65`, and Maintainability moved from `12/15` to `7/15`.
- The largest-file signal is unchanged at 2,118 lines for the verified address vector fixtures.
- Coverage grew with the AI/MCP/Console work: app coverage now reports 422 files / 5,712 tests, backend 417 passed files / 9,408 passed tests, and gateway 21 files / 528 tests.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 422 files / 5,712 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` | Correctness 1.1 -> +6 |
| lint | pass | `npm run lint` via grade collector | Correctness 1.3 -> +3 |
| typecheck | pass | native TypeScript checks via grade collector | Correctness 1.2 -> +4 |
| coverage | 100%; app 422 files / 5,712 tests, backend 417 passed files / 9,408 passed tests with 22 skipped files / 505 skipped tests, gateway 21 files / 528 tests | `npm run test:coverage`, `npm run test:backend:coverage`, `npm --prefix gateway run test:coverage` | Test Quality 6.1 -> +5 |
| security_high | 0 | `npm audit --audit-level=high`; package-specific audits also clean | Security 4.1 -> +5 |
| root_audit_low | 16 | `npm audit --audit-level=high` | Context only; low severity does not affect 4.1 |
| server_audit_total | 0 | `npm --prefix server audit --audit-level=high` | Security context |
| gateway_audit_total | 0 | `npm --prefix gateway audit --audit-level=high` | Security context |
| ai_proxy_audit_total | 0 | `npm --prefix ai-proxy audit --audit-level=high` | Security context |
| secrets | 0 | `/tmp/gitleaks detect --source . --no-git --redact --config .gitleaks.toml` | Security 4.2 -> +4 |
| latest_commit_secrets | 0 | `/tmp/gitleaks git . --config .gitleaks.toml --redact --log-opts -1` | Context: committed HEAD clean |
| tracked_tree_secrets | 0 | `GITLEAKS_BIN=/tmp/gitleaks bash scripts/gitleaks-tracked-tree.sh` | Context: tracked tree clean |
| lizard_warning_count | 65 | `PYTHONPATH=/tmp/sanctuary-lizard-local python3 /tmp/sanctuary-lizard-local/bin/lizard -w -C 15 .` | Maintainability 3.1 -> +0 |
| lizard_avg_ccn | 1.4 | lizard summary from the same full scan without `-w` | Maintainability context |
| lizard_threshold_status | 65 warnings over `CCN > 15` | lizard full scan | Maintainability context |
| duplication_pct | 2.24% | `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade-20260427 .` | Maintainability 3.2 -> +3 |
| duplication_clones | 290 exact clones | jscpd JSON report | Maintainability context |
| largest_file_lines | 2,118 | `wc -l server/tests/fixtures/verified-address-vectors.ts scripts/verify-addresses/output/verified-vectors.ts` | Maintainability 3.3 -> +0 |
| suppression_count | 24 | grade heuristic | Correctness 1.4 judged |
| validation_lib_present | 1 | grade heuristic plus middleware inspection | Security 4.3 judged |
| timeout_retry_count | 1,257 | grade heuristic | Reliability/performance context |
| blocking_io_count | 46 | grade heuristic | Reliability/performance context |
| observability_lib_present | 1 | grade heuristic plus logger/tracing inspection | Operational 7.3 -> +2 |
| logging_call_count | 328 | grade heuristic | Operational 7.4 judged |
| health_endpoint_count | 181 | grade heuristic | Operational 7.2 -> +2 |
| deploy_artifact_count | 2 | Docker/Compose plus GitHub CI | Operational 7.1 -> +3 |
| test_file_count | 1,257 | grade heuristic | Test Quality context |
| test_sleep_count | 10 | grade heuristic | Test Quality 6.4 judged |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=24` remains low for 3,313 scanned files and is concentrated in tests, compatibility checks, or documented guardrails.
- **[1.5] Functional completeness - High -> +3**: the app, backend, gateway, MCP, Console, OpenAPI, route validation, and auth-contract surfaces have executable tests and coverage gates.
- **[2.1] Error handling quality - High -> +6**: `server/src/middleware/validate.ts`, `server/src/errors/errorHandler.ts`, and `src/api/client.ts` use structured validation, Prisma/API error mapping, request IDs, typed client errors, and JSON error envelopes.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/middleware/rateLimit.ts`, and gateway rate-limiters provide bounded request time, retry/backoff, retry-after headers, and fail-closed limiter behavior.
- **[2.3] Crash-prone paths - High -> +5**: production failures are generally typed/domain errors surfaced through route/service boundaries; direct process exits are concentrated in scripts and utility wrappers.
- **[3.1] Complexity - Low -> +0**: 65 lizard warnings now exceed the threshold, with the largest production warnings in `server/src/config/index.ts:getConfig` (`CCN 100`), `services/hardwareWallet/adapters/trezor/signPsbt.ts:signPsbtWithTrezor` (`CCN 76`), `server/src/services/draftService.ts:createDraft` (`CCN 52`), `server/src/api/admin/nodeConfigData.ts:buildNodeConfigData` (`CCN 48`), and `server/src/services/bitcoin/nodeClient.ts:getDefaultElectrumConfig` (`CCN 46`).
- **[3.4] Architecture clarity - High -> +3**: the shared assistant read-tool registry keeps MCP and Console on one typed read-only execution surface, and admin MCP access is isolated behind admin routes and service helpers.
- **[3.5] Readability/naming - Medium -> +1**: naming and module boundaries are generally strong, but the flagged complexity clusters make several wallet-signing, PSBT, sync, UI, and animation paths expensive review surfaces.
- **[4.3] Input validation quality - High -> +3**: Zod middleware validates body, params, and query; Console routes validate prompt/session/history payloads; admin MCP routes validate key creation and key-id params.
- **[4.4] Safe system/API usage - High -> +3**: MCP bearer tokens are format-checked, hashed for lookup, compared timing-safely, revocable, expirable, and wallet-scoped in `server/src/mcp/auth.ts`; admin MCP routes return full tokens only once.
- **[5.1] Hot-path efficiency - High -> +5**: Console tool planning caps tool calls per turn, MCP access updates last-used metadata on a stale throttle, and request-facing paths are asynchronous.
- **[5.2] Data access patterns - High -> +3**: `server/src/repositories/agentDashboardRepository.ts` uses database grouping, windowed recent-row queries, and `Promise.all` instead of per-agent fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: `blocking_io_count=46` is concentrated in scripts, setup, maintenance, support-package, and test paths rather than ordinary request handlers.
- **[6.2] Test structure - High -> +4**: tests are organized by API, service, repository, integration flow, gateway middleware, UI behavior, assistant/MCP, Console, contract, and branch coverage surfaces.
- **[6.3] Edge cases covered - High -> +3**: sampled tests cover invalid schemas, empty/default branches, auth expiry, rate-limit boundaries, timeout behavior, wallet/device access, prompt history replay/delete/expiration, MCP auth, and backup/restore error paths.
- **[6.4] No flaky patterns - High -> +3**: direct sleep evidence remains low, and timer-sensitive tests predominantly use fake timers or explicit timer spies.
- **[7.4] Logging quality - High -> +3**: `server/src/utils/logger.ts` adds request/trace context, sanitizes log text, and calls `server/src/utils/redact.ts` for sensitive field redaction.

### Missing

- None. The grade collector did not auto-detect the repo coverage scripts and hit sandbox DNS for native `npm audit`; explicit coverage and approved audit commands superseded those collector gaps.

---

## Top Risks

1. **Complexity debt is the main regression.** There are 65 current lizard warnings across hardware signing, PSBT construction/finalization, sync confirmation enrichment, node/electrum config, draft creation, admin node config, UI components, animations, and test harnesses.
2. **Large vector fixtures still zero out file-size points.** `server/tests/fixtures/verified-address-vectors.ts` and `scripts/verify-addresses/output/verified-vectors.ts` are both 2,118 lines.
3. **Root audit still has 16 low-severity advisories.** There are no high/critical vulnerabilities, but the upstream wallet/polyfill dependency path should stay on the triage radar.

## Fastest Improvements

1. **Run a complexity-reduction batch on the highest production CCN paths**: split config parsing, Trezor/BitBox signing, draft creation/update, node/electrum config, PSBT input enrichment, and admin node-config shaping into named helpers with focused tests. This is the fastest path back toward 97/100.
2. **Classify or shard generated/vector fixtures only if review cost justifies it**: this can recover up to 2 maintainability points, but it should not weaken address-vector coverage.
3. **Keep low audit advisories triaged without forced downgrades**: avoid hardware-wallet or polyfill downgrades unless regression coverage proves the migration is safe.

## Roadmap To Restore 97/100

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| M1 | Restore complexity margin | Reduce full-scan lizard warnings from 65 to 15 or fewer, prioritizing production config, signing, draft, PSBT, electrum/node, and UI hotspots. | `lizard -w -C 15 .` reports 15 or fewer warnings. | `+2` to `+4` maintainability depending on warning count |
| M2 | Eliminate threshold warnings | Continue helper extraction until full-scan lizard reports 0 warnings. | `lizard -w -C 15 .` passes with no warnings. | up to `+5` maintainability |
| M3 | Revisit vector fixture size | Keep current fixtures if they are intentionally generated; otherwise shard or generate them on demand. | Largest scanned source drops below 1,000 or is explicitly excluded/classified by project policy. | up to `+2` maintainability |

## Strengths To Preserve

- 100% app/backend/gateway coverage gates with broad edge-case coverage.
- Zod validation, CSRF-aware browser client behavior, OpenAPI route coverage, and auth-contract checks at trust boundaries.
- Shared assistant read-tool registry used by both MCP and Console, with typed envelopes, scoped access, redaction metadata, provenance, and tool budgets.
- Exposure-aware rate limiting, request timeouts, health endpoints, tracing support, and contextual redacted logging.

## Work To Defer Or Avoid

- Do not weaken the verified address vector tests just to chase file-size points.
- Do not downgrade wallet, Ledger, Trezor, or polyfill packages just to silence low-severity audit output without hardware-flow regression proof.
- Do not suppress lizard broadly; reduce complexity in the highest-risk production paths first and keep test-harness cleanup secondary.

## Verification Notes

- `git status --short --branch` before grade edits - `## main...origin/main`.
- `git branch --format='%(refname:short)'` after cleanup - only `main`.
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh prev sanctuary_ full` - previous comparable entry loaded: 2026-04-25, `1af2fe0d`, 97/100, A.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - tests/lint/typecheck passed; collector coverage/audit gaps superseded by explicit commands.
- `npm run test:coverage` - 422 files, 5,712 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` - 417 passed files, 9,408 passed tests, 22 skipped files, 505 skipped tests, 100% statements/branches/functions/lines.
- `npm --prefix gateway run test:coverage` - 21 files, 528 tests, 100% statements/branches/functions/lines.
- `/tmp/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner` - no leaks found.
- `/tmp/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` - no leaks found.
- `GITLEAKS_BIN=/tmp/gitleaks bash scripts/gitleaks-tracked-tree.sh` - no leaks found.
- `npm audit --audit-level=high` - 0 high/critical, 16 low advisories.
- `npm --prefix server audit --audit-level=high` - 0 vulnerabilities.
- `npm --prefix gateway audit --audit-level=high` - 0 vulnerabilities.
- `npm --prefix ai-proxy audit --audit-level=high` - 0 vulnerabilities.
- `PYTHONPATH=/tmp/sanctuary-lizard-local python3 /tmp/sanctuary-lizard-local/bin/lizard -w -C 15 .` - 65 warnings.
- `PYTHONPATH=/tmp/sanctuary-lizard-local python3 /tmp/sanctuary-lizard-local/bin/lizard -C 15 .` - average CCN 1.4, 65 warnings.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade-20260427 .` - 2.24% duplicated lines, 290 exact clones.
- `wc -l server/tests/fixtures/verified-address-vectors.ts scripts/verify-addresses/output/verified-vectors.ts` - both files are 2,118 lines.
