# Extension Points Map

This map names the extension surfaces that should absorb common changes before new one-off wiring is added. It is not a plugin API contract. Treat it as a code navigation and ownership guide for the current architecture.

## Frontend Navigation

Primary surface: `src/app/appRoutes.tsx`

Consumers:

- `App.tsx`
- `components/Layout/SidebarContent.tsx`
- `tests/src/app/appRoutes.test.ts`

Use this when:

- Adding or removing a top-level app route.
- Adding a sidebar nav entry that maps to an app route.
- Adding route metadata such as labels, nav sections, feature flags, or redirects.

Guardrails:

- Keep route IDs, paths, sidebar labels, lazy components, fallback behavior, and redirects in the route manifest.
- Do not add a separate static sidebar route list unless the route is intentionally not navigable.
- If routes need authorization later, add explicit access metadata to the manifest instead of scattering checks in `App.tsx`.
- Run `npx vitest run tests/src/app/appRoutes.test.ts`.

## Wallet Detail Tabs

Primary surface: `components/WalletDetail/tabDefinitions.ts`

Consumers:

- `components/WalletDetail/TabBar.tsx`
- `components/WalletDetail/WalletDetail.tsx`
- `components/WalletDetail/types.ts`
- `tests/components/WalletDetail/tabDefinitions.test.ts`
- `tests/components/WalletDetail.test.tsx`
- `tests/components/WalletDetail.wrapper.test.tsx`

Use this when:

- Adding, removing, renaming, or reordering wallet detail tabs.
- Changing which wallet roles can see a tab.
- Changing tab badge metadata, including the draft badge.

Guardrails:

- Keep tab IDs, labels, role visibility, default tab, and badge metadata in the registry.
- `WalletDetail.tsx` may keep the content switch for now. Only extend the registry to render tab content when there is a real optional-tab use case.
- Validate router-provided tab state through the registry and fall back when a requested tab is hidden.
- Run `npx vitest run tests/components/WalletDetail/tabDefinitions.test.ts tests/components/WalletDetail/TabBar.test.tsx tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx`.

## Backgrounds And Themes

Primary surfaces:

- `themes/patterns.ts`
- `themes/backgroundCategories.ts`
- `themes/types.ts`
- `components/Settings/sections/ThemeSection/iconMaps.ts`
- `components/Settings/sections/ThemeSection/AppearanceTab.tsx`
- `components/Settings/sections/ThemeSection/panels/BackgroundsPanel.tsx`
- `components/AnimatedBackground.tsx`
- `components/animatedPatterns.ts`

Supporting implementation surfaces:

- `components/animations`
- `index.html`
- `types/ui.ts`
- `themes/README.md`

Use this when:

- Adding a selectable global background.
- Changing a background category or semantic icon.
- Adding an animated background module.
- Changing Settings background filtering, favorites, or counts.
- Updating the accepted UI background preference type.

Guardrails:

- `themes/patterns.ts` is the global background metadata source of truth.
- Registered backgrounds need categories and an `iconKey`.
- Animated backgrounds must have a matching loader module under `components/animations` by the existing naming convention.
- Static CSS-backed backgrounds should be registered before being user-selectable.
- `components/animatedPatterns.ts` is a compatibility re-export, not a second registry.
- Settings category filtering should use the visible background set, not a global-only map.
- Persisted preferences should remain tolerant of unknown strings and fall back safely.
- Run `npx vitest run tests/components/AnimatedBackground.test.tsx tests/components/AnimatedBackground.lazyLoading.test.tsx tests/themes/backgroundCategories.test.ts tests/themes/index.test.ts tests/themes/registry.test.ts tests/components/ThemeSection.test.tsx tests/components/Settings/sections/ThemeSection/AppearanceTab.branches.test.tsx tests/components/Settings/sections/ThemeSection/panels/BackgroundsPanel.branches.test.tsx`.

Open design item:

- Theme-specific background IDs are not yet first-class persisted preference types. Revisit once real theme-specific background options exist.

## Wallet And Device API Contracts

Primary surfaces:

- `server/src/api/openapi/spec.ts`
- `server/src/api/openapi/paths/wallets.ts`
- `server/src/api/openapi/paths/devices.ts`
- `server/src/api/openapi/schemas/wallet.ts`
- `server/src/api/openapi/schemas/device.ts`
- `server/tests/unit/api/openapi.test.ts`

Runtime route surfaces:

- `server/src/api/wallets/crud.ts`
- `server/src/api/devices/crud.ts`

Use this when:

- Adding or changing wallet/device route request bodies.
- Adding or changing wallet/device response status codes.
- Adding or changing wallet/device response shapes that should be documented.

Guardrails:

- Keep OpenAPI status codes aligned with implemented route behavior.
- Wallet delete is `204` with no response body.
- Device item routes include `GET`, `PATCH`, and `DELETE` under `/devices/{deviceId}`.
- Device create documents `201`, merge `200`, validation `400`, and conflict `409`.
- Add focused OpenAPI tests for any drift-prone status/path/schema change.
- Run `cd server && npx vitest run tests/unit/api/openapi.test.ts`.

