# Bug Scrub Loop Iteration 8 — Async Ownership, Provider Models, and Shutdown

Source target: `2afac6514df122fd85ebe0792298017f4fa8c6c3` (`origin/main`). Scope: resolve every P0–P2 finding accepted by the complete iteration 8 whole-repository scrub. Deployment remains deferred until the loop's final zero-finding pass. PR #1252 is unrelated and remains untouched.

## Goal and accepted findings

Make every asynchronous result mutate only the operation, profile, query, or lifecycle generation that initiated it.

- **P2 — `wallet-device-sharing--stale-user-search-results`:** wallet and device sharing retain query A rows while valid query B is pending or fails. Those rows remain enabled and can share with a user who does not match the displayed query.
- **P2 — `ai-settings--profile-model-discovery-mismatch`:** the UI loads models after locally selecting or editing profile B, but `GET /ai/models` uses persisted active profile A. Models from A can be selected and saved into B.
- **P1 — `usb-device-import--late-result-after-model-reset`:** changing the selected model resets visible USB state without invalidating the pending operation. A late model A result can populate and save under current model B.
- **P1 — `hardware-wallet-service--overlapping-connect-session-race`:** two service connects share one generation. If newer B completes before older A, A can overwrite the singleton session while the hook/UI retains B.
- **P2 — `database-health-check--reschedule-after-shutdown`:** stopping the database monitor clears only its current timer. A callback already awaiting health or reconnect work can schedule another timer or reconnect after shutdown.

## Non-goals and assumptions

- Do not redesign sharing roles, provider-profile persistence, device registration, hardware adapter protocols, or database retry policy.
- Do not add cancellation claims where an underlying browser or hardware API cannot cancel. Generation ownership is the required correctness boundary.
- Do not send stored AI credentials back to the browser. Typed endpoint detection may use the existing admin-only detection contract; configured model listing may use server-held credentials only for the persisted active profile.
- Keep the migration tree, public device payloads, and existing saved AI settings compatible.
- P3 backlog is outside this blocking fix set.

## Phase 1 — Remove stale sharing search actions

- [x] Add deferred-promise regressions to the wallet and device sharing hook suites: complete query A, start valid query B, and prove A rows clear synchronously before B settles and remain absent if B rejects. Add focused rendered-control regressions proving A's row/button unmounts before B settles or fails and clicking its former location cannot call the share API. Do not globally restrict `handleShareWithUser` to search results because the shared-access list also uses it for existing-user role changes.
- [x] Clear `userSearchResults` on every query change before the valid-query await in both sharing hooks. Preserve the existing generation and route ownership checks, short-query behavior, existing-user filtering, error reporting, and loading ownership.
- [x] Re-read wallet/device share callers and rendered controls. Keep role selection and API payloads unchanged; avoid duplicate search abstractions unless the two existing hooks already share a suitable helper.

Acceptance: every displayed sharing result belongs to the current query; prior rows disappear immediately on input change and cannot trigger a share during the replacement request or after its failure.

Backout: revert this phase PR. No server or persisted data changes are involved.

Phase 1 implementation verification before delivery: the two new hook regressions failed on the original code and passed after the synchronous clears. The focused four-file suite passed 53 tests; the expanded ownership/caller suite passed 70 tests. Root app/test/all typechecks, app lint, architecture boundaries, and the production build passed under Node 24.21.0/npm 12.0.2. The full frontend coverage run passed 652 files and 8,762 tests with 100% statements, branches, functions, and lines. Independent adversarial review found no P0–P2 issue or scope creep.

## Phase 2 — Bind model discovery to the visible provider state

- [ ] Add `useAISettings` regressions with persisted active profile A and locally selected profile B. Prove the UI never labels A's models as B's, profile selection plus endpoint/provider-type/credential edits clear prior models immediately, stale completions cannot repopulate the current profile, and saving B followed by listing uses the exact settings returned by that save. Separately, keep API/service tests responsible for proving `GET /ai/models` uses persisted configuration and server-held credentials and accepts no client endpoint.
- [ ] Separate configured model listing from typed endpoint detection in `useAISettings`. Track a persisted model-source snapshot containing profile ID, normalized endpoint, provider type, and whether credential state has local edits. Allow `aiApi.listModels()` only while the visible source matches that clean persisted snapshot; otherwise invalidate the request generation, clear results, close the dropdown, and require typed detection or a successful save. Capabilities, display name, and selected model do not affect this source key.
- [ ] Remove the fixed-delay legacy model reload. Update the persisted snapshot from the `SystemSettings` returned by detection/save, then start configured listing from that returned snapshot or the render that applied it; never call a closure bound to the pre-save endpoint. Invalidate and clean scheduled/in-flight discovery on profile edits, profile removal/selection, save replacement, and unmount.
- [ ] Keep the server `GET /ai/models` contract explicitly scoped to the persisted active profile and server-held credential. If tests expose ambiguity in its response or authorization, clarify the contract without accepting arbitrary client endpoints or exposing secrets. Preserve the existing admin-only typed detection validation, egress allowlist, rate limits, and error envelope.
- [ ] Add a `configuredModelRefreshAvailable` state plus an unavailable reason to both Settings and Models tabs. While the visible provider source is unsaved, disable both configured Refresh controls, clear/close stale results, and show a tested “Save or Detect for this endpoint/profile” path while leaving manual model entry enabled.

Acceptance: the model list shown for profile B can only come from B's current typed detection result or B after it is successfully persisted active; a response initiated for A cannot populate B; credentials remain server-side except for the existing explicit typed credential input.

