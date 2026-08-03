# Frontend UI Cleanup Plan

Date: 2026-05-28
Owner: Codex
Status: implemented locally; PR delivery pending

## Goal

Reduce frontend drift in the wallet/device list, app shell, empty-state navigation, and chart/theme surfaces without changing product behavior or redesigning the app. The work should make existing UI paths more accessible, easier to maintain, and better aligned with the current design primitives.

## Non-Goals

- No marketing-style redesign, new landing page, or broad visual theme replacement.
- No backend API contract changes.
- No new route or navigation IA changes beyond keeping the existing route registry maintainable.
- No release-branch work unless explicitly requested. Implementation should start from an up-to-date feature branch off `main`.
- No host `npm run dev`, `npm run preview`, `npm run start`, or direct `npx vite`; use tests/builds and Docker-backed runtime checks when rendered verification is needed.

## Decisions

No user-blocking product decisions are required before implementation.

- Keep `useTabsA11y` as the tab keyboard/focus behavior owner.
- Adopt `FeatureTable` or a renamed equivalent shared helper for wallet/device table preferences; do not keep a dead aspirational abstraction.
- Prefer existing `Button`, `LinkButton`, `ColumnConfigButton`, and local table primitives before adding new UI abstractions.
- Add a small shared segmented-control/icon-control primitive only if the first implementation slice proves it removes real duplication and improves accessibility.
- Treat `LabelManager` color palettes as user-facing label data, not theme-token drift.

## Evidence

- `components/ConnectDevice/DeviceModelSelector.tsx` has an icon-only clear button with no accessible name, and its test currently selects `getByRole('button', { name: '' })`.
- `components/WalletList/WalletListHeader.tsx` and `components/DeviceList/DeviceListHeaderControls.tsx` hand-roll compact view-mode controls around icons and column configuration.
- `components/ui/FeatureTable.tsx` exists and is tested, but production wallet/device lists still wire `ConfigurableTable`, visible columns, and column config manually.
- `components/Layout/useLayoutController.ts` mixes sidebar state, network availability polling, global notifications, draft reminders, modal state, clipboard state, console state, and keyboard-shortcut state.
- `components/ui/EmptyState.tsx` navigates by mutating `window.location.hash`.
- Chart and transaction-flow surfaces carry hard-coded hex values outside the theme system.
- `src/app/appRoutes.tsx` is a strong registry-driven source of truth, but it now combines lazy imports, definitions, derived nav helpers, redirects, and render helpers in one large file.

## Phase 0: Preflight And Baseline

- [ ] Start from a clean worktree and a new feature branch based on current `main`.
- [ ] Re-read `AGENTS.md`, `CLAUDE.md`, and `docs/reference/frontend-architecture.md`.
- [ ] Capture baseline searches for empty-name buttons, direct hash mutation, production `FeatureTable` usage, and hard-coded chart/flow colors.
- [ ] Run focused existing tests for the planned touchpoints before editing:
  - `npm run test:run -- tests/components/ConnectDevice/DeviceModelSelector.test.tsx tests/components/ui/FeatureTable.test.tsx tests/components/ui/EmptyState.test.tsx tests/src/app/appRoutes.test.ts`
  - Add wallet/device/layout focused suites to the baseline if they are touched in the first slice.
- [ ] If baseline tests fail before changes, stop and classify whether the failure is environmental, branch drift, or a real regression.

## Phase 1: Accessible Compact Controls

- [ ] Add explicit accessible names to targeted icon-only controls, starting with the Device Model Selector search clear button and wallet/device list view toggles.
- [ ] Replace tests that query empty-name buttons with stable role/name queries.
- [ ] Audit adjacent compact controls touched by the same components for `aria-label`, `aria-pressed`, `title`, keyboard focus, and disabled-state clarity.
- [ ] Keep visual layout stable; this phase is behavior/accessibility cleanup, not a style redesign.
- [ ] Add or update focused tests:
  - `tests/components/ConnectDevice/DeviceModelSelector.test.tsx`
  - `tests/components/WalletList.test.tsx` or the nearest WalletList header test
  - `tests/components/DeviceList/DeviceListHeader.branches.test.tsx`
- [ ] Verification gate:
  - focused tests for touched controls
  - `npm run typecheck:app`
  - `npm run lint:app`
  - `git diff --check`

## Phase 2: Table Preference Convergence

