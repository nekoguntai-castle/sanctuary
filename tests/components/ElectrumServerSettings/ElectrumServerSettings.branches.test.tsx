import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ElectrumServerSettings } from '../../../components/ElectrumServerSettings/ElectrumServerSettings';
import * as adminApi from '../../../src/api/admin';
import * as bitcoinApi from '../../../src/api/bitcoin';

vi.mock('../../../src/api/admin', () => ({
  getElectrumServers: vi.fn(),
  addElectrumServer: vi.fn(),
  updateElectrumServer: vi.fn(),
  deleteElectrumServer: vi.fn(),
  testElectrumServer: vi.fn(),
  reorderElectrumServers: vi.fn(),
}));

vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../components/ElectrumServerSettings/constants', () => ({
  PRESET_SERVERS: {},
}));

vi.mock('../../../components/ElectrumServerSettings/ServerRow', () => ({
  ServerRow: ({
    server,
    testStatus,
    testError,
    poolServerStats,
    onMoveServer,
    onTestServer,
    onToggleEnabled,
    onEditServer,
    onDeleteServer,
  }: any) => (
    <div data-testid={`server-row-${server.id}`}>
      <div data-testid={`status-${server.id}`}>{testStatus}</div>
      <div data-testid={`error-${server.id}`}>{testError}</div>
      <div data-testid={`pool-${server.id}`}>{poolServerStats ? 'has-pool-stats' : 'no-pool-stats'}</div>
      <button data-testid={`test-${server.id}`} onClick={() => onTestServer(server.id)}>test</button>
      <button data-testid={`move-missing-${server.id}`} onClick={() => onMoveServer('missing-id', 'up')}>move-missing</button>
      <button data-testid={`move-up-${server.id}`} onClick={() => onMoveServer(server.id, 'up')}>move-up</button>
      <button data-testid={`move-down-${server.id}`} onClick={() => onMoveServer(server.id, 'down')}>move-down</button>
      <button data-testid={`toggle-${server.id}`} onClick={() => onToggleEnabled(server.id, !server.enabled)}>toggle</button>
      <button data-testid={`edit-${server.id}`} onClick={() => onEditServer(server)}>edit</button>
      <button data-testid={`delete-${server.id}`} onClick={() => onDeleteServer(server.id)}>delete</button>
    </div>
  ),
}));

vi.mock('../../../components/ElectrumServerSettings/ServerForm', () => ({
  ServerForm: ({ editingServerId, newServer, onSubmit, onCancel, onNewServerChange }: any) => (
    <div data-testid="server-form">
      <div data-testid="form-mode">{editingServerId ? 'edit' : 'add'}</div>
      <div data-testid="form-port">{newServer.port}</div>
      <button
        onClick={() =>
          onNewServerChange({
            label: 'Filled Server',
            host: 'filled.example.com',
            port: 50002,
            useSsl: true,
          })
        }
      >
        Fill Form
      </button>
      <button onClick={onSubmit}>Submit Form</button>
      <button onClick={onCancel}>Cancel Form</button>
    </div>
  ),
}));

const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

const mainnetServers = [
  {
    id: 'm1',
    label: 'Main One',
    host: 'main-1.example.com',
    port: 50002,
    useSsl: true,
    network: 'mainnet',
    enabled: true,
    priority: 0,
    isHealthy: true,
  },
  {
    id: 'm2',
    label: 'Main Two',
    host: 'main-2.example.com',
    port: 50002,
    useSsl: true,
    network: 'mainnet',
    enabled: true,
    priority: 1,
    isHealthy: true,
  },
];

const testnetServers = [
  {
    id: 't1',
    label: 'Test One',
    host: 'test-1.example.com',
    port: 60002,
    useSsl: true,
    network: 'testnet',
    enabled: true,
    priority: 0,
    isHealthy: true,
  },
];

const signetServers = [
  {
    id: 's1',
    label: 'Signet One',
    host: 'signet-1.example.com',
    port: 50002,
    useSsl: true,
    network: 'signet',
    enabled: true,
    priority: 0,
    isHealthy: true,
  },
];

async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.queryByText('Loading server configuration...')).not.toBeInTheDocument();
  });
}

