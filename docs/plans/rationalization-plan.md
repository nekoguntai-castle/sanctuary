# Rationalization Plan

Date: 2026-05-15
Owner: Codex
Status: Original queue complete; optional follow-up queue complete through Phase P; Phase Q low-priority touched-code cleanup remains, with Q1 shared value-contract cleanup active
Scope: repo-wide divergence scrub focused on auth, Bitcoin network identity, transaction broadcast naming, LLM provider management, preference patch semantics, and later contract/runtime drift follow-up queues

## Executive Summary

- Phases 1-6 are merged. The scrub converged the highest-risk auth session payload drift, frontend/shared auth type drift, canonical Bitcoin network values, ambiguous raw Bitcoin broadcast naming, unsupported Sanctuary-managed model installation/deletion, and nested preference patch/rollback drift.
- Sanctuary-managed model pull/delete/install/download surfaces are removed while the LLM egress proxy security boundary remains as an intentional isolation layer for provider egress, credentials, endpoint policy, and sanitized context access.
- Nested preference path reads, nested patch construction, and optimistic rollback now use shared helpers without replacing backend validation, backend canonical storage, or the current top-level preference patch contract.
- No non-hardware rationalization phase remains in the original six-phase queue. The physical hardware test remains a separate manual/external validation item.
- A fresh 2026-05-14 reanalysis did not reopen those merged phases, but it found a new follow-up queue: wallet role/capability contracts, Bitcoin script and wallet/account type identity, node/Electrum config projection, stale contract-test helper constants, and login health probing were the consolidation candidates worth addressing next. Subsequent 2026-05-15 independent reviews confirmed that order, and Phases A, B, B2, C, D, and E have since merged.
- The post-Phase-E optional queue through Phase I also merged: feature flag env bindings, actionable draft status reuse, AI provider type parity across the proxy boundary, and transaction type boundary naming are closed.
- Current review status: no completed phase is reopened, and the physical hardware test remains the only deferred external validation item. The post-Phase-I queue is merged through Phase P: sync priority validation closed in PR #474, mempool estimator defaults closed in PR #475, gateway deploy/runtime contracts closed in PR #476, transfer route validation closed in PR #477, UTXO selection route validation closed in PR #478, websocket protocol ownership closed in PR #479, frontend API hygiene closed in PR #480, and UTXO selection strategy ownership closed in PR #481. The remaining Phase Q queue is low-priority touched-code cleanup rather than one coherent high-risk implementation slice; the active Q1 slice is shared value ownership for admin agent, device role, RBF status, and privacy grade contracts.

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
| Q1 | Centralize first low-risk shared value contracts | Admin agent values, device roles, RBF statuses, privacy grades, related OpenAPI/server/frontend contracts | Shared constants tests, OpenAPI parity, focused boundary tests, typechecks, negative production tuple searches | Active; keep unrelated Phase Q cleanup deferred |

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
- The stale `sanctuary-llm-egress-proxy -> ai` install-helper comment should not be treated as evidence of a live AI container because compose and image searches show only `llm-egress-proxy`.

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
| Stale LLM proxy comment | Clean the installer helper comment that still maps `sanctuary-llm-egress-proxy -> ai` so the install/testing docs match the renamed security boundary. This should not be mixed with runtime proxy changes. | `git diff --check`; installer-helper shell tests only if the surrounding script behavior changes. |

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
- The J/K/L/M/M2/N/O/P follow-up queue is closed. The remaining findings are lower-risk touched-code cleanup candidates rather than the kind of active divergent path that justified the earlier phases.
- UTXO selection strategies now have a shared public owner after Phase P. Future coin-control work should derive from `UTXO_SELECTION_STRATEGIES` and keep any internal transaction-builder modes separate from the public select/compare API.
- Phase Q should be executed only as bounded sub-slices. The first active sub-slice is shared value-contract ownership for admin wallet-agent statuses/severities, device roles, RBF statuses, and privacy grades; device connection/vendor normalization, price-provider fallback, LLM egress env accessors, and `API_BASE_URL` export cleanup stay out of that PR unless fresh source evidence makes one of them the touched domain.
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
| Websocket protocol ownership | PR #479 made `shared/types/websocket.ts` own active client message names, server event names, batch subscribe/unsubscribe messages, acknowledgements, classifiers, and channel builders. Frontend websocket senders/hooks and server schemas/fanout now derive from that shared owner, active frontend `modelDownload` typing is gone, and notification broadcasts route through typed broadcast/gateway-forwarding helpers while preserving the optional no-server local skip. | Closed. The legacy envelope and channel names remain compatible, while current protocol names and channel helpers now have one owner. | Converged in Phase N |
| Frontend API hygiene | PR #480 renamed Payjoin availability/send-attempt status domains, moved selected frontend query params to the central `apiClient.get(..., params)` path, reused existing shared price/fee response types, and extracted low-level PSBT format predicates without broadening flow-specific QR/file/import formats. | Closed. API helper names now distinguish availability from send attempt state; selected query encoding and low-level PSBT predicates now have central owners. | Converged in Phase O |
| Payjoin status naming | PR #480 renamed frontend Payjoin availability status separately from send-attempt status while preserving the `/payjoin/status` wire shape. | Closed. API availability and send attempt state no longer share the same frontend type name. | Converged in Phase O |
| API query parameter construction | PR #480 moved selected ordinary query params in devices, admin backup/features, intelligence, monitoring, and Electrum server API helpers through `apiClient.get(..., params)`. | Closed for the known ordinary query-param drift; any future endpoint-local serialization should be a tested special wire-format exception. | Converged in Phase O |
| Frontend/shared API response type duplicates | PR #480 reused existing shared price and fee response types where ownership already existed; sync response types were left local because the similarly named shared sync status is a different domain. | Closed for the confirmed duplicate shared response types without forcing unrelated sync domains together. | Converged in Phase O |
| PSBT parsing/magic helpers | PR #480 added `utils/psbtFormat.ts` for low-level PSBT magic/base64/hex predicates and migrated QR signing/import callers without collapsing flow-specific validation. | Closed at the low-level predicate layer; accepted encodings remain flow-specific. | Converged in Phase O |
| UTXO selection strategies | Phase P added `UTXO_SELECTION_STRATEGIES`, `DEFAULT_UTXO_SELECTION_STRATEGY`, `UtxoSelectionStrategy`, and `isUtxoSelectionStrategy` in `shared/constants/transactions.ts`. Route validation, service compare/recommendation behavior, OpenAPI, shared/frontend types, and focused tests now derive from that owner; the legacy transaction-builder selector exposes only its implemented `largest_first`/`smallest_first` public-strategy subset. | Closed. Public select/compare strategy values have one owner, `branch_and_bound` is no longer an active strategy value, and compare response ordering/defaults remain covered by tests. | Converged in Phase P |
| Admin agent statuses and severities | Agent status, alert severity/status, and funding override status repeat across frontend admin types, server route schemas, OpenAPI schemas/paths, and admin service types. | No confirmed drift, but active admin contracts can split when statuses expand. | Phase Q1 first slice |
| Server LLM egress env bindings | Central server config exposes `llmEgressProxyUrl`/`llmEgressProxySecret`, while AI config sync and egress proxy auth helpers read `process.env` directly. | Deployment env parsing can drift; security boundary remains justified. | Converge accessor or remove unused central fields |
| Stale installer helper comment | Phase L updated install diagnostics to use the live `llm-egress-proxy` service name and removed the stale Ollama mapping comment. | Residual references to historical `/ai/*` route removals remain only in planning history and negative test context. | Converged in Phase L |
| Device roles | `owner`/`viewer` repeats in shared domain, server device access, events, OpenAPI, and tests. | No drift found; device roles are intentionally a smaller domain than wallet roles. | Phase Q1 first slice, but keep separate from wallet roles |
| RBF statuses and privacy grades | RBF and privacy grade values repeat in shared types, OpenAPI, services, UI, and tests. | Stable value sets with existing behavior coverage. | Phase Q1 first slice, folded into transaction constants without behavior changes |
| Price providers | Server owns provider registry/defaults; frontend currency settings keep a fallback provider list for offline UI. | Offline fallback can stale if server providers change, but the runtime registry is correctly server-owned. | Watch |

