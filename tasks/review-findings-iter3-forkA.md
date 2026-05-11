# Iter3 Review — shared/ → real npm workspace package (v3) — Fork A

Reviewer: independent third-iteration structural-soundness reviewer.
Method: spot-checked v3's "fixed in v3" claims against actual source files at `/home/nekoguntai/sanctuary/`.
Scope: NEW issues introduced by v3 changes themselves, plus iter2-fix-applied-incorrectly cases. Per the brief, anything already raised in iter2 review files that v3 addressed correctly is excluded.

---

## Convergence assessment

**(b) v3 still has 4 net-new blockers — this plan needs structural reconsideration before Phase A execution, not more iteration in the current shape.**

The blockers are not "wording quibbles": they are exactly the same *implementation surface gap* pattern that iter1 and iter2 flagged (Dockerfile cascade, frontend resolution, codemod scope) — each iter discovers a new instance because the plan keeps treating its enumeration of touched files as complete when it isn't. v3 has converged on the *categories* (Docker, ESLint, ts-morph, CI workflows) but the per-row enumerations within those categories are still incomplete.

Two of the four blockers are factually wrong premises that v3 introduced trying to fix iter2 findings (F1b's "frontend-only `productionSource`" claim; H3's wrong symlink target). These are regressions in plan accuracy that the iter1/iter2 plans did not have because they didn't take a strong stance on those points.

Recommendation: **fix the 4 blockers in a v3.1 patch (not full v4 rewrite)**, then proceed. The architectural shape of v3 (Direction A, dual-resolution Phases A–E, F enforcement, G Docker, H deletion, I Stryker probe, J docs) is sound and does not need to be reopened.

---

## Blockers

### B-iter3-1. F1b's premise is factually wrong: `productionSource` ALREADY covers server/gateway

v3 row 18 (line 18 of todo.md, the "What changed from v2" table) and Phase F1b both say:

> F1 `productionSource` config block doesn't cover server/gateway → F1 adds a SEPARATE ESLint config block `{ files: ["server/src/**/*.ts", "gateway/src/**/*.ts"], rules: {...} }` so the rule actually fires on the 58 imports the migration aims to police

Verified at `/home/nekoguntai/sanctuary/eslint.config.js:4-16`:

```js
const productionSource = [
  'App.tsx',
  'components/**/*.{ts,tsx}',
  // ...
  'shared/**/*.ts',
  'server/src/**/*.ts',     // line 14 — server IS covered
  'gateway/src/**/*.ts',    // line 15 — gateway IS covered
];
```

Server/src and gateway/src are ALREADY in `productionSource`. The whole F1b "separate block" prescription is unnecessary; if it lands as written, the codebase will have two parallel rule blocks for server/gateway, with overlapping scope. The fix is trivial — add the new `no-restricted-imports` rule to the EXISTING `productionSource` block at lines 37–82, not a new block — but the v3 plan's diagnosis of WHY the rule supposedly wouldn't fire is incorrect, and that incorrect diagnosis is what justifies the proposed shape.

This is a regression vs v2: v2 didn't take a stance, so it wasn't wrong; v3 took a stance based on a misread of the file.

**Fix:** rewrite F1b to "add the `no-restricted-imports` rule to the existing `productionSource` rule block (lines 53–80 of `eslint.config.js`). `productionSource` already includes server/src and gateway/src." Drop the "separate config block" prescription entirely.

---

### B-iter3-2. H3's regression test is testing the wrong thing — `ensure-shared-module-resolution.mjs` does NOT touch `node_modules/.prisma/client`

v3 H3 (lines 343–345) says:

