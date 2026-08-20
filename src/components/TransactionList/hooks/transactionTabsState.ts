import { normalizeTxid } from './selectionResolution';

/** The table itself, which is always the first tab and cannot be closed. */
export const LIST_TAB = 'list';

export type TabId = typeof LIST_TAB | string;

export const OPEN_PARAM = 'tx';
export const ACTIVE_PARAM = 'txTab';
export const FLOATING_PARAM = 'txWin';

/**
 * Tabs are URL state, so the count is whatever someone pastes. Each open tab
 * mounts a panel that fetches its transaction, so an unbounded list is an
 * unbounded fan-out of requests on a single navigation. Twelve is far past what
 * a person opens by hand and far short of a burst worth worrying about.
 */
export const MAX_OPEN_TABS = 12;

/**
 * Read the open tabs out of `?tx=`.
 *
 * Historically `tx` held exactly one txid, and single-transaction deep links
 * are still handed around, so a bare `?tx=<txid>` has to keep meaning "open
 * this one". A list is the same parameter with commas.
 *
 * Blank entries and repeats are dropped rather than rejected: the URL is user
 * input, and a duplicate should focus the tab that is already open, not open a
 * second identical one.
 */
export function parseOpenTxids(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const txid = normalizeTxid(entry);
    if (txid) seen.add(txid);
    if (seen.size === MAX_OPEN_TABS) break;
  }
  return [...seen];
}

export function serializeOpenTxids(txids: string[]): string {
  return txids.join(',');
}

/**
 * Which transactions are floating rather than docked in the strip.
 *
 * Scoped to what is open, so a `txWin` naming a transaction that is not in `tx`
 * is ignored rather than conjuring a panel with no tab behind it. Detachment is
 * in the URL — a reload should put the panels back — while where each one sits
 * is not: a shared link should reproduce what is open, not where someone
 * dragged it.
 */
export function parseFloatingTxids(raw: string | null, openTxids: string[]): string[] {
  if (!raw) return [];
  const open = new Set(openTxids);
  const floating = new Set<string>();
  for (const entry of raw.split(',')) {
    const txid = normalizeTxid(entry);
    if (open.has(txid)) floating.add(txid);
  }
  // Kept in the order `txWin` gives, not the order the tabs opened in: that
  // order is the panels' stacking order, and raising one rewrites it.
  return [...floating];
}

/**
 * Which tab is showing in the strip.
 *
 * An absent `txTab` resolves to the first docked transaction rather than to the
 * list, which is what makes a legacy `?tx=<txid>` link land on that
 * transaction's detail. `txTab=list` is how the list tab is addressed
 * explicitly.
 *
 * A floating transaction is never the active tab: its panel is already on
 * screen, so selecting its tab would show the same thing twice and leave the
 * strip pointing at a panel that is not in it.
 */
export function resolveActiveTab(
  openTxids: string[],
  raw: string | null,
  floatingTxids: string[] = [],
): TabId {
  if (raw === LIST_TAB) return LIST_TAB;
  const floating = new Set(floatingTxids);
  const docked = openTxids.filter((txid) => !floating.has(txid));
  const requested = raw ? normalizeTxid(raw) : null;
  if (requested && docked.includes(requested)) return requested;
  return docked[0] ?? LIST_TAB;
}

/**
 * Where focus lands when the active tab closes: its right neighbour, else its
 * left, else the list. Matches how tabbed editors behave, and never leaves the
 * user staring at the tab furthest from what they were reading.
 */
export function nextActiveAfterClose(
  openTxids: string[],
  closedTxid: string,
  activeTab: TabId,
  floatingTxids: string[] = [],
): TabId {
  if (activeTab !== closedTxid) return activeTab;
  const floating = new Set(floatingTxids);
  const index = openTxids.indexOf(closedTxid);
  // Only docked tabs are candidates — a floating panel is already on screen.
  const remaining = openTxids.filter(
    (txid) => txid !== closedTxid && !floating.has(txid),
  );
  if (remaining.length === 0) return LIST_TAB;
  const neighbour = openTxids
    .slice(index + 1)
    .find((txid) => remaining.includes(txid));
  return neighbour ?? remaining[remaining.length - 1];
}

/**
 * Move one tab to the position of another — the drop result of dragging a tab
 * across the strip.
 *
 * Order is the `?tx` list order, so a reorder is a rewrite of that parameter and
 * survives a reload like every other tab state.
 */
export function reorderTxids(openTxids: string[], fromTxid: string, toTxid: string): string[] {
  const from = openTxids.indexOf(fromTxid);
  const to = openTxids.indexOf(toTxid);
  if (from === -1 || to === -1 || from === to) return openTxids;
  const next = [...openTxids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * Move a tab one place left or right, for the keyboard path. Reordering must not
 * be pointer-only, and the arrow keys alone already move *selection* — so this
 * is the modified chord, and a tab at the end of the strip simply stays put.
 */
export function nudgeTxid(
  openTxids: string[],
  txid: string,
  direction: -1 | 1,
): string[] {
  const from = openTxids.indexOf(txid);
  if (from === -1) return openTxids;
  const to = from + direction;
  if (to < 0 || to >= openTxids.length) return openTxids;
  return reorderTxids(openTxids, txid, openTxids[to]);
}
