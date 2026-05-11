# Review iter3 ForkB — shared/ → workspace package (v3)

Reviewer: independent third-pass contrarian. Did not coordinate with the parallel iter3 reviewer. Verified each finding against repo HEAD on `fix/unhandled-rejection-fatal-shutdown`.

## Convergence assessment

**Verdict: needs more iteration — one structural blocker (B3a paths-drop) plus two CRITICAL falsifying-the-acceptance-test issues (D7 cache pre-warm, H3 wrong path).**

The plan is mostly converged on intent, but three separate items would let bad behavior pass an acceptance check that thinks it succeeded:

1. **B3a's "drop `paths` entirely; workspace symlink handles type-check resolution natively under `moduleResolution: node`"** — false in general. `moduleResolution: "node"` (legacy classic-with-node-flavor) does NOT honor a package's `exports` field. It walks `node_modules/@sanctuary/shared/<subpath>` directly looking for `.ts`/`.d.ts`/`.js`. With shared's source at the package root and types/JS in `dist/`, `import '@sanctuary/shared/utils/errors'` would try to resolve `node_modules/@sanctuary/shared/utils/errors.d.ts` — which won't exist after build (`dist/utils/errors.d.ts` is where it actually lives). The plan needs either (a) `moduleResolution: "node16"`/`"nodenext"` on consumers, OR (b) a `paths` mapping at `["../shared/dist/*"]`, OR (c) shared emits to package root (`outDir: "."`), OR (d) re-add the workspace symlink + a `package.json` strategy that puts `dist/utils/errors.d.ts` at the path the resolver actually walks.
2. **D7 pre-warm theory is wrong** — Stryker has `incremental: true` keyed on file content hashes inside `.stryker-cache/critical-incremental.shard-N.json`. Pre-warming on a no-op PR cannot warm against the post-D content; the FIRST run after D will invalidate every entry regardless. The promised mitigation does nothing.
3. **H3 deletes the wrong path** — Prisma's generator output is `../src/generated/prisma` per `server/prisma/schema.prisma:6`. There is no `node_modules/.prisma/client` directory in this repo. The proposed regression test would always pass (the path doesn't exist to begin with) — same placebo class as v2.

The plan is one re-spin away from converged on the structural side; D7 and H3 are localized rewrites that don't reshape phases.

---

## CRITICAL (blockers — would cause silent acceptance-test passes or runtime resolution failures)

### C-1. `moduleResolution: "node"` ignores `exports` map (Vector 2)

Repo verification:
- `server/tsconfig.json:14` → `"moduleResolution": "node"`
- `gateway/tsconfig.json:13` → `"moduleResolution": "node"`
- Root `tsconfig.json:22` → `"moduleResolution": "bundler"` (does honor exports)

The legacy `node` resolver pre-dates the `exports` field and resolves subpaths by direct filesystem walk inside the package directory. Given shared's layout after Phase A:
```
shared/
├── package.json   (exports: { "./utils/*": "./dist/utils/*.js" })
├── utils/errors.ts        <-- source still here
└── dist/utils/errors.{js,d.ts}
```
`tsc` under `moduleResolution: node` resolving `@sanctuary/shared/utils/errors` will walk `node_modules/@sanctuary/shared/utils/errors.{ts,tsx,d.ts}` (in that priority order) and find `utils/errors.ts` first (because the symlink target IS the source dir). **Two cascading consequences:**

1. **Type resolution accidentally succeeds** in dev/test from the SOURCE `.ts` file (because the `.ts` is found before the `.d.ts`), masking the bug. CI may pass.
2. **Runtime `require('@sanctuary/shared/utils/errors')` fails** — Node's runtime resolver DOES honor `exports`, looks for `dist/utils/errors.js` per the map, finds it, returns it. Tsc-time and runtime resolve DIFFERENT files of differing content. This is the EXACT divergence class B3a's "drop paths" was trying to eliminate. It just shifts the divergence from `paths` vs `exports` to `node-resolver-walk` vs `runtime-exports-map`.
3. **Worse**: if a future contributor edits `shared/utils/errors.ts` and forgets `npm run build`, dev passes (resolves source) but Docker prod resolves stale `dist/utils/errors.js`. Silent skew.

