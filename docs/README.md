# Sanctuary Documentation

Navigation index for the `docs/` tree. The structure follows the [Diátaxis](https://diataxis.fr/) framework (explanation, how-to, reference) with project-specific buckets (adr, plans, ideas, archive) alongside.

If you're new here, start with the root [`README.md`](../README.md) for what Sanctuary is, then [`CONTRIBUTING.md`](../CONTRIBUTING.md) for how to contribute.

## Product

- [PRD](PRD.md) — product requirements and scope

## Explanation

Conceptual docs: *why* things work the way they do.

- [Address derivation](explanation/address-derivation.md) — Bitcoin address derivation implementation
- [Advanced features](explanation/advanced-features.md) — RBF, CPFP, Payjoin, and other advanced transaction features
- [Extension points](explanation/extension-points.md) — navigation and service extension surfaces, ownership map
- [Historical prices](explanation/historical-prices.md) — historical price data fetching
- [Scalability and performance](explanation/scalability-and-performance.md) — scale limits and performance tuning
- [State machines](explanation/state-machines.md) — auth, wallet sync, drafts, and notification state machines
- [Transaction broadcasting](explanation/transaction-broadcasting.md) — broadcast flow and logic

## How-to

Procedural guides for operators and developers.

- [Operations runbooks](how-to/operations-runbooks.md) — triage, monitoring, alert handling
- [Agent wallet funding](how-to/agent-wallet-funding.md) — operate agent-funded multisig drafts with human review
- [Runtime secrets](how-to/runtime-secrets.md) — runtime secret management

## Reference

Lookup tables, checklists, and specs.

- [Hardware wallet integration](reference/hardware-wallet-integration.md) — hardware wallet feature specification
- [Release gates](reference/release-gates.md) — release criteria and verification checklist
- [Upgrade PostgreSQL auth drift findings](reference/upgrade-postgres-auth-drift-findings.md) — incident notes, reliable checks, and manual recovery

## Architecture Decision Records

Numbered, dated decisions with cross-links to source. New ADRs use the next available number.

- [ADR 0001: Browser auth token storage](adr/0001-browser-auth-token-storage.md) — HttpOnly cookie migration (Accepted)
- [ADR 0002: Frontend refresh flow](adr/0002-frontend-refresh-flow.md) — token refresh flow (Accepted)

## Plans

Active strategic plans. Planning artifacts, not reference material. Plans that fail to execute move to `archive/`.

- [Architecture-first quality improvement plan](plans/architecture-first-quality-improvement-plan.md)
- [Agent wallet funding release notes](plans/agent-wallet-funding-release-notes.md)
- [Codebase health assessment](plans/codebase-health-assessment.md)
- [Dependency audit triage](plans/dependency-audit-triage.md)
- [Extensibility architecture plan](plans/extensibility-architecture-plan.md)
- [File modularization plan](plans/file-modularization-plan.md)
- [Reliability hardening plan](plans/reliability-hardening-plan.md)
- [Technical debt plan](plans/technical-debt-plan.md)
- [Test gaps plan](plans/test-gaps-plan.md)
- [Vault policies plan](plans/vault-policies-plan.md)
- [v0.8.10 announcement](plans/v0.8.10-announcement.md)
- [v0.8.11 scope](plans/v0.8.11-scope.md)

## Ideas

Exploratory sketches for features under consideration.

- [Inheritance protocol](ideas/inheritance-protocol.md)
- [Treasury intelligence](ideas/treasury-intelligence.md)

## Archive

Superseded docs kept for historical context. Do not edit; if something here is still relevant, promote it back out of the archive and update it. See [`archive/`](archive/).

## Per-package documentation

Package-scoped docs live next to their code — not in `docs/`. Start at each package README:

- [server](../server/README.md) — backend API server ([architecture](../server/ARCHITECTURE.md), [API](../server/API.md))
- [gateway](../gateway/README.md) — mobile API gateway ([architecture](../gateway/ARCHITECTURE.md))
- React/Vite frontend — lives at the monorepo root (no subdirectory). See [`docs/reference/frontend-architecture.md`](reference/frontend-architecture.md).
- [ai-proxy](../ai-proxy/README.md) — AI proxy service ([architecture](../ai-proxy/ARCHITECTURE.md))
- [`nekoguntai-castle/sanctuary-umbrel`](https://github.com/nekoguntai-castle/sanctuary-umbrel) — Umbrel community app store (separate repo; auto-updates from this repo's release pipeline)
- [themes](../themes/README.md) — theme system reference

## Documentation standards

- **File naming:** kebab-case except canonical root files (`README.md`, `CLAUDE.md`, `DOCKER.md`, `CONTRIBUTING.md`, `CHANGELOG.md`) and per-package `README.md`/`ARCHITECTURE.md`.
- **Link style:** repo-root-relative for cross-package links, package-relative within a package.
- **Diagrams:** Mermaid only (rendered natively by GitHub).
- **Frontmatter:** none. ADRs use structured headings for metadata.
- **CI proof artifacts:** deleted on PR merge, not committed. See `CONTRIBUTING.md` for the lifecycle rule.
