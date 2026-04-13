# Sanctuary — Lessons

Patterns to remember from CI corrections, surprising debugs, and reviews. Written terse so future-me can scan quickly. Each entry: rule, why, how to apply.

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
