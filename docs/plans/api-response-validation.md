# Runtime validation of API responses

Status: phases 0-2 done; phase 3 Tier A complete
Prompted by: #736 (`formatFeeRate` crashing on a null rate)

## The problem

`apiClient.get<T>` is a type assertion with nothing behind it. `unwrapSuccessfulJsonBody`
(`src/api/client.ts:394-405`) is the whole of it:

```ts
function unwrapSuccessfulJsonBody<T>(parsed: ParsedApiResponse, response: Response): T {
  if (parsed.source !== 'text') return parsed.body as T;
  ...
}
```

The client checks that a response *is* JSON. It never checks its shape. Across 27 modules
under `src/api/` there are ~255 such call sites, and `T` influences nothing at runtime.

TypeScript then reasons confidently about values it has never seen, and every downstream
guard is written against the declared type rather than the actual one. That is why
`fees?.[tier.key] !== undefined` looks like a null check and is not.

## What this actually costs — the fee incident is not fixed as a class

#736 hardened `formatFeeRate`. The same `/bitcoin/fees` response feeds two other consumers
that were not touched, and **both fail silently with wrong money rather than crashing**:

| site | code | with `fastest: null` |
| --- | --- | --- |
| `src/components/send/FeeSelector.tsx:72` | `setFeeRate(opt.rate \|\| 1)` | user clicks a fee preset and builds a **1 sat/vB transaction** |
| `src/components/Dashboard/FeeEstimationCard.tsx:88-90` | `fees?.[tier.key] !== undefined` then `Math.round(fees[tier.key] * TYPICAL_VB)` | tooltip reads **"~0 sats for a typical tx"** |

Verified directly: `null !== undefined` is `true`, `Math.round(null * 140)` is `0`,
`null || 1` is `1`.

The first is the worst defect found in this whole effort. A crash is loud and recoverable;
a transaction broadcast at 1 sat/vB because the UI said "High Priority" may sit unconfirmed
indefinitely, with the user's funds locked in it. **Fix that before the programme below** —
it does not need a validation layer, only a guard.

This is the shape of the risk generally: unchecked responses rarely crash. They coerce.
`Math.abs(null)` is `0`, `Number(null)` is `0`, `null || 1` is `1`, and every one of those
renders as a confident number.

## Ranked exposure

Full ranking in the scoping notes; the tiers that drive phasing:

