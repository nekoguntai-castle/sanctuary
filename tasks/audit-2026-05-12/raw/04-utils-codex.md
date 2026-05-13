# Utils Audit Report

Scope: `server/src/utils/**/*.ts` and `server/src/utils/*.ts` (26 TypeScript files).

Intentional backward-compatibility shims were not flagged.

### [HIGH] server/src/utils/async.ts:39 — Invalid concurrency returns unprocessed results
**Category:** concurrency / boundary
**What:** `mapWithConcurrency` builds workers from `Math.min(concurrency, items.length)` without validating that `concurrency` is a positive finite integer. For `0`, negative, or `NaN`, it creates zero workers and returns the preallocated sparse results array without running `fn`.
**Why it matters:** Callers can believe all work completed successfully while none of the items were processed.
**Repro / trigger:** `await mapWithConcurrency([1, 2], async x => x, 0)` resolves to an array with empty slots.
**Fix shape:** Reject or normalize non-finite, non-integer, and `< 1` concurrency values before creating workers.
**Confidence:** high

### [HIGH] server/src/utils/async.ts:65 — Non-positive batch size can hang the process
**Category:** null/boundary / resource leak
**What:** `batchProcess` advances its batching loop with `i += batchSize` without validating `batchSize`. A `batchSize` of `0` never advances, and a negative value moves away from termination.
**Why it matters:** A bad caller or malformed input can spin indefinitely and allocate batches until the process is exhausted.
**Repro / trigger:** `await batchProcess([1], 0, async batch => batch)` never leaves the `for` loop.
**Fix shape:** Validate `batchSize` as a positive finite integer and fail fast before the loop.
**Confidence:** high

### [MEDIUM] server/src/utils/async.ts:98 — Timeout wrapper does not cancel underlying work
**Category:** concurrency / resource leak
**What:** `withTimeout` rejects on the timer but leaves the original promise running because it has no cancellation path. The caller regains control while the timed-out operation can still mutate state, consume sockets, or hold database work.
**Why it matters:** Timeouts can mask continued side effects and accumulate resource usage under slow external dependencies.
**Repro / trigger:** Wrap a long-running fetch or database write in `withTimeout(..., 10)`; after the timeout error, the original operation continues.
**Fix shape:** Accept and propagate an `AbortSignal` or cancellation callback, and document unsupported cancellation explicitly for non-cancellable work.
**Confidence:** high

### [HIGH] server/src/utils/docker/common.ts:40 — Docker proxy calls lack request timeouts
**Category:** resource leak / error-handling
**What:** `listAllContainers` calls `fetch` without an `AbortSignal`, and the Tor container helpers make the same kind of unbounded Docker proxy calls. Only the lightweight availability check has a timeout.
**Why it matters:** If the Docker socket proxy accepts a connection but stalls, status/start/stop/create paths can hang request handlers or background tasks indefinitely.
**Repro / trigger:** Point `DOCKER_PROXY_URL` at an endpoint that accepts connections but never responds, then call `getTorStatus()` or `createTorContainer()`.
**Fix shape:** Centralize Docker proxy fetches behind a helper with bounded timeouts, contextual errors, and optional retry policy.
**Confidence:** high

### [LOW] server/src/utils/docker/common.ts:31 — Availability check drops failure context
**Category:** swallowed error
**What:** `isDockerProxyAvailable` catches all failures and returns `false` without logging or returning the reason. That collapses DNS errors, refused connections, invalid responses, and timeouts into one boolean.
**Why it matters:** Operators lose the diagnostic detail needed to distinguish expected unavailability from misconfiguration.
**Repro / trigger:** Set `DOCKER_PROXY_URL` to a bad host and call `isDockerProxyAvailable()`.
**Fix shape:** Log the failure at debug level or return a structured status object while keeping the boolean helper as a wrapper.
**Confidence:** medium