- [ ] Inspect `FeatureTable` against current wallet/device list requirements: grid/list/table switching, column visibility, column order, preference persistence, empty states, and loading/error states.
- [ ] Migrate `WalletList` to `FeatureTable` or extract the missing shared hook/helper needed for it to use the same abstraction cleanly.
- [ ] Migrate `DeviceList` through the same path after the wallet migration is verified.
- [ ] Remove or revise misleading `FeatureTable` comments if the final abstraction shape changes.
- [ ] Ensure no production list bypasses the chosen shared table-preference path for the same behavior without a documented reason.
- [ ] Add or update focused tests:
  - `tests/components/ui/FeatureTable.test.tsx`
  - `tests/components/WalletList.test.tsx`
  - `tests/components/WalletList.branches.test.tsx`
  - `tests/components/DeviceList.test.tsx`
  - `tests/components/DeviceList/DeviceList.branches.test.tsx`
- [ ] Stop and re-plan if `FeatureTable` requires broad visual or data-model changes to support the existing lists.
- [ ] Verification gate:
  - focused wallet/device/table tests
  - `npm run typecheck:app`
  - `npm run typecheck:tests`
  - `npm run lint:app`
  - touched-file lizard check for non-trivial helpers
  - `git diff --check`

## Phase 3: Layout Controller Decomposition

- [ ] Keep `Layout.tsx` and `LayoutShell` behavior unchanged.
- [ ] Extract focused hooks or helpers from `useLayoutController`:
  - sidebar network availability
  - global connection notifications
  - draft reminder notifications
  - layout modal/action state
  - console and keyboard-shortcut state, if extraction is cleaner than leaving it inline
- [ ] Preserve the public return shape of `useLayoutController` until all callers are updated.
- [ ] Add focused tests for extracted logic, including empty wallet/device inputs, unavailable networks, failed readiness checks, interval cleanup, and duplicate-notification prevention.
- [ ] Verification gate:
  - `tests/components/Layout*.test.tsx`
  - `tests/components/Layout/SidebarNetworkAvailability.test.ts`
  - new tests for extracted hooks/helpers
  - `npm run typecheck:app`
  - `npm run lint:app`
  - touched-file lizard check
  - `git diff --check`

## Phase 4: Router-Aware Empty State Actions

- [ ] Replace direct `window.location.hash` mutation in `EmptyState` with router-aware navigation.
- [ ] Prefer rendering `LinkButton` for route actions and a normal `Button` for callback actions.
- [ ] Preserve current compact/full empty-state markup and visual spacing.
- [ ] Update tests to assert link destinations or router navigation behavior rather than hash mutation side effects.
- [ ] Verification gate:
  - `tests/components/ui/EmptyState.test.tsx`
  - `tests/components/DeviceList/EmptyState.test.tsx`
  - any wallet/device empty-state tests affected by the API shape
  - `npm run typecheck:app`
  - `npm run lint:app`
  - `git diff --check`

## Phase 5: Theme-Aware Chart And Flow Colors

- [ ] Inventory hard-coded hex/RGBA values in chart and transaction-flow components.
- [ ] Add narrowly scoped theme tokens for chart axes, chart grid, chart tooltip, chart series, flow inputs, flow outputs, flow fees, and flow surfaces.
- [ ] Use existing theme conventions in `src/index.html`; preserve inverted dark-mode scale rules for the established token families.
- [ ] Update chart and flow components to consume CSS variables or existing semantic classes instead of raw color literals.
- [ ] Leave user-selected label colors and other intentional data palettes alone.
- [ ] Add or update tests where components expose color values through props; otherwise rely on build, lint, and rendered regression checks.
- [ ] Rendered verification, only after visual behavior changes:
  - use the existing Playwright render suite when applicable: `npm run test:e2e:render`
  - if a live app is required, use Docker-backed app startup rather than host Vite
- [ ] Verification gate:
  - `tests/components/TransactionFlowPreview.test.tsx`
  - relevant chart tests if present or added
  - `npm run typecheck:app`
  - `npm run lint:app`
  - `npm run build`
  - hard-coded color negative search for the touched production surfaces
  - `git diff --check`

## Phase 6: Route Registry Split

- [ ] Split `src/app/appRoutes.tsx` into smaller route-registry modules without changing exported route behavior.
- [ ] Keep route definitions as the source of truth for sidebar/nav metadata.
- [ ] Suggested shape:
  - `src/app/routeComponents.tsx` for lazy imports and route element factories
  - `src/app/routeDefinitions.tsx` for `appRouteDefinitions` and redirects
  - `src/app/appRoutes.tsx` for stable public exports and selectors
- [ ] Keep `appNavItems`, `findRouteByPath`, `getRouteTitle`, and `renderAppRouteElement` behavior stable.
- [ ] Verification gate:
  - `tests/src/app/appRoutes.test.ts`
  - layout/sidebar tests that consume nav metadata
  - `npm run typecheck:app`
  - `npm run lint:app`
  - `git diff --check`

## Final Verification Gate

