# Plan review — iter 3 (Claude)

Plan reviewed: `tasks/todo.md` top entry "shared/ → real npm workspace package (v3) 2026-05-10".

## Convergence assessment

**v3 introduced a NEW regression by dropping the `paths` block in Phase B3a.** The convergent iter2 finding said "either point both at dist OR drop paths"; v3 chose "drop paths" but the underlying premise — that `moduleResolution: node` honors the `exports` field — is false. Legacy node resolver does NOT honor `exports`. As written, v3's Phase B3a will break server/gateway type-check.

This is **1 net-new blocker that did not exist in v2**. Plus 1 net-new factual error in H3 (wrong filesystem target). The other v2 → v3 fixes look structurally correct on paper.

**Verdict:** v3 is materially closer to merge-ready than v2 (8 of 10 v2 blockers cleanly addressed) but has 1-2 new substantive issues introduced by the v3 changes themselves. Recommend ONE more refinement to v3.1 to fix B3a and H3, then stop the loop. If iter4 still surfaces structural issues, escalate to "structural rewrite needed" — but I don't expect it.

---

## Blockers (NEW in v3 — introduced by v3 changes themselves)

### N-B1. Phase B3a "drop `paths` entirely" doesn't work under `moduleResolution: node`

Verified: `server/tsconfig.json` and `gateway/tsconfig.json` BOTH use `"moduleResolution": "node"` (the legacy resolver). The legacy node resolver does NOT honor the `package.json` `exports` field — only `node16` / `nodenext` / `bundler` do.

When server's tsc encounters `import { extractErrorMessage } from '@sanctuary/shared/utils/errors'`, the resolver:
1. Walks `node_modules/` upward looking for `@sanctuary/shared`
2. Finds it (via the workspace symlink — fine)
3. Reads `package.json` `main` field for the bare-import case
4. For SUBPATH imports like `/utils/errors`, the LEGACY resolver IGNORES `exports` and looks at `node_modules/@sanctuary/shared/utils/errors.{ts,d.ts,js,index.{ts,...}}`

The file is at `node_modules/@sanctuary/shared/dist/utils/errors.js` — NOT at `node_modules/@sanctuary/shared/utils/errors.js`. Resolution fails. tsc errors: `Cannot find module '@sanctuary/shared/utils/errors' or its corresponding type declarations.`

**v2 found this correctly** (the convergent "paths ↔ exports divergence" finding). v2's fix was "point paths at `../shared/dist/*` so both type-check and runtime see the SAME built artifact, OR drop paths and rely on workspace symlink resolution at type-check time too." v3 picked the latter, but **the latter only works if `moduleResolution` honors exports** — which `node` doesn't.

**Fix (3 viable options, pick one explicitly in v3.1):**
- **(a)** Re-add `paths: { "@sanctuary/shared/*": ["../shared/dist/*"] }` to server/gateway tsconfig. Both type-check (via paths → dist .d.ts) and runtime (via require → dist .js) resolve the same artifact. Acceptable divergence: type-check fails until shared is built (acceptable — every CI lane builds first).
- **(b)** Upgrade server/gateway `moduleResolution: node` → `node16` or `nodenext`. Then exports map is honored. BUT this is a meaningful tsconfig change — affects how ALL imports resolve, not just shared. May require rewriting some deep-import patterns elsewhere (e.g., `fastify-plugin/something`). Bigger blast radius.
- **(c)** Restructure shared to emit at package root (no `dist/` subdirectory). E.g., `outDir: "."` with `rootDir: "./src"`. Makes the package look like a hand-built layout. Works under legacy node resolver. BUT pollutes the source tree with build outputs and complicates `.gitignore`.

**Recommended:** option (a). Smallest diff, matches iter2's first-listed option, divergence is contained (both resolve to dist).

**v3.1 update:** Phase B3a — RESTORE the `paths` mapping; point at `["../shared/dist/*"]` (NOT `["../shared/*"]`). Add a CI gate that asserts shared is built before tsc runs.

### N-B2. Phase H3 deletes the wrong filesystem target

v3 H3 says: "delete `node_modules/.prisma/client` (the historical script's symlink target) THEN verify Prisma resolution still works."

Verified by reading `server/scripts/ensure-shared-module-resolution.mjs` (32 lines):
- Script's ONLY action is `symlinkSync(serverNodeModules, repoNodeModules)` when `repo-root/node_modules` doesn't exist.
- Symlink is `repo-root/node_modules` → `server/node_modules`. NOT `node_modules/.prisma/client`.

Verified by reading `server/prisma/schema.prisma`: Prisma generates to `server/src/generated/prisma/client` (per `output = "../src/generated/prisma"` in the generator block). NOT `node_modules/.prisma/client`.