Fix paths (pick one, ranked by elegance):
- **Best**: bump server/gateway to `moduleResolution: "node16"` (or `"nodenext"`); now `exports` is honored at TS time. Modest scope; needs a sweep for CJS/ESM `.js` extension requirements on relative imports — probably ~50-100 import statements need extension hints. Test before committing.
- **Second-best**: re-add `paths: { "@sanctuary/shared/*": ["../shared/dist/*"] }` in B3 (point at dist, NOT source — same target as runtime). Plan currently rejects this; un-reject.
- **Third**: emit shared with `outDir: "."` so `utils/errors.{js,d.ts}` sit next to `utils/errors.ts` at package root; node resolver finds them; `.gitignore` `dist/` no longer covers them — A4 needs to grow exclusion patterns. Ugly.
- **Worst**: leave as-is, hope dev never edits source without rebuilding. Don't.

This is the biggest unaddressed risk in v3.

### C-2. D7 mutation-gate "pre-warm via no-op PR" doesn't work (Vector 6)

`server/stryker.critical.config.mjs:67-68`:
```js
incremental: true,
incrementalFile: shardIncrementalFileName(SHARD.id),
```

Stryker incremental cache stores per-file content hashes inside the `.json` cache file. Two cache layers exist:
1. **Workflow cache** (`actions/cache@...` with key from `hashFiles(...)` at `test.yml:525`) — the TARBALL of `.stryker-cache/`
2. **Stryker's internal hash** stored inside the JSON

The plan claims pre-warming on a no-op PR right after D merges helps. It doesn't:
- Workflow cache key only changes if the listed source files change. After D codemod merges into `main`, those listed files (e.g. `server/src/middleware/auth.ts`) HAVE new import statements → new hashes → new cache key. The no-op PR after D either (a) inherits the post-D content (merged from main) → cache key DOES change but the JSON still has stale internal hashes → Stryker invalidates everything anyway, OR (b) is on a branch off pre-D → cache restores against pre-D code which is meaningless.
- Stryker can only mark a mutant "unchanged" if its file's content hash matches the cache entry. After D rewrites every shared import in every covered file, no matches exist. First run is full ~25min regardless of pre-warm.

Replace D7 with: just budget the slow first run; remove the "(a) pre-warm on no-op PR" option; (b) "document and accept" was correct.

### C-3. H3 regression test deletes a path that doesn't exist (Vector 7)

