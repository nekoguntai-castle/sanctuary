# Repository root layout

Sanctuary's tracked root baseline is **67 entries: 42 files and 25 directories**.
The original **at most 45 entries** target was an interim checkpoint. Final
convergence requires **at most 10 loose files and 12 directories**, measured
separately. These targets are not standalone deletion quotas: every tracked root
entry must also be explicitly classified in
`scripts/quality/root-layout-classification.json` as a conventional contract,
generated artifact, project-owned entry, or tool-owned configuration.

The quality gate fails for an unclassified addition, a stale or duplicate
classification, or growth beyond the checked-in `maximumEntries` ceiling. The
ceiling starts at 67 and must be lowered after each atomic path migration. The
current schema records the achieved 35-entry ceiling; the final
contract will replace that checkpoint with separate file and directory caps. CI
pins the immutable baseline and current migration ceiling. Reviewers own the
monotonic-ceiling comparison because each intentional migration changes the
checked-in ceiling itself.

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
