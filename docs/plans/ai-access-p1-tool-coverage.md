# P1 — Close the highest-value AI access gaps

**Status:** Proposed
**Date:** 2026-06-25
**Source audit:** `reports/ai-access-audit-2026-06-25.md`
**Depends on:** P0 (`ai-access-p0-price-fee-planner.md`) landed first
**Owner:** _unassigned_

## Goal

After P0 makes price/fee/network work, P1 raises the agent's usefulness by (1) surfacing the
**silent** sensitivity denials that make valid questions return nothing, and (2) adding the
highest-value missing **read** tools. Every tool here is read-only; all *actions* remain out of
scope by design.

## Cross-cutting facts (verified 2026-06-25)

- **Coverage gate is literal 100%** for backend (`server/vitest.config.ts:58-63`), not the 99%
  in CLAUDE.md. New `*ReadTools.ts` files are **not** excluded — every branch (404, denial,
  redaction) needs an explicit test. A single happy-path test will fail the gate.
- A new tool auto-registers in **both** Console and MCP the moment its family array is spread into
  `assistantReadToolDefinitions` (`registry.ts:71-88`); MCP iterates `registry.list()`
  (`mcp/tools/index.ts:78-80`). The only wiring edit is the import + spread in `registry.ts`
  (its order is asserted by `tests/unit/assistant/readToolRegistry.test.ts:107-136`).
- Registry test invariants: every tool needs truthy `budgets.maxBytes` and a non-empty
  `requiredScope.description` (`readToolRegistry.test.ts:137`).
- Tools must read via a **repository**, never Prisma directly. `execute()` returns
  `createToolEnvelope({...})` (`types.ts:124-161`); use `envelope.redactions` to declare stripped
  fields.
- **Sensitivity vs. the default ceiling (decides reachability).** A tool's `sensitivity` is
  checked against the session `maxSensitivity`, which defaults to `'wallet'`
  (`protocol.ts:128,140`; rank `public<wallet<high<admin`, `protocol.ts:223-234`). **Any tool
  marked `high` is silently denied by default** until Work Item 1 ships *and* the user elevates.
  Therefore: mark a new tool `high` **only** if it exposes raw deanonymizing data (raw addresses,
  xpubs, full PSBT/txids). For everything else, **redact the sensitive fields and mark it
  `wallet`** so it is reachable out of the box. This is why the two new tools below that touch
  sensitive material are `wallet`-after-redaction, not `high`.
- **`wallet`/`high` sensitivity also implies a wallet-scoped session.** `toolNeedsExplicitScope`
  (`toolExecution.ts:93-99,127`) denies any `wallet`- or `high`-sensitivity tool when the session
  scope is **not** wallet-scoped ("Wallet-sensitive tools require an explicit wallet scope"). The
  default auto-scope is `wallet_set` for any user with wallets, so wallet-related tools are fine —
  but a **user-scoped, non-wallet** tool (e.g. `get_user_preferences`) marked `wallet` would be
  denied in `general` scope (no wallet selected). For self-scoped reference data with no wallet,
  use **`public` sensitivity + `authenticated` scope** instead: `public` avoids the wallet-scope
  requirement, and isolation still comes from the `authenticated` scope + `execute()` reading
  `context.actor.userId`. (`public` here means "no wallet-scope ceiling," not "world-readable.")

---

## Work item 1 — Surface silent sensitivity denials (highest leverage, no new tool)

**Why:** Session `maxSensitivity` defaults to `'wallet'` (`protocol.ts:128,140`; frontend hardcodes
it at `src/api/console.ts:255` and the drawer never overrides it). That **silently denies all 7
`high` tools** (raw addresses, tx detail, label detail, policy detail/events, draft detail) and the
admin tool. The denial reason exists end-to-end but is buried: `traceForSynthesis` drops
`errorCode` (`toolExecution.ts:145-160`), no turn-level `warnings` entry is added, the UI tooltip
shows a hardcoded "Denied by scope or sensitivity" (`consoleDrawerUtils.ts:176-186`), and the real
reason only appears in a collapsed `<details>` block. So "show my addresses" / "why was my send
blocked" / "show me that draft's details" return nothing with no clear explanation.