`server/prisma/schema.prisma:4-6`:
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}
```

Verified on disk: `server/src/generated/prisma/client.ts` exists; `find /home/nekoguntai/sanctuary -name ".prisma" -maxdepth 4` returns nothing.

The plan's H3 says "delete `node_modules/.prisma/client`". That directory is the DEFAULT Prisma output location for generators that don't override `output`. This repo overrides. The path the regression test targets doesn't exist in this repo — `rm -rf node_modules/.prisma/client` is a no-op, the subsequent `await import('../generated/prisma/client')` will succeed because nothing was destroyed. **Same placebo class as v2.**

Real test should:
- `rm -rf server/src/generated/prisma` AND `rm -rf server/node_modules/@prisma/client` (the runtime side of `@prisma/client` package), THEN
- Verify `npx prisma generate` regenerates correctly under workspaces
- Verify `require('@prisma/client')` resolves from `node_modules/@prisma/client` after lockfile collapses to root
- Read `server/scripts/ensure-shared-module-resolution.mjs` (already done in iter3 — it symlinks `<repoRoot>/node_modules` → `<serverRoot>/node_modules` only when root has no `node_modules`). Under workspaces, root ALWAYS has `node_modules`, so the script is genuinely a no-op. The relevant regression to test is whether anything OUTSIDE the script's narrow happy path also relied on the symlink existing — e.g. Prisma engine's runtime path lookup that walks from `prisma-client-js` package up, looking for `.prisma/client` at any ancestor `node_modules`. That path is the ONE the script's symlink may have been satisfying for tools that didn't read `output`.

Concrete actionable test (replace H3):
```bash
cd /tmp && rm -rf wt && cp -a /home/nekoguntai/sanctuary wt && cd wt
rm -rf node_modules server/node_modules
npm install                          # under v3 workspace setup
cd server && npx prisma generate      # writes to src/generated/prisma per schema
cd .. && rm -rf node_modules           # remove root node_modules to simulate post-prune scenario
node -e "require('./server/dist/server/src/generated/prisma/client.js')"  # MUST succeed
```
If THIS fails after deletion of root `node_modules`, the script was load-bearing for the prisma client resolution path.

---

## HIGH (correctness gaps, plan likely succeeds in dev but ships a footgun)

### H-1. B4 vitest alias to `dist/` breaks coverage instrumentation for shared (Vector 4)

`server/vitest.config.ts:24` → `coverage.provider: 'v8'`, `coverage.include: ['src/**/*.ts']`.

Server coverage doesn't currently include `shared/` files (they're not under `src/**`), so v8 wouldn't be instrumenting them anyway. Aliasing `@sanctuary/shared` → `shared/dist` makes vitest load **compiled JS without source-mapped TypeScript** for tests that import from shared. Two concrete consequences:

1. **Stack traces in failing shared tests** point at `shared/dist/utils/errors.js:42` not `shared/utils/errors.ts:42`, despite source maps existing. Vitest does honor source maps from emitted JS, so this should resolve correctly IF `shared/tsconfig.json` has `sourceMap: true` (A1 specifies this) and IF `shared/dist/utils/errors.js.map` ships next to the JS. Acceptance: confirm a deliberately-failing shared test prints a `.ts:line` location, not `.js:line`.
2. **Frontend coverage is held at literal 100%** per CLAUDE.md and `vitest.config.ts:71-73`. If frontend tests import from `@sanctuary/shared/...` aliased to `dist/`, the v8 coverage of frontend won't see the shared source as covered (it was excluded anyway via `coverage.include` scope) — no change. But IF the frontend coverage config previously inferred shared coverage from its `@shared/*` alias to source, switching to the dist alias removes that inference. Audit `vitest.config.ts` (root) coverage.include/exclude before E2 to verify no shared paths are listed; if they are, remove them.

Fix: add a one-line acceptance to B6 — "deliberately throw from a shared util in a smoke test, assert the stack trace contains `shared/utils/errors.ts` (not `.js`)."

### H-2. F1c smoke test infrastructure is heavyweight (Vector 5)

The plan's F1c says: "add a `tests/smoke/eslint-shared-import.test.ts` that runs ESLint programmatically over a fixture file." Concerns:

- **ESLint's flat-config programmatic API** (`new ESLint({ overrideConfigFile: ... })`) requires loading every plugin the repo uses (typescript-eslint, react, vitest, etc.). In a vitest test context this is ~3-5 seconds of startup per run and fragile — plugin version skew breaks the smoke without breaking real ESLint.
- **The actual goal** is "if a future PR re-adds `**/shared/**` to no-restricted-imports patterns, CI catches it." Lighter weight: a `scripts/quality/check-eslint-shared-pattern.sh` that greps `eslint.config.{js,mjs,cjs}` for the literal `**/shared/**` pattern and fails. ~5 lines of shell, no plugin loading, no flake surface.
- **Or simpler**: a unit test of the ESLint config file itself. Import the config object, assert `config.find(c => c.files?.includes('server/src/**/*.ts'))?.rules['no-restricted-imports'][1].patterns[0].group` does NOT contain `**/shared/**`. ~10 lines, runs in ms.

F1c as-written is overkill and likely flake-prone. Replace with one of the two lighter options.

### H-3. Phase D codemod sequencing — Project requires node_modules to exist

