---
name: Iter2 review findings — fork B
description: Independent review #B of v2 plan in tasks/todo.md, focused on 10 specific attack vectors
type: review
---

# Iter2 review #B — `tasks/todo.md` v2 (shared/ → real npm workspace package)

Plan reviewed: `/home/nekoguntai/sanctuary/tasks/todo.md` top entry, "shared/ → real npm workspace package (v2) 2026-05-10".
Reviewer: independent Claude fork, no coupling to author session.
Method: re-verified every claim against current source; explicitly attacked the 10 vectors from the prompt + cross-cutting issues that surfaced.

## Summary (5 bullets)

- **BLOCKER — Phase B3 `rootDir: "./src"` change silently breaks production.** Server's `main` and `start` reference `dist/server/src/index.js` (and the seed compile invocations + Dockerfile COPY layout assume that layout). Changing `rootDir` reshapes the dist tree to `dist/index.js`. `tsc --noEmit` cannot detect this — emit shape changes only on a real build. Multiple call sites are not enumerated. **Plan must (a) keep `rootDir: "./src"` ↔ `main: "dist/index.js"` consistent, (b) update Dockerfile COPY paths, the prisma seed compile, and any `node dist/server/src/index.js` references in compose/scripts in the SAME PR.**
- **BLOCKER — Frontend has no resolution path for `@sanctuary/shared/*` after Phase E.** Frontend lives at the repo root but is NOT in the `workspaces` array (B1: `["shared", "server", "gateway"]`); root never declares `@sanctuary/shared` as a dependency; `vite.config.ts` resolve.alias for `@shared` is removed only in `vitest.config.ts` (E2), never in `vite.config.ts`. Frontend dev/build will fail to resolve the rewritten imports from D5. Either add root → `@sanctuary/shared` dep + leave root in the workspace host position, or update `vite.config.ts` to alias `@sanctuary/shared` → `./shared`.
- **BLOCKER — Phase G5 covers ONE cache; the lockfile-collapse cascade hits at least 6 more workflows.** Under `npm workspaces`, server/gateway lose their `package-lock.json` files. Today: `architecture.yml` runs `npm --prefix server ci` / `--prefix gateway ci` / `--prefix website ci`; `verify-vectors.yml` does the same from `server/`; `quality.yml` runs `npm --prefix server audit`; `scripts/quality/check-lockfile-peer-resolution.sh` iterates `DIRS=(. server gateway ai-proxy)` and **silently skips packages without a lockfile** (regression-quietly degrades the gate). All of these break or silently degrade. Plan must enumerate + migrate or stage them.
- **BLOCKER — Plan H deletes `ensure-shared-module-resolution.mjs` and its 22 invocations but the regression test in H3 only probes Prisma client resolution.** The script's named purpose was symlink/cache prep around node_modules; the actual side effects (e.g., the Dockerfile-companion `RUN ln -s /app/node_modules /node_modules` hack and any developer workflow that relied on a stable `repo-root/node_modules`) are not enumerated. Audit `git log --follow server/scripts/ensure-shared-module-resolution.mjs` and ALL 22 call sites (not just `pre*` lifecycle) before deletion.
- **SHOULD-FIX × multiple — see body.** Notable: codemod scope is wrong (D1 `tsConfigFilePath: 'server/tsconfig.json'` won't see tests/ or root frontend); Stryker mutation gate baseline rebuild not addressed; `composite: true` consequences not considered; `moduleResolution: node` + `exports` interaction needs explicit type-vs-runtime divergence note; Dockerfile symlink hack removal not in G1; `npm prune --production` interaction with workspace symlinks not validated.

Path: `/home/nekoguntai/sanctuary/tasks/review-findings-iter2-forkB.md`

---

## Per-attack-vector findings

### 1. Production runtime surprises (Vite + CJS interop) — **BLOCKER (frontend unresolved)**

**Concrete problem.** Frontend code at repo root currently uses `@shared/*` (12 imports). Phase D5 rewrites these to `@sanctuary/shared/*`. But:
- Root `package.json` has `"workspaces": ["shared", "server", "gateway"]` (B1). Root itself is the workspace HOST, not a workspace member; npm does NOT auto-link workspace packages to the host's `node_modules` unless declared as a dependency.
- Plan never adds `"@sanctuary/shared": "workspace:*"` to root `dependencies`/`devDependencies`.
- `vite.config.ts` retains `'@shared': path.resolve(__dirname, './shared')` — Phase E2 only removes the alias from `vitest.config.ts`, NOT `vite.config.ts`.
- Result: `npm run dev` / `npm run build` / `vite preview` fails with "Failed to resolve `@sanctuary/shared/utils/...`".

**Suggested change.** EITHER (a) add `"@sanctuary/shared": "workspace:*"` to root `dependencies` and confirm Vite picks up the symlink at `node_modules/@sanctuary/shared`, OR (b) update Phase E2 to also rewrite `vite.config.ts` resolve.alias from `@shared` → `@sanctuary/shared` pointing at `./shared` (skip the workspace symlink for frontend, keep alias-based path). Pick one explicitly.

**Secondary CJS/ESM concern.** Root has `"type": "module"`; shared emits CJS via `tsc --module commonjs`. ESM-from-CJS interop relies on Node's named-export synthesis. Many shared utils export named symbols (e.g., `extractErrorMessage`). For frontend code bundled by Vite this is fine (Vite's resolver handles it). For any Node-context script at root that imports from shared (e.g., `scripts/**/*.mjs` or `scripts/**/*.ts` compiled by tsconfig.scripts.json), `import { x } from '@sanctuary/shared/...'` against the CJS dist may yield `undefined` for named exports under strict ESM. Add a Phase A6 sub-bullet: "from a `.mjs` script, `import { extractErrorMessage } from '@sanctuary/shared/utils/errors'` resolves and returns the function".

