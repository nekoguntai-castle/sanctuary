# ADR 0001: Browser auth token storage

- **Status:** Accepted
- **Date:** 2026-04-12
- **Accepted on:** 2026-04-12
- **Owner:** TBD
- **Supersedes:** none
- **Superseded by:** none
- **Related ADRs:** `docs/adr/0002-frontend-refresh-flow.md` (Accepted) — the missing frontend refresh flow that this ADR initially deferred and now implements jointly.
- **Related:** `docs/plans/codebase-health-assessment.md` (Security row, Phase 4 hygiene), `src/api/client.ts`, `server/src/api/auth/login.ts`, `server/src/api/auth/tokens.ts`, `server/src/websocket/auth.ts`

## Context

The Sanctuary web frontend stores its access token in browser-readable storage:

- `src/api/client.ts:137-211` reads the token from `sessionStorage` by default and supports `VITE_AUTH_TOKEN_STORAGE=memory` (in-process only) and `VITE_AUTH_TOKEN_STORAGE=local` (durable `localStorage`) as opt-in modes. The same module migrates legacy `localStorage` tokens into `sessionStorage` on first read so existing sessions survive the previous default change.
- `src/api/client.ts:264-503` attaches the token as `Authorization: Bearer <token>` on every fetch, blob fetch, download, and upload.
- The frontend has **no refresh flow at all**: no `/auth/refresh` callers exist outside `gateway/`, no 401 interceptor exists in `client.ts`, and `contexts/UserContext.tsx` does not handle token expiry. Access tokens silently expire after their 1-hour TTL and the user gets opaque request failures until the next manual login.
- `server/src/api/auth/tokens.ts:28-81` exists and rotates refresh tokens, but only the mobile gateway path uses it.

The codebase health assessment grades security at **B** and identifies the script-readable token as the last blocker before A-grade browser token handling. The accepted threat model entry that drives this ADR is XSS-via-malicious-dependency or XSS-via-malicious-user-content: any code that runs in the browser context can read `sessionStorage`, exfiltrate the token, and impersonate the user for the remainder of its TTL on a separate device. Because Sanctuary holds Bitcoin wallet authority, an attacker with a stolen access token can read balances, queue draft transactions, and observe sync activity even though they cannot sign without a hardware wallet.

What is **not** in scope for this decision:
- The mobile gateway path. `gateway/src/middleware/auth.ts` requires `Authorization: Bearer` and the cross-origin `gateway/src/services/backendEvents/auth.ts` HMAC envelope from `shared/utils/gatewayAuth.ts`. Mobile clients cannot use browser cookies; that path stays unchanged regardless of the option chosen.
- The internal gateway-to-backend HMAC layer. It is independent of user tokens.
- 2FA temporary tokens. They live in `contexts/UserContext.tsx` React state for ≤5 minutes and never touch `sessionStorage`. Their flow is unchanged by any option below.

## Decision drivers

1. **Reduce script-readable token exposure.** Eliminating `sessionStorage`/`localStorage` token reads is the headline security improvement.
2. **Do not break the mobile gateway path.** Mobile clients on a different origin cannot send same-site cookies; the backend must still accept `Authorization: Bearer` for the gateway-mounted routes.
3. **Keep the WebSocket auth path simple.** `server/src/websocket/auth.ts:25-72` already pins `TokenAudience.ACCESS` and rejects `pending2FA`. Whatever option we pick must work with same-origin upgrade requests without rewriting the auth state machine.
4. **Match the size of the change to the size of the team.** Sanctuary does not have a dedicated security engineer. A change that requires extensive net-new server middleware (CSRF, session store, cookie introspection in WebSocket upgrades) costs more to review and maintain than one that touches a smaller surface.
5. **Preserve the 1-hour access-token TTL.** Shortening it would push the missing refresh flow onto the critical path of this ADR; that is a separate decision and should not be conflated.

## Options considered

### Option A — Status quo: session-scoped storage with explicit modes

