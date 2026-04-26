# MCP Dual-Path Implementation Plan

Date: 2026-04-25
Inputs: `docs/plans/mcp-server-release-readiness-audit.md`

## Goal

Implement two supported ways for local AI tooling to use Sanctuary safely:

1. Direct MCP path: an external MCP client or LAN agent connects to Sanctuary's MCP server using an authenticated, scoped, auditable credential.
2. Sanctuary Console path: the Sanctuary GUI exposes a terminal-like assistant that talks to a LAN LLM through the existing AI proxy and uses backend-controlled read tools.

The release target is read-only wallet and network intelligence. Spending, signing, PSBT import/export, address generation, label mutation, wallet mutation, policy mutation, arbitrary SQL, arbitrary network fetches, and OS shell commands are explicitly out of scope for the first implementation.

## First-Release Cutline

The first release should prove the architecture without trying to expose every possible read on day one.

Must ship:

- Direct MCP remains disabled by default and loopback-only unless explicitly configured.
- MCP client profiles are scoped, expiring, revocable, audited, and safe across backup restore.
- AI Settings uses typed provider profiles with encrypted credentials, endpoint allowlists, capability state, and health checks.
- Sanctuary Console can answer common wallet, transaction, UTXO, fee, and insight questions through backend-executed read tools.
- Console answers show provenance, truncation, sensitivity, and tool traces.
- No shell, arbitrary SQL, write tools, signing, broadcast, PSBT handling, or address generation.
- Existing AI label/query/insight/chat behavior does not need legacy compatibility. Treat the AI surface as greenfield and replace old routes/UI behavior where that produces a cleaner boundary.

Can defer:

- Full GUI read parity across every admin/ops page.
- Direct LAN MCP as a "recommended" path; it can be advanced/power-user with explicit warnings.
- Streaming token output, unless easy after the proxy/orchestrator contract is stable.
- Full MCP OAuth protected-resource metadata if custom scoped bearer auth is clearly documented.
- Future write-path execution. Only the pattern needs to be designed now.

## User Experience Principles

- Make the safe path obvious: most users should use Sanctuary Console inside the app, not expose MCP on the LAN.
- Do not make the console look like an OS terminal. Use command-like ergonomics, but frame it as an audited Sanctuary investigation tool.
- Show what happened: every answer should show tool calls, scoped wallets, redaction, truncation, and computed facts.
- Default to low sensitivity. Sending txids, addresses, labels, memos, or audit data to a model should require explicit profile/turn settings.
- Keep setup linear: enable AI, configure provider, test provider, select active profile, open Console.
- Make denial understandable: "wallet access revoked", "tool not allowed at this sensitivity", "provider unreachable", and "context too large" should be distinct states.
- Preserve user trust by never presenting model guesses as computed Sanctuary facts.

## Key User Journeys

1. Admin configures AI Settings:
   - Opens AI Settings.
   - Creates a provider profile.
   - Adds optional provider credential.
   - Chooses endpoint mode and allowlist.
   - Tests health and capabilities.
   - Selects the active provider profile.

2. User asks a wallet question in Sanctuary Console:
   - Selects one wallet or an explicit wallet set.
   - Chooses max sensitivity and result limit.
   - Asks a question.
   - Sees answer plus tool trace/provenance.
   - Can inspect denied/truncated tool calls without seeing secret payloads.

3. User asks a general network question in Sanctuary Console:
   - Selects General Network scope or leaves wallet scope unset.
   - Asks a question like "how long ago was block 840000?" or "what is the current fee picture?"
   - Backend uses read-only chain/network tools, such as block lookup, chain tip, mempool summary, fee cache, or node status.
   - Sees deterministic facts with provenance: source, computed-at timestamp, current tip, block timestamp, confirmations, and any stale-data warning.

4. Admin creates a direct MCP client profile:
   - Selects target user and wallet scope.
   - Chooses expiry, optional CIDR, and sensitivity scopes.
   - Copies the token once.
   - Uses a generated local-client config snippet.
   - Can test, rotate, or revoke the profile later.

5. Admin restores or migrates an instance:
   - External credentials are fail-closed.
   - Admin reviews MCP keys, agent keys, provider profiles, LAN endpoints, and proxy secrets.
   - Admin regenerates or confirms each external integration before it is usable.

## Core Architecture Decision

Create a shared read-tool registry and make MCP plus the in-app console adapters over that registry.

The registry should live outside `server/src/mcp` so it is not transport-specific. A practical shape:

```text
server/src/assistant/tools/
  registry.ts
  context.ts
  schemas.ts
  tools/
    wallets.ts
    transactions.ts
    utxos.ts
    addresses.ts
    labels.ts
    policies.ts
    drafts.ts
    chain.ts
    market.ts
    insights.ts
    audit.ts
```

Each tool definition should include:

- stable name and description
- input schema
- precise output schema
- sensitivity level: `public`, `wallet`, `high`, or `admin`
- required scope: none/general network, wallet role/access level, admin, audit-log access, agent-read access, sensitive-data access
- row/result byte budget
- deterministic executor that receives an authenticated Sanctuary context
- redaction policy
- audit metadata

MCP should register those tools through an MCP adapter. The console should call those tools through a backend orchestrator. The LLM should never get database access, shell access, browser tokens, or raw MCP API keys.

## Tool Result Contract

Every shared read-tool executor should return a common envelope, not only domain data:

```text
{
  data,
  facts,
  provenance,
  sensitivity,
  redactions,
  truncation,
  warnings,
  audit
}
```

Envelope fields:

- `data`: typed structured result for API/MCP clients.
- `facts`: small deterministic statements safe for model synthesis, such as totals, counts, date ranges, and fee estimates.
- `provenance`: scope, wallet IDs when applicable, object IDs when applicable, chain/network source, time ranges, filters, source repositories, and computed-at timestamp.
- `sensitivity`: maximum emitted sensitivity and whether it is model-sendable.
- `redactions`: what was omitted or transformed.
- `truncation`: row/byte/token limit state.
- `warnings`: non-fatal issues such as stale fee cache or partial data.
- `audit`: compact metadata for audit logs and traces, never raw secret values.

MCP can return `data` plus metadata. Sanctuary Console should send mostly `facts`, allowed low-sensitivity `data`, and `provenance` to the LLM. The UI should render provenance and traces from the same envelope.

## Authentication Model

For the outside-LLM/direct MCP path, the authenticated actor is the MCP client process or LAN agent, not the model itself. The model should choose tool calls; the client process stores and sends the bearer token.

Implement "MCP client profiles" around the existing `mcp_...` key model:

- owner user
- display name
- wallet scope, required by default
- expiry, required by default for LAN profiles
- audit-log scope, off by default and admin-only
- high-sensitivity scope, off by default
- optional allowed CIDR/IP list for LAN deployments
- per-key rate limit override or profile tier
- last-used IP, user agent, and timestamp
- one-click revoke and rotate

Do not pass browser JWTs through MCP. Do not expose MCP bearer tokens to the browser UI after creation. Do not place MCP bearer tokens inside LLM prompts or tool results.

For the Sanctuary Console path, use the logged-in user's existing session and access. The backend creates a console execution context from the authenticated user and selected scope. The scope can be general network, one wallet, selected wallets, a specific wallet object, or admin/audit when authorized. It does not need to mint an MCP key for normal use.

## AI Proxy Direction

The current AI proxy has the right security instinct: it is isolated from the database, private keys, signing paths, and persistent storage, and the main backend remains the trusted authority. Keep that boundary.

It is not ideal as-is for the Sanctuary Console. Today it is mostly a prompt-string service with feature-specific routes (`/suggest-label`, `/query`, `/analyze`, `/chat`), endpoint/model-only config, no provider authentication, no explicit tool-call protocol, and no service authentication on normal generation routes beyond Docker network isolation. For console/MCP work, refactor it into a stricter model gateway.

Keep these properties:

- no database access
- no signing access
- no wallet secrets
- no arbitrary filesystem or shell access
- external model calls happen only from the proxy, not the main backend
- backend remains responsible for user auth, wallet access, tool authorization, and tool execution

Change these properties before using it for the console:

- Require backend-to-proxy authentication on every non-health route, not only `POST /config`.
- Stop forwarding browser JWTs to the proxy for new console flows. The backend should authorize the user, assemble sanitized tool context, and call the proxy with a service credential.
- Add provider credentials to AI settings: optional encrypted API key, provider type, base URL, model, default temperature, max output tokens, request timeout, and feature flags for JSON mode/tool-call support.
- Support authenticated LAN LLM endpoints. If the external LLM server requires a token, mTLS, or a reverse-proxy header, only the proxy should hold and send that credential.
- Add endpoint egress controls. Allow explicit bundled/host/LAN/cloud modes, block cloud metadata and Sanctuary internal infrastructure by default, and require an explicit allowlist for LAN endpoints.
- Add a normalized model invocation API, for example `/v1/generate`, `/v1/plan-tools`, and `/v1/synthesize`, rather than adding more feature-specific prompt routes.
- Add OpenAI-compatible `tool_calls` support plus strict JSON fallback for local models that cannot emit native tool calls.
- Return typed errors: provider unavailable, timeout, invalid model response, context too large, unsupported capability, auth failure, and rate limit.
- Avoid logging prompts, tool results, or model completions. Log request IDs, provider type, model, duration, status, token estimates/counts when available, and error class.
- Add streaming support later through backend-mediated SSE/WebSocket. The browser should not connect directly to the AI proxy.
- Keep prompt templates either in the backend orchestrator or in shared files versioned with tests. The proxy should not know wallet business semantics beyond generic model invocation.

Net design: the proxy should not execute tools. It should help the backend ask the model, "what tool calls should we consider?" and later, "synthesize an answer from these sanitized facts." The backend validates every proposed tool call before execution.

## Cross-App Analysis Findings

These app areas need explicit implementation work before the console or LAN MCP feature is release quality.

### Auth And Access Control

Sanctuary already has role-aware wallet access helpers: `view`, `edit`, `approve`, and `owner`, with direct user and group-derived access. The tool registry should use those exact role predicates instead of a generic `hasAccess` boolean.

Implementation notes:

- Tool metadata must declare the minimum wallet access level: `view`, `edit`, `approve`, or `owner`.
- Most first-release tools should require `view`; admin/ops tools should require admin; future write-like tools should require explicit `edit`, `approve`, or `owner` plus user confirmation.
- Check wallet access at every tool call, not only when a conversation starts. Wallet sharing can change while a conversation is open.
- Treat group access as first-class. Tool traces should report the resolved role but not leak group membership details unless the tool explicitly reads access metadata.
- Keep agent credentials separate from MCP credentials. Do not let `agt_...` keys authenticate MCP or console calls.
- Agent/autopilot data should be read-only in the first release and gated by owner/admin or explicit agent-read scope.

### AI Settings And Secret Storage

System settings are generic JSON strings today. SMTP passwords are encrypted, but AI endpoint/model settings are plain and there is no provider credential model yet.

Implementation notes:

- Create typed AI provider settings instead of extending the generic settings map ad hoc.
- Store provider API keys, LAN LLM bearer tokens, reverse-proxy headers, or mTLS material encrypted with the existing encryption helper.
- Redact provider secrets from admin settings responses, support packages, logs, audit details, and OpenAPI examples.
- Add endpoint mode and allowlist fields: bundled, host, LAN, cloud, and explicit allowed hosts/CIDRs.
- Validate endpoint URLs against SSRF rules before saving and again before the proxy calls them.

### Internal AI And Conversation APIs

The current Intelligence chat route accepts browser-supplied `walletContext`, and conversation creation stores an optional `walletId` without validating wallet access in the route/service. For a simple advisory chat this is low impact because the backend is not fetching data from that value, but it is not a safe foundation for tool execution.

Implementation notes:

- Console conversations must validate wallet access when created and when each message is processed.
- The browser should send selected wallet IDs and user text, not arbitrary wallet context.
- The backend should build all context from trusted repositories and shared tools.
- Existing `AIMessage.metadata` can hold small typed metadata, but production tool traces need a documented schema and retention/sensitivity policy. If traces become large or queryable, add a dedicated `AIConsoleToolTrace` table.
- Do not reuse conversation history blindly as tool context. Bound message count, token budget, and sensitivity level per turn.

### Audit, Logs, Metrics, And Support Packages

Audit logging and support package collection already exist, and MCP has request counters. Console/tool execution needs its own audit and observability vocabulary.

Implementation notes:

- Add audit actions for console conversation creation, console tool call, console tool denial, provider request failure, MCP key rotation, and post-restore credential review.
- Audit details should include tool name, wallet IDs or pseudonyms, sensitivity, duration, result counts, denial reason, and key/profile ID where applicable.
- Do not audit full prompts, model completions, raw tool results, provider secrets, bearer tokens, txids, addresses, or memos by default.
- Add metrics for console turns, tool calls, denied tool calls, provider latency, provider failures, context truncation, and token estimates/counts when available.
- Extend support package collectors with counts and health only: profile counts, console message counts, error counts, model/provider presence, no prompts or responses.

### Backup And Restore

Backups currently include `mcpApiKey` and `agentApiKey` records. The audit already identified MCP key resurrection risk. Provider credentials and console traces will add similar restore concerns.

Implementation notes:

- Revoke or drop restored MCP and agent API keys unless the admin explicitly regenerates them.
- Force a post-restore review of external-access credentials: MCP profiles, agent keys, AI provider credentials, proxy secrets, webhook-like endpoints, and notification credentials.
- Include prompt text and low-sensitivity console metadata in backups by default. Do not persist or restore raw high-sensitivity tool payloads unless a future explicit opt-in mode is added.
- Add restore warnings for LAN endpoints that may point to stale or wrong machines after migration.

### Deployment, Install, And Release Packaging

LAN MCP and LAN LLM are deployment features as much as application features.

Implementation notes:

- Update `.env.example`, `start.sh`, `docker-compose.yml`, and `docker-compose.ghcr.yml` together.
- Add explicit profiles/modes for loopback-only MCP, LAN MCP, bundled Ollama, host Ollama, LAN Ollama, and authenticated provider endpoint.
- Document network requirements separately for direct MCP clients and for the AI proxy calling a LAN LLM.
- Keep default exposure conservative: MCP loopback-only, AI proxy not host-published, and no cloud/LAN egress unless configured.

### OpenAPI And Frontend API Clients

MCP profile APIs exist but need profile-level fields. Console APIs do not yet exist.

Implementation notes:

- Add OpenAPI schemas and typed frontend clients for provider settings, MCP client profiles, console conversations, console messages, tool traces, sensitivity controls, and tool-denial errors.
- Keep response schemas explicit. Do not use generic metadata objects for security-sensitive API responses.
- Add API route coverage tests when new paths are introduced.

### Frontend Intelligence UI

The Intelligence surface already has Insights, Chat, and Settings tabs. The console should extend this area rather than introducing a separate terminal product.

Implementation notes:

- Add a Console tab or a Chat/Console mode switch.
- Bind the UI to an explicit scope before tool execution: general network, selected wallet, selected wallets, object within a wallet, or admin/audit when authorized.
- Render tool traces with status, duration, row count, sensitivity, and redaction state.
- Add controls for maximum sensitivity, result limit, and admin/audit tool availability.
- Error states should distinguish AI disabled, provider unreachable, wallet access denied, tool denied, context too large, and timeout.

### Console Placement And Window Model

Decision: Sanctuary Console should have one canonical home in the Intelligence area, with contextual launch points from wallet, transaction, UTXO, address, label, policy, and draft views. It should not be implemented as a separate full assistant embedded into every wallet display.

Primary surface:

- A full Console workspace under Intelligence with conversation list, prompt history, saved prompts, transcript, tool trace/provenance panel, and scope controls.
- The existing Chat surface can be replaced by this Console mode. The first tool-capable experience should be labeled Console to avoid implying generic chat or OS shell access.
- Admin AI Settings remains configuration only: providers, credentials, retention, safety defaults, proxy health, model capabilities, and MCP client profiles.

General network scope:

