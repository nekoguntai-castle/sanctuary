# P0 — Make the AI agent answer price / fee / network questions

**Status:** Implemented in P0 branch, pending PR merge and runtime validation
**Date:** 2026-06-25
**Source audit:** `reports/ai-access-audit-2026-06-25.md`
**Owner:** _unassigned_

## Problem

The Console agent has a `get_market_status` tool, yet "what is the BTC price?" returns no
answer. Two independent defects compound:

1. **Data-layer disconnect (the root cause).** `get_market_status` reads BTC price from the
   Prisma `price_data` table (`server/src/assistant/tools/marketReadTools.ts:34` →
   `cache.ts:35 getCachedBtcPrice` → `repositories/assistantRead/publicReads.ts:19
   prisma.priceData.findFirst`). **Nothing in non-generated code ever writes a row to
   `price_data`.** The live price feed persists only to the in-memory `priceCache`
   (`services/price/index.ts:263, 680-693`); the only scheduled job touching the table is a
   `deleteMany` cleanup (`worker.ts:371-383` → `maintenanceRepository.ts:24`). So
   `getLatestPrice()` is always `null` → the tool returns `{available:false, price:null,
   stale:true}` → the agent truthfully reports it has no price. **`fee_estimate` has the
   identical defect** (`publicReads.ts:13`; only `deleteMany`/`count` writers).

2. **Planner gap.** The `llm-egress-proxy` console planner only understands **3 hardcoded
   intents** (`query_transactions`, `get_wallet_overview`, `get_dashboard_summary` —
   `consoleProtocolIntents.ts:172-189`, `consoleProtocolMessages.ts:14`). The market/fee/network
   tools are reachable only if the local model emits an exact legacy
   `{"toolCalls":[{"name":"get_market_status",…}]}` JSON, while the system prompt steers it
   toward intents. Result: even with data present, a price question can plan **zero** tools and
   the turn still returns `success` with a vague/hallucinated answer.

**Both must be fixed.** Fixing only the data layer leaves the path dependent on model discipline;
fixing only the planner still reads an empty table.

## Verification notes (confirmed against current code, 2026-06-25)

- No recurring job, seed, or migration writes `price_data`/`fee_estimate`. The only non-cron
  writer is the **backup-restore** path (`backupService/restore.ts:140` `createMany` over
  `CACHE_TABLES`, only on a full destructive restore with `includesCache`) — mutually exclusive
  with live operation, so **no duplicate-write risk**. The autopilot `record-fees` job writes to
  **Redis** (`autopilot:fees`), not the Postgres table — red herring.
- New insert shape must stay **restore/serialization-compatible** — same columns
  (`price_data`: `currency`/`price`/`source`; `fee_estimates`: `fastest`/`halfHour`/`hour`).
  It already is.
- The proxy coverage gate (`llm-egress-proxy/vitest.config.ts`: branches 69 / **functions 90** /
  lines 81 / statements 78) currently sits at functions **91.53%** — tested new functions keep it
  green; the binding metric is **functions**, so every new builder needs a test.
- Editing `llm-egress-proxy/src/**` requires a rebuild: **`./start.sh --rebuild`** (plain
  `./start.sh` does NOT rebuild the proxy image — its `NEED_BUILD` probe ignores
  `sanctuary-llm-egress-proxy:local`, `start.sh:264-272`). Faster loop:
  `docker compose build llm-egress-proxy && docker compose up -d llm-egress-proxy`.

---

## Part A — Persist price + fee snapshots (the root-cause fix)

### A0. Non-regression test FIRST (project rule: bug → failing test → fix)

Write the focused non-regression tests before the production change. Assert at the tool layer:

- **At least one test must fail on the current code because the writer is missing.** Preferred:
  import/expect `persistPriceFeesJob`, mock `getPriceService()` + `getCurrentFeeEstimates()`, run
  the handler, and assert the repository writes uppercase price rows plus one fee row. Before the
  fix this fails at the missing export/job; after the fix it proves the root-cause writer exists.
- `get_market_status` returns `available:true` with a numeric `price` after a snapshot row
  exists, and `available:false` when `price_data` is empty.
- The **fee branch** of `get_market_status` (and `get_fee_estimates`) returns populated tiers
  after a `fee_estimates` row exists.
- Currency is stored **upper-case** (the read does `where:{ currency }` after upper-casing —
  `publicReads.ts:18-22`, `cache.ts:34`).

The manual-row tool tests alone are not enough: they mostly prove the existing reader behavior and
can already pass today. Keep them as regression coverage, but the failing-first test must exercise
the missing persistence path.

### A1. New write repository