> Real regression test (per iter2 — the placebo from v2 passed before deletion too):
> Replicate the failure conditions: in a test, delete `node_modules/.prisma/client` (the historical script's symlink target) THEN verify `await import('../generated/prisma/client')` succeeds under workspaces.

Verified `/home/nekoguntai/sanctuary/server/scripts/ensure-shared-module-resolution.mjs`:

```js
const serverNodeModules = resolve(serverRoot, 'node_modules');
const repoNodeModules = resolve(repoRoot, 'node_modules');
// ...
if (pathExists(repoNodeModules)) { process.exit(0); }
// ...
symlinkSync(serverNodeModules, repoNodeModules, ...);
```

The script symlinks `<repo-root>/node_modules` → `<repo-root>/server/node_modules` (the ENTIRE node_modules dir), not anything under `node_modules/.prisma/client`. v3's H3 deletion target is wrong. A test that deletes `.prisma/client` proves nothing about whether the script is load-bearing — the script never created `.prisma/client` in the first place.

The actual failure mode the script protected against: a process running from `/sanctuary/<dir>` looks for shared's transitive dependency (`zod`) by walking up the filesystem from a `shared/` import; if `<repo-root>/node_modules` doesn't exist, the walk fails. The script symlinks `<repo-root>/node_modules` → `<server>/node_modules` so the walk succeeds.

**Fix:** rewrite H3 to "delete `<repo-root>/node_modules` (or rename it temporarily) and verify a test that imports `@sanctuary/shared/schemas/mobileApiRequests` (which transitively requires `zod`) still resolves under workspaces. Specifically: confirm npm 11 workspaces creates the symlink at `<repo-root>/node_modules/@sanctuary/shared` AND hoists `zod` to `<repo-root>/node_modules/zod`, so the resolver walk from `shared/` still finds `zod` even if the script never runs."

The wider implication: v3 still hasn't actually identified WHY the script exists. The H1 sub-task says "read the script's actual code [...] enumerate every side effect" — but H3 is written as if H1 has already concluded the script is purely about `.prisma/client`. The execution order is broken.

---

### B-iter3-3. v3 G2 (gateway Dockerfile) does not enumerate the `ln -s /app/node_modules /node_modules` hack at line 24, and gateway uses `npm prune --production --omit=optional` which v3 G4.5 doesn't account for

v3 G1 (line 306) explicitly removes the legacy `ln -s` hack at `server/Dockerfile:44`. G2 (line 308) says only "same shape as G1, including the (c) COPY strategy and acceptance probe." But:

1. `gateway/Dockerfile:24` has the IDENTICAL `RUN ln -s /app/node_modules /node_modules` hack, but G2 doesn't call it out. Without explicit enumeration, the executor of Phase G could plausibly leave the gateway hack in place ("we removed the server one, gateway is `same shape`").
2. `gateway/Dockerfile:31` runs `npm prune --production --omit=optional` (server's prune is just `npm prune --production`). The `--omit=optional` flag interacts with workspace symlinks differently — optional deps in shared (none today, but possible) would be dropped, and the symlink-vs-copy strategy from G1c needs explicit verification under `--omit=optional`. G4.5 only references the server's prune behavior.

**Fix:** rewrite G2 to enumerate the same line-removal task explicitly (`gateway/Dockerfile:24 RUN ln -s ...`), AND add a separate G4.5b acceptance probe for the `--omit=optional` interaction.

Lower-but-related: `docker-compose.test.yml:75` and `:110` bind-mount `./shared:/shared:ro` into backend test containers; `frontend-test`/`frontend-coverage` (lines 123–161) bind-mount `./node_modules:/app/node_modules:ro` but do NOT mount `./shared`. After workspace migration, `node_modules/@sanctuary/shared` is a symlink to `../shared/`. In the frontend test container that mount becomes a DANGLING symlink (`/app/node_modules/@sanctuary/shared` → `/app/shared`, which is unmounted). Frontend vitest will fail to resolve `@sanctuary/shared/*` inside the container. v3 G5 enumerates 9 cache/workflow sites but does not enumerate `docker-compose.test.yml`. Net-new gap on top of the explicit blocker above.

---

### B-iter3-4. v3 A1's `extends: "../tsconfig.json"` will inherit `noEmit: true`, breaking Phase A5's build

v3 A1 (line 68) prescribes:

> `extends: "../tsconfig.json"` for strict flag inheritance (root has the strictest set: `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`)

Verified `/home/nekoguntai/sanctuary/tsconfig.json`:

```json
{
  "compilerOptions": {
    // ...
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": { "@/*": ["./*"], "@shared/*": ["./shared/*"] },
    "allowImportingTsExtensions": true,
    "noEmit": true                                          // ← inherited!
  }
}
```

The shared tsconfig will inherit `noEmit: true`. Phase A5 will run `tsc -p tsconfig.json` and produce ZERO output (no error, just silent no-op). `shared/dist/` will not exist; A6 will fail because consumer relative imports STILL work (they don't depend on `dist/`), but B5's `node_modules/@sanctuary/shared/dist/index.js` will be missing once consumers switch to the workspace path.

The `target: ES2020` line in A1 already overrides root's `target: ES2022`, so the executor MIGHT think to override `noEmit` too — but the plan doesn't mention it. Worse, `allowImportingTsExtensions: true` is incompatible with `--declaration: true` (which A1 specifies) — tsc errors out with `option 'allowImportingTsExtensions' can only be used when 'noEmit' or 'emitDeclarationOnly' is true`. So inheriting from root forces a paradox.

**Fix:** drop `extends: "../tsconfig.json"`. Either (a) hand-write the strict-flag triple (`strict: true, noImplicitAny: true, strictNullChecks: true`) at the top of shared's tsconfig — three lines — or (b) introduce a new minimal `tsconfig.base.json` at root containing only the strict-flag triple, and have BOTH root and shared extend that. Option (b) is cleaner long-term but option (a) is fine for v3 scope.

---

## Should-fix

### S-iter3-1. v3 still undercounts test-directory shared imports (`tests/ 6` should be `tests/ 9`)

Re-verified facts line 48 says: "Imports counts: server/src 47, gateway/src 11, **tests/ 6**, ai-proxy/src 0, frontend (`@shared/*` style) 12".

Actual count via `grep -rn "from ['\"]\.\./.*shared/\|from ['\"]@shared/" tests --include='*.ts' --include='*.tsx'`: **9 hits** (5 relative-style + 4 alias-style across `tests/shared/`, `tests/services/`, `tests/utils/`, `tests/components/`).

This isn't a structural blocker — D5 sweeps via tsconfig file lists, not the count — but the count appears in the plan as an authority claim and is wrong by 50%. If the count is wrong here, future maintainers will trust other re-verified counts that may also be off.

**Fix:** re-grep and update the count, or qualify as "approximate; the codemod sweeps via tsconfig source file lists, not by hand-count."

### S-iter3-2. v3 D1's tsconfig list misses `server/tsconfig.test.full.json`

D1 enumerates: `server/tsconfig.json`, `server/tsconfig.test.json`, `gateway/tsconfig.json`, `tsconfig.app.json`, `tsconfig.tests.json`, `tsconfig.scripts.json`. But `/home/nekoguntai/sanctuary/server/tsconfig.test.full.json` exists, extends `tsconfig.test.json`, and has a different `include` list (`["src/**/*", "tests/**/*", "../shared/**/*"]`) and different module resolution (`module: ESNext, moduleResolution: bundler`). It's used by `server/package.json` typecheck:tests:full script (verify).

Per ts-morph semantics, when you instantiate `Project({ tsConfigFilePath })` against a config with different module resolution, the resolved file set may differ. Skipping `tsconfig.test.full.json` could leave a few imports unrewritten if that config sees files the others don't.

**Fix:** add `server/tsconfig.test.full.json` to D1's CONFIGS array, OR document why it's redundant (same source files as test.json, just different lib/module).

### S-iter3-3. zod version mismatch between root (`4.3.6` exact) and server/gateway/ai-proxy (`^4.3.4`) — v3 A2 doesn't address

v3 A2 says `"zod": "<copy version from server/package.json>"`. server has `^4.3.4` (caret). Root devDependencies (line 133 of root `package.json`) has `"zod": "4.3.6"` (exact). gateway and ai-proxy also have `^4.3.4`.

Under npm workspace hoisting, the highest matching version wins — likely `4.3.6` from the root pin if that's what's most recently installed. But if shared declares `^4.3.4` and a transitive elsewhere pulls a later 4.x, hoisting may surface a different copy than server expects, and `import { z } from 'zod'` could see different behavior between server-direct-import and shared-transitive-import (different `instanceof` semantics on the ZodError class across copies — a real footgun).

**Fix:** A2 should pick the EXACT root pin (`4.3.6`) and document that all four declarations should align on the same exact version going forward. Or add a CI check that all four `zod` declarations resolve to the same lockfile version.

### S-iter3-4. v3 doesn't address frontend coverage instrumentation for `shared/**/*.ts` once consumers resolve via `dist/`

`vitest.config.ts:40` includes `shared/**/*.ts` in coverage `include`. After Phase E, frontend tests resolve `@sanctuary/shared/*` to `shared/dist/*.js` (v8 coverage instrumented), not `shared/*.ts`. The 100% coverage threshold (line 83) currently applies to `shared/*.ts` source files; under the new resolution, frontend tests will instrument `dist/*.js` while `shared/*.ts` will appear UNCOVERED in the report (zero-hit), failing the 100% threshold.

Options the plan needs to pick from:
- (a) keep `shared/**/*.ts` in coverage include AND keep an alias-style resolution path for vitest specifically (regress v3's "single resolution" goal)
- (b) configure v8 source-map–based coverage that re-attributes hits in `shared/dist/*.js` back to `shared/*.ts` source via the declarationMap (v3 A1 enables `declarationMap: true` but not `sourceMap`-aware coverage)
- (c) move shared coverage measurement into shared's own test suite (currently shared has no `tests/` of its own at the package level)

**Fix:** add a Phase E or J task that picks one option and verifies the 100% threshold still passes against `shared/*.ts` under workspace resolution.

### S-iter3-5. v3 G1 picks COPY strategy (c) but does not adapt the existing 3-stage Dockerfile structure

server/Dockerfile already has 3 stages (deps, builder, runner) with `WORKDIR /app` and `COPY server/package*.json ./` (i.e., it copies SERVER's package.json to /app, not root's). Strategy (c) says "Replace symlink with a hand-built `node_modules/@sanctuary/shared/` directory containing just `package.json` + `dist/`" but does not address:

1. The deps stage runs `npm ci` against `server/package.json` ALONE. Under workspaces, server's package.json declares `"@sanctuary/shared": "workspace:*"` — this fails immediately because workspace specifiers are only resolvable from a workspace ROOT. The deps stage either (i) needs to copy root's `package.json` + `package-lock.json` and run from there, OR (ii) needs to install with `--no-package-lock` and a stub @sanctuary/shared (ugly).
2. The COPY of shared (line 35 `COPY shared ../shared`) puts shared at `/shared`, not `/app/shared`. Strategy (c)'s "hand-built `node_modules/@sanctuary/shared/` directory" needs to know where shared was built and copy its `dist/` from there.
3. The CMD path discrepancy: package.json says `dist/server/src/index.js` but Dockerfile CMD is `dist/app/src/index.js` (because `rootDir: ".."` resolves differently from /app vs from /sanctuary/server). v3 B3b's cascade list doesn't enumerate the Dockerfile CMD because it claims `main: "dist/index.js"` — but that's only achievable after rootDir cleanup.

**Fix:** v3 G1 needs an explicit "Dockerfile structural rewrite" sub-task that addresses (1)/(2)/(3). The current G1 prescription assumes a build context restructure that isn't in scope.

### S-iter3-6. v3 doesn't note that root tsconfig EXCLUDES `server, gateway, ai-proxy` (line 36–38)

After Phase B, when root runs `npx tsc -p tsconfig.app.json` (frontend typecheck), it still excludes the workspace packages — fine. But IF a shared codemod or developer expects "tsc at root sees all workspace TS files," that assumption is wrong. v3 doesn't claim this, but the iter2 codemod scope debate (D1) hinges on per-tsconfig Projects, which is right precisely because root tsconfig excludes server/gateway. Worth a one-line note in "Re-verified facts" so future iterations don't try to consolidate.

**Fix:** add to "Re-verified facts": "root `tsconfig.json:34-40` excludes `server, gateway, ai-proxy, scripts/verify-addresses` — D1's per-tsconfig Project loop is required, not optional."

---

## Nice-to-have

### N-iter3-1. v3 H2 still calls out 19 server/package.json sites; actual is 19 hits in `package.json` but several are in scripts that share the same prefix-hook hook (e.g., all the `pretest:*` are conceptually one removal). Phase H2 reads as 23 atomic file edits when it's closer to 6 distinct package.json keys + 3 yml lines + 1 sh line = 10 logical edits.
- Cosmetic only; does not affect correctness.

### N-iter3-2. v3 G3 says "ai-proxy/Dockerfile: NO CHANGES (preserves isolation)." Worth adding "AND verify the build context still copies `ai-proxy/package*.json` from the SAME path under workspace migration" — under workspaces, root `package-lock.json` collapses but `ai-proxy/package-lock.json` is preserved (per G5 row 4). Confirm the Dockerfile's COPY model still works.

### N-iter3-3. v3 B9 "ESM-from-CJS bare-import smoke" is good, but doesn't pin a TYPE-LEVEL smoke. A `.mts` file (or a vitest test in an ESM-typed file) that imports `import type { ZodError } from '@sanctuary/shared/schemas/mobileApiRequests'` would catch type-resolution failure (which can happen even when runtime resolution succeeds, due to missing `types` in exports map subpaths).
- v3 A2's exports map DOES specify `types` per-subpath — but verification belongs in B9.

### N-iter3-4. v3 J1 mentions "the 4 existing shim files" (server/gateway × fatalProcessHandlers/processExit). Actually the codebase shows 5 hits per the working-tree status (`server/src/utils/fatalProcessHandlers.ts`, `gateway/src/utils/fatalProcessHandlers.ts`, two `processExit.ts` per the count, plus `ai-proxy/src/fatalProcessHandlers.ts` which is DIFFERENT — ai-proxy intentionally re-implements). Worth disambiguating in J1 to avoid an executor accidentally deleting ai-proxy's intentional duplicate.

---

## Summary of pattern

v3 has fixed the v2 *blockers* it explicitly enumerates, but in two cases (F1b, H3) it introduced new wrong premises. The implementation-surface enumeration gap that iter1 → iter2 → iter3 keeps surfacing has not been closed: each review finds a few more sites the previous iteration missed (`tsconfig.test.full.json`, `docker-compose.test.yml`, the gateway Dockerfile `ln -s` hack, the gateway `--omit=optional` prune flag, frontend coverage instrumentation, the deps-stage workspace-spec resolution issue).

This is convergent in *category* but not in *exhaustive line-item enumeration*. The right next move is a v3.1 patch that:
1. Fixes the 4 blockers above
2. Replaces "Re-verified facts" hand-counts with shell commands the executor runs at Phase A start (so the counts are always fresh)
3. Adds a Phase A0 "find every site that touches `shared/`" via `git grep` matrix (Dockerfiles, docker-compose*, tsconfig*, eslint*, vitest*, vite*, .yml CI, package.json scripts)

After v3.1, proceed to Phase A. Don't iterate further on v3 in its current shape — the additional value per review iteration is shrinking and the plan is now structurally sound enough to begin executing the dual-resolution Phase A safely.