- Console should support a walletless General Network scope for blockchain, node, mempool, fee, and app-status questions.
- Example prompts: "how long ago was block 840000?", "what block height are we on?", "how many confirmations would tx X have?", "what is the fee environment right now?", and "is my node caught up?"
- General network tools should use Sanctuary's configured node, Electrum backend, cached fee/price data, or stored network state. They must not perform arbitrary URL fetches selected by the model.
- Block lookup should accept a height or block hash, return block timestamp, current tip, confirmations when available, source, computed-at timestamp, and stale/unavailable warnings.
- The backend should compute deterministic age/confirmation facts before synthesis so the model does not invent block timing math.

Contextual entry points:

- Wallet detail pages get an "Ask Console" action that opens the same Console pre-scoped to that wallet.
- Transaction, UTXO, address, label, policy, draft, and insight detail views can add focused actions such as "Explain this transaction" or "Analyze these UTXOs"; those actions pass object references and selected wallet scope to the backend, not raw user-built context.
- Desktop detail pages should support a right-side Console drawer for focused questions without leaving the current workflow. The drawer uses the same backend conversation, prompt history, saved prompts, replay, and tool trace model as the full Console workspace.
- Mobile and narrow layouts should use a bottom sheet or full-screen Console route rather than a cramped side drawer.
- The drawer should include an "expand" action that opens the full Console workspace with the same conversation and scope.
- First implementation can ship deep-link navigation before the drawer if needed, but the architecture should treat the drawer as a thin presentation shell over the canonical Console state.
- Wallet pages may show recent saved prompts or recent investigations filtered to that wallet later, but they should not own separate prompt history.

Trigger model:

- Global entry: the Intelligence navigation opens the full Console workspace. This is the home for history, saved prompts, and longer investigations.
- App-shell flyout trigger: add a subtle global Console icon in the primary sidebar directly below Dashboard, not in the already-crowded sidebar footer. This opens the drawer from anywhere with no forced wallet scope.
- Sidebar quick-action row: place the AI icon in a compact row immediately under the Dashboard nav item. Reserve that row for future app-wide quick actions so new global tools do not keep expanding the footer or competing with primary navigation labels.
- General network trigger: Dashboard, node-status, block-height, mempool, and fee widgets can expose "Ask Console" for chain/network questions without requiring wallet selection.
- Primary contextual trigger: page headers and toolbars use a subtle Console icon button from the existing Lucide set, with tooltip text "Ask Console". On wide layouts, selected high-value headers can show icon plus text, but dense wallet views should default to icon-only.
- Object-level trigger: transaction rows, UTXO rows, address rows, draft rows, label chips, policy rows, and insight cards expose focused Console actions from their existing action menu or row toolbar.
- Selection trigger: when a user selects multiple rows, the bulk-action toolbar can include "Ask Console" for prompts such as analyzing selected UTXOs or explaining selected transactions.
- Suggested prompt trigger: insight/detail cards can show one or two focused prompt chips that open the drawer with starter text, for example "Explain risk" or "Summarize impact".
- Drawer trigger should be explicit. Prefer the below-Dashboard quick-action icon plus contextual icons over a floating bottom-right chat bubble for the first release; a fixed bubble obscures dense wallet workflows and is harder to reconcile with scoped investigations.
- The trigger passes a structured scope payload: scope kind, wallet IDs when applicable, object type, object IDs, starter prompt ID/text, and desired presentation mode. It never passes provider secrets, bearer tokens, raw tool results, or browser-built wallet context.

Non-contextual engagements:

- Not every useful prompt starts from a wallet or visible object. The global flyout trigger should support open-ended questions from anywhere in the app.
- Default global trigger scope should be General Network or "No scope selected" with a visible scope selector in the drawer header.
- The current route can provide a weak hint, such as "currently viewing Wallet A", but it must not silently bind the conversation to that wallet unless the user opens a contextual trigger or confirms the scope.
- If the model needs wallet data for an unscoped question, the backend should ask the user to choose a wallet/scope rather than guessing.
- If the question only needs public or network data, such as block age, fee state, or node sync status, the conversation should proceed without wallet selection.

Subtle icon trigger design:

- Create one reusable trigger component, for example `ConsoleTriggerButton`, that opens the drawer on desktop and the bottom sheet/full Console route on mobile.
- Use an icon already consistent with the app's AI language, such as `Brain`, `MessageSquare`, or `Sparkles` from Lucide. Pick one primary icon and use it everywhere so users learn the affordance.
- Default size should be compact, around existing toolbar icon-button dimensions, with a quiet neutral color and a stronger hover/focus state.
- In the primary sidebar quick-action row, the AI icon should be visible but visually secondary to Dashboard and Wallets. It should read as a utility launcher, not another full navigation item.
- The quick-action row should support multiple future icons with stable spacing, tooltips, keyboard focus, active/open state, and overflow behavior if too many actions are added.
- Always include an accessible name and tooltip, such as "Ask Console about this wallet" or "Ask Console about this transaction".
- Show the trigger in stable, predictable locations: page header actions, card headers, row action menus, and selected-row toolbars. Do not show it only on hover where discoverability or keyboard access would suffer.
- For rows and dense tables, prefer an action-menu item if another always-visible icon would crowd the table.
- If AI is disabled or unavailable, keep the trigger visible when useful but show a disabled or setup-needed state that routes admins to AI Settings and explains the requirement to non-admins.

Flyout presentation decision:

- Keep the right-side flyout as the default desktop presentation. The global trigger can live under Dashboard on the left while the assistant opens from the right, preserving the left navigation and keeping the current workspace visible.
- Add an optional pinned right rail after the base drawer works. Pinning should resize the main content area instead of covering it, useful for long investigations while moving around the app.
- Keep the full Console workspace as the "expand" destination for history search, saved prompts, long traces, multi-wallet investigations, and admin-heavy workflows.
- Use mobile bottom sheet or full-screen route on narrow layouts. A right drawer is not appropriate on small screens.
- Avoid a left flyout because it competes with the sidebar and the new quick-action row.
- Avoid a centered modal for normal Console work because it blocks the screen the user is asking about.
- Avoid a floating always-on chat bubble for the first release because it obscures dense financial tables and weakens scope clarity.
- A command palette can be a future launcher for prompts and shortcuts, but it should not replace the transcript/provenance drawer.

### Keyboard Shortcut Strategy

Add keyboard shortcuts as a first-class interaction layer for the Console and adjacent new workflows. Do not add scattered document-level `keydown` handlers as each feature appears; build a central shortcut registry so conflicts, discoverability, focus behavior, and user preferences are controlled in one place.

Architecture direction:

- Add an app-level shortcut provider/registry with shortcut definitions: stable ID, feature flag, label, default key chord, platform-specific display label, scope, enabled predicate, handler, and conflict metadata.
- Route all new global shortcuts through the registry. Existing local shortcuts such as Escape-to-close and Enter-to-send can remain local initially, but should be represented in the help overlay for discoverability.
- Do not fire global shortcuts while focus is in `input`, `textarea`, `select`, contenteditable regions, code blocks, or screen-reader-only controls unless the focused component explicitly opts in.
- Support Mac/Windows/Linux display labels and avoid browser/OS-reserved chords where practical.
- Store user-level shortcut preferences later, but design the registry now so shortcuts can be disabled or remapped without rewriting feature code.
- Add a shortcuts help overlay reachable from the UI and a keyboard shortcut. It should list only shortcuts currently enabled for the user's role, feature flags, and current context.
- Show shortcuts in tooltips and action-menu labels, for example "Ask Console (shortcut)" once a default is finalized.
- Treat shortcuts as UI triggers only. They do not bypass authentication, authorization, scope selection, confirmations, or audit behavior.

Console shortcut candidates:

- Open/toggle global Console flyout from app shell with a configurable chord. Choose the final default after browser/OS conflict testing; reserve common command-palette chords such as `Cmd/Ctrl+K` unless we intentionally build a command palette.
- Open full Console workspace from the drawer.
- Focus Console prompt input when the drawer/workspace is open.
- Close Console drawer with Escape and restore focus to the trigger that opened it.
- Send prompt with Enter and insert a newline with Shift+Enter, preserving the existing Intelligence chat behavior.
- Open scope selector from the Console header.
- Toggle tool trace/provenance details while the Console has focus.
- Save/unsave a prompt and replay a prompt from the prompt-history list with list-scoped shortcuts only, not global shortcuts.
- Delete prompt history only from a focused history row and always require confirmation or undo.

