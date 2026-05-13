# Phase C — gateway (merged)

**Source:** raw/05-gateway-claude.md + raw/05-gateway-codex.md
**Date:** 2026-05-12

## Summary

| Severity | Claude | Codex | Merged | Dual-flagged |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 4 | 3 | 6 | 1 |
| Medium | 7 | 5 | 9 | 0 |
| Low | 4 | 2 | 6 | 0 |

**Note:** Codex file was reconstructed from inline summary; ~5 medium and ~1 low Codex entries exist (per counts) but were not enumerated. The merged medium/low totals reflect Claude's enumerated entries plus Codex's named entries; un-enumerated Codex medium/low are acknowledged but not itemized.

**Accepted:** 20 · **Rejected:** 1 · **Deferred:** 0

Codex flagged additional medium/low (approximately 5 medium + 1 low) not enumerated in the reconstructed file; these are noted but cannot be merged item-by-item.

---

## Findings (accepted)

### [HIGH] gateway/src/index.ts:39 — `trust proxy` never configured; rate-limit IP keying collapses behind any proxy
**Category:** Security
**Status:** Accept
**Cross-pass:** Claude only
**What:** The Express app is created without `app.set('trust proxy', ...)`. Because the gateway is a public-facing edge service, in nearly every realistic deployment (Umbrel reverse proxy, container ingress, TLS terminator in front) `req.ip` reduces to the upstream proxy address rather than the real client.
**Why it matters:** All rate limiters (default/strict/auth/transactionCreate/broadcast/deviceRegistration/addressGeneration) call `ipKeyGenerator(req.ip)` for unauthenticated traffic. With one bucket for the whole world, the auth brute-force limiter and the coarse `/api` valve are effectively neutered, and a single noisy client can DoS every other user (shared key triggers 429 for everyone). `requestLogger.getClientIp` does read `x-forwarded-for`, but that value is never threaded into rate limiting, so the logging path and the enforcement path disagree about who the client is.
**Repro / trigger:** Deploy behind any L7 proxy that terminates TLS or simply rewrites Host. Hammer `/api/v1/auth/login` from many client IPs — all share the proxy's IP key.
**Fix shape:** Set `app.set('trust proxy', <number-of-hops>)` driven by config (don't use `true`, which is permissive and lets clients spoof XFF). Reuse the same trust value inside `getClientIp`. Document the assumed topology in `config.ts`.
**Confidence:** high

---

### [HIGH] gateway/src/middleware/auth.ts:155-158 — `X-Device-Id` accepted without length/charset validation, then echoed into logs and downstream
**Category:** Null/undefined/boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** `req.headers['x-device-id']` is type-checked as string but otherwise unbounded. It is stored on the request, logged unsanitized, and travels into audit events.
**Why it matters:** A client can supply a multi-kilobyte `X-Device-Id` (multiple headers concatenated, or a single huge header up to Node's `--max-http-header-size`, ~16KB default) and force the gateway to log/persist that bulk on every request. Crucially, when this value lands in audit payloads sent to the backend (`sendToBackendAudit`), it inflates JSON bodies and could feed log injection via embedded newlines/control characters since downstream sanitization is not guaranteed.
**Repro / trigger:** `curl -H 'X-Device-Id: <8KB string with \r\n>' …` against any authenticated route.
**Fix shape:** Validate device IDs against a strict charset and a small max length (e.g., UUID or `^[A-Za-z0-9._:-]{1,128}$`); reject otherwise. Do the same for client-supplied IDs in `requestLogger` before logging.
**Confidence:** medium

---

### [HIGH] gateway/src/middleware/mobilePermission.ts:87 — Fail-open permission gate (truthy-string bug)
**Category:** Security / logic
**Status:** Accept
**Cross-pass:** Codex only
**What:** Permission gate accepts `{"allowed":"false"}` (truthy string) as permitting the action.
**Why it matters:** A misformatted or malicious backend response grants wallet-scoped actions (transactions, addresses, PSBTs). Any non-boolean truthy value (including the literal string `"false"`) bypasses the gate.
**Repro / trigger:** Backend returns JSON with `allowed` as the literal string `"false"` instead of boolean `false`.
**Fix shape:** Strict equality check `=== true`; type-narrow before evaluating. Add a Zod schema to validate the permission-response shape.
**Confidence:** high

---

### [HIGH] gateway/src/routes/proxy/proxyConfig.ts:23 + gateway/src/middleware/mobilePermission.ts:63 — No outbound timeout on backend / permission-check fetch
**Category:** Resource / DoS
**Status:** Accept
**Cross-pass:** Codex only
**What:** Outbound fetches to backend (proxy + permission-check) have no timeout. Sockets accumulate indefinitely when the backend stalls.
**Why it matters:** A slow backend ties up gateway sockets and degrades the internet-facing edge until process restart. The gateway is the public-facing edge — socket exhaustion here is a full availability outage, not just a partial degradation.
**Repro / trigger:** Backend response stalls (network blip, slow query); gateway sockets accumulate until the worker stops accepting connections.
**Fix shape:** Add `AbortController` with a bounded timeout (e.g., 10–30s tuned per route) to all outbound fetches; surface timeouts as 504 to the client. Apply consistently across `proxyConfig`, `mobilePermission`, `requestLogger` audit POST, and `deviceTokens` removals.
**Confidence:** high

---

### [HIGH] gateway/src/routes/proxy/proxyConfig.ts:37-42 — User-identity headers forwarded to backend without HMAC binding
**Category:** Security (logic/invariant)
**Status:** Accept
**Cross-pass:** Claude only
**What:** Proxied requests get `X-Gateway-User-Id` / `X-Gateway-Username` / `X-Gateway-Request: true` injected based on JWT claims, but those headers are **not** signed with `GATEWAY_SECRET`. Only the internal `/internal/...` and `/api/v1/push/gateway-audit` calls (mobilePermission.ts, requestLogger.ts, deviceTokens.ts) use `generateGatewaySignature`. The proxied user-bearing path does not.
**Why it matters:** The gateway/backend trust model relies on network isolation: any actor who can reach the backend directly (network misconfig, internal pivot, sibling-container compromise, `BACKEND_URL` pointed at an attacker-controlled host that then re-proxies) can forge `X-Gateway-User-Id: <any-user>` because the header has no cryptographic provenance. The HMAC scheme already exists for sibling endpoints — there's no reason proxied requests are excluded except oversight. Header injection from the client side is mitigated by `proxyReq.setHeader` overwriting client headers (good), so the gap is purely the missing signature.
**Repro / trigger:** Misconfigure `BACKEND_URL`, break out of the docker network, or compromise any service in the same internal subnet → impersonate any user by sending `X-Gateway-User-Id` + `X-Gateway-Request: true`.
**Fix shape:** Generate an HMAC over `(method, path, userId, username, timestamp)` in the `proxyReq` hook and attach as `X-Gateway-Signature` + `X-Gateway-Timestamp`; backend rejects requests with `X-Gateway-Request: true` lacking a valid signature.
**Confidence:** medium

---

### [HIGH] gateway/src/services/backendEvents/index.ts:101 — Unhandled rejection from `handleEvent` inside WS message listener
**Category:** Concurrency/async
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `handleEvent(message.event as BackendEvent)` is invoked without `await` or `.catch`. The surrounding `try { ... } catch` only catches synchronous throws from `JSON.parse` and the auth branches; an `await getDevicesForUser`, `push.sendToDevices`, or `removeInvalidDevice` rejection inside `handleEvent` escapes to the event loop as an unhandled promise rejection. Codex additionally notes that raw `JSON.parse` plus missing-field paths compound the rejection surface.
**Why it matters:** Process behavior on unhandled rejections is governed by `fatalProcessHandlers`, which crashes the gateway. A single malformed backend event or transient FCM/APNs error can kill the whole edge process and trigger a shutdown loop. Even without crash semantics, errors are silently swallowed and not logged with event context.
**Repro / trigger:** Backend emits a `transaction` event whose `userId` resolves to a user whose APNs/FCM call throws (network blip, invalid key); chained `removeInvalidDevice` failure surfaces as an unhandled rejection. Or: backend emits a conforming-shape event missing a required nested field.
**Fix shape:** `void handleEvent(...).catch(err => log.error('handleEvent failed', { error: getErrorMessage(err), eventType: message.type }))`. Validate parsed JSON shape (Zod) before dispatch. Harden `handleEvent` to never reject (the chained invalid-token `for` loop is the main offender).
**Confidence:** high

---

### [MEDIUM] gateway/src/services/push/apns.ts:99 — Raw APNs device tokens logged on failure
**Category:** Security (PII / token hygiene)
**Status:** Accept
**Cross-pass:** Codex only
**What:** APNs error path logs the full raw device token on failure.
**Why it matters:** APNs device tokens are sensitive identifiers — leaking them into log aggregation (Loki/Promtail, etc.) lets anyone with log access send arbitrary pushes to affected devices, and conflates them with PII for the device owner.
**Repro / trigger:** Any APNs send failure (invalid token, network error) on a token that has not yet been pruned.
**Fix shape:** Log only a short hash/prefix (`token.slice(0, 8) + '…'` or a stable hash). Audit `fcm.ts` for the same pattern.
**Confidence:** high

---

### [MEDIUM] gateway/src/services/backendEvents/eventHandler.ts:65-67 — Serial `await` loop on invalid-token cleanup amplifies latency and hides errors
**Category:** Concurrency/async
**Status:** Accept
**Cross-pass:** Claude only
**What:** `for (const invalidToken of result.invalidTokens) { await removeInvalidDevice(...); }` serializes N HTTP calls to backend.
**Why it matters:** When push token churn spikes (mass FCM token expiry, app reinstall wave), each event spends N × backend-RTT processing time, starving the WS message loop. `handleEvent` is awaited (or should be), so further events queue. `removeInvalidDevice` swallows errors internally, so a backend outage extends latency rather than failing fast.
**Repro / trigger:** A burst of events for users whose tokens are all expired.
**Fix shape:** `await Promise.allSettled(result.invalidTokens.map(removeInvalidDevice))`. Consider a bounded concurrency wrapper if backend is fragile.
**Confidence:** high

---

### [MEDIUM] gateway/src/index.ts:64-74 — Coarse `/api` rate-limit uses default IP keying; no skip for protected routes already metered
**Category:** Logic/invariant
**Status:** Accept
**Cross-pass:** Claude only
**What:** The coarse valve is `maxRequests * 10` per window per IP and applies to every `/api/*` request. Combined with the per-route limiters downstream (default/transaction/broadcast/etc.), an authenticated user shares a coarse bucket keyed on the proxy IP (see trust-proxy issue) with all other users, even though the per-route limiters are user-keyed.
**Why it matters:** The coarse limit becomes the binding constraint in production behind a proxy: one user's traffic drives 429s for unrelated users. Removing it isn't right either, but as written it competes with the per-user limiters rather than complementing them.
**Repro / trigger:** Multiple users behind a shared egress (e.g., Tor, corporate NAT, or just the LB) — first to 600 rpm gets everyone limited.
**Fix shape:** Fix trust proxy first, then switch the coarse valve's `keyGenerator` to `getClientKey` so it cooperates with per-route limiters; or drop it entirely once trust-proxy is correct since `defaultRateLimiter` covers `/api/v1/*`.
**Confidence:** medium

---

### [MEDIUM] gateway/src/index.ts:272 + 270-271 — Fatal handlers registered AFTER `SIGTERM`/`SIGINT`; race during early startup
**Category:** Concurrency/async
**Status:** Accept
**Cross-pass:** Claude only
**What:** Two explicit `process.on('SIGTERM'|'SIGINT', shutdown)` are wired immediately, then `registerFatalProcessHandlers({...})` is called. If the shared helper also installs SIGTERM/SIGINT handlers (typical for fatal-process consolidation), order of execution is determined by registration order. More importantly, any error thrown by `validateConfig()` or `loadTlsCertificates()` runs **before** fatal handlers are registered, so the safety net isn't installed yet during the most failure-prone phase.
**Why it matters:** Early-startup crashes won't go through the central handler, so logging/exit-code/cleanup contracts diverge for the early window. Not exploitable, but a foot-gun if anyone relies on the central handler for, e.g., audit emission on crash.
**Repro / trigger:** Misconfigure `JWT_SECRET=""` → `validateConfig` calls `exitNow(1)` before any of `index.ts`'s handlers are in place.
**Fix shape:** Call `registerFatalProcessHandlers(...)` first thing after imports, before `validateConfig()`. Then register signal handlers (or fold them into the helper).
**Confidence:** medium

---

### [MEDIUM] gateway/src/middleware/corsOrigin.ts:33 — No validation that allowlist entries are syntactically valid origins
**Category:** Security
**Status:** Accept
**Cross-pass:** Claude only
**What:** `CORS_ALLOWED_ORIGINS` is split on `,`, trimmed, and stored in a `Set` with no schema check. A misconfigured entry like `*` or `https://evil.com,` (trailing comma producing an empty string filtered out — OK), a Punycode/IDN homograph (`https://раypal.com`), or `https://example.com/` with a trailing slash that won't match the browser's `Origin` (no trailing slash) all go in unchecked.
**Why it matters:** Combined with `credentials: true`, an over-permissive entry produces classic credentialed-CORS exposure. Conversely, a near-miss (trailing slash, wrong scheme) silently fails closed and gets blamed as a frontend bug. There's no startup log of the parsed allowlist, so misconfig is invisible.
**Repro / trigger:** Operator sets `CORS_ALLOWED_ORIGINS=https://app.example.com/` (with slash) — the Set never matches the actual `Origin: https://app.example.com` header.
**Fix shape:** On startup, parse each entry with `new URL()`, reject anything that has a path/search/hash, canonicalize to `${protocol}//${host}`, reject `null`/`*`, log the resolved allowlist at info level. Fail startup on parse errors.
**Confidence:** high

---

### [MEDIUM] gateway/src/middleware/mobilePermission.ts:115 — `walletId` taken from params without UUID-shape validation
**Category:** Null/undefined/boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** `const walletId = (req.params.id || req.params.walletId) as string;` is forwarded verbatim into the HMAC-signed body sent to backend.
**Why it matters:** Express params are URL-decoded but un-validated. A path like `/wallets/..%2f..%2fadmin/transactions/create` (after express decodes) yields `walletId = '../../admin'`. The whitelist regex on the proxy side validates UUID shape for routes that include it, but `requireMobilePermission` runs *after* `checkWhitelist` only for the routes wired in `proxy/index.ts`; standalone unit tests or future re-wiring could skip the whitelist. Defense-in-depth says validate twice.
**Repro / trigger:** Future refactor that calls `requireMobilePermission` without `checkWhitelist` first.
**Fix shape:** Validate UUID shape at the top of `requireMobilePermission`; return 400 otherwise. Do not rely on regex ordering elsewhere.
**Confidence:** medium

---

### [MEDIUM] gateway/src/middleware/rateLimit/backoff.ts:22 — Unbounded `Map` keyed on user-controllable identifiers
**Category:** Resource leaks
**Status:** Accept
**Cross-pass:** Claude only
**What:** `backoffTracker` keys are `userId || ipKey || auth:<ipKey>`. Cleanup runs every 5 minutes and only evicts entries older than `windowMs * 2` (default 2 minutes). With aggressive sustained attack from many spoofed (or just rotating) sources, the map grows for up to 5 minutes between cleanups.
**Why it matters:** Behind the missing trust-proxy fix, IP keys collapse so this is small. Once trust proxy is correct, an attacker churning IPs can fill the map to ~unbounded size in 5 minutes. Each entry is small (~60 bytes) so this is more a smell than a kill, but combined with the global `setInterval(cleanupBackoffTracker, 5min)` it's a noticeable memory wobble.
**Repro / trigger:** Generate auth attempts from many IPs over 5 minutes.
**Fix shape:** Bound the map with an LRU (`lru-cache`) of, say, 100k entries; or run cleanup every windowMs instead of every 5 min; or expire on read in `calculateBackoff` so eviction is amortized.
**Confidence:** medium

---

### [MEDIUM] gateway/src/middleware/requestLogger.ts:64-87 — Audit POST signs object whose `severity` field is derived from caller-controlled details
**Category:** Security
**Status:** Accept
**Cross-pass:** Claude only
**What:** `sendToBackendAudit` constructs `body` with `severity: details.severity || 'info'` from `details`, then signs the resulting body via `generateGatewaySignature`. `details` originates from `logSecurityEvent` callers, several of whom merge HTTP-derived headers (e.g., `userAgent`, `path`) into `details`. There is no validation that `details.severity` is one of the expected enum values.
**Why it matters:** If a future caller forwards a request header into `details` and that header sneaks in a `severity` key (via JSON.parse of some payload, or a typo in field-name mapping), the backend audit pipeline could be poisoned to mark hostile traffic as `severity: 'info'` or vice versa. Lower severity here, but the validation gap is real.
**Repro / trigger:** Code change that does `logSecurityEvent('X', { ...req.body })` — not present today, but the function shape invites it.
**Fix shape:** Whitelist `severity` to `'low'|'medium'|'high'|'info'` and reject `severity` on the inbound `details` shape via a Zod schema.
**Confidence:** low

---

### [MEDIUM] gateway/src/middleware/requestLogger.ts:109 — `X-Forwarded-For` used verbatim for audit IP attribution without trust-proxy gating
**Category:** Security (logging integrity)
**Status:** Accept
**Cross-pass:** Codex only
**What:** `getClientIp` reads `x-forwarded-for` regardless of whether the upstream is trusted. Audit events therefore attribute actions to whatever IP the client claims.
**Why it matters:** Compounds with the missing `trust proxy` finding: an attacker can forge `X-Forwarded-For` to plant another user's IP (or an internal-network IP) into the audit trail, framing third parties for security events and breaking incident response.
**Repro / trigger:** `curl -H 'X-Forwarded-For: 10.0.0.1, 8.8.8.8' …` to any audited route — audit log records `10.0.0.1`.
**Fix shape:** Gate XFF parsing on the same trust-proxy hop count as Express. When trust-proxy is unset, fall back to `req.socket.remoteAddress`.
**Confidence:** high

---

### [MEDIUM] gateway/src/services/backendEvents/index.ts:71 — `JSON.parse(data.toString())` against raw WS frame without size/shape validation
**Category:** TypeScript rules / Null-boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** Incoming WebSocket frames are blindly `JSON.parse`'d, then `message.type` and `message.event` are accessed without schema validation. `data.toString()` on a `Buffer` is fine, but `ws` can deliver fragments, arraybuffers, or arrays of buffers depending on options.
**Why it matters:** Beyond the unhandled-rejection issue, a hostile or buggy backend (or anyone who can MITM a non-TLS internal WS) can inject events of arbitrary shape that flow into `handleEvent` → `push.sendToDevices` → FCM/APNs with `walletName` or `creatorName` strings of unbounded length, embedded control characters, or unicode that survives into push payloads. There's also no protection against giant frames before parse.
**Repro / trigger:** Backend bug emits `{ type: 'transaction', data: { type: '__proto__', amount: 0, txid: 'a' } }` — `toTransactionNotificationType` falls through to the cast and pushes a notification with type `'__proto__'`.
**Fix shape:** Wrap `JSON.parse` in `safeJsonParse` and validate the message against a Zod schema covering `auth_challenge | auth_success | event`. Configure `ws` with `maxPayload` and use `ws.on('message', (data, isBinary) => …)` to reject binary frames.
**Confidence:** medium

---

### [LOW] gateway/src/config.ts:107,117 — `FCM_PRIVATE_KEY` / `APNS_PRIVATE_KEY` may end up logged via env-dump tooling
**Category:** Security (secret hygiene)
**Status:** Accept
**Cross-pass:** Claude only
**What:** Secrets are loaded from env, `.replace(/\\n/g, '\n')` is applied. Not logged here, but neither marked nor protected against accidental `JSON.stringify(config)` elsewhere.
**Why it matters:** A future debug log or `/info` endpoint expansion could dump them. The shared redaction utility (`stringifyRedacted`) is used in the logger — confirm it covers `privateKey`/`gatewaySecret`/`jwtSecret` keys.
**Repro / trigger:** Anyone adds `log.debug('config', { config })`.
**Fix shape:** Verify `stringifyRedacted` redacts `privateKey`/`*Secret`/`*Key` keys; add to its denylist if missing. Optionally wrap config secrets in a branded type that forbids accidental serialization.
**Confidence:** low

---

### [LOW] gateway/src/config.ts:164 — `console.warn`/`console.error` in config validation bypasses the redaction logger
**Category:** TypeScript rules / logging
**Status:** Accept
**Cross-pass:** Codex only
**What:** Config validation paths use raw `console.warn`/`console.error` instead of the project's `createLogger()` sink, bypassing the redaction layer.
**Why it matters:** Violates the project rule "Never `console.log` — use `createLogger()`". Worse, the bypass sits in the exact place that handles secret-bearing config (FCM/APNs keys, JWT secret), so an accidental `console.error('config:', cfg)` would dump unredacted secrets.
**Repro / trigger:** Any config validation failure during boot.
**Fix shape:** Replace `console.*` with `createLogger('config')`. If pre-logger bootstrap is needed, use the bootstrap logger pattern (or just `process.stderr.write` of a fixed-text error without interpolation).
**Confidence:** high

---

### [LOW] gateway/src/middleware/auth.ts:46-47 — Optional-auth sentinel runs full `jwt.verify` on a known-invalid token
**Category:** Logic/invariant (smell)
**Status:** Accept
**Cross-pass:** Claude only
**What:** `verifyOptionalAccessToken(null)` substitutes `'sanctuary-optional-auth-missing-token'` and runs `jwt.verify` which always throws — caught and swallowed.
**Why it matters:** Wasted CPU on every unauthenticated optional-auth request. The literal sentinel is also indistinguishable from a real token in logs if `jwt.verify` ever logs its input via a debugger or future instrumentation.
**Repro / trigger:** Any anonymous `optionalAuth` route hit (none currently use it, but the function is exported).
**Fix shape:** Early-return `undefined` when the token argument is null/empty before calling `verifyAccessToken`.
**Confidence:** high

---

### [LOW] gateway/src/routes/proxy/proxyConfig.ts:65 — Proxy error handler casts `res` to `Response` without checking it's an HTTP response
**Category:** TypeScript rules
**Status:** Accept
**Cross-pass:** Claude only
**What:** `http-proxy-middleware`'s `error` callback can fire on WebSocket upgrade failures where `res` is actually a `Socket`. `(res as Response).status(502).json(...)` then crashes (TypeError) inside the error handler itself.
**Why it matters:** A malformed upgrade request to a proxied route (gateway doesn't currently proxy WS through `http-proxy-middleware`, but defense-in-depth) crashes the worker.
**Repro / trigger:** Send `Upgrade: websocket` to `/api/v1/wallets/<uuid>/transactions/create` and break backend mid-connect.
**Fix shape:** Type-guard `res` (`if (!('status' in res)) { (res as Socket).destroy(); return; }`).
**Confidence:** low

---

## Considered & rejected

### [LOW] gateway/src/utils/logger.ts:37,42,47 — Logger uses `console.log`/`warn`/`error` directly
**Category:** TypeScript rules
**Status:** Reject
**Cross-pass:** Claude only
**What:** Claude self-flags this as a non-defect: `utils/logger.ts` is the legitimate sink for `console.*` calls — the project's "never console.log" rule exists precisely to centralize console use in this file. Claude explicitly marked it "Flagging only because the audit brief asks for `console.log` hits" with fix shape "No action needed."
**Why it matters:** N/A — the rule's intent is preserved by routing all callers through `createLogger()`, which terminates at `console.*` here. Rejecting per Claude's own annotation.
**Repro / trigger:** N/A.
**Fix shape:** No action.
**Confidence:** high

---

## Deferred

_None._
