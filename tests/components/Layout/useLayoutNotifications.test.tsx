import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoinApi from '../../../src/api/bitcoin';
import {
  checkBitcoinConnection,
  useLayoutNotifications,
} from '../../../src/components/Layout/useLayoutNotifications';

vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
}));

vi.mock('../../../src/utils/errorHandler', () => ({
  logError: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const user = { isAdmin: false };

const createActions = () => ({
  addNotification: vi.fn(() => 'notification-id'),
  removeNotificationsByType: vi.fn(),
});

describe('useLayoutNotifications connection ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not let a stale connected response remove the current network error', async () => {
    const actions = createActions();
    const resolvers = new Map<string, (status: { connected: boolean; error?: string }) => void>();
    vi.mocked(bitcoinApi.getStatus).mockImplementation(network => new Promise(resolve => {
      resolvers.set(network!, resolve);
    }));

    const view = renderHook(
      ({ network }) => useLayoutNotifications({
        user,
        wallets: [],
        selectedNetwork: network,
        notificationActions: actions,
      }),
      { initialProps: { network: 'mainnet' as 'mainnet' | 'signet' } },
    );
    view.rerender({ network: 'signet' });

    await act(async () => resolvers.get('signet')?.({ connected: false, error: 'signet offline' }));
    expect(actions.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'connection_error', message: 'signet offline' }),
    );

    await act(async () => resolvers.get('mainnet')?.({ connected: true }));
    expect(actions.removeNotificationsByType).not.toHaveBeenCalled();
  });

  it('does not let a stale failure add an error after the current network connects', async () => {
    const actions = createActions();
    const requests: Array<{
      network: string;
      resolve: (status: { connected: boolean }) => void;
      reject: (error: Error) => void;
    }> = [];
    vi.mocked(bitcoinApi.getStatus).mockImplementation(network => new Promise((resolve, reject) => {
      requests.push({ network: network!, resolve, reject });
    }));

    const view = renderHook(
      ({ network }) => useLayoutNotifications({
        user,
        wallets: [],
        selectedNetwork: network,
        notificationActions: actions,
      }),
      { initialProps: { network: 'mainnet' as 'mainnet' | 'signet' } },
    );
    view.rerender({ network: 'signet' });

    await act(async () => requests.find(request => request.network === 'signet')?.resolve({ connected: true }));
    expect(actions.removeNotificationsByType).toHaveBeenCalledWith('connection_error');

    await act(async () => requests.find(request => request.network === 'mainnet')?.reject(new Error('old failure')));
    expect(actions.addNotification).not.toHaveBeenCalled();
  });

  it('allows only the newest overlapping poll to mutate notifications', async () => {
    const actions = createActions();
    const requests: Array<(status: { connected: boolean; error?: string }) => void> = [];
    vi.mocked(bitcoinApi.getStatus).mockImplementation(() => new Promise(resolve => {
      requests.push(resolve);
    }));

    renderHook(() => useLayoutNotifications({
      user,
      wallets: [],
      selectedNetwork: 'mainnet',
      notificationActions: actions,
    }));
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(requests).toHaveLength(2);

    await act(async () => requests[1]({ connected: false, error: 'newest failure' }));
    await act(async () => requests[0]({ connected: true }));

    expect(actions.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'newest failure' }),
    );
    expect(actions.removeNotificationsByType).not.toHaveBeenCalled();
  });

  it('does not mutate notifications after unmount', async () => {
    const actions = createActions();
    let rejectStatus!: (error: Error) => void;
    vi.mocked(bitcoinApi.getStatus).mockImplementation(() => new Promise((_, reject) => {
      rejectStatus = reject;
    }));

    const view = renderHook(() => useLayoutNotifications({
      user,
      wallets: [],
      selectedNetwork: 'mainnet',
      notificationActions: actions,
    }));
    view.unmount();
    await act(async () => rejectStatus(new Error('late failure')));

    expect(actions.addNotification).not.toHaveBeenCalled();
    expect(actions.removeNotificationsByType).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not remove notifications when a connected response settles after unmount', async () => {
    const actions = createActions();
    let resolveStatus!: (status: { connected: true }) => void;
    vi.mocked(bitcoinApi.getStatus).mockImplementation(() => new Promise(resolve => {
      resolveStatus = resolve;
    }));

    const view = renderHook(() => useLayoutNotifications({
      user,
      wallets: [],
      selectedNetwork: 'mainnet',
      notificationActions: actions,
    }));
    view.unmount();
    await act(async () => resolveStatus({ connected: true }));

    expect(actions.removeNotificationsByType).not.toHaveBeenCalled();
  });

  it('preserves the exported connection helper behavior without an ownership predicate', async () => {
    const actions = createActions();
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      connected: false,
      error: 'node offline',
    });

    await checkBitcoinConnection(true, 'mainnet', actions);

    expect(actions.addNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'connection_error',
      message: 'node offline',
      actionUrl: '/admin/node-config',
      actionLabel: 'Configure Node',
    }));
  });
});
