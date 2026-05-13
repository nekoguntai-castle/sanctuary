# Phase C — utils (merged)

**Source:** raw/04-utils-claude.md + raw/04-utils-codex.md
**Date:** 2026-05-12

Scope: `server/src/utils/**/*.ts` (26 files). Backward-compat shims `fatalProcessHandlers.ts` and `processExit.ts` are correct one-line re-exports of `@sanctuary/shared/utils/*` per the workspace migration convention and are intentionally not findings.

## Summary

| Severity | Claude | Codex | Merged | Dual-flagged |
|---|---|---|---|---|
| Critical | 1 | 0 | 1 | 1 |
| High | 5 | 8 | 12 | 1 |
| Medium | 9 | 17 | 18 | 4 |
| Low | 8 | 1 | 8 | 1 |
| **Total** | **23** | **26** | **39** | **7** |

**Accepted:** 39 · **Rejected:** 0 · **Deferred:** 0

## Findings (accepted)

### [CRITICAL] server/src/utils/jwt.ts:242 — Revocation bare-catch masks Redis/DB outages as auth failures
**Category:** Error handling / security telemetry
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `verifyToken` wraps the `isTokenRevoked` lookup in `try { ... } catch { throw new Error('Invalid or expired token'); }`. If the revocation store (DB/Redis) is genuinely down, the bare `catch {}` re-throws as "Invalid or expired token" with no log emission — masking infra failure as auth failure for every request. Additionally, the inner `throw new Error('Token has been revoked')` is clobbered by the outer generic message, so callers cannot distinguish revocation from generic invalidity.
**Why it matters:** Operators can't tell a Redis outage from real auth failures; users get silent re-auth loops; security telemetry loses the difference between revoked credentials and infrastructure failure; mass outages look like mass token expiry.
**Repro / trigger:** Stop Redis or break the sessionRepository connection while authenticated traffic flows; every request 401s with zero log lines. Or have `isTokenRevoked(decoded.jti)` throw.
**Fix shape:** Let "Token has been revoked" pass through unchanged; catch only infra errors and emit `log.error` with context; throw a distinct operational message (e.g., "Token revocation check unavailable") for store outages. Do not bare-catch in auth-critical code.
**Confidence:** high

---

### [HIGH] server/src/utils/async.ts:39 — `mapWithConcurrency` accepts invalid concurrency and silently no-ops
**Category:** Concurrency / boundary
**Status:** Accept
**Cross-pass:** Codex only
**What:** Workers count = `Math.min(concurrency, items.length)` without validating `concurrency` is a positive finite integer. For `0`, negative, or `NaN`, no workers spawn and the function returns a sparse preallocated array.
**Why it matters:** Callers can believe all work completed successfully while none was processed.
**Repro / trigger:** `await mapWithConcurrency([1, 2], async x => x, 0)` resolves to an array with empty slots.
**Fix shape:** Reject or normalize non-finite, non-integer, or `< 1` concurrency before constructing workers.
**Confidence:** high

---

### [HIGH] server/src/utils/async.ts:23 — `mapWithConcurrency` has no cancellation; rejection leaves siblings running
**Category:** Concurrency
**Status:** Accept
**Cross-pass:** Claude only
**What:** When `fn(items[index])` rejects, other workers continue advancing `currentIndex` and executing side effects. `Promise.all(workers)` rejects with the first error, but additional `fn` invocations keep landing after the caller has already received an error. No cancellation signal exists.
**Why it matters:** Side-effectful work (DB writes, network calls) continues invisibly after the caller has received an error. For 1000 items at concurrency 5, a failure on item 3 may still execute items 8–1000.
**Repro / trigger:** Pass items where `fn` rejects on the 3rd item; observe further `fn` invocations completing after the awaited promise rejects.
**Fix shape:** Accept an `AbortSignal` and check it in the worker loop, or set a shared `errored` flag preventing further `currentIndex` advancement.
**Confidence:** high

---

