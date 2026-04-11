# Extensibility Architecture Plan

Last updated: 2026-04-11

## Validation Baseline

- `docs/EXTENSION_POINTS.md` identified sync/job queue ownership as a boundary risk before phase 1. The code validated this: sync routes mixed in-process `SyncService` calls, BullMQ worker enqueue calls, and direct blockchain sync through the legacy Bitcoin route.
- Frontend route gating is currently specific to Intelligence. `AppNavFeature` only allows `intelligence`, and the sidebar has custom Intelligence filtering logic.
- `server/ARCHITECTURE.md` is stale in places. It describes an IoC-style service registry, while the actual service registry is a lifecycle registry for managed background services.
- Existing registry patterns are real, but not all equivalent. Provider registration has health and failover semantics; import and device parser registries share priority/detect mechanics.
- Broad file-size modularization and a new plugin framework are not objectively justified by the current evidence.

## Objective Criteria

Architectural changes must make at least one of these objectively better:

- A future extension touches fewer ownership boundaries.
- Endpoint contracts stay stable while implementation moves behind a clearer service boundary.
- Startup/shutdown or dispatch order becomes testable instead of implicit.
- New direct cross-layer dependencies are blocked by tests or documented allowlists.
- Existing local patterns are reused instead of introducing a wider abstraction without evidence.

## Phases

### Phase 1: Sync Command Ownership

Status: Completed 2026-04-11

Goal: put manual sync, queued sync, network sync, resync, and legacy Bitcoin wallet sync behind one coordinator boundary while preserving endpoint response contracts.

Planned work:

- Completed: added `server/src/services/sync/syncCoordinator.ts` for user-facing sync commands.
- Completed: moved route-level sync orchestration out of `server/src/api/sync.ts`.
- Completed: routed legacy `/api/v1/bitcoin/wallet/:walletId/sync` through the coordinator without changing its response shape.
- Completed: kept direct confirmation update behavior stable while moving route orchestration behind the same sync command boundary.
- Completed: updated focused API tests so worker enqueue, in-process sync, resync cleanup, and legacy route behavior remain pinned.

Verification:

- Passed: `cd server && npx vitest run tests/unit/api/sync.test.ts tests/unit/api/bitcoin.test.ts`
- Passed: `cd server && npx tsc --noEmit`

### Phase 2: Route Capability Metadata

Status: Not started

Goal: replace Intelligence-specific navigation gating with generic route capability metadata.

Planned work:

- Generalize `AppNavFeature` into route capabilities or required feature metadata.
- Replace sidebar-specific Intelligence filtering with generic capability filtering.
- Preserve the admin feature flag UI as an admin-only management surface.
- Add tests for gated route visibility and capability status behavior.

### Phase 3: Architecture Docs And Guardrails

Status: Not started

Goal: make the architecture docs match the code and add enforcement for boundaries that should not drift.

Planned work:

- Update `server/ARCHITECTURE.md` to describe the actual service lifecycle registry.
- Update `docs/EXTENSION_POINTS.md` after phase 1 changes.
- Add an allowlist-style test for direct Prisma imports outside repositories.

### Phase 4: Lifecycle Graph

Status: Not started

Goal: make backend service startup/shutdown ordering explicit and testable.

Planned work:

- Extend the existing lifecycle registry or add a small startup graph abstraction.
- Migrate low-risk services from manual startup/shutdown in `server/src/index.ts`.
- Test dependency order and reverse shutdown order.

### Phase 5: Registry Helper Evaluation

Status: Not started

Goal: reduce exact duplicated priority/detect registry mechanics only where the abstraction is smaller than the duplication.

Planned work:

- Compare import and device parser registry behavior.
- Extract a small helper only if it preserves their local semantics.
- Do not force provider health/failover semantics onto unrelated registries.
