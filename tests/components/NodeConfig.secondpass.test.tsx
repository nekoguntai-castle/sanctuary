import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NodeConfig } from '../../components/NodeConfig';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/api/admin', () => ({
  getNodeConfig: vi.fn(),
  updateNodeConfig: vi.fn(),
  getElectrumServers: vi.fn(),
  testElectrumConnection: vi.fn(),
  testProxy: vi.fn(),
  getTorContainerStatus: vi.fn(),
  startTorContainer: vi.fn(),
  stopTorContainer: vi.fn(),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../components/NodeConfig/ExternalServicesSection', () => ({
  ExternalServicesSection: ({
    summary,
    onToggle,
  }: {
    summary: string;
    onToggle: () => void;
  }) => (
    <div>
      <button onClick={onToggle}>external-toggle</button>
      <span>{summary}</span>
    </div>
  ),
}));

vi.mock('../../components/NodeConfig/NetworkConnectionsSection', () => ({
  NetworkConnectionsSection: ({
    summary,
    onToggle,
  }: {
    summary: string;
    onToggle: () => void;
  }) => (
    <div>
      <button onClick={onToggle}>network-toggle</button>
      <span>{summary}</span>
    </div>
  ),
}));

vi.mock('../../components/NodeConfig/ProxyTorSection', () => ({
  ProxyTorSection: ({
    nodeConfig,
    summary,
    proxyTestMessage,
    torContainerMessage,
    onConfigChange,
    onToggle,
    onTestProxy,
    onProxyPreset,
    onTorContainerToggle,
    onRefreshTorStatus,
  }: {
    nodeConfig: Record<string, unknown>;
    summary: string;
    proxyTestMessage: string;
    torContainerMessage: string;
    onConfigChange: (config: Record<string, unknown>) => void;
    onToggle: () => void;
    onTestProxy: () => void;
    onProxyPreset: (preset: 'tor' | 'tor-browser' | 'tor-container') => void;
    onTorContainerToggle: () => void;
    onRefreshTorStatus: () => void;
  }) => (
    <div>
      <button onClick={onToggle}>proxy-toggle</button>
      <button
        onClick={() =>
          onConfigChange({
            ...nodeConfig,
            proxyHost: undefined,
            proxyPort: undefined,
          })
        }
      >
        proxy-clear
      </button>
      <button
        onClick={() =>
          onConfigChange({
            ...nodeConfig,
            proxyEnabled: true,
            proxyHost: '127.0.0.1',
            proxyPort: 9050,
          })
        }
      >
        proxy-set
      </button>
      <button onClick={onTestProxy}>proxy-test</button>
      <button onClick={() => onProxyPreset('tor')}>proxy-preset-tor</button>
      <button onClick={() => onProxyPreset('tor-browser')}>proxy-preset-browser</button>
      <button onClick={() => onProxyPreset('tor-container')}>proxy-preset-container</button>
      <button onClick={onTorContainerToggle}>tor-toggle</button>
      <button onClick={onRefreshTorStatus}>tor-refresh</button>
      <span>{summary}</span>
      <span>{proxyTestMessage}</span>
      <span>{torContainerMessage}</span>
    </div>
  ),
}));

