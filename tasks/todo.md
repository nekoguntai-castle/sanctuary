# HttpOnly cookie auth + refresh flow migration — implementation plan

ADRs:
- `docs/adr/0001-browser-auth-token-storage.md` — Accepted 2026-04-12
- `docs/adr/0002-frontend-refresh-flow.md` — Proposed; awaiting user review

Branch strategy: one PR per phase. Each phase is independently revertible. Do not start a phase until the previous one is merged and CI is green on `main`.

**Resolved decisions** (from the user check-in on 2026-04-12, applying the "no cutting corners" working rule):

1. **CSRF library:** `csrf-csrf` (modern, server-stateless double-submit, well-maintained).
2. **Cookie names:** `sanctuary_access` (HttpOnly access token), `sanctuary_csrf` (readable double-submit token), `sanctuary_refresh` (HttpOnly refresh token, scoped to `/api/v1/auth/refresh`). All snake_case to match the existing `sanctuary_token` convention in `src/api/client.ts:137`.
3. **`/auth/me` endpoint:** already exists at `server/src/api/auth/profile.ts:20`. Reused as-is.
4. **Refresh flow:** included in this work, not deferred. Designed in ADR 0002. Implementation lands in Phase 4.

## Phase 0 — ADR 0002 review and acceptance — COMPLETE 2026-04-12

Goal: the refresh-flow design is reviewed, accepted, and ready to merge into Phase 4. This is a documentation-only phase but it gates everything else — the design must land before any cookie code is written, since the cookie shape (`sanctuary_refresh` scoped to `/api/v1/auth/refresh`) is decided here.

- [x] User reviews `docs/adr/0002-frontend-refresh-flow.md`.
- [x] Push back on any design decisions or accept as-is. (Codex review caught the BroadcastChannel-as-mutex race; ADR 0002 was revised from Option C to Option E — Web Locks API + BroadcastChannel for state propagation only.)
- [x] Mark ADR 0002 status from "Proposed" to "Accepted".
- [x] Update the cross-reference in ADR 0001 to also say "Accepted".

**Exit criteria:** ADR 0002 status is Accepted. ✓ Open questions inside ADR 0002 (refresh lead time, refresh token TTL, WebSocket reconnect on refresh, logout-all UI, Page Visibility API behavior) are deferred to implementation time per the ADR's own "Open questions" section — they do not block Phase 1.

## Phase 1 — Backend foundation (PR 1)

Goal: the backend can verify either a cookie+CSRF or an `Authorization: Bearer` header on every protected route, but no route is yet *issuing* cookies. This phase ships behind no flag and changes no behavior; it just teaches the auth middleware to recognize cookies.

- [ ] Add `cookie-parser` to `server/package.json` and wire it into `server/src/index.ts` before the auth middleware runs.
- [ ] Add `csrf-csrf` to `server/package.json`. Capture the version pin in the PR description.
- [ ] Add CSRF middleware to `server/src/middleware/csrf.ts` using `csrf-csrf`'s `doubleCsrf` factory. Use a stable secret derived from the existing JWT secret material so deployers do not need to add a new env var.
- [ ] Update `server/src/middleware/auth.ts` to read the access token from a `sanctuary_access` cookie when no Authorization header is present.
- [ ] When the request authenticated via cookie, require a valid `X-CSRF-Token` for POST/PUT/PATCH/DELETE. The Authorization-header path is exempt (mobile/gateway).
- [ ] Tests:
  - [ ] `server/tests/unit/middleware/auth.test.ts` — cookie-only auth, header-only auth, both present (cookie wins), neither (401).
  - [ ] `server/tests/unit/middleware/csrf.test.ts` (new) — POST without token rejected, with wrong token rejected, with correct token accepted, GET exempt.
  - [ ] No regression in `server/tests/unit/middleware/gatewayAuth.test.ts`.

**Exit criteria:** `cd server && npm run build`, `cd server && npx vitest run tests/unit/middleware/`, and the existing auth integration suite all pass. No frontend changes yet. No client breaks because no route is *issuing* cookies yet.