So:
- `node_modules/.prisma/client` doesn't even exist on this codebase (Prisma client output is custom).
- The script's "symlink target" is `repo-root/node_modules`, not anything under `.prisma/`.
- v3 H3's test deletes a path that doesn't exist; test passes trivially; proves nothing.

**Fix:** H3 regression test must replicate the ACTUAL failure condition the script guards against:
1. From a clean checkout, `rm -rf node_modules` AT REPO ROOT (the script's guard checks `repo-root/node_modules`).
2. Then `cd server && npm test` — under workspaces, root install creates root node_modules and the test passes.
3. To prove the script is no longer needed, also assert that NO test invocation depends on the symlink-creation side effect (e.g., grep all test files for any path that walks up to root node_modules expecting it to be a symlink to server/node_modules).

Equivalently: H3 can be replaced with "audit `git log --follow server/scripts/ensure-shared-module-resolution.mjs` for the original failure mode it was added to fix; reproduce that mode under workspaces; verify it doesn't recur."

---

## Should-fix (NEW in v3)

### N-S1. Phase B4 vitest alias to `dist/` may break coverage instrumentation

v3 changed B4 alias from `'../shared'` (source) to `'../shared/dist'` (built). Justification: keeps vitest aligned with runtime. Concern:

vitest coverage (v8/istanbul) instruments the files that are ACTUALLY LOADED. If the alias points at `dist/utils/errors.js`, coverage reports against `shared/dist/utils/errors.js`, not `shared/utils/errors.ts`. Three downstream effects:
1. Coverage thresholds keyed on `shared/utils/**.ts` paths may falsely report 0%.
2. Source-map fidelity matters: stack traces and "click-to-source" in HTML coverage reports go to `dist/` not `src/` unless source maps are perfect AND the vitest reporter respects them.
3. Mutation testing (Stryker) mutates the file vitest loads. If vitest loads `dist/`, Stryker mutates `dist/` — but every rebuild blows those mutations away. Mutation gate becomes useless for shared.

**Fix:** B4 alias should remain pointed at SOURCE (`'../shared'`) for vitest. The runtime-vs-test divergence is acceptable here because vitest is for development feedback, not for proving runtime behavior. Add a separate Phase B acceptance step: a single integration test that runs vitest against the BUILT artifact (e.g., `vitest run --pool=forks` with NODE_PATH pointing at `node_modules/@sanctuary/shared/dist`) — that test asserts the built artifact behaves identically to source for a representative case.

### N-S2. F1c smoke test may be over-engineered

v3 F1c: "add a `tests/smoke/eslint-shared-import.test.ts` that runs ESLint programmatically over a fixture file ... and asserts ZERO errors."

Running ESLint programmatically requires:
- `import { ESLint } from 'eslint'` (the JS API, slow to instantiate)
- Loading the entire `eslint.config.js` (which loads all plugins, parsers)
- Evaluating against a fixture file

This works but is slow (~2-5 sec startup) and fragile to ESLint API changes between major versions. **Alternative:** wire a CI-only step `scripts/ci/check-eslint-shared-pattern.sh` that runs `npx eslint server/src/utils/errors.ts` (a real file containing the migrated import) and asserts exit 0. Catches the regression without programmatic ESLint complexity. F1a's grep gate already catches the inverse direction (`../../shared/...` imports remaining).

Drop F1c entirely OR replace with the bash gate.

### N-S3. Phase D7 mutation gate pre-warm via "no-op PR" doesn't actually warm the cache

v3 D7: "run mutation gate on a no-op PR right after D merges to warm the cache."

Verified: `test.yml:525` cache key hashes a literal list of source paths + `shards.mjs` + `stryker.critical.config.mjs`. None of those change in a no-op PR, so the cache RESTORES from the OLD entry. Stryker then walks the restored `.stryker-cache/critical-incremental.shard-N.json`, hashes the actual source files, finds every hash mismatched (because D rewrote every import), and re-mutates from scratch.

Pre-warming on a no-op PR doesn't help — it just runs the mutation gate twice instead of once.

**Fix:** D7 should either (a) accept the one-time ~25 min cost on the first post-D PR, or (b) bump the cache prefix in `test.yml` line 525 to `-v3` along with Phase D, so the OLD cache is never restored and the mutation gate starts fresh from a known state. Option (b) is cleaner.

### N-S4. Phase B9 `.mjs` ESM smoke may need explicit named-export handling

v3 B9: `import { extractErrorMessage } from '@sanctuary/shared/utils/errors'` from a `.mjs` file; `typeof` must be function.

Concern: `tsc --module commonjs` emits CJS using `Object.defineProperty(exports, "__esModule", ...)` then `exports.extractErrorMessage = ...`. Node's named-export synthesis (cjs-module-lexer) MAY or MAY NOT pick up these names depending on the exact emit pattern. Specifically, the lexer recognizes:
- `module.exports = { foo: ... }`
- `exports.foo = ...`
- `Object.defineProperty(exports, "foo", {...})` (since Node 12.6)

`tsc` typically emits the second form for named exports — should work. But for re-exports via `export * from './errors'` in `index.ts`, tsc emits an `__exportStar` helper that calls `Object.defineProperty` dynamically — cjs-module-lexer DOES NOT handle the dynamic case.

**Result:** `import { extractErrorMessage } from '@sanctuary/shared/utils/errors'` (direct subpath) — works. `import { extractErrorMessage } from '@sanctuary/shared'` (via index re-exports) — likely fails with "Named export 'extractErrorMessage' not found".

**Fix:** B9 must test BOTH cases — direct subpath import AND bare `@sanctuary/shared` import. If the bare import fails, either accept that bare imports must use the default-import-then-destructure pattern (`import shared from '@sanctuary/shared'; const { extractErrorMessage } = shared;`), OR switch shared to dual-build (CJS + ESM) via `tsup` or similar. Document the constraint either way.

### N-S5. Phase G5 `architecture.yml` row may break under isolated-worktree runs

v3 G5: `architecture.yml:71-73` `npm --prefix server ci` → replace with `npm ci --workspace=server` from root.

`architecture.yml` uses `run-isolated` (per CLAUDE.md memory and recent CI work) which clones the repo into an ephemeral worktree. In that worktree, root `node_modules` does not yet exist. `npm ci --workspace=server` from root REQUIRES root install context — it's not a "install only this package" command, it's a "from this root, install only this workspace's contribution to the root install."

If the architecture lane needs only server's deps without installing the entire workspace tree, `npm ci --workspace=server` may install MORE than expected (root's own devDeps, gateway's deps via hoisting). Time + footprint grows.

**Fix:** G5 should distinguish "install one workspace's deps" from "install entire workspace tree." The right command for "just server" is `npm ci --workspace=server --include-workspace-root=false` (npm 8+) — but verify this still works under npm 11.11.0 and produces the expected tree shape. Add an acceptance step: `du -sh node_modules` after — should be roughly the same as today's `cd server && npm ci`.

### N-S6. Phase B3b deferred but no exit criteria defined

v3 says "B3b is OPTIONAL multi-file commit OR deferred entirely." But there's no criterion for WHEN to defer. The plan should state: "if Phase B3a + Phase G land successfully without B3b, B3b is deferred indefinitely and tracked as a separate cleanup task. The 'compile pollution' it would clean up — server's dist containing `dist/server/src/...` and `dist/shared/...` — is cosmetic only and has no runtime impact."

Add this exit criterion explicitly so future-you doesn't try to backfill B3b unnecessarily.

### N-S7. Phase H1 "read script for side effects" is now satisfiable inline in the plan

I read the script. It's 32 lines. Its ONLY side effect is `symlinkSync(serverNodeModules, repoNodeModules)` when `repo-root/node_modules` doesn't exist. Under workspaces, `repo-root/node_modules` ALWAYS exists, so the symlink branch is dead. v3's H1 can be tightened from "read the script's actual code; enumerate every side effect" to "verified: script's only side effect is creating `repo-root/node_modules` symlink to `server/node_modules` when the former doesn't exist; workspaces makes that condition impossible. Safe to delete."

This isn't a finding so much as a tightening — the v3 plan can incorporate this verification result inline rather than leaving it as a TODO.

---

## Summary

| Severity | Count |
| --- | --- |
| Blocker (NEW in v3) | 2 |
| Should-fix (NEW in v3) | 7 |
| Nice-to-have | 0 |

## Top risks (this iteration)

1. **B3a drops `paths` but `moduleResolution: node` doesn't honor `exports`** — type-check breaks; iter2 said "point both at dist OR drop paths"; v3 chose drop without verifying. **N-B1.**
2. **H3 deletes the wrong filesystem target** — test proves nothing. **N-B2.**
3. **B4 vitest alias to `dist/` likely breaks coverage instrumentation** — would silently report wrong coverage for shared utilities. **N-S1.**

## Convergence trajectory

| Iter | Blockers | Should-fix |
| --- | --- | --- |
| 1 (synthesized) | 4 (convergent across 3 reviewers) | many |
| 2 (synthesized) | 8-10 distinct | ~15 |
| 3 (this) | 2 NEW | 7 NEW |

Trajectory is converging. v3.1 should resolve N-B1 + N-B2 + N-S1 (the three blocker-or-near-blocker items) and accept the rest. After v3.1, if iter4 still surfaces NEW blockers, escalate. My estimate: iter4 will find ≤1 NEW blocker, and the loop should stop after v3.1.
