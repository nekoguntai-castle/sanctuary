# Repository root layout

Sanctuary's tracked root baseline is **67 entries: 42 files and 25 directories**.
The bounded convergence target is **at most 45 entries**. The target is not a
standalone deletion quota: every tracked root entry must also be explicitly
classified in `scripts/quality/root-layout-classification.json` as a
conventional contract, generated artifact, project-owned entry, or tool-owned
configuration.

The quality gate fails for an unclassified addition, a stale or duplicate
classification, or growth beyond the checked-in `maximumEntries` ceiling. The
ceiling starts at 67, must be lowered after each atomic path migration, and must
reach 45 or fewer by the end of convergence; it can never be raised above the
recorded baseline or lowered past the bounded target. CI pins the immutable
baseline and bounded target. Reviewers own the monotonic-ceiling comparison
because each intentional migration changes the checked-in ceiling itself.

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
