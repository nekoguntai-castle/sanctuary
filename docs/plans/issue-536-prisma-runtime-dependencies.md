# Issue 536: remove Prisma CLI dependencies from application images

Plan prepared 2026-09-19. Implemented by the accompanying change; see ADR 0006 for the accepted image boundary and the pull request for validation evidence.

## Findings verified against the current checkout

- [Issue 536](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/issues/536) originally tracks 65 MB of local dependencies. Its August comment reports approximately 122 MB including the CLI and `@prisma/dev` in the backend image. Those are historical measurements, not a fresh image measurement.
- `package-lock.json` resolves Prisma 7.8.0. The hard dependency paths are `prisma -> @prisma/config -> effect` and `prisma -> @prisma/dev -> @electric-sql/*`.
- Registry metadata checked today for Prisma 7.10.0 still includes both paths. A routine upgrade to that version does not fix this. The `prisma` registry `latest` tag currently returns an 8.0.0 release candidate, so candidate selection must use explicit stable versions.
- `server/Dockerfile` installs all workspaces, builds, prunes dev dependencies, and copies the resulting dependency tree into the backend image. `@prisma/client` has an optional Prisma CLI peer, so a production prune is not proof of CLI removal.
- `docker-compose.yml` already has a one-shot `migrate` service. Backend and worker wait for its successful completion. The service still uses the backend image; this is an image packaging change, not a new migration orchestration design.
- `server/scripts/migrate.sh` needs the CLI for legacy migration resolution and deploy, plus the compiled generated client, adapter, and compiled seed. A CLI-only image would be insufficient.
- Existing [upstream discussion 28787](https://github.com/prisma/orm/discussions/28787) acknowledges the install-size concern; its answered status does not establish a dependency-size fix.

## Recommended scope and closure decision

Separate migration tooling from the application image using the existing migration service. Keep development and migration installs complete and supported.

This resolves the production-image impact, but does not remove the dependencies from local development or the migration image. The original acceptance criteria require an upstream fix or a safe version without these dependencies. Before claiming issue 536 fixed, explicitly revise its scope to production application images. If its original scope is retained, track this implementation separately and keep 536 open as an upstream tracker. A split image alone cannot satisfy the original wording.

## Implementation sequence

1. **Prove the dependency packaging approach.** In an isolated build stage, derive a clean production dependency install from the committed lockfile using the repository's pinned npm. Exclude build-time CLI tooling and prevent optional-peer retention without deleting arbitrary declared dependencies. First evaluate a workspace-scoped clean install with dev and peer omission; verify its actual tree, because omission flags alone are not evidence. If workspace resolution still retains the CLI, use a reproducibly generated runtime manifest and lockfile projection, with a check against the source lockfile. Preserve required runtime peers, generated-client runtime libraries, server-local dependency overrides, and `@sanctuary/shared`. Gate further work on a working API/worker dependency tree with no CLI subtree.
2. **Produce two images.** Refactor `server/Dockerfile` into shared build stages and separate application and migration targets, keeping the application target the default. Add `sanctuary-migrate` carrying the pinned CLI, schema, migrations, Prisma config, canonical migration script, compiled seed, generated client and their runtime dependencies. Keep application operational scripts that are still used. Give both images consistent source/build labels and non-root ownership. Invoke the installed CLI directly, so a missing executable fails without an attempted `npx` download.
3. **Wire existing deployment paths.** Point `migrate` at the new image and give it a build definition. Preserve PostgreSQL readiness, successful-migration gates, seed behavior and failure propagation. Ensure install, start, upgrade and test paths build/load the new image before running migrations, recreate migration jobs for each release, and reject a missing or mismatched image before starting application services. Worker and MCP continue to consume the application image.
4. **Extend artifact handling.** Include the migration image in CI builds, provenance/evidence, ownership registration, release inventories, offline bundle creation/loading and cleanup. Review `scripts/ci/build-runtime-image.sh` for explicit Docker target support if using one Dockerfile. Update `scripts/ci/run-compose-e2e-subject.sh`, `scripts/offline/bundle-common.sh`, `scripts/offline/create-bundle.sh`, Compose overlays and their callers. Both artifacts must come from the same source and dependency lock.
5. **Validate and report.** Run the focused checks below, record actual before/after image and package sizes, and attach the results to the implementation PR. Report application-image savings separately from combined image storage and offline bundle size: tooling still exists in the migration artifact and total disk/download savings are not guaranteed.

## Required verification

- Extend `.github/workflows/docker-build.yml`, `scripts/ci/classify-docker-build-images.sh`, `scripts/ci/validate-docker-build-results.sh` (currently five requested/result pairs), and `scripts/ci/write-runtime-image-evidence.mjs` for the additional migration image role and its artifact smoke checks.
- Update `tests/install/unit/migration-compose-contract.test.sh`: it currently explicitly requires migrations to share the backend image and asserts the old Dockerfile shape. Assert separate images and preserved startup ordering instead.
- Update affected CI image-build, evidence, ownership and offline inventory tests, including `tests/ci/build-runtime-image.test.sh`, `tests/ci/run-compose-e2e-subject-migration-wait.test.sh`, and offline install tests.
- Inspect the built application image for `prisma`, `@prisma/config`, `@prisma/dev`, `effect`, and `@electric-sql/*`, including nested package locations. Their absence must be a repeatable regression check. Verify generated Prisma queries and backend, worker and MCP startup from that image.
- Run real PostgreSQL migrations and seeding from the migration image for a fresh install, a supported upgrade and the legacy-resolution fixture; rerun successfully to prove idempotency. Exercise a migration failure and verify backend/worker cannot start. CLI `--help` is insufficient.
- Run existing fresh-install and upgrade integration coverage and an offline installation with registry access unavailable. Check release identity matching and missing migration artifact failure.
- Reuse the repository's dependency/security checks for any dependency or lockfile changes. Do not downgrade Prisma or adopt a release candidate solely for size reduction.

## Completion evidence

An implementation PR with passing focused contracts and real install/upgrade evidence; an application image free of the targeted packages; a working, version-matched migration image included in online/offline distribution; and measured size results. Close 536 only under explicitly updated application-image acceptance, or after its original upstream/version condition is actually met.

## Delegation during implementation

After the dependency packaging proof establishes the image interface, use cheaper agents for bounded independent work: deployment/offline wiring, and contract/inventory updates. The primary agent reviews their diffs, integrates the Docker packaging work and runs the real migration and application checks.
