# Software Quality Report

Date: 2026-04-27
Owner: TBD
Status: Current

**Overall Score**: 98/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 600cd6fe

Post-remediation pre-release grade after Slices 1-6. The repository now has no hard-fail blockers, full app/backend/gateway coverage, no high/critical dependency findings, clean gitleaks scans, jscpd below the duplication gate, and a full pinned lizard scan with zero threshold warnings. The remaining score pressure is the strict raw file-size rubric: the project large-file classifier passes, but `scripts/perf/phase3-benchmark.mjs` is still 1,150 lines.

---

## Hard-Fail Blockers

None.

Tests, lint, typecheck, coverage, gitleaks, and high-severity audits pass. No hard-fail cap applies.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | App tests, backend coverage tests, gateway coverage tests, app/test typechecks, and app lint pass; suppression density remains low for the repo size. |
| Reliability | 15/15 | Validation, typed error handling, request timeouts, retry/backoff, limiter fail-closed behavior, and async cleanup paths remain covered. |
| Maintainability | 13/15 | Full pinned lizard is clean at `CCN <= 15`, duplication is 2.25%, architecture/readability are strong after the remediation slices; the raw largest-file signal is still >1,000 lines. |
| Security | 15/15 | Gitleaks scans are clean; root/server/gateway/ai-proxy audits report 0 high/critical findings; MCP/admin/token paths remain scoped and redacted. |
| Performance | 10/10 | Sampled hot paths use async I/O, bounded request timeouts, limiter budgets, grouped/windowed database reads, and capped AI/MCP tool execution. |
| Test Quality | 15/15 | App/backend/gateway coverage all report 100%, with broad null, empty, auth, rate-limit, wallet/device, MCP, Console, vector, and route-contract coverage. |
| Operational Readiness | 10/10 | Docker/Compose, CI workflows, health endpoints, observability hooks, request IDs, and redacted contextual logging are present. |
| **TOTAL** | **98/100** | No hard-fail cap applies. |

---

## Trend

