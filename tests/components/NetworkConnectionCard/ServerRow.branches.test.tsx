import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ServerRow } from '../../../src/components/NetworkConnectionCard/ServerRow';
import type { ElectrumServer } from '../../../src/types';

vi.mock('../../../src/components/NetworkConnectionCard/HealthHistoryBlocks', () => ({
  HealthHistoryBlocks: ({ history, maxBlocks }: { history: unknown[]; maxBlocks: number }) => (
    <div data-testid="health-history">{`history:${history.length}:${maxBlocks}`}</div>
  ),
}));

const makeServer = (overrides: Partial<ElectrumServer> = {}): ElectrumServer => ({
  id: 'server-1',
  nodeConfigId: 'node-1',
  network: 'mainnet',
  label: 'Primary',
  host: 'electrum.example.com',
  port: 50002,
  useSsl: true,
  priority: 0,
  enabled: true,
  isHealthy: true,
  lastHealthCheck: '2026-03-01T12:00:00.000Z',
  healthCheckFails: 0,
  ...overrides,
});

const callbacks = {
  onTestServer: vi.fn(),
  onToggleServer: vi.fn(),
  onMoveServer: vi.fn(),
  onEditServer: vi.fn(),
  onDeleteServer: vi.fn(),
};

type ServerRowProps = Parameters<typeof ServerRow>[0];

const defaultProps: Omit<ServerRowProps, 'server'> = {
  index: 0,
  totalServers: 2,
  serverTestStatus: 'idle',
  serverActionLoading: null,
  serverPoolStats: undefined,
  ...callbacks,
};

const renderRow = (
  serverOverrides: Partial<ElectrumServer> = {},
  propOverrides: Partial<Omit<ServerRowProps, 'server'>> = {},
) => render(
  <ServerRow
    {...defaultProps}
    {...propOverrides}
    server={makeServer(serverOverrides)}
  />
);

