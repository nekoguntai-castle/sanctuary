# Plan review — iter 2 (Claude)

Plan reviewed: `tasks/todo.md` top entry "shared/ → real npm workspace package (v2) 2026-05-10".

Re-verified facts NOT covered in v2 (these are NEW issues v2 either introduced or didn't catch):

## Phase A — Build shared as a real package

### Blocker

**A2-B1. Missing `dependencies` declaration for `zod`.** Verified `shared/schemas/mobileApiRequests.ts:import { z } from 'zod';`. Phase A2 says "No `dependencies` (shared has none today)" — that's wrong. shared/package.json MUST declare `zod` as a dependency, or consumers via `node_modules/@sanctuary/shared` will fail to resolve `zod` if they don't independently include it. Today this works because shared is compiled INTO server/gateway dist via `include: ["../shared/**/*"]`, so server's `zod` dep covers it. Once shared is a real package, it owns its own deps. **Fix:** audit ALL of `shared/**/*.ts` for non-relative non-Node-builtin imports; declare each as a `dependencies` entry. `crypto` is fine (Node builtin); `zod` is not.

**A3-B1. `shared/index.ts` must exist before A5 (`npm run build`).** Phase A2's package.json declares `"main": "./dist/index.js"` and `"types": "./dist/index.d.ts"`. Phase A3 creates `shared/index.ts`. Phase A5 builds. If A3 is skipped or A5 runs first, tsc errors with "no such file" or `npm publish`-style validation rejects the package. Plan ordering is correct as written but the dependency between A2's `main` field and A3's file creation should be explicit. **Fix:** make A3 the literal next step after A1, before A2's "exports map" can be tested end-to-end. Or delete `main`/`types` from A2 entirely (rely solely on `exports`) and remove the dependency on index.ts being a real file.

### Should-fix

**A1-S1. `composite: true` interacts with cross-subdir imports inside shared/.** Verified `shared/utils/bitcoin.ts` imports from `../constants/bitcoin` and `shared/utils/fatalProcessHandlers.ts` imports from `../types/logger`. Composite mode REQUIRES `rootDir` to contain all source files; `rootDir: "./"` (Phase A1) does cover both `utils/` and `constants/`, so this is fine. BUT `composite: true` also enforces stricter declaration emit — every exported symbol needs an explicit type. Current shared/ source may have inferred-return-type exports that composite mode rejects. **Fix:** A5's local build will catch this; add a step "fix any type-inference rejections from composite mode" with a specific note that this is expected and the fix is adding explicit return types.

**A4-S1. `shared/dist/` already covered by root `.gitignore`.** Verified root `.gitignore` has `dist/` which matches any `dist` directory at any depth (gitignore semantics). Phase A4 is unnecessary. **Fix:** delete A4 or change to "verify root `.gitignore`'s `dist/` rule already covers `shared/dist/`."

## Phase B — Wire server consumption

### Should-fix

**B3-S1. `paths` mapping vs `exports` field interaction.** Phase B3 adds `paths: { "@sanctuary/shared/*": ["../shared/*"] }`. But shared's package.json has `exports` pointing at `./dist/utils/*.js`. tsc with `moduleResolution: node` (server's setting) IGNORES the `exports` field — it walks node_modules looking for the path you give it. The `paths` mapping `["../shared/*"]` resolves `@sanctuary/shared/utils/foo` to `../shared/utils/foo` (TS source), bypassing dist/ entirely. Result: tsc reads the .ts source via paths; runtime Node reads the .js via exports — TWO DIFFERENT FILES. They should produce equivalent code, but if shared's build is stale, tsc passes while runtime breaks. **Fix:** either (a) point `paths` at `["../shared/dist/*"]` so both paths see the built output, OR (b) drop the `paths` mapping entirely and rely on `node_modules/@sanctuary/shared` symlink resolution at type-check time too. Option (b) means tsc fails until `npm install` runs (creating the symlink) — acceptable because every CI lane installs first.

## Phase D — ts-morph codemod

### Should-fix

**D-S1. ts-morph memory and dynamic imports.** Server has ~1700 TS files. ts-morph loads them all into a single Project for cross-file type info. Peak memory will be 1-2 GB. On a CI runner that's fine (16 GB); on a developer laptop it may swap. **Fix:** specify the codemod runs locally on a dev box, not in CI, and document the memory expectation. Also: the snippet handles `ImportDeclaration` only; need explicit handling for `import('...')` (dynamic), `require('...')` (CJS), `vi.mock('...')` (test mocks), `jest.mock('...')` (if any). Add per-pattern asserts.

**D5-S1. Frontend sweep needs `vite.config.ts`, not just vitest.** Verified `vite.config.ts` has `'@shared': path.resolve(__dirname, './shared')` alias. The plan's Phase E2 only mentions removing the alias from `vitest.config.ts`. **Fix:** D5 sweeps frontend imports; E2 must remove the alias from BOTH `vite.config.ts` AND `vitest.config.ts` (and any other tool that declared it — verify a grep for `'@shared'` across config files).

