# Brittle Checks Architecture Assessment

Date: 2026-04-28
Status: Draft
Scope: targeted production-code audit for fragile condition checks, regex fallbacks, and stringly typed classifiers.
Remediation plan: `docs/plans/brittle-checks-remediation-plan.md`

## Summary

The codebase is not broadly dominated by brittle checks. Most regex and string matching is acceptable because it sits at format boundaries: Bitcoin descriptor parsing, route contracts, validation, redaction, filename sanitization, and import handlers.

The brittle risk is concentrated in a few places where text matching is standing in for a stronger contract:

- AI Console fallback planning still has keyword/regex intent detection for natural language.
- Natural transaction query conversion still inspects the original prompt to infer whether a `limit` was explicit.
- Some wallet/device/account logic infers structured meaning from derivation-path string prefixes or substrings.
- Error/outcome classification sometimes depends on message text rather than typed provider/domain error codes.
- Docker project discovery and gateway audit outcome classification rely on name/event-token conventions.

## Findings

### 1. AI Console Language Fallbacks Still Contain Intent Regexes

Evidence:

- `ai-proxy/src/consoleProtocol.ts` has prompt classifiers for all wallets, current wallet, transaction mentions, dashboard terms, and broad-health prompts.
- `ai-proxy/src/consoleProtocol.ts` also has legacy date parsing for explicit ISO/month ranges.
- `ai-proxy/src/naturalQuery.ts` uses prompt regexes to decide whether a returned limit should be honored.

Risk:

- Medium. This is exactly the class of issue that caused the "show me transactions from this year" incident. The new typed transaction intent contract reduces the main risk, but the fallback surface can still drift as users phrase requests differently.

Better architecture:

- Treat natural language understanding as a model responsibility and treat Sanctuary code as an intent validator/resolver.
- Expand the typed intent protocol rather than adding phrase recognizers:
  - `query_transactions.target`
  - `query_transactions.filters.dateRange`
  - `query_transactions.limit: { kind: "explicit", value: number } | { kind: "default" }`
  - `get_wallet_overview.target`
  - `get_dashboard_summary.target`
- Keep deterministic parsing only for already-structured syntax, such as ISO dates, exact command buttons, or direct API inputs.
- For model failure/non-JSON, prefer a clear planning failure for ambiguous natural-language prompts instead of silently guessing. A narrow fallback can remain for high-confidence explicit prompts, but it should be treated as compatibility glue, not primary behavior.

Suggested refactor:

1. Add typed intents for overview/dashboard, mirroring the transaction intent schema.
2. Move `limit` explicitness into the intent schema and remove prompt regex checks from `naturalQuery.ts`.
3. Keep explicit date range parsing only as a compatibility path for legacy direct `toolCalls`; require new model responses to use typed `dateRange`.
4. Track fallback usage with a warning/metric so production shows when the compatibility path is still active.

### 2. Wallet Name Matching Uses Substring Inclusion

Evidence:

- `ai-proxy/src/consoleProtocol.ts` normalizes wallet names and checks whether the normalized prompt includes the normalized wallet name.

Risk:

- Medium. It can false-match short/common names, fail on aliases, or choose the first match when two wallet names overlap.

Better architecture:

- Prefer typed target selection from the model: the planner receives scoped wallet IDs/names and returns `target: { kind: "wallet_id", walletId }`.
- If deterministic matching remains, make it an adapter with explicit ambiguity handling:
  - tokenize prompt and wallet names;
  - require full token-boundary matches;
  - reject multiple matches instead of choosing the first;
  - ignore very short names unless exact quoted text is present.

Suggested refactor:

- Replace `namedWalletIdFromPrompt` with a small `resolveWalletReference()` module that returns `{ ok: true, walletId }`, `{ ok: false, reason: "ambiguous" }`, or `{ ok: false, reason: "not_found" }`.
- Use that resolver only as a fallback when the typed model intent does not already provide `wallet_id`.

### 3. Derivation Path Meaning Is Inferred In Multiple Ways

Evidence:

- `server/src/services/deviceAccountConflicts.ts` infers account purpose and script type using `startsWith("m/48'")`, `startsWith("m/86'")`, `startsWith("m/49'")`, and `startsWith("m/44'")`, then defaults to native segwit.
- `services/hardwareWallet/pathUtils.ts` has a separate path normalization and script-type inference helper.

Risk:

- Medium. Silent defaulting to native segwit for unknown purposes can hide malformed or unsupported paths. Multiple implementations can also diverge.

Better architecture:

- Create one shared derivation-path parser that returns structured fields:
  - `purpose`
  - `coinType`
  - `account`
  - optional `change`
  - optional `index`
  - `scriptType`, or an explicit unsupported/unknown result
- Consumers should handle `unknown` explicitly instead of defaulting to native segwit.

Suggested refactor:

- Move the path parser into `shared/utils/bitcoin` or a server/shared package that both `services/hardwareWallet` and backend import paths can use.
- Replace prefix checks in `deviceAccountConflicts.ts` with the parser.
- Add tests for `m/48'`, `m/84'`, `m/86'`, `m/49'`, `m/44'`, bare paths, `h` notation, unknown purpose, malformed paths, and testnet coin type.

