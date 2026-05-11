# Synthesis — iteration 3 (Claude + 2 independent fork reviewers)

Plan reviewed: `tasks/todo.md` top entry "shared/ → real npm workspace package (v3) 2026-05-10".

Three independent reviews:
- `tasks/review-findings-iter3-claude.md` — author's own re-review (2 NEW blockers, 7 should-fix)
- `tasks/review-findings-iter3-forkA.md` — independent reviewer A (4 NEW blockers, 6 should-fix, 4 nice-to-have)
- `tasks/review-findings-iter3-forkB.md` — independent reviewer B (3 CRITICAL, 5 HIGH, 4 MEDIUM, 3 LOW)

## Convergent blockers (2+ reviewers, high-confidence)

| # | Finding | Reviewers | Phase |
| --- | --- | --- | --- |
| 1 | **`moduleResolution: node` ignores `exports`; B3a's "drop paths entirely" is broken.** Worse than v2's divergence: Node-resolver walk finds `shared/utils/errors.ts` SOURCE first (because symlink target IS source), masking the bug at type-check; runtime `require()` honors exports → resolves `dist/utils/errors.js`; type-check and runtime resolve DIFFERENT files. | Claude + ForkB | B3a |
| 2 | **H3 deletes `node_modules/.prisma/client` which doesn't exist** — Prisma generates to `server/src/generated/prisma` per schema; default path was never used. Same placebo class as v2. | All 3 | H3 |
| 3 | **D7 mutation pre-warm via "no-op PR" is mythical** — Stryker incremental cache is content-hashed per file; post-D every file's hash changed; pre-warming runs the gate twice for nothing. | Claude + ForkB | D7 |
| 4 | **F1c programmatic ESLint smoke is overkill** — loads all plugins, ~3-5s startup, fragile. Lighter alternatives exist (config-import unit test or shell grep). | Claude + ForkB | F1c |

## Net-new blockers (single reviewer, but factually verified)

| # | Finding | Reviewer | Phase |
| --- | --- | --- | --- |
| 5 | **F1b's premise is factually wrong: `productionSource` ALREADY covers server/gateway** (verified `eslint.config.js:14-15`). My iter2 finding was based on misreading the file. v3 prescribes an unnecessary extra config block; the rule should be added to the existing `productionSource` block. | ForkA | F1b |
| 6 | **A1 `extends: "../tsconfig.json"` inherits `noEmit: true` + `allowImportingTsExtensions: true`** — Phase A5's `tsc -p tsconfig.json` will silently produce ZERO output (or paradox-error: `allowImportingTsExtensions` requires `noEmit: true` but A1 specifies `declaration: true`). Build is broken on first run. | ForkA | A1 |
| 7 | **Gateway Dockerfile line 24 has the IDENTICAL `ln -s /app/node_modules /node_modules` hack** that v3 G1 calls out only for server. Plus gateway uses `npm prune --production --omit=optional` (server uses `--production` only) — different interaction with workspace symlinks. G2 says "same shape as G1" but doesn't enumerate. | ForkA | G2/G4.5 |
| 8 | **`docker-compose.test.yml` bind-mounts not enumerated in G5** — frontend-test/frontend-coverage mount `./node_modules:/app/node_modules:ro` but NOT `./shared`. After migration, `node_modules/@sanctuary/shared` is a symlink to `../shared/` → mount becomes a DANGLING symlink at `/app/node_modules/@sanctuary/shared` → `/app/shared` (unmounted). Frontend test container fails to resolve `@sanctuary/shared/*`. | ForkA | G5 |

## Convergent should-fix

- **B4 vitest alias to `dist/`** — coverage instrumentation + source-map fidelity concerns. Acceptance test: deliberately throw from a shared util in a smoke test; assert stack trace points at `.ts:line` not `.js:line` (Claude + ForkB partial)
- **D codemod sequencing** — ts-morph Project requires node_modules to exist; add pre-flight `tsc --noEmit` check per tsconfig before Project instantiation (ForkB)
- **G1c hand-built `node_modules/@sanctuary/shared/`** assumes zod hoists to a reachable location; works only by accident if server happens to depend on zod directly. Add `docker exec server node -e "require('@sanctuary/shared/schemas/mobileApiRequests')"` (the file that imports zod) to the acceptance probe (ForkB)
- **G5 architecture.yml row** — REMOVE per-package npm ci commands, don't translate to `--workspace=` (root install already handles workspaces) (ForkB)
- **A2.5 builtin detection via `module.isBuiltin()`**, not hardcoded regex (ForkB)
- **F1 patterns top out at depth-5** — codebase has tests at depth ≥ 6; add depth-6/7 OR switch to `eslint-plugin-import/no-restricted-paths` (ForkB)

## Convergent should-fix (single-reviewer, factually solid)

