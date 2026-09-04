import { describe, expect, it } from 'vitest';
import { buildNodeStatusCardModel } from '../../../src/components/Dashboard/nodeStatusCardModel';
import { describeServerOrUnknown, findServer } from '../../../src/components/Dashboard/nodeStatusCard/servers';
import { formatHost, safeIsoString, strategyLabel } from '../../../src/components/Dashboard/nodeStatusCard/copy';
import { failoverRouteNullModel, failoverStatusCheckFailedModel, failoverSuccessModel } from '../../../src/components/Dashboard/nodeStatusCard/failover';
import { balancedRouteNullModel, balancedStatusCheckFailedModel, balancedSuccessModel } from '../../../src/components/Dashboard/nodeStatusCard/balanced';
import type { NodeStatusCardInput } from '../../../src/components/Dashboard/nodeStatusCard/types';
import type {
  BitcoinStatus,
  NodeOperationalStatus,
  NodePoolLoadBalancing,
  NodeRouteObservation,
  OperationalServer,
  PoolOperationalStatus,
  ServerAvailability,
} from '../../../src/api/bitcoin';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');

function makeServer(
  serverId: string,
  availability: ServerAvailability,
  overrides: Partial<OperationalServer> = {},
): OperationalServer {
  return {
    serverId,
    label: `Server ${serverId}`,
    host: `${serverId}.example`,
    port: 50001,
    priority: 1,
    availability,
    checkedAt: '2026-09-03T11:59:00.000Z',
    ...overrides,
  };
}

interface AvailabilityCounts {
  online: number;
  offline: number;
  cooldown: number;
  unchecked: number;
  stale: number;
}

interface PoolRoles {
  primaryServerId: string | null;
  preferredServerId: string | null;
  nextFailoverServerId: string | null;
}

const EMPTY_ROLES: PoolRoles = { primaryServerId: null, preferredServerId: null, nextFailoverServerId: null };

function countsFromServers(servers: OperationalServer[]): AvailabilityCounts {
  const base: AvailabilityCounts = { online: 0, offline: 0, cooldown: 0, unchecked: 0, stale: 0 };
  for (const s of servers) {
    base[s.availability] += 1;
  }
  return base;
}

function makePool(
  strategy: NodePoolLoadBalancing,
  servers: OperationalServer[],
  roles: Partial<PoolRoles> = EMPTY_ROLES,
  countsOverride: Partial<AvailabilityCounts> = {},
): PoolOperationalStatus {
  const counts = { ...countsFromServers(servers), ...countsOverride };
  return {
    strategy,
    ...counts,
    ...EMPTY_ROLES,
    ...roles,
    servers,
  };
}

interface OperationalOverrides {
  configuredMode: 'singleton' | 'pool';
  attemptedAt?: string;
  route?: NodeRouteObservation | null;
  pool?: PoolOperationalStatus | null;
}

const OPERATIONAL_DEFAULTS = { attemptedAt: '2026-09-03T11:59:30.000Z', route: null, pool: null };

function makeOperational(overrides: OperationalOverrides): NodeOperationalStatus {
  return { ...OPERATIONAL_DEFAULTS, ...overrides };
}

const STATUS_DEFAULTS: BitcoinStatus = { connected: true, network: 'mainnet', pool: null };

function makeStatus(overrides: Partial<BitcoinStatus> = {}): BitcoinStatus {
  return { ...STATUS_DEFAULTS, ...overrides };
}

const INPUT_DEFAULTS = {
  network: 'mainnet' as const,
  isPlaceholderData: false,
  isLoading: false,
  error: null,
  dataUpdatedAt: NOW,
  isLastKnown: false,
  selectedNetwork: 'mainnet' as const,
};

function baseInput(overrides: Partial<NodeStatusCardInput> = {}): NodeStatusCardInput {
  return { ...INPUT_DEFAULTS, data: undefined, ...overrides };
}

function headlineOf(input: NodeStatusCardInput) {
  return buildNodeStatusCardModel(input).headline;
}