Vector 1 question: can D run before B installs the workspace?

Answer: **no, and the plan ordering is correct (D follows B/C).** But D1's code instantiates `new Project({ tsConfigFilePath: cfg.path })` for SIX tsconfigs. ts-morph's Project loader resolves all `references`, `extends`, AND types listed under `compilerOptions.types`. After Phase B installs workspaces:

- `server/tsconfig.json` extends nothing, uses `"types": ["node"]` → needs `node_modules/@types/node` resolvable from server's perspective
- `tsconfig.app.json` (root) likely has `extends: "./tsconfig.json"` and references vite/react types → needs root `node_modules`
- `tsconfig.tests.json` references vitest globals

After B's `npm install` at root, root `node_modules` exists. `--workspaces` makes server/gateway packages symlinked at `node_modules/sanctuary-server` etc. Per-package `node_modules` MAY OR MAY NOT exist depending on hoisting.

ts-morph instantiation can fail with "Could not find @types/node" if hoisting put types at root but server's `Project` loader doesn't walk up. This isn't a blocker but D1 should add: "before running, verify `cd <pkg> && npx tsc --noEmit` succeeds — proves type resolution works for that tsconfig. If it doesn't, the codemod will fail in confusing ways."

Add a pre-flight check to D1: `for cfg in CONFIGS; do (cd $(dirname cfg) && npx tsc --noEmit --skipLibCheck); done` — must all pass before Project instantiation. Catches missing types before the codemod runs.

### H-4. G5 architecture.yml: `npm --prefix server ci` → `--workspace=server` semantics

Vector 9 question. Verified `architecture.yml:67-73`:
```yaml
scripts/ci/retry-command.sh "root npm ci" npm ci --audit=false --fund=false ...
scripts/ci/retry-command.sh "server npm ci" npm --prefix server ci ...
```

Root `npm ci` runs FIRST. Under v3, root has `workspaces: ["shared", "server", "gateway"]`, so `npm ci` at root installs all three workspaces — the per-package `npm --prefix server ci` is REDUNDANT, not impossible. `--workspace=server` would also work (root is installed). So the migration is safe IF the per-package commands are simply REMOVED rather than translated.

But: `architecture.yml` runs in an isolated worktree (`scripts/ci/create-isolated-workspace.sh architecture`). The worktree doesn't share `node_modules` with the repo root. So `cd $ARCH_WORKDIR && npm ci` does fresh install in the worktree. Per-package `npm --prefix server ci` AT the worktree, after root install, would currently re-install server's lockfile-derived tree. **After v3 migration, server has no lockfile** — `npm ci --prefix server` would error "no package-lock.json". G5 must REMOVE per-package commands, not translate them.

The plan's G5 says "Replace with `npm ci --workspace=server` from root". `--workspace=server` from root REQUIRES the root install to have completed. In architecture.yml it has. But this command is also pointless — root `npm ci` already installed server. **Just delete the lines.** The plan's G5 wording over-engineers it.

### H-5. G1c hand-built `node_modules/@sanctuary/shared/` — zod resolution at runtime (Vector 3)

Plan: production stage receives a hand-built `node_modules/@sanctuary/shared/` containing only `package.json` + `dist/`. When server's compiled code does `require('@sanctuary/shared/utils/errors')`, Node resolves to `/app/node_modules/@sanctuary/shared/dist/utils/errors.js`. Inside that file, the import for zod (transitive via `shared/schemas/mobileApiRequests.ts`) becomes `require('zod')`.

Node's resolver for nested packages: walks UP from `/app/node_modules/@sanctuary/shared/` looking for `node_modules/zod` at each ancestor. So:
- `/app/node_modules/@sanctuary/shared/node_modules/zod` — NOT present (G1c only ships package.json + dist)
- `/app/node_modules/@sanctuary/shared/node_modules` — does it even exist? G1c didn't create it
- `/app/node_modules/zod` — DOES exist (server's deps include zod transitively via existing imports)

If server depends on zod (verify: `grep '"zod"' server/package.json`), then `/app/node_modules/zod` exists post-prune and the walk succeeds. If server doesn't directly depend on zod, npm hoisting may have placed it somewhere reachable, OR npm prune --production may have removed it (it's a runtime dep so probably preserved). G1c is FRAGILE: it assumes server's prod tree happens to contain every transitive dep of shared. With current shared deps (only zod), this works. With any future addition, breaks silently.

