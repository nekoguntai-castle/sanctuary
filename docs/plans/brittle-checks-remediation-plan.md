# Brittle Checks Remediation Plan

Date: 2026-04-28
Status: Draft
Source assessment: `docs/plans/brittle-checks-assessment.md`

## Goal

Reduce brittle text/regex/message checks where they stand in for stronger contracts, without removing legitimate text parsers at system boundaries.

The target architecture is:

- LLMs interpret natural language into typed intents.
- Sanctuary validates, authorizes, and resolves those intents into exact tool inputs.
- Bitcoin paths are parsed once into structured data and reused everywhere.
- External provider errors are normalized at the adapter boundary into stable domain codes.
- Operational conventions use explicit fields or Docker labels before name/message fallbacks.

## Principles

- Prefer typed contracts over phrase recognition.
- Keep regex where the domain is genuinely textual: descriptors, imports, headers, route matching, redaction, and validation.
- Fail closed on ambiguous wallet/account/security decisions.
- Keep backwards compatibility paths isolated, logged, and removable.
- Ship small PRs with focused tests; do not mix Console, Bitcoin sync, and provider error refactors in one change.

## Phase 1: Console Intent Protocol Completion

Priority: highest

Why first:

- This directly addresses the class of bug that started the discussion.
- It has limited blast radius: `ai-proxy`, Console planning tests, and natural query conversion.
- It creates the pattern the rest of the product should follow: LLM for language, schema for contracts.

Scope:

- `ai-proxy/src/consoleProtocol.ts`
- `ai-proxy/src/naturalQuery.ts`
- `ai-proxy/src/consoleRoutes.ts`
- `tests/ai-proxy/consoleProtocol.test.ts`
- `tests/ai-proxy/naturalQuery.test.ts`

Plan:

- Define a typed `ConsoleIntent` union:
  - `query_transactions`
  - `get_wallet_overview`
  - `get_dashboard_summary`
- Extend transaction intent with explicit limit semantics:
  - `{ kind: "explicit", value: number }`
  - `{ kind: "default" }`
- Keep transaction target/date handling in typed intent resolution:
  - current wallet
  - named wallet resolved to scoped `wallet_id`
  - all scoped wallets
  - relative and explicit date ranges
- Move natural-query `limit` behavior from prompt regex to typed intent data.
- Preserve legacy direct `toolCalls` parsing for compatibility, but do not add new natural-language phrase rules.
- Add planner warnings or logs when fallback planning is used, so we can measure whether compatibility fallback still matters.

Exit criteria:

- No prompt regex is needed to decide whether a transaction limit is explicit.
- Overview/dashboard routing can be expressed as typed intents.
- Ambiguous auto-context wallet targets fail closed with a clear warning.
- Existing legacy `toolCalls` tests still pass.

Focused verification:

- `npx vitest run tests/ai-proxy/consoleProtocol.test.ts tests/ai-proxy/naturalQuery.test.ts`
- `npm --prefix ai-proxy run build`
- `npm run typecheck:tests`
- `npm run quality:lizard`
- `git diff --check`

## Phase 2: Wallet Reference Resolution Cleanup

Priority: high

Why separate:

- Wallet name matching is coupled to Console planning, but it deserves a small, testable resolver instead of being hidden inside fallback planning.

Scope:

- `ai-proxy/src/consoleProtocol.ts`
- New helper module if it reduces complexity, for example `ai-proxy/src/walletReferenceResolver.ts`
- `tests/ai-proxy/consoleProtocol.test.ts`

Plan:

- Replace first-match substring logic with an explicit resolver result:
  - `{ ok: true, walletId }`
  - `{ ok: false, reason: "ambiguous" }`
  - `{ ok: false, reason: "not_found" }`
- Match normalized wallet-name tokens at word boundaries.
- Reject multiple matches.
- Reject very short wallet names unless the prompt contains an exact quoted reference.
- Use the resolver only as fallback when the typed intent did not already return `wallet_id`.

