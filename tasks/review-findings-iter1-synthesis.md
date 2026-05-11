# Synthesis — iteration 1 (Claude + 2 independent fork reviewers)

Plan reviewed: `tasks/todo.md` top entry "shared/ → npm workspace package 2026-05-10".

Three independent reviews:
- `tasks/review-findings-iter1-claude.md` — author's own re-review (3 blockers, 13 should-fix, 3 nice-to-have)
- `tasks/review-findings-iter1-fork.md` — independent Claude reviewer #1 (4 blockers, 11 should-fix, 2 nice-to-have)
- `tasks/review-findings-iter1-fork2.md` — independent Claude reviewer #2 (5 blockers, 13 should-fix, 2 nice-to-have)

## Convergence — the high-confidence findings

These were raised by **2 or more reviewers independently**:

| Finding | Raised by | Severity |
| --- | --- | --- |
| `exports: ./*.ts` won't resolve at Node native runtime | All 3 | **Blocker** |
| Stryker sandbox symlink behavior unverified — Phase D risks a third structural failure | Claude + Fork 2 | **Blocker** |
| Dockerfile changes are substantive restructuring, not "verify" | Claude + Fork 2 | **Blocker** |
| Sed codemod misses depth-5 imports | Claude + Fork 2 | **Blocker** |
| ESLint rule shape wrong (uses `no-restricted-syntax` selector for what `no-restricted-imports` patterns) | Claude + Fork 1 | Should-fix |
| Cache-key migration timing / lockfile authority | Claude + Fork 2 | Should-fix |

## Net-new from the forks (worth surfacing)

- **Fork 1: `server/scripts/ensure-shared-module-resolution.mjs` is invoked by 22 npm scripts.** Silently becomes a no-op once workspaces hoist `node_modules`. Plan never mentions it; protection it was added for evaporates without anyone noticing.
- **Fork 1: ai-proxy isolation cannot be enforced** by omitting from `workspaces` alone — npm hoists `node_modules/@sanctuary/shared` to repo root; ai-proxy's resolver walks up and finds it. Boundary becomes documentation-only.
- **Fork 1: `server/dist/shared/*` already exists** — server's tsc currently compiles `../shared/**/*` INTO its own dist via tsconfig `include`. The workspace-package model and the inline-compile model are *mutually exclusive*; the plan picks neither cleanly.
- **Fork 2: Server tsconfig has NO `paths` block today** — it's `module:commonjs / moduleResolution:node`. Phase A4 needs the entire `paths` + `baseUrl` block CREATED, not "added to".

## The strategic problem

Fork 1 gave the framing that crystallizes this:

> **What is the goal — `shared` as a real npm package with its own build artifacts, OR `shared` as a `paths`-only token that consumers still inline-compile?**

The plan as drafted picks neither cleanly. It says "real package" (workspaces, exports map) but assumes "inline-compile" semantics (`exports: ./*.ts`, no `shared/dist/`). The contradiction shows up in 5+ blockers across the reviewers.

## Three viable directions

### Direction A — Real package with build artifacts (heavier)

- Add `shared/tsconfig.json` + `shared/package.json` with proper build (`tsc -p shared/tsconfig.json` → `shared/dist/`)
- `exports` map points at `./dist/*.js` + `./dist/*.d.ts` for types
- Server/gateway depend on `@sanctuary/shared` via `workspace:*`; their tsconfig stops compiling `../shared/**/*` directly
- Production: server's compiled JS imports `@sanctuary/shared/utils/foo` which resolves to `node_modules/@sanctuary/shared/dist/utils/foo.js`
- Adds a build step to `shared` (5-second `tsc` invocation pre-CI)
- Pays back: Stryker sandbox actually works (resolves through `node_modules`), tooling is unsurprising, can publish externally later
- Cost: ~3-4 days vs the 2-3 estimated; touches more files

### Direction B — TypeScript Project References (lighter, surfaced by Fork 1)

- Add `composite: true` to `shared/tsconfig.json`
- Add `references: [{ "path": "../shared" }]` in server/gateway/root tsconfigs
- No npm workspaces, no `package.json` for shared
- TypeScript handles cross-package resolution + incremental builds
- 70% of the wins (convention enforcement at compile time, faster incremental builds, IDE clarity) at maybe 20% of the risk
- Does NOT unlock Stryker vitest+perTest (still has the same sandbox issue) — Phase 5 stays deferred
- Cost: ~1 day; few files touched

### Direction C — Phase 5 unlock-only via Stryker hook (surgical)

- Skip the workspace migration entirely
- Write a small Stryker plugin or sandbox-prep script that recreates the `../shared` symlink inside each sandbox before tests run
- Mirrors what the OLD `command` runner's `ENSURE_SANDBOX_RUNTIME_LINKS` did, but runs at vitest-runner sandbox-init time
- Unlocks Phase 5 with no broader refactor
- Cost: ~0.5 day; risk concentrated in one Stryker plugin
- Doesn't address the convention drift, doesn't unify the bifurcated import style, doesn't help future sandbox-creating tools

## Recommended next step

**Don't iterate the current plan to v2 — pick a direction first.**

The reviewer convergence + my own analysis says iterating is grinding diminishing returns; the plan picked the wrong shape (workspaces with `*.ts` exports), not just under-specified the right one. Refining will produce a v2 with the same load-bearing assumption errors.

My honest recommendation by use-case:
- **If goal is "Phase 5 unlock + future-proofing" with budget for ~3-4 days** → Direction A (real package, build artifacts).
- **If goal is "convention enforcement now, defer Phase 5"** → Direction B (project references).
- **If goal is "Phase 5 done, nothing else"** → Direction C (Stryker plugin).

Each is a different plan; the plan in `tasks/todo.md` doesn't map cleanly to any. Choose, then I'll draft a fresh plan from the right shape with the convergent findings already designed-in.
