# Utils Audit — server/src/utils

Reviewed 26 TS files across `server/src/utils/` (root + `docker/` + `tracing/`).

---

### [CRITICAL] server/src/utils/jwt.ts:242-249 — Revocation check failures silently allow expired/invalid messaging but mask real DB/Redis errors
**Category:** Error handling
**What:** `verifyToken` wraps the `isTokenRevoked` lookup in `try { ... } catch { throw new Error('Invalid or expired token'); }`. If the revocation DB/Redis is genuinely down (transient infra outage, not a real revocation), the bare `catch {}` re-throws as "Invalid or expired token" with no logging — masking infra failure as auth failure for every request. Also, if `isTokenRevoked` itself throws ('Token has been revoked' is thrown *inside* the same try), the specific message is overwritten by the generic outer error.
**Why it matters:** Operators can't distinguish a Redis outage from real auth failures; users get silent re-auth loops; the more-precise "Token has been revoked" error gets clobbered into the generic message, leaking less information than intended and breaking client UX that may special-case revocation.
**Repro / trigger:** Stop Redis or break sessionRepository connection while authenticated traffic flows; every request 401s as "Invalid or expired token" with zero log lines.
**Fix shape:** Let "Token has been revoked" pass through; only catch infra errors and log them as `log.error` with a distinct thrown message (e.g., "Token revocation check unavailable"). Do not bare-catch with no logging in auth-critical code.
**Confidence:** high

---

### [HIGH] server/src/utils/encryption.ts:14-31 — `console.warn` violates TypeScript Rules; startup security warning bypasses log redaction/sanitization
**Category:** TypeScript Rules / Logic
**What:** `getEncryptionSalt` emits six `console.warn(...)` calls instead of using `createLogger`. CLAUDE.md explicitly forbids `console.log/warn` in this codebase.
**Why it matters:** Bypasses structured logging, request-context correlation, ANSI formatting, and log-level filtering. In containerized deploys these warnings may end up in stderr with no timestamp, breaking log aggregation.
**Repro / trigger:** Start server without `ENCRYPTION_SALT` set.
**Fix shape:** Use `createLogger('UTIL:ENCRYPTION')` and emit a single `log.warn` with structured context.
**Confidence:** high

---

### [HIGH] server/src/utils/encryption.ts:121-142 — `validateEncryptionKey` race condition on concurrent first calls
**Category:** Concurrency
**What:** Two concurrent callers can both pass the `if (encryptionKeyCache)` check before either has finished `await scryptAsync(...)`, causing scrypt to run twice. Worse, if `getEncryptionSalt()` returns different values across concurrent calls (env mutated mid-call), `encryptionSaltCache` and `encryptionKeyCache` can desync.
**Why it matters:** Wasted CPU on duplicate scrypt (~100ms each), and a theoretical key/salt mismatch where the cached key was derived with a different salt than `encryptionSaltCache` records. In production this is mostly benign because validate is called once at startup, but if any service path lazily invokes it (e.g., test bootstrap, hot reload) the race opens.
**Repro / trigger:** Call `validateEncryptionKey()` twice in parallel from app startup paths.
**Fix shape:** Memoize the in-flight Promise: `let pending: Promise<void> | null`; return `pending` if set; clear on completion.
**Confidence:** medium

---

### [HIGH] server/src/utils/async.ts:131-148 — `withRetry` off-by-one: `maxRetries=3` performs 4 attempts
**Category:** Logic / boundary
**What:** Loop is `for (attempt = 1; attempt <= maxRetries + 1; attempt++)`. With `maxRetries = 3` (the default), the function tries 4 times total. The JSDoc and parameter name imply 3 retries means 3 total attempts (or at most 1 initial + 3 retries = 4 — ambiguous, but the off-by-one is real either way).
**Why it matters:** Callers expecting "max 3 attempts" get 4 — multiplies downstream load on flaky external APIs and can blow rate limits. Also, the final iteration's `currentDelay *= backoffMultiplier` runs after the throw path is taken, but the previous iteration's sleep was already applied with an exponentially-grown delay that may exceed intent.
**Repro / trigger:** Pass a function that always throws with `maxRetries: 3`; count `fn` invocations — it's 4.
**Fix shape:** Either change loop bound to `attempt <= maxRetries`, or rename param to `maxAttempts` and document the inclusive semantics. Add a unit test pinning attempt count.
**Confidence:** high

---