Hardening: G1c should also `cp -a node_modules/zod /app-prod/node_modules/zod` for every entry in `shared/package.json#dependencies`. Or simpler: G1c should run `npm install --omit=dev --prefix /app/node_modules/@sanctuary/shared` to install shared's declared deps inside its own nested `node_modules`. Or simplest: pick strategy (a) `cp -L` everything, including the symlink target, AND symlinks to deps — produces a real directory tree, not a hand-built skeleton.

The plan's strategy (c) over-trusts npm hoisting. Add explicit verification: `docker exec server node -e "require('@sanctuary/shared/schemas/mobileApiRequests')"` (the file that imports zod) — must resolve. Plan currently only tests `require('@sanctuary/shared/utils/errors')` which doesn't exercise zod.

---

## MEDIUM (will surface in PR review or hot-fix sprint, not deploy-blocking)

### M-1. A2.5 `check-shared-deps.sh` regex for Node builtins (Vector 10)

Plan: greps `shared/**/*.ts` for non-relative non-Node-builtin imports.

Edge cases the regex must handle:
- `import { x } from 'crypto'` (bare builtin)
- `import { x } from 'node:crypto'` (prefixed builtin — Node ≥ 18)
- `import x from '@types/foo'` — should this fail or pass? `@types/*` is a TYPE-only import; runtime never resolves it; should be allowed without `dependencies` entry but DOES need `devDependencies` declaration for type-check
- `import x from 'node:fs/promises'` (sub-builtin)
- Type-only imports: `import type { Foo } from 'somepkg'` — at runtime there's no require; should this fail? Probably should require declaration in `devDependencies` so types resolve

Concrete builtin set Node currently exposes: `process.binding('natives')` lists ~70. Hardcoding misses `node:test`, `node:perf_hooks`, `node:worker_threads` etc. Better: use the `is-builtin-module` npm package, or `require('module').isBuiltin('xyz')` (Node ≥ 16) — script becomes ~5 lines and stays correct as Node adds builtins.

Plan should specify the implementation, not leave it to "grep regex". Cite `module.isBuiltin()` as the authoritative source.

### M-2. B9 ESM-from-CJS interop — likely works, but for the wrong reason

Vector 8. tsc CJS emit of `export function extractErrorMessage` produces:
```js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractErrorMessage = void 0;
function extractErrorMessage(...) { ... }
exports.extractErrorMessage = extractErrorMessage;
```

Node's ESM-side named-export synthesis runs `cjs-module-lexer` over the source; the lexer DOES recognize `exports.X = ...` patterns AND the `__esModule` marker. So `import { extractErrorMessage } from '@sanctuary/shared/utils/errors'` from `.mjs` → works, returns the function. B9's smoke is sound IF the resolution-side actually finds the dist file — see C-1, which is the upstream blocker.

If C-1 is fixed by switching to `moduleResolution: node16`, consumers must use explicit `.js` extensions on relative imports inside shared (because `node16` requires them for `module: commonjs` is fine, but `module: nodenext` requires them). Audit shared's internal imports (`shared/utils/bitcoin.ts → ../constants/bitcoin`) — needs to become `../constants/bitcoin.js` or shared's tsconfig stays at `module: commonjs` with `moduleResolution: node16` (which is allowed, types-only difference).

### M-3. F1 smoke pattern set may still over-match

`patterns: ["../shared/**", "../../shared/**", ..., "../../../../../shared/**"]` — these are MINIMATCH globs evaluated against the import specifier string. They correctly match relative imports. They do NOT match `@sanctuary/shared/utils/errors` (no `../` prefix). Good.

