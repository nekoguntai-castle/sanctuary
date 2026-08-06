# Dashboard refresh — collapsed summaries, balance chart axis, page-level period

## Context

Three concrete defects reported against the dashboard, plus a general ask to streamline it:

1. **Wallets, collapsed** — count, BTC and fiat squash together on the right. Root cause verified:
   `WalletSummary.tsx:478` passes `<Amount sats={totalBalance} />` **without** the `inline` prop, so
   `Amount` takes its `flex flex-col` branch (`Amount.tsx:63`) and renders BTC over fiat as a
   two-line block beside a one-line count.
2. **Recent Activity, collapsed** — shows `Showing 1–10`, a paging statement that means nothing when
   nothing is on screen. The text is deliberate (`RecentTransactions.tsx:41-43`: the endpoint returns
   a page and never counts the whole set), so replacing it needs real period-scoped numbers, not an
   invented total.
3. **Total Balance chart flat for large balances** — root cause verified: recharts' default numeric
   Y domain is `[0, 'auto']` (`recharts/lib/state/selectors/axisSelectors.js:50`), and
   `PriceChartBody.tsx:74` uses a bare `<YAxis hide />`. A 0.03% move on 12 BTC is drawn against a
   0-to-12 scale, so it reads as a flat line.

Underneath those: the page carries three different collapsed-header treatments, two competing heading
scales, and three telemetry cards with three unrelated internal shapes.

## Decisions taken with the user

- **Scope: full refresh** — the three fixes, a consistency pass, and page-level restructure.
- **Activity metadata: new aggregate endpoint**, scoped to the dashboard period.
- **Chart: fitted domain + labelled Y ticks + dashed reference line at the period's opening balance.**
- **Telemetry: normalize all three cards onto one shape** (eyebrow → headline → support → optional
  disclosure), keeping three cards and the existing responsive grid.

## One deliberate change from the approved sketch

The sketch showed Recent Activity's bar with a single netted amount (`+0.0043 BTC`). Implement it
**per direction** (`↓0.0120 ↑0.0077`) instead. `useDashboardData.ts:135-141` states the rule
explicitly for pending totals: a single signed total renders +100k in / −100k out as "nothing
happened". The same argument applies to a period summary. The endpoint returns both legs; the UI shows
both. Flag this to the user at review; it is a one-line UI change to net them if they disagree.

---

## A. Shared collapsed-summary primitive

**New: `src/components/ui/SectionSummary.tsx`**

Extract the pattern already proven in `MempoolSection.tsx:205-238` (`MempoolCollapsedSummary`) — the
best of the three treatments on the page.

```
props: { parts: ReactNode[]; testId?: string }
renders: text-xs text-sanctuary-500 dark:text-sanctuary-400 tabular-nums truncate min-w-0
```

`min-w-0` on the span itself is load-bearing — as a flex item inside `CollapsibleSection`'s right-hand
group (`CollapsibleSection.tsx:117`) its default `min-width:auto` blocks shrinking and `truncate`
never engages. Keep that comment.

Parts are `ReactNode`, not `string`, because Wallets passes an `<Amount>`. Interleave ` · `
separators as keyed elements — **do not `parts.join(' · ')`**, which stringifies nodes.

Adopted by all three sections. `MempoolSection` keeps identical output (pure refactor, no visual
change to that card, expanded or collapsed).

## B. Wallets collapsed bar

`src/components/Dashboard/WalletSummary.tsx:475-480` — replace the `summary` block with
`<SectionSummary>` and add `inline size="sm"` to the `Amount`:

```
4 wallets · 12.4081 BTC  $1,468,120
```

One row, fiat inline, `tabular-nums`. `Amount`'s `inline` branch falls through to the block layout when
`formatFiat` returns null (fiat off, or a non-mainnet network) — that fallback is a single line, so
non-mainnet is safe without a second code path.

Test at `tests/components/Dashboard/WalletSummary.test.tsx:361-370` asserts via
`screen.getByText('4 wallets').parentElement` — that traversal changes shape; update it to query the
new `SectionSummary` testid.