### [HIGH] server/src/utils/async.ts:65 — `batchProcess` hangs the process on non-positive batch size
**Category:** Null/boundary / resource leak
**Status:** Accept
**Cross-pass:** Codex only
**What:** `for (let i = 0; i < items.length; i += batchSize)` advances by `batchSize` without validating it. `batchSize = 0` never advances; negative values move backward. Combined with `slice`, the loop pushes infinite empty batches until OOM.
**Why it matters:** A bad caller or malformed input spins indefinitely, allocating until the process exhausts memory.
**Repro / trigger:** `await batchProcess([1], 0, async batch => batch)` never leaves the loop.
**Fix shape:** Validate `batchSize` as a positive finite integer and fail fast before the loop.
**Confidence:** high

---

### [HIGH] server/src/utils/async.ts:131 — `withRetry` off-by-one: `maxRetries=3` performs 4 attempts
**Category:** Logic / boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** Loop is `for (attempt = 1; attempt <= maxRetries + 1; attempt++)`. With default `maxRetries = 3`, the function tries 4 times. JSDoc and param name imply 3 means 3 attempts (or 1 + 3 retries = 4 — ambiguous either way, but the off-by-one is real).
**Why it matters:** Callers expecting "max 3 attempts" get 4 — multiplies downstream load on flaky external APIs and can blow rate limits.
**Repro / trigger:** Pass a function that always throws with `maxRetries: 3`; count invocations — it's 4.
**Fix shape:** Change loop bound to `attempt <= maxRetries`, or rename param to `maxAttempts` and document inclusive semantics. Add a unit test pinning attempt count.
**Confidence:** high

---

### [HIGH] server/src/utils/docker/common.ts:40 — Docker proxy calls lack request timeouts
**Category:** Resource leak / error-handling
**Status:** Accept
**Cross-pass:** Codex only
**What:** `listAllContainers` and Tor container helpers call `fetch` without an `AbortSignal`. Only the lightweight availability check has a timeout.
**Why it matters:** If the Docker socket proxy accepts a connection but stalls, status/start/stop/create paths can hang request handlers or background tasks indefinitely.
**Repro / trigger:** Point `DOCKER_PROXY_URL` at an endpoint that accepts connections but never responds, then call `getTorStatus()` or `createTorContainer()`.
**Fix shape:** Centralize Docker proxy fetches behind a helper with bounded timeouts, contextual errors, and optional retry policy.
**Confidence:** high

---

### [HIGH] server/src/utils/docker/tor.ts:82 — Tor image pulled from mutable `:latest` tag
**Category:** Security / supply chain
**Status:** Accept
**Cross-pass:** Codex only
**What:** `createTorContainer` pulls and runs `dperson/torproxy:latest`. The `latest` tag is mutable and does not pin image content.
**Why it matters:** A tag update or registry compromise can change container code without a code review or deploy diff — a privileged proxy container is a high-value supply-chain target.
**Repro / trigger:** Call `createTorContainer()` after the upstream `latest` tag changes.
**Fix shape:** Pin a vetted version or digest, expose upgrades as explicit configuration, and verify the selected image during release.
**Confidence:** high

---

### [HIGH] server/src/utils/encryption.ts:14 — `console.warn` violates TypeScript Rules; security warning bypasses structured logging
**Category:** TypeScript Rules / logging
**Status:** Accept
**Cross-pass:** Claude only
**What:** `getEncryptionSalt` emits six `console.warn(...)` calls instead of using `createLogger`. CLAUDE.md explicitly forbids `console.log/warn` outside the logger implementation.
**Why it matters:** Bypasses structured logging, request-context correlation, ANSI formatting, and log-level filtering. In containerized deploys these warnings hit stderr with no timestamp, breaking aggregation.
**Repro / trigger:** Start server without `ENCRYPTION_SALT` set.
**Fix shape:** Use `createLogger('UTIL:ENCRYPTION')` and emit a single `log.warn` with structured context.
**Confidence:** high

---