**No schema migration needed:** `price_data` (`schema.prisma:740`) and `fee_estimates`
(`schema.prisma:719`) already exist (initial_setup migration); P0 only adds *writes* to them.

Create `server/src/repositories/priceDataRepository.ts` (the only Prisma-touching layer for
these tables besides the existing read/delete modules):

```ts
export async function insertPriceData(input: { currency: string; price: number; source: string }) { … }
export async function insertFeeEstimate(input: { fastest: number; halfHour: number; hour: number }) { … }
```

Export it from `server/src/repositories/index.ts` alongside `maintenanceRepository`
(`index.ts:39`) and `assistantReadRepository` (`index.ts:41`). Insert shape:

```ts
prisma.priceData.create({ data: { currency, price, source } });        // id + createdAt auto
prisma.feeEstimate.create({ data: { fastest, halfHour, hour } });      // id + createdAt auto
```

`PriceData` = `schema.prisma:740`; `FeeEstimate` = `schema.prisma:719`.

Normalize `input.currency.trim().toUpperCase()` at the repository boundary (or in a tiny helper
called by it), even though the scheduled job currently gets uppercase provider currencies. The
reader normalizes lookup currency before querying, so this keeps ad hoc/test callers from writing a
lowercase row that the assistant can never read back.

### A2. Persistence job

**Handler** — add `persistPriceFeesJob: JobDefinition` to
`server/src/jobs/definitions/maintenance.ts` (template: `cleanupPriceDataJob` at
`maintenance.ts:64-85`) and append it to that file's `maintenanceJobs` export (`:397-407`).
Handler logic (deps via direct import — no DI):

```ts
const ps = getPriceService();                                  // services/price/index.ts:736
const currencies = ps.getSupportedCurrencies();                // index.ts:556 (USD,EUR,GBP,CAD,CHF,AUD,JPY,CNY,KRW,INR)
const prices = await ps.getPrices(currencies);                 // index.ts:348 (median per currency; failed currencies omitted)
for (const [currency, agg] of Object.entries(prices)) {
  await priceDataRepository.insertPriceData({
    currency, price: agg.price, source: 'aggregate',           // stored price is the MEDIAN across sources, not one provider's quote
  });
}
const fees = await getCurrentFeeEstimates('mainnet');          // services/bitcoin/feeService.ts:27
await priceDataRepository.insertFeeEstimate({ fastest: fees.fastest, halfHour: fees.halfHour, hour: fees.hour });
```

Notes:
- `AggregatedPrice.price` is the **median** across sources — store a stable `source:'aggregate'`
  label rather than `sources[0].provider`, which would falsely imply the median came from one
  provider (the read tool surfaces `price.source` to the model).
- `economy`/`minimum`/`source` from fees have no columns and are dropped.
- **No explicit `initialize()` call required:** `getPrices` → `getPrice` self-initializes
  (`index.ts:153 ensureInitialized`) and swallows per-currency failures (`index.ts:348-372`); on a
  cold first run `getSupportedCurrencies()` returns a safe configured fallback
  (`index.ts:557-558` → `getConfiguredCurrencies` unions enabled providers), never empty.
- **Not gated on the AI feature:** this job must run regardless of whether AI is enabled, so that
  enabling AI later has data immediately (and price/fee rows benefit non-AI features too).
- **Isolate price vs. fee persistence in independent `try/catch` blocks.** The fee fetch hits an
  external API (mempool.space + Electrum fallback) and is the most failure-prone step. If it throws
  and bubbles out of the handler, BullMQ retries the *whole* handler (`attempts:3`), re-running the
  price loop and writing **duplicate price rows** on each retry (the tables are append-only). Catch
  each sub-task so a fee outage doesn't re-write prices and vice-versa; log failures and let the
  next cron tick recover. (Rows are append-only + retention-pruned, so duplicates aren't a
  correctness bug, but the retry-amplification is avoidable bloat.)

**Worker wrapper + lock** — add a `WorkerJobHandler` to
`server/src/worker/jobs/maintenanceJobs.ts` (template: `cleanupPriceDataJob` block
`:47-56`) with `lockOptions` (`lockKey: () => 'maintenance:persist:price-fees'`,
`lockTtlMs: CLEANUP_LOCK_TTL_MS`) to prevent double-runs across worker replicas.

**Schedule** — in `server/src/worker.ts` `scheduleRecurringJobs()` (`:316`):

```ts
await jobQueue.scheduleRecurring('maintenance', 'persist:price-fees', {}, '* * * * *');
```

