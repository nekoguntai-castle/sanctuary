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