Contextual shortcut behavior:

- The global Console shortcut opens an unscoped or General Network drawer, not a silently wallet-bound drawer.
- Contextual shortcuts can exist only when the context is explicit, such as a focused wallet header action, selected transaction rows, or an open action menu.
- If a contextual shortcut would broaden scope or use wallet data, require visible scope confirmation before tool execution.
- Shortcut-triggered Console opens should use the same structured scope payload as icon-triggered opens.

Accessibility and focus requirements:

- All icon-triggered Console actions must be reachable by keyboard without relying on a global shortcut.
- Opening the drawer moves focus to the prompt input or the first required setup/scope control.
- Closing the drawer returns focus to the icon/menu item/shortcut origin when possible.
- Drawer tab order should be predictable: header controls, scope/sensitivity controls, transcript, trace/provenance controls, composer.
- The shortcut help overlay must itself support Escape close, focus trap/restore, and screen-reader labels.

Drawer behavior:

- Header shows scope kind, wallet/object when applicable, sensitivity, provider status, read-only state, and close/expand actions.
- Body shows the transcript plus compact tool trace/provenance summaries.
- A secondary details panel is available in the full Console workspace for long traces, history search, and saved prompt management; do not overload the drawer with every management control.
- Closing the drawer preserves the conversation unless the user deletes it or retention expires it.
- Opening a drawer from a new wallet/object should ask whether to start a new scoped conversation or switch the current conversation scope when that switch would broaden access.
- Drawer surfaces should use the shared flyout opacity preference from Theme Settings, not hardcoded glass or solid styling.

State and history rules:

- Conversation scope is explicit and visible: general network, all wallets, one wallet, selected wallets, a single object within a wallet, or admin/audit when authorized.
- Prompt history is global to the Console but filterable by wallet, object type, saved state, and expiration.
- Replaying from a contextual entry point creates a new Console turn with current permissions and current data.
- If wallet access changes, old prompt text can remain visible according to retention settings, but replay and tool execution must recheck access and fail clearly when scope is no longer allowed.
- Deep links should preserve scope and prompt starter text, not provider secrets, bearer tokens, or raw tool payloads.

### Flyout Opacity Theme Setting

Add a user-level Theme Settings control for flyout opacity so panels can range from translucent glass to fully solid while matching the active theme and light/dark mode.

Implementation direction:

- Extend the existing Theme appearance/visual settings surface, which already owns background contrast and pattern opacity.
- Add a `flyoutSurfaceOpacity` user preference with a bounded numeric value. Use `100` for solid, and lower values for glass/translucent surfaces.
- Default to a conservative mostly-solid value so readability stays strong for existing users.
- Apply the preference through shared CSS variables or a shared `surface-flyout` utility rather than per-component inline opacity.
- Derive flyout background tint, border color, shadow, and blur from the current theme palette and light/dark mode. Do not use one fixed white/black translucent panel for every theme.
- Add theme tokens such as `--surface-flyout-rgb`, `--surface-flyout-opacity`, `--surface-flyout-border`, `--surface-flyout-shadow`, and `--surface-flyout-blur`.
- Let each theme provide light and dark flyout surface values. If a theme does not define them, fall back to the existing elevated surface colors with the selected opacity.
- Scope the setting to flyouts, drawers, popovers, notification panels, and contextual side panels. Modal backdrops and destructive-confirmation modals can stay separate unless later intentionally moved onto the same token.
- Pair translucent values with backdrop blur and border/shadow treatment. At very low opacity, keep text containers or input areas sufficiently opaque for contrast.
- Include a small live preview in Theme Settings so users can see glass versus solid behavior before saving.
- Make the Console drawer consume this token from day one. Existing `surface-glass` uses, such as notification-style panels, can migrate afterward.

Acceptance criteria:

- Theme Settings exposes a slider or segmented control with labels such as Glass, Balanced, and Solid.
- User preference persistence, defaults, and reset behavior cover `flyoutSurfaceOpacity`.
- Console drawer, contextual flyouts, and notification-style panels use the same visual token.
- Visual tests cover at least two theme palettes in both light and dark modes at glass and solid settings.
- Accessibility checks cover light/dark themes, minimum/maximum opacity, text contrast, focus rings, and disabled states.

### Existing Admin AI Section

Sanctuary already has an admin AI Assistant section (`components/AISettings`, routed as AI Assistant). Provider profile work should extend that surface instead of creating a new admin area. Rename the navigation/page label to **AI Settings** as part of this work; the section is becoming broader than an assistant toggle and will own providers, credentials, model management, proxy health, capabilities, and console configuration.

Implementation notes:

- Add provider profiles, credentials, endpoint mode, allowlist status, model capabilities, and health state as new AI Settings tabs or panels.
- Rebuild existing Status, Settings, and Models workflows as needed around typed provider profiles as the source of truth.
- Use the existing AISettings test harness and contract-test style when adding UI coverage.
- Make the default admin flow clear: enable AI, configure provider profile, test provider, select active profile, then use Intelligence/Console.
- Update route labels, page title, tests, and docs from "AI Assistant" to "AI Settings" where the UI is describing configuration. Keep user-facing feature names like "AI Assistant" or "Sanctuary Console" only where referring to the actual assistant experience.

Suggested AI Settings layout:

- Status: enabled state, active provider, proxy health, provider health, capability summary, last test.
- Providers: typed provider profiles, endpoint mode, credentials, allowlist, active profile selection.
- Models: existing bundled/host Ollama model listing, pulls, deletes, and refresh.
- Safety: sensitivity defaults, provider egress mode, retention defaults, console result limits.
- Diagnostics: recent provider failures, capability checks, support-safe summary, no prompts or responses.

Avoid burying provider credentials in a generic Settings tab. Provider identity, endpoint, credential presence, and capability state should be visible together.

## Remaining Gap Checks And Design Expansions

These items should be resolved during Milestone 0 or explicitly deferred with an owner and rationale.

### Threat Model

Write a short threat model covering the browser, backend, AI proxy, LAN LLM, direct MCP client, database, backup files, support packages, logs, and external provider endpoint. For each boundary, document what the component can read, write, mutate, log, and exfiltrate.

Acceptance questions:

- What can a compromised LAN LLM see?
- What can a compromised MCP client do with its key?
- What can a compromised AI proxy reach on the network?
- What happens if a browser session is stolen?
- What remains safe if a backup file is restored on another host?

### Data Sensitivity Matrix

Create a field-level sensitivity matrix and bind every tool output to it.

Suggested levels:

- `public`: static app metadata and non-sensitive health.
- `wallet`: balances, totals, fee summaries, generic wallet state.
- `private`: labels, memos, counterparties, transaction notes, wallet names.
- `chain-sensitive`: txids, addresses, UTXO outpoints, raw transaction hex, clusterable history.
- `admin`: audit logs, IP addresses, user agents, user/group metadata, key/profile metadata.
- `secret`: bearer tokens, provider API keys, descriptors, xpubs, PSBTs, encryption material. Never send to LLM or MCP by default.

Each tool should declare maximum emitted sensitivity and whether that sensitivity may be sent to the LLM, returned to direct MCP clients, stored in traces, or included in support packages.

### Model Capability Detection

Local models vary widely. Add provider/model capability detection and cache it with the provider profile.

Capabilities to detect or configure:

- native OpenAI-compatible tool calls
- reliable strict JSON mode
- context window
- streaming support
- max output tokens
- request timeout tolerance
- model management support
- authentication method
- provider family: bundled Ollama, host Ollama, LAN Ollama, OpenAI-compatible remote, other

The backend orchestrator should choose native tool calls when available and strict JSON planning fallback otherwise.

### Prompt-Injection Test Corpus

Build a hostile-data test corpus from labels, memos, counterparties, wallet names, audit details, and support metadata. Examples should include data that says to ignore instructions, reveal secrets, call forbidden tools, alter wallet state, or exfiltrate tokens.

Acceptance criteria:

- Hostile data is always serialized as tool result data, never system/developer instructions.
- The model may quote or summarize the hostile value as data, but cannot use it to gain tools, scope, or secrets.
- Tests cover direct synthesis, tool planning, multi-turn memory, and trace rendering.

