# Phase C — middleware (merged)

**Source:** raw/02-middleware-claude.md + raw/02-middleware-codex.md
**Date:** 2026-05-12

## Summary

| Severity | Claude | Codex | Merged | Dual-flagged |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 2 | 3 | 4 | 2 |
| Medium | 7 | 7 | 7 | 0 |
| Low | 7 | 3 | 6 | 0 |

**Note:** Codex file was reconstructed from inline summary (top 3 only); medium/low Codex entries exist (per counts: 7 medium + 3 low) but were not enumerated. Codex flagged additional medium/low not enumerated — the merged medium/low set below reflects Claude's enumerations only, and the true merged count is a floor.

**Accepted:** 17 · **Rejected:** 0 · **Deferred:** 0

## Findings (accepted)

### [HIGH] middleware/auth.ts:97-109 — `authenticate` swallows non-JWT errors as 401
**Category:** Error handling
**Status:** Accept
**Cross-pass:** Claude only
**What:** The `catch (error)` block returns 401 for *any* thrown error, including infrastructure failures from `resolveCurrentAccessTokenPayload` (which performs DB lookups against the access-token session repo per SEC-003 revocation check). A transient DB outage or Prisma connectivity failure surfaces to the client as "Invalid or expired token".
**Why it matters:** Misleading 401s break refresh-token flows (clients log out users on infrastructure blips) and hide real outages from monitoring. Compare with `rateLimit.ts` which correctly fails closed with 503.
**Repro / trigger:** Drop Postgres while a request is in flight; `resolveCurrentAccessTokenPayload` rejects with a Prisma error and the user sees "Invalid or expired token" instead of 503.
**Fix shape:** Distinguish JWT verification errors (jsonwebtoken `JsonWebTokenError` / `TokenExpiredError`) from other rejections; map non-auth failures to 500/503 via `next(error)` and let the global error handler decide.
**Confidence:** high

