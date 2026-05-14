# Rationalization Plan

Date: 2026-05-14
Owner: Codex
Status: Complete
Scope: repo-wide divergence scrub focused on auth, Bitcoin network identity, transaction broadcast naming, LLM provider management, and preference patch semantics

## Executive Summary

- Phases 1-6 are merged. The scrub converged the highest-risk auth session payload drift, frontend/shared auth type drift, canonical Bitcoin network values, ambiguous raw Bitcoin broadcast naming, unsupported Sanctuary-managed model installation/deletion, and nested preference patch/rollback drift.
- Sanctuary-managed model pull/delete/install/download surfaces are removed while the LLM egress proxy security boundary remains as an intentional isolation layer for provider egress, credentials, endpoint policy, and sanitized context access.
- Nested preference path reads, nested patch construction, and optimistic rollback now use shared helpers without replacing backend validation, backend canonical storage, or the current top-level preference patch contract.
- No non-hardware rationalization phase remains in this queue. The physical hardware test remains a separate manual/external validation item.

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
- Do not treat the physical hardware test as blocked by this code rationalization queue. It remains the one manual validation item outside the non-hardware phases documented here.

## Verification Notes

- This plan was reviewed against `tasks/todo.md`, current branch status, active AI/OpenAPI/proxy files, gateway route manifest, and targeted `rg` searches on 2026-05-14.
- Phase 5 PR #459 merged as `42abe4d893420661482e73ddbd9a1f4aff271bd2` and the merge commit was verified on `origin/main`.
- Phase 6 PR #460 passed required Architecture, Build Dev Images summary, Code Quality, and Test Suite checks on head `38d6231090736094593f75e476e3e0f0be7fff6a`, then squash-merged as `26bbd2d052afe1e22421107dea77b6597e873f4c`.
- The Phase 6 merge commit was verified as an ancestor of `origin/main`; local `main` was fast-forwarded to `26bbd2d052afe1e22421107dea77b6597e873f4c`; the local and remote Phase 6 branches were deleted.
- Local Phase 6 verification passed: focused preference tests, full frontend coverage at 100% across 6112 tests, server nested settings tests, app/test/server typechecks, app/server lint, touched-file lizard, test hygiene, large-file classification, architecture graph regeneration, and `git diff --check`.