### [HIGH] server/src/utils/encryption.ts:101 — `isEncrypted` accepts invalid ciphertext shapes
**Category:** Logic / boundary
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `isEncrypted` uses `/^[A-Za-z0-9+/]*={0,2}$/` and only checks three non-empty base64-looking fields. It does not validate decoded IV/auth-tag lengths or canonical base64 encoding. The `*` (zero-or-more) means an empty part passes the regex; length-invalid base64 (e.g., 5 chars, not a multiple of 4) is also accepted.
**Why it matters:** `decryptIfEncrypted` may attempt to decrypt non-encrypted values that contain two colons (legacy plaintext) and throw a generic `node:crypto` error, breaking backward-compat reads.
**Repro / trigger:** `decryptIfEncrypted('abc:def:ghi')` or `"foo:bar:baz"` — passes `isEncrypted`, then `decrypt` throws.
**Fix shape:** Validate each part is base64-length-valid (`len % 4 === 0`), verify the IV decodes to 16 bytes and auth-tag to 16 bytes, or add a versioned ciphertext prefix.
**Confidence:** high

---

### [HIGH] server/src/utils/encryption.ts:121 — `validateEncryptionKey` race condition on concurrent first calls
**Category:** Concurrency
**Status:** Accept
**Cross-pass:** Claude only
**What:** Two concurrent callers can both pass the `if (encryptionKeyCache)` check before either has finished `await scryptAsync(...)`, causing scrypt to run twice. If `getEncryptionSalt()` returns different values between calls, the cached key and salt can desync.
**Why it matters:** Wasted CPU on duplicate scrypt (~100ms each); a theoretical key/salt mismatch where the cached key was derived with a different salt than `encryptionSaltCache` records. Benign at startup but the race opens for any lazy invocation (test bootstrap, hot reload).
**Repro / trigger:** Call `validateEncryptionKey()` twice in parallel from app startup paths.
**Fix shape:** Memoize the in-flight Promise: `let pending: Promise<void> | null`; return `pending` if set; clear on completion.
**Confidence:** medium

---

### [HIGH] server/src/utils/errors.ts:272 — `bigIntToNumber` silently rounds unsafe integers
**Category:** Logic / boundary
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Function comment claims it throws on unsafe values, but the implementation logs a warning and returns the rounded `Number(...)` anyway. Values above `Number.MAX_SAFE_INTEGER` are silently rounded.
**Why it matters:** Large integer balances, satoshi amounts, counters, or IDs can be silently rounded before serialization or arithmetic. Documented invariant is not enforced; callers consume inaccurate data thinking it's safe.
**Repro / trigger:** `bigIntToNumber(9007199254740993n)` returns `9007199254740992`.
**Fix shape:** Throw on unsafe range as the docs already claim, or return a string/BigInt-preserving representation at JSON boundaries.
**Confidence:** high

---

### [HIGH] server/src/utils/redact.ts:117 — `redactObject` mis-marks DAG references as `[Circular]`
**Category:** Logic / invariant
**Status:** Accept
**Cross-pass:** Claude only
**What:** `redactObject` accepts `seen` as a parameter and adds objects to it before recursing. The same `seen` is shared across sibling recursive calls, so an object referenced from multiple siblings (a DAG, not a cycle) is replaced with `{ '[Circular]': true }` on the second occurrence.
**Why it matters:** Logging an object with a shared reference (e.g., shared config referenced by two children) silently drops the second reference. Tests using only tree shapes miss this.
**Repro / trigger:** `const shared = { x: 1 }; redactObject({ a: shared, b: shared });` — `b` becomes `{ '[Circular]': true }`.
**Fix shape:** Treat as circular only when traversing an ancestor — pass a `Set` representing the current path (ancestors only), removing entries on return.
**Confidence:** high

---

### [HIGH] server/src/utils/redact.ts:140 — `redactObject` skips secrets inside arrays
**Category:** Security
**Status:** Accept
**Cross-pass:** Codex only
**What:** `redactObject` recurses into nested non-array objects but leaves arrays unchanged. A context value like `{ users: [{ password: 'secret' }] }` reaches the logger with the password intact.
**Why it matters:** Common API shapes wrap records in arrays, so sensitive fields can leak into application logs despite using the redaction utility.
**Repro / trigger:** `createLogger('x').info('users', { users: [{ password: 'secret' }] })`.
**Fix shape:** Recurse into arrays in `redactObject`, or have the logger use the existing deep redaction path consistently.
**Confidence:** high