### [HIGH] server/src/utils/docker/tor.ts:82 — Tor image is pulled from a mutable tag
**Category:** security
**What:** `createTorContainer` pulls and runs `dperson/torproxy:latest`. The `latest` tag is mutable and does not pin the image content the server will execute.
**Why it matters:** A tag update or registry compromise can change the container code without a code review or deploy diff.
**Repro / trigger:** Call `createTorContainer()` after the upstream `latest` tag changes.
**Fix shape:** Pin a vetted version or digest, expose upgrades as explicit configuration, and verify the selected image during release.
**Confidence:** high

### [MEDIUM] server/src/utils/docker/tor.ts:68 — Concurrent Tor creation races on check-then-create
**Category:** concurrency
**What:** `createTorContainer` checks for an existing container, then pulls and creates one without a single-flight guard or conflict recovery. Two concurrent calls can both observe "not created" and race on the same container name.
**Why it matters:** Normal concurrent admin/API calls can produce a spurious failure even though the desired final state is just "Tor is running."
**Repro / trigger:** Start two `createTorContainer()` calls at the same time when no Tor container exists.
**Fix shape:** Add a per-process single-flight lock and treat Docker create conflicts by re-reading status and starting the existing container.
**Confidence:** medium

### [MEDIUM] server/src/utils/encryption.ts:101 — Encrypted-value detection accepts invalid ciphertext shapes
**Category:** logic / boundary
**What:** `isEncrypted` only checks for three non-empty base64-looking fields. It does not validate decoded IV/auth-tag lengths or canonical base64 encoding before `decryptIfEncrypted` attempts decryption.
**Why it matters:** Plaintext legacy values containing two colons and base64-looking characters can be misclassified as encrypted and fail reads.
**Repro / trigger:** `decryptIfEncrypted('abc:def:ghi')` passes `isEncrypted` and then throws during decipher setup.
**Fix shape:** Validate exact decoded field lengths for AES-GCM, reject malformed base64 by round-tripping, or add a versioned ciphertext prefix.
**Confidence:** high

### [HIGH] server/src/utils/errors.ts:272 — Unsafe BigInt conversion returns rounded numbers
**Category:** logic / boundary
**What:** `bigIntToNumber` logs when a value is outside `Number`'s safe integer range but still returns the converted number. The function comment says it throws on unsafe values, but the implementation does not.
**Why it matters:** Large integer balances, counters, or IDs can be silently rounded and then serialized or used in calculations incorrectly.
**Repro / trigger:** `bigIntToNumber(9007199254740993n)` returns `9007199254740992`.
**Fix shape:** Throw on unsafe integers or return a string/BigInt-preserving representation for JSON boundaries.
**Confidence:** high

### [MEDIUM] server/src/utils/errors.ts:249 — Pagination max limit can invalidate sanitized output
**Category:** null/boundary
**What:** `validatePagination` clamps parsed limits against `maxLimit` without validating `maxLimit` itself. Passing `0`, a negative number, or `NaN` can return `0`, a negative limit, or `NaN`.
**Why it matters:** Callers that rely on this helper for database `take`/`limit` values can still emit invalid pagination parameters.
**Repro / trigger:** `validatePagination('10', '0', 0)` returns `{ limit: 0, offset: 0 }`.
**Fix shape:** Validate `maxLimit` as a positive finite integer, or fall back to a safe default before clamping.
**Confidence:** high

### [MEDIUM] server/src/utils/jwt.ts:247 — Revocation failures are masked as generic token failures
**Category:** error-handling gap
**What:** `verifyToken` wraps the revocation check in a broad `catch`, so both an explicitly revoked token and a revocation-store failure become `Invalid or expired token`.
**Why it matters:** Security telemetry loses the difference between revoked credentials and infrastructure failure, and an outage in revocation storage can look like mass token expiry.
**Repro / trigger:** Have `isTokenRevoked(decoded.jti)` throw, or return true and hit the internal `Token has been revoked` throw.
**Fix shape:** Preserve the revoked-token error, log backend failures with context, and fail closed with a distinct operational error where appropriate.
**Confidence:** high