## Phase 2 — Backend response cookies + expiry header (PR 2)

Goal: auth endpoints set the cookies on success, clear them on logout, and surface access-token expiry to the client via `X-Access-Expires-At`. The JSON `token`/`refreshToken` fields stay in the response body for one release as a rollback safety net.

- [ ] `server/src/api/auth/login.ts:187-313` — on successful login set:
  - [ ] `sanctuary_access` (HttpOnly, Secure, SameSite=Strict, path `/`, Max-Age = access TTL in seconds)
  - [ ] `sanctuary_refresh` (HttpOnly, Secure, SameSite=Strict, **path `/api/v1/auth/refresh`**, Max-Age = refresh TTL in seconds)
  - [ ] `sanctuary_csrf` (Secure, SameSite=Strict, **NOT HttpOnly** so the frontend can read it)
  - [ ] `X-Access-Expires-At` response header with the access token's `exp` claim as ISO 8601.
  - [ ] Keep the JSON `token`/`refreshToken` fields for one release.
- [ ] `server/src/api/auth/twoFactor/verify.ts:33-140` — same treatment on 2FA success.
- [ ] `server/src/api/auth/tokens.ts:28-81` (refresh):
  - [ ] Read refresh token from `sanctuary_refresh` cookie when the request body has no `refreshToken` field.
  - [ ] Issue rotated `sanctuary_access`, `sanctuary_refresh`, and `sanctuary_csrf` cookies on success.
  - [ ] Set `X-Access-Expires-At` on the response.
  - [ ] Keep accepting the body field for the gateway/mobile path.
- [ ] `server/src/api/auth/tokens.ts:87-160` (logout, logout-all) — clear all three cookies via `Set-Cookie` with `Max-Age=0`.
- [ ] `server/src/api/auth/profile.ts:20` (`/auth/me`) — set `X-Access-Expires-At` on the response so the client can schedule its first refresh after a page reload without an explicit refresh.
- [ ] Update OpenAPI auth response schemas in `server/src/api/openapi/` to document `cookieAuth` and `csrfToken` security schemes alongside the existing `bearerAuth`.
- [ ] Tests:
  - [ ] `server/tests/unit/api/auth.test.ts` and the 2FA verify tests — assert all three Set-Cookie headers carry the expected attributes (HttpOnly where applicable, Secure, SameSite=Strict, expected paths, expected Max-Age).
  - [ ] Logout test — assert all three cookies cleared.
  - [ ] Refresh tests:
    - [ ] Refresh from cookie alone succeeds and rotates the cookies.
    - [ ] Refresh from body alone still succeeds (mobile path regression).
    - [ ] Refresh with both present uses the cookie.
    - [ ] Failed refresh (revoked token) returns 401 and clears the cookies.
  - [ ] Every auth response carries `X-Access-Expires-At` with a valid ISO 8601 timestamp matching the JWT `exp` claim.
  - [ ] OpenAPI tests still pass with the new security schemes documented.

**Exit criteria:** server builds, all auth tests pass, no frontend changes yet, mobile/gateway path still uses the JSON token in the response body.

## Phase 3 — Backend WebSocket cookie reading (PR 3)

Goal: WebSocket upgrades on the same origin authenticate via cookie. The deprecated query parameter token path is removed in the same change.

