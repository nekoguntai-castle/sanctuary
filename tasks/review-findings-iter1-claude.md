# Plan review — iter 1 (Claude)

Plan reviewed: `tasks/todo.md` top entry "shared/ → npm workspace package 2026-05-10".

Re-verified facts before reviewing:
- npm 11.11.0, Node 24.14.1 (per `.nvmrc`) — `workspace:*` protocol fully supported
- Root `package.json` has `"type": "module"` (ESM); server/gateway/ai-proxy `package.json` have NO `"type"` field (default CommonJS interpretation)
- `shared/` has NO `package.json` and NO `tsconfig.json` today — consumers compile its `*.ts` files inline
- Imports go up to **5 segments deep** (e.g., `../../../../../shared/utils/bitcoin` from `server/src/services/export/handlers/coldcard.ts`); 20 such hits across server/src
- `server/Dockerfile:35` and `gateway/Dockerfile:16` do `COPY shared ../shared` — relies on shared being at `../shared` relative to package
- `vitest.config.ts` (root) has `@shared` alias; `server/vitest.config.ts` does NOT have `@shared` (server tests use relative paths)
- `server/stryker.config.mjs` and `server/stryker.critical.config.mjs` BOTH set `vitest: { configFile: 'vitest.config.ts' }` — they consume server's vitest config, not root's
- Existing `setup-server-deps` cache key hashes `server/package.json` + `server/package-lock.json`

## Phase A — Foundation

### Blocker

**A-B1. `exports` map pointing at `*.ts` files won't resolve via Node's runtime.** Phase A1 proposes `"exports": { "./utils/*": "./utils/*.ts", ... }`. Node's native ESM loader does NOT load `.ts` files. The current consumers (server, gateway) work today because `tsx` (dev) or `tsc` (build) handles TS at the toolchain layer, NOT at Node's runtime resolver. With workspaces, Node.js resolves the package via `node_modules/@sanctuary/shared/package.json`, reads `exports`, and finds a `.ts` path — then errors. **Fix:** either (a) add a `tsx`-equivalent loader or (b) compile `shared/` to `dist/` first and point `exports` at `dist/*.js`. Option (b) is the standard pattern; needs a `shared/tsconfig.json` + a `prebuild` hook. The plan's "no build step in shared/" assumption is incorrect for runtime correctness; the ONLY reason tests pass today is the toolchain transformer chain, which workspaces don't change but ALSO don't extend to Node-native resolution paths (e.g., a `node` invocation against a built artifact).

**Counterpoint to consider:** if all consumers ALWAYS use a TS-aware loader (tsx, vitest, tsc), then `.ts` exports work fine in practice. Production server runs `node dist/server/src/index.js` (compiled), so production code never imports `shared` at runtime via `@sanctuary/shared` — it's been compiled into `dist/` already. So the question reduces to: do all DEV / TEST / TOOL paths use a TS-aware loader? Probably yes. But: this should be ASSERTED and tested, not assumed.

### Should-fix

**A-S1. Phase A4 missing: server's vitest config has no `@shared` alias.** Plan A5 says "add the same alias to server/vitest.config.ts". Verified: server/vitest.config.ts has only `@` and `@fixtures` aliases. The plan should be explicit that this is a NEW addition (not "update existing"). Same for gateway/vitest.config.ts (need to verify).

**A-S2. Phase A's per-tool table claims tsc resolves via "tsconfig paths + node_modules" — but tsc honors `paths` BEFORE `node_modules` only with `--moduleResolution bundler` or `node16`/`nodenext`.** Plan should specify which `moduleResolution` setting each tsconfig uses and whether it's compatible with both alias-based and node_modules-based resolution. If server's tsconfig uses `node` resolution, the workspace symlink may not be picked up unless `paths` are also added.

**A-S3. Dockerfile interaction underspecified.** Plan A10 says "verify Docker builds" but doesn't say HOW the existing `COPY shared ../shared` will interact with workspaces. The Dockerfile currently expects `shared/` to be a sibling directory at runtime. With workspaces, `npm install --workspaces` at root produces `node_modules/@sanctuary/shared` as a symlink to `../shared`. If the Docker build does `npm install` from inside server/, it needs the shared/ workspace files present at the right location AND the root package.json + lockfile present (because workspace metadata lives there). The plan's Dockerfile changes need explicit specification — copying root `package.json` + `package-lock.json` + the shared/ dir into the build context, then running `npm ci` at root.