### 2. Phase A4 `.gitignore` claim — **CONFIRMED OK**

Verified: root `.gitignore` line 24 contains bare `dist/` (no leading slash), which matches `shared/dist/` at any depth. Phase A4's "verify it's not already covered" preflight is correct. Recommend tightening A4 wording to "no-op: confirmed already ignored at root .gitignore line 24, no change required".

### 3. `private: true` overloading — **CLARIFICATION NEEDED, NOT BLOCKING**

Three semantics overlap and the plan never disambiguates:
- Root `package.json` already has `"private": true` (prevents npm publish of monorepo).
- Phase A2's `shared/package.json` has `"private": true` (prevents accidental publish).
- npm `workspaces` works whether the root is `private: true` or not.

These are independent and compatible. But the v2 plan's stated future "publish externally later" (review iter1 Direction A motivation) requires removing `private: true` from `shared/package.json` AND choosing a publishable name (the `@sanctuary/` scope is not registered on npmjs.com unless someone owns it). Add a note to Phase A2: "`private: true` is for monorepo-only consumption; flipping to publishable later requires (a) removing this field, (b) confirming or registering the `@sanctuary` npm scope, (c) setting `version` to a real semver, (d) removing `workspace:*` consumers from external publishability path."

### 4. Mutation gate baseline rebuild decision criteria — **SHOULD-FIX, NOT ADDRESSED**

Phase D rewrites all 47 server `from '../../../../../shared/...'` imports to `from '@sanctuary/shared/...'`. Stryker's incremental cache (`server/.stryker-cache/critical-incremental.shard-N.json` per `test.yml:524`) keys mutation results by file + content hash. After the codemod:
- Every mutated file has changed content → entire incremental cache invalidates → first post-D run is a full mutation pass on all 3 shards (likely ~20-30min vs 3-5min cached).
- The cache key in `test.yml:525` hashes a literal list of source paths plus `shards.mjs` and `stryker.critical.config.mjs`. None of those paths change in Phase D, so the cache RESTORE will hit a stale entry and Stryker will detect content mismatch → recompute.

This isn't broken per se, just slow on the first post-D run, and worth budgeting. Add a note to Phase D6 or I4: "expect first mutation run after import rewrite to be uncached (~25min); consider running it on a no-op PR after Phase D merges, before Phase I, so the I-probe baseline is fast."

