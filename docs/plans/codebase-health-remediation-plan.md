# Codebase Health Remediation Plan

Date: 2026-05-16
Owner: Codex
Status: Active remediation plan; Phases 0-4 are merged, Phase 5 is next
Original source: `docs/plans/codebase-health-assessment.md` at local commit `4baa75e6`
Current evidence: `docs/plans/codebase-health-assessment.md` at the active Phase 4 checkpoint
Review note: during recursive review, `origin/main` resolved to `718a3d16`; re-check that ref before executing because the remote branch may advance.

Execution update: Phase 4 is merged as PR #500 at `8535231e2602b1744a1c303edeca2bb68610e5a9`. It fixed the website Mermaid advisory with `mermaid@11.15.0` in the docs-site lockfile and documented the remaining Prisma dev-tool Hono chain as accepted for this dated snapshot because npm's proposed remediation is an unsafe Prisma major downgrade. Phase 5 hardware-in-loop evidence is next, subject to physical device availability.

## Goal

Recover and hold an A-level codebase health grade by addressing the measured score loss from the 2026-05-16 full grade. The plan intentionally starts with reconciliation, because the largest grade loss came from grading a local checkout that is `ahead 1, behind 18` relative to `origin/main`, while several convergence fixes are already merged remotely.

Success means:

- the checked-out source contains the merged Q4/R/S/T convergence fixes;
- duplication is measured through the existing repo-owned `scripts/quality/jscpd-only.sh` / `.jscpd.json` path without polluted source roots;
- the `UserContext` complexity hotspot is split without changing the public context contract;
- moderate dependency advisories are either fixed or explicitly accepted with reachability rationale;
- hardware signing evidence is recorded separately from software-only tests;
- a final full `$grade` returns to A range with no hard-fail blockers.

Delivery rule: each phase that changes repository state is delivered through its own branch/PR, current-head CI is monitored to completion, the PR is merged before the next phase starts, and the resulting merge commit is verified as an ancestor of `origin/main`.

## Product And Architecture Decisions To Preserve

- Do not start a generated-client or frontend framework rewrite. The grade findings identify narrower route/export/base-URL drift, duplicated test fixtures, and a high-complexity context provider.
- Preserve justified split paths: raw refresh fetches, raw health fetches that avoid auth recursion, root `/health` versus `/api/v1/health`, and the LLM egress proxy's independent validation boundary.
- Keep `ledger_gen_5` as Sanctuary's local hardware alias. Target export adapters may translate it to their own wire value; Sparrow should emit the agreed target-format value from the shared export mapping owner, not from route-local or test-local copies.
- Treat physical hardware proof as release evidence, not a reason to block software-side cleanup that can be verified now.
- Preserve all existing dirty documentation changes before any branch reconciliation work.

## Phase 0 - Workspace Preservation

Purpose: make the branch safe to update before touching runtime code.

Work:

- Review `git status -sb` and all dirty docs before branch movement.
- Record `git rev-parse HEAD origin/main` before branch movement.
- Preserve the current documentation changes with an explicit docs commit, dedicated work branch, or equivalent named non-destructive mechanism before reconciling with `origin/main`. Avoid an unnamed stash unless the operator intentionally chooses that workflow and records it.
- Do not use destructive cleanup or broad reset commands.
- If merge or rebase conflicts are larger than the known documentation/source convergence overlap, abort the merge/rebase and re-plan before editing through the conflict.

Exit criteria:

- There is a clear preservation strategy for `docs/plans/codebase-health-assessment.md`, `docs/plans/grade-history/sanctuary_.jsonl`, `docs/plans/rationalization-plan.md`, `tasks/lessons.md`, and `tasks/todo.md`.
- `git diff --check` passes on the dirty documentation files.
- The local `HEAD` and `origin/main` commits are recorded in the task ledger before any reconciliation.

Verification:

