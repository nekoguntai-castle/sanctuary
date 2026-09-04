import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeStatusCard } from '../../../src/components/Dashboard/NodeStatusCard';
import type { NodeStatusQueryState } from '../../../src/components/Dashboard/hooks/dashboardDataModel';
import type {
  BitcoinStatus,
  NodeOperationalStatus,
  NodePoolLoadBalancing,
  NodeRouteObservation,
  OperationalServer,
  PoolOperationalStatus,
  ServerAvailability,
} from '../../../src/api/bitcoin';

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  ChevronUp: () => <span data-testid="chevron-up-icon" />,
}));

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

interface PoolRoles {
  primaryServerId: string | null;
  preferredServerId: string | null;
  nextFailoverServerId: string | null;
}

const EMPTY_ROLES: PoolRoles = { primaryServerId: null, preferredServerId: null, nextFailoverServerId: null };

function countsFromServers(servers: OperationalServer[]) {
  const base = { online: 0, offline: 0, cooldown: 0, unchecked: 0, stale: 0 };
  for (const s of servers) {
    base[s.availability] += 1;
  }
  return base;
}

function makePool(
  strategy: NodePoolLoadBalancing,
  servers: OperationalServer[],
  roles: Partial<PoolRoles> = EMPTY_ROLES,
): PoolOperationalStatus {
  return { strategy, ...countsFromServers(servers), ...EMPTY_ROLES, ...roles, servers };
}

function makeOperational(overrides: {
  configuredMode: 'singleton' | 'pool';
  route?: NodeRouteObservation | null;
  pool?: PoolOperationalStatus | null;
}): NodeOperationalStatus {
  return { attemptedAt: '2026-09-03T11:59:30.000Z', route: null, pool: null, ...overrides };
}

const STATUS_DEFAULTS: BitcoinStatus = { connected: true, network: 'mainnet', pool: null };

function makeStatus(overrides: Partial<BitcoinStatus> = {}): BitcoinStatus {
  return { ...STATUS_DEFAULTS, ...overrides };
}

function makeQuery(overrides: Partial<NodeStatusQueryState> = {}): NodeStatusQueryState {
  return {
    network: 'mainnet',
    data: undefined,
    isPlaceholderData: false,
    isLoading: false,
    error: null,
    dataUpdatedAt: NOW,
    isLastKnown: false,
    ...overrides,
  };
}

function renderCard(query: NodeStatusQueryState, selectedNetwork: NodeStatusQueryState['network'] = 'mainnet') {
  return render(<NodeStatusCard selectedNetwork={selectedNetwork} query={query} />);
}