### 5. Workflow CI cache invalidation cascade — **BLOCKER**

Plan G5: "switches to hash root `package-lock.json` + per-package package.json. Bump prefix to `-v3`." Covers ONLY `.github/actions/setup-server-deps/action.yml`. Audit shows the lockfile-collapse breaks far more:

| Workflow / file | Current call | Breaks how |
| --- | --- | --- |
| `architecture.yml:71-73` | `npm --prefix server ci` / `--prefix gateway ci` / `--prefix website ci` | `--prefix` cannot install workspace child via root lockfile; needs `npm ci --workspace=server` from root |
| `verify-vectors.yml:93,265,317` | `npm ci --ignore-scripts` (cwd = server) | server has no lockfile → fails |
| `verify-vectors.yml:272` | `npm ci` (root) | OK but installs ALL workspaces; may pull gateway in vector tests unexpectedly |
| `quality.yml` audit step | `npm --prefix server audit` (line ~180) | server has no lockfile → silent skip OR error |
| `scripts/quality/check-lockfile-peer-resolution.sh:22` | iterates `DIRS=(. server gateway ai-proxy)`, `[ ! -f package-lock.json ] && continue` | **silently skips** server/gateway → peer-resolution regression gate degrades quietly |
| `.github/actions/cache-npm/action.yml` default `lockfile-glob: **/package-lock.json` | hashes any present locks | works but key changes; safe |
| `release.yml`, `release-offline-bundle.yml`, `install-test.yml` | various per-package `npm ci` | unverified; needs sweep |

**Suggested change.** Replace G5 with a Phase G5 that:
- Enumerates EVERY workflow + script that runs `npm --prefix <X> ci`, `cd <X> && npm ci`, `npm audit --prefix <X>`, or iterates `(. server gateway)` for lockfile presence.
- Prescribes the workspace-aware replacement for each (`npm ci --workspace=<X>` from root, OR `npm ci` at root with workspace install enabled by default).
- Updates `check-lockfile-peer-resolution.sh` to either (a) operate from root + run npm with `--workspace=<X>`, or (b) document that server/gateway peer drift is now caught by root install.

### 6. Concurrency with `npm install --workspaces` — **SHOULD-FIX**

Today, parallel CI lanes (e.g. `architecture.yml` running root + server + gateway + website installs in parallel within an isolated workspace) each touch their own per-package `node_modules`. After workspaces, all four installs would touch root `node_modules` — but architecture.yml uses `run-isolated`, so each is in its own clone, which dodges the issue.

Risk surface that remains:
- `test.yml` lines 798/889 use `with-runner-lock.sh node-toolchain` to serialize `npm ci`. Under workspaces every `npm ci` becomes implicitly multi-package; lock contention surface broadens. Should still work because the existing lock serializes them, but the time budget per-lock grows.
- The Forgejo runner concurrency memory ([feedback_forgejo_runner_concurrency.md](file:memory)) notes single-bash-loop serialization is the workaround for runner.capacity caps. A larger `npm ci` payload per acquisition is fine, but plan should call out that average install time will grow ~2-3× (root install builds shared + server + gateway transitives at once) and the existing 25-min step timeouts have headroom.

**Suggested change.** Add a Phase G acceptance bullet: time `npm ci` at root with three workspaces vs. today's per-package install on a clean cache — if it exceeds half of any current step timeout, bump those timeouts proactively.

### 7. Frontend `@shared/*` migration covers Vite config — **BLOCKER (subset of vector 1)**

Already raised in vector 1. Re-emphasizing as a discrete blocker so it's checked separately: **`vite.config.ts:32` `'@shared': path.resolve(__dirname, './shared')` is never removed by the v2 plan.** After D5 rewrites all frontend imports to `@sanctuary/shared/*`, this alias becomes dead code (orphan) AND `@sanctuary/shared/*` has no resolution path in Vite. Phase E2 must include `vite.config.ts` (and any `vite.*.config.ts` variants).

### 8. `composite: true` consequences — **SHOULD-FIX**

Phase A1 sets `composite: true` "even if we don't enable refs in v2". Consequences:

- `composite: true` requires `declaration: true` (✓ already in A1).
- Forces **all input files to be inside `rootDir`** (default `./`). Currently fine — shared has no imports outside its tree.
- Emits `tsconfig.tsbuildinfo` next to outputs. Phase A4 only adds `shared/dist/` to .gitignore; the tsbuildinfo lives in `shared/` itself. Add `shared/*.tsbuildinfo` to .gitignore OR direct it into `shared/dist/.tsbuildinfo` via `tsBuildInfoFile`.
- Marks the project as a referenceable target. Without a consumer using `references: [{ path: "../shared" }]`, this provides no value, only friction (e.g. when a consumer enables `references` later, every shared file becomes a build dependency, and ad-hoc tsc invocations like `cd server && tsc --noEmit` may need `tsc -b` instead).
- Most importantly: when `composite: true` is set on shared but server/gateway use `paths` instead of `references` (as in B3), TS may emit a warning ("composite project not referenced"). Verify on a sample type-check.

**Suggested change.** Either (a) drop `composite: true` from A1 (defer to a separate "enable project references" follow-up) and include only what's needed for the workspace path, OR (b) commit to project references in v2 and add `references` blocks in B3/C2 alongside `paths`.

### 9. `"dependencies": {}` correctness audit — **SHOULD-FIX**

Phase A2: "No `dependencies` (shared has none today)." Spot-check across `shared/`:

```
shared/utils/   — 9 files
shared/types/   — 5 files
shared/schemas/ — 1 file (zod schema for mobile API)
shared/constants/ — 1 file
```

`shared/schemas/mobileApiRequests.ts` likely imports `zod`. If so, shared transitively depends on zod. Today this works because consumers (root, server, gateway, ai-proxy) all have `zod` in their own dependencies, so a relative-path import of shared/schemas/X resolves zod from the importer's `node_modules`. Once shared is a real package with `node_modules/@sanctuary/shared`, Node's resolver walks up from the symlinked location: `shared/node_modules → root node_modules`. With workspaces hoisting, zod will be at root, and the walk-up succeeds — so it likely still works in practice.

But the package contract is lying: shared declares zero dependencies while importing one. Two failure modes:
- If zod is ever removed from server/gateway and added only to root devDeps, server's prod install (post-`npm prune --production`) drops zod, and shared's `import { z } from 'zod'` blows up at runtime.
- Publishability (per finding 3) is impossible with mis-declared deps.

