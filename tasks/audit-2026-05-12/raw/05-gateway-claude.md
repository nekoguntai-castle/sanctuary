# Gateway Audit — 2026-05-12

Scope: `gateway/src/**` (26 files). Edge proxy. Severity classified per audit brief.

---

### [HIGH] gateway/src/index.ts:39 — `trust proxy` never configured; rate-limit IP keying collapses behind any proxy
**Category:** Security
**What:** The Express app is created without `app.set('trust proxy', ...)`. Because the gateway is a public-facing edge service, in nearly every realistic deployment (Umbrel reverse proxy, container ingress, TLS terminator in front) `req.ip` reduces to the upstream proxy address rather than the real client.
**Why it matters:** All rate limiters (default/strict/auth/transactionCreate/broadcast/deviceRegistration/addressGeneration) call `ipKeyGenerator(req.ip)` for unauthenticated traffic. With one bucket for the whole world, the auth brute-force limiter and the coarse `/api` valve are effectively neutered, and a single noisy client can DoS every other user (shared key triggers 429 for everyone). `requestLogger.getClientIp` does read `x-forwarded-for`, but that value is never threaded into rate limiting, so the logging path and the enforcement path disagree about who the client is.
**Repro / trigger:** Deploy behind any L7 proxy that terminates TLS or simply rewrites Host. Hammer `/api/v1/auth/login` from many client IPs — all share the proxy's IP key.
**Fix shape:** Set `app.set('trust proxy', <number-of-hops>)` driven by config (don't use `true`, which is permissive and lets clients spoof XFF). Reuse the same trust value inside `getClientIp`. Document the assumed topology in `config.ts`.
**Confidence:** high

---

### [HIGH] gateway/src/services/backendEvents/index.ts:101 — Unhandled rejection from `handleEvent` inside WS message listener
**Category:** Concurrency/async
**What:** `handleEvent(message.event as BackendEvent)` is invoked without `await` or `.catch`. The surrounding `try { ... } catch` only catches synchronous throws from `JSON.parse` and the auth branches; an `await getDevicesForUser`, `push.sendToDevices`, or `removeInvalidDevice` rejection inside `handleEvent` escapes to the event loop as an unhandled promise rejection.
**Why it matters:** Process behavior on unhandled rejections is governed by `fatalProcessHandlers`, which (by name and project pattern) crashes the gateway. A single malformed backend event or transient FCM/APNs error can kill the whole edge process and trigger a shutdown loop. Even without crash semantics, errors are silently swallowed and not logged with event context.
**Repro / trigger:** Backend emits a `transaction` event whose `userId` resolves to a user whose APNs/FCM call throws (network blip, invalid key), then any chained `removeInvalidDevice` failure surfaces as an unhandled rejection.
**Fix shape:** `void handleEvent(...).catch(err => log.error('handleEvent failed', { error: getErrorMessage(err), eventType: message.type }))`. Consider hardening `handleEvent` to never reject (it mostly catches internally already, but the chained `for` loop on invalid tokens does not).
**Confidence:** high

---

### [HIGH] gateway/src/routes/proxy/proxyConfig.ts:37-42 — User-identity headers forwarded to backend without HMAC binding
**Category:** Security (logic/invariant)
**What:** Proxied requests get `X-Gateway-User-Id` / `X-Gateway-Username` / `X-Gateway-Request: true` injected based on JWT claims, but those headers are **not** signed with `GATEWAY_SECRET`. Only the internal `/internal/...` and `/api/v1/push/gateway-audit` calls (mobilePermission.ts, requestLogger.ts, deviceTokens.ts) use `generateGatewaySignature`. The proxied user-bearing path does not.
**Why it matters:** The gateway/backend trust model relies on network isolation: any actor who can reach the backend directly (network misconfig, internal pivot, sibling-container compromise, `BACKEND_URL` pointed at an attacker-controlled host that then re-proxies) can forge `X-Gateway-User-Id: <any-user>` because the header has no cryptographic provenance. The HMAC scheme already exists for sibling endpoints — there's no reason proxied requests are excluded except oversight. Header injection from the client side is mitigated by `proxyReq.setHeader` overwriting client headers (good), so the gap is purely the missing signature.
**Repro / trigger:** Misconfigure `BACKEND_URL`, break out of the docker network, or compromise any service in the same internal subnet → impersonate any user by sending `X-Gateway-User-Id` + `X-Gateway-Request: true`.
**Fix shape:** Generate an HMAC over `(method, path, userId, username, timestamp)` in the `proxyReq` hook and attach as `X-Gateway-Signature` + `X-Gateway-Timestamp`; backend rejects requests with `X-Gateway-Request: true` lacking a valid signature.
**Confidence:** medium

---

### [HIGH] gateway/src/middleware/auth.ts:155-158 — `X-Device-Id` accepted without length/charset validation, then echoed into logs and downstream
**Category:** Null/undefined/boundary
**What:** `req.headers['x-device-id']` is type-checked as string but otherwise unbounded. It is stored on the request, logged unsanitized, and travels into audit events.
**Why it matters:** A client can supply a multi-kilobyte `X-Device-Id` (multiple headers concatenated, or a single huge header up to Node's `--max-http-header-size`, ~16KB default) and force the gateway to log/persist that bulk on every request. Crucially, when this value lands in audit payloads sent to the backend (`sendToBackendAudit`), it inflates JSON bodies and could feed log injection via embedded newlines/control characters since downstream sanitization is not guaranteed.
**Repro / trigger:** `curl -H 'X-Device-Id: <8KB string with \r\n>' …` against any authenticated route.
**Fix shape:** Validate device IDs against a strict charset and a small max length (e.g., UUID or `^[A-Za-z0-9._:-]{1,128}$`); reject otherwise. Do the same for client-supplied IDs in `requestLogger` before logging.
**Confidence:** medium

---

### [MEDIUM] gateway/src/services/backendEvents/eventHandler.ts:65-67 — Serial `await` loop on invalid-token cleanup amplifies latency and hides errors
**Category:** Concurrency/async
**What:** `for (const invalidToken of result.invalidTokens) { await removeInvalidDevice(...); }` serializes N HTTP calls to backend.
**Why it matters:** When push token churn spikes (mass FCM token expiry, app reinstall wave), each event spends N × backend-RTT processing time, starving the WS message loop. `handleEvent` is awaited (or should be), so further events queue. `removeInvalidDevice` swallows errors internally, so a backend outage extends latency rather than failing fast.
**Repro / trigger:** A burst of events for users whose tokens are all expired.
**Fix shape:** `await Promise.allSettled(result.invalidTokens.map(removeInvalidDevice))`. Consider a bounded concurrency wrapper if backend is fragile.
**Confidence:** high

---

### [MEDIUM] gateway/src/middleware/corsOrigin.ts:33 — No validation that allowlist entries are syntactically valid origins
**Category:** Security
**What:** `CORS_ALLOWED_ORIGINS` is split on `,`, trimmed, and stored in a `Set` with no schema check. A misconfigured entry like `*` or `https://evil.com,` (note trailing comma producing an empty string filtered out — OK), or a Punycode/IDN homograph (`https://раypal.com`), or just `https://example.com/` with a trailing slash that won't match the browser's `Origin` (no trailing slash), all go in unchecked.
**Why it matters:** Combined with `credentials: true`, an over-permissive entry produces classic credentialed-CORS exposure. Conversely, a near-miss (trailing slash, wrong scheme) silently fails closed and gets blamed as a frontend bug. There's no startup log of the parsed allowlist, so misconfig is invisible.
**Repro / trigger:** Operator sets `CORS_ALLOWED_ORIGINS=https://app.example.com/` (with slash) — the Set never matches the actual `Origin: https://app.example.com` header.
**Fix shape:** On startup, parse each entry with `new URL()`, reject anything that has a path/search/hash, canonicalize to `${protocol}//${host}`, reject `null`/`*`, log the resolved allowlist at info level. Fail startup on parse errors.
**Confidence:** high

---

### [MEDIUM] gateway/src/index.ts:64-74 — Coarse `/api` rate-limit uses default IP keying; no skip for protected routes already metered
**Category:** Logic/invariant
**What:** The coarse valve is `maxRequests * 10` per window per IP and applies to every `/api/*` request. Combined with the per-route limiters downstream (default/transaction/broadcast/etc.), an authenticated user shares a coarse bucket keyed on the proxy IP (see #1) with all other users, even though the per-route limiters are user-keyed.
**Why it matters:** The coarse limit becomes the binding constraint in production behind a proxy: one user's traffic drives 429s for unrelated users. Removing it isn't right either, but as written it competes with the per-user limiters rather than complementing them.
**Repro / trigger:** Multiple users behind a shared egress (e.g., Tor, corporate NAT, or just the LB) — first to 600 rpm gets everyone limited.
**Fix shape:** Fix trust proxy (issue #1), then switch the coarse valve's `keyGenerator` to `getClientKey` so it cooperates with per-route limiters; or drop it entirely once trust-proxy is correct since `defaultRateLimiter` covers `/api/v1/*`.
**Confidence:** medium

---

### [MEDIUM] gateway/src/middleware/requestLogger.ts:64-87 — Audit POST signs object whose `severity` field is derived from caller-controlled details
**Category:** Security
**What:** `sendToBackendAudit` constructs `body` with `severity: details.severity || 'info'` from `details`, then signs the resulting body via `generateGatewaySignature`. `details` originates from `logSecurityEvent` callers, several of whom merge HTTP-derived headers (e.g., `userAgent`, `path`) into `details`. There is no validation that `details.severity` is one of the expected enum values.
**Why it matters:** If a future caller forwards a request header into `details` and that header sneaks in a `severity` key (via JSON.parse of some payload, or a typo in field-name mapping), the backend audit pipeline could be poisoned to mark hostile traffic as `severity: 'info'` or vice versa. Lower severity here, but the validation gap is real.
**Repro / trigger:** Code change that does `logSecurityEvent('X', { ...req.body })` — not present today, but the function shape invites it.
**Fix shape:** Whitelist `severity` to `'low'|'medium'|'high'|'info'` and reject `severity` on the inbound `details` shape via a Zod schema.
**Confidence:** low

---

### [MEDIUM] gateway/src/middleware/mobilePermission.ts:115 — `walletId` taken from params without UUID-shape validation
**Category:** Null/undefined/boundary
**What:** `const walletId = (req.params.id || req.params.walletId) as string;` is forwarded verbatim into the HMAC-signed body sent to backend.
**Why it matters:** Express params are URL-decoded but un-validated. A path like `/wallets/..%2f..%2fadmin/transactions/create` (after express decodes) yields `walletId = '../../admin'`. The whitelist regex on the proxy side validates UUID shape for routes that include it, but `requireMobilePermission` runs *after* `checkWhitelist` only for the routes wired in `proxy/index.ts`; standalone unit tests or future re-wiring could skip the whitelist. Defense-in-depth says validate twice.
**Repro / trigger:** Future refactor that calls `requireMobilePermission` without `checkWhitelist` first.
**Fix shape:** Validate UUID shape at the top of `requireMobilePermission`; return 400 otherwise. Do not rely on regex ordering elsewhere.
**Confidence:** medium

---

### [MEDIUM] gateway/src/services/backendEvents/index.ts:71 — `JSON.parse(data.toString())` against raw WS frame without size/shape validation
**Category:** TypeScript rules / Null-boundary
**What:** Incoming WebSocket frames are blindly `JSON.parse`'d, then `message.type` and `message.event` are accessed without schema validation. `data.toString()` on a `Buffer` is fine, but `ws` can deliver fragments, arraybuffers, or arrays of buffers depending on options.
**Why it matters:** Beyond the unhandled-rejection issue (#2), a hostile or buggy backend (or anyone who can MITM a non-TLS internal WS) can inject events of arbitrary shape that flow into `handleEvent` → `push.sendToDevices` → FCM/APNs with `walletName` or `creatorName` strings of unbounded length, embedded control characters, or unicode that survives into push payloads. There's also no protection against giant frames before parse.
**Repro / trigger:** Backend bug emits `{ type: 'transaction', data: { type: '__proto__', amount: 0, txid: 'a' } }` — `toTransactionNotificationType` falls through to the cast and pushes a notification with type `'__proto__'`.
**Fix shape:** Wrap `JSON.parse` in `safeJsonParse` and validate the message against a Zod schema covering `auth_challenge | auth_success | event`. Configure `ws` with `maxPayload` and use `ws.on('message', (data, isBinary) => …)` to reject binary frames.
**Confidence:** medium

---

### [MEDIUM] gateway/src/index.ts:272 + 270-271 — Fatal handlers registered AFTER `SIGTERM`/`SIGINT`; race during early startup
**Category:** Concurrency/async
**What:** Two explicit `process.on('SIGTERM'|'SIGINT', shutdown)` are wired immediately, then `registerFatalProcessHandlers({...})` is called. If the shared helper also installs SIGTERM/SIGINT handlers (typical for fatal-process consolidation), order of execution is determined by registration order. More importantly, any error thrown by `validateConfig()` or `loadTlsCertificates()` runs **before** fatal handlers are registered, so the safety net isn't installed yet during the most failure-prone phase.
**Why it matters:** Early-startup crashes won't go through the central handler, so logging/exit-code/cleanup contracts diverge for the early window. Not exploitable, but a foot-gun if anyone relies on the central handler for, e.g., audit emission on crash.
**Repro / trigger:** Misconfigure `JWT_SECRET=""` → `validateConfig` calls `exitNow(1)` before any of `index.ts`'s handlers are in place.
**Fix shape:** Call `registerFatalProcessHandlers(...)` first thing after imports, before `validateConfig()`. Then register signal handlers (or fold them into the helper).
**Confidence:** medium

---

### [MEDIUM] gateway/src/middleware/rateLimit/backoff.ts:22 — Unbounded `Map` keyed on user-controllable identifiers
**Category:** Resource leaks
**What:** `backoffTracker` keys are `userId || ipKey || auth:<ipKey>`. Cleanup runs every 5 minutes and only evicts entries older than `windowMs * 2` (default 2 minutes). With aggressive sustained attack from many spoofed (or just rotating) sources, the map grows for up to 5 minutes between cleanups.
**Why it matters:** Behind the missing trust-proxy fix, IP keys collapse so this is small. Once trust proxy is correct, an attacker churning IPs can fill the map to ~unbounded size in 5 minutes. Each entry is small (~60 bytes) so this is more a smell than a kill, but combined with the global `setInterval(cleanupBackoffTracker, 5min)` it's a noticeable memory wobble.
**Repro / trigger:** Generate auth attempts from many IPs over 5 minutes.
**Fix shape:** Bound the map with an LRU (`lru-cache`) of, say, 100k entries; or run cleanup every windowMs instead of every 5 min; or expire on read in `calculateBackoff` so eviction is amortized.
**Confidence:** medium

---

### [LOW] gateway/src/middleware/auth.ts:46-47 — Optional-auth sentinel runs full `jwt.verify` on a known-invalid token
**Category:** Logic/invariant (smell)
**What:** `verifyOptionalAccessToken(null)` substitutes `'sanctuary-optional-auth-missing-token'` and runs `jwt.verify` which always throws — caught and swallowed.
**Why it matters:** Wasted CPU on every unauthenticated optional-auth request. The literal sentinel is also indistinguishable from a real token in logs if `jwt.verify` ever logs its input via a debugger or future instrumentation.
**Repro / trigger:** Any anonymous `optionalAuth` route hit (none currently use it, but the function is exported).
**Fix shape:** Early-return `undefined` when the token argument is null/empty before calling `verifyAccessToken`.
**Confidence:** high

---

### [LOW] gateway/src/utils/logger.ts:37,42,47 — Logger uses `console.log`/`warn`/`error` directly
**Category:** TypeScript rules
**What:** Project rule: "Never `console.log` — use `createLogger()` from `utils/logger`." This *is* the logger, so it's the legitimate sink, but the rule's intent (centralization) is preserved. Calling out for completeness — not a defect.
**Why it matters:** N/A. Flagging only because the audit brief asks for `console.log` hits.
**Repro / trigger:** N/A.
**Fix shape:** No action needed.
**Confidence:** high

---

### [LOW] gateway/src/config.ts:107,117 — `FCM_PRIVATE_KEY` / `APNS_PRIVATE_KEY` may end up logged via env-dump tooling
**Category:** Security (secret hygiene)
**What:** Secrets are loaded from env, `.replace(/\\n/g, '\n')` is applied. Not logged here, but neither marked nor protected against accidental `JSON.stringify(config)` elsewhere.
**Why it matters:** A future debug log or `/info` endpoint expansion could dump them. The shared redaction utility (`stringifyRedacted`) is used in the logger — confirm it covers `privateKey`/`gatewaySecret`/`jwtSecret` keys.
**Repro / trigger:** Anyone adds `log.debug('config', { config })`.
**Fix shape:** Verify `stringifyRedacted` redacts `privateKey`/`*Secret`/`*Key` keys; add to its denylist if missing. Optionally wrap config secrets in a branded type that forbids accidental serialization.
**Confidence:** low

---

### [LOW] gateway/src/routes/proxy/proxyConfig.ts:65 — Proxy error handler casts `res` to `Response` without checking it's an HTTP response
**Category:** TypeScript rules
**What:** `http-proxy-middleware`'s `error` callback can fire on WebSocket upgrade failures where `res` is actually a `Socket`. `(res as Response).status(502).json(...)` then crashes (TypeError) inside the error handler itself.
**Why it matters:** A malformed upgrade request to a proxied route (gateway doesn't currently proxy WS through `http-proxy-middleware`, but defense-in-depth) crashes the worker.
**Repro / trigger:** Send `Upgrade: websocket` to `/api/v1/wallets/<uuid>/transactions/create` and break backend mid-connect.
**Fix shape:** Type-guard `res` (`if (!('status' in res)) { (res as Socket).destroy(); return; }`).
**Confidence:** low

---

## Summary

**Severity counts:** Critical 0, High 4, Medium 7, Low 4 (16 findings total).

**Top 3 by impact:**
1. **Missing `trust proxy` collapses rate-limit IP keying** (`index.ts`) — neuters the brute-force defense on `/api/v1/auth` and turns per-route limiters into a shared bucket behind any proxy. Single config line fix, huge security impact.
2. **Unhandled rejection in WS event dispatch** (`backendEvents/index.ts:101`) — a single bad backend event or transient push failure crashes the gateway via the fatal-process handler.
3. **User-identity headers unsigned on proxied requests** (`proxyConfig.ts`) — backend trusts `X-Gateway-User-Id` based on network isolation alone; HMAC pattern already exists elsewhere and should be extended here.

**Files reviewed (26):** `config.ts`, `index.ts`, `middleware/{auth, corsOrigin, mobilePermission, requestLogger, trailingSlash, validateRequest}.ts`, `middleware/rateLimit/{backoff, index, limiters}.ts`, `routes/proxy/{index, proxyConfig, whitelist}.ts`, `services/backendEvents/{auth, deviceTokens, eventHandler, index, notifications, types}.ts`, `services/push/{apns, fcm, index}.ts`, `utils/{fatalProcessHandlers, logger, processExit}.ts`. Legacy `utils/` shims (per brief) were not flagged.