### [HIGH] middleware/featureGate.ts:73-90 — Feature gates fail open to static config on flag-service error
**Category:** Logic / fail-open / security
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** When `featureFlagService.isEnabled` rejects, all three middlewares fall back to `getConfig().features` without distinguishing a transient outage from a routine "service unavailable" state. A persistent flag service outage means runtime feature toggles (audit-traceable) silently revert to file-config values. If a flag is disabled in DB for compliance/security reasons, a flag-service outage re-enables it.
**Why it matters:** Security-sensitive: a feature disabled in the DB for a compliance reason silently re-enables itself if the service breaks. The `log.warn` is the only signal. (Codex elevated this to HIGH; Claude originally rated LOW. Codex's severity is authoritative on security weight.)
**Repro / trigger:** Disable `payjoinSupport` in DB while it remains `true` in config. Break the featureFlagService. The route re-enables.
**Fix shape:** Fail closed on security-tagged flags; only fail open for non-sensitive flags explicitly marked safe-default. Add a per-flag policy (e.g. `failOpen: false`) controlling fallback behavior. At minimum, escalate the log to `error` and add a metric.
**Confidence:** high

### [HIGH] middleware/gatewayAuth.ts:108 — HMAC gateway auth has no nonce/jti, requests replayable
**Category:** Security
**Status:** Accept
**Cross-pass:** Codex only
**What:** HMAC verification accepts any request within the 5-minute timestamp window; no nonce/jti to prevent replay.
**Why it matters:** A captured authenticated gateway request can be replayed for up to 5 minutes — useful as part of a chained attack.
**Repro / trigger:** Capture a valid HMAC'd request, replay within the timestamp window.
**Fix shape:** Add a nonce/jti to the signed payload and a short-TTL Redis set of recently-seen jtis; reject duplicates.
**Confidence:** high

### [HIGH] middleware/rateLimit.ts:86-95 — `getClientIp` trusts `x-forwarded-for` independently of Express `trust proxy`
**Category:** Security
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `getClientIp` reads `req.headers['x-forwarded-for']` and parses the *leftmost* value as the client IP, with the comment "Trust proxy is enabled, so x-forwarded-for is reliable". Express's trust-proxy setting in `index.ts` is `1` (single hop), meaning Express's `req.ip` will only trust the *rightmost* (last hop) entry. Reading the leftmost XFF entry directly bypasses that boundary — any upstream client can spoof their IP by prepending `X-Forwarded-For: 1.2.3.4` and evade per-IP rate limits.
**Why it matters:** Attacker can defeat login/register/2FA rate limits by rotating spoofed XFF headers, enabling credential stuffing and brute-force on auth endpoints (which depend on this exact middleware).
**Repro / trigger:** `curl -H 'X-Forwarded-For: 1.1.1.1' …` repeated with rotating values from the same source IP — each request gets a fresh rate-limit bucket. Codex repro: rotating `X-Forwarded-For: <random>` values.
**Fix shape:** Replace the manual XFF parse with `req.ip` (already proxy-aware) and only fall back to `socket.remoteAddress`. Honor Express `trust proxy: 1` — take the rightmost trusted hop, not the leftmost client-supplied value. Drop the leftmost-IP logic entirely.
**Confidence:** high

### [MEDIUM] middleware/apiVersion.ts:140-151 — `parseQueryVersion` accepts arrays as version string
**Category:** Null/undefined/boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** `req.query.api_version` is typed `string` but Express may produce `string | string[] | ParsedQs` when the same param appears multiple times. The cast `as string` followed by `.split('.')` will crash with `TypeError: query.split is not a function` if a client sends `?api_version=1&api_version=2`.
**Why it matters:** Trivially exploitable DoS — single GET with duplicated query param crashes the version middleware, returning 500.
**Repro / trigger:** `GET /api/v1/anything?api_version=1&api_version=2`.
**Fix shape:** Coerce to string with `Array.isArray(v) ? v[0] : v` and reject non-string types before `.split`.
**Confidence:** high

### [MEDIUM] middleware/apiVersion.ts:267 — Reads `req.apiVersion` without defining presence
**Category:** Logic/invariant violations
**Status:** Accept
**Cross-pass:** Claude only
**What:** `requireApiVersion` and `maxApiVersion` dereference `req.apiVersion.major` directly. If a router is configured with `requireApiVersion()` but `apiVersionMiddleware()` was not registered earlier in the chain, this throws `TypeError: Cannot read property 'major' of undefined` and crashes the request.
**Why it matters:** Misconfiguration footgun produces a 500 instead of a clear error. Type declaration `req.apiVersion: ApiVersion` (non-optional) hides the bug from `tsc`.
**Repro / trigger:** Mount `requireApiVersion(2)` on a sub-router that bypasses the global versioning middleware.
**Fix shape:** Make `Request.apiVersion?: ApiVersion` optional in the declaration and guard with a clear 500 + log if missing, OR default-assign inside the guard middleware.
**Confidence:** high

### [MEDIUM] middleware/auth.ts:157-160 — `optionalAuth` silently swallows token errors of all kinds
**Category:** Error handling
**Status:** Accept
**Cross-pass:** Claude only
**What:** Bare `catch (error)` with no log call. Includes DB errors from `resolveCurrentAccessTokenPayload` (revocation check), not just bad tokens. Violates project rule "Never empty catch blocks — at minimum `log.debug()`".
**Why it matters:** Loses observability into systemic auth failures on routes using optional auth (public reads with personalization). A widespread revocation-lookup outage would appear as anonymous traffic with no error trail.
**Repro / trigger:** Corrupt the access-token session row; `optionalAuth` silently treats the request as unauthenticated forever.
**Fix shape:** Distinguish JWT errors from infra errors. Log infra errors at `warn`, JWT errors at `debug`, then continue.
**Confidence:** high

### [MEDIUM] middleware/rateLimit.ts:285-316 — `combineRateLimits` races on `res.headersSent`
**Category:** Concurrency/async
**Status:** Accept
**Cross-pass:** Claude only
**What:** The inner promise resolves only after the wrapped middleware calls its `next` callback. But rate-limit middleware paths return synchronously on success and asynchronously on failure (the 429 path calls `res.status().json()` then never calls next). The code detects "blocked" by checking `res.headersSent` after `resolve()`, but if the rate-limit middleware writes the response *without* calling next at all (the 429 branch), `resolve()` never fires and the promise hangs forever.
**Why it matters:** Combined rate limits (used for login = IP+user) can deadlock a request when any inner limiter trips, exhausting connection pool slots.
**Repro / trigger:** Configure a route with `combineRateLimits(rateLimit('a'), rateLimit('b'))`; exceed limit `a`; the response is sent but the outer middleware never resolves.
**Fix shape:** Patch `res.end`/`res.json` to resolve the promise on first write, or refactor the inner middlewares to always call `next()` after sending the 429 response.
**Confidence:** medium

### [MEDIUM] middleware/requestTimeout.ts:131-137 — `wrappedNext` is unused; outer code calls it once synchronously
**Category:** Logic/invariant violations
**Status:** Accept
**Cross-pass:** Claude only
**What:** `wrappedNext` is defined to guard against double-`next()` after timeout, but the only call site is `wrappedNext()` at module top level — equivalent to the unwrapped `next()`. The wrapping has no effect: downstream middleware receives the raw `next`, not the guarded one, so a slow handler that calls `next()` *after* the 408 has been sent will still propagate through the chain.
**Why it matters:** The intended invariant ("no further middleware runs after timeout") is not actually enforced. Likely benign in practice (Express ignores writes after headersSent) but defeats the file's stated design.
**Repro / trigger:** Trigger timeout on a handler that calls `next()` after the 408; downstream middleware logs/errors run anyway.
**Fix shape:** Either propagate `wrappedNext` to downstream handlers, or remove the dead wrapper and document that 408 + headersSent is the actual guarantee.
**Confidence:** medium

### [MEDIUM] middleware/requestTimeout.ts:185-189 — `withTimeout` calls `next()` unconditionally; `timedOut` check is unreachable
**Category:** Logic/invariant violations
**Status:** Accept
**Cross-pass:** Claude only
**What:** `if (!timedOut) next()` runs synchronously immediately after setting the timeout, when `timedOut` is always false. The check is dead. Same dead-branch issue as `requestTimeout`.
**Why it matters:** Same as above — design intent not realized.
**Repro / trigger:** Static analysis of the branch shows it cannot be reached on the synchronous path.
**Fix shape:** Same fix as above, or remove the dead check.
**Confidence:** high

### [MEDIUM] middleware/resourceAccess.ts:91-101 — Sends 500 directly instead of `next(error)`
**Category:** Error handling
**Status:** Accept
**Cross-pass:** Claude only
**What:** On unexpected error from `getRole`, the factory responds with a hardcoded 500 JSON rather than calling `next(error)`. This bypasses the global error handler, request-correlation IDs in error responses, structured `ApiError` mapping, and may double-send if a later handler also responds. Project convention (per `validate.ts`) is to call `next(error)`.
**Why it matters:** Inconsistent error envelopes across the API; lost observability via the global error pipeline; cannot uniformly redact errors.
**Repro / trigger:** Make `getRole` throw; observe response envelope differs from rest of API.
**Fix shape:** Replace `res.status(500).json(...)` with `next(error)` and let the global error handler shape the response.
**Confidence:** high

### [LOW] middleware/csrf.ts:217-222 — `req.cookies` reassignment is a mutation footgun
**Category:** Logic/invariant violations
**Status:** Accept
**Cross-pass:** Claude only
**What:** `setAuthCookies` mutates `req.cookies` in place so that the freshly issued `generateCsrfToken` reads the new access cookie for HMAC binding. Comment notes scope is per-request, which is true — but the spread `...(req.cookies ?? {})` followed by overwriting one key means subsequent middleware on the SAME request that reads `req.cookies[SANCTUARY_ACCESS_COOKIE_NAME]` will see the new token even though the browser still holds the old one until the response is delivered. Currently safe because `setAuthCookies` is the last touch before response, but a future maintainer adding post-login middleware (e.g. analytics) could be surprised.
**Why it matters:** Subtle state leak between in-flight request and persisted browser state; hidden coupling.
**Repro / trigger:** Add a post-login middleware that reads `req.cookies[SANCTUARY_ACCESS_COOKIE_NAME]`; it observes the post-login token before the browser does.
**Fix shape:** Document the constraint inline more loudly, or pass the new access token explicitly to `generateCsrfToken` via the options arg instead of mutating req.cookies.
**Confidence:** medium

### [LOW] middleware/gatewayAuth.ts:87-88 — Header type cast `as string | undefined` ignores array case
**Category:** Null/undefined/boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** `req.headers['x-gateway-signature'] as string | undefined` masks the array case. Node permits duplicate request headers, and while these specific custom headers are unlikely to be duplicated, the cast suppresses a real type union. If a client sends two signatures, the value is an array and `Buffer.from(provided, 'hex')` throws because `provided` is `string[]`.
**Why it matters:** Trivial crash via duplicate-header request — likely caught and 403'd in `compareSignatures`'s try/catch but still 403 instead of the intended 400.
**Repro / trigger:** Send two `X-Gateway-Signature` headers on the same request.
**Fix shape:** Coerce/reject arrays explicitly like csrf.ts does at line 106.
**Confidence:** medium

### [LOW] middleware/i18n.ts:88 — `getRequestLocale` falls back to literal `'en'` even when `i18nService` has a different default
**Category:** Logic/invariant violations
**Status:** Accept
**Cross-pass:** Claude only
**What:** Hardcoded `'en'` fallback if `req.locale` is unset, ignoring `i18nService.getDefaultLocale()` (or equivalent). If a service is invoked outside the middleware chain (e.g., from a queue worker), it will get `'en'` regardless of system-configured default.
**Why it matters:** Inconsistent default behavior between HTTP and non-HTTP code paths.
**Repro / trigger:** Configure system default locale to non-`'en'`; observe HTTP-side helper returns `'en'` anyway when middleware skipped.
**Fix shape:** Either delegate to `i18nService` for the default, or document the fallback intent.
**Confidence:** low

### [LOW] middleware/metrics.ts:82-86 — `Content-Length` header trusted without validation
**Category:** Null/undefined/boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** `parseInt(req.headers['content-length'] || '0', 10)` accepts any client-supplied value and feeds it to `httpRequestSize.observe`. Negative or huge values pollute histogram buckets. `Number.isFinite` not checked.
**Why it matters:** Metrics-cardinality / histogram pollution by hostile clients. Low impact.
**Repro / trigger:** `curl -H 'Content-Length: 999999999999'` on a small POST.
**Fix shape:** Validate the value is a finite positive number under a sane cap; otherwise observe 0 or skip.
**Confidence:** low

### [LOW] middleware/rateLimit.ts:89-92 — XFF leftmost parse can produce empty string on malformed header
**Category:** Null/undefined/boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** If `x-forwarded-for: , 1.2.3.4`, `split(',')[0]` returns `''` and the key becomes `ip:`. All such requests collide on a single rate-limit bucket.
**Why it matters:** Edge case allowing trivial co-grouping; minor side effect of the larger XFF issue above.
**Repro / trigger:** Send `X-Forwarded-For: , 1.2.3.4`.
**Fix shape:** Same fix as the high-severity XFF item — use `req.ip`.
**Confidence:** medium

### [LOW] middleware/requestLogger.ts:39-40 — Trusts `X-Request-ID` from arbitrary clients
**Category:** Security
**Status:** Accept
**Cross-pass:** Claude only
**What:** Uses the client-supplied `x-request-id` / `x-correlation-id` header value as the request ID, then echoes it back and uses it for log correlation. An attacker can inject log-correlation values, including newline characters if downstream loggers don't sanitize. Project's `createLogger` likely handles this, but accepting client request IDs without validation is generally unsafe.
**Why it matters:** Log injection / poisoning of correlation analytics. Common pattern, but worth validating format (UUID/ULID) before accepting.
**Repro / trigger:** `curl -H 'X-Request-ID: $(printf "abc\\ninjected-log-line")'`.
**Fix shape:** Validate incoming header matches expected ID format (UUID/ULID); otherwise generate a fresh one.
**Confidence:** medium

## Considered & rejected

_None._

## Deferred

_None._