## C. Recent Activity — period-scoped summary

### Backend

**`server/src/repositories/transactions/core.ts`** — add `getActivitySummary(walletIds, startDate)`
next to `getBucketedBalanceDeltas` (line 190) and `groupByType` (line 317), whose shape it follows:

```ts
prisma.transaction.groupBy({
  by: ['type'],
  where: { walletId: { in: walletIds }, blockTime: { not: null, gte: startDate } },
  _count: { id: true },
  _sum: { amount: true },
  _max: { blockTime: true },
})
```

`blockTime` non-null means **confirmed activity only** — the same filter
`getBucketedBalanceDeltas` uses, so the summary and the chart above it can never disagree. Say so in a
comment and carry it into the UI copy (see below).

**`server/src/api/transactions/crossWallet.ts`** — `GET /transactions/activity-summary`, params
`timeframe` + `walletIds`. Reuse the file's existing `getTimeframeStartDate` (line 43) and the
`walletRepository.findAccessibleWithSelect` + empty-set-returns-early shape used by the two sibling
routes. Returns `{ count, receivedSats, sentSats, latestAt }`.

Cache 30s via `walletCache`, keyed on user + sorted walletIds + timeframe — precedent and TTL from
`server/src/api/transactions/walletTransactions/stats.ts:29-45`. Use `bigIntToNumberOrZero` for the
sums, already imported in `crossWallet.ts`.

**OpenAPI is enforced, not optional**: add the path to
`server/src/api/openapi/paths/transactions.ts` (model on `/transactions/balance-history`, line 264)
and add `['/transactions/activity-summary', 'get']` to the route list in
`server/tests/unit/api/openapi.wallet.contracts.ts:34`.

### Frontend

- `getActivitySummary()` in `src/api/transactions/transactions.ts`, beside `getBalanceHistory`.
- `useActivitySummary(walletIds, timeframe)` in `src/hooks/queries/useWallets.ts`, following
  `useBalanceHistory` (line 190) — same `walletIds.join(',')` stable key, same `enabled` guard.
- Wire through `useDashboardData` and `DashboardContent` into `RecentTransactions`.

Collapsed bar becomes:

```
⌄ RECENT ACTIVITY          14 txns · ↓0.0120 ↑0.0077 · 3h ago
```

Details:
- Use `usePriceFreeFormatter()` (not `useCurrency()`) for the amounts — per
  `src/contexts/CurrencyContext.tsx`, it skips the 60s price re-render, and this bar shows no fiat.
- Relative time: reuse `formatTimeAgo` from
  `src/components/PendingTransfersPanel/transferTimeUtils.ts:8`. Do not add a fourth implementation —
  there are already three near-duplicates in the repo.
- While the query is unresolved, render **nothing**, not zeros.
- Zero activity in the period renders `No activity in the past month`, not `0 txns`.
- The bar's `title` names the confirmed-only basis, since the count is quietly narrower than the list
  below it (which includes unconfirmed rows —
  `dashboardDataModel.ts:112` stamps those with `Date.now()`).

`Showing N–M` stays where it belongs: in the pagination footer (`RecentTransactions.tsx:102`), which
only renders when there is more than one page.

## D. Total Balance chart

**New: `src/components/Dashboard/PriceChart/balanceAxisModel.ts`** — pure functions, sibling to
`balanceTrendModel.ts`. Pure-model files are how this area stays testable against the 100% gate.

- `buildBalanceAxis(points, openingSats)` → `{ domain: [number, number]; ticks: number[] }`
  - Fit to data min/max with ~15% headroom.
  - **Flat series** (`range === 0`): pad symmetrically around the value so the line centres instead of
    pinning to an edge. This is the large-balance case that motivated the work — it must not divide by
    a zero range.
  - Mirror `buildBalanceTrend`'s guards (`balanceTrendModel.ts:50-64`): filter non-finite `sats`,
    handle `< 2` usable points.
  - Ensure `openingSats` is inside the returned domain, or the reference line clips.
  - Three ticks (low / mid / high).
