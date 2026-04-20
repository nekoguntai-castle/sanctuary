# Sanctuary — Lessons

Patterns to remember from CI corrections, surprising debugs, and reviews. Written terse so future-me can scan quickly. Each entry: rule, why, how to apply.

## Future-date test fixtures must be relative or time-frozen

**Rule:** When a test needs an input that must be "in the future," derive it from `Date.now()` or freeze time with fake timers. Do not use a calendar-fixed timestamp unless the test is explicitly about that calendar boundary.

**Why:** `server/tests/unit/services/adminAgentService.test.ts` used `2026-04-20T00:00:00.000Z` while asserting default creator metadata. That date passed locally before the boundary but failed in CI once UTC time reached April 20, 2026 because production code correctly rejected expired `expiresAt` values.

**How to apply:**
- For validation-neutral future values, use `new Date(Date.now() + N)` with a clear duration.
- For tests that need exact timestamps, use fake timers and restore them in cleanup.
- Before committing hard-coded dates, ask whether the date's relationship to current time matters.

## Do not reference unavailable Codex skills or slash commands

**Rule:** Before adding a workflow step that names a Codex skill or slash command, verify that it exists in the current Codex skill list. If it does not exist, describe the concrete review activity instead.

**Why:** The project workflow initially referenced `/simplify`, but Codex does not have that skill in this environment. The user corrected it and asked to remove the command. Keeping nonexistent commands in `AGENTS.md` creates false process requirements and wastes time at the end of tasks.

**How to apply:**
- Use "quality review", "edge case audit", or a specific command/test in task files instead of invented slash commands.
- Only invoke a named skill when it appears in the session's available skills list.
- If the user asks for a missing skill, state that it is unavailable and continue with the closest concrete workflow.

## E2E test fixtures must not collide with assertion selectors

**Rule:** When adding a required form field value in a Playwright test, choose a value that does NOT contain the substring used by later `getByText(...)` assertions in the same flow. Or anchor the assertion with `{ exact: true }` / a precise locator from the start.

**Why:** In `e2e/admin-operations.spec.ts` (commit `0883ea2a`), filling the new required email as `newuser@example.com` made the post-create assertion `getByText('newuser')` resolve to two elements — the username cell `<p>newuser</p>` AND the email cell `<p>newuser@example.com</p>` — triggering a Playwright strict-mode violation. Cost two CI cycles to discover and fix.

**How to apply:**
- Before adding a fixture value, grep the same test for `getByText('<value>'...)` substring matchers.
- If the cell that displays the username and the cell that displays the email are siblings, prefer username `foo` + email `f@example.com` (no shared substring), OR use `{ exact: true }` on the username assertion.
- More broadly: `getByText('shortString')` is fragile — prefer `{ exact: true }` or `getByRole(...)` whenever the substring could plausibly appear in a sibling element.

## Frontend tests must not fire real ApiClient calls with retry timers

**Rule:** Any hook that calls `apiClient.*` on mount needs to be globally stubbed in `tests/setup.ts` (or per-file mocked) for component tests that mount it transitively. Don't rely on `global.fetch = vi.fn()` — ApiClient catches the rejection and retries with `setTimeout`, generating console.warn output after the test body returns.

**Why:** `useIntelligenceStatus` (called by `useAppCapabilities`, used by `Layout`) was unmocked. Each Layout-mounting test triggered four `setTimeout`-backed retries that emitted `console.warn` after the test ended. Under CI parallelism these late events raced vitest's `onUserConsoleLog` flush at worker teardown and surfaced as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` in `Layout.test.tsx`. Locally it never reproduced. Fixed in commit `680192ca` by stubbing `getIntelligenceStatus` in `tests/setup.ts` (with `vi.unmock` in `tests/api/intelligence.test.ts` to preserve the API test).

