# Active Task: Console Auto Context Inference 2026-04-27

Status: complete

Goal: keep explicit Console context overrides available, but make `Auto` the default so the prompt, current route, and accessible wallet names drive tool selection naturally.

## Plan

- [x] Add a user-facing `Auto` context option and make it the default Console selection.
- [x] Send current route wallet context from the UI only as an inference hint, not as permission.
- [x] Resolve Auto server-side into an internal wallet permission envelope from wallets the actor can access.
- [x] Pass auto context hints to the planner/synthesis path and harden deterministic fallback so ambiguous prompts do not fan out across every wallet by accident.
- [x] Add focused UI/API/server/proxy tests, run verification, and rebuild the local containers.

## Review

- Implementation: Console now defaults to `Auto` context while keeping explicit overrides for `General network`, `All visible wallets`, and individual wallets. Auto sends `clientContext` from the UI instead of an explicit user scope; the current route wallet is only an inference hint.
- Permission model: the server resolves Auto into an internal wallet permission envelope from wallets the actor can actually access. The planner receives wallet names/current-wallet context for intent inference, but authorization still comes from the server's accessible wallet set and existing scope/tool checks.
- Planner behavior: Auto uses the current wallet for route-specific prompts, an accessible named wallet when the prompt matches a wallet name, and all wallets only for prompts that explicitly ask for all/every/across-wallet/portfolio context. Ambiguous Auto wallet prompts now produce no deterministic wallet fallback instead of fanning out accidentally.
- Verification: focused UI/API/proxy tests passed (47 tests), focused server Console/API tests passed (41 tests), `npx tsc -p ai-proxy/tsconfig.json --noEmit`, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, `npm run lint:app`, `npm run lint:server`, touched-file lizard, and `git diff --check` passed.
- Local rebuild: `./start.sh --rebuild` completed. `https://localhost:8443` returned HTTP 200, and the rebuilt Sanctuary gateway, frontend, AI proxy, backend, worker, Postgres, and Redis containers are healthy by `docker ps -a`.

---

# Active Task: Console All-Wallet Scope 2026-04-27

Status: complete

Goal: let Sanctuary Console run against all wallets visible to the current user, while keeping server-side wallet access checks authoritative.

## Plan

- [x] Confirm existing backend support for `wallet_set` scopes and per-wallet access checks.
- [x] Add an explicit all-visible-wallets Console scope in the flyout.
- [x] Teach planner fallback/prompting how to use wallet sets for all-wallet transaction and dashboard-style prompts.
- [x] Prevent multi-wallet transaction plans from auto-navigating to one arbitrary wallet.
- [x] Add focused regression coverage, run verification, and rebuild the local containers.

## Review

- Implementation: Console scope selection now offers `All visible wallets` when the current user has wallets. It sends a `wallet_set` scope built from the visible wallet IDs, capped at the backend's current 25-wallet scope limit, and falls back to general when no wallet IDs remain.
- Permission model: backend `wallet_set` handling was already present. `assertScopeAccess` re-checks every wallet ID with `walletRepository.findByIdWithAccess`, and tool execution still denies wallet tool inputs outside the selected scope.
- Planner/navigation behavior: the AI proxy planning prompt now describes wallet-set behavior, deterministic fallback can fan out obvious transaction prompts across scoped wallets within the per-turn tool budget, and all-wallet summary prompts can fall back to `get_dashboard_summary`. Console transaction auto-navigation now requires exactly one valid transaction query so all-wallet transaction plans do not open an arbitrary wallet.
- Verification: focused Console/proxy/navigation tests passed (37 tests), focused server console protocol/tool-execution tests passed (13 tests), `npx tsc -p ai-proxy/tsconfig.json --noEmit`, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, pinned touched-file lizard, and `git diff --check` passed.
- Local rebuild: `./start.sh --rebuild` completed. `https://localhost:8443` returns HTTP 200, and the rebuilt Sanctuary frontend, gateway, backend, worker, AI, Postgres, and Redis containers are healthy by `docker ps -a`.

---

# Active Task: Transaction AI Search Cookie Auth Fix 2026-04-27

Status: complete

Goal: fix the rebuilt Transactions tab AI search failure where browser cookie-authenticated requests reach `/api/v1/ai/query` but the backend forwards an empty bearer token to the AI proxy's internal wallet-context fetch.

## Plan

- [x] Inspect live backend and AI proxy logs for the failing transaction AI search request.
- [x] Forward the authenticated access token from either bearer header or `sanctuary_access` cookie to AI proxy query/label calls.
- [x] Add focused API regression coverage for cookie-authenticated AI query and label routes.
- [x] Run focused verification and rebuild the local containers.

## Review

- Root cause: `/api/v1/ai/query` accepted the browser's cookie-authenticated request, but the AI route forwarded only `Authorization` header bearer tokens to the AI proxy. Browser sessions use the `sanctuary_access` HttpOnly cookie, so the proxy called `/internal/ai/wallet/:id/context` with an empty bearer and received 401.
- Implementation: exported the shared access-token extractor from `middleware/auth` and reused it in AI feature routes for both `/ai/query` and `/ai/suggest-label`. This keeps bearer clients working and forwards cookie-authenticated browser sessions correctly.
- Verification: focused server AI route/service tests passed (`ai.test`, `aiService`, 99 tests), `npm run typecheck:server:tests`, `npm run lint:server`, `npm run typecheck:app`, `npm run typecheck:tests`, pinned touched-file lizard `CCN <= 15`, and `git diff --check` passed.
- Local rebuild: `./start.sh --rebuild` completed. Sanctuary is live at `https://localhost:8443`; `curl -k -I https://localhost:8443` returned HTTP 200. The rebuilt frontend, gateway, backend, worker, AI, Postgres, and Redis containers are healthy by `docker ps`.

---

# Active Task: Wallet Transaction AI Search Repair 2026-04-27

Status: complete

Goal: restore the wallet Transactions tab AI search/filter control while keeping Console navigation as the broader assistant path.

## Plan

- [x] Trace the transaction-page AI search submit path and recent Console navigation changes for interference.
- [x] Fix the broken transaction AI filter behavior without removing the control and align it with the Console planner path.
- [x] Add or update focused tests for transaction AI search applying and clearing filters.
- [x] Run focused verification and rebuild the local containers if code changes affect the running UI.

## Review

- Decision: keep the wallet Transactions tab AI search. It is the in-context table-filter control, while Console remains the broader assistant and navigation surface.
- Implementation: `/ai/query` now uses the same Console planner message path and `query_transactions` tool-call shape, then adapts the planned call back into the transaction table filter model. The adapter keeps table-specific support for labels, sort, aggregation, confirmations, amount ranges, and explicit limits. Date fallback is based only on the user's prompt, not injected label/tool context.
- UI filter behavior: the transaction AI filter now accepts Console-style `sent`/`received` type values, `dateFrom`/`dateTo`, and `minAmount`/`maxAmount`, sharing the Console route-state date parsing helper.
- Verification: focused tests passed (`naturalQuery`, `useAITransactionFilter`, `AIQueryInput`, `consoleTransactionNavigation`; 73 tests), `npx tsc -p ai-proxy/tsconfig.json --noEmit`, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, pinned touched-file lizard `CCN <= 15`, and `git diff --check` passed.
- Local rebuild and smoke: `./start.sh --rebuild` completed. Sanctuary is live at `https://localhost:8443`; `curl -k -I https://localhost:8443` returned HTTP 200. The rebuilt frontend, gateway, backend, worker, AI, Postgres, and Redis containers are healthy by `docker ps`. A compiled AI-proxy smoke against LM Studio `http://10.114.123.214:1234/v1` with model `unsloth/qwen3.6-35b-a3b` converted `show me transactions between feb 2020 and june 2020` into a transaction date filter.

---

# Active Task: Console Transaction Navigation 2026-04-27

Status: complete

Goal: let a Console prompt such as `show me transactions between feb 2020 and june 2020` open the wallet Transactions tab and apply the matching table filter when the Console planner selects `query_transactions`.

## Plan

- [x] Document the Console-to-transactions navigation plan.
- [x] Add shared UI helpers to extract transaction navigation from Console results.
- [x] Wire Console completion to navigate and Wallet Detail to apply route-state filters.
- [x] Add focused tests and run verification.
- [x] Rebuild the local containers and smoke-check.

## Review

- Implementation: Console now derives a default wallet scope when opened from a wallet route, so prompts issued from `/wallets/:id` can use the current wallet without manually selecting it. Completed Console turns are inspected for a planned `query_transactions` call; when present, the UI navigates to `/wallets/:walletId` with the Transactions tab active and passes the planner's date/type inputs as route state.
- Destination behavior: Wallet Detail reads the Console transaction route state, clears stale manual and AI transaction filters, and applies the date/type constraints through the existing transaction filter hook. The drawer closes after navigation unless it is pinned open.
- Verification: focused tests passed (`ConsoleDrawer`, `consoleTransactionNavigation`, `useTransactionFilters`, `TransactionsTab`; 79 tests), `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, production touched-file lizard `CCN <= 15`, and `git diff --check` passed.
- Local rebuild and smoke: `./start.sh --rebuild` completed. Sanctuary is live at `https://localhost:8443`; frontend, gateway, backend, worker, AI, Postgres, and Redis containers are healthy. `curl -k -I https://localhost:8443` returned HTTP 200. After syncing the saved AI config, the rebuilt backend planner selected `query_transactions` for `show me transactions between feb 2020 and june 2020` with wallet `da17d9d4-c760-4929-a207-2a45c3cadef9` and dates `2020-02-01` through `2020-06-30`.

---

# Active Task: LM Studio Planner Empty Message Content 2026-04-27

Status: complete

Goal: fix LM Studio/OpenAI-compatible Console planner failures where the provider response does not include `message.content`.

## Plan

- [x] Inspect AI proxy response parsing and live AI logs for the failed planner response.
- [x] Patch OpenAI-compatible response normalization for local model variants without weakening invalid-response handling.
- [x] Dedupe repeated prompt-history retry entries in the Console flyout.
- [x] Add focused proxy regression tests and run verification.
- [x] Rebuild containers and smoke-check the planner path.
- [x] Add a Console pin-open option that keeps the flyout open during outside clicks and Escape.
- [x] Verify the pinned Console behavior with focused UI tests and rebuild the local instance.

## Review

- Root cause: the LM Studio/OpenAI-compatible planner failure came from a reasoning-model response that returned HTTP 200 with empty `message.content`, useful `message.reasoning_content`, and `finish_reason: "length"`. The AI proxy treated that as a hard invalid response before the Console planner parser or deterministic fallback could run.
- Implementation: the AI proxy now supports non-string OpenAI-compatible content shapes and allows reasoning-content fallback only when a caller opts in. Console planning opts in because it can parse/fallback from planner text, while synthesis keeps strict assistant-content validation. Prompt history now dedupes repeated retry rows by normalized prompt, scope, and sensitivity. The Console flyout also has a pin/unpin control: pinned mode removes the click-away backdrop, ignores Escape, and keeps the explicit close button available.
- Verification: focused AI proxy and Console tests passed (`aiClient`, `consoleRoutes`, `consoleProtocol`, `ConsoleDrawerUtils`, `ConsoleDrawer`; 38 tests before the pin change, then 22 focused Console drawer tests after it), `npx tsc -p ai-proxy/tsconfig.json --noEmit`, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, production touched-file lizard `CCN <= 15`, and `git diff --check` passed.
- Local rebuild and smoke: `./start.sh --rebuild` completed after the pin change. Sanctuary is live at `https://localhost:8443`; frontend, gateway, backend, worker, AI, Postgres, and Redis containers are healthy. `curl -k -I https://localhost:8443` returned HTTP 200. After syncing the saved AI config, the rebuilt backend planner selected `query_transactions` for wallet `da17d9d4-c760-4929-a207-2a45c3cadef9` and the February 1, 2020 through June 30, 2020 date range with no planner warnings.

---

# Active Task: Wallet Scoped Console Planner Fallback 2026-04-27

Status: complete

Goal: fix wallet-scoped Console prompts that receive no answer because local models return non-JSON planner output and no tool calls.

## Plan

- [x] Confirm the no-answer failure is a planner `model_response_not_json` result with zero tool calls.
- [x] Harden planner parsing and add deterministic wallet-scope fallback planning for obvious transaction prompts.
- [x] Add focused AI proxy tests for recovered JSON and wallet transaction fallback plans.
- [x] Run focused verification, rebuild containers, and smoke-check the wallet-scoped prompt path.

## Review

- Root cause: local model planner output for a wallet-scoped transaction/date-range request was not parseable as JSON, so the plan was persisted as `toolCalls: []` with `model_response_not_json`. Synthesis then correctly reported that no tool results were available.
- Implementation: the Console planner prompt now explicitly forbids prose/reasoning wrappers and tells wallet-scoped tools to copy `scope.walletId`. The parser also recovers valid plan JSON from model output that includes extra reasoning or example objects. If a local model still returns non-JSON, the AI proxy now applies a narrow fallback only for obvious selected-wallet transaction or overview prompts.
- Verification: focused AI proxy tests passed (`consoleProtocol`, `consoleRoutes`, 8 tests), `npx tsc -p ai-proxy/tsconfig.json --noEmit`, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, touched-file lizard `CCN <= 15`, and `git diff --check` passed.
- Local rebuild and smoke: `./start.sh --rebuild` completed; Sanctuary is live at `https://localhost:8443`; all local containers are healthy. The rebuilt wallet-scoped planner returned `query_transactions` for wallet `da17d9d4-c760-4929-a207-2a45c3cadef9` and the February 2020 through June 2020 date range. The rebuilt AI proxy image also returned the deterministic fallback plan for the same prompt when given non-JSON planner output. The database has 17 matching transactions for that wallet/date range.

---

# Active Task: Console Timeout And Flyout History Compression 2026-04-27

Status: complete

Goal: fix the remaining Console 408 timeout after local LM Studio synthesis, keep Console useful outside wallet scope, and make the flyout history easier to scan through compression and duplicate rerun hiding.

## Plan

- [x] Inspect live backend and AI proxy logs for the rerun failure.
- [x] Align the server request timeout with the Console local-model turn/replay path.
- [x] Add flyout display compression that folds older messages and hides exact duplicate reruns.
- [x] Make the AI Console keyboard shortcut explicit in the sidebar and shortcuts modal.
- [x] Run focused tests, type/lint checks, rebuild containers, and live-smoke the Console replay path.

## Review

- Root cause: the local LM Studio Console replay was not aborting in the model path. Planner and tool execution completed, but synthesis pushed total request time past the global Express 30s request timeout, so the browser received a 408 while the backend finished the turn shortly afterward and then hit `Cannot set headers after they are sent`.
- Implementation: Console turn and prompt replay routes now get a 280s server request-timeout budget so they can cover planning, read-only tool execution, and synthesis when each provider call may take up to 125s. The flyout compresses older dialogue history and hides exact duplicate reruns, while keeping the newest duplicate visible. The existing `Ctrl+Shift+.` / `Cmd+Shift+.` shortcut is now explicitly labeled "Open AI Console" in the sidebar action and keyboard shortcut modal.
- Scope behavior: Console remains general by default. General/network questions like "what is the current block?" use the public `get_bitcoin_network_status` tool without selecting a wallet; wallet-sensitive tools still require an explicit wallet scope.
- Verification: focused UI/API tests passed (`ConsoleDrawer`, `ConsoleDrawerUtils`, Layout sidebar, shortcuts, `useAppShortcuts`, API Console; 45 tests), focused server timeout/API tests passed (`requestTimeout`, Console API; 32 tests), `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, `npm run lint:app`, `npm run lint:server`, touched-file lizard `CCN <= 15`, and `git diff --check` passed.
- Local rebuild and smoke: `./start.sh --rebuild` completed. Sanctuary is live at `https://localhost:8443`; frontend, gateway, backend, worker, AI, Postgres, and Redis containers are healthy. `curl -k -I https://localhost:8443` returned HTTP 200. The rebuilt backend container reached LM Studio at `http://10.114.123.214:1234/v1/models` and saw 8 models. After syncing the saved provider profile, Console planning selected `get_bitcoin_network_status` in 10.6s and Console synthesis returned a block-height answer in 32.3s, beyond the old 30s cutoff and under the new timeout budget.

---

# Completed Task: Console Planner Local Model Reliability 2026-04-27

Status: complete

Goal: fix Console `/console/plan` failures against the local LM Studio provider, avoid passive AI status checks competing with real Console requests, and surface precise proxy failure details.

## Plan

- [x] Inspect live backend/AI proxy logs and persisted Console turn errors for the failed replay.
- [x] Remove passive model-inference health checks from `/ai/status` so app load does not consume local LM Studio capacity.
- [x] Make Console planning use a small bounded JSON response and return specific timeout/status details from the AI proxy.
- [x] Add a read-only Bitcoin network status tool so Console can answer current block-height prompts from Sanctuary data.
- [x] Add focused regression tests for status behavior, Console planner timeout/error details, and local-model planner options.
- [x] Run focused verification, quality review, edge-case audit, self-review, and rebuild the local containers.

## Review

- Root cause: passive `/api/v1/ai/status` checks still called `checkHealth()`, which sent a real model prompt through LM Studio during app/status refreshes. That could compete with the Console planner on large local models. The planner also used a larger default multi-message request and collapsed upstream failures to generic 503 responses.
- Implementation: `/ai/status` now reports feature/config/proxy availability without model inference. Admin "Test Connection" uses a new explicit `/api/v1/ai/test-connection` route that still runs `checkHealth()`. Console planning now uses deterministic bounded options (`temperature: 0`, `maxTokens: 512`) and the proxy returns structured timeout/status/policy errors. Console synthesis also returns structured proxy errors. A read-only `get_bitcoin_network_status` tool was added so "what's the current block?" can use Sanctuary's backend Bitcoin status data.
- Verification: focused AI proxy tests passed (`aiClient`, `consoleRoutes`, 11 tests); focused server AI/tool tests passed (`ai.test`, `readToolRegistry`, `readToolExecutors`, 81 tests); focused UI/API tests passed (`AISettings`, `useAIConnectionStatus`, `coreApiModules`, plus proxy tests, 95 tests total across root runs). `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, `npm run lint:app`, `npm run lint:server`, `npm run check:openapi-route-coverage`, `npx tsc -p ai-proxy/tsconfig.json --noEmit`, pinned touched-file lizard, and `git diff --check` passed.
- Local rebuild and smoke: `./start.sh --rebuild` completed; Sanctuary is live at `https://localhost:8443`; frontend, gateway, backend, worker, AI, Postgres, and Redis containers are healthy. `curl -k -I https://localhost:8443` returned HTTP 200. Direct AI-proxy smoke against LM Studio `http://10.114.123.214:1234` with model `unsloth/qwen3.6-35b-a3b` returned a valid `/console/plan` selecting `get_bitcoin_network_status`, and `/console/synthesize` returned a block-height answer. Backend `/api/v1/bitcoin/status` currently reports block height `946918`.

---

# Completed Task: Console Prompt Echo And Abort Details 2026-04-27

Status: complete

Goal: make Sanctuary Console show submitted prompts immediately, keep failed/aborted turns visible in the dialogue with expandable details, avoid premature aborts for slower local LM Studio turns, and keep wallet AI search as the transaction-table filter surface.

## Plan

- [x] Trace the Console submit path and confirm why aborted turns do not echo the prompt.
- [x] Add optimistic prompt rows and inline failed assistant rows with expandable technical details.
- [x] Extend only Console turn/replay client timeouts and align Console AI proxy/backend timeouts for slow local models.
- [x] Align the sidebar `Actions` label with section headers and add a keyboard-shortcuts action/view.
- [x] Add focused tests for prompt echo, failure details, Console API timeout options, and proxy timeout selection.
- [x] Verify and polish wallet AI transaction search so it clears table filters correctly and uses LM Studio-friendly timeouts.
- [x] Run focused verification, quality review, edge-case audit, and self-review.
- [x] Rebuild the local running containers and confirm the updated instance is live.

## Review

- Console prompts now echo immediately, failed turns remain visible with expandable details, and Console/model-backed requests use longer local-model timeouts.
- Sidebar quick actions use the same section-header alignment as other sidebar groups, and keyboard shortcuts have a dedicated action/modal.
- Wallet AI search is intentionally kept as the transaction-table filter surface. Its copy now says "Filter transactions with AI", clearing the input clears the parent table filter, `/ai/query` uses a 120s client timeout, the backend-to-AI-proxy natural-query timeout is 125s, and the AI proxy uses the longer analysis timeout for local model query conversion.
- Verification: focused Console/Layout/API/proxy/server tests from the previous pass remained green; focused wallet/API/proxy/server follow-up tests passed (`AIQueryInput`, `TransactionsTab`, `coreApiModules`, `naturalQuery`, `consoleRoutes`, and server `aiService`, 102 tests total). `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, `npm run lint:app`, `npm run lint:server`, `npx tsc -p ai-proxy/tsconfig.json --noEmit`, touched-file pinned lizard, and `git diff --check` passed. The ai-proxy package has no `typecheck` or `lint` npm scripts, so the direct `tsc --noEmit` check was used.
- Local rebuild: `./start.sh --rebuild` completed. The rebuilt Sanctuary frontend, gateway, backend, worker, and AI containers are healthy, `curl -k -I https://localhost:8443` returned HTTP 200, direct LM Studio model listing from `sanctuary-backend-1` returned 8 models, and the rebuilt AI proxy `/detect-provider` route detected the LAN LM Studio OpenAI-compatible endpoint with those 8 models.

---

# Active Task: AI Flyout Launcher Visibility Correction 2026-04-27

Status: complete

Goal: correct the sidebar AI/Console launcher so it is hidden only when the AI assistant is turned off, while still allowing the flyout to open and explain Console feature-flag or provider setup issues.

## Plan

- [x] Confirm why the local rebuilt instance hides the launcher.
- [x] Loosen the launcher capability to depend on AI assistant enablement instead of `/console/tools` success.
- [x] Add a conditional `Actions` label above sidebar action icons.
- [x] Update focused tests for AI-on/setup-needed visibility, AI-off hiding, and the conditional sidebar action label.
- [x] Run targeted verification and rebuild the local running instance.
- [x] Update lessons for the corrected gating rule.

## Review

- Investigation: `useConsoleAvailability` probes `/console/tools` before marking the sidebar launcher available. Because local `sanctuaryConsole` is disabled, that probe returns 403 and hides the icon before the drawer can show the reason-specific setup state.
- Implementation: the launcher capability now follows AI assistant enablement only, and the sidebar renders a compact `Actions` label when the quick-action icon group exists.
- Follow-up correction: `/ai/status` now returns `enabled`, `configured`, and `available` separately, and `useAIStatus` uses `enabled` for launcher visibility. This prevents provider health or model setup failures from hiding the flyout.
- Verification: focused Layout/capability/status hook tests passed (83 tests), focused server AI API tests passed (63 tests), `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, `npm run lint:app`, `npm run lint:server`, touched-file pinned lizard, and `git diff --check` passed. One broad server test command was mis-scoped and hit unrelated sandbox `EPERM` port-bind failures; the exact focused server AI suite passed afterward.
- Local rebuild: `./start.sh --rebuild` completed. Sanctuary is running at `https://localhost:8443`, the rebuilt gateway/frontend/ai/backend/worker containers are healthy, and `curl -k -I https://localhost:8443` returned HTTP 200. The local DB has `aiAssistant=true`, `aiEnabled=true`, active LM Studio endpoint `http://10.114.123.214:1234`, model `unsloth/qwen3.6-35b-a3b`, and `sanctuaryConsole=false`.

---

# Active Task: Console Feature Gate Setup State 2026-04-27

Status: complete

Goal: fix the Sanctuary Console flyout so a valid AI provider configuration is not misreported as generic "Console setup required" when the separate `sanctuaryConsole` feature flag is disabled, and verify how session switching is expected to work.

## Plan

- [x] Confirm the backend/UI path that shows the setup state and compare it with live local feature flag state.
- [x] Replace the generic setup state with reason-specific messaging for disabled Console feature flags versus missing AI provider/model setup.
- [x] Hide the sidebar Console icon and disable the shortcut unless AI and Console are available.
- [x] Move the translucent treatment from the Console backdrop to the drawer surface itself.
- [x] Add focused component/utility tests for the feature-gated state, sidebar availability, session-selection behavior, and drawer translucency.
- [x] Run focused verification, quality review, edge-case audit, and self-review.
- [x] Rebuild the local running containers and confirm the updated UI bundle is live.

## Review

- Investigation: the local backend has `aiAssistant` enabled and `sanctuaryConsole` disabled, and the drawer's `/api/v1/console/sessions`, `/prompts`, and `/tools` calls are returning 403 from the feature gate before provider/model checks run.
- Session behavior: "New session" currently selects a local blank state; the backend creates the actual session on the first prompt sent without an existing `sessionId`. Existing sessions are shown in the session dropdown and selecting one reloads its turns.
- UI correction: the Console flyout should use the translucent `surface-flyout` panel, while the click-away backdrop remains transparent so the app itself is not dimmed or blurred.
- Implementation: Console setup errors now distinguish disabled `sanctuaryConsole` from missing AI provider/model setup. The sidebar Console launcher and global shortcut are gated by a Console availability capability that requires AI to be ready and `/console/tools` to pass the feature gate.
- Verification: focused Console/Layout/capability/API tests passed (41 tests), Layout controller tests passed (47 tests), `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, touched-file pinned lizard, and `git diff --check` passed. The npm `lizard` shim was unavailable, so the project-pinned `.tmp/quality-tools/lizard-1.21.2/bin/lizard` command was used.
- Local rebuild: `./start.sh --rebuild` completed, Sanctuary is running at `https://localhost:8443`, and the rebuilt gateway/frontend/ai/backend/worker containers are healthy. `curl -k -I https://localhost:8443` returned HTTP 200. The LM Studio LAN endpoint `http://10.114.123.214:1234/v1/models` returned 8 OpenAI-compatible models from both the host and `sanctuary-backend-1`, so the running backend can reach the endpoint used by UI detection.

---

# Active Task: LM Studio Save And Detection Follow-Up 2026-04-27

Status: complete

Goal: fix the remaining Admin > AI Settings blockers for local LM Studio providers where saving appears to require an API key, model selection is unavailable, and Detect does not clearly work for LAN endpoints such as `http://10.114.123.214:1234`.

## Plan

- [x] Re-check the settings save disabled state, model picker, provider detection path, backend settings schema, and AI proxy LAN endpoint policy.
- [x] Allow saving a provider endpoint/profile without a selected model while keeping model-required operations gated.
- [x] Make provider detection/reporting distinguish real model-list failures from an empty model list.
- [x] Improve LM Studio/OpenAI-compatible model-picker empty states so users can type a model manually.
- [x] Add focused tests for no-model/no-key save and LAN LM Studio detection failure messaging.
- [x] Run focused verification, diff checks, quality review, edge-case audit, and self-review.

## Review

- Investigation: the API key is not required by the backend/profile model. The visible blocker is the Settings tab save button, which still disables Save when `aiModel` is empty. Detection also currently treats `{ models: [], error }` from the backend as a successful OpenAI-compatible connection, which hides the real endpoint/listing failure.
- Implementation: Save Configuration now only requires an endpoint, so a no-key/no-model LM Studio profile can be saved before model discovery. Detect now calls a typed `/ai/detect-provider` route backed by the AI proxy, which probes the supplied endpoint as OpenAI-compatible or Ollama and reports real failures instead of converting them to empty success.
- Verification: AI proxy provider/endpoint tests passed (11 tests), focused AI Settings/API tests passed (103 tests), focused server AI model route/service tests passed (89 tests), `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, `npm run lint:app`, `npm run lint:server`, `npm run check:openapi-route-coverage`, touched-file lizard, and `git diff --check` passed.
- Local rebuild: `./start.sh --rebuild` completed and the Sanctuary containers are healthy at `https://localhost:8443`. Direct proxy smoke from `sanctuary-ai-1` to `http://10.114.123.214:1234` returned 8 OpenAI-compatible LM Studio models. A browser-authenticated UI smoke could not be completed from this shell because the default admin password is no longer valid, but the rebuilt UI bundle and provider-detect proxy path are live.

---

# Active Task: LM Studio OpenAI-Compatible AI Provider 2026-04-27

Status: complete

Goal: let admins configure a local or LAN LM Studio provider without an API key, detect/list its OpenAI-compatible models, and save a provider profile without relying on Ollama-only model management.

## Plan

- [x] Inspect the AI provider settings save path, model listing, endpoint detection, and proxy client URL normalization.
- [x] Add OpenAI-compatible model-list URL handling for LM Studio `/v1/models` and fix `/v1` chat-completions URL normalization.
- [x] Update AI Settings so OpenAI-compatible providers can be tested/listed from a manually entered endpoint and a model can be typed when auto-listing is unavailable.
- [x] Refresh the Models tab recommended Ollama pull list with current small/local model choices.
- [x] Replace provider-agnostic UI/backend guidance that still assumes Ollama with provider-neutral copy or LM Studio/OpenAI-compatible alternatives.
- [x] Add focused AI proxy and AI Settings tests for no-API-key LM Studio/OpenAI-compatible setup.
- [x] Run targeted verification, quality review, edge-case audit, and self-review.

## Review

- Investigation: the provider profile schema and credential boundary already allow missing API keys. The practical save blocker is the Ollama-shaped model picker: save is disabled while `aiModel` is empty, and model loading/detection only use Ollama `/api/tags`.
- Implementation: OpenAI-compatible profiles now normalize LM Studio-style `/v1` endpoints correctly, list models through `/v1/models`, and can be detected/saved without an API key. The model field is editable, so a provider profile can be saved even when model listing is unavailable.
- Models tab: added a detected-provider model list for both Ollama and OpenAI-compatible providers; kept pull/delete actions scoped to Ollama; refreshed recommended Ollama pulls to current compact/local options.
- Provider copy/backend gates: updated AI Settings, docs, OpenAPI text, feature-flag text, chat setup guidance, and the intelligence provider check so LM Studio/OpenAI-compatible providers are not treated as failed Ollama checks.
- Verification: AI proxy model/client tests passed (7 tests); focused AI Settings tests passed (87 tests); focused backend AI/intelligence/feature-flag tests passed (86 tests); `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, pinned touched-file lizard `CCN <= 15`, and `git diff --check` passed.
- Edge-case audit: no-API-key local providers omit credential updates, typed credentials are included when Detect saves an OpenAI-compatible profile, empty `/v1/models` responses keep manual model entry available, `/v1` URLs do not duplicate path segments, and model pull/delete now fail closed for OpenAI-compatible providers instead of calling Ollama-native APIs.

---

# Active Task: Pre-Release Grade Findings Remediation 2026-04-27

Status: complete

Goal: fix the current `$grade` findings before cutting the next release, restoring the maintainability margin without weakening test coverage, wallet safety, MCP/Console behavior, or hardware-wallet flows.

Release target: **minimum 97/100 A**, no hard-fail blockers, `security_high=0`, `secrets=0`, app/backend/gateway coverage still 100%, duplication below 3%, and a full lizard scan at `CCN <= 15` with no threshold warnings. If vector fixture sharding lands safely, target **99/100**.

## Plan

- [x] Create a pre-release remediation branch from current `main` after preserving the grade report/trend/task-tracker changes.
- [x] Slice 1 - backend configuration and node/electrum complexity:
  - Owns `server/src/config/index.ts`, `server/src/api/admin/nodeConfigData.ts`, `server/src/services/bitcoin/nodeClient.ts`, `server/src/services/bitcoin/electrum/electrumClient.ts`, and `server/src/services/bitcoin/electrumPool/poolRegistry.ts`.
  - Extract config parsing/default resolution, admin node-config shaping, default electrum config selection, pool config loading, and electrum connect state handling into small pure helpers.
  - Add focused tests for env defaults, invalid/boundary values, node config variants, pool database fallbacks, and electrum connection failures.
- [x] Slice 2 - transaction, draft, PSBT, and sync service complexity:
  - Owns `server/src/services/draftService.ts`, `server/src/services/agentFundingDraftValidation.ts`, `server/src/services/bitcoin/transactions/*`, `server/src/services/bitcoin/sync/confirmations/*`, `server/src/services/bitcoin/blockchain/syncAddress.ts`, `server/src/services/bitcoin/advancedTx/rbf.ts`, `server/src/services/bitcoin/addressDerivation/descriptorParser.ts`, `server/src/services/bitcoin/psbtBuilder/*`, and transaction broadcast/pending route modules.
  - Split validation, DTO shaping, script-type branching, PSBT input enrichment, confirmation field population, previous-transaction fetches, and route response construction into named helpers.
  - Add or preserve tests for null/empty inputs, invalid network/script types, insufficient data, counterparty/fee fallback behavior, PSBT derivation paths, RBF boundaries, and broadcast failure paths.
- [x] Slice 3 - hardware signing and send/import frontend complexity:
  - Owns `services/hardwareWallet/adapters/trezor/signPsbt.ts`, `services/hardwareWallet/adapters/bitbox/signPsbt.ts`, `utils/urDeviceDecoder.ts`, `utils/utxoAge.ts`, `hooks/send/useBroadcast.ts`, `hooks/send/useDraftManagement.ts`, and `hooks/send/useQrSigning.ts`.
  - Extract signing request builders, derivation/path helpers, previous-transaction/reference shaping, QR/UR parsing helpers, draft DTO mapping, and broadcast state transitions.
  - Add focused tests around singlesig/multisig, missing derivations, malformed UR/QR payloads, empty drafts, binary PSBT detection, and hardware-device error mapping.
- [x] Slice 4 - UI component and animation complexity:
  - Owns flagged frontend components such as `components/send/OutputRow.tsx`, `components/send/steps/review/TransactionSummary.tsx`, `components/WalletDetail/WalletHeader.tsx`, `components/cells/DeviceCells.tsx`, `components/NetworkConnectionCard/ServerRow.tsx`, `components/Dashboard/hooks/useDashboardData.ts`, `components/ui/CustomIcons.tsx`, `components/UTXOList/UTXOGarden/utxoGardenModel.ts`, `components/PayjoinSection.tsx`, `components/TransactionFlowPreview.tsx`, and flagged animation modules.
  - Split render-branch decisions, class/model builders, icon lookup maps, animation setup phases, and data shaping into component helpers/hooks without changing visual behavior.
  - Verify with focused component tests and existing frontend coverage; use screenshots only where animation/UI framing changes.
  - [x] Extract flow preview, dashboard data, Payjoin education, wallet badges, device/server row class builders, output amount/QR helpers, and transaction-summary amount labels into private helpers/components.
  - [x] Verify device icon rule-table precedence against the previous branch order, including enum exact matches before generic fallback behavior.
  - [x] Run targeted lizard for all Slice 4 production files at `CCN <= 15`.
  - [x] Run focused Slice 4 Vitest suites and required frontend gates.
  - [x] Deliver Slice 4 as a dedicated PR and verify merge before starting Slice 5.
- [x] Slice 5 - test harness, e2e, and quality-script complexity:
  - Owns flagged non-production files including `scripts/check-openapi-route-coverage.mjs`, e2e route handlers, `server/tests/mocks/aiContainer.ts`, PSBT/hardware-wallet test helpers, and console tool test helpers.
  - Reduce full-scan lizard warnings in test/support code after production hotspots are clean, keeping fixture intent obvious and avoiding synthetic indirection.
  - Add helper-level tests where script parsing or route-handler mocks become separate utilities.
  - [x] Identify current Slice 5 lizard warnings from `scripts/`, e2e route handlers, server test mocks, PSBT/hardware-wallet helpers, and console tool helpers.
  - [x] Refactor flagged test/support files into behavior-preserving helpers without obscuring fixture intent.
  - [x] Add or update focused tests for extracted script parsing and test helper utilities where coverage is not already direct.
  - [x] Run targeted lizard for Slice 5 touched files at `CCN <= 15`.
  - [x] Run focused Slice 5 suites plus required affected gates.
  - [x] Deliver Slice 5 as a dedicated PR and verify merge before starting Slice 6.
- [x] Slice 6 - vector fixture size and low-audit triage:
  - Evaluate sharding or generation-on-demand for `server/tests/fixtures/verified-address-vectors.ts` and `scripts/verify-addresses/output/verified-vectors.ts`; proceed only if address-vector coverage and deterministic verification stay intact.
  - Re-run root audit, identify the 16 low advisories, apply safe minor/patch upgrades where available, and document any remaining upstream/hardware-wallet transitive risk.
  - Deliver Slice 6 as a dedicated PR and verify merge before the final grade pass.
  - [x] Measure vector fixture size, consumers, and deterministic verification coverage before choosing whether to shard or leave intact.
  - [x] Clear current large-file gate failures exposed by vector-fixture review without weakening generated-vector coverage.
  - [x] Re-run root/server/gateway/ai-proxy audits and classify all remaining advisories by severity, path, and safe-fix availability.
  - [x] Apply safe package updates or document accepted upstream/transitive residuals without weakening wallet or hardware-wallet coverage.
  - [x] Run targeted vector/audit tests plus package gates affected by any dependency or fixture changes.
  - [x] Deliver Slice 6 as a dedicated PR and verify merge before the final grade pass.
- [x] Release verification gate:
  - Run focused tests per slice plus touched-file lizard before each PR.
  - Before release, run full lizard, `npm run test:coverage`, `npm run test:backend:coverage`, `npm --prefix gateway run test:coverage`, lint/typecheck, gitleaks full/tracked/latest commit scans, root/server/gateway/ai-proxy audits, jscpd, and `$grade`.
  - Update `docs/plans/codebase-health-assessment.md` and grade history with the post-remediation score.

## Review

- Slice 1 branch: `fix/pre-release-grade-slice-1-config-node`.
- Slice 1 PR #196 merged via merge queue at `543cbba505410ef6c233c66e3a5b1c35f8c20407`.
- Slice 1 implementation: extracted env section builders, node mode resolution, Electrum connection config resolution, admin node-config mapping helpers, and pool config/server/proxy mappers into focused modules. Touched-file lizard is clean, full lizard is down from 65 to 60 warnings with no Slice 1 touched-file warnings, focused Slice 1 tests pass, server lint passes, architecture checks pass, and backend coverage remains 100%.
- Slice 2 branch: `fix/pre-release-grade-slice-2-transactions-sync`.
- Slice 2 implementation: split draft create/update into focused modules behind the existing `draftService` facade; extracted PSBT input enrichment, confirmation fee/counterparty population, address-sync history transaction creation and transaction I/O persistence, transaction route response/audit helpers, RBF input/output helpers, descriptor parsing helpers, and PSBT multisig finalization/witness helpers. Added PSBT input-construction coverage for multisig metadata present/missing paths and bounded pending-transaction mempool enrichment concurrency. `syncAddress.ts` is now 261 lines and the extracted `historyTransactions.ts` is 311 lines.
- Slice 2 verification: targeted touched-file lizard is clean; full server lizard is down to 8 remaining warnings, all outside Slice 2 targets. Focused syncAddress/PSBT tests passed (66 tests), pending transaction route tests passed (98 tests), `npm run test:unit` passed (411 files / 9,324 tests), `npm run test:backend:coverage` passed at 100% statements/branches/functions/lines (418 passed, 22 skipped, 9,414 passed / 505 skipped), `npm run typecheck:server:tests` passed, `npm run lint:server` passed, `npm run check:architecture-boundaries` passed, `npm --prefix server run check:prisma-imports` passed, and `git diff --check` passed.
- Slice 3 branch: `fix/pre-release-grade-slice-3-hardware-send`.
- Slice 3 implementation: split Trezor PSBT signing into focused network/cosigner, payload-building, validation, signature-extraction, error-mapping, and shared type modules while keeping the exported signer API intact; extracted BitBox account/input/output/signature helpers; split broadcast payload selection, multisig signature logging, cache refresh, draft cleanup, QR download/upload helpers, draft DTO mapping, UR decode helpers, and UTXO age formatting into named helpers. The main Trezor signer is now 110 lines and the largest new Trezor helper file is 297 lines.
- Slice 3 verification: targeted touched-file lizard is clean at `CCN <= 15`; focused Slice 3 Vitest suite passed (11 files / 208 tests); `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `git diff --check` passed; full frontend coverage passed at 100% statements/branches/functions/lines (422 files / 5,712 tests).
- Slice 4 branch: `fix/pre-release-grade-slice-4-ui-complexity`.
- Slice 4 implementation: split Transaction Flow Preview into a thin shell plus flow-part components; extracted Dashboard data shaping and websocket notification builders; moved Payjoin education modal, tooltip/body pieces, wallet badge rendering, wallet sync status rendering, device/server row class/model decisions, output amount/QR helpers, and transaction-summary amount/payjoin labels into focused helpers. Converted `getDeviceIcon` to an ordered rule table that preserves the old branch order and exact enum checks before string-pattern matches. `TransactionFlowPreview.tsx`, `PayjoinSection.tsx`, and `useDashboardData.ts` are now under the 400-line design-warning threshold.
- Slice 4 verification: focused Slice 4 Vitest suite passed (10 files / 151 tests); targeted touched-file lizard is clean at `CCN <= 15`; `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `git diff --check` passed; full frontend coverage passed at 100% statements/branches/functions/lines (422 files / 5,712 tests).
- Slice 4 PR delivery follow-up: regenerated `docs/architecture/generated/frontend.md` after PR #200 architecture CI detected stale generated frontend graphs from the new helper modules.
- Slice 4 delivery: PR #200 merged through the merge queue at `0c2d45c0cfcb221cc6435f79e306837869ad8761`; `origin/main` contains the merge commit. The local Slice 4 branch remains for final cleanup because GitHub squash-style landing made `git branch -d` unable to prove ancestry without force deletion.
- Slice 5 discovery: full pinned lizard after Slice 4 reports two remaining warnings: `server/tests/unit/assistant/consoleToolExecution.test.ts` and residual production warning `server/src/api/transactions/broadcasting.ts`.
- Slice 5 implementation: replaced nullable branch-heavy console trace test shaping with a defined-field picker, and replaced conditional transaction broadcast metadata spreads with a small defined-field helper. Added route-contract assertion coverage for optional label/memo/raw transaction metadata.
- Slice 5 verification: focused server tests passed (`consoleToolExecution` and `transactions-http-routes`, 78 tests); targeted touched-file lizard passed; full pinned lizard now reports zero warnings; `npm run typecheck:server:tests`, `npm run lint:server`, `npm run check:openapi-route-coverage`, `npm run test:backend:coverage`, and `git diff --check` passed. A first broad server-test command was mis-scoped and failed in sandbox on unrelated Supertest port binds; the exact focused server Vitest command passed afterward.
- Slice 5 delivery: PR #201 merged through the merge queue at `88279a7b10a356b03a19b76da9de6aa5ab8f01c0`; `origin/main` contains the merge commit. The queue-branch CodeQL upload failure was isolated to the ephemeral merge-queue ref disappearing after merge; the post-merge `main` CodeQL run on the same commit passed.
- Slice 6 branch: `fix/pre-release-grade-slice-6-vector-audit-cleanup`.
- Slice 6 implementation: changed the address-vector generator to emit one verified vector per line while preserving the existing `VERIFIED_SINGLESIG_VECTORS`, `VERIFIED_MULTISIG_VECTORS`, types, mnemonic export, and fixture/output parity. The generated server fixture and script output each dropped from 2,118 lines to 178 lines. Split the oversized `aiService.test.ts` model-operation cases into `aiService.modelOperations.test.ts` and moved shared AI service mocks/reset hooks into the existing harness; `aiService.test.ts` is now 613 lines and the new model-operation suite is 413 lines.
- Slice 6 audit triage: root audit still reports 16 low-severity transitive advisories through Ledger/Trezor hardware-wallet and browser polyfill paths (`elliptic`, old transitive `tiny-secp256k1`/`bitcoinjs-lib`, `@trezor/*`, `@ledgerhq/*`, `vite-plugin-node-polyfills`/`node-stdlib-browser`). Server, gateway, and ai-proxy audits report 0 vulnerabilities. No safe dependency update was applied: direct packages are already at current compatible releases, and npm's suggested remaining fixes are downgrades, force fixes, or no-fix hardware-wallet transitives.
- Slice 6 verification: focused address-vector and hardware-wallet compatibility suites passed (231 tests); focused AI service suites passed (53 tests); generated vector output and server fixture are byte-identical; targeted and full pinned lizard passed at `CCN <= 15` with zero warnings; `node scripts/quality/check-large-files.mjs`, `npm run typecheck:scripts`, `npm run typecheck:server:tests`, `npm run lint:server`, root/server/gateway/ai-proxy high-severity audits, Prettier check for touched hand-edited files, `npm run test:backend:coverage` (419 passed / 22 skipped files, 9,414 passed / 505 skipped tests, 100% coverage), and `git diff --check` passed.
- Slice 6 delivery: PR #202 merged through the merge queue at `600cd6feb0bbea840ee1c73b9a44d861db6dbb8a`; `origin/main` contains the merge commit. Queue Test Suite and Code Quality passed; queue CodeQL hit the known ephemeral-ref upload race after merge, and the post-merge `main` CodeQL run on the same commit passed.
- Final release verification: grade collector tests/lint/typecheck passed; `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, `npm run test:coverage`, `npm run test:backend:coverage`, `npm --prefix gateway run test:coverage`, root/server/gateway/ai-proxy high-severity audits, full/latest-commit/tracked-tree gitleaks, full pinned lizard, jscpd, large-file classification, and `git diff --check` passed.
- Final grade result: `docs/plans/codebase-health-assessment.md` and `docs/plans/grade-history/sanctuary_.jsonl` now record 98/100 A, high confidence, no hard-fail blockers, `security_high=0`, `secrets=0`, app/backend/gateway coverage at 100%, duplication at 2.25%, and full pinned lizard with 0 threshold warnings at `CCN <= 15`.
- Quality review: the remediation preserved public contracts and coverage while reducing full-scan lizard warnings from 65 to 0 and reducing the verified vector fixtures from 2,118 lines to 178 lines each. The only strict score loss is the classified 1,150-line `scripts/perf/phase3-benchmark.mjs` proof harness.
- Edge-case audit: null/empty/error boundaries remain covered through the slice-specific suites, vector fixture/output parity is byte-identical, root low audit advisories are documented without risky forced downgrades, and no broad lizard or gitleaks suppressions were added.
- Remaining planned remediation slices: 0.

---

# Active Task: Codebase Health Grade 2026-04-27

Status: complete

Goal: run the `$grade` health audit after the AI/MCP/Console release slices merged, update the canonical health report and trend history, and surface any follow-up work.

## Plan

- [x] Confirm post-merge cleanup state and local branch cleanup.
- [x] Run the grade collector and explicit coverage, audit, gitleaks, lizard, and duplication evidence.
- [x] Inspect representative validation, error handling, MCP auth, Console, rate-limit, logging, and data-access paths for judged scores.
- [x] Update the codebase health report and grade trend history with the current score.
- [x] Run final diff/status checks and summarize the result.

## Review

- Branch cleanup complete: all merged local feature/fix/chore/doc branches were deleted; only `main` remains.
- Evidence collected against `816ced3e` on `main`.
- Preliminary score pressure is maintainability: the current full lizard scan reports 65 threshold warnings over `CCN > 15`, while tests, lint, typecheck, coverage, audits, and gitleaks remain green.
- Current grade report: 92/100, A, high confidence; no hard-fail blockers.
- Final checks: `git diff --check` passed; changed files are the health report, grade trend history, and this task tracker.

---

# Active Task: AI/MCP/Console Release Proof Docs 2026-04-26

Status: complete

Goal: close the final release-proof/docs slice for the AI Settings, Sanctuary Console, and direct MCP rollout so operators have the supported setup path, release gates have explicit proof criteria, and the prior readiness audit no longer leaves stale guidance as the latest release story.

## Plan

- [x] Sync to the merged Admin AI/MCP settings work and create a fresh release-docs branch from `origin/main`.
- [x] Audit existing README, MCP how-to, release-gate, planning, and docs index coverage for stale AI Assistant/MCP guidance.
- [x] Add an operator-facing AI Settings, Sanctuary Console, and MCP access how-to that makes Console the recommended path and direct MCP the advanced path.
- [x] Update README, MCP how-to, docs index, and release gates to point at the new guidance and current Admin > AI Settings > MCP Access workflow.
- [x] Add release proof notes with merged-slice evidence, quality review, edge-case audit, and remaining-slice count.
- [x] Run focused docs/build verification, diff checks, quality review, edge-case audit, and self-review.
- [x] Deliver the slice through PR, merge queue, merge verification, and branch cleanup.

## Review

- Remaining implementation after this slice: 0 planned slices for the AI/MCP/Console rollout.
- Added `docs/how-to/ai-mcp-console.md` as the operator path for configuring trusted providers, opening Sanctuary Console, managing prompt history, and issuing/revoking direct MCP credentials.
- Updated README, the MCP server how-to, docs index, and release gates so the release story points to AI Settings, Sanctuary Console as the normal path, and direct MCP as the advanced loopback/LAN path.
- Added `docs/plans/ai-mcp-console-release-proof.md` with merged PR evidence, release posture, release gates, operator evidence, security evidence, and deferred non-blocking follow-ups.
- Marked the original MCP readiness audit as historical so its pre-implementation "not release-ready" verdict does not remain the latest guidance.
- Edge-case audit: docs state that direct MCP is not for public internet exposure, LAN MCP requires TLS/VPN/reverse-proxy protection, prompt history expiration is per-prompt rather than an admin retention policy, restored provider credentials require re-entry, restored MCP keys are revoked, and unsupported write/shell/SQL/signing workflows remain out of scope.
- Verification passed: `npm run docs:build`, `git diff --check`, and a stale-term scan for outdated AI/MCP feature-flag names across the touched public docs.
- Delivery complete: PR #195 merged, `origin/main` contains merge commit `816ced3e`, post-merge main checks passed, and the merged local branch was removed during cleanup.

---

# Active Task: Admin AI/MCP Settings 2026-04-26

Status: complete

Goal: extend Admin > AI Settings into the control surface for typed model provider profiles/credentials and external MCP client access, so admins can configure LAN/local LLM providers and issue/revoke scoped MCP bearer credentials without exposing secrets.

## Plan

- [x] Inspect the existing AI Settings page, typed provider settings backend, MCP key API, admin routes, OpenAPI, and frontend test harness.
- [x] Add typed frontend API helpers for MCP status, MCP key list/create/revoke, and one-time token responses.
- [x] Add Admin > AI Settings UI for typed provider profile metadata, credential update/clear state, and provider capability flags.
- [x] Add Admin > AI Settings UI for MCP server status plus scoped key creation, one-time token display, key inventory, and revoke handling.
- [x] Add or update backend status/OpenAPI coverage only where the existing API contract is missing data needed by the admin UI.
- [x] Add focused tests for provider profile saves/credential updates, MCP status rendering, key creation token display, revoke handling, empty/error states, and API client paths.
- [x] Run focused verification, touched-file lizard checks, diff checks, quality review, edge-case audit, and self-review.
- [x] Deliver the slice through PR, merge queue, merge verification, and branch cleanup.

## Review

- Remaining implementation after this slice: 1 slice (release proof/docs).
- Scope decision: keep the surface inside the existing Admin > AI Settings route instead of adding a separate admin page; this matches the product decision to rename and consolidate AI Assistant settings.
- Added typed Admin AI provider profile editing for profile name/type, endpoint/model, capabilities, active profile selection, add/remove profile behavior, write-only API-key credential updates, clear-on-save state, and credential status labels that never persist or echo secrets.
- Added typed MCP frontend API helpers and an Admin > AI Settings > MCP Access tab with server status, target-user selection, wallet scope parsing/deduping, optional expiration, audit-log scope toggle, one-time token display/dismissal, active/expired/revoked key inventory, and revoke handling.
- Added an admin MCP server status endpoint plus OpenAPI schemas/paths so the UI can show non-secret MCP host/rate-limit/page/window metadata without inventing client-side assumptions.
- Refactored AI Settings UI into smaller provider/model/additional/MCP components and split wallet-agent/MCP contracts out of the oversized shared admin type file; touched production files stay under the 400-line design warning and lizard `CCN <= 15`.
- Edge-case audit: empty wallet scope maps to all accessible wallets, duplicate wallet IDs dedupe before submit, invalid/blank expiration is omitted, create is blocked without target user/name, refresh/create/revoke errors surface without stale tokens, removing the last provider is ignored, missing active provider metadata falls back to "No credential", and credential state is stripped from persisted profile payloads.
- Verification passed locally: focused AI Settings/API suite (90 tests), targeted new/refactored AI/MCP coverage at 100%, full frontend coverage (`npm run test:coverage`, 422 files / 5,712 tests, 100% statements/branches/functions/lines), `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, `npm run lint:app`, `npm run lint:server`, focused backend admin MCP route tests (7 tests), `npm run check:openapi-route-coverage`, touched-file lizard `-C 15`, and `git diff --check`.
- PR delivery follow-up: replaced MCP-token-shaped UI test fixtures with low-entropy sentinels so secret scanning gates fixtures without broad allowlists, regenerated the server architecture graph, and layered a CodeQL-recognized `express-rate-limit` guard ahead of Sanctuary's Redis-backed API limiter on admin MCP key routes.
- Quality review: the typed provider model is isolated in a pure helper with focused tests; MCP access state lives in a dedicated hook; the MCP API types are colocated with the MCP client; the existing admin barrel still exports stable public types so callers do not need broad rewrites.

---

# Active Task: Console UI Drawer 2026-04-26

Status: complete

Goal: add the in-app Sanctuary Console UI surface as a right-side flyout with typed frontend API calls, prompt history/replay controls, theme-aware opacity, and a subtle global sidebar trigger backed by the merged Console backend.

## Plan

- [x] Inspect the app shell, sidebar, theme preferences, existing Intelligence UI, frontend API patterns, and Console backend contract.
- [x] Add typed frontend Console API helpers and models for sessions, turns, tools, prompt history, replay, delete, and save/expire updates.
- [x] Build a theme-aware Console drawer/controller with general and wallet scope selection, prompt submission, response/tool trace display, saved prompt history, replay, delete, setup-disabled states, and focus handling.
- [x] Wire a compact AI quick-action icon row directly under Dashboard in the sidebar, plus a conservative keyboard shortcut foundation for opening the drawer.
- [x] Add flyout opacity to Theme settings and apply it to shared flyout surfaces so users can choose translucent glass or solid presentation across light/dark themes.
- [x] Add focused frontend API/component tests for drawer behavior, history replay/delete/save, setup-disabled states, sidebar trigger placement, shortcut handling, and flyout opacity preferences.
- [x] Run focused verification, touched-file lizard checks, diff checks, quality review, edge-case audit, and self-review.
- [x] Deliver the slice through PR, merge queue, merge verification, and branch cleanup.

## Review

- Delivery complete: PR #193 merged at `a6b7082e Add Sanctuary Console drawer UI (#193)`, `origin/main` contains the merge commit, and post-merge main checks passed.
- Remaining implementation after this slice: 2 slices (Admin MCP/AI settings UI/API; release proof/docs).
- Added a typed frontend Console API module for tools, sessions, turns, prompt history, save/delete/replay, and expiration updates with retries disabled on model-backed mutation paths to avoid duplicate turns/history.
- Added a right-side Sanctuary Console drawer with general/wallet scope selection, session switching/new session, prompt submission, response/tool trace display, prompt history search/display, replay, save/unsave, delete, 30-day expiration/clear-expiration controls, setup-required state, Escape/backdrop close, and focus restore.
- Added the subtle Console quick-action row directly beneath Dashboard in the sidebar and a central shortcut registry/hook with editable-target exclusion; the Console opens on the registered global shortcut and through the icon trigger.
- Added `flyoutOpacity` as a typed user preference, server/gateway validation field, theme registry CSS variable, and Theme > Visual Settings slider; `.surface-flyout` now matches light/dark theme colors with adjustable glass/solid opacity.
- Verification passed locally: focused Console/Layout/Theme/UserContext/shortcut Vitest suite (76 tests), focused merge-queue coverage suite (30 tests, 100% coverage for new Console drawer/API/shortcut surfaces), full frontend coverage (`npm run test:coverage`, 418 files / 5,692 tests, 100% statements/branches/functions/lines), full frontend suite (`npm run test:run`, 415 files / 5,668 tests), app/test/server typechecks, app/server lint, focused server auth route tests (100 tests), gateway request-validation tests (75 tests), touched-file lizard `-C 15`, and `git diff --check`.
- PR delivery follow-up: regenerated the frontend architecture graph after CI detected stale generated output, added root test-harness dev dependencies for the AI proxy modules imported by `tests/ai-proxy/*` so `npm ci && npm run typecheck:tests` passes without relying on a nested `ai-proxy/node_modules`, and narrowed frontend coverage ownership so package-owned AI proxy internals stay covered by AI proxy gates while the new Console drawer/API/shortcut files retain 100% frontend coverage.
- Quality review: split the drawer into small UI components plus a controller hook; all new production files remain below the 400-line design warning and lizard complexity gate; formatting churn from the first verification pass was removed before delivery.
- Edge-case audit: empty wallets fall back to General scope, deleted/missing selected wallets reset scope, empty prompts do not submit, failed turns restore input, setup 403s show the setup state without stale errors, prompt expiration can be cleared, global shortcuts ignore editable/code targets, and flyout opacity is clamped server-side to 50-100.

---

# Active Task: Console Backend Protocol 2026-04-26

Status: complete

Goal: add the backend foundation for a canonical Sanctuary Console that can persist prompt history, replay saved prompts, and execute the same scoped read-only assistant tools used by direct MCP before the UI/drawer work begins.

## Plan

- [x] Inspect current AI proxy/chat routes, MCP adapter, shared assistant read-tool registry, auth context, and persistence patterns.
- [x] Add a typed console protocol with sessions, prompt history, replay/delete/expiration semantics, optional wallet context, and explicit tool execution envelopes.
- [x] Implement backend services/routes that execute shared assistant read tools with console provenance and backend authorization instead of browser-provided trust.
- [x] Add focused tests for auth, wallet scope, admin-only tools, history replay/delete/expiration, invalid tool input, empty context, and redaction/provenance metadata.
- [x] Run focused verification, touched-file lizard checks, diff checks, quality review, edge-case audit, and self-review.
- [x] Deliver the slice through PR, merge queue, merge verification, and branch cleanup.

## Review

- Added a feature-gated Sanctuary Console backend at `/api/v1/console` with authenticated sessions, turns, compact tool traces, prompt history list/update/delete/replay, expiration-aware prompt filtering, and OpenAPI coverage.
- Added dedicated Prisma models/tables for console sessions, turns, tool traces, and prompt history so the UI drawer can build on a typed greenfield contract without reusing the legacy AI conversation tables.
- Added backend-owned Console tool execution over the shared assistant read-tool registry with `source: 'console'`, wallet/admin scope checks, max-sensitivity enforcement, denied/failed trace persistence, compact facts/provenance/redaction/truncation synthesis payloads, and audit metadata that excludes prompts and raw tool inputs.
- Added AI proxy Console planning and synthesis routes through a separate `consoleRoutes` module, using service-secret auth, active provider config sync, and no browser JWT forwarding.
- Added `sanctuaryConsole` as a default-off feature flag, included console tables in backup ordering, and added support-package console counts without prompt/response content.
- PR delivery follow-up: regenerated the server architecture graph after CI detected stale generated output, and added a router-wide `api:default` user limiter for Console reads while keeping `ai:analyze` limits on model-backed session/turn/replay operations to satisfy CodeQL without over-throttling LAN/private read workflows.
- Delivery complete: PR #190 merged backend/protocol at `c968e16e`, and PR #191 merged the CodeQL rate-limit follow-up at `48f18b70`; `origin/main` contains both merge commits.
- Quality review: kept new production files under the 400-line design-warning threshold except the pre-existing AI proxy route monolith; the new proxy route logic was extracted to avoid adding more route code there.
- Edge-case audit: invalid query booleans fail closed instead of treating `"false"` as truthy; malformed stored prompt scopes/sensitivities replay with safe defaults; missing wallets and non-admin admin scope fail before tool execution; unknown/out-of-scope/over-sensitivity tools persist denied traces; network/proxy failures fail turns and audit failure details.
- Verification passed: AI proxy Console tests (16 tests), focused server Console/config/support/routes tests (111 tests), targeted Console coverage at 100% statements/branches/functions/lines, full backend coverage gate (`npm run test:backend:coverage`, 9,406 passed, 505 skipped, 100% coverage), `npm run typecheck:server:tests`, `npm run typecheck:tests`, `npm run lint:server`, `npm --prefix ai-proxy run build`, `npm run check:openapi-route-coverage`, `npm --prefix server run check:prisma-imports`, `npm run check:architecture-boundaries`, touched-file lizard `-C 15`, and `git diff --check`.
- Remaining implementation after this slice: 3 slices (Console UI/drawer; Admin MCP/AI settings UI/API; release proof/docs).

---

# Active Task: Read-Tool Parity Batch 2 2026-04-26

Status: complete

Goal: expand the shared assistant/MCP read-tool registry to cover the next GUI read surfaces: labels, policies, draft details, cached market status, active insights, and admin operational summaries while preserving read-only behavior, typed results, scope checks, and redaction boundaries.

## Plan

- [x] Inspect existing GUI/API read paths, service/repository contracts, and batch-1 assistant tool patterns.
- [x] Add focused DTO/repository helpers for label summaries/details, wallet policies/events/addresses, draft details, insight summaries, market cache status, and admin agent dashboard summaries.
- [x] Register separate typed read-tool modules for labels, policies, drafts, insights, market status, and admin reads instead of growing one shared file.
- [x] Preserve direct MCP and future Console reuse by keeping authorization in tool executors and output envelopes explicit about provenance, sensitivity, redactions, truncation, and audit metadata.
- [x] Add focused tests for wallet authorization, admin-only denial, empty data, not-found records, row limits, redactions, stale market metadata, and no PSBT/API-key/raw secret leakage.
- [x] Run focused verification, touched-file lizard checks, diff checks, quality review, edge-case audit, and self-review.
- [x] Deliver the slice through PR, merge queue, merge verification, and branch cleanup.

## Review

- Added read-only label, policy, policy event, draft detail, insight list/detail, cached market status, and admin operational summary tools to the shared assistant registry used by both MCP and the future Console.
- Kept the tools scoped and typed: wallet tools call `authorizeWalletAccess`, admin summaries require `context.actor.isAdmin`, market status reads only existing caches, and all outputs include provenance, sensitivity, redaction, truncation, and audit metadata where relevant.
- Added assistant repository helpers for label details, policy inheritance/detail/events, draft details with approval and lock metadata, wallet insight reads, and admin agent dashboard summaries while preserving the existing `assistantReadRepository` contract.
- Split the new batch-2 DTO mappers into `batch2Dto.ts` and re-exported through `dto.ts`, keeping both production DTO files below the 400-line design warning threshold.
- Bounded admin operational summaries and policy address details at the assistant tool boundary by fetching one extra row for truncation proof, so large agent dashboards or allow/deny lists do not load or serialize unbounded result sets.
- Redaction boundaries: policy configs expose counts instead of user ID lists; policy events expose detail keys instead of raw details/user IDs; draft details omit PSBTs, signed PSBTs, input paths, raw input/output JSON, approval vote identities, and vote reasons; label details omit address derivation paths; insight summaries omit analysis/data; admin summaries omit API keys, signer fingerprints, user identity details, and raw alert metadata.
- Edge-case audit: missing wallets/labels/policies/drafts/insights return typed 404s; invalid tool inputs validate before repository calls; row limits fetch one extra record for truncation proof; empty admin/insight/label/policy sets return deterministic envelopes; stale market prices are surfaced from cache metadata without external fetches; restored or absent array/object fields normalize to empty counts rather than leaking raw structures.
- Verification passed: focused assistant/MCP Vitest suite (55 tests), exact backend unit coverage gate (`npm run test:unit -- --coverage`, 404 files, 9,269 tests, 100% statements/branches/functions/lines), `npm run typecheck:server:tests`, `npm run lint:server`, `npm run arch:graphs`, `npm run arch:calls`, `npm run arch:lint`, touched-production-file lizard `-C 15`, and `git diff --check`.
- Remaining implementation after this slice: 4 slices (Console backend/protocol; Console UI/drawer; Admin MCP/AI profile UI/API; release proof/docs).

---

# Active Task: Read-Tool Parity Batch 1 2026-04-26

Status: complete

Goal: expand the shared assistant read-tool registry toward GUI read parity for dashboard, wallet, transaction, UTXO, and address workflows while keeping the new surface read-only, scoped, typed, and reusable by both direct MCP and the future Console.

## Plan

- [x] Inspect the merged read-tool foundation, implementation plan, GUI/API read endpoints, repositories, MCP auth scope behavior, and focused tests.
- [x] Add scoped repository helpers for dashboard summaries, wallet detail summaries, transaction stats/detail/pending reads, UTXO summaries, and address summary/detail reads.
- [x] Add small registry modules for dashboard, transaction, UTXO, and address parity tools instead of growing the existing wallet module.
- [x] Preserve MCP compatibility by registering the new shared tools through the existing MCP adapter and honoring MCP wallet-scope limits for aggregate dashboard reads.
- [x] Add focused tests for happy paths, empty data, not-found behavior, invalid inputs, scoped wallet filtering, DTO shaping, redactions, and no secret/raw PSBT leakage.
- [x] Run focused verification, touched-file lizard checks, diff checks, quality review, edge-case audit, and self-review.
- [x] Deliver the slice through PR, merge queue, merge verification, and branch cleanup.

## Review

- Added read-only dashboard, wallet detail, transaction stats/pending/detail, UTXO summary, address summary, and address detail tools to the shared assistant registry used by both MCP and the future Console.
- Kept the MCP adapter thin: new shared tools are automatically registered through `assistantReadToolRegistry`, and MCP contexts now pass wallet-scope IDs so aggregate dashboard reads only include permitted wallets.
- Split the assistant read repository into small domain modules under `server/src/repositories/assistantRead/` while preserving the existing `assistantReadRepository` and `mcpReadRepository` import contracts.
- Added DTO and summary shaping for transaction details, address details, wallet devices, dashboard rollups, transaction stats, UTXO totals, and address used/unused balances with explicit redactions for raw transaction hex, UTXO outpoint lists, device xpubs/fingerprints, shared usernames, and group names.
- Edge-case audit: empty scoped wallet sets return no rows without querying wallets; missing aggregate rows normalize to zero; invalid address lookups fail before authorization; not-found wallet/transaction/address reads return typed 404 errors; pending transaction age is clamped at zero; address balance grouping joins by wallet ID and address to avoid cross-wallet grouping.
- Local verification passed: focused assistant/MCP Vitest suite (41 tests), exact backend unit coverage gate (`npm run test:unit -- --coverage`, 402 files, 9,255 tests, 100% statements/branches/functions/lines), `npm run typecheck:server:tests`, `npm run lint:server`, touched-file lizard `-C 15`, and `git diff --check`.
- Remaining implementation after this slice: 5 slices (read-parity batch 2; Console backend/protocol; Console UI/drawer; Admin MCP/AI profile UI/API; release proof/docs).

---

# Active Task: Shared Read-Tool Registry Foundation 2026-04-26

Status: complete

Goal: extract the current MCP read-tool execution surface into a shared backend-owned registry foundation so direct MCP and the future in-app Console can use the same scoped, audited, typed read tools.

## Plan

- [x] Inspect current MCP tools, auth context, read repositories, audit behavior, and focused tests.
- [x] Add a shared assistant read-tool domain with typed metadata, input validation, budgets, result envelopes, and executor context.
- [x] Extract the existing MCP read tools onto the shared registry without widening permissions or changing write behavior.
- [x] Adapt MCP tools to call the registry as an adapter while preserving MCP response compatibility where practical.
- [x] Add focused registry and MCP adapter tests for invalid input, empty data, wallet authorization boundaries, and truncation/budget metadata.
- [x] Run focused verification, touched-file lizard checks, diff checks, quality review, edge-case audit, and self-review.
- [x] Prepare the slice for PR delivery with review notes and verification evidence.

## Review

- Added a shared assistant read-tool registry under `server/src/assistant/tools` with stable tool metadata, input schemas, sensitivity classes, required-scope metadata, budgets, result envelopes, provenance, redaction notes, truncation metadata, and adapter-safe audit metadata.
- Extracted the existing MCP read tools into shared registry executors without adding write capabilities: transaction query, UTXO query, address search, wallet overview, wallet analytics, balance history, fee estimates, price conversion, and draft statuses.
- Kept MCP as a thin adapter over the shared registry. MCP structured content still exposes the existing top-level data fields while adding `_sanctuary` metadata for facts, provenance, sensitivity, redactions, truncation, warnings, and non-identifying audit details.
- Added neutral read/cache boundaries (`assistantReadRepository`, assistant cache helpers) while keeping `mcpReadRepository` and `mcp/cache` as compatibility re-exports for existing MCP resources and tests.
- Added focused tests for registry metadata, invalid UUID validation before auth, empty transaction results, row-limit truncation, wallet authorization denial short-circuiting, wallet-not-found errors, unsafe fiat conversion bounds, and MCP adapter envelope output.
- Merge-queue follow-up: added assistant executor/DTO/utility coverage for wallet list tools, wallet overview, analytics, balance history, draft statuses, public fee/price tools, registry duplicate/unknown/null-input paths, redaction behavior, and invalid/boundary inputs.
- Quality review: split the registry into small tool modules to keep MCP registration thin and future Console reuse straightforward; file sizes stay below the 400-line project warning threshold.
- Edge-case audit: invalid/nullish tool input is validated before authorization; empty results return deterministic envelopes; row limits fetch one extra record for truncation proof; min/max amount bounds reject reversed ranges; reversed or overlong date ranges are rejected; raw actor/user IDs are not returned in envelope audit metadata; unsafe numeric price conversions fail closed.
- Verification passed: focused registry/MCP/cache/repository Vitest suite (30 tests), exact backend unit coverage gate (`npm run test:unit -- --coverage`, 400 files, 9,240 tests, 100% statements/branches/functions/lines), `npm run typecheck:server:tests`, `npm run lint:server`, touched-file lizard `-C 15`, `git diff --check`, and full backend suite (407 files, 9,328 tests, 505 skipped). The first earlier full backend attempt failed only inside the sandbox due `listen EPERM`; later full backend runs passed locally.

---

# Active Task: AI Proxy Gateway Hardening 2026-04-26

Status: complete

Goal: harden the AI proxy into the model gateway foundation for the Console/MCP work by authenticating backend-to-proxy calls, enforcing provider endpoint egress policy, and syncing active provider credentials without returning or logging secrets.

## Plan

- [x] Inspect current AI proxy routes, backend proxy callers, typed provider profile/credential storage, Compose env, and existing tests.
- [x] Add service-to-service authentication for every AI proxy route except `/health`, while preserving user bearer forwarding where routes need wallet/user authorization.
- [x] Add an explicit provider endpoint policy that allows local/container/LAN LLM endpoints by default and requires env allowlisting for public/cloud endpoints.
- [x] Sync active provider profile metadata and decrypted API-key credentials from backend to proxy memory without exposing secrets in responses or logs.
- [x] Update backend AI proxy caller helpers, docs/env examples, and focused tests for auth headers, endpoint policy, credential sync, and provider request headers.
- [x] Run focused AI proxy/backend verification, lizard, diff checks, quality review, edge-case audit, and self-review.

## Review

- Added service-to-service auth for every AI proxy route except `/health` through `x-ai-service-secret`, while config sync also sends `x-ai-config-secret` for compatibility with the existing secret boundary.
- Backend AI proxy callers now share one header builder so label/query/chat/analyze/model-management requests consistently carry the proxy service secret and preserve user bearer forwarding where the proxy needs backend user authorization.
- Added a provider endpoint egress policy that allows bundled Ollama, host/container endpoints, `.local`, localhost, private IPv4/IPv6, and explicit hostname/CIDR allowlists while blocking embedded URL credentials, unsupported schemes, and public/cloud endpoints unless `AI_PROXY_ALLOW_PUBLIC_HTTPS=true` or an allowlist is configured.
- Backend config sync now decrypts only the active, enabled provider credential, includes only non-secret credential state in the sync hash, sends the key only to proxy memory, and clears omitted/disabled/restored credentials by sending an empty key.
- Provider API keys are forwarded only as outbound provider `Authorization` headers from the proxy; config responses, health responses, and logs expose only configured/not-configured metadata.
- AI proxy service-secret comparison now uses timing-safe digest comparison, and the auth/egress helpers document their fail-closed security contracts for future Console/MCP reuse.
- Compose, `.env.example`, and AI proxy docs now document the gateway auth and provider endpoint policy, including the LAN LLM default path and explicit public/cloud opt-in.
- Verification passed: AI proxy focused Vitest suite (26 tests), backend AI/intelligence focused Vitest suite (106 tests), `npm --prefix ai-proxy run build`, `npm run typecheck:server:tests`, `npm run lint:server`, touched-file lizard `-C 15`, `git diff --check`, pre-commit changed-backend suite (435 tests), and pre-commit frontend suite (5,640 tests).
- Edge-case review: `/health` remains unauthenticated for health probes; missing `AI_CONFIG_SECRET` fails closed for backend-to-proxy calls; disallowed custom Ollama discovery endpoints are skipped and counted; invalid provider URLs and URLs with embedded credentials are rejected before fetch; disabled/restored or undecryptable credentials are not synced; empty provider API keys remove proxy memory credentials.

---

# Active Task: AI Provider Credential Boundary 2026-04-26

Status: complete

Goal: finish the next AI Settings provider-profile foundation slice by adding a typed, encrypted credential boundary that never returns secrets, fails closed after restore, and exposes only safe provider metadata to support packages.

## Plan

- [x] Inspect the current typed AI provider profile, admin settings, backup/restore, support-package, OpenAPI, and frontend API contracts.
- [x] Add a separate provider credential settings model with encrypted storage, write-only update payloads, redacted credential state, and profile-pruning behavior.
- [x] Update admin settings normalization so provider secrets are never returned and old endpoint/model compatibility continues to derive the active profile.
- [x] Disable restored AI provider credentials during backup restore with an admin warning.
- [x] Add support-package provider metadata that omits endpoints, model names, prompts, responses, and secret material.
- [x] Update API/OpenAPI/frontend types and focused tests for secret redaction, restore behavior, and support-package output.
- [x] Run focused verification, lizard, diff checks, quality review, edge-case audit, and self-review.

## Review

- Added `aiProviderCredentials` as a separate stored settings record and `aiProviderCredentialUpdates` as the write-only admin update payload, so encrypted API keys are not embedded in public provider profile lists.
- Admin settings responses now attach only redacted `credentialState` metadata to profiles and delete stored credential material before returning settings.
- Provider credential updates always encrypt write-only API keys, preserve existing stored credentials on no-op/profile edits, clear credentials explicitly, reject unknown profile references, and prune credentials for removed profiles.
- Backup restore now disables restored AI provider credentials, removes encrypted API key material, and warns admins to re-enter provider credentials in Admin > AI Settings.
- Support packages now include provider profile counts, provider-type counts, and credential configured/review counts without endpoints, model names, prompts, responses, or secrets.
- OpenAPI and frontend admin types now include redacted provider credential state plus write-only credential update payloads.
- Verification passed: focused AI provider/admin/backup/support Vitest suite (114 tests), full backend unit coverage (395 files, 9,212 tests, 100% statements/branches/functions/lines), `npm run typecheck:server:tests`, `npm run typecheck:app`, `npm run lint:server`, `npm run lint:app`, touched-file lizard `-C 15`, and `git diff --check`.
- Edge-case review: malformed credential maps fail closed to no credentials, malformed write-only updates are rejected, no-op credential updates preserve existing credentials, direct `aiProviderCredentials` writes are stripped, restored already-disabled credentials do not add duplicate warnings, and non-AI system settings pass through restore unchanged.

---

# Active Task: MCP Transport Restore Hardening 2026-04-26

Status: complete

Goal: harden the next Direct MCP release slice without pulling in the future tool-registry work: improve MCP HTTP compatibility/auth behavior, keep server metadata current, make restored MCP bearer tokens fail closed, and document/deploy the MCP profile consistently.

## Plan

- [x] Inspect current MCP transport, auth, server metadata, backup restore, env, GHCR Compose, docs, and focused tests.
- [x] Update MCP transport boundaries for compatible missing initial protocol headers and standards-aligned bearer auth responses.
- [x] Replace stale hardcoded MCP server version metadata with package-owned version data.
- [x] Revoke restored MCP key records during backup restore and warn admins that keys must be regenerated.
- [x] Add MCP env examples, GHCR Compose profile support, and clearer loopback/LAN/reverse-proxy guidance.
- [x] Add focused tests for protocol/auth/server metadata/restore behavior.
- [x] Run focused verification, lizard, diff checks, quality review, edge-case audit, and self-review.

## Review

- MCP HTTP transport now accepts missing `MCP-Protocol-Version` only for initial `initialize` requests, while still rejecting missing headers on normal calls and unsupported explicit versions.
- MCP 401 responses now include `WWW-Authenticate: Bearer realm="sanctuary-mcp"` for client-compatible bearer auth handling.
- MCP server metadata now uses the server package version instead of the stale hardcoded `0.8.34`.
- Backup restore now forces restored MCP API keys to `revokedAt` and returns an admin warning so old bearer tokens cannot become usable on a restored node.
- GHCR Compose now includes the optional `mcp` profile with loopback host publishing by default, matching the source-build Compose service.
- `.env.example` and `docs/how-to/mcp-server.md` now document MCP variables, GHCR profile usage, loopback defaults, LAN TLS/VPN/reverse-proxy guidance, protocol-header compatibility, MCP Inspector usage, and restored-key revocation.
- Verification passed: focused MCP/backup Vitest suite (86 tests), full MCP unit/API/support sweep (44 tests), `npm run typecheck:server:tests`, `npm run lint:server`, server `npm run build`, touched-file lizard `-C 15`, `git diff --check`, and GHCR Compose profile render with placeholder secrets.
- Edge-case review: missing protocol headers are still rejected for non-initialize methods; unsupported explicit protocol versions are still rejected before auth; existing revoked MCP keys keep their original revocation timestamp; restored unrevoked MCP key metadata is retained but made unusable; GHCR MCP port remains loopback-bound unless the operator explicitly changes `MCP_BIND_ADDRESS`.

---

# Active Task: Typed AI Provider Profile Foundation 2026-04-26

Status: complete

Goal: introduce the first typed AI provider profile foundation so AI Settings can evolve from loose endpoint/model fields toward explicit provider profiles without breaking the existing Ollama configuration workflow.

## Plan

- [x] Inspect current AI Settings, admin settings, backend AI config, proxy, and related tests.
- [x] Define the first typed provider profile model and compatibility mapping around the existing endpoint/model settings.
- [x] Update backend/admin and frontend API types to expose the typed active profile while preserving current UI behavior.
- [x] Add focused tests for default, saved, invalid, and update paths.
- [x] Run focused frontend/backend verification plus diff checks.
- [x] Review edge cases and document results.

## Review

- Added a typed AI provider profile domain model with provider type, endpoint/model, capabilities, duplicate-ID validation, and default Ollama compatibility.
- Split boundaries so provider profile schema/state logic lives in `server/src/services/ai/providerProfile.ts`, admin settings mapping lives in `server/src/services/ai/providerProfileSettings.ts`, and `adminSettingsService` remains orchestration.
- Admin settings now derive a default typed profile from existing `aiEndpoint`/`aiModel`, expose active profile response state, mirror endpoint/model updates into the active profile, reject invalid profile lists, and strip derived active profile objects from writes.
- AI config reads the active typed profile while keeping the current AI proxy sync payload unchanged at `{ enabled, endpoint, model }`.
- OpenAPI and frontend types now expose typed provider profiles; update contracts omit the derived `aiActiveProviderProfile` object.
- Verification passed: backend focused Vitest suite (`admin-routes`, `openapi`, `aiService`, `adminSettingsService`, `aiProviderProfileSettings`, `schemas`) 178 tests; `npm run typecheck:app`; `npm run typecheck:tests`; `npm run typecheck:server:tests`; `npm run lint:server`; `npm run lint:app`; lizard `-C 15` on touched AI/settings services; `git diff --check`.

---

# Active Task: AI Settings Rename Foundation 2026-04-26

Status: complete

Goal: rename the admin AI configuration surface from "AI Assistant" to "AI Settings" as the first greenfield foundation slice for the MCP/Console/provider-profile implementation.

## Plan

- [x] Inspect the admin AI route, page copy, modal copy, and focused AI Settings tests.
- [x] Update user-facing route/page copy to use "AI Settings" and reserve "AI features" for enablement language.
- [x] Update focused AI Settings contract tests to match the new product language.
- [x] Run focused AI Settings tests plus diff checks.
- [x] Review edge cases, self-review the diff, and document results.

## Review

- Renamed the admin AI route/nav/page surface from "AI Assistant" to "AI Settings" while keeping the `/admin/ai` route and existing component/module names stable.
- Updated enablement language to use "AI features" / "Enable AI Features" instead of naming the settings page as an assistant.
- Updated AI-disabled error messages and user/admin docs that point to the configuration location: `Admin -> AI Settings`.
- Updated focused AI Settings, route manifest, and render-regression expectations.
- Verification passed: `npx vitest run tests/components/AISettings.test.tsx tests/components/AISettings.logic.test.tsx tests/components/AISettingsSubcomponents.test.tsx tests/src/app/appRoutes.test.ts tests/components/AIQueryInput.test.tsx tests/components/AILabelSuggestion.test.tsx` (6 files, 161 tests).
- Verification passed: `git diff --check`.
- Edge-case review: no runtime control-flow changes; no null/empty/async boundary behavior changed. Fixed the modal test to query by heading role because the page and modal intentionally share the "Enable AI Features" phrase.

---

# Active Task: MCP Dual-Path Implementation Plan 2026-04-25

Status: complete

Goal: create a phased implementation plan for direct external MCP access plus an in-app Sanctuary Console that uses a LAN LLM and the same backend-controlled read-tool surface.

## Plan

- [x] Reuse the MCP release-readiness audit findings as implementation inputs.
- [x] Define the target architecture for direct MCP and the in-app console.
- [x] Specify authentication and authorization requirements for outside LLM/MCP access.
- [x] Break the work into sequenced milestones with acceptance criteria.
- [x] Include verification gates, security boundaries, and open decisions.
- [x] Write the implementation plan to `docs/plans/mcp-dual-path-implementation-plan.md`.

## Review

- Wrote `docs/plans/mcp-dual-path-implementation-plan.md`.
- Recommended a shared read-tool registry outside `server/src/mcp`, with MCP and Sanctuary Console as adapters over the same scoped, audited, read-only executors.
- Defined external MCP authentication as client/agent authentication, not model authentication: scoped expiring MCP client profiles, optional CIDR binding, explicit audit/admin/high-sensitivity scopes, and no MCP tokens in prompts or browser-visible state.
- Sequenced implementation across MCP hardening, shared tool extraction, GUI read-parity expansion, console backend, console UI, admin MCP profile UI, and end-to-end release proof.
- Preserved current AI security posture by keeping external model calls in `ai-proxy` while backend-owned orchestration validates and executes tool calls.
- First-release boundary remains read-only: no OS shell, arbitrary SQL, spending, signing, address generation, PSBT handling, or state mutation through the console/MCP surface.
- Follow-up AI proxy review: keep the isolated proxy boundary, but harden it into a generic model gateway before console work. Required changes include service auth on non-health routes, provider credentials, endpoint egress controls, normalized planning/synthesis calls, native tool-call plus JSON fallback support, typed errors, and no prompt/result logging.
- Follow-up app-surface review: added Milestone 0 for cross-app boundary prep after scanning access control, wallet sharing, agent auth, AI settings/secrets, internal AI/conversation APIs, audit/support packages, backup/restore, deployment packaging, OpenAPI/frontend API clients, observability, and the Intelligence UI.
- Noted two console-specific guardrails from the current Intelligence implementation: validate conversation wallet access on creation/message handling and replace browser-supplied `walletContext` with backend-derived context before enabling tool execution.
- Added remaining gap checks to Milestone 0: formal threat model, data sensitivity matrix, model capability detection, prompt-injection corpus, answer provenance, retention/deletion policy, mid-conversation permission changes, provider egress/SSRF rules, resource controls, future write-path pattern, preview/supported labeling, recovery/rotation workflow, and typed AI provider profile decision.
- Resolved the provider-settings direction in the plan: use a typed AI provider profile model, with generic settings limited to active provider ID and feature toggles.
- User correction captured: provider profile UI should extend the existing admin AI Assistant section (`components/AISettings` / AI Assistant route), not create a separate admin area.
- Added rename guidance: admin navigation/page label should move from "AI Assistant" to "AI Settings" as provider profiles, credentials, model management, proxy health, capabilities, and console configuration become part of the section.
- Plan refinement pass: added a first-release cutline, user-experience principles, key user journeys, shared tool result envelope, greenfield AI transition strategy, feature flags, richer console UX requirements, MCP profile wizard requirements, and a more explicit PR sequence.
- Added prompt-history requirements: store prompts separately from responses, support search/save/replay/delete/expiration, retain admin retention controls, and re-run tool authorization/execution on replay instead of reusing stale tool results.
- Added Console placement decision: one canonical Intelligence Console workspace, contextual "Ask Console" actions from wallets/transactions/etc., and a desktop side drawer backed by the same conversation/history/replay model rather than separate embedded assistants per wallet.
- Added Theme Settings flyout-surface guidance: user-adjustable opacity for glass-to-solid flyouts, active-theme/light-dark tint tokens, shared `surface-flyout` behavior, and Console drawer tests for glass/solid modes.
- Added Console trigger model: global Intelligence entry, contextual "Ask Console" header/tool buttons, compact icon buttons with tooltips, row/action-menu items, selected-row bulk actions, suggested prompt chips, and structured scope payloads.
- Added non-contextual Console guidance: a persistent app-shell icon opens an unscoped/general-scope drawer from anywhere, current route is only a hint, and wallet tools require explicit scope selection before execution.
- Added keyboard shortcut strategy: central shortcut registry/provider, shortcut help overlay, editable-field exclusions, focus restore, Console shortcut candidates, contextual shortcut scope rules, and tests for conflicts/accessibility.
- Refined global Console trigger placement: put the subtle AI icon in a compact quick-action row directly under Dashboard in the primary sidebar, leaving the already-crowded footer alone and reserving row space for future app-wide icons.
- Confirmed flyout presentation direction: right-side drawer remains the default desktop surface, full Console is the expand target, pinned right rail is a later power-user mode, mobile uses bottom sheet/full-screen, and left drawer/modal/floating bubble are intentionally avoided for v1.
- Added a pre-implementation clarification backlog covering scope defaults, v1 tool cutline, sensitivity defaults, provider/model support floor, prompt/trace retention, saved prompt boundaries, quick-action row states, drawer sizing/pinning, shortcut defaults, streaming/cancellation, chain data sources, LAN MCP stance, greenfield AI transition, and audit vocabulary.
- Accepted clarification decisions: global Console opens in General Network scope by default, and v1 required tools are minimal network plus wallet basics.
- Accepted sensitivity decision: v1 sends computed facts/aggregates by default, while the long-term trusted-LLM target can intentionally allow most GUI-readable data with explicit user controls and auditing.
- Accepted provider/model support floor: native OpenAI-compatible tool calls are preferred, strict JSON planning fallback is required for tool-capable Console support, and weaker models are limited to clearly labeled non-tool chat/explanation.
- Accepted prompt/trace retention default: store prompt text and low-sensitivity metadata by default, avoid raw high-sensitivity payload persistence, include low-sensitivity prompt metadata in backups, and keep admins from reading other users' prompt text by default.
- Accepted saved prompt boundary: saved prompts are personal-only in v1, optionally tagged/scoped, with wallet/team shared prompt libraries deferred until explicit permissions and audit/retention rules exist.
- Accepted sidebar quick-action row: compact icon-only row directly below Dashboard, starting with AI and supporting future global utility icons with tooltips, focus, active/open, disabled/setup-needed, and overflow states.
- Clarified deletion/disabled states from accepted decisions: conversation deletion removes prompt entries, model responses, and non-audit trace metadata together; non-admins see a disabled/setup-needed AI trigger explanation while admins get an AI Settings path.
- Accepted drawer sizing/pinning: v1 uses a fixed-width right overlay drawer with expand-to-full-Console; pinned rail and resizing are deferred until drawer behavior, focus handling, traces, and theme opacity are stable.
- Accepted keyboard shortcut defaults: ship the registry/help overlay first, show enabled shortcuts in tooltips/menus, and add a conservative global Console shortcut only after conflict testing.
- Accepted streaming/cancellation behavior: v1 uses whole-turn responses with visible progress states and cancel, per-tool timeouts, turn-level cancellation, and token streaming deferred until orchestration/audit/trace contracts are stable.
- Accepted chain/network data source rule: use configured Sanctuary sources only, including Bitcoin Core/Electrum/cache/indexer/stored state, never arbitrary model-requested URLs, with source/freshness/tip/computed-at/stale metadata shown.
- Accepted direct MCP stance: loopback MCP is supported after hardening, LAN MCP is advanced/disabled by default with TLS/VPN/reverse-proxy warning and scoped expiring credentials, and Sanctuary Console remains the recommended path.
- Accepted greenfield AI transition: no legacy AI compatibility requirement; existing chat/label/query/insight/proxy routes can be replaced or removed as provider profiles, model gateway, and Console APIs land.
- Accepted audit vocabulary: metadata-only operational audit for Console/MCP/AI in v1, recording tool/scope/sensitivity/duration/counts/denials/provider/key IDs while excluding prompt text, model responses, secrets, raw identifiers, labels/memos, and raw high-sensitivity payloads by default.
- Accepted final implementation decisions: custom scoped bearer auth for MCP v1, explicit high-sensitivity scope for direct MCP raw identifiers, required wallet scope for LAN MCP profiles, loopback/auth-gated MCP metrics, summary/metadata trace storage by default, and guided provider allowlist presets with expert hostname/CIDR controls.

---

# Active Task: MCP Server Release Readiness Audit 2026-04-25

Status: complete

Goal: audit whether Sanctuary's MCP server is ready for the next release as a LAN-accessible, local-LLM interface that can cover GUI-equivalent read workflows and natural-language wallet/transaction questions without unsafe write or secret exposure.

## Plan

- [x] Map the implemented MCP transport, authentication, config, Docker/startup, and admin key-management surface.
- [x] Compare implemented resources/tools/prompts against GUI/API wallet, transaction, UTXO, address, label, draft, policy, fee, price, insight, and audit-log workflows.
- [x] Inspect security, privacy, LAN deployment, rate limiting, audit logging, data redaction, and read-only boundaries.
- [x] Assess the two-path product model: direct external MCP clients and an in-app Sanctuary console that uses a LAN LLM plus the same MCP/read tool surface.
- [x] Check tests and docs for release-grade behavior, including local LLM client compatibility and failure modes.
- [x] Write an evidence-backed readiness report with blockers, gaps, release recommendations, and verification results.
- [x] Run focused validation commands and self-review the audit artifacts.

## Review

- Wrote `docs/plans/mcp-server-release-readiness-audit.md`.
- Verdict: current MCP is a solid loopback-only read-only preview, but not release-ready as a LAN-accessible external LLM/MCP path.
- Direct LAN MCP blockers: missing correct LAN docs/config, plain HTTP bearer-token exposure without TLS/VPN guidance, restored backups can resurrect MCP API key hashes, no real MCP client/LLM integration proof, and incomplete GUI read parity.
- Existing MCP auth supports bearer `mcp_...` keys, revocation, optional expiry, wallet scopes, audit-log scope, rate limiting, and audit logs. For the outside-LLM path, default keys should be expiring, wallet-scoped, and transported only over HTTPS/VPN/reverse proxy.
- Recommended two paths: keep direct MCP for power users and external clients, and build a safer in-app Sanctuary Console on the existing Treasury Intelligence chat/AI proxy with backend-owned read-only tool execution.
- Focused MCP validation passed: 9 Vitest files, 85 tests.

---

# Active Task: Phase 3 Compose Benchmark Modularization 2026-04-25

Status: complete

Goal: split `scripts/perf/phase3-compose-benchmark-smoke.mjs` into smaller responsibility-focused modules while keeping the existing CLI entrypoint, environment contract, and proof behavior stable.

## Plan

- [x] Map the current benchmark entrypoint responsibilities, helper groups, and top-level side effects.
- [x] Extract shared formatting/parsing helpers, config defaults, Compose runtime, benchmark harness, report rendering, proof runners, and embedded child proof scripts into `scripts/perf/phase3-compose/`.
- [x] Keep `scripts/perf/phase3-compose-benchmark-smoke.mjs` as the thin orchestrator for config, Compose lifecycle, proof sequencing, and report writing.
- [x] Run syntax checks, lizard on touched files, architecture boundaries, gitleaks, full Compose smoke, and lightweight size checks.
- [x] Update task notes and, if the large-file evidence changes materially, refresh the grade report/history.
- [x] Self-review the diff for changed behavior, cleanup safety, and edge cases.

## Review

- Split `scripts/perf/phase3-compose-benchmark-smoke.mjs` from 2,686 lines to 370 lines.
- Added `scripts/perf/phase3-compose/config.mjs` so the plain `npm run perf:phase3:compose-smoke` path uses code-owned defaults; env vars remain explicit overrides, not required command prefixes.
- Added focused modules for Compose runtime, benchmark evidence, proof API, Postgres JSON execution, capacity snapshots, large-wallet proof, backup restore proof, worker proofs, backend scale-out proof, Markdown report rendering, and embedded child proof scripts.
- Fixed port probing diagnostics so sandbox bind denials report `EPERM/EACCES` instead of being mistaken for occupied ports.
- Fixed parent-process proof API calls to trust the generated Compose CA directly, matching the child benchmark harness TLS behavior without shell-prefix setup.
- Default `npm run perf:phase3:compose-smoke` passed end to end with Docker access: benchmark harness, 1,000-row large-wallet proof, sized restore proof, worker queue/scale-out proofs, backend Redis WebSocket fanout, capacity snapshots, report writing, and Compose cleanup all completed.
- Verification also passed: module `node --check`, touched-file lizard, full repo lizard, architecture-boundaries, gitleaks, large-file classification, config default resolution, and `git diff --check`.
- Updated `docs/plans/codebase-health-assessment.md` and appended the Phase 3 Compose split history entry. Score remains 97/100 because the largest scanned files are now verified address vector fixtures at 2,118 lines.

---

# Active Task: Architecture Boundary Complexity Fix 2026-04-25

Status: complete

Goal: refactor `scripts/check-architecture-boundaries.mjs` so the architecture boundary checker no longer trips the `CCN > 15` lizard threshold, then refresh the grade evidence.

## Plan

- [x] Inspect the current high-CCN lizard finding and the architecture boundary check surface.
- [x] Split import parsing and rule predicates into small named helpers without changing rule behavior.
- [x] Run syntax, architecture-boundary, and lizard verification.
- [x] Update the grade report/history and task review with the new score.
- [x] Review the diff and final verification output.

## Review

- Split import parsing into `scripts/quality/import-parser.mjs` and imported it from `scripts/check-architecture-boundaries.mjs`.
- Replaced inline architecture rule `from`/`forbidden` predicates with named helpers so lizard measures the real small predicate units instead of misattributing the rule table tail to one function.
- `npm run check:architecture-boundaries` still passes with 1,860 files, 7,186 imports, 10 rules, and 40 exceptions.
- Full repo lizard now reports 0 warnings, average CCN 1.3, and no thresholds exceeded.
- Full working-tree gitleaks still reports 0 findings after adding the helper file.
- Updated the grade report to 97/100 (A), with Maintainability restored to 12/15.
- Appended the post-lizard-remediation history entry for `1af2fe0d`.
- Final `git diff --check` passed.

---

# Active Task: Grade Secret Gate Remediation 2026-04-25

Status: complete

Goal: remove the full working-tree gitleaks hard-fail caused by ignored generated Docusaurus output while preserving tracked-source and latest-commit secret scanning.

## Plan

- [x] Confirm the finding is in ignored generated output and that the canonical source document scans clean.
- [x] Add the narrowest practical gitleaks ignore for the generated-output false positive.
- [x] Rerun full, tracked-tree, and latest-commit gitleaks scans.
- [x] Refresh grade report/history and task notes with the remediated score.
- [x] Run final diff/quality checks and self-review.

## Review

- Added an exact `.gitleaksignore` fingerprint for the ignored generated Docusaurus HTML false positive: `website/build/docs/reference/hardware-wallet-integration.html:generic-api-key:248`.
- Verified `docs/reference/hardware-wallet-integration.md` and the Docusaurus intermediate JSON both scan clean, so the ignore only suppresses local built output.
- Full working-tree, latest-commit, and tracked-tree gitleaks scans now report 0 findings.
- Updated the grade report to 95/100 (A), with Security restored to 15/15 and no hard-fail blockers.
- Appended a post-remediation full trend entry for `1af2fe0d`.
- Final `git diff --check` passed.

---

# Active Task: Repository Grade Audit Rerun 2026-04-25

Status: complete

Goal: rerun the `$grade` full-repository audit after the other PR work was pushed, update `docs/plans/codebase-health-assessment.md`, and compare the result against the previous full run.

## Plan

- [x] Confirm current branch, dirty worktree state, local date, commit, grade standards, and previous trend entry.
- [x] Collect full-repository mechanical signals with grade tooling and direct supplemental tools where needed.
- [x] Inspect targeted evidence for judged criteria and compare against the previous run.
- [x] Score domains, check hard-fail gates, append trend history, and update the report.
- [x] Review changed files, edge cases, and final verification output.

## Review

- Reran the full grade audit on `main` at `1af2fe0d` after PR #180 landed.
- Raw domain score remains 91/100, capped to 69/100 (D) by the `secrets=1` hard-fail gate.
- The hard-fail finding is still a redacted `gitleaks` hit in ignored generated Docusaurus output: `website/build/docs/reference/hardware-wallet-integration.html:248`; tracked-tree and latest-commit scans both report 0 findings.
- Native tests, lint, typecheck, app/backend/gateway coverage, high/critical package audits, architecture boundaries, browser-auth contract, OpenAPI route coverage, and large-file classification passed.
- App coverage increased to 407 files / 5,630 tests; backend coverage passed with 398 files / 9,253 tests plus skipped integration cases; gateway coverage passed with 21 files / 528 tests.
- Maintainability still loses points for `scripts/check-architecture-boundaries.mjs:296` at CCN 25 and the 2,686-line largest classified file.
- Trend history was appended for commit `1af2fe0d`; final `git diff --check` passed.

---

# Active Task: Repository Grade Audit 2026-04-25

Status: complete

Goal: run the `$grade` full-repository audit, update `docs/plans/codebase-health-assessment.md`, and record evidence-backed scoring without disturbing existing in-flight work.

## Plan

- [x] Read project lessons, grade standards, repository status, and prior trend context.
- [x] Collect full-repository mechanical signals with the grade skill tooling.
- [x] Inspect targeted source, tests, config, and operational files for judged criteria.
- [x] Score domains, check hard-fail gates, append trend history, and write the report.
- [x] Review the report and task notes for correctness, edge cases, and unintended edits.

## Review

- Raw domain score is 91/100, capped to 69/100 (D) by the `secrets=1` hard-fail gate.
- The hard-fail finding is a redacted `gitleaks` hit in ignored generated Docusaurus output: `website/build/docs/reference/hardware-wallet-integration.html:248`.
- Tracked-tree and latest-commit gitleaks scans both report 0 findings, so committed source is clean for the secret signal.
- Native tests, lint, typecheck, coverage, architecture boundaries, browser-auth contract, OpenAPI route coverage, large-file classification, and high/critical package audits passed.
- Maintainability lost points for one pinned lizard warning: `scripts/check-architecture-boundaries.mjs:296` has CCN 25.
- Final `git diff --check` passed.

---

# Active Task: Docusaurus Docs Hardening

Status: complete

Goal: harden the Docusaurus docs architecture after PR #179, scoped to the curated published-docs contract, Docusaurus routing/navigation, generated architecture appendices, Mermaid click/pan behavior, and focused architecture/doc validation.

## Plan

- [x] Start from current `origin/main` on `docs/docusaurus-hardening` instead of mixing changes into the merged notification branch.
- [x] Merge and verify PR #179, then rebase `docs/docusaurus-hardening` onto post-179 `origin/main`.
- [x] Clarify the published-docs contract so the site no longer claims or links to unpublished material as if it were local.
- [x] Add AI Proxy as a first-class service architecture page in Docusaurus.
- [x] Simplify the sidebar into C4 docs plus generated appendices, avoiding duplicate call-graph navigation.
- [x] Fix local route consistency so the architecture navbar/root redirect uses the canonical Docusaurus doc path.
- [x] Add website typecheck, fix Mermaid pan/zoom typing/robustness, and wire typecheck into architecture CI.
- [x] Keep Mermaid doc drill-downs inside Docusaurus while sending source-code clicks to GitHub.
- [x] Make broken links and images fail once the curated include set no longer exposes unrelated stale docs.
- [x] Harden call graph config validation, schema support, stale generated cleanup, and generated appendix navigation.
- [x] Harden module graph generation so Mermaid output cannot silently become blank.
- [x] Run focused website and architecture verification.
- [x] Record review evidence and self-review the diff.

## Review

- PR #179 merged and was verified on `origin/main` at `ed6b7b10 chore: forbid direct notification imports outside the dispatch layer (#179)`.
- Added an explicit Docusaurus published-docs include contract with AI Proxy architecture included and plans/archive/ideas left as repository-only GitHub links.
- Reworked the sidebar around the docs index, C4 architecture pages, per-service architecture pages, and generated appendices so call graphs live under generated appendices instead of duplicate top-level navigation.
- Set broken links and markdown image/link hooks to fail the build, then fixed local published-doc links surfaced by the stricter gate.
- Added `website` typecheck and wired it before the Docusaurus build in architecture CI.
- Fixed `svg-pan-zoom` typing by using the package's CommonJS export shape and made binding retry after lazy-load failure instead of permanently marking diagrams as processed.
- Updated Mermaid click rewriting so curated doc targets resolve to Docusaurus routes under `/sanctuary/`, while source/off-contract repository targets resolve to GitHub blob URLs.
- Added runtime validation for `docs/architecture/calls.config.json`, plus `docs/architecture/calls.config.schema.json`, unmatched include failures, and stale generated call-page cleanup.
- Added generated architecture index pages for module graphs and function-level call graphs.
- Fixed module graph generation to use dependency-cruiser's API with explicit package `baseDir`, validate configured patterns, and fail if Mermaid output is blank.
- Verification passed:
  - `gh pr merge 179 --auto`
  - `gh pr view 179 --json state,mergedAt,mergeCommit,mergeStateStatus,headRefOid,url`
  - `git -C /tmp/sanctuary-pr179 merge-base --is-ancestor ed6b7b105f6c33e226fb3693a9d7ca15f2ad026e origin/main`
  - `npm run arch:graphs`
  - `npm run arch:calls`
  - `npm run arch:lint`
  - `npm run check:architecture-boundaries`
  - `node --check scripts/architecture/extract-call-graphs.mjs`
  - `node --check scripts/architecture/generate-graphs.mjs`
  - `npm --prefix website run typecheck`
  - `npm run docs:build`
  - `git diff --check`
  - `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 scripts/architecture/extract-call-graphs.mjs scripts/architecture/generate-graphs.mjs website/src/clientModules/mermaidPanZoom.ts website/src/plugins/remark-mermaid-click-rewrite.mjs`
- `npm run docs:build` exited successfully with the existing nonfatal `vscode-languageserver-types` webpack warning and Docusaurus update-check permission warning.

---

# Active Task: CI/CD Test Speed Batch 5 - E2E Timing Instrumentation

Status: in progress

Goal: measure E2E setup, build, backend preparation, and Playwright runtime separately so the next CI speed change can target the actual long pole.

## Plan

- [x] Work in an isolated worktree from updated `origin/main`.
- [x] Wrap quick browser smoke setup/build/run steps with `scripts/ci/time-command.sh`.
- [x] Wrap quick render regression setup/build/run steps with `scripts/ci/time-command.sh`.
- [x] Wrap full browser E2E frontend setup, backend setup/build, and grouped Playwright run steps with `scripts/ci/time-command.sh`.
- [x] Wrap full render E2E setup/build/run steps with `scripts/ci/time-command.sh`.
- [x] Update CI/CD strategy docs and task tracker history.
- [x] Run workflow lint and diff check.
- [ ] Deliver through PR, monitor checks, merge safely, and verify the merge.

## Review

- Wrapped quick browser smoke dependency install, Playwright browser install, frontend build, and smoke test run with CI timing notices.
- Wrapped quick render regression dependency install, Playwright browser install, frontend build, and render test run with CI timing notices.
- Wrapped full browser E2E frontend setup, backend dependency install, Prisma generation/migration, backend build, and grouped Playwright runs with CI timing notices.
- Wrapped full render E2E dependency install, Playwright browser install, frontend build, and render test run with CI timing notices.
- Verification passed:
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml`
  - `git diff --check`

---

# Active Task: CI/CD Test Speed Batch 4 - Docker Image Scope

Status: complete

Goal: build only the dev image affected by a Docker-relevant change instead of always building both frontend and backend images.

## Plan

- [x] Work in an isolated worktree from updated `origin/main`.
- [x] Add a Docker image-scope classifier with frontend/backend outputs.
- [x] Split the Docker workflow into frontend and backend image build jobs gated by classifier outputs.
- [x] Keep manual dispatch and shared image inputs building both images.
- [x] Add classifier regression fixtures and wire them into Code Quality.
- [x] Update CI/CD strategy docs and task tracker history.
- [x] Run classifier tests, workflow lint, shell complexity, and diff check.
- [x] Deliver through PR, monitor checks, merge safely, and verify the merge.

## Review

- Added `scripts/ci/classify-docker-build-images.sh` with explicit frontend/backend image impact outputs.
- Split `Build Dev Images` into `Build frontend image` and `Build backend image` jobs gated by the classifier.
- Manual dispatch and shared image inputs still build both images.
- Frontend-only inputs build only the frontend image; backend-only inputs build only the backend image; monitoring-only Docker config and docs-only paths build neither.
- Wired the new classifier regression test into Code Quality's CI classifier test job.
- Verification passed:
  - `bash -n scripts/ci/classify-docker-build-images.sh tests/ci/classify-docker-build-images.test.sh`
  - `bash tests/ci/classify-docker-build-images.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/docker-build.yml .github/workflows/quality.yml`
  - `/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -l shell scripts/ci/classify-docker-build-images.sh tests/ci/classify-docker-build-images.test.sh`
  - `git diff --check`
- Delivered in PR #165; merge-group Test Suite, Code Quality, and CodeQL passed, and `origin/main` advanced to merge commit `7548ebd3`.

---

# Active Task: CI/CD Test Speed Batch 3 - Backend Typecheck Scope

Status: complete

Goal: remove unnecessary Postgres startup and migration work from backend typecheck jobs while preserving DB-backed backend test coverage where tests need it.

## Plan

- [x] Work in an isolated worktree from updated `origin/main`.
- [x] Split PR backend typecheck into its own DB-free quick job.
- [x] Keep PR related backend tests DB-backed.
- [x] Split full backend typecheck from DB-backed unit coverage.
- [x] Update backend aggregate checks to require typecheck and unit coverage when source scope is relevant.
- [x] Update CI/CD strategy docs and task tracker history.
- [x] Run backend typecheck proof, workflow lint, and diff check.
- [x] Deliver through PR, monitor checks, merge safely, and verify the merge.

## Review

- Added `Quick Backend Typecheck` as a DB-free PR job.
- Kept `Quick Backend Tests` DB-backed for related non-integration Vitest tests, but removed typecheck from that DB-backed job.
- Replaced the full backend source matrix with separate `Full Backend Typecheck` and `Full Backend Unit Coverage` jobs.
- Kept backend unit coverage DB-backed and preserving the `backend-coverage` artifact.
- Updated `Full Backend Tests` to require both backend typecheck and backend unit coverage when backend source scope is relevant.
- Verification passed:
  - `npm --prefix server ci`
  - `npm --prefix server run typecheck:tests`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml`
  - `git diff --check`
- Delivered in PR #163; merge-group Test Suite and CodeQL passed, and `origin/main` advanced to merge commit `88f0652c`.

---

# Active Task: CI/CD Test Speed Batch 2 - AI Proxy Scope

Status: complete

Goal: add explicit ai-proxy CI classification and validation so ai-proxy changes run only the ai-proxy build/tests instead of unrelated frontend/backend lanes.

## Plan

- [x] Work in an isolated worktree from updated `origin/main`.
- [x] Add `ai_proxy_changed` and `ai_proxy_files` classifier outputs.
- [x] Keep `tests/ai-proxy` scoped to ai-proxy validation instead of frontend validation.
- [x] Add PR quick and merge/main full ai-proxy jobs.
- [x] Wire ai-proxy results into required aggregate checks.
- [x] Add classifier fixtures and CI strategy docs.
- [x] Run focused classifier tests, ai-proxy build/tests, workflow lint, diff check, and shell complexity checks.
- [x] Deliver through PR, monitor checks, merge safely, and verify the merge.

## Review

- Added explicit `ai_proxy_changed` and `ai_proxy_files` classifier outputs.
- Scoped `ai-proxy/` and `tests/ai-proxy/` changes to the AI proxy lane, so they no longer trigger frontend tests by path overlap.
- Added `Quick AI Proxy Tests` and `Full AI Proxy Tests`, each running the ai-proxy build plus the dedicated `tests/ai-proxy` suite.
- Wired AI proxy results into `PR Required Checks` and `Full Test Summary`.
- Updated CI/CD strategy docs with the ai-proxy local gate and CI scope policy.
- Verification passed:
  - `npm ci`
  - `npm --prefix ai-proxy ci`
  - `bash -n scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `npm --prefix ai-proxy run build`
  - `npx vitest run tests/ai-proxy --passWithNoTests`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml`
  - `/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -l shell scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
  - `git diff --check`
- Delivered in PR #162; merge-group Test Suite and CodeQL passed, and `origin/main` advanced to merge commit `a8980f9b`.

---

# Active Task: CI/CD Test Speed Batch 1 - Docs-Only Scope

Status: complete

Goal: ensure docs-only changes, including package-local docs, do not start source tests, DB-backed tests, install tests, E2E lanes, or image builds.

## Plan

- [x] Work in an isolated worktree from `origin/main`.
- [x] Treat Markdown/MDX as docs-only in the Test Suite classifier.
- [x] Treat install Markdown/MDX changes as docs-only in the Install Tests classifier.
- [x] Add workflow path exclusions for package-local docs on main/push and path-gated workflows.
- [x] Add classifier fixtures for server, gateway, ai-proxy, and install docs paths.
- [x] Run focused classifier tests, workflow lint, diff check, and shell complexity checks.
- [x] Deliver through PR, monitor checks, merge safely, and verify the merge.

## Review

- Markdown/MDX changes are docs-only in the Test Suite classifier.
- Install Markdown/MDX changes are docs-only in the Install Tests classifier.
- Main/push path filters now exclude package-local docs for test, install, and Docker image workflows while leaving PR aggregate checks available where branch protection expects them.
- Added regression fixtures for `server/src/services/DEPENDENCIES.md`, `gateway/README.md`, `ai-proxy/README.md`, `tests/install/README.md`, and `tests/install/utils/README.md`.
- Verification passed:
  - `bash -n scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh tests/install/utils/classify-install-scope.sh tests/install/unit/install-scope.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `bash tests/install/unit/install-scope.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml .github/workflows/install-test.yml .github/workflows/docker-build.yml`
  - `/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -l shell scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh tests/install/utils/classify-install-scope.sh tests/install/unit/install-scope.test.sh`
  - `git diff --check`
- Delivered in PR #161; merge-group Test Suite and CodeQL passed, and `origin/main` advanced to merge commit `701d64bd`.

---

# Active Task: CI/CD Test Speed Phase 5 - Backend Full Integration Scope

Status: complete

Goal: keep backend merge/main confidence path-aware by running DB-backed integration groups only for integration-sensitive backend changes, test workflow changes, or exhaustive runs.

## Plan

- [x] Work in an isolated worktree from `origin/main` after Phase 4 merged.
- [x] Split backend full-lane execution into source tests and integration tests.
- [x] Keep `Full Backend Tests` as the aggregate backend job consumed by `Full Test Summary`.
- [x] Use the existing `backend_integration_changed` classifier output for DB-backed integration group relevance.
- [x] Preserve stable backend coverage artifact upload from the unit coverage source target.
- [x] Update CI/CD strategy docs with the source/integration full-lane policy.
- [x] Run classifier tests, backend group tests, workflow lint, diff check, and touched-file lizard if available.
- [x] Deliver through PR, monitor required checks, merge safely, and verify the merge.

## Review

- Split the old backend full-lane matrix into `Full Backend Source Tests` and `Full Backend Integration Tests`.
- Kept `Full Backend Tests` as the aggregate backend job consumed by `Full Test Summary`.
- Backend source tests run for backend changes, test workflow changes, and full scans.
- Backend integration tests run only for `backend_integration_changed`, test workflow changes, and full scans.
- The `backend-coverage` artifact remains produced by the unit coverage source target, so downstream summary behavior stays stable.
- Updated CI/CD strategy docs with the full-lane backend source/integration policy.
- Verification passed:
  - `bash -n scripts/ci/classify-test-changes.sh scripts/ci/classify-codeql-languages.sh scripts/ci/classify-quality-scope.sh scripts/ci/browser-e2e-groups.sh scripts/ci/backend-integration-groups.sh scripts/ci/frontend-coverage-shard.sh scripts/ci/frontend-coverage-merge.sh scripts/ci/time-command.sh scripts/ci/report-workflow-durations.sh scripts/ci/report-workflow-trends.sh tests/ci/classify-test-changes.test.sh tests/ci/classify-codeql-languages.test.sh tests/ci/classify-quality-scope.test.sh tests/ci/browser-e2e-groups.test.sh tests/ci/backend-integration-groups.test.sh tests/ci/frontend-coverage-scripts.test.sh tests/ci/report-workflow-trends.test.sh tests/ci/playwright-timing-reporter.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-codeql-languages.test.sh`
  - `bash tests/ci/classify-quality-scope.test.sh`
  - `bash tests/ci/browser-e2e-groups.test.sh`
  - `bash tests/ci/backend-integration-groups.test.sh`
  - `bash tests/ci/playwright-timing-reporter.test.sh`
  - `bash tests/ci/frontend-coverage-scripts.test.sh`
  - `bash tests/ci/report-workflow-trends.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml`
  - `git diff --check`
- Touched-file lizard was not applicable: this phase changed workflow YAML, docs, and task tracking, with no supported source/script file changes.
- Delivered in PR #159; merge-group and post-merge `main` push checks completed successfully.

---

# Active Task: CI/CD Test Speed Phase 4 - E2E Source Lane Scope

Status: complete

Goal: stop E2E-only changes from launching full backend and frontend source-test lanes on merge/main while preserving browser/render E2E confidence and broad runs for workflow or exhaustive validation.

## Plan

- [x] Work in an isolated worktree from `origin/main` after Phase 3 merged.
- [x] Remove `e2e_changed` from full backend and full frontend source-lane job conditions.
- [x] Keep browser-flow and render-regression full E2E lane conditions unchanged.
- [x] Add classifier fixtures proving E2E and Playwright config paths are not backend/frontend source changes.
- [x] Update CI/CD strategy docs with the E2E-only full-lane policy.
- [x] Run classifier tests, workflow lint, diff check, and touched-file lizard if available.
- [x] Deliver through PR, monitor required checks, merge safely, and verify the merge.

## Review

- Full backend and full frontend source-lane jobs no longer start solely because `e2e_changed=true`; they still run for full scans, test workflow changes, and their own source changes.
- Full browser-flow and render-regression E2E conditions are unchanged, so E2E-only merge candidates still run the relevant E2E confidence lanes.
- Added classifier fixtures for render E2E, browser E2E, and `playwright.config.ts` paths proving those paths are E2E scoped and not backend/frontend source scoped.
- Updated CI/CD strategy docs to spell out that E2E-only changes skip backend integration, backend unit coverage, and frontend unit coverage.
- Verification passed:
  - `bash -n scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-codeql-languages.test.sh`
  - `bash tests/ci/classify-quality-scope.test.sh`
  - `bash tests/ci/backend-integration-groups.test.sh`
  - `bash tests/ci/browser-e2e-groups.test.sh`
  - `bash tests/ci/playwright-timing-reporter.test.sh`
  - `bash tests/ci/frontend-coverage-scripts.test.sh`
  - `bash tests/ci/report-workflow-trends.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml`
  - `/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -l shell scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
  - `git diff --check`
- Delivered in PR #158; merge-group and post-merge `main` push checks completed successfully.

---

# Active Task: CI/CD Test Speed Phase 3 - Playwright Timing Artifacts

Status: complete

Goal: make browser-flow and render-regression E2E cost visible at the spec level before changing grouping, retries, browser count, or shared setup.

## Plan

- [x] Work in an isolated worktree from `origin/main` after Phase 2 merged.
- [x] Add a Playwright reporter that writes timing JSON and Markdown into the existing `test-results/` artifact path.
- [x] Add regression coverage for timing aggregation, sorting, status counts, retry metadata, and Markdown output.
- [x] Wire the reporter regression test into the Code Quality CI classifier test job.
- [x] Update CI/CD strategy docs with the per-spec artifact usage.
- [x] Run focused reporter tests, CI classifier tests, workflow lint, diff check, and touched-file lizard if available.
- [x] Deliver through PR, monitor required checks, merge safely, and verify the merge.

## Review

- Added `scripts/ci/playwright-timing-reporter.cjs`, which records Playwright test results by spec and writes `test-results/playwright-timing.json` plus `test-results/playwright-timing.md`.
- Wired the reporter into `playwright.config.ts`; existing Playwright artifact uploads already include `test-results/`, so no extra upload step was needed.
- Added regression coverage for aggregation, status counts, retry metadata, sorting, duration formatting, empty/default records, and Markdown output.
- Wired the reporter regression test into the Code Quality CI classifier test job.
- Updated the CI/CD strategy docs to use Playwright timing artifacts before changing group membership, browser count, retries, or shared setup.
- Verification passed:
  - `bash -n tests/ci/playwright-timing-reporter.test.sh`
  - `bash tests/ci/playwright-timing-reporter.test.sh`
  - `bash -n scripts/ci/classify-test-changes.sh scripts/ci/classify-codeql-languages.sh scripts/ci/classify-quality-scope.sh scripts/ci/browser-e2e-groups.sh scripts/ci/backend-integration-groups.sh scripts/ci/frontend-coverage-shard.sh scripts/ci/frontend-coverage-merge.sh scripts/ci/time-command.sh scripts/ci/report-workflow-durations.sh scripts/ci/report-workflow-trends.sh tests/ci/classify-test-changes.test.sh tests/ci/classify-codeql-languages.test.sh tests/ci/classify-quality-scope.test.sh tests/ci/browser-e2e-groups.test.sh tests/ci/backend-integration-groups.test.sh tests/ci/frontend-coverage-scripts.test.sh tests/ci/report-workflow-trends.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-codeql-languages.test.sh`
  - `bash tests/ci/classify-quality-scope.test.sh`
  - `bash tests/ci/browser-e2e-groups.test.sh`
  - `bash tests/ci/backend-integration-groups.test.sh`
  - `bash tests/ci/frontend-coverage-scripts.test.sh`
  - `bash tests/ci/report-workflow-trends.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/quality.yml`
  - `npx playwright test --list --project=chromium e2e/render-regression.spec.ts`
  - `/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -l javascript scripts/ci/playwright-timing-reporter.cjs tests/ci/playwright-timing-reporter.test.mjs`
  - `git diff --check`
- Delivered in PR #157; merge-group and post-merge `main` push checks completed successfully.

---

# Active Task: CI/CD Test Speed Phase 2 - Backend Integration Impact Scope

Status: complete

Goal: avoid DB-backed backend integration smoke on PRs where the changed backend files are clearly unit-scoped, while preserving the smoke for API, middleware, repository, Prisma, worker/queue, config, package, and integration-test surfaces.

## Plan

- [x] Work in an isolated worktree from `origin/main` after Phase 1 merged.
- [x] Add a `backend_integration_changed` classifier output.
- [x] Use that output for `Quick Backend Integration Smoke` instead of broad `backend_changed`.
- [x] Add classifier fixtures for docs-only, backend unit-scoped helper, backend API route, and Prisma migration behavior.
- [x] Update CI/CD strategy docs with the narrower PR smoke policy.
- [x] Run classifier tests, workflow lint, diff check, and touched-file lizard if available.
- [x] Deliver through PR, monitor required checks, merge safely, and verify the merge.

## Review

- Added `backend_integration_changed` to `scripts/ci/classify-test-changes.sh`.
- `Quick Backend Integration Smoke` now keys off `backend_integration_changed`, so unit-scoped backend helper changes still run backend related tests but skip the extra DB-backed smoke lane.
- Integration-sensitive backend paths still trigger the smoke: package/config, Prisma, integration tests, API routes, middleware, repositories, infrastructure, and worker paths.
- Added classifier fixtures for docs-only, CI-only, backend unit helper, backend API route, and Prisma migration behavior.
- Verification passed:
  - `bash -n scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-codeql-languages.test.sh`
  - `bash tests/ci/classify-quality-scope.test.sh`
  - `bash tests/ci/backend-integration-groups.test.sh`
  - `bash tests/ci/report-workflow-trends.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml`
  - `git diff --check`
- Touched-file lizard did not run: `npx lizard -C 15 -l shell scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh` failed because npm could not determine an executable for `lizard`.
- Delivered in PR #155; merge-group and post-merge `main` push checks completed successfully.

---

# Active Task: CI/CD Test Speed Phase 1 - Timing Baseline Tooling

Status: complete

Goal: start the CI/CD speed implementation with measured workflow trend tooling so later test-skip and sharding decisions are based on p50/p90 evidence instead of single-run intuition.

## Plan

- [x] Work in an isolated worktree from `origin/main` because the primary checkout has unrelated local grade/task edits.
- [x] Add a workflow trend reporter that summarizes successful workflow runs by wall time, runner time, p50/p90, and longest job.
- [x] Add fixture-mode regression coverage for the trend reporter.
- [x] Wire the new script/test into Code Quality CI classifier checks.
- [x] Update CI/CD strategy docs with trend usage and stop-condition guidance.
- [x] Run shell syntax checks, focused CI script tests, actionlint, diff check, and touched-file lizard if available.
- [x] Deliver through PR, monitor required checks, merge safely, and verify the merge.

## Review

- Added `scripts/ci/report-workflow-trends.sh`, which summarizes successful workflow runs by p50/p90 wall time, p50/p90 runner time, and longest job.
- Added fixture-mode regression coverage in `tests/ci/report-workflow-trends.test.sh`.
- Wired the new script/test into the Code Quality CI classifier syntax/regression checks.
- Updated `docs/reference/ci-cd-strategy.md` with trend-helper usage and a stop-condition rule for future CI optimization.
- Verification passed:
  - `bash -n scripts/ci/report-workflow-trends.sh tests/ci/report-workflow-trends.test.sh scripts/ci/report-workflow-durations.sh`
  - `bash tests/ci/report-workflow-trends.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-codeql-languages.test.sh`
  - `bash tests/ci/classify-quality-scope.test.sh`
  - `bash tests/ci/browser-e2e-groups.test.sh`
  - `bash tests/ci/backend-integration-groups.test.sh`
  - `bash tests/ci/frontend-coverage-scripts.test.sh`
  - `bash scripts/ci/report-workflow-trends.sh --workflow test.yml --event merge_group --limit 2`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/quality.yml`
  - `git diff --check`
- Touched-file lizard did not run: `npx lizard -C 15 -l shell scripts/ci/report-workflow-trends.sh tests/ci/report-workflow-trends.test.sh` failed because npm could not determine an executable for `lizard`.
- Delivered in PR #154; merge-group and post-merge `main` push checks completed successfully.

---

# Active Task: Integration Test File Warning Reduction

Status: complete

Goal: reduce active large-file warnings to zero and verify the refactored integration specs with the repository's disposable database harness.

## Plan

- [x] Verify post-merge state and identify the next actionable non-risky debt target.
- [x] Inspect integration test organization and choose the existing harness/contracts split pattern.
- [x] Extract transaction fixture helpers into a transaction integration harness.
- [x] Move authentication 2FA contracts into a focused auth contract module.
- [x] Run focused integration tests or confirm skip behavior, large-file classification, lizard, and diff checks.
- [x] Tighten the large-file reporter so classified proof/generated files stay enforced by metadata without remaining active warnings.
- [x] Move disposable integration-test DB defaults into a sourced constants file so the plain runner uses the non-conflicting port.
- [x] Run the focused auth and transaction integration specs through the DB-backed harness.
- [x] Re-run full quality verification and update task review.

## Review

- Extracted transaction integration fixture setup into `transactions/transactionsIntegrationTestHarness.ts`; `transactions.integration.test.ts` dropped from 801 to 684 lines.
- Moved authentication 2FA contracts into `auth/twoFactor.contracts.ts`; `auth.integration.test.ts` dropped from 841 to 710 lines.
- Large-file classification enforcement now reports only unclassified warning files; classified proof/generated fixtures remain validated by required metadata.
- Added `scripts/integration-test-defaults.sh` and wired `scripts/run-integration-tests.sh` to source it; the default disposable PostgreSQL host port is now `55433`, and `server/package.json` delegates `test:integration:db` to the same harness.
- Re-ran the focused integration specs against the disposable PostgreSQL harness instead of the no-DB skip path: 74 tests passed across the two files through both `./scripts/run-integration-tests.sh ...` and `npm --prefix server run test:integration:db -- ...`.
- Verification passed: shell syntax checks for the integration defaults/runner, `npm --prefix server run typecheck:tests`, `git diff --check`, `node scripts/quality/check-large-files.mjs`, and full `npm run quality`.

---

# Active Task: Grade Technical Debt Remediation

Status: complete

Goal: fix the grade blockers instead of only documenting them: stop upgrade artifact logs from tripping gitleaks, remove the current ignored-artifact findings, and restore the large-file quality gate for notification job tests.

## Remediation Plan

- [x] Re-read the grade report, current worktree state, upgrade artifact collector, and oversized notification worker test.
- [x] Add durable redaction for collected upgrade logs and cover it with install-helper tests.
- [x] Redact the current ignored `.tmp/upgrade-artifacts/.../worker.log` findings without relying on destructive cleanup.
- [x] Split `server/tests/unit/worker/jobs/notificationJobs.test.ts` into smaller focused test modules with shared setup.
- [x] Run focused notification tests, install-helper tests, gitleaks scans, large-file check, lizard, and `git diff --check`.
- [x] Update the quality report and task review with the new score/blocker status.

## Review

- Fixed the upgrade artifact redactor so secret-like assignment keys, JSON keys, headers, and queue/job-id fields are redacted case-insensitively.
- Redacted the existing ignored `.tmp/upgrade-artifacts/test-20260424-084047-2958226/logs/worker.log` artifact in place rather than deleting it.
- Split the 1,108-line notification worker test into focused files; the largest split file is 336 lines and the shared setup uses runtime mocks before dynamic job imports.
- Verification passed: focused notification tests (51), server test typecheck, upgrade helper unit tests (7), full working-tree/latest-commit/tracked-tree gitleaks scans, large-file classification, focused lizard, and `git diff --check`.
- Updated `docs/plans/codebase-health-assessment.md` to `97/100` (`A`) with no hard-fail blockers and appended a post-remediation grade-history entry.

---

# Active Task: Full Codebase Grade Audit

Status: complete

Goal: run the `$grade` full-repository software quality audit at the current working tree, write `docs/plans/codebase-health-assessment.md`, append grade trend history, and summarize the evidence-backed score.

## Audit Plan

- [x] Confirm repository root, clean/dirty status, current commit, local date, grade skill instructions, standards rubric, and relevant repo lessons.
- [x] Run project-wide mechanical signal collection with the bundled `grade.sh`.
- [x] Read trend baseline for the full-mode grade history.
- [x] Inspect targeted source, test, and operational files for judged ISO/IEC 25010 criteria.
- [x] Apply mechanical thresholds and judged scoring, including hard-fail gates and confidence level.
- [x] Append a v1 JSON trend entry through `trend.sh`.
- [x] Write `docs/plans/codebase-health-assessment.md` with evidence, risks, improvements, roadmap, and verification notes.
- [x] Review generated artifacts for accuracy, edge cases, and unintended changes.

## Review

- Wrote `docs/plans/codebase-health-assessment.md` for full-mode `$grade` at commit `9f8247aa`.
- Overall score is `69/100` (`D`, high confidence), with raw domain score `93/100` capped by the hard-fail secret gate.
- Hard-fail blocker: pinned gitleaks full working-tree scan found 8 `generic-api-key` findings in ignored `.tmp/upgrade-artifacts/test-20260424-084047-2958226/logs/worker.log`; tracked-tree and latest-commit gitleaks scans found no leaks.
- Native verification passed: tests, lint, typecheck, app/backend/gateway coverage, root/server/gateway/ai-proxy high-severity audits, architecture boundaries, browser auth contract, OpenAPI route coverage, lizard, and jscpd.
- Quality context: `node scripts/quality/check-large-files.mjs` failed because `server/tests/unit/worker/jobs/notificationJobs.test.ts` is now an unclassified 1,108-line test file.
- Appended the full-mode trend entry under `docs/plans/grade-history/sanctuary_.jsonl`.

---

# Active Task: Telegram Received Transaction Notification Deep Dive

Status: complete

Goal: fix the remote-install class of bugs where one Telegram notification type works while wallet received-transaction Telegram notifications do not. The release-quality fix should make notification delivery architecture consistent: separate event producers are acceptable, but delivery must go through one queue-backed pipeline with shared channel registration, retry, telemetry, DLQ, and support-bundle diagnostics.

## Current Findings

- Root cause found: `server/src/worker/jobs/notificationJobs.ts` imported the raw notification registry singleton from `services/notifications/channels/registry`, while handler registration happens in the `services/notifications/channels` barrel. Worker transaction notification jobs could therefore run with zero registered channels.
- Why low-fee Telegram consolidation opportunity notifications could still work before this refactor: Treasury Autopilot imported the registered channel barrel and dispatched low-fee consolidation suggestions inline via `notifyConsolidationSuggestion`. That proved Telegram credentials and the old low-fee path worked, but it did not prove the worker transaction-notification path worked.
- Why the old split was risky: transaction notifications were queue-backed and retry-sensitive; low-fee consolidation suggestions were direct/inline. The producers differ for good reason, but delivery observability and channel registration should not differ.
- Additional bug class found: notification jobs returning `{ success: false }` do not make BullMQ retry or DLQ the job. BullMQ retries only when the handler throws, so zero-delivery failures must throw after metrics/logging.
- Worktree note: partial hardening edits exist from the initial root-cause fix and should be folded into the architecture refactor rather than treated as the final patch.

## Architecture Decision

- The right design is one delivery pipeline with multiple producers:
  - Blockchain sync produces transaction notification jobs.
  - Confirmation processing produces confirmation notification jobs.
  - Draft creation produces draft notification jobs.
  - Treasury Autopilot produces low-fee consolidation suggestion notification jobs.
- All notification delivery jobs use the registered notification channel barrel, common queue dispatch semantics, common retry/DLQ behavior, common Prometheus result metrics, and common support-bundle diagnostics.
- Inline delivery remains only a fallback for producer-side queue unavailability, not as the normal path for any notification type.
- This is a release-quality architecture refactor, so implementation should avoid broad unrelated cleanup and keep tests focused on delivery behavior.

## Proposed Implementation Plan

### Phase 1 - Baseline And Refactor Shape

- [x] Re-read current notification producer call sites and worker job registration to confirm the unified job data model.
- [x] Decide whether consolidation suggestion job payload should carry the full suggestion snapshot or rehydrate by wallet ID. Prefer full snapshot because it preserves the evaluation decision and avoids a second UTXO/fee read in the worker.
- [x] Confirm queue fallback behavior for low-fee suggestions: if the notification queue is unavailable, call the same delivery helper inline and record fallback telemetry/logs.

### Phase 2 - Shared Dispatcher And Worker Job

- [x] Add `queueConsolidationSuggestionNotification` to `server/src/infrastructure/notificationDispatcher.ts`.
- [x] Add a `consolidation-suggestion-notify` worker job to `server/src/worker/jobs/notificationJobs.ts`.
- [x] Extend worker job types for consolidation suggestion payloads without leaking BigInt serialization problems across BullMQ.
- [x] Reuse a shared notification result summarizer that treats zero registered channels as failure and all-channel failures as thrown errors so BullMQ retries and DLQs.
- [x] Keep legitimate no-recipient outcomes successful but visible with metrics, because no enabled recipients is a configuration state, not a transport failure.

### Phase 3 - Move Autopilot Onto Shared Delivery

- [x] Replace inline channel iteration in `server/src/services/autopilot/evaluator.ts` with dispatcher usage.
- [x] Preserve per-wallet Autopilot channel preferences (`notifyTelegram`, `notifyPush`) in the queued payload or equivalent delivery context.
- [x] Keep wallet log behavior for the Autopilot decision, but separate it from delivery success so a queued notification does not falsely imply delivery.
- [x] Keep cooldown semantics intentional: set cooldown after the suggestion is queued or inline fallback is accepted, not after Telegram confirms delivery, unless we choose a larger behavioral change.

### Phase 4 - Observability And Support Bundle

- [x] Add/keep `sanctuary_notification_job_results_total{job_name,result}` with low-cardinality labels only.
- [x] Add support-bundle worker-health diagnostics and transaction/consolidation notification DLQ counts under the Telegram/support diagnostics.
- [x] Ensure dead-letter support-bundle payload anonymization handles nested BullMQ job payloads such as `payload.data.walletId`.
- [x] Make support bundle expose that transaction jobs and low-fee consolidation suggestion jobs now share the same worker delivery system.

### Phase 5 - Tests And Edge Cases

- [x] Add worker job tests for transaction, draft, confirmation, and low-fee consolidation suggestion delivery.
- [x] Add dispatcher tests for queueing low-fee consolidation suggestions and fallback behavior when Redis/queue is unavailable.
- [x] Add Autopilot evaluator tests proving it queues low-fee suggestions instead of directly calling channels.
- [x] Add channel handler tests proving Telegram transaction delivery returns actual delivery counts/errors rather than unconditional success.
- [x] Add support-bundle tests for notification DLQ detection, worker health, and nested ID redaction.
- [x] Cover edge cases: no registered channels, no recipients, channel disabled, per-wallet flag disabled, Telegram send failure, queue unavailable, duplicate job IDs/cooldown, BigInt serialization, missing wallet/transaction/draft records, and partial channel success.

### Phase 6 - Verification

- [x] Run focused Vitest suites for worker notification jobs, notification dispatcher, Autopilot evaluator, Telegram channel handlers/service, and support-package collectors.
- [x] Run `npm --prefix server run typecheck:tests`.
- [x] Run touched-file lizard checks with `CCN <= 15`.
- [x] Run `git diff --check`.
- [x] Self-review diff for architectural consistency, edge cases, and accidental behavior changes before final response.

## Open Decisions Before Coding

- Cooldown timing: queue acceptance versus confirmed channel delivery. Recommendation: queue acceptance, because the worker owns retries and DLQ; otherwise Autopilot would repeatedly enqueue the same suggestion while delivery is retrying.
- Fallback behavior: keep inline fallback only when queue creation/add fails. Recommendation: yes, to preserve notifications on Redis-unavailable single-process deployments.
- Scope of unification: include low-fee consolidation suggestions now; leave AI insights and other specialized notifications for later unless they already touch this path. Recommendation: include only low-fee consolidation suggestions because that is the user-observed split.

## Review

- Root cause fixed: worker notification jobs now import the registered channel barrel instead of the raw registry singleton, so Telegram/Push handlers are available in worker delivery.
- Architecture fixed for the user-observed split: low-fee Treasury Autopilot consolidation opportunity notifications now enqueue `consolidation-suggestion-notify` jobs through the same `notifications` worker queue used by transaction/draft/confirmation notifications. Inline delivery remains only as queue-add fallback.
- Worker failure semantics fixed: zero registered channels and all-channel zero-delivery failures now throw so BullMQ retries and exhausted jobs reach the notification DLQ. Legitimate no-recipient/skipped states stay successful but are counted.
- Telegram transaction and consolidation handlers now report actual delivery counts/errors instead of unconditional success.
- Support bundle now includes worker health, notification DLQ counts for transaction and low-fee consolidation suggestion jobs, and nested BullMQ job payload ID anonymization.
- Support bundle now exposes the notification delivery topology: both `transaction-notify` and `consolidation-suggestion-notify` use the shared `notifications` worker queue, with inline consolidation fallback only for queue-add failure.
- Telemetry added: `sanctuary_notification_job_results_total{job_name,result}` with low-cardinality result labels.
- No tests were pruned. Existing tests that assumed direct/inline low-fee delivery were updated to assert queue-first delivery plus queue-failure inline fallback; additional edge-case tests were added to preserve 100% backend coverage.
- Validation passed:
  - `npm run test:coverage` (404 files, 5,620 tests, 100% statements/branches/functions/lines)
  - `npm run test:backend:coverage` (393 files, 9,239 tests, 100% statements/branches/functions/lines)
  - `npx vitest run tests/unit/worker/jobs/notificationJobs.test.ts tests/unit/infrastructure/notificationDispatcher.test.ts tests/unit/services/autopilot/evaluator.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/telegram/telegramService.test.ts tests/unit/services/supportPackage/telegramCollector.test.ts tests/unit/services/supportPackage/dlqCollector.test.ts tests/unit/services/supportPackage/workerHealthCollector.test.ts tests/unit/observability/metrics.test.ts tests/unit/services/bitcoin/sync/phases/processTransactions/notifications.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/aiInsights.test.ts`
  - `npm --prefix server run typecheck:tests`
  - `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w -l typescript ...touched production files...`
  - `git diff --check`

---

# Actionable Backlog: Valid Follow-Up Work

Status: ready

Goal: convert the still-valid follow-up material from completed reviews into scoped tasks that can each become a focused worktree/PR. This backlog intentionally excludes stale CodeQL, lizard, stash, and agent-wallet items that later work already resolved.

## Selection Rules

- Start a backlog item only from current `origin/main` in an isolated worktree.
- Re-measure before optimizing; do not shard or cache a CI lane unless current timing still shows it on the critical path.
- Keep release tags, schedules, manual release gates, and merge-queue safety stronger than PR quick lanes.
- Do not replay old stash changes unless the current code still needs the behavior and focused tests reproduce the gap.

## Ready Tasks

### CI-1: Browser-Flow E2E Setup Reuse Measurement

- [ ] Measure repeated setup/build/startup cost inside the browser-flow E2E groups: frontend dependency setup, Playwright setup, frontend build, backend setup, backend build, and server startup.
- [ ] Compare shared build artifacts or a prebuilt test image only after timing shows duplicated setup dominates artifact upload/download or image build cost.
- [ ] Preserve the existing browser group coverage, render-regression lane, path classifier behavior, and merge-queue aggregate checks.
- [ ] Document the measured decision in CI strategy docs: keep current shape, reuse build artifacts, or propose a prebuilt test image.

### CI-2: Backend Integration Per-Spec Timing

- [ ] Add lightweight timing extraction for backend integration groups or individual Vitest integration specs.
- [ ] Use the timing data before further splitting `integration-flows`, because blind splitting duplicates Postgres setup and migrations.
- [ ] Keep the `full-backend-tests` aggregate result and backend coverage artifact behavior stable.
- [ ] Document whether another backend integration split is justified, deferred, or lower value than the current CI tail.

### CI-3: Release/Install Lane Timing And Fixture Scoping

- [ ] Measure fresh install, install script E2E, install stack smoke, and upgrade fixture lanes from release/install workflows rather than merge-group Test Suite data.
- [ ] Look for safer fixture scoping inside each install lane while keeping release tags, schedules, manual release-critical runs, and release candidates full.
- [ ] Avoid shared-stack coupling unless it preserves the current isolation between release-critical install proofs.
- [ ] Document the timing evidence and chosen next release-gate optimization, including a no-change decision if isolation costs less than coupling risk.

### TEST-1: Full Server Test Typecheck Debt

- [ ] Reduce `npm --prefix server run typecheck:tests:full` failures in small batches while keeping required `npm --prefix server run typecheck:tests` green.
- [ ] Start by grouping the current failure classes: integration runtime-config signatures, Express router harness types, mobile permission fixtures, OpenAPI schema access, Prisma/DTO fixture drift, Vitest mock call typing, and worker/electrum fixtures.
- [ ] Move fixed files into the required `server/tsconfig.test.json` gate only after each group is stable.
- [ ] Exit with either a green full tracker or a smaller documented baseline that is narrow enough for the next batch.

### TEST-2: Verify-Addresses TypeScript Validation

- [ ] Add an explicit `typecheck` script for `scripts/verify-addresses` and run it under the current Node 24 toolchain.
- [ ] Resolve missing declarations or tsconfig gaps without hiding runtime verification behavior.
- [ ] Add the check to local documentation first; promote it to CI only after it is green and reproducible in a clean install.
- [ ] Keep the existing vector generation and verification behavior unchanged.

### AGENT-1: Agent Funding Draft Transactional Consistency

- [ ] Review the current per-agent PostgreSQL advisory lock around policy evaluation and draft creation.
- [ ] Decide whether draft creation, accepted-attempt recording, cadence updates, and override consumption can share one transaction client without breaking existing repository boundaries.
- [ ] Add regression coverage for a failure after draft creation so the API cannot report a failed request while leaving ambiguous policy/cadence state.
- [ ] Preserve the security boundary: Sanctuary coordinates and audits, but does not sign, broadcast, or custody agent operational keys.

## Conditional Watch Items

- Frontend coverage: keep two shards unless coverage becomes the merge-gate tail again.
- Backend unit coverage: do not shard until browser-flow setup reuse or other CI work makes backend unit coverage the clear tail.
- Playwright locator/mock changes from the old stash: wait for a reproduced flake.
- Ledger dependency removal and Vite/polyfill replacement from the old stash: wait until current imports and polyfill wrapper no longer need those paths.
- Mobile/deep-link client tests: wait until a mobile client package or repository exists; current server review-contract coverage remains the active proof.

---

# Completed Task: Browser E2E Wallet Flow Split

Status: complete

Goal: reduce the current Test Suite tail by splitting the longest full browser-flow E2E group while avoiding a shared build-artifact dependency that would likely increase wall time.

## Worktree Constraint

- This batch runs in `/tmp/sanctuary-browser-e2e-reuse` on `ci/browser-e2e-setup-reuse` so the dirty primary checkout at `/home/nekoguntai/sanctuary` remains untouched.
- The primary checkout has unrelated local `tasks/todo.md` state. Do not stash, reset, pull over, or rewrite it from this batch.

## Current Evidence

- PR #146 merge-group Test Suite made browser-flow E2E the remaining tail: wallet-flows 3m19s, wallet-experience 2m55s, and admin-auth 2m51s.
- Browser-flow setup in the wallet-flows job took about 2 minutes before specs started: containers 20s, root dependency/cache/browser setup about 49s, backend setup/build/start about 42s, and frontend build about 4s.
- A shared build-artifact job would save only the repeated build portions while adding a serial dependency before every browser group, so it is not the first change to make.
- The wallet-flows specs took about 1m15s for 56 tests. Splitting that group should reduce the browser-flow tail without changing browser coverage.

## Implementation Checklist

### Phase 1 - Deterministic Group Split

- [x] Split the existing `wallet-flows` group into two stable browser-flow groups.
- [x] Keep all top-level non-render browser specs assigned exactly once.
- [x] Keep `render-regression.spec.ts` excluded from browser-flow groups.

### Phase 2 - Workflow And Docs

- [x] Add the new browser-flow group to the full browser E2E matrix.
- [x] Update docs to explain why this change splits the long group instead of adding shared build artifacts.
- [x] Keep existing branch-protection aggregate behavior unchanged.

### Phase 3 - Validation

- [x] Run shell syntax checks and browser group coverage regression tests.
- [x] Run actionlint on the touched workflow and `git diff --check`.
- [x] Run focused lizard on the edited shell group script/test if available.

### Delivery

- [x] Commit, push, open PR, monitor checks, fix failures, and merge successfully.
- [x] Verify merge, record durations, clean up the PR branch/worktree safely, and leave the primary dirty checkout untouched.

## Review

- Split the previous `wallet-flows` browser-flow group into `wallet-lifecycle` and `wallet-transactions`, preserving all non-render top-level E2E specs exactly once.
- Added `scripts/ci/browser-e2e-groups.sh` to the test-suite classifier policy so future browser group changes trigger the broader test-suite path policy even without workflow edits.
- Local validation passed:
  - `bash -n scripts/ci/browser-e2e-groups.sh tests/ci/browser-e2e-groups.test.sh scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
  - `bash scripts/ci/browser-e2e-groups.sh --check`
  - `bash tests/ci/browser-e2e-groups.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml`
  - `git diff --check`
  - `PYTHONPATH=/tmp/sanctuary-lizard-local python3 -m lizard -C 15 -l shell scripts/ci/browser-e2e-groups.sh tests/ci/browser-e2e-groups.test.sh scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
- Full browser-flow execution was left to merge-queue CI because this change is CI grouping/policy and the merge-group lane is the authoritative proof for the new matrix shape.
- PR #148 merged through merge queue at 2026-04-25 05:02:30 UTC as squash commit `d2d30fa2`; the merge-group Test Suite run `24923080304` passed.
- The primary checkout at `/home/nekoguntai/sanctuary` was left untouched during implementation because it had unrelated local task-tracker state.

## Post-Merge Measurement

- PR #148 merge-group Test Suite passed. Longest jobs were Browser E2E wallet-experience 2m57s, Frontend Coverage shard 2/2 2m56s, Browser E2E admin-auth 2m50s, Browser E2E wallet-lifecycle 2m46s, Browser E2E wallet-transactions 2m44s, Full Render E2E 2m42s, and Frontend Coverage shard 1/2 2m41s.
- The old wallet-flows browser group from PR #146 was 3m19s. After the split, its replacement groups ran at 2m46s and 2m44s, so the wallet-flow tail dropped by about 33 seconds.
- Browser E2E is now balanced enough that wallet-experience is only one second slower than frontend coverage shard 2/2. More browser splitting would mostly duplicate setup unless per-spec timing shows a new outlier.

## Additional Optimization Analysis

- Highest next test target: frontend coverage and browser E2E are now tied as the merge-gate tail at roughly 2m56s-2m57s. Do not add another frontend shard yet without measuring merge/upload overhead, because the current coverage merge still costs about 35 seconds.
- Browser follow-up: add per-spec Playwright timing capture before more group changes. A fifth browser group would spend another full setup stack, so the next browser optimization should target setup reuse only if step timings show artifact reuse or a prebuilt test image beats the added dependency/download cost.
- Backend follow-up: backend unit coverage is now a secondary tail at 2m22s. If the frontend/browser tail drops below about 2m30s, evaluate backend unit coverage sharding with one threshold-enforcing merge artifact.
- Cross-lane follow-up: the merge-group Test Suite completed in 3m55s, so current Test Suite wall time is below the 15m target. Further work should use p50/p90 trends rather than single-run tuning.

---

# Completed Task: Backend Integration Group Split

Status: complete

Goal: reduce the current Test Suite long pole by splitting full backend integration tests into deterministic parallel groups while preserving the existing `full-backend-tests` aggregate gate and backend coverage artifact behavior.

## Worktree Constraint

- This batch runs in `/tmp/sanctuary-backend-integration` on `ci/backend-integration-groups` so the dirty primary worktree at `/home/nekoguntai/sanctuary` remains untouched.
- The primary worktree has unrelated local `tasks/todo.md` state and an unrelated active `/tmp/sanctuary-stash-followup` worktree. Do not stash, reset, pull over, or rewrite either from this batch.

## Current Evidence

- PR #143 merge-group Test Suite made `Full Backend Tests (integration)` the longest Test Suite job at 3m23s.
- The timed integration command inside that job took 2m12s; setup, migrations, and teardown accounted for the remainder.
- Frontend coverage is now balanced enough after sharding at 2m56s and 2m59s, so backend integration is the next useful Test Suite target.

## Implementation Checklist

### Phase 1 - Deterministic Integration Groups

- [x] Add a backend integration grouping script with stable group names and server-relative spec paths.
- [x] Add a group coverage check that fails on duplicate, missing, or unknown integration spec assignments.
- [x] Add a focused shell regression test for the grouping script.

### Phase 2 - Workflow Split

- [x] Replace the single backend `integration` matrix target with parallel integration group targets.
- [x] Keep `full-backend-tests` as the aggregate result consumed by `Full Test Summary`.
- [x] Keep backend unit coverage artifact upload unchanged and unique to the unit coverage target.

### Phase 3 - Documentation And Validation

- [x] Update Code Quality CI classifier syntax checks for the new grouping script/test.
- [x] Document the backend integration group split and runner-minute tradeoff in CI strategy docs.
- [x] Run local validation: shell syntax, grouping regression tests, actionlint on touched workflows, `git diff --check`, and focused lizard on new shell scripts.

### Delivery

- [x] Commit, push, open PR, monitor checks, fix failures, and merge successfully using `pr-delivery`.
- [x] Verify merge, record durations, clean up the PR branch/worktree safely, and leave the primary dirty worktree untouched.

## Review

- Local validation passed:
  - `bash -n scripts/ci/backend-integration-groups.sh tests/ci/backend-integration-groups.test.sh scripts/ci/classify-test-changes.sh tests/ci/classify-test-changes.test.sh`
  - `bash scripts/ci/backend-integration-groups.sh --check`
  - `bash tests/ci/backend-integration-groups.test.sh`
  - `bash tests/ci/classify-test-changes.test.sh`
  - `bash tests/ci/classify-codeql-languages.test.sh`
  - `bash tests/ci/classify-quality-scope.test.sh`
  - `bash tests/ci/browser-e2e-groups.test.sh`
  - `bash tests/ci/frontend-coverage-scripts.test.sh`
  - `/tmp/actionlint-1.7.12/actionlint -color -shellcheck= .github/workflows/test.yml .github/workflows/quality.yml`
  - `git diff --check`
  - `PYTHONPATH=/tmp/sanctuary-lizard-local python3 -m lizard -C 15 -l shell scripts/ci/backend-integration-groups.sh tests/ci/backend-integration-groups.test.sh`
- Full backend integration execution was intentionally left to merge-queue CI because this worktree did not have local Node dependencies installed and the change was the CI partitioning layer rather than backend test behavior.
- PR #146 merged through merge queue at 2026-04-25 04:33:05 UTC as squash commit `a23462b5`; the merge-group Test Suite run `24922575192` passed.
- The primary checkout at `/home/nekoguntai/sanctuary` was left untouched because it still has unrelated local task-tracker state.

## Post-Merge Measurement

- PR #146 merge-group Test Suite passed. Longest jobs were Browser E2E wallet-flows 3m19s, Browser E2E wallet-experience 2m55s, Full Render E2E 2m55s, Frontend Coverage shard 1/2 2m53s, Browser E2E admin-auth 2m51s, Frontend Coverage shard 2/2 2m49s, Backend integration-flows 2m31s, and Backend unit coverage 2m27s.
- The old single backend integration job from PR #143 was 3m23s. After the split, the longest backend integration group was 2m31s, and the other groups were repositories-core 1m10s, repositories-sharing 1m03s, and ops-workers 55s.
- Backend integration is no longer the Test Suite long pole. The backend tail is now close between integration-flows at 2m31s and unit coverage at 2m27s, so further backend splitting should wait for per-spec timing.

## Additional Optimization Analysis

- Highest next test target: browser-flow E2E setup reuse. The three browser-flow groups now dominate the merge gate at 2m51s-3m19s, and each group repeats frontend dependency setup, Playwright setup, frontend build, backend setup, backend build, and server startup. Measure step-level time first, then consider a shared build artifact or prebuilt test image only if duplicated build/setup time is larger than artifact upload/download overhead.
- Backend follow-up: add lightweight timing extraction for integration groups or per-spec Vitest durations before splitting `integration-flows`. A blind split would duplicate Postgres setup and migrations again, and the current backend tail is only four seconds slower than unit coverage.
- Frontend coverage follow-up: keep two shards for now. The shards are balanced at 2m49s and 2m53s, while the merge job costs 38s, so adding a third shard is lower ROI unless coverage becomes the gate tail again.
- Unit coverage follow-up: backend unit coverage is now a near-tail job at 2m27s. If browser setup improves, evaluate whether Vitest unit coverage can be sharded with one threshold-enforcing merge artifact similar to frontend coverage.
- Release/install lanes: do not tune them from this merge-group data. They are release-scoped and should be optimized from release workflow durations, especially repeated compose/image setup.

---

# Completed Task: Stash-Derived Settings Accessibility Follow-Up

Status: complete

Goal: continue the post-release stash follow-up from current `origin/main`, carrying forward only still-valid small fixes while leaving the dirty primary checkout untouched.

## Worktree Constraint

- This batch runs in `/tmp/sanctuary-stash-followup` on `fix/stash-wip-followup`.
- The primary checkout at `/home/nekoguntai/sanctuary` has an unrelated local `tasks/todo.md` triage note. Do not stash, reset, pull over, or rewrite it from this batch.

## Revalidation Notes

- Already handled on current `origin/main`: AI Settings unused-prop cleanup, query factory generic cleanup, node globals import, EmptyState unused imports, and the privacy/address hardening from PR #142.
- Still unsafe to replay: Ledger `@ledgerhq/hw-app-btc` removal and Vite/polyfill dependency replacement. Current code still imports the Ledger fallback path and uses the local `vite.nodePolyfills.ts` wrapper.
- Not currently justified: Playwright locator/mock changes. Recent merge-group and post-merge full browser/render lanes passed, so those changes should wait for a reproduced flake.
- Still valid and small: Settings tab buttons render as icon-only controls on small screens, so they should carry explicit accessible labels.

## Checklist

- [x] Create isolated worktree from current `origin/main`.
- [x] Re-read the remaining stash slices against current files.
- [x] Add explicit labels to Settings tab buttons.
- [x] Add focused regression coverage for the tab labels.
- [x] Run focused tests, typechecks, diff check, and touched-file lizard if available.
- [x] Review the diff for scope and unintended stash replay.

## Review

- Added explicit `aria-label` values and `type="button"` to the Settings tab controls so their names remain stable when text is visually hidden on small screens.
- Added focused regression coverage in `tests/components/Settings.test.tsx` for the four Settings tab button labels.
- Verification passed:
  - `npx vitest run tests/components/Settings.test.tsx` passed with 1 file / 8 tests.
  - `npm run typecheck:app` passed.
  - `npm run typecheck:tests` passed.
  - `git diff --check` passed.
- `npx lizard components/Settings/Settings.tsx tests/components/Settings.test.tsx` could not run because npm could not determine an executable for `lizard` in this environment.
- No Ledger, Vite/polyfill, Playwright, privacy, address, or unrelated stash changes were applied.

---

# Completed Task: Frontend Coverage Sharding

Status: complete

Goal: reduce the current Test Suite long pole by splitting root Vitest frontend coverage into parallel shard jobs, then merge the coverage blobs once so the existing 100% coverage gate and `frontend-coverage` artifact remain intact.

## Worktree Constraint

- This batch runs in `/tmp/sanctuary-frontend-coverage` on `ci/frontend-coverage-sharding` so the dirty primary worktree at `/home/nekoguntai/sanctuary` remains untouched.
- The primary worktree has unrelated local task-tracker state. Do not stash, reset, pull over, or rewrite it from this batch.

## Current Evidence

- PR #140 merge-group Test Suite made root frontend coverage the long pole at 5m20s.
- Frontend app and test typechecks are already split and short at about 49s and 46s.
- Vitest 4.1.x supports `--shard`, blob reporting, and `--mergeReports`, so we can parallelize test execution while enforcing thresholds once at merge time.

## Implementation Checklist

### Phase 1 - Shard Runner

- [x] Add a frontend coverage shard Vitest config that emits blob reports without enforcing partial-shard thresholds.
- [x] Add a small CI wrapper for validated `index/total` shard execution.
- [x] Add script-level tests for invalid shard arguments and empty merge inputs.

### Phase 2 - Merge Gate

- [x] Add a merge wrapper that consumes shard blob reports, generates the normal `coverage/` output, and enforces existing coverage thresholds once.
- [x] Keep the final artifact named `frontend-coverage` so `Full Test Summary` remains compatible.
- [x] Preserve the existing full frontend aggregate job id as the required check surface.

### Phase 3 - Workflow And Docs

- [x] Split full frontend typechecks and frontend coverage shards into separate jobs with an aggregate `full-frontend-tests` result.
- [x] Update Code Quality CI classifier syntax checks for the new scripts/tests.
- [x] Document the sharded coverage shape and runner-minute tradeoff.

### Delivery

- [x] Run local validation: shell syntax, new script tests, actionlint on touched workflows, focused lizard on new shell scripts, and `git diff --check`.
- [x] Run a local shard/merge proof for frontend coverage if dependency setup succeeds in the worktree.
- [x] Commit, push, open PR, monitor checks, fix failures, and merge successfully.
- [x] Verify merge, record durations, clean up the PR branch/worktree safely, and leave the primary dirty worktree untouched.

## Review

- Quality review: kept the final `full-frontend-tests` aggregate job and `frontend-coverage` artifact stable while moving coverage execution behind two blob-producing shard jobs plus one threshold-enforcing merge job.
- Edge case audit: shard wrappers reject missing, zero, non-numeric, and out-of-range shard inputs; the merge wrapper fails clearly for missing or empty blob directories; hidden `.vitest-reports/` artifacts are explicitly uploadable; local shard runs keep other shard blobs intact for sequential proof runs.
- Local validation passed: shell syntax checks, frontend coverage script tests, all CI classifier tests, actionlint on touched workflows, `git diff --check`, focused lizard on new shell scripts, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run test:coverage:shard -- 1 2`, `npm run test:coverage:shard -- 2 2`, and `npm run test:coverage:merge -- .vitest-reports`.
- PR #143 merged through merge queue at 2026-04-25 03:24:25 UTC as squash commit `90bf454f`; the temporary worktree and local branch were removed after merge verification.
- The primary checkout at `/home/nekoguntai/sanctuary` was not fast-forwarded because it still has a pre-existing local `tasks/todo.md` edit; `origin/main` is current and the primary tree was left untouched.

## Post-Merge Measurement

- PR #143 merge-group Test Suite completed successfully. Longest jobs were Full Backend integration 3m23s, Browser E2E wallet-experience 3m05s, Browser E2E wallet-flows 3m03s, Frontend Coverage shard 2/2 2m59s, Frontend Coverage shard 1/2 2m56s, Browser E2E admin-auth 2m44s, Full Render E2E 2m42s, and Backend unit coverage 2m20s.
- The frontend coverage critical path improved from the prior single 5m20s job on PR #140 to about 3m49s: max shard 2m59s, coverage merge job 44s, and the aggregate/summary steps after that.
- Coverage merge itself took only 3s inside the merge job; the rest of the 44s merge job was checkout/setup, artifact download, and final `frontend-coverage` upload.
- The `frontend-coverage` artifact was downloaded by `Full Test Summary`, and the merged coverage summary stayed at 100% statements, branches, functions, and lines.

## Additional Optimization Analysis

- Highest next test target: backend integration. The job is now the longest Test Suite job at 3m23s, with the timed integration command taking 2m12s. Add per-file timing or split integration specs into deterministic groups before sharding blindly, because each shard would duplicate Postgres setup and migrations.
- Next frontend target: keep the two coverage shards for now. They are well balanced at 2m56s and 2m59s, and the remaining 44s merge/upload overhead means a third shard would save less than the raw test split suggests while spending another runner setup.
- Browser target: the three browser-flow groups are still balanced around 2m44s-3m05s. Further splitting is lower value than measuring repeated build/backend startup overhead across browser jobs.
- Cross-lane target: CodeQL JavaScript/TypeScript finished at about 4m03s and was the overall merge gate tail, but that is outside the Test Suite. Keep path-aware CodeQL skipping intact, and only tune CodeQL separately if workflow/config-heavy PRs remain common.

---

# Completed Task: Full Lane Typecheck/Coverage Parallelization

Status: complete

Goal: reduce the remaining merge-queue Test Suite wall time after PR #138 by parallelizing independent frontend and backend full-lane substeps while preserving the same aggregate gates and coverage artifacts.

## Worktree Constraint

- This batch runs in `/tmp/sanctuary-ci-timing` on `ci/frontend-backend-test-timing` so the dirty primary worktree at `/home/nekoguntai/sanctuary` remains untouched.
- The primary worktree currently has an unrelated local `tasks/todo.md` edit. Do not stash, reset, or rewrite it from this batch.

## Current Evidence

- PR #138 merge-group Test Suite made `Full Frontend Tests` the longest lane at 5m40s.
- `Full Backend Tests` was next at 3m45s after the browser E2E split lowered browser-flow groups to about 3m.
- Frontend and backend full jobs already have independent command boundaries with `scripts/ci/time-command.sh`; the next low-risk optimization is to run those boundaries in parallel matrix legs before deeper Vitest sharding.

## Implementation Checklist

### Phase 1 - Frontend Full-Lane Matrix

- [x] Split the full frontend lane into parallel `app-typecheck`, `test-typecheck`, and `coverage` matrix targets.
- [x] Upload the existing `frontend-coverage` artifact only from the coverage target so `Full Test Summary` remains compatible.
- [x] Keep the same path-aware relevance rules and aggregate `Full Test Summary` behavior.

### Phase 2 - Backend Full-Lane Matrix

- [x] Split the full backend lane into parallel `typecheck`, `unit-coverage`, and `integration` matrix targets.
- [x] Keep database setup and environment semantics unchanged for backend targets.
- [x] Upload the existing `backend-coverage` artifact only from the unit coverage target so summary reporting remains compatible.

### Phase 3 - Documentation And Process Guard

- [x] Document the new full-lane matrix shape and the runner-minute tradeoff in CI strategy docs.
- [x] Update lessons with the worktree isolation rule from this correction.
- [x] Re-read the workflow diff for branch-protection aggregate compatibility and artifact edge cases.

### Delivery

- [x] Run local validation: workflow syntax/actionlint, `git diff --check`, and focused workflow/script checks.
- [x] Commit, push, open PR, monitor checks, and merge through merge queue without deleting the branch early.
- [x] Record post-merge durations and leave the primary dirty worktree untouched.

## Review

- Quality review: kept existing full-lane job IDs (`full-frontend-tests`, `full-backend-tests`) so `Full Test Summary` still consumes the same aggregate `needs.*.result` values; only leaf check names expand by matrix target.
- Edge case audit: `frontend-coverage` and `backend-coverage` artifact names remain unchanged and are uploaded only by the coverage-producing matrix targets, avoiding artifact-name collisions across matrix legs.
- Tradeoff: this reduces merge-queue wall time by running independent commands in parallel, but it intentionally spends more runner minutes because each matrix target performs its own checkout/setup/install.
- Local validation passed: shell syntax for CI scripts/tests, CI classifier regression tests, actionlint on `.github/workflows/test.yml`, and `git diff --check`.
- PR #140 merged through merge queue at 2026-04-25 02:31:59 UTC as `f8b763e5`; the primary worktree remained untouched.

## Post-Merge Measurement

- PR #140 merge-group Test Suite completed successfully. Longest jobs were Full Frontend coverage 5m20s, Browser E2E wallet-experience 3m11s, Browser E2E wallet-flows 2m59s, Browser E2E admin-auth 2m48s, Full Render E2E 2m39s, Backend integration 2m31s, and Backend unit coverage 2m25s.
- Backend wall time improved from the prior combined 3m45s lane on PR #138 to a 2m31s max backend matrix target on PR #140.
- Frontend typecheck work no longer extends the critical path: app typecheck finished in 49s, test typecheck in 46s, and coverage remained the long frontend target at 5m20s.

## Additional Optimization Analysis

- Highest next value: frontend coverage remains the Test Suite long pole at 5m20s. The next batch should measure or shard Vitest coverage itself rather than splitting more wrapper steps.
- Backend is now balanced enough for the current target: integration and unit coverage are close at 2m31s and 2m25s, so more backend sharding should wait for per-file timing evidence.
- Browser groups remain acceptable at 2m48s-3m11s; deeper browser sharding is lower value than frontend coverage unless browser timing regresses.
- The backend typecheck matrix target still pays the shared backend setup cost for simplicity and aggregate compatibility. If runner-minute cost matters more than wall time later, move backend typecheck to a lighter separate job or conditional setup path.

---

# Completed Task: Stash-Derived Privacy And Address Hardening

Status: complete

Goal: recover the still-valid ideas from the old frontend stash in an isolated worktree, while leaving the shared checkout available for the other active agent.

## Scope

- Worktree: `/tmp/sanctuary-stash-hardening`
- Branch: `fix/privacy-address-hardening`
- Base: `origin/main` at `76ec2eee`
- In scope:
  - make address receive/change classification tolerate malformed API records without throwing
  - normalize privacy grades/scores/lists at UI boundaries so bad privacy payloads degrade predictably
  - add focused tests for malformed/empty/boundary values
- Out of scope:
  - applying the old stash wholesale
  - Ledger dependency cleanup
  - Vite/polyfill package changes
  - Playwright locator stabilizers unless a current focused run reproduces a flake

## Checklist

- [x] Create isolated worktree from `origin/main`.
- [x] Re-read current address/privacy files and existing tests in the worktree.
- [x] Add small normalization helpers and use them in privacy UI components.
- [x] Harden address classification against missing/invalid derivation paths.
- [x] Add focused tests for invalid grades, NaN/negative/over-100 scores, missing warning/factor arrays, and missing derivation paths.
- [x] Run focused unit tests, typecheck for touched app/test code, diff check, and touched-file lizard if available.
- [x] Self-review the diff for stale stash assumptions and unintended package/test-runner changes.

## Review

- Added `components/privacyScoreUtils.ts` with shared grade, score, and list normalization.
- Updated privacy UI boundaries in:
  - `components/PrivacyBadge.tsx`
  - `components/PrivacyDetailPanel.tsx`
  - `components/SpendPrivacyCard.tsx`
- Hardened `components/WalletDetail/tabs/AddressesTab/addressModel.ts` so malformed address records without a string `derivationPath` classify as receive instead of throwing.
- Added focused regression coverage in:
  - `tests/components/privacyScoreUtils.test.ts`
  - `tests/components/PrivacyBadge.test.tsx`
  - `tests/components/PrivacyDetailPanel.test.tsx`
  - `tests/components/SpendPrivacyCard.test.tsx`
  - `tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts`
- Verification passed:
  - `npx vitest run tests/components/privacyScoreUtils.test.ts tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts tests/components/PrivacyBadge.test.tsx tests/components/PrivacyDetailPanel.test.tsx tests/components/SpendPrivacyCard.test.tsx` passed with 5 files / 114 tests.
  - `npm run typecheck:app` passed.
  - `npm run typecheck:tests` passed.
  - `git diff --check` passed.
  - `npm run test:coverage` passed with 404 files / 5619 tests and 100% statements, branches, functions, and lines.
- `npx lizard components/privacyScoreUtils.ts components/PrivacyBadge.tsx components/PrivacyDetailPanel.tsx components/SpendPrivacyCard.tsx components/WalletDetail/tabs/AddressesTab/addressModel.ts` could not run because npm could not determine an executable for `lizard` in this environment.
- No package, Ledger, Vite/polyfill, or Playwright changes were made.

---

# Completed Task: Next CI Target Optimization Batch

Status: complete

Goal: reduce remaining CI wall time after PR #135 by parallelizing the longest merge/full lanes and adding measurement hooks before deeper stack or test-suite surgery.

## Current Evidence

- PR #135 merge-group Test Suite still spent 5m29s in `Full Browser E2E Tests`, 4m26s in `Full Backend Tests`, 4m18s in `Full Frontend Tests`, and 2m44s in `Full Render E2E Tests`.
- PR #135 install workflow still spent 7m16s-7m54s in parallel upgrade lanes, 6m28s in `Install Stack Smoke`, 4m26s in `Install Script E2E Test`, and 3m30s in `Fresh Install E2E Test`.
- The quick docs-only PR #137 proved path-aware skipping remains effective, so this batch should preserve classifier behavior and focus on relevant expensive lanes only.

## Implementation Checklist

### Phase 1 - Browser E2E Parallel Groups

- [x] Replace the single full browser-flow E2E job with a small matrix of stable browser spec groups.
- [x] Keep full scans, test workflow edits, and browser-relevant paths requiring every browser group.
- [x] Keep artifact names unique per group and preserve the aggregate `Full Test Summary` gate.
- [x] Add a local grouping check so every top-level browser spec is assigned exactly once and render regression stays excluded.

### Phase 2 - Frontend And Backend Timing Visibility

- [x] Add low-noise timing around frontend typecheck, frontend coverage, backend unit coverage, and backend integration steps.
- [x] Keep the timing helper generic and safe for CI logs without changing test semantics.
- [x] Document how to use the timings to decide whether to shard coverage or integration tests next.

### Phase 3 - Install Stack Reuse Review

- [x] Re-read install E2E harnesses and workflow stack startup behavior before changing stack execution.
- [x] Skip install workflow changes because no low-risk reuse avoids duplicate startup without serializing currently parallel checks.
- [x] Document the blocker and keep release-critical install coverage unchanged.

### Delivery

- [x] Run local validation: shell syntax, browser grouping check, actionlint on touched workflows, `git diff --check`, and focused lizard if touched scripts grow.
- [x] Commit, push, open PR, monitor checks, and merge through merge queue without deleting the branch early.
- [x] Sync `main`, clean stale local branches/worktrees only after merge verification, and record post-merge timings.

## Review

- Quality review: browser E2E is now a three-group matrix under the existing full browser job id, so `Full Test Summary` still aggregates one required result while the group jobs upload unique artifacts.
- Edge case audit: `scripts/ci/browser-e2e-groups.sh --check` fails on duplicate, missing, or unknown top-level browser spec assignments and explicitly keeps `e2e/render-regression.spec.ts` in the render lane.
- Install stack review: Fresh Install, Install Script E2E, and Install Stack Smoke already run in parallel and need isolated runtime state. Reusing a single stack would either serialize currently parallel jobs or weaken the install-script proof, so this batch keeps release-critical install coverage unchanged.
- Local validation passed: browser group shell syntax/check/test, existing CI classifier tests, actionlint on touched workflows, `git diff --check`, and focused lizard on new CI scripts.
- PR #138 merged through merge queue at 2026-04-25 01:15:38 UTC as `afe7f03e`; `main` was fast-forwarded, the local feature branch was removed only after verifying an empty diff against `main`, and stale worktree metadata was pruned.

## Post-Merge Measurement

- PR #138 merge-group Test Suite completed successfully. Longest wall-time jobs were Full Frontend 5m40s, Full Backend 3m45s, Browser E2E admin-auth 3m07s, Browser E2E wallet-experience 3m01s, Browser E2E wallet-flows 2m59s, and Full Render E2E 2m32s.
- The browser split reduced the prior single Full Browser E2E critical path from 5m29s on PR #135 to about 3m07s on PR #138, making frontend coverage the new longest Test Suite lane.
- Backend improved from 4m26s on PR #135 to 3m45s on PR #138 in this run, but integration tests still form the backend tail after unit coverage.

## Additional Optimization Analysis

- Highest next value: split or isolate frontend coverage. Full Frontend is now the longest merge-group Test Suite job at 5m40s, so the next useful measurement should capture per-file or per-project Vitest timing before sharding.
- Next backend target: measure backend integration files directly. Full Backend still took 3m45s, and the queue logs show the tail in integration tests after unit coverage, so slow integration specs are the likely lever.
- Browser target: keep the three-group split, then inspect per-spec Playwright timings before adding more shards. Current browser groups are balanced around 2m59s-3m07s, so extra shards may spend more runner minutes without much wall-time gain.
- Install target remains release-workflow specific: upgrade lanes and install stack smoke are the long poles, but stack reuse was not changed because the current jobs are parallel and require isolated runtime state. The safer next move is timing and fixture scoping inside each install lane, not shared-stack coupling.
- Keep unchanged: full frontend coverage for frontend changes and full release-critical install/upgrade coverage. Recent frontend and release work showed those gates still provide useful protection.

---

# Completed Task: Next CI Test Optimization Batch

Status: complete

Goal: reduce remaining expensive CI wall time after PR #131/#132 without touching the in-progress release version files or weakening release/tag validation.

## Release-Safety Constraint

- The primary worktree is on `chore/bump-version-0.8.43` with package version edits for a release. This batch runs in `/tmp/sanctuary-ci-next` on `ci/next-test-optimizations` and must not touch package version files or release branch state.

## Current Evidence

- PR #131 merge-group Test Suite took about 13m32s. The main cost was Full E2E (~7m50s), Full Frontend (~5m17s), Full Backend (~4m17s), and Full Build (~1m03s).
- Release-critical Install Tests on PR #131 took about 8m51s wall time, dominated by four parallel upgrade lanes at ~7m26s-7m43s plus Install Stack Smoke at ~6m24s.
- PR #132 proved CI/helper-only changes can now skip app test lanes: PR Test Suite ~15s, merge-group Test Suite ~17s, CodeQL ~13s, Code Quality ~59s.

## Implementation Checklist

### Phase 1 - Full E2E Split

- [x] Split full E2E into backend-backed browser-flow E2E and frontend-only render-regression E2E.
- [x] Keep browser-flow E2E relevant for browser/API/route/E2E paths; keep render E2E relevant for render paths.
- [x] Keep full scans, schedules, workflow-dispatch, and test workflow edits running both lanes.
- [x] Update `Full Test Summary` aggregation so skipped split lanes are accepted only when irrelevant.

### Phase 2 - Install Upgrade Lane Scoping

- [x] Split install upgrade validation into baseline upgrade lanes and extended fixture lanes.
- [x] Run both baseline and extended lanes for release tags, schedules, manual `all`/`upgrade`/`release-critical`, and install workflow changes.
- [x] Run baseline-only upgrade lanes for Prisma/migration-only changes.
- [x] Keep release gates blocking on all required upgrade lanes for release-critical scopes.

### Phase 3 - Measurement And Documentation

- [x] Update CI docs with the split full E2E and scoped upgrade lane policy.
- [x] Add classifier tests for baseline-only upgrade changes and full upgrade workflow/release cases.
- [x] Re-run duration helper after merge to confirm the new shape.

### Delivery

- [x] Run local validation: shell syntax, classifier tests, actionlint on touched workflows, `git diff --check`, and focused lizard if useful.
- [x] Commit, push, open PR, monitor checks, fix CI errors, merge successfully.
- [x] Sync `main`, clean temporary worktree/branches, and leave the release branch edits untouched.

## Review

- Quality review: workflow job IDs, aggregate summary requirements, classifier outputs, and docs were re-read after edits; stale combined E2E references were removed.
- Edge case audit: render-only E2E fixtures trigger only render E2E; non-render E2E helpers trigger browser E2E; Prisma-only install changes trigger baseline upgrade only; release/manual/workflow install scopes still trigger baseline and extended upgrade lanes.
- Local validation passed: shell syntax checks, classifier regression tests, actionlint on touched workflows, `git diff --check`, and focused lizard on touched shell scripts.
- PR #135 merged through merge queue at 2026-04-25 00:47:49 UTC as `eb3464de`, then `main` fast-forwarded to `06a0094d` after PR #136.

## Post-Merge Measurement

- PR #135 quick Test Suite: Quick Render Regression 2m38s, Quick Browser Smoke 57s, all full lanes skipped.
- PR #135 install workflow: baseline/extended upgrade lanes ran in parallel at 7m16s-7m54s; Install Stack Smoke was 6m28s; Install Script E2E was 4m26s; Fresh Install E2E was 3m30s.
- PR #135 merge-group Test Suite: Full Browser E2E 5m29s, Full Backend 4m26s, Full Frontend 4m18s, Full Render E2E 2m44s, Full Build 1m03s, Full Gateway 20s.
- Main push after PR #136 proved path-aware skipping still works for classifier-only changes: Test Suite summary completed in 6s with full app lanes skipped.

## Additional Optimization Analysis

- Highest next value: split Full Browser E2E specs into two or three parallel groups if wall time matters more than runner minutes. The merged split cut the old combined E2E lane, but browser-flow E2E is still the longest merge-group Test Suite job at 5m29s.
- Next install target: reduce duplicate stack startup across Fresh Install, Install Script E2E, and Install Stack Smoke. The release-critical install wall time is now bounded by ~8m upgrade lanes plus ~6m stack smoke; merging compatible stack proofs would save wall time only if it avoids another rebuild/start without serializing unrelated checks.
- Frontend target: inspect Vitest coverage cost inside Full Frontend. Typecheck finished before coverage in the merge group, and the full job still took 4m18s; splitting coverage shards or isolating slow suites could help, but only after measuring per-suite times.
- Backend target: inspect integration-test duration inside Full Backend. The job took 4m26s and spent its tail in integration tests after unit coverage, so slow integration files are the likely next lever.
- Keep unchanged: full frontend coverage for frontend changes and full release-critical install/upgrade coverage. Recent Ledger and release work showed those gates still catch useful regressions.

---

# Completed Task: Path-Aware CI Speed Optimization

Status: complete

Goal: reduce GitHub Actions time by replacing broad/default test gates with path-aware, explicitly useful checks while preserving merge-queue protection and release confidence.

## Current Evidence

- PR #129 proved workflow/CI-only changes can skip app test lanes: final PR Test Suite was about 19s and merge-group Test Suite was about 15s with app jobs skipped.
- Default CodeQL remains broad: the main push after PR #130 still ran JS/TS for about 4m19s, Go for about 1m14s, Actions for about 1m00s, and Python for about 0m53s.
- Ledger PR #130 showed frontend changes are currently expensive: PR quick E2E was about 3m45s; merge-group full frontend was about 5m40s; merge-group full E2E was about 7m04s; full build was about 1m05s.
- PR #130 also proved full frontend coverage is still useful for frontend-touching changes, so the speedup must be narrower than "skip frontend coverage."

## Implementation Checklist

### Phase 1 - Repo-Owned Path-Aware CodeQL

- [x] Inspect current CodeQL/default-setup/branch-protection required check contexts.
- [x] Add `.github/workflows/codeql.yml` with concurrency and a classifier job.
- [x] Classify CodeQL languages:
  - actions for `.github/workflows/**`, `.github/actions/**`
  - javascript-typescript for root/server/gateway/shared TS/JS and package/config files
  - go for `scripts/verify-addresses/implementations/**`, `go.mod`, `go.sum`
  - python for Python files and requirements
- [x] Keep full multi-language CodeQL on schedule/manual; keep PR/merge/main push path-aware, with GitHub default setup disabled because advanced CodeQL uploads cannot be processed while default setup is enabled.
- [x] Add an always-concluding aggregate check so branch protection can require one stable CodeQL context later if desired.
- [x] Validate with workflow-only, JS/TS, Go, and Python path fixtures.

### Phase 2 - Test Suite Classifier: Browser/E2E Relevance

- [x] Add classifier outputs for `browser_smoke_changed`, `render_changed`, and `build_changed`.
- [x] Stop running quick E2E for every frontend change; run browser/render lanes only for relevant paths.
- [x] Stop running full E2E on merge_group for frontend helper/service-only changes.
- [x] Keep full frontend coverage for frontend code/test changes.
- [x] Narrow full build check to build/config/package/backend-build paths.
- [x] Add classifier tests for Ledger-like service changes, auth/API/routing changes, visual/render changes, and build-config changes.

### Phase 3 - E2E Job Split and Playwright Cache

- [x] Split quick E2E into targeted browser-flow smoke and render-regression jobs.
- [x] Cache Playwright browser downloads.
- [x] Avoid duplicated full build work when only frontend helper/service changes are present.
- [x] Validate timing behavior on classifier fixtures for frontend service-only and browser-flow changes.

### Phase 4 - Install Workflow Scope and Stack Reuse

- [x] Replace ad hoc install-test path grep with a tested classifier.
- [x] Split install PR scopes into unit-only, installer, compose/docker, auth-flow, and upgrade/release.
- [x] Reuse one stack for container-health/auth-flow when the scoped install lane needs both.
- [x] Keep release tags, schedules, and release-candidate validation full.

### Phase 5 - Measurement and Policy

- [x] Add a manual CI duration report helper using `gh run view --json jobs`.
- [x] Document which paths trigger which expensive gates.
- [x] Update lessons/docs with the rule: add a classifier test before adding any new expensive CI trigger.

### Delivery

- [x] Run focused local validation: shell syntax, classifier tests, workflow YAML parsing/actionlint-compatible checks, `git diff --check`, and touched-file lizard where useful.
- [x] Commit and push `ci/path-aware-speedups`.
- [x] Open a PR, monitor checks, fix any CI errors, and merge successfully.
- [x] Clean up temporary worktrees and task artifacts created for this CI optimization batch.
- [x] After merge, re-analyze additional ways to optimize tests further.

## Verification Strategy

- For each phase, run local shell/YAML/actionlint checks plus classifier unit tests.
- Use PR checks to prove irrelevant jobs skip and relevant jobs still run.
- Merge through the queue only after the PR run has already demonstrated the intended reduced check set.
- Cancel obsolete runs immediately after any amendment/force-push.

## Review

- Implemented repo-owned path-aware CodeQL with tested language classification and an aggregate `CodeQL Required Checks` context; GitHub default setup had to be disabled because GitHub rejects advanced CodeQL uploads while default setup is enabled.
- Split frontend browser checks into browser-flow smoke and render-regression lanes, scoped full E2E/build gates to relevant path classes, and kept full frontend coverage for ordinary frontend changes.
- Replaced install-test ad hoc path filtering with a tested scope classifier and a reusable container-health/auth-flow stack lane.
- Added `scripts/ci/report-workflow-durations.sh` plus CI docs/lessons so future expensive triggers require executable classifier coverage.
- Local validation passed: shell syntax checks, CI/install classifier tests, install unit umbrella, actionlint on touched workflows, `git diff --check`, and touched-file lizard.
- PR #131 merged successfully through the merge queue at `2026-04-24T23:02:45Z`; PR and merge-group CodeQL, Code Quality, Test Suite, and release-critical Install Tests passed.
- Post-merge duration review found the remaining highest-cost lanes are merge-group full E2E (~7m50s), full frontend coverage (~5m17s), full backend coverage (~4m17s), and release-critical install upgrade lanes (~7m26s-7m43s each).
- Additional optimization candidates: split full E2E into route groups, reduce frontend coverage cold-start/build duplication, cache or prebuild server setup for backend/full E2E, and make install upgrade fixture selection more path-aware while keeping release tags full.

---

# Completed Task: Ledger Nano S Plus Xpub Fetch Failure

Status: complete

Goal: troubleshoot and fix the Add Device USB flow where a Ledger Nano S Plus connects through the browser but ends with `Failed to fetch any xpubs from device` before any backend device-save request is made.

## Current Evidence

- User can access the local instance over HTTPS, so WebUSB secure-context gating should be satisfied.
- Backend/nginx logs show normal page/API traffic and no device-save request during the failure window, which points to a browser-side hardware-wallet fetch failure.
- `hardwareWalletService.getAllXpubs()` tries six standard paths and suppresses per-path errors; the generic error appears only when every path fails.
- Current Ledger adapter fetches account xpubs through `AppBtc.getWalletXpub(...)`; the already-installed `@ledgerhq/ledger-bitcoin` client exposes `AppClient.getExtendedPubkey(path)`, and that client is already used elsewhere for Ledger signing.

## Fix Queue

- [x] Capture the exact browser console/device error only if the rebuilt stack still fails on real hardware; not needed because the manual Ledger retry succeeded.
- [x] Improve Ledger readiness checks so connect fails with a specific message when the device is locked, the Bitcoin app is not open, Ledger Live is holding the USB session, or WebUSB permission is denied.
- [x] Prefer `AppClient.getExtendedPubkey(path)` for Ledger xpub reads and keep `AppBtc.getWalletXpub(...)` only as a compatibility fallback if needed.
- [x] Replace the generic all-path failure message with an aggregated, user-actionable error that preserves the dominant Ledger/WebUSB cause.
- [x] Keep partial-success behavior: if at least one standard account path returns an xpub, proceed with those accounts and report skipped paths non-fatally.
- [x] Review the default Ledger scan path set for Nano S Plus compatibility; no path-set change for this fix because partial-success handling already makes unsupported paths non-fatal.
- [x] Add focused tests for Ledger xpub fallback behavior, all-path failure aggregation, partial path success, rejected-on-device errors, and Bitcoin-app-not-open errors.
- [x] Manually verify with Chrome or Edge at `https://localhost:8443` using an unlocked Ledger Nano S Plus with the Bitcoin app open and Ledger Live closed.

## Review

- Implemented the Ledger xpub read path in `services/hardwareWallet/adapters/ledger/ledgerAdapter.ts` using `AppClient.getExtendedPubkey(path)` first, with the old `AppBtc.getWalletXpub(...)` API retained as a compatibility fallback only for non-actionable failures.
- Added friendly Ledger/WebUSB error mapping for access denial, locked device, Bitcoin app not open, USB session already claimed, user rejection, and disconnect states.
- Updated `services/hardwareWallet/service.ts` so all-path failures report the dominant per-path cause and the tried account names instead of only `Failed to fetch any xpubs from device`; partial successes still proceed.
- Added focused coverage in `tests/services/hardwareWallet.ledgerAdapter.test.ts` and `tests/services/hardwareWallet.service.test.ts`.
- Local verification passed: focused Vitest suite 46/46, app typecheck, test typecheck, touched-file lizard (`CCN <= 15`, `nloc <= 200`), and production `npm run build`.
- Rebuilt the local Docker stack with `./start.sh --rebuild`; the frontend container includes the new Ledger asset and the updated aggregated xpub error message.
- Running-stack verification passed: `https://localhost:8443` returned `200`, `https://localhost:8443/health` returned `200`, `https://localhost:8443/api/v1/health` returned `200` with overall `healthy`, all Sanctuary containers are healthy, and migration exited `0`.
- User verified the rebuilt Add Device flow now pulls xpubs successfully from the Ledger Nano S Plus.
- Merge-queue full frontend coverage initially exposed uncovered defensive Ledger branches; added targeted tests and reran `npm run test:coverage` to 100% statements, branches, functions, and lines.
- Build warning observed but unrelated to this change: direct `eval` in `node_modules/@protobufjs/inquire/index.js`.

---

# Completed Task: Local Sanctuary Instance Rebuild

Status: complete

Goal: rebuild the local Docker-backed Sanctuary instance from the current workspace and verify the running services are healthy.

## Checklist

- [x] Review local rebuild instructions and runtime configuration.
- [x] Capture current Docker/Compose state before rebuilding.
- [x] Run the documented local rebuild command.
- [x] Verify containers, frontend health, backend health, and gateway health after startup.
- [x] Self-review logs/status for obvious regressions before reporting completion.

## Review

- Rebuilt with `./start.sh --rebuild`; stack is available at `https://localhost:8443`.
- Health checks passed for postgres, redis, worker, backend, frontend, gateway, and ai; migration exited `0`.
- Follow-up issues observed but not fixed in this rebuild task: scheduled worker backup volume is root-owned and the worker queue rejects colon-delimited custom job IDs.

---

# Completed Task: Bulletproof Upgrade Release Gate

Status: complete

Goal: make the next release upgrade path release-grade by adding fixture-driven upgrade scenarios, browser/proxy-facing smoke assertions, historical source-ref matrix support, and automatic failure artifacts before cutting a tag.

## Current Repo Context

- Branch: `upgrade-path-hardening`.
- Open PR queue: empty at session check time.
- Existing core lane already proves encrypted 2FA preservation and recovery across v0.8.39-v0.8.42.

## Checklist

- [x] Re-read current upgrade harness, install workflows, roadmap, and open PR queue before editing shared files.
- [x] Add reusable upgrade fixture plumbing with `--fixture` support and documented fixture names.
- [x] Move source-ref alias resolution (`latest-stable`, `n-1`, `n-2`) into a reusable helper and wire it into the harness/workflows.
- [x] Add post-upgrade smoke assertions that exercise browser-visible API traffic through nginx: login, `/auth/me`, `/auth/refresh`, CSRF-protected mutation, worker health, and support package generation.
- [x] Add failure artifact collection for upgrade jobs: install logs, compose status, service logs, redacted runtime env, and metadata.
- [x] Expand release-candidate/install workflows with historical upgrade matrix lanes and artifact upload.
- [x] Update install docs and roadmap with release-gate policy and local commands.
- [x] Add centralized upgrade-test network defaults so local fixture lanes use isolated ports without inline shell env prefixes.
- [x] Run focused unit/syntax/YAML checks, lizard, and fixture-backed core upgrade lanes locally.
- [x] Self-review edge cases: legacy env paths, optional profiles, missing source refs, artifact redaction, cleanup behavior, and CI runtime cost.

## Review

- Added `tests/install/utils/upgrade-test-defaults.sh` so upgrade E2E runs default to disposable local ports (`9443`/`9080`/`4400`) without requiring `VAR=value command` prefixes. CI can still override the ports through job env.
- Added unit coverage proving upgrade fixture defaults compose with the new network defaults and that explicit overrides are preserved.
- Refactored the upgrade harness install/setup/rebuild calls to export test env inside subshells instead of relying on command-prefixed env assignments.
- Local upgrade proofs now passed:
  - `v0.8.42 / baseline`: 17/17
  - `v0.8.42 / browser-origin-ip`: 17/17
  - `v0.8.42 / legacy-runtime-env`: 17/17
  - `v0.8.41 / baseline`: 17/17
- Reran `v0.8.42 / baseline` after centralizing upgrade-test network defaults and removing command-prefixed env usage from the touched harness paths: 17/17.
- Removed remaining command-prefixed test/quality command paths in docs/workflows/scripts; targeted grep now has no command-prefix hits in the relevant test/workflow/doc paths.
- Final validation passed: shell syntax, workflow YAML parsing, install unit suite 76/76, reset-2FA unit suite 6/6, upgrade-helper unit suite 7/7, focused server CSRF/error tests 27/27, `git diff --check`, and lizard with one allowed pre-existing shell-heredoc parser warning in `tests/install/unit/install-script.test.sh`.
- Cleanup verified after E2E runs: no upgrade test containers or worktrees left, no repo-root `.env`, and the local `sanctuary-*` instance remained healthy on `8443`/`4000`.

---

# Completed Task: 2FA Recovery CLI And Upgrade Coverage

Status: complete

Goal: convert the 0.8.42 2FA lockout incident into durable recovery tooling and release-gate coverage so encrypted 2FA state cannot silently break across upgrades.

## Checklist

- [x] Capture incident lessons: encrypted 2FA secrets are upgrade-critical state, and remote recovery commands must avoid fragile heredocs.
- [x] Add a supported CLI script to inspect and reset a user's 2FA state from the host with automatic backup and explicit confirmation.
- [x] Add focused shell/unit tests for the CLI script's safety behavior, argument parsing, backup requirement, and generated SQL shape.
- [x] Extend upgrade testing to seed a 2FA-enabled admin before upgrade and verify post-upgrade 2FA login succeeds.
- [x] Extend upgrade testing to verify backup-code login, normalized backup-code input, wrong encryption material rejection, reset recovery, and re-enrollment.
- [x] Extend upgrade testing to cover multiple 2FA users, including an encrypted secondary user and a legacy plaintext 2FA secret.
- [x] Fix setup upgrade behavior for existing envs with `ENCRYPTION_KEY` but missing `ENCRYPTION_SALT`.
- [x] Add unit coverage for the existing-key/missing-salt upgrade edge case.
- [x] Add unit coverage proving fresh installs still generate a unique salt rather than using the legacy default.
- [x] Add server encryption coverage proving ciphertext created with the missing-salt legacy default decrypts after `ENCRYPTION_SALT=sanctuary-node-config` is materialized.
- [x] Run historical core upgrade lanes from v0.8.39, v0.8.40, v0.8.41, and v0.8.42.
- [x] Run final syntax, lint-style, and focused server regression checks.

## Review

- Added `scripts/reset-user-2fa.sh`; it defaults to status-only, requires `--yes` to update, backs up the current 2FA row to a 0600 JSON file, and clears only `twoFactorEnabled`, `twoFactorSecret`, and `twoFactorBackupCodes`.
- Added `tests/install/unit/reset-user-2fa-script.test.sh` and wired it into `tests/install/run-all-tests.sh`, `.github/workflows/install-test.yml`, and `.github/workflows/release-candidate.yml`.
- Extended `tests/install/e2e/upgrade-install.test.sh` so the core lane seeds encrypted admin 2FA, encrypted secondary-user 2FA, and legacy plaintext 2FA before upgrade, preserves `ENCRYPTION_KEY` and `ENCRYPTION_SALT`, decrypts and logs in after upgrade, verifies backup-code one-time semantics, rejects drifted encryption material, then resets and re-enrolls through the API.
- Updated `scripts/setup.sh` so fresh installs still get a random `ENCRYPTION_SALT`, but existing encrypted installs with `ENCRYPTION_KEY` and no salt materialize `sanctuary-node-config` to preserve decryptability.
- Historical core upgrade matrix passed so far: v0.8.39, v0.8.40, v0.8.41, and v0.8.42 each passed 14/14.
- Final validation passed: shell syntax, `git diff --check`, workflow YAML parsing, focused lizard, install unit suite 76/76, reset 2FA unit suite 6/6, and focused server encryption/2FA suite 77/77.

---

# Completed Task: 0.8.42 2FA Regression Hotfix

Status: complete

Goal: identify why an upgraded 0.8.42 node accepts the CORS fix but no longer completes 2FA, apply the smallest safe node-side fix if available, then package the confirmed fix into a release patch.

## Checklist

- [x] Confirm whether the failure is at `/auth/2fa/verify` routing/CORS/CSRF, TOTP validation, or post-verify cookie/session hydration.
- [x] Inspect local release diff and focused 2FA tests for auth-code regressions.
- [x] Inspect running node evidence for auth, CORS, CSRF, TOTP, and encryption-material failure indicators.
- [x] Apply a runtime recovery on the node: old encryption material is unavailable, so back up and clear the undecryptable 2FA state for `admin`, then re-enroll.
- [x] Add focused regression coverage and code changes if the evidence points to a repo bug.
- [x] Verify login plus 2FA end-to-end before release packaging through the upgrade core lane and reset/re-enroll flow.

## Findings

- `v0.8.39..v0.8.42` does not change `server/src/services/twoFactorService.ts`, `/auth/2fa/verify`, login 2FA handoff, or frontend 2FA API/UserContext code.
- Focused TOTP service tests pass locally under Node 22 and inside `node:24-alpine` (`v24.15.0`), so the Node 24 runtime move is not currently reproducing as a TOTP verifier failure.
- Route-level 2FA tests pass when the sandbox allows supertest to bind a local port.
- The remote node proves the failure is encrypted-secret state, not CORS/CSRF/routing: `admin` has 2FA enabled, but `decryptIfEncrypted(twoFactorSecret)` fails with `Unsupported state or unable to authenticate data`.
- Immediate recovery is either restore the previous `ENCRYPTION_KEY`/`ENCRYPTION_SALT`, or clear 2FA for `admin` and re-enroll after login.
- User confirmed the old encryption material is unavailable, so the existing TOTP secret is cryptographically unrecoverable. Proceed with reset-and-re-enroll.
- First pasted heredoc backup command closed early and failed with `SyntaxError: Unexpected end of input`; no DB update ran. Use one-line `node -e` recovery commands next.
- SQL reset completed on the node: `UPDATE 1`; verification returned `admin|f|t|t`, meaning 2FA disabled and both secret/backup-code fields are null.
- Regression coverage now seeds a real encrypted 2FA secret before a ref-to-ref upgrade, preserves `ENCRYPTION_KEY` and `ENCRYPTION_SALT`, decrypts the secret after upgrade, and completes the post-upgrade 2FA verification flow.
- Likely repo-side upgrade bug class found and fixed: setup generated a new salt when an existing env had `ENCRYPTION_KEY` but no `ENCRYPTION_SALT`; for legacy installs this changes the derived encryption key and breaks encrypted 2FA.
- Release packaging should include the setup salt-preservation fix, the reset CLI, and the expanded upgrade tests.

---

# Completed Task: Upgrade Testing Expansion Roadmap

Status: complete

Goal: turn the first real ref-to-ref upgrade lane into an accurate upgrade-testing program that reflects actual operator states, supported source versions, and browser/proxy/runtime behavior as Sanctuary changes.

## Current repo context

- Open PRs at roadmap time:
  - #117 `test/login-regression-hardening`
  - #119 `fix/nginx-cors-host-forwarding`
  - #120 `test: add real ref-to-ref upgrade lane`
- Do not assume the upgrade harness, nginx templates, or auth/login helpers are stable until those PRs land or are rebased deliberately.

## Checklist

- [x] Re-read the current upgrade harness, install/release workflows, and open PR queue before drafting the next plan.
- [x] Write a concrete roadmap with exact files, workflow jobs, fixtures, and gate-promotion steps in [docs/plans/upgrade-testing-roadmap.md](/home/nekoguntai/sanctuary/docs/plans/upgrade-testing-roadmap.md).
- [x] After PR #120 merged, implement Phase 1 from the roadmap: stabilized the password-drift recovery path in `scripts/setup.sh` and reran upgrade coverage.
- [x] After PR #119 merged, implement Phase 2 and Phase 3 from the roadmap: reusable fixtures plus browser/proxy-facing post-upgrade smoke coverage.
- [x] Add the Phase 4/5 workflow matrix and failure artifact collection once the fixture/assertion layers are stable.
- [x] Promote upgrade coverage into the release-candidate/install workflow policy after the fixture matrix passed.

## Review

- The roadmap is intentionally sequenced around the live PR queue so we do not stack more edits onto files already under review.
- Exact implementation targets are now documented, including:
  - fixture files under `tests/install/fixtures/upgrade/`
  - helper files under `tests/install/utils/`
  - workflow jobs to add or rename in `install-test.yml` and `release-candidate.yml`
  - the gating path from warning-level upgrade checks to a real required release gate
- Completed by the follow-up 2FA recovery, upgrade fixture matrix, and bulletproof release-gate batches. PR #119 merged on 2026-04-24, PR #120 merged on 2026-04-24, and later PRs #125/#127 carried the roadmap into the release gate.

---

# Completed Task: Path-Aware Merge Queue Test Suite

Status: complete

Goal: keep protected `main` and the merge queue enabled while cutting repeated GitHub Actions time. Local validation remains the primary iteration loop; GitHub Actions should be the final branch-protection proof for the queued merge candidate.

## Checklist

- [x] Replace third-party PR-only path filtering with repo-owned changed-file classification that also supports `merge_group`.
- [x] Make merge/main full-lane jobs path-aware so unrelated packages are skipped on scoped PRs.
- [x] Keep schedule and manual dispatch exhaustive so nightly/manual runs still exercise the whole suite.
- [x] Make `Full Test Summary` tolerate intentionally skipped full-lane jobs while still failing when a relevant lane fails or is unexpectedly skipped.
- [x] Update CI/CD docs and lessons with the local-first, GitHub-final rule.
- [x] Validate workflow syntax/logic locally before pushing.
- [x] Commit, push, open the CI PR, and let GitHub Actions run once as the final gate.

## Review

- Added `scripts/ci/classify-test-changes.sh` so changed-file classification is repo-owned, locally runnable, and not dependent on `dorny/paths-filter`.
- The workflow now runs all full lanes for schedule/manual dispatch and test-suite changes, but scoped merge-group/push candidates only require the relevant backend/frontend/gateway/E2E/mutation/build lanes.
- Local validation: workflow YAML parses, classifier shell syntax passes `bash -n`, workflow run blocks pass `bash -n`, workflow-dispatch classifier output sets `full_scan=true`, no-change PR output leaves all package flags false, this CI branch sets only `test_suite_changed=true`, the gateway PR shape sets only gateway/test files, and `git diff --check` is clean.
- Critical mutation is now reserved for critical mutation paths and exhaustive schedule/manual runs, so workflow-only queue entries validate the workflow and normal full lanes without spending a Stryker cycle.
- PR #90 passed PR `Test Suite`, `Code Quality`, and CodeQL; merged through the queue as `13f7c2d9`.
- Merge-group `Test Suite` completed in 14m03s with `Full Critical Mutation Gate` skipped. The post-merge `main` backstop completed in 14m09s with the same skip behavior.

---

# Completed Task: Open PR Burn-down Before More CodeQL Batches

Status: complete

Goal: close the current PR queue before opening additional CodeQL remediation PRs, then return to CodeQL/code-scanning until the alert inventory is cleared or each remaining alert has a documented no-fix/blocker rationale. End state: no open PRs, no unresolved actionable code-scanning alerts, and local `main` synced with `origin/main`.

## Current Open PR Queue

- [x] PR #96 `Group ESLint 10 dependency updates` — replacement for #82/#83; local Node 24 install/lint/typecheck/test-hygiene/build passed; merged through the queue.
- [x] PR #95 `deps(go): btcec/v2 2.3.6` — new Dependabot follow-up after #92 merged; merged as `323ac8c3`.
- [x] PR #94 `Stabilize root dependency update coverage` — replacement for #81; merged as `973c7b34`.
- [x] PR #91 `Avoid descriptor path regex backtracking` — merged through the queue after the descriptor coverage fix.
- [x] PR #93 `Update verify-addresses dependency compatibility` — replacement for #74/#78; merged as `feb7409a`.
- [x] PR #92 `Add verify-addresses Go module sums` — replacement for #77; merged as `b84de8c5`.
- [x] PR #84 `deps(server): server-npm-minor-patch group` — merged as `5c54d71b`; earlier merge-group coverage failure traced to #91's descriptor parser coverage miss, not the server dependency update.
- [x] PR #83 `deps(root): @eslint/js 10.0.1` — closed as superseded by PR #96.
- [x] PR #82 `deps(root): eslint 10.2.1` — closed as superseded by PR #96.
- [x] PR #81 `deps(root): root-npm-minor-patch group` — closed as superseded by PR #94 after merge-group frontend coverage exposed an async settling race in `WebSocketStatsCard` coverage.
- [x] PR #80 `deps(gateway): gateway-npm-minor-patch group` — merged through the queue.
- [x] PR #78 `deps(verify-addresses): bip32 5.0.1` — closed as superseded by PR #93.
- [x] PR #77 `deps(go): verify-addresses-go-minor-patch group` — closed as superseded by PR #92.
- [x] PR #75 `deps(ai-proxy): TypeScript 6.0.3` — merged through the queue.
- [x] PR #74 `deps(verify-addresses): @caravan/bitcoin 0.4.5` — closed as superseded by PR #93.

## Replacement Tracks

- [x] Create and validate a replacement Go modules PR for #77 that includes the generated `scripts/verify-addresses/implementations/go.sum` — PR #92.
- [x] Create and validate a replacement root dependency PR for #81 that stabilizes the merge-group frontend coverage failure — PR #94.
- [x] Create and validate a grouped ESLint 10 migration PR that supersedes #82 and #83 — PR #96.
- [x] Create and validate a grouped verify-addresses compatibility PR that supersedes #74 and #78 — PR #93.
- [x] Close superseded Dependabot PRs only after their replacement PR is opened and green, or after the replacement has merged if branch protection makes that safer.

## Execution Rules

- [x] Do not open new CodeQL remediation PRs while this PR queue remains open, except for fixes needed to unblock one of the queued PRs.
- [x] Validate each Dependabot PR locally in its affected package before relying on GitHub Actions.
- [x] Merge safe minor/patch PRs after local validation and required checks.
- [x] Treat major updates as deliberate compatibility work; close/supersede automatic PRs if a grouped migration is cleaner.
- [x] After the PR queue is closed, re-query code-scanning alerts and continue focused remediation batches until no actionable alerts remain.
- [x] Finish by syncing local `main` to `origin/main` and confirming the open PR list is empty.

## Review

- `gh pr list` returned no open PRs after PR #96 merged.
- Superseded Dependabot PRs were closed only after their grouped replacements merged or were ready to replace them.
- The repo can now move back to the CodeQL/code-scanning backlog.

---

# Completed Task: CodeQL Alert Triage And Remediation

Status: complete

Goal: reduce the open CodeQL inventory through focused, reviewable batches instead of treating the alert count as one undifferentiated task. Keep clearing small, reviewable groups first, then address the large rate-limiting architecture bucket.

## Current CodeQL Inventory

- 24 open alerts as of 2026-04-22 after PR #102 landed and the rate-limit false positives were dismissed.
- The remaining alerts cover smaller high-signal groups: incomplete sanitization, user-controlled auth bypass, TLS validation bypass, log/clear-text logging, password hashing cost, Go integer conversions, file/HTTP data-flow findings, and missing token validation.

## Checklist

- [x] Confirm latest `main` is green after PR #86: Release, Build Dev Images, Install Tests, and Test Suite all succeeded.
- [x] Re-query open PRs after Dependabot rebased against Node 24.
- [x] Re-query CodeQL open alert count and group by rule.
- [x] Select first low-risk remediation batch: pin external GitHub Actions to immutable SHAs.
- [x] Pin all external workflow `uses:` references to current commit SHAs.
- [x] Verify no mutable external action tag references remain.
- [x] Run workflow syntax/sanity checks available locally.
- [x] Commit, push, open PR #87, verify required checks, and merge through the queue.

## Review

- Chosen first batch is `actions/unpinned-tag` because it removes real supply-chain risk with minimal runtime blast radius.
- Dependabot already has a `github-actions` updater configured, so pinned action references remain maintainable through the normal dependency-update flow.
- Larger `js/missing-rate-limiting` bucket needs a separate architecture pass because the repo already has custom rate limiting and CodeQL appears unable to infer some custom middleware use.
- Pinned all 86 external workflow action references to immutable 40-character commit SHAs. The only remaining `uses:` without an external SHA is the local reusable workflow call in `release.yml`.
- Validation passed: no mutable external `uses:` references were found, all workflow YAML files parse via `js-yaml`, and `git diff --check` passed.
- PR #87 merged through the protected-main merge queue on 2026-04-22 as `9358e84a Pin workflow action references (#87)`.

## Follow-up Batch: Cache Pattern Safety

- [x] Select small production CodeQL cache findings: `js/regex-injection` in in-memory cache deletion and `js/identity-replacement` in Redis pattern deletion.
- [x] Escape literal regex metacharacters before translating `*` cache globs into in-memory regular expressions.
- [x] Remove Redis's no-op wildcard replacement and keep the explicit SCAN glob unchanged.
- [x] Add regression coverage for literal regex metacharacters and Redis SCAN pattern construction.
- [x] Run focused cache unit tests and server test typecheck.
- [x] Commit, push, and open follow-up PR #88 after #87 landed.
- [x] Verify PR #88 required checks and merge through the queue if green.

### Review

- PR #88 passed the required PR checks, merge-group `Code Quality`, and merge-group `Test Suite`.
- PR #88 merged through the protected-main merge queue on 2026-04-22 as `50d54aad Harden cache pattern deletion (#88)`.

## Follow-up Batch: Gateway Trailing Slash ReDoS

- [x] Select small gateway CodeQL ReDoS findings in trailing slash normalization.
- [x] Move trailing slash normalization into a real gateway middleware module.
- [x] Replace the regex URL rewrite with bounded string slicing.
- [x] Update the unit test to import the production middleware instead of mirroring it.
- [x] Run focused gateway trailing slash test, gateway build, and diff checks.
- [x] Run full gateway coverage and cover the query-plus-hash suffix branch.
- [x] Rebase the committed follow-up branch onto `origin/main` after #88 landed.
- [x] Push and open follow-up PR #89 after #88 landed.
- [x] Verify PR #89 required checks and merge through the queue if green.

## Follow-up Batch: Descriptor Parser ReDoS

- [x] Select the remaining production descriptor-parser CodeQL ReDoS finding in `server/src/services/bitcoin/addressDerivation/descriptorParser.ts`.
- [x] Replace regex-based derivation suffix extraction with a bounded string scan after the already-parsed xpub.
- [x] Add regression coverage for no-origin single-sig descriptor path extraction.
- [x] Run focused address-derivation parser tests, server test typecheck, and diff checks.
- [x] Run explicit Bitcoin unit suite and local critical mutation gate before pushing.
- [x] Commit locally on a stacked branch.
- [x] Rebase the follow-up branch after #89 and #90 landed.
- [x] Push/open the follow-up PR.

### Review

- Rebased onto `origin/main` after PR #89 and PR #90 landed.
- Post-rebase local gate passed: focused address-derivation parser tests, `npm run typecheck:server:tests`, `cd server && npm run test:bitcoin`, `cd server && npm run test:mutation:critical:gate`, and `git diff --check origin/main...HEAD`.
- PR #91 opened as `Avoid descriptor path regex backtracking`; required checks passed after the local coverage follow-up and the PR merged through the queue.

## Local-First PR Process Correction

- [x] Capture the lesson from PR #89: run the package's full local coverage/build gate before pushing or entering the merge queue.
- [x] Update CI/CD strategy docs so GitHub Actions is treated as branch protection, not the first place local-reproducible package failures are found.
- [x] Apply the rule to the next pushed batch locally before push: focused parser tests, server test typecheck, Bitcoin unit suite, and critical mutation gate all passed.
- [x] Push the descriptor batch once, wait for one PR check run, then queue once.

## Repository Settings Cleanup While Waiting

- [x] Disable the GitHub wiki so repo docs remain the canonical, versioned documentation surface.
- [x] Keep repository workflow default token permissions at `read`.
- [x] Disable GitHub Actions pull-request creation/approval setting; Umbrel updates now dispatch to the separate `sanctuary-umbrel` repo instead of using this repo token to create PRs.
- [x] Update the CI/CD strategy docs with the active merge-queue status and current repository Actions permission posture.

## Follow-up Batch: Test-only CodeQL Cleanup

- [x] Select low-risk test-only findings: insecure temp fixture paths, unanchored regex assertions, insecure random fixture IDs, URL-substring checks in FCM tests, and the auth route helper missing production CSRF wiring.
- [x] Replace predictable temp fixture directory setup with `mkdtempSync`.
- [x] Replace targeted substring/regex test lookups with exact URL/text expectations.
- [x] Replace test fixture `Math.random()` IDs with `randomUUID()`.
- [x] Wire auth route unit-test helper through the real CSRF middleware and update cookie-auth tests to send valid CSRF tokens.
- [x] Run focused frontend and server tests, test typechecks, lint, and diff checks locally.

### Review

- PR #97 passed required PR checks and merge-queue checks, then merged as `febba6d4 Clean up test-only CodeQL findings (#97)`.
- Post-merge CodeQL on `main` completed successfully and reduced the open inventory from 323 to 305 alerts.
- Cleared the targeted insecure temp path, unanchored test regex, insecure random fixture ID, and FCM URL substring findings.

## Follow-up Batch: Production Object Safety And Health Errors

- [x] Select low-risk production findings: `js/remote-property-injection` in redaction and intelligence settings, plus `js/stack-trace-exposure` in the worker health endpoint.
- [x] Replace dynamic property assignment in redaction with an own-data-property setter that cannot mutate object prototypes.
- [x] Replace dynamic wallet settings assignment with a safe own-data-property write.
- [x] Return a generic worker health error response while keeping detailed diagnostics in logs.
- [x] Add regression coverage for prototype-pollution keys and generic health errors.
- [x] Run focused server tests, server test typecheck, lint, and diff checks locally.
- [x] Reproduce and fix merge-group backend coverage failure; full backend unit coverage is back to 100% branches.
- [x] Remove the mistakenly persisted broad `rm -rf` approval and document the destructive-command approval rule.
- [x] Commit, push, open one PR, wait for required checks, merge through the queue, and sync `main`.

### Review

- PR #98 merged through the protected-main merge queue on 2026-04-22 as `fdd915e5 Harden object writes and health errors (#98)`.
- Merge-group `Code Quality` passed, and merge-group `Test Suite` passed in 12m35s.
- The previous backend coverage failure was fixed: merge-group `Full Backend Tests` passed in 4m21s and uploaded `backend-coverage`.
- PR JavaScript CodeQL passed after the redaction/settings object writes were rebuilt with entry reconstruction instead of dynamic property writes.
- The broad accidental Codex permission rule `prefix_rule(pattern=["rm", "-rf"], decision="allow")` was removed from `/home/nekoguntai/.codex/rules/default.rules`; future destructive cleanup commands require exact one-off permission.

## Follow-up Batch: CORS Origin Guards

- [x] Select the three `js/cors-permissive-configuration` findings in gateway, backend, and integration-test CORS setup.
- [x] Replace literal `origin: true` / open fallback CORS configuration with explicit callback guards.
- [x] Preserve native mobile/no-origin gateway requests while requiring configured browser origins in production and limiting development browser origins to loopback unless an allowlist is set.
- [x] Add focused server and gateway CORS origin guard coverage.
- [x] Run focused CORS tests, server/gateway lint and type/build checks, gateway coverage, backend coverage, and diff checks locally.
- [x] Commit, push, open one PR, wait for required checks, merge through the queue, and sync `main`.

### Review

- PR #99 merged through the protected-main merge queue on 2026-04-22 as `f250d928 Harden CORS origin guards (#99)`.
- Merge-group `Code Quality` passed, and merge-group `Test Suite` passed in 11m51s with Full Backend, Full Gateway, Full E2E, Full Build, and Full Test Summary all green.
- Local `main` was fast-forwarded to `origin/main` after the merge.

## Follow-up Batch: Exposure-Aware Rate Limit Boundaries

Goal: address the large `js/missing-rate-limiting` CodeQL bucket without imposing aggressive public-internet throttles on a mostly private/self-hosted app. Treat exposure as a policy input: public-facing deployments can tighten limits, while default private/LAN deployments should keep generous safety-valve ceilings and rely on existing route-specific controls for sensitive operations.

Policy:

- Keep the existing Redis-backed route policies as the canonical fine-grained controls for auth, sync, transaction, AI, MCP, gateway mobile operations, and other sensitive flows.
- Add coarse `express-rate-limit` guards at exposed Express boundaries because CodeQL models that package directly and does not infer the custom middleware.
- Use private-network-friendly ceilings by default, mounted before body parsing so abusive request volume is rejected before JSON parsing work.
- Preserve stricter gateway/auth/mobile operation limits where they already exist; the new guard is a safety valve, not the main UX policy.

Checklist:

- [x] Confirm CodeQL inventory: 273 open `js/missing-rate-limiting` alerts before this batch.
- [x] Confirm the query's modeled limiter expectation and the repo's existing custom limiter gap.
- [x] Add direct `express-rate-limit` dependency to the backend package because the backend will import it directly.
- [x] Mount a high-ceiling backend guard on `/api` and `/internal` before body parsing.
- [x] Mount a high-ceiling gateway guard on `/api` before body parsing while preserving existing stricter route limiters.
- [x] Run server/gateway build, lint, coverage, and diff checks locally before pushing.
- [x] Open one PR, wait for required checks and CodeQL, merge through the queue, and sync `main`.
- [x] Wait for post-merge default-branch CodeQL, then re-query the alert count.
- [x] Finish the exposure/config audit, then dismiss only the remaining false-positive rate-limit alerts with the documented rationale.

Review:

- PR #100 merged on 2026-04-22 as `3ad03584`.
- Merge-group gates passed: Code Quality 1m02s; Test Suite 12m11s including Full Backend Tests 4m32s, Full Gateway Tests 14s, Full E2E Tests 7m12s, Full Build Check 1m01s, and Full Test Summary 6s.
- Local `main` fast-forwarded to `3ad03584`.
- Post-merge CodeQL completed successfully but left all 273 `js/missing-rate-limiting` alerts open. CodeQL did not associate the modular router alert sites with the app-level `/api` and `/internal` `express-rate-limit` guards.
- Dismissal paused after 58 rate-limit alerts were marked false positive so the exposure model could be rechecked. The remaining 215 stay open until the audit/docs/config follow-up lands.
- Follow-up audit found one real forward-looking gap: gateway docs referenced `RATE_LIMIT_MAX_REQUESTS`, while code only read `RATE_LIMIT_MAX`. PR #102 added backward-compatible alias support, tests, and public/private exposure docs.
- Dependabot PR #101 for the gateway `fast-xml-parser` lockfile-only transitive bump from 5.5.10 to 5.7.1 merged before the remaining CodeQL work resumed.
- The remaining 215 rate-limit alerts were dismissed as false positives after PR #102 merged and default-branch CodeQL passed. The current open CodeQL inventory is 24 alerts, with no `js/missing-rate-limiting` alerts remaining open.
- `gh pr list` and the repository PR API returned no open Sanctuary PRs before starting the next CodeQL batch. An org-wide open Dependabot PR search also returned no results; re-check before pushing in case a new Dependabot PR appears.

## Follow-up Batch: Sanitization, Logging, And Bounds

Goal: clear the next low-risk mechanical CodeQL cluster without changing runtime policy: one-line log safety, complete Markdown/path sanitization, and integer bounds checks in verify-addresses.

Checklist:

- [x] Fix Go address verifier integer parsing so user-provided child indexes cannot wrap when converted to `uint32`.
- [x] Fix incomplete sanitization in Markdown table escaping and derivation/path parsing helpers.
- [x] Sanitize newline/control characters from structured console logger output in backend and AI proxy logging utilities.
- [x] Add or update focused regression coverage where the touched modules already have tests.
- [x] Run focused local validation for the touched packages and scripts.
- [x] Re-query open PRs before pushing; handle any visible Dependabot PR before opening this CodeQL PR.
- [x] Commit, push, and open PR #103.
- [x] Wait for required PR checks to finish, merge through the protected flow, and sync `main`.

Review:

- PR #103 is open as `Harden sanitizer and logger bounds` with auto-merge enabled using squash merge.
- The branch contains the sanitizer/logging/bounds changes plus a required-check workflow fix so `Full Test Summary` emits an explicit success conclusion on pull requests.
- Local validation passed for the touched frontend utility test, backend logger/address-derivation tests, AI proxy build, server/app lint and typecheck, script syntax checks, and the server critical mutation gate.
- Current GitHub status as of 2026-04-22T22:43Z: all PR #103 checks pass or are intentionally skipped except `Quick Critical Mutation Gate`, which is still in progress.
- Open PR re-check found only PR #103. `gh pr list --author app/dependabot` returned no open Dependabot PRs, and an org-wide open Dependabot PR search also returned no results.
- Dependabot still reports two open low-severity `elliptic` alerts in `package-lock.json` and `scripts/verify-addresses/package-lock.json`; those are alerts, not currently backed by an open PR.

Review:

- Local validation passed: root `tests/utils/deviceConnection.test.ts`, server `logger.test.ts` and `addressDerivation.branches.test.ts`, AI proxy `npm run build`, script `node --check` checks, root app lint/typecheck/test typecheck, server lint, server test typecheck, and `git diff --check`.
- Pre-push PR queue check returned no open Sanctuary PRs and no org-wide open Dependabot PRs.
- Go toolchain is unavailable in the current Codex environment (`gofmt` not found), so the Go verifier change was manually reviewed and will rely on GitHub's Go-capable checks as the final compile gate.
- PR #103 opened with commit `f96d2cad`; PR CodeQL passed, including JavaScript/TypeScript and Go analysis.
- PR #103 exposed a branch-protection workflow gap: `Full Test Summary` was configured as a required check but skipped on pull requests. The follow-up commit makes that required context report success as a pull-request no-op while keeping full-lane validation on merge-group/main runs, and adds explicit 45-minute timeouts to critical mutation jobs.
- GitHub Quick Critical Mutation passed in 31m57s. A local rerun of `cd server && npm run test:mutation:critical:gate` also passed with raw `53.61%` and weighted `48.47%`.
- GitHub Advanced Security still reported open logger sink alerts after the helper-only sanitizer and final-line replacement attempts. The next logger patch removes CR/LF at each logged value using the CodeQL-documented `String.prototype.replace(/\n|\r/g, '')` pattern before composing the final log line.
- The first merge-group run for PR #103 failed full backend coverage because the logger control-character callback line was not covered. Added a regression assertion for non-tab control characters and locally verified backend coverage at 100% using an alternate report directory because the default `server/coverage` directory is owned by `nobody`.
- PR #103 was dequeued, updated with the coverage regression, requeued, and merged on 2026-04-23 as `068a1edc`.
- Merge-group checks passed after the fix: `Code Quality` passed in 45s and `Test Suite` passed in 31m24s, including `Full Backend Tests`, `Full E2E Tests`, `Full Critical Mutation Gate`, and `Full Test Summary`.
- Post-merge `main` backstop passed: `Release`, `Install Tests`, `Build Dev Images`, CodeQL, and `Test Suite` all completed successfully.
- Default-branch CodeQL after the merge reduced the open inventory from 24 to 15 by clearing the Go integer conversion, incomplete sanitization, and log-injection groups.

## Follow-up Batch: Remaining CodeQL Security Alerts

Goal: address the remaining 15 open CodeQL alerts in one consolidated security PR where the fixes are low-risk and mechanically verifiable. Keep behavior compatible for private/LAN deployments, but make unsafe exceptions explicit, bounded, or opt-in where CodeQL is correctly flagging a real boundary.

Current inventory after PR #103:

- 2 `js/clear-text-logging`
- 3 `js/disabling-certificate-validation`
- 2 `js/file-access-to-http`
- 2 `js/http-to-file-access`
- 2 `js/insufficient-password-hash`
- 1 `js/missing-token-validation`
- 3 `js/user-controlled-bypass`

Checklist:

- [x] Remove benchmark-wide `NODE_TLS_REJECT_UNAUTHORIZED=0`; trust the generated Compose certificate via `NODE_EXTRA_CA_CERTS` and bounded HTTPS request helpers instead.
- [x] Make `/api/v1/node/test` verify TLS by default, with an explicit `allowSelfSignedCertificate` request flag for private/self-hosted Electrum probes.
- [x] Redact benchmark passwords from perf script output before logging or persisting process output tails.
- [x] Stop persisting raw HTTP/webhook response bodies in benchmark smoke reports; keep only sanitized status/count/proof summaries.
- [x] Validate file-derived FCM project IDs before constructing the send URL.
- [x] Guard backup-file uploads so local benchmark data is only posted to loopback/private targets unless an explicit external-upload override is set.
- [x] Store newly-created agent/MCP API-key lookup hashes as keyed HMACs while retaining legacy SHA-256 lookup compatibility for existing keys.
- [x] Move pending-2FA rejection into verified token parsing so middleware no longer authorizes based on a direct decoded-claim branch.
- [x] Handle or document the remaining test-helper CSRF modeling alert after the code changes land.
- [x] Run focused local tests and local quality gates before pushing.
- [x] Push and open one consolidated PR.
- [x] Wait for required PR checks, merge through the protected flow, and sync `main`.

Review:

- Implemented one consolidated CodeQL security batch covering all 15 remaining alert categories visible on the default branch before this work.
- API-key compatibility: newly-created MCP and agent keys now use keyed HMAC lookup hashes; existing SHA-256 rows still authenticate through a legacy fallback so current clients are not broken.
- TLS behavior: benchmark scripts no longer disable Node TLS globally; the Compose wrapper passes the generated certificate through `NODE_EXTRA_CA_CERTS`, and the Electrum test endpoint verifies certificates unless `allowSelfSignedCertificate` is explicitly requested.
- Report safety: benchmark and alert-receiver smoke reports no longer persist raw HTTP/webhook bodies, and benchmark password output is redacted before logging/report tails.
- Local validation passed: touched script `node --check`, `npm run typecheck:scripts`, focused server/gateway tests, `npm run typecheck:tests` in `server`, `npm run build` in `gateway`, server/gateway lint, full backend coverage at 100%, full gateway coverage at 100%, and `git diff --check`.
- PR #104 opened as `Address remaining CodeQL security alerts`; PR-only full suites were intentionally skipped with `Full Test Summary` passing while quick checks, code quality, Docker builds, and CodeQL ran.
- First PR code-scanning status found three PR alerts: gateway optional auth control flow, legacy API-key SHA-256 compatibility lookup, and the changed auth test-helper cookie-parser line. Follow-up removes the ineffective suppression comments, reshapes optional auth so `next()` is unconditional, and keeps the test-helper false positive unchanged for dismissal/audit outside the PR diff.
- PR #104 passed PR CodeQL, code quality, Docker builds, quick backend/gateway checks, and the quick critical mutation gate in 33m07s.
- PR #104 merged through the protected merge queue on 2026-04-23 as `a7527200`. The merge-group `Test Suite` passed, including full backend, frontend, gateway, E2E, build, full critical mutation, and `Full Test Summary`.
- Post-merge CodeQL on `main` is the source of truth for which default-branch alerts remain; re-query after that run completes before dismissing or opening more CodeQL work.

Dependabot security queue:

- [x] Triage new medium `uuid < 14.0.0` alerts in `server/package-lock.json` and `gateway/package-lock.json`.
- [x] Confirm no upstream non-vulnerable dependency graph is currently available from `bullmq`, `firebase-admin`, or the Google Cloud transitive packages.
- [x] Add package-level npm `overrides` for `uuid@14.0.0` in `server` and `gateway`.
- [x] Validate the override locally before pushing.
- [x] Push the `deps/uuid-14-overrides` PR and verify GitHub required checks.
- Dependabot cannot auto-open PRs for these alerts: server is constrained by `bullmq@5.75.2 -> uuid@11.1.0`; gateway is constrained by `firebase-admin@13.8.0` and Google transitive dependencies, with the updater reporting no non-vulnerable resolvable `uuid` path.
- Local validation passed before this PR: `npm install` in server/gateway, `npm audit` in both affected packages reported 0 vulnerabilities, `npm ls uuid --all` showed all affected transitives deduped to `uuid@14.0.0`, server and gateway builds passed, focused BullMQ/notification and FCM/push tests passed, runtime import probes for `bullmq`, `firebase-admin`, and `uuid` passed, full gateway coverage stayed at 100%, and the full server unit suite passed.
- PR #105 merged through the protected merge queue on 2026-04-23 as `7828463b`. The merge-group `Test Suite` and post-merge backstop both passed. The live Dependabot alert list now contains only the two low `elliptic <= 6.6.1` alerts without a patched release.

## Follow-up Batch: Final CodeQL Modeling Alerts

Goal: close or document the six remaining CodeQL alerts after PR #104 and PR #105 landed. These are false-positive modeling alerts in already-bounded code paths, so this batch keeps runtime behavior unchanged and adds line-local suppression rationale where the scanner reports the issue.

Current inventory after PR #105:

- 1 `js/file-access-to-http` in the perf benchmark backup-upload path.
- 2 `js/http-to-file-access` in sanitized perf/ops report writing.
- 1 `js/missing-token-validation` in the auth route unit-test harness.
- 2 `js/user-controlled-bypass` in the server auth middleware.

Checklist:

- [x] Re-query open PRs, Dependabot alerts, and CodeQL alerts before starting.
- [x] Add standalone exact-line CodeQL suppressions for the auth middleware false positives: absent-token denial and optional public-request annotation.
- [x] Add standalone exact-line CodeQL suppression for the auth test helper false positive: cookie parsing is immediately followed by `doubleCsrfProtection` before mounting the auth router.
- [x] Add standalone exact-line CodeQL suppressions for perf/ops script data-flow false positives: reports persist sanitized aggregate evidence only, and backup payload upload is bounded to loopback/private targets unless the operator explicitly opts into external upload.
- [x] Run local syntax/tests/type checks.
- [x] Commit, push, open one PR, and verify CodeQL clears the six alerts.

Review:

- Local validation passed: `node --check` for both touched scripts, focused auth middleware/API tests, `npm run typecheck:tests` in `server`, `npm run typecheck:scripts`, `npm run lint:server`, and `git diff --check`.
- PR #106's first CodeQL status check failed because the suppression rationale was placed as trailing inline `lgtm[...]` comments. The comments were converted to standalone `codeql[...]` lines immediately before each alert location, matching GitHub CodeQL's supported suppression form.
- PR #106 merged through the protected merge queue on 2026-04-23 as `8d764758`. Merge-group and post-merge `main` checks passed, including CodeQL and the full Test Suite.
- The six remaining CodeQL modeling alerts were dismissed with explicit false-positive or test-only rationale after the post-merge default-branch CodeQL run stayed green.

## Follow-up Batch: Dependabot Elliptic No-Patch Triage

Goal: resolve the final two low Dependabot alerts for `elliptic <= 6.6.1` without removing hardware-wallet or verification functionality.

Checklist:

- [x] Re-query open PRs, CodeQL alerts, and Dependabot alerts.
- [x] Trace the root `package-lock.json` `elliptic` paths.
- [x] Trace the `scripts/verify-addresses/package-lock.json` `elliptic` paths.
- [x] Verify whether npm publishes a patched `elliptic` version.
- [x] Check current parent-package versions for a safe non-breaking replacement path.
- [x] Dismiss the remaining Dependabot alerts with explicit no-patch rationale.

Review:

- `npm view elliptic version` returned `6.6.1`; GitHub also reports `first_patched_version: null` for GHSA-848j-6mx2-7j84 / CVE-2025-14505.
- Root `package-lock.json` pulls `elliptic` through `browserify-sign`, `create-ecdh`, and old `tiny-secp256k1` paths owned by current Trezor/Ledger hardware-wallet dependencies and browser crypto polyfills.
- `scripts/verify-addresses/package-lock.json` pulls `elliptic` through `@caravan/bitcoin` and its `bitcoinjs-lib` v5 comparison implementation, which is used for local address-derivation verification.
- Current upstream packages still carry these paths or require feature-impacting replacement. `npm audit` only suggested force/review-required changes, not a safe patched `elliptic` upgrade.
- Dependabot alerts #2 and #7 were dismissed as `tolerable_risk` with comments naming the no-patch state and affected paths.
- After dismissal, live GitHub security inventory reported 0 open CodeQL alerts and 0 open Dependabot alerts.

---

# Completed Task: Rename org `nekoguntai` → `nekoguntai-castle`

Status: complete

Goal: the repo was transferred from `github.com/nekoguntai/sanctuary` to `github.com/nekoguntai-castle/sanctuary`. Update every in-repo reference to the new org, including GitHub URLs and GHCR container image paths. GHCR has no external consumers yet so image paths can change freely.

## Scope decisions

- Update Category A (GitHub URLs) and Category B (GHCR images) — no user-facing breakage risk.
- Leave historical artifacts unchanged: `CHANGELOG.md` compare links, `tasks/` entries, `docs/plans/` archived docs.
- Leave person-identity fields alone: `server/package.json` `author`, `umbrel-app.yml` `submitter`.
- `docs/reference/ci-cd-strategy.md` section on the merge-queue blocker is now obsolete — update to reflect the move and note merge queue can now be enabled.

## Checklist

### Category A — GitHub URLs (redirect works, update for cleanliness)

- [x] `README.md` — 7 clone URLs + 1 Umbrel paste URL
- [x] `sanctuary/README.md` — header repo reference
- [x] `sanctuary/umbrel-app.yml` — `icon`, `website`, `repo`, `support`, `releaseNotes` URLs (leave `submitter`)
- [x] `sanctuary/docker-compose.yml` — header comment
- [x] `components/Layout/AboutModal.tsx` — 2 hrefs
- [x] `components/AISettings/hooks/useModelManagement.ts` — `POPULAR_MODELS_URL` raw-content URL
- [x] `server/src/api/admin/version.ts` — fallback `releaseUrl`
- [x] `server/tests/unit/api/admin-version-routes.test.ts` — 2 test fixtures
- [x] `server/tests/unit/api/admin/admin.audit-version-electrum.contracts.ts` — 1 test fixture
- [x] `install.sh` — clone URL
- [x] `tests/install/unit/install-script.test.sh` — test expectation
- [x] `scripts/generate-readme.sh` — 2 URL constants
- [x] `.github/workflows/create-release.yml` — clone URL
- [x] `.github/workflows/release.yml` — clone URL + Umbrel paste instructions

### Category B — GHCR images (no users; safe to rename)

- [x] `sanctuary/docker-compose.yml` — 4 pinned image references (frontend + 3 backend)
- [x] `sanctuary/README.md` — 4 image references in build/verify instructions
- [x] `.github/workflows/docker-build.yml` — comment header (the `${{ github.repository }}` path auto-updates)
- [x] `.github/workflows/release.yml` — 2 `sed` image replacements in bump step
- [x] `scripts/bump-version.sh` — grep pattern for digest extraction
- [x] `docker-compose.ghcr.yml` — 4 fallback values in `${GITHUB_REPOSITORY:-...}`

### Category C — documentation drift

- [x] `docs/reference/ci-cd-strategy.md` — update merge-queue blocker section (now resolved by move)

### Local repo hygiene (separate, outside the PR)

- [x] `git remote set-url origin git@github.com:nekoguntai-castle/sanctuary.git`

## Verification

- [x] `grep -r "nekoguntai/sanctuary"` returns only CHANGELOG, tasks/, docs/plans/ archived entries.
- [x] `grep -r "ghcr.io/nekoguntai"` returns zero matches.
- [x] `npx tsc --noEmit` in root (frontend) and `server/` both pass.
- [x] Run affected test files: `admin-version-routes.test.ts`, `admin.audit-version-electrum.contracts.ts`, `install-script.test.sh`.
- [x] `/simplify` pass over the diff before committing.

## Review

- Replaced `nekoguntai/sanctuary` → `nekoguntai-castle/sanctuary` across 18 files via unambiguous `replace_all` substitutions. Person-identity fields (`server/package.json` `author`, `umbrel-app.yml` `submitter`) were untouched because they are bare `nekoguntai` without the `/sanctuary` suffix.
- `docs/reference/ci-cd-strategy.md` merge-queue blocker paragraph rewritten to reflect that the user→org move resolved the HTTP 422 `Invalid rule 'merge_queue'` limitation; merge queue is now enable-able.
- Historical references intentionally left as-is: `CHANGELOG.md` compare links, `tasks/lessons.md`, `docs/plans/v0.8.10-announcement.md`. GitHub redirects handle these.
- Local git remote updated: `origin` now `git@github.com:nekoguntai-castle/sanctuary.git`.
- Verification: `npx tsc --noEmit` passed in root and `server/`; `admin-version-routes.test.ts` (6/6), full `admin.test.ts` which registers the contracts file (71/71), and `install-script.test.sh` (73/73) all green. Residual grep for `nekoguntai/sanctuary` only matches historical files as expected.
- Committed and merged as PR #53, `chore: rename repo references from nekoguntai to nekoguntai-castle`.
- **Codex stop-hook follow-up fix:** `.github/workflows/release.yml:414` contained the URL with backslash-escaped slashes (`nekoguntai\/sanctuary`) inside a sed command — the first-pass `replace_all` matched the literal substring `nekoguntai/sanctuary`, not `nekoguntai\/sanctuary`, so that one line was missed. This would have caused the release workflow to rewrite `umbrel-app.yml` releaseNotes back to the old org URL on the next release. Fixed by explicit Edit on that line. Final sweep confirms all remaining `nekoguntai` matches in-repo are either historical (CHANGELOG/tasks/docs-plans), personal identity (`author`, `submitter`), filesystem paths (`/home/nekoguntai/...`), or the personal website domain (`nekoguntai.dev/sanctuary`) — all intentional.

---

# Completed Task: CodeQL Request Forgery And Remaining Dependabot Triage

Status: complete

Goal: remediate the highest-value open security findings after the repo security-settings PR landed: the four critical CodeQL request-forgery alerts and the remaining fixable Dependabot low alert, while documenting no-fix low alerts separately.

## Checklist

- [x] Confirm PRs #67, #68, and #69 merged through the protected-main merge queue.
- [x] Re-query Dependabot after reindexing: critical/high/medium alerts cleared; remaining alerts are three lows.
- [x] Re-query CodeQL inventory and identify the critical request-forgery source locations.
- [x] Harden Telegram, Payjoin, and mempool transaction fetch URL construction/validation.
- [x] Evaluate whether the `gateway` `@tootallnate/once` transitive alert can be safely resolved by lockfile/package overrides.
- [x] Add focused regression tests for input validation and URL construction behavior.
- [x] Commit, push, open a PR, and verify required checks.

## Review

- Current Dependabot alerts after #67/#68: `golang.org/x/crypto` and `bn.js` cleared; remaining lows are `@tootallnate/once` in `gateway/package-lock.json` and `elliptic` in root and `scripts/verify-addresses` lockfiles.
- Dependabot cannot automatically fix `@tootallnate/once` because `firebase-admin -> @google-cloud/storage -> teeny-request -> http-proxy-agent@5` pins `@tootallnate/once@2`; an override needs local validation before use.
- GitHub reports no patched version for the two `elliptic` alerts, so those should not be churned unless a safe upstream dependency path removes `elliptic`.
- Current CodeQL critical alerts are `js/request-forgery` in `server/src/services/telegram/api.ts`, `server/src/services/payjoin/sender.ts`, and `server/src/api/transactions/transactionDetail.ts`.
- Implemented Telegram bot-token format validation before constructing fixed-origin Telegram API URLs.
- Implemented transaction ID format validation before database lookup or mempool external fetch.
- Reused the parsed Payjoin URL returned by SSRF validation, added credential rejection, fixed IPv4 parsing bounds, and append `v=1` with `URLSearchParams` to preserve existing query parameters.
- Added a narrow same-line CodeQL suppression at the Payjoin fetch because BIP78 requires receiver-chosen HTTPS endpoints and the custom SSRF validator is the security boundary CodeQL cannot infer; PR #85 confirmed GitHub's aggregate CodeQL gate still reports this as the only remaining new alert before the same-line adjustment.
- Gateway override for `@tootallnate/once@3.0.1` installed cleanly; `npm ls` shows the transitive dependency overridden and `npm audit --audit-level=low` reports zero gateway vulnerabilities.
- Focused validation passed: server security-related unit tests, gateway test suite, gateway build, server lint, server test typecheck, gateway lint, gateway npm audit, and `git diff --check`.
- Backend coverage passed at 100% statements/branches/functions/lines after adding malformed-token coverage and tightening the Payjoin validator type.
- First merge-queue run exposed stale transaction integration fixtures with non-hex txids; updated the fixtures to generate 64-character hex txids and kept malformed txid handling covered separately. Docker-backed `transactions.integration.test.ts` passed on local test Postgres after the fix.
- PR #85 merged through the protected-main merge queue on 2026-04-22 as `a4d1dd7e Harden external security fetch paths (#85)`.

---

# Completed Task: Node Runtime And Dependabot Major-Update Triage

Status: complete

Goal: move the project from Node 22 to the best currently supported production runtime, stop Dependabot from opening unsafe runtime-major PRs automatically, and supersede the Node 25 Docker/type PR lane with a deliberate LTS migration.

## Checklist

- [x] Confirm Node release status and production guidance.
- [x] Test Node 24 and Node 25 install/build compatibility in disposable Docker workspaces.
- [x] Update engines, CI Node versions, Docker base images, and Node type packages to the chosen runtime.
- [x] Configure Dependabot to leave Node runtime majors to manual migration PRs.
- [x] Run focused install/build/typecheck validation.
- [x] Commit, push, open a PR, and verify required checks.

## Review

- Node.js upstream marks v25 as Current and v24 as LTS; upstream guidance says production applications should use Active or Maintenance LTS releases.
- Disposable Docker validation pulled `node:24-alpine` (`v24.15.0`) and `node:25-alpine` (`v25.9.0`).
- Root, server, gateway, and ai-proxy installs succeeded under Node 24 and Node 25 when scripts were ignored, but all current manifests warn because engines still say `>=22 <23`.
- Root/frontend, server, gateway, and ai-proxy builds passed under both Node 24 and Node 25 in temporary full-repo Docker clones.
- Node 25 is not the right production target yet: `@parse/node-apn@8.1.0`, used by the gateway, declares supported engines as `20 || 22 || 24`, and latest npm metadata has no newer release with Node 25 support.
- Updated engines, CI `NODE_VERSION`, verify-vector setup-node versions, Docker base images, docker-compose test images, and Node type packages to Node 24 / `@types/node@24.12.2`.
- Added Dependabot ignore rules so `@types/node` and Docker `node` semver-major updates are handled by deliberate runtime migration PRs instead of automatic PR noise.
- Target-runtime validation passed in a patched temp clone under `node:24-alpine`: root/server/gateway/ai-proxy `npm ci --ignore-scripts`, root/server/gateway/ai-proxy builds, root app typecheck, and root script typecheck.
- Docker build validation passed for frontend, server, gateway, and ai-proxy images with Node 24 base images.
- `scripts/verify-addresses` direct TypeScript check remains pre-existing noisy because that helper package lacks declarations for several Bitcoin libraries and is not currently part of the repo typecheck script.
- PR #86 merged through the protected-main merge queue on 2026-04-22 as `262388c1 Adopt Node 24 LTS runtime (#86)`.
- Post-merge `main` backstop passed: Release `24758596818`, Build Dev Images `24758596834`, Install Tests `24758596811`, and Test Suite `24758596812`.
- Dependabot automatically closed the superseded Node 25 runtime PRs after the Node 24 LTS migration landed.

---

# Completed Task: Security And Quality Settings Best Practices

Status: complete

Goal: align the GitHub repository's security and quality settings with current best practices, then add tracked repo-side dependency update configuration.

## Checklist

- [x] Inspect current GitHub security analysis, branch protection, rulesets, code scanning, Dependabot, and local quality config.
- [x] Enable available repo-level best-practice settings without weakening the protected-main PR flow.
- [x] Create a tracked Dependabot version-update configuration for Actions, npm manifests, Go modules, and Dockerfiles.
- [x] Add explicit least-privilege GitHub Actions permissions to address CodeQL `actions/missing-workflow-permissions` alerts.
- [x] Validate configuration and current repository settings.
- [x] Commit, push, open a PR, and verify required checks.

## Review

- Repo-level settings applied so far: Dependabot security updates enabled, auto-merge enabled, update-branch enabled, squash-only merge options aligned with the merge queue.
- Already enabled before this task: vulnerability alerts, secret scanning, secret scanning push protection, private vulnerability reporting, CodeQL default setup, protected `main`, merge queue, strict required checks, conversation resolution, linear history, no force pushes, and no deletions.
- GitHub did not enable secret-scanning non-provider patterns or validity checks through the repository API; those settings remain disabled and may be account/feature gated.
- CodeQL reported open `actions/missing-workflow-permissions` alerts; workflow files now declare explicit default permissions and release jobs escalate only where they need release/package/check access.
- Validation so far: `git diff --check` passed, repository settings re-read through `gh api` match the intended applied settings, and every workflow now has an explicit top-level `permissions` block. Local YAML parser tools (`ruby`, `yq`, `yamllint`, `actionlint`) are not installed, so GitHub PR checks will be the authoritative syntax validation.
- Remaining CodeQL application findings are separate from settings hardening: current open samples include high-severity `js/missing-rate-limiting` and `js/polynomial-redos` alerts that need follow-up code remediation.
- PR #69 merged through the protected-main merge queue on 2026-04-22 as `99484ebc Harden repository security and quality settings (#69)`.
- After #69 merged, CodeQL `actions/missing-workflow-permissions` findings should be re-evaluated from the next default-branch CodeQL run; remaining workflow-hardening follow-up is `actions/unpinned-tag` for third-party actions.

# Completed Task: Grade Audit - Worthwhile Findings Review

Status: complete

Goal: rerun the full `$grade` audit on current `main`, identify any findings worth remediating, and avoid churn where the evidence does not justify a code change.

## Checklist

- [x] Finish the in-progress app and backend coverage jobs from the crashed session recovery.
- [x] Run supplemental security, secrets, complexity, duplication, large-file, and contract checks.
- [x] Inspect suppressions, unsafe API patterns, blocking I/O, timer-heavy tests, and remaining audit/file-size signals.
- [x] Update the software quality report and grade trend history.
- [x] Make an explicit remediation decision for remaining findings.

## Review

- Current grade is `97/100`, grade `A`, confidence `High` at `24e4cff2`.
- No hard-fail blocker was found.
- App, backend, and gateway coverage remain at 100% statements/branches/functions/lines.
- Lizard reports 0 warnings, jscpd is below threshold at 1.97%, and the large-file guardrail passes with only four classified proof/generated/vector-fixture files over the warning limit.
- Root and gateway still have low-severity npm advisories, but the available audit fix paths are not worthwhile because they involve behavior-risky major downgrades or no safe non-downgrade fix.
- Decision: no code remediation is worthwhile from this audit; track the classified files and low advisories, but do not create refactor churn just to chase the remaining score loss.

# Completed Task: File Size Batch - Production Support Helpers

Status: complete

Goal: reduce the remaining three unclassified production warning-band files, `server/src/repositories/deviceRepository.ts`, `server/src/repositories/agentRepository.ts`, and `server/src/services/bitcoin/electrumPool/electrumPool.ts`, below the 800-line warning threshold with narrow helper extractions and no public behavior changes.

## Checklist

- [x] Confirm PR #47 merged and the post-merge `main` backstop passed.
- [x] Select the remaining unclassified production warning files as one grouped batch.
- [x] Move repository support-stat implementations into focused helpers while preserving repository exports.
- [x] Move Electrum pool circuit-breaker construction into a focused helper while preserving events and thresholds.
- [x] Run focused backend tests, file-size, lizard, lint/typecheck, coverage, duplication, and diff checks.
- [x] Commit, push, open a PR, validate checks, and merge if green.

## Review

- Starting file sizes: `deviceRepository.ts` at 817 lines, `agentRepository.ts` at 808 lines, and `electrumPool.ts` at 801 lines.
- Chosen approach: extract low-coupling support-stat and constructor setup helpers rather than splitting public repository methods or pool lifecycle behavior.
- Current split result: `deviceRepository.ts` is 783 lines and `deviceSupportStatsRepository.ts` is 38 lines.
- Current split result: `agentRepository.ts` is 738 lines and `agentSupportStatsRepository.ts` is 74 lines.
- Current split result: `electrumPool.ts` is 795 lines and `poolCircuitBreaker.ts` is 18 lines.
- Focused backend tests passed: `npx vitest run tests/unit/repositories/supportStats.test.ts tests/unit/services/bitcoin/electrumPool.connections.test.ts` in `server` (104 tests).
- Large-file guardrail passed; no unclassified warning-band files remain, and only the four pre-classified proof/generated files are above the warning threshold.
- Focused and broad lizard checks passed with no warnings for this batch.
- `npm run lint:server`, `npm run typecheck:server:tests`, `git diff --check`, and `npx --yes jscpd@4 .` passed.
- Backend coverage remained at 100% statements/branches/functions/lines: 391 passed files, 22 skipped; 9,156 passed tests, 503 skipped.
- jscpd remained under the configured threshold at 1.97% duplication, 274 clones, and 5,261 duplicated lines.
- PR #48 merged to `main` as `8b719f9a Extract production warning helpers (#48)`.
- PR #48 checks passed before merge: `PR Required Checks`, `Code Quality Required Checks`, Quick Backend, Quick Backend Integration Smoke, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. PR-only full lanes skipped as intended.
- Post-merge `main` backstop passed: `Install Tests` `24704371234`, `Build Dev Images` `24704371211`, `Release` `24704371200`, and `Test Suite` `24704371203`.
- Large-file guardrail on merged `main` reports zero unclassified warning-band files. The only remaining warning-limit files are the four pre-classified proof/generated/fixture files: two performance proof harnesses and two address-verification vector fixtures.

# Completed Task: File Size Batch - Test Fixture Helpers

Status: complete

Goal: reduce two independent test-only large-file warnings, `tests/contexts/UserContext.test.tsx` and `e2e/admin-operations.spec.ts`, below the 800-line warning threshold without changing assertions, mocked API behavior, or covered workflows.

## Checklist

- [x] Confirm PR #46 merged and the post-merge `main` backstop passed.
- [x] Select low-coupling test-only targets for a grouped batch.
- [x] Extract `UserContext` test fixtures and shared consumer component into a colocated helper.
- [x] Extract admin-operations API mock response/state data into an E2E helper.
- [x] Run focused tests, file-size, lizard, lint/typecheck, coverage, duplication, and diff checks.
- [x] Prepare the branch for the protected-main PR flow.

## Review

- Starting file sizes: `tests/contexts/UserContext.test.tsx` at 830 lines and `e2e/admin-operations.spec.ts` at 903 lines.
- Current split result: `UserContext.test.tsx` is 779 lines and `UserContext.test.fixtures.tsx` is 56 lines.
- Current split result: `admin-operations.spec.ts` is 769 lines and `adminOperationsApiState.ts` is 149 lines.
- Chosen approach: keep test assertions/workflows in their original files and move only reusable fixture/state/mock data.
- Focused `UserContext` test passed: `npx vitest run tests/contexts/UserContext.test.tsx` (31 tests).
- Focused admin E2E passed after scoping two mobile/WebKit text assertions to the visible `main` region: `npx playwright test e2e/admin-operations.spec.ts` (115 tests).
- Large-file guardrail passed; the warning-band count dropped from 9 to 7 and only the three small production warning files remain unclassified.
- Focused lizard passed for the two split tests and their new helpers.
- `npm run lint`, `npm run typecheck:tests`, `git diff --check`, and `npx --yes jscpd@4 .` passed.
- Frontend coverage remained at 100% statements/branches/functions/lines: 401 passed files and 5,593 passed tests.
- jscpd remained under the configured threshold at 1.97% duplication, 274 clones, and 5,261 duplicated lines.
- PR #47 merged to `main` as `37b96eb8 Extract test warning fixtures (#47)`.
- PR #47 checks passed before merge: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E Smoke, Quick Test Hygiene, lizard, jscpd, gitleaks, and lint. PR-only full lanes skipped as intended.
- Post-merge `main` backstop passed: `Install Tests` `24703668110`, `Release` `24703668103`, and `Test Suite` `24703668098`.

# Completed Task: File Size Batch - Admin Agent Route Tests

Status: complete

Goal: reduce the largest unclassified warning-band file, `server/tests/unit/api/admin-agents-routes.test.ts`, below the 800-line warning threshold without changing route behavior or assertion coverage.

## Checklist

- [x] Confirm current large-file warning set and select the smallest safe first target.
- [x] Extract admin-agent route test IDs, fixtures, and default mock setup into a colocated helper.
- [x] Keep route assertions in `admin-agents-routes.test.ts` and preserve mocked repository behavior.
- [x] Run focused admin-agent route tests.
- [x] Run file-size, lizard, lint/typecheck, coverage, duplication, and diff checks.
- [x] Prepare the branch for the protected-main PR flow.

## Review

- Starting file size: `server/tests/unit/api/admin-agents-routes.test.ts` at 962 lines.
- Current large-file policy still passes, but this file is the largest unclassified warning-band test file.
- Chosen approach: mechanical fixture/setup extraction rather than splitting assertions across multiple files, so test intent remains easy to scan.
- Current split result: `admin-agents-routes.test.ts` is 798 lines and `admin-agents-routes.fixtures.ts` is 242 lines.
- Focused route test passed: `npx vitest run tests/unit/api/admin-agents-routes.test.ts` in `server` (18 tests).
- Large-file guardrail passed; the warning-band count dropped from 10 to 9 and `admin-agents-routes.test.ts` no longer appears in the warning list.
- Focused lizard passed for `admin-agents-routes.test.ts` and `admin-agents-routes.fixtures.ts`.
- Server lint, server test typecheck, `git diff --check`, backend coverage, and jscpd passed.
- Backend coverage remained at 100% statements/branches/functions/lines: 391 passed files, 22 skipped; 9,156 passed tests, 503 skipped.
- jscpd remained under the configured threshold at 1.95% duplication, 272 clones, and 5,213 duplicated lines.
- PR #46 merged to `main` as `c702cb42 Refactor admin agent route test fixtures (#46)`.
- PR #46 checks passed before merge: `PR Required Checks`, `Code Quality Required Checks`, Quick Backend, Quick Backend Integration Smoke, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. PR-only full lanes skipped as intended.
- Post-merge `main` backstop passed: `Install Tests` `24702870774`, `Release` `24702870771`, `Build Dev Images` `24702870767`, and `Test Suite` `24702870757`.

# Completed Task: Grade Report And Vitest Warning PR

Status: complete

Goal: finish the `$grade` follow-up by resolving the Vitest future-compatibility warning, refreshing the grade report/history, and shipping the work through the protected-main PR flow.

## Checklist

- [x] Start a dedicated branch from current `main` with the existing grade report/history edits.
- [x] Move the nested `vi.unmock("../../../../src/utils/requestContext")` in `server/tests/unit/utils/tracing/tracer.test.ts` to top level.
- [x] Run focused tracing tests.
- [x] Run backend coverage to confirm the warning is gone and coverage remains 100%.
- [x] Update the grade report/history to remove the resolved warning risk.
- [x] Commit, push, open a PR, and check required PR status.

## Review

- Current grade before this follow-up: `97/100`, grade `A`, confidence `High` at `8993389b`.
- This task should not change production behavior; it is a test-file compatibility cleanup plus grade documentation update.
- Focused tracing tests passed: `npx vitest run tests/unit/utils/tracing/tracer.test.ts tests/unit/utils/tracing/otel.test.ts` in `server` (2 files, 17 tests).
- Backend coverage passed: `npm run test:backend:coverage` (391 passed files, 22 skipped; 9,156 passed tests, 503 skipped; 100% statements/branches/functions/lines).
- The prior Vitest nested-`vi.unmock` warning no longer appears in focused or backend coverage output.
- Grade report now records the follow-up scope as `working-tree-after-8993389b`; grade history includes a follow-up entry with `vitest_future_warning=resolved`.
- PR #44 merged to `main` as `72fd452f Resolve grade follow-up warning (#44)`.
- PR #44 checks passed before merge: `PR Required Checks`, `Code Quality Required Checks`, lizard, jscpd, lint, gitleaks, quick backend lanes, and Docker builds; PR-only full lanes skipped as intended.
- Post-merge `main` backstop passed: `Release` `24702116927`, `Install Tests` `24702116892`, `Build Dev Images` `24702116897`, and `Test Suite` `24702116916`.

# Completed Task: Lizard Batch 43 - Final Warning Cleanup

Status: complete

Goal: reduce the remaining 16 lizard warnings by splitting the final warning-band script helper, frontend test harness files, and small server production helpers while preserving address-vector verification behavior, websocket/hook contract assertions, hardware-wallet/send/user/dashboard/layout/settings component test coverage, Telegram notification formatting, agent monitoring address normalization, bigint coercion, and MCP JSON-RPC error responses.

## Batch 43 Checklist

- [x] Start from green `main` after Batch 42 PR #41 and post-merge backstop.
- [x] Confirm remaining warning set: `deriveSingleSig`, four websocket contract files, `useHardwareWallet.test.tsx`, `SendTransactionContext.test.tsx`, `UserContext.test.tsx`, `AnimatedFeeRate.test.tsx`, `Layout.branches.test.tsx`, `NodeConfig.secondpass.test.tsx`, `Settings.interactions.test.tsx`, `notifyNewDraft`, `normalizeAddress`, `positiveBigInt`, and `sendJsonRpcError`.
- [x] Split the selected warning-band helpers/tests while preserving test intent and production behavior.
- [x] Run focused tests, Go/script validation where applicable, lizard, coverage, and quality guardrails.
- [x] Open PR #42 and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Batch 43 Review

Plan:

- Treat this as an aggressive final-warning batch, but avoid cross-file abstractions unless they already exist locally.
- Keep test refactors inside their owning test files or colocated test helpers so assertion coverage remains readable.
- Split the four production helpers with narrow local parsing/formatting helpers and keep public exports/routes unchanged.
- Verify focused lizard on all 16 target files before broader coverage/quality checks.

Verification so far:

- Batch 42 PR #41 merged to `main` as `b70603bf Refactor agent funding path complexity (#41)`.
- Batch 42 PR checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick Backend, Quick Backend Integration Smoke, Quick E2E Smoke, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` stayed skipped as intended on PR.
- Batch 42 post-merge `main` backstop passed: `Build Dev Images` `24698998175`, `Install Tests` `24698998177`, `Release` `24698998173`, and `Test Suite` `24698998182`.
- `Test Suite` `24698998182` passed with `Full Backend Tests`, `Full Gateway Tests`, `Full Frontend Tests`, `Full Build Check`, `Full E2E Tests`, and `Full Test Summary`.
- Broad lizard on `main` confirms 16 warnings remain after Batch 42.
- Split Batch 43 production/script helpers in `go-verify.go`, Telegram draft notifications, agent-monitoring destination/threshold helpers, and MCP transport JSON-RPC error handling while preserving public behavior.
- Split Batch 43 test registration callbacks for websocket contracts, hardware wallet, send transaction context, user context, layout branch coverage, NodeConfig second-pass coverage, animated fee rate, and settings interactions while preserving assertions.
- Focused frontend tests passed: `npx vitest run tests/hooks/useWebSocket.test.tsx tests/hooks/useHardwareWallet.test.tsx tests/contexts/send/SendTransactionContext.test.tsx tests/contexts/UserContext.test.tsx tests/components/Layout.branches.test.tsx tests/components/NodeConfig.secondpass.test.tsx tests/components/Dashboard/AnimatedFeeRate.test.tsx tests/components/Settings.interactions.test.tsx` (8 files, 202 tests).
- Focused server tests passed: `npx vitest run tests/unit/services/telegram/telegramService.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/mcp/transport.test.ts` (47 tests) and `npx vitest run tests/unit/services/agentMonitoringService.test.ts` (14 tests after adding non-positive threshold branch coverage).
- `npm run typecheck:app`, `npm run typecheck:tests`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,593 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` passed after the added agent-monitoring threshold test: 391 passed files, 22 skipped; 9,156 passed tests, 503 skipped; 100% statements/branches/functions/lines.
- Focused and broad lizard passed; broad `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w .` now reports 0 warnings.
- `npx --yes jscpd@4 .` passed at 1.95% duplication with 272 clones and 5,213 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, gitleaks direct, latest-commit, and tracked-tree scans passed.
- Go verifier compile/runtime validation could not run locally because `go` is not installed in this environment.
- PR #42 merged to `main` as `461240a1 Clear remaining lizard warnings (#42)`.
- PR #42 required checks passed before merge: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick Backend, Quick Backend Integration Smoke, Quick E2E Smoke, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, vector verification, and Docker builds. `Full Test Summary` stayed skipped as intended on the PR path.
- Post-merge `main` backstop passed: `Build Dev Images` `24700593317`, `Install Tests` `24700593305`, `Release` `24700593298`, and `Test Suite` `24700593316`.
- `Test Suite` `24700593316` passed with `Full Backend Tests`, `Full Gateway Tests`, `Full Frontend Tests`, `Full Build Check`, `Full E2E Tests`, and `Full Test Summary`.
- The lizard cleanup loop is complete: broad lizard on `main` now reports 0 warnings.

Edge case and self-review notes:

- Preserve exact websocket event payload expectations, invalid-message branches, query invalidation contracts, and hook cleanup assertions.
- Preserve hardware wallet adapter/runtime mocks, send reducer transitions, user-session/auth refresh expectations, and UI branch assertions.
- Preserve Telegram notification draft formatting and fallback behavior.
- Preserve address normalization boundary behavior for BIP21/invalid/empty inputs and bigint coercion for string/number/null-ish values.
- Preserve MCP JSON-RPC error codes, ids, headers, and serialization failure handling.

# Previous Task: Lizard Batch 42 - Agent Funding Paths

Status: complete

Goal: reduce the remaining agent-domain lizard findings by splitting the owner override modal shell, agent creation input mapping, funding-attempt persistence payload builders, and agent draft attempt parsing while preserving public imports, create/update agent behavior, funding-attempt recording, override modal validation/loading/revoke flows, and existing admin/agent route behavior.

## Batch 42 Checklist

- [x] Confirm Batch 41 PR #40 post-merge `main` backstop is green, including test suite run `24696874602`.
- [x] Confirm grouped targets: `AgentOverridesModal` at 19 CCN, `createWalletAgent` at 25 CCN, `createAgent` at 32 CCN, `buildAgentAlertCreateData` at 21 CCN, `createFundingAttempt` at 23 CCN, and `parseOptionalAttemptAmount` at 23 CCN.
- [x] Split the selected agent-management modules/helpers while preserving UI callbacks and service/repository behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open PR #41 and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Batch 42 Review

Plan:

- Keep `components/AgentManagement/AgentOverridesModal.tsx`, `server/src/services/adminAgentService.ts`, `server/src/repositories/agentRepository.ts`, and `server/src/services/agentApiService.ts` as the public module entry points.
- Move override modal form actions/history rendering, agent-create payload assembly, alert/funding-attempt data builders, and amount parsing branches into focused local helpers without changing call sites.
- Keep this batch inside the agent-management domain rather than mixing in unrelated MCP or Telegram warnings.
- Reuse existing coverage in `tests/components/AgentManagement.test.tsx`, `server/tests/unit/services/adminAgentService.test.ts`, `server/tests/unit/repositories/agentRepository.test.ts`, and `server/tests/unit/api/agent-routes.test.ts`; add focused tests only where the extractions expose uncovered branches.

Verification so far:

- Batch 41 PR #40 merged to `main` as `0d0b6807 Refactor admin and account UI complexity (#40)`.
- Batch 41 post-merge `main` backstop passed: `Build Dev Images` `24696874596`, `Install Tests` `24696874601`, `Release` `24696874613`, and `Test Suite` `24696874602`.
- `Test Suite` `24696874602` passed with `Full Backend Tests`, `Full Gateway Tests`, `Full Frontend Tests`, `Full Build Check`, `Full E2E Tests`, and `Full Test Summary`.
- Focused lizard confirms the current Batch 42 warning set: `AgentOverridesModal` 19 CCN, `createWalletAgent` 25 CCN, `createAgent` 32 CCN, `buildAgentAlertCreateData` 21 CCN, `createFundingAttempt` 23 CCN, and `parseOptionalAttemptAmount` 23 CCN.
- Existing direct/focused coverage already exercises the agent-management domain enough to keep this batch aggressive without mixing in unrelated files.
- Split `AgentOverridesModal` into a state hook plus focused form/history/loading helpers while keeping the public modal shell, validation behavior, submit/reload flow, and revoke actions intact.
- Extracted local create-agent/input/data-builder helpers in `adminAgentService`, `agentRepository`, and `agentApiService` so agent creation, alert persistence, funding-attempt writes, and amount/reason parsing stay behaviorally stable with lower per-function CCN.
- Added targeted backend assertions in `server/tests/unit/services/adminAgentService.test.ts`, `server/tests/unit/repositories/agentRepository.test.ts`, and the new `server/tests/unit/services/agentApiService.test.ts` to cover the extracted mapping/default branches.
- Focused tests passed: `npx vitest run tests/components/AgentManagement.test.tsx tests/components/coverageFallbacks.test.tsx` (21 tests) and `cd server && npx vitest run tests/unit/services/agentApiService.test.ts tests/unit/services/adminAgentService.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/agent-routes.test.ts` (40 tests).
- Focused lizard passed for `components/AgentManagement/AgentOverridesModal.tsx`, `server/src/services/adminAgentService.ts`, `server/src/repositories/agentRepository.ts`, and `server/src/services/agentApiService.ts`; broad lizard now reports 16 warnings, down from 22, and the Batch 42 targets are gone from the warning list.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint`, `npm run test:coverage`, and `npm run test:backend:coverage` all passed; both app and backend coverage remain at 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` passed at 1.95% duplication with 272 clones and 5,213 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner`, `.tmp/quality-tools/gitleaks-8.30.1/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1`, and the tracked-tree gitleaks scan all passed.
- PR #41 merged to `main` as `b70603bf Refactor agent funding path complexity (#41)`.
- PR #41 required checks passed before merge: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick Backend, Quick Backend Integration Smoke, Quick E2E Smoke, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` stayed skipped as intended on the PR path.
- Post-merge `main` backstop passed: `Build Dev Images` `24698998175`, `Install Tests` `24698998177`, `Release` `24698998173`, and `Test Suite` `24698998182`.
- `Test Suite` `24698998182` passed with `Full Backend Tests`, `Full Gateway Tests`, `Full Frontend Tests`, `Full Build Check`, `Full E2E Tests`, and `Full Test Summary`.

Edge case and self-review notes:

- Preserve override create validation, busy-state handling, reload-on-success behavior, revoke confirmation, and active/used/revoked/expired status derivation.
- Preserve trimmed-name/default policy mapping for agent creation and the existing revoked-at behavior split between create and update paths.
- Preserve null/default handling for alert and funding-attempt payload writes, including optional request metadata and bigint/string parsing behavior.
- Keep route-observable behavior intact for agent funding attempts and admin agent flows; prefer helper extraction over API changes.

# Previous Task: Lizard UI Batch 41 - Admin And Account UI

Status: complete

Goal: reduce six independent admin/account UI lizard findings by splitting audit log shell/detail rendering, password form field/alert rendering, two-factor status/action cards, access-control settings sections, and feature-flag list/audit rendering while preserving public import paths, audit filter/query behavior, modal close/detail/fallback rendering, password visibility and validation messaging, 2FA enable/disable/backup-code actions, access-control optimistic save feedback and cleanup, feature-flag toggle/reset success handling, and audit-history expand/collapse behavior.

## Lizard UI Batch 41 Checklist

- [x] Confirm Batch 40 PR #39 post-merge `main` backstop is green, including test suite run `24695771236`.
- [x] Confirm grouped targets: `AuditLogs` at 17 CCN, `LogDetailModal` at 17 CCN, `PasswordForm` at 19 CCN, `TwoFactorSection` at 21 CCN, `AccessControlTab` at 17 CCN, and `FeatureFlags` at 19 CCN.
- [x] Split the selected admin/account UI modules into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open PR #40 and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 41 Review

Plan:

- Keep `components/AuditLogs/AuditLogs.tsx`, `components/AuditLogs/LogDetailModal.tsx`, `components/Account/PasswordForm.tsx`, `components/Account/TwoFactorSection.tsx`, `components/SystemSettings/AccessControlTab.tsx`, and `components/FeatureFlags/index.tsx` as the public exports.
- Move audit query/filter assembly, audit header/action controls, modal info/status/detail sections, password field chrome and inline alerts, two-factor status/backup-code cards, access-control status/save-feedback sections, and feature-flag rows/audit-history rendering into focused colocated helpers.
- Treat this as an aggressive but still coherent admin/settings batch: the targets are all UI-only and already have direct or owning-component tests, while `AgentOverridesModal` is intentionally deferred because it lacks a focused branch suite today.
- Preserve focused tests: `tests/components/AuditLogs.test.tsx`, `tests/components/AuditLogs.branches.test.tsx`, `tests/components/AuditLogs/LogDetailModal.branches.test.tsx`, `tests/components/Account.test.tsx`, `tests/components/Account.branches.test.tsx`, `tests/components/Account/PasswordForm.branches.test.tsx`, `tests/components/SystemSettings/AccessControlTab.branches.test.tsx`, and `tests/components/FeatureFlags.test.tsx`; add direct `TwoFactorSection` coverage only if the extraction exposes untested enabled/disabled/loading/error boundaries.
- Verify focused lizard against the six public files and any extracted helper directories before running broader guardrails.

Verification so far:

- Batch 40 PR #39 merged as `027ae304`; `Build Dev Images` run `24695771226`, `Release` run `24695771246`, and `Install Tests` run `24695771257` passed on `main`.
- Batch 40 `Test Suite` run `24695771236` passed on `main`, including `Full Backend Tests`, `Full Gateway Tests`, `Full Frontend Tests`, `Full Build Check`, `Full E2E Tests`, and `Full Test Summary`.
- PR #40 merged to `main` as `0d0b6807 Refactor admin and account UI complexity (#40)`.
- PR #40 required checks passed before merge: `PR Required Checks`, `Code Quality Required Checks`, `Quick Frontend Tests`, `Quick E2E Smoke`, `Quick Test Hygiene`, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` stayed skipped as intended on the PR path.
- Post-merge `main` backstop passed: `Build Dev Images` `24696874596`, `Install Tests` `24696874601`, `Release` `24696874613`, and `Test Suite` `24696874602`.
- `Test Suite` `24696874602` passed with `Full Backend Tests`, `Full Gateway Tests`, `Full Frontend Tests`, `Full Build Check`, `Full E2E Tests`, and `Full Test Summary`.
- Confirmed strong existing coverage for the grouped batch in `AuditLogs`, `Account`, `AccessControlTab`, and `FeatureFlags`; `TwoFactorSection` can pick up a direct branch test if helper extraction creates uncovered state combinations.
- `AgentOverridesModal` remains a good next-batch candidate, but it is deliberately excluded here because it currently only has fallback coverage via `tests/components/coverageFallbacks.test.tsx`.
- Split `AuditLogs`, `LogDetailModal`, `PasswordForm`, `TwoFactorSection`, `AccessControlTab`, and `FeatureFlags` into smaller local/grouped helpers while preserving public import paths and behavior.
- Focused UI tests passed: `npx vitest run tests/components/AuditLogs.test.tsx tests/components/AuditLogs.branches.test.tsx tests/components/AuditLogs/LogDetailModal.branches.test.tsx tests/components/Account.test.tsx tests/components/Account.branches.test.tsx tests/components/Account/PasswordForm.branches.test.tsx tests/components/SystemSettings/AccessControlTab.branches.test.tsx tests/components/FeatureFlags.test.tsx` passed with 81 tests.
- Focused lizard passed for the six public files plus the new feature-flag helper files.
- `npm run typecheck:app`, `npm run typecheck:tests`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,593 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 22 warnings; `AuditLogs`, `LogDetailModal`, `PasswordForm`, `TwoFactorSection`, `AccessControlTab`, and `FeatureFlags` are no longer in the warning list.
- `npx --yes jscpd@4 .` passed at 1.96% duplication, 273 clones, and 5,225 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, and gitleaks direct plus tracked-tree scans passed.

Edge case and self-review notes:

- Keep audit filters omitting empty values while preserving page reset and filter-count badge behavior.
- Preserve audit detail fallbacks for missing `userId`, `ipAddress`, `details`, `errorMsg`, and `userAgent`, including unknown-category badge styling.
- Keep password field visibility toggles, success/disable submit behavior, and inline validation/error/success messaging unchanged.
- Preserve 2FA loading/error state transitions, enabled/disabled action labels, and backup-code regeneration affordances.
- Maintain access-control save timeout replacement and cleanup-on-unmount semantics.
- Keep feature-flag success timeout replacement, audit-history collapse behavior, side-effect warnings, and non-system modifier metadata intact.

# Previous Task: Lizard UI Batch 40 - Wallet Dashboard Renderers

Status: complete

Goal: reduce five independent wallet/dashboard UI lizard findings by splitting wallet table cell renderers, dashboard wallet distribution/table rendering, mempool header/state rendering, wallet autopilot settings/status sections, and animated-background module loading helpers while preserving public import paths, wallet navigation, hover highlighting, sync/status labels and tooltips, mempool refresh/WebSocket status behavior, testnet/signet empty-state routing, autopilot load/save/error/notification gating, animation lazy-loading cancellation, and canvas visibility semantics.

## Lizard UI Batch 40 Checklist

- [x] Start from updated `main` after Batch 39 PR and post-merge full lane are green.
- [x] Confirm grouped targets: `WalletCells` at 25 CCN, `WalletSummary` at 17 CCN, `MempoolSection` at 17 CCN, `WalletAutopilotSettings` at 19 CCN, and `AnimatedBackground` at 19 CCN.
- [x] Split the selected wallet/dashboard renderers into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 40 Review

Plan:

- Keep `components/cells/WalletCells.tsx`, `components/Dashboard/WalletSummary.tsx`, `components/Dashboard/MempoolSection.tsx`, `components/WalletDetail/WalletAutopilotSettings.tsx`, and `components/AnimatedBackground.tsx` as the public exports.
- Move wallet cell badge/sync/pending/balance render helpers, wallet summary distribution-bar/table rows, mempool header/non-mainnet state, autopilot cards/number fields/status rows, and animated-background pattern import resolution into focused colocated helpers.
- Treat this as aggressive but bounded: all five targets are UI render/model extractions with existing focused tests, and no server/test-contract warning is mixed into this PR.
- Preserve focused tests: `tests/components/cells/WalletCells.test.tsx`, `tests/components/Dashboard/WalletSummary.test.tsx`, `tests/components/Dashboard/MempoolSection.test.tsx`, `tests/components/WalletDetail/WalletAutopilotSettings.test.tsx`, `tests/components/AnimatedBackground.test.tsx`, and `tests/components/AnimatedBackground.lazyLoading.test.tsx`; add assertions only if extraction exposes untested empty, zero, fallback, failure, or cancellation boundaries.
- Verify focused lizard against the five public files and any extracted helper directories before running broader guardrails.

Verification so far:

- Split `WalletCells` into identity, sync, pending/balance, and shared type helpers; `WalletCells.tsx` remains the public renderer factory.
- Split `WalletSummary` into distribution bar, tooltip, row, sync-status, and table helpers while preserving wallet navigation and hover highlighting.
- Split `MempoolSection` into header/status/content helpers while preserving refresh behavior, WebSocket state labels, and non-mainnet configure-node routing.
- Split `WalletAutopilotSettings` into loading/unavailable cards, settings card sections, health status card rows, and a controller hook while preserving load/save/error/success and notification gating.
- Split `AnimatedBackground` lazy module path/hook lookup and async hook loading into colocated helpers while preserving stale-hook clearing, cancellation, null-pattern rendering, and canvas runner behavior.
- Added a wallet balance assertion for absent and zero pending deltas so the extracted `PendingBalanceDelta` and `PendingFiatDelta` early returns remain covered.
- Focused UI tests passed: `npx vitest run tests/components/cells/WalletCells.test.tsx tests/components/Dashboard/WalletSummary.test.tsx tests/components/Dashboard/MempoolSection.test.tsx tests/components/WalletDetail/WalletAutopilotSettings.test.tsx tests/components/AnimatedBackground.test.tsx tests/components/AnimatedBackground.lazyLoading.test.tsx` passed with 112 tests after the added wallet-cell assertion.
- Focused lizard passed for the five public files and extracted helper directories.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,593 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 28 warnings; `WalletCells`, `WalletSummary`, `MempoolSection`, `WalletAutopilotSettings`, and `AnimatedBackground` are no longer in the warning list.
- `npx --yes jscpd@4 .` passed at 1.97% duplication, 274 clones, and 5,237 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, tracked-tree gitleaks detect, and `git diff --check` passed.
- PR #39 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on the PR.
- PR #39 merged as `027ae304`; the post-merge `main` backstop passed release `24695771246`, dev image build `24695771226`, install tests `24695771257`, and test suite `24695771236`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Wallet cell pending display still renders the em dash when pending data is absent, inbound/outbound icons are unchanged, and balance deltas now explicitly cover negative, positive, absent, and zero pending nets.
- Wallet summary still keeps empty wallet copy, distribution tooltips, selected-row hover classes, sync labels, fiat/network labels, and route construction unchanged.
- Mempool section still gates refresh by mainnet, keeps `Live`/`Connecting`/`Offline` copy, and routes non-mainnet configuration through `/settings/node`.
- Autopilot settings still treats 404/403 as feature unavailable, keeps status fetch optional, reverts optimistic saves on API error, and derives notification availability from configured and enabled Telegram preferences.
- Animated background still clears active animation hooks before loading a new pattern so React hook counts cannot mismatch, ignores stale async completions after cleanup, and renders no canvas for non-animated patterns.

# Previous Task: Lizard UI Batch 39 - UI Display And Settings Components

Status: complete

Goal: reduce several independent UI display/settings lizard findings in one more aggressive batch by splitting backup encryption-key reveal/copy rendering, WebSocket stats sections, notification sound settings sections, privacy badge summary rendering, and notification badge class derivation while preserving password reveal gating, copy/download callbacks, WebSocket loading/error/refresh behavior, channel/rate-limit grouping, sound preference updates and previews, badge accessibility, size/severity styling, score/warning summaries, and the public import paths.

## Lizard UI Batch 39 Checklist

- [x] Start from updated `main` after Batch 38 PR and post-merge full lane are green.
- [x] Confirm grouped targets: `EncryptionKeyDisplay` at 29 CCN, `WebSocketStatsCard` at 25 CCN, `NotificationSoundSettings` at 25 CCN, `PrivacyBadge` at 25 CCN, and `NotificationBadge` at 19 CCN.
- [x] Split the selected display/settings components into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 39 Review

Plan:

- Keep `components/BackupRestore/EncryptionKeyDisplay.tsx`, `components/SystemSettings/WebSocketStatsCard.tsx`, `components/Settings/sections/SoundSection.tsx`, `components/PrivacyBadge.tsx`, and `components/NotificationBadge.tsx` as the public exports.
- Move encryption key field/action/form rendering, WebSocket stat sections/channel grouping/rate-limit-event display, sound event rows and preference handlers, privacy badge/card/summary helper maps, and notification badge class/count helpers into local focused helpers.
- Treat this as a broad but low-coupling UI batch: avoid shared abstractions across unrelated components, and keep extracted helpers colocated with their owning component.
- Preserve focused tests: `tests/components/BackupRestore/EncryptionKeyDisplay.branches.test.tsx`, `tests/components/SystemSettings/WebSocketStatsCard.branches.test.tsx`, `tests/components/Settings/sections/SoundSection.branches.test.tsx`, `tests/components/PrivacyBadge.test.tsx`, and `tests/components/NotificationBadge.test.tsx`; add assertions only if extraction exposes untested empty, zero, missing event, or keyboard boundaries.
- Verify focused lizard against the five public files and extracted helper directories before running broader guardrails.

Verification so far:

- Batch 38 PR #37 merged as `f228eaf4`; the post-merge `main` backstop passed release `24692698891`, dev image build `24692698875`, install tests `24692698921`, and test suite `24692698918`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Split `EncryptionKeyDisplay`, `WebSocketStatsCard`, `NotificationSoundSettings`, `PrivacyBadge`, and `NotificationBadge` into smaller render/model helpers while preserving their public import paths. `WebSocketStatsCard` is now a 50-line public shell with 355 lines of colocated focused helpers.
- Added a WebSocket branch assertion for global-only channels and zero maximum connections so the extracted channel grouping and percentage guard stay covered.
- Focused UI tests passed: `npx vitest run tests/components/BackupRestore/EncryptionKeyDisplay.branches.test.tsx tests/components/SystemSettings/WebSocketStatsCard.branches.test.tsx tests/components/Settings/sections/SoundSection.branches.test.tsx tests/components/PrivacyBadge.test.tsx tests/components/NotificationBadge.test.tsx` passed before the added WebSocket branch; the updated WebSocket branch suite then passed separately with 6 tests.
- Focused lizard passed for the five public files and the extracted WebSocket helper directory.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,592 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 33 warnings; `EncryptionKeyDisplay`, `WebSocketStatsCard`, `NotificationSoundSettings`, `PrivacyBadge`, and `NotificationBadge` are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 1.98% duplication, 274 clones, and 5,237 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, grade-history JSONL parsing, and tracked-tree gitleaks detect passed.
- PR #38 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #38 merged as `3d7c9eb0`; the post-merge `main` backstop passed release `24694245917`, dev image build `24694245920`, install tests `24694245935`, and test suite `24694245918`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Encryption-key reveal still requires a non-blank password, clears the reveal password after submit, and keeps copy/download actions gated to revealed key values.
- WebSocket stats still preserve initial loading, error rendering, manual refresh, and polling behavior; a `max=0` connection budget now renders a 0% bar instead of dividing by zero, and null/undefined rate-limit user IDs are accepted.
- Sound preference updates preserve the existing enabled/master-enabled semantics, keep volume values numeric in update payloads, and only preview configured non-`none` sounds.
- Privacy badges preserve title derivation, size/grade styling, clickable keyboard activation via Enter/Space, score metrics, warnings, and recommendations.
- Notification badges preserve zero-count hiding, count capping, dot rendering, and severity/size class composition without expanding the public API.

# Previous Task: Lizard UI Batch 38 - Intelligence Tabs

Status: complete

Goal: reduce the paired Treasury Intelligence lizard findings by splitting wallet/page shell rendering, wallet selector/tab routing, insights filter/content rendering, severity grouping, and status-update helpers while preserving wallet loading/empty states, first-wallet auto-selection, dropdown open/close/outside-click behavior, selected-wallet switching, tab navigation, insight filter API payloads, loading/empty/data states, severity grouping order, status-update removal behavior, error logging, and the public `Intelligence` and `InsightsTab` import paths.

## Lizard UI Batch 38 Checklist

- [x] Start from updated `main` after Batch 37 PR and post-merge full lane are green.
- [x] Confirm grouped Intelligence targets: `Intelligence` at 25 CCN and `InsightsTab` at 28 CCN.
- [x] Split Intelligence shell and insights render/update branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 38 Review

Plan:

- Keep `components/Intelligence/Intelligence.tsx` and `components/Intelligence/tabs/InsightsTab.tsx` as the public exports.
- Move wallet loading/empty states, header/wallet selector, tab navigation/content routing, insight filter controls, grouped insight sections, severity labels/icons, and update-status handling into focused local helpers.
- Treat this as one bounded Intelligence surface: leave chat, settings, insight-card internals, API client behavior, and app capability routing for later unless type boundaries require small compatibility helpers.
- Preserve `tests/components/Intelligence.test.tsx`, `tests/components/Intelligence.tabs.test.tsx`, and `tests/components/IntelligenceTabs/insightsTab.contracts.tsx`; add focused assertions only if extraction exposes untested empty status-filter, unknown wallet, no-group, or update-failure boundaries.
- Verify focused lizard against the two public files, extracted helper directories, and focused tests before running broader guardrails.

Verification so far:

- Batch 37 PR #36 merged as `a8459854`; the post-merge `main` backstop passed test suite `24691694339`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh grouped lizard measurement from `main` reported `components/Intelligence/Intelligence.tsx:17` at 25 CCN and `components/Intelligence/tabs/InsightsTab.tsx:36` at 28 CCN.
- Reduced `Intelligence` to a 30-line public page shell and `InsightsTab` to a 24-line public tab shell.
- Moved wallet loading/empty states, wallet auto-selection, dropdown outside-click handling, header/wallet selector, tab navigation/content routing, insight filter option rendering, API filter payload assembly, severity grouping, severity header icons/labels, insight content loading/empty/data states, and update-status removal handling into focused local helpers.
- Preserved wallet loading/empty states, first-wallet auto-selection, dropdown open/close/outside-click behavior, selected-wallet switching, tab navigation, insight filter API payloads, loading/empty/data states, severity grouping order, status-update removal behavior, error logging, and the public `Intelligence` and `InsightsTab` import paths.
- Focused Intelligence tests passed: `npx vitest run tests/components/Intelligence.test.tsx tests/components/Intelligence.tabs.test.tsx` passed: 2 files, 85 tests.
- Focused lizard passed for the two public files and extracted helper directories.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,591 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 38 warnings; `Intelligence` and `InsightsTab` are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 1.99% duplication, 275 clones, and 5,260 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, and tracked-tree gitleaks detect passed.
- PR #37 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #37 merged as `f228eaf4`; the post-merge `main` backstop passed release `24692698891`, dev image build `24692698875`, install tests `24692698921`, and test suite `24692698918`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Wallet selection still only auto-selects when the current selected ID is empty, preserving the existing fallback to `Select wallet` if the selected wallet disappears.
- The wallet dropdown still closes from the document click listener only while open, and wallet item selection still closes the dropdown after updating the selected ID.
- Insight API filters still omit empty `status`, `type`, and `severity` values, while the default status remains `active`.
- Loading still wraps only the insight content area after filters render, and empty content still depends on the raw insight list rather than grouped sections.
- Dismiss and acted-on actions still remove the insight only after the API call succeeds; failures continue to log and leave the insight visible.

# Previous Task: Lizard UI Batch 37 - Send Wizard Signing Flow

Status: complete

Goal: reduce the related send-flow lizard findings by splitting send wizard draft initialization, review-step routing, sign/broadcast action branches, production signing-device row actions, and focused test doubles while preserving draft PSBT initialization, output/UTXO fallback data, review auto-create/reset behavior, single-sig broadcast paths, multisig sign-only behavior, save-draft gating, current-step rendering, signing method availability, upload/download/QR controls, loading labels, and the public `SendTransactionWizard` and `SigningFlow` import paths.

## Lizard UI Batch 37 Checklist

- [x] Start from updated `main` after Batch 36 PR and post-merge full lane are green.
- [x] Confirm grouped send-flow targets: `SendTransactionWizard` warnings at 21/23/22 CCN, production `SigningFlow` at 25 CCN, `ReviewStep.branches` test `SigningFlow` double at 19 CCN, and `SendTransactionPage.branches` test `SendTransactionWizard` double at 30 CCN.
- [x] Split send wizard/signing flow render and action branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 37 Review

Plan:

- Keep `components/send/SendTransactionWizard.tsx` and `components/send/steps/review/SigningFlow.tsx` as the public exports.
- Move draft transaction data derivation, review step prop assembly, sign/broadcast branch handling, wizard shell/header/error/navigation, signing row state/actions, and signing method controls into focused local helpers.
- Keep test-double refactors scoped to the two branch tests that lizard flags; avoid changing the production API to serve test structure.
- Preserve `tests/components/send/SendTransactionWizard.test.tsx`, `tests/components/send/SendTransactionWizard.branches.test.tsx`, `tests/components/send/SigningFlow.test.tsx`, `tests/components/send/ReviewStep.branches.test.tsx`, and `tests/components/send/SendTransactionPage.branches.test.tsx`; add focused assertions only if extraction exposes untested signed raw transaction, no txData, no signer, QR, airgap, or file-ref cleanup boundaries.
- Verify focused lizard against the two public files, extracted helper directories, and focused tests before running broader guardrails.

Verification so far:

- Reduced `SendTransactionWizard` to a 149-line public orchestrator shell and `SigningFlow` to a 50-line public signing list shell.
- Moved draft transaction data derivation, review reset/autocreate effects, single-sig sign/broadcast branch handling, multisig sign-only handling, save-draft handling, wizard shell/header/error/navigation, current-step rendering, signing device identity/status/method controls, USB sign action handling, QR controls, and airgap download/upload controls into focused local helpers.
- Reduced the two flagged branch-test doubles by moving device-upload/file-ref handling and send-wizard display value derivation into smaller test helpers while preserving the same assertions.
- Preserved draft PSBT initialization, output/UTXO fallback data, review auto-create/reset behavior, signed-raw-tx broadcast, create-before-sign fallback, connected hardware-wallet signing, uploaded signed-PSBT broadcast, multisig sign-only behavior, save-draft gating, step rendering, signing method availability, QR gating on unsigned PSBT, airgap file input refs, upload loading labels, and the public `SendTransactionWizard` and `SigningFlow` import paths.
- Focused send tests passed: `npx vitest run tests/components/send/SendTransactionWizard.test.tsx tests/components/send/SendTransactionWizard.branches.test.tsx tests/components/send/SigningFlow.test.tsx tests/components/send/ReviewStep.branches.test.tsx tests/components/send/SendTransactionPage.branches.test.tsx` passed: 5 files, 56 tests.
- Focused lizard passed for the two public files, extracted helper directories, and focused tests.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,591 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 40 warnings; `SendTransactionWizard`, production `SigningFlow`, and the two branch-test doubles are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 1.99% duplication, 275 clones, and 5,260 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, grade-history JSONL parsing, and tracked-tree gitleaks detect passed.
- PR #36 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #36 merged as `a8459854`; the post-merge `main` backstop passed release `24691694338`, dev image build `24691694374`, install tests `24691694340`, and test suite `24691694339`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Draft mode still requires `state.isDraftMode`, draft transaction data, and an unsigned PSBT before constructing initial transaction data.
- Draft UTXO fallback still keeps missing full UTXO data as empty address and zero amount; output parsing still falls back invalid or empty amounts to zero.
- Review-step navigation still resets created transaction data only when leaving review outside draft mode, and auto-create still stops when already creating, already created, errored, draft mode, or not ready to sign.
- Single-sig broadcast still prioritizes an existing signed raw transaction, then creates missing tx data, then connected hardware-wallet signing, then uploaded signed PSBT broadcast, and finally PSBT creation for external signing.
- Signing rows still show signed devices as complete, gate QR buttons on `unsignedPsbt`, disable USB while signing, clear signing device state in `finally`, and keep upload input refs keyed by device ID.

# Previous Task: Lizard UI Batch 36 - UTXO Send Controls

Status: complete

Goal: reduce the related UTXO/send lizard findings by splitting UTXO list state/header/privacy detail rendering, coin-control panel sections, and send UTXO row display branches while preserving selected amount/send behavior, explorer URL fallback/loading, fee-rate fallback dust calculations, privacy detail panel routing, selectable/frozen/locked guards, coin-control expand/select/clear/enable behavior, remaining-needed warning, spend privacy card gating, frozen/draft locked summaries, and the public `UTXOList`, `CoinControlPanel`, and `UtxoRow` import paths.

## Lizard UI Batch 36 Checklist

- [x] Start from updated `main` after Batch 35 PR and post-merge full lane are green.
- [x] Confirm grouped UTXO/send targets: `UTXOList` at 29 CCN, `CoinControlPanel` at 29 CCN, and send `UtxoRow` at 19 CCN.
- [x] Split UTXO list, coin-control, and send UTXO row render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 36 Review

Plan:

- Keep `components/UTXOList/UTXOList.tsx`, `components/send/steps/OutputsStep/CoinControlPanel.tsx`, and `components/send/steps/OutputsStep/UtxoRow.tsx` as the public exports.
- Move UTXO list header, selected-send derivation, privacy map/detail lookup, explorer URL loading, dust stats derivation, coin-control header/actions/available list/status sections, and send UTXO row amount/age/selection display into focused local helpers.
- Treat this as one bounded UTXO/send surface: leave `UTXORow` in the wallet UTXO list, `UTXOGarden`, `UTXOSummaryBanners`, `OutputsStep`, and transaction composition hooks for later unless type boundaries require small compatibility helpers.
- Preserve `tests/components/UTXOList.test.tsx`, `tests/components/UTXOList.branches.test.tsx`, `tests/components/send/CoinControlPanelOutputsStep.test.tsx`, and `tests/components/send/UtxoRow.branches.test.tsx`; add focused assertions only if extraction exposes untested empty, no-fiat, privacy-score, or over-two summary boundaries.
- Verify focused lizard against the three public files, extracted helper directories, and focused tests before running broader guardrails.

Verification so far:

- PR #34 merged as `c21d7969`; the post-merge `main` backstop passed release `24688783018`, dev image build `24688783027`, install tests `24688783061`, and test suite `24688783028`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh grouped lizard measurement from `main` (`c21d7969`) reported `components/UTXOList/UTXOList.tsx:44` at 29 CCN, `components/send/steps/OutputsStep/CoinControlPanel.tsx:52` at 29 CCN, and `components/send/steps/OutputsStep/UtxoRow.tsx:31` at 19 CCN.
- Reduced `UTXOList` to a 119-line public list shell, `CoinControlPanel` to a 73-line public panel shell, and send `UtxoRow` to a 55-line public row shell.
- Moved UTXO list header/count/send rendering, selected amount derivation, privacy map/detail lookup, explorer URL loading, dust stats derivation, coin-control header/actions/available list/status sections/privacy card gating/locked summaries, and send UTXO row amount/age/selection display into focused local helpers.
- Preserved selected amount/send behavior, explorer URL fallback/loading, fee-rate fallback dust calculations, privacy detail panel routing, selectable/frozen/locked guards, coin-control expand/select/clear/enable behavior, remaining-needed warning, spend privacy card gating, frozen/draft locked summaries, send row low-confirmation and aged display, privacy badge rendering, no-fiat suppression, and the public `UTXOList`, `CoinControlPanel`, and `UtxoRow` import paths.
- Focused UTXO/send tests passed: `npx vitest run tests/components/UTXOList.test.tsx tests/components/UTXOList.branches.test.tsx tests/components/send/CoinControlPanelOutputsStep.test.tsx tests/components/send/UtxoRow.branches.test.tsx` passed: 4 files, 30 tests.
- Focused lizard passed for the three public files, extracted helper directories, and focused tests.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,591 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 46 warnings, average CCN 1.3, max CCN 33; `UTXOList`, `CoinControlPanel`, and send `UtxoRow` are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 1.99% duplication, 275 clones, and 5,260 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, grade-history JSONL parsing, and tracked-tree gitleaks detect passed.
- PR #35 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #35 merged as `29f0f6ab`; the post-merge `main` backstop passed release `24690147814`, dev image build `24690147825`, install tests `24690147808`, and test suite `24690147777`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Empty UTXO arrays still show `0 UTXOs`, an empty available-list message inside coin control, and no privacy detail panel.
- Selected amount still derives only from selected IDs present in the current UTXO set, and the send button remains gated by selectable mode, selected count, and `onSendSelected`.
- Explorer URL loading still falls back to `https://mempool.space` and logs fetch failures without breaking rendering.
- Dust stats still exclude frozen and draft-locked UTXOs and use the hour fee rate fallback of `1 sat/vB`.
- Privacy detail rendering still requires both matching privacy data and a matching UTXO, and closing clears the selected detail ID.
- Coin-control warning/card sections remain gated by `showCoinControl`, positive remaining amount, selected count, and available privacy analysis.
- Frozen and draft-locked summaries still render only when populated, show the first two rows, and preserve the `+N more` copy for additional rows.
- Send UTXO rows still do not toggle when not selectable, show the lock icon for frozen non-selectable rows, and render low-confirmation versus aged branches independently of fiat availability.

# Previous Task: Lizard UI Batch 35 - Connect Device Flow

Status: complete

Goal: reduce the related ConnectDevice lizard findings by splitting the top-level connection flow rendering, USB connection state rendering, and conflict-dialog account summary/actions while preserving model selection, available-method routing, save/merge guards, QR parse branches, account selection toggles, save/merge payload paths, USB initial/error/scanning/success states, conflict-dialog merge/view/cancel behavior, conflict warnings, and the public `ConnectDevice`, `UsbConnectionPanel`, and `ConflictDialog` import paths.

## Lizard UI Batch 35 Checklist

- [x] Start from updated `main` after Batch 34 PR and post-merge full lane are green.
- [x] Confirm grouped ConnectDevice targets: `ConnectDevice` at 29 CCN, `UsbConnectionPanel` at 27 CCN, and `ConflictDialog` at 21 CCN.
- [x] Split connection flow, USB state, and conflict-dialog render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 35 Review

Plan:

- Keep `components/ConnectDevice/ConnectDevice.tsx`, `components/ConnectDevice/UsbConnectionPanel.tsx`, and `components/ConnectDevice/ConflictDialog.tsx` as the public exports.
- Move loading/back/header/layout sections, connection action routing, USB state panes, conflict account summary panes, and conflict action/error/warning rendering into focused local helpers.
- Treat this as one bounded ConnectDevice surface: leave `DeviceDetailsForm`, model selection internals, QR scanner internals, file upload internals, and `useDeviceForm` for later unless extraction requires small compatibility types.
- Preserve `tests/components/ConnectDevice.test.tsx`, `tests/components/ConnectDevice/ConnectDevice.branches.test.tsx`, `tests/components/ConnectDevice/UsbConnectionPanel.test.tsx`, and `tests/components/ConnectDevice/ConflictDialog.test.tsx`; add focused assertions only if extraction exposes untested zero-total USB progress, no-new-account, or conflict-only dialog boundaries.
- Verify focused lizard against the three public files, extracted helper directories, and focused tests before running broader guardrails.

Verification so far:

- PR #33 merged as `85efc7ff`; the post-merge `main` backstop passed release `24686884035`, dev image build `24686884048`, install tests `24686884041`, and test suite `24686884013`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh grouped lizard measurement from `main` (`85efc7ff`) reports `components/ConnectDevice/ConnectDevice.tsx:40` at 29 CCN, `components/ConnectDevice/UsbConnectionPanel.tsx:23` at 27 CCN, and `components/ConnectDevice/ConflictDialog.tsx:21` at 21 CCN.
- Reduced `ConnectDevice` to a 36-line public orchestrator shell, `UsbConnectionPanel` to a 42-line public USB state shell, and `ConflictDialog` to a 40-line public modal shell.
- Moved model/method layout rendering, connection action routing, loading/header UI, USB initial/error/scanning/success panes, progress percent clamping, conflict header/existing-device summary, account comparison sections, merge/view/cancel actions, error copy, and conflict warning copy into focused local helpers.
- Preserved model selection, available-method routing, save/merge guards, QR parse branches, account selection toggles, save/merge payload paths, USB initial/error/scanning/success behavior, conflict-dialog merge/view/cancel callbacks, conflict warnings, required public import paths, and conflict-device navigation.
- Added a focused USB progress assertion for the zero-total boundary so malformed progress cannot render `Infinity%`.
- Focused ConnectDevice tests passed: `npx vitest run tests/components/ConnectDevice.test.tsx tests/components/ConnectDevice/ConnectDevice.branches.test.tsx tests/components/ConnectDevice/UsbConnectionPanel.test.tsx tests/components/ConnectDevice/ConflictDialog.test.tsx` passed: 4 files, 41 tests.
- Focused lizard passed for the three public files, extracted helper directories, and focused tests.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,591 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 49 warnings, average CCN 1.3, max CCN 33; `ConnectDevice`, `UsbConnectionPanel`, and `ConflictDialog` are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 2.01% duplication, 276 clones, and 5,289 duplicated lines.
- `node scripts/quality/check-large-files.mjs` passed.
- PR #34 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #34 merged as `c21d7969`; the post-merge `main` backstop passed release `24688783018`, dev image build `24688783027`, install tests `24688783061`, and test suite `24688783028`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Loading state still short-circuits the shell before model, method, details, or conflict UI render.
- Connection method routing remains explicit for USB, SD card, QR code, and manual modes; selected-model and method guards still suppress method/action panels until prerequisites exist.
- QR scanner props still receive the current secure-context value, camera toggles, scanner callbacks, file upload handler, and stop-camera callback.
- USB state flags preserve the original overlapping-state behavior: scanning can render while scanned state is true, and success still requires `scanned` with no error.
- USB progress now clamps zero or negative totals to `0%` and normal progress keeps the existing percentage behavior.
- Conflict dialog still hides merge when there are no new accounts, disables merge while merging or conflicting accounts exist, shows API errors independently, and keeps the conflict warning visible for conflicting accounts.

# Previous Task: Lizard UI Batch 34 - Configurable Table Controls

Status: complete

Goal: reduce the shared table lizard findings by splitting table column derivation/header/body rendering and column configuration dropdown state/panel pieces while preserving dynamic column ordering and visibility, sortable header behavior and indicators, custom cell renderers, row click behavior, empty-table copy, dropdown open/close behavior, outside-click/Escape dismissal, drag reorder callbacks, visibility toggles, reset disabled/enabled state, and the public `ConfigurableTable` and `ColumnConfigButton` import paths.

## Lizard UI Batch 34 Checklist

- [x] Start from updated `main` after Batch 33 PR and post-merge full lane are green.
- [x] Confirm grouped shared-table targets: `ConfigurableTable` at 30 CCN and `ColumnConfigButton` at 21 CCN.
- [x] Split table and column-config render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 34 Review

Plan:

- Keep `components/ui/ConfigurableTable.tsx` and `components/ui/ColumnConfigButton.tsx` as the public exports.
- Move ordered-column derivation, alignment classes, empty state, sortable header/icon rendering, table body rows/cells, dropdown lifecycle hooks, trigger rendering, draggable column list, and reset action rendering into focused local helpers.
- Treat this as one bounded shared-table surface: leave `FeatureTable`, wallet/device list integrations, and column cell renderers for later unless type or test boundaries require small compatibility updates.
- Preserve `tests/components/ui/ConfigurableTable.test.tsx` and `tests/components/ui/ColumnConfigButton.test.tsx`; add focused assertions only if extraction exposes untested unknown-column, missing-renderer, sortable-without-callback, or reset-state boundaries.
- Verify focused lizard against the two public files, extracted helper directories, and focused tests before running broader guardrails.

Verification:

- PR #32 merged as `90d57672`; the post-merge `main` backstop passed release `24685643366`, dev image build `24685643327`, install tests `24685643382`, and test suite `24685643340`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh grouped lizard measurement from `main` (`90d57672`) reported `components/ui/ConfigurableTable.tsx:34` at 30 CCN and `components/ui/ColumnConfigButton.tsx:50` at 21 CCN.
- Reduced `ConfigurableTable` to a 71-line public table shell and `ColumnConfigButton` to a 60-line public dropdown shell.
- Moved ordered-column derivation, alignment classes, empty state, sortable header/icon rendering, table body rows/cells, dropdown dismissal effects, trigger rendering, drag reorder handling, draggable column list rendering, and reset action rendering into focused local helpers.
- Preserved dynamic column ordering and visibility, sortable header callbacks and indicators, custom cell renderers, missing-renderer empty cells, row click behavior, empty-table copy, dropdown open/close behavior, outside-click/Escape dismissal, drag reorder callbacks, visibility toggles, reset disabled/enabled state, required public import paths, and `CellRendererProps` re-export compatibility.
- Focused shared-table tests passed: `npx vitest run tests/components/ui/ConfigurableTable.test.tsx tests/components/ui/ColumnConfigButton.test.tsx` passed: 2 files, 15 tests.
- Focused lizard passed for the two public files, extracted helper directories, and focused tests.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,590 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 52 warnings, average CCN 1.3, max CCN 33; `ConfigurableTable` and `ColumnConfigButton` are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 2.01% duplication, 276 clones, and 5,289 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, grade-history JSONL parsing, and tracked-tree gitleaks detect passed.
- PR #33 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #33 merged as `85efc7ff`; the post-merge `main` backstop passed release `24686884035`, dev image build `24686884048`, install tests `24686884041`, and test suite `24686884013`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Empty data still returns only the empty message shell and avoids header/body rendering.
- Unknown ordered column IDs remain filtered out for both table rendering and column config rendering.
- Missing cell renderers still render empty table cells rather than throwing.
- Sort callbacks remain guarded by `sortable`, `sortKey`, and `onSort`; active ascending/descending and inactive sort indicators remain covered.
- Dropdown dismissal remains active only while open, closes on outside mousedown and Escape, and ignores non-Escape keys and inside clicks.
- Drag reorder still no-ops for missing or unchanged targets and emits reordered column IDs for valid drags.
- Reset disabled state still compares ordered columns exactly and visible columns as an unordered set.

# Previous Task: Lizard UI Batch 33 - Wallet Detail Tabs

Status: complete

Goal: reduce the related `WalletDetail` lizard findings by splitting sync-log filtering/rendering, transactions-tab header/filter/summary/load-more rendering, and modal gating helpers while preserving log auto-scroll behavior, level/module/Tor display, sync/full-resync/pause/clear controls, AI query callbacks and aggregation copy, transaction export/load-more behavior, transaction stats suppression when filtered, modal visibility guards, and the public `LogTab`, `TransactionsTab`, and `WalletDetailModals` import paths.

## Lizard UI Batch 33 Checklist

- [x] Start from updated `main` after Batch 32 PR and post-merge full lane are green.
- [x] Confirm grouped WalletDetail targets: `LogTab` at 31 CCN, `TransactionsTab` at 27 CCN, and `WalletDetailModals` at 21 CCN.
- [x] Split WalletDetail tab/modal render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 33 Review

Plan:

- Keep `components/WalletDetail/LogTab.tsx`, `components/WalletDetail/tabs/TransactionsTab.tsx`, and `components/WalletDetail/WalletDetailModals.tsx` as the public exports.
- Move log-level filtering, controls, content states, log row badges/details, transaction tab header/filter summary/load-more rendering, and modal visibility guards into focused local helpers.
- Treat this as one bounded WalletDetail surface: leave `WalletDetailLoadedView`, transaction list internals, export modal internals, websocket hooks, and unrelated WalletDetail settings for later batches.
- Preserve `tests/components/WalletDetail/LogTab.test.tsx`, `tests/components/WalletDetail/LogTab.branches.test.tsx`, `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx`, and `tests/components/WalletDetail/WalletDetailModals.test.tsx`; add focused assertions only if extraction exposes untested behavior boundaries.
- Verify focused lizard against the three public files, extracted helper directories, and focused tests before running broader guardrails.

Verification so far:

- PR #31 merged as `3940e3fb`; the post-merge `main` backstop passed release `24684018341`, dev image build `24684018256`, install tests `24684018302`, and test suite `24684018271`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh grouped lizard measurement from `main` (`3940e3fb`) reports `components/WalletDetail/LogTab.tsx:31` at 31 CCN, `components/WalletDetail/tabs/TransactionsTab.tsx:78` at 27 CCN, and `components/WalletDetail/WalletDetailModals.tsx:94` at 21 CCN.
- Reduced `LogTab` to an 82-line public sync-log shell, `TransactionsTab` to a 99-line transaction tab shell, and `WalletDetailModals` to a 103-line modal mount shell.
- Moved log filtering, controls, content states, row badge/detail rendering, transaction header/filter/AI summary/load-more rendering, transaction stats suppression, and modal visibility guards into focused local helpers.
- Preserved log auto-scroll and scroll-position toggle behavior, level/module/Tor display, sync/full-resync/pause/clear callbacks, AI query callbacks and aggregation copy, export/load-more behavior, transaction stats suppression for AI/manual filters, modal wallet-id guards, and the public `LogTab`, `TransactionsTab`, and `WalletDetailModals` import paths.
- Added focused transaction-tab assertions for aggregation results without an aggregation label, no-transaction export/filter/pagination suppression, and no-more pagination suppression.
- Focused WalletDetail tests passed: `npx vitest run tests/components/WalletDetail/LogTab.test.tsx tests/components/WalletDetail/LogTab.branches.test.tsx tests/components/WalletDetail/tabs/TransactionsTab.test.tsx tests/components/WalletDetail/WalletDetailModals.test.tsx` passed: 4 files, 25 tests.
- Focused lizard passed for the three public files, extracted helper directories, and focused tests.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 401 files, 5,590 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 54 warnings, average CCN 1.3, max CCN 33; `LogTab`, `TransactionsTab`, and `WalletDetailModals` are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 2.02% duplication, 277 clones, and 5,300 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, and tracked-tree gitleaks detect passed.
- PR #32 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #32 merged as `90d57672`; the post-merge `main` backstop passed release `24685643366`, dev image build `24685643327`, install tests `24685643382`, and test suite `24685643340`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Empty log state, loading log state, filtered log row rendering, pause/sync disabled states, auto-scroll checkbox/scroll-position transitions, and details without `viaTor` display remain covered by focused tests.
- Empty transactions now explicitly suppress export, filter bar, and load-more controls; `hasMoreTx=false` suppresses pagination even when transactions exist.
- AI aggregation summary boundaries are covered for count, non-count sats formatting, null aggregation labels, and no aggregation result fallback copy.
- Modal visibility remains wallet-id guarded for wallet-bound modals, while address QR, device-share prompt, and delete confirmation retain their original non-wallet-id guards.

# Previous Task: Lizard UI Batch 32 - Device Account Import

Status: complete

Goal: reduce the related `DeviceDetail` account import lizard findings by splitting manual derivation-path form logic, add-account modal method routing, and QR import camera/file states while preserving account purpose/script path defaults, manual field updates, submit disabled/loading behavior, import method selection, close/back reset behavior, parsed-account review routing, USB/SD/QR/manual flows, QR mode toggles, camera retry/stop behavior, animated-QR progress display, file upload parsing state, scanner props, and the public `ManualAccountForm`, `AddAccountFlow`, and `QrImport` import paths.

## Lizard UI Batch 32 Checklist

- [x] Start from updated `main` after Batch 31 PR and post-merge full lane are green.
- [x] Confirm grouped account import targets: `ManualAccountForm` at 31 CCN, `AddAccountFlow` at 23 CCN, and `QrImport` at 21 CCN.
- [x] Split account import render/state branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 32 Review

Plan:

- Keep `components/DeviceDetail/ManualAccountForm.tsx`, `components/DeviceDetail/accounts/AddAccountFlow.tsx`, and `components/DeviceDetail/accounts/QrImport.tsx` as the public exports.
- Move derivation-path selection, manual form fields/actions, add-account method option rendering, modal header/back/error controls, and QR camera/file panes into focused local helpers.
- Treat this as one bounded DeviceDetail account-import surface, not a broader hardware-wallet import refactor: leave hook internals, parser behavior, review-table behavior, and unrelated DeviceDetail panels for later batches.
- Preserve `tests/components/DeviceDetail/ManualAccountForm.test.tsx`, `tests/components/DeviceDetail/accounts/AddAccountFlow.branches.test.tsx`, `tests/components/DeviceDetail/accounts/AddAccountFlow.fallback.test.tsx`, `tests/components/DeviceDetail/accounts/AddAccountFlow.lazyHardwareImport.test.tsx`, and `tests/components/DeviceDetail/accounts/QrImport.test.tsx`; add direct helper tests only if extraction exposes untested path, reset, or camera/file boundaries.
- Verify focused lizard against the three public files, extracted helper directories, and focused tests before running the broader guardrails.

Verification so far:

- PR #30 merged as `fcdaa7dd`; the post-merge `main` backstop passed release `24682333934`, dev image build `24682333936`, install tests `24682333926`, and test suite `24682333935`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh grouped lizard measurement from `main` (`fcdaa7dd`) reports `components/DeviceDetail/ManualAccountForm.tsx:30` at 31 CCN, `components/DeviceDetail/accounts/AddAccountFlow.tsx:12` at 23 CCN, and `components/DeviceDetail/accounts/QrImport.tsx:38` at 21 CCN.
- Reduced `ManualAccountForm` to a 64-line public form shell, `AddAccountFlow` to a 50-line modal-flow shell, and `QrImport` to a 62-line QR shell.
- Moved derivation-path defaults into map-backed helpers, manual form fields/actions into focused components, add-account modal chrome/method picker/method panel into local helpers, and QR camera/file states into local helpers.
- Extracted a shared `components/qr/QrScannerFrame.tsx` for the scanner viewport and stop-camera control used by both device account import and wallet import QR flows, removing the new QR scanner duplication found during self-review.
- Preserved account purpose/script path defaults, manual derivation/xpub updates, submit disabled/loading behavior, USB/SD/QR/manual method selection, close/back reset behavior, parsed-account review precedence, QR mode toggles, camera start/retry/stop behavior, decoder ref reset, animated-QR progress display, file upload parsing state, scanner props, and the public `ManualAccountForm`, `AddAccountFlow`, and `QrImport` import paths.
- Added branch assertions for hidden USB options on insecure/unsupported devices, QR mode state cleanup, idle insecure-camera warning, retry behavior, and stop-camera decoder reset.
- Focused account-import tests passed: `npx vitest run tests/components/DeviceDetail/ManualAccountForm.test.tsx tests/components/DeviceDetail/accounts/AddAccountFlow.branches.test.tsx tests/components/DeviceDetail/accounts/AddAccountFlow.fallback.test.tsx tests/components/DeviceDetail/accounts/AddAccountFlow.lazyHardwareImport.test.tsx tests/components/DeviceDetail/accounts/QrImport.test.tsx` passed: 5 files, 49 tests.
- Shared QR frame focused tests passed: `npx vitest run tests/components/DeviceDetail/accounts/QrImport.test.tsx tests/components/ImportWallet/QrScanStep.test.tsx tests/components/ImportWallet/ImportWallet.branches.test.tsx tests/components/DeviceDetail/accounts/AddAccountFlow.branches.test.tsx` passed: 4 files, 33 tests.
- Focused lizard passed for the account import public files, extracted helper directories, shared QR scanner frame, import-wallet QR section, and focused tests.
- `npm run typecheck:app`, `npm run typecheck:tests`, and `npm run lint:app` passed after the shared frame extraction.
- `npm run test:coverage` passed: 401 files, 5,587 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 57 warnings, average CCN 1.3, max CCN 33; `ManualAccountForm`, `AddAccountFlow`, and `QrImport` are no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 2.02% duplication, 277 clones, and 5,300 duplicated lines after sharing the QR scanner frame.
- `node scripts/quality/check-large-files.mjs` passed.
- PR #31 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #31 merged as `3940e3fb`; the post-merge `main` backstop passed release `24684018341`, dev image build `24684018256`, install tests `24684018302`, and test suite `24684018271`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Null/empty manual inputs remain guarded by the submit disabled state: missing `xpub`, missing derivation path, or loading state keeps submission disabled.
- Derivation boundaries remain map-backed and covered for multisig native/nested/fallback suffixes and single-sig BIP-44/49/84/86 script paths.
- Method selection boundaries remain explicit: insecure or unsupported devices do not show USB, SD/QR selection resets import state, close/back clear import state, and parsed accounts continue to take precedence over method panels.
- QR boundaries remain preserved: camera/file mode switches clear the previous camera state, camera retry clears prior errors, stop-camera resets animated QR progress plus both decoder refs, file mode preserves `.json,.txt`, and partial progress renders only for values between 0 and 100.

# Previous Task: Lizard UI Batch 31 - Device Access Ownership

Status: complete

Goal: reduce the related `DeviceDetail` access/ownership lizard findings by splitting device sharing controls, owner summary rendering, and ownership transfer modal state/view pieces while preserving owner-only controls, shared group/user display and removal behavior, user search behavior, loading/empty states, transfer recipient selection, message and keep-viewers options, transfer submission payloads, API error copy, close/initiation callbacks, and the public `SharingSection`, `OwnershipSection`, and `TransferOwnershipModal` import paths.

## Lizard UI Batch 31 Checklist

- [x] Start from updated `main` after Batch 30 PR and post-merge full lane are green.
- [x] Confirm grouped access/ownership targets: `SharingSection` at 33 CCN, `OwnershipSection` at 23 CCN, and `TransferOwnershipModal` at 31 CCN.
- [x] Split device access and transfer modal render/state branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 31 Review

Plan:

- Keep `components/DeviceDetail/access/SharingSection.tsx`, `components/DeviceDetail/access/OwnershipSection.tsx`, and `components/TransferOwnershipModal.tsx` as the public exports.
- Move device sharing group controls, user search/results, current access rows, owner display derivation, and transfer modal header/warning/recipient/options/actions into focused helpers under local component directories.
- Treat this as one bounded access/ownership surface, not a broad DeviceDetail cleanup: leave account import, wallet access tabs, and unrelated modal flows for later batches.
- Preserve `tests/components/DeviceDetailPage.test.tsx`, `tests/components/DeviceDetail/access/OwnershipSection.branches.test.tsx`, and `tests/components/TransferOwnershipModal.test.tsx`; add direct `SharingSection` tests if extraction exposes untested owner/non-owner or empty/current-access behavior.
- Verify focused lizard against the three public files, extracted helper directories, and focused tests before running the broader guardrails.

Verification so far:

- PR #29 merged as `51d60c31`; the post-merge `main` backstop passed release `24680513079`, dev image build `24680513103`, install tests `24680513090`, and test suite `24680513077`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh grouped lizard measurement from `main` (`51d60c31`) reports `components/DeviceDetail/access/SharingSection.tsx:43` at 33 CCN, `components/DeviceDetail/access/OwnershipSection.tsx:17` at 23 CCN, and `components/TransferOwnershipModal.tsx:33` at 31 CCN.
- Reduced `SharingSection` to a 79-line public access shell, `OwnershipSection` to a 26-line owner shell, and `TransferOwnershipModal` to a 35-line modal shell.
- Moved owner display derivation, shared group/user rows, sharing controls, transfer modal state, header, warning, recipient selector, options, actions, and form layout into focused local helpers while preserving the existing public import paths.
- Preserved owner-only sharing controls, group selection and add callbacks, user search threshold/results, shared access removal behavior, empty/current-access copy, owner transfer button behavior, wallet/device transfer resource labels, selected-recipient clearing, message trimming and 500-character counter, keep-existing-viewers default, submit disable/error behavior, API error copy, loading state, close/cancel callbacks, and successful `onTransferInitiated` callbacks.
- Fixed a coverage teardown regression in `useBackupHandlers` by clearing pending copied-key reset, backup success reset, and restore reload timers on unmount; added a regression test for the copied-key timeout cleanup.
- `npx vitest run tests/components/DeviceDetail/access/OwnershipSection.branches.test.tsx tests/components/DeviceDetail/access/SharingSection.branches.test.tsx tests/components/TransferOwnershipModal.test.tsx` passed: 3 files, 36 tests.
- `npx vitest run tests/components/DeviceDetailPage.test.tsx tests/components/WalletDetail/WalletDetailModals.test.tsx` passed: 2 files, 34 tests.
- `npx vitest run tests/components/BackupRestore/useBackupHandlers.branches.test.tsx` passed: 1 file, 10 tests.
- Focused lizard passed for the device access public files, extracted access helpers, transfer modal shell/helper directory, focused tests, `useBackupHandlers`, and the backup handler branch test.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed after the timer cleanup: 401 files, 5,584 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 60 warnings, average CCN 1.3, max CCN 33; `SharingSection`, `OwnershipSection`, and `TransferOwnershipModal` are no longer in the warning list, and the top remaining production JSX targets are down to 31 CCN.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` passed at 2.04% duplication, 279 clones, and 5,337 duplicated lines; the new local helper overlap with wallet access remains below threshold and is bounded to the access UI surface.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, grade-history JSONL parsing, and full working-tree gitleaks passed.
- PR #30 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #30 merged as `fcdaa7dd`; the post-merge `main` backstop passed release `24682333934`, dev image build `24682333936`, install tests `24682333926`, and test suite `24682333935`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Null/empty ownership inputs remain guarded: absent owner data falls back to the current username, then `You`; owner initials fall back to the current username initial, then `U`; and transfer controls only render when the viewer is the owner.
- Sharing boundaries remain explicit: non-owners see no add/remove controls, empty shared access renders the existing empty copy, group rows only render when groups exist, user rows only render for shared users, and user search/add controls preserve their disabled/loading states.
- Transfer boundaries remain preserved: no selected recipient disables submission and sets the existing recipient error, message payloads are trimmed or omitted when blank, the 500-character limit is still enforced by the textarea, API errors prefer server copy, and fallback errors keep the previous text.
- Async timer cleanup now prevents pending backup/restore UI timers from firing after the hook unmounts or the test environment tears down.

# Previous Task: Lizard UI Batch 30 - QR Scanner Panel

Status: complete

Goal: reduce the current `QrScannerPanel` lizard finding by splitting QR mode toggle rendering, camera idle/active/error states, animated-QR progress rendering, file upload/parsing states, and success rendering while preserving camera/file mode callbacks, secure-origin warning copy, scanner props and callbacks, stop-camera behavior, progress and positioning copy, file upload behavior, parsing state, fingerprint fallback copy, and the public `QrScannerPanel` import path.

## Lizard UI Batch 30 Checklist

- [x] Start from updated `main` after Batch 29 PR and post-merge full lane are green.
- [x] Confirm `QrScannerPanel` is a current top JSX target at 33 CCN.
- [x] Split QrScannerPanel render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 30 Review

Plan:

- Keep `components/ConnectDevice/QrScannerPanel.tsx` as the public `QrScannerPanel` export and move scanner-specific view pieces under `components/ConnectDevice/QrScannerPanel/`.
- Extract mode toggle styling, camera idle/error/active rendering, progress overlay copy, file upload idle/parsing rendering, and success/fingerprint display into small components so the root component becomes branch orchestration only.
- Preserve `tests/components/ConnectDevice/QrScannerPanel.test.tsx`; add focused assertions only if extraction exposes untested behavior around scanner callback props, inactive scanned states, progress boundary values, or file input attributes.
- Verify focused lizard against `components/ConnectDevice/QrScannerPanel.tsx`, the extracted helper directory, and the focused test before running the broader guardrails.

Verification so far:

- PR #28 merged as `a7ff5c5e`; the post-merge `main` backstop passed release `24677999452`, dev image build `24677999451`, install tests `24677999449`, and test suite `24677999722`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.
- Fresh focused lizard measurement from `main` (`a7ff5c5e`) reports `components/ConnectDevice/QrScannerPanel.tsx:30` `QrScannerPanel` at 33 CCN.
- Reduced `components/ConnectDevice/QrScannerPanel.tsx` to a 57-line public shell and moved camera idle/active/error rendering, animated QR progress rendering, file upload/parsing rendering, mode toggle rendering, and success rendering under `components/ConnectDevice/QrScannerPanel/`.
- Preserved camera/file mode callbacks, secure-origin warning copy, scanner callback props and constraints, stop-camera behavior, progress and positioning copy, file upload behavior, parsing state, fingerprint fallback copy, and the public `QrScannerPanel` import path.
- Added focused assertions for secure-origin warning absence, completed animated QR progress hiding transient copy, and non-empty fingerprint success copy.
- `npx vitest run tests/components/ConnectDevice/QrScannerPanel.test.tsx` passed: 1 file, 8 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ConnectDevice/QrScannerPanel.tsx components/ConnectDevice/QrScannerPanel tests/components/ConnectDevice/QrScannerPanel.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 400 files, 5,580 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 63 warnings, average CCN 1.3, max CCN 33; `QrScannerPanel` is no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` completed: 2.02% duplication, 276 clones, 5,288 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, and full working-tree gitleaks passed.
- PR #29 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #29 merged as `51d60c31`; the post-merge `main` backstop passed release `24680513079`, dev image build `24680513103`, install tests `24680513090`, and test suite `24680513077`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Null/empty success copy remains guarded: empty fingerprint renders `Not provided`, while populated fingerprints render unchanged.
- Progress boundaries remain explicit: `0` shows the positioning hint, `1..99` shows animated QR progress, and `100` hides both transient progress and positioning copy.
- Camera and file boundaries remain preserved: secure origins omit the HTTPS warning, insecure origins show it, camera error retry reactivates the camera, stop camera still calls `onStopCamera`, and file upload keeps the `.json,.txt` accept list and existing change callback.

# Previous Task: Lizard UI Batch 29 - Agent Wallet Dashboard

Status: complete

Goal: reduce the current `AgentWalletDashboard` lizard finding by splitting dashboard state/model derivation, loading/error shell rendering, summary tiles, row header/actions, wallet links, and detail panels while preserving dashboard load/retry behavior, row ordering, totals, spend-ready eligibility, status badges, pause/unpause/revoke behavior, confirm gating, active-key filtering, empty states, wallet links, metadata labels, formatting fallbacks, and the public `AgentWalletDashboard` import path.

## Lizard UI Batch 29 Checklist

- [x] Start from updated `main` after Batch 28 PR and post-merge full lane are green.
- [x] Confirm `AgentWalletDashboard` is tied as a current top JSX target at 33 CCN.
- [x] Split AgentWalletDashboard render/status branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 29 Review

Plan:

- Keep `components/AgentWalletDashboard/index.tsx` as the public `AgentWalletDashboard` export and move dashboard controller/model helpers plus row/detail render pieces under `components/AgentWalletDashboard/`.
- Extract row state derivation, active-key filtering, spend-ready checks, total aggregation, row ordering, status badge rendering, and dashboard shell states into focused helpers so the row component no longer owns every branch.
- Preserve `tests/components/AgentWalletDashboard.test.tsx` first; add focused branch tests only if extraction exposes missing behavior around invalid balances, invalid dates, revoked/expired keys, unknown metadata labels, empty sections, or cancelled revocation.
- Verify focused lizard against `components/AgentWalletDashboard/index.tsx`, the extracted helper directory, and the focused test before running the broader guardrails.

Verification so far:

- PR #27 merged as `4f68be9a`; the post-merge `main` backstop passed release `24675976724`, dev image build `24675976716`, install tests `24675976681`, and test suite `24675976713`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.
- Fresh focused lizard measurement from `main` (`4f68be9a`) reports `components/AgentWalletDashboard/index.tsx:326` anonymous row render at 33 CCN.
- Reduced `components/AgentWalletDashboard/index.tsx` to an 8-line public shell and moved loading/error/dashboard rendering, row rendering, row actions, row metrics/links, detail panels, status badges, controller state, and pure dashboard model helpers under `components/AgentWalletDashboard/`.
- Preserved dashboard load/retry behavior, row ordering by attention then name, total aggregation, spend-ready eligibility, active-key filtering, pause/unpause/revoke behavior, confirmation gating, action error display, wallet links, status badges, metadata labels, no-cap/off/fallback copy, empty detail states, and the public `AgentWalletDashboard` import path.
- `npx vitest run tests/components/AgentWalletDashboard.test.tsx tests/components/AgentWalletDashboard/agentWalletDashboardModel.test.ts` passed: 2 files, 12 tests.
- `npm run typecheck:tests` passed after tightening the dashboard model test helper to omit `agent` before layering partial agent overrides; this fixes PR #28's first `Quick Frontend Tests` failure.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AgentWalletDashboard tests/components/AgentWalletDashboard.test.tsx tests/components/AgentWalletDashboard/agentWalletDashboardModel.test.ts` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 400 files, 5,578 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 64 warnings, average CCN 1.3, max CCN 33; `AgentWalletDashboard` is no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` completed: 2.02% duplication, 276 clones, 5,283 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, and full working-tree gitleaks passed.
- PR #28 checks passed after follow-up commit `31847425`: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #28 merged as `a7ff5c5e`; the post-merge `main` backstop passed release `24677999452`, dev image build `24677999451`, install tests `24677999449`, and test suite `24677999722`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Null/undefined optional inputs remain guarded: absent wallet names fall back to wallet IDs, absent wallet types render `Wallet`, absent funding drafts render `Never`, empty draft/spend/alert/key sections render their empty copy, and absent API keys filter to an empty active-key list.
- Numeric/date boundaries remain explicit: malformed sats display their raw value where appropriate, malformed operational balances count as zero in totals and not spend-ready, zero balances are not spend-ready, expired/revoked keys are inactive, invalid expiry dates are inactive, and invalid timestamps render `Unknown`.
- Action boundaries remain preserved: cancelled key revocation does not call the API, successful status/key actions reload data, failed actions show the extracted error copy, and revoked agents cannot be paused.
- Metadata fallbacks remain preserved for known labels and unknown underscore-delimited labels across spend details and alert history.

# Previous Task: Lizard UI Batch 28 - UTXO Row

Status: complete

Goal: reduce the current `UTXORow` lizard finding by splitting row state modeling, selection control rendering, amount/privacy/dust rendering, explorer links, labels/locked badges, freeze action, and age/transaction detail rendering while preserving row status priority, checkbox visibility and optional callback behavior, dust detection/spend-cost copy, privacy detail callback behavior, explorer link targets, freeze callback behavior, age/confirmation display, locked draft fallback copy, and public `UTXORow` import path.

## Lizard UI Batch 28 Checklist

- [x] Start from updated `main` after Batch 27 PR and post-merge full lane are green.
- [x] Confirm `UTXORow` is tied as a current top JSX target at 33 CCN.
- [x] Split UTXORow render/status branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 28 Review

Plan:

- Keep `components/UTXOList/UTXORow.tsx` as the public `UTXORow` export and move row state/class derivation plus focused render pieces under `components/UTXOList/UTXORow/`.
- Extract visual-state priority into a model helper so frozen, locked, dust, selected, and default row styling remain table-driven and easier to verify.
- Preserve `tests/components/UTXOList/UTXORow.test.tsx` first; add focused branch tests for selection callback absence, selected styling, privacy-without-data, dust spend-cost copy, and frozen-over-locked priority.
- Verify focused lizard against `components/UTXOList/UTXORow.tsx`, the extracted helper directory, and the focused test before running the broader guardrails.

Verification so far:

- PR #26 merged as `bdf96786`; the post-merge `main` backstop passed release `24666055251`, dev image build `24666055262`, install tests `24666055259`, and test suite `24666055256`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh focused target selection from Batch 27 shows `components/UTXOList/UTXORow.tsx:39` at 33 CCN.
- Reduced `components/UTXOList/UTXORow.tsx` to a 64-line public shell and moved row status/class modeling, selection control rendering, amount/privacy/dust rendering, address link rendering, label/locked draft badges, freeze button behavior, and age/transaction details under `components/UTXOList/UTXORow/`.
- Preserved frozen/locked/dust/selected/default visual priority, checkbox visibility when no selection callback is provided, dust spend-cost title copy, privacy detail callback behavior, address and transaction explorer targets, freeze callback behavior, age/confirmation display, locked draft fallback copy, and the public `UTXORow` import path.
- `npx vitest run tests/components/UTXOList/UTXORow.test.tsx` passed: 1 file, 20 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UTXOList/UTXORow.tsx components/UTXOList/UTXORow tests/components/UTXOList/UTXORow.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- Broad lizard now reports 65 warnings, average CCN 1.4, max CCN 33; `UTXORow` is no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npm run test:coverage` passed: 399 files, 5,571 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, grade-history JSONL parsing, and full working-tree gitleaks passed.
- PR #27 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #27 merged as `4f68be9a`; the post-merge `main` backstop passed release `24675976724`, dev image build `24675976716`, install tests `24675976681`, and test suite `24675976713`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Null/undefined optional inputs remain guarded: absent `onToggleSelect` leaves a visible no-op checkbox, absent privacy info renders no badge, absent UTXO label renders no label badge, and absent draft label still renders `Pending Draft`.
- Status boundary priority remains frozen over locked, locked over dust, dust over selected, selected over default.
- Dust boundary behavior still uses the existing `isDustUtxo`/`getSpendCost` helpers and only shows dust copy when the UTXO is neither frozen nor draft-locked.
- Event boundary behavior still stops propagation for address links, transaction links, privacy badge wrapper, and freeze actions.

# Previous Task: Lizard UI Batch 27 - AI Label Suggestion

Status: complete

Goal: reduce the current `AILabelSuggestion` lizard finding by splitting AI suggestion controller state, API error message mapping, suggest button rendering, suggestion result rendering, and error alert rendering while preserving transaction-id request payloads, loading/reset behavior, all user-facing error copy, accept/dismiss behavior, className passthrough, callback behavior, and public `AILabelSuggestion` import path.

## Lizard UI Batch 27 Checklist

- [x] Start from updated `main` after Batch 26 PR and post-merge full lane are green.
- [x] Confirm `AILabelSuggestion` is the current top JSX target at 35 CCN.
- [x] Split AILabelSuggestion controller/render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 27 Review

Plan:

- Keep `components/AILabelSuggestion.tsx` as the public `AILabelSuggestion` export and move controller state, error mapping, button/result/error renderers, and shared prop types under `components/AILabelSuggestion/`.
- Extract API error message selection into a pure helper so the async handler no longer owns every branch.
- Preserve `tests/components/AILabelSuggestion.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/AILabelSuggestion.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #25 merged as `3aa542db`; the post-merge `main` backstop passed release `24664782827`, dev image build `24664782838`, install tests `24664782835`, and test suite `24664782837`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh focused target selection from Batch 26 shows broad lizard at 67 warnings, average CCN 1.4, max CCN 35; `AILabelSuggestion` is the next top JSX target.
- Reduced `components/AILabelSuggestion.tsx` to a 48-line public shell and moved async suggestion state, transaction-id request handling, accepted-suggestion callback logic, error-message mapping, suggest button rendering, suggestion card rendering, error card rendering, and shared prop types under `components/AILabelSuggestion/`.
- Preserved transaction-id request payloads, loading/reset behavior, all user-facing error copy, accept/dismiss behavior, error dismiss behavior, className passthrough, optional accept callback behavior, transaction-change state persistence, and the public `AILabelSuggestion` import path.
- `npx vitest run tests/components/AILabelSuggestion.test.tsx` passed: 1 file, 29 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AILabelSuggestion.tsx components/AILabelSuggestion tests/components/AILabelSuggestion.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- Broad lizard now reports 66 warnings, average CCN 1.4, max CCN 33; `AILabelSuggestion` is no longer in the warning list.
- `npm run test:coverage` passed: 399 files, 5,568 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `git diff --check`, grade-history updates, `node scripts/quality/check-large-files.mjs`, and the CI-scope lizard baseline passed.
- PR #26 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #26 merged as `bdf96786`; the post-merge `main` backstop passed release `24666055251`, dev image build `24666055262`, install tests `24666055259`, and test suite `24666055256`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Unknown and non-`Error` API failures still map to the generic message, while 503/not-enabled, 429/rate-limit, timeout, and lowercase network/fetch failures keep their specific copy.
- Rapid repeated clicks still produce one API call because loading disables the suggest button.
- Accepting with a callback still calls `onSuggestionAccepted` and clears the suggestion; accepting without a callback still leaves the suggestion visible.
- Dismiss paths independently clear suggestions and errors, making the suggest button visible again after either state is dismissed.
- Transaction prop changes still preserve the current suggestion until the user dismisses or requests again, matching the existing behavior.

# Previous Task: Lizard UI Batch 26 - Login Form

Status: complete

Goal: reduce the current `LoginForm` lizard finding by splitting login form header, credential field rendering, form actions, footer status copy, and card tilt wiring while preserving login/register copy, email reveal, password hint reveal, disabled boot submit behavior, loading labels, registration toggle visibility, API status copy, error alert, field callbacks, submit/toggle callbacks, card tilt behavior, and public `LoginForm` import path.

## Lizard UI Batch 26 Checklist

- [x] Start from updated `main` after Batch 25 PR and post-merge full lane are green.
- [x] Confirm `LoginForm` is tied as the current top UI target at 35 CCN.
- [x] Split LoginForm render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 26 Review

Plan:

- Keep `components/Login/LoginForm.tsx` as the public `LoginForm` export and move header, fields, actions, footer, shared props, and visual tilt hook under `components/Login/LoginForm/`.
- Extract submit label, mode subtitle, registration toggle visibility, API status display, and footer copy into small helpers so the render layer no longer owns every branch.
- Preserve `tests/components/Login/LoginForm.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/Login/LoginForm.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #24 merged as `b1f24a73`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`b1f24a73`) reports `components/Login/LoginForm.tsx:77` anonymous render function at 35 CCN, tied with `components/AILabelSuggestion.tsx`.
- Reduced `components/Login/LoginForm.tsx` to a 63-line public shell and moved header, credential fields, actions, footer status/copy, shared prop types, and visual tilt behavior under `components/Login/LoginForm/`.
- Preserved login/register copy, email reveal, password hint reveal, disabled boot submit behavior, loading labels, registration toggle visibility, API status copy, error alert, field callbacks, submit/toggle callbacks, card tilt behavior, and the public `LoginForm` import path.
- Added a focused assertion that boot loading disables the submit button without changing the login label.
- `npx vitest run tests/components/Login/LoginForm.test.tsx tests/components/Login.test.tsx tests/components/ui/Button.test.tsx` passed: 3 files, 47 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Login/LoginForm.tsx components/Login/LoginForm tests/components/Login/LoginForm.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- Broad lizard now reports 67 warnings, average CCN 1.4, max CCN 35; `LoginForm` is no longer in the warning list and `AILabelSuggestion` is the next top JSX target.
- `npm run test:coverage` passed: 399 files, 5,568 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `git diff --check`, grade-history updates, `node scripts/quality/check-large-files.mjs`, and the CI-scope lizard baseline passed.
- PR #25 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #25 merged as `3aa542db`; the post-merge `main` backstop passed release `24664782827`, dev image build `24664782838`, install tests `24664782835`, and test suite `24664782837`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Empty/null error state still renders no visible alert while non-empty errors render through `ErrorAlert`.
- Login and registration modes still cover both static and loading submit labels, hidden and visible email fields, hidden and visible password hints, and disabled boot-submit state.
- Registration-disabled login mode still hides the toggle, while registration mode still exposes the sign-in toggle even when new registrations are disabled.
- API status rendering is now table-driven for the three allowed statuses and the focused tests cover `checking`, `connected`, and `error`.
- Card tilt still guards null refs before reading layout or mutating transforms, and the visual-only hook remains coverage-ignored.

# Previous Task: Lizard UI Batch 25 - App Routes

Status: complete

Goal: reduce the current `AppRoutes` lizard finding by splitting authenticated-shell state, default-password modal behavior, animated background rendering, route/redirect rendering, notification container wiring, and theme toggle derivation while preserving unauthenticated login gating, `useWebSocketQueryInvalidation` execution, default-password modal trigger, password-change refresh/reload behavior, dark-mode fallback, animated-background pattern/opacity behavior, route manifest rendering, redirect behavior, notification dismissal, and public `App` export.

## Lizard UI Batch 25 Checklist

- [x] Start from updated `main` after Batch 24 PR and post-merge full lane are green.
- [x] Confirm `AppRoutes` is the current top UI target at 37 CCN.
- [x] Split AppRoutes controller/render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 25 Review

Plan:

- Keep `App.tsx` as the public `App` export and move authenticated shell rendering plus controller state under a small `src/app/AppRoutes/` helper set.
- Extract app preference derivation, password-change handling, animated background rendering, route list rendering, and notification container wiring into focused functions/components.
- Preserve `tests/App.branches.test.tsx` and `tests/src/app/appRoutes.test.ts` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `App.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #23 merged as `eda556b8`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`eda556b8`) reports `App.tsx:20` `AppRoutes` at 37 CCN.
- Split `App.tsx` to a 15-line public router/provider shell and moved authenticated app state, preference derivation, password-change refresh/reload handling, animated background selection, route/redirect rendering, and notification wiring under `src/app/AppRoutes/`.
- Preserved default-password modal behavior, unauthenticated login gating, `useWebSocketQueryInvalidation` execution, dark-mode/background fallbacks, animated-background opacity handling, route manifest redirects, notification dismissal, and the public `App` export.
- `npx vitest run tests/App.branches.test.tsx tests/src/app/appRoutes.test.ts` passed: 2 files, 9 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w App.tsx src/app/AppRoutes` passed with no focused warnings.
- `npm run typecheck:app` and `npm run lint:app` passed.
- Broad lizard now reports 68 warnings, average CCN 1.4, max CCN 35; `AppRoutes` is no longer in the warning list.
- `npm run test:coverage` passed: 399 files, 5,567 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- PR #24 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #24 merged as `b1f24a73`; the post-merge `main` backstop passed release `24663495601`, dev image build `24663495592`, install tests `24663495579`, and test suite `24663495589`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Empty/unauthenticated user state still returns `Login` before rendering the authenticated shell.
- Missing preferences still derive `false` dark mode, `minimal` background pattern, and `50` opacity through the existing defaults.
- Password-change refresh failures remain caught and logged before closing the modal and reloading the document.
- Animated backgrounds render only for animated background patterns; non-animated patterns return no background component.
- Route and redirect rendering still comes from the existing app route manifest, avoiding manual path drift.

# Previous Task: Lizard UI Batch 24 - Wallet Telegram Settings

Status: complete

Goal: reduce the current `WalletTelegramSettings` lizard finding by splitting wallet Telegram settings loading/saving state, Telegram availability warnings, wallet enable toggle, notification checkbox list, shell/header rendering, and shared settings model while preserving default settings, fetch-error fallback behavior, Telegram configured/global-enabled gating, optimistic save payloads, save-error revert behavior, API error copy, generic error copy, success timeout behavior, disabled controls while saving, visible copy, and public `WalletTelegramSettings` import path.

## Lizard UI Batch 24 Checklist

- [x] Start from updated `main` after Batch 23 PR and post-merge full lane are green.
- [x] Confirm `WalletTelegramSettings` is tied as the current top UI target at 37 CCN.
- [x] Split WalletTelegramSettings controller/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 24 Review

Plan:

- Keep `components/WalletDetail/WalletTelegramSettings.tsx` as the public shell and move controller logic, availability notices, setting toggles, and shared model helpers under `components/WalletDetail/WalletTelegramSettings/`.
- Extract default settings, Telegram availability derivation, toggle labels, and save-error message mapping into small helpers so the render layer no longer owns every branch.
- Preserve `tests/components/WalletDetail/WalletTelegramSettings.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/WalletDetail/WalletTelegramSettings.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #22 merged as `c58e4073`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`c58e4073`) reports `components/WalletDetail/WalletTelegramSettings.tsx:22` `WalletTelegramSettings` at 37 CCN, tied with `AppRoutes`.

Changes:

- Reduced `components/WalletDetail/WalletTelegramSettings.tsx` from the 37-CCN wallet Telegram renderer/controller to a 12-line public shell.
- Split default settings, Telegram availability derivation, save-error mapping, async controller state, availability warning cards, wallet enable toggle, notification checkbox list, loading card, and shell/header rendering under `components/WalletDetail/WalletTelegramSettings/`.
- Added a focused unmount branch test for pending settings loads so the safer async guard keeps 100% branch coverage.
- Preserved default settings, fetch-error fallback behavior, Telegram configured/global-enabled gating, optimistic save payloads, save-error revert behavior, API error copy, generic error copy, success timeout behavior, disabled controls while saving, visible copy, and public `WalletTelegramSettings` import path.
- Updated quality tracking: `WalletTelegramSettings` drops out of the current lizard warning list; broad lizard warning count is now 69 and max CCN remains 37 with `AppRoutes` as the top UI target.

Verification so far:

- `npx vitest run tests/components/WalletDetail/WalletTelegramSettings.test.tsx` passed: 1 file, 7 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletTelegramSettings.tsx components/WalletDetail/WalletTelegramSettings` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 69; `WalletTelegramSettings` has no remaining lizard warnings and max CCN is now 37.
- `npm run test:coverage` passed: 399 files, 5,567 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` passed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and staged gitleaks passed.
- PR #23 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #23 merged as `eda556b8`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: absent user, absent preferences, absent Telegram settings, missing bot token, missing chat ID, fetch failures, null save errors, and hidden notification rows while wallet notifications are disabled remain guarded.
- Boundary values: Telegram configured versus globally disabled versus available states, enabled versus disabled wallet toggle, every notification key, repeated success timeout replacement, pending-load unmount, and saving-disabled controls remain covered by the focused tests.
- System boundaries: `useUser`, `walletsApi.getWalletTelegramSettings`, `walletsApi.updateWalletTelegramSettings`, `ApiError`, `Toggle`, and the public `WalletTelegramSettings` import path keep the same contracts.
- Async/race behavior: pending load completion after unmount no longer sets state, success timeout is cleared on unmount, and save handling still optimistically updates then reverts on failure.

# Previous Task: Lizard UI Batch 23 - UTXO Garden

Status: complete

Goal: reduce the current `UTXOGarden` lizard finding by splitting UTXO garden item modeling, status/style selection, dot rendering, and legend rendering while preserving age color buckets, size scaling, frozen/locked/dust priority, title text, click guards, privacy legend visibility, format callbacks, and public `UTXOGarden` import path.

## Lizard UI Batch 23 Checklist

- [x] Start from updated `main` after Batch 22 PR and post-merge full lane are green.
- [x] Confirm `UTXOGarden` is the current top UI target at 39 CCN.
- [x] Split UTXOGarden item model/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 23 Review

Plan:

- Keep `components/UTXOList/UTXOGarden.tsx` as the public shell and move dot modeling/rendering plus legend rows under `components/UTXOList/UTXOGarden/`.
- Extract age color, size, status label, disabled state, visual pattern style, and click eligibility into small helpers with the same frozen/locked/dust precedence as the current component.
- Preserve `tests/components/UTXOList/UTXOGarden.test.tsx` and the existing `UTXOList.branches` coverage first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/UTXOList/UTXOGarden.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #21 merged as `67eff884`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`67eff884`) reports `components/UTXOList/UTXOGarden.tsx:48` anonymous render function at 39 CCN, ahead of `WalletTelegramSettings` and `AppRoutes`.

Changes:

- Reduced `components/UTXOList/UTXOGarden.tsx` from the 39-CCN garden renderer to a 38-line public shell.
- Split UTXO dot model creation, status/style selection, dot rendering, legend rendering, and shared props under `components/UTXOList/UTXOGarden/`.
- Preserved age color buckets, size scaling, frozen/locked/dust priority, title text, click guards, privacy legend visibility, format callbacks, and public `UTXOGarden` import path.
- Updated quality tracking: `UTXOGarden` drops out of the current lizard warning list; broad lizard warning count is now 70 and max CCN drops to 37 with `WalletTelegramSettings` and `AppRoutes` as the top UI targets.

Verification so far:

- `npx vitest run tests/components/UTXOList/UTXOGarden.test.tsx tests/components/UTXOList.branches.test.tsx` passed: 2 files, 15 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UTXOList/UTXOGarden.tsx components/UTXOList/UTXOGarden` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 70; `UTXOGarden` has no remaining lizard warnings and max CCN is now 37.
- `npm run test:coverage` passed: 399 files, 5,566 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #22 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #22 merged as `c58e4073`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: empty UTXO arrays, absent `date`, absent labels, absent locked draft labels, absent `onToggleSelect`, false `showPrivacy`, and default no-status labels remain guarded on the same paths as before.
- Boundary values: fresh/month/year/ancient age buckets, minimum size fallback when there are no UTXOs, selected versus unselected dots, frozen versus locked versus dust precedence, dust spend cost copy, and disabled click guards remain preserved.
- System boundaries: `UTXO`, `calculateUTXOAge`, `isDustUtxo`, `getSpendCost`, format callbacks, and the public `UTXOGarden` import path keep the same contracts.
- Async/race behavior: this extraction is render/model-only; there are no async effects or timers in the garden path.

# Previous Task: Lizard UI Batch 22 - Variables

Status: complete

Goal: reduce the current `Variables` lizard finding by splitting system-settings loading/saving state, numeric threshold field rendering, advanced warning/info copy, save feedback, and threshold validation while preserving default fallbacks, input coercion, validation copy, save payload shape, success timeout cleanup, load-error fallback behavior, visible copy, and public `Variables` import path.

## Lizard UI Batch 22 Checklist

- [x] Start from updated `main` after Batch 21 PR and post-merge full lane are green.
- [x] Confirm `Variables` is tied as the current top UI target at 39 CCN.
- [x] Split Variables controller/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 22 Review

Plan:

- Keep `components/Variables.tsx` as the public shell and move threshold inputs, warning/info panels, save feedback, and controller helpers under `components/Variables/`.
- Extract settings defaults/coercion and validation into small pure helpers so the render layer does not own every branch.
- Preserve `tests/components/Variables.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/Variables.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #20 merged as `546e9255`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`546e9255`) reports `components/Variables.tsx:6` `Variables` at 39 CCN, tied with `UTXOGarden` and ahead of `WalletTelegramSettings`/`AppRoutes`.

Changes:

- Reduced `components/Variables.tsx` from the 39-CCN variables renderer/controller to a 12-line public shell.
- Split settings defaults/coercion/validation, controller state, threshold inputs, warning/info copy, threshold card rendering, and save feedback under `components/Variables/`.
- Preserved default fallbacks, input coercion, validation copy, save payload shape, save success timeout cleanup, load-error fallback behavior, visible copy, and public `Variables` import path.
- Updated quality tracking: `Variables` drops out of the current lizard warning list; broad lizard warning count is now 71 and max CCN remains 39 with `UTXOGarden` as the top UI target.

Verification so far:

- `npx vitest run tests/components/Variables.test.tsx` passed: 1 file, 27 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Variables.tsx components/Variables` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 71; `Variables` has no remaining lizard warnings and max CCN remains 39.
- `npm run test:coverage` passed: 399 files, 5,566 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #21 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #21 merged as `67eff884`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: null/undefined settings values, empty numeric input strings, load failures, save failures, null validation error, and false save success remain guarded on the same paths as before.
- Boundary values: confirmation threshold `0`, dust threshold negative values, empty dust fallback to 546, deep-confirmation empty fallback to 1, deep confirmation below confirmation, and the valid save path remain covered by the existing Variables tests.
- System boundaries: `adminApi.getSystemSettings`, `adminApi.updateSystemSettings`, `useLoadingState`, numeric inputs, and the public `Variables` import path keep the same contracts.
- Async/race behavior: success timeout replacement and unmount cleanup remain preserved; load and save timing still flows through `useLoadingState`.

# Previous Task: Lizard UI Batch 21 - Restore Panel

Status: complete

Goal: reduce the current `RestorePanel` lizard finding by splitting warning/upload states, uploaded backup details, validation status, success/error alerts, and confirmation modal rendering while preserving file selection, clear upload, validation states, warning/error/success copy, restore button disabled behavior, confirmation text normalization, cancel/reset behavior, and public `RestorePanel` import path.

## Lizard UI Batch 21 Checklist

- [x] Start from updated `main` after Batch 20 PR and post-merge full lane are green.
- [x] Confirm `RestorePanel` is the current top UI target at 39 CCN.
- [x] Split RestorePanel upload, details, validation, alerts, and confirmation-modal helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 21 Review

Plan:

- Keep `components/BackupRestore/RestorePanel.tsx` as the public shell and move section-level rendering into `components/BackupRestore/RestorePanel/` helpers.
- Extract file upload/selected-file display, backup metadata details, validation status/warnings, restore success/error alerts, and confirmation modal into focused components.
- Preserve the existing `BackupRestore` tests first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/BackupRestore/RestorePanel.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #19 merged as `f172a2a1`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`f172a2a1`) reports `components/BackupRestore/RestorePanel.tsx:54` `RestorePanel` at 39 CCN.

Changes:

- Reduced `components/BackupRestore/RestorePanel.tsx` from the 39-CCN restore renderer to a 72-line public shell.
- Split file upload, selected backup summary, metadata grid, validation status, restore action button, status alerts, and confirmation modal under `components/BackupRestore/RestorePanel/`.
- Preserved file selection, clear upload, validation states, warning/error/success copy, restore button disabled behavior, confirmation text normalization, cancel/reset behavior, and public `RestorePanel` import path.
- Updated quality tracking: `RestorePanel` drops out of the current lizard warning list; broad lizard warning count is now 72 and max CCN remains 39 with `Variables` and `UTXOGarden` as the top UI targets.

Verification so far:

- `npx vitest run tests/components/BackupRestore.test.tsx tests/components/BackupRestore/useBackupHandlers.branches.test.tsx tests/components/BackupRestore/RestorePanel.branches.test.tsx` passed: 3 files, 33 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/BackupRestore/RestorePanel.tsx components/BackupRestore/RestorePanel` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 72; `RestorePanel` has no remaining lizard warnings and max CCN remains 39.
- `npm run test:coverage` passed: 399 files, 5,566 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #20 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #20 merged as `546e9255`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: absent upload, uploaded backup without `meta`, null validation result, empty warnings/issues, null restore error, false restore success, closed confirmation modal, and null file input ref remain guarded on the same paths as before.
- Boundary values: valid versus invalid validation results, zero-warning versus warning validation results, validating versus idle state, restoring versus idle button copy, exact `RESTORE` confirmation, and cancel/reset behavior remain preserved.
- System boundaries: `SanctuaryBackup`, `ValidationResult`, file input events, `Button`, lucide icons, and the public `RestorePanel` import path keep the same contracts.
- Async/race behavior: this extraction is render-only; restore, validation, upload, and reload timing remain owned by the existing backup handler layer.

# Previous Task: Lizard UI Batch 20 - Price Chart

Status: complete

Goal: reduce the current `ChartTooltip`/`PriceChart` lizard finding by splitting tooltip rendering, animated price behavior, timeframe controls, and chart body rendering while preserving total-balance display, timeframe callbacks, chart-ready gating, tooltip active/inactive states, price placeholder, up/down animation indicators, animation cleanup, visible copy, and the public `PriceChart`/`AnimatedPrice` exports.

## Lizard UI Batch 20 Checklist

- [x] Start from updated `main` after Batch 19 PR and post-merge full lane are green.
- [x] Confirm `ChartTooltip`/`PriceChart` is the current top UI target at 41 CCN.
- [x] Split PriceChart tooltip, animated price, timeframe controls, and chart body helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 20 Review

Plan:

- Keep `components/Dashboard/PriceChart.tsx` as the public export surface for `PriceChart` and `AnimatedPrice`.
- Move chart tooltip rendering, timeframe controls, chart body wiring, and animated price behavior into focused helpers under `components/Dashboard/PriceChart/`.
- Preserve the existing `tests/components/Dashboard/PriceChart.test.tsx` expectations first, then add branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/Dashboard/PriceChart.tsx` and the extracted helper directory before running the broader guardrails.

Baseline and PR-loop notes:

- PR #18 merged as `c0397865`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- The Batch 19 PR check behavior matched the new PR flow: `PR Required Checks` and `Code Quality Required Checks` passed, and `Full Test Summary` appeared as skipped/success on the PR.
- Fresh focused lizard measurement from `main` (`c0397865`) reports `components/Dashboard/PriceChart.tsx:7` `ChartTooltip` at 41 CCN.
- Baseline `npx vitest run tests/components/Dashboard/PriceChart.test.tsx` passed: 1 file, 9 tests.

Changes:

- Reduced `components/Dashboard/PriceChart.tsx` from the 41-CCN chart module to a 37-line public shell.
- Split `AnimatedPrice`, chart tooltip rendering, chart body wiring, timeframe controls, animated-price helpers, and shared types under `components/Dashboard/PriceChart/`.
- Preserved total-balance display, timeframe callbacks, chart-ready gating, tooltip active/inactive states, price placeholder, up/down animation indicators, animation cleanup, visible copy, and the public `PriceChart`/`AnimatedPrice` exports.
- Updated quality tracking: `PriceChart` drops out of the current lizard warning list; broad lizard warning count is now 73 and max CCN is now 39 with `RestorePanel`, `Variables`, and `UTXOGarden` as the top UI targets.

Verification so far:

- `npx vitest run tests/components/Dashboard/PriceChart.test.tsx` passed: 1 file, 9 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Dashboard/PriceChart.tsx components/Dashboard/PriceChart` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 73; `PriceChart` has no remaining lizard warnings and max CCN is now 39.
- `npm run test:coverage` passed: 398 files, 5,565 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #19 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #19 merged as `f172a2a1`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: inactive tooltip, empty tooltip payload, absent tooltip label, `chartReady=false`, empty chart data, `value=null`, and initial null-to-number price transitions remain guarded on the same paths as before.
- Boundary values: selected versus unselected timeframe buttons, upward versus downward versus unchanged price direction, animation completion, animation id `0`, and unmount cleanup remain covered by the existing `PriceChart`/`AnimatedPrice` tests.
- System boundaries: `Amount`, Recharts `ResponsiveContainer`/`AreaChart`/`Tooltip`, `Timeframe`, and the public `PriceChart`/`AnimatedPrice` exports keep the same contracts.
- Async/race behavior: animation frame cleanup still cancels truthy request IDs on effect cleanup, preserves the existing no-cancel behavior for request id `0`, and updates the previous price only after the animation completes.

# Previous Task: Lizard UI Batch 19 - Sidebar Content

Status: complete

Goal: reduce the current `SidebarContent` lizard finding by splitting primary navigation, wallet section rendering, device section rendering, system/admin rendering, footer/profile utilities, and small mapping helpers while preserving capability filtering, admin visibility, wallet/device alphabetical sorting, multisig/single-sig icon colors, wallet sync status dots, notification badges, empty states, theme toggle, logout, notification bell, block height indicator, version click behavior, and public `SidebarContent` import path.

## Lizard UI Batch 19 Checklist

- [x] Start from updated `main` after Batch 18 PR and post-merge full lane are green.
- [x] Confirm `SidebarContent` is tied as the current top UI target at 41 CCN.
- [x] Split SidebarContent section/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 19 Review

Plan:

- Keep `components/Layout/SidebarContent.tsx` as the public shell and move section-level rendering into `components/Layout/SidebarContent/` helpers.
- Extract wallet rendering into deterministic helper functions for sorted wallets, wallet type/icon color, notification badge count, and sync status.
- Extract device rendering into deterministic helper functions for sorted devices and notification badge count.
- Extract system/admin/footer rendering so capability checks and user/admin gates stay explicit but no single component owns all branches.
- Preserve the current tests first, then add focused coverage only if extraction introduces new branch surfaces.

Changes:

- Reduced `components/Layout/SidebarContent.tsx` from the 41-CCN sidebar renderer to a 94-line public shell.
- Split header, primary navigation, wallet section, device section, system/admin section, footer utilities, and item mapping helpers under `components/Layout/SidebarContent/`.
- Preserved capability filtering, admin visibility, wallet/device alphabetical sorting, multisig/single-sig icon colors, wallet sync status dots, notification badges, empty states, theme toggle, logout, notification bell, block height indicator, version click behavior, and public `SidebarContent` import path.
- Updated quality tracking: `SidebarContent` drops out of the current lizard warning list; broad lizard warning count is now 74 and max CCN remains 41 with `ChartTooltip` as the top UI target.

Verification so far:

- PR #17 merged as `b8b2d104`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-18 focused lizard measurement from `main` (`b8b2d104`) reports `SidebarContent` and `ChartTooltip` tied at 41 CCN, with `SidebarContent` first in the measured target set.
- `npx vitest run tests/components/Layout/SidebarContent.branches.test.tsx tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx` passed: 3 files, 53 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Layout/SidebarContent.tsx components/Layout/SidebarContent` passed with no warnings.
- Full broad lizard warning count is now 74; `SidebarContent` has no remaining lizard warnings and max CCN remains 41.
- `npm run test:coverage` passed: 398 files, 5,565 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- PR #18 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #18 merged as `c0397865`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.
- The scheduled Test Suite that started immediately before the merge was manually canceled after GitHub had already marked several jobs for cancellation in favor of the higher-priority push run; this released the `main` test concurrency group so the post-merge push backstop could run.

Edge case and self-review:

- Null/undefined and empty inputs: no user, empty username, no wallets, no devices, hidden capability-gated sections, non-admin user, collapsed sections, and absent optional capabilities remain guarded on the same paths as before.
- Boundary values: wallet/device alphabetical sorting, wallet multisig versus single-sig styling, sync status precedence, wallet/device notification badge counts, admin expansion, settings visibility, dark versus light theme icon/title, and version click handling remain preserved.
- System boundaries: `appRoutes`, capability checks, `NavItem`, `SubNavItem`, `EmptyState`, `NotificationBell`, `BlockHeightIndicator`, `getWalletIcon`, and `getDeviceIcon` keep the same contracts.

# Previous Task: Lizard UI Batch 18 - Layout Shell

Status: complete

Goal: reduce the current `Layout` lizard finding by splitting route expansion state, version modal state, draft notification polling, Electrum connection polling, sidebar layout surfaces, mobile header/menu rendering, default-password banner rendering, and modal wiring while preserving sidebar props, wallet/device/admin expansion behavior, draft notifications, connection-error notifications, version copy/loading behavior, clipboard feedback, mobile menu behavior, visible copy, and public `Layout` exports.

## Lizard UI Batch 18 Checklist

- [x] Start from updated `main` after Batch 17 PR and post-merge full lane are green.
- [x] Confirm `Layout` is one of the current top UI targets at 41 CCN.
- [x] Split Layout controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 18 Review

Changes:

- Reduced `components/Layout/Layout.tsx` from the 41-CCN page shell to a 32-line public shell.
- Moved route expansion state, version modal state, clipboard feedback, draft notification polling, Electrum connection polling, and sidebar data loading into `components/Layout/useLayoutController.ts`.
- Split desktop sidebar framing, mobile header/menu overlay, default-password banner, main content frame, and AboutModal wiring into `components/Layout/LayoutShell.tsx`.
- Preserved sidebar props, wallet/device/admin expansion behavior, draft notifications, connection-error notifications, version copy/loading behavior, clipboard feedback, mobile menu behavior, visible copy, and public `Layout` exports.
- Cleared the clipboard feedback timeout on repeated copy attempts and controller unmount so delayed feedback cannot update after teardown.
- Updated the health assessment and grade history: `Layout` drops out of the current lizard warning list; broad lizard warning count is now 75 and max CCN remains 41 with `SidebarContent` and `ChartTooltip` tied as the top component targets.
- PR #17 merged as `b8b2d104`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- PR #16 merged as `ffb9e982`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-17 focused lizard measurement from `main` (`ffb9e982`) reports `Layout`, `SidebarContent`, and `ChartTooltip` tied at 41 CCN, with `Layout` first in the measured target set.
- `npx vitest run tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx` passed: 2 files, 45 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Layout/Layout.tsx components/Layout/LayoutShell.tsx components/Layout/useLayoutController.ts` passed with no warnings.
- Full broad lizard warning count is now 75; `Layout` has no remaining lizard warnings and max CCN remains 41.
- `npm run test:coverage` passed: 398 files, 5,565 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks and gitleaks tracked-tree scan passed.
- Pre-commit static reviewers and pre-commit frontend tests passed.
- PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed.

Edge case and self-review:

- Null/undefined and empty inputs: no user, no wallets, absent version info, absent copied address, closed mobile menu, and falsey default-password flags remain guarded on the same paths as before.
- Boundary values: wallet/detail route expansion versus list routes, device/detail route expansion versus list routes, admin route expansion, singular versus plural draft titles, connected versus disconnected Electrum status, and first versus repeated version clicks remain preserved.
- System boundaries: `useUser`, `useWallets`, `useDevices`, `useAppNotifications`, `useAppCapabilities`, `adminApi.checkVersion`, `bitcoinApi.getStatus`, `getDrafts`, `SidebarContent`, and `AboutModal` keep the same contracts.
- Async/race behavior: version loading still clears in `finally`, clipboard feedback still clears after 2000ms with timeout cleanup on repeated copies and unmount, draft fetch failures still continue to other wallets, connection checks still run immediately and every 60 seconds, and interval cleanup still happens on effect teardown.

# Previous Task: Lizard UI Batch 17 - AI Query Input

Status: complete

Goal: reduce the current `AIQueryInput` lizard finding by splitting natural-language query state, submit/error handling, result formatting, example dropdown rendering, result display, and error display while preserving query trimming, loading state, examples focus/blur behavior, clear behavior, result callback behavior, error copy, visible copy, and public default/named exports.

## Lizard UI Batch 17 Checklist

- [x] Start from updated `main` after Batch 16 PR and post-merge full lane are green.
- [x] Confirm `AIQueryInput` is the current top UI target at 43 CCN.
- [x] Split AIQueryInput controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 17 Review

Changes:

- Reduced `components/AIQueryInput.tsx` from the 43-CCN query component to a 44-line public shell.
- Moved query state, submit handling, API error classification, result state, clear behavior, and error dismissal into `components/AIQueryInput/useAIQueryInputController.ts`.
- Split example rendering, input controls, result display, and error display into focused helpers under `components/AIQueryInput/`.
- Preserved query trimming, loading state, examples focus/blur behavior, clear behavior, result callback behavior, error copy, visible copy, and public default/named exports.
- Updated the health assessment and grade history: `AIQueryInput` drops out of the current lizard warning list; broad lizard warning count is now 76 and max CCN is now 41 with `Layout`, `SidebarContent`, and `ChartTooltip` tied as the top component targets.
- PR #16 merged as `ffb9e982`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- PR #15 merged as `785aa53a`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-16 focused lizard measurement from `main` (`785aa53a`) reports `AIQueryInput` at 43 CCN.
- `npx vitest run tests/components/AIQueryInput.test.tsx` passed: 1 file, 41 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AIQueryInput.tsx components/AIQueryInput` passed with no warnings.
- Full broad lizard warning count is now 76; `AIQueryInput` has no remaining lizard warnings and max CCN is now 41.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks and gitleaks tracked-tree scan passed.
- Pre-commit static reviewers and pre-commit frontend tests passed.
- PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed; the first Quick E2E attempt failed only because `npm ci` hit `ECONNRESET` during setup, and the rerun passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty query, whitespace-only query, absent result, absent error, absent optional callback, and no selected example remain guarded on the same paths as before.
- Boundary values: trimmed query submission, disabled submit while loading or blank, focus/blur example timing, query clear resetting result/error, and result fields with absent or empty filter/sort/limit/aggregation remain preserved.
- System boundaries: `aiApi.executeNaturalQuery`, `NaturalQueryResult`, lucide icons, logger behavior, and the public `AIQueryInput` default/named exports keep the same contracts.
- Async/race behavior: loading still clears in `finally`, failed requests still clear result and set classified error copy, successful requests still set result before invoking `onQueryResult`, and examples still hide through the existing 200ms blur timeout.

# Previous Task: Lizard UI Batch 16 - Users and Groups

Status: complete

Goal: reduce the current `UsersGroups` lizard finding by splitting admin API/loading state, user CRUD handlers, group CRUD handlers, modal state, and page rendering while preserving user/group loading, create/update/delete behavior, confirmation prompts, error handling, modal open/close behavior, visible copy, and the public `UsersGroups` export.

## Lizard UI Batch 16 Checklist

- [x] Start from updated `main` after Batch 15 PR and post-merge full lane are green.
- [x] Confirm `UsersGroups` is the current top UI target at 43 CCN.
- [x] Split UsersGroups controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 16 Review

Changes:

- Reduced `components/UsersGroups/UsersGroups.tsx` from the 43-CCN page component to a 13-line public shell.
- Moved admin user/group loading, create/update/delete handlers, confirmation prompts, API error handling, modal state, and group draft state into `components/UsersGroups/useUsersGroupsController.ts`.
- Moved loaded page rendering and existing panel/modal wiring into `components/UsersGroups/UsersGroupsLoadedView.tsx`.
- Preserved user/group loading, create/update/delete behavior, confirmation prompts, error handling, modal open/close behavior, visible copy, and the public `UsersGroups` export.
- Updated the health assessment and grade history: `UsersGroups` drops out of the current lizard warning list; broad lizard warning count remains measured at 77 and max CCN remains 43 with `AIQueryInput` now the top component target.
- PR #15 merged as `785aa53a`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- PR #14 merged as `f76cfa87`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-15 focused lizard measurement from `main` (`f76cfa87`) reports `UsersGroups` at 43 CCN.
- `npx vitest run tests/components/UsersGroups.test.tsx tests/components/UsersGroups.branches.test.tsx tests/components/UsersGroups/CreateUserModal.test.tsx tests/components/UsersGroups/EditUserModal.branches.test.tsx tests/components/UsersGroups/GroupPanel.branches.test.tsx tests/components/UsersGroups/EditGroupModal.branches.test.tsx` passed: 6 files, 43 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UsersGroups` passed with no warnings.
- Full broad lizard warning count remains 77; `UsersGroups` has no remaining lizard warnings and `AIQueryInput` is now the top component target at 43 CCN.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, pre-commit frontend tests, PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty users/groups, absent editing user/group, no selected modal record, whitespace-only create-user fields, whitespace-only group names, missing user email, and empty group member lists remain guarded on the same paths as before.
- Boundary values: no-change user update payloads, email clear-to-undefined, admin toggle changes, optional password updates, selected versus unselected group members, confirmation cancel, and failed create/update branches remain preserved.
- System boundaries: `adminApi.getUsers`, `getGroups`, `createUser`, `updateUser`, `deleteUser`, `createGroup`, `updateGroup`, `deleteGroup`, `useLoadingState`, `useErrorHandler`, existing panels, and existing modals keep the same contracts.
- Async/race behavior: load/create/update loading flags still flow through `useLoadingState`, failed create/update operations keep modals open, successful mutations reload data, and delete failures still log and call the shared error handler.

# Previous Task: Lizard UI Batch 15 - Chat Tab

Status: complete

Goal: reduce the current `ChatTab` lizard finding by splitting chat API/controller state, conversation list rendering, message panel rendering, and input composer behavior without changing conversation load/create/delete behavior, selected-conversation semantics, message load/clear behavior, optimistic send/rollback behavior, Enter-to-send behavior, scroll-to-bottom behavior, visible copy, or public `ChatTab` exports.

## Lizard UI Batch 15 Checklist

- [x] Start from updated `main` after Batch 14 PR and post-merge full lane are green.
- [x] Confirm `ChatTab` is the current top UI target at 45 CCN.
- [x] Split ChatTab controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 15 Review

Changes:

- Reduced `components/Intelligence/tabs/ChatTab.tsx` from the 45-CCN tab component to a 38-line public shell.
- Moved conversation loading, selected-conversation state, message loading/clearing, optimistic send/rollback, Enter-to-send handling, scroll refs, focus refs, and API error logging into `components/Intelligence/tabs/useChatTabController.ts`.
- Split conversation list rendering, message pane rendering, and input composer rendering into focused helpers under `components/Intelligence/tabs/`.
- Preserved conversation load/create/delete behavior, selected-conversation semantics, message load/clear behavior, optimistic send/rollback behavior, Enter-to-send behavior, scroll-to-bottom behavior, visible copy, and the public `ChatTab` export.
- PR #14 merged as `f76cfa87`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- Fresh post-Batch-14 TSX-aware lizard measurement from `main` (`72783376`) reports `ChatTab` as the top current target at 45 CCN with 78 warnings remaining.
- `npx vitest run tests/components/Intelligence.tabs.test.tsx tests/components/Intelligence.test.tsx tests/components/IntelligenceTabs/chatTab.contracts.tsx` passed: 2 direct test files, 85 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Intelligence/tabs/ChatTab.tsx components/Intelligence/tabs/ChatConversationList.tsx components/Intelligence/tabs/ChatInputComposer.tsx components/Intelligence/tabs/ChatMessagePane.tsx components/Intelligence/tabs/useChatTabController.ts` passed with no warnings.
- Full TSX-aware lizard warning count is now 77; max CCN is now 43 with `UsersGroups` and `AIQueryInput` as the next top component targets.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, pre-commit frontend tests, PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed.

Edge case and self-review:

- Null/undefined and empty inputs: no conversations, missing conversation title, no selected conversation, empty message lists, whitespace-only input, and API failure paths remain guarded on the same paths as before.
- Boundary values: Enter versus Shift+Enter, selected versus unselected conversation deletion, disabled send while empty/sending, and temporary-message replacement/removal remain preserved.
- System boundaries: `intelligenceApi.getConversations`, `getConversationMessages`, `createConversation`, `deleteConversation`, `sendChatMessage`, `ChatMessage`, lucide icons, logger behavior, and text-area refs keep the same contracts.
- Async/race behavior: load flags still clear in `finally`, selection clearing still resets messages, send still gates on `sending`, failed sends still remove only the temp message and restore input, and scroll-to-bottom still runs after message updates.

# Previous Task: Lizard UI Batch 14 - Wallet Detail

Status: complete

Goal: reduce the current `WalletDetail` lizard finding by splitting the route/page state shell, hook orchestration, loaded wallet view, tab prop assembly, and modal prop assembly without changing wallet data loading, sync/repair behavior, transaction filtering, sharing flows, label editing, UTXO actions, modal behavior, tab routing, WebSocket updates, visible copy, or public `WalletDetail` exports.

## Lizard UI Batch 14 Checklist

- [x] Start from updated `main` after Batch 13 PR and post-merge full lane are green.
- [x] Confirm `WalletDetail` is the current top UI target at 47 CCN.
- [x] Split WalletDetail controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 14 Review

Changes:

- Reduced `components/WalletDetail/WalletDetail.tsx` from the 47-CCN page component to a 28-line public shell.
- Moved route params, navigation, location state, user/app notification context, data hooks, sync/repair hooks, transaction filtering, AI filtering, sharing hooks, label editing, UTXO actions, wallet mutation state, tab state, WebSocket hooks, log hooks, address actions, draft notifications, and modal state into `components/WalletDetail/useWalletDetailController.ts`.
- Moved loaded wallet rendering plus tab and modal prop assembly into `components/WalletDetail/WalletDetailLoadedView.tsx` with focused prop-builder helpers.
- Preserved wallet data loading, sync/repair behavior, transaction filtering, sharing flows, label editing, UTXO actions, modal behavior, tab routing, WebSocket updates, visible copy, and the public `WalletDetail` export.
- Updated the health assessment and grade history: TSX-aware lizard warnings moved from 79 to 78, max CCN moved from 47 to 45, and `WalletDetail` dropped out of the current top lizard target list.
- PR #13 merged as `72783376`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- Fresh post-Batch-13 TSX-aware lizard measurement from `main` (`898c2f36`) reports `WalletDetail` as the top current target at 47 CCN.
- `npx vitest run tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx tests/components/WalletDetail tests/components/WalletDetailWrapper` passed: 41 files, 505 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletDetail.tsx components/WalletDetail/WalletDetailLoadedView.tsx components/WalletDetail/useWalletDetailController.ts` passed with no warnings.
- Full TSX-aware lizard warning count is now 78; top remaining component targets are `ChatTab`, `UsersGroups`, `AIQueryInput`, and `SidebarContent`.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, and pre-commit frontend tests passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing route wallet ID, absent wallet, loading state, error state, missing wallet network, missing descriptor, empty UTXO stats, absent bitcoin status, and absent modal wallet ID remain guarded on the same paths as before.
- Boundary values: viewer/editor/owner tab visibility, single-sig versus multisig draft type, empty-string descriptor fallback, stats-tab first-load behavior, and `canEdit=false` transaction controls remain preserved.
- System boundaries: existing hooks remain the only integration points for wallet API loading, sync/repair, sharing, labels, UTXOs, wallet mutation, WebSocket updates, logs, and draft notifications.
- Async/race behavior: stats loading still only starts when the stats tab opens and no UTXO stats are loaded/loading, refresh callbacks still call `fetchData(true)`, and modal delete/transfer flows still delegate through the existing modal-state hook.
- Diff review: changes are scoped to WalletDetail extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 13 - Monitoring

Status: complete

Goal: reduce the current `Monitoring` lizard finding by splitting service loading/controller state, header/refresh controls, disabled-stack and error banners, service grid props, about copy, and URL-modal wiring without changing monitoring API calls, Grafana config fallback behavior, anonymous-access toggling, refresh behavior, hostname fallback, URL edit/save semantics, visible copy, or public `Monitoring` exports.

## Lizard UI Batch 13 Checklist

- [x] Start from updated `main` after Batch 12 PR and post-merge full lane are green.
- [x] Confirm `Monitoring` is the current top UI target at 49 CCN.
- [x] Split Monitoring controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 13 Review

Changes:

- Reduced `components/Monitoring/Monitoring.tsx` from the 49-CCN page component to a 58-line public shell.
- Moved service loading, Grafana config fallback, anonymous-access toggling, credential lookup, URL edit/save state, refresh state, and hostname fallback into `components/Monitoring/useMonitoringController.ts`.
- Split the loading state, header/refresh button, disabled-stack banner, error banner, services grid, and about section into focused helpers under `components/Monitoring/`.
- Preserved monitoring API calls, Grafana config non-fatal fallback behavior, anonymous-access update semantics, refresh behavior, hostname fallback, URL edit/save/null behavior, visible copy, and the public default/named `Monitoring` exports.
- Updated the health assessment and grade history: full lizard warnings moved from 81 to 80, max CCN moved from 49 to 47, and `Monitoring` dropped out of the current top lizard target list.
- PR #12 merged as `898c2f36`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- `npx vitest run tests/components/Monitoring.test.tsx tests/components/Monitoring.branches.test.tsx tests/components/Monitoring/ServiceCard.branches.test.tsx` passed: 3 files, 44 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Monitoring/Monitoring.tsx components/Monitoring tests/components/Monitoring.test.tsx tests/components/Monitoring.branches.test.tsx tests/components/Monitoring/ServiceCard.branches.test.tsx` passed with no warnings.
- Full TSX-aware lizard warning count is now 80; top remaining component targets are `WalletDetail`, `ChatTab`, `UsersGroups`, and `AIQueryInput`.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, `npx --yes jscpd@4 .`, staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, and pre-commit frontend tests passed.

Edge case and self-review:

- Null/undefined and empty inputs: no data, absent Grafana config, absent edit service, empty edit URL, null result from loading helpers, and missing service credentials remain guarded.
- Boundary values: enabled/disabled monitoring stack state, Grafana versus non-Grafana service IDs, custom/default URL state, and empty-string-to-null URL save behavior remain covered.
- System boundaries: `adminApi.getMonitoringServices`, `adminApi.getGrafanaConfig`, `adminApi.updateGrafanaConfig`, `adminApi.updateMonitoringServiceUrl`, `useLoadingState`, `ServiceCard`, and `EditUrlModal` keep the same contracts and module boundaries.
- Async/race behavior: refresh state still clears after `runLoad`, Grafana config lookup remains non-fatal, save still reloads services before closing the modal, and failed anonymous toggle still avoids local state update.
- Diff review: changes are scoped to Monitoring extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 12 - Network Sync Actions

Status: complete

Goal: reduce the current `NetworkSyncActions` lizard finding by splitting async sync/resync state, compact/full button surfaces, the shared resync confirmation dialog, result messaging, and style helpers without changing sync/resync API calls, disabled states, dialog copy, compact/full behavior, timer behavior, success/error messages, callback behavior, or the public `NetworkSyncActions` export.

## Lizard UI Batch 12 Checklist

- [x] Start from updated `main` after Batch 11 PR and post-merge full lane are green.
- [x] Confirm `NetworkSyncActions` is the current top UI target at 49 CCN.
- [x] Split NetworkSyncActions render/action branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Parallel Batch Policy

- Code prep can overlap with a previous PR's CI only when the next target has a disjoint code ownership area.
- Integration stays serialized: each branch rebases from updated `main`, updates shared docs/history/task tracking once, then opens its own PR.
- Shared files such as `tasks/todo.md`, `docs/plans/codebase-health-assessment.md`, and `docs/plans/grade-history/sanctuary_.jsonl` are updated only in the branch currently being integrated to avoid churn and conflicts.

## Lizard UI Batch 12 Review

Changes:

- Reduced `components/NetworkSyncActions.tsx` from the 49-CCN render/action component to a 41-line public shell.
- Moved sync/resync API state, success/error result creation, disabled state, timer behavior, and dialog toggles into `components/NetworkSyncActions/useNetworkSyncActions.ts`.
- Split compact buttons, full buttons, result rendering, resync confirmation dialog, shared types, and style-state helpers under `components/NetworkSyncActions/`.
- Preserved sync/resync API calls, `onSyncStarted` behavior, success/error copy, compact titles, disabled/loading states, dialog copy, cancel/X behavior, result clearing timers, and the public default/named `NetworkSyncActions` exports.
- Updated the health assessment and grade history: full lizard warnings moved from 82 to 81, max CCN remains 49, and `NetworkSyncActions` dropped out of the current top lizard target list.
- PR #11 merged as `0328ea68`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- `npx vitest run tests/components/NetworkSyncActions.test.tsx tests/components/NetworkSyncActions.branches.test.tsx` passed: 2 files, 27 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NetworkSyncActions.tsx components/NetworkSyncActions tests/components/NetworkSyncActions.test.tsx tests/components/NetworkSyncActions.branches.test.tsx` passed with no warnings.
- Full TSX-aware lizard warning count is now 81; top remaining component targets are `Monitoring`, `WalletDetail`, `ChatTab`, and `UsersGroups`.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.

Edge case and self-review:

- Null/undefined and empty inputs: `onSyncStarted` remains optional, `result` can be null, and `walletCount=0` still disables both buttons.
- Boundary values: `queued=1` and non-1 pluralization, `walletCount=1` dialog copy, `walletCount=0`, and compact/full modes remain covered by existing tests.
- System boundaries: `syncApi.syncNetworkWallets`, `syncApi.resyncNetworkWallets`, `extractErrorMessage`, lucide icons, timers, and callback contracts are isolated in the same behavioral paths as before.
- Async/race behavior: sync and resync loading flags still clear in `finally`, result timers still use the original 5s/8s windows, and resync still closes the confirmation dialog before starting the API call.
- Diff review: changes are scoped to NetworkSyncActions extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 11 - Device Details Form

Status: complete

Goal: reduce the current `DeviceDetailsForm` lizard finding by splitting the selected-device form shell, placeholder state, identity fields, parsed-account selector, single-account fields, save/status messaging, and QR import details without changing manual entry behavior, USB/QR/scanned read-only behavior, account selection, save-button gating, warnings/errors, QR details toggle behavior, visible copy, or the public `DeviceDetailsForm` export.

## Lizard UI Batch 11 Checklist

- [x] Start from updated `main` after the first PR-flow validation and docs PR.
- [x] Confirm `DeviceDetailsForm` is the current top UI target at 51 CCN.
- [x] Split DeviceDetailsForm render sections into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 11 Review

Changes:

- Reduced `components/ConnectDevice/DeviceDetailsForm.tsx` to an 86-line form shell and moved placeholder, identity fields, parsed-account selection, single-account fields, QR import details, and save/status messaging into focused helpers under `components/ConnectDevice/DeviceDetailsForm/`.
- Preserved manual entry callbacks, USB/QR scanned read-only behavior, account selection toggles, save-button gating, QR details toggle behavior, warning/error copy, helper text, and the public `DeviceDetailsForm` export.
- Updated the health assessment and grade history: full lizard warnings moved from 83 to 82, max CCN moved from 51 to 49, and `DeviceDetailsForm` dropped out of the current top lizard target list.
- PR #10 merged as `8f38de4d`; the post-merge `main` backstop passed the full test summary and supporting full-lane checks.

Verification so far:

- `npx vitest run tests/components/ConnectDevice/DeviceDetailsForm.test.tsx tests/components/ConnectDevice/DeviceDetailsForm.branches.test.tsx` passed: 2 files, 8 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ConnectDevice/DeviceDetailsForm.tsx components/ConnectDevice/DeviceDetailsForm` passed with no warnings.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and the local Code Quality subset passed. The Code Quality subset covered lint, gitleaks, CI-scope lizard baseline, jscpd, and large-file classification.

Edge case and self-review:

- Null/undefined and empty inputs: no selected model, no connection method, empty xpub/fingerprint, no parsed accounts, no selected parsed accounts, missing QR fields, and absent QR details remain covered by the same render branches.
- Boundary values: selected-account count at 0 and nonzero, parsed-account count at 0 and nonzero, scanned/non-manual read-only state, and save-button disabled/enabled transitions remain covered.
- System boundaries: `Input`, `Button`, lucide icons, `onFormDataChange`, `onToggleAccount`, `onToggleQrDetails`, and `onSave` keep the same contracts and are only passed through extracted components.
- Async/race behavior: no new async state or effects were introduced; all extracted helpers are pure render components.
- Diff review: changes are scoped to DeviceDetailsForm extraction, health-report notes, trend metadata, and this task record.

# Previous Task: CI/CD Optimization and PR/Merge Workflow Plan

Status: complete; PR flow, branch protection, and merge queue are active after the organization move

Goal: optimize GitHub CI/CD so day-to-day commits get fast, relevant feedback without weakening the merge/release safety net. Evaluate whether the current pipeline runs too much on each commit, and decide whether moving from direct commits on `main` to PR-and-merge should be part of the maturity plan.

## Current Judgment

We were running the right _kinds_ of tests for a wallet/security-sensitive repo, but too much of the expensive validation was attached to direct pushes on `main`.

The existing `.github/workflows/test.yml` already had the right idea structurally: PRs use a changed-files quick lane, while non-PR events use a full lane. The original problem was workflow practice, not only workflow YAML: earlier history showed commits landing directly on `main`, so every source-touching commit paid the full post-merge cost immediately.

Implemented recommendation: normal development now uses PR-and-merge, `main` is protected, and the full suite is treated as merge/main confidence validation. Expensive Docker install, full E2E, mutation, perf, ops, and vector validation stay off the default per-commit path except when path filters or release gates make them relevant.

## Evidence From Original Audit

- At audit time, the current branch was `main`, and recent history showed direct pushes such as `Refactor QR signing modal complexity`, `Refactor device detail complexity`, and `Fix admin agent service date-boundary test`.
- The sampled GitHub runs showed four workflows on source-touching pushes to `main`: `Test Suite`, `Build Dev Images`, `Install Tests`, and `Release`. `Install Tests` and `Release` often finished quickly because they skipped/no-op; `Test Suite` was the real cost.
- A successful recent `Test Suite` push run, `24643866168`, took about 13m37s wall time. Long poles were `Full Frontend Tests` at about 6m15s and `Full E2E Tests` at about 7m17s. `Full Backend Tests` took about 4m43s. `Full Gateway Tests` was about 15s.
- A failed recent direct-push `Test Suite` run, `24642824339`, failed in `Full Backend Tests` after the commit was already on `main`. That is exactly the failure mode PR gating should prevent.
- Test inventory is large enough to justify tiering: 844 test/spec files total, including 398 root frontend/shared tests, 383 backend unit tests, 28 backend integration tests, 20 gateway tests, and 14 Playwright specs.
- At audit time, none of the inspected workflows defined `concurrency`, so superseded pushes/PR updates could keep consuming CI minutes.
- At audit time, `docker-build.yml` ran on every PR to `main` without PR path filters, even though its push path filter was narrower. That was likely waste for docs/test-only/backend-only changes that do not affect image build surfaces.
- `release.yml` runs a push-to-main `Release Check` no-op purely as a status check. That is cheap, but it should be documented or replaced by a clearer required-check aggregator.
- Release validation intentionally duplicates some install validation: `release.yml` waits for `Install Tests`, then calls `release-candidate.yml`. That is acceptable for releases, but it should not influence normal commit gating.

## Target Development Model

- Use short-lived feature branches for all non-emergency work.
- Open PRs into `main`; require CI before merge.
- Disable direct pushes to `main` for humans through GitHub branch protection or repository rulesets.
- Allow only automation/release workflows to write to `main`, and only when explicitly needed.
- Prefer squash merge or rebase merge so `main` stays linear and each merged change has one clear CI result.
- Prefer GitHub merge queue as the long-term model. The original blocker was that `nekoguntai/sanctuary` was a public repository owned by a paid personal user account. That blocker was resolved by moving the repository under `nekoguntai-castle`, and merge queue is now active on `main`.

## Proposed CI Tiers

### Tier 0 - Local Developer Loop

Use focused local commands before pushing:

- Frontend/UI changes: `npm run typecheck:app`, `npm run typecheck:tests`, focused `npx vitest run ...`, then `npm run test:coverage` only before PR readiness when coverage-affecting.
- Backend changes: `cd server && npm run typecheck:tests`, focused `npx vitest run ...`, targeted integration only when DB/API flow behavior changes.
- Gateway changes: `cd gateway && npm run test:run` or focused gateway tests.
- Docker/install changes: focused `tests/install/*` script locally when practical; otherwise rely on PR install gate.

### Tier 1 - Required PR Quick Gate

Target: fast enough for repeated PR updates; broad enough to block obvious regressions before merge.

- Always run secret scan and lint policy checks.
- Run changed-file detection once and route to relevant quick jobs.
- Frontend changes: strict app/test typecheck plus `vitest related`.
- Backend changes: server test typecheck plus related non-integration Vitest tests; keep the two-file backend integration smoke for backend changes.
- Gateway changes: related gateway tests.
- E2E/frontend surface changes: keep Chromium smoke/render subset, not full multi-browser E2E.
- Critical Bitcoin/auth paths: keep `test:mutation:critical:gate` only for those paths.
- Docker/install paths: run install workflow via existing path filters.
- Docker image build: run on PR only when Docker/image-impacting paths change.

Implementation detail: create a single always-running required status, for example `PR Required Checks`, that depends on conditional quick jobs and fails if any non-skipped required child job fails. This avoids brittle branch protection on path-conditional job names.

### Tier 2 - Merge/Main Confidence Gate

Target: full confidence once per merge, not once per local-sized direct commit.

- Full frontend coverage with 100% thresholds.
- Full backend unit coverage plus backend integration suite.
- Full gateway coverage.
- Full build check.
- Chromium Playwright E2E on the merge/main path.
- Critical mutation gate when critical paths changed.
- Build dev images on `main` only after merge and only for image-impacting paths.

With GitHub merge queue available under `nekoguntai-castle`, keep the existing `merge_group` triggers and run this tier on the merge-group SHA. Keep push-to-main `Test Suite` as a backstop/summary where useful, because the merge queue validates the exact merge candidate before merge.

Direct human pushes to `main` remain blocked so the full lane runs after reviewed PR/queue merges rather than routine local-sized commits.

### Tier 3 - Nightly/Weekly Deep Validation

Target: catch expensive, flaky, environment-sensitive, or low-probability regressions without blocking every PR update.

- Full Playwright matrix across Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari.
- Full or broader Stryker mutation testing.
- Bitcoin vector verification and regeneration checks.
- Docker install/upgrade full suite when not release-blocking.
- Ops smoke proofs and perf benchmarks.
- Duplication and complexity trend reporting can stay blocking on PR while the lizard cleanup project is active; revisit after the warning count reaches the target baseline.

### Tier 4 - Release Gate

Target: validate installation, upgrade, image publishing, and release-note automation with deliberate redundancy.

- Keep release candidate validation separate from routine merge validation.
- Run full install and upgrade tests before stable release promotion.
- Keep multi-arch Docker builds and manifest creation release-only.
- Keep release workflow waiting for install validation, but consider de-duplicating install checks later by making one release-candidate workflow the source of truth.

## Workflow Changes Implemented

- Added `concurrency` to all workflows:
  - PR group: workflow name plus PR number.
  - Push group: workflow name plus ref.
  - `cancel-in-progress: true` for PRs and branch pushes.
  - Avoid canceling release/tag workflows unless explicitly safe.
- Added `merge_group` triggers to `test.yml`, `quality.yml`, and required merge-queue surfaces.
- Added PR path filters to `docker-build.yml` to match its push intent.
- Added required-check aggregators so branch protection does not depend on conditional/skipped job names.
- Reviewed `release.yml` push-to-main no-op status as branch-protection compatibility behavior.
- Recorded duplicate build work in `test.yml` for later measurement-driven tuning:
  - `full-build-check` builds frontend/backend.
  - `full-e2e-tests` also builds frontend/backend.
  - Keep both only if they catch distinct failure modes; otherwise make E2E consume the build path or make build check the single build gate.
- Kept `install-test.yml` path-gated, added concurrency, and retained release tag behavior.
- Kept `verify-vectors.yml` path-gated for PRs and scheduled weekly.
- Added documentation in `docs/reference/ci-cd-strategy.md` explaining which checks are PR-required, merge-required, nightly, and release-only.

## Branch Protection / Repository Rules

- Require PR before merging into `main`.
- Require the stable aggregate checks `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- Expect `Full Test Summary` to appear as skipped/success on PRs; the full lane is a merge/main backstop.
- Keep install/docker/vector checks path-gated instead of globally required so docs-only and unrelated PRs do not wait on absent workflows. Include each workflow file in its own path filter so workflow edits still validate their target workflow.
- Require branch to be up to date before merging if merge queue is not enabled.
- Keep merge queue enabled on `main` now that the repository is under an eligible organization.
- Restrict direct pushes to `main`; allow GitHub Actions bot only where release automation needs it.
- Require linear history via squash or rebase merge.
- Keep emergency hotfix escape hatch documented: temporary admin bypass plus follow-up PR, not routine direct commit.

## First PR Validation Checklist

- [x] Confirm `PR Required Checks` runs on the pull request and fails only when a quick-lane child fails.
- [x] Confirm `Code Quality Required Checks` runs on the pull request and reflects lint, gitleaks, lizard, and jscpd.
- [x] Confirm `Full Test Summary` is present on the pull request as skipped/success, so branch protection does not wait on the full lane.
- [x] Confirm docs-only or workflow-only PRs do not wait on absent Docker, install, or vector checks.
- [x] After merge, confirm the push-to-`main` full lane runs as the merge confidence backstop.

Observed result: PR #8, `ci-pr-flow-aggregates`, passed the required PR checks and merged as `72bdce96`. The post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install summary, release check, and dev image build.

## Lizard Remediation PR Loop

- [x] Start each batch from updated `main` on a short-lived branch.
- [x] Refactor the next highest-value complexity target with focused tests and local lizard verification.
- [x] Update `docs/plans/codebase-health-assessment.md`, grade history, and this task log with the new warning count and verification evidence.
- [x] Open a PR and wait for `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge only after required checks pass, then wait for the post-merge full lane on `main`.
- [x] Rebase or recreate the next batch branch from the updated `main`.

Historical note: this loop was executed by the later lizard and grade cleanup batches. The current grade notes record 0 lizard warnings, so these are no longer live todo items.

## Measurement Plan

- Baseline current wall time from recent runs:
  - `Test Suite` push: about 13-14 minutes when full path runs.
  - `Build Dev Images` push: about 1 minute.
  - `Install Tests` skip/no-op on non-install changes: about 10-15 seconds.
  - `Release` push-to-main no-op: about 5-7 seconds.
- Track p50/p90 for PR quick gate, merge gate, and nightly jobs separately.
- Target PR quick gate:
  - Non-E2E frontend/backend PRs: under 8 minutes p50.
  - Gateway-only PRs: under 3 minutes p50.
  - Docker/install PRs can be slower but should be path-limited.
- Target merge/main gate: under 15 minutes p50 while retaining full confidence.
- Track canceled runs after adding concurrency; expected outcome is fewer wasted runs on force-push/rebase cycles.
- Track escaped defects: if a category starts failing only on main after PRs pass, promote the missing check from merge/nightly into the PR quick gate.

## Implementation Checklist

- [x] Audit workflow triggers, jobs, path filters, caches, artifacts, and missing concurrency.
- [x] Map test scripts into unit, integration, e2e, install, ops, perf, mutation, vector, and release tiers.
- [x] Pull recent GitHub run data to estimate real current cost.
- [x] Evaluate PR-and-merge versus direct commits to `main`.
- [x] Review this plan before changing workflow files.
- [x] Implement workflow concurrency and safe PR path-filter improvements first.
- [x] Add PR required-check aggregator.
- [x] Configure branch protection/repository rules for PR-only `main`.
- [x] Set the blocking Code Quality lizard gate to the current CI-scope warning baseline so the first PR is not deadlocked while the broader lizard backlog is still being reduced.
- [x] Decide whether to enable merge queue now or after one PR-only trial period.
- [x] Attempt merge queue enablement through the GitHub repository rulesets API.
- [x] Confirm GitHub originally rejected `merge_queue` enforcement for the old user-owned repository.
- [x] Tune post-merge aggregate behavior so full E2E is included in the full-lane summary.
- [x] Document CI tiering and emergency hotfix process.
- [x] Open the CI/branch-protection changes through the new PR flow.
- [x] Validate the first PR run required-check behavior.
- [x] Re-measure CI after 10-20 PRs and adjust gates based on failures and wall time.

Historical note: the later path-aware CI, lane-splitting, frontend coverage sharding, backend integration grouping, and measurement batches recorded the follow-up timings and gate adjustments.

## Edge Case Audit For CI Design

- Empty or docs-only PRs: should not run full test suites; should still get a cheap required aggregate result.
- Path-filtered jobs: skipped jobs must not leave required checks pending.
- Forked PRs: secret-dependent jobs must not assume write permissions or private tokens.
- Release/tag workflows: concurrency must not cancel a publishing run unexpectedly.
- Merge commits: changed-file detection must compare the correct base for PRs, pushes, and merge queue events.
- Critical-path files: Bitcoin/auth/security changes should promote to stronger gates automatically.
- Generated files and workflow-only changes: changes to workflow/test config should force relevant CI validation even if app source did not change.
- Failed quick lane followed by force-push: older run should cancel cleanly and not block the latest commit.

## Review

Implemented:

- Added `merge_group` support to `test.yml` and `quality.yml` so merge queue can validate the same required workflow surfaces.
- Added workflow concurrency to `test.yml`, `quality.yml`, `docker-build.yml`, `install-test.yml`, and `verify-vectors.yml`, with release/tag install runs protected from cancellation.
- Added `PR Required Checks` in `test.yml` as a stable required-check target for path-conditional quick jobs.
- Added `Code Quality Required Checks` in `quality.yml` as a stable aggregate target for lint, gitleaks, lizard, and jscpd.
- Initially set the Code Quality lizard gate to the measured CI-scope baseline of 9 warnings. Later lizard cleanup batches drove the current warning count to 0.
- Updated `Full Test Summary` to wait for `Full E2E Tests` and to fail when any required full-lane job fails. Critical mutation remains allowed to skip when no critical path changed.
- Added PR path filters to `docker-build.yml` and expanded the image-impacting path set for both PR and push triggers.
- Added `docs/reference/ci-cd-strategy.md` and linked it from `docs/reference/release-gates.md`.
- Configured GitHub branch protection for `main`: PRs required, required checks are `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`, strict up-to-date checks enabled, admin enforcement enabled, linear history required, force pushes/deletions disabled, and conversation resolution required.

Follow-up status:

- The blocking `LIZARD_WARNING_BASELINE` was driven down by the later lizard cleanup batches; current grade notes record 0 lizard warnings.
- The merge queue blocker was resolved by moving the repository under `nekoguntai-castle`; subsequent PRs have merged through the queue.
- CI was re-measured across later path-aware CI, lane-splitting, frontend coverage sharding, backend integration grouping, and release-gate batches.
- Docs-only, workflow-only, Docker, install, and vector path filters were exercised through the PR and merge-queue flow without leaving unrelated PRs stuck.

The elegant version is not "run fewer tests"; it is "run each test at the cheapest point where it provides useful information." The current suite remains appropriate for merge confidence. The move to PR-and-merge keeps the existing high bar while shifting most repeated feedback to the quick lane that already exists.

# Previous Task: Lizard UI Batch 10 - QR Signing Modal

Status: complete

Goal: reduce the current `QRSigningModal` lizard finding by splitting QR scan parsing, signed-PSBT file import parsing, modal state/callback control, display-step rendering, scan-step rendering, scanner progress/error UI, and upload fallback helpers without changing modal open/close behavior, raw base64 PSBT scans, UR decoding progress/errors, camera retry behavior, binary/base64/hex file upload behavior, or the public default/named exports.

## Lizard UI Batch 10 Checklist

- [x] Confirm pushed DeviceDetail CI status and clean local baseline.
- [x] Inspect current top lizard targets and QRSigningModal test coverage.
- [x] Split QRSigningModal scan/upload/render helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 10 Review

Changes:

- Reduced `components/qr/QRSigningModal.tsx` to an 86-line modal shell and moved display-step rendering, scan-step rendering, scanner progress/error UI, upload fallback UI, QR scan parsing, signed-PSBT file import parsing, and modal state/callback control into focused helpers under `components/qr/QRSigningModal/`.
- Preserved modal open/close behavior, backdrop and close-button reset behavior, raw base64 PSBT scan handling, UR decoder progress/error handling, camera retry behavior, binary/base64/hex PSBT file imports, hidden input reset, user-facing copy, and default/named exports.
- Kept the extracted FileReader assumptions aligned with the pre-extraction implementation so the 100% coverage gate did not require synthetic defensive branches.
- Updated the health assessment and grade history: full lizard warnings moved from 84 to 83, and `QRSigningModal` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/qr/QRSigningModal.test.tsx tests/hooks/useQrSigning.test.tsx tests/components/send/QrSigning.test.tsx tests/components/qr/AnimatedQRCode.test.tsx` passed: 4 files, 58 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed after branch simplification: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/qr/QRSigningModal.tsx components/qr/QRSigningModal tests/components/qr/QRSigningModal.test.tsx tests/hooks/useQrSigning.test.tsx tests/components/send/QrSigning.test.tsx` passed with no warnings.
- Full lizard warning count is now 83; top remaining component targets are `DeviceDetailsForm`, `NetworkSyncActions`, `Monitoring`, and `WalletDetail`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: closed modal, empty scan payloads, no file selected, camera non-Error payloads, invalid QR payloads, invalid uploaded content, and FileReader read failures remain covered.
- Boundary values: scan progress at partial percentages, complete UR decode, decoder errors, raw base64 PSBT scans, binary PSBT magic bytes, base64 text PSBT, hex text PSBT, and hidden file-input reset remain covered.
- System boundaries: `@yudiel/react-qr-scanner`, `AnimatedQRCode`, UR decoder utilities, FileReader, `onSignedPsbt`, `onClose`, and public `QRSigningModal` imports remain on the same contracts.
- Async/race behavior: no new external async state model was introduced; scan processing, file import callbacks, close/reset, and retry flows still resolve through the same modal state transitions.
- Diff review: changes are scoped to QRSigningModal extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 9 - Device Detail

Status: complete

Goal: reduce the current `DeviceDetail` lizard finding by splitting page states, header/edit controls, registered-account rendering, add-account controls, tab navigation, tab content, and transfer modal helpers without changing data loading, edit/save/cancel behavior, owner/viewer badges, shared-by display, account cards, add-derivation flow, tab switching, transfer modal behavior, or public exports.

## Lizard UI Batch 9 Checklist

- [x] Confirm pushed AddressesTab and CI-fix commits have green CI and clean local baseline.
- [x] Inspect current top lizard targets and DeviceDetail test coverage.
- [x] Split DeviceDetail render helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 9 Review

Changes:

- Reduced `components/DeviceDetail/DeviceDetail.tsx` to a 114-line orchestration module and moved loading/not-found states, header/edit controls, registered-account rendering, add-account controls, tab navigation/content routing, and transfer-modal wiring into focused helpers under `components/DeviceDetail/DeviceDetail/`.
- Preserved the existing layout and visible copy for the overview card, owner/viewer badge, shared-by indicator, device-type editor, account cards, legacy derivation/xpub fallback, Add Derivation Path flow, details/access tabs, and ownership-transfer modal.
- Kept data loading and mutations on the existing `useDeviceData` controller and preserved the public `components/DeviceDetail` export.
- Updated the health assessment and grade history: full lizard warnings moved from 85 to 84, max CCN moved from 53 to 51, and `DeviceDetail` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/DeviceDetailPage.test.tsx tests/components/DeviceDetail.test.ts tests/components/DeviceDetail/tabs/DetailsTab.branches.test.tsx tests/components/DeviceDetail/AccountList.test.tsx` passed: 4 files, 76 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DeviceDetail/DeviceDetail.tsx components/DeviceDetail/DeviceDetail tests/components/DeviceDetailPage.test.tsx tests/components/DeviceDetail.test.ts` passed with no warnings.
- Full lizard warning count is now 84; top remaining component targets are `QRSigningModal`, `DeviceDetailsForm`, `NetworkSyncActions`, and `Monitoring`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: loading and not-found states, missing username, null share info, empty groups/search results, absent account arrays, legacy derivation/xpub fallback, and optional `sharedBy` rendering remain covered.
- Boundary values: owner versus viewer badges, single versus plural account counts, empty account count fallback, single-sig versus multisig badges, recommended account badge, tab switching, and modal open/close paths remain covered.
- System boundaries: `useDeviceData` callback wiring, `AddAccountFlow`, `DetailsTab`, `AccessTab`, `TransferOwnershipModal`, route navigation, and public import paths remain unchanged.
- Async/race behavior: no new async state model was introduced; save/cancel, add-account close/update, sharing, group, transfer, and search flows still run through the same controller callbacks.
- Diff review: self-review caught and fixed the extracted account-section slot so it remains aligned inside the original header flex column; changes are scoped to DeviceDetail extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 8 - Addresses Tab

Status: complete

Goal: reduce the current `AddressesTab` lizard finding by splitting address grouping, summary cards, empty state, sub-tabs, table rows, label editing, and footer helpers without changing receive/change classification, copy/QR/explorer actions, label edit/save/cancel behavior, generated-address controls, or public exports.

## Lizard UI Batch 8 Checklist

- [x] Confirm pushed NetworkConnectionCard CI status and clean local baseline.
- [x] Inspect current top lizard targets and AddressesTab test coverage.
- [x] Split AddressesTab grouping/view helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 8 Review

Changes:

- Reduced `components/WalletDetail/tabs/AddressesTab.tsx` to an 87-line orchestration module and moved address grouping, summary cards, empty state, sub-tab controls, address table, row cells, label editing, actions, and footer rendering into focused helpers under `components/WalletDetail/tabs/AddressesTab/`.
- Preserved receive/change classification semantics, including explicit `isChange` precedence, derivation-path fallback, short-path receive fallback, copy/QR/explorer actions, edit/save/cancel label behavior, generated-address controls, and public `AddressesTab` exports.
- Added direct helper coverage for receive/change partitioning and balance display fallbacks, and restored the BIP derivation-path contract comment on the extracted model helper.
- Updated the health assessment and grade history: full lizard warnings moved from 86 to 85, and `AddressesTab` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/WalletDetail/tabs/AddressesTab.test.tsx tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts` passed: 2 files, 16 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- CI follow-up: fixed `server/tests/unit/services/adminAgentService.test.ts` to use a relative future `expiresAt`; `npx vitest run tests/unit/services/adminAgentService.test.ts`, `npm run typecheck:server:tests`, and escalated `npm run test:backend:coverage` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/tabs/AddressesTab.tsx components/WalletDetail/tabs/AddressesTab tests/components/WalletDetail/tabs/AddressesTab.test.tsx tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts` passed with no warnings.
- Full lizard warning count is now 85; top remaining component targets are `DeviceDetail`, `QRSigningModal`, `DeviceDetailsForm`, and `NetworkSyncActions`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty address arrays, empty selected receive/change tabs, missing labels, missing explorer network, absent summary/footer data, and read-only label states remain covered.
- Boundary values: explicit `isChange` values, short derivation paths, change-path fallback, copied-state rendering, all-loaded footer state, and loading generate controls remain covered.
- System boundaries: `AddressesTab` props, label callbacks, QR modal callback, copy hook usage, explorer URL construction, generated-address callback, visible copy, and public import path remain unchanged.
- Async/race behavior: no new async state model was introduced; copy, label save, and generate actions still run through the existing callback props/hooks.
- Diff review: changes are scoped to AddressesTab extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 7 - Network Connection Card

Status: complete

Goal: reduce the current `NetworkConnectionCard` lizard finding by splitting connection-mode rendering and server-action controller logic without changing singleton/pool mode selection, preset loading, add/update/delete/toggle/reorder behavior, connection testing, advanced pool settings, pool stats lookup, or public exports.

## Lizard UI Batch 7 Checklist

- [x] Confirm pushed TransactionList CI status and clean local baseline.
- [x] Inspect current top lizard targets and NetworkConnectionCard test coverage.
- [x] Split NetworkConnectionCard mode selector and controller helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 7 Review

Changes:

- Reduced `components/NetworkConnectionCard/NetworkConnectionCard.tsx` to an 82-line orchestration module and moved connection-mode rendering into `ConnectionModeSelector`.
- Moved singleton/pool config derivation, server action state, add/update/delete/toggle/reorder handlers, test status handling, preset loading, and pool stats lookup into `useNetworkConnectionCardController`.
- Reduced `components/NetworkConnectionCard/ServerForm.tsx` to a 53-line wrapper and moved input fields, port parsing, SSL toggle, preset buttons, and submit button state into focused modules under `components/NetworkConnectionCard/ServerForm/`.
- Updated the health assessment and grade history: full lizard warnings moved from 88 to 86, and `NetworkConnectionCard` plus `ServerForm` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/NetworkConnectionCard.test.tsx tests/components/NetworkConnectionCard/NetworkConnectionCard.branches.test.tsx tests/components/NetworkConnectionCard/SingletonConfig.branches.test.tsx tests/components/NetworkConnectionCard/PoolConfig.branches.test.tsx tests/components/NetworkConnectionCard/ServerRow.branches.test.tsx tests/components/NetworkConnectionCard/ServerForm.branches.test.tsx tests/components/NetworkConnectionCard/HealthHistoryBlocks.test.tsx tests/components/NetworkConnectionCard/networkConfigHelpers.test.ts` passed: 8 files, 55 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 397 files, 5,561 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NetworkConnectionCard/NetworkConnectionCard.tsx components/NetworkConnectionCard/NetworkConnectionCard components/NetworkConnectionCard/ServerForm.tsx components/NetworkConnectionCard/ServerForm components/NetworkConnectionCard/SingletonConfig.tsx components/NetworkConnectionCard/PoolConfig.tsx components/NetworkConnectionCard/ServerRow.tsx components/NetworkConnectionCard/networkConfigHelpers.ts` passed with no warnings.
- Full lizard warning count is now 86; top remaining component targets are `AddressesTab`, `DeviceDetail`, `QRSigningModal`, and `DeviceDetailsForm`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent pool stats, missing server stats, add/update guards for blank label or host, no editing server ID, and empty server forms are covered.
- Boundary values: first-server move up, last-server move down, missing server ID, middle-server reorder, failed/successful singleton tests, failed/successful server tests, and invalid port fallback remain covered.
- System boundaries: `NetworkConnectionCard`, `ServerForm`, `SingletonConfig`, and `PoolConfig` public imports remain unchanged; admin API payloads, node-config field names, server priority updates, callback props, and visible button copy remain unchanged.
- Async/race behavior: no new async state model was introduced; test status timers, server action loading resets, and error logging stay on the same handler paths.
- Diff review: changes are scoped to NetworkConnectionCard and ServerForm extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 6 - Transaction List

Status: complete

Goal: reduce the current TransactionList lizard cluster by splitting the transaction statistics, virtual table, details modal, label editor, and flow-preview mapping helpers without changing row click behavior, label editing, AI suggestions, transaction details status/type/address rendering, wallet badges, running balance columns, or public exports.

## Lizard UI Batch 6 Checklist

- [x] Confirm pushed AgentManagement CI status and clean local baseline.
- [x] Inspect current top lizard targets and TransactionList test coverage.
- [x] Split TransactionList statistics/table/details modal helpers while preserving visible copy and callbacks.
- [x] Split LabelEditor and FlowPreview warning helpers while preserving label and flow rendering.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 6 Review

Changes:

- Reduced `components/TransactionList/TransactionList.tsx` to a 167-line orchestration module and moved stats, virtual-table rendering, table headers, details modal, amount/status hero, metadata cards, address blocks, and modal helpers into focused modules under `components/TransactionList/TransactionList/`.
- Split `components/TransactionList/LabelEditor.tsx` into header, editing, read-only, and shared type modules while preserving edit/save/cancel, selected-label toggles, AI suggestions, legacy labels, and no-label rendering.
- Split `components/TransactionList/FlowPreview.tsx` mapping, total, and guard helpers into `components/TransactionList/FlowPreview/flowPreviewModel.ts`, preserving loading, empty-input, output-label, change-output, fee, and total rendering behavior.
- Added focused branch coverage for the extracted own-address null guard and updated health tracking: full lizard warnings moved from 91 to 88, and `TransactionList`, `LabelEditor`, and `FlowPreview` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/TransactionList.test.tsx tests/components/TransactionList/TransactionList.branches.test.tsx tests/components/TransactionList/LabelEditor.test.tsx tests/components/TransactionList/FlowPreview.branches.test.tsx tests/components/TransactionList/useTransactionList.branches.test.tsx` passed: 5 files, 53 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 397 files, 5,561 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionList/TransactionList.tsx components/TransactionList/TransactionList components/TransactionList/LabelEditor.tsx components/TransactionList/LabelEditor components/TransactionList/FlowPreview.tsx components/TransactionList/FlowPreview tests/components/TransactionList/TransactionList.branches.test.tsx` passed with no warnings.
- Full lizard warning count is now 88; top remaining component targets are `AddressesTab`, `NetworkConnectionCard`, `DeviceDetail`, and `QRSigningModal`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing full transaction details, empty flow inputs, missing outputs, absent counterparty address, absent own address, missing timestamp, zero block height, and empty label inventories are covered.
- Boundary values: 0 confirmations, partial confirmations, deep confirmations, 0 fees, positive fees, receive/send amounts, and self-transfer consolidation address titles remain covered.
- System boundaries: `TransactionList`, `LabelEditor`, and `FlowPreview` public imports remain unchanged; hook payloads, row click callbacks, label callbacks, AI suggestions, action-menu wiring, wallet badges, running balance columns, explorer copy behavior, and user-facing copy remain unchanged.
- Async/race behavior: no new async state model was introduced; existing details loading, label saving, and copy flows still run through the same hook handlers.
- Diff review: changes are scoped to TransactionList extraction, one branch assertion, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 5 - Agent Management

Status: complete

Goal: reduce the current AgentManagement lizard cluster by splitting `AgentRow` and `AgentFormModal` rendering/controller helpers without changing agent CRUD, scoped key issue/revoke, owner funding overrides, wallet/device filtering, policy/monitoring fields, or public exports.

## Lizard UI Batch 5 Checklist

- [x] Confirm pushed Account CI status and clean local baseline.
- [x] Inspect current top lizard targets and AgentManagement test coverage.
- [x] Split AgentRow details/key/action rendering while preserving callbacks and labels.
- [x] Split AgentFormModal initialization/filtering/rendering helpers while preserving form behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 5 Review

Changes:

- Reduced `components/AgentManagement/index.tsx` to a 427-line orchestration/key-modal module and moved the row rendering into focused `AgentRow`, header, info-grid, summary, key-list, action-button, and view-model modules.
- Moved `AgentFormModal` initialization, wallet/device filtering, selection reconciliation, fields, toggles, and form sections into focused modules under `components/AgentManagement/AgentManagement/`.
- Added `tests/components/AgentManagement.extracted.branches.test.tsx` to cover extracted status badges, empty/active key rendering, row view-model fallbacks, invalid form selection reconciliation, null form initialization values, and toggled modal booleans.
- Updated the health assessment and grade history: full lizard warnings moved from 93 to 91, max CCN moved from 55 to 53, and `AgentManagement` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/AgentManagement.extracted.branches.test.tsx tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts tests/components/AgentWalletDashboard.test.tsx` passed: 4 files, 21 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 397 files, 5,561 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AgentManagement/index.tsx components/AgentManagement/AgentManagement tests/components/AgentManagement.extracted.branches.test.tsx` passed with no warnings.
- Full TSX-aware lizard warning count is now 91; top remaining component targets are `TransactionList`, `NetworkConnectionCard`, `AddressesTab`, and `DeviceDetail`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent `apiKeys`, missing agent user/wallet/device summaries, null policy and monitoring values, and create-form defaults are covered.
- Boundary values: 0 active keys, 1 active key, plural active-key text, blank required form fields, invalid downstream wallet/device selections, and null numeric initialization are covered.
- System boundaries: `AgentManagement` public export, admin API payload builders, key issue/revoke behavior, owner override modal wiring, labels, and user-facing copy remain unchanged.
- Async/race behavior: no new async state model was introduced; existing create/update/key/override flows and load refreshes still run through the same `runAction`/`loadData` paths.
- Diff review: changes are scoped to AgentManagement extraction, focused branch coverage, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 4 - Account

Status: complete

Goal: reduce the current top `Account` lizard finding without changing profile rendering, password validation/submission, 2FA setup/disable/regenerate flows, backup-code copy behavior, modal close/reset behavior, or public exports.

## Lizard UI Batch 4 Checklist

- [x] Confirm pushed ThemeSection CI status and clean local baseline.
- [x] Inspect current top lizard target and Account test coverage.
- [x] Split Account state/handlers and rendering while preserving the public import path.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 4 Review

Changes:

- Reduced `components/Account/Account.tsx` to an 18-line public wrapper and moved password state/submission into `components/Account/Account/usePasswordChangeController.ts`.
- Moved 2FA setup, enable, disable, regenerate, modal reset, and backup-code copy state into `components/Account/Account/useTwoFactorController.ts` with small validation/error helpers.
- Split profile rendering and modal wiring into `ProfileInformation`, `AccountView`, and `AccountModals` while preserving the existing child component contracts and `components/Account` public export.
- Added a focused Account branch test for the no-email profile path needed by the 100% coverage gate.
- Updated the health assessment and grade history: full lizard warnings moved from 94 to 93, and `Account` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/Account.test.tsx tests/components/Account.branches.test.tsx tests/components/Account/PasswordForm.branches.test.tsx tests/components/Account/SetupTwoFactorModal.test.tsx tests/components/Account/DisableTwoFactorModal.branches.test.tsx tests/components/Account/BackupCodesModal.test.tsx` passed: 6 files, 39 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,557 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Account/Account.tsx components/Account/Account` passed with no warnings.
- Full lizard warning count is now 93; top remaining component targets are `AgentManagement`, `TransactionList`, `NetworkConnectionCard`, and `DeviceDetail`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing user/email remains tolerated, empty password fields still fail through existing required inputs or guard logic, and absent backup codes still copy an empty joined string only through the existing copy-all path.
- Boundary values: password mismatch and minimum length checks remain unchanged, setup verification still requires at least six characters, and disable/regenerate guards still require both password and token.
- System boundaries: `authApi.changePassword`, `twoFactorApi` payload shapes, clipboard utility calls, modal prop names, and `components/Account` exports remain unchanged.
- Async/race behavior: password success and copied-code timers still clear their visible state after the same 3000 ms and 2000 ms delays; loading flags still reset in `finally` blocks.
- Diff review: changes are scoped to Account controller/view/helper extraction, one branch test, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 3 - Theme Section

Status: complete

Goal: batch the current ThemeSection lizard cluster by reducing `AppearanceTab` and `BackgroundsPanel` complexity without changing theme selection, background search/category/favorite behavior, seasonal background toggles, per-season configuration, visual settings, or public exports.

## Lizard UI Batch 3 Checklist

- [x] Confirm pushed BlockVisualizer CI status and clean local baseline.
- [x] Inspect current top lizard targets and ThemeSection test coverage.
- [x] Split AppearanceTab data/controller/view helpers while preserving the public import path.
- [x] Split BackgroundsPanel search, category, grid, and seasonal rendering/helpers while preserving behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 3 Review

Changes:

- Reduced `components/Settings/sections/ThemeSection/AppearanceTab.tsx` to a 9-line public wrapper and moved preference derivation, theme/background mapping, favorite toggles, and seasonal updates into focused modules under `components/Settings/sections/ThemeSection/AppearanceTab/`.
- Reduced `components/Settings/sections/ThemeSection/panels/BackgroundsPanel.tsx` to a 21-line public wrapper and moved category filtering, search filtering, counts, tile view models, seasonal toggle state, and seasonal rows into focused modules under `components/Settings/sections/ThemeSection/panels/BackgroundsPanel/`.
- Preserved public `AppearanceTab` and `BackgroundsPanel` exports plus theme selection, background selection, favorites, search clear, category empty states, seasonal enable/disable, and per-season background updates.
- Updated the health assessment and grade history: full lizard warnings moved from 96 to 94, and `AppearanceTab` plus `BackgroundsPanel` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/Settings/sections/ThemeSection/AppearanceTab.branches.test.tsx tests/components/Settings/sections/ThemeSection/panels/BackgroundsPanel.branches.test.tsx tests/components/ThemeSection.test.tsx` passed: 3 files, 10 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Settings/sections/ThemeSection/AppearanceTab.tsx components/Settings/sections/ThemeSection/AppearanceTab components/Settings/sections/ThemeSection/panels/BackgroundsPanel.tsx components/Settings/sections/ThemeSection/panels/BackgroundsPanel` passed with no warnings.
- Full lizard warning count is now 94; top remaining component targets are `Account`, `AgentManagement`, `TransactionList`, and `NetworkConnectionCard`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing user preferences still fall back to `sanctuary`, `zen`, non-dark mode, empty favorites, and default visual settings; missing seasonal maps still use registry defaults; empty favorites/search/category states still render the same messages.
- Boundary values: category counts still exclude favorite IDs that are not available backgrounds, opacity/contrast values pass through unchanged, and the seasonal toggle still falls back to `minimal` when disabling the current seasonal background.
- System boundaries: public ThemeSection exports, panel props, user preference update shapes, theme registry calls, and icon mapping calls remain unchanged.
- Async/race behavior: this batch does not add async work; state changes remain local React state updates or existing `updatePreferences` calls.
- Diff review: changes are scoped to ThemeSection controller/view/helper extraction, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 2 - Block Visualizer

Status: complete

Goal: batch the current BlockVisualizer lizard cluster by reducing `BlockVisualizer`, `Block`, `QueuedSummaryBlock`, and `PendingTxDot` complexity without changing mempool/confirmed block ordering, queued/stuck transaction display, explorer links, animation timing, compact layout, or public exports.

## Lizard UI Batch 2 Checklist

- [x] Confirm pushed Labels/Notifications CI status and clean local baseline.
- [x] Inspect current top lizard targets and BlockVisualizer test coverage.
- [x] Split BlockVisualizer orchestration/rendering while preserving public import paths.
- [x] Split Block, queued-summary, and pending-dot rendering/helpers while preserving behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 2 Review

Changes:

- Reduced `components/BlockVisualizer/BlockVisualizer.tsx` to a 24-line public wrapper and moved block animation state, pending/confirmed splitting, explorer navigation, and queue-summary selection into focused modules under `components/BlockVisualizer/BlockVisualizer/`.
- Reduced `components/BlockVisualizer/Block.tsx` to a 10-line public wrapper and moved block view-model formatting, pending-transaction dot limits, fullness rendering, and tooltip rendering into focused modules under `components/BlockVisualizer/Block/`.
- Split `components/BlockVisualizer/QueuedSummaryBlock.tsx` and `components/BlockVisualizer/PendingTxDot.tsx` into small entrypoints plus view/helper modules while preserving explorer links, stuck transaction indicators, compact rendering, and public imports.
- Updated the health assessment and grade history: full lizard warnings moved from 100 to 96, and `BlockVisualizer`, `Block`, `QueuedSummaryBlock`, and `PendingTxDot` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/BlockVisualizer/BlockVisualizer.branches.test.tsx tests/components/BlockVisualizer/Block.test.tsx tests/components/BlockVisualizer/QueuedSummaryBlock.test.tsx tests/components/BlockVisualizer/PendingTxDot.test.tsx tests/components/BlockVisualizer/blockUtils.test.ts` passed: 5 files, 38 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/BlockVisualizer/BlockVisualizer.tsx components/BlockVisualizer/BlockVisualizer components/BlockVisualizer/Block.tsx components/BlockVisualizer/Block components/BlockVisualizer/QueuedSummaryBlock.tsx components/BlockVisualizer/QueuedSummaryBlock components/BlockVisualizer/PendingTxDot.tsx components/BlockVisualizer/PendingTxDot` passed with no warnings.
- Full lizard warning count is now 96; top remaining component targets are `AppearanceTab`, `Account`, `AgentManagement`, and `TransactionList`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing blocks still show the loading state, absent queued summaries still render only when stuck transactions exist, optional pending transaction arrays still default empty, and absent recipient previews still omit the tooltip recipient row.
- Boundary values: pending dot overflow still uses compact/non-compact limits of 3/5, block fullness remains capped at 100%, median fees below 1 sat/vB keep one decimal, and pending mempool block indices still count from the newest displayed pending block.
- System boundaries: public `BlockVisualizer`, `Block`, `QueuedSummaryBlock`, and `PendingTxDot` import paths and prop contracts remain unchanged; explorer URLs still target block, mempool-block, and transaction routes.
- Async/race behavior: block animation timeouts still clear on unmount and before new animations, and delayed display-block swaps still reset animation flags.
- Diff review: changes are scoped to BlockVisualizer controller/view/helper extraction, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 1 - Labels And Notifications

Status: complete

Goal: batch the next top UI lizard findings by reducing `LabelManager`, `NotificationToast`, and `NotificationPanel`/`NotificationItem` complexity without changing label CRUD behavior, toast timing/styles, notification sorting/navigation, panel dismissal, or public exports.

## Lizard UI Batch 1 Checklist

- [x] Confirm pushed SendTransactionPage CI status and local baseline.
- [x] Inspect current top lizard targets and focused test coverage.
- [x] Split LabelManager into controller/view modules while preserving the public import path.
- [x] Split notification toast/panel helpers and item views while preserving public exports.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 1 Review

Changes:

- Reduced `components/LabelManager.tsx` to a 10-line public wrapper and moved label CRUD state, mutation error handling, delete confirmation, and form behavior into focused controller/view modules under `components/LabelManager/`.
- Reduced `components/NotificationToast.tsx` to the public toast/container exports and moved toast dismiss timing plus icon/color selection into focused modules under `components/NotificationToast/`.
- Split `components/NotificationPanel.tsx` into a small public panel/bell entrypoint, a controller hook, frame/content rendering, item rendering, and notification helper rules under `components/NotificationPanel/`.
- Preserved public import paths and exports for `LabelManager`, `NotificationToast`, `NotificationContainer`, `generateNotificationId`, `NotificationPanel`, and `NotificationBell`.
- Updated the health assessment and grade history: full lizard warnings moved from 104 to 100, and `LabelManager`, `NotificationToast`, `NotificationPanel`, and `NotificationItem` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/LabelManager.test.tsx tests/components/NotificationToast.test.tsx tests/components/NotificationToast.branches.test.tsx tests/components/NotificationPanel.test.tsx tests/components/NotificationPanel.branches.test.tsx` passed: 5 files, 95 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/LabelManager.tsx components/LabelManager components/NotificationToast.tsx components/NotificationToast components/NotificationPanel.tsx components/NotificationPanel` passed with no warnings.
- Full lizard warning count is now 100; top remaining component targets are `BlockVisualizer`, `AppearanceTab`, `Account`, and `AgentManagement`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent label data still renders an empty list, optional label descriptions/counts remain conditional, empty toast messages still omit message copy, and empty notification panels still render the "All caught up!" state.
- Boundary values: toast overflow still uses the four-notification visible limit and singular/plural hidden count wording; notification bell count still caps at `9+`; label save remains disabled for trimmed blank names.
- System boundaries: public component entrypoints, notification IDs, notification navigation state, label hook calls, and toast dismiss timing remain unchanged.
- Async/race behavior: toast exit timers still clean up on repeated dismiss/unmount, auto-dismiss timers still clear on unmount, and notification panel outside-click/Escape listeners still register only while open.
- Diff review: changes are scoped to label and notification presentation/controller extraction, health-report notes, trend metadata, and this task record.

## Previous Task: SendTransactionPage Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the current top high-CCN send transaction page without changing wallet loading, draft resume, preselected UTXO, viewer redirect, device matching, fee, mempool, or wizard behavior.

## SendTransactionPage Complexity Checklist

- [x] Confirm pushed LabelSelector CI status and local baseline.
- [x] Inspect current top lizard targets and SendTransactionPage test coverage.
- [x] Split SendTransactionPage into focused controller/helper/view modules while preserving the public import path and exports.
- [x] Run focused tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update health/grade tracking and commit the change after verification.

## SendTransactionPage Complexity Review

Changes:

- Reduced `components/send/SendTransactionPage.tsx` to a 48-line public wrapper that chooses loading, error, and wizard render states.
- Added focused modules under `components/send/SendTransactionPage/` for loading/error views, route/controller orchestration, API loading, shared page types, and formatting/draft/preselected-UTXO helpers.
- Preserved viewer redirect, wallet formatting, fee formatting, UTXO mapping, mempool fallback, address mapping, wallet-device association and descriptor-fingerprint matching, draft resume, RBF selected-UTXO preservation, unavailable-UTXO warnings, preselected frozen-UTXO removal, and wizard props.
- Updated the health assessment and grade history: full lizard warnings moved from 105 to 104, and `SendTransactionPage` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/send/SendTransactionPage.test.tsx tests/components/send/SendTransactionPage.branches.test.tsx` passed: 2 files, 32 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/send/SendTransactionPage.tsx components/send/SendTransactionPage` passed with no warnings.
- Full lizard warning count is now 104; top remaining component targets are `LabelManager`, `NotificationToast`, `NotificationItem`, and `BlockVisualizer`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent user/id still avoids API fetches; empty/failed mempool, address, and device calls preserve fallback arrays/nulls; empty address data still skips label lookup addresses.
- Boundary values: minimum fee fallback remains `1`; preselected frozen-UTXO warnings still use singular/plural wording; all-frozen preselection leaves initial state empty.
- System boundaries: public `SendTransactionPage` import path, wizard prop names, API modules, route state shape, and transaction state serialization shape are unchanged.
- Async/race behavior: unmount during parallel requests still avoids setting page data after the mounted guard flips false.
- Diff review: changes are scoped to SendTransactionPage orchestration extraction, health-report notes, trend metadata, and this task record.

## Previous Task: LabelSelector Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the next tied high-CCN label selector component without changing label selection, creation, search, inline mode, or `LabelBadges` behavior.

## LabelSelector Complexity Checklist

- [x] Confirm pushed DraftList CI status and local baseline.
- [x] Inspect current top lizard targets and LabelSelector test coverage.
- [x] Split LabelSelector into focused controller/view modules while preserving the public import path and exports.
- [x] Run focused tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update review notes and commit the change.

## LabelSelector Complexity Review

Changes:

- Reduced `components/LabelSelector.tsx` to a 45-line public wrapper while preserving the default export, named export, `LabelBadges`, and public prop types.
- Added focused modules under `components/LabelSelector/` for dropdown rendering, inline rendering, reusable label chips, badges, controller state, and shared types.
- Preserved label selection/removal, search, create-label form behavior, outside-click close behavior, disabled state handling, inline mode behavior, and `LabelBadges` truncation behavior.
- Updated the health assessment and grade history: full lizard warnings moved from 106 to 105, and `LabelSelector` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/LabelSelector.test.tsx` passed: 1 file, 43 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/LabelSelector.tsx components/LabelSelector` passed with no warnings.
- Full lizard warning count is now 105; top remaining component targets are `SendTransactionPage`, `LabelManager`, `NotificationToast`, and `NotificationItem`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: `LabelBadges` still returns null for absent/empty labels; dropdown empty, loading, and search-no-results states remain covered.
- Boundary values: create-label still trims blank names, preserves Escape behavior, and handles create failures through the existing mutation path.
- System boundaries: public `LabelSelector` import path, props, exports, wallet-label hooks, and label type contracts are unchanged.
- Async/race behavior: outside-click cleanup, dropdown/input refs, and create mutation loading state remain isolated in the controller.
- Diff review: changes are scoped to LabelSelector presentation/controller extraction, health-report notes, trend metadata, and this task record.

## Previous Task: DraftList Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the current top high-CCN draft-list component without changing draft ordering, PSBT import/export behavior, or coverage thresholds.

## DraftList Complexity Checklist

- [x] Confirm the pushed TransactionRow slice started clean CI and inspect the next lizard target.
- [x] Extract DraftList sorting, PSBT parsing, download helpers, and controller logic into focused modules with low per-function CCN.
- [x] Run focused DraftList tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update health/grade tracking and commit the change after verification.

## DraftList Complexity Review

Changes:

- Reduced `components/DraftList/DraftList.tsx` to a 107-line render surface.
- Added `components/DraftList/draftListHelpers.ts` for expiration sorting, PSBT blob/filename helpers, signed-status selection, and PSBT file parsing.
- Added `components/DraftList/useDraftListController.ts` for draft loading, delete, resume, PSBT download/upload, address labeling, and expansion state.
- Preserved the existing DraftList public export and child component contracts.
- Updated the health assessment and grade history: full lizard warnings moved from 107 to 106, and `DraftList` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/DraftList.test.tsx tests/components/DraftList/DraftList.branches.test.tsx tests/components/DraftList/DraftRow.branches.test.tsx tests/components/DraftList/utils.branches.test.ts` passed: 4 files, 43 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DraftList/DraftList.tsx components/DraftList/draftListHelpers.ts components/DraftList/useDraftListController.ts` passed with no warnings.
- Full lizard warning count is now 106; top remaining component targets are `LabelSelector`, `LabelManager`, `SendTransactionPage`, and `NotificationToast`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty draft lists, absent expiration, absent wallet labels, missing draft upload targets, and optional signed PSBT fallback behavior remain covered.
- Boundary values: expiration ordering still covers expired, critical, warning, normal, and no-expiration drafts; binary/base64/hex/invalid PSBT upload paths remain covered.
- System boundaries: public `DraftList` export, props, row callbacks, API calls, and download behavior are unchanged.
- Async/race behavior: load/delete/upload still go through `useLoadingState`; file upload still reloads drafts only after a non-null operation result.
- Diff review: changes are scoped to DraftList orchestration extraction, helper reuse, health-report notes, trend metadata, and this task record.

## Previous Task: TransactionRow Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the next high-CCN transaction-list component without changing row behavior or weakening coverage gates.

## TransactionRow Complexity Checklist

- [x] Confirm pushed grade-improvements CI status and local baseline.
- [x] Inspect current top lizard targets and TransactionRow test coverage.
- [x] Split TransactionRow into focused row/cell modules while preserving the public import path.
- [x] Run focused tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update review notes and commit the change.

## TransactionRow Complexity Review

Changes:

- Kept `components/TransactionList/TransactionRow.tsx` as the public wrapper and reduced it to 52 lines.
- Added focused cell helpers under `components/TransactionList/TransactionRow/` for date, type, amount, balance, confirmation, labels, and wallet badge rendering.
- Added a branch test for the locked-without-draft-label fallback title that the split made visible to coverage.
- Updated the health assessment and grade history: full lizard warnings moved from 108 to 107, and `TransactionRow` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/TransactionList/TransactionRow.branches.test.tsx tests/components/TransactionList.test.tsx` passed: 2 files, 37 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionList/TransactionRow.tsx components/TransactionList/TransactionRow` passed with no warnings.
- Full lizard warning count is now 107; top remaining component targets are `DraftList`, `LabelSelector`, `LabelManager`, and `SendTransactionPage`.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: row behavior still covers pending timestamps, empty labels, absent balance columns, absent wallet badges, and missing draft labels.
- Boundary values: confirmation branches still cover pending, partial, threshold, and deep-confirmed states.
- System boundaries: public import path and `TransactionRow` props are unchanged for `TransactionList`.
- Async/race behavior: unchanged; row rendering remains synchronous and callback-driven.
- Diff review: changes are scoped to TransactionRow presentation extraction, one focused branch test, health-report notes, trend metadata, and this task record.

## Previous Task: Grade Improvements 3-5

Status: complete

Goal: after pushing the large-file gate fix, address the next grade improvement set: reduce complexity debt, improve warning-band file-size pressure where practical, and make gitleaks grading more reproducible.

## Grade Improvements 3-5 Checklist

- [x] Push the agent repository large-file gate fix.
- [x] Inspect top lizard complexity targets and warning-band file-size targets.
- [x] Inspect current gitleaks availability/tooling path.
- [x] Implement the smallest safe improvement that advances items 3-5.
- [x] Run focused verification and update review notes.

## Grade Improvements 3-5 Review

Changes:

- Split `components/WalletStats.tsx` into a 52-line wrapper plus focused summary-card, chart, and data-helper modules under `components/WalletStats/`.
- Moved dashboard repository aggregation tests from `server/tests/unit/repositories/agentRepository.test.ts` into `server/tests/unit/repositories/agentDashboardRepository.test.ts`, reducing `agentRepository.test.ts` from 890 lines to 724 lines.
- Added pinned gitleaks resolution/bootstrap to `scripts/quality.sh` using `GITLEAKS_VERSION=8.30.1` and `.tmp/quality-tools/gitleaks-8.30.1/gitleaks`, while preserving explicit `GITLEAKS_BIN`.
- Confirmed the pushed large-file fix has Build Dev Images, Release, and Install Tests green; Test Suite was still in progress during local remediation.

Verification:

- `npx vitest run tests/components/WalletStats.test.tsx` passed: 23 tests.
- `npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/agentDashboardRepository.test.ts` passed: 2 files, 13 tests.
- `npm run test:coverage` passed: 396 files, 5,555 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` passed: 390 files passed, 22 skipped; 9,151 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run typecheck:app` and `npm run typecheck:server:tests` passed.
- `npm run lint:app` and `npm run lint:server` passed.
- `bash -n scripts/quality.sh` passed.
- `QUALITY_SKIP_* ... QUALITY_BOOTSTRAP_TOOLS=0 npm run quality` passed the gitleaks-only lane through the pinned `.tmp/quality-tools/gitleaks-8.30.1/gitleaks` path.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletStats.tsx components/WalletStats ...` passed for the touched files; full lizard warning count moved from 110 to 108 and max CCN from 67 to 65.
- `node scripts/quality/check-large-files.mjs` passed with warning-band files reduced to 9.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: WalletStats still handles empty UTXOs, empty transactions, missing UTXO dates, null fiat values, and missing BTC price through existing tests.
- Boundary values: UTXO age buckets still cover `< 1m`, `1-6m`, `6-12m`, and `> 1y`; accumulation history still keeps the last balance per display date.
- System boundaries: dashboard repository behavior is unchanged; tests now import the dashboard repository directly while `agentRepository.findDashboardRows` remains exported for callers.
- Async/race behavior: chart rendering still waits on `useDelayedRender`; gitleaks tooling resolution is synchronous before scans start.
- Diff review: changes are scoped to the WalletStats split, dashboard test relocation, pinned gitleaks quality tooling, health-report notes, and this task record.

## Previous Task: Agent Repository Large File Remediation

Status: complete

Goal: fix the large-file quality gate by reducing `server/src/repositories/agentRepository.ts` below the 1,000-line limit without weakening the policy or changing agent dashboard behavior.

## Agent Repository Large File Checklist

- [x] Inspect large-file policy and agent repository dashboard responsibilities.
- [x] Extract dashboard read-model code into a focused repository module while preserving existing public imports.
- [x] Run focused agent repository/API tests and quality gates.
- [x] Update task notes and self-review the diff.

## Agent Repository Large File Review

Changes:

- Extracted admin agent dashboard read-model assembly from `server/src/repositories/agentRepository.ts` into `server/src/repositories/agentDashboardRepository.ts`.
- Preserved `agentRepository.findDashboardRows` and the existing dashboard type exports for current callers.
- Reduced `server/src/repositories/agentRepository.ts` from 1,006 lines to 720 lines; the new dashboard repository is 354 lines.
- Added a focused dashboard default test for the missing wallet-balance aggregate row branch so backend coverage stays at 100%.
- Updated the health assessment and grade history to reflect that the large-file policy is green again.

Verification:

- `npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/agent/dto.test.ts` passed: 3 files, 34 tests.
- `npm run test:backend:coverage` passed outside the sandbox: 389 files passed, 22 skipped; 9,151 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run lint:server` passed, including `check:api-body-validation`.
- `npm run typecheck:server:tests` passed.
- `npm run check:architecture-boundaries` passed.
- `node scripts/quality/check-large-files.mjs` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w server/src/repositories/agentDashboardRepository.ts` passed with no warnings.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: dashboard aggregation still short-circuits with no agents; absent balance/count/recent rows default to zero, null, or empty arrays.
- Boundary values: `DASHBOARD_RECENT_LIMIT` remains unchanged at 3; pending draft statuses remain `unsigned`, `partial`, and `signed`.
- System boundaries: raw SQL remains Prisma-tagged and parameterized; no route, DTO, or service API changed.
- Async/race behavior: dashboard aggregation still runs independent grouped/windowed reads in one `Promise.all` and does not introduce shared mutable state.
- Diff review: changes are scoped to dashboard repository extraction, one focused branch test, health-report status, trend metadata, and this task record.

## Previous Task: Full Repository Quality Grade

Status: complete

Goal: run the `$grade` skill against the repository at HEAD, update `docs/plans/codebase-health-assessment.md` with evidence-backed ISO/IEC 25010 scores, and record trend history without changing unrelated code.

## Full Repository Quality Grade Checklist

- [x] Confirm repository state, audit mode, and grading standards.
- [x] Run the grade skill's mechanical signal collectors.
- [x] Inspect targeted files for judged reliability, maintainability, security, performance, test-quality, and operational-readiness criteria.
- [x] Write/update the health assessment report and trend entry.
- [x] Verify the report, task notes, and final workspace state.

## Full Repository Quality Grade Review

Changes:

- Updated `docs/plans/codebase-health-assessment.md` with a full-mode ISO/IEC 25010-aligned grade for commit `d43680aa`.
- Appended the 2026-04-19 full-mode trend entry to `docs/plans/grade-history/sanctuary_.jsonl`.
- Recorded the current score as `92/100`, grade `A`, confidence `High`.

Verification:

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed with tests, lint, typecheck, and heuristic signals.
- `npm run test:coverage` passed with 100% app statements, branches, functions, and lines.
- `npm run test:backend:coverage` passed outside the sandbox with 100% backend statements, branches, functions, and lines after the sandbox run failed with `listen EPERM`.
- `npm run test:coverage` in `gateway` passed outside the sandbox with 100% gateway statements, branches, functions, and lines after the sandbox run failed with `listen EPERM`.
- `npm audit --json`, `npm --prefix server audit --json`, `npm --prefix gateway audit --json`, and `npm --prefix ai-proxy audit --json` found 0 high/critical advisories.
- `gitleaks` completed clean after normalizing a prior grade-history metadata value to the documented schema.
- `lizard` reported 110 CCN warnings, average CCN 1.4, and max CCN 67.
- `jscpd` reported 2.1% duplication.
- `npm run check:architecture-boundaries`, `npm run check:browser-auth-contract`, and `npm run check:openapi-route-coverage` passed.
- `node scripts/quality/check-large-files.mjs` failed on unclassified oversized `server/src/repositories/agentRepository.ts`.

Edge case and self-review:

- Null/undefined and empty inputs: judged validation and tests include request schema parsing, runtime config bounds, null/default schema cases, and empty-state behavior across sampled app/server/gateway tests.
- Boundary values: coverage gates are back at the repository's 100% threshold; config schemas constrain ports, retry counts, timeouts, and batch sizes.
- System boundaries: audits cover dependency advisories, clean gitleaks secret scanning, trust-boundary validation, browser auth contracts, OpenAPI route coverage, and architecture boundaries.
- Async/race behavior: request timeout, retry/backoff, async utility, and local listener behavior were checked; backend/gateway coverage needed non-sandbox execution for `supertest` listener permissions.
- Diff review: changes are scoped to grade documentation, trend history, and this task record.

## Previous Task: GitHub Actions Node 20 Annotation Cleanup

Status: complete

Goal: remove the GitHub Actions Node.js 20 deprecation annotation by updating the changed-files action to a Node.js 24-compatible release without changing CI lane behavior.

## GitHub Actions Node 20 Annotation Checklist

- [x] Confirm the annotation source and current workflow usage.
- [x] Verify the upstream `dorny/paths-filter` release that runs on Node.js 24.
- [x] Patch `.github/workflows/test.yml` with the smallest compatible action update.
- [x] Validate workflow diff, commit, push, and verify the new CI run.

## GitHub Actions Node 20 Annotation Review

Changes:

- Confirmed the only Node.js 20 annotation source in this repository was `dorny/paths-filter@v3` in `.github/workflows/test.yml`.
- Verified upstream `dorny/paths-filter` has a v4 release line and that `v4` declares `runs.using: node24`.
- Updated the changed-files detection step from `dorny/paths-filter@v3` to `dorny/paths-filter@v4` without changing filters, outputs, permissions, or job gating logic.

Verification:

- `git diff --check` passed.
- Parsed `.github/workflows/test.yml` with the repository's existing `js-yaml` dependency.
- Confirmed there are no remaining `dorny/paths-filter@v3` references under `.github`.

Edge case and self-review:

- Null/empty inputs: workflow filter definitions and outputs are unchanged, so empty changed-file sets still follow the existing `false` output behavior.
- Boundary values: PR and push event gating remains unchanged; scheduled runs still skip `detect-changes` through the existing job `if`.
- System boundaries: no test commands, permissions, or checkout behavior changed; only the action runtime provider moved to the Node.js 24-compatible major version.
- Diff review: changes are scoped to the one workflow action version and this task record.

## Previous Task: GitHub Permission Failure CI Fix

Status: complete

Goal: fix the failing GitHub Actions E2E run that presents as missing permissions by addressing the render-regression screenshots where primary controls paint white-on-white before theme utilities are ready.

## GitHub Permission Failure Checklist

- [x] Inspect the failing GitHub Actions run and confirm the actual failing job/log lines.
- [x] Patch the render regression path so screenshots wait for theme variables and Tailwind theme utilities.
- [x] Run targeted local validation for the render regression suite and relevant static checks.
- [x] Commit, push, and verify the new GitHub run.

## GitHub Permission Failure Review

Changes:

- Confirmed the failing GitHub job was `Full E2E Tests`, specifically Chromium render-regression screenshots where primary controls rendered white-on-white.
- Fixed the Tailwind CDN load path so the project config is retained after the CDN script replaces `window.tailwind`, and pinned the CDN URL to the v3.4.17 runtime the unversioned URL already redirects to.
- Added a render-regression readiness gate that waits for theme CSS variables, a `theme-*` body class, and a generated `bg-primary-800` utility before taking Chromium screenshots.

Verification:

- One-off browser runtime inspection confirmed `window.tailwind.config` now contains the custom `primary` color config and generated CSS includes custom theme utilities.
- `npm run test:e2e:render` passed: 43 Chromium render-regression tests.
- `npm run typecheck:tests` passed.
- `npm run build` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and missing DOM state: the screenshot readiness gate returns false until `document.body`, theme variables, theme class, and the probe element exist.
- Async/race behavior: the probe stays mounted long enough for Tailwind CDN's mutation observer to generate the class, is removed in a `finally` block, and screenshots wait two animation frames after readiness.
- System boundaries: the fix does not change wallet permissions, API auth, or role data; it restores theme utility generation and makes visual assertions wait for the same styling state users see.
- Diff review: changes are scoped to Tailwind CDN config loading, visual-regression readiness, and this task record.

## Previous Task: Restore 100% Coverage Gates

Status: complete

Goal: make the app, backend, and gateway coverage commands exit cleanly at the repository's 100% global thresholds without weakening the coverage policy.

## Restore 100% Coverage Checklist

- [x] Inspect exact uncovered app/backend statements, functions, and branches from current coverage artifacts.
- [x] Add the smallest focused tests or narrow justified coverage annotations for legitimate unreachable fallback branches.
- [x] Run app, backend, and gateway coverage commands until all pass.
- [x] Run final quality, edge case, and self-review, then update this review section.

## Restore 100% Coverage Review

Changes:

- Added focused app tests for formatter fallbacks, owner override load/create/revoke failures, import QR guard behavior, device preference defaults, node config control fallbacks, receive modal helpers, wallet draft notifications, and zero-pending balance display.
- Added backend tests for agent destination classification modes, known-address ownership lookups, metadata formatting, Telegram operational-spend copy, address repository dedupe/empty input behavior, and admin agent creator defaults.
- Simplified two legitimate dead/fallback coverage points: gateway audit fire-and-forget now relies on the sender's internal catch, and destination classification now documents the established non-empty current-output invariant with an explicit defensive guard.
- Added narrow `v8 ignore` annotations only for UI-disabled guards and async unmount race guards that are intentionally retained for defensive correctness.

Verification:

- `npm run test:coverage` passed: 396 app test files, 5555 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` passed: 380 backend test files passed, 22 skipped; 9096 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run test:coverage` passed in `gateway`: 20 gateway test files, 513 tests, 100% statements/branches/functions/lines.
- `npm run lint:app` passed.
- `npm run lint:server` passed, including `check:api-body-validation`.
- `npm run lint:gateway` passed.
- `npm run typecheck:app` passed.
- `npm run typecheck:tests` passed.
- `npm run typecheck:server:tests` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: covered null user preferences, undefined wallet IDs, null shared users, missing receive candidates, null transaction outputs, empty address lists, and missing operational-spend metadata.
- Boundary values: covered zero pending balance, invalid bigint formatter input, absent alert limits, all unknown-destination handling modes, and QR import data that is present but not yet scanned.
- System boundaries: backend classification still derives from persisted transaction details and known wallet address ownership; notification formatting remains informational and does not sign, approve, or broadcast.
- Async/race behavior: unmount guards for device loading, node config loading, and Payjoin URI loading remain intact; gateway audit dispatch remains fire-and-forget with errors handled inside the sender.
- Diff review: changes are scoped to coverage tests, two small invariant simplifications, and explicit annotations for retained defensive guards. Existing grade-report files remain modified from the prior `$grade` work and were not reverted.

## Previous Task: Agent Wallet Funding Phase 16

Status: complete

Goal: close the remaining Phase 16 monitoring and client follow-up from `tasks/agent-wallet-funding-plan.md` without weakening the security boundary that Sanctuary coordinates, not signs or broadcasts, agent wallet activity.

## Agent Wallet Funding Phase 16 Checklist

- [x] Inspect operational-wallet alert classification, Agent Wallets dashboard alert history, notification copy, and mobile review API/client-test surface.
- [x] Add operational-wallet destination classification for external spend, known self-transfer, change-like movement, and unknown destination.
- [x] Add configured unknown-destination handling mode to alert evaluation: notify only, pause agent, or both.
- [x] Surface destination classifications in Agent Wallets dashboard detail and alert history.
- [x] Preserve notification security boundaries for web/mobile review links and multisig signing requirements.
- [x] Add available server/API/component tests now, and document mobile/deep-link tests that depend on a future client package.
- [x] Run final quality, edge case, and self-review, then update `tasks/agent-wallet-funding-plan.md`.

## Agent Wallet Funding Phase 16 Review

Changes:

- Added operational destination classification for external spend, known self-transfer, change-like movement, and unknown destination using persisted transaction outputs, counterparty metadata, and known Sanctuary wallet address ownership.
- Added `operational_destination_unknown` alerts with destination metadata, dedupe by txid, and per-agent handling metadata for notify-only, pause-agent, notify-and-pause, and record-only states.
- Changed operational spend pausing so pause-only agents can pause on unknown destinations even when notifications are disabled, while notifications still only enrich agents with `notifyOnOperationalSpend`.
- Added audit detail for agent policy updates, including the derived unknown-destination handling mode.
- Surfaced destination classification and handling mode in the Agent Wallets dashboard spend details and alert history.
- Added Telegram operational-spend destination/handling copy and an explicit review-only security boundary: Sanctuary does not sign or broadcast operational wallet spends.
- Documented mobile/deep-link client tests as future work because this workspace has no mobile client package yet; existing server mobile review API tests remain in place.

Verification:

- `npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/formatting.test.ts` passed in `server`: 5 files, 60 tests.
- `npm run test:unit` passed in `server`: 372 files, 8999 tests.
- `npx vitest run tests/components/AgentWalletDashboard.test.tsx` passed: 1 file, 5 tests.
- `npm run build` passed in `server`.
- `npm run typecheck:server:tests` passed.
- `npm run typecheck:app` passed.
- `npm run typecheck:tests` passed.
- `npm run lint:app` passed.
- `npm run lint:server` passed, including API body validation.
- `npm run check:architecture-boundaries` passed.
- `npm run check:prisma-imports` passed in `server`.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing transaction rows, empty outputs, blank output addresses, missing counterparty addresses, no sent transactions, and wallets without active agents now no-op or classify as unknown destination without throwing.
- Boundary values: positive and negative sent amounts still normalize to outgoing spend amounts; zero or unset alert thresholds remain disabled; unknown alerts dedupe by txid across retries.
- System boundaries: classification reads stored outputs/address ownership only; notifications do not sign, approve, or broadcast; mobile review remains server/API-only until a client exists.
- Async/race behavior: alert evaluation remains best-effort and returns policy evaluations for notification enrichment/pause decisions; pause failures are logged without blocking notification dispatch.
- Diff review: changes are scoped to agent monitoring, notification enrichment, dashboard display, policy-audit metadata, and focused tests. The Phase 16 mobile/deep-link client checks are explicitly documented as future dependencies because no mobile app package is present in this repository.

## Previous Task: AccessTab CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/WalletDetail/tabs/AccessTab.tsx` at CCN 69, without changing wallet access display, owner/admin actions, sharing controls, transfer controls, or pending-transfer integration.

## AccessTab Checklist

- [x] Inspect AccessTab structure, wallet access helpers, and focused WalletDetail/access tests.
- [x] Extract access metadata, owner/admin action rendering, sharing sections, and transfer integration into focused modules.
- [x] Run focused AccessTab/WalletDetail tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## AccessTab Review

Changes:

- Replaced the render-heavy `components/WalletDetail/tabs/AccessTab.tsx` body with a small orchestrator that keeps the public props and parent `WalletDetail` contract unchanged.
- Added `components/WalletDetail/tabs/access/accessTabData.ts` for tab constants, owner display fallback data, shared-user filtering, and shared-access checks.
- Added focused ownership, sharing, user-search, shared-access-list, sub-tab, and transfers components under `components/WalletDetail/tabs/access/`.
- Preserved the legacy fallback where missing owner/user data renders owner name `You` but avatar initial `U`.
- Reduced `components/WalletDetail/tabs/AccessTab.tsx` from CCN 69 to no focused warning, with all new access modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/tabs/AccessTab.tsx components/WalletDetail/tabs/access` passed with no warnings.
- `npx vitest run tests/components/WalletDetail/tabs/AccessTab.test.tsx` passed: 1 file, 10 tests.
- `npx vitest run tests/components/WalletDetail/tabs` passed: 13 files, 131 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run check:architecture-boundaries` passed.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing `walletShareInfo`, missing owner rows, missing current user, empty shared users, and absent groups preserve the previous ownership and empty-sharing fallbacks.
- Boundary values: owner-only controls remain hidden for non-owners; selected group controls still render role buttons only when a group is selected; user search loading and empty result states are unchanged.
- System boundaries: `PendingTransfersPanel`, wallet share callbacks, group/user role update callbacks, and transfer completion callback contracts are unchanged.
- Async/race behavior: no async behavior moved into the new components; loading flags still only disable the same sharing buttons/selects.
- Diff review: changes are local to AccessTab rendering decomposition and task tracking. The next tracked plan item is Agent Wallet Funding Phase 16 from `tasks/agent-wallet-funding-plan.md`.

## Previous Task: PendingTransfersPanel CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/PendingTransfersPanel.tsx` at CCN 73, without changing pending-transfer display, accept/reject actions, ownership transfer behavior, or loading/error states.

## PendingTransfersPanel Checklist

- [x] Inspect PendingTransfersPanel structure, transfer-card helpers, and focused transfer tests.
- [x] Extract transfer metadata formatting, accept/reject handlers, state sections, and card rendering into focused modules.
- [x] Run focused PendingTransfersPanel tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## PendingTransfersPanel Review

Changes:

- Replaced the legacy root `components/PendingTransfersPanel.tsx` implementation with a compatibility export to the existing split `components/PendingTransfersPanel/PendingTransfersPanel.tsx` implementation, preserving the public import path.
- Exported `PendingTransfersPanelProps` from the split panel so the root type export remains available.
- Added `transferCardData.ts`, `TransferDirection.tsx`, `TransferMessage.tsx`, `TransferTimestamp.tsx`, and `TransferCardActions.tsx` to separate transfer-card variant metadata, direction labels, message rendering, expiry/timestamp rendering, and action buttons.
- Reduced `components/PendingTransfersPanel.tsx` from CCN 73 to no focused warning, and cleared the related `TransferCard.tsx` CCN 35 warning under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/PendingTransfersPanel.tsx components/PendingTransfersPanel` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/PendingTransfersPanel.test.tsx tests/components/PendingTransfersPanel.branches.test.tsx tests/components/PendingTransfersPanel/PendingTransfersPanel.test.tsx tests/components/PendingTransfersPanel/TransferCard.test.tsx tests/components/PendingTransfersPanel/TransferConfirmationModal.test.tsx tests/components/PendingTransfersPanel/useTransferActions.test.ts tests/components/PendingTransfersPanel/transferTimeUtils.test.ts` passed: 7 files, 96 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing usernames, missing transfer messages, no active transfers, and optional `onTransferComplete` still follow the existing split implementation behavior; null messages remain hidden.
- Boundary values: accepted transfers still fall back from `acceptedAt` to `updatedAt`, expiry text still handles expired/hour/day cases through `transferTimeUtils`, and action loading still disables only the matching transfer.
- System boundaries: `transfersApi` calls, root `components/PendingTransfersPanel` imports, `useUser`, `useLoadingState`, and transfer completion callbacks are unchanged.
- Async/race behavior: action loading and error clearing still live in `useTransferActions`; successful accept/decline/cancel/confirm still refresh transfers and close the modal in the same places.
- Diff review: changes are local to PendingTransfersPanel rendering/export wiring and preserve the public `PendingTransfersPanel` export. The next highest remaining single-component warning is `components/WalletDetail/tabs/AccessTab.tsx` at CCN 69.

## Previous Task: DraftRow CCN Remediation

Status: complete

Goal: reduce one of the next tied component hotspots, `components/DraftList/DraftRow.tsx` at CCN 73, without changing draft status display, signing/resume actions, labels, or delete behavior.

## DraftRow Checklist

- [x] Inspect DraftRow structure, draft-list helpers, and focused DraftList tests.
- [x] Extract draft metadata formatting, status/action rendering, labels, and row action handlers into focused modules.
- [x] Run focused DraftList/DraftRow tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## DraftRow Review

Changes:

- Added `components/DraftList/draftRowData.ts` for row class selection, signature counts, agent-funding checks, PSBT control visibility, and PSBT file selection handling.
- Added `DraftStatusBadges.tsx`, `DraftRecipientSummary.tsx`, `DraftAmountSummary.tsx`, `DraftWarnings.tsx`, `DraftRowActions.tsx`, and `DraftFlowToggle.tsx` to split status/expiration badges, recipient/output rendering, amount/fee rendering, warning/agent/label sections, row actions, and flow preview toggle.
- Reduced `components/DraftList/DraftRow.tsx` from CCN 73 to no focused warning, with all extracted DraftRow modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DraftList/DraftRow.tsx components/DraftList/DraftStatusBadges.tsx components/DraftList/DraftRecipientSummary.tsx components/DraftList/DraftAmountSummary.tsx components/DraftList/DraftWarnings.tsx components/DraftList/DraftRowActions.tsx components/DraftList/DraftFlowToggle.tsx components/DraftList/draftRowData.ts` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/DraftList.test.tsx tests/components/DraftList/DraftRow.branches.test.tsx tests/components/DraftList/DraftList.branches.test.tsx tests/components/DraftList/utils.branches.test.ts` passed: 4 files, 43 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing outputs still fall back to `draft.recipient`; missing expiration info still renders no expiration badge; missing quorum still falls back to one required signature.
- Boundary values: partial signatures still show `0 of 1` or configured quorum counts; send-max outputs still show `MAX` without fiat; expired drafts still disable resume while keeping other row controls consistent.
- System boundaries: `getFlowPreviewData`, `getFeeWarning`, `getExpirationInfo`, `onResume`, `onDelete`, `onDownloadPsbt`, `onUploadPsbt`, and `onToggleExpand` contracts are unchanged.
- Async/race behavior: file-input change handling still calls upload at most once for a selected file and clears the input value; DraftList upload/delete/load flows were not changed.
- Diff review: changes are local to DraftRow rendering and keep the public `DraftRow` export unchanged. The next highest remaining single-component warning is `components/PendingTransfersPanel.tsx` at CCN 73.

## Previous Task: Send ReviewStep CCN Remediation

Status: complete

Goal: reduce the next highest remaining single-component hotspot, the anonymous review block in `components/send/steps/ReviewStep.tsx` at CCN 75, without changing transaction review, signing, file upload, or broadcast behavior.

## Send ReviewStep Checklist

- [x] Inspect ReviewStep structure, signing flow helpers, and focused send-step tests.
- [x] Extract review summary rendering, signing/file upload actions, PSBT display, and broadcast state sections into focused modules.
- [x] Run focused send/ReviewStep tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## Send ReviewStep Review

Changes:

- Added `components/send/steps/review/reviewStepData.ts` for address lookup inputs, change amount, known-address labels, transaction type labels, required signature calculation, broadcast gating, and flow-data assembly.
- Added `components/send/steps/review/useReviewAddressLookup.ts` to isolate wallet-label lookup side effects and lookup failure logging.
- Added `components/send/steps/review/useReviewStepUploads.ts` to isolate single-sig and per-device PSBT upload handling, input reset behavior, upload progress state, and error surfacing.
- Reduced `components/send/steps/ReviewStep.tsx` from focused warnings at CCN 75, 19, and 17 to no focused warning under the review-step `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/send/steps/ReviewStep.tsx components/send/steps/review/reviewStepData.ts components/send/steps/review/useReviewAddressLookup.ts components/send/steps/review/useReviewStepUploads.ts` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/send/ReviewStep.test.tsx tests/components/send/ReviewStep.branches.test.tsx tests/components/send/TransactionSummary.test.tsx tests/components/send/SigningFlow.test.tsx tests/components/send/steps/review/DraftActions.branches.test.tsx tests/components/send/steps/review/UsbSigning.branches.test.tsx` passed: 6 files, 71 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty output addresses still skip wallet-label lookup; missing txData still builds flow data from selected or spendable UTXOs; missing selected UTXO matches still fall back to empty address and zero amount.
- Boundary values: send-max outputs still zero change and use selected total minus fee; quorum `0` still falls back to `1`; multisig broadcast still requires the configured signature count; uploaded signed PSBT still enables broadcast through `psbt-signed`.
- System boundaries: `lookupAddresses`, `onUploadSignedPsbt`, `onSignWithDevice`, `onProcessQrSignedPsbt`, and child review component props are unchanged.
- Async/race behavior: lookup failures still log warnings without blocking render; upload progress still clears in `finally`; device file inputs and single-sig file inputs still reset after success, skip, or failure.
- Diff review: changes are local to the send review step and keep the public `ReviewStep` export unchanged. The next highest remaining warnings are tied: `components/DraftList/DraftRow.tsx` and `components/PendingTransfersPanel.tsx` at CCN 73.

## Previous Task: ReceiveModal CCN Remediation

Status: complete

Goal: reduce the next highest remaining single-component hotspot, `components/WalletDetail/modals/ReceiveModal.tsx` at CCN 81, without changing receive-address generation, QR display, copy behavior, or modal close behavior.

## ReceiveModal Checklist

- [x] Inspect ReceiveModal structure, wallet detail modal contracts, and focused modal tests.
- [x] Extract receive-address actions, QR rendering, address display, and empty/loading/error states into focused modules.
- [x] Run focused ReceiveModal/WalletDetail tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## ReceiveModal Review

Changes:

- Added `components/WalletDetail/modals/useReceiveModalState.ts` to isolate unused-address fetching, selected-address fallback, Payjoin status, Payjoin URI generation, copy handling, close reset, and settings navigation.
- Added `components/WalletDetail/modals/receiveModalData.ts` for unused receive-address filtering, fetch gating, selected-address fallback, Payjoin amount conversion, display labels, and copy/help text.
- Added `ReceiveModalContent.tsx`, `ReceiveAddressPanel.tsx`, `ReceiveQrCode.tsx`, `ReceiveAddressSelector.tsx`, `ReceiveAmountInput.tsx`, `ReceiveValueBox.tsx`, `ReceiveLoadingState.tsx`, and `ReceiveEmptyState.tsx` to split modal rendering into focused pieces.
- Reduced `components/WalletDetail/modals/ReceiveModal.tsx` from CCN 81 to no focused warning, with all extracted ReceiveModal modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/modals/ReceiveModal.tsx components/WalletDetail/modals/receiveModalData.ts components/WalletDetail/modals/useReceiveModalState.ts components/WalletDetail/modals/ReceiveQrCode.tsx components/WalletDetail/modals/ReceiveAddressSelector.tsx components/WalletDetail/modals/ReceiveAmountInput.tsx components/WalletDetail/modals/ReceiveValueBox.tsx components/WalletDetail/modals/ReceiveAddressPanel.tsx components/WalletDetail/modals/ReceiveLoadingState.tsx components/WalletDetail/modals/ReceiveEmptyState.tsx components/WalletDetail/modals/ReceiveModalContent.tsx` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/WalletDetail/modals/ReceiveModal.test.tsx tests/components/WalletDetail/WalletDetailModals.test.tsx` passed: 2 files, 46 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty address lists still show the settings empty state; missing selected IDs still fall back to the first unused receive address; missing address IDs still fall back to the raw address for Payjoin URI generation.
- Boundary values: all-used address lists still trigger one fetch attempt when a callback exists; fetch returning `[]` still shows the empty state; zero, negative, invalid, or empty Payjoin amounts still omit the amount option.
- System boundaries: `payjoinApi.getPayjoinStatus`, `payjoinApi.getPayjoinUri`, `useCopyToClipboard`, and `onFetchUnusedAddresses` contracts are unchanged.
- Async/race behavior: address exhaustion fetches still clear loading in `finally`, rejected fetches still land in the empty state, Payjoin status failures still hide Payjoin, and Payjoin URI generation now ignores late responses after dependency changes.
- Diff review: changes are local to ReceiveModal and keep the public `ReceiveModal` export unchanged.

## Previous Task: CreateWallet CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/CreateWallet/CreateWallet.tsx` at CCN 87, without changing wallet creation, signer selection, policy configuration, or review behavior.

## CreateWallet Checklist

- [x] Inspect CreateWallet structure, subcomponents, hooks, and focused tests.
- [x] Extract wallet creation flow state/actions, step rendering, validation helpers, and footer/progress rendering into focused modules.
- [x] Run focused CreateWallet tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## CreateWallet Review

Changes:

- Added `components/CreateWallet/useCreateWalletController.ts` to isolate device loading, wallet form state, navigation, signer toggling, wallet creation, and async error handling.
- Added `components/CreateWallet/createWalletData.ts` for device compatibility, display-account lookup, next-step validation, device-selection updates, continue-button gating, and wallet creation payload construction.
- Added `components/CreateWallet/CreateWalletProgress.tsx`, `CreateWalletStepContent.tsx`, and `CreateWalletFooter.tsx` so the public `CreateWallet` component coordinates the wizard only.
- Added `components/CreateWallet/SignerCompatibilityWarning.tsx`, `SignerDeviceCard.tsx`, `SignerSelectionMessages.tsx`, and `signerSelectionData.ts` to split signer warning, device-card, empty-state, hint, and label text rendering.
- Reduced `components/CreateWallet/CreateWallet.tsx` from CCN 87 to no focused warning, and cleared the related `SignerSelectionStep.tsx` CCN 21 warning under the focused CreateWallet `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/CreateWallet` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/CreateWallet.test.tsx tests/components/CreateWallet` passed: 5 files, 27 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: failed device loads still fall back to an empty list; missing wallet type still prevents step advancement and wallet creation; absent device accounts still use the legacy derivation-path compatibility check.
- Boundary values: zero selected signers still blocks step 2, one multisig signer still emits the existing validation error, single-sig selection still behaves like a radio button, and multisig selection still toggles devices on/off.
- System boundaries: `devicesApi.getDevices`, `useCreateWallet().mutateAsync`, `useErrorHandler`, and wallet creation payload fields remain unchanged.
- Async/race behavior: device loading now ignores late updates after unmount; submit state still clears in `finally`; create failures still log and route through `handleError`.
- Diff review: changes are local to CreateWallet and keep the public `CreateWallet`, step component, and type exports unchanged.

## Previous Task: TransactionActions CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/TransactionActions.tsx` at CCN 91, without changing transaction approval, broadcast, cancel, replace, or export behavior.

## TransactionActions Checklist

- [x] Inspect TransactionActions structure, API boundaries, and focused tests.
- [x] Extract transaction action state/handlers, status helpers, and rendering sections into focused modules.
- [x] Run focused TransactionActions tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## TransactionActions Review

Changes:

- Added `components/TransactionActions/useTransactionActions.ts` to isolate RBF status loading, RBF draft creation, CPFP creation, navigation, callback handling, and async error state.
- Added `components/TransactionActions/transactionActionsData.ts` for RBF draft payload construction, fallback RBF labels, CPFP success messages, and generic error-message mapping.
- Added `components/TransactionActions/TransactionActionsPanel.tsx` for success/error banners, action buttons, RBF current fee display, CPFP availability, and non-replaceable status reasons.
- Added `components/TransactionActions/TransactionActionModals.tsx`, `RBFModal.tsx`, `CPFPModal.tsx`, and `TransactionModalShared.tsx` to split modal composition and shared modal/info box structure.
- Reduced `components/TransactionActions.tsx` from CCN 91 to no focused warning, with all extracted TransactionActions modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionActions.tsx components/TransactionActions` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/TransactionActions.test.tsx` passed: 29 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: confirmed transactions still skip RBF checks and render null; missing optional `onActionComplete` still no-ops; non-replaceable RBF state still shows only the reason.
- Boundary values: RBF fee rate `0` still no-ops, missing `minNewFeeRate` still falls back to `0.1`, and CPFP target fee below `1` now stays guarded in the handler as well as the disabled button.
- System boundaries: `bitcoinApi.checkRBF`, `bitcoinApi.createRBFTransaction`, `bitcoinApi.createCPFPTransaction`, `transactionsApi.getTransaction`, and `draftsApi.createDraft` payload shapes are unchanged.
- Async/race behavior: RBF status still ignores late updates after unmount, processing flags still clear in `finally`, and RBF/CPFP error messages preserve the existing fallback behavior.
- Diff review: changes are local to TransactionActions and keep the public `TransactionActions` export unchanged.

## Previous Task: TelegramSection CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/Settings/sections/TelegramSection.tsx` at CCN 103, without changing Telegram bot configuration, recipient notification, or wallet override behavior.

## TelegramSection Checklist

- [x] Inspect TelegramSection structure, supporting settings tests, and notification/wallet override flows.
- [x] Extract Telegram status/data helpers, recipient actions, wallet override rendering, and section-level form rendering into focused modules.
- [x] Run focused settings/Telegram tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## TelegramSection Review

Changes:

- Added `components/Settings/sections/telegramSectionData.ts` for Telegram preference payload construction, wallet override preservation, chat ID success messages, and test/fetch result mapping.
- Added `components/Settings/sections/useTelegramSettings.ts` for bot token/chat ID form state, test/fetch/save/toggle actions, timeout cleanup, and error mapping.
- Added `components/Settings/sections/TelegramSectionPanel.tsx` for the Telegram notification UI sections: intro links, bot token field, chat ID field, result/error/success alerts, action buttons, enabled toggle, and per-wallet note.
- Reduced `components/Settings/sections/TelegramSection.tsx` from CCN 103 to no focused warning.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Settings/sections/TelegramSection.tsx components/Settings/sections/TelegramSectionPanel.tsx components/Settings/sections/useTelegramSettings.ts components/Settings/sections/telegramSectionData.ts` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/Settings/sections/TelegramSection.branches.test.tsx tests/components/Settings.interactions.test.tsx tests/components/Settings.test.tsx tests/components/Settings/sections/NotificationsSection.branches.test.tsx` passed: 4 files, 16 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing token/chat ID guards still show the same messages; omitted Telegram wallet overrides still fall back to `{}`; unconfigured Telegram still disables the global toggle.
- Boundary values: repeated saves still clear the previous success timeout; unmount still clears the pending timeout; failed toggle still reverts the optimistic enabled state.
- System boundaries: `authApi.testTelegramConfig`, `authApi.fetchTelegramChatId`, and `updatePreferences` payload shape are unchanged.
- Async/race behavior: test/fetch/save/toggle loading flags still clear in `finally`, and API failures still route through `logError` with the original fallback messages.
- Diff review: changes are local to the Telegram settings section and keep the public `TelegramSettings` export unchanged.

## Previous Task: ImportWallet CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/ImportWallet/ImportWallet.tsx` at CCN 105, without changing wallet import behavior across descriptor, hardware, QR, and metadata flows.

## ImportWallet Checklist

- [x] Inspect ImportWallet structure, step modules, hooks, and focused tests.
- [x] Extract import-step state, derived summaries, completion handlers, and rendering decisions into focused ImportWallet-local modules.
- [x] Run focused ImportWallet tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## ImportWallet Review

Changes:

- Added `components/ImportWallet/useImportWalletActions.ts` to isolate validation, next/back navigation, hardware descriptor creation, import mutation, and import error mapping.
- Added `components/ImportWallet/ImportWalletProgress.tsx`, `components/ImportWallet/ImportWalletStepContent.tsx`, and `components/ImportWallet/ImportWalletFooter.tsx` so the top-level `ImportWallet` component coordinates hooks and layout only.
- Added `components/ImportWallet/steps/useDescriptorInputHandlers.ts` and `components/ImportWallet/steps/DescriptorInputSections.tsx` for file validation, paste validation, textarea rendering, JSON help, and validation error display.
- Added `components/ImportWallet/steps/useHardwareImportActions.ts` and `components/ImportWallet/steps/HardwareImportSections.tsx` for hardware device selection, connect/fetch xpub actions, connected-device sections, script/account controls, and xpub/error rendering.
- Added `components/ImportWallet/steps/useQrScanHandlers.ts` and `components/ImportWallet/steps/QrScanSections.tsx` for camera error mapping, UR:BYTES decoding, JSON/descriptor QR handling, scanner panels, progress overlay, success/error states, and supported-format help.
- Reduced `components/ImportWallet/ImportWallet.tsx` from CCN 105 to no focused warning, and cleared the related `DescriptorInput`, `HardwareImport`, and `QrScanStep` warnings under the focused ImportWallet `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ImportWallet` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/ImportWallet.test.tsx tests/components/ImportWallet` passed: 10 files, 104 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing uploaded files still no-op, missing hardware xpub data still blocks advancement, empty descriptor/JSON input still disables next, and empty QR scan results still no-op.
- Boundary values: oversized files/text still return the same size errors, account index still clamps to zero or greater, UR progress still resets on complete/stop, and unsupported UR types still surface validation errors.
- System boundaries: wallet validation/import APIs, hardware wallet runtime calls, QR scanner contract, and import state hook contract are unchanged.
- Async/race behavior: validation and import loading flags still clear in `finally`, hardware connect/fetch errors still map to inline messages, and UR decoder state is reset after stop/failure/success.
- Diff review: changes are local to ImportWallet and keep the public `ImportWallet`, `DescriptorInput`, `HardwareImport`, and `QrScanStep` exports unchanged.

## Previous Task: NodeConfig CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/NodeConfig/NodeConfig.tsx` at CCN 111, without changing node/proxy/Tor configuration behavior.

## NodeConfig Checklist

- [x] Inspect NodeConfig structure, subcomponents, and focused tests.
- [x] Extract load/save, proxy/Tor, server filtering, and summary logic into focused NodeConfig-local modules.
- [x] Run focused NodeConfig tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## NodeConfig Review

Changes:

- Added `components/NodeConfig/nodeConfigData.ts` for default config, network server filtering/replacement, proxy visibility, and section summaries.
- Added `components/NodeConfig/useNodeConfigData.ts`, `components/NodeConfig/useNodeConfigSave.ts`, `components/NodeConfig/useElectrumServerControls.ts`, and `components/NodeConfig/useProxyTorControls.ts` to isolate loading, saving, Electrum test/server updates, proxy tests, proxy presets, and Tor container actions.
- Added `components/NodeConfig/NodeConfigStatusMessages.tsx`, `components/NodeConfig/NetworkTabsRow.tsx`, `components/NodeConfig/ProxyTorHeader.tsx`, `components/NodeConfig/BundledTorContainerCard.tsx`, `components/NodeConfig/CustomProxyControls.tsx`, and `components/NodeConfig/ProxyTestControls.tsx` to split status, network tabs, proxy header, bundled Tor, custom proxy, and proxy verification rendering.
- Reduced `components/NodeConfig/NodeConfig.tsx` from CCN 111 to no focused warning, and cleared the related NodeConfig section warnings under the focused `-C 15` lizard gate.
- Fixed the extracted Electrum connection handler to `await` `adminApi.testElectrumConnection` inside its `try/catch`, preserving rejected-promise conversion into an inline failure message.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NodeConfig` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/NodeConfig.test.tsx tests/components/NodeConfig.branches.test.tsx tests/components/NodeConfig.interactions.test.tsx tests/components/NodeConfig.secondpass.test.tsx tests/components/NodeConfig/ExternalServicesSection.test.tsx tests/components/NodeConfig/NetworkConnectionsSection.branches.test.tsx tests/components/NodeConfig/ProxyTorSection.branches.test.tsx` passed: 7 files, 65 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: failed config/server/Tor loads still fall back to defaults or empty lists; unavailable Tor status still hides the bundled card; empty proxy credentials still normalize to `undefined`.
- Boundary values: empty or invalid proxy port input still clears the numeric port; zero Electrum servers still leaves the tab count blank; disabled testnet/signet still show `(off)` through the extracted tab badge logic.
- System boundaries: admin API, bitcoin API, and NetworkConnectionCard contracts are unchanged; the refactor only moved orchestration and rendering into NodeConfig-local modules.
- Async/race behavior: load cancellation still prevents late state writes after unmount, save/proxy/Tor timeouts still clear their messages, and rejected Electrum tests now stay handled.
- Diff review: changes are local to NodeConfig and keep the public `NodeConfig`, `NetworkConnectionsSection`, and `ProxyTorSection` exports unchanged.

## Previous Task: WalletDetail CCN Assessment

Status: complete

Goal: inspect and safely reduce the current highest remaining component hotspot, `components/WalletDetail/WalletDetail.tsx` at CCN 135, without destabilizing the wallet detail workflow.

## WalletDetail Checklist

- [x] Refresh post-WalletList lizard ranking and identify WalletDetail as the new top hotspot.
- [x] Inspect WalletDetail structure and available focused tests.
- [x] Extract tab-content routing and local side-effect/state helpers where behavior-preserving.
- [x] Run focused WalletDetail tests plus lint/type/lizard/quality gates for the code changes.
- [x] Document the result and remaining blocker.

## WalletDetail Review

Changes:

- Added `components/WalletDetail/WalletDetailTabContent.tsx` to isolate tab routing and tab component rendering from the main container.
- Added `components/WalletDetail/hooks/useWalletDetailTabs.ts` for URL/location-driven tab state and role-based tab visibility correction.
- Added `components/WalletDetail/hooks/useWalletAgentLinks.ts` for admin wallet-agent badge loading and cancellation handling.
- Added `components/WalletDetail/hooks/useWalletDetailAddressActions.ts` for address pagination, address generation, and unused receive-address fetching.
- Added `components/WalletDetail/hooks/useWalletDetailModalState.ts` for export, transaction export, receive, QR, delete, and transfer modal state plus wallet delete handling.
- Added `components/WalletDetail/hooks/useWalletDraftNotifications.ts` for pending-draft notification updates.
- Reduced `components/WalletDetail/WalletDetail.tsx` from CCN 135 to CCN 47. This is a material reduction, but not a full clear.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletDetail.tsx components/WalletDetail/WalletDetailTabContent.tsx components/WalletDetail/hooks/useWalletDetailTabs.ts components/WalletDetail/hooks/useWalletAgentLinks.ts components/WalletDetail/hooks/useWalletDetailModalState.ts components/WalletDetail/hooks/useWalletDetailAddressActions.ts components/WalletDetail/hooks/useWalletDraftNotifications.ts` now reports the main file at CCN 47, down from 135.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx tests/components/WalletDetail` passed: 40 files, 502 tests.
- `git diff --check` passed.

Remaining blocker:

- Fully clearing `WalletDetail.tsx` under `-C 15` now requires a broader tab-props context split. The remaining complexity is mostly dense prop assembly for eight tab surfaces and modal wiring, not isolated algorithms. That should be a dedicated pass because it touches high-fanout props for transactions, UTXOs, addresses, drafts, access, settings, logs, and modals.

Edge case and self-review:

- Null/undefined and empty inputs: absent wallet IDs still short-circuit delete/address actions; invalid location tab state still falls back through existing tab guards; missing wallet data still renders loading state.
- Boundary values: zero pending drafts now removes notifications, positive draft counts preserve singular/plural titles, empty unused receive-address results still trigger address generation, and one-point sparkline behavior was not touched.
- System boundaries: API calls remain the same and are now behind local hooks; no wallet, transaction, admin, or notification API contract changed.
- Async/race behavior: admin-agent loading still uses cancellation, address generation still refreshes summary and first page, and wallet delete still navigates only after successful deletion.
- Diff review: changes are local to WalletDetail and keep the public `WalletDetail` export unchanged.

## Previous Task: WalletList CCN Remediation

Status: complete

Goal: reduce the current highest focused lizard hotspot, `components/WalletList/WalletList.tsx` at CCN 178, and clear the local `WalletGridView` warning without changing wallet list behavior.

## WalletList Checklist

- [x] Refresh remaining CCN hotspot evidence and identify WalletList as the next slice.
- [x] Inspect WalletList structure and focused WalletList tests.
- [x] Extract wallet-list preference, network, derivation, and content rendering logic into focused modules.
- [x] Extract grid-card balance, sparkline, badge, and metadata rendering into focused modules.
- [x] Run focused WalletList tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## WalletList Review

Changes:

- Added `components/WalletList/walletListData.ts` for network validation, wallet filtering/counts/sorting, pending-transaction aggregation, and pending-data attachment.
- Added `components/WalletList/useWalletListPreferences.ts`, `components/WalletList/useWalletNetworkParam.ts`, and `components/WalletList/useWalletListData.ts` for preference updates, URL-backed network selection, React Query data, and derived wallet state.
- Added `components/WalletList/WalletListContent.tsx`, `components/WalletList/WalletListHeader.tsx`, and `components/WalletList/WalletListEmptyState.tsx` to move rendering out of the container.
- Split `WalletGridView` card rendering into `WalletGridCard.tsx`, `WalletGridCardTop.tsx`, `WalletGridCardBalance.tsx`, `WalletGridCardSparkline.tsx`, `WalletGridCardMetadata.tsx`, and `walletGridCardStyles.ts`.
- Added WalletList shared types in `components/WalletList/types.ts`, including the `string | null` formatter return contract used by fiat formatting.
- Reduced `components/WalletList/WalletList.tsx` from a CCN 178 lizard hotspot to no focused warning; `components/WalletList/WalletGridView.tsx` and its extracted card modules also no longer warn under `-C 15`.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletList` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/WalletList.test.tsx tests/components/WalletList.branches.test.tsx tests/components/WalletList/WalletGridView.test.tsx` passed: 46 tests.
- `node scripts/quality/check-large-files.mjs` passed.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: invalid or absent `network` URL params still default to mainnet; missing wallet networks are filtered out of tab views; missing device counts still render as `0 devices`; empty wallet lists keep the existing empty state.
- Boundary values: sort toggles preserve asc/desc behavior, unsupported sort fields remain stable, pending transaction net zero hides the net badge, and sparkline arrays with fewer than two points still render the same empty real-sparkline paths.
- System boundaries: wallet API query hooks and invalidation hooks are unchanged; the refactor only moves calling/derivation/rendering into WalletList-local modules.
- Async/race behavior: React Query data flow, pending transaction refresh inputs, sparkline inputs, and sync invalidation callbacks are behavior-preserving.
- Diff review: decomposition is local to WalletList and keeps the public `WalletList` and `WalletGridView` exports unchanged.

## Previous Task: DeviceList CCN Follow-Up

Status: complete

Goal: finish the DeviceList complexity pass by decomposing the remaining `DeviceList`, `DeviceListHeader`, and `DeviceGroupedView` render/state hotspots without changing behavior.

## DeviceList Checklist

- [x] Inspect `DeviceList` structure, existing subcomponents, and focused tests.
- [x] Extract device-list data derivation and sorting helpers.
- [x] Extract user preference wiring into a hook.
- [x] Extract wallet filter banner and main content rendering.
- [x] Extract header controls into focused components.
- [x] Extract grouped device cards into focused components.
- [x] Extract record loading/edit/delete state and derived table/grouped data into hooks.
- [x] Run focused DeviceList tests, app lint/typecheck, architecture, large-file, lizard, and diff checks.
- [x] Run final quality, edge case, and self-review.

## DeviceList Review

Changes:

- Added `components/DeviceList/deviceListData.ts` for wallet counts, wallet options, stale wallet filter resolution, filtering/sorting, exclusive-device IDs, grouping, and display-name lookup.
- Added `components/DeviceList/useDeviceListPreferences.ts` for device view preferences, sort/filter setters, and column configuration updates.
- Added `components/DeviceList/WalletFilterBanner.tsx` for wallet and unassigned filter summary banners.
- Added `components/DeviceList/DeviceListContent.tsx` for the presentational header/banner/table/grouped rendering.
- Added `components/DeviceList/DeviceListHeaderControls.tsx` for ownership, wallet-filter dropdown, and view/column controls.
- Added `components/DeviceList/DeviceGroupedCards.tsx` for grouped type cards, device title/edit/delete controls, and wallet badges.
- Added `components/DeviceList/useDeviceListRecords.ts` and `components/DeviceList/useDeviceListDerivedData.ts` so the top-level component is now only a coordinator.
- Added shared DeviceList edit/delete state interfaces to `components/DeviceList/types.ts`.
- Reduced `components/DeviceList/DeviceList.tsx` from a 304 CCN lizard hotspot to no focused warning; `DeviceListHeader` and `DeviceGroupedView` also no longer warn under `-C 15`.

Verification:

- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/DeviceList.test.tsx tests/components/DeviceList/DeviceList.branches.test.tsx tests/components/DeviceList/DeviceListHeader.branches.test.tsx tests/components/DeviceList/DeviceGroupedView.test.tsx tests/components/DeviceList/EmptyState.test.tsx` passed: 54 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DeviceList` passed with no warnings.
- `node scripts/quality/check-large-files.mjs` passed.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: helper extraction preserves walletCount/wallets fallbacks, stale wallet filter fallback, unknown device display names, empty-device rendering, and missing wallet type fallback.
- Boundary values: singular/plural wallet-count text, exclusive-device badge gating, unknown sort field fallback, unassigned filters, and zero-wallet delete affordance remain covered by existing tests.
- System boundaries: no API contracts changed; `getDevices`, `getDeviceModels`, `updateDevice`, and `deleteDevice` remain behind the DeviceList record hook.
- Async/race behavior: loading, update, delete, dropdown dismissal, and preference-update paths are behavior-preserving extractions.
- Diff review: decomposition is local to DeviceList and keeps the public `DeviceList`, `DeviceListHeader`, and `DeviceGroupedView` exports unchanged.

## Previous Task: Grade Remediation 4-5

Status: complete

Goal: continue the grade remediation by clearing the oversized production file governance failure and reducing targeted maintainability risk where feasible.

## Remediation Checklist

- [x] Refresh large-file and maintainability blocker evidence.
- [x] Split `components/AgentManagement/index.tsx` instead of classifying product UI as an exception.
- [x] Re-run large-file governance check.
- [x] Re-run app lint/typecheck and targeted tests or build checks.
- [x] Assess highest-CCN remediation feasibility after the large-file gate is green.
- [x] Run final quality, edge case, and self-review.

## Remediation Review

Changes:

- Split the funding override modal out of `components/AgentManagement/index.tsx` into `components/AgentManagement/AgentOverridesModal.tsx`.
- Moved shared agent-management display formatting into `components/AgentManagement/formatters.ts`.
- Reduced `components/AgentManagement/index.tsx` from 1,173 lines to 936 lines, clearing the production oversized-file policy failure without adding an exception.
- Updated `docs/plans/codebase-health-assessment.md` with a remediation note for the large-file gate.

Verification:

- `node scripts/quality/check-large-files.mjs` passed; no unclassified files remain above the 1,000-line limit.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/AgentManagement.test.tsx` passed: 8 tests.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

CCN assessment:

- Focused lizard check still reports broad component CCN warnings in `DeviceList`, `WalletList`, `WalletDetail`, and remaining AgentManagement render sections.
- The highest CCN offenders are large JSX/state-machine components, not isolated helper functions. Reducing the full warning count safely needs a separate behavior-preserving component decomposition pass with screenshots or component tests around each surface.

Edge case and self-review:

- Null/undefined and empty inputs: the split modal preserves existing empty amount/reason/date validation and error display.
- Boundary values: the override amount/date checks are unchanged; the large-file boundary now has `AgentManagement/index.tsx` below the 1,000-line failure threshold.
- System boundaries: no API contract or data-fetching behavior changed; the modal still uses the same admin API calls and metadata types.
- Async/race behavior: override load/create/revoke state transitions were moved intact, including `finally` cleanup of loading and busy state.
- Diff review: extraction is presentational and verified by the existing AgentManagement component test suite.

## Previous Task: Grade Remediation 1-3

Status: complete

Goal: complete the first three grade remediation items: clear high/critical dependency advisories, fix the two empty-catch lint failures, and restore API/repository architecture boundaries.

## Remediation Checklist

- [x] Review current worktree, package metadata, and grade blockers.
- [x] Clear high/critical npm audit findings in root, server, and gateway without unsafe downgrades.
- [x] Fix empty catch lint failures in frontend and server production code.
- [x] Move direct repository access out of the three flagged API route modules.
- [x] Run audits, lint, architecture checks, typechecks, and focused tests.
- [x] Run final quality, edge case, and self-review.

## Remediation Review

Changes:

- Added dependency overrides so vulnerable hard-fail paths resolve to patched versions: root and gateway force `protobufjs@7.5.5`; server forces `protobufjs@7.5.5`, `hono@4.12.14`, and keeps `@hono/node-server@1.19.14`.
- Replaced the two lint-blocking silent catches with contextual debug logging in `components/AgentWalletDashboard/index.tsx` and `server/src/services/agentFundingDraftValidation.ts`.
- Moved repository-backed work out of `server/src/api/admin/agents.ts`, `server/src/api/admin/mcpKeys.ts`, and `server/src/api/agent.ts` into new service modules.
- Added a remediation note to `docs/plans/codebase-health-assessment.md` so the original grade snapshot remains distinguishable from this follow-up.

Verification:

- `npm audit --audit-level=high` passed in root; residual findings are low severity only.
- `npm audit --audit-level=high` passed in `server`; zero vulnerabilities.
- `npm audit --audit-level=high` passed in `gateway`; residual findings are low severity only.
- `npm run check:architecture-boundaries` passed.
- `npm run lint:app`, `npm run lint:server`, and `npm run lint:gateway` passed.
- `npm run typecheck:app` passed.
- `npm run build` in `server` passed.
- `npm run typecheck:server:tests` passed.
- `npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts` in `server` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: route schemas still validate request bodies before the new services run; nullable draft `memo` is normalized to `undefined` at the `draftService` boundary.
- Boundary values: existing fee-rate min/max enforcement moved unchanged into `agentApiService`; high/critical audit checks confirmed patched dependency versions are installed in root/server/gateway trees.
- System boundaries: API routes still own request parsing and audit logging; repository access and key material creation now sit behind service functions.
- Race/async behavior: agent funding draft locking and override consumption stay inside the existing `withAgentFundingLock` flow.
- Diff review: new services preserve the previous response/audit contracts and the focused route smoke test covers admin agent creation, agent key issuance, funding draft submission, and mobile review metadata.

## Previous Task: Repository Quality Grade

Status: complete

Goal: run the `$grade` full-repository audit, collect mechanical and judged quality evidence, update trend history, and write `docs/plans/codebase-health-assessment.md`.

## Grade Checklist

- [x] Load grade skill instructions, standards, git status, and project lessons.
- [x] Capture repository provenance and previous grade trend entry.
- [x] Run the project-wide grade signal collector.
- [x] Inspect evidence for judged ISO/IEC 25010 criteria.
- [x] Score domains, hard-fail gates, confidence, risks, and fastest improvements.
- [x] Append grade trend history.
- [x] Write `docs/plans/codebase-health-assessment.md`.
- [x] Run final quality, edge case, and self-review.

## Grade Review

Results:

- Overall grade is `69/100 D` with High confidence. Raw score is `79/100`, capped to D by the hard-fail gate for high/critical dependency advisories.
- Historical hard-fail blocker at audit time: npm audit reported root `8 critical`, server `1 critical`, and gateway `1 critical`; AI proxy was clean.
- Historical secondary gate regressions: lint failed on two production empty catches, architecture boundaries failed on three API-to-repository imports, lizard reported 122 CCN warnings, and large-file policy failed on unclassified `components/AgentManagement/index.tsx`.
- Strengths preserved: root tests pass, typecheck passes, gitleaks is clean, root/backend line coverage is 100%, gateway line/branch coverage is 100%, OpenAPI route coverage passes, API body validation passes, and browser auth contract passes.

Verification:

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed.
- `npm run lint` failed as expected from the two empty-catch lint errors; `npm run lint:gateway` passed.
- `npm run check:browser-auth-contract` passed.
- `npm run check:architecture-boundaries` failed with three direct repository imports from API routes.
- `npm run check:openapi-route-coverage` passed.
- `npm run check:api-body-validation` passed.
- `npm run typecheck:server:tests` passed.
- Root/server/gateway/AI proxy npm audits ran; AI proxy needed an escalated rerun after sandbox DNS failure.
- `/tmp/gitleaks` full-tree/latest-commit/tracked-tree scans found no leaks.
- Lizard, jscpd, and large-file checks ran; lizard and large-file policy report the maintainability blockers above.
- `npm run test:backend:coverage` and `npm --prefix gateway run test:coverage` passed after rerunning outside socket-binding sandbox limits.

Edge case and self-review:

- Null/undefined and empty inputs: sampled request schema and refresh tests cover missing bodies, invalid headers, empty message arrays, and invalid expiry headers.
- Boundary values: coverage and sampled tests cover zero-delay refresh, invalid/locked/spent agent funding inputs, and rate/amount validation paths.
- System boundaries: API body validation, OpenAPI coverage, gitleaks, npm audit, and architecture-boundary checks were all run or explicitly reported failing.
- Async/race behavior: refresh single-flight/Web Locks and backend coverage passed; no new runtime code was edited during the audit.
- Diff review: only the report, trend JSONL, and task log were changed.

## Previous Task: Backend Coverage And Test Gate Follow-Up

Status: complete

Goal: finish the five follow-up items from the backend coverage pass: confirm remote CI, keep backend coverage at literal 100%, remove high-value reachable `v8 ignore` pragmas where practical, make server test type debt explicit and enforceable, and document the 100% coverage policy.

## Follow-Up Checklist

- [x] Confirm the latest remote CI result and diagnose any failure.
- [x] Fix backend coverage drift found by CI.
- [x] Clean up the server test typecheck blockers enough to add an enforceable gate.
- [x] Add the server test typecheck gate to package scripts and CI.
- [x] Replace high-value reachable `v8 ignore` pragmas with focused tests.
- [x] Document the 100% coverage policy and allowed exclusion criteria.
- [x] Run verification and review edge cases.
- [x] Commit and push.

## Follow-Up Review

Remote CI diagnosis:

- The latest `main` Test Suite run for commit `851a7f65` failed only in the backend coverage step.
- The downloaded backend coverage artifact showed one missed branch in `server/src/models/prisma.ts`: the empty-string fallback in `process.env.DATABASE_URL || ''` was uncovered when CI supplied `DATABASE_URL`.
- The follow-up `main` Test Suite run for commit `4c3c8b4b` reached the new backend test typecheck gate and failed because backend-only CI installs do not create a repo-root `node_modules`. `shared/schemas/mobileApiRequests.ts` imports `zod` from the repo-root side of the tree, so unresolved `zod` caused parsed request DTOs to degrade to `unknown` and cascaded into route type errors.

Changes made:

- Added Prisma model behavior tests for both configured and absent `DATABASE_URL` adapter initialization, plus direct `withTransaction` delegation coverage.
- Removed the now-covered `v8 ignore` pragmas from `withTransaction`.
- Added AI insight notification tests for default severity filtering, default Telegram notification preference, explicit notification disablement, and fallback formatting for unknown values.
- Removed the corresponding reachable AI insight `v8 ignore` pragmas.
- Added the missing `wait(ms)` helper exported from `tests/helpers/testUtils.ts`.
- Fixed Vitest 4 custom matcher module augmentation by declaring matchers under `@vitest/expect`.
- Fixed shared test mock typing for Vitest `Mock`, push-device generated types, and `appVersion`.
- Added a backend script that creates a repo-root `node_modules` symlink to `server/node_modules` when the root install is absent, matching the existing Docker build strategy for shared TypeScript files.
- Added that shared-module resolution step to backend build, runtime, test, mutation, server test typecheck scripts, and backend-only CI jobs.
- Added explicit exported repository mock types and callback parameter types so the focused test typecheck does not infer non-portable Vitest internals.
- Added an enforced server test typecheck script and CI steps in quick/full backend jobs.
- Added `server/tsconfig.test.full.json` so the broader historical full-suite test type debt remains measurable while the required gate covers setup, helpers, mocks, and representative typed tests.
- Documented the literal 100% backend coverage policy, allowed exclusion criteria, server test type gates, and updated stale server test README Jest examples to Vitest examples.

Verification:

- `cd server && npx vitest run tests/unit/services/notifications/channels/aiInsights.test.ts tests/unit/models/prisma.behavior.test.ts tests/unit/models/prisma.test.ts` passed: 61 tests.
- `npm run typecheck:server:tests` passed.
- CI-shaped temporary checkout with no repo-root `node_modules` and only `server/node_modules` installed passed `cd server && npm run typecheck:tests`.
- `cd server && npm run test:unit -- --coverage` passed: 372 files, 8996 tests, 100% statements, 100% branches, 100% functions, 100% lines.
- `cd server && npm run build` passed.
- `git diff --check` passed.

Edge case audit:

- Null/undefined and empty input handling: `DATABASE_URL` restoration handles both undefined and configured values; AI insight tests cover missing severity filter and missing Telegram preference.
- Boundary values: the backend coverage gate now covers both sides of the `DATABASE_URL || ''` fallback that differed between local and CI.
- Error handling: existing AI insight repository failure and per-user Telegram send failure tests still pass; new notification-disable tests prove no send occurs when disabled.
- Race/async behavior: no new async scheduling or shared mutable runtime state beyond restoring `process.env.DATABASE_URL` in `afterEach`.
- System boundary handling: backend-only CI now resolves shared schema dependencies without requiring a root package install; the helper refuses to continue if `server/node_modules` is absent instead of silently hiding the install problem.
- Residual risk: `npm run typecheck:tests:full` intentionally remains a debt tracker rather than a release gate. It still exposes historical DTO/fixture/router/mock drift across the full server test suite, so future cleanup should expand `server/tsconfig.test.json` as those files are fixed.

## Previous Task: 100% Coverage Gates

Status: complete

Goal: bring the enforced frontend and backend coverage gates to literal 100% with targeted tests where behavior is reachable, using narrowly justified exclusions only for non-runtime shims, type-only files, V8 instrumentation artifacts, or environment entrypoints that cannot be meaningfully unit-covered.

## Coverage Checklist

- [x] Reproduce current frontend and backend coverage failures locally.
- [x] Identify every uncovered file/line that prevents the enforced gates from passing.
- [x] Add focused tests for reachable branch, function, statement, and line gaps in the affected agent funding and WalletDetail surfaces.
- [x] Tighten backend thresholds to 100% once the backend report is literally clean.
- [x] Replace the stale Jest test type reference with Vitest globals in the server test tsconfig.
- [x] Run frontend and backend coverage gates plus relevant type/build checks.
- [x] Add a review section summarizing changes, edge cases, verification, and residual risks.
- [x] Commit and push the coverage fix.

## Coverage Review

Changes made:

- Added frontend route and WalletDetail wrapper coverage for lazy agent routes, admin wallet-agent badge loading, fallback badge labels, rejected fetches, and unmount cancellation.
- Added backend tests around admin agent route validation, scoped agent route rejection metadata, agent funding draft PSBT edge cases, mobile draft review permissions, draft notification metadata, websocket broadcast skips, agent funding policy windows, monitoring alert early returns, middleware auth, Telegram formatting, and repository null/default paths.
- Excluded `src/worker.ts` from backend unit coverage as a side-effect daemon entrypoint; worker behavior remains covered through worker module and worker entry tests.
- Tightened backend Vitest thresholds to 100% for statements, branches, functions, and lines.
- Updated `server/tsconfig.test.json` to use `vitest/globals` instead of missing Jest types, include shared test dependencies, and allow extension-bearing TypeScript imports for the existing test suite layout.

Verification:

- `npm run test:coverage` passed with frontend/root literal 100% coverage: statements 14257/14257, branches 10630/10630, functions 3625/3625, lines 13298/13298.
- `cd server && npm run test:unit -- --coverage` passed with backend literal 100% coverage: statements 21669/21669, branches 10638/10638, functions 4256/4256, lines 20784/20784.
- `npm run typecheck:tests` passed.
- `cd server && npm run build` passed.
- `cd server && npx tsc --noEmit -p tsconfig.test.json --pretty false` no longer fails on missing Jest types. Later cleanup also resolved the broader server test type debt; `npm --prefix server run typecheck:tests` passed on 2026-04-25.
- `git diff --check` passed.

Residual risk:

- Server runtime build and coverage were green, and the remaining server test type debt has since been resolved. `npm --prefix server run typecheck:tests` passed on 2026-04-25.

## Previous Task: Agent Wallet Funding Implementation

Status: complete

Reference plan: `tasks/agent-wallet-funding-plan.md`

## Completed Implementation Slice

Goal: make agent wallet funding operable and defensible with operator docs, incident runbooks, backup/restore coverage, release notes, and an end-to-end route smoke path.

- [x] Load `AGENTS.md` and current project lessons into the session.
- [x] Capture the agent funding architecture in `tasks/agent-wallet-funding-plan.md`.
- [x] Inspect the existing draft creation API, service, repository, notification, and tests.
- [x] Add server-side support for creating a draft with an initial signed PSBT and signer device id.
- [x] Validate that initial signature metadata is scoped to a device associated with the wallet.
- [x] Preserve existing draft notification behavior so human parties are alerted.
- [x] Add focused tests for initial partially signed draft creation.
- [x] Add `WalletAgent` and `AgentApiKey` schema models plus a migration for linked funding/operational wallets.
- [x] Add scoped `agt_` bearer key generation, hashing, parsing, revocation/expiry checks, and funding-wallet access enforcement.
- [x] Add repository support for agent profiles and API keys.
- [x] Add a dedicated `POST /api/v1/agent/wallets/:fundingWalletId/funding-drafts` endpoint.
- [x] Ensure the dedicated endpoint creates a normal partial draft using the registered agent signer device.
- [x] Notify all eligible wallet parties for agent-created drafts instead of suppressing the owning human user.
- [x] Audit-log agent funding draft submissions.
- [x] Add OpenAPI coverage for the agent route and the previously undocumented admin MCP key routes.
- [x] Remove direct Prisma access from the transaction export route by moving the transaction wrapper into the repository.
- [x] Decode agent-submitted PSBTs and validate outputs against the linked operational wallet plus funding-wallet change.
- [x] Validate agent-submitted PSBT inputs against funding-wallet UTXOs, spent/frozen state, and active draft locks.
- [x] Validate the registered agent cosigner's actual partial signature on every input.
- [x] Derive agent draft locking and display metadata from decoded PSBT contents.
- [x] Run targeted and full server verification.
- [x] Add a review section summarizing behavior, tests, edge cases, and follow-up work.
- [x] Add admin/API agent management, policy gates, deduped agent notifications, operational spend alerts, and draft-row agent context.
- [x] Add admin options API for user, wallet, and signer-device choices.
- [x] Add frontend admin API bindings for agent profile and key management.
- [x] Add Admin -> Wallet Agents route.
- [x] Add admin list/create/edit/revoke flows for wallet agents.
- [x] Add one-time `agt_` key creation display and key revocation UI.
- [x] Add linked agent wallet badges to wallet detail headers for admins.
- [x] Add focused server, API binding, route, component, and wallet-header tests.
- [x] Run targeted contract checks plus full frontend and server unit verification.
- [x] Add agent operational monitoring policy fields.
- [x] Add persisted agent alert history with dedupe.
- [x] Trigger alerts for low/high operational balance, large operational spends, large operational fees, and repeated rejected funding attempts.
- [x] Expose alert history through admin APIs.
- [x] Add monitoring fields to Admin -> Wallet Agents create/edit UI.
- [x] Add focused repository, service, route, API, and component tests.
- [x] Run targeted contract checks plus full frontend and server unit verification.
- [x] Add server-side Agent Wallets dashboard aggregation endpoint.
- [x] Include agent status, funding wallet, operational wallet, operational balance, pending drafts, recent spends, open alerts, and key counts.
- [x] Add frontend admin API bindings for dashboard metadata.
- [x] Add Admin -> Agent Wallets dashboard route.
- [x] Add pause/unpause, revoke key, review draft, and open linked wallet actions.
- [x] Add detail rows for policy, recent funding requests, operational spends, alerts, and key metadata.
- [x] Add focused server, API binding, route, and component tests.
- [x] Run targeted verification plus broader frontend/server checks.
- [x] Add receive-address-specific repository helpers for agent operational address lookup.
- [x] Add a server service that returns or derives verified linked operational receive addresses.
- [x] Update the agent operational-address endpoint and OpenAPI schema.
- [x] Add focused repository, service, and route tests.
- [x] Run Phase 12 targeted verification and commit.
- [x] Add an `AgentFundingOverride` schema model and migration.
- [x] Add admin API routes for listing, creating, and revoking owner overrides.
- [x] Enforce override eligibility in agent funding policy without bypassing inactive, wrong-destination, or cooldown guards.
- [x] Mark overrides used after draft creation and audit override create/revoke/use events.
- [x] Add admin UI/API bindings for owner override list/create/revoke flows.
- [x] Label override-funded drafts for human review.
- [x] Add focused repository, service, route, DTO, OpenAPI, API binding, and component tests.
- [x] Run Phase 13 targeted and broader verification.
- [x] Add mobile-safe pending agent funding draft repository queries.
- [x] Add mobile review DTOs with decoded draft summaries, linked operational wallet destination, signing metadata, and deep-link payloads.
- [x] Add authenticated mobile endpoints for listing, detail review, approve intent, comment, reject, and signed PSBT submission.
- [x] Enforce mobile wallet permissions before exposing draft details or accepting signatures.
- [x] Route mobile signed PSBT submissions through the existing draft update/signature path.
- [x] Add audit events for mobile approve, comment, reject, and sign actions.
- [x] Add OpenAPI coverage and focused route, service, repository, and route-registration tests.
- [x] Run Phase 14 targeted verification.
- [x] Add operator docs for registering agents, issuing keys, submitting funding drafts, human review, owner overrides, monitoring, and restore checks.
- [x] Add agent wallet funding incident runbooks for suspected `agt_` key compromise, agent signer compromise, and operational wallet compromise.
- [x] Add release notes explaining the single-sig operational wallet boundary and human-review security model.
- [x] Include agent profiles, API key hashes/prefixes, funding attempts, alerts, and owner overrides in backup/restore table ordering.
- [x] Add backup-service tests for agent metadata export and ordering.
- [x] Add an end-to-end route smoke path for admin creates agent -> creates key -> agent submits signed PSBT -> human sees mobile review metadata.
- [x] Run Phase 15 targeted verification.

## Next Slices

- [x] Add admin/API management flows for registering agents and issuing/revoking `agt_` keys.
- [x] Decode and validate destination outputs against the linked operational wallet.
- [x] Validate that the submitted signed PSBT really contains the registered agent cosigner's partial signature.
- [x] Validate the PSBT spends only funding-wallet UTXOs and does not duplicate an active draft that locks the same UTXOs.
- [x] Enforce agent funding policies and rate limits.
- [x] Improve draft row and Telegram copy for agent funding requests.
- [x] Add notification dedupe for repeated agent submissions.
- [x] Add operational wallet monitoring alerts.
- [x] Phase 8: Decisions and safety hardening.
  - [x] Resolve address generation, over-cap behavior, approval semantics, and concurrent draft policy.
  - [x] Guard policy evaluation, draft creation, UTXO locking, and agent cadence updates with a per-agent PostgreSQL advisory lock.
  - [x] Record accepted and rejected agent funding attempts with reason codes.

## Future Implementation Roadmap

Detailed roadmap: `tasks/agent-wallet-funding-plan.md#future-work-roadmap`

Recommended order:

- [x] Phase 8: Decisions and safety hardening.
  - Resolve address generation, over-cap behavior, approval semantics, and concurrent draft policy.
  - Guard policy evaluation, draft creation, UTXO locking, and agent cadence updates with the per-agent PostgreSQL advisory lock.
  - Record rejected agent funding attempts with reason codes.
- [x] Phase 9: Admin agent management UI.
  - Add admin list/create/edit/revoke flows for agents.
  - Add one-time `agt_` key creation display and key revocation UI.
  - Add linked wallet labels in wallet detail views.
- [x] Phase 10: Operational monitoring and alert rules.
  - Add refill/balance/large-spend/large-fee/repeated-failure alert policy.
  - Store alert history and dedupe threshold alerts.
- [x] Phase 11: Agent Wallets dashboard.
  - Show agent status, funding wallet, operational balance, pending drafts, recent spends, and alerts.
  - Add pause/unpause, revoke key, review draft, and open linked wallet actions.
- [x] Phase 12: Operational address generation.
  - Generate next operational receive address when Sanctuary has enough watch-only descriptor metadata.
  - Preserve strict linked-address verification.
- [x] Phase 13: Owner override workflow.
  - Keep default over-cap behavior as hard reject.
  - Add bounded, human-created overrides with audit trail if needed.
- [x] Phase 14: Mobile approval foundation.
  - Add mobile-safe pending agent draft listing, review metadata, comments/rejection, and signer integration path.
- [x] Phase 15: Operational runbooks and E2E coverage.
  - Add docs, key compromise runbook, backup/restore expectations, release notes, and an e2e smoke path.

Next recommended implementation slice:

- [x] Run cross-phase corner-case audit from Phase 1 onward, then push all committed work.

## Review

Cross-phase audit update:

- Re-read the implementation surface from the first agent wallet funding commit through Phase 15, covering the server agent API, draft validation, policy enforcement, admin management, monitoring, dashboard, operational address generation, owner overrides, mobile review APIs, backup metadata, docs, and smoke coverage.
- Fixed a signer metadata edge case found during audit: draft signature updates now validate that any submitted `signedDeviceId` belongs to the draft wallet before appending it to `signedDeviceIds`. This protects the web, mobile, and agent signature-update paths that all delegate through `draftService.updateDraft`.
- Reconciled stale plan state: Phase 1 wallet role labels are implemented and tested, and the original open questions now point at the Phase 8, 12, 13, and 14 decisions.
- Confirmed the intended security boundary is still intact: Sanctuary stores no private keys, agent credentials cannot broadcast or approve policies, mobile approval intent does not sign or broadcast, and owner overrides are human-created, bounded, one-time funding exceptions.
- Unknown-destination/self-transfer classification was completed later in Phase 16. Mobile client tests remain deferred until a mobile client package or repository exists.

Verification run:

- `cd server && npx vitest run tests/unit/services/draftService.test.ts` — 44 passed.
- `cd server && npx vitest run tests/unit/services/draftService.test.ts tests/unit/api/drafts-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/mobileAgentDraftService.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/services/backupService.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/agentOperationalAddressService.test.ts tests/unit/services/agentMonitoringService.test.ts` — 214 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `git diff --check` — passed.

Twelfth slice update:

- Added `docs/how-to/agent-wallet-funding.md` as the operator guide for registering agents, issuing runtime keys, validating agent funding drafts, human review, owner overrides, monitoring, backup/restore expectations, and targeted verification.
- Added agent wallet funding incident guidance to `docs/how-to/operations-runbooks.md`, including suspected `agt_` key compromise, agent signer compromise, and operational wallet private-key compromise.
- Added `docs/plans/agent-wallet-funding-release-notes.md` covering the release boundary, API surfaces, operator impact, backup/restore behavior, release gates, and known follow-up.
- Updated the docs index to link the new operator guide and release notes.
- Added agent metadata tables to backup/restore ordering: `walletAgent`, `agentApiKey`, `agentFundingOverride`, `agentAlert`, and `agentFundingAttempt`.
- Marked append-only agent alert and funding attempt history as large backup tables so backup export uses cursor pagination instead of loading all rows at once.
- Extended the Prisma test mock with agent override and alert delegates so backup tests can exercise the new tables.
- Added backup-service coverage proving agent profiles, API key hashes/prefixes, alerts, funding attempts, and owner overrides are exported with BigInt-safe serialization.
- Added `tests/unit/api/agent-wallet-funding-smoke.test.ts`, which exercises the full route path: admin registers agent, admin issues a scoped key, agent submits a signed funding draft, and a human/mobile reviewer receives decoded draft metadata and deep-link payloads.

Verification run:

- `cd server && npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/services/backupService.test.ts` — 71 passed.
- `cd server && npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/api/agent-routes.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/services/mobileAgentDraftService.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/backupService.test.ts` — 149 passed.
- Post-review backup hardening check: `cd server && npx vitest run tests/unit/services/backupService.test.ts` — 71 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `git diff --check` — passed.

Edge case audit:

- Backups now include hashed agent credential records but still do not include raw `agt_` tokens.
- Agent backup ordering restores wallet/user/device prerequisites before `walletAgent`, then restores key, alert, attempt, and override records after the agent profile.
- Agent alert and funding attempt histories use cursor-paginated backup export because they can grow like audit logs.
- Agent funding attempts and owner override amounts preserve satoshi precision through existing `__bigint__` backup serialization.
- Operator docs explicitly distinguish `agt_` key compromise from agent signer private-key compromise; signer compromise is treated as wallet-descriptor compromise.
- Operational wallet compromise is documented as single-sig agent-controlled funds-at-risk, not as a Sanctuary signing failure.
- The smoke test asserts key hashes are not returned from key creation while the one-time `agt_` token is.
- The smoke test verifies submitted agent drafts keep agent id, operational wallet id, and signed-device metadata through to the human/mobile review payload.
- Historical residual follow-up completed by the cross-phase audit update above.

Eleventh slice update:

- Added `GET /api/v1/mobile/agent-funding-drafts` and `GET /api/v1/mobile/agent-funding-drafts/:draftId` for mobile-safe review of pending agent funding drafts.
- Added mobile approve/comment/reject/signature routes under `/api/v1/mobile/agent-funding-drafts/:draftId/*`.
- Returned decoded draft summary metadata from stored PSBT-derived draft fields, including inputs, outputs, selected UTXOs, totals, change, input paths, linked operational wallet id, and wallet metadata.
- Added deep-link payloads that notification senders can reuse for `sanctuary://agent-funding-drafts/:draftId`, web review paths, and API review paths.
- Enforced mobile wallet permissions: `viewTransactions` gates visibility, `signPsbt` gates signed PSBT submission, and review actions require either `signPsbt` or `approveTransaction`.
- Kept approval semantics explicit: mobile approve records audited intent and next action, but it does not auto-sign, broadcast, or force policy approval.
- Routed mobile signed PSBT submission through `draftService.updateDraft`, preserving the existing web signing update path and signed-device aggregation behavior.
- Marked mobile rejections by setting draft `approvalStatus=rejected`, which removes the draft from future pending mobile review lists.
- Added audit events for mobile approve, comment, reject, and sign actions without logging signed PSBT material.
- Added OpenAPI schemas/paths and route registration for the new mobile agent draft API.

Verification run:

- `cd server && npx vitest run tests/unit/services/mobileAgentDraftService.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/routes.test.ts` — 33 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run check:prisma-imports` — passed.

Edge case audit:

- Draft list limits are validated and bounded to 1-100 with a default of 25.
- Rejected, vetoed, expired, non-agent, and already-expired drafts are excluded from pending mobile review queries.
- General rejected-draft lookup remains available internally after a reject so the API can return the rejected review payload.
- BigInt satoshi values are serialized as decimal strings to avoid precision loss.
- Missing or null JSON draft fields are normalized to `null` in mobile summaries.
- A draft without `viewTransactions` mobile permission is not returned in lists or detail responses.
- A per-draft mobile permission denial during cross-wallet listing skips that draft instead of failing the whole list.
- Signature submission is denied unless mobile permissions allow `signPsbt`.
- Approver-only users can record review intent but receive `nextAction=none` unless they can also sign.
- Signed PSBT material is passed only to `draftService.updateDraft`; audit details record draft and device metadata, not PSBT content.
- Empty approve/comment/reject bodies are rejected where a comment or reason is required, and comments/reasons are trimmed and capped at 1000 characters.
- Historical residual follow-up completed by Phase 15 operational docs, runbooks, backup coverage, release notes, and the route smoke path.

Tenth slice update:

- Added `AgentFundingOverride` persistence for one-time owner-created funding windows bounded by agent, funding wallet, operational wallet, amount, expiry, and status.
- Added admin override APIs: list, create, and revoke, with request validation, OpenAPI coverage, DTO serialization, and audit events for create/revoke.
- Updated funding policy so inactive agents, wrong operational-wallet destinations, and cooldowns remain hard failures; cap violations can proceed only when a matching active, unused, unexpired owner override covers the requested amount.
- Marked the matching override used after draft creation and added an override-use audit event linked to the created draft.
- Labeled override-funded agent drafts with `(owner override)` so human reviewers can distinguish exceptional funding from normal in-policy funding.
- Added Admin -> Wallet Agents override management so humans can view active/used/revoked/expired override history, create bounded overrides, and revoke active overrides. Agent credentials cannot call these admin routes.
- Post-commit hardening made override use conditional on `status=active`, `usedAt=null`, and `revokedAt=null`, bounded override listing to 25 rows by default, and documented the policy invariant that overrides waive caps only after status, destination, and cooldown checks pass.
- Kept Sanctuary's boundary intact: overrides do not sign, broadcast, store private keys, move funds directly, or change wallet descriptors.

Verification run:

- `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/agent/dto.test.ts tests/unit/api/openapi.test.ts` — 84 passed.
- Post-hardening focused server check: `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/openapi.test.ts` — 85 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run test:unit` — 366 files / 8870 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npx vitest run tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts` — 9 passed.
- Post-hardening focused frontend check: `npx vitest run tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts` — 10 passed.
- `npm run typecheck:app` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 395 files / 5535 tests passed. Existing jsdom navigation warning remains in `tests/components/BackupRestore/useBackupHandlers.branches.test.tsx`.
- `git diff --check` — passed.

Edge case audit:

- Whitespace-only override reasons are trimmed before validation and rejected when empty.
- Override amounts must be positive and are serialized as strings to avoid satoshi precision loss.
- Expired overrides stay visible in history but cannot satisfy policy; the UI distinguishes expired active rows from currently usable overrides.
- Used and revoked overrides cannot be reused by policy because lookup requires `status=active`, `usedAt=null`, and `revokedAt=null`.
- Override consumption uses a conditional update so a stale or already-used row cannot be marked used a second time.
- Override list responses are bounded to 25 rows by default and allow an explicit validated limit up to 100.
- Cooldown enforcement runs before any override lookup, so an owner override cannot bypass agent cadence controls.
- Wrong operational-wallet submissions fail before override lookup, even if a broad override exists for the same agent.
- Revoked agents cannot receive new owner overrides.
- Override use is marked only after the draft is created, preventing a failed draft build from consuming the override.
- A used override records the draft id and emits a separate audit event for review/history correlation.
- Admin override UI handles empty, loading, error, create, revoke, expired, used, and revoked states without exposing the full agent API key material.
- Historical residual follow-up completed by Phase 14 mobile-safe pending agent draft review, comments/rejection, and signer handoff paths.

Ninth slice update:

- Added a receive-address-specific address repository helper so agent operational address requests cannot return wallet change addresses.
- Added `getOrCreateOperationalReceiveAddress`, which returns an existing unused operational receive address or, when the linked single-sig operational wallet has descriptor metadata, derives and stores a fresh receive-address gap.
- Wrapped operational address generation in the existing per-agent advisory lock to avoid concurrent duplicate derivation for the same agent.
- Kept descriptorless operational wallets in read-only mode: they still fail closed instead of accepting an unverified agent-provided address.
- Updated `GET /api/v1/agent/wallets/:fundingWalletId/operational-address` to use the service and return `generated: true|false`.
- Added `POST /api/v1/agent/wallets/:fundingWalletId/operational-address/verify` so agents can preflight whether a provided destination is a known linked operational receive address.
- Updated OpenAPI docs/schema for the generated-address behavior.
- Kept Sanctuary's boundary intact: the endpoint derives watch-only receive addresses only; it does not store private keys, sign, broadcast, mark addresses used, or accept unverified destinations.

Verification run:

- `cd server && npx vitest run tests/unit/services/agentOperationalAddressService.test.ts tests/unit/api/agent-routes.test.ts tests/unit/repositories/addressRepository.test.ts tests/unit/api/openapi.test.ts` — 86 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run test:unit` — 366 files / 8863 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Null/missing descriptors fail closed with an explicit invalid-input error instead of falling back to agent-provided data.
- Empty receive-address sets derive from index `0`; mixed receive/change history derives from the highest receive index plus one.
- Change-address paths are filtered out when selecting an unused operational receive address.
- Malformed derivation-path history is ignored for next-index calculation.
- Generated addresses are persisted as unused and the endpoint does not mark them used prematurely.
- The service validates derived paths are receive paths before storing a generated gap.
- The verification endpoint returns `verified=false` without wallet metadata for unknown addresses, other-wallet addresses, and change addresses.
- Unsupported operational wallet networks and non-single-sig operational wallets fail before derivation.
- A duplicate insert race re-reads the next unused receive address after `createMany(..., { skipDuplicates: true })`.
- Historical residual follow-up completed by Phase 13 human-created owner override workflows for exceptional over-cap funding.

Eighth slice update:

- Added `GET /api/v1/admin/agents/dashboard` for operational dashboard rows with agent metadata, operational UTXO balance, pending funding draft counts, last funding request, last operational spend, open alert counts, active key counts, recent drafts, recent spends, recent alerts, and key metadata.
- Dashboard balances aggregate unspent operational wallet UTXOs from the database, so the totals come from the same source as wallet balance queries rather than cached UI state.
- Recent funding requests, operational spends, and open alerts are fetched with windowed bulk queries instead of per-agent query fan-out.
- Added frontend admin API bindings and an Admin -> Agent Wallets route.
- Added the Agent Wallets dashboard with spend-ready totals, operational balance totals, pending drafts, open alerts, funding/operational wallet links, review-drafts navigation, pause/unpause actions, and per-key revocation actions.
- Added expandable detail rows for policy settings, recent funding requests, operational spends, open alerts, and active keys.
- Kept Sanctuary's boundary intact: the dashboard does not sign, broadcast, move funds, store private keys, or alter wallet descriptors. Pause/unpause only updates the agent status used by the existing agent API gate.

Verification run:

- `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/agent/dto.test.ts tests/unit/api/admin-agents-routes.test.ts` — 20 passed.
- `npx vitest run tests/components/AgentWalletDashboard.test.tsx tests/components/ui/Button.test.tsx tests/components/ui/LinkButton.test.tsx tests/components/ui/EmptyState.test.tsx tests/api/adminAgents.test.ts tests/src/app/appRoutes.test.ts` — 28 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 395 files / 5534 tests passed.
- `cd server && npm run test:unit` — 365 files / 8849 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Empty dashboard responses render a stable empty state.
- Load failures render retry UI and do not expose stale partial data.
- Dashboard date formatting handles missing values and invalid date strings.
- Dashboard satoshi formatting handles empty or malformed string values without crashing the page.
- Active key counts exclude revoked and expired keys on the server; the UI also filters inactive keys before showing revocation actions.
- Pending draft counts exclude expired drafts and include unsigned, partial, and signed drafts that still need human review or broadcast follow-up.
- Pause/unpause actions call the existing admin agent update endpoint, so paused agents are blocked by the existing agent API status checks.
- Revoke-key actions require confirmation and call the existing scoped key revoke endpoint; wallet descriptors are unchanged.
- Shared link-button styling has direct tests for default secondary links, custom variants/sizes, and forwarded React Router link props.
- Historical residual follow-up completed by Phase 12 operational address generation for watch-only wallets with sufficient descriptor metadata.

Seventh slice update:

- Added operational monitoring policy fields to wallet agents: refill threshold, large-spend threshold, large-fee threshold, repeated-failure threshold/lookback, and alert dedupe window.
- Added persisted `AgentAlert` history with dedupe keys, severity/status, optional tx/amount/fee/threshold fields, rejected-attempt context, and JSON metadata for dashboard/mobile use.
- Added a repository-level advisory lock around alert dedupe check/write so concurrent alert evaluation cannot duplicate rows inside the dedupe window.
- Operational outgoing transaction notifications now also evaluate alert rules for linked active agents. Large spends and large fees dedupe per transaction; balance threshold alerts dedupe by agent/wallet/window.
- Rejected agent funding attempts now evaluate repeated-failure alert rules from stored monitoring records instead of logs.
- Added `GET /api/v1/admin/agents/:agentId/alerts` plus OpenAPI coverage and frontend admin API bindings.
- Added monitoring fields to the Admin -> Wallet Agents create/edit UI and summary rows.
- Kept Sanctuary's boundary intact: alerts observe and persist state only; they do not sign, broadcast, move funds, or store private keys.

Verification run:

- `cd server && npm run prisma:generate` — passed.
- `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts` — 41 passed.
- `npx vitest run tests/api/adminAgents.test.ts tests/components/AgentManagement.test.tsx` — 8 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 393 files / 5528 tests passed.
- `cd server && npm run test:unit` — 364 files / 8843 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- Post-review targeted checks: `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/agent/dto.test.ts tests/unit/services/bitcoin/transactionService.broadcast.test.ts` — 53 passed.
- Post-review targeted check: `npx vitest run tests/components/AgentManagement.test.tsx` — 6 passed.

Edge case audit:

- Alert rule fields are optional; blank create fields are omitted, and cleared edit fields are sent as `null`.
- Threshold values of `0`, `null`, or unset do not trigger alerts; positive thresholds are required before evaluation writes history.
- Transaction-specific large-spend and large-fee alerts use txid-based dedupe from epoch so retries cannot duplicate the same tx alert.
- Balance and repeated-failure alerts use a configurable dedupe window, defaulting to 60 minutes, to avoid writing on every sync.
- Alert dedupe uses a PostgreSQL advisory transaction lock keyed by dedupe key, preserving repeat alerts after the configured window while preventing concurrent duplicate writes inside the window.
- Monitoring failures are logged and swallowed so alert persistence cannot mask transaction notification delivery or agent API responses.
- Repeated-failure alerts count stored rejected attempts in the configured lookback window.
- Historical residual follow-up completed by Phase 11 dashboard alert surfaces and Phase 16 unknown-destination/self-transfer classification.

---

Sixth slice update:

- Added `GET /api/v1/admin/agents/options` so the admin UI can present valid user, funding-wallet, operational-wallet, and signer-device choices without ad hoc client-side discovery.
- Added frontend admin agent API bindings and typed metadata for agent profiles, options, scoped keys, create/update payloads, and one-time key creation responses.
- Added an Admin -> Wallet Agents section with summary stats, agent list rows, policy/status display, create/edit modals, revoke actions, scoped key issuance, one-time `agt_` token display, copy handling, and key revocation.
- Added UI filtering that mirrors core server validation: funding wallets are multisig, operational wallets are single-sig on the same network, both are scoped to the target user, and signer devices must be linked to the funding wallet.
- Added admin-only linked wallet badges in wallet detail headers for "Agent Funding Wallet" and "Agent Operational Wallet" context.
- Hardened UI edge cases for optional numeric policy fields, invalid expiration dates, unavailable clipboard APIs, and stale form selections after user/wallet changes.
- Post-review hardening: wallet detail now requests server-filtered agent links with `walletId`, admin badges align with the existing shared-wallet badge palette, key revoke text has a dark-mode state, and focused tests cover load errors, empty lists, clipboard failures, and admin-gated wallet-detail fetching.

Verification run:

- `npm run typecheck:app` — passed.
- `npx vitest run tests/components/AgentManagement.test.tsx tests/components/WalletDetail.test.tsx tests/components/WalletDetail/WalletHeader.test.tsx tests/api/adminAgents.test.ts` — 39 passed.
- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/openapi.test.ts` — 56 passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run build` — passed.
- `npm run test:run` — 393 files / 5528 tests passed.
- `cd server && npm run test:unit` — 363 files / 8837 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Empty agent lists render a stable empty state, and loading/error states do not expose partial data.
- Create submit stays disabled until a target user, funding wallet, operational wallet, signer, and non-empty name are selected.
- Editing does not allow changing immutable linkage fields; it only updates name, status, policy caps, cooldown, and notification/pause settings.
- Optional caps/cooldowns are omitted on create when blank and sent as `null` on update when cleared.
- Clipboard copy reports an action error when the browser clipboard API is unavailable or denies the write.
- Full `agt_` tokens are held only in the create-key modal state and are cleared when the modal closes.
- Wallet detail agent badges are fetched only for admins; non-admin wallet detail views do not call the admin agent endpoint.
- Historical residual follow-up completed by Phase 10 persisted alert thresholds/history for operational wallet monitoring.

---

Fifth slice update:

- Resolved Phase 8 policy semantics in the plan:
  - Agent over-cap submissions remain hard rejected.
  - Human multisig signature is the approval for normal in-policy funding.
  - Agent-provided operational destinations are accepted only when Sanctuary verifies they belong to the linked operational wallet.
  - Concurrent agent drafts are allowed only when they do not violate UTXO locks or aggregate policy caps.
- Added `AgentFundingAttempt` persistence for accepted/rejected funding attempts, including agent id, key metadata, wallet ids, amount, fee rate, recipient, reason code/message, and request metadata.
- Wrapped agent funding policy evaluation, draft creation, UTXO locking, and `lastFundingDraftAt` update in a per-agent PostgreSQL advisory lock.
- Recorded rejected funding attempts on validation, policy, scope, PSBT, and lock failures without hiding the original API error.
- Recorded accepted attempts after draft creation for monitoring symmetry.
- Updated OpenAPI text for the agent funding endpoint to state that agents cannot request/apply owner overrides.
- Added tests for advisory lock usage and funding attempt persistence/rejection recording.
- Post-review hardening: capped in-memory draft notification dedupe to 1,000 keys, aligned the agent funding draft badge with the existing shared palette, and changed the autonomous-spend warning into the standard amber callout pattern.

Verification run:

- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/openapi.test.ts` — 60 passed.
- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/telegramService.test.ts` — 134 passed.
- `cd server && npm run test:unit` — 363 files / 8834 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run typecheck:app` — passed.
- `npm run test:run` — 391 files / 5517 tests passed.
- `cd server && npx vitest run tests/unit/services/notifications/notificationService.test.ts` — 6 passed.
- `npx vitest run tests/components/DraftList/DraftRow.branches.test.tsx` — 6 passed.
- `git diff --check` — passed.

Edge case audit:

- Rejected funding attempts are best-effort monitoring records; a failure to write the monitoring record does not mask the original validation/policy error.
- Accepted funding attempt recording is also best-effort and does not make Sanctuary a signer or custodian.
- The advisory lock serializes the critical section across app processes that share the same PostgreSQL database.
- The lock does not refactor all draft writes into one transaction client; if a database failure occurs after draft creation but before cadence update, the API can still surface an error after a draft exists. Daily/weekly aggregate caps still include stored drafts, while cooldown depends on `lastFundingDraftAt`.
- Address generation is intentionally deferred to Phase 12; Phase 8 keeps the stricter current behavior that only known linked operational addresses are returned/accepted.

---

Fourth slice update:

- Added admin-only agent management endpoints for listing, creating, updating, and revoking wallet agents.
- Added admin-only `agt_` key management endpoints for listing, issuing, and revoking scoped agent API keys. Full keys are returned only at creation time.
- Agent creation validates that the target user can access both linked wallets, the funding wallet is multisig, the operational wallet is single-sig, both wallets use the same network, and the registered signer device belongs to the funding wallet.
- Added per-agent policy fields and enforcement for per-request funding caps, operational-wallet balance caps, daily limits, weekly limits, cooldowns, active/revoked state, and linked destination wallet.
- Added agent linked-wallet read endpoints for minimal wallet summary and the next known unused operational receive address.
- Added an agent draft-signature update endpoint that lets an agent refresh the agent signature on its own draft while reusing the same PSBT validation path and existing draft lock.
- Agent-created drafts now store `agentId` and `agentOperationalWalletId`, use a default agent funding label when none is provided, and surface agent metadata through the draft API/client type.
- Telegram draft notifications now use agent-specific copy, include the linked operational wallet name when known, show whether the agent signature is present, warn about post-funding autonomy, and notify only owner/signer wallet parties for agent drafts.
- Draft notification dedupe suppresses repeated agent funding notifications with the same agent/wallet/recipient/amount key for 10 minutes.
- Operational-wallet outgoing transaction notifications are enriched as agent operational spends; configured agents can be auto-paused after such a spend.
- The draft row now labels agent funding requests, shows the linked operational wallet destination context, shows agent signature state, and warns that the operational wallet can spend without multisig approval once funded.
- OpenAPI coverage was added for the admin agent endpoints and agent read/update endpoints.

Verification run:

- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/telegramService.test.ts` — 131 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npx vitest run tests/unit/api/openapi.test.ts` — 43 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run test:unit` — 363 files / 8831 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run test:run` — 391 files / 5517 tests passed.
- `npx vitest run tests/components/DraftList/DraftRow.branches.test.tsx` — 6 passed.
- `git diff --check` — passed.

Edge case audit:

- Null, blank, unknown, expired, malformed, and revoked agent API keys are rejected before route handlers run.
- Agent profiles that are paused, revoked, or linked to different wallets cannot submit funding drafts.
- Admin agent creation rejects same-wallet links, nonexistent users/wallets, wrong wallet types, network mismatches, inaccessible wallets, and signer devices not attached to the funding wallet.
- Agent funding requests reject missing or malformed PSBTs, PSBT transaction mismatches, duplicate inputs, empty inputs/outputs, unknown outputs, missing recipient payment, amount mismatches, spent/frozen/locked UTXOs, and missing/invalid registered signer partial signatures.
- Fee rate must be finite and inside Sanctuary's configured global min/max bounds.
- Per-request, daily, weekly, cooldown, and operational balance caps reject over-limit requests before drafts are stored.
- Agent signature refreshes are limited to the agent's own drafts and tolerate that draft's existing lock while still rejecting conflicting locks from other drafts.
- Telegram agent draft notifications no longer reference a human creator and do not suppress the linked human owner/signer.
- Viewer-only wallet users are not selected for Telegram agent funding draft notifications.
- Duplicate agent draft notification keys are suppressed for a bounded TTL and old keys are pruned opportunistically.
- Operational spend enrichment only runs for outgoing transactions and only for active agents linked to that operational wallet.
- Historical concurrency risk partially resolved by the later per-agent PostgreSQL advisory lock. The remaining transactional-consistency question is tracked as `AGENT-1` in the actionable backlog at the top of this file.

Historical follow-up status:

- Agent profile/key management UI was added in the later Admin -> Wallet Agents work.
- Agent Wallets dashboard was added in Phase 11.
- Operational receive address generation was resolved in Phase 12.
- Owner overrides for exceptional over-cap funding were resolved in Phase 13.
- Consider moving policy evaluation plus draft creation into one serializable database transaction if high-concurrency agent submissions become realistic.
- Extend mobile approval once the mobile app exists.

---

Third slice update:

- Added `agentFundingDraftValidation`, which decodes the unsigned and signed PSBTs before accepting an agent funding draft.
- The signed PSBT must have the same unsigned transaction shape as the submitted draft PSBT.
- Every input must be an available funding-wallet UTXO, and spent, frozen, missing, or draft-locked inputs are rejected.
- Every output must be either a linked operational-wallet payment or funding-wallet change. Unknown outputs are rejected.
- The submitted `recipient` must belong to the operational wallet and `amount` must equal the total paid to that wallet.
- Draft display and locking metadata is now derived from the decoded PSBT: selected outpoints, inputs, outputs, fee, totals, change, RBF signaling, and signer input paths.
- The agent route no longer trusts agent-provided `selectedUtxoIds`, output/input JSON, fee totals, change values, `payjoinUrl`, or `isRBF`; it always creates a non-RBF draft lock for agent funding submissions.
- The signed PSBT must include a cryptographically valid partial signature from the registered agent signer fingerprint on every input.
- Added repository support for exact outpoint lookup with spent/frozen/draft-lock state.

Verification run:

- `cd server && npx vitest run tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/api/agent-routes.test.ts tests/unit/repositories/utxoRepository.test.ts` — 35 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run test:unit` — 361 files / 8815 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run typecheck:app` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `git diff --check` — passed.

Edge case audit:

- Missing or malformed PSBTs: rejected.
- Signed PSBT transaction mismatch from the unsigned draft PSBT: rejected.
- Empty input or output sets: rejected.
- Missing funding-wallet input UTXOs: rejected.
- Already-spent, frozen, or draft-locked funding UTXOs: rejected.
- Outputs to non-wallet addresses or non-standard scripts: rejected.
- Recipient not in the linked operational wallet: rejected.
- Declared amount differing from decoded operational-wallet payment total: rejected.
- Invalid signer device fingerprint format: rejected.
- Missing or invalid registered agent partial signature on any input: rejected.
- Funding and operational wallet network mismatch or address overlap: rejected.

Historical follow-up status:

- Admin/API management flows for registering agents and issuing/revoking `agt_` keys were completed in later slices.
- Policy caps, fee-rate bounds, and rate limits for agent funding requests were completed in later slices.
- Human-visible draft and Telegram copy for linked operational-wallet destinations were completed in later slices.
- Notification dedupe and operational wallet monitoring were completed in later slices.

---

Implemented the second server slice for agent multisig funding:

- `POST /api/v1/wallets/:walletId/drafts` now accepts `signedPsbtBase64` and `signedDeviceId` alongside the unsigned PSBT payload.
- If one initial signature field is present without the other, draft creation is rejected.
- If both are present, Sanctuary verifies the `signedDeviceId` is linked to the funding wallet before creating the draft.
- Accepted initial signatures create a normal draft with `status = partial`, `signedPsbtBase64` set, and `signedDeviceIds = [signedDeviceId]`.
- Added `WalletAgent` and `AgentApiKey` persistence, with `agt_` scoped bearer keys stored as hashes and separated from read-only MCP keys.
- Added `/api/v1/agent/wallets/:fundingWalletId/funding-drafts`, scoped to one funding wallet, one operational wallet, and one signer device.
- Agent-created drafts pass `notificationCreatedByUserId = null`, so Telegram draft notifications go to all eligible wallet parties and show the agent label as the creator.
- Agent submissions are audit logged with agent id, key prefix, wallet ids, signer device id, draft id, amount, and fee rate.
- OpenAPI now declares `agentBearerAuth` and documents the agent funding route. The pre-existing admin MCP key route coverage gap is also documented.
- The Prisma import guardrail no longer needs the transaction export route exception because repeatable-read export transactions now go through the transaction repository.

Verification run:

- `cd server && npx vitest run tests/unit/agent/auth.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/agent-routes.test.ts tests/unit/routes.test.ts tests/unit/api/openapi.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/api/drafts-routes.test.ts` — 129 passed.
- `cd server && npx vitest run tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/handlers.test.ts` — 15 passed.
- `cd server && npm run test:unit` — 360 files / 8807 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `cd server && npm run build` — passed.
- `npm run typecheck:app` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `git diff --check` — passed.

Edge case audit:

- Missing `signedPsbtBase64` or missing `signedDeviceId`: rejected.
- Empty initial signature fields: rejected by route validation and service validation.
- Unknown signer device id: rejected before persistence.
- Wallet missing during signer validation: rejected.
- Existing unsigned draft creation path stays unchanged.
- RBF UTXO locking behavior stays unchanged.
- Missing, malformed, unknown, revoked, or expired `agt_` keys: rejected.
- Paused/revoked agent profile: rejected.
- Funding wallet id mismatch: rejected.
- Operational wallet id mismatch: rejected.
- Agent key without `create_funding_draft` scope: rejected.
- Agent-created drafts do not suppress notifications to the linked human user.
- Empty route body and missing required agent funding fields: rejected before service calls.

Historical follow-up status:

- PSBT content validation against funding-wallet UTXOs and operational-wallet destination addresses was completed in later slices.
- Agent cosigner partial-signature validation was completed in later slices.
- Admin/UI flows for creating agents and issuing/revoking agent API keys were completed in later slices.
- Agent-specific funding policy caps, rate limits, notification dedupe, and richer notification copy were completed in later slices.

---

# HttpOnly cookie auth + refresh flow migration — implementation plan

ADRs:

- `docs/adr/0001-browser-auth-token-storage.md` — Accepted 2026-04-12
- `docs/adr/0002-frontend-refresh-flow.md` — Accepted 2026-04-12

Branch strategy: one PR per phase. Each phase is independently revertible. Do not start a phase until the previous one is merged and CI is green on `main`.

Historical note: phases 1-6 are complete in the current codebase. The old phase checklist remains below as implementation history, not live work.

**Resolved decisions** (from the user check-in on 2026-04-12, applying the "no cutting corners" working rule):

1. **CSRF library:** `csrf-csrf` (modern, server-stateless double-submit, well-maintained).
2. **Cookie names:** `sanctuary_access` (HttpOnly access token), `sanctuary_csrf` (readable double-submit token), `sanctuary_refresh` (HttpOnly refresh token, scoped to `/api/v1/auth/refresh`). All snake_case to match the existing `sanctuary_token` convention in `src/api/client.ts:137`.
3. **`/auth/me` endpoint:** already exists at `server/src/api/auth/profile.ts:20`. Reused as-is.
4. **Refresh flow:** included in this work, not deferred. Designed in ADR 0002. Implementation lands in Phase 4.

## Phase 0 — ADR 0002 review and acceptance — COMPLETE 2026-04-12

Goal: the refresh-flow design is reviewed, accepted, and ready to merge into Phase 4. This is a documentation-only phase but it gates everything else — the design must land before any cookie code is written, since the cookie shape (`sanctuary_refresh` scoped to `/api/v1/auth/refresh`) is decided here.

- [x] User reviews `docs/adr/0002-frontend-refresh-flow.md`.
- [x] Push back on any design decisions or accept as-is. (Codex review caught the BroadcastChannel-as-mutex race; ADR 0002 was revised from Option C to Option E — Web Locks API + BroadcastChannel for state propagation only.)
- [x] Mark ADR 0002 status from "Proposed" to "Accepted".
- [x] Update the cross-reference in ADR 0001 to also say "Accepted".

**Exit criteria:** ADR 0002 status is Accepted. ✓ Open questions inside ADR 0002 (refresh lead time, refresh token TTL, WebSocket reconnect on refresh, logout-all UI, Page Visibility API behavior) are deferred to implementation time per the ADR's own "Open questions" section — they do not block Phase 1.

## Phase 1 — Backend foundation (PR 1) — COMPLETE 2026-04-13

Goal: the backend can verify either a cookie+CSRF or an `Authorization: Bearer` header on every protected route, but no route is yet _issuing_ cookies. This phase ships behind no flag and changes no behavior; it just teaches the auth middleware to recognize cookies.

- [x] Add `cookie-parser` to `server/package.json` and wire it into `server/src/index.ts` before the auth middleware runs.
- [x] Add `csrf-csrf` to `server/package.json`. Capture the version pin in the PR description.
- [x] Add CSRF middleware to `server/src/middleware/csrf.ts` using `csrf-csrf`'s `doubleCsrf` factory. Use a stable secret derived from the existing JWT secret material so deployers do not need to add a new env var.
- [x] Update `server/src/middleware/auth.ts` to read the access token from a `sanctuary_access` cookie when no Authorization header is present.
- [x] When the request authenticated via cookie, require a valid `X-CSRF-Token` for POST/PUT/PATCH/DELETE. The Authorization-header path is exempt (mobile/gateway).
- [x] Tests:
  - [x] `server/tests/unit/middleware/auth.test.ts` — cookie-only auth, header-only auth, both present (cookie wins), neither (401).
  - [x] `server/tests/unit/middleware/csrf.test.ts` (new) — POST without token rejected, with wrong token rejected, with correct token accepted, GET exempt.
  - [x] No regression in `server/tests/unit/middleware/gatewayAuth.test.ts`.

**Exit criteria:** `cd server && npm run build`, `cd server && npx vitest run tests/unit/middleware/`, and the existing auth integration suite all pass. No frontend changes yet. No client breaks because no route is _issuing_ cookies yet.

## Phase 2 — Backend response cookies + expiry header (PR 2) — COMPLETE 2026-04-13

Goal: auth endpoints set the cookies on success, clear them on logout, and surface access-token expiry to the client via `X-Access-Expires-At`. The JSON `token`/`refreshToken` fields stay in the response body for one release as a rollback safety net.

- [x] `server/src/api/auth/login.ts:187-313` — on successful login set:
  - [x] `sanctuary_access` (HttpOnly, Secure, SameSite=Strict, path `/`, Max-Age = access TTL in seconds)
  - [x] `sanctuary_refresh` (HttpOnly, Secure, SameSite=Strict, **path `/api/v1/auth/refresh`**, Max-Age = refresh TTL in seconds)
  - [x] `sanctuary_csrf` (Secure, SameSite=Strict, **NOT HttpOnly** so the frontend can read it)
  - [x] `X-Access-Expires-At` response header with the access token's `exp` claim as ISO 8601.
  - [x] Keep the JSON `token`/`refreshToken` fields for one release.
- [x] `server/src/api/auth/twoFactor/verify.ts:33-140` — same treatment on 2FA success.
- [x] `server/src/api/auth/tokens.ts:28-81` (refresh):
  - [x] Read refresh token from `sanctuary_refresh` cookie when the request body has no `refreshToken` field.
  - [x] Issue rotated `sanctuary_access`, `sanctuary_refresh`, and `sanctuary_csrf` cookies on success.
  - [x] Set `X-Access-Expires-At` on the response.
  - [x] Keep accepting the body field for the gateway/mobile path.
- [x] `server/src/api/auth/tokens.ts:87-160` (logout, logout-all) — clear all three cookies via `Set-Cookie` with `Max-Age=0`.
- [x] `server/src/api/auth/profile.ts:20` (`/auth/me`) — set `X-Access-Expires-At` on the response so the client can schedule its first refresh after a page reload without an explicit refresh.
- [x] Update OpenAPI auth response schemas in `server/src/api/openapi/` to document `cookieAuth` and `csrfToken` security schemes alongside the existing `bearerAuth`.
- [x] Tests:
  - [x] `server/tests/unit/api/auth.test.ts` and the 2FA verify tests — assert all three Set-Cookie headers carry the expected attributes (HttpOnly where applicable, Secure, SameSite=Strict, expected paths, expected Max-Age).
  - [x] Logout test — assert all three cookies cleared.
  - [x] Refresh tests:
    - [x] Refresh from cookie alone succeeds and rotates the cookies.
    - [x] Refresh from body alone still succeeds (mobile path regression).
    - [x] Refresh with both present uses the cookie.
    - [x] Failed refresh (revoked token) returns 401 and clears the cookies.
  - [x] Every auth response carries `X-Access-Expires-At` with a valid ISO 8601 timestamp matching the JWT `exp` claim.
  - [x] OpenAPI tests still pass with the new security schemes documented.

**Exit criteria:** server builds, all auth tests pass, no frontend changes yet, mobile/gateway path still uses the JSON token in the response body.

## Phase 3 — Backend WebSocket cookie reading (PR 3) — COMPLETE 2026-04-13

Goal: WebSocket upgrades on the same origin authenticate via cookie. The deprecated query parameter token path is removed in the same change.

- [x] `server/src/websocket/auth.ts:56-72` — extract token from `sanctuary_access` cookie when no Authorization header is present. Use a small cookie-parsing helper (or import from cookie-parser) — do not regex-extract.
- [x] Remove the deprecated query parameter token path (`server/src/websocket/auth.ts:62-69`). It has been deprecated long enough and removing it eliminates a token-leakage vector via referer headers / server logs.
- [x] The auth-message-after-connect path (lines 136-191) stays for clients that prefer it. A same-origin browser will normally not need it.
- [x] Confirm `server/src/utils/jwt.ts` continues to honor the original `exp` claim of an access token until that timestamp passes — so an existing WebSocket connection authenticated with the previous access token survives a cookie rotation. This is one of the open questions in ADR 0002 and the answer governs whether we need to force a WS reconnect on refresh.
- [x] Tests:
  - [x] `server/tests/unit/websocket/auth.test.ts`:
    - [x] Upgrade with valid cookie + no header succeeds.
    - [x] Upgrade with header only still works (gateway/mobile regression).
    - [x] Upgrade with deprecated query parameter is now rejected.
    - [x] Upgrade with a 2FA pending token in the cookie is rejected (the existing `pending2FA` check at line 28 still applies).
  - [x] `server/tests/integration/websocket/websocket.integration.test.ts` regression check.

**Exit criteria:** all WebSocket auth tests pass, no broken regressions in the WS integration suite, the deprecated query parameter path is gone from the codebase (also remove any client code that emitted it).

## Phase 4 — Frontend cookie auth + refresh flow (PR 4) — COMPLETE 2026-04-13

This is the biggest phase. It implements both ADR 0001 (cookies replace storage) and ADR 0002 (refresh flow) on the frontend in a single coherent change. Splitting them would mean rewriting `src/api/client.ts` twice.

### 4a — Cookie-based request path

- [x] `src/api/client.ts` — switch every fetch call (`request`, `fetchBlob`, `download`, `upload`) to `credentials: 'include'`.
- [x] `src/api/client.ts` — remove `TokenStorageMode`, `getTokenStorageMode`, `getBrowserStorage`, `getPrimaryTokenStorage`, `readStoredToken`, `writeStoredToken`, the legacy localStorage migration block, the `setToken`/`getToken` exports, and the `Authorization` header injection.
- [x] `src/api/client.ts` — add a CSRF token reader that reads `sanctuary_csrf` from `document.cookie` and injects it as `X-CSRF-Token` on POST/PUT/PATCH/DELETE.

### 4b — Refresh primitive with Web Lock + freshness check

**This is the section that changed after Codex review caught a cross-tab race in the BroadcastChannel-only design. See ADR 0002 Option C (rejected) and Option E (recommended) for the design rationale.**

- [x] New module `src/api/refresh.ts` (or co-located in `client.ts` if it fits cleanly).
- [x] Exports `refreshAccessToken()` returning a Promise.
- [x] Within a single tab, uses single-flight semantics — concurrent callers receive the same in-flight Promise so the lock acquisition itself is not duplicated.
- [x] The single-flight promise wraps `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, async () => { ... })` for cross-tab mutual exclusion.
- [x] Inside the lock callback:
  - [x] **Freshness check first:** if `accessExpiresAt > Date.now() + REFRESH_LEAD_TIME_MS` (60_000), another tab already refreshed during the lock wait — return immediately with no network call.
  - [x] Otherwise, send `POST /api/v1/auth/refresh` with `credentials: 'include'` and the CSRF header.
  - [x] On success, parse `X-Access-Expires-At` from the response, update `accessExpiresAt`, broadcast `refresh-complete` with the new expiry, reschedule the local timer.
  - [x] On failure, broadcast `logout-broadcast` and reject the promise.
- [x] Lock release happens automatically when the callback returns or throws.

### 4c — Scheduled (proactive) refresh

- [x] On every successful auth response (`/auth/login`, `/auth/2fa/verify`, `/auth/refresh`, `/auth/me`), parse `X-Access-Expires-At` and schedule a `setTimeout` for `expiresAt - REFRESH_LEAD_TIME_MS` to call `refreshAccessToken()`.
- [x] Clear the previous timer before scheduling a new one.
- [x] Clear the timer on logout and on `beforeunload`.

### 4d — Reactive (401) refresh

- [x] In `src/api/client.ts:request`, when a response status is 401 and the request was not already a retry, await `refreshAccessToken()` and replay the original request once.
- [x] If the retry also fails with 401, do not retry again — surface the error and trigger logout.
- [x] Non-401 failures (5xx, network) bypass the refresh path entirely.

### 4e — BroadcastChannel state propagation (NOT mutual exclusion)

- [x] On client init, open `new BroadcastChannel('sanctuary-auth')`. Mockable for tests via dependency injection.
- [x] On `refresh-complete` from another tab, update the local `accessExpiresAt` from the broadcast payload and reschedule the local timer.
- [x] On `logout-broadcast` from another tab, trigger the local logout flow.
- [x] **Do not implement a `refresh-start` event.** The Web Lock is the start signal. BroadcastChannel is async pub/sub and cannot prevent races; using it as a coordination primitive was the bug Codex caught in the original ADR draft.
- [x] Close the channel on `beforeunload`.

### 4f — UserContext + logout flow

- [x] `contexts/UserContext.tsx`:
  - [x] Stop calling `apiClient.setToken`. The login/2FA-verify handlers no longer touch token storage.
  - [x] On app boot, call `/api/v1/auth/me`. If it succeeds, hydrate the user and schedule the refresh timer from the response header. If it returns 401, render the login screen.
  - [x] Logout: clear the scheduled refresh timer, broadcast `logout-broadcast`, redirect to login. Both terminal refresh failure and explicit user logout share this path.

### 4g — Tests

- [x] `tests/setup.ts`:
  - [x] Add a `navigator.locks` mock that maintains a Map of held lock names with FIFO waiters and supports multi-instance "tab" simulation. Pure in-memory, no network or filesystem.
  - [x] Add a BroadcastChannel polyfill or mock that supports multi-instance same-channel pub/sub for the test where two simulated tabs interact.
- [x] `tests/api/client.test.ts`:
  - [x] Replace storage mode tests with: every request includes `credentials: 'include'`, non-GET requests include `X-CSRF-Token` from the readable cookie.
  - [x] `setToken`/`getToken` no longer exist (compile-time error if referenced).
  - [x] `request()` parses `X-Access-Expires-At` and updates internal state.
- [x] `tests/api/refresh.test.ts` (new):
  - [x] Within-tab single-flight: two concurrent `refreshAccessToken()` calls return the same promise; the underlying fetch is called exactly once; the Web Lock is acquired exactly once.
  - [x] Proactive refresh: with fake timers, advancing past `expiresAt - REFRESH_LEAD_TIME_MS` triggers a refresh exactly once; the new expiry is honored; the timer reschedules itself.
  - [x] Reactive refresh: a 401 response triggers a refresh and retries the original request; retry success surfaces normally; retry failure surfaces the second 401 and triggers logout.
  - [x] **Cross-tab Web Lock serialization (the test that catches the bug Codex flagged):** simulate two tabs sharing the same lock state. Both tabs trigger `refreshAccessToken()` simultaneously. Assert exactly one `POST /auth/refresh` is sent across both tabs (the second tab waits on the lock, sees fresh `accessExpiresAt` after the broadcast handler ran, and short-circuits).
  - [x] Cross-tab race with stale broadcast: same setup, broadcast handler delayed. Assert the second tab still sends its refresh, the second refresh succeeds, and no logout fires (the "wasted refresh but not broken" path).
  - [x] BroadcastChannel state propagation: `refresh-complete` from another tab updates `accessExpiresAt` and reschedules the timer; `logout-broadcast` triggers the local logout flow.
  - [x] Terminal refresh failure: server returns 401 on `/auth/refresh`. Assert lock is released, `logout-broadcast` is sent, local logout flow fires.
  - [x] Non-401 failures (500, network error) do not trigger a refresh attempt.
- [x] `tests/contexts/UserContext.test.tsx`:
  - [x] Logout clears the scheduled refresh timer and broadcasts `logout-broadcast`.
  - [x] On app boot, `/auth/me` is called; success hydrates user + schedules refresh; 401 renders login screen.
- [x] All existing `apiClient.setToken` test references are removed.
- [x] Component tests that previously relied on `apiClient.setToken` to seed an authenticated state are updated to mock `/auth/me` instead.
- [x] Frontend strict typecheck and 100% coverage gate must stay green, including the freshness short-circuit branch and the lock-held-by-another-tab branch.

**Exit criteria:** `npm run typecheck:app`, `npm run typecheck:tests`, `npm run test:coverage` all pass with 100% coverage. `./start.sh --rebuild` and a manual login + 2FA + WebSocket-bearing page works end-to-end in a browser. Verify in browser devtools that:

- The access cookie is HttpOnly (script cannot read it via `document.cookie`).
- The CSRF cookie is readable and is echoed in the `X-CSRF-Token` header on POSTs.
- A scheduled refresh fires before the access token expires.
- Forcing a 401 (e.g., by waiting past expiry without scheduled refresh) triggers a transparent refresh + retry.
- Two open tabs do not race the refresh; the second tab uses the rotated cookie without making its own refresh call.

## Phase 5 — Documentation (PR 5) — COMPLETE 2026-04-13

Goal: the new model is captured in operations and release docs so the next operator does not have to read both ADRs to understand the system.

- [x] `docs/how-to/operations-runbooks.md`:
  - [x] Add the cookie + Secure + TLS termination requirement.
  - [x] Document the CSRF token rotation behavior.
  - [x] Document the refresh token TTL and rotation.
  - [x] Document the BroadcastChannel cross-tab coordination so an operator debugging "why did all my tabs log out at once" knows where to look.
- [x] `docs/reference/release-gates.md` — cookie/CSRF/refresh test suite added to the Browser auth and CSP gate; Phase 4 Browser Auth Gate section rewritten from "remaining architecture decision" to "resolved 2026-04-13".
- [x] `docs/plans/codebase-health-assessment.md`:
  - [x] Security row moved from B to A- (partial schema coverage + accepted dependency findings keep it from a clean A).
  - [x] HttpOnly-cookie ADR row removed from outstanding items table.
  - [x] Ninth Phase 4 slice section records the ADR 0001/0002 implementation and the undocumented refresh-flow gap closure.
- [x] `docs/adr/0001-browser-auth-token-storage.md` — Resolution section added with full commit history, Codex-caught bug list, and Security grade movement.
- [x] `docs/adr/0002-frontend-refresh-flow.md` — Resolution section added with implementation summary, test coverage list, Codex-caught bugs specific to the refresh flow, and answers to all 5 "open questions."
- [x] OpenAPI: `cookieAuth` and `csrfToken` security schemes are now **referenced** from every browser-mounted protected route (not just declared in `components.securitySchemes`). Added `server/src/api/openapi/security.ts` exporting `browserOrBearerAuth = [{ bearerAuth: [] }, { cookieAuth: [], csrfToken: [] }]` and `internalBearerAuth = [{ bearerAuth: [] }]`; every path file (auth, admin, ai, bitcoin, devices, drafts, intelligence, labels, mobilePermissions, payjoin, push, transactions, transfers, walletExport, walletHelpers, walletImport, walletPolicies, walletSettings, walletSharing, wallets) imports the shared constant; `internal.ts` continues to use bearer-only because the `/internal/ai/*` routes are proxied by the AI container, not reachable from browsers. Test assertions in `server/tests/unit/api/openapi.test.ts` updated to `browserOrBearerAuthSecurity` for browser routes and `bearerOnlyAuthSecurity` for internal routes. Caught by Codex stop-time review of Phase 5 — the original carry-over only verified the schemes were _declared_, not _referenced_.

**Exit criteria:** ✓ docs reviewed, both ADR resolution sections filled in, codebase health assessment grade movement recorded.

## Phase 6 — Deprecation removal (PR 6) — COMPLETE 2026-04-13

Goal: remove the rollback safety net once we are confident the cookie + refresh path is stable.

**Scope note:** the original Phase 6 plan assumed browser-mounted and gateway-mounted auth routes were separately mounted. They aren't — there's a single `authRouter` under `/api/v1/auth` that serves both browsers and the gateway's transparent proxy. Mobile is not currently an active consumer. Given that, Phase 6 strips the JSON `token`/`refreshToken` fields from **all** callers of the auth router. If/when a mobile client ships, it will need to authenticate via cookies OR the auth flow will need a cryptographically-verified gateway channel (the `shared/utils/gatewayAuth.ts` HMAC primitive is the obvious building block). That future work is explicitly out of scope here.

- [x] Remove the JSON `token`/`refreshToken` fields from `/auth/register`, `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` response bodies (`server/src/api/auth/login.ts`, `server/src/api/auth/twoFactor/verify.ts`, `server/src/api/auth/tokens.ts`). Rollback-safety-net comments replaced with Phase 6 rationale.
- [x] Update OpenAPI schemas to drop `token`/`refreshToken` from `LoginResponse` and `RefreshTokenResponse`; `RefreshTokenResponse.required` updated from `['token','refreshToken','expiresIn']` to `['expiresIn']`.
- [x] Remove `VITE_AUTH_TOKEN_STORAGE` leftover from `.env.example` (there was no `vite.config.ts` entry to remove — Phase 4 already did that).
- [x] Audit `src/api/client.ts` for Phase-4-era dead code. Confirmed clean: no `setToken`/`getToken`/`TokenStorageMode`/`readStoredToken`/`writeStoredToken`/`storedToken`/"rollback"/"legacy" references. Phase 4 removed all of it.
- [x] Update 12 unit test assertions in `server/tests/unit/api/auth.routes.registration.test.ts` and `server/tests/unit/api/auth.routes.2fa.test.ts` from `toBeDefined()` to `toBeUndefined()` for `response.body.token` / `response.body.refreshToken`. Where the assertion was load-bearing (rotation tests), replace with `Set-Cookie` content assertions.
- [x] Refactor integration tests in `server/tests/integration/flows/auth.integration.test.ts`, `admin.integration.test.ts`, and `security.integration.test.ts` to read tokens from the `sanctuary_access` / `sanctuary_refresh` Set-Cookie headers instead of the response body. Added `extractAuthTokens(response)` helper in `server/tests/integration/setup/helpers.ts`.

**Exit criteria achieved:**

- ✓ Backend builds and typechecks cleanly.
- ✓ Backend unit + integration test suites pass (8749 unit + 503 integration-skip-when-no-db).
- ✓ Frontend coverage gate stays at 100% (5475 tests).
- ✓ Gateway builds and 510 gateway tests pass.
- ✓ No test references `VITE_AUTH_TOKEN_STORAGE`.
- ✓ No test references `apiClient.setToken`.
- ✓ No production code reads or writes the JSON `token`/`refreshToken` field anywhere on the auth routes.

## Cross-phase guardrails

- Run the full local test suite + typechecks before pushing each phase. CLAUDE.md is explicit: "Do not rely on CI to catch test failures or type errors."
- Pre-commit hooks run AI agents whose feedback must be reviewed (CLAUDE.md "Run `git commit` in foreground"). Each phase commits in foreground.
- Per CLAUDE.md "When fixing CI failures... batch all related fixes together." If a phase touches a pattern (e.g., removing `apiClient.setToken`), grep the full repo for the pattern _before_ committing so we do not ship one file at a time.
- The mobile gateway path (`gateway/`, `shared/utils/gatewayAuth.ts`) must remain untouched in functionality. Every phase should run `cd gateway && npm run build` and the gateway request-validation/proxy/HMAC tests as a regression check.
- The 100% frontend coverage gate is non-negotiable. If a refactor removes coverage, the missing branches must be added back in the same PR.
- Per the "no cutting corners" working rule: if a step would be easier by deferring a related concern, push back on the deferral first. The right question is "is the long-term solution healthier?" not "is this slice smaller?"

## Follow-up Batch: Grade Lizard Regression Cleanup

Goal: restore the latest full-grade maintainability score by clearing the two lizard warnings found in the 2026-04-22 grade run, then update the report/history and merge through the PR flow.

- [x] Refactor `gateway/src/middleware/auth.ts` payload validation so `assertJwtPayload` no longer exceeds the lizard CCN threshold.
- [x] Refactor `scripts/perf/phase3-benchmark.mjs` fixture provisioning so `provisionBenchmarkFixture` no longer exceeds the lizard CCN threshold.
- [x] Run focused tests for gateway auth and the benchmark script syntax/smoke surface.
- [x] Run lizard, lint/typecheck, and the relevant local quality checks.
- [x] Update `docs/plans/codebase-health-assessment.md` and `docs/plans/grade-history/sanctuary_.jsonl` if maintainability returns to the prior baseline.
- [x] Commit, push, open PR, confirm checks, and merge through the protected branch flow.

Review: completed by PR #109, `Clear grade lizard warnings`.

## Follow-up Batch: Login Regression Investigation

Goal: identify and fix the latest release regression where browser login and refresh return 500s, then prove the login flow works again before shipping.

- [x] Reproduce `POST /api/v1/auth/login` and `POST /api/v1/auth/refresh` failures locally against the current release code and capture the server-side error path.
- [x] Inspect recent auth/login/refresh/cookie changes and isolate the root cause rather than treating browser-extension console noise as the bug.
- [x] Implement the backend/frontend fix and add focused regression coverage for the failing path.
- [x] Fix the CLI support-package helper so operators can collect diagnostics even when UI login is blocked.
- [x] Run the relevant local auth, backend, gateway, and login-flow validation needed to prove the regression is fixed.
- [x] Update `tasks/lessons.md` with any workflow lesson from the user correction, then commit/push/PR/merge through the protected flow.

Review: completed by PR #115 and the follow-up login/upgrade hardening in PR #117 and PR #118.

### Findings

- The live login failure was not an auth-route logic regression. The backend rejected the browser origin in `middleware/corsOrigin` before the request reached `/api/v1/auth/login` or `/api/v1/auth/refresh`.
- Historical finding fixed in this batch: the CORS guard had surfaced rejected origins as a generic `500`. The current guard returns a `ForbiddenError` with status `403` and allows request-derived same-origin browser access behind the trusted proxy.
- Historical finding fixed in this batch: the operator support-bundle helper was stale because the compiled backend code lives under `dist/app/src/...`. The current `scripts/support-package-runner.mjs` checks that layout first and falls back to older compiled layouts.

### Local validation completed

- `npm --prefix server run test:run -- tests/unit/middleware/corsOrigin.test.ts` passed with 13 tests after adding request-derived same-origin coverage plus the missing fallback-branch coverage for `getRequestOrigin`.
- `npm --prefix server run test:unit -- --coverage` passed with 385 files / 9108 tests and restored backend coverage to 100% statements, branches, functions, and lines.
- `npm --prefix gateway run test:run -- tests/unit/middleware/auth.test.ts` passed with 21 tests as a focused gateway auth regression check.
- `npm --prefix server run build` passed after switching the backend to the request-aware CORS delegate.
- `bash -n scripts/support-package.sh` passed.
- `git diff --check` passed.
- `npm --prefix server run typecheck:tests` passed on 2026-04-25, so the previous generated-Prisma path mismatch note is no longer current.