---

### [HIGH] server/src/utils/redact.ts:211 — `safeError` returns unredacted error messages and stacks
**Category:** Security / error-handling
**Status:** Accept
**Cross-pass:** Codex only
**What:** `safeError` returns `error.message` and development stacks directly. The surrounding redaction pass redacts by field name, so sensitive substrings inside `message` or `stack` are not removed.
**Why it matters:** Tokens, passwords, connection strings, or seed material embedded in thrown errors can be written to logs.
**Repro / trigger:** `log.error('failed', { error: new Error('token=secret-value') })` logs the token text.
**Fix shape:** Apply value-level sensitive-pattern redaction to error messages/stacks, or avoid logging raw error strings from security-sensitive boundaries.
**Confidence:** high

---

### [HIGH] server/src/utils/serialization.ts:24 — `serializeForJson` loses BigInt precision
**Category:** Logic / boundary
**Status:** Accept
**Cross-pass:** Codex only
**What:** Converts every `bigint` with `Number(data)` and does not check `Number.isSafeInteger`. Values above `Number.MAX_SAFE_INTEGER` are rounded silently.
**Why it matters:** The helper is generic and used for JSON-safe model output, so large integer values can be corrupted before reaching API clients (Bitcoin amounts, counters, IDs).
**Repro / trigger:** `serializeForJson({ value: 9007199254740993n })` produces `{ value: 9007199254740992 }`.
**Fix shape:** Preserve unsafe BigInts as strings, throw on unsafe values, or provide field-specific serialization policies.
**Confidence:** high

---

### [MEDIUM] server/src/utils/async.ts:98 — `withTimeout` does not cancel the underlying work
**Category:** Concurrency / resource leak
**Status:** Accept
**Cross-pass:** Codex only
**What:** `withTimeout` rejects on the timer but leaves the original promise running because it has no cancellation path. The caller regains control while the timed-out operation can still mutate state, consume sockets, or hold database work.
**Why it matters:** Timeouts can mask continued side effects and accumulate resource usage under slow external dependencies.
**Repro / trigger:** Wrap a long-running fetch or DB write in `withTimeout(..., 10)`; after the timeout error the original operation continues.
**Fix shape:** Accept and propagate an `AbortSignal` or cancellation callback; document unsupported cancellation explicitly for non-cancellable work.
**Confidence:** high

---

### [MEDIUM] server/src/utils/docker/tor.ts:68 — Concurrent Tor creation races on check-then-create
**Category:** Concurrency
**Status:** Accept
**Cross-pass:** Codex only
**What:** `createTorContainer` checks for an existing container, then pulls and creates one without a single-flight guard or conflict recovery. Two concurrent calls can both observe "not created" and race on the same container name.
**Why it matters:** Normal concurrent admin/API calls can produce a spurious failure even though the desired final state is just "Tor is running."
**Repro / trigger:** Start two `createTorContainer()` calls at the same time when no Tor container exists.
**Fix shape:** Add a per-process single-flight lock and treat Docker create conflicts by re-reading status and starting the existing container.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/errors.ts:87 — `isUniqueConstraintError` substring fallback false-positives
**Category:** Logic / boundary
**Status:** Accept
**Cross-pass:** Claude only
**What:** When the error is not a Prisma typed error, falls back to `String(error).includes('Unique constraint')`. `String({})` is `"[object Object]"`; `String(null)` is `"null"`. Any error message containing the literal substring (e.g., a wrapped error or a translated user-facing message) triggers a false positive.
**Why it matters:** Callers route a non-Prisma error through unique-constraint handling, returning 409 Conflict for unrelated failures.
**Repro / trigger:** Throw `new Error('Validation failed: Unique constraint not satisfied by client schema')` from non-Prisma code.
**Fix shape:** Require `error instanceof Error` first; match only when the message also includes "P2002" or a Prisma signature.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/errors.ts:243 — `validatePagination` accepts pathological inputs
**Category:** Boundary
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Two related boundary gaps: (1) `parseInt("1e9")` returns `1` (parseInt stops at 'e'), so `?limit=1e9` is silently treated as `limit=1`, hiding caller intent or bot probing; (2) `maxLimit` itself is not validated, so passing `0`, a negative number, or `NaN` for `maxLimit` returns `{ limit: 0 | negative | NaN, offset: 0 }`, propagating invalid pagination into DB `take`/`limit`.
**Why it matters:** Surprising silent coercion masks bad input; downstream DB queries may receive invalid limits.
**Repro / trigger:** `?limit=1e9` → `limit: 1`. `validatePagination('10', '0', 0)` → `{ limit: 0, offset: 0 }`.
**Fix shape:** Use `Number()` with explicit integer validation and reject non-decimal-integer strings with a 400; validate `maxLimit` as a positive finite integer or fall back to a safe default before clamping.
**Confidence:** high

