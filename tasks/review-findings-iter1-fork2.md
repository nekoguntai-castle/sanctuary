# Plan review #2 (independent fork) — iter 1

Re-read `/home/nekoguntai/sanctuary/tasks/todo.md` top entry fresh. Re-verified facts from the live repo before reviewing. Findings below are independent of the other reviewer.

## Verified facts (relevant to plan)

- npm 11.11.0, node 24.14.1 — `workspace:*` protocol fully supported.
- Root `package.json` is `"type": "module"`. **server, gateway, ai-proxy `package.json` have NO `"type"` field** — Node treats them as CommonJS by default.
- Server tsconfig: `"module": "commonjs", "moduleResolution": "node", "target": "ES2020", "outDir": "./dist"`. **No `paths`.**
- Root tsconfig: `"module": "ESNext", "moduleResolution": "bundler", paths: {@/*, @shared/*}`.
- Server build: `tsc` → `dist/`. Production runtime: `node dist/server/src/index.js` — pure compiled CJS.
- Server `postinstall: prisma generate` writes to `../src/generated/prisma`.
- **Four lockfiles exist today**: root, server, gateway, ai-proxy.
- Server/gateway Dockerfiles `COPY shared ../shared` (build context is repo root).
- Imports go up to depth 5 in server/src.
- ESLint config uses `no-restricted-syntax` only — `no-restricted-imports` is NOT in use anywhere.
- `docusaurus.config.ts:28` includes `CONTRIBUTING.md` in the published doc tree.

## Phase A — Foundation

### Blocker

**A-B1. `exports: { "./utils/*": "./utils/*.ts" }` will break the server PRODUCTION runtime.** Server is built to `dist/` with `tsc` (CJS, target ES2020) and started via `node dist/server/src/index.js`. The compiled `.js` contains `require("@sanctuary/shared/utils/foo")`. Node native resolves the package, reads `exports`, gets a `.ts` path, and crashes with `ERR_UNKNOWN_FILE_EXTENSION`. The plan's "no build step in shared/" assumption is incompatible with how server runs in production / Docker / `start.sh`. **Fix:** add a `shared/tsconfig.json` (CJS + ES2020 to match server) + a build step (`tsc` → `shared/dist/`); point `exports` at `./dist/utils/*.js` for `require` and `./utils/*.ts` (or `dist/.js`) for the development conditions. Without this, Phase A merges and Docker production fails the moment server tries to use any shared util.

**A-B2. Server tsconfig has NO `paths` block today; server is CJS with `moduleResolution: node`.** Plan A4 says "add `@sanctuary/shared/*`" — needs the entire `paths` block created plus `baseUrl`. With `moduleResolution: node`, paths only work via tooling that honors them (tsc, vitest, tsx). Node at runtime ignores tsconfig — that path resolves via node_modules. A symlink at `node_modules/@sanctuary/shared` resolves fine for tsc + Node, but ALSO needs the dist artifacts to satisfy A-B1.

### Should-fix

**A-S1. The 4 existing per-package lockfiles will collide with workspaces.** `npm install` with `"workspaces"` set MOVES dependency resolution to the root `package-lock.json`. The per-package `server/package-lock.json`, `gateway/package-lock.json`, ai-proxy's, and root's all exist today. Plan must (a) keep ai-proxy's lockfile since it's outside the workspace, and (b) DELETE `server/package-lock.json` and `gateway/package-lock.json` — they become stale/misleading the moment workspace mode runs. The current `setup-server-deps/action.yml` cache key hashes `server/package.json + server/package-lock.json`; with workspaces the authoritative lockfile is root's. Cache key must change to hash `package-lock.json` (root). A9 underspecifies this.

**A-S2. Dockerfile rewrite is bigger than "verify".** Server/gateway Dockerfiles do `COPY shared ../shared` AND run `npm ci` from inside the package directory. Workspace mode requires npm install at the ROOT (workspace root owns the lockfile). Docker build must:
1. Copy root `package.json` + root `package-lock.json` into the build context
2. Copy `shared/` (workspace member) so symlinks have a target
3. Copy the package being built
4. Run `npm ci --workspace=server --include-workspace-root` (or build outside Docker and copy `node_modules` in)
This is a substantive Dockerfile rewrite per package, not a smoke test. Plan A10 reads as "press build button"; reality is closer to "redesign each Dockerfile."

