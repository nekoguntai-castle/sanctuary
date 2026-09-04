import { describe, expect, it } from 'vitest';
import {
  projectNodeOperationalStatus,
  healthCheckFreshnessWindowMs,
  HEALTH_CHECK_FRESHNESS_GRACE_MS,
  type NodeOperationalStatusSnapshot,
  type OperationalServerInput,
} from '../../../../src/services/bitcoin/nodeOperationalStatus';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const INTERVAL_MS = 30_000;

function server(overrides: Partial<OperationalServerInput> & Pick<OperationalServerInput, 'serverId'>): OperationalServerInput {
  return {
    label: overrides.serverId,
    host: `${overrides.serverId}.example.com`,
    port: 50002,
    priority: 0,
    isHealthy: true,
    lastHealthCheck: null,
    cooldownUntil: null,
    ...overrides,
  };
}

function baseSnapshot(overrides: Partial<NodeOperationalStatusSnapshot> = {}): NodeOperationalStatusSnapshot {
  return {
    now: NOW,
    configuredMode: 'pool',
    attemptedAt: new Date(NOW).toISOString(),
    route: null,
    strategy: 'failover_only',
    servers: [],
    healthCheckIntervalMs: INTERVAL_MS,
    primaryServerId: null,
    preferredServerId: null,
    nextAfter: null,
    ...overrides,
  };
}

describe('healthCheckFreshnessWindowMs', () => {
  it('is 2x the interval plus the documented grace period', () => {
    expect(healthCheckFreshnessWindowMs(INTERVAL_MS)).toBe(INTERVAL_MS * 2 + HEALTH_CHECK_FRESHNESS_GRACE_MS);
    expect(HEALTH_CHECK_FRESHNESS_GRACE_MS).toBe(5000);
  });

  it('honours a non-default interval rather than any hardcoded default', () => {
    expect(healthCheckFreshnessWindowMs(5000)).toBe(5000 * 2 + HEALTH_CHECK_FRESHNESS_GRACE_MS);
    expect(healthCheckFreshnessWindowMs(120_000)).toBe(120_000 * 2 + HEALTH_CHECK_FRESHNESS_GRACE_MS);
  });
});