- **`tests/` import count is 9, not 6** (ForkA — re-grep would have caught this in v3's "Re-verified facts")
- **D1 misses `server/tsconfig.test.full.json`** which has different module resolution and may see a different file set (ForkA)
- **zod version skew** — root pins `4.3.6` exact, server/gateway/ai-proxy use `^4.3.4` — A2 should pin EXACT `4.3.6` to avoid hoisting surprises (ForkA)
- **Frontend coverage instrumentation** — `vitest.config.ts:40` includes `shared/**/*.ts` in coverage; after E, frontend resolves to `dist/*.js`; threshold check may falsely fail at 0% on `shared/*.ts` (ForkA)
- **Server Dockerfile structural rewrite** — G1c's strategy doesn't account for: (i) deps stage runs `npm ci` against `server/package.json` ALONE which fails on `workspace:*` specifiers; (ii) shared's COPY destination; (iii) CMD path discrepancy (ForkA)
- **Root tsconfig excludes server/gateway/ai-proxy** — worth a one-line note in "Re-verified facts" (ForkA)
- **B9 ESM smoke needs BOTH subpath AND bare import test** — bare import via index.ts re-exports may fail named-export synthesis (Claude)
- **G5 architecture.yml under isolated worktree** — `--workspace=server` requires root install context (Claude)
- **shared internal imports** would need `.js` extensions if consumers move to `moduleResolution: node16` (ForkB)

## Convergence trajectory

| Iter | Distinct blockers | Should-fix |
| --- | --- | --- |
| 1 (synthesized) | 4 convergent | many |
| 2 (synthesized) | 8-10 distinct | ~15 |
| 3 (this) | **8 distinct** (4 convergent + 4 net-new factual) | ~15 |

**The blocker count did NOT decrease.** Iter3 still surfaces 8 distinct high-impact findings. BUT the character of the blockers changed:
- **Iter1**: structural questions (which Direction? `*.ts` exports won't work)
- **Iter2**: implementation surface gaps (Docker, CI workflows, deletion sweep, frontend resolution)
- **Iter3**: factual/enumeration errors v3 introduced applying iter2 fixes incorrectly (paths-drop wrong, F1b misread, H3 wrong path, A1 extends inherits noEmit, gateway Dockerfile not enumerated)

## Verdict

**The plan does NOT need a structural rewrite.** Direction A is sound. The phase shape (A→B→C→D→E→F→G→H→I→J) is sound. The convergent fixes have all landed correctly EXCEPT for the 4 places v3 misapplied them.

Both forks independently recommend: **patch v3 → v3.1 inline (no full v4 rewrite); then proceed to Phase A execution**. They explicitly recommend STOPPING the loop after v3.1, NOT running iter4.

The /review skill's stop-or-grind question: iter3's 8 blockers are NOT a sign that more iteration is needed — they're a sign that v3 was drafted too fast (8 of the 8 are textbook "verify against current source before writing the fix" misses on my part). v3.1 should be a careful tightening pass, then ship.

## Recommended v3.1 patch (8 blocker fixes + 6 convergent should-fix)

**Blockers to fix in v3.1:**
1. **B3a:** restore `paths: { "@sanctuary/shared/*": ["../shared/dist/*"] }` (point at dist; type-check fails until built — acceptable). Reject the "drop paths entirely" approach.
2. **H3:** replace test with the concrete clean-room test from forkB's C-3 (`rm -rf node_modules`, `npm install`, `npx prisma generate`, verify resolution).
3. **F1b:** drop the "separate config block" prescription; add the `no-restricted-imports` rule to the existing `productionSource` block at lines 38–82 of `eslint.config.js`.
4. **A1:** drop `extends: "../tsconfig.json"`. Hand-write the strict-flag triple at top of shared/tsconfig.json.
5. **G2:** explicit "remove `gateway/Dockerfile:24 RUN ln -s ...`" + acceptance probe for `--omit=optional` interaction with workspace symlinks.
6. **G5:** add `docker-compose.test.yml` row — bind-mount `./shared:/shared:ro` into frontend-test + frontend-coverage containers, OR change the alias to point at `/shared` directly.
7. **D7:** drop the "pre-warm on no-op PR" option entirely; just budget the slow first run.
8. **F1c:** replace programmatic ESLint smoke with a config-import unit test that asserts no `**/shared/**` pattern in `eslint.config.js`'s server/gateway-scoped block.

**Should-fix to fold in:**
- B4: B6 acceptance — assert shared stack traces show `.ts:line` not `.js:line`
- D1: add pre-flight `tsc --noEmit --skipLibCheck` per tsconfig before Project instantiation; add `server/tsconfig.test.full.json` to the CONFIGS list
- G1c: acceptance probe via `require('@sanctuary/shared/schemas/mobileApiRequests')` to exercise zod transitive
- A2.5: specify `module.isBuiltin()` over regex
- F1 patterns: extend to depth-7 or switch to `no-restricted-paths`
- A2: pin zod to EXACT `4.3.6` (root's pin)

**Stop after v3.1.** Do not run iter4. Begin Phase A execution after v3.1 is in place.
