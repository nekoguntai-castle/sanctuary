/**
 * Topology helpers for the status projector: filter the configured servers
 * for a network down to the general-pool-eligible set, in canonical order,
 * and expose side-effect-free failover role lookups over that same set —
 * reusing the phase A1/A2 pure selector helpers rather than reimplementing
 * eligibility rules here.
 */

import { serverUsageMatchesPool } from '../electrum/capabilities';
import { compareServerOrder, sortServersCanonically, selectFailoverServer } from '../electrumPool/serverSelector';
import type { ServerConfig, ServerState } from '../electrumPool/types';
import type { NetworkType } from '../electrumPool';
import type { OperationalServerInput } from '../nodeOperationalStatus';

/** Live health/backoff input for one server, as read from the pool at status time. */
export interface LiveServerStats {
  isHealthy: boolean;
  lastHealthCheck: Date | null;
  cooldownUntil: Date | null;
  consecutiveFailures?: number;
}

export interface ConfiguredServerRow {
  id: string;
  label: string;
  host: string;
  port: number;
  network: string;
  enabled: boolean;
  priority?: number | null;
  lastHealthCheck?: Date | string | null;
  isHealthy?: boolean | null;
  serverUsage?: string | null;
  supportsVerbose?: boolean | null;
  supportsSilentPaymentsV0?: boolean | null;
  lastCapabilityCheck?: Date | string | null;
  lastCapabilityError?: string | null;
}

/** General-pool-eligible, enabled, same-network servers in canonical (priority, id) order. */
export function eligibleServersFor(
  servers: ConfiguredServerRow[] | undefined,
  network: NetworkType,
): ConfiguredServerRow[] {
  const filtered = (servers ?? []).filter(
    (server) => server.enabled && server.network === network && serverUsageMatchesPool(server.serverUsage, 'general'),
  );
  return [...filtered].sort((a, b) =>
    compareServerOrder({ id: a.id, priority: a.priority ?? 0 }, { id: b.id, priority: b.priority ?? 0 }),
  );
}

export function toOperationalServerInputs(
  servers: ConfiguredServerRow[],
  liveStats: Map<string, LiveServerStats>,
): OperationalServerInput[] {
  return servers.map((server) => {
    const live = liveStats.get(server.id);
    return {
      serverId: server.id,
      label: server.label,
      host: server.host,
      port: server.port,
      priority: server.priority ?? 0,
      isHealthy: live ? live.isHealthy : (server.isHealthy ?? false),
      lastHealthCheck: live ? live.lastHealthCheck : (server.lastHealthCheck ?? null),
      cooldownUntil: live ? live.cooldownUntil : null,
    };
  });
}

function toServerConfig(servers: ConfiguredServerRow[]): ServerConfig[] {
  return servers.map((server) => ({
    id: server.id,
    label: server.label,
    host: server.host,
    port: server.port,
    useSsl: false,
    priority: server.priority ?? 0,
    enabled: true,
  }));
}

/**
 * Build the `ServerState` map the pure selector helpers expect.
 *
 * A server with no live probe result AND no persisted *completed* health
 * check must NOT get a synthesized `isHealthy:false` entry: the selector's
 * `isServerAvailable` treats a missing map entry as available (matching
 * `createDefaultServerState()`'s `isHealthy: true` default), so fabricating
 * `false` here would make a merely never-checked server ineligible for
 * failover preference — a stronger, wrong claim than the DTO's `unchecked`
 * availability state. Only a persisted completed check (a non-null
 * `lastHealthCheck` together with a boolean `isHealthy`) earns a map entry
 * when there is no live evidence.
 */
function toServerStateMap(
  servers: ConfiguredServerRow[],
  liveStats: Map<string, LiveServerStats>,
): Map<string, ServerState> {
  const map = new Map<string, ServerState>();
  for (const server of servers) {
    const live = liveStats.get(server.id);
    if (live) {
      map.set(server.id, {
        totalRequests: 0,
        failedRequests: 0,
        lastHealthCheck: live.lastHealthCheck,
        isHealthy: live.isHealthy,
        consecutiveFailures: live.consecutiveFailures ?? 0,
        consecutiveSuccesses: 0,
        backoffLevel: 0,
        cooldownUntil: live.cooldownUntil,
        weight: 1,
        healthHistory: [],
      });
      continue;
    }

    const hasCompletedCheck = server.isHealthy != null && Boolean(server.lastHealthCheck);
    if (!hasCompletedCheck) continue;

    map.set(server.id, {
      totalRequests: 0,
      failedRequests: 0,
      lastHealthCheck: new Date(server.lastHealthCheck as Date | string),
      isHealthy: server.isHealthy as boolean,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      backoffLevel: 0,
      cooldownUntil: null,
      weight: 1,
      healthHistory: [],
    });
  }
  return map;
}

export interface FailoverRoles {
  primaryServerId: string | null;
  preferredServerId: string | null;
  nextAfter: (excludeServerId: string) => string | null;
}

/** Side-effect-free primary/preferred/next-candidate roles over the eligible set. */
export function failoverRolesFor(
  servers: ConfiguredServerRow[],
  liveStats: Map<string, LiveServerStats>,
  now: number,
): FailoverRoles {
  const serverConfigs = toServerConfig(servers);
  const stateMap = toServerStateMap(servers, liveStats);
  const primaryServerId = sortServersCanonically(serverConfigs)[0]?.id ?? null;
  const preferredServerId = selectFailoverServer(serverConfigs, stateMap, now)?.id ?? null;
  return {
    primaryServerId,
    preferredServerId,
    nextAfter: (excludeServerId: string) =>
      selectFailoverServer(serverConfigs, stateMap, now, excludeServerId)?.id ?? null,
  };
}