- `formatAxisAmount(sats, unit)` — compact tick labels. A full 8-decimal BTC string is far too long for
  a tick; pick decimals from the domain span so adjacent ticks stay distinguishable.

**`PriceChartBody.tsx`**

- Replace `<YAxis hide />` with a visible axis: `domain`, `ticks`, `tickFormatter`, `width`,
  `axisLine={false} tickLine={false}`, and a `Y_AXIS_TICK` const matching the existing
  `X_AXIS_TICK` (line 35). Reuse the `NEUTRAL` hex — the file's docblock explains why a
  `--color-sanctuary-*` var is not available here.
- `<ReferenceLine y={openingSats} strokeDasharray="4 4" stroke={NEUTRAL} />` with an `open` label.
- A visible Y axis reserves horizontal space; re-check the `min-w-[200px]` floor (line 62) and the
  `lg:w-2/3` column in `PriceChart.tsx:119` still leave the plot usable at the narrow end.

**`ChartTooltip.tsx`** hardcodes `sats` (line 12) regardless of the unit preference. Once the axis is
unit-aware, leaving the tooltip fixed is a visible contradiction inside one chart — fix in the same
pass using the same formatter.

**Test gotcha:** `tests/components/Dashboard/PriceChart.test.tsx` mocks `recharts` wholesale (jsdom has
no layout). `ReferenceLine` must be added to that mock factory or the suite throws on an undefined
component.

## E. Page-level period + telemetry row

### Period selector

- Move `<TimeframeControls>` out of the Total Balance card header (`PriceChart.tsx:98`) into a new
  page header row in `DashboardContent.tsx`, above the first card.
- Promote the state in `useDashboardData.ts:44` from `useState` to
  `useUserPreference('viewSettings.dashboard.timeframe', '1W')`, joining the other
  `viewSettings.dashboard.*` keys. This matches the reasoning already recorded at
  `useDashboardData.ts:99-107`: a *lens* persists (page size), a *position* does not (page number). A
  period is a lens.
- The zero-wallet welcome branch (`DashboardContent.tsx:90-94`) renders no chart and has no activity —
  omit the header row there rather than showing a control that scopes nothing.

### Telemetry cards

Normalize `BitcoinPriceCard`, `FeeEstimationCard`, `NodeStatusCard` onto: eyebrow → one headline
value → one supporting line → optional detail behind a disclosure. All three already share the eyebrow
(`text-[11px] font-semibold … uppercase tracking-[0.08em]`); the divergence is below it.

- `NodeStatusCard`'s per-server list (lines ~84-100) moves behind `ShowMoreToggle`
  (`src/components/ui/ShowMoreToggle.tsx`) — the biggest single density win in the row.
- `FeeEstimationCard`'s three nested `surface-secondary` mini-panels flatten to one headline row.
- `BitcoinPriceCard` loses its oversized icon chip and the dead space under the price.

Also align the two competing heading scales: `WalletSummary` and `RecentTransactions` use
`text-lg font-medium` (`WalletSummary.tsx:467`, `RecentTransactions.tsx:57`) while every other card on
the page uses the eyebrow. Standardize on the eyebrow.

### Layout contracts that must survive

Verified in the existing suites — these are assertions, not preferences:

- `Dashboard.render.test.tsx:437` — telemetry reflows `lg:grid-cols-3` → `lg:grid-cols-2` when
  Bitcoin Price is omitted on testnet/signet.
- `Dashboard.render.test.tsx:411` and the 1920px Playwright case
  (`tests/e2e/render-regression.spec.ts:62`) — Wallets and Activity stay stacked full-width siblings,
  never a shared row.
- `Dashboard.render.test.tsx:425` — card shells that perform no action must not advertise
  clickability (`interactive={false}`).
- `DashboardContent.tsx:136-139` — `.stagger-enter` owns child delays via `nth-child`; adding an
  `animate-fade-in-up-*` to a child of that grid silently outranks nothing and breaks the cascade.
- Wallets only appears at ≥2 active-network wallets, and the stagger index of Recent Activity shifts
  accordingly (`DashboardContent.tsx:130`).

### Skeleton