**Suggested change.** Audit shared's actual external imports (`grep -rE "^import .* from ['\"][^./]" shared/`). Whatever appears (likely `zod`) goes into `shared/package.json` `dependencies` AND `peerDependencies` (the latter so consumers don't get duplicate copies hoisted). Add this as Phase A2 sub-bullet "audit + declare actual deps".

### 10. `exports` vs `imports` field syntax compatibility with `moduleResolution: node` — **SHOULD-FIX, MITIGATED-IN-PLAN**

Verified: server `tsconfig.json` and gateway `tsconfig.json` both use `"moduleResolution": "node"`. The legacy "node" resolver does **NOT** honor the `package.json` `exports` field — only `node16`/`nodenext`/`bundler` do. Therefore, at TYPE-CHECK time, server's TypeScript would NOT resolve `import x from '@sanctuary/shared/utils/errors'` via the exports map.

The plan's mitigation is the `paths: { "@sanctuary/shared/*": ["../shared/*"] }` block (B3). This works for type-checking against TS source. So:
- **Type-check**: resolves via `paths` → `../shared/utils/errors.ts` (TS source).
- **Runtime (Node 24)**: resolves via `exports` → `node_modules/@sanctuary/shared/dist/utils/errors.js` (CJS dist).
- **Vitest (server)**: resolves via `resolve.alias` `'@sanctuary/shared': '../shared'` (B4) → TS source.

Three different resolution targets (source TS, dist CJS, source TS) for three different runtimes — divergence risk. Specifically: a TS-only feature used in shared (e.g., a const-enum, a type-only re-export, an experimental syntax) will type-check fine but blow up in production where the dist CJS is consumed.

**Suggested change.** Add a Phase B verification bullet: "after Phase B5, in a server smoke test, import the SAME symbol via `@sanctuary/shared/utils/errors` AND run that test against the BUILT `dist/server/src/index.js` artifact (not the tsx-transpiled source) — confirms the dist→dist resolution works end-to-end, not just the source→source dev path." Also, consider migrating server tsconfig to `moduleResolution: "node16"` or `"nodenext"` as a follow-up, which eliminates the divergence.

---

## Cross-cutting findings (not from the 10-list but surfaced during audit)

### CC-1. Codemod scope is too narrow — **SHOULD-FIX**

Phase D1 example: `new Project({ tsConfigFilePath: 'server/tsconfig.json' })`. ts-morph projects loaded from a tsconfig only see files in that project's `include`. Server tsconfig today includes `src/**/*` + `../shared/**/*`. After Phase B drops shared from include, the codemod project sees only `server/src/**`. **D4** (tests) and **D5** (frontend) need separate Project instances against `server/tsconfig.test.json`, root `tsconfig.tests.json`, root `tsconfig.app.json`, root `tsconfig.scripts.json` respectively — not a single project.

Verified in `tests/shared/`: BOTH `@shared/utils/...` and `../../shared/utils/...` styles in use today. The codemod's match regex `^(\.\.\/)+shared\/(.+)$` covers relative-path style; D5 needs a separate regex `^@shared\/(.+)$` for the alias style. Plan mentions "different match regex" for D5 but doesn't enumerate that the SAME root tests use both styles, so a single project + multi-regex visitor is needed.

### CC-2. Server Dockerfile symlink hack — **BLOCKER, MISSED BY PLAN**

`server/Dockerfile:42-43`:
```
RUN ln -s /app/node_modules /node_modules
```
This exists because today shared/* lives at `/shared` (sibling to `/app`), and its compiled output expects to walk up to `/node_modules` for transitive deps. Phase G1 restructures the Dockerfile for "root-context `npm install`" but never explicitly removes this symlink. With the workspace migration:
- shared no longer compiles inline into server's dist
- shared's runtime CJS lives at `/app/node_modules/@sanctuary/shared/dist/...`
- The symlink at `/node_modules` becomes either dead code OR worse, conflicts with the prod `node_modules` layout.

**Suggested change.** Add a G1 bullet: "remove the `RUN ln -s /app/node_modules /node_modules` line; confirm shared's dist resolves transitive deps via standard `/app/node_modules` walk-up."

### CC-3. `npm prune --production` × workspace symlink — **SHOULD-FIX**

Server Dockerfile builder stage: `RUN npm prune --production` (line ~57). Under workspaces, server's dependency `"@sanctuary/shared": "workspace:*"` is a `node_modules/@sanctuary/shared` symlink to `../shared`. npm 11's behavior on prune is documented to preserve workspace symlinks, but the actual semantics in a Docker layer copied from one stage to another via `COPY --from=builder /app/node_modules` — where the symlink target may not exist in the destination — needs explicit verification.

**Suggested change.** Add a G1 acceptance: "after `npm prune --production` and the production stage `COPY --from=builder /app/node_modules`, confirm `node /app/node_modules/@sanctuary/shared/dist/utils/errors.js` is readable inside the runner container."

### CC-4. Server `main` + `start` path break risk — **BLOCKER (Phase B3 wording)**

Phase B3: "Reconsider `rootDir: ".."` — likely no longer needed (was set to allow shared/ inclusion). Set to `"./src"` or remove. Verify `tsc --noEmit` after the change."

This is the single most dangerous wording in the v2 plan. `tsc --noEmit` does NOT validate emit. The actual emit shape today is:

```
dist/
├── server/src/index.js         ← package.json main + start target
├── server/src/.../*.js
└── shared/.../*.js
```

If `rootDir` becomes `"./src"`, emit shape becomes `dist/index.js`, `dist/.../*.js`. Server `main: "dist/server/src/index.js"` and `start: "node dist/server/src/index.js"` reference the OLD path. Container start will fail.

**Suggested change.** Phase B3 becomes a multi-step bullet:
1. Remove `"../shared/**/*"` from `include` AND change `rootDir` from `".."` to `"./src"` AND update `package.json` `main` to `dist/index.js` AND update `start` to `node dist/index.js` AND update Dockerfile `EXPOSE`-stage references AND update `docker-compose.*.yml` references AND update `verify-vectors.yml` server start commands. **All in one PR**, none can lag.
2. Build the server image AND run a container AND `curl localhost:3001/api/health` to confirm before merging.