### Recommended Follow-Up Order

| Phase | Work | Verification | Exit Criteria |
| --- | --- | --- | --- |
| J | Centralize sync priority values and defaults. | Shared sync tests, sync route validation tests, OpenAPI parity, queue/worker priority tests, typechecks/lint/lizard. | Merged via PR #474. |
| K | Centralize mempool estimator values and default. | Shared/admin/runtime/frontend/OpenAPI tests plus estimator negative searches. | Merged via PR #475. |
| L | Repair gateway runtime/deploy contract drift and document reduced/core prebuilt behavior. | Gateway config/push tests, compose/service checks, offline/install checks, stale-string searches. | Merged via PR #476. |
| M | Align transfer route validation with transfer constants and OpenAPI. | Transfer route/OpenAPI tests, server type/build/coverage/lint/lizard, stale validation searches. | Merged via PR #477. |
| M2 | Validate UTXO selection route inputs against OpenAPI. | UTXO route/OpenAPI tests, server type/build/coverage/lint/lizard, stale validation searches. | Merged via PR #478. |
| N | Centralize websocket protocol ownership. | Shared/frontend/server websocket tests, coverage, type/build/lint/lizard, architecture check, stale protocol searches. | Merged via PR #479. |
| O | Run a frontend API hygiene pass. Rename Payjoin API status to an availability/config status, centralize send-attempt status, replace manual query strings with `apiClient.get(..., params)`, import shared response types where already available, and extract low-level PSBT detection helpers without collapsing intentionally different receive/signing flows. | Payjoin hook/API tests, affected API module tests, query encoding/null tests, QR signing/import tests, typechecks, negative search for manual query construction outside the client and parser utilities. | Merged via PR #480. |
| P | Centralize UTXO selection strategies when coin-control code is next touched. | Shared/route/service/OpenAPI/frontend/legacy selector tests, app/server typechecks, negative production tuple search plus scoped `branch_and_bound` search. | Merged via PR #481. |
| Q1 | Centralize the first shared value-contract slice: admin wallet-agent status, alert severity/status, funding override status, device roles, RBF status, and privacy grades. | Shared constants tests, OpenAPI parity assertions for admin/device/privacy contracts, focused server/admin/device/privacy/UI tests as needed, app/server/shared typechecks, negative tuple and union/cast searches scoped to production. | The moved values have shared-safe owners, frontend/server/OpenAPI types derive from them, privacy UI normalization and RBF/admin UI typing derive from the shared owners, wire values are unchanged, and no wallet-role or transaction-behavior semantics are broadened. |
| Q later | Low-priority cleanup as touched: device connection method/vendor normalization, price-provider offline fallback, server LLM egress env accessors, and `API_BASE_URL` export cleanup. | Focused tests for the touched domain plus negative tuple/accessor searches. | Drift-prone literals, stale comments, and redundant env accessors are reduced without bundling unrelated cleanup into Q1. |

