import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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
        onClick={() => props.onAddPreset({ name: 'Preset Added', host: 'preset.example.com', port: 60001, useSsl: false })}
      >
        trigger-add-preset
      </button>
      <button type="button" onClick={props.onCancelEdit}>trigger-cancel-edit</button>
      <button type="button" onClick={props.onToggleAdvanced}>trigger-toggle-advanced</button>
      <button type="button" onClick={() => props.getDefaultPort()}>trigger-default-port</button>
      <button
        type="button"
        onClick={() => props.onSetNewServer({ label: 'Added', host: 'added.example.com', port: 50002, useSsl: true })}
      >
        trigger-set-new-server
      </button>
      <button type="button" onClick={() => props.onTestServer(props.servers[0])}>trigger-test-first-server</button>
      <button type="button" onClick={() => props.onDeleteServer(props.servers[0].id)}>trigger-delete-first</button>
      <button type="button" onClick={() => props.onToggleServer(props.servers[0])}>trigger-toggle-first</button>
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
      <div data-testid="new-server-label">{props.newServer?.label || ''}</div>
      <div data-testid="is-adding-server">{String(props.isAddingServer)}</div>
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

  it('covers singleton test exception branch', async () => {
    const user = userEvent.setup();
    renderCard({
      config: { ...baseConfig, mainnetMode: 'singleton' } as any,
      onTestConnection: vi.fn().mockRejectedValue(new Error('singleton exploded')),
    });

    await user.click(screen.getByRole('button', { name: 'trigger-singleton-test' }));

    await waitFor(() => {
      expect(screen.getByTestId('singleton-status')).toHaveTextContent('error');
      expect(screen.getByTestId('singleton-message')).toHaveTextContent('singleton exploded');
    });
  });

  it('covers add/update guards, server test failure branch, and move boundary branches', async () => {
    const user = userEvent.setup();
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { props } = renderCard({
      config: { ...baseConfig, mainnetMode: 'pool' } as any,
      onTestConnection: vi.fn()
        .mockResolvedValueOnce({ success: false, message: 'server failed' })
        .mockRejectedValueOnce(new Error('server exploded')),
    });

    await user.click(screen.getByRole('button', { name: 'trigger-add-preset' }));
    expect(screen.getByTestId('new-server-label')).toHaveTextContent('Preset Added');
    expect(screen.getByTestId('is-adding-server')).toHaveTextContent('true');

    await user.click(screen.getByRole('button', { name: 'trigger-cancel-edit' }));
    expect(screen.getByTestId('new-server-label')).toHaveTextContent('');
    expect(screen.getByTestId('is-adding-server')).toHaveTextContent('false');

    await user.click(screen.getByRole('button', { name: 'trigger-default-port' }));
    await user.click(screen.getByRole('button', { name: 'trigger-toggle-advanced' }));

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
      expect(props.onTestConnection).toHaveBeenCalledWith('one.example.com', 50002, true);
    });
    await user.click(screen.getByRole('button', { name: 'trigger-test-first-server' }));
    await waitFor(() => {
      expect(props.onTestConnection).toHaveBeenCalledTimes(2);
    });

    // Execute only the component's auto-clear callbacks (5s timers)
    const autoClearCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 5000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');
    act(() => {
      autoClearCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => {
      expect(screen.getByTestId('server-status')).toHaveTextContent('idle');
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

    timeoutSpy.mockRestore();
  });

  it('covers pool-mode button handler from singleton mode', async () => {
    const user = userEvent.setup();
    const { props } = renderCard({
      config: { ...baseConfig, mainnetMode: 'singleton' } as any,
    });

    await user.click(screen.getByRole('button', { name: /^Pool\b/ }));
    expect(props.onConfigChange).toHaveBeenCalledWith({ mainnetMode: 'pool' });
  });

  it('covers add/update/delete/toggle/reorder error handlers', async () => {
    const user = userEvent.setup();
    const { props } = renderCard({
      config: { ...baseConfig, mainnetMode: 'pool' } as any,
    });

    vi.mocked(adminApi.addElectrumServer).mockRejectedValueOnce(new Error('add failed') as never);
    vi.mocked(adminApi.updateElectrumServer)
      .mockRejectedValueOnce(new Error('update failed') as never)
      .mockRejectedValueOnce(new Error('toggle failed') as never);
    vi.mocked(adminApi.deleteElectrumServer).mockRejectedValueOnce(new Error('delete failed') as never);
    vi.mocked(adminApi.reorderElectrumServers).mockRejectedValueOnce(new Error('reorder failed') as never);

    await user.click(screen.getByRole('button', { name: 'trigger-set-new-server' }));
    await user.click(screen.getByRole('button', { name: 'trigger-add-server' }));
    await waitFor(() => {
      expect(adminApi.addElectrumServer).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: 'trigger-edit-first' }));
    await user.click(screen.getByRole('button', { name: 'trigger-update-server' }));
    await waitFor(() => {
      expect(adminApi.updateElectrumServer).toHaveBeenCalledWith(
        'server-1',
        expect.objectContaining({ label: 'Server One' })
      );
    });

    await user.click(screen.getByRole('button', { name: 'trigger-toggle-first' }));
    await waitFor(() => {
      expect(adminApi.updateElectrumServer).toHaveBeenCalledWith('server-1', { enabled: false });
    });

    await user.click(screen.getByRole('button', { name: 'trigger-delete-first' }));
    await waitFor(() => {
      expect(adminApi.deleteElectrumServer).toHaveBeenCalledWith('server-1');
    });

    await user.click(screen.getByRole('button', { name: 'trigger-move-middle-down' }));
    await waitFor(() => {
      expect(adminApi.reorderElectrumServers).toHaveBeenCalledWith(['server-1', 'server-3', 'server-2']);
    });

    expect(props.onServersChange).toHaveBeenCalled();
  });
});