But: what about a future deeper-nested test file at depth 6? E.g. `server/tests/integration/api/v2/users/auth/foo.test.ts` importing `'../../../../../../shared/utils/errors'`. The pattern set tops out at depth-5. F1 should add depth-6 and depth-7, OR (better) use a regex pattern via `paths` (eslint-plugin-import has `no-restricted-paths` which supports source patterns, not just specifiers).

Cheapest fix: extend the array two more levels. Future-proof fix: switch to `eslint-plugin-import` `no-restricted-paths` with a target regex.

### M-4. J4 shim removal is a behavior change, not a doc cleanup

`server/src/utils/fatalProcessHandlers.ts`, `processExit.ts` (and gateway equivalents) are listed in `vitest.config.ts:42-44` as coverage exclusions — they're zero-logic re-export shims. Removing them in J4 means every call site must be updated. There are ~14 mentions of `utils/fatalProcessHandlers` in server based on the recent unhandled-rejection-fatal-shutdown branch's diff. Each becomes `from '@sanctuary/shared/utils/fatalProcessHandlers'`.

If J4 is run, the coverage `exclude` list in `vitest.config.ts` must also be pruned (those files no longer exist). If not pruned, vitest doesn't fail but the exclusion is dead weight. Add to J4: "Remove the four shim filenames from `server/vitest.config.ts:42-46` AND `gateway/vitest.config.ts` exclude lists."

---

## LOW (nice-to-have polish)

### L-1. A5 strict declaration emit may surface inferred-return-type issues

A5 acknowledges this. Worth being concrete: shared currently has no `noImplicitReturns` violations because consumers' tsconfigs don't trigger declaration emit. After A5 runs `tsc -p tsconfig.json` with `declaration: true`, every exported function needs an explicit return type or tsc infers one and writes a `.d.ts` line for it. If inference produces an internal type (e.g., a private interface), tsc errors `TS4053`. Pre-empt: add A5.5 — run `tsc --noEmit --declaration` on shared before A5; fix any TS4xxx errors at source.

### L-2. G4 macOS verification claim

G4: "succeeds on Linux and macOS host (the Forgejo runner)". The Forgejo runner is Linux per `runs-on: ubuntu-20.04` in workflows. macOS is for local dev only. Wording is misleading — clarify: "Linux runner + local macOS dev box smoke."

### L-3. Time estimate may be optimistic on Phase G

Phase G: "1.25 day" for Dockerfile rewrites + cache cascade enumeration (10+ rows in G5 table) + macOS verification. Each cache cascade row in G5 likely needs its own PR or at least a careful test. Realistic estimate: 2 days minimum. Not blocking; just noting.

---

## Recommendations (priority order)

1. **Pick a fix for C-1** (moduleResolution × exports). Easiest is bumping consumers to `moduleResolution: node16` and absorbing the `.js`-extension cleanup in the same PR. Failing that, re-add `paths` pointing at `dist/`. Either way, document the choice in the plan with the concrete command that proves resolution works (`node -e "console.log(require.resolve('@sanctuary/shared/utils/errors'))"`).
2. **Replace H3** with the concrete clean-room test from the C-3 "Concrete actionable test" block.
3. **Drop D7's pre-warm option entirely** — it was based on a false model of the Stryker cache. Just budget the slow first run.
4. **Reword G5's architecture.yml row** — "remove per-package npm ci commands; root npm ci handles all workspaces" instead of translating to `--workspace=`.
5. **Replace F1c smoke with a config-import unit test** (~10 lines, no plugin loading).
6. **Add an explicit acceptance to G1c** — `docker exec server node -e "require('@sanctuary/shared/schemas/mobileApiRequests')"` — to exercise zod transitive resolution.
7. **Specify `module.isBuiltin()`** for A2.5 instead of leaving it to "grep regex".

Once C-1 has a clear answer and C-3/D7 are corrected, v4 should be executable.