Exit criteria:

- Overlapping wallet names do not silently pick the first wallet.
- Short/common wallet names do not match broad prompts accidentally.
- Planner warnings distinguish ambiguous wallet references from invalid model output.

Focused verification:

- `npx vitest run tests/ai-proxy/consoleProtocol.test.ts`
- `npm --prefix ai-proxy run build`
- `npm run quality:lizard`
- `git diff --check`

## Phase 3: Shared Derivation Path Parser

Priority: high

Why now:

- This removes several prefix-based decisions from account/device logic before changing sync metadata.
- It can be implemented without a database migration.

Scope:

- `shared/utils/bitcoin.ts` or a new shared utility imported from there
- `services/hardwareWallet/pathUtils.ts`
- `server/src/services/deviceAccountConflicts.ts`
- `tests/services/hardwareWallet/pathUtils.test.ts`
- Relevant server wallet-import/device-account tests

Plan:

- Add a shared parser that returns structured data:
  - normalized path
  - purpose number
  - coin type
  - account index
  - optional script path component
  - optional change index
  - optional address index
  - inferred script type, or `unknown`
  - inferred account purpose, or `unknown`
- Support apostrophe and `h` hardened notation through the existing normalization helper.
- Replace separate script-type inference helpers with wrappers around the shared parser.
- Stop silently defaulting unknown purposes to native segwit in new account normalization.
- For legacy single-account payloads with unknown purpose, return a validation error that tells callers to use explicit `accounts[]` metadata.

Exit criteria:

- One parser owns derivation-path interpretation.
- Unknown or malformed path purposes do not silently become native segwit.
- Existing known path behavior remains unchanged for `m/44'`, `m/49'`, `m/84'`, `m/86'`, and `m/48'`.

Focused verification:

- `npx vitest run tests/services/hardwareWallet/pathUtils.test.ts`
- `npm --prefix server test -- --run tests/unit/services/walletImport.validation.test.ts`
- `npm run typecheck:tests`
- `npm run typecheck:server:tests`
- `npm run quality:lizard`
- `git diff --check`

## Phase 4: Address Chain and Index Metadata

Priority: medium-high

Why after Phase 3:

- Address sync should use the shared parser first. A database metadata change is easier after path parsing is centralized and tested.

Scope:

- `server/src/services/bitcoin/sync/addressDiscovery.ts`
- `server/src/services/bitcoin/sync/pipeline.ts`
- address repository/model migration if adding persistent metadata
- sync/address tests

Plan:

- Step 4A: Replace receive/change substring checks with parser-derived `change` and `index` values.
- Step 4B: Decide whether to persist `chain` metadata:
  - `chain: "receive" | "change"`
  - `index: number`
  - optional `accountPath`
- Keep derivation path as provenance/display, not as the primary behavioral source.
- If a path cannot be parsed, skip it for receive/change gap calculations and log a structured warning instead of misclassifying it.

Exit criteria:

- Sync code does not use `includes('/0/')`, `includes('/1/')`, or `split('/').pop()` for chain/index behavior.
- Malformed derivation paths are visible in logs/tests and do not affect gap-limit calculations incorrectly.
- Existing wallets continue to sync without migration-time data loss.

Focused verification:

- `npm --prefix server test -- --run tests/unit/services/bitcoin/sync/gapLimitPhase.test.ts tests/unit/services/bitcoin/sync/phases.test.ts`
- Add or extend direct `addressDiscovery` unit coverage if current tests only mock `ensureGapLimit`.
- `npm run typecheck:server:tests`
- `npm run quality:lizard`
- `git diff --check`

## Phase 5: Structured Error and Outcome Codes

Priority: medium

Why separate:

- This affects several boundaries and should be split by subsystem to avoid a large behavioral PR.

Scope:

- `src/api/console.ts`
- Console backend/proxy setup error responses
- `server/src/services/push/types.ts`
- `server/src/services/push/providers/*`
- `server/src/services/agentApiService.ts`
- `server/src/errors/errorHandler.ts`
- `server/src/utils/errors.ts`

