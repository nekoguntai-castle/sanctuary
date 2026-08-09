# Bug Scrub Loop Iteration 7 Phase 4 — Device Route Ownership Resume

## Provenance

- Run: `bug-scrub-loop-20260730t000000z-361d68a`
- Iteration: 7 continuation after the interrupted delivery recorded on 2026-08-01
- Source target: `main` at `9d3f215d6833bfbffdc393568b9be1b06a7c36ca` (revalidated after the unrelated release-only #766 merge)
- Locked scope: whole repository; implementation boundary is device-detail frontend state
- Finding: P1 `device-detail-route-state-cross-contamination`
- Nested delivery rebuild policy: `defer`; the outer loop owns the final rebuild

## Goal

Make device-detail reads, rendered controls, mutations, and account-refresh callbacks owned by the current route/user/network generation so navigation from device A to device B can neither expose nor mutate A and late A work cannot overwrite B.

## Non-goals

- No server endpoint/contract, authorization, database, schema, or product-policy changes; frontend read wrappers may gain optional cancellation inputs.
- No broad state-management rewrite or unrelated Device Detail redesign.
- No transport cancellation for mutations; mutation results are fenced by captured ownership.
- P3 backlog is outside this blocking fix set.

## Current evidence

- `src/app/AppRoutes/AppRouteSwitch.tsx` reuses one `/devices/:id` route element across parameter changes.
- `src/components/DeviceDetail/hooks/useDeviceData.ts` keeps state across `id` changes and commits base, share, group, search, mutation, and `finally` results without generation ownership.
- `src/components/DeviceDetail/DeviceDetail.tsx` renders non-null device data without requiring `device.id === routeId`.
- `src/components/DeviceDetail/DeviceDetail/DeviceDetailContent.tsx` retains route-scoped tabs/modals and forwards stale device identity to controls.
- `src/components/DeviceDetail/accounts/hooks/useAddAccountFlow.ts` performs delayed refreshes that can call `onDeviceUpdated` for the prior route.
- Existing tests use fixed route IDs and do not exercise deferred A→B completion reordering.

Expected behavior: a route/user/network ownership change synchronously hides prior-route content; only current operations can commit state or loading completion; controls and refresh callbacks cannot target a stale device.

Actual behavior: route B can render device A, B load failure can leave A visible, slow A reads can replace B, and captured A handlers/account flows can mutate or reinsert A after navigation.

## Assumptions and boundaries

- The route ID, authenticated user identity, and selected Bitcoin network define device-detail ownership.
- Use an explicit key such as `routeId + user.id + selectedNetwork`; do not rely on object identity for `user`.
- Existing `ApiClient` request options remain the cancellation boundary; device read wrappers may add optional `AbortSignal` without changing callers that omit it.
- Each operation snapshots its route/device generation before awaiting work. A stale operation may finish remotely but must not commit UI state.
- A handler captured for an obsolete route is a no-op before starting a mutation. A mutation already accepted for A may complete remotely for A, but its success, error, refresh, and `finally` paths cannot commit under B.
- Keep edited functions below `CCN <= 15`; extract controller helpers rather than expanding the 703-line account-flow hook.
- No cache, migration, compatibility, or persistent-data cleanup is required.

## Phase 1 — Failing-first ownership regressions

- [x] Extend the device-detail hook harness to rerender the same component A→B with deferred A/B responses.
- [x] Prove synchronous invalidation: A is not rendered under route B, B failure does not retain A, and an old `finally` cannot clear B's loading state.
- [x] Resolve A after B and prove base device, wallets/models, share info, groups, and search results remain B/current-query owned.
- [x] Capture save/share/group/delete/transfer handlers on A, navigate to B, and prove obsolete controller handlers cannot start new work and stale controls are no longer rendered. Separately resolve an already-started A mutation and prove it makes no B state/loading/navigation commit while retaining A as its remote target.
- [x] Start USB/manual/import account refresh on A, navigate to B, and prove delayed A refresh cannot call B's `setDevice` path.
- [x] Add API wrapper tests proving supported device reads forward `AbortSignal`.

Acceptance: every regression fails against the source baseline for the stated ownership reason and does not depend on timing sleeps.

## Phase 2 — Route-owned controller implementation

- [x] Add a small generation/abort ownership helper keyed by route ID, `user.id`, and network. Tag loaded state with that key and derive an effective `device: null` plus loading state when the render key differs, so prior-route data is hidden during render without setting state during render; abort supported reads during effect cleanup.
- [x] Guard every base/share/group/search success, failure, and `finally` commit. Give search its own latest-query generation.
- [x] Reset all device-scoped view/edit/share/search/modal/loading state when ownership changes.
- [x] Snapshot route/device ownership for mutations; stale completions may not update data or loading state.
- [x] Require `device.id === routeId` before rendering edit/delete/transfer/share/account controls.
- [x] Key Device Detail content and account flows by the full ownership key, and replace raw `setDevice` exposure with an ownership-checked update callback so delayed account refreshes cannot reinsert A.
- [x] Thread the same ownership predicate into deletion and transfer completion/navigation seams; an already-started A mutation may finish for A, but obsolete component callbacks cannot navigate or alter the current B view.
- [x] Add optional signals to the relevant device read API wrappers through `apiClient.get(endpoint, params, retryOptions, requestOptions)`; treat expected aborts as cancellation rather than logged failures.

Acceptance: all Phase 1 regressions pass; current-route success/error behavior and existing mutation contracts remain unchanged.

## Verification and delivery

- [x] Focused Device Detail hook/page/content/account-flow/API tests, including null IDs, empty results, rejection, unmount, and reverse completion order.
- [x] `npm run typecheck:app`
- [x] `npm run typecheck:tests`
- [x] `npm run typecheck:all` after generating the fresh-worktree Prisma client.
- [x] `npm run test:run`; coverage gates remain required in protected CI.
- [x] Lint, changed-file `CCN <= 15`, large-file classification, and `git diff --check`.
- [x] Re-read the diff for reuse, simplification, edge cases, and unintended scope; obtain an independent adversarial review with no P0-P2 comments.
- [ ] Deliver one bounded PR through protected checks; verify squash/merge ancestry and exact target-branch CI.
- [ ] Record that successful target CI as the same-iteration successor that reconciles PR #600's externally caused target-CI failure, then clean the owned branch/worktree only at loop closeout.

## Rollback and recovery

- The change is frontend-only and independently reversible; rollback restores the old race and therefore should be paired with temporarily blocking cross-device in-app navigation until corrected.
- Abort is best-effort. Generation checks remain the correctness fence when a request or mutation cannot be canceled.
- No persistent state, cache migration, or cleanup runs during rollback.

## Final completion criteria

- The P1 trigger is no longer reproducible across route, user, network, query, mutation, unmount, and account-refresh boundaries.
- The reviewed plan revision is delivered by a verified PR with green PR and target-branch CI.
- The original iteration-7 plan is superseded only after its completed phases and this continuation are represented in durable state.
- The loop proceeds to a fresh complete eight-domain whole-repository scrub; implementation tests alone do not close the run.