### Post-Phase-I Execution Guardrails

- Keep any remaining cleanup as small touched-code PRs. Phase Q should not become a broad literal-hunting PR; apply it only when nearby work already touches an affected domain or when fresh evidence shows real drift.
- Phase M2 closed with OpenAPI-aligned validation errors for malformed UTXO selection inputs. Future UTXO strategy cleanup should not reopen amount or `scriptType` compatibility unless a separate API migration intentionally changes that contract.
- Phase L closed by choosing documented reduced/core prebuilt images rather than expanding the prebuilt image set. If image inventory expands later, release digest files, stable-release artifact verification, and downstream `sanctuary-umbrel` digest notification inputs must be updated alongside `docker-compose.ghcr.yml` and image publishing.
- Phase N closed while preserving the legacy websocket envelope and channel names. Future websocket cleanup should be a versioned protocol migration, not incidental drift removal.
- Phase O is intentionally narrow frontend API hygiene. Use the central client query path for ordinary query params, but keep endpoint-local serialization only when an endpoint needs a special wire format such as repeated array keys; those exceptions need focused encoding tests.
- Phase P closed by distinguishing public API strategy values from the legacy transaction-builder selector. Future coin-control work should keep deriving public values from `UTXO_SELECTION_STRATEGIES` and should not reintroduce `branch_and_bound` through OpenAPI/frontend types unless the service actually implements and tests it as a supported public strategy.
- Phase Q1 should be a value-contract PR only. It should not normalize hardware vendor aliases, redesign device connection methods, change price-provider bootstrap/offline behavior, alter LLM egress proxy configuration loading, or remove the exported frontend `API_BASE_URL`.
- Backout should be straightforward for public/deploy changes: keep small compatibility adapters or old-name wrappers until the phase's negative search and focused tests prove every active caller has moved.

### Post-Phase-I Edge Cases

The sync-priority, mempool-estimator, gateway, transfer, UTXO route-validation, websocket, frontend API hygiene, and UTXO strategy bullets below are retained as Phase J/K/L/M/M2/N/O/P closeout history; the active cleanup notes now start with the Phase Q as-touched queue.