### [MEDIUM] server/src/utils/jwt.ts:291 — Refresh token verifier collapses unrelated failures
**Category:** error-handling gap
**What:** `verifyRefreshToken` maps token revocation, malformed payloads, invalid signatures, and most internal verification errors to `Invalid refresh token`. Only expiry gets a distinct message.
**Why it matters:** Authentication behavior remains fail-closed, but audit logs and callers cannot distinguish abuse, stale tokens, and dependency outages.
**Repro / trigger:** Make `isTokenRevoked(decoded.jti)` throw during refresh token verification.
**Fix shape:** Narrow JWT-library handling from revocation-store handling, log operational errors, and preserve intentional security classifications.
**Confidence:** high

### [MEDIUM] server/src/utils/password.ts:14 — Password hashing does not guard bcrypt's 72-byte limit
**Category:** security / boundary
**What:** `hashPassword` and `verifyPassword` pass raw strings to bcryptjs without enforcing or documenting bcrypt's 72-byte password input limit.
**Why it matters:** Two long passwords that share the first 72 bytes can hash/verify equivalently, surprising users and weakening password semantics.
**Repro / trigger:** Hash a password longer than 72 UTF-8 bytes, then verify another password with the same first 72 bytes and a different suffix.
**Fix shape:** Enforce a maximum UTF-8 byte length before hashing/verifying, or migrate to a prehashing scheme with clear versioning.
**Confidence:** medium

### [HIGH] server/src/utils/redact.ts:140 — Object redaction skips secrets inside arrays
**Category:** security
**What:** `redactObject` recurses into nested non-array objects but leaves arrays unchanged. A context value like `{ users: [{ password: 'secret' }] }` reaches the logger with the password intact.
**Why it matters:** Common API shapes wrap records in arrays, so sensitive fields can leak into application logs despite using the redaction utility.
**Repro / trigger:** `createLogger('x').info('users', { users: [{ password: 'secret' }] })`.
**Fix shape:** Recurse into arrays in `redactObject`, or have the logger use the existing deep redaction path consistently.
**Confidence:** high

### [HIGH] server/src/utils/redact.ts:211 — Error messages are not redacted
**Category:** security / error-handling
**What:** `safeError` returns `error.message` and development stacks directly. The surrounding redaction pass redacts by field name, so sensitive substrings inside `message` or `stack` are not removed.
**Why it matters:** Tokens, passwords, connection strings, or seed material embedded in thrown errors can be written to logs.
**Repro / trigger:** `log.error('failed', { error: new Error('token=secret-value') })` logs the token text.
**Fix shape:** Apply value-level sensitive-pattern redaction to error messages/stacks, or avoid logging raw error strings from security-sensitive boundaries.
**Confidence:** high

### [MEDIUM] server/src/utils/safeJson.ts:52 — JSON parse failures log raw value previews
**Category:** security / error-handling
**What:** `safeJsonParse` and `safeJsonParseUntyped` include `value.substring(0, 100)` in warning logs on validation or parse failure. The preview is not redacted.
**Why it matters:** Malformed secrets, tokens, or configuration blobs can leak into logs exactly when parsing fails.
**Repro / trigger:** `safeJsonParse('{\"token\":\"secret\",', z.object({}), {}, 'config')`.
**Fix shape:** Redact or omit previews by default, and require an explicit safe-preview option for known non-sensitive values.
**Confidence:** high

### [MEDIUM] server/src/utils/safeJson.ts:88 — Untyped JSON parser returns unchecked data as trusted type
**Category:** unsafe JSON.parse
**What:** `safeJsonParseUntyped` performs `JSON.parse(value) as T` with no schema validation or key sanitization. The type assertion can make untrusted JSON look validated to callers.
**Why it matters:** Downstream code can accept wrong shapes or dangerous keys such as `__proto__` and only fail later at business-logic boundaries.
**Repro / trigger:** Parse `{"roles":"admin"}` as `{ roles: string[] }` or parse an object with `__proto__` and later merge it into a normal object.
**Fix shape:** Prefer Zod-backed parsing, return `unknown` from untyped parsing, and sanitize prototype-sensitive keys when accepting objects.
**Confidence:** high

