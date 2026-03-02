import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ServerRow } from '../../../components/ElectrumServerSettings/ServerRow';
import type { ElectrumServer } from '../../../types';

vi.mock('../../../components/ElectrumServerSettings/HealthHistoryBlocks', () => ({
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
  supportsVerbose: null,
  lastHealthCheck: null,
  lastHealthCheckError: null,
  ...overrides,
});

const callbacks = {
  onMoveServer: vi.fn(),
  onTestServer: vi.fn(),
  onToggleEnabled: vi.fn(),
  onEditServer: vi.fn(),
  onDeleteServer: vi.fn(),
};

const renderRow = (
  serverOverrides: Partial<ElectrumServer> = {},
  propOverrides: Partial<React.ComponentProps<typeof ServerRow>> = {},
) => render(
  <ServerRow
    server={makeServer(serverOverrides)}
    index={0}
    totalCount={2}
    testStatus="idle"
    testError=""
    actionLoading={false}
    poolServerStats={undefined}
    {...callbacks}
    {...propOverrides}
  />,
);

describe('Electrum ServerRow branch coverage', () => {
  it('covers verbose/basic/unhealthy badges and unhealthy title fallback', () => {
    const { rerender } = renderRow({ supportsVerbose: true });
    expect(screen.getByText('verbose')).toBeInTheDocument();

    rerender(
      <ServerRow
        server={makeServer({ supportsVerbose: false })}
        index={0}
        totalCount={2}
        testStatus="idle"
        testError=""
        actionLoading={false}
        poolServerStats={undefined}
        {...callbacks}
      />,
    );
    expect(screen.getByText('basic')).toBeInTheDocument();

    rerender(
      <ServerRow
        server={makeServer({ enabled: false, isHealthy: false, lastHealthCheckError: null })}
        index={0}
        totalCount={2}
        testStatus="idle"
        testError=""
        actionLoading={false}
        poolServerStats={undefined}
        {...callbacks}
      />,
    );
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(screen.getByText('unhealthy')).toHaveAttribute('title', 'Connection failed');
  });

  it('covers health history/stats branches including cooldown and reduced weight', () => {
    const future = new Date(Date.now() + 60_000).toISOString();

    renderRow(
      { lastHealthCheck: '2026-03-02T12:00:00.000Z' },
      {
        poolServerStats: {
          serverId: 'server-1',
          label: 'Primary',
          host: 'electrum.example.com',
          port: 50002,
          connectionCount: 1,
          healthyConnections: 1,
          totalRequests: 12,
          failedRequests: 1,
          isHealthy: true,
          lastHealthCheck: '2026-03-02T12:00:00.000Z',
          consecutiveFailures: 2,
          backoffLevel: 0,
          cooldownUntil: future,
          weight: 0.5,
          healthHistory: [{ success: true, timestamp: '2026-03-02T12:00:00.000Z' }],
        } as any,
      },
    );

    expect(screen.getByTestId('health-history')).toHaveTextContent('history:1:12');
    expect(screen.getByText('Fails: 2')).toBeInTheDocument();
    expect(screen.getByText('Weight: 50%')).toBeInTheDocument();
    expect(screen.getByText(/Cooldown until/i)).toBeInTheDocument();
    expect(screen.getByText(/Checked:/i)).toBeInTheDocument();
  });

  it('covers failed test badge title precedence chain', () => {
    const { rerender } = renderRow(
      { lastHealthCheckError: 'health-check-fail' },
      { testStatus: 'error', testError: 'manual-test-fail' },
    );

    let failedBadge = screen.getByText('Failed').closest('span[title]');
    expect(failedBadge).toHaveAttribute('title', 'manual-test-fail');

    rerender(
      <ServerRow
        server={makeServer({ lastHealthCheckError: 'health-check-fail' })}
        index={0}
        totalCount={2}
        testStatus="error"
        testError=""
        actionLoading={false}
        poolServerStats={undefined}
        {...callbacks}
      />,
    );
    failedBadge = screen.getByText('Failed').closest('span[title]');
    expect(failedBadge).toHaveAttribute('title', 'health-check-fail');

    rerender(
      <ServerRow
        server={makeServer({ lastHealthCheckError: null })}
        index={0}
        totalCount={2}
        testStatus="error"
        testError=""
        actionLoading={false}
        poolServerStats={undefined}
        {...callbacks}
      />,
    );
    failedBadge = screen.getByText('Failed').closest('span[title]');
    expect(failedBadge).toHaveAttribute('title', 'Connection test failed');
  });

  it('covers move up/down callbacks when priority buttons are enabled', () => {
    renderRow({}, { index: 1, totalCount: 3 });

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]); // move up
    fireEvent.click(buttons[1]); // move down

    expect(callbacks.onMoveServer).toHaveBeenCalledWith('server-1', 'up');
    expect(callbacks.onMoveServer).toHaveBeenCalledWith('server-1', 'down');
  });
});
