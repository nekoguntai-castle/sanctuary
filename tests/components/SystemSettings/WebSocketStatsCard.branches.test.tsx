import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebSocketStatsCard } from '../../../components/SystemSettings/WebSocketStatsCard';
import * as adminApi from '../../../src/api/admin';

vi.mock('../../../src/api/admin', () => ({
  getWebSocketStats: vi.fn(),
}));

function createStats(overrides: Record<string, unknown> = {}) {
  return {
    connections: {
      current: 10,
      max: 100,
      maxPerUser: 5,
      uniqueUsers: 4,
    },
    subscriptions: {
      total: 12,
      channels: 3,
      channelList: ['wallet:w1:txs', 'blocks'],
    },
    rateLimits: {
      maxMessagesPerSecond: 50,
      gracePeriodMs: 10000,
      gracePeriodMessageLimit: 100,
      maxSubscriptionsPerConnection: 25,
    },
    recentRateLimitEvents: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('WebSocketStatsCard branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null after loading when API returns no stats object', async () => {
    vi.mocked(adminApi.getWebSocketStats).mockResolvedValue(null as never);
    const { container } = render(<WebSocketStatsCard />);

    await waitFor(() => expect(adminApi.getWebSocketStats).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('WebSocket Status')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('covers auto-refresh interval callback path', async () => {
    const intervalCallbacks: Array<() => void> = [];
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(((cb: TimerHandler) => {
        if (typeof cb === 'function') {
          intervalCallbacks.push(cb as () => void);
        }
        return 0 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);

    vi.mocked(adminApi.getWebSocketStats).mockResolvedValue(createStats() as never);

    const view = render(<WebSocketStatsCard />);

    await waitFor(() => {
      expect(adminApi.getWebSocketStats).toHaveBeenCalledTimes(1);
    });

    expect(intervalCallbacks.length).toBeGreaterThan(0);
    await act(async () => {
      intervalCallbacks[0]();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(adminApi.getWebSocketStats).toHaveBeenCalledTimes(2);
    });

    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('enters and exits refreshing state when manual refresh is clicked', async () => {
    const next = deferred<any>();
    vi.mocked(adminApi.getWebSocketStats)
      .mockResolvedValueOnce(createStats() as never)
      .mockImplementationOnce(() => next.promise);

    render(<WebSocketStatsCard />);

    await waitFor(() => expect(screen.getByText('WebSocket Status')).toBeInTheDocument());

    const refreshButton = screen.getByRole('button');
    fireEvent.click(refreshButton);

    expect(adminApi.getWebSocketStats).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(refreshButton.querySelector('.animate-spin')).toBeTruthy();
    });

    next.resolve(createStats());
    await waitFor(() => expect(screen.getByText('WebSocket Status')).toBeInTheDocument());
  });

  it('covers empty channels branch and all rate-limit reason style branches', async () => {
    vi.mocked(adminApi.getWebSocketStats).mockResolvedValue(
      createStats({
        subscriptions: {
          total: 2,
          channels: 1,
          channelList: [],
        },
        recentRateLimitEvents: [
          {
            timestamp: new Date().toISOString(),
            reason: 'grace_period_exceeded',
            userId: 'user-11111111',
            details: 'Grace limit hit',
          },
          {
            timestamp: new Date().toISOString(),
            reason: 'per_second_exceeded',
            userId: 'user-22222222',
            details: 'Rate per second hit',
          },
          {
            timestamp: new Date().toISOString(),
            reason: 'custom_reason',
            details: 'Custom limiter trigger',
          },
        ],
      }) as never
    );

    render(<WebSocketStatsCard />);

    await waitFor(() => expect(screen.getByText('Rate Limit Events')).toBeInTheDocument());

    expect(screen.queryByText(/Active Channels \(/)).not.toBeInTheDocument();
    expect(screen.getByText('grace period exceeded')).toBeInTheDocument();
    expect(screen.getByText('per second exceeded')).toBeInTheDocument();
    expect(screen.getByText('custom reason')).toBeInTheDocument();
    expect(screen.getByText('user-111...')).toBeInTheDocument();
    expect(screen.getByText('user-222...')).toBeInTheDocument();
    expect(screen.getByText('Custom limiter trigger')).toBeInTheDocument();
  });

  it('falls back wallet channel type label to "base" when channel suffix is missing', async () => {
    vi.mocked(adminApi.getWebSocketStats).mockResolvedValue(
      createStats({
        subscriptions: {
          total: 2,
          channels: 2,
          channelList: ['wallet:wallet12345678', 'wallet:wallet12345678:txs'],
        },
      }) as never
    );

    render(<WebSocketStatsCard />);

    await waitFor(() => expect(screen.getByText(/Wallets \(1\)/)).toBeInTheDocument());
    expect(screen.getByText('base, txs')).toBeInTheDocument();
  });
});