Plan:

- Console setup errors:
  - add stable `reason` values such as `provider_not_configured` and `provider_config_sync_failed`;
  - have the UI read `response.reason` before falling back to legacy message matching.
- Push provider errors:
  - add `errorCode?: PushErrorCode` to `PushResult`;
  - normalize APNs/FCM raw reason strings inside provider adapters;
  - make token cleanup use `errorCode` first and legacy text matching only as fallback.
- Agent funding attempts:
  - pass stable reason codes from known domain errors instead of scanning message text first.
- Prisma:
  - create one mapping helper for `PrismaClientKnownRequestError`;
  - use it from both Express error middleware and utility response handlers.

Exit criteria:

- UI-facing Console setup classification no longer depends only on English message text.
- Push token cleanup primarily uses provider-normalized codes.
- Prisma P2002 target mapping exists in one place.
- Legacy message matching remains only as a compatibility fallback with tests.

Focused verification:

- `npx vitest run tests/api/console.test.ts tests/components/ConsoleDrawer.errors.test.tsx`
- `npm --prefix server test -- --run tests/unit/services/push/providers/base.test.ts tests/unit/services/push/providers/apns.test.ts tests/unit/services/push/providers/fcm.test.ts tests/unit/services/push/pushService.test.ts`
- relevant agent funding and error-handler tests after inspecting exact coverage
- `npm run typecheck:tests`
- `npm run typecheck:server:tests`
- `npm run quality:lizard`
- `git diff --check`

## Phase 6: Operational Explicit Contracts

Priority: medium-low

Why last:

- These are real brittleness improvements, but they are lower blast-radius than Console or wallet/account parsing.

Scope:

- `gateway/src/middleware/requestLogger.ts`
- `server/src/api/push.ts`
- `server/src/utils/docker/common.ts`
- gateway/server tests

Plan:

- Gateway audit outcome:
  - add explicit `outcome: "success" | "failure"` or `success: boolean` to gateway audit payloads;
  - preserve event-token inference only for legacy senders.
- Docker project discovery:
  - prefer Docker labels `com.docker.compose.project` and `com.docker.compose.service`;
  - fall back to current container-name parsing when labels are absent.

Exit criteria:

- New gateway audit events do not require event-name token matching to classify success/failure.
- Docker project discovery works when Compose labels are present and still works for older name-only responses.

Focused verification:

- `npm --prefix gateway test -- --run tests/unit/middleware/requestLogger.test.ts`
- `npm --prefix server test -- --run tests/unit/api/push.test.ts`
- add direct unit coverage for Docker label-based discovery
- `npm run typecheck:server:tests`
- `npm run quality:lizard`
- `git diff --check`

## Suggested PR Breakdown

1. Console typed intents and limit semantics.
2. Console wallet reference resolver and fallback simplification.
3. Shared derivation-path parser and hardware-wallet wrappers.
4. Backend device-account normalization using shared parser.
5. Address sync chain/index parser usage, then optional persisted chain metadata.
6. Console setup stable error reasons.
7. Push provider normalized error codes.
8. Prisma error mapper dedupe and agent funding reason-code cleanup.
9. Gateway audit explicit outcome and Docker label project discovery.

## Rollback Strategy

- Each PR should preserve legacy behavior behind compatibility fallbacks until the new typed path is verified.
- For Console changes, legacy `toolCalls` remain accepted while typed intents become preferred.
- For provider errors, new `errorCode` paths should be additive before message matching is removed or demoted.
- For address metadata, parser-only changes should land before any database migration.

## Definition Of Done

- No new natural-language regexes are added for Console planning.
- New typed contracts are documented through schemas and tests.
- Compatibility fallbacks are isolated and named as fallbacks.
- Ambiguous or unsupported inputs fail closed where wallet access, script type, or account ownership could be affected.
- Focused tests pass for each phase, followed by package typechecks and `npm run quality:lizard`.
