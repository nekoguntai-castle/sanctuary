# ADR 0002: Frontend access-token refresh flow

- **Status:** Accepted
- **Date:** 2026-04-12
- **Accepted on:** 2026-04-12
- **Owner:** TBD
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/adr/0001-browser-auth-token-storage.md` (HttpOnly cookie migration), `src/api/client.ts`, `server/src/api/auth/tokens.ts`, `contexts/UserContext.tsx`

## Context

The Sanctuary web frontend has **no refresh flow at all** today:

- `src/api/client.ts` does not implement a 401 interceptor and does not call `/api/v1/auth/refresh`. A repository-wide grep for `/auth/refresh`, `refreshToken`, or `refreshAccessToken` returns zero hits outside `gateway/`, `server/`, and the test/docs files.
- `contexts/UserContext.tsx` does not handle token expiry. There is no scheduled refresh, no expiry tracking, and no visible UX for token expiry.
- `server/src/api/auth/tokens.ts:28-81` implements `POST /api/v1/auth/refresh` with refresh-token rotation, but it only has gateway/mobile callers. The browser path never exercises it.

The practical consequence is that a Sanctuary web user gets logged out silently 1 hour after login. Every API call after that point fails with 401, the UI surfaces opaque errors, and the only remedy is a manual page refresh + re-login. This is bad UX and a security smell: a user mid-task who hits silent expiry is more likely to take a less safe re-authentication shortcut (autofilling a password manager on a degraded page state, leaving devtools open, etc.).

ADR 0001 deliberately deferred this work as "a separate ADR" to keep its own scope tight. The user's "no cutting corners" guidance reversed that deferral: building HttpOnly cookies on top of a broken refresh UX means we ship hardened security on a degraded auth experience and pay for two migrations of `src/api/client.ts` instead of one. This ADR is the design document for the refresh flow that will be implemented in the same Phase 4 as the cookie migration.

What is **in scope:**
- Where the refresh token lives in the browser context (after ADR 0001 commits to HttpOnly cookies).
- When the client triggers a refresh (proactive vs reactive).
- How concurrent in-flight requests behave during a refresh (single-flight semantics).
- How multiple browser tabs coordinate so they do not race the refresh-token rotation lockout.
- How refresh failure surfaces to the user.
- Required tests on both sides.

What is **not** in scope:
- Mobile/gateway refresh behavior. The mobile clients call `/auth/refresh` with the refresh token in the request body and store it themselves; that path is unchanged.
- Refresh token revocation lists or admin "log out everywhere" actions. `server/src/api/auth/tokens.ts:131-160` already implements `logout-all`; that endpoint can be wired into the UI later if desired.
- Backend changes to the refresh token rotation algorithm. The existing rotation in `tokenRepository.rotateRefreshToken` stays as-is.
- 2FA. Pending2FA tokens are short-lived (5 minutes), live in React state, and are not subject to refresh.

## Decision drivers

1. **No mid-task logouts.** A user filling in a transaction send form, scrolling through transaction history, or watching a wallet sync should never get an unexpected 401 because the access token expired in the background.
2. **No silent failures.** When refresh genuinely cannot succeed (refresh token revoked, server down, network gone), the user must see a clear "your session expired, please log in again" path, not a wall of 401 errors.
3. **No double-refresh races.** Two browser tabs hitting the same wallet should not both call `/auth/refresh` and have the second one fail because rotation already invalidated the token. Refresh-token rotation is a security feature; the client must coordinate with itself, not weaken rotation.
4. **No corner-cut storage.** The refresh token never enters JavaScript reach. It lives in an HttpOnly, Secure, SameSite=Strict cookie scoped to the refresh path.
5. **Single source of truth for expiry.** The client should not guess when the access token expires; the server tells it explicitly on every auth response, and the client schedules accordingly.
6. **Testable.** Every refresh path must be exercisable in unit tests without timing dependencies. Scheduled refresh uses injectable timers; tab coordination uses an injectable BroadcastChannel.

## Options considered

### Option A — Reactive only: refresh on 401

The client makes requests as normal. When a request returns 401, the client calls `/auth/refresh`, then retries the original request. No proactive scheduling.

- **Pros:** Simplest implementation. No expiry tracking. No timers.
- **Cons:**
  - Every refresh costs the user one user-visible failed request (the one that triggered the 401). Even with a transparent retry, the latency is doubled for that request.
  - Concurrent requests around the expiry window all hit 401 simultaneously. Without single-flight coordination, every one of them triggers a refresh attempt.
  - WebSocket connections do not return HTTP 401; they just disconnect on token expiry. Reactive-only does not handle the WebSocket case at all.
- **When this is the right call:** A toy app with no WebSocket and no concurrency. Not Sanctuary.

### Option B — Proactive only: scheduled refresh before expiry

The client tracks the access-token expiry (from a server-provided `X-Access-Expires-At` response header), schedules a `setTimeout` to fire ~60 seconds before expiry, and refreshes preemptively. No 401 fallback.

- **Pros:** No user-visible failed requests in the happy path. WebSocket connections survive because the cookie rotates before the access token is actually invalidated.
- **Cons:**
  - If the user puts the laptop to sleep and wakes it up after the access token has already expired, the scheduled timer fires late and the next request sees a 401 with no fallback. Result: silent logout in exactly the case the user is most annoyed by.
  - Clock drift between client and server, or a slow `/auth/refresh` round-trip, can cause the proactive refresh to land *after* expiry occasionally.
- **When this is the right call:** A long-lived single-page app on a kiosk that never sleeps. Not Sanctuary.

### Option C — Proactive + reactive + BroadcastChannel-only coordination (REJECTED)

Track expiry from the `X-Access-Expires-At` header. Schedule a refresh ~60 seconds before expiry. **Also** intercept 401 responses, run a refresh, and retry the original request once. Both paths share a single-flight refresh promise so concurrent triggers do not stack within one tab. Use BroadcastChannel as the cross-tab coordination primitive: when tab A starts a refresh it broadcasts `refresh-start`, and other tabs are expected to defer their own refreshes when they hear it.

- **Pros:**
  - Same happy path / sleep-and-wake path as the recommended option below.
  - BroadcastChannel is trivial to mock in vitest+jsdom.
- **Fatal flaw — cross-tab race window:**
  - BroadcastChannel is asynchronous pub/sub, **not** mutual exclusion. Tab A and tab B can both decide to refresh at the same instant (both their scheduled timers fire simultaneously, or both intercept a 401 from concurrent failed requests). Tab A starts its refresh and posts `refresh-start`; tab B starts its refresh microseconds later, before the message is delivered to tab B's event loop. Both tabs send `POST /auth/refresh` with the same refresh token cookie.
  - The server processes tab A first: it rotates the refresh token, invalidates the old one, returns success. Tab B's request arrives moments later carrying the now-invalidated token (the browser had not yet re-attached the rotated cookie to the in-flight request), and the server returns 401.
  - Tab B treats its 401 as terminal refresh failure and triggers logout. The user gets logged out of one tab even though their auth state is otherwise fine.
  - "Await one tick and trust the cookie has been rotated" is not a coordination primitive. There is no event-loop bound that guarantees the broadcast has been delivered to other tabs before they make their own refresh decision.
- **Why this matters even at low contention:** the race only needs to fire once to log a user out. With proactive scheduling firing on a deterministic 60-second-before-expiry boundary, multiple tabs converge on the same instant by construction. This is not a rare edge case; it is what happens every time a user has more than one tab open.
- **When this is the right call:** Never. The race violates the "no double-refresh races" decision driver.

### Option D — Server-tolerated double refresh

Same as Option C but the **server** allows the same refresh token to be presented twice within a small window (e.g., 30 seconds). The client does not need tab coordination.

- **Pros:** No client-side coordination needed. Simpler frontend.
- **Cons:**
  - Weakens refresh-token rotation. The whole point of rotation is that the second use of a token detects theft. Tolerating double-use removes the detection.
  - Couples the rotation invariant to a magic time window that is the wrong place to make a security/availability trade-off — it should be made on the client where the timing is observable, not on the server where it is implicit.
- **When this is the right call:** Never, for Sanctuary. The codebase health assessment is explicit about preserving rotation as a security primitive.

### Option E — Proactive + reactive + Web Locks API for mutual exclusion + BroadcastChannel for state propagation (RECOMMENDED)

Same proactive-plus-reactive shape as Option C, but the cross-tab coordination uses `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, ...)` as the actual mutex. Only one tab in the same origin holds the lock at a time. Other tabs that try to acquire the lock queue (or abort, depending on the lock options). After the holding tab finishes its refresh and releases the lock, the next tab acquires it, re-checks whether refresh is still needed against its in-memory `accessExpiresAt` (which has been updated by the broadcast handler), and skips the refresh if the token is already fresh.

BroadcastChannel is still used — but only for **state propagation**, never for mutual exclusion:
- `refresh-complete` carries the new `expiresAt` so other tabs update their scheduled timers without needing to acquire the lock themselves.
- `logout-broadcast` propagates terminal failure / explicit logout to all tabs so the whole browser context logs out together.
- There is intentionally no `refresh-start` event in the recommended option. The Web Lock is the only start signal. Adding `refresh-start` would invite future code to treat it as a coordination primitive, which is exactly the failure mode this revision exists to prevent.

- **Pros:**
  - Web Locks is a real OS-level mutex. The browser guarantees that no two tabs hold the same exclusive lock simultaneously. This eliminates the Option C race window by construction, not by hope.
  - 95.5% global browser support per caniuse: Chrome 69+, Firefox 96+, Safari 15.4+, Edge 79+. All Sanctuary deployment targets covered.
  - The `refresh-complete` broadcast still gives us cross-tab state propagation (so the second tab to acquire the lock can short-circuit).
  - Clean separation of concerns: Web Locks for "exactly one tab does the work," BroadcastChannel for "tell everyone the result."
- **Cons:**
  - `navigator.locks` is not part of jsdom by default. Tests need either a polyfill (e.g., `web-locks-polyfill`) or a small vitest mock that implements the contract — a Map of held lock names with FIFO waiters. The mock is straightforward (~30 lines) and the cost is one-time.
  - Two coordination primitives instead of one. Mitigated by the strict role separation above (one for exclusion, one for propagation) and by encapsulating both behind a single `refreshAccessToken()` function.
- **When this is the right call:** Default. This is the only option of the five that *actually* prevents the cross-tab race.

## Decision

**Adopt Option E: proactive scheduled refresh + reactive 401 interceptor + single-flight refresh promise + Web Locks API for cross-tab mutual exclusion + BroadcastChannel for state propagation only.**

This is a revision from the earlier draft of this ADR which recommended Option C. Codex review caught that BroadcastChannel-as-mutex has a race window and does not actually serialize cross-tab refreshes. Web Locks is the only primitive listed that provides real mutual exclusion across same-origin tabs.

Concretely:
- The server returns an `X-Access-Expires-At` ISO 8601 timestamp header on every auth response (`/auth/login`, `/auth/2fa/verify`, `/auth/refresh`, `/auth/me`).
- The client tracks the latest known expiry in module-scoped memory (not in any persistent storage; the cookie itself is the source of truth, the expiry header is the schedule hint).
- A `setTimeout` fires at `expiry - 60s` and triggers a refresh.
- The `request` function in `src/api/client.ts` intercepts 401s, calls the same single-flight refresh, and retries the original request once. If the retry also returns 401, it surfaces as a normal error and the user is logged out.
- Refresh is wrapped in a single-flight promise within a single tab: if a second trigger arrives while a refresh is in flight, it awaits the existing promise instead of starting a new one.
- **Cross-tab coordination uses Web Locks API as the mutex.** `refreshAccessToken()` calls `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, async () => { ... })`. Only one tab in the same origin holds the lock at a time; the browser handles queuing.
- **Inside the lock**, the holding tab re-checks freshness before issuing the refresh:
  - If `accessExpiresAt > Date.now() + REFRESH_LEAD_TIME_MS`, another tab already refreshed (and the broadcast handler updated this tab's in-memory state during the wait). Return without making a network call.
  - Otherwise, send `POST /api/v1/auth/refresh` (with `credentials: 'include'`), parse the response, update `accessExpiresAt`, and broadcast `refresh-complete`.
- **BroadcastChannel `sanctuary-auth` is used for state propagation only**, never for mutual exclusion:
  - On `refresh-complete` from another tab, update the local `accessExpiresAt` from the broadcast payload and reschedule the local refresh timer.
  - On `logout-broadcast` from another tab (terminal refresh failure or explicit logout), trigger the local logout flow.
  - There is no `refresh-start` event. The Web Lock is the start signal.

Refresh token storage and lifetime:
- Refresh token lives in a separate HttpOnly, Secure, SameSite=Strict cookie named `sanctuary_refresh`, with `Path=/api/v1/auth/refresh` so the cookie is **never** sent to any other endpoint.
- Refresh token TTL: **7 days**, matching the existing implicit value baked into `server/src/api/auth/tokens.ts` rotation logic. This is configurable via existing JWT/session config but the default stays 7 days.
- Refresh token rotation on every use is preserved (already implemented at `server/src/api/auth/tokens.ts:67`).

### Why the lock alone is sufficient for correctness

Correctness comes from the Web Lock plus the cookie jar update timing — the freshness check is only a performance optimization on top.

**Cookie jar update timing.** When a fetch response arrives, the browser's network stack processes any `Set-Cookie` headers as part of response handling, before the JavaScript fetch promise resolves. By the time tab A's `await fetch('/auth/refresh')` resolves, the rotated refresh cookie is already in the shared cookie jar. Tab A then runs its post-fetch logic (broadcast, schedule update) and returns from the lock callback. The lock release happens after the callback returns. **Tab B's callback is therefore guaranteed to run with the rotated cookie already in the jar.**

**Pessimistic walk-through (no broadcast assumption).** Assume the worst case: tab B's broadcast handler has not yet fired when tab B's lock callback runs.

1. Tab A and tab B both have valid refresh cookies. Their scheduled timers are aligned (both fire at `expiresAt - REFRESH_LEAD_TIME_MS`).
2. Tab A's timer fires; tab A acquires the Web Lock.
3. Tab B's timer fires microseconds later; tab B's `navigator.locks.request(...)` call **queues** behind tab A. Tab B's callback is not invoked yet.
4. Tab A inside the lock: `accessExpiresAt` is stale. Freshness check fails. Tab A sends `POST /auth/refresh`. Server rotates the token, sets the new cookies, returns the new expiry header. The browser updates the cookie jar before tab A's `await fetch` resolves. Tab A updates its local `accessExpiresAt`, broadcasts `refresh-complete`, returns from the callback. Lock releases.
5. Tab B's lock callback is invoked. Tab B's broadcast handler has not yet run, so tab B's in-memory `accessExpiresAt` is still stale. Freshness check fails. Tab B sends `POST /auth/refresh`. The browser auto-attaches the **rotated** cookie (tab A's response already updated the jar). Server validates the new token, rotates again, returns the new-new expiry. Tab B updates `accessExpiresAt`, broadcasts `refresh-complete`, returns.
6. Both broadcasts eventually fire and reach the other tab's handlers, which update each tab's local schedule with the latest expiry.

Result: two `POST /auth/refresh` calls instead of one (wasteful), but correct — no 401, no race, no logout. The lock guarantees that the second call sees a rotated cookie, not the same one tab A used.

**Optimistic walk-through (broadcast arrives in time).** If tab B's broadcast handler runs before tab B's lock callback (which is the common case, because the broadcast is queued onto the event loop while tab B is waiting on the lock and tab B's callback is also queued via the same event loop), tab B's `accessExpiresAt` is already up-to-date when its callback runs. The freshness check passes and tab B short-circuits without making a network call. Result: one `POST /auth/refresh` call across both tabs.

Both walk-throughs result in correct behavior. The freshness check converts the wasteful two-call case into a one-call case when timing cooperates, but is not load-bearing for correctness.

## Consequences

### Positive

- Users no longer get silent 1-hour logouts. The happy path is invisible refresh; the sleep-and-wake path is one slightly-slow request followed by success.
- WebSocket connections survive token rotation because the cookie rotates before the access token expires (or, on the 401 fallback path, the WS reconnects after refresh).
- Concurrent requests during the expiry window do not stack refreshes.
- Multiple tabs do not race rotation lockout.
- The refresh token never enters JavaScript reach; XSS cannot exfiltrate it. Combined with ADR 0001's HttpOnly access cookie, this gives full persistence resistance.
- The `X-Access-Expires-At` header is single source of truth — the client never guesses.
- Logout state is broadcast across tabs: when one tab logs out, all tabs follow.

### Negative

- New `navigator.locks` mocking surface in `tests/setup.ts`. jsdom does not implement Web Locks. Either polyfill via `web-locks-polyfill` or write a small vitest mock that maintains a Map of held lock names with FIFO waiters (~30 lines, supports the contract used by `refreshAccessToken`). The mock must also support multi-instance "tabs" so the cross-tab race tests can simulate two clients contending for the same lock name.
- New BroadcastChannel mocking surface in `tests/setup.ts`. BroadcastChannel is also not in jsdom and needs a polyfill or vitest mock that supports multi-instance same-channel pub/sub. Less complex than the Web Locks mock but still net-new.
- New module-scoped state in `src/api/client.ts` (the expiry timestamp, the single-flight promise, the BroadcastChannel handle, the Web Lock acquisition). This is mockable via test resets but it does mean `client.ts` is no longer purely stateless on the auth surface.
- The 401 interceptor introduces request retry logic. The retry is bounded (one attempt) and only fires when the failure is auth-related, but it adds branching in the request path that needs explicit testing for non-401 failures, retry success, and retry failure.
- The scheduled timer must be cleared on logout, on tab-hidden, and on test teardown to avoid leaking timers (which would compound into the kind of vitest worker teardown race we just fixed in `tests/setup.ts`).
- An `X-Access-Expires-At` header on every auth response means the backend touches one more thing per response. Trivial, but it must be added uniformly; missing it on one endpoint produces a stale schedule.
- Two coordination primitives (Web Locks for exclusion, BroadcastChannel for state propagation) means two integration points to keep correct. Mitigated by encapsulating both inside `refreshAccessToken()` so callers never see them directly.

### Neutral

- Mobile gateway path is unchanged. Mobile clients call `/auth/refresh` with the refresh token in the request body and store the response themselves, exactly as today.
- The `POST /api/v1/auth/refresh` route signature on the backend is extended to *also* read the refresh token from the `sanctuary_refresh` cookie when the body field is absent, but the body field stays for mobile/gateway compatibility.
- The 2FA temporary-token flow is unchanged.

## Migration plan

This work merges into ADR 0001's Phase 4 (frontend), which becomes the largest phase of the combined cookie + refresh migration. The implementation steps below are listed as a checklist for that phase.

1. **Server-side `X-Access-Expires-At` header.**
   - Update `server/src/api/auth/login.ts:298-312`, `server/src/api/auth/twoFactor/verify.ts:96-101`, `server/src/api/auth/tokens.ts:60-79`, and `server/src/api/auth/profile.ts:35-39` to set `X-Access-Expires-At` with the access token's expiry as an ISO 8601 string.
   - Add server tests: every auth response carries the header.

2. **Server-side refresh cookie reading.**
   - `server/src/api/auth/tokens.ts:28-81` — when the request body has no `refreshToken`, read it from the `sanctuary_refresh` cookie.
   - When a refresh succeeds, set new `sanctuary_access` (path `/`) and `sanctuary_refresh` (path `/api/v1/auth/refresh`) cookies.
   - Add server tests: cookie-only refresh succeeds; body-only refresh still succeeds (mobile path); both present uses the cookie.

3. **Frontend refresh primitive with Web Lock + freshness check.**
   - New module: `src/api/refresh.ts` (or co-located in `src/api/client.ts` if the file size budget allows). Exports `refreshAccessToken()` returning a promise.
   - Within a single tab, `refreshAccessToken()` is single-flight: concurrent callers receive the same in-flight promise so the lock acquisition itself is not duplicated.
   - The single-flight promise wraps `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, async () => { ... })`.
   - Inside the lock callback:
     - **Freshness check first:** if `accessExpiresAt > Date.now() + REFRESH_LEAD_TIME_MS` (where `REFRESH_LEAD_TIME_MS = 60_000`), another tab already refreshed during the lock wait. Return immediately. Do not make a network call.
     - Otherwise, send `POST /api/v1/auth/refresh` with `credentials: 'include'` and the CSRF header.
     - On success, parse `X-Access-Expires-At`, update the in-memory `accessExpiresAt`, broadcast `refresh-complete` with the new expiry, and reschedule the local timer.
     - On failure, broadcast `logout-broadcast` and reject the promise so the caller (the 401 interceptor or the scheduled timer) can trigger the logout flow.
   - The lock release happens automatically when the callback returns or throws.

4. **Frontend scheduled refresh.**
   - On every successful auth response (`/auth/login`, `/auth/2fa/verify`, `/auth/refresh`, `/auth/me`), parse `X-Access-Expires-At` and schedule a `setTimeout` for `expiresAt - REFRESH_LEAD_TIME_MS` to call `refreshAccessToken()`.
   - Clear the previous timer before scheduling a new one.
   - Clear the timer on logout.

5. **Frontend reactive 401 interceptor.**
   - In `src/api/client.ts:request`, when a response status is 401 and the request was not already a retry, await `refreshAccessToken()` and replay the original request once.
   - If the retry also fails with 401, do not retry again — surface the error and trigger logout.
   - Non-401 failures (5xx, network) bypass the refresh path entirely.

6. **Frontend BroadcastChannel state propagation.**
   - On client init, open `new BroadcastChannel('sanctuary-auth')`.
   - On `refresh-complete` from another tab, update the local `accessExpiresAt` from the broadcast payload and reschedule the local refresh timer. **Do NOT use this as a coordination signal** — the Web Lock is the coordination primitive.
   - On `logout-broadcast` from another tab, trigger the local logout flow.
   - Close the channel on `beforeunload`.
   - Note: there is intentionally no `refresh-start` event. Earlier drafts of this ADR used `refresh-start` as a "stop, another tab is refreshing" signal; that approach was rejected because BroadcastChannel is async pub/sub and does not provide mutual exclusion.

7. **Frontend logout flow.**
   - `contexts/UserContext.tsx` wraps the logout call so it: clears the scheduled refresh timer, broadcasts `logout-broadcast`, redirects to login.
   - Both terminal refresh failure (401 on `/auth/refresh`) and explicit user logout share this path.

8. **Test setup.**
   - Add a `navigator.locks` polyfill to `tests/setup.ts` (or write a vitest mock). The mock must:
     - Implement `request(name, options, callback)` returning a promise.
     - Maintain a Map of held lock names with FIFO waiters per name.
     - Support `mode: 'exclusive'` (the only mode this ADR uses).
     - Allow tests to instantiate multiple "tab" contexts that share the same lock state, so the cross-tab race tests can simulate two clients contending for the same lock.
   - Add a BroadcastChannel polyfill or mock to `tests/setup.ts`. Must support multi-instance same-channel pub/sub.
   - Add a fake-timers harness for scheduled refresh tests.

## Required tests

Before this can move from Proposed to Accepted, the following test surfaces need to be added or updated.

### Backend
- `server/tests/unit/api/auth.test.ts` — every auth response carries `X-Access-Expires-At` with a valid ISO 8601 timestamp matching the JWT `exp` claim.
- `server/tests/unit/api/auth/tokens.test.ts` (new or extended) — refresh from cookie alone, refresh from body alone, refresh with both (cookie wins), refresh sets new cookies on success, refresh clears cookies on failure (revoked refresh token).
- `server/tests/unit/api/auth/profile.test.ts` — `/auth/me` response includes `X-Access-Expires-At`.
- `server/tests/integration/flows/auth.integration.test.ts` — full login → cookie issued → refresh from cookie → new cookies issued → expired refresh token revokes cleanly.

### Frontend
- `tests/api/client.test.ts` — `request()` parses `X-Access-Expires-At` from auth responses and updates internal state.
- `tests/api/refresh.test.ts` (new) — within-tab single-flight: two concurrent `refreshAccessToken()` calls return the same promise; the underlying fetch is called exactly once; the Web Lock is acquired exactly once.
- `tests/api/refresh.test.ts` — proactive refresh: with fake timers, advancing past `expiresAt - REFRESH_LEAD_TIME_MS` triggers a refresh exactly once; the new expiry is honored; the timer reschedules itself for the next interval.
- `tests/api/refresh.test.ts` — reactive refresh: a 401 response triggers a refresh and retries the original request; retry success surfaces normally; retry failure surfaces the second 401 and triggers logout.
- `tests/api/refresh.test.ts` — non-401 failures are not refresh-triggering; e.g., a 500 returns immediately without a refresh attempt.
- `tests/api/refresh.test.ts` — **cross-tab Web Lock serialization (the test that catches the bug Codex flagged):** simulate two tabs sharing the same lock state. Both tabs trigger `refreshAccessToken()` simultaneously. Assert that exactly one `POST /auth/refresh` is sent across both tabs (the second tab waits on the lock, sees fresh `accessExpiresAt` after the broadcast handler ran, and short-circuits).
- `tests/api/refresh.test.ts` — cross-tab race with stale broadcast: same setup, but the broadcast handler is delayed (simulated). Assert that the second tab still sends its refresh (since its in-memory state was stale) and the second refresh succeeds (the rotated cookie is used). Assert that no logout fires — this is the "wasted refresh but not broken" path.
- `tests/api/refresh.test.ts` — BroadcastChannel state propagation: a `refresh-complete` message from another tab updates the local `accessExpiresAt` and reschedules the local timer. A `logout-broadcast` message triggers the local logout flow.
- `tests/api/refresh.test.ts` — terminal refresh failure: server returns 401 on `/auth/refresh` (revoked refresh token). Assert the lock is released, `logout-broadcast` is sent, and the local logout flow fires.
- `tests/contexts/UserContext.test.tsx` — logout clears the scheduled refresh timer and broadcasts `logout-broadcast`.
- `tests/contexts/UserContext.test.tsx` — on app boot, `/auth/me` is called; if it succeeds, the user is hydrated and the refresh timer is scheduled; if it returns 401, the login screen is rendered.

### Cross-cutting
- `tests/setup.ts` — `navigator.locks` mock that maintains a Map of held lock names with FIFO waiters and supports multi-instance "tab" simulation. Mock must not require a network or filesystem; pure in-memory.
- `tests/setup.ts` — BroadcastChannel polyfill or mock that supports multi-instance pub/sub.
- All existing `apiClient.setToken` test references are removed; the auth state derives from `/auth/me` instead.
- The 100% frontend coverage gate stays green for the new refresh module and all branches of the 401 interceptor, including the freshness short-circuit branch and the lock-held-by-another-tab branch.

## Open questions

These are deliberately left open. They should be answered before implementation starts in Phase 4, not as part of this ADR.

1. **Refresh lead time.** 60 seconds before expiry is the recommended default. If round-trip latency to `/auth/refresh` is consistently above ~5 seconds in production, the lead time may need to grow. Confirm 60s is fine for the deployment topology, or pick a different value.
2. **Refresh token TTL.** 7 days is the recommended default. If the security policy requires shorter (e.g., 24h for paranoid deployments), surface this as an env var and document it in `OPERATIONS_RUNBOOKS.md`.
3. **WebSocket reconnect on refresh.** The cookie rotation rotates the access token, but existing WebSocket connections were authenticated with the *previous* token. In practice the previous token is still valid in `server/src/utils/jwt.ts` until its original `exp` claim, so the WS does not need to reconnect immediately. Confirm this is true in `server/src/utils/jwt.ts` and document the assumption. If not, the client must reconnect WS after refresh.
4. **Logout-all UI hook.** The backend already has `POST /api/v1/auth/logout-all` (`server/src/api/auth/tokens.ts:131-160`). This ADR does not add a UI for it but the implementation should make it trivial to wire up later (the BroadcastChannel `logout-broadcast` path is already the right primitive).
5. **Page Visibility API.** Should we *defer* scheduled refresh while the tab is hidden and run it on visibility change instead? This is a small UX improvement (no refresh while the user is not looking) but it interacts with WebSocket reconnect timing. Defer this question to implementation time.
