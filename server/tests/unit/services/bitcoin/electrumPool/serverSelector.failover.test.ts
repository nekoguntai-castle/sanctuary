/**
 * Exact-ID failover selection coverage for `selectFailoverServer` and its
 * no-sort counterpart `selectFailoverServerFromSorted`. Migrated from the
 * retired `ElectrumPool.getFailoverSnapshot()` regression suite (dashboard
 * network status card A2 work) -- the canonical read-only roles path is
 * `networkStatus/topology.ts`'s `failoverRolesFor`, which itself calls
 * through to these same pure selector functions.
 */
import { describe, it, expect } from 'vitest';
import {
  selectFailoverServer,
  selectFailoverServerFromSorted,
  sortServersCanonically,
} from '../../../../../src/services/bitcoin/electrumPool/serverSelector';
import type { ServerConfig, ServerState } from '../../../../../src/services/bitcoin/electrumPool/types';

const healthyState = (overrides: Partial<ServerState> = {}): ServerState => ({
  totalRequests: 0,
  failedRequests: 0,
  lastHealthCheck: new Date(),
  isHealthy: true,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  backoffLevel: 0,
  cooldownUntil: null,
  weight: 1.0,
  healthHistory: [],
  ...overrides,
});

const servers: ServerConfig[] = [
  { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
  { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
  { id: 's3', label: 'Tertiary', host: 'c', port: 3, useSsl: true, priority: 2, enabled: true },
];

function setup(): Map<string, ServerState> {
  const stats = new Map<string, ServerState>();
  for (const s of servers) {
    stats.set(s.id, healthyState());
  }
  return stats;
}

describe.each([
  ['selectFailoverServer (unsorted input)', (stats: Map<string, ServerState>, now: number, exclude?: string) =>
    selectFailoverServer(servers, stats, now, exclude)],
  ['selectFailoverServerFromSorted (pre-sorted input)', (stats: Map<string, ServerState>, now: number, exclude?: string) =>
    selectFailoverServerFromSorted(sortServersCanonically(servers), stats, now, exclude)],
] as const)('%s', (_label, select) => {
  it('primary -> backup when primary ineligible', () => {
    const stats = setup();
    stats.get('s1')!.isHealthy = false;
    expect(select(stats, Date.now())?.id).toBe('s2');
  });

  it('backup -> tertiary when primary and backup ineligible', () => {
    const stats = setup();
    stats.get('s1')!.isHealthy = false;
    stats.get('s2')!.isHealthy = false;
    expect(select(stats, Date.now())?.id).toBe('s3');
  });

  it('skips an ineligible server via the exclusion parameter', () => {
    const stats = setup();
    expect(select(stats, Date.now(), 's1')?.id).toBe('s2');
    stats.get('s2')!.isHealthy = false;
    expect(select(stats, Date.now(), 's1')?.id).toBe('s3');
  });

  it('all-cooldown falls back to the shortest-cooldown server', () => {
    const stats = setup();
    const now = Date.now();
    stats.get('s1')!.cooldownUntil = new Date(now + 30_000);
    stats.get('s2')!.cooldownUntil = new Date(now + 10_000);
    stats.get('s3')!.cooldownUntil = new Date(now + 20_000);
    expect(select(stats, now)?.id).toBe('s2');
  });

  it('all-unhealthy falls back to the first enabled server without reporting it online', () => {
    const stats = setup();
    stats.get('s1')!.isHealthy = false;
    stats.get('s2')!.isHealthy = false;
    stats.get('s3')!.isHealthy = false;
    expect(select(stats, Date.now())?.id).toBe('s1');
  });

  it('excluded-server case: never returns the excluded id', () => {
    const stats = setup();
    expect(select(stats, Date.now(), 's2')?.id).not.toBe('s2');
    expect(select(stats, Date.now(), 's2')?.id).toBe('s1');
  });
});

describe('selectFailoverServer / selectFailoverServerFromSorted edge cases', () => {
  it('single-server pool reports that server as the selection, with no distinct next', () => {
    const single = [servers[0]];
    const stats = new Map([['s1', healthyState()]]);
    expect(selectFailoverServer(single, stats, Date.now())?.id).toBe('s1');
    expect(selectFailoverServerFromSorted(sortServersCanonically(single), stats, Date.now())?.id).toBe('s1');
    expect(selectFailoverServer(single, stats, Date.now(), 's1')).toBeNull();
  });

  it('zero-server pool returns null', () => {
    const stats = new Map<string, ServerState>();
    expect(selectFailoverServer([], stats, Date.now())).toBeNull();
    expect(selectFailoverServerFromSorted([], stats, Date.now())).toBeNull();
  });
});