- Sync priority cleanup must not confuse wallet sync priority (`high`/`normal`/`low`) with Bitcoin fee priority (`fastest`/`fast`/`medium`/`slow`/`minimum`) or unrelated provider priority scores.
- If invalid sync priorities were accepted by old clients, the compatibility decision must be explicit. Rejecting with 400 is cleaner and matches OpenAPI; normalizing to `normal` is a compatibility choice and must be tested.
- Sync request malformed-body and extra-field handling should be explicit. If keeping passthrough/default-normalizing behavior for old clients, OpenAPI should not say `additionalProperties: false` without documenting compatibility; otherwise the route should reject or strip extras intentionally.
- Mempool estimator convergence must preserve DB migration defaults, existing stored `simple` values, explicit admin `simple` selection, runtime fallback on config read failure, and frontend behavior when API data is missing. Prisma schema and migration defaults cannot import TypeScript constants, so they should remain deliberate storage-default literals with parity/search coverage rather than being treated as unowned duplicates.
- Gateway push credential support must not log private keys or require decrypted secrets in config snapshots. File-based and env-based credentials should have deterministic precedence.
- Gateway port cleanup must account for container port versus host port. `GATEWAY_PORT` can mean host mapping in compose, while runtime app port controls the in-container listener.
- Prebuilt image convergence needs a product/deploy decision. Adding gateway/proxy images changes CI publishing, release-digest manifests, downstream Umbrel update inputs, and setup flows; marking prebuilt as reduced/core changes user expectations instead.
- Transfer route validation cleanup must not break existing clients accidentally if invalid filters were previously ignored. If preserving ignore semantics, it should be named as compatibility parsing rather than an unvalidated cast.
- UTXO selection route validation is a route-boundary fix, not strategy convergence. It should preserve accepted integer string/number payloads if clients currently send both, but fail before service calls or `BigInt` for empty, negative, decimal, non-numeric, or unsafe values. `scriptType` should either be validated as a string/known script value or documented as a compatibility passthrough.
- Websocket protocol helpers must keep the current legacy event envelope and subscription protocol until a versioned websocket protocol migration exists. Batch subscribe/unsubscribe messages should stay represented in shared types and runtime schemas. Notification broadcasts should not bypass gateway forwarding unless local-only delivery is an explicit product/runtime decision.
- Payjoin status renaming must avoid changing wire payloads; the problem is frontend domain naming, not the `/payjoin/status` JSON shape.
- UTXO strategy convergence must preserve compare-strategy response keys and ordering, default `efficiency`, recommended-strategy response compatibility, and exhaustive service handling for every public strategy.
- PSBT helper consolidation in Phase O must not broaden accepted QR/file/import formats by accident. Encoding-specific flows should call shared low-level predicates, not one oversized parser with hidden behavior.
- Q1 admin-agent constants must preserve the exact current wire strings for wallet-agent status, alert severity/status, and funding override status. Route validation and OpenAPI enum parity should prove shared ownership; the PR should not introduce new agent lifecycle states.
- Q1 admin alert severity must stay scoped to admin-agent alerts. The identical `info`/`warning`/`critical` intelligence insight severity values already have a separate `INSIGHT_SEVERITY_VALUES` owner and should be treated as a different domain unless a future intelligence contract review says otherwise.
- Q1 device-role constants must stay an owner/viewer hardware-device domain. They must not import signer/approver wallet-role semantics, and malformed stored roles should continue to fail closed rather than becoming owner-capable.
- Q1 RBF and privacy-grade constants should live with transaction constants only as value contracts. They must not change RBF persistence transitions, privacy-score thresholds, UI labels, or compatibility aliases.
- Q1 privacy UI helpers are part of the privacy-grade value contract. `components/privacyScoreUtils.ts` must derive its grade type/guard from the shared owner before Q1 closes; keeping a local `excellent`/`good`/`fair`/`poor` tuple would leave the original UI drift candidate in place.
- Q1 negative searches must include TypeScript union/cast definitions, not only array tuples. The recursive review fix moved local Q1 value definitions in `components/privacyScoreUtils.ts`, `components/WalletDetail/mappers.ts`, `components/AgentWalletDashboard/*`, `types/index.ts`, and `server/src/services/agentMonitoringService.ts` to shared owners, and typed repository admin-agent status/severity boundaries with shared contracts.

### Phase J-P Closeout Addendum - 2026-05-16

