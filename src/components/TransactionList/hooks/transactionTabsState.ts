import { normalizeTxid } from './selectionResolution';

/** The table itself, which is always the first tab and cannot be closed. */
export const LIST_TAB = 'list';

export type TabId = typeof LIST_TAB | string;

export const OPEN_PARAM = 'tx';
export const ACTIVE_PARAM = 'txTab';

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
 * Which tab is showing.
 *
 * An absent `txTab` resolves to the first open transaction rather than to the
 * list, which is what makes a legacy `?tx=<txid>` link land on that
 * transaction's detail. `txTab=list` is how the list tab is addressed
 * explicitly.
 */
export function resolveActiveTab(openTxids: string[], raw: string | null): TabId {
  if (raw === LIST_TAB) return LIST_TAB;
  const requested = raw ? normalizeTxid(raw) : null;
  if (requested && openTxids.includes(requested)) return requested;
  return openTxids[0] ?? LIST_TAB;
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
): TabId {
  if (activeTab !== closedTxid) return activeTab;
  const index = openTxids.indexOf(closedTxid);
  const remaining = openTxids.filter((txid) => txid !== closedTxid);
  if (remaining.length === 0) return LIST_TAB;
  return remaining[Math.min(index, remaining.length - 1)];
}
