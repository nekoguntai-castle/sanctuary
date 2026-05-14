# Rationalization Plan

Date: 2026-05-14
Owner: TBD
Status: Draft, phased implementation in progress
Scope: repo-wide divergence scrub focused on auth, Bitcoin network identity, transaction broadcast naming, LLM provider management, and preference patch semantics

## Executive Summary

- Completed phases already converged the highest-risk auth session payload drift, frontend/shared auth type drift, canonical Bitcoin network values, and ambiguous raw Bitcoin broadcast naming.
- Current priority is Phase 5: keep the LLM egress proxy as a security boundary for external providers, but remove Sanctuary-managed model pull/delete/install/download surfaces.
- Next priority is Phase 6: centralize nested preference patch construction and rollback semantics without replacing backend validation or canonical storage.

## Divergence Inventory

| Area | Paths | Current Behavior | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| Auth session success responses | Register, password login, 2FA verify | Previously issued sessions and shaped user payloads in multiple route-local paths | Phase 1 review in `tasks/todo.md`; PR #455 merged | Converged |
| Frontend auth API types | `src/api/auth.ts`, `src/api/twoFactor.ts`, `shared/types/api.ts` | Frontend duplicated shared/server response contracts | Phase 2 review in `tasks/todo.md`; PR #456 merged | Converged |
| Bitcoin network identity | Shared constants, server helpers, frontend tabs, OpenAPI, Electrum modules | Multiple tuples/unions encoded overlapping network values and legacy `testnet` normalization | Phase 3 review in `tasks/todo.md`; PR #457 merged | Converged with narrow aliases kept |
| Transaction broadcast names | `src/api/bitcoin.ts` raw broadcast vs `src/api/transactions` wallet broadcast | Different operations shared the same frontend helper name | Phase 4 review in `tasks/todo.md`; PR #458 merged | Converged by renaming raw helper |
| LLM provider model management | Frontend AI Settings, backend `/ai/pull-model` and `/ai/delete-model`, proxy `/pull-model` and `/delete-model`, websocket pull progress | Product policy is external LLMs only; Sanctuary should not install/delete provider models | Active Phase 5 worktree and `rg` results | Remove unsupported surface |
| LLM egress isolation | Backend service, proxy routes, endpoint policy, provider credentials, sanitized internal AI context | Proxy still provides security value even without model management | User clarification and existing proxy architecture | Keep separate as security boundary |
| Gateway route manifest vs validation map | `GATEWAY_ROUTE_CONTRACTS` and `ROUTE_SCHEMAS` | Manifest parity tests guard route exposure; schemas remain separate | Completed gateway manifest task in `tasks/todo.md` | Watch |
| Nested preference patches | `useUserPreference`, `UserContext`, list preference hooks, notification sounds, server feature settings | Patch construction and rollback behavior are recreated at several call sites | Phase 6 notes in `tasks/todo.md`; `rg` over preference paths | Converge in small helper pass |

## Canonical Path Decisions

| Area | Canonical Path | Paths To Retire Or Wrap | Compatibility Policy | Decision Needed |
| --- | --- | --- | --- | --- |
| Auth success session | Shared server session response helper | Route-local cookie/user response shaping | Preserve cookie-only JSON contract and existing failure ordering | None |
| Auth frontend contracts | Shared auth request/response/user types | Frontend-local duplicate interfaces | Preserve pending-verification and 2FA-required discriminants | None |
| Bitcoin network values | `@sanctuary/shared/constants/bitcoin` | Local full-network tuples and ad hoc legacy normalization | Keep narrower UI/sync/mempool subsets as derived aliases | None |
| Raw Bitcoin broadcast helper | `bitcoinApi.broadcastRawNetworkTransaction` | `bitcoinApi.broadcastTransaction` raw helper alias | No compatibility alias; backend route path remains `/bitcoin/broadcast` | None |
| LLM provider models | Provider model listing and explicit selected model string | Pull/delete routes, model-download websocket, popular download lists, system resource readiness checks | Preserve existing saved selected model strings and external Ollama provider support | None |
| LLM proxy security | `llm-egress-proxy` as egress isolation layer | Any naming/copy implying model hosting or local runtime ownership | Keep allowlists, CIDR policy, provider credentials, proxy secret auth, sanitized context routes | None |
| Preference patches | Shared helper for nested path reads and patch construction plus request-generation-aware rollback | Call-site-specific nested merge code | Backend schemas/canonicalization remain source of truth | None |

## Convergence Plan

| Phase | Work | Files / Owners | Verification | Exit Criteria |
| --- | --- | --- | --- | --- |
| 1 | Consolidate server auth session issuance and user response shaping | `server/src/api/auth/*` | Focused auth route tests, server typecheck/lint, lizard, `git diff --check` | Merged via PR #455 |
| 2 | Align frontend auth API types with shared contracts | `src/api/auth.ts`, `src/api/twoFactor.ts`, context mapping | App/test typechecks, focused auth/context tests, app lint | Merged via PR #456 |
| 3 | Consolidate Bitcoin network constants and normalization | `shared/constants/bitcoin.ts`, server/frontend/OpenAPI/Electrum consumers | Bitcoin boundary check, shared build, focused server/frontend tests, typechecks/lint | Merged via PR #457 |
| 4 | Rename raw Bitcoin broadcast helper | `src/api/bitcoin.ts`, API module tests | Negative search for old raw helper, focused API/send tests, typechecks/lint | Merged via PR #458 |
| 5 | Remove Sanctuary-managed model pull/delete/install/download capability while retaining LLM egress isolation | AI Settings, `src/api/ai.ts`, `server/src/api/ai/*`, `server/src/api/llm-egress-internal.ts`, OpenAPI, websocket model-download paths, proxy routes/tests | Negative source search, focused AI/proxy/websocket/OpenAPI tests, app/server typechecks, proxy build, route coverage, lizard, `git diff --check` | No tracked route, UI, OpenAPI, mock, or test advertises pull/delete/system-resource model management |
| 6 | Centralize nested preference patch helpers and rollback semantics | Preference hooks/context and targeted server feature preference settings | Focused preference tests for nested merges, unsafe keys, arrays, races, localStorage fallback; typechecks/lint/lizard | Call sites use one helper where behavior should match; backend canonicalization remains authoritative |

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
- Phase 6 optimistic updates need request generation or key-scoped rollback so a failed earlier write does not overwrite a later successful local update.
- Phase 6 must preserve unauthenticated localStorage fallback, invalid JSON fallback, null/absent preference defaults, and backend canonicalization for `fiatCurrency` and `selectedNetwork`.
- Phase 6 should include server feature settings in the review boundary. Telegram, autopilot, and intelligence settings also write nested preference objects and can overwrite siblings if they rebuild stale snapshots.

## Deferred Or Rejected

- Do not merge raw `/bitcoin/broadcast` and wallet-scoped transaction broadcast endpoints. They are intentionally different operations.
- Do not remove the LLM egress proxy just because model management is removed. It still controls network egress, credentials, and sanitized context boundaries.
- Do not redo gateway routing in Phase 6 unless a new route-schema change makes the existing manifest parity tests insufficient.
- Do not build preference deletion semantics in the helper pass. The current backend patch contract does not define deletion.

## Verification Notes

- This plan was reviewed against `tasks/todo.md`, current branch status, active AI/OpenAPI/proxy files, gateway route manifest, and targeted `rg` searches on 2026-05-14.
- Current worktree is mid-Phase 5 on `codex/phase-5-remove-model-management`; implementation and tests are not complete yet.
- The current source scan still shows Phase 5 test/mocks cleanup remaining for pull/delete/system-resource/model-download terms.
