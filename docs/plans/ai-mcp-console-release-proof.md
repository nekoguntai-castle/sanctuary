# AI/MCP/Console Release Proof

Date: 2026-04-26 HST / 2026-04-27 UTC
Baseline: `ede510ca Add admin AI MCP settings controls (#194)`
Status: release-documentation slice in progress; implementation slices complete.

## Release Posture

Sanctuary now has two supported AI access paths:

1. **Sanctuary Console** is the recommended user path. It runs inside the authenticated app, uses the configured AI provider through the AI proxy, and executes backend-owned read tools under the logged-in user's permissions.
2. **Direct MCP** is the advanced external-client path. It is read-only, disabled by default, loopback-bound by default, and requires scoped bearer keys. LAN use requires TLS, VPN, or a trusted reverse proxy.

The release remains intentionally read-only for AI/MCP tool execution. Spending, signing, draft creation, label edits, policy changes, shell execution, arbitrary SQL, and public internet MCP exposure are out of scope.

## Delivered Slices

| PR | Merge | Slice |
| --- | --- | --- |
| #182 | `68b558bd` | MCP/Console implementation plan and greenfield decisions |
| #183 | `d6112b2c` | Typed AI provider profile foundation |
| #184 | `89d05c7f` | MCP transport, restore, metadata, Compose, and docs hardening |
| #185 | `33436668` | Encrypted AI provider credential boundary |
| #186 | `a7060290` | AI proxy gateway auth, provider egress policy, and credential sync |
| #187 | `48daf765` | Shared assistant read-tool registry foundation |
| #188 | `77d36fed` | Read-tool parity batch 1: dashboard, wallets, transactions, UTXOs, addresses |
| #189 | `a13037b4` | Read-tool parity batch 2: labels, policies, drafts, market status, insights, admin summaries |
| #190 | `c968e16e` | Sanctuary Console backend protocol, prompt history, replay, tool traces |
| #191 | `48f18b70` | Console API rate-limit boundary follow-up |
| #192 | `31ad4976` | Console backend delivery tracking |
| #193 | `a6b7082e` | Sanctuary Console drawer UI, sidebar trigger, shortcut, prompt-history controls, flyout opacity |
| #194 | `ede510ca` | Admin AI Settings provider controls and MCP Access UI/API |

## Release Gates

The implementation slices recorded these local proof commands across the stack:

- Frontend: focused AI Settings/Console/API suites, `npm run test:coverage`, `npm run test:run`, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`.
- Backend: focused MCP/admin/Console/config/support/routes suites, `npm run test:backend:coverage`, `npm run typecheck:server:tests`, `npm run lint:server`, `npm run check:openapi-route-coverage`, `npm --prefix server run check:prisma-imports`.
- AI proxy: focused Console/protocol/gateway tests and `npm --prefix ai-proxy run build`.
- Architecture and quality: `npm run arch:graphs`, `npm run arch:calls`, `npm run arch:lint`, touched-file `lizard -C 15`, `git diff --check`, local gitleaks history/tree scans where MCP-token-shaped fixtures were touched.
- CI: each implementation PR passed protected PR checks before merge; #194 also passed post-merge `main` workflows for Release, Build Dev Images, Architecture, CodeQL, and Test Suite.

The public release gate now has an explicit AI/Console/MCP row in `docs/reference/release-gates.md`, and the operator smoke checklist is in `docs/how-to/ai-mcp-console.md`.

## Operator Evidence

Operator-facing docs now cover:

- Enabling `aiAssistant` and `sanctuaryConsole`.
- Configuring trusted provider profiles in **Administration -> AI Settings**.
- Write-only provider API-key handling and restore review.
- Opening Sanctuary Console from the sidebar brain icon or `Ctrl+Shift+.` / `Cmd+Shift+.`.
- Prompt history search, replay, save/unsave, delete, and 30-day expiration controls.
- Creating, copying, listing, and revoking MCP keys in **AI Settings -> MCP Access**.
- Starting MCP with `./start.sh --with-mcp`.
- Keeping direct MCP loopback by default and treating LAN MCP as advanced.

## Security Evidence

- Model access is mediated by the backend and AI proxy. The browser does not send JWTs, MCP tokens, or provider API keys to the model.
- Console and MCP tool execution uses the shared assistant read-tool registry with explicit scopes, sensitivities, redactions, result budgets, and provenance metadata.
- MCP API keys are scoped, revocable, optionally expiring, hash-stored, and forced revoked on restore.
- AI provider credentials are encrypted separately from provider metadata, redacted from responses, disabled on restore, and omitted from support packages.
- CodeQL-visible rate-limit guards are layered at Console and admin MCP key boundaries while retaining Sanctuary's own Redis-backed policy limiters.
- Direct MCP exposes no write tools in this release.

## Deferred Work

These are follow-up improvements, not remaining implementation slices for the current rollout:

- Full Console workspace beyond the drawer.
- More contextual "Ask Console" launch points from wallet, transaction, UTXO, address, label, policy, draft, and insight surfaces.
- Admin policy controls for default prompt-history retention and maximum retention. The current release supports per-prompt save/delete/replay/expiration.
- Provider health and model capability probing beyond manually configured profile metadata.
- Full MCP OAuth protected-resource metadata if future clients require it. The current release uses documented scoped bearer keys with standards-aligned `WWW-Authenticate` responses.
- Future write-capable AI workflows with explicit confirmation, authorization, and audit design.

Remaining planned slices after this release-docs slice: **0**.