- [ ] `server/src/websocket/auth.ts:56-72` — extract token from `sanctuary_access` cookie when no Authorization header is present. Use a small cookie-parsing helper (or import from cookie-parser) — do not regex-extract.
- [ ] Remove the deprecated query parameter token path (`server/src/websocket/auth.ts:62-69`). It has been deprecated long enough and removing it eliminates a token-leakage vector via referer headers / server logs.
- [ ] The auth-message-after-connect path (lines 136-191) stays for clients that prefer it. A same-origin browser will normally not need it.
- [ ] Confirm `server/src/utils/jwt.ts` continues to honor the original `exp` claim of an access token until that timestamp passes — so an existing WebSocket connection authenticated with the previous access token survives a cookie rotation. This is one of the open questions in ADR 0002 and the answer governs whether we need to force a WS reconnect on refresh.
- [ ] Tests:
  - [ ] `server/tests/unit/websocket/auth.test.ts`:
    - [ ] Upgrade with valid cookie + no header succeeds.
    - [ ] Upgrade with header only still works (gateway/mobile regression).
    - [ ] Upgrade with deprecated query parameter is now rejected.
    - [ ] Upgrade with a 2FA pending token in the cookie is rejected (the existing `pending2FA` check at line 28 still applies).
  - [ ] `server/tests/integration/websocket/websocket.integration.test.ts` regression check.

**Exit criteria:** all WebSocket auth tests pass, no broken regressions in the WS integration suite, the deprecated query parameter path is gone from the codebase (also remove any client code that emitted it).

## Phase 4 — Frontend cookie auth + refresh flow (PR 4)

This is the biggest phase. It implements both ADR 0001 (cookies replace storage) and ADR 0002 (refresh flow) on the frontend in a single coherent change. Splitting them would mean rewriting `src/api/client.ts` twice.

### 4a — Cookie-based request path

- [ ] `src/api/client.ts` — switch every fetch call (`request`, `fetchBlob`, `download`, `upload`) to `credentials: 'include'`.
- [ ] `src/api/client.ts` — remove `TokenStorageMode`, `getTokenStorageMode`, `getBrowserStorage`, `getPrimaryTokenStorage`, `readStoredToken`, `writeStoredToken`, the legacy localStorage migration block, the `setToken`/`getToken` exports, and the `Authorization` header injection.
- [ ] `src/api/client.ts` — add a CSRF token reader that reads `sanctuary_csrf` from `document.cookie` and injects it as `X-CSRF-Token` on POST/PUT/PATCH/DELETE.

### 4b — Refresh primitive with Web Lock + freshness check

**This is the section that changed after Codex review caught a cross-tab race in the BroadcastChannel-only design. See ADR 0002 Option C (rejected) and Option E (recommended) for the design rationale.**

- [ ] New module `src/api/refresh.ts` (or co-located in `client.ts` if it fits cleanly).
- [ ] Exports `refreshAccessToken()` returning a Promise.
- [ ] Within a single tab, uses single-flight semantics — concurrent callers receive the same in-flight Promise so the lock acquisition itself is not duplicated.
- [ ] The single-flight promise wraps `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, async () => { ... })` for cross-tab mutual exclusion.
- [ ] Inside the lock callback:
  - [ ] **Freshness check first:** if `accessExpiresAt > Date.now() + REFRESH_LEAD_TIME_MS` (60_000), another tab already refreshed during the lock wait — return immediately with no network call.
  - [ ] Otherwise, send `POST /api/v1/auth/refresh` with `credentials: 'include'` and the CSRF header.
  - [ ] On success, parse `X-Access-Expires-At` from the response, update `accessExpiresAt`, broadcast `refresh-complete` with the new expiry, reschedule the local timer.
  - [ ] On failure, broadcast `logout-broadcast` and reject the promise.
- [ ] Lock release happens automatically when the callback returns or throws.

### 4c — Scheduled (proactive) refresh

- [ ] On every successful auth response (`/auth/login`, `/auth/2fa/verify`, `/auth/refresh`, `/auth/me`), parse `X-Access-Expires-At` and schedule a `setTimeout` for `expiresAt - REFRESH_LEAD_TIME_MS` to call `refreshAccessToken()`.
- [ ] Clear the previous timer before scheduling a new one.
- [ ] Clear the timer on logout and on `beforeunload`.

### 4d — Reactive (401) refresh

- [ ] In `src/api/client.ts:request`, when a response status is 401 and the request was not already a retry, await `refreshAccessToken()` and replay the original request once.
- [ ] If the retry also fails with 401, do not retry again — surface the error and trigger logout.
- [ ] Non-401 failures (5xx, network) bypass the refresh path entirely.