Run after all phases that are included in the implementation PR:

- [ ] `npm run test:run -- tests/components/ConnectDevice/DeviceModelSelector.test.tsx tests/components/ui/FeatureTable.test.tsx tests/components/ui/EmptyState.test.tsx tests/src/app/appRoutes.test.ts`
- [ ] Focused wallet/device/layout/chart tests touched by the diff.
- [ ] `npm run typecheck:app`
- [ ] `npm run typecheck:tests`
- [ ] `npm run lint:app`
- [ ] `npm run build`
- [ ] `bash scripts/quality/lizard-only.sh` for non-trivial logic changes.
- [ ] `git diff --check`
- [ ] `npm run test:related -- --since main` if the final diff spans more than two major surfaces.
- [ ] `npm run test:e2e:render` only if visual rendering changes are material enough to need screenshot coverage.

## Implementation Review

Implemented locally on `codex/frontend-ui-cleanup`.

- Phase 1: Added accessible names, pressed-state metadata, button types, and stable tests for targeted compact icon controls.
- Phase 2: Routed wallet and device table views through `FeatureTableView` with shared column-order merging.
- Phase 3: Split `useLayoutController` into focused sidebar availability, notification, and chrome-state hooks while preserving the controller return shape.
- Phase 4: Replaced direct hash mutation in `EmptyState` with router links for route actions and normal buttons for callback actions.
- Phase 5: Added chart/flow CSS tokens and moved touched chart/transaction-flow surfaces off raw hex/Tailwind arbitrary color literals.
- Phase 6: Split route lazy imports, route definitions, and public route selectors into separate modules without changing public exports.

Verification passed:

- `npm run test:run -- tests/components/ConnectDevice/DeviceModelSelector.test.tsx tests/components/ui/FeatureTable.test.tsx tests/components/ui/EmptyState.test.tsx tests/src/app/appRoutes.test.ts tests/components/Layout/SidebarNetworkAvailability.test.ts tests/components/TransactionFlowPreview.test.tsx tests/components/WalletList.test.tsx tests/components/WalletList.branches.test.tsx tests/components/DeviceList.test.tsx tests/components/DeviceList/DeviceList.branches.test.tsx tests/components/DeviceList/DeviceListHeader.branches.test.tsx tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx tests/components/Layout/SidebarContent.branches.test.tsx tests/components/Dashboard/WalletSummary.test.tsx`
- `npm run typecheck:app`
- `npm run typecheck:tests`
- `npm run lint:app`
- `npm run build`
- `npm run test:e2e:render`
- fresh `npm run test:coverage:shard -- 1 2`, `npm run test:coverage:shard -- 2 2`, and `npm run test:coverage:merge` after the EmptyState coverage fix
- touched-file lizard check with `-C 15 -T nloc=200`
- `git diff --check`
- negative searches for direct `EmptyState` hash mutation and hard-coded colors in the touched chart/flow surfaces

Known gate notes:

- A broad `npm run test:related` attempt expanded into unrelated all-lane e2e/selector runs and was stopped after it had already reported non-diff lane issues. The relevant unit failure from that run was `WalletSummary` missing router context after `EmptyState` route actions became links; it was fixed and reverified.
- Whole-repo `bash scripts/quality/lizard-only.sh` still reports pre-existing server-side CCN warnings in `server/src/services/bitcoin/electrumPool/metricsExporter.ts`, `server/src/services/bitcoin/networkStatusService.ts`, and `server/src/repositories/nodeConfigRepository.ts`. Touched frontend files pass the configured complexity threshold.

## Acceptance Criteria

- Targeted icon-only controls have accessible names, and tests no longer rely on empty accessible names for those controls.
- Wallet and device list table preference behavior is owned by one shared production path or the unused abstraction is removed with equivalent shared behavior retained.
- `useLayoutController` becomes a composition layer over focused hooks/helpers rather than owning unrelated polling, notification, modal, and action logic directly.
- `EmptyState` no longer mutates `window.location.hash` directly.
- Chart and transaction-flow surfaces use theme-aware tokens for shared UI colors; intentional user/data palettes remain explicit.
- Route registry behavior is unchanged, but route data and route selectors are separated enough that future routes do not grow one 400+ line mixed-purpose file.
- All changed files pass focused tests, app/test typechecks, app lint, build, diff check, and appropriate complexity review.

## Backout Notes

- Each phase should be independently revertible.
- Phase 2 should stop before broad migration if `FeatureTable` cannot support existing wallet/device behavior without visual churn.
- Phase 5 should isolate token additions from component rewrites so a visual regression can be backed out without losing the theme-token inventory.
- Phase 6 should preserve public exports to avoid forcing downstream route import churn.
