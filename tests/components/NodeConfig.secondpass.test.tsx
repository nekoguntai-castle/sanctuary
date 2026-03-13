import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
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
  }) => {
    return (
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
      <button onClick={() => onConfigChange(null as any)}>proxy-nullify</button>
      <button onClick={onTorContainerToggle}>tor-toggle</button>
      <button onClick={onRefreshTorStatus}>tor-refresh</button>
      <span>{summary}</span>
      <span>{proxyTestMessage}</span>
      <span>{torContainerMessage}</span>
    </div>
  );
  },
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

  it('covers pool-stats fetch rejection path during initial load', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValueOnce(new Error('pool stats failed'));

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(bitcoinApi.getStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('covers proxy-test exception catch path', async () => {
    vi.mocked(adminApi.testProxy).mockRejectedValueOnce(new Error('proxy throw'));

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('proxy-test'));
    await waitFor(() => {
      expect(screen.getByText('proxy throw')).toBeInTheDocument();
    });
  });

  it('executes save-success timeout callback and clears success banner', async () => {
    const timeoutCallbacks: Array<() => void | Promise<void>> = [];
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        if (typeof cb === 'function' && ms === 3000) {
          timeoutCallbacks.push(cb as () => void);
          return realSetTimeout(() => {}, ms);
        }
        return realSetTimeout(cb, ms);
      }) as typeof setTimeout);

    try {
      render(<NodeConfig />);
      await waitFor(() => {
        expect(screen.getByText('Node Configuration')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Save All Settings'));
      await waitFor(() => {
        expect(screen.getByText('Node configuration saved successfully')).toBeInTheDocument();
      });

      expect(timeoutCallbacks.length).toBeGreaterThan(0);
      await act(async () => {
        timeoutCallbacks.forEach((cb) => cb());
      });
      expect(screen.queryByText('Node configuration saved successfully')).not.toBeInTheDocument();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('executes proxy test reset timeout callback after result is shown', async () => {
    const timeoutCallbacks: Array<() => void | Promise<void>> = [];
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        if (typeof cb === 'function' && ms === 10000) {
          timeoutCallbacks.push(cb as () => void);
          return realSetTimeout(() => {}, ms);
        }
        return realSetTimeout(cb, ms);
      }) as typeof setTimeout);

    try {
      render(<NodeConfig />);
      await waitFor(() => {
        expect(screen.getByText('Node Configuration')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('proxy-test'));
      await waitFor(() => {
        expect(screen.getByText('ok')).toBeInTheDocument();
      });

      expect(timeoutCallbacks.length).toBeGreaterThan(0);
      await act(async () => {
        timeoutCallbacks.forEach((cb) => cb());
      });
      expect(screen.queryByText('ok')).not.toBeInTheDocument();
    } finally {
      setTimeoutSpy.mockRestore();
    }
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

  it('runs post-toggle refresh timeout callback and handles explicit refresh success/failure', async () => {
    const timeoutCallbacks: Array<() => void | Promise<void>> = [];
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        if (typeof cb === 'function' && ms === 2000) {
          timeoutCallbacks.push(cb as () => Promise<void>);
          return realSetTimeout(() => {}, ms);
        }
        return realSetTimeout(cb, ms);
      }) as typeof setTimeout);

    vi.mocked(adminApi.getTorContainerStatus)
      .mockResolvedValueOnce({ available: true, exists: true, running: true, status: 'running' } as any)
      .mockRejectedValueOnce(new Error('deferred refresh failed'))
      .mockResolvedValueOnce({ available: true, exists: true, running: false, status: 'exited' } as any)
      .mockRejectedValueOnce(new Error('refresh failed'));
    vi.mocked(adminApi.stopTorContainer).mockRejectedValueOnce(new Error('toggle failed'));

    try {
      render(<NodeConfig />);
      await waitFor(() => {
        expect(screen.getByText('Node Configuration')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('tor-toggle'));
      await waitFor(() => {
        expect(adminApi.stopTorContainer).toHaveBeenCalledTimes(1);
      });

      expect(timeoutCallbacks.length).toBeGreaterThan(0);
      await act(async () => {
        await Promise.all(timeoutCallbacks.map((cb) => cb()));
      });
      expect(adminApi.getTorContainerStatus).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByText('tor-refresh'));
      await waitFor(() => {
        expect(adminApi.getTorContainerStatus).toHaveBeenCalledTimes(3);
      });

      fireEvent.click(screen.getByText('tor-refresh'));
      await waitFor(() => {
        expect(adminApi.getTorContainerStatus).toHaveBeenCalledTimes(4);
      });
    } finally {
      setTimeoutSpy.mockRestore();
    }
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

  it('keeps manual proxy settings when stopping tor without bundled proxy host', async () => {
    vi.mocked(adminApi.getNodeConfig).mockResolvedValueOnce({
      ...baseConfig,
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 9050,
    } as any);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValueOnce({
      available: true,
      exists: true,
      running: true,
      status: 'running',
    } as any);
    vi.mocked(adminApi.stopTorContainer).mockResolvedValueOnce({ success: true, message: 'stopped' } as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Node Configuration')).toBeInTheDocument();
    });

    expect(screen.getByText('127.0.0.1:9050')).toBeInTheDocument();

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('tor-toggle'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adminApi.stopTorContainer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('127.0.0.1:9050')).toBeInTheDocument();
  });

  it('applies truthy post-toggle tor status refresh when initial start fails', async () => {
    vi.mocked(adminApi.getTorContainerStatus)
      .mockResolvedValueOnce({ available: true, exists: true, running: false, status: 'exited' } as any)
      .mockResolvedValueOnce({ available: true, exists: true, running: true, status: 'running' } as any)
      .mockResolvedValueOnce({ available: true, exists: true, running: true, status: 'running' } as any);
    vi.mocked(adminApi.startTorContainer).mockResolvedValueOnce({ success: false, message: 'start failed' } as any);
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
    expect(adminApi.startTorContainer).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('tor-toggle'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adminApi.startTorContainer).toHaveBeenCalledTimes(1);
    expect(adminApi.stopTorContainer).toHaveBeenCalledTimes(1);
  });

  it('exercises setNodeConfig falsy-prev guard by nullifying config while tor stop is pending', async () => {
    // Load with proxyHost='tor' so the tor-stop path reaches setNodeConfig callback.
    // The functional updater (prev) => prev ? {...} : prev runs with prev as the
    // latest state. By setting nodeConfig to null via onConfigChange before the stop
    // resolves, prev will be null when the callback runs, exercising the falsy branch.
    let resolveStop: (v: any) => void;
    const stopPromise = new Promise<any>((r) => { resolveStop = r; });
    vi.mocked(adminApi.getNodeConfig).mockResolvedValueOnce({
      ...baseConfig,
      proxyEnabled: true,
      proxyHost: 'tor',
      proxyPort: 9050,
    } as any);
    vi.mocked(adminApi.stopTorContainer).mockReturnValueOnce(stopPromise);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Bundled Tor')).toBeInTheDocument();
    });

    // Click tor-toggle to initiate stop (async handler awaits stopTorContainer)
    act(() => {
      fireEvent.click(screen.getByText('tor-toggle'));
    });

    // While stop is pending, set nodeConfig to null via the mock button.
    // This means when setNodeConfig((prev) => ...) runs, prev will be null.
    act(() => {
      fireEvent.click(screen.getByText('proxy-nullify'));
    });

    // Now resolve the stop - the closure still has proxyHost='tor', so it enters
    // the if(nodeConfig?.proxyHost === 'tor') branch and calls setNodeConfig.
    // But prev is null, so (prev) => prev ? {...} : prev returns null (falsy branch).
    await act(async () => {
      resolveStop!({ success: true, message: 'stopped' });
    });

    expect(adminApi.stopTorContainer).toHaveBeenCalled();
  });
});