### [HIGH] server/src/utils/async.ts:23-46 — `mapWithConcurrency` swallows first-error semantics; one rejection terminates only one worker
**Category:** Concurrency
**What:** When `fn(items[index])` rejects, that worker's promise rejects, but `currentIndex` keeps advancing as other workers pick items. `Promise.all(workers)` rejects with the first error, but other workers continue to execute and write to `results[]` after the function has already rejected. There is no cancellation signal.
**Why it matters:** Side-effectful work (DB writes, network calls) continues invisibly after the caller has received an error. For 1000 items at concurrency 5, a failure on item 3 may still execute items 8–1000.
**Repro / trigger:** Pass items where `fn` rejects on the 3rd item; observe additional `fn` invocations completing after `await mapWithConcurrency` rejects.
**Fix shape:** Either accept an `AbortSignal` and check it in the worker loop, or set a shared `errored` flag inside the worker that prevents further `currentIndex` advancement on rejection.
**Confidence:** high

---

### [HIGH] server/src/utils/redact.ts:117-153 — `redactObject` mutates shared `seen` WeakSet across sibling subtrees
**Category:** Logic / invariant
**What:** `redactObject` accepts `seen` as a parameter and adds objects to it before recursing. Because the same `seen` is passed to all sibling recursive calls, an object referenced from multiple siblings (a DAG, not a cycle) is replaced with `{ '[Circular]': true }` on the second occurrence even though it's not actually circular.
**Why it matters:** Logging an object with a shared reference (e.g., shared config object referenced by two children) silently turns the second reference into `[Circular]`, losing data. Test coverage may miss this because tests use trees, not DAGs.
**Repro / trigger:** `const shared = { x: 1 }; redactObject({ a: shared, b: shared });` → `b` becomes `{ '[Circular]': true }`.
**Fix shape:** Only treat as circular when traversing an ancestor — pass a `Set` representing the *current path* (ancestors only), removing entries on return; or accept that this is acceptable behavior and document it.
**Confidence:** high

---

### [MEDIUM] server/src/utils/encryption.ts:101 — Base64 regex accepts invalid lengths and short-circuits on empty strings
**Category:** Logic
**What:** `isEncrypted` uses `/^[A-Za-z0-9+/]*={0,2}$/`. The `*` (zero-or-more) means an empty part `""` passes the regex but is then rejected only by `p.length > 0`. Worse, valid-looking but length-invalid base64 (e.g., 5 chars, not a multiple of 4) is accepted, so `isEncrypted` returns true for "abcde:fghij:klmno". `decrypt` would then throw a generic `node:crypto` error.
**Why it matters:** `decryptIfEncrypted` may attempt to decrypt non-encrypted values that happen to contain two colons, throwing instead of returning the input. Affects backward-compat paths for legacy plaintext data containing colons.
**Repro / trigger:** Stored value `"foo:bar:baz"` — `isEncrypted` returns true, then `decrypt` throws.
**Fix shape:** Validate each part is base64-length-valid (`(len % 4 === 0)`) and that the IV decodes to 16 bytes. Or try/catch the decrypt and fall back to returning the input.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/errors.ts:87-92 — `isUniqueConstraintError` fallback uses `String(error).includes('Unique constraint')`
**Category:** Logic / boundary
**What:** When the error is not a Prisma typed error, falls back to substring match on `String(error)`. `String({})` is `"[object Object]"`; `String(null)` is `"null"`. Any error message containing the literal text "Unique constraint" (e.g., a wrapped error or a user-facing translated message) triggers a false positive.
**Why it matters:** Wrong error mapping → callers route a non-Prisma error through unique-constraint handling, returning 409 Conflict for unrelated failures.
**Repro / trigger:** Throw `new Error('Validation failed: Unique constraint not satisfied by client schema')` from non-Prisma code.
**Fix shape:** Check for `error instanceof Error` first; consider matching only when the message also includes "P2002" or a Prisma signature.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/errors.ts:243-254 — `validatePagination` accepts negative `Infinity` and silently coerces NaN to 50
**Category:** Boundary
**What:** `parseInt("Infinity")` is `NaN` → safely defaulted. But `parseInt("-50")` is `-50`, then `Math.max(parsedLimit, 1)` clamps to 1 — OK. However, `parseInt("1e9")` returns `1` (parseInt stops at 'e'). So `?limit=1e9` is silently treated as `limit=1`, hiding caller intent (and may indicate bot scanning).
**Why it matters:** Surprising behavior; some callers may be passing scientific notation expecting it to work; query auditing won't flag this.
**Repro / trigger:** Pass `?limit=1e9`.
**Fix shape:** Use `Number()` with explicit integer validation, or reject non-decimal-integer strings with a 400.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/tracing/tracer.ts:200-221 — `startActiveSpan` calls `actualFn(span)` synchronously; rejected promises bypass `recordException`
**Category:** Concurrency / error handling
**What:** When `actualFn` returns a Promise, the code does `return result.finally(() => span.end())` — but it does not `.catch` to call `span.recordException`. Only synchronous throws hit the `catch` block. Promise rejections only trigger `finally`, so the span ends with status `'unset'` even on async error.
**Why it matters:** Async errors don't get recorded on the span, breaking trace observability for the most common case (async handlers).
**Repro / trigger:** Pass an async function that rejects.
**Fix shape:** Mirror the `withSpan` pattern: `.then(v => { span.setStatus('ok'); span.end(); return v; }).catch(e => { span.recordException(e); span.end(); throw e; })`.
**Confidence:** high

