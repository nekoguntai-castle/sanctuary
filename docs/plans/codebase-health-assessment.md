# Software Quality Report

Date: 2026-05-13
Owner: TBD
Status: Current full grade; physical hardware-in-loop proof remains outside this static software score
Mode: full
Commit: `efd18003`

**Overall Score**: 95/100
**Grade**: A
**Confidence**: High

The current repository has recovered from the prior deep bug-scrub downgrade. The hard mechanical gates are green, reported aggregate coverage is 100%, no high or critical dependency vulnerabilities were found, tracked-tree secret scanning is clean, and the remaining risks are concentrated in maintainability hotspots, moderate/low dependency advisories, and hardware-only validation that cannot be proven without physical devices.

---

## Hard-Fail Blockers

None.

The grade hard-fail gates were all clear:

| Gate | Result |
| --- | --- |
| Tests | Pass |
| Typecheck | Pass |
| High/critical dependency vulnerabilities | 0 |
| Hardcoded secrets | 0 |

Non-blocking security note: root `npm audit` still reports 23 total advisories: 3 moderate and 20 low. No high or critical advisories were present in this run.

---

## Domain Scores

| Domain | Score | Evidence |
| --- | ---: | --- |
| Correctness | 18/20 | Project tests, lint, and typecheck pass. Functional completeness is held below full credit because physical hardware-in-loop signing evidence remains outstanding. |
| Reliability | 15/15 | Central error handling, request timeouts, retry/backoff paths, abort signals, and fatal process handlers are present across server, gateway, worker, MCP, and LLM egress proxy entrypoints. |
| Maintainability | 12/15 | Lizard reports 3 warnings, duplication is 2.32%, and the largest file is 949 lines. Architecture and naming remain strong in spot checks. |
| Security | 15/15 | No high/critical audit findings, no tracked-tree secrets, Zod/API validation and CSRF/auth controls are visible, and no high-risk user-controlled `eval`/HTML/shell pattern surfaced in inspected production paths. |
| Performance | 10/10 | Blocking-I/O guard passes, API/client paths use timeouts and retry controls, and no obvious hot-path data-access issue surfaced in the sampled inspection. |
| Test Quality | 15/15 | Reported coverage is 100%, the suite is broad, and inspected tests cover success, empty, 404, service-error, and validation branches. Timer usage is mostly deterministic fake timers. |
| Operational Readiness | 10/10 | Docker, Compose, CI, health/readiness endpoints, structured logging, and observability hooks are present. |
| **TOTAL** | **95/100** | |

---

## Trend

- Previous full history entry: 76/100, C, commit `ec073c64`, dated 2026-05-08.
- Current full grade: 95/100, A, commit `efd18003`, dated 2026-05-13.
- Delta: +19 points, C -> A.

The improvement reflects remediation of the prior feature/security invariants plus clean mechanical evidence on the current HEAD. The remaining non-hardware work is not blocking an A grade, but it should be tracked to keep the grade from drifting downward.

---

## Evidence

### Mechanical Signals

| Signal | Result |
| --- | --- |
| Grade script | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed successfully. |
| Tests | `npm test` passed: 480 files, 6109 tests. |
| Lint | `npm run lint` passed, including app/server/gateway lint and custom API body, Bitcoin network-boundary, safety-catch, and blocking-I/O guards. |
| Typecheck | `npm run typecheck` passed. |
| Coverage | `npm run coverage` passed with reported 100.00% lines/statements/functions/branches across frontend, server, and gateway. |
| Dependency audit | `npm audit --audit-level=high` found 0 high/critical advisories; root audit still reports 3 moderate and 20 low advisories. |
| Secrets | Gitleaks found 0 tracked-tree findings. |
| Complexity | Lizard average CCN 1.4 with 3 warnings. |
| Duplication | `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .` found 2.32% duplicated lines. |
| File size | Largest file is `scripts/perf/phase3-benchmark.mjs` at 949 lines; `src/api/client.ts` is 801 lines. |
| Operational artifacts | Dockerfile, Compose, GitHub/Forgejo CI, health endpoints, logging, and observability libraries were detected. |

### Inspected Code Evidence

- `contexts/UserContext.tsx` is the primary maintainability hotspot. The provider combines auth bootstrap, terminal logout subscription, theme application, login, 2FA, registration, logout, preference mutation, context construction, and hooks in one 313-line component body. Lizard reports CCN 55 at the provider.
- `components/send/steps/OutputsStep/sections/RecipientsSection.tsx` has a lizard warning at CCN 17. The risk looks mostly JSX branching and repeated render cases, not a behavioral defect.
- `src/api/client.ts` is large at 801 lines but shows mature reliability patterns: retry configuration, CSRF handling, refresh policy, abort/timeout support, and shared API error handling.
- `server/src/errors/errorHandler.ts` centralizes Prisma, validation, CSRF, and unknown-error handling with request IDs and structured logging.
- `server/src/middleware/requestTimeout.ts` applies request-scoped timeout behavior and abort signaling.
- `server/src/middleware/validate.ts` validates body, params, and query with Zod and replaces request fields with parsed values.
- Fatal process handlers are registered across the main service entrypoints rather than only logging and continuing after unrecoverable process failures.
- Security spot checks did not reveal user-controlled production `eval`, `dangerouslySetInnerHTML`, raw shell interpolation, or unguarded unsafe API use. The production Redis Lua uses are controlled script calls, and inspected child-process use is in system/admin collectors and guarded scripts rather than direct user-string shell execution.
- `server/tests/unit/api/wallets-approvals-routes.test.ts` demonstrates behavioral coverage for success, empty results, route-wallet mismatch, missing/mismatched approval requests, service errors, and validation errors.