### 4e — BroadcastChannel state propagation (NOT mutual exclusion)

- [ ] On client init, open `new BroadcastChannel('sanctuary-auth')`. Mockable for tests via dependency injection.
- [ ] On `refresh-complete` from another tab, update the local `accessExpiresAt` from the broadcast payload and reschedule the local timer.
- [ ] On `logout-broadcast` from another tab, trigger the local logout flow.
- [ ] **Do not implement a `refresh-start` event.** The Web Lock is the start signal. BroadcastChannel is async pub/sub and cannot prevent races; using it as a coordination primitive was the bug Codex caught in the original ADR draft.
- [ ] Close the channel on `beforeunload`.

### 4f — UserContext + logout flow

- [ ] `contexts/UserContext.tsx`:
  - [ ] Stop calling `apiClient.setToken`. The login/2FA-verify handlers no longer touch token storage.
  - [ ] On app boot, call `/api/v1/auth/me`. If it succeeds, hydrate the user and schedule the refresh timer from the response header. If it returns 401, render the login screen.
  - [ ] Logout: clear the scheduled refresh timer, broadcast `logout-broadcast`, redirect to login. Both terminal refresh failure and explicit user logout share this path.

### 4g — Tests

- [ ] `tests/setup.ts`:
  - [ ] Add a `navigator.locks` mock that maintains a Map of held lock names with FIFO waiters and supports multi-instance "tab" simulation. Pure in-memory, no network or filesystem.
  - [ ] Add a BroadcastChannel polyfill or mock that supports multi-instance same-channel pub/sub for the test where two simulated tabs interact.
- [ ] `tests/api/client.test.ts`:
  - [ ] Replace storage mode tests with: every request includes `credentials: 'include'`, non-GET requests include `X-CSRF-Token` from the readable cookie.
  - [ ] `setToken`/`getToken` no longer exist (compile-time error if referenced).
  - [ ] `request()` parses `X-Access-Expires-At` and updates internal state.
- [ ] `tests/api/refresh.test.ts` (new):
  - [ ] Within-tab single-flight: two concurrent `refreshAccessToken()` calls return the same promise; the underlying fetch is called exactly once; the Web Lock is acquired exactly once.
  - [ ] Proactive refresh: with fake timers, advancing past `expiresAt - REFRESH_LEAD_TIME_MS` triggers a refresh exactly once; the new expiry is honored; the timer reschedules itself.
  - [ ] Reactive refresh: a 401 response triggers a refresh and retries the original request; retry success surfaces normally; retry failure surfaces the second 401 and triggers logout.
  - [ ] **Cross-tab Web Lock serialization (the test that catches the bug Codex flagged):** simulate two tabs sharing the same lock state. Both tabs trigger `refreshAccessToken()` simultaneously. Assert exactly one `POST /auth/refresh` is sent across both tabs (the second tab waits on the lock, sees fresh `accessExpiresAt` after the broadcast handler ran, and short-circuits).
  - [ ] Cross-tab race with stale broadcast: same setup, broadcast handler delayed. Assert the second tab still sends its refresh, the second refresh succeeds, and no logout fires (the "wasted refresh but not broken" path).
  - [ ] BroadcastChannel state propagation: `refresh-complete` from another tab updates `accessExpiresAt` and reschedules the timer; `logout-broadcast` triggers the local logout flow.
  - [ ] Terminal refresh failure: server returns 401 on `/auth/refresh`. Assert lock is released, `logout-broadcast` is sent, local logout flow fires.
  - [ ] Non-401 failures (500, network error) do not trigger a refresh attempt.
- [ ] `tests/contexts/UserContext.test.tsx`:
  - [ ] Logout clears the scheduled refresh timer and broadcasts `logout-broadcast`.
  - [ ] On app boot, `/auth/me` is called; success hydrates user + schedules refresh; 401 renders login screen.