---

### [MEDIUM] server/src/utils/tracing/otel.ts:101-102 — SIGTERM/SIGINT handlers added every call, never removed
**Category:** Resource leak
**What:** `initializeOpenTelemetry` registers two process signal handlers each invocation. If called more than once (test bootstrap, re-init, hot reload), handlers accumulate and Node warns at 10+.
**Why it matters:** Memory leak in long-running test workers; eventual `MaxListenersExceededWarning`; shutdown invoked multiple times in parallel can race.
**Repro / trigger:** Call `initializeOpenTelemetry()` twice.
**Fix shape:** Guard with a module-level `initialized` boolean; use `process.once` if single-shot is acceptable.
**Confidence:** high

---

### [MEDIUM] server/src/utils/safeJson.ts:52,59,93 — `valuePreview: value.substring(0, 100)` can leak secrets into logs
**Category:** Security
**What:** When JSON parsing or schema validation fails, the first 100 characters of the raw value are logged. If the JSON contains tokens/passwords/private keys (which is plausible — these are settings/user data), they appear in logs unredacted.
**Why it matters:** The logger's `redactObject` does NOT redact a key called `valuePreview`. The 100 chars may include `{"password":"hunter2"...` verbatim.
**Repro / trigger:** Call `safeJsonParse` with a malformed JSON containing a password-like substring.
**Fix shape:** Run the preview through `redact()` heuristically (look for sensitive substrings), or just log the length and error class instead of the value.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/jwt.ts:303-308 — `decodeToken` swallows errors but `jwt.decode` doesn't throw
**Category:** Smell / dead code
**What:** `jwt.decode` from `jsonwebtoken` returns `null` on malformed input rather than throwing. The `try/catch` is dead; the `catch` block is unreachable.
**Why it matters:** Misleading defensive code; suggests the author expected throws and reviewers may add code that relies on the catch.
**Repro / trigger:** Read the code.
**Fix shape:** Remove the try/catch and handle the `null` return that `jwt.decode` actually produces.
**Confidence:** high

---

### [MEDIUM] server/src/utils/jwt.ts:318 — Bearer scheme matched case-sensitively
**Category:** Logic
**What:** `parts[0] !== 'Bearer'` rejects `bearer` and `BEARER`. RFC 6750 says the scheme is case-insensitive.
**Why it matters:** Some clients (curl examples, older SDKs) send lowercase `bearer` and get 401s.
**Repro / trigger:** `Authorization: bearer <token>` → null.
**Fix shape:** `parts[0].toLowerCase() !== 'bearer'`.
**Confidence:** high

---

### [LOW] server/src/utils/logger.ts:127-146 — `safeStringify` `seen` WeakSet accumulates across the whole tree, same DAG issue as redact
**Category:** Logic
**What:** Same root cause as the redact bug: a single shared `WeakSet` for the whole serialization marks legitimately shared (non-cyclic) references as `[Circular]`.
**Why it matters:** Logged objects with DAG-shaped structure lose data.
**Repro / trigger:** `safeStringify({ a: shared, b: shared })`.
**Fix shape:** Track ancestors per-path rather than globally.
**Confidence:** high

---

### [LOW] server/src/utils/async.ts:87-101 — `withTimeout` `timeoutId` may be referenced before assignment under throw-during-setTimeout
**Category:** Smell
**What:** `timeoutId` is declared but only assigned inside the executor. If `setTimeout` itself ever threw synchronously before assignment (effectively impossible in Node, but TS strict mode flags this pattern), `clearTimeout(undefined!)` is fine but the `!` cast may be missing in strict mode. Likely benign.
**Why it matters:** Code smell only.
**Fix shape:** `let timeoutId: NodeJS.Timeout | undefined`.
**Confidence:** low

---

### [LOW] server/src/utils/serialization.ts:18-44 — `serializeForJson` recursion is unbounded; can stack-overflow on deeply nested or circular data
**Category:** Logic
**What:** No cycle detection; no max-depth check. A `DraftTransaction` containing a self-reference (via Prisma includes) would loop until stack overflow.
**Why it matters:** Generic helper used from JSON response paths — a malformed include could DoS a route via stack exhaustion.
**Repro / trigger:** Construct an object graph with a cycle and pass to `serializeForJson`.
**Fix shape:** Add WeakSet ancestor tracking similar to `redactObject` (with the path-based fix).
**Confidence:** medium

