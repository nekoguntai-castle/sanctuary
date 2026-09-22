import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockHeightIndicator } from '../../../src/components/Layout/BlockHeightIndicator';
import * as bitcoinApi from '../../../src/api/bitcoin';

const activeNetworkMock = vi.hoisted(() => ({
  selectedNetwork: 'mainnet' as 'mainnet' | 'testnet3' | 'signet',
}));
const mockBlockHeightLogDebug = vi.hoisted(() => vi.fn());

vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: activeNetworkMock.selectedNetwork,
    isMainnet: activeNetworkMock.selectedNetwork === 'mainnet',
    setSelectedNetwork: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: mockBlockHeightLogDebug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('BlockHeightIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    activeNetworkMock.selectedNetwork = 'mainnet';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders null when block height has not loaded', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ connected: true });

    const { container } = render(<BlockHeightIndicator />);

    // Flush the initial fetch promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // blockHeight stays null because response has no blockHeight field
    expect(container.firstChild).toBeNull();
  });

  it('renders block height after fetch', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      connected: true,
      blockHeight: 840000,
    });

    render(<BlockHeightIndicator />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByText('840,000')).toBeInTheDocument();
  });

  it('triggers tick animation when block height changes', async () => {
    let callCount = 0;
    vi.mocked(bitcoinApi.getStatus).mockImplementation(async () => {
      callCount++;
      return {
        connected: true,
        blockHeight: callCount === 1 ? 840000 : 840001,
      };
    });

    render(<BlockHeightIndicator />);

    // Flush initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByText('840,000')).toBeInTheDocument();

    // Advance to trigger the interval fetch (30s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    // Block height changed, tick animation should be active
    expect(screen.getByText('840,001')).toBeInTheDocument();
    const container = screen.getByText('840,001').closest('div');
    expect(container).toHaveClass('text-success-500');

    // After 1500ms, tick should reset
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(container).not.toHaveClass('text-success-500');
  });

  it('handles fetch errors gracefully', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('Network error'));

    const { container } = render(<BlockHeightIndicator />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // Should render nothing (blockHeight stays null)
    expect(container.firstChild).toBeNull();
  });

  it('ignores a previous network response that resolves after the current network', async () => {
    let resolveMainnet!: (status: { connected: true; blockHeight: number }) => void;
    let resolveSignet!: (status: { connected: true; blockHeight: number }) => void;
    vi.mocked(bitcoinApi.getStatus).mockImplementation(network => new Promise(resolve => {
      if (network === 'mainnet') resolveMainnet = resolve;
      else resolveSignet = resolve;
    }));

    const view = render(<BlockHeightIndicator />);
    activeNetworkMock.selectedNetwork = 'signet';
    view.rerender(<BlockHeightIndicator />);

    await act(async () => resolveSignet({ connected: true, blockHeight: 900002 }));
    expect(screen.getByText('900,002')).toBeInTheDocument();
    expect(screen.getByTitle(/signet block height/i)).toBeInTheDocument();

    await act(async () => resolveMainnet({ connected: true, blockHeight: 800001 }));
    expect(screen.getByText('900,002')).toBeInTheDocument();
    expect(screen.queryByText('800,001')).not.toBeInTheDocument();
  });

  it('ignores an older overlapping poll on the same network', async () => {
    const resolvers: Array<(status: { connected: true; blockHeight: number }) => void> = [];
    vi.mocked(bitcoinApi.getStatus).mockImplementation(() => new Promise(resolve => {
      resolvers.push(resolve);
    }));

    render(<BlockHeightIndicator />);
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(resolvers).toHaveLength(2);

    await act(async () => resolvers[1]({ connected: true, blockHeight: 840002 }));
    expect(screen.getByText('840,002')).toBeInTheDocument();

    await act(async () => resolvers[0]({ connected: true, blockHeight: 840001 }));
    expect(screen.getByText('840,002')).toBeInTheDocument();
    expect(screen.queryByText('840,001')).not.toBeInTheDocument();
  });

  it('clears the active tick timeout when the network changes', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.mocked(bitcoinApi.getStatus)
      .mockResolvedValueOnce({ connected: true, blockHeight: 840000 })
      .mockResolvedValueOnce({ connected: true, blockHeight: 840001 })
      .mockResolvedValueOnce({ connected: true, blockHeight: 190000 })
      .mockResolvedValueOnce({ connected: true, blockHeight: 190001 });

    const view = render(<BlockHeightIndicator />);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(screen.getByText('840,001').closest('div')).toHaveClass('text-success-500');
    const staleTickReset = timeoutSpy.mock.calls.find(([, delay]) => delay === 1500)?.[0];
    expect(staleTickReset).toBeDefined();

    activeNetworkMock.selectedNetwork = 'signet';
    view.rerender(<BlockHeightIndicator />);
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(screen.getByText('190,000').closest('div')).not.toHaveClass('text-success-500');
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(screen.getByText('190,001').closest('div')).toHaveClass('text-success-500');
    await act(async () => staleTickReset?.());
    expect(screen.getByText('190,001').closest('div')).toHaveClass('text-success-500');

    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByText('190,001').closest('div')).not.toHaveClass('text-success-500');
    timeoutSpy.mockRestore();
  });

  it('does not let an older tick reset end a newer animation', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.mocked(bitcoinApi.getStatus)
      .mockResolvedValueOnce({ connected: true, blockHeight: 840000 })
      .mockResolvedValueOnce({ connected: true, blockHeight: 840001 })
      .mockResolvedValueOnce({ connected: true, blockHeight: 840002 });

    render(<BlockHeightIndicator />);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    const poll = intervalSpy.mock.calls[0][0] as () => void;

    await act(async () => poll());
    const firstReset = timeoutSpy.mock.calls.find(([, delay]) => delay === 1500)?.[0];
    expect(screen.getByText('840,001').closest('div')).toHaveClass('text-success-500');

    await act(async () => poll());
    const tickResets = timeoutSpy.mock.calls.filter(([, delay]) => delay === 1500);
    const secondReset = tickResets.at(-1)?.[0];
    expect(screen.getByText('840,002').closest('div')).toHaveClass('text-success-500');

    await act(async () => firstReset?.());
    expect(screen.getByText('840,002').closest('div')).toHaveClass('text-success-500');
    await act(async () => secondReset?.());
    expect(screen.getByText('840,002').closest('div')).not.toHaveClass('text-success-500');

    intervalSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it('does not update after unmount', async () => {
    let rejectStatus!: (error: Error) => void;
    vi.mocked(bitcoinApi.getStatus).mockImplementation(() => new Promise((_, reject) => {
      rejectStatus = reject;
    }));

    const view = render(<BlockHeightIndicator />);
    view.unmount();
    await act(async () => rejectStatus(new Error('late failure')));

    expect(vi.getTimerCount()).toBe(0);
    expect(mockBlockHeightLogDebug).not.toHaveBeenCalled();
  });
});