Keep `sessionStorage` as the default, with `VITE_AUTH_TOKEN_STORAGE=memory` for deployments that want to reduce exposure further at the cost of forcing re-login on every reload.

- **Pros:** Zero backend changes. No CSRF middleware required. Mobile path identical. Already shipped and tested.
- **Cons:** Token remains script-readable. Any XSS — even from a transitively introduced dependency — exfiltrates a 1-hour bearer token. The codebase health plan correctly calls this the last B-grade security gap.
- **When this is the right call:** If we judge that the audit gates around dependencies and the existing CSP are sufficient defense-in-depth, and the cost of cookie+CSRF infrastructure outweighs the marginal XSS risk reduction.

### Option B — HttpOnly cookies for the access token, with `SameSite=Strict` and double-submit CSRF

Move the access token into a single HttpOnly, Secure, SameSite=Strict cookie set by `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` (when we eventually add a frontend caller). The browser sends the cookie automatically on same-origin requests; the frontend stops storing or sending the token at all. Add a CSRF middleware that issues a non-HttpOnly token on the auth response (a separate readable cookie or a response body field) and requires the client to echo it in an `X-CSRF-Token` header on state-changing requests. WebSocket upgrades on the same origin receive the cookie automatically; `server/src/websocket/auth.ts` is updated to pull the token from the upgrade request's cookie header in addition to the existing Authorization header path.

- **Pros:**
  - Token is not script-readable; XSS cannot directly exfiltrate the bearer.
  - Browser handles cookie attachment, so `client.ts` shrinks: storage helpers, `setToken`, the legacy migration block, and `Authorization` header injection all go away for the browser path.
  - WebSocket upgrade automatically carries the cookie on same-origin connections.
  - Mobile gateway path is unaffected because the gateway is on a different origin and the gateway middleware still consumes `Authorization: Bearer`.
- **Cons:**
  - Adds two dependencies the codebase does not currently use: `cookie-parser` (or equivalent) and a CSRF middleware. Both are widely understood, but each is a new auditable surface.
  - The backend must distinguish browser callers (cookie + CSRF token) from gateway callers (`Authorization` header). Cleanly modeling this avoids accidentally dropping the CSRF requirement for browser routes.
  - CSP is not enough to defeat all XSS, and HttpOnly cookies are not enough to defeat all token theft (an attacker who runs script in your origin can still issue authenticated requests via `fetch('/api/...', { credentials: 'include' })`). What HttpOnly buys is **persistence resistance**: the attacker cannot steal a long-lived credential and replay it from a different machine. For this codebase that is the threat we care about most.
  - Reverse-proxy / Compose deployments must guarantee Secure cookies work behind TLS termination. The existing Nginx config terminates TLS, so this is a configuration check, not a blocker.
- **When this is the right call:** Default. This is the option the rest of this ADR recommends.

### Option C — HttpOnly cookies with `SameSite=Lax`

Same as Option B but with `SameSite=Lax`. Lax allows top-level navigation cookies to be sent on cross-site GET requests, which is friendlier to bookmarks and external links into the app.

- **Pros:** Slightly better UX for deep links into the app from external sites.
- **Cons:** Lax permits CSRF on top-level GET, which matters for any state-changing GET endpoints. Sanctuary should not have those, but enforcing "no state changes on GET" by code review is weaker than enforcing it by cookie policy.
- **When this is the right call:** If we discover deep-link breakage with Strict mode and cannot fix it at the link layer, this is the controlled fallback.

### Option D — Backend session store with opaque session-id cookie

Move JWT issuance behind a server-side session store (Redis-backed). The frontend gets only an opaque session-id cookie. Tokens never leave the server.

- **Pros:** Strongest revocation story (clear the session row, the token is dead instantly). Eliminates JWT entirely on the browser path.
- **Cons:** Big backend refactor. Adds a Redis dependency to the auth path that does not currently exist (Redis is used for queues and the WebSocket bridge, not auth). Replaces the established `server/src/utils/jwt.ts` audience model on the browser side and creates two parallel auth systems (sessions for browser, JWT for mobile/gateway). The maintenance burden of two systems is significant.
- **When this is the right call:** If we ever add a feature that requires instant session revocation across all devices (e.g., a "log out everywhere now" button that must be effective inside one second). At that point this becomes the right architecture.