### [HIGH] server/src/utils/serialization.ts:24 — Generic serializer loses BigInt precision
**Category:** logic / boundary
**What:** `serializeForJson` converts every `bigint` with `Number(data)` and does not check `Number.isSafeInteger`. Values above `Number.MAX_SAFE_INTEGER` are rounded silently.
**Why it matters:** The helper is generic and used for JSON-safe model output, so large integer values can be corrupted before reaching API clients.
**Repro / trigger:** `serializeForJson({ value: 9007199254740993n })` produces `{ value: 9007199254740992 }`.
**Fix shape:** Preserve unsafe BigInts as strings, throw on unsafe values, or provide field-specific serialization policies.
**Confidence:** high

### [MEDIUM] server/src/utils/serialization.ts:36 — Serializer can mutate the returned object's prototype
**Category:** security / prototype pollution
**What:** `serializeForJson` creates `const result: Record<string, unknown> = {}` and assigns `result[key] = ...`. Assigning a `__proto__` key invokes the legacy prototype setter instead of creating a plain data property.
**Why it matters:** Malicious or untrusted object keys can alter the prototype of the serialized output, which can affect downstream property checks or merges.
**Repro / trigger:** `serializeForJson(JSON.parse('{\"__proto__\":{\"polluted\":true}}'))` returns an object whose prototype has `polluted: true`.
**Fix shape:** Build objects with `Object.create(null)` or `Object.fromEntries`, and explicitly preserve `__proto__` as an own data property.
**Confidence:** high

### [MEDIUM] server/src/utils/serialization.ts:35 — Generic serializer has no cycle guard
**Category:** resource leak / boundary
**What:** `serializeForJson` recursively traverses objects and arrays without a `WeakSet` or maximum depth. Circular or very deep inputs recurse until stack overflow.
**Why it matters:** The helper advertises generic serialization, so accidental circular data can crash the request path that serializes it.
**Repro / trigger:** `const x: any = {}; x.self = x; serializeForJson(x)`.
**Fix shape:** Track seen objects and either emit a circular marker, throw a clear error, or constrain the helper to known acyclic Prisma models.
**Confidence:** high

### [MEDIUM] server/src/utils/tracing/index.ts:147 — Cache tracing records raw cache keys
**Category:** security
**What:** `traceCacheOperation` writes the full cache key into span attributes. Cache keys often contain usernames, object IDs, session identifiers, or token-derived values.
**Why it matters:** Trace exporters can become a secondary sink for sensitive or high-cardinality identifiers.
**Repro / trigger:** `traceCacheOperation('get', 'session:raw-token', fn)` exports `cache.key=session:raw-token`.
**Fix shape:** Record a key class or hash instead of the raw key, and document which attributes are safe for tracing.
**Confidence:** medium

### [MEDIUM] server/src/utils/tracing/middleware.ts:137 — HTTP spans can leak on client aborts
**Category:** resource leak / concurrency
**What:** The middleware finishes spans by monkey-patching `res.end`. If a client disconnects or the response closes before `res.end` runs, `finishSpan` may never execute.
**Why it matters:** Open spans degrade tracing accuracy and can accumulate memory/exporter state during aborted requests.
**Repro / trigger:** Start a traced request and close the client connection before the handler writes a response.
**Fix shape:** Use `res.once('finish')` and `res.once('close')` or `on-finished` with an idempotent span finalizer.
**Confidence:** high

### [MEDIUM] server/src/utils/tracing/otel.ts:101 — OpenTelemetry signal handlers are not idempotent
**Category:** resource leak / concurrency
**What:** Every successful `initializeOpenTelemetry` call registers new `SIGTERM` and `SIGINT` listeners. The handler also performs SDK shutdown without removing listeners or coordinating with a central process-exit path.
**Why it matters:** Repeated initialization in tests, hot reload, or bootstrap retries can create duplicate shutdowns and listener leaks; signal ownership can also interfere with process shutdown if no other handler exits.
**Repro / trigger:** Call `initializeOpenTelemetry()` twice with tracing enabled and inspect `process.listenerCount('SIGTERM')`.
**Fix shape:** Guard initialization with a module-level singleton, register `process.once` handlers, and delegate termination to the shared process-exit handler.
**Confidence:** medium