- [ ] All existing `apiClient.setToken` test references are removed.
- [ ] Component tests that previously relied on `apiClient.setToken` to seed an authenticated state are updated to mock `/auth/me` instead.
- [ ] Frontend strict typecheck and 100% coverage gate must stay green, including the freshness short-circuit branch and the lock-held-by-another-tab branch.

**Exit criteria:** `npm run typecheck:app`, `npm run typecheck:tests`, `npm run test:coverage` all pass with 100% coverage. `./start.sh --rebuild` and a manual login + 2FA + WebSocket-bearing page works end-to-end in a browser. Verify in browser devtools that:
- The access cookie is HttpOnly (script cannot read it via `document.cookie`).
- The CSRF cookie is readable and is echoed in the `X-CSRF-Token` header on POSTs.
- A scheduled refresh fires before the access token expires.
- Forcing a 401 (e.g., by waiting past expiry without scheduled refresh) triggers a transparent refresh + retry.
- Two open tabs do not race the refresh; the second tab uses the rotated cookie without making its own refresh call.

## Phase 5 — Documentation (PR 5) — COMPLETE 2026-04-13

Goal: the new model is captured in operations and release docs so the next operator does not have to read both ADRs to understand the system.

- [x] `docs/OPERATIONS_RUNBOOKS.md`:
  - [x] Add the cookie + Secure + TLS termination requirement.
  - [x] Document the CSRF token rotation behavior.
  - [x] Document the refresh token TTL and rotation.
  - [x] Document the BroadcastChannel cross-tab coordination so an operator debugging "why did all my tabs log out at once" knows where to look.
- [x] `docs/RELEASE_GATES.md` — cookie/CSRF/refresh test suite added to the Browser auth and CSP gate; Phase 4 Browser Auth Gate section rewritten from "remaining architecture decision" to "resolved 2026-04-13".
- [x] `docs/plans/codebase-health-assessment.md`:
  - [x] Security row moved from B to A- (partial schema coverage + accepted dependency findings keep it from a clean A).
  - [x] HttpOnly-cookie ADR row removed from outstanding items table.
  - [x] Ninth Phase 4 slice section records the ADR 0001/0002 implementation and the undocumented refresh-flow gap closure.
- [x] `docs/adr/0001-browser-auth-token-storage.md` — Resolution section added with full commit history, Codex-caught bug list, and Security grade movement.
- [x] `docs/adr/0002-frontend-refresh-flow.md` — Resolution section added with implementation summary, test coverage list, Codex-caught bugs specific to the refresh flow, and answers to all 5 "open questions."
- [x] OpenAPI: `cookieAuth` and `csrfToken` security schemes are now **referenced** from every browser-mounted protected route (not just declared in `components.securitySchemes`). Added `server/src/api/openapi/security.ts` exporting `browserOrBearerAuth = [{ bearerAuth: [] }, { cookieAuth: [], csrfToken: [] }]` and `internalBearerAuth = [{ bearerAuth: [] }]`; every path file (auth, admin, ai, bitcoin, devices, drafts, intelligence, labels, mobilePermissions, payjoin, push, transactions, transfers, walletExport, walletHelpers, walletImport, walletPolicies, walletSettings, walletSharing, wallets) imports the shared constant; `internal.ts` continues to use bearer-only because the `/internal/ai/*` routes are proxied by the AI container, not reachable from browsers. Test assertions in `server/tests/unit/api/openapi.test.ts` updated to `browserOrBearerAuthSecurity` for browser routes and `bearerOnlyAuthSecurity` for internal routes. Caught by Codex stop-time review of Phase 5 — the original carry-over only verified the schemes were *declared*, not *referenced*.

**Exit criteria:** ✓ docs reviewed, both ADR resolution sections filled in, codebase health assessment grade movement recorded.

## Phase 6 — Deprecation removal (PR 6) — COMPLETE 2026-04-13

Goal: remove the rollback safety net once we are confident the cookie + refresh path is stable.