### Option E — Hybrid: short-lived access token in memory, refresh token in HttpOnly cookie

Keep an access token in JavaScript memory (never in storage) with a short TTL — say 5 minutes. Put the long-lived refresh token in an HttpOnly cookie. On 401, the client calls `/auth/refresh` which reads the cookie, issues a new in-memory access token, and rotates the cookie.

- **Pros:** XSS gets at most a 5-minute access token; the long-lived credential never enters JavaScript reach.
- **Cons:**
  - Requires building the missing frontend refresh flow (interceptor on 401, request-queue-and-retry, tab-coordinated refresh to avoid races). That is the "multi-session refactor" the codebase health plan called out, plus more.
  - The access token is still script-readable for the 5-minute window, so the attacker can still issue authenticated requests during that window — same as Option B's "attacker runs `fetch` in-origin" caveat, just shorter.
  - Requires shortening the access-token TTL, which is a separate decision that affects the gateway path too.
- **When this is the right call:** If we conclude that **persistence** is the only thing that matters and we want belt-and-suspenders, this is the most defensive option. The ADR recommends Option B over this because Option B already kills persistence with much less code.

## Decision

**Adopt Option B: HttpOnly, Secure, SameSite=Strict cookie for the access token, with a double-submit CSRF token on state-changing requests, and same-origin cookie reads in the WebSocket upgrade handler.**

Rationale:
- It directly closes the threat we care about (long-lived bearer theft via XSS) at the smallest cost.
- It does not require building a frontend refresh flow that does not exist today; the access token TTL stays at 1 hour.
- It does not touch the mobile gateway path or the gateway HMAC layer.
- WebSocket auth changes are additive (read the cookie if no `Authorization` header is present).
- Option D is the right destination if we ever need instant cross-device revocation. This ADR does not preclude moving to D later — Option B's session can become a session-id behind D's session store without changing the frontend.

## Consequences

### Positive

- The access token is no longer in `sessionStorage` or `localStorage`. XSS cannot exfiltrate a long-lived bearer.
- `src/api/client.ts` shrinks meaningfully: `TokenStorageMode`, `getTokenStorageMode`, `getBrowserStorage`, `getPrimaryTokenStorage`, `readStoredToken`, `writeStoredToken`, the legacy migration block, and the `Authorization` header injection in `request`/`fetchBlob`/`download`/`upload` all collapse into "send `credentials: 'include'` and an `X-CSRF-Token` header."
- `VITE_AUTH_TOKEN_STORAGE` becomes unused on the browser path and can be removed after the migration window.
- Tests in `tests/api/client.test.ts` covering storage mode switching collapse into tests that verify the client sends `credentials: 'include'` and the CSRF header.
- The codebase health assessment's Security row can move from B to A on browser token handling.

### Negative

- New backend dependencies: `cookie-parser` (or `cookie` directly) and a CSRF library. Both are small and well-audited but they are new code to review and keep current.
- The login response shape changes: tokens are no longer in the response body; they are in a Set-Cookie header. Existing tests for `server/src/api/auth/login.ts:187-313`, `server/src/api/auth/twoFactor/verify.ts:33-140`, and `server/src/api/auth/tokens.ts:28-125` need updating.
- The backend must support **two** browser-callable routes shapes: the new cookie-based browser route and the existing `Authorization: Bearer` mobile/gateway route. The cleanest way is to read the cookie in `server/src/middleware/auth.ts` first, fall back to the Authorization header second, and require the CSRF token only when the request authenticated via cookie.
- WebSocket auth gets a third token-source path (Authorization header → query parameter → cookie). The query parameter path is already deprecated in `server/src/websocket/auth.ts:62-69`; this is the right time to remove it.
- Reverse-proxy and Compose deployments must keep Secure cookies working behind TLS. The Nginx config in this repo already terminates TLS, but documentation in `docs/how-to/operations-runbooks.md` should call out the requirement.
- During the rollout window, users with active sessions in `sessionStorage` need a graceful migration. The simplest path: on the next API call, the legacy header still works (the backend keeps accepting both for one release), and the next login establishes the cookie.