**A-S3. ai-proxy isolation needs an active probe, not a passive omission.** Plan claims ai-proxy isolation holds because it's "NOT in workspaces". True for `npm install --workspaces` behavior, but: (a) running `npm install` from inside `ai-proxy/` walks UP the tree to find `package.json`. If npm finds the root `package.json` with `workspaces`, it MAY still apply workspace semantics. (b) Even if ai-proxy install stays isolated, root npm install hoists deps to root `node_modules/` which is in ai-proxy's resolution path (`require()` walks up). Plan should add a CI gate: `test ! -e ai-proxy/node_modules/@sanctuary` AND `test ! -e node_modules/@sanctuary` invoked from ai-proxy's directory.

**A-S4. `postinstall: prisma generate` runs in every workspace install.** With workspaces, root `npm install` triggers postinstall in EACH workspace member. Server's prisma generate runs every time — including in CI jobs that have a Prisma cache-hit per #392. The cache-skip logic in `setup-server-dependencies.sh` reads the env hint from the action's cache step. With workspaces, that step is at root, and the env hint may not propagate to the per-package install correctly. Plan should re-verify #392's prisma cache-skip works under workspace mode.

**A-S5. Phase A8 verification "ONE test import" is insufficient.** A single import in one file proves tsc + vitest resolve. It does NOT exercise: (a) Stryker sandbox copy (Phase D), (b) Docker production runtime (`node dist/`), (c) coverage shards, (d) AppMap. The per-tool table is the right shape but the verification column says "X green" without a failing-case probe. Plan A8 should be replaced with a CHECKLIST that maps to the per-tool table, with explicit invocations.

### Nice-to-have

**A-N1. `npm install` cold time on a Mac vs Linux.** With workspaces, root install rebuilds all packages including native deps (`tiny-secp256k1`, `bcryptjs`, etc.). Cold install can be 5-10× slower than per-package on the macOS Forgejo runner. Add this to risks.

## Phase B — Per-package import sweeps

### Blocker

**B-B1. Sed pattern listed in B1.1 only handles depths 3-4; misses depth 5.** Plan acknowledges this in a parenthetical but the LISTED sed commands don't include the depth-5 pattern. Verified: 20 imports at depth 5 in server/src. Replace with a single regex: `s|from '(\.\./)+shared/|from '@sanctuary/shared/|g` (and quote-variant). Same fix for B2/B3.

### Should-fix

**B-S1. Mid-window CI doesn't reject NEW relative-path imports.** Between Phase A (merged) and Phase C (ESLint enforcement), a contributor can open a PR using either style. CI accepts both. Without an enforcement gate from the start of Phase B, the sweep is a moving target. **Fix:** land the ESLint rule (currently in C3) AT THE START of Phase B with a one-time `eslint-disable-next-line` annotation on each existing relative import. Sweep B1-B3 then removes the annotations as it converts each import.

**B-S2. Mechanical sed misses non-`from '...'` import shapes.** `import('...')` dynamic imports, `vi.mock('...')`, `jest.mock(...)`, `require(...)`, type-only `import type {...} from '...'` (this last one IS caught by the sed; OK). Plan B1.2's grep verification catches the misses but doesn't fix them. **Fix:** use `ts-morph` codemod or list explicit grep patterns to fix manually post-sed.

**B-S3. B1.4 says `npx vitest run` in server/ — but server has integration tests that need Postgres.** If integration tests don't run locally without DB, the verification is incomplete. Plan should specify `vitest run tests/unit` for the local pre-PR check, with full integration deferred to CI.

## Phase C — Drop the old paths

### Blocker