### CC-5. `ensure-shared-module-resolution.mjs` deletion blast radius — **BLOCKER**

Phase H deletes the script + 22 invocations. The provided regression test (H3) only probes Prisma client resolution via `await import('../generated/prisma/client')`. Audit needed:
- Read the script's actual code (not just the first guard) — what does it ACTUALLY do besides the early-exit no-op? If it only no-ops under workspaces, fine. If it has side effects (creating symlinks, copying files, validating layout) that are masked by the early exit, deletion will silently lose those.
- The script is named `ensure-shared-module-resolution.mjs` — historically it likely DID set up the resolution that the workspace migration is now replacing. Confirm this is true; if not, the title is lying and the script does something else.
- Test with H3's regression test on a clean checkout WITHOUT the workspace migration applied first, to establish a true baseline of what breaks without the script.

**Suggested change.** Phase H1 becomes "READ the script; enumerate every side effect; for each side effect, identify the workspace-migration replacement; ONLY THEN delete." H3 expands to cover each enumerated side effect, not just Prisma.

### CC-6. Stryker probe in Phase I needs a control case — **SHOULD-FIX**

Phase I1: "create a Stryker sandbox manually using the broad config, inspect..." Good. But missing: a control. The probe needs to confirm two things:
1. With workspaces applied, the symlinked `node_modules/@sanctuary/shared` IS present in the sandbox.
2. With workspaces NOT applied (i.e., on the current main branch), the sandbox does NOT have it (proving the migration is what made the difference, not some unrelated change).

Without (2), a positive probe could be misleading (e.g., Stryker might have changed sandbox behavior independently in a recent version).

**Suggested change.** I1 sub-bullet: "Run the probe TWICE — once on a `git stash` of the workspace changes (control), once with them applied (treatment). Diff the sandbox node_modules trees."

---

## Risk roll-up

| # | Issue | Severity | Phase |
| --- | --- | --- | --- |
| CC-4 | `rootDir`/`main`/`start` cascade not in single PR | Blocker | B |
| 1 | Frontend has no `@sanctuary/shared` resolution path | Blocker | E (also B1) |
| 5 | CI cache cascade misses 6+ workflows + peer-resolution gate | Blocker | G5 |
| CC-2 | Dockerfile symlink hack not removed | Blocker | G1 |
| CC-5 | `ensure-shared-module-resolution.mjs` deletion under-tested | Blocker | H |
| CC-1 | Codemod project scope too narrow | Should-fix | D |
| CC-3 | `npm prune --production` × workspace symlink unverified | Should-fix | G |
| 4 | Mutation gate baseline rebuild cost | Should-fix | D6/I |
| 6 | Concurrency / install time growth not budgeted | Should-fix | G |
| 8 | `composite: true` consequences (unused, friction) | Should-fix | A1 |
| 9 | shared dependency declaration likely under-declared | Should-fix | A2 |
| 10 | `moduleResolution: node` × `exports` divergence | Should-fix | B |
| CC-6 | Stryker probe needs control case | Should-fix | I |
| 7 | `vite.config.ts` alias missed (subset of #1) | (folded) | E |
| 3 | `private: true` semantics not disambiguated | Nice-to-have | A2 |
| 2 | `.gitignore` claim verified OK | Confirmed | A4 |

**Recommendation.** v2 is closer to right shape than v1 but still has 5 Blockers. Don't execute Phase A until the BLOCKERS for Phases B, E, G, H are resolved in plan text — they are not orthogonal (B3 cascade especially crosses Dockerfile + compose + test workflow + CI scripts and must be one PR or dual-resolution scaffolding has to be richer). One more iteration to v3 is justified; the Direction A choice itself remains correct, the implementation surface was just bigger than v2 captured.