Deferred work:

- Generating clients or route handlers directly from OpenAPI/Zod contracts.
- Converting all API domains to schema-first validation in one pass.
- Reconciling every historical response field beyond the first wallet/device guardrail slice.

## Device Registration Service

Primary surfaces:

- `server/src/services/deviceRegistration.ts`
- `server/src/services/deviceAccountConflicts.ts`

HTTP route surface:

- `server/src/api/devices/crud.ts`

Compatibility surface:

- `server/src/api/devices/accountConflicts.ts`

Use this when:

- Changing hardware device registration validation.
- Changing duplicate fingerprint behavior.
- Changing account merge conflict behavior.
- Changing model lookup or primary xpub selection for device creation.

Guardrails:

- Keep validation, fingerprint normalization, account normalization, duplicate detection, merge conflict handling, model lookup, and create/merge orchestration in the service layer.
- Keep `POST /devices` responsible for HTTP concerns: user ID lookup, service call, status selection, and response serialization.
- Preserve documented `201`, merge `200`, validation `400`, and conflict `409` behavior unless changing the API contract intentionally.
- Keep `server/src/api/devices/accountConflicts.ts` as a compatibility re-export while existing tests or callers import it.
- Run `cd server && npx vitest run tests/unit/api/devices.test.ts tests/unit/api/openapi.test.ts`.

## Sync And Job Queues

Public user API:

- `server/src/api/sync.ts`
- `server/src/api/bitcoin/sync.ts`

User-facing sync command ownership:

- `server/src/services/sync/syncCoordinator.ts`

Worker queue producers:

- `server/src/services/workerSyncQueue.ts`
- `server/src/infrastructure/notificationDispatcher.ts`
- `server/src/worker.ts`

Worker queue ownership:

- `server/src/worker/workerJobQueue/index.ts`
- `server/src/worker/jobs/index.ts`
- `server/src/worker/jobs/syncJobs.ts`
- `server/src/worker/jobs/notificationJobs.ts`
- `server/src/worker/jobs/maintenanceJobs.ts`
- `server/src/worker/jobs/autopilotJobs.ts`
- `server/src/worker/jobs/intelligenceJobs.ts`

In-process sync queue ownership:

- `server/src/services/sync/syncService.ts`
- `server/src/services/sync/syncQueue.ts`
- `server/src/services/sync/walletSync.ts`

Dead-letter queue and diagnostics:

- `server/src/services/deadLetterQueue.ts`
- `server/src/worker/workerJobQueue/eventHandlers.ts`
- `server/src/api/admin/infrastructure.ts`
- `server/src/worker/healthServer.ts`
- `server/src/api/health/serviceChecks.ts`
- `server/src/services/supportPackage/collectors/jobQueue.ts`
- `server/src/services/supportPackage/collectors/deadLetterQueue.ts`

Use this when:

- Changing manual sync trigger behavior.
- Changing worker queue producers or worker job handlers.
- Changing sync retry, DLQ, health, or support-package behavior.
- Deciding whether an endpoint should use the in-process queue or BullMQ worker queue.

Current boundary notes:

- `server/src/services/sync/syncCoordinator.ts` owns user-facing sync commands from the public sync routes, including manual sync, queued sync, network sync, resync, legacy Bitcoin wallet sync, and confirmation updates.
- `server/src/api/sync.ts` and `server/src/api/bitcoin/sync.ts` should remain thin HTTP/auth/rate-limit adapters over the coordinator.
- Admin DLQ retry requeues sync failures into the in-process queue even when worker jobs can also enter the DLQ.
- `server/src/jobs/jobQueue.ts` remains as a general queue singleton, but health/support-package paths usually see it as unavailable in the API process.

Guardrails:

- Put new user-facing sync command orchestration in `server/src/services/sync/syncCoordinator.ts` instead of adding route-local queue or blockchain dispatch.
- Prefer documenting legacy aliases before deleting or changing public endpoints.
- If DLQ retry is expanded, dispatch by original queue metadata when present instead of assuming every sync failure belongs to the in-process queue.
- If worker BullMQ becomes the canonical manual-sync path, update status endpoints and tests in the same slice.

## Existing Registry Patterns

These surfaces were not part of the recovered frontend-first work, but they are established extension patterns already present in the codebase:

- Script types: `server/src/services/scriptTypes`.
- Import handlers: `server/src/services/import`.
- Export handlers: `server/src/services/export`.
- Notification channels: `server/src/services/notifications/channels`.
- Feature flags: `server/src/services/featureFlags/definitions.ts` and `server/src/services/featureFlagService.ts`.
- Service hooks: `server/src/services/hooks`.
- Providers: `server/src/providers`.

When adding a new domain extension point, prefer matching one of these local registry patterns before introducing a new abstraction.

## Not Extension Work

The login logo glow-ring cleanup touches:

- `components/Login/LoginLogoContainer.tsx`
- `index.html`
- `tests/components/Login/LoginLogoContainer.test.tsx`

Keep that change separate when reviewing or committing the extensibility work.
