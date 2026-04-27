# Sanctuary Documentation

Navigation index for the curated documentation published to the Docusaurus site. The structure follows the [Diátaxis](https://diataxis.fr/) framework (explanation, how-to, reference) with architecture and ADR sections alongside. Planning, idea, archive, package README/API, and release-history docs remain repository documents and are linked to GitHub from here when useful.

If you're new here, start with the root [`README.md`](https://github.com/nekoguntai-castle/sanctuary/blob/main/README.md) for what Sanctuary is, then [`CONTRIBUTING.md`](../CONTRIBUTING.md) for how to contribute.

## Product

- [PRD](PRD.md) — product requirements and scope

## Explanation

Conceptual docs: *why* things work the way they do.

- [Address derivation](explanation/address-derivation.md) — Bitcoin address derivation implementation
- [Advanced features](explanation/advanced-features.md) — RBF, CPFP, Payjoin, and other advanced transaction features
- [Extension points](explanation/extension-points.md) — navigation and service extension surfaces, ownership map
- [Historical prices](explanation/historical-prices.md) — historical price data fetching
- [Scalability and performance](explanation/scalability-and-performance.md) — scale limits and performance tuning
- [State machines](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/explanation/state-machines.md) — auth, wallet sync, drafts, and notification state machines
- [Transaction broadcasting](explanation/transaction-broadcasting.md) — broadcast flow and logic

## How-to

Procedural guides for operators and developers.

- [Operations runbooks](how-to/operations-runbooks.md) — triage, monitoring, alert handling
- [Agent wallet funding](how-to/agent-wallet-funding.md) — operate agent-funded multisig drafts with human review
- [AI Settings, Sanctuary Console, and MCP access](how-to/ai-mcp-console.md) — configure trusted model providers, use the Console, and manage external MCP keys
- [MCP server](how-to/mcp-server.md) — direct read-only MCP endpoint setup for loopback and advanced LAN clients
- [Runtime secrets](how-to/runtime-secrets.md) — runtime secret management

## Reference

Lookup tables, checklists, and specs.

- [CI/CD strategy](reference/ci-cd-strategy.md) — branch protection, merge queue, and path-aware validation
- [Frontend architecture](reference/frontend-architecture.md) — React/Vite architecture and frontend packaging
- [Hardware wallet integration](reference/hardware-wallet-integration.md) — hardware wallet feature specification
- [Release gates](reference/release-gates.md) — release criteria and verification checklist
- [Upgrade PostgreSQL auth drift findings](reference/upgrade-postgres-auth-drift-findings.md) — incident notes, reliable checks, and manual recovery

## Architecture Decision Records

Numbered, dated decisions with cross-links to source. New ADRs use the next available number.

- [ADR 0001: Browser auth token storage](adr/0001-browser-auth-token-storage.md) — HttpOnly cookie migration (Accepted)
- [ADR 0002: Frontend refresh flow](adr/0002-frontend-refresh-flow.md) — token refresh flow (Accepted)

## Repository-only plans

Active strategic plans are planning artifacts, not reference material, so the Docusaurus site links to them on GitHub instead of publishing them as local pages. Plans that fail to execute move to `archive/`.

- [Architecture-first quality improvement plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/architecture-first-quality-improvement-plan.md)
- [Agent wallet funding release notes](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/agent-wallet-funding-release-notes.md)
- [Codebase health assessment](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/codebase-health-assessment.md)
- [Dependency audit triage](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/dependency-audit-triage.md)
- [Extensibility architecture plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/extensibility-architecture-plan.md)
- [File modularization plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/file-modularization-plan.md)
- [AI/MCP/Console release proof](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/ai-mcp-console-release-proof.md)
- [MCP server release readiness audit](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/mcp-server-release-readiness-audit.md)
- [MCP dual-path implementation plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/mcp-dual-path-implementation-plan.md)
- [Reliability hardening plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/reliability-hardening-plan.md)
- [Technical debt plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/technical-debt-plan.md)
- [Test gaps plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/test-gaps-plan.md)
- [Vault policies plan](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/vault-policies-plan.md)
- [v0.8.10 announcement](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/v0.8.10-announcement.md)
- [v0.8.11 scope](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/plans/v0.8.11-scope.md)

## Repository-only ideas

Exploratory sketches for features under consideration are linked to GitHub.

- [Inheritance protocol](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/ideas/inheritance-protocol.md)
- [Treasury intelligence](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/ideas/treasury-intelligence.md)

## Archive

Superseded docs are kept for historical context in [`docs/archive/`](https://github.com/nekoguntai-castle/sanctuary/tree/main/docs/archive). Do not edit archived docs; if something there is still relevant, promote it back out of the archive and update it.

## Per-package documentation

Package-scoped docs live next to their code — not in `docs/`. Start at each package README:

- [server](https://github.com/nekoguntai-castle/sanctuary/blob/main/server/README.md) — backend API server ([architecture](../server/ARCHITECTURE.md), [API](https://github.com/nekoguntai-castle/sanctuary/blob/main/server/API.md))
- [gateway](https://github.com/nekoguntai-castle/sanctuary/blob/main/gateway/README.md) — mobile API gateway ([architecture](../gateway/ARCHITECTURE.md))
- React/Vite frontend — lives at the monorepo root (no subdirectory). See [`docs/reference/frontend-architecture.md`](reference/frontend-architecture.md).
- [ai-proxy](https://github.com/nekoguntai-castle/sanctuary/blob/main/ai-proxy/README.md) — AI proxy service ([architecture](../ai-proxy/ARCHITECTURE.md))
- [`nekoguntai-castle/sanctuary-umbrel`](https://github.com/nekoguntai-castle/sanctuary-umbrel) — Umbrel community app store (separate repo; auto-updates from this repo's release pipeline)
- [themes](https://github.com/nekoguntai-castle/sanctuary/blob/main/themes/README.md) — theme system reference

## Documentation standards

- **File naming:** kebab-case except canonical root files (`README.md`, `CLAUDE.md`, `DOCKER.md`, `CONTRIBUTING.md`, `CHANGELOG.md`) and per-package `README.md`/`ARCHITECTURE.md`.
- **Link style:** repo-root-relative for cross-package links, package-relative within a package.
- **Diagrams:** Mermaid only (rendered natively by GitHub).
- **Frontmatter:** none. ADRs use structured headings for metadata.
- **CI proof artifacts:** deleted on PR merge, not committed. See `CONTRIBUTING.md` for the lifecycle rule.