**Changes (minimal):**

Backend:
- Split `validateToolCall` denials into a structured `{ errorCode, errorMessage }` result instead
  of one generic string. Use a dedicated code such as `sensitivity_ceiling_exceeded` for
  `Tool sensitivity ${definition.sensitivity} exceeds turn limit ${maxSensitivity}`; keep separate
  codes for admin, explicit-wallet-scope, and wallet-input-scope denials. Do not make the warning
  path parse human-readable error text.
- Copy `errorCode` through `traceForSynthesis` (`toolExecution.ts:145-160`) and add it to
  `ConsoleGatewayToolResult` (`modelGateway.ts:31-42`). The proxy request schema is strict, so also
  add optional `errorCode` to `llm-egress-proxy/src/requestSchemas.ts` and
  `ConsoleToolResultForSynthesis` in `consoleProtocolTypes.ts`.
- In `runConsoleTurn` after the execute loop (`service.ts:368-401`), if any trace is
  `status:'denied'` with `errorCode:'sensitivity_ceiling_exceeded'`, push a turn warning
  `'elevated_access_required'` (persists into `plannedTools.warnings` + audit automatically).
- Pass the denial signal into `synthesizeConsoleAnswer` (`modelGateway.ts:209-219`). Either add a
  `warnings`/`accessWarnings` array to the backend call + `ConsoleSynthesisBodySchema` +
  `buildConsoleSynthesisMessages`, or derive it in the proxy from denied `toolResults` with
  `errorCode:'sensitivity_ceiling_exceeded'`. Update the `/console/synthesize` prompt in
  `llm-egress-proxy/` to instruct: if the signal includes elevated access required, tell the user
  this needs elevated access and how to raise it.