`DashboardSkeleton` (`src/components/ui/Skeleton.tsx:12`) is the Suspense fallback for this route
(`src/app/AppRoutes/AppRoutes.tsx:12`). Its 3-card stat row and section order must be updated to mirror
the new layout, or the route flashes a stale shape on every cold load.

---

## Constraints discovered during exploration

- **Coverage is 100% on branches/functions/lines/statements** for the frontend
  (`config/tooling/vitest.config.ts`), and `shared/**` is inside that gate. Every new branch —
  including each guard in `balanceAxisModel` — needs a test in the same PR.
- **`CollapsibleSection.preferenceKey` is required.** Any new collapsible needs a real
  `viewSettings.dashboard.*` key; there is no ephemeral fallback and the docblock explains why.
- **Children stay mounted while collapsed** (`hidden` only). Collapsing saves no work, and anything
  measuring layout on mount reads zeroes.
- **Dark-mode palettes are inverted** for `primary`, `success`, `warning`, `sent`
  (`dark:bg-primary-100` is dark, `dark:bg-primary-950` is white). `sanctuary-*`, `rose-*`,
  `emerald-*` are not.
- **`success`/`sent` emit no 300/400 shades**, and there is no `--color-sanctuary-*` or
  `--color-rose-*` CSS var — Tailwind classes only. Chart colours are constrained accordingly.
- **The `shared` palette is missing from the Tailwind config** in `src/index.html`, so existing
  `bg-shared-*` / `text-shared-*` classes elsewhere in the app generate no CSS. Out of scope here, but
  do not introduce new `shared-*` classes on this page. Worth a follow-up issue.
- **Charts must gate on `useDelayedRender()`** before mounting `ResponsiveContainer`, and gradient ids
  must stay unique per variant.
- **Run `git commit` in the foreground** — pre-commit hooks run AI review agents whose output needs
  reading.

## Sequencing

Four PRs, each independently mergeable and independently revertable:

1. **A + B** — `SectionSummary` primitive, adopted by all three sections; Wallets bar fixed. Small,
   pure-frontend, no new data.
2. **D** — chart axis model, visible Y axis, reference line, tooltip unit fix. Self-contained.
3. **C** — activity-summary endpoint (repo → route → OpenAPI → client → hook), then the Recent
   Activity bar. Only PR touching the backend.
4. **E** — page-level period, telemetry normalization, heading scale, skeleton. Largest test churn
   (`NodeStatusCard.test.tsx` is 440 lines and `Dashboard.render.test.tsx` is 489).

## Verification

Per-PR, before pushing:

```bash
cd server && npx tsc --noEmit && npx vitest run --coverage   # PR 3 only
cd .. && npx tsc --noEmit && npx vitest run --coverage        # every PR
npx playwright test --config config/tooling/playwright.config.ts tests/e2e/render-regression.spec.ts
```

End-to-end in the real app (never on the host — `./start.sh --rebuild`, then `localhost:8080`):

- Collapse Wallets → count, BTC and fiat on one row, truncating rather than wrapping at narrow widths.
- Collapse Recent Activity → period-scoped count, both directions, relative time. Switch the period
  and confirm the numbers move with it.
- Load a large-balance mainnet wallet, pick `1M` → the line has visible shape, three Y ticks are
  legible, and the dashed open line sits where `buildBalanceTrend` says the period opened.
- Switch to testnet → Bitcoin Price card drops, telemetry reflows to two columns, fiat disappears from
  both summary bars.
- Toggle BTC/sats and light/dark → axis ticks, tooltip and both bars stay consistent.
- Reload → period selection and all three collapse states persist.
- Zero-wallet account → welcome branch renders with no period control and no broken summary.

## Follow-ups (not in scope)

- Three near-duplicate relative-time formatters (`AuditLogs/constants.ts`,
  `PendingTransfersPanel/transferTimeUtils.ts`, `NotificationPanel/notificationPanelHelpers.tsx`)
  should converge on one shared util.
- `shared` palette missing from the Tailwind config — dead classes across five components.
- No shared `Badge` or `Stat` primitive; badges are re-implemented inline in six places.