- vs previous full report on 2026-04-27 (`816ced3e`): overall `+6` (`92 -> 98`), grade `A -> A`, confidence `High -> High`.
- Maintainability moved from `7/15` to `13/15`: `lizard_warning_count` moved from `65` to `0`, and the verified vector fixtures dropped from 2,118 lines to 178 lines each.
- Duplication stayed below the 3% gate (`2.24% -> 2.25%`), and coverage remains 100% across app, backend, and gateway gates.
- The remaining strict scoring gap is file size: the raw largest measured source is now `scripts/perf/phase3-benchmark.mjs` at 1,150 lines. Project large-file classification passes with 0 unclassified files over 1,000 lines.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 422 files / 5,712 tests | `CI=true GRADE_TIMEOUT=300 bash /home/nekoguntai/.codex/skills/grade/grade.sh` and explicit coverage gates | Correctness 1.1 -> +6 |
| lint | pass | `npm run lint:app`; grade collector lint also passed | Correctness 1.3 -> +3 |
| typecheck | pass | `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, grade collector typecheck | Correctness 1.2 -> +4 |
| coverage | 100%; app 422 files / 5,712 tests, backend 419 passed files / 9,414 passed tests with 22 skipped files / 505 skipped tests, gateway 21 files / 528 tests | `npm run test:coverage`, `npm run test:backend:coverage`, `npm --prefix gateway run test:coverage` | Test Quality 6.1 -> +5 |
| security_high | 0 | `npm audit --audit-level=high` plus package-specific audits | Security 4.1 -> +5 |
| root_audit_low | 16 | `npm audit --audit-level=high` | Context only; low severity does not affect 4.1 |
| server_audit_total | 0 | `npm --prefix server audit --audit-level=high` | Security context |
| gateway_audit_total | 0 | `npm --prefix gateway audit --audit-level=high` | Security context |
| ai_proxy_audit_total | 0 | `npm --prefix ai-proxy audit --audit-level=high` | Security context |
| secrets | 0 | `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml` | Security 4.2 -> +4 |
| latest_commit_secrets | 0 | `.tmp/quality-tools/gitleaks-8.30.1/gitleaks git . --config .gitleaks.toml --redact --log-opts -1` | Context: committed HEAD clean |
| tracked_tree_secrets | 0 | `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` | Context: tracked tree clean |
| lizard_warning_count | 0 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -i 0 -l javascript -l typescript -C 15 -T nloc=200 ... .` | Maintainability 3.1 -> +5 |
| lizard_avg_ccn | 1.4 | pinned lizard summary, 370,520 NLOC / 33,067 functions | Maintainability context |
| lizard_threshold_status | no thresholds exceeded | pinned lizard full scan | Maintainability context |
| duplication_pct | 2.25% | `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-final-grade .` | Maintainability 3.2 -> +3 |
| duplication_clones | 291 exact clones / 6,505 duplicated lines | jscpd JSON report | Maintainability context |
| largest_file_lines | 1,150 | `wc -l scripts/perf/phase3-benchmark.mjs` | Maintainability 3.3 -> +0 |
| largest_file_path | `scripts/perf/phase3-benchmark.mjs` | `wc -l` and grade collector | Maintainability context |
| large_file_classification | pass | `node scripts/quality/check-large-files.mjs` | Project policy context |
| vector_fixture_lines | 178 each | `wc -l server/tests/fixtures/verified-address-vectors.ts scripts/verify-addresses/output/verified-vectors.ts` | Slice 6 remediation proof |
| suppression_count | 24 | grade heuristic | Correctness 1.4 judged |
| validation_lib_present | 1 | grade heuristic plus middleware inspection | Security 4.3 judged |
| timeout_retry_count | 1,251 | grade heuristic | Reliability/performance context |
| blocking_io_count | 48 | grade heuristic | Reliability/performance context |
| observability_lib_present | 1 | grade heuristic plus logger/tracing inspection | Operational 7.3 -> +2 |
| logging_call_count | 330 | grade heuristic | Operational 7.4 judged |
| health_endpoint_count | 181 | grade heuristic | Operational 7.2 -> +2 |
| deploy_artifact_count | 2 | Docker/Compose plus GitHub CI | Operational 7.1 -> +3 |
| test_file_count | 1,260 | grade heuristic | Test Quality context |
| test_sleep_count | 10 | grade heuristic | Test Quality 6.4 judged |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=24` remains low for the repo size and is concentrated in tests, compatibility checks, or documented guardrails.
- **[1.5] Functional completeness - High -> +3**: the app, backend, gateway, MCP, Console, OpenAPI, route validation, hardware-wallet, and vector verification surfaces have executable tests and coverage gates.
- **[2.1] Error handling quality - High -> +6**: `server/src/middleware/validate.ts`, `server/src/errors/errorHandler.ts`, and `src/api/client.ts` use structured validation, domain/API error mapping, request IDs, typed client errors, and JSON error envelopes.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/middleware/rateLimit.ts`, and gateway rate-limiters provide bounded request time, retry/backoff, retry-after headers, and fail-closed limiter behavior.
- **[2.3] Crash-prone paths - High -> +5**: production failures are generally typed/domain errors surfaced through route and service boundaries; direct process exits remain concentrated in scripts and utility wrappers.
- **[3.4] Architecture clarity - High -> +3**: remediation split high-risk config, transaction, hardware-signing, UI, test-support, AI-service, and vector-generation paths into helper/controller layers while preserving existing public contracts.
- **[3.5] Readability/naming - High -> +2**: post-slice code favors focused helpers, explicit model builders, and narrow test harnesses; no broad lizard hot spots remain.
- **[4.3] Input validation quality - High -> +3**: Zod middleware validates body, params, and query; Console and admin MCP routes validate prompt/session/history/key payloads before service execution.
- **[4.4] Safe system/API usage - High -> +3**: MCP bearer tokens are format-checked, hashed for lookup, compared timing-safely, revocable, expirable, and wallet-scoped in `server/src/mcp/auth.ts`; admin MCP routes return full tokens only once.
- **[5.1] Hot-path efficiency - High -> +5**: Console tool planning caps tool calls per turn, MCP access updates last-used metadata on a stale throttle, and request-facing paths are asynchronous.
- **[5.2] Data access patterns - High -> +3**: sampled repository and dashboard paths use grouping, bounded row limits, windowed recent-row queries, and `Promise.all` instead of unbounded fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: `blocking_io_count=48` is concentrated in scripts, setup, maintenance, support-package, and test paths rather than ordinary request handlers.
- **[6.2] Test structure - High -> +4**: tests are organized by API, service, repository, integration flow, gateway middleware, UI behavior, assistant/MCP, Console, contract, and branch coverage surfaces.
- **[6.3] Edge cases covered - High -> +3**: sampled tests cover invalid schemas, empty/default branches, auth expiry, rate-limit boundaries, timeout behavior, wallet/device access, prompt history replay/delete/expiration, MCP auth, vector parity, and backup/restore error paths.
- **[6.4] No flaky patterns - High -> +3**: direct sleep evidence remains low, and timer-sensitive tests predominantly use fake timers or explicit timer spies.
- **[7.4] Logging quality - High -> +3**: `server/src/utils/logger.ts` adds request/trace context, sanitizes log text, and calls `server/src/utils/redact.ts` for sensitive field redaction.