**How to apply:**
- New hook that fires on mount and hits the network → mock it (or its API module) in `tests/setup.ts` with `vi.importActual` + targeted override.
- Per-file `vi.mock` calls override setup mocks (they're hoisted), so dedicated hook/api tests still work.
- Symptom check: if CI shows `Closing rpc while "onUserConsoleLog" was pending` or unexplained vitest worker teardown errors, look for unmocked retry-capable API calls in components rendered by the affected test file.

## Refresh-on-401 exempt list: only credential-presentation endpoints

**Rule:** When implementing a refresh-on-401 interceptor, the exempt list (endpoints that DO NOT trigger refresh on a 401) must contain ONLY endpoints where the credential being presented IS the thing being authenticated — never general-purpose endpoints that just happen to be in the auth namespace. Specifically: `/auth/login`, `/auth/register`, `/auth/2fa/verify`, `/auth/refresh`. Endpoints like `/auth/me`, `/auth/logout`, and `/auth/logout-all` MUST refresh on 401 because they represent ongoing-session operations where a stale access token + valid refresh cookie should recover the session, not force a re-login.

**Why:** Phase 4 of the cookie auth migration originally exempted `/auth/me`, `/auth/logout`, and `/auth/logout-all` from the refresh interceptor as "auth identity-boundary endpoints." Codex stop-time review caught the consequence: any user with an expired access token but still-valid refresh cookie would be force-logged-out on every page reload, because the boot probe `/auth/me` returned 401 and the interceptor was exempted from triggering refresh. The whole point of the migration was to make session expiry invisible — this regression undid it. Fixed in commit `<next>` by trimming the exempt list to only the four credential-presentation endpoints. `/auth/me` boot recovery now refreshes + retries when there is a valid refresh cookie. `/auth/logout` refreshes + retries so the server-side session is actually revoked even when the access token has already expired client-side.

**How to apply:**
- For each endpoint you consider exempting, ask: "is the credential being presented here the THING being authenticated?" (login = yes, refresh = yes, 2FA verify = yes, register = yes — the credentials in the request body are the identity claim). If yes, exempt. If the endpoint just consumes an existing session, do NOT exempt — it should benefit from refresh-on-401.
- Specifically: do not exempt `/auth/me`, `/auth/logout`, `/auth/logout-all`, or any other "do something with my existing session" endpoint.
- Test the exempt-list behavior with a regression test that asserts 401 → refresh + retry → success on a non-exempt endpoint that has overlap with the exempt names (e.g., `/auth/me`).
- The general principle beyond auth: an interceptor's "skip" rule and the operation's actual semantics must align. Skipping the interceptor for an endpoint that would benefit from it is silently breaking the user-visible flow.

## Pre-attached message handlers and welcome-message synchronization for async-auth WebSockets

**Rule:** When a WebSocket server authenticates connections asynchronously after the upgrade handshake (e.g., via cookie verification), the message handler must either be attached synchronously OR the client must wait for an explicit "I am ready" message from the server before sending any subscriptions. Sending immediately on `onopen` races the server's async auth and the messages are silently dropped.

**Why:** Phase 4 frontend rewrote `useWebSocket` to call `connect()` with no token, relying on Phase 3's same-origin cookie auth on the upgrade request. But the existing `services/websocket.ts` `onopen` handler took the "no token" branch and resubscribed immediately. Server-side, `authenticateOnUpgrade` runs `verifyWebSocketAccessToken` async (because verifyToken hits the token revocation list), and the message handler is only attached at the END of `completeClientRegistration`, AFTER auth completes. Client subscribe messages sent on `onopen` arrived at a socket with no message handler and were silently dropped. Fixed in commit `<next>` by moving the resubscribe trigger from `onopen` to the server's `'connected'` welcome message handler in `services/websocket.ts`. The welcome is sent at the end of `completeClientRegistration` — i.e., AFTER the message handler is attached — so resubscribing in response to it is race-free. The legacy `'authenticated'` message path (from the auth-message-after-connect flow) is preserved as a no-op log for diagnostic purposes; the perf benchmark scripts that still use sendAuthMessage now also rely on the `'connected'` welcome for resubscription.

**Follow-up (same root cause):** The first fix moved only the initial resubscribe behind the welcome, but ad-hoc `subscribe()`/`unsubscribe()`/`subscribeBatch()`/`unsubscribeBatch()` calls between `onopen` and the welcome were still gated on `ws.readyState === WebSocket.OPEN`. Any caller that hit that window (e.g., a hook mounting and subscribing while the cookie auth promise was still resolving) sent a message into the same pre-handler void and was silently dropped. Codex stop-time review caught it. Fixed in commit `<next>` by adding a private `isServerReady` boolean that flips true only in the `'connected'` handler, resets false in `connect()` and `onclose`, and gates all four mutator methods. `readyState === OPEN` is no longer sufficient anywhere in the class — `isServerReady` is the single authoritative signal. Regression tests subscribe after `simulateOpen()` and confirm no message is sent until the welcome arrives.

**Follow-up 2 (disconnect + async close race):** Relying on `onclose` alone to reset `isServerReady` was itself a race. `disconnect()` calls `ws.close()` and synchronously sets `this.ws = null`, but browsers deliver the close event asynchronously — so between those two lines and the actual close-event delivery, there is a window where `this.ws === null` AND `this.isServerReady === true`. A mutator called in that window would pass the ready gate and then crash inside `send()` on `this.ws!.send(...)`. Codex stop-time review caught it. Fixed by setting `this.isServerReady = false` synchronously at the top of `disconnect()` before touching `this.ws`. Regression test stubs `ws.close` to a no-op to model async close-event delivery and asserts that all four mutators are no-ops after `disconnect()`. **General rule:** when a state flag and a resource handle must stay consistent, reset them together synchronously on the shutdown path; do not rely on async lifecycle callbacks to close the window for you.

**How to apply:**
- Any time the server authenticates on connection asynchronously, either attach the message handler synchronously and queue subscriptions until auth completes, OR have the client wait for an explicit "ready" signal.
- The "ready" signal pattern is simpler: the server sends a welcome message at the moment it has fully wired up the connection (handler attached, auth done, user tracking complete). The client treats receipt of this message as the only valid trigger for sending state-changing messages.
- Do NOT rely on `onopen` as the moment to start sending — `onopen` only means the WebSocket handshake completed, not that the server is logically ready to receive messages.
- Add a regression test that simulates the welcome message and asserts subscriptions are sent in response to it, NOT in response to `simulateOpen()`.
- The general principle beyond WebSockets: any protocol where one side does work after the connection is established needs an explicit "ready" signal before the other side can act. Don't assume "connected" means "ready to talk."

## Don't evict credentials on server-side failures — only on terminal auth failures

**Rule:** When a route fails, ask: "was the client's credential actually the problem, or was the server the problem?" Only evict the client's credentials (clear cookies, force logout, invalidate session) on the former. For transient server errors — database hiccups, service bugs, upstream timeouts — leave the credentials alone so the client can retry.

**Why:** Fixing one Codex-flagged divergence (refresh failure should clear cookies) on commit `1f631091`, I over-corrected and added `clearAuthCookies(res)` to the `rotateRefreshToken` service-failure 500 path as well. Codex caught it on the next review: at that point the refresh token has ALREADY been verified (JWT signature OK, not revoked, user exists), so rotation returning null is a transient server error, not a terminal auth failure. Clearing the cookies would punish the client for a server bug — the client would have no credentials left to retry with, even though their session is fine. Fixed in commit `<next>` by removing the `clearAuthCookies` call from that one branch and adding a regression test that sends the three cookies, triggers the rotation-null path, and asserts the response has no clearing Set-Cookie entries for those names.

**How to apply:**
- Draw a line between "terminal auth failure" (credential is bad, no retry will fix it) and "transient server failure" (server hiccup, same credential would succeed next call). Clear cookies only on the first kind.
  - Terminal: invalid/expired/revoked token, deleted user, permission denied, user disabled.
  - Transient: rotation service bug, DB connection drop, upstream 502, rate-limit retry-after, unknown 500.
- When adding cookie-clearing logic, enumerate the failure paths explicitly and tag each one as terminal or transient before the code gets written.
- Add a regression test for the **transient** path that asserts the Set-Cookie header does NOT contain clearings for the auth cookie names. The happy-path and terminal-path tests cover the other directions.
- The general principle beyond cookies: on a server bug, leave client state alone and return an error the client can retry. Never let a server bug become a user-facing logout.

## Implementations must match the ADR they claim to implement, not the implementer's intuition

**Rule:** When implementing a phase of a plan documented in an ADR, grep the ADR for every stated invariant (precedence rules, failure behaviors, required tests, specific header/cookie attribute values) and verify each one against the code. Do not substitute a "sensible equivalent" from an unrelated part of the system.

**Why:** Phase 2 of the cookie auth migration set `POST /auth/refresh` to "body wins when both body and cookie are present," justified as "mirrors auth middleware header-over-cookie precedence." But ADR 0002 migration plan item 2 and required test spec both say the OPPOSITE: "both present uses the cookie." I conflated two different precedence rules — the auth middleware's header-over-cookie rule (mobile's active path wins over browser's passive path) with refresh token source selection (browser's modern path should win over legacy body). The same commit also omitted clearing the browser auth cookies on terminal refresh failure, which ADR 0002 explicitly required ("refresh clears cookies on failure (revoked refresh token)"). Both divergences were caught by Codex stop-time review before the commit went out — but they would have produced browser clients looping 401s on stale refresh cookies in production. Fixed in commit `<next>`: cookie-wins precedence, clearAuthCookies called before throwing UnauthorizedError on all three terminal-failure branches, tests added for each.

