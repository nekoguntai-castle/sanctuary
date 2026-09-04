/**
 * Pool server lookup, availability counting, and row projection.
 *
 * Balanced counts and the failover role labels must never be derived from
 * `activeConnections`/`totalConnections` or the `server` version string; every
 * helper here reads only `operational.pool`.
 */

import type { OperationalServer, PoolOperationalStatus } from '../../../api/bitcoin';
import { availabilityText, availabilityTone } from './copy';
import type { NodeStatusServerRole, NodeStatusServerRow } from './types';

export interface PoolCounts {
  online: number;
  offline: number;
  cooldown: number;
  unchecked: number;
  stale: number;
  total: number;
  /** offline + cooldown */
  unavailable: number;
  /** unchecked + stale */
  unknown: number;
  /** True only when the five exact counts sum to `servers.length`. */
  valid: boolean;
}

export function countPool(pool: PoolOperationalStatus): PoolCounts {
  const { online, offline, cooldown, unchecked, stale, servers } = pool;
  const total = servers.length;
  const sum = online + offline + cooldown + unchecked + stale;

  return {
    online,
    offline,
    cooldown,
    unchecked,
    stale,
    total,
    unavailable: offline + cooldown,
    unknown: unchecked + stale,
    valid: sum === total,
  };
}

export function findServer(pool: PoolOperationalStatus | null, id: string | null): OperationalServer | null {
  if (!pool || !id) {
    return null;
  }

  return pool.servers.find((server) => server.serverId === id) ?? null;
}

/** `<label> · <availability>` for a resolved server, or an honest unknown fallback. */
export function describeServerOrUnknown(
  pool: PoolOperationalStatus | null,
  id: string | null,
  unknownText: string,
): string {
  const server = findServer(pool, id);

  if (!server) {
    return unknownText;
  }

  return `${server.label} · ${availabilityText(server.availability)}`;
}

function roleFor(
  server: OperationalServer,
  routeServerId: string | null,
  primaryId: string | null,
  nextId: string | null,
): NodeStatusServerRole {
  if (routeServerId && server.serverId === routeServerId) {
    return 'In use';
  }

  if (primaryId && server.serverId === primaryId) {
    return 'Primary';
  }

  if (nextId && server.serverId === nextId) {
    return 'Next';
  }

  return 'Standby';
}

/**
 * Server disclosure rows. `roleAware` controls whether Primary/In use/Next
 * roles are computed (failover) or every role is null (balanced strategies).
 */
export function buildServerRows(
  pool: PoolOperationalStatus,
  options: { roleAware: boolean; routeServerId: string | null },
): NodeStatusServerRow[] {
  return pool.servers.map((server) => ({
    serverId: server.serverId,
    label: server.label,
    host: server.host,
    port: server.port,
    role: options.roleAware
      ? roleFor(server, options.routeServerId, pool.primaryServerId, pool.nextFailoverServerId)
      : null,
    availability: availabilityText(server.availability),
    tone: availabilityTone(server.availability),
  }));
}
