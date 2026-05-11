# Active Task: shared/ → npm workspace package 2026-05-10

Status: drafted; awaiting user go-ahead to execute Phase A.

Goal: convert `shared/` from a directory walked into via relative paths into a real npm workspace package (`@sanctuary/shared`), so module resolution is enforced by the resolver instead of by README discipline. Unblocks Phase 5 (Stryker vitest+perTest), unifies the currently-bifurcated import convention (frontend uses `@shared/*` path-alias, server/gateway use `'../../../shared/...'`), and removes the entire class of "sandbox-creating tool can't reach shared/" failures hit twice this session.

## Re-verification (2026-05-10)

Counted via `grep -rE "from ['\"]\.\.[/\.]+/?shared/" <path>`:
- `server/src/`: **47** direct relative shared imports
- `gateway/src/`: **11**
- `tests/`: **6** (server/tests + frontend tests)
- `ai-proxy/src/`: **0** — intentionally isolated, MUST remain so
- frontend (`contexts/`, `utils/`, `src/`, `components/`, `hooks/`): uses `@shared/*` path-alias style (12 hits already), NOT the relative style — see `tsconfig.json` `paths` mapping
- `shared/` itself: 4 subdirs (`utils/` 9 files, `types/` 5 files, `schemas/` 1 file, `constants/` 1 file)

Bifurcated convention is documented in-tree at `shared/types/index.ts:5`:
*"Import from '@shared/types' (frontend) or '../../../shared/types' (server)."*

The workspace migration eliminates this fork — one import form across all packages.

## Critical constraints

- **ai-proxy stays out of the workspace** (or in workspaces but does not depend on `@sanctuary/shared`). The network-isolation boundary documented in `shared/utils/README.md` and `ai-proxy/src/utils.ts:1-7` MUST be preserved at the resolver level — converting to workspaces is the chance to enforce it structurally.
- **No mid-flight import-style flag day.** Both old (`from '../../../shared/...'`) and new (`from '@sanctuary/shared/...'`) forms must work simultaneously through Phases A+B. Fork only at Phase C when the sweep is complete.
- **CI cache invalidation is a one-shot tax.** All current `setup-server-deps` cache entries become invalid when workspaces change `node_modules` layout. Bump a cache prefix to force regeneration; expect first post-A run to be cold.
- **Docker builds touch shared/ explicitly.** `server/Dockerfile` and `gateway/Dockerfile` `COPY shared ../shared`. Workspace mode wants this differently — npm install handles symlinks IF the build context includes the workspace package. Need to verify per package.
- **Stryker is the immediate beneficiary** but every future sandbox-creating tool inherits the win. Don't optimize the migration for Stryker alone; optimize for resolver correctness.

## Plan

### Phase A — Foundation (no import changes; both styles work after) — 1 PR

Goal: enable npm workspaces and create `shared/package.json` so `@sanctuary/shared` resolves via `node_modules/@sanctuary/shared/` (symlink to `shared/`). Keep the existing `@shared/*` path alias AND keep relative imports working — pure addition.

