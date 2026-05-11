# Plan review — iter 2 (coordinator)

Plan reviewed: `tasks/todo.md` top entry "shared/ → real npm workspace package (v2) 2026-05-10".

This review focuses on findings NOT covered in `tasks/review-findings-iter2-claude.md` (forkA, 3 blockers / 10 should-fix). Numbered to make synthesis easier.

## Blockers

### C-B1. Phase A2 `exports` map omits the `.` (root) entry
The map declares only subpath patterns:
```json
"exports": { "./utils/*": ..., "./types/*": ..., "./schemas/*": ..., "./constants/*": ... }
```
Per Node's resolution rules, when `exports` is present it is **exhaustive** — the `main` field is ignored as a fallback. `import x from '@sanctuary/shared'` (no subpath) resolves to the `.` entry; without one, the import errors with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Phase A3 explicitly creates `shared/index.ts` "for legacy consumers using `import x from '@sanctuary/shared'`", but the resulting `dist/index.js` is unreachable through the exports map.

**Fix:** add `".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }` to the exports object — OR drop the index.ts story and `main` field entirely and only support subpath imports.

### C-B2. Phase G Dockerfile design leaves the workspace symlink dangling at runtime
G1 says "Production stage COPYs only `server/dist`, `server/node_modules` (which contains the resolved `@sanctuary/shared` symlink), and the built `shared/dist`." But:
- npm workspaces typically places `node_modules/@sanctuary/shared` at the **repo root**, not under `server/node_modules`. The symlink target is a relative path like `../../shared`.
- If the production stage copies the symlink without the resolved target at the same relative path, runtime `require('@sanctuary/shared/utils/errors')` fails because the symlink dangles.
- "Built `shared/dist`" needs to land at the path the symlink expects (i.e., a real `shared/` directory containing `package.json` + `dist/`), not just somewhere on disk.

**Fix:** specify EXACTLY one of (a) `cp -L` to materialize the symlink during the production-stage COPY, OR (b) preserve the symlink AND copy `shared/` to its expected relative location, OR (c) replace the symlink with a real directory containing only `package.json` + `dist/`. Each works; the plan picks none.

### C-B3. Phase F1 ESLint pattern over-matches and would block the legitimate workspace import
Phase F1's pattern list:
```js
patterns: [{ group: ["**/shared/**", "../../shared/**", "../../../shared/**"], ... }]
```
`no-restricted-imports` glob `**/shared/**` matches the import-specifier string. It would match BOTH `'../../../shared/utils/errors'` (banned, as intended) AND `'@sanctuary/shared/utils/errors'` (the new workspace path that the plan is migrating TO). Net effect: ESLint fails on every import the plan creates.

**Fix:** restrict patterns to only the relative-path forms — e.g., `["../shared/**", "../../shared/**", "../../../shared/**", "../../../../shared/**", "../../../../../shared/**"]`. Or use a negative-lookahead regex via `paths` form. Validate by adding a smoke import of `@sanctuary/shared/utils/errors` and confirming ESLint passes.

## Should-fix

### C-S1. Phase H sweep is incomplete — script is invoked from CI workflows AND CI shell scripts, not only `server/package.json`
Plan H2 lists "20 sites" in `server/package.json` (actual count: 19 — minor). But `ensure-shared-module-resolution.mjs` is also invoked by:
- `.github/workflows/verify-vectors.yml` lines 94, 266, 318 (3 invocations)
- `scripts/ci/setup-server-dependencies.sh` line 32

Total ~23 sites. Deletion without sweeping these breaks `verify-vectors` CI immediately and breaks the per-PR setup action subtly.

**Fix:** H2 should grep the entire repo for `ensure-shared-module-resolution` and remove every reference, not only the `server/package.json` ones.