> The `llm-egress-proxy/` prompt change requires the same care as P0 Part B: rebuild the proxy
> image with **`./start.sh --rebuild`** (plain `./start.sh` won't pick it up), and any new
> branch/function in proxy source must keep its coverage gate green
> (`llm-egress-proxy/vitest.config.ts`, functions 90% is tightest). A prompt-string-only edit adds
> no functions, but verify with `npm --prefix llm-egress-proxy run test:coverage`.

Frontend:
- Type `errorCode` on `ConsoleToolTrace` (`src/api/console.ts:121-131`; already on the wire).
- Stop masking the reason in `summarizeTrace` (`consoleDrawerUtils.ts:178`) → return
  `trace.errorMessage || "Denied by scope or sensitivity"`.
- Add either `warnings`/`accessWarnings` to `ConsoleMessage` from `turn.plannedTools.warnings`, or
  derive the banner from denied traces carrying `errorCode:'sensitivity_ceiling_exceeded'`. Today
  `turnsToMessages`/`appendTurnResult` keep `plannedTools` only inside diagnostic details, so
  `ConsoleMessageList` cannot render a first-class warning without this explicit plumbing.
- Add an inline "Elevated access required" banner in `ConsoleMessageList.tsx` (reuse the
  warning-palette pattern from `ConsoleResults/ConsoleResultsContent.tsx:129-142`) with a button
  that raises `maxSensitivity` and re-runs the prompt.
- Add `maxSensitivity` state + control to `useConsoleDrawerController.ts` (it currently holds none;
  `sendPrompt` `:273-277` / `replayPrompt` `:322-325` omit it). Gate the `admin` level behind the
  existing `isAdmin` prop (`ConsoleDrawer.tsx:124`).

**Tests:** denied trace → `elevated_access_required` warning; `traceForSynthesis` carries
`errorCode`; proxy synthesis request schema accepts the new denial signal; frontend renders a
banner and raises sensitivity on click.

---

## Work item 2 — New read tools

Each is a thin wrapper over an **existing** service method (no new business logic *unless flagged*).
Group into a small number of new families; add to `registry.ts`; they auto-expose to MCP.

### Tier A — near drop-in (replicate only route serialization/guards)

| Tool | Service method | Sensitivity / scope | Replicate from route |
|------|----------------|---------------------|----------------------|
| `get_wallet_privacy` | `privacyService.calculateWalletPrivacy(walletId)` (`privacyService.ts:232`) | wallet / wallet | BigInt→Number on `amount` (`api/transactions/privacy.ts:35`) **and redact raw `address`/`txid`/outpoint material from per-UTXO rows** |
| `list_supported_device_models` | `deviceCatalogService.listHardwareDeviceModels(filters)` (`deviceCatalogService.ts:10`) | public / authenticated | Route default hides discontinued models: pass `discontinued:false` unless the tool explicitly supports an `includeDiscontinued` input (`api/devices/models.ts:25`) |
| `get_historical_price` | `priceService.getHistoricalPrice(currency, date)` (`index.ts:399`; **currency first**) | public / authenticated | required `date`, reject NaN/future (`api/price.ts:373-391`) |
| `get_mempool_status` | `mempool.getBlocksAndMempool('mainnet', …)` (`mempool/dashboard.ts:31`) | public / authenticated | optional: 15s cache + stale fallback (`network.ts:42-137`) |
| `get_recent_blocks` | `mempool.getRecentBlocks(count, 'mainnet', …)` (`mempool/endpoints.ts:29`) | public / authenticated | cap `count`≤100, pin mainnet (`network.ts:20,145-146`) |

`get_wallet_privacy` is the single highest-value add — the audit's top absent read; scoring logic
already exists server-side. Keep it reachable at `wallet` sensitivity by returning aggregate
summary and non-identifying per-UTXO score fields only; include envelope redactions such as
`wallet_privacy_utxo_addresses` and `wallet_privacy_utxo_txids`. If raw addresses/txids are kept,
the existing sensitivity convention requires `high`, which would defeat the default-reachable P1
goal.

### Tier B — need real glue in `execute()` (budget for branch logic + dedicated tests)

These were initially scoped as "thin wrappers" but verification showed the service does **not**
provide the access control / projection the route does. Treat as non-trivial:

- **`get_utxo_privacy`** — `privacyService.calculateUtxoPrivacy(utxoId)` does **zero authz**
  (`privacyService.ts:130` only throws "UTXO not found"). `execute()` must resolve
  `utxoRepository.findWalletIdByUtxoId(utxoId)` → throw `AssistantToolError(404)` on miss →
  `context.authorizeWalletAccess(walletId)` (replicating `api/transactions/privacy.ts:57-66`).
  Declare `requiredScope.kind:'wallet'` but do **not** rely on declarative `walletIdInput` (input
  is a `utxoId`, and there is no `utxo` scope kind, `types.ts:5`).
- **`get_pending_approvals`** — `approvalService.getPendingApprovalsForUser(accessibleWalletIds)`
  (`approvalService.ts:293`) takes a **pre-scoped wallet-id list**, not a userId. `execute()` must
  first call `walletSharingRepository.findWalletIdsByUserRole(userId, WALLET_APPROVE_ROLE_VALUES)`
  (`api/approvals.ts:26`), then reuse the route's projection (vote tally, `amount.toString()`,
  field whitelist — `approvals.ts:31-44`) **except raw `recipient` must be masked or omitted** for
  the wallet-level assistant tool. **Sensitivity `wallet`, not `high`** only if that recipient
  address is redacted; include an envelope redaction such as `approval_recipient_addresses`. If the
  raw recipient is retained, follow the existing draft/address convention and mark the tool `high`.
  Keep it role-gated (owner/approver only).
- **`get_user_preferences`** (display currency) — no dedicated read method;
  `userRepository.findByIdWithProfile` selects `password` (`userRepository.ts:85`). Prefer adding a
  narrow repository method such as `findPreferencesById(userId)` that selects only `preferences`;
  if reusing `findByIdWithProfile`, `execute()` must project to `preferences` **only**, never
  forwarding the hash. "Display currency" is
  `preferences.fiatCurrency` (default `'USD'`, `profile.ts:25-27`) — there is **no**
  `displayCurrency` field. **Sensitivity `public` + scope `authenticated`** (not `wallet`): this is
  self-scoped, non-wallet data, so marking it `wallet` would deny it in `general` scope (see the
  wallet-scope rule above); `execute()` reads the caller's own `context.actor.userId`, so
  `authenticated` scope is the real isolation. (Lets the agent format fiat correctly in any scope.)