### Missing

None. The grade collector did not auto-detect the repo-specific coverage scripts, but explicit app/backend/gateway coverage commands supersede that collector gap.

---

## Top Risks

1. **Strict raw file-size score is not perfect.** `scripts/perf/phase3-benchmark.mjs` is a classified 1,150-line proof harness, so Maintainability 3.3 still scores 0 under the strict rubric even though `node scripts/quality/check-large-files.mjs` passes.
2. **Root audit still has 16 low-severity advisories.** They remain in hardware-wallet/polyfill transitive paths (`elliptic`, old transitive `tiny-secp256k1`/`bitcoinjs-lib`, `@trezor/*`, `@ledgerhq/*`, `vite-plugin-node-polyfills`/`node-stdlib-browser`) with no safe high-confidence fix.
3. **Duplication is below the gate but still worth watching.** jscpd reports 2.25%, mostly test/e2e fixtures, OpenAPI patterns, config boilerplate, and small script helpers.

## Fastest Improvements

1. **Split or further classify the phase-3 benchmark proof harness** if a strict 100/100 score is required; this is the only current mechanical score loss.
2. **Continue monitoring hardware-wallet dependencies** and apply upgrades only when they are direct compatible releases with Ledger/Trezor regression coverage.
3. **Keep the full pinned lizard command in release gates** so future work does not reintroduce hidden `CCN > 15` drift.

## Strengths To Preserve

- 100% app/backend/gateway coverage gates with broad edge-case coverage.
- Full pinned lizard at `CCN <= 15` with zero warnings.
- Zod validation, CSRF-aware browser client behavior, OpenAPI route coverage, and auth-contract checks at trust boundaries.
- Shared assistant read-tool registry used by both MCP and Console, with typed envelopes, scoped access, redaction metadata, provenance, and tool budgets.
- Exposure-aware rate limiting, request timeouts, health endpoints, tracing support, and contextual redacted logging.

## Work To Defer Or Avoid

- Do not weaken verified address vector tests or hardware-wallet coverage to chase cosmetic metrics.
- Do not downgrade wallet, Ledger, Trezor, or polyfill packages just to silence low-severity audit output without hardware-flow regression proof.
- Do not suppress lizard broadly; keep complexity low through helper extraction and focused tests.

## Verification Notes

- `CI=true GRADE_TIMEOUT=300 bash /home/nekoguntai/.codex/skills/grade/grade.sh` - tests/lint/typecheck passed; explicit coverage/audit/gitleaks/lizard/jscpd commands below provide final scoring signals.
- `npm run typecheck:app` - passed.
- `npm run typecheck:tests` - passed.
- `npm run typecheck:server:tests` - passed during Slice 6 verification.
- `npm run lint:app` - passed.
- `npm --prefix ai-proxy run build` - passed.
- `npm run test:coverage` - 422 files, 5,712 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` - 419 passed files, 9,414 passed tests, 22 skipped files, 505 skipped tests, 100% statements/branches/functions/lines.
- `npm --prefix gateway run test:coverage` - 21 files, 528 tests, 100% statements/branches/functions/lines.
- `npm audit --audit-level=high` - 0 high/critical, 16 low advisories.
- `npm --prefix server audit --audit-level=high` - 0 vulnerabilities.
- `npm --prefix gateway audit --audit-level=high` - 0 vulnerabilities.
- `npm --prefix ai-proxy audit --audit-level=high` - 0 vulnerabilities.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner` - no leaks found.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` - no leaks found.
- `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` - no leaks found.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -i 0 -l javascript -l typescript -C 15 -T nloc=200 ... .` - no output, exit 0, zero threshold warnings.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -l javascript -l typescript -C 15 -T nloc=200 ... .` - average CCN 1.4, warning count 0, 370,520 NLOC, 33,067 functions.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-final-grade .` - 2.25% duplicated lines, 291 exact clones.
- `node scripts/quality/check-large-files.mjs` - 0 unclassified files over 1,000 lines; classification check passed.
- `wc -l scripts/perf/phase3-benchmark.mjs server/tests/fixtures/verified-address-vectors.ts scripts/verify-addresses/output/verified-vectors.ts` - 1,150 / 178 / 178 lines.