- [ ] **A1.** Add `shared/package.json`:
  - `"name": "@sanctuary/shared"`
  - `"private": true` (never published externally)
  - `"version": "0.0.0"` (workspaces don't require semver but lockfile wants it)
  - `"type": "module"` IF the consuming TS configs are ESM-compatible (verify per-package tsconfig `module`/`moduleResolution`)
  - `"exports": { "./utils/*": "./utils/*.ts", "./types/*": "./types/*.ts", "./schemas/*": "./schemas/*.ts", "./constants/*": "./constants/*.ts" }` — explicit per-subpath, no `./*` wildcard (avoids accidentally exposing internal files)
  - No `main` (consumers always use subpath imports)
  - No `dependencies` (shared has none today; if it gains any, list them here)
- [ ] **A2.** Add `"workspaces": ["shared", "server", "gateway"]` to root `package.json`. **Explicitly omit `ai-proxy`** to preserve isolation — ai-proxy retains its standalone npm install per `ai-proxy/Dockerfile`.
- [ ] **A3.** Update root `tsconfig.json` `paths` to ALSO recognize `@sanctuary/shared/*` → `./shared/*` (keep the existing `@shared/*` alias too — both work during transition).
- [ ] **A4.** Update `server/tsconfig.json` and `gateway/tsconfig.json` `paths` to add `@sanctuary/shared/*` (they don't currently have any shared alias because they use relative paths).
- [ ] **A5.** Update `vitest.config.ts` (root), `server/vitest.config.ts`, `gateway/vitest.config.ts` to add the same alias under `resolve.alias` so vitest's transformer resolves the new form at runtime.
- [ ] **A6.** Add `@sanctuary/shared` as a dep in `server/package.json` and `gateway/package.json` using the `workspace:*` protocol.
- [ ] **A7.** Run `npm install` at root; verify `node_modules/@sanctuary/shared` is a symlink to `../../shared`. Verify each package's `node_modules/@sanctuary/shared` resolves the same way.
- [ ] **A8.** Verify CI is green: existing relative imports still work (paths unchanged), new alias also works (verified by adding ONE test import as `@sanctuary/shared/utils/errors` to confirm).
- [ ] **A9.** Bump `setup-server-deps` cache key prefix (e.g., `-v2`) so the workspace-mode `node_modules` layout doesn't collide with cached pre-workspace layouts.
- [ ] **A10.** Verify Docker builds (`./start.sh --rebuild`) for server, gateway, ai-proxy. ai-proxy must build identically (no workspace involvement).

**Verification:** local `npm install` → `npm test` (server, gateway, root) all pass. CI green. ai-proxy untouched.

**Rollback:** revert the PR. No imports changed, so reverting just disables the new alias — relative imports still work.

### Phase B — Per-package import sweeps (3 PRs, low risk each)

Goal: rewrite all relative shared imports to use `@sanctuary/shared/...`. One PR per consumer package so blast radius stays small and CI bisection is easy.

#### B1: server/src sweep (47 sites)

- [ ] **B1.1.** Mechanical rewrite via sed/codemod:
  ```
  find server/src -name '*.ts' -print0 | xargs -0 sed -i \
    -e "s|from '\\.\\./\\.\\./\\.\\./\\.\\./shared/|from '@sanctuary/shared/|g" \
    -e "s|from '\\.\\./\\.\\./\\.\\./shared/|from '@sanctuary/shared/|g" \
    -e "s|from \"\\.\\./\\.\\./\\.\\./\\.\\./shared/|from \"@sanctuary/shared/|g" \
    -e "s|from \"\\.\\./\\.\\./\\.\\./shared/|from \"@sanctuary/shared/|g"
  ```
  (Then check for any 5+-segment depth — `parseAddressDerivationPath` import in `addressDerivation/sync/...` may need a 5-deep `s|...|...|`.)
- [ ] **B1.2.** Grep verification: `grep -rE "from ['\"]\.\.[/\.]+/?shared/" server/src` returns zero hits.
- [ ] **B1.3.** `npx tsc --noEmit` in server/ passes.
- [ ] **B1.4.** `npx vitest run` in server/ passes (full test suite).
- [ ] **B1.5.** `./start.sh --rebuild` succeeds for server.

#### B2: gateway/src sweep (11 sites)

- [ ] **B2.1.** Same sed pattern, scoped to `gateway/src`.
- [ ] **B2.2-B2.5.** Grep / tsc / vitest / Docker verification, gateway-scoped.

#### B3: tests/ sweep (6 sites)

- [ ] **B3.1.** Sed pattern scoped to `tests/`, `server/tests/`, `gateway/tests/`.
- [ ] **B3.2.** Same verification (root vitest + server vitest + gateway vitest).

**Note on frontend `@shared/*` style:** Phase B does NOT touch frontend imports that already use `@shared/*`. Phase C will collapse `@shared/*` and `@sanctuary/shared/*` into one form (probably keeping `@sanctuary/shared/*` since it matches the package name).

**Verification (each B sub-PR):** CI green; no remaining relative-path imports in the swept package; tests pass.

**Rollback:** revert the PR — relative-path imports work again because Phase A kept both forms valid.

### Phase C — Drop the old paths and enforce the convention — 1 PR

Goal: remove the now-unused `@shared/*` alias and the path-mapping fallback that kept relative paths working. Add an ESLint rule + CI gate so the convention sticks.

- [ ] **C1.** Sweep frontend imports: `@shared/*` → `@sanctuary/shared/*` (12 sites).
- [ ] **C2.** Remove `@shared/*` from root `tsconfig.json` `paths`.
- [ ] **C3.** Add an ESLint `no-restricted-imports` rule to `eslint.config.js`:
  ```js
  {
    selector: "ImportDeclaration[source.value=/^\\.\\.\\/(\\.\\.\\/)+shared\\//]",
    message: "Import shared/ via the workspace package: from '@sanctuary/shared/...'."
  }
  ```
  Scope: all production source paths (not ai-proxy).
- [ ] **C4.** Update `scripts/ci/check-provider-leaks.sh` (or create a sibling check) to enforce zero `'../../shared/...'` references in production source. Alternative: lean on the ESLint rule alone if its CI lane is required-checks.
- [ ] **C5.** Update `shared/types/index.ts:5` doc comment from "Import from '@shared/types' (frontend) or '../../../shared/types' (server)" → "Import from `@sanctuary/shared/types`."
- [ ] **C6.** Update `shared/utils/README.md` "Convention" section — claim is now ENFORCED, not aspirational.
- [ ] **C7.** Update `CONTRIBUTING.md` to reference the workspace style as the single way.

**Verification:** ESLint catches a deliberately-introduced `'../../../shared/...'` import (smoke test). All workflows still green.

### Phase D — Phase 5 redo: Stryker vitest+perTest — 1 PR

Goal: with `shared/` resolved via `node_modules/@sanctuary/shared/` (which Stryker copies into the sandbox), the cross-package resolution failure that closed #395 and #397 disappears. Phase 5's promise (5-20× per-mutant speedup) is finally realizable.

- [ ] **D1.** Switch `server/stryker.critical.config.mjs`:
  - `testRunner: 'vitest'` (was `'command'`)
  - `vitest: { configFile: 'vitest.config.ts' }`
  - `coverageAnalysis: 'perTest'` (was `'off'`)
  - Remove `CRITICAL_TEST_COMMAND` and the sandbox-symlink helpers (`ENSURE_SANDBOX_RUNTIME_LINKS`, `shellQuote`, `fs`/`path` imports). They're no longer needed.
  - Keep `mutate`, shard support, thresholds, concurrency, timeout untouched.
- [ ] **D2.** Verify locally: `MUTATION_SHARD=1 npm run test:mutation:critical:shard` from server/. Should reach actual mutation work (not crash at dry-run as in #395 + #397).
- [ ] **D3.** CI verification: all 3 quick + 3 full mutation shards complete; aggregator merges; gate passes.
- [ ] **D4.** Update mutation baseline if the perTest analysis exposes a coverage gap (it shouldn't — perTest selects MORE precisely, not less). If baseline drift is real, decide whether to update or restore command runner.
- [ ] **D5.** Append a "2026-XX-XX — Phase 5 unlocked" section to `reports/ci-optimization-survey-2026-05-10.md` documenting the actual measured wallclock impact.

**Verification:** mutation gate passes on a PR that touches a critical mutated file. Wallclock measured before/after.

**Rollback:** revert this PR to restore command runner. Phase A-C still stand on their own.

### Phase E — Cleanup + documentation — 1 PR (optional, can fold into D)

- [ ] **E1.** Delete `tools/ci-log-sink/` and the publishing wiring IF the LAN sink is no longer needed. (It's still useful as long as Forgejo's logs API is missing — independent decision; orthogonal to this plan.)
- [ ] **E2.** Update `tasks/lessons.md` with one entry: "shared/ workspace migration unblocked sandbox-creating tools."
- [ ] **E3.** Verify the entire 4-phase chain via a synthetic PR that touches a shared util; confirm vitest, Stryker, Docker, Docusaurus all pick it up correctly.

## Per-tool resolution check (Phase A acceptance)

These are the tools that need to RESOLVE `@sanctuary/shared/...` correctly after Phase A. Verify each:

| Tool | Where it resolves | Verification |
| --- | --- | --- |
| `tsc` | tsconfig `paths` + node_modules | `npx tsc --noEmit` clean per package |
| `vitest` (test runner) | vitest config `resolve.alias` + node_modules | `npx vitest run` green per package |
| `vitest` (coverage shard) | inherits from base config | `npx vitest run --coverage --config vitest.coverage-shard.config.ts` green |
| esbuild (vitest transformer) | node_modules resolution | implicit via vitest |
| Stryker `command` runner | node_modules in sandbox | broad config dry-run on one mutant |
| Stryker `vitest` runner | node_modules in sandbox (Phase D) | covered by Phase D |
| AppMap | Node.js native resolution | record one test, confirm trace includes shared functions |
| Docusaurus | source filesystem (not node_modules) | `npm run docs:build` green |
| Docker (server) | npm install during build | `./start.sh --rebuild server` green |
| Docker (gateway) | same | `./start.sh --rebuild gateway` green |
| Docker (ai-proxy) | NO shared resolution (isolated) | build identical to pre-Phase-A |
| Prisma | runs from server/, no shared use | unaffected |

## Risks ranked by likelihood × blast radius

1. **Docker `COPY shared` becomes redundant or breaks.** Currently each package's Dockerfile copies `shared/`. With workspaces, npm install handles it via the symlink IF the build context allows. Need to verify per package; mitigation is to test Docker builds in Phase A and adjust Dockerfile if needed.
2. **vitest's transformer doesn't honor `resolve.alias` in some edge case.** Most likely under `--coverage` mode where it forks workers. Mitigation: add the alias to BOTH the base config and the coverage-shard config; verify with a smoke test in Phase A.
3. **`exports` field too restrictive.** If we miss a subpath, imports break. Mitigation: explicit per-subpath exports listed in A1, plus a smoke test that imports one item from each subpath.
4. **ai-proxy accidentally picks up `@sanctuary/shared`.** Would silently violate the isolation boundary. Mitigation: ai-proxy is NOT in `workspaces`, so npm install won't put `@sanctuary/shared` in `ai-proxy/node_modules`. Verify by `ls ai-proxy/node_modules/@sanctuary` (should not exist).
5. **In-flight branches conflict.** Mitigation: communicate before merging Phase A; rebase mid-flight branches over Phase A first to keep them moving.
6. **CI cache invalidation flake.** First post-A run is cold; cache rebuilds. Mitigation: bumping the cache prefix is one-shot pain.

## Time estimate

- Phase A: 0.5-1 day (most work is verification across N tools)
- Phase B: 0.5 day total (mostly mechanical sed + verification per package)
- Phase C: 0.5 day (sweep + ESLint rule + doc updates)
- Phase D: 0.25 day if Phase A-C did the resolver work correctly; longer if Stryker's vitest runner has a second-order issue
- Phase E: 0.25 day

Total: 2-3 days of focused work, spread over ~5 PRs.

## Out of scope

- **Migrating ai-proxy into the workspace.** It's intentionally isolated; converting it would break the network-isolation boundary doc'd in `shared/utils/README.md`.
- **Publishing `@sanctuary/shared` to a registry.** Marked `"private": true`; no external consumers in scope.
- **Migrating to pnpm or bun.** npm workspaces is the foundation; later migration to pnpm becomes a one-line change in CI but is its own PR.
- **Refactoring shared/ internal layout.** Same files, same locations, same exports — only the import shape on the consumer side changes.

## Review

- Pending implementation.

---