---

### [MEDIUM] server/src/utils/jwt.ts:291 — `verifyRefreshToken` collapses unrelated failures
**Category:** Error-handling gap
**Status:** Accept
**Cross-pass:** Codex only
**What:** Maps token revocation, malformed payloads, invalid signatures, and most internal verification errors to `Invalid refresh token`. Only expiry gets a distinct message.
**Why it matters:** Authentication remains fail-closed, but audit logs and callers cannot distinguish abuse, stale tokens, and dependency outages.
**Repro / trigger:** Make `isTokenRevoked(decoded.jti)` throw during refresh token verification.
**Fix shape:** Narrow JWT-library handling from revocation-store handling, log operational errors, and preserve intentional security classifications.
**Confidence:** high

---

### [MEDIUM] server/src/utils/jwt.ts:303 — `decodeToken` swallows errors but `jwt.decode` doesn't throw
**Category:** Smell / dead code
**Status:** Accept
**Cross-pass:** Claude only
**What:** `jwt.decode` from `jsonwebtoken` returns `null` on malformed input rather than throwing. The `try/catch` is dead and may mislead reviewers.
**Why it matters:** Defensive code that suggests behavior the library does not have; future code may rely on the catch.
**Repro / trigger:** Read the code.
**Fix shape:** Remove the try/catch and handle the `null` return that `jwt.decode` actually produces.
**Confidence:** high

---

### [MEDIUM] server/src/utils/jwt.ts:318 — Bearer scheme matched case-sensitively
**Category:** Logic
**Status:** Accept
**Cross-pass:** Claude only
**What:** `parts[0] !== 'Bearer'` rejects `bearer` and `BEARER`. RFC 6750 says the scheme is case-insensitive.
**Why it matters:** Some clients (curl examples, older SDKs) send lowercase `bearer` and get 401s.
**Repro / trigger:** `Authorization: bearer <token>` → null.
**Fix shape:** `parts[0].toLowerCase() !== 'bearer'`.
**Confidence:** high

---

### [MEDIUM] server/src/utils/password.ts:14 — Password hashing does not guard bcrypt's 72-byte limit
**Category:** Security / boundary
**Status:** Accept
**Cross-pass:** Codex only
**What:** `hashPassword` and `verifyPassword` pass raw strings to bcryptjs without enforcing or documenting bcrypt's 72-byte input limit.
**Why it matters:** Two long passwords that share the first 72 bytes hash/verify equivalently, surprising users and weakening password semantics.
**Repro / trigger:** Hash a password longer than 72 UTF-8 bytes; verify another with the same first 72 bytes and a different suffix.
**Fix shape:** Enforce a maximum UTF-8 byte length before hashing/verifying, or migrate to a prehashing scheme with clear versioning.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/safeJson.ts:52 — `valuePreview` leaks raw secret-bearing values into logs
**Category:** Security
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `safeJsonParse` and `safeJsonParseUntyped` log `value.substring(0, 100)` on parse or schema-validation failure. The logger's `redactObject` does not redact a key called `valuePreview`, and the 100 chars may contain `{"password":"hunter2"...` or tokens verbatim — exactly when parsing fails (the most likely time for secrets to be in the wrong shape).
**Why it matters:** Settings, user data, and config blobs routinely contain tokens/passwords; failed parses dump them unredacted into logs.
**Repro / trigger:** `safeJsonParse('{"token":"secret",', z.object({}), {}, 'config')`.
**Fix shape:** Run the preview through value-level pattern redaction, omit previews by default, or log only the length and error class. Require an explicit opt-in for known-safe previews.
**Confidence:** high

