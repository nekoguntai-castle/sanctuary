import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockHeightIndicator } from '../../../components/Layout/BlockHeightIndicator';
import * as bitcoinApi from '../../../src/api/bitcoin';

vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: 'mainnet',
    isMainnet: true,
    setSelectedNetwork: vi.fn(),
  }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('BlockHeightIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
});
