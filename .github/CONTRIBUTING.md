---
slug: /CONTRIBUTING
---

# Contributing to Sanctuary

## Quick start

```bash
./start.sh              # Start all services (Docker-only; never run npm dev on the host)
./start.sh --rebuild    # Rebuild containers after code changes
./start.sh --stop       # Stop all services
```

Read [`server/ARCHITECTURE.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/server/ARCHITECTURE.md) before recommending architectural changes. The pattern you need likely already exists.

## Development workflow

### Prerequisites

- Docker and Docker Compose
- Node.js (see `.nvmrc`)
- npm

### Running locally

All services run inside Docker. Never use `npm run dev`, `npm run preview`, `npm run start`, or `npx vite` on the host. Use `./start.sh` exclusively.

Never use inline environment variables with `docker compose`. Runtime secrets live outside the repository; see [`docs/how-to/runtime-secrets.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/how-to/runtime-secrets.md).

### Before committing

Run the full local validation. Do not rely on CI to catch failures.

```bash
# Backend
cd server && npx tsc --noEmit && npx vitest run

# Frontend
cd .. && npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run

# LLM egress proxy
npm --prefix llm-egress-proxy run build
npm --prefix llm-egress-proxy run test
```

When targeting coverage thresholds, run coverage locally:

```bash
cd server && npm run test:unit -- --coverage # backend unit scope: 100% on all metrics
npm run test:coverage                       # frontend: 100% on all metrics
npm --prefix gateway run test:coverage      # gateway: 100%, except functions at 98%
npm --prefix llm-egress-proxy run test:coverage # proxy ratchet: B69/F90/L81/S78
```

Run `git commit` in the foreground; pre-commit hooks run validation whose feedback must be reviewed.

### Investigating runtime call paths (AppMap)

