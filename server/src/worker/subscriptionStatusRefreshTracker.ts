/**
 * Per-network bookkeeping for the periodic subscription status refresh: the
 * round-robin page cursor, page outcome metrics, and the completed-pass
 * timestamp. A pass only counts as complete when every page in it was actually
 * refreshed, so a pass that ran through a disconnected network or a lost
 * ownership does not make the backstop look healthy.
 */

import {
  recordSubscriptionStatusRefreshCycleCompleted,
  recordSubscriptionStatusRefreshPage,
} from '../observability/metrics/subscriptionStatusMetrics';
import type {
  BitcoinNetwork,
  SubscriptionStatusRefreshPageOutcome,
} from './electrumManager/types';

export interface SubscriptionStatusRefreshPageResult {
  scanned: number;
  nextCursor?: string;
  outcome: SubscriptionStatusRefreshPageOutcome;
}

export function createSubscriptionStatusRefreshTracker(
  pageSize: number,
  now: () => number = Date.now,
) {
  const cursors = new Map<BitcoinNetwork, string>();
  const incompleteCycles = new Set<BitcoinNetwork>();

  return {
    cursorFor(network: BitcoinNetwork): string | undefined {
      return cursors.get(network);
    },

    recordPage(network: BitcoinNetwork, result: SubscriptionStatusRefreshPageResult): void {
      recordSubscriptionStatusRefreshPage(network, result.outcome);
      if (result.outcome !== 'refreshed') incompleteCycles.add(network);
      if (result.scanned === pageSize && result.nextCursor) {
        cursors.set(network, result.nextCursor);
        return;
      }
      cursors.delete(network);
      // The cursor wrapped: this page was the last of the pass.
      if (!incompleteCycles.delete(network)) {
        recordSubscriptionStatusRefreshCycleCompleted(network, now());
      }
    },

    /** A failed page is retried from the same cursor and taints the current pass. */
    recordFailure(network: BitcoinNetwork): void {
      recordSubscriptionStatusRefreshPage(network, 'failed');
      incompleteCycles.add(network);
    },

    clear(): void {
      cursors.clear();
      incompleteCycles.clear();
    },
  };
}