- **`list_devices`** — `deviceAccess.getUserAccessibleDevices(userId)` (`deviceAccess.ts:131`)
  returns device `xpub` + per-account `xpub` + `fingerprint` (`deviceAccess.ts:43,52,54,153,164`),
  plus owner username (`sharedBy`), group IDs/roles, derivation paths, wallet associations, and
  nested account rows. `execute()` should use an explicit allow-list projection for the assistant
  response (for example `id`, `label`, `type`, `model`, `isOwner`, `userRole`, `walletCount`,
  `createdAt`/`updatedAt`) instead of deleting a few fields from the service return. Strip device
  `xpub`, account `xpub`, `fingerprint`, derivation paths, owner/shared usernames, group fields,
  and nested wallet/account detail; list them in `envelope.redactions`. **Sensitivity `wallet`**
  after that redaction — the residual (device name, model, type, connection state/counts) is
  low-sensitivity and answers "which hardware is connected", so it should be reachable by default.
  (If the xpubs or association details were not stripped it would have to be `high`; stripping is
  what makes `wallet` safe.) Note: it's queried by `userId` (not a wallet), so `wallet` sensitivity
  denies it in explicit `general` scope — fine for the common `wallet_set` auto-scope; choose
  `public` + `authenticated` (like `get_user_preferences`) if you want "which hardware is
  connected" answerable with no wallet selected.

### Recipe (per `marketReadTools.ts` / `networkReadTools.ts` template)

```ts
export const getWalletPrivacyTool: AssistantReadToolDefinition<typeof inputSchema> = {
  name, title, description, inputSchema, outputSchema: z.object({}).passthrough(),
  sensitivity, requiredScope: { kind, description }, budgets: { maxRows, maxBytes },
  async execute(input, context) {
    // wallet-scoped: await context.authorizeWalletAccess(input.walletId) FIRST
    const data = await someService(/* via repository, not prisma */);
    return createToolEnvelope({ tool, context, data, summary, facts, provenanceSources, audit });
  },
};
```

Add the family import + spread in `registry.ts` (mind the asserted order in
`readToolRegistry.test.ts`). Add a `<family>ReadTools.test.ts` exercising the tool **through the
registry singleton** with a case per branch (happy path + each 404 / denial / redaction) to hold
100% coverage.

---

## Suggested sequencing

1. **Work item 1** (denial surfacing) — unblocks the 7 already-built `high` tools; biggest
   usefulness gain per line.
2. **Tier A** tools — `get_wallet_privacy` first, then the public market/network reads.
3. **Tier B** tools — `get_pending_approvals`, `get_user_preferences`, `get_utxo_privacy`,
   `list_devices` (each needs glue + branch tests).

## Definition of done

- [ ] Denial reasons reach synthesis (`errorCode` carried) and the UI shows an
      "elevated access required" banner with a working raise-sensitivity action.
- [ ] Tier A tools landed with serialization/guards replicated; appear in Console + MCP.
- [ ] Tier B tools landed with access glue + redaction + per-branch tests.
- [ ] Backend coverage stays at 100%; `tsc --noEmit` + vitest green before push.
- [ ] Spot-checked in the Console: "what's my wallet's privacy score", "what's awaiting my
      approval", "which hardware is connected", "what was the BTC price on <date>".

## Out of scope (tracked, not P1)

Remaining ❌ domains from the audit (audit logs, feature flags, policy-usage headroom, RBF
eligibility, address validate/lookup, coin-selection recommendation, pending transfers, webhooks,
system health) — add read wrappers as demand warrants. All write/action capabilities remain
excluded by the read-only agent design.