**How to apply:**
- Before writing a phase, open the ADR and make a checklist of every stated invariant. Treat each one as a required test and a required implementation behavior.
- "Mirrors the other half of the system" is only a valid justification if the ADR explicitly says so. Otherwise trust the ADR — it was written with the full context in mind.
- Cross-check the "Required tests" section of the ADR before adding tests. If the test spec says "both present uses the cookie" and your test asserts body-wins, the test is wrong and the code is wrong.
- Failure paths are as important as happy paths. Ask: "on terminal failure of this operation, what state should the client be left in?" If the answer is "the same stale state that caused the failure," that's a bug.
- Add a regression test for the ADR invariant, phrased in the same terms the ADR uses, so the linkage is obvious in the test file.

## Cross-cutting middleware skip rules must mirror the source-selection of the middleware they shadow

**Rule:** When a security control (CSRF, audit, rate limiting) decides whether to enforce based on "did the request authenticate via path X?", the skip rule must use the **same source-selection logic** as the auth middleware whose decision it shadows. Do not duplicate the logic with a "looks like" check; import and call the actual selector function.

**Why:** In Phase 1 of the cookie auth migration (commit `6cb4ddf0`), `middleware/csrf.ts` originally skipped CSRF when `!req.cookies?.sanctuary_access` — i.e., "if no cookie, skip." The auth middleware uses `extractTokenFromHeader(req.headers.authorization) || req.cookies?.sanctuary_access`, with the header winning. During the Phase 2-6 rollback window, a browser client that persisted the legacy bearer token in `localStorage` would send BOTH an `Authorization: Bearer ...` header AND have the new `sanctuary_access` cookie auto-attached by the browser. The auth middleware uses the header (per its precedence rule), but the CSRF middleware sees the cookie and tries to enforce — and the legacy client has no `X-CSRF-Token` because it's in legacy mode. Result: 403 on a request that's supposed to be the safety net for rolling back. Codex stop-time review caught it. Fix in commit `<next>`: import `extractTokenFromHeader` into `csrf.ts` and call it inside `skipCsrfProtection` so the skip rule mirrors the auth rule exactly. Also covered the inverse: malformed Authorization headers (`Basic ...`, `Bearer ` with no token) make `extractTokenFromHeader` return null, so the auth middleware falls back to the cookie and CSRF must enforce.

