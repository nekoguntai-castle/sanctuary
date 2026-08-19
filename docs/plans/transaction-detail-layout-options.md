# Transaction detail layout — options, trade-offs, recommendation

**Status:** options for decision. Nothing implemented.
**Date:** 2026-08-18
**Requested:** the detail panel beside the transaction list leaves blank space when no
transaction is selected. Candidate directions raised: sub-tabs, a movable modal, or
resolution-dependent layouts.

---

## What is actually there today

Worth stating first, because it changes which options are new work and which are tuning.

`TransactionDetail.tsx` already renders **one** element that behaves two ways, keyed on a
custom `tablet: 900px` breakpoint (`src/index.html:24`, sitting deliberately between
Tailwind's `md` 768 and `lg` 1024):

| Viewport | Behaviour |
|---|---|
| `< 900px` | full-screen modal overlay over the list |
| `>= 900px` | inline pane beside the list, `w-80` (320px), `xl:w-[28rem]` (448px), pinned to the table height, scrolling independently |

Two properties of the current build are deliberate and worth preserving:

- **The details body exists in the DOM exactly once.** The component comments call this out:
  one element rather than a modal *and* a pane means no duplicated accessible content and no
  double data fetch. Any option that renders two copies gives this up.
- **The list is virtualised** (`Virtuoso`, via `TransactionTable`), and the detail pane is
  pinned to the measured `tableHeight`.

**So "different layouts per resolution" is already built.** The blank space is narrower than
the original framing: it is specifically the `>= 900px`, *nothing-selected* state, where an
`<aside>` reserves 320–448px to display the sentence "Select a transaction to see its
details". At a 900px viewport that placeholder is ~35% of the width; at 1280px+, ~35% again
once the pane widens to 448px.

---

## Options

### A. Collapse the pane when nothing is selected

Render no pane until a row is selected; the table spans full width until then.

- **Reclaims** 100% of the wasted space, and most at the 900–1100px range where it hurts most.
- **Smallest diff** — a conditional and a width transition. Keeps the master-detail model,
  its tests, and the single-DOM-copy property.
- **Cost: the table reflows on every select and deselect.** Column widths recompute and the
  row under the cursor can shift out from under the pointer. This is the whole risk of the
  option, and it is a real one on a virtualised table. Mitigations: animate the width, and/or
  fix the table's column template so only the free space changes.

### B. Overlay drawer

The pane slides over the right edge of the list instead of displacing it.

- **No reflow, ever** — the table keeps full width in both states.
- **Cost:** it covers the right-hand columns, which are amount and status — exactly the
  columns being compared. Needs a scrim, an escape affordance, and a decision about whether
  the list stays interactive underneath.

### C. Inline row expansion (accordion)

Detail opens beneath its own row, at full list width.

- **Strongest context** — the detail is visually attached to the transaction it describes,
  and there is no reserved column at any width. Could collapse the phone and desktop paths
  into one behaviour and *delete* code.
- **Cost:** variable-height rows inside `Virtuoso` are materially harder than fixed rows; a
  long detail pushes the rest of the list far down; comparing two transactions gets worse,
  not better.

### D. Sub-tabs (List | Details)

- **Cheapest to build**, zero wasted space.
- **Cost: it is a regression on wide screens.** Side-by-side is the reason the pane exists —
  scanning the list while reading one entry. Tabs remove that, add a navigation step, and on
  a 1440px display render a narrow detail column inside a full-width tab, which trades one
  kind of wasted space for another. Note the `<900px` modal already *is* this pattern, so
  tabs would mostly generalise the small-screen compromise upward.

### E. Floating movable modal

- **Most user control**; can be positioned to compare against any part of the list.
- **Highest cost by a wide margin:** drag, viewport clamping, z-order, position persistence,
  focus trapping, keyboard and screen-reader semantics, plus a separate small-screen path
  regardless. Least certain payoff of the five.

### F. Give the empty pane a job

When nothing is selected, show wallet summary / selected-period stats instead of a
placeholder sentence.

- **No reflow, no new interaction model, smallest UX risk.**
- **Cost:** does not reduce the reserved width — it only stops it being *blank*. Justified
  only if the content genuinely earns 320–448px.

### G. Auto-select the first transaction

Sidestep the problem: the pane is never empty because something is always selected.

- **Near-trivial**, and the reserved space is always doing work.
- **Cost:** fires a detail fetch on every list load, and asserts a selection the user did not
  make (which also means a highlighted row they did not click). Moot for empty wallets.

---

## Recommendation

**Ship A + a breakpoint raise, and treat the rest as follow-ups.**

1. **Collapse when empty (A)**, with an animated width transition so the reflow reads as
   intentional rather than as a jump. This directly answers the stated complaint, is the
   smallest change, and keeps every property the current design was built for.
2. **Raise the side-by-side threshold** from `tablet` (900px) to roughly `lg`/`xl`
   (1024–1280px), so the inline pane only engages where 320px+ can be spared, and the
   existing modal handles everything below. This is the user's "different resolutions"
   idea — refined rather than new, and nearly free because both paths already exist and are
   already tested.

Together these mean: narrow screens get the modal they already get, mid-width screens stop
paying 320px for a placeholder, and wide screens keep true master-detail.

**Against sub-tabs (D) on wide screens** — it discards the side-by-side capability that is
the panel's entire justification. **Defer the floating modal (E)** until there is evidence
people want to reposition it; it is the most expensive option and the least certain.

**Option C is the interesting long shot.** If side-by-side turns out not to be valued, row
expansion is the design that needs no reserved column at any width and could delete a whole
code path. It is worth a prototype *before* committing to A if there is appetite, because
choosing it later means undoing A.

---

## Questions

1. **When you use this screen, do you read one transaction at a time, or compare against the
   list while reading?** This single answer decides between A/B (preserve side-by-side) and
   C/D (abandon it). Everything else follows from it.
2. **What display widths do you actually use?** If it is mostly ≥1440px, the reserved column
   is cheap and F (give it a job) may beat A. If you work at 1280px or on a laptop, A plus
   the breakpoint raise is clearly right.
3. **Is the reflow on select acceptable?** If a table that resizes when you click a row would
   annoy you, that rules out A and points to B.
4. **Should the choice be sticky?** A collapse/expand toggle with a persisted preference is a
   small addition to A, but only worth it if you would use it.
5. **Anything else that deserves that space?** Question 2's answer plus a genuinely useful
   candidate would make F attractive; without one, F is decoration.

---

## Implementation notes (whichever option wins)

- **e2e visual baselines will need regenerating.** `tests/e2e/render-regression.spec.ts-snapshots/`
  holds PNGs that `vitest` cannot see; per CLAUDE.md a green unit run proves nothing here.
  Both 2026-08 dashboard CI failures were in exactly this layer.
- **Frontend coverage is a literal 100% gate** and includes `src/**`, so every new branch
  (breakpoint state, collapsed state, transition callbacks) needs a test in the same PR.
- **Preserve the single-DOM-copy property.** Rendering a modal *and* a pane would duplicate
  accessible content and double-fetch; the current file solves this deliberately.
- **`tableHeight` pinning** is what lets the pane scroll independently. Any option that
  changes the pane's box needs to keep that measurement correct, including during a
  transition.
- Options A, B and F are confined to `TransactionDetail.tsx` and the flex wrapper in
  `TransactionList.tsx:189-193`. Option C reaches into `TransactionTable` and `Virtuoso`
  configuration and is a materially larger change.