describe('projectNodeOperationalStatus', () => {
  it('returns configuredMode/attemptedAt/route verbatim and pool:null for singleton mode', () => {
    const snapshot = baseSnapshot({
      configuredMode: 'singleton',
      strategy: null,
      route: { transport: 'singleton', observedAt: new Date(NOW).toISOString(), serverId: null },
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.configuredMode).toBe('singleton');
    expect(result.route).toEqual(snapshot.route);
    expect(result.pool).toBeNull();
  });

  it('sums the five exact counts to the server total', () => {
    const freshCheck = new Date(NOW - 1000).toISOString();
    const staleCheck = new Date(NOW - healthCheckFreshnessWindowMs(INTERVAL_MS) - 1000).toISOString();
    const snapshot = baseSnapshot({
      servers: [
        server({ serverId: 's-online', isHealthy: true, lastHealthCheck: freshCheck }),
        server({ serverId: 's-offline', isHealthy: false, lastHealthCheck: freshCheck }),
        server({ serverId: 's-cooldown', isHealthy: true, lastHealthCheck: freshCheck, cooldownUntil: new Date(NOW + 60_000).toISOString() }),
        server({ serverId: 's-unchecked', lastHealthCheck: null }),
        server({ serverId: 's-stale', isHealthy: true, lastHealthCheck: staleCheck }),
      ],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool).not.toBeNull();
    const pool = result.pool!;
    expect(pool.online + pool.offline + pool.cooldown + pool.unchecked + pool.stale).toBe(5);
    expect(pool.online).toBe(1);
    expect(pool.offline).toBe(1);
    expect(pool.cooldown).toBe(1);
    expect(pool.unchecked).toBe(1);
    expect(pool.stale).toBe(1);
  });

  it('derives cooldown ahead of a stale/offline last check', () => {
    const snapshot = baseSnapshot({
      servers: [
        server({
          serverId: 's1',
          isHealthy: false,
          lastHealthCheck: new Date(NOW - 1000).toISOString(),
          cooldownUntil: new Date(NOW + 1000).toISOString(),
        }),
      ],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool!.servers[0].availability).toBe('cooldown');
  });

  it('treats a cooldown deadline exactly at now as expired (boundary)', () => {
    const snapshot = baseSnapshot({
      servers: [
        server({
          serverId: 's1',
          isHealthy: true,
          lastHealthCheck: new Date(NOW - 1000).toISOString(),
          cooldownUntil: new Date(NOW).toISOString(),
        }),
      ],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool!.servers[0].availability).toBe('online');
  });

  it('treats a check exactly at the freshness boundary as fresh, and one ms older as stale', () => {
    const windowMs = healthCheckFreshnessWindowMs(INTERVAL_MS);
    const atBoundary = baseSnapshot({
      servers: [server({ serverId: 's1', isHealthy: true, lastHealthCheck: new Date(NOW - windowMs).toISOString() })],
    });
    const pastBoundary = baseSnapshot({
      servers: [server({ serverId: 's1', isHealthy: true, lastHealthCheck: new Date(NOW - windowMs - 1).toISOString() })],
    });
    expect(projectNodeOperationalStatus(atBoundary).pool!.servers[0].availability).toBe('online');
    expect(projectNodeOperationalStatus(pastBoundary).pool!.servers[0].availability).toBe('stale');
  });

  it('marks the answering pool-route server online without needing a fresh health check, and stamps checkedAt from the route', () => {
    const observedAt = new Date(NOW).toISOString();
    const snapshot = baseSnapshot({
      route: { transport: 'pool', observedAt, serverId: 's1' },
      servers: [server({ serverId: 's1', isHealthy: false, lastHealthCheck: null })],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool!.servers[0]).toMatchObject({ availability: 'online', checkedAt: observedAt });
  });

  it('does not mark a non-answering server online merely because another server answered', () => {
    const snapshot = baseSnapshot({
      route: { transport: 'pool', observedAt: new Date(NOW).toISOString(), serverId: 's1' },
      servers: [
        server({ serverId: 's1', isHealthy: true, lastHealthCheck: null }),
        server({ serverId: 's2', isHealthy: true, lastHealthCheck: null }),
      ],
    });
    const result = projectNodeOperationalStatus(snapshot);
    const s2 = result.pool!.servers.find((s) => s.serverId === 's2')!;
    expect(s2.availability).toBe('unchecked');
  });

  it('nulls all three role fields for a balanced (non-failover) strategy', () => {
    const snapshot = baseSnapshot({
      strategy: 'round_robin',
      primaryServerId: 's1',
      preferredServerId: 's1',
      nextAfter: () => 's1',
      route: { transport: 'pool', observedAt: new Date(NOW).toISOString(), serverId: 's1' },
      servers: [server({ serverId: 's1' })],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool).toMatchObject({ primaryServerId: null, preferredServerId: null, nextFailoverServerId: null });
  });

  it('exposes primary/preferred role IDs for a failover strategy', () => {
    const snapshot = baseSnapshot({
      strategy: 'failover_only',
      primaryServerId: 's1',
      preferredServerId: 's2',
      servers: [server({ serverId: 's1' }), server({ serverId: 's2' })],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool!.primaryServerId).toBe('s1');
    expect(result.pool!.preferredServerId).toBe('s2');
  });

  it('nextFailoverServerId is null unless route.transport === "pool", even for failover strategy', () => {
    const nextAfter = () => 's2';
    const noRoute = projectNodeOperationalStatus(
      baseSnapshot({ strategy: 'failover_only', nextAfter, servers: [server({ serverId: 's1' }), server({ serverId: 's2' })] }),
    );
    expect(noRoute.pool!.nextFailoverServerId).toBeNull();

    const fallbackRoute = projectNodeOperationalStatus(
      baseSnapshot({
        strategy: 'failover_only',
        nextAfter,
        route: { transport: 'singleton_fallback', observedAt: new Date(NOW).toISOString(), serverId: null, fallbackReason: 'pool_empty' },
        servers: [server({ serverId: 's1' }), server({ serverId: 's2' })],
      }),
    );
    expect(fallbackRoute.pool!.nextFailoverServerId).toBeNull();

    const poolRoute = projectNodeOperationalStatus(
      baseSnapshot({
        strategy: 'failover_only',
        nextAfter,
        route: { transport: 'pool', observedAt: new Date(NOW).toISOString(), serverId: 's1' },
        servers: [server({ serverId: 's1' }), server({ serverId: 's2' })],
      }),
    );
    expect(poolRoute.pool!.nextFailoverServerId).toBe('s2');
  });

  it('calls nextAfter with the observed route server id, exercising primary->backup, backup->tertiary, and exclusion', () => {
    const calls: string[] = [];
    const nextAfter = (excludeId: string) => {
      calls.push(excludeId);
      if (excludeId === 'primary') return 'backup';
      if (excludeId === 'backup') return 'tertiary';
      return null;
    };
    const routeOn = (serverId: string) =>
      projectNodeOperationalStatus(
        baseSnapshot({
          strategy: 'failover_only',
          nextAfter,
          route: { transport: 'pool', observedAt: new Date(NOW).toISOString(), serverId },
          servers: [server({ serverId: 'primary' }), server({ serverId: 'backup' }), server({ serverId: 'tertiary' })],
        }),
      );

    expect(routeOn('primary').pool!.nextFailoverServerId).toBe('backup');
    expect(routeOn('backup').pool!.nextFailoverServerId).toBe('tertiary');
    expect(calls).toEqual(['primary', 'backup']);
  });

  it('returns null nextFailoverServerId when nextAfter reports no distinct alternative (single-server / all-excluded)', () => {
    const snapshot = baseSnapshot({
      strategy: 'failover_only',
      nextAfter: () => null,
      route: { transport: 'pool', observedAt: new Date(NOW).toISOString(), serverId: 'only' },
      servers: [server({ serverId: 'only' })],
    });
    expect(projectNodeOperationalStatus(snapshot).pool!.nextFailoverServerId).toBeNull();
  });

  it('every emitted role ID belongs to servers[]', () => {
    const snapshot = baseSnapshot({
      strategy: 'failover_only',
      primaryServerId: 's1',
      preferredServerId: 's2',
      nextAfter: () => 's2',
      route: { transport: 'pool', observedAt: new Date(NOW).toISOString(), serverId: 's1' },
      servers: [server({ serverId: 's1' }), server({ serverId: 's2' })],
    });
    const result = projectNodeOperationalStatus(snapshot);
    const ids = new Set(result.pool!.servers.map((s) => s.serverId));
    for (const roleId of [result.pool!.primaryServerId, result.pool!.preferredServerId, result.pool!.nextFailoverServerId]) {
      if (roleId !== null) expect(ids.has(roleId)).toBe(true);
    }
  });

  it('accepts a Date instance (not just an ISO string) for lastHealthCheck/cooldownUntil', () => {
    const snapshot = baseSnapshot({
      servers: [server({ serverId: 's1', isHealthy: true, lastHealthCheck: new Date(NOW - 1000) })],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool!.servers[0].availability).toBe('online');
    expect(result.pool!.servers[0].checkedAt).toBe(new Date(NOW - 1000).toISOString());
  });

  it('treats an invalid date string as no evidence (unchecked) rather than throwing', () => {
    const snapshot = baseSnapshot({
      servers: [server({ serverId: 's1', isHealthy: true, lastHealthCheck: 'not-a-date' })],
    });
    const result = projectNodeOperationalStatus(snapshot);
    expect(result.pool!.servers[0].availability).toBe('unchecked');
    expect(result.pool!.servers[0].checkedAt).toBeNull();
  });

  it('is pure: identical inputs produce identical (deep-equal) output, and it never mutates the input snapshot', () => {
    const snapshot = baseSnapshot({
      strategy: 'failover_only',
      servers: [server({ serverId: 's1', lastHealthCheck: new Date(NOW).toISOString() })],
    });
    const before = JSON.stringify(snapshot);
    const a = projectNodeOperationalStatus(snapshot);
    const b = projectNodeOperationalStatus(snapshot);
    expect(a).toEqual(b);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