Backout: revert this phase PR. Existing saved profiles and encrypted credentials remain unchanged.

## Phase 3 — Fence USB operations and singleton hardware sessions

- [ ] Add a red `useDeviceConnection` regression that starts model A, calls `reset`, resolves connection/xpub discovery late, and proves no result, error, progress, or scanning writer survives the reset. Add a form/controller regression that switches to model B during A and proves A identity evidence cannot enable or construct B's save payload.
- [ ] Add red `HardwareWalletService` regressions with deferred connects on the same shared adapter and on two adapters in both request/adapter orders, including delayed and failing A. Prove only B becomes approved, A is cleaned before B enters the adapter, and B's surviving transport handles `getXpub` and signing. Add a reset-only A case with no B and prove conditional release disconnects A and leaves `isConnected()` false; then add A-reset-external-B and prove A's late release cannot close B. Preserve and extend connect-versus-disconnect coverage.
- [ ] Give every `useDeviceConnection.connectUsb` attempt a monotonically increasing ownership generation. Increment it on connect and reset; gate all progress, success, failure, and `finally` state writes. Serialize the complete connect-plus-xpub import operation so a replacement attempt waits for superseded hardware work to settle before starting. Obtain a service-issued opaque connection lease with the device; after every awaited boundary, stale work must conditionally release that exact lease and stop before another hardware read. Never call unscoped global disconnect from the hook. Cover reset with and without a replacement attempt.
- [ ] Add an ownership-aware service connect/release primitive while preserving the existing `connect()` compatibility contract for other callers. Increment the service connect generation at the start of every connect as well as disconnect, serialize adapter connection/cleanup so same-adapter and cross-adapter attempts cannot overlap ownership, and bind each approved connection to an opaque lease token. Conditional release disconnects only when that token still owns `activeAdapter` and `approvedConnection`; after every await, reject superseded work before assignment and complete stale cleanup before the newest queued connect touches the adapter. Preserve capability checks, fingerprint/model validation, lazy adapter loading, and current disconnect cancellation.
- [ ] Update the existing concurrent lazy-loader expectation to separate loader deduplication from session ownership: the adapter may load once, but only the newest queued connect may become approved. Run `hardwareWallet.service`, `useDeviceConnection`, `useHardwareWallet`, form/controller, and affected adapter suites. The exact-head hardware-vector workflows are the integration gate. A stale completion must never disconnect the adapter or transport owned by the current generation.

Acceptance: a reset or model switch permanently invalidates its prior USB operation; only the newest connect may own the service session; displayed device identity, approved adapter, and subsequent xpub/sign/verify operations refer to the same current device.

Backout: revert this phase PR before deployment. No device records or wallet data are migrated. If a superseded browser hardware permission prompt remains open, the current generation still owns all application state.

## Phase 4 — Make database monitor stop terminal

- [ ] Add fake-timer regressions for three distinct cases: stop while the health query is pending prevents reconnect from starting; stop while reconnect is pending does not resolve until that work settles; and awaited stop followed by start creates a fresh generation whose timer, promise, counters, and logs cannot be overwritten by the old completion.
- [ ] Add a monitor generation and track the in-flight tick/reconnect promise in `server/src/models/prisma.ts`. Capture the generation when scheduling; check it after each awaited boundary and before scheduling or mutating state. Make `stopDatabaseHealthCheck` invalidate the generation, clear the timer, and return a promise that drains already-started monitor work. Scope or identity-guard `consecutiveHealthFailures` and `reconnectingPromise` so old `finally` blocks cannot clear a new run.
- [ ] Update API, worker, MCP, and `beforeExit` shutdown call sites to await monitor stop before the final Prisma disconnect. Re-read their shutdown ordering and tests. Keep timer `unref`, exponential backoff, single-reconnect ownership, health restoration logging, and explicit restart semantics intact.

Acceptance: once awaited stop resolves, the old monitor generation has no in-flight health or reconnect work and cannot schedule, reconnect, log restoration, or mutate a newly started generation; final database disconnect always occurs after that drain; a later explicit start creates exactly one working monitor.

Backout: revert this phase PR. No database schema or persistent data changes are involved.

## Cross-phase delivery and verification

- [ ] Before each phase, fetch `origin/main`, recheck open PRs and exact source paths, and repeat plan review if source contracts changed materially. Deliver phases serially through protected PRs and verify exact head CI, merge ancestry/tree, and exact merge-SHA target CI before starting the next phase.
- [ ] Write each behavioral regression first. Run the smallest owning suites during development, then root app/test/all typechecks, frontend tests and 100% coverage for frontend phases; server typecheck, unit suite and 100% unit coverage for server phases; both frontend and server gates for any phase that changes production code on both sides; lint, architecture, complexity/large-file, build, and integration-manifest gates where applicable.
- [ ] Run an independent adversarial implementation review for every code phase and the foreground pre-commit hook under the repository Node/npm versions. Record commands, counts, PRs, merge SHAs, target workflows, cleanup receipts, and rejected comments in this plan.
- [ ] Mark findings resolved only after their merge and exact target CI pass. Commit the completed delivery record through a verified closeout PR if it changes after the last code merge. Keep the running stack unchanged until a fresh whole-repository scrub reaches zero P0–P2 findings.

Completion requires all five findings resolved in `origin/main`, no unreviewed behavior expansion, clean phase verification, and target CI for every phase. A fresh complete rescrub remains mandatory and this plan cannot close the outer loop.