### Neutral

- 2FA temporary tokens stay in React context state.
- Mobile gateway path is unchanged.
- Gateway HMAC layer is unchanged.
- The 1-hour access token TTL is unchanged. The missing frontend refresh flow remains a separate, documented gap to address in a future ADR.

## Migration plan

This is a sketch. The implementation should fit into multiple PRs, each independently revertible.

1. **Backend foundation.**
   - Add `cookie-parser` (or a hand-rolled cookie reader if the dependency budget is tight) and wire it into `server/src/index.ts`.
   - Add a CSRF middleware (e.g., `csrf-csrf` or a hand-rolled double-submit implementation) with a per-session secret.
   - Update `server/src/middleware/auth.ts` to accept the access token from a `sanctuary_access` cookie in addition to the existing `Authorization` header. When the request authenticated via cookie, also enforce the CSRF token.

2. **Backend response changes.**
   - `server/src/api/auth/login.ts` and `server/src/api/auth/twoFactor/verify.ts` set `sanctuary_access` (HttpOnly, Secure, SameSite=Strict) and a non-HttpOnly `sanctuary_csrf` cookie alongside the existing JSON token field. The JSON field stays for one release to allow rollback and to keep the gateway path unchanged.
   - `server/src/api/auth/tokens.ts` (logout) clears both cookies.
   - `server/src/api/auth/tokens.ts` (refresh) sets new cookies on each call.

3. **Backend WebSocket changes.**
   - `server/src/websocket/auth.ts:56-72` reads the cookie from the upgrade request when no Authorization header is present. The 2FA-rejection path at line 28 is unchanged because audience is checked at line 26.
   - Remove the deprecated query parameter token path in the same change. It has been deprecated long enough and removing it removes a token-leakage vector (referer headers, server logs).

4. **Frontend.**
   - `src/api/client.ts`: switch all fetch calls to `credentials: 'include'`. Remove `setToken`, `getToken`, the storage helpers, and the legacy migration. Add CSRF token reading from the `sanctuary_csrf` cookie and inject it as `X-CSRF-Token` on non-GET requests.
   - `contexts/UserContext.tsx`: stop calling `apiClient.setToken`. Login state derives from a `/auth/me`-style "is the cookie still good?" check, which already exists.
   - `tests/api/client.test.ts`: replace the storage mode tests with `credentials: 'include'` and CSRF header tests.

5. **Documentation.**
   - Update `docs/how-to/operations-runbooks.md` with the cookie/Secure/TLS requirement and the CSRF token rotation behavior.
   - Update `docs/reference/release-gates.md` to reference the cookie tests.
   - Mark this ADR's status as Accepted (not Proposed) when the work merges.

6. **Deprecation window and removal.**
   - One release after the cookie shipps, remove the JSON token field from `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` responses for browser callers. Mobile/gateway routes still receive the JSON token because they use a different mounted router.
   - Remove `VITE_AUTH_TOKEN_STORAGE` and the entire `TokenStorageMode` block from `src/api/client.ts`.

## Required tests

Before this can move from Proposed to Accepted, the following test surfaces need to be added or updated. None of these are large; they are listed so the implementer cannot forget them.

