# Contributing to Sanctuary

## Quick start

```bash
./start.sh              # Start all services (Docker-only; never run npm dev on the host)
./start.sh --rebuild    # Rebuild containers after code changes
./start.sh --stop       # Stop all services
```

Read [`server/ARCHITECTURE.md`](server/ARCHITECTURE.md) before recommending architectural changes. The pattern you need likely already exists.

## Development workflow

### Prerequisites

- Docker and Docker Compose
- Node.js (see `.nvmrc`)
- npm

### Running locally

All services run inside Docker. Never use `npm run dev`, `npm run preview`, `npm run start`, or `npx vite` on the host. Use `./start.sh` exclusively.

Never use inline environment variables with `docker compose`. Runtime secrets live outside the repository; see [`docs/how-to/runtime-secrets.md`](docs/how-to/runtime-secrets.md).

### Before committing

Run the full local validation. Do not rely on CI to catch failures.

```bash
# Backend
cd server && npx tsc --noEmit && npx vitest run

# Frontend
cd .. && npx tsc --noEmit && npx vitest run
```

When targeting coverage thresholds, run coverage locally:

```bash
cd server && npx vitest run --coverage  # backend: 99% threshold
npx vitest run --coverage               # frontend: 100% threshold
```

Run `git commit` in the foreground; pre-commit hooks run validation whose feedback must be reviewed.

### Investigating runtime call paths (AppMap)

Static diagrams in [`docs/architecture/`](docs/architecture/) and the dependency-cruiser graphs they reference cannot see HTTP/WebSocket calls between services — they only know about imports. When you need to understand what *actually* runs end-to-end (e.g. "which path did this notification take?"), record an AppMap of the failing test:

```bash
cd server
npx --yes appmap-node npx vitest run path/to/the.test.ts
```

The recording lands in `tmp/appmap/` (gitignored). Open the file in the AppMap VS Code extension to see the full call tree, including HTTP exits to Redis, the gateway, and external APIs. Recordings are debugging aids — never commit them.

### Self-review checklist

Before committing multi-file changes, verify:

- [ ] Correct API calls and field names
- [ ] No TypeScript errors (`npx tsc --noEmit` in affected packages)
- [ ] Test expectations match the actual behavior
- [ ] No CI proof artifacts (phase2-\*/phase3-\* files) in `docs/plans/`

## Coding standards

### TypeScript rules

- **Never** `catch (error: any)` -- use `catch (error)` + `getErrorMessage()` from `utils/errors`
- **Never** raw `JSON.parse` for settings/user data -- use `safeJsonParse()` from `utils/safeJson`
- **Never** `console.log` -- use `createLogger()` from `utils/logger`
- **Never** empty catch blocks -- at minimum `log.debug()`
- **Never** `@ts-ignore` -- use `@ts-expect-error` with explanation if needed
- Use `isPrismaError()` from `utils/errors` for Prisma error handling
- Never use Prisma directly in routes or services; use the repository layer

### Bug fixes

Write a non-regression test first, then fix the bug.

### Theme system

The dark mode theme uses inverted color scales for `primary`, `warning`, `success`, `sent`, and `shared` palettes. In dark mode, low numbers (50-200) are dark and high numbers (800-950) are light -- the opposite of standard Tailwind. `sanctuary-*`, `emerald-*`, and `rose-*` follow standard Tailwind conventions. See [`docs/reference/frontend-architecture.md`](docs/reference/frontend-architecture.md) for full details.