### Answer Provenance

Every console answer should expose its provenance.

Minimum UI/API fields:

- tools used
- scoped wallets
- time range
- row/result truncation state
- sensitivity level
- redaction state
- deterministic facts used for balances, totals, counts, and fee calculations

The user should be able to distinguish model narrative from Sanctuary-computed facts.

### Retention And Deletion Policy

Define retention for:

- user prompts
- assistant responses
- tool-call traces
- sanitized tool results
- high-sensitivity results
- model errors
- audit events
- provider health and capability history

Default stance: store conversation text and compact traces; avoid storing raw high-sensitivity tool payloads unless explicitly enabled. Add user/admin deletion controls for conversation history and admin controls for retention windows.

### Prompt History, Replay, And Saved Prompts

Prompt history should be a first-class console feature, not an accidental byproduct of message storage.

Concepts:

- Conversation history: chronological user/assistant turns and compact tool traces.
- Prompt history: user-authored prompts, normalized enough for search and reuse.
- Saved prompts: user-pinned prompts or admin-curated prompt templates.
- Replay: run a previous prompt again against current data, current permissions, current provider profile, and current tool registry.

Default behavior:

- Store prompt history for console conversations unless disabled by the user or admin policy.
- Do not store raw high-sensitivity tool result payloads as part of prompt history.
- Replays must re-run tools. Do not replay old tool results as if they are current.
- Clearly label replayed answers with the new execution timestamp and any changed tool/provider versions.

Prompt history fields:

- user ID
- conversation ID
- optional wallet scope
- original prompt
- normalized/search text
- sensitivity requested
- tools planned/executed
- provider profile ID used
- model used
- created timestamp
- expires timestamp
- saved/pinned flag
- optional user title/tags
- replay count and last replay timestamp

User controls:

- search prompt history
- re-run prompt
- save/unsave prompt
- copy prompt
- delete one prompt
- delete a conversation
- delete all console history
- set per-conversation expiration when starting a conversation

Admin controls:

- default prompt-history retention window
- maximum retention window
- option to disable prompt history
- option to disable saving high-sensitivity prompts
- purge expired prompt history job

Privacy rules:

- Deleting a prompt should remove the prompt-history entry and either delete or detach associated non-audit traces according to the retention policy.
- Audit events remain according to audit retention, but should not contain prompt text.
- Saved prompts should store user-authored text only, not model responses or raw tool payloads.
- If a prompt references a wallet the user later loses access to, it can remain visible as text but replay must fail or require a new wallet scope the user can access.
- Support packages must include counts and retention settings only, not prompt text.

### Permission Changes During Conversations

Wallet permissions can change while a conversation is open. Every tool call must re-resolve current wallet role and scope.

Acceptance criteria:

- Revoked wallet access blocks subsequent tool calls in existing conversations.
- Reduced wallet role changes available tools immediately.
- Revoked MCP keys fail on the next direct MCP request.
- Console sessions do not cache elevated permissions beyond a single validated turn.

### Provider Egress And SSRF Rules

The AI proxy should not become a general network pivot.

Block by default:

- cloud metadata IPs
- loopback targets other than explicitly allowed host/bundled modes
- Docker socket proxy
- Postgres, Redis, backend, gateway, MCP, and internal service hostnames
- link-local and multicast ranges
- file and non-HTTP schemes

Allow LAN/cloud targets only through explicit provider profile allowlists. Revalidate resolved IPs at call time to limit DNS rebinding.

### Cost And Resource Controls

Set hard limits for:

- tool calls per turn
- tool recursion depth
- rows per tool
- bytes per tool result
- total context bytes sent to LLM
- total turn duration
- provider request timeout
- concurrent console turns per user
- direct MCP requests per key

Expose truncation in provenance. Fail closed when limits are exceeded.

### Future Write-Path Pattern

Even though first release is read-only, define the future write pattern now so first-release abstractions do not paint us into a corner.

Future write actions should be:

- prepare-only by default
- explicit preview diff
- user-confirmed in the Sanctuary UI
- role-gated
- audited
- idempotency-keyed
- never directly executed from model output
- separated from read tools in names, scopes, and UI affordances

Examples: prepare label edits, prepare draft transaction, prepare policy change, open a prefilled screen. Signing and broadcasting should remain outside model execution.

### Preview Vs Supported Labels

Clarify product status in docs and UI:

- Sanctuary Console: primary supported path for most users once implemented.
- Direct loopback MCP: supported local/power-user path once hardened.
- Direct LAN MCP: advanced path requiring explicit encrypted transport guidance.
- Write tools: not supported in first release.

### Recovery And Rotation Workflow

Add an external-access credential review flow after restore, migration, or hostname/network change.

Review:

- MCP keys
- agent API keys
- AI provider credentials
- AI proxy service secret
- LAN provider endpoints
- webhooks/notification credentials
- reverse-proxy or mTLS credentials

Default should be fail-closed until the admin confirms or regenerates external credentials.

### Typed Provider Profiles

Decision: use a typed AI provider profile model. Do not keep provider credentials, allowlists, capabilities, health state, or rotation metadata as loose generic `system_settings` values. Generic settings can still hold the active provider ID and feature toggles.

Rationale:

- Provider credentials need encryption, redaction, rotation, and restore behavior.
- Endpoint allowlists and SSRF policy need typed validation.
- Model capabilities need cached structured fields.
- Health state and last-tested metadata should not be mixed with free-form admin settings.
- Multiple providers or fallback profiles become straightforward later.

Candidate model fields:

- name
- provider type
- endpoint URL
- endpoint mode
- encrypted credential reference/value
- allowed CIDRs/hosts
- model
- capability flags
- default generation limits
- health status
- last tested timestamp
- created/updated/revoked metadata
- created by admin user ID
- last rotated timestamp

Related API behavior:

- Create/update responses return profile metadata and credential presence only, never credential material.
- Setting or rotating a credential returns no secret value.
- Support packages report counts, provider type, endpoint mode, health, and capability flags only.
- Backup restore marks restored provider profiles as requiring admin review before use.
- The existing admin AI Assistant UI becomes the management surface for these profiles.

## Greenfield AI Transition Strategy

The implementation should treat the AI surface as greenfield. Existing AI routes, endpoint/model settings, and prompt-specific proxy behavior can be removed or replaced instead of wrapped for compatibility. Keep the existing admin AI Settings surface as the configuration home, but do not preserve legacy AI behavior as a product requirement.

Transition steps:

1. Add typed provider profile tables and APIs.
2. Make typed provider profiles the only source of truth for provider endpoint, model, credentials, capability state, health, and egress mode.
3. Keep `aiEnabled` as a feature toggle and store `activeAiProviderProfileId` as the pointer to the selected profile.
4. Replace prompt-specific AI proxy routes with normalized planning/synthesis/generation endpoints.
5. Remove browser-JWT-to-proxy data fetching from AI flows. Backend-owned services derive context, execute tools, and send sanitized facts to the proxy.
6. Replace or remove existing AI label/query/insight/chat routes as needed. New APIs should be explicit, typed, and backed by provider profiles.
7. Add support package and backup behavior for the new provider profile model only.

Greenfield requirements:

- Bundled Ollama, host Ollama, LAN Ollama, and OpenAI-compatible remote providers are configured through typed provider profiles.
- Old generic `aiEndpoint`/`aiModel` writes are removed from the admin UI/API rather than migrated as compatibility state.
- Existing tests for legacy label suggestion, query, insights, and chat are intentionally replaced or removed as the new Console/provider-profile tests land.
- Provider credentials are never exposed in settings responses, logs, support packages, backups, or OpenAPI examples.

## Feature Flags And Rollout

Use feature flags to keep release risk manageable:

- `aiProviderProfiles`: typed provider profiles and AI Settings rename.
- `sanctuaryConsole`: in-app console UI/backend.
- `consoleToolUse`: model-planned backend tool execution.
- `consoleHighSensitivity`: permission to send high-sensitivity facts to the model.
- `mcpLanMode`: explicit LAN MCP configuration warnings and advanced docs.

Default first-release posture:

- Provider profiles on for admins once the greenfield AI Settings/provider APIs are implemented.
- Sanctuary Console off until backend and UI gates pass.
- High-sensitivity model sends off.
- Direct LAN MCP treated as advanced, not enabled by default.

## Milestone 0: Cross-App Boundary Prep

Purpose: clear the app-level design blockers before implementation spreads across MCP, AI, API, and UI.

Tasks:

- Define shared authorization vocabulary for tool metadata: wallet role, admin, audit, agent-read, high-sensitivity.
- Define typed AI provider profile schema, secret redaction rules, credential rotation behavior, and endpoint allowlist/SSRF validation rules.
- Define console conversation, prompt history, saved prompt, expiration, deletion, replay, and tool trace persistence strategy.
- Define audit actions, metrics names, and support package fields for console/MCP/AI provider operations.
- Define backup/restore behavior for MCP keys, agent keys, AI provider credentials, console history, and tool traces.
- Define OpenAPI and frontend API shapes for console turns, tool traces, provider settings, and MCP client profiles.
- Complete or explicitly defer the threat model, sensitivity matrix, model capability detection, prompt-injection corpus, answer provenance, prompt-history/replay design, retention policy, permission-change behavior, provider egress rules, resource controls, future write-path pattern, product-status labels, and recovery/rotation workflow.
- Define how the existing AI Assistant admin section becomes the greenfield AI Settings surface for typed provider profiles, credentials, capabilities, health, and safety defaults.
- Include the admin navigation/page rename from AI Assistant to AI Settings in the UI transition notes.

Acceptance criteria:

- Written design updates cover all surfaces above.
- Typed AI provider profile model is specified, including encrypted credential fields, active-profile selection, redacted API responses, restore behavior, and support-package shape.
- Security review confirms no browser-supplied wallet context, no browser JWT to AI proxy, no provider secrets in responses, and no restored reusable external credentials.
- Security review signs off on the threat model, data sensitivity matrix, provider egress rules, and prompt-injection test corpus.
- Implementation PRs can be split without re-deciding core data model or auth semantics.

## Milestone 1: Direct MCP Release Hardening

Purpose: make the existing MCP server safe and understandable as a loopback or explicitly configured LAN service.

Tasks:

- Fix stale MCP server metadata so it uses the package/server version instead of hardcoded `0.8.34`.
- Change protocol-version handling to tolerate clients that omit `MCP-Protocol-Version` on initial compatible requests, while still rejecting unsupported explicit versions.
- Add standards-aligned `401` behavior where practical, including `WWW-Authenticate: Bearer`, without claiming full OAuth support yet.
- Add a `.well-known` or docs note only if it truthfully reflects the auth implementation. Do not fake OAuth protected-resource support.
- Require explicit LAN configuration in docs: `MCP_BIND_ADDRESS`, `MCP_ALLOWED_HOSTS`, firewall expectations, and client URL examples.
- Add MCP environment variables to `.env.example`.
- Add MCP support to `docker-compose.ghcr.yml` or explicitly document that prebuilt-image deployments do not support MCP until that file is updated.
- Protect or limit `/metrics` when MCP is LAN-bound. Keep `/health` minimal and non-sensitive.
- Add optional allowed IP/CIDR checks for MCP keys.
- Default newly created LAN-oriented keys to expiry plus wallet scope.
- Fix backup restore so restored MCP keys are revoked, deleted, or forced through regeneration.
- Update `docs/how-to/mcp-server.md` with direct LAN, loopback-only, reverse proxy, VPN, and token storage guidance.

Acceptance criteria:

- Existing MCP unit tests pass.
- Backup restore tests prove old MCP bearer tokens cannot be reused after restore.
- Transport tests prove valid bearer auth, missing/invalid auth, revoked key, expired key, wallet scope, audit-log scope, rate limit, allowed-host behavior, and optional IP binding.
- Compose/config tests or smoke docs prove loopback and explicit LAN modes.
- Docs include at least one working MCP Inspector or SDK client example.

## Milestone 2: Shared Read-Tool Registry

Purpose: stop duplicating logic between MCP and future console tooling.

Tasks:

- Extract current MCP tool logic into shared read-tool executors.
- Keep MCP resources for URI-oriented reads, but have MCP tools call the shared registry.
- Add precise output schemas for existing tools.
- Add a common execution context that supports:
  - MCP API key user context
  - browser-authenticated console user context
  - wallet role and wallet-scope checks
  - admin/audit checks
  - agent-read checks
  - sensitivity limit checks
  - audit logging
- Add common result budgeting for row count, byte size, and date range.
- Add common redaction utilities for txids, addresses, labels, memos, audit details, and future high-sensitivity fields.
- Add typed tool-call traces: tool name, validated args, duration, row count, result size, sensitivity, redaction state, and error class.

Acceptance criteria:

- MCP behavior remains backward compatible for existing tools.
- Existing MCP tests pass without weakening auth or scope behavior.
- New registry unit tests cover null inputs, invalid UUIDs, empty result sets, boundary limits, unauthorized wallets, admin-only reads, and budget truncation.
- Lizard/touched-file complexity stays within project thresholds.

## Milestone 3: Read-Parity Expansion

Purpose: move from "core wallet reads" to "most GUI read features".

Add tools/resources in this order:

1. Dashboard and portfolio summaries.
2. Wallet detail summary: devices, share/access summary, privacy summary, address summary, transaction stats, explorer links, and logs.
3. Transaction reads: pending transactions, transaction stats, structured export-equivalent read, and optional raw transaction hex under high-sensitivity scope.
4. UTXO reads: privacy scoring, wallet privacy summary, and read-only coin-selection simulation.
5. Address reads: address summary, address lookup/detail, label state. No address generation.
6. Label reads: label detail and linked transaction/address references. No mutation.
7. Policy reads: policy detail, events, addresses, and dry-run evaluation. Admin/global policy reads require admin.
8. Draft reads: output counts, fee rate, warning summary, approval summary, and lifecycle status. No PSBTs by default.
9. Chain/network reads: current tip, block lookup by height/hash, block age, confirmation count, node/electrum sync state, mempool summary, and chain health from configured or cached sources. No arbitrary external fetches.
10. Fee/price reads: advanced fees, configured providers/currencies, provider health, cache stats, and stored history without external fetch side effects.
11. Insight reads: status, settings, filters, counts, and insight details. No insight mutation.
12. Admin/ops reads: audit stats, MCP key metadata, feature flags, monitoring/cache/DLQ, node/electrum state, all behind explicit admin scopes.

Acceptance criteria:

- Tool coverage matrix maps GUI read views to registry tools or explains intentional exclusions.
- Every tool has unit tests for access, empty data, limit handling, and redaction.
- MCP list/read/call integration tests cover representative tools from each domain.
- Console can use the same tool metadata without transport-specific branching.

## Milestone 4: Sanctuary Console Backend

Purpose: add an in-app assistant backend that can plan, execute read tools, and return auditable answers.

Flow:

```text
Browser
  -> Sanctuary API conversation endpoint
  -> Console orchestrator
  -> AI proxy asks LAN LLM for answer or tool-call plan
  -> Backend validates requested tool calls
  -> Shared read-tool registry executes allowed calls
  -> AI proxy asks LAN LLM to synthesize from sanitized tool results
  -> Backend stores answer plus tool trace
  -> Browser renders answer and trace
```

Tasks:

- Add a console orchestrator service under `server/src/services/intelligence` or a new `server/src/services/assistant` module.
- Preserve the existing rule that the main backend does not call external AI directly. External model calls still go through `ai-proxy`.
- Add generic AI proxy endpoints for planning and synthesis. They should support OpenAI-compatible tool calls when the model supports them and a strict JSON planning fallback when it does not.
- Add service authentication from backend to AI proxy for all console-generation calls.
- Remove browser-supplied `walletContext` from console turns. Derive all wallet and network context server-side after scope and access checks.
- Validate the conversation scope on creation and on every message. Wallet/object scopes require wallet access; general network scope requires only an authenticated user unless an admin-only network tool is requested.
- Add server-side validation for model-requested tool calls:
  - tool exists
  - input validates
  - requested wallet/object/network resource is in conversation scope
  - sensitivity is allowed
  - row/date/result budgets are inside limits
  - user has required role/scope