---

### [MEDIUM] server/src/utils/safeJson.ts:88 — `safeJsonParseUntyped` returns unchecked data as a trusted type
**Category:** Unsafe JSON.parse
**Status:** Accept
**Cross-pass:** Codex only
**What:** Performs `JSON.parse(value) as T` with no schema validation or key sanitization. The type assertion makes untrusted JSON look validated.
**Why it matters:** Downstream code can accept wrong shapes or dangerous keys such as `__proto__` and only fail later at business-logic boundaries.
**Repro / trigger:** Parse `{"roles":"admin"}` as `{ roles: string[] }`, or parse an object with `__proto__` and merge it.
**Fix shape:** Prefer Zod-backed parsing, return `unknown` from untyped parsing, and sanitize prototype-sensitive keys when accepting objects.
**Confidence:** high

---

### [MEDIUM] server/src/utils/serialization.ts:35 — `serializeForJson` has no cycle guard
**Category:** Resource leak / boundary
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Recursively traverses objects and arrays without a `WeakSet` or maximum depth. Circular inputs (e.g., a `DraftTransaction` containing a self-reference via Prisma includes) recurse until stack overflow.
**Why it matters:** Generic helper used on JSON response paths; a malformed include could DoS a route via stack exhaustion.
**Repro / trigger:** `const x: any = {}; x.self = x; serializeForJson(x);`.
**Fix shape:** Track seen objects with a path-based ancestor `Set` (see the `redactObject` DAG fix); emit a circular marker, throw a clear error, or constrain to known acyclic Prisma models.
**Confidence:** high

---

### [MEDIUM] server/src/utils/serialization.ts:36 — `serializeForJson` is prototype-pollution unsafe
**Category:** Security / prototype pollution
**Status:** Accept
**Cross-pass:** Codex only
**What:** Creates `const result: Record<string, unknown> = {}` and assigns `result[key] = ...`. Assigning a `__proto__` key invokes the legacy prototype setter instead of creating a plain data property.
**Why it matters:** Malicious or untrusted object keys can alter the prototype of the serialized output, affecting downstream property checks or merges.
**Repro / trigger:** `serializeForJson(JSON.parse('{"__proto__":{"polluted":true}}'))` returns an object whose prototype has `polluted: true`.
**Fix shape:** Build objects with `Object.create(null)` or `Object.fromEntries`, and explicitly preserve `__proto__` as an own data property.
**Confidence:** high

---

### [MEDIUM] server/src/utils/tracing/index.ts:147 — Cache tracing records raw cache keys
**Category:** Security / observability
**Status:** Accept
**Cross-pass:** Codex only
**What:** `traceCacheOperation` writes the full cache key into span attributes. Cache keys often contain usernames, object IDs, session identifiers, or token-derived values.
**Why it matters:** Trace exporters become a secondary sink for sensitive or high-cardinality identifiers.
**Repro / trigger:** `traceCacheOperation('get', 'session:raw-token', fn)` exports `cache.key=session:raw-token`.
**Fix shape:** Record a key class or hash instead of the raw key; document which attributes are safe for tracing.
**Confidence:** medium

---