Every minute is the right cadence: the assistant cache staleness window is **10 minutes**
(`cache.ts:29,54`), and cron granularity is 1 min (`workerJobQueue/index.ts:326-331`,
`repeat:{pattern}` only). The schedule call is idempotent/self-healing on boot.

> The job name `persist:price-fees` is a plain string literal that must match in all three places
> (definition `.name`, worker wrapper `name`, `scheduleRecurring`). No constants file.

**Optional interval knob** — if we want it env-tunable, mirror the stale-wallet pattern
(`worker.ts:323-331`) by adding `pricePersistIntervalMs` to
`config/{envSections,types,schema}.ts`. Not required for a fixed 60s cadence.

### A3. Tests that pin the job list (will fail otherwise)

- `server/tests/unit/worker/jobs/maintenanceJobs.test.ts` — add `persistPriceFeesJob` to the
  hoisted mocked definitions, include it in `FORWARDED_MAINTENANCE_JOBS`, bump
  `expect(maintenanceJobs).toHaveLength(10)`, add the name to the ordered `.map(j=>j.name)`
  assertion, and assert the cleanup TTL lock key (`maintenance:persist:price-fees`) is present.
- `server/tests/unit/jobs/maintenanceDefinitions.behavior.test.ts` — add the job to the exported
  `maintenanceJobs` assertion and bump `expect(maintenanceJobs).toHaveLength(10)` (it is already
  9 before this work).
- `server/tests/unit/worker/worker.entry.test.ts` — assert `scheduleRecurring('maintenance',
  'persist:price-fees', {}, '* * * * *')` in the recurring schedule test.
- New unit tests for `priceDataRepository` insert shape + the job handler (mock the price/fee
  services). Backend coverage gate is **literal 100%** (`server/vitest.config.ts:58-63`) — cover
  every branch (empty currency list, a failed-currency omission, fee-fetch error path).

---

## Part B — Deterministic planner intents for price / fee / network

All four target tools are `requiredScope.kind:'authenticated'` (no wallet IDs needed) — the
planner only needs `hasTool(input, name)`. `convert_price` requires **exactly one** of
`sats`/`fiatAmount` (`networkReadTools.ts:31-42` throws 400 otherwise).

### B1. Intents — `llm-egress-proxy/src/consoleProtocolIntents.ts`

Add 4 zod intent schemas after `DashboardSummaryIntentSchema` (`:143`), reusing
`normalizedIntentRecord`:

- `get_market_status` — optional `currencies: string[3-8]×(1-8)`, optional `includeFees: bool`.
- `get_fee_estimates` — no params.
- `get_bitcoin_network_status` — no params.
- `convert_price` — optional `sats`/`fiatAmount`/`currency`, with a `.refine` enforcing
  **exactly one** of `sats`/`fiatAmount` (mirrors the backend guard so an under-specified intent
  fails parse → `model_response_invalid_intent`, never a runtime 400).

Extend the `ConsoleIntent` union + exported types (`:145-153`) and add the 4 `switch` cases in
`parseConsoleIntent` (`:172-189`).

### B2. Intent → toolCall — `llm-egress-proxy/src/consoleProtocolPlanning.ts`

Add a DRY `buildPublicToolIntentPlan(input, toolName, callInput, reason, maxToolCalls)`
(guards on `hasTool` + budget, no wallet selection) plus `marketStatusCallInput` /
`priceConversionCallInput` (emit params only when present; otherwise `{}` so the backend applies
defaults `currencies:['USD']`, `includeFees:true`). Wire 4 cases into the
`buildConsoleIntentToolPlan` switch (after `get_dashboard_summary`, `:259`) and import the new
types (`:1-8`).

> Adding union members **without** all cases makes the switch's inferred return type include
> `undefined`, which errors at the `plan.toolCalls` access in `resolvePlanIntents`
> (`:282-287`) under `tsc`. So `npm --prefix llm-egress-proxy run build` catches an incomplete
> implementation — keep all 4 cases.

### B3. System prompt — `llm-egress-proxy/src/consoleProtocolMessages.ts:14`

Extend the "Supported intent names are …" line to include the 4 new names, and add one doc line
describing `get_market_status` params and the `convert_price` exactly-one-of rule.

### B4. Keyword fallback (supplement) — `consoleProtocolPlanning.ts buildFallbackToolPlan` (`:124-143`)

Add `buildPublicToolFallbackPlan(input)` as the **first** candidate (so an unambiguous
price/fee/network prompt beats the wallet-`"balance"` heuristics). It keyword-matches
fee → `get_fee_estimates`, network/mempool/height → `get_bitcoin_network_status`,
price/worth/rate → `get_market_status` (with `{}` so backend defaults apply). **Do not**
keyword-emit `convert_price` (no safe default amount → 400); conversions go through B1 intents
only. This handles the local-model-returns-prose case; B1 handles structured output. They are
complementary.