**A-S4. Cache-key change in A9 is too vague.** Plan says "bump cache key prefix to `-v2`". But the cache key at `setup-server-deps/action.yml:18` is parameterized by `hashFiles('server/package.json', 'server/package-lock.json')`. Once workspaces is in, the AUTHORITATIVE lockfile is at root — `package-lock.json`, not `server/package-lock.json` (npm consolidates lockfiles into the workspace root). The plan should specify whether server retains its own lockfile or uses root's. If using root's, the cache key MUST hash `package-lock.json` (root); otherwise the cache will silently never invalidate on dependency changes.

**A-S5. Order of A6 and A7.** A6 adds `@sanctuary/shared` as a `workspace:*` dep in server/gateway package.json. A7 runs `npm install`. But `npm install` requires the root `package.json` to declare workspaces FIRST (A2). Order is correct as stated, but A6 could fail if A3-A5 aren't done first (TypeScript would complain about the new dep without the path). The plan needs to clarify: A6 only changes `package.json`; A7 actually installs. If `tsc` runs as part of A7's verification (which it does in B1.3), it needs the resolution wiring from A3-A5 in place.

### Nice-to-have

**A-N1. The `exports` subpath wildcard `./utils/*` only matches one level deep.** If anything ever imports from `shared/utils/sub/foo`, it'd fail. Today nothing does (verified — shared/utils is flat). But future-proofing: use `"./utils/*": "./utils/*.ts"` AND `"./utils/*/index": "./utils/*/index.ts"` if subdirs ever appear. Or just be explicit per-module.

## Phase B — Per-package import sweeps

### Blocker

**B-B1. The sed pattern misses depth-5 imports.** Plan B1.1 lists patterns for 3 and 4 segments only. There are 20 imports at depth 5 in server/src (verified: `../../../../../shared/...` from `services/export/handlers/`, `services/scriptTypes/handlers/`, `services/bitcoin/sync/`, etc.). The plan acknowledges this in a parenthetical but doesn't include the depth-5 pattern in the listed sed command — easy to miss when executing. **Fix:** explicitly list patterns for depths 2, 3, 4, 5, 6 (overshooting is harmless), OR use a single regex that handles all depths: `s|from '(\.\./)+shared/|from '@sanctuary/shared/|g`.

### Should-fix

**B-S1. Mechanical sed is fragile.** It only catches `from '...'` and `from "..."` exactly. Misses:
- `import('...')` dynamic imports
- `require('...')` (rare but might exist in setup files)
- `vi.mock('...')` calls in tests
- Type-only imports written as `import type {} from '...'`

The plan's grep verification (B1.2) catches these as missed cases (false positives) but the FIX is still manual. **Suggested fix:** use `ts-morph` or `jscodeshift` for type-aware rewriting, OR augment the sed with a preceding grep that lists all import-like references for visual review.

**B-S2. No mid-sweep verification for ai-proxy isolation.** During Phase B, sweeping server/src might inadvertently change a file that's somehow shared with ai-proxy (unlikely but possible via a build script or symlink). Plan should add an explicit assertion in each B sub-PR's verification: `grep -r "@sanctuary/shared" ai-proxy/` returns zero hits.

**B-S3. Tests sweep B3 ignores frontend tests.** B3 says "tests/, server/tests/, gateway/tests/". But the frontend test setup uses both `@shared/*` (already migrated to alias style) and presumably some `tests/` files use relative imports too. Plan should be explicit about frontend test scope or note "frontend tests already on alias style; only old-style tests need rewriting."

## Phase C — Drop the old paths

### Should-fix

**C-S1. ESLint `no-restricted-imports` selector syntax is wrong.** Plan C3 proposes:
```js
{ selector: "ImportDeclaration[source.value=/^\\.\\.\\/(\\.\\.\\/)+shared\\//]", message: "..." }
```
But `no-restricted-imports` does NOT take `selector`. That's `no-restricted-syntax` shape. ESLint's `no-restricted-imports` takes `paths` and `patterns` arrays, with regex via `^...$` strings. The correct shape is more like:
```js
"no-restricted-imports": ["error", {
  patterns: [{
    group: ["**/shared/**", "../../shared/**"],
    message: "..."
  }]
}]
```
Or use `no-restricted-syntax` with the selector. **Fix:** specify the correct rule + verify with a deliberately-broken import.