### C-S2. `composite: true` adds friction with no payoff in v2
Phase A1 sets `composite: true` "even if we don't enable refs in v2". Composite mode requires:
- Every consumer file that imports from shared must list it in `references` (it doesn't), OR
- `disableSourceOfProjectReferenceRedirect` workarounds.
- Stricter declaration-emit (catches every inferred return type).
- Cannot use `noEmit` semantics in the same project.

The "future-proofing" justification doesn't survive the cost. Project references aren't planned (see "Out of scope: TypeScript Project References — Direction B picked instead"). Carrying composite mode just to maybe enable refs later means paying its costs now without benefit.

**Fix:** drop `composite: true`. Re-add later if/when project references are actually enabled.

### C-S3. shared/utils/README.md "Convention" section becomes obsolete; J1 understates the rewrite
The existing README (`shared/utils/README.md`) describes a "per-package re-export shims" convention — files like `server/src/utils/foo.ts` containing only `export * from '../../../shared/utils/foo';`. Investigation: only 4 such shims exist (`fatalProcessHandlers`, `processExit` in server and gateway). Most code imports `'../../../shared/utils/X'` directly. After the migration, ALL imports become `@sanctuary/shared/utils/X` and the shim convention has no remaining purpose.

Phase J1 says "Convention is now ENFORCED by ESLint + grep gate" — but the entire shim convention paragraph is now wrong. The README needs a rewrite, not a clause update.

**Fix:** J1 rewrites the README's "Convention" section to describe the workspace-package import pattern; deletes the shim paragraph; documents the 4 existing shim files as either remove-on-cleanup (preferred) or as legacy entries kept for stable import path.

### C-S4. Phase A1 strictness flags should match the strictest consumer, not "matching root tsconfig"
Root tsconfig has `strict: true, noImplicitAny: true, strictNullChecks: true`. Server/gateway have only `strict: true`. Frontend uses `bundler` resolution + ESM module. Phase A1 says "strict flags matching root tsconfig (verify each)" — root is the strictest, so this is correct in spirit, but worth noting that a shared/ built with looser flags would silently regress type safety at every consumption site.

**Fix:** A1 explicitly inherits root's flags (consider `extends: "../tsconfig.json"` with overrides), not "verify each".

### C-S5. Phase B3's `paths` mapping has a second risk forkA didn't fully cover
ForkA noted the `paths` → `.ts` source vs runtime `exports` → `.js` dist divergence. Adding to that: the `paths` mapping `["../shared/*"]` is **incompatible with consumer tsconfig dropping `../shared/**/*` from `include`**. Consumer's tsc with `paths` resolving to `../shared/utils/errors.ts` will type-check that file; if it's not in `include`, tsc treats it as an unrelated file and may not surface its compilation errors. Behavior is implementation-defined but often confusing. Drop `paths`; let workspace symlink resolution handle it.

### C-S6. Phase D5 — root tsconfig `paths` removal is in E1, but no codemod confirms imports were rewritten before E runs
Plan ordering: D5 sweeps frontend `@shared/*` → `@sanctuary/shared/*`, then E1 removes `@shared/*` from root tsconfig paths. If D5 missed any (regex not matching, etc.), E1 silently breaks frontend type-check until the next CI lane catches it. The grep gate in E3 is good but verifies post-removal — no pre-flight check.

**Fix:** add a step between D5 and E1: `grep -rE "from ['\"]@shared/" --include='*.ts' --include='*.tsx' .` returns 0; only then proceed to E1.

### C-S7. ai-proxy isolation runtime test (F4) — also need a Docker-level test
ForkA noted F4's design problem (root vitest can't actually prove ai-proxy isolation). My addition: even if F4 is fixed (subprocess-with-cwd approach), it tests at the npm-resolution layer. The actual production ai-proxy runs inside a Docker container with its own filesystem layout. The Docker image NEVER copies `shared/`. So a Docker-level smoke is the strongest assertion: `docker exec ai-proxy node -e "require('@sanctuary/shared/utils/errors')"` MUST exit non-zero. The "Per-tool resolution check" table at the bottom of the plan already lists this — good. But Phase F4 should reference that table entry, not stand alone with a flawed npm-only test.

### C-S8. Phase I probe assumes Stryker has a `--dryRunOnly` flag
"Run via: `cd server && npx stryker run stryker.config.mjs --dryRunOnly` (if Stryker supports it)" — checking: Stryker has `--dryRun` (deprecated), no `--dryRunOnly`. Modern Stryker: pass `--mutate` to a tiny scope (one file) for fast probe, OR use `npx stryker run --logLevel debug` and inspect the sandbox before tests run.

**Fix:** I1 specifies the actual probe command. Suggested: `cd server && MUTATION_SHARD=1 npx stryker run stryker.critical.config.mjs --logLevel trace 2>&1 | head -200` then inspect for sandbox path; OR set `cleanTempDir: false` in the config (which Stryker supports), run the suite, then `ls .stryker-tmp/sandbox-*/node_modules/@sanctuary/`.

## Nice-to-have

### C-N1. Frontend bundle-size impact under-explored
After Phase D5, frontend `@shared/*` imports become `@sanctuary/shared/*` resolved through the package's `exports` to CJS-built `dist/*.js`. Vite handles CJS interop, but tree-shaking degrades for CJS modules vs the current ESM-source path. May increase bundle size 5-15 KB depending on how aggressively tree-shaking was working before.

**Fix (optional):** add a "before/after" bundle-size measurement to Phase J as evidence that the move didn't regress the frontend.

### C-N2. Target alignment
Phase A1 picks `target: "ES2020"` for shared. Server is ES2020 (matches), gateway is ES2022, root is ES2022. Picking the lowest target means gateway/frontend compile shared's output without using ES2022 features it could otherwise use (e.g., `Array.prototype.at`, `Object.hasOwn`). Marginal but consistent: ES2022 across the board.

## Convergence with forkA

I converge with forkA on these (different angles, same target):
- A2 dependency declaration (forkA: zod missing) — strong agreement; my C-S4 is adjacent.
- B3 `paths` vs `exports` divergence — forkA's "fix (b) drop paths" matches my C-S5.
- F1 enforcement scope — forkA caught productionSource doesn't cover server/gateway; I caught the rule pattern over-matches the workspace path. **Both must be fixed; they are independent bugs in the same Phase F1.**
- F4 ai-proxy runtime test design — forkA caught test runs from wrong cwd; I add Docker-level test should be authoritative.
- H regression test design — forkA caught it's a placebo; I add the deletion sweep is incomplete (C-S1).

Net unique to me: C-B1 (exports map missing root), C-B2 (Docker symlink), C-B3 (ESLint pattern), C-S1 (sweep scope), C-S2 (composite), C-S3 (README rewrite scope), C-S8 (probe command), C-N1 (bundle), C-N2 (target).

## Summary

| Severity | Count |
| --- | --- |
| Blocker | 3 |
| Should-fix | 8 |
| Nice-to-have | 2 |

## Top 3 risks (this iteration)

1. **C-B2 Docker symlink:** plan as written produces a runtime image where `require('@sanctuary/shared')` dangles. **Phase G1.**
2. **C-B3 ESLint pattern over-matches:** F1 would block every import the migration creates. **Phase F1.**
3. **C-B1 exports map root entry missing:** any bare `@sanctuary/shared` import (and the codemod plus IDE conveniences may produce these) errors at runtime. **Phase A2.**