**A — misleads about money or keys.** `/bitcoin/fees`; `/wallets/:id/utxos` (`.utxos.map`
unguarded, and `Number(null)` silently drops a UTXO from coin selection);
`/wallets` (`reduce((a, w) => a + w.balance, 0)` — one null understates the total, one
undefined makes it `NaN`); `POST /transactions/create` (every number on the review screen a
user approves before signing); drafts (`draft.fee.toLocaleString()` — the exact incident
shape, on the signing queue; and `quorum?.m || 1` making a 2-of-3 draft read "1 of 1
signed"); RBF; `validate-xpub` (type declares `valid: true` — it cannot express failure);
wallet import (`${quorum}-of-${totalSigners}`); `/price` (`NaN` passes the `=== null` guard
and every fiat figure in the app renders `NaN`).

**B — crashes or blanks.** Anything reaching `.map`/`.toFixed`/`new Date(` without a guard.

**C — cosmetic.** Labels, flags, display strings. Not worth a schema.

## Design

### Where

One choke point covers the five JSON verbs: `request<T>`'s tail (`client.ts:564-565`).
`upload<T>` repeats it at `client.ts:807-808`. Three paths bypass it and must stay bypassed:
the 204 short-circuit (`client.ts:554-557`, returns `{} as T`), `fetchBlob`, and `download`.

Validation is therefore **opt-in per call**, threaded through the existing options
parameter, not a blanket wrap:

```ts
apiClient.get<FeeEstimates>('/bitcoin/fees', params, retry, { schema: FeeEstimatesSchema })
```

Opt-in matters: 255 call sites cannot be converted at once, and a blanket layer would need
a schema for every endpoint before it could be turned on at all.

### What happens on failure

Follow the precedent this repo already set for untrusted node data —
`server/src/services/bitcoin/electrum/types.ts:85-103` logs a warning with the failing
paths and a body preview, then throws, with the comment *"invalid data shouldn't be
silently used"*. Callers then degrade **the smallest unit**: `sync/phases/fetchUtxos.ts:49-63`
falls back per-address and explicitly declines to record addresses it could not read.

So: **`log.warn` with the zod issue paths, then throw `ApiError`.** Rejecting is right
because a coerced number is worse than an absent one — the whole failure mode above is
silent wrongness, and a throw converts it into something a caller can see.

There is a divergent precedent — `server/src/services/ai/validation.ts:17-30` warns and
returns `null` — but that is for LLM output, where a degraded answer is acceptable. It is
not the model for balances.

### The part that needs work first: failures are currently invisible

A throw is only an improvement if something surfaces it. Today it is not:

- `QueryProvider.tsx:5-24` has **no `onError`, no `QueryCache`, no `MutationCache`**.
- `useDashboardData` destructures `data`/`isLoading` and **discards `isError`** at
  `:81-84`, `:122`, `:146`, `:316` — one exception, `activitySummaryError` at `:140`.
- Every consumer coalesces `undefined` to a benign empty (`?? EMPTY_WALLETS`, `?? EMPTY_TRANSACTIONS`).

The result: **failure is indistinguishable from empty.** A validation throw today would
turn "wrong number" into "confidently empty", which is not obviously better.

`ErrorBoundary` is route-level only (`appRoutes.tsx:69-73`), so a render-time throw blanks
the entire Dashboard route. Nothing sits between the route and the cards.

The precedent to copy is already in the tree — `activitySummaryError` →
`RecentTransactions.tsx:38-55` → "Activity unavailable", whose comment states the rule:

> A failed aggregate must not look like a still-loading one. Loading is transient and
> resolves itself; an error does not, and a permanently bare header reads as "nothing
> happened" rather than "we could not tell".

**Per-card error surfacing is a prerequisite, not a follow-up.**

### Library and its costs

zod is **not** a frontend dependency — root `package.json` carries it only in `overrides`.
It is a real dependency of `shared/`, `server/`, `gateway/`. `src/` → `@sanctuary/shared` is
aliased to **source**, not dist (`vite.config.ts:65`), so importing a zod-bearing shared
module pulls zod into the browser bundle. Today the one frontend touch of `shared/schemas`
is `import type` and erases at compile (`src/api/transactions/types.ts:7`).

Two consequences to decide before Phase 1:

1. **Bundle.** Adding zod to the browser bundle is a deliberate change, not an incidental one.
2. **Coverage.** `shared/**` is inside the frontend 100% gate
   (`vitest.config.ts:37`, thresholds `:76-80`). Every new `shared/schemas/*.ts` needs
   `tests/shared/<name>.test.ts` at 100% branch coverage — for a large response schema that
   is substantial test code per endpoint. The exclude list is frozen by
   `tests/config/coveragePolicy.test.ts:14-41`, so exempting a schema requires editing two
   files in list order and justifying it.

The alternative — hand-written type guards, no dependency — avoids both costs but gives up
composability and good error paths, and diverges from the server's zod convention. **Recommend
zod**, and pay the coverage cost per endpoint, because that cost is proportional to the value:
Tier A endpoints deserve exhaustive tests.

## Phasing

Each phase is independently shippable and independently valuable.

| Phase | Content | Why this order |
| --- | --- | --- |
| **0** | Guard `FeeSelector.tsx:72` and `FeeEstimationCard.tsx:88` | Live money bug. No new dependency, no architecture. Do this now. |
| **1** | Per-card / per-query error surfacing on the Dashboard, following the `activitySummaryError` precedent | Makes a throw meaningful. Without it, validation converts silent-wrong into silent-empty. |
| **2** | `schema` option on `apiClient`, zod as a frontend dependency, one Tier A endpoint (`/bitcoin/fees`) end to end | Proves the mechanism on the endpoint whose failure started this. |
| **3** | Remaining Tier A: utxos, wallets, create-transaction, drafts, price, xpub/import, RBF | The money-and-keys surface. |
| **4** | ~~Tier B where a guard is not already present~~ — **declined**, see decision 7 | Crash-prevention. Loud and contained by the per-route `ErrorBoundary`, so not worth ~40 schemas. |

Tier C is explicitly out of scope. A schema for a label string is cost without benefit.

## Decisions taken

1. **zod, in the frontend bundle.** Measured at **+46,925 bytes** of raw JS tree-shaken for
   one schema — 0.5% of the 9.8MB bundle. Declaring it a direct dependency changed **no**
   resolved versions: it was already in the tree at 4.3.6 via `shared/`.
2. **Pay the 100% coverage cost per schema.** No entries added to the frozen exclude list.
3. **Reject, and let callers degrade the smallest unit** — the server's own precedent for
   untrusted node data (`electrum/types.ts`). Phase 1 made that safe by giving each card an
   honest failure state.
4. **Response schemas strip unknown keys; request schemas stay `.strict()`.** A response
   schema that refused new fields would break the client the moment it lagged a deploy.
5. **Shape, not range.** Schemas check that a field is the type we claim; whether a value is
   *usable* (`usableFeeRate`) stays at the point of use. Policing ranges centrally turns an
   odd-but-readable response into a blanked card.

6. **A cosmetic field may not veto a load-bearing one.** Answered concretely on `/price`:
   `change24h` is a percentage badge and accepts number/null/absent, while `price` — which
   every fiat figure derives from — stays strict. Letting the badge reject the response
   would trade a small wrong thing for a large missing one. Generalise per field, not per
   schema: no separate severity mechanism was needed.

7. **Validate what corrupts silently, not what crashes loudly.** Tier A's endpoints were
   worth schemas because their bad values coerce and spread with no error. Tier B's throw,
   inside a per-route `ErrorBoundary` — loud and contained. Declined as a sweep; see
   *Tier B: declined, on evidence* below.

## Tier A, complete

| endpoint | shipped |
| --- | --- |
| `/bitcoin/fees` | #756 |
| `/wallets`, `/wallets/:id/utxos` | #757 |
| `/transactions/create`, drafts | #759 |
| `/price`, `/wallets/validate-xpub`, RBF | this change |

## Tier B: declined, on evidence

Tier B is **not** being done as a sweep, and this is the seventh recorded decision.

Tier A was chosen for one specific property: those responses corrupt *silently*. A `NaN`
price passes a `=== null` guard and turns every fiat figure in the app into `NaN` with
nothing in the console. `apiWallets ?? []` renders "you have no wallets". Nothing throws,
so nothing tells you.

Tier B is the opposite failure. Its endpoints (`/devices`, `/admin/*`, `/auth/*`,
`/intelligence/*` — roughly 40 calls) are consumed as arrays; a wrong type there throws
`x.map is not a function`. Three facts make that acceptable:

1. **It is loud.** A throw is a stack trace, not a wrong number that looks right.
2. **It is contained.** `renderAppRouteElement` wraps *every* route in its own
   `ErrorBoundary`, so the blast radius is one page showing a fallback — not a white screen.
3. **Most call sites already default.** `const { data: devices = [] } = useDevices()` and
   the 24 `?? []` sites across `src/` cover the common `undefined` case.

Against that, the cost is real and permanent: ~40 schemas, each needing its own test file to
clear the 100% coverage gate, and each becoming a second place the response shape is
written down and can drift from the server.

So the trade Tier B actually buys is "error-boundary fallback" → "honest empty state", for
several thousand lines of forever-maintained code. That is a bad trade. If it ever does
bite, the cheaper structural answer is one array guard in `apiClient`, not forty schemas —
but building that speculatively would be the same mistake in smaller form.

**The schema mechanism stays available.** `ApiGetRequestOptions.schema` is threaded and
tested; adding one to a specific endpoint that misbehaves in the field is a few lines. This
declines the sweep, not the tool.

## Closed out

Tier A shipped across #756, #757, #759 and #760. The test-file split that this work kept
running into landed in #761 — `useDashboardData.test.tsx` went from 994 lines (six short of
the `large-files` cap) to 703, with its mock harness extracted to
`useDashboardDataHarness.ts`.

Nothing in this plan is still open.