**C-S2. The `@shared/*` alias removal in C2 will break frontend.** 12 frontend files use `@shared/*` today. C1 sweeps them to `@sanctuary/shared/*`. Then C2 removes the alias. If C1 misses any (e.g., dynamic imports, type-only imports), C2 silently breaks those at build time. **Fix:** between C1 and C2, add a grep gate: `grep -rE "from ['\"]@shared/" /home/nekoguntai/sanctuary --include='*.ts' --include='*.tsx'` returns zero hits.

## Phase D — Phase 5 redo

### Blocker

**D-B1. "Should now Just Work" assumes Stryker's sandbox copies node_modules symlinks correctly.** Stryker creates per-mutant sandboxes by copying source files. Whether it COPIES symlinks (giving the sandbox a real `node_modules/@sanctuary/shared` -> outside the sandbox -> broken) or RESOLVES symlinks (giving the sandbox a copy of shared) is implementation-dependent. The original spike (#395, #397) hit a similar class of issue. **Fix:** before D1, run a manual probe: create a sandbox manually, inspect `node_modules/@sanctuary/shared` inside it. If it's a dangling symlink, the workspace migration alone isn't enough — need to either configure Stryker's `sandbox.options` (if it supports symlink-resolution) or pre-resolve via `npm install --legacy-bundling` or similar.

### Should-fix

**D-S1. Phase D doesn't account for the test set change.** Today the critical config explicitly lists 12 test files via `CRITICAL_TEST_COMMAND`. Switching to vitest+perTest means Stryker discovers ALL tests via vitest's `include`. The mutate set is unchanged but the TEST set expands dramatically — perTest selects only relevant tests per mutant, but the initial coverage-discovery RUN still executes everything. On the server's ~9,800-test suite, that initial run alone could take 10+ minutes. Plan should specify whether to scope vitest's `include` for the critical config (e.g., a separate `vitest.critical.config.ts` that only includes the 12 critical-test files) or accept the full-suite discovery cost.

## Cross-cutting

### Should-fix

**X-S1. Phase A-D total blast radius is large; the plan estimates 2-3 days but doesn't budget for rebase pain.** This session merged ~12 PRs in a day. Phase A's blast radius is 4 workflow files + 3 tsconfigs + 3 vitest configs + 3 package.jsons + Dockerfiles + cache key bump. ANY in-flight branch will conflict. The plan's risk #5 mentions this; the action item should be: "before starting Phase A, list all open branches; rebase or close each."

**X-S2. No probe for `node_modules` symlink correctness on macOS vs Linux.** Forgejo runners are macOS (per the LAN sink deployment); developers are mostly Linux. npm workspaces creates symlinks. Both OSes handle them, but Docker-on-macOS volume mounts have historically been weird with symlinks. **Fix:** Phase A8 should explicitly verify `./start.sh --rebuild` on the macOS host (Forgejo machine) AND on a Linux dev box, not just "Docker builds succeed."

### Nice-to-have

**X-N1. Plan doesn't reference the "When to retire LAN sink" section in `tools/ci-log-sink/README.md`.** The workspace migration COULD ALSO retire the LAN sink IF Forgejo gains the logs API in the meantime — orthogonal but worth noting.

**X-N2. Phase E's "delete `tools/ci-log-sink/`" item assumes Forgejo has the logs API by then.** It doesn't. Should be removed or scoped to "if applicable."

---

## Summary by phase

| Phase | Blockers | Should-fix | Nice-to-have |
| --- | --- | --- | --- |
| A | 1 | 5 | 1 |
| B | 1 | 3 | 0 |
| C | 0 | 2 | 0 |
| D | 1 | 1 | 0 |
| Cross | 0 | 2 | 2 |
| **Total** | **3** | **13** | **3** |

## Top 3 risks

1. **`exports` map with `*.ts` paths may not resolve via Node native runtime.** Affects production-style invocations. Fix by adding a `shared/dist/` build step OR by asserting all consumers use TS-aware loaders.
2. **Stryker sandbox symlink behavior is unverified.** D1 may hit a third structural failure. Probe BEFORE switching the critical config.
3. **Sed-based codemod misses depth-5 imports + dynamic imports.** Use a real codemod tool or augment with type-aware verification.