Static diagrams in [`docs/architecture/`](https://github.com/nekoguntai-castle/sanctuary/tree/main/docs/architecture) and the dependency-cruiser graphs they reference cannot see HTTP/WebSocket calls between services — they only know about imports. When you need to understand what *actually* runs end-to-end (e.g. "which path did this notification take?"), record an AppMap of the failing test:

```bash
cd server
npx --yes appmap-node npx vitest run path/to/the.test.ts
```

The recording lands in `tmp/appmap/` (gitignored). Open the file in the AppMap VS Code extension to see the full call tree, including HTTP exits to Redis, the gateway, and external APIs. Recordings are debugging aids — never commit them.

### Self-review checklist

Before committing multi-file changes, verify:

- [ ] Correct API calls and field names
- [ ] No TypeScript errors (`npm run typecheck:app`, `npm run typecheck:tests`, and `npm run typecheck:all` for the frontend workspace; package-local typechecks elsewhere)
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

The dark mode theme uses inverted color scales for `primary`, `warning`, `success`, `sent`, and `shared` palettes. In dark mode, low numbers (50-200) are dark and high numbers (800-950) are light -- the opposite of standard Tailwind. `sanctuary-*`, `emerald-*`, and `rose-*` follow standard Tailwind conventions. See [`docs/reference/frontend-architecture.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/reference/frontend-architecture.md) for full details.

Small font sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`) are intentional for the compact UI. Do not replace them with named Tailwind sizes.

## CI/CD

### Fixing CI failures

- Grep the entire codebase for the failure pattern before fixing
- Batch all instances of the same pattern into one commit
- Do not fix one file at a time and re-push
- Run local validation before pushing the fix

Coverage threshold failures are the most common CI blocker. Run coverage locally first.

### Diagnosing CI failures

Long-running steps wrap their command with `scripts/ci/run-with-log.sh` and follow up with `scripts/ci/write-diagnostic-summary.sh`. When such a step fails, four diagnostic surfaces are available — check them in this order:

- **Inline log dump (fastest).** The summary helper echoes the tail (≤256 KiB) of every failed log to the runner's step output inside `::group::` blocks, so the actual crash is visible directly on the failed run page. Look for `Failed log tail (...)` groups in the diagnostic-summary step.
- **Step-summary metadata table.** The job's summary panel lists each captured log with its `wrapped_exit`, `sink_status`, `truncated`, and byte size — useful for spotting which step failed when several ran in the same job.
- **Diagnostic artifact (full bytes).** Each lane uploads `ci-diagnostics-<lane>` containing the redacted log files (capped at `SANCTUARY_CI_LOG_CAP_BYTES`, default 32 MiB) plus their `*.status.json` sidecars and a `diagnostic-index.md`. Use this when the 256 KiB inline tail isn't enough or when you need to grep across multiple captured logs. The Forgejo Actions API for downloading artifacts is unreliable on the current runner version — download via the workflow run page in the web UI.
- **Native Forgejo job log.** Forgejo 16 exposes the complete job log through its Actions API, so authenticated tools can fetch it without a browser session. Resolve `<job_id>` from `GET /api/v1/repos/<owner>/<repo>/actions/runs/<run_id>/jobs` or the workflow run page, then keep the token out of process arguments with a restricted curl header file:

  ```bash
  auth_header="$(mktemp)"
  chmod 600 "$auth_header"
  trap 'rm -f "$auth_header"' EXIT
  printf 'Authorization: token %s\n' "$FORGEJO_TOKEN" > "$auth_header"
  curl -fsS -H "@$auth_header" \
    "$FORGEJO_URL/api/v1/repos/<owner>/<repo>/actions/jobs/<job_id>/logs"
  ```

When adding a new long-running CI step, follow the same pattern: wrap with `run-with-log.sh "$DIAGNOSTIC_DIR/<step>.log"` for capture, call `write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "<Lane Name>"` in an `if: always()` step, and upload `$DIAGNOSTIC_DIR` as `ci-diagnostics-<lane>` on failure with `if-no-files-found: ignore`. Keep compact reports that are required evidence separate from verbose troubleshooting artifacts so successful runs retain the former without paying to publish the latter.

### Retrigger discipline

CI flake on this repo is dominated by host-side runner / DIND issues, not test bugs (audit 2026-05-10: 9/9 recent retriggers were runner/substrate, 0 were vitest). Bare retriggers absorb engineering oxygen and risk masking real regressions.

Before pushing a `chore: retrigger CI` commit, the commit MUST do at least one of:

1. **Include a stability fix in the same commit** — a workflow tweak, a runner-config nudge, a `continue-on-error` matrix change, or a `test.retry()` for a genuinely flaky vitest case.
2. **Reference a tracking issue in the commit body** — name the failing job, paste a short error fragment, link the issue.

Bare `chore: retrigger CI` with no body is no longer acceptable. Diagnostic artifacts from `scripts/ci/write-diagnostic-summary.sh` are uploaded on every failed lane — consult them before assuming flake.

### Version management

Versions must stay synchronized across `package.json`, `server/package.json`, `gateway/package.json`, and `llm-egress-proxy/package.json`. Use `./scripts/bump-version.sh` to bump all at once. After green Forgejo tag CI, the trusted operator release command verifies tag parity and creates matching Forgejo/GitHub Release objects.

Never bump the version to fix a CI failure. Fix on the current version.

### Release process

1. Bump version: `./scripts/bump-version.sh patch|minor|major`
2. Local validation (must be fully green)
3. Commit, tag RC: `git tag vX.Y.Z-rc.1`, push
4. Monitor CI: `gh run list --limit 5`; fix failures, re-tag
5. Cut release: `git tag vX.Y.Z`, push

See [`.claude/commands/release.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/.claude/commands/release.md) for the full automated release flow.

## Documentation

### Standards

- **File naming:** kebab-case except recognized community files under `.github/` and per-package `README.md`/`ARCHITECTURE.md`.
- **Diagrams:** Mermaid only (GitHub renders natively).
- **Links:** repo-root-relative for cross-package, package-relative within a package.
- **Frontmatter:** only when a published document needs a stable route contract.

See [`docs/README.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/README.md) for the full docs index and per-doc-type section requirements.

### Lifecycle rules

1. **Write** a doc when a PR introduces a new subsystem, changes a public API, or makes an architectural decision.
2. **Update** architecture docs alongside the code change that invalidates them. Every release PR updates [`docs/reference/changelog.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/reference/changelog.md).
3. **Archive** (move to `docs/archive/`) when a system is superseded but history has value.
4. **Delete** CI run proofs and PR-scoped test artifacts when the PR merges. Auto-generated phase2-\*/phase3-\* proof files are PR artifacts, not repository documents. Do not commit them to `docs/plans/`.

### Architecture Decision Records

For decisions with non-obvious tradeoffs, create an ADR in `docs/adr/` using the next available number. Follow the existing template: Title, Date, Status, Context, Decision, Consequences, Supersedes.

### Living docs (Docusaurus)

The curated docs under [`docs/architecture/`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/architecture/README.md), selected [`docs/explanation/`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/explanation/address-derivation.md), [`docs/how-to/`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/how-to/agent-wallet-funding.md), [`docs/reference/`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/reference/ci-cd-strategy.md), [`docs/adr/`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/adr/0001-browser-auth-token-storage.md), selected per-service `ARCHITECTURE.md` files, [`docs/PRD.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/PRD.md), [`docs/README.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/README.md), and this `.github/CONTRIBUTING.md` form the Docusaurus documentation set. Planning, idea, archive, package README/API, and release-history docs remain repository documents. [`workflows/architecture.yml`](https://github.com/nekoguntai-castle/sanctuary/blob/main/.github/workflows/architecture.yml) validates the source markdown and proves the Docusaurus production build on Forgejo; it does not deploy the result.

Local commands:

```bash
npm run docs:start    # dev server with hot reload from docs/site
npm run docs:build    # production build to docs/site/build
```

### Keeping architecture docs in sync

`npm run arch:check` runs three drift checks; CI runs the same chain on every PR.

| Script | What it produces | What stale-fails CI |
|---|---|---|
| `npm run arch:graphs` | Module dependency graphs per package (`docs/architecture/generated/{frontend,server,gateway}.md`) using `dependency-cruiser`. | Module added/moved/deleted without committing the regenerated graph. |
| `npm run arch:calls` | Function-level call graphs for opt-in subsystems listed in [`docs/architecture/calls.config.json`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/architecture/calls.config.json) (`docs/architecture/generated/calls/<name>.md`). Surfaces new entry points to existing pipelines — the bug class that motivated this whole system. | New function/method added or removed inside a tracked subsystem without committing the regenerated call graph. |
| `npm run arch:lint` | Validates every `click NodeId href "path"` (and `path#symbol`) directive in any Mermaid block. Hrefs may use `#symbol` to pin to a specific exported function/class/method/const; the symbol is cross-checked against the source file with the TypeScript compiler API. | Source file referenced by a click href is renamed or deleted; or a pinned symbol is renamed/removed. |
| `node scripts/architecture/detect-drift.mjs` (CI only, warn-only) | Compares the PR's changed files against the file→diagram reference index. If a diagram references a touched file but the diagram itself wasn't modified, emits a `::warning::` and a job-summary entry. | Never — warn-only; reviewer decides if the diagram needs an update. |

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

Diagrams live in [`docs/architecture/`](https://github.com/nekoguntai-castle/sanctuary/tree/main/docs/architecture) and follow the [C4 model](https://c4model.com/) (Context → Container → Component). All diagrams are Mermaid so GitHub renders them inline *and* Docusaurus renders them in the site with svg-pan-zoom for drill-down. Click handlers (`click NodeId href "..."`) navigate to docs or source; the Docusaurus build keeps doc-to-doc clicks inside the site and rewrites source-code clicks to absolute GitHub URLs via [`docs/site/src/plugins/remark-mermaid-click-rewrite.mjs`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/site/src/plugins/remark-mermaid-click-rewrite.mjs), so the same source works in both renderings.

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
  src/                      # React/Vite frontend (components, hooks, themes)
  llm-egress-proxy/         # LLM egress proxy service
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