## Phase F — Enforcement

### Blocker

**F1-B1. ESLint `productionSource` array doesn't cover server/gateway.** Verified `eslint.config.js`'s `productionSource` lists frontend paths only (`App.tsx`, `components/`, `contexts/`, `hooks/`, `services/`, `src/`, `themes/`, `utils/`). It does NOT include `server/src/**` or `gateway/src/**`. A `no-restricted-imports` rule attached to `productionSource` therefore won't fire on the 47 + 11 server/gateway imports the plan aims to police. **Fix:** F1 must EITHER extend `productionSource` to include `server/src/**` and `gateway/src/**`, OR add a separate ESLint config block scoping the new rule to those paths. The current plan implies the latter exists but doesn't show it.

### Should-fix

**F4-S1. Runtime test "import from inside ai-proxy" needs an actual ai-proxy harness.** Phase F4 says "add a test in `tests/ai-proxy/isolation.test.ts` that asserts `import('@sanctuary/shared/utils/errors')` THROWS from inside an ai-proxy fixture." But that test runs from the ROOT vitest, where `@sanctuary/shared` IS resolvable. Calling `import('@sanctuary/shared/...')` from the test file resolves via root's node_modules, NOT ai-proxy's. The test passes (resolves) when it should fail. **Fix:** the test must execute the import from a SUBPROCESS launched with `cwd: 'ai-proxy/'` and a fresh `NODE_PATH`, OR run inside the actual ai-proxy container. Specify the exact mechanism.

## Phase G — Dockerfile

### Should-fix

**G5-S1. Cache-key invalidation cascade is incomplete.** v2 mentions `setup-server-deps` cache (server) and bumps to `-v3`. But the recent CI optimization PRs added MORE caches:
- `gateway/node_modules` cache from PR #398 (inline in `quick-gateway-tests`)
- `ai-proxy/node_modules` cache from PR #398 (inline in `quick-ai-proxy-tests`)
- Stryker's `.stryker-cache/critical-incremental.shard-N.json` from PR #389 (server-scoped, not shared-aware)
- Backend coverage shard cache from PR #394 (vitest blob cache)

Each of these has a key that doesn't currently include shared/. After Phase G, ALL of them need to invalidate when shared/dist changes. **Fix:** enumerate every cache step; bump prefix on each; add `shared/package-lock.json`-or-equivalent to relevant cache keys.

## Phase I — Stryker probe

### Should-fix

**I1-S1. Probe is described but not specified.** "Inspect: is `node_modules/@sanctuary/shared` present?" — what's the EXACT command? Stryker tears down sandboxes between mutants. **Fix:** provide a concrete probe command, e.g., add a temporary `vitest.setup.ts` that runs `console.log(require.resolve('@sanctuary/shared/utils/errors'))` at test-setup time; run a single Stryker shard; grep the run log for the resolve path. If it points inside the sandbox (e.g., `.stryker-tmp/sandbox-X/node_modules/@sanctuary/shared/dist/utils/errors.js`), workspaces handled it. If it points OUTSIDE the sandbox (resolved via parent-walking), the symlink wasn't dereferenced and Phase 5 will fail differently.

## Cross-cutting

### Should-fix

**X-S1. Phase H regression test is a placebo.** Phase H deletes `ensure-shared-module-resolution.mjs` and adds "a regression assertion: a test that verifies `await import('../generated/prisma/client')` succeeds." That test passes BEFORE the script is deleted too — it doesn't prove the script was redundant. **Fix:** simulate the conditions where the script previously fired: in the test, delete `node_modules/.prisma/client` (or wherever the script's symlink target was), then verify Prisma resolution still works under workspaces. If it doesn't, the script was load-bearing.

**X-S2. Phase A archives v1 to `tasks/archive/`.** Verified `tasks/archive/shared-workspace-plan-v1-2026-05-10.md` was created. But `tasks/archive/` is not git-tracked unless explicitly added. **Fix:** confirm `git add tasks/archive/` happens; or move the archive path to a tracked location (e.g., `docs/decisions/archive/`).

## Summary

| Phase | Blockers | Should-fix |
| --- | --- | --- |
| A | 2 | 2 |
| B | 0 | 1 |
| D | 0 | 2 |
| F | 1 | 1 |
| G | 0 | 1 |
| I | 0 | 1 |
| Cross | 0 | 2 |
| **Total** | **3** | **10** |

## Top 3 risks (this iteration)

1. **`zod` not declared as a shared dep** — package will silently work in dev (consumer's zod resolves) and break in any deployment that strips dev deps. **Phase A2.**
2. **ESLint enforcement scope misses server/gateway** — F1 won't actually catch the 58 imports the plan exists to police. **Phase F1.**
3. **`paths` ↔ `exports` divergence** — tsc reads .ts source, runtime reads .js dist; stale builds silently pass tsc and break at runtime. **Phase B3.**