No change needed in `consoleProtocolPlanParsing.ts` (`keepKnownToolCalls` is name-agnostic) or
`consoleRoutes.ts`.

### B5. Proxy tests — `tests/llm-egress-proxy/consoleProtocol.test.ts`

Add a public-tool fixture array (mirror `queryTransactionsTool` `:7-14`) and cases:

- Each intent → its tool, `input:{}` (and `get_market_status` with/without `currencies`/
  `includeFees` to hit both `marketStatusCallInput` branches).
- `convert_price` with `sats` only, with `fiatAmount` only (each carried through), and with
  **both / neither** → intent rejected, **no** `convert_price` call emitted (`.refine` branch).
- `hasTool === false` for each → empty `toolCalls` (the `!hasTool` guard).
- If B4 ships: prose prompts (`"current btc price in usd"`, `"what are current fees"`,
  `"what's the block height"`) → fallback tool + `["model_response_not_json","fallback_plan_applied"]`.

Run locally before pushing (functions gate is tightest):
`npm --prefix llm-egress-proxy run build && npm --prefix llm-egress-proxy run test:coverage`.

---

## Definition of done

- [x] Non-regression test written first and failing (Part A0).
- [x] `priceDataRepository` insert methods + `repositories/index.ts` export.
- [x] `persist:price-fees` job: definition + worker wrapper (locked) + schedule; job-list tests updated.
- [ ] After `./start.sh --rebuild`, wait ~2 min then confirm rows are accruing, via either:
      - worker logs show the job firing: `docker compose logs --tail=100 worker | grep -i price-fees`
      - a direct row count (no app code; uses the compose-provided creds):
        `docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'select count(*) from price_data;'`
        (avoid `@prisma/client` — this repo uses a custom generated client at
        `server/src/generated/prisma/`).
- [x] `get_market_status` returns `available:true` with a price and fees once rows exist.
- [x] 4 new planner intents + intent→toolCall mapping + system-prompt update + keyword fallback.
- [x] Proxy + backend test suites green locally (`tsc --noEmit`, vitest, coverage) before push.
- [ ] Verified end-to-end in the Console drawer: "what is the BTC price?" returns a real number;
      "what are current fees?" and "what's the block height?" return real data.
- [ ] Rebuilt with `./start.sh --rebuild` (proxy image picks up `src` changes).

## Implementation notes (2026-06-25)

- Added `priceDataRepository` write methods for `price_data` and `fee_estimates`, including
  repository-boundary currency normalization.
- Added `persist:price-fees` as a maintenance job, worker handler with lock configuration, and a
  one-minute recurring worker schedule. Price and fee writes are isolated so one failing source
  does not retry-amplify the other append-only table.
- Added deterministic console planner support for `get_market_status`, `get_fee_estimates`,
  `get_bitcoin_network_status`, and `convert_price`, including structured intent parsing,
  tool-call mapping, prompt guidance, and public price/fee/network keyword fallbacks.
- Local verification passed:
  - `npx tsc --noEmit --pretty false` (`server`)
  - `npm run typecheck:tests` (`server`)
  - `npm run test:coverage -- --reporter=dot` (`server`, 100% statements/branches/functions/lines)
  - `npm --prefix llm-egress-proxy run build`
  - `npm --prefix llm-egress-proxy run test:coverage`
- Runtime row-accrual and Console drawer validation are intentionally left for the post-merge
  rebuild/verification pass, so this plan does not claim live container validation before the
  branch is merged.

## Risks / watch-items

- **Restore compatibility:** keep insert columns identical to `CACHE_TABLES` serialization
  (`backupService/serialization.ts:143`). Already aligned.
- **Provider config:** `getSupportedCurrencies()` depends on enabled providers
  (`providerSettings.ts:98`, default `mempool/coingecko/kraken/coinbase`). If a user disables all
  price providers, the job writes nothing and the tool stays `available:false` — acceptable and
  truthful; surface as a known limitation, not a bug.
- **Cadence vs. staleness:** 1-min cron with a 10-min staleness window leaves comfortable
  headroom even if several runs fail.
- **Fees are mainnet-only:** the `fee_estimates` table and the assistant's
  `getCachedFeeEstimates` have **no network dimension** (they read the latest row regardless of
  network), so the job stores mainnet fees. This matches the existing `get_fee_estimates` tool's
  current behavior; a user on testnet/signet would see mainnet fees. Acceptable for P0 — note as a
  known limitation rather than expanding scope.
