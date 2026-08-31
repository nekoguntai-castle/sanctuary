# Repository root layout

Sanctuary's tracked root baseline is **67 entries: 42 files and 25 directories**.
The original **at most 45 entries** target was an interim checkpoint. Final
convergence requires **at most 10 loose files and 12 directories**, measured
separately. These targets are not standalone deletion quotas: every tracked root
entry must also be explicitly classified in
`scripts/quality/root-layout-classification.json` as a conventional contract,
generated artifact, project-owned entry, or tool-owned configuration.

The quality gate now enforces the final contract. It fails for an unclassified
addition, a stale or duplicate classification, a file/directory kind mismatch,
the return of any path retired from the baseline, more than 10 loose files, or
more than 12 directories. The typed classification is the exact allowlist for
the retained root. The immutable baseline and complete 45-entry retirement list
make both the final inventory and its migration history reviewable in CI.

The frontend source-root migration lowered the ceiling to 56, and relocating
the frontend image definition to `docker/frontend/Dockerfile` lowered it to 55.
Consolidating optional and test Compose overlays under `docker/compose/` lowered
the ceiling to 50 while retaining repository-root path resolution through
explicit `--project-directory` arguments.
Moving the repository-wide tool configuration into `config/tooling/` lowered
the ceiling to 35 (18 files and 17 directories); every tool is invoked with an
explicit config path rather than relying on root-directory discovery.
Relocating ancillary documentation, the environment template, the README
template, and the Vite HTML entry—and retiring duplicate Node and unused hosted-
editor metadata—reduced the tracked root to 27 entries: the final 10-file
allowlist and 17 directories. The total ceiling remains at the 35-entry
checkpoint until the directory-owner migrations land; the real-repository test
already pins the exact loose-file inventory so it cannot regress meanwhile.
Moving repository media under `docs/assets/`, browser specifications under
`tests/e2e/`, and Vite static files under `src/public/` reduces the tracked root
to 24 entries: 10 files and 14 directories. The explicit Vite, Playwright,
TypeScript, Docker, and CI classifier paths preserve the three owners' runtime
and test semantics.
Moving the standalone Docusaurus package under `docs/site/` reduces the tracked
root to 23 entries: 10 files and 13 directories. Its own manifest and lockfile
remain a package boundary, while explicit build, audit, typecheck, security-scan,
and repository-root source paths preserve its behavior.
Retiring the obsolete CI log sink and its `tools/` owner completes convergence
at 22 tracked entries: exactly 10 files and 12 directories. Schema v2 records
each retained path's expected kind and prevents all 45 removed baseline entries
from returning.
`src/` is now the sole frontend source root, and shared ambient declarations
live in `shared/types/ambient-modules.d.ts`. The root
`config/popular-models.json` path remains an external compatibility contract
because released clients fetch its raw GitHub URL; it can move only after those
clients no longer depend on it.

## Path migration checklist

For every root entry moved or retired, search the old path across all of these
surfaces before committing the atomic cutover:

- workflow triggers, classifiers, local actions, and CI helper tests;
- Dockerfiles, Compose files, install/upgrade scripts, and release packaging;
- root and workspace package scripts and lockfile/workspace declarations;
- TypeScript, ESLint, Vite, Vitest, Playwright, Stryker, and dependency-cruiser
  configuration;
- architecture graph generators, import-boundary checks, and generated diagrams;
- application source, tests, fixtures, snapshots, public assets, and aliases;
- README generation, contributor/operator documentation, and docs-site build or
  deployment configuration;
- external-consumer and fresh-clone checks where a published path may be part of
  an integration contract.

After each move, run a negative search for the retired path. Historical records
may retain it only when clearly marked as historical; live forwarding files or
compatibility directories are not an acceptable way to satisfy the target.

Resource lifecycle policy remains under `config/`, its dependency-light operator
implementation under `scripts/ownership/`, and focused protocol tests under
`tests/ownership/`. These use existing classified root owners and do not add a
new root entry. Changes to any of them select both architecture and documentation
validation because the machine contract, implementation, and operator guidance
must move together.