describe('ElectrumServerSettings branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alertSpy.mockClear();

    vi.mocked(adminApi.getElectrumServers).mockImplementation(async (network: any) => {
      if (network === 'mainnet') return mainnetServers as any;
      if (network === 'testnet') return testnetServers as any;
      if (network === 'signet') return signetServers as any;
      return [];
    });

    vi.mocked(adminApi.testElectrumServer).mockResolvedValue({ success: true, message: 'ok' } as any);
    vi.mocked(adminApi.reorderElectrumServers).mockResolvedValue(undefined as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ pool: null } as any);
  });

  it('sets pool stats when backend exposes pool status and passes stats to rows', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValueOnce({
      pool: {
        stats: {
          servers: [
            { serverId: 'm1', uptime: 0.99 },
          ],
        },
      },
    } as any);

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    expect(screen.getByTestId('pool-m1')).toHaveTextContent('has-pool-stats');
    expect(screen.getByTestId('pool-m2')).toHaveTextContent('no-pool-stats');
  });

  it('uses default test error message when API fails without a message', async () => {
    vi.mocked(adminApi.testElectrumServer).mockResolvedValueOnce({ success: false } as any);

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    fireEvent.click(screen.getByTestId('test-m1'));

    await waitFor(() => {
      expect(screen.getByTestId('status-m1')).toHaveTextContent('error');
      expect(screen.getByTestId('error-m1')).toHaveTextContent('Connection failed');
    });
  });

  it('covers move-server guard branches and reload-on-reorder-error path', async () => {
    vi.mocked(adminApi.reorderElectrumServers)
      .mockResolvedValueOnce(undefined as any)
      .mockRejectedValueOnce(new Error('reorder failed'));

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    fireEvent.click(screen.getByTestId('move-missing-m1'));
    fireEvent.click(screen.getByTestId('move-up-m1'));
    fireEvent.click(screen.getByTestId('move-down-m2'));
    expect(adminApi.reorderElectrumServers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('move-down-m1'));
    await waitFor(() => expect(adminApi.reorderElectrumServers).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('move-up-m1'));
    await waitFor(() => expect(adminApi.reorderElectrumServers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(adminApi.getElectrumServers).toHaveBeenCalledTimes(6));
  });

  it('uses testnet default port when opening add form from testnet tab', async () => {
    render(<ElectrumServerSettings />);
    await waitForLoaded();

    fireEvent.click(screen.getByText('testnet'));
    fireEvent.click(screen.getByText('Add Server'));

    expect(screen.getByTestId('server-form')).toBeInTheDocument();
    expect(screen.getByTestId('form-mode')).toHaveTextContent('add');
    expect(screen.getByTestId('form-port')).toHaveTextContent('60002');
  });

  it('covers signet-specific selected-tab count badge styling branch', async () => {
    render(<ElectrumServerSettings />);
    await waitForLoaded();

    fireEvent.click(screen.getByText('signet'));
    const signetTab = screen.getByRole('button', { name: /^signet/i });
    expect(within(signetTab).getByText('1/1')).toBeInTheDocument();
  });

  it('falls back to empty arrays when server/preset entries are missing', async () => {
    vi.mocked(adminApi.getElectrumServers).mockImplementation(async (network: any) => {
      if (network === 'mainnet') return undefined as any;
      return [];
    });

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    expect(screen.queryByText('Quick Add Presets')).not.toBeInTheDocument();
    expect(screen.getByText(/No servers configured for mainnet/i)).toBeInTheDocument();
  });

  it('covers per-network load fallback handlers when server fetches reject', async () => {
    vi.mocked(adminApi.getElectrumServers).mockImplementation(async () => {
      throw new Error('network fetch failed');
    });

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    expect(screen.getByText(/No servers configured for mainnet/i)).toBeInTheDocument();
  });

  it('covers successful server test auto-clear timeout path', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.mocked(adminApi.testElectrumServer).mockResolvedValueOnce({ success: true, message: 'ok' } as any);

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    fireEvent.click(screen.getByTestId('test-m1'));
    await waitFor(() => {
      expect(screen.getByTestId('status-m1')).toHaveTextContent('success');
    });

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 3000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => {
      expect(screen.getByTestId('status-m1')).toHaveTextContent('idle');
    });

    timeoutSpy.mockRestore();
  });

  it('covers server test exception branch with fallback error message', async () => {
    vi.mocked(adminApi.testElectrumServer).mockRejectedValueOnce(new Error('socket closed'));

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    fireEvent.click(screen.getByTestId('test-m1'));
    await waitFor(() => {
      expect(screen.getByTestId('status-m1')).toHaveTextContent('error');
      expect(screen.getByTestId('error-m1')).toHaveTextContent('socket closed');
    });
  });

  it('covers add/update/delete/toggle error handlers and alert fallbacks', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(adminApi.addElectrumServer).mockRejectedValueOnce(new Error('add failed') as never);
    vi.mocked(adminApi.updateElectrumServer)
      .mockRejectedValueOnce(new Error('update failed') as never)
      .mockRejectedValueOnce(new Error('toggle failed') as never);
    vi.mocked(adminApi.deleteElectrumServer).mockRejectedValueOnce(new Error('delete failed') as never);

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    fireEvent.click(screen.getByText('Add Server'));
    fireEvent.click(screen.getByText('Fill Form'));
    fireEvent.click(screen.getByText('Submit Form'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('add failed'));

    fireEvent.click(screen.getByTestId('edit-m1'));
    fireEvent.click(screen.getByText('Submit Form'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('update failed'));

    fireEvent.click(screen.getByTestId('toggle-m1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('toggle failed'));

    fireEvent.click(screen.getByTestId('delete-m1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Failed to delete server'));

    confirmSpy.mockRestore();
  });

  it('covers loadServers outer catch and pool-stats debug catch', async () => {
    vi.mocked(adminApi.getElectrumServers).mockReturnValue(null as any);
    vi.mocked(bitcoinApi.getStatus).mockRejectedValueOnce(new Error('pool stats failed') as never);

    render(<ElectrumServerSettings />);
    await waitForLoaded();

    expect(screen.getByText(/No servers configured for mainnet/i)).toBeInTheDocument();
  });
});