### [MEDIUM] server/src/utils/tracing/tracer.ts:211 — Async active-span failures are not recorded
**Category:** error-handling gap
**What:** `SimpleTracer.startActiveSpan` uses `result.finally(() => span.end())` for promise results. Rejections end the span but do not call `recordException` or set an error status.
**Why it matters:** Failed async operations can appear as spans with no captured exception, weakening debugging and alerting.
**Repro / trigger:** `getTracer('x').startActiveSpan('op', async () => { throw new Error('boom'); })`.
**Fix shape:** Add a rejection path that records the exception before ending the span, matching the synchronous catch behavior.
**Confidence:** high

### [MEDIUM] server/src/utils/tracing/tracer.ts:351 — Outgoing trace headers use request ID as trace ID
**Category:** logic / invariant
**What:** `getTraceHeaders` sets `x-trace-id` to `ctx.requestId` even when `ctx.traceId` exists. This breaks the invariant established by tracing middleware that stores the actual trace ID in request context.
**Why it matters:** Downstream services receive a new or unrelated trace identifier, splitting traces across services.
**Repro / trigger:** In a request context with `{ requestId: 'req-1', traceId: 'trace-1' }`, `getTraceHeaders()` returns `x-trace-id: req-1`.
**Fix shape:** Emit `ctx.traceId ?? ctx.requestId` for `x-trace-id`, and use a standard `traceparent` header when possible.
**Confidence:** high

### [MEDIUM] server/src/utils/tracing/tracer.ts:363 — Incoming trace context is accepted without validation
**Category:** security / boundary
**What:** `parseTraceContext` accepts arbitrary `x-trace-id` values and loosely split `traceparent` values without checking W3C hex lengths, flags, or maximum header size.
**Why it matters:** Attackers or noisy clients can inject malformed or high-cardinality trace IDs into logs and trace backends.
**Repro / trigger:** Send a request with `x-trace-id` set to a very long random string.
**Fix shape:** Validate trace IDs/span IDs against W3C Trace Context rules, cap lengths, and drop malformed context.
**Confidence:** high

## Summary

Severity counts:

| Severity | Count |
| --- | ---: |
| critical | 0 |
| high | 8 |
| medium | 17 |
| low | 1 |

Top 3 findings by impact:

1. `server/src/utils/errors.ts:272` and `server/src/utils/serialization.ts:24` can silently round unsafe BigInt values before API output or calculations.
2. `server/src/utils/redact.ts:140` and `server/src/utils/redact.ts:211` can leak secrets through arrays and raw error messages despite the logger using redaction helpers.
3. `server/src/utils/async.ts:65` can hang the process for non-positive batch sizes, and `server/src/utils/docker/common.ts:40` can hang Docker operations without timeouts.

Files reviewed:

- `server/src/utils/apiKeyHash.ts`
- `server/src/utils/async.ts`
- `server/src/utils/docker/common.ts`
- `server/src/utils/docker/index.ts`
- `server/src/utils/docker/tor.ts`
- `server/src/utils/docker/types.ts`
- `server/src/utils/encryption.ts`
- `server/src/utils/errors.ts`
- `server/src/utils/fatalProcessHandlers.ts`
- `server/src/utils/jwt.ts`
- `server/src/utils/logger.ts`
- `server/src/utils/pagination.ts`
- `server/src/utils/password.ts`
- `server/src/utils/privacy.ts`
- `server/src/utils/processExit.ts`
- `server/src/utils/redact.ts`
- `server/src/utils/requestAbort.ts`
- `server/src/utils/requestContext.ts`
- `server/src/utils/safeJson.ts`
- `server/src/utils/serialization.ts`
- `server/src/utils/tracing/index.ts`
- `server/src/utils/tracing/middleware.ts`
- `server/src/utils/tracing/otel.ts`
- `server/src/utils/tracing/tracer.ts`
- `server/src/utils/tracing/types.ts`
- `server/src/utils/validators.ts`

Additional audit notes:

- No `catch (error: any)` or `@ts-ignore` was found in the reviewed `server/src/utils` files.
- `console.log` appears in `server/src/utils/logger.ts`, but the repository ESLint config explicitly exempts logger implementations from the production `console.log` restriction.
