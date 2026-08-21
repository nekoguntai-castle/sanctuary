# Rationalization Plan

Date: 2026-06-04
Owner: Codex
Status: 2026-06-25 rationalize-loop pass; Phase AA vault policy request-schema convergence closed in PR #517, Phase AB draft request-schema/OpenAPI parity closed in PR #519 (`a0274878`), Phase AC batch transaction request-schema/OpenAPI parity closed in PR #522 (`0331fba0`). Phase AD (listTransactions type-filter value-contract convergence) selected for this loop — see the dated "Phase AD" section at the end of this file.
Scope: repo-wide divergence scrub focused on auth, Bitcoin network identity, transaction broadcast naming, LLM provider management, preference patch semantics, later contract/runtime drift follow-up queues, the wallet webhook contract refresh after PR #511, and the local pre-commit AI-agent gate

## Executive Summary

- Phases 1-6 are merged. The scrub converged the highest-risk auth session payload drift, frontend/shared auth type drift, canonical Bitcoin network values, ambiguous raw Bitcoin broadcast naming, unsupported Sanctuary-managed model installation/deletion, and nested preference patch/rollback drift.
- Sanctuary-managed model pull/delete/install/download surfaces are removed while the LLM egress proxy security boundary remains as an intentional isolation layer for provider egress, credentials, endpoint policy, and sanitized context access.
- Nested preference path reads, nested patch construction, and optimistic rollback now use shared helpers without replacing backend validation, backend canonical storage, or the current top-level preference patch contract.
- No non-hardware rationalization phase remains in the original six-phase queue. The physical hardware test remains a separate manual/external validation item.
- A fresh 2026-05-14 reanalysis did not reopen those merged phases, but it found a new follow-up queue: wallet role/capability contracts, Bitcoin script and wallet/account type identity, node/Electrum config projection, stale contract-test helper constants, and login health probing were the consolidation candidates worth addressing next. Subsequent 2026-05-15 independent reviews confirmed that order, and Phases A, B, B2, C, D, and E have since merged.
- The post-Phase-E optional queue through Phase I also merged: feature flag env bindings, actionable draft status reuse, AI provider type parity across the proxy boundary, and transaction type boundary naming are closed.
- Current review status: no completed phase is reopened, and the physical hardware test remains the only deferred external validation item. The post-Phase-I queue is merged through Phase T: sync priority validation closed in PR #474, mempool estimator defaults closed in PR #475, gateway deploy/runtime contracts closed in PR #476, transfer route validation closed in PR #477, UTXO selection route validation closed in PR #478, websocket protocol ownership closed in PR #479, frontend API hygiene closed in PR #480, UTXO selection strategy ownership closed in PR #481, shared value-contract cleanup closed in PR #482, server LLM egress config accessor cleanup closed in PR #483, ConnectDevice connection-method ownership closed in PR #484, frontend API base URL export cleanup closed in PR #485, Payjoin attempt validation closed in PR #488, admin monitoring validation closed in PR #489, and hardware/export wallet-model mapping closed in PR #490. PR #491 recorded the closeout. The remaining divergences are watch-only, as-touched cleanup, or intentionally split.
- 2026-05-22 implementation loop: Phases V-Z are implemented locally. Wallet-create multisig quorum values now parse at the route boundary, actionable draft statuses and webhook built-in values have shared owners, the same-scope transaction privacy `utxoIds` route boundary was tightened, and the pre-commit AI-agent gate now has one Claude invocation helper plus deterministic malformed-output smoke coverage.
- The wallet webhook framework is intentionally generic. Sanctuary should keep support for mapped JSON bodies, configured HMAC headers, and optional valuation enrichment, but no private receiver field names, URL shapes, or business contract vocabulary should become a built-in profile, default, test fixture, or project doc.
- Webhook built-in event/profile/auth/valuation values now derive from shared constants while the public API remains extensible as strings and endpoint JSON configs stay open for future profiles and deployment-local private mappings.
- The pre-commit AI-agent gate keeps one strict parser/verdict owner in `server/.husky/pre-commit`. Local hardening closes malformed cache poisoning and transient malformed output without weakening the fail-closed `UNKNOWN` gate; Phase Z also converged the duplicated Claude invocation branch and added shell smoke coverage.
- 2026-06-04 first-pass selection: Phase AA closed the route/admin/wallet vault policy request-schema drift by making a shared route-schema owner for policy create/update requests, keeping service validation as the final invariant owner, and tightening OpenAPI/request tests.
- Draft status drift was not selected because status ownership is already converged: current source imports `ACTIONABLE_DRAFT_STATUS_VALUES` from `shared/constants/drafts.ts` in `server/src/api/drafts.ts`, mobile request schemas, repositories, and services; `broadcasted` remains a deliberately separate lifecycle state. The separate draft request-schema/OpenAPI drift item was deferred from PR #517 and is now selected as Phase AB.
- Phase AA closed in PR #517 as squash merge `8068d6962178793f13ffe445249268b2e8f2492f`: wallet/admin policy routes share request schemas, malformed legacy admin configs reject before service dispatch, `description: null` compatibility is preserved, request OpenAPI config docs are bounded while persisted `VaultPolicy.config` responses remain open JSON, and `vaultPolicyService` stays the final invariant owner for direct service callers.
- Phase AB closed in PR #519 as squash merge `a0274878`: draft create/update routes import shared `draftRequests.ts` schemas, mobile update schema reuses the nullable metadata owner, OpenAPI docs `UpdateDraftRequest.label`/`memo` as nullable strings and nested amount fields as number-or-string, and frontend `src/api/drafts.ts` request/response types align with the server wire shape.
- 2026-06-06 first-pass selection: Phase AC closes the wallet batch transaction route-schema drift. `server/src/api/transactions/drafting.ts` defines `BatchTransactionRequestSchema`/`BatchTransactionOutputSchema` with `.passthrough()` and all-optional fields and manually re-validates outputs in helper functions, while `server/src/api/openapi/schemas/transactions.ts` `TransactionBatchRequest`/`TransactionBatchOutput` document `additionalProperties: false`, required `outputs` and `feeRate`, `outputs` `minItems: 1`, and required `address` per output, and the frontend `CreateBatchTransactionRequest`/`BatchTransactionOutput` types in `src/api/transactions/types.ts` already match the strict shape.

## Closed Loop Selection - Phase AA Vault Policy Request Schemas

Source plan: `docs/plans/rationalization-plan.md`
Date: 2026-06-04
Commit: `dd9ae950`
Scope: repo-wide rationalize-loop, narrowed to highest-evidence active contract drift.

### Selected Finding

| Area | Evidence | Disposition |
| --- | --- | --- |
| Admin/wallet vault policy request schemas | `server/src/api/wallets/policies.ts:60-206` owns strict type-specific config schemas; `server/src/api/admin/policies.ts:19-46` accepts any object config; `server/src/api/openapi/schemas/wallet.ts:708-732` documents create/update policy config as an open object. | Converge |

### Canonical Path Decision

| Area | Canonical Path | Paths To Retire Or Wrap | Compatibility Policy | Decision Needed |
| --- | --- | --- | --- | --- |
| Vault policy create/update request validation | A shared server API schema module for policy request fields and policy config schemas, imported by both wallet and admin policy routes. `vaultPolicyService` remains the final invariant owner for stored/existing policy type checks. | Route-local policy type/enforcement/config schema definitions in wallet/admin routes; OpenAPI open-object request config docs. | Preserve existing valid wallet and admin payloads, including admin `description: null` clear semantics. Reject malformed policy configs at the route boundary before service dispatch. PATCH `config` remains type-independent at the route layer and is rechecked against the existing policy type by the service. | None |

### Objective

Reduce drift risk between system-wide admin policy creation/update and wallet-scoped policy creation/update by sharing the same request schema owner and making OpenAPI document the accepted policy config shapes.

### Non-Goals

- Do not change policy evaluation behavior, storage schema, or policy inheritance.
- Do not remove `vaultPolicyService` validation; it still protects persisted/existing policy invariants and PATCH config/type compatibility.
- Do not remove either route family. Wallet routes remain wallet-scoped owner operations; admin routes remain system-policy admin operations with the existing non-system rejection checks.
- Do not introduce generated clients or a broad policy abstraction beyond route/OpenAPI request schemas.
- Do not change draft transaction status contracts in this PR.

### Paths To Keep, Wrap, Converge, Or Remove

| Action | Paths |
| --- | --- |
| Keep | `server/src/services/vaultPolicy/vaultPolicyService.ts` as final policy invariant and persistence validation owner. |
| Converge | Policy create/update request schemas used by `server/src/api/wallets/policies.ts` and `server/src/api/admin/policies.ts`. |
| Converge | OpenAPI `CreateVaultPolicyRequest` and `UpdateVaultPolicyRequest` config documentation away from unconstrained `additionalProperties: true`. |
| Remove | Route-local duplicate policy type/enforcement/config schema declarations after shared schema import. |

### Compatibility, Migration, And Backout

- Compatibility is request-compatible for valid clients. Invalid admin configs that previously reached service validation should now fail earlier with a validation response and should not call `vaultPolicyService`.
- Legacy-looking admin configs such as `{ maxAmount, window }` for `spending_limit` are treated as invalid contract drift and should be rejected at the route boundary.
- Admin `description: null` must remain valid so clients can clear descriptions; route code may widen wallet route acceptance of `null` if the shared schema makes that the canonical request shape.
- No data migration is required. Existing stored policies are still validated by service code when updated or evaluated.
- Backout is a single-PR revert because no migration or persistent format change is introduced.

### Implementation Phases

| Phase | Work | Files / Owners | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| AA.1 | Extract shared policy request/config schemas and imports | `server/src/api/schemas/vaultPolicy.ts`, `server/src/api/wallets/policies.ts`, `server/src/api/admin/policies.ts`, `server/src/services/vaultPolicy/types.ts` if null description typing needs to match behavior | Focused admin/wallet policy route tests | Both routes use the same create/update schema exports; route-local duplicate config schemas are gone. |
| AA.2 | Tighten OpenAPI policy request config docs | `server/src/api/openapi/schemas/wallet.ts`, OpenAPI contract tests | OpenAPI wallet/admin policy tests | Create/update policy requests no longer document policy config as an unconstrained open object; `VaultPolicy.config` response docs remain open JSON because persisted policies can be returned across source types. |
| AA.3 | Add drift and boundary tests | Admin policy route tests, wallet policy route tests, OpenAPI contract tests | Focused tests plus `git diff --check` and touched-file lizard if logic changed | Malformed admin config rejects before service dispatch; valid admin/wallet config still dispatches; null description compatibility is covered. |

## Current Loop Selection - Phase AC Batch Transaction Request Schemas

Source plan: `docs/plans/rationalization-plan.md`
Date: 2026-06-06
Commit: `7db313cf`
Scope: first autonomous rationalize-loop pass after PR #519 closeout.

### Selected Finding

| Area | Evidence | Disposition |
| --- | --- | --- |
| Wallet batch transaction create request schema, OpenAPI parity, and route-layer manual revalidation | `server/src/api/transactions/drafting.ts:31-44` declares `BatchTransactionOutputSchema` / `BatchTransactionRequestSchema` with `.passthrough()`, all-optional fields, and no `minItems` on `outputs`; `server/src/api/transactions/drafting.ts:50-92` re-implements address/amount/sendMax/`feeRate` validation in JS helpers and throws `ValidationError` after the schema accepts the body; `server/src/api/openapi/schemas/transactions.ts:275-301` documents `TransactionBatchOutput`/`TransactionBatchRequest` with `additionalProperties: false`, required `outputs`/`feeRate`, `outputs.minItems: 1`, required output `address`, and output `amount.minimum: 1`; `src/api/transactions/types.ts:184-197` exposes the strict `BatchTransactionOutput`/`CreateBatchTransactionRequest` types to frontend callers; `shared/schemas/mobileApiRequests.ts` owns single-recipient `MobileTransactionCreateRequestSchema` / `MobilePsbtCreateRequestSchema` but has no batch counterpart. | Converge |

### Canonical Path Decision

| Area | Canonical Path | Paths To Retire Or Wrap | Compatibility Policy | Decision Needed |
| --- | --- | --- | --- | --- |
| Batch transaction create request validation | A shared route-schema owner for `TransactionBatchOutput`/`TransactionBatchRequest` parsed at the route boundary using the same vocabulary (`MOBILE_API_REQUEST_LIMITS.minFeeRate`, positive non-zero integer `amount`, required `address`, optional `sendMax`, exactly-one `sendMax` flag, optional `selectedUtxoIds`, `enableRBF`, `label`, `memo`) before the wallet network address check runs. Bitcoin address validation against the wallet network and policy evaluation remain in the route since they need wallet state. | Route-local `BatchTransactionRequestSchema`/`BatchTransactionOutputSchema` with `.passthrough()` and all-optional fields; route-local helpers that throw `ValidationError` for missing `address`, missing `amount`, `feeRate < MIN_FEE_RATE`, or multi-`sendMax` (the route schema should own these so OpenAPI documents the contract); the `feeRate < MIN_FEE_RATE` check should align with `MOBILE_API_REQUEST_LIMITS.minFeeRate` already documented in OpenAPI. | Preserve valid current batch requests, including numeric `amount`, numeric `feeRate`, optional `selectedUtxoIds`, `enableRBF`, `label`, and `memo`. Continue to require Bitcoin address validation against the wallet network at the route after the boundary schema accepts the body. Reject malformed bodies, extras, non-positive `amount` outputs without `sendMax`, multi-`sendMax`, empty `outputs`, and `feeRate` below the documented minimum at the route boundary, returning a 400. | None |

### Objective

Reduce drift between server batch-transaction route validation, OpenAPI batch request docs, and frontend batch request types by sharing one strict request schema owner with the documented wire shape, and folding route-local manual revalidation into the schema where it does not depend on wallet state.

### Non-Goals

- Do not change batch transaction PSBT generation, policy evaluation order, change address handling, or response shape.
- Do not change the single-recipient `MobileTransactionCreateRequestSchema` / `MobilePsbtCreateRequestSchema` contracts; this phase only converges the batch create surface.
- Do not collapse raw `/bitcoin/transaction/batch` (frontend `src/api/bitcoin.ts` `BatchTransactionRequest`) with the wallet-scoped `/wallets/:walletId/transactions/batch` route. They remain intentionally distinct operations.
- Do not move Bitcoin address validation out of the route. Address validation depends on wallet network and remains a route concern.
- Do not broaden compatibility to accept `additionalProperties` on batch requests after this phase.

### Paths To Keep, Wrap, Converge, Or Remove

| Action | Paths |
| --- | --- |
| Keep | `server/src/services/bitcoin/transactionService.ts` `createBatchTransaction` as the behavior owner for batch PSBT generation. |
| Keep | `validateAddress` and wallet-network resolution in the route, because they depend on wallet state. |
| Converge | Batch transaction create request schema definition into a shared schema module (e.g. `shared/schemas/mobileApiRequests.ts` or a new `shared/schemas/batchTransactionRequests.ts`) so the same schema drives route validation and OpenAPI contract tests. |
| Converge | Route-layer manual `outputs` validation that doesn't depend on wallet state into the boundary schema (`address` required, `amount` positive integer or `sendMax: true`, exactly-one `sendMax` across the batch). |
| Remove | `.passthrough()` and all-optional fields on `BatchTransactionRequestSchema`/`BatchTransactionOutputSchema` after the shared schema is adopted. |

### Compatibility, Migration, And Backout

- Compatibility is request-compatible for valid clients. Existing batch requests with at least one `address`+`amount` output, valid `feeRate`, and optional `selectedUtxoIds`/`enableRBF`/`label`/`memo` continue to succeed.
- Invalid bodies that previously reached the route helpers (missing address, missing amount, multi-`sendMax`, sub-minimum `feeRate`, extras) now reject at the boundary with a 400 instead of a route-thrown `ValidationError`. Error messages should preserve the current phrasing for the most common cases (`outputs array is required with at least one output`, `Only one output can have sendMax enabled`, `Output N: address is required`, `Output N: amount is required (or set sendMax: true)`, `feeRate must be at least 0.1 sat/vB`) so existing client error parsing keeps working. Phrasing must be set via Zod custom messages (`.min(1, { message: ... })`, `.refine(..., { message: ... })`, `superRefine` for the multi-`sendMax` check and per-index output messages) because `parseTransactionRequestBody` formats Zod issues as `${path}: ${message}` and the existing `transactionsHttpRoutes.creation.contracts.ts` assertions use `toContain(...)` on the substrings above.
- `MIN_FEE_RATE` in `server/src/constants.ts` and `MOBILE_API_REQUEST_LIMITS.minFeeRate` in `shared/schemas/mobileApiRequests.ts` are both `0.1` today; the convergence keeps them in sync by sourcing the boundary schema's minimum from `MOBILE_API_REQUEST_LIMITS.minFeeRate` and dropping the route's separate `MIN_FEE_RATE` check (or aliasing `MIN_FEE_RATE` to the shared constant so single-recipient code paths keep importing the same value).
- The OpenAPI `TransactionBatchRequest`/`TransactionBatchOutput` schemas already document the strict shape, so OpenAPI does not need broadening.
- No data migration is required. The change only moves request schema ownership and tightens the route boundary.
- Backout is a single-PR revert.

### Implementation Phases

| Phase | Work | Files / Owners | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| AC.1 | Add shared batch transaction request schema with strict output and request shapes (required `address`, positive integer `amount` when `sendMax` is false/absent, optional `sendMax`, `outputs.min(1)`, `feeRate.min(MOBILE_API_REQUEST_LIMITS.minFeeRate)`, optional `selectedUtxoIds`/`enableRBF`/`label`/`memo`, exactly-one `sendMax`). | `shared/schemas/mobileApiRequests.ts` (or new `shared/schemas/batchTransactionRequests.ts`), `server/src/api/transactions/drafting.ts`, `server/src/api/transactions/requestValidation.ts` if error mapping needs adjustment | Shared schema unit tests, focused batch route tests | Shared schema accepts valid current batch payloads, rejects empty outputs, missing address, non-positive amount without `sendMax`, multi-`sendMax`, sub-minimum `feeRate`, and extras. |
| AC.2 | Replace route-local `BatchTransactionRequestSchema`/`BatchTransactionOutputSchema` and remove route-local `validateBatchOutputs`/`validateBatchOutput` JS helpers in favor of the boundary schema; keep wallet-network address check in the route. | `server/src/api/transactions/drafting.ts` | Focused batch route tests (`server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts.ts`), OpenAPI contract tests (`server/tests/unit/api/openapi.wallet.contracts.ts`) | Route handler reads a strictly typed body, route file no longer carries `.passthrough()` for batch, no helper throws for shape errors the schema already catches. |
| AC.3 | Add drift/boundary coverage: malformed bodies, extras, empty outputs, missing address, non-positive amount, multi-`sendMax`, sub-minimum `feeRate`, and a positive case that exercises every documented field. Verify OpenAPI contract test for `TransactionBatchRequest` still matches the shared schema (snapshot or derived) and the frontend `CreateBatchTransactionRequest`/`BatchTransactionOutput` types compile against the shared schema's TypeScript shape. | Batch route tests, OpenAPI contract tests, shared schema tests, optional frontend typecheck | Focused tests plus `npx tsc --noEmit` and `git diff --check` | New tests cover each boundary; OpenAPI parity test passes; no production caller depends on the removed `.passthrough()` behavior. |

### Acceptance Criteria

- `server/src/api/transactions/drafting.ts` imports a shared batch transaction request schema and no longer defines `.passthrough()` or all-optional request shapes for `/wallets/:walletId/transactions/batch`.
- The route-local `validateBatchOutputs`/`validateBatchOutput` helpers are removed or reduced to a single Bitcoin-address-against-wallet-network check that only runs after the boundary schema accepts the body.
- Boundary schema rejects empty `outputs`, missing `address`, non-positive `amount` without `sendMax`, multiple `sendMax: true` outputs, sub-minimum `feeRate`, and unknown extras at request parse time.
- OpenAPI `TransactionBatchRequest`/`TransactionBatchOutput` continue to document `additionalProperties: false`, `outputs.minItems: 1`, required `address`, and required `outputs`/`feeRate`; contract tests pass.
- Frontend `CreateBatchTransactionRequest`/`BatchTransactionOutput` types in `src/api/transactions/types.ts` remain assignable to / compatible with the shared schema's inferred type.
- Existing happy-path batch route tests pass without modification; new error-path tests preserve current error-message phrasing for the common cases.
- Focused server, shared, and OpenAPI tests pass; `npx tsc --noEmit` in `server/` and root passes; `git diff --check` passes.

### Edge Cases

- An output with `sendMax: true` has no `amount` requirement; without `sendMax`, `amount` is a positive integer (`> 0`).
- Exactly one output can have `sendMax: true`; zero is also valid.
- `feeRate` must meet the documented `MOBILE_API_REQUEST_LIMITS.minFeeRate`. The route's current `MIN_FEE_RATE` constant and `MOBILE_API_REQUEST_LIMITS.minFeeRate` are both `0.1` today, so this is a no-op reconciliation; the boundary schema simply consumes the shared constant so future changes stay in one place.
- `selectedUtxoIds`, `enableRBF`, `label`, and `memo` remain optional and unchanged in semantics.
- Bitcoin address-against-wallet-network validation continues to happen in the route after schema acceptance because it needs the wallet record.
- Raw `/bitcoin/transaction/batch` (frontend `src/api/bitcoin.ts` `BatchTransactionRequest`) and the wallet-scoped `/wallets/:walletId/transactions/batch` route are intentionally different operations and are not merged.
- The `BatchTransactionResponse` shape is unchanged; only the request boundary is converged.
- Policy evaluation order (vault policies before PSBT creation) is unchanged.

### Deferred Or Rejected

- Single-recipient `/wallets/:walletId/transactions/create` and `/wallets/:walletId/psbt/create` already use `MobileTransactionCreateRequestSchema` / `MobilePsbtCreateRequestSchema`. No convergence is needed in those routes for this phase.
- `server/src/api/intelligence.ts` `walletContext: z.record(z.string(), z.unknown())` remains an intentional open AI-assistant extension surface.
- `server/src/api/auth/tokens.ts` `RefreshBodySchema.passthrough()` remains the intentional dual cookie/body refresh surface.
- `server/src/api/push.ts` `GatewayAuditBodySchema.passthrough()` remains the documented adapter telemetry boundary.
- `server/src/api/wallets/import.ts` descriptor/json/data `z.unknown()` fields remain the documented importer adapter boundary.
- `server/src/api/admin/nodeConfig.ts` `servers: z.unknown().optional()` remains the documented admin compatibility boundary.
- `server/src/api/schemas/admin.ts` `SystemSettingsUpdateSchema` / backup `meta`+`data` remain documented admin extension/backup compatibility boundaries.
- Frontend `src/api/price.ts`, `src/api/sync.ts`, `src/api/bitcoin.ts` interface duplication remains a documented "Watch; converge opportunistically" item and is not selected for this phase.

### Verification Notes

- Verification pending implementation. Plan to run, at minimum: `cd server && npm run test:run -- tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts.ts tests/unit/api/openapi.wallet.contracts.ts tests/unit/api/transactions/transactions.mutations.contracts.ts`, root `npm test -- tests/shared/<new batch schema test path>` for the shared schema unit tests, `cd server && npm run typecheck:tests`, `cd server && npm run build`, root `npm run quality:lizard` (the script lives in the root `package.json` and runs `bash scripts/quality/lizard-only.sh`), and `git diff --check`.

## Post-Phase-AB Reanalysis - 2026-06-06

