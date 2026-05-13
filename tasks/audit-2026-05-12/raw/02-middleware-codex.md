# Phase B — middleware (Codex)

> **Note:** Codex's sandbox blocked the file write; this file was reconstructed from the agent's inline summary. Per-line finding entries below are the Codex-side highlights, not the full set Codex would have produced. Treat counts as a floor, not a ceiling.

**Severity counts (Codex):** critical 0 · high 3 · medium 7 · low 3

**Files reviewed (all 18):** agentAuth.ts, apiVersion.ts, auth.ts, authCookieNames.ts, bodyParsing.ts, corsOrigin.ts, csrf.ts, deviceAccess.ts, featureGate.ts, gatewayAuth.ts, i18n.ts, metrics.ts, rateLimit.ts, requestLogger.ts, requestTimeout.ts, resourceAccess.ts, validate.ts, walletAccess.ts.

## Top findings

### [HIGH] rateLimit.ts:88 — Raw X-Forwarded-For trusted for rate-limit key
**Category:** Security
**What:** Per-IP rate-limit key built from raw `X-Forwarded-For` header without trust-proxy reconciliation.
**Why it matters:** Attacker rotates XFF values to bypass per-IP limits on login / register / 2FA → credential-stuffing surface.
**Repro / trigger:** Repeated requests with rotating `X-Forwarded-For: <random>` values.
**Fix shape:** Honor Express `trust proxy: 1` — take the rightmost trusted hop, not the leftmost client-supplied value.
**Confidence:** high
**Cross-pass:** Same finding as Claude `rateLimit.ts:86-95`. **Double-flagged → high signal.**

### [HIGH] gatewayAuth.ts:108 — HMAC gateway auth has no nonce/jti, requests replayable
**Category:** Security
**What:** HMAC verification accepts any request within the 5-minute timestamp window; no nonce/jti to prevent replay.
**Why it matters:** A captured authenticated gateway request can be replayed for up to 5 minutes — useful as part of a chained attack.
**Repro / trigger:** Capture a valid HMAC'd request, replay within the timestamp window.
**Fix shape:** Add a nonce/jti to the signed payload and a short-TTL Redis set of recently-seen jtis; reject duplicates.
**Confidence:** high
**Cross-pass:** New (not in Claude pass).

### [HIGH] featureGate.ts:73 — Feature gates fail open to static config on flag-service error
**Category:** Logic / fail-open
**What:** On exception from the persistent flag service, `featureGate` falls back to static config. If a flag is disabled in DB for compliance/security reasons, a flag-service outage re-enables it.
**Why it matters:** A flag turned off for a security or compliance reason can re-enable itself during any flag-service disruption.
**Repro / trigger:** Take the flag service offline; check whether config-default lets the feature through.
**Fix shape:** Fail closed for security-tagged flags; only fail open for non-sensitive flags explicitly marked safe-default.
**Confidence:** high
**Cross-pass:** Same finding as Claude `featureGate.ts` (silent fallback to config). **Double-flagged → high signal.**

## Aggregate (per Codex)

- **Critical:** 0
- **High:** 3
- **Medium:** 7
- **Low:** 3

Per-line entries for the 7 medium + 3 low findings were not captured because Codex could not write to the workspace. Treat the medium/low Codex bucket as "exists but not enumerated here" during Phase C merge.
