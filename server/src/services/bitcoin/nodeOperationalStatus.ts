/**
 * Node Operational Status — pure projection types and projector.
 *
 * This module owns the `NodeOperationalStatus` DTO contract shared with the
 * OpenAPI schema (`server/src/api/openapi/schemas/bitcoin.ts`) and the
 * frontend (`src/api/bitcoin.ts`). Names here are fixed by that contract —
 * do not rename without updating both mirrors.
 *
 * `projectNodeOperationalStatus` is intentionally pure: no I/O, no
 * `Date.now()`, no repository/pool access. Everything it needs — the
 * evaluation instant, the topology, the route observation, and the
 * side-effect-free failover role IDs — is captured by the caller into one
 * immutable snapshot before calling in, so a concurrent health transition
 * cannot produce internally inconsistent counts/roles.
 */

import type { NodePoolLoadBalancing } from '@sanctuary/shared/constants/nodeConfig';
import {
  SERVER_AVAILABILITY_VALUES,
  POOL_FALLBACK_REASON_VALUES,
} from '@sanctuary/shared/types/nodeOperationalStatus';
import type {
  ServerAvailability,
  PoolFallbackReason,
  NodeRouteObservation,
  OperationalServer,
  PoolOperationalStatus,
  NodeOperationalStatus,
} from '@sanctuary/shared/types/nodeOperationalStatus';

export {
  SERVER_AVAILABILITY_VALUES,
  POOL_FALLBACK_REASON_VALUES,
};
export type {
  ServerAvailability,
  PoolFallbackReason,
  NodeRouteObservation,
  OperationalServer,
  PoolOperationalStatus,
  NodeOperationalStatus,
};

/**
 * The freshness window a completed health check must fall within to count as
 * `online`/`offline` rather than `stale`. Derived from the pool's configured
 * `healthCheckIntervalMs` (never a hardcoded default or the frontend's poll
 * interval) plus a fixed grace period to absorb one missed/late check cycle.
 */
export const HEALTH_CHECK_FRESHNESS_GRACE_MS = 5000;

export function healthCheckFreshnessWindowMs(healthCheckIntervalMs: number): number {
  return healthCheckIntervalMs * 2 + HEALTH_CHECK_FRESHNESS_GRACE_MS;
}

/** One server's live topology + health input, already filtered to enabled/general-pool-eligible/canonically-ordered. */
export interface OperationalServerInput {
  serverId: string;
  label: string;
  host: string;
  port: number;
  priority: number;
  isHealthy: boolean;
  lastHealthCheck: Date | string | null;
  cooldownUntil: Date | string | null;
}

/**
 * Everything the projector needs, captured atomically by the caller before
 * invocation. `primaryServerId` and `preferredServerId` come from the pool's
 * side-effect-free failover snapshot; `nextAfter` is that same snapshot's
 * `nextAfter(serverId)` closure (also side-effect-free) — the projector never
 * reimplements failover eligibility rules itself.
 */
export interface NodeOperationalStatusSnapshot {
  now: number;
  configuredMode: 'singleton' | 'pool';
  attemptedAt: string;
  route: NodeRouteObservation | null;
  strategy: NodePoolLoadBalancing | null;
  servers: OperationalServerInput[];
  healthCheckIntervalMs: number;
  primaryServerId: string | null;
  preferredServerId: string | null;
  nextAfter: ((excludeServerId: string) => string | null) | null;
}

function toEpochMs(value: Date | string | null): number | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function toIso(value: Date | string | null): string | null {
  const ms = toEpochMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function deriveAvailability(
  server: OperationalServerInput,
  snapshot: NodeOperationalStatusSnapshot,
  freshnessWindowMs: number,
): ServerAvailability {
  if (snapshot.route?.transport === 'pool' && snapshot.route.serverId === server.serverId) {
    return 'online';
  }

  const cooldownUntilMs = toEpochMs(server.cooldownUntil);
  if (cooldownUntilMs !== null && cooldownUntilMs > snapshot.now) {
    return 'cooldown';
  }

  const lastCheckMs = toEpochMs(server.lastHealthCheck);
  if (lastCheckMs === null) {
    return 'unchecked';
  }

  if (snapshot.now - lastCheckMs > freshnessWindowMs) {
    return 'stale';
  }

  return server.isHealthy ? 'online' : 'offline';
}

function projectServer(
  server: OperationalServerInput,
  snapshot: NodeOperationalStatusSnapshot,
  freshnessWindowMs: number,
): OperationalServer {
  const availability = deriveAvailability(server, snapshot, freshnessWindowMs);
  const checkedAt =
    availability === 'online' && snapshot.route?.transport === 'pool' && snapshot.route.serverId === server.serverId
      ? snapshot.route.observedAt
      : toIso(server.lastHealthCheck);

  return {
    serverId: server.serverId,
    label: server.label,
    host: server.host,
    port: server.port,
    priority: server.priority,
    availability,
    checkedAt,
  };
}

const FAILOVER_STRATEGY: NodePoolLoadBalancing = 'failover_only';

function buildPoolStatus(snapshot: NodeOperationalStatusSnapshot): PoolOperationalStatus | null {
  if (snapshot.configuredMode !== 'pool' || snapshot.strategy === null) {
    return null;
  }

  const freshnessWindowMs = healthCheckFreshnessWindowMs(snapshot.healthCheckIntervalMs);
  const servers = snapshot.servers.map((server) => projectServer(server, snapshot, freshnessWindowMs));

  const counts = { online: 0, offline: 0, cooldown: 0, unchecked: 0, stale: 0 };
  for (const server of servers) {
    counts[server.availability]++;
  }

  const isFailover = snapshot.strategy === FAILOVER_STRATEGY;
  const primaryServerId = isFailover ? snapshot.primaryServerId : null;
  const preferredServerId = isFailover ? snapshot.preferredServerId : null;

  let nextFailoverServerId: string | null = null;
  if (isFailover && snapshot.route?.transport === 'pool' && snapshot.nextAfter) {
    nextFailoverServerId = snapshot.nextAfter(snapshot.route.serverId);
  }

  return {
    strategy: snapshot.strategy,
    online: counts.online,
    offline: counts.offline,
    cooldown: counts.cooldown,
    unchecked: counts.unchecked,
    stale: counts.stale,
    primaryServerId,
    preferredServerId,
    nextFailoverServerId,
    servers,
  };
}

/**
 * Pure projector: combine mode, configured priority, live pool stats,
 * freshness, route observation, and transport into one `NodeOperationalStatus`.
 */
export function projectNodeOperationalStatus(snapshot: NodeOperationalStatusSnapshot): NodeOperationalStatus {
  return {
    configuredMode: snapshot.configuredMode,
    attemptedAt: snapshot.attemptedAt,
    route: snapshot.route,
    pool: buildPoolStatus(snapshot),
  };
}
