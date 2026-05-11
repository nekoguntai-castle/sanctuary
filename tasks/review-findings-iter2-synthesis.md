# Synthesis — iteration 2 (Claude + 2 independent fork reviewers)

Plan reviewed: `tasks/todo.md` top entry "shared/ → real npm workspace package (v2) 2026-05-10".

Three independent reviews (all Claude forks, no coupling):
- `tasks/review-findings-iter2-claude.md` — author's own re-review (3 blockers, 10 should-fix)
- `tasks/review-findings-iter2-coordinator.md` — independent reviewer A (3 blockers, 8 should-fix, 2 nice-to-have)
- `tasks/review-findings-iter2-forkB.md` — independent reviewer B (5 blockers, 9 should-fix, 1 nice-to-have)

## Convergence — high-confidence findings (2+ reviewers)

| Finding | Reviewers | Severity | Phase |
| --- | --- | --- | --- |
| `zod` (and any other external import) not declared in `shared/package.json` | Claude + ForkB | **Blocker** | A2 |
| `paths` (TS source) ↔ `exports` (CJS dist) resolve different files; stale builds pass tsc, break runtime | All 3 | **Blocker** | B3 |
| `composite: true` is friction with no payoff in v2 (no `references` consumer planned) | All 3 | Should-fix | A1 |
| ai-proxy isolation runtime test runs from wrong cwd; npm-only test insufficient — Docker-level test required | Claude + ForkA | Should-fix | F4 |
| `ensure-shared-module-resolution.mjs` deletion sweep incomplete; H3 regression test is placebo | All 3 | **Blocker** | H |
| Stryker probe (Phase I1) lacks concrete command + control case | All 3 | Should-fix | I1 |
| `vite.config.ts` `@shared` alias not removed by E2 (only `vitest.config.ts` covered) | Claude + ForkB | **Blocker** | E2 |
| Cache-key invalidation cascade incomplete (G5 covers 1 of many caches/workflows) | Claude + ForkB | **Blocker** | G5 |

## Net-new blockers (raised by single reviewer, but high-impact)

- **ForkA C-B1** — `exports` map omits `.` (root) entry. Phase A3 creates `shared/index.ts` for legacy bare imports; without `"."` entry in exports, `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime. **Phase A2.**
- **ForkA C-B2** — Docker symlink design dangles at runtime. Workspace symlink target is repo-relative (`../../shared`); production stage COPY without `cp -L` or matching layout breaks `require('@sanctuary/shared')`. **Phase G1.**
- **ForkA C-B3** — F1 ESLint pattern `**/shared/**` matches the new `@sanctuary/shared/*` workspace specifier. Rule would block every import the migration creates. **Phase F1.** (Independent of Claude's F1-B1 finding that scope misses server/gateway — both true; both must be fixed.)
- **ForkB CC-4** — Phase B3's `rootDir: "./src"` change reshapes emit tree from `dist/server/src/index.js` to `dist/index.js`. Server's `main`, `start`, Dockerfile, prisma seed, compose files, `verify-vectors.yml` ALL reference the old path. `tsc --noEmit` cannot detect emit-shape changes. **Phase B3.**
- **ForkB Vector 1** — Frontend has no resolution path for `@sanctuary/shared/*` after Phase E. Root `package.json` `workspaces: ["shared", "server", "gateway"]` does NOT include the root itself; `@sanctuary/shared` is never declared as a root dep. After D5 rewrites frontend imports, `npm run dev`/`build` fails. **Phase E (also B1).**
- **ForkB CC-2** — `server/Dockerfile:42-43` has `RUN ln -s /app/node_modules /node_modules` symlink hack from the old layout. Phase G1 never removes it. **Phase G1.**

## Net-new should-fix

- **ForkA C-S1** — sweep also covers `.github/workflows/verify-vectors.yml` (3 sites) and `scripts/ci/setup-server-dependencies.sh`. ~23 sites total, not 20.
- **ForkA C-S3** — `shared/utils/README.md` shim convention paragraph becomes obsolete; J1 needs a section rewrite, not clause update.
- **ForkA C-S6** — pre-flight grep gate between D5 and E1 (verify all `@shared/*` rewrites complete before tsconfig path removal).
- **ForkB CC-1** — codemod scope is single ts-morph Project; needs separate Projects for `server/tsconfig.test.json`, root `tsconfig.tests.json`, root `tsconfig.app.json`, `tsconfig.scripts.json`. tests/shared uses BOTH `@shared/...` AND `../../shared/...` styles.
- **ForkB Vector 4** — first mutation run after Phase D will be uncached (~25min vs 3-5min cached); budget time, optionally pre-warm on no-op PR.
- **ForkB Vector 6** — root `npm ci` with workspaces builds shared+server+gateway transitives at once; install time grows ~2-3×; verify step timeouts have headroom.
- **ForkB CC-3** — verify `npm prune --production` preserves workspace symlinks correctly across Docker stage boundaries (`COPY --from=builder /app/node_modules`).
- **ForkA C-N1, C-N2** (nice-to-have) — frontend bundle-size before/after measurement; align target across packages (consider ES2022).

## Convergence verdict

**Not converged.** Iter2 surfaced 5 net-new blockers and ~7 net-new should-fix items. None contradict v2's direction (Direction A — real npm package with build artifacts) — they're all implementation-surface gaps the v2 plan didn't enumerate.

Per the /review skill: iter3 is permitted. The structural choice is sound; the implementation map is incomplete. One more refinement pass to v3 is justified IF the v3 update incorporates all convergent + net-new blockers and tightens the should-fix items.

If iter3 STILL surfaces 4+ net-new blockers, the plan needs structural rewrite (likely splitting Direction A into two phased migrations: shared-as-package first, then per-consumer rewire) — stop and flag rather than grinding to iter4.

## Recommended next step

1. Update `tasks/todo.md` v2 → v3 incorporating:
   - All 8 distinct blockers from this iteration (zod dep, paths/exports divergence, F1 scope+pattern, Docker symlink, rootDir cascade, frontend resolution, CI cache cascade, exports root entry, ensure-shared deletion sweep)
   - Convergent should-fix items (composite drop, F4 Docker-level test, Stryker probe spec, vite.config.ts alias, codemod scope)
   - Net-new should-fix items where they materially affect correctness (sweep scope, README rewrite, CI workflow audit)
2. Append `## Review iteration 2 — 2026-05-10` block summarizing changes.
3. Run iter3 — if blockers still appear at this volume, recommend structural split.