Small font sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`) are intentional for the compact UI. Do not replace them with named Tailwind sizes.

## CI/CD

### Fixing CI failures

- Grep the entire codebase for the failure pattern before fixing
- Batch all instances of the same pattern into one commit
- Do not fix one file at a time and re-push
- Run local validation before pushing the fix

Coverage threshold failures are the most common CI blocker. Run coverage locally first.

### Version management

Versions must stay synchronized across `package.json`, `server/package.json`, `gateway/package.json`, and `ai-proxy/package.json`. Use `./scripts/bump-version.sh` to bump all at once. (The Umbrel manifest in [`nekoguntai-castle/sanctuary-umbrel`](https://github.com/nekoguntai-castle/sanctuary-umbrel) updates itself via `repository_dispatch` from this repo's release workflow.)

Never bump the version to fix a CI failure. Fix on the current version.

### Release process

1. Bump version: `./scripts/bump-version.sh patch|minor|major`
2. Local validation (must be fully green)
3. Commit, tag RC: `git tag vX.Y.Z-rc.1`, push
4. Monitor CI: `gh run list --limit 5`; fix failures, re-tag
5. Cut release: `git tag vX.Y.Z`, push

See [`.claude/commands/release.md`](.claude/commands/release.md) for the full automated release flow.

## Documentation

### Standards

- **File naming:** kebab-case for all docs except the canonical root set (`README.md`, `CLAUDE.md`, `DOCKER.md`, `CONTRIBUTING.md`, `CHANGELOG.md`) and per-package `README.md`/`ARCHITECTURE.md`.
- **Diagrams:** Mermaid only (GitHub renders natively).
- **Links:** repo-root-relative for cross-package, package-relative within a package.
- **Frontmatter:** none.

See [`docs/README.md`](docs/README.md) for the full docs index and per-doc-type section requirements.

### Lifecycle rules

1. **Write** a doc when a PR introduces a new subsystem, changes a public API, or makes an architectural decision.
2. **Update** architecture docs alongside the code change that invalidates them. Every release PR updates [`CHANGELOG.md`](CHANGELOG.md).
3. **Archive** (move to `docs/archive/`) when a system is superseded but history has value.
4. **Delete** CI run proofs and PR-scoped test artifacts when the PR merges. Auto-generated phase2-\*/phase3-\* proof files are PR artifacts, not repository documents. Do not commit them to `docs/plans/`.

### Architecture Decision Records

For decisions with non-obvious tradeoffs, create an ADR in `docs/adr/` using the next available number. Follow the existing template: Title, Date, Status, Context, Decision, Consequences, Supersedes.

### Living docs site (Docusaurus)

All markdown under [`docs/`](docs/), the per-package `ARCHITECTURE.md` files, and this `CONTRIBUTING.md` are rendered as a unified [Docusaurus](https://docusaurus.io/) site at <https://nekoguntai-castle.github.io/sanctuary/>. The site is built from source markdown — there is no second source of truth — and deployed to GitHub Pages by [`.github/workflows/architecture.yml`](.github/workflows/architecture.yml) on every merge to `main`.

Local commands:

```bash
npm run docs:start    # dev server with hot reload (cd website && npm start)
npm run docs:build    # production build to website/build
```

### Keeping architecture docs in sync

`npm run arch:check` runs three drift checks; CI runs the same chain on every PR.

| Script | What it produces | What stale-fails CI |
|---|---|---|
| `npm run arch:graphs` | Module dependency graphs per package (`docs/architecture/generated/{frontend,server,gateway}.md`) using `dependency-cruiser`. | Module added/moved/deleted without committing the regenerated graph. |
| `npm run arch:calls` | Function-level call graphs for opt-in subsystems listed in [`docs/architecture/calls.config.json`](docs/architecture/calls.config.json) (`docs/architecture/generated/calls/<name>.md`). Surfaces new entry points to existing pipelines — the bug class that motivated this whole system. | New function/method added or removed inside a tracked subsystem without committing the regenerated call graph. |
| `npm run arch:lint` | Validates every `click NodeId href "path"` directive in any Mermaid block points at an existing file. | Source file referenced by a click href is renamed or deleted. |

To track a new subsystem at function granularity, add an entry to `docs/architecture/calls.config.json`:

```json
{
  "name": "wallet-sync",
  "title": "Wallet Sync",
  "description": "Wallet synchronization pipeline.",
  "include": ["server/src/services/bitcoin/sync/**/*.ts"]
}
```

Run `npm run arch:calls` and commit the new `docs/architecture/generated/calls/<name>.md`.

### Architecture diagrams

Diagrams live in [`docs/architecture/`](docs/architecture/) and follow the [C4 model](https://c4model.com/) (Context → Container → Component). All diagrams are Mermaid so GitHub renders them inline *and* Docusaurus renders them in the site with svg-pan-zoom for drill-down. Click handlers (`click NodeId href "..."`) navigate to source — relative hrefs are rewritten to absolute GitHub URLs at Docusaurus build time by [`website/src/plugins/remark-mermaid-click-rewrite.mjs`](website/src/plugins/remark-mermaid-click-rewrite.mjs), so the same source works in both renderings.

When you add or change an entry point that crosses a service boundary (e.g. a new caller of `notificationDispatcher`, a new gateway route, a new external integration):

1. Update the relevant C4 diagram in `docs/architecture/` in the same PR.
2. Run `npm run arch:graphs` to regenerate the auto-derived dependency-cruiser graphs in `docs/architecture/generated/`. CI fails the PR if the committed `.md` files are stale.
3. Run `npm run arch:lint` (or `npm run arch:check` to do everything) — verifies every Mermaid `click NodeId href "..."` resolves to an existing file.

`scripts/check-architecture-boundaries.mjs` enforces forbidden imports (e.g. browser code may not import server internals); the diagrams visualize what the linter does not enforce.

## Project structure

```
sanctuary/                  # monorepo root
  server/                   # Node.js/Express backend (API, business logic, Bitcoin)
  gateway/                  # Mobile API gateway (rate limiting, push notifications)
  components/, hooks/, src/ # React/Vite frontend (lives at root of monorepo)
  ai-proxy/                 # AI proxy service
  themes/                   # Theme definitions
  docs/                     # Project documentation (Diataxis framework)
    explanation/            # Conceptual: why things work this way
    how-to/                 # Procedural: step-by-step guides
    reference/              # Lookup: specs, checklists
    adr/                    # Architecture decision records
    plans/                  # Strategic plans (no CI proofs)
    archive/                # Superseded docs
    ideas/                  # Future feature sketches
  scripts/                  # Build, release, quality tooling
  tasks/                    # Ephemeral AI workspace (not product docs)
```