### Missing Or Limited Signals

- Physical Ledger/Trezor/BitBox hardware-in-loop signing evidence remains unavailable in this software-only grade run.
- The grade script did not parse `lizard_max_ccn`; the maximum warning was taken from lizard output and inspected directly as CCN 55.
- Dependency advisories below high severity were not treated as hard blockers, but the 3 moderate advisories should remain visible until resolved, overridden, or explicitly accepted.

---

## Top Findings

1. **Maintainability hotspot in `contexts/UserContext.tsx`**
   - Severity: Medium
   - Evidence: Lizard reports CCN 55 for the provider component.
   - Impact: Auth, preference, theme, session, and context-construction behavior are coupled in one high-branch component, making future auth changes riskier.
   - Direction: Extract auth bootstrap/session lifecycle, preference mutation, and context value assembly into focused hooks or helpers while preserving the existing public context API.

2. **Moderate and low dependency advisories remain**
   - Severity: Medium
   - Evidence: Root audit reports 3 moderate and 20 low advisories, though no high/critical advisories.
   - Impact: Not a hard gate today, but dependency drift can become a release blocker if an advisory is reclassified or an affected path becomes reachable.
   - Direction: Triage each moderate advisory to upgrade, override with a dated rationale, or document accepted risk with reachability notes.

3. **Physical hardware proof is still outstanding**
   - Severity: Medium
   - Evidence: The static grade cannot prove physical device signing flows.
   - Impact: Software tests can validate fixtures and protocol handling, but they cannot prove current Ledger/Trezor/BitBox behavior on real devices.
   - Direction: Complete the required signed fixture matrix on physical hardware and record device, firmware, network, descriptor, and expected transaction evidence.

4. **Large files remain close to design-warning thresholds**
   - Severity: Low
   - Evidence: Largest file is 949 lines; `src/api/client.ts` is 801 lines.
   - Impact: Large files are not currently failing mechanical gates, but they increase review cost and make regressions harder to localize.
   - Direction: Extract stable helper modules when these files are next touched for functional work.

---

## What The Codebase Does Well

- Mechanical quality is strong: tests, coverage, lint, typecheck, gitleaks, lizard, duplication, API-body validation, Bitcoin network-boundary checks, safety-catch checks, and blocking-I/O checks all provide useful pressure.
- Reliability patterns are visible and consistent: request timeouts, abort signals, retries, central error handling, structured logging, and fatal process handling are present.
- Security posture is much stronger than the prior scrub state: validation, CSRF/cookie auth, route guards, rate limits, and revocation work are represented in code and tests.
- Test coverage is broad and behavior-oriented in inspected areas, especially wallet approvals, auth/session, broadcast policy, gateway middleware, and repository contracts.
- Operational readiness is mature for the project size, with container artifacts, health endpoints, CI, logs, and observability hooks.

---

## What Is Lacking

- Hardware-wallet correctness still depends on physical artifacts that are not committed or proven by this run.
- `UserContext` is doing too much work for one component and is the clearest maintainability debt.
- Moderate and low dependency advisories need explicit triage so they do not become stale background risk.
- Large files should be kept from growing further, especially API-client and benchmark/test harness files.

---

## Fastest Improvements

1. Split `contexts/UserContext.tsx` into smaller hooks/helpers until lizard warnings clear.
2. Triage the 3 moderate dependency advisories with upgrade, override, or accepted-risk notes.
3. Run and document the physical hardware signing matrix.
4. Opportunistically extract helper modules from `src/api/client.ts` and the largest harness files when touching those areas.

---

## Roadmap To A Grade

Current grade is already A. To preserve it:

1. Keep all hard gates green on every PR: tests, typecheck, lint, high/critical audit, and gitleaks.
2. Reduce lizard warnings from 3 to 0, starting with `UserContext`.
3. Keep duplication below 3% and prevent new large production files over 500 lines without explicit classification.
4. Close or document dependency advisories below high severity before release branches.
5. Add the hardware-in-loop evidence so the score is no longer limited by non-software verification.

---

## Prior Context Preserved

The previous report on 2026-05-08 scored the codebase 76/C after a deeper bug scrub found high-impact correctness, security, and operational invariants despite strong mechanical gates. That report's hard blockers and P1/P2 remediation items are no longer carried as current blockers in this grade. The useful carry-forward items are:

- Prior hard blockers around Semgrep release workflow findings and moderate production package audits were remediated in later slices and no longer block the grade.
- The accepted non-hardware scrub queue has been fixed and locally verified in the active task history.
- The remaining known verification item is physical hardware-in-loop signing proof.
- The external Specter Desktop comparison and fund-safety gap closure notes remain useful background for hardware and release-trust work, but they do not reduce the current static software grade.

---

## Verification Notes

Commands and checks used for this grade:

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh`
- `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd .`
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh prev sanctuary_ full`
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh append sanctuary_ '<json>' full`
- Targeted source inspection of `contexts/UserContext.tsx`, `RecipientsSection.tsx`, `src/api/client.ts`, `server/src/errors/errorHandler.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/middleware/validate.ts`, and wallet approval route tests.

The trend history was appended at `docs/plans/grade-history/sanctuary_.jsonl`.