**How to apply:**
- Whenever you write a skip rule for a cross-cutting middleware, identify which middleware's decision you are shadowing. Import and call its source-selection function directly.
- The check must be `if (otherMiddlewareWillUseHeader) skip` not `if (headerLooksPresent) skip`. Header presence and "header was actually used" are different things.
- Add a regression test that combines the two sources and verifies the right one wins. The test must construct the contended state (header + cookie + no CSRF token) and assert success.
- Add the inverse test: malformed header that would not authenticate, plus cookie, plus no CSRF token → must enforce CSRF (403).
- Generalizes to: audit logging that tags requests as "authenticated via header" vs "authenticated via cookie," rate limiting that scopes per source, request logging that marks the auth source. All must use the same selector.

## Pub/sub is not mutual exclusion

**Rule:** When a design needs cross-tab or cross-process serialization, use a real mutex primitive (Web Locks API, OS file lock, Redis SETNX with TTL, etc.). Do not use BroadcastChannel, postMessage, EventEmitter, or any other pub/sub mechanism as a coordination primitive. Pub/sub gives you "tell everyone this happened" — it does not give you "exactly one party gets to act."

**Why:** In ADR 0002 (frontend refresh flow), the original draft used BroadcastChannel as the cross-tab coordination primitive: "tab A broadcasts `refresh-start`, other tabs see this and skip their own refresh." Codex review caught the race: BroadcastChannel is asynchronous, and tab B can decide to refresh in the same instant as tab A before tab A's broadcast is delivered. Both tabs send `POST /auth/refresh` with the same refresh token, the server rotates the token on tab A's request, and tab B's request sees the now-invalidated token and returns 401 — logging tab B out even though auth state is fine. The fix was to switch to `navigator.locks.request(name, { mode: 'exclusive' }, callback)`, which is a real OS-level mutex with browser-guaranteed mutual exclusion across same-origin tabs.

**How to apply:**
- When reviewing a coordination design, ask: "what guarantees that exactly one party acts?" If the answer is "the broadcast arrives in time," that is not a guarantee — that is a hope. Reject the design.
- Web Locks API has 95.5% global support (caniuse 2024) and works in all evergreen browsers. Default to it for cross-tab serialization in browser code. Polyfill or vitest-mock with a Map of held lock names + FIFO waiters (~30 lines).
- BroadcastChannel still has a role: state propagation after the mutex-protected work has completed. "Tab A finished refreshing, here is the new expiry." That is fine because it is a hint, not a coordination signal.
- For server-side cross-process coordination, the same rule applies: Redis SETNX + TTL or a real distributed lock, not pub/sub.
- The "no cutting corners" feedback from the user applied: the original Option C (BroadcastChannel-only) was demoted from RECOMMENDED to REJECTED because correctness is not negotiable, and Option E (Web Locks + BroadcastChannel) was promoted because it is the only option that actually serializes.

## Pre-existing CLAUDE.md rules referenced
- "When fixing CI failures, check ALL test files and workflow files for the same issue pattern before committing. Do not fix one file at a time and re-push — batch all related fixes together." — would have caught this if I'd grepped for `getByText('newuser'` after picking the email value.