- Treat model output as untrusted. Never execute raw SQL, shell commands, URL fetches, or arbitrary code.
- Store tool traces in a new table or structured message metadata. Do not store full high-sensitivity payloads by default.
- Add deterministic answer helpers for balances, totals, fees, counts, block age, confirmation count, and sync state so the model summarizes computed facts instead of inventing calculations.
- Add rate limits for console turns and tool calls per turn.
- Add cancellation/timeouts for multi-step console turns.
- Model each console turn as an explicit state machine: accepted, planning, validating, executing tools, synthesizing, completed, failed, canceled.
- Persist the tool result envelope metadata needed for provenance without persisting raw high-sensitivity payloads by default.
- Persist prompt history separately from model responses so prompts can be searched, saved, replayed, expired, and deleted without treating old tool results as current.
- Replays must create a new console turn and re-run tool authorization and tool execution against current data.

Acceptance criteria:

- Fake-LLM tests prove tool-call planning, tool execution, synthesis, invalid tool rejection, unauthorized wallet rejection, and timeout behavior.
- Tests prove MCP tokens and browser JWTs are never sent to the LLM payload.
- Tests prove browser JWTs are not sent to AI proxy console endpoints.
- Tests prove provider API keys are stored encrypted and never returned to the browser or support packages.
- Prompt-injection tests prove labels/memos/counterparties are included only as data, not system instructions.
- Audit logs record console turns and tool calls with enough metadata for investigation.

## Milestone 5: Sanctuary Console UI

Purpose: make the feature usable without presenting it as an OS terminal.

Tasks:

- Extend the existing Intelligence area with one canonical Console workspace rather than embedding separate assistants into each wallet page.
- Add contextual "Ask Console" launch actions from wallet, transaction, UTXO, address, label, policy, draft, dashboard, node-status, block-height, mempool, fee, and insight views where useful.
- Add a reusable subtle Console icon trigger component with tooltip/accessibility support, plus variants for app chrome, header/toolbars, row/action menus, selected-row bulk actions, and suggested prompt chips.
- Add a central keyboard shortcut registry/provider before adding new global Console shortcuts.
- Add a shortcuts help overlay and tooltip/action-menu shortcut labels for enabled Console actions.
- Add a reusable Console drawer presentation for desktop contextual use, backed by the same conversation state and APIs as the full Console workspace.
- Add an optional pinned right-rail mode after drawer behavior is stable, with the same conversation state and scope rules.
- Add mobile behavior for contextual Console launches: bottom sheet for short turns or full-screen route when traces/history controls are needed.
- Consume the shared Theme Settings flyout opacity token for the Console drawer and avoid hardcoded glass or solid surface classes.
- Support deep links into Console with selected wallet/object scope and optional starter prompt.
- Add a console mode with command-style input and natural-language input.
- Bind each conversation to an explicit scope: general network, selected wallet, selected wallets, selected object, or admin/audit when authorized.
- Add starter prompts for common safe investigations: "summarize this wallet", "show recent large sends", "explain UTXO health", "estimate consolidation opportunity", "summarize fee timing".
- Show a persistent read-only badge and avoid shell-terminal styling that implies OS command execution.
- Add prompt history UI with search, save/unsave, copy, re-run, delete, and expiration indicators.
- Add saved prompt affordances for reusable prompts, separate from conversation history.
- Add visible controls for:
  - selected wallet scope
  - general network scope
  - maximum sensitivity level
  - result limit
  - whether audit/admin tools are available
  - optional conversation/prompt expiration
- Render tool traces inline or in a side panel: tool, status, duration, rows, sensitivity, and redaction.
- Render answer provenance separately from model prose: computed facts, source tools, filters, and truncation.
- Add copyable answers and saved investigations if useful, but avoid storing raw high-sensitivity payloads by default.
- Add clear empty/error states for disabled AI, unreachable LAN LLM, missing required scope, expired auth, unavailable node/network data, and tool denial.

Acceptance criteria:

- Playwright or component tests cover conversation creation, wallet selection, sending a prompt, rendering tool traces, denied tool calls, and AI unavailable states.
- Tests cover each trigger type passing structured scope to the same Console open handler without leaking raw context.
- Tests cover the global app-shell trigger opening an unscoped/general-scope drawer and requiring explicit scope selection before wallet tools run.
- Tests cover the reusable trigger's tooltip, accessible name, disabled/setup-needed state, keyboard activation, and desktop/mobile presentation mode selection.
- Tests cover shortcut registration, conflict detection, editable-element exclusion, shortcut help rendering, focus restore, Escape close, and Console shortcut scope behavior.
- Tests cover contextual launch from wallet/transaction-style pages into the same Console history and scope model.
- Tests cover general network questions without selected wallet scope, including block lookup/age and unavailable node data.
- Tests cover glass and solid flyout opacity settings for the Console drawer in light and dark mode.
- Tests cover starter prompts, sensitivity controls, read-only labeling, provenance rendering, truncation messaging, prompt replay, save/unsave, delete, and expiration indicators.
- Text fits in mobile and desktop console layouts.
- The UI never implies shell access.

## Milestone 6: Admin And Operations UI

Purpose: make external MCP access understandable and revocable.

Tasks:

- Add an MCP client profiles screen under admin/settings.
- Rename the existing admin AI Assistant section to AI Settings and extend it with provider profile management for endpoint mode, provider type, model, encrypted credential presence, capability flags, and endpoint allowlist state.
- Support create/list/revoke/rotate for MCP keys.
- Show key prefix, owner, wallet scope, sensitivity scopes, expiry, allowed CIDRs, last-used IP/user-agent, and last-used timestamp.
- Warn when creating a LAN key without expiry, wallet scope, or encrypted transport guidance.
- Add a profile creation wizard with copy-once token display, generated client config snippets, and a connection test.
- Add a restore/migration review banner when external credentials are disabled pending admin confirmation.
- Add support-package collection for MCP profile metadata without secrets.
- Add backup-restore warning and post-restore credential review prompt.
- Add admin controls for default prompt-history retention, maximum retention, and disabling prompt history.

Acceptance criteria:

- Admin API and UI tests cover scoped creation, expiry, CIDR validation, revocation, rotation, and no token leakage after creation.
- UI tests cover generated config snippets, copy-once token behavior, connection test states, and restore-review banners.
- Tests cover prompt-history retention settings and expired-history purge behavior.
- Support package tests prove no full bearer tokens are collected.

## Milestone 7: Integration Proof And Release Docs

Purpose: prove both paths work end to end.

Tasks:

- Add an MCP SDK integration test that starts the MCP app with a seeded DB-backed key and calls list/read/call flows.
- Add a Docker Compose smoke for `./start.sh --with-mcp` in loopback mode.
- Add a documented LAN smoke path that can be run manually or in a controlled CI network.
- Add a fake LAN LLM integration test for the Sanctuary Console through `ai-proxy`.
- Add docs:
  - direct MCP loopback
  - direct MCP LAN with TLS/VPN/reverse proxy warning
  - MCP key creation and rotation
  - MCP Inspector/local client config
  - admin AI Settings provider profile setup
  - Sanctuary Console setup with remote Ollama/OpenAI-compatible endpoint
  - privacy and sensitivity model
  - restore/migration credential review

Acceptance criteria:

- Release checklist has explicit gates for direct MCP and Sanctuary Console.
- Docs and tests make clear which path is supported, which path is preview, and which features are intentionally excluded.

## Proposed PR Sequence

1. Cross-app boundary prep: auth vocabulary, typed provider profile schema, trace persistence, audit/metrics/support fields, backup/restore decisions, API shapes, UX cutline.
2. MCP hardening and docs: restore-key revocation, version/header behavior, LAN docs, env examples, GHCR Compose, focused tests.
3. AI Settings provider profiles: typed model, removal of generic endpoint/model settings, UI rename, redacted APIs, support/backup behavior.
4. AI proxy gateway hardening: service auth on generation routes, provider credentials, egress controls, normalized model API, typed errors, no prompt/result logging.
5. Shared read-tool registry: extract existing MCP tool executors and add schemas/budgets/result envelopes.
6. Read-parity batch 1: dashboard, wallet, transactions, UTXOs, addresses.
7. Read-parity batch 2: labels, policies, drafts, fees/prices, insights, admin reads.
8. Console backend and AI proxy protocol: fake-LLM verified orchestrator.
9. Console UI: Intelligence tab console mode with tool traces and provenance.
10. Admin MCP profiles: UI/API hardening for external credentials.
11. End-to-end proof and release docs.