**Scope note:** the original Phase 6 plan assumed browser-mounted and gateway-mounted auth routes were separately mounted. They aren't — there's a single `authRouter` under `/api/v1/auth` that serves both browsers and the gateway's transparent proxy. Mobile is not currently an active consumer. Given that, Phase 6 strips the JSON `token`/`refreshToken` fields from **all** callers of the auth router. If/when a mobile client ships, it will need to authenticate via cookies OR the auth flow will need a cryptographically-verified gateway channel (the `shared/utils/gatewayAuth.ts` HMAC primitive is the obvious building block). That future work is explicitly out of scope here.

- [x] Remove the JSON `token`/`refreshToken` fields from `/auth/register`, `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` response bodies (`server/src/api/auth/login.ts`, `server/src/api/auth/twoFactor/verify.ts`, `server/src/api/auth/tokens.ts`). Rollback-safety-net comments replaced with Phase 6 rationale.
- [x] Update OpenAPI schemas to drop `token`/`refreshToken` from `LoginResponse` and `RefreshTokenResponse`; `RefreshTokenResponse.required` updated from `['token','refreshToken','expiresIn']` to `['expiresIn']`.
- [x] Remove `VITE_AUTH_TOKEN_STORAGE` leftover from `.env.example` (there was no `vite.config.ts` entry to remove — Phase 4 already did that).
- [x] Audit `src/api/client.ts` for Phase-4-era dead code. Confirmed clean: no `setToken`/`getToken`/`TokenStorageMode`/`readStoredToken`/`writeStoredToken`/`storedToken`/"rollback"/"legacy" references. Phase 4 removed all of it.
- [x] Update 12 unit test assertions in `server/tests/unit/api/auth.routes.registration.test.ts` and `server/tests/unit/api/auth.routes.2fa.test.ts` from `toBeDefined()` to `toBeUndefined()` for `response.body.token` / `response.body.refreshToken`. Where the assertion was load-bearing (rotation tests), replace with `Set-Cookie` content assertions.
- [x] Refactor integration tests in `server/tests/integration/flows/auth.integration.test.ts`, `admin.integration.test.ts`, and `security.integration.test.ts` to read tokens from the `sanctuary_access` / `sanctuary_refresh` Set-Cookie headers instead of the response body. Added `extractAuthTokens(response)` helper in `server/tests/integration/setup/helpers.ts`.

**Exit criteria achieved:**
- ✓ Backend builds and typechecks cleanly.
- ✓ Backend unit + integration test suites pass (8749 unit + 503 integration-skip-when-no-db).
- ✓ Frontend coverage gate stays at 100% (5475 tests).
- ✓ Gateway builds and 510 gateway tests pass.
- ✓ No test references `VITE_AUTH_TOKEN_STORAGE`.
- ✓ No test references `apiClient.setToken`.
- ✓ No production code reads or writes the JSON `token`/`refreshToken` field anywhere on the auth routes.

## Cross-phase guardrails

- Run the full local test suite + typechecks before pushing each phase. CLAUDE.md is explicit: "Do not rely on CI to catch test failures or type errors."
- Pre-commit hooks run AI agents whose feedback must be reviewed (CLAUDE.md "Run `git commit` in foreground"). Each phase commits in foreground.
- Per CLAUDE.md "When fixing CI failures... batch all related fixes together." If a phase touches a pattern (e.g., removing `apiClient.setToken`), grep the full repo for the pattern *before* committing so we do not ship one file at a time.
- The mobile gateway path (`gateway/`, `shared/utils/gatewayAuth.ts`) must remain untouched in functionality. Every phase should run `cd gateway && npm run build` and the gateway request-validation/proxy/HMAC tests as a regression check.
- The 100% frontend coverage gate is non-negotiable. If a refactor removes coverage, the missing branches must be added back in the same PR.
- Per the "no cutting corners" working rule: if a step would be easier by deferring a related concern, push back on the deferral first. The right question is "is the long-term solution healthier?" not "is this slice smaller?"
