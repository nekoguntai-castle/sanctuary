# Rationalization Plan

Date: 2026-05-14
Owner: Codex
Status: Complete original queue; follow-up queue in progress; 2026-05-15 fourth independent review addendum recorded
Scope: repo-wide divergence scrub focused on auth, Bitcoin network identity, transaction broadcast naming, LLM provider management, and preference patch semantics

## Executive Summary

- Phases 1-6 are merged. The scrub converged the highest-risk auth session payload drift, frontend/shared auth type drift, canonical Bitcoin network values, ambiguous raw Bitcoin broadcast naming, unsupported Sanctuary-managed model installation/deletion, and nested preference patch/rollback drift.
- Sanctuary-managed model pull/delete/install/download surfaces are removed while the LLM egress proxy security boundary remains as an intentional isolation layer for provider egress, credentials, endpoint policy, and sanitized context access.
- Nested preference path reads, nested patch construction, and optimistic rollback now use shared helpers without replacing backend validation, backend canonical storage, or the current top-level preference patch contract.
- No non-hardware rationalization phase remains in the original six-phase queue. The physical hardware test remains a separate manual/external validation item.
- A fresh 2026-05-14 reanalysis did not reopen those merged phases, but it found a new follow-up queue: wallet role/capability contracts, Bitcoin script and wallet/account type identity, node/Electrum config projection, and stale contract-test helper constants are the consolidation candidates worth addressing next. Subsequent 2026-05-15 independent reviews confirmed that order, with the refinements recorded below.

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

## Convergence Plan

| Phase | Work | Files / Owners | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| 1 | Consolidate server auth session issuance and user response shaping | `server/src/api/auth/*` | Focused auth route tests, server typecheck/lint, lizard, `git diff --check` | Merged via PR #455 |
| 2 | Align frontend auth API types with shared contracts | `src/api/auth.ts`, `src/api/twoFactor.ts`, context mapping | App/test typechecks, focused auth/context tests, app lint | Merged via PR #456 |
| 3 | Consolidate Bitcoin network constants and normalization | `shared/constants/bitcoin.ts`, server/frontend/OpenAPI/Electrum consumers | Bitcoin boundary check, shared build, focused server/frontend tests, typechecks/lint | Merged via PR #457 |
| 4 | Rename raw Bitcoin broadcast helper | `src/api/bitcoin.ts`, API module tests | Negative search for old raw helper, focused API/send tests, typechecks/lint | Merged via PR #458 |
| 5 | Remove Sanctuary-managed model pull/delete/install/download capability while retaining LLM egress isolation | AI Settings, `src/api/ai.ts`, `server/src/api/ai/*`, `server/src/api/llm-egress-internal.ts`, OpenAPI, websocket model-download paths, proxy routes/tests | Negative source search, focused AI/proxy/websocket/OpenAPI tests, app/server typechecks, proxy build, route coverage, lizard, `git diff --check`, current-head PR checks | Merged via PR #459 |
| 6 | Centralize nested preference patch helpers and rollback semantics | `hooks/useUserPreference.ts`, `contexts/UserContext.tsx`, `utils/preferencePaths.ts`, wallet/device list preference hooks, Telegram/autopilot server settings | Focused preference tests for nested reads/patches, unsafe keys, arrays, scalar/object replacement, stale rollback, localStorage fallback, server feature sibling preservation; full frontend coverage; typechecks/lint/lizard | Merged via PR #460 |

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

## Edge Cases

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

- This plan was reviewed against `tasks/todo.md`, current branch status, active AI/OpenAPI/proxy files, gateway route manifest, and targeted `rg` searches on 2026-05-14.
- The 2026-05-14 reanalysis addendum was reviewed against current auth registration/login code, wallet role/capability paths, script type definitions, node/Electrum config projection paths, LLM proxy/provider contracts, feature flag definitions, gateway parity tests, and stale contract-test helpers. Documentation verification passed with `git diff --check`.
- The 2026-05-15 independent review rechecked wallet role/capability paths, script/account type constants, node config projection, contract helper constants, transaction type vocabulary, LLM provider boundaries, gateway route validation, feature flags, registration ordering, and login/refresh fetch boundaries with targeted `rg`/`sed` searches. Documentation verification passed with `git diff --check`.
- The 2026-05-15 plan detail review added phase-specific implementation notes and corner cases for wallet roles, script/account types, node config projection, contract helper repair, and login health. Documentation verification passed with `git diff --check`.
- The 2026-05-15 second independent review rechecked wallet capability derivation and UI defaults, device role separation, parser-only script/account values, sync-status domain names, node config projection, contract helper constants, LLM provider boundaries, gateway routing, and feature flags with targeted `rg` searches. Documentation verification passed with `git diff --check`.
- The 2026-05-15 third independent review rechecked the in-progress Phase A working tree against the ranked findings. It found and fixed the remaining direct send-page capability gap and mobile-permission OpenAPI role tuple drift, then passed focused tests, typechecks, lint, lizard, server build, OpenAPI route coverage, negative wallet-role searches, and `git diff --check`.
- The 2026-05-15 fourth independent review rechecked the current Phase B branch state against wallet roles, script/wallet/account identity, node/Electrum projection, contract-helper constants, login health fetch behavior, gateway route validation, feature flags, transaction type aliases, and external-LLM/model-management fallout with targeted `rg`/`sed` searches. It confirmed the Phase B/C/D/E order and added a small B2 copy/docs/type-name cleanup for stale external-LLM-only language.
- Phase 5 PR #459 merged as `42abe4d893420661482e73ddbd9a1f4aff271bd2` and the merge commit was verified on `origin/main`.
- Phase 6 PR #460 passed required Architecture, Build Dev Images summary, Code Quality, and Test Suite checks on head `38d6231090736094593f75e476e3e0f0be7fff6a`, then squash-merged as `26bbd2d052afe1e22421107dea77b6597e873f4c`.
- The Phase 6 merge commit was verified as an ancestor of `origin/main`; local `main` was fast-forwarded to `26bbd2d052afe1e22421107dea77b6597e873f4c`; the local and remote Phase 6 branches were deleted.
- Local Phase 6 verification passed: focused preference tests, full frontend coverage at 100% across 6112 tests, server nested settings tests, app/test/server typechecks, app/server lint, touched-file lizard, test hygiene, large-file classification, architecture graph regeneration, and `git diff --check`.
