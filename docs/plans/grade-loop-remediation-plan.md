# Grade-Loop Remediation Plan

**Source grade report**: `docs/plans/codebase-health-assessment.md`
**Source grade date**: 2026-06-06
**Source commit**: `6c5851d1`
**Source score**: 94/100 (A, High confidence)
**Selected finding**: Top Risk #1 — server test/coverage pipeline regresses silently when `shared/dist/` is stale.

---

## Objective

Make `cd server && npm test` (and the coverage chain that depends on it) succeed deterministically from any local working state, by ensuring `@sanctuary/shared` is built before the server vitest run resolves its workspace imports.

**Acceptance criterion**: starting from a wiped `shared/dist/`, running `cd server && npm test` succeeds without the operator manually rebuilding `shared`. The coverage chain (`npm run coverage` from the root) emits a real server coverage summary again rather than the "no coverage-summary.json" stub.

## Non-Goals

- Do **not** change the `vitest.config.ts` aliasing strategy. The frontend deliberately aliases `@sanctuary/shared` to source for coverage instrumentation; server/gateway deliberately resolve to `shared/dist/` for runtime parity. Both are documented; preserve them.
- Do **not** broaden into a "rebuild every workspace before every script" refactor. Scope is server's test entry points only.
- Do **not** add a CLAUDE.md doc-only mitigation. A doc note cannot replace a deterministic build step.
- Do **not** fix duplication_pct or blocking_io_count drift in this PR — those are deferred to the post-closeout grade pass.
- Do **not** touch CI workflows. CI is already protected by `npm ci` running workspace `prepare` hooks; this fix is for local + grade.sh coverage parity.

## Selected Slice

Add a shared `_predistshared` helper script in `server/package.json` that rebuilds `@sanctuary/shared`, and wire it into the **five** server test entry points that the grade-loop, CI workflows, and dev workflow actually use: `pretest`, `pretest:run`, `pretest:run:ci`, `pretest:coverage`, `pretest:ci`. Add a small regression test that proves the hook strings stay intact. One `package.json` edit, one new test file.

**Why five hooks and not one**: npm's `pre<X>` lifecycle fires only for `npm <X>` (or `npm run <X>` when X is a named script). It is **not** triggered transitively — `pretest` does NOT fire for `npm run test:coverage`. Verified empirically with a minimal repro before writing this plan. The five hook names are the minimum set that covers:
- `pretest` — bare `cd server && npm test` (dev workflow).
- `pretest:run` — `cd server && npm run test:run` (common dev "run once" entry).
- `pretest:run:ci` — `cd server && npm run test:run:ci` (used directly by `.github/workflows/test.yml` and `verify-vectors.yml`).
- `pretest:coverage` — the root `npm run coverage` chain reaches this via `npm run test:backend:coverage` → `cd server && npm run test:coverage`.
- `pretest:ci` — `cd server && npm run test:ci` (CI entrypoint with JUnit reporter).

Other `test:*` variants (test:unit, test:integration, test:bitcoin, test:fast, etc.) are dev-driven scopes that the operator runs shortly after `npm install` (or after one of the hooked entries already built `shared/dist/`). Chasing all 20 variants would be churn for no real benefit. If a future commit needs one of them to be stale-resilient, add the `pre*` hook in the same shape as the five above.

## Phases

### Phase A — Implement the hooks

**File**: `server/package.json`

**Change 1**: add a private helper script that rebuilds shared from a workspace child dir using the only invocation pattern that npm actually supports here (subshell `cd ..` — `npm --prefix .. --workspace=shared` errors with "No workspaces found" because npm resolves `--workspace` relative to cwd, not prefix; verified before writing this plan).

```
"_predistshared": "cd .. && npm run build --workspace=shared"
```

**Change 2**: add five `pre*` hooks that chain the helper before the existing `prisma generate` step.

```
"pretest": "npm run _predistshared && prisma generate"
"pretest:run": "npm run _predistshared && prisma generate"
"pretest:run:ci": "npm run _predistshared && prisma generate"
"pretest:coverage": "npm run _predistshared && prisma generate"
"pretest:ci": "npm run _predistshared && prisma generate"
```

Rationale:
- `_predistshared` is a single source of truth for the build invocation — fixing the command in the future means editing one line, not three.
- The `cd .. && npm run build --workspace=shared` form is the verified working pattern from `server/`.
- `prisma generate` stays in each hook (was already there in `pretest`; we mirror it into the two new hooks to preserve the existing pre-test invariant that prisma client is regenerated).
- Do **not** add `_predistshared` to `prebuild` — server `build` does not depend on shared dist today, and adding it would slow the inner-loop unnecessarily.
- Do **not** add `_predistshared` to `postinstall` — that already runs `prisma generate`, and the shared workspace's own `prepare` script handles the install-time build. The gap we are closing is the *post-pull, pre-test* gap, not the install gap.

### Phase B — Regression test

**File**: `server/tests/unit/packaging/sharedPretestRebuild.test.ts` (new)

A unit-level test that:
1. Reads `server/package.json` and asserts the `_predistshared` helper exists and equals exactly `cd .. && npm run build --workspace=shared`.
2. Asserts each of `pretest`, `pretest:run`, `pretest:run:ci`, `pretest:coverage`, `pretest:ci` equals exactly `npm run _predistshared && prisma generate`.
3. Has a doc comment in the file header explaining *why* the hook is shaped that way and which scenario it prevents (stale `shared/dist/` after `git pull`).

Why a script-shape assertion rather than a full integration test that wipes `dist/` and re-runs vitest:
- Wiping `shared/dist/` from a vitest test would race the parent vitest process which is already importing through `dist/`. The shape assertion is deterministic and catches future regressions like "someone removed the hook" or "someone replaced npm with pnpm without updating the hook".
- The behavioural proof lives in the Phase D verification, executed once by the author and once by CI.

