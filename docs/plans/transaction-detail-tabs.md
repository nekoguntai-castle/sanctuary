# Transaction detail: sub-tabs, detachable panels, compact stats header

Status: proposed (2026-08-19)
Owner: frontend
Supersedes: the side-by-side pane (#832 inline-expand follow-up) in `TransactionList`

## Problem

v0.8.64 shows a selected transaction either in a 448px pane beside the table
(`SIDE_BY_SIDE_DETAIL_QUERY`, ≥1536px) or expanded inline under its own row
below that width. Both forms are wrong for the way the view is actually used:

- Only one transaction can be open. Comparing two transactions means clicking
  back and forth and losing scroll position and any in-progress label edit.
- The pane steals width from the table at exactly the resolutions where the
  table needs it; the inline expansion pushes the surrounding rows out of view.
- The seven-tile statistics header wraps to three or four rows on a laptop,
  so the table starts below the fold before a single row is read.

## Shape of the solution

1. **Sub-tabs.** One tab strip inside the Transactions tab. Tab 1 is pinned and
   holds the table; every opened transaction adds a closable tab after it.
   The active tab owns the full content width.
2. **Detach.** Any transaction tab can be popped out into a floating, draggable,
   resizable in-app panel so it can sit next to the list — no browser popup, no
   `window.open`, so theme, app state and drag-back all keep working.
3. **Re-dock.** Dragging a floating panel over the tab strip docks it back as a
   tab. A keyboard-reachable Dock button does the same thing.
4. **Compact stats header** at narrow container widths.

Decisions confirmed with the requester: list-is-tab-1 (not a permanently pinned
table above the strip), and in-app floating panels (not real OS windows).

## State model

### Tab set

```
open:   string[]   // txids, in tab order      (URL: ?tx=a,b,c)
active: 'list' | txid                          (URL: ?txTab=)
floating: Set<txid>                            (URL: ?txWin=b)
geometry: Record<txid, {x,y,w,h}>              (sessionStorage, per wallet)
```

- `?tx=` stays the deep-link parameter it is today; it just accepts a
  comma-separated list. An existing single-txid link keeps working: when
  `txTab` is absent the first open txid is active, so `?tx=<txid>` still lands
  on that transaction's detail.
- Selecting the list tab writes `txTab=list`. Closing the last tab drops both
  params.
- An invalid or not-found txid is dropped from `tx` (today's
  `removeExpectedTxParam` self-heal, generalised to a list member).
- Geometry stays out of the URL — a shared link should reproduce *what* is
  open, not where someone dragged a panel.

### Per-tab resolution

`useTransactionSelection` is a single-slot resolver: one abort controller, one
generation counter, one label-mutation binding. Rather than turn it into a map
keyed by txid (which multiplies every race it already handles), invert it:

- extract **`useTransactionResolution(txid, walletId, selectionTransactions)`**
  — the existing machinery with the URL coupling removed, resolving exactly one
  txid;
- add **`useTransactionTabs()`** — owns the URL params above, exposes
  `open/close/activate/detach/dock/reorder`;
- render one `TransactionDetailPanel` per open tab, each running its own
  resolution hook and its own `useTransactionLabelMutations`.

That makes the N-slot behaviour structural: a panel is mounted or it isn't, and
a late response can only reach the panel that asked for it. It also fixes a
latent bug — today a label edit started on one transaction and a switch to
another share one mutation slot.

All open panels stay mounted; inactive docked ones are hidden with the `hidden`
attribute rather than unmounted, so switching tabs preserves scroll position
and in-progress label edits. N is user-bounded and small.

## Components

| File | Role |
| --- | --- |
| `TransactionTabStrip.tsx` | `role="tablist"`, pinned list tab + closable tx tabs, drop target for re-dock |
| `TransactionTab.tsx` | one tab: label (`Sent 0.01 BTC · a1b2…c3`), close ×, detach ⤢ |
| `TransactionDetailPanel.tsx` | resolution + label mutations + `TransactionDetailsHeader/Body`, docked or floating |
| `FloatingPanel.tsx` (`src/components/ui/`) | generic portal panel: drag header, resize corner, viewport clamping, focus trap-free but focus-restoring |
| `useTransactionTabs.ts` | URL-backed tab state |
| `useTransactionResolution.ts` | single-txid resolution extracted from `useTransactionSelection` |
| `useFloatingGeometry.ts` | position/size persistence + clamping on resize |

Deleted: the `showPane`/`expandInline` fork in `TransactionList.tsx`,
`TransactionDetail.tsx`'s pane/modal shell, `expandedTxId` and
`renderExpandedDetail` in `TransactionTable.tsx`, and
`SIDE_BY_SIDE_DETAIL_QUERY` in `useMediaQuery.ts`.

`TransactionDetailsHeader` and `TransactionDetailsBody` are unchanged — they are
already form-factor agnostic, which is what makes this a shell swap.

## Interaction detail

- **Open**: clicking a row opens (or activates, if already open) its tab. A
  modifier-click (⌘/Ctrl) opens it in the background without switching.
- **Close**: × on the tab, `Ctrl+W`-free (browser owns that), middle-click also
  closes. Closing the active tab activates its right neighbour, else the list.
- **Detach**: ⤢ on the tab, or drag the tab off the strip. The panel appears
  centred-ish, offset per already-floating panel so they don't stack exactly.
- **Dock**: drag the panel header onto the strip (highlighted drop zone), or the
  panel's Dock button.
- **Drag** uses `@dnd-kit/core` — already a dependency (`DraggableColumnItem`).
  One `DndContext` covers the strip (droppable) and floating panel headers
  (draggable); drag end either applies the delta to stored geometry or docks.
- **Keyboard/a11y**: reuse `src/components/ui/useTabsA11y.ts` for arrow-key
  navigation. The close button is a *sibling* of the `role="tab"` element, not
  a child — nested interactive content breaks both a11y and that hook's
  `[role="tab"][data-tab-value]` lookup. Floating panels get
  `role="dialog" aria-label="Transaction a1b2…c3"`, are not modal, and move by
  keyboard via arrow keys while the header has focus.
- **Small screens**: below `tablet` the detach affordance is hidden and the
  strip scrolls horizontally (`overflow-x-auto`, snap). A floating panel that
  survives a resize below that width is auto-docked rather than left offscreen.

## Compact statistics header

`TransactionStatsGrid` currently uses an inline
`repeat(auto-fit, minmax(9rem, 1fr))`. Seven tiles at 9rem wrap to 4 rows around
1100px of container width.

Constraint: `src/index.html` loads the **Tailwind CDN build**, whose JIT emits
arbitrary utilities *after* first paint, so `grid-cols-[…]`, `@container` and
friends cannot carry layout that must be right on the first frame. That is why
the current template is an inline style, and the fix has to stay inline too.

Approach: measure the grid's own width with a `ResizeObserver` (the pattern
`TransactionList` already uses for table height) and switch between two tile
densities — container-accurate, so it behaves correctly both full-width on the
wallet route and inside a narrower column:

- ≥ 640px container: today's tiles (`px-3 py-2`, `text-lg` value).
- < 640px container: `px-2 py-1.5`, `text-[10px]` label, `text-base` value,
  `minmax(6.5rem, 1fr)` — two rows instead of four, roughly 40% less height.

Icons stay; only the box shrinks. No named-size substitution for the
`text-[10px]`/`text-[11px]` compact sizes (project rule).

## Test plan

The repo gates frontend coverage at 100%, so every new file ships with tests in
the same PR.

- `useTransactionTabs`: open/activate/close/reorder, close-active-neighbour
  rule, dedupe on re-open, legacy single `?tx=` deep link, invalid txid pruning,
  empty-list param cleanup. Reordering rewrites `?tx=` order, so a reordered
  strip survives a reload and is what a shared link reproduces.
- `useTransactionResolution`: the existing `useTransactionSelection` suites
  re-pointed, plus two panels resolving concurrently without cross-talk.
- `FloatingPanel`: drag delta, resize, viewport clamping, geometry persistence,
  keyboard move, auto-dock on narrow resize.
- `TransactionTabStrip`: a11y roles, arrow-key nav, close button is not nested
  in the tab, drop-to-dock.
- Update `tests/components/TransactionList.test.tsx` and
  `TransactionList.branches.test.tsx` — both assert on
  `transaction-detail-pane` / `transaction-detail-expansion`.
- `tests/hooks/useMediaQuery.test.ts` loses its `SIDE_BY_SIDE_DETAIL_QUERY` case.
- E2E: any new endpoint is not introduced, so the mock maps are untouched, but
  `tests/e2e/render-regression.spec.ts-snapshots/` baselines covering wallet
  detail **will** change and must be regenerated (build + static-serve `dist/`
  + a throwaway Playwright config with no `webServer`, per CLAUDE.md).
- `tests/config/themeClassPolicy.test.ts` will police the new palette classes.

## Phasing (one PR each)

1. **Tabs.** Tab model, strip, panel, removal of pane/inline-expand. Ships
   complete on its own; multi-open and close already work.
2. **Detach.** `FloatingPanel`, detach/dock buttons, geometry persistence.
3. **Drag.** dnd-kit drag-to-move, drag-to-dock, and tab reordering within the
   strip (`@dnd-kit/sortable`, the `DraggableColumnItem` pattern). Reorder is in
   scope, not a follow-up: order is already the `?tx=` list order, so the strip
   only needs the sortable wiring and a keyboard reorder path.
4. **Stats header.** Independent of 1–3; can land first if a quick win is
   wanted.

## Risks

- **Virtuoso interplay** is *reduced*, not added to: the expanded-row component
  map and its remount-on-identity-change hazard go away entirely.
- **Coverage**: floating-panel pointer maths is the awkward part to cover;
  keeping geometry in a pure `useFloatingGeometry`/clamp module keeps the
  branchy code testable without synthesising drag gestures.
- **Concurrent detail fetches**: one per open tab on mount. Bounded by the
  number of tabs a person opens; no polling.
- **Other agents are active in this repo.** Phase 1 touches
  `src/components/TransactionList/**` and `src/hooks/useMediaQuery.ts` only;
  rebase before each PR and keep the phases small.