describe('NodeConfig second-pass branches', () => {
  const baseConfig = {
    type: 'electrum',
    explorerUrl: 'https://mempool.space',
    feeEstimatorUrl: 'https://mempool.space',
    mempoolEstimator: 'mempool_space' as const,
    mainnetMode: 'pool',
    mainnetSingletonHost: 'electrum.blockstream.info',
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: 'round_robin',
    testnetEnabled: false,
    testnetMode: 'singleton',
    testnetSingletonHost: 'electrum.blockstream.info',
    testnetSingletonPort: 60002,
    testnetSingletonSsl: true,
    testnetPoolMin: 1,
    testnetPoolMax: 3,
    testnetPoolLoadBalancing: 'round_robin',
    signetEnabled: false,
    signetMode: 'singleton',
    signetSingletonHost: 'electrum.mutinynet.com',
    signetSingletonPort: 50002,
    signetSingletonSsl: true,
    signetPoolMin: 1,
    signetPoolMax: 3,
    signetPoolLoadBalancing: 'round_robin',
    proxyEnabled: true,
    proxyHost: '127.0.0.1',
    proxyPort: 9050,
    proxyUsername: undefined,
    proxyPassword: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getNodeConfig).mockResolvedValue(baseConfig as any);
    vi.mocked(adminApi.getElectrumServers).mockResolvedValue([] as any);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue({
      available: true,
      exists: true,
      running: true,
      status: 'running',
    } as any);
    vi.mocked(adminApi.testProxy).mockResolvedValue({ success: true, message: 'ok' } as any);
    vi.mocked(adminApi.startTorContainer).mockResolvedValue({ success: true, message: 'start-ok' } as any);
    vi.mocked(adminApi.stopTorContainer).mockResolvedValue({ success: true, message: 'stop-ok' } as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ pool: null } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('covers null tor-status load path and same-section collapse toggles', async () => {
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue(null as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('external-toggle'));
    fireEvent.click(screen.getByText('external-toggle'));
    fireEvent.click(screen.getByText('network-toggle'));
    fireEvent.click(screen.getByText('network-toggle'));

    expect(screen.getByText('Mainnet (0)')).toBeInTheDocument();
  });

  it('covers proxy test early-return and success/error fallback messages when API omits message', async () => {
    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('proxy-clear'));
    fireEvent.click(screen.getByText('proxy-test'));
    expect(adminApi.testProxy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('proxy-set'));
    vi.mocked(adminApi.testProxy).mockResolvedValueOnce({ success: true } as any);
    fireEvent.click(screen.getByText('proxy-test'));
    await waitFor(() => {
      expect(screen.getByText('Proxy connection successful')).toBeInTheDocument();
    });

    vi.mocked(adminApi.testProxy).mockResolvedValueOnce({ success: false } as any);
    fireEvent.click(screen.getByText('proxy-test'));
    await waitFor(() => {
      expect(screen.getByText('Proxy connection failed')).toBeInTheDocument();
    });
  });

  it('returns early on save when nodeConfig is missing', async () => {
    vi.mocked(adminApi.getNodeConfig).mockResolvedValueOnce(null as any);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValueOnce(null as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save All Settings'));
    expect(adminApi.updateNodeConfig).not.toHaveBeenCalled();
  });

  it('covers tor toggle early return without status plus install branch and null refresh status', async () => {
    vi.mocked(adminApi.getTorContainerStatus)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ available: true, exists: false, running: false, status: 'exited' } as any)
      .mockResolvedValueOnce(null as any);

    const firstRender = render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('tor-toggle'));
    expect(adminApi.startTorContainer).not.toHaveBeenCalled();
    expect(adminApi.stopTorContainer).not.toHaveBeenCalled();

    firstRender.unmount();

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('tor-toggle'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(adminApi.startTorContainer).toHaveBeenCalled();

    await act(async () => {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    });
    expect(adminApi.getTorContainerStatus).toHaveBeenCalledTimes(3);
  });

  it('disables proxy when stopping bundled tor and skips null post-toggle refresh', async () => {
    vi.mocked(adminApi.getNodeConfig).mockResolvedValueOnce({
      ...baseConfig,
      proxyEnabled: true,
      proxyHost: 'tor',
      proxyPort: 9050,
    } as any);
    vi.mocked(adminApi.getTorContainerStatus)
      .mockResolvedValueOnce({ available: true, exists: true, running: true, status: 'running' } as any)
      .mockResolvedValueOnce(null as any);
    vi.mocked(adminApi.stopTorContainer).mockResolvedValueOnce({ success: true, message: 'stopped' } as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('tor-toggle'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(adminApi.stopTorContainer).toHaveBeenCalled();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    await act(async () => {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    });
    expect(adminApi.getTorContainerStatus).toHaveBeenCalledTimes(2);
  });
});