**C-B1. ESLint rule in C3 uses wrong syntax.** The `selector:` shape shown is `no-restricted-syntax`, not `no-restricted-imports`. The plan calls it `no-restricted-imports` — confusing two rules. Correct shape for what's wanted is either:
```js
"no-restricted-syntax": ["error", {
  selector: "ImportDeclaration[source.value=/^(\\.\\./)+shared\\//]",
  message: "..."
}]
```
OR the proper `no-restricted-imports` `patterns` shape. Verify by adding a deliberately-broken import and confirming the rule fires.

### Should-fix

**C-S1. Removing `@shared/*` alias in C2 may break Docusaurus.** Docusaurus' MDX compilation (just bit us in #399) parses imports in `.md` files. If any published doc references `@shared/*` in a code block or link, removing the alias might trigger another `onBrokenLinks: 'throw'`. **Fix:** grep all published docs (`docs/**/*.md`, `*.md`, `server/ARCHITECTURE.md`, `gateway/ARCHITECTURE.md`, `ai-proxy/ARCHITECTURE.md`, `CONTRIBUTING.md`) for `@shared/` before C2.

## Phase D — Stryker vitest+perTest

### Blocker

**D-B1. Plan assumes Stryker's sandbox dereferences symlinks in node_modules.** Unverified. The previous spike (#395, #397) failed twice on different structural issues; Phase D could fail a third time. **Fix:** before D1, run a manual probe: `cd server && npx stryker run stryker.critical.config.mjs --logLevel debug --dryRun` (or equivalent). Inspect any sandbox dir created and verify `node_modules/@sanctuary/shared` resolves to the real shared/ tree from inside the sandbox. If it's a dangling symlink, plan needs an additional Stryker config (`sandbox.symlinkNodeModules: false` or similar) or a pre-sandbox copy step.

### Should-fix

**D-S1. Plan doesn't address whether broad config was actually running.** Phase D references the broad `stryker.config.mjs` as proof vitest+perTest works. But broad config has no CI lane (only critical does). If broad has never actually run end-to-end at scale, the "broad works" claim is configuration-only, not behavioral. **Fix:** before relying on broad as a working reference, run it manually (`cd server && npm run test:mutation`) and confirm.

## Cross-cutting

### Should-fix

**X-S1. Concurrent npm install in CI.** Multiple jobs share a runner. With workspaces, they all want root `node_modules/`. npm uses a lockfile but high concurrency can corrupt it. Plan should add a runner-lock around root npm install (the existing `with-runner-lock.sh node-toolchain` pattern).

**X-S2. `workspace:*` resolution in lockfile is `file:../shared`** — relative path. Portable across machines, but the relative path bakes in the layout. If anyone moves `shared/` (e.g., to `packages/shared/`), the lockfile must be regenerated. Plan should note this for future-self.

**X-S3. CONTRIBUTING.md update in C7 risks Docusaurus break (déjà vu).** When adding `@sanctuary/shared` references to CONTRIBUTING, run `npm run docs:build` locally before pushing. The exact failure mode that broke #399 (markdown link to non-published path) could recur if examples link to `shared/dist/` or similar.

### Nice-to-have

**X-N1. Time estimate is optimistic.** Plan estimates 2-3 days of focused work. Phase A alone has ~10 sub-steps with cross-tool verification on macOS + Linux. Realistic: 4-5 days end-to-end including PR review cycles + fixing surfaced bugs.

---

## Summary

| Phase | Blockers | Should-fix | Nice-to-have |
| --- | --- | --- | --- |
| A | 2 | 5 | 1 |
| B | 1 | 3 | 0 |
| C | 1 | 1 | 0 |
| D | 1 | 1 | 0 |
| Cross | 0 | 3 | 1 |
| **Total** | **5** | **13** | **2** |

## Top 3 risks

1. **`exports: ./*.ts` breaks production runtime.** Server runs compiled CJS via `node dist/...`; native Node can't load `.ts`. Need `shared/dist/` build step before A1 ships.
2. **Dockerfile rewrites are substantive, not "verify".** Workspace mode requires root-context `npm install`; current Dockerfiles do per-package install with explicit `COPY shared`. Both need restructuring.
3. **Stryker sandbox symlink behavior unverified.** Phase D assumes resolution works; the previous spike failed twice on similar resolution issues. Probe before switching the critical config.