1. **Backend cookie attributes** — `server/tests/unit/api/auth/login.test.ts` (and 2FA-verify, refresh, logout): assert the `sanctuary_access` Set-Cookie header has `HttpOnly`, `Secure`, `SameSite=Strict`, the expected path, and the expected max-age.
2. **Backend CSRF enforcement** — `server/tests/unit/middleware/csrf.test.ts`: cookie-authenticated POST without `X-CSRF-Token` returns 403; with the wrong token returns 403; with the correct token succeeds. Authorization-header path is exempt.
3. **Backend dual auth** — `server/tests/unit/middleware/auth.test.ts`: cookie alone authenticates a browser request; Authorization header alone authenticates a gateway request; cookie without CSRF is rejected; Authorization header without CSRF is accepted.
4. **WebSocket cookie path** — `server/tests/unit/websocket/auth.test.ts`: the existing tests are extended so an upgrade request with a valid cookie and no Authorization header is accepted. The 2FA rejection test is unchanged.
5. **Frontend client** — `tests/api/client.test.ts`: every request includes `credentials: 'include'`; non-GET requests include `X-CSRF-Token`; legacy `setToken` and storage helpers are gone.
6. **Frontend integration** — A focused integration test that mounts a component making an authenticated call, simulates a cookie-bearing fetch response, and confirms the CSRF token is read from the readable cookie and echoed.
7. **Mobile/gateway regression** — `gateway/tests/unit/middleware/auth.test.ts`: the existing Authorization-header tests must continue to pass unchanged. The gateway path should not be affected by any of this work.
8. **OpenAPI** — `server/src/api/openapi/spec.ts` adds `cookieAuth` and `csrfToken` security schemes, and the relevant route schemas reference them. The existing `bearerAuth` scheme stays for the gateway-tagged routes.

## Open questions

These are deliberately left open. They should be answered before implementation, not as part of this ADR.

1. **Cookie name.** `sanctuary_access` and `sanctuary_csrf` are placeholders. The implementer can pick something shorter or namespaced if there is a project convention.
2. **CSRF library choice.** `csrf-csrf` is a modern double-submit implementation that does not require server-side state. A hand-rolled one is also viable. The audit cost of a third-party dependency vs. the maintenance cost of hand-rolled crypto is the trade-off.
3. **Cookie path.** Default `/`; consider scoping to `/api/v1/` if any non-API routes share the origin and should not see the cookie.
4. **Refresh flow.** Originally deferred. Reversed under the "no cutting corners" working rule: ADR 0002 (`docs/adr/0002-frontend-refresh-flow.md`) now defines the refresh flow and its implementation merges into Phase 4 of the migration plan in `tasks/todo.md`. The 1-hour access-token TTL stays; the refresh flow makes that TTL invisible to the user.
5. **`VITE_AUTH_TOKEN_STORAGE=memory` deployments.** Some deployers may have intentionally chosen the memory mode for paranoia. Document that the new model gives equivalent or better protection, and that they should remove the env var after upgrading.

## Resolution

**Status: implemented as of 2026-04-13.** Phases 1-4 of the migration plan in `tasks/todo.md` landed in the following commits on `main`:

- **Phase 1 — backend foundation:** `cookie-parser` and `csrf-csrf` wired into `server/src/index.ts`; `server/src/middleware/csrf.ts` (double-submit CSRF with lazy factory init); `server/src/middleware/authCookieNames.ts` (zero-import cookie-name constants); `server/src/middleware/auth.ts` extended with `extractAccessToken()` preferring Authorization header over cookie; `skipCsrfProtection` mirrors `extractTokenFromHeader` precedence so the bearer-header rollback path is not punished by CSRF.
- **Phase 2 — backend response cookies + expiry header:** `/auth/login`, `/auth/2fa/verify`, `/auth/refresh` set `sanctuary_access`, `sanctuary_refresh` (scoped to `/api/v1/auth/refresh`), and `sanctuary_csrf`. All auth responses set `X-Access-Expires-At` as ISO 8601. Refresh accepts cookie or body with **cookie wins when both present** (per ADR 0002 migration item 2). Terminal refresh failures call `clearAuthCookies()` before throwing; transient rotation-service 500s do **not** clear cookies. OpenAPI `cookieAuth` and `csrfToken` security schemes are in `server/src/api/openapi/spec.ts:118-140`.
- **Phase 3 — backend WebSocket cookie reading:** `server/src/websocket/auth.ts` reads `sanctuary_access` from the upgrade request's `Cookie` header via the `cookie` package's `parse()`; the deprecated `?token=` query parameter path is removed.
- **Phase 4 — frontend cookie auth + Web Locks refresh flow:** `src/api/client.ts` switched every fetch to `credentials: 'include'`, removed `TokenStorageMode`/`getTokenStorageMode`/`setToken`/`getToken`/legacy localStorage migration/Authorization header injection, added a `sanctuary_csrf` cookie reader that injects `X-CSRF-Token` on state-changing requests. `src/api/refresh.ts` implements single-flight + `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, ...)` + freshness check + BroadcastChannel state propagation (see ADR 0002 Resolution for details). `contexts/UserContext.tsx` boots via `/auth/me` unconditionally, subscribes to terminal-logout broadcasts, and logs out asynchronously so the backend revocation runs before redirect. The 401 interceptor exempt list was narrowed to the four credential-presentation endpoints (`/auth/login`, `/auth/register`, `/auth/2fa/verify`, `/auth/refresh`); `/auth/me`, `/auth/logout`, and `/auth/logout-all` now refresh-and-retry on 401 so valid-session recovery and server-side revocation both work.
- **Phase 4 race fixes:** `services/websocket.ts` `isServerReady` flag gates all four subscribe/unsubscribe mutators on the server's `'connected'` welcome message, not on `readyState === OPEN`, because the server runs `verifyWebSocketAccessToken` asynchronously inside `authenticateOnUpgrade`. `disconnect()` resets `isServerReady` synchronously before touching `this.ws` so async close-event delivery cannot leave the flag stale on a null socket. See `tasks/lessons.md` "Pre-attached message handlers and welcome-message synchronization for async-auth WebSockets."

**Codex stop-time review caught and fixed the following bugs before merge:**
- Refresh precedence inverted (was body-wins, fixed to cookie-wins) and missing `clearAuthCookies()` on terminal failure paths.
- `clearAuthCookies()` added to the rotation-null 500 path was then removed because that is a transient server failure — clearing would punish the client for a server bug.
- CSRF `skipCsrfProtection` was "cookie absent" instead of "header selected," which would have broken the bearer-header rollback path.
- Refresh-on-401 exempt list originally included `/auth/me`/`/auth/logout`/`/auth/logout-all` as "auth identity-boundary" endpoints, which would have force-logged-out every expired-access/valid-refresh boot — narrowed to credential-presentation endpoints only.
- BroadcastChannel-only coordination in the original ADR 0002 draft (Option C) had a cross-tab race window; revised to Option E (Web Locks for mutual exclusion + BroadcastChannel for state propagation only).
- Initial resubscribe on WebSocket `onopen` raced the server's async cookie auth; moved to the `'connected'` welcome handler.
- Ad-hoc `subscribe()`/`unsubscribe()` calls after the move still gated on `readyState === OPEN` and raced the same window; added `isServerReady` flag.
- `disconnect()` relied on async `onclose` to reset `isServerReady`, leaving a window where `this.ws === null` but the flag was still `true`; reset synchronously.

**Security grade movement:** `docs/plans/codebase-health-assessment.md` Security row moves from **B → A** on browser token handling. The access token is no longer script-readable (HttpOnly cookie), the refresh token is never in JavaScript reach (HttpOnly cookie scoped to `/api/v1/auth/refresh`), CSRF is enforced via double-submit on state-changing requests when authenticated via cookie, and the WebSocket upgrade carries the cookie same-origin with no token-in-URL leakage.

**Carried over to Phase 6 (one release after Phase 2):** remove the JSON `token`/`refreshToken` fields from the browser-mounted `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` response bodies; remove `VITE_AUTH_TOKEN_STORAGE` from `vite.config.ts` and `.env.example`; audit `src/api/client.ts` for Phase-4-era dead code.