describe('NodeStatusCard', () => {
  it('renders Checking… while loading with no data', () => {
    renderCard(makeQuery({ isLoading: true }));
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  describe('singleton', () => {
    it('shows Operational when reachable', () => {
      renderCard(
        makeQuery({
          data: makeStatus({
            host: 'node.example',
            blockHeight: 900000,
            operational: makeOperational({
              configuredMode: 'singleton',
              route: { transport: 'singleton', observedAt: 'x', serverId: null },
            }),
          }),
        }),
      );
      expect(screen.getByText('Operational')).toBeInTheDocument();
      expect(screen.getByText('Single server', { exact: false })).toBeInTheDocument();
      expect(screen.getByText(/height 900,000/)).toBeInTheDocument();
    });

    it('shows Offline with sanitized error copy only', () => {
      renderCard(
        makeQuery({
          data: makeStatus({
            connected: false,
            host: 'node.example',
            error: 'Connection refused',
            operational: makeOperational({ configuredMode: 'singleton', route: null }),
          }),
        }),
      );
      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });

    it('points to Admin -> Node Config when not configured', () => {
      renderCard(
        makeQuery({
          data: makeStatus({
            connected: false,
            host: undefined,
            operational: makeOperational({ configuredMode: 'singleton', route: null }),
          }),
        }),
      );
      expect(screen.getByText('Node not configured')).toBeInTheDocument();
      expect(screen.getAllByText(/Admin → Node Config/).length).toBeGreaterThan(0);
    });
  });

  describe('balanced pool', () => {
    it('renders 3 of 3 online for 0-active/3-idle sockets with fresh all-online health evidence', () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'online'), makeServer('c', 'online')];
      const pool = makePool('least_connections', servers);
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
              pool,
            }),
          }),
        }),
      );
      expect(screen.getByText('3 of 3 online')).toBeInTheDocument();
      expect(screen.getAllByText('Least connections', { exact: false }).length).toBeGreaterThan(0);
    });

    it('renders degraded status with visible text independent of color', () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'offline'), makeServer('c', 'unchecked')];
      const pool = makePool('round_robin', servers);
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
              pool,
            }),
          }),
        }),
      );
      expect(screen.getByText('1 of 3 online')).toBeInTheDocument();
      expect(screen.getByText('1 unavailable')).toBeInTheDocument();
      expect(screen.getByText('1 unknown')).toBeInTheDocument();
    });

    it('legacy pool response (connected, pool.enabled, stats, no operational) uses transport-neutral copy', () => {
      renderCard(
        makeQuery({
          data: makeStatus({
            connected: true,
            pool: {
              enabled: true,
              minConnections: 1,
              maxConnections: 3,
              stats: {
                totalConnections: 3,
                activeConnections: 2,
                idleConnections: 1,
                waitingRequests: 0,
                totalAcquisitions: 1,
                averageAcquisitionTimeMs: 1,
                healthCheckFailures: 0,
                serverCount: 3,
                servers: [],
              },
            },
            operational: undefined,
          }),
        }),
      );
      expect(screen.getByText('Network operational')).toBeInTheDocument();
      expect(screen.queryByText(/Primary/)).not.toBeInTheDocument();
      expect(screen.queryByText(/In use/)).not.toBeInTheDocument();
      expect(screen.getByText('Pool route unknown', { exact: false })).toBeInTheDocument();
    });
  });

  describe('failover pool', () => {
    it('primary in use', () => {
      const servers = [makeServer('primary', 'online'), makeServer('backup', 'online', { priority: 2 })];
      const pool = makePool('failover_only', servers, {
        primaryServerId: 'primary',
        preferredServerId: 'primary',
        nextFailoverServerId: 'backup',
      });
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'primary' },
              pool,
            }),
          }),
        }),
      );
      expect(screen.getByText('Primary online')).toBeInTheDocument();
      expect(screen.getByText('Failover', { exact: false })).toBeInTheDocument();
    });

    it('backup in use (failover active)', () => {
      const servers = [
        makeServer('primary', 'offline', { priority: 1 }),
        makeServer('backup', 'online', { priority: 2 }),
      ];
      const pool = makePool('failover_only', servers, {
        primaryServerId: 'primary',
        preferredServerId: 'backup',
        nextFailoverServerId: null,
      });
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'backup' },
              pool,
            }),
          }),
        }),
      );
      expect(screen.getByText('Failover active')).toBeInTheDocument();
      expect(screen.getByText('No further standby', { exact: false })).toBeInTheDocument();
    });

    it('no route (no server answered)', () => {
      const servers = [makeServer('primary', 'offline'), makeServer('backup', 'cooldown')];
      const pool = makePool('failover_only', servers, {
        primaryServerId: 'primary',
        preferredServerId: 'backup',
        nextFailoverServerId: null,
      });
      renderCard(
        makeQuery({
          data: makeStatus({
            connected: false,
            operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
          }),
        }),
      );
      expect(screen.getByText('No server available')).toBeInTheDocument();
    });
  });

  describe('pool fallback and unknown', () => {
    it('renders No servers configured for an empty pool', () => {
      const pool = makePool('round_robin', []);
      renderCard(
        makeQuery({
          data: makeStatus({
            connected: false,
            operational: makeOperational({ configuredMode: 'pool', route: null, pool }),
          }),
        }),
      );
      expect(screen.getByText('No servers configured')).toBeInTheDocument();
    });
  });

  describe('long labels', () => {
    it('truncates a long server label visually but keeps the full text accessible via title', async () => {
      const longLabel = 'A Very Long Electrum Server Label That Would Overflow The Card Layout';
      const servers = [
        makeServer('a', 'online', { label: longLabel }),
        makeServer('b', 'online'),
      ];
      const pool = makePool('failover_only', servers, {
        primaryServerId: 'a',
        preferredServerId: 'a',
        nextFailoverServerId: 'b',
      });
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
              pool,
            }),
          }),
        }),
      );

      const toggle = screen.getByRole('button', { name: /server/i });
      await userEvent.click(toggle);
      const rows = screen.getAllByRole('listitem');
      const longRow = rows.find((row) => row.textContent?.includes(longLabel.slice(0, 10)));
      expect(longRow).toBeDefined();
      const labelEl = within(longRow as HTMLElement).getByTitle(longLabel);
      expect(labelEl).toHaveClass('truncate');
      expect(labelEl.textContent).toBe(longLabel);
    });
  });

  describe('disclosure', () => {
    function renderExpandable() {
      const servers = [makeServer('a', 'online'), makeServer('b', 'online')];
      const pool = makePool('round_robin', servers);
      return renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
              pool,
            }),
          }),
        }),
      );
    }

    it('toggles via Enter and Space and links aria-controls to the revealed region', async () => {
      const user = userEvent.setup();
      renderExpandable();

      const toggle = screen.getByRole('button', { name: /2 servers/i });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const controlsId = toggle.getAttribute('aria-controls');
      expect(controlsId).toBe('node-status-servers');
      expect(document.getElementById(controlsId as string)).toBeNull();

      toggle.focus();
      await user.keyboard('{Enter}');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const region = document.getElementById(controlsId as string);
      expect(region).not.toBeNull();

      await user.keyboard(' ');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(document.getElementById(controlsId as string)).toBeNull();
    });

    it('shows role and availability as text, not just color, for each server row', async () => {
      const servers = [makeServer('primary', 'online'), makeServer('backup', 'offline')];
      const pool = makePool('failover_only', servers, {
        primaryServerId: 'primary',
        preferredServerId: 'primary',
        nextFailoverServerId: 'backup',
      });
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'primary' },
              pool,
            }),
          }),
        }),
      );
      const toggle = screen.getByRole('button', { name: /server/i });
      await userEvent.click(toggle);
      expect(screen.getByText('In use')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
      expect(screen.getAllByText('Online').length).toBeGreaterThan(0);
      expect(screen.getByText('Offline')).toBeInTheDocument();
    });
  });

  describe('last known', () => {
    it('renders "Last known: <summary>" with an evidence label and timestamp', () => {
      const servers = [makeServer('a', 'online')];
      const pool = makePool('round_robin', servers);
      renderCard(
        makeQuery({
          isLastKnown: true,
          dataUpdatedAt: NOW - 5 * 60_000,
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: '2026-09-03T11:55:00.000Z', serverId: 'a' },
              pool,
            }),
          }),
        }),
      );
      // The presenter already prefixes the summary; the view must not add a second "Last known:".
      const line = screen.getByText(/^Last known:/);
      expect(line).toHaveTextContent('Last known: 1 of 1 online');
      expect(line.textContent).not.toMatch(/Last known: Last known/);
    });
  });

  describe('branch coverage', () => {
    it('renders a disclosure with no trailing guidance line for a clean pool', async () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'online')];
      const pool = makePool('round_robin', servers);
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
              pool,
            }),
          }),
        }),
      );
      const toggle = screen.getByRole('button', { name: /2 servers/i });
      await userEvent.click(toggle);
      expect(screen.queryByText(/Open Admin/)).not.toBeInTheDocument();
    });

    it('renders the disclosure guidance line when servers need attention', async () => {
      const servers = [makeServer('a', 'online'), makeServer('b', 'offline')];
      const pool = makePool('round_robin', servers);
      renderCard(
        makeQuery({
          data: makeStatus({
            operational: makeOperational({
              configuredMode: 'pool',
              route: { transport: 'pool', observedAt: 'x', serverId: 'a' },
              pool,
            }),
          }),
        }),
      );
      const toggle = screen.getByRole('button', { name: /2 servers/i });
      await userEvent.click(toggle);
      expect(screen.getByText(/Open Admin → Node Config to review server health\./)).toBeInTheDocument();
    });

    it('renders a support item with no title attribute', () => {
      renderCard(
        makeQuery({
          data: makeStatus({
            host: 'node.example',
            operational: makeOperational({
              configuredMode: 'singleton',
              route: { transport: 'singleton', observedAt: 'x', serverId: null },
            }),
          }),
        }),
      );
      const supportText = screen.getByText(/Connected to node.example/);
      expect(supportText.getAttribute('title')).toBeNull();
    });
  });

  it('has no aria-live regions anywhere on the card', () => {
    const { container } = renderCard(makeQuery({ isLoading: true }));
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});