describe('nodeStatusCardModel', () => {
  describe('mismatched/initial precedence', () => {
    it('shows Checking… while loading with no data', () => {
      const model = buildNodeStatusCardModel(baseInput({ isLoading: true, data: undefined }));
      expect(model.headline).toBe('Checking…');
      expect(model.support[0].value).toBe('Checking Mainnet node status…');
      expect(model.badges).toEqual([{ label: 'Mainnet', kind: 'network' }]);
      expect(model.tone).toBe('checking');
    });

    it('shows Checking… when serving placeholder data', () => {
      const data = makeStatus({ operational: makeOperational({ configuredMode: 'singleton', route: { transport: 'singleton', observedAt: 'x', serverId: null } }) });
      const model = buildNodeStatusCardModel(baseInput({ data, isPlaceholderData: true }));
      expect(model.headline).toBe('Checking…');
    });

    it('shows Checking… when response network does not match selected network', () => {
      const data = makeStatus({ network: 'testnet' });
      const model = buildNodeStatusCardModel(baseInput({ data, selectedNetwork: 'mainnet' }));
      expect(model.headline).toBe('Checking…');
    });

    it('never shows a strategy badge while checking', () => {
      const model = buildNodeStatusCardModel(baseInput({ isLoading: true }));
      expect(model.badges.some((b) => b.kind === 'strategy')).toBe(false);
    });
  });

  describe('singleton', () => {
    it('renders Operational when reachable', () => {
      const data = makeStatus({
        host: 'node.example',
        blockHeight: 900000,
        operational: makeOperational({
          configuredMode: 'singleton',
          route: { transport: 'singleton', observedAt: '2026-09-03T11:59:59.000Z', serverId: null },
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Operational');
      expect(model.support[0].value).toBe('Connected to node.example · height 900,000');
      expect(model.badges).toEqual([
        { label: 'Mainnet', kind: 'network' },
        { label: 'Single server', kind: 'strategy' },
      ]);
      expect(model.tone).toBe('success');
    });

    it('renders Offline with sanitized error when unreachable', () => {
      const data = makeStatus({
        connected: false,
        host: 'node.example',
        error: 'Connection refused',
        operational: makeOperational({ configuredMode: 'singleton', route: null }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Offline');
      expect(model.support[0].value).toBe('Connection refused');
      expect(model.tone).toBe('error');
    });

    it('renders Node not configured when the singleton has no usable host', () => {
      const data = makeStatus({
        connected: false,
        host: undefined,
        operational: makeOperational({ configuredMode: 'singleton', route: null }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Node not configured');
      expect(model.support[0].value).toBe('Open Admin → Node Config');
      expect(model.detail).toEqual({ kind: 'guidance', text: 'Open Admin → Node Config' });
    });
  });

  describe('balanced pool', () => {
    it('all online', () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'online'), makeServer('c', 'online')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        blockHeight: 1,
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('3 of 3 online');
      expect(model.tone).toBe('success');
      expect(model.badges).toContainEqual({ label: 'Round robin', kind: 'strategy' });
    });

    it('0 active / 3 idle with all-online health evidence renders 3 of 3 online', () => {
      // Mirrors the plan's invariant #1: socket idleness is not health evidence.
      const servers = [makeServer('a', 'online'), makeServer('b', 'online'), makeServer('c', 'online')];
      const pool = makePool('least_connections', servers);
      const data = makeStatus({
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
          pool,
        }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('3 of 3 online');
    });

    it('degraded (mixed health)', () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'offline'), makeServer('c', 'unchecked')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('1 of 3 online');
      expect(model.tone).toBe('warning');
      expect(model.support.map((s) => s.value)).toEqual(['1 unavailable', '1 unknown']);
    });

    it('all-offline via route-null', () => {
      const servers = [makeServer('a', 'offline'), makeServer('b', 'offline')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('0 of 2 online');
      expect(model.tone).toBe('error');
      expect(model.support[0].value).toBe('2 offline · no server answered');
    });

    it('mixed unknown/stale/cooldown via route-null -> Health unknown', () => {
      const servers = [makeServer('a', 'unchecked'), makeServer('b', 'stale'), makeServer('c', 'cooldown')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Health unknown');
      expect(model.support.map((s) => s.value)).toEqual(['No server answered', '1 unavailable', '2 unknown']);
    });

    it('initializing (all unchecked) via route-null -> Health unknown', () => {
      const servers = [makeServer('a', 'unchecked'), makeServer('b', 'unchecked')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('Health unknown');
    });

    it('empty pool with no route -> No servers configured, never 0 of 0', () => {
      const pool = makePool('round_robin', []);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('No servers configured');
      expect(model.headline).not.toContain('0 of 0');
      expect(model.detail).toEqual({ kind: 'guidance', text: 'Open Admin → Node Config' });
    });

    it('legacy pool response with no operational projection', () => {
      const data = makeStatus({
        connected: true,
        pool: { enabled: true, minConnections: 1, maxConnections: 3, stats: { totalConnections: 3, activeConnections: 2, idleConnections: 1, waitingRequests: 0, totalAcquisitions: 1, averageAcquisitionTimeMs: 1, healthCheckFailures: 0, serverCount: 3, servers: [] } },
        operational: undefined,
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Network operational');
      expect(model.support.map((s) => s.value)).toEqual(['Pool route unknown', '3 servers configured']);
      expect(model.badges.some((b) => b.kind === 'strategy')).toBe(false);
    });

    it('no-route mixed online/offline -> Status check failed', () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'offline')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Status check failed');
      expect(model.support.map((s) => s.value)).toEqual(['1 recently online', 'no server answered']);
    });

    it('no-route all-online (still no route -> Status check failed, not the operational headline)', () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'online')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('Status check failed');
    });

    it('falls back to safe legacy presentation when counts do not sum to server count', () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'offline')];
      const pool = makePool('round_robin', servers, {}, { online: 5 });
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'a' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Network operational');
      expect(model.support[0].value).toBe('Pool route unknown');
    });
  });

  describe('failover pool', () => {
    it('primary answered', () => {
      const servers = [makeServer('primary', 'online'), makeServer('backup', 'online', { priority: 2 })];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: 'backup' });
      const data = makeStatus({
        blockHeight: 5,
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'primary' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Primary online');
      expect(model.tone).toBe('success');
      expect(model.support[0].value).toBe(`Using ${servers[0].label} · Online`);
      expect(model.support[1].value).toBe(`Next ${servers[1].label} · Online`);
    });

    it('backup answered (backup -> tertiary next)', () => {
      const servers = [
        makeServer('primary', 'offline', { priority: 1 }),
        makeServer('backup', 'online', { priority: 2 }),
        makeServer('tertiary', 'unchecked', { priority: 3 }),
      ];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'backup', nextFailoverServerId: 'tertiary' });
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'backup' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Failover active');
      expect(model.support[0].value).toBe(`Primary ${servers[0].label} · Offline`);
      expect(model.support[1].value).toBe(`Using ${servers[1].label} · Online`);
      expect(model.support[2].value).toBe(`Next ${servers[2].label} · Not checked`);
    });

    it('backup answered with no alternate -> No further standby', () => {
      const servers = [makeServer('primary', 'offline'), makeServer('backup', 'online')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'backup', nextFailoverServerId: null });
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'backup' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support[2].value).toBe('No further standby');
    });

    it('recovery: primary answered again after previously using backup', () => {
      const servers = [makeServer('primary', 'online'), makeServer('backup', 'online')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: 'backup' });
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'primary' }, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('Primary online');
    });

    it('no-route all-unavailable -> No server available', () => {
      const servers = [makeServer('primary', 'offline'), makeServer('backup', 'cooldown')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'backup', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('No server available');
      expect(model.support.map((s) => s.value)).toEqual([
        `Preferred pool retry ${servers[1].label} · Cooldown`,
        `primary ${servers[0].label} · Offline`,
        'no server answered',
      ]);
    });

    it('no-route all-unchecked -> Failover health unknown', () => {
      const servers = [makeServer('primary', 'unchecked'), makeServer('backup', 'unchecked')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('Failover health unknown');
    });

    it('no-route all-stale -> Failover health unknown', () => {
      const servers = [makeServer('primary', 'stale'), makeServer('backup', 'stale')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('Failover health unknown');
    });

    it('no-route mixed unavailable/unknown -> Failover health unknown', () => {
      const servers = [makeServer('primary', 'offline'), makeServer('backup', 'stale')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('Failover health unknown');
    });

    it('no-route all-online -> Status check failed', () => {
      const servers = [makeServer('primary', 'online'), makeServer('backup', 'online')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Status check failed');
    });

    it('no-route mixed online/offline -> Status check failed, suppresses Next', () => {
      const servers = [makeServer('primary', 'offline'), makeServer('backup', 'online')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'backup', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Status check failed');
      expect(model.support.some((s) => s.key === 'next')).toBe(false);
      expect(model.support.map((s) => s.value)).toEqual([
        '1 recently online',
        'no server answered',
        `Preferred pool retry ${servers[1].label} · Online`,
        `primary ${servers[0].label} · Offline`,
      ]);
    });

    it('primary-equals-preferred suppresses duplicate label', () => {
      const servers = [makeServer('primary', 'offline'), makeServer('backup', 'cooldown')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support[0].value).toBe(`Preferred pool retry ${servers[0].label} · Offline`);
      expect(model.support.some((s) => s.key === 'primary')).toBe(false);
    });

    it('missing preferred/next ID resolves to unknown rather than crashing', () => {
      const servers = [makeServer('primary', 'offline')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'ghost', nextFailoverServerId: null });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support[0].value).toBe('Preferred pool retry unknown');
    });
  });

  describe('configuration gaps', () => {
    it('pool with zero eligible servers -> No servers configured, wins before status-check-failed shape', () => {
      const pool = makePool('failover_only', []);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('No servers configured');
    });

    it('does not suppress a successful empty-pool fallback (pool_empty combines both truths)', () => {
      const pool = makePool('round_robin', []);
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_empty' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Pool fallback active');
      expect(model.support[0].value).toBe('Using singleton singleton.example · no pool servers configured');
    });
  });

  describe('empty-pool fallback variants', () => {
    it('aged/error empty-pool fallback still reports Pool fallback active under last-known wrapper', () => {
      const pool = makePool('round_robin', []);
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          attemptedAt: '2026-09-03T11:00:00.000Z',
          route: { transport: 'singleton_fallback', observedAt: '2026-09-03T11:00:00.000Z', serverId: null, fallbackReason: 'pool_empty' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true }));
      expect(model.lastKnown?.summary).toBe('Last known: Pool fallback active');
      expect(model.tone).toBe('warning');
    });

    it('missing-singleton (no host) aged response renders Node not configured under last-known wrapper', () => {
      const data = makeStatus({
        connected: false,
        host: undefined,
        operational: makeOperational({ configuredMode: 'singleton', route: null }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true }));
      expect(model.lastKnown?.summary).toBe('Last known: Node not configured');
    });
  });

  describe('fallback with preferred variants', () => {
    function fallbackPool(preferredServerId: string | null, primaryServerId: string | null = 'primary') {
      const servers = [makeServer('primary', 'offline'), makeServer('backup', 'cooldown')];
      return makePool('failover_only', servers, { primaryServerId, preferredServerId, nextFailoverServerId: null });
    }

    it('preferred backup', () => {
      const pool = fallbackPool('backup');
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_probe_failed' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Pool fallback active');
      expect(model.support.map((s) => s.value)).toEqual([
        'Primary Server primary · Offline',
        'Using singleton singleton.example',
        'pool unavailable',
        'Next pool retry Server backup · Cooldown',
      ]);
    });

    it('preferred primary (collapsed identity still shown explicitly, no combine rule for fallback primary line)', () => {
      const pool = fallbackPool('primary');
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_circuit_open' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support.find((s) => s.key === 'next')?.value).toBe('Next pool retry Server primary · Offline');
    });

    it('null preferred -> No pool server available', () => {
      const pool = fallbackPool(null);
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_uninitialized' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support.find((s) => s.key === 'next')?.value).toBe('No pool server available');
    });

    it('missing preferred ID -> Next pool retry unknown', () => {
      const pool = fallbackPool('ghost');
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_probe_failed' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support.find((s) => s.key === 'next')?.value).toBe('Next pool retry unknown');
    });

    it('failover fallback with a null primaryServerId renders unknown rather than crashing', () => {
      const pool = fallbackPool('backup', null);
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_probe_failed' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support.find((s) => s.key === 'primary')?.value).toBe('Primary unknown');
    });

    it('non-failover pool fallback (round_robin) has no primary/next lines', () => {
      const servers = [makeServer('a', 'offline'), makeServer('b', 'offline')];
      const pool = makePool('round_robin', servers, {});
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_probe_failed' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support.map((s) => s.value)).toEqual(['Using singleton singleton.example', 'pool unavailable']);
    });
  });

  describe('last-known / retained data', () => {
    it('route-success evidence uses observed label', () => {
      const servers = [makeServer('a', 'online')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'a', preferredServerId: 'a', nextFailoverServerId: null });
      const data = makeStatus({
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'pool', observedAt: '2026-09-03T10:00:00.000Z', serverId: 'a' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true }));
      expect(model.lastKnown).toEqual({
        summary: 'Last known: Primary online',
        evidenceLabel: 'observed',
        evidenceAt: '2026-09-03T10:00:00.000Z',
      });
      expect(model.tone).toBe('warning');
    });

    it('route-null evidence uses attempted label', () => {
      const servers = [makeServer('a', 'offline')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', attemptedAt: '2026-09-03T10:05:00.000Z', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true }));
      expect(model.lastKnown?.evidenceLabel).toBe('attempted');
      expect(model.lastKnown?.evidenceAt).toBe('2026-09-03T10:05:00.000Z');
    });

    it('legacy response uses received label from dataUpdatedAt', () => {
      const data = makeStatus({ connected: true, host: 'h', pool: null, operational: undefined });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true, dataUpdatedAt: NOW }));
      expect(model.lastKnown?.evidenceLabel).toBe('received');
      expect(model.lastKnown?.evidenceAt).toBe(new Date(NOW).toISOString());
    });

    it('invalid observedAt timestamp never renders Invalid Date', () => {
      const servers = [makeServer('a', 'online')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'a' });
      const data = makeStatus({
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'pool', observedAt: 'not-a-date', serverId: 'a' },
          pool,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true }));
      expect(model.lastKnown?.evidenceAt).toBe('unknown');
      expect(model.lastKnown?.evidenceAt).not.toContain('Invalid Date');
    });

    it('invalid attemptedAt timestamp never renders Invalid Date', () => {
      const pool = makePool('round_robin', [makeServer('a', 'offline')]);
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', attemptedAt: 'garbage', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true }));
      expect(model.lastKnown?.evidenceAt).toBe('unknown');
    });

    it('zero/invalid dataUpdatedAt for legacy last-known never renders Invalid Date', () => {
      const data = makeStatus({ connected: true, host: 'h', operational: undefined });
      const model = buildNodeStatusCardModel(baseInput({ data, isLastKnown: true, dataUpdatedAt: 0 }));
      expect(model.lastKnown?.evidenceAt).toBe('unknown');
    });
  });

  describe('additional branch coverage', () => {
    it('failover success assigns Standby to a server that is neither routed, primary, nor next', () => {
      const servers = [
        makeServer('primary', 'online'),
        makeServer('backup', 'online', { priority: 2 }),
        makeServer('spare', 'unchecked', { priority: 3 }),
      ];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: 'backup' });
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'primary' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.detail.kind).toBe('servers');
      if (model.detail.kind === 'servers') {
        expect(model.detail.rows.find((r) => r.serverId === 'spare')?.role).toBe('Standby');
      }
    });

    it('failover success with a next ID absent from the topology renders Next pool retry unknown', () => {
      const servers = [makeServer('primary', 'online')];
      const pool = makePool('failover_only', servers, { primaryServerId: 'primary', preferredServerId: 'primary', nextFailoverServerId: 'ghost' });
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'primary' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support[1].value).toBe('Next pool retry unknown');
    });

    it('empty-pool singleton fallback with no pool projection at all', () => {
      const data = makeStatus({
        host: 'singleton.example',
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'singleton_fallback', observedAt: 'x', serverId: null, fallbackReason: 'pool_empty' },
          pool: null,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Pool fallback active');
      expect(model.badges.some((b) => b.kind === 'strategy')).toBe(false);
    });

    it('route-null with mismatched pool sums falls back to the safe legacy presentation', () => {
      const servers = [makeServer('a', 'offline'), makeServer('b', 'offline')];
      const pool = makePool('round_robin', servers, {}, { offline: 9 });
      const data = makeStatus({
        connected: false,
        operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Network operational');
    });

    it('malformed successful pool response with a null pool projection falls back safely', () => {
      const data = makeStatus({
        operational: makeOperational({
          configuredMode: 'pool',
          route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
          pool: null,
        }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Network operational');
    });

    it('findServer and describeServerOrUnknown handle a null pool or null id defensively', () => {
      expect(findServer(null, 'a')).toBeNull();
      expect(findServer(makePool('round_robin', [makeServer('a', 'online')]), null)).toBeNull();
      expect(describeServerOrUnknown(null, null, 'nobody')).toBe('nobody');
    });

    it('formatHost handles a missing host', () => {
      expect(formatHost(undefined)).toBe('unknown host');
    });

    it('strategyLabel returns null for a null/unknown strategy value', () => {
      expect(strategyLabel(null)).toBeNull();
      expect(strategyLabel(undefined)).toBeNull();
    });

    it('safeIsoString rejects an empty string without parsing it', () => {
      expect(safeIsoString('')).toBeNull();
      expect(safeIsoString(null)).toBeNull();
    });

    it('legacy pool-enabled response with no server count omits the count line', () => {
      const data = makeStatus({
        connected: true,
        pool: { enabled: true, minConnections: 1, maxConnections: 3, stats: null },
        operational: undefined,
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support.map((s) => s.value)).toEqual(['Pool route unknown']);
    });

    it('balanced builders cover every ternary combination directly', () => {
    const badges = [{ label: 'Mainnet', kind: 'network' as const }];
    const onlineServers = [makeServer('a', 'online'), makeServer('b', 'online')];
    const onlinePool = makePool('round_robin', onlineServers);
    const mixedServers = [makeServer('a', 'online'), makeServer('b', 'offline'), makeServer('c', 'stale')];
    const mixedPool = makePool('round_robin', mixedServers);
    const emptyPool = makePool('round_robin', [], {}, { online: 0, offline: 0, cooldown: 0, unchecked: 0, stale: 0 });

    // guidanceForCounts: no issues -> undefined; issues -> guidance text.
    const allOnlineModel = balancedSuccessModel({ badges, pool: onlinePool, strategyText: 'Round robin', height: 10 });
    expect(allOnlineModel.detail.kind).toBe('servers');
    if (allOnlineModel.detail.kind === 'servers') {
      expect(allOnlineModel.detail.guidance).toBeUndefined();
    }
    const mixedModel = balancedSuccessModel({ badges, pool: mixedPool, strategyText: 'Round robin', height: undefined });
    expect(mixedModel.detail.kind).toBe('servers');
    if (mixedModel.detail.kind === 'servers') {
      expect(mixedModel.detail.guidance).toBeDefined();
    }
    expect(balancedSuccessModel({ badges, pool: emptyPool, strategyText: null, height: undefined }).detail).toEqual({ kind: 'none' });

    const counts = { online: 1, offline: 0, cooldown: 0, unchecked: 0, stale: 0, total: 1, unavailable: 0, unknown: 0, valid: true };
    expect(balancedStatusCheckFailedModel(badges, mixedPool, counts).detail.kind).toBe('servers');
    expect(balancedStatusCheckFailedModel(badges, emptyPool, counts).detail).toEqual({ kind: 'none' });

    expect(balancedRouteNullModel(badges, mixedPool).detail.kind).toBe('servers');
    expect(balancedRouteNullModel(badges, emptyPool).detail).toEqual({ kind: 'none' });
    const allOfflinePool = makePool('round_robin', [makeServer('a', 'offline')]);
    expect(balancedRouteNullModel(badges, allOfflinePool).detail.kind).toBe('servers');

    // supportForMixed: each count contributes its own item independently.
    const onlyUnavailable = makePool('round_robin', [makeServer('a', 'online'), makeServer('b', 'offline')]);
    expect(balancedSuccessModel({ badges, pool: onlyUnavailable, strategyText: null, height: undefined }).support.map((s) => s.value)).toEqual(['1 unavailable']);
    const onlyUnknown = makePool('round_robin', [makeServer('a', 'online'), makeServer('b', 'stale')]);
    expect(balancedSuccessModel({ badges, pool: onlyUnknown, strategyText: null, height: undefined }).support.map((s) => s.value)).toEqual(['1 unknown']);

    // Health-unknown branch with a server-less disclosure (malformed/overridden counts).
    const noRowsUnknownPool = makePool('round_robin', [], {}, { unchecked: 1 });
    expect(balancedRouteNullModel(badges, noRowsUnknownPool).detail).toEqual({ kind: 'none' });
    });

    it('failover builders render no disclosure for an empty server list', () => {
      const emptyPool = makePool('failover_only', [], { primaryServerId: null, preferredServerId: null, nextFailoverServerId: null }, {
        online: 0,
        offline: 0,
        cooldown: 0,
        unchecked: 0,
        stale: 0,
      });
      const badges = [{ label: 'Mainnet', kind: 'network' as const }];
      const counts = { online: 0, offline: 0, cooldown: 0, unchecked: 0, stale: 0, total: 0, unavailable: 0, unknown: 0, valid: true };

      expect(failoverSuccessModel({ badges, pool: emptyPool, routeServerId: 'ghost', height: undefined }).detail).toEqual({ kind: 'none' });
      expect(failoverStatusCheckFailedModel(badges, emptyPool, { ...counts, online: 1 }).detail).toEqual({ kind: 'none' });
      expect(failoverRouteNullModel(badges, emptyPool, counts).detail).toEqual({ kind: 'none' });
    });
  });

  describe('defensive/edge cases', () => {
    it('handles a single-server pool (one is a valid total)', () => {
      const servers = [makeServer('a', 'online')];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'a' }, pool }),
      });
      expect(headlineOf(baseInput({ data }))).toBe('1 of 1 online');
    });

    it('handles a missing block height without throwing', () => {
      const data = makeStatus({
        host: 'h',
        blockHeight: undefined,
        operational: makeOperational({ configuredMode: 'singleton', route: { transport: 'singleton', observedAt: 'x', serverId: null } }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support[0].value).toBe('Connected to h');
    });

    it('handles an unknown enum availability value as neutral/not-checked', () => {
      const servers = [makeServer('a', 'weird-value' as unknown as ServerAvailability)];
      const pool = makePool('round_robin', servers, {}, { online: 0, offline: 0, cooldown: 0, unchecked: 0, stale: 0 });
      // Force the sum-mismatch fallback path deliberately since one server with
      // an unrecognized enum value cannot be counted into any bucket.
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'a' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.headline).toBe('Network operational');
    });

    it('missing error string on legacy disconnected response falls back to a generic message', () => {
      const data = makeStatus({ connected: false, error: undefined, operational: undefined });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.support[0].value).toBe('Connection error');
    });

    it('long server labels pass through untouched (truncation is the view layer job)', () => {
      const longLabel = 'A'.repeat(200);
      const servers = [makeServer('a', 'online', { label: longLabel })];
      const pool = makePool('round_robin', servers);
      const data = makeStatus({
        operational: makeOperational({ configuredMode: 'pool', route: { transport: 'pool', observedAt: 'x', serverId: 'a' }, pool }),
      });
      const model = buildNodeStatusCardModel(baseInput({ data }));
      expect(model.detail.kind).toBe('servers');
      if (model.detail.kind === 'servers') {
        expect(model.detail.rows[0].label).toBe(longLabel);
      }
    });
  });
});