Scope: fresh scrub of current `main` at `7db313cf` after Phase AA (PR #517) and Phase AB (PR #519) merged. This addendum re-checks the deferred route-boundary loose-schema queue against the current source and selects the next single-PR convergence finding without reopening closed phases.

### Reanalysis Verdict

- Phases 1-6 and A-T plus V-Z, AA, AB remain closed. No active production code reopens the auth-session, wallet-role, wallet-identity, node-config-projection, contract-helper, login-health, feature-flag, draft-status, AI-provider, transaction-vocabulary, sync-priority, mempool-estimator, gateway-deploy, transfer-validation, UTXO-route, websocket-protocol, frontend-API-hygiene, UTXO-strategy, low-risk value, ConnectDevice, API base URL, Payjoin, admin monitoring, hardware/export, wallet-create-quorum, webhook-built-in, pre-commit-agent, vault-policy, or draft-request schema findings.
- The strongest remaining single-PR convergence finding is the wallet batch transaction request schema. Route validation is loose (`.passthrough()`, all-optional, JS helper throws), OpenAPI is strict (`additionalProperties: false`, required fields, `minItems`, output `amount.minimum`), and the frontend type in `src/api/transactions/types.ts` already matches the strict shape. This is the same drift pattern Phase M, M2, V, AA, and AB previously closed for adjacent routes.
- Other surviving loose route-boundary schemas in `server/src/api/**` are documented adapter/extension boundaries (wallet import descriptor/JSON, push gateway audit extras, admin system-settings/backup compatibility, admin `nodeConfig.servers`, intelligence wallet context, auth refresh dual-surface). They are explicitly deferred and should not be re-selected without domain-specific compatibility tests.

### Reanalysis Inventory

| Area | Evidence | Disposition |
| --- | --- | --- |
| Wallet batch transaction create request | `server/src/api/transactions/drafting.ts:31-44` `.passthrough()` / all-optional vs `server/src/api/openapi/schemas/transactions.ts:275-301` strict shape; `src/api/transactions/types.ts:184-197` strict frontend types. | Converge (selected Phase AC) |
| Raw `/bitcoin/transaction/batch` recipient schema | `server/src/api/bitcoin/transactions.ts:43-51` `BatchTransactionBodySchema` uses `.passthrough()` on each recipient. Same loose-extras pattern, but intentionally separate raw-bitcoin operation from the wallet-scoped route. | Keep separate (per Phase AC Non-Goals) |
| Single-recipient transaction create / PSBT create | `MobileTransactionCreateRequestSchema` / `MobilePsbtCreateRequestSchema` already own the boundary. | Closed (Phases A-T queue) |
| Wallet vault policy create/update request | Shared route schema owner adopted in Phase AA. | Closed (PR #517) |
| Draft create/update request | Shared `shared/schemas/draftRequests.ts` owner adopted in Phase AB. | Closed (PR #519) |
| Wallet import descriptor/json/data | `server/src/api/wallets/import.ts:21-40` `z.unknown().optional()` is the documented importer adapter boundary. | Keep separate |
| Push gateway audit body | `server/src/api/push.ts:60-63` `GatewayAuditBodySchema.passthrough()` is the documented adapter telemetry boundary. | Keep separate |
| Admin system settings / backup payloads | `server/src/api/schemas/admin.ts:134,153-156` `z.record(z.string(), z.unknown())` / `.passthrough()` are documented admin extension/backup compatibility boundaries. | Keep separate |
| Admin node config `servers` body | `server/src/api/admin/nodeConfig.ts:105` `servers: z.unknown().optional()` is the documented admin compatibility boundary. | Watch (per post-Phase-T) |
| Intelligence wallet context | `server/src/api/intelligence.ts:54` `walletContext: z.record(z.string(), z.unknown())` is the documented AI-assistant extension surface. | Keep separate |
| Auth refresh body | `server/src/api/auth/tokens.ts:31-37` `.passthrough()` supports the cookie+body dual-surface contract. | Keep separate |
| Wallet create positive safe integer parsing | `server/src/api/wallets/crud.ts:38` `z.unknown().transform` is the documented positive safe integer parser implementation detail, not an open unknown-forwarding route field. | Keep (per Phase V notes) |
| Wallet webhook `profileConfig`/`headerConfig` | `server/src/api/wallets/webhooks.ts:27` `JsonRecordSchema` is the documented generic webhook extension point. | Keep separate (per Phase X notes) |
| Frontend `src/api/price.ts`/`src/api/sync.ts`/`src/api/bitcoin.ts` response duplicates | Already documented as `Watch; converge opportunistically` in the Post-Phase-I inventory. | Watch |

### Recommended Follow-Up Order

| Phase | Work | Verification | Exit Criteria |
| --- | --- | --- | --- |
| AC | Centralize the wallet batch transaction create request schema; remove `.passthrough()` and route-local JS shape validation; preserve wallet-network address check and policy evaluation in the route. | Focused batch route tests, OpenAPI contract tests, shared schema tests, typechecks/build/`git diff --check`. | Selected for this loop; see "Current Loop Selection - Phase AC Batch Transaction Request Schemas" above. |
| AD (deferred) | Frontend API helper response-shape reuse from `shared/types/api.ts` for `src/api/price.ts`, `src/api/sync.ts`, `src/api/bitcoin.ts` where types already overlap. | Type-only tests, app/test typechecks, negative search for duplicated response interfaces. | Defer; not selected this loop because the documented Phase O finding called this "Watch; converge opportunistically" with no confirmed behavior drift. |

### Edge Cases

- Phase AC must keep raw `/bitcoin/transaction/batch` separate from wallet-scoped `/wallets/:walletId/transactions/batch`.
- Phase AC must keep policy evaluation between schema acceptance and PSBT creation; it must not run policy evaluation against a body that has not been validated.
- Phase AC must reconcile `MIN_FEE_RATE` and `MOBILE_API_REQUEST_LIMITS.minFeeRate` such that OpenAPI and shared schema agree; do not weaken either.
- Phase AC must preserve current error message phrasing for the common batch errors so external batch clients with custom error parsers keep working.

## Closed Loop Selection - Phase AB Draft Request Schemas

Source plan: `docs/plans/rationalization-plan.md`
Date: 2026-06-04
Closeout: 2026-06-06 (PR #519 merged as `a0274878`)
Commit: `8068d696`
Scope: second autonomous rationalize-loop pass after PR #517 closeout. Closed.

| Area | Evidence | Disposition |
| --- | --- | --- |
| Draft create/update request schema and OpenAPI parity | `server/src/api/drafts.ts` defines local create/update schemas that accept nullable `label`/`memo` and number-or-digit-string amount fields; `shared/schemas/mobileApiRequests.ts` exports mobile update schema with string-only metadata; `server/src/api/openapi/schemas/drafts.ts` documents `UpdateDraftRequest.label`/`memo` as non-null strings and nested draft output/input/decoy amounts as number-only; `src/api/drafts.ts` frontend draft request and response types also narrow server-compatible string amounts and nullable metadata. | Converge |

### Canonical Path Decision

| Area | Canonical Path | Paths To Retire Or Wrap | Compatibility Policy | Decision Needed |
| --- | --- | --- | --- | --- |
| Draft create/update request validation | Shared draft request schemas in `shared/schemas/draftRequests.ts`, imported by server draft routes and reused by mobile request schemas where the wire contract is shared. | Route-local draft create/update Zod schemas in `server/src/api/drafts.ts`; mobile-only duplicate nullable metadata rules; OpenAPI request docs that understate accepted string amounts or nullable metadata. | Preserve existing valid server requests, including string-encoded non-negative integer amounts and `PATCH { label: null, memo: null }`. Keep mobile-agent funding draft signature/comment routes separate because they are a different review/signature workflow. | None |

### Objective

Reduce drift between server route validation, shared/mobile request validation, OpenAPI request docs, and frontend draft request types for draft transaction create/update payloads.

### Non-Goals

- Do not change draft transaction persistence, PSBT generation, signing, approval, locking, or broadcast behavior.
- Do not merge mobile agent funding draft review/signature schemas into wallet draft create/update schemas.
- Do not broaden general mobile transaction create/broadcast request compatibility beyond the existing draft-specific wire contract.
- Do not remove numeric-string compatibility for stored draft amount metadata.

### Compatibility, Migration, And Backout

- Compatibility is request-compatible for valid clients. Existing numeric request values remain valid; existing string-encoded non-negative integer amount metadata remains valid.
- `PATCH { label: null, memo: null }` remains valid and should be documented across shared/mobile/OpenAPI/frontend contracts.
- Invalid objects, arrays, negative values, decimals for integer amount fields, empty required strings, and unknown request fields remain rejected by strict route schemas.
- No data migration is required. Existing stored draft rows are unchanged; new string-encoded request amount metadata is normalized before persistence to preserve the existing numeric draft response shape.
- Backout is a single-PR revert because the change only moves request schema ownership and aligns types/docs/tests.

### Implementation Phases

| Phase | Work | Files / Owners | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| AB.1 | Extract shared draft request schemas | `shared/schemas/draftRequests.ts`, `server/src/api/drafts.ts`, `shared/schemas/mobileApiRequests.ts` | Shared schema tests, focused draft route tests, mobile schema tests | Server draft routes import shared create/update schemas; mobile draft update schema accepts the same nullable metadata contract. |
| AB.2 | Align public docs and frontend request types | `server/src/api/openapi/schemas/drafts.ts`, `server/tests/unit/api/openapi.gateway.contracts.ts`, `src/api/drafts.ts`, frontend API tests | OpenAPI contract tests and frontend API type/test coverage | OpenAPI documents nullable update metadata and number-or-string nested amount fields; frontend request types match the accepted server wire shape. |
| AB.3 | Add drift/boundary coverage | Draft route tests and shared/mobile schema tests | Focused route/shared/frontend tests plus typechecks | `PATCH { label: null, memo: null }`, nested numeric-string create amounts, invalid amount objects, and stale non-null docs are covered. |

### Acceptance Criteria

- `server/src/api/drafts.ts` imports shared create/update draft request schemas instead of defining route-local create/update schemas.
- `shared/schemas/mobileApiRequests.ts` reuses the shared nullable draft metadata contract for `MobileDraftUpdateRequestSchema`.
- Route tests prove `PATCH { label: null, memo: null }` succeeds and malformed non-string/non-null metadata rejects.
- Route tests prove nested `outputs`, `inputs`, and `decoyOutputs` accept string-encoded non-negative integer amounts and reject invalid amount objects.
- OpenAPI `CreateDraftRequest` and its output/input/decoy request components document number-or-string amount fields where the route accepts them.
- OpenAPI `UpdateDraftRequest.label` and `UpdateDraftRequest.memo` document nullable strings.
- Frontend draft API request types accept server-compatible string amount values and nullable metadata; response metadata types allow `null`.
- Focused shared, server, frontend, and OpenAPI tests pass, followed by typechecks/builds proportional to the shared contract change.

### Edge Cases

- Draft integer amount fields accept non-negative integer numbers or digit-only strings, matching the current route contract.
- Draft fee rate accepts positive finite numbers or positive numeric strings, including decimal strings.
- Empty strings remain invalid for required string fields such as `recipient`, `psbtBase64`, `signedPsbtBase64`, `signedDeviceId`, and `inputPaths` entries.
- `label` and `memo` accept strings or `null` when present; omission remains a no-op.
- Arrays and objects remain invalid for numeric draft amount fields and metadata fields.
- Mobile agent funding draft comment/signature payloads stay separate from wallet draft update payloads.

### Deferred Or Rejected

- Draft transaction status convergence is already converged/watch: `shared/constants/drafts.ts` owns actionable statuses, and `broadcasted` is intentionally lifecycle-only.
- Draft create/update request-schema convergence is selected for Phase AB. This pass does not change draft statuses, broadcast lifecycle values, mobile agent funding draft review payloads, or transaction create/broadcast mobile schemas beyond reusing the nullable metadata owner where the existing mobile draft update contract already overlaps.
- Physical hardware signing evidence remains outside this loop because it requires devices.
- Moderate/low dependency advisory triage is not contract convergence.
- LLM egress proxy utilities remain intentionally separate because proxy isolation is a security boundary.
- Electrum singleton compatibility remains watch-only and documented.

### Verification Notes

- `cd server && npm run test:run -- tests/unit/services/vaultPolicyService.test.ts tests/unit/api/admin-policies-routes.test.ts tests/unit/api/wallets-policies-routes.test.ts tests/unit/api/openapi.test.ts` passed with 217 tests.
- `cd server && npm run typecheck:tests` passed.
- `cd server && npm run build` passed.
- `npm run quality:lizard` passed.
- `git diff --check` passed.

## Divergence Inventory

| Area | Paths | Current Behavior | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| Auth session success responses | Register, password login, 2FA verify | Previously issued sessions and shaped user payloads in multiple route-local paths | Phase 1 review in `tasks/todo.md`; PR #455 merged | Converged |
| Frontend auth API types | `src/api/auth.ts`, `src/api/twoFactor.ts`, `shared/types/api.ts` | Frontend duplicated shared/server response contracts | Phase 2 review in `tasks/todo.md`; PR #456 merged | Converged |
| Bitcoin network identity | Shared constants, server helpers, frontend tabs, OpenAPI, Electrum modules | Multiple tuples/unions encoded overlapping network values and legacy `testnet` normalization | Phase 3 review in `tasks/todo.md`; PR #457 merged | Converged with narrow aliases kept |
| Transaction broadcast names | `src/api/bitcoin.ts` raw broadcast vs `src/api/transactions` wallet broadcast | Different operations shared the same frontend helper name | Phase 4 review in `tasks/todo.md`; PR #458 merged | Converged by renaming raw helper |
| LLM provider model management | Frontend AI Settings, backend `/ai/pull-model` and `/ai/delete-model`, proxy `/pull-model` and `/delete-model`, websocket pull progress | Product policy is external LLMs only; Sanctuary should not install/delete provider models | Phase 5 PR #459 merged as `42abe4d893420661482e73ddbd9a1f4aff271bd2` | Removed unsupported surface |
| LLM egress isolation | Backend service, proxy routes, endpoint policy, provider credentials, sanitized internal AI context | Proxy still provides security value even without model management | User clarification and existing proxy architecture | Keep separate as security boundary |
| Gateway route manifest vs validation map | `GATEWAY_ROUTE_CONTRACTS` and `ROUTE_SCHEMAS` | Manifest parity tests guard route exposure; schemas remain separate | Completed gateway manifest task in `tasks/todo.md` | Watch |
| Nested preference patches | `useUserPreference`, `UserContext`, list preference hooks, notification sounds, server feature settings | Dot-path reads, nested patch construction, full-snapshot sends, and optimistic rollback behavior were recreated at several call sites | PR #460 merged as `26bbd2d052afe1e22421107dea77b6597e873f4c`; `utils/preferencePaths.ts`; focused preference tests | Converged |
| Wallet policy route schemas | `server/src/api/wallets/policies.ts`, vault policy service types, wallet OpenAPI schemas | Current route uses strict discriminated policy config schemas for `spending_limit`, `approval_required`, `time_delay`, `address_control`, and `velocity`; service remains behavior owner | Source read during 2026-05-22 refresh; prior grade watch item no longer matches the current route shape | Converged; keep narrow as-touched watch for shared policy value constants |
| Draft status contract ownership | `shared/constants/drafts.ts`, `server/src/api/drafts.ts`, `server/src/repositories/draftRepository.ts`, `shared/schemas/mobileApiRequests.ts`, `shared/types/domain.ts` | Actionable draft statuses derive from shared constants for route, repository, mobile, shared domain, and OpenAPI contracts; `broadcasted` remains separate lifecycle state | Phase W local implementation and shared/server focused tests on 2026-05-22 | Converged locally; pending PR delivery |
| Wallet create multisig quorum validation | `server/src/api/wallets/crud.ts`, wallet creation service, create-wallet tests/OpenAPI | Route parses positive safe integer `quorum`/`totalSigners`, accepts numeric strings for compatibility, drops irrelevant single-sig quorum fields, and rejects malformed values before service dispatch | Phase V local implementation and create-wallet/OpenAPI tests on 2026-05-22 | Converged locally; pending PR delivery |
| Transaction privacy spend analysis inputs | `server/src/api/transactions/privacy.ts`, transaction privacy route tests, transaction privacy OpenAPI | Route now requires `utxoIds` to be a non-empty string array, matching the existing OpenAPI shape instead of accepting unknown entries | Phase Y local review and transaction privacy route tests on 2026-05-22 | Converged locally; pending PR delivery |
| Wallet webhook built-in vocabulary | `shared/constants/webhooks.ts`, `server/src/services/webhooks/types.ts`, `components/WalletDetail/webhooks/model.ts`, wallet webhook form/tests | Backend and form derive built-in event/profile/auth/valuation IDs from shared constants; public UI/API types stay open strings for extensibility | Phase X local implementation, shared constant tests, UI model tests, and server webhook parity tests on 2026-05-22 | Converged locally for built-ins; private/custom configs remain generic |
| Webhook payload/header configuration | `server/src/api/wallets/webhooks.ts`, webhook payload profiles, webhook signers, wallet settings advanced JSON | Generic JSON config is intentionally open so private receiver contracts can be configured without becoming Sanctuary-owned code | Webhook expectation clarification and current `JsonRecordSchema`/mapped JSON/configured HMAC implementation | Keep separate with safety validation at profile/signer boundaries |
| Pre-commit AI-agent output handling | `server/.husky/pre-commit`, local `.claude/agent-cache`, local `.claude/agent-audit.jsonl`, `tests/ci/pre-commit-agent-gate.test.sh` | Parser/verdict derivation is single-owner in the hook; local cache/audit state is gitignored; malformed cache hits rerun, fresh malformed output retries once, `UNKNOWN` output remains uncached and fail-closed, and a stubbed smoke test covers those paths | Current diff; targeted `rg` found the parser, verdict, cache, log, and Claude invocation paths only in `server/.husky/pre-commit`; `.gitignore` excludes `.claude/`; Phase Z smoke test is wired into quality CI | Converged locally; pending PR delivery |

## Canonical Path Decisions

| Area | Canonical Path | Paths To Retire Or Wrap | Compatibility Policy | Decision Needed |
| --- | --- | --- | --- | --- |
| Auth success session | Shared server session response helper | Route-local cookie/user response shaping | Preserve cookie-only JSON contract and existing failure ordering | None |
| Auth frontend contracts | Shared auth request/response/user types | Frontend-local duplicate interfaces | Preserve pending-verification and 2FA-required discriminants | None |
| Bitcoin network values | `@sanctuary/shared/constants/bitcoin` | Local full-network tuples and ad hoc legacy normalization | Keep narrower UI/sync/mempool subsets as derived aliases | None |
| Raw Bitcoin broadcast helper | `bitcoinApi.broadcastRawNetworkTransaction` | `bitcoinApi.broadcastTransaction` raw helper alias | No compatibility alias; backend route path remains `/bitcoin/broadcast` | None |
| LLM provider models | Provider model listing and explicit selected model string | Pull/delete routes, model-download websocket, popular download lists, system resource readiness checks | Preserve existing saved selected model strings and external Ollama provider support | None |
| LLM proxy security | `llm-egress-proxy` as egress isolation layer | Any naming/copy implying model hosting or local runtime ownership | Keep allowlists, CIDR policy, provider credentials, proxy secret auth, sanitized context routes | None |
| Preference patches | Shared helper for nested path reads, nested patch construction, and request-generation-aware rollback | Call-site-specific dot-path helpers, nested object rebuilding, and blind full-state rollback | Backend schemas/canonicalization remain source of truth; backend patch endpoint remains top-level merge unless a later phase adds a nested patch contract | None |
| Payjoin attempt route contract | Strict JSON route schema matching OpenAPI and `attemptPayjoinSend` string inputs | Retired `z.unknown()` presence/truthiness checks in `server/src/api/payjoin.ts` | Preserve authenticated `/payjoin/attempt` wire fields; preserve separate unauthenticated BIP78 text/plain receiver route; reject malformed values and extras at the route boundary | Closed in Phase R |
| Admin monitoring update contract | Typed closed route schemas plus service inputs for monitoring URL and Grafana updates | Retired `z.unknown()`, `.passthrough()`, `.catch({})`, and service-level truthiness handling for monitoring update routes | Blank, null, and omitted `customUrl` currently clear; malformed non-string/non-null values reject with 400; Grafana `anonymousAccess` must be boolean when present and omission is a no-op | Closed in Phase S |
| Hardware/export device model identity | One Sparrow/export mapping owner; local alias remains `ledger_gen_5` while Sparrow JSON emits `LEDGER_NANO_GEN5` | Retired duplicate export-route/helper maps and test-local mapping copies | Keep onboarding/signing/icon/add-account domains separate; target-format adapters own their wire values with tests | Closed in Phase T |
| Wallet create quorum values | Route-boundary parser/schema accepts the documented create-wallet wire shape and normalizes `quorum`/`totalSigners` before service dispatch; wallet service remains final invariant owner | Retired `z.unknown()` forwarding for create-wallet quorum values | Preserve valid current multisig requests; keep numeric-string compatibility; reject objects, arrays, nulls, zero, negative values, decimals, unsafe integers, and `quorum > totalSigners` at the route boundary | Closed in Phase V; pending PR delivery |
| Draft status constants | `shared/constants/drafts.ts` owns actionable draft statuses used by repository filters, draft/mobile route schemas, shared domain types, and OpenAPI schema generation | Retired duplicated actionable/mobile draft status tuples while retaining compatibility exports | Preserve public `unsigned`, `partial`, and `signed`; keep `broadcasted` as an explicit lifecycle/internal value rather than an actionable draft status | Closed in Phase W; pending PR delivery |
| Webhook built-in values | `shared/constants/webhooks.ts` owns Sanctuary built-in webhook event IDs, auth types, payload profiles, and valuation modes; endpoint-specific JSON remains generic | Retired form/backend duplicate literal unions where they mirror built-ins | Keep API/OpenAPI fields as strings so deployments can configure future/custom profiles without schema churn; never add private receiver values to the built-in set | Closed for built-ins in Phase X; future product decision only if the UI should fetch capabilities dynamically |
| Webhook private receiver support | `mapped_json_v1`, `configured_hmac_sha256`, endpoint-local config, and secret storage | Do not create receiver-specific payload profiles, tests, defaults, docs, or constants in the public repo | Private mapped keys/header names/URLs live in deployment config only; support packages and logs remain redacted | None |
| Pre-commit AI-agent gate | `server/.husky/pre-commit` owns `_parse_single_object`, `extract_json_object`, `derive_verdict_from_body`, `extract_verdict`, `invoke_claude_agent`, and `invoke_agent_with_cache` | Do not add parser copies, tracked `.claude` state, or a second gate path | Preserve fail-closed `UNKNOWN`; malformed cache hits rerun; fresh malformed output gets one strict retry, then blocks and remains uncached if still malformed | Closed in Phase Z; pending PR delivery |

## Convergence Plan

| Phase | Work | Files / Owners | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| 1 | Consolidate server auth session issuance and user response shaping | `server/src/api/auth/*` | Focused auth route tests, server typecheck/lint, lizard, `git diff --check` | Merged via PR #455 |
| 2 | Align frontend auth API types with shared contracts | `src/api/auth.ts`, `src/api/twoFactor.ts`, context mapping | App/test typechecks, focused auth/context tests, app lint | Merged via PR #456 |
| 3 | Consolidate Bitcoin network constants and normalization | `shared/constants/bitcoin.ts`, server/frontend/OpenAPI/Electrum consumers | Bitcoin boundary check, shared build, focused server/frontend tests, typechecks/lint | Merged via PR #457 |
| 4 | Rename raw Bitcoin broadcast helper | `src/api/bitcoin.ts`, API module tests | Negative search for old raw helper, focused API/send tests, typechecks/lint | Merged via PR #458 |
| 5 | Remove Sanctuary-managed model pull/delete/install/download capability while retaining LLM egress isolation | AI Settings, `src/api/ai.ts`, `server/src/api/ai/*`, `server/src/api/llm-egress-internal.ts`, OpenAPI, websocket model-download paths, proxy routes/tests | Negative source search, focused AI/proxy/websocket/OpenAPI tests, app/server typechecks, proxy build, route coverage, lizard, `git diff --check`, current-head PR checks | Merged via PR #459 |
| 6 | Centralize nested preference patch helpers and rollback semantics | `hooks/useUserPreference.ts`, `contexts/UserContext.tsx`, `utils/preferencePaths.ts`, wallet/device list preference hooks, Telegram/autopilot server settings | Focused preference tests for nested reads/patches, unsafe keys, arrays, scalar/object replacement, stale rollback, localStorage fallback, server feature sibling preservation; full frontend coverage; typechecks/lint/lizard | Merged via PR #460 |
| A | Centralize wallet role values and capability helpers | `shared/constants/walletRoles.ts`, wallet access/mobile permission/frontend wallet surfaces | Shared/server/frontend role and capability tests, negative wallet-gate searches | Merged via PR #462 |
| B | Centralize Bitcoin script type, wallet type, and device-account purpose values | `shared/constants/walletIdentity.ts`, wallet/device/import/OpenAPI/server consumers | Wallet identity parity tests, focused wallet/device/import/OpenAPI tests, negative production tuple searches | Merged via PR #463 |
| B2 | Repair stale external-LLM-only copy and provider-model naming | AI Settings, AI API types, active AI docs/OpenAPI copy | Focused AI Settings/API tests, typechecks, negative model-management copy searches | Merged via PR #464 |
| C | Centralize node/Electrum config projection semantics | `shared/constants/nodeConfig.ts`, network UI helpers, server node/Electrum/mempool adapters | Shared/frontend/server node config tests, negative projection searches | Merged via PR #465 |
| D | Repair stale contract-test validators and draft status drift | `server/tests/helpers/contractValidation.ts`, contract tests, mobile-agent draft route/OpenAPI schemas | Contract/OpenAPI/mobile-agent tests, stale-literal searches, server checks | Merged via PR #466 |
| E | Wrap login health lookup in a no-auth health API helper | `components/Login/useLoginFlow.ts`, `src/api/*`, login tests | Login health helper tests, base-URL tests, negative raw-health-fetch search | Merged via PR #467 |
| F (optional) | Centralize feature flag env bindings and coverage checks | `server/src/config/features.ts`, `server/tests/unit/config/features.test.ts`, feature flag definitions/service tests | Config feature tests, unknown-key/admin OpenAPI tests, negative search for missing env binding | Merged via PR #469 |
| G (optional) | Reuse actionable draft status constants in agent/dashboard paths | `server/src/repositories/draftRepository.ts`, `server/src/repositories/agentRepository.ts`, `server/src/repositories/agentDashboardRepository.ts`, related tests | Repository tests and negative literal searches for actionable draft status filters | Merged via PR #470 |
| H (optional) | Add AI provider type parity checks while preserving proxy isolation | `server/src/services/ai/providerProfile.ts`, `server/src/api/ai/models.ts`, `server/src/api/openapi/schemas/ai.ts`, `server/src/services/ai/types.ts`, `src/api/ai.ts`, `src/api/admin/types.ts`, `llm-egress-proxy/src/*` | AI/provider/proxy tests plus an explicit parity/isolation guard | Merged via PR #471 |
| I (optional) | Split public transaction values from persisted values and aliases | `shared/constants/transactions.ts`, `shared/types/domain.ts`, `server/src/api/openapi/schemas/transactions.ts`, transaction list/console/proxy filter helpers | Transaction route/API/console/proxy tests and alias boundary tests | Merged via PR #472 |
| J | Centralize sync priority validation and worker priority mapping | `shared/constants/sync.ts`, sync API/OpenAPI, sync queue/coordinator, worker job types, BullMQ mapping | Shared sync tests, sync route validation tests, OpenAPI parity, queue/worker priority tests, typechecks/lint/lizard | Merged via PR #474 |
| K | Centralize mempool estimator values and defaults | `shared/constants/nodeConfig.ts`, admin node config API/data, OpenAPI, frontend NodeConfig, runtime mempool config | Shared node-config tests, admin node config tests, mempool config tests, NodeConfig UI tests, OpenAPI parity, estimator negative searches | Merged via PR #475 |
| L | Repair gateway runtime/deploy contract drift | Gateway runtime config/env helpers, compose, gateway docs, release/offline/install inventory | Gateway config/push tests, compose service checks, offline/install tests, stale-string searches, type/build/lint/lizard | Merged via PR #476 |
| M | Align transfer route validation with transfer constants and OpenAPI | `server/src/api/transfers.ts`, transfer OpenAPI schemas/paths, transfer route tests | Transfer route/OpenAPI tests, server type/build/coverage/lint/lizard, stale validation searches | Merged via PR #477 |
| M2 | Validate UTXO selection route inputs against OpenAPI | `server/src/api/transactions/coinSelection.ts`, transaction OpenAPI schemas/paths, UTXO route tests | UTXO route/OpenAPI tests, server type/build/coverage/lint/lizard, stale validation searches | Merged via PR #478 |
| N | Centralize websocket protocol ownership | `shared/types/websocket.ts`, frontend websocket service/hooks, server websocket schemas/fanout/broadcasts, notification broadcasts | Shared/frontend/server websocket tests, coverage, type/build/lint/lizard, architecture check, stale protocol searches | Merged via PR #479 |
| O | Run a narrow frontend API hygiene pass | Payjoin API/send status names, selected frontend API query helpers, already-owned shared response types, low-level PSBT format helpers | Payjoin/API/PSBT tests, typechecks/lint/lizard, architecture check, stale name/query/helper searches | Merged via PR #480 |
| P | Centralize UTXO selection strategy values | `shared/constants/transactions.ts`, UTXO selection route/service/OpenAPI/frontend types, legacy transaction-builder selector | Shared/UTXO/OpenAPI/service/legacy selector tests, typechecks/lint/lizard, architecture check, stale tuple and `branch_and_bound` searches | Merged via PR #481 |
| Q1 | Centralize first low-risk shared value contracts | Admin agent values, device roles, RBF statuses, privacy grades, related OpenAPI/server/frontend contracts | Shared constants tests, OpenAPI parity, focused boundary tests, typechecks, negative production tuple/union searches | Merged via PR #482 |
| Q2 | Centralize server LLM egress config accessors | `server/src/config/*`, `server/src/services/ai/config.ts`, `server/src/services/ai/llmEgressProxyClient.ts`, focused AI/proxy tests | AI config sync/client tests, server config tests, type/build/lint/lizard, negative direct-env searches | Merged via PR #483 |
| Q3 | Centralize ConnectDevice connection-method values | `utils/deviceConnection.ts`, `components/ConnectDevice/types.ts`, focused ConnectDevice tests | Device connection utility tests, ConnectDevice selector tests, app/test typechecks, lint/lizard, negative duplicate-union searches | Merged via PR #484 |
| Q4 | Retire the exported frontend `API_BASE_URL` constant | `src/api/baseUrl.ts`, `src/api/client.ts`, API client tests/mocks | API base/client tests, app/test typechecks, lint/lizard, negative production export searches | Merged via PR #485 |
| R | Tighten Payjoin attempt route validation | `server/src/api/payjoin.ts`, payjoin OpenAPI schemas/paths, payjoin route tests | Payjoin route tests for valid attempts, missing/empty fields, invalid object/array/null types, invalid URL, invalid/legacy/omitted network, extra fields, and BIP78 receiver route isolation | Merged via PR #488 |
| S | Tighten admin monitoring update validation | `server/src/api/admin/monitoring.ts`, `server/src/services/adminMonitoringService.ts`, admin OpenAPI monitoring schemas/paths, route/service tests | Admin monitoring tests for serviceId enum, valid URL, blank/null/omitted clear, invalid customUrl types, extra fields, boolean Grafana updates, omitted Grafana no-op, and invalid Grafana types | Merged via PR #489 |
| T | Consolidate hardware/export device model mapping | `server/src/services/export/sparrowWalletModel.ts`, `server/src/services/export/handlers/sparrow.ts`, `server/src/api/wallets/export.ts`, export route/handler tests, hardware utility tests | Export handler tests for known aliases and `ledger_gen_5`, negative search for duplicate maps and test-local helper copies, touched-file lizard | Merged via PR #490 |
| U | As-touched low-priority cleanup bucket | Policy route schemas, draft status route schema, websocket confirmation broadcast, price fallback, node config server typing, broader hardware vendor normalization | Focused tests and negative searches for whichever domain is touched | Deferred/watch-only items shrink without broad churn or cross-domain merges |
| V | Tighten wallet-create multisig quorum parsing at the route boundary | `server/src/api/wallets/crud.ts`, create-wallet OpenAPI schema, wallet create route/service tests | Create-wallet route/OpenAPI tests for valid numeric values, numeric-string compatibility, single-sig field dropping, object/array/null, zero, negative, unsafe integer, and `quorum > totalSigners` | Implemented locally; pending PR delivery |
| W | Centralize actionable draft status constants | `shared/constants/drafts.ts`, draft repository, draft route schemas, mobile draft request schemas, shared domain types, draft OpenAPI schemas/tests | Shared constant tests, focused draft/mobile route tests, OpenAPI contract tests, negative search for duplicate production actionable tuples | Implemented locally; pending PR delivery |
| X | Add webhook built-in vocabulary parity without closing the generic config surface | `shared/constants/webhooks.ts`, webhook service types, wallet webhook UI model/form, webhook route/UI tests | Shared constant tests, UI model tests, server webhook parity tests, negative search proving no private receiver identifiers are tracked | Implemented locally for built-ins; custom/private endpoint configs remain deploy-time data |
| Y | Review remaining generic route-boundary schemas as touched | Admin policies, node config servers, transaction drafting/broadcast passthrough outputs, push payload extras, auth token extras, transaction privacy `utxoIds` | Transaction privacy route tests for non-empty string `utxoIds`; compatibility notes for intentionally loose adapter/extension payloads | Implemented locally; remaining loose schemas are documented adapter/extension boundaries |
| Z | Rationalize pre-commit agent runner/retry/cache helper and smoke coverage | `server/.husky/pre-commit`, `tests/ci/pre-commit-agent-gate.test.sh`, `.github/workflows/quality.yml` | `sh -n`, `bash -n`, direct library-mode guard check, `bash tests/ci/pre-commit-agent-gate.test.sh`, `bash tests/ci/check-workflow-composition.test.sh`, `node tests/ci/check-github-action-runtimes.test.mjs`, `git diff --check` | Implemented locally; the hook has one Claude invocation helper and a fast regression check for malformed-output recovery without weakening the fail-closed gate |

## Phase V-Y Rationalize Loop - 2026-05-22

Scope: post-implementation convergence review after Phases V-Y, focused on the wallet webhook work and adjacent route-boundary cleanup.

- No new same-scope converge phase remains after the local implementation. Wallet-create quorum parsing, actionable draft status ownership, webhook built-in vocabulary ownership, and transaction privacy `utxoIds` route typing are covered by focused tests.
- Remaining `z.unknown()` and `.passthrough()` matches in `server/src/api` are not equivalent drift in this scope: wallet import accepts heterogeneous descriptor/JSON payloads for importer adapters; wallet webhook `profileConfig`/`headerConfig` are the intended generic extension points; admin policy/settings/backup, node config servers, gateway push audit extras, intelligence wallet context, auth refresh extras, and transaction drafting/advanced transaction passthroughs are compatibility or adapter boundaries that need domain-specific work before closing.
- The `z.unknown().transform` use in `server/src/api/wallets/crud.ts` is an implementation detail of the positive safe integer parser, not an open unknown-forwarding route field.
- Custom webhook receiver contracts remain deployment-local. The public repo should continue to avoid receiver-specific mapped keys, HMAC header names, URL shapes, static values, and business vocabulary in code, docs, tests, examples, or support-package output.

## Pre-commit Agent Gate Rationalization - 2026-05-22

Scope: current local hook hardening after a malformed `backend-quality` agent response during commit.

- Keep the parser/verdict contract centralized in `server/.husky/pre-commit`. `_parse_single_object`, `extract_json_object`, `derive_verdict_from_body`, and `extract_verdict` already provide one strict route from raw agent output to the gating verdict.
- Keep `.claude/agent-cache` and `.claude/agent-audit.jsonl` as ignored local state. Tracking or sharing those files would make local AI output part of the project contract and would risk leaking private review content.
- Local hardening treats malformed cache entries as stale local state and reruns them; fresh malformed output gets one strict-format retry; persistent `UNKNOWN` still blocks and is not cached.
- Phase Z extracted the repeated `claude --agent/--print` branch into `invoke_claude_agent` and added `tests/ci/pre-commit-agent-gate.test.sh` with a stubbed `claude` executable. The smoke test covers malformed cache rerun, fresh malformed retry success and caching, and persistent `UNKNOWN` no-cache blocking.

## Reanalysis Addendum - 2026-05-14

Scope: fresh pass on current `main` after Phases 1-6, looking for unresolved divergent values, validation paths, route/helper paths, and security boundaries. This addendum does not reopen completed work.

### Reanalysis Summary

- Worth consolidating next: wallet role/capability contracts, Bitcoin script plus wallet/account type identity, and node/Electrum config projection.
- Worth repairing while nearby: stale contract-test helper constants that no longer describe current network, draft, role, and transaction-type contracts.
- Low-risk opportunistic cleanup: the login health probe should go through a no-auth API helper instead of a route-local raw fetch.
- Watch with guardrails: LLM provider contracts, gateway route manifest versus validation map, and feature flag metadata/defaults.
- Keep separate: the LLM egress proxy boundary, proxy/backend request validation, refresh-token raw fetch, raw network broadcast versus wallet broadcast, and registration validation ordering.

### Addendum Inventory

| Area | Paths | Current Behavior | Disposition |
| --- | --- | --- | --- |
| Wallet roles and capability checks | `shared/types/domain.ts`, `server/src/services/wallet/types.ts`, `server/src/services/accessControl.ts`, `server/src/services/mobilePermissions/types.ts`, `src/api/wallets.ts`, `components/WalletDetail/*`, `components/send/SendTransactionPage/loadSendTransactionPageData.ts`, OpenAPI wallet schemas | Server/OpenAPI/mobile permissions recognize `approver`; shared/frontend domain types omit it in several places; some frontend checks treat any non-`viewer` role as edit/send capable even though server edit roles are only `owner` and `signer`. Server routes still appear protected by `requireWalletAccess('edit')`, so the current risk is type/UI drift and false affordances rather than a confirmed server authorization bypass. | Converge first |
| Bitcoin script and wallet/account type identity | `shared/types/domain.ts`, `shared/schemas/mobileApiRequests.ts`, `src/api/walletXpub.ts`, `src/api/wallets.ts`, `src/api/devices.ts`, `components/CreateWallet/types.ts`, `components/CreateWallet/createWalletData.ts`, `components/ImportWallet/importHelpers.ts`, `components/DeviceDetail/ManualAccountForm/types.ts`, `server/src/services/scriptTypes/index.ts`, `server/src/services/walletImport/types.ts`, `server/src/services/import/schemas.ts`, `server/src/api/devices/accounts.ts`, `server/src/api/wallets/crud.ts`, `server/src/services/wallet/walletAccountSelection.ts`, `server/src/services/bitcoin/descriptorBuilder.ts`, OpenAPI wallet/device schemas | The same `native_segwit`/`nested_segwit`/`taproot`/`legacy` tuple and related derivation/descriptor metadata are recreated across frontend, shared, server import, device, and OpenAPI paths. Adjacent wallet/account vocabularies also drift: wallet type uses `single_sig`/`multi_sig`, device account purpose uses `single_sig`/`multisig`, and local mapping code bridges the two. The server script-type registry remains the behavior owner, but its IDs and the wallet/account purpose values should be derived from canonical domain constants. | Converge second |
| Node/Electrum network config projection | `components/NetworkConnectionCard/networkConfigHelpers.ts`, `server/src/services/bitcoin/nodeClientConfig.ts`, `server/src/services/bitcoin/electrum/connectionConfigResolver.ts`, `server/src/services/bitcoin/electrumPool/poolConfig.ts`, `server/src/services/bitcoin/mempool/config.ts`, `server/src/services/bitcoin/networkStatusService.ts`, `server/src/services/bitcoin/feeService.ts`, admin node config schemas/OpenAPI | Defaults, enabled checks, legacy `testnet*` fallback, singleton/pool fields, and proxy field projection are repeated in UI and server runtime adapters. Admin save/load projection is already partly centralized in `server/src/api/admin/nodeConfigData.ts`; the next pass should reuse that shape where appropriate instead of creating another full config layer. | Converge third |
| Contract-test helper constants | `server/tests/helpers/contractValidation.ts`, `server/tests/contract/api.contract.test.ts` | The helper still hardcodes stale values such as legacy `testnet`, old draft statuses, `self` transaction type, and older sync/transaction labels. Some values now derive from server constants, but the file can still give false confidence because it is not generated from OpenAPI or shared constants. | Repair or retire with the next contract-test pass |
| Transaction type vocabulary | `shared/types/domain.ts`, `src/api/transactions/types.ts`, `server/src/api/openapi/schemas/transactions.ts`, `server/src/services/bitcoin/sync/**`, `server/src/services/bitcoin/blockchain/historyTransactions.ts`, `server/tests/helpers/contractValidation.ts` | Public/shared types allow `receive`, transaction query filters expose `received`, persisted sync types use `sent`/`received`/`consolidation`, and confirmation helpers also accept legacy/internal `send`/`receive` aliases. This looks like compatibility drift, not an immediate behavior bug. | Watch; normalize aliases at boundaries |
| Login health probe | `components/Login/useLoginFlow.ts`, `src/api/refresh.ts`, `src/api/authPolicy.ts` | Login uses a raw `fetch('/api/v1/health')`; refresh correctly uses a raw fetch because it must avoid `apiClient` recursion. The login health probe is a small base-URL/auth-policy divergence, not a security boundary. | Low-priority convergence |
| LLM provider contracts | `src/api/ai.ts`, `src/api/admin/types.ts`, `server/src/services/ai/providerProfile.ts`, `server/src/api/ai/models.ts`, `llm-egress-proxy/src/requestSchemas.ts`, `llm-egress-proxy/src/providerDetection.ts`, OpenAPI AI schemas | Provider enum/model/detection shapes are duplicated across frontend, backend, proxy, and OpenAPI. Separate proxy/backend validation is justified by the egress security boundary. | Watch; add parity tests before adding providers |
| Gateway route manifest and validation map | `gateway/src/routes/proxy/whitelist.ts`, `gateway/src/middleware/validateRequest.ts` | Route exposure/permission decisions and request schema objects live in separate tables, with existing parity tests catching manifest/schema drift. | Watch; derive only during future gateway schema work |
| Feature flag metadata/defaults | `server/src/services/featureFlags/definitions.ts`, `server/src/config/features.ts`, `server/src/config/schema.ts`, OpenAPI admin feature schemas | Definitions, defaults, env parsing, schema keys, and docs are separate but currently guarded by `Record<FeatureFlagKey, ...>` and OpenAPI parity tests. | Watch; consolidate if more flags are added |
| Auth registration validation ordering | `server/src/api/auth/login.ts`, `server/src/api/schemas/auth.ts` | Public register uses presence validation before the registration-enabled gate, then canonical username/email/password validation only after registration is allowed. This preserves current error ordering while registration is disabled. | Keep separate unless a route-contract change explicitly covers the ordering |

### Recommended Follow-Up Order

| Phase | Work | Verification | Exit Criteria |
| --- | --- | --- | --- |
| A | Centralize wallet role values and capability helpers. Move canonical role/share-role values and `canEdit`/`canApprove`/`canOwn` helpers to a shared-safe module or derive frontend helpers from server/OpenAPI constants. Decide explicitly whether `approver` is shareable in the UI; if yes, expose it intentionally, and if no, keep a distinct `WalletShareRole` subset. | Server access-control tests, mobile permission capability tests, OpenAPI wallet contracts, frontend wallet detail/send tests for `viewer`, `signer`, `approver`, and `owner`, plus negative searches for ad hoc `userRole !== 'viewer'` edit checks and permissive `wallet.canEdit !== false` fallbacks. | Shared/frontend/server role contracts agree; missing capability fields fail closed or derive from a valid role; `approver` cannot create/send/sign/broadcast/edit labels unless a capability explicitly allows it; owner-only actions remain owner-only. |
| B | Add canonical Bitcoin script type, wallet type, and device-account purpose tuples/types/schemas in shared code. Derive mobile schemas, frontend API request types, import helpers, device-account schemas, wallet-import constants, OpenAPI enums, script registry IDs, and wallet-type-to-account-purpose mapping from those constants. Keep the server script-type registry as the behavior/metadata owner. | Script registry parity tests, wallet import/schema tests, device account validation tests, Create/Import/Manual Account form tests, OpenAPI wallet/device contracts, touched-file lizard, `git diff --check`. | A search shows no unowned `native_segwit`/`nested_segwit`/`taproot`/`legacy`, `single_sig`/`multi_sig`, or `single_sig`/`multisig` tuples outside fixtures/tests that intentionally enumerate behavior. |
| B2 | Repair stale external-LLM-only copy and reference docs missed by the model-management removal. Remove active claims that Sanctuary can pull/delete/download/manage provider models and rename generic provider-model UI/API names that still say Ollama-only where feasible. | Negative searches for `pull/delete`, `download progress`, `model management`, stale `useModelDownloadProgress`, and misleading `Installed Models` copy outside historical plans/tests; focused AI settings/API typecheck if names change. | Active user docs, OpenAPI tags, reference architecture, and AI settings copy describe provider model listing/selection only; no route or UI copy implies Sanctuary installs or deletes provider models. |
| C | Extract or reuse node-config projection helpers for per-network defaults, legacy `testnet*` fallback, enabled semantics, singleton/pool config, proxy fields, and mempool estimator settings. Let UI/server adapters keep separate output shapes, and avoid duplicating the already-centralized admin save/load helpers in `server/src/api/admin/nodeConfigData.ts`. | Node config helper tests, `nodeClient.active-config` tests, Electrum singleton/pool tests, mempool config tests, NetworkConnectionCard helper tests, OpenAPI/admin node config contracts. | Testnet3/testnet4/signet/regtest/mainnet defaults and proxy projection have one source of truth per runtime boundary; adapters no longer duplicate fallback logic. |
| D | Replace or retire stale runtime contract validators in `server/tests/helpers/contractValidation.ts`. Prefer generated OpenAPI contract checks or imports from shared/server constants over hand-written enum arrays, including current draft status and transaction type vocabularies. | Contract test run and OpenAPI contract tests. | The contract helper cannot drift independently from current shared/OpenAPI constants, or it is deleted in favor of stronger contract coverage. Wallet response `syncStatus` and sync-pipeline `SyncStatus` remain separate unless a contract migration intentionally joins them. |
| E | Wrap login health lookup in a no-auth health API helper that honors the same API base URL rules as the rest of the client. Keep `src/api/refresh.ts` raw because it is the refresh-recursion boundary. | Login flow tests for health success, 401-as-connected, network failure, and registration-status failure. | No route-local `/api/v1/health` fetch remains in login code; refresh raw fetch remains documented and tested. |

### Addendum Edge Cases

- Role convergence must preserve existing stored `approver` roles and must not silently downgrade them to `viewer` or `signer`.
- `approver` is approve-capable, not edit-capable. It should not reveal send, draft creation, PSBT signing, raw broadcast, label editing, device management, or policy-management UI unless the server capability matrix changes first.
- Wallet sharing needs two explicit concepts: all persisted wallet roles and shareable non-owner roles. Owner transfer remains a separate workflow and should not become a share role by accident.
- Mobile permission caps cannot grant a capability that the wallet role itself lacks. Capability helpers should keep role maxima and user/owner restrictions separate.
- Script type convergence must preserve taproot single-sig support while keeping taproot multisig unsupported unless the server registry changes that behavior.
- Script type helpers must keep BIP-44/49/84/86 single-sig derivation, BIP-48 multisig suffixes, legacy multisig behavior, descriptor parsing, xpub version conversion, and external import aliases stable.
- Node config convergence must preserve disabled non-mainnet behavior, testnet3 legacy fallback fields, intentionally empty testnet4 singleton host default, signet/mutinynet defaults, regtest handling, `false` SSL values, zero/null port rejection, proxy field projection, and secret redaction.
- LLM provider enum convergence must not collapse proxy and backend validation into one trust boundary. The proxy should continue to validate independently even if provider constants are shared or parity-tested.
- Registration validation cleanup must preserve current missing-field errors before the registration-enabled check and must not leak password-strength or email-format details while public registration is disabled.
- Contract-test repair should not make historical fixtures the source of truth. Live OpenAPI/shared constants should drive the assertions.

## Independent Review Addendum - 2026-05-15

Scope: independent pass over the 2026-05-14 reanalysis using code evidence first, then comparing the results back to the existing ranked queue. This review confirms the follow-up queue but records several priority and scope refinements.

### Independent Review Verdict

- Confirmed top priority: wallet role and capability convergence. The highest-risk drift is `approver`: the server and OpenAPI know it, while shared/frontend types and UI affordances still omit or misclassify it. The server edit/send paths appear protected by `requireWalletAccess('edit')`, so the current issue is false frontend capability signals and contract drift, not a proven backend auth bypass.
- Confirmed second priority with expanded scope: Bitcoin script type convergence should include wallet type and device account purpose constants. `single_sig`/`multi_sig` and `single_sig`/`multisig` mapping is part of the same domain vocabulary problem.
- Confirmed third priority with narrower target: node/Electrum projection drift exists in UI and runtime adapters, but admin node config save/load projection is already partly centralized. The next pass should share projection semantics without replacing every adapter shape.
- Confirmed active test-risk item: `server/tests/helpers/contractValidation.ts` is a false-confidence risk because stale helper constants validate stale fixtures instead of current OpenAPI/shared contracts.
- Added watch item: transaction type vocabulary should eventually normalize `receive`/`send` aliases at compatibility boundaries and keep persisted/public values canonical. This is lower priority than wallet roles and Bitcoin account metadata.
- Left unchanged: LLM provider validation, gateway manifest versus validation map, feature flag metadata/defaults, registration validation ordering, refresh raw fetch, and raw network broadcast versus wallet broadcast remain intentionally separate or guarded.

### Independent Review Adjustments

| Finding | Review Result | Adjustment |
| --- | --- | --- |
| Wallet roles and capability checks | Confirmed. `shared/types/domain.ts` and frontend share request types omit `approver`; server wallet/access/mobile permission paths include it; multiple wallet detail/send UI checks use `userRole !== 'viewer'`. | Keep as Phase A. Require canonical role/share-role values plus capability helpers, and add negative searches for non-viewer edit/send gates. |
| Bitcoin script type identity | Confirmed and broader. Script type tuples are duplicated, and wallet type/device account purpose values are coupled through local mappings. | Expand Phase B to include script type, wallet type, device account purpose, and wallet-type-to-purpose mapping constants. |
| Node/Electrum config projection | Confirmed, but admin save/load projection is less duplicated than the prior text implied. | Keep Phase C, but scope it to runtime/UI projection semantics and intentional adapter outputs. |
| Contract-test helper constants | Confirmed. Stale networks, draft statuses, transaction types, and synthetic contract fixtures can pass while no longer matching OpenAPI. | Keep Phase D. Prefer generated/OpenAPI-backed checks or delete the helper. |
| Transaction type vocabulary | Newly identified. `receive`/`send` aliases exist near confirmation/import boundaries while most persisted/public paths use `received`/`sent`. | Add as watch item, not a top phase. Normalize aliases only at legacy or external boundaries. |
| LLM provider contracts | Confirmed watch. Provider enum duplication remains, but separate backend/proxy validation is justified by the egress security boundary. | Add parity tests before adding provider types; do not collapse the proxy trust boundary. |
| Gateway route manifest and validation map | Confirmed watch. Existing parity tests guard route/schema drift. | Defer unless future gateway schema work changes the risk. |
| Registration validation ordering | Confirmed keep-separate. Presence validation before the disabled-registration gate is intentional. | Preserve missing-field errors before `registrationEnabled`; do not leak stronger validation while public registration is disabled. |

### Independent Review Corner Cases

- Wallet role convergence must distinguish persisted wallet roles, shareable non-owner roles, UI affordances, and server action capabilities. `approver` should approve but should not create/send/sign/broadcast/edit unless the capability matrix changes.
- Frontend checks should prefer server-provided `canEdit` or shared capability helpers over `userRole !== 'viewer'`. Owner-only and approver-only actions should stay distinct.
- Script/account convergence must not confuse wallet type `multi_sig` with device purpose `multisig`; a canonical mapping helper is safer than broad string casting.
- Transaction type cleanup must keep `received` as the canonical persisted/public incoming transaction label unless a separate API migration intentionally changes it. `receive` and `send` should be treated as aliases at compatibility boundaries, not as new storage values.
- Contract-helper repair must derive from live OpenAPI/shared constants or be deleted; updating stale literals by hand would preserve the same failure mode.

## Plan Detail Review Addendum - 2026-05-15

Scope: implementation-readiness review of Phases A-E. This addendum adds details, sequencing constraints, and corner cases that should be handled before opening implementation PRs.

### Cross-Phase Execution Rules

- Keep the next follow-ups as separate PRs unless one phase directly needs another phase's new shared constants. Phase A is the highest-risk user-facing permissions work and should not be bundled with script/account metadata cleanup.
- Prefer pure shared constants and small helpers over broad abstractions. Shared modules must not import Prisma, Express, React, browser globals, node-only config, or server-only validation code.
- Any helper that reads values from the database or external payloads should parse or guard values before casting. Unknown role/type/status values should fail closed or normalize only at explicit compatibility boundaries.
- Negative searches should distinguish production source from fixtures, generated snapshots, historical docs, and tests that intentionally enumerate behavior.
- Each phase should add regression tests before or with call-site rewrites, then run a negative search proving old ad hoc checks or tuples are gone from production paths.

### Phase A Detail - Wallet Roles And Capabilities

Implementation details:

- Introduce canonical wallet role constants/types and capability helpers in shared-safe code, likely near `shared/types/domain.ts` or a new shared wallet constants module. Export all persisted wallet roles, shareable wallet roles, and role capability helpers separately.
- Replace local role tuples in `server/src/services/wallet/types.ts`, `server/src/services/accessControl.ts`, `server/src/services/mobilePermissions/types.ts`, `src/api/wallets.ts`, Wallet Detail components, and OpenAPI schemas with the canonical values or derived subsets.
- Add parse/guard helpers for wallet role values coming from Prisma string columns before treating them as `WalletRole`. Current `as WalletRole` casts should not turn malformed stored strings into privileges.
- Update stale Prisma comments for `WalletUser.role` and wallet group roles so they mention `approver` where the database already permits it as a string value. A migration is not needed unless the schema changes from string columns to database enums.
- Make a product decision explicit before editing UI: either `approver` is shareable and the Access tab/API types expose it, or `approver` is not shareable and the server `WalletShareRole` subset stops accepting it. Do not leave server and UI disagreeing.
- Replace frontend edit/send gates such as `userRole !== 'viewer'` with `canEdit` or a shared capability helper. Add a separate `canApprove` path for approval UI rather than overloading edit.
- Define direct-user versus group-role precedence explicitly. Current code often takes direct access first; comments in access control claim "highest privilege" behavior. If changing to highest privilege, add targeted tests for direct viewer plus group signer/approver/owner and for direct signer plus group approver.
- Keep access-cache invalidation in scope for share role updates, group membership changes, group role changes, and owner transfer. Stale role cache behavior should be tested or intentionally documented.

Corner cases:

- Existing stored `approver` roles must remain valid and must not be downgraded during parsing or serialization.
- Unknown stored roles, empty strings, nulls, and malformed group roles should deny edit/approve privileges and should not become `viewer` in a way that hides data quality problems.
- `approver` must be able to see approval-required surfaces but must not see send, draft creation, PSBT signing, raw/wallet broadcast, label editing, device management, share management, delete, or policy-management controls unless server capabilities change first.
- Owner transfer must stay separate from sharing. Share/update endpoints must not allow accidental owner assignment or owner removal through non-owner role updates.
- `wallet.canEdit` missing from an API response should not default to true for non-owner/non-signer users. Prefer explicit capability derivation from role plus response field instead of permissive fallback behavior.

Verification additions:

- Add server access-control tests for all roles across `view`, `edit`, `approve`, and `owner` access levels.
- Add wallet sharing route tests for `approver` acceptance or rejection, depending on the product decision.
- Add mobile permission role-capability tests that prove signer and approver are orthogonal peers.
- Add frontend Wallet Detail/Send/Drafts/UTXO/Access tests for `viewer`, `signer`, `approver`, and `owner`.
- Run a negative search for production `userRole !== 'viewer'`, local `viewer | signer` wallet-share role unions, and stale wallet-role tuples.

### Phase B Detail - Script, Wallet Type, And Account Purpose Identity

Implementation details:

- Add canonical values for wallet script type, persisted wallet type, device account purpose, and wallet-type-to-account-purpose mapping. Keep wallet type `multi_sig` and device purpose `multisig` as distinct public/storage values unless a separate migration is approved.
- Keep a distinct derived account-purpose type for parser output that may include `unknown`; do not let `unknown` leak into persisted device account schemas.
- Derive mobile account schemas, frontend API types, wallet import schemas, device account route schemas, OpenAPI enums, Create Wallet account selection, and wallet import helpers from the canonical values.
- Keep the server script-type registry as behavior metadata owner for derivation paths, descriptor wrappers, multisig support, fee estimates, and display metadata. The registry should prove parity with canonical script type IDs rather than define a competing tuple.
- Do not collapse address type constants such as `testnet_legacy`, address regex keys, or test vectors into wallet script type constants. They are adjacent but different domains.
- Leave UI labels, descriptions, and ordering local unless a shared metadata table clearly removes drift without forcing UI copy into shared domain code.

Corner cases:

- Preserve single-sig derivations for BIP-44/49/84/86 and multisig BIP-48 suffixes; signet/regtest/testnet wallet accounts should keep testnet-family coin type behavior.
- Preserve legacy multisig behavior, current taproot single-sig behavior, and current taproot multisig rejection.
- Preserve external import aliases from descriptor/BlueWallet/Coldcard paths, xpub/ypub/zpub and testnet xpub version conversion, and JSON import validation messages.
- Device matching must keep network, account purpose, script type, and derivation path checks aligned. A multisig wallet should not silently select a single-sig account unless the current fallback is deliberately retained and warned.
- Fixture/test tuples that intentionally enumerate script types can remain, but production request/response/schema tuples should derive from canonical values.

Verification additions:

- Add shared constant parity tests for script types, wallet types, device account purposes, and wallet-type-to-purpose mapping.
- Add script registry parity tests proving every canonical script type has a handler and every handler ID is canonical.
- Add wallet create/import/device account tests for all script types, both wallet types, both account purposes, taproot multisig rejection, and missing-account error messages.
- Add OpenAPI contract tests for wallet, device account, mobile account, and import schemas.
- Run negative searches for unowned production tuples of `native_segwit`/`nested_segwit`/`taproot`/`legacy`, `single_sig`/`multi_sig`, and `single_sig`/`multisig`.

### Phase C Detail - Node/Electrum Config Projection

Implementation details:

- Centralize projection semantics, not all adapter output types. Admin save/load still needs request parsing, encryption, redaction, and legacy response shaping; runtime adapters still need concrete client/pool/mempool output shapes.
- Prefer a pure projection helper for per-network defaults, legacy testnet3 fallback fields, enabled checks, singleton fields, pool fields, proxy settings, and external service URLs. UI can use a frontend-safe helper or endpoint-shaped projection, not a server-only import.
- Use nullish coalescing semantics where `false` is meaningful, especially for `singletonSsl`. Do not turn explicit `false` into default TLS.
- Keep validation of impossible values at the boundary: port `0`, negative ports, out-of-range ports, non-integer pool sizes, and pool max below min should be rejected or normalized consistently.
- Preserve regtest behavior as the legacy/base config path unless a separate UI/config phase introduces per-regtest fields.
- Preserve proxy password redaction and encryption boundaries. Shared projection helpers must not require decrypted secrets in frontend or OpenAPI response code.

Corner cases:

- Disabled non-mainnet networks should not create active clients or pools just because defaults exist.
- Testnet3 must keep legacy `testnet*` fallback fields; testnet4 must keep intentionally empty singleton host behavior; signet must keep current default host/URL choices; regtest must keep local/base behavior.
- Pool mode with no enabled servers, singleton mode with missing host, missing fee estimator URL, empty external-service URL strings, and database nulls should all have explicit behavior.
- Runtime network status must distinguish configured server rows from live pool stats and singleton fallback without reporting stale or redacted secrets.
- UI projections should round-trip unchanged config without converting nulls to empty strings or false booleans to defaults unless the API contract already defines that behavior.

Verification additions:

- Add projection helper tests covering mainnet, testnet3 legacy fallback, testnet4, signet, regtest, disabled networks, `singletonSsl: false`, null ports, invalid ports, and pool min/max boundaries.
- Keep or add Electrum singleton/pool tests that verify proxy projection, configured-server stats, pool fallback, and no-client behavior for disabled networks.
- Add NetworkConnectionCard helper/controller tests that prove UI values match backend response defaults and preserve false/null boundary values.
- Add OpenAPI/admin node config tests for save/load compatibility and redaction.

### Phase D Detail - Contract-Test Helper Repair

Implementation details:

- Decide whether `server/tests/helpers/contractValidation.ts` still earns its keep. If retained, it should derive enum values from current shared/server/OpenAPI sources; if not, replace it with generated/OpenAPI-backed schema checks.
- Update fixtures to current contracts instead of updating literals in place: networks should include `testnet3`/`testnet4`, draft status should use `unsigned`/`partial`/`signed`, draft payloads should use `psbtBase64`, and transaction types should stop treating `self` as current.
- Keep negative tests, but make them assert actual invalid values against the live schema or derived validator, not stale helper error strings.
- Avoid making OpenAPI snapshots and helper constants two independent sources of truth. One should drive the other or the helper should be deleted.

Corner cases:

- Legacy compatibility aliases such as `testnet`, `receive`, and `send` should be accepted only where the actual API accepts them. Contract helpers should not bless aliases globally.
- Numeric fields represented as strings in API responses, nullable date fields, empty arrays, optional nested wallet/user fields, and BigInt balance strings should be covered by live schemas.
- Contract tests should fail when OpenAPI changes without matching fixtures, rather than passing through helper-local expectations.

Verification additions:

- Run `npm --prefix server run test:contract` or the current contract-test command after repair.
- Add OpenAPI schema validation tests for wallet, transaction, draft, network, role, and mobile draft contracts.
- Run a negative search for stale helper literals: `testnet` as a contract network, draft `pending`/`broadcast`/`expired`/`cancelled`, and transaction `self`.

### Phase E Detail - Login Health Helper

Implementation details:

- Add a no-auth health API helper that uses the same API base URL rules as other direct fetch helpers while avoiding `apiClient` and refresh-on-401 recursion.
- Keep the helper GET-only with no CSRF header. `credentials: 'include'` is acceptable for same-origin consistency, but the helper should not depend on an authenticated session.
- Add an abort/timeout path so the login screen does not hang indefinitely when the backend or LAN route is unreachable.
- Preserve current behavior where health `200` and `401` count as connected, registration status is fetched only after connectivity is established, and registration-status failure falls back to disabled registration.
- Avoid setting login state after unmount or after a newer check has superseded an older one.

Corner cases:

- Base URLs with and without trailing slashes, proxied `/api/v1` paths, LAN access, mixed-content blocking, DNS failures, TLS failures, and 503 unhealthy responses should produce predictable connected/error states.
- A healthy API with registration-status failure should still permit login but hide registration.
- Refresh raw fetch remains intentionally separate and should not be routed through the new helper.

Verification additions:

- Add login flow tests for health success, 401-as-connected, 503/error status, network rejection, timeout/abort, registration-status success, registration-status failure, and unmount during in-flight check.
- Add a negative search proving login no longer contains route-local `fetch('/api/v1/health')` while `src/api/refresh.ts` still owns its direct refresh request.

## Second Independent Review Addendum - 2026-05-15

Scope: second independent double-check of the current findings and plan details. This pass intentionally looked for overreach, false-positive consolidation targets, and any issue that should outrank Phase A before implementation starts.

### Second Review Verdict

- The ranked queue still stands. Wallet role/capability convergence remains Phase A, script/wallet/account identity remains Phase B, node/Electrum config projection remains Phase C, stale contract-test helper repair remains Phase D, and the login health helper remains Phase E.
- No newly found divergence outranks Phase A. The wallet-role risk is still the only one that can produce user-facing permission affordances that disagree with server capability semantics.
- Phase A should explicitly include two extra production checks: `server/src/services/wallet/walletQueries.ts` has two local `canEdit` derivations, and several wallet-facing UI components treat missing `canEdit` as editable through `wallet.canEdit !== false` or component defaults.
- Device roles are a false-positive trap for Phase A. Device access is currently an owner/viewer domain with separate sharing behavior and no `approver` role; it can later reuse parsing/guard patterns, but it should not be folded into wallet role constants.
- Phase B is still valid, but behavior tables, parser-only `unknown` values, address regex keys, fixture tuples, and UI examples should not be treated as production tuple drift. Canonical constants should drive persisted/API request and response values, while behavior metadata stays with the script registry or local domain logic.
- Phase D should avoid conflating two similarly named sync domains. Wallet response `syncStatus` currently uses `synced`/`syncing`/`error`/`pending`/`never`, while the sync pipeline uses `success`/`failed`/`partial`/`retrying`; they should stay separate unless an explicit API migration changes one of the contracts.
- Watch items remain watch items. LLM provider enum duplication, gateway manifest/schema separation, feature flag metadata/default duplication, and transaction type alias cleanup are real, but existing boundaries or lower blast radius keep them behind Phases A-D.

### Second Review Adjustments

| Area | Double-Check Result | Adjustment |
| --- | --- | --- |
| Wallet role/capability checks | Confirmed and sharpened. `approver` drift is real, `walletQueries` derives `canEdit` in more than one way, and wallet UI defaults can fail open when `canEdit` is absent. | Keep Phase A first. Add fail-closed capability handling and negative searches for both role-based gates and permissive `canEdit` fallbacks. |
| Device roles | Confirmed as adjacent but separate. Device role values are owner/viewer only and do not support the wallet approver/signing matrix. | Exclude from Phase A except for optional shared parsing/guard style later. Do not introduce wallet roles into device sharing. |
| Script/account type identity | Confirmed, with boundaries. Persisted/API script, wallet type, and device purpose values should derive from canonical constants, but parser output can include `unknown` and script registry behavior can remain local. | Keep Phase B. Negative searches should ignore fixtures, examples, parser-only values, and intentional behavior matrices. |
| Node/Electrum projection | Confirmed unchanged. Repeated default/fallback/proxy projection remains a maintainability risk, but no second-pass evidence makes it more urgent than permissions. | Keep Phase C scoped to projection semantics and adapter boundary tests. |
| Contract helper constants | Confirmed, with sync-status caution. Stale literals remain a false-confidence risk, but not every similarly named status field belongs to the same vocabulary. | Keep Phase D. Derive from live schemas/constants and document distinct wallet-response versus sync-pipeline status domains. |
| LLM/gateway/feature flags | Confirmed as lower priority. Separate proxy validation and gateway validation maps still have security and route-manifest reasons to remain separate for now. | Keep as watch items with parity tests before expanding provider, gateway, or feature-flag surfaces. |

### Second Review Corner Cases

- Missing or malformed wallet role/capability data must fail closed for edit/send/sign/broadcast UI. Generic list components may keep reusable defaults only if wallet-owned callers pass explicit capability values and tests cover the negative cases.
- Direct wallet role versus group wallet role precedence must be a deliberate contract. If the implementation changes from direct-first to highest-privilege selection, tests must cover direct viewer plus group signer/approver/owner and direct signer plus group approver.
- Device role cleanup should not accidentally add signer/approver semantics to device access, device sharing, transfer, or event payloads.
- Script/account convergence should preserve `unknown` only where parsers need to report unsupported-but-parseable derivation paths; persisted device account and wallet schemas should continue to reject unsupported account purposes.
- Contract helper cleanup should not globally accept `testnet`, `send`, or `receive` aliases. Each alias should be accepted only at the boundary whose live schema currently supports it.
- Sync status cleanup should test both domains by their owning schemas rather than inventing a combined enum.

## Third Independent Review Addendum - 2026-05-15

Scope: independent implementation-gate review during Phase A, checking whether the ranked findings still match the current working tree and whether the in-progress Phase A edits missed any wallet role/capability paths.

### Third Review Verdict

- The overall queue still stands: Phase A remains the right first implementation slice, followed by script/wallet/account identity, node/Electrum projection, stale contract-helper repair, and login health helper cleanup.
- The in-progress Phase A work already addresses much of the original wallet-role drift by adding shared role constants, share-role subsets, parsing helpers, and capability helpers, then migrating many server, OpenAPI, wallet detail, and sharing paths.
- One remaining Phase A production gap was found: the direct send-page loader still treated only `viewer` as blocked, so an `approver` could reach send-page data loading by navigating directly to `/wallets/:id/send`. Phase A must use the same edit-capability helper there before delivery.
- A second Phase A cleanup gap was found in mobile-permission OpenAPI schemas, which still repeated wallet role enum literals after wallet OpenAPI schemas had moved to shared role constants.
- The Phase B finding remains strongly supported. Active production code still repeats script type, wallet type, and device account purpose values across shared schemas/types, frontend APIs, create/import/device UI, server wallet/import/device validation, script registry IDs, and descriptor utilities.
- The Phase C finding remains supported but should stay scoped to projection semantics. Runtime adapters still repeat node/Electrum default, fallback, enabled, pool/singleton, proxy, and mempool URL projection; this does not justify replacing every adapter output shape.
- The Phase D finding remains supported. `server/tests/helpers/contractValidation.ts` still contains stale hand-written networks, draft statuses, transaction types, and draft PSBT field names that can validate obsolete fixtures.
- The Phase E finding remains low priority but valid. Login still owns a route-local raw `fetch('/api/v1/health')`; refresh raw fetch remains the intentional recursion boundary.

### Third Review Adjustments

| Area | Review Result | Adjustment |
| --- | --- | --- |
| Send-page wallet access | Confirmed remaining Phase A bug. Wallet detail gates migrated to capability helpers, but `loadSendTransactionPageData` still blocked only `viewer`. | Fix in Phase A and add tests for `approver`, malformed role, and explicit `canEdit` behavior before PR. |
| Mobile permission OpenAPI roles | Confirmed remaining Phase A drift. Mobile permission schemas repeated `viewer`/`signer`/`approver`/`owner` literals. | Derive those enums from shared wallet role constants. |
| Wallet role direct/group precedence | Still a design risk rather than an implementation blocker. Current code remains direct-first; changing to highest-privilege is larger than Phase A unless explicitly chosen. | Keep direct-first for Phase A and test malformed/unknown values fail closed. Record highest-privilege selection as a later product/contract decision if needed. |
| Script/wallet/account values | Confirmed unresolved. Production tuples remain widespread. | Keep as Phase B. Ignore examples, fixtures, parser-only values, and behavior matrices in negative searches. |
| Contract helpers | Confirmed unresolved. Stale literals remain. | Keep as Phase D. Repair by deriving from live constants/schemas or deleting the helper. |

### Third Review Corner Cases

- Direct send-page access must fail closed for `approver`, `viewer`, unknown roles, missing roles, and `canEdit: false`; it may allow missing role only when the server explicitly provides `canEdit: true`.
- Capability derivation must not fetch UTXOs, addresses, mempool data, or devices after a non-editable wallet response. Redirecting after data fetch would preserve the false affordance and waste calls.
- Mobile permission schema updates should not change the mobile role capability matrix; they should only remove the repeated enum source.
- Direct-first wallet role selection means a direct `viewer` share can still override a group `signer` membership today. That behavior should not be changed accidentally inside a constants migration.
- The remaining Phase B tuple cleanup must preserve intentional script behavior differences such as taproot single-sig support and taproot multisig rejection.

## Fourth Independent Review Addendum - 2026-05-15

Scope: independent double-check after Phase A was merged and while Phase B has in-progress uncommitted wallet identity edits. This pass treated the current working tree as evidence, but it distinguished completed Phase A behavior from partially migrated Phase B code.

### Fourth Review Verdict

- Phase A remains closed. Targeted searches did not find remaining production `userRole !== 'viewer'` edit gates or `wallet.canEdit !== false` fail-open wallet gates in the active app/server code. Remaining hard-coded wallet-role references are tests, wallet-share UI choices, Prisma comments, or the already-known contract-helper repair area.
- Phase B remains the right active implementation slice. The branch now has a shared wallet identity module, but production drift still exists across device parsers, hardware-wallet account discovery, server device/wallet schemas, OpenAPI wallet schemas, script registry IDs, import/descriptor services, and several UI display/default paths.
- Phase C remains valid and still lower priority than Phase B. Node/Electrum projection logic repeats the same default host/port, testnet3 legacy fallback, pool override, proxy, and mempool URL semantics across UI helpers and runtime adapters, while admin save/load mapping remains a separate boundary with encryption/redaction concerns.
- Phase D remains valid. `server/tests/helpers/contractValidation.ts` now imports wallet-role constants, but it still owns stale local network, wallet/script type, transaction type, and draft status tuples; it should derive from live constants/schemas or be retired.
- Phase E remains low priority. Login still has a route-local raw `/api/v1/health` fetch, while refresh remains an intentional raw-fetch recursion boundary.
- New missed fallout from the completed external-LLM/model-management removal: live pull/delete routes still appear removed, but several docs/copy/type names still imply model management or old download plumbing. This does not reopen the security boundary decision and does not outrank Phase B, but it should be repaired soon because it contradicts the external-LLM-only product line.

### Fourth Review Adjustments

| Area | Review Result | Adjustment |
| --- | --- | --- |
| Wallet role/capability closure | Confirmed closed for active production gates. Phase A shared role helpers and fail-closed UI paths now appear to own wallet capability checks. | Do not reopen Phase A. Keep wallet-role literals in fixtures/tests only when they intentionally enumerate behavior. |
| Script/wallet/account identity | Confirmed still partially migrated. Current branch has `shared/constants/walletIdentity.ts`, but production callers still repeat `native_segwit`/`nested_segwit`/`taproot`/`legacy`, `single_sig`/`multi_sig`, and `single_sig`/`multisig` tuples. | Continue Phase B. Finish server schemas/OpenAPI/import/descriptor/script-registry migrations and then run negative searches scoped to production code. |
| Node/Electrum projection | Confirmed unchanged. UI helpers, node-client config, connection resolver, pool config, mempool config, and admin mapping repeat overlapping projection semantics. | Keep Phase C scoped to projection semantics. Preserve adapter output shapes, admin encryption/redaction, and explicit `false` SSL semantics. |
| Contract helper constants | Confirmed unchanged. The helper still hardcodes stale `testnet`, transaction `self`, old draft statuses, wallet/script tuples, and response field names. | Keep Phase D. Prefer deriving from OpenAPI/shared/server constants instead of refreshing another hand-written tuple. |
| Login health helper | Confirmed unchanged. `components/Login/useLoginFlow.ts` still owns raw `/api/v1/health`; `src/api/refresh.ts` still owns raw `/auth/refresh` for a justified reason. | Keep Phase E. Add a no-auth health helper with timeout/abort and no refresh recursion. |
| External-LLM copy/docs fallout | New repair item. `docs/how-to/ai-mcp-console.md` still says Sanctuary can pull/delete Ollama models, `server/src/api/openapi/spec.ts` describes AI as model management, `docs/reference/frontend-architecture.md` still lists `useModelDownloadProgress`, and the AI settings model dropdown labels provider-reported models as `Installed Models`. Generic provider-model data is also still named `OllamaModel` in frontend API/types. | Add a small copy/docs/type-name cleanup after Phase B or fold it into the next low-risk PR. Verify with negative searches for pull/delete/download/model-management language outside historical plans and tests. |

### Fourth Review Corner Cases

- Phase B should not treat all remaining tuple literals as bugs. Behavior matrices, fixture assertions, import aliases, address regex keys, derivation path decisions, and user-visible labels can remain local when they intentionally describe behavior rather than define an API/storage vocabulary.
- Phase B should finish replacing value definitions before replacing comparisons. Replacing comparisons without migrating schemas/OpenAPI/test helpers can leave the same drift risk with more indirection.
- `components/CreateWallet/createWalletData.ts` should not rebuild a wallet type through a ternary once `state.walletType` is already canonical; using the canonical state value avoids reintroducing `single_sig`/`multi_sig` literals.
- The script registry should keep aliases such as `p2wpkh`, `bech32`, and `p2tr` as behavior metadata; only handler IDs need parity with canonical script type values.
- External-LLM copy cleanup should preserve provider model listing and manual model entry. It should remove claims that Sanctuary installs, pulls, deletes, downloads, or manages provider models.
- Historical plans and archived analysis may mention old model-management terms as history, but active user docs, OpenAPI descriptions, UI copy, route docs, and generated/reference architecture should describe provider model selection/listing only.

## Fifth Independent Review Addendum - 2026-05-15

Scope: fresh double-check after Phase A was merged and after the Phase B wallet identity branch had a committed implementation plus in-progress CI fixes. This pass challenged whether Phase B can be considered complete, and whether B2/C/D/E should change order.

### Fifth Review Verdict

- Phase A remains behaviorally closed. No active production `userRole !== 'viewer'` edit/send gates or fail-open `wallet.canEdit !== false` checks were found. Remaining wallet-role literals are mostly owner-only checks, typed share-role UI choices, device owner/viewer domains, tests, or docs. Those do not justify reopening Phase A before Phase B merges.
- Phase B is still the correct active priority, but the implementation is not fully clean yet. The canonical module exists and many schemas/OpenAPI/import paths now derive from it, but a negative production search found remaining wallet/script/account identity literals in active runtime code that should be migrated before merge.
- The strongest remaining Phase B drift is `server/src/services/deviceAccountConflicts.ts`, which still defines its own device account purpose and script type unions plus `Set` validators. That is a duplicate contract at a server boundary and should derive from `DEVICE_ACCOUNT_PURPOSE_VALUES`, `WALLET_SCRIPT_TYPE_VALUES`, and the shared types.
- Smaller Phase B cleanup remains in default/comparison paths: `components/DeviceDetail/accounts/hooks/useAddAccountFlow.ts`, `components/WalletDetail/hooks/walletDataFormatters.ts`, `server/src/services/wallet/walletCreate.ts`, `server/src/services/agentOperationalAddressService.ts`, and fee-estimate defaults in `server/src/services/bitcoin/advancedTx/batch.ts`. These are lower-risk than schema drift, but replacing them with canonical constants keeps the exit search honest.
- B2 remains a separate copy/docs/type-name cleanup. Live pull/delete/system-resource routes still appear removed; the remaining issue is active docs/UI/OpenAPI wording such as `docs/how-to/ai-mcp-console.md`, `server/src/api/openapi/spec.ts`, `docs/reference/frontend-architecture.md`, `Installed Models`, and generic provider-model data still named `OllamaModel`.
- Phase C, D, and E remain correctly ordered after B2. Node/Electrum projection drift is still real, `server/tests/helpers/contractValidation.ts` still has stale local network/transaction/draft tuples despite importing wallet identity constants, and login still has the route-local raw health fetch while refresh remains intentionally raw.

### Fifth Review Adjustments

| Area | Review Result | Adjustment |
| --- | --- | --- |
| Phase B completion gate | Prior local completion notes were too optimistic. Production literal search still finds active runtime callers outside the canonical module. | Fix remaining production identity literals before merging Phase B, then rerun the scoped negative search. |
| Device account conflict validation | Confirmed missed duplicate contract. `DeviceAccountInput`, `validPurposes`, and `validScriptTypes` are locally defined in `server/src/services/deviceAccountConflicts.ts`. | Derive types and validators from shared wallet identity constants; keep parser-only `unknown` out of persisted input types. |
| Device add-account defaults | Confirmed smaller runtime cleanup. QR/import and manual-account defaults still construct `single_sig`/`multisig`/`native_segwit` directly. | Replace with `DeviceAccountPurpose` and `WalletScriptType` constants. |
| Wallet formatting and wallet creation comparisons | Confirmed smaller runtime cleanup. A few comparisons against `single_sig`/`multi_sig` and purpose mapping are still literal. | Use `WalletType` constants and `accountPurposeForWalletType` where appropriate; preserve user-facing `single-sig`/`multisig` labels. |
| External-LLM B2 | Confirmed as repair item, not a route/security blocker. Route searches find pull/delete removed from active code; wording and type names remain misleading. | Keep after Phase B unless the Phase B PR already touches AI files. |
| Phase C/D/E | Confirmed unchanged. No newly found issue outranks the current Phase B cleanup. | Continue queue after Phase B and B2. |

### Fifth Review Corner Cases

- Migrating `deviceAccountConflicts` must preserve legacy single-account derivation parsing, including the explicit rejection of parser-only `unknown` account purpose or script type.
- Replacing runtime defaults with constants must not change default account choice: manual add-account still defaults to multisig native SegWit with `m/48'/0'/0'/2'`, and UR extraction still uses native SegWit unless parsing logic becomes smarter in a separate hardware/import phase.
- Wallet creation must still enforce exactly one device for single-sig and at least two devices for multisig; using constants should not broaden accepted wallet type strings.
- `server/src/services/bitcoin/advancedTx/batch.ts` uses native SegWit as a fee-estimate assumption, not as an API enum. Importing the constant is enough; do not change fee behavior in Phase B.
- Wallet share UI may keep explicit role labels/buttons because callback types enforce the share-role union, but option values that cast raw select strings should remain covered by server validation and route tests.
- Owner-only UI and route checks can compare against `owner` directly when they are authorization-level checks; the Phase A risk was broad `not viewer` edit/send logic, not every owner equality.

### Fifth Review Follow-Through

- The Phase B gaps found in this review were patched on the Phase B branch before merge: device-account conflict validation, device add-account defaults, wallet formatting, wallet creation comparisons, agent operational wallet checks, and batch fee-estimate defaults now derive from the canonical wallet identity constants.
- The scoped production literal search now leaves only accepted domains: address-type detection constants, the canonical wallet identity module, user-visible labels/examples/i18n keys, and script-registry comments.
- Backend coverage fallback tests were added for unsupported wallet identity values in wallet export and descriptor repair after the full backend coverage merge exposed those previously uncovered fallback branches.

## Sixth Independent Review Addendum - 2026-05-15

Scope: independent double-check after Phase A, Phase B, and Phase B2 were merged, while Phase C node/Electrum projection changes are in progress in the working tree.

### Sixth Review Verdict

- Phase A remains closed. A fresh production search found no broad `userRole !== 'viewer'` edit/send gates and no `wallet.canEdit !== false` fail-open wallet gates. Remaining wallet-role references are canonical helpers, approval/owner semantics, share UI choices, comments, or tests.
- Phase B remains closed. Remaining script/wallet/account vocabulary matches are accepted domains: address classification, derivation/export behavior maps, user-facing examples or labels, parser and descriptor comments, feature-flag names, and the already-known stale contract helper. No active production request/schema tuple reopened the Phase B finding.
- Phase B2 remains closed. Active docs/UI/OpenAPI copy no longer claims Sanctuary can pull, delete, download, or manage provider models. The remaining active match is true Ollama provider-model listing inside the egress proxy, plus tests proving removed routes stay absent.
- Phase C is still the right active implementation slice, and the current branch has removed the active duplicated Electrum/mempool defaults from runtime and UI paths. The remaining node/Electrum search matches are justified: admin `testnet*` legacy compatibility mapping in `server/src/api/admin/nodeConfigData.ts`, and separate price-provider mempool API defaults in `server/src/config/index.ts` and `server/src/services/price/providers/mempool.ts`.
- One Phase C implementation-gate gap was found and patched during this review: the shared node projection helper now rejects invalid pool load-balancing strings and non-positive singleton/pool integer projections instead of propagating impossible stored values.
- Phase D and Phase E remain the only follow-up phases after Phase C: repair or retire stale contract-test validators, then move login health probing behind a no-auth helper while keeping refresh as the raw-fetch recursion boundary.

### Sixth Review Adjustments

| Area | Review Result | Adjustment |
| --- | --- | --- |
| Phase C projection helper | Confirmed mostly converged, but invalid pool load-balancing strings and non-positive pool/singleton values were not fully fail-closed in the in-progress helper/runtime adapters. | Hardened the shared helper and runtime pool/node config readers to accept only canonical load-balancing values and positive integer connection values. Added shared helper coverage. |
| Admin node config save/load | Confirmed justified separate boundary. It still owns legacy `testnet*` fallback, encryption, redaction, and response compatibility. | Do not collapse this into the runtime projection helper. Keep explicit compatibility tests around it. |
| Price-provider mempool defaults | Confirmed false positive for Phase C. `MEMPOOL_API` and the price provider's `/api/v1/prices` default are price-service configuration, not Electrum/node projection. | Leave separate. Do not force price provider defaults through node external-service helpers. |
| Contract helper constants | Confirmed still open. `server/tests/helpers/contractValidation.ts` still hardcodes stale networks, transaction `self`, old draft statuses, and `psbt` instead of current `psbtBase64`. | Keep as Phase D and derive from live OpenAPI/shared constants or delete the helper. |
| Login health probe | Confirmed still open and low priority. Login still owns `fetch('/api/v1/health')`; refresh still owns raw `/auth/refresh` for a valid recursion-boundary reason. | Keep as Phase E after contract-helper repair. |

### Sixth Review Corner Cases

- Node projection should treat `false` SSL values as meaningful while rejecting non-positive or non-integer connection counts and ports at runtime projection boundaries.
- Invalid or unknown load-balancing strings should fall back to the network default rather than being cast into pool configuration.
- Admin node config compatibility code should remain explicit because it is also the secret encryption/redaction boundary; repeated legacy-field names there are not evidence of runtime projection drift.
- Price-provider defaults must stay decoupled from node external-service defaults so fee/explorer configuration changes do not unexpectedly change fiat price lookup behavior.
- Contract-helper repair should validate current draft response fields such as `psbtBase64` and current network values such as `testnet3`/`testnet4`; it should not refresh another local stale tuple.
- The login health helper should use shared API base URL rules without `apiClient`, add timeout/abort behavior, and preserve current `401`-as-connected behavior.

## Seventh Independent Review Addendum - 2026-05-15

Scope: independent double-check after Phase C merged and before Phase D implementation, re-validating the remaining findings against the current Phase D branch.

### Seventh Review Verdict

- The remaining queue still stands: Phase D contract-helper repair first, then Phase E no-auth login health helper.
- Phase A remains closed. A fresh production search found no broad `userRole !== 'viewer'` edit/send gates and no `wallet.canEdit !== false` fail-open wallet gates.
- Phase B remains closed. Current production script/wallet/account matches are canonical constants, intentional behavior domains, UI labels/examples, comments, Prisma/storage documentation, fixtures/tests, or the known stale contract helper. No active request/schema tuple reopened Phase B.
- Phase B2 is functionally closed: active pull/delete/system-resource AI routes remain absent and active user docs/UI/OpenAPI copy describes provider-reported model listing. One residual developer-facing comment still says `AI Model Management Routes` in `server/src/api/ai/models.ts`; clean it opportunistically, but it does not reopen the removed model-management surface.
- Phase C remains closed after merge. Remaining node/Electrum matches are justified adapter/UI field names, admin encryption/redaction and legacy `testnet*` compatibility, current shared node-config helpers, or separate price-provider mempool defaults.
- Phase D remains open and is stronger than a simple literal refresh. `server/tests/helpers/contractValidation.ts` still validates legacy `testnet`, transaction `self`, old draft statuses, and `psbt`, while live OpenAPI/server/shared contracts use `testnet3`/`testnet4`, `receive` where the public transaction schema allows it, `unsigned`/`partial`/`signed`, and `psbtBase64`.
- Additional Phase D scope: mobile-agent draft route/OpenAPI status schemas repeat the current `unsigned`/`partial`/`signed` tuple directly. That is current but still drift-prone; Phase D should derive those from `MOBILE_DRAFT_STATUS_VALUES` or the server draft status source while keeping wallet response `syncStatus` separate from sync pipeline statuses.
- Phase E remains valid and low priority. Login still owns a route-local raw `fetch('/api/v1/health')`; refresh still owns raw `/auth/refresh` for a justified recursion-boundary reason.

### Seventh Review Adjustments

| Area | Review Result | Adjustment |
| --- | --- | --- |
| Contract helper constants | Confirmed still stale. The helper's network, transaction, draft-status, and PSBT-field checks disagree with current OpenAPI/shared/server contracts. | Keep Phase D first. Derive retained validators from live sources or delete the helper in favor of OpenAPI-backed validation. |
| Mobile agent draft status tuple | Newly noted Phase D-adjacent drift. Route validation and OpenAPI schemas repeat the same current draft status values instead of deriving from the shared mobile draft status tuple. | Fold into Phase D if touching draft contract validators; add parity tests so mobile draft status updates cannot drift from shared/server draft status values. |
| Login health probe | Confirmed unchanged. Login still uses raw `/api/v1/health`; `refresh.ts` raw fetch remains justified by refresh recursion. | Keep Phase E after Phase D; implement a no-auth helper with base URL, timeout/abort, unmount-safety, and `401`-as-connected behavior. |
| AI model-management cleanup | Mostly closed with one minor residual comment. The only active non-test/non-plan "model management" match is a route file header, while removed route tests remain as negative coverage. | Opportunistically rename the comment to provider discovery/model listing; do not reopen a larger B2 phase. |
| Provider type duplication | Still a watch item. Backend, proxy, and frontend intentionally validate provider endpoints on different trust boundaries, but provider type strings remain repeated. | Add parity tests before introducing another provider; do not merge proxy/backend validation schemas across the security boundary. |

### Seventh Review Corner Cases

- Phase D should not globally accept `testnet`, `send`, or `receive`; each alias belongs only at the boundary whose live schema accepts it.
- Public transaction schema currently includes `receive`; persisted/sync transaction creation paths mostly use `sent`/`received`/`consolidation`, and confirmation helpers accept legacy/internal `send`/`receive`. Contract tests should assert the public schema they target rather than inventing one combined vocabulary.
- Draft contract repair should validate `psbtBase64`, nullable signed PSBT fields, current actionable statuses, empty recipients/signers arrays where the live schema permits them, BigInt balance strings, and nullable date fields.
- Mobile-agent draft status derivation should preserve the current accepted values and should not accidentally expose archived `broadcasted` drafts as actionable mobile review items.
- Login health helper tests should cover `200`, `401`, non-OK status, network rejection, timeout/abort, registration-status success/failure, and no state update after unmount or after a superseding check.
- The AI egress proxy remains a security boundary and true Ollama-specific provider detection/listing names can stay Ollama-specific; only generic or misleading "model management" wording should be removed.

## Eighth Independent Review Addendum - 2026-05-15

Scope: independent double-check after Phase D merged as PR #466, re-validating whether the prior findings are still accurate on `origin/main` and whether any non-hardware item besides Phase E remains.

### Eighth Review Verdict

- Phase D is closed, despite stale task-ledger wording that still called it active. Current `origin/main` is at `846e7663` (`Repair contract validation helpers`), and the contract helper now derives wallet/network/role/script/transaction/draft enum values from shared or OpenAPI sources.
- No completed follow-up phase reopened. Targeted production searches found no broad wallet `userRole !== 'viewer'` gates, no fail-open `wallet.canEdit !== false` gates, no unowned production wallet/script/account tuple definitions, no active model-management route or UI surface, and no stale contract-helper literals from the previous Phase D finding.
- Phase E remains the only reproducible non-hardware convergence item. `components/Login/useLoginFlow.ts` still owns `fetch('/api/v1/health')`, while `src/api/client.ts` and `src/api/refresh.ts` each own a local copy of the API base-URL rule.
- The Phase E plan should centralize base-URL resolution in a small API helper module imported by `client.ts`, `refresh.ts`, and the new no-auth health helper. This preserves refresh as a raw-fetch recursion boundary without preserving duplicated base URL code.
- Existing login tests cover health success, `401` as connected, non-OK status, registration-status failure, and network rejection at the component level, but they currently assert the raw `fetch('/api/v1/health')` behavior and lack timeout/abort/unmount coverage.
- Historical model-management wording remains in older plan docs and negative route tests only. Active source/docs/UI did not show a model-management surface that should reopen B2.

### Eighth Review Adjustments

| Area | Review Result | Adjustment |
| --- | --- | --- |
| Phase D contract helpers | Confirmed closed. `server/tests/helpers/contractValidation.ts` imports shared/OpenAPI enum sources, validates current transaction/draft shapes, and contract tests reject stale `testnet`, `self`, `pending`, and `psbt` cases. | Mark Phase D merged and do not reopen it. Keep contract helper generation/deletion as a future quality option only if another drift appears. |
| Phase E login health | Confirmed still open. Login still bypasses the API base URL helper and has no timeout/abort/unmount protection around the health probe. | Implement next. Add a no-auth health helper and update login tests away from raw-fetch expectations. |
| API base URL rule | Confirmed adjacent drift. `client.ts` and `refresh.ts` duplicate `VITE_API_URL` fallback logic today. | Extract a tiny `src/api/baseUrl.ts`-style helper; importing it from `refresh.ts` is acceptable because it is not `apiClient` and cannot trigger refresh recursion. |
| External LLM cleanup | Confirmed closed in active surfaces. Matches are historical plan text or negative tests proving removed routes stay absent. | Leave as history. Do not remove negative tests for deleted AI routes. |
| Completed role/script/node phases | Confirmed closed by scoped production searches. Remaining literal matches are canonical modules, behavior domains, UI labels/examples, comments, fixtures, or tests. | Do not reopen Phases A/B/C without new behavior evidence. |

### Eighth Review Corner Cases

- The health helper should not use `apiClient`, should not attach CSRF, should stay GET-only, and should treat only `2xx` and `401` as connected.
- Base URL joining should handle `/api/v1`, `/api/v1/`, and absolute `VITE_API_URL` values without producing double slashes or dropping a path segment.
- The login screen should fail predictably for network rejection, DNS/TLS/mixed-content failure, timeout, abort, and HTTP `503`.
- Registration-status lookup should run only after connected health and should still fall back to disabled registration if that second call fails.
- The hook should avoid state updates after unmount and after any later health check supersedes an earlier in-flight check.
- `src/api/refresh.ts` should remain a raw `fetch` caller for `/auth/refresh`; only the base URL helper should be shared.

## Phase E Closeout Addendum - 2026-05-15

Scope: closeout audit after Phase E PR #467 merged, verifying whether any non-hardware rationalization work remains besides the already-deferred physical hardware test.

### Phase E Closeout Verdict

- Phase E is closed. PR #467 merged as squash commit `0ff1cdaf80950946c120b7b141189d7c5ad75359`, and that merge commit was verified as an ancestor of `origin/main`.
- Login no longer owns a route-local `fetch('/api/v1/health')`. `components/Login/useLoginFlow.ts` now calls the no-auth `checkApiHealth` helper, which shares base URL rules with other direct API fetches.
- `src/api/client.ts`, `src/api/refresh.ts`, and `src/api/health.ts` now share `src/api/baseUrl.ts`; refresh remains a raw `fetch` recursion boundary and does not import `apiClient`.
- The PR initially failed the full frontend coverage merge gate. Local reproduction showed real branch coverage gaps for pre-aborted health probes and late login-hook rejection paths; added tests and an abort-helper simplification restored 100% merged frontend coverage.
- Final audit found no remaining active production raw login health fetch. Historical plan text still records earlier reviews where Phase E was open; those entries are preserved as history, not active queue state.

### Phase E Verification

- Local focused tests: API base URL, API health, API client, refresh, Login component, and login hook tests.
- Local gates: app typecheck, test typecheck, app lint, lizard quality gate, raw-health/base-URL negative search, and `git diff --check`.
- Coverage reproduction: fresh full frontend coverage shards plus merge at 100% statements, branches, functions, and lines.
- PR #467 CI: Architecture, Build Dev Images scope, Code Quality, Quick/Full frontend tests, full frontend typechecks, full frontend coverage shards/merge, browser E2E, render E2E, Full Test Summary, and PR Required Checks passed.

## Post-Phase-E Divergence Reanalysis Addendum - 2026-05-15

Scope: fresh scrub of current `main` after Phase E merged, focused on other login-style two-path patterns: duplicated runtime contracts, route/client splits, schema/value tuples, compatibility aliases, feature defaults, and security-boundary splits.

### Post-Phase-E Verdict

- The login health divergence stays closed. `src/api/client.ts`, `src/api/refresh.ts`, and `src/api/health.ts` share `src/api/baseUrl.ts`; refresh remains the only expected raw auth fetch boundary.
- No new hard behavior bug comparable to the mixed-case login path was found.
- The highest-value new consolidation candidates are lower-risk contract/value drift: feature flag env bindings, actionable draft status filters, AI provider type values, and transaction type alias boundaries.
- Gateway manifest versus validation schema remains justified for now because `gateway/tests/unit/middleware/validateRequest/validateRequest.devices-labels-routes.contracts.ts` checks manifest/schema parity. It can be converged later by deriving validation schemas from `GATEWAY_ROUTE_CONTRACTS`, but that is not urgent.
- Broad frontend API request/response interfaces still duplicate server/OpenAPI contracts. This is a known generated-client opportunity, not a narrow immediate fix, except where specific enums below make drift likely.

### Post-Phase-E Inventory

| Area | Evidence | Risk | Disposition |
| --- | --- | --- | --- |
| Login/health fetch path | `src/api/health.ts` owns no-auth health, `src/api/baseUrl.ts` owns base URL joins, `src/api/refresh.ts` keeps raw `/auth/refresh`. Targeted search found no active route-local login health fetch. | Closed prior bug class. | Keep closed |
| Feature flag env bindings | `server/src/config/features.ts` maps defaults to `FEATURE_*` env vars; `server/src/config/types.ts`, `server/src/config/schema.ts`, `server/src/services/featureFlags/definitions.ts`, and `server/src/services/featureFlagService.ts` repeat the key set. `server/tests/unit/config/features.test.ts` omits `FEATURE_TREASURY_AUTOPILOT` from its env key list and parse assertions even though production loads it. | A future flag can be defined but not reset/tested or not wired to env consistently. | Converge next |
| Draft actionable statuses | `server/src/repositories/draftRepository.ts` has canonical `ACTIONABLE_DRAFT_STATUSES`, but `server/src/repositories/agentRepository.ts` and `server/src/repositories/agentDashboardRepository.ts` still spell out `['unsigned', 'partial', 'signed']`; related tests assert the literal. | Low current behavior risk, but terminal `broadcasted` already made "actionable" versus "lifecycle" semantics important. | Converge small |
| AI provider type values | `server/src/services/ai/providerProfile.ts`, `server/src/api/ai/models.ts`, `server/src/api/openapi/schemas/ai.ts`, `src/api/ai.ts`, `src/api/admin/types.ts`, and `llm-egress-proxy/src/requestSchemas.ts` / `providerDetection.ts` all repeat `ollama` and `openai-compatible`. | Adding a provider can drift across frontend, backend, OpenAPI, and proxy validation/detection. | Converge or parity-test |
| Transaction type values and aliases | `shared/types/domain.ts` and OpenAPI include `receive`; persisted/sync paths mostly use `sent`/`received`/`consolidation`; list and console filters accept only canonical public filters; proxy natural-query normalizes `send`/`receive` aliases. | Compatibility aliases are legitimate, but the canonical persisted/public/alias sets are not named separately. | Watch; converge when touched |
| Gateway manifest versus request validation | `gateway/src/routes/proxy/whitelist.ts` owns route metadata; `gateway/src/middleware/validateRequest.ts` owns request schemas; parity tests enforce alignment. | Security boundary readability is acceptable; deriving everything now could make the trust boundary harder to audit. | Keep separate, guarded |
| Frontend API types versus server/OpenAPI | Many `src/api/*` interfaces duplicate backend response/request shapes. Some are already shared imports, but most remain handwritten. | Broad maintenance cost, but not a focused defect without specific enum drift. | Watch; consider generated client later |
| LLM egress proxy | Proxy is not a local AI/model container. It owns endpoint policy, provider egress isolation, proxy secret auth, credentials isolation, and sanitized-context routing. | Removing or over-sharing this would reduce security isolation. | Keep separate |

### Recommended Follow-Up Order

1. Feature flags: define a single feature flag env-binding table and derive `loadFeatureFlags` plus config tests from it. Cover `FEATURE_TREASURY_AUTOPILOT`, empty env fallback, numeric true, case-insensitive true/false, nested experimental flags, and unknown-key/admin OpenAPI parity.
2. Draft statuses: reuse `ACTIONABLE_DRAFT_STATUSES` in agent repository/dashboard filters and tests. Keep `broadcasted` out of actionable lists and keep public/mobile draft status enums aligned with `MOBILE_DRAFT_STATUS_VALUES`.
3. AI provider types: add explicit parity tests across server profile schema, server OpenAPI, frontend API types, and proxy schemas. Do not import shared workspace code into `llm-egress-proxy`; `scripts/ci/check-llm-egress-proxy-shared-isolation.sh` intentionally forbids that boundary crossing.
4. Transaction type vocabulary: introduce named constants for persisted transaction types, public transaction response types, filter types, and accepted aliases. Normalize aliases only at API/LLM/legacy boundaries; do not broaden DB writes to `send` or `receive`.
5. Generated API client: evaluate OpenAPI-generated frontend types only after the smaller enum/value cleanups, because this would touch a wide surface.

### Post-Phase-E Corner Cases

- Feature flag binding should support top-level and `experimental.*` keys without losing the `FeatureFlagKey` type safety currently provided by `FEATURE_DEFINITIONS: Record<FeatureFlagKey, ...>`.
- Feature flag tests should not depend on ambient shell env; every env var read by `loadFeatureFlags` must be reset or stubbed.
- Draft status reuse must preserve existing terminal-draft retention behavior: `broadcasted` is a lifecycle/archive state, not an actionable review/sign/broadcast state.
- AI provider type consolidation must preserve external Ollama support. "Ollama" remains a supported external provider type; unsupported Sanctuary-managed model install/delete stays removed.
- The LLM egress proxy should remain independently validating operator-provided endpoints. Parity checks are preferred over sharing constants across the proxy isolation boundary.
- Transaction alias handling should be directional: accept legacy or natural-language aliases at input boundaries, but emit canonical API values where routes already do so.

## Independent Review Of Post-Phase-E Findings Addendum - 2026-05-15

Scope: independent evidence check of the post-Phase-E addendum above, treating each recommendation as untrusted until rechecked against current `main`.

### Independent Review Verdict

- The ranked queue is directionally correct: feature flag env binding first, actionable draft status reuse second, AI provider type parity third, transaction vocabulary later.
- The only material correction is the AI provider recommendation. Because `llm-egress-proxy` is outside the root workspaces and `scripts/ci/check-llm-egress-proxy-shared-isolation.sh` forbids shared imports, the first fix should be parity tests and isolation-preserving local constants, not a shared tuple imported by the proxy.
- The login/health finding is confirmed closed. `components/Login/useLoginFlow.ts` calls `checkApiHealth`; `/auth/refresh` remains the intentional raw `fetch` path.
- The gateway split is confirmed justified. `GATEWAY_ROUTE_CONTRACTS` and `ROUTE_SCHEMAS` remain separate, and the validateRequest contract test checks every manifest route's validation mode against `findSchemaForRoute`.
- No active Sanctuary-managed AI image/container was found in compose. The only relevant stale wording found in this pass is a comment in `tests/install/utils/helpers.sh` mapping `sanctuary-llm-egress-proxy -> ai`; that is a low-priority comment cleanup, not a runtime container path.

### Independent Review Reclassification

| Finding | Review Result | Adjustment |
| --- | --- | --- |
| Feature flag env bindings | Confirmed. `server/src/config/features.ts` reads `FEATURE_TREASURY_AUTOPILOT`, but `server/tests/unit/config/features.test.ts` neither resets nor parses that env var. | Keep as next convergence candidate. Prefer an env-binding table or a parity test so this does not repeat for the next flag. |
| Draft actionable statuses | Confirmed. `ACTIONABLE_DRAFT_STATUSES` is canonical in `draftRepository`, while agent repository/dashboard paths still spell out the same tuple. | Keep as small second candidate. Import/reuse the constant where there is no repository cycle, and keep `broadcasted` terminal state excluded. |
| AI provider type values | Confirmed duplication, corrected implementation strategy. Provider values repeat across frontend, backend, OpenAPI, and proxy schemas. | Do parity tests first. Do not make the proxy depend on `@sanctuary/shared` unless the isolation guard is deliberately redesigned. |
| Transaction type values and aliases | Confirmed as watch. Public `Transaction` allows `receive`; list/console/proxy filters use `sent`/`received`/`consolidation`; natural query normalizes `send`/`receive`. | Leave after higher-value items. Add named value sets when transaction contracts are next touched. |
| Gateway manifest versus validation map | Confirmed keep-separate. The current parity test checks manifest validation decisions against route schemas. | Do not converge unless a gateway route change makes the separate maps painful again. |
| LLM egress proxy as security boundary | Confirmed. Compose contains `sanctuary-llm-egress-proxy:local`, not an AI model image, and the proxy has an explicit shared-import isolation guard. | Keep. Fix stale "ai" comment opportunistically with installer/test docs cleanup. |

### Independent Review Corner Cases

- Feature flag tests should delete/stub every env variable read by `loadFeatureFlags`; otherwise a developer or CI host env can make the "defaults when unset" test lie.
- Feature flag convergence should also preserve existing side-effect metadata and admin OpenAPI enum derivation from `FEATURE_FLAG_KEYS`.
- AI provider parity should compare the server provider profile tuple, public AI detection OpenAPI enum, frontend API type assumptions where practical, and proxy request/detection accepted values.
- Proxy isolation is a security property, not just packaging. Any future shared-provider-constants design must explicitly replace or amend `check-llm-egress-proxy-shared-isolation.sh`.
- Earlier compose and image searches showed no live AI container in the main compose inventory. A later post-Phase-I review found active offline/install script references to an `ai` service; those are tracked under Phase L deploy/inventory drift.

## Plan Detail Review Addendum - 2026-05-15

Scope: tighten the optional post-Phase-E convergence queue before implementation, with emphasis on sequence, guardrails, and corner cases that could turn a small cleanup into behavior drift.

### Plan Detail Verdict

- The plan remains correctly ranked. The next useful non-hardware work, if we choose to keep cleaning up, is feature flag env-binding convergence, then draft actionable status reuse, then AI provider type parity tests, then transaction vocabulary naming.
- No new login-class hard bug was found. These items are maintenance and drift-prevention work, not emergency production fixes.
- The main correction to carry forward is still the proxy boundary: keep `llm-egress-proxy` independent and prove parity from tests or scripts instead of importing shared workspace constants into proxy runtime code.
- The first two follow-ups can be implemented without product decisions. AI provider changes require a product decision only if we add or remove a supported provider type. Transaction vocabulary should wait until transaction API/storage code is otherwise being touched.

### Implementation Detail By Follow-Up

| Follow-Up | Added Plan Detail | Verification To Require |
| --- | --- | --- |
| Feature flag env bindings | Introduce one typed binding source for feature key to env var mapping, including nested `experimental.*` keys. Derive `loadFeatureFlags` from it or add a parity test that fails when `loadFeatureFlags` reads an env var not covered by tests. Include `FEATURE_TREASURY_AUTOPILOT`, which production reads today but the unit test env list omits. Preserve `FEATURE_DEFINITIONS`, `FEATURE_FLAG_KEYS`, side-effect metadata, and admin/OpenAPI enum derivation. | Focused `server/tests/unit/config/features.test.ts`; parity assertion that every binding key is in `FEATURE_DEFINITIONS`; defaults test with all bound env vars deleted; parse test for `true`, `TRUE`, `1`, `false`, `FALSE`, `0`, empty string, and unset. |
| Draft actionable statuses | Reuse `ACTIONABLE_DRAFT_STATUSES` for agent funding sums and dashboard pending draft queries. If importing from `draftRepository.ts` creates an undesirable repository cycle, extract draft status constants to a small repository/domain constants module and have all three repositories import that. Keep `BROADCASTED_DRAFT_STATUS` available only for lifecycle/archive paths. | Focused agent repository/dashboard tests; a negative assertion that `broadcasted` is not included in pending/actionable counts; `git diff --check`; typecheck if constants move. |
| AI provider type values | Add an isolation-preserving parity check across `server/src/services/ai/providerProfile.ts`, server OpenAPI AI schemas, frontend API provider type assumptions, and proxy validation/detection values. Do not import `@sanctuary/shared` or server code into `llm-egress-proxy/src`. Keep legacy route names such as `/detect-ollama` only as compatibility route names while response/provider values remain provider-generic. | Existing proxy isolation guard; focused server OpenAPI/provider-profile tests; focused frontend AI API/type tests where practical; proxy request schema and provider detection tests. |
| Transaction type vocabulary | When touched, introduce named value sets for persisted transaction types (`sent`, `received`, `consolidation`), public response compatibility types where `receive` is still accepted/emitted, filter types, and input alias values (`send`, `receive`). Keep alias normalization at API, LLM, or legacy boundaries only. | Contract tests around transaction list/filter schemas; sync/persistence tests proving DB writes stay canonical; proxy natural-query tests proving aliases normalize to canonical filters. |
| Stale LLM proxy comment | Clean the installer helper comment that still maps `sanctuary-llm-egress-proxy -> ai` so the install/testing docs match the renamed security boundary. Later post-Phase-I review supersedes this comment-only framing for active offline/install service-name references, now tracked under Phase L. | `git diff --check`; installer-helper shell tests only if the surrounding script behavior changes. |

### Additional Corner Cases

- Feature flag binding should not read `process.env` at module import time in a way that makes tests or runtime reloads stale; `loadFeatureFlags()` should continue to reflect the current environment when called.
- Feature flag parsing should document and preserve today's semantics: only case-insensitive `true` and exact numeric `1` enable a flag; all other non-empty values, including `0`, `false`, and invalid strings, resolve to `false`.
- Feature flag convergence should not accidentally turn unknown env vars into accepted feature keys. Unknown flags should remain invisible unless a matching `FeatureFlagKey`, default, definition, and binding are added together.
- Draft status reuse must account for readonly tuples versus Prisma `in` arrays; callers may need to spread constants into a mutable array at the query site.
- Draft dashboard counts combine actionable status with expiration filtering. The status cleanup must not change the `expiresAt: null OR expiresAt > now` behavior.
- Agent funding sums should keep their time-window semantics. Reusing the status constant must not widen `createdAt >= since` or include rejected/expired drafts by accident.
- AI provider parity should treat `ollama` as an external provider value, not as evidence of a Sanctuary-managed model runtime. External Ollama support stays supported.
- AI provider parity should include both request and response schemas. It is not enough to check only detection request `preferredProviderType`; response `providerType` must stay in sync too.
- Proxy provider detection order is behavior. A parity test should not reorder `openai-compatible` and `ollama` unless a product decision explicitly changes default detection precedence.
- Transaction alias cleanup should not change persisted historical rows in place. If historical `receive` rows exist, compatibility should be handled by read/normalization code or an explicit migration plan, not by silently broadening new writes.
- Transaction filter semantics are amount-sensitive in the UI: `received` filters positive non-consolidation rows and `sent` filters negative non-consolidation rows. Shared value constants must not collapse these UI semantics into simple string equality everywhere.
- The gateway manifest/schema split should remain out of this queue unless its parity test fails or a route change shows the separate maps are causing drift.

## Phase F Implementation Addendum - 2026-05-15

Scope: implement the first optional post-Phase-E convergence slice by centralizing feature flag env bindings and making tests/service flattening derive from the same table.

### Phase F Status

- `server/src/config/features.ts` now owns `FEATURE_FLAG_ENV_BINDINGS` and `FEATURE_FLAG_ENV_KEYS`.
- `loadFeatureFlags()` derives all env parsing from `FEATURE_FLAG_ENV_BINDINGS`, including `FEATURE_TREASURY_AUTOPILOT`.
- `flattenFeatureFlags()` and `getFeatureFlagValue()` are exported from config so feature flag service fallback/reset logic does not maintain separate top-level and experimental key lists.
- `server/src/services/featureFlagService.ts` now uses `flattenFeatureFlags()` for database initialization and `getFeatureFlagValue()` for environment fallback and reset-to-default behavior.
- `server/tests/unit/config/features.test.ts` now derives env cleanup from `FEATURE_FLAG_ENV_KEYS` and asserts binding keys equal `FEATURE_FLAG_KEYS`, so future feature definitions cannot miss env-reset/default parsing coverage silently.

### Phase F Edge Cases Covered

- Default loading with every bound feature env var deleted.
- Boolean parsing for `true`, `TRUE`, `1`, `false`, `FALSE`, `0`, empty string, and unset defaults.
- `FEATURE_TREASURY_AUTOPILOT` parse and reset coverage.
- Runtime env reread behavior: `loadFeatureFlags()` reflects current `process.env` values on each call instead of snapshotting env at module import.
- Experimental keys stay flattened as `experimental.*` while preserving nested config storage.
- Unknown top-level and experimental keys still fail closed to `false` in defensive service fallbacks.

### Phase F Local Verification

- `npm --prefix server run test:run -- tests/unit/config/features.test.ts tests/unit/services/featureFlagService.test.ts tests/unit/services/featureFlags/definitions.test.ts`
- `npm --prefix server run typecheck:tests`
- `npm --prefix server run build`
- `npm run quality:lizard -- --files server/src/config/features.ts server/src/services/featureFlagService.ts`
- `npm run lint:server`
- PR #469 passed Architecture, Build Dev Images, Code Quality, backend coverage, Full Test Summary, and PR Required Checks, then squash-merged as `7997a3d851c5a5f5e122a5464c4c9afbad6aad4c`.

## Phase G Implementation Addendum - 2026-05-15

Scope: implement the second optional post-Phase-E convergence slice by reusing canonical draft actionable statuses in agent funding and dashboard repository paths.

### Phase G Status

- `server/src/repositories/agentRepository.ts` now uses `ACTIONABLE_DRAFT_STATUSES` for `sumAgentDraftAmountsSince()` instead of spelling out `unsigned` / `partial` / `signed`.
- `server/src/repositories/agentDashboardRepository.ts` now uses `ACTIONABLE_DRAFT_STATUSES` for pending funding draft dashboard counts instead of a dashboard-local tuple.
- Repository tests now assert the canonical tuple is used and `BROADCASTED_DRAFT_STATUS` remains excluded from agent funding sums and dashboard pending counts.
- PR #470 passed Forgejo CI and was squash-merged as `818f55bae21e0dbf979946c84e6c4dc6ae852856`.

### Phase G Edge Cases Covered

- `broadcasted` remains a terminal/archive lifecycle status, not an actionable funding or dashboard-pending state.
- Dashboard pending draft counts preserve their existing expiration filter: drafts count only when `expiresAt` is `null` or later than `now`.
- Agent funding sums preserve their existing time-window filter: `createdAt >= since` is unchanged.
- Prisma `in` filters still receive mutable arrays by spreading the readonly tuple at query sites.

### Phase G Local Verification

- `npm --prefix server run test:run -- tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/agentDashboardRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/repositories/maintenanceRepository.audit.test.ts`
- `npm --prefix server run typecheck:tests`
- `npm --prefix server run build`
- `npm run quality:lizard -- --files server/src/repositories/agentRepository.ts server/src/repositories/agentDashboardRepository.ts`
- `npm run lint:server`
- Scoped negative search confirmed the only remaining `['unsigned', 'partial', 'signed']` tuple in the touched repository paths is the canonical `ACTIONABLE_DRAFT_STATUSES` definition.
- `git diff --check`
- PR #470 passed Architecture, Build Dev Images, Code Quality, backend coverage, Full Test Summary, and PR Required Checks.

## Phase H Plan Review Addendum - 2026-05-15

Scope: implementation-readiness review for AI provider type parity after Phase G merged. The goal is to remove provider-value drift without weakening the `llm-egress-proxy` security boundary or changing the supported provider set.

### Phase H Verdict

- Phase H should proceed as a narrow parity cleanup. The supported provider values remain exactly `ollama` and `openai-compatible`.
- Server runtime/API/OpenAPI paths should derive from the server provider profile tuple in `server/src/services/ai/providerProfile.ts`; route-local and OpenAPI-local provider enum arrays should not remain independent.
- Frontend API types should use one frontend-local provider tuple/type, likely in `src/api/admin/types.ts`, and `src/api/ai.ts` should import that type instead of restating the union.
- The proxy should not import `@sanctuary/shared`, server code, or frontend code. It should own a proxy-local provider tuple and use tests plus `scripts/ci/check-llm-egress-proxy-shared-isolation.sh` to prove parity and boundary preservation.
- Detection order is behavior, not just data. The current default order, `openai-compatible` before `ollama`, should remain stable unless a product decision changes default detection precedence.

### Phase H Implementation Detail

| Area | Plan Detail | Corner Cases |
| --- | --- | --- |
| Server provider tuple | Keep `AI_PROVIDER_TYPES` as the server canonical tuple. Import it into `server/src/api/ai/models.ts` for `ProviderTypeSchema`, into `server/src/api/openapi/schemas/ai.ts` for `AIDetectProviderRequest.preferredProviderType` and `AIDetectProviderResponse.providerType`, and into server AI response/input types where doing so removes literal unions without broad refactors. | Do not change the public wire values, defaults, admin provider-profile schema, or saved profile parsing. Mixed-case provider type strings should remain invalid API enum values; UI labels can be friendly, but wire values are exact lowercase identifiers. |
| Frontend provider type | Add an exported frontend-local `AI_PROVIDER_TYPES` tuple and derive `AIProviderType` from it in `src/api/admin/types.ts`. Use `AIProviderType` in `src/api/ai.ts` detection request/response interfaces. | Avoid importing server code into the frontend just for a type. Type-only imports between frontend API modules are acceptable; runtime bundle behavior should not change. |
| Proxy provider type | Add a proxy-local provider type module or exported tuple in `llm-egress-proxy/src` and reuse it in `requestSchemas.ts` and `providerDetection.ts`. Keep `PROVIDER_DETECTION_ORDER` separate but type-checked against the provider tuple. | Preserve the isolation guard. Do not import shared/server/frontend modules into the proxy. `ConfigBodySchema.providerType` currently accepts a generic string for synced runtime config; only tighten it if all config-route tests and compatibility expectations show that invalid provider config should be rejected there too. |
| Request/response schema parity | Cover both request and response provider enums: server route validation, server OpenAPI request enum, server OpenAPI response enum, frontend request/response type assumptions, proxy detection request schema, and proxy detection response/detection-order types. | A test that checks only `preferredProviderType` is insufficient; response `providerType` can drift independently. Unknown, empty, null, and mixed-case provider values should be rejected by typed detection schemas. |
| Test placement and coverage isolation | Keep parity assertions package-local where possible: server tests may import server/OpenAPI provider tuples, proxy tests may import proxy provider tuples, and frontend tests/typechecks may import frontend API types. Do not import server runtime modules from root/frontend Vitest coverage just to compare constants. | Frontend coverage uses root Vitest and can instrument imported runtime files. A cross-runtime parity test that imports `server/src/services/ai/providerProfile.ts` can drag server credential/encryption code into the frontend coverage threshold and fail CI even when frontend behavior is unchanged. |
| Legacy route names | Keep `/ai/detect-ollama` and proxy `/detect-ollama` as compatibility route names for explicit Ollama discovery. Keep `/ai/detect-provider` and proxy `/detect-provider` as provider-generic discovery. | Route names must not imply Sanctuary-managed model pull/delete support. Phase H should not reintroduce model-management routes, download progress, system-resource readiness, or "installed models" copy. |
| Provider detection behavior | Keep endpoint policy checks before probing and keep blocked endpoints returning blocked errors instead of model-list attempts. Keep API keys optional and scoped to the detection/config request that needs them. | A preferred provider should be tried first only when it is a supported exact provider value; unsupported preferences should fall back to the default order instead of causing a failed or single-provider probe. |

### Phase H Verification Plan

- Server focused tests: provider profile domain tests, AI detection route contract tests, OpenAPI AI schema/contract tests, and server typecheck/build.
- Frontend focused checks: AI API/admin type tests where existing coverage exists, plus `npm run typecheck:app` and `npm run typecheck:tests`. Root frontend coverage must not import server AI runtime modules for parity checks.
- Proxy focused tests: `tests/llm-egress-proxy/requestSchemas.test.ts`, `tests/llm-egress-proxy/providerDetection.test.ts`, `tests/llm-egress-proxy/providerModels.test.ts` if provider typing changes list behavior, and `npm --prefix llm-egress-proxy run build`.
- Boundary guard: `bash scripts/ci/check-llm-egress-proxy-shared-isolation.sh`.
- Coverage guard: regenerate both frontend coverage shards and merge them when a root test imports or stops importing boundary-adjacent modules, using an isolated `SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR` if local `coverage-shards/` has stale ownership.
- Quality gates: touched-file lizard for changed logic, scoped negative search for unowned provider tuples in production paths, and `git diff --check`.

### Phase H Deferred Or Rejected

- Do not add or remove provider types in this phase. That requires a product/API decision and expanded tests.
- Do not collapse the proxy/backend trust boundary into a shared runtime schema just to eliminate a duplicated tuple.
- Do not rename compatibility route paths such as `/detect-ollama` unless a separate route migration and client compatibility plan is approved.
- Do not broaden persisted provider type storage to unknown strings. Unknown stored provider profile values should remain invalid and fall back through existing profile parsing behavior.

## Phase H Implementation Addendum - 2026-05-15

Scope: implement AI provider type parity while keeping one provider tuple per runtime boundary and preserving `llm-egress-proxy` as an independently validating security boundary.

### Phase H Status

- `server/src/api/ai/models.ts` now derives `ProviderTypeSchema` from `AI_PROVIDER_TYPES` instead of a route-local enum array.
- `server/src/api/openapi/schemas/ai.ts` now derives both `AIDetectProviderRequest.preferredProviderType` and `AIDetectProviderResponse.providerType` enums from `AI_PROVIDER_TYPES`.
- `server/src/services/ai/types.ts` and `server/src/services/ai/features.ts` now type provider detection/config values with the server `AIProviderType`.
- `src/api/admin/types.ts` now exports a frontend-local `AI_PROVIDER_TYPES` tuple and derives `AIProviderType` from it; `src/api/ai.ts` reuses that type for detection request/response contracts.
- `llm-egress-proxy/src/providerTypes.ts` now owns the proxy-local provider tuple, type guard, and detection order; proxy request schemas and detection logic reuse those values without importing shared/server/frontend code.
- Added package-local parity/regression tests proving server/OpenAPI provider values and proxy provider schema/order values stay aligned while preserving OpenAI-compatible-first detection order. Frontend provider reuse is guarded by app/test typechecks so root frontend coverage does not import server runtime modules.

### Phase H Edge Cases Covered

- Mixed-case and unsupported provider detection preferences are rejected before server-to-proxy detection.
- Proxy detection falls back to the default detection order for unsupported optional preferences and preserves exact preferred-provider-first behavior for supported values.
- Proxy provider detection order remains complete and explicit: `openai-compatible` is tried before `ollama` by default.
- Public AI detection request and response OpenAPI enums are both checked against the server provider tuple.
- The proxy shared-import isolation guard remains green; provider parity is proven by tests instead of cross-boundary runtime imports.
- Root frontend coverage no longer imports server AI provider profile/OpenAPI modules for parity checks; those checks stay in server-side tests to avoid pulling server credential/encryption files into the frontend coverage denominator.
- Legacy `/detect-ollama` compatibility route names remain unchanged, and no model-management route or copy was reintroduced.

### Phase H Local Verification

- `npm --prefix server run test:run -- tests/unit/services/aiProviderProfile.test.ts tests/unit/api/ai.test.ts`
- `npm run test:run -- tests/llm-egress-proxy/requestSchemas.test.ts tests/llm-egress-proxy/providerDetection.test.ts`
- `npm --prefix llm-egress-proxy run build`
- `npm run typecheck:app`
- `npm run typecheck:tests`
- `npm --prefix server run typecheck:tests`
- `npm --prefix server run build`
- `npm --prefix llm-egress-proxy run test`
- `npm run lint:app`
- `npm run lint:server`
- `npm run quality:lizard -- --files server/src/api/ai/models.ts server/src/api/openapi/schemas/ai.ts server/src/services/ai/types.ts server/src/services/ai/features.ts src/api/admin/types.ts src/api/ai.ts llm-egress-proxy/src/providerTypes.ts llm-egress-proxy/src/providerDetection.ts llm-egress-proxy/src/requestSchemas.ts`
- `bash scripts/ci/check-llm-egress-proxy-shared-isolation.sh`
- Fresh frontend coverage reproduction after removing the cross-runtime root parity test:
  - `SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR=.tmp/phase-h-coverage/rerun-shard-1-2 npm run test:coverage:shard -- 1 2`
  - `SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR=.tmp/phase-h-coverage/rerun-shard-2-2 npm run test:coverage:shard -- 2 2`
  - `npm run test:coverage:merge` passed at 100% statements, branches, functions, and lines.
- Scoped provider tuple search confirmed only the intended server, frontend, and proxy tuple owners remain in production paths.
- `git diff --check`

## Phase I Implementation Addendum - 2026-05-15

Scope: split transaction type domains without changing stored values, public response compatibility, or the LLM egress proxy isolation boundary.

### Phase I Status

- Added `shared/constants/transactions.ts` as the canonical shared owner for persisted transaction values (`sent`, `received`, `consolidation`), public response compatibility values including legacy `receive`, pending transaction values, and `send`/`receive` alias normalization.
- `shared/types/domain.ts`, root frontend transaction types, server repository filter types, assistant read-tool input schemas, and transaction OpenAPI schemas now derive from the appropriate shared transaction value domain.
- The LLM egress proxy now owns proxy-local transaction filter constants and alias normalization in `llm-egress-proxy/src/transactionTypes.ts`; it still imports no shared/server/frontend runtime modules.
- Console/natural-query paths normalize legacy or natural-language `send`/`receive` aliases to `sent`/`received` before returning transaction filters. Frontend route-state parsing continues to accept only canonical filter values.

### Phase I Edge Cases Covered

- Public API response compatibility still accepts `receive`; this phase does not migrate or remove that public value.
- Storage/repository filters and assistant tool calls use only `sent`, `received`, and `consolidation`.
- Pending transaction schemas remain limited to `sent` and `received`; `consolidation` and legacy aliases are not pending transaction values.
- `self` remains rejected by contract validators.
- Proxy alias handling remains independent from shared code so the egress security boundary stays intact.

### Phase I Local Verification

- `npm run test:run -- tests/shared/transactionTypes.test.ts tests/src/app/consoleTransactionNavigation.test.ts tests/llm-egress-proxy/naturalQuery.test.ts tests/llm-egress-proxy/consoleProtocol.test.ts`
- `npm run test:run -- tests/components/WalletDetail/hooks/useAITransactionFilter.test.ts tests/components/AIQueryInput.test.tsx`
- `npm --prefix shared run build`
- `npm --prefix server run test:run -- tests/contract/api.contract.test.ts`
- `npm --prefix llm-egress-proxy run build`
- `npm run typecheck:app`
- `npm run typecheck:tests`
- `npm --prefix server run typecheck:tests`
- `npm --prefix server run build`
- `npm --prefix llm-egress-proxy run test`
- `npm run lint:app`
- `npm run lint:server`
- `npm run quality:lizard -- --files shared/constants/transactions.ts shared/types/domain.ts types/index.ts src/api/transactions/types.ts src/app/consoleTransactionNavigation.ts server/src/api/openapi/schemas/transactions.ts server/src/assistant/tools/walletReadTools.ts server/src/repositories/types.ts llm-egress-proxy/src/transactionTypes.ts llm-egress-proxy/src/naturalQuery.ts llm-egress-proxy/src/consoleProtocolIntents.ts`
- `bash scripts/ci/check-llm-egress-proxy-shared-isolation.sh`
- Scoped transaction literal search confirmed no unowned production `sent`/`received`/`consolidation`, `sent`/`received`, or stale `send`/`receive` filter tuples remain outside canonical owners and tests.
- `git diff --check`

### Phase I Merge Closeout

- PR #472 passed Forgejo Architecture, Build Dev Images scope, Code Quality, Test Suite full lanes including frontend coverage merge, Full Test Summary, and PR Required Checks.
- PR #472 squash-merged as `a36b044dc59f0e0af0f5f1ab63e19e9510d57be8`.
- Post-merge verification confirmed the platform merge commit exists locally and is an ancestor of `origin/main`.

## Post-Phase-I Divergence Reanalysis Addendum - 2026-05-15

Scope: re-scrub current `main` after Phase I, looking for other login-style divergences: duplicated value contracts, route validation paths that disagree with OpenAPI, client helpers that bypass central API behavior, stale compatibility events, deployment/runtime contract drift, and justified security or compatibility splits. This addendum does not reopen Phases A-I.

### Post-Phase-I Verdict

- Completed rationalization phases stay closed. Login health lookup, feature flags, actionable draft statuses, AI provider parity, transaction type boundaries, wallet roles, wallet identity, Bitcoin networks, and node projection constants remain materially better than the earlier baseline.
- The remaining highest-risk divergences are not auth-session forks, but they are the same pattern: a public contract or runtime default exists in two places and one side can silently do something different.
- Worth consolidating first after the already-merged J/K/L/M/M2 work: websocket event/channel/client-message/broadcast ownership and a small frontend API hygiene pass.
- UTXO selection strategies are still duplicated, but a second review found no current behavior drift because route validation and service comparison enumerate the same set. Treat this as a lower-priority coin-control follow-up rather than a top standalone phase.
- Mostly justified or watch-only: raw refresh fetch, root `/health` versus `/api/v1/health`, LLM egress proxy/backend validation split, gateway route manifest versus request-schema map, device roles versus wallet roles, wallet owner-only UI checks versus edit-capable UI checks, and compatibility barrels.
- Broad generated frontend API types remain a future project. The current recommendation is to fix specific drift-prone contracts first instead of starting a wide generated-client migration.

### Post-Phase-I Inventory

| Area | Evidence | Risk | Disposition |
| --- | --- | --- | --- |
| Sync priority values and validation | Pre-Phase-J drift was repeated `high`/`normal`/`low` values plus route validation that accepted unknown/malformed bodies despite a closed OpenAPI request object. PR #474 added `shared/constants/sync.ts` and derived frontend, server route, OpenAPI, queue, worker, and BullMQ behavior from it. | Closed. Invalid priority, null, arrays, malformed bodies, and extra fields no longer enter queue/runtime code. | Converged in Phase J |
| Mempool estimator values and defaults | Pre-Phase-K drift was split `mempool_space` versus `simple` defaults across runtime/admin/frontend/OpenAPI paths. PR #475 added canonical estimator values/defaults in shared node config constants and derives admin validation, no-config response defaults, frontend defaults/options, OpenAPI, and runtime fallback from them. | Closed. Missing/null values default to `mempool_space`, explicit `simple` remains valid, and invalid admin request values fail validation. | Converged in Phase K |
| Gateway runtime and deploy contracts | Phase L aligned gateway listener env handling with compose (`PORT` with `GATEWAY_PORT` compatibility), backend defaults with `backend:3001`, and push credential loading with mounted FCM/APNs files plus deterministic env overrides. | Closed. Remaining risk is operational: deployment environments must still provide the needed secrets and mounted files. | Converged in Phase L |
| Prebuilt/offline compose and image inventory | Phase L documented `docker-compose.ghcr.yml`/release publishing as intentionally reduced to frontend/backend web-core images, while the offline bundle keeps gateway and LLM egress proxy core images. Active install/upgrade `ai` service references were replaced with `llm-egress-proxy`. | Closed. Prebuilt reduced/core behavior is now an explicit deploy decision rather than an accidental inventory split. | Converged in Phase L |
| Transfer route validation | Phase M derives transfer route validation from service resource/role/status constants and uses typed closed create/decline schemas that match OpenAPI. Invalid query filters now fail route validation instead of being ignored or cast through. | Closed. Malformed transfer filters and request bodies fail before service handling, with the documented >30-day expiry service cap preserved. | Converged in Phase M |
| UTXO selection route validation | Pre-Phase-M2 drift was route validation that presence-checked `amount` before `BigInt(amount)` and accepted `scriptType` as `z.unknown()` while OpenAPI documented typed, closed request bodies. PR #478 added positive safe-integer amount parsing, non-empty string `scriptType` validation, strict select/compare bodies, and a separate compare-strategies request schema. | Closed. Malformed amounts, malformed `scriptType`, extra fields, and select-only `strategy` input on compare now fail route validation before service calls. | Converged in Phase M2 |
| Websocket protocol ownership | `shared/types/websocket.ts` says it is the single source of truth for WebSocket message types, but shared `ClientMessage` omits `subscribe_batch` and `unsubscribe_batch`; `services/websocket.ts` sends those batch messages, and `server/src/websocket/schemas.ts` validates them separately. `services/websocket.ts` also has a separate `WebSocketEventType` union including stale `modelDownload`, while frontend hooks and server channel fanout duplicate `blocks`, `sync:all`, `transactions:all`, `logs:all`, and wallet channel strings. Server broadcasts are also split between typed `EventBuilders`/gateway forwarding in `server/src/websocket/broadcast.ts` and notification broadcasts that construct `WebSocketEvent` directly and broadcast only through the local WebSocket server. | Dead model-download typing survived model-management removal; client-message schemas, channel strings, event construction, and gateway forwarding behavior can drift between shared types, frontend senders/subscriptions, server validation/fanout, and notification broadcasts. | Converge |
| Payjoin status naming | API status is `{ enabled, configured }` in `src/api/payjoin.ts`; send-attempt state is also called `PayjoinStatus` in `hooks/send/usePayjoin.ts` and repeats inline in `contexts/send/types.ts`; receive-modal data locally redeclares API-shaped status. | Same name means different domains, which invites wrong imports and muddles receive-versus-send behavior. | Converge small |
| API query parameter construction | Several `src/api/*` modules build manual `URLSearchParams` or interpolate query strings instead of using `apiClient.get(..., params)`: devices, admin backup, admin features, intelligence, plus adjacent simple query interpolation in monitoring/settings APIs. `src/api/client.ts` also has duplicate internal query builders for generic requests versus GET requests. | Null/undefined handling and encoding rules can diverge from the central client path that Phase E just standardized for base URLs. | Converge small |
| Frontend/shared API response type duplicates | `src/api/price.ts`, `src/api/sync.ts`, and `src/api/bitcoin.ts` repeat shapes that already exist in `shared/types/api.ts`. | Type-only drift risk. No current behavior difference confirmed. | Converge opportunistically |
| UTXO selection strategies | Strategy values repeat in `shared/types/domain.ts`, `server/src/api/transactions/coinSelection.ts`, `server/src/services/utxoSelectionService/types.ts`, `server/src/services/utxoSelectionService/index.ts`, transaction OpenAPI schemas, and tests. | Adding/removing a strategy can leave route validation, OpenAPI, service compare results, and frontend types out of sync. No current strategy value drift found, and the current route validates invalid strategies. | Watch; converge with next coin-control work |
| PSBT parsing/magic helpers | PSBT checks are implemented in `utils/urPsbt.ts`, `hooks/send/useQrSigning.ts`, QR signing file/scan helpers, and draft list helpers. | Some accepted encodings are intentionally different. Consolidating too broadly can change QR/file/import behavior. | Watch; extract only low-level predicates when touched |
| Admin agent statuses and severities | Agent status, alert severity/status, and funding override status repeat across frontend admin types, server route schemas, OpenAPI schemas/paths, and admin service types. | No confirmed drift, but active admin contracts can split when statuses expand. | Watch or converge with next agent-admin work |
| Server LLM egress env bindings | Central server config exposes `llmEgressProxyUrl`/`llmEgressProxySecret`, while AI config sync and egress proxy auth helpers read `process.env` directly. | Deployment env parsing can drift; security boundary remains justified. | Converge accessor or remove unused central fields |
| Device roles | `owner`/`viewer` repeats in shared domain, server device access, events, OpenAPI, and tests. | No drift found; device roles are intentionally a smaller domain than wallet roles. | Keep separate from wallet roles; low-priority shared tuple only if device roles expand |
| RBF statuses and privacy grades | RBF and privacy grade values repeat in shared types, OpenAPI, services, UI, and tests. | Stable value sets with existing behavior coverage. | Watch; fold into transaction constants if transaction state work resumes |
| Price providers | Server owns provider registry/defaults; frontend currency settings keep a fallback provider list for offline UI. | Offline fallback can stale if server providers change, but the runtime registry is correctly server-owned. | Watch |

### Recommended Follow-Up Order

| Phase | Work | Verification | Exit Criteria |
| --- | --- | --- | --- |
| J | Centralize sync priority values and defaults. Add one `SYNC_PRIORITY_VALUES` and `DEFAULT_SYNC_PRIORITY` owner, derive frontend API types, server API validation, OpenAPI, service queue types, worker job types, and BullMQ priority conversion. Reject invalid HTTP priorities or deliberately normalize them to `normal`; do not keep the current unvalidated cast. Align malformed-body and extra-field behavior with OpenAPI's closed request object or document a compatibility exception. | Sync route tests for absent/null/invalid priorities, malformed bodies, and extra fields, sync queue ordering tests, worker/BullMQ mapping tests, OpenAPI enum/additionalProperties test, app/server typechecks, `git diff --check`. | Merged via PR #474 as `13ef9b5c62b83d2e6f23625b656e40c1b2f9f93c`. |
| K | Centralize mempool estimator values and default. Add estimator constants/default to shared node config constants or the existing node-config owner, then derive admin validation, no-config admin response defaults, OpenAPI, frontend defaults, runtime mempool fallback, and tests. | Admin node config read/update/no-config tests, mempool config tests, NodeConfig UI tests, OpenAPI admin contracts, negative search for local estimator tuples/defaults outside the canonical owner, Prisma schema/migration storage defaults, and tests. | Merged via PR #475 as `a781c8ee768a55a5688021af4b801545a90f5bcc`. |
| L | Repair gateway runtime/deploy contract drift. Align port env naming, backend default URLs, push credential file/env behavior, documented push enable flags, `APNS_PRODUCTION`, gateway README/architecture docs, compose, prebuilt publish inventory, and offline/install service-name inventory. Decide whether prebuilt deploy must include gateway/proxy images or be labeled as reduced/core. | Gateway config tests, FCM/APNs startup tests using env/file credentials and stale enable-flag cleanup/negative-search cases, APNs production-flag tests, `docker compose config --services` for source and ghcr overlays, setup/offline bundle/image classification tests, and release digest/notify/artifact verification updates if image inventory changes. | Merged via PR #476 as `2f92b7d87f1bea812d776b5b1f3ac2e2a334af85`. |
| M | Align transfer route validation with transfer constants and OpenAPI. Reuse `TRANSFER_*_VALUES` in list filter parsing, validate transfer create body types for `resourceId`, `toUserId`, `message`, `keepExistingUsers`, and `expiresInDays`, validate decline `reason`, and decide whether invalid filters should return 400 or preserve ignored-filter compatibility with an explicit parser. | Transfer collection tests for valid/invalid role/status/resource filters, transfer create tests for malformed body fields and expiry boundaries, transfer decline tests for malformed reason bodies, OpenAPI path/schema enum tests, service filter tests. | Merged via PR #477 as `d7e675b0c381582f3d62ee4c798aec5d279718aa`. |
| M2 | Validate UTXO selection inputs at the route boundary. Add a shared-safe amount parser or route-local schema that rejects empty, non-integer, negative, decimal, and unsafe values before `BigInt(amount)` in select and compare routes. Validate or intentionally preserve `scriptType` compatibility against the OpenAPI string/closed-object contract. Keep strategy constant convergence separate. | UTXO selection route tests for invalid/valid amount values and malformed `scriptType` on select and compare endpoints, plus existing feeRate and strategy tests, OpenAPI contract checks if request schemas change. | Merged via PR #478 as `431ef4f1c22fa2765bded9c267cc4bf7c24bb721`. |
| N | Centralize websocket protocol ownership. Remove stale `modelDownload` from active frontend types, derive event values from shared websocket types where possible, add `subscribe_batch`/`unsubscribe_batch` client messages to the shared/runtime schema parity checks, add shared pure channel helpers for `blocks`, `mempool`, `sync:all`, `transactions:all`, `logs:all`, wallet, and address channels, and route notification broadcasts through the same event builder/gateway-forwarding path or document why they are local-only. Keep the legacy envelope until a separate protocol migration. | Frontend websocket hook tests, server channel fanout tests, notification broadcast tests, shared channel helper tests, client-message schema parity tests including batch subscribe/unsubscribe, negative search for stale `modelDownload`, websocket typechecks. | Server fanout, notification broadcasts, gateway forwarding, frontend subscription/invalidation, client message senders, shared types, and server validation use one protocol vocabulary; no model-management websocket event remains active. |
| O | Run a narrow frontend API hygiene pass. Rename Payjoin API status to an availability/config status, centralize send-attempt status, replace manual query strings with `apiClient.get(..., params)`, deduplicate client-internal query construction, and import shared response types where already available. Keep PSBT parsing as watch-only unless QR/file/import work is already in scope. | Payjoin hook/API tests, affected API module tests, query encoding/null tests, client query-builder tests, typechecks, negative search for manual query construction outside the client and parser utilities. | Frontend API helpers use the central client path and names distinguish API availability from send attempt state. |
| P | Centralize UTXO selection strategies when coin-control code is next touched. Put the strategy tuple/type in shared or a server/shared-safe transaction constants module; derive route validation, service compare strategy list, OpenAPI, and frontend types. | UTXO selection route tests for valid/invalid strategies, service compare tests proving every canonical strategy is included exactly once, OpenAPI contract tests, app/server typechecks, negative production tuple search. | One strategy owner drives API, service, OpenAPI, and frontend contracts without broadening this queue's urgent scope. |
| Q | Low-priority constants and cleanup as touched. Admin agent statuses/severities, device roles, RBF status, privacy grades, device connection method/vendor normalization, price-provider offline fallback, server LLM egress env accessors, PSBT low-level predicates, and `API_BASE_URL` export cleanup should be handled when nearby code is already changing. | Focused tests for the touched domain plus negative tuple searches. | Drift-prone literals, stale comments, and redundant env accessors are reduced without broad churn. |

### Post-Phase-I Execution Guardrails

- Keep the remaining active queue as small implementation PRs. N and O each touch different public contracts or runtime boundaries; do not bundle P/Q cleanup or generated-client work into those phases.
- Phase M2 closed with OpenAPI-aligned validation errors for malformed UTXO selection inputs. Future UTXO strategy cleanup should not reopen amount or `scriptType` compatibility unless a separate API migration intentionally changes that contract.
- Phase L closed by choosing documented reduced/core prebuilt images rather than expanding the prebuilt image set. If image inventory expands later, release digest files, stable-release artifact verification, and downstream `sanctuary-umbrel` digest notification inputs must be updated alongside `docker-compose.ghcr.yml` and image publishing.
- Phase N must preserve the current legacy websocket envelope and channel names until a versioned protocol migration exists. The notification-broadcast decision is explicit: either route notifications through the shared builder/gateway-forwarding path or document and test local-only delivery for gateway-connected deployments.
- Phase O is intentionally narrow frontend API hygiene. Use the central client query path for ordinary query params, but keep endpoint-local serialization only when an endpoint needs a special wire format such as repeated array keys; those exceptions need focused encoding tests.
- Backout should be straightforward for public/deploy changes: keep small compatibility adapters or old-name wrappers until the phase's negative search and focused tests prove every active caller has moved.

### Post-Phase-I Edge Cases

The sync-priority, mempool-estimator, gateway, transfer, and UTXO route-validation bullets below are retained as Phase J/K/L/M/M2 closeout history; the remaining bullets guide open phases starting at Phase N.

- Sync priority cleanup must not confuse wallet sync priority (`high`/`normal`/`low`) with Bitcoin fee priority (`fastest`/`fast`/`medium`/`slow`/`minimum`) or unrelated provider priority scores.
- If invalid sync priorities were accepted by old clients, the compatibility decision must be explicit. Rejecting with 400 is cleaner and matches OpenAPI; normalizing to `normal` is a compatibility choice and must be tested.
- Sync request malformed-body and extra-field handling should be explicit. If keeping passthrough/default-normalizing behavior for old clients, OpenAPI should not say `additionalProperties: false` without documenting compatibility; otherwise the route should reject or strip extras intentionally.
- Mempool estimator convergence must preserve DB migration defaults, existing stored `simple` values, explicit admin `simple` selection, runtime fallback on config read failure, and frontend behavior when API data is missing. Prisma schema and migration defaults cannot import TypeScript constants, so they should remain deliberate storage-default literals with parity/search coverage rather than being treated as unowned duplicates.
- Gateway push credential support must not log private keys or require decrypted secrets in config snapshots. File-based and env-based credentials should have deterministic precedence.
- Gateway port cleanup must account for container port versus host port. `GATEWAY_PORT` can mean host mapping in compose, while runtime app port controls the in-container listener.
- Prebuilt image convergence needs a product/deploy decision. Adding gateway/proxy images changes CI publishing, release-digest manifests, downstream Umbrel update inputs, and setup flows; marking prebuilt as reduced/core changes user expectations instead.
- Transfer route validation cleanup must not break existing clients accidentally if invalid filters were previously ignored. If preserving ignore semantics, it should be named as compatibility parsing rather than an unvalidated cast.
- UTXO selection route validation is a route-boundary fix, not strategy convergence. It should preserve accepted integer string/number payloads if clients currently send both, but fail before service calls or `BigInt` for empty, negative, decimal, non-numeric, or unsafe values. `scriptType` should either be validated as a string/known script value or documented as a compatibility passthrough.
- Websocket protocol helpers must keep the current legacy event envelope and subscription protocol until a versioned websocket protocol migration exists. Batch subscribe/unsubscribe messages should be represented in shared types and runtime schemas before channel helper cleanup depends on them. Notification broadcasts should not bypass gateway forwarding unless local-only delivery is an explicit product/runtime decision.
- Payjoin status renaming must avoid changing wire payloads; the problem is frontend domain naming, not the `/payjoin/status` JSON shape.
- UTXO strategy convergence must preserve compare-strategy response keys and ordering, default `efficiency`, and exhaustive service handling for every strategy.
- PSBT helper consolidation is watch-only. It must not broaden accepted QR/file/import formats by accident; encoding-specific flows should call shared low-level predicates, not one oversized parser with hidden behavior.

### Independent Review Adjustment - 2026-05-15

- Confirmed the top three phases: sync priority validation, mempool estimator defaults, and gateway deploy/runtime contract drift.
- Re-ranked transfer filters ahead of UTXO strategy constants because transfer routes cast arbitrary `status` values into service filters, while UTXO routes already reject invalid strategies.
- Softened UTXO strategy constants to a lower-priority coin-control follow-up because duplication exists but no current behavior drift was found.
- Narrowed frontend API hygiene so Payjoin naming, query construction, and shared response types are actionable, while PSBT parsing stays watch-only unless QR/file/import code is already changing.
- Added server LLM egress env accessor cleanup to the low-priority bucket and made the prebuilt gateway/proxy inventory decision part of the gateway phase exit criteria.

### Second Independent Review Adjustment - 2026-05-15

- Confirmed J/K/L remain the top three and rejected moving UTXO back above transfer validation.
- Broadened Phase M from transfer list filters to transfer route validation because create-body fields are accepted as `z.unknown()` while OpenAPI documents string, boolean, and integer fields.
- Made gateway Phase L explicitly cover documented `FCM_ENABLED` and `APNS_ENABLED` flags, not only credential files/env values.
- Corrected stale summary and verification wording that still listed UTXO strategy cleanup ahead of transfer validation.

### Third Independent Review Adjustment - 2026-05-15

- Confirmed J, K, N, and O remain evidence-backed and kept L ranked third, M ahead of UTXO, and UTXO strategy work as a lower-priority coin-control follow-up.
- Broadened Phase L to include documented `APNS_PRODUCTION` drift and active offline/install service-name drift where scripts still target `ai` while compose defines `llm-egress-proxy`.
- Broadened Phase M to cover all transfer request-body type drift, including create `message` and decline `reason`, not only create identifiers/booleans/expiry and list filters.
- Added UTXO `amount` parsing as an adjacent Phase P route-validation edge case, without reclassifying strategy constant duplication as urgent current behavior drift.

### Fourth Independent Review Adjustment - 2026-05-15

- Confirmed J/K/L/M remain the top order and rejected moving UTXO strategy constants back above transfer validation, demoting Phase L, or broadening O into generated-client work.
- Broadened Phase J to cover extra-field behavior because the sync route uses `.passthrough().catch({})` while OpenAPI says the priority request has `additionalProperties: false`.
- Broadened Phase K to include the admin no-config response path, which returns `simple` even though runtime, DB, and frontend defaults use `mempool_space`.
- Split active UTXO `amount` route validation into Phase M2 near transfer validation while keeping UTXO strategy constants as the lower-priority Phase P coin-control follow-up.
- Broadened Phase N from events/channels to websocket protocol ownership because shared client message types omit batch subscribe/unsubscribe while the frontend sends and server validates them.

### Fifth Independent Review Adjustment - 2026-05-15

- Confirmed the J/K/L/M/M2/N/O/P/Q order and rejected moving UTXO strategy constants above transfer validation, demoting gateway deploy/runtime drift, or broadening O into generated-client work.
- Narrowed Phase L evidence so setup/offline manifests are recognized as already including gateway/proxy images, while prebuilt publishing/compose inventory and `ai` service-name script references remain active drift.
- Broadened Phase J to explicitly include malformed-body default normalization from `.catch({})`, not only invalid priority values and extra fields.
- Broadened Phase M2 from amount-only validation to UTXO selection route validation because adjacent `scriptType` is `z.unknown()` while OpenAPI documents a string in a closed request body.
- Broadened Phase N to include the active server-side broadcast split between typed `EventBuilders` with gateway forwarding and notification broadcasts that construct events directly and only call local WebSocket broadcast.
- Corrected Phase O evidence to the current query-construction drift and added duplicate client-internal query builders as part of the narrow frontend API hygiene pass.

### Phase J-Q4 Closeout Addendum - 2026-05-16

- Phase J is closed. PR #474 merged as `13ef9b5c62b83d2e6f23625b656e40c1b2f9f93c`; current `origin/main` has `shared/constants/sync.ts`, and sync route/OpenAPI/queue/worker priority behavior derives from that owner.
- Phase K is closed. PR #475 merged as `a781c8ee768a55a5688021af4b801545a90f5bcc`; current `origin/main` has `NODE_MEMPOOL_ESTIMATOR_VALUES` and `DEFAULT_NODE_MEMPOOL_ESTIMATOR` in `shared/constants/nodeConfig.ts`, with admin/runtime/frontend/OpenAPI consumers deriving from them.
- Phase L is closed. PR #476 merged as `2f92b7d87f1bea812d776b5b1f3ac2e2a334af85`; current `origin/main` has gateway runtime env helpers for `PORT`/`GATEWAY_PORT`, `backend:3001` defaults, file/env push credential loading, `APNS_PRODUCTION`, reduced/core prebuilt docs, and offline/install `llm-egress-proxy` service naming.
- Phase M is closed. PR #477 merged as `d7e675b0c381582f3d62ee4c798aec5d279718aa`; current `origin/main` has transfer route validation deriving resource, role, and status filters from transfer-service constants, typed closed create/decline schemas, invalid-filter 400s, and matching OpenAPI/test coverage.
- Phase M2 is closed. PR #478 merged as `431ef4f1c22fa2765bded9c267cc4bf7c24bb721`; current `origin/main` has UTXO select and compare route schemas that parse positive safe-integer amounts before service calls, reject malformed `scriptType`, close request bodies, and align OpenAPI request schemas and tests.
- Phase N is closed. PR #479 merged as `5566ededd900c6cd92b42223c3a29c3899f73952`; current `origin/main` has shared websocket client messages for batch subscribe/unsubscribe, shared channel helpers, frontend hooks/server fanout derived from shared protocol ownership, no active frontend `modelDownload` event type, and notification broadcasts on the typed gateway-forwarding path.
- Phase O is closed. PR #480 merged as `7aa5726018102e277b822e03d6836822612e9bed`; current `origin/main` has distinct Payjoin availability and send-attempt status names, selected frontend query params using the central client path, shared price/fee response type reuse, and `utils/psbtFormat.ts` owning low-level PSBT predicates.
- Phase P is closed. PR #481 merged as `dbaaa01658be47598014e0e5ae7c80258179aba1`; current `origin/main` has `UTXO_SELECTION_STRATEGIES`, `DEFAULT_UTXO_SELECTION_STRATEGY`, and `isUtxoSelectionStrategy` in `shared/constants/transactions.ts`, with route validation, service compare/recommendation behavior, OpenAPI, shared/frontend types, and tests deriving from that owner. The legacy transaction-builder selector now exposes only its implemented `largest_first`/`smallest_first` subset, and `branch_and_bound` is rejected by the shared guard rather than advertised as public.
- Phase Q1 is closed. PR #482 merged as `ea9bdaf0d1107b4b3326e4f67b1aea7952a73790`; current `origin/main` has shared owners for admin wallet-agent values, device roles, RBF statuses, and privacy grades, plus the recursive-review follow-up that removed remaining production tuple/union/cast definitions from privacy UI, wallet detail mapping, agent dashboard UI, transaction typing, and agent monitoring.
- Phase Q2 is closed. PR #483 merged as `4ec0d4a4b69b508cee06a74b6468aef0ba2258b0`; current `origin/main` has backend AI config sync and egress proxy auth helpers reading `llmEgressProxyUrl`/`llmEgressProxySecret` from central server config, with proxy-local env validation still independent.
- Phase Q3 is closed. PR #484 merged as `9b78adb7f93fe990250f6c07b78a8b4a942221f3`; current `origin/main` has utility-owned ConnectDevice connection-method values and guards, component prop types deriving from that owner, and guarded model connectivity parsing without merging the separate send-review signing-method domain.
- Phase Q4 is closed. PR #485 merged as `16f1022df8f830b674237a30cafbbd9760e0c5d4`; current `origin/main` has `src/api/client.ts` keeping its resolved base URL private and routing request/blob/download/upload URL construction through `joinApiBaseUrl`, while `src/api/baseUrl.ts` remains the public helper for raw refresh/health fetch boundaries.
- Phase Q remains an as-touched watch bucket only. Current source evidence still shows repeatable but lower-risk candidates such as hardware vendor/type normalization across several behavior surfaces and price-provider offline fallback, but neither is a justified next broad implementation phase.
- Hardware vendor/type normalization stays deferred because it spans onboarding model matching, send-review signing capabilities, adapter registration, icon matching, add-account USB support, and import/export wallet-model mappings. A future cleanup should happen only when hardware support is already being changed and can cover those surfaces together.
- Price-provider fallback stays watch-only because server runtime provider names/defaults, enablement, diagnostics, and stale-cache fallback are already owned by the server price provider registry/settings path. The frontend `CurrencyContext` fallback list exists only for offline settings UI and should not become a second runtime provider registry.
- Source checks for this closeout review used `origin/main` at `16f1022df8f830b674237a30cafbbd9760e0c5d4`.

## Post-Phase-T Reanalysis - 2026-05-16

Scope: repo-wide scrub for login-style divergent paths after Phase T and closeout. The local checkout was `main...origin/main [ahead 1, behind 18]`, so the active source-of-truth review used `origin/main` at `718a3d16a177ed78afca7d23a93c615538128931` instead of stale local route files.

### Reanalysis Verdict

- Completed N/O/P/Q1/Q2/Q3/Q4/R/S/T work stays closed on `origin/main`; this reanalysis does not reopen the broad websocket, API hygiene, UTXO strategy, shared-value, LLM egress, ConnectDevice, API base URL, Payjoin, admin monitoring, or hardware/export phases.
- No new broad convergence phase is justified. The remaining candidates are lower-risk, domain-local cleanups that should be handled as touched.
- Watch or handle as touched: wallet policy route/admin policy schema derivation, draft status route schema, residual direct websocket confirmation broadcast, price-provider offline fallback, node config `servers` body typing, and broader hardware vendor normalization.
- Keep separate as justified boundaries: raw refresh and health fetch helpers outside the authenticated client interceptor path, root `/health` versus `/api/v1/health`, LLM egress proxy/backend validation, gateway route manifest versus request-schema map, device roles versus wallet roles, and ConnectDevice onboarding methods versus send-review signing methods.

### Closed Decisions

- Payjoin attempt validation is now one typed closed JSON route contract: `psbt` and `payjoinUrl` are non-empty strings, `payjoinUrl` is URL-shaped, `network` is the shared Bitcoin network enum, and malformed or extra fields reject at the route boundary. The unauthenticated BIP78 receiver remains intentionally separate.
- Admin monitoring update validation is now typed and closed. Blank, null, and omitted `customUrl` currently clear the stored override through `updateMonitoringServiceUrl`; malformed non-string/non-null values reject with 400. Grafana `anonymousAccess` must be boolean when present, and omitted Grafana updates are accepted without mutation.
- Hardware/export model identity now has a single Sparrow/export mapping owner. `ledger_gen_5` remains the local Sanctuary alias, while the Sparrow JSON adapter emits Sparrow's target enum value `LEDGER_NANO_GEN5`.

### Current Inventory

| Area | Evidence | Risk | Disposition |
| --- | --- | --- | --- |
| Payjoin attempt route validation | `server/src/api/payjoin.ts` now uses `AttemptPayjoinBodySchema` with `psbt`, `payjoinUrl`, and optional shared-network enum validation, plus strict extra-field rejection. | Original route/OpenAPI/service drift is closed. | Converged in Phase R |
| Admin monitoring update validation | `server/src/api/admin/monitoring.ts` now uses `MONITORING_SERVICE_IDS`, `customUrl: z.string().nullable().optional()`, strict request bodies, and boolean-only Grafana updates; route tests cover malformed types and extras. | Original admin malformed-payload drift is closed; omitted `customUrl` clear semantics should be changed only with a deliberate product decision. | Converged in Phase S |
| Hardware/export device model mapping | `server/src/services/export/sparrowWalletModel.ts` owns Sparrow wallet-model mapping; route and handler tests import the real helper and cover `ledger_gen_5 -> LEDGER_NANO_GEN5`. | Original duplicate export maps and false-confidence test helper are closed. | Converged in Phase T |
| Wallet policy route and admin policy schemas | Wallet policy mutation routes now use strict discriminated schemas for the supported policy types. Admin policy routes still keep generic config and local policy/enforcement values where the admin surface is broader than wallet policy CRUD. | The former wallet policy route-schema drift is closed. Admin policy config remains an admin-only extension boundary to tighten only with policy API work. | Wallet policy converged; admin policy watch |
| Draft status route schema | Draft update route now uses the actionable draft status enum instead of an unrestricted string, but repository/mobile/shared type constants still duplicate the same public tuple. | Route contract looseness is closed; future drift risk is constant ownership, not request validation. | Watch; converge draft status constants as touched |
| Websocket confirmation update broadcast | Most websocket event paths use typed helpers and gateway-aware notification paths; `server/src/websocket/notifications/subscriptions.ts` still has a direct local `wsServer.broadcast` in `checkConfirmationUpdate`. | Isolated residual path, not enough to reopen Phase N. | Clean up as touched |
| Price-provider fallback | Server runtime provider registry remains canonical; frontend settings/tests still contain fallback provider lists for offline UI behavior. | Can stale in offline UI only; runtime behavior stays server-owned. | Watch |
| Broader hardware vendor normalization | Device catalog, icons, onboarding connection methods, send-review signing capability, import helpers, and export wallet-model adapters still encode hardware concepts for different purposes. | Merging these would create a broad abstraction over unlike domains. | Keep separate; normalize only domain-local aliases |
| Node config `servers` body typing | `server/src/api/admin/nodeConfig.ts` still accepts `servers: z.unknown().optional()` because node config supports legacy and provider-specific server projections. | Admin-only and service-projected, but route/OpenAPI typing could be tightened with node config work. | Watch |

### Remaining Follow-Up Policy

| Bucket | Work | Verification | Exit Criteria |
| --- | --- | --- | --- |
| U-Y | Handle remaining as-touched cleanup in small slices: admin policy config typing, draft status constant ownership, wallet-create quorum parsing, webhook built-in value parity, websocket-confirmation broadcast cleanup, price fallback review, node config server typing, and broader hardware normalization. | Focused domain tests plus negative searches for the specific tuple/schema/helper being removed. | Drift shrinks without broad churn, cross-domain behavior merges, or private webhook receiver contracts entering the public repo. |

### Edge Cases

- Do not merge the authenticated Payjoin sender JSON route with the unauthenticated BIP78 receiver endpoint; their body formats, authentication, and compatibility constraints are different.
- If product later wants omitted `customUrl` to be a no-op, that should be a small admin monitoring behavior change with route/service tests. Current merged behavior treats blank, null, and omitted `customUrl` as clear.
- Hardware mapping cleanup must not collapse separate domains: onboarding connectivity, send-review signing method, icon/model display, adapter support, add-account USB support, and export wallet model aliases do not all mean the same thing.
- Hardware export adapters may translate local aliases into target-format wire enums. For Sparrow, `ledger_gen_5` maps to `LEDGER_NANO_GEN5`; that does not rename the local Sanctuary alias.
- Proxy-local LLM env validation and request validation should remain separate from backend config accessors because that split is the egress security boundary.
- Do not use stale local checkout files as active evidence until local `main` is updated from `origin/main`.

### Post-Phase-T Verification Notes

- This post-Phase-T pass used targeted `git show`, `git grep`, `rg`, and `sed` source reads against `origin/main` for Payjoin, admin monitoring, Sparrow export mapping, policy/draft route schemas, websocket confirmation broadcasts, price fallback, node config, and hardware normalization. Historical review notes below preserve the earlier Post-Phase-I audit trail.
- An additional independent read-only review challenged the post-Phase-I ranking on 2026-05-15. It confirmed J/K/L, moved transfer filters ahead of UTXO strategy cleanup, softened UTXO and PSBT work to lower priority, and identified server LLM egress env accessors plus prebuilt gateway/proxy inventory as explicit plan-tracking gaps.
- A second independent read-only review challenged the adjusted plan on 2026-05-15. It kept the J/K/L/M/N/O/P/Q ranking, broadened M from transfer filters to transfer route validation, added documented gateway enable flags to L, and corrected stale summary wording.
- A third independent read-only review challenged the adjusted plan on 2026-05-15. It found L still under-scoped for `APNS_PRODUCTION` and active `ai`/`llm-egress-proxy` deploy-script drift, found M still under-scoped for create `message` and decline `reason`, and rejected moving UTXO strategy constants back above transfer validation while adding UTXO `amount` parsing as an adjacent edge case.
- A fourth independent read-only review challenged the adjusted plan on 2026-05-15. It kept the top order, broadened J for extra-field/OpenAPI drift, broadened K for admin no-config defaults, split UTXO `amount` validation into near-term Phase M2, and broadened N for websocket client-message/schema parity.
- A fifth independent read-only review challenged the adjusted plan on 2026-05-15. It kept the order, narrowed L wording for prebuilt/publish versus setup/offline inventory, broadened J for malformed-body normalization, broadened M2 for `scriptType`, broadened N for server broadcast path drift, and corrected O's current query-construction evidence.
- A recursive plan-review pass on 2026-05-15 rechecked the active J/K/L/M/M2/N/O evidence against source and added execution guardrails for compatibility decisions, deploy/product decisions, websocket local-only versus gateway-forwarding behavior, frontend query serialization boundaries, and backout expectations. It did not change the phase order.
- An earlier recursive plan-review pass on 2026-05-16 rechecked the plan against `origin/main` after Phase L/M merges, updated active status through Phase M, and at that time confirmed Phase M2 as the next route-boundary validation slice.
- An earlier recursive plan-review pass on 2026-05-16 rechecked the plan against `origin/main` after Phase M2 merged, updated active status through Phase M2, and at that time confirmed Phase N websocket protocol ownership as the next active slice.
- A later 2026-05-16 reanalysis used `origin/main` at `38d586cc6d741db94af6d49d717e74a4c0966121`, confirmed Phases N/O/P/Q1/Q2/Q3/Q4 were closed, and narrowed the next worthwhile consolidation queue to Payjoin attempt route validation, admin monitoring update validation, and hardware/export device model mapping cleanup. A post-Phase-T reanalysis then used `origin/main` at `718a3d16a177ed78afca7d23a93c615538128931`, confirmed R/S/T closure, and moved remaining candidates to watch/as-touched.
- No runtime tests were run for this addendum because the change is documentation/planning only.
- Follow-up implementation phases should use focused behavioral tests plus negative searches for the specific tuple/helper they remove.

## Edge Cases

- Wallet-create quorum parsing preserves valid multisig create requests, keeps numeric-string compatibility, ignores quorum fields on single-sig wallets, and rejects malformed objects, arrays, nulls, zero, negative values, decimals, unsafe integers, and `quorum > totalSigners` before the service receives the request.
- Draft status convergence must keep `broadcasted` outside the actionable `unsigned`/`partial`/`signed` mutation tuple unless a lifecycle migration intentionally changes the public draft API.
- Webhook built-in value convergence must not close the generic API shape. `payloadProfile`, `authType`, event IDs, header config, retry config, filters, and profile config need room for future public profiles and deployment-local private mappings.
- Webhook support packages, delivery logs, OpenAPI examples, UI defaults, and tests must not record private receiver field names, header names, URL paths, static values, or business vocabulary.
- Optional webhook valuation enrichment must remain endpoint-configured. Required valuation failures should stay retryable, while disabled valuation should not add fiat fields to generic events.
- Spend-analysis `utxoIds` must reject empty arrays, blank identifiers, and non-string entries at the route boundary before privacy analysis runs.
- Remaining loose route schemas should be tightened only with boundary-specific compatibility tests; some loose shapes are extension points or adapter payloads rather than accidental drift.

## Historical Edge Cases For Closed Phases

- Phase 5 must not remove external Ollama as a provider type; it removes Sanctuary's ability to pull/delete provider models.
- Phase 5 must keep provider detection, provider model listing, provider config sync, inference routes, endpoint allowlists, CIDR/private endpoint checks, credential isolation, `LLM_EGRESS_PROXY_SECRET`, and sanitized internal AI context routes.
- Phase 5 route removal must be real removal, not hidden UI or stub handlers. Tests should prove `/ai/pull-model`, `/ai/delete-model`, `/ai/system-resources`, proxy `/pull-model`, proxy `/delete-model`, and `/internal/ai/pull-progress` are absent.
- Phase 5 should remove or rename misleading internal vocabulary. For example, a retained UI boolean named `canManageOllamaModels` should become a provider-type/display flag, because model management is no longer supported.
- Phase 5 should preserve saved provider settings and selected model strings when provider listing fails, returns an empty list, is slow, or omits the saved model.
- Phase 5 should remove download-oriented popular/recommended model fetching unless the feature is reframed as selection-only help and cannot trigger install/delete behavior.
- Phase 5 should delete model-download websocket plumbing if there is no remaining producer; keeping dead events requires naming the retained producer and consumer.
- Phase 5 should leave unrelated websocket `system` events and non-model notifications intact.
- Phase 5 docs and copy should avoid "local model", "download", "install", "pull", "delete", and "manage models" wording unless explicitly describing an external provider application's own behavior.
- Phase 6 helper semantics should be explicit: object nodes merge, arrays replace, scalar values replace, `undefined` is not deletion, empty path segments reject, and `__proto__`, `prototype`, and `constructor` reject.
- Phase 6 path parsing should reject empty paths, leading/trailing dots, double dots, and non-string path input before it touches objects or localStorage keys.
- Phase 6 should treat non-object existing nodes as replacement boundaries. For example, if `viewSettings.wallets` is a scalar or array, writing `viewSettings.wallets.layout` should build a new object for `wallets` rather than spreading an invalid value.
- Phase 6 should preserve unknown sibling keys inside nested objects when the caller updates one nested field from the current preference snapshot, but it should not invent a deeper backend merge contract the server does not have.
- Phase 6 should prefer sending the smallest correct patch to `/auth/me/preferences`. Sending a full optimistic preference snapshot can overwrite top-level keys changed elsewhere; if a full snapshot is retained for compatibility, the plan must document why and add a stale-sibling test.
- Phase 6 optimistic updates need request generation or key-scoped rollback so a failed earlier write does not overwrite a later successful local update.
- Phase 6 rollback should operate on the exact top-level keys or nested paths written by the failed request and should skip paths whose generation has advanced since that request started.
- Phase 6 stale in-flight requests must be tied to the auth session that started them. A preference request that succeeds or fails after logout, terminal logout, registration state change, or same-user re-login should not set errors, apply success payloads, or roll back the newly hydrated session.
- Phase 6 should treat empty preference patches as no-ops so callers do not create request generations or hit the API with `{}`.
- Phase 6 should keep last-write-wins as the API-level concurrency model unless a separate backend transaction/compare-and-swap phase is approved.
- Phase 6 must preserve unauthenticated localStorage fallback, invalid JSON fallback, null/absent preference defaults, and backend canonicalization for `fiatCurrency` and `selectedNetwork`.
- Phase 6 localStorage behavior should remain unauthenticated-only: authenticated writes must not mirror stale server values into `sanctuary_pref_*`, and invalid localStorage JSON should be logged/debug-fallback only.
- Phase 6 should include server feature settings in the review boundary. Telegram, autopilot, and intelligence settings also write nested preference objects and can overwrite siblings if they rebuild stale snapshots.
- Phase 6 server-side review should distinguish harmless per-wallet settings rewrites from unsafe sibling loss. Telegram, autopilot, and intelligence should preserve existing global fields and other wallet IDs, reject or safely store prototype-like wallet IDs, and avoid mutating a cast preference object before validation fails.
- Phase 6 does not solve concurrent cross-tab or cross-device writes to the same top-level nested preference object. The current backend patch contract still merges only top-level keys, so a later write based on a stale snapshot can replace that top-level object until a deeper server patch or compare-and-swap contract exists.
- Phase 6 intentionally does not broaden preference validation. Unknown preference keys remain possible where the existing extensible patch contract allows them, but canonical known fields such as `fiatCurrency` and `selectedNetwork` still depend on backend schemas.
- Phase 6 request-generation handling protects the current browser session only. It does not guarantee global ordering between multiple browsers, devices, or server-side writers.
- The retained LLM egress proxy is not an AI/model container. Future copy, route names, and deployment docs should continue to describe it as egress isolation, not local model hosting.

## Deferred Or Rejected

- Do not add a built-in webhook profile for any private receiver contract. Sanctuary should support those integrations through generic mapped JSON, configured HMAC, endpoint-local config, and deployment-private documentation.
- Do not collapse webhook endpoint JSON config into a closed schema just to satisfy one receiver. Close only the generic built-in profile/auth/event vocabulary; leave profile-specific config validation to the profile/signer boundary.
- Do not close wallet import descriptor/JSON payloads, admin policy/settings/backup payloads, node config `servers`, intelligence wallet context, push audit extras, auth refresh extras, or transaction drafting passthroughs as part of webhook rationalization. Those are adapter or compatibility surfaces and need domain-specific compatibility tests before tightening.
- Do not reopen wallet policy route-schema work as a near-term phase. The current wallet policy route is already strict; only shared policy value ownership remains as-touched cleanup.
- Do not turn draft `broadcasted` into an actionable update status during draft status convergence. Treat it as lifecycle/read-model state unless product changes the draft workflow.
- Do not merge raw `/bitcoin/broadcast` and wallet-scoped transaction broadcast endpoints. They are intentionally different operations.
- Do not remove the LLM egress proxy just because model management is removed. It still controls network egress, credentials, and sanitized context boundaries.
- Do not redo gateway routing in Phase 6 unless a new route-schema change makes the existing manifest parity tests insufficient.
- Do not build preference deletion semantics in the helper pass. The current backend patch contract does not define deletion.
- Do not replace the top-level preference patch API with JSON Patch, JSON Merge Patch, or a database-specific JSON-path update in Phase 6. Those may be valid later, but the immediate win is removing frontend/helper drift without changing the public contract.
- Do not reopen the removed model-management surface unless product policy changes explicitly. External provider model selection/listing is supported; Sanctuary-managed install/delete/pull remains unsupported.
- Do not fold device access roles into wallet role constants. Device sharing is currently an owner/viewer domain and should not inherit signer or approver semantics from wallet sharing.
- Do not merge wallet response `syncStatus` values with sync-pipeline `SyncStatus` values without an explicit API/storage migration. They use similar names for different domains today.
- Do not treat parser-only `unknown` account/script results, fixtures, examples, address regex keys, or intentional behavior matrices as production enum drift during Phase B.
- Do not treat the physical hardware test as blocked by this code rationalization queue. It remains the one manual validation item outside the non-hardware phases documented here.

## Verification Notes

- Phase Z local implementation converged the pre-commit Claude invocation helper and added deterministic malformed-output coverage. Verification passed with `sh -n server/.husky/pre-commit`, `bash -n server/.husky/pre-commit`, a direct-execution guard check for `SANCTUARY_PRE_COMMIT_LIBRARY_ONLY=1`, `bash -n tests/ci/pre-commit-agent-gate.test.sh`, `bash tests/ci/pre-commit-agent-gate.test.sh`, `bash tests/ci/check-workflow-composition.test.sh`, `node tests/ci/check-github-action-runtimes.test.mjs`, and `git diff --check`.
- The 2026-05-22 pre-commit agent-gate rationalization pass reviewed the current local hook hardening diff, searched `server/.husky`, `scripts`, and `tests` for duplicate agent parser/cache/verdict paths, confirmed `.claude/` is gitignored local state, and kept the hook as the single parser/verdict owner. Documentation and hook verification passed with `sh -n server/.husky/pre-commit`, `bash -n server/.husky/pre-commit`, and `git diff --check`.
- The 2026-05-22 Phase V-Y implementation loop locally added wallet-create route validation, shared draft status constants, shared webhook built-in constants, webhook UI/server parity tests, and transaction privacy `utxoIds` route validation. Focused verification passed with `npm --prefix shared run build`, `npm --prefix server test -- tests/unit/api/wallets.test.ts tests/unit/api/openapi.test.ts tests/unit/api/drafts-routes.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/api/transactions-privacy-routes.test.ts tests/unit/services/draftService.test.ts tests/unit/services/webhooks/webhookCore.test.ts tests/unit/services/supportPackage/webhooksCollector.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/agentDashboardRepository.test.ts`, and `npm test -- tests/shared/draftConstants.test.ts tests/shared/webhookConstants.test.ts tests/shared/mobileApiRequests.transactions.test.ts tests/components/WalletDetail/webhookModel.test.ts tests/components/WalletDetail/WalletWebhooks.test.tsx`. Final package gates and PR delivery are pending.
- The 2026-05-22 webhook-era rationalization refresh used current `main` at `c43b6c41` and targeted source reads/searches for wallet create validation, wallet policy schemas, draft status constants, webhook service/UI/OpenAPI vocabulary, and remaining generic route-boundary schemas. Documentation verification passed with `git diff --check`; no runtime tests were run because this was a planning-only update.
- The 2026-05-16 post-Phase-T rationalization pass used `origin/main` at `718a3d16a177ed78afca7d23a93c615538128931` to recheck Payjoin attempt validation, admin monitoring route/service/OpenAPI behavior, hardware export device mapping, policy/draft/websocket/price/hardware watch candidates, and local dirty documentation. It marked R/S/T closed, documented current omitted-`customUrl` clear behavior, preserved the local `ledger_gen_5` alias while recording Sparrow's `LEDGER_NANO_GEN5` wire value, and passed documentation verification with `git diff --check`.
- The 2026-05-15 post-Phase-I divergence reanalysis used parallel read-only subagent scrubs plus targeted local searches across frontend/API, backend/shared/OpenAPI, gateway/proxy/compose, and tests. It queued Phases J-Q plus M2 for sync priority validation, mempool estimator defaults, gateway deploy/runtime contracts, transfer route validation, UTXO selection route validation, websocket protocol ownership, frontend API hygiene, and UTXO strategy follow-up. Documentation verification passed with `git diff --check`.
- This plan was reviewed against `tasks/todo.md`, current branch status, active AI/OpenAPI/proxy files, gateway route manifest, and targeted `rg` searches on 2026-05-14.
- The 2026-05-14 reanalysis addendum was reviewed against current auth registration/login code, wallet role/capability paths, script type definitions, node/Electrum config projection paths, LLM proxy/provider contracts, feature flag definitions, gateway parity tests, and stale contract-test helpers. Documentation verification passed with `git diff --check`.
- The 2026-05-15 independent review rechecked wallet role/capability paths, script/account type constants, node config projection, contract helper constants, transaction type vocabulary, LLM provider boundaries, gateway route validation, feature flags, registration ordering, and login/refresh fetch boundaries with targeted `rg`/`sed` searches. Documentation verification passed with `git diff --check`.
- The 2026-05-15 plan detail review added phase-specific implementation notes and corner cases for wallet roles, script/account types, node config projection, contract helper repair, and login health. Documentation verification passed with `git diff --check`.
- The 2026-05-15 second independent review rechecked wallet capability derivation and UI defaults, device role separation, parser-only script/account values, sync-status domain names, node config projection, contract helper constants, LLM provider boundaries, gateway routing, and feature flags with targeted `rg` searches. Documentation verification passed with `git diff --check`.
- The 2026-05-15 third independent review rechecked the in-progress Phase A working tree against the ranked findings. It found and fixed the remaining direct send-page capability gap and mobile-permission OpenAPI role tuple drift, then passed focused tests, typechecks, lint, lizard, server build, OpenAPI route coverage, negative wallet-role searches, and `git diff --check`.
- The 2026-05-15 fourth independent review rechecked the current Phase B branch state against wallet roles, script/wallet/account identity, node/Electrum projection, contract-helper constants, login health fetch behavior, gateway route validation, feature flags, transaction type aliases, and external-LLM/model-management fallout with targeted `rg`/`sed` searches. It confirmed the Phase B/C/D/E order and added a small B2 copy/docs/type-name cleanup for stale external-LLM-only language.
- Phase B2 implementation removed active stale model-management wording from AI MCP docs, OpenAPI tag text, frontend architecture references, and AI Settings model-list copy. Generic frontend provider-model types now use `ProviderModel`; true Ollama-specific detection/listing internals remain separate. Verification passed with focused AI Settings/API tests, app/test typechecks, server build, scoped negative searches, and `git diff --check`.
- The 2026-05-15 sixth independent review rechecked the current tree after Phase A/B/B2 merge and during Phase C implementation. Targeted searches confirmed Phase A/B/B2 closure, confirmed Phase C's remaining node-config matches as justified admin legacy or price-provider boundaries, confirmed Phase D/E remain open, and led to a small Phase C hardening patch for invalid pool projection values. Focused shared node-config tests, shared build, focused server node/Electrum tests, and `git diff --check` passed.
- The 2026-05-15 seventh independent review rechecked the current Phase D branch after Phase C merge. Targeted searches confirmed Phase A/B/B2/C closure, confirmed stale contract helper literals and fixtures, found mobile-agent draft status tuple duplication as a Phase D-adjacent cleanup, confirmed login health remains the only direct route-local raw fetch outside the API client/refresh boundary, and found one minor active AI model-management comment. Documentation verification passed with `git diff --check`.
- The 2026-05-15 eighth independent review rechecked `origin/main` after Phase D merge. Targeted searches confirmed Phase A/B/B2/C/D closure, found no active model-management surface outside historical plan text and negative route tests, and confirmed Phase E as the only remaining non-hardware item. It also found that `client.ts` and `refresh.ts` still duplicate API base URL resolution, so Phase E should extract a tiny shared base URL helper while keeping refresh as a raw-fetch caller. Documentation verification passed with `git diff --check`.
- Phase E PR #467 merged as `0ff1cdaf80950946c120b7b141189d7c5ad75359`. It added `src/api/baseUrl.ts` and `src/api/health.ts`, migrated login health probing to the no-auth helper, kept refresh as a raw-fetch recursion boundary, and passed full local/CI verification including regenerated frontend coverage at 100%.
- The 2026-05-15 post-Phase-E reanalysis checked current `main` after Phase E closure. Targeted searches covered auth/login health fetches, gateway manifest/schema parity, AI provider type tuples, draft status filters, feature flag defaults/env/schema/definition drift, transaction aliases, and frontend API contract duplication. Documentation verification passed with `git diff --check`.
- The 2026-05-15 independent review of the post-Phase-E findings rechecked feature flag env/test coverage, draft actionable status filters, AI provider type duplication, transaction aliases, gateway validation parity, login health closure, compose AI-image absence, and the LLM proxy shared-import isolation guard. It confirmed the queue and corrected the AI provider implementation strategy toward parity tests rather than shared proxy imports.
- The 2026-05-15 plan detail review tightened the optional post-Phase-E queue with implementation guardrails and corner cases for feature flag env bindings, draft actionable status reuse, AI provider parity across the proxy boundary, transaction vocabulary aliases, and the stale LLM proxy installer comment. Documentation verification passed with `git diff --check`.
- Phase F PR #469 merged as `7997a3d851c5a5f5e122a5464c4c9afbad6aad4c`. It centralized feature flag env bindings, derived config/service helpers from the same binding table, added `FEATURE_TREASURY_AUTOPILOT` coverage, and passed local/CI verification.
- Phase G PR #470 merged as `818f55bae21e0dbf979946c84e6c4dc6ae852856`. It reused `ACTIONABLE_DRAFT_STATUSES` in agent funding and dashboard pending-count repository paths, preserved `broadcasted` exclusion, and passed local/CI verification.
- The 2026-05-15 Phase H plan review inspected server provider profile schemas, server AI route validation, server OpenAPI AI schemas, frontend AI/admin API types, proxy request schemas, proxy provider detection, proxy runtime config behavior, package scripts, and the proxy shared-import guard. It added implementation details and corner cases for provider type parity without collapsing the LLM egress proxy boundary.
- Phase 5 PR #459 merged as `42abe4d893420661482e73ddbd9a1f4aff271bd2` and the merge commit was verified on `origin/main`.
- Phase 6 PR #460 passed required Architecture, Build Dev Images summary, Code Quality, and Test Suite checks on head `38d6231090736094593f75e476e3e0f0be7fff6a`, then squash-merged as `26bbd2d052afe1e22421107dea77b6597e873f4c`.
- The Phase 6 merge commit was verified as an ancestor of `origin/main`; local `main` was fast-forwarded to `26bbd2d052afe1e22421107dea77b6597e873f4c`; the local and remote Phase 6 branches were deleted.
- Local Phase 6 verification passed: focused preference tests, full frontend coverage at 100% across 6112 tests, server nested settings tests, app/test/server typechecks, app/server lint, touched-file lizard, test hygiene, large-file classification, architecture graph regeneration, and `git diff --check`.

---

## Phase AD — listTransactions Type-Filter Value-Contract Convergence

Source plan: `docs/plans/rationalization-plan.md`
Date: 2026-06-25
Commit: `c8f359b6`
Scope: fresh repo-wide divergence scrub on current `main` after all prior phases (A–T, V–Z, AA–AC) merged. A read-only inventory subagent surfaced three candidates; two were rejected for boundary/behavior-change risk (see Deferred). The remaining `remove`-class duplicate value contract is selected.

### Divergence Inventory (this pass)

| Area | Paths | Behavior | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| listTransactions type filter | `server/src/api/transactions/walletTransactions/listTransactions.ts:21,65` (local `const TRANSACTION_TYPES = new Set(["sent","received","consolidation"])`) vs `shared/constants/transactions.ts:10-14,74` (`PERSISTED_TRANSACTION_TYPES` + `isPersistedTransactionType`) | Same values today | Hardcoded Set duplicates the canonical persisted-type contract with no import link; `shared/constants/transactions.ts` doc explicitly states filters should use the canonical values | **converge / remove** |
| Create-wallet `scriptType` | `server/src/api/wallets/crud.ts:55` (`z.string().min(1)` + runtime `isValidScriptType` via `scriptTypeRegistry.getIds()`) vs OpenAPI `wallet.ts:169` (`enum: WALLET_SCRIPT_TYPE_VALUES`) | Runtime check uses a **dynamic registry**, not the static enum | Converging Zod to the static enum could wrongly diverge from the registry source-of-truth; the registry is the intended runtime authority | **watch / defer** |
| validate-xpub `scriptType` | `server/src/api/wallets/xpubValidation.ts:19` (`z.string().optional()` → silent default NATIVE_SEGWIT) vs OpenAPI enum | Currently lenient: invalid → silent default | Converging to `z.enum(...).optional()` is a **behavior change** (reject vs silent-default) that could break lenient clients; needs a compatibility decision | **defer** |

### Canonical Path Decision

| Area | Canonical Path | Paths To Retire Or Wrap | Compatibility Policy | Decision Needed |
| --- | --- | --- | --- | --- |
| Persisted transaction type filter values | `shared/constants/transactions.ts` — `PERSISTED_TRANSACTION_TYPES` and the `isPersistedTransactionType` type-guard | The route-local `TRANSACTION_TYPES` Set in `listTransactions.ts` | Behavior-preserving: values are identical today, so the filter accepts exactly the same set before and after. The change only re-sources the values from the canonical owner. | None |

### Objective

Remove the duplicate route-local transaction-type contract so the wallet transaction list filter derives its accepted `type` values from the canonical `shared` owner. A future addition to `PERSISTED_TRANSACTION_TYPES` then flows into the filter automatically instead of being silently dropped.

### Non-Goals

- Do not change the filter's user-facing behavior (identical accepted values, identical "ignore unknown type" semantics).
- Do not touch `PUBLIC_TRANSACTION_TYPES`, alias normalization, or response contracts.
- Do not converge the two `scriptType` candidates (registry-boundary and behavior-change risk — deferred).
- Do not alter OpenAPI docs or other routes.

### Paths To Keep, Wrap, Converge, Or Remove

| Action | Paths |
| --- | --- |
| Remove | `const TRANSACTION_TYPES = new Set([...])` in `listTransactions.ts:21` |
| Converge | `listTransactions.ts:65` filter guard → `isPersistedTransactionType(type)` imported from `@sanctuary/shared/constants/transactions` |
| Keep | `shared/constants/transactions.ts` as the single owner |

### Phases

| Phase | Work | Files | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| AD.1 | Add a drift test asserting the route applies the `type` filter (Prisma `findMany` `where.type`) for **every** value in `PERSISTED_TRANSACTION_TYPES` (iterating the imported constant) and omits `where.type` for a non-persisted value | `server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.reads.contracts.ts` (extend) | `cd server && npx vitest run tests/unit/api/transactions-http-routes.test.ts` | Test passes against current code (proves baseline) |
| AD.2 | Replace the local Set with `isPersistedTransactionType` from shared | `server/src/api/transactions/walletTransactions/listTransactions.ts` | same focused test + `npx tsc --noEmit` | Local Set removed; filter sources from shared; tests green |

Test wiring note: the `transactionsHttpRoutes/` dir contains only `*.contracts.ts` modules + a harness. vitest's include glob is `tests/**/*.test.ts`, so those `it(...)` blocks run **only** through the runnable parent entry `tests/unit/api/transactions-http-routes.test.ts`. Always run that entry, never the directory.

### Compatibility / Migration / Rollback

- No wire/contract change; no migration. Rollback = revert the single commit.
- Behavior parity is guaranteed because the canonical and local value sets are identical at selection time; the drift test locks this in.

### Edge Cases

- Case sensitivity unchanged: `getQueryString` trims but does not lowercase, and both `Set.has` and `isPersistedTransactionType` are exact-match on lowercase canonical values, so `type=Sent` is rejected by the filter before and after (no behavior change).
- Blank/undefined/array `type`: `getQueryString` already returns `undefined` for blank/non-string; the `type && ...` short-circuit is unchanged.
- Aliases (`send`/`receive`) are intentionally **not** normalized at this filter (only persisted values pass) — same as today; alias normalization stays a separate concern.

### Verification Commands

Focused:
- `cd server && npx vitest run tests/unit/api/transactions-http-routes.test.ts`
- `cd server && npx tsc --noEmit`

Closeout (proportional — server only):
- `cd server && npx vitest run --coverage` (99% gate)
- `cd server && npx eslint "src/api/transactions/**/*.ts"`
- `git diff --check`

### Acceptance Criteria

- [ ] Route-local `TRANSACTION_TYPES` Set removed; filter uses `isPersistedTransactionType` from shared.
- [ ] New drift test iterates `PERSISTED_TRANSACTION_TYPES` and passes.
- [ ] No behavior change (same accepted values, unknown types still ignored).
- [ ] Server typecheck, lint, and 99% coverage gate pass.

### Deferred / Rejected (this pass)

- **Create-wallet `scriptType` enum convergence** — deferred. The runtime authority is the dynamic `scriptTypeRegistry`, not the static `WALLET_SCRIPT_TYPE_VALUES`; converging the Zod schema to the static enum risks diverging from the registry boundary. Revisit only with a decision on whether the static enum or the registry is the canonical owner.
- **validate-xpub `scriptType` enum convergence** — deferred. Converging changes behavior from silent-default to rejection; needs a compatibility decision on whether lenient clients are supported. Not a safe autonomous slice.

---

## Phase AE — vaultPolicy Route Enum Constants Convergence

Source plan: `docs/plans/rationalization-plan.md`
Date: 2026-06-25
Commit: `370b9aec`
Scope: post-closeout rationalize check after Phase AD (PR #550) merged. A fresh independent scrub found two route Zod schemas hardcoding enum literals that disagree (in source-of-truth terms) with the canonical `services/vaultPolicy/types.ts` constants already used by OpenAPI.

### Divergence Inventory (this pass)

| Area | Paths | Behavior | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| Approval vote decision | `server/src/api/wallets/approvals.ts:22` (`z.enum(['approve','reject','veto'])`) vs `server/src/services/vaultPolicy/types.ts:196` (`VALID_VOTE_DECISIONS`), already consumed by OpenAPI `walletPolicy.ts:392,405` | Same values | Route hardcodes the literal; canonical constant exists and OpenAPI uses it. Established precedent: `api/schemas/vaultPolicy.ts:14-15` already does `z.enum(VALID_POLICY_TYPES)` / `z.enum(VALID_ENFORCEMENT_MODES)`. | **converge** |
| Address-list type | `server/src/api/wallets/policies.ts:70` (`z.enum(['allow','deny'], { message })`) vs `services/vaultPolicy/types.ts:43` (`type AddressListType = 'allow' \| 'deny'`, no `VALID_*` constant) | Same values | The only policy enum without a `VALID_*` constant; inconsistent with `VALID_POLICY_TYPES`/`VALID_ENFORCEMENT_MODES`/`VALID_VOTE_DECISIONS`/`VALID_QUORUM_TYPES`. | **converge** |

### Canonical Path Decision

| Area | Canonical Path | Paths To Retire Or Wrap | Compatibility Policy | Decision Needed |
| --- | --- | --- | --- | --- |
| Policy/approval route enum values | `services/vaultPolicy/types.ts` `VALID_*` constants, surfaced as Zod via `api/schemas/vaultPolicy.ts` (existing owner module) | Route-local `z.enum([...literals...])` in `approvals.ts` / `policies.ts` | Behavior-preserving: identical accepted values and identical route error messages; only the value source changes. | None |

### Objective

Make the approval-vote and address-list route schemas derive their accepted values from the canonical `services/vaultPolicy/types.ts` constants (via the existing `api/schemas/vaultPolicy.ts` owner), so route validation and OpenAPI can never drift.

### Non-Goals

- No behavior change (same accepted values, same error messages, same optionality).
- Do not touch the inline `PolicyScopeSchema = z.enum(['wallet','per_user'])` (route↔OpenAPI already consistent; out of scope).
- Do not converge the two deferred `scriptType` items (registry-owner / lenient-vs-reject decisions still pending).
- Do not change OpenAPI docs (already use the canonical constants).

### Paths To Keep, Wrap, Converge, Or Remove

| Action | Paths |
| --- | --- |
| Convert to `as const` tuple (enables `z.enum`) | `VALID_VOTE_DECISIONS` in `services/vaultPolicy/types.ts:196` → `['approve','reject','veto'] as const satisfies readonly VoteDecision[]` (matches `VALID_ENFORCEMENT_MODES`). Verified consumers (`vaultPolicy/index.ts:35` re-export, OpenAPI `[...spread]`) are spread/re-export only → zero ripple. |
| Add constant | `export const VALID_ADDRESS_LIST_TYPES = ['allow','deny'] as const satisfies readonly AddressListType[]` in `services/vaultPolicy/types.ts` |
| Add owner schema | `export const VoteDecisionSchema = z.enum(VALID_VOTE_DECISIONS)` in `api/schemas/vaultPolicy.ts` |
| Converge | `approvals.ts:23` `decision: VoteDecisionSchema`; `policies.ts:70` `z.enum(VALID_ADDRESS_LIST_TYPES, { message })` (preserve the route-specific message) |
| Converge siblings (repo "fix all instances" rule) | `assistant/tools/policyReadTools.ts:19` `listType: z.enum(VALID_ADDRESS_LIST_TYPES).optional()` (same allow/deny contract in the assistant policy-read tool); `approvals.ts:31` `decisionValidationMessage` derive the value list from the constant — `` `decision is required and must be one of: ${VALID_VOTE_DECISIONS.join(', ')}` `` (prose drift sibling) |

### Phases

| Phase | Work | Files | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| AE.1 | Add/convert the canonical constants | `services/vaultPolicy/types.ts` | `cd server && npx tsc --noEmit` | tuple-typed constants compile; consumers unaffected |
| AE.2 | Add `VoteDecisionSchema`; converge all sites (both routes + the assistant tool + the prose message) | `api/schemas/vaultPolicy.ts`, `api/wallets/approvals.ts`, `api/wallets/policies.ts`, `assistant/tools/policyReadTools.ts` | focused route + assistant-tool tests + tsc | no route-local `['approve','reject','veto']` or `['allow','deny']` literal remains in server/src outside the canonical constants |
| AE.3 | Drift tests asserting each route schema accepts exactly the canonical values and rejects others | route test files | `cd server && npx vitest run <route tests>` | tests pass; iterate the constants |

### Compatibility / Rollback

- No wire/contract change; identical accepted values + messages. Rollback = revert the single commit.

### Verification Commands

- `cd server && npx tsc --noEmit`
- `cd server && npx vitest run` (focused route tests for approvals + policies)
- `cd server && npx eslint "src/api/wallets/approvals.ts" "src/api/wallets/policies.ts" "src/api/schemas/vaultPolicy.ts" "src/services/vaultPolicy/types.ts"`
- `cd server && npm run test:coverage` (99% gate)

### Acceptance Criteria

- [ ] All four sites (`approvals.ts` vote schema, `approvals.ts` validation message, `policies.ts` listType, `policyReadTools.ts` listType) derive from `services/vaultPolicy/types.ts`.
- [ ] `grep -rn "z.enum(\['approve'\|z.enum(\['allow', *'deny'\]" server/src` returns no matches (siblings all converged).
- [ ] Route error messages and accepted values unchanged.
- [ ] Drift tests iterate the canonical constants and pass.
- [ ] Server tsc, lint, and 99% coverage gate pass.

### Deferred (unchanged)

- create-wallet `scriptType` (registry-vs-static-enum owner decision) and validate-xpub `scriptType` (lenient-vs-reject compatibility decision) remain decision-blocked.

---

## Phase AF — create-wallet scriptType Single-Source Validation

Source plan: `docs/plans/rationalization-plan.md`
Date: 2026-06-25
Commit: `027590ae`
Scope: the first deferred `scriptType` item, now decided. User direction: single source of truth.

### Decision

Canonical source = `WALLET_SCRIPT_TYPE_VALUES` (shared). The route currently validates `scriptType` in **two** places: a loose `z.string().min(1)` plus a per-request `isValidScriptType()` check (which couples `parseWalletScriptType` + `scriptTypeRegistry.has`), while OpenAPI documents the static enum. Consolidate to ONE wire authority — `z.enum(WALLET_SCRIPT_TYPE_VALUES)` — matching OpenAPI, and remove the redundant route check.

The "is a handler actually implemented" guarantee that `isValidScriptType` provided is **preserved and upgraded**: the registry's `getDerivationPath`/`buildSingleSigDescriptor` already `throw 'Unknown script type'` downstream if a handler is missing, and we additionally add a **boot-time invariant** asserting the registry covers every `WALLET_SCRIPT_TYPE_VALUES` entry — so a "declared but unimplemented" script type fails fast at startup instead of at first wallet creation.

### Non-Goals

- Do NOT change `isValidScriptType` (it stays as a utility; it has its own unit test in `scriptTypeRegistry.test.ts` and is used elsewhere conceptually). We only remove the route's *call* to it.
- Do NOT touch validate-xpub `scriptType` (Phase deferred item #2): research showed it already rejects invalid input via the descriptor switch — it's not a bug; tightening is cosmetic and out of scope here.
- Do NOT convert runtime `listType === 'allow'` comparisons (readable idiom, not a value-list contract).
- No behavior change beyond: invalid `scriptType` is still rejected with 400, but via the schema (message becomes the existing grouped `'name, type, and scriptType are required'` instead of the removed check's `'Invalid scriptType. Valid types: …'`; OpenAPI documents the valid values, and no real caller sends an invalid value — the frontend uses the enum).

### Paths To Keep, Wrap, Converge, Or Remove

| Action | Paths |
| --- | --- |
| Converge | `server/src/api/wallets/crud.ts` — `scriptType: z.enum(WALLET_SCRIPT_TYPE_VALUES)` (was `z.string().min(1)`); import `WALLET_SCRIPT_TYPE_VALUES` |
| Remove | the per-request `if (!isValidScriptType(scriptType)) throw …` block + the now-unused `import { isValidScriptType, scriptTypeRegistry }` in crud.ts |
| Add (guardrail) | `server/src/services/scriptTypes/index.ts` — `assertScriptTypeRegistryCovers(WALLET_SCRIPT_TYPE_VALUES)` (exported, called after handler registration; throws listing any canonical id without a handler) |
| Keep | `isValidScriptType` (still exported + unit-tested); registry downstream throws unchanged |

### Phases

| Phase | Work | Files | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| AF.1 | Add the boot invariant + its unit test | `services/scriptTypes/index.ts`, `tests/unit/services/scriptTypes/scriptTypeRegistry.test.ts` | `cd server && npx vitest run tests/unit/services/scriptTypes/` | invariant passes for the canonical list, throws for a missing id (both branches covered) |
| AF.2 | `z.enum` + remove redundant route check/imports | `api/wallets/crud.ts` | tsc + crud route tests | no `isValidScriptType`/`scriptTypeRegistry` import in crud; invalid scriptType → 400 via schema |
| AF.3 | Update the one route test that mocked `isValidScriptType` | `tests/unit/api/wallets/wallets.crud.contracts.ts` (the `registerWalletCrudContracts` block; runs via the parent `tests/unit/api/wallets.test.ts`) | `cd server && npx vitest run tests/unit/api/wallets.test.ts` | test sends an invalid scriptType (no mock), asserts 400 + service not called |

### Compatibility / Rollback

- Invalid `scriptType` is still rejected (400); only the error message changes (no real caller hits it). Valid/missing behavior unchanged. The implementation-presence guarantee is preserved (downstream throw) and upgraded (boot invariant). Rollback = revert the single commit.

### Verification Commands

- `cd server && npx tsc --noEmit`
- `cd server && npx vitest run tests/unit/services/scriptTypes/ tests/unit/api/wallets.test.ts` (the `wallets/*.contracts.ts` modules run only via the `wallets.test.ts` parent, not the directory)
- `cd server && npx eslint "src/api/wallets/crud.ts" "src/services/scriptTypes/index.ts"`
- `cd server && npm run test:coverage` (99% gate)

### Acceptance Criteria

- [ ] `crud.ts` validates `scriptType` only via `z.enum(WALLET_SCRIPT_TYPE_VALUES)`; the redundant `isValidScriptType` call + its imports are gone.
- [ ] Boot invariant asserts the registry covers `WALLET_SCRIPT_TYPE_VALUES`; unit-tested (pass + throw).
- [ ] Invalid `scriptType` still returns 400 and does not call the create service.
- [ ] `isValidScriptType` unchanged and still covered.
- [ ] Server tsc, lint, 99% coverage gate pass.

### Deferred (unchanged)

- validate-xpub `scriptType` (not a bug — already rejects invalid; cosmetic only).
- runtime `listType === 'allow'` comparisons (readable idiom, not a contract).

---

## Phase AG — Umbrel and Prebuilt GHCR Distribution Retirement

Source plan: `tasks/umbrel-retirement-plan-2026-07-31.md`
Date: 2026-07-31
Status: Proposed
Scope: distribution, release automation, deployment paths, and external repositories

### Divergence Inventory

| Path | Current role | Disposition |
| --- | --- | --- |
| `install.sh` + `docker-compose.yml` | GitHub-tagged source install with local image builds | Keep as canonical online path |
| Signed offline bundles | Registry-independent per-platform install | Keep and enforce if advertised |
| `docker-compose.ghcr.yml` | Reduced prebuilt frontend/backend deployment, including MCP | Remove; migrate users to main Compose |
| GHCR image publisher and release image gate | Builds/pushes/verifies private container packages | Remove from current release contract |
| `sanctuary-umbrel` updater/repositories | Separate app package and downstream dispatch | Sunset, archive, then optionally delete |
| Forgejo/GitHub Release objects | Tag metadata, latest-version discovery, source/offline artifacts | Keep |
| Historical Umbrel/GHCR records | Audits, announcements, closed plans, tags/releases | Preserve as history |

### Canonical Decision

The supported public path is GitHub release discovery plus a tagged source clone
that builds the main Compose stack locally. Forgejo remains the source and test-only
CI authority; GitHub remains a passive public mirror with Actions disabled. Signed
offline bundles are the only supported no-network image distribution. Umbrel,
prebuilt GHCR Compose, registry publication, and downstream release dispatch are
retired together.

This supersedes Phase L's earlier choice to retain a reduced GHCR Compose path. The
new evidence is that canonical online/offline installers do not need GHCR, the
packages remain private, and retaining the divergent path would require publishing
packages solely for Umbrel/manual prebuilt consumers.

### Convergence Plan

1. Freeze writes and capture exact external repository/package inventories and
   recovery bundles.
2. In the main repository, simplify the trusted operator command to Forgejo/GitHub
   release publication; remove Umbrel dispatch, GHCR build/push, the reduced Compose
   file, and their direct tests.
3. Rewrite current docs and migration guidance; preserve historical records with
   explicit supersession notes.
4. Rehearse source install, upgrade, MCP, offline bundles, mirror/tag parity, and a
   release with registry/Umbrel variables absent.
5. Disable external updater automation and mirrors, publish a final migration
   notice, and archive the Umbrel repositories for a 30-day rollback window.
6. Revoke exact publisher/dispatch credentials after the rehearsal.
7. Retire Codeberg using the source-install/release-parity gate, not GHCR/Umbrel.
8. After the window, present an exact read-only manifest and separately request
   one-off permission to delete the two GHCR packages and Umbrel repositories.

### Edge Cases

- Existing Umbrel or manual GHCR-Compose installations are not automatically
  migrated; the notice must require backup, same-or-newer source install, restore,
  and verification before old deployment removal.
- Current private GHCR packages make anonymous pulls unhealthy; do not publicize
  them merely to create a sunset path.
- Legacy release manifests may mention container images. Keep them locally
  verifiable as optional historical artifacts while removing live registry access
  and image requirements from the current stable contract.
- Do not confuse unrelated English “umbrella” UI/animation references with the
  retired platform.
- Do not delete Git tags, Forgejo/GitHub releases, or factual audit/history records.
- Resolve the actual Forgejo Umbrel push-mirror target before claiming a Codeberg
  repository exists or attempting host cleanup.

### Deferred / Approval-Gated

- Archive versus final repository deletion: default to 30-day archive, then delete
  only if total removal is still desired.
- GHCR package and external repository deletion require exact target inventory,
  verified recovery artifacts, and separate one-off destructive approval.
- The implementation plan does not authorize credential revocation or external
  host mutation before the no-secret release rehearsal succeeds.

### Verification Notes

The detailed executable checklist, risks, commands, recovery requirements, and
acceptance criteria live in `tasks/umbrel-retirement-plan-2026-07-31.md`. Planning
used current `origin/main` at `ecd16a42877bc8e696c25932d2ad4ec493b05dd2` and
read-only repository/API evidence; no product code or external state changed.

## Architecture Boundary Revalidation - 2026-08-20

Date: 2026-08-20
Owner: Codex
Status: Implementation in progress; Phase 0 local verification complete
Scope: revalidation of the architecture audit after PRs #854, #859, #855, #856, #858, and #857; baseline `2a14f8088a`, target `origin/main` at `32278d7531`

### Executive Summary

- The six PRs improve real sync reliability and observability, but they do not resolve any previously identified architectural boundary problem.
- The macro design remains appropriate: keep the modular monolith and its separate browser, API, worker, gateway, and LLM-egress processes.
- The sync recommendation is now more urgent and more specific. Inline sync and worker sync have grown into two compensating state machines: inline owns persisted retry parsing plus heap-timer rearming, while the worker owns separate lock-contention budgets and terminal-status write retries.
- A new boundary finding is confirmed: machine state is encoded in presentation text. Retry progression is parsed from `lastSyncError`, evidence reason codes are rendered into an exception message, and support diagnostics classify errors with regexes over that same message.
- Non-sync fitness signals are unchanged: 45 route/repository exceptions across 36 route files, 2 direct-Prisma violations, 17 server cycles, 32 service-to-WebSocket runtime edges, and no CI invocation of the architecture/Prisma checks.
- The new tooltip implementation is a positive UI boundary improvement, but its E2E spec adds another standalone API simulator; E2E fixture duplication therefore worsened slightly.

### Finding Status Update

| Prior finding | Status on `32278d7531` | Updated evidence | Updated disposition |
| --- | --- | --- | --- |
| Top-level process boundaries | Unchanged / strong | No container, network, gateway, or process-topology changes in the six PRs | Keep separate |
| Inline versus worker sync ownership | Architecturally worsened; operationally improved | `walletSync.ts:122-204,225-493`; `syncJobs.ts:282-520`; core owner files grew from 1,741 to 1,864 lines, plus two new policy helpers | Highest-priority convergence |
| Confirmation updater duplication | Unchanged, with broader evidence | Unused tested implementation at `confirmationUpdater.ts:23-82`; live private copy at `syncService.ts:594-650`; worker copy at `syncJobs.ts:613-679`; wallet-scoped path at `syncCoordinator.ts:165-173` | Converge after sync lifecycle contract |
| Terminal status/retry/lock policy | Reliability improved; ownership worsened | Inline `retryLadder.ts:1-66` and heap timers in `walletSync.ts:397-426`; worker `terminalStatus.ts:1-75` and lock budgets at `syncJobs.ts:286-305` | One lifecycle policy with adapter-specific scheduling |
| Event versus direct WebSocket delivery | Slightly worsened | Inline still publishes through event helpers and direct broadcasters; worker adds direct lock-budget terminal broadcasts at `syncJobs.ts:100-117` | One lifecycle publisher |
| Worker contract direction | Worsened | Services still import `worker/jobs/types` and `jobOptions`; worker reconciliation dynamically imports `services/workerSyncQueue` at `syncJobs.ts:192-220` | Move neutral contracts out of `worker/` |
| Durable sync-state contract | New finding | Retry count parsed from `lastSyncError` in `retryLadder.ts:13-65`; rejection reasons rendered into exception text in `rejectedEvidence.ts:12-53`; support classes inferred by regex in `services/supportPackage/collectors/walletSync.ts:46-83`; schema stores only free-form status/error at `schema.prisma:140-147` | Converge before orchestration extraction |
| Route/service/repository enforcement | Unchanged / failing | Same boundary violation; same 45 exceptions across 36 API files | Restore green and require in CI |
| Direct-Prisma enforcement | Unchanged / failing | Same violations in `draftCreate.ts` and `walletSafetyAudit/processRunner.ts`; same 9 explicit exceptions | Restore green and require in CI |
| Server import cycles | Unchanged | 43 circular edges and 17 unique cycle sets at both refs | Retain no-new-cycle ratchet recommendation |
| Service-to-WebSocket coupling | Unchanged by normalized graph metric | 32 runtime edges from 32 service files at both refs | Converge by lifecycle/event slice |
| React Query versus component-local server state | Unchanged | Recent frontend changes touch Tooltip and `index.html`, not wallet/device data ownership | Converge as previously planned |
| Raw React Query keys | Unchanged | Canonical wallet keys coexist with raw/mismatched keys in WebSocket and broadcast hooks | Converge as previously planned |
| Frontend response validation | Unchanged | Same 19 `schema:` uses under `src/api`; recent PRs add no API contracts | Continue feature-by-feature |
| LLM configuration handshake | Unchanged, with caller inconsistency confirmed | Console blocks on failed sync, while suggest/query/analysis/chat paths ignore the sync result | One `ensureLlmProxyConfigured` boundary |
| Gateway manifest/schema split | Reclassified to watch | Separate schema lookup remains protected by a parity contract covering manifest routes | Keep separate until a real drift incident occurs |
| E2E API simulators | Worsened | E2E TypeScript grew 10,610 -> 10,853 lines; `balance-history` fixture sites 12 -> 13; new `wallet-sync-tooltip.spec.ts:75-147` owns another parser/map/dispatcher | Raise fixture convergence priority |
| Tooltip ownership | Improved | Shared Tooltip now portals to `document.body` and centralizes dismiss/reposition behavior at `Tooltip.tsx:33-188` | Preserve |

### Revised Canonical Path Decisions

| Area | Canonical path | Paths to retire or wrap | Compatibility policy | Decision needed |
| --- | --- | --- | --- | --- |
| Durable sync state | Typed current-state columns on `Wallet`: execution owner, retry count, next retry time, started time, and a monotonic state version | Parsing retry/control state and diagnostic class from `lastSyncError` text; no duplicate attempt-history table | Keep `lastSyncError` as user-readable/backward-compatible presentation; BullMQ remains the durable worker attempt record | Resolved: explicit wallet columns |
| Sync execution | One application use case owns state transitions and outcome; inline and BullMQ paths are scheduling/lock adapters | Independent inline and worker lifecycle state machines | Preserve the newly fixed lock, retry, cancellation, and terminal-write semantics; retain inline availability fallback and synchronous/manual execution | Resolved: retain inline fallback |
| Sync publication | One `SyncLifecyclePublisher` consumes persisted typed transitions and emits event bus/WebSocket effects exactly once | Direct event plus direct broadcast calls in inline sync; worker-only direct broadcasts | PostgreSQL is authoritative; Redis/WebSocket remains best-effort and reconnect invalidates/refetches state | Resolved: no outbox for replaceable sync snapshots |
| Queue contracts | Neutral, versioned sync command/result/lock policy contracts owned outside `worker/` | Service imports from worker implementation; worker dynamic import of queue service | Preserve BullMQ payload compatibility | None |
| E2E API simulation | One strict baseline simulator with scenario overrides | New and existing per-spec bootstrap maps | Preserve explicit failures and `unhandledRequests` assertions | None |

### Revised Convergence Order

| Order | Work | Why the order changed | Exit criteria |
| ---: | --- | --- | --- |
| 0 | Restore architecture and Prisma checks to green and wire them into required CI | Still unchanged after six PRs; documentation remains unenforced | Local implementation complete; pending PR delivery |
| 1 | Define canonical structured sync status/failure/retry contracts and persistence | Recent fixes now depend on parsing presentation text; consolidating first would codify that coupling | Retry progression and support classification do not parse `lastSyncError`; legacy message remains readable |
| 2 | Extract one sync-attempt lifecycle/use case and route inline/worker execution through it | Two policy-bearing state machines expanded independently in the recent PRs | Shared transition contract passes through both adapters for success, retry, timeout, cancellation, lock contention, and terminal-write failure |
| 3 | Move queue contracts out of `worker/` and remove the worker-to-queue-service dynamic import | Recent stranded-resync logic confirms bidirectional ownership | Producer and consumer depend on neutral contracts; dependency direction is one-way |
| 4 | Add one lifecycle publisher and collapse confirmation refresh implementations | Duplicate publication and four confirmation paths remain | Exactly one external lifecycle publication per transition; one confirmation workflow owner |
| 5 | Consolidate the E2E baseline API simulator, starting with `wallet-sync-tooltip.spec.ts` | The latest UI PR repeated the known fixture fan-out pattern | Tooltip spec is a thin scenario override; common bootstrap endpoints have one definition |
| 6 | Continue frontend query ownership/keys/contracts, route/repository debt, LLM handshake, and cycle removal | No recent PR changed their evidence or relative risk | Existing phase-specific ratchets continue |

### Implementation Decisions And Acceptance Gates

- Phase 0 keeps the current 45 reviewed route/repository exceptions as a non-increasing budget, inventories the 17 existing server cycle sets exactly, and fails CI for a new exception or changed cycle set. The route and Prisma violations named above are fixed at their ownership boundaries rather than added as exceptions.
- Phase 1 stores current sync execution state on `Wallet`, not in an attempt-history table. It adds explicit execution ownership so restart recovery cannot confuse an inline timer with a durable BullMQ retry. A migration preserves readable legacy errors while removing retry progression from presentation text.
- Phase 2 retains in-process execution as a supported worker-unavailable fallback. Inline and worker adapters must pass the same lifecycle transition tests while retaining their distinct retry schedulers, lock fencing, cancellation, and terminal-write recovery.
- Phase 3 moves commands, results, and lock policy types to a neutral sync contract module. No service may import worker implementation modules and the worker may not dynamically import the queue service after this phase.
- Phase 4 persists a transition before publishing it. Publication failure cannot roll back or reclassify a successful sync; reconnect invalidates/refetches authoritative wallet state, and stale event versions cannot regress the cache. No transactional outbox is introduced for replaceable sync snapshots.
- Phase 5 introduces an exact method/path simulator with explicit scenario override precedence, records every unknown request before a standardized 404, and repairs all balance-history fixtures to the live `{ name, value }` contract without adding permissive catch-all behavior.
- Phase 6 is a fresh bounded re-audit. Remaining broad themes are implemented only when a concrete owner, compatibility policy, acceptance gate, and independently mergeable scope can be established; otherwise they are recorded as deferred rather than treated as an unbounded refactor mandate.

### Edge Cases

- Preserve every reliability behavior added by #855-#858. Convergence is not permission to simplify away lock fencing, bounded contention, restart-safe retries, terminal-write retries, cancellation, or stranded-resync recovery.
- A structured failure code must not persist secret material or raw remote evidence. Store bounded enum-like classification and safe metadata; keep sensitive detail in scoped logs.
- `lastSyncError` remains part of UI, support, MCP, and assistant output. Migrate readers before changing its wording and keep a compatibility projection until all machine readers use structured fields.
- BullMQ retry count and application retry count are different concepts. Name and model them separately even if one adapter maps between them.
- Inline fallback is a real availability decision, not merely legacy code. If retained, it must pass the same lifecycle contract tests as worker execution.
- The gateway manifest/schema split is not selected for work while its parity test prevents drift; avoid convergence for its own sake.

### Deferred Or Rejected

- Do not revert or broadly rewrite the six incident fixes; they are the behavioral baseline for later consolidation.
- Do not create a generic workflow engine. A sync-specific state contract and use case are sufficient.
- Do not introduce a microservice, general IoC container, or event-sourcing system to solve these ownership problems.
- Do not move all E2E behavior into a permissive catch-all fixture; strict unknown-request failure remains valuable.

### Verification Notes

- Phase 0 local implementation passed `check:architecture-boundaries` with 45 reviewed exceptions, `check:prisma-imports` with 968 checked files and 80 allowed files, and the new server cycle baseline with 17 known cycle sets and 43 exact circular edges.
- Phase 0 full server unit coverage passed: 598 files, 14,036 tests, and 100% statements, branches, functions, and lines. Server build/test typecheck, root test typecheck, lint, workflow composition (289 assertions), focused boundary tests, and `git diff --check` also passed.
- Independent Phase 0 review found two gaps in the first draft: cycle member sets could hide new internal edges, and audit CLI dependency wiring had lost direct coverage. Exact circular-edge inventory and an importable/tested CLI entry wrapper closed both findings.
- Fetched `origin/main`; local `main` remained at `2a14f8088a` and was not fast-forwarded. Target was audited from an isolated archive at `32278d7531` so unrelated untracked planning files remained untouched.
- `git diff --stat HEAD..origin/main`: 47 files, 3,416 insertions, 195 deletions, concentrated in sync, distributed locks, support diagnostics, Tooltip, and tests.
- Architecture checker failed identically at both refs on `api/transactions/broadcasting.ts -> repositories/draftSigningIntentRepository.ts`.
- Prisma checker failed identically at both refs on `services/draftCreate.ts` and `services/walletSafetyAudit/processRunner.ts`.
- Dependency-cruiser comparison: 17 unique server cycle sets and 32 service-to-WebSocket runtime edges at both refs.
- OpenAPI route coverage passed on target: 347 Express routes, 343 OpenAPI operations, and 4 documented infrastructure/docs exceptions.
- No workflow invokes `check:architecture-boundaries`, `check:prisma-imports`, or `check:openapi-route-coverage`; the six PRs did not change those scripts or policies.
- Static target inventories using the same audit method: 187 API files, 36 direct-repository route files, 45 route exceptions, 19 frontend API schema uses, 10,853 E2E TypeScript lines, and 13 `balance-history` E2E fixture sites.
- The preceding audit evidence was analysis-only. Phase 0 implementation now exists on `codex/implement-merge/rationalization-phase-0`; PR delivery is pending.