describe('ServerRow branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers row/toggle styling and health status indicator precedence', () => {
    const { rerender, container } = renderRow();

    expect(screen.getByText('SSL')).toBeInTheDocument();
    expect(screen.getByTitle('Disable server')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('surface-muted');
    expect(container.querySelector('.w-2.h-2.rounded-full')).toHaveClass('bg-emerald-500');

    rerender(
      <ServerRow
        {...defaultProps}
        serverTestStatus="idle"
        server={makeServer({ enabled: false, useSsl: false, isHealthy: false })}
      />
    );
    expect(screen.getByText('TCP')).toBeInTheDocument();
    expect(screen.getByTitle('Enable server')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('surface-secondary');
    expect(container.querySelector('.w-2.h-2.rounded-full')).toHaveClass('bg-rose-500');

    rerender(
      <ServerRow
        {...defaultProps}
        serverTestStatus="error"
        server={makeServer({ isHealthy: true })}
      />
    );
    expect(container.querySelector('.w-2.h-2.rounded-full')).toHaveClass('bg-rose-500');
    expect(container.querySelector('svg.w-4.h-4.text-rose-500')).toBeInTheDocument();

    rerender(
      <ServerRow
        {...defaultProps}
        serverTestStatus="success"
        server={makeServer({ isHealthy: false })}
      />
    );
    expect(container.querySelector('.w-2.h-2.rounded-full')).toHaveClass('bg-emerald-500');
    expect(container.querySelector('svg.w-4.h-4.text-emerald-500')).toBeInTheDocument();

    rerender(
      <ServerRow
        {...defaultProps}
        serverTestStatus="idle"
        server={makeServer({ isHealthy: undefined })}
      />
    );
    expect(container.querySelector('.w-2.h-2.rounded-full')).toHaveClass('bg-sanctuary-400');
  });

  it('covers history rendering, fallback blocks, and stats text branches', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    const { rerender, container } = renderRow(
      { healthCheckFails: 2 },
      {
        serverPoolStats: {
          serverId: 'server-1',
          label: 'Primary',
          host: 'electrum.example.com',
          port: 50002,
          connectionCount: 1,
          healthyConnections: 1,
          totalRequests: 10,
          failedRequests: 0,
          isHealthy: true,
          lastHealthCheck: '2026-03-01T12:00:00.000Z',
          consecutiveFailures: 2,
          backoffLevel: 0,
          cooldownUntil: future,
          weight: 0.5,
          healthHistory: [{ success: true, timestamp: '2026-03-01T12:00:00.000Z' }],
        } as any,
      }
    );

    expect(screen.getByTestId('health-history')).toHaveTextContent('history:1:10');
    expect(screen.getByText('2 fails')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('cooldown')).toBeInTheDocument();

    rerender(
      <ServerRow
        {...defaultProps}
        server={makeServer({ lastHealthCheck: null, healthCheckFails: undefined })}
      />
    );
    expect(screen.queryByTestId('health-history')).not.toBeInTheDocument();
    expect(screen.getByTitle('No health checks yet')).toBeInTheDocument();
    expect(container.querySelector('[class*="bg-sanctuary-300"]')).toBeInTheDocument();

    rerender(
      <ServerRow
        {...defaultProps}
        server={makeServer({
          lastHealthCheck: '2026-03-01T12:00:00.000Z',
          healthCheckFails: undefined,
        })}
        serverPoolStats={{
          serverId: 'server-1',
          label: 'Primary',
          host: 'electrum.example.com',
          port: 50002,
          connectionCount: 1,
          healthyConnections: 1,
          totalRequests: 10,
          failedRequests: 0,
          isHealthy: true,
          lastHealthCheck: '2026-03-01T12:00:00.000Z',
          consecutiveFailures: 1,
          backoffLevel: 0,
          cooldownUntil: past,
          weight: 1,
          healthHistory: [],
        } as any}
      />
    );
    expect(screen.getByTitle(/^Last check:/)).toBeInTheDocument();
    expect(screen.getByText('1 fail')).toBeInTheDocument();
    expect(screen.queryByText('cooldown')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="bg-emerald-400"]')).toBeInTheDocument();

    rerender(
      <ServerRow
        {...defaultProps}
        server={makeServer({
          lastHealthCheck: '2026-03-01T12:00:00.000Z',
          healthCheckFails: 3,
        })}
      />
    );
    expect(container.querySelector('[class*="bg-rose-400"]')).toBeInTheDocument();
  });

  it('covers action loading/disabled states and action callbacks', async () => {
    const user = userEvent.setup();
    const { rerender } = renderRow(
      {},
      { index: 0, totalServers: 1, serverTestStatus: 'testing', serverActionLoading: 'server-1' }
    );

    expect(screen.getByTitle('Test connection')).toBeDisabled();
    expect(screen.getByTitle('Delete server')).toBeDisabled();
    expect(screen.getByTitle('Move up (higher priority)')).toBeDisabled();
    expect(screen.getByTitle('Move down (lower priority)')).toBeDisabled();

    rerender(
      <ServerRow
        {...defaultProps}
        index={1}
        totalServers={3}
        serverTestStatus="idle"
        serverActionLoading={null}
        server={makeServer()}
      />
    );

    const testButton = screen.getByTitle('Test connection');
    expect(testButton).not.toBeDisabled();

    await user.click(testButton);
    expect(callbacks.onTestServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'server-1' }));

    await user.click(screen.getByTitle('Disable server'));
    expect(callbacks.onToggleServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'server-1' }));

    await user.click(screen.getByTitle('Move up (higher priority)'));
    expect(callbacks.onMoveServer).toHaveBeenCalledWith('server-1', 'up');

    await user.click(screen.getByTitle('Move down (lower priority)'));
    expect(callbacks.onMoveServer).toHaveBeenCalledWith('server-1', 'down');

    await user.click(screen.getByTitle('Edit server'));
    expect(callbacks.onEditServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'server-1' }));

    await user.click(screen.getByTitle('Delete server'));
    expect(callbacks.onDeleteServer).toHaveBeenCalledWith('server-1');
  });
});
