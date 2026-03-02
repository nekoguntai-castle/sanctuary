import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NetworkConnectionCard } from '../../../components/NetworkConnectionCard/NetworkConnectionCard';
import * as adminApi from '../../../src/api/admin';

vi.mock('../../../src/api/admin', () => ({
  addElectrumServer: vi.fn(),
  updateElectrumServer: vi.fn(),
  deleteElectrumServer: vi.fn(),
  reorderElectrumServers: vi.fn(),
}));

vi.mock('../../../components/NetworkConnectionCard/SingletonConfig', () => ({
  SingletonConfig: ({ onTestSingleton, testStatus, testMessage }: any) => (
    <div>
      <button type="button" onClick={onTestSingleton}>trigger-singleton-test</button>
      <div data-testid="singleton-status">{testStatus}</div>
      <div data-testid="singleton-message">{testMessage}</div>
    </div>
  ),
}));

vi.mock('../../../components/NetworkConnectionCard/PoolConfig', () => ({
  PoolConfig: (props: any) => (
    <div>
      <button type="button" onClick={props.onAddServer}>trigger-add-server</button>
      <button type="button" onClick={props.onUpdateServer}>trigger-update-server</button>
      <button type="button" onClick={() => props.onEditServer(props.servers[0])}>trigger-edit-first</button>
      <button
        type="button"
        onClick={() => props.onSetNewServer({ label: 'Added', host: 'added.example.com', port: 50002, useSsl: true })}
      >
        trigger-set-new-server
      </button>
      <button type="button" onClick={() => props.onTestServer(props.servers[0])}>trigger-test-first-server</button>
      <button type="button" onClick={() => props.onMoveServer('missing', 'up')}>trigger-move-missing</button>
      <button type="button" onClick={() => props.onMoveServer(props.servers[0].id, 'up')}>trigger-move-first-up</button>
      <button
        type="button"
        onClick={() => props.onMoveServer(props.servers[props.servers.length - 1].id, 'down')}
      >
        trigger-move-last-down
      </button>
      <button type="button" onClick={() => props.onMoveServer(props.servers[1].id, 'down')}>trigger-move-middle-down</button>
      <div data-testid="server-status">{props.serverTestStatus?.[props.servers[0]?.id] || 'idle'}</div>
    </div>
  ),
}));

const baseConfig = {
  mainnetMode: 'pool',
  mainnetSingletonHost: 'singleton.example.com',
  mainnetSingletonPort: 50002,
  mainnetSingletonSsl: true,
  mainnetPoolMin: 1,
  mainnetPoolMax: 5,
  mainnetPoolLoadBalancing: 'round_robin',
};

const baseServers = [
  {
    id: 'server-1',
    nodeConfigId: 'node-1',
    network: 'mainnet',
    label: 'Server One',
    host: 'one.example.com',
    port: 50002,
    useSsl: true,
    enabled: true,
    priority: 0,
  },
  {
    id: 'server-2',
    nodeConfigId: 'node-1',
    network: 'mainnet',
    label: 'Server Two',
    host: 'two.example.com',
    port: 50002,
    useSsl: true,
    enabled: true,
    priority: 1,
  },
  {
    id: 'server-3',
    nodeConfigId: 'node-1',
    network: 'mainnet',
    label: 'Server Three',
    host: 'three.example.com',
    port: 50002,
    useSsl: true,
    enabled: true,
    priority: 2,
  },
] as any;

const renderCard = (overrides: Partial<React.ComponentProps<typeof NetworkConnectionCard>> = {}) => {
  const props = {
    network: 'mainnet' as const,
    config: baseConfig as any,
    servers: baseServers,
    poolStats: null,
    onConfigChange: vi.fn(),
    onServersChange: vi.fn(),
    onTestConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    ...overrides,
  };

  const view = render(<NetworkConnectionCard {...props} />);
  return { ...view, props };
};

describe('NetworkConnectionCard branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.addElectrumServer).mockResolvedValue({ id: 'added' } as any);
    vi.mocked(adminApi.updateElectrumServer).mockResolvedValue({
      ...baseServers[0],
      label: 'Updated Server',
    } as any);
    vi.mocked(adminApi.reorderElectrumServers).mockResolvedValue(undefined);
  });

  it('covers singleton failure path when test result is unsuccessful', async () => {
    const user = userEvent.setup();
    renderCard({
      config: { ...baseConfig, mainnetMode: 'singleton' } as any,
      onTestConnection: vi.fn().mockResolvedValue({ success: false, message: 'not reachable' }),
    });

    await user.click(screen.getByRole('button', { name: 'trigger-singleton-test' }));

    await waitFor(() => {
      expect(screen.getByTestId('singleton-status')).toHaveTextContent('error');
      expect(screen.getByTestId('singleton-message')).toHaveTextContent('not reachable');
    });
  });

  it('covers add/update guards, server test failure branch, and move boundary branches', async () => {
    const user = userEvent.setup();
    const { props } = renderCard({
      config: { ...baseConfig, mainnetMode: 'pool' } as any,
      onTestConnection: vi.fn().mockResolvedValue({ success: false, message: 'server failed' }),
    });

    await user.click(screen.getByRole('button', { name: 'trigger-add-server' }));
    expect(adminApi.addElectrumServer).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'trigger-update-server' }));
    expect(adminApi.updateElectrumServer).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'trigger-edit-first' }));
    await user.click(screen.getByRole('button', { name: 'trigger-update-server' }));
    await waitFor(() => {
      expect(adminApi.updateElectrumServer).toHaveBeenCalledWith('server-1', expect.objectContaining({
        label: 'Server One',
        host: 'one.example.com',
      }));
      expect(props.onServersChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'server-1', label: 'Updated Server' }),
        expect.objectContaining({ id: 'server-2' }),
        expect.objectContaining({ id: 'server-3' }),
      ]);
    });

    await user.click(screen.getByRole('button', { name: 'trigger-test-first-server' }));
    await waitFor(() => {
      expect(screen.getByTestId('server-status')).toHaveTextContent('error');
    });

    await user.click(screen.getByRole('button', { name: 'trigger-move-missing' }));
    expect(adminApi.reorderElectrumServers).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'trigger-move-first-up' }));
    expect(adminApi.reorderElectrumServers).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'trigger-move-last-down' }));
    expect(adminApi.reorderElectrumServers).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'trigger-move-middle-down' }));
    await waitFor(() => {
      expect(adminApi.reorderElectrumServers).toHaveBeenCalledWith(['server-1', 'server-3', 'server-2']);
      expect(props.onServersChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'server-1', priority: 0 }),
        expect.objectContaining({ id: 'server-3', priority: 1 }),
        expect.objectContaining({ id: 'server-2', priority: 2 }),
      ]);
    });
  });
});