This sequence keeps direct MCP safe first, then creates the shared foundation, then builds the greenfield Console on top of that foundation.

## Clarification Backlog Before Implementation

These items should be resolved during Milestone 0 or the first Console UI/backend design spike. They are not reasons to stop planning, but they are the places most likely to create rework if left implicit.

1. Scope defaults and scope switching:
   - Decision: the global Console opens in General Network scope by default.
   - General Network handles network/block/fee/app-status questions immediately, with explicit wallet selection required before wallet tools run.
   - Route context is only a hint unless the user clicked a contextual trigger.

2. First-release tool cutline:
   - Decision: v1 required set is minimal network plus wallet basics.
   - Required v1 tools: chain tip/block lookup, wallet summary, recent transactions, UTXO summary, fee state, label read, policy summary, draft summary, and insight summary.
   - Everything else should be mapped in the coverage matrix as supported, deferred, or intentionally excluded.

3. Sensitivity defaults:
   - Decision: v1 sends computed facts and aggregate counts by default.
   - Raw txids, addresses, xpub-derived metadata, labels, memos, counterparties, IPs, audit details, and user/group names require explicit high-sensitivity approval/profile capability.
   - Long-term target: trusted user-provided LLM mode can allow most GUI-readable data to be sent intentionally, with visible scope/sensitivity controls, auditability, retention controls, and clear provider trust labeling.

4. Provider/model support floor:
   - Decision: native OpenAI-compatible tool calls are preferred; strict JSON planning fallback is required for tool-capable Console support.
   - Models that cannot do native tool calls or reliable strict JSON planning can only use non-tool general chat/explanation, clearly labeled.
   - Define a short list of tested providers/models for release notes.

5. Prompt and trace retention:
   - Decision: store prompt text plus low-sensitivity metadata by default.
   - Store timestamps, scope, model/provider IDs, tool names, result counts, redaction/truncation states, and low-sensitivity trace metadata.
   - Do not store raw high-sensitivity tool payloads by default.
   - Backups include prompt text and low-sensitivity metadata by default.
   - Admins cannot read another user's prompt text by default unless a future explicit audit/export permission and user-visible policy is added.

6. Console history boundaries:
   - Decision: saved prompts are personal only in v1.
   - Saved prompts can be tagged and optionally associated with a wallet/object scope, but they are not shared with other users in v1.
   - Wallet/team shared prompt libraries can come later with explicit permissions, audit behavior, and retention rules.
   - Conversation deletion removes prompt entries, model responses, and non-audit trace metadata together, while immutable audit events remain metadata-only under audit retention.

7. Sidebar quick-action row:
   - Decision: use a compact icon-only quick-action row directly below Dashboard.
   - The row starts with the AI icon and leaves stable room for future global utility icons.
   - Icons have tooltips, keyboard focus, active/open state, disabled/setup-needed state, and overflow behavior if future actions exceed available space.
   - The row is visually secondary to full navigation rows and should not compete with Dashboard or Wallets.
   - Non-admin users see a visible disabled/setup-needed state with a plain explanation when AI is disabled; admins get a path to AI Settings.

8. Drawer sizing and pinning:
   - Decision: v1 uses a fixed-width right overlay drawer, with pinning and resizing deferred.
   - Users can expand from the drawer to the full Console workspace.
   - Pinned right rail and resizing can come later after drawer behavior, focus handling, tool traces, and theme opacity are stable.

9. Keyboard shortcut defaults:
   - Decision: ship the shortcut registry and help overlay first; enable a conservative global Console shortcut only after conflict testing.
   - Show enabled shortcuts in tooltips and action-menu labels.
   - Do not use common command-palette chords unless we intentionally build a command palette.

10. Streaming, cancellation, and partial results:
    - Decision: v1 uses whole-turn responses with visible progress and cancel.
    - Show turn states such as planning, validating, executing tools, synthesizing, completed, failed, and canceled.
    - Add token streaming only after tool orchestration, auditing, and trace persistence are stable.
    - Tool execution uses per-tool timeout and turn-level cancellation.

11. Chain/network data source semantics:
    - Decision: chain/network answers use configured Sanctuary sources only.
    - Allowed sources include Sanctuary's configured Bitcoin Core, Electrum backend, cache/indexer state, and stored network state.
    - Never let the model request arbitrary external URLs.
    - Display source, freshness, current tip, computed-at timestamp, and stale/unavailable warnings.

12. Direct MCP transport stance:
    - Decision: loopback direct MCP is supported after hardening; LAN direct MCP is advanced.
    - LAN MCP remains disabled by default and requires explicit TLS/VPN/reverse-proxy warning plus scoped expiring credentials.
    - Do not present LAN MCP as the normal user path; Sanctuary Console remains the recommended path.

13. Greenfield AI transition:
    - Decision: no legacy AI compatibility requirement.
    - Existing Intelligence chat, label suggestion, query, and insight flows can be replaced or removed as the new provider-profile, model-gateway, and Console surfaces land.
    - New AI flows must be typed, backend-authorized, provider-profile backed, and model-only at the proxy boundary.

14. Audit vocabulary:
    - Decision: use metadata-only operational audit for Console/MCP/AI operations in v1.
    - Audit who used which tool, scope, sensitivity, duration, result counts, denial reason, provider status, and relevant provider-profile/MCP-key IDs.
    - Never audit full prompt text, model response text, secrets, raw txids/addresses, labels/memos, or raw high-sensitivity payloads by default.
    - Configurable fuller audit levels can be considered later only with explicit admin policy and user-visible disclosure.

## Verification Matrix

- Unit: schemas, scope checks, redaction, budgets, key expiry, CIDR checks, backup restore key revocation.
- Integration: MCP SDK client, registry execution against seeded repositories, authenticated fake AI proxy tool-call loop.
- API: admin MCP profiles, console conversations, denied tool calls, rate limits.
- UI: console mode, tool trace rendering, key profile management, error states.
- Compose: `--with-mcp` loopback smoke and documented LAN manual smoke.
- Security: no shell execution, no arbitrary SQL, no browser-supplied wallet context for console tools, no browser JWT or MCP token in LLM payloads, no browser JWT in AI proxy console calls, no provider API keys in responses or support packages, no reusable restored MCP or agent keys.
- Quality: focused tests, touched-file lizard, typecheck/build, `git diff --check`.

## Finalized Implementation Decisions

- MCP auth: use custom scoped bearer auth for v1 and document it clearly. Defer full MCP OAuth protected-resource metadata unless it can be implemented truthfully without weakening the release.
- Direct MCP high sensitivity: allow raw txids/addresses only with explicit high-sensitivity scope. Keep Console defaults stricter and do not send raw identifiers to the LLM by default.
- MCP wallet scope: require wallet scope for LAN-created MCP profiles. Admin/global read scopes are explicit advanced/admin profiles only.
- MCP metrics exposure: keep `/metrics` loopback-only or auth-gated when MCP is LAN-bound. Do not expose metrics unauthenticated on the LAN.
- Console trace storage: store summaries and metadata by default. Full low-sensitivity results can be stored only when needed for replay/debug behavior; raw high-sensitivity payloads are never persisted by default.
- Provider allowlist UX: use guided presets first: bundled, host, LAN, and cloud. Put advanced hostname/CIDR allowlists behind an expert section.

## Definition Of Done For First Release

- Direct MCP is safe by default on loopback and explicit about LAN risk.
- External MCP access requires scoped, expiring, revocable credentials.
- Backup restore cannot silently reactivate old MCP bearer tokens.
- Sanctuary Console can answer wallet/transaction/UTXO/fee questions through backend-executed read tools.
- The LLM cannot access secrets, shell, arbitrary SQL, browser JWTs, MCP tokens, provider credentials, signing operations, or write workflows.
- Tests prove the core security boundaries and at least one end-to-end flow for each path.