### [MEDIUM] server/src/utils/tracing/middleware.ts:137 — HTTP spans can leak on client aborts
**Category:** Resource leak / concurrency
**Status:** Accept
**Cross-pass:** Codex only
**What:** Middleware finishes spans by monkey-patching `res.end`. If a client disconnects or the response closes before `res.end` runs, `finishSpan` may never execute.
**Why it matters:** Open spans degrade tracing accuracy and accumulate memory/exporter state during aborted requests.
**Repro / trigger:** Start a traced request and close the client connection before the handler writes a response.
**Fix shape:** Use `res.once('finish')` and `res.once('close')` (or `on-finished`) with an idempotent span finalizer.
**Confidence:** high

---

### [MEDIUM] server/src/utils/tracing/otel.ts:101 — OpenTelemetry signal handlers not idempotent
**Category:** Resource leak / concurrency
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Every successful `initializeOpenTelemetry` call registers new `SIGTERM` and `SIGINT` listeners and runs SDK shutdown without removing listeners or coordinating with a central process-exit path. Re-initialization (test bootstrap, hot reload, retries) accumulates handlers; Node warns at 10+.
**Why it matters:** Listener leaks in long-running workers; duplicate shutdowns can race; signal ownership can interfere with the shared process-exit path.
**Repro / trigger:** Call `initializeOpenTelemetry()` twice with tracing enabled and inspect `process.listenerCount('SIGTERM')`.
**Fix shape:** Guard with a module-level singleton `initialized` flag; register `process.once` handlers; delegate termination to the shared process-exit handler.
**Confidence:** high

---

### [MEDIUM] server/src/utils/tracing/tracer.ts:211 — `startActiveSpan` does not record async exceptions
**Category:** Error-handling gap
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** When `actualFn` returns a Promise, the code does `return result.finally(() => span.end())`. Only synchronous throws hit the outer `catch`. Promise rejections only trigger `finally`, so the span ends with status `unset` and no `recordException` for the most common case (async handlers).
**Why it matters:** Async errors don't get recorded on the span, breaking trace observability for nearly all real handlers.
**Repro / trigger:** `getTracer('x').startActiveSpan('op', async () => { throw new Error('boom'); })`.
**Fix shape:** Mirror `withSpan`: `.then(v => { span.setStatus('ok'); span.end(); return v; }).catch(e => { span.recordException(e); span.end(); throw e; })`.
**Confidence:** high

---

### [MEDIUM] server/src/utils/tracing/tracer.ts:351 — Outgoing trace headers use request ID as trace ID
**Category:** Logic / invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** `getTraceHeaders` sets `x-trace-id` to `ctx.requestId` even when `ctx.traceId` exists. Breaks the invariant established by tracing middleware that stores the actual trace ID in request context.
**Why it matters:** Downstream services receive a new or unrelated trace identifier, splitting traces across services.
**Repro / trigger:** Request context `{ requestId: 'req-1', traceId: 'trace-1' }` → `getTraceHeaders()` returns `x-trace-id: req-1`.
**Fix shape:** Emit `ctx.traceId ?? ctx.requestId`; use a standard `traceparent` header when possible.
**Confidence:** high

---

### [MEDIUM] server/src/utils/tracing/tracer.ts:363 — Incoming trace context accepted without validation
**Category:** Security / boundary
**Status:** Accept
**Cross-pass:** Codex only
**What:** `parseTraceContext` accepts arbitrary `x-trace-id` values and loosely-split `traceparent` values without checking W3C hex lengths, flags, or maximum header size.
**Why it matters:** Attackers or noisy clients can inject malformed or high-cardinality trace IDs into logs and trace backends.
**Repro / trigger:** Send a request with `x-trace-id` set to a very long random string.
**Fix shape:** Validate trace IDs/span IDs against W3C Trace Context rules, cap lengths, and drop malformed context.
**Confidence:** high

---

### [LOW] server/src/utils/async.ts:87 — `withTimeout` `timeoutId` typing under strict mode
**Category:** Smell
**Status:** Accept
**Cross-pass:** Claude only
**What:** `timeoutId` is declared then assigned inside the executor. The `clearTimeout(timeoutId)` works at runtime (`clearTimeout(undefined)` is a no-op), but strict-mode typing may flag the use-before-assign.
**Why it matters:** Code smell only; orthogonal to the cancellation gap covered above.
**Fix shape:** `let timeoutId: NodeJS.Timeout | undefined`.
**Confidence:** low