- `git status -sb`
- `git rev-parse HEAD origin/main`
- `git diff --check -- docs/plans/codebase-health-assessment.md docs/plans/grade-history/sanctuary_.jsonl docs/plans/rationalization-plan.md tasks/lessons.md tasks/todo.md`

## Phase 1 - Reconcile Local Source With Remote Convergence

Purpose: recover the already-merged Q4/R/S/T fixes before implementing new cleanup.

Work:

- Refresh the remote reference with `git fetch origin` unless the execution environment has a verified fresh fetch from the same session.
- Bring the local checkout onto the current `origin/main` convergence work while preserving Phase 0 documentation.
- Confirm the local source now includes the merged fixes for:
  - frontend API base URL ownership from Phase Q4;
  - Payjoin attempt route validation from Phase R;
  - admin monitoring route validation from Phase S;
  - hardware/export wallet-model mapping from Phase T.
- Resolve conflicts in favor of the merged canonical behavior unless newer local evidence proves otherwise.

Exit criteria:

- The old local divergence signatures are gone from production source.
- Payjoin/admin/export/API-base tests still pass.
- The rationalization plan and grade report no longer describe remote-fixed code as current local behavior after the branch is reconciled.

Verification:

- `! rg -n "psbt: z\\.unknown|payjoinUrl: z\\.unknown|customUrl: z\\.unknown|\\.passthrough\\(\\)\\.catch\\(\\{\\}\\)|ledger_gen_5.*LEDGER_FLEX|ledger_gen_5.*LEDGER_NANO_S|export \\{ API_BASE_URL \\}" server/src/api/payjoin.ts server/src/api/admin/monitoring.ts server/src/api/wallets/export.ts server/src/services/export src/api/client.ts`
- `npx vitest run tests/api/client/client.initialization.contracts.ts`
- `npm --prefix server run test:run -- tests/unit/api/payjoin.test.ts tests/unit/api/admin-monitoring-routes.test.ts tests/unit/api/wallets-export-routes.test.ts tests/unit/services/export/formatHandlers.test.ts`
- `npm run typecheck`
- `npm run lint`

Expected grade movement: +4 to +6 points, mostly from Maintainability 3.4 and Security 4.3.

## Phase 2 - Make Duplication Measurement Reproducible

Purpose: avoid one-off `jscpd` measurements and distinguish real production duplication from intentional contract-test fixture matrices.

Work:

- Harden the existing repo-owned duplication path instead of creating a parallel one: `.jscpd.json`, `scripts/quality/jscpd-only.sh`, and the `scripts/quality.sh` `jscpd duplication` step.
- Confirm that `.jscpd.json` is honored by the script and excludes generated output, coverage, nested worktrees, build artifacts, reports, `.tmp*`, `node_modules`, and other non-source paths.
- Add a package-script alias only if it improves discoverability; do not create a second divergent invocation.
- Decide whether tests are measured under a separate threshold from production source.
- Inspect the largest duplicate clusters before refactoring; avoid mechanical fixture de-duplication that makes behavior matrices harder to read.
- If the contract fixture clusters under `server/tests/unit/services/bitcoin/sync/phasesProcessTransactions/*` can be simplified safely, extract small builders or shared cases with focused tests.

Exit criteria:

- A single existing command path reproduces the duplication signal used by future grades.
- Production-biased duplication remains below the poor threshold, or any remaining source-wide excess is explicitly documented as intentional test data.
- Any refactored test fixtures keep the same behavioral assertions.

Verification:

- `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-review scripts/quality/jscpd-only.sh` with `.tmp/grade-jscpd-review` reserved only for generated duplication output, because the helper clears its output directory before writing reports.
- `jscpd` JSON/report artifact inspection.
- Focused tests for any fixture modules that change.
- `git diff --check`.

Expected grade movement: +1 to +3 points if source-wide duplication is below or clearly scoped around the 5% threshold.

## Phase 3 - Split `UserContext` Complexity

