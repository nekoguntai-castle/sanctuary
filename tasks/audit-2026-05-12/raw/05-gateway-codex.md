# Phase B — gateway (Codex)

> **Note:** Codex's sandbox blocked the file write; reconstructed from inline summary. Per-line entries are top findings only; medium/low Codex bucket exists but is not fully enumerated.

**Severity counts (Codex):** critical 0 · high 3 · medium 5 · low 2 (10 total across 26 files).

## Top findings

### [HIGH] gateway/src/middleware/mobilePermission.ts:87 — Fail-open permission gate (truthy-string bug)
**Category:** Security / logic
**What:** Permission gate accepts `{"allowed":"false"}` (truthy string) as permitting the action.
**Why it matters:** A misformatted or malicious backend response grants wallet-scoped actions (transactions, addresses, PSBTs).
**Repro / trigger:** Backend returns JSON with `allowed` as the literal string `"false"` instead of boolean `false`.
**Fix shape:** Strict equality check `=== true`; type-narrow before evaluating.
**Confidence:** high
**Cross-pass:** New (not in Claude pass).

### [HIGH] gateway/src/services/backendEvents/index.ts:101 — Unhandled rejection in WS event dispatch
**Category:** Concurrency / async
**What:** `handleEvent(...)` called without `await`/`.catch`; raw `JSON.parse` plus missing-field paths cause unhandled rejections that escape the surrounding try/catch.
**Why it matters:** Process-level fatal handler trips; gateway crashes.
**Repro / trigger:** Backend emits a conforming-shape event missing a required nested field; or a failing FCM/APNs send within `handleEvent`.
**Fix shape:** `await handleEvent(...)` and add a `.catch` that logs and returns; validate parsed JSON shape before dispatch.
**Confidence:** high
**Cross-pass:** Same finding as Claude `gateway/backendEvents/index.ts:101`. **Double-flagged → high signal.**

### [HIGH] gateway/src/routes/proxyConfig.ts:23 + mobilePermission.ts:63 — No outbound timeout on backend / permission-check fetch
**Category:** Resource / DoS
**What:** Outbound fetches to backend (proxy + permission-check) have no timeout.
**Why it matters:** A slow backend ties up gateway sockets and degrades the internet-facing edge until process restart.
**Repro / trigger:** Backend response stalls (network, slow query); gateway sockets accumulate.
**Fix shape:** Add `AbortController` with bounded timeout to all outbound fetches; surface timeout as 504 to the client.
**Confidence:** high
**Cross-pass:** New (not in Claude pass).

## Notable medium/low (per Codex inline summary)

- **[MEDIUM]** `apns.ts:99` — APNs logs full raw device tokens on failure (PII / token-leak risk).
- **[MEDIUM]** `requestLogger.ts:109` — `X-Forwarded-For` used verbatim for audit IP attribution without trust-proxy gating.
- **[LOW]** `config.ts:164` — `console.warn`/`console.error` in config validation bypasses the redaction logger.

5 additional medium + 1 additional low findings exist per Codex but were not captured before the sandbox blocked the write.