### 4. Address Chain Detection Uses Derivation Path Substrings

Evidence:

- `server/src/services/bitcoin/sync/addressDiscovery.ts` separates receive/change addresses using `derivationPath?.includes('/0/')` and `derivationPath?.includes('/1/')`.
- `server/src/services/bitcoin/sync/pipeline.ts` uses the same pattern for logging address breakdowns.
- `addressDiscovery.ts` derives `index` with `derivationPath.split('/').pop()`.

Risk:

- Medium. This is safe for today’s generated paths if the format is stable, but it is a hidden contract. It can misclassify non-standard paths, malformed paths, or future descriptor variants.

Better architecture:

- Store structured address metadata when deriving addresses:
  - `chain: "receive" | "change"`
  - `index: number`
  - optionally `accountPath`
- Treat the derivation path as display/provenance, not as the primary source of chain/index behavior.

Suggested refactor:

- Add a shared `parseAddressDerivationPath()` helper as an interim step.
- Longer term, add `chain` and `index` repository fields or ensure existing `index` is paired with an explicit chain field.

### 5. Error Classification Sometimes Uses Message Text

Evidence:

- `server/src/utils/errors.ts` falls back to `String(error).includes('Unique constraint')`.
- `server/src/errors/errorHandler.ts` and `server/src/utils/errors.ts` duplicate Prisma target-to-message mapping with `target.includes(...)`.
- `server/src/services/push/types.ts` classifies invalid tokens from string fragments such as `BadDeviceToken`, `Unregistered`, and FCM registration-token strings.
- `server/src/services/agentApiService.ts` maps some attempt reason codes from message substrings.
- `src/api/console.ts` classifies provider setup errors by matching user-facing message text.

Risk:

- Medium. Provider messages change, translations can change user-facing text, and duplicate mappings drift. The push path is partly acceptable because provider protocols expose string reason codes, but the provider boundary should normalize them before domain code sees them.

Better architecture:

- Normalize external/provider errors at the boundary into typed domain errors:
  - `PushProviderError { code: "bad_device_token" | "unregistered" | ... }`
  - `ConsoleSetupError { reason: "provider_not_configured" | "config_sync_failed" }`
  - `AgentFundingAttemptError { reasonCode }`
- Keep message matching inside provider adapters only, then export stable domain codes.
- Deduplicate Prisma mapping into one helper that maps Prisma code/meta to a domain `ApiError`.

Suggested refactor:

- Change Console setup API responses to include a stable `reason` field and have the UI check that field.
- Change push providers to return structured error codes in `PushResult`, then deprecate broad `String(err)` matching.
- Move Prisma P2002 target mapping to a shared `mapPrismaKnownError()` helper.

### 6. Gateway Audit Outcome Depends On Event Name Tokens

Evidence:

- `server/src/api/push.ts` marks gateway audit events as failures when the event string includes one of the configured failure tokens.

Risk:

- Low to medium. This is operationally scoped, but event naming changes can flip audit success/failure.

Better architecture:

- Add an explicit `outcome: "success" | "failure"` or `success: boolean` field to the gateway audit event schema.
- Keep token inference only as a backwards-compatible migration path for older gateway senders.

### 7. Docker Compose Project Discovery Depends On Container Name Shape

Evidence:

- `server/src/utils/docker/common.ts` discovers the Compose project by looking for container names that include `-backend-` or `-frontend-`, then regexes the project prefix.

Risk:

- Low. This is operational support code, not wallet-critical behavior. It can break under alternate Compose naming or renamed services.

Better architecture:

- Prefer Docker labels:
  - `com.docker.compose.project`
  - `com.docker.compose.service`
- Fall back to name parsing only if labels are unavailable.

## Acceptable Patterns

These are not currently architectural concerns:

- Gateway route whitelist regexes are generated from a single contract and validated against OpenAPI.
- Endpoint host/CIDR checks are explicit SSRF boundary logic.
- Bitcoin descriptor, xpub, address, and import-format parsers are inherently text parsers; the key is centralization and tests, not eliminating regex.
- Filename sanitization, log redaction, API version parsing, and route timeout matching are local boundary checks with low blast radius.

## Recommended Sequence

1. Console intent protocol completion: typed overview/dashboard intents, typed limit intent, and fallback usage metrics.
2. Derivation path parser consolidation: one shared parser, no silent script-type default for unknown purposes.
3. Address chain metadata: stop inferring receive/change from path substrings in sync paths.
4. Structured error codes: Console setup reason, push provider errors, and agent funding reasons.
5. Operational cleanup: gateway audit outcome field and Docker label-based project discovery.

## Verification Notes

- This was a static audit with direct inspection and repository search. No production code was changed.
- The existing tests already cover the recent Console transaction intent behavior and push invalid-token string cases, but those tests mostly lock current behavior rather than removing the underlying stringly contracts.
