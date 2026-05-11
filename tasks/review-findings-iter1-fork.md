# Iter-1 Independent Review — `shared/` → npm workspace package

Reviewed against `tasks/todo.md` top entry, fresh re-read 2026-05-10.
Verified plan claims with direct repo probes (npm 11.11.0, node 24.14.1, lockfileVersion 3, ESM root, CJS server/gateway).

## Cross-cutting

### CC-1 (BLOCKER) — Plan ignores `server/scripts/ensure-shared-module-resolution.mjs`.
That script is invoked by **22 npm scripts** in `server/package.json` (`predev`, `prebuild`, `prestart`, `pretest*`, etc.). It symlinks `<repo>/node_modules → <server>/node_modules` IFF `<repo>/node_modules` does not exist. After Phase A, npm workspaces ALWAYS create `<repo>/node_modules` (hoisting). The script becomes a permanent `exit 0` no-op, removing protection it was added for, and a stale symlink may already exist on dev machines. **Fix**: explicitly delete the script in Phase A (or replace with a workspace-aware doctor), document in plan, and remove all `pre*` references. Add a probe in A7: `test ! -L <repo>/node_modules` (or assert it points where you expect).

### CC-2 (BLOCKER) — `exports` map pointing at `.ts` files cannot be consumed by `node dist/...` at runtime.
Node's `exports` resolution does not run TypeScript. Server's `main: "dist/server/src/index.js"` runs compiled CJS via `node`. After Phase B, `require('@sanctuary/shared/utils/foo')` will look up `node_modules/@sanctuary/shared/package.json` → `exports."./utils/foo"` → `./utils/foo.ts`. Node tries to `require()` a `.ts` file → throws `ERR_UNSUPPORTED_DIR_IMPORT` / `MODULE_NOT_FOUND`. This works in `vitest`/`tsx`/`stryker-vitest` only because they install loaders. **Fix**: choose one — (a) add a build step to `shared/` (`tsc --emitDeclarationOnly false`) producing `shared/dist/utils/*.js`, point `exports` at the `.js`; (b) keep current setup where server's `tsc` rolls shared into `dist/server/dist/shared/...` (verified: `server/dist/shared/*` exists today) and use `imports`/`paths` only for type resolution, NOT a real package; (c) declare `exports` with a `"types"` key for tsc + a `"default"` key for runtime, both pointing at compiled output. Plan's A1 picks (a)-shaped exports without the build step.

### CC-3 (BLOCKER) — Server compiles `../shared/**/*` into its OWN dist.
`server/tsconfig.json` has `rootDir: ".."` and `include: ["src/**/*", "../shared/**/*"]`. Compiled artefacts live at `server/dist/shared/...` (verified). Workspace migration must reconcile two mutually-exclusive models:
1. shared is a **package** with its own build, consumers `require()` from `node_modules/@sanctuary/shared` → need shared/dist + exports with `.js`.
2. shared is **inlined source** rolled into each consumer's dist (today) → workspace package only useful as a `paths` token; runtime resolution still walks the source tree.

Plan picks neither cleanly. Pick one and rewrite Phase A around it.

### CC-4 (BLOCKER) — `"type": "module"` in shared/package.json breaks CJS server/gateway.
Plan A1 says `"type": "module"` *if consuming TS configs are ESM-compatible*. They are NOT: `server/tsconfig.json` and `gateway/tsconfig.json` both compile to `module: commonjs`. CJS cannot synchronously `require()` an ESM package. **Fix**: omit `"type"` (defaults CJS) OR use dual exports `{"import": "./dist/...mjs", "require": "./dist/...cjs"}` AFTER giving shared a build step (CC-2/CC-3). Today shared has no build, so this is unrecoverable without addressing CC-3 first.

### CC-5 (SHOULD-FIX) — ai-proxy isolation is not actually enforced by omitting from `workspaces`.
With npm hoisting, `node_modules/@sanctuary/shared` lives at repo root. ai-proxy's Node resolver walks up from `ai-proxy/src/...` → finds `<repo>/node_modules/@sanctuary/shared`. Importing it from ai-proxy code compiles + runs successfully. The Docker build (`COPY ./ai-proxy` only — verified `docker-compose.yml:660` `context: ./ai-proxy`) doesn't see repo root, so production is safe. But local dev / tests can violate the boundary undetected. **Fix**: add an `eslint.config.js` block that bans `@sanctuary/shared` imports for `files: ['ai-proxy/**']` in Phase C, AND add a CI grep gate (mirror `check-provider-leaks.sh`) that runs even before ESLint.

### CC-6 (SHOULD-FIX) — TypeScript Project References is the simpler alternative the plan never evaluates.
Add `references: [{ "path": "../shared" }]` to server/gateway tsconfigs, give shared a `composite: true` tsconfig, and tsc handles the cross-project compilation natively. No package.json, no `exports`, no Docker change, no Stryker sandbox change. Phase 5 (Stryker vitest) still has the cross-package resolution problem because Stryker's sandbox doesn't follow `references`, so this doesn't fully replace workspaces — but it gets ~70% of the wins for ~20% of the risk and may be a worthwhile interim step. Plan should record this as evaluated-and-rejected with a one-line reason, not omit it entirely.

## Phase A — Foundation

