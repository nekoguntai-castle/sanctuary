# ADR 0006: Separate Prisma migration image

- Status: Accepted
- Date: 2026-09-19

## Context

The application, worker, and MCP services share a runtime image. Prisma CLI
and migration files are needed by the one-shot database migration, but the
application processes do not run migrations during startup. Including the
CLI dependency tree in every long-lived container increases the deployed
image size and expands the runtime package surface.

## Decision

The server Dockerfile produces two targets from the same source and provenance
inputs. Runtime dependencies are projected from the reviewed workspace lock
metadata into derived manifests, then installed with npm's offline lockfile
mode. The projection preserves the source lock resolutions and removes build
scripts and development dependencies. The migration projection explicitly
promotes Prisma from the server development manifest to a production
dependency so the CLI is present only in the migration target.

- the default application target contains the compiled API, worker, and MCP
  runtime;
- the `migration` target contains the Prisma CLI, schema, migration history,
  and the canonical `/app/scripts/migrate.sh` entry point.

Compose publishes the targets as `sanctuary-backend:<tag>` and
`sanctuary-migrate:<tag>`. The `migrate` service is a one-shot dependency of
the backend and worker and must complete successfully before either starts.
Offline bundles build, archive, verify, load, and register both images. Install
and upgrade cleanup inventories include the migration image as a separate
owned resource.

## Consequences

Application containers carry fewer migration-only dependencies and cannot
silently take ownership of schema changes during startup. Deployments build or
load one additional image, and migration failures stop dependent services.
Operators can run the canonical migration explicitly with the Compose
`migrate` service when needed.