- Phase J is closed. PR #474 merged as `13ef9b5c62b83d2e6f23625b656e40c1b2f9f93c`; current `origin/main` has `shared/constants/sync.ts`, and sync route/OpenAPI/queue/worker priority behavior derives from that owner.
- Phase K is closed. PR #475 merged as `a781c8ee768a55a5688021af4b801545a90f5bcc`; current `origin/main` has `NODE_MEMPOOL_ESTIMATOR_VALUES` and `DEFAULT_NODE_MEMPOOL_ESTIMATOR` in `shared/constants/nodeConfig.ts`, with admin/runtime/frontend/OpenAPI consumers deriving from them.
- Phase L is closed. PR #476 merged as `2f92b7d87f1bea812d776b5b1f3ac2e2a334af85`; current `origin/main` has gateway runtime env helpers for `PORT`/`GATEWAY_PORT`, `backend:3001` defaults, file/env push credential loading, `APNS_PRODUCTION`, reduced/core prebuilt docs, and offline/install `llm-egress-proxy` service naming.
- Phase M is closed. PR #477 merged as `d7e675b0c381582f3d62ee4c798aec5d279718aa`; current `origin/main` has transfer route validation deriving resource, role, and status filters from transfer-service constants, typed closed create/decline schemas, invalid-filter 400s, and matching OpenAPI/test coverage.
- Phase M2 is closed. PR #478 merged as `431ef4f1c22fa2765bded9c267cc4bf7c24bb721`; current `origin/main` has UTXO select and compare route schemas that parse positive safe-integer amounts before service calls, reject malformed `scriptType`, close request bodies, and align OpenAPI request schemas and tests.
- Phase N is closed. PR #479 merged as `5566ededd900c6cd92b42223c3a29c3899f73952`; current `origin/main` has shared websocket client messages for batch subscribe/unsubscribe, shared channel helpers, frontend hooks/server fanout derived from shared protocol ownership, no active frontend `modelDownload` event type, and notification broadcasts on the typed gateway-forwarding path.
- Phase O is closed. PR #480 merged as `7aa5726018102e277b822e03d6836822612e9bed`; current `origin/main` has distinct Payjoin availability and send-attempt status names, selected frontend query params using the central client path, shared price/fee response type reuse, and `utils/psbtFormat.ts` owning low-level PSBT predicates.
- Phase P is closed. PR #481 merged as `dbaaa01658be47598014e0e5ae7c80258179aba1`; current `origin/main` has `UTXO_SELECTION_STRATEGIES`, `DEFAULT_UTXO_SELECTION_STRATEGY`, and `isUtxoSelectionStrategy` in `shared/constants/transactions.ts`, with route validation, service compare/recommendation behavior, OpenAPI, shared/frontend types, and tests deriving from that owner. The legacy transaction-builder selector now exposes only its implemented `largest_first`/`smallest_first` subset, and `branch_and_bound` is rejected by the shared guard rather than advertised as public.
- Phase Q is the remaining as-touched cleanup bucket. Current source evidence still shows repeatable but lower-risk candidates such as admin agent status/severity/funding override values across frontend, route schemas, and OpenAPI; device roles in shared/server access code; RBF and privacy grade values in shared/server/OpenAPI paths; hardware vendor normalization in export/import/signing helpers; server LLM egress helpers reading env directly despite central config fields; and an exported frontend `API_BASE_URL` with only internal/test consumers.
- The first Phase Q sub-slice should address only the shared value-contract candidates: admin wallet-agent values, device roles, RBF statuses, and privacy grades. A 2026-05-16 recursive review of the Q1 branch found remaining production tuple/union definitions in `components/privacyScoreUtils.ts`, `components/WalletDetail/mappers.ts`, `components/AgentWalletDashboard/*`, `types/index.ts`, and `server/src/services/agentMonitoringService.ts`; those now derive from shared constants before Q1 merge. The remaining Phase Q candidates stay deferred because they touch different behavior surfaces and need their own focused verification.
- Source checks for this closeout review used `origin/main` at `dbaaa01658be47598014e0e5ae7c80258179aba1`.

### Post-Phase-I Verification Notes

- Static evidence collected with targeted `rg`, `sed`, and subagent read-only inspections across frontend/API, backend/shared/OpenAPI, gateway, proxy, compose, and tests.
- Recursive plan-review passes on 2026-05-16 rechecked the plan after the Phase N, O, and P merges. The current pass updated active status through Phase P and confirmed Phase Q as a low-priority as-touched cleanup bucket rather than a required broad consolidation phase.
- A follow-up recursive plan-review pass on 2026-05-16 tightened Phase Q into a first value-contract sub-slice plus deferred later cleanup, based on current task evidence and targeted source searches.
- The latest recursive plan-review pass found actionable Q1 blockers: negative production searches must include TypeScript unions/casts as well as tuples, because frontend privacy/RBF/admin UI helpers and agent monitoring repeated Q1 value contracts on the Q1 branch. The follow-up implementation removed those production repetitions and re-ran focused tests, type/build/lint checks, lizard, and tuple/union searches.
- No runtime tests were run for the initial planning-only addendum; the follow-up Q1 blocker fix did run focused root/server tests and type/build/lint/lizard checks before delivery.
- Follow-up implementation phases should use focused behavioral tests plus negative searches for the specific tuple/helper they remove.

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