---

### [LOW] server/src/utils/tracing/tracer.ts:88-101 — `crypto.getRandomValues` reference may break under older Node (<19) without polyfill
**Category:** Smell
**What:** Uses bare `crypto.getRandomValues` (web crypto) rather than `node:crypto`'s `randomBytes`. Node 19+ exposes it globally; earlier Nodes require `require('crypto').webcrypto.getRandomValues`.
**Why it matters:** Likely fine on current Node versions used by this project, but a footgun if Node version is downgraded.
**Fix shape:** Use `randomBytes(16).toString('hex')` from `node:crypto` for consistency with other utils.
**Confidence:** low

---

### [LOW] server/src/utils/redact.ts:53-65 — Sensitive-field regex patterns are anchored loosely (`/password/i`)
**Category:** Smell
**What:** Patterns like `/password/i` match any field containing "password", including `passwordRequirements`, `passwordPolicy`, `passwordHint` — innocuous metadata fields get over-redacted into `[REDACTED]`.
**Why it matters:** Operators lose visibility into config diagnostics; not a security bug (over-redaction errs safe).
**Fix shape:** Anchor patterns to whole-word matches or maintain an explicit allowlist of safe field names.
**Confidence:** medium

---

### [LOW] server/src/utils/encryption.ts:71-89 — `decrypt` doesn't validate that `iv` decodes to exactly 16 bytes
**Category:** Boundary
**What:** A truncated base64 IV decodes to a Buffer shorter than 16 bytes. `createDecipheriv` then throws a non-specific "Invalid IV length" — no problem for security, but the error doesn't tell the operator the IV was malformed.
**Why it matters:** Diagnostic quality only.
**Fix shape:** Validate `Buffer.from(ivB64, 'base64').length === 16` and throw a specific error.
**Confidence:** low

---

### [LOW] server/src/utils/tracing/middleware.ts:121 — Span name leaks raw `req.path` when route is unmatched
**Category:** Smell / observability
**What:** `spanName = ${req.method} ${req.route?.path || req.path}`. For 404s or paths with high cardinality (e.g., `/users/abc-123`), `req.route` is undefined so the raw path is used — exploding trace cardinality in trace storage.
**Why it matters:** Trace backend cost/cardinality, not a bug per se.
**Fix shape:** Use a sanitized template (`/users/:id`) or fall back to `${req.method} <unmatched>`.
**Confidence:** medium

---

### [LOW] server/src/utils/errors.ts:261-281 — `bigIntToNumber` returns unsafe number with only a warn log
**Category:** Boundary
**What:** Function silently returns the unsafe number after warning. Callers consume an inaccurate value (e.g., satoshi amount above 2^53) thinking it's fine.
**Why it matters:** Silent data corruption on Bitcoin amounts approaching `MAX_SAFE_INTEGER` (~90M BTC — well above all reachable amounts, but the doc-stated invariant should be enforced).
**Fix shape:** Throw on unsafe range, or return `null` and let callers decide.
**Confidence:** low

---

## Summary

**Severity counts:** Critical 1 · High 5 · Medium 9 · Low 8 · Total 23

**Top 3 by impact:**
1. **CRITICAL** `jwt.ts:242-249` — Revocation check bare-catch masks Redis/DB outages as auth failures, no log emitted, drops the "Token has been revoked" specific message.
2. **HIGH** `async.ts:131-148` — `withRetry` off-by-one (default `maxRetries=3` causes 4 attempts). Used widely; multiplies retry load.
3. **HIGH** `redact.ts:117-153` (and `logger.ts:127-146`) — Shared `seen` WeakSet mis-marks DAG references as `[Circular]`, silently dropping logged data.

**Files reviewed (26):**
`apiKeyHash.ts`, `async.ts`, `encryption.ts`, `errors.ts`, `fatalProcessHandlers.ts` (shim), `jwt.ts`, `logger.ts`, `pagination.ts`, `password.ts`, `privacy.ts`, `processExit.ts` (shim), `redact.ts`, `requestAbort.ts`, `requestContext.ts`, `safeJson.ts`, `serialization.ts`, `validators.ts`, `docker/common.ts`, `docker/index.ts`, `docker/tor.ts`, `docker/types.ts`, `tracing/index.ts`, `tracing/middleware.ts`, `tracing/otel.ts`, `tracing/tracer.ts`, `tracing/types.ts`.

Shims (`fatalProcessHandlers.ts`, `processExit.ts`) are correct one-line re-exports of `@sanctuary/shared/utils/*` per the workspace migration convention — not flagged.