### A-1 (SHOULD-FIX) — A1 `exports` map is too narrow AND too risky.
`./utils/*` will not match `./utils/index` or aggregate exports. shared/types/index.ts exists (verified). Without an `./types/index` mapping consumers can't `import { X } from '@sanctuary/shared/types'` — only subpath. Either add `./types: "./types/index.ts"` or use `"./types/*": "./types/*"` (no `.ts` to let exports-map node resolution try `.ts`/`.js` per `conditions`).

### A-2 (SHOULD-FIX) — A5 vitest aliases conflict with `node_modules` resolution.
Existing root vitest already aliases `@shared` (verified `vitest.config.ts:18-20`). server/gateway vitest configs also have `alias` blocks (verified). Adding `@sanctuary/shared` as ALSO an alias creates two resolution paths: alias takes precedence over node_modules. So vitest never actually exercises the workspace symlink — Phase A's verification "the new alias also works" can pass even if the workspace symlink is broken. **Fix**: add the alias temporarily during transition only; remove in Phase C and verify vitest resolves via node_modules alone.

### A-3 (SHOULD-FIX) — A8 "ONE test import" is insufficient.
Smoke test must hit each subpath (`utils`, `types`, `schemas`, `constants`) AND each runtime: `tsc`, `vitest run`, `node dist/...` (post-build), `./start.sh --rebuild`, Stryker dry-run on broad config. Per-tool table at line 144 lists tools but no minimal probe per tool. Add a literal probe column with the exact command + expected exit.

### A-4 (SHOULD-FIX) — Docker `ln -s /app/node_modules /node_modules` is load-bearing.
Verified `server/Dockerfile:42` creates this symlink so shared/.ts files (compiled outside /app via `../shared`) resolve their deps via /node_modules at build time. Workspace mode may make this unnecessary OR break it (the symlink target conflicts with hoisted root node_modules in dev but Docker doesn't see dev tree). Plan must explicitly verify Docker build BEFORE and AFTER Phase A — and decide whether to delete the symlink hack.

### A-5 (SHOULD-FIX) — `package-lock.json` is lockfileVersion 3 with no current `workspaces`. First `npm install` post-A6 produces a large diff.
Plan should call out that the lockfile change is enormous and unreviewable line-by-line; reviewers must trust the npm install rather than diff. Mitigation: lockfile commit goes in the same PR as A6 with a note in the PR body.

## Phase B — Per-package import sweeps

### B-1 (BLOCKER) — Missing 5-segment sed pattern.
Verified **20 imports at 5-segment depth** in server/src (e.g. `server/src/services/bitcoin/sync/addressDiscovery.ts:14`). B1.1's sed handles 3 and 4 only. The "Then check for any 5+-segment depth" footnote is not actionable. **Fix**: replace the four sed lines with one regex: `sed -E "s|from (['\"])(\.\./){2,}shared/|from \1@sanctuary/shared/|g"` — handles all depths in one pass and is idempotent.

### B-2 (NICE-TO-HAVE) — sed leaves comments referencing `'../../../shared/...'` paths in docstrings/comments unchanged.
Acceptable but worth a grep audit at end of B1 — `grep -rE "\.\./\.\./shared" server/src` (no `from`) catches doc references that may now be misleading.

## Phase C — Drop old paths + enforce

### C-1 (SHOULD-FIX) — ESLint `no-restricted-imports` AST selector is wrong shape.
The plan uses a `selector` key — that's `no-restricted-syntax` syntax. The correct rule is `no-restricted-imports` with `patterns: [{ group: ["**/shared/**"], message: "..." }]`. Verify against `eslint.config.js`'s flat-config shape.

### C-2 (SHOULD-FIX) — Phase C deletes `@shared/*` alias before frontend codemod (C1 vs C2 ordering).
C1 sweeps frontend → `@sanctuary/shared/*`, C2 deletes the alias. If C1 misses one, C2 breaks the build. **Fix**: invert order — keep `@shared/*` alias until C-end verification passes, then delete in a follow-up commit on the same PR.

## Phase D — Stryker vitest

### D-1 (SHOULD-FIX) — Plan claim "Stryker copies node_modules into the sandbox" is unverified.
Stryker's default sandbox excludes `node_modules` and SYMLINKS it into the sandbox via the `symlinkNodeModules` option (default `true` in 9.x). With workspaces, `node_modules/@sanctuary/shared` is itself a symlink to `<repo>/shared`. Whether the sandbox-symlinked node_modules transitively follows that symlink correctly depends on Stryker version + filesystem — not guaranteed. **Fix**: add D0 step that verifies on broad config first (`MUTATION_SHARD=1 npm run test:mutation` against the broad mutate set) before touching critical config. If broad fails, Phase 5 still doesn't work — back out before D1.

### D-2 (SHOULD-FIX) — D4 says "decide whether to update or restore" baseline if drift. Decide NOW.
Drift criterion + decision tree should be in the plan: e.g., "if weighted score drops < 2 points and survivors are in the same files: update baseline. If a new file shows survivors: restore command runner."

## Phase E — Cleanup

### E-1 (NICE-TO-HAVE) — E3 "synthetic PR that touches a shared util" is hand-wavy.
Specify which util, which consumer test asserts, which CI lanes must run. Without that, E3 is a no-op.

---

**Total: 4 blockers, 11 should-fix, 2 nice-to-have. Plan needs a structural rewrite around CC-2/CC-3 before Phase A is executable.**