Purpose: reduce the CCN 71 `UserProvider` hotspot without changing auth behavior or the public context API.

Work:

- Keep the existing `UserContextType` and consumer contract stable.
- Extract cohesive helpers or hooks for:
  - auth bootstrap and session restoration;
  - terminal logout subscription;
  - theme application;
  - login, 2FA, register, logout action handlers;
  - preference mutation and optimistic updates;
  - context value assembly.
- Keep error ordering and preference rollback semantics unchanged.
- Avoid moving unrelated auth API behavior during this phase.

Exit criteria:

- `UserProvider` is no longer a lizard warning and no touched function exceeds the project's `CCN <= 15` default unless explicitly justified.
- Existing auth, preference, theme, and context tests pass.
- No consumer-facing context fields or function names change.

Verification:

- `npx vitest run tests/contexts/UserContext.test.tsx tests/contexts/UserContext.preferences.test.tsx tests/hooks/useUserPreference.test.tsx tests/components/Login/useLoginFlow.test.ts tests/components/Login/LoginForm.test.tsx tests/components/Login/TwoFactorScreen.test.tsx tests/components/ThemeSection.test.tsx`
- `npm run arch:lint`
- `node scripts/architecture/detect-drift.mjs origin/main`
- `npm run arch:graphs`
- `npm run arch:calls`
- `git diff --exit-code -- docs/architecture/generated`
- `npm --prefix website run typecheck`
- `npm run docs:build`
- `npm run quality:lizard`
- `npm run typecheck`
- `npm run lint`

Expected grade movement: about +2 maintainability points, plus lower future auth-change risk.

## Phase 4 - Triage Moderate Dependency Advisories

Purpose: prevent moderate advisories from becoming release blockers and document accepted residual risk.

Work:

- Re-run `npm audit --json` after Phase 1 because remote dependency changes may alter advisory counts.
- For each moderate advisory, classify as:
  - upgrade now;
  - override or pin with tests;
  - accepted risk with reachability and package-chain rationale.
- Do not run forced audit fixes without reviewing dependency impact.
- Pay special attention to the current reported chains around `@hono/node-server`, `@tootallnate/once`, and `elliptic`.

Exit criteria:

- There are still 0 high and 0 critical advisories.
- Each moderate advisory has either a code/package change or a dated rationale.
- Any package update is covered by focused tests for the affected runtime surface.

Verification:

- `npm audit --json`
- `npm --prefix server audit --json`
- `npm --prefix gateway audit --json`
- `npm --prefix llm-egress-proxy audit --json`
- `npm --prefix website audit --json`
- `npm --prefix scripts/verify-addresses audit --json`
- `npm --prefix scripts/verify-psbt audit --json`
- Package-manager lockfile diff review if dependencies change.
- Focused server/gateway/hardware tests for changed dependency chains.
- `npm run typecheck`
- `npm run lint`

Expected grade movement: mostly risk reduction. This may not add direct points while high/critical remains 0, but it protects the grade from advisory reclassification.

## Phase 5 - Record Hardware-In-Loop Signing Evidence

Purpose: close the static-only verification gap for real device signing.

Work:

- Define a small matrix of supported device, firmware, network, descriptor/script type, and PSBT fixture combinations.
- Use `docs/reference/hardware-wallet-validation.md` as the runbook and `server/tests/fixtures/hardware-signed-psbt-vectors.ts` as the executable fixture source of truth.
- Capture signed-output evidence with fixture hashes and expected transaction validation.
- Record device constraints and any intentionally unsupported combinations, including the existing distinction between required missing rows and product-blocked unsupported rows.
- Keep this evidence separate from production runtime requirements.

Exit criteria:

- A dated hardware evidence artifact exists, for example `docs/plans/hardware-wallet-validation-YYYY-MM-DD.md`, and is linked from the health/grade plan.
- Evidence includes device model, firmware, transport, network, descriptor/script type, PSBT fixture hash, expected output, and pass/fail result.
- Failures become implementation tasks only when they identify a software defect rather than lab setup or unsupported hardware behavior.

