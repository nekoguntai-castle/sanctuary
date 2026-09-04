/**
 * Failover-strategy presentations: primary/backup roles resolved only against
 * `operational.pool.servers`, `primaryServerId`, `preferredServerId`, and
 * `nextFailoverServerId` — never from connection counts or the `server`
 * software string.
 */

import type { PoolOperationalStatus } from '../../../api/bitcoin';
import type { NodeStatusBadge, NodeStatusCardModel, NodeStatusSupportItem } from './types';
import { describeServerOrUnknown, buildServerRows, type PoolCounts } from './servers';
import { formatBlockHeight } from './copy';

const UNKNOWN_SERVER = 'unknown';

/** `Preferred pool retry <desc>[ · primary <desc>]`, collapsing when primary === preferred. */
function preferredPrimaryItems(pool: PoolOperationalStatus): NodeStatusSupportItem[] {
  const { primaryServerId, preferredServerId } = pool;
  const collapse = primaryServerId !== null && primaryServerId === preferredServerId;
  const preferredDesc = describeServerOrUnknown(pool, preferredServerId, UNKNOWN_SERVER);

  if (collapse) {
    return [{ key: 'preferred', value: `Preferred pool retry ${preferredDesc}` }];
  }

  return [
    { key: 'preferred', value: `Preferred pool retry ${preferredDesc}` },
    { key: 'primary', value: `primary ${describeServerOrUnknown(pool, primaryServerId, UNKNOWN_SERVER)}` },
  ];
}

/** `Next <desc>` or the honest fallbacks for a missing/absent candidate. */
function nextItem(pool: PoolOperationalStatus): NodeStatusSupportItem {
  if (pool.nextFailoverServerId === null) {
    return { key: 'next', value: 'No further standby' };
  }

  const server = pool.servers.find((candidate) => candidate.serverId === pool.nextFailoverServerId);

  if (!server) {
    return { key: 'next', value: 'Next pool retry unknown' };
  }

  return { key: 'next', value: `Next ${describeServerOrUnknown(pool, server.serverId, UNKNOWN_SERVER)}` };
}

export interface FailoverSuccessModelOptions {
  badges: NodeStatusBadge[];
  pool: PoolOperationalStatus;
  routeServerId: string;
  height: number | undefined;
}

/** Failover pool route succeeded: `route.serverId` answered this attempt. */
export function failoverSuccessModel({
  badges,
  pool,
  routeServerId,
  height,
}: FailoverSuccessModelOptions): NodeStatusCardModel {
  const isPrimary = pool.primaryServerId === routeServerId;
  const usingDesc = describeServerOrUnknown(pool, routeServerId, UNKNOWN_SERVER);
  const next = nextItem(pool);

  const support: NodeStatusSupportItem[] = isPrimary
    ? [{ key: 'using', value: `Using ${usingDesc}` }, next]
    : [
        { key: 'primary', value: `Primary ${describeServerOrUnknown(pool, pool.primaryServerId, UNKNOWN_SERVER)}` },
        { key: 'using', value: `Using ${usingDesc}` },
        next,
      ];

  if (typeof height === 'number') {
    support.push({ key: 'height', value: `height ${formatBlockHeight(height)}` });
  }

  return {
    badges,
    headline: isPrimary ? 'Primary online' : 'Failover active',
    tone: isPrimary ? 'success' : 'warning',
    support,
    detail:
      pool.servers.length > 0
        ? { kind: 'servers', rows: buildServerRows(pool, { roleAware: true, routeServerId }) }
        : { kind: 'none' },
    lastKnown: null,
  };
}

/** Failover pool, `route: null` with >=1 fresh-online candidate: "Status check failed". */
export function failoverStatusCheckFailedModel(
  badges: NodeStatusBadge[],
  pool: PoolOperationalStatus,
  counts: PoolCounts,
): NodeStatusCardModel {
  const support: NodeStatusSupportItem[] = [
    { key: 'recently-online', value: `${counts.online} recently online` },
    { key: 'no-answer', value: 'no server answered' },
    ...preferredPrimaryItems(pool),
  ];

  return {
    badges,
    headline: 'Status check failed',
    tone: 'warning',
    support,
    detail:
      pool.servers.length > 0
        ? { kind: 'servers', rows: buildServerRows(pool, { roleAware: false, routeServerId: null }) }
        : { kind: 'none' },
    lastKnown: null,
  };
}

/** Failover pool, `route: null`, no fresh-online candidate. */
export function failoverRouteNullModel(
  badges: NodeStatusBadge[],
  pool: PoolOperationalStatus,
  counts: PoolCounts,
): NodeStatusCardModel {
  const headline = counts.unknown > 0 ? 'Failover health unknown' : 'No server available';
  const support: NodeStatusSupportItem[] = [...preferredPrimaryItems(pool), { key: 'no-answer', value: 'no server answered', tone: 'warning' }];

  return {
    badges,
    headline,
    tone: 'warning',
    support,
    detail:
      pool.servers.length > 0
        ? { kind: 'servers', rows: buildServerRows(pool, { roleAware: false, routeServerId: null }) }
        : { kind: 'none' },
    lastKnown: null,
  };
}
