/**
 * Balanced (round-robin / least-connections) pool presentations.
 */

import type { PoolOperationalStatus } from '../../../api/bitcoin';
import type { NodeStatusBadge, NodeStatusCardModel, NodeStatusSupportItem } from './types';
import { buildServerRows, countPool, type PoolCounts } from './servers';
import { formatBlockHeight } from './copy';

function guidanceForCounts(counts: PoolCounts): string | undefined {
  return counts.unavailable > 0 || counts.unknown > 0
    ? 'Open Admin → Node Config to review server health.'
    : undefined;
}

function supportForOnline(strategyText: string | null, height: number | undefined): NodeStatusSupportItem[] {
  const parts: NodeStatusSupportItem[] = [];

  if (strategyText) {
    parts.push({ key: 'strategy', value: strategyText });
  }

  if (typeof height === 'number') {
    parts.push({ key: 'height', value: `height ${formatBlockHeight(height)}` });
  }

  return parts;
}

function supportForMixed(counts: PoolCounts): NodeStatusSupportItem[] {
  const parts: NodeStatusSupportItem[] = [];

  if (counts.unavailable > 0) {
    parts.push({ key: 'unavailable', value: `${counts.unavailable} unavailable`, tone: 'warning' });
  }

  if (counts.unknown > 0) {
    parts.push({ key: 'unknown', value: `${counts.unknown} unknown`, tone: 'warning' });
  }

  return parts;
}

export interface BalancedSuccessModelOptions {
  badges: NodeStatusBadge[];
  pool: PoolOperationalStatus;
  strategyText: string | null;
  height: number | undefined;
}

/** Route succeeded on a balanced pool server: online is always >= 1. */
export function balancedSuccessModel({
  badges,
  pool,
  strategyText,
  height,
}: BalancedSuccessModelOptions): NodeStatusCardModel {
  const counts = countPool(pool);
  const allOnline = counts.online === counts.total;

  return {
    badges,
    headline: `${counts.online} of ${counts.total} online`,
    tone: allOnline ? 'success' : 'warning',
    support: allOnline ? supportForOnline(strategyText, height) : supportForMixed(counts),
    detail:
      pool.servers.length > 0
        ? { kind: 'servers', rows: buildServerRows(pool, { roleAware: false, routeServerId: null }), guidance: guidanceForCounts(counts) }
        : { kind: 'none' },
    lastKnown: null,
  };
}

/** Balanced pool, `route: null` but >=1 fresh-online server evidence. */
export function balancedStatusCheckFailedModel(
  badges: NodeStatusBadge[],
  pool: PoolOperationalStatus,
  counts: PoolCounts,
): NodeStatusCardModel {
  const rows = pool.servers.length > 0 ? buildServerRows(pool, { roleAware: false, routeServerId: null }) : [];

  return {
    badges,
    headline: 'Status check failed',
    tone: 'warning',
    support: [
      { key: 'recently-online', value: `${counts.online} recently online` },
      { key: 'no-answer', value: 'no server answered' },
    ],
    detail: rows.length > 0 ? { kind: 'servers', rows } : { kind: 'none' },
    lastKnown: null,
  };
}

/** Balanced pool, `route: null` (no server answered this attempt). */
export function balancedRouteNullModel(badges: NodeStatusBadge[], pool: PoolOperationalStatus): NodeStatusCardModel {
  const counts = countPool(pool);
  const rows = pool.servers.length > 0 ? buildServerRows(pool, { roleAware: false, routeServerId: null }) : [];

  if (counts.unknown > 0) {
    return {
      badges,
      headline: 'Health unknown',
      tone: 'warning',
      support: [
        { key: 'no-answer', value: 'No server answered', tone: 'warning' },
        { key: 'unavailable', value: `${counts.unavailable} unavailable`, tone: 'warning' },
        { key: 'unknown', value: `${counts.unknown} unknown`, tone: 'warning' },
      ],
      detail: rows.length > 0 ? { kind: 'servers', rows, guidance: guidanceForCounts(counts) } : { kind: 'none' },
      lastKnown: null,
    };
  }

  return {
    badges,
    headline: `0 of ${counts.total} online`,
    tone: 'error',
    support: [{ key: 'offline', value: `${counts.total} offline · no server answered`, tone: 'error' }],
    detail: rows.length > 0 ? { kind: 'servers', rows, guidance: guidanceForCounts(counts) } : { kind: 'none' },
    lastKnown: null,
  };
}