Verification:

- Manual hardware signing run notes.
- Required software gates from `docs/reference/hardware-wallet-validation.md`.
- Fixture hash and signed transaction validation.
- Existing hardware adapter/export tests remain green.

Expected grade movement: +1 to +2 correctness confidence/completeness points.

## Phase 6 - Re-Grade And Lock The Improvement

Purpose: prove the remediation actually moves the codebase health score.

Work:

- Run the full grade after Phase 1 before committing to later implementation slices. If reconciliation alone recovers an A grade, treat Phases 2-5 as hardening backlog unless the user explicitly wants all of them delivered immediately.
- Run the full grade again after Phases 2-3, then again after any dependency or hardware-evidence changes if they land separately.
- Update `docs/plans/codebase-health-assessment.md` and grade history through the `$grade` workflow.
- If the score remains below A range, inspect the remaining point loss before adding new scope.

Exit criteria:

- Full grade is A range, hard-fail blockers are still clear, and the trend entry is appended.
- Remaining risks are explicitly classified as accepted, deferred, or planned with owners.

Verification:

- `$grade`
- `tail -n 1 docs/plans/grade-history/sanctuary_.jsonl | jq .`
- `git diff --check -- docs/plans/codebase-health-assessment.md docs/plans/grade-history/sanctuary_.jsonl tasks/todo.md`

## Priority Order

| Priority | Phase | Why It Comes Here | Expected Impact |
| ---: | --- | --- | --- |
| 0 | Workspace preservation | Branch reconciliation is risky with dirty docs unless they are protected first. | Prevents accidental loss of planning history. |
| 1 | Remote convergence reconciliation | The largest grade loss is stale local source, not new design failure. | +4 to +6 points. |
| 2 | Grade checkpoint | Phase 6 starts with a full `$grade` immediately after Phase 1, before committing to later slices. | Prevents unnecessary scope if reconciliation already restores A range. |
| 3 | Reproducible duplication measurement | The grade used a one-off `npx jscpd` measurement instead of the existing repo script/config path. | +1 to +3 points and better future signal. |
| 4 | `UserContext` split | CCN 71 is the largest local complexity hotspot after reconciliation. | About +2 points. |
| 5 | Advisory triage | Non-blocking today, but cheap to clarify before it becomes urgent. | Risk reduction. |
| 6 | Hardware evidence | Important, but requires lab devices and should not block software cleanup. | +1 to +2 confidence points. |
| 7 | Final re-grade | Confirms the plan worked and updates trend history. | Locks outcome. |

## Risks And Controls

- Dirty documentation can be overwritten during branch reconciliation. Control: preserve or commit docs first, then verify with `git diff --check`.
- Duplication config can hide real risk if ignores are too broad. Control: use narrow generated/build/worktree ignores and keep production/test thresholds visible.
- `UserContext` extraction can regress auth or preference rollback behavior. Control: preserve public context types and run focused auth/preference tests before broad checks.
- Dependency fixes can introduce larger runtime changes than the advisory warrants. Control: prefer targeted upgrades or documented acceptance over forced upgrades.
- Hardware evidence can become an open-ended lab project. Control: define the matrix first and treat unsupported combinations as product decisions, not silent failures.

## Work To Avoid

- Do not rewrite API-client architecture just to chase the score; reconcile the existing Phase Q4 fix first.
- Do not collapse proxy/backend LLM validation into one trust boundary.
- Do not remove raw refresh or health fetch boundaries that exist to avoid auth-client recursion.
- Do not rename `ledger_gen_5` away from the local Sanctuary alias; only target-format adapters should translate it.
- Do not refactor duplicated tests until the duplicate clusters are proven to reduce clarity or maintenance.
