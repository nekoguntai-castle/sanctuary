# Bug scrub loop iteration 3: invalidate stale auth bootstrap

Source target: `1b8f4bac6783ce7b4e15233facbe8ff344257663` (`origin/main`). Scope: whole repository. Finding: `user-context--auth-bootstrap-after-logout` (P2).

## Goal and evidence

A delayed successful `/auth/me` response must not restore authenticated UI after the session has been cleared. `useAuthBootstrap` unconditionally resets preference tracking and calls `setUser` after awaiting `getCurrentUser` (`src/contexts/useUserAuthLifecycle.ts:28-44`). The terminal logout listener clears user state but leaves the bootstrap request eligible to write afterward (`src/contexts/UserContext.tsx:30-43`). `refresh.ts` fires that listener on a cross-tab logout. Existing UserContext tests cover hydration and a broadcast after hydration separately, not their overlap.

## Assumptions and limits

- The provider owns one browser session view. A generation counter held in a provider ref can invalidate pending bootstrap writes synchronously when auth state changes; no API request cancellation or backend contract change is required.
- Preserve cookie-based auth, normal 401 boot behavior, non-401 logging, preference tracking, query-cache clearing, and existing explicit logout behavior.
- Invalidate only on terminal logout and intentional successful auth transitions; do not globally suppress future fresh-provider bootstraps. Settling `isLoading` on terminal logout is required when the stale bootstrap's `finally` is ignored.
- Keep the change inside `UserProvider`, auth lifecycle/actions helpers, and behavioral tests. No server, schema, or migration changes.

## Phase 1 — one mergeable application PR

- [ ] Add a deferred `/auth/me` regression in `tests/contexts/UserContext.test.tsx`. Fire the captured terminal logout listener before resolving the old `/auth/me`, assert loading becomes false while the request is still pending, then resolve it and assert `user` remains null, `isAuthenticated` false, and the query cache stays clear. Show this test fails on current code.
- [ ] Add a provider-owned generation ref. Capture its value when bootstrap starts. Guard preference reset, `setUser`, and `finally` loading update with the captured generation and effect liveness; terminal logout increments the generation synchronously before clearing state and sets loading false.
- [ ] Prevent a pending old bootstrap from overwriting a successful login, 2FA verification, or registration outcome, including the pending-email-verification response that deliberately leaves `user` null and sets a notice. Invalidate the generation at the successful transition before changing user state. Explicit logout success must invalidate even if the mocked `triggerLogout` does not call the listener. Keep failed auth attempts and 401 boot behavior coherent.
- [ ] Add focused overlap tests for login, 2FA, and both registration outcomes, plus unmount cleanup where needed to preserve the frontend coverage gate. Review that the same guard excludes stale preference resets; test that side effect if it can be observed behaviorally without mirroring the implementation. Re-read state ordering and the diff for error-path regressions and unintended scope.

Acceptance: after logout, a stale `/auth/me` success cannot authenticate the UI or reset preference tracking. A fresh mount still hydrates normally; login, 2FA, registration, 401 boot, and logout behavior remain correct.

## Verification and delivery

1. Focused tests: `npx vitest run tests/contexts/UserContext.test.tsx tests/contexts/useUserAuthActions.test.ts`, with the stale-response regression red before production edits and green after.
2. Required local gate: `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run && npm run test:coverage`; run relevant architecture/lint checks. Use project Node 24.21.0/npm 12.0.2.
3. Run adversarial implementation review and pre-commit hook. Deliver one PR through `pr-delivery`; require all exact head checks, verified squash-merge ancestry, and five exact merge-SHA target workflows. Defer running-stack rebuild to final clean closeout.
4. Refresh `origin/main` and rescrub all eight original domains. Close the loop only when a complete pass finds zero P0-P2 findings.

Backout: revert the bounded PR if auth state transitions regress; no data migration or repair is needed. Rebuild the already-running local stack only after the final clean pass.