### Phase C — Self-review pass

After Phase A and B, run `/simplify` mentally over the diff:
- No new abstractions, no helper scripts, no env vars.
- No unrelated cleanup.
- Test file follows existing `server/tests/unit/**` conventions.

### Phase D — Verification

**Focused (fast) verification**, run from repo root:

```bash
# Wipe shared dist to simulate fresh checkout
rm -rf shared/dist

# Confirm the bare-test hook rebuilds shared and tests pass
cd server && npm test
# Expect: 460+ test files pass, 0 fail, exit 0

# Wipe again, confirm the coverage hook does the same
cd ~/sanctuary && rm -rf shared/dist
cd server && npm run test:coverage 2>&1 | tail -20
# Expect: 460+ test files pass, coverage report emitted under server/coverage/

# Confirm the regression test itself is green
cd ~/sanctuary/server && npx vitest run tests/unit/packaging/sharedPretestRebuild.test.ts
# Expect: 1 test file, all assertions pass
```

**Broader closeout gates**, run from repo root:

```bash
# Server typecheck stays green
cd server && npx tsc --noEmit && cd ..

# Frontend typecheck + tests stay green
npx tsc --noEmit && npx vitest run

# Lint stays green
npm run lint

# Full coverage chain (slower; runs only once before commit)
rm -rf shared/dist && npm run coverage 2>&1 | tail -20
# Expect: "Coverage Summary" shows server with real numbers
#         (not "(no coverage-summary.json found — run coverage for this package)")
```

**Final closeout gate** (Phase 7 of the loop):

```bash
# Re-run /grade and confirm:
#   - coverage signal is no longer "unknown"
#   - Test Quality score recovers from 13 → 15
#   - Overall score regresses upward (94 → 96 expected)
```

## Compatibility, Migration, Rollback, Backout

- **Compatibility**: no public API change, no schema change, no DB migration. The hook adds a build step that was previously implicit (developers had to remember to run `npm install` after pulling new shared files). Existing developer workflows are not broken — `npm install` still works, the hook just makes `npm test` self-sufficient.
- **Migration**: none. The hook fires on next `npm test`.
- **Rollback**: revert the one-line edit to `server/package.json` and delete the new test file. No state to undo.
- **Backout signal**: if the `npm --prefix ..` invocation fails on some developer setup (Windows path quoting, npm version <7), the hook would block `npm test`. Mitigation: the error message would be loud and immediately attributable to the new hook; revert path is trivial.

## Risks

1. **Workspace `--workspace=shared` from a child dir**: npm resolves `--workspace` relative to cwd, not `--prefix`. Verified before writing this plan: `cd server && npm --prefix .. run build --workspace=shared` fails with "No workspaces found". The plan uses the subshell `cd ..` form which is verified working. Anyone refactoring this hook must keep the cwd at the root before invoking `--workspace=shared`.
2. **npm version**: workspaces require npm 7+. Verify the repo's `.nvmrc`/`engines` (or CI Node version) before merging by running `npm -v` in the install-test environment.
3. **Hook cost**: builds `shared` (a small tsc invocation) on every `npm test`/`test:coverage`/`test:ci`. tsc's incremental cache (`tsBuildInfoFile`/`incremental: true` if enabled) should make repeat runs near-instant. The first run after `rm -rf shared/dist` is a cold compile (~1-3s on this host); subsequent runs should be <500ms.
4. **Race with parallel server test invocations**: if two `npm test` invocations run concurrently, both will try to build `shared`. tsc handles this safely (idempotent output, last writer wins), but it's worth noting.
5. **Subshell `cd ..` is bash/sh-friendly**: works on macOS and Linux. On Windows `cmd.exe` the chained `&&` works the same way. `npm run` invokes scripts via the configured shell (`script-shell` in npmrc, defaults to `sh`/`cmd.exe`). No PowerShell-specific issues expected.

## Verification Acceptance Criteria

The PR is acceptance-ready when **all** are true:

- [ ] `rm -rf shared/dist && cd server && npm test` exits 0 (was: exit 1 with 11 import errors).
- [ ] `rm -rf shared/dist && cd server && npm run test:coverage` exits 0 with a coverage report.
- [ ] `rm -rf shared/dist && npm run coverage` (from root) produces a non-empty server coverage summary (was: `(no coverage-summary.json found — run coverage for this package)`).
- [ ] The regression test `tests/unit/packaging/sharedPretestRebuild.test.ts` is green and its assertions reference the exact strings used in `server/package.json`.
- [ ] Server `npx tsc --noEmit` is green.
- [ ] Frontend `npx tsc --noEmit && npx vitest run` is green.
- [ ] Root `npm run lint` is green.
- [ ] Only `server/package.json` and `server/tests/unit/packaging/sharedPretestRebuild.test.ts` change in the diff (plus their `package-lock.json` if any — none expected).

## Deferred Findings

- **`blocking_io_count` 78 → 105 (+27)** — defer to post-closeout grade spot-check (Phase 7). If hot paths still avoid synchronous I/O, leave anchored at +10 Performance. Reason: not a regression by itself, and addressing it would expand scope.
- **`duplication_pct` 1.69 → 2.67** — defer. Active "Converge*" series is *reducing* drift; transient duplication during refactor is expected and the margin is still under 3%.
- **Top-level `prepare-workspaces` convenience script** — defer to a follow-up PR if Phase D suggests the `pretest` hook is sufficient.

## Pass Budget

This is autonomous pass 1 of the grade-loop. Budget allows one additional pass after post-closeout if the post-closeout grade reveals another major actionable item. Beyond that, defer.