---

### [LOW] server/src/utils/docker/common.ts:31 — Availability check drops failure context
**Category:** Swallowed error
**Status:** Accept
**Cross-pass:** Codex only
**What:** `isDockerProxyAvailable` catches all failures and returns `false` without logging the reason. Collapses DNS errors, refused connections, invalid responses, and timeouts into one boolean.
**Why it matters:** Operators lose the diagnostic detail needed to distinguish expected unavailability from misconfiguration.
**Repro / trigger:** Set `DOCKER_PROXY_URL` to a bad host and call `isDockerProxyAvailable()`.
**Fix shape:** Log the failure at debug level, or return a structured status object with a boolean helper as a wrapper.
**Confidence:** medium

---

### [LOW] server/src/utils/encryption.ts:71 — `decrypt` does not validate IV decodes to 16 bytes
**Category:** Boundary / diagnostics
**Status:** Accept
**Cross-pass:** Claude only
**What:** A truncated base64 IV decodes to a Buffer shorter than 16 bytes. `createDecipheriv` throws a generic "Invalid IV length" — no security issue, but the error does not tell the operator the IV was malformed.
**Why it matters:** Diagnostic quality only.
**Fix shape:** Validate `Buffer.from(ivB64, 'base64').length === 16` and throw a specific error.
**Confidence:** low

---

### [LOW] server/src/utils/logger.ts:127 — `safeStringify` shared `seen` mis-marks DAGs as circular
**Category:** Logic
**Status:** Accept
**Cross-pass:** Claude only
**What:** Same root cause as the `redactObject` DAG bug: a single shared `WeakSet` for the whole serialization marks legitimately shared (non-cyclic) references as `[Circular]`.
**Why it matters:** Logged objects with DAG-shaped structure lose data.
**Repro / trigger:** `safeStringify({ a: shared, b: shared })`.
**Fix shape:** Track ancestors per-path rather than globally.
**Confidence:** high

---

### [LOW] server/src/utils/redact.ts:53 — Sensitive-field regex patterns over-redact
**Category:** Smell
**Status:** Accept
**Cross-pass:** Claude only
**What:** Patterns like `/password/i` match any field containing "password", including `passwordRequirements`, `passwordPolicy`, `passwordHint` — innocuous metadata fields are over-redacted into `[REDACTED]`.
**Why it matters:** Operators lose visibility into config diagnostics; over-redaction errs safe but degrades observability.
**Fix shape:** Anchor patterns to whole-word matches or maintain an explicit allowlist of safe field names.
**Confidence:** medium

---

### [LOW] server/src/utils/tracing/middleware.ts:121 — Span name leaks raw `req.path` for unmatched routes
**Category:** Smell / observability
**Status:** Accept
**Cross-pass:** Claude only
**What:** `spanName = `${req.method} ${req.route?.path || req.path}``. For 404s or paths with high cardinality (e.g., `/users/abc-123`), `req.route` is undefined so the raw path is used — exploding trace cardinality.
**Why it matters:** Trace backend cost/cardinality, not a correctness bug.
**Fix shape:** Fall back to `${req.method} <unmatched>` or use a sanitized template.
**Confidence:** medium

---

### [LOW] server/src/utils/tracing/tracer.ts:88 — Uses global `crypto.getRandomValues` (Node ≥19 only)
**Category:** Smell / portability
**Status:** Accept
**Cross-pass:** Claude only
**What:** Uses bare `crypto.getRandomValues` (web crypto) rather than `node:crypto`'s `randomBytes`. Node 19+ exposes it globally; earlier Nodes require an explicit import.
**Why it matters:** Fine on the current project Node version, but a footgun if Node is downgraded.
**Fix shape:** Use `randomBytes(16).toString('hex')` from `node:crypto` for consistency with other utils.
**Confidence:** low

## Considered & rejected

(none)

## Deferred

(none — no overlaps with tracked tech debt in MEMORY.md)
